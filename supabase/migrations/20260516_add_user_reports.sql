-- ──────────────────────────────────────────────────────────────────────────────
-- user_reports — logged-in users flag what they see in-store / on-site.
--
-- ADVISORY ONLY. Nothing in this table ever auto-changes public sale state.
-- It is a signal surfaced in admin.html; only an admin clicking confirm in
-- the admin console mutates brand_sale_events / brand_sale_cycles.
--
-- It deliberately does NOT touch brand_sale_events.date_first_detected
-- (write-once via Postgres trigger — corrupting it breaks the Gravity
-- Engine). Reports are a separate table; the admin reconciles them by hand.
--
-- No photo column in V1 (by design — do not add one without a spec change).
--
-- Idempotent: safe to re-run. Follows the is_admin() / RLS conventions from
-- 20260504_add_admin_console_and_cycles.sql.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_reports (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id               TEXT         NOT NULL REFERENCES brands(id),
  centre_id              UUID         NOT NULL REFERENCES centres(id),
  reason                 TEXT         NOT NULL CHECK (reason IN (
                                        'sale_ended',
                                        'discount_different',
                                        'confirms_shown',
                                        'sale_started'
                                      )),
  -- Only set for discount-related reports. Bucketed chips: 20/30/40/50/60/70+.
  -- 70 is the "70+%" bucket. NULL for non-discount reasons.
  reported_discount_pct  INT          CHECK (
                                        reported_discount_pct IS NULL OR
                                        reported_discount_pct IN (20,30,40,50,60,70)
                                      ),
  -- Queue lifecycle so reviewed reports drop out of the urgent-first queue.
  status                 TEXT         NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open','reviewed','dismissed')),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One open report per user per brand+centre+reason — re-reporting the same
-- thing just refreshes the timestamp rather than inflating the count.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reports_dedupe
  ON user_reports (user_id, brand_id, centre_id, reason)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_user_reports_centre_created
  ON user_reports (centre_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_brand_created
  ON user_reports (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_open
  ON user_reports (created_at DESC) WHERE status = 'open';

ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

-- Insert: authenticated users only, and only as themselves. The ⋯ button is
-- hidden when logged out; this is the server-side enforcement of that.
DROP POLICY IF EXISTS "users_insert_own_reports" ON user_reports;
CREATE POLICY "users_insert_own_reports" ON user_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Read: a user can see their own reports; admin sees everything.
DROP POLICY IF EXISTS "users_select_own_reports" ON user_reports;
CREATE POLICY "users_select_own_reports" ON user_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin());

-- Update: a user can refresh/withdraw their own open report (used by the
-- upsert-on-conflict re-report path); admin can triage any report's status.
DROP POLICY IF EXISTS "users_update_own_reports" ON user_reports;
CREATE POLICY "users_update_own_reports" ON user_reports
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR is_admin())
  WITH CHECK (auth.uid() = user_id OR is_admin());

-- Delete: admin only (housekeeping).
DROP POLICY IF EXISTS "admin_delete_reports" ON user_reports;
CREATE POLICY "admin_delete_reports" ON user_reports
  FOR DELETE TO authenticated
  USING (is_admin());

GRANT INSERT, SELECT, UPDATE ON user_reports TO authenticated;
GRANT DELETE ON user_reports TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- user_reports_24h_summary — one row per brand+centre with an open report in
-- the last 24h. Drives the admin "Users" column, distribution chart and the
-- urgent-first queue sort. security_invoker so the caller's RLS applies (only
-- admins can read the underlying rows, so only admins see the summary).
-- ──────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS user_reports_24h_summary;
CREATE VIEW user_reports_24h_summary
  WITH (security_invoker = on) AS
SELECT
  brand_id,
  centre_id,
  COUNT(*)                                                    AS report_count,
  COUNT(DISTINCT user_id)                                      AS reporter_count,
  COUNT(*) FILTER (WHERE reason = 'sale_ended')                AS n_sale_ended,
  COUNT(*) FILTER (WHERE reason = 'discount_different')         AS n_discount_different,
  COUNT(*) FILTER (WHERE reason = 'confirms_shown')             AS n_confirms_shown,
  COUNT(*) FILTER (WHERE reason = 'sale_started')               AS n_sale_started,
  -- Discount distribution as {pct: count} for the admin mini bar chart.
  COALESCE(
    jsonb_object_agg(reported_discount_pct, pct_count)
      FILTER (WHERE reported_discount_pct IS NOT NULL),
    '{}'::jsonb
  )                                                            AS discount_distribution,
  MAX(created_at)                                              AS last_reported_at,
  MIN(created_at)                                              AS first_reported_at
FROM (
  SELECT
    brand_id, centre_id, user_id, reason, created_at,
    reported_discount_pct,
    COUNT(*) OVER (PARTITION BY brand_id, centre_id, reported_discount_pct) AS pct_count
  FROM user_reports
  WHERE status = 'open'
    AND created_at >= NOW() - INTERVAL '24 hours'
) r
GROUP BY brand_id, centre_id;

GRANT SELECT ON user_reports_24h_summary TO authenticated;
