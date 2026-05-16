// §A (verdict / headline / badge / render alignment) + §J (analytics) from
// the pre-launch verification runbook, automated and READ-ONLY.
//
// Strategy: load the preview deploy, wait for the public CENTRE_SCORES global
// to populate, then for every scored centre call the app's own renderCentre()
// and assert the cross-surface invariants from CLAUDE.md:
//
//   1. vessel headline word === 60-day chart corner badge word
//   2. "GO NOW" badge appears iff the headline word is PEAK
//   3. the brand-delta row never contradicts the stage direction
//      (no ↑/is-up while EASING/OVER; no ↓/is-down while RISING/PEAK)
//   4. narrative copy contains no digits and no recommendation language
//   5. (§J) Plausible is pageview-only — exactly one script tag, no custom
//      plausible('Event') calls anywhere in the served HTML
//
// These are internal-consistency checks: they do NOT re-implement
// deriveVerdict(), so they stay correct even if the verdict mapping is tuned.
// The expected-word mapping is asserted only as a soft annotation.
//
// Selectors verified against index.html:
//   .tide-vessel-verdict-word            headline word
//   .tide-vessel-verdict  / "GO NOW"     PEAK badge text
//   .tide-vessel-fact-change.is-up/.is-down/.is-flat   delta row
//   .tide60-trend .tide60-trend-arrow + text           chart corner badge
//   #narrative-section .narrative-insight              narrative copy
//   window.CENTRE_SCORES { id: { verdict, ... } }      data
//   window.renderCentre(id)                            render a centre

import { test, expect } from '@playwright/test';

const RECO_LANGUAGE = [
  'worth a visit', 'worth it', 'worth going', 'still worth', 'go now',
  'skip', "don't wait", "don't bother", 'wait a few days', 'must visit',
  "don't miss", 'great time to', 'head down', 'get down there',
];

// Soft expectation only (annotated, not hard-failed) — the hard gates are the
// cross-surface consistency invariants below.
function expectedWord(serverVerdict) {
  const v = String(serverVerdict || '').toLowerCase();
  if (v === 'peak' || v.includes('go now')) return 'PEAK';
  if (v === 'rising' || v.includes('worth')) return 'RISING';
  if (v === 'easing' || v.includes('last chance')) return 'EASING';
  if (v === 'over' || v.includes("it's over")) return 'OVER';
  if (v === 'quiet' || v === 'turning' || v.includes('nothing')) return 'QUIET';
  return null; // unknown / null verdict → derived from stage; skip soft check
}

test.beforeEach(async ({ baseURL }) => {
  test.skip(!baseURL, 'PREVIEW_URL not set — pass the Vercel preview URL to the workflow');
});

test('preview is built from the audit branch (P0 security headers present)', async ({ page, baseURL }) => {
  // Definitive guard against pointing at the wrong / un-fixed Vercel project:
  // the CSP + X-Frame-Options headers only exist on a deploy built from the
  // audit branch's vercel.json. If they're missing, fail loudly here rather
  // than let the rest of the suite give a misleading pass.
  const res = await page.request.get(baseURL + '/', { failOnStatusCode: false });
  expect(res.status(), 'preview should respond 200').toBe(200);
  const h = res.headers();
  expect(h['x-frame-options'], 'X-Frame-Options header (added by the audit)').toBe('DENY');
  expect(h['content-security-policy'], 'CSP header (added by the audit)').toBeTruthy();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
});

test('app loads and CENTRE_SCORES populates', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.CENTRE_SCORES && Object.keys(window.CENTRE_SCORES).length > 0,
    null,
    { timeout: 30_000 },
  );
  const n = await page.evaluate(() => Object.keys(window.CENTRE_SCORES).length);
  expect(n, 'at least one scored centre should load from Supabase').toBeGreaterThan(0);
});

