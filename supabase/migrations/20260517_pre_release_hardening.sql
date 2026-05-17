-- Migration: pre-release hardening
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Close the user_preferences UPDATE RLS gap (account-integrity fix)
--
-- The original users_update_own_prefs policy (20260502) had USING but no
-- WITH CHECK. USING only filters which rows are visible to the UPDATE; with
-- no WITH CHECK an authenticated user could `UPDATE ... SET user_id =
-- <other_uuid>` and reassign/poison another account's preferences row
-- (saved centres, brand follows, notification toggles). Pin the post-update
-- row to the caller.
-- ──────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_update_own_prefs" ON user_preferences;
CREATE POLICY "users_update_own_prefs"
  ON user_preferences FOR UPDATE
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Remove the unbounded anonymous INSERT surface on community_signals
--
-- 20260504 granted `anon` INSERT with WITH CHECK (true) and no rate limit —
-- an open row-flood / spam vector. Nothing in the shipped client writes to
-- this table directly (brand thumbs go through the SECURITY DEFINER
-- record_brand_thumbs RPC, which is unaffected). Drop the open policy and
-- revoke the privilege; re-introduce writes behind a rate-limited RPC if the
-- raw signal stream is ever needed again.
-- ──────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anyone_insert_signals" ON community_signals;
REVOKE INSERT ON community_signals FROM anon;
