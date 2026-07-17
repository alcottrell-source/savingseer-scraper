# DECISIONS.md — Tide Hard Architecture Session (2026-07-08)

Running log of assumptions, decisions, and open questions for the Gravity Engine /
Tide Score / Personalisation architecture session. Append-only; newest at the bottom
of each section.

## Phase 0 — Orientation findings (2026-07-08)

### What exists

- **Tide Score state machine** — the most mature of the three systems. Lives in
  `score.js` as pure, exported, unit-tested functions (`getTideStage`,
  `getTrajectory`, `deriveStageFromVerdict`; 19 passing tests in
  `test/score.test.mjs`). **Five** stages (Turning → Rising → High Tide →
  Falling → Low), not the six named in the session brief — "Flat" is not a
  stage; it is one of three *trajectory* labels (RISING/FLAT/FALLING) computed
  separately with its own hysteresis (`TRAJECTORY_FLAT_BAND` 1.5 /
  `TRAJECTORY_FLIP_BAND` 4.0). Stage transitions: High Tide enter 40 / exit 30
  hysteresis; RISING_FLOOR 15; OVER_CEILING 8; one-shot local-peak on
  RISING→(FLAT|FALLING) inside the climb; new-cycle escape from Low; descent
  routing driven by yesterday's stage (recovered from stored verdict via
  `STAGE_FROM_VERDICT`). State per centre is *implicit* — re-derived each day
  from yesterday's stored verdict/trajectory row, not held in a machine object.

- **Scoring input pipeline (the "Gravity Engine" slot)** — there is **no
  formalised Gravity Engine**. The name appears exactly once in the repo, in a
  comment in `supabase/migrations/20260516_add_user_reports.sql` referencing
  `brand_sale_events.date_first_detected` — a column CLAUDE.md says is now
  **frozen and unread**. The de-facto signal pipeline today:
  admin-verified sale state (`brand_sale_cycles` / `active_cycle_id` /
  `last_verified_status`) → `tide_score = round(brandsOnSale/totalBrands×100)`
  (plain, user-verifiable %; the freshness-weighted + anchor-multiplier formula
  was **deliberately removed** — recorded product decision in CLAUDE.md) →
  trajectory → stage/verdict. Side signals that exist but do not feed the
  score: crowd `user_reports` (advisory-only by design), discount depth
  (`max_discount_pct` → `avg_discount_pct`, display-only), `pct_changed_date`
  (freshness of the discount, feeds "Newest Sales" panel only).

- **Scraper** — **removed Jun 2026** (`scraper.js` deleted; CLAUDE.md confirms).
  The session brief's framing ("Node.js + Crawlee scraper → Supabase, cron at
  06:00/08:00 UTC") describes a prior architecture. The only cron is 10:00 UTC
  (`daily-scrape.yml`, now score+summarise only). "Raw scraped sale data" does
  not currently exist as an input.

- **Personalisation — TWO parallel systems, not reconciled:**
  1. *Server-side* (from the v1.0 spec, per migration
     `20260502_add_personalisation.sql` "Tasks 2a, 2c, 2d, 5"):
     `user_preferences` (gender flags + `style_clusters`), brand
     gender/cluster columns, `calculatePersonalScores()` in score.js writing
     `personal_tide_scores` daily (match = gender ∩ cluster), `v_personal_scores`
     view. **The frontend never reads any of it** — zero references to
     `personal_tide_scores` / `v_personal_scores` in index.html. Personal
     verdicts are computed without hysteresis/trajectory (FLAT, no yesterday
     stage) — so they can never say Easing/Over correctly.
  2. *Client-side* (what users actually see): explicit followed brands
     (`user_preferences.brand_ids`) + presence matrix + live `SALE_STATUS`,
     computed in-browser (`getHotCentres(personal)`, `renderTideVessel`
     showPersonal lens, My shops/All shops pill). Different matching basis
     (explicit follows vs inferred gender/cluster), different ranking
     (myOnSale count → deepest pct → density), no persistence, no history.

- **The v1.0 personalisation spec document is NOT in the repo.** Only the
  migration's task references and the code that implemented its backend half
  survive.

### What's stubbed / dormant
- `personal_tide_scores` + `v_personal_scores`: written daily, read by nobody.
- `brand_sale_events.sale_status` / `date_first_detected` / `scraper_error`:
  frozen scraper-era columns.
- Brand alert-me intent: `localStorage['tide_alert_brands']` only; delivery unwired.
- `sheets.js` / Google Sheets CSV fallback still referenced in index.html data load.

