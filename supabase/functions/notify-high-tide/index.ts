// Tide — daily email job
//
// Runs once a day (11:00 UTC, scheduled via pg_cron — see README in this
// dir). MUST run after the 10:00 UTC scorer: it reads today's
// centre_seer_scores rows, and if those don't exist yet every pass finds
// nothing and no email is sent.
// Two passes:
//
//   1. PEAK ALERTS — for every centre where today's verdict is "Peak"
//      (formerly "Go now" — legacy strings still match), find users who
//      have that centre in user_preferences.saved_centres and send them a
//      "go today" email. PEAK is the one state that earns a recommendation.
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

const CREAM      = "#FAF7F2";
const CREAM_DARK = "#F0EBE3";
const BARK       = "#2C1810";
const LEAF       = "#3D6B35";
const AMBER      = "#C17A2B";
const STONE      = "#8C8070";

interface CentreRow      { id: string; name: string }
interface ScoreRow       { centre_id: string; tide_score: number | null; verdict: string | null; bluf: string | null; trajectory: string | null; brands_on_sale: number | null }
interface PrefsRow       { user_id: string; womenswear: boolean; menswear: boolean; childrenswear: boolean; style_clusters: string[]; saved_centres: string[]; brand_ids: string[] | null; email_alerts: boolean; daily_digest: boolean }
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
  // New trend-only vocabulary
  if (v === "peak")            return "High Tide";
  if (v === "easing")          return "Falling";
  if (v === "rising")          return "Rising";
  if (v === "turning")         return "Turning";
  if (v === "quiet")           return "Turning";
  if (v === "over")            return "Low";
  // Legacy verdict strings (pre-rename)
  if (v.includes("go now"))    return "High Tide";
  if (v.includes("last chance")) return "Falling";
  if (v.includes("worth"))     return "Rising";
  if (v.includes("starting"))  return "Turning";
  if (v.includes("it's over")) return "Low";
  if (v.includes("nothing"))   return "Turning";
  return "Unknown";
}

type DigestStage = "high" | "rising" | "falling" | "low";

function stageBucket(stage: string): DigestStage {
  if (stage === "High Tide") return "high";
  if (stage === "Rising")    return "rising";
  if (stage === "Falling")   return "falling";
  return "low";
}

function stageLabelFor(bucket: DigestStage): string {
  if (bucket === "high")    return "High Tide";
  if (bucket === "rising")  return "Rising";
  if (bucket === "falling") return "Falling";
  return "Low Tide";
}

// User-facing display word for an internal stage. Mirrors the dashboard's
// SERVER_VERDICT_DISPLAY mapping so emails and the web app speak the same
// trend-only vocabulary.
function stageDisplay(stage: string): string {
  if (stage === "High Tide") return "Peak";
  if (stage === "Rising")    return "Rising";
  if (stage === "Falling")   return "Easing";
  if (stage === "Turning")   return "Quiet";
  if (stage === "Low")       return "Over";
  return stage;
}

// ──────────────────────────────────────────────────────────────────────────
// Email rendering — kept inline so the whole function is one file.
//
// Templates follow the Tide Transactional Email Master v1 spec:
//   - Peak Sale Alert  — AMBER hero, two brand lists, optional Centre Intelligence
//   - Brand Sale Alert — LEAF  hero, single-paragraph body (template only; no
//                        sender loop wired yet — exported for the future caller)
//   - Weekend Digest   — BARK  hero, stage-pilled centre scorecard
// All three share baseEmailWrap, which injects the preheader, TIDE wordmark,
// and per-email footer with a labelled unsubscribe link.

