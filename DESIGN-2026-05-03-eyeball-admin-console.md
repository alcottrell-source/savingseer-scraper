# Design note — Eyeball admin console for sale-status accuracy

3 May 2026
Status: **proposal, not implemented**
Author: handover from scraper-accuracy session

---

## Problem

Auto-detecting whether a brand has a "real" sale on is unreliable. Brands keep permanent `/sale` URLs, persistent "Shop Sale" links in nav, year-round 10–15% loyalty offers, and standing clearance sections. Heuristic detection (banner phrases, discount-% regex, markdown prices) trades one class of false positive for another and can never get to the >95% accuracy a user needs to trust the app.

Friends-and-family feedback round on 3 May confirmed: of ~14 brands flagged on-sale, only 2 actually were (&Other Stories 20%, H&M 15%). Everything else was a false positive from the old detector. The narrowed detector on `claude/fix-sale-status-accuracy-gie01` will help but still relies on heuristics on whole-page text.

For the soft-launch stage, **a human in the loop will outperform any heuristic**. This proposal puts one there cheaply.

---

## Proposal

Daily snapshot capture + a password-gated `/admin` page that lets one person eyeball every brand and override the scraper's verdict. The dashboard reads the manual override first; the scraper value becomes a fallback / first-guess.

### What gets captured

For each brand, every day:
- Homepage screenshot (e.g. `cos.com`) — most authoritative signal, brands hero a real sale on the front door
- `/sale` page screenshot — what the scraper sees today
- Both stored as compressed JPGs (~100–200 KB each)

### Where it's stored

Supabase Storage bucket `brand-snapshots/`, path `YYYY-MM-DD/<brand_id>-home.jpg` and `…-sale.jpg`. Auto-prune >30 days.

Cost: ~75 brands × 2 shots × 150 KB × 30 days ≈ **600 MB**. Well inside Supabase's 1 GB free-tier storage.

### New table

```
brand_manual_overrides
  brand_id          text PK
  sale_status       boolean        -- the human's call
  max_discount_pct  int  null
  set_at            timestamptz
  set_by            text           -- e.g. 'alex'
  expires_at        timestamptz null  -- sticky window, see below
  notes             text null
```

### Read path

Dashboard's `loadSupabaseBrandData()` (`index.html`) joins overrides:

```
sale_status      = override.sale_status      ?? scraper.sale_status
max_discount_pct = override.max_discount_pct ?? scraper.max_discount_pct
```

Override always wins inside its `expires_at` window. Outside the window it lapses and the scraper takes over again.

### The admin page

`/admin` (or a separate Vercel route). Password-gated via a single env var (`ADMIN_PASSWORD`) checked client-side against a hashed value, or wrapped in Vercel password protection — whichever is simpler. No accounts, no auth flow.

Layout: scrolling grid, one row per brand. Each row shows:

| Brand | Homepage thumb (today) | /sale thumb (today) | Scraper says | Manual override | Notes |
|---|---|---|---|---|---|
| COS | [thumbnail, click → full] | [thumbnail] | On sale (no %) | ⚪ off / ⚫ on / discount % | "no sale, just clearance" |

Default sort: brands where the scraper *changed state* since yesterday at the top. Then brands with active overrides about to expire. Then everything else alphabetical.

Bulk-save at the bottom.

### Sticky overrides

A bare override toggle would mean re-eyeballing the same off-sale brand every day. Instead each override carries an `expires_at`:

- "Off for 7 days" — covers a normal week of feedback rounds
- "Off until further notice" — null `expires_at`, hold indefinitely
- "On for 3 days at 30%" — short, for live sales the scraper missed

Default on save = 7 days. Sale starts/ends are real events and a week is short enough not to drift far.

---

## Daily ops

Estimated time-on-task once it's running:

- Sort surfaces ~5–15 brands a day where scraper state changed (most days; spikes around Boxing Day / Easter / EOSS)
- Visual eyeball + override = ~5–10 seconds per brand
- ~2 minutes/day in steady state, ~10 minutes/day during big sale events

Far cheaper than chasing heuristic regressions.

---

## Implementation cost

Rough sizing — junior dev, single sitting:

- Screenshot capture in `scraper.js` Playwright pass — half day (Playwright already loaded; add `page.screenshot()`, retry-on-fail, upload to Supabase Storage)
- New `brand_manual_overrides` table + migration — 30 min
- Dashboard read-path join — 30 min
- `/admin` page (vanilla HTML, hits Supabase via the existing client) — half day
- End-to-end test on staging Supabase — half day

≈ **2 days total**, no new dependencies.

---

## Open questions for project chat

1. **Homepage vs /sale capture — both, or pick one?** Homepage is more authoritative for "is there a real sale right now". `/sale` is what the scraper saw. Both helps the eyeballer triangulate but doubles storage. *Recommendation: capture both, since storage is cheap and the second view often resolves ambiguity in 1 second.*

2. **Override semantics — sticky-with-expiry, or always-fresh?** Sticky cuts daily review load but risks holding wrong state past a real sale start. *Recommendation: sticky 7 days default, with a "sale events override sticky" rule — the moment the scraper detects a state change with strong evidence (clear "% off" headline), the override expires regardless of clock.*

3. **One eyeballer or many?** A single ADMIN_PASSWORD is the easiest gate. If multiple people need access, we'd want Supabase Auth + roles. *Recommendation: one password for now; revisit if/when the team grows past 1 reviewer.*

4. **What's the SLA for overrides showing in the app?** With Vercel + the dashboard's existing Supabase pull on page load, an override saved at 14:02 is live for the next user at 14:03. Acceptable, but worth flagging — there's no caching layer to invalidate. *No action needed unless we add a CDN cache.*

5. **Scope — does this ever go away?** This is a soft-launch crutch. As we grow we'll want detection that's accurate enough to stand alone. The eyeball console captures the *labelled training data* (human verdict + screenshot) we'd need to fine-tune a real model later. Worth designing the override table with that downstream use in mind from day one.

6. **Brand homepage URL — where does it come from?** `brands.js` only has `/sale` URLs. We'd add a sibling `homepage` field (mostly the brand root domain). ~75 entries to add, ~30 min of one-time work.

7. **Do we surface the screenshot to *users* anywhere?** E.g. "tap to see what the sale looks like today" on each brand chip? Probably no — too noisy and slow on mobile — but the data's there if a feature wants it later.

---

## What this replaces / coexists with

- **Replaces:** the heuristic detector as the *source of truth*. The scraper still runs and still writes `brand_sale_events`, but the dashboard treats it as a hint, not a verdict.
- **Coexists with:** all existing scoring logic (`score.js`), the daily Tide score, history chart, etc. Those still consume `sale_status` — they just consume the human-corrected version.

The narrowed detector on `claude/fix-sale-status-accuracy-gie01` is still worth merging in parallel: it lowers the daily review burden by raising the scraper's first-guess accuracy.

---

## Decision needed

Go / no-go on the 2-day build, plus answers (or strong leans) on questions 1–3 above.
