// summarise.js
// Tide — daily Centre Intelligence narrative writer.
//
// Runs after score.js on the daily GitHub Action. For each centre with a
// score row for today, asks Claude Haiku 4.5 for a 1-2 sentence factual
// narrative summarising the current sale state (which brands just opened,
// which are picked-over, whether the tide is rising/falling), and writes
// it back to centre_seer_scores.narrative for today's row.
//
// The front-end reads that column and falls back to a template narrative
// if it is null — so the dashboard degrades gracefully if this script is
// skipped, fails, or the API key is absent.
//
// Backend note (Jul 2026): migrated off Gemini 2.0 Flash-Lite. Google
// withdrew that model's free tier (429 "limit: 0"), which silently zeroed
// out every narrative for days. Claude Haiku 4.5 is pay-as-you-go — a few
// pence a day for ~24 short narratives — with no daily-cap cliff to fall
// off. Cost is trivial for this workload; reliability is the point.

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { brands } from './brands.js';

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TODAY           = new Date().toISOString().split('T')[0];
const FOURTEEN_DAYS_AGO = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  // Soft-fail: scoring already wrote the row; the front-end falls back to
  // its template narrative. Don't break the daily workflow over a missing
  // API key.
  console.warn('ANTHROPIC_API_KEY not set — skipping narrative generation');
  process.exit(0);
}

const supabase  = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the env

const MODEL          = 'claude-haiku-4-5';
const MAX_OUTPUT_LEN = 220; // chars, hard cap on what we'll store
// Pace requests to stay comfortably inside Anthropic's per-minute rate
// limits at any tier. A 5-second gap gives 12 RPM — a ~24-centre run takes
// roughly two minutes. The SDK also auto-retries 429/5xx with exponential
// backoff, so a brief limit blip self-heals without dropping a centre.
const MIN_GAP_MS     = 5000;

const SYSTEM_PROMPT = `You write Centre Intelligence narratives for the Tide dashboard — a UK shopping-sales tracker. One narrative per centre per day, shown in a small card under the score.

The Tide Score (0-100) is the percentage of tracked brands currently on sale at the centre. The 5 stages, in cycle order:
- Quiet: minimal sale activity — nothing major running, a handful of brands at most
- Rising: sales building, stocks still fresh
- High Tide (PEAK): maximum sale density
- Falling (EASING): tide going out, picked-over
- Low (OVER): cycle ended

Stocks are fullest in the first week of a sale; from week 3 onwards a brand is picked-over even if still discounting.

What to write about: the brands that have most recently arrived on sale. Name 1-3 of them. If the tide is falling, you can mention which brands are looking picked-over. Keep it concrete.

Voice rules:
- NO NUMBERS of any kind. Don't write digits, don't spell out counts ("ten brands"), don't say "day 4" or "4 days ago" or "20% off". Use words like "newly", "just arrived", "fresh", "recently", "still picked-over".
- NO RECOMMENDATION LANGUAGE. Never write "worth a visit", "worth it", "still worth going", "go now", "skip", "don't bother", "wait a few days", or anything that tells the reader what to do. The headline + PEAK badge handle the recommendation; the narrative only describes what's happening.
- Factual and concrete — name specific brands.
- No hype words ("amazing", "incredible", "huge"), no marketing tone, no exclamation marks.
- No predictions about tomorrow or future days.
- No second-guessing the score — describe what the data shows, don't editorialise.
- British English.

Tone by stage:
- Quiet: factual and brief — note the absence or the one or two brands that are running, no urgency.
- Rising: name fresh arrivals neutrally — "Mango, COS and Reiss have all opened sales this week."
- High Tide (PEAK): describe the density — "Sales are open across the centre, with Zara, H&M and River Island all newly in."
- Falling (EASING): lead with picked-over signals — "Next and M&S have been on sale for several weeks now; fresher arrivals have thinned."
- Low (OVER): factual, quiet — "The cycle has wound down; only a couple of long-running sales remain."

Output: exactly 1 or 2 sentences, ≤200 characters total. Output ONLY the narrative — no preamble, no quotes, no bullets, no line breaks.`;

