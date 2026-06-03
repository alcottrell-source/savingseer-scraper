// generate.mjs
// Build-time SEO page generator. Runs server-side (during `vercel build` or
// `node seo/generate.mjs`), so reading via supabase-js is fine here — the
// browser-only pgRead/pgUpsert rule applies to the GENERATED pages, not to this.
//
// v1 scope: ONLY the centre with slug `westquay-southampton` and its present
// brands. Enforces "no data, no page": a centre needs a current Tide Score; a
// brand needs a centre_brands row (present=true).
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

const V1_CENTRE = 'westquay-southampton';
const ORIGIN = process.env.SEO_ORIGIN || 'https://tidego.co';

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

async function loadFromSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  const sb = createClient(url, key);

  const { data: centreRow } = await sb.from('centres')
    .select('id,name,active').eq('id', V1_CENTRE).single();
  if (!centreRow) throw new Error(`Centre ${V1_CENTRE} not found`);

  const { data: scoreRows } = await sb.from('centre_seer_scores')
    .select('tide_score,verdict,trajectory,bluf,score_date')
    .eq('centre_id', V1_CENTRE).order('score_date', { ascending: false }).limit(1);
  const score = scoreRows && scoreRows[0];

  const { data: cb } = await sb.from('centre_brands')
    .select('brand_id,present').eq('centre_id', V1_CENTRE).eq('present', true);
  const brandIds = (cb || []).map(r => r.brand_id);

  const { data: brandRows } = await sb.from('brands')
    .select('id,name,cluster,sale_url').in('id', brandIds);
  const { data: saleRows } = await sb.from('brand_sale_events')
    .select('brand_id,last_verified_status,last_verified_date,active_cycle_id').in('brand_id', brandIds);
  const { data: cycleRows } = await sb.from('brand_sale_cycles')
    .select('brand_id,start_date,end_date,max_discount_pct,sale_type').in('brand_id', brandIds).is('end_date', null);

  return {
    centre: { slug: centreRow.id, name: centreRow.name },
    score,
    brands: brandRows || [],
    sales: saleRows || [],
    cycles: cycleRows || [],
  };
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
  let raw;
  try {
    raw = fixtures ? await loadFromFixtures(fixtures) : await loadFromSupabase();
  } catch (e) {
    console.error(`[seo] WARNING: could not load data (${e.message}).`);
    console.error('[seo] Skipping SEO page generation — the rest of the site will still deploy.');
    console.error('[seo] If you expected pages, check SUPABASE_URL / SUPABASE_SERVICE_KEY are available to the BUILD step in Vercel.');
    process.exit(0);
  }
  const { centre, brands, hasScore } = shape(raw, today);

  // NO DATA, NO PAGE: a centre with no current Tide Score can't answer the
  // question — skip the whole centre rather than ship an empty page.
  if (!hasScore) {
    console.error(`[seo] ${centre.slug} has no Tide Score — skipping (no data, no page).`);
    process.exit(0);
  }

  const supabase = {
    url: process.env.SUPABASE_URL || raw.supabaseUrl || 'https://YOUR-PROJECT.supabase.co',
    anonKey: process.env.SUPABASE_ANON_KEY || raw.supabaseAnonKey || 'YOUR_ANON_KEY',
  };
  const hours = CENTRE_HOURS[centre.slug] || null;
  const urls = [];

  async function emit(relPath, html) {
    const full = join(outDir, relPath, 'index.html');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, html, 'utf8');
    urls.push(`${ORIGIN}/${relPath}`);
  }

  // Centre hub
  await emit(`centre/${centre.slug}`, renderCentreHub({ centre, brands, hours, supabase, origin: ORIGIN, today }));

  // Brand × centre pages (the workhorse)
  for (const b of brands) {
    const siblings = brands.filter(x => x.slug !== b.slug).map(x => ({ slug: x.slug, name: x.name, onSale: x.onSale }));
    await emit(`centre/${centre.slug}/${b.slug}`,
      renderBrandPage({ centre, brand: b, sale: b.sale, cycle: b.cycle, hours, siblings, supabase, origin: ORIGIN, today }));
  }

  // Sitemap
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>\n`;
  await writeFile(join(outDir, 'sitemap-seo.xml'), sitemap, 'utf8');

  const w = nextSaleWindow(today);
  console.log(`[seo] Generated ${urls.length} pages for ${centre.name} (Tide Score ${centre.tideScore}, verdict ${centre.verdict}).`);
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
