/**
 * Savingseer brand scraper
 * Strategy: Cheerio (fast, static HTML) first.
 * If blocked or no signal found, retry with Playwright (full browser).
 * Output: JSON array written to ./results/scores.json
 *         then pushed to Google Sheets via Sheets API.
 */

import { CheerioCrawler, PlaywrightCrawler, Dataset, log } from 'crawlee';
import { writeFileSync, mkdirSync } from 'fs';
import { pushToSheets } from './sheets.js';

log.setLevel(log.LEVELS.INFO);

// ─── Brand list ────────────────────────────────────────────────────────────
// Each entry: { id, name, url, selectors? }
// selectors: CSS selectors that indicate an active sale when present.
// Leave selectors empty to use the default heuristic (see detectSale()).
// Set renderMode: 'browser' to skip Cheerio and go straight to Playwright
// (use for brands you already know block static requests).
import { BRANDS } from './brands.js';

// ─── Sale detection heuristic ───────────────────────────────────────────────
// Looks for common sale signal patterns in the page HTML.
// Returns { onSale: bool, signals: string[] }
function detectSale(html, $, customSelectors = []) {
  const signals = [];

  // 1. Custom selectors provided per-brand
  for (const sel of customSelectors) {
    if ($(sel).length > 0) signals.push(`custom:${sel}`);
  }

  // 2. Generic sale banner patterns
  const salePatterns = [
    { sel: '[class*="sale"]',         label: 'sale-class' },
    { sel: '[class*="promo"]',        label: 'promo-class' },
    { sel: '[class*="discount"]',     label: 'discount-class' },
    { sel: '[class*="offer"]',        label: 'offer-class' },
    { sel: '[class*="event-banner"]', label: 'event-banner' },
    { sel: '[class*="markdown"]',     label: 'markdown' },
    { sel: '[id*="sale"]',            label: 'sale-id' },
    { sel: '[id*="promo"]',           label: 'promo-id' },
    { sel: '[data-testid*="sale"]',   label: 'sale-testid' },
    { sel: '[data-testid*="promo"]',  label: 'promo-testid' },
    { sel: '.badge--sale',            label: 'badge-sale' },
    { sel: '.tag--sale',              label: 'tag-sale' },
    { sel: '.label--sale',            label: 'label-sale' },
  ];

  for (const { sel, label } of salePatterns) {
    if ($(sel).length > 0) signals.push(label);
  }

  // 3. Text-content heuristics — look for sale language in banners/headers
  const saleKeywords = [
    /\bsale\b/i,
    /\bup to \d+% off\b/i,
    /\b\d+% off\b/i,
    /\bextra \d+% off\b/i,
    /\bmid[- ]?season sale\b/i,
    /\bend[- ]?of[- ]?season\b/i,
    /\bnow on sale\b/i,
    /\bbank holiday sale\b/i,
    /\bblack friday\b/i,
    /\bcyber monday\b/i,
    /\bboxing day sale\b/i,
    /\bfurther reductions\b/i,
  ];

  // Only scan banner/header/nav regions to reduce false positives
  const bannerText = $('header, nav, [class*="banner"], [class*="announcement"], [role="banner"]').text();
  for (const rx of saleKeywords) {
    if (rx.test(bannerText)) signals.push(`text:${rx.source}`);
  }

  return { onSale: signals.length > 0, signals };
}

// ─── Results store ──────────────────────────────────────────────────────────
const results = [];
const failed  = []; // brands that need Playwright retry

// ─── Pass 1: Cheerio (static HTTP) ─────────────────────────────────────────
const cheerioTargets = BRANDS.filter(b => b.renderMode !== 'browser');

const cheerioCrawler = new CheerioCrawler({
  maxRequestsPerCrawl: cheerioTargets.length,
  maxConcurrency: 5,
  requestHandlerTimeoutSecs: 20,
  navigationTimeoutSecs: 15,

  // Realistic headers to reduce trivial blocks
  additionalMimeTypes: ['application/json'],
  preNavigationHooks: [
    async ({ request }) => {
      request.headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      };
    },
  ],

  async requestHandler({ request, $, response }) {
    const brand = request.userData.brand;
    const status = response.statusCode;

    if (status >= 400) {
      log.warning(`[Cheerio] ${brand.name} returned ${status} — queuing for browser`);
      failed.push(brand);
      return;
    }

    const html = $.html();
    const { onSale, signals } = detectSale(html, $, brand.selectors || []);

    // If no signals at all on a JS-heavy page, Cheerio may have got an empty shell
    // Heuristic: if the body text is < 500 chars, the page likely needs JS rendering
    const bodyText = $('body').text().trim();
    if (bodyText.length < 500 && !onSale) {
      log.info(`[Cheerio] ${brand.name} — thin HTML (${bodyText.length} chars), queuing for browser`);
      failed.push(brand);
      return;
    }

    log.info(`[Cheerio] ${brand.name} — onSale: ${onSale} | signals: ${signals.join(', ') || 'none'}`);
    results.push({
      id:        brand.id,
      name:      brand.name,
      url:       brand.url,
      onSale,
      signals,
      method:    'cheerio',
      scrapedAt: new Date().toISOString(),
      error:     null,
    });
  },

  failedRequestHandler({ request }) {
    const brand = request.userData.brand;
    log.warning(`[Cheerio] ${brand.name} failed — queuing for browser`);
    failed.push(brand);
  },
});

