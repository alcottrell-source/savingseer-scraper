-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: DATA-RESET GUARD — stop anyone (human or script) wiping real data
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- WHY THIS EXISTS
-- The verified sale history in this database is the product's core asset and is
-- NOT regenerable — once the scraper was removed (Jun 2026), every sale cycle,
-- discount %, and verified on/off state came from a human confirming it in the
-- admin console. We have simulated/seed data mixed in, but anything that was
-- actually entered must survive. The repo's own history shows the danger: past
-- migrations did `DELETE FROM centre_seer_scores` and `UPDATE centres SET
-- tide_history = '[]'` to "reset to a clean baseline". This guard makes that
-- class of operation impossible to do by accident — by us or by a future script.
--
-- WHAT IT BLOCKS (on the protected tables below)
--   • TRUNCATE                          — always
--   • bulk DELETE (> 5 rows in one stmt)— removing a single mis-entered row is
--                                          still fine; wiping the table is not
--   • wiping centres.tide_history to empty (the exact reset vector used before)
--
-- WHAT IT DOES NOT TOUCH
--   • Normal pipeline writes — score.js only UPSERTs and rebuilds tide_history
--     with a full (non-empty) array, so it is never blocked.
--   • Single-row admin corrections (delete one bad cycle, etc.).
--   • Account deletion — user_reports cascade-deletes are row DELETEs, not
--     TRUNCATEs, and user_reports is not under the bulk-DELETE guard.
--
-- HOW TO OVERRIDE (when you REALLY mean to clear data — e.g. dropping simulated
-- rows on purpose). In the SAME transaction, before the destructive statement:
--
--     BEGIN;
--     SET LOCAL app.allow_data_reset = 'yes-i-really-mean-it';
--     -- ... your DELETE / TRUNCATE / tide_history wipe ...
--     COMMIT;
--
-- SET LOCAL means the permission evaporates at COMMIT — it can never leak into a
-- later statement or another session. Always snapshot the table first
-- (CREATE TABLE x_archive_YYYYMMDD AS SELECT * FROM x;).
--
-- Idempotent: safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────────

-- The override switch. A custom GUC (namespaced, so Postgres accepts it without
-- predeclaration). Unset by default; current_setting(..., true) returns NULL
-- when it has never been set, which the guard treats as "not allowed".
-- Value that unlocks a reset:  'yes-i-really-mean-it'

-- ── 1. Bulk-DELETE guard ──────────────────────────────────────────────────────
-- AFTER ... FOR EACH STATEMENT with a transition table so we can count exactly
-- how many rows the statement removed. Raising here rolls the whole statement
-- back, so nothing is actually deleted.
CREATE OR REPLACE FUNCTION _guard_block_bulk_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n         BIGINT;
  max_rows  CONSTANT INT := 5;   -- a hand correction is fine; a wipe is not
BEGIN
  IF current_setting('app.allow_data_reset', true) = 'yes-i-really-mean-it' THEN
    RETURN NULL;  -- deliberate, scoped override — allow it
  END IF;

  SELECT count(*) INTO n FROM _guard_deleted_rows;
  IF n > max_rows THEN
    RAISE EXCEPTION
      E'BLOCKED: refusing to DELETE % rows from "%" — this is protected, human-verified Tide data.\n'
       'Deleting up to % rows (a hand correction) is allowed; wiping the table is not.',
      n, TG_TABLE_NAME, max_rows
      USING
        HINT = 'If you REALLY mean it: in the same transaction run  '
               'SET LOCAL app.allow_data_reset = ''yes-i-really-mean-it'';  '
               'first, and snapshot the table before you do.',
        ERRCODE = 'raise_exception';
  END IF;
  RETURN NULL;
END;
$$;

-- ── 2. TRUNCATE guard ─────────────────────────────────────────────────────────
-- TRUNCATE can't carry a transition table; a BEFORE trigger that always refuses
-- (absent the override) is the whole job.
CREATE OR REPLACE FUNCTION _guard_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_data_reset', true) = 'yes-i-really-mean-it' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION
    'BLOCKED: refusing to TRUNCATE "%" — this is protected, human-verified Tide data.',
    TG_TABLE_NAME
    USING
      HINT = 'If you REALLY mean it: in the same transaction run  '
             'SET LOCAL app.allow_data_reset = ''yes-i-really-mean-it'';  '
             'first, and snapshot the table before you do.',
      ERRCODE = 'raise_exception';
END;
$$;

-- ── 3. tide_history wipe guard ────────────────────────────────────────────────
-- Row-level BEFORE UPDATE OF tide_history on centres. The previous reset set
-- tide_history to '[]'. score.js always writes a full, growing history array, so
-- "had real history, now being set to empty" uniquely identifies a wipe.
CREATE OR REPLACE FUNCTION _guard_block_tide_history_wipe()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_len INT := jsonb_array_length(COALESCE(OLD.tide_history, '[]'::jsonb));
  new_len INT := jsonb_array_length(COALESCE(NEW.tide_history, '[]'::jsonb));
BEGIN
  IF current_setting('app.allow_data_reset', true) = 'yes-i-really-mean-it' THEN
    RETURN NEW;
  END IF;
  -- Going from "has real history" (>1 point) to empty/single is a wipe.
  IF old_len > 1 AND new_len <= 1 THEN
    RAISE EXCEPTION
      'BLOCKED: refusing to wipe tide_history for centre "%" (% points -> %).',
      OLD.name, old_len, new_len
      USING
        HINT = 'tide_history is the chart series. If you REALLY mean it: in the '
               'same transaction run  SET LOCAL app.allow_data_reset = '
               '''yes-i-really-mean-it'';  first.',
        ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Attach the triggers ────────────────────────────────────────────────────
-- Strong guard (TRUNCATE + bulk DELETE): the irreplaceable, verified history.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['brand_sale_cycles', 'brand_sale_events', 'centre_seer_scores']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_guard_delete ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_guard_delete AFTER DELETE ON %I '
      'REFERENCING OLD TABLE AS _guard_deleted_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION _guard_block_bulk_delete()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS zzz_guard_truncate ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_guard_truncate BEFORE TRUNCATE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION _guard_block_truncate()', t);
  END LOOP;

  -- TRUNCATE-only guard: tables where row DELETEs are legitimate (account
  -- deletion cascades into user_reports; admins may prune signals) but a
  -- whole-table wipe never is. Also covers the config tables that define the
  -- universe every other table hangs off.
  FOREACH t IN ARRAY ARRAY['user_reports', 'community_signals', 'centres', 'brands']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_guard_truncate ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_guard_truncate BEFORE TRUNCATE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION _guard_block_truncate()', t);
  END LOOP;
END $$;

-- tide_history wipe guard on centres.
DROP TRIGGER IF EXISTS zzz_guard_tide_history ON centres;
CREATE TRIGGER zzz_guard_tide_history
  BEFORE UPDATE OF tide_history ON centres
  FOR EACH ROW EXECUTE FUNCTION _guard_block_tide_history_wipe();

-- ── 5. Smoke check (optional, read-only) ──────────────────────────────────────
-- After running this migration you can confirm the guard is live without
-- touching data:
--   SELECT tgname, tgrelid::regclass AS table
--   FROM pg_trigger WHERE tgname LIKE 'zzz_guard%' ORDER BY 2, 1;
