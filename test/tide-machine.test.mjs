// Unit tests for lib/tide-machine.js — the explicit Tide lifecycle machine.
// Spec: docs/architecture/tide-score.md (ADR-002). Run with: npm test
//
// The parity suite proves the machine is behaviour-identical to score.js's
// getTideStage/getTrajectory on the no-gap path (ADR-002 §3); the deliberate
// divergences (V2 post-gap FLAT, V3 gap semantics) get their own tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrajectory, getTideStage } from '../score.js';
import {
  TIDE, STAGES, STAGE_FROM_VERDICT,
  trajectoryStep, stageStep, initTideState, nextTideState, stateFromRow,
} from '../lib/tide-machine.js';

const D0 = '2026-07-01';
const d = (offset) => {
  const t = new Date(Date.parse(D0 + 'T00:00:00Z') + offset * 86400000);
  return t.toISOString().slice(0, 10);
};

// Fold a series of {score} observations from day 0, one per day.
function run(scores) {
  let s = null;
  scores.forEach((score, i) => { s = nextTideState(s, { date: d(i), score }); });
  return s;
}

// ── Parity suite (ADR-002 §11): machine ≡ score.js on the no-gap path ────────

test('parity: trajectoryStep ≡ getTrajectory across the sweep grid', () => {
  const windows = [[50, 50, 50], [20, 22, 25], [10, 8, 5], [40, 30, 20]];
  const diffs = [-6, -3, -1, 0, 2, 5];
  const priors = [null, 'RISING', 'FLAT', 'FALLING'];
  for (const w of windows) for (const diff of diffs) for (const prior of priors) {
    const avg = (w[0] + w[1] + w[2]) / 3;
    const score = avg + diff;
    assert.equal(
      trajectoryStep(score, w, prior, 10),      // observedDays ≥ 3: established centre
      getTrajectory(score, w, prior),
      `w=${w} diff=${diff} prior=${prior}`);
  }
  // Short-window default parity: score.js defaults RISING for <3 rows; the
  // machine matches when the centre is genuinely new (observedDays < 3).
  assert.equal(trajectoryStep(50, [], null, 1), getTrajectory(50, [], null));
  assert.equal(trajectoryStep(50, [40, 30], null, 2), getTrajectory(50, [40, 30], null));
});

test('parity: stageStep ≡ getTideStage across the full grid', () => {
  const scores = [0, 5, 7.9, 8, 10, 14.9, 15, 16, 25, 29, 29.9, 30, 31, 35, 39, 39.9, 40, 41, 60, 100];
  const stages = [null, 'Turning', 'Rising', 'High Tide', 'Falling', 'Low'];
  const trajs = [null, 'RISING', 'FLAT', 'FALLING'];
  let checked = 0;
  for (const score of scores) for (const prev of stages)
    for (const traj of ['RISING', 'FLAT', 'FALLING']) for (const prevTraj of trajs) {
      const ours = stageStep(score, prev, traj, prevTraj);
      const theirs = getTideStage(score, prev, traj, prevTraj);
      assert.equal(ours.stage, theirs.stage, `stage @ s=${score} prev=${prev} t=${traj} pt=${prevTraj}`);
      assert.equal(ours.verdict, theirs.verdict, `verdict @ s=${score} prev=${prev} t=${traj} pt=${prevTraj}`);
      checked++;
    }
  assert.ok(checked >= 1400, `grid actually swept (${checked} combos)`);
});

test('parity: STAGE_FROM_VERDICT carries all 13 strings incl. legacy', () => {
  assert.equal(Object.keys(STAGE_FROM_VERDICT).length, 13);
  for (const stage of Object.values(STAGE_FROM_VERDICT)) assert.ok(STAGES.includes(stage));
});

// ── Edge cases E1–E9 (ADR-002 §6) ───────────────────────────────────────────

test('E1 — new centre day 1: RISING default, stage from the table with null prev', () => {
  const s = initTideState({ date: D0, score: 20 });
  assert.equal(s.trajectory, 'RISING');
  assert.equal(s.stage, 'Rising');
  assert.equal(s.observedDays, 1);
  assert.equal(s.daysInStage, 0);
  assert.equal(s.stageEnteredDate, D0);
});

test('E2 — constant-score centre stays RISING forever (preserved quirk, OQ1)', () => {
  const s = run(Array(10).fill(20));
  assert.equal(s.trajectory, 'RISING');
  assert.equal(s.verdict, 'Rising');
  assert.equal(s.lastPeakDate, null, 'never fires its local peak');
});

