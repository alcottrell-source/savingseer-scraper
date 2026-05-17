# notify-high-tide

Email job with three passes, gated by the POST body so one function serves
two schedules:

1. **Peak alerts** — for each centre at "Peak" today (verdict `Peak`; legacy
   `Go now` still matches), email every user who has saved that centre. The
   "top 3 brands on sale" list is filtered to the user's preferences (gender
   + style cluster) when they have any set.
2. **Brand-sale alerts** — for each brand whose sale cycle starts today,
   email users who follow that brand (`brand_ids`, or legacy gender/cluster
   match) and have `brand_sale_alerts` on, unless the brand is in their
   `excluded_brand_ids`. The "started today" signal is true for exactly one
   day, so each follower gets one email per brand per cycle — no separate
   sent-state table needed.
3. **Weekend digest** — for each user with saved centres, list each saved
   centre's stage. Only sent when at least one of their saved centres is at
   Rising or above.

### Invocation modes (POST body)

| Body | Passes run | Schedule |
|---|---|---|
| `{}` | 1 + 2 (peak + brand-sale) | daily 07:00 UTC |
| `{"digestOnly":true}` | 3 (weekend digest) | Friday 19:00 UTC |
| add `"dryRun":true` | preview only, nothing sent | — |

Trigger: GitHub Actions — see `.github/workflows/notify.yml` (two crons:
`0 7 * * *` daily, `0 19 * * 5` Friday 19:00 UTC). It derives the function
URL from the `SUPABASE_URL` secret and authenticates with
`SUPABASE_SERVICE_KEY`. The daily run must land _after_ the scorer so
today's `centre_seer_scores` row exists.

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

Your `from` address is `hello@tidego.co`. To override without editing code,
set the `TIDE_FROM_EMAIL` secret (e.g. `Tide <noreply@tidego.co>`).

> **Note on the live URL.** The CTA button in every email defaults to
> `https://v0-tide-sale-timing.vercel.app` (the current Vercel deployment).
> Once you point `tidego.co` DNS at the Vercel project, override it with:
> `supabase secrets set TIDE_APP_URL=https://tidego.co`

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

Scheduling is handled in-repo by `.github/workflows/notify.yml` — no manual
step is required once the function is deployed and the repo has the
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` secrets (already used by
`daily-scrape.yml`).

**If an older pg_cron job exists**, unschedule it so the digest doesn't fire
daily on the wrong schedule:

```sql
select cron.unschedule('notify-high-tide-daily');
```

<details>
<summary>pg_cron alternative (if you don't want GitHub Actions to schedule it)</summary>

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Daily 07:00 UTC — peak + brand-sale alerts.
select cron.schedule('notify-daily', '0 7 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/notify-high-tide',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body    := '{}'::jsonb);
$$);

-- Friday 19:00 UTC — weekend digest.
select cron.schedule('notify-digest', '0 19 * * 5', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/notify-high-tide',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body    := '{"digestOnly":true}'::jsonb);
$$);
```

If you use this, disable `.github/workflows/notify.yml` to avoid double-sends.
</details>

---

## Test it before going live

Dry-run (no emails actually sent — returns the would-be send list):

```bash
# Daily mode — peak + brand-sale passes
curl -X POST 'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'

# Friday digest mode
curl -X POST 'https://vrezzwadwzrmumjpdgge.functions.supabase.co/notify-high-tide' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true, "digestOnly": true}'
```

The JSON response includes `mode`, `alertsSent`, `brandAlertsSent`,
`digestsSent`, `brandsStartedToday`, and a per-recipient `log`.

Real send to one test address: sign yourself up via the web app, save a
centre that's currently at Rising or Peak, and invoke the function with no
`dryRun` flag.

---

## Notes

- Reads `centre_seer_scores`, `centres`, `brands`, `brand_sale_events`,
  `centre_brands`, `user_preferences`. Resolves user emails via
  `auth.admin.getUserById` — needs the service-role key, which the runtime
  injects automatically.
- Peak detection matches the new `Peak` verdict (and the legacy `Go now`
  string for back-compat) — see `stageFromVerdict()` in `index.ts`. Update
  that function when verdict copy changes.
- "Top 3 brands" is sorted by days-on-sale ascending (newest sales first),
  the same way the dashboard sorts on-sale chips.
- Brand-sale "started today" = the active cycle's `start_date` is today
  (admin-verified cycles) or `date_first_detected` is today (scraper-only
  rows). True for one day only, so it self-dedupes.
- On Fridays a user may receive a peak/brand alert (07:00) _and_ the digest
  (19:00) — intentional, they carry different value.
