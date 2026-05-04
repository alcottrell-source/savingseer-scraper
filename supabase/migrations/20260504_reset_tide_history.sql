-- 20260504_reset_tide_history.sql
-- Reset tide history to a clean baseline. The pre-existing rows in
-- centre_seer_scores were computed against the noisy old detector logic
-- (since fixed in scraper.js), so trajectory and chart shape have been
-- comparing today's accurate scores against historically inflated ones.
--
-- This migration:
--   1. Snapshots current state into archive tables (reversible)
--   2. Deletes centre_seer_scores rows from before today
--   3. Truncates each centres.tide_history to just today's verified entry
--      (or empty if score.js hasn't run yet for today)
--
-- After this:
--   - The chart on each centre is sparse from today onward
--   - score.js's nightly history rebuild only finds today + later rows
--   - Trajectory comparisons become meaningful within ~3-7 days
--
-- Reversal (if ever needed):
--   DELETE FROM centre_seer_scores;
--   INSERT INTO centre_seer_scores SELECT * FROM centre_seer_scores_archive_20260504;
--   UPDATE centres c SET tide_history = a.tide_history
--     FROM centres_tide_history_archive_20260504 a WHERE c.id = a.id;

-- 1. Snapshot — full audit copy of pre-reset state
CREATE TABLE IF NOT EXISTS centre_seer_scores_archive_20260504 AS
  SELECT * FROM centre_seer_scores;

CREATE TABLE IF NOT EXISTS centres_tide_history_archive_20260504 AS
  SELECT id, name, tide_history FROM centres;

-- 2. Drop pre-today scores
DELETE FROM centre_seer_scores WHERE score_date < CURRENT_DATE;

-- 3. Truncate each centre's tide_history to today's seed (or empty)
UPDATE centres c
SET tide_history = COALESCE(
  (
    SELECT jsonb_build_array(
      jsonb_build_object(
        'date', s.score_date::text,
        'score', s.tide_score
      )
    )
    FROM centre_seer_scores s
    WHERE s.centre_id = c.id
      AND s.score_date = CURRENT_DATE
  ),
  '[]'::jsonb
);
