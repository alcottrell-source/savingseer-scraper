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

    const tideScore = Math.round((totalRipeness / totalBrands) * 10) /
