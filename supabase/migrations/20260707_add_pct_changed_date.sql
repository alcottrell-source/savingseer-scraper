-- Migration: track when a cycle's discount % last changed, distinct from
-- when the sale itself started.
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Idempotent: safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- brand_sale_cycles.pct_changed_date — the date max_discount_pct was last set.
-- Backfilled to start_date so every existing cycle has a value (a cycle
-- that's never had its % edited "changed" on the day it started). admin.html
-- bumps this to today whenever an Edit/Increase/re-confirm actually moves the
-- %, so "Newest Sales" on the public site can surface a sale whose discount
-- just got deeper even though the sale itself started long ago.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_cycles
  ADD COLUMN IF NOT EXISTS pct_changed_date DATE;

UPDATE brand_sale_cycles
  SET pct_changed_date = start_date
  WHERE pct_changed_date IS NULL;
