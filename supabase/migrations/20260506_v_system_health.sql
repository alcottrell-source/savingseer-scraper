-- Migration: v_system_health observability view
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- A single SELECT that answers "is the Tide pipeline healthy?" in 10 seconds.
-- Designed to be eyeballed by an admin in the Supabase SQL editor or
-- queried by a future status page. Returns exactly one row.
--
-- The view is restricted to admins (and the service role, which always
-- bypasses RLS): the underlying audit_log table is admin-read-only, and we
-- mark the view security_invoker so its caller's privileges apply.

CREATE OR REPLACE VIEW v_system_health AS
WITH
  last_scraper AS (
    SELECT *
    FROM audit_log
    WHERE run_type = 'scraper'
    ORDER BY run_completed_at DESC
    LIMIT 1
  ),
  last_scorer AS (
    SELECT *
    FROM audit_log
    WHERE run_type = 'scorer'
    ORDER BY run_completed_at DESC
    LIMIT 1
  ),
  yesterday_scraper AS (
    -- Most recent scraper run dated yesterday (UTC). If no run yesterday,
    -- the columns come back NULL — that itself is the alarm signal.
    SELECT *
    FROM audit_log
    WHERE run_type = 'scraper'
      AND run_date = (CURRENT_DATE - INTERVAL '1 day')::date
    ORDER BY run_completed_at DESC
    LIMIT 1
  ),
  yesterday_scorer AS (
    SELECT *
    FROM audit_log
    WHERE run_type = 'scorer'
      AND run_date = (CURRENT_DATE - INTERVAL '1 day')::date
    ORDER BY run_completed_at DESC
    LIMIT 1
  ),
  failures_7d AS (
    -- Workflow failures (GitHub Actions) and any partial/failed runs in the
    -- last 7 days. Useful for "anything weird happened recently?"
    SELECT
      COUNT(*) FILTER (WHERE run_type = 'workflow_failure')                                                AS workflow_failures_7d,
      COUNT(*) FILTER (WHERE status = 'failed'  AND run_type IN ('scraper','scorer'))                       AS pipeline_failures_7d,
      COUNT(*) FILTER (WHERE status = 'partial' AND run_type IN ('scraper','scorer'))                       AS pipeline_partials_7d
    FROM audit_log
    WHERE run_completed_at >= NOW() - INTERVAL '7 days'
  )
SELECT
  -- Scraper health
  ls.run_date              AS last_scraper_run_date,
  ls.run_completed_at      AS last_scraper_run_at,
  ls.status                AS last_scraper_status,
  ys.brands_attempted      AS brands_scraped_yesterday,
  ys.brands_succeeded      AS brands_succeeded_yesterday,
  ys.brands_failed         AS brands_failed_yesterday,
  ys.brands_on_sale        AS brands_on_sale_yesterday,
  -- Scorer health
  lc.run_date              AS last_scorer_run_date,
  lc.run_completed_at      AS last_scorer_run_at,
  lc.status                AS last_scorer_status,
  yc.centres_scored        AS centres_scored_yesterday,
  yc.centres_failed        AS centres_failed_yesterday,
  yc.personal_scores_calculated AS personal_scores_calculated_yesterday,
  -- Recent error counts
  f.workflow_failures_7d,
  f.pipeline_failures_7d,
  f.pipeline_partials_7d,
  -- Stale-data flags — the most useful summary signals
  (ls.run_date IS NULL OR ls.run_date < CURRENT_DATE) AS scraper_stale_today,
  (lc.run_date IS NULL OR lc.run_date < CURRENT_DATE) AS scorer_stale_today,
  NOW() AS observed_at
FROM         failures_7d f
LEFT JOIN    last_scraper       ls ON TRUE
LEFT JOIN    last_scorer        lc ON TRUE
LEFT JOIN    yesterday_scraper  ys ON TRUE
LEFT JOIN    yesterday_scorer   yc ON TRUE;

-- Run as the calling user so the audit_log RLS policy is enforced — this means
-- only admins (is_admin() = true) and the service role can see the data.
ALTER VIEW v_system_health SET (security_invoker = true);

REVOKE ALL ON v_system_health FROM anon;
GRANT SELECT ON v_system_health TO authenticated;  -- gated by audit_log RLS
