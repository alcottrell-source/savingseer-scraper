-- Migration: wire seo_alert_signups for DELIVERY (they were capture-only).
-- The SEO pages have been collecting "alert me when {centre} peaks" emails
-- since 20260603, but nothing ever read the table — signups never received a
-- single email. notify-high-tide's new pass 4 now sends to them, so the table
-- needs (a) a send-throttle timestamp and (b) a per-row unsubscribe token for
-- the one-click unsubscribe link PECR requires in every message.

-- Belt-and-braces send throttle: pass 4's "entered Peak today" gate is already
-- one-shot per episode, but a centre that dips out of Peak and back would
-- re-fire — this caps any signup at one email per 14 days.
ALTER TABLE seo_alert_signups
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

-- Unsubscribe token: emailed as /api/unsubscribe?token=<uuid>, which deletes
-- the row. Unguessable, per-row, no login needed (signups have no account).
ALTER TABLE seo_alert_signups
  ADD COLUMN IF NOT EXISTS unsub_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS seo_alert_signups_unsub_token
  ON seo_alert_signups (unsub_token);

-- No RLS changes: the sender (edge function) and the unsubscribe endpoint
-- (Vercel /api/unsubscribe) both use the service role, which bypasses RLS.
-- anon stays insert-only and can never read tokens or emails.
