// Playwright config for Tide end-to-end tests.
//
// The suite drives a headless Chromium against `npx serve .` on port 3000
// and exercises every signed-out journey in REGRESSION-CHECKLIST.md
// (sections A, D, F) plus the auth modal state-machine surface that
// signed-out users can touch (B1, B2 partial).
//
// Auth-required flows (B3+, E*) need a Supabase test user and are out of
// scope for this run. They're stubbed as `test.fixme` so they show up in
// the report as known-skipped rather than silently absent.

import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// Sandboxed environments often can't reach Playwright's CDN. If a prebuilt
// Chromium is present on disk, use it directly — bypasses the version-pinning
// check that `npx playwright install` enforces.
const PREBUILT = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = fs.existsSync(PREBUILT) ? PREBUILT : undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npx --yes serve . -l 3000 --no-clipboard',
    url: 'http://localhost:3000',
    timeout: 30_000,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
