// extract-floors.js
// Tide — one-off floor data extractor.
//
// For a single centre (or the full pilot set), fetches the centre's official
// directory page, asks Gemini 2.0 Flash-Lite to extract a {brand_id, floor}
// mapping from the HTML, and rewrites centre_brand_floors for that centre.
//
// Usage:
//   node extract-floors.js --centre westfield-london
//   node extract-floors.js --centre westfield-london --dry-run
//   node extract-floors.js --all          # every centre with directory_url set
//
// Not invoked by the daily cron — floor data is refreshed on demand. The
// dashboard falls back to the existing cluster grouping if a centre lacks
// floor data, so a missing or partial run never breaks the front-end.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { brands } from './brands.js';

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set — extractor cannot run');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genai    = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL          = 'gemini-2.0-flash-lite';
const MAX_HTML_BYTES = 120 * 1024;
const MIN_GAP_MS     = 5000;

const BRAND_NAME_BY_ID = Object.fromEntries(brands.map(b => [b.id, b.name]));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { centre: null, all: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--centre') args.centre = argv[++i];
    else if (a.startsWith('--centre=')) args.centre = a.slice('--centre='.length);
  }
  if (!args.centre && !args.all) {
    console.error('Usage: node extract-floors.js (--centre <id> | --all) [--dry-run]');
    process.exit(2);
  }
  return args;
}

// Strip <script>/<style> blocks and collapse whitespace to keep the prompt
// payload small. Most centre directories ship 500KB+ of inline JS we don't
// need; the structured store list is in the rendered DOM.
function trimHtml(html) {
  let trimmed = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length > MAX_HTML_BYTES) trimmed = trimmed.slice(0, MAX_HTML_BYTES);
  return trimmed;
}

const SYSTEM_PROMPT = `You extract store-floor mappings from UK shopping centre directory HTML.

You will be given:
- Centre name and directory URL
- An allow-list of brand_ids and their names — only emit these brand_ids
- Trimmed HTML of the directory page

Return JSON ONLY in this shape:
{ "stores": [
    { "brand_id": "B011", "floor_label": "Upper Mall", "floor_order": 1, "unit_code": "U2-145" }
] }

Rules:
- Only include brand_ids from the allow-list. Drop any brand whose name doesn't appear on the page.
- floor_label: use the centre's own wording verbatim (e.g. "Ground", "Upper Mall", "Lower Mall", "The Loft", "Level -1"). Don't normalise.
- floor_order: integer, used for sorting only. -1 for lower/basement levels, 0 for ground, 1 for first/upper, 2 for second/top. If a centre has multiple lower or upper levels, space them: -2, -1, 0, 1, 2.
- If a brand is on two floors (anchor tenants often span levels), emit two rows — one per floor.
- unit_code: include if visible on the page (e.g. "U2-145", "Unit 23"); otherwise null.
- Never invent a floor. If a brand appears in the allow-list but you can't find its floor in the HTML, omit it.
- Output ONLY the JSON object — no preamble, no code fences, no commentary.`;

function buildUserMessage(centre, allowList, html) {
  const allowListLines = allowList
    .map(b => `${b.brand_id}: ${b.brand_name}`)
    .join('\n');
  return [
    `Centre: ${centre.name}`,
    `Directory URL: ${centre.directory_url}`,
    '',
    'Allow-list (brand_id: name):',
    allowListLines,
    '',
    'HTML (trimmed):',
    html,
    '',
    'Return JSON only.',
  ].join('\n');
}

function parseModelResponse(text) {
  if (!text) return [];
  // Defensive: strip code fences if the model adds them despite instructions.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('  ✗ model returned non-JSON:', cleaned.slice(0, 200));
    return [];
  }
  return Array.isArray(parsed?.stores) ? parsed.stores : [];
}

function validateRow(row, allowSet, sourceUrl) {
  if (!row || typeof row !== 'object') return null;
  const brand_id = String(row.brand_id || '').trim();
  if (!brand_id || !allowSet.has(brand_id)) return null;
  const floor_label = String(row.floor_label || '').trim();
  if (!floor_label) return null;
  const floor_order = Number.isFinite(+row.floor_order) ? Math.trunc(+row.floor_order) : 0;
  const unit_code = row.unit_code ? String(row.unit_code).trim().slice(0, 32) : null;
  return {
    brand_id,
    floor_label: floor_label.slice(0, 64),
    floor_order,
    unit_code,
    source_url: sourceUrl,
  };
}

