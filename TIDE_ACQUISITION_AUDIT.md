# TIDE — Customer Acquisition Audit (Stage 1)

Date: 2026-07-18. Scope: acquisition only. Findings only; no fixes proposed here.

**Read this first — the three sentences that matter:**

1. TIDE is **not structurally invisible** — unusually, the codebase already has real programmatic SEO: static, crawler-visible, intent-matched pages generated from live Supabase data at build time (`seo/generate.mjs`, wired as the Vercel `buildCommand`, `vercel.json:3`). The brief's worst-case assumption (hand-written pages, JS-only rendering) does not apply.
2. But the machine is **switched off between git pushes**: nothing rebuilds the site after the daily 10:00 UTC scorer, so every page titled "{centre} sales today" serves data frozen at the last deploy — the daily Deploy Hook is a written-down, unbuilt TODO (`seo/README.md:19,63`; no hook call exists in any workflow).
3. And the machine is pointed at the **wrong end of the demand curve**: every brand page is centre-scoped (`/centre/<slug>/<brand>`), so the ~88 brand-only head queries — "when does Zara go on sale" — have **zero dedicated pages (0% coverage)**, while the homepage links to **none** of the money pages in its static HTML.

---

## A. Current acquisition reality

### A1. Every entry point that exists today

| Entry point | Source | Notes |
|---|---|---|
| `/` — the 447 KB SPA | direct, search, share | JS-rendered shell; static H1 + search + centre `<select>` are crawler-visible (`index.html:1075-1108`), all data JS-injected into `#main-content` skeleton (`index.html:1111-1121`) |
| `/centre/<slug>` static hubs | search | one per active centre with a score + ≥1 present brand (`seo/generate.mjs:203-218`) |
| `/centre/<slug>/<brand>` static pages | search | the workhorse; only brands on sale or with ≥1 recorded cycle (`seo/generate.mjs:137,224-229`) |
| `/blog` + 4 posts | search, footer link | all four posts hand-written, all dated June 2026 (`seo/blog/*.md`) |
| `/?centre=<slug>` deep links | share captions, alert/digest emails | SPA reads `?centre=` on load (`index.html:1635-1647`) |
| `/?ref=<uid>` referral links | account-panel invite (`index.html:1337-1344,1922`) | stores `referred_by`; no reward, no loop |
| Alert/digest emails | `notify-high-tide` passes 1–4 | retention re-entry, not acquisition, but the only recycling mechanism |
| PWA icon | `manifest.json` | installable, no service worker, no store listing |
| `/privacy`, `404.html` | — | dead ends, no capture |

### A2. What's tracked vs not

GA4 is real and live (`G-4P73L0ZE9X`, `index.html:1378`) but **loads only after opt-in Accept** on the cookie banner (`loadGA`, `index.html:1391-1402`) — a hard gate, not Consent Mode v2, so all GA numbers cover consenting users only. Events fired (via `trackEvent`, `index.html:1454-1476`, plus three direct gtag calls): `centre_selected` (4075), `save_attempt_logged_out` (5672), `auth_modal_open` (1751), `magic_link_sent` (1834, 2052), `magic_link_return` (1552), `onboarding_skip/step/complete` (2341, 2361, 2680), `alert_optin` (2117, 7287), `report_submitted` (7438), `share` (4256), `invite_share` (1968).

A consent-free first-party counter exists (`api/event.js` + sendBeacon, `index.html:1460-1475`): per-day `(day, event) → count` in `funnel_events`. **It carries no source, referrer, or landing-page dimension** (`api/event.js:19-59`), and excludes `share`/`invite_share`.

**Not tracked anywhere:** UTM/source capture beyond GA defaults, landing page for non-consenting visitors, scroll depth, interaction with the landing search box (the declared primary action — comment `index.html:6038-6039` — has no event), a distinct email-capture-submit, return visits.

**Microsoft Clarity does not exist.** It is promised in the cookie-banner copy (`index.html:1178`; repeated on every static page, `seo/render.mjs:202`) but no Clarity script, ID, or call is anywhere in the repo. You have no session recordings or heatmaps, and the consent copy over-claims.

### A3. Minimum instrumentation to tell traffic sources apart

- GA4 (consenting cohort) already auto-collects source/medium + landing page — nothing to build, but it's a biased sample.
- The first-party counter needs two coarse, cookieless dimensions to be acquisition-useful: referrer class (search / social / email / direct, derived from `document.referrer`) and landing-path bucket (`/`, `/centre/*`, `/blog/*`). Aggregate counts only — consent-compatible as-is.
- Google Search Console is the true source-of-truth for the SEO channel (site verification metas exist: `index.html:4`, `BingSiteAuth.xml`); it lives outside the repo and this audit cannot confirm it's being read.