test('E3 — one-shot local peak resolves to Easing the next day', () => {
  // Climb 16→20→24→27, then a real roll-over (22 is 1.67 below the 3-day
  // average): sticky RISING drops to FLAT → T7 fires once, then descent.
  const s = run([16, 20, 24, 27, 22, 22]);
  assert.equal(s.verdict, 'Easing', 'day after the one-shot peak');
  assert.equal(s.stage, 'Falling');
  assert.ok(s.lastPeakDate, 'peak date recorded');
  const peak = run([16, 20, 24, 27, 22]); // stop on the peak day itself
  assert.equal(peak.verdict, 'Peak');
  assert.equal(peak.stage, 'High Tide');
  assert.equal(s.lastPeakDate, peak.date, 'lastPeakDate survives past the peak');
});

test('E4 — High Tide hysteresis: hold to 30, exit below, re-enter at 40 only', () => {
  let s = run([20, 30, 45]);                       // enter at 45
  assert.equal(s.verdict, 'Peak');
  s = nextTideState(s, { date: d(3), score: 35 }); // hold band
  assert.equal(s.verdict, 'Peak');
  assert.equal(s.daysInStage, 1, 'still the same High Tide stint');
  s = nextTideState(s, { date: d(4), score: 29 }); // exit
  assert.equal(s.verdict, 'Easing');
  s = nextTideState(s, { date: d(5), score: 35 }); // 35 < 40: no re-entry from Falling
  assert.equal(s.verdict, 'Easing');
  s = nextTideState(s, { date: d(6), score: 41 }); // genuine re-entry
  assert.equal(s.verdict, 'Peak');
});

test('E5 — new-cycle escape only from Low, with RISING, at ≥15', () => {
  // Down to Low…
  let s = run([20, 45, 45, 30, 25, 6]);
  assert.equal(s.stage, 'Low');
  // …hold Low (7 < OVER_CEILING keeps the stage; a mid-band score would
  // move it to Falling and forfeit the escape — see E5b)…
  s = nextTideState(s, { date: d(6), score: 7 });
  assert.equal(s.stage, 'Low');
  // …then a genuine rebuild: 18 is >4 above the 3-day average, flipping the
  // sticky FALLING trajectory straight to RISING → T4 fires.
  s = nextTideState(s, { date: d(7), score: 18 });
  assert.equal(s.stage, 'Rising', 'escape fires');
  assert.equal(s.verdict, 'Rising');
});

test('E5b — no escape from Falling: post-peak wobble stays Easing', () => {
  assert.equal(stageStep(20, 'Falling', 'RISING', 'RISING').verdict, 'Easing');
});

test('E6 — crash to zero from High Tide goes straight to Over', () => {
  let s = run([20, 45, 45]);
  s = nextTideState(s, { date: d(3), score: 0 });
  assert.equal(s.stage, 'Low');
  assert.equal(s.verdict, 'Over');
});

test('E7 — zero on a never-cycled centre stays Quiet, even after months', () => {
  const s = run(Array(60).fill(0));
  assert.equal(s.verdict, 'Quiet');
  assert.equal(s.daysInStage, 59, 'daysInStage counts the whole dormant stint');
});

test('E8 — local peak can fire from Turning the day the score crosses 15 (D10)', () => {
  assert.equal(stageStep(16, 'Turning', 'FLAT', 'RISING').verdict, 'Peak');
});

test('E9 — post-gap wobble does NOT fire a spurious peak (divergence V2)', () => {
  // Build real momentum, then a 10-day hole, then a dip. Old behaviour:
  // empty window → RISING default → dip = PEAK + GO NOW email. New: FLAT.
  let s = run([16, 20, 24, 28]);
  assert.equal(s.trajectory, 'RISING');
  s = nextTideState(s, { date: d(13), score: 22 }); // 10-day gap, dipped
  assert.equal(s.trajectory, 'FLAT', 'window broken → FLAT rebuild');
  assert.notEqual(s.verdict, 'Peak', 'no peak off pre-gap momentum');
  assert.equal(s.recentScores.length, 0, 'window cleared');
});

// ── Gap semantics (ADR-002 §5.4) ────────────────────────────────────────────

