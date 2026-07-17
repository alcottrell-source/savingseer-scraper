# Tide growth plan (Jul 2026)

Why Tide isn't getting users, and the prioritised plan to fix it. Written from
a full audit of the acquisition surface, conversion funnel, retention
mechanics, and data ops. Phase 1 shipped with this document; Phases 2–3 and
Track B are the backlog.

## Diagnosis — the five root causes

The core product and the SEO architecture are genuinely good. The problem is
that the "tell me when to go" promise was unreachable for almost everyone:

1. **Broken promises.** Every static SEO page carried a live "Alert me when
   {centre} peaks" form writing to `seo_alert_signups` — and *nothing read the
   table*. Signups never received a single email. The blog's variant of the
   form didn't even insert (null `centre_slug` into a NOT NULL column). The
   logged-out "Alert me when {brand} goes on sale" button saved to
   localStorage with delivery unwired. The landing copy said "Add to Home
   Screen / Install App" with no manifest, so nothing was installable. The
   people who DID convert got nothing back — the worst outcome for trust.
2. **One conversion path, maximum friction.** The only route to any alert was
   magic-link email round-trip → 5-step wizard. The "Save this centre" button
   didn't render for logged-out visitors at all, so the most natural first
   commitment was invisible exactly when it mattered — even though the
   pending-save plumbing (`tide_pending_save_centre`) already existed.
3. **Retention engine over-gated.** All three email passes require
   `saved_centres` or followed `brand_ids`; a user who signs up but abandons
   the wizard is unreachable forever. The Friday digest skips quiet weeks
   entirely. Email is the only channel.
4. **Word-of-mouth leaked its best asset.** `shareCentre` shared the
   `?centre=` SPA link, which previews as the generic homepage card — while
   pre-rendered `/centre/<slug>` pages with per-centre titles already existed.
   The `?ref=` referral loop exists but is surfaced almost nowhere.
5. **Flying blind.** GA4 tracked only pageviews and shares. No events at any
   cliff edge (centre selected → save attempt → auth → magic-link return →
   wizard), so drop-off couldn't be measured.

Structural (not code): 24 centres caps addressable traffic; one admin
hand-verifying ~65 brands weekly caps coverage. See Track B.

## North-star metric

**Weekly Alerted Users** — distinct people (account holders + accountless
`seo_alert_signups` emails) sent at least one alert or digest that week. It is
the whole thesis in one number: people who trust Tide to tell them *when*.

Supporting metrics (all measurable with the Phase-1 instrumentation):
- Visitor → alert-subscription rate (`centre_selected` vs `alert_optin` +
  `magic_link_sent`).
- Magic-link completion rate (`magic_link_sent` → `magic_link_return`) — the
  suspected biggest cliff, now visible.
- Alert → return-visit rate (alert email CTAs land on `?centre=` deep links;
  read arrivals in GA4).

Suggested 90-day target: 500 alertable people, ≥40% of them actually alerted
in any given week.

## Phase 1 — shipped with this document

1. **`seo_alert_signups` delivery wired** — `notify-high-tide` pass 4 emails
   centre signups the day their centre enters Peak, brand signups the day the
   brand's sale starts, and blog signups when any centre peaks. 14-day
   re-notify throttle (`last_notified_at`), account-alert dedupe, one-click
   unsubscribe (`unsub_token` → `/api/unsubscribe`). Migration
   `20260717_seo_alert_delivery.sql`. The blog opt-in form now inserts
   (`centre_slug: 'blog'`) instead of silently 400ing.
2. **Share fix** — `shareCentre` now shares `https://tidego.co/centre/<slug>`
   (rich per-centre preview) instead of the `?centre=` SPA form.
3. **Logged-out dead-ends removed** — the save button renders for everyone
   (logged-out tap stashes the centre, opens auth with contextual copy, and
   the existing pending-save path completes it after sign-in); logged-out
   "Alert me" brand intents are consumed on sign-in via
   `tideConsumePendingAlerts()` → `followBrandForAlerts()`, so the button's
   promise is now kept.
