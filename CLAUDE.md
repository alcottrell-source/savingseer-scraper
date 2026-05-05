# Savingseer / Tide — Claude context

## Project overview
Single-file static web app (`index.html`) deployed to Vercel. No build step. Talks directly to Supabase for auth and data. Scraper/scorer logic lives in separate Node scripts (`scraper.js`, `score.js`).

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

## Database
Supabase project: `vrezzwadwzrmumjpdgge.supabase.co`
Key table: `user_preferences` — one row per user, RLS enforced (users can only read/write their own row).

## Deployment
Vercel, output directory is `.` (repo root). No build command. Preview deployments available per branch.
