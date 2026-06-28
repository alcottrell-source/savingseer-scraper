# Rebrand Regression Checklist

Branch: `rebrand/visual-merge`

Run after every visual change. Anything that was working before must still work.

## A. Anonymous (signed-out) flows

- [ ] **A1** Homepage loads with Tide logo, "Choose your shopping centre" picker, search input + dropdown of 30 centres
- [ ] **A2** "Your shopping trip, timed right" marketing region renders below picker
- [ ] **A4** Feedback widget bottom-right with dismiss × works; "Share feedback →" opens external link
- [ ] **A5** Footer renders: "Tide · Updated daily at HH:MM Live sale data · DD MMM YYYY" + Privacy / Contact links
- [ ] **A6** Selecting a centre from dropdown navigates to its detail view
- [ ] **A7** Typing in the search input filters the dropdown by centre name + city
- [ ] **A8** Centre detail view: shows centre name + city, **merged tide card** (large Tide Score **%** + verdict word, "Verified {when}" badge, saved-shops line, "N of M shops on sale, {direction} K two weeks ago" count line, faithful 0–100 history chart with 7D/30D/60D/MAX tabs, **date-based**, defaulting to 60D), narrative, brand grid, "Back to Centres" link. There is no longer a separate "Tide over 60 days" card below the vessel — the chart is inside the same card as the verdict.
- [ ] **A9** Stage badges & copy are correct per server `verdict`: Go now (PEAK only) / Easing / Rising / Quiet / Over. Recommendation language ("Go now") appears only on PEAK.
- [ ] **A10** "Sign in" button in nav opens auth modal at email step
- [ ] **A10b** Centre-detail "Share" button generates a **branded tide card image** (`buildTideShareImage` → 1080×1350 PNG: TIDE wordmark, centre name + location, big accent **%** + verdict word, GO NOW pill on PEAK, "N of M shops on sale", "Verified {when}", tidego.co CTA). On mobile (file-share support) the native sheet shares the **image + caption + link**; on desktop it downloads the PNG and copies the caption+link; oldest fallback is the text/link share. The card's %, verdict and count match the hero exactly (same `_tideShareCtx` source). PEAK→amber, Rising→`#9FD8B0`, Easing→`#F4B79F`, else neon `#5EFFB0`.
- [ ] **A12** Centre chart period tabs are **date-based** (`windowTideSeries`): 7D/30D/60D show the last 7/30/60 calendar days, MAX shows all stored history; the chart opens on **60D**. A centre with points spanning >60 days renders four visibly distinct lines; a thin centre (≤30 days) draws the same line on 30D/60D/MAX (expected — `scripts/diag-tide-history.mjs` confirms coverage) but still draws a line on 7D via the <2-point fallback. `score.js` retains 180 days of `tide_history` so MAX can exceed 60D. Landing chart tabs unchanged.
- [ ] **A11** Merged tide card consistency: the centre-detail hero shows a single verdict word (beside the %); the trend-pill and chart-eyebrow tail word were retired (direction now lives in the count line, sourced from the engine `trajectory`). The big "%" (from `tide_score`), the "N of M shops" count (from `brands_on_sale`/`total_brands`), and the chart's endpoint pill all read the same value — they cannot contradict because the % is computed from the count. "Go now" copy appears only on PEAK.
- [ ] **A13** Anonymous users (and any signed-in user who follows **no** brands) see **no** My shops / All shops toggle and get the **All shops** experience everywhere — the centre-led hero (A8), the global "Today's tide" ranking, the all-centres landing chart. The My/All personalisation spine is gated on followed brands, so all anonymous flows above are byte-for-byte unchanged.

## B. Authenticated flows (require test user)

- [ ] **B1** Auth modal: email step → continue routes to signin (existing user) or signup (new email)
- [ ] **B2** Magic link request shows the "check your inbox" confirmation
- [ ] **B3** After sign-in, nav button changes to "My Tide" → opens account panel (NOT prefs wizard for returning users)
- [ ] **B4** Account panel shows email, saved-centres list, Go Now alert + daily digest toggles, Edit shopping preferences, Sign out
- [ ] **B5** New user (no row in `user_preferences`) auto-opens the prefs wizard via `onAuthStateChange`
- [ ] **B6** Prefs wizard: 4 steps gender → style clusters → notifications + saved centres → preview; saves via upsert with `onConflict: 'user_id'`
- [ ] **B7** "Edit shopping preferences" from account panel re-opens the wizard
- [ ] **B8** quickSavePref(key, value) saves toggles inline without form submission
- [ ] **B9** Sign out clears session, returns to anonymous view, "Sign in" button reappears
- [ ] **B10** Personal score view appears for signed-in user with prefs (computed against matching brands only)

### B-spine. "Your shops" personalisation (Jun 2026 — toggle-free spine)

> One global, persisted view mode (`tide_view_mode` in localStorage; `getTideMode`/`setTideMode`), **My shops by default**, gated on following ≥1 brand (`tideHasFollowed`). The prominent segmented toggle was **removed** (tested poorly) in favour of a silent personal default + a quiet inline disclosure. "All shops" mode is byte-for-byte the pre-spine behaviour.

