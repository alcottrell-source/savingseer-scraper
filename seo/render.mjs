// render.mjs
// Pure HTML rendering for the SEO pages. No DB access here — generate.mjs loads
// the data (server-side, where supabase-js is fine) and passes plain objects in.
// The email opt-in inside the page writes from the BROWSER, so it uses a raw
// fetch to PostgREST (the pgUpsert pattern), never supabase-js (which hangs in
// the browser — see index.html).

import { nextSaleWindowSentence } from './next-sale-window.mjs';

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Brands have no slug column (ids are 'Bxxx' codes), so we derive a stable,
// URL-safe slug from the name. Shared by generate.mjs for link building.
export function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/&/g, ' and ').replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── The admin-verified "is this brand on sale?" rule ────────────────────────
// Mirrors score.js:336 and index.html:2006 EXACTLY. Public reads admin-verified
// state only — NEVER the scraper's raw sale_status.
export function isOnSale(sale) {
  if (!sale) return false;
  if (sale.active_cycle_id) return true;
  if (sale.last_verified_date) return !!sale.last_verified_status;
  return false;
}

// Short centre-context phrase for the supporting line on a brand page.
export function centreContext(verdict) {
  switch (verdict) {
    case 'Peak':    return 'lots of shops on sale across the centre';
    case 'Rising':  return 'sale activity building across the centre';
    case 'Easing':
    case 'Falling': return 'sales easing off across the centre';
    default:        return 'few shops on sale across the centre right now';
  }
}

// The brand-specific headline answer — this is what the searcher actually asked.
export function brandAnswer(onSale, cycle, brandName, centreName) {
  if (onSale) {
    const pct = cycle && cycle.maxDiscountPct ? `, up to ${cycle.maxDiscountPct}% off` : '';
    return {
      tone: 'go',
      headline: `Yes — ${brandName} is on sale at ${centreName} now${pct}.`,
      sub: cycle && cycle.startDate ? `Sale tracked and admin-verified by Tide, started ${cycle.startDate}.` : 'Sale tracked and admin-verified by Tide.',
    };
  }
  return {
    tone: 'wait',
    headline: `Not right now — ${brandName} isn't on sale at ${centreName} today.`,
    sub: `Set an alert below and we'll email you the moment a ${brandName} sale starts.`,
  };
}

// Shopper-facing "go now vs wait" copy from the centre's live verdict/trajectory.
export function verdictCopy(verdict, trajectory) {
  switch (verdict) {
    case 'Peak':   return { tone: 'go',   headline: 'Go now.', line: 'Lots of shops on sale across the centre right now.' };
    case 'Rising': return { tone: 'wait', headline: 'Building — not at its peak yet.', line: "Sale activity is climbing. Get an alert below and we'll tell you when it peaks." };
    case 'Easing':
    case 'Falling':return { tone: 'soft', headline: 'Just past its best.', line: 'Still worth a look, but the choice is starting to thin out.' };
    default:       return { tone: 'wait', headline: 'Quiet right now.', line: 'Not much on. Better to wait for the next sale window below.' };
  }
}

