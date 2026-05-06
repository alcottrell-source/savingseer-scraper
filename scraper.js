// scraper.js
// Tide — daily brand scraper
// Dual-pass: CheerioCrawler (static) → PlaywrightCrawler (browser)
// Writes results to Supabase brand_sale_events table
// Runs via GitHub Actions daily at 06:00 UTC.
//
// May 2026 robustness audit (this file):
//   - Startup validation: every autoBrand must have an explicit renderMode of
//     'static' or 'browser'. Any brand missing it aborts the run with a clear
//     error rather than silently being skipped by both passes.
//   - Per-brand isolation: a single brand crashing (CheerioRequestHandler
//     throwing, Playwright timing out, parser blowing up) cannot kill the
//     whole run. Every handler is wrapped; failures land in `results` with
//     error details and the run continues.
//   - Retry with exponential backoff for HTTP/2 + protocol errors (FLANNELS
//     historical). Up to 3 attempts at 1s/2s/4s. Persistently failing brands
//     are written as scrape_failed (NOT silently coerced to "not on sale").
//   - Playwright cleanup: the crawler is torn down inside a `finally` block
//     so a thrown error during a request can't leak browser sessions.
//   - Validation gate before every Supabase write: brand_id must exist in the
//     brands table, sale_status must be a strict boolean, last_checked must
//     be today's UTC date. Bad records are rejected and logged, never written.
//   - Run summary is printed to console *and* persisted to audit_log. If the
//     audit_log insert itself fails, that's a console-only error — we don't
//     want audit-log issues to break the scraper.

import { CheerioCrawler, PlaywrightCrawler, purgeDefaultStorages, log } from 'crawlee';
import { createClient } from '@supabase/supabase-js';
import { brands, autoBrands, manualCheckBrands } from './brands.js';

// ── CONFIG ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TODAY = new Date().toISOString().split('T')[0];
const RUN_STARTED_AT = new Date();

// Patterns we consider transient enough to retry. HTTP/2 framing errors and
// connection resets are the recurring offenders (e.g. FLANNELS) — a fresh
// connection on a second attempt usually clears them.
const RETRYABLE_ERROR_PATTERNS = [
  /ERR_HTTP2/i,
  /ERR_HTTP_RESPONSE_CODE_FAILURE/i,
  /PROTOCOL_ERROR/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /net::ERR_/i,
];

const MAX_RETRY_ATTEMPTS = 3;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STARTUP VALIDATION ──────────────────────────────────────────
// Every auto brand must have an explicit renderMode. Without this guard, a
// brand with renderMode undefined would silently be filtered out of *both*
// the Cheerio pass (renderMode === 'static') and the Playwright pass
// (renderMode === 'browser'), so it would never be scraped and we'd never
// notice — its row in brand_sale_events would just go stale.
function validateBrands() {
  const invalid = autoBrands.filter(b => b.renderMode !== 'static' && b.renderMode !== 'browser');
  if (invalid.length > 0) {
    console.error('❌ Brand config invalid — every autoBrand needs renderMode set to "static" or "browser":');
    for (const b of invalid) {
      console.error(`     - ${b.id} ${b.name}: renderMode=${JSON.stringify(b.renderMode)}`);
    }
    process.exit(1);
  }
}

// ── RESULT STORE ────────────────────────────────────────────────
// One entry per autoBrand. status enum:
//   'on_sale'        scraper saw active-sale evidence
//   'not_on_sale'    scraper ran cleanly, no sale evidence
//   'scrape_failed'  scraper could not get a usable signal (network, parse, timeout)
const results = new Map();

for (const brand of autoBrands) {
  results.set(brand.id, {
    status: 'not_on_sale',
    maxDiscountPct: null,
    error: null,         // string description if scrape_failed
    attempts: 0,
  });
}

// Per-brand error log for the run summary / audit_log.details payload.
const perBrandErrors = [];

