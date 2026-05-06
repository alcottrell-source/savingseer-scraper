// score.js
// Tide — daily centre + personal score calculator
// Runs via GitHub Actions daily at 08:00 UTC, after the scraper.
//
// May 2026 robustness audit (this file):
//   - Every top-level function is wrapped in try/catch with explicit logging.
//     Crashes inside a centre's calculation are isolated so the rest of the
//     batch still gets scored.
//   - Pre-flight: refuse to run if brand_sale_events has no rows updated
//     today. Without this, an absent scraper run would silently produce a
//     batch of zeroed Tide scores ("nothing on sale anywhere") and overwrite
//     yesterday's correct values.
//   - Personal scores cannot block centre scores — they run after, and any
//     error is logged but never propagates. Centre scores are the source of
//     truth and must always be written if the scraper data is present.
//   - Validation gate: every centre score is checked before write. tide_score
//     must be 0–100 and stage must be one of the six known stages
//     (Turning / Rising / High Tide / Falling / Low / unknown). Any row
//     failing validation is dropped with a console error.
//   - audit_log row is written at the end summarising the run; failures here
//     are non-fatal.

import { createClient } from '@supabase/supabase-js';
import { brands } from './brands.js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const TODAY          = new Date().toISOString().split('T')[0];
const THREE_DAYS_AGO = new Date(Date.now() - 3  * 86400000).toISOString().split('T')[0];
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
const RUN_STARTED_AT = new Date();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const brandNameLookup = Object.fromEntries(brands.map(b => [b.id, b.name]));

// ── Tunable parameters (spec v2.0 §8) ────────────────────────────────────────
const DECAY_MAX            = 42;   // Review after 30 days of real scrape data
const ANCHOR_MULTIPLIER    = 1.5;  // Review quarterly against footfall data
const TRAJECTORY_FLAT_BAND = 1.5;  // ±1.5 defines the Flat (Peak) window

const ANCHOR_BRAND_IDS = new Set(['B001', 'B002', 'B003', 'B011', 'B012']);

const PHASE_NUMBER = { Turning: 1, Rising: 2, 'High Tide': 2, Falling: 2, Low: 1 };

// Validation enums for the pre-write gate.
const VALID_STAGES = new Set(['Turning', 'Rising', 'High Tide', 'Falling', 'Low']);

function brandFreshnessScore(daysRunning) {
  if (daysRunning <= 0)         return 0;
  if (daysRunning <= 7)         return 1.0;
  if (daysRunning <= 21)        return 1.0 - ((daysRunning - 7)  * (0.5 / 14));
  if (daysRunning <= DECAY_MAX) return 0.5 - ((daysRunning - 21) * (0.4 / (DECAY_MAX - 21)));
  return 0;
}

const HIGH_TIDE_ENTER = 75;
const HIGH_TIDE_EXIT  = 65;

const STAGE_FROM_VERDICT = {
  'Go now':                       'High Tide',
  'Last chance':                  'Falling',
  'Last chance — tide going out': 'Falling',
  'Worth watching':               'Rising',
  'Starting to build':            'Turning',
  "It's over":                    'Low',
  'Nothing on':                   'Turning',
};
function deriveStageFromVerdict(verdict) {
  return verdict ? (STAGE_FROM_VERDICT[verdict] || null) : null;
}

