/* G9 without stride patterns (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12, "G9 without stride patterns (post H-8 re-review)").

   The candidate set no longer contains the stride patterns 'pop' and 'waltz' by default, and 'auto' no longer resolves to the
   triple-meter 'waltz'. The stride code stays implemented and selectable: direct realize() calls are unchanged (noStride is off),
   and `opts.allowStride` / `opts.patterns` on candidates restore the old set. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const REPAIR = require(path.join(REPO, 'repair/index.js'));

const STRIDE = ['pop', 'waltz'];
const isStride = p => STRIDE.indexOf(p) >= 0;
/* a triple-meter hymn (its 'auto' sections were 'waltz' before) and two method pieces that G9a used to select a stride pattern for */
const WALTZ_HYMN = { file: 'catalog/hymns/what-child-is-this.musicxml', targetLevel: 3.46 };
const POP_PIECE = { file: 'catalog/method/beyer/061.mxl', targetLevel: 3.24 };
const OTHER = { file: 'catalog/hymns/nearer-my-god.musicxml', targetLevel: 2.4 };

async function load(r) {
  const g = await H.graphOf(r.file);
  const sg = SGG.analyze(g);
  return { g, sg, request: { targetLevel: r.targetLevel, handProfile: 'large', sections: 'all' } };
}
const patternsOfReport = c => Object.keys(c.report.patternCounts || {});

test('the default set is auto, hymn, block, broken, ballad; the stride patterns are named and the old set is kept', () => {
  assert.deepEqual(CAND.STRIDE_PATTERNS, STRIDE);
  assert.deepEqual(CAND.PATTERNS, ['auto', 'hymn', 'block', 'broken', 'ballad']);
  assert.deepEqual(CAND.ALL_PATTERNS, ['auto', 'hymn', 'block', 'broken', 'ballad', 'pop', 'waltz']);
  assert.deepEqual(CAND.patternsFor({}), CAND.PATTERNS);
  assert.deepEqual(CAND.patternsFor(), CAND.PATTERNS);
  assert.deepEqual(CAND.patternsFor({ allowStride: true }), CAND.ALL_PATTERNS);
  assert.deepEqual(CAND.patternsFor({ patterns: ['block', 'pop'] }), ['block', 'pop']);
  assert.deepEqual(CAND.patternsFor({ patterns: ['block'], allowStride: true }), ['block'], 'an explicit list wins');
  assert.throws(() => CAND.patternsFor({ patterns: ['block', 'polka'] }), /unknown pattern polka/);
  assert.throws(() => CAND.patternsFor({ patterns: [] }), /non-empty/);
  /* the stride patterns remain real realizer patterns */
  STRIDE.forEach(p => assert.ok(REALIZE.PATTERN_NAMES.indexOf(p) >= 0));
});

test('the default specs never name a stride pattern; the opt-in restores them, in the old order', async () => {
  const { request } = await load(OTHER);
  const dflt = CAND.specOrder(request, {});
  assert.ok(dflt.length > 0 && dflt.every(s => !isStride(s.pattern)));
  const old = CAND.specOrder(request, { allowStride: true });
  assert.ok(old.some(s => s.pattern === 'pop') && old.some(s => s.pattern === 'waltz'));
  /* the default is the old list with the stride specs removed: nothing reordered */
  assert.deepEqual(old.filter(s => !isStride(s.pattern)), dflt);
  const only = CAND.specOrder(request, { patterns: ['hymn', 'pop'] });
  assert.deepEqual(only.filter(s => s.levelOffset === 0).slice(0, 2).map(s => s.pattern), ['hymn', 'pop']);
});

test('no candidate resolves to a stride texture by default, on a triple-meter piece and a method piece; the opt-in brings them back', async () => {
  for (const r of [WALTZ_HYMN, POP_PIECE, OTHER]) {
    const { g, sg, request } = await load(r);
    const e = CAND.enumerate(g, sg, request, {});
    assert.ok(e.candidates.length >= 3, r.file + ': expected several candidates, got ' + e.candidates.length);
    e.candidates.forEach(c => {
      assert.ok(!isStride(c.spec.pattern), r.file + ': spec ' + c.spec.pattern);
      patternsOfReport(c).forEach(p => assert.ok(!isStride(p), r.file + ': candidate ' + c.spec.pattern + '@' + c.spec.levelOffset + ' realized ' + p));
    });
    e.tried.forEach(t => assert.ok(!isStride(t.spec.pattern)));
    const old = CAND.enumerate(g, sg, request, { allowStride: true });
    const resolved = new Set();
    old.candidates.forEach(c => patternsOfReport(c).forEach(p => resolved.add(p)));
    assert.ok(old.candidates.some(c => isStride(c.spec.pattern)), r.file + ': the opt-in restores the stride specs');
    assert.ok(resolved.has('pop') && resolved.has('waltz'), r.file + ': and the stride textures, got ' + JSON.stringify([...resolved]));
  }
});

