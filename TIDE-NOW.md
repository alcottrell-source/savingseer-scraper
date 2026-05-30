# Tide — current-state reference (2026-05-30)

> This document describes **Tide as it actually is in the codebase today**. It's written to
> refresh the project's Claude memory (`CLAUDE.md`). Where it contradicts older docs, **this
> file wins** — see "Drift from older docs" at the bottom for the specific stale claims it
> supersedes. All numbers, formulas, schedules, and constants below were read out of the
> source, not the prose.

---

## 1. What Tide is

Tide tells a shopper **when to visit a UK shopping centre to catch the most brands on sale at
once**. The core fact behind every screen is the **Tide Score** = the percentage of a centre's
tracked brands that are on sale right now. A daily pipeline scrapes brand sale state, scores
each centre, writes a short trend narrative, and emails alerts; a single-file static web app
renders it.

- **30** major UK shopping centres tracked.
- **91** brands configured (IDs `B001`–`B102`, with gaps left by dropped brands; highest is
  `B102`). Of these, **23** are `manualCheck: true` (bot-protected sites verified by hand in the
  admin console, never auto-scraped).
- **8** brand clusters: High Street, Contemporary, Classic British, Smart/Occasion,
  Premium Casual, Active, Footwear, Accessories.

## 2. Architecture at a glance

No build step. The browser app is one big static file; the pipeline is plain Node scripts run by
GitHub Actions; instant rescore + the public site are on Vercel; auth/data/email are Supabase.

| Layer | Lives in | Notes |
|---|---|---|
| Public web app | `index.html` (~270 KB, single file) | HTML + inline CSS + inline JS, talks to Supabase via raw `fetch` (PostgREST) |
| Admin console | `admin.html` | Human verification queue; served at `/admin` and `admin.tidego.co` |
| Privacy page | `privacy.html` | served at `/privacy` |
| Scraper | `scraper.js` | Cheerio + Playwright dual pass → `brand_sale_events` |
| Scorer | `score.js` | Tide Score + stage machine → `centre_seer_scores`, `centres.tide_history`, `personal_tide_scores`. **Importable as a module** (lazy env/client, CLI guarded by `import.meta.url`). |
| Narrator | `summarise.js` | Gemini 2.0 Flash-Lite → `centre_seer_scores.narrative` |
| Brand config | `brands.js` | exports `brands`, `autoBrands` (no manualCheck), `manualCheckBrands` |
| Instant rescore | `api/rescore.js` | Vercel serverless wrapper around `runScoring()` |
| Email | `supabase/functions/notify-high-tide/index.ts` | 3-pass email sender |
| One-offs / tooling | `seed.js`, `sheets.js`, `extract-floors.js`, `scripts/*.mjs` | seeding, optional Sheets export, floor extraction, brand-presence rebuild |

Node **>=24**. Deps: `@supabase/supabase-js`, `crawlee`, `playwright`, `@google/genai`.
CLI scripts: `npm run scrape | score | summarise | run-all | test | test:e2e`.

## 3. The daily pipeline

| Stage | Schedule (UTC) | Command | Reads | Writes | Env |
|---|---|---|---|---|---|
| Scrape | **06:00** daily | `node scraper.js` | `brand_sale_events` | `brand_sale_events` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Score | **10:00** daily | `node score.js` | centres, brand_sale_events/cycles, yesterday's scores, user_preferences | `centre_seer_scores`, `centres.tide_history`, `personal_tide_scores` | same |
| Narrate | **10:00** daily (after score) | `node summarise.js` | today's scores + brands | `centre_seer_scores.narrative` (+ `narrative_generated_at`) | + `GEMINI_API_KEY` (soft-fail) |

Defined in `.github/workflows/daily-scrape.yml` (the `score` job runs `score.js` then
`summarise.js`). 4-hour buffer between scrape and score is deliberate.

### scraper.js — how sale detection works
Dual pass: **CheerioCrawler** (static HTTP, concurrency 5, 30 s) for `renderMode: 'static'`
brands, then **PlaywrightCrawler** (headless Chromium, concurrency 2, 60 s) for
`renderMode: 'browser'`. All 91 brands are pre-seeded in the result map so a crawler crash can't
silently flip a brand to "not on sale".

