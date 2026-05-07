-- Migration: relax centre_seer_scores.trajectory CHECK constraint
--
-- score.js can emit three trajectory values: RISING, FLAT, FALLING (see
-- getTrajectory() in score.js). The original check constraint was created
-- directly in the Supabase dashboard before FALLING was first produced
-- in the wild, and only allowed RISING and FLAT. As soon as a real
-- centre's score declined past the FLAT band, the daily score upsert
-- started failing with:
--
--   new row for relation "centre_seer_scores" violates check
--   constraint "centre_seer_scores_trajectory_check"
--
-- Drop the existing constraint (if present, under either of the names it
-- might have been created with) and recreate it with the full allowed
-- set, plus NULL for centres that have no row written yet.
--
-- Idempotent: safe to re-run.

ALTER TABLE centre_seer_scores
  DROP CONSTRAINT IF EXISTS centre_seer_scores_trajectory_check;

ALTER TABLE centre_seer_scores
  ADD CONSTRAINT centre_seer_scores_trajectory_check
  CHECK (trajectory IS NULL OR trajectory IN ('RISING', 'FLAT', 'FALLING'));
