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
function detectSale(html, $, brand) {
  const bodyText = (html || '').toLowerCase();

  const hasConfirmText = brand.confirmText.some(t => bodyText.includes(t.toLowerCase()));

  let discountPct = null;
  const discountMatch = bodyText.match(/up to (\d+)%\s*off/i) ||
                        bodyText.match(/(\d+)%\s*off/i) ||
                        bodyText.match(/save up to (\d+)%/i);
  if (discountMatch) {
    const pct = parseInt(discountMatch[1], 10);
    if (pct > 0 && pct <= 95) discountPct = pct;
  }

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
    browserPoolOptions: {
      useFingerprints: true,
    },
    launchContext: {
      launchOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.setExtraHTTPHeaders({ 'accept-language': 'en-GB,en;q=0.9' });
      },
    ],

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
