// Unit tests for lib/gravity.js — the Gravity Engine reference implementation.
// Spec: docs/architecture/gravity-engine.md (ADR-001). Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAVITY, ageConfidence, classifyReport, brandConfidence,
  reverifyPriority, buildReverifyQueue, centreGravity, daysBetween,
} from '../lib/gravity.js';

const TODAY = '2026-07-08';
const d = (offset) => {
  const t = new Date(Date.parse(TODAY + 'T00:00:00Z') + offset * 86400000);
  return t.toISOString().slice(0, 10);
};
const base = (over = {}) => ({
  brandId: 'B001', onSale: true,
  lastVerifiedDate: d(0), cycleStartDate: null,
  presenceCount: 10, reports: [],
  ...over,
});

// ── Age decay (ADR-001 §5.3 worked anchors) ─────────────────────────────────

test('ageConfidence — grace window is full confidence, then halves weekly', () => {
  assert.equal(ageConfidence(0), 1);
  assert.equal(ageConfidence(7), 1, 'grace boundary (D9: weekly is normal)');
  assert.equal(ageConfidence(14), 0.5, 'red-zone boundary at 14d (D9)');
  assert.equal(ageConfidence(21), 0.25);
  assert.equal(ageConfidence(28), 0.125);
  assert.equal(ageConfidence(null), null);
});

test('ageConfidence — future-dated anchor clamps to 0 age (E2)', () => {
  assert.equal(ageConfidence(-3), 1);
  const c = brandConfidence(base({ lastVerifiedDate: d(+5) }), TODAY);
  assert.equal(c.daysSinceVerified, 0);
  assert.equal(c.confidence, 1);
});

test('anchor falls back to the open cycle start date (E1)', () => {
  const c = brandConfidence(base({ lastVerifiedDate: null, cycleStartDate: d(-14) }), TODAY);
  assert.equal(c.anchorDate, d(-14));
  assert.equal(c.confidence, 0.5);
});

// ── Report classification: full 5×2 matrix (ADR-001 §5.2) ───────────────────

test('classifyReport — full matrix', () => {
  const m = (type, onSale) => classifyReport(type, onSale);
  assert.equal(m('sale_active_confirmed', true), 'corroborate');
  assert.equal(m('sale_active_confirmed', false), 'contradict');
  assert.equal(m('sale_started', true), 'corroborate');
  assert.equal(m('sale_started', false), 'contradict', 'missed sale (E4)');
  assert.equal(m('sale_ended', true), 'contradict');
  assert.equal(m('sale_ended', false), 'corroborate');
  assert.equal(m('no_sale_confirmed', true), 'contradict');
  assert.equal(m('no_sale_confirmed', false), 'corroborate');
  assert.equal(m('discount_different', true), 'contradict');
  assert.equal(m('discount_different', false), 'contradict');
  assert.equal(m('made_up_type', true), null);
});

// ── Confidence arithmetic ────────────────────────────────────────────────────

test('single fresh contradiction sends a just-verified brand to red', () => {
  const c = brandConfidence(base({
    reports: [{ reportType: 'sale_ended', createdAt: d(0) }],
  }), TODAY);
  assert.ok(Math.abs(c.confidence - 0.4) < 1e-9, `1 × 0.4 = 0.4, got ${c.confidence}`);
  assert.equal(c.band, 'red');
  assert.equal(c.hasFreshContradiction, true);
});

test('fresh corroboration restores a 14-day-old anchor to fresh (worked example §5.3)', () => {
  const c = brandConfidence(base({
    lastVerifiedDate: d(-14),
    reports: [{ reportType: 'sale_active_confirmed', createdAt: d(0) }],
  }), TODAY);
  // 0.5 + 0.5 × (1 − 2^−1) = 0.75
  assert.ok(Math.abs(c.confidence - 0.75) < 1e-9, `got ${c.confidence}`);
  assert.equal(c.band, 'fresh');
});

test('corroboration has diminishing returns and never exceeds 1', () => {
  const rep = { reportType: 'sale_active_confirmed', createdAt: d(0) };
  const one = brandConfidence(base({ lastVerifiedDate: d(-14), reports: [rep] }), TODAY).confidence;
  const four = brandConfidence(base({ lastVerifiedDate: d(-14), reports: [rep, rep, rep, rep] }), TODAY).confidence;
  assert.ok(four > one && four < 1, `diminishing lift: ${one} → ${four}`);
  const lift1 = one - 0.5, lift2 = four - one;
  assert.ok(lift2 < lift1 * 3, 'later reports lift less than the first');
});

