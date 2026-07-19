// /api/og — per-centre Open Graph preview images (edge runtime).
//
// GET /api/og?centre=<slug>  →  1200×630 PNG: centre name, today's Tide
// Score, verdict, and the on-sale count — so a shared /centre/ link (or the
// share sheet's URL) previews as that centre's live state instead of the
// generic og-default.png. Referenced from seo/render.mjs (centre hub +
// brand×centre pages). Falls back to a generic branded card when the slug is
// unknown or the data read fails, so the tag never 404s.
//
// v1 is centres only (the share surface). Brand/guide pages keep
// og-default.png — extend only if the share CTR data earns it (Stage 2 row 9
// kill criterion).
//
// Data: anon-readable Supabase REST with the same public credentials the SEO
// generator uses — no env vars required (env overrides respected).

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SUPABASE_URL = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) || 'https://vrezzwadwzrmumjpdgge.supabase.co';
const SUPABASE_ANON_KEY = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) || 'sb_publishable_qid8Ej6biCOmKLjLIY5DfA_nzJXmc9G';

const COLORS = { bg: '#0b1410', card: '#11201a', ink: '#f5f1eb', muted: '#9fb3a8', neon: '#5EFFB0', amber: '#E6A94B' };

async function pg(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) throw new Error(`pg ${r.status}`);
  return r.json();
}

// Plain satori element helper (no JSX in this repo).
const el = (type, style, children) => ({ type, props: { style, children } });

function card({ title, score, verdict, countLine }) {
  const showScore = Number.isFinite(score);
  return el('div', {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', padding: '56px 64px',
    backgroundColor: COLORS.bg, color: COLORS.ink, fontFamily: 'sans-serif',
  }, [
    el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
      el('div', { fontSize: 40, fontWeight: 700, color: COLORS.neon, letterSpacing: '0.12em' }, 'TIDE'),
      el('div', { fontSize: 28, color: COLORS.muted }, 'tidego.co'),
    ]),
    el('div', { display: 'flex', flexDirection: 'column' }, [
      el('div', { fontSize: 58, fontWeight: 700, lineHeight: 1.15 }, title),
      showScore
        ? el('div', { display: 'flex', alignItems: 'baseline', marginTop: 24 }, [
            el('div', { fontSize: 150, fontWeight: 700, color: COLORS.neon, lineHeight: 1 }, String(score)),
            el('div', { fontSize: 36, color: COLORS.muted, marginLeft: 16 }, '/100 Tide Score today'),
          ])
        : el('div', { fontSize: 40, color: COLORS.muted, marginTop: 24 }, 'When UK shopping centres are worth the trip'),
    ]),
    el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
      el('div', { fontSize: 32, color: COLORS.muted }, countLine || 'Live, admin-verified sale tracking'),
      verdict ? el('div', {
        fontSize: 30, fontWeight: 700, color: COLORS.bg, backgroundColor: verdict === 'Peak' ? COLORS.amber : COLORS.neon,
        padding: '10px 26px', borderRadius: 999,
      }, verdict.toUpperCase()) : el('div', {}, ''),
    ]),
  ]);
}

export default async function handler(req) {
  let title = 'Tide', score = null, verdict = null, countLine = null;
  try {
    const slug = new URL(req.url).searchParams.get('centre') || '';
    if (/^[a-z0-9-]{1,60}$/.test(slug)) {
      const [centres, scores] = await Promise.all([
        pg(`centres?id=eq.${slug}&select=id,name&limit=1`),
        pg(`centre_seer_scores?centre_id=eq.${slug}&select=tide_score,verdict,brands_on_sale,total_brands,score_date&order=score_date.desc&limit=1`),
      ]);
      if (centres[0]) {
        title = `${centres[0].name} sales today`;
        const s = scores[0];
        if (s) {
          score = Number(s.tide_score);
          verdict = s.verdict || null;
          if (s.brands_on_sale != null && s.total_brands != null) {
            countLine = `${s.brands_on_sale} of ${s.total_brands} tracked shops on sale`;
          }
        }
      }
    }
  } catch { /* fall through to the generic card */ }

  return new ImageResponse(card({ title, score, verdict, countLine }), {
    width: 1200,
    height: 630,
    headers: {
      // Scores change daily; an hour of CDN cache keeps the function cheap
      // while previews stay honest.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
