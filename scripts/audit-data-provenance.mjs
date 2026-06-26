#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// audit-data-provenance — work out which sale data is REAL vs SIMULATED when
// nothing was explicitly tagged. READ-ONLY: only SELECT queries, never a write.
//
// The admin console stamps every cycle it writes with source='admin' (see
// admin.html), so real and simulated rows look identical by tag. This script
// separates them using three forensic signals that don't need a tag:
//
//   1. SOURCE      — distinct brand_sale_cycles.source values. If the simulator
//                    used anything other than 'admin' (e.g. 'scraper','seed'),
//                    that IS your marker and the override can key off it.
//   2. BATCH       — created_at clustering. Hand entries are spread across days;
//                    a simulator bulk-inserts many rows in the same minute. Large
//                    same-minute batches are almost certainly simulated.
//   3. PRE-CONSOLE — cycles whose start_date predates the admin console launch
//                    couldn't have been hand-verified — verification didn't exist
//                    yet — so they are backfilled / simulated.
//
// Usage:
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/audit-data-provenance.mjs [console-launch-date]
//   console-launch-date defaults to 2026-05-04 (the admin-console migration).
//   add --json for machine-readable output.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2).filter((a) => a !== '--json');
const AS_JSON = process.argv.includes('--json');
const CONSOLE_LAUNCH = args[0] || '2026-05-04';

async function selectAll(table, columns) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function tally(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

(async () => {
  const cycles = await selectAll(
    'brand_sale_cycles',
    'id, brand_id, start_date, end_date, max_discount_pct, sale_type, source, notes, created_at');

  // 1. SOURCE breakdown.
  const bySource = tally(cycles, (c) => c.source || '(null)');

  // 2. created_at batches, grouped to the minute. A minute holding many rows is
  //    a bulk insert (simulated); single/low-count minutes are hand entries.
  const byMinute = tally(cycles, (c) => (c.created_at || '').slice(0, 16));
  const bigBatches = byMinute.filter(([, n]) => n >= 5);
  const inBigBatch = bigBatches.reduce((s, [, n]) => s + n, 0);

  // 3. start_date before the console existed → can't be hand-verified.
  const preConsole = cycles.filter((c) => c.start_date && c.start_date < CONSOLE_LAUNCH);

  // notes conventions, if any.
  const withNotes = cycles.filter((c) => c.notes && c.notes.trim());
  const noteSamples = [...new Set(withNotes.map((c) => c.notes.trim()))].slice(0, 8);

  const result = {
    consoleLaunch: CONSOLE_LAUNCH,
    totalCycles: cycles.length,
    bySource: Object.fromEntries(bySource),
    bigBatchMinutes: bigBatches.map(([minute, n]) => ({ minute, rows: n })),
    rowsInBigBatches: inBigBatch,
    preConsoleStartDates: preConsole.length,
    cyclesWithNotes: withNotes.length,
    noteSamples,
  };

  if (AS_JSON) { console.log(JSON.stringify(result, null, 2)); return; }

  console.log(`\n═══ Sale-data provenance audit ═══`);
  console.log(`(console launch assumed ${CONSOLE_LAUNCH}; total cycles ${cycles.length})\n`);

  console.log('1. SOURCE values  — a non-"admin" value IS a usable marker:');
  for (const [src, n] of bySource) console.log(`     ${String(src).padEnd(16)} ${n}`);

  console.log('\n2. created_at BATCHES (same-minute) — large = bulk insert = likely simulated:');
  if (!bigBatches.length) console.log('     (none ≥5 rows/minute — looks hand-entered over time)');
  for (const [minute, n] of bigBatches.slice(0, 15)) console.log(`     ${minute}Z   ${n} rows`);
  if (bigBatches.length) console.log(`     → ${inBigBatch} of ${cycles.length} cycles sit in a big batch`);

  console.log(`\n3. PRE-CONSOLE start_dates (< ${CONSOLE_LAUNCH}) — couldn't be hand-verified:`);
  console.log(`     ${preConsole.length} cycles`);

  console.log('\n4. NOTES (sometimes carry a "simulated"/"seed" hint):');
  if (!noteSamples.length) console.log('     (no cycles have notes)');
  noteSamples.forEach((s) => console.log(`     • ${s.slice(0, 70)}`));

  console.log('\n────────────────────────────────────────────');
  console.log('READ:');
  console.log('  • If (1) shows a non-admin source → simplest marker. Surgical override:');
  console.log("      DELETE FROM brand_sale_cycles WHERE source = '<that value>';  (with the GUC override)");
  console.log('  • Else if (2)/(3) isolate the simulated rows → delete by created_at minute or');
  console.log('    by start_date < launch. Either way: SNAPSHOT first, then use the override.');
  console.log('  • If real and simulated are genuinely intermixed with no signal, the safe move');
  console.log('    is to ADD a marker now (e.g. tag the rows you KNOW are real) before any cleanup.\n');
})().catch((err) => { console.error('audit failed:', err.message); process.exit(1); });