- [ ] **B11** **No segmented toggle anywhere.** The mode is a silent default (My shops). The only control is a **quiet inline disclosure inside the centre hero**: in My mode "Showing your shops · _see the whole centre_" → All; in All mode (for a follower with shops here) "_See your shops here_" → My. The choice **persists across reload**. It only appears on a centre where you actually follow ≥1 shop present.
- [ ] **B12** Centre hero in **My shops** mode leads with **your** number: big "N% of your shops", the centre's own %/verdict demote to a "Whole centre X% · {verdict}" context chip. On a centre where you follow **none** of its shops it falls back to the centre-led hero (A8). **All shops** mode = exactly A8/A11.
- [ ] **B13** Landing for a follower leads with a money-framed **"Your shops today"** watchlist: only centres where ≥1 of your shops is on sale, ranked by how many then deepest discount; each row "X of your N shops on sale · **up to Y% off**" + a strip of **just your shops** + a "**See your shops →**" CTA. The global **"Today's tide"** list still renders **below** it (deduped) for discovery; if none of your shops are on sale anywhere, the personal list shows the "here's what's hot across all centres" note + global list instead.
- [ ] **B14** Brand grid honours the mode: heading "**Your shops here**" (My) vs "**Brands at this centre**" (All). The two-line chart's cyan "Your shops" line is unaffected by mode (shown whenever you follow ≥1 brand present here).
- [ ] **B15** Onboarding step 3 (brands) shows a **live "your shops today" preview** that updates on every brand toggle ("★ N of your shops on sale right now across M centres"), and a **"Follow N more to unlock your personal Tide"** nudge until ≥3 followed (Continue still enabled at ≥1).
- [ ] **B16** Brand-sale alert email: single-brand CTA reads "**See it at {centre} →**" and **deep-links** to `?centre=<id>` (lands on that centre's personal-by-default view); multi-brand digest CTA reads "**See your shops →**". Anon home (`APP_URL`) lands on the personalised landing for followers.

## C. Data layer integrity (the north star)

> The automated scraper was **removed (Jun 2026)** — sale state is admin-verified only. The `brand_sale_events.sale_status` / `date_first_detected` / `scraper_error` columns are frozen and unread; the "NEVER use scraper X" rules below remain as belt-and-braces guardrails. The admin console surfaces review work via **user reports** (not a scraper signal).

- [ ] **C1** Brand cards / on-sale counts use **admin-verified** state only — `active_cycle_id` OR `last_verified_status` (when `last_verified_date` set). NEVER `brand_sale_events.sale_status`.
- [ ] **C2** "Days running" uses `brand_sale_cycles.start_date` (or `last_verified_date` fallback). NEVER `date_first_detected`.
- [ ] **C3** Discount % uses `brand_sale_cycles.max_discount_pct`. Brand-cards that have no cycle show no %.
- [ ] **C4** Centre stage / verdict / bluf displayed comes from `centre_seer_scores` server columns. No client-side recomputation overrides them.
- [ ] **C5** When today's `centre_seer_scores` row is missing, FE gracefully falls back to local computation from sheet data (existing behaviour) — banner / footer still indicates which is live.
- [ ] **C6** `narrative` column rendered when present; template fallback used when null.
- [ ] **C7** Front-end's "on sale count" matches `centre_seer_scores.brands_on_sale` exactly for that centre+date.
- [ ] **C8** Trajectory pill / arrow uses `centre_seer_scores.trajectory` value. No client compute.
- [ ] **C9** PostgREST reads use `pgRead` / `pgUpsert` helpers, never `sb.from()` (browser-hang issue).
- [ ] **C10** Auth state changes do not double-fire data fetches.

## D. Resilience / edge cases

- [ ] **D1** Centre with no `tide_history` (new centre) renders without crashing — sparkline shows empty / placeholder
- [ ] **D2** Supabase fetch error → sheet CSV fallback path engages; UI doesn't break
- [ ] **D3** Brand on sale with no `active_cycle_id` and no `last_verified_*` → omitted from on-sale list
- [ ] **D4** Signed-out user sees no auth-gated UI, no console errors
- [ ] **D5** Page reloads cleanly with the same centre selected (URL persists)
- [ ] **D6** No console errors / warnings during normal use
- [ ] **D7** Mobile viewport (375px) renders without horizontal scroll
- [ ] **D8** Feedback widget doesn't cover content above the fold
- [ ] **D9** Centre with sparse history (< 5 real days): merged card's history chart renders **faithfully** (real `tide_history` points only — no synthetic UK-retail-calendar backfill, no amplitude rescaling); today's point is anchored to the live headline value and sits at the right edge; the "up from … two weeks ago" clause is omitted when history doesn't reach back two weeks; no NaN coordinate and no console error. (The synthetic seasonal backfill remains only on the out-of-scope all-centres landing chart.)

## E. Admin parity (the north star, restated)

- [ ] **E1** "On sale" count for a given centre matches between `tidego.co/<centre>` and `tidego.co/admin` for that same centre
- [ ] **E2** Verdict displayed on consumer matches server `verdict` field that admin reads
- [ ] **E3** Brand list on consumer = brands marked verified-on-sale in admin (no scraper-only entries leaking through)
- [ ] **E4** Discount % shown on consumer matches the cycle's `max_discount_pct` shown in admin
- [ ] **E5** Admin "Sales overview" section (top of `/admin`): lists every centre with active sales, ranked Peak-first then by on-sale count, each card showing "N / M on sale", a **Newest sales** column (shop + recency + %) and a **Biggest discounts** column (shop + %). On-sale derivation matches admin truth (`active_cycle_id` OR `last_verified_status`); it refreshes after every confirm/edit (rides `loadAndRender`) and fails soft (a read error shows an inline notice, never blanks the review queue).

## F. Performance (light)

- [ ] **F1** Initial page load + Supabase fetches complete in < 3s on local network
- [ ] **F2** Centre selection → detail render in < 500ms
- [ ] **F3** No layout-shift after data loads (the merged tide card paints once, no second fade-in from a separate history section).
- [ ] **F4** Merged card animates in once via the existing score-section transition; no orphan `#history-section` element triggers a second visibility flip.

## How to use

After each merge step in stage 2, walk this list. Mark a box only after eyeballing in the browser.

If anything regresses → roll back that step before continuing. Don't carry red items forward.