test("'auto' in a triple meter: waltz for a direct realize() call (unchanged), block with noStride, and never a stride pattern from candidates", async () => {
  const { g, sg, request } = await load(WALTZ_HYMN);
  /* the plan of an old-set candidate whose 'auto' resolved to waltz in some section (found, not assumed) */
  const old = CAND.enumerate(g, sg, request, { allowStride: true });
  const hit = old.candidates.find(c => c.spec.pattern === 'auto' && (c.report.patternCounts.waltz || 0) > 0);
  assert.ok(hit, 'fixture assumption: an auto candidate that used waltz');
  const p = { ok: true, plan: hit.plan };
  const direct = REALIZE.realize(g, sg, p.plan, { pattern: 'auto' });
  assert.equal(direct.ok, true);
  assert.ok((direct.report.patternCounts.waltz || 0) > 0, 'the realizer\'s own auto still picks waltz in a triple meter: ' + JSON.stringify(direct.report.patternCounts));
  const off = REALIZE.realize(g, sg, p.plan, { pattern: 'auto', noStride: true });
  assert.equal(off.ok, true);
  assert.equal(off.report.patternCounts.waltz || 0, 0);
  assert.equal(off.report.patternCounts.pop || 0, 0);
  assert.ok((off.report.patternCounts.block || 0) + (off.report.patternCounts.broken || 0) + (off.report.patternCounts.hymn || 0) > 0);
  /* an explicit request is still honoured with noStride on: that is how the stride patterns stay selectable */
  const explicit = REALIZE.realize(g, sg, p.plan, { pattern: 'waltz', noStride: true });
  assert.ok((explicit.report.patternCounts.waltz || 0) > 0);
  /* noStride changes nothing when 'auto' would not have picked a stride pattern (a non-triple hymn) */
  const q = await load(OTHER);
  const pp = ARR.planner.plan(q.g, q.sg, q.request);
  assert.ok(pp.ok);
  const a = REALIZE.realize(q.g, q.sg, pp.plan, { pattern: 'auto' }), b = REALIZE.realize(q.g, q.sg, pp.plan, { pattern: 'auto', noStride: true });
  if (!(a.report.patternCounts.waltz || a.report.patternCounts.pop)) assert.deepEqual(a.report.patternCounts, b.report.patternCounts);
});

test('an explicit pattern list enumerates a stride pattern, while auto stays stride-free unless allowStride is on', async () => {
  const { g, sg, request } = await load(WALTZ_HYMN);
  const e = CAND.enumerate(g, sg, request, { patterns: ['auto', 'pop'] });
  assert.ok(e.candidates.some(c => c.spec.pattern === 'pop'));
  e.candidates.filter(c => c.spec.pattern === 'auto').forEach(c => assert.ok(!patternsOfReport(c).includes('waltz')));
});

test('determinism, and the cache tells the default from the opt-in', async () => {
  const { g, sg, request } = await load(WALTZ_HYMN);
  const a = CAND.run(g, sg, request, { n: 8 }), b = CAND.run(g, sg, request, { n: 8 });
  assert.equal(a.ok, true);
  assert.deepEqual(a.tried.map(t => t.spec), b.tried.map(t => t.spec));
  assert.equal(a.selected.fingerprint, b.selected.fingerprint);
  const cache = new Map();
  const d = CAND.run(g, sg, request, { n: 24, cache: cache });
  const o = CAND.run(g, sg, request, { n: 24, cache: cache, allowStride: true });
  assert.equal(cache.size, 2, 'the two option sets do not share a cache entry');
  assert.ok(d.tried.every(t => !isStride(t.spec.pattern)));
  assert.ok(o.tried.some(t => isStride(t.spec.pattern)));
});

test('the selection (after repair) is never a stride texture by default, on the pieces G9a used to give a stride', async () => {
  for (const r of [WALTZ_HYMN, POP_PIECE, OTHER]) {
    const { g, sg, request } = await load(r);
    const sel = CAND.run(g, sg, request, {});
    assert.equal(sel.ok, true, r.file);
    assert.ok(!isStride(sel.selected.spec.pattern), r.file + ' selected ' + sel.selected.spec.pattern);
    const rr = REPAIR.repairSelection(sel, g, sg, request);
    assert.equal(rr.ok, true, r.file);
    assert.ok(patternsOfReport(sel.selected).every(p => !isStride(p)), r.file);
  }
});