function buildUserMessage(centre) {
  const onSaleLine = centre.onSale.length === 0
    ? 'Brands on sale today: none.'
    : 'Brands on sale today (newest first): ' +
      centre.onSale
        .slice()
        .sort((a, b) => a.daysRunning - b.daysRunning)
        .map(b => `${b.name} day ${b.daysRunning}${b.discountPct ? ` (${b.discountPct}% off)` : ''}`)
        .join(', ') + '.';

  const historyLine = centre.history.length < 2
    ? 'Score history: not enough days yet.'
    : `Score history (last ${centre.history.length} days, oldest → today): ${centre.history.map(h => h.score).join(', ')}.`;

  return [
    `Centre: ${centre.name}`,
    `Today's tide score: ${centre.score} (stage: ${centre.stage}, verdict: "${centre.verdict}", trajectory: ${centre.trajectory}).`,
    onSaleLine,
    historyLine,
    '',
    'Write the narrative now.',
  ].join('\n');
}

async function generateNarrative(centre) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 0.4, // slight variation; Haiku 4.5 still accepts sampling params
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(centre) }],
  });

  // content is a list of blocks; concatenate the text blocks (Haiku returns one).
  const raw = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const text = raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ');

  if (!text) return null;
  // Hard cap — model usually obeys but we don't trust it unconditionally
  // with user-visible copy.
  return text.length > MAX_OUTPUT_LEN ? text.slice(0, MAX_OUTPUT_LEN - 1).trimEnd() + '…' : text;
}

// A 401/403 is a permanent failure — a missing, invalid, or unscoped
// ANTHROPIC_API_KEY hits every centre identically. Stop the run rather than
// hammering the API two dozen times and burning the whole workflow budget on
// certain-to-fail calls. Transient 429/5xx are NOT this — they clear on retry.
function isAuthFailure(err) {
  return !!err && (err.status === 401 || err.status === 403);
}

