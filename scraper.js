// scraper.js
// Tide — daily brand scraper
// Dual-pass: CheerioCrawler (static) → PlaywrightCrawler (browser)
// Writes results to Supabase brand_sale_events table
// Runs via GitHub Actions daily at 06:00 UTC

import { CheerioCrawler, PlaywrightCrawler, purgeDefaultStorages, log } from 'crawlee';
import { createClient } from '@supabase/supabase-js';
import { brands, autoBrands, manualCheckBrands } from './brands.js';

// ── CONFIG ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TODAY = new Date().toISOString().split('T')[0];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── RESULT STORE ────────────────────────────────────────────────
const results = new Map();

for (const brand of brands) {
  results.set(brand.id, { saleStatus: false, maxDiscountPct: null, error: false });
}

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
  //    Bare `.sale` selector matches are deliberately ignored — they fire on
  //    /sale URLs even when the sale has ended.
  const hasMarkdownPrices = /now\s*£\d+(?:\.\d{2})?/i.test(bodyText) ||
                            /was\s*£\d+(?:\.\d{2})?\s*now\s*£\d+(?:\.\d{2})?/i.test(bodyText);

  const onSale = discountPct !== null || hasStrongPhrase || hasMarkdownPrices;

  return { onSale, discountPct: onSale ? discountPct : null };
}

// ── PASS 1: CHEERIO ─────────────────────────────────────────────
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

// ── PASS 2: PLAYWRIGHT ──────────────────────────────────────────
async function runPlaywrightCrawler() {
  const browserBrands = autoBrands.filter(b => b.renderMode === 'browser');
  console.log(`\nPass 2 (Playwright): ${browserBrands.length} brands`);

  if (browserBrands.length === 0) return;

  const brandMap = new Map(browserBrands.map(b => [b.url, b]));

  await purgeDefaultStorages();

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: browserBrands.length * 4,
    requestHandlerTimeoutSecs: 60,
    maxConcurrency: 2,
    useSessionPool: false,
    launchContext: {
      launchOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    },

    async requestHandler({ request, page }) {
      const brand = brandMap.get(request.url) || brandMap.get(page.url());
      if (!brand) return;

      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

      const html = await page.content();
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
    console.error('  ✗ Playwright crawler crashed:', err);
    for (const brand of browserBrands) {
      const r = results.get(brand.id);
      if (!r.error && !r.saleStatus && r.maxDiscountPct === null) {
        results.set(brand.id, { saleStatus: false, maxDiscountPct: null, error: true });
      }
    }
  }
}

// ── WRITE TO SUPABASE ───────────────────────────────────────────
async function writeToSupabase() {
  console.log('\nWriting results to Supabase...');

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
    const brand = brands.find(b => b.id === brandId);
    if (brand?.manualCheck) continue;

    const current = currentMap.get(brandId);
    const wasOnSale = current?.sale_status || false;
    const hadDateFirstDetected = current?.date_first_detected;

    const updatePayload = {
      sale_status: result.saleStatus,
      max_discount_pct: result.maxDiscountPct,
      last_checked: new Date().toISOString(),
      scraper_error: result.error,
      updated_at: new Date().toISOString(),
    };

    if (result.saleStatus && !wasOnSale && !hadDateFirstDetected) {
      updatePayload.date_first_detected = TODAY;
    }

    if (!result.saleStatus && wasOnSale && hadDateFirstDetected) {
      console.log(`  ↩ ${brand?.name || brandId}: sale ended — resetting cycle`);
      const { error: resetError } = await supabase.rpc('reset_brand_sale_cycle', {
        p_brand_id: brandId,
      });
      if (resetError) {
        console.error(`  ✗ Reset failed for ${brandId}:`, resetError);
        errors++;
      }
      continue;
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
  log.setLevel(log.LEVELS.WARNING);

  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scraper — ${TODAY}`);
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
