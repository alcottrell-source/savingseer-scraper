-- Migration: prior_discount_pct on brand_sale_cycles
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Idempotent: safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- brand_sale_cycles.prior_discount_pct — the discount % a cycle had immediately
-- before an admin bumped it via Edit/Increase/re-confirm. Public-readable (no
-- RLS/GRANT changes needed — anon_read_cycles and the table-level GRANT SELECT
-- from 20260504_add_admin_console_and_cycles.sql already cover every column on
-- this table). Lets index.html's "Just got deeper" panel say "Was 50%, now up
-- to 70%" instead of just the new %; previously that before-value only ever
-- existed in admin_review_log.notes, which is admin-only via RLS.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_cycles
  ADD COLUMN IF NOT EXISTS prior_discount_pct INT;
