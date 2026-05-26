// Generates the final BRANDS array, PRESENCE object, and migration SQL
// blocks from /tmp/presence-matrix.json + brands.js + candidate config.
//
// Outputs to /tmp/final/:
//   brands-array.js          — replacement BRANDS array literal (paste-ready)
//   presence-object.js       — replacement PRESENCE object literal (paste-ready)
//   brands-js-additions.js   — appended brand configs for brands.js
//   migration-a.sql          — centre_brands upsert
//   migration-b.sql          — new brand inserts + their centre_brands rows
//   report.md                — human-readable per-brand table

import fs from 'fs/promises';
import path from 'path';

const matrix = JSON.parse(await fs.readFile('/tmp/presence-matrix.json', 'utf8'));
const candidates = JSON.parse(await fs.readFile(new URL('./candidate-brands-config.json', import.meta.url), 'utf8')).candidates;

// Import existing brands from brands.js source (string parse to avoid
// importing the file as a module).
const brandsSrc = await fs.readFile(new URL('../brands.js', import.meta.url), 'utf8');

// Parse each brand object literal — minimal parser. Each entry begins with
// `{` and ends with `},` followed by a newline.
function parseBrandsArray(src) {
  const start = src.indexOf('export const brands = [');
  const end = src.indexOf('];', start);
  const body = src.slice(start, end);
  const out = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*cluster:\s*'([^']+)',\s*womenswear:\s*(true|false),\s*menswear:\s*(true|false),\s*childrenswear:\s*(true|false),[^]*?\}/g;
  let m;
  while ((m = re.exec(body))) {
    const block = m[0];
    const manualCheck = /manualCheck:\s*true/.test(block);
    out.push({
      id: m[1], name: m[2], cluster: m[3],
      womenswear: m[4] === 'true', menswear: m[5] === 'true', childrenswear: m[6] === 'true',
      manualCheck,
      raw: block,
    });
  }
  return out;
}

const REMOVALS = new Set(['B005','B006','B034','B035','B039','B040','B082','B087','B091']);
const existing = parseBrandsArray(brandsSrc);

// Surviving brands sorted by id; we mirror brands.js order in the inline
// BRANDS array so future audits map line-for-line.
const survivors = existing.filter(b => !REMOVALS.has(b.id));

// Apply the rule: surviving brand with sum(PRESENCE) < 2 → drop.
const kept = [];
const dropped = [];
for (const b of survivors) {
  const row = matrix[b.id] || new Array(30).fill(0);
  const sum = row.reduce((a, c) => a + c, 0);
  if (sum < 2) dropped.push({ ...b, presence: row, sum });
  else kept.push({ ...b, presence: row, sum });
}

// Candidates: keep if presence>=2. Assign B095, B096, … in candidate order.
let nextId = 95;
const added = [];
const droppedCandidates = [];
for (const c of candidates) {
  const row = matrix[c.key] || new Array(30).fill(0);
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum < 2) { droppedCandidates.push({ ...c, presence: row, sum }); continue; }
  const id = 'B' + String(nextId++).padStart(3, '0');
  added.push({
    id, name: c.name, cluster: c.cluster,
    womenswear: c.womenswear, menswear: c.menswear, childrenswear: c.childrenswear,
    manualCheck: !!c.manualCheck, url: c.url, renderMode: c.renderMode,
    presence: row, sum,
  });
}

const survivorsFinal = [...kept, ...added];

// ─── Format BRANDS array literal ────────────────────────────────────────────
function fmtBrandsArrayLine(b) {
  return `  {id:'${b.id}',name:${JSON.stringify(b.name)},cluster:'${b.cluster}',womenswear:${b.womenswear},menswear:${b.menswear},childrenswear:${b.childrenswear}},`;
}
const brandsArrayText = 'const BRANDS = [\n' + survivorsFinal.map(fmtBrandsArrayLine).join('\n') + '\n];';

// ─── Format PRESENCE object literal ─────────────────────────────────────────
function fmtPresenceLine(b) {
  return `  ${b.id}:[${b.presence.join(',')}],`;
}
const presenceText = 'const PRESENCE = {\n' + survivorsFinal.map(fmtPresenceLine).join('\n') + '\n};';

