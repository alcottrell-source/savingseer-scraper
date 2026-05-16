-- ──────────────────────────────────────────────────────────────────────────────
-- Schedule the notify-high-tide edge function (pg_cron + pg_net).
--
-- Two jobs:
--   notify-tide-alerts-daily    07:00 UTC every day  → peak + brand-sale
--                               alerts only (body skipDigest:true).
--   notify-tide-weekend-digest  19:00 UTC every Fri   → Weekend Digest
--                               (and, harmlessly, the alert passes again —
--                               email_log de-dup makes those no-ops).
--
-- The service-role key and function URL are read from Supabase Vault so this
-- migration carries NO secrets and is safe to commit. Run the two
-- vault.create_secret() calls below ONCE (replace the placeholder), in the
-- Supabase SQL editor, before/after applying this migration:
--
--   select vault.create_secret(
--     '<PASTE SUPABASE SERVICE ROLE KEY>', 'notify_service_key');
--   select vault.create_secret(
--     'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide',
--     'notify_fn_url');
--
-- To rotate the key later: select vault.update_secret(
--   (select id from vault.secrets where name = 'notify_service_key'),
--   '<NEW KEY>');
--
-- Idempotent: re-running re-creates both schedules.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing jobs first so this migration is safe to re-run. cron.unschedule
-- raises if the job is absent, so swallow that on first apply.
DO $$ BEGIN PERFORM cron.unschedule('notify-tide-alerts-daily');
  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('notify-tide-weekend-digest');
  EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Daily alerts: peak + brand-sale. skipDigest keeps the digest off this run.
SELECT cron.schedule(
  'notify-tide-alerts-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_service_key')
    ),
    body    := '{"skipDigest": true}'::jsonb
  );
  $$
);

-- Weekend Digest: Fridays 19:00 UTC. Empty body → digest pass runs (the
-- function still self-gates to Friday as a backstop).
SELECT cron.schedule(
  'notify-tide-weekend-digest',
  '0 19 * * 5',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_service_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:  SELECT jobname, schedule FROM cron.job
--          WHERE jobname LIKE 'notify-tide-%';
