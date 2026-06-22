# Savingseer / Tide — Claude context

## Project overview
Single-file static web app (`index.html`) deployed to Vercel. No build step. Talks directly to Supabase for auth and data. Pipeline lives in separate Node scripts: `score.js` (compute Tide Score per centre) → `summarise.js` (Claude-written 1–2 sentence Centre Intelligence narrative). **Sale state is admin-verified only** — an operator confirms each brand's sale in the admin console (`admin.html`), writing `brand_sale_cycles` + `brand_sale_events` (`active_cycle_id` / `last_verified_status`). The on-sale predicate is `score.js`'s exported `isBrandOnSale(sale, today)` (unit-tested): an active cycle counts only inside its window — a **future `start_date` isn't on sale yet, and a closed cycle (`end_date` set) isn't on sale any more** — falling back to `last_verified_status`; the admin console rejects future start dates and a partial unique index forbids two open cycles per brand. The old automated `scraper.js` was **removed** (Jun 2026); the now-frozen `brand_sale_events.sale_status` / `date_first_detected` / `scraper_error` columns remain in the DB but are unread. Admins find sales via the "open shop" link + crowd user-reports (the review nudge), not a scraper.

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
`onAuthStateChange` fires `openPrefsModal()` when onboarding hasn't been completed — gated on the explicit `user_preferences.onboarding_completed` flag (`!userPrefs || userPrefs.onboarding_completed !== true`), set `true` only when the prefs wizard is finished. **Don't** infer completion from gender/style fields: a `user_preferences` row can be created *before* onboarding (saving a centre, a notification toggle, a referral), so the old gender-field heuristic re-blasted those users with the wizard on every fresh sign-in. (Migration `20260622_add_onboarding_completed.sql` adds the column and backfills already-onboarded users.)

### Preferences wizard (`#prefs-modal`)
4-step wizard: gender → style clusters → notifications + saved centres → preview. Opens automatically for new users and via "Edit shopping preferences" in the account panel. Saves via upsert on `user_preferences` with `onConflict: 'user_id'`.

## Verdict vocabulary (May 2026 — trend-only headlines)

Headlines on the centre card are **pure trend signals**. Recommendation language (`go`, `worth it`, `worth a visit`, `don't wait`, `skip`) is reserved for the **PEAK badge** — the only state where the dashboard tells the user to act. Every other state describes direction, not prescription.

**Score = % of tracked brands on sale.** `tide_score = round(brandsOnSale / totalBrands × 100)`. A user looking at the card can verify the score directly against "X of Y brands on sale". No freshness weighting, no anchor multipliers — the number on the gauge is the brand-density fact the card already shows. The old freshness-weighted formula made the headline drift on its own as brands aged, which is why a centre adding 10 new sales today could read OVER.