// ─── Format brands.js additions ─────────────────────────────────────────────
function fmtBrandsJsBlock(b) {
  if (b.manualCheck) {
    return `  {
    id: '${b.id}', name: ${JSON.stringify(b.name)}, cluster: '${b.cluster}',
    womenswear: ${b.womenswear}, menswear: ${b.menswear}, childrenswear: ${b.childrenswear},
    manualCheck: true, url: '${b.url}',
  },`;
  }
  return `  {
    id: '${b.id}', name: ${JSON.stringify(b.name)}, cluster: '${b.cluster}',
    womenswear: ${b.womenswear}, menswear: ${b.menswear}, childrenswear: ${b.childrenswear},
    renderMode: '${b.renderMode || 'static'}',
    url: '${b.url}',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },`;
}
const brandsJsAdditionsText = added.map(fmtBrandsJsBlock).join('\n');

// ─── Centre name list (matches CENTRE_NAMES in index.html, used in SQL) ────
const CENTRE_NAMES = [
  'Festival Place','Westquay','Westfield London','Westfield Stratford',
  'Trafford Centre','Metrocentre','Bluewater','Meadowhall',
  'Bullring','Lakeside','Liverpool ONE',"St David's",
  'Cabot Circus','Arndale','Brent Cross','Victoria Leeds',
  'Eldon Square','The Oracle','The Lexicon','Friars Walk',
  'Queensgate','Broadmead','Highcross','Touchwood',
  'Bentall Centre','White Rose','Cribbs Causeway','Braehead',
  'Silverburn','St James Quarter',
];
// Aliases used in the existing John Lewis migration — keep matching liberal so
// 'The Bentall Centre' or 'Manchester Arndale' resolve. Each entry is a list of
// names; the migration ORs across them.
const CENTRE_NAME_ALTS = {
  13: ['Arndale', 'Manchester Arndale'],
  24: ['Bentall Centre', 'The Bentall Centre'],
};
function sqlNameList(idx) {
  const alts = CENTRE_NAME_ALTS[idx] || [CENTRE_NAMES[idx]];
  return alts.map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
}

// ─── Migration A: rebuild centre_brands for survivors ───────────────────────
// We emit UPSERTs of present=true for each (centre, brand) pair where
// presence=1, and present=false where presence=0. Removed brand_ids are NOT
// touched — historical rows stay intact.
const sqlAStmts = [
  '-- Migration: rebuild centre_brands from the May 2026 presence audit.',
  '-- For every (centre, brand) pair in the new matrix, set present= true/false.',
  '-- Removed brands (B005,B006,B034,B035,B039,B040,B082,B087,B091) are NOT',
  '-- referenced — their historical centre_brands rows are preserved.',
  '-- Idempotent: safe to re-run.',
  '',
];

for (const b of survivorsFinal) {
  const present = [];
  const absent = [];
  for (let i = 0; i < 30; i++) (b.presence[i] === 1 ? present : absent).push(i);
  if (present.length) {
    const names = [...new Set(present.flatMap(i => (CENTRE_NAME_ALTS[i] || [CENTRE_NAMES[i]])))]
      .map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
    sqlAStmts.push(
      `INSERT INTO centre_brands (centre_id, brand_id, present)`,
      `SELECT c.id, '${b.id}', true FROM centres c WHERE c.name IN (${names})`,
      `ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;`,
      '',
    );
  }
  if (absent.length) {
    const names = [...new Set(absent.flatMap(i => (CENTRE_NAME_ALTS[i] || [CENTRE_NAMES[i]])))]
      .map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
    sqlAStmts.push(
      `INSERT INTO centre_brands (centre_id, brand_id, present)`,
      `SELECT c.id, '${b.id}', false FROM centres c WHERE c.name IN (${names})`,
      `ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;`,
      '',
    );
  }
}

const sqlAText = sqlAStmts.join('\n');

// ─── Migration B: insert new brand rows + centre_brands rows ───────────────
const sqlBStmts = [
  '-- Migration: insert new brand rows + their centre_brands presence.',
  '-- Run AFTER 20260525_rebuild_centre_brands.sql.',
  '-- Idempotent: safe to re-run.',
  '',
];

