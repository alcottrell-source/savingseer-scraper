-- Migration: Add saved_centres array to user_preferences
-- Used by notify-high-tide edge function to target email alerts.
-- A user can save multiple centres; the existing preferred_centre_id stays
-- as the single "home" centre shown by default.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS saved_centres TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_user_prefs_saved_centres
  ON user_preferences USING GIN (saved_centres);
