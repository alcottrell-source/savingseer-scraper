#!/usr/bin/env node
// Read-only sale-cycle analysis over the recorded Tide Score history.
//
// The app stores full real sale cycles (climb → crest → decline) in
// centre_seer_scores. This script replays every centre's day-by-day scores
// through the COMMITTED stage rules (lib/tide-machine.js stageStep — parity
// twin of score.js getTideStage; trajectory-gated High Tide hold since D18)
// and through the LEGACY pre-D18 score-only hold, then reports where the
// stored "Peak" (GO NOW) verdict outlived the crest — the owner-reported bug
// (fixed by D18) where a centre read "Go now" all the way down the far side
// of the tide. Diagnostic evidence for that fix and a permanent sanity check
// for future verdict-rule changes.
//
// Per centre it prints the full timeline (date, score, stored trajectory /
// verdict, replay-old (pre-D18 rule), replay-new (committed rules),
// divergence marker) plus:
//   M1  stored-Peak days past the crest while the score was declining
//   M2  total Peak days: stored vs replay-old vs replay-new
//   M3  Peak-ENTRY events (≈ peak-alert emails) old vs new
//   M4  crest → first-Easing lag per High-Tide episode, old vs new
//   M5  slow-drip episodes: score fell ≥5pts from crest with no FALLING day
//       (decides whether an episode-max exit guard is needed)
//   M6  deploy-day preview: centres whose LATEST stored verdict is Peak and
//       what the committed rules emit for that same day
//
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/analyze-tide-cycles.mjs ["centre name filter"]
// Needs outbound network + the service key — won't run in the dev sandbox
// (run via .github/workflows/analyze-tide-cycles.yml and read the job log).
// READ-ONLY: only `select` queries, never a write.

import { createClient } from '@supabase/supabase-js';
import { trajectoryStep, stageStep, daysBetween, TIDE, STAGE_FROM_VERDICT } from '../lib/tide-machine.js';

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

