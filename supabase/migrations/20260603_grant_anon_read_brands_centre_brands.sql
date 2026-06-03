-- Migration: public (anon) read on `brands` and `centre_brands`
-- The build-time SEO generator reads which brands exist and which brands are
-- present in which centre. These are non-sensitive reference data (brand names
-- + store locations), so we expose them read-only to the anon role — exactly
-- like the existing anon-read grants on centres / centre_seer_scores /
-- brand_sale_events / brand_sale_cycles (see 20260503_grant_anon_read.sql).
--
-- This lets the generator read with the PUBLIC anon key, so the Vercel build
-- needs no private service key. Admin/scraper writes use the service_role key,
-- which bypasses RLS, so enabling RLS here does not affect them.

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_brands" ON brands;
CREATE POLICY "anon_read_brands" ON brands
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON brands TO anon, authenticated;

ALTER TABLE centre_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_centre_brands" ON centre_brands;
CREATE POLICY "anon_read_centre_brands" ON centre_brands
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON centre_brands TO anon, authenticated;