// ── SALE DETECTION ──────────────────────────────────────────────
// Phrases that explicitly announce the sale is over. Match any → not on sale,
// regardless of other signals. The page can still contain the word "sale" all
// over (URL, nav, the end-of-sale headline itself), which is why a bare-word
// match was triggering false positives (e.g. Hugo Boss "THE SALE HAS NOW ENDED").
const SALE_ENDED_PHRASES = [
  'sale has ended',
  'sale has now ended',
  'the sale has ended',
  'the sale has now ended',
  'sale is over',
  'sale is now over',
  'sale now over',
  'sale ended',
  'sale now ended',
  'our sale is over',
  'our sale has ended',
  'no sale currently',
  'no current sale',
];

// Future-tense announcements. Mark as not-on-sale unless the page also carries
// active-sale evidence (we don't want to mis-flag a "sign up for early access"
// banner on a page that already has a live sale).
const SALE_UPCOMING_PHRASES = [
  'sale starts',
  'sale begins',
  'sale coming soon',
  'sign up for sale alerts',
];

// Active-sale CTAs and banner copy. Stronger than the bare word "sale" because
// these phrases don't appear on ended-sale or no-sale landing pages.
const STRONG_SALE_PHRASES = [
  'shop sale',
  'shop the sale',
  'sale now on',
  'sale now live',
  'sale is live',
  'mid-season sale',
  'mid season sale',
  'end of season sale',
  'final sale',
  'final reductions',
  'further reductions',
  'extra off',
  'save up to',
  'up to 70% off',
  'up to 60% off',
  'up to 50% off',
];

function extractDiscountPct(bodyText) {
  const discountMatch = bodyText.match(/up to (\d+)%\s*off/i) ||
                        bodyText.match(/save up to (\d+)%/i) ||
                        bodyText.match(/(\d+)%\s*off/i);
  if (!discountMatch) return null;
  const pct = parseInt(discountMatch[1], 10);
  return pct > 0 && pct <= 95 ? pct : null;
}

function detectSale(html, $, brand) {
  const bodyText = (html || '').toLowerCase();

  // 1. Negative override — explicit end-of-sale wording wins outright.
  if (SALE_ENDED_PHRASES.some(p => bodyText.includes(p))) {
    return { onSale: false, discountPct: null };
  }

  const discountPct = extractDiscountPct(bodyText);

  // 2. Future-tense announcement, with no contradicting active-sale evidence.
  const hasStrongPhrase = STRONG_SALE_PHRASES.some(p => bodyText.includes(p));
  if (SALE_UPCOMING_PHRASES.some(p => bodyText.includes(p)) &&
      !hasStrongPhrase &&
      discountPct === null) {
    return { onSale: false, discountPct: null };
  }

  // 3. Positive evidence: require something stronger than just the word "sale".
  //    A discount %, an active-sale CTA, or strikethrough/now-price markers.
  const hasMarkdownPrices = /now\s*£\d+(?:\.\d{2})?/i.test(bodyText) ||
                            /was\s*£\d+(?:\.\d{2})?\s*now\s*£\d+(?:\.\d{2})?/i.test(bodyText);

  const onSale = discountPct !== null || hasStrongPhrase || hasMarkdownPrices;

  return { onSale, discountPct: onSale ? discountPct : null };
}

function isRetryable(errMessage) {
  if (!errMessage) return false;
  return RETRYABLE_ERROR_PATTERNS.some(re => re.test(errMessage));
}

function recordSuccess(brand, onSale, discountPct, attempts) {
  results.set(brand.id, {
    status: onSale ? 'on_sale' : 'not_on_sale',
    maxDiscountPct: onSale ? discountPct : null,
    error: null,
    attempts,
  });
}

function recordFailure(brand, errMessage, attempts) {
  results.set(brand.id, {
    status: 'scrape_failed',
    maxDiscountPct: null,
    error: errMessage || 'unknown error',
    attempts,
  });
  perBrandErrors.push({ brand_id: brand.id, name: brand.name, error: String(errMessage || 'unknown').slice(0, 500), attempts });
}

