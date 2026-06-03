// next-sale-window.mjs
// Derives the "next big UK sale window" for the SEO pages, reusing the same
// retail-calendar anchors the dashboard already uses to backfill its chart
// (see index.html RETAIL_CALENDAR_ANCHORS). This is a NATIONAL calendar signal,
// not a per-centre prediction — copy must say "based on the UK sale calendar".
//
// We deliberately do NOT predict a centre-specific peak date in v1: the score
// history was reset 2026-05-04, so there isn't enough per-centre history to
// model a centre's own rhythm. That is a future (2027+) feature.

// Notable windows only (peak >= NOTABLE). Minor blips are not surfaced as a
// "big sale window" so the page never over-promises.
export const SALE_WINDOWS = [
  { m: 12, d: 26, peak: 92, label: 'Boxing Day sales' },
  { m: 1,  d: 12, peak: 70, label: 'January winter clearance' },
  { m: 4,  d: 5,  peak: 62, label: 'Easter weekend sales' }, // NOTE: Easter date shifts yearly (see below)
  { m: 5,  d: 4,  peak: 55, label: 'May Day bank holiday sales' },
  { m: 5,  d: 25, peak: 50, label: 'Spring bank holiday sales' },
  { m: 7,  d: 8,  peak: 62, label: 'summer sale season' },
  { m: 7,  d: 25, peak: 78, label: 'peak summer sales' },
  { m: 11, d: 27, peak: 90, label: 'Black Friday' },
];

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Pretty "~8 July" style date (approximate, because these are calendar windows).
function approxDate(d) {
  return `~${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Given a reference date (defaults must be passed in — callers provide it so
// this stays pure/testable), return the soonest notable sale window on or after
// that date: { date: Date, label, peak, approx }.
export function nextSaleWindow(today) {
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let best = null;
  for (const w of SALE_WINDOWS) {
    // Project the anchor onto this year and next year; take the soonest that is
    // still in the future (>= today), so December anchors roll into next year.
    for (const yr of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const when = Date.UTC(yr, w.m - 1, w.d);
      if (when >= t0) {
        if (!best || when < best.when) best = { when, w };
      }
    }
  }
  if (!best) return null; // unreachable, but keep callers safe
  const date = new Date(best.when);
  return { date, label: best.w.label, peak: best.w.peak, approx: approxDate(date) };
}

// One-line shopper copy for the page.
export function nextSaleWindowSentence(today, centreName) {
  const w = nextSaleWindow(today);
  if (!w) return null;
  const lead = /^[a-z]/.test(w.label) ? w.label[0].toUpperCase() + w.label.slice(1) : w.label;
  return `Next big sale window at ${centreName}: ${lead}, from ${w.approx} (based on the UK retail sale calendar).`;
}
