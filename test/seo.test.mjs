import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSaleWindow } from '../seo/next-sale-window.mjs';
import { isOnSale, slugify, verdictCopy, renderBrandPage, renderCentreHub } from '../seo/render.mjs';

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
