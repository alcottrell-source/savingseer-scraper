# Tide — Handover (follow-up)
3 May 2026 *(scraper-accuracy patch)*

Repo: https://github.com/alcottrell-source/savingseer-scraper
Live: https://v0-tide-sale-timing.vercel.app
Branch: `claude/fix-sale-status-accuracy-gie01` (pushed, **not yet merged to `main`**)

Builds on the same-day handover at `HANDOVER-2026-05-03.md`. Single scoped change to `scraper.js`.

---

## Headline

Sale-detection accuracy fix. The scraper was flipping brands on-sale based on the bare word "sale" appearing anywhere on the page, which produced indefinite false positives on `/sale` URLs that had been repurposed into "sale ended" or "coming soon" announcements. Hugo Boss was the reported case — `hugoboss.com/uk/sale/` shows "THE SALE HAS NOW ENDED" but the dashboard still listed it as on-sale at "10d in".

---

## Root cause

`detectSale` in `scraper.js` was OR'ing `confirmText` matches across the lowercased body:

```js
const hasConfirmText = brand.confirmText.some(t => bodyText.includes(t.toLowerCase()));
// brand.confirmText is ['sale', 'up to', '% off'] for every brand in brands.js
```

`/sale` landing pages contain the word "sale" in the URL, nav, breadcrumbs, the end-of-sale H1 itself, and any `.sale` element. So `hasConfirmText` was always true on a `/sale` URL — even after the sale had ended. Once `sale_status=true` was set, `date_first_detected` stuck and the brand stayed on-sale indefinitely. The `reset_brand_sale_cycle` RPC at `scraper.js:191-201` was never triggered because the input never flipped back to false.

Same failure mode applies to any brand whose `/sale` URL is currently a sale-ended or coming-soon announcement — user reported having seen "another occurrence" of this beyond Hugo Boss.

---

## Fix — `scraper.js:30-119`

`detectSale` is now three layered checks (negative override → upcoming guard → stronger positive evidence):

1. **Negative override.** `SALE_ENDED_PHRASES` (e.g. `"sale has ended"`, `"the sale has now ended"`, `"sale is over"`, `"sale ended"`, etc.) → return `onSale=false, discountPct=null` outright. This also suppresses any stale "Up to 70% off" copy lingering on the ended-sale page so we don't surface a phantom discount pill.

2. **Future-tense guard.** `SALE_UPCOMING_PHRASES` (`"sale starts"`, `"sale begins"`, `"sale coming soon"`, `"sign up for sale alerts"`) → return false **unless** the page also has active-sale evidence (a strong-phrase hit or a discount %). Handles brands running one sale while announcing the next.

3. **Stronger positive evidence.** `onSale=true` now requires one of:
   - a discount-% pattern (`up to N% off` / `save up to N%` / `N% off`)
   - an active-sale CTA from `STRONG_SALE_PHRASES` (`"shop the sale"`, `"sale now on"`, `"save up to"`, `"final reductions"`, `"further reductions"`, etc.)
   - markdown-price markers (`now £X.XX`, `was £X now £Y`)

   Bare-word "sale" no longer counts. Bare `.sale` selector hits no longer count. Both fire on `/sale` URLs even when the sale has ended.

`brands.js` is untouched — the per-brand `confirmText` and `saleSelectors` arrays are now ignored by the new positive logic, but kept in place to avoid touching all 75 brand entries. Worth a follow-up cleanup if anyone wants to slim the brand config.

---

## Validation

Ad-hoc test harness covering 9 cases — all pass:

| Case | Expected | Actual |
|---|---|---|
| Hugo Boss "THE SALE HAS NOW ENDED" page | not on sale | not on sale |
| Sale link in nav only, no banner | not on sale | not on sale |
| Active sale w/ "Up to 70% off" banner | on sale (70%) | on sale (70%) |
| Active sale w/ "Was £49.99 Now £24.99" markdown | on sale | on sale |
| Active sale w/ "Shop the Sale" CTA only | on sale | on sale |
| Future-tense "Black Friday Sale Begins November 24" | not on sale | not on sale |
| Future-tense + parallel active sale ("Up to 50% off") | on sale (50%) | on sale (50%) |
| Sale-ended page w/ stale "Up to 70% off" lingering | not on sale | not on sale |
| Plain homepage, no sale signal | not on sale | not on sale |

---

## What lands when

- **Branch pushed**, not merged to `main`. Vercel deploys `main`, so the dashboard is unchanged until merge. Open PR + merge to ship.
- **Effect first visible at the next 06:00 UTC scrape** (GitHub Actions). Brands whose `/sale` URL now reads as ended will flip `sale_status` → `false`, which triggers `reset_brand_sale_cycle` (`scraper.js:191-201`) and clears `date_first_detected`. They'll drop off the on-sale list and disappear from the green-dot rows.
- To force-validate sooner: trigger the scraper workflow manually from GitHub Actions after merge.

---

## Likely cleanups for the brands at this centre — Hugo Boss case in particular

Once the next scrape runs, expect these brands to flip from on-sale → not-on-sale (any whose `/sale` URL currently shows ended-sale wording or has no discount evidence):

- **Hugo Boss** (B049) — confirmed reported
- Anyone else flagged by user as "another occurrence" — was not named, but the new logic handles them generically

The 8 May 2026 morning dashboard should match the live brand sites within ±1 day of merge.

---

## Commits

- `b1037f6` `fix(scraper): don't mark a brand on-sale just because the page contains the word "sale"`

Branch: `claude/fix-sale-status-accuracy-gie01`
Pushed to origin. No PR opened (per instructions).

---

## Open items

1. **Merge this branch** to `main` so the next scheduled scrape picks up the fix.
2. **Optional cleanup:** `brand.confirmText` and `brand.saleSelectors` in `brands.js` are now ignored by the positive-detection path. Either repurpose them (e.g. per-brand strong phrases for sites that don't fit the generic STRONG_SALE_PHRASES list) or delete from all 75 entries.
3. **Monitoring suggestion:** add a periodic sanity check that any brand sitting on `sale_status=true` for >60 consecutive days gets manually reviewed — that duration is well beyond a normal seasonal sale and is a reliable smell for a stuck detector. Cheap query against `brand_sale_events` + a Slack/email ping.
4. **Carry-over from earlier today** (`HANDOVER-2026-05-03.md`): Next (403) and FLANNELS (HTTP/2) scraper failures still unresolved. Unrelated to this fix.
