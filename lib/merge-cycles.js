// Merging two brand_sale_cycles rows that are really ONE sale — pure logic.
//
// The admin console's "Sale history" tab uses this when an operator has
// mistakenly ended a sale one day and re-confirmed it as a new cycle the next
// day: the two rows describe a single continuous sale and should read that way
// everywhere (shop detail sheet, notify dedup, score history). The EARLIER
// cycle survives (its id and start_date are the sale's true origin — keeping
// them means the one-shot brand-sale alert, which keys off the open cycle's
// start_date, cannot re-arm); the later cycle's row is deleted by the caller.
//
// This module only computes fields — the DB sequencing (repoint
// brand_sale_events.active_cycle_id, delete the later row, then apply this
// update so the one-open-cycle-per-brand unique index is never violated)
// lives in admin.html's mergeCycles().

// Days from the earlier cycle's end to the later cycle's start. 1 = the sale
// "restarted" the very next day (the classic mistake this feature exists for);
// 0 or negative = the rows overlap; null = the earlier cycle has no end_date
// (broken data — an open cycle with a later sibling) so no honest gap exists.
export function mergeGapDays(earlier, later) {
  if (!earlier.end_date || !later.start_date) return null;
  return Math.round(
    (new Date(later.start_date + 'T12:00:00') - new Date(earlier.end_date + 'T12:00:00')) / 86400000
  );
}

// Compute the surviving cycle's fields. Accepts the pair in either order and
// sorts by start_date itself. Returns:
//   earlier / later — the pair in chronological order (later is the row to delete)
//   live            — whether the merged sale is still running
//   update          — the PATCH body for the earlier (surviving) row
export function computeMergedCycle(a, b) {
  let earlier = a, later = b;
  if ((b.start_date || '') < (a.start_date || '')) { earlier = b; later = a; }

  const live = earlier.end_date == null || later.end_date == null;
  // Max of the two end dates guards the odd overlap where the earlier row was
  // edited to end after the later one started and ended.
  const endDate = live
    ? null
    : (earlier.end_date > later.end_date ? earlier.end_date : later.end_date);

  // max_discount_pct is the cycle's deepest recorded %, so the merged value is
  // the max across both rows (null = never recorded).
  const pcts = [earlier.max_discount_pct, later.max_discount_pct].filter(p => p != null);
  const finalPct = pcts.length ? Math.max(...pcts) : null;

  const update = {
    end_date: endDate,
    max_discount_pct: finalPct,
    // Latest known values win; fall back to the earlier row's.
    sale_type: later.sale_type || earlier.sale_type || 'percent_off',
    description: later.description ?? earlier.description ?? null,
  };

  // pct_changed_date / prior_discount_pct: only rewrite the deepening record
  // when the merge actually changes the surviving row's % — i.e. the later
  // cycle carried a deeper discount. Then the raise date is the later cycle's
  // own pct-change date (backfilled to its start_date), and the prior % is
  // what the earlier row held. A merge where the % doesn't move (same % both
  // sides, or the earlier row was already deeper) must NOT make an old sale
  // look freshly updated on the public "Newest Sales" panel.
  if (finalPct !== (earlier.max_discount_pct ?? null)) {
    update.pct_changed_date = later.pct_changed_date || later.start_date;
    update.prior_discount_pct = earlier.max_discount_pct ?? null;
  }

  return { earlier, later, live, update };
}