**Verdict on measurability: acquisition is half-measurable.** Funnel steps are counted consent-free, but *which channel a visitor came from* is only known for the consenting minority. You cannot currently attribute a signup to search vs share vs email from your own data.

## B. Search visibility teardown

| Check | Grade | Evidence |
|---|---|---|
| Page inventory | **PARTIAL** | Page types: home, 24 centre hubs, brand×centre pages, blog index + 4 posts. **No brand-only pages, no category pages** (`seo/generate.mjs:218-259` is the complete emit list). Count arithmetic below. |
| Rendering | **PASS** | All SEO content baked into static HTML at build time — titles, H1s, scores, sale tables, FAQ, JSON-LD (`seo/render.mjs` throughout). Only opt-in form + analytics are client JS. The homepage is the exception: an app shell. |
| Programmatic generation | **PASS** | `node seo/generate.mjs` builds every page from live Supabase anon-read data on each Vercel deploy (`generate.mjs:36-39,94-109`); fails closed on data errors so a bad build can't de-index the site (`generate.mjs:163-176,240-246`). The brief's "single biggest finding if absent" is **present**. |
| On-page | **PASS** | Unique title/description/canonical/OG per page via shared `HEAD()` (`render.mjs:119-136`). Brand-page title/H1 literally "When does {brand} go on sale at {centre}?" (`render.mjs:302,374`) — correct intent match. |
| Structured data | **PARTIAL** | FAQPage + BreadcrumbList on brand pages (`render.mjs:331-342`), BlogPosting + Breadcrumb on posts (`render.mjs:505-522`). **Centre hubs have breadcrumb only; the homepage has no JSON-LD at all** (no `ld+json` in `index.html`). |
| Internal linking | **FAIL at the root** | Static pages interlink correctly (hub↔brand↔siblings, blog→hubs). But the homepage — the highest-authority URL — contains **zero crawlable links to any centre hub**: the 24-centre `<select>` options are not links (`index.html:1082-1108`), and the only `/centre/` anchor is JS-rendered after a centre is picked (`index.html:6569`). Hubs are reachable by crawlers essentially only via sitemap + 2 blog posts. Static pages also link back to bare `/` (`render.mjs:251,373`), not `/?centre=<slug>` — an SEO visitor clicking into "the app" lands on the generic picker and must re-find their centre. |
| Sitemap / robots / canonicals | **PASS** | Sitemap emitted with per-URL `<lastmod>` every build (`generate.mjs:264-271,186-189`); robots.txt sane with sitemap pointer (`robots.txt:1-10`); canonicals on every page. |
| Core Web Vitals | **UNMEASURED** | Live measurement was blocked by this session's egress policy (tidego.co 403 at the proxy). Static facts: `index.html` is 447,228 bytes with a render-blocking Google Fonts stylesheet (`index.html:35`) and a **synchronous, non-deferred supabase-js CDN script in `<head>`** (`index.html:45`); homepage LCP content is JS+network-dependent (skeleton → Supabase fetch, 6 s watchdog `index.html:1127-1141`). The static `/centre/` pages are small static HTML and should be fast. Owner action: one PageSpeed Insights run on `/` and one `/centre/` page gives the real numbers. |
| Freshness | **FAIL — the big one** | Vercel rebuilds only on git push. The 10:00 UTC scorer (`daily-scrape.yml:5`) writes Supabase and **never triggers a deploy**; no workflow calls a Deploy Hook (verified across all six `.github/workflows/*.yml`). `seo/README.md:19,63` lists the daily Deploy Hook as an unbuilt go-live checklist item. Consequence: every "sales today" score, "X of Y shops on sale" count, and sitemap `<lastmod>` is frozen at the last push. Pages whose entire pitch is *today's* state decay from the moment they deploy — a trust problem for users and a freshness signal problem for Google. |

**Indexable page count.** Cannot be fetched live from this session (egress blocked). Bounded from the generator's own gates: `1 (home) + hubs (≤24) + Σ brand×centre + 1 (blog) + 4 (posts)`. Brand×centre pages = presence rows whose brand has ≥1 recorded sale cycle; presence is 11–56 brands per centre post-D17 (`CLAUDE.md`), so the ceiling is ~1,375 URLs and the realistic count — given the June–July national cycle put most tracked brands through at least one recorded sale — is plausibly **several hundred to ~1,300**. The exact number is printed on every deploy: `[seo] Generated N pages` in the Vercel build log (`generate.mjs:274`), or run `npm run seo:build` locally.

