-- Migration: manual-check brands + reset_brand_sale_cycle function
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Fixes two gaps that caused manually-set sale data to be invisible in the app:
--
-- 1. reset_brand_sale_cycle was called by scraper.js but never committed to
--    migrations. If the function didn't exist the call errored silently and the
--    cycle state was never cleared. Defining it here makes the behaviour explicit
--    and the repo self-contained.
--
-- 2. 17 brands visible in the Tide dashboard (AllSaints, Ann Summers, Boux
--    Avenue, Bravissimo, Burton, Calvin Klein, French Connection, Gant,
--    Jack & Jones, Jaeger, Jigsaw, LK Bennett, Mint Velvet, Miss Selfridge,
--    Primark, Uniqlo, Foot Locker) had no rows in brands or brand_sale_events.
--    Without a row, the admin console couldn't show them and any manual Supabase
--    edits were silently dropped by the app (DASHBOARD_NAME_BY_SCRAPER_ID lookup
--    returned undefined → continue). Adding rows here makes them manageable.
--
-- Idempotent: safe to re-run.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. reset_brand_sale_cycle
--    Called by scraper.js when sale_status flips on→off and no admin cycle is
--    open. Closes the Supabase sale-cycle record and wipes scraper + admin
--    columns so the next sale starts with a clean slate.
--    NOTE: scraper.js now guards this call — it is NOT invoked when
--    active_cycle_id is set or when the scraper itself errored.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reset_brand_sale_cycle(p_brand_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Close any open sale cycle for this brand.
  UPDATE brand_sale_cycles
     SET end_date   = CURRENT_DATE,
         updated_at = NOW()
   WHERE brand_id = p_brand_id
     AND end_date IS NULL;

  -- Wipe the event row so the next sale starts fresh.
  -- active_cycle_id FK is cleared here; the cycle row itself is kept for history.
  UPDATE brand_sale_events
     SET sale_status          = FALSE,
         date_first_detected  = NULL,
         active_cycle_id      = NULL,
         last_verified_status = NULL,
         last_verified_date   = NULL,
         updated_at           = NOW()
   WHERE brand_id = p_brand_id;
END;
$$;

-- Service role (used by scraper.js via service key) needs EXECUTE.
GRANT EXECUTE ON FUNCTION reset_brand_sale_cycle(TEXT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed brands rows for new manual brands
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO brands (id, name, cluster, womenswear, menswear, childrenswear, sale_url)
VALUES
  ('B078', 'AllSaints',         'Premium Casual',  TRUE,  TRUE,  FALSE, 'https://www.allsaints.com/sale'),
  ('B079', 'Ann Summers',       'Accessories',     TRUE,  FALSE, FALSE, 'https://www.annsummers.com/sale'),
  ('B080', 'Boux Avenue',       'Accessories',     TRUE,  FALSE, FALSE, 'https://www.bouxavenue.com/sale'),
  ('B081', 'Bravissimo',        'Accessories',     TRUE,  FALSE, FALSE, 'https://www.bravissimo.com/sale'),
  ('B082', 'Burton',            'High Street',     FALSE, TRUE,  FALSE, 'https://www.burton.co.uk/sale'),
  ('B083', 'Calvin Klein',      'Premium Casual',  TRUE,  TRUE,  FALSE, 'https://www.calvinklein.co.uk/en/sale'),
  ('B084', 'French Connection', 'Smart/Occasion',  TRUE,  TRUE,  FALSE, 'https://www.frenchconnection.com/sale'),
  ('B085', 'Gant',              'Premium Casual',  TRUE,  TRUE,  FALSE, 'https://www.gant.co.uk/sale'),
  ('B086', 'Jack & Jones',      'High Street',     FALSE, TRUE,  FALSE, 'https://www.jackjones.com/gb/en/sale'),
  ('B087', 'Jaeger',            'Smart/Occasion',  TRUE,  TRUE,  FALSE, 'https://www.jaeger.co.uk/sale'),
  ('B088', 'Jigsaw',            'Smart/Occasion',  TRUE,  TRUE,  FALSE, 'https://www.jigsaw-online.com/sale'),
  ('B089', 'LK Bennett',        'Smart/Occasion',  TRUE,  FALSE, FALSE, 'https://www.lkbennett.com/sale'),
  ('B090', 'Mint Velvet',       'Smart/Occasion',  TRUE,  FALSE, FALSE, 'https://www.mintvelvet.co.uk/sale'),
  ('B091', 'Miss Selfridge',    'High Street',     TRUE,  FALSE, FALSE, 'https://www.missselfridge.com/sale'),
  ('B092', 'Primark',           'High Street',     TRUE,  TRUE,  TRUE,  'https://www.primark.com/en-gb/a/offers'),
  ('B093', 'Uniqlo',            'Contemporary',    TRUE,  TRUE,  TRUE,  'https://www.uniqlo.com/uk/en/sale'),
  ('B094', 'Foot Locker',       'Footwear',        TRUE,  TRUE,  TRUE,  'https://www.footlocker.co.uk/sale')
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed brand_sale_events rows for new manual brands
--    One row per brand, starting in a known-clean state.
--    The admin console requires a row to exist before it will show the brand.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO brand_sale_events (brand_id, sale_status, scraper_error)
SELECT b.id, FALSE, FALSE
FROM brands b
WHERE b.id IN (
  'B078','B079','B080','B081','B082','B083','B084','B085',
  'B086','B087','B088','B089','B090','B091','B092','B093','B094'
)
AND NOT EXISTS (
  SELECT 1 FROM brand_sale_events e WHERE e.brand_id = b.id
);
