import { createClient } from '@supabase/supabase-js';
import { brands } from './brands.js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const TODAY          = new Date().toISOString().split('T')[0];
const THREE_DAYS_AGO = new Date(Date.now() - 3  * 86400000).toISOString().split('T')[0];
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];

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

// Anchor brands v1 (spec §3): Next, M&S, River Island, Zara, H&M.
// Uniqlo is in the spec but not yet in brands.js, so it's absent from the
// scrape pipeline and therefore from the anchor set. Add it here once it's
// added to brands.js.
const ANCHOR_BRAND_IDS = new Set(['B001', 'B002', 'B003', 'B011', 'B012']);

const PHASE_NUMBER = { Turning: 1, Rising: 2, 'High Tide': 2, Falling: 2, Low: 1 };

// ── Brand freshness score (spec §2) ──────────────────────────────────────────
function brandFreshnessScore(daysRunning) {
  if (daysRunning <= 0)         return 0;
  if (daysRunning <= 7)         return 1.0;
  if (daysRunning <= 21)        return 1.0 - ((daysRunning - 7)  * (0.5 / 14));
  if (daysRunning <= DECAY_MAX) return 0.5 - ((daysRunning - 21) * (0.4 / (DECAY_MAX - 21)));
  return 0; // Beyond DECAY_MAX — excluded from score entirely
}

// ── Tide stage mapping (spec §7) ─────────────────────────────────────────────
// 5 stages mapped to cycle position: Turning -> Rising -> High Tide ->
// Falling -> Low. Score is the headline; trajectory is supporting context
// (still computed and stored for the dashboard's forward-guidance copy, but
// no longer gates the stage decision).
//
// Hysteresis on High Tide: enter at 75, hold until score drops below 65.
// Once the score falls out of the hold band the centre transitions into the
// descent path (Falling -> Low). yesterdayStage is the source of truth for
// where we are in the cycle.
//
// Why hysteresis (not a fixed N-day window): a centre that hits peak should
// hold "Go now" until the score genuinely retreats, not auto-time-out after
// a fixed window. The 65 floor gives a 10-point cushion against day-to-day
// noise around the 75 entry without freezing the verdict if sales actually
// collapse.
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

  // Hysteresis: enter High Tide at 75, hold until score drops below 65
  if (score >= HIGH_TIDE_ENTER || (wasHighTide && score >= HIGH_TIDE_EXIT)) {
    return { stage: 'High Tide', verdict: 'Go now', bluf: 'Maximum density, maximum freshness. This is the moment.' };
  }

  // Descent path: was at peak yesterday and has now dropped below the hold,
  // or was already descending. Distinguishes Falling (still meaningful) from
  // Low (cycle ended) by the 25-point boundary.
  if (wasHighTide || wasDescent) {
    if (score < 25) return { stage: 'Low',     verdict: "It's over",              bluf: 'Cycle ended. Check back when brands start their next sale.' };
    return           { stage: 'Falling', verdict: 'Last chance — tide going out', bluf: 'Tide going out. Go now or miss out.' };
  }

  // Climb path: working up toward peak (or first day of a new centre)
  if (score >= 25) return { stage: 'Rising',  verdict: 'Worth watching',   bluf: 'Sales building and fresh. Plan your visit soon.' };
  return            { stage: 'Turning', verdict: 'Starting to build', bluf: 'A few brands are breaking into sale. Worth watching.' };
}

// ── Trajectory (spec §5) ─────────────────────────────────────────────────────
// recentScores: last N daily scores before today, newest first.
// Requires ≥3 days of history; defaults to RISING for new centres (spec §9.3).
function getTrajectory(todayScore, recentScores) {
  if (recentScores.length < 3) return 'RISING';
  const avg = (recentScores[0] + recentScores[1] + recentScores[2]) / 3;
  const diff = todayScore - avg;
  if (diff >  TRAJECTORY_FLAT_BAND) return 'RISING';
  if (diff < -TRAJECTORY_FLAT_BAND) return 'FALLING';
  return 'FLAT';
}

