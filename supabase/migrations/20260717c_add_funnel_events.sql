-- Migration: first-party, cookieless funnel counter (funnel_events).
-- GA4 is consent-gated (PECR opt-in), which biases every absolute count and
-- can hide whole steps of the conversion funnel. This table holds aggregate
-- counts only — (day, event) += 1 — no user ids, no IPs, no cookies, so it
-- sits outside consent like a server log. Written by /api/event (service
-- role via the bump_funnel_event RPC); readable by the admin.

CREATE TABLE IF NOT EXISTS funnel_events (
  day   DATE    NOT NULL,
  event TEXT    NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

-- Only the admin can read the counts (mirrors seo_alert_signups' pattern).
CREATE POLICY "admin_read_funnel_events" ON funnel_events
  FOR SELECT TO authenticated
  USING (is_admin());

-- Atomic increment. SECURITY DEFINER so the caller needs no table grants;
-- execution is service-role only — the browser never talks to this directly
-- (it posts to /api/event, which validates the event name first).
CREATE OR REPLACE FUNCTION bump_funnel_event(ev TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO funnel_events (day, event, n) VALUES (current_date, ev, 1)
  ON CONFLICT (day, event) DO UPDATE SET n = funnel_events.n + 1;
$$;

REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION bump_funnel_event(TEXT) TO service_role;