### What's missing (vs the session brief)
- Gravity Engine: no spec, no named implementation, no scraped input to consume.
- Six-stage lifecycle: no "Flat" stage anywhere.
- Personalisation ranking spec: no doc; two divergent implementations.
- `/docs/architecture/`: directory does not exist.
- Scraper resilience/data-quality contract: moot in current architecture
  (no scraper), unless one is being reintroduced.

### Assumptions logged
- A1: Baseline is healthy — `node --test` 19/19 pass on branch
  `claude/tide-architecture-deep-4mozvf` at d41f373.
- A2: CLAUDE.md is authoritative over the session brief where they conflict
  (scraper removed; five stages; plain-% score) — **to be confirmed in Phase 1
  interview before any design work.**

## Open questions (Phase 1)
- Q1: What is the Gravity Engine supposed to consume — the current
  admin-verified + crowd-report reality, or a reintroduced scraper?
  → answered by D1.
- Q2: Six stages incl. Flat, or formalise the existing five? → D2.
- Q3: Is the plain-% headline tide_score a non-negotiable (CLAUDE.md records it
  as a deliberate product decision), with Gravity signals living beside it? → D3.
- Q4: Which personalisation system is canonical — server-side prefs-based
  scores (unread) or client-side followed-brands lens (live)? Does the v1.0
  spec doc still exist off-repo? → D4 (spec reverse-engineered; owner did not
  supply the original document).

## Open questions (Phase 2/3 — for the owner, non-blocking)
- **OQ1 — the eternal-RISING quirk. RESOLVED → D16 (owner: "fix it").**
  Was: a centre whose score plateaued stayed trajectory RISING forever (sticky
  RISING only exited on drops), reading "Rising" indefinitely and never firing
  its local peak. Fixed by the stall decay rule — see D16 and ADR-002 §5.1/§6 E2.
- **OQ2 — graduated crowd trust.** Enough independent corroborating reports
  auto-refreshing `last_verified_date` (still never opening/closing cycles) was
  deliberately deferred (D6); requires reporter track-record weighting first.
  See ADR-001 §2.
- **OQ3 — `community_signals`** (anonymous thumbs) is excluded from Gravity v1
  (no auth, weaker dedupe). Decide whether to fold it in at reduced weight or
  retire the table. See ADR-001 §4.1.

## Decisions

- **D1 (2026-07-08, owner):** Gravity Engine consumes **current reality** —
  admin-verified cycles, discount depth, pct-change freshness, crowd reports as
  a confidence signal. No scraper spec now; design input interfaces so a future
  scraper slots in as one more source. (Answers Q1.)
- **D2 (2026-07-08, owner):** Tide Score stays **five stages**. "Flat" remains a
  trajectory label only; the ADR formalises the existing machine. (Answers Q2.)
- **D3 (2026-07-08, owner):** The headline `tide_score` formula (plain % of
  brands on sale, user-verifiable) is **untouchable**. Gravity Engine signals
  live beside it — feeding ranking, alerts, personalisation — never the gauge
  number. (Answers Q3.)
- **D4 (2026-07-08, owner):** Personalisation is **follows-first**: explicit
  followed brands are the primary signal; gender/style-cluster prefs become the
  cold-start fallback; the server-side pipeline is repurposed or retired
  accordingly. v1.0 intent to be reverse-engineered from migration + code.
  (Answers Q4.)
- **D5 (2026-07-08, owner):** Staleness policy = **flag, never mutate**. Admin
  state is absolute for the score; the engine computes per-brand confidence
  (verification age, crowd corroboration/contradiction) driving an admin
  re-verify queue, a public "last verified" honesty cue, and ranking. A stale
  cycle still counts until closed.
- **D6 (2026-07-08, owner):** Crowd reports = **confidence modifier**.
  Confirmations refresh confidence; contradictions decay it and raise re-verify
  priority. Never mutates sale state (advisory-only rule stands). Reporter
  track-record weighting is a later extension.
- **D7 (2026-07-08, owner):** State machine gets **explicit persisted state**
  (stage + supporting fields), verdict becomes pure presentation. Spec must
  include legacy-row migration/back-compat and defined gap-handling semantics.
- **D8 (2026-07-08, owner):** Personalisation computes **client-side live**
  (canonical for the feed); the daily server job is **repurposed** to persist
  per-user score history with the same follows-first formula (shared spec so
  they cannot diverge), enabling trends + alerts + moat data.
- **D9 (2026-07-08, owner):** Re-verification cadence is **weekly-ish per
  brand**. Confidence decay calibrated so ≤7 days unverified = normal (full or
  near-full confidence), ~14+ days = the re-verify queue's red zone.
