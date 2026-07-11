// Tide — email job. Three passes, gated by the POST body so a single
// function serves two distinct schedules (see .github/workflows/notify.yml):
//
//   1. PEAK ALERTS — for every centre where today's verdict is "Peak"
//      (formerly "Go now" — legacy strings still match), find users who
//      have that centre in user_preferences.saved_centres and send them a
//      "go today" email. PEAK is the one state that earns a recommendation.
//
//   2. BRAND-SALE ALERTS — for every brand whose sale cycle starts today
//      OR whose discount deepens today (admin "Sale increased" bumps
//      pct_changed_date), email users who follow that brand (brand_ids, or
//      legacy gender/cluster match) and have brand_sale_alerts on. Both
//      signals are inherently one-shot: start-today is true only on the
//      cycle's first day, and pct_changed_date only moves on a genuine %
//      change — so a user gets at most one email per brand per event.
//
//   3. WEEKEND DIGEST — for every user with saved_centres, list each saved
//      centre with its current stage. Only sent if at least one of their
//      saved centres is at Rising or above (stages: Rising, High Tide).
//
// Invocation modes (POST body):
//   {}                   → daily run: passes 1 + 2, no digest
//   {"digestOnly":true}  → Friday 19:00 run: pass 3 only
//   add "dryRun":true to either to preview without sending
//
// Env vars (set as Supabase secrets):
//   SUPABASE_URL                 (auto-provided by the runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided by the runtime)
//   RESEND_API_KEY               (set via `supabase secrets set`)
//
// Manual invoke:
//   curl -X POST 'https://<project>.functions.supabase.co/notify-high-tide' \
//        -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' -d '{"dryRun":true}'

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
interface ScoreRow       { centre_id: string; tide_score: number | null; verdict: string | null; bluf: string | null; trajectory: string | null; brands_on_sale: number | null; avg_discount_pct: number | null }
interface PrefsRow       { user_id: string; womenswear: boolean; menswear: boolean; childrenswear: boolean; style_clusters: string[]; saved_centres: string[]; brand_ids: string[] | null; excluded_brand_ids: string[] | null; email_alerts: boolean; brand_sale_alerts: boolean; daily_digest: boolean }
interface BrandRow       { id: string; name: string; womenswear: boolean; menswear: boolean; childrenswear: boolean; cluster: string | null }
interface SaleEventRow   { brand_id: string; max_discount_pct: number | null; last_verified_status: boolean | null; last_verified_date: string | null; date_first_detected: string | null; active_cycle_id: string | null; cycle?: { start_date: string | null; max_discount_pct: number | null; pct_changed_date: string | null; prior_discount_pct: number | null } | null }
interface CentreBrandRow { centre_id: string; brand_id: string }

// ──────────────────────────────────────────────────────────────────────────
// Utility — derive whether a brand_sale_events row is "on sale" today.
// Admin-verified only (the scraper was removed): an open cycle, else the
// admin's last verified decision.
function isOnSale(r: SaleEventRow): boolean {
  if (r.active_cycle_id) return true;
  if (r.last_verified_date) return !!r.last_verified_status;
  return false;
}

function daysOnSale(r: SaleEventRow, today: string): number {
  const startStr = r.cycle?.start_date || r.last_verified_date;
  if (!startStr) return 0;
  const start = new Date(startStr).getTime();
  const now = new Date(today).getTime();
  if (!isFinite(start) || !isFinite(now)) return 0;
  return Math.max(1, Math.floor((now - start) / 86400000) + 1);
}

// True only on the day a brand's sale begins. Admin-verified cycles carry an
// explicit start_date that is fixed for the life of the cycle (admin.html's
// confirm_start reuses an open cycle rather than reopening one, so re-
// confirming a live sale never moves this date). Brands verified on without a
// cycle fall back to date_first_detected — the IMMUTABLE first-seen date, NOT
// last_verified_date. last_verified_date is bumped to today by every admin
// re-verification (confirm_on, edits, …); keying off it re-armed this "started
// today" signal each time a no-cycle sale was re-affirmed, re-sending the
// brand-sale alert. Both keys are now stable for the cycle's lifetime, so this
// stays true for exactly one day and doubles as send-once dedup.
function startedToday(r: SaleEventRow, today: string): boolean {
  if (r.active_cycle_id) return r.cycle?.start_date === today;
  return isOnSale(r) && r.date_first_detected === today;
}

