# Tide — Project Knowledge

*Last aligned with the codebase: 5 July 2026. This document is written for a Claude
Project's knowledge base — it explains the **product** (what it is, who it's for, how
it behaves, what it promises) rather than engineering conventions. For implementation
detail, file layout, and "how to build this" rules, see `CLAUDE.md` in the repo root.*

## 1. What Tide is

**Tide** (tidego.co) tells UK shoppers the single day a shopping centre's sales are
actually worth a trip. It tracks the real brands across UK shopping centres and
surfaces one honest number per centre, per day: the **Tide Score**, the percentage of
tracked brands genuinely on sale right now. When lots of brands discount at once, the
centre is "at high tide" and worth the trip. When it's quiet, the user is told to stay
home.

Tagline: *"Tide — when UK shopping centres are worth the trip."*
One-line pitch (site meta description): *"Tide tracks the brands you actually buy
across UK shopping centres and tells you the day sales peak — so you never make a
wasted trip to the shops."*

It is a free consumer web app (no build step, static site + Supabase backend),
currently live, early-stage, and built and operated solo by Alex Cottrell (UK-based
individual data controller — see §10).

## 2. The problem it solves (origin story)

The founder's own story (published as the "Why I built Tide" blog post) is the
clearest statement of the problem and is worth treating as canonical positioning:

> A trip to Westquay: saw "SALE" in a window, drove over, parked, walked the whole
> centre floor by floor, and found a couple of token rails at 10% off while
> everything wanted was full price. A wasted journey — petrol, parking, a chunk of
> the weekend, gone.

Two structural reasons this keeps happening to shoppers:

1. **You can't see a whole centre at once.** A window sign tells you nothing about
   whether it's a real, centre-wide event or three shops clearing old stock.
2. **Sales build, they don't switch on.** The first day of a "sale" is often the
   *worst* day to go — only the keenest brands have started and discounts are
   shallow. The calendar says "January sales"; it doesn't say which day is worth
   the trip.

Tide's answer: treat a sale season like a tide, not a light switch. Track it daily,
surface the one day it peaks, and tell people to go then.

## 3. Who it's for

UK shoppers who have a small list of brands/retailers they actually buy from and who
shop at physical shopping centres (not pure online shoppers). The personalisation
model assumes a user has "their shops" — a handful of followed brands — and Tide's
biggest value-add over the generic (anonymous) experience is scoring a centre against
*that specific list*, not just the centre as a whole.

## 4. Core concept: the Tide Score and verdict vocabulary

**Formula:** `tide_score = round(brands_on_sale / total_brands × 100)` — the percentage
of a centre's tracked brands that are verified on sale today. This is deliberately a
plain, checkable fact: a user can verify the score themselves against the "X of Y
shops on sale" figure shown on the same page. There is no freshness weighting and no
hidden multiplier in the headline number.