- **D10 (2026-07-08, owner):** Local-peak firing **stays sensitive** (one-shot
  on the sticky-trajectory flip, no confirmation day). A missed peak breaks the
  product promise; an early GO NOW is still a good shopping day. The ADR
  documents the false-positive mode honestly.
- **D11 (2026-07-08, owner):** Personal feed ranking adds **freshness** (recency
  of sale start / discount deepening among the user's on-sale shops) and only
  freshness — centre-stage context, confidence weighting, and geo proximity were
  offered and declined for v1. Base ordering (your-shops-on-sale count → depth →
  density) stands.
- **D12 (2026-07-08, owner):** Moat target = **consumer timing edge**. The
  proprietary value is knowing WHEN: per-brand/per-centre sale-cycle rhythms.
  Designs must maximise clean longitudinal cycle data (provenance, unbroken
  history, cycle metadata) over affiliate or B2B export concerns.
- **D13 (2026-07-08, session):** Scraper resilience & data-quality contract
  (Problem 4) is **deferred** — no scraper exists (D1). The Gravity Engine ADR
  defines the evidence-source interface a future scraper must implement, which
  is the part that had to be designed now.
- **D14 (2026-07-08, session):** Reference implementations live in `lib/`
  (`gravity.js`, `tide-machine.js`, `personal-rank.js`) as pure, side-effect-
  free ES modules with no Supabase imports, tested by `test/*.test.mjs`
  (`npm test` picks them up automatically). Glue sites are marked
  `TODO(ADR-00N …)` in `score.js` / `index.html`.
- **D15 (2026-07-08, session):** The tide machine's new-centre RISING default
  keys on **observations including today ≤ 3** (`observedDays ≤ 3`), which is
  exactly when `score.js` sees <3 prior rows — proven equivalent by the parity
  suite. A short window on observation 4+ means a broken (gapped) window →
  FLAT rebuild (divergence V2, a deliberate bug-fix over the shipped RISING
  default after gaps).

- **D16 (2026-07-08, owner — "fix it" on OQ1):** **Stall decay** added to the
  RISING trajectory branch: when the 3-day window *plus today* spans less than
  `TRAJECTORY_STALL_RANGE` (1.5 pts), the climb has genuinely flattened →
  FLAT. The resulting RISING→FLAT flip fires the one-shot local Peak — by
  design, the plateau IS the centre's peak (aligned with D10: a plateaued
  centre previously *missed* its peak entirely). Design choices: (a)
  **stateless** window-range test rather than a persisted streak counter, so
  the identical rule ships in both `lib/tide-machine.js` and production
  `score.js` with parity intact and no schema change; (b) **RISING-only** —
  decaying FALLING would soften the new-cycle escape threshold (>4 → >1.5), a
  separate unrequested behaviour change; (c) accepted consequences: a one-time
  catch-up wave of Peak verdicts/emails for currently-plateaued centres on the
  first post-deploy run, and new centres onboarded mid-plateau at ≥15% firing
  their one-shot Peak on ~day 4. See ADR-002 §5.1 + §6 E2.

- **D17 (2026-07-09, owner — "all centres must be main centres with lots of
  the tracked stores"):** **Centre audit.** The May 2026 presence audit had
  silently failed for a third of the catalogue (fetch/Wikipedia fallbacks
  yielding junk), leaving major malls with absurd store counts — Lakeside 0,
  Bluewater 5, St David's 3 — and `HOT_MIN_TRACKED_BRANDS` was hiding the
  breakage from the landing list while the admin insights tab still showed
  "3 of 3 shops". Resolution, per the owner's rule (remove handful-store
  centres OR fix their store lists): (a) **six secondary/duplicate-coverage
  centres removed** — The Lexicon, Friars Walk, Queensgate, Broadmead
  (Bristol already covered by Cabot Circus), Touchwood, Bentall Centre —
  deactivated in the DB (`centres.active = false`, history preserved) and
  dropped from every centre-indexed static array in `index.html`; (b)
  **eleven unambiguously-major centres kept and their presence rows rebuilt**
  (Lakeside, Bluewater, Metrocentre, St David's, Eldon Square, Silverburn,
  Braehead, White Rose, Highcross, Cribbs Causeway, St James Quarter) from
  July 2026 directory/store-locator research, unioned with the surviving
  audit rows — conservative: a brand is marked present only on strong
  evidence, so these centres may still under-count slightly (re-run
  `scripts/fetch-centre-directories.mjs` + `build-presence-matrix.mjs`
  locally to refine; NOTE those scripts still assume the old 30-centre index
  space); (c) **Evans (B007) and Coast (B036) removed from the tracked brand
  set** — both online-only since ~2021, their listed stores didn't exist
  (their `brands`/`brand_sale_events` DB rows are kept for history, just
  `present = false` everywhere). Every live centre now has 11–56 tracked
  stores. Migration: `supabase/migrations/20260709_centre_audit.sql`.
  Centre position-codes (C01…) shifted for centres after The Oracle — safe
  because persistence translates codes↔DB-ids by name at runtime, but any
  hardcoded C-code list (like the `#centre-select` options) must stay in
  CENTRE_NAMES order.

