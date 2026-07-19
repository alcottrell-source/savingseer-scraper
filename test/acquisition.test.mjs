// Regression tests for the Jul 2026 acquisition work (audit rows 1–9).
// Three surfaces the unit tests didn't cover: the email-safety slug
// invariant, the /api/event validation/clamping, and the generator's
// end-to-end wiring (main() glue, not just the pure helpers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { brands } from '../brands.js';
import { slugify } from '../seo/render.mjs';

// ── Email-safety invariant ──────────────────────────────────────────────────
// notify-high-tide pass 4 matches seo_alert_signups.brand_slug against plain
// slugify(brand.name). The national /brand/ pages write brand_slug using
// slugify + a "-2" dedupe suffix on collision — if two tracked brand names
// ever collided, the suffixed brand's signups would NEVER be delivered.
// This test turns the one-off pre-PR check into a permanent gate: adding a
// brand whose name slug-collides with an existing one must fail CI.
test('no two tracked brand names collide under slugify (pass-4 delivery invariant)', () => {
  const bySlug = new Map();
  for (const b of brands) {
    const s = slugify(b.name);
    assert.ok(s, `brand ${b.id} ("${b.name}") must produce a non-empty slug`);
    const prev = bySlug.get(s);
    assert.ok(!prev || prev === b.name,
      `slug collision: "${prev}" and "${b.name}" both slugify to "${s}" — ` +
      'the deduped national brand_slug would not match notify-high-tide pass 4 ' +
      "and that brand's alert signups would never be delivered");
    bySlug.set(s, b.name);
  }
});

// ── /api/event validation + dimension clamping ──────────────────────────────
function mockRes() {
  const res = { statusCode: null, headers: {}, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

async function callEvent(body, { method = 'POST' } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const realUrl = process.env.SUPABASE_URL;
  const realKey = process.env.SUPABASE_SERVICE_KEY;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-key';
  try {
    const { default: handler } = await import('../api/event.js');
    const res = mockRes();
    await handler({ method, body }, res);
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = realUrl;
    if (realKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = realKey;
  }
}

test('api/event: v2 events accepted with dimensions passed through', async () => {
  const { res, calls } = await callEvent({ event: 'visit', source: 'search', landing: 'centre' });
  assert.equal(res.statusCode, 204);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { ev: 'visit', src: 'search', land: 'centre' });
  assert.match(calls[0].url, /rpc\/bump_funnel_event$/);
});

test('api/event: unknown dimension values clamp to other, never drop the count', async () => {
  const { calls } = await callEvent({ event: 'share', source: 'carrier-pigeon', landing: '/etc/passwd' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { ev: 'share', src: 'other', land: 'other' });
});

test('api/event: junk event names are silently dropped with a 204', async () => {
  const { res, calls } = await callEvent({ event: 'drop_table_users', source: 'search', landing: 'home' });
  assert.equal(res.statusCode, 204);
  assert.equal(calls.length, 0, 'no RPC call for a non-allowlisted event');
});

test('api/event: v1-shaped body (no dimensions) still counts', async () => {
  const { calls } = await callEvent({ event: 'alert_optin' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { ev: 'alert_optin', src: '', land: '' });
});

test('api/event: non-POST is rejected with 405', async () => {
  const { res, calls } = await callEvent({ event: 'visit' }, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(calls.length, 0);
});

// ── Generator end-to-end (main() wiring, fixtures, no network) ──────────────
// The unit tests cover the pure helpers; this covers the glue — page emit,
// sitemap assembly, brand/guide wiring, and the homepage link injection —
// by running the real CLI against the committed fixtures.
test('seo build emits brand + guide pages, sitemap, and injects homepage links', () => {
  const out = mkdtempSync(join(tmpdir(), 'tide-seo-test-'));
  try {
    // A homepage with the marker block, so injection is exercised.
    writeFileSync(join(out, 'index.html'),
      '<html><body><footer><!-- SEO:CENTRE_LINKS:START --><nav class="footer-centres"></nav><!-- SEO:CENTRE_LINKS:END --></footer></body></html>');
    const r = spawnSync(process.execPath, ['seo/generate.mjs', '--fixtures', 'seo/fixtures.westquay.json', '--out', out],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, `build must exit 0\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

    const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    for (const url of [
      'https://tidego.co/centre/westquay-southampton',
      'https://tidego.co/centre/westquay-southampton/next',
      'https://tidego.co/brand/next',
      'https://tidego.co/guides/uk-sale-calendar',
      'https://tidego.co/guides/summer-sales',
      'https://tidego.co/blog',
    ]) {
      assert.ok(sitemap.includes(`<loc>${url}</loc>`), `sitemap must list ${url}`);
    }

    // Every sitemapped path (except the homepage) must have been written.
    for (const [, loc] of sitemap.matchAll(/<loc>https:\/\/tidego\.co\/([^<]+)<\/loc>/g)) {
      assert.ok(existsSync(join(out, loc, 'index.html')), `sitemap URL /${loc} must exist on disk`);
    }

    // Parent/child brand hierarchy is wired both ways.
    const child = readFileSync(join(out, 'centre/westquay-southampton/next/index.html'), 'utf8');
    assert.ok(child.includes('https://tidego.co/brand/next'), 'child page links up to /brand/ parent');
    const parent = readFileSync(join(out, 'brand/next/index.html'), 'utf8');
    assert.ok(parent.includes('https://tidego.co/centre/westquay-southampton/next'), 'parent links down to the child page');

    // Homepage injection replaced the marker block with a real anchor.
    const home = readFileSync(join(out, 'index.html'), 'utf8');
    assert.ok(home.includes('<a href="/centre/westquay-southampton">Westquay sales</a>'),
      'homepage must gain a crawlable centre-hub link');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
