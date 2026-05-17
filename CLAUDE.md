# Savingseer / Tide — Claude context

## Project overview
Single-file static web app (`index.html`) deployed to Vercel. No build step. Talks directly to Supabase for auth and data. Pipeline lives in separate Node scripts: `scraper.js` (scrape brand sale state) → `score.js` (compute Tide Score per centre) → `summarise.js` (Claude-written 1–2 sentence Centre Intelligence narrative).

## Running locally
```bash
npx serve .
# opens at http://localhost:3000
```

## Auth & registration (updated May 2026)

### What exists
The auth modal is a **4-step state machine** driven by `authShowStep(step)`:

| Step | ID | Purpose |
|------|----|---------|
| `email` | `#auth-step-email` | User enters email, clicks Continue or requests magic link |
| `signin` | `#auth-step-signin` | Returning user — password field, magic link fallback, "new here?" escape |
| `signup` | `#auth-step-signup` | New user — create password (8+ chars), "already have account?" escape |
| `magic` | `#auth-step-magic` | Confirmation: "check your inbox" shown after OTP send or email-confirm signup |

Key functions: `authContinue()`, `authSignIn()`, `authSignUp()`, `authMagicLink()`, `authShowStep(step)`.

### "My Tide" account panel
Signed-in users clicking the nav button open `#account-panel` (not the prefs wizard). It shows:
- Their email
- Saved centres list
- Peak alert + daily digest toggles (inline quick-save via `quickSavePref(key, value)`)
- "Edit shopping preferences" → opens prefs wizard
- Sign out

`onAuthBtnClick()` routes to `openAccountPanel()` if signed in, `openAuthModal()` if not.

### First-time onboarding
`onAuthStateChange` fires `openPrefsModal()` only when `!userPrefs` (no row in `user_preferences` table). Previously used a fragile gender-field check — don't revert to that.

### Preferences wizard (`#prefs-modal`)
4-step wizard: gender → style clusters → notifications + saved centres → preview. Opens automatically for new users and via "Edit shopping preferences" in the account panel. Saves via upsert on `user_preferences` with `onConflict: 'user_id'`.

## Verdict vocabulary (May 2026 — trend-only headlines)

Headlines on the centre card are **pure trend signals**. Recommendation language (`go`, `worth it`, `worth a visit`, `don't wait`, `skip`) is reserved for the **PEAK badge** — the only state where the dashboard tells the user to act. Every other state describes direction, not prescription.

