// Tide regression suite — runs after scraper and scorer.
// Pure node:test + node:assert + native fetch. Zero external dependencies.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (the service role key bypasses RLS so the suite can read every row)
//
// Run locally:  node --test src/tests/regression.test.js

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── env ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) env vars',
  );
  process.exit(1);
}

const TODAY = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

// ── result tracking ─────────────────────────────────────────────────────────
const results = []; // { id, status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP', message }

function record(id, status, message) {
  results.push({ id, status, message });
}

function pass(id, message) {
  record(id, 'PASS', message);
}
function warn(id, message) {
  record(id, 'WARN', message);
}
function fail(id, message) {
  record(id, 'FAIL', message);
  // Also throw so node:test marks the test as failed.
  assert.fail(`${id}: ${message}`);
}
function skip(id, message) {
  record(id, 'SKIP', message);
}

// ── REST helpers ────────────────────────────────────────────────────────────
const baseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, { method = 'GET', headers = {}, body } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: { ...baseHeaders, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function selectAll(path) {
  const res = await rest(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SELECT failed (${res.status}) ${path}: ${text}`);
  }
  return res.json();
}

async function selectCount(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await rest(`${path}${sep}select=*`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok && res.status !== 206) {
    const text = await res.text();
    throw new Error(`COUNT failed (${res.status}) ${path}: ${text}`);
  }
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total === '*' ? null : parseInt(total, 10);
}

async function rpc(name, args = {}) {
  const res = await rest(`rpc/${name}`, { method: 'POST', body: args });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// Detect actual date column on centre_seer_scores (spec calls it `date`,
// migrations use `score_date`). Probe once at startup so date-filtering
// tests use the right column even if T15 flags the spec-vs-reality drift.
async function detectScoreDateColumn() {
  for (const candidate of ['score_date', 'date']) {
    const res = await rest(
      `centre_seer_scores?select=${candidate}&limit=1`,
    );
    if (res.ok) return candidate;
  }
  return null;
}

let SCORE_DATE_COL = 'score_date';

// ── tests ───────────────────────────────────────────────────────────────────

test('init — detect score date column', async () => {
  SCORE_DATE_COL = (await detectScoreDateColumn()) || 'score_date';
});

// ── AREA 1: SCRAPER OUTPUT ──────────────────────────────────────────────────

test('T01 — Scraper coverage: brand_sale_events has rows for today', async () => {
  const id = 'T01';
  const count = await selectCount(`brand_sale_events?date=eq.${TODAY}`);
  if (count === null) return fail(id, 'Could not read brand_sale_events count');
  if (count === 0) return fail(id, `No brand_sale_events rows for ${TODAY}`);
  pass(id, `Scraper coverage: ${count} brands found for ${TODAY}`);
});

test('T02 — Coverage threshold: at least 60 of 75 brands today', async () => {
  const id = 'T02';
  const rows = await selectAll(
    `brand_sale_events?date=eq.${TODAY}&select=brand_id`,
  );
  const distinct = new Set(rows.map((r) => r.brand_id)).size;
  if (distinct < 60)
    return fail(
      id,
      `Coverage threshold: only ${distinct} of 75 brands (below 60 minimum)`,
    );
  if (distinct <= 70)
    return warn(
      id,
      `Coverage threshold: ${distinct} of 75 (between 60–70 — partial run)`,
    );
  pass(id, `Coverage threshold: ${distinct} of 75 (above 60 minimum)`);
});

test('T03 — Sale status validity: sale_status is Y or N only', async () => {
  const id = 'T03';
  const rows = await selectAll(
    `brand_sale_events?date=eq.${TODAY}&select=brand_id,sale_status`,
  );
  const bad = rows.filter((r) => r.sale_status !== 'Y' && r.sale_status !== 'N');
  if (bad.length)
    return fail(
      id,
      `${bad.length} rows have invalid sale_status (e.g. brand_id=${bad[0].brand_id} sale_status=${JSON.stringify(bad[0].sale_status)})`,
    );
  pass(id, `Sale status validity: all ${rows.length} rows are Y or N`);
});

test('T04 — No future dates in brand_sale_events', async () => {
  const id = 'T04';
  const rows = await selectAll(
    `brand_sale_events?date=gt.${TODAY}&select=brand_id,date&limit=5`,
  );
  if (rows.length)
    return fail(
      id,
      `${rows.length} brand_sale_events rows have date > ${TODAY} (e.g. brand_id=${rows[0].brand_id} date=${rows[0].date})`,
    );
  pass(id, `No future dates: 0 rows with date > ${TODAY}`);
});

test('T05 — date_first_detected immutability', async () => {
  const id = 'T05';
  const yest = await selectAll(
    `brand_sale_events?date=eq.${YESTERDAY}&sale_status=eq.Y&select=brand_id,date_first_detected&limit=1000`,
  );
  if (yest.length === 0)
    return warn(
      id,
      `No yesterday rows with sale_status=Y; cannot compare date_first_detected`,
    );

  const yMap = new Map(yest.map((r) => [r.brand_id, r.date_first_detected]));
  const today = await selectAll(
    `brand_sale_events?date=eq.${TODAY}&sale_status=eq.Y&select=brand_id,date_first_detected&limit=1000`,
  );

  // Brands on sale both days, with date_first_detected before today (>1 day on sale).
  const candidates = today.filter(
    (r) =>
      yMap.has(r.brand_id) &&
      r.date_first_detected &&
      r.date_first_detected < TODAY,
  );
  if (candidates.length === 0)
    return warn(
      id,
      `No brands on sale > 1 day to verify date_first_detected immutability`,
    );

  const sample = candidates.slice(0, 5);
  const drifted = sample.filter(
    (r) => r.date_first_detected !== yMap.get(r.brand_id),
  );
  if (drifted.length)
    return fail(
      id,
      `${drifted.length}/${sample.length} sampled brands had date_first_detected change vs yesterday (e.g. brand_id=${drifted[0].brand_id})`,
    );
  pass(
    id,
    `date_first_detected unchanged across ${sample.length} sampled brands on sale > 1 day`,
  );
});

test('T06 — No orphan brand IDs in brand_sale_events for today', async () => {
  const id = 'T06';
  const todayRows = await selectAll(
    `brand_sale_events?date=eq.${TODAY}&select=brand_id`,
  );
  const todayIds = [...new Set(todayRows.map((r) => r.brand_id))];
  if (todayIds.length === 0)
    return fail(id, `No brand_sale_events rows today; cannot verify orphans`);

  const brandsRes = await selectAll(`brands?select=id`);
  const brandIds = new Set(brandsRes.map((b) => b.id));
  const orphans = todayIds.filter((b) => !brandIds.has(b));
  if (orphans.length)
    return fail(
      id,
      `${orphans.length} orphan brand_id(s) in today's events not in brands table (e.g. ${orphans[0]})`,
    );
  pass(id, `No orphans: all ${todayIds.length} brand_ids resolve to brands table`);
});

