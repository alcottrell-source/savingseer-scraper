# Tide end-to-end tests

Playwright suite covering the **anonymous** user journeys in
`REGRESSION-CHECKLIST.md` (sections A, D, F) plus the auth modal state
machine that signed-out users can touch (B1-style flows).

Authenticated flows (B3-B10) and admin parity (E1-E4) are marked
`test.fixme` — they need a Supabase test user / admin credentials and are
left as TODO when those are available.

## Run

```bash
npm install
npx playwright install chromium    # only needed once; tests will fall back to
                                   # /opt/pw-browsers/chromium-1194 if the
                                   # CDN is unreachable
npx playwright test                # full suite, both projects
npx playwright test --project=desktop-chromium
npx playwright test --project=mobile-chromium
npx playwright test --headed       # see the browser
npx playwright show-report tests/playwright-report
```

The suite automatically starts `npx serve . -l 3000` via `playwright.config.js`
so `npm test` in a clean checkout works without separate setup.

## What's covered

| Test                                              | Checklist | Notes                                                |
| ------------------------------------------------- | --------- | ---------------------------------------------------- |
| Homepage renders header, picker, dropdown         | A1        |                                                      |
| Search filters dropdown; click navigates          | A6, A7    |                                                      |
| Centre detail shows score + narrative + brands    | A8        |                                                      |
| Cookie banner appears + persists choice           | A3        | Tests both first-visit and reload paths.             |
| Feedback bar dismiss persists                     | A4        |                                                      |
| Footer renders                                    | A5        |                                                      |
| Sign in opens auth modal at email step            | A10       |                                                      |
| Bottom-of-list centre stays tappable on mobile    | A11       | Regression for "can't get through" with cookie banner showing. |
| Auth state machine: email → signin                | B1a       | No Supabase round-trip.                              |
| Auth state machine: signin ↔ signup escape paths | B1b       |                                                      |
| Auth: invalid email shows error                   | B1c       |                                                      |
| Password input removed when leaving signin/signup | (custom)  | Regression for the iOS Passwords-keyboard issue.     |
| Centres always render                             | D1        | Iterates a handful of centres.                       |
| No auth-gated UI for signed-out users             | D4        |                                                      |
| Reload from a centre view                         | D5        | Records observation, doesn't fail.                   |
| No uncaught page errors                           | D6        | Distinguishes uncaught throws from deliberate logs.  |
| Mobile viewport: no horizontal scroll             | D7        |                                                      |
| Feedback bar hidden until cookies decided         | D8        | New contract — bar is suppressed during the cookie banner. |
| Notify-banner / feedback-bar mutual exclusion     | D9        |                                                      |
| Initial load within budget                        | F1        |                                                      |
| Centre selection within budget                    | F2        |                                                      |
| Page recovers when Supabase CDN is blocked        | F3        | Vendor fallback at `vendor/supabase.js`.             |

## CDN interception

`gotoFresh()` routes `cdn.jsdelivr.net/npm/@supabase/supabase-js` to the
locally-bundled UMD copy in `node_modules/`. Defence-in-depth — `index.html`
now also has a `vendor/supabase.js` fallback, but keeping the test
interception means the suite runs in sandboxed / offline environments
without depending on either.

## Fixed bugs (formerly the Findings list)

These were surfaced by the suite and have since landed on this branch.
Kept here as a record so reviewers can trace which test maps to which fix.

1. **Centre at the bottom of the suggestion list untappable on mobile first
   visit** (user-reported, A11). Cookie banner z-index 700 covered the
   lower portion of the dropdown. Fix: bump `body.is-search-open
   .picker-section` to z-index 800 (`index.html:80`) and skip the desktop
   search auto-focus while cookies are pending.
2. **Cookie banner overlapped feedback bar dismiss × on mobile** (D8). New
   contract: `#feedback-bar` is gated on `localStorage.tide_cookies_skimlinks`
   being set, so the overlap can't happen. Driven by a new
   `tide:cookies-decided` CustomEvent fired from `acceptCookies` and
   `rejectCookies`.
3. **Notify-banner / feedback-bar overlapped on mobile** (D9). Mutual
   exclusion: `showNotifyBanner` hides the feedback bar; the matching
   hide / dismiss helpers re-call `showFeedbackBarIfReady`.
4. **Page broke entirely if jsdelivr was unreachable** (F3). Bundle now
   ships in `vendor/`. `index.html` falls back via document.write when the
   CDN fails; `admin.html` uses the local importmap path directly.
5. **CLAUDE.md drift** — corrected: prefs wizard is 5 steps, and
   onboarding no longer auto-opens for new users.

## Out-of-scope reminders

The `B3`-`B9` and `E1`-`E2` placeholders are valid `test.fixme` entries.
To turn them on:

- Provide a disposable Supabase test user in env (`TIDE_TEST_EMAIL`,
  `TIDE_TEST_PASSWORD`) and replace the `fixme` calls with real specs.
- For magic-link flows, Mailosaur (or similar API-based inbox) lets you
  programmatically retrieve the OTP without polling Gmail.
- Admin parity needs an admin-credentialled Supabase user against
  `admin.html`.
