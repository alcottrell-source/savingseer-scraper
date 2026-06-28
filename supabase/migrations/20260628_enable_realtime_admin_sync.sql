-- Enable Postgres Changes (Realtime) for the rest of the tables an admin
-- confirmation touches, so the main app catches up the WHOLE card — not just
-- the brand chips — without a page refresh.
--
-- Background: admin confirmations land in two waves.
--   1. The admin write hits brand_sale_events + brand_sale_cycles immediately.
--   2. The fire-and-forget /api/rescore rewrites centre_seer_scores and
--      centres.tide_history a second or two LATER.
-- Only brand_sale_events was in the realtime publication (see
-- 20260505_enable_realtime_brand_sale_events.sql), so the headline %, verdict
-- word and history chart — all sourced from centre_seer_scores / centres —
-- stayed stale until the app's 60s poll. Adding these tables lets the rescore's
-- second wave push a fresh reload as soon as it lands.
--
-- REPLICA IDENTITY FULL means the change payload includes the full old/new row,
-- which the Supabase JS client needs to fire the event. The ALTER PUBLICATION
-- lines add each table to the default Supabase realtime publication; if your
-- project already has FOR ALL TABLES, they are no-ops. Run idempotently.

ALTER TABLE brand_sale_cycles  REPLICA IDENTITY FULL;
ALTER TABLE centre_seer_scores REPLICA IDENTITY FULL;
ALTER TABLE centres            REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE brand_sale_cycles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE centre_seer_scores;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE centres;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
