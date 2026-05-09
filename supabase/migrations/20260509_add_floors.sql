-- Migration: per-(centre, brand) floor information for the centre detail view.
--
-- Adds two things:
--   1. centres.directory_url — the official centre directory page we scrape
--      to build floor data. Acts as a pilot gate: only centres with this
--      column populated are processed by extract-floors.js.
--   2. centre_brand_floors — one row per (centre, brand, floor_label).
--      Composite PK supports a brand occupying two floors (e.g. an anchor
--      tenant spanning Ground + Upper) via two rows.
--
-- The daily pipeline (scraper.js / score.js / summarise.js) does NOT read or
-- write either of these — floor data is refreshed on demand via
-- `node extract-floors.js --centre <id>`.
--
-- Idempotent: safe to re-run.

ALTER TABLE centres
  ADD COLUMN IF NOT EXISTS directory_url TEXT;

CREATE TABLE IF NOT EXISTS centre_brand_floors (
  centre_id    TEXT        NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  brand_id     TEXT        NOT NULL,
  floor_label  TEXT        NOT NULL,                 -- raw label, e.g. "Upper Mall"
  floor_order  INT         NOT NULL DEFAULT 0,       -- -1 lower, 0 ground, 1 first, 2 second
  unit_code    TEXT,
  source_url   TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (centre_id, brand_id, floor_label)
);

CREATE INDEX IF NOT EXISTS centre_brand_floors_centre_idx
  ON centre_brand_floors(centre_id);

ALTER TABLE centre_brand_floors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_centre_brand_floors" ON centre_brand_floors;
CREATE POLICY "anon_read_centre_brand_floors"
  ON centre_brand_floors FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON centre_brand_floors TO anon;
GRANT SELECT ON centre_brand_floors TO authenticated;
