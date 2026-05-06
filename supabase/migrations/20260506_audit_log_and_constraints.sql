-- Migration: audit_log table + data-integrity constraints for brand_sale_events
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Part of the May 2026 robustness audit. Adds:
--
--   1. audit_log table — every scraper and scorer run writes one row here.
--      Service-role write only, no public read. This is the source of truth
--      for the v_system_health observability view (separate migration) and
--      lets an operator confirm in <10 seconds whether the pipeline ran
--      today and what happened if it didn't.
--
--   2. enforce_date_first_detected_immutable() trigger function.
--      Previously *referenced* by 20260504_reset_first_detected.sql but never
--      actually defined in any migration — meaning the column was being
--      protected by a name only, not by code. Defining it here closes that
--      gap: once date_first_detected has been set, it can only be cleared
--      back to NULL (e.g. by reset_brand_sale_cycle), never silently
--      overwritten with a different date. The reset migration also looks for
--      a trigger named 'trg_enforce_date_first_detected_immutable' on the
--      table, so we use that exact name here.
--
--   3. brand_sale_events sale_status NOT NULL.
--      The column has been a nullable BOOLEAN; defending against NULL writes
--      means the scraper's validation gate has a DB-level safety net.
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. audit_log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id                          BIGSERIAL    PRIMARY KEY,
  run_type                    TEXT         NOT NULL CHECK (run_type IN ('scraper','scorer','workflow_failure')),
  run_date                    DATE         NOT NULL DEFAULT CURRENT_DATE,
  run_started_at              TIMESTAMPTZ,
  run_completed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  run_duration_ms             INTEGER,
  status                      TEXT         NOT NULL CHECK (status IN ('success','partial','failed')),
  -- Scraper-specific counters
  brands_attempted            INTEGER,
  brands_succeeded            INTEGER,
  brands_failed               INTEGER,
  brands_on_sale              INTEGER,
  brands_not_on_sale          INTEGER,
  -- Scorer-specific counters
  centres_scored              INTEGER,
  centres_failed              INTEGER,
  personal_scores_calculated  INTEGER,
  personal_scores_failed      INTEGER,
  -- Free-text failure summary (truncated to 4 KB by the writer)
  error_summary               TEXT,
  -- JSON payload for arbitrary extra detail (per-brand failures, etc.)
  details                     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_run_date     ON audit_log(run_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_run_type     ON audit_log(run_type, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_status       ON audit_log(status, run_date DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies — only the service role (which bypasses RLS) can
-- read or write. is_admin() can also see rows because the consolidated RLS
-- migration grants admin SELECT below.
DROP POLICY IF EXISTS "admin_read_audit_log" ON audit_log;
CREATE POLICY "admin_read_audit_log" ON audit_log
  FOR SELECT TO authenticated
  USING (is_admin());

REVOKE ALL ON audit_log FROM anon;
REVOKE ALL ON audit_log FROM authenticated;
GRANT SELECT ON audit_log TO authenticated;  -- gated by RLS to is_admin()


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. enforce_date_first_detected_immutable trigger
--    Once date_first_detected has been set, it must not change to a different
--    non-NULL date. Allowed transitions:
--       NULL  -> any date       (first detection — fine)
--       date  -> NULL           (reset_brand_sale_cycle clears it)
--       date  -> same date      (idempotent re-write)
--    Forbidden:
--       date  -> different date (silent overwrite — would corrupt freshness)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_date_first_detected_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.date_first_detected IS NOT NULL
     AND NEW.date_first_detected IS NOT NULL
     AND OLD.date_first_detected <> NEW.date_first_detected
  THEN
    RAISE EXCEPTION 'date_first_detected is write-once for brand_id=% (existing=%, attempted=%)',
      OLD.brand_id, OLD.date_first_detected, NEW.date_first_detected;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_date_first_detected_immutable ON brand_sale_events;
CREATE TRIGGER trg_enforce_date_first_detected_immutable
  BEFORE UPDATE OF date_first_detected ON brand_sale_events
  FOR EACH ROW EXECUTE FUNCTION enforce_date_first_detected_immutable();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tighten brand_sale_events
--    sale_status was nullable; the application layer never writes NULL but a
--    NOT NULL constraint makes accidental NULL writes loud rather than silent.
--    Apply the constraint only after backfilling any existing NULLs to FALSE.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE brand_sale_events SET sale_status = FALSE WHERE sale_status IS NULL;

DO $$
BEGIN
  ALTER TABLE brand_sale_events ALTER COLUMN sale_status SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not set sale_status NOT NULL: %', SQLERRM;
END $$;
