-- Migration: enforce one OPEN brand_sale_cycle per brand
--
-- Backstop for the duplicate brand-sale-alert bug (surfaced as Hugo Boss
-- emailing every morning). admin.html's confirm_start used to INSERT a fresh
-- brand_sale_cycles row on every re-confirmation — including the crowd-report
-- "Confirm on sale" nudge — leaving multiple OPEN cycles (end_date IS NULL)
-- per brand and resetting the sale's effective start_date to "today" each
-- time. notify-high-tide's `startedToday` reads the active cycle's start_date
-- as its send-once key, so a reset start_date re-fired the one-shot
-- "X just went on sale" email day after day.
--
-- The application fix makes confirm_start reuse the open cycle. This migration
-- enforces the same invariant in the database so it can't recur, and so the
-- notify dedup always reads a single, stable open cycle per brand.
--
-- A unique partial index cannot be created while duplicate open cycles exist,
-- so we first collapse them: keep the EARLIEST-starting open cycle per brand
-- (the truest sale origin), end-date the later duplicates, and repoint any
-- brand_sale_events.active_cycle_id that pointed at a now-closed duplicate to
-- the surviving cycle. Duplicates are closed (end_date = their own start_date),
-- not deleted, so nothing referencing them is lost.

BEGIN;

-- 1. Close every open cycle except the earliest-starting one per brand.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY brand_id ORDER BY start_date ASC, id ASC
         ) AS rn
  FROM brand_sale_cycles
  WHERE end_date IS NULL
)
UPDATE brand_sale_cycles c
SET end_date = COALESCE(c.start_date, CURRENT_DATE)
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2. Repoint events whose active_cycle_id was just closed to the survivor
--    (the one remaining open cycle for that brand).
UPDATE brand_sale_events e
SET active_cycle_id = open_c.id
FROM brand_sale_cycles open_c
WHERE open_c.brand_id = e.brand_id
  AND open_c.end_date IS NULL
  AND e.active_cycle_id IS DISTINCT FROM open_c.id
  AND (
    e.active_cycle_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM brand_sale_cycles cur
      WHERE cur.id = e.active_cycle_id AND cur.end_date IS NULL
    )
  )
  AND e.last_verified_status IS TRUE;

-- 3. Enforce one open cycle per brand going forward. Replaces the old
--    non-unique idx_cycles_brand_open (same predicate, now unique).
DROP INDEX IF EXISTS idx_cycles_brand_open;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cycles_brand_open
  ON brand_sale_cycles (brand_id)
  WHERE end_date IS NULL;

COMMIT;
