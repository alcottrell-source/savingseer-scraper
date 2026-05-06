# Tide — full architecture & data-flow audit (May 2026)

This is a read-only audit of the entire Tide application — the scraper
pipeline, the scorer pipeline, the admin console, the public dashboard, the
edge function, and the supporting Supabase schema. No code was changed in
this audit; bugs are listed for later fix.

The audit answers a specific question raised by the user:

> When I update the admin panel with updated scores, will they update
> into the app correctly every time, every time, with confidence?

**Short answer: not yet.** Admin updates flow into the on-sale chips on the
dashboard within seconds (correct), but they do **not** flow into the
headline Tide Score, verdict, BLUF, gauge stage, or trajectory until the
next scheduled scorer run at 08:00 UTC the following morning. That's bug #1
below and the most important thing to fix.

The rest of this document is the underlying audit. Severity scale:
P0 = breaks core promise, P1 = visible defect, P2 = data drift / fragility,
P3 = minor / cosmetic.

---

## 1. Schema truth table — who writes what, who reads what

| Table | Column | Written by | Read by | Notes |
|---|---|---|---|---|
| **brands** | id, name, cluster, womenswear, menswear, childrenswear, sale_url | `seed.js` (manual run) | score.js, notify-high-tide, admin.html (via brands.js import), index.html (parallel inline copy — see §2.4) | Source of truth for brand metadata. **Only synced from brands.js by manual `node seed.js`** — no automation. |
| **centre_brands** | centre_id, brand_id, present | manual SQL only | score.js, notify-high-tide | Determines which brands count toward each centre's Tide Score. **No code path writes this.** It must be hand-curated in SQL. The dashboard does NOT use this; it uses the inline `PRESENCE` matrix in index.html (§2.4). |
| **centres** | id, name, active, tide_history (jsonb) | score.js writes tide_history; `active`/`name` manual | index.html, admin.html, notify-high-tide | tide_history is a denormalised cache of the last 60 days' scores rebuilt by score.js. |
| **brand_sale_events** | brand_id (PK), sale_status, max_discount_pct, scraper_error, last_checked, date_first_detected, last_verified_status, last_verified_date, active_cycle_id, community_thumbs_up/down, updated_at | scraper.js writes the scraper columns; admin.html writes the verified+cycle columns; reset_brand_sale_cycle() RPC clears them | score.js, notify-high-tide, index.html, admin.html | **One row per brand, not per (brand, date)** — current state only. |
| **brand_sale_cycles** | id, brand_id, start_date, end_date, max_discount_pct, source, confidence_count, notes, created/updated_at | admin.html (via `applyAction confirm_start` / `applyEdit`); reset_brand_sale_cycle() closes cycles | score.js (joined via active_cycle_id), index.html, admin.html, notify-high-tide | Verified, human-confirmed sale periods. The "source of truth" for ripeness once an admin opens a cycle. |
| **centre_seer_scores** | centre_id, score_date (compound PK), tide_score, phase, verdict, bluf, trajectory, brands_on_sale, total_brands, top_brands, avg_discount_pct | **score.js only** (08:00 UTC daily) | index.html (the headline), notify-high-tide | Once-per-day rows. **Admin updates do not refresh this table.** |
| **personal_tide_scores** | user_id, centre_id, score_date (compound PK), personal_tide_score, matching_brands, matching_on_sale, verdict | **score.js only** | v_personal_scores view (queryable by users) | Same once-per-day cadence. |
| **user_preferences** | user_id (PK), preferred_centre_id, womenswear, menswear, childrenswear, style_clusters[], saved_centres[], email_alerts, daily_digest, created/updated_at | index.html (own row only, RLS-gated) | score.js, notify-high-tide, index.html | Owner-only RLS enforced. |
| **community_signals** | brand_id, signal_type, discount_pct, source, user_hash | index.html (anyone can INSERT via RLS — but no UI calls this) | nothing reads it programmatically | Dead column-set. There is no INSERT code path in index.html or admin.html that hits this table. The migration creates it but no UI uses it. P2 — dead infrastructure. |
| **admin_review_log** | brand_id, reviewed_date, action, cycle_id, notes | admin.html on every action | admin.html only | Used to derive "Confirmed today" list. |
| **audit_log** *(new)* | run_type, run_date, status, counters, details | scraper.js, score.js, GitHub Actions notify_failure | v_system_health view | Created by the May 2026 audit. |

