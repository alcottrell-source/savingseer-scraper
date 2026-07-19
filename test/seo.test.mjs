import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSaleWindow } from '../seo/next-sale-window.mjs';
import { isOnSale, slugify, verdictCopy, renderBrandPage, renderBrandHub, renderCentreHub } from '../seo/render.mjs';
import { buildBrandIndex, brandHasNationalPage, primaryCentreSlug } from '../seo/brand-index.mjs';
import { GUIDES, guideOccurrences, calendarRows, nextOccurrence } from '../seo/guides.mjs';
import { renderGuidePage, renderGuideCalendar } from '../seo/render.mjs';

test('nextSaleWindow returns the soonest future window', () => {
  // Early June → next notable window is the summer sale (8 July).
  const w = nextSaleWindow(new Date(Date.UTC(2026, 5, 3)));
  assert.equal(w.label, 'summer sale season');
  assert.equal(w.date.getUTCMonth(), 6); // July
});

test('nextSaleWindow rolls December anchors into next year', () => {
  // Late December after Boxing Day → next window is mid-Jan clearance next year.
  const w = nextSaleWindow(new Date(Date.UTC(2026, 11, 28)));
  assert.equal(w.label, 'January winter clearance');
  assert.equal(w.date.getUTCFullYear(), 2027);
});

test('isOnSale follows the admin-verified rule, ignores scraper sale_status', () => {
  assert.equal(isOnSale({ active_cycle_id: 'c1' }), true);
  assert.equal(isOnSale({ last_verified_date: '2026-06-01', last_verified_status: true }), true);
  assert.equal(isOnSale({ last_verified_date: '2026-06-01', last_verified_status: false }), false);
  assert.equal(isOnSale({ sale_status: true }), false); // scraper-raw must NOT make it on-sale
  assert.equal(isOnSale(null), false);
});

test('slugify handles ampersands and apostrophes', () => {
  assert.equal(slugify('M&S'), 'm-and-s');
  assert.equal(slugify("The White Company"), 'the-white-company');
});

test('verdictCopy maps Peak to a go-now tone', () => {
  assert.equal(verdictCopy('Peak', 'FLAT').tone, 'go');
  assert.equal(verdictCopy('Rising', 'RISING').tone, 'wait');
});

test('renderBrandPage embeds FAQ JSON-LD and the question H1', () => {
  const html = renderBrandPage({
    centre: { slug: 'westquay-southampton', name: 'Westquay', tideScore: 34, verdict: 'Rising', trajectory: 'RISING' },
    brand: { id: 'B001', name: 'Next', slug: 'next', saleUrl: 'https://x' },
    sale: { last_verified_date: '2026-06-02', last_verified_status: true },
    cycle: null, hours: 'Mon–Fri 9am–8pm', siblings: [],
    supabase: { url: 'u', anonKey: 'k' }, origin: 'https://tidego.co',
    today: new Date(Date.UTC(2026, 5, 3)),
  });
  assert.match(html, /<h1>When does Next go on sale at Westquay\?<\/h1>/);
  // The answer block must LEAD with the brand's own sale status (what was searched),
  // not the centre verdict.
  assert.match(html, /Yes — Next is on sale at Westquay now\./);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /\/rest\/v1\//, 'opt-in must post to raw PostgREST');
  assert.ok(!/@supabase\/supabase-js|createClient\(/.test(html), 'must not load supabase-js in the browser');
});

test('buildBrandIndex aggregates a brand across centres with a stable national slug', () => {
  const shaped = (centreSlug, centreName, brands) => ({ centre: { slug: centreSlug, name: centreName }, brands });
  const next = { id: 'B001', name: 'Next', slug: 'next', cluster: 'High Street', saleUrl: 'https://x',
    sale: { active_cycle_id: 'c1' }, cycle: { startDate: '2026-06-20', maxDiscountPct: 50 },
    cyclesRaw: [{ brand_id: 'B001', start_date: '2026-06-20', end_date: null, max_discount_pct: 50 }],
    onSale: true, hasPage: true };
  const thin = { id: 'B099', name: 'Quietco', slug: 'quietco', cluster: null, saleUrl: null,
    sale: null, cycle: null, cyclesRaw: [], onSale: false, hasPage: false };
  const idx = buildBrandIndex([
    shaped('westquay-southampton', 'Westquay', [next, thin]),
    shaped('bluewater', 'Bluewater', [{ ...next }]),
  ]);
  const n = idx.find(b => b.id === 'B001');
  assert.equal(n.slug, 'next');
  assert.equal(n.centres.length, 2);
  // Centres sort alphabetically; the primary (opt-in) centre is stable.
  assert.equal(primaryCentreSlug(n), 'bluewater');
  assert.equal(brandHasNationalPage(n), true);
  // Thin brands (off-sale, no history) get no national page, same as children.
  assert.equal(brandHasNationalPage(idx.find(b => b.id === 'B099')), false);
});

test('renderBrandHub answers the brand-only head query with FAQ LD and centre links', () => {
  const idx = buildBrandIndex([{
    centre: { slug: 'westquay-southampton', name: 'Westquay' },
    brands: [{ id: 'B001', name: 'Next', slug: 'next', cluster: null, saleUrl: 'https://x',
      sale: { active_cycle_id: 'c1' }, cycle: { startDate: '2026-06-20', maxDiscountPct: 50 },
      cyclesRaw: [{ brand_id: 'B001', start_date: '2026-06-20', end_date: null, max_discount_pct: 50 }],
      onSale: true, hasPage: true }],
  }]);
  const html = renderBrandHub({ brand: idx[0], supabase: { url: 'u', anonKey: 'k' },
    origin: 'https://tidego.co', today: new Date(Date.UTC(2026, 5, 25)) });
  assert.match(html, /<h1>When does Next go on sale\?<\/h1>/);
  assert.match(html, /Yes — Next is on sale now, up to 50% off\./);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /rel="canonical" href="https:\/\/tidego\.co\/brand\/next"/);
  // Links down to the emitted child page — the anti-cannibalisation hierarchy.
  assert.match(html, /href="https:\/\/tidego\.co\/centre\/westquay-southampton\/next"/);
  // Opt-in centre_slug must be a REAL stocked centre (NOT NULL + pass-4 rule).
  assert.match(html, /westquay-southampton/);
  assert.ok(!/@supabase\/supabase-js|createClient\(/.test(html), 'must not load supabase-js in the browser');
});

test('renderBrandPage links up to its national /brand/ parent when given', () => {
  const html = renderBrandPage({
    centre: { slug: 'westquay-southampton', name: 'Westquay', tideScore: 34, verdict: 'Rising', trajectory: 'RISING' },
    brand: { id: 'B001', name: 'Next', slug: 'next', saleUrl: 'https://x' },
    sale: { last_verified_date: '2026-06-02', last_verified_status: true },
    cycle: null, hours: null, siblings: [],
    supabase: { url: 'u', anonKey: 'k' }, origin: 'https://tidego.co',
    today: new Date(Date.UTC(2026, 5, 3)), brandHubSlug: 'next',
  });
  assert.match(html, /href="https:\/\/tidego\.co\/brand\/next"/);
});

test('guide dates roll into next year and titles carry the computed year', () => {
  // Two days after Boxing Day, the boxing-day guide's next occurrence is NEXT year.
  const after = new Date(Date.UTC(2026, 11, 28));
  const bd = GUIDES.find(g => g.slug === 'boxing-day-sales');
  const occ = guideOccurrences(bd, after);
  assert.equal(occ[0].year, 2027);
  assert.equal(bd.title(occ[0].year), 'Boxing Day sales 2027 — dates and what to expect');
  // Before it, same year.
  assert.equal(nextOccurrence({ m: 12, d: 26 }, new Date(Date.UTC(2026, 10, 1))).getUTCFullYear(), 2026);
});

test('calendarRows covers every guide anchor, soonest first', () => {
  const rows = calendarRows(new Date(Date.UTC(2026, 0, 2)));
  const anchorCount = GUIDES.reduce((a, g) => a + g.anchors.length, 0);
  assert.equal(rows.length, anchorCount);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date <= rows[i].date, 'rows must be date-sorted');
  assert.ok(rows.every(r => r.guideSlug), 'every row links a guide');
});