- **D18 (2026-07-17, owner — "the main page says go now when the sales are
  easing; identify the top of the tide accurately so the calls to action are
  always correct"):** **Peak = rising to / sitting at the crest only; a
  confirmed decline reads Easing.** The first full recorded cycle (climb to
  ~60–78%, crest early July, then decline) exposed that the High Tide hold
  was score-only (enter 40 / hold to 30), so 47 of 48 scored centres read
  "Go now" with a FALLING trajectory — 504 stale Peak days in the 73-day
  replay. Fix: the hold is now trajectory-gated (ADR-002 §5.2 T3a/T3b/T3c) —
  FALLING exits to Easing at any score; re-entry from descent needs ≥40 +
  sustained RISING (no flap, no duplicate peak alerts). Owner also decided:
  **five states stay** (no new top-of-cycle state); discount-deepening
  (60%→70% off) remains an orthogonal depth signal, never a state-machine
  input. Numeric thresholds unchanged — the replay
  (`scripts/analyze-tide-cycles.mjs`) validated them: crest→Easing lag ≈2.7
  days, Peak-entry events 102→138 (all genuine ≥40 resurgences at small
  volatile centres), zero real slow-drip episodes (episode-max guard
  deliberately not built — see ADR-002 §6 E13).

## Phase 2/3 record (2026-07-08)

- ADRs written: `docs/architecture/gravity-engine.md` (ADR-001),
  `docs/architecture/tide-score.md` (ADR-002),
  `docs/architecture/personalisation-ranking.md` (ADR-003).
- Reference implementations + tests: **88/88 tests pass** (19 pre-existing +
  69 new). The tide-machine parity suite sweeps 1,400+ combinations of
  (score × prev stage × trajectory × prev trajectory) plus the trajectory
  grid against `score.js`'s exported `getTideStage`/`getTrajectory` — zero
  divergence on the no-gap path.
- Implementations reconciled against ADRs: constants tables match code
  (`GRAVITY`, `TIDE`, `RANK` exports are the single source of truth named in
  each ADR); every ADR edge case (E-numbers) has a same-named test.

## Prioritised TODO — execution phase (cheaper model, zero design decisions)

Each item's full spec is in the named ADR section; the reference module and
tests already exist. Order = value ÷ risk.

1. **Tide machine swap-in** (`TODO(ADR-002)` in `score.js`; ADR-002 §10.1–2):
   run the additive migration, wire `nextTideState` into the fresh +
   carry-forward paths, persist the state columns, keep legacy re-exports.
   Parity suite makes this near-riskless; unlocks cycle analytics (D12).
2. **Personal history pass** (`TODO(ADR-003)` in `score.js`; ADR-003 §8.1–2):
   `basis` column migration + rewrite `calculatePersonalScores` on
   `lib/personal-rank.js`. Turns a dead-letter table into moat data — ship
   early so history starts accruing.
3. **Admin re-verify queue** (ADR-001 §9.1): 4 fetches + `buildReverifyQueue`
   + a panel in `admin.html`. First user-visible Gravity value; catches
   missed sales (E4) — direct moat protection.
4. **Gravity daily pass + persistence** (`TODO(ADR-001)` in `score.js`;
   ADR-001 §9.2): `brand_gravity` migration + per-day confidence write.
5. **Feed freshness key** (`TODO(ADR-003)` in `index.html`; ADR-003 §8.3):
   inline the shared functions between SYNC markers, replacing the bespoke
   personal branch of `getHotCentres`.
6. **Cold-start "For you" lens** (ADR-003 §5.1, §8.4): prefs-derived implicit
   set + labelling. Copy rules apply (never "your shops").
7. **Public honesty cue** (ADR-001 §9.3): centre freshness/confidence surfaced
   next to "Updated {when}" — needs (4) first.
8. **"Your tide" trend surface** (ADR-003 §8.5): reads the history table —
   needs (2) plus a few weeks of accrual.

Deferred pending owner decisions: OQ1–OQ3 above; scraper resilience ADR (D13).
