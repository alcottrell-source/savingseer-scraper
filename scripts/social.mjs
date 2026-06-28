#!/usr/bin/env node
// Tide — Instagram content generator.
//
// Renders branded 1080×1350 PNGs from LIVE tide data, on demand, so you can
// post when sales move. Three card types:
//
//   centres : "Today's Tide" — top shopping centres right now, ranked by
//             verdict severity then Tide Score (Peak > Rising > Easing > …).
//   peak    : "Go now" — only the centres currently at PEAK. Skipped (with a
//             note) when nothing is peaking, so you never post an empty board.
//   brands  : "Deepest discounts" — brands on sale now, ranked by max discount,
//             with how many centres each is on sale at.
//
// All three read the SAME columns the public site does (centre_seer_scores
// tide_score / verdict / brands_on_sale / total_brands; brand_sale_cycles
// max_discount_pct), so the images can't contradict the dashboard.
//
// Usage:
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//     node scripts/social.mjs [--type=all|centres|peak|brands] [--limit=8] [--out=social-out]
//
//   node scripts/social.mjs --demo        # render from built-in sample data,
//                                          # no DB / no service key needed.
//
// Output: PNGs in social-out/ (gitignored). Renders with Playwright/Chromium
// (already a dependency) so it reuses the brand fonts (Playfair + Inter).
// READ-ONLY against Supabase: only `select` queries, never a write.

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { brands } from '../brands.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const DEMO   = argv.includes('--demo');
const TYPE   = getArg('type', 'all');
const LIMIT  = Math.max(1, parseInt(getArg('limit', '6'), 10) || 6);
const OUTDIR = getArg('out', 'social-out');
const TODAY  = new Date().toISOString().split('T')[0];

// ── brand identity (mirrors index.html dark-vessel tokens) ──────────────────
const PALETTE = {
  ink:   '#0B0B0D',
  cream: '#F5F1EB',
  mute:  '#8A847C',
  neon:  '#5EFFB0',
  amber: '#FFD79A',   // PEAK / GO NOW
  rise:  '#9FD8B0',
  ease:  '#F4B79F',
};

// New + legacy verdict vocabulary → canonical word + sort severity.
// Mirrors HOT_VERDICT_SEVERITY in index.html / score.js.
const VERDICT_CANON = {
  Peak: 'Peak', Rising: 'Rising', Easing: 'Easing', Quiet: 'Quiet', Turning: 'Quiet', Over: 'Over',
  'Go now': 'Peak', 'Last chance': 'Easing', 'Last chance — tide going out': 'Easing',
  'Worth watching': 'Rising', 'Starting to build': 'Quiet', "It's over": 'Over', 'Nothing on': 'Quiet',
};
const SEVERITY = { Peak: 5, Rising: 4, Easing: 3, Quiet: 2, Over: 1 };
const accentFor = w => (w === 'Peak' ? PALETTE.amber : w === 'Rising' ? PALETTE.rise : w === 'Easing' ? PALETTE.ease : PALETTE.neon);

// ── data ────────────────────────────────────────────────────────────────────
async function fetchLive() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Set them, or run with --demo.');
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Use the most recent scored day (today if the cron has run, else the last
  // day with rows) so the cards never come back empty between cron runs.
  const latest = await supabase.from('centre_seer_scores')
    .select('score_date').order('score_date', { ascending: false }).limit(1);
  if (latest.error) throw latest.error;
  const scoreDate = latest.data?.[0]?.score_date || TODAY;

  const [centresRes, scoresRes, centreBrandsRes, brandSaleRes] = await Promise.all([
    supabase.from('centres').select('id, name').eq('active', true),
    supabase.from('centre_seer_scores')
      .select('centre_id, tide_score, verdict, brands_on_sale, total_brands')
      .eq('score_date', scoreDate),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events')
      .select('brand_id, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)'),
  ]);
  const err = [centresRes, scoresRes, centreBrandsRes, brandSaleRes].find(r => r.error);
  if (err) throw err.error;

  const nameById = new Map((centresRes.data || []).map(c => [c.id, c.name]));
  const brandName = Object.fromEntries(brands.map(b => [b.id, b.name]));
  const brandCluster = Object.fromEntries(brands.map(b => [b.id, b.cluster]));

  // Centres, ranked.
  const centresOut = (scoresRes.data || []).map(s => {
    const word = VERDICT_CANON[s.verdict] || 'Quiet';
    return {
      name: nameById.get(s.centre_id) || s.centre_id,
      pct: Math.round(+s.tide_score || 0),
      onSale: +s.brands_on_sale || 0,
      total: +s.total_brands || 0,
      verdict: word,
    };
  }).filter(c => c.name)
    .sort((a, b) => (SEVERITY[b.verdict] - SEVERITY[a.verdict]) || (b.pct - a.pct) || (b.onSale - a.onSale));

  // Brands on sale now → presence count + discount.
  const presenceCount = new Map();
  for (const { brand_id } of centreBrandsRes.data || []) {
    presenceCount.set(brand_id, (presenceCount.get(brand_id) || 0) + 1);
  }
  const brandsOut = (brandSaleRes.data || []).map(b => {
    const onSale = b.active_cycle_id ? true : (b.last_verified_date ? b.last_verified_status : false);
    if (!onSale) return null;
    return {
      name: brandName[b.brand_id] || b.brand_id,
      cluster: brandCluster[b.brand_id] || '',
      discount: (b.cycle && b.cycle.max_discount_pct) || null,
      centres: presenceCount.get(b.brand_id) || 0,
    };
  }).filter(Boolean)
    .sort((a, b) => (b.discount || -1) - (a.discount || -1) || (b.centres - a.centres));

  return { scoreDate, centres: centresOut, brands: brandsOut };
}