4. **Funnel instrumentation** — `trackEvent()` (consent-gated GA4) at:
   `centre_selected`, `save_attempt_logged_out`, `auth_modal_open`,
   `magic_link_sent` (source-tagged), `magic_link_return`, `onboarding_step`,
   `onboarding_skip`, `onboarding_complete`, `alert_optin`,
   `report_submitted`. Absolute counts are consent-biased; step-to-step
   drop-off ratios survive the bias.
5. **Honest installability** — `manifest.json` + 192/512/maskable icons +
   apple-touch-icon, so "Add to Home Screen / Install App" is true. No
   service worker by design (installability doesn't need one; offline caching
   is maintenance a solo project doesn't need).

Deploy notes: apply the migration in Supabase; the edge function redeploys via
`deploy-functions.yml` on merge; `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are
already Vercel env vars (used by `/api/rescore`, now also `/api/unsubscribe`).

## Phase 2 — next 2–4 weeks

6. **One-field alert form inside the SPA.** The SEO pages' "email me when
   {centre} peaks" single-field form, mounted under the centre hero and as
   the logged-out brand-sheet action (writing `brand_slug` too). Reuses
   `seo_alert_signups` verbatim — this converts anonymous traffic into an
   emailable audience *without* the magic-link wall, and full sign-up becomes
   the upsell inside the alert emails.
7. **Reachability fallback.** (a) Quiet-week Friday digest sends a light
   version ("nothing peaking — here's what's building") instead of skipping;
   (b) digest-opted users with no saved centres get a national top-3 card;
   (c) a one-time "finish setting up" nudge email 3 days after signup for
   users with no prefs (needs a `nudged_at` marker). No separate monthly
   broadcast — the digest fallback covers it with less machinery.
8. **First-party cookieless funnel counter.** ~30-line `api/event.js`
   incrementing `(day, event_name)` aggregate rows — no user IDs, no cookies,
   so it sits outside consent and de-biases the GA4 picture. Call it from
   `trackEvent` for the funnel steps only.
9. **Crowd-report feedback v1.** `status`/`resolved_at` on `user_reports`;
   admin confirm marks reports confirmed; account panel shows "Your reports:
   N · M confirmed". No streaks/leaderboards (reputation weighting is
   deferred — DECISIONS OQ2). Also chips away at the admin-verification
   bottleneck by making crowd triage credible.
10. **Referral surfacing.** "Invite a friend" row in the account panel reuses
    the existing invite-link code; consider appending `?ref=` to shares for
    signed-in users. Do this only after the alert loop demonstrably delivers
    — referrals amplify a working loop, they can't create one.

## Phase 3 / later

- **Per-centre OG images** (`api/og.js` + `@vercel/og`) — CTR lift, not a
  bottleneck.
- **Public confidence/honesty cue** (owner TODO) — keep; ranks below every
  reachability item; sequence with the gravity confidence pass.
- **Web Push: rejected for now.** VAPID key management, subscription
  lifecycle, and iOS's install-first requirement are real ongoing maintenance
  for a solo operator while email retention is unproven. Revisit if Phase 1–2
  shows peak alerts driving return visits and email open rate is the limiter.

## Track B — non-code

- **Data ops:** don't add centres yet — per-centre quality beats breadth
  while one admin verifies everything (the D17 audit pruned for exactly this
  reason). Scale verification throughput instead: ship the re-verify queue
  (owner TODO 3), let confirmed crowd reports shrink the cold checks, and
  re-enter a scraper later through the ADR-001 evidence interface if volume
  justifies it.
- **Content:** publish the Friday digest as a weekly "This week's tide" blog
  post via the existing `seo/` generator — near-zero marginal effort, weekly
  freshness signal, internal links to `/centre/` pages. Target "next {brand}
  sale" / "{centre} sale dates" queries (`seo/next-sale-window.mjs` already
  computes the substance). Weight admin verification toward centres that pull
  Search Console queries.
- **Marketing:** hold paid/referral pushes until the alert loop delivers;
  then the peak-alert email itself is the referral surface ("forward this to
  someone who shops at {centre}").

The through-line: the moat (D12) is knowing *when* — but until now almost
nobody was positioned to be *told* when. Phase 1 makes the "tell me when"
promise real at the lowest possible commitment level, and makes the wall
measurable.