test('contradiction dominates equal-weight corroboration on the same day (E6)', () => {
  const c = brandConfidence(base({
    reports: [
      { reportType: 'sale_active_confirmed', createdAt: d(0) },
      { reportType: 'sale_ended', createdAt: d(0) },
    ],
  }), TODAY);
  assert.ok(c.confidence < GRAVITY.BAND_AGING_MIN, `conflict must land below aging, got ${c.confidence}`);
  assert.equal(c.band, 'red');
});

test('report recency weighting: old reports move confidence less; window drops them (E7)', () => {
  const freshHit = brandConfidence(base({
    reports: [{ reportType: 'sale_ended', createdAt: d(0) }],
  }), TODAY).confidence;
  const weekOld = brandConfidence(base({
    reports: [{ reportType: 'sale_ended', createdAt: d(-7) }],
  }), TODAY).confidence;
  const outOfWindow = brandConfidence(base({
    reports: [{ reportType: 'sale_ended', createdAt: d(-15) }],
  }), TODAY);
  assert.ok(weekOld > freshHit, 'a week-old contradiction hits softer');
  assert.equal(outOfWindow.confidence, 1, '15-day-old report is ignored entirely');
  assert.equal(outOfWindow.contradictionWeight, 0);
});

test('week-old contradiction is outside the fresh-contradiction tier', () => {
  const c = brandConfidence(base({
    reports: [{ reportType: 'sale_ended', createdAt: d(-8) }],
  }), TODAY);
  assert.equal(c.hasFreshContradiction, false, '8d > CONTRA_FRESH_DAYS');
  assert.ok(c.contradictionWeight > 0, 'still counts toward Wx');
});

test('confidence floor holds under many contradictions', () => {
  const reps = Array.from({ length: 10 }, () => ({ reportType: 'sale_ended', createdAt: d(0) }));
  const c = brandConfidence(base({ reports: reps }), TODAY);
  assert.equal(c.confidence, GRAVITY.CONF_FLOOR);
});

test('never-verified brand: unknown with no reports (E3); crowd evidence moves a coin-flip start (E4)', () => {
  const silent = brandConfidence(base({ onSale: false, lastVerifiedDate: null, presenceCount: 5 }), TODAY);
  assert.equal(silent.band, 'unknown');
  assert.equal(silent.confidence, null);

  const missed = brandConfidence(base({
    onSale: false, lastVerifiedDate: null, presenceCount: 5,
    reports: [{ reportType: 'sale_started', createdAt: d(0) }],
  }), TODAY);
  assert.ok(Math.abs(missed.confidence - 0.2) < 1e-9, `0.5 × 0.4 = 0.2, got ${missed.confidence}`);
  assert.equal(missed.band, 'red');
  assert.equal(missed.hasFreshContradiction, true);
});

test('degraded mode: reports [] reproduces the pure age model exactly (§7)', () => {
  for (const age of [0, 5, 10, 14, 20, 30]) {
    const c = brandConfidence(base({ lastVerifiedDate: d(-age) }), TODAY);
    assert.equal(c.confidence, Math.max(GRAVITY.CONF_FLOOR, ageConfidence(age)));
  }
});

// ── Bands ────────────────────────────────────────────────────────────────────

test('band boundaries land per the constants table', () => {
  assert.equal(brandConfidence(base({ lastVerifiedDate: d(-7) }), TODAY).band, 'fresh');
  assert.equal(brandConfidence(base({ lastVerifiedDate: d(-9) }), TODAY).band, 'fresh');    // 2^(−2/7) ≈ 0.82
  assert.equal(brandConfidence(base({ lastVerifiedDate: d(-10) }), TODAY).band, 'aging');   // 2^(−3/7) ≈ 0.743 < 0.75
  assert.equal(brandConfidence(base({ lastVerifiedDate: d(-14) }), TODAY).band, 'aging');   // exactly 0.5
  assert.equal(brandConfidence(base({ lastVerifiedDate: d(-15) }), TODAY).band, 'red');
});

// ── Queue (ADR-001 §5.4) ─────────────────────────────────────────────────────

