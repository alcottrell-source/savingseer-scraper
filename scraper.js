// scraper.js
// Savingseer Phase 2 — daily brand scraper
// Dual-pass: CheerioCrawler (static) → PlaywrightCrawler (browser)
// Writes results to Supabase brand_sale_events table
// Runs via GitHub Actions daily at 06:00 UTC

import { CheerioCrawler, PlaywrightCrawler, log, purgeDefaultStorages } from 'crawlee';
import { createClient } from '@supabase/supabase-js';
import { brands, autoBrands, manualCheckBrands } from './brands.js';

// ── CONFIG ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service key for server-side writes
const TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── RESULT STORE ────────────────────────────────────────────────
// Map of brandId → { saleStatus, maxDiscountPct, error }
const results = new Map();

// Initialise all brands as not-yet-checked
for (const brand of brands) {
  results.set(brand.id, { saleStatus: false, maxDiscountPct: null, error: false });
}

// ── SALE DETECTION ──────────────────────────────────────────────
// Returns { onSale: boolean, discountPct: number|null }
function detectSale(html, $, brand) {
  const bodyText = (html || '').toLowerCase();

  // Check confirm text — any of these appearing = sale is on
  const hasConfirmText = brand.confirmText.some(t => bodyText.includes(t.toLowerCase()));

  // Extract discount percentage — look for patterns like "up to 60% off", "50% off"
  let discountPct = null;
  const discountMatch = bodyText.match(/up to (\d+)%\s*off/i) ||
                        bodyText.match(/(\d+)%\s*off/i) ||
                        bodyText.match(/save up to (\d+)%/i);
  if (discountMatch) {
    const pct = parseInt(discountMatch[1], 10);
    if (pct > 0 && pct <= 95) discountPct = pct; // sanity check
  }

  // Also check selectors exist and have content
  let selectorFound = false;
  if ($) {
    for (const selector of brand.saleSelectors) {
      const el = $(selector).first();
      if (el.length && el.text().toLowerCase().includes('sale')) {
        selectorFound = true;
        break;
      }
    }
  }

  const onSale = hasConfirmText || selectorFound;
  return { onSale, discountPct };
}

// ── PASS 1: CHEERIO (static brands) ────────────────────────────
async function runCheerioCrawler() {
  const staticBrands = autoBrands.filter(b => b.renderMode === 'static');
  console.log(`\nPass 1 (Cheerio): ${staticBrands.length} brands`);

  const brandMap = new Map(staticBrands.map(b => [b.url, b]));

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: staticBrands.length,
    requestHandlerTimeoutSecs: 30,
    maxConcurrency: 5,

    async requestHandler({ request, $, body }) {
      const brand = brandMap.get(request.url) || brandMap.get(request.loadedUrl);
      if (!brand) return;

      const html = typeof body === 'string' ? body : body.toString();
      const { onSale, discountPct } = detectSale(html, $, brand);

      results.set(brand.id, { saleStatus: onSale, maxDiscountPct: discountPct, error: false });
      console.log(`  ✓ ${brand.name}: ${onSale ? `ON SALE${discountPct ? ` (${discountPct}% off)` : ''}` : 'no sale'}`);
    },

    async failedRequestHandler({ request }) {
      const brand = brandMap.get(request.url);
      if (brand) {
        results.set(brand.id, { saleStatus: false, maxDiscountPct: null, error: true });
        console.log(`  ✗ ${brand.name}: failed (${request.errorMessages?.[0] || 'unknown error'})`);
      }
    },
  });

  await crawler.run(staticBrands.map(b => ({ url: b.url })));
}

// ── PASS 2: PLAYWRIGHT (browser brands) ────────────────────────
async function runPlaywrightCrawler() {
  const browserBrands = autoBrands.filter(b => b.render_mode === 'browser');
  console.log(`\nPass 2 (Playwright): ${browserBrands.length} brands`);

  if (browserBrands.length === 0) return;

  const brandMap = new Map(browserBrands.map(b => [b.url, b]));

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: browserBrands.length * 4,
    requestHandlerTimeoutSecs: 60,
    maxConcurrency: 2, // Keep low — memory pressure on Actions runner
    launchContext: {
      launchOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    },

    async requestHandler({ request, page }) {
      const brand = brandMap.get(request.url) || brandMap.get(page.url());
      if (!brand) return;

      // Wait for page to settle
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

      const html = await page.content();
      const bodyText = html.toLowerCase();

      const { onSale, discountPct } = detectSale(html, null, brand);

      results.set(brand.id, { saleStatus: onSale, maxDiscountPct: discountPct, error: false });
      console.log(`  ✓ ${brand.name}: ${onSale ? `ON SALE${discountPct ? ` (${discountPct}% off)` : ''}` : 'no sale'}`);
    },

    async failedRequestHandler({ request }) {
      const brand = brandMap.get(request.url);
      if (brand) {
        results.set(brand.id, { saleStatus: false, maxDiscountPct: null, error: true });
        console.log(`  ✗ ${brand.name}: failed`);
      }
    },
  });

  try {
    await crawler.run(browserBrands.map(b => ({ url: b.url })));
  } catch (err) {
    console.error('Playwright crawler crashed:', err);
    browserBrands.forEach(b => {
      if (!results.has(b.id)) {
        results.set(b.id, { saleStatus: false, maxDiscountPct: null, error: true });
      }
    });
  }
}