function getTideStage(score, yesterdayStage) {
  const wasHighTide = yesterdayStage === 'High Tide';
  const wasDescent  = yesterdayStage === 'Falling' || yesterdayStage === 'Low';

  if (score === 0) {
    if (wasHighTide || wasDescent) {
      return { stage: 'Low', verdict: "It's over", bluf: 'Cycle ended. Check back when brands start their next sale.' };
    }
    return { stage: 'Turning', verdict: 'Nothing on', bluf: 'No meaningful sales at this centre right now. Check back soon.' };
  }

  if (score >= HIGH_TIDE_ENTER || (wasHighTide && score >= HIGH_TIDE_EXIT)) {
    return { stage: 'High Tide', verdict: 'Go now', bluf: 'Maximum density, maximum freshness. This is the moment.' };
  }

  if (wasHighTide || wasDescent) {
    if (score < 25) return { stage: 'Low',     verdict: "It's over",              bluf: 'Cycle ended. Check back when brands start their next sale.' };
    return           { stage: 'Falling', verdict: 'Last chance — tide going out', bluf: 'Tide going out. Go now or miss out.' };
  }

  if (score >= 25) return { stage: 'Rising',  verdict: 'Worth watching',   bluf: 'Sales building and fresh. Plan your visit soon.' };
  return            { stage: 'Turning', verdict: 'Starting to build', bluf: 'A few brands are breaking into sale. Worth watching.' };
}

function getTrajectory(todayScore, recentScores) {
  if (recentScores.length < 3) return 'RISING';
  const avg = (recentScores[0] + recentScores[1] + recentScores[2]) / 3;
  const diff = todayScore - avg;
  if (diff >  TRAJECTORY_FLAT_BAND) return 'RISING';
  if (diff < -TRAJECTORY_FLAT_BAND) return 'FALLING';
  return 'FLAT';
}

// ── Pre-flight check ─────────────────────────────────────────────────────────
// Refuse to score if there is no evidence the scraper ran today. Without this
// guard, a missed 06:00 scraper run would lead to score.js computing scores
// from yesterday's brand_sale_events state and writing them as today's row,
// which then misleads the dashboard. Better to abort and leave yesterday's
// scores standing — operators will see the missing audit_log row and act.
async function preflight() {
  const { data, error, count } = await supabase
    .from('brand_sale_events')
    .select('brand_id, last_checked', { count: 'exact', head: false })
    .gte('last_checked', `${TODAY}T00:00:00.000Z`);

  if (error) {
    throw new Error(`pre-flight: brand_sale_events query failed: ${error.message}`);
  }

  if (!data || data.length === 0 || count === 0) {
    const msg = `Pre-flight failed: brand_sale_events has zero rows updated today (${TODAY}). The scraper appears not to have run. Aborting before writing any scores.`;
    console.error(`❌ ${msg}`);
    throw new Error(msg);
  }

  console.log(`  ✓ Pre-flight: ${data.length} brand_sale_events rows updated today`);
}

// ── Validation gate ──────────────────────────────────────────────────────────
function validateScoreRow(row) {
  const errors = [];
  if (typeof row.tide_score !== 'number' || Number.isNaN(row.tide_score)) {
    errors.push(`tide_score not numeric (${row.tide_score})`);
  } else if (row.tide_score < 0 || row.tide_score > 100) {
    errors.push(`tide_score out of range (${row.tide_score})`);
  }
  if (!VALID_STAGES.has(row._stage)) {
    errors.push(`stage invalid (${row._stage})`);
  }
  if (row.score_date !== TODAY) {
    errors.push(`score_date not today (${row.score_date})`);
  }
  return errors;
}