**Tables that exist but have no read path in client code** (P3 dead-ish):
`community_signals` (write-only by virtue of no reader), `record_brand_thumbs()` RPC (no caller).

---

## 2. Bugs found, by severity

### P0 — admin updates do not refresh the headline Tide Score

**Where:** dashboard reads `centre_seer_scores.tide_score / verdict / bluf /
trajectory` (index.html:1732–1748). That row is only ever written by
score.js (score.js:243–249, 08:00 UTC). admin.html writes `brand_sale_events`
and `brand_sale_cycles`, never `centre_seer_scores`.

**Effect:** the user clicks "Confirm sale started" on FLANNELS at 14:00. The
brand chip on the FLANNELS row updates to "On sale · Day 1" within seconds
via realtime (correct). But the centre headline "Tide Score 42 · Worth
watching" stays at 42 for the rest of the day, even though the underlying
"brands on sale" count changed. The score, verdict, BLUF, and gauge needle
will update at the next 08:00 UTC scorer run.

**Why it's been hidden so far:** index.html has a local fallback
`calcCentreScore()` (line 1508) that recomputes the score in-browser, but
it's only used when `serverScore` is missing (line 1732). On a normal day
serverScore exists, so the stale value is what users see.

**Fix options (not in this audit):**
- A. After every admin write, call a Supabase RPC that recomputes
  `centre_seer_scores` for affected centres on the spot.
- B. Stop reading `centre_seer_scores.tide_score` for the live view; always
  recompute from `brand_sale_events + brand_sale_cycles` in-browser, and
  use `centre_seer_scores` only for history/sparklines and the email job.
- C. Have the admin console write to a "score override" table that the
  dashboard prefers.

Option B is the cleanest and matches what the dashboard already does for
the brand chips and `MAX_DISCOUNT_PCT`. The score formula is already in
both score.js and index.html (see §6 for divergence risk).

---

### P0 — notify-high-tide is scheduled before score.js writes today's row

**Where:** `supabase/functions/notify-high-tide/README.md:98–112` schedules
the cron at `'0 7 * * *'` (07:00 UTC). The function reads
`centre_seer_scores WHERE score_date = today` (index.ts:237–239, line 233's
`const today = ...`). score.js writes today's row at 08:00 UTC (one hour
later, after this function runs).

**Effect:** at 07:00 today, today's score rows do not exist yet. The query
returns an empty array. `highTideCentres = scores.filter(...)` → empty. **No
alerts are sent. No digests are sent.** The function returns
`{ alertsSent: 0, digestsSent: 0 }` every day.

**Self-contradiction in the README:** the same paragraph says "set the cron
_after_ the scorer so today's `centre_seer_scores` row exists by the time we
read it", but the example cron is set BEFORE the scorer.

**Fix (not in this audit):** schedule notify-high-tide at, say, `'30 8 * *
*'` (08:30 UTC, after the score job has had time to finish). Or, if the
GitHub Actions workflow finishes earlier than the cron expects, gate the
function on "today's score row exists" and have it bail with a clear log
otherwise.

---

### P1 — 12 scraped brands are silently dropped on the dashboard

**Where:** `index.html:1240–1265` `DASHBOARD_NAME_BY_SCRAPER_ID`. The
dashboard's brand state is keyed by name and resolved via this lookup. Any
scraper-id missing from this map has its scrape result thrown away
(`if (!name) continue;` index.html:997).

**Missing IDs (in brands.js but absent from the dashboard map):**
- B017 Weekday
- B018 Monki
- B030 Cath Kidston
- B036 Coast
- B056 Patagonia
- B058 Craghoppers
- B060 Mountain Warehouse
- B067 UGG
- B069 New Balance
- B072 Fossil
- B074 Radley
- B076 Lush

**Effect:** the scraper hits these sites every morning and writes their
`sale_status` to the DB, but the dashboard never displays them. They're
invisible to users. Wasted scraping.

**Fix (later):** add the missing entries to `DASHBOARD_NAME_BY_SCRAPER_ID`,
or — better — kill the dual-id scheme entirely (see §6).

---

### P1 — `brands.cluster` definitions disagree between sources

