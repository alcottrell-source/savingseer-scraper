# notify-waitlist

Emails the operator **once per new `waitlist` signup** (the international-
expansion capture). Reuses the Resend sender that `notify-high-tide` uses.

It's triggered by a **Supabase Database Webhook** on `waitlist` INSERT — not
the scheduled notify cron. The webhook fires the moment a row is inserted and
POSTs the new row to this function, which sends the email.

## One-time setup

The function deploys automatically when this directory changes on `main`
(`.github/workflows/deploy-functions.yml`). Two manual steps remain:

### 1. Secrets

`RESEND_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are already
set on the project (shared with `notify-high-tide`). Add the waitlist-specific
secret — a long random string of your choosing:

```bash
supabase secrets set WAITLIST_WEBHOOK_SECRET=<random-string>
# optional — defaults to alcottrell@gmail.com:
supabase secrets set WAITLIST_NOTIFY_TO=you@example.com
```

### 2. Database Webhook

Supabase dashboard → **Database → Webhooks → Create a new hook**:

- **Name:** `notify-waitlist`
- **Table:** `waitlist`  ·  **Events:** `Insert`
- **Type:** *Supabase Edge Functions* → select `notify-waitlist`
  (or *HTTP Request* → `POST https://<project>.functions.supabase.co/notify-waitlist`)
- **HTTP Headers:** add `x-webhook-secret` = the `WAITLIST_WEBHOOK_SECRET` value
  above. (The dashboard adds the `Authorization` bearer automatically; the
  secret header is what this function actually checks.)

## Test

```bash
curl -X POST 'https://<project>.functions.supabase.co/notify-waitlist' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -d '{"dryRun":true,"record":{"email":"test@example.com","country":"US"}}'
```

`dryRun` returns the rendered subject + recipient + current waitlist total
without sending. Drop `dryRun` (and keep the same auth) to send a real email.
