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

## Notes

- `brands.js` is shared brand config used by `score.js`, `summarise.js`, `seed.js`,
  and `extract-floors.js` — not scraper-only; it stays.
- `playwright` remains a dependency for the read-only e2e suite (`npm run test:e2e`),
  not for scraping.
- The frozen `brand_sale_events.sale_status` / `date_first_detected` / `scraper_error`
  columns are left in the schema (unread) — no migration was needed.
