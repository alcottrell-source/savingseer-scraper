import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMergedCycle, mergeGapDays, healGapDates, healedScoreRow } from '../lib/merge-cycles.js';
import { healMergedGap } from '../score.js';

const cycle = (over) => ({
  id: 'c-' + Math.random().toString(36).slice(2, 8),
  brand_id: 'B001',
  start_date: '2026-07-01',
  end_date: '2026-07-09',
  max_discount_pct: 30,
  sale_type: 'percent_off',
  description: null,
  pct_changed_date: '2026-07-01',
  prior_discount_pct: null,
  ...over,
});

test('gap days: ended one day, restarted the next = 1', () => {
  const a = cycle({ end_date: '2026-07-09' });
  const b = cycle({ start_date: '2026-07-10', end_date: null });
  assert.equal(mergeGapDays(a, b), 1);
});

test('gap days: overlap reads as <= 0, missing end reads as null', () => {
  assert.equal(mergeGapDays(cycle({ end_date: '2026-07-09' }), cycle({ start_date: '2026-07-09' })), 0);
  assert.equal(mergeGapDays(cycle({ end_date: null }), cycle({ start_date: '2026-07-10' })), null);
});

test('the classic mistake: closed then reopened next day at the same % merges live, no fake deepening', () => {
  const a = cycle({ start_date: '2026-07-01', end_date: '2026-07-09', max_discount_pct: 30 });
  const b = cycle({ start_date: '2026-07-10', end_date: null, max_discount_pct: 30, pct_changed_date: '2026-07-10' });
  const { earlier, later, live, update } = computeMergedCycle(a, b);
  assert.equal(earlier, a);
  assert.equal(later, b);
  assert.equal(live, true);
  assert.equal(update.end_date, null);
  assert.equal(update.max_discount_pct, 30);
  // Same % on both sides — the merge must not rewrite the deepening record.
  assert.ok(!('pct_changed_date' in update));
  assert.ok(!('prior_discount_pct' in update));
});

test('pair order does not matter', () => {
  const a = cycle({ start_date: '2026-07-01', end_date: '2026-07-09' });
  const b = cycle({ start_date: '2026-07-10', end_date: null });
  const fwd = computeMergedCycle(a, b);
  const rev = computeMergedCycle(b, a);
  assert.equal(rev.earlier, a);
  assert.equal(rev.later, b);
  assert.deepEqual(rev.update, fwd.update);
});

test('two closed cycles merge closed, spanning to the later end date', () => {
  const a = cycle({ start_date: '2026-05-04', end_date: '2026-05-05', max_discount_pct: 20 });
  const b = cycle({ start_date: '2026-05-07', end_date: '2026-05-09', max_discount_pct: 20 });
  const { live, update } = computeMergedCycle(a, b);
  assert.equal(live, false);
  assert.equal(update.end_date, '2026-05-09');
});

test('later cycle deeper: merged % is the max and the deepening record points at the later cycle', () => {
  const a = cycle({ start_date: '2026-07-01', end_date: '2026-07-09', max_discount_pct: 30 });
  const b = cycle({
    start_date: '2026-07-10', end_date: null, max_discount_pct: 50,
    pct_changed_date: '2026-07-12',
  });
  const { update } = computeMergedCycle(a, b);
  assert.equal(update.max_discount_pct, 50);
  assert.equal(update.pct_changed_date, '2026-07-12');
  assert.equal(update.prior_discount_pct, 30);
});

test('later cycle with no pct_changed_date falls back to its start_date', () => {
  const a = cycle({ max_discount_pct: 30 });
  const b = cycle({ start_date: '2026-07-10', end_date: null, max_discount_pct: 40, pct_changed_date: null });
  const { update } = computeMergedCycle(a, b);
  assert.equal(update.pct_changed_date, '2026-07-10');
});

test('earlier cycle already deeper: % stays, no deepening rewrite', () => {
  const a = cycle({ max_discount_pct: 50 });
  const b = cycle({ start_date: '2026-07-10', end_date: null, max_discount_pct: 30 });
  const { update } = computeMergedCycle(a, b);
  assert.equal(update.max_discount_pct, 50);
  assert.ok(!('pct_changed_date' in update));
});

test('null percentages: one side null uses the other, both null stays null', () => {
  const oneSide = computeMergedCycle(
    cycle({ max_discount_pct: null }),
    cycle({ start_date: '2026-07-10', end_date: null, max_discount_pct: 25 })
  );
  assert.equal(oneSide.update.max_discount_pct, 25);
  const bothNull = computeMergedCycle(
    cycle({ max_discount_pct: null }),
    cycle({ start_date: '2026-07-10', end_date: null, max_discount_pct: null })
  );
  assert.equal(bothNull.update.max_discount_pct, null);
  assert.ok(!('pct_changed_date' in bothNull.update));
});

test('description and sale_type: later wins, earlier is the fallback', () => {
  const keepLater = computeMergedCycle(
    cycle({ description: 'old copy', sale_type: 'percent_off' }),
    cycle({ start_date: '2026-07-10', end_date: null, description: 'new copy', sale_type: 'flash' })
  );
  assert.equal(keepLater.update.description, 'new copy');
  assert.equal(keepLater.update.sale_type, 'flash');
  const fallBack = computeMergedCycle(
    cycle({ description: 'old copy' }),
    cycle({ start_date: '2026-07-10', end_date: null, description: null, sale_type: null })
  );
  assert.equal(fallBack.update.description, 'old copy');
  assert.equal(fallBack.update.sale_type, 'percent_off');
});

