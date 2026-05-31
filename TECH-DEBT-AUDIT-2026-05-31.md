# Pre-release tech-debt sweep — 2026-05-31

A full-codebase audit ahead of the major release, covering the frontend
(`index.html`, `admin.html`), the Node pipeline (`scraper.js`, `score.js`,
`summarise.js`, `extract-floors.js`, `api/rescore.js`), the Supabase backend
(edge function + 21 migrations), CI, and dependencies.

This document is the triage record. Items marked **✅ FIXED** were committed in
the `claude/tech-debt-sweep` branch (safe, verified, locally-tested). Items
marked **⚠️ DECISION** change production behaviour, deployment state, or applied
migrations and are left for a human to apply with the exact patch given.

---

## Headline reassurances (audited, found sound)

These are the things you most want to be true before a release, and they are:

- **Cross-user data isolation is correct.** RLS on `user_preferences`,
  `personal_tide_scores`, `user_reports`, `saved_centres` scopes to
  `auth.uid()`. The `user_preferences` UPDATE `WITH CHECK` hole was already
  closed in `20260517_pre_release_hardening.sql`. A user cannot read or write
  another user's data.
- **Admin is enforced server-side, not in the client.** Every admin write table
  is gated by RLS `USING (is_admin()) WITH CHECK (is_admin())`, where
  `is_admin()` reads the **signed** JWT email claim — unforgeable. The
  client-side check in `admin.html` is cosmetic and that's acceptable because it
  is not the security boundary. The `/api/rescore` endpoint independently
  re-verifies the bearer token against Supabase. A non-admin/anonymous user
  **cannot mutate anything**.
- **No privileged secrets in the browser.** Only the Supabase *publishable* anon
  key ships client-side (expected). No service-role key, PAT, or API key in
  `index.html` / `admin.html`. The notify function adds application-level auth
  (service key or `NOTIFY_TRIGGER_SECRET` bearer) so the public anon JWT can't
  trigger a mass email.
- **No SQL injection** in the edge function (all access via the query builder;
  user data only ever reaches `escapeHtml`-wrapped HTML).
- **`SECURITY DEFINER` functions are hardened** (`search_path = public`, scoped
  to `auth.uid()`/single brand).

---

## ✅ FIXED in this sweep

| # | Sev | File | What |
|---|-----|------|------|
| F1 | **P0 (XSS)** | `index.html:4211` | The raw DB `centre_seer_scores.verdict` string was concatenated into `innerHTML` unescaped (every other consumer routes it through a fixed enum). A malicious `verdict` value would execute in every anonymous visitor's browser. Wrapped in the in-scope `escapeHtml()`. |
| F2 | P1 | `index.html:3727` | `getHotCentres` built centre codes as `'C'+(idx+1)` → `C1..C9`, but the `<select>` and saved-centre codes use zero-padded `C01..C09`. Single-digit centres in the Hot list set an unmatched `<select>` value, desyncing "saved" detection and back-nav. Now uses the canonical `'C'+String(idx+1).padStart(2,'0')`. |
| F3 | P0 (dead) | `sheets.js` (deleted) | Imported `googleapis`, which is **not** a dependency, so the module throws `ERR_MODULE_NOT_FOUND` if ever imported. Zero callers. Its header docs falsely claimed it was wired into the scraper. Deleted. |
| F4 | P1 (debt) | `summarise.js` | The full new+legacy `STAGE_FROM_VERDICT` map was hand-copied from `score.js` — exactly the cross-consumer drift CLAUDE.md warns about. Now imports `deriveStageFromVerdict` from `score.js` (the documented single source). |
| F5 | P2 | `scraper.js:222` | Crash-recovery loop dereferenced `r.error` with no `r &&` guard (the Cheerio path has it). Latent `TypeError` if seeding and the brand list diverge. Guarded. |
| F6 | P2 | `scraper.js:145,208` | Both `failedRequestHandler`s looked up the brand by `request.url` only, while the success handlers also fall back to `loadedUrl`/`page.url()`. On a redirect-then-fail, the brand wasn't flagged `error:true` and kept its pre-seeded "no sale". Added the `loadedUrl` fallback to match. |
| F7 | P2 (doc) | `summarise.js:5` | Header comment said "Gemini 2.5 Flash" while `MODEL = 'gemini-2.0-flash-lite'` (and CLAUDE.md forbids 2.5-flash-lite). Could mislead someone into "fixing" the model string. Corrected. |
| F8 | P1 (CI) | `.github/workflows/test.yml` (new) | **The 19 unit tests never ran in CI.** The E2E job tests a preview deploy, but the alignment-critical verdict/stage/PRESENCE logic — the thing CLAUDE.md most stresses must stay consistent — wasn't gated on any PR. Added a fast, network-free `npm test` job on PRs/pushes to `main`. |