// The Anthropic SDK already retries 429 and 5xx with exponential backoff that
// honours the Retry-After header (default max_retries = 2), so a per-minute
// limit blip self-heals without dropping a centre. This thin wrapper keeps the
// call site stable and is the seam for any future per-call handling.
async function generateNarrativeResilient(centre) {
  return generateNarrative(centre);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Summariser — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  const brandNameLookup = Object.fromEntries(brands.map(b => [b.id, b.name]));

  const [centresRes, scoresRes, centreBrandsRes, brandSaleRes, historyRes] = await Promise.all([
    supabase.from('centres').select('id, name').eq('active', true),
    supabase.from('centre_seer_scores')
      .select('centre_id, tide_score, verdict, trajectory, narrative')
      .eq('score_date', TODAY),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)'),
    supabase.from('centre_seer_scores')
      .select('centre_id, score_date, tide_score')
      .gte('score_date', FOURTEEN_DAYS_AGO)
      .lte('score_date', TODAY)
      .order('score_date', { ascending: true }),
  ]);

  const firstError = [centresRes, scoresRes, centreBrandsRes, brandSaleRes, historyRes].find(r => r.error);
  if (firstError) {
    console.error('Data load failed:', firstError.error);
    process.exit(1);
  }

  // Verdict -> stage (mirrors the mapping in score.js). Includes both the
  // new trend-only vocabulary and the legacy strings so any pre-rename
  // carry-forward rows still resolve to the right stage.
  const STAGE_FROM_VERDICT = {
    // New vocabulary
    'Peak':    'High Tide',
    'Easing':  'Falling',
    'Rising':  'Rising',
    'Turning': 'Turning',
    'Quiet':   'Turning',
    'Over':    'Low',
    // Legacy
    'Go now':                       'High Tide',
    'Last chance':                  'Falling',
    'Last chance — tide going out': 'Falling',
    'Worth watching':               'Rising',
    'Starting to build':            'Turning',
    "It's over":                    'Low',
    'Nothing on':                   'Turning',
  };

  const scoreByCentre = new Map();
  for (const row of scoresRes.data || []) scoreByCentre.set(row.centre_id, row);

  const brandSaleMap = new Map((brandSaleRes.data || []).map(b => [b.brand_id, b]));

  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrandsRes.data || []) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const historyByCentre = new Map();
  for (const row of historyRes.data || []) {
    if (!historyByCentre.has(row.centre_id)) historyByCentre.set(row.centre_id, []);
    historyByCentre.get(row.centre_id).push({ date: row.score_date, score: row.tide_score });
  }

  let written = 0;
  let skipped = 0;
  let failed  = 0;
  let authFailed = false;

  for (const centre of centresRes.data || []) {
    const score = scoreByCentre.get(centre.id);
    if (!score) {
      console.log(`  · ${centre.name}: no score row for today, skipping`);
      skipped++;
      continue;
    }
    if (score.narrative && !/\d/.test(score.narrative)) {
      // Idempotency: if today's row already has a digit-free narrative,
      // leave it alone. Narratives that contain digits are either stale
      // (carry-forward from a day with different counts) or violate the
      // no-numbers rule, so regenerate them.
      console.log(`  · ${centre.name}: clean narrative already present, skipping`);
      skipped++;
      continue;
    }

    const brandIds = centreBrandMap.get(centre.id) || [];
    const onSale = [];
    for (const brandId of brandIds) {
      const sale = brandSaleMap.get(brandId);
      if (!sale) continue;
      // Mirror the admin-only rule used by score.js + the public dashboard.
      // Don't write a narrative that names a brand the dashboard isn't
      // showing — the scraper's reading is admin-panel-only.
      const isOnSale = sale.active_cycle_id
        ? true
        : sale.last_verified_date
          ? sale.last_verified_status
          : false;
      if (!isOnSale) continue;
      const cycleStart = (sale.cycle && sale.cycle.start_date) || sale.last_verified_date;
      const daysRunning = cycleStart
        ? Math.floor((new Date(TODAY) - new Date(cycleStart)) / 86400000) + 1
        : 1;
      const discountPct = (sale.cycle && sale.cycle.max_discount_pct) || null;
      onSale.push({
        name: brandNameLookup[brandId] || brandId,
        daysRunning,
        discountPct,
      });
    }

    const stage = STAGE_FROM_VERDICT[score.verdict] || 'Turning';
    const history = (historyByCentre.get(centre.id) || []).slice(-14);

    try {
      const narrative = await generateNarrativeResilient({
        name: centre.name,
        score: score.tide_score,
        verdict: score.verdict,
        trajectory: score.trajectory,
        stage,
        onSale,
        history,
      });

      if (!narrative) {
        console.log(`  · ${centre.name}: empty narrative, skipping`);
        skipped++;
        await sleep(MIN_GAP_MS);
        continue;
      }

      const { error: writeError } = await supabase
        .from('centre_seer_scores')
        .update({ narrative, narrative_generated_at: new Date().toISOString() })
        .eq('centre_id', centre.id)
        .eq('score_date', TODAY);

      if (writeError) {
        console.error(`  ✗ ${centre.name}: write failed:`, writeError.message);
        failed++;
        await sleep(MIN_GAP_MS);
        continue;
      }

      console.log(`  ✓ ${centre.name}: ${narrative}`);
      written++;
    } catch (err) {
      const msg = String(err && err.message || err);
      if (isAuthFailure(err)) {
        console.warn(`  ⚠ ${centre.name}: Anthropic auth failed (${err.status}) — stopping. Every centre would fail identically. Check the ANTHROPIC_API_KEY secret.`);
        console.warn(`     underlying API response: ${msg}`);
        authFailed = true;
        break;
      }
      console.error(`  ✗ ${centre.name}: ${msg}`);
      failed++;
    }

    await sleep(MIN_GAP_MS);
  }

  console.log(`\nNarratives: ${written} written, ${skipped} skipped, ${failed} failed${authFailed ? ' (auth failed — run stopped early)' : ''}`);

  // Surface a total wipe-out loudly. A run that writes ZERO narratives means
  // every centre is serving fallback template copy — an auth failure, a bad
  // model id, or the very first call dying. The `::warning::` annotation makes
  // it visible in the Actions run summary so a silent, self-perpetuating outage
  // can't hide behind a green tick again (as the withdrawn Gemini free tier did
  // for days before this migration).
  if (written === 0) {
    const why = authFailed
      ? "Anthropic auth failed — check the ANTHROPIC_API_KEY repo secret"
      : "the summariser wrote no narratives this run — check the API key, model id, and rate limits";
    console.log(`::warning::Centre Intelligence narratives: 0 written. ${why}. Every centre is serving fallback template copy until this is fixed.`);
  }

  // Exit 1 only on real failures — nothing written AND something failed for a
  // reason other than auth. An auth failure already shouts via ::warning:: and
  // is left non-fatal so the SEO-rebuild step still runs (narratives are
  // cosmetic; the scores and static pages matter more).
  if (failed > 0 && written === 0 && !authFailed) process.exit(1);
}

main().catch(err => {
  console.error('Summariser failed:', err);
  process.exit(1);
});
