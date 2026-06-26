#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// tide-data-readiness — quantify whether the Tide dataset is ready for
// predictive analytics / AI. READ-ONLY: only SELECT queries, never a write.
//
// Turns the structural assessment into numbers, across five axes:
//   1. SCALE        — how many centres / brands / sale episodes exist
//   2. DEPTH        — how much contiguous daily history per centre (forecast horizon)
//   3. SIGNAL       — carry-forward ratio: how much of the daily series is real
//                     vs frozen-from-yesterday (a model would learn the freeze)
//   4. EPISODES     — brand_sale_cycles health: the crown-jewel forecastable table
//   5. CROWD        — user_reports / community_signals volume (the densification path)
//
// Prints a per-axis grade and an overall verdict.
//
// Usage:  SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/tide-data-readiness.mjs
//         (add --json for machine-readable output)
// Needs outbound network + the service key — won't run in the dev sandbox.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AS_JSON = process.argv.includes('--json');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.');
  console.error('Run with:  SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/tide-data-readiness.mjs');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function dateStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
}
const TODAY = dateStr(0);

// Paginate past Supabase's 1000-row default cap.
async function selectAll(table, columns, tweak = (q) => q) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function grade(score) {
  return score >= 4 ? 'A — first-class' : score >= 3 ? 'B — usable' : score >= 2 ? 'C — thin' : 'D — not ready';
}