`detectSale()` precedence: **SALE_ENDED phrases** ("sale has ended", …) negate everything →
**SALE_UPCOMING phrases** ("sale starts", …) mean not-yet unless there's strong evidence →
positive only if a discount %, a **STRONG_SALE phrase** ("shop sale", "save up to", …), or a
markdown-price pattern is present. Discount regex caps at 1–95%.

Write rules: `manualCheck` brands are **skipped** (admin owns them). On a scraper error the
brand is flagged `scraper_error: true` and its prior status preserved. New sale → stamp
`date_first_detected = today`. Sale ended with **no open admin cycle** → `reset_brand_sale_cycle`
RPC; sale ended **with** an admin cycle → only flip `sale_status`, never touch the cycle.

> **The scraper reading is admin-panel-only. It never reaches the public site.** The public
> "on sale" truth is admin-verified state (see §4 and §10-C).

## 4. Tide Score and the verdict vocabulary (the heart)

**Tide Score = `Math.round((brandsOnSale / totalBrands) * 100 * 10) / 10`** — a one-decimal
percent of tracked brands on sale. No freshness weighting, no anchor multipliers. A user can
verify it against the "X of Y brands on sale" fact on the card.

"On sale" per brand (admin truth, scraper ignored): **active verified cycle** (`active_cycle_id`)
→ else **last verified decision** (`last_verified_status` when `last_verified_date` set) → else
off. "Days running" comes from `brand_sale_cycles.start_date`; discount % from the cycle's
`max_discount_pct`.

### Stage machine (`score.js`)
Constants: `HIGH_TIDE_ENTER = 40`, `HIGH_TIDE_EXIT = 30` (hysteresis), `RISING_FLOOR = 15`,
`OVER_CEILING = 8`. Trajectory bands: `TRAJECTORY_FLAT_BAND = 1.5`, `TRAJECTORY_FLIP_BAND = 4.0`
points, with sticky direction (a RISING centre holds through dips < 4 pts).

| Internal stage | Score / condition | Verdict (stored) | Headline word | Badge |
|---|---|---|---|---|
| Turning | 0, or 0 < score < 15 | `Quiet` | **QUIET** | — |
| Rising | ≥ 15, climbing | `Rising` | **RISING** | — |
| High Tide (global) | ≥ 40 (holds ≥ 30 via hysteresis) | `Peak` | **PEAK** | **GO NOW** |
| High Tide (local peak) | ≥ 15 and trajectory flips RISING → FLAT/FALLING | `Peak` | **PEAK** | **GO NOW** |
| Falling | post-peak, 8 ≤ score < 30 | `Easing` | **EASING** | — |
| Low | post-peak, score < 8 | `Over` | **OVER** | — |

**QUIET covers both score 0 and 0 < score < 15** — a centre with one or two brands reads the same
as one with none. Internal `stage` stays `'Turning'` for back-compat, but every user surface shows
QUIET.

**Local peak**: every centre has a peak day even if it never hits 40. `score.js` emits a one-day
`Peak` when yesterday was RISING and today's trajectory flips; the next day the descent branch
rolls it to Easing automatically. Genuine ≥ 40 cycles hold PEAK through the 40/30 band.

**Recommendation language is reserved for the PEAK badge.** Every other state describes
*direction*, not *prescription*. The headline + PEAK badge are the **only** places Tide tells the
user to act.

Stored BLUF strings (statement subtitle), exact: Peak → "Maximum sales density. This is the
moment."; Easing → "Sales tapering off. Picks getting thinner."; Rising → "Sales building across
the centre. Not at peak yet."; Quiet → "Nothing major on right now."; Over → "Sale cycle ended.
Check back in a few weeks."; local-peak → "This centre just peaked. Go now while picks are fresh…".

**Legacy verdict strings** (`Go now`, `Worth watching`, `Last chance — tide going out`, `Starting
to build`, `It's over`, `Nothing on`) still resolve everywhere so pre-rename rows render; the next
run rewrites the column.

### Carry-forward
If no brand at a centre has `last_verified_date == today`, `score.js` reuses yesterday's brand
counts but **re-runs the state machine forward** (so a Peak rolls to Easing without forcing the
admin to re-verify). This keeps instant rescore cheap.

## 5. The public app (`index.html`)

