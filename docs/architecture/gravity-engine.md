# ADR-001 — Gravity Engine: the confidence & freshness layer

- **Status:** Accepted (2026-07-08)
- **Deciders:** Site owner (interview answers D1, D3, D5, D6, D9, D12 in `DECISIONS.md`)
- **Reference implementation:** `lib/gravity.js` + `test/gravity.test.mjs`
- **Consumers (execution phase):** `admin.html` re-verify queue, `score.js` gravity pass, `index.html` honesty cues

## 1. Problem statement

Tide's sale state is admin-verified: a brand is "on sale" because an operator
opened a cycle (`brand_sale_cycles` / `brand_sale_events.active_cycle_id`), and
it *stays* on sale until the operator closes it. Nothing in the system measures
how much that claim should still be believed. The failure mode is silent
staleness: if verification stops for two weeks, every centre's score reads as
fresh fact while describing the world of two weeks ago. Conversely, the one
independent ground-truth signal we have — crowd `user_reports` — is today only
an eyeball-triage list in the admin console; it never systematically raises or
lowers trust in a brand's state.

The Gravity Engine is the layer that turns the raw verified state + auxiliary
signals into **belief signals**: per-brand confidence, per-centre freshness,
and a prioritised re-verification queue. Its name is historical (it appears in
`supabase/migrations/20260516_add_user_reports.sql`); this ADR gives it a real
definition for the first time.

**Hard constraints (from the decision log):**

- **D3:** the headline `tide_score` formula (plain % of brands on sale) is
  untouchable. Gravity signals live beside it, never inside it.
- **D5:** flag, never mutate. Admin state is absolute for the score; a stale
  cycle still counts until an admin closes it. The engine only *reports* belief.
- **D6:** crowd reports modify confidence and queue priority. They never change
  sale state (the advisory-only rule in the `user_reports` migration stands).
- **D9:** operator cadence is weekly-ish per open cycle. ≤7 days unverified is
  normal; ~14+ days is the red zone.
- **D12:** the moat is the longitudinal cycle dataset. The engine must protect
  it: a *missed sale* (brand on sale in the world, off-sale in our data) is the
  worst outcome because that cycle is lost from history forever.

## 2. Options considered

