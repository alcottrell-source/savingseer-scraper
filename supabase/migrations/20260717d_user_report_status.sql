-- Migration: crowd-report feedback loop v1 (status on user_reports).
-- Reports stay ADVISORY (D6 — they never mutate sale state). What changes:
-- when the admin verifies a state change that AGREES with open reports,
-- admin.html marks those reports 'confirmed', and the reporter's account
-- panel shows "Your reports: N · M confirmed" — closing the loop that used
-- to end at a thank-you toast. No reputation weighting (OQ2 stays deferred).

ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'confirmed'));
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Only the admin updates report status (admin.html runs as the authenticated
-- admin user, not service_role — same model as the read policy).
DROP POLICY IF EXISTS "admin updates report status" ON public.user_reports;
CREATE POLICY "admin updates report status"
  ON public.user_reports FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Column-level grant: the admin can flip status/resolved_at but nothing else
-- (reports remain immutable evidence otherwise).
GRANT UPDATE (status, resolved_at) ON public.user_reports TO authenticated;
