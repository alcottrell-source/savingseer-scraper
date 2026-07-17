// Tide Score lifecycle — explicit, pure state machine.
// Reference implementation of ADR-002 (docs/architecture/tide-score.md).
//
// Behaviour-identical to score.js's getTideStage/getTrajectory on the no-gap
// path (proven by the parity suite in test/tide-machine.test.mjs), with the
// deliberate divergences V1–V3 documented in ADR-002 §7: explicit state,
// post-gap trajectory = FLAT (not the new-centre RISING default), and
// date-aware gap semantics.
//
// Execution-phase glue (NOT here):
//   TODO(ADR-002 §10.1): additive migration — centre_seer_scores.stage,
//                        stage_entered_date, last_peak_date, observed_days.
//   TODO(ADR-002 §10.2): score.js fresh + carry-forward paths call
//                        nextTideState and persist the state columns.

export const TIDE = {
  HIGH_TIDE_ENTER: 40,
  HIGH_TIDE_EXIT: 30,
  RISING_FLOOR: 15,
  OVER_CEILING: 8,
  TRAJECTORY_FLAT_BAND: 1.5,
  TRAJECTORY_FLIP_BAND: 4.0,
  TRAJECTORY_STALL_RANGE: 1.5, // window∪today span below this = stalled climb (OQ1 fix)
  GAP_BREAK_DAYS: 3,      // gaps beyond this break the trajectory window (ADR-002 §5.4)
  NEW_CENTRE_MIN_DAYS: 3, // below this, trajectory defaults RISING (spec §9.3 back-compat)
};

export const STAGES = ['Turning', 'Rising', 'High Tide', 'Falling', 'Low'];

// Verdict-string → stage recovery map, for loading legacy rows that predate
// the explicit stage column (ADR-002 §4 loader rule). Mirrors score.js's
// STAGE_FROM_VERDICT including the pre-rename strings.
export const STAGE_FROM_VERDICT = {
  'Peak': 'High Tide',
  'Easing': 'Falling',
  'Rising': 'Rising',
  'Turning': 'Turning',
  'Quiet': 'Turning',
  'Over': 'Low',
  'Go now': 'High Tide',
  'Last chance': 'Falling',
  'Last chance — tide going out': 'Falling',
  'Worth watching': 'Rising',
  'Starting to build': 'Turning',
  "It's over": 'Low',
  'Nothing on': 'Turning',
};

