-- ──────────────────────────────────────────────────────────────────────────────
-- user_reports — logged-in users flag what they actually saw in store / on-site.
--
-- ADVISORY ONLY. Nothing here ever auto-changes public sale state. It is a
-- signal surfaced in admin.html; only an admin clicking the action button in
-- the admin console mutates brand_sale_events / brand_sale_cycles.
--
-- It deliberately never touches brand_sale_events.date_first_detected
-- (write-once via Postgres trigger — corrupting it breaks the Gravity Engine).
-- Reports are a separate, immutable table; the admin reconciles by hand.
--
-- No photo column in V1 (by design — do not add one without a spec change).
--
-- Schema is per the implementation brief. Two deviations from the brief's
-- literal SQL, made because admin.html authenticates as a normal Supabase
-- user (alcottrell@gmail.com via signInWithPassword), NOT the service_role
-- key — same as the existing community_signals table:
--   1. An is_admin() read policy is added alongside the brief's policies, so
--      the admin panel can actually read reports (the service_role policy
--      alone never matches an authenticated browser session).
--   2. The 24h view is security_invoker so the caller's RLS applies — a plain
--      view would otherwise expose every user's aggregates to any logged-in
--      user. With security_invoker, regular users see only aggregates of
--      their own rows; is_admin() sees everything.
--
-- Idempotent: safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_reports (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id                TEXT         NOT NULL,
  centre_id               TEXT         NOT NULL,
  report_type             TEXT         NOT NULL CHECK (report_type IN (
                                         'sale_active_confirmed',     -- "Confirms what's shown" on on-sale row
                                         'sale_ended',                -- "Sale's ended here"
                                         'discount_different',        -- "Discount is different" + discount_pct
                                         'sale_started',              -- "This shop IS on sale" on not-on-sale row + discount_pct
                                         'no_sale_confirmed'          -- "Confirms no sale" on not-on-sale row
                                       )),
  discount_pct            INT          CHECK (discount_pct IS NULL OR (discount_pct BETWEEN 5 AND 95)),
  reported_state_at_time  JSONB,       -- snapshot of what the app showed when reported (forensics)
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_reports_brand_centre_created_idx
  ON public.user_reports (brand_id, centre_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_reports_created_idx
  ON public.user_reports (created_at DESC);

-- One report per user per brand per centre per day (prevents spam / skew).
CREATE UNIQUE INDEX IF NOT EXISTS user_reports_dedupe_24h_idx
  ON public.user_reports (user_id, brand_id, centre_id, (date_trunc('day', created_at)));

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own reports. The ⋯ button is hidden
-- when logged out; this is the server-side enforcement of that.
DROP POLICY IF EXISTS "users insert own reports" ON public.user_reports;
CREATE POLICY "users insert own reports"
  ON public.user_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can see their own reports (for a future "your contributions" view).
DROP POLICY IF EXISTS "users read own reports" ON public.user_reports;
CREATE POLICY "users read own reports"
  ON public.user_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin (alcottrell@gmail.com — see is_admin()) reads all. Deviation #1:
-- admin.html is an authenticated browser session, not service_role, so the
-- brief's service_role policy alone would never let the admin panel read.
DROP POLICY IF EXISTS "admin reads all reports" ON public.user_reports;
CREATE POLICY "admin reads all reports"
  ON public.user_reports FOR SELECT
  TO authenticated
  USING (is_admin());

-- Service role (e.g. a future server-side admin/proxy) reads all.
DROP POLICY IF EXISTS "service role reads all" ON public.user_reports;
CREATE POLICY "service role reads all"
  ON public.user_reports FOR SELECT
  TO service_role
  USING (true);

GRANT INSERT, SELECT ON public.user_reports TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 24h aggregate for the admin "Users" column + distribution chart + queue sort.
-- security_invoker (deviation #2) so the caller's RLS governs which rows feed
-- the aggregate: admin sees all, regular users only their own.
-- ──────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.user_reports_24h_summary;
CREATE VIEW public.user_reports_24h_summary
  WITH (security_invoker = on) AS
SELECT
  brand_id,
  centre_id,
  COUNT(*) FILTER (WHERE report_type = 'sale_ended')             AS count_ended,
  COUNT(*) FILTER (WHERE report_type = 'sale_started')           AS count_started,
  COUNT(*) FILTER (WHERE report_type = 'sale_active_confirmed')   AS count_confirmed,
  COUNT(*) FILTER (WHERE report_type = 'no_sale_confirmed')       AS count_no_sale_confirmed,
  COUNT(*) FILTER (WHERE report_type = 'discount_different')      AS count_discount_different,
  jsonb_object_agg(
    discount_pct::text,
    discount_count
  ) FILTER (WHERE discount_pct IS NOT NULL)                       AS discount_distribution,
  MAX(created_at)                                                 AS most_recent_at,
  COUNT(*)                                                        AS total_reports
FROM (
  SELECT
    brand_id,
    centre_id,
    report_type,
    discount_pct,
    COUNT(*) OVER (PARTITION BY brand_id, centre_id, discount_pct) AS discount_count,
    created_at
  FROM public.user_reports
  WHERE created_at > NOW() - INTERVAL '24 hours'
) sub
GROUP BY brand_id, centre_id;

GRANT SELECT ON public.user_reports_24h_summary TO authenticated;
