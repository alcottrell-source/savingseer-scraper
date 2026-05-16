// Unit tests for the pure scoring engine in score.js.
// Run with: npm test   (node --test)
//
// score.js is import-safe: env-var checks and the Supabase client are lazy,
// and the CLI entry is guarded, so importing it here has no side effects.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandFreshnessScore,
  getTrajectory,
  getTideStage,
  deriveStageFromVerdict,
} from '../score.js';

test('brandFreshnessScore — spec §2 decay curve', () => {
  assert.equal(brandFreshnessScore(0), 0, 'day 0 → 0');
  assert.equal(brandFreshnessScore(-5), 0, 'negative → 0');
  assert.equal(brandFreshnessScore(1), 1.0, 'day 1 → 1.0');
  assert.equal(brandFreshnessScore(7), 1.0, 'day 7 → 1.0 (plateau end)');
  assert.equal(brandFreshnessScore(21), 0.5, 'day 21 → 0.5');
  assert.equal(Math.round(brandFreshnessScore(42) * 1000) / 1000, 0.1, 'day 42 → 0.1');
  assert.equal(brandFreshnessScore(43), 0, 'beyond DECAY_MAX → excluded (0)');
  // Monotonic non-increasing across the whole range.
  let prev = Infinity;
  for (let d = 1; d <= 60; d++) {
    const v = brandFreshnessScore(d);
    assert.ok(v <= prev + 1e-9, `freshness must not increase at day ${d}`);
    prev = v;
  }
});

test('getTrajectory — <3 days history defaults to RISING (spec §9.3)', () => {
  assert.equal(getTrajectory(50, [], null), 'RISING');
  assert.equal(getTrajectory(50, [40, 30], null), 'RISING');
});

test('getTrajectory — RISING is sticky through noise, flips only on a real drop', () => {
  // prior RISING, dip < FLAT band (1.5) → stays RISING
  assert.equal(getTrajectory(49.5, [50, 50, 50], 'RISING'), 'RISING');
  // prior RISING, dip past FLAT band but not FLIP band (1.5–4) → FLAT
  assert.equal(getTrajectory(48, [50, 50, 50], 'RISING'), 'FLAT');
  // prior RISING, drop > FLIP band (4) → FALLING
  assert.equal(getTrajectory(40, [50, 50, 50], 'RISING'), 'FALLING');
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

test('getTideStage — High Tide hysteresis: enter 75, hold to 65, then ease', () => {
  assert.equal(getTideStage(80, null, 'RISING', null).verdict, 'Peak', 'enter at ≥75');
  assert.equal(getTideStage(70, 'High Tide', 'FALLING', null).verdict, 'Peak', 'hold in 65–75 band');
  assert.equal(getTideStage(60, 'High Tide', 'FALLING', null).verdict, 'Easing', 'exit below 65');
});

test('getTideStage — descent path distinguishes Easing (≥25) from Over (<25)', () => {
  assert.equal(getTideStage(40, 'Falling', 'FALLING', null).verdict, 'Easing');
  assert.equal(getTideStage(20, 'Falling', 'FALLING', null).verdict, 'Over');
});

test('getTideStage — climb path Rising vs Quiet by the 25 boundary', () => {
  assert.equal(getTideStage(50, null, 'RISING', null).verdict, 'Rising');
  assert.equal(getTideStage(10, null, 'RISING', null).verdict, 'Quiet');
});

test('getTideStage — local peak fires on a SHARP roll-over (RISING→FALLING)', () => {
  const r = getTideStage(50, null, 'FALLING', 'RISING');
  assert.equal(r.verdict, 'Peak');
  assert.equal(r.stage, 'High Tide');
});

test('getTideStage — local peak ALSO fires on a GENTLE roll-over (RISING→FLAT)', () => {
  // Regression guard for the silent-peak bug: a centre peaking gently below
  // 75 slides RISING→FLAT→FALLING; if Peak only fired on RISING→FALLING it
  // would never emit GO NOW / a peak-alert email for that centre.
  const r = getTideStage(50, null, 'FLAT', 'RISING');
  assert.equal(r.verdict, 'Peak', 'gentle roll-over must still emit a one-day Peak');
  assert.equal(r.stage, 'High Tide');
});

test('getTideStage — no false local peak while still genuinely RISING', () => {
  assert.equal(getTideStage(50, null, 'RISING', 'RISING').verdict, 'Rising');
});

test('getTideStage — Peak maps back to a descent next day (no Peak lock-in)', () => {
  // Day 2 after a local peak: STAGE_FROM_VERDICT('Peak') = 'High Tide',
  // so the descent branch takes over and the centre eases/ends.
  const yStage = deriveStageFromVerdict('Peak');
  assert.equal(yStage, 'High Tide');
  assert.equal(getTideStage(50, yStage, 'FALLING', 'FALLING').verdict, 'Easing');
  assert.equal(getTideStage(10, yStage, 'FALLING', 'FALLING').verdict, 'Over');
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