export function daysBetween(from, to) {
  const f = Date.parse(String(from).slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(String(to).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
  return Math.round((t - f) / 86400000);
}

// ── Trajectory table (ADR-002 §5.1) ────────────────────────────────────────
// recentScores: up to 3 prior daily scores, newest first (may be shorter
// after a window break). observedDays (total observations INCLUDING today)
// distinguishes a genuinely new centre — today is at most its 3rd observation,
// so a full window can't exist yet (RISING default, parity with score.js) —
// from a post-gap rebuild (FLAT — divergence V2).
export function trajectoryStep(score, recentScores, priorTrajectory, observedDays, C = TIDE) {
  if (recentScores.length < 3) {
    return observedDays <= C.NEW_CENTRE_MIN_DAYS ? 'RISING' : 'FLAT';
  }
  const avg = (recentScores[0] + recentScores[1] + recentScores[2]) / 3;
  const diff = score - avg;
  const prior = priorTrajectory || 'FLAT';
  if (prior === 'RISING') {
    if (diff < -C.TRAJECTORY_FLIP_BAND) return 'FALLING';
    if (diff < -C.TRAJECTORY_FLAT_BAND) return 'FLAT';
    // Stall decay (OQ1 fix, ADR-002 §5.1 + D16): sticky RISING only exited
    // on drops, so a plateaued centre read "Rising" forever and never fired
    // its local peak. A window (plus today) spanning less than the stall
    // range means the climb has genuinely flattened → FLAT, whose
    // RISING→FLAT flip fires the one-shot Peak downstream — the plateau IS
    // the peak. Stateless (no streak counter) so score.js's getTrajectory
    // applies the identical rule and parity holds. RISING-only by design.
    const w = recentScores.slice(0, 3);
    const span = Math.max(score, ...w) - Math.min(score, ...w);
    if (span < C.TRAJECTORY_STALL_RANGE) return 'FLAT';
    return 'RISING';
  }
  if (prior === 'FALLING') {
    if (diff > C.TRAJECTORY_FLIP_BAND) return 'RISING';
    if (diff > C.TRAJECTORY_FLAT_BAND) return 'FLAT';
    return 'FALLING';
  }
  if (diff > C.TRAJECTORY_FLAT_BAND) return 'RISING';
  if (diff < -C.TRAJECTORY_FLAT_BAND) return 'FALLING';
  return 'FLAT';
}

// ── Stage table T1–T9 (ADR-002 §5.2) — first match wins ────────────────────
export function stageStep(score, prevStage, traj, prevTraj, C = TIDE) {
  const wasHigh = prevStage === 'High Tide';
  const wasDescent = prevStage === 'Falling' || prevStage === 'Low';
  const localPeak = prevTraj === 'RISING' && traj !== 'RISING';

  if (score === 0) {
    if (wasHigh || wasDescent) return { stage: 'Low', verdict: 'Over' };        // T1
    return { stage: 'Turning', verdict: 'Quiet' };                              // T2
  }
  // T3 (amended 2026-07): the High Tide hold is trajectory-gated. The old
  // score-only rule held Peak from 40 all the way down to 30 — the first
  // full recorded cycle showed that reads "Go now" for weeks down the far
  // side of the tide. First match wins:
  //   T3a freshEntry — climb path crossing ENTER, any trajectory
  //   T3b crestHold  — in High Tide and NOT confirmed FALLING (plateau = crest)
  //   T3c reEntry    — from descent: needs ≥ENTER (holdHigh reduces to that
  //                    when wasDescent) AND sustained RISING, so an Easing
  //                    bounce can't flap back to Peak
  // A FALLING day in High Tide falls through to T5/T6 → Easing at any score.
  const holdHigh = score >= C.HIGH_TIDE_ENTER || (wasHigh && score >= C.HIGH_TIDE_EXIT);
  const freshEntry = !wasHigh && !wasDescent;
  const crestHold = wasHigh && traj !== 'FALLING';
  const reEntry = wasDescent && traj === 'RISING';
  if (holdHigh && (freshEntry || crestHold || reEntry)) {
    return { stage: 'High Tide', verdict: 'Peak' };                             // T3a/T3b/T3c
  }
  if (wasHigh || wasDescent) {
    if (prevStage === 'Low' && traj === 'RISING' && score >= C.RISING_FLOOR) {
      return { stage: 'Rising', verdict: 'Rising' };                            // T4 new-cycle escape
    }
    if (score < C.OVER_CEILING) return { stage: 'Low', verdict: 'Over' };       // T5
    return { stage: 'Falling', verdict: 'Easing' };                             // T6
  }
  if (score >= C.RISING_FLOOR) {
    if (localPeak) return { stage: 'High Tide', verdict: 'Peak' };              // T7 one-shot local peak (D10)
    return { stage: 'Rising', verdict: 'Rising' };                              // T8
  }
  return { stage: 'Turning', verdict: 'Quiet' };                                // T9
}

// ── State init & step ───────────────────────────────────────────────────────

export function initTideState(observation, C = TIDE) {
  const { date, score } = observation;
  const trajectory = trajectoryStep(score, [], null, 1, C); // new centre → RISING
  const { stage, verdict } = stageStep(score, null, trajectory, null, C);
  return {
    date, score, stage, verdict, trajectory,
    recentScores: [],
    observedDays: 1,
    stageEnteredDate: date,
    daysInStage: 0,
    lastPeakDate: verdict === 'Peak' ? date : null,
  };
}

// (prevState | null, observation) → nextState. Pure and deterministic:
// the intraday-rescore pattern is "call again with YESTERDAY's state and
// today's new observation" (idempotent by construction — ADR-002 §4).
export function nextTideState(prevState, observation, C = TIDE) {
  if (!prevState) return initTideState(observation, C);
  const { date, score } = observation;
  const gapDays = daysBetween(prevState.date, date);
  if (gapDays == null || gapDays <= 0) {
    throw new Error(
      `nextTideState: observation date ${date} must be after state date ${prevState.date} ` +
      '(for an intraday rescore, re-step from YESTERDAY’s state, not today’s)');
  }

  // Gap semantics (ADR-002 §5.4): beyond GAP_BREAK_DAYS the trajectory
  // window is broken — momentum cannot be trusted across the hole, so the
  // window clears and trajectory resolves FLAT until 3 fresh observations
  // (which also suppresses localPeak firing off pre-gap momentum — E9).
  const windowBroken = gapDays > C.GAP_BREAK_DAYS;
  const recent = windowBroken
    ? []
    : [prevState.score, ...prevState.recentScores].slice(0, 3);
  const priorTraj = windowBroken ? 'FLAT' : prevState.trajectory;

  const observedDays = prevState.observedDays + 1;
  const trajectory = trajectoryStep(score, recent, priorTraj, observedDays, C);
  const { stage, verdict } = stageStep(score, prevState.stage, trajectory, priorTraj, C);

  const stageEnteredDate = stage === prevState.stage ? prevState.stageEnteredDate : date;
  return {
    date, score, stage, verdict, trajectory,
    recentScores: recent,
    observedDays,
    stageEnteredDate,
    daysInStage: daysBetween(stageEnteredDate, date),
    lastPeakDate: verdict === 'Peak' ? date : prevState.lastPeakDate,
  };
}

// Loader for rows that predate the explicit state columns (ADR-002 §4).
// row: { date, score, stage?, verdict?, trajectory?, stage_entered_date?,
//        last_peak_date?, observed_days? } — returns TideState | null.
export function stateFromRow(row, priorRowCount = 3) {
  if (!row) return null;
  const stage = row.stage || STAGE_FROM_VERDICT[row.verdict] || null;
  if (!stage) return null; // unknown verdict → treat as new centre (never throw)
  return {
    date: row.date,
    score: row.score,
    stage,
    verdict: row.verdict ?? null,
    trajectory: row.trajectory || 'FLAT',
    recentScores: Array.isArray(row.recentScores) ? row.recentScores.slice(0, 3) : [],
    observedDays: row.observed_days ?? Math.min(3, priorRowCount),
    stageEnteredDate: row.stage_entered_date ?? row.date,
    daysInStage: row.stage_entered_date ? (daysBetween(row.stage_entered_date, row.date) ?? 0) : 0,
    lastPeakDate: row.last_peak_date ?? null,
  };
}
