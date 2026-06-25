# Tide — Dark-Theme Rebrand Inventory

A complete map of everything that carries the current "fishy / washy" look, so a
designer (or ChatGPT) can reskin Tide to a dark theme without missing a surface.

**TL;DR for handing to ChatGPT:** the *entire* visual identity lives in **one
file** — `index.html`. All styling is in **two `<style>` blocks** (lines
`39–861` and `5390–5469`) plus ~50 colours hard-coded inside JS template strings.
Give ChatGPT (1) the two style blocks, (2) the 7 screenshots, (3) the palette
table below, and (4) the "hard-coded hotspots" list, and it has everything it
needs. See **§4 How to give ChatGPT complete understanding** at the bottom.

---

## 1. The current design system (the thing being rebranded)

### Fonts (Google Fonts)
| Family | Role |
|---|---|
| **Playfair Display** (serif) | Big numbers, verdict words, headlines, centre names |
| **Cormorant Garamond** (serif) | The "TIDE" wordmark/logo |
| **Inter** (sans) | All body text, labels, buttons, meta |

### Colour tokens — `:root`, index.html lines 41–63
This is the literal palette being replaced. A dark theme is mostly a matter of
re-targeting these, **but ~28% of colours don't read from these variables** (see §3).

```
/* Light/"washy" base */
--cream:   #FAF7F2;   --bark: #2C1810;   --leaf: #3D6B35;  --leaf-lt: #EEF4EC;
--amber:   #C17A2B;   --amber-lt: #FBF2E4;  --red: #B84C3A;  --red-lt: #FAEAE7;
--stone:   #6B5F52;   --stone-lt: #F2EFE9;  --border: rgba(44,24,16,0.10);
--card-border: 1px solid rgba(44,24,16,0.14);
--card-elev:   0 1px 2px rgba(44,24,16,0.06), 0 10px 30px rgba(44,24,16,0.10);

/* Bright/accent greens */
--green-bright: #00A862;  --green-bright-lt: #E0F4EA;

/* "Rebrand additions" already in the file (dark-leaning tokens, partly used) */
--ink: #14110E;  --ink-mid: #2E2823;  --ink-light: #5C5048;
--gold: #B8935A; --gold-light: #D4AF78;
--green-deep: #3A6B4A; --green-light: #5A8C6A;
--tide-cream: #F5F1EB; --tide-cream-dark: #EDE8E0;
--tide-card-bg: rgba(253,250,247,0.9);  --tide-border: rgba(26,22,18,0.08);

/* Neon accent — reserved for dark cards / the history line */
--tide-neon: #5EFFB0;
--tide-neon-soft: rgba(94,255,176,0.55);
--tide-neon-glow: 0 0 10px rgba(94,255,176,0.55), 0 0 22px rgba(94,255,176,0.22);
```

> Note: the centre-detail hero + landing chart are **already dark** (`--ink` /
> `--tide-neon`). A clean dark rebrand is partly "make the rest of the app agree
> with the cards that are already dark," not invent something new.

### The page background
`body` paints a mall line-art photo (`bg-mall.jpg`) under an 82%-opacity cream
wash (index.html line 66). The "washy" feel comes mostly from **this + the cream
cards**. Killing the wash / swapping the cream is the single highest-leverage move.

---

## 2. Feature & surface inventory (everything to restyle)

Grouped by area. Screenshots referenced as [S1]–[S7] (see §4).

### A. Global chrome
- **Header / sticky nav** — TIDE wordmark (animated brass-bar SVG logo), "KNOW WHEN TO GO" tagline, **My Tide / Sign in** pill button. [S1–S7, all top bars]
- **Footer** — "Tide · Updated daily at 07:00 · Live sale data · {date}", animated live-dot, links (Blog/Privacy/Contact/Cookies).
- **Feedback strip** — "Tide is brand new. Tell us what's useful… Share feedback →" (amber link, bottom of most screens). [every screenshot]
- **Install-app banner** — "Never waste a trip. Tap Share → Add to Home Screen…". [S5]
- **Cookie consent banner** — dark bottom card, Accept/Decline.

