// /api/geo — returns the visitor's country so the static page can decide
// whether to show the non-UK expansion waitlist banner.
//
// The browser can't read Vercel's geo header itself, so this tiny function
// echoes the country code Vercel injects on every request. No auth, no DB,
// no secrets — it only reflects a request header.
//
// GET /api/geo  ->  { "country": "US" }  (null when Vercel can't resolve it,
//                                          e.g. local dev or an unknown IP)

export default function handler(req, res) {
  const c = req.headers['x-vercel-ip-country'] || '';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ country: c.toUpperCase() || null });
}