Every centre is scored daily and classified into a **stage**, each with its own
**verdict** word and headline copy. Recommendation language ("go", "worth it", "don't
wait") is reserved *only* for the PEAK badge — every other state describes direction,
never gives an instruction:

| Stage | Score | Verdict | Headline | Badge |
|---|---|---|---|---|
| Turning (cycle not started, or only a couple of brands) | 0–14 | Quiet | **QUIET** | — |
| Rising | 15–39 | Rising | **RISING** | — |
| High Tide (centre-wide) | ≥40 (hysteresis at 30 on the way down) | Peak | **PEAK** | **GO NOW** |
| High Tide (local peak, below 40) | ≥15 and today is the day trajectory flips from rising to falling | Peak | **PEAK** | **GO NOW** |
| Falling | 8–29 post-peak | Easing | **EASING** | — |
| Low | <8 post-peak | Over | **OVER** | — |

Two things worth understanding about this table:

- **Every centre gets a peak day**, even ones that never break the 40% "global"
  threshold — a smaller centre can still register a genuine local peak (the point its
  trajectory turns from rising to falling) and gets the same GO NOW treatment for that
  one day. The next day it automatically rolls into Easing.
- **"Quiet" intentionally covers both zero and "a couple of brands."** A centre with
  one or two brands on sale isn't meaningfully different from a centre with none, from
  a "should I go" standpoint — both mean nothing worth a trip yet.

Score, verdict, and the on-screen "N of M shops on sale" count are always drawn from
the same server-computed source for a centre+day — they cannot contradict each other
on screen.

## 5. What the product actually does (feature tour)

### Landing / discovery
A centre picker (search + dropdown across every tracked UK centre) is the entry point
for anonymous visitors. Signed-in users who follow ≥1 brand get a personalised
**"Your shops today"** watchlist instead: only centres where at least one followed
brand is on sale, ranked by breadth then depth of discount. A global **"Today's tide"**
list (ranked by verdict severity, then score — Peak > Rising > Easing > Quiet > Over)
is always available underneath for discovery, whether or not the user has a
personalised list.

### Centre detail page — the core screen
For a chosen centre, the hero panel ("tide vessel") shows, per metric lens (your
followed shops / the whole centre):
- a big percentage figure,
- "N of M on sale" (the density fact behind the percentage),
- a weekly movement line ("▲ up from X% last week"),
- the verdict word (the only place besides the PEAK badge that carries any
  recommendation tone), and
- a plain-language statement tying the verdict to a point in the sale cycle (e.g.
  "near the top of this cycle").

A signed-in user who follows brands present at that centre sees **both** lenses side
by side (their shops vs. the whole centre); everyone else sees the whole-centre lens
only.

Below the hero sits a history chart (7D / 30D / 60D / MAX views) plotting the real,
stored daily score — never smoothed, backfilled, or rescaled — with a small marker on
the crest of each completed peak episode (the historically optimal day to have gone).
Below that, a "Centre Intelligence" narrative (see §7) and the brand grid for that
centre.

A **"My shops / All shops" pill** lets a follower switch the lens used by the brand
grid below the hero (it does not change which verdict is authoritative — that's
always the whole-centre call).

### Shop (brand) detail sheet
Tapping any brand chip opens a bottom sheet with that brand's current status, its full
verified sale history (episodes, not a daily log), a 12-month rhythm chart, and a
contextual call to action — "See it on {brand} →" (this is the app's one affiliate
surface, see §8) when the brand is currently linkable and live, or an "alert me" stub
otherwise. **This surface is strictly descriptive** — no predicted end dates, no
forecast of the next sale. Tide only ever describes what has verifiably happened or is
happening now.

### Sharing
Users can generate and share a branded "tide card" image for a centre (score, verdict,
GO NOW pill when relevant, shop count, verified timestamp) — useful as the app's
lightweight organic-growth loop.

### Accounts, preferences, notifications
- A 4-step auth flow (email → sign in / sign up → magic-link confirmation).
- A "My Tide" account panel for signed-in users (saved centres, alert toggles, edit
  preferences, sign out).
- A first-time preferences wizard (gender → style clusters → notifications & saved
  centres → preview) that personalises which brands and centres matter to that user.
- Three email notification types, each independently toggle-able: a **peak alert**
  when a saved centre hits Peak, a **brand-sale alert** the day a followed brand's
  sale starts, and a **weekly digest** (Friday evenings) summarising any saved centre
  at Rising or above. All three are trend/state notifications, never predictive.

### Admin console
An internal, non-public tool where an operator manually verifies each brand's sale
status per centre. This is the only way sale state enters the system (see §6) — there
is no consumer-facing "admin" concept, but it's worth knowing it exists because it is
the source of truth behind every score, verdict, and history point the product shows.

## 6. Where the data comes from — "admin-verified, not scraped"

This is a defining, differentiating property of the product and should never be
described otherwise: **Tide does not scrape retailer websites for live sale status.**
An earlier automated scraper was removed. Sale state is now entirely
**admin-verified** — a human operator checks each brand (via its "open shop" link and
crowd-sourced user reports) and confirms a sale in the admin console. That
confirmation is what creates and closes each brand's sale "cycle," which in turn is
what the Tide Score, the history chart, and the shop detail sheet are all built from.

The practical implication for how to talk about the product: Tide's numbers are
**verified facts**, not inferred or scraped signals — that's the basis for the "you
can check it yourself" trust claim in the founder's positioning ("the share of shops
we track that are genuinely on sale today, confirmed against verified sale data, not
scraped hype").

Scores recompute automatically (a daily pipeline, plus an instant recompute after any
admin edit), so the public site reflects verified reality within seconds of an
operator confirming a sale, not just once a day.

## 7. Centre Intelligence narrative

Each centre carries a short (1–2 sentence) AI-written narrative under its score,
describing what's happening in plain language — which brands just started a sale,
which look picked-over. It is generated once a day by an automated pipeline and is
**strictly descriptive**: the generation prompt explicitly forbids both numbers and
recommendation language. The headline verdict word and the PEAK badge remain the only
places the product tells a user what to do.

## 8. Business model

Tide is free to use. The only monetisation surface today is an **affiliate
commission** on the "See it on {brand} →" link in the shop detail sheet — the app
discloses this in-product ("Tide may earn a commission. You never pay more.") and it
never affects which brands are shown, how they're scored, or what the narrative says.
There is no subscription, paywall, or ad surface anywhere in the product today.

## 9. Brand, voice, and design principles

- **Descriptive, never predictive, everywhere except the PEAK moment.** This is the
  single most important copy rule in the product. Every surface — the vessel headline,
  the narrative, the shop sheet, the weekend digest email — describes direction
  ("rising," "easing," "quiet") using verified, checkable facts. The *only* place the
  product tells someone what to do is the PEAK badge / GO NOW moment. Do not draft
  copy, features, or narrative content that implies a forecast, an estimated end date,
  or a "worth it" judgement outside that one moment.
- **One honest, checkable number.** The Tide Score is designed so a user can verify it
  themselves against the shop count shown right next to it. Avoid describing the score
  in vibes/marketing language ("hot!", "don't miss out") — its credibility rests on
  being plain and checkable, in deliberate contrast to a retailer's own "SALE" signage.
- **Visual identity:** a single calm cream canvas; one action green per surface
  (`--leaf` on light surfaces, a neon `--tide-neon` signal green on dark surfaces,
  never mixed); a muted sage-green (never blue) for "whole centre" comparison lines
  against the neon "your shops" line; Playfair Display for display/emotional
  headlines and the logo wordmark, Inter for everything functional including figures.
  A dark "tide vessel" is the visual centrepiece of the centre-detail hero.
- **The tide metaphor is load-bearing**, not decorative — score history is presented
  as a literal tide chart, "high tide"/PEAK is the good moment to visit, and the whole
  premise (sales come in and go out, timing matters) is named directly in the product.

## 10. Company & legal

Tide is operated by **Alex Cottrell**, an individual data controller registered in the
UK (not a limited company as of this writing). Privacy contact: `privacy@tidego.co`.
The product is subject to UK GDPR / Data Protection Act 2018; users have a one-click
"delete my account" option in "My Tide."

## 11. Current scope & deliberate non-goals

Useful to know what Tide **deliberately does not do**, so as not to propose or
describe features that conflict with its current positioning:

- **No predictions.** No estimated end dates for a sale, no forecast of when the next
  sale will start. Everything shown is either happening now or verifiably happened in
  the past.
- **No automated scraping.** Sale state is human-verified, by design — this is a trust
  differentiator, not a stopgap being worked around.
- **No per-brand "stage."** The Peak/Rising/Quiet/Easing/Over stage machinery exists
  only at the centre level, computed from the mix of verified brands at that centre. A
  single brand's detail sheet shows a much simpler live/resting/watching state, never
  a score.
- **No paid tier, ads, or paywall** — the only revenue surface is affiliate commission
  on outbound retailer links.
- Coverage is currently several dozen UK shopping centres and is actively growing;
  treat centre/brand counts as a moving target rather than a fixed catalogue.

## 12. Glossary

- **Tide Score** — the daily 0–100 score for a centre: % of tracked brands verified on
  sale today.
- **Verdict** — the named stage a centre's score maps to: Quiet, Rising, Peak, Easing,
  Over.
- **High Tide / PEAK / GO NOW** — the single state where Tide actively recommends a
  visit.
- **Local peak** — a one-day PEAK called for a centre whose score never reaches the
  40% global threshold, triggered instead by its own rising→falling trajectory flip.
- **Sale cycle / episode** — one admin-verified continuous sale period for a brand
  (open = live/ongoing, closed = a past, completed sale). The unit the shop detail
  sheet's history and aggregates are built from.
- **Your shops / whole centre** — the two lenses the product can score and chart a
  centre through: only the user's followed brands present at that centre, vs. every
  tracked brand at that centre.
- **Centre Intelligence** — the short AI-generated narrative under a centre's score.
- **Admin console** — the internal tool where an operator verifies brand sale status;
  the sole source of sale-state truth in the product.
