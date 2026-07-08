# ADR-003 — Personalisation ranking: one follows-first formula for feed & history

- **Status:** Accepted (2026-07-08)
- **Deciders:** Site owner (interview answers D4, D8, D11, D12 in `DECISIONS.md`)
- **Reference implementation:** `lib/personal-rank.js` + `test/personal-rank.test.mjs`
- **Reconciles:** the v1.0 personalisation spec (backend shipped via
  `supabase/migrations/20260502_add_personalisation.sql`; document itself not in
  the repo — intent reverse-engineered from the migration + `score.js`) with
  the client-side followed-brands lens that actually shipped to users.

## 1. Problem statement

Two personalisation systems coexist and have never been reconciled:

1. **Server-side (v1.0 spec):** `user_preferences` gender flags +
   `style_clusters` matched against brand attributes
   (`brandMatchesPrefs` in `score.js`) → `personal_tide_scores` written daily →
   `v_personal_scores` view. **Read by nothing.** Its per-user verdicts are
   computed without history (no hysteresis, trajectory hard-coded FLAT), so
   they can emit `Easing`/`Over` claims they cannot honestly make.
2. **Client-side (what users see):** explicit followed brands
   (`user_preferences.brand_ids`) × presence matrix × live `SALE_STATUS`,
   computed in-browser (`getHotCentres(…, personal)`, the centre-hero
   `showPersonal` lens, the My shops / All shops pill). Ranking: count of your
   shops on sale → deepest live discount → density → name. No history, no
   server trace.

Divergent matching bases, divergent formulas, one of them dead code that still
costs a daily write. The spec must pick a canonical model, define the ranking
(including cold start), and give the server pipeline a real job or kill it.

**Constraints:** follows-first, prefs as cold-start fallback (D4); client
computes the live feed, server persists history with the *same formula* (D8);
ranking adds freshness and only freshness — centre-stage context, confidence
weighting, and geo were explicitly declined for v1 (D11); designs deepen the
longitudinal timing dataset (D12); recommendation-language rules from
CLAUDE.md apply to every personal surface (verdict vocabulary is trend-only).

## 2. Options considered

**Canonical basis** — prefs-first per v1.0 (rejected: inference the user never
confirmed; follows are declared intent and are what shipped); follows-only
(rejected: new users get nothing personal at all); **follows-first with prefs
fallback (chosen, D4)**.