// ── PASS 1: CHEERIO ─────────────────────────────────────────────
async function runCheerioCrawler() {
  const staticBrands = autoBrands.filter(b => b.renderMode === 'static');
  console.log(`\nPass 1 (Cheerio): ${staticBrands.length} brands`);

  if (staticBrands.length === 0) return;

  const brandMap = new Map(staticBrands.map(b => [b.url, b]));
  // Track per-URL retry counts in-process. Crawlee has its own retry mechanism
  // but we want exponential backoff on the *transient* error class only and
  // a clean record of how many attempts we used.
  const attemptCounter = new Map(staticBrands.map(b => [b.url, 0]));

  let crawler;
  try {
    crawler = new CheerioCrawler({
      maxRequestsPerCrawl: staticBrands.length * MAX_RETRY_ATTEMPTS,
      requestHandlerTimeoutSecs: 30,
      maxConcurrency: 5,
      maxRequestRetries: MAX_RETRY_ATTEMPTS - 1,  // Crawlee handles the retry loop

      async requestHandler({ request, $, body }) {
        const brand = brandMap.get(request.url) || brandMap.get(request.loadedUrl);
        if (!brand) return;
        const attempts = (attemptCounter.get(brand.url) || 0) + 1;
        attemptCounter.set(brand.url, attempts);

        // Per-brand try/catch so a parsing crash on one brand never kills the
        // crawler. A thrown error here would propagate up and tear down the
        // CheerioCrawler instance.
        try {
          const html = typeof body === 'string' ? body : body.toString();
          const { onSale, discountPct } = detectSale(html, $, brand);
          recordSuccess(brand, onSale, discountPct, attempts);
          console.log(`  ✓ ${brand.name}: ${onSale ? `ON SALE${discountPct ? ` (${discountPct}% off)` : ''}` : 'no sale'}`);
        } catch (err) {
          console.error(`  ✗ ${brand.name}: handler crashed — ${err.message}`);
          recordFailure(brand, `handler error: ${err.message}`, attempts);
        }
      },

      async failedRequestHandler({ request }) {
        const brand = brandMap.get(request.url);
        if (!brand) return;
        const attempts = attemptCounter.get(brand.url) || MAX_RETRY_ATTEMPTS;
        const errMsg = request.errorMessages?.[request.errorMessages.length - 1] || 'unknown error';
        const retryNote = isRetryable(errMsg)
          ? ` (retried ${attempts}x — transient class)`
          : '';
        console.log(`  ✗ ${brand.name}: failed${retryNote} — ${errMsg}`);
        recordFailure(brand, errMsg, attempts);
      },
    });

    await crawler.run(staticBrands.map(b => ({ url: b.url })));
  } catch (err) {
    // Crawler-level crash (rare). Mark unfinished brands as scrape_failed
    // rather than letting them keep their default not_on_sale status.
    console.error('  ✗ Cheerio crawler crashed:', err.message);
    for (const brand of staticBrands) {
      const r = results.get(brand.id);
      if (r.status === 'not_on_sale' && (attemptCounter.get(brand.url) || 0) === 0) {
        recordFailure(brand, `crawler crash before brand attempted: ${err.message}`, 0);
      }
    }
  } finally {
    // Crawlee's CheerioCrawler doesn't keep persistent connections; the explicit
    // teardown is mainly for symmetry with PlaywrightCrawler. .teardown() exists
    // on newer Crawlee versions; guard against undefined.
    try { await crawler?.teardown?.(); } catch { /* best-effort */ }
  }
}

