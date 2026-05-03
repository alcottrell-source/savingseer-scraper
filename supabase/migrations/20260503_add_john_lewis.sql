-- Migration: Add John Lewis (B077) to centre_brands for the centres where
-- it's currently trading (best-guess as of May 2026; JL closed 8+ stores in
-- 2020 including Trafford, Bullring, Birmingham, Watford, Sheffield Heelas).
--
-- Run once in the Supabase SQL editor. Adjust centre_id values if your
-- centres table uses a different id format than C01-C30.
--
-- Prerequisite: B077 must exist in the brands table — run seed.js after
-- pulling the brands.js update that adds John Lewis.

INSERT INTO centre_brands (centre_id, brand_id, present) VALUES
  ('C02', 'B077', true),  -- Westquay, Southampton
  ('C03', 'B077', true),  -- Westfield London
  ('C04', 'B077', true),  -- Westfield Stratford
  ('C06', 'B077', true),  -- Metrocentre, Gateshead
  ('C07', 'B077', true),  -- Bluewater
  ('C08', 'B077', true),  -- Meadowhall, Sheffield
  ('C11', 'B077', true),  -- Liverpool ONE
  ('C12', 'B077', true),  -- St David's, Cardiff
  ('C15', 'B077', true),  -- Brent Cross
  ('C17', 'B077', true),  -- Eldon Square, Newcastle
  ('C18', 'B077', true),  -- The Oracle, Reading
  ('C22', 'B077', true),  -- Broadmead, Bristol
  ('C23', 'B077', true),  -- Highcross, Leicester
  ('C24', 'B077', true),  -- Touchwood, Solihull
  ('C25', 'B077', true),  -- Bentall Centre, Kingston
  ('C27', 'B077', true),  -- Cribbs Causeway, Bristol
  ('C30', 'B077', true)   -- St James Quarter, Edinburgh
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;
