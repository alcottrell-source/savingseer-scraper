// score.js
// Savingseer Phase 2 — Apple Model scoring engine
// Runs after scraper.js completes (08:00 UTC via GitHub Actions)
// Reads brand_sale_events → calculates centre scores → writes to:
//   - centre_seer_scores (daily row per centre)
//   - peak_density_log (cycle state per centre)
//   - notification_log (queued notifications for Make/Zapier → OneSignal)

import { createClient } from '@supabase/supabase-js';

// ── CONFIG ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TODAY = new Date().toISOString().split('T')[0];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── APPLE MODEL CONSTANTS ───────────────────────────────────────
const PHASE1_TO_PHASE2_THRESHOLD = 45; // % density to enter Phase 2
const PICKED_OVER_DAYS = 26;           // days after peak before cycle resets
const DORMANT_RESET_THRESHOLD = 20;   // % density below which cycle fully resets

const VERDICTS = {
  // Phase 1
  DORMANT:        'Dormant',
  RIPENING:       'Ripening',
  ALMOST_READY:   'Almost Ready',
  // Phase 2
  PEAK_HARVEST:   'Peak Harvest',
  PRIME_PICKING:  'Prime Picking',
  GOING_FAST:     'Going Fast',
  LAST_OF_CROP:   'Last of the Crop',
  FALLING_FAST:   'Falling Fast',
  PICKED_OVER:    'Picked Over',
};

// ── APPLE MODEL LOGIC ───────────────────────────────────────────

function getPhase1Verdict(densityPct) {
  if (densityPct < 20) return VERDICTS.DORMANT;
  if (densityPct < 35) return VERDICTS.RIPENING;
  return VERDICTS.ALMOST_READY; // 35-44%
}

function getPhase2Verdict(daysSincePeak, densityPct, peakDensityPct) {
  const densityDrop = peakDensityPct - densityPct;
  const isDroppingFast = densityDrop >= 10;

  if (daysSincePeak >= PICKED_OVER_DAYS) return VERDICTS.PICKED_OVER;

  if (daysSincePeak <= 3) return VERDICTS.PEAK_HARVEST;

  if (daysSincePeak <= 14) {
    return isDroppingFast ? VERDICTS.GOING_FAST : VERDICTS.PRIME_PICKING;
  }

  // Day 15-25
  return isDroppingFast ? VERDICTS.FALLING_FAST : VERDICTS.LAST_OF_CROP;
}

function getTrajectory(currentDensity, previousDensity) {
  if (previousDensity === null || previousDensity === undefined) return 'HOLDING';
  const diff = currentDensity - previousDensity;
  if (diff >= 3) return 'RISING';
  if (diff <= -3) return 'DROPPING';
  return 'HOLDING';
}

function buildTopBrandsString(saleBrands) {
  // saleBrands: array of { name, maxDiscountPct } sorted by discount desc
  // Returns e.g. "Phase Eight 60%, White Stuff 50%, Seasalt Cornwall 60%"
  return saleBrands
    .filter(b => b.maxDiscountPct !== null)
    .sort((a, b) => b.maxDiscountPct - a.maxDiscountPct)
    .slice(0, 5)
    .map(b => `${b.name} ${b.maxDiscountPct}%`)
    .join(', ');
}

function buildNotificationCopy(type, centreName, storesInSale, totalStores, topBrands, daysSincePeak) {
  if (type === 'PROACTIVE') {
    return `${centreName}. Peak conditions. ${storesInSale} of ${totalStores} stores in sale.${topBrands ? ` ${topBrands}.` : ''} Get there this weekend.`;
  }
  if (type === 'REACTIVE_GOING_FAST') {
    return `${centreName}. Going fast. Stores ending their sales.${topBrands ? ` ${topBrands} still on.` : ''} Last chance this weekend.`;
  }
  if (type === 'REACTIVE_FALLING_FAST') {
    return `${centreName}. Falling fast. Sale cycle ending.${topBrands ? ` ${topBrands} still on.` : ''} Go this weekend or wait for next cycle.`;
  }
  return '';
}

// ── MAIN SCORING FUNCTION ───────────────────────────────────────

