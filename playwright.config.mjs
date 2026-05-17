// Playwright config for the read-only verdict-alignment E2E suite.
//
// This suite runs in GitHub Actions (.github/workflows/e2e.yml), NOT in the
// dev sandbox — the sandbox has no browser and its network policy blocks the
// Playwright CDN + Supabase. CI is the only place this can actually execute.
//
// Target: a Vercel PREVIEW deployment of the branch, passed in via the
// PREVIEW_URL env var. It is strictly READ-ONLY against production Supabase
// (loads centres, asserts the rendered DOM). It never authenticates and
// never writes a row.
//
// NOTE: selectors are inferred from the single-file inline app (index.html
// has no test ids). The first CI run is expected to double as DOM discovery —
// failures attach the rendered outerHTML + a screenshot so the selectors can
// be corrected from the Action logs.

import { defineConfig, devices } from '@playwright/test';

const PREVIEW_URL = process.env.PREVIEW_URL;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: PREVIEW_URL,
    // NOTE: do NOT set extraHTTPHeaders for the Vercel bypass here — it is
    // global and would attach x-vercel-* headers to EVERY request including
    // cross-origin ones (Supabase, fonts), turning them into non-simple
    // CORS requests whose preflight those origins reject, which breaks the
    // app's own data load. Instead each test primes the Vercel bypass
    // COOKIE once (see beforeEach), scoped to the preview domain, so no
    // custom header is ever sent to a third-party origin.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
