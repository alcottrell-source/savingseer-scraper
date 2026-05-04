-- 20260504_reset_first_detected.sql
-- Reset stale `date_first_detected` for brands that haven't been admin-verified.
--
-- The "18d in" / "11d in" / etc. labels showing on the dashboard for brands the
-- user has never reviewed via /admin came from date_first_detected values
-- written by the old false-positive detector (~85% FP rate). Those start dates
-- are not trustworthy — same reasoning as the tide_history reset.
--
-- This migration leaves admin-verified cycles alone: if active_cycle_id is set,
-- the dashboard already prefers cycle.start_date over date_first_detected, so
-- the column reset has no visible effect on those rows.
--
-- An immutability trigger (enforce_date_first_detected_immutable) protects the
-- column from accidental overwrites. The DO block locates that specific
-- trigger and disables it for the duration of the deliberate reset, then
-- re-enables. If the trigger isn't present (different DB, already dropped),
-- the update runs unguarded — that's fine for this manual operation.
--
-- Reversal (if ever needed):
--   The pre-reset values are not snapshotted because date_first_detected is
--   itself derived state (the scraper rewrites it on next off->on transition).
--   Run the next 06:00 UTC scrape to repopulate.

DO $$
DECLARE
  trig_name text;
BEGIN
  SELECT tgname INTO trig_name
  FROM pg_trigger
  WHERE tgrelid = 'brand_sale_events'::regclass
    AND tgfoid = 'enforce_date_first_detected_immutable'::regproc
    AND NOT tgisinternal
  LIMIT 1;

  IF trig_name IS NULL THEN
    RAISE NOTICE 'No enforce_date_first_detected_immutable trigger found — proceeding without disable.';
  ELSE
    EXECUTE format('ALTER TABLE brand_sale_events DISABLE TRIGGER %I', trig_name);
  END IF;

  UPDATE brand_sale_events
  SET date_first_detected = CURRENT_DATE
  WHERE active_cycle_id IS NULL
    AND date_first_detected IS NOT NULL
    AND date_first_detected < CURRENT_DATE;

  IF trig_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE brand_sale_events ENABLE TRIGGER %I', trig_name);
  END IF;
END $$;