const HEAD = (title, desc, canonical) => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<style>
:root{--bg:#0b1410;--card:#11201a;--ink:#f5f1eb;--muted:#9fb3a8;--neon:#5EFFB0;--line:rgba(245,241,235,.12)}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px}
a{color:var(--neon)}h1{font-size:1.9rem;line-height:1.2;margin:.2em 0 .4em}h2{font-size:1.2rem;margin:1.8em 0 .6em}
.crumbs{font-size:.85rem;color:var(--muted);margin-bottom:14px}.crumbs a{color:var(--muted)}
.answer{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:6px 0 22px}
.score{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
.score b{font-size:2.2rem;color:var(--neon);line-height:1}.score span{color:var(--muted)}
.verdict{font-size:1.15rem;font-weight:600;margin:.3em 0}.verdict.go{color:var(--neon)}
.win{color:var(--muted);font-size:.95rem;margin-top:6px}
table{width:100%;border-collapse:collapse;margin:.4em 0}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);font-size:.95rem}
th{color:var(--muted);font-weight:600}.tag{display:inline-block;font-size:.78rem;padding:2px 8px;border-radius:999px;background:rgba(94,255,176,.14);color:var(--neon)}
.tag.off{background:rgba(245,241,235,.08);color:var(--muted)}
.optin{background:linear-gradient(180deg,#13241d,#0e1b16);border:1px solid var(--neon);border-radius:14px;padding:20px 22px;margin:24px 0}
.optin h2{margin-top:0}.optin form{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.optin input{flex:1;min-width:200px;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:#0b1410;color:var(--ink)}
.optin button{padding:11px 18px;border:0;border-radius:10px;background:var(--neon);color:#06231a;font-weight:700;cursor:pointer}
.optin .ok{color:var(--neon);margin-top:8px}.muted{color:var(--muted)}
ul.links{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}ul.links li a{display:inline-block;padding:7px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none}
footer{margin-top:40px;color:var(--muted);font-size:.82rem;border-top:1px solid var(--line);padding-top:16px}
details{border-bottom:1px solid var(--line);padding:10px 0}summary{cursor:pointer;font-weight:600}
</style>
</head>
<body><div class="wrap">`;

const FOOT = (origin) => `
<footer>
Sale timing is shown for guidance, based on Tide's tracked, admin-verified sale data and the UK retail sale calendar — always check in store.
<a href="${origin}/">Tide home</a> · <a href="${origin}/privacy">Privacy</a>
</footer>
</div>
<script>
// Browser write — raw PostgREST fetch (the pgUpsert pattern). NOT supabase-js.
window.__tideOptIn = async function(form, ctx){
  const email = form.email.value.trim(); if(!email) return false;
  const status = form.querySelector('.ok'); status.textContent = 'Saving…';
  try{
    const r = await fetch(SUPABASE_URL + '/rest/v1/seo_alert_signups', {
      method:'POST',
      headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,
               'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body: JSON.stringify({ email, centre_slug: ctx.centre, brand_slug: ctx.brand || null, source_url: location.pathname })
    });
    status.textContent = r.ok ? "Done — we'll email you when "+ctx.label+" peaks." : 'Something went wrong, please try again.';
  }catch(e){ status.textContent = 'Something went wrong, please try again.'; }
  return false;
};
</script>
</body></html>`;

function optInBlock(label, ctx) {
  return `<div class="optin">
<h2>Alert me when ${escapeHtml(label)} hits peak</h2>
<p class="muted">One email when the Tide Score says it's the moment to go. No spam, unsubscribe anytime.</p>
<form onsubmit="return window.__tideOptIn(this, ${escapeHtml(JSON.stringify(ctx))})">
<input type="email" name="email" placeholder="you@email.com" required aria-label="Email address">
<button type="submit">Alert me</button>
<div class="ok" role="status"></div>
</form></div>`;
}

function configScript(supabase) {
  return `<script>const SUPABASE_URL=${JSON.stringify(supabase.url)};const SUPABASE_ANON_KEY=${JSON.stringify(supabase.anonKey)};</script>`;
}

// ── Brand × centre page (the workhorse) ─────────────────────────────────────
export function renderBrandPage(d) {
  const { centre, brand, sale, cycle, hours, siblings, supabase, origin, today } = d;
  const onSale = isOnSale(sale);
  const ans = brandAnswer(onSale, cycle, brand.name, centre.name);
  const ctx = centreContext(centre.verdict);
  const title = `When does ${brand.name} go on sale at ${centre.name}? | Tide`;
  const desc = `Live sale status for ${brand.name} at ${centre.name}: today's Tide Score, whether ${brand.name} is on sale now, and the next likely sale window.`;
  const canonical = `${origin}/centre/${centre.slug}/${brand.slug}`;
  const winSentence = nextSaleWindowSentence(today, centre.name);

  const saleRow = cycle
    ? `<tr><td>${escapeHtml(brand.name)}</td><td><span class="tag">On sale</span></td><td>${cycle.maxDiscountPct ? 'Up to ' + cycle.maxDiscountPct + '% off' : escapeHtml(cycle.saleType || 'Sale on')}</td><td>${escapeHtml(cycle.startDate || '')}</td></tr>`
    : onSale
      ? `<tr><td>${escapeHtml(brand.name)}</td><td><span class="tag">On sale</span></td><td>Sale confirmed</td><td>—</td></tr>`
      : `<tr><td>${escapeHtml(brand.name)}</td><td><span class="tag off">Not on sale</span></td><td>No verified sale right now</td><td>—</td></tr>`;

  const faq = [
    { q: `Is ${brand.name} on sale at ${centre.name} right now?`,
      a: onSale ? `Yes — ${brand.name} has a sale confirmed at ${centre.name}. ${cycle && cycle.maxDiscountPct ? 'Up to ' + cycle.maxDiscountPct + '% off.' : ''}`.trim()
                : `Not right now — there's no verified ${brand.name} sale at ${centre.name} today. Set an alert above and we'll email you when one starts.` },
    { q: `When is the next sale at ${centre.name}?`,
      a: winSentence || `Sales tend to follow the UK retail calendar — Boxing Day, summer, and Black Friday are the biggest windows.` },
    { q: `What time should I go to ${centre.name} to avoid crowds?`,
      a: `${centre.name} is generally quietest on weekday mornings shortly after opening${hours ? ' (' + escapeHtml(hours) + ')' : ''}.` },
  ];
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Tide', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: centre.name, item: `${origin}/centre/${centre.slug}` },
      { '@type': 'ListItem', position: 3, name: brand.name, item: canonical },
    ],
  };

  const sibLinks = siblings.slice(0, 12)
    .map(s => `<li><a href="${origin}/centre/${centre.slug}/${s.slug}">${escapeHtml(s.name)}${s.onSale ? ' • on sale' : ''}</a></li>`).join('');

  return HEAD(title, desc, canonical) + configScript(supabase) + `
<div class="crumbs"><a href="${origin}/">Tide</a> › <a href="${origin}/centre/${centre.slug}">${escapeHtml(centre.name)}</a> › ${escapeHtml(brand.name)}</div>
<h1>When does ${escapeHtml(brand.name)} go on sale at ${escapeHtml(centre.name)}?</h1>
<div class="answer">
  <div class="verdict ${ans.tone === 'go' ? 'go' : ''}">${escapeHtml(ans.headline)}</div>
  <div>${escapeHtml(ans.sub)}</div>
  <div class="score" style="margin-top:14px"><b>${escapeHtml(String(centre.tideScore))}</b><span>/100 — ${escapeHtml(centre.name)}'s Tide Score today, ${escapeHtml(ctx)}</span></div>
  ${winSentence ? `<div class="win">${escapeHtml(winSentence)}</div>` : ''}
</div>

<h2>${escapeHtml(brand.name)} sales at ${escapeHtml(centre.name)}</h2>
<table><thead><tr><th>Brand</th><th>Status</th><th>Offer</th><th>Started</th></tr></thead><tbody>${saleRow}</tbody></table>
${brand.saleUrl ? `<p class="muted">Official ${escapeHtml(brand.name)} sale page: <a href="${escapeHtml(brand.saleUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(brand.name)}</a></p>` : ''}

${optInBlock(`${brand.name} at ${centre.name}`, { centre: centre.slug, brand: brand.slug, label: brand.name })}

${hours ? `<h2>Visiting ${escapeHtml(centre.name)}</h2><p>Opening hours: ${escapeHtml(hours)}.</p>` : ''}

<h2>Other shops at ${escapeHtml(centre.name)}</h2>
<ul class="links">${sibLinks}<li><a href="${origin}/centre/${centre.slug}">All of ${escapeHtml(centre.name)} →</a></li></ul>

<h2>FAQ</h2>
${faq.map(f => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('')}
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
` + FOOT(origin);
}

// ── Centre hub page ─────────────────────────────────────────────────────────
export function renderCentreHub(d) {
  const { centre, brands, hours, supabase, origin, today } = d;
  const title = `${centre.name} sales today — what's on sale | Tide`;
  const desc = `Live sale tracker for ${centre.name}: today's Tide Score, which shops are on sale right now, and the next likely sale window.`;
  const canonical = `${origin}/centre/${centre.slug}`;
  const v = verdictCopy(centre.verdict, centre.trajectory);
  const winSentence = nextSaleWindowSentence(today, centre.name);
  const onSaleBrands = brands.filter(b => b.onSale);

  const rows = brands.map(b =>
    `<tr><td><a href="${origin}/centre/${centre.slug}/${b.slug}">${escapeHtml(b.name)}</a></td><td>${b.onSale ? '<span class="tag">On sale</span>' : '<span class="tag off">—</span>'}</td></tr>`
  ).join('');

  return HEAD(title, desc, canonical) + configScript(supabase) + `
<div class="crumbs"><a href="${origin}/">Tide</a> › ${escapeHtml(centre.name)}</div>
<h1>${escapeHtml(centre.name)} sales today</h1>
<div class="answer">
  <div class="score"><b>${escapeHtml(String(centre.tideScore))}</b><span>/100 Tide Score · ${escapeHtml(String(onSaleBrands.length))} of ${escapeHtml(String(brands.length))} tracked shops on sale</span></div>
  <div class="verdict ${v.tone === 'go' ? 'go' : ''}">${escapeHtml(v.headline)}</div>
  <div>${escapeHtml(v.line)}</div>
  ${winSentence ? `<div class="win">${escapeHtml(winSentence)}</div>` : ''}
</div>

${optInBlock(centre.name, { centre: centre.slug, brand: null, label: centre.name })}

<h2>Shops tracked at ${escapeHtml(centre.name)}</h2>
<table><thead><tr><th>Shop</th><th>Today</th></tr></thead><tbody>${rows}</tbody></table>
${hours ? `<p class="muted">Opening hours: ${escapeHtml(hours)}.</p>` : ''}
` + FOOT(origin);
}
