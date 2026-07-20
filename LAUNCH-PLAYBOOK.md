# Tide launch playbook — from zero users (20 Jul 2026)

Status check run 20 Jul 2026 against the live workflows, search index, and repo.
Context: the acquisition machine from `TIDE_ACQUISITION_AUDIT.md` was fully
built and merged on 18–19 Jul (deploy-hook step, `/brand/` head-query pages,
crawlable homepage links, guides, weekly blog posts, OG images, attribution).
**The machine is built but three switches are off, and Google has indexed
zero pages of tidego.co.** Nothing here is mysterious — the site went
properly crawlable ~48 hours ago and the freshness loop was never armed.

## 1. Switches only the owner can flip (do these first — ~30 minutes total)

### 1a. Create the Vercel Deploy Hook (5 min) — the whole freshness fix hangs on this
Verified today: the 12:08 UTC `daily-scrape` run warned
`VERCEL_DEPLOY_HOOK_URL secret not set — static SEO pages stay frozen at the
last git push.` Every page titled "sales today" is frozen at the 19 Jul deploy.

1. Vercel → Project Settings → Git → Deploy Hooks → create hook, branch `main`.
2. GitHub → repo Settings → Secrets and variables → Actions → new secret
   `VERCEL_DEPLOY_HOOK_URL` = the hook URL.
3. Next 10:00 UTC run should log "Vercel rebuild triggered" instead of the warning.

### 1b. Google Search Console + Bing Webmaster Tools (15 min)
`site:tidego.co` returns nothing on any engine — the site is unindexed. The
verification metas already ship (`index.html` head, `BingSiteAuth.xml`), so:

1. In GSC, confirm the property exists and **submit `https://tidego.co/sitemap.xml`**
   (Sitemaps → add). Then use URL Inspection → "Request indexing" on the
   homepage, 2–3 `/brand/` pages (e.g. `/brand/zara`), and 2–3 `/centre/` hubs
   to jump the queue.
2. Same in Bing Webmaster Tools (it can import the GSC property in one click).
3. From now on GSC → Performance is the acquisition source of truth; check weekly,
   not daily.

Code-side accelerator shipped with this doc: **IndexNow** — every production
build now submits all generated URLs to Bing/DuckDuckGo automatically
(`seo/generate.mjs`, key file at repo root). Google ignores IndexNow, hence
step 1 above.

### 1c. Replace the dead Gemini model (10 min, owner decision)
`summarise.js` has been failing every day since ~1 Jun: `gemini-2.0-flash-lite`
was deprecated 1 Jun 2026 and its free-tier quota is now literally 0 (today's
run: "0 written, quota exhausted, limit: 0"). Centre narratives have been
template fallbacks for 7 weeks. CLAUDE.md's "don't switch models" note predates
the deprecation. Options, best first:

- Pay-as-you-go on a current flash-lite model — 24 short calls/day costs pennies/month.
- A current free-tier flash-lite model if its RPD cap comfortably exceeds 24
  (check https://ai.google.dev/gemini-api/docs/rate-limits — caps changed in
  Apr 2026).
- Or accept template narratives and delete the step.

Not acquisition-critical, but the "Centre Intelligence" card is a
differentiator on every centre page, including the SEO ones.

## 2. What to expect (so zero users this week doesn't read as failure)

- The SEO surface (≈ hundreds of intent-matched static pages) went live 19 Jul.
  Indexing takes days-to-weeks after sitemap submission; **rankings take 4–8
  weeks**. The audit's estimate stands: brand-head queries ("when does zara go
  on sale") ranking even modestly ≈ low thousands of visits/month by autumn.
- Kill-criterion instrument: GSC impressions per page type (`/brand/` vs
  `/centre/` vs `/guides/`). If `/brand/` pages get impressions but no clicks
  after 6 weeks, retitle; if no impressions, investigate indexing.
- Meanwhile the only way to get users **this week** is distribution by hand —
  section 3. SEO is the compounding channel; posting is the ignition.

## 3. Week-one distribution (manual, ~2 hours total, ready to paste)

Rules of engagement: post as yourself, say you built it, one community at a
time, reply to every comment. Builder-transparency posts outperform stealth
promotion and never get modded. July timing is genuinely good: summer sales
are mid-cycle and several centres are FALLING — "last chance" is an honest,
urgent hook.

### 3a. Local subreddits / Facebook groups (highest signal — do 3–4 centres you know)
Every tracked centre has a city subreddit (r/Southampton for WestQuay,
r/Manchester for Trafford Centre, …) and several "X shopping centre /
residents" Facebook groups. Template — fill the two numbers from the live
centre page first:

> **I built a free site that tracks how many shops are on sale at {Centre} —
> right now it's {N} of {M}**
>
> I got tired of trekking to {Centre} only to find the sales had been
> picked over, so I built a tracker. It gives the centre a daily "Tide Score"
> (% of its big shops on sale, verified by hand — no scraping guesswork) and
> tells you whether the sale season there is rising, peaking, or ending.
> Right now {Centre} is at {score}% — {one honest sentence, e.g. "past its
> peak, so this weekend is last-chance territory"}.
>
> Free, no signup needed to look: https://tidego.co/centre/{slug}
> Happy to answer anything — I hand-verify the sales myself, so if a shop's
> status is wrong tell me and I'll fix it.

### 3b. r/InternetIsBeautiful (one shot, use it when the deploy hook is live)
> **A live "tide chart" for UK shopping-centre sales — see whether a centre's
> sale season is rising, peaking, or over before you go**
>
> Tracks ~90 big-name brands across 24 UK centres, hand-verified daily. Each
> centre gets a score (% of shops on sale) and a 60-day curve like a tide
> chart, so you can time the trip instead of gambling.
> https://tidego.co

### 3c. MoneySavingExpert forum (Shopping & Freebies board) + HotUKDeals discussions
Same skeleton as 3a but lead with the money angle: "time the trip, catch the
peak week, know when a sale is about to end". MSE regulars are exactly the
persona; be plain that it's your own site (both communities require it).

### 3d. Amplify what lands
Whichever post gets traction: the share button on every centre page produces
a branded score PNG + `/centre/` link — use it in replies. The peak-alert
one-field form is the conversion point; watch `seo_alert_signups` and
`funnel_events` counts the day after each post.

## 4. What deliberately NOT to do yet
(Per `GROWTH-PLAN.md` — unchanged by this playbook.)
- No paid ads, no referral push until the alert loop demonstrably delivers.
- No new centres — verification throughput is the constraint, not breadth.
- No web push, no browser extension until search demand is proven.
