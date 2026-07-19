# funnel_events v2 — first-party source attribution (2026-07-19)

## Problem
`funnel_events` v1 (migration `20260717c`) counts funnel steps consent-free but
carries no source or landing dimension, so acquisition channels are
indistinguishable in first-party data: a `alert_optin` from Google search and
one from a shared link are the same row. GA4 has the dimensions but only for
the consenting minority. The static SEO pages sent nothing at all.

## Schema (migration `20260719_funnel_source_dims.sql`)

```
funnel_events (
  day     DATE NOT NULL,
  event   TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT '',   -- referrer class, v2
  landing TEXT NOT NULL DEFAULT '',   -- landing-path bucket, v2
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, source, landing)
)
```

Still aggregate-only: per-day counters, no user ids, no IPs, no cookies —
the privacy posture of v1 is unchanged, which is what keeps it outside
consent. Existing v1 rows keep `'' / ''` and stay readable.

### Dimension vocabularies (closed sets, enforced server-side)

`source` — derived from `document.referrer` (+ `?ref=` presence) once per
session and carried in `sessionStorage['tide_src']` so a static-page landing
that clicks into the app keeps its original source (same-origin hop would
otherwise read `internal`):

| value | meaning |
|---|---|
| `direct` | empty referrer |
| `search` | google / bing / duckduckgo / yahoo / ecosia / startpage |
| `social` | facebook / instagram / twitter / x / t.co / reddit / linkedin / pinterest / tiktok / youtube |
| `email` | webmail referrers (mail.google, outlook.live, mail.yahoo, …) |
| `referral` | landed with `?ref=` (the invite loop) |
| `internal` | same-origin referrer with no stored session source |
| `other` | anything else |

`landing` — first pathname of the session, bucketed:

| value | meaning |
|---|---|
| `home` | `/` with no `?centre=` |
| `deeplink` | `/` with `?centre=` (share captions, alert emails) |
| `centre` | `/centre/*` static pages |
| `brand` | `/brand/*` static pages |
| `guide` | `/guides/*` static pages |
| `blog` | `/blog*` |
| `other` | anything else |

Worst-case cardinality: 7 × 7 = 49 rows per event per day — trivial.

### RPC
`bump_funnel_event(ev, src, land)` replaces the counter write; the v1
single-arg signature is kept as a wrapper (old cached clients / mid-rollout
`api/event.js` still resolve). Both are service-role-only, SECURITY DEFINER,
same as v1.

## Event additions
- `visit` — once per session (`sessionStorage` guard), fired by BOTH the app
  and every static SEO page. This is the traffic denominator that finally
  separates sources without GA.
- `share`, `invite_share` — were GA-only; now also counted first-party.

## Write path
Browser → `POST /api/event` `{event, source, landing}` (sendBeacon) →
allowlist + vocabulary clamp (unknown source/landing → `other`) →
`bump_funnel_event` RPC (service key). Response is always 204; junk is
silently dropped — v1's abuse posture (worst case: inflating an allowlisted
counter) is unchanged.

## Read path (the weekly source-mix readout)
Admin (is_admin RLS), e.g.:

```sql
select source, landing, sum(n)
from funnel_events
where day >= current_date - 7 and event = 'visit'
group by 1, 2 order by 3 desc;
```

Conversion by channel: same query with `event = 'alert_optin'` divided by the
`visit` counts.
