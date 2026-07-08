// Personalisation ranking — the single follows-first formula for the live
// feed (browser) and the daily history pass (score.js).
// Reference implementation of ADR-003 (docs/architecture/personalisation-ranking.md).
//
// Execution-phase glue (NOT here):
//   TODO(ADR-003 §8.1): additive migration — personal_tide_scores.basis.
//   TODO(ADR-003 §8.2): score.js calculatePersonalScores imports resolveLens/
//                       buildPersonalRow/personalVerdict; delete its private
//                       brandMatchesPrefs.
//   TODO(ADR-003 §8.3): index.html inlines these functions between
//                       /* SYNC-START lib/personal-rank.js */ … /* SYNC-END */
//                       markers (single-file app, no build step) and replaces
//                       the bespoke personal branch of getHotCentres.

export const RANK = {
  FRESH_TAU_DAYS: 5,          // echoes FRESH_WINDOW_DAYS in the Newest Sales panel
  // Personal verdict thresholds — density-only vocabulary (ADR-003 §5.4).
  PEAK_MIN: 40,               // mirrors HIGH_TIDE_ENTER
  RISING_MIN: 15,             // mirrors RISING_FLOOR
  // Global-lens verdict severity, mirroring index.html's HOT_VERDICT_SEVERITY.
  SEVERITY: { PEAK: 5, RISING: 4, EASING: 3, QUIET: 2, OVER: 1 },
};

// Prefs matching — promoted verbatim from score.js (ADR-003 §5.3): gender
// overlap required; if the user picked style clusters, the brand's cluster
// must be one of them.
export function brandMatchesPrefs(brand, prefs) {
  const genderMatch =
    (prefs.womenswear && brand.womenswear) ||
    (prefs.menswear && brand.menswear) ||
    (prefs.childrenswear && brand.childrenswear);
  if (!genderMatch) return false;
  if (prefs.style_clusters && prefs.style_clusters.length > 0) {
    if (!prefs.style_clusters.includes(brand.cluster)) return false;
  }
  return true;
}

// Cold-start hierarchy (ADR-003 §5.1): follows → prefs-matched set → global.
// prefs may be null/undefined (logged out, RLS hiccup) — degrades to global.
export function resolveLens(prefs, allBrands) {
  if (prefs && Array.isArray(prefs.brand_ids) && prefs.brand_ids.length >= 1) {
    return { basis: 'follows', brandIds: new Set(prefs.brand_ids) };
  }
  const hasPrefSignal = !!prefs && (
    prefs.womenswear || prefs.menswear || prefs.childrenswear ||
    (Array.isArray(prefs.style_clusters) && prefs.style_clusters.length > 0));
  if (hasPrefSignal) {
    const matched = (allBrands || []).filter(b => brandMatchesPrefs(b, prefs));
    if (matched.length >= 1) {
      return { basis: 'prefs', brandIds: new Set(matched.map(b => b.id)) };
    }
  }
  return { basis: 'global' }; // E5: zero-match prefs degrade to global, never an empty feed
}

// Freshness of one on-sale brand (ADR-003 §5.2): a sale that started OR
// deepened recently is fresh; null dates contribute 0 (E4 — a data gap must
// not zero the centre out).
export function brandFreshness(brand, C = RANK) {
  const ages = [brand.daysSinceStart, brand.daysSincePctChange]
    .filter(a => a != null && Number.isFinite(a) && a >= 0);
  if (!ages.length) return 0;
  return Math.pow(2, -Math.min(...ages) / C.FRESH_TAU_DAYS);
}

// One centre through the personal lens. brands: BrandAtCentre[] (ADR-003
// §4). Returns PersonalRow, or null when no followed brand is present (E1).
export function buildPersonalRow(centre, brands, brandIds, C = RANK) {
  let myPresent = 0, myOnSale = 0, maxPct = null, freshness = 0;
  const onSaleBrandNames = [];
  const seen = new Set(); // E6: dedupe defensively even if the caller didn't
  for (const b of brands) {
    if (!brandIds.has(b.brandId) || !b.present || seen.has(b.brandId)) continue;
    seen.add(b.brandId);
    myPresent++;
    if (!b.onSale) continue;
    myOnSale++;
    onSaleBrandNames.push(b.name);
    freshness += brandFreshness(b, C);
    if (b.maxPct != null && Number.isFinite(b.maxPct)) {
      maxPct = maxPct == null ? b.maxPct : Math.max(maxPct, b.maxPct);
    }
  }
  if (myPresent === 0) return null;
  return {
    centreId: centre.centreId, name: centre.name,
    myPresent, myOnSale,
    personalPct: Math.round((myOnSale / myPresent) * 100),
    maxPct, freshness, onSaleBrandNames,
  };
}

// Personal feed ordering (ADR-003 §3). Only centres where ≥1 of your shops
// is on sale qualify (E2 — the hero shows "0 of your M", the feed does not).
export function rankPersonalFeed(rows) {
  return rows
    .filter(r => r && r.myOnSale >= 1)
    .slice()
    .sort((a, b) =>
      (b.myOnSale - a.myOnSale) ||
      (b.freshness - a.freshness) ||
      ((b.maxPct ?? -1) - (a.maxPct ?? -1)) ||   // E3: null % sorts below any number
      (b.personalPct - a.personalPct) ||
      a.name.localeCompare(b.name));             // E7: total, deterministic order
}

// Global lens ordering — parity with the shipped getHotCentres global branch:
// tide_score desc → verdict severity desc → name asc.
// rows: { name, tideScore, verdictWord }.
export function rankGlobalFeed(rows, C = RANK) {
  return rows.slice().sort((a, b) =>
    (b.tideScore - a.tideScore) ||
    ((C.SEVERITY[b.verdictWord] || 0) - (C.SEVERITY[a.verdictWord] || 0)) ||
    a.name.localeCompare(b.name));
}

// Personal verdict — density-only vocabulary (ADR-003 §5.4). Per-user rows
// have no history/hysteresis, so lifecycle words (Easing/Over) are forbidden:
// this function CANNOT emit them.
export function personalVerdict(personalPct, C = RANK) {
  if (personalPct >= C.PEAK_MIN) return 'Peak';
  if (personalPct >= C.RISING_MIN) return 'Rising';
  return 'Quiet';
}

// Daily history row for the repurposed personal_tide_scores table (ADR-003
// §5.5). Returns null for global-lens users (nothing personal to record).
export function buildHistoryRow(userId, scoreDate, lens, centre, brands, C = RANK) {
  if (!lens || lens.basis === 'global') return null;
  const row = buildPersonalRow(centre, brands, lens.brandIds, C);
  if (!row) return null; // E1: none of their brands present here
  return {
    user_id: userId,
    centre_id: centre.centreId,
    score_date: scoreDate,
    personal_tide_score: row.personalPct,
    matching_brands: row.myPresent,
    matching_on_sale: row.myOnSale,
    verdict: personalVerdict(row.personalPct, C),
    basis: lens.basis,
  };
}
