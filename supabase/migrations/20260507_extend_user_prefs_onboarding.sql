-- Migration: Extend user_preferences for the new onboarding journey
--
-- Adds the structured preference columns the new full-screen onboarding writes to:
--   audiences          – ['womenswear','menswear','childrenswear']
--   categories         – ['everyday','workwear','going-out','outerwear','active','footwear','accessories','denim']
--   brand_ids          – brand IDs the user has explicitly opted in to
--   excluded_brand_ids – brand IDs the user has explicitly opted out of
--   brand_sale_alerts  – fire an email the moment one of the user's brands starts a new sale
--
-- The legacy boolean fields (womenswear / menswear / childrenswear / style_clusters /
-- email_alerts / daily_digest) stay in place. The dashboard reads brand_ids first
-- and falls back to the legacy fields, so users who pre-date this migration keep
-- working until they next save preferences.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS audiences          TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS categories         TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS brand_ids          TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_brand_ids TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS brand_sale_alerts  BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill audiences from the legacy booleans for users who already have prefs,
-- so the dashboard's brand-filter still has audience info to lean on if brand_ids
-- is empty. Leaves brand_ids untouched — the next time a user opens onboarding
-- they'll see all matching brands pre-selected and tap Save.
UPDATE user_preferences
SET audiences = ARRAY(
  SELECT a FROM (VALUES
    ('womenswear',    womenswear),
    ('menswear',      menswear),
    ('childrenswear', childrenswear)
  ) AS t(a, on_flag) WHERE on_flag = TRUE
)
WHERE cardinality(audiences) = 0
  AND (womenswear OR menswear OR childrenswear);
