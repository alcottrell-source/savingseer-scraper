-- Migration: funnel_events v2 — source + landing dimensions.
-- See docs/architecture/funnel-events.md. Adds two closed-vocabulary
-- dimensions (referrer class, landing-path bucket) to the first-party
-- cookieless counter so acquisition channels are separable without GA.
-- Aggregate-only posture unchanged: per-day counters, no ids/IPs/cookies.
-- Existing v1 rows keep ''/'' and stay readable. Idempotent.

ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS source  TEXT NOT NULL DEFAULT '';
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS landing TEXT NOT NULL DEFAULT '';

-- Widen the PK to the new dimensions (v1 PK was (day, event)).
ALTER TABLE funnel_events DROP CONSTRAINT IF EXISTS funnel_events_pkey;
ALTER TABLE funnel_events ADD PRIMARY KEY (day, event, source, landing);

-- v2 counter write. /api/event validates the event name AND clamps both
-- dimensions to their closed vocabularies before calling this, so the
-- function itself just counts.
CREATE OR REPLACE FUNCTION bump_funnel_event(ev TEXT, src TEXT, land TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO funnel_events (day, event, source, landing, n)
  VALUES (current_date, ev, coalesce(src, ''), coalesce(land, ''), 1)
  ON CONFLICT (day, event, source, landing) DO UPDATE SET n = funnel_events.n + 1;
$$;

-- v1 signature kept as a wrapper so an old cached client / mid-rollout
-- api/event.js still counts (into the ''/'' bucket).
CREATE OR REPLACE FUNCTION bump_funnel_event(ev TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bump_funnel_event(ev, '', '');
$$;

REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION bump_funnel_event(TEXT, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION bump_funnel_event(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION bump_funnel_event(TEXT) TO service_role;