Single file, Supabase project `https://vrezzwadwzrmumjpdgge.supabase.co`, anon publishable key
for RLS-gated reads. **All DB access goes through `pgRead` / `pgUpsert` raw-fetch helpers — never
`sb.from()`** (the supabase-js client hangs in some browsers).

### Auth — 4-step modal state machine (`authShowStep(step)`)
| Step | ID | Purpose |
|---|---|---|
| `email` | `#auth-step-email` | enter email → Continue or magic link |
| `signin` | `#auth-step-signin` | returning user: password + magic-link fallback + "new here?" |
| `signup` | `#auth-step-signup` | new user: create password (8+) + "already have account?" |
| `magic` | `#auth-step-magic` | "check your inbox" after OTP / email-confirm signup |

Functions: `authContinue()`, `authSignIn()`, `authSignUp()`, `authMagicLink()`. Password inputs
are only mounted on signin/signup steps (avoids iOS autofill spam). `onAuthBtnClick()` →
`openAccountPanel()` if signed in, else `openAuthModal()`.

### "My Tide" account panel (`#account-panel`)
Email, saved-centres list, three inline toggles saved via `quickSavePref(key, value)`, "Edit
shopping preferences" → onboarding wizard, sign out, account deletion (`delete_my_account` RPC).
The three toggles map to columns `email_alerts`, `brand_sale_alerts`, `daily_digest`.

### Onboarding / preferences wizard — now **5 steps** (`#ob`, `openOnboarding()`)
`openPrefsModal()` is just an alias for `openOnboarding()`. First-time users get it automatically:
`onAuthStateChange` opens it only when `!userPrefs` (no `user_preferences` row) — **don't revert to
the old gender-field check**.

