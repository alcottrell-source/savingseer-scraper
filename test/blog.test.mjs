import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFrontmatter, loadPosts } from '../seo/blog.mjs';
import { renderBlogPost } from '../seo/render.mjs';

const BLOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'seo', 'blog');

test('parseFrontmatter parses scalars, arrays, booleans and strips comments', () => {
  const { meta, body } = parseFrontmatter([
    '---',
    'title: A post: with a colon',
    'tags: [guides, sale timing]',
    'draft: false',
    'date: 2026-07-22 # publish day',
    '# a full-line comment',
    '---',
    '',
    'Body text.',
  ].join('\n'));
  assert.equal(meta.title, 'A post: with a colon');
  assert.deepEqual(meta.tags, ['guides', 'sale timing']);
  assert.equal(meta.draft, false);
  assert.equal(meta.date, '2026-07-22');
  assert.equal(body, 'Body text.');
});

test('parseFrontmatter treats a fence-less file as all body', () => {
  const { meta, body } = parseFrontmatter('Just prose, no fence.');
  assert.deepEqual(meta, {});
  assert.equal(body, 'Just prose, no fence.');
});

test('loadPosts loads the real blog dir newest-first and resolves related centres', async () => {
  const centresBySlug = {
    'westquay-southampton': { name: 'Westquay' },
    'westfield-london': { name: 'Westfield London' },
  };
  const posts = await loadPosts(BLOG_DIR, { centresBySlug });
  const slugs = posts.map(p => p.slug);
  assert.ok(slugs.includes('anatomy-of-a-sale-cycle'), 'new anatomy post loads');
  assert.ok(slugs.includes('how-long-do-uk-summer-sales-last'), 'new summer-length post loads');
  // Newest-first by date string.
  const dates = posts.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const anatomy = posts.find(p => p.slug === 'anatomy-of-a-sale-cycle');
  assert.deepEqual(anatomy.relatedCentres.map(c => c.slug), ['westquay-southampton', 'westfield-london']);
});

test('loadPosts prunes related centres that are not being generated', async () => {
  // Only Westquay generated this run — Westfield must be dropped, not linked broken.
  const posts = await loadPosts(BLOG_DIR, { centresBySlug: { 'westquay-southampton': { name: 'Westquay' } } });
  const anatomy = posts.find(p => p.slug === 'anatomy-of-a-sale-cycle');
  assert.deepEqual(anatomy.relatedCentres.map(c => c.slug), ['westquay-southampton']);
});

test('the new posts stay trend-only — no recommendation language', async () => {
  const posts = await loadPosts(BLOG_DIR, { centresBySlug: {} });
  for (const slug of ['anatomy-of-a-sale-cycle', 'how-long-do-uk-summer-sales-last']) {
    const p = posts.find(x => x.slug === slug);
    assert.ok(p, `${slug} present`);
    assert.ok(!/go now/i.test(p.html), `${slug}: recommendation language is reserved for the PEAK badge`);
  }
});

test('blog posts hand off into the app with centre context (Row 5 parity)', () => {
  const common = { origin: 'https://tidego.co', supabase: { url: 'u', anonKey: 'k' }, siblings: [] };
  const post = {
    title: 'T', description: '', slug: 't', date: '2026-07-22', tags: [], hero: null,
    html: '<p>x</p>', relatedCentres: [{ slug: 'westquay-southampton', name: 'Westquay' }],
  };
  const html = renderBlogPost(post, common);
  assert.match(html, /href="https:\/\/tidego\.co\/centre\/westquay-southampton"/);
  assert.match(html, /href="https:\/\/tidego\.co\/\?centre=westquay-southampton"/);
  // No related centres → no app deep-link block at all.
  const bare = renderBlogPost({ ...post, relatedCentres: [] }, common);
  assert.ok(!/\?centre=/.test(bare));
});
