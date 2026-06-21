// blog.mjs
// Build-time blog loading: read hand-written Markdown posts from seo/blog/*.md,
// parse their frontmatter, render the body, and resolve internal links. Pure and
// testable — no DB access. generate.mjs calls loadPosts() and routes the result
// through render.mjs (renderBlogIndex / renderBlogPost) and the existing emit()
// so blog URLs land in the sitemap for free.
//
// Content is FIRST-PARTY (our own posts), so the Markdown body is rendered to
// trusted HTML with no sanitiser. Frontmatter is parsed by a tiny hand-rolled
// splitter (the schema is fixed) — no YAML dependency. The only new dependency
// is `marked`, for faithful Markdown rendering of author prose.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from './render.mjs';

// ── Frontmatter ─────────────────────────────────────────────────────────────
// A post file must start with a `---\n` fence and have a closing `\n---\n`. The
// meta block is parsed line-by-line as `key: value`, supporting scalars, inline
// arrays `[a, b]`, and booleans. Everything after the closing fence is the body.
export function parseFrontmatter(raw) {
  const text = String(raw).replace(/^﻿/, ''); // strip BOM
  if (!/^---\r?\n/.test(text)) return { meta: {}, body: text.trim() };
  // Find the closing fence after the opening one.
  const rest = text.replace(/^---\r?\n/, '');
  const end = rest.search(/\r?\n---\r?\n/);
  if (end === -1) return { meta: {}, body: text.trim() };
  const metaBlock = rest.slice(0, end);
  const body = rest.slice(end).replace(/^\r?\n---\r?\n/, '');
  const meta = {};
  for (const line of metaBlock.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // Strip an inline `# comment` tail (only when not inside quotes/brackets).
    if (!/^["'\[]/.test(val)) val = val.replace(/\s+#.*$/, '').trim();
    meta[key] = coerce(val);
  }
  return { meta, body: body.trim() };
}

function coerce(val) {
  if (val === '') return '';
  if (val === 'true') return true;
  if (val === 'false') return false;
  // Inline array: [a, b, c]
  if (/^\[.*\]$/.test(val)) {
    return val.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(s => s !== '');
  }
  return unquote(val);
}
function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Markdown ────────────────────────────────────────────────────────────────
// Lazily import `marked` so non-blog code paths (and unit tests that don't touch
// rendering) don't need it loaded. A missing dependency throws loudly here —
// better a failed build than shipping unrendered Markdown.
let _marked = null;
export async function renderMarkdown(body) {
  if (!_marked) {
    const mod = await import('marked');
    _marked = mod.marked;
    _marked.setOptions({ gfm: true, breaks: false });
  }
  return _marked.parse(String(body || ''));
}

// ── Loading ─────────────────────────────────────────────────────────────────
// Read every *.md in `dir`, parse + render, resolve relatedCentres against the
// set of centre pages actually being generated (centresBySlug: slug -> {name}),
// dropping any that don't exist so we never emit a broken internal link. Drafts
// are skipped. Returns posts newest-first. A missing/empty dir returns [].
export async function loadPosts(dir, { centresBySlug = {} } = {}) {
  let files = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.md'));
  } catch (e) {
    return []; // no blog dir yet — fine, render an empty index
  }
  const posts = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (meta.draft === true) continue;
    if (!meta.title) {
      console.error(`[seo] blog: skipping ${file} — no title in frontmatter.`);
      continue;
    }
    const slug = meta.slug || slugify(meta.title);
    const html = await renderMarkdown(body);
    const relatedCentres = (Array.isArray(meta.relatedCentres) ? meta.relatedCentres : [])
      .map(s => (centresBySlug[s] ? { slug: s, name: centresBySlug[s].name } : null))
      .filter(Boolean);
    posts.push({
      title: meta.title,
      description: meta.description || '',
      slug,
      date: meta.date || '',
      tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
      hero: meta.hero || null,
      html,
      relatedCentres,
    });
  }
  // Newest-first by date string (YYYY-MM-DD sorts lexically). Undated posts last.
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return posts;
}
