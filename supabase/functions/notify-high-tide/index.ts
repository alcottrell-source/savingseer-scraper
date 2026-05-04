// Tide — daily email job
//
// Runs once a day (07:00 UTC, scheduled via pg_cron — see README in this dir).
// Two passes:
//
//   1. HIGH-TIDE ALERTS — for every centre where today's verdict is "Go now",
//      find users who have that centre in user_preferences.saved_centres and
//      send them a "go today" email.
//
//   2. DAILY DIGEST — for every user with saved_centres, list each saved
//      centre with its current stage. Only sent if at least one of their
//      saved centres is at Rising or above (stages: Rising, High Tide).
//
// Each user receives at most one alert email per centre per day, plus at
// most one digest per day. The same email may be sent twice if a centre is
// in both the alert and the digest passes — by design, the digest only
// kicks in when there's something to say.
//
// Env vars (set as Supabase secrets):
//   SUPABASE_URL                 (auto-provided by the runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided by the runtime)
//   RESEND_API_KEY               (set via `supabase secrets set`)
//
// Manual invoke:
//   curl -X POST 'https://<project>.functions.supabase.co/notify-high-tide' \
//        -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'
//
// Skip sending and just preview by passing { "dryRun": true } in the body.

// @ts-ignore — Deno std import (resolved at runtime, not by tsc)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Defaults can be overridden by Supabase secrets — see README. Defaults
// match the production Vercel URL so emails work before the tidego.co DNS
// is pointed at the deployment.
const FROM_EMAIL = Deno.env.get("TIDE_FROM_EMAIL") ?? "Tide <hello@tidego.co>";
const APP_URL    = Deno.env.get("TIDE_APP_URL")    ?? "https://v0-tide-sale-timing.vercel.app";
const RESEND_URL = "https://api.resend.com/emails";

const CREAM = "#FAF7F2";
const BARK  = "#2C1810";
const LEAF  = "#3D6B35";
const AMBER = "#C17A2B";
const STONE = "#8C8070";

interface CentreRow      { id: string; name: string }
interface ScoreRow       { centre_id: string; tide_score: number | null; verdict: string | null; bluf: string | null; trajectory: string | null; brands_on_sale: number | null }
interface PrefsRow       { user_id: string; womenswear: boolean; menswear: boolean; childrenswear: boolean; style_clusters: string[]; saved_centres: string[] }
interface BrandRow       { id: string; name: string; womenswear: boolean; menswear: boolean; childrenswear: boolean; cluster: string | null }
interface SaleEventRow   { brand_id: string; sale_status: boolean | null; date_first_detected: string | null; max_discount_pct: number | null; scraper_error: boolean | null; last_verified_status: boolean | null; last_verified_date: string | null; active_cycle_id: string | null; cycle?: { start_date: string | null; max_discount_pct: number | null } | null }
interface CentreBrandRow { centre_id: string; brand_id: string }

// ──────────────────────────────────────────────────────────────────────────
// Utility — derive whether a brand_sale_events row is "on sale" today.
// Mirrors the precedence logic in index.html (admin verdict > scraper).
function isOnSale(r: SaleEventRow): boolean {
  if (r.active_cycle_id) return true;
  if (r.last_verified_date) return !!r.last_verified_status;
  return !!r.sale_status && !r.scraper_error;
}

function daysOnSale(r: SaleEventRow, today: string): number {
  const startStr = r.cycle?.start_date || r.date_first_detected;
  if (!startStr) return 0;
  const start = new Date(startStr).getTime();
  const now = new Date(today).getTime();
  if (!isFinite(start) || !isFinite(now)) return 0;
  return Math.max(1, Math.floor((now - start) / 86400000) + 1);
}

function brandMatchesPrefs(b: BrandRow, p: PrefsRow): boolean {
  const genderMatch =
    (p.womenswear && b.womenswear) ||
    (p.menswear && b.menswear) ||
    (p.childrenswear && b.childrenswear);
  if (!genderMatch) return false;
  if (p.style_clusters && p.style_clusters.length > 0) {
    if (!b.cluster || !p.style_clusters.includes(b.cluster)) return false;
  }
  return true;
}

