-- ──────────────────────────────────────────────────────────────────────────────
-- Enforce at most one OPEN sale cycle per brand.
--
-- The admin console's confirm_start unconditionally INSERTs an open
-- (end_date IS NULL) cycle. Nothing prevented a double-click / two tabs /
-- an orphaned-cycle race from creating two open cycles for one brand, which
-- the episode sheet then renders as two overlapping "live" episodes and
-- confirm_end only closes the newest of.
--
-- This replaces the non-unique idx_cycles_brand_open (20260504:38) with a
-- UNIQUE partial index so the DB rejects a second open cycle. The client is
-- also guarded (confirm_start refuses when an open cycle already exists), but
-- the index is the real backstop.
--
-- NOTE: if any brand currently has >1 open cycle this CREATE will fail —
-- that is intentional (it surfaces the pre-existing inconsistency). Close the
-- duplicate(s) first, then re-run.
-- ──────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_cycles_brand_open;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cycles_brand_open
  ON brand_sale_cycles(brand_id)
  WHERE end_date IS NULL;
