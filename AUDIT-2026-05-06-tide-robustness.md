# Tide robustness audit — May 2026

Status: complete. All six areas implemented in this branch.

This is the deliverable report for the audit. Every change is grouped by
area with file and line references. Migrations are listed in full near the
end. Anything still requiring manual action in the Supabase dashboard is in
the final section.

---

## 1. Code changes by area

### Area 1 — Scraper resilience (`scraper.js`, `brands.js`)

| Change | Location | Why |
|---|---|---|
| Audited `brands.js` for missing `renderMode`. All 60 auto-scraped brands have `renderMode` explicitly set to `'static'` (44) or `'browser'` (16). The 17 manual-check brands (`B078–B094`) deliberately have no `renderMode` because they are filtered out by `manualCheck: true` before either pass. | `brands.js` (whole file) | Ensures no auto brand is silently skipped by both passes. |
| Added startup validation `validateBrands()` that aborts with an explicit error if any `autoBrand` lacks a valid `renderMode`. | `scraper.js:60–69` | Future-proofs against a brand being added without `renderMode` — an undefined value would otherwise silently disqualify it from both passes and we'd never notice until the row went stale. |
| Per-brand `try/catch` inside both `requestHandler`s. A handler crash now lands the brand as `scrape_failed` and continues, instead of throwing through Crawlee and tearing down the whole crawler. | `scraper.js:184–193` (Cheerio), `scraper.js:240–252` (Playwright) | Single brand failure can no longer kill the whole run. |
| Run summary written to console (5 lines) and to `audit_log` (one row per run) with totals: attempted, succeeded, failed, on sale, not on sale, plus per-brand error detail. | `scraper.js:418–437`, `scraper.js:455–476` | Gives the operator a single source of truth for "what happened on this run". |
| Playwright crawler torn down inside a `finally` block; symmetric `try/finally` around CheerioCrawler too. | `scraper.js:163–224` (Cheerio), `scraper.js:226–294` (Playwright) | Closes leaked Chromium processes that have caused intermittent CI crashes ("Target page, context or browser has been closed"). |
| Retry with exponential backoff (1s, 2s, 4s) for HTTP/2 / `ERR_HTTP2_*` / connection-reset / timeout errors. Up to 3 attempts via Crawlee's `maxRequestRetries` plus a sleep in `errorHandler` for the transient class. | `scraper.js:34–46` (`RETRYABLE_ERROR_PATTERNS`), `scraper.js:267–276` (Playwright `errorHandler`) | Targets the FLANNELS-style HTTP/2 failures that have been one-shot bot-blocking the run. Non-transient errors are not delayed so they fail fast and free the slot. |
| Persistently failing brands recorded as `'scrape_failed'`. The Supabase write path then sets `scraper_error: true` and **leaves the existing `sale_status` untouched**, so a network failure does not appear on the dashboard as "this brand's sale ended". | `scraper.js:182–207` (`recordSuccess`/`recordFailure`/results enum), `scraper.js:332–356` (write path) | The instruction's literal text was "mark as `scrape_failed` not `not_on_sale`" — implemented as a third status in the in-process result store and a code path in `writeToSupabase` that preserves the prior `sale_status`. |
| Validation gate `validateRecord()` runs before every Supabase write. Rejects records where `brand_id` is unknown, status is not in `{on_sale, not_on_sale, scrape_failed}`, `sale_status` is not a strict boolean, or `last_checked` is not today's UTC date. Rejected rows log a clear error and are never written. | `scraper.js:316–328`, `scraper.js:386–391` | The "validation before every Supabase write" requirement from Area 2. |

### Area 2 — Data integrity (`brand_sale_events` writes)

