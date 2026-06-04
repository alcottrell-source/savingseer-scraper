-- Migration: West Quay (centres.name = 'Westquay') shop-presence update, June 2026.
-- Source list paired brand names with IDs from an external catalogue whose IDs
-- do NOT match this database. Resolved by NAME to the canonical DB brand_id
-- (confirmed against scripts/build-presence-matrix.mjs / brands.js / index.html).
-- Idempotent: safe to re-run.

-- ── Adds (present = true) ───────────────────────────────────────────────
-- New Look (B004), Mango (B013), Hobbs (B027), Tommy Hilfiger (B047),
-- Hugo Boss (B049), Sweaty Betty (B041), Office (B063), Ann Summers (B079).
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES
  ('B004'),  -- New Look
  ('B013'),  -- Mango
  ('B027'),  -- Hobbs
  ('B047'),  -- Tommy Hilfiger
  ('B049'),  -- Hugo Boss
  ('B041'),  -- Sweaty Betty
  ('B063'),  -- Office
  ('B079')   -- Ann Summers
) AS b(brand_id)
WHERE c.name = 'Westquay'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- ── Removes (present = false) ───────────────────────────────────────────
-- River Island (B003), Superdry (B043), Joules (B022), Jack Wills (B044),
-- Reiss (B033), Ted Baker (B034, retired brand — historical row only),
-- French Connection (B084), Regatta (B059), Dune London (B062),
-- Foot Locker (B094), Monsoon (B037), Flying Tiger (B075).
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, false
FROM centres c
CROSS JOIN (VALUES
  ('B003'),  -- River Island
  ('B043'),  -- Superdry
  ('B022'),  -- Joules
  ('B044'),  -- Jack Wills
  ('B033'),  -- Reiss
  ('B034'),  -- Ted Baker (retired)
  ('B084'),  -- French Connection
  ('B059'),  -- Regatta
  ('B062'),  -- Dune London
  ('B094'),  -- Foot Locker
  ('B037'),  -- Monsoon
  ('B075')   -- Flying Tiger
) AS b(brand_id)
WHERE c.name = 'Westquay'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;