**One more indexing risk:** the same brand generates up to 24 near-identical "When does {brand} go on sale at {X}?" pages differing mostly by centre name. The generator guards against *thin* pages (`generate.mjs:131-137`) but not against this cross-centre near-duplication — for the brand-head query these 24 pages compete with each other and dilute the domain's answer.

## C. Trigger coverage gap analysis

The trigger: "I'm about to buy this — should I wait?" Queries a person in that moment types, mapped to TIDE URLs (88 tracked brands after Evans/Coast removal; 24 centres, `index.html:3649-3656`):

| Query family | Size | Coverage | Evidence |
|---|---|---|---|
| "when does {brand} go on sale" / "next {brand} sale" / "{brand} sale dates" | ~88 | **0 dedicated pages — 0%** | no `/brand/<x>` page type exists (`generate.mjs` emit list) |
| "{brand} sale" / "is {brand} having a sale" | ~88 | **0 dedicated — 0%** | served only obliquely by centre-scoped pages that cannibalise each other |
| "{centre} sales" / "{centre} sales today" | 24 | **24 — 100%** | hub title `render.mjs:405` |
| "when does {brand} go on sale at {centre}" | ≤ ~1,300 real combos | covered where the brand has history | `render.mjs:302` — but this is the *tail*, not the head |
| Seasonal/calendar ("when do summer sales start UK", "Boxing Day sales 2026") | ~15 | **~1 — ~7%** | one blog post, `uk-sale-calendar-2026.md`, whose title hard-codes 2026 and will decay next year |
| Item-level ("should I wait to buy X jacket") | unbounded | 0% | outside the current data model; noted, not counted |

**Head-query coverage: 25 of ~215 distinct high-intent query targets ≈ 12%.** The entire brand-first head of the demand curve — where the trigger actually fires, since shoppers think in brands before centres — is unserved. This is the acquisition opportunity, and it is programmatically reachable from data the DB already holds (`brand_sale_cycles` is national/brand-level, exactly the shape a brand-only page needs).

## D. Shareability and virality

- **The product does produce a screenshot-worthy artefact:** `shareCentre` (`index.html:4241-4300`) generates a branded PNG (score, verdict, counts) and shares it with the static `/centre/<slug>` URL — the right URL for previews. GA `share` event fires (4256); the first-party counter ignores it.
- **OG previews are generic:** every centre/brand page uses the shared `og-default.png` (`render.mjs:372,424`); only 2 of 4 blog posts have hero images. Per-page OG images are a known deferred item (`GROWTH-PLAN.md` Phase 3).
- **A `/centre/` page posted to a subreddit reads as genuinely useful with no signup wall** — real score, per-shop sale table, verified history, no gate (`render.mjs:403-440`). This test passes today. What's missing is any reason for the *reader* to share onward (no chart/calendar visual on the page, no per-page preview image) and the freshness problem above: a stale "today" page posted to Reddit is a credibility grenade.
- **Referral loop is inert:** `?ref=` is captured and stored as `referred_by` (`index.html:1529-1535,1575-1597`) — no reward, no count surfaced to the referrer, invite link is a raw UUID (`index.html:1922`).

## E. Owned-asset capture

**Present and wired** (this was GROWTH-PLAN Phase 1/2, shipped):
- One-field "Get the peak alert for {centre}" card on every logged-out centre view (`index.html:6577-6587` → upsert `seo_alert_signups`, 2105-2110). Offer: "One email the day the Tide Score says it's the moment to go. No account needed." — the right offer at the right moment.
- Brand-sheet "Alert me" email field (`index.html:7311-7318`, writes `brand_slug` rows).
- Static SEO pages and blog carry the same form (`render.mjs:257-270`).
- Delivery is real (notify-high-tide pass 4, one-email-per-address, unsubscribe tokens).
- The list lives in `seo_alert_signups` (migrations `20260603`, `20260717`) + account holders in `user_preferences`. Owned, exportable, on your own Supabase.

**Gaps:** the homepage itself has no capture until a centre is picked (the notify-banner is a magic-link *account* path, `index.html:2025-2056`, not the low-commitment list); and nothing measures capture separately from `alert_optin`'s two sources. These are placement/measurement gaps, not architecture gaps — capture is the healthiest part of the funnel.

## F. Landing conversion

