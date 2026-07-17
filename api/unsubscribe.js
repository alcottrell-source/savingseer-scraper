// /api/unsubscribe — one-click unsubscribe for seo_alert_signups emails.
//
// GET /api/unsubscribe?token=<uuid>
//
// SEO-page alert signups have no account, so email footers link here with the
// row's unsub_token; we delete the row and confirm. Idempotent and quiet: an
// unknown or already-used token shows the same confirmation, so the endpoint
// can't be probed to learn which tokens exist.
//
// Required Vercel env vars (already set for /api/rescore):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Tide</title>
<style>body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#FAF7F2;color:#2C1810;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:420px;text-align:center}
h1{font-family:Georgia,serif;font-size:1.6rem;margin:0 0 10px}
p{color:#6B5F52;margin:0 0 20px}
a{display:inline-block;background:#3D6B35;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p><a href="/">Back to Tide</a></div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('GET only');
  }

  const token = String(req.query?.token || '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!UUID_RE.test(token)) {
    return res.status(400).send(page('That link looks broken',
      'The unsubscribe link is incomplete — try tapping it again from the email, or reply to the email and we’ll remove you manually.'));
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    return res.status(503).send(page('Something went wrong',
      'We couldn’t process that just now. Please try again shortly.'));
  }

  try {
    const r = await fetch(
      url.replace(/\/$/, '') + '/rest/v1/seo_alert_signups?unsub_token=eq.' + encodeURIComponent(token),
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }
    );
    if (!r.ok) throw new Error('delete failed: ' + r.status);
  } catch (err) {
    console.error('Unsubscribe failed:', err);
    return res.status(502).send(page('Something went wrong',
      'We couldn’t process that just now. Please try again shortly.'));
  }

  return res.status(200).send(page("You're unsubscribed",
    'That email address won’t get any more sale alerts from this signup. Changed your mind? Any centre page on Tide has the alert box.'));
}
