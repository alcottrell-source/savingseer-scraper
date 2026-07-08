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

// PostgREST silently caps a single response at the project's db-max-rows
// (~1000 rows) — no error, just a short result. Any select that can exceed
// that must page through with .range() or it returns only the first slice.
// This is exactly what silently froze every centre's tide_history at
// ~2026-06-01: the rebuild read centre_seer_scores ordered oldest-first and
// only the first ~1000 rows (≈ up to June 1, across ~37 centres) survived.
//
// buildQuery() must return a FRESH query builder each call (Supabase builders
// are single-use) carrying a DETERMINISTIC total order, otherwise rows can
// shuffle across page boundaries and produce dupes/gaps.
async function selectAllRows(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (data && data.length) out.push(...data);
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

function dateStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
}

// ── Tunable parameters ───────────────────────────────────────────────────────
// Trajectory bands operate on tide_score points. Since tide_score is now
// just (brandsOnSale / totalBrands × 100), a 1.5-point drop ≈ 1-2 brands
// leaving sale at a typical 70-80 brand centre — the same effective
// sensitivity the freshness-weighted score had before the rewrite.
const TRAJECTORY_FLAT_BAND = 1.5;  // ±1.5 defines the Flat (Peak) window

const PHASE_NUMBER = { Turning: 1, Rising: 2, 'High Tide': 2, Falling: 2, Low: 1 };

// ── Tide stage mapping (spec §7) ─────────────────────────────────────────────
// 5 stages mapped to cycle position: Turning -> Rising -> High Tide ->
// Falling -> Low. Score is the headline; trajectory is supporting context
// (still computed and stored for the dashboard's forward-guidance copy, but
// no longer gates the stage decision).
//
// Hysteresis on High Tide: enter at 40, hold until score drops below 30.
// Once the score falls out of the hold band the centre transitions into the
// descent path (Falling -> Low). yesterdayStage is the source of truth for
// where we are in the cycle.
//
// Score is now plain % of brands on sale (brandsOnSale / totalBrands × 100),
// so 40% sale density is the "exceptional, GO NOW" threshold and 15% is
// the entry to RISING. Below 15% is QUIET; <8% on the descent path is OVER.
const HIGH_TIDE_ENTER = 40;
const HIGH_TIDE_EXIT  = 30;
const RISING_FLOOR    = 15;  // Climb path: ≥15 → Rising, else Quiet
const OVER_CEILING    = 8;   // Descent path: <8 → Over, else Easing

// Peak subtitle (bluf) copy. The old global-Peak line — "Maximum sales density.
// This is the moment." — asserted a falsifiable superlative on EVERY Peak: at
// Peak 40–60% of brands are typically still off-sale, and the 60-day curve can
// visibly contradict "maximum". The recommendation ("Go now") already lives in
// the headline + PEAK badge, so the subtitle stays evidence-based.
//
// PEAK_BLUF_GENERIC is always true of a global Peak (plenty on sale, recently
// cut). It is upgraded to PEAK_BLUF_60DAY_HIGH only when today's score is
// literally the centre's highest in the trailing 60 days — see the
// upgradePeakBluf() gate in calculateAllCentreScores. The local-peak bluf is a
// separate, already-honest string ("This centre just peaked…") and is left
// untouched.
const PEAK_BLUF_GENERIC    = 'Plenty on sale right now, and freshly cut.';
const PEAK_BLUF_60DAY_HIGH = "Highest it's been in 60 days.";