// ── WRITE TO SUPABASE ───────────────────────────────────────────
async function writeToSupabase() {
  console.log('\nWriting results to Supabase...');

  // Fetch current state of all brands from Supabase
  const { data: currentState, error: fetchError } = await supabase
    .from('brand_sale_events')
    .select('brand_id, sale_status, date_first_detected');

  if (fetchError) {
    console.error('Failed to fetch current brand state:', fetchError);
    process.exit(1);
  }

  const currentMap = new Map(currentState.map(r => [r.brand_id, r]));

  let updated = 0;
  let errors = 0;

  for (const [brandId, result] of results) {
    // Skip manual check brands — they're updated directly in Supabase
    const brand = brands.find(b => b.id === brandId);
    if (brand?.manualCheck) continue;

    const current = currentMap.get(brandId);
    const wasOnSale = current?.sale_status || false;
    const hadDateFirstDetected = current?.date_first_detected;

    // Build update payload
    const updatePayload = {
      sale_status: result.saleStatus,
      max_discount_pct: result.maxDiscountPct,
      last_checked: new Date().toISOString(),
      scraper_error: result.error,
      updated_at: new Date().toISOString(),
    };

    // Set date_first_detected ONLY if:
    // - Sale just started (was false, now true)
    // - AND it hasn't been set before (write-once rule)
    // The DB trigger also enforces this, but we respect it here too
    if (result.saleStatus && !wasOnSale && !hadDateFirstDetected) {
      updatePayload.date_first_detected = TODAY;
    }

    // If sale ended (was true, now false), reset the cycle
    // We call the DB function rather than directly clearing date_first_detected
    if (!result.saleStatus && wasOnSale && hadDateFirstDetected) {
      console.log(`  ↩ ${brand?.name || brandId}: sale ended — resetting cycle`);
      const { error: resetError } = await supabase.rpc('reset_brand_sale_cycle', {
        p_brand_id: brandId,
      });
      if (resetError) {
        console.error(`  ✗ Reset failed for ${brandId}:`, resetError);
        errors++;
      }
      continue; // Skip the normal update below
    }

    const { error: updateError } = await supabase
      .from('brand_sale_events')
      .update(updatePayload)
      .eq('brand_id', brandId);

    if (updateError) {
      console.error(`  ✗ Supabase write failed for ${brandId}:`, updateError);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\n  Written: ${updated} brands | Errors: ${errors}`);
  return { updated, errors };
}

// ── SUMMARY ─────────────────────────────────────────────────────
function printSummary() {
  const onSale = [...results.values()].filter(r => r.saleStatus).length;
  const errored = [...results.values()].filter(r => r.error).length;
  const manual = manualCheckBrands.length;

  console.log('\n── SCRAPER SUMMARY ──────────────────────────────');
  console.log(`  Date:          ${TODAY}`);
  console.log(`  Total brands:  ${brands.length}`);
  console.log(`  On sale:       ${onSale}`);
  console.log(`  Errors:        ${errored}`);
  console.log(`  Manual check:  ${manual} (updated separately in Supabase)`);
  console.log('─────────────────────────────────────────────────\n');
}

// ── MAIN ────────────────────────────────────────────────────────
async function main() {
  log.setLevel(log.LEVELS.WARNING); // Suppress Crawlee verbose logging

  console.log('═══════════════════════════════════════════════');
  console.log(`  Savingseer Scraper — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  try {
    await runCheerioCrawler();
    await runPlaywrightCrawler();
    await writeToSupabase();
    printSummary();
    console.log('✅ Scraper complete');
  } catch (err) {
    console.error('❌ Scraper failed:', err);
    process.exit(1);
  }
}

main();
