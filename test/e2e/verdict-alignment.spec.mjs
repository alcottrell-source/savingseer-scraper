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
//   window.__tide.CENTRE_SCORES { id: {verdict,...} }  data (live getter)
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

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(!baseURL, 'PREVIEW_URL not set — pass the Vercel preview URL to the workflow');
  const token = process.env.VERCEL_BYPASS;
  if (token) {
    // Prime the Vercel Deployment-Protection bypass COOKIE with ONE
    // same-origin request. The cookie lands in the shared context jar so
    // every later request to the preview origin bypasses — while NO
    // x-vercel-* header is ever attached to cross-origin (Supabase /
    // fonts) requests, which would otherwise become non-simple CORS
    // requests whose preflight those origins reject (breaking data load).
    await page.request.get(baseURL + '/', {
      headers: {
        'x-vercel-protection-bypass': token,
        'x-vercel-set-bypass-cookie': 'true',
      },
      failOnStatusCode: false,
    });
  }
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

test('app loads and CENTRE_SCORES populates', async ({ page }, testInfo) => {
  test.setTimeout(120_000); // cold preview + Supabase first-load headroom
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message));
  const supaResponses = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/supabase\.co|\/rest\/v1\//.test(u)) supaResponses.push(r.status() + ' ' + u.slice(0, 140));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => window.__tide?.CENTRE_SCORES && Object.keys(window.__tide.CENTRE_SCORES).length > 0,
      null,
      { timeout: 45_000 },
    );
  } catch (_e) {
    const diag = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      typeofTide: typeof window.__tide,
      typeofCentreScores: typeof (window.__tide && window.__tide.CENTRE_SCORES),
      scoreKeyCount: (window.__tide && window.__tide.CENTRE_SCORES)
        ? Object.keys(window.__tide.CENTRE_SCORES).length : -1,
      hasRenderCentre: typeof window.renderCentre,
      bodyText: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      htmlStart: document.documentElement.outerHTML.slice(0, 500),
    })).catch((err) => ({ evalError: String(err) }));
    diag.consoleErrors = consoleErrs.slice(0, 12);
    diag.supabaseResponses = supaResponses.slice(0, 12);
    await testInfo.attach('boot-diagnostics.json', {
      body: JSON.stringify(diag, null, 2),
      contentType: 'application/json',
    });
    throw new Error('CENTRE_SCORES never populated — boot diagnostics:\n' + JSON.stringify(diag, null, 2));
  }
  const n = await page.evaluate(() => Object.keys(window.__tide.CENTRE_SCORES).length);
  expect(n, 'at least one scored centre should load from Supabase').toBeGreaterThan(0);
});

test('DOM discovery — dump one rendered centre to the report', async ({ page }, testInfo) => {
  test.setTimeout(120_000); // cold preview + Supabase first-load headroom
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__tide?.CENTRE_SCORES && Object.keys(window.__tide.CENTRE_SCORES).length > 0,
    null,
    { timeout: 90_000 },
  );
  const dump = await page.evaluate(async () => {
    // renderCentre() works in the app's OWN id space — the #centre-select
    // option values ('C01'..'Cnn'). The raw Supabase centre_id that keys
    // CENTRE_SCORES is a different space; passing it makes renderCentre
    // throw, get caught, and restore the picker (no vessel ever paints).
    const cid = [...document.querySelectorAll('#centre-select option')]
      .map((o) => o.value).find(Boolean);
    await window.renderCentre(cid); // resolves with #main-content painted
    const idx = parseInt(cid.slice(1), 10) - 1;
    return {
      centreId: cid,
      score: window.getServerScore(idx),
      vesselHTML: document.querySelector('.tide-vessel-verdict')?.outerHTML || '(none)',
      chartHTML: document.querySelector('.tide60-trend')?.outerHTML || '(none)',
      narrative: document.querySelector('.narrative-insight')?.textContent || '(none)',
    };
  });
  await testInfo.attach('discovery.json', {
    body: JSON.stringify(dump, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('discovery.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('verdict alignment holds for every scored centre', async ({ page }, testInfo) => {
  test.setTimeout(180_000); // ~30 centres × (render + snapshot)
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__tide?.CENTRE_SCORES && Object.keys(window.__tide.CENTRE_SCORES).length > 0,
    null,
    { timeout: 90_000 },
  );

  // Iterate the app's OWN id space — the #centre-select option values
  // ('C01'..'Cnn'). renderCentre() parses these; CENTRE_SCORES is keyed by
  // the unrelated Supabase centre_id, which makes renderCentre throw.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('#centre-select option')]
      .map((o) => o.value)
      .filter(Boolean)
      .filter((cid) => {
        const idx = parseInt(cid.slice(1), 10) - 1;
        const s = window.getServerScore(idx);
        return s && s.verdict != null;
      }),
  );
  expect(ids.length, 'scored centres to verify').toBeGreaterThan(0);

  const failures = [];

  for (const id of ids) {
    // Render AND snapshot in one evaluate: renderCentre resolves with
    // #main-content already painted, and reading synchronously after the
    // await closes the window where the app's 15s loadTideData timer can
    // reset the view back to the landing hero.
    const snap = await page.evaluate(async (cid) => {
      await window.renderCentre(cid);
      const idx = parseInt(cid.slice(1), 10) - 1;
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
      return {
        rendered: !!vEl,
        vWord, goNow, deltaClass, chartWord, narrative,
        serverVerdict: window.getServerScore(idx)?.verdict ?? null,
        vesselHTML: verdictBox?.outerHTML || '(none)',
        chartHTML: trendEl?.outerHTML || '(none)',
      };
    }, id);

    const sv = snap.serverVerdict;
    const why = [];

    if (!snap.rendered) why.push('vessel did not render (no .tide-vessel-verdict-word)');

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
      const html = { vessel: snap.vesselHTML, chart: snap.chartHTML };
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