| Stage (internal) | Score | Verdict (stored in `centre_seer_scores.verdict`) | Headline word | Badge |
|---|---|---|---|---|
| Turning (cycle hasn't started) | 0 | `Quiet` | **QUIET** | — |
| Turning (early — small handful of brands) | >0, <15 | `Quiet` | **QUIET** | — |
| Rising | 15–<40 | `Rising` | **RISING** | — |
| High Tide (global) | ≥40 (hyst. 30) | `Peak` | **PEAK** | **GO NOW** |
| High Tide (local peak) | ≥15, day trajectory flips RISING → FALLING | `Peak` | **PEAK** | **GO NOW** |
| Falling | 8–<30 post-peak | `Easing` | **EASING** | — |
| Low | <8 post-peak | `Over` | **OVER** | — |

**Quiet covers both score = 0 and 0 < score < 15.** A centre with one or two brands on sale reads the same as a centre with none — both are "nothing meaningful yet". The internal `stage` value is still `'Turning'` for back-compat with all the call sites that switch on stage, but every user-facing surface (vessel headline, count line, history chart) shows **QUIET**.

**Centre-detail hero rebuild (Jun 2026).** The centre-detail vessel (`renderTideVessel`, now a single ctx object) leads with the **Tide Score as a large `%`** + the **trend-only verdict word** (PEAK/RISING/EASING/OVER/QUIET — never recommendation copy; `data-verdict-word` carries the canonical word). At Peak, and only at Peak (`tone==='go'`), a small **`Go now` badge** (`.tide-vessel-go-badge`) sits beside the word — the one place the hero prescribes action, mirroring the verdict-table "PEAK badge / GO NOW". Don't fold "Go now" back into the headline word (it desynced the hero from the all-centres list, which shows "PEAK"). Then a **"Verified {when}"** badge (most-recent `last_verified_date` across brands at the centre), a **saved-shops line** (`renderSavedShopsLine` — three states, mirrors the brand-sale alert copy), a **count line** ("N of M shops on sale, {direction} K two weeks ago" — count from `brands_on_sale`/`total_brands`, direction word from the engine `trajectory`, comparison count from the real `brands_on_sale` stored in `tide_history` two weeks ago, data-gated), and a **bold neon-green history chart** (`buildTideChartSVG` over `buildTideRealSeries`) with **7D/30D/60D/MAX** tabs (`setTideChartPeriod`), defaulting to **60D**. The chart plots `tide_history` exactly as stored — **no synthetic backfill, no value rescaling, no monotonising** (the synthetic `buildTide60Series` path now serves only the all-centres landing chart). The flat-black panel + neon line is the hero; the **y-axis is a fixed 0–100% scale** so every value sits at its true height (58% reads as 58%, not jammed near the top) and the **100% line is always shown** — an earlier auto-zoom made 58% draw 11% from the top, which read as ~maxed-out, so it was reverted to fixed 0–100 (headroom traded for honest positioning). Faint gridlines at 0/25/50/75/100 with numeric labels. **No PEAK/QUIET threshold lines** (they read as confusing on a 0–100 axis — 40% labelled "PEAK" looks low, and centres above 40% crest above it). Instead, **each point where the centre ENTERS peak** (score crosses up through `TIDE_PEAK_LINE` = 40) is marked with a small **amber dot** on the curve — one per peak episode, no text. `TIDE_PEAK_LINE` (mirror of score.js's `HIGH_TIDE_ENTER`) now drives the peak-dot test; `TIDE_QUIET_LINE` is unused by the chart. The "worth going" message stays in the hero verdict word + count line, not the chart. Periods window by **calendar date** (`windowTideSeries`): 7D/30D/60D = the last 7/30/60 days, MAX = all stored history (which `score.js` now retains for **180 days** — `HISTORY_RETENTION_DAYS` — so MAX stays meaningfully longer than 60D as data accrues). A window that yields <2 points falls back to the last 2 real points so a gappy centre still draws a line. Because windows are date-based, **the tabs only render visibly different where the centre actually has points spanning those ranges** — a centre with ≤30 days of history draws the same line on 30D/60D/MAX until more days accrue (use `scripts/diag-tide-history.mjs` to check coverage). **The landing chart (`renderTide60Light`) keeps its own point-based `tide60Window` over the synthetic 60-point series and still shows 7D/30D/MAX tabs** (`setTide60Period`, windowing the all-centres average) and is 50% taller, but otherwise keeps its original look (0–100 scale, 33/66 gridlines, date labels, trend pill). The old trend pill + chart-corner badge + statement subtitle were retired — direction lives in the count line now. **The hero count must equal `centre_seer_scores.brands_on_sale`** (it's the same source `tide_score` is computed from, so the `%` and the count can't contradict); it falls back to the local PRESENCE×SALE_STATUS count only when the server hasn't scored the centre yet.

**Local peak:** every centre has a peak sale day, even ones that never break the 40% HIGH_TIDE_ENTER. `score.js` detects this as a one-shot trajectory flip (RISING → FLAT/FALLING) inside the climb path and emits `verdict='Peak'` for that single day; the front-end shows PEAK + GO NOW and the peak-alert email fires. The next day, `STAGE_FROM_VERDICT['Peak']='High Tide'` routes the centre through the descent branch and we transition to Easing automatically. Genuine ≥40 cycles hold PEAK through the 40/30 hysteresis band.

Legacy verdict strings (`Go now`, `Worth watching`, `Last chance — tide going out`, `Starting to build`, `It's over`, `Nothing on`) still resolve in every consumer (`score.js`, `index.html`, `summarise.js`, `notify-high-tide/index.ts`) so pre-rename rows render correctly. The next daily run rewrites the column with the new vocabulary — no migration needed.

