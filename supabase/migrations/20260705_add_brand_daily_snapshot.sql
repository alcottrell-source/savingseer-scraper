-- Migration: brand_daily_snapshot — one row per brand per day, capturing
-- on-sale state + discount depth as of that day's scoring run. Run once in
-- the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Written by score.js on every run (daily cron + intraday rescores both
-- upsert today's row, so the value of record is whatever it was at the
-- last run of the day). Lets the front-end compare a brand's CURRENT
-- discount % against the value recorded when its live cycle first started
-- (via cycle_id) — e.g. "was 50% off, now 60% off" — without needing a
-- separate audit trail on brand_sale_cycles itself.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS brand_daily_snapshot (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      TEXT         NOT NULL REFERENCES brands(id),
  snapshot_date DATE         NOT NULL,
  cycle_id      UUID         REFERENCES brand_sale_cycles(id) ON DELETE SET NULL,
  on_sale       BOOLEAN      NOT NULL DEFAULT false,
  discount_pct  INT,
  sale_type     TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, snapshot_date)
);

ALTER TABLE brand_daily_snapshot
  DROP CONSTRAINT IF EXISTS brand_daily_snapshot_discount_pct_check;
ALTER TABLE brand_daily_snapshot
  ADD CONSTRAINT brand_daily_snapshot_discount_pct_check
  CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100));

CREATE INDEX IF NOT EXISTS idx_brand_snapshot_brand_date ON brand_daily_snapshot(brand_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_brand_snapshot_cycle       ON brand_daily_snapshot(cycle_id) WHERE cycle_id IS NOT NULL;

ALTER TABLE brand_daily_snapshot ENABLE ROW LEVEL SECURITY;

-- Read: everyone (the dashboard reads this client-side to render the
-- discount-change badge in the Newest Sales panel).
DROP POLICY IF EXISTS "anon_read_brand_snapshot" ON brand_daily_snapshot;
CREATE POLICY "anon_read_brand_snapshot" ON brand_daily_snapshot
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON brand_daily_snapshot TO anon, authenticated;

-- No write policy for anon/authenticated: score.js writes via the
-- service-role key, which bypasses RLS entirely (mirrors centre_seer_scores).