// PostgREST caps a single response at ~1000 rows with no error (the same
// silent truncation that froze tide_history at 2026-06-01 — see score.js).
// ~37 centres × 180 days ≈ 6,600 rows, so paging is mandatory here.
async function selectAllRows(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (data && data.length) out.push(...data);
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

// ── Legacy (pre-D18) rule: score-only High Tide hold ────────────────────────
// The committed rules (imported stageStep) are trajectory-gated since D18;
// this inline copy keeps the OLD unconditional 40/30 hold so every run shows
// the before/after — how many "Go now" days the amendment removes.
function legacyStageStep(score, prevStage, traj, prevTraj, C = TIDE) {
  const wasHigh = prevStage === 'High Tide';
  const wasDescent = prevStage === 'Falling' || prevStage === 'Low';
  const localPeak = prevTraj === 'RISING' && traj !== 'RISING';

  if (score === 0) {
    if (wasHigh || wasDescent) return { stage: 'Low', verdict: 'Over' };
    return { stage: 'Turning', verdict: 'Quiet' };
  }
  if (score >= C.HIGH_TIDE_ENTER || (wasHigh && score >= C.HIGH_TIDE_EXIT)) {
    return { stage: 'High Tide', verdict: 'Peak' };
  }
  if (wasHigh || wasDescent) {
    if (prevStage === 'Low' && traj === 'RISING' && score >= C.RISING_FLOOR) {
      return { stage: 'Rising', verdict: 'Rising' };
    }
    if (score < C.OVER_CEILING) return { stage: 'Low', verdict: 'Over' };
    return { stage: 'Falling', verdict: 'Easing' };
  }
  if (score >= C.RISING_FLOOR) {
    if (localPeak) return { stage: 'High Tide', verdict: 'Peak' };
    return { stage: 'Rising', verdict: 'Rising' };
  }
  return { stage: 'Turning', verdict: 'Quiet' };
}

const isPeakVerdict = v => v === 'Peak' || v === 'Go now';

// Stored rows can carry pre-rename verdict strings; normalise to the current
// vocabulary (via the stage they map to) so divergence flags compare like
// with like.
const VERDICT_FROM_STAGE = { 'High Tide': 'Peak', 'Falling': 'Easing', 'Rising': 'Rising', 'Turning': 'Quiet', 'Low': 'Over' };
function normVerdict(v) {
  const stage = STAGE_FROM_VERDICT[v];
  return stage ? VERDICT_FROM_STAGE[stage] : v;
}

// Replay one centre's rows (oldest-first) through a stage rule. Trajectory is
// recomputed from the scores with tide-machine gap semantics (window broken
// after >GAP_BREAK_DAYS; FLAT rebuild) so both rules see identical inputs.
function replay(rows, stepFn) {
  const out = [];
  let prevStage = null, priorTraj = null, recent = [], observedDays = 0, prevDate = null;
  let crestWin = []; // {date, score} within CREST_WINDOW_DAYS, excludes today (D19)
  for (const r of rows) {
    const gap = prevDate ? daysBetween(prevDate, r.score_date) : 1;
    if (gap > TIDE.GAP_BREAK_DAYS) { recent = []; priorTraj = 'FLAT'; crestWin = []; }
    observedDays += 1;
    crestWin = crestWin.filter(e => (daysBetween(e.date, r.score_date) ?? Infinity) <= TIDE.CREST_WINDOW_DAYS);
    const recentCrest = crestWin.length ? Math.max(...crestWin.map(e => e.score)) : null;
    const traj = trajectoryStep(r.tide_score, recent, priorTraj, observedDays);
    const { stage, verdict } = stepFn(r.tide_score, prevStage, traj, priorTraj, recentCrest);
    out.push({ traj, stage, verdict });
    recent = [r.tide_score, ...recent].slice(0, 3);
    crestWin = [{ date: r.score_date, score: r.tide_score }, ...crestWin];
    priorTraj = traj;
    prevStage = stage;
    prevDate = r.score_date;
  }
  return out;
}

// High-Tide episodes = contiguous runs of score ≥ HIGH_TIDE_ENTER (the same
// definition the chart's amber crest dot uses). Crest = the run's max score
// (first day of the max). The episode "tail" extends past the ≥40 run until
// the score drops below OVER_CEILING or the next episode starts — that's the
// window where a stale Peak can linger via the 30-hold band.
function findEpisodes(rows) {
  const eps = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (r.tide_score >= TIDE.HIGH_TIDE_ENTER) {
      if (!cur) cur = { startIdx: i, endIdx: i };
      else cur.endIdx = i;
    } else if (cur) { eps.push(cur); cur = null; }
  });
  if (cur) eps.push(cur);
  for (const ep of eps) {
    let crestIdx = ep.startIdx;
    for (let i = ep.startIdx; i <= ep.endIdx; i++) {
      if (rows[i].tide_score > rows[crestIdx].tide_score) crestIdx = i;
    }
    ep.crestIdx = crestIdx;
    ep.crestScore = rows[crestIdx].tide_score;
    ep.crestDate = rows[crestIdx].score_date;
  }
  return eps;
}

function pad(v, n) { return String(v ?? '—').padEnd(n); }

// Pure helpers exported for the unit smoke test (the CLI entry below is
// guarded, matching score.js's pattern, so importing never touches the DB).
export { legacyStageStep, replay, findEpisodes, normVerdict, isPeakVerdict };

