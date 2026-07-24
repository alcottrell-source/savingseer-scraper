// Unit tests for the pure scoring engine in score.js.
// Run with: npm test   (node --test)
//
// score.js is import-safe: env-var checks and the Supabase client are lazy,
// and the CLI entry is guarded, so importing it here has no side effects.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTrajectory,
  getTideStage,
  deriveStageFromVerdict,
  buildHistoryEntries,
} from '../score.js';

test('getTrajectory — <3 days history defaults to RISING (spec §9.3)', () => {
  assert.equal(getTrajectory(50, [], null), 'RISING');
  assert.equal(getTrajectory(50, [40, 30], null), 'RISING');
});

test('getTrajectory — RISING is sticky through noise on a genuine climb, flips only on a real drop', () => {
  // Window still climbing (44→47→50, avg 47): a small dip below the newest
  // point keeps RISING, a moderate one goes FLAT, a big one flips FALLING.
  assert.equal(getTrajectory(49.5, [50, 47, 44], 'RISING'), 'RISING'); // diff +2.5
  assert.equal(getTrajectory(45, [50, 47, 44], 'RISING'), 'FLAT');     // diff −2
  assert.equal(getTrajectory(42, [50, 47, 44], 'RISING'), 'FALLING');  // diff −5
});

test('getTrajectory — stall decay: a plateaued climb goes FLAT (OQ1 fix, ADR-002 §5.1)', () => {
  // Window + today all within the stall range (1.5): the climb has flattened.
  assert.equal(getTrajectory(50, [50, 50, 50], 'RISING'), 'FLAT');
  assert.equal(getTrajectory(49.5, [50, 50, 50], 'RISING'), 'FLAT', 'sub-band jitter is still a stall');
  // Span ≥ 1.5: still moving — no stall.
  assert.equal(getTrajectory(52, [50, 50, 50], 'RISING'), 'RISING');
  // RISING-only by design: FALLING and FLAT priors are untouched.
  assert.equal(getTrajectory(50, [50, 50, 50], 'FALLING'), 'FALLING');
  assert.equal(getTrajectory(50, [50, 50, 50], 'FLAT'), 'FLAT');
});

test('stall → getTideStage fires the one-shot local peak (the user-visible OQ1 fix)', () => {
  // The RISING→FLAT flip produced by a stall is a localPeak trigger: the
  // plateaued centre finally gets its PEAK day instead of "Rising" forever.
  const traj = getTrajectory(20, [20, 20, 20], 'RISING');
  assert.equal(traj, 'FLAT');
  const r = getTideStage(20, 'Rising', traj, 'RISING');
  assert.equal(r.verdict, 'Peak');
  assert.equal(r.stage, 'High Tide');
});

test('getTrajectory — FALLING is sticky (mirror image)', () => {
  assert.equal(getTrajectory(50.5, [50, 50, 50], 'FALLING'), 'FALLING');
  assert.equal(getTrajectory(52, [50, 50, 50], 'FALLING'), 'FLAT');
  assert.equal(getTrajectory(60, [50, 50, 50], 'FALLING'), 'RISING');
});

test('getTideStage — score 0 maps to Quiet (fresh) or Over (post-peak)', () => {
  assert.equal(getTideStage(0, null, 'FLAT', null).verdict, 'Quiet');
  assert.equal(getTideStage(0, 'High Tide', 'FLAT', null).verdict, 'Over');
  assert.equal(getTideStage(0, 'Falling', 'FLAT', null).verdict, 'Over');
});

test('getTideStage — High Tide hold: enter 40, hold 30+ only while not falling', () => {
  assert.equal(getTideStage(45, null, 'RISING', null).verdict, 'Peak', 'enter at ≥40');
  assert.equal(getTideStage(35, 'High Tide', 'RISING', null).verdict, 'Peak', 'hold in 30–40 band while rising');
  assert.equal(getTideStage(35, 'High Tide', 'FLAT', null).verdict, 'Peak', 'hold in 30–40 band on the plateau (crest)');
  assert.equal(getTideStage(35, 'High Tide', 'FALLING', null).verdict, 'Easing', 'confirmed decline exits the hold band');
  assert.equal(getTideStage(25, 'High Tide', 'FALLING', null).verdict, 'Easing', 'exit below 30');
});

test('getTideStage — confirmed decline exits Peak at ANY score (the stale GO-NOW fix)', () => {
  // The first full recorded cycle: centres crested ~70% then declined for
  // ~2 weeks still reading "Go now" because the old hold was score-only.
  const r = getTideStage(50, 'High Tide', 'FALLING', 'FALLING');
  assert.equal(r.verdict, 'Easing');
  assert.equal(r.stage, 'Falling');
  // Even on the roll-over day itself (prevTraj RISING): once the stage is
  // High Tide, localPeak can't rescue the hold — descent takes over.
  assert.equal(getTideStage(60, 'High Tide', 'FALLING', 'RISING').verdict, 'Easing');
});

