-- Migration: make every brand visible in the admin console, and retire Monki.
--
-- Root cause for "Diesel isn't in the admin panel":
-- admin.html lists a brand only if it has a brand_sale_events row. The scraper
-- UPDATEs that table but never INSERTs, and it skips manualCheck brands
-- entirely (scraper.js), so a manual-check brand only ever gets a row from a
-- migration. Diesel (B102) and its batch siblings B095..B101 are seeded by
-- 20260525b_add_new_brands.sql; if that migration was never applied to this
-- database, none of those eight brands appear in the admin console.
--
-- This repair is generic and idempotent: it (1) re-asserts the May-2026 brand
-- rows, (2) backfills a brand_sale_events row for ANY brand missing one — which
-- fixes Diesel plus any other gap in a single statement — and (3) re-asserts
-- Diesel's centre presence. (4) retires Monki, folded into Weekday by H&M.
-- Idempotent: safe to re-run.

-- (1) Re-assert the May-2026 brand batch (no-op if already present).
INSERT INTO brands (id, name, cluster, womenswear, menswear, childrenswear, sale_url)
VALUES
  ('B095', 'Bershka', 'Contemporary', true, true, false, 'https://www.bershka.com/gb/sale'),
  ('B096', 'JD Sports', 'Active', true, true, true, 'https://www.jdsports.co.uk/sale'),
  ('B097', 'Sports Direct', 'Active', true, true, true, 'https://www.sportsdirect.com/sale'),
  ('B098', 'Footasylum', 'Footwear', true, true, false, 'https://www.footasylum.com/sale'),
  ('B099', 'Urban Outfitters', 'Contemporary', true, true, false, 'https://www.urbanoutfitters.com/en-gb/sale'),
  ('B100', 'Victoria''s Secret', 'Accessories', true, false, false, 'https://www.victoriassecret.co.uk/sale'),
  ('B101', 'Pull&Bear', 'Contemporary', true, true, false, 'https://www.pullandbear.com/gb/sale'),
  ('B102', 'Diesel', 'Premium Casual', true, true, false, 'https://www.diesel.com/en-gb/sale')
ON CONFLICT (id) DO NOTHING;

-- (2) Generic backfill: every brand needs a brand_sale_events row to be
-- listed/editable in the admin console. Fixes Diesel and anything else missing,
-- and self-heals for any future manual-check brand added to brands.js.
INSERT INTO brand_sale_events (brand_id, sale_status, scraper_error)
SELECT b.id, FALSE, FALSE
FROM brands b
WHERE NOT EXISTS (
  SELECT 1 FROM brand_sale_events e WHERE e.brand_id = b.id
);

-- (3) Re-assert Diesel's centre presence (5 handover-verified + Touchwood).
INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B102', true FROM centres c
WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Bluewater', 'Meadowhall', 'Bullring', 'Touchwood')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

-- (4) Retire Monki (B018). H&M Group wound Monki down as a standalone brand
-- through 2024 and folded its range into Weekday (B017), so it is no longer a
-- distinct shop in any centre. brands.js no longer defines it, so admin.html
-- already skips the leftover row; this neutralises any stale sale state and
-- removes any centre presence so it can never count toward a Tide Score.
UPDATE brand_sale_events
SET sale_status = FALSE, scraper_error = FALSE, active_cycle_id = NULL
WHERE brand_id = 'B018';

DELETE FROM centre_brands WHERE brand_id = 'B018';
