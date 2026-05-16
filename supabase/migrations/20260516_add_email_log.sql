-- ──────────────────────────────────────────────────────────────────────────────
-- email_log — de-duplication ledger for the notify-high-tide edge function.
--
-- One row per email actually sent. The function reads this before every send
-- so it never double-sends:
--   - peak / digest : ref_key = centre_id / 'weekend', capped at one per
--                      user per ref per sent_date (also makes a same-day
--                      re-invoke a no-op).
--   - brand_sale    : ref_key = '<brand_id>:<cycle>', checked across ALL
--                      dates so an ongoing sale cycle alerts a user once.
--
-- Written and read ONLY by the edge function via the service_role key, which
-- bypasses RLS. RLS is enabled with no policies so no anon/authenticated
-- session can ever read another user's send history.
--
-- Idempotent: safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_log (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type  TEXT        NOT NULL CHECK (email_type IN ('peak', 'brand_sale', 'digest')),
  ref_key     TEXT        NOT NULL,
  sent_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upsert target for recordSent(): one send per user/type/ref/day.
CREATE UNIQUE INDEX IF NOT EXISTS email_log_dedupe_idx
  ON public.email_log (user_id, email_type, ref_key, sent_date);

-- Supports the cross-day brand_sale lookup (email_type = 'brand_sale').
CREATE INDEX IF NOT EXISTS email_log_brand_lookup_idx
  ON public.email_log (email_type, user_id, ref_key);

-- Supports the per-day peak/digest lookup (sent_date = today).
CREATE INDEX IF NOT EXISTS email_log_sent_date_idx
  ON public.email_log (sent_date);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- No policies by design: only the service_role key (which bypasses RLS) ever
-- touches this table. Anon / authenticated browser sessions get nothing.