test('DOM discovery — dump one rendered centre to the report', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.CENTRE_SCORES && Object.keys(window.CENTRE_SCORES).length > 0);
  const firstId = await page.evaluate(() => Object.keys(window.CENTRE_SCORES)[0]);
  await page.evaluate((id) => window.renderCentre(id), firstId);
  await page.waitForSelector('.tide-vessel-verdict-word', { timeout: 20_000 }).catch(() => {});
  const dump = await page.evaluate(() => ({
    centreId: Object.keys(window.CENTRE_SCORES)[0],
    score: window.CENTRE_SCORES[Object.keys(window.CENTRE_SCORES)[0]],
    vesselHTML: document.querySelector('.tide-vessel-verdict')?.outerHTML || '(none)',
    chartHTML: document.querySelector('.tide60-trend')?.outerHTML || '(none)',
    narrative: document.querySelector('.narrative-insight')?.textContent || '(none)',
  }));
  await testInfo.attach('discovery.json', {
    body: JSON.stringify(dump, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('discovery.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('verdict alignment holds for every scored centre', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.CENTRE_SCORES && Object.keys(window.CENTRE_SCORES).length > 0);

  const ids = await page.evaluate(() =>
    Object.entries(window.CENTRE_SCORES)
      .filter(([, s]) => s && (s.verdict != null))
      .map(([id]) => id),
  );
  expect(ids.length, 'scored centres to verify').toBeGreaterThan(0);

  const failures = [];

  for (const id of ids) {
    await page.evaluate((cid) => window.renderCentre(cid), id);
    await page.waitForSelector('.tide-vessel-verdict-word', { timeout: 20_000 }).catch(() => {});

    const snap = await page.evaluate(() => {
      const vEl = document.querySelector('.tide-vessel-verdict-word');
      const vWord = (vEl?.textContent || '').trim().toUpperCase().replace(/\s+/g, ' ');
      const verdictBox = document.querySelector('.tide-vessel-verdict');
      const goNow = /GO NOW/i.test(verdictBox?.textContent || '');
      const deltaEl = document.querySelector('.tide-vessel-fact-change');
      const deltaClass = deltaEl
        ? (deltaEl.classList.contains('is-up') ? 'up'
          : deltaEl.classList.contains('is-down') ? 'down'
          : deltaEl.classList.contains('is-flat') ? 'flat' : 'present')
        : 'none';
      const trendEl = document.querySelector('.tide60-trend');
      const arrow = document.querySelector('.tide60-trend-arrow')?.textContent || '';
      const chartWord = ((trendEl?.textContent || '').replace(arrow, '')).trim().toUpperCase();
      const narrative = (document.querySelector('.narrative-insight')?.textContent || '').trim();
      return { vWord, goNow, deltaClass, chartWord, narrative };
    });

    const sv = await page.evaluate((cid) => window.CENTRE_SCORES[cid]?.verdict, id);
    const why = [];

    // headline word must be one of the five
    if (!['QUIET', 'RISING', 'PEAK', 'EASING', 'OVER'].includes(snap.vWord)) {
      why.push(`headline word not recognised: "${snap.vWord}"`);
    }
    // 1. vessel word === chart corner badge word
    if (snap.chartWord && snap.vWord && snap.chartWord !== snap.vWord) {
      why.push(`chart badge "${snap.chartWord}" != vessel "${snap.vWord}"`);
    }
    // 2. GO NOW iff PEAK
    if (snap.goNow && snap.vWord !== 'PEAK') why.push(`GO NOW shown on ${snap.vWord}`);
    if (!snap.goNow && snap.vWord === 'PEAK') why.push('PEAK without GO NOW badge');
    // 3. delta row never contradicts stage direction
    if (snap.deltaClass === 'up' && (snap.vWord === 'EASING' || snap.vWord === 'OVER')) {
      why.push(`is-up delta on ${snap.vWord}`);
    }
    if (snap.deltaClass === 'down' && (snap.vWord === 'RISING' || snap.vWord === 'PEAK')) {
      why.push(`is-down delta on ${snap.vWord}`);
    }
    // 4. narrative clean
    if (/\d/.test(snap.narrative)) why.push(`narrative contains a digit: "${snap.narrative}"`);
    const lc = snap.narrative.toLowerCase();
    const hit = RECO_LANGUAGE.find((p) => lc.includes(p));
    if (hit) why.push(`narrative uses recommendation language: "${hit}"`);

    // soft annotation only
    const exp = expectedWord(sv);
    if (exp && snap.vWord && exp !== snap.vWord) {
      testInfo.annotations.push({
        type: 'soft-mismatch',
        description: `${id}: verdict "${sv}" → expected ${exp}, got ${snap.vWord} (ok if trajectory override / stage fallback)`,
      });
    }

    if (why.length) {
      const html = await page.evaluate(() => ({
        vessel: document.querySelector('.tide-vessel-verdict')?.outerHTML || '(none)',
        chart: document.querySelector('.tide60-trend')?.outerHTML || '(none)',
      }));
      failures.push({ id, serverVerdict: sv, ...snap, why, html });
      await testInfo.attach(`fail-${id}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
  }

  if (failures.length) {
    await testInfo.attach('failures.json', {
      body: JSON.stringify(failures, null, 2),
      contentType: 'application/json',
    });
  }
  expect(
    failures,
    `alignment violations:\n${failures.map((f) => `  ${f.id} (${f.serverVerdict}): ${f.why.join('; ')}`).join('\n')}`,
  ).toEqual([]);
});

test('§J analytics is pageview-only (no custom Plausible events)', async ({ page, baseURL }) => {
  const res = await page.request.get(baseURL + '/');
  const html = await res.text();
  const scriptTags = (html.match(/plausible\.io\/js\/script[^"']*\.js/g) || []).length;
  expect(scriptTags, 'exactly one Plausible script tag').toBe(1);
  // No custom event calls anywhere in the served document.
  const customCalls = html.match(/\bplausible\(\s*['"][^'"]+['"]/g) || [];
  expect(customCalls, `unexpected custom Plausible events: ${customCalls.join(', ')}`).toEqual([]);
});