test('queue: fresh contradictions pin to the top regardless of raw priority', () => {
  const q = buildReverifyQueue([
    base({ brandId: 'B_STALE', lastVerifiedDate: d(-30), presenceCount: 30 }), // huge priority, no contradiction
    base({ brandId: 'B_CONTRA', lastVerifiedDate: d(0), presenceCount: 2,
           reports: [{ reportType: 'sale_ended', createdAt: d(0) }] }),
  ], TODAY);
  assert.equal(q[0].brandId, 'B_CONTRA');
  assert.equal(q[1].brandId, 'B_STALE');
});

test('queue: missed-sale override scores at FULL impact (E4, D12)', () => {
  const conf = brandConfidence(base({
    onSale: false, lastVerifiedDate: d(-10), presenceCount: 10,
    reports: [{ reportType: 'sale_started', createdAt: d(0) }],
  }), TODAY);
  const withoutOverride = (1 - conf.confidence) * 10 * GRAVITY.OFF_SALE_IMPACT;
  const p = reverifyPriority(conf);
  assert.ok(Math.abs(p - (1 - conf.confidence) * 10) < 1e-9, 'full presence impact');
  assert.ok(p > withoutOverride);
});

test('queue: zero-presence brands never surface (E8); fully-fresh brands drop out; tiebreak is deterministic', () => {
  const q = buildReverifyQueue([
    base({ brandId: 'B_ZERO', lastVerifiedDate: d(-30), presenceCount: 0 }),
    base({ brandId: 'B_FRESH', lastVerifiedDate: d(0), presenceCount: 10 }), // conf 1 → priority 0
    base({ brandId: 'B_B', lastVerifiedDate: d(-14), presenceCount: 10 }),
    base({ brandId: 'B_A', lastVerifiedDate: d(-14), presenceCount: 10 }),
  ], TODAY);
  assert.deepEqual(q.map(e => e.brandId), ['B_A', 'B_B'], 'equal priority → brandId asc');
});

test('queue: unknown-band brands interleave mid-queue via coin-flip belief', () => {
  const q = buildReverifyQueue([
    base({ brandId: 'B_RED', lastVerifiedDate: d(-30), presenceCount: 10 }),   // (1−0.107)×10 ≈ 8.9
    base({ brandId: 'B_UNKNOWN', onSale: false, lastVerifiedDate: null, presenceCount: 10 }), // (1−0.5)×4 = 2
    base({ brandId: 'B_AGING', lastVerifiedDate: d(-14), presenceCount: 10 }), // 0.5×10 = 5
  ], TODAY);
  assert.deepEqual(q.map(e => e.brandId), ['B_RED', 'B_AGING', 'B_UNKNOWN']);
});

// ── Centre aggregates (ADR-001 §5.5) ────────────────────────────────────────

test('centreGravity: empty centre returns nulls and zero counts', () => {
  const g = centreGravity('C1', []);
  assert.equal(g.meanConfidence, null);
  assert.equal(g.freshShare, null);
  assert.equal(g.redCount, 0);
});

test('centreGravity: mixed bands — unknowns counted but excluded from the mean', () => {
  const confs = [
    brandConfidence(base({ brandId: 'B1', lastVerifiedDate: d(0) }), TODAY),    // 1.0 fresh
    brandConfidence(base({ brandId: 'B2', lastVerifiedDate: d(-14) }), TODAY),  // 0.5 aging
    brandConfidence(base({ brandId: 'B3', lastVerifiedDate: d(-21) }), TODAY),  // 0.25 red
    brandConfidence(base({ brandId: 'B4', lastVerifiedDate: null }), TODAY),    // unknown (on sale, never verified, no cycle)
  ];
  const g = centreGravity('C1', confs);
  assert.equal(g.onSaleBrands, 4);
  assert.ok(Math.abs(g.meanConfidence - (1 + 0.5 + 0.25) / 3) < 1e-9);
  assert.equal(g.freshShare, 0.25, 'only B1 verified within grace');
  assert.equal(g.redCount, 1);
  assert.equal(g.unknownCount, 1);
});

test('daysBetween handles ISO timestamps and returns null on garbage', () => {
  assert.equal(daysBetween('2026-07-01', '2026-07-08'), 7);
  assert.equal(daysBetween('2026-07-01T15:30:00.000Z', TODAY), 7);
  assert.equal(daysBetween('not-a-date', TODAY), null);
});
