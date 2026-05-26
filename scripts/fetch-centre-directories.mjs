// Fetches the 30 centre directories using Playwright and extracts a list of
// retailer names from each. Saves results to /tmp/centre-NN.txt.
//
// Per centre we try a list of likely directory paths in series; the first one
// that yields >= a-threshold-of distinct candidate names wins. We auto-scroll
// to trigger lazy load and click "load more"-style buttons.
//
// Concurrency: processes up to CONC centres in parallel (separate browser
// contexts so cookies/state don't leak).

import { chromium } from 'playwright';
import fs from 'fs/promises';

const CONC = 4;

// Many centres run the same React CMS with paginated /search?page=N&type=shop
// (Bullring/Westquay/Bluewater/Meadowhall/Lakeside). For those, brand cards
// are loaded onto the URL itself — no further interaction needed.
const SEARCH_PAGE_TEMPLATE = (origin) => Array.from({length: 10}, (_, i) =>
  `${origin}/search?page=${i+1}&type=shop`);

const CENTRES = [
  { idx: 0,  name: 'Festival Place',      urls: [
      'https://www.festivalplace.co.uk/shopping',
      ...Array.from({length: 12}, (_,i) => `https://www.festivalplace.co.uk/shopping?page=${i+1}`),
    ] },
  { idx: 1,  name: 'Westquay',            urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.westquay.co.uk'),
      'https://www.westquay.co.uk/stores',
    ] },
  { idx: 2,  name: 'Westfield London',    urls: [
      'https://www.westfield.com/en/united-kingdom/london/retailers',
    ] },
  { idx: 3,  name: 'Westfield Stratford', urls: [
      'https://www.westfield.com/en/united-kingdom/stratfordcity/retailers',
    ] },
  { idx: 4,  name: 'Trafford Centre',     urls: ['https://www.traffordcentre.co.uk/directory'] },
  { idx: 5,  name: 'Metrocentre',         urls: [
      'https://www.metrocentre.co.uk/stores',
      'https://www.metrocentre.co.uk/directory',
      'https://www.metrocentre.co.uk/',
      ...SEARCH_PAGE_TEMPLATE('https://www.metrocentre.co.uk'),
    ] },
  { idx: 6,  name: 'Bluewater',           urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.bluewater.co.uk'),
      'https://www.bluewater.co.uk/stores',
    ] },
  { idx: 7,  name: 'Meadowhall',          urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.meadowhall.co.uk'),
      'https://www.meadowhall.co.uk/shops',
    ] },
  { idx: 8,  name: 'Bullring',            urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.bullring.co.uk'),
      'https://www.bullring.co.uk/stores',
    ] },
  { idx: 9,  name: 'Lakeside',            urls: [
      'https://lakeside-shopping.com/shop/',
      'https://www.lakeside-shopping.com/shop/',
      'https://lakeside-shopping.com/stores/',
    ] },
  { idx: 10, name: 'Liverpool ONE',       urls: [
      'https://www.liverpool-one.com/stores',
      'https://www.liverpool-one.com/shop',
      ...SEARCH_PAGE_TEMPLATE('https://www.liverpool-one.com'),
    ] },
  { idx: 11, name: "St David's",          urls: [
      'https://www.stdavidscardiff.com/shops',
      'https://www.stdavidscardiff.com/stores',
      ...SEARCH_PAGE_TEMPLATE('https://www.stdavidscardiff.com'),
    ] },
  { idx: 12, name: 'Cabot Circus',        urls: [
      'https://www.cabotcircus.com/stores',
      ...SEARCH_PAGE_TEMPLATE('https://www.cabotcircus.com'),
    ] },
  { idx: 13, name: 'Manchester Arndale',  urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.manchesterarndale.com'),
      'https://www.manchesterarndale.com/stores',
    ] },
  { idx: 14, name: 'Brent Cross',         urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.brentcross.co.uk'),
      'https://www.brentcross.co.uk/stores',
    ] },
  { idx: 15, name: 'Victoria Leeds',      urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.victorialeeds.co.uk'),
      'https://www.victorialeeds.co.uk/shops',
      'https://www.victorialeeds.co.uk/stores',
    ] },
  { idx: 16, name: 'Eldon Square',        urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.eldonsquare.co.uk'),
      'https://www.eldonsquare.co.uk/stores',
    ] },
  { idx: 17, name: 'The Oracle',          urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.theoracle.com'),
      'https://www.theoracle.com/stores',
    ] },
  { idx: 18, name: 'The Lexicon',         urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.thelexiconbracknell.com'),
      'https://www.thelexiconbracknell.com/stores',
    ] },
  { idx: 19, name: 'Friars Walk',         urls: [
      'https://www.friarswalknewport.co.uk/shops',
      'https://www.friarswalknewport.co.uk/stores',
      ...SEARCH_PAGE_TEMPLATE('https://www.friarswalknewport.co.uk'),
    ] },
  { idx: 20, name: 'Queensgate',          urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.queensgate-shopping.co.uk'),
      'https://www.queensgate-shopping.co.uk/stores',
    ] },
  { idx: 21, name: 'Broadmead',           urls: [
      'https://www.bristolshoppingquarter.co.uk/shops',
      'https://www.bristolshoppingquarter.co.uk/stores',
      'https://www.bristolshoppingquarter.co.uk/',
    ] },
  { idx: 22, name: 'Highcross',           urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.highcrossleicester.com'),
      'https://www.highcrossleicester.com/stores',
    ] },
  { idx: 23, name: 'Touchwood',           urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.touchwoodsolihull.co.uk'),
      'https://www.touchwoodsolihull.co.uk/stores',
    ] },
  { idx: 24, name: 'Bentall Centre',      urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.bentall-centre.co.uk'),
      'https://www.bentall-centre.co.uk/stores',
    ] },
  { idx: 25, name: 'White Rose',          urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.white-rose.co.uk'),
      'https://www.white-rose.co.uk/stores',
    ] },
  { idx: 26, name: 'Cribbs Causeway',     urls: [
      'https://www.cribbscauseway.com/stores',
      'https://www.cribbscauseway.com/shop',
      'https://www.cribbscauseway.com/shops',
      'https://www.cribbscauseway.com/',
      ...SEARCH_PAGE_TEMPLATE('https://www.cribbscauseway.com'),
    ] },
  { idx: 27, name: 'Braehead',            urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.braehead.co.uk'),
      'https://www.braehead.co.uk/stores',
      'https://www.braehead.co.uk/',
    ] },
  { idx: 28, name: 'Silverburn',          urls: [
      ...SEARCH_PAGE_TEMPLATE('https://www.silverburnshopping.com'),
      'https://www.silverburnshopping.com/stores',
    ] },
  { idx: 29, name: 'St James Quarter',    urls: [
      'https://www.stjamesquarter.com/stores',
      ...SEARCH_PAGE_TEMPLATE('https://www.stjamesquarter.com'),
    ] },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const t = setInterval(() => {
        window.scrollBy(0, 800);
        total += 800;
        if (total >= document.body.scrollHeight + 2000) {
          clearInterval(t);
          resolve();
        }
      }, 120);
    });
  });
}

