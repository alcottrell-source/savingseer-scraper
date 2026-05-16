# notify-high-tide

Tide's email job. **Three passes per run:**

1. **Peak alert** — for each centre at "Peak" today, email every user who has
   that centre saved and has Peak Sale Alerts on (`email_alerts`).
2. **Brand sale alert ("your shop")** — for each user with Brand Sale Alerts
   on (`brand_sale_alerts`), email a heads-up for any brand they follow that
   has just started a new sale at one of their saved centres. De-duplicated
   per sale cycle, so an ongoing sale never re-alerts.
3. **Weekend Digest** — Fridays only. For each user with the Weekend Digest on
   (`daily_digest`) and at least one saved centre at Rising or above, send a
   weekend briefing.

De-dup is enforced by the `email_log` table: peak/digest one per user per ref
per day; brand-sale one per user per brand per sale cycle. Safe to invoke more
than once a day — repeats become no-ops.

## Triggers

Two `pg_cron` jobs, created by `supabase/migrations/20260516_schedule_emails.sql`:

| Job | Schedule (UTC) | Body | Effect |
|-----|----------------|------|--------|
| `notify-tide-alerts-daily` | `0 7 * * *` | `{"skipDigest":true}` | Peak + brand-sale, every day |
| `notify-tide-weekend-digest` | `0 19 * * 5` | `{}` | Weekend Digest, Fridays 7pm |

A non-fatal fallback step in `.github/workflows/daily-scrape.yml` also POSTs
`{"skipDigest":true}` after the daily scorer, in case `pg_cron` isn't enabled.

## One-time setup (in order)

### 1. Apply the migrations

In the Supabase SQL editor (project `vrezzwadwzrmumjpdgge`), run, in order:

- `20260516_add_email_log.sql` — the de-dup ledger.
- `20260516_schedule_emails.sql` — the two cron jobs (reads its secrets from
  Vault — see step 4).

### 2. Verify the Resend domain

Resend dashboard → add domain `tidego.co` → copy the SPF / DKIM / return-path
DNS records into the **Vercel** DNS panel for tidego.co (DNS is Vercel-managed)
→ wait for "Verified".

### 3. Set the function's secrets + deploy

```bash
supabase login                                  # one-time
supabase link --project-ref vrezzwadwzrmumjpdgge
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
supabase functions deploy notify-high-tide
```

`TIDE_APP_URL` now defaults to `https://tidego.co` and `TIDE_FROM_EMAIL` to
`Tide <hello@tidego.co>`. Override via `supabase secrets set` only if needed.

### 4. Put the cron secrets in Vault

The schedule migration reads the service key and function URL from Vault so no
secret is committed. In the SQL editor (replace the placeholder):

```sql
select vault.create_secret('<SERVICE_ROLE_KEY>', 'notify_service_key');
select vault.create_secret(
  'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide',
  'notify_fn_url');
```

(The service-role key is in Supabase → Project Settings → API → `service_role`.)

### 5. Wire Resend into Supabase Auth (makes signup / magic-link emails work)

Supabase → Project Settings → Auth → SMTP Settings → enable custom SMTP:

- Host `smtp.resend.com`, Port `465`, User `resend`,
  Password = your Resend API key, Sender `hello@tidego.co`, Name `Tide`.

Auth → URL Configuration: Site URL `https://tidego.co`, add redirect URL
`https://tidego.co/**` (plus any preview URLs).

## Test before going live

Dry-run (nothing sent — returns the would-be send list):

```bash
curl -X POST 'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'
```

Preview the Friday digest on any weekday: add `"forceFriday": true`.
Preview alerts only (no digest): add `"skipDigest": true`.
Inspect the `log` array: every entry is an intended send or a `skipped` reason.

## Notes

- "Peak" detection uses `stageFromVerdict()` (matches the scorer's verdict
  wording; legacy "Go now" still maps). If you change verdict copy in
  `score.js`, update `stageFromVerdict()` here.
- Reads `centre_seer_scores`, `centres`, `brands`, `brand_sale_events`,
  `centre_brands`, `user_preferences`, `email_log`. Resolves emails via
  `auth.admin.getUserById` (needs the service-role key, injected by the
  runtime).
- `email_log` is service-role only (RLS on, no policies).
