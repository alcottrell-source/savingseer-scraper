-- Migration: July 2026 centre audit — main-centres only, corrected store lists.
--
-- 1. Deactivates six secondary/duplicate-coverage centres that only had a
--    handful of tracked stores (The Lexicon, Friars Walk, Queensgate,
--    Broadmead, Touchwood, Bentall Centre). Deactivation (not deletion)
--    preserves history; admin console, score.js and the SEO generator all
--    filter on active = true.
-- 2. Rebuilds centre_brands for the eleven major centres whose May 2026
--    presence audit rows were broken/incomplete (Lakeside had ZERO stores).
--    Presence researched from centre directories / retailer store locators,
--    July 2026. Mirrors the PRESENCE matrix shipped in index.html.
-- 3. Marks Evans (B007) and Coast (B036) absent everywhere — both brands
--    have been online-only since ~2021; their listed stores did not exist.
-- Idempotent: safe to re-run.

UPDATE centres SET active = false WHERE name IN
  ('The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Touchwood',
   'Bentall Centre', 'The Bentall Centre');

UPDATE centre_brands SET present = false WHERE brand_id IN ('B007', 'B036');

-- Reset the eleven rebuilt centres to a clean slate, then upsert the trues.
UPDATE centre_brands SET present = false WHERE centre_id IN
  (SELECT id FROM centres WHERE name IN
    ('Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Eldon Square',
     'Highcross', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn',
     'St James Quarter'));

-- Metrocentre (24 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B013'), ('B019'), ('B033'), ('B043'), ('B061'), ('B064'), ('B070'), ('B071'), ('B073'), ('B076'), ('B078'), ('B079'), ('B092'), ('B094'), ('B096'), ('B097'), ('B099'), ('B100')) AS b(brand_id)
WHERE c.name = 'Metrocentre'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Bluewater (47 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B013'), ('B019'), ('B020'), ('B021'), ('B023'), ('B027'), ('B028'), ('B031'), ('B033'), ('B037'), ('B038'), ('B041'), ('B043'), ('B047'), ('B048'), ('B049'), ('B050'), ('B053'), ('B061'), ('B062'), ('B063'), ('B064'), ('B065'), ('B066'), ('B070'), ('B071'), ('B073'), ('B075'), ('B076'), ('B077'), ('B078'), ('B079'), ('B080'), ('B081'), ('B083'), ('B092'), ('B093'), ('B094'), ('B095'), ('B096'), ('B102')) AS b(brand_id)
WHERE c.name = 'Bluewater'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Lakeside (23 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B013'), ('B043'), ('B050'), ('B061'), ('B063'), ('B064'), ('B066'), ('B070'), ('B071'), ('B073'), ('B076'), ('B079'), ('B080'), ('B092'), ('B094'), ('B096'), ('B097')) AS b(brand_id)
WHERE c.name = 'Lakeside'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- St David's (27 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B013'), ('B019'), ('B033'), ('B038'), ('B043'), ('B049'), ('B061'), ('B064'), ('B065'), ('B066'), ('B070'), ('B071'), ('B073'), ('B075'), ('B076'), ('B077'), ('B078'), ('B092'), ('B095'), ('B096'), ('B100')) AS b(brand_id)
WHERE c.name = 'St David''s'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Eldon Square (13 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B012'), ('B013'), ('B061'), ('B064'), ('B071'), ('B076'), ('B077'), ('B081'), ('B096')) AS b(brand_id)
WHERE c.name = 'Eldon Square'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Highcross (14 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B003'), ('B011'), ('B012'), ('B013'), ('B019'), ('B061'), ('B063'), ('B064'), ('B071'), ('B076'), ('B077'), ('B094'), ('B096')) AS b(brand_id)
WHERE c.name = 'Highcross'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- White Rose (16 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B043'), ('B061'), ('B064'), ('B071'), ('B076'), ('B079'), ('B080'), ('B092'), ('B096'), ('B097')) AS b(brand_id)
WHERE c.name = 'White Rose'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Cribbs Causeway (19 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B012'), ('B019'), ('B021'), ('B028'), ('B043'), ('B061'), ('B063'), ('B064'), ('B071'), ('B073'), ('B076'), ('B077'), ('B078'), ('B079'), ('B096')) AS b(brand_id)
WHERE c.name = 'Cribbs Causeway'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Braehead (11 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B012'), ('B043'), ('B061'), ('B070'), ('B071'), ('B092'), ('B097')) AS b(brand_id)
WHERE c.name = 'Braehead'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- Silverburn (16 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B002'), ('B003'), ('B004'), ('B011'), ('B012'), ('B013'), ('B043'), ('B049'), ('B061'), ('B070'), ('B071'), ('B076'), ('B086'), ('B096'), ('B101')) AS b(brand_id)
WHERE c.name = 'Silverburn'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- St James Quarter (14 tracked stores)
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, b.brand_id, true
FROM centres c
CROSS JOIN (VALUES ('B001'), ('B011'), ('B012'), ('B013'), ('B014'), ('B033'), ('B042'), ('B047'), ('B049'), ('B069'), ('B077'), ('B083'), ('B095'), ('B101')) AS b(brand_id)
WHERE c.name = 'St James Quarter'
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;