function demoData() {
  return {
    scoreDate: TODAY,
    centres: [
      { name: 'Westquay', pct: 58, onSale: 23, total: 40, verdict: 'Peak' },
      { name: 'Bullring & Grand Central', pct: 45, onSale: 18, total: 40, verdict: 'Peak' },
      { name: 'Trafford Centre', pct: 38, onSale: 15, total: 39, verdict: 'Rising' },
      { name: 'Westfield London', pct: 34, onSale: 14, total: 41, verdict: 'Rising' },
      { name: 'Meadowhall', pct: 28, onSale: 11, total: 39, verdict: 'Easing' },
      { name: 'Liverpool ONE', pct: 22, onSale: 9, total: 40, verdict: 'Easing' },
      { name: 'Cabot Circus', pct: 18, onSale: 7, total: 38, verdict: 'Quiet' },
      { name: 'Bluewater', pct: 12, onSale: 5, total: 41, verdict: 'Quiet' },
    ],
    brands: [
      { name: 'River Island', cluster: 'High Street', discount: 60, centres: 22 },
      { name: 'Nike', cluster: 'Activewear', discount: 50, centres: 14 },
      { name: 'New Look', cluster: 'High Street', discount: 50, centres: 26 },
      { name: 'Next', cluster: 'High Street', discount: 40, centres: 29 },
      { name: 'Schuh', cluster: 'Footwear', discount: 40, centres: 18 },
      { name: 'M&S', cluster: 'High Street', discount: 30, centres: 31 },
      { name: 'JD Sports', cluster: 'Activewear', discount: 30, centres: 24 },
      { name: 'Zara', cluster: 'Contemporary', discount: null, centres: 19 },
    ],
  };
}

// ── HTML templates ───────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const niceDate = iso => {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
};