// ── Centre scoring ───────────────────────────────────────────────────────────
async function calculateCentreScores() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scorer — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  const [centresRes, centreBrandsRes, brandSaleRes, recentScoresRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, max_discount_pct, scraper_error, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)'),
    supabase.from('centre_seer_scores')
      .select('centre_id, score_date, tide_score, verdict')
      .gte('score_date', THREE_DAYS_AGO)
      .lt('score_date', TODAY)
      .order('score_date', { ascending: false }),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    throw new Error(
      `centre scores data load failed: ${(centresRes.error || centreBrandsRes.error || brandSaleRes.error).message}`
    );
  }

  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));

  const recentScoreMap = new Map();
  const yesterdayStageMap = new Map();
  for (const row of (recentScoresRes.data || [])) {
    if (!recentScoreMap.has(row.centre_id)) recentScoreMap.set(row.centre_id, []);
    recentScoreMap.get(row.centre_id).push(row.tide_score);
    if (!yesterdayStageMap.has(row.centre_id)) {
      const stage = deriveStageFromVerdict(row.verdict);
      if (stage) yesterdayStageMap.set(row.centre_id, stage);
    }
  }

  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrandsRes.data) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const scoreRows = [];
  let centresFailed = 0;

  for (const centre of centresRes.data) {
    // Per-centre try/catch — one centre's bad data should not abort the batch.
    try {
      const brandIds = centreBrandMap.get(centre.id) || [];
      const totalBrands = brandIds.length;

      if (totalBrands === 0) {
        console.log(`  ⚠ ${centre.name}: no brands configured, skipping`);
        continue;
      }

      let totalFreshness = 0;
      let brandsOnSale = 0;
      const saleDetails = [];

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

        const freshness = brandFreshnessScore(daysRunning);
        if (freshness === 0) continue;

        const weight = ANCHOR_BRAND_IDS.has(brandId) ? ANCHOR_MULTIPLIER : 1.0;
        totalFreshness += freshness * weight;
        brandsOnSale++;
        const maxDiscountPct = (sale.cycle && sale.cycle.max_discount_pct) || sale.max_discount_pct;
        saleDetails.push({ name: brandNameLookup[brandId] || brandId, freshness, weight, maxDiscountPct });
      }

      const tideScore = Math.round((totalFreshness / totalBrands) * 100 * 10) / 10;
      const recent = recentScoreMap.get(centre.id) ?? [];
      const trajectory = getTrajectory(tideScore, recent);
      const yesterdayStage = yesterdayStageMap.get(centre.id) ?? null;
      const { stage, verdict, bluf } = getTideStage(tideScore, yesterdayStage);

      const topBrands = saleDetails
        .sort((a, b) => (b.freshness * b.weight) - (a.freshness * a.weight))
        .slice(0, 5)
        .map(b => b.name)
        .join(', ') || null;

      const discountBrands = saleDetails.filter(b => b.maxDiscountPct);
      const avgDiscountPct = discountBrands.length > 0
        ? Math.round(discountBrands.reduce((s, b) => s + b.maxDiscountPct, 0) / discountBrands.length)
        : null;

      const row = {
        centre_id: centre.id,
        score_date: TODAY,
        tide_score: tideScore,
        phase: PHASE_NUMBER[stage],
        verdict,
        bluf,
        trajectory,
        brands_on_sale: brandsOnSale,
        total_brands: totalBrands,
        top_brands: topBrands,
        avg_discount_pct: avgDiscountPct,
        // Carrier for validation only — stripped before insert.
        _stage: stage,
      };

      const errs = validateScoreRow(row);
      if (errs.length > 0) {
        console.error(`  ✗ ${centre.name}: validation reject — ${errs.join('; ')}. Skipping write.`);
        centresFailed++;
        continue;
      }

      delete row._stage;
      scoreRows.push(row);

      const icons = { Turning: '🔵', Rising: '📈', 'High Tide': '⭐', Falling: '⚠️', Low: '⬛' };
      console.log(`  ${icons[stage] ?? '?'} ${centre.name}: ${stage} (${tideScore}) | ${brandsOnSale}/${totalBrands} brands | ${trajectory}`);
    } catch (err) {
      console.error(`  ✗ ${centre.name}: scoring crashed — ${err.message}`);
      centresFailed++;
    }
  }

  console.log('\nWriting scores...');

  const { error } = await supabase
    .from('centre_seer_scores')
    .upsert(scoreRows, { onConflict: 'centre_id,score_date' });

  if (error) {
    throw new Error(`Centre score upsert failed: ${error.message}`);
  }

  console.log(`  ✓ ${scoreRows.length} centre scores written`);

  // Cache up to 60 days of score history per centre for sparkline display.
  // History rebuild failures are non-fatal — the scores themselves are the
  // source of truth, the history column is just a denormalised cache.
  try {
    await rebuildTideHistory(centresRes.data);
  } catch (err) {
    console.error(`  ⚠ tide_history rebuild failed (non-fatal): ${err.message}`);
  }

  console.log('\n✅ Centre scoring complete');
  return { centresScored: scoreRows.length, centresFailed };
}