export function renderHighTideEmail(opts: {
  centreName: string;
  onSaleCount: number;
  userBrandsOnSale: { name: string; discount?: string }[];
  otherBrandsOnSale: string[];
  remainingCount: number;
  narrative?: string;
}): { subject: string; html: string; text: string } {
  const { centreName, onSaleCount, userBrandsOnSale, otherBrandsOnSale, remainingCount, narrative } = opts;
  const subject = `${centreName} is at High Tide today`;
  const previewText = `${onSaleCount} brands on sale at the same time. This doesn't happen often.`;

  const yourBrandsBlock = userBrandsOnSale.length > 0 ? `
    <div style="font-family:'DM Sans',Arial,sans-serif;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${STONE};margin-bottom:14px">Your brands on sale</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
      ${userBrandsOnSale.map((b, i, arr) => `
        <tr><td style="padding:10px 0;${i < arr.length - 1 ? `border-bottom:1px solid ${CREAM_DARK};` : ''}font-family:'DM Sans',Arial,sans-serif;font-size:14px;color:${BARK};font-weight:500">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${AMBER};margin-right:8px;vertical-align:middle"></span>${escapeHtml(b.name)}${b.discount ? `<span style="float:right;font-weight:300;color:${STONE};font-size:13px">up to ${escapeHtml(b.discount)} off</span>` : ''}
        </td></tr>
      `).join('')}
    </table>` : '';

  const otherBrandsBlock = otherBrandsOnSale.length > 0 ? `
    <div style="font-family:'DM Sans',Arial,sans-serif;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${STONE};margin:24px 0 12px">Also on sale at ${escapeHtml(centreName)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
      ${otherBrandsOnSale.slice(0, 4).map((name, i, arr) => `
        <tr><td style="padding:10px 0;${i < arr.length - 1 ? `border-bottom:1px solid ${CREAM_DARK};` : ''}font-family:'DM Sans',Arial,sans-serif;font-size:14px;color:${BARK};font-weight:500">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${STONE};margin-right:8px;vertical-align:middle"></span>${escapeHtml(name)}
        </td></tr>
      `).join('')}
    </table>
    ${remainingCount > 0 ? `<div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};padding:10px 0 0 13px;font-style:italic">and ${remainingCount} more</div>` : ''}` : '';

  const intelligenceBlock = narrative ? `
    <div style="background:${CREAM_DARK};padding:16px 20px;border-left:2px solid ${STONE};margin:24px 0;font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};line-height:1.65;font-style:italic">${escapeHtml(narrative)}</div>` : '';

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:${AMBER};margin:0 0 16px;line-height:1.25">The tide is in at ${escapeHtml(centreName)}.</div>
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:${BARK};line-height:1.65;margin:0 0 32px;max-width:420px">Right now, <strong>${onSaleCount} brands</strong> are on sale at the same time. That doesn't happen often.</p>
    <hr style="border:none;border-top:1px solid ${CREAM_DARK};margin:28px 0">
    ${yourBrandsBlock}${otherBrandsBlock}${intelligenceBlock}
    <a href="${APP_URL}" style="display:block;background:${AMBER};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">See today's score &rarr;</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: `You're receiving this because ${centreName} is saved in your Tide account and Peak Sale Alerts are switched on. You can turn them off any time — it takes one tap.`,
    unsubLabel: 'Peak Sale Alerts',
  });

  const textParts: string[] = [
    `The tide is in at ${centreName}.`,
    `Right now, ${onSaleCount} brands are on sale at the same time. That doesn't happen often.`,
    '',
  ];
  if (userBrandsOnSale.length > 0) {
    textParts.push('Your brands on sale:');
    userBrandsOnSale.forEach(b => textParts.push(`- ${b.name}${b.discount ? ` (up to ${b.discount} off)` : ''}`));
    textParts.push('');
  }
  if (otherBrandsOnSale.length > 0) {
    textParts.push(`Also on sale at ${centreName}:`);
    otherBrandsOnSale.slice(0, 4).forEach(n => textParts.push(`- ${n}`));
    if (remainingCount > 0) textParts.push(`...and ${remainingCount} more`);
    textParts.push('');
  }
  if (narrative) { textParts.push(narrative); textParts.push(''); }
  textParts.push(`See today's score: ${APP_URL}`);

  return { subject, html, text: textParts.join('\n') };
}

export function renderBrandSaleEmail(opts: {
  brandName: string;
  centre1: string;
  centre2?: string;
  discount?: string;
}): { subject: string; html: string; text: string } {
  const { brandName, centre1, centre2, discount } = opts;
  const subject = `${brandName} just started a sale`;
  const locationPhrase = centre2 ? `${centre1} and ${centre2}` : centre1;
  const previewText = `On now at ${locationPhrase}.${discount ? ` Up to ${discount} off.` : ''}`;

  const bodyParagraph = `${discount ? `Up to ${escapeHtml(discount)} off. ` : ''}On now at ${escapeHtml(centre1)}${centre2 ? ` and ${escapeHtml(centre2)}` : ''}. Worth knowing early in the cycle.`;

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:${LEAF};margin:0 0 16px;line-height:1.25">${escapeHtml(brandName)} just went on sale.</div>
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:${BARK};line-height:1.65;margin:0 0 32px;max-width:420px">${bodyParagraph}</p>
    <a href="${APP_URL}" style="display:block;background:${LEAF};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">See the full picture &rarr;</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: `You're receiving this because you follow ${brandName} on Tide and Brand Sale Alerts are switched on. Unsubscribing here turns off alerts for all followed brands.`,
    unsubLabel: 'Brand Sale Alerts',
  });

  const text = `${brandName} just went on sale.\n\n${discount ? `Up to ${discount} off. ` : ''}On now at ${locationPhrase}. Worth knowing early in the cycle.\n\nSee the full picture: ${APP_URL}`;

  return { subject, html, text };
}

