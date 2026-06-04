// §A (verdict / headline / badge / render alignment) + §J (analytics) from
// the pre-launch verification runbook, automated and READ-ONLY.
//
// Strategy: load the preview deploy, wait for the public CENTRE_SCORES global
// to populate, then for every scored centre call the app's own renderCentre()
// and assert the cross-surface invariants from CLAUDE.md:
//
//   1. headline word === trend-pill word === chart-eyebrow tail word
//      (three places inside the merged tide card; all read off the same
//      `deriveVerdict()` so they must match)
//   2. "Go now" headline copy appears iff the verdict word is PEAK
//      (the GO NOW pill is gone — recommendation language is absorbed
//      into the verdict word, which is PEAK-only)
//   3. trend-pill arrow never contradicts the curve's last-segment slope:
//      no '↑' while data-slope-direction='down', no '↓' while
//      data-slope-direction='up' (PEAK's '★' is non-directional and
//      permitted on either slope)
//   4. narrative copy contains no digits and no recommendation language
//   5. (§J) Plausible is gone and GA4 is consent-gated — no plausible.io in
//      the served HTML, no eager gtag loader, and the opt-in banner exists
//
// These are internal-consistency checks: they do NOT re-implement
// deriveVerdict(), so they stay correct even if the verdict mapping is tuned.
// The expected-word mapping is asserted only as a soft annotation.
//
// Selectors verified against index.html (merged tide card, May 2026):
//   .tide-vessel-verdict-word[data-verdict-word]              headline (mixed-case)
//   .tide-vessel-trend-pill[data-verdict-word][data-pill-arrow]  top-right pill
//   .tide-vessel-chart-eyebrow-tail[data-verdict-word]        chart eyebrow tail word
//   .tide-vessel[data-slope-direction]                        live curve slope
//   #narrative-section .narrative-insight                     narrative copy
//   window.__tide.CENTRE_SCORES { id: {verdict,...} }         data (live getter)
//   window.renderCentre(id)                                   render a centre

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

