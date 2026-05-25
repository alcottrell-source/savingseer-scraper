# Handover — Tide brand-presence rebuild (2026-05-25)

Branch: `claude/tide-brand-presence-rebuild-a8tY6`

This session was cut short because the environment's network policy blocks
all outbound HTTP/HTTPS — no centre directory, no Wikipedia, no aggregator
was reachable (curl: "Host not in allowlist"; WebFetch: 403 from every host
tried). The next session should be started with the **open-internet**
network policy so the 30 directories can actually be fetched. Pick the work
up from "Execution" below.

## The task (verbatim user goal)

Rebuild the Tide brand list around ONE rule applied uniformly to every brand,
existing and new: **presence = number of the 30 tracked centres where the
brand has a store inside the centre** (same town not in the centre does NOT
count). `presence ≥ 2` → include with an accurate 30-int PRESENCE row.
`presence < 2` → remove/omit entirely. The existing PRESENCE matrix is
untrusted — rebuild every row from real centre directories.

## Approved deltas from the original prompt

These were pushed back against and the user approved each change:

1. **`index1.html` doesn't exist.** Drop the "byte-identical" requirement;
   edit `index.html` only.
2. **`brands.js` and `index.html` use different ID systems** (B011 = Zara in
   brands.js, Warehouse in index.html). **Anchor on brands.js IDs** — they
   match Supabase `brand_id`, the production scraper, and
   `ANCHOR_BRAND_IDS` in `admin.html`. Rewrite the inline `BRANDS` array in
   `index.html` to match `brands.js` IDs+names+clusters.
3. **`PRESENCE` in `index.html` is decorative.** Scoring reads from Supabase
   `centre_brands` (`score.js:213`, `score.js:489`). Rebuild **both** the
   inline `PRESENCE` and `centre_brands` so the rule actually takes effect.
4. **No brand-power tier map exists** (only binary `ANCHOR_BRAND_IDS`;
   `score.js:356` says anchor multipliers were deliberately removed). User
   chose: **skip the brand-power step entirely.**
5. **Don't add TK Maxx.** The prompt's "exclude from sale-freshness scoring"
   refers to a scoring model that was removed. Current formula
   (`brandsOnSale / totalBrands × 100`) cannot honestly accommodate a
   permanent discounter. Report it separately as "fails the rule's intent".
6. **New brand IDs start at B095**, not B077. `brands.js` already goes up
   to B094 (B068 and B075 are reused — Lush is currently at B076 in
   `brands.js`; Flying Tiger is B075 — but B068 is genuinely missing, see
   line 549–550 of `brands.js`).
7. **Mountain Warehouse** already exists in `brands.js` at B060 — treat as
   an EXISTING brand whose presence row needs rebuilding, not a candidate
   to add.

## Removals (pre-verified, do not re-check)

Drop these from `brands.js`, the inline BRANDS array in `index.html`, and
`PRESENCE`. Do NOT delete their historical rows from Supabase — leave them.

| brands.js ID | Name |
|---|---|
| B005 | Dorothy Perkins |
| B006 | Wallis |
| B034 | Ted Baker |
| B035 | Karen Millen |
| B039 | Oasis |
| B040 | Warehouse |
| B082 | Burton |
| B087 | Jaeger |
| B091 | Miss Selfridge |

## Candidates to test (keep the list as-is, no beauty extensions)

| Name | Pre-verified seeds (centre indices) |
|---|---|
| Diesel | 2,3,6,7,8 (Westfield London/Stratford, Bluewater, Meadowhall, Bullring) — CONFIRMED |
| Bershka | 4,5 (Trafford, Metrocentre) — CONFIRMED |
| JD Sports | — (full check) |
| Sports Direct | — (full check) |
| Trespass | — (full check) |
| Footasylum | — (full check) |
| Urban Outfitters | — (full check) |
| Victoria's Secret | — (full check) |
| Pull&Bear | likely to FAIL, let the test decide |

JS-heavy candidates → `renderMode: 'browser'`, `manualCheck: true` in
`brands.js`: Diesel, JD Sports, Sports Direct, Bershka, Urban Outfitters,
Footasylum, Victoria's Secret.

## The 30 centres (index → name → likely directory URL)

```
 0 Festival Place         https://www.festivalplace.co.uk/stores
 1 Westquay               https://www.westquay.co.uk/stores
 2 Westfield London       https://uk.westfield.com/london/stores
 3 Westfield Stratford    https://uk.westfield.com/stratfordcity/stores
 4 Trafford Centre        https://www.traffordcentre.co.uk/directory
 5 Metrocentre            https://www.metrocentre.co.uk/stores
 6 Bluewater              https://www.bluewater.co.uk/stores
 7 Meadowhall             https://www.meadowhall.co.uk/shops
 8 Bullring               https://www.bullring.co.uk/stores
 9 Lakeside               https://www.lakeside-shopping.com/stores
10 Liverpool ONE          https://www.liverpool-one.com/stores
11 St David's             https://www.stdavidscardiff.com/shops
12 Cabot Circus           https://www.cabotcircus.com/stores
13 Manchester Arndale     https://www.manchesterarndale.com/stores
14 Brent Cross            https://www.brentcross.co.uk/stores
15 Victoria Leeds         https://www.victorialeeds.co.uk/shops
16 Eldon Square           https://www.eldonsquare.co.uk/stores
17 The Oracle             https://www.theoracle.com/stores
18 The Lexicon            https://www.thelexiconbracknell.com/stores
19 Friars Walk            https://www.friarswalknewport.co.uk/shops
20 Queensgate             https://www.queensgate-shopping.co.uk/stores
21 Broadmead              https://www.bristolshoppingquarter.co.uk/  (BID; no unified directory — flag)
22 Highcross              https://www.highcrossleicester.com/stores
23 Touchwood              https://www.touchwoodsolihull.co.uk/stores
24 Bentall Centre         https://www.bentall-centre.co.uk/stores
25 White Rose             https://www.white-rose.co.uk/stores
26 Cribbs Causeway        https://www.mall-cribbs.com/stores
27 Braehead               https://www.braeheadshopping.co.uk/stores
28 Silverburn             https://www.silverburnshopping.com/stores
29 St James Quarter       https://www.stjamesquarter.com/stores
```