async function processCentre(centre, opts) {
  console.log(`\n── ${centre.name} (${centre.id}) ──`);
  console.log(`   directory: ${centre.directory_url}`);

  const { data: cbRows, error: cbErr } = await supabase
    .from('centre_brands')
    .select('brand_id')
    .eq('centre_id', centre.id)
    .eq('present', true);
  if (cbErr) {
    console.error('  ✗ centre_brands load failed:', cbErr.message);
    return;
  }
  const allowList = (cbRows || [])
    .map(r => ({ brand_id: r.brand_id, brand_name: BRAND_NAME_BY_ID[r.brand_id] || r.brand_id }))
    .filter(r => r.brand_name);
  if (!allowList.length) {
    console.log('  · no centre_brands rows for this centre, skipping');
    return;
  }
  const allowSet = new Set(allowList.map(b => b.brand_id));
  console.log(`   centre has ${allowList.length} known brands`);

  let html;
  try {
    const resp = await fetch(centre.directory_url, {
      headers: { 'user-agent': 'tide-floor-extractor/1.0 (+https://tide.savingseer.co.uk)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    console.error(`  ✗ fetch failed: ${err.message}`);
    return;
  }
  const trimmed = trimHtml(html);
  console.log(`   fetched ${html.length} bytes, trimmed to ${trimmed.length}`);

  let rawText;
  try {
    const resp = await genai.models.generateContent({
      model: MODEL,
      contents: buildUserMessage(centre, allowList, trimmed),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });
    rawText = resp.text || '';
  } catch (err) {
    console.error(`  ✗ Gemini call failed: ${err.message || err}`);
    return;
  }

  const stores = parseModelResponse(rawText);
  const validated = [];
  const seen = new Set(); // dedupe (brand_id, floor_label)
  for (const row of stores) {
    const v = validateRow(row, allowSet, centre.directory_url);
    if (!v) continue;
    const key = v.brand_id + '|' + v.floor_label;
    if (seen.has(key)) continue;
    seen.add(key);
    validated.push(v);
  }

  const matchedBrandIds = new Set(validated.map(v => v.brand_id));
  const coverage = matchedBrandIds.size;
  const total = allowList.length;
  console.log(`   matched ${coverage}/${total} brands (${validated.length} floor rows)`);
  if (coverage < total) {
    const missing = allowList
      .filter(b => !matchedBrandIds.has(b.brand_id))
      .map(b => b.brand_name)
      .slice(0, 10);
    console.log(`   missing: ${missing.join(', ')}${total - coverage > 10 ? ', …' : ''}`);
    console.log('   (front-end requires 100% coverage to render by floor; falls back to clusters otherwise)');
  }

  if (opts.dryRun) {
    console.log('   dry-run, not writing. Sample rows:');
    for (const v of validated.slice(0, 8)) {
      console.log(`     ${v.brand_id} ${BRAND_NAME_BY_ID[v.brand_id]} → ${v.floor_label} (order ${v.floor_order})`);
    }
    return;
  }

  // Replace-all-for-this-centre. Cleaner than upsert: any floor a brand has
  // moved away from since the last extraction is removed without a stale-row
  // sweep. Safe because this script is the only writer.
  const { error: delErr } = await supabase
    .from('centre_brand_floors')
    .delete()
    .eq('centre_id', centre.id);
  if (delErr) {
    console.error(`  ✗ delete failed: ${delErr.message}`);
    return;
  }
  if (!validated.length) {
    console.log('   nothing to insert (0 validated rows)');
    return;
  }
  const insertRows = validated.map(v => ({ centre_id: centre.id, ...v }));
  const { error: insErr } = await supabase
    .from('centre_brand_floors')
    .insert(insertRows);
  if (insErr) {
    console.error(`  ✗ insert failed: ${insErr.message}`);
    return;
  }
  console.log(`  ✓ wrote ${insertRows.length} rows`);
}

async function main() {
  const args = parseArgs(process.argv);

  let q = supabase.from('centres').select('id, name, directory_url');
  if (args.centre) q = q.eq('id', args.centre);
  else q = q.not('directory_url', 'is', null);
  const { data: centres, error } = await q;
  if (error) {
    console.error('Failed to load centres:', error.message);
    process.exit(1);
  }
  if (!centres || !centres.length) {
    console.error(args.centre
      ? `No centre with id "${args.centre}"`
      : 'No centres have directory_url set — populate it first.');
    process.exit(1);
  }

  for (let i = 0; i < centres.length; i++) {
    const centre = centres[i];
    if (!centre.directory_url) {
      console.log(`\n── ${centre.name} (${centre.id}) — no directory_url set, skipping`);
      continue;
    }
    await processCentre(centre, args);
    if (i < centres.length - 1) await sleep(MIN_GAP_MS);
  }
}

main().catch(err => {
  console.error('Extractor failed:', err);
  process.exit(1);
});
