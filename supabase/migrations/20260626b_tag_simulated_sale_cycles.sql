-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: tag simulated sale cycles so they can be binned later
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- RULE (agreed): anything before the last data delete is simulated.
-- The last data delete (20260504_reset_tide_history.sql) ran on 2026-05-04, the
-- same day brand_sale_cycles was created and admin verification began. So a
-- cycle whose start_date is BEFORE 2026-05-04 depicts a sale that predates
-- verification — it is backfilled / simulated, not human-verified.
--
-- This migration only TAGS. It deletes nothing. When real data is deep enough,
-- bin the tagged rows with the one filtered statement at the bottom (it requires
-- the data-reset override + a snapshot, by design).
--
-- It is an UPDATE, so it does not trip the data-reset guards. Idempotent.
--
-- EDGE CASE: a genuinely real sale that started a few days before 2026-05-04 and
-- was verified just after would also be tagged simulated by this date rule. That
-- volume is tiny and you are not binning yet — review the open-cycle list before
-- you ever delete (see the binning block) if you want to spare any.
-- ──────────────────────────────────────────────────────────────────────────────

-- The simulated cutoff. Change here if the "last data delete" date differs.
-- (kept inline rather than a GUC so the migration is self-contained)

-- 1. Marker column. FALSE for everything by default → real unless proven sim.
ALTER TABLE brand_sale_cycles
  ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN brand_sale_cycles.is_simulated IS
  'TRUE = backfilled/demo episode predating verification (start_date < 2026-05-04). '
  'Safe to bin once real data is deep enough. Set by 20260626b migration.';

-- 2. Tag every cycle that depicts a pre-verification sale.
UPDATE brand_sale_cycles
   SET is_simulated = TRUE
 WHERE start_date < DATE '2026-05-04'
   AND is_simulated IS DISTINCT FROM TRUE;

-- Re-tag is harmless on re-run; nothing flips back to FALSE here (a row that is
-- simulated by the date rule stays simulated). If you ever need to clear the
-- flag for a specific row you reviewed and kept, do it by id explicitly.

-- 3. Partial index so "real only" reads (and the eventual bin) are cheap.
CREATE INDEX IF NOT EXISTS idx_cycles_simulated
  ON brand_sale_cycles (is_simulated) WHERE is_simulated;

-- 4. Confirmation (read-only) — the SQL editor shows this final result.
SELECT
  count(*)                                  AS total_cycles,
  count(*) FILTER (WHERE is_simulated)      AS simulated,
  count(*) FILTER (WHERE NOT is_simulated)  AS real_verified,
  min(start_date) FILTER (WHERE NOT is_simulated) AS earliest_real_start,
  max(start_date) FILTER (WHERE is_simulated)     AS latest_simulated_start
FROM brand_sale_cycles;


-- ──────────────────────────────────────────────────────────────────────────────
-- BIN LATER — do NOT run this now. Run it only when real data is deep enough.
-- It is intentionally fenced behind a snapshot + the data-reset override.
-- DATA-RESET-ACK: deliberate, snapshotted removal of simulated demo rows only.
--
--   BEGIN;
--   -- snapshot first (reversible):
--   CREATE TABLE brand_sale_cycles_simbin_20260626 AS
--     SELECT * FROM brand_sale_cycles WHERE is_simulated;
--   -- optional: eyeball any OPEN simulated cycles before deleting
--   --   SELECT * FROM brand_sale_cycles WHERE is_simulated AND end_date IS NULL;
--   SET LOCAL app.allow_data_reset = 'yes-i-really-mean-it';
--   DELETE FROM brand_sale_cycles WHERE is_simulated = TRUE;
--   COMMIT;
--
-- brand_sale_events.active_cycle_id is ON DELETE SET NULL, so any event that
-- pointed at a binned cycle is cleared gracefully rather than erroring.
-- ──────────────────────────────────────────────────────────────────────────────
