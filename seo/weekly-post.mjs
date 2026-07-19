// weekly-post.mjs
// Auto-generated weekly blog posts ("This week's tide — w/c {Monday}") derived
// from stored centre_seer_scores history at build time. Zero hand-writing: the
// daily Deploy Hook rebuild emits a new dated post every Monday and regenerates
// the recent archive wholesale (history is retained ~180 days server-side; we
// cap the archive at MAX_WEEKS). Pure module: callers pass shaped centre data
// (with .scoreHistory rows) and `today`.
//
// Copy rule: trend vocabulary only — "rose / eased / peaked" — never
// recommendation language ("go now" stays reserved for the app's PEAK badge).

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const dayMs = 86400000;
const toDate = (s) => new Date(s + 'T12:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const fmtLong = (d) => `${d.getUTCDate()} ${MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// Monday (UTC) of the week containing d.
export function mondayOf(d) {
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * dayMs);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One completed week's digest across centres, or null when no centre has data
// in that week. weekStart = Monday Date (UTC).
export function buildWeekDigest(shapedList, weekStart) {
  const startStr = iso(weekStart);
  const endStr = iso(new Date(weekStart.getTime() + 6 * dayMs)); // Sunday
  const perCentre = [];
  for (const s of shapedList) {
    const rows = (s.scoreHistory || [])
      .filter(r => r.score_date >= startStr && r.score_date <= endStr)
      .sort((a, b) => (a.score_date < b.score_date ? -1 : 1));
    if (!rows.length) continue;
    perCentre.push({
      slug: s.centre.slug, name: s.centre.name,
      start: Number(rows[0].tide_score) || 0,
      end: Number(rows[rows.length - 1].tide_score) || 0,
      peaked: rows.some(r => r.verdict === 'Peak'),
    });
  }
  if (!perCentre.length) return null;
  const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const natStart = Math.round(avg(perCentre.map(c => c.start)));
  const natEnd = Math.round(avg(perCentre.map(c => c.end)));
  const risers = perCentre.filter(c => c.end - c.start > 0).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 3);
  const easing = perCentre.filter(c => c.end - c.start < 0).length;
  const peaked = perCentre.filter(c => c.peaked);
  return { weekStart, startStr, endStr, centreCount: perCentre.length, natStart, natEnd, risers, easing, peaked };
}

function directionWord(from, to) {
  if (to > from + 1) return 'rose';
  if (to < from - 1) return 'eased';
  return 'held level';
}

function digestHtml(d, origin) {
  const dir = directionWord(d.natStart, d.natEnd);
  const p1 = `<p>Across the ${d.centreCount} UK shopping centres Tide tracks, the tide ${dir} this week: an average of <strong>${d.natEnd}%</strong> of tracked shops were on sale by Sunday${d.natEnd !== d.natStart ? `, ${d.natEnd > d.natStart ? 'up' : 'down'} from ${d.natStart}% on Monday` : ''}.</p>`;
  const riserBits = d.risers.map(c => `<a href="${origin}/centre/${c.slug}">${esc(c.name)}</a> (+${c.end - c.start} to ${c.end})`);
  const p2 = d.risers.length
    ? `<p>Climbing fastest: ${riserBits.join(', ')}.${d.easing ? ` ${d.easing} centre${d.easing === 1 ? '' : 's'} eased back.` : ''}</p>`
    : (d.easing ? `<p>No centre climbed this week; ${d.easing} eased back.</p>` : '');
  const p3 = d.peaked.length
    ? `<p>Hitting their peak this week: ${d.peaked.map(c => `<a href="${origin}/centre/${c.slug}">${esc(c.name)}</a>`).join(', ')} — the crest of their current sale cycle.</p>`
    : '';
  const p4 = `<p>The tide moves daily. <a href="${origin}/">See today's scores</a>, or check <a href="${origin}/guides/uk-sale-calendar">the UK sale calendar</a> for the next big window.</p>`;
  return [p1, p2, p3, p4].filter(Boolean).join('\n');
}

// Blog-post objects (same shape blog.mjs's loadPosts produces) for up to
// maxWeeks completed weeks, newest first. Weeks with no data are skipped.
export function buildWeeklyPosts(shapedList, today, { origin = 'https://tidego.co', maxWeeks = 12 } = {}) {
  const thisMonday = mondayOf(today);
  const posts = [];
  for (let k = 1; k <= maxWeeks; k++) {
    const weekStart = new Date(thisMonday.getTime() - k * 7 * dayMs);
    const d = buildWeekDigest(shapedList, weekStart);
    if (!d) continue;
    const dir = directionWord(d.natStart, d.natEnd);
    posts.push({
      slug: `this-weeks-tide-${d.startStr}`,
      title: `This week's tide — w/c ${fmtLong(weekStart)}`,
      description: `UK sale activity for the week commencing ${fmtLong(weekStart)}: the tide ${dir}, with ${d.natEnd}% of tracked shops on sale across ${d.centreCount} centres by Sunday.`,
      date: d.endStr, // published as of the Sunday it covers
      tags: ['weekly tide'],
      hero: null,
      relatedCentres: d.risers.map(c => ({ slug: c.slug, name: c.name })),
      html: digestHtml(d, origin),
      generated: true,
    });
  }
  return posts; // built newest-first (k ascending = most recent completed week first)
}