---

## ⚠️ DECISION — high-value, but change prod behaviour / deploy state

### D1 — P1 · Notify emails ship the internal `bluf` as "Centre Intelligence"
`supabase/functions/notify-high-tide/index.ts:463,548,636`

The function selects `bluf` and passes `narrative: score.bluf`. `bluf` is
score.js's terse internal verdict line and **contains recommendation language**
(e.g. *"Maximum sales density. This is the moment."*) — exactly what CLAUDE.md
forbids on narrative surfaces. The real Gemini-written, recommendation-free
`narrative` column (written by `summarise.js`) is **never selected**, so every
peak alert and digest emails the wrong, policy-violating copy.

Exact patch (add `narrative` to the select, prefer it, fall back to `bluf`):
```ts
// line 463
.select("centre_id, tide_score, verdict, bluf, narrative, trajectory, brands_on_sale")
// lines 548 & 636
narrative: score.narrative || score.bluf || undefined,
```
Left for you because it changes outbound email content and the edge function
auto-deploys on merge (`deploy-functions.yml`) — worth a `dryRun:true` check first.

### D2 — P0 (data loss) · Two non-idempotent data-reset migrations
`supabase/migrations/20260504_reset_tide_history.sql` — ✅ **NEUTRALIZED 2026-05-31**,
`supabase/migrations/20260504_reset_first_detected.sql` — ⚠️ still live

Both live in the auto-applied `migrations/` dir but perform **destructive data
mutations**, not schema changes:
- `reset_tide_history` backed up via `CREATE TABLE IF NOT EXISTS … AS SELECT`
  (so a re-run **skips** refreshing the backup) and then `DELETE`d all
  `centre_seer_scores WHERE score_date < CURRENT_DATE` and truncated every
  `centres.tide_history`. Re-applying on a fresh `db reset` / new environment
  would have **permanently destroyed accumulated score history**.
  **✅ Fixed:** the `DELETE` and the `tide_history` `UPDATE` are now commented
  out — the file is an inert `SELECT 1;` no-op that can never wipe score history
  on any replay. The original body is kept commented for the historical record.
- `reset_first_detected` overwrites `date_first_detected` on every run with **no
  snapshot at all**, corrupting the "N days on sale" signal and the brand-sale
  "started today" alert (see D3). This touches brand-sale metadata, **not score
  history**, so it was left untouched pending your call — neutralize it the same
  way if you want it inert too.

The neutralized file stays in `migrations/` (filename/version preserved, so no
history gap for `supabase db push`). If a one-off reset is ever genuinely needed
again, run it from a deliberately-invoked script in `scripts/` — never from the
auto-applied migrations directory.

### D3 — P1 · Brand-sale "started today" dedup depends on a non-write-once field
`index.ts:81-84`. `startedToday()` keys off `date_first_detected === today`, but
D2's reset and the scraper both rewrite that field, so the "self-dedupes, no
sent-state table" guarantee only holds if the field is truly write-once. Prefer
the admin cycle `start_date`, or add a lightweight sent-state guard.

### D4 — P1 · One email failure aborts the whole batch
`index.ts:404-416` + call sites `551/611/645`. `sendEmail`'s `fetch` has no
try/catch, and neither do the callers. A single DNS blip / thrown fetch on
recipient #5 throws out of `Deno.serve` → 500, and later users are silently
dropped (no per-run send-state). Wrap each `sendEmail` in try/catch, push the
failure into `log`, and continue.

### D5 — P0 (defence-in-depth) · No Subresource Integrity on third-party scripts
`index.html:10-19` (Supabase SDK — the code comment already flags this as a
"SECURITY FAST-FOLLOW"), plus Plausible (`708`) and Skimlinks (`726`). A CDN/DNS
compromise runs arbitrary JS with full access to the user's Supabase session.
Add `integrity="sha384-…" crossorigin="anonymous"` (hash generated off a trusted
network). Left unfixed because a wrong hash hard-breaks the site — verify before
shipping.