| Option | Description | Verdict |
|---|---|---|
| O1 — Implicit trust (status quo) | No confidence model; admin queue = raw report list | Rejected: silent staleness stays invisible; crowd signal wasted |
| O2 — Decay counts | Cycles unverified ≥N days drop out of `brands_on_sale` until re-verified | Rejected (D5): an untended fortnight craters every score at once; mass expiry after a holiday reads as a market crash that never happened |
| O3 — Auto-close via learned cycle length | Learn typical cycle length per brand; auto-close overrunning cycles | Rejected (D5): state stops being purely admin-verified; a wrongly auto-closed cycle corrupts the longitudinal dataset (D12) — worse than staleness |
| **O4 — Flag, never mutate (chosen)** | Pure read-side confidence layer: age decay + crowd corroboration/contradiction → bands, queue, honesty cues | **Accepted**: keeps the verified dataset pristine, converts crowd reports into leverage, degrades honestly (with no reports it's a pure age model) |

Crowd-signal sub-options: queue-only (wastes the signal), graduated trust
(auto-refresh `last_verified_date` on enough corroboration — deliberately
deferred; it loosens the advisory-only rule and needs reporter track-record
weighting first), **confidence modifier (chosen, D6)**.

## 3. Decision

Build the Gravity Engine as a **pure, side-effect-free scoring module**
(`lib/gravity.js`) computing, for each brand and each centre:

1. **Brand confidence** ∈ [0.02, 1]: exponential age decay anchored on the last
   admin verification, lifted by corroborating crowd reports, crushed by
   contradicting ones.
2. **Confidence band**: `fresh` / `aging` / `red` / `unknown` — the operator-
   and UI-facing summary.
3. **Re-verify priority** and a sorted **admin queue**: what to check first in
   a weekly session, contradiction-flagged brands pinned to the top.
4. **Centre gravity aggregates**: mean confidence over on-sale brands, share
   verified within 7 days, stale/red counts — the inputs for public honesty
   cues and future ranking use.

It **writes nothing** and **changes no public number**. Persistence and UI are
execution-phase glue (see §9).

## 4. Data contracts

### 4.1 Inputs

All inputs are plain JS objects; the caller (execution phase: a `gravity` pass
in `score.js` or an admin-panel loader) is responsible for fetching. Dates are
`YYYY-MM-DD` strings or ISO timestamps; the engine works in whole days, UTC.

```ts
// One per brand — assembled from brand_sale_events + brand_sale_cycles
type BrandGravityInput = {
  brandId: string;              // brands.id, e.g. 'B012'
  onSale: boolean;              // the PUBLIC state, exactly as score.js derives it:
                                // active_cycle_id ? true : (last_verified_date ? last_verified_status : false)
  lastVerifiedDate: string|null;   // brand_sale_events.last_verified_date
  cycleStartDate: string|null;     // open cycle's brand_sale_cycles.start_date (null if no open cycle)
  presenceCount: number;        // COUNT of centre_brands rows with present=true for this brand
  reports: CrowdReport[];       // user_reports rows for this brand, any centre, last REPORT_WINDOW_DAYS
};

type CrowdReport = {
  reportType: 'sale_active_confirmed'|'sale_ended'|'discount_different'
            | 'sale_started'|'no_sale_confirmed';   // user_reports.report_type
  createdAt: string;            // user_reports.created_at
};
```

Notes:
- Sale state is **per brand, global** (one `brand_sale_events` row per brand),
  while reports are per (brand, centre). The engine aggregates reports across
  centres — a Zara "sale's ended" report from any centre bears on the single
  global Zara state. Per-centre divergence is out of scope for v1 (the data
  model has no per-centre sale state to be confident about).
- `community_signals` (the older anonymous thumbs table) is **excluded** in v1:
  no auth, no dedupe guarantee comparable to `user_reports`' one-per-user-per-
  day index. Extension point only.

### 4.2 Evidence interface (future scraper slot — D1)

Internally every signal is normalised to an **evidence event** before scoring.
A future scraper integrates by emitting these; nothing else changes.

```ts
type Evidence = {
  source: 'admin' | 'crowd' | 'scraper';
  kind:   'anchor' | 'corroborate' | 'contradict';
  ageDays: number;              // whole days before "today", ≥ 0
  weight: number;               // source trust multiplier: admin anchor n/a, crowd 1.0, scraper 0.5 (proposed)
};
```

- `anchor` — the admin verification. Exactly one (the most recent). Sets the
  base age-decay curve. Only `source:'admin'` may anchor (D5).
- `corroborate` / `contradict` — everything else, judged **against the current
  public state** (see §5.2 mapping).

### 4.3 Outputs

```ts
type BrandConfidence = {
  brandId: string;
  onSale: boolean;
  anchorDate: string|null;      // lastVerifiedDate ?? cycleStartDate ?? null
  daysSinceVerified: number|null;
  ageConfidence: number|null;   // decay component alone (null if no anchor)
  confidence: number|null;      // final, after crowd adjustment; null only when band==='unknown'
  band: 'fresh'|'aging'|'red'|'unknown';
  corroborationWeight: number;  // Wc — recency-weighted sum
  contradictionWeight: number;  // Wx
  hasFreshContradiction: boolean; // any contradicting report ≤ CONTRA_FRESH_DAYS old
  reasons: string[];            // human-readable, for the admin queue UI
};

type ReverifyQueueEntry = BrandConfidence & { priority: number };

type CentreGravity = {
  centreId: string;
  onSaleBrands: number;
  meanConfidence: number|null;  // mean over on-sale brands with non-null confidence
  freshShare: number|null;      // fraction of on-sale brands verified ≤ GRACE_DAYS ago
  redCount: number;             // on-sale brands in band 'red'
  unknownCount: number;
};
```

## 5. Algorithm

### 5.1 Constants (single source of truth: `GRAVITY` export in `lib/gravity.js`)

| Constant | Value | Rationale |
|---|---|---|
| `GRACE_DAYS` | 7 | Weekly cadence is normal (D9): within a week, full confidence |
| `HALF_LIFE_DAYS` | 7 | Confidence halves each week past grace → 0.5 at 14 days: the red-zone boundary lands exactly where D9 put it |
| `REPORT_WINDOW_DAYS` | 14 | Reports older than two weeks describe a world we may have re-verified since; ignore |
| `REPORT_RECENCY_TAU` | 7 | A report's weight halves per week of age |
| `CONTRA_FACTOR` | 0.4 | One fresh contradiction (weight 1) cuts confidence to 40% — enough to drop a fresh brand straight out of `fresh` |
| `CONTRA_FRESH_DAYS` | 7 | Contradictions this recent pin the brand to the top queue tier |
| `CONF_FLOOR` | 0.02 | Confidence never reaches 0 — the state is still admin-asserted (D5) |
| `SCRAPER_WEIGHT` | 0.5 | Reserved (D1): scraper evidence counts half a crowd report until proven |
| `OFF_SALE_IMPACT` | 0.4 | A wrong "off sale" matters less per centre than a wrong "on sale" for the public score — but see the missed-sale override in §5.4 |
| `BAND_FRESH_MIN` | 0.75 | `fresh`: conf ≥ 0.75 (≤ ~9.9 days unverified, uncontradicted — day 10 reads `aging`) |
| `BAND_AGING_MIN` | 0.5 | `aging`: 0.5 ≤ conf < 0.75. `red`: conf < 0.5 (> 14 days, or contradicted) |

### 5.2 Report classification (report type × public state → evidence kind)

| `report_type` | brand publicly ON sale | brand publicly OFF sale |
|---|---|---|
| `sale_active_confirmed` | corroborate | contradict |
| `sale_started` | corroborate (redundant confirm) | **contradict — missed sale** |
| `sale_ended` | contradict | corroborate |
| `no_sale_confirmed` | contradict | corroborate |
| `discount_different` | contradict (state right, data wrong — still needs the admin) | contradict |

The classification is against the state **at scoring time**, not at report
time. A report that contradicted yesterday's state may corroborate today's; we
accept this simplification because reports expire in 14 days and the admin
reconciles the specific claim by hand (`reported_state_at_time` preserves
forensics). Documented failure mode, not a bug.

### 5.3 Confidence

```
anchorDate = lastVerifiedDate ?? cycleStartDate ?? null
if anchorDate == null and no reports: band = 'unknown', confidence = null
                                      (never-verified brand; see §6 E3)
if anchorDate == null but reports exist: start from ageConfidence = 0.5
   (coin-flip belief — no anchor to decay from, but the crowd evidence must
   have something to move; this is what lets E4 push a never-verified
   missed-sale brand into 'red' and to the top of the queue)

age  = max(0, daysBetween(anchorDate, today))          // clamp future dates to 0
ageConfidence = age <= GRACE_DAYS
              ? 1
              : 2 ^ ( -(age - GRACE_DAYS) / HALF_LIFE_DAYS )

// Recency-weighted evidence sums over reports within REPORT_WINDOW_DAYS:
w(report)  = weight(source) * 2 ^ ( -reportAgeDays / REPORT_RECENCY_TAU )
Wc = Σ w over corroborating reports
Wx = Σ w over contradicting reports

// Corroboration lifts toward 1 with diminishing returns:
conf = ageConfidence + (1 - ageConfidence) * (1 - 2^(-Wc))

// Contradiction multiplies down — applied AFTER corroboration so that
// contradiction always dominates a same-weight corroboration:
conf = conf * CONTRA_FACTOR ^ Wx

confidence = max(CONF_FLOOR, conf)
band = confidence >= BAND_FRESH_MIN ? 'fresh'
     : confidence >= BAND_AGING_MIN ? 'aging' : 'red'
```

Worked anchors (uncontradicted): day 7 → 1.0; day 10 → 0.74 (aging); day 14 →
0.5 (aging/red boundary); day 21 → 0.25 (red); day 28 → 0.125. One fresh
contradiction on a just-verified brand: 1 × 0.4 = 0.4 → red. One fresh
corroboration on a 14-day-old anchor: 0.5 + 0.5×0.5 = 0.75 → fresh again.

### 5.4 Re-verify priority & queue

```
impact   = presenceCount * (onSale ? 1 : OFF_SALE_IMPACT)
// Missed-sale override (D12): an off-sale brand with a fresh sale_started
// contradiction is a cycle we are failing to record — treat at full impact.
if (!onSale && hasFreshContradiction) impact = presenceCount
priority = (1 - (confidence ?? 0.5)) * impact     // unknown ≈ coin-flip belief

queue sort: hasFreshContradiction DESC, priority DESC, brandId ASC
```

`unknown`-band brands use 0.5 in the priority formula (uncertainty is real but
not evidence of error) — they interleave mid-queue rather than flooding the top.

### 5.5 Centre aggregates

Over the brands **on sale** at the centre (they are what the public score
asserts): `meanConfidence` (ignoring nulls), `freshShare` = fraction with
`daysSinceVerified <= GRACE_DAYS`, `redCount`, `unknownCount`. A centre with 0
on-sale brands returns nulls and zero counts (nothing is being asserted).

## 6. Edge cases

- **E1 — open cycle, null `last_verified_date`:** anchor falls back to the
  cycle's `start_date` (opening a cycle *was* a verification).
- **E2 — future-dated anchor** (clock skew, manual edit): age clamps to 0.
- **E3 — never-verified brand, no reports:** band `unknown`. It still counts
  toward nothing public (it's off-sale by derivation) and sits mid-queue.
- **E4 — never-verified brand + `sale_started` reports:** classification says
  contradict-vs-off-sale → `hasFreshContradiction` → top of queue. This is the
  missed-sale path and the single most valuable thing the engine does (D12).
- **E5 — duplicate reports:** the DB's one-per-user-per-brand-per-centre-per-day
  unique index is the dedupe; the engine trusts its input. Same user reporting
  at two centres counts twice by design (two observations).
- **E6 — conflicting reports same day** (one says ended, one confirms): both
  count; contradiction dominates at equal weight (`CONTRA_FACTOR^1 = 0.4` beats
  the ≤0.5 lift). The queue surfaces it; the admin decides. Never auto-resolve.
- **E7 — report age > window:** dropped before scoring. `reported_state_at_time`
  keeps forensics in the DB; the engine doesn't read it.
- **E8 — brand present at 0 centres:** impact 0 → priority 0; still scored
  (band may matter for the brand sheet) but never surfaces in the queue.

## 7. Failure modes & degraded operation

- **Reports unavailable** (RLS, network): engine runs age-only — pass
  `reports: []`. Confidence is then a pure verification-age statement; bands
  and queue still work. This is the guaranteed-degradation contract.
- **All anchors stale** (operator on holiday): every on-sale brand slides to
  `red`; centre `meanConfidence` sinks; the public honesty cue ("Updated N
  days ago") ages visibly. **Scores do not move** (D5). Recovery is organic:
  each re-verification restores its brand to 1.0.
- **Report spam / brigading:** bounded by auth + the per-day unique index;
  a single user can move Wx by at most ~1/day/centre. Reporter track-record
  weighting is the designed extension (D6) if this proves insufficient —
  slot: per-report `weight` multiplier from historical accuracy.
- **Clock/timezone drift:** all ages computed in whole UTC days, matching the
  app's existing UTC convention; sub-day precision is deliberately not used.

## 8. Moat lens (D12)

- The engine **protects** the longitudinal dataset by never mutating it (O3
  rejected precisely because auto-closing corrupts cycle history) and by
  making missed sales the loudest alarm (E4) — unrecorded cycles are
  unrecoverable moat loss.
- Confidence metadata persisted alongside daily scores (execution phase)
  time-stamps *how believed* each datum was — provenance that upgrades the
  dataset from "claims" to "verified claims with belief history", which is
  exactly what a timing-edge product needs to be defensible.
- The public honesty cue (verified-freshness surfaced to users) is the
  flywheel: honesty → trust → more crowd reports → cheaper verification →
  deeper dataset.

## 9. Execution-phase glue (NOT in the reference implementation)

1. **Admin re-verify queue** in `admin.html`: fetch inputs (4 queries:
   `brand_sale_events`, open `brand_sale_cycles`, `centre_brands` presence
   counts, `user_reports` last 14 days), call `buildReverifyQueue`, render as a
   new panel above today's triage list. `reasons[]` supplies the row copy.
2. **Gravity pass in `score.js`**: after the score write, compute per-brand
   confidence + per-centre aggregates and persist. Proposed storage: new table
   `brand_gravity (brand_id, score_date, confidence, band, corroboration_weight,
   contradiction_weight)` + columns `centre_seer_scores.mean_confidence,
   fresh_share` (nullable, additive — no back-compat risk). Migration to be
   written at execution time.
3. **Public honesty cue** in `index.html`: the "Updated {when}" line already
   exists; extend with the centre `freshShare`/band once persisted. Copy must
   stay descriptive (no recommendation language — CLAUDE.md verdict rules).
4. Each glue site gets a `TODO(ADR-001 …)` marker; see `DECISIONS.md` TODO list.

## 10. Test plan (implemented in `test/gravity.test.mjs`)

- Age decay: grace boundary (7d = 1.0), half-life points (14d = 0.5, 21d =
  0.25), clamp on future anchor, E1 cycle-start fallback.
- Classification: full 5×2 matrix of §5.2.
- Corroboration lift: diminishing returns; fresh report on stale anchor
  restores `fresh`; old reports (≥ window) ignored.
- Contradiction: single fresh contradiction sends fresh → red; dominates
  equal-weight corroboration (E6); floor holds under many contradictions.
- Bands: boundary values land per §5.1 table; `unknown` for E3.
- Queue: contradiction tier pins to top regardless of priority; missed-sale
  override (E4) at full impact; zero-presence brands never surface (E8);
  deterministic tiebreak.
- Centre aggregates: empty centre nulls; mixed-band arithmetic; unknowns
  excluded from mean but counted.
- Degraded mode: `reports: []` reproduces the pure age model exactly.
