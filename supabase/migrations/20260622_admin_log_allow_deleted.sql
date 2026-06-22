-- ──────────────────────────────────────────────────────────────────────────────
-- Allow the 'deleted' action in admin_review_log.
--
-- Bug: deleteCycle() in admin.html logs action='deleted', but the original
-- CHECK constraint (20260504_add_admin_console_and_cycles.sql:114) only permits
-- confirmed_on/off/start/end, dismissed, edited. The three writes in
-- deleteCycle are NOT transactional, so the cycle row + event reset committed
-- while the final logReview('deleted') threw a CHECK violation — the admin saw
-- "Delete failed", the rescore never fired, and the public store went stale.
--
-- This widens the allow-list so the audit log records deletions correctly. The
-- client (deleteCycle) is also hardened to treat the log write as best-effort
-- so a future constraint drift can never again abort the delete + rescore.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE admin_review_log DROP CONSTRAINT IF EXISTS admin_review_log_action_check;

ALTER TABLE admin_review_log
  ADD CONSTRAINT admin_review_log_action_check
  CHECK (action IN ('confirmed_on','confirmed_off','confirmed_start','confirmed_end','dismissed','edited','deleted'));
