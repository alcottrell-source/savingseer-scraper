# Savingseer / Tide — Claude context

## Project overview
Single-file static web app (`index.html`) deployed to Vercel. No build step. Talks directly to Supabase for auth and data. Pipeline lives in separate Node scripts: `scraper.js` (scrape brand sale state) → `score.js` (compute Tide Score per centre) → `summarise.js` (Claude-written 1–2 sentence Centre Intelligence narrative).

## Running locally
```bash
npx serve .
# opens at http://localhost:3000
```

## Auth & registration (updated May 2026)

### What exists
The auth modal is a **4-step state machine** driven by `authShowStep(step)`:

| Step | ID | Purpose |
|------|----|---------|
| `email` | `#auth-step-email` | User enters email, clicks Continue or requests magic link |
| `signin` | `#auth-step-signin` | Returning user — password field, magic link fallback, "new here?" escape |
| `signup` | `#auth-step-signup` | New user — create password (8+ chars), "already have account?" escape |
| `magic` | `#auth-step-magic` | Confirmation: "check your inbox" shown after OTP send or email-confirm signup |

Key functions: `authContinue()`, `authSignIn()`, `authSignUp()`, `authMagicLink()`, `authShowStep(step)`.

### "My Tide" account panel
Signed-in users clicking the nav button open `#account-panel` (not the prefs wizard). It shows:
- Their email
- Saved centres list
- Go Now alert + daily digest toggles (inline quick-save via `quickSavePref(key, value)`)
- "Edit shopping preferences" → opens prefs wizard
- Sign out

`onAuthBtnClick()` routes to `openAccountPanel()` if signed in, `openAuthModal()` if not.

### First-time onboarding
`onAuthStateChange` fires `openPrefsModal()` only when `!userPrefs` (no row in `user_preferences` table). Previously used a fragile gender-field check — don't revert to that.

### Preferences wizard (`#prefs-modal`)
4-step wizard: gender → style clusters → notifications + saved centres → preview. Opens automatically for new users and via "Edit shopping preferences" in the account panel. Saves via upsert on `user_preferences` with `onConflict: 'user_id'`.

## Centre Intelligence narrative (May 2026)
The card under each centre's score shows a 1–2 sentence trend narrative. It's generated daily by `summarise.js` (Gemini 2.5 Flash, free tier) and stored in `centre_seer_scores.narrative` for that centre+date. The front-end reads the column and falls back to a template narrative when the column is null (first run on a new centre, summariser skipped, or `GEMINI_API_KEY` absent). Don't add live API calls from the browser — keep generation in the daily pipeline.

Required env var on the GitHub Action's `score` job: `GEMINI_API_KEY` (repo secret). Free tier covers 1500 req/day; we use ~30.

## Database
Supabase project: `vrezzwadwzrmumjpdgge.supabase.co`
Key tables:
- `user_preferences` — one row per user, RLS enforced.
- `centre_seer_scores` — per-centre, per-day Tide Score + verdict + `narrative` (anon read enabled).

## Deployment
Vercel, output directory is `.` (repo root). No build command. Preview deployments available per branch.