| Change | Location | Why |
|---|---|---|
| Validation gate before every write (see Area 1 entry). | `scraper.js:316–328`, `scraper.js:386–391` | Bad records are now rejected with a logged reason, never written silently. |
| Created `enforce_date_first_detected_immutable()` trigger function and `trg_enforce_date_first_detected_immutable` BEFORE UPDATE trigger on `brand_sale_events`. Allowed transitions: NULL → date, date → NULL, date → same date. Any attempt to overwrite a non-NULL `date_first_detected` with a different non-NULL date now raises a clear DB-level exception. | `supabase/migrations/20260506_audit_log_and_constraints.sql:62–87` | Migration `20260504_reset_first_detected.sql` *referenced* this trigger but it was never actually defined in any migration — the column was protected only by a name. Closing that gap. |
| Existing schema for `brand_sale_events` is **one row per brand**, not one row per (brand, date). The scraper does `UPDATE … WHERE brand_id = ?`. The audit instruction's "on conflict (brand_id, date)" doesn't match reality, so the equivalent fix here is: (a) the immutable trigger above prevents `date_first_detected` from ever being overwritten, (b) the scraper's per-brand update only ever touches non-history columns when the row already has a valid `date_first_detected`, and (c) `reset_brand_sale_cycle` is the only path that clears `date_first_detected`. | n/a (existing schema design) | Documented for the maintainer record. |
| `sale_status` column is now `NOT NULL` with backfill. | `supabase/migrations/20260506_audit_log_and_constraints.sql:99–106` | Defence-in-depth alongside the application-level boolean validator. |
| `audit_log` row written at the end of every scraper run (including partial runs and crash-then-recover paths). | `scraper.js:455–476`, `scraper.js:478–522` | Per Area 2 last bullet. |

### Area 3 — Score pipeline resilience (`score.js`)

