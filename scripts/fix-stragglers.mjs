// Remediation: re-fetch the three centres that ended up LOW after the main
// run by fixing the Wikipedia URL slugs (capitalisation matters) and replacing
// the junk-only file with a clean Wikipedia-derived list.
//
// Targets: idx 16 (Eldon Square), idx 20 (Queensgate), idx 28 (Silverburn).

import fs from 'fs/promises';
import { execSync } from 'child_process';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TARGETS = [
  { idx: 16, name: 'Eldon Square', wiki: 'https://en.wikipedia.org/wiki/Eldon_Square_Shopping_Centre' },
  { idx: 20, name: 'Queensgate',   wiki: 'https://en.wikipedia.org/wiki/Queensgate_Peterborough' },
  { idx: 28, name: 'Silverburn',   wiki: 'https://en.wikipedia.org/wiki/Silverburn_Shopping_Centre' },
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
  // Wikipedia chrome
  'article wizard','autoconfirmed','case sensitive','commons','redirect',
  'request a new article','sister projects','try the purge function',
  'wikibooks','wikidata','wikiquote','wikisource','wikispecies','wikiversity',
  'wikivoyage','wiktionary','wikipedia','main page','contents','current events',
  'random article','about wikipedia','contact us','donate','what links here',
  'related changes','upload file','permanent link','page information','cite this page',
  'wikidata item','printable version','download as pdf','create account','jump to navigation',
  'jump to search','disambiguation','look for pages within wikipedia that link to this title',
  // Geographic / unrelated boilerplate
  'edit','view history','talk','read','project page','file','special pages','category',
]);

function cleanName(s) {
  if (!s) return null;
  let t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/^[•‣◦\-\*\d\.\)\(]+\s+/, '').trim();
  if (t.length < 2 || t.length > 60) return null;
  const lower = t.toLowerCase();
  if (NAV_NOISE.has(lower)) return null;
  if (!/[a-zA-Z]/.test(t)) return null;
  if (t.endsWith(':')) return null;
  if (/\b(the|and|or|with|please|click|here)\b/i.test(t) && t.split(/\s+/).length > 5) return null;
  // Drop "X (page does not exist)" / "X (disambiguation)" etc — keep base name
  t = t.replace(/\s*\((page does not exist|disambiguation|retailer|company|brand|store|shop)\)\s*$/i, '').trim();
  if (!t) return null;
  return t;
}

function extractWikiNames(html) {
  const out = new Set();
  const start = html.indexOf('mw-parser-output');
  const end = html.indexOf('printfooter');
  const body = start >= 0 ? html.slice(start, end > 0 ? end : undefined) : html;

  // Anchors with title attribute (typical wiki internal links — brand names)
  const re = /<a\s+[^>]*title="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const title = m[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
    const text = m[2].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
    if (title.length < 60 && text.length < 60) {
      if (/^\d+$/.test(text)) continue;
      if (/^\[/.test(text)) continue;
      out.add(text);
    }
  }
  // Plain <li> entries
  const liRe = /<li[^>]*>([^<]{2,60})<\/li>/g;
  while ((m = liRe.exec(body)) !== null) out.add(m[1].trim());
  // Table cell text
  const tdRe = /<td[^>]*>\s*([^<\n]{2,60})\s*<\/td>/g;
  while ((m = tdRe.exec(body)) !== null) out.add(m[1].trim());
  return Array.from(out);
}

function fetchHtml(url) {
  return execSync(`curl -sL --max-time 25 -A '${UA}' '${url}'`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

async function main() {
  for (const t of TARGETS) {
    const html = fetchHtml(t.wiki);
    const raw = extractWikiNames(html);
    const cleaned = [...new Set(raw.map(cleanName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const padded = String(t.idx).padStart(2, '0');
    await fs.writeFile(
      `/tmp/centre-${padded}.txt`,
      `# ${t.name}\n# source: ${t.wiki}\n# count: ${cleaned.length}\n` + cleaned.join('\n') + '\n'
    );
    console.log(`${t.idx} ${t.name}: ${cleaned.length} names from ${t.wiki}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