async function rebuildTideHistory(centres) {
  const { data: historyData, error: historyError } = await supabase
    .from('centre_seer_scores')
    .select('centre_id, score_date, tide_score')
    .gte('score_date', SIXTY_DAYS_AGO)
    .not('tide_score', 'is', null)
    .order('score_date', { ascending: true });

  if (historyError) throw new Error(historyError.message);

  const historyByCentre = new Map();
  for (const row of historyData) {
    if (!historyByCentre.has(row.centre_id)) historyByCentre.set(row.centre_id, []);
    historyByCentre.get(row.centre_id).push({ date: row.score_date, score: row.tide_score });
  }

  const noHistory = centres.filter(c => !historyByCentre.has(c.id));
  if (noHistory.length > 0) {
    console.log(`  ⚠ No history yet for: ${noHistory.map(c => c.name).join(', ')}`);
  }

  const results = await Promise.all(
    [...historyByCentre.entries()].map(([centreId, history]) =>
      supabase.from('centres').update({ tide_history: history }).eq('id', centreId)
    )
  );

  const failures = results.filter(r => r.error);
  if (failures.length > 0) {
    throw new Error(`tide_history failed for ${failures.length} centres: ${failures.map(f => f.error.message).join('; ')}`);
  }
  console.log(`  ✓ tide_history updated for ${historyByCentre.size} centres`);
}

// ── Personal scoring ─────────────────────────────────────────────────────────

function brandMatchesPrefs(brand, prefs) {
  const genderMatch =
    (prefs.womenswear    && brand.womenswear)    ||
    (prefs.menswear      && brand.menswear)      ||
    (prefs.childrenswear && brand.childrenswear);
  if (!genderMatch) return false;
  if (prefs.style_clusters && prefs.style_clusters.length > 0) {
    if (!prefs.style_clusters.includes(brand.cluster)) return false;
  }
  return true;
}

async function calculatePersonalScores() {
  console.log('\nCalculating personal scores...');

  const [centresRes, centreBrandsRes, brandSaleRes, prefsRes] = await Promise.all([
    supabase.from('centres').select('id, name').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, scraper_error'),
    supabase.from('user_preferences').select('*'),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    throw new Error(
      `Personal scores data load failed: ${(centresRes.error || centreBrandsRes.error || brandSaleRes.error).message}`
    );
  }

  if (prefsRes.error) {
    console.warn('  Could not load user preferences:', prefsRes.error.message);
    return { calculated: 0, failed: 0 };
  }

  if (!prefsRes.data || prefsRes.data.length === 0) {
    console.log('  No user preferences found, skipping personal scores');
    return { calculated: 0, failed: 0 };
  }

  const brandById    = new Map(brands.map(b => [b.id, b]));
  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));

  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrandsRes.data) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const scoreRows = [];
  let userFailures = 0;

  for (const pref of prefsRes.data) {
    // Per-user try/catch so one bad preference row doesn't abort all users'
    // personal scoring.
    try {
      for (const centre of centresRes.data) {
        const brandIds = centreBrandMap.get(centre.id) || [];

        const matchingBrandIds = brandIds.filter(brandId => {
          const brand = brandById.get(brandId);
          return brand && brandMatchesPrefs(brand, pref);
        });

        if (matchingBrandIds.length === 0) continue;

        let totalFreshness = 0;
        let matchingOnSale = 0;

        for (const brandId of matchingBrandIds) {
          const sale = brandSaleMap.get(brandId);
          if (!sale || sale.scraper_error || !sale.sale_status) continue;

          const daysRunning = sale.date_first_detected
            ? Math.floor((new Date(TODAY) - new Date(sale.date_first_detected)) / 86400000) + 1
            : 1;

          totalFreshness += brandFreshnessScore(daysRunning);
          matchingOnSale++;
        }

        const personalScore = Math.round((totalFreshness / matchingBrandIds.length) * 10) / 10;
        const { verdict } = getTideStage(personalScore, null);

        scoreRows.push({
          user_id:             pref.user_id,
          centre_id:           centre.id,
          score_date:          TODAY,
          personal_tide_score: personalScore,
          matching_brands:     matchingBrandIds.length,
          matching_on_sale:    matchingOnSale,
          verdict,
        });
      }
    } catch (err) {
      console.error(`  ✗ user ${pref.user_id}: personal scoring crashed — ${err.message}`);
      userFailures++;
    }
  }

  if (scoreRows.length === 0) {
    console.log('  No personal scores to write');
    return { calculated: 0, failed: userFailures };
  }

  const { error } = await supabase
    .from('personal_tide_scores')
    .upsert(scoreRows, { onConflict: 'user_id,centre_id,score_date' });

  if (error) throw new Error(`Personal score write failed: ${error.message}`);

  console.log(`  ✓ ${scoreRows.length} personal scores written for ${prefsRes.data.length} user(s)`);
  return { calculated: scoreRows.length, failed: userFailures };
}