async function calculateAllCentreScores() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scorer — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  const [centresRes, centreBrandsRes, brandSaleRes, recentScoresRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, max_discount_pct, scraper_error'),
    supabase.from('centre_seer_scores')
      .select('centre_id, score_date, tide_score, verdict')
      .gte('score_date', THREE_DAYS_AGO)
      .lt('score_date', TODAY)
      .order('score_date', { ascending: false }),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    console.error('Data load failed:', centresRes.error || centreBrandsRes.error || brandSaleRes.error);
    process.exit(1);
  }

  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));

  // Build per-centre recent score arrays (newest first) for trajectory, and
  // pull yesterday's stage (most recent prior row's verdict) for hysteresis.
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

  for (const centre of centresRes.data) {
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
      if (!sale || sale.scraper_error || !sale.sale_status) continue;

      const daysRunning = sale.date_first_detected
        ? Math.floor((new Date(TODAY) - new Date(sale.date_first_detected)) / 86400000) + 1
        : 1;

      const freshness = brandFreshnessScore(daysRunning);
      if (freshness === 0) continue; // Beyond DECAY_MAX — excluded per spec §2.2

      const weight = ANCHOR_BRAND_IDS.has(brandId) ? ANCHOR_MULTIPLIER : 1.0;
      totalFreshness += freshness * weight;
      brandsOnSale++;
      saleDetails.push({ name: brandNameLookup[brandId] || brandId, freshness, weight, maxDiscountPct: sale.max_discount_pct });
    }

    // Centre Tide Score = (Σ freshness × weight) / N × 100  (spec §4.1)
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

    scoreRows.push({
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
    });

    const icons = { Turning: '🔵', Rising: '📈', 'High Tide': '⭐', Falling: '⚠️', Low: '⬛' };
    console.log(`  ${icons[stage] ?? '?'} ${centre.name}: ${stage} (${tideScore}) | ${brandsOnSale}/${totalBrands} brands | ${trajectory}`);
  }

  console.log('\nWriting scores...');

  const { error } = await supabase
    .from('centre_seer_scores')
    .upsert(scoreRows, { onConflict: 'centre_id,score_date' });

  if (error) {
    console.error('Score write error:', error);
    process.exit(1);
  }

  console.log(`  ✓ ${scoreRows.length} centre scores written`);

  // Cache up to 60 days of score history per centre for sparkline display
  const { data: historyData, error: historyError } = await supabase
    .from('centre_seer_scores')
    .select('centre_id, score_date, tide_score')
    .gte('score_date', SIXTY_DAYS_AGO)
    .not('tide_score', 'is', null)
    .order('score_date', { ascending: true });

  if (historyError) {
    console.error('History fetch error:', historyError);
  } else {
    const historyByCentre = new Map();
    for (const row of historyData) {
      if (!historyByCentre.has(row.centre_id)) historyByCentre.set(row.centre_id, []);
      historyByCentre.get(row.centre_id).push({ date: row.score_date, score: row.tide_score });
    }

    const noHistory = centresRes.data.filter(c => !historyByCentre.has(c.id));
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
      console.error(`  ✗ tide_history failed for ${failures.length} centres:`, failures.map(f => f.error));
    } else {
      console.log(`  ✓ tide_history updated for ${historyByCentre.size} centres`);
    }
  }

  console.log('\n✅ Scoring complete');
}

// ── Personal score helpers ─────────────────────────────────────────────────────

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
    return;
  }

  if (!prefsRes.data || prefsRes.data.length === 0) {
    console.log('  No user preferences found, skipping personal scores');
    return;
  }

  const brandById    = new Map(brands.map(b => [b.id, b]));
  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));

  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrandsRes.data) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const scoreRows = [];

  for (const pref of prefsRes.data) {
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
      // Personal scores aren't tracked across days, so no yesterdayStage —
      // the verdict reflects the score alone (no hysteresis).
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
  }

  if (scoreRows.length === 0) {
    console.log('  No personal scores to write');
    return;
  }

  const { error } = await supabase
    .from('personal_tide_scores')
    .upsert(scoreRows, { onConflict: 'user_id,centre_id,score_date' });

  if (error) throw new Error(`Personal score write failed: ${error.message}`);

  console.log(`  ✓ ${scoreRows.length} personal scores written for ${prefsRes.data.length} user(s)`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  await calculateAllCentreScores();
  try {
    await calculatePersonalScores();
  } catch (err) {
    console.error('⚠ Personal scores failed (centre scores unaffected):', err.message);
  }
}

main().catch(err => {
  console.error('❌ Scorer failed:', err);
  process.exit(1);
});