| Change | Location | Why |
|---|---|---|
| Pre-flight check `preflight()` aborts the run if `brand_sale_events` has no rows whose `last_checked >= TODAY 00:00 UTC`. A workflow_failure-class audit_log row is still written. | `score.js:117–137`, `score.js:393–405` | Prevents the historical foot-gun where a missed scraper run silently produced a batch of zeroed Tide scores and overwrote yesterday's correct values. |
| `calculateCentreScores()` and `calculatePersonalScores()` each have an outer `try/catch` plus inner per-centre / per-user `try/catch`. | `score.js:151–272` (centres), `score.js:307–391` (personals) | A single bad centre's data or one user's pref row cannot abort the batch. |
| `calculatePersonalScores()` is **only ever invoked after** `calculateCentreScores()` has finished, and any error from it is caught and logged but never propagates. Centre scores are the source of truth. | `score.js:393–443` (`main()`) | Hard requirement: personal scoring must never block centre scoring. |
| `audit_log` row written with `centres_scored`, `centres_failed`, `personal_scores_calculated`, `personal_scores_failed`, `run_duration_ms`, and any error summary. | `score.js:374–391` (`writeAuditLog`), `score.js:430–438` | Per Area 3 final bullet. |
| Score validation `validateScoreRow()` runs before pushing a row into the batch upsert. Rejects if `tide_score` is NaN, < 0, > 100, or `_stage` is not in `{Turning, Rising, High Tide, Falling, Low}`, or `score_date` is not today. | `score.js:140–155`, `score.js:226–235` | "tide_score must be 0–100, stage must be one of the six valid stages." (Note: implementation uses the five real stages — the spec's reference to "six" appears to be a typo. See section 3.) |

### Area 4 — Supabase RLS (single migration)

`supabase/migrations/20260506_consolidated_rls.sql` is the single source of
truth. Every Tide table is restated with its policies:

- `brand_sale_events`: anon/auth read; admin (`is_admin()`) update; no INSERT/DELETE for non-service roles.
- `brand_sale_cycles`: anon/auth read; admin-only writes.
- `centre_seer_scores`: anon/auth read; service-role-only write.
- `centres`: anon/auth read; service-role-only write.
- `centre_brands`: anon/auth read; service-role-only write.
- `brands`: anon/auth read; service-role-only write.
- `user_preferences`: owner-only on every operation (`auth.uid() = user_id`); REVOKE ALL FROM anon.
- `personal_tide_scores`: owner-only read (`auth.uid() = user_id`); service-role-only write.
- `community_signals`: anyone may INSERT; admin-only read/update/delete.
- `admin_review_log`: admin-only on every operation.
- `audit_log`: admin-only read; service-role-only write.

Every table has `ENABLE ROW LEVEL SECURITY` asserted in the same file.

### Area 5 — GitHub Actions

| Change | Location | Why |
|---|---|---|
| `timeout-minutes: 20` on `scrape` job, `timeout-minutes: 10` on `score` job. | `.github/workflows/daily-scrape.yml:38`, `:73` | Prevents hung Playwright runs from sitting on the runner indefinitely. |
| Existing `workflow_dispatch` trigger preserved + extended with a `job` input (choose `scrape`, `score`, or `both`) so an operator can manually re-run a single half. | `.github/workflows/daily-scrape.yml:21–30` | Was already present (good); now more useful. |
| Node version is `'24'` on both jobs (already correct — re-checked). | `.github/workflows/daily-scrape.yml:51`, `:81` | Node 18 EOL; 24 is the June 2026 floor. |
| New `notify_failure` job runs `if: always() && (… == 'failure' || … == 'cancelled')` and writes a `workflow_failure` row to `audit_log` via PostgREST + the service key, including a link back to the GitHub Actions run. | `.github/workflows/daily-scrape.yml:96–127` | Eliminates silent CI failures. The row shows up in `v_system_health` immediately. |
| The notify job uses a 5-minute timeout and `set -e`-friendly curl. The audit_log POST is best-effort: a failure to record a failure does not fail the workflow further. | `.github/workflows/daily-scrape.yml:115–127` | Defence-in-depth: never let observability collapse the run. |

### Area 6 — Admin observability

`v_system_health` view (in `supabase/migrations/20260506_v_system_health.sql`)
returns exactly one row covering:

- `last_scraper_run_date` / `last_scraper_run_at` / `last_scraper_status`
- `brands_scraped_yesterday`, `brands_succeeded_yesterday`, `brands_failed_yesterday`, `brands_on_sale_yesterday`
- `last_scorer_run_date` / `last_scorer_run_at` / `last_scorer_status`
- `centres_scored_yesterday`, `centres_failed_yesterday`, `personal_scores_calculated_yesterday`
- `workflow_failures_7d`, `pipeline_failures_7d`, `pipeline_partials_7d`
- `scraper_stale_today` / `scorer_stale_today` boolean flags (NULL or yesterday's date → `true`)
- `observed_at`

The view is `security_invoker = true` and inherits `audit_log`'s RLS, which
restricts read to `is_admin()` and the service role. Anon is explicitly
revoked.

The instruction wording "any RLS violations in the last 7 days" is best
served by the failure-counter columns above — Postgres does not log RLS
denials by default. To observe true RLS violations would require enabling
`pgaudit` or installing a logging extension, which is a Supabase
dashboard-side action (see section 4).

---

## 2. Migrations created

Three new migrations, all idempotent:

### `supabase/migrations/20260506_audit_log_and_constraints.sql`

- Creates `audit_log` table (run_type, run_date, status, scraper counters,
  scorer counters, error_summary, jsonb details, indexes on run_date,
  run_type, status). RLS enabled; admin-read policy; anon/auth REVOKE ALL.
- Creates `enforce_date_first_detected_immutable()` trigger function and
  `trg_enforce_date_first_detected_immutable` BEFORE UPDATE trigger on
  `brand_sale_events`.
- Backfills any NULL `sale_status` to `FALSE` and sets the column NOT NULL
  (wrapped in a `BEGIN/EXCEPTION/END` so a re-run on a DB where it's
  already NOT NULL is a no-op).

### `supabase/migrations/20260506_consolidated_rls.sql`

- One file, all RLS policies for every Tide table. See the table in Area 4
  for the matrix.

### `supabase/migrations/20260506_v_system_health.sql`

- Creates the `v_system_health` view with `security_invoker = true`.
- Grants SELECT to `authenticated` (gated by audit_log's admin RLS).
- Revokes from `anon`.

---

## 3. Anything that could not be implemented as instructed

1. **"on conflict (brand_id, date) do update sale_status only"** — the
   existing `brand_sale_events` schema is one row per brand, not one row
   per (brand, date). The scraper does `UPDATE … WHERE brand_id = ?`, so
   there is no compound conflict key to specify. The equivalent guarantee
   is provided by the immutable trigger plus the application-side write
   path. Changing the schema to per-day rows would be a much larger
   migration with downstream effects on the dashboard, score.js, and
   admin console; that's out of scope for this audit.

2. **"sale_status must be 'Y' or 'N'"** — the column is a Postgres
   `BOOLEAN`, not a `TEXT` enum. The validator enforces strict boolean
   typing (`typeof sale_status === 'boolean'`), which is the boolean
   equivalent of the spec's intent. Migrating to a Y/N text column would
   require coordinated changes across scraper, scorer, dashboard, and
   admin console — out of scope.

3. **"stage must be one of the six valid stages"** — `score.js` defines
   five stages: `Turning`, `Rising`, `High Tide`, `Falling`, `Low`. The
   spec's reference to "six" appears to be a typo or a stale spec. The
   validator therefore enforces the five real stages. If the sixth stage
   is meant to exist, it needs to be defined first in `score.js`'s
   `getTideStage()` map.

4. **"any RLS violations in the last 7 days"** — Postgres does not log RLS
   denials by default. The view exposes the closest available signals
   (workflow_failures_7d, pipeline_failures_7d, pipeline_partials_7d). True
   RLS-denial logging requires `pgaudit` or a custom logging shim; see
   section 4.

5. **The `audit_log` write from the GitHub Actions failure job** uses the
   PostgREST endpoint via `curl` rather than `@supabase/supabase-js` to
   keep the failure-recovery path dependency-free. If the workflow fails
   before `npm install` completes, we can still write the audit row.

---

## 4. Manual action still required in the Supabase dashboard

These migrations are written to be applied via the Supabase SQL editor or
CLI. Please do the following in order:

1. **Run the three new migrations**, in this order, in the SQL editor for
   project `vrezzwadwzrmumjpdgge`:
   - `20260506_audit_log_and_constraints.sql`
   - `20260506_consolidated_rls.sql`
   - `20260506_v_system_health.sql`

2. **Verify RLS state.** In the Supabase dashboard → Auth → Policies, spot-
   check that every table listed in Area 4 has the expected policies and
   that no extra "permissive any-anon" policies are still present from
   earlier exploratory work.

3. **Smoke-test `v_system_health`.** From the SQL editor with your admin
   account: `SELECT * FROM v_system_health;`. You should get one row.
   From an anon JWT (or no JWT) it should return no rows / 401.

4. **(Optional) Enable RLS-denial logging** if you want the
   `rls_violations_7d` signal the audit asked for in spirit. In Supabase
   Cloud, this means:
   - Project Settings → Database → Logs → enable `pgaudit` (or use the
     Reports → Database panel to track unauthorized request counts), or
   - Add a short-lived Edge Function that monitors `403`/`401` patterns
     in the PostgREST log and writes `audit_log` rows with
     `run_type = 'rls_violation'`. The view already has logic for any
     `audit_log` row, so the column would just need to be added.

5. **Verify `is_admin()` exists** before running `20260506_consolidated_rls.sql` —
   the policies depend on it. `is_admin()` is created by
   `20260504_add_admin_console_and_cycles.sql`. If a fresh DB is being
   provisioned, run that migration first.

6. **Confirm the GitHub Actions secret `SUPABASE_SERVICE_KEY`** is the
   service role key (not the anon key). The new `notify_failure` job needs
   it to bypass `audit_log` RLS.

---

## 5. Sanity-check commands run

- `node --check scraper.js && node --check score.js && node --check brands.js` → OK
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/daily-scrape.yml'))"` → OK
- All migration files lint clean and are idempotent (`IF NOT EXISTS`,
  `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` everywhere).
