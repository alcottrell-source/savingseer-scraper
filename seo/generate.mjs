// generate.mjs
// Build-time SEO page generator. Runs server-side (during `vercel build` or
// `node seo/generate.mjs`), so reading via supabase-js is fine here — the
// browser-only pgRead/pgUpsert rule applies to the GENERATED pages, not to this.
//
// Scope: ALL active centres that have a current Tide Score. Enforces "no data,
// no page": a centre needs a current Tide Score AND at least one present brand;
// a brand needs a centre_brands row (present=true). Centres failing that are
// skipped rather than shipped as thin/empty pages (which hurt SEO).
//
// Usage:
//   node seo/generate.mjs                      # live Supabase, write into repo root
//   node seo/generate.mjs --fixtures seo/fixtures.westquay.json --out .seo-sample
//
// Env (live mode): SUPABASE_URL, SUPABASE_SERVICE_KEY (read), SUPABASE_ANON_KEY
// (embedded in pages for the browser opt-in), SEO_ORIGIN (default https://tidego.co).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderBrandPage, renderBrandHub, renderCentreHub, renderBlogIndex, renderBlogPost, slugify, isOnSale } from './render.mjs';
import { buildBrandIndex, brandHasNationalPage } from './brand-index.mjs';
import { loadPosts } from './blog.mjs';
import { nextSaleWindow } from './next-sale-window.mjs';

const ORIGIN = process.env.SEO_ORIGIN || 'https://tidego.co';

// By default a build that can't produce any SEO pages FAILS (non-zero exit) so
// Vercel keeps the last good deploy live instead of shipping an empty site that
// 404s every already-indexed /centre/ page. Set SEO_ALLOW_EMPTY=1 to opt back
// into the old "ship anyway" behaviour (e.g. an intentional teardown).
const ALLOW_EMPTY = /^(1|true|yes)$/i.test(process.env.SEO_ALLOW_EMPTY || '');

// Public Supabase read credentials — the same anon key the live dashboard ships
// to browsers. The SEO generator only reads anon-readable reference data, so it
// can build with these and needs NO private key / Vercel config. Env vars
// override if present.
const PUBLIC_SUPABASE_URL = 'https://vrezzwadwzrmumjpdgge.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_qid8Ej6biCOmKLjLIY5DfA_nzJXmc9G';
const SUPABASE_URL = process.env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_ANON_KEY;

