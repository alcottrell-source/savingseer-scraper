// Reads the /tmp/centre-NN.txt files produced by fetch-centre-directories.mjs,
// normalises retailer names, and decides PRESENCE[brand_id][centre_idx] for
// each candidate brand. Writes:
//   /tmp/presence-matrix.json   { brandId: [30 ints], ... }
//   /tmp/presence-report.md     human-readable per-brand evidence trail
//
// The brand universe = existing brands.js B001..B094 MINUS 9 removals PLUS
// 9 candidates. The rule: presence>=2 → keep, otherwise drop.

import fs from 'fs/promises';

const REMOVALS = new Set(['B005','B006','B034','B035','B039','B040','B082','B087','B091']);

// Brand universe with aliases used to match against centre directories.
// canonical name first, then variants. Lowercased + normalised before match.
const BRAND_ALIASES = {
  // High Street
  B001: ['Next'],
  B002: ['M&S', 'Marks & Spencer', 'Marks and Spencer'],
  B003: ['River Island'],
  B004: ['New Look'],
  // B005..B006 removed
  B007: ['Evans'],
  B008: ['Bonmarche', 'Bon Marche', 'Bonmarché'],
  B009: ['Peacocks'],
  // Contemporary
  B011: ['Zara'],
  B012: ['H&M', 'HM', 'H and M'],
  B013: ['Mango'],
  B014: ['COS'],
  B015: ['Arket'],
  B016: ['& Other Stories', 'And Other Stories', 'Other Stories'],
  B017: ['Weekday'],
  B019: ['Hollister', 'Hollister Co'],
  B020: ['Abercrombie', 'Abercrombie & Fitch'],
  // Classic British
  B021: ['Fat Face', 'FatFace'],
  B022: ['Joules'],
  B023: ['White Stuff'],
  B024: ['Seasalt Cornwall', 'Seasalt'],
  B025: ['Crew Clothing', 'Crew Clothing Co'],
  B026: ['Boden'],
  B027: ['Hobbs'],
  B028: ['The White Company', 'White Company'],
  B029: ['Barbour'],
  B030: ['Cath Kidston'],
  // Smart/Occasion
  B031: ['Phase Eight'],
  B032: ['Whistles'],
  B033: ['Reiss'],
  // B034..B035 removed
  B036: ['Coast'],
  B037: ['Monsoon'],
  B038: ['Accessorize'],
  // B039..B040 removed
  // Premium Casual
  B041: ['Sweaty Betty'],
  B042: ['Lululemon'],
  B043: ['Superdry'],
  B044: ['Jack Wills'],
  B045: ['Hackett', 'Hackett London'],
  B046: ['Ralph Lauren', 'Polo Ralph Lauren'],
  B047: ['Tommy Hilfiger', 'Tommy'],
  B048: ['Lacoste'],
  B049: ['Hugo Boss', 'Boss', 'BOSS'],
  B050: ['Levis', "Levi's", 'Levi Strauss'],
  // Active
  B051: ['Nike'],
  B052: ['Adidas'],
  B053: ['The North Face', 'North Face'],
  B054: ['Berghaus'],
  B055: ['Columbia', 'Columbia Sportswear'],
  B056: ['Patagonia'],
  B057: ['Timberland'],
  B058: ['Craghoppers'],
  B059: ['Regatta'],
  B060: ['Mountain Warehouse'],
  // Footwear
  B061: ['Schuh'],
  B062: ['Dune London', 'Dune'],
  B063: ['Office', 'Office Shoes'],
  B064: ['Clarks'],
  B065: ['Kurt Geiger'],
  B066: ['Skechers'],
  B067: ['UGG', 'Ugg Australia'],
  B069: ['New Balance'],
  B070: ['FLANNELS', 'Flannels'],
  // Accessories
  B071: ['Pandora'],
  B072: ['Fossil'],
  B073: ['Swarovski'],
  B074: ['Radley', 'Radley London'],
  B075: ['Flying Tiger', 'Flying Tiger Copenhagen'],
  B076: ['Lush'],
  B077: ['John Lewis', 'John Lewis & Partners'],
  // ManualCheck — kept
  B078: ['AllSaints', 'All Saints'],
  B079: ['Ann Summers'],
  B080: ['Boux Avenue'],
  B081: ['Bravissimo'],
  // B082 removed
  B083: ['Calvin Klein', 'CK'],
  B084: ['French Connection', 'FCUK'],
  B085: ['Gant'],
  B086: ['Jack & Jones', 'Jack and Jones', 'JACK & JONES'],
  // B087 removed
  B088: ['Jigsaw'],
  B089: ['LK Bennett', 'L.K.Bennett', 'L K Bennett'],
  B090: ['Mint Velvet'],
  // B091 removed
  B092: ['Primark'],
  B093: ['Uniqlo'],
  B094: ['Foot Locker', 'Footlocker'],
  // ── Candidates (will be allocated B095+ if they pass) ──
  C_DIESEL:           ['Diesel'],
  C_BERSHKA:          ['Bershka'],
  C_JD_SPORTS:        ['JD Sports', 'JD', 'JD Sport'],
  C_SPORTS_DIRECT:    ['Sports Direct', 'SportsDirect', 'Sports Direct.com'],
  C_TRESPASS:         ['Trespass'],
  C_FOOTASYLUM:       ['Footasylum'],
  C_URBAN_OUTFITTERS: ['Urban Outfitters', 'UO'],
  C_VICTORIAS_SECRET: ["Victoria's Secret", 'Victorias Secret', 'Victoria Secret'],
  C_PULL_AND_BEAR:    ['Pull&Bear', 'Pull & Bear', 'Pull and Bear'],
};

