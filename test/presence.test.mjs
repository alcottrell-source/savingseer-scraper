// Invariants for the inline BRANDS array and the PRESENCE matrix in
// index.html. These guard against:
//   - PRESENCE rows that don't have exactly 24 ints
//   - BRANDS entries with no PRESENCE row (UI would show "(0)" forever)
//   - PRESENCE keys that don't have a BRANDS row (silent orphan data)
//   - Surviving brands with sum(PRESENCE) < 2 (violates the May 2026 rule)
//   - The 5 anchor brand IDs admin.html depends on must still resolve

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBrands() {
  const m = html.match(/const BRANDS = \[([\s\S]*?)\];\s*\n\s*const PRESENCE/);
  assert.ok(m, 'could not locate inline BRANDS array');
  const ids = [];
  const re = /\{id:'([A-Z]\d+)'/g;
  let r;
  while ((r = re.exec(m[1]))) ids.push(r[1]);
  return ids;
}

function extractPresence() {
  const m = html.match(/const PRESENCE = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'could not locate PRESENCE object');
  const rows = {};
  const re = /(B\d+):\[([^\]]+)\]/g;
  let r;
  while ((r = re.exec(m[1]))) {
    rows[r[1]] = r[2].split(',').map(s => Number(s.trim()));
  }
  return rows;
}

test('every BRANDS id has a PRESENCE row', () => {
  const ids = extractBrands();
  const rows = extractPresence();
  const missing = ids.filter(id => !rows[id]);
  assert.deepEqual(missing, [], `BRANDS ids without PRESENCE: ${missing.join(', ')}`);
});

test('every PRESENCE key has a BRANDS entry', () => {
  const ids = new Set(extractBrands());
  const rows = extractPresence();
  const orphans = Object.keys(rows).filter(k => !ids.has(k));
  assert.deepEqual(orphans, [], `PRESENCE keys without BRANDS: ${orphans.join(', ')}`);
});

test('every PRESENCE row has exactly 24 ints', () => {
  const rows = extractPresence();
  const bad = Object.entries(rows).filter(([_, v]) => v.length !== 24 || v.some(x => x !== 0 && x !== 1));
  assert.deepEqual(bad.map(([k]) => k), [], `malformed PRESENCE rows: ${bad.map(([k,v]) => `${k} (len=${v.length})`).join(', ')}`);
});

test('every surviving brand has sum(PRESENCE) >= 2', () => {
  const rows = extractPresence();
  const violators = Object.entries(rows)
    .map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)])
    .filter(([_, sum]) => sum < 2);
  assert.deepEqual(violators, [], `brands violating presence>=2 rule: ${violators.map(([k,s]) => `${k}(${s})`).join(', ')}`);
});

test('admin.html anchor brand IDs still resolve', () => {
  const ids = new Set(extractBrands());
  for (const aid of ['B001', 'B002', 'B003', 'B011', 'B012']) {
    assert.ok(ids.has(aid), `anchor brand ${aid} missing from BRANDS`);
  }
});
