-- Migration: Admin console + sale-cycle data model
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Adds three tables (brand_sale_cycles, community_signals, admin_review_log),
-- four verified-state columns on brand_sale_events, an is_admin() helper, and
-- RLS policies that restrict writes to the configured admin email.
--
-- Idempotent: safe to re-run.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. is_admin() — single source of truth for "is the caller an admin?"
--    Reads the email claim from the caller's Supabase JWT. Change the email
--    string here (or extend to a list) to add/remove admins. No table needed.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() ->> 'email') = 'alcottrell@gmail.com';
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. brand_sale_cycles — verified human record of a brand's sale period
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_sale_cycles (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          TEXT         NOT NULL REFERENCES brands(id),
  start_date        DATE         NOT NULL,
  end_date          DATE,
  max_discount_pct  INT,
  source            TEXT         NOT NULL DEFAULT 'admin',
  confidence_count  INT          NOT NULL DEFAULT 1,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cycles_brand           ON brand_sale_cycles(brand_id);
CREATE INDEX IF NOT EXISTS idx_cycles_brand_open      ON brand_sale_cycles(brand_id) WHERE end_date IS NULL;

DROP TRIGGER IF EXISTS trg_cycles_updated_at ON brand_sale_cycles;
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON brand_sale_cycles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE brand_sale_cycles ENABLE ROW LEVEL SECURITY;

-- Read: everyone (consumer dashboard needs to render cycle start dates)
DROP POLICY IF EXISTS "anon_read_cycles" ON brand_sale_cycles;
CREATE POLICY "anon_read_cycles" ON brand_sale_cycles
  FOR SELECT TO anon, authenticated USING (true);

-- Write: admin only
DROP POLICY IF EXISTS "admin_write_cycles" ON brand_sale_cycles;
CREATE POLICY "admin_write_cycles" ON brand_sale_cycles
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT ON brand_sale_cycles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON brand_sale_cycles TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- 3. community_signals — silent collection of consumer thumbs feedback
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_signals (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     TEXT         NOT NULL,
  signal_type  TEXT         NOT NULL CHECK (signal_type IN ('sale_started','sale_ended','confirmed','denied')),
  discount_pct INT,
  source       TEXT         NOT NULL DEFAULT 'user_feedback',
  user_hash    TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_brand_created ON community_signals(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_user_brand     ON community_signals(user_hash, brand_id);

ALTER TABLE community_signals ENABLE ROW LEVEL SECURITY;

-- Insert: open to anyone (anon allowed — no login required to thumbs)
DROP POLICY IF EXISTS "anyone_insert_signals" ON community_signals;
CREATE POLICY "anyone_insert_signals" ON community_signals
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Read: admin only (raw signals contain user_hash — kept private)
DROP POLICY IF EXISTS "admin_read_signals" ON community_signals;
CREATE POLICY "admin_read_signals" ON community_signals
  FOR SELECT TO authenticated
  USING (is_admin());

-- Update/delete: admin only
DROP POLICY IF EXISTS "admin_modify_signals" ON community_signals;
CREATE POLICY "admin_modify_signals" ON community_signals
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_signals" ON community_signals;
CREATE POLICY "admin_delete_signals" ON community_signals
  FOR DELETE TO authenticated
  USING (is_admin());

GRANT INSERT ON community_signals TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON community_signals TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- 4. admin_review_log — what the admin checked each day
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_review_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        TEXT         NOT NULL,
  reviewed_date   DATE         NOT NULL DEFAULT CURRENT_DATE,
  action          TEXT         NOT NULL CHECK (action IN ('confirmed_on','confirmed_off','confirmed_start','confirmed_end','dismissed','edited')),
  cycle_id        UUID         REFERENCES brand_sale_cycles(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, reviewed_date)
);

CREATE INDEX IF NOT EXISTS idx_review_log_date ON admin_review_log(reviewed_date DESC);

ALTER TABLE admin_review_log ENABLE ROW LEVEL SECURITY;

-- Admin only — read and write
DROP POLICY IF EXISTS "admin_all_review_log" ON admin_review_log;
CREATE POLICY "admin_all_review_log" ON admin_review_log
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_review_log TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- 5. brand_sale_events — verified-state columns + community counters
--    Active cycle FK gives score.js a single column to look up the open cycle.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE brand_sale_events
  ADD COLUMN IF NOT EXISTS last_verified_date     DATE,
  ADD COLUMN IF NOT EXISTS last_verified_status   BOOLEAN,
  ADD COLUMN IF NOT EXISTS active_cycle_id        UUID REFERENCES brand_sale_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS community_thumbs_up    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS community_thumbs_down  INT NOT NULL DEFAULT 0;

-- Existing anon SELECT policy (from 20260503_grant_anon_read.sql) covers reads
-- of these new columns. Admin needs UPDATE on this table to set verified state
-- and active_cycle_id from the console.
DROP POLICY IF EXISTS "admin_update_sale_events" ON brand_sale_events;
CREATE POLICY "admin_update_sale_events" ON brand_sale_events
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

GRANT UPDATE ON brand_sale_events TO authenticated;

-- The thumbs counters need to be incrementable by anyone via an RPC. A direct
-- UPDATE policy for anon would let users set counters to anything. We expose a
-- narrow SECURITY DEFINER function instead — anyone can call it; it can only
-- ever +1 a counter on a specific brand_id.
CREATE OR REPLACE FUNCTION record_brand_thumbs(p_brand_id TEXT, p_is_up BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_is_up THEN
    UPDATE brand_sale_events
       SET community_thumbs_up = community_thumbs_up + 1
     WHERE brand_id = p_brand_id;
  ELSE
    UPDATE brand_sale_events
       SET community_thumbs_down = community_thumbs_down + 1
     WHERE brand_id = p_brand_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION record_brand_thumbs(TEXT, BOOLEAN) TO anon, authenticated;