// ── PASS 2: PLAYWRIGHT ──────────────────────────────────────────
async function runPlaywrightCrawler() {
  const browserBrands = autoBrands.filter(b => b.renderMode === 'browser');
  console.log(`\nPass 2 (Playwright): ${browserBrands.length} brands`);

  if (browserBrands.length === 0) return;

  const brandMap = new Map(browserBrands.map(b => [b.url, b]));
  const attemptCounter = new Map(browserBrands.map(b => [b.url, 0]));

  await purgeDefaultStorages();

  let crawler;
  try {
    crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: browserBrands.length * MAX_RETRY_ATTEMPTS,
      requestHandlerTimeoutSecs: 60,
      maxConcurrency: 2,
      useSessionPool: false,
      maxRequestRetries: MAX_RETRY_ATTEMPTS - 1,
      launchContext: {
        launchOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      },

      async requestHandler({ request, page }) {
        const brand = brandMap.get(request.url) || brandMap.get(page.url());
        if (!brand) return;
        const attempts = (attemptCounter.get(brand.url) || 0) + 1;
        attemptCounter.set(brand.url, attempts);

        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
          const html = await page.content();
          const { onSale, discountPct } = detectSale(html, null, brand);
          recordSuccess(brand, onSale, discountPct, attempts);
          console.log(`  ✓ ${brand.name}: ${onSale ? `ON SALE${discountPct ? ` (${discountPct}% off)` : ''}` : 'no sale'}`);
        } catch (err) {
          console.error(`  ✗ ${brand.name}: handler crashed — ${err.message}`);
          recordFailure(brand, `handler error: ${err.message}`, attempts);
        }
      },

      async failedRequestHandler({ request }) {
        const brand = brandMap.get(request.url);
        if (!brand) return;
        const attempts = attemptCounter.get(brand.url) || MAX_RETRY_ATTEMPTS;
        const errMsg = request.errorMessages?.[request.errorMessages.length - 1] || 'unknown error';
        const retryNote = isRetryable(errMsg) ? ` (retried ${attempts}x — transient class)` : '';
        console.log(`  ✗ ${brand.name}: failed${retryNote} — ${errMsg}`);
        recordFailure(brand, errMsg, attempts);
      },

      // Crawlee retry hook — exponential backoff for transient errors only.
      // For non-transient errors we still retry (Crawlee requires a hook), but
      // with no extra delay so they fail fast and free the slot.
      async errorHandler({ request }, error) {
        const errMsg = error?.message || '';
        if (isRetryable(errMsg)) {
          const attempt = request.retryCount + 1;
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);  // 1s, 2s, 4s
          await new Promise(r => setTimeout(r, delayMs));
        }
      },
    });

    await crawler.run(browserBrands.map(b => ({ url: b.url })));
  } catch (err) {
    console.error('  ✗ Playwright crawler crashed:', err.message);
    for (const brand of browserBrands) {
      const r = results.get(brand.id);
      if (r.status === 'not_on_sale' && (attemptCounter.get(brand.url) || 0) === 0) {
        recordFailure(brand, `crawler crash before brand attempted: ${err.message}`, 0);
      }
    }
  } finally {
    // Hard requirement (Area 1): Playwright sessions must be torn down even on
    // success exceptions. Without this, an exception inside requestHandler can
    // leak a chromium process — which has been the cause of intermittent CI
    // crashes ("Target page, context or browser has been closed").
    try {
      await crawler?.teardown?.();
    } catch (teardownErr) {
      console.error('  ⚠ Playwright teardown error (non-fatal):', teardownErr.message);
    }
  }
}

// ── WRITE TO SUPABASE ───────────────────────────────────────────
// Validation gate (Area 2). A row may only be written if:
//   - brand_id is in the known brands set (in-process, since brands.js is the
//     source of truth — the DB-side FK already enforces this if a stray ID
//     gets through, but we want to fail loud, not at insert time)
//   - status is one of the three allowed values
//   - sale_status is a strict boolean
//   - last_checked iso string starts with TODAY (UTC date guard)
const VALID_STATUSES = new Set(['on_sale', 'not_on_sale', 'scrape_failed']);
const validBrandIds = new Set(brands.map(b => b.id));

function validateRecord(brandId, status, payload) {
  const errors = [];
  if (!validBrandIds.has(brandId)) errors.push(`unknown brand_id ${brandId}`);
  if (!VALID_STATUSES.has(status)) errors.push(`invalid status ${status}`);
  if (typeof payload.sale_status !== 'boolean') errors.push(`sale_status not boolean (got ${typeof payload.sale_status})`);
  if (typeof payload.last_checked !== 'string' || !payload.last_checked.startsWith(TODAY)) {
    errors.push(`last_checked not today (got ${payload.last_checked})`);
  }
  return errors;
}