test('gaps ≤ GAP_BREAK_DAYS are treated as consecutive', () => {
  let s = run([16, 20, 24, 28]);
  const before = s.trajectory;
  s = nextTideState(s, { date: d(6), score: 30 }); // 3-day gap
  assert.equal(before, 'RISING');
  assert.equal(s.trajectory, 'RISING', 'window survived the short gap');
  assert.equal(s.recentScores.length, 3);
});

test('daysInStage stays calendar-true across a gap', () => {
  let s = run([20, 20]);
  s = nextTideState(s, { date: d(11), score: 20 }); // 10-day gap
  assert.equal(s.stage, 'Rising');
  assert.equal(s.daysInStage, 11, 'gap days count toward the stint');
  assert.equal(s.observedDays, 3, 'but not toward observations');
});

test('post-gap FLAT rebuild lasts until 3 fresh observations', () => {
  let s = run([16, 20, 24, 28]);
  s = nextTideState(s, { date: d(14), score: 20 });
  assert.equal(s.trajectory, 'FLAT');
  s = nextTideState(s, { date: d(15), score: 26 });
  assert.equal(s.trajectory, 'FLAT', 'still rebuilding (2 points)');
  s = nextTideState(s, { date: d(16), score: 30 });
  assert.equal(s.trajectory, 'FLAT', 'still rebuilding (3 points is the window minimum)');
  s = nextTideState(s, { date: d(17), score: 34 });
  assert.equal(s.trajectory, 'RISING', 'full window again — momentum re-established');
});

// ── Caller contract (ADR-002 §4) ────────────────────────────────────────────

test('throws on same-date and out-of-order observations', () => {
  const s = initTideState({ date: d(1), score: 20 });
  assert.throws(() => nextTideState(s, { date: d(1), score: 25 }), /must be after/);
  assert.throws(() => nextTideState(s, { date: d(0), score: 25 }), /must be after/);
});

test('intraday rescore is idempotent: re-step from yesterday, same result', () => {
  const yesterday = run([16, 20, 24]);
  const a = nextTideState(yesterday, { date: d(3), score: 27 });
  const b = nextTideState(yesterday, { date: d(3), score: 27 });
  assert.deepEqual(a, b);
});

// ── Full-cycle simulation (ADR-002 §11) ─────────────────────────────────────

test('full cycle: Quiet → Rising → Peak → hold → Easing → Over → escape', () => {
  const series = [
    { score: 3, verdict: 'Quiet' },
    { score: 10, verdict: 'Quiet' },
    { score: 18, verdict: 'Rising' },
    { score: 30, verdict: 'Rising' },
    { score: 44, verdict: 'Peak' },     // global entry
    { score: 38, verdict: 'Peak' },     // hold band
    { score: 32, verdict: 'Peak' },     // hold band
    { score: 24, verdict: 'Easing' },   // exit
    { score: 12, verdict: 'Easing' },
    { score: 5, verdict: 'Over' },
    { score: 6, verdict: 'Over' },
    { score: 16, verdict: 'Rising' },   // new-cycle escape (Low + RISING + ≥15)
  ];
  let s = null;
  series.forEach(({ score, verdict }, i) => {
    s = nextTideState(s, { date: d(i), score });
    assert.equal(s.verdict, verdict, `day ${i} (score ${score}): expected ${verdict}, got ${s.verdict} [traj ${s.trajectory}]`);
  });
  assert.equal(s.lastPeakDate, d(6), 'last day the verdict was Peak');
});

// ── Legacy loader (ADR-002 §4) ──────────────────────────────────────────────

test('stateFromRow: explicit stage wins; legacy verdicts recover; unknown → null', () => {
  const explicit = stateFromRow({ date: D0, score: 30, stage: 'Falling', verdict: 'Easing' });
  assert.equal(explicit.stage, 'Falling');

  for (const [verdict, stage] of Object.entries(STAGE_FROM_VERDICT)) {
    const s = stateFromRow({ date: D0, score: 30, verdict });
    assert.equal(s.stage, stage, `legacy '${verdict}'`);
  }

  assert.equal(stateFromRow({ date: D0, score: 30, verdict: 'Mystery words' }), null,
    'unknown verdict → treat as new centre, never throw');
  assert.equal(stateFromRow(null), null);
});

test('stateFromRow: a recovered state steps correctly (loader → machine handoff)', () => {
  const s = stateFromRow({ date: d(0), score: 35, verdict: 'Go now' }); // legacy Peak
  const next = nextTideState(s, { date: d(1), score: 32 });
  assert.equal(next.verdict, 'Peak', 'hold band honoured off a legacy-loaded High Tide');
});