**Alignment rules every consumer must obey:**
- The literal day-on-day brand-count change is brand-count-driven, so stage and delta cannot disagree. It is **not** rendered anywhere any more. The per-day delta arrow was retired from the centre vessel when the dark TIDE card was merged in (the count line's trajectory-sourced "K two weeks ago" clause + the history curve carry direction now), and the **"Today's tide" list** (`getHotCentres` → `renderHotCentres`, formerly "Hot right now") no longer uses it either: that list now ranks by **verdict severity then Tide Score** (`HOT_VERDICT_SEVERITY`: Peak > Rising > Easing > Quiet > Over) and each row shows the density fact **"X of Y shops on sale"** (`brands_on_sale`/`total_brands`, no client recompute). The old momentum ranking + "N new sales today" copy + its yesterday-recency guard are gone.
- The centre-detail hero shows a **single** verdict word (beside the `%`). The trend pill + chart-corner badge were retired (Jun 2026); direction is carried by the count line's "{up from / down from / holding at} K two weeks ago" clause, whose **word is sourced from the engine `trajectory`**, never a client count comparison. If trajectory and the raw count delta disagree, trajectory wins the word (and a `console.warn` flags the conflict). Don't reintroduce a second directional label on the card.
- Narrative copy (`summarise.js`) is forbidden from using recommendation language — see the system prompt in that file.
- The weekend digest email (`notify-high-tide` `digestVerdictFor`) is trend-only too; action language ("go now") is reserved for the high/peak bucket, mirroring the PEAK badge.

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

UI toggles in the account panel map to these three columns. Don't rename the columns — only the human-readable copy. The digest is **weekly (Friday)**, not daily — the email copy hard-codes "Friday" and that is now correct. Brand-sale "started today" = active cycle `start_date == today` or `date_first_detected == today`; true for one day only. `digestOnly` runs pass 3 only; the default daily call runs passes 1+2 and skips the digest. All three passes are also **idempotent within a day** via the `notifications_sent` ledger (`(user_id, kind, ref, sent_date)` unique; `kind ∈ peak/brand/digest`) so a double invocation (manual + cron, or a retry) can't re-send — the function checks/writes it best-effort and still works if the table is absent. The function returns **HTTP 502** (not 200) when it attempted sends but delivered nothing, so the schedule can't go green on a zero-delivery run.

## Shop detail sheet (June 2026)
Tapping any brand chip on a centre opens a **bottom sheet** (`#ts-sheet`, all classes `ts-*` namespaced) with that brand's sale status, full sale-episode history, a tide-rhythm chart, and a contextual CTA. Built to the canonical prototype `tide-detail-prototype.html` (visual source of truth — palette/type/SVG geometry come from there). **Descriptive/historical only — zero predictions** (no estimated end dates, no next-sale forecast); see PRD §4.4 / §11.

- **Episode source is `brand_sale_cycles`, not a new derivation.** The verified cycle table already *is* the sale-episode dataset (one closed cycle = one past sale; the open cycle = the live episode). `loadTideData` fetches *all* cycles (was: open only) into `BRAND_CYCLES` (dashboard-name → `[{start,end,pct,saleType,live,lengthDays}]`, newest-first). Don't rebuild episode grouping from `brand_sale_events` — that table is a single current-state row per brand, not a daily log.
- **No per-brand tide stage exists** (Tide Score is per-*centre*). The sheet's stage chip is derived from live state: on sale → "On sale" (sage `#6E8E63`); has history, not live → "Resting" (`#9A9CA3`); no history → "Watching". Gold is reserved for a High-Tide signal we don't compute per brand, so the chip never goes gold. Following the prototype literally, the LIVE tag and the live row's depth bar are gold; the chart's live crest uses the stage colour.
- **Aggregates** (facts grid): `On record` = episode count; `Avg length` = mean length of *completed* episodes (excludes the live one); `Deepest` = max `max_discount_pct`. Null discounts are excluded from deepest/avg and render "on sale" without a %. Chart window is the **trailing 12 months** (note shown if older sales exist); crest height encodes discount depth; list depth-bar width = `pct/deepest`. Sparse history (`< 3` episodes) softens the chart caption but renders the same.
- **Interaction:** chips carry `data-brand-name`; the delegated capture-phase click handler in the reporting IIFE opens the sheet (it already owns swipe/`suppressClick` state). A modified click (cmd/ctrl/shift/middle) on a linked chip keeps its native new-tab jump to the retailer. The affiliate link now lives on the sheet's CTA (`See it on {brand} →`, commission note). Off-sale / no-history brands get an **Alert-me stub** that registers intent in `localStorage` (`tide_alert_brands`) only — delivery wiring is a separate ticket. Pager ‹ › wraps over the visible list order; ✕ / backdrop / swipe-down-on-grab close; Escape + focus trap + reduced-motion handled. `window.openBrandSheet/closeTideSheet/tideSheetStep`.

## Database
Supabase project: `vrezzwadwzrmumjpdgge.supabase.co`
Key tables:
- `user_preferences` — one row per user, RLS enforced.
- `centre_seer_scores` — per-centre, per-day Tide Score + verdict + `narrative` (anon read enabled).

## Instant rescore (May 2026)

`/api/rescore.js` is a Vercel serverless function that wraps `runScoring()` from `score.js`. The admin panel (`admin.html`) fires a fire-and-forget POST to it after every successful `applyAction` / `applyEdit`, so the public site reflects admin edits within a couple of seconds without waiting for the 10:00 UTC cron. Carry-forward in `score.js` (if no brand at the centre has `last_verified_date == today`, reuse yesterday's brand counts) keeps the rescore cheap and lets the state machine re-derive (e.g. a Peak rolls to Easing) without forcing the admin to re-verify a brand they already know is on sale, and preserves narratives on untouched centres.

**The rescore is fire-and-forget, but failures are surfaced** — `triggerRescore` raises a persistent error banner (`showRescoreWarn`/`clearRescoreWarn` in `admin.html`) when the POST returns non-OK or can't be reached, tailored to the cause (401/403 = expired admin session; 502 = scores updated but `tide_history` stale; other = full lag until the daily cron). The banner auto-clears on the next successful rescore. Previously a failed rescore left the admin with a success toast while the public store silently went stale. The safety net is the daily cron: `node score.js` (the CLI path) now calls `runScoring({ forceFresh: true })`, which **bypasses carry-forward and recomputes every centre from live brand state**. This self-heals any drift within 24h — a sale confirmed *after* the previous cron, or a silently-failed intraday rescore, would otherwise stay frozen forever, because the carry-forward gate keys off `last_verified_date == today` while "on sale" is also true via an `active_cycle_id` opened on a prior day. A fresh compute reads the same persistent on-sale state, so it matches carry-forward when nothing changed and corrects it when it has. `forceFresh` nulls narratives, but the summariser runs immediately after the scorer in the same workflow and repopulates them. The intraday rescore deliberately leaves `forceFresh` off. The **front-end also defends against this independently**: the 60-day chart's "today" point is anchored to the live headline value (`pctOnSale`), so the curve can never sit under QUIET while the headline reads PEAK even if the stored `tide_history` is momentarily stale (`buildTide60Series` takes `pctOnSale`).

**Required Vercel env vars** (Project Settings → Environment Variables — mirror the GitHub Actions secrets):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

`score.js` is now safe to import as a module — env-var checks and the supabase client are lazy, and the CLI entry is guarded by an `import.meta.url === file://…argv[1]` check so daily-cron behaviour is unchanged.

## Deployment
Vercel, output directory is `.` (repo root). No build command. Preview deployments available per branch.

**Supabase Edge Functions are NOT served by Vercel.** Merging to `main` ships the static site, but functions in `supabase/functions/` only update when the Supabase CLI redeploys them. `.github/workflows/deploy-functions.yml` does this automatically: any push to `main` touching `supabase/functions/**` redeploys the affected function (and there's a `workflow_dispatch` for manual runs). Requires repo secret `SUPABASE_ACCESS_TOKEN` (a PAT from supabase.com/dashboard/account/tokens); the project ref `vrezzwadwzrmumjpdgge` is the default, overridable via `SUPABASE_PROJECT_REF`.
