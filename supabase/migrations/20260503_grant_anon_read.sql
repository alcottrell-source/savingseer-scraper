-- Migration: Grant anonymous read access for the public Tide dashboard
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Context: the dashboard currently reads its data from a public Google Sheets
-- CSV. To switch the source of truth to Supabase (Stage 2 of N3), the anon
-- role needs SELECT access on three tables:
--   - centre_seer_scores  (per-centre, per-day Tide Score, verdict, BLUF)
--   - centres             (centre id/name/tide_history sparkline data)
--   - brand_sale_events   (per-brand sale status + date_first_detected)
--
-- All three contain data that is already publicly visible via the Sheets CSV,
-- so granting anon read does not expose anything new.
--
-- This migration is idempotent: safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- centre_seer_scores
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE centre_seer_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centre_seer_scores" ON centre_seer_scores;
CREATE POLICY "anon_read_centre_seer_scores"
  ON centre_seer_scores FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON centre_seer_scores TO anon;
GRANT SELECT ON centre_seer_scores TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- centres
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centres" ON centres;
CREATE POLICY "anon_read_centres"
  ON centres FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON centres TO anon;
GRANT SELECT ON centres TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- brand_sale_events
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_brand_sale_events" ON brand_sale_events;
CREATE POLICY "anon_read_brand_sale_events"
  ON brand_sale_events FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON brand_sale_events TO anon;
GRANT SELECT ON brand_sale_events TO authenticated;
