// Gravity Engine — pure confidence & freshness scoring over verified sale state.
// Reference implementation of ADR-001 (docs/architecture/gravity-engine.md).
//
// Flag, never mutate: nothing here writes anywhere or changes any public
// number (DECISIONS.md D5). Inputs are plain objects (see ADR-001 §4.1);
// persistence and UI are execution-phase glue:
//   TODO(ADR-001 §9.1): admin.html re-verify queue panel calls buildReverifyQueue.
//   TODO(ADR-001 §9.2): gravity pass in score.js persists brandConfidence +
//                       centreGravity per day (brand_gravity table migration).
//   TODO(ADR-001 §9.3): index.html centre honesty cue reads the persisted
//                       freshShare/meanConfidence.

export const GRAVITY = {
  GRACE_DAYS: 7,          // weekly cadence is normal (D9): ≤7d unverified = full confidence
  HALF_LIFE_DAYS: 7,      // halves each week past grace → 0.5 at 14d (D9 red-zone boundary)
  REPORT_WINDOW_DAYS: 14, // reports older than this are ignored
  REPORT_RECENCY_TAU: 7,  // a report's weight halves per week of age
  CONTRA_FACTOR: 0.4,     // one fresh contradiction cuts confidence to 40%
  CONTRA_FRESH_DAYS: 7,   // contradictions this recent pin to the top queue tier
  CONF_FLOOR: 0.02,       // never 0 — the state is still admin-asserted (D5)
  SOURCE_WEIGHT: { admin: 1, crowd: 1, scraper: 0.5 }, // scraper reserved (D1)
  OFF_SALE_IMPACT: 0.4,   // wrong "off sale" matters less — except the missed-sale override
  BAND_FRESH_MIN: 0.75,
  BAND_AGING_MIN: 0.5,
};