function digestVerdictFor(stage: DigestStage): string {
  if (stage === 'high')    return 'Go now — peak alignment across your brands.';
  if (stage === 'rising')  return 'Worth watching — building momentum.';
  if (stage === 'falling') return 'Starting to fade — not the weekend for it.';
  return 'Quiet for now.';
}

function digestStagePill(stage: DigestStage, stageLabel: string): string {
  const styles = stage === 'high'
    ? `background:rgba(193,122,43,0.15);color:${AMBER}`
    : stage === 'rising'
    ? `background:rgba(61,107,53,0.12);color:${LEAF}`
    : `background:rgba(140,128,112,0.12);color:${STONE}`;
  return `<span style="display:inline-block;font-family:'DM Sans',Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;padding:3px 10px;border-radius:20px;font-weight:500;${styles};margin-left:10px;vertical-align:middle">${escapeHtml(stageLabel)}</span>`;
}

export function renderDigestEmail(opts: {
  dateLabel: string;
  highTideCount: number;
  centres: { name: string; stage: DigestStage; stageLabel: string; verdict: string; narrative?: string }[];
}): { subject: string; html: string; text: string } {
  const { dateLabel, highTideCount, centres } = opts;
  const subject = 'Your Tide briefing — this weekend';
  const previewText = `${highTideCount} of your saved centres at High Tide or Rising. Here's the full picture.`;

  const cards = centres.map((c, i, arr) => `
    <div style="padding:16px 0;${i < arr.length - 1 ? `border-bottom:1px solid ${CREAM_DARK};` : ''}">
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:500;color:${BARK};margin-bottom:6px">${escapeHtml(c.name)}${digestStagePill(c.stage, c.stageLabel)}</div>
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};margin-bottom:4px">${escapeHtml(c.verdict)}</div>
      ${c.narrative ? `<div style="font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:${STONE};font-style:italic;line-height:1.5">${escapeHtml(c.narrative)}</div>` : ''}
    </div>`).join('');

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${STONE};margin:0 0 20px;font-style:italic">Friday, ${escapeHtml(dateLabel)}</div>
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;color:${BARK};margin:0 0 12px;line-height:1.25">Here's how your centres are looking this weekend.</div>
    <hr style="border:none;border-top:1px solid ${CREAM_DARK};margin:28px 0">
    ${cards}
    <a href="${APP_URL}" style="display:block;background:${BARK};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">Open Tide &rarr;</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: "You're receiving this every Friday evening because you opted in to Tide's Weekend Digest. We only send it when at least one of your saved centres is Rising or above — so if it's in your inbox, it's worth a look. You can turn it off any time.",
    unsubLabel: 'Weekend Digest',
  });

  const textLines = [
    `Friday, ${dateLabel}`,
    "Here's how your centres are looking this weekend.",
    '',
    ...centres.map(c => `${c.name} — ${c.stageLabel}\n  ${c.verdict}${c.narrative ? `\n  ${c.narrative}` : ''}`),
    '',
    `Open Tide: ${APP_URL}`,
  ];

  return { subject, html, text: textLines.join('\n') };
}

