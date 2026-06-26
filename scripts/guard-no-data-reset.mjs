#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// guard-no-data-reset — refuse to let a data-wiping change into the repo.
//
// Companion to the DB-level guard (supabase/migrations/20260626_protect_data_
// from_reset.sql). That trigger stops a reset at execution time; THIS stops one
// from ever being committed — it's the tripwire that catches us (or an AI agent)
// writing a "reset to a clean baseline" migration in the first place.
//
// Scans SQL/JS for destructive statements against the protected, human-verified
// tables. A match fails the check (exit 1) UNLESS the file carries an explicit,
// reviewed acknowledgement line:
//
//     -- DATA-RESET-ACK: <reason this deliberate reset is safe>
//
// Even with the ack it prints a loud warning — a reset is never silent.
//
// Usage:
//   node scripts/guard-no-data-reset.mjs [file ...]    # scan specific files
//   node scripts/guard-no-data-reset.mjs               # scan all tracked SQL/JS
//
// Used by .githooks/pre-commit (staged files) and .github/workflows/guard-data.yml.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Tables whose rows are real, verified, and not regenerable.
const PROTECTED =
  '(brand_sale_cycles|brand_sale_events|centre_seer_scores|user_reports|community_signals|centres|brands)';

// Each rule: a human label + a regex matched against comment-stripped source.
const RULES = [
  { label: 'DELETE FROM a protected table',
    re: new RegExp(`\\bDELETE\\s+FROM\\s+(public\\.)?${PROTECTED}\\b`, 'i') },
  { label: 'TRUNCATE of a protected table',
    re: new RegExp(`\\bTRUNCATE\\s+(TABLE\\s+)?(public\\.)?${PROTECTED}\\b`, 'i') },
  { label: 'DROP TABLE of a protected table',
    re: new RegExp(`\\bDROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${PROTECTED}\\b`, 'i') },
  { label: "wiping centres.tide_history to empty",
    re: /tide_history\s*=\s*('(\[\s*\]|\{\s*\})'|'\[\]'::jsonb|null)/i },
  { label: 'Supabase client .delete() with no .eq/.in filter (deletes every row)',
    re: /\.from\(\s*['"`](brand_sale_cycles|brand_sale_events|centre_seer_scores|user_reports|community_signals|centres|brands)['"`]\s*\)[\s\S]{0,80}?\.delete\(\)(?![\s\S]{0,120}?\.(eq|in|match|filter|lt|gt|gte|lte|neq)\b)/i },
];

const ACK_RE = /DATA-RESET-ACK:/i;

// Strip SQL/JS line comments so destructive words inside explanatory prose
// don't trip the guard. Block comments and string literals are left intact;
// the rules are anchored on "<verb> ... <table>" so trigger DDL ("AFTER DELETE
// ON", "BEFORE TRUNCATE ON") and error-message strings ("DELETE % rows") do
// not match.
function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

function listTrackedFiles() {
  const out = execSync('git ls-files -- "*.sql" "*.mjs" "*.js"', { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const argv = process.argv.slice(2);
// Self-skip: never scan this guard or the protection migration (they describe
// the very patterns they defend against).
const SELF = [
  'scripts/guard-no-data-reset.mjs',
  'scripts/audit-data-provenance.mjs',          // read-only; documents the patterns
  'supabase/migrations/20260626_protect_data_from_reset.sql',
];
const files = (argv.length ? argv : listTrackedFiles())
  .filter((f) => existsSync(f))
  .filter((f) => /\.(sql|mjs|js)$/i.test(f))
  .filter((f) => !SELF.some((s) => f.endsWith(s)));

const violations = [];
const acknowledged = [];

for (const file of files) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { continue; }
  const hasAck = ACK_RE.test(raw);
  const scrubbed = stripLineComments(raw);
  const hits = RULES.filter((r) => r.re.test(scrubbed)).map((r) => r.label);
  if (hits.length === 0) continue;
  if (hasAck) acknowledged.push({ file, hits });
  else violations.push({ file, hits });
}

const RED = '\x1b[31m', YEL = '\x1b[33m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

if (acknowledged.length) {
  console.warn(`${YEL}${BOLD}⚠ DATA-RESET present (acknowledged):${OFF}`);
  for (const { file, hits } of acknowledged) {
    console.warn(`  ${file}`);
    hits.forEach((h) => console.warn(`    • ${h}`));
  }
  console.warn(`${YEL}  These carry DATA-RESET-ACK. Make sure the data was snapshotted first.${OFF}\n`);
}

if (violations.length) {
  console.error(`${RED}${BOLD}✗ BLOCKED: change would reset protected Tide data.${OFF}`);
  console.error(`${RED}  This data is human-verified and not regenerable.${OFF}\n`);
  for (const { file, hits } of violations) {
    console.error(`  ${BOLD}${file}${OFF}`);
    hits.forEach((h) => console.error(`    • ${h}`));
  }
  console.error(`\n${RED}  If this reset is genuinely intended and the data is safe to lose`);
  console.error(`  (e.g. dropping simulated rows), do BOTH:`);
  console.error(`    1. Snapshot first:  CREATE TABLE <t>_archive_YYYYMMDD AS SELECT * FROM <t>;`);
  console.error(`    2. Add a comment line to the file:  -- DATA-RESET-ACK: <why this is safe>`);
  console.error(`  and the runtime DB guard still requires`);
  console.error(`    SET LOCAL app.allow_data_reset = 'yes-i-really-mean-it';${OFF}`);
  process.exit(1);
}

console.log(`✓ data-reset guard: no unacknowledged destructive statements in ${files.length} file(s)`);
