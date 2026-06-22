-- ──────────────────────────────────────────────────────────────────────────────
-- Move admin identity off the user-mutable `email` JWT claim onto a
-- server-controlled `admins` table keyed by auth.uid().
--
-- Before: is_admin() = (auth.jwt() ->> 'email') = 'alcottrell@gmail.com'.
-- The `email` claim is user-presentable and unverified, and that one check
-- gates EVERY admin write policy plus all PII reads. If a token could ever
-- carry an attacker-set `email` (custom claims, an unverified-email signup
-- path, a future auth change), it collapses to full admin.
--
-- After: is_admin() = the caller's auth.uid() is enrolled in `admins`.
-- auth.uid() is the cryptographic subject claim — not something the user can
-- spoof — so admin authority no longer rides on a mutable field. All existing
-- RLS policies call is_admin(), so they keep working unchanged.
--
-- SAFETY: this enrolls the current admin by email AT MIGRATION TIME (a one-time
-- trusted server-side lookup). Verify the SELECT below finds exactly one row
-- before relying on it — an empty `admins` table means is_admin() returns false
-- for everyone (locked out). Reversible: re-insert the user_id to restore.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admins (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;  -- service-role only; no anon/auth policies

-- Enrol the current admin (one-time backfill from the known account).
INSERT INTO admins (user_id, note)
  SELECT id, 'backfilled from is_admin email gate'
  FROM auth.users
  WHERE email = 'alcottrell@gmail.com'
  ON CONFLICT (user_id) DO NOTHING;

-- SECURITY DEFINER so the function can read the RLS-locked `admins` table
-- regardless of the caller; STABLE for the planner; pinned search_path.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$;
