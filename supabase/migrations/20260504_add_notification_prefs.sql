-- Migration: Add notification preference toggles to user_preferences
-- Adds two boolean toggles consumed by the notify-high-tide edge function.
-- Defaults preserve existing behaviour: alerts on, digest off (less noisy first-run).

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS email_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS daily_digest BOOLEAN NOT NULL DEFAULT FALSE;