test('renderGuidePage and renderGuideCalendar emit LD, canonical, and live snapshot', () => {
  const today = new Date(Date.UTC(2026, 6, 19));
  const g = GUIDES.find(x => x.slug === 'summer-sales');
  const common = { national: { centreCount: 24, avgPct: 41.2 }, topCentres: [{ slug: 'bluewater', name: 'Bluewater', tideScore: 62 }], supabase: { url: 'u', anonKey: 'k' }, origin: 'https://tidego.co', today };
  const page = renderGuidePage({ guide: g, occurrences: guideOccurrences(g, today), ...common });
  assert.match(page, /<h1>UK summer sales 2026<\/h1>/);
  assert.match(page, /"@type":"FAQPage"/);
  assert.match(page, /rel="canonical" href="https:\/\/tidego\.co\/guides\/summer-sales"/);
  assert.match(page, /an average of 41% of shops are on sale/);
  assert.match(page, /href="https:\/\/tidego\.co\/centre\/bluewater"/);
  const cal = renderGuideCalendar({ rows: calendarRows(today), ...common });
  assert.match(cal, /rel="canonical" href="https:\/\/tidego\.co\/guides\/uk-sale-calendar"/);
  assert.match(cal, /href="https:\/\/tidego\.co\/guides\/black-friday"/);
  assert.match(cal, /"@type":"BreadcrumbList"/);
});

test('centre hub links page-worthy brands but renders thin ones as plain text', () => {
  // A thin brand (off-sale, no tracked cycles) gets no page, so it must NOT be
  // linked from the hub — only kept in the roster as plain text. A brand with
  // a live sale OR history is linked.
  const html = renderCentreHub({
    centre: { slug: 'westquay-southampton', name: 'Westquay', tideScore: 20, verdict: 'Rising', trajectory: 'RISING' },
    brands: [
      { name: 'Next', slug: 'next', onSale: true, cyclesRaw: [], hasPage: true },
      { name: 'Clarks', slug: 'clarks', onSale: false, cyclesRaw: [{ start_date: '2026-01-01', end_date: '2026-01-10' }], hasPage: true },
      { name: 'Quietco', slug: 'quietco', onSale: false, cyclesRaw: [], hasPage: false },
    ],
    hours: null, supabase: { url: 'u', anonKey: 'k' }, origin: 'https://tidego.co',
    today: new Date(Date.UTC(2026, 5, 3)),
  });
  assert.match(html, /<a href="https:\/\/tidego\.co\/centre\/westquay-southampton\/next">Next<\/a>/);
  assert.match(html, /<a href="https:\/\/tidego\.co\/centre\/westquay-southampton\/clarks">Clarks<\/a>/);
  // Thin brand stays in the roster (denominator stays honest) but is NOT a link.
  assert.match(html, /Quietco/);
  assert.ok(!/centre\/westquay-southampton\/quietco/.test(html), 'thin brand must not be linked');
  assert.match(html, /3 tracked shops/, 'roster denominator still counts all tracked brands');
});