**Where:**
- brands.js — H&M is `'Contemporary'`, Patagonia is `'Active'`, Hugo Boss
  is `'Premium Casual'`, Phase Eight is `'Smart/Occasion'`, …
- index.html inline `BRANDS` (line 1267–1345) — H&M is `'High Street'`,
  Hugo Boss is `'Premium Casual'`, Phase Eight is `'Smart/Occasion'`, …

**Examples that differ:**
| Brand | brands.js (DB seed) | index.html inline | Effect |
|---|---|---|---|
| H&M | Contemporary | High Street | If a user selects "Contemporary" only, H&M is excluded by index.html's local personal-score calc but included by score.js's. |
| Bravissimo (B032 inline) | Accessories (brands.js B081) | Classic British (inline) | Cluster filtering disagrees. |

**Effect:** "Personal score" computed in-browser for the prefs preview and
the no-server-score fallback uses one cluster; "Personal score" written by
score.js to `personal_tide_scores` uses another. A user with a single
cluster filter will see different "matching brand" counts in the preview
vs. the saved score.

**Fix (later):** make brands.js the single source. Have index.html load
`brands` rows from Supabase on boot instead of carrying its own inline
copy. (Or generate the inline copy at deploy time from brands.js.)

---

### P1 — PRESENCE matrix in dashboard ≠ centre_brands in DB

**Where:** dashboard uses inline `PRESENCE[brandId]` matrix (index.html:
1347–1433) for "which brands are at this centre". Score.js and the edge
function use the `centre_brands` SQL table.

These two presence sources are completely separate. The dashboard uses the
inline matrix to render brand chips and to fall back when serverScore is
missing. score.js's tide_score is computed against `centre_brands`. They
will drift the moment someone touches one without touching the other (and
nothing flags the drift).

**Effect:** a brand may show as "at this centre" in the dashboard chip
list but not contribute to the centre's score (or vice versa). Users see
inconsistent narratives.

**Fix (later):** delete inline `PRESENCE`. Have the dashboard load
`centre_brands` from Supabase like everything else.

---

### P1 — Anchor brand IDs disagree between scorer and dashboard

**Where:**
- score.js: `['B001', 'B002', 'B003', 'B011', 'B012']` (5 anchors, in
  scraper id-space: Next, M&S, River Island, Zara, H&M).
- admin.html: same five (uses scraper id-space).
- index.html: `['B001','B002','B003','B005','B013','B023']` (6 anchors, in
  the inline id-space: Marks & Spencer, Next, H&M, River Island, Zara,
  Uniqlo).

**Effect:** Uniqlo (B093 in brands.js, manual-check) is treated as an
anchor in the dashboard's local fallback but not in score.js's authoritative
calculation. Server score and local fallback disagree about whether Uniqlo
should be ×1.5-weighted.

**Note:** the score.js comment at line 25-27 says "Uniqlo is in the spec
but not yet in brands.js". Uniqlo IS in brands.js now (B093). The comment is
stale; the anchor set in score.js needs Uniqlo added to match the spec.

---

### P1 — Admin "access check" probe is broken under RLS

**Where:** admin.html:364–377. The probe is:

```js
const [probeRes] = await Promise.all([
  pg.read('admin_review_log?select=id&limit=1'),
  ...
]);
if (probeRes.error) { showStatus('Admin access check failed …', true); }
```

`admin_review_log` has `is_admin()`-only SELECT policy. A non-admin
authenticated user querying it gets a **200 OK with an empty array**, NOT
an error. RLS filters rows silently. So `probeRes.error` is null for
non-admins and the "Admin access check failed" warning never fires.

**Effect:** a regular signed-in user who navigates to `/admin` is shown the
full UI with all brands. They click "Confirm on sale" and it fails with a
401/403 from the WRITE — at which point they get an error toast. Confusing
UX, not a security problem (writes are blocked correctly).

**Fix (later):** make the probe a write-style operation, or call the RPC
`is_admin()` directly which returns a boolean.

---

### P1 — auto-saving `saved_centres` on every centre selection writes
without filtering existing values

**Where:** index.html:821–834 `saveCentreToUserPrefs`. It reads
`userPrefs.saved_centres`, appends the new id, and upserts the array. If
two simultaneous tabs both add a different centre, the second write wins
and overwrites the first's addition. Last-write-wins is OK in practice but
worth flagging — there's no DB-side merge.

