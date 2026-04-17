# Savingseer scraper

Daily sale-signal scraper for 71 UK retail brands. Runs free on GitHub Actions.

## How it works

1. **Pass 1 — Cheerio** (fast, static HTTP): hits each brand URL, parses the HTML,
   looks for sale banners, class names, and text patterns.
   Takes ~5–10s per brand. Costs nothing.

2. **Pass 2 — Playwright** (headless Chromium): retries any brand that Cheerio
   couldn't read — either because the site blocked the request or the page needs
   JavaScript to render. Takes ~20–30s per brand.

3. Results write to `./results/scores.json` and push to Google Sheets.

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd savingseer-scraper
npm install
npx playwright install chromium --with-deps
```

### 2. Add your brands

Edit `brands.js`. Each entry needs:
- `id` — unique slug (used as the Sheets row key)
- `name` — display name
- `url` — the page to scrape (sale landing page preferred over homepage)
- `selectors` — optional CSS selectors that confirm a sale
- `renderMode: 'browser'` — optional, skips Cheerio for known JS-heavy sites

### 3. Set up Google Sheets

1. Create a Google Cloud project and enable the Sheets API.
2. Create a service account and download the JSON key.
3. Share your Google Sheet with the service account email (Editor role).
4. Set up your sheet with this structure in a tab called `SeerScores`:
   - Row 1: headers — `Brand ID` | `Brand Name` | (date columns added automatically)
   - Row 2+: one row per brand, with `id` in column A and `name` in column B

### 4. Configure GitHub secrets

In your GitHub repo → Settings → Secrets → Actions, add:

| Secret | Value |
|---|---|
| `SHEET_ID` | Your Google Sheet ID (from the URL) |
| `GOOGLE_CREDENTIALS` | The service account JSON key, stringified |

To stringify the key file:
```bash
cat your-service-account-key.json | jq -c .
```
Paste the single-line output as the secret value.

### 5. Test locally

```bash
# Set env vars
export SHEET_ID=your-sheet-id
export GOOGLE_CREDENTIALS=$(cat your-key.json | jq -c .)

# Run
npm run scrape
```

Results appear in `./results/scores.json`.

## Tuning brand selectors

When a brand is consistently returning the wrong result:

1. Open the brand URL in Chrome DevTools
2. Inspect the sale banner element
3. Note the class name (e.g. `.sale-event-banner`)
4. Add it to the brand's `selectors` array in `brands.js`
5. Add `renderMode: 'browser'` if the banner is JS-rendered

## GitHub Actions schedule

The workflow runs daily at 06:00 UTC. To change the time, edit
`.github/workflows/daily-scrape.yml` — the `cron` field.

You'll get an email from GitHub if a run fails (>10% brand error rate).
Results are stored as workflow artifacts for 30 days.

## Cost

- GitHub Actions: free (2,000 min/month; typical run ~25–40 min)
- Crawlee + Playwright: open source, free
- Google Sheets API: free
- Total: £0/month