// ── AREA 2: SCORE PIPELINE ──────────────────────────────────────────────────

test('T07 — Score coverage: all 30 centres have a score today', async () => {
  const id = 'T07';
  const centresRes = await selectAll(`centres?select=id&active=eq.true`);
  const centreIds = new Set(centresRes.map((c) => c.id));
  const expected = centreIds.size || 30;

  const scores = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=centre_id`,
  );
  const scored = new Set(scores.map((s) => s.centre_id));
  const missing = [...centreIds].filter((c) => !scored.has(c));
  if (missing.length)
    return fail(
      id,
      `Score coverage: ${expected - missing.length}/${expected} centres scored today; missing: ${missing.slice(0, 10).join(', ')}`,
    );
  pass(id, `Score coverage: all ${expected} centres scored for ${TODAY}`);
});

test('T08 — Score range: 0 ≤ tide_score ≤ 100', async () => {
  const id = 'T08';
  const rows = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=centre_id,tide_score`,
  );
  const bad = rows.filter(
    (r) => r.tide_score == null || r.tide_score < 0 || r.tide_score > 100,
  );
  if (bad.length)
    return fail(
      id,
      `Score range: ${bad.length} scores out of range (centre_ids: ${bad
        .slice(0, 5)
        .map((b) => b.centre_id)
        .join(', ')})`,
    );
  pass(id, `Score range: all ${rows.length} tide_scores within [0, 100]`);
});

test('T09 — Stage validity: stage in allowed set', async () => {
  const id = 'T09';
  const allowed = new Set([
    'Flat',
    'Turning',
    'Rising',
    'High Tide',
    'Falling',
    'Low',
  ]);
  const rows = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=centre_id,stage`,
  );
  const bad = rows.filter((r) => !allowed.has(r.stage));
  if (bad.length)
    return fail(
      id,
      `Stage validity: ${bad.length} rows have invalid stage (e.g. centre_id=${bad[0].centre_id} stage=${JSON.stringify(bad[0].stage)})`,
    );
  pass(id, `Stage validity: all ${rows.length} stages are in allowed set`);
});

test('T10 — Score-stage consistency', async () => {
  const id = 'T10';
  const rows = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=centre_id,tide_score,stage`,
  );
  const bad = rows.filter((r) => {
    if (r.tide_score == null) return false;
    if (r.tide_score > 80 && r.stage !== 'High Tide') return true;
    if (r.tide_score < 20 && r.stage !== 'Flat' && r.stage !== 'Low')
      return true;
    return false;
  });
  if (bad.length) {
    const ex = bad[0];
    return fail(
      id,
      `Score-stage consistency: ${bad.length} contradictions (e.g. centre_id=${ex.centre_id} score=${ex.tide_score} stage=${ex.stage})`,
    );
  }
  pass(id, `Score-stage consistency: all ${rows.length} rows consistent`);
});

