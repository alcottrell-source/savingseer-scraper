# ADR-002 — Tide Score lifecycle: a formal, explicitly-persisted state machine

- **Status:** Accepted (2026-07-08)
- **Deciders:** Site owner (interview answers D2, D3, D7, D10 in `DECISIONS.md`)
- **Reference implementation:** `lib/tide-machine.js` + `test/tide-machine.test.mjs`
  (proven behaviour-compatible with `score.js` by parity tests)
- **Supersedes nothing** — formalises the machine already shipped in `score.js`

## 1. Problem statement

Every centre moves through a sale lifecycle, and `score.js` already implements
it — five stages (Turning → Rising → High Tide → Falling → Low) with
hysteresis, one-shot local-peak detection, and a new-cycle escape. But the
machine's state is **implicit**: each day it is re-derived by mapping
yesterday's stored *verdict string* back to a stage via `STAGE_FROM_VERDICT`
(a map that already carries seven legacy strings from two vocabulary renames),
and the trajectory window is whatever rows happen to exist in the last three
calendar days. Consequences:

- A verdict copy-rename can silently corrupt the lifecycle (the string IS the
  state).
- A missed cron day empties the 3-day trajectory window, which then **defaults
  to RISING** — the new-centre default — priming a spurious local-peak
  (PEAK + GO NOW + email) on the next wobble.
- "How long has this centre been at High Tide?" is unanswerable without
  replaying history — blocking cycle analytics, the moat dataset (D12), and
  honest UI copy.
- There is no single document stating what triggers each transition; the truth
  is spread across `getTideStage`, `getTrajectory`, CLAUDE.md prose, and tests.

**Hard constraints:** five stages exactly (D2 — "Flat" stays a trajectory
label, not a stage); the input score formula is untouchable (D3); local-peak
stays maximally sensitive — no confirmation day (D10); explicit persisted
state with legacy back-compat and defined gap semantics (D7).

## 2. Options considered

| Option | Description | Verdict |
|---|---|---|
| O1 — Keep implicit, document it | No schema change; ADR just writes down the transition table | Rejected: leaves the string-as-state fragility and the post-gap RISING bug in place |
| O2 — Explicit minimal (`stage` column only) | Kills string-mapping; no cycle metadata | Rejected: answers "what stage" but not "since when" — the cycle analytics the moat needs (D12) still require replay |
| **O3 — Explicit state object (chosen)** | Persist `stage`, `stage_entered_date`, `last_peak_date`, `observed_days`; verdict becomes pure presentation; machine is a pure `(prevState, observation) → nextState` function | **Accepted**: testable in isolation, self-contained across gaps, enables days-in-stage/cycle records, back-compat via the existing verdict map as a fallback loader |
| O4 — Six stages incl. Flat | Split Turning into Flat (dormant) + Turning (stirring) | Rejected (D2): both render QUIET; distinction users never see |

## 3. Decision

Formalise the lifecycle as a pure function

```
nextTideState(prevState | null, observation) → nextState
```

in `lib/tide-machine.js`, **behaviour-identical to `score.js` on the no-gap
path** (enforced by parity tests against the exported `getTideStage` /
`getTrajectory`), with three deliberate, documented divergences where the
implicit machine had no defined behaviour (§7). `score.js` adopts the module
in the execution phase; `centre_seer_scores` gains nullable state columns.

## 4. Data contracts

```ts
type Trajectory = 'RISING' | 'FLAT' | 'FALLING';
type Stage = 'Turning' | 'Rising' | 'High Tide' | 'Falling' | 'Low';
type Verdict = 'Quiet' | 'Rising' | 'Peak' | 'Easing' | 'Over';

type TideObservation = {
  date: string;      // YYYY-MM-DD (UTC). Must be >= prevState.date.
  score: number;     // tide_score: round1(brandsOnSale/totalBrands×100). D3: computed upstream, never here.
};

type TideState = {
  date: string;             // date of this state
  score: number;
  stage: Stage;
  verdict: Verdict;         // presentation output — derived, never an input
  trajectory: Trajectory;
  recentScores: number[];   // up to 3 prior daily scores, newest first (trajectory window)
  observedDays: number;     // total observations ever (gap-agnostic)
  stageEnteredDate: string; // when the current stage began
  daysInStage: number;      // daysBetween(stageEnteredDate, date)
  lastPeakDate: string|null;// most recent day verdict === 'Peak'
};
```

