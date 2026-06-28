# Tide — technical notes

The automated **scraper was removed (Jun 2026)**. Sale state is now **admin-verified
only**: an operator confirms each brand's sale in the admin console (`admin.html`),
which writes `brand_sale_cycles` + `brand_sale_events` (`active_cycle_id` /
`last_verified_status`). Operators find sales via each card's "open shop" link and
the crowd **user-reports** signal — there is no scraper.

## Daily pipeline (GitHub Actions)

`.github/workflows/daily-scrape.yml` runs once a day at **10:00 UTC** (and on manual
dispatch):

1. `node score.js` — computes the Tide Score + verdict per centre into
   `centre_seer_scores`, and rebuilds each centre's `tide_history` (rolling 180-day
   window).
2. `node summarise.js` — writes the 1–2 sentence Centre Intelligence narrative
   (soft-fails if `GEMINI_API_KEY` is unset).

Required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (both jobs) and
`GEMINI_API_KEY` (summariser).

## Running locally

```bash
npm install
npx serve .            # static site at http://localhost:3000  (and /admin)
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run score
```

## Social cards (Instagram) — `scripts/social.mjs`

On-demand generator for branded 1080×1350 PNGs to post when sales move. Reads the
same live columns as the public site, so the images can't contradict the dashboard.
Three card types:

- **centres** — "Where the sales are": top centres ranked by verdict severity then
  Tide Score (PEAK → GO NOW chip, then Rising/Easing/Quiet).
- **peak** — "Peak right now": only the centres currently at PEAK. Skipped (not a
  blank post) when nothing is peaking.
- **brands** — "Biggest sales now": brands on sale ranked by max discount, with how
  many centres each is on sale at.

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run social          # all three → social-out/
npm run social -- --type=peak --limit=5                        # one type, custom count
npm run social:demo                                            # sample data, no DB/network
```

Renders via Playwright/Chromium (already a dependency; reuses Playfair + Inter).
Output lands in `social-out/` (gitignored) — regenerate any time. READ-ONLY against
Supabase (only `select` queries).

## Notes

- `brands.js` is shared brand config used by `score.js`, `summarise.js`, `seed.js`,
  and `extract-floors.js` — not scraper-only; it stays.
- `playwright` remains a dependency for the read-only e2e suite (`npm run test:e2e`),
  not for scraping.
- The frozen `brand_sale_events.sale_status` / `date_first_detected` / `scraper_error`
  columns are left in the schema (unread) — no migration was needed.
