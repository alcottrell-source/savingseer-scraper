-- ──────────────────────────────────────────────────────────────────────────────
-- brand_sale_cycle_changes — intra-cycle audit log of % / type changes.
--
-- A single sale cycle is one continuous sale episode (one open row in
-- brand_sale_cycles). But the *terms* of that sale can change while it runs —
-- an admin watching a brand deepen its discount from 50% to 60%, or a
-- "% off" promo becoming a "Flash" event, is the SAME sale, not a new one.
-- Previously those edits silently overwrote brand_sale_cycles.max_discount_pct
-- / sale_type with no trace of the progression.
--
-- This table captures each such change: the cycle it belongs to, the old and
-- new value of whichever field(s) moved, and when. The current value still
-- lives on brand_sale_cycles (unchanged); this is the history behind it.
--
-- One row is written per admin edit that actually moves the % and/or type
-- (no-op edits — start_date only, or identical values — write nothing). The
-- front-end reads it to show "deepened 50% → 60%" on the shop detail sheet;
-- the admin console shows the same trail under the verified-state line.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brand_sale_cycle_changes (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              UUID         NOT NULL REFERENCES brand_sale_cycles(id) ON DELETE CASCADE,
  brand_id              TEXT         NOT NULL,
  changed_date          DATE         NOT NULL DEFAULT CURRENT_DATE,
  old_max_discount_pct  INT,
  new_max_discount_pct  INT,
  old_sale_type         TEXT,
  new_sale_type         TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Per-cycle lookup (admin card + shop sheet join), newest change first.
CREATE INDEX IF NOT EXISTS idx_cycle_changes_cycle
  ON brand_sale_cycle_changes (cycle_id, created_at DESC);
-- Per-brand lookup (in case we ever want a brand-wide change feed).
CREATE INDEX IF NOT EXISTS idx_cycle_changes_brand
  ON brand_sale_cycle_changes (brand_id, created_at DESC);

ALTER TABLE brand_sale_cycle_changes ENABLE ROW LEVEL SECURITY;

-- Public read: the shop detail sheet (anon key) renders the change trail,
-- exactly like the anon-read grants on brand_sale_cycles / brand_sale_events.
DROP POLICY IF EXISTS "anon_read_cycle_changes" ON brand_sale_cycle_changes;
CREATE POLICY "anon_read_cycle_changes" ON brand_sale_cycle_changes
  FOR SELECT TO anon, authenticated USING (true);

-- Admin writes the audit rows from the console.
DROP POLICY IF EXISTS "admin_write_cycle_changes" ON brand_sale_cycle_changes;
CREATE POLICY "admin_write_cycle_changes" ON brand_sale_cycle_changes
  FOR INSERT TO authenticated WITH CHECK (is_admin());

GRANT SELECT ON brand_sale_cycle_changes TO anon, authenticated;
GRANT INSERT ON brand_sale_cycle_changes TO authenticated;