(async () => {
  // ── Load ──────────────────────────────────────────────────────────────────
  const [centres, centreBrands, cycles, scores, reports, signals] = await Promise.all([
    selectAll('centres', 'id, name, active'),
    selectAll('centre_brands', 'centre_id, brand_id', (q) => q.eq('present', true)),
    // Try with the is_simulated tag (added by 20260626b); fall back without it
    // so the report still runs before that migration is applied.
    selectAll('brand_sale_cycles', 'id, brand_id, start_date, end_date, max_discount_pct, sale_type, source, is_simulated')
      .catch(() => selectAll('brand_sale_cycles', 'id, brand_id, start_date, end_date, max_discount_pct, sale_type, source')),
    selectAll('centre_seer_scores', 'centre_id, score_date, tide_score, brands_on_sale, verdict',
      (q) => q.gte('score_date', dateStr(-365)).not('tide_score', 'is', null)),
    selectAll('user_reports', 'id, created_at').catch(() => []),
    selectAll('community_signals', 'id, created_at').catch(() => []),
  ]);

  const activeCentres = centres.filter((c) => c.active);
  const brandSet = new Set(centreBrands.map((b) => b.brand_id));

  // ── Axis 1: SCALE ───────────────────────────────────────────────────────────
  const scale = { activeCentres: activeCentres.length, distinctBrands: brandSet.size, totalCycles: cycles.length };
  const scaleScore = activeCentres.length >= 50 ? 3 : activeCentres.length >= 20 ? 2 : 1;

  // ── Axis 2: DEPTH — contiguous daily history per centre ──────────────────────
  const byCentre = new Map();
  for (const r of scores) {
    if (!byCentre.has(r.centre_id)) byCentre.set(r.centre_id, []);
    byCentre.get(r.centre_id).push(r);
  }
  const spans = [];
  for (const [, rows] of byCentre) {
    const dates = [...new Set(rows.map((r) => r.score_date))].sort();
    if (dates.length < 2) { spans.push({ days: dates.length, count: dates.length }); continue; }
    spans.push({ days: daysBetween(dates[0], dates[dates.length - 1]) + 1, count: dates.length });
  }
  const medianSpan = spans.length
    ? spans.map((s) => s.days).sort((a, b) => a - b)[Math.floor(spans.length / 2)] : 0;
  const centresOver60 = spans.filter((s) => s.days > 60).length;
  const depth = { medianSpanDays: medianSpan, centresWithOver60Days: centresOver60, centresScored: spans.length };
  const depthScore = medianSpan >= 365 ? 4 : medianSpan >= 180 ? 3 : medianSpan >= 60 ? 2 : 1;

  // ── Axis 3: SIGNAL — carry-forward ratio (consecutive identical brands_on_sale)
  // A carried-forward day copies yesterday's brands_on_sale verbatim. Counting
  // day-over-day no-change runs estimates how much of the series is frozen.
  let frozen = 0, transitions = 0;
  for (const [, rows] of byCentre) {
    const sorted = rows.slice().sort((a, b) => a.score_date.localeCompare(b.score_date));
    for (let i = 1; i < sorted.length; i++) {
      transitions++;
      if (sorted[i].brands_on_sale === sorted[i - 1].brands_on_sale) frozen++;
    }
  }
  const frozenPct = transitions ? Math.round((frozen / transitions) * 100) : 0;
  const signal = { dayOverDayTransitions: transitions, unchangedPct: frozenPct };
  // High unchanged% can be real (stable sales) but combined with admin-only
  // verification it mostly reflects carry-forward. Lower is richer signal.
  const signalScore = frozenPct <= 40 ? 3 : frozenPct <= 65 ? 2 : 1;

  // ── Axis 4: EPISODES — brand_sale_cycles, the forecastable table ─────────────
  // Grade on REAL cycles only. Simulated/backfilled demo rows (is_simulated,
  // tagged by migration 20260626b — start_date before the last data delete) are
  // padding, not forecastable signal, so they must not inflate readiness. Pre-
  // migration the column is absent, so we fall back to the source!='admin' hint.
  const isSim = (c) => ('is_simulated' in c ? c.is_simulated === true : (c.source && c.source !== 'admin'));
  const simulatedCount = cycles.filter(isSim).length;
  const real = cycles.filter((c) => !isSim(c));

  const closed = real.filter((c) => c.end_date);
  const open = real.filter((c) => !c.end_date);
  const withDiscount = real.filter((c) => c.max_discount_pct != null).length;
  const lengths = closed
    .map((c) => daysBetween(c.start_date, c.end_date))
    .filter((d) => d >= 0);
  const avgLen = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null;
  const brandsWithCycle = new Set(real.map((c) => c.brand_id));
  const brandsWith2Plus = [...brandsWithCycle].filter(
    (bid) => real.filter((c) => c.brand_id === bid).length >= 2).length;
  const episodes = {
    totalCycles: cycles.length, realCycles: real.length, simulatedTagged: simulatedCount,
    closed: closed.length, open: open.length,
    withDiscountPct: withDiscount, avgClosedLengthDays: avgLen,
    brandsWithAnyRealCycle: brandsWithCycle.size,
    brandsWith2PlusRealCycles: brandsWith2Plus,
  };
  // Forecasting cadence needs ≥2 REAL episodes per brand for a meaningful share.
  const episodeScore = brandsWith2Plus >= 30 ? 4 : brandsWith2Plus >= 10 ? 3 : brandsWith2Plus >= 3 ? 2 : 1;

  // ── Axis 5: CROWD — densification signal ─────────────────────────────────────
  const recentReports = reports.filter((r) => r.created_at >= dateStr(-30)).length;
  const recentSignals = signals.filter((s) => s.created_at >= dateStr(-30)).length;
  const crowd = { userReportsTotal: reports.length, userReportsLast30d: recentReports,
    communitySignalsTotal: signals.length, communitySignalsLast30d: recentSignals };
  const crowdScore = recentReports + recentSignals >= 100 ? 3 : recentReports + recentSignals >= 20 ? 2 : 1;

  const overall = (scaleScore + depthScore + signalScore + episodeScore + crowdScore) / 5;
  const report = { generatedFor: TODAY, scale, depth, signal, episodes, crowd,
    grades: {
      scale: grade(scaleScore), depth: grade(depthScore), signal: grade(signalScore),
      episodes: grade(episodeScore), crowd: grade(crowdScore), overall: grade(overall),
    } };

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }

  const line = (k, v) => console.log(`    ${k.padEnd(26)} ${v}`);
  console.log(`\n═══ Tide data readiness — ${TODAY} ═══\n`);

  console.log(`1. SCALE                                   [${report.grades.scale}]`);
  line('active centres', scale.activeCentres);
  line('distinct brands tracked', scale.distinctBrands);
  line('total sale cycles', scale.totalCycles);

  console.log(`\n2. DEPTH (forecast horizon)                [${report.grades.depth}]`);
  line('median history span (days)', depth.medianSpanDays);
  line('centres with >60 days', `${depth.centresWithOver60Days} / ${depth.centresScored}`);

  console.log(`\n3. SIGNAL (real vs carried-forward)        [${report.grades.signal}]`);
  line('day-over-day unchanged', `${signal.unchangedPct}%  (of ${signal.dayOverDayTransitions} transitions)`);
  console.log('    note: high % ≈ carry-forward / stable sales; lower = richer signal');

  console.log(`\n4. EPISODES (brand_sale_cycles — the asset) [${report.grades.episodes}]`);
  line('real / simulated cycles', `${episodes.realCycles} real, ${episodes.simulatedTagged} simulated  (of ${episodes.totalCycles})`);
  line('real episodes (closed/open)', `${episodes.closed} / ${episodes.open}`);
  line('with a discount %', `${episodes.withDiscountPct} / ${episodes.realCycles}`);
  line('avg closed length (days)', episodes.avgClosedLengthDays ?? '—');
  line('brands with ≥2 real episodes', `${episodes.brandsWith2PlusRealCycles}  (forecastable cadence)`);
  console.log('    note: graded on REAL cycles only; simulated rows are excluded');

  console.log(`\n5. CROWD (densification path)              [${report.grades.crowd}]`);
  line('user reports (30d / all)', `${crowd.userReportsLast30d} / ${crowd.userReportsTotal}`);
  line('community signals (30d/all)', `${crowd.communitySignalsLast30d} / ${crowd.communitySignalsTotal}`);

  console.log(`\n────────────────────────────────────────────`);
  console.log(`OVERALL: ${report.grades.overall}`);
  console.log(`\nRead: predictive-ready when EPISODES reaches A (≥30 brands with ≥2`);
  console.log(`cycles) AND DEPTH reaches B+ (≥180d median). Those two unlock real`);
  console.log(`cadence/seasonality forecasting; the rest is dashboard-grade today.\n`);
})().catch((err) => { console.error('readiness check failed:', err.message); process.exit(1); });