### B. Landing / search home  [S6]
- **Search hero** — "Never make a wasted trip to the shops." headline + sub + rounded **centre search** input with autocomplete dropdown.
- **"Your centres"** — saved-centre cards (name + location + chevron) with **Edit** mode (remove circles).
- **"All centres · Today's tide"** — ranked hot-centre list: rank · name · location · **big % + verdict word** (e.g. `71.9% PEAK`) · "X of Y shops on sale · newest first" · brand monogram tiles + **NEW** badges + age labels (`2d`, `4d`). [S6, S7]
- **All-centres 60-day average chart** — dark card, neon-green line, **7D/30D/MAX** tabs, "Rising ↑" trend pill. [S7]
- **How Tide works** / hero showcase proof card (gradient % + gold verdict + growth pill).

### C. Centre-detail hero (the "vessel")  [S5]
- **Centre identity** — back button, **Save**/**Share** pill buttons, centre type eyebrow, location, logo tile, centre name (Playfair).
- **Score gauge / vessel** — flat-black card: **large `%`** + verdict word (`Go now`/`Rising`/`Easing`/`Over`/`Quiet`), tone-coloured. [S5 `63% Go now`]
- **"Verified {when}"** badge with glowing green dot.
- **Saved-shops line** — "N of your shops on sale · Accessorize, AllSaints, Ann Summers +17 more". [S5]
- **Count line** — "25 of 40 shops on sale, up from 9 two weeks ago." [S5]
- **History chart** — bold neon-green line on flat black, fixed 0–100% axis, faint gridlines, **amber peak-dots**, **7D/30D/60D/MAX** tabs. [S5]
- **Centre Intelligence narrative card** — 1–2 sentence trend copy + "Today's top sales" rank list + opening-hours strip.

### D. Brand lists (on a centre)  [S2]
- **"On sale" list** — brand chips: logo · name · "Up to 50%" · day counter (`24d`) · live dot · ↗ open-shop link · left-edge **freshness colour bar**. [S2 Diesel row]
- **"Not on sale" list** — grouped by category (Premium Casual / Activewear / Accessories…), muted chips. [S2]
- **Swipe-to-action** on chips — reveals red "End" / green "Started" report buttons.
- **"New sales" view** — "8 new sales", numbered list, **7D/30D/60D/MAX** tabs, "X days" recency, hours-left line. [S4]
- **"Brands at this centre"** — "My brands (25) / All brands (56)" filter tabs, "ON SALE · NEWEST FIRST", rows with "Up to 50% · 2d ●". [S3]

### E. Brand detail bottom sheet (`#ts-sheet`, `ts-*`)  [S1]
- Grab handle, pager `‹ 1/25 ›`, close ✕.
- Brand identity (logo + name + category + **stage chip**: "On sale" sage / "Resting" / "Watching").
- **"On sale now / Up to 50% off"** headline + "Started 24 Jun · live 2 days so far". [S1]
- **Facts grid** — On record / Avg length / Deepest. [S1 `2 sales / 21 days / 50% off`]
- **Sale-rhythm chart** — episode blocks, "now" marker, month axis. [S1]
- **"Every sale on record"** — episode rows: date range + **LIVE** gold tag + % + **depth bar** + length. [S1]
- **CTA** — "See it on {brand} →" (affiliate) or **Alert-me** stub; commission note.

### F. Auth & account
- **Auth modal** — 4-step state machine: email → signin (password) → signup → "check your inbox" magic-link; sample-email preview cards; error/success boxes.
- **My Tide account panel** — email, saved-centres pills, 3 notification toggles (peak alert / brand-sale alert / weekend digest), invite-link copy row, Edit preferences, Sign out / Delete.

### G. Preferences / onboarding wizard (`ob-*`, `pref-*`)
- Full-screen takeover, **5 progress dots**, back/skip.
- Step 1 gender cards → Step 2 style-cluster brand chips (3-col grid, active=green) → Step 3 notification toggles + saved centres → Step 4 score preview (mini gauge + scale).

### H. Reporting & feedback
- **Report-a-sale sheet** — brand head + % chips (10/25/50) + green CTA + success toast.
- **Notify / waitlist banners** — email capture ("alert me when this peaks"), UK-only waitlist variant.
- **Survey card** — amber "Help shape Tide" prompt.
- **Toasts** — dark bark bg, green success icon.

### I. Other pages (separate files)
- `admin.html` (operator console — own palette), `privacy.html`, `404.html`,
  `tide-detail-prototype.html` (the canonical visual reference for the bottom sheet).

---

## 3. ⚠️ Hard-coded colour hotspots (won't change from a token swap)

~**186 hex** + ~**104 rgba** literals appear in the file; roughly **a quarter are
baked into JS template strings / component CSS, not the `:root` variables.** A dark
rebrand must touch these by hand or they'll stay light and break the theme:

| Zone | Where | Notes |
|---|---|---|
| **Bottom sheet (`ts-*`)** | 2nd `<style>` block, lines **5390–5469** | Entire self-contained palette: `#FAF6EF` bg, `#1C2A45` ink, `#BC8A2E` gold, `#6E8E63` sage, `#9A9CA3`/`#C9CBD0` stone, `#ECE4D6` hairlines. Mirrors `tide-detail-prototype.html`. |
| **Verdict tone overlays** | `.tide-vessel.verdict-go/rise/fall/wait` (~350–357) | Hard-coded linear/radial gradients per verdict. |
| **Verdict word / trend tones** | `tone-go #FFD79A`, `tone-rise #9FD8B0`, `tone-fall #F4B79F`, `tone-wait` (~167–169, 338–341) | |
| **Arc gauge widget** | `renderArcWidget()` JS (~3909–3970) | Stage label colours `#3D6B35 #C17A2B #B84C3A #8C8070` built into SVG strings. |
| **History chart SVG** | `buildTideChartSVG` / `renderTide60Light` JS | Neon line, gridlines, amber peak-dots emitted as inline SVG attributes. |
| **Hero showcase gradients** | `.hero-card-pct` / `.hero-card-verdict` (~403–406) | white→taupe and gold gradient text. |
| **Body background wash** | line 66 | The cream-over-photo wash that drives the "washy" feel. |

> Practical implication for ChatGPT: ask it to **first migrate these literals to
> CSS variables**, then theme via the variables. Otherwise a "dark mode" will
> leave the bottom sheet, gauge, and chart stuck in light mode.

---

## 4. How to give ChatGPT complete understanding (so it can rebrand *all*)

You have a rare advantage: **it's a single static file with no build step**, so
ChatGPT can see the whole visual system at once. Best options, in order:

**Option A — Full-file paste (most complete).** Paste the two `<style>` blocks
(`index.html` lines `39–861` and `5390–5469`) **plus the 7 screenshots**. Tell it:
"This is the entire stylesheet for a one-file web app; here's how each screen
looks. Propose a dark theme by (1) rewriting the `:root` tokens and (2) listing
every hard-coded colour outside `:root` that also needs changing." The screenshots
give it the visual; the CSS gives it the structure. This is enough to reskin
everything.

**Option B — This document + screenshots.** Hand it *this file* + the 7 PNGs. It's
a compressed map (every surface, every hotspot, the token table) — smaller than the
full CSS and already flags the non-variable colours. Good for the *strategy /
prototype* conversation you said you want.

**Option C — Two-pass refactor-then-theme (cleanest result).** Ask ChatGPT (or me)
to first do a no-visual-change refactor that moves the ~28% hard-coded colours into
`:root` variables. After that, the rebrand is literally "swap the token values,"
and any prototype it makes will apply app-wide in one edit. This is the most robust
path if you want light + dark to coexist.

**Screenshots inventory** (label them when you paste):
- **[S1]** Brand detail bottom sheet — Pandora "On sale now" + facts grid + rhythm + episode list.
- **[S2]** Centre brand lists — Diesel on-sale row + "Not on sale" by category.
- **[S3]** "Brands at this centre" — My/All filter tabs, on-sale newest-first.
- **[S4]** "New sales" view — 8 new sales, 7D/30D/60D/MAX tabs, hours-left.
- **[S5]** Centre-detail hero — Westfield London `63% Go now`, verified badge, count line, neon chart.
- **[S6]** Landing / search home — "Never make a wasted trip", saved centres, Today's tide.
- **[S7]** Landing continued — ranked centres with % PEAK + 60-day all-centres chart.

**One thing to decide before prototyping:** keep the **neon-green-on-black**
direction that the hero/chart already use (just extend it across the app), or go a
different dark palette entirely. The cards in [S5]/[S7] are a ready-made anchor if
you like that look.