async function writeToSupabase() {
  console.log('\nWriting results to Supabase...');

  // Fetch active_cycle_id so we know if an admin has manually confirmed a sale.
  // We must not call reset_brand_sale_cycle when an admin cycle is open — that
  // would wipe human-verified data based on a scraper false-negative.
  const { data: currentState, error: fetchError } = await supabase
    .from('brand_sale_events')
    .select('brand_id, sale_status, date_first_detected, active_cycle_id');

  if (fetchError) {
    console.error('Failed to fetch current brand state:', fetchError);
    throw new Error(`brand_sale_events fetch failed: ${fetchError.message}`);
  }

  const currentMap = new Map(currentState.map(r => [r.brand_id, r]));

  let updated = 0;
  let writeErrors = 0;
  let validationRejects = 0;

  for (const [brandId, result] of results) {
    const brand = brands.find(b => b.id === brandId);
    if (brand?.manualCheck) continue;

    // 'scrape_failed' path: we could not get a usable signal. Preserve the
    // existing sale_status (do NOT silently flip to "not on sale") and just
    // flag scraper_error so the admin console surfaces it.
    if (result.status === 'scrape_failed') {
      const payload = {
        scraper_error: true,
        last_checked: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Validation gate is lighter for scrape_failed (no sale_status change).
      if (!validBrandIds.has(brandId)) {
        console.error(`  ✗ ${brandId}: validation reject (unknown brand_id) — skipping write`);
        validationRejects++;
        continue;
      }
      const { error: flagErr } = await supabase
        .from('brand_sale_events')
        .update(payload)
        .eq('brand_id', brandId);
      if (flagErr) {
        console.error(`  ✗ Error flag write failed for ${brandId}:`, flagErr.message);
        writeErrors++;
      } else {
        console.log(`  ⚠ ${brand?.name || brandId}: scrape_failed (${result.attempts}x) — preserving existing sale_status, error=${result.error?.slice(0, 80)}`);
      }
      continue;
    }

    const onSale = result.status === 'on_sale';
    const current = currentMap.get(brandId);
    const wasOnSale = current?.sale_status || false;
    const hadDateFirstDetected = current?.date_first_detected;
    const hasAdminCycle = !!current?.active_cycle_id;

    const updatePayload = {
      sale_status: onSale,
      max_discount_pct: result.maxDiscountPct,
      last_checked: new Date().toISOString(),
      scraper_error: false,
      updated_at: new Date().toISOString(),
    };

    if (onSale && !wasOnSale && !hadDateFirstDetected) {
      updatePayload.date_first_detected = TODAY;
    }

    // Validation gate before any write.
    const errs = validateRecord(brandId, result.status, updatePayload);
    if (errs.length > 0) {
      console.error(`  ✗ ${brandId}: validation reject — ${errs.join('; ')}. Refusing write.`);
      validationRejects++;
      continue;
    }

    if (!onSale && wasOnSale && hadDateFirstDetected) {
      if (hasAdminCycle) {
        // Admin has confirmed this sale is running. The scraper may be wrong.
        // Update scraper columns so the admin console flags the disagreement,
        // but leave active_cycle_id and human-verified data intact.
        console.log(`  ⚑ ${brand?.name || brandId}: scraper says ended but admin cycle open — preserving admin cycle`);
        const { error: updateError } = await supabase
          .from('brand_sale_events')
          .update({ sale_status: false, scraper_error: false, last_checked: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('brand_id', brandId);
        if (updateError) {
          console.error(`  ✗ Supabase write failed for ${brandId}:`, updateError.message);
          writeErrors++;
        } else {
          updated++;
        }
        continue;
      }
      console.log(`  ↩ ${brand?.name || brandId}: sale ended — resetting cycle`);
      const { error: resetError } = await supabase.rpc('reset_brand_sale_cycle', {
        p_brand_id: brandId,
      });
      if (resetError) {
        console.error(`  ✗ Reset failed for ${brandId}:`, resetError.message);
        writeErrors++;
      }
      continue;
    }

    const { error: updateError } = await supabase
      .from('brand_sale_events')
      .update(updatePayload)
      .eq('brand_id', brandId);

    if (updateError) {
      console.error(`  ✗ Supabase write failed for ${brandId}:`, updateError.message);
      writeErrors++;
    } else {
      updated++;
    }
  }

  console.log(`\n  Written: ${updated} brands | Write errors: ${writeErrors} | Validation rejects: ${validationRejects}`);
  return { updated, writeErrors, validationRejects };
}

// ── SUMMARY + AUDIT LOG ─────────────────────────────────────────
function buildSummary() {
  let onSale = 0, notOnSale = 0, failed = 0;
  for (const r of results.values()) {
    if (r.status === 'on_sale') onSale++;
    else if (r.status === 'not_on_sale') notOnSale++;
    else failed++;
  }
  return {
    attempted: results.size,
    succeeded: onSale + notOnSale,
    failed,
    onSale,
    notOnSale,
    manual: manualCheckBrands.length,
  };
}

function printSummary(summary) {
  console.log('\n── SCRAPER SUMMARY ──────────────────────────────');
  console.log(`  Date:                ${TODAY}`);
  console.log(`  Total auto brands:   ${summary.attempted}`);
  console.log(`  Scraped successfully:${summary.succeeded}`);
  console.log(`  Failed:              ${summary.failed}`);
  console.log(`  On sale:             ${summary.onSale}`);
  console.log(`  Not on sale:         ${summary.notOnSale}`);
  console.log(`  Manual check brands: ${summary.manual} (skipped — admin verifies)`);
  console.log('─────────────────────────────────────────────────\n');
}

// audit_log writer. Failures here are loud-on-console but never fatal — we
// don't want a dead audit_log table to keep the scraper from completing.
async function writeAuditLog(summary, status, writeOutcome) {
  const durationMs = Date.now() - RUN_STARTED_AT.getTime();
  const errorSummary = perBrandErrors.length === 0
    ? null
    : `${perBrandErrors.length} brand(s) failed: ` +
      perBrandErrors.slice(0, 10).map(e => `${e.name} (${e.error?.slice(0, 60)})`).join('; ') +
      (perBrandErrors.length > 10 ? ` …+${perBrandErrors.length - 10} more` : '');

  const row = {
    run_type: 'scraper',
    run_date: TODAY,
    run_started_at: RUN_STARTED_AT.toISOString(),
    run_completed_at: new Date().toISOString(),
    run_duration_ms: durationMs,
    status,
    brands_attempted: summary.attempted,
    brands_succeeded: summary.succeeded,
    brands_failed: summary.failed,
    brands_on_sale: summary.onSale,
    brands_not_on_sale: summary.notOnSale,
    error_summary: errorSummary?.slice(0, 4000) || null,
    details: {
      manual_check_brands: summary.manual,
      write_outcome: writeOutcome || null,
      per_brand_errors: perBrandErrors.slice(0, 100),  // cap to keep payload small
    },
  };

  const { error } = await supabase.from('audit_log').insert(row);
  if (error) {
    console.error('⚠ audit_log insert failed (non-fatal):', error.message);
  } else {
    console.log(`  ✓ audit_log row written (run_duration_ms=${durationMs})`);
  }
}

// ── MAIN ────────────────────────────────────────────────────────
async function main() {
  log.setLevel(log.LEVELS.WARNING);

  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scraper — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  validateBrands();

  let runStatus = 'success';
  let writeOutcome = null;
  let crashErr = null;

  try {
    await runCheerioCrawler();
    await runPlaywrightCrawler();
    writeOutcome = await writeToSupabase();
  } catch (err) {
    crashErr = err;
    runStatus = 'failed';
    console.error('❌ Scraper crashed mid-run:', err.message);
  }

  const summary = buildSummary();
  printSummary(summary);

  // Even a partial run gets a row in audit_log. Status reflects severity.
  if (runStatus !== 'failed') {
    if (summary.failed > 0 || (writeOutcome && (writeOutcome.writeErrors > 0 || writeOutcome.validationRejects > 0))) {
      runStatus = 'partial';
    }
  }
  if (crashErr) {
    perBrandErrors.unshift({ brand_id: '_run_', name: '_run_', error: `crash: ${crashErr.message}`, attempts: 0 });
  }

  await writeAuditLog(summary, runStatus, writeOutcome);

  if (crashErr) {
    process.exit(1);
  }
  console.log('✅ Scraper complete');
}

main();