// Whole UTC days from `from` (YYYY-MM-DD or ISO timestamp) to `to`.
export function daysBetween(from, to) {
  const f = Date.parse(String(from).slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(String(to).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
  return Math.round((t - f) / 86400000);
}

// Age-decay component alone (ADR-001 §5.3). null anchor → null.
export function ageConfidence(daysSinceVerified, C = GRAVITY) {
  if (daysSinceVerified == null) return null;
  const age = Math.max(0, daysSinceVerified); // clamp future-dated anchors (E2)
  if (age <= C.GRACE_DAYS) return 1;
  return Math.pow(2, -(age - C.GRACE_DAYS) / C.HALF_LIFE_DAYS);
}

// Report type × current public state → evidence kind (ADR-001 §5.2).
// Returns 'corroborate' | 'contradict' | null (unknown type).
export function classifyReport(reportType, onSale) {
  switch (reportType) {
    case 'sale_active_confirmed': return onSale ? 'corroborate' : 'contradict';
    case 'sale_started':          return onSale ? 'corroborate' : 'contradict'; // off-sale: missed sale (E4)
    case 'sale_ended':            return onSale ? 'contradict'  : 'corroborate';
    case 'no_sale_confirmed':     return onSale ? 'contradict'  : 'corroborate';
    case 'discount_different':    return 'contradict'; // data wrong either way
    default: return null;
  }
}

function bandFor(confidence, C) {
  if (confidence == null) return 'unknown';
  if (confidence >= C.BAND_FRESH_MIN) return 'fresh';
  if (confidence >= C.BAND_AGING_MIN) return 'aging';
  return 'red';
}

// Core per-brand scoring (ADR-001 §5.3). Pure.
// input: BrandGravityInput (ADR-001 §4.1); today: YYYY-MM-DD.
export function brandConfidence(input, today, C = GRAVITY) {
  const {
    brandId, onSale,
    lastVerifiedDate = null, cycleStartDate = null,
    presenceCount = 0, reports = [],
  } = input;

  const reasons = [];
  // E1: opening a cycle WAS a verification — fall back to its start date.
  const anchorDate = lastVerifiedDate ?? cycleStartDate ?? null;
  const daysSinceVerified = anchorDate != null ? Math.max(0, daysBetween(anchorDate, today) ?? 0) : null;
  const ageConf = ageConfidence(daysSinceVerified, C);

  // Recency-weighted evidence sums over in-window reports.
  let Wc = 0, Wx = 0, hasFreshContradiction = false;
  for (const r of reports) {
    const age = daysBetween(r.createdAt, today);
    if (age == null || age < 0 || age > C.REPORT_WINDOW_DAYS) continue; // E7
    const kind = classifyReport(r.reportType, onSale);
    if (!kind) continue;
    const w = (C.SOURCE_WEIGHT[r.source ?? 'crowd'] ?? 1) * Math.pow(2, -age / C.REPORT_RECENCY_TAU);
    if (kind === 'corroborate') Wc += w;
    else {
      Wx += w;
      if (age <= C.CONTRA_FRESH_DAYS) hasFreshContradiction = true;
    }
  }

  let confidence = null;
  if (ageConf == null && Wc === 0 && Wx === 0) {
    // E3: never-verified, no crowd signal — genuinely unknown.
    reasons.push('never verified');
  } else {
    // Never-verified but crowd-signalled starts from coin-flip belief so the
    // evidence has something to move (E4 relies on Wx crushing this).
    let conf = ageConf ?? 0.5;
    if (ageConf == null) reasons.push('never verified — crowd signal only');
    // Corroboration lifts toward 1 (diminishing), THEN contradiction
    // multiplies down so it dominates at equal weight (E6).
    conf = conf + (1 - conf) * (1 - Math.pow(2, -Wc));
    conf = conf * Math.pow(C.CONTRA_FACTOR, Wx);
    confidence = Math.max(C.CONF_FLOOR, conf);
  }

  if (daysSinceVerified != null) {
    reasons.push(daysSinceVerified <= C.GRACE_DAYS
      ? `verified ${daysSinceVerified}d ago`
      : `unverified for ${daysSinceVerified}d`);
  }
  if (Wc > 0) reasons.push(`crowd-corroborated (weight ${Wc.toFixed(2)})`);
  if (Wx > 0) reasons.push(`crowd-contradicted (weight ${Wx.toFixed(2)})`);
  if (!onSale && hasFreshContradiction) reasons.push('possible missed sale');

  return {
    brandId, onSale, anchorDate, daysSinceVerified,
    ageConfidence: ageConf, confidence,
    band: bandFor(confidence, C),
    corroborationWeight: Wc, contradictionWeight: Wx,
    hasFreshContradiction,
    presenceCount,
    reasons,
  };
}

// Re-verify priority (ADR-001 §5.4). Pure.
export function reverifyPriority(conf, C = GRAVITY) {
  let impact = conf.presenceCount * (conf.onSale ? 1 : C.OFF_SALE_IMPACT);
  // Missed-sale override (D12): an off-sale brand the crowd says IS on sale
  // is a cycle we're failing to record — full impact.
  if (!conf.onSale && conf.hasFreshContradiction) impact = conf.presenceCount;
  const belief = conf.confidence ?? 0.5; // unknown ≈ coin-flip, not evidence of error
  return (1 - belief) * impact;
}

// Sorted admin queue: fresh contradictions first, then priority, then id.
// Zero-priority brands (e.g. presence 0 — E8) are dropped.
export function buildReverifyQueue(inputs, today, C = GRAVITY) {
  return inputs
    .map(i => {
      const conf = brandConfidence(i, today, C);
      return { ...conf, priority: reverifyPriority(conf, C) };
    })
    .filter(e => e.priority > 0 || e.hasFreshContradiction)
    .sort((a, b) =>
      (Number(b.hasFreshContradiction) - Number(a.hasFreshContradiction)) ||
      (b.priority - a.priority) ||
      a.brandId.localeCompare(b.brandId));
}

// Centre aggregates over its ON-SALE brands (they carry the public claim).
// brandConfs: BrandConfidence[] for the brands on sale at this centre.
export function centreGravity(centreId, brandConfs, C = GRAVITY) {
  const onSale = brandConfs.filter(b => b.onSale);
  const known = onSale.filter(b => b.confidence != null);
  const fresh = onSale.filter(b => b.daysSinceVerified != null && b.daysSinceVerified <= C.GRACE_DAYS);
  return {
    centreId,
    onSaleBrands: onSale.length,
    meanConfidence: known.length
      ? known.reduce((s, b) => s + b.confidence, 0) / known.length
      : null,
    freshShare: onSale.length ? fresh.length / onSale.length : null,
    redCount: onSale.filter(b => b.band === 'red').length,
    unknownCount: onSale.filter(b => b.band === 'unknown').length,
  };
}