**Caller contract:** one state per centre per date. The daily scorer feeds
yesterday's persisted state; an intraday rescore feeds *yesterday's* state
again with today's new observation (the function is deterministic, so
same-inputs → same-state: intraday recomputation is idempotent by
construction). Never feed today's own output back in as `prevState` for the
same date. Carry-forward (reusing yesterday's *score* when no admin activity)
remains caller policy in `score.js` — the machine scores whatever observation
it is given.

### Persistence (execution-phase migration)

```sql
ALTER TABLE centre_seer_scores
  ADD COLUMN IF NOT EXISTS stage               TEXT CHECK (stage IN
      ('Turning','Rising','High Tide','Falling','Low')),
  ADD COLUMN IF NOT EXISTS stage_entered_date  DATE,
  ADD COLUMN IF NOT EXISTS last_peak_date      DATE,
  ADD COLUMN IF NOT EXISTS observed_days       INT;
```

All nullable, purely additive. **Loader rule (back-compat):** when reading
yesterday's row, if `stage` is non-null use the explicit state; else fall back
to `deriveStageFromVerdict(verdict)` exactly as today (`STAGE_FROM_VERDICT`
including its legacy strings), with `stageEnteredDate = date`,
`observedDays = min(3, count of prior rows)`, `lastPeakDate = null`. Within
one daily run every centre upgrades to explicit state; the fallback exists for
the first run and for gap recovery. `recentScores` is not persisted — it is
loaded from the prior 3 days' `tide_score` rows (same table, already fetched).

## 5. The state machine

Two coupled machines, evaluated in order each day: **trajectory** (fast,
3-day window, hysteresis against noise) then **stage** (slow, cycle-scale,
hysteresis against flapping).

### 5.1 Trajectory transition table

`diff = score − mean(recentScores)` (window = up to 3 prior daily scores).
Bands: `FLAT_BAND = 1.5`, `FLIP_BAND = 4.0` (tide_score points).

| Prior trajectory | Condition | Next |
|---|---|---|
| *(any)* | `recentScores.length < 3 && observedDays ≤ 3` — genuinely new centre: today is at most its 3rd observation, so a full window cannot exist yet | **RISING** (spec §9.3 back-compat default; matches `score.js`, which sees <3 prior rows on those days) |
| *(any)* | `recentScores.length < 3 && observedDays > 3` — post-gap rebuild | **FLAT** (divergence V2, §7) |

(`observedDays` counts total observations **including today's**.)
| RISING | `diff < −4.0` | FALLING |
| RISING | `−4.0 ≤ diff < −1.5` | FLAT |
| RISING | `diff ≥ −1.5` and `span(window ∪ {today}) < 1.5` (`TRAJECTORY_STALL_RANGE`) | FLAT — **stall decay** (OQ1 fix, D16): the climb has genuinely flattened; the resulting RISING→FLAT flip fires the one-shot local peak downstream, because the plateau IS the centre's peak. Stateless (window-range test, no streak counter), so `score.js`'s `getTrajectory` applies the identical rule and parity holds |
| RISING | `diff ≥ −1.5` otherwise | RISING (sticky through dips on a genuine climb) |
| FALLING | `diff > 4.0` | RISING |
| FALLING | `1.5 < diff ≤ 4.0` | FLAT |
| FALLING | `diff ≤ 1.5` | FALLING (sticky through bounces) |
| FLAT / null | `diff > 1.5` | RISING |
| FLAT / null | `diff < −1.5` | FALLING |
| FLAT / null | otherwise | FLAT |

### 5.2 Stage transition table

Evaluated top-to-bottom; first match wins. Inputs: `score`, `prevStage`
(null for a new centre), `traj` (today's trajectory), `prevTraj`.
Derived flags: `wasHigh = prevStage=='High Tide'`;
`wasDescent = prevStage∈{Falling,Low}`;
`localPeak = prevTraj=='RISING' && traj!='RISING'` (the sticky-trajectory
roll-over — fires on RISING→FLAT *and* RISING→FALLING, per the silent-peak
regression documented in `score.js`).

| # | Guard | Next stage | Verdict | Notes |
|---|---|---|---|---|
| T1 | `score == 0 && (wasHigh \|\| wasDescent)` | Low | Over | cycle ended to zero |
| T2 | `score == 0` | Turning | Quiet | dormant, no cycle behind it |
| T3 | `score ≥ 40 \|\| (wasHigh && score ≥ 30)` | High Tide | Peak | enter 40 / hold-to-30 hysteresis |
| T4 | `(wasHigh \|\| wasDescent) && prevStage=='Low' && traj=='RISING' && score ≥ 15` | Rising | Rising | new-cycle escape (only from Low, never mid-Easing) |
| T5 | `(wasHigh \|\| wasDescent) && score < 8` | Low | Over | descent floor |
| T6 | `wasHigh \|\| wasDescent` | Falling | Easing | descent, still meaningful (8 ≤ score < 30/40) |
| T7 | `score ≥ 15 && localPeak` | High Tide | Peak | **one-shot local peak** (D10). Next day T3 fails (score < 40, < 30 hold) unless genuinely high, so T5/T6 route to descent — the one-shot resolves itself |
| T8 | `score ≥ 15` | Rising | Rising | climb path |
| T9 | *(else — score < 15 on climb path)* | Turning | Quiet | covers 0 < score < 15: same QUIET the UI shows for zero |

Verdict→stage recovery map (legacy loader only): Peak→High Tide,
Easing→Falling, Rising→Rising, Quiet/Turning→Turning, Over→Low, plus the seven
pre-rename strings (`Go now`, `Worth watching`, `Last chance…`, etc.) exactly
as `STAGE_FROM_VERDICT` in `score.js`.

### 5.3 Bookkeeping transitions (new with explicit state)

- `stageEnteredDate`: reset to `obs.date` when `stage != prevStage`; else kept.
- `daysInStage = daysBetween(stageEnteredDate, obs.date)` (0 on entry day).
- `lastPeakDate = obs.date` whenever `verdict == 'Peak'` (global or local).
- `observedDays += 1` per observation (gaps don't add).
- `recentScores`: push `prev.score` to front, truncate to 3 — **unless** the
  gap rule (§5.4) cleared the window.

### 5.4 Gap semantics (D7 — previously undefined)

`gapDays = daysBetween(prev.date, obs.date)`; normal is 1.

| Case | Rule |
|---|---|
| `gapDays == 1` | Normal step. |
| `2 ≤ gapDays ≤ 3` (`GAP_BREAK_DAYS = 3`) | Treated as consecutive: the window keeps its last-3-*observations* points. Note this is deliberately better than today: `score.js`'s calendar-based 3-day SQL window would partially empty over such a gap and hit the RISING default — part of divergences V2/V3. |
| `gapDays > 3` | **Window broken:** `recentScores` cleared; trajectory resolves FLAT until 3 fresh observations (see table §5.1 row 2); `localPeak` therefore cannot fire off pre-gap momentum. Stage **persists** (stage is slow-moving; a gap is missing measurements, not a changed world). `daysInStage` counts the gap (calendar-true). |
| `gapDays == 0` (same date) | Not a step — caller error unless it is the intraday-rescore pattern (recompute from *yesterday's* state). The function throws on `obs.date < prev.date` and on `obs.date == prev.date` to force the correct caller contract. |

## 6. Edge cases (all encoded as tests)

- **E1 new centre, day 1:** `prevState = null` → trajectory RISING (default),
  stage from T1–T9 with `prevStage = null` (so T3/T7/T8/T9 territory).
- **E2 plateaued centre (OQ1, FIXED 2026-07-08 — owner-approved, D16):**
  sticky RISING previously only exited on drops, so a stable 20% centre read
  "Rising" forever and never fired its local peak. Now the **stall decay** row
  (§5.1) sends it FLAT once the window flattens, firing the one-shot Peak —
  then the descent path takes over (Easing) exactly like any other local peak.
  Two documented consequences: **(a) one-time catch-up wave** — on the first
  scoring run after deploy, every centre currently plateaued in RISING fires
  its one-shot Peak (+ GO NOW badge + peak-alert email); these are peaks the
  old rule was silently swallowing, so the wave is the fix working, not a
  regression. **(b) new centres onboarded mid-plateau** at ≥15% fire their
  one-shot Peak on ~day 4 (first full window). Defensible — that is the best
  information available about a centre that arrived already at its level —
  but worth knowing when onboarding a batch.
- **E3 one-shot Peak resolution:** local peak at 25 → next day score 25,
  prevStage High Tide → T3 fails (25 < 30) → T6 Easing. Automatic.
- **E4 hysteresis hold:** 45 → Peak; 35 next day → still Peak (hold ≥ 30);
  29 → Easing; then 41 → Peak again (re-enter at 40 only).
- **E5 new-cycle escape needs all three:** Low + RISING + score ≥ 15. From
  Falling (not Low) with RISING → still Easing (T4 guard), preventing
  post-peak wobbles from re-reading as a fresh cycle.
- **E6 crash to zero from High Tide:** T1 → Over, skipping Falling — correct:
  there is nothing left to ease through.
- **E7 zero on a never-cycled centre:** T2 Quiet, even after months (no
  descent memory to trigger Over).
- **E8 local peak from Turning:** score crosses 15 the same day the
  trajectory rolls over → T7 fires. Sensitive by design (D10).
- **E9 post-gap wobble:** 10-day gap, then a dip. Old behaviour: empty window
  → RISING default → dip = spurious PEAK + email. New: FLAT rebuild → T8/T9,
  no peak until momentum is re-established. (Divergence V2.)

## 7. Deliberate divergences from `score.js` (everything else is parity)

- **V1 — explicit state object** replaces verdict-string re-derivation
  (fallback loader keeps legacy rows working).
- **V2 — post-gap trajectory = FLAT, not RISING.** The RISING default now
  applies only to genuinely new centres (`observedDays < 3`). Kills the
  spurious post-gap peak (E9). This *changes behaviour* only in the >3-day-gap
  case, which previously produced a bug.
- **V3 — date-aware steps.** The machine sees real dates and defines gap
  semantics; `score.js` today only sees "whatever rows the last 3 days had".

Note: the **stall decay** (§5.1, E2) is *not* a divergence — it was applied to
`lib/tide-machine.js` and shipped `score.js` simultaneously (owner-approved
behaviour change, D16), so the parity suite still holds across both.

## 8. Failure modes

- **Corrupted/unknown stored stage string:** loader falls back to the verdict
  map; unknown verdict too → treat as new centre (`prevState = null`). Never
  throw on bad data — a centre must always score.
- **Score source failure upstream:** not this machine's concern (D3) — it
  never sees a partial observation; the caller simply doesn't step that day,
  which is exactly the gap case it now defines.
- **Double-run of the daily cron:** idempotent (same prevState + same
  observation → same state; upsert on `centre_id,score_date` unchanged).
- **Backfill/replay:** because the machine is pure, replaying history =
  folding observations from any anchor state; used by tests to simulate full
  cycles. A production backfill tool is execution-phase work.

## 9. Moat lens (D12)

Explicit `stageEnteredDate` / `lastPeakDate` / `daysInStage` turn the score
table into a **cycle-annotated time series**: peak dates and stage durations
per centre per cycle, queryable without replay. That is the raw material of
the timing-edge dataset (sale-cycle rhythms) — the machine's bookkeeping
fields exist for this reason, not just for UI copy.

## 10. Execution-phase glue (NOT in the reference implementation)

1. Migration above (§4) — additive, nullable.
2. `score.js`: replace the inline `getTrajectory`/`getTideStage` calls in both
   the fresh and carry-forward paths with `nextTideState`, persist the state
   columns, keep re-exporting the legacy functions until `index.html`'s
   consumers are migrated. Marked `TODO(ADR-002)` in `score.js`.
3. `index.html` has an independent client-side stage derivation for display —
   leave untouched; it reads verdicts, which remain written.
4. `bluf` copy strings stay in `score.js` (presentation, not state).

## 11. Test plan (implemented in `test/tide-machine.test.mjs`)

- **Parity suite:** sweep `nextTideState` against `score.js`'s
  `getTideStage` × `getTrajectory` across a grid (scores {0, 5, 10, 16, 25,
  29, 31, 35, 39, 41, 60} × prev stages {null + all 5} × prev trajectories
  {null + all 3} × window diffs {−6, −3, −1, 0, +2, +5}) on the no-gap path —
  stage, verdict, and trajectory must match exactly.
- Every edge case E1–E9 as a named scenario test, including the stall-decay
  suite (E2/E2b in `tide-machine.test.mjs` + the `getTrajectory` stall tests in
  `score.test.mjs`): plateau fires exactly one Peak then eases; a genuine climb
  with span ≥ 1.5 never stalls; FALLING/FLAT priors are untouched.
- Full-cycle simulation: Quiet → Rising → Peak(40+) → hold → Easing → Over →
  new-cycle escape, asserting stage dates/durations along the way.
- Gap suite: 2-day and 3-day gaps behave as consecutive; 4+ day gap clears
  window, forces FLAT rebuild, suppresses the E9 spurious peak, and
  `daysInStage` stays calendar-true.
- Contract guards: throws on out-of-order and same-date observations;
  idempotency of the intraday-rescore pattern.
- Loader fallback: legacy verdict strings (all 13 in the map) recover the
  right stage; unknown verdict → new-centre init.
