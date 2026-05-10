-- Bound max_discount_pct to a sane range so a stray admin entry or scraper
-- regex can't poison the scoring algorithm (which divides by 100) or render
-- garbage on the customer dashboard.
--
-- NULL stays allowed: brands with no cycle / no detected discount have no %.
--
-- Idempotent: drops the constraint first if it exists, then re-adds.

ALTER TABLE brand_sale_cycles
  DROP CONSTRAINT IF EXISTS brand_sale_cycles_max_discount_pct_check;

ALTER TABLE brand_sale_cycles
  ADD CONSTRAINT brand_sale_cycles_max_discount_pct_check
  CHECK (max_discount_pct IS NULL OR (max_discount_pct >= 0 AND max_discount_pct <= 100));

ALTER TABLE brand_sale_events
  DROP CONSTRAINT IF EXISTS brand_sale_events_max_discount_pct_check;

ALTER TABLE brand_sale_events
  ADD CONSTRAINT brand_sale_events_max_discount_pct_check
  CHECK (max_discount_pct IS NULL OR (max_discount_pct >= 0 AND max_discount_pct <= 100));