**Compute home** — server-only via `v_personal_scores` (rejected:
follow/unfollow wouldn't reflect until the next rescore — worse than today);
client-only, delete the server job (rejected: loses per-user history, the
moat's per-segment timing data); **client live + server history, shared
formula (chosen, D8)**.

**Ranking factors** — count→depth→density (status quo); + freshness
(**chosen**, D11); + centre stage / + gravity confidence / + geo (declined for
v1; noted as extension points, no code paths reserved).

## 3. Decision

One pure module, `lib/personal-rank.js`, owns the personalisation formula:
lens resolution (follows → prefs → global), per-centre personal rows,
freshness scoring, and both sort orders. The browser calls it (inlined — see
§8) for the live feed; `calculatePersonalScores` in `score.js` calls it to
write daily history rows. Because both consumers execute the same functions
with the same constants, they cannot diverge (the failure of the v1.0 era).

### Ranking key (personal feed, "your shops" lens)

A centre qualifies for the personal feed iff ≥1 followed brand is on sale
there. Qualifying centres sort by:

1. **`myOnSale`** desc — how many of *your* shops are dropping (a trip serves
   more of your intent). Primary, unchanged from shipped behaviour.
2. **`freshness`** desc — recency-weighted: new-for-you beats still-on (D11).
3. **`maxPct`** desc — deepest live discount among your on-sale shops.
4. **`personalPct`** desc — your-shops density (`myOnSale/myPresent`).
5. `name` asc — deterministic tiebreak.

Freshness sits **second, not first**: a centre with four long-running sales of
yours still beats a centre with one fresh one — "worth a trip" stays anchored
on how much of your intent a visit serves; freshness discriminates between
otherwise-equal trips. (Considered and rejected: freshness-primary, which lets
a single day-old sale outrank four established ones.)

## 4. Data contracts

```ts
type Lens =
  | { basis: 'follows'; brandIds: Set<string> }   // explicit follows (≥1)
  | { basis: 'prefs';   brandIds: Set<string> }   // cold start: gender∩cluster-matched set
  | { basis: 'global' };                          // nothing to personalise

type UserPrefs = {                    // user_preferences row (subset)
  brand_ids: string[];                // explicit follows
  womenswear: boolean; menswear: boolean; childrenswear: boolean;
  style_clusters: string[];
};

type BrandAtCentre = {
  brandId: string;
  name: string;
  present: boolean;                   // centre_brands.present
  onSale: boolean;                    // live SALE_STATUS / score.js derivation (admin truth)
  maxPct: number|null;                // live cycle max_discount_pct
  daysSinceStart: number|null;        // today − cycle start_date
  daysSincePctChange: number|null;    // today − cycle pct_changed_date (deepening recency)
};

type PersonalRow = {
  centreId: string; name: string;
  myPresent: number; myOnSale: number;
  personalPct: number;                // round(myOnSale/myPresent×100)
  maxPct: number|null;
  freshness: number;                  // §5.2
  onSaleBrandNames: string[];         // for "N of your M on sale · {names}" copy
};

// History row (server pass) — personal_tide_scores, repurposed:
type PersonalHistoryRow = {
  user_id: string; centre_id: string; score_date: string;
  personal_tide_score: number;        // = personalPct, follows-first basis
  matching_brands: number;            // = myPresent
  matching_on_sale: number;           // = myOnSale
  verdict: string;                    // density-only vocabulary — see §5.4
  basis: 'follows'|'prefs';           // NEW column (execution-phase migration)
};
```

## 5. Algorithm

### 5.1 Lens resolution (cold start — D4)

```
resolveLens(prefs, allBrands):
  if prefs?.brand_ids?.length ≥ 1      → { basis:'follows', brandIds: Set(brand_ids) }
  else if prefs has any gender flag or style_clusters:
      matched = allBrands where brandMatchesPrefs(brand, prefs)   // §5.3
      if matched.length ≥ 1            → { basis:'prefs', brandIds: Set(matched ids) }
  → { basis:'global' }
```

- `follows` renders as **"your shops"** everywhere it already does.
- `prefs` uses the same ranking machinery but **must be labelled "For you"**,
  never "your shops" — the user didn't pick these brands, and claiming they
  did erodes the trust the copy rules protect. One follow flips the user to
  `follows` instantly (client-side lens resolution makes this immediate).
- `global` = the existing all-shops experience: rank by `tide_score` desc →
  verdict severity desc (`Peak 5 > Rising 4 > Easing 3 > Quiet 2 > Over 1`) →
  name asc. This mirrors the shipped `getHotCentres` global branch, including
  the small-denominator floor (`totalBrands ≥ HOT_MIN_TRACKED_BRANDS`), which
  does **not** apply to personal rows (your 3 shops are your 3 shops).

### 5.2 Freshness

```
FRESH_TAU_DAYS = 5        // echoes FRESH_WINDOW_DAYS in the Newest Sales panel
freshAge(brand) = min(daysSinceStart ?? ∞, daysSincePctChange ?? ∞)   // ∞ → contributes 0
freshness(row)  = Σ over the user's on-sale brands at the centre of 2^(−freshAge/5)
```

A sale that started (or deepened — `pct_changed_date`, per the Newest Sales
ADR'd behaviour) today contributes 1.0, five days ago 0.5, ten days ago 0.25.
Summing (not averaging) means freshness never *penalises* having more sales —
it can only add discrimination on top of `myOnSale`, so factors 1 and 2 can't
fight each other.

### 5.3 Prefs matching (cold start only)

Exactly `score.js`'s `brandMatchesPrefs`, promoted into the shared module:
gender overlap required (`(prefs.womenswear && brand.womenswear) || …`); if
`style_clusters` is non-empty, `brand.cluster` must be in it. `score.js`
switches to importing this (execution phase) so the definition lives once.

### 5.4 Personal verdict — the honesty rule

Per-user rows have no per-user history, hysteresis, or trajectory, so the
lifecycle vocabulary is **forbidden** on the personal lens: no `Easing`, no
`Over`, and no *local*-peak claims. Allowed, density-only mapping:

| `personalPct` | Verdict |
|---|---|
| ≥ 40 | Peak (density alone justifies it — mirrors `HIGH_TIDE_ENTER`) |
| 15 – <40 | Rising |
| < 15 | Quiet |

This replaces the current server behaviour (`getTideStage(pct, null, 'FLAT',
null)`), which could emit nothing worse than the same three words but did it
by accident; now it is a contract. Recommendation language stays PEAK-badge-
only per CLAUDE.md. The current *client* code path
(`getTideStage(personalPct, 'FLAT')` + `deriveVerdict` in `index.html`)
already lands on these three words; the shared module makes it explicit.

### 5.5 Server history pass (repurposed `calculatePersonalScores` — D8)

Daily, per user × centre: resolve lens; skip `global` users; compute the
`PersonalRow` **with the same functions**; upsert `PersonalHistoryRow`. This
converts today's dead-letter table into the longitudinal per-user dataset:
"your tide" trend charts, brand-alert digests, and per-segment timing
analytics (D12) all read from it. The `basis` column keeps prefs-derived rows
distinguishable from declared follows so segment analytics don't conflate
inferred and declared intent.

## 6. Edge cases (all encoded as tests)

- **E1 follows none present at a centre:** `myPresent = 0` → no personal row;
  the centre simply doesn't qualify (never a 0/0 division).
- **E2 follows present, none on sale:** qualifies for the *centre hero* lens
  (shows "0 of your 3 on sale") but **not** for the personal feed (shipped
  behaviour: `myOnSale ≤ 0 → continue`). Feed = where your shops are
  dropping; hero = truth about the centre you're looking at.
- **E3 null discount (`maxPct`):** excluded from the max; a centre where all
  your on-sale shops lack a % ranks by count/freshness/density with
  `maxPct = null` sorted below any number.
- **E4 null cycle dates:** `freshAge = ∞` → contributes 0 freshness; the row
  still ranks by the other keys (a data gap must not zero the centre out).
- **E5 prefs match zero brands** (e.g. childrenswear-only user, no
  childrenswear brands): lens degrades to `global`, not to an empty feed.
- **E6 duplicate follows / unknown brand ids** (deleted brands linger in
  `brand_ids`): Set semantics dedupe; unknown ids match no presence row and
  contribute nothing. Never throw.
- **E7 ties everywhere:** full key including name asc makes ordering total
  and deterministic (stable across re-renders — no flicker on re-sort).
- **E8 excluded_brand_ids:** not part of ranking; it gates *brand-sale alert
  emails* only (`notify-high-tide`). Documented so nobody "helpfully" filters
  the feed by it.

## 7. Failure modes

- **Prefs row unavailable** (RLS hiccup, logged out): lens = `global`; the
  feed always renders.
- **Live sale data partially loaded:** rows compute from whatever loaded;
  freshness degrades per E4. No cross-source consistency check in v1 (the
  hero already reconciles counts against `centre_seer_scores` upstream).
- **Formula drift between surfaces:** the failure this ADR exists to end.
  Guard: both consumers call `lib/personal-rank.js`; the inline browser copy
  (§8) carries sync markers and a checksum-style comment, and the module's
  tests are the single behavioural spec.
- **History-pass scale:** users × centres rows/day. At current scale trivial;
  the upsert batches. If it grows, partition by `score_date` before touching
  the formula. Skip-`global`-users keeps the table meaningful.

## 8. Execution-phase glue (NOT in the reference implementation)

1. **Migration:** `ALTER TABLE personal_tide_scores ADD COLUMN IF NOT EXISTS
   basis TEXT CHECK (basis IN ('follows','prefs'))` — additive. Existing rows
   (prefs-era) stay null = legacy.
2. **`score.js`:** rewrite `calculatePersonalScores` to import
   `resolveLens` / `buildPersonalRow` / `personalVerdict` from
   `lib/personal-rank.js`; delete its private `brandMatchesPrefs`. Marked
   `TODO(ADR-003)`.
3. **`index.html`:** replace the bespoke personal branch of `getHotCentres`
   with an inlined copy of the module's functions between
   `/* SYNC-START lib/personal-rank.js */ … /* SYNC-END */` markers (the app
   is a single file with no build step — CLAUDE.md; a bundler is out of
   scope). Add the freshness inputs (already loaded: `SALE_START_DATE`,
   `PCT_CHANGE_DAYS`). Marked `TODO(ADR-003)`.
4. **"For you" labelling** for the `prefs` lens on the landing list + centre
   hero — copy work, verdict vocabulary rules apply.
5. **"Your tide" trend surface** reading the repurposed history table —
   separate ticket; the data starts accruing as soon as (2) ships, which is
   why the server pass ships first.

## 9. Moat lens (D12)

The repurposed history table is the direct moat play: per-user, per-day,
per-centre demand-side timing data (when *followed* brands go on sale and how
users' personal tides move) that no scraper of public pages could ever
reconstruct. `basis` separation keeps declared intent (follows) clean —
that's the defensible half. Freshness ranking also feeds the flywheel:
surfacing just-started sales earns the review-nudge crowd reports that keep
the supply-side dataset verified (ADR-001 §8).

## 10. Test plan (implemented in `test/personal-rank.test.mjs`)

- Lens resolution: follows beat prefs; prefs require a gender flag or
  clusters; E5 zero-match degrade; empty/missing prefs → global.
- Prefs matching: gender overlap matrix; cluster filter only when non-empty
  (parity with `score.js`'s current `brandMatchesPrefs` semantics).
- Freshness: τ decay values (0d→1, 5d→0.5, 10d→0.25); `min(start, pctChange)`
  choice (a deepened old sale scores like a new one); E4 nulls; summing
  never penalises extra sales.
- Row building: E1/E2/E3/E6; `personalPct` rounding; name list ordering.
- Feed sort: each key exercised in isolation (fixtures differing only in that
  key) + E7 full-tie determinism; global sort severity/score/name parity with
  shipped `getHotCentres` ordering.
- Personal verdict: boundary values 14.9/15/39.9/40; forbidden vocabulary
  (`Easing`/`Over`) can never be emitted.
- History row shape: basis stamping, skip-global-users.
