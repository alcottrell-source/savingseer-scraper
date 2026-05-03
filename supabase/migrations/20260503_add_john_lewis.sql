-- Migration: Add John Lewis (B077) to centre_brands for the centres where
-- it's currently trading (best-guess as of May 2026; JL closed 8+ stores in
-- 2020 including Trafford, Bullring, Birmingham, Watford, Sheffield Heelas).
--
-- Run once in the Supabase SQL editor. Looks up centres by name so we don't
-- need to know the exact slug-style id of each row in the centres table.
--
-- Prerequisite: B077 must exist in the brands table — run seed.js after
-- pulling the brands.js update that adds John Lewis.

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B077', true
FROM centres c
WHERE c.name IN (
  'Westquay',
  'Westfield London',
  'Westfield Stratford',
  'Metrocentre',
  'Bluewater',
  'Meadowhall',
  'Liverpool ONE',
  'St David''s',
  'Brent Cross',
  'Eldon Square',
  'The Oracle',
  'Broadmead',
  'Highcross',
  'Touchwood',
  'Bentall Centre',
  'The Bentall Centre',
  'Cribbs Causeway',
  'St James Quarter'
)
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Verify: should return up to 17 rows.
SELECT cb.centre_id, c.name
FROM centre_brands cb
JOIN centres c ON c.id = cb.centre_id
WHERE cb.brand_id = 'B077'
ORDER BY c.name;
