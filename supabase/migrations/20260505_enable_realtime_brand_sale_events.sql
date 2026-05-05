-- Enable Postgres Changes (Realtime) for brand_sale_events so the main
-- app can subscribe and re-render instantly when admin confirmations are
-- made, without requiring a page refresh.
--
-- REPLICA IDENTITY FULL means the change payload includes the full old
-- and new row, which the Supabase JS client needs to fire the event.
--
-- The ALTER PUBLICATION line adds the table to the default Supabase
-- realtime publication. If your project already has FOR ALL TABLES,
-- this is a no-op. Run idempotently.

ALTER TABLE brand_sale_events REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE brand_sale_events;