test('getTideStage — D19 crest-distance release: FLAT off the crest eases, at the crest holds', () => {
  // WestQuay: crest 54, now FLAT at 49 (5 pts below) — including the frozen
  // carry-forward case where today == yesterday so trajectory reads FLAT and
  // no FALLING can confirm. A plateau AT the crest (distance < band) holds.
  assert.equal(getTideStage(49, 'High Tide', 'FLAT', 'FLAT', 54).verdict, 'Easing', '5pts below crest → Easing');
  assert.equal(getTideStage(49, 'High Tide', 'FLAT', 'FLAT', 52).verdict, 'Peak', '3pts below crest holds (<band)');
  assert.equal(getTideStage(49, 'High Tide', 'FLAT', 'FLAT', 49).verdict, 'Peak', 'plateau AT the crest holds');
  // The release stays FLAT-only. A single RISING day near the crest is the
  // one-day grace (a genuine climb or a plateau's noise blip) — it must hold;
  // the D20 trajectory decay is what turns a *sustained* slide FLAT so this
  // then fires (see the getTrajectory dead-zone test).
  assert.equal(getTideStage(49, 'High Tide', 'RISING', 'RISING', 54).verdict, 'Peak', 'RISING exempt — one-day grace near crest holds');
  assert.equal(getTideStage(49, 'High Tide', 'FLAT', 'FLAT', null).verdict, 'Peak', 'no crest data → unchanged (holds)');
});

test('getTrajectory — D20 sustained-decline decay: two consecutive down days leave RISING (the dead-zone fix)', () => {
  // The bug: a steady ~0.5–0.7 pt/day slide has a per-step drop too small for
  // the FLAT band and a 3-day span too wide for the stall check, so sticky
  // RISING never decayed and "Go now" pinned all the way down.
  assert.equal(getTrajectory(50, [50.6, 51.2, 51.8], 'RISING'), 'FLAT', 'steady slow decline → FLAT, not RISING');
  assert.equal(getTrajectory(49, [49.6, 50.2, 50.8], 'RISING'), 'FLAT', '0.6/day slide keeps decaying to FLAT');
  // One soft day right after a fresh high (yesterday was still climbing) →
  // NOT two consecutive down days, so it stays RISING: the one-day grace that
  // stops a single noise blip dropping Peak (mirrors E13b's first-soft-day).
  assert.equal(getTrajectory(52, [54, 50, 46], 'RISING'), 'RISING', 'single soft day after a climb still RISING');
  // A genuine climb (today a fresh high) is never decayed.
  assert.equal(getTrajectory(56, [54, 52, 50], 'RISING'), 'RISING', 'still climbing → RISING');
});

test('getTideStage — no Peak re-entry from descent without a sustained RISING', () => {
  // An Easing bounce back over 40 must not flap to Peak (and re-fire the
  // peak-alert email); only a genuine RISING resurgence re-enters.
  assert.equal(getTideStage(45, 'Falling', 'FLAT', 'FALLING').verdict, 'Easing');
  assert.equal(getTideStage(45, 'Falling', 'FALLING', 'FALLING').verdict, 'Easing');
  assert.equal(getTideStage(45, 'Falling', 'RISING', 'FALLING').verdict, 'Peak');
});

test('getTideStage — descent path distinguishes Easing (≥8) from Over (<8)', () => {
  assert.equal(getTideStage(20, 'Falling', 'FALLING', null).verdict, 'Easing');
  assert.equal(getTideStage(5,  'Falling', 'FALLING', null).verdict, 'Over');
});

test('getTideStage — new-cycle escape: Low + RISING + score≥15 climbs back to Rising', () => {
  // A centre that ended its cycle (Low) but is now climbing again with a
  // sustained RISING trajectory should re-enter the climb path. Without
  // this rule a "rolling" centre stays stuck in Over/Easing for life.
  const r = getTideStage(20, 'Low', 'RISING', 'RISING');
  assert.equal(r.verdict, 'Rising');
  assert.equal(r.stage, 'Rising');
});

test('getTideStage — no new-cycle escape from plain Easing (must have ended in Low first)', () => {
  // Easing → Rising would let any post-peak wobble jump back to RISING.
  // The escape only fires after the cycle properly ended (yesterdayStage=Low).
  assert.equal(getTideStage(20, 'Falling', 'RISING', 'RISING').verdict, 'Easing');
});