Note on idx 13: file calls it `Arndale`, prompt calls it `Manchester
Arndale` — same place, official name is the longer form. Note on idx 21:
"Broadmead" is a Bristol BID covering Broadmead + The Galleries; no single
directory site. Use `bristolshoppingquarter.co.uk` as proxy and flag any
borderline calls. Bristol has 3 of 30 entries (Cabot Circus idx 12,
Broadmead idx 21, Cribbs Causeway idx 26) — a brand with one Bristol store
should be matched against the right one based on the directory listing.

## Execution (resume from here in the next session)

1. **Fetch all 30 directories.** Use WebFetch on each URL above (or curl if
   the new env allows). Ask each fetch to return the complete A-Z retailer
   list, one name per line, excluding cafes/restaurants/services. Save the
   raw list in `/tmp/centre-NN.txt` for inspection.

2. **Build `centreRetailers[0..29]: Set<string>`.** Normalise names with an
   alias dictionary (M&S ↔ Marks & Spencer, & Other Stories, Levi's, The
   North Face, Cath Kidston, JD Sports ↔ JD, Sports Direct ↔ SportsDirect,
   etc.). Strip suffixes like "Outlet"/"Express"/"Local"/"London".

3. **Brand universe to test** = `brands.js B001..B094 minus the 9 removals
   above + the 9 candidates`. (Mountain Warehouse already at B060 — test
   like an existing brand.)

4. **Compute `PRESENCE[brand_id][0..29]`** by matching normalised retailer
   names against the brand's canonical name + aliases. For each match,
   record whether it's a standalone unit or a named concession (Pandora
   inside John Lewis = counts for Pandora only if the directory names it
   under its own listing). Flag every concession judgement in the report.

5. **Apply the rule.** sum(PRESENCE row) ≥ 2 → keep / add. < 2 → drop.
   Diesel (5), Bershka (2) and TK Maxx (don't add anyway) are pre-seeded.

6. **Write deliverables** (in this commit order):

   **Commit A — removals + presence rebuild**
   - `brands.js`: delete the 9 removed brands.
   - `index.html` lines 2423–2501: rewrite BRANDS array to mirror brands.js
     IDs+names+clusters (carry `womenswear/menswear/childrenswear` over
     from brands.js).
   - `index.html` lines 2503–2589: rewrite PRESENCE object from rebuilt
     matrix. Keep object-keyed shape `{ B001: [30 ints], ... }`.
   - `supabase/migrations/20260525_rebuild_centre_brands.sql`: for every
     `(centre_id, brand_id)` pair in the survivors' new matrix, upsert
     `present=true` or `present=false`. **Do not delete rows** for the 9
     removed brands — preserves history.

   **Commit B — additions**
   - `brands.js`: append new brands (B095+) with scraper config and a
     verified live UK sale URL. JS-heavy ones get `renderMode: 'browser'`,
     `manualCheck: true`.
   - `index.html`: append BRANDS entries + PRESENCE rows.
   - `supabase/migrations/20260525b_add_new_brands.sql`: INSERT new
     `brands` rows + UPSERT their `centre_brands` rows.

7. **QA before push:**
   - Every PRESENCE row is exactly 30 ints, every BRANDS id has a PRESENCE
     row, every PRESENCE key has a BRANDS row. No surviving brand sums to
     `< 2`.
   - `admin.html` line 348 `ANCHOR_BRAND_IDS` still resolves (B001 Next,
     B002 M&S, B003 River Island, B011 Zara, B012 H&M — none removed).
   - `npx serve .` and load `/` — spot-check 3 centres for new chips.
   - Load `/admin.html` — confirm new manualCheck brands appear in the
     selector and removed brands don't.
   - `node --test test/*.test.mjs` passes.
   - Add a small `test/presence.test.mjs` asserting the three invariants
     above.

8. **Final report** (chat reply, not committed): full table of every brand
   → final presence count → KEPT / REMOVED / ADDED / DROPPED, plus all
   concession judgements, plus the TK Maxx note, plus the historical-row
   flag for Supabase.

9. **Push** `claude/tide-brand-presence-rebuild-a8tY6` with `-u origin`.
   Do NOT open a PR — wait for user instruction.

## Files touched (summary)

- `brands.js` — remove 9, add ~7 (whatever passes), update IDs B068/B095+ as needed.
- `index.html` — rewrite BRANDS (lines 2423–2501) and PRESENCE (2503–2589).
- `supabase/migrations/20260525_rebuild_centre_brands.sql` — new.
- `supabase/migrations/20260525b_add_new_brands.sql` — new.
- `test/presence.test.mjs` — new (optional but recommended).
- `HANDOVER-2026-05-25-brand-presence-rebuild.md` — this file; delete or
  archive once the work is shipped.

## Things I deliberately did NOT do

- Did not extend the candidate pool with beauty (Boots/Superdrug/Sephora)
  or other Inditex chains (Stradivarius, Massimo Dutti, Oysho) without
  explicit approval — keep the test universe to what the prompt + this
  doc list.
- Did not assign brand-power tiers — `score.js` doesn't consume them and
  user said skip.
- Did not generate `index1.html` — it doesn't exist in the repo.