test('overlapping rows where the earlier one ends later: keep the later end date', () => {
  const a = cycle({ start_date: '2026-06-01', end_date: '2026-06-20' });
  const b = cycle({ start_date: '2026-06-10', end_date: '2026-06-15' });
  const { live, update } = computeMergedCycle(a, b);
  assert.equal(live, false);
  assert.equal(update.end_date, '2026-06-20');
});

test('earlier cycle still open merges live even if the later one is closed', () => {
  const a = cycle({ end_date: null });
  const b = cycle({ start_date: '2026-07-10', end_date: '2026-07-12' });
  const { live, update } = computeMergedCycle(a, b);
  assert.equal(live, true);
  assert.equal(update.end_date, null);
});

// ── Stored-history heal ─────────────────────────────────────────────────────

test('healGapDates: end-date day through the day before the restart', () => {
  // Ended 9 Jul, restarted 16 Jul → heal 9..15 inclusive.
  assert.deepEqual(healGapDates('2026-07-09', '2026-07-16'), [
    '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
  ]);
  // The classic next-day restart: only the end-date day carried the dip.
  assert.deepEqual(healGapDates('2026-07-09', '2026-07-10'), ['2026-07-09']);
});

test('healGapDates: overlap, missing dates, and month boundaries', () => {
  assert.deepEqual(healGapDates('2026-07-10', '2026-07-10'), []);
  assert.deepEqual(healGapDates('2026-07-12', '2026-07-10'), []);
  assert.deepEqual(healGapDates(null, '2026-07-10'), []);
  assert.deepEqual(healGapDates('2026-07-09', null), []);
  assert.deepEqual(healGapDates('2026-06-29', '2026-07-02'), ['2026-06-29', '2026-06-30', '2026-07-01']);
});

test('healedScoreRow: +1 brand, score re-derived with score.js rounding', () => {
  assert.deepEqual(healedScoreRow({ brands_on_sale: 22, total_brands: 77 }),
    { brands_on_sale: 23, tide_score: 29.9 });
  assert.deepEqual(healedScoreRow({ brands_on_sale: 0, total_brands: 40 }),
    { brands_on_sale: 1, tide_score: 2.5 });
  assert.deepEqual(healedScoreRow({ brands_on_sale: null, total_brands: 40 }),
    { brands_on_sale: 1, tide_score: 2.5 });
});

test('healedScoreRow: clamps at total_brands and rejects unusable totals', () => {
  assert.equal(healedScoreRow({ brands_on_sale: 40, total_brands: 40 }), null);
  assert.equal(healedScoreRow({ brands_on_sale: 5, total_brands: 0 }), null);
  assert.equal(healedScoreRow({ brands_on_sale: 5, total_brands: null }), null);
});

// Minimal fake of the supabase-js query chains healMergedGap uses, recording
// the update writes so the query shape (centres × gap dates, per-row updates)
// is pinned down.
function fakeSupabase({ centreRows, scoreRows }) {
  const updates = [];
  return {
    updates,
    from(table) {
      return {
        select() {
          const filters = {};
          const q = {
            eq(col, val) { filters[col] = val; return q; },
            in(col, vals) { filters[col] = vals; return q; },
            then(resolve) {
              if (table === 'centre_brands') return resolve({ data: centreRows, error: null });
              const rows = scoreRows.filter(r =>
                filters.centre_id.includes(r.centre_id) && filters.score_date.includes(r.score_date));
              return resolve({ data: rows, error: null });
            },
          };
          return q;
        },
        update(body) {
          const keys = {};
          const q = {
            eq(col, val) { keys[col] = val; return q; },
            then(resolve) { updates.push({ table, keys, body }); return resolve({ error: null }); },
          };
          return q;
        },
      };
    },
  };
}

test('healMergedGap: heals every stored gap row across the brand\'s centres', async () => {
  const sb = fakeSupabase({
    centreRows: [{ centre_id: 'westquay' }, { centre_id: 'lakeside' }],
    scoreRows: [
      { centre_id: 'westquay', score_date: '2026-07-09', brands_on_sale: 22, total_brands: 77 },
      { centre_id: 'lakeside', score_date: '2026-07-09', brands_on_sale: 10, total_brands: 40 },
      // Day with no dip possible (already at ceiling) — skipped.
      { centre_id: 'westquay', score_date: '2026-07-10', brands_on_sale: 77, total_brands: 77 },
      // Outside the gap — never read back (filtered by score_date).
      { centre_id: 'westquay', score_date: '2026-07-11', brands_on_sale: 5, total_brands: 77 },
    ],
  });
  const { healedRows } = await healMergedGap(
    { brandId: 'B020', fromDate: '2026-07-09', toDate: '2026-07-11' }, sb);
  assert.equal(healedRows, 2);
  assert.deepEqual(sb.updates.map(u => u.keys), [
    { centre_id: 'westquay', score_date: '2026-07-09' },
    { centre_id: 'lakeside', score_date: '2026-07-09' },
  ]);
  assert.deepEqual(sb.updates[0].body, { brands_on_sale: 23, tide_score: 29.9 });
  assert.deepEqual(sb.updates[1].body, { brands_on_sale: 11, tide_score: 27.5 });
});

test('healMergedGap: no gap days or no centres → no writes', async () => {
  const sb = fakeSupabase({ centreRows: [], scoreRows: [] });
  assert.deepEqual(await healMergedGap({ brandId: 'B020', fromDate: '2026-07-10', toDate: '2026-07-10' }, sb), { healedRows: 0 });
  assert.deepEqual(await healMergedGap({ brandId: 'B020', fromDate: '2026-07-09', toDate: '2026-07-12' }, sb), { healedRows: 0 });
  assert.equal(sb.updates.length, 0);
});