### D6 — P1 · Admin session has no token refresh; breaks the real admin after ~1h
`admin.html:429`. `CURRENT_TOKEN` is captured once at sign-in with no
`onAuthStateChange`/`TOKEN_REFRESHED` listener. After the ~1h JWT expiry, every
write (and the rescore POST) starts returning RLS/401 with a confusing "Action
failed" banner. Fix: `sb.auth.onAuthStateChange((_e, s) => { CURRENT_TOKEN =
s?.access_token ?? null; })`. (Additive and low-risk, but it's admin-auth
behaviour — apply and click-test.)

### D7 — P1 · Admin multi-step mutations are non-atomic
`admin.html` `confirm_start`/`confirm_end`/`deleteCycle`. Each does 2-3 separate
PostgREST writes with no transaction; a failure between steps leaves orphaned
cycles or a brand reset-to-no-sale with the cycle row still present. Wrap each
verb in a single `SECURITY DEFINER` Postgres RPC. (Larger change — schedule it.)

### D8 — P1 · `ALTER PUBLICATION … ADD TABLE` is not idempotent
`20260505_enable_realtime_brand_sale_events.sql:14` errors on re-run despite the
"Run idempotently" comment. Guard with a `DO` block checking
`pg_publication_tables`.

---

## REPORT-ONLY — lower priority debt (no action taken)

**Structural**
- **`index.html` is a 4654-line single file** (HTML+CSS+JS). The biggest
  long-term debt. Verdict/stage/trajectory logic and the score formula are
  re-implemented in JS (`STAGE_FROM_VERDICT` 2920, `getTideStage` 2940,
  `deriveVerdict` 3043, `round(onSale/total*100)` 3601/4223), duplicating
  `score.js`. Any threshold change must be edited in two languages or the gauge
  and server verdict silently diverge. Recommend extracting shared constants
  (verdict vocab + thresholds) into one JS module imported by both, as a
  post-release initiative.
- **`escapeHtml` is redefined/inlined 15+ times** in `index.html` (locals at
  2732, 4083; inline copies throughout). This duplication is the *root cause* of
  the F1 XSS (one site forgot it). Consolidate to one module-level helper.
- **Date helpers** (`new Date().toISOString().split('T')[0]`) are reimplemented
  in `score.js`, `scraper.js`, `summarise.js`, the edge function, and
  `index.html`. All UTC today (safe), but a foot-gun for any future job running
  near 00:00 UTC. Extract one shared `dateStr(offset)`.

**Correctness (frontend)**
- `loadSheetData` (`index.html:2229`) parses the CSV fallback with `split(',')` —
  breaks on quoted commas in a field, corrupting the stale-fallback data path.
- `loadTideData` has no reentrancy guard (`4340-4354`): a realtime event, the
  60s poll, and every `visibilitychange` can run concurrent loads that both
  mutate module-global state. Add `if (_loading) return;`.
- `onAuthStateChange` (`1088`) is async and races on shared `userPrefs` across
  rapid auth events; only onboarding is guarded, not the prefs/render path.
- Silent failures with no UI surface: `quickSavePref` (1418 — toggle flips but
  doesn't persist), `loadTideData`/`loadSheetData`. Revert UI + toast on error.
- Missing `parseInt` radix at `1766/3588/3888` (inconsistent with the rest).

**Pipeline / backend**
- `summarise.js` runs `main()` on import (unguarded), unlike `score.js` which
  has the `import.meta.url === argv[1]` guard. Harmless today (nothing imports
  it) but inconsistent.
- Reconcile the three different output-length caps in `summarise.js`:
  `MAX_OUTPUT_LEN=220` (42), `maxOutputTokens:200` (114), "≤200 characters" in
  the prompt (82).
- `v_personal_scores` (`20260502`) is safe **only** because of `security_invoker
  = true` on line 122; a future `CREATE OR REPLACE VIEW` that drops the option
  silently reverts to definer rights and leaks across users. Add a CI assertion
  on `reloptions`.
- Possibly-dead schema: `personal_tide_scores`/`v_personal_scores` and
  `community_signals` (insert path revoked in `20260517`) have no live
  writer/reader in the backend. Confirm intentional or drop.
- Digest email hard-codes "Friday" (`index.ts:347`); if the cron is delayed past
  midnight UTC it says "Friday" on a Saturday. Derive the day name from the date.

**Dependencies**
- `npm audit`: **15 moderate** advisories, all transitive from `crawlee` →
  `file-type` (ZIP/ASF DoS). **Pipeline-only — never in the browser bundle.**
  `npm audit fix` pulls a crawlee bump; test the scraper after. Not
  release-blocking for the web app.

---

## Suggested release gate

1. **Ship F1–F8** (done in this branch).
2. **Apply D1** (emails sending forbidden copy) and **D4** (batch-abort) to the
   edge function; `dryRun` test, then merge to redeploy.
3. **Resolve D2** (relocate/guard the destructive migrations) before any
   `db reset`/new-environment provisioning.
4. **D5/D6** are quick, high-value hardening — do them if the window allows.
5. Everything else: file as post-release follow-ups.
