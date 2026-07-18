import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMergedCycle, mergeGapDays } from '../lib/merge-cycles.js';

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
