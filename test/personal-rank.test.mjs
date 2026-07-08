// Unit tests for lib/personal-rank.js — follows-first personalisation ranking.
// Spec: docs/architecture/personalisation-ranking.md (ADR-003). Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANK, brandMatchesPrefs, resolveLens, brandFreshness,
  buildPersonalRow, rankPersonalFeed, rankGlobalFeed,
  personalVerdict, buildHistoryRow,
} from '../lib/personal-rank.js';

const CENTRE = { centreId: 'C1', name: 'Westquay' };
const brand = (over = {}) => ({
  brandId: 'B001', name: 'Next', present: true, onSale: false,
  maxPct: null, daysSinceStart: null, daysSincePctChange: null,
  ...over,
});
const prefsBase = { brand_ids: [], womenswear: false, menswear: false, childrenswear: false, style_clusters: [] };

// ── Lens resolution (ADR-003 §5.1) ──────────────────────────────────────────

test('resolveLens — follows beat prefs; one follow is enough', () => {
  const lens = resolveLens({ ...prefsBase, brand_ids: ['B007'], womenswear: true }, []);
  assert.equal(lens.basis, 'follows');
  assert.deepEqual([...lens.brandIds], ['B007']);
});

test('resolveLens — prefs fallback needs a gender flag or clusters, and ≥1 match', () => {
  const allBrands = [
    { id: 'B1', womenswear: true, menswear: false, childrenswear: false, cluster: 'premium' },
    { id: 'B2', womenswear: false, menswear: true, childrenswear: false, cluster: 'value' },
  ];
  const lens = resolveLens({ ...prefsBase, womenswear: true }, allBrands);
  assert.equal(lens.basis, 'prefs');
  assert.deepEqual([...lens.brandIds], ['B1']);
});

test('resolveLens — E5: zero-match prefs degrade to global, never an empty feed', () => {
  const allBrands = [{ id: 'B1', womenswear: true, menswear: false, childrenswear: false, cluster: 'premium' }];
  const lens = resolveLens({ ...prefsBase, childrenswear: true }, allBrands);
  assert.equal(lens.basis, 'global');
});

test('resolveLens — missing/empty prefs → global (logged out, RLS hiccup)', () => {
  assert.equal(resolveLens(null, []).basis, 'global');
  assert.equal(resolveLens(prefsBase, []).basis, 'global');
});

// ── Prefs matching parity with score.js semantics (ADR-003 §5.3) ────────────

test('brandMatchesPrefs — gender overlap matrix + cluster filter only when non-empty', () => {
  const b = { womenswear: true, menswear: false, childrenswear: false, cluster: 'premium' };
  assert.equal(brandMatchesPrefs(b, { ...prefsBase, womenswear: true }), true);
  assert.equal(brandMatchesPrefs(b, { ...prefsBase, menswear: true }), false, 'no gender overlap');
  assert.equal(brandMatchesPrefs(b, { ...prefsBase, womenswear: true, style_clusters: ['value'] }), false, 'cluster mismatch');
  assert.equal(brandMatchesPrefs(b, { ...prefsBase, womenswear: true, style_clusters: ['premium'] }), true);
  assert.equal(brandMatchesPrefs(b, { ...prefsBase, womenswear: true, style_clusters: [] }), true, 'empty clusters = no filter');
});

// ── Freshness (ADR-003 §5.2) ────────────────────────────────────────────────

test('brandFreshness — τ decay: 0d→1, 5d→0.5, 10d→0.25', () => {
  assert.equal(brandFreshness(brand({ daysSinceStart: 0 })), 1);
  assert.equal(brandFreshness(brand({ daysSinceStart: 5 })), 0.5);
  assert.equal(brandFreshness(brand({ daysSinceStart: 10 })), 0.25);
});

test('brandFreshness — a deepened old sale scores like a new one (min of the two ages)', () => {
  const deepened = brandFreshness(brand({ daysSinceStart: 18, daysSincePctChange: 0 }));
  assert.equal(deepened, 1, 'pct_changed_date today → fully fresh');
});

test('brandFreshness — E4: null dates contribute 0, never NaN', () => {
  assert.equal(brandFreshness(brand()), 0);
  assert.equal(brandFreshness(brand({ daysSinceStart: null, daysSincePctChange: -2 })), 0, 'negative age ignored');
});

// ── Row building (ADR-003 §4, E1/E2/E3/E6) ─────────────────────────────────

const follows = new Set(['B1', 'B2', 'B3']);
const threeBrands = (o1 = {}, o2 = {}, o3 = {}) => [
  brand({ brandId: 'B1', name: 'Next', ...o1 }),
  brand({ brandId: 'B2', name: 'Zara', ...o2 }),
  brand({ brandId: 'B3', name: 'H&M', ...o3 }),
];

test('buildPersonalRow — E1: none of your brands present → null (no 0/0)', () => {
  const row = buildPersonalRow(CENTRE, threeBrands({ present: false }, { present: false }, { present: false }), follows);
  assert.equal(row, null);
});

test('buildPersonalRow — counts, pct rounding, names, max pct with nulls (E3)', () => {
  const row = buildPersonalRow(CENTRE, threeBrands(
    { onSale: true, maxPct: 50, daysSinceStart: 5 },
    { onSale: true, maxPct: null, daysSinceStart: 0 },
    {},
  ), follows);
  assert.equal(row.myPresent, 3);
  assert.equal(row.myOnSale, 2);
  assert.equal(row.personalPct, 67, 'round(2/3×100)');
  assert.equal(row.maxPct, 50, 'null % excluded from max');
  assert.deepEqual(row.onSaleBrandNames, ['Next', 'Zara']);
  assert.equal(row.freshness, 1.5, '0.5 (5d) + 1.0 (0d)');
});