// The daily scorer (.github/workflows/daily-scrape.yml) writes today's
// centre_seer_scores rows at 10:00 UTC. The front-end queries
// score_date = eq.<today> with no fallback, so any run between 00:00 and
// 10:00 UTC legitimately has zero scored centres and the app correctly
// renders its empty landing state. That is NOT a failure of the verdict
// logic — there is simply nothing to assert. Classify the three states:
//   ready  — CENTRE_SCORES populated        → run the alignment assertions
//   empty  — app booted, no rows yet today  → SKIP (pre-scorer window)
//   broken — app JS did not boot            → FAIL
async function loadPreview(page, { timeout = 30_000 } = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const ready = await page
    .waitForFunction(
      () => window.__tide?.CENTRE_SCORES && Object.keys(window.__tide.CENTRE_SCORES).length > 0,
      null,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
  if (ready) return { state: 'ready' };
  const booted = await page.evaluate(
    () => typeof window.__tide === 'object' && window.__tide !== null
      && typeof window.renderCentre === 'function',
  );
  return { state: booted ? 'empty' : 'broken' };
}

const PRE_SCORER_SKIP =
  'No centre_seer_scores rows for today yet (daily scorer runs 10:00 UTC). '
  + 'App booted and rendered its empty state correctly — alignment is not '
  + 'assertable in this window; re-run after 10:00 UTC for full coverage.';

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
  const ready = await page
    .waitForFunction(
      () => window.__tide?.CENTRE_SCORES && Object.keys(window.__tide.CENTRE_SCORES).length > 0,
      null,
      { timeout: 45_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (ready) {
    const n = await page.evaluate(() => Object.keys(window.__tide.CENTRE_SCORES).length);
    expect(n, 'at least one scored centre should load from Supabase').toBeGreaterThan(0);
    return;
  }

  // Not ready — capture full diagnostics, then decide: legitimately empty
  // (pre-scorer window, app booted) → skip; app did not boot → hard fail.
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

  const booted = diag.typeofTide === 'object' && diag.hasRenderCentre === 'function';
  expect(
    booted,
    'app JS did not boot (not the empty-data window) — diagnostics:\n'
      + JSON.stringify(diag, null, 2),
  ).toBe(true);
  testInfo.annotations.push({ type: 'skip-reason', description: PRE_SCORER_SKIP });
  test.skip(true, PRE_SCORER_SKIP);
});

test('DOM discovery — dump one rendered centre to the report', async ({ page }, testInfo) => {
  test.setTimeout(120_000); // cold preview + Supabase first-load headroom
  const r = await loadPreview(page, { timeout: 45_000 });
  if (r.state !== 'ready') {
    expect(r.state, 'app JS did not boot').not.toBe('broken');
    testInfo.annotations.push({ type: 'skip-reason', description: PRE_SCORER_SKIP });
    test.skip(true, PRE_SCORER_SKIP);
  }
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
      vesselHTML: document.querySelector('.tide-vessel')?.outerHTML?.slice(0, 1200) || '(none)',
      pillHTML: document.querySelector('.tide-vessel-trend-pill')?.outerHTML || '(none)',
      chartEyebrowHTML: document.querySelector('.tide-vessel-chart-eyebrow')?.outerHTML || '(none)',
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
  const r = await loadPreview(page, { timeout: 45_000 });
  if (r.state !== 'ready') {
    expect(r.state, 'app JS did not boot').not.toBe('broken');
    testInfo.annotations.push({ type: 'skip-reason', description: PRE_SCORER_SKIP });
    test.skip(true, PRE_SCORER_SKIP);
  }

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
      const vEl     = document.querySelector('.tide-vessel-verdict-word');
      const pillEl  = document.querySelector('.tide-vessel-trend-pill');
      const tailEl  = document.querySelector('.tide-vessel-chart-eyebrow-tail');
      const vessel  = document.querySelector('.tide-vessel');
      const arrow   = document.querySelector('.tide-vessel-trend-pill-arrow')?.textContent || '';
      // Use data-verdict-word as the source of truth for cross-surface
      // comparison — the displayed headline is mixed-case ("Go now",
      // "Rising"), so textContent doesn't normalise cleanly across
      // surfaces. The dataset attribute is set from deriveVerdict() once
      // per render in renderTideVessel, so it's stable.
      const vWord   = (vEl?.dataset.verdictWord || '').toUpperCase();
      const pWord   = (pillEl?.dataset.verdictWord || '').toUpperCase();
      const tWord   = (tailEl?.dataset.verdictWord || '').toUpperCase();
      const headlineText = (vEl?.textContent || '').trim();
      const slopeDir = vessel?.dataset.slopeDirection || '';
      const pillArrow = vessel?.dataset.pillArrow || arrow || '';
      // Residue guard — the decorative-wave / right-rail ladder / GO NOW
      // pill were all removed in the May 2026 merge. None should still be
      // in the DOM. Catches a half-applied CSS migration.
      const stale = {
        tideWater: !!document.querySelector('.tide-water'),
        tideLadder: !!document.querySelector('.tide-ladder'),
        goNowBadge: !!document.querySelector('.tide-vessel-peak-badge'),
        historySection: !!document.querySelector('#history-section'),
      };
      const narrative = (document.querySelector('.narrative-insight')?.textContent || '').trim();
      return {
        rendered: !!vEl,
        vWord, pWord, tWord, headlineText, slopeDir, pillArrow, stale, narrative,
        serverVerdict: window.getServerScore(idx)?.verdict ?? null,
        vesselHTML: vessel?.outerHTML?.slice(0, 1200) || '(none)',
        pillHTML: pillEl?.outerHTML || '(none)',
      };
    }, id);

    const sv = snap.serverVerdict;
    const why = [];

    if (!snap.rendered) why.push('vessel did not render (no .tide-vessel-verdict-word)');

    // headline word must be one of the five
    if (!['QUIET', 'RISING', 'PEAK', 'EASING', 'OVER'].includes(snap.vWord)) {
      why.push(`headline data-verdict-word not recognised: "${snap.vWord}"`);
    }
    // 1. headline word === trend-pill word === chart-eyebrow tail word
    if (snap.pWord && snap.vWord && snap.pWord !== snap.vWord) {
      why.push(`pill "${snap.pWord}" != headline "${snap.vWord}"`);
    }
    if (snap.tWord && snap.vWord && snap.tWord !== snap.vWord) {
      why.push(`chart-eyebrow tail "${snap.tWord}" != headline "${snap.vWord}"`);
    }
    // 2. "Go now" headline copy iff PEAK
    const isGoNowCopy = /go now/i.test(snap.headlineText);
    if (isGoNowCopy && snap.vWord !== 'PEAK') why.push(`"Go now" headline shown on ${snap.vWord}`);
    if (!isGoNowCopy && snap.vWord === 'PEAK') why.push(`PEAK without "Go now" headline (got "${snap.headlineText}")`);
    // 3. trend-pill arrow never contradicts the live curve slope. PEAK's
    // '★' is non-directional and permitted on either slope; the rule is
    // strictly: no '↑' while descending, no '↓' while ascending.
    if (snap.pillArrow === '↑' && snap.slopeDir === 'down') {
      why.push(`pill '↑' arrow while curve slope='down'`);
    }
    if (snap.pillArrow === '↓' && snap.slopeDir === 'up') {
      why.push(`pill '↓' arrow while curve slope='up'`);
    }
    // 4. narrative clean
    if (/\d/.test(snap.narrative)) why.push(`narrative contains a digit: "${snap.narrative}"`);
    const lc = snap.narrative.toLowerCase();
    const hit = RECO_LANGUAGE.find((p) => lc.includes(p));
    if (hit) why.push(`narrative uses recommendation language: "${hit}"`);
    // 5. no residue from the retired decorative-waves / right-rail ladder
    // / standalone history section / GO NOW pill.
    if (snap.stale.tideWater)      why.push('stale .tide-water element still in DOM');
    if (snap.stale.tideLadder)     why.push('stale .tide-ladder element still in DOM');
    if (snap.stale.goNowBadge)     why.push('stale .tide-vessel-peak-badge still in DOM');
    if (snap.stale.historySection) why.push('stale #history-section still in DOM');

    // soft annotation only
    const exp = expectedWord(sv);
    if (exp && snap.vWord && exp !== snap.vWord) {
      testInfo.annotations.push({
        type: 'soft-mismatch',
        description: `${id}: verdict "${sv}" → expected ${exp}, got ${snap.vWord} (ok if trajectory override / stage fallback)`,
      });
    }

    if (why.length) {
      const html = { vessel: snap.vesselHTML, pill: snap.pillHTML };
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

test('§J analytics: Plausible removed, GA4 is consent-gated', async ({ page, baseURL }) => {
  const res = await page.request.get(baseURL + '/');
  const html = await res.text();

  // Plausible must be fully gone — no script tag, no custom event calls.
  expect(html.includes('plausible.io'), 'no plausible.io reference should remain').toBe(false);
  const customCalls = html.match(/\bplausible\(\s*['"][^'"]+['"]/g) || [];
  expect(customCalls, `unexpected custom Plausible events: ${customCalls.join(', ')}`).toEqual([]);

  // GA4 is injected by JS only after the user accepts cookies, so the SERVED
  // static HTML must NOT contain an eager gtag <script> TAG — that proves it
  // is genuinely consent-gated rather than loaded on page load. (The loader
  // URL still appears as a string literal inside the inline loadGA() source,
  // which is fine — we assert on the actual tag, not the string.)
  const eagerGtagTag = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*googletagmanager\.com[^"']*["']/i.test(html);
  expect(
    eagerGtagTag,
    'no eager gtag <script src> tag should be in static HTML (it is created at runtime after consent)',
  ).toBe(false);

  // The opt-in consent banner + its Accept/Decline controls must be present.
  expect(html.includes('id="cookie-banner"'), 'consent banner should exist').toBe(true);
  expect(/onclick="acceptCookies\(\)"/.test(html), 'Accept control should exist').toBe(true);
  expect(/onclick="declineCookies\(\)"/.test(html), 'Decline control should exist').toBe(true);
});