test('getTideStage — climb path Rising vs Quiet by the 15 boundary', () => {
  assert.equal(getTideStage(30, null, 'RISING', null).verdict, 'Rising');
  assert.equal(getTideStage(10, null, 'RISING', null).verdict, 'Quiet');
});

test('getTideStage — local peak fires on a SHARP roll-over (RISING→FALLING)', () => {
  const r = getTideStage(25, null, 'FALLING', 'RISING');
  assert.equal(r.verdict, 'Peak');
  assert.equal(r.stage, 'High Tide');
});

test('getTideStage — local peak ALSO fires on a GENTLE roll-over (RISING→FLAT)', () => {
  // Regression guard for the silent-peak bug: a centre peaking gently below
  // HIGH_TIDE_ENTER slides RISING→FLAT→FALLING; if Peak only fired on
  // RISING→FALLING it would never emit GO NOW / a peak-alert email for
  // that centre.
  const r = getTideStage(25, null, 'FLAT', 'RISING');
  assert.equal(r.verdict, 'Peak', 'gentle roll-over must still emit a one-day Peak');
  assert.equal(r.stage, 'High Tide');
});

test('getTideStage — no false local peak while still genuinely RISING', () => {
  assert.equal(getTideStage(25, null, 'RISING', 'RISING').verdict, 'Rising');
});

test('getTideStage — Peak maps back to a descent next day (no Peak lock-in)', () => {
  // Day 2 after a local peak: STAGE_FROM_VERDICT('Peak') = 'High Tide',
  // so the descent branch takes over and the centre eases/ends.
  const yStage = deriveStageFromVerdict('Peak');
  assert.equal(yStage, 'High Tide');
  assert.equal(getTideStage(20, yStage, 'FALLING', 'FALLING').verdict, 'Easing');
  assert.equal(getTideStage(5,  yStage, 'FALLING', 'FALLING').verdict, 'Over');
});

test('deriveStageFromVerdict — new + legacy vocabularies both resolve', () => {
  assert.equal(deriveStageFromVerdict('Peak'), 'High Tide');
  assert.equal(deriveStageFromVerdict('Easing'), 'Falling');
  assert.equal(deriveStageFromVerdict('Quiet'), 'Turning');
  assert.equal(deriveStageFromVerdict('Over'), 'Low');
  assert.equal(deriveStageFromVerdict('Go now'), 'High Tide', 'legacy');
  assert.equal(deriveStageFromVerdict("It's over"), 'Low', 'legacy');
  assert.equal(deriveStageFromVerdict(null), null);
  assert.equal(deriveStageFromVerdict('garbage'), null);
});

test('buildHistoryEntries — entry shape carries avg_discount_pct (int passthrough, null preserved)', () => {
  const rows = [
    { centre_id: 'lakeside', score_date: '2026-07-01', tide_score: 40, brands_on_sale: 8, total_brands: 20, avg_discount_pct: 45 },
    { centre_id: 'lakeside', score_date: '2026-07-02', tide_score: 45, brands_on_sale: 9, total_brands: 20, avg_discount_pct: null },
    { centre_id: 'bluewater', score_date: '2026-07-01', tide_score: 10, brands_on_sale: 3, total_brands: 30, avg_discount_pct: '50' },
  ];
  const byCentre = buildHistoryEntries(rows);
  assert.deepEqual(byCentre.get('lakeside'), [
    { date: '2026-07-01', score: 40, brands_on_sale: 8, total_brands: 20, avg_discount_pct: 45 },
    { date: '2026-07-02', score: 45, brands_on_sale: 9, total_brands: 20, avg_discount_pct: null },
  ]);
  // Numeric strings from PostgREST coerce; the key is always present.
  assert.deepEqual(byCentre.get('bluewater'), [
    { date: '2026-07-01', score: 10, brands_on_sale: 3, total_brands: 30, avg_discount_pct: 50 },
  ]);
});

test('buildHistoryEntries — per-centre grouping preserves input (oldest-first) order', () => {
  const rows = [
    { centre_id: 'a', score_date: '2026-07-01', tide_score: 1, brands_on_sale: 1, total_brands: 10 },
    { centre_id: 'b', score_date: '2026-07-01', tide_score: 2, brands_on_sale: 2, total_brands: 10 },
    { centre_id: 'a', score_date: '2026-07-02', tide_score: 3, brands_on_sale: 3, total_brands: 10 },
  ];
  const byCentre = buildHistoryEntries(rows);
  assert.deepEqual([...byCentre.keys()], ['a', 'b']);
  assert.deepEqual(byCentre.get('a').map(e => e.date), ['2026-07-01', '2026-07-02']);
  // Rows without the column (pre-migration selects) still get the key, as null.
  assert.equal(byCentre.get('b')[0].avg_discount_pct, null);
});