test('T11 — No duplicate scores: each centre has exactly one row today', async () => {
  const id = 'T11';
  const rows = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=centre_id`,
  );
  const counts = new Map();
  for (const r of rows) counts.set(r.centre_id, (counts.get(r.centre_id) || 0) + 1);
  const dupes = [...counts.entries()].filter(([, n]) => n > 1);
  if (dupes.length)
    return fail(
      id,
      `Duplicate scores: ${dupes.length} centres have >1 row today (e.g. centre_id=${dupes[0][0]} count=${dupes[0][1]})`,
    );
  pass(id, `No duplicates: ${counts.size} centres, one row each`);
});

test('T12 — Score pipeline ran after scraper (scores newer than events)', async () => {
  const id = 'T12';
  const lastEvent = await selectAll(
    `brand_sale_events?date=eq.${TODAY}&select=created_at&order=created_at.desc&limit=1`,
  );
  if (lastEvent.length === 0)
    return fail(id, `No brand_sale_events rows today; cannot verify pipeline ordering`);

  const firstScore = await selectAll(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&select=created_at&order=created_at.asc&limit=1`,
  );
  if (firstScore.length === 0)
    return fail(id, `No centre_seer_scores rows today; scorer did not run`);

  const eventTs = new Date(lastEvent[0].created_at).getTime();
  const scoreTs = new Date(firstScore[0].created_at).getTime();
  if (scoreTs < eventTs)
    return fail(
      id,
      `Scores stale: earliest score (${firstScore[0].created_at}) is older than latest event (${lastEvent[0].created_at})`,
    );
  pass(id, `Score pipeline: earliest score newer than latest event`);
});

// ── AREA 3: SUPABASE DATA INTEGRITY ─────────────────────────────────────────

test('T13 — RLS enabled on user-data tables', async () => {
  const id = 'T13';
  const tables = [
    'brand_sale_events',
    'centre_seer_scores',
    'user_preferences',
    'personal_tide_scores',
    'audit_log',
  ];
  // Try optional RPC. If absent, this is a known limitation (documented).
  const probe = await rpc('regression_check_rls', { table_names: tables });
  if (probe.status === 404) {
    return warn(
      id,
      `RLS check skipped: RPC 'regression_check_rls(text[])' not available. Add the RPC or verify via psql/dashboard.`,
    );
  }
  if (!probe.ok)
    return fail(id, `RLS check RPC errored (${probe.status}): ${probe.body}`);
  let payload;
  try {
    payload = JSON.parse(probe.body);
  } catch {
    return fail(id, `RLS check RPC returned non-JSON: ${probe.body}`);
  }
  // Expect [{ table_name, rls_enabled }, ...].
  const disabled = (Array.isArray(payload) ? payload : []).filter(
    (r) => !r.rls_enabled,
  );
  if (disabled.length)
    return fail(
      id,
      `RLS disabled on: ${disabled.map((r) => r.table_name).join(', ')}`,
    );
  pass(id, `RLS enabled on all ${tables.length} user-data tables`);
});

test('T14 — date_first_detected immutability trigger exists', async () => {
  const id = 'T14';
  const probe = await rpc('regression_check_trigger', {
    table_name: 'brand_sale_events',
    trigger_name: 'enforce_date_first_detected_immutable',
  });
  if (probe.status === 404)
    return warn(
      id,
      `Trigger check skipped: RPC 'regression_check_trigger' not available. Verify via psql.`,
    );
  if (!probe.ok)
    return fail(id, `Trigger check RPC errored (${probe.status}): ${probe.body}`);
  let payload;
  try {
    payload = JSON.parse(probe.body);
  } catch {
    return fail(id, `Trigger check RPC returned non-JSON: ${probe.body}`);
  }
  const exists = payload === true || payload?.exists === true;
  if (!exists)
    return fail(
      id,
      `Trigger 'enforce_date_first_detected_immutable' missing from brand_sale_events`,
    );
  pass(id, `Trigger 'enforce_date_first_detected_immutable' present`);
});

