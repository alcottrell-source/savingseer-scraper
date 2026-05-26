-- Migration: insert new brand rows + their centre_brands presence.
-- Run AFTER 20260525_rebuild_centre_brands.sql.
-- Idempotent: safe to re-run.

INSERT INTO brands (id, name, cluster, womenswear, menswear, childrenswear, sale_url)
VALUES
  ('B095', 'Bershka', 'Contemporary', true, true, false, 'https://www.bershka.com/gb/sale'),
  ('B096', 'JD Sports', 'Active', true, true, true, 'https://www.jdsports.co.uk/sale'),
  ('B097', 'Sports Direct', 'Active', true, true, true, 'https://www.sportsdirect.com/sale'),
  ('B098', 'Footasylum', 'Footwear', true, true, false, 'https://www.footasylum.com/sale'),
  ('B099', 'Urban Outfitters', 'Contemporary', true, true, false, 'https://www.urbanoutfitters.com/en-gb/sale'),
  ('B100', 'Victoria''s Secret', 'Accessories', true, false, false, 'https://www.victoriassecret.co.uk/sale'),
  ('B101', 'Pull&Bear', 'Contemporary', true, true, false, 'https://www.pullandbear.com/gb/sale')
ON CONFLICT (id) DO NOTHING;

INSERT INTO brand_sale_events (brand_id, sale_status, scraper_error)
SELECT b.id, FALSE, FALSE
FROM brands b
WHERE b.id IN ('B095','B096','B097','B098','B099','B100','B101')
AND NOT EXISTS (
  SELECT 1 FROM brand_sale_events e WHERE e.brand_id = b.id
);

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B095', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bluewater', 'Meadowhall', 'Liverpool ONE', 'St David''s', 'Cabot Circus')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B096', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B097', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Metrocentre', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B098', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B099', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B100', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B101', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Cabot Circus')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;
