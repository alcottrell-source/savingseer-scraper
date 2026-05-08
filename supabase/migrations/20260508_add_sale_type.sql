-- ──────────────────────────────────────────────────────────────────────────────
-- Add sale_type to brand_sale_cycles and mirror it on brand_sale_events.
--
-- Distinguishes promotion shapes the scraper can't infer from a discount %
-- alone: 2-for-1 (BOGO), 2nd-half-price, multibuy/3-for-2, flat £/$ off,
-- flash, seasonal. percent_off remains the default and back-compat value.
-- One type per cycle. Discount % is still optional and meaningful for some
-- non-percent types (e.g. a multibuy that effectively yields ~33% off).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE brand_sale_cycles
  ADD COLUMN IF NOT EXISTS sale_type TEXT NOT NULL DEFAULT 'percent_off';

ALTER TABLE brand_sale_cycles
  DROP CONSTRAINT IF EXISTS brand_sale_cycles_sale_type_check;
ALTER TABLE brand_sale_cycles
  ADD CONSTRAINT brand_sale_cycles_sale_type_check
  CHECK (sale_type IN (
    'percent_off',
    'flat_discount',
    'bogo',
    'bogo_half',
    'multibuy',
    'flash',
    'seasonal'
  ));

-- Denormalised cache on the event row, mirroring max_discount_pct.
ALTER TABLE brand_sale_events
  ADD COLUMN IF NOT EXISTS sale_type TEXT;

ALTER TABLE brand_sale_events
  DROP CONSTRAINT IF EXISTS brand_sale_events_sale_type_check;
ALTER TABLE brand_sale_events
  ADD CONSTRAINT brand_sale_events_sale_type_check
  CHECK (sale_type IS NULL OR sale_type IN (
    'percent_off',
    'flat_discount',
    'bogo',
    'bogo_half',
    'multibuy',
    'flash',
    'seasonal'
  ));
