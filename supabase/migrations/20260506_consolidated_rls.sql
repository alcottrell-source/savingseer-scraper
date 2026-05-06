-- Migration: consolidated Row Level Security policies (May 2026 audit)
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Single source of truth for the RLS posture across every Tide table. Earlier
-- migrations (20260502_add_personalisation, 20260503_grant_anon_read,
-- 20260504_add_admin_console_and_cycles) layered policies in piecemeal — this
-- migration restates the full set so it can be reviewed in one file and
-- re-applied if the database is rebuilt. All statements are idempotent.
--
-- Roles in play:
--   anon          — anonymous public web visitors (homepage, dashboard)
--   authenticated — logged-in users (Supabase auth.users row)
--   service_role  — backend pipelines (scraper.js, score.js); bypasses RLS,
--                   so policies below describe what anon/authenticated can do.
--
-- The intended posture per table:
--
--   brand_sale_events     anon: read | auth: read | admin: update | sb only: write
--   brand_sale_cycles     anon: read | auth: read | admin: write
--   centre_seer_scores    anon: read | auth: read | sb only: write
--   centres               anon: read | auth: read | sb only: write
--   centre_brands         anon: read | auth: read | sb only: write
--   brands                anon: read | auth: read | sb only: write
--   user_preferences      owner read+write only (auth.uid() = user_id)
--   personal_tide_scores  owner: read | sb only: write
--   community_signals     anyone: insert | admin: read/update/delete
--   admin_review_log      admin: full
--   audit_log             admin: read | sb only: write
--
-- "sb only: write" means writes happen via the service-role key from the
-- Node pipelines and there is no INSERT/UPDATE/DELETE policy for either anon
-- or authenticated. The service role bypasses RLS, so it doesn't need a
-- policy to write. Anything *not* listed for a role is implicitly denied.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper guard — every table below assumes RLS is enabled.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_sale_events
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_brand_sale_events"  ON brand_sale_events;
CREATE POLICY "anon_read_brand_sale_events"
  ON brand_sale_events FOR SELECT
  TO anon, authenticated USING (true);

-- Admin (signed-in alcottrell@gmail.com) can update verified-state columns
-- via the admin console. is_admin() is defined in 20260504_add_admin_console.
DROP POLICY IF EXISTS "admin_update_sale_events"     ON brand_sale_events;
CREATE POLICY "admin_update_sale_events"
  ON brand_sale_events FOR UPDATE
  TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- No INSERT or DELETE policy for anon/authenticated — only service role.
GRANT SELECT ON brand_sale_events TO anon, authenticated;
GRANT UPDATE ON brand_sale_events TO authenticated;  -- gated by is_admin()
REVOKE INSERT, DELETE ON brand_sale_events FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- brand_sale_cycles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_cycles"   ON brand_sale_cycles;
CREATE POLICY "anon_read_cycles"
  ON brand_sale_cycles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "admin_write_cycles" ON brand_sale_cycles;
CREATE POLICY "admin_write_cycles"
  ON brand_sale_cycles FOR ALL
  TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT ON brand_sale_cycles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON brand_sale_cycles TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- centre_seer_scores
--   Public read; only score.js (service role) writes.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE centre_seer_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centre_seer_scores" ON centre_seer_scores;
CREATE POLICY "anon_read_centre_seer_scores"
  ON centre_seer_scores FOR SELECT
  TO anon, authenticated USING (true);

GRANT SELECT ON centre_seer_scores TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON centre_seer_scores FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- centres
--   Public read; service-role writes only (tide_history is rebuilt by score.js).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centres" ON centres;
CREATE POLICY "anon_read_centres"
  ON centres FOR SELECT
  TO anon, authenticated USING (true);

GRANT SELECT ON centres TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON centres FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- centre_brands
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE centre_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centre_brands" ON centre_brands;
CREATE POLICY "anon_read_centre_brands"
  ON centre_brands FOR SELECT
  TO anon, authenticated USING (true);

GRANT SELECT ON centre_brands TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON centre_brands FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- brands
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_brands" ON brands;
CREATE POLICY "anon_read_brands"
  ON brands FOR SELECT
  TO anon, authenticated USING (true);

GRANT SELECT ON brands TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON brands FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- user_preferences
--   Owner-only read AND write (auth.uid() = user_id).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_prefs" ON user_preferences;
CREATE POLICY "users_select_own_prefs"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_prefs" ON user_preferences;
CREATE POLICY "users_insert_own_prefs"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_update_own_prefs" ON user_preferences;
CREATE POLICY "users_update_own_prefs"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_delete_own_prefs" ON user_preferences;
CREATE POLICY "users_delete_own_prefs"
  ON user_preferences FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON user_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- personal_tide_scores
--   Owner-only read; service-role writes only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE personal_tide_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_personal_scores" ON personal_tide_scores;
CREATE POLICY "users_select_own_personal_scores"
  ON personal_tide_scores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON personal_tide_scores FROM anon;
GRANT SELECT ON personal_tide_scores TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON personal_tide_scores FROM authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- community_signals
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE community_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_insert_signals"   ON community_signals;
CREATE POLICY "anyone_insert_signals"
  ON community_signals FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "admin_read_signals"      ON community_signals;
CREATE POLICY "admin_read_signals"
  ON community_signals FOR SELECT
  TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_modify_signals"    ON community_signals;
CREATE POLICY "admin_modify_signals"
  ON community_signals FOR UPDATE
  TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_signals"    ON community_signals;
CREATE POLICY "admin_delete_signals"
  ON community_signals FOR DELETE
  TO authenticated USING (is_admin());

GRANT INSERT ON community_signals TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON community_signals TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- admin_review_log
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE admin_review_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_review_log" ON admin_review_log;
CREATE POLICY "admin_all_review_log"
  ON admin_review_log FOR ALL
  TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

REVOKE ALL ON admin_review_log FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_review_log TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log
--   Created in 20260506_audit_log_and_constraints; restated here for the
--   single-file overview.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_log" ON audit_log;
CREATE POLICY "admin_read_audit_log"
  ON audit_log FOR SELECT
  TO authenticated USING (is_admin());

REVOKE ALL ON audit_log FROM anon, authenticated;
GRANT SELECT ON audit_log TO authenticated;  -- gated by is_admin()
