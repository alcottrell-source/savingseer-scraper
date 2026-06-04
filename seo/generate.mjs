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
import { renderBrandPage, renderCentreHub, slugify, isOnSale } from './render.mjs';
import { nextSaleWindow } from './next-sale-window.mjs';

const ORIGIN = process.env.SEO_ORIGIN || 'https://tidego.co';

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
    ({ data: cycleRows } = await sb.from('brand_sale_cycles')
      .select('brand_id,start_date,end_date,max_discount_pct,sale_type').in('brand_id', brandIds).is('end_date', null));
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
  const cycleByBrand = Object.fromEntries((raw.cycles || []).map(c => [c.brand_id, c]));

  const usedSlugs = new Set();
  const brands = (raw.brands || []).map(b => {
    let slug = slugify(b.name), n = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(b.name)}-${n++}`;
    usedSlugs.add(slug);
    const sale = saleByBrand[b.id] || null;
    const cycle = cycleByBrand[b.id] || null;
    return {
      id: b.id, name: b.name, slug, cluster: b.cluster, saleUrl: b.sale_url,
      sale, cycle: cycle ? { startDate: cycle.start_date, maxDiscountPct: cycle.max_discount_pct, saleType: cycle.sale_type } : null,
      onSale: isOnSale(sale),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const s = raw.score || {};
  const centre = {
    slug: raw.centre.slug, name: raw.centre.name,
    tideScore: s.tide_score ?? 0, verdict: s.verdict || 'Quiet', trajectory: s.trajectory || 'FLAT',
    bluf: s.bluf || '',
  };
  return { centre, brands, hasScore: !!raw.score };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const fixtures = arg('--fixtures');
  const outDir = arg('--out') || '.';
  // today is passed explicitly into pure helpers (no hidden Date.now in them).
  const today = new Date();

  // The SEO generator must NEVER break the main site's deploy. If the data
  // source can't be reached (missing build-time env vars, transient DB error,
  // etc.), warn loudly and skip page generation with a success exit code so
  // the rest of the static site still ships.
  let rawList;
  try {
    rawList = fixtures ? [await loadFromFixtures(fixtures)] : await loadAllFromSupabase();
  } catch (e) {
    console.error(`[seo] WARNING: could not load data (${e.message}).`);
    console.error('[seo] Skipping SEO page generation — the rest of the site will still deploy.');
    console.error('[seo] If you expected pages, check SUPABASE_URL / SUPABASE_SERVICE_KEY are available to the BUILD step in Vercel.');
    process.exit(0);
  }

  const supabase = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
  const urls = [];
  let centreCount = 0, skipped = 0;

  async function emit(relPath, html) {
    const full = join(outDir, relPath, 'index.html');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, html, 'utf8');
    urls.push(`${ORIGIN}/${relPath}`);
  }

  for (const raw of rawList) {
    const { centre, brands, hasScore } = shape(raw, today);

    // NO DATA, NO PAGE: a centre with no current Tide Score, or no tracked
    // brands, can't answer the question — skip it rather than ship thin pages.
    if (!hasScore || !brands.length) {
      console.error(`[seo] ${centre.slug}: skipping (no data, no page — ${!hasScore ? 'no Tide Score' : 'no tracked brands'}).`);
      skipped++;
      continue;
    }

    const hours = CENTRE_HOURS[centre.slug] || null;

    // Centre hub
    await emit(`centre/${centre.slug}`, renderCentreHub({ centre, brands, hours, supabase, origin: ORIGIN, today }));

    // Brand × centre pages (the workhorse)
    for (const b of brands) {
      const siblings = brands.filter(x => x.slug !== b.slug).map(x => ({ slug: x.slug, name: x.name, onSale: x.onSale }));
      await emit(`centre/${centre.slug}/${b.slug}`,
        renderBrandPage({ centre, brand: b, sale: b.sale, cycle: b.cycle, hours, siblings, supabase, origin: ORIGIN, today }));
    }
    centreCount++;
    console.log(`[seo] ${centre.slug}: ${1 + brands.length} pages (Tide Score ${centre.tideScore}, ${centre.verdict}).`);
  }

  // Sitemap (every generated page, across all centres). Ensure outDir exists
  // even if every centre was skipped, so the sitemap write never ENOENTs.
  await mkdir(outDir, { recursive: true });
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>\n`;
  await writeFile(join(outDir, 'sitemap-seo.xml'), sitemap, 'utf8');

  const w = nextSaleWindow(today);
  console.log(`[seo] Generated ${urls.length} pages across ${centreCount} centre(s) (${skipped} skipped).`);
  console.log(`[seo] Next sale window: ${w ? w.label + ' ' + w.approx : 'n/a'}`);
  console.log(`[seo] Sitemap: ${join(outDir, 'sitemap-seo.xml')} (${urls.length} urls)`);
}

main().catch(e => {
  // Last-resort guard: never fail the whole site deploy because of the SEO
  // add-on. Log loudly (visible in Vercel build logs) and exit success.
  console.error('[seo] WARNING: SEO generation failed unexpectedly:', e.message);
  console.error('[seo] Skipping SEO pages — the rest of the site will still deploy.');
  process.exit(0);
});
