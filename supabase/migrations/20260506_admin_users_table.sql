-- Migration: multi-admin via admin_users table
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
--
-- Replaces the hard-coded single-admin email in is_admin() with a small
-- table lookup. Allows adding/removing admins without altering function
-- bodies (which is what every existing RLS policy depends on).
--
-- Behaviour:
--   - admin_users table holds one row per admin email.
--   - is_admin() now checks the caller's JWT email against the table.
--   - is_admin() stays STABLE so Postgres caches the result within a
--     transaction and RLS evaluation cost remains negligible.
--   - Existing RLS policies are unchanged because they already call
--     is_admin() — the function body changes but the signature does not.
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_users table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  email       CITEXT       PRIMARY KEY,
  added_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  added_by    TEXT,
  notes       TEXT
);

-- CITEXT lets case mismatches (Alcottrell@gmail.com vs alcottrell@gmail.com)
-- still match. If the citext extension isn't installed, fall back to TEXT
-- with a lower() comparison in is_admin() — handled below.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS citext;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'citext extension not installable — admin_users.email will be case-sensitive';
END $$;

-- Seed the existing admin so this migration doesn't lock anyone out.
INSERT INTO admin_users (email, added_by, notes)
VALUES ('alcottrell@gmail.com', 'migration_20260506', 'seeded from previous hardcoded is_admin()')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Only existing admins can read or modify the table. Bootstrapping (the very
-- first admin) is done by the seed INSERT above; subsequent admins are added
-- by an existing admin via the SQL editor while signed in as themselves.
DROP POLICY IF EXISTS "admin_read_admin_users" ON admin_users;
CREATE POLICY "admin_read_admin_users" ON admin_users
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "admin_write_admin_users" ON admin_users;
CREATE POLICY "admin_write_admin_users" ON admin_users
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

REVOKE ALL ON admin_users FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Replace is_admin() to use the table.
--    Same signature, same STABLE classification, same return type — all
--    existing RLS policies pick up the new behaviour automatically.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- SECURITY DEFINER so the function bypasses admin_users' own RLS when
  -- evaluating other tables' policies. Without this we'd hit a chicken-and-
  -- egg loop (RLS on table T calls is_admin() which selects admin_users
  -- which has its own RLS that calls is_admin()).
  --
  -- LOWER() is a belt-and-braces; if citext was installed the comparison is
  -- already case-insensitive.
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE LOWER(email::text) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;
