-- Migration: SEO page email opt-ins (seo_alert_signups)
-- Captures the email + which centre/brand the shopper cares about, from the
-- programmatic-SEO pages. Mirrors the community_signals RLS pattern: anyone
-- (anon) may INSERT a signup from the browser, but only an admin may read the
-- list. The browser writes via raw PostgREST upsert (resolution=merge-duplicates),
-- so a unique key on (email, centre_slug, brand_slug) makes repeat submits idempotent.

CREATE TABLE IF NOT EXISTS seo_alert_signups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  centre_slug TEXT NOT NULL,
  brand_slug  TEXT,                       -- null = whole-centre alert (hub page)
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upsert target. COALESCE so the null brand_slug (centre-wide) still
-- de-dupes per email+centre.
CREATE UNIQUE INDEX IF NOT EXISTS seo_alert_signups_unique
  ON seo_alert_signups (email, centre_slug, COALESCE(brand_slug, ''));

ALTER TABLE seo_alert_signups ENABLE ROW LEVEL SECURITY;

-- Anyone can sign up (insert only) — same trust model as community_signals.
CREATE POLICY "anyone_insert_seo_signup" ON seo_alert_signups
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read the captured audience.
CREATE POLICY "admin_read_seo_signups" ON seo_alert_signups
  FOR SELECT TO authenticated
  USING (is_admin());

GRANT INSERT ON seo_alert_signups TO anon, authenticated;
GRANT SELECT ON seo_alert_signups TO authenticated;