function stageFromVerdict(verdict: string | null): string {
  if (!verdict) return "Unknown";
  const v = verdict.toLowerCase();
  if (v.includes("go now"))    return "High Tide";
  if (v.includes("last chance")) return "Falling";
  if (v.includes("worth"))     return "Rising";
  if (v.includes("starting"))  return "Turning";
  if (v.includes("over"))      return "Low";
  if (v.includes("nothing"))   return "Turning";
  return "Unknown";
}

function stageColor(stage: string): string {
  if (stage === "High Tide") return AMBER;
  if (stage === "Rising")    return LEAF;
  if (stage === "Falling")   return "#B84C3A";
  return STONE;
}

// ──────────────────────────────────────────────────────────────────────────
// Email rendering — kept inline so the whole function is one file.

function renderHighTideEmail(centreName: string, brands: { name: string; days: number; pct: number | null }[]): { subject: string; html: string; text: string } {
  const subject = `High Tide at ${centreName} — go today`;
  const top3 = brands.slice(0, 3);
  const brandLine = top3.length === 0
    ? `${centreName} just hit Go Now — peak sales density today.`
    : `${centreName} just hit Go Now. ${top3.map(b => b.name).join(", ").replace(/, ([^,]*)$/, " and $1")} ${top3.length === 1 ? "is" : "are"} on sale at peak freshness.`;

  const pillsHtml = top3.map(b => {
    const daysLabel = b.days <= 1 ? "New today" : b.days <= 7 ? `Fresh · ${b.days}d` : `${b.days}d in`;
    const pctLabel  = b.pct ? ` · Up to ${b.pct}% off` : "";
    return `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(44,24,16,0.08);font-family:'DM Sans',Arial,sans-serif;font-size:14px;color:${BARK}"><strong>${escapeHtml(b.name)}</strong><span style="color:${STONE};font-size:12px;margin-left:8px">${escapeHtml(daysLabel)}${escapeHtml(pctLabel)}</span></td></tr>`;
  }).join("");

  const html = baseEmailWrap({
    bannerText:  "HIGH TIDE — GO NOW",
    bannerColor: AMBER,
    bodyHtml: `
      <p style="margin:0 0 18px;font-family:'DM Sans',Arial,sans-serif;font-size:15px;line-height:1.55;color:${BARK}">${escapeHtml(brandLine)}</p>
      ${top3.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${pillsHtml}</table>` : ""}
      <p style="margin:0 0 22px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.5;color:${STONE}">Best in the first week — stocks fall fast after that.</p>
    `,
    ctaUrl: APP_URL,
  });

  const text = `${brandLine}\n\nTop brands on sale:\n${top3.map(b => `- ${b.name} (${b.days <= 1 ? "new today" : `${b.days}d in`}${b.pct ? `, up to ${b.pct}% off` : ""})`).join("\n")}\n\nSee today's score: ${APP_URL}`;
  return { subject, html, text };
}

function renderDigestEmail(date: string, rows: { centreName: string; stage: string; verdict: string }[]): { subject: string; html: string; text: string } {
  const subject = `Your Tide update — ${date}`;
  const items = rows.map(r => {
    const color = stageColor(r.stage);
    return `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(44,24,16,0.08);font-family:'DM Sans',Arial,sans-serif;font-size:14px;color:${BARK}">
      <strong>${escapeHtml(r.centreName)}</strong>
      <span style="display:inline-block;margin-left:10px;padding:2px 10px;border-radius:10px;background:${color}1A;color:${color};font-size:11px;letter-spacing:0.06em;text-transform:uppercase">${escapeHtml(r.stage)}</span>
      <div style="color:${STONE};font-size:12px;margin-top:2px">${escapeHtml(r.verdict)}</div>
    </td></tr>`;
  }).join("");

  const html = baseEmailWrap({
    bannerText:  "YOUR DAILY TIDE",
    bannerColor: LEAF,
    bodyHtml: `
      <p style="margin:0 0 18px;font-family:'DM Sans',Arial,sans-serif;font-size:15px;line-height:1.55;color:${BARK}">Here's where your saved centres stand today.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${items}</table>
    `,
    ctaUrl: APP_URL,
  });

  const text = `Your Tide update — ${date}\n\n${rows.map(r => `${r.centreName}: ${r.stage} — ${r.verdict}`).join("\n")}\n\nSee today's score: ${APP_URL}`;
  return { subject, html, text };
}

function baseEmailWrap(opts: { bannerText: string; bannerColor: string; bodyHtml: string; ctaUrl: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:16px;overflow:hidden;border:1px solid rgba(44,24,16,0.08)">
          <tr><td style="background:${BARK};padding:18px 22px">
            <span style="font-family:'Georgia',serif;font-size:22px;font-weight:600;letter-spacing:0.18em;color:white">TIDE</span>
          </td></tr>
          <tr><td style="background:${opts.bannerColor};padding:10px 22px">
            <span style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.16em;color:white">${escapeHtml(opts.bannerText)}</span>
          </td></tr>
          <tr><td style="padding:24px 22px 8px">${opts.bodyHtml}</td></tr>
          <tr><td style="padding:0 22px 28px" align="left">
            <a href="${opts.ctaUrl}" style="display:inline-block;background:${BARK};color:white;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;font-size:14px;font-weight:500;padding:11px 22px;border-radius:8px">See today's score</a>
          </td></tr>
          <tr><td style="padding:14px 22px 22px;border-top:1px solid rgba(44,24,16,0.08);font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:${STONE};letter-spacing:0.04em">
            <a href="${APP_URL}" style="color:${STONE}">Manage preferences</a>
            &nbsp;&middot;&nbsp;
            <a href="${APP_URL}#unsubscribe" style="color:${STONE}">Unsubscribe</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ──────────────────────────────────────────────────────────────────────────
// Resend wrapper.

async function sendEmail(to: string, subject: string, html: string, text: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, text }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  return { ok: res.ok, status: res.status, body };
}

// ──────────────────────────────────────────────────────────────────────────
// Main handler.

Deno.serve(async (req: Request) => {
  let dryRun = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      dryRun = !!body.dryRun;
    }
  } catch { /* empty body — fine */ }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
  }
  if (!dryRun && !RESEND_KEY) {
    return new Response("Missing RESEND_API_KEY (use dryRun:true to test without sending)", { status: 500 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const today = new Date().toISOString().split("T")[0];

  // 1. Today's centre scores + centre names + brands.
  const [scoresRes, centresRes, brandsRes, salesRes, centreBrandsRes, prefsRes] = await Promise.all([
    sb.from("centre_seer_scores")
      .select("centre_id, tide_score, verdict, bluf, trajectory, brands_on_sale")
      .eq("score_date", today),
    sb.from("centres").select("id, name").eq("active", true),
    sb.from("brands").select("id, name, womenswear, menswear, childrenswear, cluster"),
    sb.from("brand_sale_events")
      .select("brand_id, sale_status, date_first_detected, max_discount_pct, scraper_error, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)"),
    sb.from("centre_brands").select("centre_id, brand_id"),
    sb.from("user_preferences")
      .select("user_id, womenswear, menswear, childrenswear, style_clusters, saved_centres")
      .not("saved_centres", "eq", "{}"),
  ]);

  for (const [name, r] of [["scores", scoresRes], ["centres", centresRes], ["brands", brandsRes], ["sales", salesRes], ["centre_brands", centreBrandsRes], ["prefs", prefsRes]] as const) {
    if (r.error) return new Response(`Supabase ${name} read failed: ${r.error.message}`, { status: 500 });
  }

  const scores: ScoreRow[]                = scoresRes.data || [];
  const centres = new Map<string, string>((centresRes.data || []).map((c: CentreRow) => [c.id, c.name]));
  const brandsById = new Map<string, BrandRow>((brandsRes.data || []).map((b: BrandRow) => [b.id, b]));
  const salesById = new Map<string, SaleEventRow>((salesRes.data || []).map((s: SaleEventRow) => [s.brand_id, s]));
  const brandsAtCentre = new Map<string, string[]>();
  for (const cb of (centreBrandsRes.data || []) as CentreBrandRow[]) {
    const list = brandsAtCentre.get(cb.centre_id) || [];
    list.push(cb.brand_id);
    brandsAtCentre.set(cb.centre_id, list);
  }
  const allPrefs: PrefsRow[] = prefsRes.data || [];

  // Build email lookup for users with saved_centres. Need to call the auth
  // admin API because user_preferences only stores user_id.
  const userIds = Array.from(new Set(allPrefs.map(p => p.user_id)));
  const emailById = new Map<string, string>();
  for (const uid of userIds) {
    const { data, error } = await sb.auth.admin.getUserById(uid);
    if (error || !data?.user?.email) continue;
    emailById.set(uid, data.user.email);
  }

  const log: { type: string; to?: string; centre?: string; status?: number; ok?: boolean; skipped?: string }[] = [];
  let alertsSent = 0, digestsSent = 0;

  // 2. HIGH-TIDE ALERTS.
  const highTideCentres = scores.filter(s => stageFromVerdict(s.verdict) === "High Tide");
  for (const score of highTideCentres) {
    const centreName = centres.get(score.centre_id);
    if (!centreName) continue;
    const brandIdsHere = brandsAtCentre.get(score.centre_id) || [];
    const onSaleHere = brandIdsHere
      .map(bid => ({ brand: brandsById.get(bid), sale: salesById.get(bid) }))
      .filter(x => x.brand && x.sale && isOnSale(x.sale!))
      .map(x => ({
        brand: x.brand!,
        days: daysOnSale(x.sale!, today),
        pct:  (x.sale!.active_cycle_id && x.sale!.cycle?.max_discount_pct != null)
              ? x.sale!.cycle!.max_discount_pct
              : (x.sale!.max_discount_pct ?? null),
      }))
      .sort((a, b) => a.days - b.days);

    const recipients = allPrefs.filter(p => p.saved_centres.includes(score.centre_id));
    for (const p of recipients) {
      const to = emailById.get(p.user_id);
      if (!to) { log.push({ type: "alert", centre: centreName, skipped: `no email for user ${p.user_id}` }); continue; }
      const hasPrefs = p.womenswear || p.menswear || p.childrenswear;
      const personal = hasPrefs ? onSaleHere.filter(x => brandMatchesPrefs(x.brand, p)) : onSaleHere;
      const top = personal.length ? personal : onSaleHere;
      const { subject, html, text } = renderHighTideEmail(
        centreName,
        top.slice(0, 3).map(x => ({ name: x.brand.name, days: x.days, pct: x.pct })),
      );
      if (dryRun) { log.push({ type: "alert", to, centre: centreName, ok: true, skipped: "dryRun" }); continue; }
      const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
      log.push({ type: "alert", to, centre: centreName, ok: result.ok, status: result.status });
      if (result.ok) alertsSent++;
    }
  }

  // 3. DAILY DIGEST.
  const scoreByCentre = new Map<string, ScoreRow>(scores.map(s => [s.centre_id, s]));
  for (const p of allPrefs) {
    const to = emailById.get(p.user_id);
    if (!to) continue;
    const rows = p.saved_centres
      .map(cid => {
        const s = scoreByCentre.get(cid);
        const name = centres.get(cid);
        if (!s || !name) return null;
        return { centreName: name, stage: stageFromVerdict(s.verdict), verdict: s.verdict || "" };
      })
      .filter((r): r is { centreName: string; stage: string; verdict: string } => r !== null);
    const hasRisingOrAbove = rows.some(r => r.stage === "Rising" || r.stage === "High Tide");
    if (!hasRisingOrAbove) { log.push({ type: "digest", to, skipped: "no centre at Rising or above" }); continue; }
    const { subject, html, text } = renderDigestEmail(today, rows);
    if (dryRun) { log.push({ type: "digest", to, ok: true, skipped: "dryRun" }); continue; }
    const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
    log.push({ type: "digest", to, ok: result.ok, status: result.status });
    if (result.ok) digestsSent++;
  }

  return new Response(JSON.stringify({
    ok: true,
    today,
    dryRun,
    alertsSent,
    digestsSent,
    highTideCentres: highTideCentres.length,
    eligibleUsers: allPrefs.length,
    log,
  }, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