// Mirrors index.html's DEEPEN_WEEK_DAYS (the hero depth row's "this week").
const DEEPEN_WEEK_DAYS = 7;

// True only on the day an admin deepens a live sale's discount mid-cycle.
// pct_changed_date is backfilled to start_date on new cycles, so the
// `!== start_date` clause excludes sales that are merely new — those belong
// to startedToday (the two are mutually exclusive by construction: a cycle
// started today has pct_changed_date === start_date === today even after a
// same-day Increase). One-shot like startedToday: admin.html only bumps
// pct_changed_date on a genuine % change, so this doubles as send-once dedup.
function deepenedToday(r: SaleEventRow, today: string): boolean {
  const c = r.active_cycle_id ? r.cycle : null;
  if (!c?.pct_changed_date || !c.start_date) return false;
  return c.pct_changed_date === today && c.pct_changed_date !== c.start_date;
}

// Mirror of index.html's isDeepenedBrand(b, windowDays): the discount was
// bumped mid-cycle within the last windowDays days (1-based day count —
// changed today = day 1). Drives the digest's "M cut deeper this week".
function deepenedWithin(r: SaleEventRow, today: string, windowDays: number): boolean {
  const c = r.active_cycle_id ? r.cycle : null;
  if (!c?.pct_changed_date || !c.start_date) return false;
  if (c.pct_changed_date <= c.start_date) return false; // merely new, not deepened
  const diff = new Date(today).getTime() - new Date(c.pct_changed_date).getTime();
  if (!isFinite(diff) || diff < 0) return false;
  const changeDays = Math.floor(diff / 86400000) + 1;
  return changeDays >= 1 && changeDays <= windowDays;
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
  centreId?: string;
  discount?: string;
}): { subject: string; html: string; text: string } {
  const { brandName, centre1, centre2, centreId, discount } = opts;
  const subject = `${brandName} just started a sale`;
  const locationPhrase = centre2 ? `${centre1} and ${centre2}` : centre1;
  const previewText = `On now at ${locationPhrase}.${discount ? ` Up to ${discount} off.` : ''}`;

  const bodyParagraph = `${discount ? `Up to ${escapeHtml(discount)} off. ` : ''}On now at ${escapeHtml(centre1)}${centre2 ? ` and ${escapeHtml(centre2)}` : ''}. Worth knowing early in the cycle.`;

  // Deep-link straight to the centre's view (personal-by-default for followers),
  // so the tap lands exactly where the shopper expects — not the generic home.
  const ctaHref = centreId ? `${APP_URL}?centre=${encodeURIComponent(centreId)}` : APP_URL;
  const ctaLabel = `See it at ${escapeHtml(centre1)} &rarr;`;

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:${LEAF};margin:0 0 16px;line-height:1.25">${escapeHtml(brandName)} just went on sale.</div>
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:${BARK};line-height:1.65;margin:0 0 32px;max-width:420px">${bodyParagraph}</p>
    <a href="${ctaHref}" style="display:block;background:${LEAF};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">${ctaLabel}</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: `You're receiving this because you follow ${brandName} on Tide and Brand Sale Alerts are switched on. Unsubscribing here turns off alerts for all followed brands.`,
    unsubLabel: 'Brand Sale Alerts',
  });

  const text = `${brandName} just went on sale.\n\n${discount ? `Up to ${discount} off. ` : ''}On now at ${locationPhrase}. Worth knowing early in the cycle.\n\nSee it at ${centre1}: ${ctaHref}`;

  return { subject, html, text };
}