Also: this function calls `loadUserPrefs()` if `userPrefs` is null. If the
user has prefs but loadUserPrefs hasn't completed yet (race on first paint
when realtime fires before auth state has stabilised), we could write a
full row with NOT NULL DEFAULT FALSE for `womenswear/menswear/childrenswear`
even though the user has them set TRUE in the DB. Effect: silently
overwriting prefs to all-false. This is a **probable real bug** if two
tabs are open during sign-in.

P1, but only manifests on first auth.

---

### P1 — Realtime fires only on `brand_sale_events`, not on cycles

**Where:** index.html:1886–1891. Subscribes to `postgres_changes` on
`public.brand_sale_events`. `brand_sale_cycles` is **not** subscribed.

In practice this is OK because every admin action that touches a cycle ALSO
updates `brand_sale_events` (see admin.html:699–724, 768–771). The
brand_sale_events update fires realtime and the dashboard re-reads cycles
during `loadTideData`. So the chain works.

**But:** if any future admin path writes a cycle without touching
brand_sale_events, the dashboard won't notice. Also, `centre_seer_scores`
is not subscribed — see P0 #1.

**Fix (later):** also subscribe to `brand_sale_cycles` and (after the P0 #1
fix) `centre_seer_scores`. Or: just always re-read after a window-focus
event, and drop the polling.

---

### P2 — CSV fallback (`loadSheetData`) is stale legacy data

