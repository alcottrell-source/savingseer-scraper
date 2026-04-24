import { createClient } from '@supabase/supabase-js';
import { brands } from './brands.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TODAY = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split('T')[0];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const brandNameLookup = Object.fromEntries(brands.map(b => [b.id, b.name]));

const PHASE_NUMBER = { Flat: 1, Turning: 1, Rising: 2, 'High Tide': 2, Falling: 2, Low: 1 };

function brandRipenessScore(daysRunning) {
  if (daysRunning <= 0) return 0;
  if (daysRunning <= 4)  return 10 + (daysRunning - 1) * 11.7;
  if (daysRunning <= 7)  return 46 + (daysRunning - 4) * 9;
  if (daysRunning <= 10) return 100;
  if (daysRunning <= 18) return Math.max(0, 100 - (daysRunning - 10) * 11.3);
  return 0;
}

function getTideStage(score, trajectory) {
  if (score === 0) {
    return { stage: 'Flat', verdict: 'Nothing on', bluf: 'No meaningful sales at this centre right now.' };
  }
  if (score < 25) {
    return { stage: 'Turning', verdict: 'Starting to build', bluf: 'A few brands are breaking into sale. Worth watching.' };
  }
  if (score < 50) {
    return { stage: 'Rising', verdict: 'Worth watching', bluf: 'Sales building and fresh. Plan your visit soon.' };
  }
  if (score < 75) {
    return { stage: 'High Tide', verdict: 'Go now', bluf: 'Maximum density, maximum freshness. This is the moment.' };
  }
  if (trajectory === 'RISING') {
    return { stage: 'High Tide', verdict: 'Go now', bluf: 'Maximum density, maximum freshness. This is the moment.' };
  }
  if (score < 90) {
    return { stage: 'Falling', verdict: 'Last chance', bluf: 'Tide going out. Go now or miss out.' };
  }
  return { stage: 'Low', verdict: "It's over", bluf: 'Cycle ended. Check back when brands start their next sale.' };
}

function getTrajectory(todayScore, yesterdayScore) {
  if (yesterdayScore === null || yesterdayScore === undefined) return 'HOLDING';
  const diff = todayScore - yesterdayScore;
  if (diff >= 2)  return 'RISING';
  if (diff <= -2) return 'DROPPING';
  return 'HOLDING';
}

async function calculateAllCentreScores() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Tide Scorer — ${TODAY}`);
  console.log('═══════════════════════════════════════════════');

  const [centresRes, centreBrandsRes, brandSaleRes, yesterdayRes] = await Promise.all([
    supabase.from('centres').select('*').eq('active', true),
    supabase.from('centre_brands').select('centre_id, brand_id').eq('present', true),
    supabase.from('brand_sale_events').select('brand_id, sale_status, date_first_detected, max_discount_pct, scraper_error'),
    supabase.from('centre_seer_scores').select('centre_id, tide_score').eq('score_date', YESTERDAY),
  ]);

  if (centresRes.error || centreBrandsRes.error || brandSaleRes.error) {
    console.error('Data load failed:', centresRes.error || centreBrandsRes.error || brandSaleRes.error);
    process.exit(1);
  }

  const brandSaleMap = new Map(brandSaleRes.data.map(b => [b.brand_id, b]));
  const yesterdayScoreMap = new Map((yesterdayRes.data || []).map(r => [r.centre_id, r.tide_score]));

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

    let totalRipeness = 0;
    let brandsOnSale = 0;
    const saleDetails = [];

    for (const brandId of brandIds) {
      const sale = brandSaleMap.get(brandId);

      if (!sale || sale.scraper_error || !sale.sale_status) continue;

      const daysRunning = sale.date_first_detected
        ? Math.floor((new Date(TODAY) - new Date(sale.date_first_detected)) / 86400000) + 1
        : 1;

      const ripeness = brandRipenessScore(daysRunning);
      totalRipeness += ripeness;
      brandsOnSale++;
      saleDetails.push({ name: brandNameLookup[brandId] || brandId, ripeness, maxDiscountPct: sale.max_discount_pct });
    }

    const tideScore = Math.round((totalRipeness / totalBrands) * 10) / 10;
    const trajectory = getTrajectory(tideScore, yesterdayScoreMap.get(centre.id) ?? null);
    const { stage, verdict, bluf } = getTideStage(tideScore, trajectory);

    const topBrands = saleDetails
      .sort((a, b) => b.ripeness - a.ripeness)
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

    const icons = { Flat: '⬜', Turning: '🔵', Rising: '📈', 'High Tide': '⭐', Falling: '⚠️', Low: '⬛' };
    console.log(`  ${icons[stage]} ${centre.name}: ${stage} (${tideScore}) | ${brandsOnSale}/${totalBrands} brands | ${trajectory}`);
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

  // Build tide history (up to 60 days) for each centre
  const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];

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

    await Promise.all(
      [...historyByCentre.entries()].map(([centreId, history]) =>
        supabase.from('centres').update({ tide_history: history }).eq('id', centreId)
      )
    );

    console.log(`  ✓ tide_history updated for ${historyByCentre.size} centres`);
  }

  console.log('\n✅ Scoring complete');
}

calculateAllCentreScores().catch(err => {
  console.error('❌ Scorer failed:', err);
  process.exit(1);
});