1. **Audiences** — who you shop for (Women's / Men's / Children's)
2. **Categories** — what you buy, per audience
3. **Brands** — filtered by audience+categories, grouped by cluster, all on by default
4. **Centres** — searchable list
5. **Notifications** — peak / brand-sale / weekend-digest toggles + live preview score

Saves via upsert on `user_preferences` with `onConflict: 'user_id'`. Client uses friendly codes;
IDs are translated to DB ids at the boundary.

### Centre card — the merged "vessel"
The dark TIDE card and the 60-day chart are now **one card** (`renderTideVessel`). It shows:
centre name + **trend pill** (word + arrow), the big headline verdict word, the "X of Y brands on
sale" fact, the statement subtitle, and the inline 60-day SVG curve.

- `deriveVerdict(ctx)` is the single source of the displayed word: prefer `serverVerdict`
  (`centre_seer_scores.verdict`), fall back to `stage`. Returns `{word, tone}`.
- `renderHistoryChart` takes `stage` + `serverVerdict` and runs them through `deriveVerdict`, so
  the **chart-corner badge word always equals the headline word**. Don't reintroduce a separate
  trajectory label ("Rising/Holding/Falling") in the chart corner.
- The trend-pill **arrow is overridden to neutral `→`** if the live curve's last segment
  contradicts the verdict tone — the pill and the curve can never read as different states. PEAK
  uses a non-directional ★.
- Sparse-history centres get a UK-retail-calendar backfill so the curve still renders (synthetic
  peaks are hard-capped below the PEAK threshold).

### Centre Intelligence narrative + Hot list
The narrative card reads `centre_seer_scores.narrative` and falls back to a template when null
(first run, summariser skipped, or no `GEMINI_API_KEY`). **No live API calls from the browser.**

`getHotCentres()` / `renderHotCentres()` rank centres by today's gain and label "**N new sales
today**". This is the **one live consumer of the day-on-day brand-count delta**, and it's
recency-guarded: the prior snapshot must be **yesterday**, else the centre is skipped (so a gain
across a gap is never mislabelled "today"). The per-day delta arrow was retired from the vessel
when the cards merged — the trend pill + curve carry direction now.

## 6. Admin console (`admin.html`) + instant rescore

Human verification queue, banded **Urgent** (user signal contradicts scraper) → **Easy** (agrees)
→ **Routine**. Mutations: `applyAction()` (confirm_start/end/on/off, dismiss — writes
`brand_sale_cycles`, `brand_sale_events`, logs `admin_review_log`), `applyEdit()` (cycle
dates/pct/type), `deleteCycle()`.

After every successful `applyAction`/`applyEdit` the console fires a **fire-and-forget POST to
`/api/rescore`**, so the public site reflects edits within a couple of seconds instead of waiting
for the 10:00 cron.

`api/rescore.js`: POST-only, wraps `runScoring()`. **Auth-gated** — requires the admin's Supabase
JWT (verified against `/auth/v1/user`) and the email must match the allowlist (default
`alcottrell@gmail.com`, overridable via `RESCORE_ADMIN_EMAIL`); fails closed 401/403 before
scoring. Optional `{ centre_ids: [...] }` scopes the rescore (omitted centres ride carry-forward).
Returns 200 ok / 502 if scores wrote but `tide_history` didn't (chart may be stale). Needs Vercel
env `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.

## 7. Notification emails

Supabase Edge function `notify-high-tide` (3 passes, gated by POST body) scheduled **in-repo** by
`.github/workflows/notify.yml` — **not pg_cron** (unschedule any old `notify-high-tide-daily`
pg_cron job to avoid a duplicate daily digest).

| Pass | Trigger | Schedule (UTC) → body | Gating column |
|---|---|---|---|
| Peak alert | a saved centre hits verdict `Peak` | daily **11:00**, `{}` | `email_alerts` |
| Brand-sale alert | a followed brand's cycle **starts today** | daily **11:00**, `{}` | `brand_sale_alerts` (respects `excluded_brand_ids`) |
| Weekend digest | ≥ 1 saved centre at Rising or above | **Friday 19:00**, `{"digestOnly":true}` | `daily_digest` |

11:00 is deliberately 1 h after the 10:00 scorer so today's score rows exist. The digest is
**weekly (Friday)** — the copy hard-codes "Friday". "Started today" = active cycle
`start_date == today` or `date_first_detected == today` (true one day only → self-dedupes, no
sent-state table). `digestOnly` runs pass 3 only; default `{}` runs passes 1+2 and skips the
digest. Auth: `Authorization: Bearer <service key>` **or** `x-notify-secret: <NOTIFY_TRIGGER_SECRET>`.
The digest is **trend-only** too — action language ("go now") is reserved for the high/peak bucket.

Edge-function env: `RESEND_API_KEY` (Supabase secret), optional `TIDE_FROM_EMAIL`,
`TIDE_APP_URL`; `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` come from the runtime.

## 8. Centre Intelligence narrative (`summarise.js`)

1–2 sentence trend narrative per centre+day, generated daily, stored in
`centre_seer_scores.narrative`. Model **`gemini-2.0-flash-lite`** (temp 0.4, ≤200 tokens).

**Don't switch to `gemini-2.5-flash-lite`** — its free-tier cap is 20 RPD, below the 30-centre
count, and the run dead-ends halfway. 2.0-flash-lite (1500 RPD / 15 RPM) is the only free-tier
Gemini with headroom as of May 2026. Rate-limited to a 5 s gap between calls. A per-day quota 429
halts the run (those centres fall back to template); per-minute 429/503 retries once.

The prompt **forbids numbers AND recommendation language** — narratives say what's happening
(which brands arrived, which are picked-over) but never what to do. British English, no hype.
Idempotent: a digit-free narrative already present today is skipped (digits imply stale
carry-forward or a rule violation → regenerate).

## 9. Database (Supabase `vrezzwadwzrmumjpdgge`)

- `user_preferences` — one row/user, RLS enforced. Cols: `saved_centres[]`, `brand_ids[]`,
  `excluded_brand_ids[]`, `email_alerts` (default true), `brand_sale_alerts` (default true),
  `daily_digest` (default false), legacy `womenswear/menswear/childrenswear`, `style_clusters[]`.
- `centre_seer_scores` — per-centre per-day: `tide_score`, `verdict`, `bluf`, `trajectory`,
  `brands_on_sale`, `total_brands`, `top_brands`, `avg_discount_pct`, `narrative`. Anon read on.
- `brand_sale_events` — scraper + admin state per brand: `sale_status`, `date_first_detected`,
  `max_discount_pct`, `scraper_error`, `last_verified_status/date`, `active_cycle_id`.
- `brand_sale_cycles` — admin-verified cycles: `start_date`, `end_date`, `max_discount_pct`.
- `centres` — `id`, `name`, `active`, and the 60-day `tide_history` JSONB cache.
- `centre_brands` — which brands are present at which centre (`present` flag).
- `personal_tide_scores` — per (user, centre, day) personal score against matching brands only.

## 10. Guardrails — don't break these

- **C — Data truth:** public on-sale state uses admin-verified cycle/`last_verified_status` only,
  **never** `brand_sale_events.sale_status`. Days-running = `cycle.start_date`; % = cycle's
  `max_discount_pct`. The front end's on-sale count must equal `centre_seer_scores.brands_on_sale`.
- **Single verdict word everywhere:** headline word == trend-pill word == chart-eyebrow word for a
  centre; the pill arrow never contradicts the curve. Recommendation language only on PEAK.
- **No client recomputation** overriding server `verdict`/`stage`/`bluf`/`trajectory`.
- **PostgREST via `pgRead`/`pgUpsert`**, never `sb.from()`.
- **No browser-side AI calls** — narratives come from the daily pipeline column.
- **First-run detection** = `!userPrefs`, not the old gender-field check.
- **Narrative copy** (summarise.js) must never use numbers or recommendation language.
- Don't rename the notification gating columns (only the human-readable copy).
- `REGRESSION-CHECKLIST.md` (sections A–F) is the eyeball checklist after any visual change.

## 11. Infra, deploy, testing

- **Vercel**, output dir `.` (repo root), no build command. Rewrites `/admin`, `/privacy`; CSP +
  `X-Frame-Options: DENY`; `index.html` cached 5 min, `admin.html`/`brands.js` no-cache.
- **CI workflows**: `daily-scrape.yml` (06:00 scrape, 10:00 score+narrate), `notify.yml` (11:00
  daily, Fri 19:00 digest), `e2e.yml` (read-only verdict-alignment Playwright on PRs, never writes
  to prod, resolves the Vercel preview from vercel[bot]'s PR comment), `extract-floors.yml`
  (manual floor extraction).
- **Tests**: `npm test` → unit (`test/score.test.mjs`: trajectory/stage/hysteresis;
  `test/presence.test.mjs`: BRANDS/PRESENCE integrity, presence ≥ 2). `npm run test:e2e` →
  Playwright verdict alignment + analytics + security headers against a preview deploy.

### Env / secrets quick reference
| Where | Vars |
|---|---|
| GitHub Actions | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `NOTIFY_TRIGGER_SECRET`, (e2e: `PREVIEW_URL`, `VERCEL_BYPASS`) |
| Vercel | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, optional `RESCORE_ADMIN_EMAIL` |
| Supabase secrets | `RESEND_API_KEY`, optional `NOTIFY_TRIGGER_SECRET`, `TIDE_FROM_EMAIL`, `TIDE_APP_URL` |

## 12. Tooling / one-offs (not in the daily cron)

- `seed.js` — one-off upsert of `brands` (id, name, cluster, gender flags) from `brands.js`.
- `sheets.js` — optional Google Sheets export (`SHEET_ID`, `GOOGLE_CREDENTIALS`); not wired into
  the current daily flow.
- `extract-floors.js --centre <id> [--dry-run]` — Gemini-parses a centre directory into
  `centre_brand_floors`; needs `GEMINI_API_KEY`. Wrapped by `extract-floors.yml` (manual).
- `scripts/*.mjs` — brand-presence rebuild chain: fetch centre directories →
  build presence matrix (keep rule: present at ≥ 2 centres) → generate SQL migrations +
  `brands.js` additions. Used when adding/pruning brands.

## 13. Drift from older docs (what this file corrects)

- **Schedules**: the live crons are scrape **06:00**, score+narrate **10:00**, notify **11:00**,
  digest **Fri 19:00** UTC. Older `CLAUDE.md` prose mentioning 07:00/08:00 is stale.
- **Onboarding** is a **5-step** wizard (audiences → categories → brands → centres →
  notifications), not the old 4-step "gender → clusters → notifications → preview".
  `openPrefsModal()` is an alias for `openOnboarding()`.
- **Counts**: 91 brands / 23 manual-check / 8 clusters / 30 centres (not "71 brands" from
  `README-technical.md`, which also describes a Google-Sheets/`scores.json` flow that is no longer
  the pipeline — Supabase is now the store).
- `README-technical.md` predates the Supabase migration; treat it as historical.
