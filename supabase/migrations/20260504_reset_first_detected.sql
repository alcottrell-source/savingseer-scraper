-- 20260504_reset_first_detected.sql
-- Reset stale `date_first_detected` for brands that haven't been admin-verified.
--
-- The "18d in" / "11d in" / etc. labels showing on the dashboard for brands the
-- user has never reviewed via /admin came from date_first_detected values
-- written by the old false-positive detector (~85% FP rate). Those start dates
-- are not trustworthy — same logic that prompted the tide_history reset.
--
-- This migration leaves admin-verified cycles alone: if active_cycle_id is set,
-- the dashboard already prefers cycle.start_date over date_first_detected, so
-- the column reset has no visible effect on those rows. We're only clearing
-- what users would otherwise see as stale "days running" for brands without a
-- human-set start date.
--
-- Reversal (if ever needed):
--   The pre-reset values are not snapshotted because date_first_detected is
--   itself derived state (the scraper rewrites it on next off->on transition).
--   Run the next 06:00 UTC scrape to repopulate.

UPDATE brand_sale_events
SET date_first_detected = CURRENT_DATE
WHERE active_cycle_id IS NULL
  AND date_first_detected IS NOT NULL
  AND date_first_detected < CURRENT_DATE;
