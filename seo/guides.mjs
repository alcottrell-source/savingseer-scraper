// guides.mjs
// Evergreen seasonal guide pages (/guides/<slug>) generated from the same
// retail-calendar anchors as next-sale-window.mjs. Year-free URLs whose titles
// and dates recompute on every build (the daily Deploy Hook keeps them
// current), so "Boxing Day sales 2026" becomes "…2027" on its own — replacing
// the decay-prone hand-written uk-sale-calendar-2026 pattern. Pure module: no
// DB, no dates of its own; callers pass `today`.

import { SALE_WINDOWS } from './next-sale-window.mjs';

// Next occurrence of a single anchor on/after today (UTC), same projection
// rule as nextSaleWindow.
export function nextOccurrence(anchor, today) {
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const yr of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const when = Date.UTC(yr, anchor.m - 1, anchor.d);
    if (when >= t0) return new Date(when);
  }
  return null; // unreachable: next year's projection is always future
}

// How the anchor's peak intensity reads to a shopper.
export function peakPhrase(peak) {
  if (peak >= 85) return 'one of the biggest discount events of the year';
  if (peak >= 70) return 'a major clearance window';
  if (peak >= 55) return 'a solid mid-tier sale window';
  return 'a smaller sale window';
}

// One guide page per query family. `anchors` are label-matches into
// SALE_WINDOWS; intro copy is evergreen (written once, never needs a rewrite —
// every date and year on the page is computed at build time).
export const GUIDES = [
  {
    slug: 'boxing-day-sales',
    anchors: ['Boxing Day sales'],
    title: (y) => `Boxing Day sales ${y} — dates and what to expect`,
    h1: (y) => `Boxing Day sales ${y}`,
    intro: [
      `Boxing Day is the UK's single biggest in-store sale day. Most major chains open their end-of-season clearance on 26 December — many now start online on Christmas Day evening — and the deepest cuts land in the first 48 hours, when size and stock ranges are still full.`,
      `The pattern Tide tracks every year: discounts open deep (50–70% off at fashion chains is normal), the best stock thins within days, and the event rolls straight into January clearance, where prices drop a little further but choice drops a lot.`,
      `If you're choosing between going on the day or waiting: go early for choice, wait for depth. The rails are picked over long before the discounts stop getting deeper.`,
    ],
    faqExtra: (y) => [
      { q: `Do Boxing Day sales start online before the 26th?`, a: `Usually, yes. Many UK chains open the same clearance online on Christmas Eve or Christmas Day evening, then in store on the 26th.` },
      { q: `Are Boxing Day sales better than Black Friday?`, a: `They're different: Black Friday discounts current-season stock a modest amount, Boxing Day clears the season properly. For depth of discount, Boxing Day usually wins; for buying this season's stock, Black Friday.` },
    ],
  },
  {
    slug: 'january-sales',
    anchors: ['January winter clearance'],
    title: (y) => `January sales ${y} — when they start and when to go`,
    h1: (y) => `January sales ${y}`,
    intro: [
      `The January sales are the long tail of Boxing Day: the same winter clearance, running deeper on price and thinner on stock as the month goes on. By mid-January most fashion chains are on final reductions.`,
      `The trade-off is simple and Tide sees it every year: the discount percentage keeps creeping up for two to three weeks, but the good sizes go early. The best moment is usually the second week — deeper than Boxing Day, before the rails go ragged.`,
    ],
    faqExtra: (y) => [
      { q: `How long do the January sales last?`, a: `Most chains run winter clearance well into late January, with final reductions in the last week. Stock, not dates, is what runs out.` },
    ],
  },
  {
    slug: 'easter-sales',
    anchors: ['Easter weekend sales'],
    title: (y) => `Easter sales ${y} — the spring sale weekend, explained`,
    h1: (y) => `Easter sales ${y}`,
    intro: [
      `Easter is the first meaningful sale moment of spring: a long weekend where most big chains run event discounts — typically 20–40% off rather than clearance-deep — across full spring ranges.`,
      `Because it's an event promotion rather than end-of-season clearance, stock is full and sizes are easy; the discounts just don't go as deep as summer or Boxing Day. Good for buying what you actually planned to buy, not for bargain-hunting.`,
    ],
    faqExtra: () => [
      { q: `Why do Easter sale dates move each year?`, a: `Easter itself moves (late March to late April). The date shown here is an approximate anchor; the promotions track the bank-holiday weekend, whenever it falls.` },
    ],
  },
  {
    slug: 'bank-holiday-sales',
    anchors: ['May Day bank holiday sales', 'Spring bank holiday sales'],
    title: (y) => `May bank holiday sales ${y} — both weekends, compared`,
    h1: (y) => `May bank holiday sales ${y}`,
    intro: [
      `May has two bank-holiday sale moments: the early May Day weekend and the late spring bank holiday. Both bring short event discounts — usually 20–30% off — as retailers bridge the gap between spring launch and the summer clearance.`,
      `Neither weekend is a deep-discount event. Treat them as a planned-purchase discount, and hold anything you can wait on for the summer sales that start a few weeks later, which cut far deeper.`,
    ],
    faqExtra: () => [],
  },
  {
    slug: 'summer-sales',
    anchors: ['summer sale season', 'peak summer sales'],
    title: (y) => `When do the ${y} summer sales start in the UK?`,
    h1: (y) => `UK summer sales ${y}`,
    intro: [
      `The UK summer sales are the year's second-biggest clearance after Christmas. The season opens in early July as chains start clearing summer stock, and builds to its peak in the second half of the month, when discounts are deepest and most shops are on sale at once.`,
      `Tide tracks this build-up live across UK shopping centres: the share of shops on sale climbs through July, peaks, then eases through August as stock sells through. The peak — not the start — is the best day to go: maximum choice of sales, before the rails thin.`,
      `The pattern to play: browse when the season opens, buy at the peak, and gamble on final reductions in August only for things you don't mind losing.`,
    ],
    faqExtra: (y) => [
      { q: `How long do the UK summer sales last?`, a: `Roughly six weeks: opening in early July, peaking in the second half of July, and tailing off through August as stock clears.` },
    ],
  },
  {
    slug: 'black-friday',
    anchors: ['Black Friday'],
    title: (y) => `Black Friday ${y} in UK shopping centres — dates and what really discounts`,
    h1: (y) => `Black Friday ${y}`,
    intro: [
      `Black Friday lands the day after US Thanksgiving and has become the UK's biggest pre-Christmas discount event. In shopping centres it now runs as a week-plus of promotions rather than a single day, with the Friday itself the crest.`,
      `Unlike Boxing Day, this is a promotion on current stock, not clearance: typical fashion discounts are 20–40% off, with full size ranges. It's the right moment to buy things you were buying anyway — and the wrong benchmark for the deepest prices of the year, which come at the clearances either side of it.`,
    ],
    faqExtra: (y) => [
      { q: `Is Black Friday cheaper than the Boxing Day sales?`, a: `Usually not, for like-for-like items: Black Friday discounts current stock moderately, Boxing Day clears it deeply. Black Friday wins on choice, Boxing Day on price.` },
    ],
  },
];

// The occurrences a guide page shows: next date per anchor, soonest first.
export function guideOccurrences(guide, today) {
  return guide.anchors
    .map(label => SALE_WINDOWS.find(w => w.label === label))
    .filter(Boolean)
    .map(w => {
      const date = nextOccurrence(w, today);
      return { label: w.label, peak: w.peak, date, year: date.getUTCFullYear() };
    })
    .sort((a, b) => a.date - b.date);
}

// Calendar rows for the master /guides/uk-sale-calendar page: every anchor's
// next occurrence, soonest first, tagged with its guide slug for linking.
export function calendarRows(today) {
  const rows = [];
  for (const g of GUIDES) {
    for (const occ of guideOccurrences(g, today)) rows.push({ ...occ, guideSlug: g.slug });
  }
  return rows.sort((a, b) => a.date - b.date);
}
