// summarise.js
// Tide — daily Centre Intelligence narrative writer.
//
// Runs after score.js on the daily GitHub Action. For each centre with a
// score row for today, asks Gemini 2.5 Flash for a 1-2 sentence factual
// narrative summarising the current sale state (which brands just opened,
// which are picked-over, whether the tide is rising/falling), and writes
// it back to centre_seer_scores.narrative for today's row.
//
// The front-end reads that column and falls back to a template narrative
// if it is null — so the dashboard degrades gracefully if this script is
// skipped, fails, or the API key is absent.
//
// Cost: free. Gemini's free tier covers 1500 requests/day; we use 30.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { brands } from './brands.js';

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const TODAY           = new Date().toISOString().split('T')[0];
const FOURTEEN_DAYS_AGO = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  // Soft-fail: scoring already wrote the row; the front-end falls back to
  // its template narrative. Don't break the daily workflow over a missing
  // API key.
  console.warn('GEMINI_API_KEY not set — skipping narrative generation');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genai    = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL          = 'gemini-2.0-flash-lite';
const MAX_OUTPUT_LEN = 220; // chars, hard cap on what we'll store
// Gemini free tier on gemini-2.0-flash-lite: 15 requests/minute, 1500 per
// day. A 5-second gap gives 12 RPM with comfortable headroom — pushes a
// 37-centre run to roughly 3 minutes, well within a daily workflow's
// budget and far inside the 1500 RPD cap.
//
// Don't switch to gemini-2.5-flash-lite — its free-tier daily cap is only
// 20 RPD, which is below our 30+ centre count and the script will dead-end
// halfway through the run.
const MIN_GAP_MS     = 5000;

const SYSTEM_PROMPT = `You write Centre Intelligence narratives for the Tide dashboard — a UK shopping-sales tracker. One narrative per centre per day, shown in a small card under the score.

The Tide Score (0-100) measures density × freshness of brand sales at the centre. The 5 stages, in cycle order:
- Turning: tide on the turn — a few brands breaking into sale
- Rising: sales building, stocks still fresh
- High Tide (PEAK): maximum density and freshness
- Falling (EASING): tide going out, picked-over
- Low (OVER): cycle ended

Stocks are fullest in the first week of a sale; from week 3 onwards a brand is picked-over even if still discounting.

What to write about: the brands that have most recently arrived on sale. Name 1-3 of them. If the tide is falling, you can mention which brands are looking picked-over. Keep it concrete.

Voice rules:
- NO NUMBERS of any kind. Don't write digits, don't spell out counts ("ten brands"), don't say "day 4" or "4 days ago" or "20% off". Use words like "newly", "just arrived", "fresh", "recently", "still picked-over".
- NO RECOMMENDATION LANGUAGE. Never write "worth a visit", "worth it", "still worth going", "go now", "skip", "don't bother", "wait a few days", or anything that tells the reader what to do. The headline + PEAK badge handle the recommendation; the narrative only describes what's happening.
- Factual and concrete — name specific brands.
- No hype words ("amazing", "incredible", "huge"), no marketing tone, no exclamation marks.
- NO EM DASHES OR EN DASHES. Don't use "—" or "–" to join clauses. Use a full stop, a comma, or "and" instead. A regular hyphen inside a word (e.g. "picked-over") is fine.
- No predictions about tomorrow or future days.
- No second-guessing the score — describe what the data shows, don't editorialise.
- British English.

Tone by stage:
- Turning / Rising: name fresh arrivals neutrally — "Mango, COS and Reiss have all opened sales this week."
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
  const resp = await genai.models.generateContent({
    model: MODEL,
    contents: buildUserMessage(centre),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 200,
      temperature: 0.4,
    },
  });

  const text = (resp.text || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    // Defensive: prompt forbids em/en dashes but Gemini occasionally
    // ignores it. Replace any " — " or " – " with ". " so the narrative
    // doesn't read as AI-generated.
    .replace(/\s*[—–]\s*/g, '. ')
    .replace(/\.\s*\./g, '.');

  if (!text) return null;
  // Hard cap — model usually obeys but we don't trust it unconditionally
  // with user-visible copy.
  return text.length > MAX_OUTPUT_LEN ? text.slice(0, MAX_OUTPUT_LEN - 1).trimEnd() + '…' : text;
}

// A 429 with a "PerDay" quotaId means the daily free-tier cap is used up.
// Retrying within the same workflow run is pointless — the counter only
// resets at midnight Pacific. Distinguish from a per-minute 429.
function isDailyQuotaExhausted(msg) {
  return /"code":\s*429/.test(msg) && /PerDay/.test(msg);
}

// Wrap generateNarrative with a single retry that respects the API's
// suggested retryDelay for per-minute 429s and a fixed wait for 503s.
// Daily-quota 429s rethrow immediately so the caller can stop the run.
async function generateNarrativeResilient(centre) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await generateNarrative(centre);
    } catch (err) {
      const msg = String(err && err.message || err);
      if (isDailyQuotaExhausted(msg)) throw err;

      const is429 = /RESOURCE_EXHAUSTED|"code":\s*429|\b429\b/.test(msg);
      const is503 = /UNAVAILABLE|"code":\s*503|\b503\b/.test(msg);
      if (attempt === 0 && (is429 || is503)) {
        // Prefer the API's retryDelay when present; otherwise default to
        // a generous wait. +1s jitter to avoid landing exactly on the
        // window boundary.
        const m = msg.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
        const waitMs = m
          ? Math.ceil(parseFloat(m[1]) * 1000) + 1000
          : (is429 ? 30000 : 12000);
        console.log(`  ⏳ ${centre.name}: ${is429 ? '429' : '503'}, retrying in ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  // Unreachable but keeps the typechecker happy.
  return null;
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
  let dailyQuotaHit = false;

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
      if (isDailyQuotaExhausted(msg)) {
        console.warn(`  ⚠ ${centre.name}: daily Gemini free-tier quota exhausted — stopping. Remaining centres will keep their template narrative until tomorrow's run.`);
        // Log the underlying API error so we can see the actual quota
        // numbers (model, RPD limit, retry window) without parsing.
        console.warn(`     underlying API response: ${msg}`);
        dailyQuotaHit = true;
        break;
      }
      console.error(`  ✗ ${centre.name}: ${msg}`);
      failed++;
    }

    await sleep(MIN_GAP_MS);
  }

  console.log(`\nNarratives: ${written} written, ${skipped} skipped, ${failed} failed${dailyQuotaHit ? ' (daily quota hit — non-fatal)' : ''}`);

  // Exit 1 only on real failures — i.e. nothing was written AND something
  // failed for a reason other than the daily quota being exhausted. A
  // daily-quota hit just means we'll catch up on the next scheduled run;
  // it shouldn't paint the workflow red.
  if (failed > 0 && written === 0 && !dailyQuotaHit) process.exit(1);
}

main().catch(err => {
  console.error('Summariser failed:', err);
  process.exit(1);
});