// Deepened sibling of renderBrandSaleEmail: a followed brand's live sale just
// cut its discount deeper (admin "Sale increased"). Same LEAF hero + CTA —
// this is the Brand Sale Alert family (same gate, same unsubscribe label) —
// with AMBER only as an inline accent on the was→now numbers, echoing the
// dashboard's amber deepening accent. An all-amber hero would masquerade as
// the Peak alert. Trend vocabulary only; no recommendation language.
export function renderBrandDeepenedEmail(opts: {
  brandName: string;
  centre1: string;
  centre2?: string;
  centreId?: string;
  discount?: string;
  wasDiscount?: string;
}): { subject: string; html: string; text: string } {
  const { brandName, centre1, centre2, centreId, discount, wasDiscount } = opts;
  const subject = `${brandName} just cut deeper`;
  const locationPhrase = centre2 ? `${centre1} and ${centre2}` : centre1;
  const previewText = discount
    ? `${wasDiscount ? `Was ${wasDiscount}, now` : 'Now'} up to ${discount} off. On now at ${locationPhrase}.`
    : `The discount just got deeper. On now at ${locationPhrase}.`;

  const locationHtml = `${escapeHtml(centre1)}${centre2 ? ` and ${escapeHtml(centre2)}` : ''}`;
  const bodyParagraph = discount
    ? `${wasDiscount ? `Was <strong style="color:${AMBER}">${escapeHtml(wasDiscount)}</strong>, now` : 'Now'} up to <strong style="color:${AMBER}">${escapeHtml(discount)} off</strong> &mdash; the discount deepened today. On now at ${locationHtml}.`
    : `The discount deepened today. On now at ${locationHtml}.`;

  const ctaHref = centreId ? `${APP_URL}?centre=${encodeURIComponent(centreId)}` : APP_URL;
  const ctaLabel = `See it at ${escapeHtml(centre1)} &rarr;`;

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:${LEAF};margin:0 0 16px;line-height:1.25">${escapeHtml(brandName)} just cut deeper.</div>
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:${BARK};line-height:1.65;margin:0 0 32px;max-width:420px">${bodyParagraph}</p>
    <a href="${ctaHref}" style="display:block;background:${LEAF};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">${ctaLabel}</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: `You're receiving this because you follow ${brandName} on Tide and Brand Sale Alerts are switched on. Unsubscribing here turns off alerts for all followed brands.`,
    unsubLabel: 'Brand Sale Alerts',
  });

  const textBody = discount
    ? `${wasDiscount ? `Was ${wasDiscount}, now` : 'Now'} up to ${discount} off — the discount deepened today. On now at ${locationPhrase}.`
    : `The discount deepened today. On now at ${locationPhrase}.`;
  const text = `${brandName} just cut deeper.\n\n${textBody}\n\nSee it at ${centre1}: ${ctaHref}`;

  return { subject, html, text };
}

