-- Migration: Tide Personalisation
-- Tasks 2a, 2c, 2d, and 5 from the Personalisation spec.
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).

-- ──────────────────────────────────────────────────────────────────────────────
-- 2a. Add gender + cluster columns to the brands table
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS womenswear    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS menswear      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS childrenswear BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cluster       TEXT;


-- ──────────────────────────────────────────────────────────────────────────────
-- 2c. user_preferences table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_centre_id  TEXT,
  womenswear           BOOLEAN     NOT NULL DEFAULT false,
  menswear             BOOLEAN     NOT NULL DEFAULT false,
  childrenswear        BOOLEAN     NOT NULL DEFAULT false,
  style_clusters       TEXT[]      NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_prefs"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_prefs"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_prefs"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_prefs_updated_at ON user_preferences;
CREATE TRIGGER trg_user_prefs_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────────────────────────────────────────────────────────────────────
-- 2d. personal_tide_scores table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_tide_scores (
  id                   BIGSERIAL   PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  centre_id            TEXT        NOT NULL,
  score_date           DATE        NOT NULL DEFAULT CURRENT_DATE,
  personal_tide_score  NUMERIC,
  matching_brands      INT,
  matching_on_sale     INT,
  verdict              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, centre_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_personal_scores_user_date
  ON personal_tide_scores (user_id, score_date);

CREATE INDEX IF NOT EXISTS idx_personal_scores_centre_date
  ON personal_tide_scores (centre_id, score_date);

ALTER TABLE personal_tide_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_personal_scores"
  ON personal_tide_scores FOR SELECT
  USING (auth.uid() = user_id);

-- Service role writes scores; no user INSERT/UPDATE policy needed.


-- ──────────────────────────────────────────────────────────────────────────────
-- Task 5. v_personal_scores view
-- Joins today's centre scores with today's personal scores for the calling user.
-- RLS on personal_tide_scores ensures the auth.uid() join only returns their row.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_personal_scores AS
SELECT
  css.centre_id,
  css.score_date,
  css.tide_score            AS centre_score,
  css.verdict               AS centre_verdict,
  css.trajectory,
  css.brands_on_sale,
  css.total_brands,
  pts.personal_tide_score,
  pts.verdict               AS personal_verdict,
  pts.matching_brands,
  pts.matching_on_sale,
  auth.uid()                AS user_id
FROM  centre_seer_scores css
LEFT  JOIN personal_tide_scores pts
  ON  pts.centre_id  = css.centre_id
  AND pts.score_date = css.score_date
  AND pts.user_id    = auth.uid()
WHERE css.score_date = CURRENT_DATE;

-- centre_seer_scores is public data; grant read access so the view can join it
-- under the caller's permissions when security_invoker is set.
GRANT SELECT ON centre_seer_scores TO authenticated;

-- Run the view as the calling user so Postgres RLS on personal_tide_scores
-- provides a second layer of defence (requires PostgreSQL 15+, which Supabase supports).
ALTER VIEW v_personal_scores SET (security_invoker = true);

-- Grant SELECT on the view itself to authenticated users
GRANT SELECT ON v_personal_scores TO authenticated;
