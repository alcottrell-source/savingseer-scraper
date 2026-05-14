-- Migration: explicit GRANTs on Data-API-exposed tables
--
-- Why: Supabase is changing the default behaviour of the Data API.
-- From 30 May 2026 (new projects) and 30 October 2026 (all existing
-- projects), tables created in the `public` schema will NOT be exposed to
-- PostgREST / supabase-js / GraphQL unless an explicit GRANT is in place.
-- Existing tables keep whatever grants they already have, so this project's
-- production database is unaffected. But the migration suite itself was
-- relying on the old default for two tables — if we ever re-provision a
-- fresh Supabase project from these migrations (staging, recovery, dev),
-- those tables would be invisible to the front-end without these grants.
--
-- All other public tables already have explicit GRANTs in earlier
-- migrations:
--   centres, centre_seer_scores, brand_sale_events
--                                       → 20260503_grant_anon_read.sql
--   brand_sale_cycles, community_signals, admin_review_log,
--   brand_sale_events (UPDATE)          → 20260504_add_admin_console_and_cycles.sql
--   centre_brand_floors                 → 20260509_add_floors.sql
--   v_personal_scores                   → 20260502_add_personalisation.sql
--
-- Going forward: every new migration that creates a public table MUST
-- include an explicit GRANT for the roles that need to reach it via the
-- Data API (anon for public reads, authenticated for per-user reads/writes).
-- RLS policies are not a substitute — the role still needs a base GRANT
-- before RLS is even evaluated.
--
-- Idempotent: GRANT is idempotent in Postgres; safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- user_preferences
--   Read/write by authenticated users; rows are confined to auth.uid() by RLS
--   policies defined in 20260502_add_personalisation.sql.
-- ──────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- personal_tide_scores
--   Read by authenticated users (RLS confines them to their own user_id).
--   Writes happen via service_role from score.js, which bypasses both RLS
--   and the Data API restriction — no GRANT needed for writes.
-- ──────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON personal_tide_scores TO authenticated;