function shell(accent, eyebrow, title, sub, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:1350px; }
  body { background:${PALETTE.ink}; color:${PALETTE.cream};
    font-family:'Inter',system-ui,sans-serif; position:relative; overflow:hidden; }
  .glow { position:absolute; inset:0;
    background:radial-gradient(1000px 620px at 50% -160px, ${accent}30, transparent 70%); }
  .frame { position:absolute; inset:0; padding:96px; display:flex; flex-direction:column; }
  .head { display:flex; justify-content:space-between; align-items:baseline; }
  .wordmark { font-family:'Playfair Display',serif; font-weight:700; font-size:46px; letter-spacing:.01em; }
  .domain { color:${PALETTE.mute}; font-size:28px; font-weight:500; }
  .eyebrow { color:${PALETTE.mute}; font-size:26px; font-weight:600; letter-spacing:.28em; margin-top:64px; }
  .title { font-family:'Playfair Display',serif; font-weight:600; font-size:84px; line-height:1.02; margin-top:14px; letter-spacing:-.02em; }
  .sub { color:${PALETTE.mute}; font-size:32px; font-weight:500; margin-top:18px; }
  .list { margin-top:40px; display:flex; flex-direction:column; gap:2px; flex:1; min-height:0; overflow:hidden; }
  .row { display:flex; align-items:center; gap:28px; padding:15px 0; border-bottom:1px solid rgba(255,255,255,.08); }
  .row:last-child { border-bottom:none; }
  .rank { font-family:'Playfair Display',serif; font-weight:600; font-size:44px; color:${PALETTE.mute}; width:56px; text-align:center; flex:none; }
  .rmain { flex:1; min-width:0; }
  .rname { font-size:42px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rsub { color:${PALETTE.mute}; font-size:28px; font-weight:500; margin-top:4px; }
  .rright { display:flex; align-items:center; gap:20px; flex:none; }
  .chip { font-size:24px; font-weight:700; letter-spacing:.06em; padding:8px 18px; border-radius:999px; }
  .pct { font-family:'Playfair Display',serif; font-weight:600; font-size:60px; font-variant-numeric:tabular-nums; min-width:130px; text-align:right; }
  .pct small { font-size:30px; font-weight:600; margin-left:4px; }
  .foot { display:flex; justify-content:space-between; align-items:center; padding-top:34px; border-top:1px solid rgba(255,255,255,.10); margin-top:18px; }
  .foot .cta { font-size:34px; font-weight:500; }
  .foot .url { font-size:34px; font-weight:600; color:${accent}; }
  /* peak hero */
  .hero { flex:1; display:flex; flex-direction:column; justify-content:center; }
  .heroline { font-family:'Playfair Display',serif; font-weight:700; font-size:150px; line-height:.95; color:${accent}; letter-spacing:-.03em; }
  .herosub { font-size:38px; color:${PALETTE.cream}; margin-top:24px; font-weight:500; }
</style></head>
<body><div class="glow"></div><div class="frame">
  <div class="head"><div class="wordmark">TIDE</div><div class="domain">tidego.co</div></div>
  <div class="eyebrow">${esc(eyebrow)}</div>
  <div class="title">${esc(title)}</div>
  ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
  ${bodyHtml}
  <div class="foot"><div class="cta">See when it’s worth the trip</div><div class="url">tidego.co</div></div>
</div></body></html>`;
}

function centresCard(d, accent) {
  const rows = d.centres.slice(0, LIMIT).map((c, i) => `
    <div class="row">
      <div class="rank">${i + 1}</div>
      <div class="rmain">
        <div class="rname">${esc(c.name)}</div>
        <div class="rsub">${c.total > 0 ? c.onSale + ' of ' + c.total + ' shops on sale' : 'tracking now'}</div>
      </div>
      <div class="rright">
        <div class="chip" style="color:${PALETTE.ink};background:${accentFor(c.verdict)}">${c.verdict === 'Peak' ? 'GO NOW' : c.verdict.toUpperCase()}</div>
        <div class="pct">${c.pct}<small>%</small></div>
      </div>
    </div>`).join('');
  return shell(accent, 'TODAY’S TIDE', 'Where the sales are', niceDate(d.scoreDate), `<div class="list">${rows}</div>`);
}

function peakCard(d, accent) {
  const peaks = d.centres.filter(c => c.verdict === 'Peak').slice(0, LIMIT);
  if (!peaks.length) return null;
  const rows = peaks.map((c, i) => `
    <div class="row">
      <div class="rank">${i + 1}</div>
      <div class="rmain">
        <div class="rname">${esc(c.name)}</div>
        <div class="rsub">${c.total > 0 ? c.onSale + ' of ' + c.total + ' shops on sale' : 'tracking now'}</div>
      </div>
      <div class="rright"><div class="pct">${c.pct}<small>%</small></div></div>
    </div>`).join('');
  const title = peaks.length === 1 ? 'At peak now' : 'Peak right now';
  return shell(accent, 'GO NOW', title, 'These centres just crested — freshest picks, deepest racks', `<div class="list">${rows}</div>`);
}

function brandsCard(d, accent) {
  const rows = d.brands.slice(0, LIMIT).map((b, i) => `
    <div class="row">
      <div class="rank">${i + 1}</div>
      <div class="rmain">
        <div class="rname">${esc(b.name)}</div>
        <div class="rsub">${b.cluster ? esc(b.cluster) + ' · ' : ''}on sale at ${b.centres} ${b.centres === 1 ? 'centre' : 'centres'}</div>
      </div>
      <div class="rright"><div class="pct">${b.discount != null ? 'up to ' + b.discount + '<small>% off</small>' : '<small>on sale</small>'}</div></div>
    </div>`).join('');
  return shell(accent, 'DEEPEST DISCOUNTS', 'Biggest sales now', niceDate(d.scoreDate), `<div class="list">${rows}</div>`);
}

// ── render ────────────────────────────────────────────────────────────────────
async function renderToPng(page, html, outPath) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  await page.waitForTimeout(250);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
}

async function main() {
  const data = DEMO ? demoData() : await fetchLive();
  console.log(`Tide social — ${data.scoreDate} · ${data.centres.length} centres, ${data.brands.length} brands on sale${DEMO ? ' (demo data)' : ''}`);

  const want = TYPE === 'all' ? ['centres', 'peak', 'brands'] : [TYPE];
  const jobs = [];
  if (want.includes('centres')) jobs.push(['centres', centresCard(data, PALETTE.neon)]);
  if (want.includes('peak'))    jobs.push(['peak',    peakCard(data, PALETTE.amber)]);
  if (want.includes('brands'))  jobs.push(['brands',  brandsCard(data, PALETTE.neon)]);

  mkdirSync(OUTDIR, { recursive: true });
  const exe = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
  const launchOpts = {};
  try { const { accessSync } = await import('node:fs'); accessSync(exe); launchOpts.executablePath = exe; } catch {}
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });

  const written = [];
  for (const [name, html] of jobs) {
    if (!html) { console.log(`  · ${name}: nothing to show (skipped)`); continue; }
    const file = join(OUTDIR, `tide-${name}-${data.scoreDate}.png`);
    await renderToPng(page, html, file);
    written.push(file);
    console.log(`  ✓ ${file}`);
  }
  await browser.close();

  if (!written.length) console.log('No images generated.');
  else console.log(`\nDone — ${written.length} image(s) in ${OUTDIR}/. Ready to post.`);
}

main().catch(e => { console.error('Failed:', e.message || e); process.exit(1); });