const isCliEntry = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isCliEntry) (async () => {
  const filter = process.argv.slice(2).join(' ').trim();
  const sb = getSupabase();
  const SINCE = dateStr(-180);

  let centreQuery = sb.from('centres').select('id, name').eq('active', true).order('name');
  if (filter) centreQuery = centreQuery.ilike('name', `%${filter}%`);
  const { data: centres, error: cErr } = await centreQuery;
  if (cErr) { console.error('centres query failed:', cErr.message); process.exit(1); }
  if (!centres || !centres.length) { console.error(`No active centre matching "${filter}".`); process.exit(1); }

  const { data: allRows, error: sErr } = await selectAllRows(() => sb
    .from('centre_seer_scores')
    .select('centre_id, score_date, tide_score, verdict, trajectory, brands_on_sale, total_brands')
    .gte('score_date', SINCE)
    .not('tide_score', 'is', null)
    .order('centre_id', { ascending: true })
    .order('score_date', { ascending: true }));
  if (sErr) { console.error('centre_seer_scores query failed:', sErr.message); process.exit(1); }

  const rowsByCentre = new Map();
  for (const r of allRows || []) {
    if (!rowsByCentre.has(r.centre_id)) rowsByCentre.set(r.centre_id, []);
    rowsByCentre.get(r.centre_id).push(r);
  }

  const totals = {
    m1: 0,
    peakDaysStored: 0, peakDaysOld: 0, peakDaysNew: 0,
    entriesOld: 0, entriesNew: 0,
    lagsOld: [], lagsNew: [],
    m5: [], m6: [],
  };

  console.log(`Tide sale-cycle analysis — ${centres.length} centre(s), scores since ${SINCE} (today ${dateStr(0)})`);
  console.log(`Rules: new = lib/tide-machine.js stageStep (trajectory-gated hold, D18); old = pre-D18 score-only hold\n`);

  for (const centre of centres) {
    const rows = rowsByCentre.get(centre.id) || [];
    if (rows.length < 2) {
      console.log(`── ${centre.name} (${centre.id}): only ${rows.length} scored day(s) — skipped\n`);
      continue;
    }
    const oldR = replay(rows, legacyStageStep);
    const newR = replay(rows, stageStep);
    const eps = findEpisodes(rows);

    // M1: stored-Peak days past the crest — in-episode after the crest with a
    // lower score, or in the tail after the ≥40 run while the hold band kept it.
    let m1 = 0;
    const pastCrest = new Set();
    for (const ep of eps) {
      const tailEnd = (() => {
        for (let i = ep.endIdx + 1; i < rows.length; i++) {
          if (rows[i].tide_score >= TIDE.HIGH_TIDE_ENTER) return i - 1;      // next episode starts
          if (rows[i].tide_score < TIDE.OVER_CEILING) return i;             // cycle over
        }
        return rows.length - 1;
      })();
      for (let i = ep.crestIdx + 1; i <= tailEnd; i++) {
        if (isPeakVerdict(rows[i].verdict) && rows[i].tide_score < ep.crestScore) {
          m1++; pastCrest.add(i);
        }
      }
      // M4: crest → first non-Peak day per rule
      const lagOf = replayed => {
        for (let i = ep.crestIdx + 1; i <= tailEnd; i++) {
          if (replayed[i].verdict !== 'Peak') return daysBetween(ep.crestDate, rows[i].score_date);
        }
        return null; // never exited within the window (or window ends)
      };
      ep.lagOld = lagOf(oldR);
      ep.lagNew = lagOf(newR);
      if (ep.lagOld != null) totals.lagsOld.push(ep.lagOld);
      if (ep.lagNew != null) totals.lagsNew.push(ep.lagNew);
      // M5: slow-drip — fell ≥5pts from crest, yet no replayed FALLING day in the span
      let minAfter = ep.crestScore, sawFalling = false;
      for (let i = ep.crestIdx + 1; i <= tailEnd; i++) {
        minAfter = Math.min(minAfter, rows[i].tide_score);
        if (newR[i].traj === 'FALLING') sawFalling = true;
      }
      if (ep.crestScore - minAfter >= 5 && !sawFalling) {
        totals.m5.push({ centre: centre.name, crestDate: ep.crestDate, crestScore: ep.crestScore, minAfter });
      }
    }

    const peakDays = arr => arr.filter(x => isPeakVerdict(x.verdict)).length;
    const entries = arr => arr.filter((x, i) => x.verdict === 'Peak' && (i === 0 || arr[i - 1].verdict !== 'Peak')).length;
    const storedPeakDays = rows.filter(r => isPeakVerdict(r.verdict)).length;

    totals.m1 += m1;
    totals.peakDaysStored += storedPeakDays;
    totals.peakDaysOld += peakDays(oldR);
    totals.peakDaysNew += peakDays(newR);
    totals.entriesOld += entries(oldR);
    totals.entriesNew += entries(newR);

    console.log(`── ${centre.name} (${centre.id}) — ${rows.length} days ──────────────────────────`);
    console.log(pad('date', 12) + pad('score', 7) + pad('N/M', 8) + pad('traj*', 9) + pad('stored', 9) + pad('old', 9) + pad('new', 10) + 'flags');
    rows.forEach((r, i) => {
      const flags = [
        newR[i].verdict !== normVerdict(r.verdict) ? 'CHANGED' : '',
        pastCrest.has(i) ? 'STALE-PEAK' : '',
        eps.some(e => e.crestIdx === i) ? '◆CREST' : '',
      ].filter(Boolean).join(' ');
      const storedT = r.trajectory ? ` (${r.trajectory[0]})` : '';
      console.log(
        pad(r.score_date, 12) + pad(r.tide_score, 7) +
        pad(`${r.brands_on_sale ?? '—'}/${r.total_brands ?? '—'}`, 8) +
        pad(newR[i].traj + storedT, 9) +
        pad(r.verdict, 9) + pad(oldR[i].verdict, 9) + pad(newR[i].verdict, 10) + flags);
    });
    console.log(`  episodes(≥${TIDE.HIGH_TIDE_ENTER}): ${eps.length ? eps.map(e =>
      `crest ${e.crestDate}@${e.crestScore}% (Peak→Easing lag old=${e.lagOld ?? '∞'}d new=${e.lagNew ?? '∞'}d)`).join('; ') : 'none'}`);
    console.log(`  M1 stale GO-NOW days (stored): ${m1}   M2 Peak days stored/old/new: ${storedPeakDays}/${peakDays(oldR)}/${peakDays(newR)}   M3 Peak entries old/new: ${entries(oldR)}/${entries(newR)}\n`);

    // M6: deploy-day preview
    const last = rows[rows.length - 1], lastIdx = rows.length - 1;
    if (isPeakVerdict(last.verdict)) {
      totals.m6.push({
        centre: centre.name, date: last.score_date, score: last.tide_score,
        storedTraj: last.trajectory, replayTraj: newR[lastIdx].traj, committed: newR[lastIdx].verdict,
      });
    }
  }

  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—';
  console.log('════════ SUMMARY ════════');
  console.log(`M1 stored "Go now" days past a crest while declining: ${totals.m1}`);
  console.log(`M2 Peak days — stored: ${totals.peakDaysStored}   replay-old: ${totals.peakDaysOld}   replay-new: ${totals.peakDaysNew}`);
  console.log(`M3 Peak-entry events (≈ alert emails) — old: ${totals.entriesOld}   new: ${totals.entriesNew}`);
  console.log(`M4 crest → first-Easing lag — old avg: ${avg(totals.lagsOld)}d (n=${totals.lagsOld.length})   new avg: ${avg(totals.lagsNew)}d (n=${totals.lagsNew.length})`);
  console.log(`M5 slow-drip episodes (fell ≥5pts from crest, no FALLING day): ${totals.m5.length}`);
  for (const e of totals.m5) console.log(`    ⚠ ${e.centre}: crest ${e.crestDate}@${e.crestScore}% → min ${e.minAfter}% with trajectory never FALLING`);
  console.log(`M6 centres whose LATEST stored verdict is Peak: ${totals.m6.length}`);
  for (const e of totals.m6) {
    console.log(`    ${e.centre}: ${e.date} score ${e.score}% storedTraj=${e.storedTraj ?? '—'} replayTraj=${e.replayTraj} → committed rules read ${e.committed}${e.committed !== 'Peak' ? '  (corrects on first post-deploy run)' : ''}`);
  }
  console.log('');
})().catch(err => { console.error(err); process.exit(1); });