// Multi-brand sibling of renderBrandSaleEmail. When more than one of a user's
// followed brands has sale news on the same day (new sales, deepened cuts, or
// a mix) we send ONE summary email listing them all, instead of N separate
// messages. The single-brand paths above still handle the one-item case.
export function renderBrandSaleDigestEmail(opts: {
  brands: { brandName: string; centre1: string; centre2?: string; centreId?: string; discount?: string; wasDiscount?: string; kind?: 'started' | 'deepened' }[];
}): { subject: string; html: string; text: string } {
  const { brands } = opts;
  const n = brands.length;
  const names = brands.map(b => b.brandName);
  const nameList = names.length === 2
    ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const startedN  = brands.filter(b => b.kind !== 'deepened').length;
  const deepenedN = n - startedN;
  const allStarted  = deepenedN === 0;
  const allDeepened = startedN === 0;

  const subject = allStarted
    ? `${n} of your shops just started a sale`
    : allDeepened
    ? `${n} of your shops just cut deeper`
    : `Your shops: ${startedN} new sale${startedN === 1 ? '' : 's'}, ${deepenedN} cut deeper`;
  const previewText = allStarted ? `${nameList} — on now.` : `${nameList} — sale news today.`;
  const heading = allStarted
    ? `${n} of your shops just went on sale.`
    : allDeepened
    ? `${n} of your shops just cut deeper.`
    : `Sale news from ${n} of your shops.`;
  const intro = allStarted
    ? 'All starting their sale today — worth knowing early in the cycle.'
    : allDeepened
    ? 'All cut their discounts deeper today.'
    : 'New sales and deeper cuts, all today.';

  // Discount strings are `${number}%` by construction, so only centre names
  // need escaping in HTML mode.
  const rowMeta = (b: typeof brands[0], html: boolean): string => {
    const loc = html
      ? (b.centre2 ? `${escapeHtml(b.centre1)} and ${escapeHtml(b.centre2)}` : escapeHtml(b.centre1))
      : (b.centre2 ? `${b.centre1} and ${b.centre2}` : b.centre1);
    const sep = html ? ' &middot; ' : ' · ';
    const dash = html ? ' &mdash; ' : ' — ';
    if (b.kind === 'deepened') {
      const cut = html ? `<span style="color:${AMBER};font-weight:500">Cut deeper today</span>` : 'Cut deeper today';
      const pct = b.discount
        ? `${dash}${b.wasDiscount ? `was ${b.wasDiscount}, ` : ''}now up to ${b.discount} off`
        : '';
      return `${cut}${pct}${sep}On at ${loc}`;
    }
    const disc = b.discount ? `Up to ${b.discount} off${sep}` : '';
    return `${disc}On now at ${loc}`;
  };

  const rows = brands.map((b, i, arr) => `
    <div style="padding:16px 0;${i < arr.length - 1 ? `border-bottom:1px solid ${CREAM_DARK};` : ''}">
      <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:${LEAF};margin:0 0 4px;line-height:1.3">${escapeHtml(b.brandName)}</div>
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};line-height:1.5">${rowMeta(b, true)}</div>
    </div>`).join('');

  const bodyHtml = `
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:${BARK};margin:0 0 12px;line-height:1.25">${heading}</div>
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:${BARK};line-height:1.65;margin:0 0 8px;max-width:420px">${intro}</p>
    <hr style="border:none;border-top:1px solid ${CREAM_DARK};margin:20px 0 0">
    ${rows}
    <a href="${APP_URL}" style="display:block;background:${LEAF};color:#FFFFFF;text-align:center;padding:16px 24px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;border-radius:2px;margin-top:32px;font-weight:500">See your shops &rarr;</a>`;

  const html = baseEmailWrap({
    previewText,
    bodyHtml,
    footerReason: `You're receiving this because you follow these brands on Tide and Brand Sale Alerts are switched on. Unsubscribing here turns off alerts for all followed brands.`,
    unsubLabel: 'Brand Sale Alerts',
  });

  const textLines = [
    heading,
    '',
    ...brands.map(b => `${b.brandName} — ${rowMeta(b, false)}`),
    '',
    `See your shops: ${APP_URL}`,
  ];

  return { subject, html, text: textLines.join('\n') };
}

