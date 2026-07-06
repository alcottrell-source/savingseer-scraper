-- Migration: sale description field + "Sale increased" admin action
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Idempotent: safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. brand_sale_cycles.description — free-text, customer-facing summary of the
--    sale (e.g. "Extra 20% off end-of-season lines"). Distinct from the
--    existing `notes` column, which is admin-internal and unread by the
--    front-end. Read by index.html and shown on the shop detail sheet.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_cycles
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. admin_review_log.action — add 'increased' for the admin console's new
--    "Sale increased" button (moves a live cycle's discount % up, distinct
--    from the general-purpose 'edited' verb). Also adds 'deleted', which
--    admin.html's deleteCycle() has logged since the cycle editor shipped but
--    was never added to this CHECK constraint — that call has been failing
--    silently under RLS/CHECK enforcement; fixed here alongside the new verb.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE admin_review_log DROP CONSTRAINT IF EXISTS admin_review_log_action_check;
ALTER TABLE admin_review_log ADD CONSTRAINT admin_review_log_action_check
  CHECK (action IN ('confirmed_on','confirmed_off','confirmed_start','confirmed_end','dismissed','edited','deleted','increased'));
