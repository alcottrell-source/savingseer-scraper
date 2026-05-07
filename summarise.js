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

const MODEL          = 'gemini-2.5-flash-lite';
const MAX_OUTPUT_LEN = 220; // chars, hard cap on what we'll store
// Gemini free tier on flash-lite is 15 requests/minute. A 5-second gap
// gives 12 RPM with comfortable headroom — pushes a 37-centre run to
// roughly 3 minutes, well within a daily workflow's budget.
//
// Note: the previous attempt used gemini-2.5-flash, which is only 5 RPM
// on the free tier and 429'd from the 6th call onward. Don't switch
// back without also bumping MIN_GAP_MS to ~13000.
const MIN_GAP_MS     = 5000;

const SYSTEM_PROMPT = `You write Centre Intelligence narratives for the Tide dashboard — a UK shopping-sales tracker. One narrative per centre per day, shown in a small card under the score.

The Tide Score (0-100) measures density × freshness of brand sales at the centre. The 5 stages, in cycle order:
- Turning: a few brands breaking into sale
- Rising: sales building, stocks still fresh
- High Tide: peak — maximum density and freshness
- Falling: tide going out, picked-over
- Low: cycle ended

Brand "days running" matters: stocks are fullest in the first 5-7 days of a sale; from week 3 onwards a brand is picked-over even if still discounting.

Voice rules:
- Factual and concrete. Cite specific brand names and day counts when they help.
- No hype words ("amazing", "incredible", "huge"), no marketing tone, no exclamation marks.
- No predictions about tomorrow or future days.
- No second-guessing the score — describe what the data shows, don't editorialise.
- British English.

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
    .replace(/\s+/g, ' ');

  if (!text) return null;
  // Hard cap — model usually obeys but we don't trust it unconditionally
  // with user-visible copy.
  return text.length > MAX_OUTPUT_LEN ? text.slice(0, MAX_OUTPUT_LEN - 1).trimEnd() + '…' : text;
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
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, max_discount_pct, scraper_error, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)'),
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

  // Verdict -> stage (mirrors the mapping in score.js)
  const STAGE_FROM_VERDICT = {
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

  for (const centre of centresRes.data || []) {
    const score = scoreByCentre.get(centre.id);
    if (!score) {
      console.log(`  · ${centre.name}: no score row for today, skipping`);
      skipped++;
      continue;
    }
    if (score.narrative) {
      // Idempotency: if the row already has a narrative for today, leave it
      // alone. Re-runs cost nothing.
      console.log(`  · ${centre.name}: narrative already present, skipping`);
      skipped++;
      continue;
    }

    const brandIds = centreBrandMap.get(centre.id) || [];
    const onSale = [];
    for (const brandId of brandIds) {
      const sale = brandSaleMap.get(brandId);
      if (!sale) continue;
      const isOnSale = sale.active_cycle_id
        ? true
        : sale.last_verified_date
          ? sale.last_verified_status
          : (sale.sale_status && !sale.scraper_error);
      if (!isOnSale) continue;
      const cycleStart = (sale.cycle && sale.cycle.start_date) || sale.date_first_detected;
      const daysRunning = cycleStart
        ? Math.floor((new Date(TODAY) - new Date(cycleStart)) / 86400000) + 1
        : 1;
      const discountPct = (sale.cycle && sale.cycle.max_discount_pct) || sale.max_discount_pct || null;
      onSale.push({
        name: brandNameLookup[brandId] || brandId,
        daysRunning,
        discountPct,
      });
    }

    const stage = STAGE_FROM_VERDICT[score.verdict] || 'Turning';
    const history = (historyByCentre.get(centre.id) || []).slice(-14);

    try {
      const narrative = await generateNarrative({
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
      console.error(`  ✗ ${centre.name}: ${err.message}`);
      failed++;
    }

    await sleep(MIN_GAP_MS);
  }

  console.log(`\nNarratives: ${written} written, ${skipped} skipped, ${failed} failed`);
  if (failed > 0 && written === 0) process.exit(1);
}

main().catch(err => {
  console.error('Summariser failed:', err);
  process.exit(1);
});