function normalise(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[&]/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(store|stores|shop|shops|uk|london|outlet|express|local|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeMatcher(aliases) {
  const tokens = aliases.map(normalise).filter(Boolean);
  return (haystackNorm) => tokens.some(t => {
    if (!t) return false;
    // word-boundary match: t must appear as a discrete token sequence in haystack
    const re = new RegExp('(^|\\s)' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
    return re.test(haystackNorm);
  });
}

async function main() {
  const centreLines = [];
  for (let i = 0; i < 30; i++) {
    const padded = String(i).padStart(2, '0');
    try {
      const raw = await fs.readFile(`/tmp/centre-${padded}.txt`, 'utf8');
      const lines = raw.split('\n')
        .filter(l => l && !l.startsWith('#'))
        .map(normalise)
        .filter(Boolean);
      centreLines.push(new Set(lines));
    } catch (e) {
      console.error(`MISSING /tmp/centre-${padded}.txt — treating as empty`);
      centreLines.push(new Set());
    }
  }

  const matrix = {};
  const report = ['# Presence matrix evidence report\n'];
  for (const [bid, aliases] of Object.entries(BRAND_ALIASES)) {
    const match = makeMatcher(aliases);
    const row = new Array(30).fill(0);
    const hits = [];
    for (let i = 0; i < 30; i++) {
      const present = [...centreLines[i]].some(line => match(line));
      if (present) { row[i] = 1; hits.push(i); }
    }
    matrix[bid] = row;
    const total = row.reduce((a, b) => a + b, 0);
    report.push(`- **${bid}** (${aliases[0]}) — presence=${total} at centres ${hits.join(',') || '(none)'}`);
  }

  await fs.writeFile('/tmp/presence-matrix.json', JSON.stringify(matrix, null, 2));
  await fs.writeFile('/tmp/presence-report.md', report.join('\n') + '\n');
  console.log('Wrote /tmp/presence-matrix.json and /tmp/presence-report.md');

  // Console summary
  console.log('\n=== brands by presence count ===');
  const ranked = Object.entries(matrix).map(([bid, row]) => [bid, row.reduce((a,b)=>a+b,0), BRAND_ALIASES[bid][0]]).sort((a,b)=>b[1]-a[1]);
  for (const [bid, n, name] of ranked) console.log(`${bid.padEnd(20)} ${String(n).padStart(3)}  ${name}`);

  console.log('\n=== brands that would be REMOVED (presence < 2) ===');
  for (const [bid, n, name] of ranked) if (n < 2 && !REMOVALS.has(bid)) console.log(`${bid.padEnd(20)} ${String(n).padStart(3)}  ${name}`);
}

main().catch(e => { console.error(e); process.exit(1); });