if (added.length) {
  sqlBStmts.push('INSERT INTO brands (id, name, cluster, womenswear, menswear, childrenswear, sale_url)');
  sqlBStmts.push('VALUES');
  const rows = added.map((b, i) => {
    const last = i === added.length - 1;
    const saleUrl = (b.url.endsWith('/') ? b.url + 'sale' : b.url + '/sale')
      .replace(/'/g, "''");
    return `  ('${b.id}', '${b.name.replace(/'/g, "''")}', '${b.cluster}', ${b.womenswear}, ${b.menswear}, ${b.childrenswear}, '${saleUrl}')${last ? '' : ','}`;
  });
  sqlBStmts.push(...rows);
  sqlBStmts.push('ON CONFLICT (id) DO NOTHING;');
  sqlBStmts.push('');
  // brand_sale_events rows so the admin console can show them
  const ids = added.map(b => `'${b.id}'`).join(',');
  sqlBStmts.push(
    'INSERT INTO brand_sale_events (brand_id, sale_status, scraper_error)',
    'SELECT b.id, FALSE, FALSE',
    'FROM brands b',
    `WHERE b.id IN (${ids})`,
    'AND NOT EXISTS (',
    '  SELECT 1 FROM brand_sale_events e WHERE e.brand_id = b.id',
    ');',
    '',
  );
  // centre_brands inserts for each new brand
  for (const b of added) {
    const present = [];
    const absent = [];
    for (let i = 0; i < 30; i++) (b.presence[i] === 1 ? present : absent).push(i);
    if (present.length) {
      const names = [...new Set(present.flatMap(i => (CENTRE_NAME_ALTS[i] || [CENTRE_NAMES[i]])))]
        .map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
      sqlBStmts.push(
        `INSERT INTO centre_brands (centre_id, brand_id, present)`,
        `SELECT c.id, '${b.id}', true FROM centres c WHERE c.name IN (${names})`,
        `ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;`,
        '',
      );
    }
  }
}
const sqlBText = sqlBStmts.join('\n');

// ─── Human-readable report ──────────────────────────────────────────────────
const reportLines = [
  '# Brand-presence rebuild report (' + new Date().toISOString().slice(0,10) + ')',
  '',
  '## Pre-verified removals (always dropped per handover)',
  '| ID | Name |',
  '|---|---|',
  ...['B005 Dorothy Perkins','B006 Wallis','B034 Ted Baker','B035 Karen Millen','B039 Oasis','B040 Warehouse','B082 Burton','B087 Jaeger','B091 Miss Selfridge'].map(s => `| ${s.split(' ')[0]} | ${s.slice(5)} |`),
  '',
  '## Surviving brands kept (presence ≥ 2)',
  '| ID | Name | Presence |',
  '|---|---|---|',
  ...kept.sort((a,b) => b.sum - a.sum).map(b => `| ${b.id} | ${b.name} | ${b.sum} |`),
  '',
  '## Surviving brands dropped by the rule (presence < 2)',
  '| ID | Name | Presence |',
  '|---|---|---|',
  ...dropped.sort((a,b) => b.sum - a.sum).map(b => `| ${b.id} | ${b.name} | ${b.sum} |`),
  '',
  '## New brands added (candidate → passed presence ≥ 2)',
  '| New ID | Name | Presence |',
  '|---|---|---|',
  ...added.map(b => `| ${b.id} | ${b.name} | ${b.sum} |`),
  '',
  '## Candidate brands dropped (presence < 2)',
  '| Candidate | Name | Presence |',
  '|---|---|---|',
  ...droppedCandidates.map(b => `| ${b.key} | ${b.name} | ${b.sum} |`),
  '',
  '## Notes',
  '- **TK Maxx** intentionally not added: the May 2026 scoring formula `brandsOnSale / totalBrands × 100` cannot honestly accommodate a permanent discounter (handover point 5).',
  '- Removed brands keep their historical `brands` and `brand_sale_events` rows in Supabase. Their `centre_brands` rows are also preserved.',
  '- Some sites were unreachable from the scrape window (Metrocentre 503, Silverburn parked-domain, Cribbs Causeway 503). Their rows fall back to Wikipedia-derived presence; spot-check before relying on them for marketing copy.',
  '',
];
const reportText = reportLines.join('\n');

// ─── Write outputs ──────────────────────────────────────────────────────────
const outDir = '/tmp/final';
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'brands-array.js'), brandsArrayText);
await fs.writeFile(path.join(outDir, 'presence-object.js'), presenceText);
await fs.writeFile(path.join(outDir, 'brands-js-additions.js'), brandsJsAdditionsText);
await fs.writeFile(path.join(outDir, 'migration-a.sql'), sqlAText);
await fs.writeFile(path.join(outDir, 'migration-b.sql'), sqlBText);
await fs.writeFile(path.join(outDir, 'report.md'), reportText);

console.log('=== summary ===');
console.log('kept (existing):', kept.length);
console.log('dropped (rule):', dropped.length, '→', dropped.map(b => `${b.id}(${b.sum})`).join(' '));
console.log('added (candidates):', added.length, '→', added.map(b => `${b.id} ${b.name}`).join(', '));
console.log('dropped candidates:', droppedCandidates.length, '→', droppedCandidates.map(b => `${b.key}(${b.sum})`).join(' '));
console.log('Wrote outputs to', outDir);