// Build request list for Cheerio pass
const cheerioRequests = cheerioTargets.map(brand => ({
  url:      brand.url,
  userData: { brand },
}));

// Also add brands flagged as browser-only straight to failed list
const browserOnlyBrands = BRANDS.filter(b => b.renderMode === 'browser');
failed.push(...browserOnlyBrands);

log.info(`Pass 1: Cheerio — ${cheerioTargets.length} brands`);
await cheerioCrawler.run(cheerioRequests);
log.info(`Pass 1 complete. ${results.length} resolved, ${failed.length} queued for browser`);

// ─── Pass 2: Playwright (full browser) ─────────────────────────────────────
if (failed.length > 0) {
  log.info(`Pass 2: Playwright — ${failed.length} brands`);

  const playwrightCrawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: failed.length,
    maxConcurrency: 2, // conservative — browser tabs are heavy
    requestHandlerTimeoutSecs: 45,
    navigationTimeoutSecs: 30,

    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      },
    },

    // Stealth: mask Playwright automation signals
    preNavigationHooks: [
      async ({ page }) => {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-GB,en;q=0.9',
        });
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          window.chrome = { runtime: {} };
        });
      },
    ],

    async requestHandler({ request, page }) {
      const brand = request.userData.brand;

      // Wait for meaningful content
      await page.waitForLoadState('domcontentloaded');

      // Give JS-rendered content a moment to settle
      await page.waitForTimeout(1500);

      const html = await page.content();

      // Use Cheerio on the rendered HTML for consistent detection logic
      const { load } = await import('cheerio');
      const $ = load(html);
      const { onSale, signals } = detectSale(html, $, brand.selectors || []);

      log.info(`[Playwright] ${brand.name} — onSale: ${onSale} | signals: ${signals.join(', ') || 'none'}`);
      results.push({
        id:        brand.id,
        name:      brand.name,
        url:       brand.url,
        onSale,
        signals,
        method:    'playwright',
        scrapedAt: new Date().toISOString(),
        error:     null,
      });
    },

    failedRequestHandler({ request }) {
      const brand = request.userData.brand;
      log.error(`[Playwright] ${brand.name} failed after retries`);
      results.push({
        id:        brand.id,
        name:      brand.name,
        url:       brand.url,
        onSale:    null,
        signals:   [],
        method:    'playwright',
        scrapedAt: new Date().toISOString(),
        error:     'scrape_failed',
      });
    },
  });

  const playwrightRequests = failed.map(brand => ({
    url:      brand.url,
    userData: { brand },
  }));

  await playwrightCrawler.run(playwrightRequests);
}

// ─── Output ─────────────────────────────────────────────────────────────────
// Sort results back into original brand order
const brandOrder = BRANDS.reduce((acc, b, i) => { acc[b.id] = i; return acc; }, {});
results.sort((a, b) => brandOrder[a.id] - brandOrder[b.id]);

mkdirSync('./results', { recursive: true });
writeFileSync('./results/scores.json', JSON.stringify(results, null, 2));

const successCount = results.filter(r => r.error === null).length;
const saleCount    = results.filter(r => r.onSale === true).length;

log.info(`─── Run complete ───────────────────────────────`);
log.info(`Total brands:    ${results.length}`);
log.info(`Scraped OK:      ${successCount}`);
log.info(`On sale today:   ${saleCount}`);
log.info(`Failed:          ${results.length - successCount}`);
log.info(`Results written: ./results/scores.json`);

// Push to Google Sheets
try {
  await pushToSheets(results);
  log.info('Google Sheets updated.');
} catch (err) {
  log.error(`Sheets push failed: ${err.message}`);
  // Don't throw — local JSON is the source of truth; Sheets is the sink
}