**Where:** index.html:1134–1177 + 951 (`SHEET_CSV_URL`). If
`loadTideData()` returns false (Supabase load failure), the dashboard
falls back to a Google Sheets CSV. scraper.js no longer writes to that
sheet (sheets.js exists but isn't called from scraper.js — see §3). The
CSV is whatever was last written to it, possibly weeks/months ago.

**Effect:** during a Supabase outage, users see stale sale data presented
as live with today's date label. Probably worse than showing an error.

**Fix (later):** delete the Sheets CSV fallback path entirely. Show a
graceful "we can't load the latest data right now, try again in a moment"
state. Also delete sheets.js.

---

### P2 — Polling every 15 seconds + realtime is overkill

**Where:** index.html:1892 `setInterval(() => loadTideData(), 15000)`.
With realtime active this is belt-and-braces, but 15s × 30 centres × every
user × every open tab = a lot of unnecessary read traffic. 60s would be
plenty as a fallback for missed realtime events.

P2 — cost / unnecessary load.

---

### P2 — `quickSavePref` doesn't update the toggle UI on failure

**Where:** index.html:757–767. If the upsert fails (e.g., RLS misconfigured
on `user_preferences` UPDATE), the toggle visually flips but the DB row
doesn't change. Reload → toggle reverts. Confusing UX with no error
indication.

---

### P2 — `notify-high-tide` resolves user emails one-at-a-time

**Where:** edge fn index.ts:268–274 — `for (const uid of userIds) { …
sb.auth.admin.getUserById(uid); }`. N round-trips to the auth admin API.

For 100 users this is ~100 sequential API calls, several seconds. Won't
scale. Could be one `auth.admin.listUsers()` call filtered, or paginated.

P2 — performance, will become P1 around N=500 users.

---

### P2 — `community_signals` table & `record_brand_thumbs` RPC are dead

**Where:** migration `20260504_add_admin_console_and_cycles.sql:65–104` /
:159–178. Created with full RLS, indexes, and a SECURITY DEFINER function.
Neither index.html nor admin.html calls them. No UI surfaces thumbs feedback.

**Effect:** zero. P2 dead infrastructure, mentioned for inventory.

---

### P2 — `is_admin()` is a single hard-coded email

**Where:** migration `20260504_add_admin_console_and_cycles.sql:15–18` —
returns true only for `alcottrell@gmail.com`. Every admin RLS policy keys
off this. To add a second admin you must alter the function. To disable
admin access during a security incident you must alter the function. There
is no admin_users table.

P2 — operational fragility, not wrong but inflexible.

---

### P2 — `BRANDS` inline array is a parallel id space and gender-flag spec
of brands

**Where:** index.html:1267–1345 redefines all 77 brands with a different id
order, sometimes different gender flags, and (as noted in P1 above)
sometimes different cluster assignments. Maintenance burden: every brand
change in brands.js needs a manual mirror to index.html.

This drives multiple of the P1 bugs above. The fix is to delete the inline
copy and load brands from Supabase on boot.

---

### P2 — `BRAND_URL_BY_NAME` map (index.html:1182–1231) is a third copy of
brand metadata

Same as above. Sale URLs are also in brands.js (`url:` field). Two copies,
no automation to keep them in sync.

---

### P2 — `John Lewis` PRESENCE row is "best guess as of May 2026"

**Where:** index.html:1424–1432 — comment explicitly says "USER SHOULD
REVIEW". Hasn't been reviewed. May produce wrong score if John Lewis is
present at centres flagged 0, or absent from centres flagged 1.

P2 — data correctness.

---

### P3 — `score.js` Uniqlo anchor comment is stale

(Already covered in P1 above; calling out as a docs bug too.)

---

### P3 — `vercel.json` rewrite for `admin.tidego.co` host but tidego.co
DNS is not yet pointed at Vercel

**Where:** vercel.json:8 — host-based rewrite for `admin.tidego.co`. The
README for the edge function (line 46–49) says tidego.co DNS isn't yet
pointed at Vercel. So the admin host rewrite is set up but not used today.
P3 — pending operational cutover, not a bug.

---

### P3 — `Cache-Control: max-age=0, must-revalidate` on index.html, admin.html, brands.js

This is correct (these are user-facing entrypoints). Just confirming for
the audit.

---

### P3 — `feedback-bar` inserts a Google Forms link and uses
`localStorage.setItem('fb-dismissed','1')` with no namespace prefix

`fb-dismissed` could collide with other tools using `localStorage`. The
project's other flags namespace as `tide_*`. Consistency. P3.

---

### P3 — `hideNotifyBanner()` is called inside the auth-state handler but
doesn't clear `tide_pending_save_centre` if the user *cancels* the magic
link

If user enters an email in the notify banner, hits "Notify me", then
abandons the flow, `tide_pending_save_centre` stays in localStorage. The
next time they sign in (different account, or accidentally), that centre
is auto-saved to their `saved_centres`. P3 minor leakage.

---

## 3. Admin → app data-flow trace (the central question)

Every button in admin.html, what it writes, and what surfaces in the app:

| Admin action | DB writes | Dashboard surface |
|---|---|---|
| **Confirm on sale** (no cycle) | `brand_sale_cycles` INSERT (start_date, max_discount_pct, source='admin'); `brand_sale_events` UPDATE (active_cycle_id, last_verified_status=true, last_verified_date=today); `admin_review_log` upsert | ✅ chip flips to "On sale · Day 1 · Up to N%" within ~1s via realtime. ❌ headline tide_score / verdict / bluf / stage gauge unchanged until 08:00 UTC tomorrow. |
| **Sale ended** (cycle exists) | `brand_sale_cycles` UPDATE end_date; `brand_sale_events` UPDATE (active_cycle_id=null, last_verified_status=false, last_verified_date=today); `admin_review_log` upsert | ✅ chip flips to "No sale" within ~1s. ❌ headline unchanged until tomorrow. |
| **Still on** | `brand_sale_events` UPDATE (last_verified_status=true, last_verified_date=today); `admin_review_log` upsert | No visible change (was already on). Confirmed-today section moves the row. |
| **Confirm no sale** | `brand_sale_events` UPDATE (last_verified_status=false, last_verified_date=today); `admin_review_log` upsert | ✅ chip flips to "No sale". ❌ headline unchanged. |
| **Dismiss** | `admin_review_log` upsert only | No state change. Row leaves "Needs review". |
| **Edit cycle** | `brand_sale_cycles` UPDATE (start_date, max_discount_pct); `brand_sale_events` UPDATE (max_discount_pct, last_verified_date); `admin_review_log` upsert | ✅ "Up to N%" chip updates. ✅ "day X" count updates if start_date changed. ❌ headline unchanged. |

The realtime channel (`postgres_changes` on `brand_sale_events`) is what
drives the ~1-second update for chip-level state. The 60-second polling
fallback would catch any missed events. **The headline-score lag is the
P0 bug — it cannot be fixed without either recomputing centre_seer_scores
on each admin write, or moving the dashboard's "live" score off
centre_seer_scores entirely.**

---

## 4. Public read paths

`loadTideData()` (index.html:957–1034) issues four parallel reads:

1. `centres?select=id,name,tide_history&active=eq.true&order=id`
2. `brand_sale_events?select=brand_id,sale_status,date_first_detected,max_discount_pct,scraper_error,last_verified_status,last_verified_date,active_cycle_id`
3. `brand_sale_cycles?select=id,start_date,max_discount_pct&end_date=is.null`
4. `centre_seer_scores?select=…&score_date=eq.<today>`

It joins (2) and (3) in JS, applies the precedence rule
(active_cycle_id > last_verified_date > sale_status), and produces three
keyed-by-name maps: `SALE_STATUS`, `MAX_DISCOUNT_PCT`, `DAYS_RUNNING`.

`renderCentre(centreId)` uses those maps + the inline `PRESENCE` and
`BRANDS` arrays + `CENTRE_SCORES[centreId]` (the server's tide_score) to
render the page.

Every 15 seconds + on every realtime event, this is re-run.

**Failure modes observed:**
- If (2) returns 0 rows (RLS block on anon), an explicit `console.error`
  fires (line 990). UX falls through to the empty state silently.
- If (4) returns 0 rows for today (scorer hasn't run / failed), the
  dashboard uses `csvScore` (the local fallback) — but that's only
  populated if `loadSheetData` succeeded. So either way, the user sees
  *some* score; whether it's accurate depends on which fallback fired.

---

## 5. Auth + RLS effective-policy review

Auth flows:
- **Sign-up** (index.html:711–725): `sb.auth.signUp({ email, password })`.
  Supabase email confirmation is enabled (sign-up returns no session →
  step shows "check your inbox"). After link clickthrough, an
  `INITIAL_SESSION` event hits `onAuthStateChange` and the prefs modal
  opens (desktop only, once per user, gated by localStorage flag).
- **Sign-in**: password or magic link.
- **Sign-out**: `sb.auth.signOut()`.

RLS effective behaviour (cross-checked with `20260506_consolidated_rls.sql`
plus the older partial migrations):
- **anon** can read: brands, centres, centre_brands, centre_seer_scores,
  brand_sale_events, brand_sale_cycles. Cannot read or write anything else.
- **authenticated user** can read all of the above plus
  `personal_tide_scores` (own row only) and `user_preferences` (own row
  only). Can write: `user_preferences` (own row), `community_signals`
  INSERT (any).
- **admin (alcottrell@gmail.com)** additionally: UPDATE brand_sale_events,
  full CRUD on brand_sale_cycles, full CRUD on admin_review_log, read
  community_signals, read audit_log.
- **service_role** bypasses RLS entirely.

Issues found above: probe broken (P1), is_admin() is a single email (P2).

---

## 6. Personalisation flow

Two parallel implementations:

**Server-side** (score.js:307–398, written nightly):
- Reads brands from brands.js (the npm-runtime copy, served via the seed
  file's upsert).
- Reads centre_brands from DB.
- For each user × centre, finds matching brands (gender + cluster), totals
  freshness over `matchingBrandIds.length`, writes `personal_tide_scores`.
- Always uses `cluster` field FROM brands.js.

**Client-side** (index.html:1678–1687 `calcPersonalScore`):
- Reads brands from inline BRANDS array.
- Reads centre_brands from inline PRESENCE matrix.
- Same formula, but uses inline cluster values, which (P1 above) disagree
  with brands.js for several brands.

**Effect:** the previewed personal score during the prefs wizard ("Step 4
of 4") and the live personal score badge on the dashboard can disagree
with the server-computed personal score in `personal_tide_scores` for any
user with a cluster filter. They always agree on gender filtering.

The user-visible badge uses `calcPersonalScore` (the client-side one). The
edge function uses the server-side definition for emails. So same user, two
sources, two numbers.

---

## 7. Edge function audit (`notify-high-tide`)

Already covered above:
- **P0**: scheduled at 07:00 UTC but reads `centre_seer_scores` for today
  which doesn't exist until 08:00 UTC. Currently sends nothing.
- **P2**: per-user auth.admin.getUserById round-trip, won't scale.
- **P2**: `isOnSale` and `daysOnSale` definitions are duplicated from
  score.js and index.html. Three places to keep in sync.

Other observations:
- `dryRun` mode is wired through correctly, returns the would-be send list.
- Resend API key is required at runtime unless `dryRun: true`.
- Email rendering is inlined HTML; no template engine, simple string
  concatenation. Acceptable for the volume.
- "Top 3 brands" filtering: when the user has gender prefs, brands are
  filtered to matching first; if no match, falls back to all on-sale. OK.

---

## 8. Dead code / legacy paths

- **sheets.js**: imports googleapis, exports `pushToSheets`. Not called
  from anywhere (`grep -rn pushToSheets` shows only its own definition).
  Either kill or wire up. If kept dormant, the SHEET_CSV_URL fallback in
  index.html will diverge further (P2 above).
- **`record_brand_thumbs()` RPC**: no caller.
- **`community_signals`** table: no inserter.
- **`v_personal_scores`** view (migration 20260502:95–125): grep'd in
  index.html — not used. Dashboard reads `personal_tide_scores` indirectly
  via the in-browser computation only. Either delete or use it.
- **`preferred_centre_id`** column on `user_preferences`: not read by
  index.html, not read by score.js, not read by notify-high-tide. Replaced
  conceptually by `saved_centres` array. Dead column.

---

## 9. Migration ordering / dependency map

For a fresh DB build, migrations must apply in this order. (Existing DB
already has them; this is for disaster-recovery awareness.)

1. `20260502_add_personalisation.sql` — creates user_preferences,
   personal_tide_scores, v_personal_scores. Depends on the implicit
   pre-existing brands, centres, centre_brands, brand_sale_events,
   centre_seer_scores tables (created by an earlier setup not in this
   repo).
2. `20260503_add_john_lewis.sql` (not read for this audit but presumed
   small).
3. `20260503_grant_anon_read.sql` — RLS grants for the public-read tables.
4. `20260504_add_saved_centres.sql` — adds saved_centres array.
5. `20260504_add_notification_prefs.sql` — adds email_alerts, daily_digest.
6. `20260504_add_admin_console_and_cycles.sql` — creates `is_admin()`,
   `brand_sale_cycles`, `community_signals`, `admin_review_log`, adds
   verified-state columns to `brand_sale_events`. **Everything below
   depends on `is_admin()` existing.**
7. `20260504_reset_first_detected.sql` — references the immutable trigger
   that was *not yet defined*; the migration handles missing trigger
   gracefully.
8. `20260504_reset_tide_history.sql` — archives + truncates score history.
9. `20260505_add_manual_brands_and_reset_fn.sql` — creates
   `reset_brand_sale_cycle()` and the 17 manual-check brand rows.
10. `20260505_enable_realtime_brand_sale_events.sql` — adds the table to
    the supabase_realtime publication.
11. `20260506_audit_log_and_constraints.sql` — creates audit_log and the
    immutable trigger function (now actually defined).
12. `20260506_consolidated_rls.sql` — restates the full RLS posture.
13. `20260506_v_system_health.sql` — health view.

There are **no DDL conflicts** — every migration is `IF NOT EXISTS` /
`CREATE OR REPLACE` / `DROP POLICY IF EXISTS`. Re-running them is safe.

---

## 10. Bug list, ordered by severity

### P0 (breaks the core promise — fix first)

1. **Admin updates do not refresh the headline Tide Score, verdict, BLUF,
   stage, or trajectory** until the next 08:00 UTC scorer run.
2. **`notify-high-tide` cron is scheduled before score.js writes today's
   row** — sends 0 emails per day if the README example was followed.

### P1 (visible defects — fix soon)

3. 12 scraped brands silently dropped because they're absent from
   `DASHBOARD_NAME_BY_SCRAPER_ID` (Weekday, Monki, Cath Kidston, Coast,
   Patagonia, Craghoppers, Mountain Warehouse, UGG, New Balance, Fossil,
   Radley, Lush).
4. `cluster` definitions disagree between brands.js and inline `BRANDS` —
   personal score preview / fallback differs from the saved server value.
5. `PRESENCE` matrix in index.html drifts from `centre_brands` in the DB
   with no automation to keep them in sync.
6. Anchor brand IDs differ between score.js (5 brands) and index.html (6
   brands incl. Uniqlo). score.js is the authoritative writer; spec says
   Uniqlo should be in the anchor set.
7. Admin "access check" probe never fails for non-admins because RLS hides
   rows silently. Confusing UX.
8. `saveCentreToUserPrefs` race on first auth could overwrite a user's
   gender/cluster prefs to all-false if two tabs sign in concurrently.
9. Realtime subscription only on `brand_sale_events`, not on
   `brand_sale_cycles` or `centre_seer_scores`.

### P2 (data drift, fragility, performance)

10. CSV fallback in index.html points at a Google Sheet that scraper.js
    no longer maintains — stale data presented as live during outages.
11. `setInterval(loadTideData, 15000)` is overkill alongside realtime.
12. `quickSavePref` swallows errors silently — toggle UI lies.
13. `notify-high-tide` does N round-trips to `auth.admin.getUserById`.
14. `community_signals` table and `record_brand_thumbs` RPC are dead.
15. `is_admin()` is a single hard-coded email.
16. `BRANDS` inline array in index.html is a parallel id space (and source
    of bugs #3, #4, #5, #6).
17. `BRAND_URL_BY_NAME` is a third copy of brand metadata.
18. John Lewis PRESENCE row is "best guess" — not yet reviewed.
19. `v_personal_scores` view exists but is unused.
20. `preferred_centre_id` column on user_preferences is unused.

### P3 (minor)

21. `score.js` comment about Uniqlo's anchor status is stale.
22. `admin.tidego.co` host rewrite present but DNS not yet pointed.
23. `feedback-bar` localStorage key `fb-dismissed` is unnamespaced.
24. `tide_pending_save_centre` localStorage entry can leak across users.
25. sheets.js is dead but still imports `googleapis`.

---

## 11. The honest answer to the user's question

**"When I update the admin panel, will updates flow into the app correctly
every time?"**

Today: **partially.** Here's what works and what doesn't:

| What you change | Where it lands within ~1s | Where it lands at next 08:00 UTC | Where it never lands |
|---|---|---|---|
| Confirm sale started (open cycle) | brand chip flips on; "Day 1" appears; "Up to N%" appears | tide_score recomputes; gauge moves; verdict updates | — |
| Confirm sale ended | brand chip flips off | tide_score recomputes | — |
| Edit cycle's discount % | "Up to N%" chip updates | tide_score uses new % via cycle.max_discount_pct | — |
| Edit cycle's start_date | "Day X" count updates | freshness recalculated for that brand → score may change | — |
| Confirm "Still on sale" | Confirmed-today section moves the row | nothing (already on) | — |
| Confirm "No sale" | brand chip flips off | tide_score recomputes | — |

The reason updates don't flow into the headline score live is that the
dashboard reads `centre_seer_scores`, which is only written nightly by
score.js. Until that's changed, the headline lags admin actions by up to 24
hours.

**To get to "yes, every time, with confidence", we'd need to fix at
minimum:**

- P0 #1 — make headline score live, not nightly (recommended approach:
  drop the dashboard's reliance on `centre_seer_scores.tide_score` for
  "today" and recompute in-browser like the brand chips do).
- P0 #2 — fix the notify-high-tide cron schedule.
- P1 #3 — add the 12 missing brands to the dashboard map.
- P1 #4, #5, #6 — collapse the dual-id-space and dual-cluster-spec into a
  single source loaded from Supabase.
- P1 #7 — fix the admin probe so non-admins see a clear "you're not an
  admin" state.

The remaining P1/P2/P3 items are quality-of-life fixes that don't block
"updates flow into the app correctly".

---

## 12. Files read during this audit

- `scraper.js`, `score.js`, `brands.js`, `seed.js`, `sheets.js`
- `index.html` (1937 lines), `admin.html` (831 lines)
- `vercel.json`, `package.json`
- `supabase/functions/notify-high-tide/index.ts`,
  `supabase/functions/notify-high-tide/README.md`
- All migrations in `supabase/migrations/` (10 pre-existing + 3 new from
  the May 2026 audit)
- `.github/workflows/daily-scrape.yml`
- HANDOVER docs: `HANDOVER-2026-04-26.md`, `HANDOVER-2026-04-28.md`,
  `HANDOVER-2026-05-03.md`, `HANDOVER-2026-05-03-scraper-accuracy.md`,
  `DESIGN-2026-05-03-eyeball-admin-console.md`,
  `README-technical.md`, `CLAUDE.md`

No code was modified during this audit. Bug fixes are deferred until you
review and prioritise.
