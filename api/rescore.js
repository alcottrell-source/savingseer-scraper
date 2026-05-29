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
// Optional Vercel env vars:
//   RESCORE_ADMIN_EMAIL  — email allowed to trigger a rescore. Defaults to
//                          the same address hard-coded in the DB is_admin()
//                          helper so it works with zero extra config.
//
// Auth gate: the caller must present the admin's Supabase session JWT as a
// Bearer token (admin.html attaches it). The token is verified against
// Supabase's /auth/v1/user endpoint and the email is checked against the
// admin allow-list. An unauthenticated or non-admin POST is rejected 401/403
// before any scoring work runs — closing the open compute endpoint.

import { runScoring } from '../score.js';

const ADMIN_EMAIL = (process.env.RESCORE_ADMIN_EMAIL || 'alcottrell@gmail.com').toLowerCase();

// Verify the Bearer token belongs to the admin. Returns the email on success,
// or null on any failure (missing/expired/invalid token, network error,
// non-admin user). Fail-closed by design.
async function verifyAdmin(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(auth));
  if (!m) return null;
  const token = m[1].trim();
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey || !token) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: serviceKey },
    });
    if (!r.ok) return null;
    const user = await r.json();
    const email = (user?.email || '').toLowerCase();
    return email && email === ADMIN_EMAIL ? email : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const adminEmail = await verifyAdmin(req);
  if (!adminEmail) {
    return res.status(401).json({ ok: false, error: 'Unauthorized — admin session required' });
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
    const summary = await runScoring({ filterCentreIds: centreIds });
    // The scores (centre_seer_scores) are written first and would have thrown
    // above on failure. A tide_history write/fetch failure does NOT throw — it
    // means the headline updated but the 60-day chart didn't. Surface that as a
    // non-OK status so the admin isn't told everything succeeded when the chart
    // is now stale, rather than swallowing it behind a 200.
    if (summary && (summary.historyFetchFailed || summary.historyWriteFailures > 0)) {
      return res.status(502).json({
        ok: false,
        error: summary.historyFetchFailed
          ? 'Scores updated, but tide_history could not be read back — the 60-day chart may be stale.'
          : `Scores updated, but tide_history write failed for ${summary.historyWriteFailures} centre(s) — the 60-day chart may be stale.`,
        history_write_failures: summary.historyWriteFailures || null,
        took_ms: Date.now() - startMs,
        centre_ids: centreIds,
      });
    }
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