function baseEmailWrap(opts: { previewText: string; bodyHtml: string; footerReason: string; unsubLabel: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
    <div style="display:none;font-size:1px;color:${CREAM};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(opts.previewText)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CREAM};border-radius:4px;overflow:hidden;border:1px solid rgba(44,24,16,0.06)">
          <tr><td style="background:${BARK};padding:28px 40px;text-align:center">
            <span style="font-family:Georgia,serif;font-size:22px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:${CREAM}">Tide</span>
          </td></tr>
          <tr><td style="background:${CREAM};padding:48px 40px">${opts.bodyHtml}</td></tr>
          <tr><td style="background:${CREAM_DARK};padding:24px 40px;border-top:1px solid #E5DFD6">
            <p style="margin:0 0 12px;font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:${STONE};line-height:1.6">${escapeHtml(opts.footerReason)}</p>
            <div style="font-family:'DM Sans',Arial,sans-serif;font-size:12px">
              <a href="${APP_URL}#account" style="color:${STONE};text-decoration:underline;margin-right:16px">Manage preferences</a>
              <a href="${APP_URL}#unsubscribe" style="color:${STONE};text-decoration:underline">Unsubscribe from ${escapeHtml(opts.unsubLabel)}</a>
            </div>
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
      .select("user_id, womenswear, menswear, childrenswear, style_clusters, saved_centres, brand_ids, email_alerts, daily_digest")
      .not("saved_centres", "eq", "{}"),
  ]);

  for (const [name, r] of [["scores", scoresRes], ["centres", centresRes], ["brands", brandsRes], ["sales", salesRes], ["centre_brands", centreBrandsRes], ["prefs", prefsRes]] as const) {
    if (r.error) return new Response(`Supabase ${name} read failed: ${r.error.message}`, { status: 500 });
  }

  const scores: ScoreRow[]                = scoresRes.data || [];

  // No scores for today means the scorer hasn't run yet — almost always a
  // scheduling bug (this job is cronned before the 10:00 UTC scorer). Bail
  // loudly with a 503 so it shows up in pg_net/cron logs instead of
  // silently "succeeding" with zero emails sent.
  if (scores.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      today,
      reason: `No centre_seer_scores rows for score_date=${today}. The scorer (10:00 UTC) likely hasn't run yet — schedule this job AFTER it (11:00 UTC). See the README.`,
      alertsSent: 0,
      digestsSent: 0,
    }, null, 2), { status: 503, headers: { "content-type": "application/json" } });
  }

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

  const log: { type: string; to?: string; centre?: string; status?: number; ok?: boolean; skipped?: string; error?: unknown }[] = [];
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

    const recipients = allPrefs.filter(p => p.saved_centres.includes(score.centre_id) && p.email_alerts !== false);
    for (const p of recipients) {
      const to = emailById.get(p.user_id);
      if (!to) { log.push({ type: "alert", centre: centreName, skipped: `no email for user ${p.user_id}` }); continue; }
      // "Followed" = brands the user explicitly opted into. Fall back to
      // category-matching when brand_ids isn't populated (legacy accounts).
      const followedIds = new Set(p.brand_ids || []);
      const isFollowed = followedIds.size > 0
        ? (x: typeof onSaleHere[0]) => followedIds.has(x.brand.id)
        : (x: typeof onSaleHere[0]) => brandMatchesPrefs(x.brand, p);
      const followed = onSaleHere.filter(isFollowed);
      const others   = onSaleHere.filter(x => !isFollowed(x));
      const userBrandsOnSale = followed.slice(0, 4).map(x => ({
        name: x.brand.name,
        discount: x.pct ? `${x.pct}%` : undefined,
      }));
      const otherBrandsOnSale = others.slice(0, 4).map(x => x.brand.name);
      const remainingCount = Math.max(0, others.length - 4);
      const { subject, html, text } = renderHighTideEmail({
        centreName,
        onSaleCount: onSaleHere.length,
        userBrandsOnSale,
        otherBrandsOnSale,
        remainingCount,
        narrative: score.bluf || undefined,
      });
      if (dryRun) { log.push({ type: "alert", to, centre: centreName, ok: true, skipped: "dryRun" }); continue; }
      const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
      log.push({ type: "alert", to, centre: centreName, ok: result.ok, status: result.status, error: result.ok ? undefined : result.body });
      if (result.ok) alertsSent++;
    }
  }

  // 3. WEEKEND DIGEST. Schedule note: still fires via the existing daily
  //    07:00 UTC cron — Friday-only cadence is a separate follow-up.
  const scoreByCentre = new Map<string, ScoreRow>(scores.map(s => [s.centre_id, s]));
  const dateLabel = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const stagePriority: Record<DigestStage, number> = { high: 0, rising: 1, falling: 2, low: 3 };
  for (const p of allPrefs) {
    if (p.daily_digest !== true) { log.push({ type: "digest", to: emailById.get(p.user_id), skipped: "daily_digest opt-out" }); continue; }
    const to = emailById.get(p.user_id);
    if (!to) continue;
    const cards = p.saved_centres
      .map(cid => {
        const s = scoreByCentre.get(cid);
        const name = centres.get(cid);
        if (!s || !name) return null;
        const bucket: DigestStage = stageBucket(stageFromVerdict(s.verdict));
        return {
          name,
          stage: bucket,
          stageLabel: stageLabelFor(bucket),
          verdict: digestVerdictFor(bucket),
          narrative: s.bluf || undefined,
        };
      })
      .filter((r): r is { name: string; stage: DigestStage; stageLabel: string; verdict: string; narrative?: string } => r !== null)
      .sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage]);
    const highTideCount = cards.filter(c => c.stage === "high" || c.stage === "rising").length;
    if (highTideCount === 0) { log.push({ type: "digest", to, skipped: "no centre at Rising or above" }); continue; }
    const { subject, html, text } = renderDigestEmail({ dateLabel, highTideCount, centres: cards });
    if (dryRun) { log.push({ type: "digest", to, ok: true, skipped: "dryRun" }); continue; }
    const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
    log.push({ type: "digest", to, ok: result.ok, status: result.status, error: result.ok ? undefined : result.body });
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