function digestVerdictFor(stage: DigestStage, deepened = false): string {
  // Trend-only copy, matching the dashboard's May-2026 vocabulary. Action
  // language ("go now") is reserved for the high/peak bucket — the one state
  // where the product tells the reader to act, mirroring the PEAK badge.
  // Every other line describes direction, not a recommendation. The falling
  // line gains a deepening clause when brands cut deeper this week (mirrors
  // the dashboard's CYCLE_PHRASE_DEEPER.EASING).
  if (stage === 'high')    return 'Go now — peak alignment across your brands.';
  if (stage === 'rising')  return 'Momentum building across your brands.';
  if (stage === 'falling') return deepened
    ? 'Easing — fewer brands on sale than at the peak, but remaining sales are cutting deeper.'
    : 'Easing — fewer brands on sale than at the peak.';
  return 'Largely gone out for now.';
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
  centres: { name: string; stage: DigestStage; stageLabel: string; verdict: string; narrative?: string; avgDiscount?: number | null; deepenedCount?: number }[];
}): { subject: string; html: string; text: string } {
  const { dateLabel, highTideCount, centres } = opts;
  const subject = 'Your Tide briefing — this weekend';
  const previewText = `${highTideCount} of your saved centres at High Tide or Rising. Here's the full picture.`;

  // Depth fact line, only when the centre has a known average discount. The
  // deepened clause is omitted at zero so quiet cards stay quiet.
  const depthLine = (c: typeof centres[0], html: boolean): string => {
    if (c.avgDiscount == null) return '';
    const deep = (c.deepenedCount || 0) > 0
      ? `${html ? ' &middot; ' : ' · '}${c.deepenedCount} cut deeper this week`
      : '';
    return `Average discount ${c.avgDiscount}%${deep}`;
  };

  const cards = centres.map((c, i, arr) => `
    <div style="padding:16px 0;${i < arr.length - 1 ? `border-bottom:1px solid ${CREAM_DARK};` : ''}">
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:500;color:${BARK};margin-bottom:6px">${escapeHtml(c.name)}${digestStagePill(c.stage, c.stageLabel)}</div>
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};margin-bottom:4px">${escapeHtml(c.verdict)}</div>
      ${depthLine(c, true) ? `<div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:${STONE};margin-bottom:4px">${depthLine(c, true)}</div>` : ''}
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
    ...centres.map(c => `${c.name} — ${c.stageLabel}\n  ${c.verdict}${depthLine(c, false) ? `\n  ${depthLine(c, false)}` : ''}${c.narrative ? `\n  ${c.narrative}` : ''}`),
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
  let digestOnly = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      dryRun = !!body.dryRun;
      digestOnly = !!body.digestOnly;
    }
  } catch { /* empty body — fine */ }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
  }

  // Application-level auth. The platform JWT gate is satisfied by the
  // publicly-embedded anon key, so without this check anyone could POST {}
  // and blast an email to the entire user base. Require the caller to
  // present the service-role key as the Bearer token (the in-repo notify
  // workflow already does), or an explicit NOTIFY_TRIGGER_SECRET if set.
  const TRIGGER_SECRET = Deno.env.get("NOTIFY_TRIGGER_SECRET");
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const authorized =
    (bearer && bearer === SERVICE_KEY) ||
    (TRIGGER_SECRET && req.headers.get("x-notify-secret") === TRIGGER_SECRET);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!dryRun && !RESEND_KEY) {
    return new Response("Missing RESEND_API_KEY (use dryRun:true to test without sending)", { status: 500 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().split("T")[0];

  // 1. Today's centre scores + centre names + brands.
  const [scoresRes, centresRes, brandsRes, salesRes, centreBrandsRes, prefsRes] = await Promise.all([
    sb.from("centre_seer_scores")
      .select("centre_id, tide_score, verdict, bluf, trajectory, brands_on_sale, avg_discount_pct")
      .eq("score_date", today),
    sb.from("centres").select("id, name").eq("active", true),
    sb.from("brands").select("id, name, womenswear, menswear, childrenswear, cluster"),
    sb.from("brand_sale_events")
      .select("brand_id, max_discount_pct, last_verified_status, last_verified_date, date_first_detected, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct,pct_changed_date,prior_discount_pct)"),
    sb.from("centre_brands").select("centre_id, brand_id"),
    // No saved_centres filter: brand-sale alerts target followed brands, so
    // users who follow brands without saving a centre must be included too.
    // Each pass filters saved_centres / brand_ids in-code.
    sb.from("user_preferences")
      .select("user_id, womenswear, menswear, childrenswear, style_clusters, saved_centres, brand_ids, excluded_brand_ids, email_alerts, brand_sale_alerts, daily_digest"),
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

  const log: { type: string; to?: string; centre?: string; brand?: string; brands?: string[]; kinds?: string[]; count?: number; status?: number; ok?: boolean; skipped?: string }[] = [];
  let alertsSent = 0, brandAlertsSent = 0, digestsSent = 0;

  // 2. HIGH-TIDE ALERTS. (daily run only — skipped on the Friday digest call)
  //
  // Send-once gate: a centre can sit at Peak for several days, but the alert
  // must fire only on the day it FIRST reaches Peak — otherwise a multi-day
  // peak emails saved-centre users every morning it lasts. Mirrors the
  // brand-sale pass's `startedToday` one-shot logic. We treat "Peak today but
  // not Peak yesterday" as the fresh-peak signal; a centre that dips out of
  // Peak and climbs back later earns a new alert, which is intended.
  let peakYesterday = new Set<string>();
  if (!digestOnly) {
    const yScoresRes = await sb.from("centre_seer_scores")
      .select("centre_id, verdict")
      .eq("score_date", yesterday);
    if (yScoresRes.error) return new Response(`Supabase yesterday scores read failed: ${yScoresRes.error.message}`, { status: 500 });
    peakYesterday = new Set((yScoresRes.data || [])
      .filter((s: { verdict: string | null }) => stageFromVerdict(s.verdict) === "High Tide")
      .map((s: { centre_id: string }) => s.centre_id));
  }
  const highTideCentres = digestOnly ? [] : scores.filter(s =>
    stageFromVerdict(s.verdict) === "High Tide" && !peakYesterday.has(s.centre_id));
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
      log.push({ type: "alert", to, centre: centreName, ok: result.ok, status: result.status });
      if (result.ok) alertsSent++;
    }
  }

  // 2b. BRAND-SALE ALERTS. (daily run only) Two one-shot signals share this
  //     pass: "started today" (true for exactly one day per cycle) and
  //     "deepened today" (pct_changed_date bumped by an admin Increase — also
  //     true for one day per bump). Each follower gets one email per brand
  //     per event without any separate sent-state table.
  const centresForBrand = new Map<string, string[]>();
  for (const [centreId, brandIds] of brandsAtCentre) {
    for (const bid of brandIds) {
      const list = centresForBrand.get(bid) || [];
      list.push(centreId);
      centresForBrand.set(bid, list);
    }
  }
  // Classify each on-sale brand: 'started' wins over 'deepened' (mutually
  // exclusive by construction — see deepenedToday), and started items sort
  // first so new sales lead the mixed summary email.
  const alertBrands = digestOnly ? [] : Array.from(salesById.values())
    .map(s => ({
      sale: s,
      kind: startedToday(s, today) ? 'started' as const
          : deepenedToday(s, today) ? 'deepened' as const : null,
    }))
    .filter((x): x is { sale: SaleEventRow; kind: 'started' | 'deepened' } => x.kind !== null)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'started' ? -1 : 1))
    .map(x => ({ ...x, brand: brandsById.get(x.sale.brand_id) }))
    .filter((x): x is { sale: SaleEventRow; kind: 'started' | 'deepened'; brand: BrandRow } => !!x.brand);
  // Accumulate per user so that a user with several followed brands making
  // sale news today receives ONE summary email rather than one per brand. We
  // walk alert brands (outer) to reuse the per-brand recipient + centre-pick
  // logic, then group the resulting items by user id (preserving brand order)
  // and send once below.
  type BrandSaleItem = { brandName: string; centre1: string; centre2?: string; centreId?: string; discount?: string; wasDiscount?: string; kind: 'started' | 'deepened' };
  const perUser = new Map<string, { p: PrefsRow; items: BrandSaleItem[] }>();
  for (const { sale, kind, brand } of alertBrands) {
    const pct = (sale.active_cycle_id && sale.cycle?.max_discount_pct != null)
      ? sale.cycle!.max_discount_pct
      : (sale.max_discount_pct ?? null);
    // Prior % for the "was 50%, now up to 70%" clause — deepened items only,
    // and only when a real prior was recorded (0/null treated as absent,
    // consistent with the `pct ? …` truthiness below).
    const priorPct = kind === 'deepened' ? (sale.cycle?.prior_discount_pct ?? null) : null;
    const brandCentreIds = centresForBrand.get(brand.id) || [];
    const recipients = allPrefs.filter(p => {
      if (p.brand_sale_alerts === false) return false;
      if ((p.excluded_brand_ids || []).includes(brand.id)) return false;
      const followed = new Set(p.brand_ids || []);
      return followed.size > 0 ? followed.has(brand.id) : brandMatchesPrefs(brand, p);
    });
    for (const p of recipients) {
      // Prefer the user's own saved centres that carry the brand; fall back
      // to any centre stocking it. Keep the centre IDs so the email can
      // deep-link straight into that centre's (now personal-by-default) view.
      const saved = new Set(p.saved_centres);
      const relevant = brandCentreIds.filter(cid => saved.has(cid));
      const pickCids = (relevant.length > 0 ? relevant : brandCentreIds).filter(cid => !!centres.get(cid));
      if (pickCids.length === 0) { log.push({ type: "brand", to: emailById.get(p.user_id), brand: brand.name, skipped: "no centre carries brand" }); continue; }
      const entry = perUser.get(p.user_id) || { p, items: [] };
      entry.items.push({ brandName: brand.name, centre1: centres.get(pickCids[0])!, centre2: pickCids[1] ? centres.get(pickCids[1])! : undefined, centreId: pickCids[0], discount: pct ? `${pct}%` : undefined, wasDiscount: priorPct ? `${priorPct}%` : undefined, kind });
      perUser.set(p.user_id, entry);
    }
  }
  for (const { p, items } of perUser.values()) {
    const to = emailById.get(p.user_id);
    if (!to) { log.push({ type: "brand", skipped: `no email for user ${p.user_id}`, brands: items.map(i => i.brandName) }); continue; }
    const { subject, html, text } = items.length === 1
      ? (items[0].kind === 'started' ? renderBrandSaleEmail(items[0]) : renderBrandDeepenedEmail(items[0]))
      : renderBrandSaleDigestEmail({ brands: items });
    if (dryRun) { log.push({ type: "brand", to, brands: items.map(i => i.brandName), kinds: items.map(i => i.kind), count: items.length, ok: true, skipped: "dryRun" }); continue; }
    const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
    log.push({ type: "brand", to, brands: items.map(i => i.brandName), kinds: items.map(i => i.kind), count: items.length, ok: result.ok, status: result.status });
    if (result.ok) brandAlertsSent++;
  }

  // 3. WEEKEND DIGEST. Sent only on the Friday 19:00 UTC invocation
  //    ({"digestOnly":true}); the daily run skips this pass entirely.
  const scoreByCentre = new Map<string, ScoreRow>(scores.map(s => [s.centre_id, s]));
  const dateLabel = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const stagePriority: Record<DigestStage, number> = { high: 0, rising: 1, falling: 2, low: 3 };
  // Per-centre "cut deeper this week" counts — on-sale brands whose discount
  // was bumped mid-cycle in the last DEEPEN_WEEK_DAYS days (mirrors the hero
  // depth row). Computed once; user cards read from it.
  const deepenedAtCentre = new Map<string, number>();
  if (digestOnly) {
    for (const [cid, bids] of brandsAtCentre) {
      deepenedAtCentre.set(cid, bids.filter(bid => {
        const s = salesById.get(bid);
        return s && isOnSale(s) && deepenedWithin(s, today, DEEPEN_WEEK_DAYS);
      }).length);
    }
  }
  for (const p of (digestOnly ? allPrefs : [])) {
    if (p.daily_digest !== true) { log.push({ type: "digest", to: emailById.get(p.user_id), skipped: "daily_digest opt-out" }); continue; }
    const to = emailById.get(p.user_id);
    if (!to) continue;
    const cards = p.saved_centres
      .map(cid => {
        const s = scoreByCentre.get(cid);
        const name = centres.get(cid);
        if (!s || !name) return null;
        const bucket: DigestStage = stageBucket(stageFromVerdict(s.verdict));
        const deepenedCount = deepenedAtCentre.get(cid) || 0;
        // != null guard BEFORE coercion: +null is 0 (finite), which would
        // render a no-percentages centre as a fake "Average discount 0%".
        const avgDiscount = s.avg_discount_pct != null && Number.isFinite(+s.avg_discount_pct)
          ? Math.round(+s.avg_discount_pct) : null;
        return {
          name,
          stage: bucket,
          stageLabel: stageLabelFor(bucket),
          verdict: digestVerdictFor(bucket, deepenedCount > 0),
          narrative: s.bluf || undefined,
          avgDiscount,
          deepenedCount,
        };
      })
      .filter((r): r is { name: string; stage: DigestStage; stageLabel: string; verdict: string; narrative?: string; avgDiscount: number | null; deepenedCount: number } => r !== null)
      .sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage]);
    const highTideCount = cards.filter(c => c.stage === "high" || c.stage === "rising").length;
    if (highTideCount === 0) { log.push({ type: "digest", to, skipped: "no centre at Rising or above" }); continue; }
    const { subject, html, text } = renderDigestEmail({ dateLabel, highTideCount, centres: cards });
    if (dryRun) { log.push({ type: "digest", to, ok: true, skipped: "dryRun", brands: cards.map(c => `${c.name}: avg ${c.avgDiscount ?? '—'}, deepened ${c.deepenedCount}`) }); continue; }
    const result = await sendEmail(to, subject, html, text, RESEND_KEY!);
    log.push({ type: "digest", to, ok: result.ok, status: result.status });
    if (result.ok) digestsSent++;
  }

  return new Response(JSON.stringify({
    ok: true,
    today,
    dryRun,
    mode: digestOnly ? "digestOnly" : "daily",
    alertsSent,
    brandAlertsSent,
    digestsSent,
    highTideCentres: highTideCentres.length,
    brandsStartedToday: alertBrands.filter(x => x.kind === 'started').length,
    brandsDeepenedToday: alertBrands.filter(x => x.kind === 'deepened').length,
    eligibleUsers: allPrefs.length,
    log,
  }, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