test('T15 — Required columns exist on each table', async () => {
  const id = 'T15';
  const expected = {
    brand_sale_events: ['brand_id', 'date', 'sale_status', 'date_first_detected'],
    centre_seer_scores: ['centre_id', 'tide_score', 'stage', 'date'],
    user_preferences: ['user_id', 'womenswear', 'menswear', 'childrenswear'],
    personal_tide_scores: ['user_id', 'centre_id', 'personal_score', 'date'],
  };
  const missing = [];
  for (const [table, cols] of Object.entries(expected)) {
    for (const col of cols) {
      const res = await rest(`${table}?select=${col}&limit=1`);
      if (!res.ok) missing.push(`${table}.${col}`);
    }
  }
  if (missing.length)
    return fail(id, `Missing columns: ${missing.join(', ')}`);
  pass(id, `All required columns present across 4 tables`);
});

test('T16 — No null tide_scores written today', async () => {
  const id = 'T16';
  const count = await selectCount(
    `centre_seer_scores?${SCORE_DATE_COL}=eq.${TODAY}&tide_score=is.null`,
  );
  if (count === null)
    return fail(id, `Could not query null tide_scores count`);
  if (count > 0)
    return fail(id, `${count} centre_seer_scores rows have null tide_score today`);
  pass(id, `No null tide_scores: 0 rows with null today`);
});

test('T17 — Brands list has explicit renderMode', async () => {
  const id = 'T17';
  // renderMode lives in brands.js (scraper config), not the DB.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const brandsPath = resolve(here, '..', '..', 'brands.js');
    const mod = await import(brandsPath);
    const list = mod.brands || [];
    if (list.length < 75)
      return fail(
        id,
        `Brands list has ${list.length} entries (expected at least 75)`,
      );
    const bad = list.filter(
      (b) => b.renderMode !== 'static' && b.renderMode !== 'browser',
    );
    if (bad.length)
      return fail(
        id,
        `${bad.length} brand(s) missing/invalid renderMode (e.g. id=${bad[0].id})`,
      );
    pass(
      id,
      `Brands renderMode: ${list.length} brands all explicitly 'static' or 'browser'`,
    );
  } catch (e) {
    fail(id, `Could not load brands.js: ${e.message}`);
  }
});

// ── AREA 4: AUDIT LOG ───────────────────────────────────────────────────────

