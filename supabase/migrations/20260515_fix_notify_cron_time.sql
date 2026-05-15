-- Migration: Fix notify-high-tide cron time
--
-- Bug: notify-high-tide was scheduled at 07:00 UTC, BEFORE the 10:00 UTC
-- scorer writes today's centre_seer_scores rows. Every run read zero
-- scores, so no peak alert / digest / brand-sale email was ever sent —
-- the job "succeeded" with alertsSent:0 and the failure went unnoticed.
--
-- Fix: reschedule to 11:00 UTC, one hour after the scorer (+ summariser).
--
-- Run once in the Supabase SQL editor (project: vrezzwadwzrmumjpdgge).
-- Replace <SERVICE_ROLE_KEY> with the real service-role key before running.
-- pg_cron stores the command verbatim, so the key cannot be committed here.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop the mis-timed job if it exists (ignore error if it doesn't).
do $$
begin
  perform cron.unschedule('notify-high-tide-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'notify-high-tide-daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
