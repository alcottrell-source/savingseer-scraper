-- Migration: international expansion waitlist (waitlist)
-- Captures email + detected country from NON-UK visitors, who land on a
-- UK-only product and would otherwise bounce. Mirrors the seo_alert_signups
-- RLS pattern: anyone (anon) may INSERT a signup from the browser, but only an
-- admin may read the list. The browser writes via raw PostgREST upsert
-- (resolution=merge-duplicates), so a unique key on email makes repeat submits
-- idempotent (one row per person; country/source_url refresh on re-submit). The
-- client lowercases the address before insert, so a plain unique index on email
-- de-dupes case variants AND remains a valid PostgREST on_conflict=email target
-- (an expression index like lower(email) cannot be used as a conflict target).

CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  country     TEXT,                       -- ISO-2 from geo detect; null = unknown
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upsert target (client normalises email to lowercase before insert).
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique
  ON waitlist (email);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Anyone can sign up (insert only) — same trust model as seo_alert_signups.
CREATE POLICY "anyone_insert_waitlist" ON waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read the captured audience.
CREATE POLICY "admin_read_waitlist" ON waitlist
  FOR SELECT TO authenticated
  USING (is_admin());

GRANT INSERT ON waitlist TO anon, authenticated;
GRANT SELECT ON waitlist TO authenticated;