// Upgrade a global-Peak subtitle to the 60-day-high superlative ONLY when it is
// literally true for this centre/day (today's score ≥ the max of the prior
// 60 days). Anything that isn't the generic global-Peak line — a non-Peak
// verdict, or the local-peak bluf — is returned unchanged.
function upgradePeakBluf(verdict, bluf, score, prior60Max) {
  if (verdict !== 'Peak' || bluf !== PEAK_BLUF_GENERIC) return bluf;
  if (prior60Max != null && score >= prior60Max) return PEAK_BLUF_60DAY_HIGH;
  return bluf;
}

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
// Every centre has its own peak day, even ones that never break the HIGH_TIDE
// threshold — the moment a climbing centre turns over, that day's verdict is
// `Peak` (one-shot) so users get the GO NOW signal at their centre's natural
// maximum. The day after, the descent path picks it up and we transition to
// Easing.
// TODO(ADR-002 docs/architecture/tide-score.md §10): replace the inline
// getTrajectory/getTideStage calls (fresh + carry-forward paths) with
// lib/tide-machine.js nextTideState, and persist the explicit state columns
// (stage, stage_entered_date, last_peak_date, observed_days). The parity
// suite in test/tide-machine.test.mjs proves the swap is behaviour-safe.
function getTideStage(score, yesterdayStage, trajectory, yesterdayTrajectory) {
  const wasHighTide = yesterdayStage === 'High Tide';
  const wasDescent  = yesterdayStage === 'Falling' || yesterdayStage === 'Low';
  const falling     = trajectory === 'FALLING';
  // Local-peak detection: the centre was climbing (trajectory RISING) and
  // the climb has now ended — today's trajectory is anything other than
  // RISING. This is its natural high tide whether or not the score crossed
  // the HIGH_TIDE_ENTER line.
  //
  // It must catch FLAT too, not just FALLING. getTrajectory's stickiness
  // only ever leaves RISING via FLAT for a gentle roll-over (a drop of
  // 1.5–4 pts vs the 3-day average) and via FALLING for a sharp one
  // (>4 pts). If we only fired on RISING→FALLING, every centre that peaks
  // gently below HIGH_TIDE_ENTER would slide RISING→FLAT→FALLING and never
  // emit a Peak — no GO NOW, no peak-alert email — which silently breaks
  // the core promise that every centre has a peak day. The sticky thresholds
  // mean a RISING→FLAT transition already represents a meaningful roll-over,
  // not day-to-day noise, so treating it as the local peak is correct.
  const localPeak   = yesterdayTrajectory === 'RISING' && trajectory !== 'RISING';

  if (score === 0) {
    if (wasHighTide || wasDescent) {
      return { stage: 'Low', verdict: 'Over', bluf: 'Sale cycle ended. Check back in a few weeks.' };
    }
    return { stage: 'Turning', verdict: 'Quiet', bluf: 'Nothing major on right now.' };
  }

  // Hysteresis: enter High Tide at 40, hold until score drops below 30
  if (score >= HIGH_TIDE_ENTER || (wasHighTide && score >= HIGH_TIDE_EXIT)) {
    return { stage: 'High Tide', verdict: 'Peak', bluf: PEAK_BLUF_GENERIC };
  }

  // Descent path: was at peak yesterday and has now dropped below the hold,
  // or was already descending. Distinguishes Falling (still meaningful) from
  // Low (cycle ended) by the OVER_CEILING boundary.
  //
  // New-cycle escape: a centre that ended a cycle (Low) and is now climbing
  // again with a sustained RISING trajectory should re-enter the climb path,
  // not stay locked in Easing/Over forever. Without this a "rolling" centre
  // where new sales keep arriving after old ones end reads OVER for life.
  if (wasHighTide || wasDescent) {
    if (yesterdayStage === 'Low' && trajectory === 'RISING' && score >= RISING_FLOOR) {
      return { stage: 'Rising', verdict: 'Rising', bluf: 'Sales building again — a fresh cycle starting.' };
    }
    if (score < OVER_CEILING) return { stage: 'Low',     verdict: 'Over',   bluf: 'Sale cycle ended. Check back in a few weeks.' };
    return                    { stage: 'Falling', verdict: 'Easing', bluf: 'Sales tapering off. Picks getting thinner.' };
  }

  // Climb path. A trajectory turn-over while we're still in the climb (score
  // hasn't crossed 40) means this centre just hit its OWN peak — fire the
  // Peak verdict for this one day. Tomorrow STAGE_FROM_VERDICT will map
  // 'Peak' → 'High Tide' so the descent branch above takes over and
  // transitions the centre to Easing on day 2.
  if (score >= RISING_FLOOR) {
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
  // Rolling window of daily scores rebuilt into centres.tide_history each run.
  // Drives the centre-detail chart's MAX tab, so it must exceed the 60D tab to
  // stay meaningfully longer than it; 180 days is a few KB of JSON per centre
  // (trivial at ~30 centres) and reads fine as a trend on the fixed-width
  // chart. (Distinct from SIXTY_DAYS_AGO above, which gates the literal
  // "highest in 60 days" Peak superlative and must remain 60.)
  const HISTORY_RETENTION_DAYS = 180;
  const HISTORY_START = dateStr(-HISTORY_RETENTION_DAYS);
  const filterCentreIds = Array.isArray(opts.filterCentreIds) && opts.filterCentreIds.length
    ? new Set(opts.filterCentreIds)
    : null;
  // forceFresh: recompute every centre from live brand state, ignoring the
  // carry-forward "no admin activity today → freeze yesterday" shortcut. The
  // daily cron sets this so the stored score self-heals: a sale confirmed after
  // the cron (or an intraday rescore that silently failed) would otherwise stay
  // frozen forever, because the carry-forward gate keys off last_verified_date
  // == TODAY while "on sale" is also true via an active_cycle_id opened on a
  // prior day. A fresh compute reads the same persistent on-sale state, so it
  // matches carry-forward when nothing changed and corrects it when it has.
  // The intraday rescore leaves this off to stay cheap and to preserve
  // narratives on untouched centres.
  const forceFresh = !!opts.forceFresh;

  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scorer — ${TODAY}${filterCentreIds ? ` (centres: ${[...filterCentreIds].join(', ')})` : ''}`);
  console.log('═══════════════════════════════════════════════');

  const [centresRes, centreBrandsRes, brandSaleRes, recentScoresRes, yesterdayRowsRes, sixtyDayScoresRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    // centre_brands grows with the catalogue (centres × brands) and can exceed
    // the PostgREST row cap — paginate so totalBrands (and thus every tide_score)
    // can't be silently truncated. Deterministic order for safe paging.
    selectAllRows(() => supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true)
      .order('centre_id', { ascending: true }).order('brand_id', { ascending: true })),
    // One row per brand — paginate defensively as the brand list grows.
    selectAllRows(() => supabase.from('brand_sale_events')
      .select('brand_id, last_verified_status, last_verified_date, active_cycle_id, cycle:brand_sale_cycles!active_cycle_id(max_discount_pct)')
      .order('brand_id', { ascending: true })),
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
    // Prior 60-day scores per centre — used to gate the "Highest it's been in
    // 60 days" Peak subtitle so the superlative is only ever shown when it's
    // literally true. Excludes TODAY so a fresh score is compared against its
    // own history, not itself. ~37×60 rows can exceed the cap — paginate, with
    // a deterministic (centre_id, score_date) order so no day is dropped.
    selectAllRows(() => supabase.from('centre_seer_scores')
      .select('centre_id, tide_score')
      .gte('score_date', SIXTY_DAYS_AGO)
      .lt('score_date', TODAY)
      .not('tide_score', 'is', null)
      .order('centre_id', { ascending: true }).order('score_date', { ascending: true })),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    console.error('Data load failed:', centresRes.error || centreBrandsRes.error || brandSaleRes.error);
    throw new Error('Data load failed');
  }

  const yesterdayRowMap = new Map((yesterdayRowsRes.data || []).map(r => [r.centre_id, r]));

  // Max prior-60-day tide_score per centre, for the 60-day-high Peak subtitle.
  const sixtyDayMaxMap = new Map();
  for (const row of (sixtyDayScoresRes.data || [])) {
    const cur = sixtyDayMaxMap.get(row.centre_id);
    if (cur === undefined || row.tide_score > cur) sixtyDayMaxMap.set(row.centre_id, row.tide_score);
  }

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
    // the admin hasn't acted on this centre yet. Re-running the state
    // machine on the carried score lets a Peak roll over to Easing on day
    // 2 without forcing the admin to verify a brand they already know is
    // on sale.
    const adminTouchedToday = brandIds.some(bid => {
      const sale = brandSaleMap.get(bid);
      return sale && sale.last_verified_date === TODAY;
    });
    if (!adminTouchedToday && !forceFresh) {
      const ystrdy = yesterdayRowMap.get(centre.id);
      if (ystrdy) {
        // Freeze yesterday's numbers but still run the state machine forward
        // off the carried score. Copying yesterday's verdict verbatim would
        // lock a centre at its peak indefinitely — PEAK / GO NOW stuck on
        // screen and a duplicate peak-alert email every day for the same
        // cycle, because STAGE_FROM_VERDICT['Peak']→'High Tide' descent
        // only happens when a fresh compute runs. Re-deriving here lets a
        // carried-forward Peak ease on day 2 exactly like the fresh path.
        const carriedScore = ystrdy.tide_score;
        const recent = recentScoreMap.get(centre.id) ?? [];
        const yTraj  = yesterdayTrajectoryMap.get(centre.id) ?? ystrdy.trajectory ?? null;
        const trajectory = getTrajectory(carriedScore, recent, yTraj);
        const yStage = yesterdayStageMap.get(centre.id) ?? deriveStageFromVerdict(ystrdy.verdict);
        const { stage, verdict, bluf } = getTideStage(carriedScore, yStage, trajectory, yTraj);
        const carriedBluf = upgradePeakBluf(verdict, bluf, carriedScore, sixtyDayMaxMap.get(centre.id));
        scoreRows.push({
          centre_id: centre.id,
          score_date: TODAY,
          tide_score: carriedScore,
          phase: PHASE_NUMBER[stage],
          verdict,
          bluf: carriedBluf,
          trajectory,
          brands_on_sale: ystrdy.brands_on_sale,
          total_brands: ystrdy.total_brands,
          top_brands: ystrdy.top_brands,
          avg_discount_pct: ystrdy.avg_discount_pct,
          // narrative intentionally omitted — untouched centres keep theirs.
        });
        carriedForward++;
        console.log(`  ⏸ ${centre.name}: no admin activity today — score frozen, state re-derived → ${verdict}`);
        continue;
      }
      // No yesterday row to copy from — fall through to a fresh compute
      // (e.g. brand-new centre, or first run after a gap).
    }

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

      brandsOnSale++;
      // Discount % comes only from a verified cycle. Without one, no
      // percentage is shown — scraper reading is admin-panel-only.
      const maxDiscountPct = (sale.cycle && sale.cycle.max_discount_pct) || null;
      saleDetails.push({
        name: brandNameLookup[brandId] || brandId,
        verifiedDate: sale.last_verified_date || null,
        maxDiscountPct,
      });
    }

    // Centre Tide Score = % of brands on sale.
    // A user looking at the card can verify this number directly: "23 of 77
    // brands on sale" → score 30. No freshness weighting, no anchor multipliers
    // — the headline number IS the brand-density fact the card already shows.
    const tideScore = totalBrands > 0
      ? Math.round((brandsOnSale / totalBrands) * 100 * 10) / 10
      : 0;
    const recent = recentScoreMap.get(centre.id) ?? [];
    const yesterdayTrajectory = yesterdayTrajectoryMap.get(centre.id) ?? null;
    const trajectory = getTrajectory(tideScore, recent, yesterdayTrajectory);
    const yesterdayStage = yesterdayStageMap.get(centre.id) ?? null;
    const { stage, verdict, bluf } = getTideStage(tideScore, yesterdayStage, trajectory, yesterdayTrajectory);
    const finalBluf = upgradePeakBluf(verdict, bluf, tideScore, sixtyDayMaxMap.get(centre.id));

    // Most-recently-verified-first — admin's latest confirmations bubble up.
    const topBrands = saleDetails
      .slice()
      .sort((a, b) => (b.verifiedDate || '').localeCompare(a.verifiedDate || ''))
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
      bluf: finalBluf,
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
  // Paginate: this reads up to HISTORY_RETENTION_DAYS × every centre, which far
  // exceeds the PostgREST row cap. Ordered oldest-first without paging, the cap
  // kept only the earliest ~1000 rows and froze every centre's tide_history at
  // ~2026-06-01. The secondary (centre_id) sort gives a deterministic total
  // order so no day is dropped or duplicated across page boundaries.
  const { data: historyData, error: historyError } = await selectAllRows(() => supabase
    .from('centre_seer_scores')
    .select('centre_id, score_date, tide_score, brands_on_sale, total_brands')
    .gte('score_date', HISTORY_START)
    .not('tide_score', 'is', null)
    .order('score_date', { ascending: true })
    .order('centre_id', { ascending: true }));

  let historyFetchFailed = false;
  let historyWriteFailures = 0;
  if (historyError) {
    console.error('History fetch error:', historyError);
    historyFetchFailed = true;
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
      historyWriteFailures = failures.length;
    } else {
      console.log(`  ✓ tide_history updated for ${historyByCentre.size} centres`);
    }
  }

  console.log('\n✅ Scoring complete');
  // Surface tide_history write/fetch problems to callers (e.g. /api/rescore)
  // so an admin edit that updated centre_seer_scores but failed to refresh the
  // chart history doesn't silently report success. The CLI ignores the return
  // (still exits 0, behaviour unchanged); only the rescore endpoint reads it.
  return { historyFetchFailed, historyWriteFailures };
}

// ── Personal score helpers ─────────────────────────────────────────────────────

// TODO(ADR-003 docs/architecture/personalisation-ranking.md §8.2): rewrite
// calculatePersonalScores as the follows-first history pass — import
// resolveLens/buildHistoryRow from lib/personal-rank.js, stamp the new
// `basis` column, and delete this private brandMatchesPrefs (the shared
// module owns the definition now).
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

  // Paginate the catalogue/user-scaled reads — same row-cap truncation that
  // froze tide_history would silently corrupt matching-brand counts (and thus
  // every personal score) and drop users past the cap.
  const [centresRes, centreBrandsRes, brandSaleRes, prefsRes] = await Promise.all([
    supabase.from('centres').select('id, name').eq('active', true),
    selectAllRows(() => supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true)
      .order('centre_id', { ascending: true }).order('brand_id', { ascending: true })),
    selectAllRows(() => supabase.from('brand_sale_events')
      .select('brand_id, last_verified_status, last_verified_date, active_cycle_id')
      .order('brand_id', { ascending: true })),
    selectAllRows(() => supabase.from('user_preferences').select('*')
      .order('user_id', { ascending: true })),
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

        matchingOnSale++;
      }

      const personalScore = Math.round((matchingOnSale / matchingBrandIds.length) * 100 * 10) / 10;
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
  const summary = await calculateAllCentreScores(opts);
  // TODO(ADR-001 docs/architecture/gravity-engine.md §9.2): add a gravity
  // pass here — lib/gravity.js brandConfidence/centreGravity per brand/centre,
  // persisted daily (brand_gravity table + centre_seer_scores confidence
  // columns; migration per the ADR). Flag-never-mutate: it must not touch
  // tide_score or sale state.
  try {
    await calculatePersonalScores(opts);
  } catch (err) {
    console.error('⚠ Personal scores failed (centre scores unaffected):', err.message);
  }
  return summary || {};
}

// Pure scoring primitives — exported for unit testing (test/score.test.mjs).
// No side effects, no Supabase: safe to import from a test runner.
export { getTrajectory, getTideStage, deriveStageFromVerdict };

// CLI entry — only fires when this file is invoked directly via
// `node score.js`, not when imported as a module by /api/rescore.js.
const isCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch { return false; }
})();
if (isCli) {
  // The daily cron forces a fresh recompute of every centre so the stored
  // score self-heals from any drift (a sale confirmed after the previous cron,
  // or a silently-failed intraday rescore). The summariser runs right after in
  // the same workflow, repopulating the narratives this nulls.
  runScoring({ forceFresh: true }).catch(err => {
    console.error('❌ Scorer failed:', err);
    process.exit(1);
  });
}
