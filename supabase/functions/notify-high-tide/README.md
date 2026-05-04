# notify-high-tide

Daily email job. Two passes per run:

1. **High-tide alerts** — for each centre at "Go now" today, email every user
   who has saved that centre. The "top 3 brands on sale" list is filtered to
   the user's preferences (gender + style cluster) when they have any set.
2. **Daily digest** — for each user with saved centres, list each saved
   centre's stage. Only sent when at least one of their saved centres is at
   Rising or above.

Trigger: cron, daily at 07:00 UTC (matches the existing scoring run at
`0 8 * * *` in the GitHub Actions workflow — set the cron _after_ the
scorer so today's `centre_seer_scores` row exists by the time we read it).

---

## One-time setup (do this in order)

### 1. Run the saved_centres migration

Apply the new column in the Supabase SQL editor:

```sql
-- supabase/migrations/20260504_add_saved_centres.sql
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS saved_centres TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_user_prefs_saved_centres
  ON user_preferences USING GIN (saved_centres);
```

### 2. Verify your Resend domain

In the Resend dashboard:

- Add domain `tidego.co`
- Copy the four DNS records (SPF, DKIM x2, return-path) into your domain
  registrar
- Wait for "Verified" — usually under an hour

Your `from` address is `hello@tidego.co`. If you want a different one, edit
`FROM_EMAIL` in `index.ts`.

### 3. Get a Resend API key

Resend dashboard → API Keys → "Create API Key" → "Sending access" only.
Copy the `re_...` key.

### 4. Wire Resend into Supabase Auth (for the magic-link emails)

Magic-link emails are sent by Supabase Auth, not by this function — but
you'll want them to come from `hello@tidego.co` too:

- Supabase dashboard → Project Settings → Auth → SMTP Settings → Enable
  custom SMTP
- Host: `smtp.resend.com`
- Port: `465` (SSL)
- Username: `resend`
- Password: your Resend API key (the same one)
- Sender email: `hello@tidego.co`
- Sender name: `Tide`
- Save

Also under Auth → URL Configuration:

- Site URL: `https://tidego.co`
- Redirect URLs: add `https://tidego.co/**` and your preview URLs

### 5. Push the function + set its secret

From the project root:

```bash
supabase login                               # one-time
supabase link --project-ref vrezzwadwzrmumjpdgge

supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
supabase functions deploy notify-high-tide
```

### 6. Schedule it

In the Supabase SQL editor:

```sql
-- Enable pg_cron + pg_net once if not already
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule the function to run daily at 07:00 UTC.
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with your real values.
select cron.schedule(
  'notify-high-tide-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/notify-high-tide',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

To cancel later: `select cron.unschedule('notify-high-tide-daily');`

---

## Test it before going live

Dry-run (no emails actually sent — returns the would-be send list):

```bash
curl -X POST 'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'
```

Real send to one test address: sign yourself up via the web app, save a
centre that's currently at Rising or above, and invoke the function with no
`dryRun` flag.

---

## Notes

- Reads `centre_seer_scores`, `centres`, `brands`, `brand_sale_events`,
  `centre_brands`, `user_preferences`. Resolves user emails via
  `auth.admin.getUserById` — needs the service-role key, which the runtime
  injects automatically.
- The "Go now" detection uses `verdict.toLowerCase().includes('go now')`,
  matching the wording your scorer writes today. If you change the verdict
  copy, update `stageFromVerdict()` in `index.ts`.
- "Top 3 brands" is sorted by days-on-sale ascending (newest sales first),
  the same way the dashboard sorts on-sale chips.
- A user can receive both an alert _and_ a digest on the same day if a
  saved centre is at "Go now" — that's intentional (different value).
