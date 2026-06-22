-- ──────────────────────────────────────────────────────────────────────────────
-- Explicit onboarding-completion flag on user_preferences.
--
-- The first-time onboarding gate previously inferred "not onboarded" from the
-- absence of gender/style fields. But a user_preferences row can be created
-- WITHOUT completing onboarding — by saving a centre, flipping a notification
-- toggle, or accepting a referral. Those users got re-blasted with the wizard
-- on every fresh sign-in. The client now keys the gate off this explicit flag,
-- set true only when the prefs wizard is completed.
--
-- Backfill: any existing row that looks completed (has gender audiences or a
-- brand selection) is marked done so current users aren't re-prompted once.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

UPDATE user_preferences
  SET onboarding_completed = true
  WHERE onboarding_completed = false
    AND (
      womenswear IS TRUE OR menswear IS TRUE OR childrenswear IS TRUE
      OR (brand_ids IS NOT NULL AND array_length(brand_ids, 1) > 0)
    );
