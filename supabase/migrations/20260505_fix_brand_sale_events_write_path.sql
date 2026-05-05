-- Fix: admin confirmations silently failing when brand_sale_events row is absent
--
-- Root cause: every admin action did UPDATE brand_sale_events WHERE brand_id = X.
-- Supabase returns {error: null} even when 0 rows match, so if a row was missing
-- the write appeared to succeed but nothing changed. The main app then showed grey.
--
-- Two fixes:
--  1. Seed a row for every brand that currently lacks one (covers all existing gaps).
--  2. Grant admins INSERT on brand_sale_events so JS-side upserts can create rows
--     if they are somehow absent in the future.
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Seed missing brand_sale_events rows for ALL brands
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO brand_sale_events (brand_id, sale_status, scraper_error)
SELECT b.id, FALSE, FALSE
FROM brands b
WHERE NOT EXISTS (
  SELECT 1 FROM brand_sale_events e WHERE e.brand_id = b.id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INSERT RLS policy for admins
--    The existing policy only covers UPDATE. Upsert needs INSERT too.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_insert_sale_events" ON brand_sale_events;
CREATE POLICY "admin_insert_sale_events" ON brand_sale_events
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

GRANT INSERT ON brand_sale_events TO authenticated;