// ── Audit log writer ─────────────────────────────────────────────────────────
async function writeAuditLog({ status, centresScored, centresFailed, personalCalculated, personalFailed, errorSummary }) {
  const durationMs = Date.now() - RUN_STARTED_AT.getTime();
  const row = {
    run_type: 'scorer',
    run_date: TODAY,
    run_started_at: RUN_STARTED_AT.toISOString(),
    run_completed_at: new Date().toISOString(),
    run_duration_ms: durationMs,
    status,
    centres_scored: centresScored,
    centres_failed: centresFailed,
    personal_scores_calculated: personalCalculated,
    personal_scores_failed: personalFailed,
    error_summary: errorSummary?.slice(0, 4000) || null,
    details: {},
  };

  const { error } = await supabase.from('audit_log').insert(row);
  if (error) {
    console.error('⚠ audit_log insert failed (non-fatal):', error.message);
  } else {
    console.log(`  ✓ audit_log row written (run_duration_ms=${durationMs})`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let runStatus = 'success';
  let centresScored = 0, centresFailed = 0;
  let personalCalculated = 0, personalFailed = 0;
  const errors = [];

  // Pre-flight is fatal: no scraper data → no scores.
  try {
    await preflight();
  } catch (err) {
    await writeAuditLog({
      status: 'failed',
      centresScored: 0, centresFailed: 0,
      personalCalculated: 0, personalFailed: 0,
      errorSummary: `pre-flight: ${err.message}`,
    });
    process.exit(1);
  }

  try {
    const out = await calculateCentreScores();
    centresScored = out.centresScored;
    centresFailed = out.centresFailed;
    if (centresFailed > 0) runStatus = 'partial';
  } catch (err) {
    runStatus = 'failed';
    errors.push(`centre scores: ${err.message}`);
    console.error('❌ Centre scoring failed:', err.message);
    // Still try personal scores below — it's possible centres failed for one
    // reason and personals can succeed; the audit_log row will reflect both.
  }

  // Personal scores can NEVER block centre scores. They run after, and any
  // failure is logged-but-non-fatal.
  try {
    const out = await calculatePersonalScores();
    personalCalculated = out.calculated;
    personalFailed = out.failed;
    if (personalFailed > 0 && runStatus !== 'failed') runStatus = 'partial';
  } catch (err) {
    if (runStatus !== 'failed') runStatus = 'partial';
    errors.push(`personal: ${err.message}`);
    console.error('⚠ Personal scores failed (centre scores unaffected):', err.message);
  }

  await writeAuditLog({
    status: runStatus,
    centresScored,
    centresFailed,
    personalCalculated,
    personalFailed,
    errorSummary: errors.length ? errors.join(' | ') : null,
  });

  if (runStatus === 'failed') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Scorer crashed:', err);
  process.exit(1);
});