| Stage (internal) | Score | Verdict (stored in `centre_seer_scores.verdict`) | Headline word | Badge |
|---|---|---|---|---|
| Turning (cycle hasn't started) | 0 | `Quiet` | **QUIET** | — |
| Turning (early — small handful of brands) | >0, <25 | `Quiet` | **QUIET** | — |
| Rising | 25–<75 | `Rising` | **RISING** | — |
| High Tide (global) | ≥75 (hyst. 65) | `Peak` | **PEAK** | **GO NOW** |
| High Tide (local peak) | ≥25, day trajectory flips RISING → FALLING | `Peak` | **PEAK** | **GO NOW** |
| Falling | 25–<65 post-peak | `Easing` | **EASING** | — |
| Low | <25 post-peak | `Over` | **OVER** | — |

**Quiet covers both score = 0 and 0 < score < 25.** Previously the >0,<25 band was a separate "Turning" headline; merging it into Quiet means a centre with one or two brands on sale reads the same as a centre with none — both are "nothing meaningful yet". The internal `stage` value is still `'Turning'` for back-compat with all the call sites that switch on stage, but every user-facing surface (vessel headline, ladder, gauge arc, 60-day chart badge) shows **QUIET**. The legacy `'Turning'` verdict string still maps correctly when reading historical rows.

**The 60-day chart corner badge is synced to the headline.** `renderHistoryChart` takes `stage` + `serverVerdict` and runs them through `deriveVerdict` so the badge word and arrow always match the vessel headline. Don't reintroduce a separate trajectory-derived label ("Rising / Holding / Falling") in the chart corner — the same view was showing two contradictory state words and confused readers.

**Local peak:** every centre has a peak sale day, even ones that never break 75. `score.js` detects this as a one-shot trajectory flip (RISING → FALLING) inside the climb path and emits `verdict='Peak'` for that single day; the front-end shows PEAK + GO NOW and the peak-alert email fires. The next day, `STAGE_FROM_VERDICT['Peak']='High Tide'` routes the centre through the descent branch and we transition to Easing automatically. Genuine ≥75 cycles still hold PEAK through the 75/65 hysteresis band as before.

Legacy verdict strings (`Go now`, `Worth watching`, `Last chance — tide going out`, `Starting to build`, `It's over`, `Nothing on`) still resolve in every consumer (`score.js`, `index.html`, `summarise.js`, `notify-high-tide/index.ts`) so pre-rename rows render correctly. The next daily run rewrites the column with the new vocabulary — no migration needed.

**Alignment rules every consumer must obey:**
- The brand-delta arrow (`↑ N more brands on sale than yesterday` / `↓ N fewer …`) follows the **stage direction**, never the raw signed delta. If they disagree (e.g. brand count up on an easing tide), suppress the row.
- The trend arrow under the bluf shows direction only — no "still worth a visit" tail.
- Narrative copy (`summarise.js`) is forbidden from using recommendation language — see the system prompt in that file.

## Centre Intelligence narrative (May 2026)
The card under each centre's score shows a 1–2 sentence trend narrative. It's generated daily by `summarise.js` (Gemini 2.0 Flash-Lite, free tier — 1500 RPD, 15 RPM) and stored in `centre_seer_scores.narrative` for that centre+date. The front-end reads the column and falls back to a template narrative when the column is null (first run on a new centre, summariser skipped, or `GEMINI_API_KEY` absent). Don't add live API calls from the browser — keep generation in the daily pipeline.

The Gemini prompt forbids numbers AND recommendation language — narratives describe what's happening (which brands just arrived, which are picked-over) but never tell the reader what to do. The headline + PEAK badge are the only places the dashboard prescribes action.

Don't switch the model to `gemini-2.5-flash-lite`: its free-tier daily cap is 20 RPD, below our 30+ centre count, and the script will dead-end halfway through. `gemini-2.0-flash-lite` is the only Gemini free-tier model with enough headroom for this workload as of May 2026.

Required env var on the GitHub Action's `score` job: `GEMINI_API_KEY` (repo secret).

## Notification emails (May 2026)
Supabase Edge function `notify-high-tide` runs three passes, gated by the POST body so one function serves two schedules. Scheduled in-repo by `.github/workflows/notify.yml` (NOT pg_cron — unschedule any old `notify-high-tide-daily` job to avoid a daily digest).

| Pass | Trigger | Schedule (body) | Gating column |
|---|---|---|---|
| Peak alert | a saved centre hits **Peak** (verdict `Peak`) | daily 07:00 UTC, `{}` | `email_alerts` |
| Brand-sale alert | a followed brand's sale cycle **starts today** | daily 07:00 UTC, `{}` | `brand_sale_alerts` (+ respects `excluded_brand_ids`) |
| Weekend digest | ≥1 saved centre at Rising or above | **Friday 19:00 UTC**, `{"digestOnly":true}` | `daily_digest` |

UI toggles in the account panel map to these three columns. Don't rename the columns — only the human-readable copy. The digest is **weekly (Friday)**, not daily — the email copy hard-codes "Friday" and that is now correct. Brand-sale "started today" = active cycle `start_date == today` or `date_first_detected == today`; true for one day only, so it self-dedupes (no sent-state table). `digestOnly` runs pass 3 only; the default daily call runs passes 1+2 and skips the digest.

## Database
Supabase project: `vrezzwadwzrmumjpdgge.supabase.co`
Key tables:
- `user_preferences` — one row per user, RLS enforced.
- `centre_seer_scores` — per-centre, per-day Tide Score + verdict + `narrative` (anon read enabled).

## Instant rescore (May 2026)

`/api/rescore.js` is a Vercel serverless function that wraps `runScoring()` from `score.js`. The admin panel (`admin.html`) fires a fire-and-forget POST to it after every successful `applyAction` / `applyEdit`, so the public site reflects admin edits within a couple of seconds without waiting for the 08:00 UTC cron. Carry-forward in `score.js` (if no brand at the centre has `last_verified_date == today`, copy yesterday's row) keeps the rescore cheap and prevents tide_score freshness-decay drift on centres the admin hasn't touched today.

**Required Vercel env vars** (Project Settings → Environment Variables — mirror the GitHub Actions secrets):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

`score.js` is now safe to import as a module — env-var checks and the supabase client are lazy, and the CLI entry is guarded by an `import.meta.url === file://…argv[1]` check so daily-cron behaviour is unchanged.

## Deployment
Vercel, output directory is `.` (repo root). No build command. Preview deployments available per branch.
