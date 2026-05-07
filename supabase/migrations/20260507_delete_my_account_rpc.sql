-- Migration: Right-to-be-forgotten RPC (UK GDPR Art. 17)
--
-- Adds a `delete_my_account()` function callable by any authenticated user
-- that wipes their personalisation rows AND their auth.users row, completing
-- erasure in a single round-trip from the client.
--
-- The function runs as SECURITY DEFINER so it can touch auth.users (which
-- the anon/authenticated roles can't normally write to). It hard-codes the
-- target user_id to auth.uid() so a caller can only delete *their own*
-- account — never another user's, even if they craft a malicious request.
--
-- Frontend wiring:
--   const { error } = await sb.rpc('delete_my_account');
--   await sb.auth.signOut();

CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Wipe personalisation data first (cascades aren't enough here because we
  -- also need to delete the auth.users row, which lives in a different schema).
  DELETE FROM public.user_preferences   WHERE user_id = uid;
  DELETE FROM public.personal_tide_scores WHERE user_id = uid;

  -- Finally, the auth.users row itself. ON DELETE CASCADE on the FKs above
  -- would catch any rows we missed.
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- Restrict EXECUTE to authenticated users only (anon should never call this).
REVOKE EXECUTE ON FUNCTION delete_my_account() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_my_account() TO authenticated;