- **`/` (SPA):** primary above-the-fold action is the centre search box — deliberate ("the search itself is the engagement", `index.html:6038-6039`). One selection reaches full centre data; **no signup wall, no interstitial**; cookie banner is bottom-anchored opt-in and doesn't block content. Time-to-value: parse 447 KB + blocking font CSS + sync supabase-js + Supabase round-trips — realistically ~2–4 s on mobile before real content replaces the skeleton (unmeasured; see B). The primary action is untracked, so bounce-vs-engage on the highest-traffic page is invisible.
- **`/centre/` static pages (the SEO landing surface):** value is instant — the answer is in the static HTML. Primary action = the email opt-in form. Weakness: the path into the app loses the visitor's context (links to `/`, not `/?centre=<slug>`, `render.mjs:251,373`).

## G. Borrowed-distribution options

What exists today: **nothing.** No public data API (all four `api/` endpoints are telemetry/admin/unsubscribe; `api/event.js` is write-only), no RSS/Atom/JSON feed, no oEmbed, no widget — embedding is actively blocked (`X-Frame-Options: DENY`, `frame-ancestors 'none'`, `vercel.json:15-16`), no extension, no store listing. Skimlinks is a dead CSP slot (`vercel.json:15`), unwired in code. The architecture docs treat the cycle data as a moat to withhold, not syndicate (`docs/architecture/personalisation-ranking.md:265-267`).

Options the current architecture could reach, honestly costed:

| Surface | Build cost | Audience borrowed | Dependency risk |
|---|---|---|---|
| "New sales this week" RSS/JSON feed emitted by the existing generator | 1–2 days | deal aggregators, RSS readers, Reddit bots, IFTTT | Low tech risk; tension with the data-moat stance (D12); freshness worthless without the daily rebuild |
| Reddit-postable data artefacts (per-brand sale-history chart on pages; the share PNG already exists) | 0–2 days | UK deal/fashion subreddits | Content is generatable; **posting is manual** — conflicts with the no-ongoing-labour constraint |
| Embeddable score badge (script-tag, since iframes are CSP-blocked) | 2–3 days | local press, mall-adjacent blogs | Needs outreach (manual); small audience |
| Chrome extension: "should I wait?" overlay on the 88 retailers' product pages — the literal trigger moment | 5–10 days + store review | Chrome Web Store search + every retailer product page | Highest ceiling and highest cost; ongoing maintenance for a solo owner; only worth it after search is proven |
| Play Store listing via TWA (manifest already valid) | 1–2 days | Play Store search | Tiny discoverability for this niche |
| Shopify app / merchant feeds | — | — | Not feasible: TIDE has no merchant-side product or item-level data |

## H. Verdict

**1. Capable of acquiring through search, or structurally invisible?** Neither — it is *structurally visible and operationally stalled*. The proof: a real programmatic inventory of roughly several hundred to ~1,300 static, intent-matched, crawler-readable URLs (exact count in every Vercel build log, `generate.mjs:274`; ceiling ~1,375 from 24 hubs × 11–56 present brands + blog), with correct titles, canonicals, FAQ schema, and a sitemap. Against that: 0% coverage of the ~88 brand-only head queries (12% head-query coverage overall), zero crawlable homepage links to the money pages, and every page frozen at last-push freshness because the daily Deploy Hook was never built. The machine exists; it is unplugged from the data pipeline and aimed at the tail.

**2. Single highest-leverage change?** A brand-level page type — `/brand/<slug>`: "When does {brand} go on sale?" — ~88 pages generated from `brand_sale_cycles` data the DB already holds, with the daily Vercel Deploy Hook (a one-line addition to `daily-scrape.yml` plus a hook URL) as its prerequisite so the whole inventory stops decaying. Brand-head queries like "when does zara go on sale" carry real UK volume across 88 brands; ranking for even a modest fraction plausibly unlocks **low thousands of monthly visitors within 3–6 months of indexing** — against a current SEO surface targeting queries people type far less often. (Estimate, not measurement; Search Console after shipping is the kill-criterion instrument.)

**3. Is evergreen search the only viable channel?** Yes, as the primary — it is the only channel that compounds with zero budget, zero ongoing labour, and no retention flywheel to lean on, and 90% of the machinery already exists. The one borrowed-distribution play with a genuinely bigger ceiling is the browser extension (it sits exactly at the trigger moment), but its build-and-maintain cost for a solo operator is only justified after search proves the demand and the freshness loop works. Everything else on the borrowed list either needs manual outreach/posting (violates your constraints) or borrows an audience too small to matter.

---

*Session limitation, stated for honesty: live fetches of tidego.co and Supabase were blocked by the sandbox egress policy, so the deployed sitemap count and field Core Web Vitals could not be captured; both are marked above with the exact command/log line that yields the real numbers.*