// Opening hours are NOT in the DB (see audit). Hardcoded per centre here.
// TODO(v2): confirm WestQuay hours / move to a small config table.
const CENTRE_HOURS = {
  'westquay-southampton': 'Mon–Fri 9am–8pm, Sat 9am–7pm, Sun 11am–5pm',
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadFromFixtures(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadCentreData(sb, centreRow) {
  const centreId = centreRow.id;

  const { data: scoreRows } = await sb.from('centre_seer_scores')
    .select('tide_score,verdict,trajectory,bluf,score_date')
    .eq('centre_id', centreId).order('score_date', { ascending: false }).limit(1);
  const score = scoreRows && scoreRows[0];

  const { data: cb } = await sb.from('centre_brands')
    .select('brand_id,present').eq('centre_id', centreId).eq('present', true);
  const brandIds = (cb || []).map(r => r.brand_id);

  // Skip the brand/sale/cycle reads entirely for a centre with no present
  // brands — an empty `.in('id', [])` is wasteful and the centre is skipped
  // downstream anyway.
  let brandRows = [], saleRows = [], cycleRows = [];
  if (brandIds.length) {
    ({ data: brandRows } = await sb.from('brands')
      .select('id,name,cluster,sale_url').in('id', brandIds));
    ({ data: saleRows } = await sb.from('brand_sale_events')
      .select('brand_id,last_verified_status,last_verified_date,active_cycle_id').in('brand_id', brandIds));
    // ALL cycles (not just the open one): closed cycles ARE the past-sale history
    // the brand pages render. The open cycle (end_date null) is the live episode.
    ({ data: cycleRows } = await sb.from('brand_sale_cycles')
      .select('brand_id,start_date,end_date,max_discount_pct,sale_type').in('brand_id', brandIds)
      .order('start_date', { ascending: false }));
  }

  return {
    centre: { slug: centreRow.id, name: centreRow.name },
    score,
    brands: brandRows || [],
    sales: saleRows || [],
    cycles: cycleRows || [],
  };
}

async function loadAllFromSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  // Read-only via the public anon key (RLS-protected). No private key needed.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: centres, error } = await sb.from('centres')
    .select('id,name,active').eq('active', true).order('id');
  if (error) throw new Error(error.message);
  if (!centres || !centres.length) throw new Error('no active centres found');

  // Sequential to stay gentle on the anon endpoint; dozens of centres at build
  // time is still fast.
  const out = [];
  for (const c of centres) out.push(await loadCentreData(sb, c));
  return out;
}

// ── Shaping ─────────────────────────────────────────────────────────────────
function shape(raw, today) {
  const saleByBrand = Object.fromEntries((raw.sales || []).map(s => [s.brand_id, s]));
  // All cycles per brand (newest-first); the open one (no end_date) is the live sale.
  const cyclesByBrand = {};
  for (const c of (raw.cycles || [])) (cyclesByBrand[c.brand_id] ||= []).push(c);

  const usedSlugs = new Set();
  const brands = (raw.brands || []).map(b => {
    let slug = slugify(b.name), n = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(b.name)}-${n++}`;
    usedSlugs.add(slug);
    const sale = saleByBrand[b.id] || null;
    const cyclesRaw = cyclesByBrand[b.id] || [];
    const open = cyclesRaw.find(c => !c.end_date) || null;
    const onSale = isOnSale(sale);
    return {
      id: b.id, name: b.name, slug, cluster: b.cluster, saleUrl: b.sale_url,
      sale, cycle: open ? { startDate: open.start_date, maxDiscountPct: open.max_discount_pct, saleType: open.sale_type } : null,
      cyclesRaw,
      onSale,
      // A brand earns its own page only if it has something unique to say:
      // a live sale, or at least one tracked past sale episode. A brand that's
      // off-sale with zero history would render a near-duplicate template (only
      // the brand + centre name differ), which Google flags "Crawled – currently
      // not indexed". Such brands stay on the centre hub roster but get no URL.
      hasPage: onSale || cyclesRaw.length > 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const s = raw.score || {};
  const centre = {
    slug: raw.centre.slug, name: raw.centre.name,
    tideScore: s.tide_score ?? 0, verdict: s.verdict || 'Quiet', trajectory: s.trajectory || 'FLAT',
    bluf: s.bluf || '', scoreDate: s.score_date || null,
  };
  return { centre, brands, hasScore: !!raw.score };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const fixtures = arg('--fixtures');
  const outDir = arg('--out') || '.';
  // today is passed explicitly into pure helpers (no hidden Date.now in them).
  const today = new Date();

  // If the data source can't be reached (missing build-time env vars, transient
  // DB error, etc.) we must NOT ship an empty site: doing so blanks the sitemap
  // and 404s every already-indexed /centre/ page at once. Fail the build instead
  // so Vercel keeps the last good deploy serving. SEO_ALLOW_EMPTY=1 restores the
  // old "warn and ship anyway" behaviour.
  let rawList;
  try {
    rawList = fixtures ? [await loadFromFixtures(fixtures)] : await loadAllFromSupabase();
  } catch (e) {
    console.error(`[seo] ERROR: could not load data (${e.message}).`);
    console.error('[seo] Check SUPABASE_URL / SUPABASE_ANON_KEY are available to the BUILD step in Vercel.');
    if (ALLOW_EMPTY) {
      console.error('[seo] SEO_ALLOW_EMPTY set — shipping the site WITHOUT SEO pages (exit 0).');
      process.exit(0);
    }
    console.error('[seo] FAILING THE BUILD so Vercel keeps the last good deploy live and the');
    console.error('[seo] already-indexed /centre/ pages do NOT all start returning 404.');
    console.error('[seo] (Set SEO_ALLOW_EMPTY=1 to ship without SEO pages anyway.)');
    process.exit(1);
  }

  const supabase = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
  const buildDay = today.toISOString().slice(0, 10);
  const urls = [];
  const centresBySlug = {}; // slug -> { name }, for resolving blog relatedCentres
  let centreCount = 0, skipped = 0, brandPagesSkipped = 0;

  // Latest sane YYYY-MM-DD from the candidates, falling back to the build day so
  // every <url> still gets a <lastmod> even when a centre/brand has no date.
  function lastmodFrom(...candidates) {
    const days = candidates.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map(d => d.slice(0, 10));
    return days.length ? days.sort().at(-1) : buildDay;
  }

  // Replace the marker block in index.html with real centre-hub anchors so the
  // homepage's static HTML links every generated /centre/ page. Escapes names,
  // sorts alphabetically, and leaves the file untouched if markers are missing.
  async function injectHomepageCentreLinks(dir, centres) {
    const START = '<!-- SEO:CENTRE_LINKS:START -->';
    const END = '<!-- SEO:CENTRE_LINKS:END -->';
    const file = join(dir, 'index.html');
    let html;
    try { html = await readFile(file, 'utf8'); } catch { return; } // sample builds have no homepage
    const a = html.indexOf(START), b = html.indexOf(END);
    if (a < 0 || b < 0 || b < a) { console.error('[seo] WARNING: CENTRE_LINKS markers missing in index.html — homepage keeps no centre links.'); return; }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const links = centres.slice().sort((x, y) => x.name.localeCompare(y.name))
      .map(c => `<a href="/centre/${c.slug}">${esc(c.name)} sales</a>`).join('\n    ');
    const block = `${START}\n  <nav class="footer-centres" aria-label="Centres we track">\n    ${links}\n  </nav>\n  ${END}`;
    await writeFile(file, html.slice(0, a) + block + html.slice(b + END.length), 'utf8');
    console.log(`[seo] homepage: injected ${centres.length} centre-hub links into index.html.`);
  }

  async function emit(relPath, html, lastmod) {
    const full = join(outDir, relPath, 'index.html');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, html, 'utf8');
    urls.push({ loc: `${ORIGIN}/${relPath}`, lastmod: lastmod || buildDay });
  }

  // Shape everything first so the national brand index (below) sees the same
  // per-centre data — including the per-centre child slugs — the pages use.
  const shapedAll = rawList.map(raw => shape(raw, today));
  const generatedShaped = []; // centres that passed the no-data gate

  // The national brand index must exist BEFORE the centre loop so child pages
  // can link up to their /brand/ parent. Built from gate-passing centres only,
  // so every centre link on a /brand/ page points at an emitted child page.
  for (const s of shapedAll) {
    if (s.hasScore && s.brands.length) generatedShaped.push(s);
  }
  const brandIndex = buildBrandIndex(generatedShaped);
  const nationalBrands = brandIndex.filter(brandHasNationalPage);
  const hubSlugByBrandId = new Map(nationalBrands.map(b => [b.id, b.slug]));

  for (const { centre, brands, hasScore } of shapedAll) {
    // NO DATA, NO PAGE: a centre with no current Tide Score, or no tracked
    // brands, can't answer the question — skip it rather than ship thin pages.
    if (!hasScore || !brands.length) {
      console.error(`[seo] ${centre.slug}: skipping (no data, no page — ${!hasScore ? 'no Tide Score' : 'no tracked brands'}).`);
      skipped++;
      continue;
    }

    const hours = CENTRE_HOURS[centre.slug] || null;

    // Only brands with a live sale or tracked history get their own URL (see
    // `hasPage` in shape()). The hub still lists every tracked brand — skipped
    // ones render as plain text there, never as links to a page that 404s.
    const pageBrands = brands.filter(b => b.hasPage);
    const thinSkipped = brands.length - pageBrands.length;

    // Centre hub — freshness = the centre's score date.
    await emit(`centre/${centre.slug}`, renderCentreHub({ centre, brands, hours, supabase, origin: ORIGIN, today }),
      lastmodFrom(centre.scoreDate));

    // Brand × centre pages (the workhorse) — freshness = newest of the brand's
    // last verified date and the centre score date. Siblings link only to other
    // brands that also have a page, so "Other shops" never points at a 404.
    for (const b of pageBrands) {
      const siblings = pageBrands.filter(x => x.slug !== b.slug).map(x => ({ slug: x.slug, name: x.name, onSale: x.onSale }));
      await emit(`centre/${centre.slug}/${b.slug}`,
        renderBrandPage({ centre, brand: b, sale: b.sale, cycle: b.cycle, hours, siblings, supabase, origin: ORIGIN, today,
          brandHubSlug: hubSlugByBrandId.get(b.id) || null }),
        lastmodFrom(centre.scoreDate, b.sale && b.sale.last_verified_date));
    }
    centresBySlug[centre.slug] = { name: centre.name };
    centreCount++;
    brandPagesSkipped += thinSkipped;
    console.log(`[seo] ${centre.slug}: ${1 + pageBrands.length} pages (Tide Score ${centre.tideScore}, ${centre.verdict})${thinSkipped ? `, ${thinSkipped} thin brand page${thinSkipped === 1 ? '' : 's'} skipped` : ''}.`);
  }

  // Homepage internal links: inject crawlable <a href="/centre/<slug>"> links
  // into index.html's static footer (between the SEO:CENTRE_LINKS markers).
  // The homepage is the domain's highest-authority URL and its centre <select>
  // options are not anchors — without this, the /centre/ hubs are reachable
  // only via the sitemap and a couple of blog posts. Runs on the build copy of
  // index.html (Vercel), so the repo file itself keeps an empty marker block;
  // skipped harmlessly when index.html isn't in outDir (fixture/sample builds).
  await injectHomepageCentreLinks(outDir,
    Object.entries(centresBySlug).map(([slug, { name }]) => ({ slug, name })));

  // National /brand/ pages — the brand-only head query ("when does {brand} go
  // on sale?"). Same thin-page rule as the children; freshness = newest of the
  // brand's last-verified date and its latest cycle activity.
  for (const b of nationalBrands) {
    const newest = (b.cyclesRaw && b.cyclesRaw[0]) || null;
    await emit(`brand/${b.slug}`, renderBrandHub({ brand: b, supabase, origin: ORIGIN, today }),
      lastmodFrom(b.sale && b.sale.last_verified_date, newest && newest.end_date, newest && newest.start_date));
  }
  if (nationalBrands.length) console.log(`[seo] brand: ${nationalBrands.length} national brand page(s).`);

  // Guard: 0 pages means the data load succeeded but every centre was skipped
  // (no score / no present brands), or RLS silently returned nothing. Writing
  // the empty sitemap now would de-index every live /centre/ page, so fail the
  // build and keep the last good deploy — unless SEO_ALLOW_EMPTY says otherwise.
  if (!urls.length && !ALLOW_EMPTY) {
    console.error('[seo] ERROR: 0 pages generated — every centre was skipped or returned no data.');
    console.error('[seo] Refusing to overwrite sitemap.xml with an empty one and de-index every');
    console.error('[seo] live /centre/ page. FAILING THE BUILD so the last good deploy stays up.');
    console.error('[seo] (Set SEO_ALLOW_EMPTY=1 if a genuinely empty site is intended.)');
    process.exit(1);
  }

  // Blog (hand-written Markdown posts). Emitted AFTER the 0-pages guard above so
  // that guard stays keyed on CENTRE output — the blog index always emits (even
  // empty), which would otherwise mask a Supabase outage and de-index every
  // /centre/ page. Routed through emit() so /blog and /blog/<slug> land in the
  // sitemap automatically. relatedCentres resolve only against centres actually
  // generated this run (centresBySlug).
  const posts = await loadPosts(join('seo', 'blog'), { centresBySlug });
  await emit('blog', renderBlogIndex(posts, { origin: ORIGIN, supabase }));
  for (const post of posts) {
    const siblings = posts.filter(p => p.slug !== post.slug);
    await emit(`blog/${post.slug}`, renderBlogPost(post, { origin: ORIGIN, supabase, siblings }));
  }
  console.log(`[seo] blog: ${posts.length} post(s) + index.`);

  // Sitemap (every generated page, across all centres). Ensure outDir exists
  // even if every centre was skipped, so the sitemap write never ENOENTs.
  await mkdir(outDir, { recursive: true });
  // Homepage first — the dynamic app at / carries its own canonical/description
  // and is the entry point, so it belongs in the sitemap alongside the /centre/
  // pages (which are the only URLs collected in `urls` during page emit).
  urls.unshift({ loc: `${ORIGIN}/`, lastmod: buildDay });
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') + `\n</urlset>\n`;
  await writeFile(join(outDir, 'sitemap.xml'), sitemap, 'utf8');

  const w = nextSaleWindow(today);
  console.log(`[seo] Generated ${urls.length} pages across ${centreCount} centre(s) (${skipped} centre(s) skipped, ${brandPagesSkipped} thin brand page(s) skipped).`);
  console.log(`[seo] Next sale window: ${w ? w.label + ' ' + w.approx : 'n/a'}`);
  console.log(`[seo] Sitemap: ${join(outDir, 'sitemap.xml')} (${urls.length} urls)`);
}

main().catch(e => {
  // An unexpected crash mid-build can leave a partial/inconsistent page set, so
  // fail the build (Vercel keeps the last good deploy) rather than silently
  // shipping it. SEO_ALLOW_EMPTY=1 restores the old "ship anyway" behaviour.
  console.error('[seo] ERROR: SEO generation failed unexpectedly:', e.message);
  if (ALLOW_EMPTY) {
    console.error('[seo] SEO_ALLOW_EMPTY set — exiting 0 so the rest of the site still deploys.');
    process.exit(0);
  }
  console.error('[seo] Failing the build so Vercel keeps the last good deploy (avoids mass 404s).');
  process.exit(1);
});
