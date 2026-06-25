-- Migration: brand-sale alert send-once dedup (brand_sale_notifications)
-- The notify-high-tide edge function's brand-sale pass switched from a
-- "started today" one-shot trigger (start_date == today) to a sent-state model:
-- every daily run gathers all of a user's currently-on-sale followed brands that
-- have NOT yet been emailed to them, combines them into one email, and records
-- what was sent here so the same sale is never sent twice.
--
-- `sale_key` is the dedup unit per (user, sale):
--   • an open cycle  -> active_cycle_id (uuid as text)
--   • no-cycle sale  -> 'nocycle:<brand_id>:<date_first_detected>' (immutable)
-- Only the service role (the edge function) reads/writes this; service role
-- bypasses RLS. The SELECT policy below just lets a signed-in user inspect their
-- own rows for debugging.

CREATE TABLE IF NOT EXISTS brand_sale_notifications (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sale_key  TEXT NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sale_key)
);

ALTER TABLE brand_sale_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_own_sale_notifs" ON brand_sale_notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON brand_sale_notifications TO authenticated;
