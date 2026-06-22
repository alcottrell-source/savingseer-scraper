-- ──────────────────────────────────────────────────────────────────────────────
-- notifications_sent — idempotency ledger for the notify-high-tide function.
--
-- The peak-alert and weekend-digest passes had no sent-state, so a double
-- invocation (manual run + cron, or a retry) re-sent those emails. (The
-- brand-sale "started today" pass self-dedupes by date, but a same-day double
-- invocation would still resend.) This table records one row per
-- (user, kind, ref) per day; the function checks it before sending and writes
-- it after a successful send. The function treats the table as best-effort, so
-- it keeps working until this migration is applied.
--
-- kind ∈ {peak, brand, digest}. ref disambiguates within a kind:
--   peak   → centre_id
--   brand  → sorted brand-name list in the email
--   digest → the date (one digest per user per day)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications_sent (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  kind       TEXT        NOT NULL CHECK (kind IN ('peak','brand','digest')),
  ref        TEXT,
  sent_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One send per (user, kind, ref) per day. COALESCE so a NULL ref still dedupes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_sent_unique
  ON notifications_sent (user_id, kind, COALESCE(ref, ''), sent_date);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_date
  ON notifications_sent (sent_date);

-- Service-role only (the function uses the service key); no anon/auth access.
ALTER TABLE notifications_sent ENABLE ROW LEVEL SECURITY;
