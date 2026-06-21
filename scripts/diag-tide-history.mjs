#!/usr/bin/env node
// Read-only diagnostic for the centre-detail history chart.
//
// The chart's 7D/30D/60D/MAX tabs window centres.tide_history by calendar date.
// They only render visibly different when the centre actually has points
// spanning those date ranges. This script reports, for one centre:
//   - how many entries centres.tide_history holds + their date span
//   - how many of those points are older than 30 / 60 days
//   - the distinct daily score_date rows in centre_seer_scores (the source the
//     daily rebuild reads), with the same age bands
// and prints a VERDICT: whether 30D/60D/MAX will diverge, or whether the centre
// simply lacks the history (a data-coverage / scoring-gap issue) and the chart
// is behaving correctly on thin data.
//
// Usage:  SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/diag-tide-history.mjs "<centre name>"
// Needs outbound network + the service key — won't run in the dev sandbox.
// READ-ONLY: only `select` queries, never a write.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

function dateStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
}

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('usage: node scripts/diag-tide-history.mjs "<centre name>"');
  process.exit(1);
}

const TODAY = dateStr(0);
const D30 = dateStr(-29);   // anything strictly before this is >30 days old
const D60 = dateStr(-59);   // anything strictly before this is >60 days old

function countOlder(dates, cutoff) {
  return dates.filter(d => d < cutoff).length;
}

(async () => {
  const sb = getSupabase();

  // 1. Resolve centre + read stored tide_history.
  const { data: centres, error: cErr } = await sb
    .from('centres')
    .select('id, name, tide_history')
    .ilike('name', `%${name}%`);
  if (cErr) { console.error('centres query failed:', cErr.message); process.exit(1); }
  if (!centres || !centres.length) { console.error(`No centre matching "${name}".`); process.exit(1); }
  if (centres.length > 1) {
    console.log(`Note: ${centres.length} centres match "${name}" — using the first:`,
      centres.map(c => c.name).join(', '));
  }
  const centre = centres[0];
  const hist = Array.isArray(centre.tide_history) ? centre.tide_history : [];
  const histDates = hist.map(h => h && h.date).filter(Boolean).sort();

  // 2. Distinct daily score_date rows in the source table (last 180 days).
  const { data: rows, error: sErr } = await sb
    .from('centre_seer_scores')
    .select('score_date')
    .eq('centre_id', centre.id)
    .gte('score_date', dateStr(-180))
    .not('tide_score', 'is', null)
    .order('score_date', { ascending: true });
  if (sErr) { console.error('centre_seer_scores query failed:', sErr.message); process.exit(1); }
  const srcDates = [...new Set((rows || []).map(r => r.score_date))].sort();

  const histOlder30 = countOlder(histDates, D30);
  const histOlder60 = countOlder(histDates, D60);

  console.log(`\nCentre: ${centre.name}  (id: ${centre.id})  [today ${TODAY}]\n`);
  console.log('centres.tide_history (what the chart reads):');
  console.log(`  entries:            ${histDates.length}`);
  console.log(`  date range:         ${histDates[0] || '—'} … ${histDates[histDates.length - 1] || '—'}`);
  console.log(`  points >30 days old: ${histOlder30}   (these make 30D differ from shorter windows)`);
  console.log(`  points >60 days old: ${histOlder60}   (these make MAX differ from 60D)\n`);

  console.log('centre_seer_scores (source, last 180 days):');
  console.log(`  distinct score_date rows: ${srcDates.length}`);
  console.log(`  date range:               ${srcDates[0] || '—'} … ${srcDates[srcDates.length - 1] || '—'}`);
  console.log(`  rows >30 days old:        ${countOlder(srcDates, D30)}`);
  console.log(`  rows >60 days old:        ${countOlder(srcDates, D60)}\n`);

  console.log('VERDICT:');
  if (histDates.length < srcDates.length) {
    console.log(`  ⚠ tide_history (${histDates.length}) is SHORTER than the available source rows`);
    console.log(`    (${srcDates.length}) — the rebuild may be stale or the retention window too short.`);
  }
  if (histOlder30 === 0) {
    console.log('  0 stored points are older than 30 days → 30D / 60D / MAX render the SAME line.');
    console.log('  This is a DATA-COVERAGE issue (recent reset and/or scoring gaps), not a chart');
    console.log('  bug. The date-based tabs are correct; they will separate once the centre');
    console.log('  accumulates contiguous daily scores past 30/60 days.');
  } else if (histOlder60 === 0) {
    console.log('  30D differs from MAX, but 60D == MAX (no points older than 60 days yet).');
    console.log('  Expected until ~2 months of history accrues.');
  } else {
    console.log('  Points span >60 days → 7D / 30D / 60D / MAX all render distinct lines. Healthy.');
  }
  console.log('');
})().catch(err => { console.error(err); process.exit(1); });
