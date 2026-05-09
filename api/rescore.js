// /api/rescore — instant rescoring after admin edits in admin.html.
//
// POST { centre_ids?: ["C01", "C07", ...] }
// (also accepts ?centre_ids=C01,C07 in the query string)
//
// Calls the same scoring code path as the daily cron (`node score.js`).
// When centre_ids is supplied, only those centres are recomputed; the
// rest are untouched. The scorer's carry-forward rule means centres
// whose brands haven't been verified today are automatically left as
// yesterday's row anyway, so the omitted centres never drift.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SUPABASE_URL              — same value as the GitHub Actions secret
//   SUPABASE_SERVICE_KEY      — same value as the GitHub Actions secret
//
// No auth gate yet — the worst an unauthenticated POST can do is force
// a recomputation that would have happened at the next daily cron
// anyway. Adding a Supabase JWT check is the obvious next step.

import { runScoring } from '../score.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  // centre_ids may arrive in the body (preferred) or as a CSV query param.
  let centreIds = null;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (Array.isArray(body.centre_ids)) centreIds = body.centre_ids;
  } catch { /* no body */ }
  if (!centreIds && typeof req.query?.centre_ids === 'string') {
    centreIds = req.query.centre_ids.split(',').map(s => s.trim()).filter(Boolean);
  }

  const startMs = Date.now();
  try {
    await runScoring({ filterCentreIds: centreIds });
    return res.status(200).json({
      ok: true,
      took_ms: Date.now() - startMs,
      centre_ids: centreIds,
    });
  } catch (err) {
    console.error('Rescore failed:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
      took_ms: Date.now() - startMs,
    });
  }
}

export const config = {
  // Scoring all 30 centres takes ~2-4s; single-centre ~1s. Give it head-room.
  maxDuration: 30,
};
