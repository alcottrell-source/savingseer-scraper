-- Migration: one-shot "finish setting up" nudge marker.
-- notify-high-tide's pass 5 emails users who signed up 3+ days ago but never
-- personalised (no followed brands, no saved centres, no audience flags) a
-- single reminder to finish the wizard — they are otherwise unreachable by
-- every alert pass, which all gate on personalisation. setup_nudged_at is the
-- sent marker: stamped on send (the sender upserts a bare row for users who
-- have no user_preferences row at all), never sent twice.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS setup_nudged_at TIMESTAMPTZ;