async function clickLoadMore(page, maxClicks = 25) {
  for (let i = 0; i < maxClicks; i++) {
    const clicked = await page.evaluate(() => {
      const phrases = ['load more', 'show more', 'view all', 'see all', 'next page', 'load all', 'show all'];
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const e of els) {
        const t = (e.textContent || '').trim().toLowerCase();
        if (!t) continue;
        if (phrases.some(p => t === p || t.startsWith(p))) {
          if (e.offsetParent !== null) { e.click(); return true; }
        }
      }
      return false;
    });
    if (!clicked) break;
    await page.waitForTimeout(1200);
  }
}

async function extractCandidateNames(page) {
  return await page.evaluate(() => {
    const out = new Set();
    const push = s => {
      if (!s) return;
      const t = s.replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 60) return;
      if (/^(home|menu|search|sign in|register|close|toggle|next|previous|skip to|cookies|accept|cookie settings|view all|load more|show more)$/i.test(t)) return;
      out.add(t);
    };
    document.querySelectorAll(
      'a, h1, h2, h3, h4, ' +
      '[class*="store" i] [class*="name" i], [class*="shop" i] [class*="name" i], ' +
      '[class*="brand" i] [class*="name" i], [class*="card" i] h2, ' +
      '[class*="card" i] h3, [class*="tile" i] h2, [class*="tile" i] h3, ' +
      '[class*="retailer" i] h2, [class*="retailer" i] h3, [class*="retailer" i] a, ' +
      'li > a'
    ).forEach(el => {
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt.length > 80) return; // skip paragraph-like
      push(txt);
    });
    return Array.from(out);
  });
}

