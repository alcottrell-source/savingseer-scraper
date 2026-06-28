// Tide — waitlist signup notifier. Fires once per new row in the `waitlist`
// table (the international-expansion capture) and emails the operator so a
// signup is never missed. Driven by a Supabase Database Webhook on
// waitlist INSERT (see supabase/functions/notify-waitlist/README.md for the
// one-time dashboard setup); not part of the scheduled notify-high-tide cron.
//
// Request body is the standard Supabase Database Webhook payload:
//   { "type": "INSERT", "table": "waitlist", "schema": "public",
//     "record": { "email": "...", "country": "US", "source_url": "...",
//                 "created_at": "..." }, "old_record": null }
// A manual test can POST the same shape with "dryRun": true to preview the
// email without sending.
//
// Env vars (Supabase secrets — RESEND_API_KEY / SUPABASE_* are shared with
// notify-high-tide; only the waitlist-specific ones are new):
//   SUPABASE_URL                 (auto-provided by the runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-provided by the runtime)
//   RESEND_API_KEY               (set via `supabase secrets set`)
//   WAITLIST_WEBHOOK_SECRET      (shared secret the webhook sends as the
//                                 x-webhook-secret header — app-level auth)
//   WAITLIST_NOTIFY_TO           (recipient; defaults to the operator address)
//
// Manual invoke:
//   curl -X POST 'https://<project>.functions.supabase.co/notify-waitlist' \
//        -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
//        -d '{"dryRun":true,"record":{"email":"test@example.com","country":"US"}}'

// @ts-ignore — Deno std import (resolved at runtime, not by tsc)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Defaults can be overridden by Supabase secrets. FROM_EMAIL mirrors
// notify-high-tide so all Tide mail comes from one verified sender.
const FROM_EMAIL  = Deno.env.get("TIDE_FROM_EMAIL")     ?? "Tide <hello@tidego.co>";
const NOTIFY_TO   = Deno.env.get("WAITLIST_NOTIFY_TO")  ?? "alcottrell@gmail.com";
const APP_URL     = Deno.env.get("TIDE_APP_URL")        ?? "https://v0-tide-sale-timing.vercel.app";
const RESEND_URL  = "https://api.resend.com/emails";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Resend wrapper — identical contract to notify-high-tide's sendEmail.
async function sendEmail(to: string, subject: string, html: string, text: string, apiKey: string) {
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
  const WEBHOOK_SECRET = Deno.env.get("WAITLIST_WEBHOOK_SECRET");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
  }

  // Application-level auth. The platform JWT gate is satisfied by the
  // webhook's anon-key Authorization header, so on its own anyone could POST.
  // Require either the service-role key as the Bearer token (manual invoke /
  // GitHub Actions style) or the shared x-webhook-secret the Database Webhook
  // is configured to send. Mirrors notify-high-tide's gate.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const authorized =
    (bearer && bearer === SERVICE_KEY) ||
    (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") === WEBHOOK_SECRET);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = !!(body as Record<string, unknown>).dryRun;
  const record = ((body as Record<string, unknown>).record ?? {}) as Record<string, unknown>;
  const email = String(record.email ?? "").trim();
  if (!email) {
    return new Response("No record.email in payload", { status: 400 });
  }
  if (!dryRun && !RESEND_KEY) {
    return new Response("Missing RESEND_API_KEY (use dryRun:true to test without sending)", { status: 500 });
  }

  const country = String(record.country ?? "").toUpperCase() || "Unknown";
  const sourceUrl = String(record.source_url ?? "");

  // A running total is a nice "that's #N" touch and confirms the row landed.
  // Best-effort: a failed count must not block the notification.
  let total: number | null = null;
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { count } = await sb.from("waitlist").select("*", { count: "exact", head: true });
    if (typeof count === "number") total = count;
  } catch { /* count is decorative — ignore */ }

  const totalLine = total ? `That brings the expansion waitlist to ${total}.` : "";
  const subject = `New Tide waitlist signup — ${country}`;
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2b2b;line-height:1.5">` +
    `<h2 style="margin:0 0 12px">New expansion waitlist signup</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><td style="padding:2px 12px 2px 0;color:#888">Email</td><td><strong>${esc(email)}</strong></td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#888">Country</td><td>${esc(country)}</td></tr>` +
    (sourceUrl ? `<tr><td style="padding:2px 12px 2px 0;color:#888">From</td><td>${esc(sourceUrl)}</td></tr>` : "") +
    `</table>` +
    (totalLine ? `<p style="margin:14px 0 0;color:#555">${esc(totalLine)}</p>` : "") +
    `<p style="margin:14px 0 0;font-size:13px"><a href="${esc(APP_URL)}/admin.html">Open the admin console →</a></p>` +
    `</div>`;
  const text =
    `New expansion waitlist signup\n\n` +
    `Email:   ${email}\n` +
    `Country: ${country}\n` +
    (sourceUrl ? `From:    ${sourceUrl}\n` : "") +
    (totalLine ? `\n${totalLine}\n` : "") +
    `\nAdmin: ${APP_URL}/admin.html\n`;

  if (dryRun) {
    return new Response(JSON.stringify({ dryRun: true, to: NOTIFY_TO, subject, total }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await sendEmail(NOTIFY_TO, subject, html, text, RESEND_KEY!);
  return new Response(JSON.stringify({ sent: result.ok, status: result.status, total }, null, 2), {
    status: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
});
