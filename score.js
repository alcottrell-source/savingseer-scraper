import { createClient } from '@supabase/supabase-js';
import { brands } from './brands.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const brandNameLookup = Object.fromEntries(brands.map(b => [b.id, b.name]));

// Lazy supabase client — module is imported by /api/rescore.js (Vercel
// function) as well as run via `node score.js`, so we don't want a
// missing env var to crash on import in the wrong context.
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  return _supabase;
}

function dateStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
}

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
// hold "Peak" until the score genuinely retreats, not auto-time-out after
// a fixed window. The 65 floor gives a 10-point cushion against day-to-day
// noise around the 75 entry without freezing the verdict if sales actually
// collapse.
const HIGH_TIDE_ENTER = 75;
const HIGH_TIDE_EXIT  = 65;

// Trend-only verdict vocabulary. Headlines describe the cycle direction;
// the PEAK badge is the only recommendation language the dashboard shows.
// Legacy verdict strings are retained so the lookup still resolves yesterday's
// stage when reading rows written before the rename.
const STAGE_FROM_VERDICT = {
  'Peak':    'High Tide',
  'Easing':  'Falling',
  'Rising':  'Rising',
  'Turning': 'Turning',
  'Quiet':   'Turning',
  'Over':    'Low',
  // Legacy strings (pre-rename) — keep so historical rows still map.
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

// Trajectory shapes the bluf sentence and triggers the local-peak verdict.
// Every centre has its own peak day, even ones that never break 75 — the
// moment a climbing centre turns over, that day's verdict is `Peak` (one-shot)
// so users get the GO NOW signal at their centre's natural maximum. The day
// after, the descent path picks it up and we transition to Easing.
function getTideStage(score, yesterdayStage, trajectory, yesterdayTrajectory) {
  const wasHighTide = yesterdayStage === 'High Tide';
  const wasDescent  = yesterdayStage === 'Falling' || yesterdayStage === 'Low';
  const falling     = trajectory === 'FALLING';
  // Local-peak detection: the centre was climbing (trajectory RISING) and
  // the climb has now ended — today's trajectory is anything other than
  // RISING. This is its natural high tide whether or not the score crossed
  // the 75 hysteresis line.
  //
  // It must catch FLAT too, not just FALLING. getTrajectory's stickiness
  // only ever leaves RISING via FLAT for a gentle roll-over (a drop of
  // 1.5–4 pts vs the 3-day average) and via FALLING for a sharp one
  // (>4 pts). If we only fired on RISING→FALLING, every centre that peaks
  // gently below 75 would slide RISING→FLAT→FALLING and never emit a Peak
  // — no GO NOW, no peak-alert email — which silently breaks the core
  // promise that every centre has a peak day. The sticky thresholds mean
  // a RISING→FLAT transition already represents a meaningful roll-over,
  // not day-to-day noise, so treating it as the local peak is correct.
  const localPeak   = yesterdayTrajectory === 'RISING' && trajectory !== 'RISING';

  if (score === 0) {
    if (wasHighTide || wasDescent) {
      return { stage: 'Low', verdict: 'Over', bluf: 'Sale cycle ended. Check back in a few weeks.' };
    }
    return { stage: 'Turning', verdict: 'Quiet', bluf: 'Nothing major on right now.' };
  }

  // Hysteresis: enter High Tide at 75, hold until score drops below 65
  if (score >= HIGH_TIDE_ENTER || (wasHighTide && score >= HIGH_TIDE_EXIT)) {
    return { stage: 'High Tide', verdict: 'Peak', bluf: 'Maximum sales density. This is the moment.' };
  }

  // Descent path: was at peak yesterday and has now dropped below the hold,
  // or was already descending. Distinguishes Falling (still meaningful) from
  // Low (cycle ended) by the 25-point boundary.
  if (wasHighTide || wasDescent) {
    if (score < 25) return { stage: 'Low',     verdict: 'Over',   bluf: 'Sale cycle ended. Check back in a few weeks.' };
    return           { stage: 'Falling', verdict: 'Easing', bluf: 'Sales tapering off. Picks getting thinner.' };
  }

  // Climb path. A trajectory turn-over while we're still in the climb (score
  // hasn't crossed 75) means this centre just hit its OWN peak — fire the
  // Peak verdict for this one day. Tomorrow STAGE_FROM_VERDICT will map
  // 'Peak' → 'High Tide' so the descent branch above takes over and
  // transitions the centre to Easing on day 2.
  if (score >= 25) {
    if (localPeak) {
      return {
        stage: 'High Tide',
        verdict: 'Peak',
        bluf: 'This centre just peaked. Go now while picks are fresh — sales will start thinning from tomorrow.',
      };
    }
    return {
      stage: 'Rising',
      verdict: 'Rising',
      bluf: falling
        ? 'Sales tapering off. Picks getting thinner.'
        : 'Sales building across the centre. Not at peak yet.',
    };
  }
  return {
    stage: 'Turning',
    verdict: 'Quiet',
    bluf: falling
      ? 'Sales thin and quieting. Wait for the next cycle to build.'
      : 'Quiet — only a handful of brands on sale right now.',
  };
}

// ── Trajectory (spec §5, with hysteresis) ────────────────────────────────────
// recentScores: last N daily scores before today, newest first.
// yesterdayTrajectory: the previous day's trajectory label, used to add
// directional stickiness so a centre doesn't flap between RISING and
// FALLING on day-to-day noise. Tide doesn't reverse on a wave.
//
// Behaviour:
//   - Currently RISING: stays RISING through small dips. Need a drop of
//     >TRAJECTORY_FLIP_BAND (4.0) to flip to FALLING. A milder dip
//     (<-TRAJECTORY_FLAT_BAND) lands on FLAT.
//   - Currently FALLING: mirror image — small bounces don't flip it back.
//   - FLAT (or unknown prior): symmetric ±TRAJECTORY_FLAT_BAND thresholds.
//
// Requires ≥3 days of history; defaults to RISING for new centres (spec §9.3).
const TRAJECTORY_FLIP_BAND = 4.0;
function getTrajectory(todayScore, recentScores, yesterdayTrajectory) {
  if (recentScores.length < 3) return 'RISING';
  const avg = (recentScores[0] + recentScores[1] + recentScores[2]) / 3;
  const diff = todayScore - avg;
  const prior = yesterdayTrajectory || 'FLAT';
  if (prior === 'RISING') {
    if (diff < -TRAJECTORY_FLIP_BAND) return 'FALLING';
    if (diff < -TRAJECTORY_FLAT_BAND) return 'FLAT';
    return 'RISING';
  }
  if (prior === 'FALLING') {
    if (diff >  TRAJECTORY_FLIP_BAND) return 'RISING';
    if (diff >  TRAJECTORY_FLAT_BAND) return 'FLAT';
    return 'FALLING';
  }
  if (diff >  TRAJECTORY_FLAT_BAND) return 'RISING';
  if (diff < -TRAJECTORY_FLAT_BAND) return 'FALLING';
  return 'FLAT';
}

async function calculateAllCentreScores(opts = {}) {
  const supabase = getSupabase();
  const TODAY          = opts.today || dateStr(0);
  const YESTERDAY      = dateStr(-1);
  const THREE_DAYS_AGO = dateStr(-3);
  const SIXTY_DAYS_AGO = dateStr(-60);
  const filterCentreIds = Array.isArray(opts.filterCentreIds) && opts.filterCentreIds.length
    ? new Set(opts.filterCentreIds)
    : null;

  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scorer — ${TODAY}${filterCentreIds ? ` (centres: ${[...filterCentreIds].join(', ')})` : ''}`);
  console.log('═══════════════════════════════════════════════');

  const [centresRes, centreBrandsRes, brandSaleRes, recentScoresRes, yesterdayRowsRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date,max_discount_pct)'),
    supabase.from('centre_seer_scores')
      .select('centre_id, score_date, tide_score, verdict, trajectory')
      .gte('score_date', THREE_DAYS_AGO)
      .lt('score_date', TODAY)
      .order('score_date', { ascending: false }),
    // Yesterday's full row per centre — used to carry-forward when no
    // brand for the centre has been verified today (admin hasn't acted).
    supabase.from('centre_seer_scores')
      .select('centre_id, tide_score, phase, verdict, bluf, trajectory, brands_on_sale, total_brands, top_brands, avg_discount_pct')
      .eq('score_date', YESTERDAY),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    console.error('Data load failed:', centresRes.error || centreBrandsRes.error || brandSaleRes.error);
    throw new Error('Data load failed');
  }

  const yesterdayRowMap = new Map((yesterdayRowsRes.data || []).map(r => [r.centre_id, r]));

  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));

  // Build per-centre recent score arrays (newest first) for trajectory, and
  // pull yesterday's stage (most recent prior row's verdict) for hysteresis.
  // Yesterday's trajectory feeds hysteresis on the trajectory itself —
  // direction is sticky through noise.
  const recentScoreMap = new Map();
  const yesterdayStageMap = new Map();
  const yesterdayTrajectoryMap = new Map();
  for (const row of (recentScoresRes.data || [])) {
    if (!recentScoreMap.has(row.centre_id)) recentScoreMap.set(row.centre_id, []);
    recentScoreMap.get(row.centre_id).push(row.tide_score);
    if (!yesterdayStageMap.has(row.centre_id)) {
      const stage = deriveStageFromVerdict(row.verdict);
      if (stage) yesterdayStageMap.set(row.centre_id, stage);
    }
    if (!yesterdayTrajectoryMap.has(row.centre_id) && row.trajectory) {
      yesterdayTrajectoryMap.set(row.centre_id, row.trajectory);
    }
  }

  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrandsRes.data) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const scoreRows = [];
  let carriedForward = 0;

  for (const centre of centresRes.data) {
    if (filterCentreIds && !filterCentreIds.has(centre.id)) continue;
    const brandIds = centreBrandMap.get(centre.id) || [];
    const totalBrands = brandIds.length;

    if (totalBrands === 0) {
      console.log(`  ⚠ ${centre.name}: no brands configured, skipping`);
      continue;
    }

    // Carry-forward: if no brand at this centre has been verified today,
    // the admin hasn't acted on this centre yet. Don't recompute (which
    // would only show freshness decay relative to yesterday); copy
    // yesterday's row forward so the centre's public numbers stay
    // exactly as the admin last left them.
    const adminTouchedToday = brandIds.some(bid => {
      const sale = brandSaleMap.get(bid);
      return sale && sale.last_verified_date === TODAY;
    });
    if (!adminTouchedToday) {
      const ystrdy = yesterdayRowMap.get(centre.id);
      if (ystrdy) {
        scoreRows.push({
          centre_id: centre.id,
          score_date: TODAY,
          tide_score: ystrdy.tide_score,
          phase: ystrdy.phase,
          verdict: ystrdy.verdict,
          bluf: ystrdy.bluf,
          trajectory: ystrdy.trajectory,
          brands_on_sale: ystrdy.brands_on_sale,
          total_brands: ystrdy.total_brands,
          top_brands: ystrdy.top_brands,
          avg_discount_pct: ystrdy.avg_discount_pct,
        });
        carriedForward++;
        console.log(`  ⏸ ${centre.name}: no admin activity today — carried yesterday's row forward`);
        continue;
      }
      // No yesterday row to copy from — fall through to a fresh compute
      // (e.g. brand-new centre, or first run after a gap).
    }

    let totalFreshness = 0;
    let brandsOnSale = 0;
    const saleDetails = [];

    for (const brandId of brandIds) {
      const sale = brandSaleMap.get(brandId);
      if (!sale) continue;

      // Admin is the only source of truth for sale state and discount %.
      // Priority for "is this brand on sale today":
      //   1. Active verified cycle  (admin opened a cycle, treat as on sale)
      //   2. last_verified_status   (admin's most recent decision)
      //   3. otherwise              not on sale
      // The scraper's sale_status is intentionally NOT a fallback — it lives
      // in the admin panel as a recommendation only and never reaches the
      // public dashboard until an admin verifies it.
      const isOnSale = sale.active_cycle_id
        ? true
        : sale.last_verified_date
          ? sale.last_verified_status
          : false;
      if (!isOnSale) continue;

      // Ripeness origin: prefer the verified cycle's start_date, fall back
      // to last_verified_date when on-sale was confirmed without a cycle
      // being opened. Never fall back to the scraper's date_first_detected.
      const cycleStart = (sale.cycle && sale.cycle.start_date) || sale.last_verified_date;
      const daysRunning = cycleStart
        ? Math.floor((new Date(TODAY) - new Date(cycleStart)) / 86400000) + 1
        : 1;

      const freshness = brandFreshnessScore(daysRunning);
      if (freshness === 0) continue; // Beyond DECAY_MAX — excluded per spec §2.2

      const weight = ANCHOR_BRAND_IDS.has(brandId) ? ANCHOR_MULTIPLIER : 1.0;
      totalFreshness += freshness * weight;
      brandsOnSale++;
      // Discount % comes only from a verified cycle. Without one, no
      // percentage is shown — scraper reading is admin-panel-only.
      const maxDiscountPct = (sale.cycle && sale.cycle.max_discount_pct) || null;
      saleDetails.push({ name: brandNameLookup[brandId] || brandId, freshness, weight, maxDiscountPct });
    }

    // Centre Tide Score = (Σ freshness × weight) / N × 100  (spec §4.1)
    const tideScore = Math.round((totalFreshness / totalBrands) * 100 * 10) / 10;
    const recent = recentScoreMap.get(centre.id) ?? [];
    const yesterdayTrajectory = yesterdayTrajectoryMap.get(centre.id) ?? null;
    const trajectory = getTrajectory(tideScore, recent, yesterdayTrajectory);
    const yesterdayStage = yesterdayStageMap.get(centre.id) ?? null;
    const { stage, verdict, bluf } = getTideStage(tideScore, yesterdayStage, trajectory, yesterdayTrajectory);

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
      // Null the narrative whenever the underlying numbers are recomputed.
      // The morning summariser repopulates it; admin rescores during the
      // day leave it null, so the front-end falls back to its template
      // narrative (computed live from current brand data) instead of
      // showing yesterday's prose against today's numbers. Carry-forward
      // path above intentionally omits this so untouched centres keep
      // their existing narrative.
      narrative: null,
    });

    const icons = { Turning: '🔵', Rising: '📈', 'High Tide': '⭐', Falling: '⚠️', Low: '⬛' };
    console.log(`  ${icons[stage] ?? '?'} ${centre.name}: ${stage} (${tideScore}) | ${brandsOnSale}/${totalBrands} brands | ${trajectory}`);
  }

  console.log(`\nWriting scores... (${scoreRows.length - carriedForward} fresh, ${carriedForward} carried forward)`);

  const { error } = await supabase
    .from('centre_seer_scores')
    .upsert(scoreRows, { onConflict: 'centre_id,score_date' });

  if (error) {
    console.error('Score write error:', error);
    throw new Error(`Score write failed: ${error.message}`);
  }

  console.log(`  ✓ ${scoreRows.length} centre scores written`);

  // Cache up to 60 days of score history per centre for sparkline display
  // and the day-on-day change line on the centre vessel. We persist the
  // brand counts per day too so the front-end can compute the actual
  // "↓ N brands since yesterday" delta — the displayed metric — instead
  // of falling back to the underlying tide_score % change (which moves
  // on freshness decay even when the admin hasn't touched anything).
  const { data: historyData, error: historyError } = await supabase
    .from('centre_seer_scores')
    .select('centre_id, score_date, tide_score, brands_on_sale, total_brands')
    .gte('score_date', SIXTY_DAYS_AGO)
    .not('tide_score', 'is', null)
    .order('score_date', { ascending: true });

  if (historyError) {
    console.error('History fetch error:', historyError);
  } else {
    const historyByCentre = new Map();
    for (const row of historyData) {
      if (!historyByCentre.has(row.centre_id)) historyByCentre.set(row.centre_id, []);
      historyByCentre.get(row.centre_id).push({
        date: row.score_date,
        score: row.tide_score,
        brands_on_sale: row.brands_on_sale,
        total_brands: row.total_brands,
      });
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

async function calculatePersonalScores(opts = {}) {
  const supabase = getSupabase();
  const TODAY = opts.today || dateStr(0);
  console.log('\nCalculating personal scores...');

  const [centresRes, centreBrandsRes, brandSaleRes, prefsRes] = await Promise.all([
    supabase.from('centres').select('id, name').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(start_date)'),
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
        if (!sale) continue;
        // Admin-only source of truth (mirrors the centre-score path above):
        // verified cycle, or last verified status. No scraper fallback.
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

        totalFreshness += brandFreshnessScore(daysRunning);
        matchingOnSale++;
      }

      const personalScore = Math.round((totalFreshness / matchingBrandIds.length) * 10) / 10;
      // Personal scores aren't tracked across days, so no yesterdayStage —
      // the verdict reflects the score alone (no hysteresis). Trajectory is
      // also unavailable per-user; pass FLAT so the bluf branch is neutral
      // and null yesterdayTrajectory so localPeak detection is suppressed.
      const { verdict } = getTideStage(personalScore, null, 'FLAT', null);

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

// ── Public entry point ─────────────────────────────────────────────────────────
// Used by the daily cron (`node score.js`) and by /api/rescore.js when the
// admin saves an edit. `filterCentreIds` lets the API endpoint recompute
// just the touched centre instead of all 30.
export async function runScoring(opts = {}) {
  await calculateAllCentreScores(opts);
  try {
    await calculatePersonalScores(opts);
  } catch (err) {
    console.error('⚠ Personal scores failed (centre scores unaffected):', err.message);
  }
}

// Pure scoring primitives — exported for unit testing (test/score.test.mjs).
// No side effects, no Supabase: safe to import from a test runner.
export { brandFreshnessScore, getTrajectory, getTideStage, deriveStageFromVerdict };

// CLI entry — only fires when this file is invoked directly via
// `node score.js`, not when imported as a module by /api/rescore.js.
const isCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch { return false; }
})();
if (isCli) {
  runScoring().catch(err => {
    console.error('❌ Scorer failed:', err);
    process.exit(1);
  });
}
