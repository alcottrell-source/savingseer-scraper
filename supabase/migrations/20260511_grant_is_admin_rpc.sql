-- Grant EXECUTE on is_admin() so the admin console (admin.html) can call it
-- as a PostgREST RPC (`POST /rest/v1/rpc/is_admin`) to gate the UI on the
-- server-side admin check, not just on RLS-filtered reads.
--
-- The function itself reads auth.jwt() ->> 'email' — the caller's JWT — so
-- it returns the right answer per signed-in user.
--
-- Idempotent: GRANT is safe to re-run.

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
