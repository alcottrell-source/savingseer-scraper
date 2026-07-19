// brand-index.mjs
// Pure aggregation: per-centre shaped data -> one national record per brand,
// for the /brand/<slug> pages ("when does {brand} go on sale?" — the brand-only
// head query that the centre-scoped pages can't own). No DB access here;
// generate.mjs passes in the already-shaped centre list and renders the result.
//
// Sale cycles are brand-level (national) in the DB, so every centre carrying a
// brand fetched identical cycle rows — first occurrence wins, no merging needed.

import { slugify } from './render.mjs';

// shapedList: [{ centre: {slug,name,...}, brands: [shaped brand] }] — ONLY the
// centres that passed the "no data, no page" gate (their child pages exist, so
// the national page's centre links can never 404).
export function buildBrandIndex(shapedList) {
  const byId = new Map();
  for (const { centre, brands } of shapedList) {
    for (const b of brands) {
      let rec = byId.get(b.id);
      if (!rec) {
        rec = {
          id: b.id, name: b.name, cluster: b.cluster, saleUrl: b.saleUrl,
          sale: b.sale, cycle: b.cycle, cyclesRaw: b.cyclesRaw,
          onSale: b.onSale, hasPage: b.hasPage,
          centres: [],
        };
        byId.set(b.id, rec);
      }
      // Link only to child pages that were actually emitted (b.hasPage). The
      // brand is still listed as stocked at the centre either way.
      rec.centres.push({ slug: centre.slug, name: centre.name, childSlug: b.slug, hasChildPage: !!b.hasPage });
    }
  }

  // Stable national slugs: slugify(name) with global dedupe, same suffix rule
  // as the per-centre child slugs so collisions resolve predictably.
  const used = new Set();
  const out = [];
  for (const rec of byId.values()) {
    let slug = slugify(rec.name), n = 2;
    while (used.has(slug)) slug = `${slugify(rec.name)}-${n++}`;
    used.add(slug);
    rec.slug = slug;
    rec.centres.sort((a, b) => a.name.localeCompare(b.name));
    out.push(rec);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Same thin-page rule as the child pages: a national brand page only exists if
// the brand has a live sale or at least one tracked episode.
export function brandHasNationalPage(rec) {
  return !!(rec.onSale || (rec.cyclesRaw && rec.cyclesRaw.length > 0));
}

// The opt-in's centre_slug must be a REAL centre the brand is stocked at
// (seo_alert_signups.centre_slug is NOT NULL, and notify-high-tide pass 4
// drops brand rows whose centre doesn't stock the brand). First tracked
// centre alphabetically = stable, always stocked.
export function primaryCentreSlug(rec) {
  return rec.centres.length ? rec.centres[0].slug : null;
}