test('buildPersonalRow — E6: duplicate rows and unknown followed ids are harmless', () => {
  const brands = [...threeBrands({ onSale: true }), brand({ brandId: 'B1', name: 'Next', onSale: true })];
  const row = buildPersonalRow(CENTRE, brands, new Set(['B1', 'B2', 'B3', 'B_DELETED']));
  assert.equal(row.myPresent, 3, 'duplicate B1 counted once, unknown id ignored');
  assert.equal(row.myOnSale, 1);
});

test('buildPersonalRow — un-followed brands are invisible even when on sale', () => {
  const row = buildPersonalRow(CENTRE, threeBrands({ onSale: true }), new Set(['B2']));
  assert.equal(row.myPresent, 1);
  assert.equal(row.myOnSale, 0);
});

// ── Feed ordering (ADR-003 §3) — each key exercised in isolation ────────────

const feedRow = (name, over = {}) => ({
  centreId: name, name, myPresent: 4, myOnSale: 1, personalPct: 25,
  maxPct: 30, freshness: 0.5, onSaleBrandNames: ['Next'], ...over,
});

test('rankPersonalFeed — E2: centres with none of your shops on sale are excluded', () => {
  const out = rankPersonalFeed([feedRow('A', { myOnSale: 0 }), feedRow('B'), null]);
  assert.deepEqual(out.map(r => r.name), ['B']);
});

test('rankPersonalFeed — key 1: your-shops-on-sale count is primary', () => {
  const out = rankPersonalFeed([feedRow('A', { myOnSale: 1, freshness: 5, maxPct: 90 }), feedRow('B', { myOnSale: 2, freshness: 0, maxPct: null })]);
  assert.deepEqual(out.map(r => r.name), ['B', 'A'], 'four old sales beat one fresh deep one');
});

test('rankPersonalFeed — key 2: freshness breaks count ties (D11: new-for-you beats still-on)', () => {
  const out = rankPersonalFeed([feedRow('A', { freshness: 0.1, maxPct: 90 }), feedRow('B', { freshness: 1.8, maxPct: 20 })]);
  assert.deepEqual(out.map(r => r.name), ['B', 'A']);
});

test('rankPersonalFeed — key 3: depth; null % sorts below any number (E3)', () => {
  const out = rankPersonalFeed([feedRow('A', { maxPct: null }), feedRow('B', { maxPct: 10 })]);
  assert.deepEqual(out.map(r => r.name), ['B', 'A']);
});

test('rankPersonalFeed — key 4 density, then key 5 name (E7: total, deterministic)', () => {
  const out = rankPersonalFeed([
    feedRow('B'), feedRow('A'),
    feedRow('C', { personalPct: 50 }),
  ]);
  assert.deepEqual(out.map(r => r.name), ['C', 'A', 'B']);
  const again = rankPersonalFeed([feedRow('A'), feedRow('B'), feedRow('C', { personalPct: 50 })]);
  assert.deepEqual(again.map(r => r.name), out.map(r => r.name), 'stable across input order');
});

test('rankGlobalFeed — score desc, then severity, then name (shipped parity)', () => {
  const out = rankGlobalFeed([
    { name: 'A', tideScore: 20, verdictWord: 'RISING' },
    { name: 'B', tideScore: 35, verdictWord: 'EASING' },
    { name: 'C', tideScore: 20, verdictWord: 'PEAK' },
  ]);
  assert.deepEqual(out.map(r => r.name), ['B', 'C', 'A']);
});

// ── Personal verdict (ADR-003 §5.4) ─────────────────────────────────────────

test('personalVerdict — boundaries; lifecycle vocabulary is unreachable', () => {
  assert.equal(personalVerdict(14.9), 'Quiet');
  assert.equal(personalVerdict(15), 'Rising');
  assert.equal(personalVerdict(39.9), 'Rising');
  assert.equal(personalVerdict(40), 'Peak');
  for (let pct = 0; pct <= 100; pct += 0.5) {
    assert.ok(!['Easing', 'Over'].includes(personalVerdict(pct)),
      'per-user rows have no history — Easing/Over are forbidden (honesty rule)');
  }
});

// ── History rows (ADR-003 §5.5) ─────────────────────────────────────────────

test('buildHistoryRow — stamps basis, maps counts, skips global users and absent centres', () => {
  const brands = threeBrands({ onSale: true, maxPct: 40 });
  const lens = { basis: 'follows', brandIds: follows };
  const row = buildHistoryRow('u1', '2026-07-08', lens, CENTRE, brands);
  assert.deepEqual(row, {
    user_id: 'u1', centre_id: 'C1', score_date: '2026-07-08',
    personal_tide_score: 33, matching_brands: 3, matching_on_sale: 1,
    verdict: 'Rising', basis: 'follows',
  });

  assert.equal(buildHistoryRow('u1', '2026-07-08', { basis: 'global' }, CENTRE, brands), null);
  const absent = threeBrands({ present: false }, { present: false }, { present: false });
  assert.equal(buildHistoryRow('u1', '2026-07-08', lens, CENTRE, absent), null);
});
