-- Migration: allow the 'merged' admin_review_log verb
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- The admin console's new "Sale history" tab lets the operator merge two
-- adjacent brand_sale_cycles rows that are really one sale (a cycle mistakenly
-- ended one day and re-confirmed as a new cycle the next). The merge logs a
-- dedicated 'merged' verb (with a before/after date-range note) so the
-- confirmed-today list reads "Merged sale cycles" rather than the generic
-- "Edited". No new tables or policies — the merge itself runs through the
-- existing admin-only write policies on brand_sale_cycles / brand_sale_events.
--
-- Idempotent: safe to re-run.

ALTER TABLE admin_review_log DROP CONSTRAINT IF EXISTS admin_review_log_action_check;
ALTER TABLE admin_review_log ADD CONSTRAINT admin_review_log_action_check
  CHECK (action IN ('confirmed_on','confirmed_off','confirmed_start','confirmed_end','dismissed','edited','deleted','increased','merged'));