async function dismissCookies(page) {
  await page.evaluate(() => {
    const phrases = ['accept all', 'accept cookies', 'i accept', 'agree', 'allow all', 'accept'];
    const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const e of els) {
      const t = (e.textContent || '').trim().toLowerCase();
      if (phrases.includes(t)) { try { e.click(); } catch {} ; break; }
    }
  });
}

async function trySite(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp) return { ok: false, names: [], reason: 'no response' };
    if (resp.status() >= 400) return { ok: false, names: [], reason: `HTTP ${resp.status()}` };
    await page.waitForTimeout(1500);
    await dismissCookies(page);
    await page.waitForTimeout(800);
    await autoScroll(page);
    await page.waitForTimeout(800);
    await clickLoadMore(page, 8);
    await autoScroll(page);
    await page.waitForTimeout(500);
    const names = await extractCandidateNames(page);
    return { ok: true, names, reason: 'ok', finalUrl: page.url() };
  } catch (e) {
    return { ok: false, names: [], reason: e.message.split('\n')[0].slice(0, 120) };
  }
}

async function processCentre(browser, centre) {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // Accumulate across all attempted URLs so paginated CMSes (Bullring's
  // /search?page=N&type=shop) merge the union of every visited page.
  const merged = new Set();
  let bestSrc = null;
  let lastUrl = null;
  for (const url of centre.urls) {
    const r = await trySite(page, url);
    const before = merged.size;
    for (const n of r.names) merged.add(n);
    const added = merged.size - before;
    console.log(`  [${centre.idx}] ${url} → ${r.reason} (added ${added}, total ${merged.size})`);
    if (added > 0) { bestSrc = bestSrc || (r.finalUrl || url); lastUrl = r.finalUrl || url; }
    // For paginated /search endpoints, once a page adds zero new entries it's
    // typically because we paged past the end — bail out.
    if (url.includes('/search?page=') && added === 0 && merged.size > 0) break;
  }
  await context.close();
  const padded = String(centre.idx).padStart(2, '0');
  const sorted = [...merged].sort((a, b) => a.localeCompare(b));
  await fs.writeFile(
    `/tmp/centre-${padded}.txt`,
    `# ${centre.name}\n# source: ${bestSrc || 'NONE'}\n# last_url: ${lastUrl || 'NONE'}\n# count: ${sorted.length}\n` + sorted.join('\n') + '\n'
  );
  return { idx: centre.idx, name: centre.name, count: sorted.length, source: bestSrc };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const queue = [...CENTRES];
  const results = [];
  async function worker(id) {
    while (queue.length) {
      const centre = queue.shift();
      if (!centre) return;
      console.log(`\n=== [w${id}] ${centre.idx} ${centre.name} ===`);
      try {
        const r = await processCentre(browser, centre);
        results.push(r);
      } catch (e) {
        console.log(`  [${centre.idx}] FATAL ${e.message}`);
        results.push({ idx: centre.idx, name: centre.name, count: 0, source: null });
      }
    }
  }
  await Promise.all(Array.from({length: CONC}, (_, i) => worker(i)));
  await browser.close();
  console.log('\n=== SUMMARY ===');
  results.sort((a, b) => a.idx - b.idx);
  for (const r of results) console.log(`${String(r.idx).padStart(2)} ${r.name.padEnd(22)} ${String(r.count).padStart(4)} from ${r.source || 'NONE'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
