# SEO engine (programmatic pages) — v1

Generates static, Google-readable pages for shopping-centre + brand sale searches
(e.g. "when does Next go on sale at Westquay?"). v1 covers ONE centre —
`westquay-southampton` — and its present brands (1 hub + ~N brand pages).

## Why this exists
The main app (`index.html`) renders content client-side from Supabase, which Google
struggles to read/rank. These pages bake the answer into static HTML at build time, so
they rank — and each carries an email opt-in that converts a search visitor into a
segmented (centre + brand) audience member.

## How it works
- `seo/generate.mjs` runs at **build time** (Vercel `buildCommand`, set in `vercel.json`).
  Server-side, so it reads Supabase with `@supabase/supabase-js` directly.
- It writes `centre/<slug>/index.html`, `centre/<slug>/<brand>/index.html`, and
  `sitemap.xml` into the repo root, which Vercel serves statically.
- Generated files are **git-ignored** — they're rebuilt fresh on every deploy.
- "Daily refresh" (ISR equivalent): `daily-scrape.yml` POSTs the Vercel **Deploy Hook**
  after the scorer + summariser finish, so the Tide Score on each page stays current.
  Needs the `VERCEL_DEPLOY_HOOK_URL` repo secret (create the hook in Vercel:
  Project Settings → Git → Deploy Hooks, branch `main`). Without the secret the
  step warns and skips — pages then freeze at the last git push.
- **IndexNow**: after writing the sitemap, production builds (`VERCEL_ENV`)
  POST every generated URL to `api.indexnow.org`, so Bing/DuckDuckGo re-crawl
  within hours instead of waiting for a sitemap poll. The key is public by
  design and served from `/<key>.txt` at the repo root. Google ignores
  IndexNow — Search Console + sitemap covers Google. Soft-fails; set
  `INDEXNOW_DISABLE=1` to switch it off.

### Files
| File | Role |
|---|---|
| `next-sale-window.mjs` | UK retail-calendar → "next big sale window" (national signal, not a per-centre prediction). Pure + tested. |
| `render.mjs` | Pure HTML templates (brand page, centre hub). Includes the admin-verified `isOnSale` rule, FAQ JSON-LD, and the browser opt-in (raw PostgREST, never supabase-js). |
| `generate.mjs` | Loads data (Supabase or `--fixtures`), enforces "no data, no page", writes files + sitemap. |
| `fixtures.westquay.json` | Mock data for local preview only. |

## Rules honoured (do not break)
- **Admin is source of truth.** `isOnSale()` reads `active_cycle_id` / `last_verified_*`
  only — never the scraper's raw `sale_status`. (Mirrors `score.js` + `index.html`.)
- **Browser writes use raw PostgREST**, not supabase-js (which hangs in the browser).
- **No data, no page.** A centre with no current Tide Score is skipped entirely.
- **No thin brand pages.** A brand gets its own `/centre/<c>/<brand>` page only if it
  has a live sale OR at least one tracked sale cycle (`hasPage` in `generate.mjs`). A
  brand that's off-sale with zero history would render a near-duplicate template (only
  the brand + centre name differ) — exactly what Google buckets as "Crawled – currently
  not indexed". Skipped brands stay on the centre hub roster (as plain text, keeping the
  "X of Y tracked" count honest) but get no URL and no sitemap entry.
- **No pages, no deploy.** If the data load fails or 0 pages are produced, the build
  **fails** (non-zero exit) so Vercel keeps the last good deploy live — shipping an
  empty `sitemap.xml` would 404 every already-indexed `/centre/` page at once. Set
  `SEO_ALLOW_EMPTY=1` to override (intentional teardown / genuinely empty site).

## Local preview (no DB needed)
```
npm run seo:sample      # writes pages to .seo-sample/ from fixtures
```
Open `.seo-sample/centre/westquay-southampton/index.html` in a browser.

## Go-live checklist (production)
1. Run the signup-table migration: `supabase/migrations/20260603_add_seo_alert_signups.sql`,
   then the delivery migration `supabase/migrations/20260717_seo_alert_delivery.sql`
   (adds `last_notified_at` + `unsub_token`). Signups are DELIVERED by
   `notify-high-tide` pass 4 — centre rows the day the centre enters Peak, brand
   rows the day the brand's sale starts, blog rows when any centre peaks — with a
   one-click unsubscribe served by `api/unsubscribe.js`.
2. In the Vercel project, ensure env vars exist: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   (already used by `api/rescore.js`) **and add `SUPABASE_ANON_KEY`** (needed by the
   in-page opt-in). Optionally `SEO_ORIGIN` (defaults to `https://tidego.co`).
3. Deploy. Verify `https://tidego.co/centre/westquay-southampton` renders with real data.
4. ~~Add a daily **Deploy Hook** call to the scoring cron so scores stay fresh.~~
   **Done** — `daily-scrape.yml` fires the hook after each scoring run. One-time
   setup remains: create the Deploy Hook in Vercel and add its URL as the
   `VERCEL_DEPLOY_HOOK_URL` repo secret.
5. Submit `https://tidego.co/sitemap.xml` once in Google Search Console.
6. Wait 4–8 weeks; watch which pages rank before scaling to more centres (v2).
