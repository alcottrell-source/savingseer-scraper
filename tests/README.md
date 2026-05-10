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
| Auth state machine: email → signin                | B1a       | No Supabase round-trip.                              |
| Auth state machine: signin ↔ signup escape paths | B1b       |                                                      |
| Auth: invalid email shows error                   | B1c       |                                                      |
| Password input removed when leaving signin/signup | (custom)  | Regression for the iOS Passwords-keyboard issue.     |
| Centres always render                             | D1        | Iterates a handful of centres.                       |
| No auth-gated UI for signed-out users             | D4        |                                                      |
| Reload from a centre view                         | D5        | Records observation, doesn't fail.                   |
| No uncaught page errors                           | D6        | Distinguishes uncaught throws from deliberate logs.  |
| Mobile viewport: no horizontal scroll             | D7        |                                                      |
| Cookie + feedback overlap                         | D8        | **Mobile-only `test.fail`** — see Findings below.    |
| Initial load within budget                        | F1        |                                                      |
| Centre selection within budget                    | F2        |                                                      |

## CDN interception

`gotoFresh()` routes `cdn.jsdelivr.net/npm/@supabase/supabase-js` to the
locally-bundled UMD copy in `node_modules/`. This means the suite runs in
sandboxed / offline environments — and a CDN outage doesn't break local CI.
Production-time loading from jsdelivr still happens normally for end users.

## Findings

Real bugs / drift surfaced while writing the suite:

1. **(D8) Mobile cookie banner overlaps feedback bar** — `index.html`'s
   `#cookie-banner` (z-index 700, `bottom: 12px`) covers the feedback bar
   (`#feedback-bar`, `bottom: 0`) on viewports ≤ ~600px. A first-time visitor
   trying to dismiss the feedback bar clicks the cookie banner instead. Fix
   options: hide the feedback bar while cookies are pending, or stack the
   feedback bar above 12px so it sits clear of the cookie banner. Test is
   marked `test.fail()` on mobile only.

2. **CLAUDE.md drift** — the project notes describe the prefs wizard as
   4 steps (gender → style clusters → notifications + saved centres → preview),
   but `index.html` actually renders **5 steps** (audiences → categories →
   brand grid → centres → notifications). Update CLAUDE.md, or simplify the
   wizard.

3. **CLAUDE.md drift** — the project notes describe `onAuthStateChange`
   firing `openPrefsModal()` for new users. Code at line ~1239 of
   `index.html` was changed to **not** auto-open onboarding; new users see a
   "Personalise your Tide Score" promo card instead. CLAUDE.md should
   reflect that.

4. **No defence against jsdelivr being down** — `index.html` loads
   `@supabase/supabase-js` via `<script src="https://cdn.jsdelivr.net/...">`.
   When that fails (we triggered it via cert errors in the sandbox), the
   inline script throws at `supabase.createClient(...)` and the page is
   completely broken — clicking Sign in throws a TDZ error because the
   script body never reached `let currentUser = null;`. Bundling the SDK
   locally (or shipping a fallback `<script>`) would harden this.

## Out-of-scope reminders

The `B3`-`B9` and `E1`-`E2` placeholders are valid `test.fixme` entries.
To turn them on:

- Provide a disposable Supabase test user in env (`TIDE_TEST_EMAIL`,
  `TIDE_TEST_PASSWORD`) and replace the `fixme` calls with real specs.
- For magic-link flows, Mailosaur (or similar API-based inbox) lets you
  programmatically retrieve the OTP without polling Gmail.
- Admin parity needs an admin-credentialled Supabase user against
  `admin.html`.
