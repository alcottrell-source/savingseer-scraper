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

test('E2 — stall decay: a plateaued centre fires its one-shot peak, then eases (OQ1 fixed)', () => {
  // Constant 20% from day 1: RISING by default while young; the first full
  // window (day 4) reads a dead-flat span → FLAT → local peak fires once.
  const s4 = run([20, 20, 20, 20]);
  assert.equal(s4.trajectory, 'FLAT');
  assert.equal(s4.verdict, 'Peak', 'the plateau IS the peak');
  const s5 = run([20, 20, 20, 20, 20]);
  assert.equal(s5.verdict, 'Easing', 'one-shot resolves the next day');
  assert.equal(s5.lastPeakDate, s4.date);
  const s10 = run(Array(10).fill(20));
  assert.equal(s10.verdict, 'Easing', 'no second peak from the same plateau');
  assert.equal(s10.lastPeakDate, s4.date);
});

test('E2b — stall decay after a real climb: peak fires once the window catches the plateau', () => {
  // 16→20→24→27, then flat 27s. Sticky RISING holds while the 3-day window
  // still contains climb points (span ≥ 1.5); the third plateau day makes
  // the window dead flat → FLAT → one-shot peak, then descent.
  const climb = run([16, 20, 24, 27, 27, 27]);
  assert.equal(climb.trajectory, 'RISING', 'window still spans the climb — no stall yet');
  const peak = run([16, 20, 24, 27, 27, 27, 27]);
  assert.equal(peak.verdict, 'Peak');
  assert.equal(peak.trajectory, 'FLAT');
  const after = run([16, 20, 24, 27, 27, 27, 27, 27]);
  assert.equal(after.verdict, 'Easing');
  assert.equal(after.lastPeakDate, peak.date);
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

test('E4 — High Tide hold: 30+ band survives while not falling, re-enter at 40 only', () => {
  // The hold is trajectory-conditional since the 2026-07 amendment: the
  // 35-score day below still computes RISING (diff +3.3 vs the window, span
  // well over the stall range), so the 30–40 band holds it at Peak.
  let s = run([20, 30, 45]);                       // enter at 45
  assert.equal(s.verdict, 'Peak');
  s = nextTideState(s, { date: d(3), score: 35 }); // hold band, still RISING
  assert.equal(s.trajectory, 'RISING');
  assert.equal(s.verdict, 'Peak');
  assert.equal(s.daysInStage, 1, 'still the same High Tide stint');
  s = nextTideState(s, { date: d(4), score: 29 }); // exit
  assert.equal(s.verdict, 'Easing');
  s = nextTideState(s, { date: d(5), score: 35 }); // 35 < 40: no re-entry from Falling
  assert.equal(s.verdict, 'Easing');
  s = nextTideState(s, { date: d(6), score: 41 }); // genuine re-entry (RISING + ≥40)
  assert.equal(s.trajectory, 'RISING');
  assert.equal(s.verdict, 'Peak');
});

test('E10 — confirmed decline exits Peak ABOVE the hold band (stale GO-NOW fix)', () => {
  // The first recorded full cycle: crest ~55, then a clear decline. The old
  // score-only hold kept "Go now" until <30; now the FALLING confirm ends it
  // while the score is still 42.
  let s = run([10, 30, 45, 55]);
  assert.equal(s.verdict, 'Peak');
  s = nextTideState(s, { date: d(4), score: 48 }); // +4.7 vs window: a steep climb
  assert.equal(s.trajectory, 'RISING');            // reads RISING briefly past the crest
  assert.equal(s.verdict, 'Peak', 'first soft day still reads Peak');
  s = nextTideState(s, { date: d(5), score: 42 }); // -7.3 vs window: FALLING confirms
  assert.equal(s.trajectory, 'FALLING');
  assert.equal(s.verdict, 'Easing', 'decline confirmed → Easing at score 42');
  assert.equal(s.stage, 'Falling');
});

test('E11 — no bounce flap during Easing; a sustained RISING re-enters (one new peak)', () => {
  let s = run([10, 30, 45, 55, 48, 42]);           // E10 series, now Easing
  assert.equal(s.verdict, 'Easing');
  const firstPeakDate = s.lastPeakDate;
  s = nextTideState(s, { date: d(6), score: 40 }); // sticky FALLING
  assert.equal(s.verdict, 'Easing');
  s = nextTideState(s, { date: d(7), score: 44 }); // +0.7 vs window: still FALLING
  assert.equal(s.trajectory, 'FALLING');
  assert.equal(s.verdict, 'Easing', 'a ≥40 bounce alone must not flap back to Peak');
  assert.equal(s.lastPeakDate, firstPeakDate);
  s = nextTideState(s, { date: d(8), score: 50 }); // +8 vs window: RISING → re-entry
  assert.equal(s.trajectory, 'RISING');
  assert.equal(s.verdict, 'Peak', 'genuine second wave re-enters');
  assert.equal(s.lastPeakDate, d(8), 'new peak recorded');
});

test('E12 — deploy-day correction: a stored stale Peak with FALLING flips to Easing', () => {
  // 47 of 48 centres sat in exactly this state when the fix landed: stored
  // verdict Peak, stored trajectory FALLING, score still high. The first
  // post-deploy run must correct them immediately. (score.js supplies the
  // real 3-day window from SQL; recentScores mirrors that here — an empty
  // window would rebuild FLAT and hold one extra day by design.)
  const s = stateFromRow({
    date: d(0), score: 52, verdict: 'Peak', trajectory: 'FALLING',
    recentScores: [54, 55, 56],
  });
  const next = nextTideState(s, { date: d(1), score: 50 });
  assert.equal(next.verdict, 'Easing');
  assert.equal(next.stage, 'Falling');
});

test('E13 — a high plateau HOLDS Peak (sitting at the crest is not a decline)', () => {
  // Stall decay lands the trajectory on FLAT; crestHold keeps the verdict.
  // Only a score decline (FALLING confirm, or dropping out of the band)
  // ends a Peak — documented behaviour, not a bug.
  const s = run([20, 35, 45, 45, 45, 45, 45]);
  assert.equal(s.trajectory, 'FLAT');
  assert.equal(s.verdict, 'Peak');
  assert.equal(s.stage, 'High Tide');
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
    { score: 38, verdict: 'Peak' },     // hold band, trajectory still RISING
    { score: 32, verdict: 'Easing' },   // −5.3 vs window: FALLING confirms → exit
                                        // (pre-2026-07 the score-only hold kept
                                        // this day at Peak — the stale GO-NOW bug)
    { score: 24, verdict: 'Easing' },
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
  assert.equal(s.lastPeakDate, d(5), 'last day the verdict was Peak');
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