async function calculateAllCentreScores() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Savingseer Scorer — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  // 1. Load all data we need
  const [centresRes, centreBrandsRes, brandSaleRes, peakDensityRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, max_discount_pct'),
    supabase.from('peak_density_log').select('*'),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error || peakDensityRes.error) {
    console.error('Data load failed:', centresRes.error || centreBrandsRes.error || brandSaleRes.error || peakDensityRes.error);
    process.exit(1);
  }

  const centres = centresRes.data;
  const centreBrands = centreBrandsRes.data;
  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));
  const peakDensityMap = new Map(peakDensityRes.data.map(p => [p.centre_id, p]));

  // Build centre → brands lookup
  const centreBrandMap = new Map();
  for (const { centre_id, brand_id } of centreBrands) {
    if (!centreBrandMap.has(centre_id)) centreBrandMap.set(centre_id, []);
    centreBrandMap.get(centre_id).push(brand_id);
  }

  const scoreRows = [];
  const peakDensityUpdates = [];
  const notificationRows = [];

  // 2. Score each centre
  for (const centre of centres) {
    const brandIds = centreBrandMap.get(centre.id) || [];
    const totalStores = brandIds.length;

    if (totalStores === 0) {
      console.log(`  ⚠ ${centre.name}: no brands configured, skipping`);
      continue;
    }

    // Which brands are on sale at this centre?
    const saleBrands = brandIds
      .map(id => brandSaleMap.get(id))
      .filter(b => b && b.sale_status)
      .map(b => ({
        brandId: b.brand_id,
        name: brands_name_lookup[b.brand_id] || b.brand_id,
        maxDiscountPct: b.max_discount_pct,
        dateFirstDetected: b.date_first_detected,
      }));

    const storesInSale = saleBrands.length;
    const densityPct = totalStores > 0 ? (storesInSale / totalStores) * 100 : 0;
    const avgDiscountPct = saleBrands.filter(b => b.maxDiscountPct).length > 0
      ? saleBrands.filter(b => b.maxDiscountPct).reduce((sum, b) => sum + b.maxDiscountPct, 0) / saleBrands.filter(b => b.maxDiscountPct).length
      : null;

    const topBrands = buildTopBrandsString(saleBrands);

    // Get current cycle state
    const peakState = peakDensityMap.get(centre.id) || {
      peak_date: null,
      peak_density_pct: null,
      last_density_pct: null,
      proactive_sent: false,
      reactive_sent: false,
    };

    const trajectory = getTrajectory(densityPct, peakState.last_density_pct);

    let phase, verdict, daysSincePeak;
    let shouldFireProactive = false;
    let shouldFireReactive = false;
    let reactiveType = null;

    // ── PHASE DETERMINATION ──────────────────────────────────────
    if (peakState.peak_date) {
      // We're in Phase 2 (already crossed 45% threshold)
      phase = 2;
      daysSincePeak = Math.floor((new Date(TODAY) - new Date(peakState.peak_date)) / (1000 * 60 * 60 * 24));
      verdict = getPhase2Verdict(daysSincePeak, densityPct, peakState.peak_density_pct);

      // Reactive notification: fires once if density drops 10%+ OR day 4+
      if (!peakState.reactive_sent) {
        if (verdict === VERDICTS.GOING_FAST || verdict === VERDICTS.FALLING_FAST) {
          shouldFireReactive = true;
          reactiveType = verdict === VERDICTS.FALLING_FAST ? 'REACTIVE_FALLING_FAST' : 'REACTIVE_GOING_FAST';
        } else if (daysSincePeak >= 4) {
          shouldFireReactive = true;
          reactiveType = 'REACTIVE_GOING_FAST';
        }
      }

      // Cycle reset: Picked Over + density drops below reset threshold
      if (verdict === VERDICTS.PICKED_OVER && densityPct < DORMANT_RESET_THRESHOLD) {
        console.log(`  ↩ ${centre.name}: cycle ended (Picked Over + density ${densityPct.toFixed(1)}% < ${DORMANT_RESET_THRESHOLD}%)`);
        peakDensityUpdates.push({
          centre_id: centre.id,
          peak_date: null,
          peak_density_pct: null,
          last_density_pct: densityPct,
          proactive_sent: false,
          reactive_sent: false,
          cycle_started_at: null,
          updated_at: new Date().toISOString(),
        });
        // Override verdict for today's score row
        verdict = VERDICTS.DORMANT;
        phase = 1;
        daysSincePeak = null;
      }

    } else {
      // Phase 1 — watching density build
      phase = 1;
      daysSincePeak = null;
      verdict = getPhase1Verdict(densityPct);

      // Cross the threshold → enter Phase 2
      if (densityPct >= PHASE1_TO_PHASE2_THRESHOLD) {
        phase = 2;
        daysSincePeak = 0;
        verdict = VERDICTS.PEAK_HARVEST;

        // Record peak date
        peakDensityUpdates.push({
          centre_id: centre.id,
          peak_date: TODAY,
          peak_density_pct: densityPct,
          last_density_pct: densityPct,
          proactive_sent: true, // Will be sent below
          reactive_sent: false,
          cycle_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        shouldFireProactive = true;
      }
    }

    // ── UPDATE PEAK DENSITY LOG (if not already queued above) ────
    if (!peakDensityUpdates.find(u => u.centre_id === centre.id)) {
      peakDensityUpdates.push({
        centre_id: centre.id,
        peak_date: peakState.peak_date,
        peak_density_pct: peakState.peak_density_pct,
        last_density_pct: densityPct, // Always update last seen density
        proactive_sent: shouldFireProactive ? true : peakState.proactive_sent,
        reactive_sent: shouldFireReactive ? true : peakState.reactive_sent,
        cycle_started_at: peakState.cycle_started_at,
        updated_at: new Date().toISOString(),
      });
    }

    // ── BUILD SCORE ROW ──────────────────────────────────────────
    scoreRows.push({
      centre_id: centre.id,
      score_date: TODAY,
      phase,
      verdict,
      density_pct: Math.round(densityPct * 100) / 100,
      stores_in_sale: storesInSale,
      total_stores: totalStores,
      days_since_peak: daysSincePeak,
      trajectory,
      avg_discount_pct: avgDiscountPct ? Math.round(avgDiscountPct * 100) / 100 : null,
      top_brands: topBrands || null,
    });

    // ── QUEUE NOTIFICATIONS ──────────────────────────────────────
    if (shouldFireProactive) {
      notificationRows.push({
        centre_id: centre.id,
        notification_type: 'PROACTIVE',
        verdict: VERDICTS.PEAK_HARVEST,
        message_text: buildNotificationCopy('PROACTIVE', centre.name, storesInSale, totalStores, topBrands, 0),
        density_pct: densityPct,
        top_brands: topBrands || null,
        processed: false,
      });
    }

    if (shouldFireReactive) {
      notificationRows.push({
        centre_id: centre.id,
        notification_type: 'REACTIVE',
        verdict,
        message_text: buildNotificationCopy(reactiveType, centre.name, storesInSale, totalStores, topBrands, daysSincePeak),
        density_pct: densityPct,
        top_brands: topBrands || null,
        processed: false,
      });
    }

    const icon = phase === 2 ? '🍎' : '🌱';
    console.log(`  ${icon} ${centre.name}: ${verdict} | ${storesInSale}/${totalStores} stores (${densityPct.toFixed(1)}%) | ${trajectory}`);
  }

  // 3. Write everything to Supabase
  console.log('\nWriting scores...');

  // Upsert score rows
  const { error: scoreError } = await supabase
    .from('centre_seer_scores')
    .upsert(scoreRows, { onConflict: 'centre_id,score_date' });

  if (scoreError) console.error('Score write error:', scoreError);
  else console.log(`  ✓ ${scoreRows.length} centre scores written`);

  // Upsert peak density log
  const { error: peakError } = await supabase
    .from('peak_density_log')
    .upsert(peakDensityUpdates, { onConflict: 'centre_id' });

  if (peakError) console.error('Peak density write error:', peakError);
  else console.log(`  ✓ ${peakDensityUpdates.length} peak density rows updated`);

  // Insert notification rows
  if (notificationRows.length > 0) {
    const { error: notifError } = await supabase
      .from('notification_log')
      .insert(notificationRows);

    if (notifError) console.error('Notification write error:', notifError);
    else console.log(`  ✓ ${notificationRows.length} notifications queued`);
  } else {
    console.log('  – No notifications to queue today');
  }

  console.log('\n✅ Scoring complete');
}

// Brand name lookup — populated from brands.js data
// (imported here to avoid circular deps)
import { brands } from './brands.js';
const brands_name_lookup = Object.fromEntries(brands.map(b => [b.id, b.name]));

calculateAllCentreScores().catch(err => {
  console.error('❌ Scorer failed:', err);
  process.exit(1);
});
