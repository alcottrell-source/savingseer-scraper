// Targeted fetch for 15 specific centres. For each centre we try a list of
// candidate URLs in Playwright, then fall back to Wikipedia via curl-extract
// if the live site can't yield names.
//
// Writes /tmp/centre-NN.txt with the merged result.

import { chromium } from 'playwright';
import fs from 'fs/promises';
import { execSync } from 'child_process';

const CONC = 4;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SEARCH_PAGES = (origin, n=10) => Array.from({length: n}, (_, i) => `${origin}/search?page=${i+1}&type=shop`);

const CENTRES = [
  { idx: 5,  name: 'Metrocentre', urls: [
      'https://www.metrocentre.co.uk/stores',
      'https://www.metrocentre.co.uk/directory',
      'https://www.metrocentre.co.uk/',
      ...SEARCH_PAGES('https://www.metrocentre.co.uk'),
    ], wiki: 'https://en.wikipedia.org/wiki/Metrocentre' },

  { idx: 6,  name: 'Bluewater', urls: [
      'https://www.bluewater.co.uk/stores',
      'https://www.bluewater.co.uk/store-directory',
      'https://www.bluewater.co.uk/shop',
      'https://www.bluewater.co.uk/shops',
      ...SEARCH_PAGES('https://www.bluewater.co.uk', 15),
      'https://www.bluewater.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Bluewater_(shopping_centre)' },

  // Manchester Arndale (idx 13) skipped — file already has 467 names from previous run.

  { idx: 16, name: 'Eldon Square', urls: [
      'https://www.eldonsquare.co.uk/stores',
      'https://www.eldonsquare.co.uk/shops',
      'https://www.eldonsquare.co.uk/directory',
      ...SEARCH_PAGES('https://www.eldonsquare.co.uk'),
      'https://www.eldonsquare.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Eldon_Square_shopping_centre' },

  { idx: 19, name: 'Friars Walk', urls: [
      'https://friarswalknewport.co.uk/stores/',
      'https://www.friarswalknewport.co.uk/stores',
      'https://www.friarswalknewport.co.uk/shops',
    ], wiki: 'https://en.wikipedia.org/wiki/Friars_Walk,_Newport' },

  { idx: 20, name: 'Queensgate', urls: [
      'https://www.queensgate-shopping.co.uk/stores',
      'https://www.queensgate-shopping.co.uk/shops',
      'https://www.queensgate-shopping.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Queensgate_Shopping_Centre', longWait: true },

  { idx: 21, name: 'Broadmead', urls: [
      'https://www.bristolshoppingquarter.co.uk/shops',
      'https://www.bristolshoppingquarter.co.uk/stores',
      'https://www.bristolshoppingquarter.co.uk/',
      'https://www.broadmead.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Broadmead' },

  { idx: 22, name: 'Highcross', urls: [
      'https://www.highcrossleicester.com/stores',
      'https://www.highcrossleicester.com/shops',
      'https://www.highcrossleicester.com/directory',
      ...SEARCH_PAGES('https://www.highcrossleicester.com'),
      'https://www.highcrossleicester.com/',
    ], wiki: 'https://en.wikipedia.org/wiki/Highcross_Leicester' },

  { idx: 23, name: 'Touchwood', urls: [
      'https://www.touchwoodsolihull.co.uk/stores',
      'https://www.touchwoodsolihull.co.uk/shops',
      'https://www.touchwoodsolihull.co.uk/directory',
      ...SEARCH_PAGES('https://www.touchwoodsolihull.co.uk'),
      'https://www.touchwoodsolihull.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Touchwood_(shopping_centre)' },

  { idx: 24, name: 'Bentall Centre', urls: [
      'https://www.thebentallcentre.com/stores',
      'https://www.thebentallcentre.com/shops',
      'https://www.thebentallcentre.com/',
      'https://bentall-centre.com/',
      'https://www.bentallkingston.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Bentalls' },

  { idx: 25, name: 'White Rose', urls: [
      'https://www.white-rose.co.uk/stores',
      'https://www.white-rose.co.uk/store-directory',
      'https://www.white-rose.co.uk/shops',
      ...SEARCH_PAGES('https://www.white-rose.co.uk', 15),
      'https://www.white-rose.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/White_Rose_Shopping_Centre' },

  { idx: 26, name: 'Cribbs Causeway', urls: [
      'https://www.cribbscauseway.com/stores',
      'https://www.cribbscauseway.com/shop',
      'https://www.cribbscauseway.com/shops',
      'https://www.cribbscauseway.com/',
      ...SEARCH_PAGES('https://www.cribbscauseway.com'),
    ], wiki: 'https://en.wikipedia.org/wiki/The_Mall_at_Cribbs_Causeway' },

  { idx: 27, name: 'Braehead', urls: [
      'https://www.braehead.co.uk/stores',
      'https://www.braehead.co.uk/shopping',
      'https://www.braehead.co.uk/directory',
      'https://www.braehead.co.uk/search-results/?type=shop',
      ...SEARCH_PAGES('https://www.braehead.co.uk'),
      'https://www.braehead.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Braehead_Shopping_Centre' },

  { idx: 28, name: 'Silverburn', urls: [
      'https://www.silverburnshopping.com/stores',
      'https://www.silverburnshopping.com/shops',
      'https://www.silverburnshopping.com/',
      'https://silverburn.com/',
      'https://silverburnshopping.co.uk/',
    ], wiki: 'https://en.wikipedia.org/wiki/Silverburn,_Glasgow' },

  { idx: 29, name: 'St James Quarter', urls: [
      'https://www.stjamesquarter.com/stores',
      'https://www.stjamesquarter.com/shops',
      'https://www.stjamesquarter.com/directory',
      'https://www.stjamesquarter.com/retailers',
      ...SEARCH_PAGES('https://www.stjamesquarter.com'),
      'https://www.stjamesquarter.com/',
    ], wiki: 'https://en.wikipedia.org/wiki/St_James_Quarter' },
];

const NAV_NOISE = new Set([
  'home','menu','search','sign in','register','close','toggle','next','previous',
  'skip to','cookies','accept','cookie settings','view all','load more','show more',
  'about','about us','contact','contact us','careers','jobs','privacy','privacy policy',
  'terms','terms & conditions','help','faq','faqs','newsletter','subscribe','sign up',
  'log in','login','log out','my account','account','basket','cart','wishlist',
  'directions','opening times','opening hours','parking','centre map','centre info',
  'gift card','gift cards','gift vouchers','offers','events','news','blog','press',
  'whats on',"what's on",'eat & drink','food & drink','dining','shopping','restaurants',
  'shop','stores','directory','retailers','brands','english','select language',
  'twitter','facebook','instagram','tiktok','youtube','linkedin','snapchat','pinterest',
  'main menu','close menu','back','more','all','filter','filters','sort','reset',
  'cookie preferences','manage cookies','reject all','allow all','accept all',
  'view more','see all','show all','show less','read more','read less','toggle menu',
  'apply','submit','search stores','close search','toggle navigation','toggle search',
  'open navigation','close navigation','book','book now','find out more','learn more',
  'find a store','find store','our story','sustainability','community','centre',
  'visit us','plan your visit','getting here','transport','centre information',
  'leasing','commercial','press releases','media','app','download','download our app',
  'all stores','all shops','all brands','accessibility','sitemap','legal','disclaimer',
  'cookies policy','language','en','uk','english (uk)','select','close popup','dismiss',
]);

function cleanName(s) {
  if (!s) return null;
  let t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Strip leading bullets/numbers
  t = t.replace(/^[•‣◦\-\*\d\.\)\(]+\s+/, '').trim();
  if (t.length < 2 || t.length > 60) return null;
  const lower = t.toLowerCase();
  if (NAV_NOISE.has(lower)) return null;
  // Drop pure punctuation / single chars
  if (!/[a-zA-Z]/.test(t)) return null;
  // Drop strings ending in colon (e.g. "Categories:")
  if (t.endsWith(':')) return null;
  // Drop sentences (multiple spaces with stopwords like "the", "and", "with")
  if (/\b(the|and|or|with|please|click|here)\b/i.test(t) && t.split(/\s+/).length > 5) return null;
  return t;
}

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

async function clickLoadMore(page, maxClicks = 12) {
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

async function extractCandidateNames(page) {
  return await page.evaluate(() => {
    const out = new Set();
    const push = s => {
      if (!s) return;
      const t = s.replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 80) return;
      out.add(t);
    };
    document.querySelectorAll(
      'a, h1, h2, h3, h4, ' +
      '[class*="store" i] [class*="name" i], [class*="shop" i] [class*="name" i], ' +
      '[class*="brand" i] [class*="name" i], [class*="card" i] h2, ' +
      '[class*="card" i] h3, [class*="tile" i] h2, [class*="tile" i] h3, ' +
      '[class*="retailer" i] h2, [class*="retailer" i] h3, [class*="retailer" i] a, ' +
      'li > a, [class*="logo" i] img[alt], img[alt]'
    ).forEach(el => {
      if (el.tagName === 'IMG') {
        const alt = el.getAttribute('alt') || '';
        if (alt && alt.length < 60) push(alt);
        return;
      }
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt.length > 80) return;
      push(txt);
    });
    return Array.from(out);
  });
}

async function trySite(page, url, extraHeaders) {
  try {
    if (extraHeaders) await page.setExtraHTTPHeaders(extraHeaders);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    if (!resp) return { ok: false, names: [], reason: 'no response' };
    const status = resp.status();
    if (status >= 400) return { ok: false, names: [], reason: `HTTP ${status}`, status };
    await page.waitForTimeout(1800);
    await dismissCookies(page);
    await page.waitForTimeout(700);
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(800);
    await autoScroll(page);
    await page.waitForTimeout(700);
    await clickLoadMore(page, 6);
    await autoScroll(page);
    await page.waitForTimeout(500);
    const names = await extractCandidateNames(page);
    return { ok: true, names, reason: 'ok', finalUrl: page.url(), status };
  } catch (e) {
    return { ok: false, names: [], reason: e.message.split('\n')[0].slice(0, 120) };
  }
}

// Wikipedia fallback: pull article HTML and harvest <a> titles inside the
// article body. Also pick up list items / table cells that look like brand names.
function extractWikiNames(html) {
  const out = new Set();
  // Limit to content area
  const start = html.indexOf('mw-parser-output');
  const end = html.indexOf('printfooter');
  const body = start >= 0 ? html.slice(start, end > 0 ? end : undefined) : html;

  // Pull anchor titles (these are real Wikipedia entries — typically brand pages)
  const re = /<a\s+[^>]*title="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const title = m[1].trim();
    const text = m[2].trim();
    // Prefer text (visible) unless it's an abbreviation; both are usually equal.
    if (title.length < 60 && text.length < 60) {
      // Skip references / external link markers
      if (/^\d+$/.test(text)) continue;
      if (/^\[/.test(text)) continue;
      out.add(text);
    }
  }

  // Pull plain <li> entries inside the article (for "List of tenants" sections)
  const liRe = /<li>([^<]{2,60})<\/li>/g;
  while ((m = liRe.exec(body)) !== null) {
    out.add(m[1].trim());
  }
  return Array.from(out);
}

async function tryWikipedia(url) {
  try {
    const html = execSync(`curl -sL --max-time 20 -A '${UA}' '${url}'`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (!html || html.length < 500) return [];
    return extractWikiNames(html);
  } catch (e) {
    console.log(`  wiki fetch error: ${e.message.split('\n')[0]}`);
    return [];
  }
}

async function processCentre(browser, centre) {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const merged = new Set();
  let bestSrc = null;
  let lastUrl = null;
  let sawCaptcha = false;

  for (const url of centre.urls) {
    const r = await trySite(page, url, centre.extraHeaders);
    if (r.finalUrl && /captcha|sgcaptcha|cf-chl/i.test(r.finalUrl)) sawCaptcha = true;
    const before = merged.size;
    for (const raw of r.names) {
      const clean = cleanName(raw);
      if (clean) merged.add(clean);
    }
    const added = merged.size - before;
    console.log(`  [${centre.idx}] ${url} → ${r.reason} (added ${added}, total ${merged.size})`);
    if (added > 0) { bestSrc = bestSrc || (r.finalUrl || url); lastUrl = r.finalUrl || url; }
    if (url.includes('/search?page=') && added === 0 && merged.size > 0) break;
    // Early-exit: once we have plenty of names, stop trying alternative URLs
    if (merged.size >= 80 && !url.includes('/search?page=')) break;
  }

  // Wikipedia fallback if we didn't get enough
  let usedWiki = false;
  if (merged.size < 30 && centre.wiki) {
    console.log(`  [${centre.idx}] live yielded ${merged.size}; falling back to Wikipedia ${centre.wiki}`);
    const wikiNames = await tryWikipedia(centre.wiki);
    const before = merged.size;
    for (const raw of wikiNames) {
      const clean = cleanName(raw);
      if (clean) merged.add(clean);
    }
    const added = merged.size - before;
    console.log(`  [${centre.idx}] wiki added ${added}, total ${merged.size}`);
    if (added > 0) { usedWiki = true; bestSrc = bestSrc || centre.wiki; lastUrl = centre.wiki; }
  }

  await context.close();
  const padded = String(centre.idx).padStart(2, '0');
  const sorted = [...merged].sort((a, b) => a.localeCompare(b));
  await fs.writeFile(
    `/tmp/centre-${padded}.txt`,
    `# ${centre.name}\n# source: ${bestSrc || 'NONE'}\n# count: ${sorted.length}\n` + sorted.join('\n') + '\n'
  );
  return { idx: centre.idx, name: centre.name, count: sorted.length, source: bestSrc, usedWiki, sawCaptcha };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
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
        // Try a pure wiki fallback even if Playwright blew up
        let count = 0;
        let src = null;
        if (centre.wiki) {
          const names = (await tryWikipedia(centre.wiki)).map(cleanName).filter(Boolean);
          const uniq = [...new Set(names)].sort((a, b) => a.localeCompare(b));
          const padded = String(centre.idx).padStart(2, '0');
          await fs.writeFile(
            `/tmp/centre-${padded}.txt`,
            `# ${centre.name}\n# source: ${centre.wiki}\n# count: ${uniq.length}\n` + uniq.join('\n') + '\n'
          );
          count = uniq.length;
          src = centre.wiki;
        }
        results.push({ idx: centre.idx, name: centre.name, count, source: src, usedWiki: !!src });
      }
    }
  }
  await Promise.all(Array.from({length: CONC}, (_, i) => worker(i)));
  await browser.close();
  console.log('\n=== SUMMARY ===');
  results.sort((a, b) => a.idx - b.idx);
  for (const r of results) {
    const tag = r.count >= 30 ? 'OK' : (r.count > 0 ? 'LOW' : 'EMPTY');
    const via = r.usedWiki ? '[wiki]' : '[live]';
    console.log(`${String(r.idx).padStart(2)} ${r.name.padEnd(22)} ${String(r.count).padStart(4)} ${tag.padEnd(5)} ${via} from ${r.source || 'NONE'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
