// /api/event — first-party, cookieless funnel counter.
//
// POST { "event": "<name>" }  →  funnel_events (day, event) += 1
//
// GA4 is consent-gated, which biases every absolute count; this endpoint
// keeps aggregate step counts that sit outside consent — no user ids, no
// IPs, no cookies, nothing stored but a per-day counter per event name.
// index.html's trackEvent() fires it (sendBeacon) alongside the GA event
// for the allowlisted funnel steps only.
//
// Abuse posture: unauthenticated by design (it must fire for anonymous
// visitors — they ARE the funnel). The only thing an abuser can do is
// inflate an allowlisted counter; junk event names are silently dropped
// and the response never distinguishes accepted from dropped (always 204).
//
// Required Vercel env vars (already set for /api/rescore):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const ALLOWED = new Set([
  'centre_selected',
  'save_attempt_logged_out',
  'auth_modal_open',
  'magic_link_sent',
  'magic_link_return',
  'onboarding_skip',
  'onboarding_complete',
  'alert_optin',
  'report_submitted',
]);
const STEP_RE = /^onboarding_step_[1-5]$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  let ev = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));
    ev = String(body.event || '').slice(0, 40);
  } catch { /* malformed — dropped below */ }

  if (ALLOWED.has(ev) || STEP_RE.test(ev)) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      try {
        await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/bump_funnel_event', {
          method: 'POST',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ev }),
        });
      } catch (err) {
        console.error('funnel bump failed:', err);
      }
    }
  }
  // Always 204: the caller is fire-and-forget and validity is not leaked.
  return res.status(204).end();
}