test('T18 — Scraper audit_log row exists for today', async () => {
  const id = 'T18';
  const res = await rest(
    `audit_log?run_type=eq.scraper&select=id,created_at&created_at=gte.${TODAY}T00:00:00&created_at=lt.${TODAY}T23:59:59&limit=1`,
  );
  if (res.status === 404)
    return fail(id, `audit_log table not exposed via REST (404)`);
  if (!res.ok) {
    const text = await res.text();
    return fail(id, `audit_log query failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  if (!rows.length)
    return fail(id, `No audit_log row for today with run_type='scraper'`);
  pass(id, `Scraper audit row present for ${TODAY}`);
});

test('T19 — Scorer audit_log row exists for today', async () => {
  const id = 'T19';
  const res = await rest(
    `audit_log?run_type=eq.scorer&select=id,created_at&created_at=gte.${TODAY}T00:00:00&created_at=lt.${TODAY}T23:59:59&limit=1`,
  );
  if (res.status === 404)
    return fail(id, `audit_log table not exposed via REST (404)`);
  if (!res.ok) {
    const text = await res.text();
    return fail(id, `audit_log query failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  if (!rows.length)
    return fail(id, `No audit_log row for today with run_type='scorer'`);
  pass(id, `Scorer audit row present for ${TODAY}`);
});

test('T20 — No catastrophic failure flags in audit_log today', async () => {
  const id = 'T20';
  const res = await rest(
    `audit_log?select=run_type,error_summary,created_at&created_at=gte.${TODAY}T00:00:00&created_at=lt.${TODAY}T23:59:59`,
  );
  if (res.status === 404)
    return fail(id, `audit_log table not exposed via REST (404)`);
  if (!res.ok) {
    const text = await res.text();
    return fail(id, `audit_log query failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  const bad = rows.filter((r) => {
    const s = (r.error_summary || '').toString();
    return s.includes('FATAL') || s.includes('brands_succeeded = 0');
  });
  if (bad.length)
    return fail(
      id,
      `${bad.length} audit_log row(s) today contain FATAL or brands_succeeded=0 (e.g. ${bad[0].run_type})`,
    );
  pass(id, `No catastrophic failure flags in ${rows.length} audit rows today`);
});

// ── AREA 5: HEALTH VIEW ─────────────────────────────────────────────────────

test('T21 — v_system_health view exists and returns one row', async () => {
  const id = 'T21';
  const res = await rest(`v_system_health?select=*`);
  if (res.status === 404)
    return fail(id, `v_system_health view not exposed via REST (404)`);
  if (!res.ok) {
    const text = await res.text();
    return fail(id, `v_system_health query failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  if (rows.length !== 1)
    return fail(
      id,
      `v_system_health returned ${rows.length} rows (expected exactly 1)`,
    );
  pass(id, `v_system_health view exists and returned 1 row`);
});

test('T22 — Health view freshness: last_scraper_run_date is today', async () => {
  const id = 'T22';
  const res = await rest(`v_system_health?select=last_scraper_run_date`);
  if (!res.ok) {
    if (res.status === 404)
      return fail(id, `v_system_health view not available`);
    const text = await res.text();
    return fail(id, `v_system_health query failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  if (!rows.length) return fail(id, `v_system_health empty`);
  const last = rows[0]?.last_scraper_run_date;
  if (!last) return fail(id, `last_scraper_run_date is null/missing`);
  const lastDate = String(last).slice(0, 10);
  if (lastDate !== TODAY)
    return fail(
      id,
      `Health view stale: last_scraper_run_date=${lastDate}, expected ${TODAY}`,
    );
  pass(id, `Health view fresh: last_scraper_run_date=${TODAY}`);
});

// ── summary ─────────────────────────────────────────────────────────────────

after(() => {
  const order = [
    'T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11',
    'T12','T13','T14','T15','T16','T17','T18','T19','T20','T21','T22',
  ];
  const byId = new Map(results.map((r) => [r.id, r]));

  const icons = { PASS: '✅ PASS ', WARN: '⚠️  WARN ', FAIL: '❌ FAIL ', SKIP: '⏭️  SKIP ' };

  console.log('');
  console.log('───────────── REGRESSION RESULTS ─────────────');
  for (const id of order) {
    const r = byId.get(id) || {
      id,
      status: 'FAIL',
      message: 'Test did not record a result (threw before recording)',
    };
    console.log(`${icons[r.status] || r.status}  ${r.id} — ${r.message}`);
  }

  const total = order.length;
  const passed = order.filter((id) => byId.get(id)?.status === 'PASS').length;
  const warned = order.filter((id) => byId.get(id)?.status === 'WARN').length;
  const skipped = order.filter((id) => byId.get(id)?.status === 'SKIP').length;
  const failed = total - passed - warned - skipped;

  console.log('───────────────────────────────────────────────');
  console.log(
    `REGRESSION SUITE: ${total} tests | ${passed} passed | ${warned} warned | ${failed} failed${skipped ? ` | ${skipped} skipped` : ''}`,
  );

  // Write a GitHub Actions step summary if running in CI.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [];
    lines.push(`# Tide regression suite — ${TODAY}`);
    lines.push('');
    lines.push(
      `**${total} tests | ${passed} passed | ${warned} warned | ${failed} failed${skipped ? ` | ${skipped} skipped` : ''}**`,
    );
    lines.push('');
    const fails = order
      .map((id) => byId.get(id))
      .filter((r) => r && r.status === 'FAIL');
    if (fails.length) {
      lines.push('## ❌ Failures');
      lines.push('');
      for (const r of fails) lines.push(`- **${r.id}** — ${r.message}`);
      lines.push('');
    }
    const warns = order
      .map((id) => byId.get(id))
      .filter((r) => r && r.status === 'WARN');
    if (warns.length) {
      lines.push('## ⚠️ Warnings');
      lines.push('');
      for (const r of warns) lines.push(`- **${r.id}** — ${r.message}`);
      lines.push('');
    }
    lines.push('## All results');
    lines.push('');
    lines.push('| ID | Status | Message |');
    lines.push('|----|--------|---------|');
    for (const id of order) {
      const r = byId.get(id) || { status: 'FAIL', message: 'no result' };
      lines.push(`| ${id} | ${r.status} | ${(r.message || '').replace(/\|/g, '\\|')} |`);
    }
    try {
      appendFileSync(summaryPath, lines.join('\n') + '\n');
    } catch {
      /* ignore — summary write is best-effort */
    }
  }

  // node:test sets exit code automatically when assert.fail throws,
  // but force it explicitly so WARN-only runs exit 0 and FAIL runs exit 1.
  if (failed > 0) process.exitCode = 1;
});
