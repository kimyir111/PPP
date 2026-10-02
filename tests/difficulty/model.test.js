/* difficulty/model.js and the committed weights (docs/GOALS/G06_DIFFICULTY.md §3(b), G6a). node --test. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, D, F, M, mk, weights, dataset, graphOf, relOf } = require('./helpers.js');
require(path.join(REPO, 'course.js'));
const COURSE = globalThis.PPP_COURSE;

test('the weights file: schema, one weight/mean/std per feature, no negative weight, anchors sorted with a non-decreasing fit', () => {
  const W = weights();
  M.check(W);
  assert.equal(W.schema, 'ppp.difficulty-weights/1');
  assert.equal(W.tool, 'ppp.g6a');
  W.featureNames.forEach(n => assert.ok(F.FEATURE_NAMES.includes(n), n));
  assert.ok(!W.featureNames.includes('length'), 'length is measured but not ranked (train.js RANKER_EXCLUDES)');
  W.weights.forEach(w => assert.ok(w >= 0));
  for (let i = 1; i < W.anchors.length; i++) {
    assert.ok(W.anchors[i].score >= W.anchors[i - 1].score);
    assert.ok(W.anchors[i].fit >= W.anchors[i - 1].fit - 1e-12);
  }
  COURSE.PATH.forEach(s => assert.equal(W.stages[s.stage].book, s.book));
});

test('the hold-out discipline: no anchor, and no training piece, is a hold-out file', () => {
  const W = weights();
  const recs = dataset().records;
  const holdout = new Set(recs.filter(r => r.holdout).map(r => r.book + '/' + r.no));
  W.anchors.forEach(a => assert.ok(!holdout.has(a.book + '/' + a.no), 'anchor ' + a.book + '/' + a.no + ' is a hold-out file'));
  assert.equal(W.training.holdoutUsed, false);
  const trainable = recs.filter(r => !r.holdout && (r.stage != null || r.order != null)).length;
  assert.equal(W.training.pieces, trainable);
});

test('check() refuses a weights file that is malformed or has a negative weight', () => {
  const W = weights();
  assert.throws(() => M.check(Object.assign({}, W, { schema: 'x' })));
  assert.throws(() => M.check(Object.assign({}, W, { weights: W.weights.slice(1) })));
  assert.throws(() => M.check(Object.assign({}, W, { weights: W.weights.map((w, i) => (i === 0 ? -1 : w)) })));
  assert.throws(() => M.check(Object.assign({}, W, { featureNames: ['nope'].concat(W.featureNames.slice(1)) })));
});

test('predict: deterministic, contributions add up to the score, reasons are features above the method-book average', () => {
  const g = mk({ key: { fifths: 3 }, rh: 'C#5:16 D5:16 E5:16 F#5:16 G#5:16 A5:16 B5:16 C#6:16 E6:8 A5:8 E5:8 C#5:8 | A4+C#5+E5:h A5+C#6+E6:h', lh: 'A2:8 E3:8 A3:8 E3:8 A2:8 E3:8 A3:8 E3:8 | A1+A2:h E2+E3:h' });
  const W = weights();
  const a = D.assess(g, W), b = D.assess(g, W);
  assert.deepEqual(a, b);
  const sum = a.contributions.reduce((s, c) => s + c.contribution, 0);
  assert.ok(Math.abs(sum - a.score) < 1e-9);
  assert.ok(a.reasons.length > 0 && a.reasons.length <= 3);
  a.reasons.forEach(r => {
    const c = a.contributions.find(x => x.name === r.feature);
    assert.ok(c.contribution > 0 && c.value > c.mean, r.feature);
    assert.equal(typeof r.text, 'string');
  });
  assert.equal(a.measures.length, 2);
});

test('level: named method-book neighbours, a course position, a stage; clamped (with `beyond`) outside the anchors', () => {
  const W = weights();
  const lo = M.levelOf(W.anchors[0].score - 10, W), hi = M.levelOf(W.anchors[W.anchors.length - 1].score + 10, W);
  assert.equal(lo.beyond, 'bottom'); assert.equal(lo.below, null); assert.ok(lo.above);
  assert.equal(hi.beyond, 'top'); assert.equal(hi.above, null); assert.ok(hi.below);
  const mid = W.anchors[Math.floor(W.anchors.length / 2)];
  const l = M.levelOf(mid.score, W);
  assert.ok(l.below && l.above && l.beyond === null);
  assert.ok(l.position >= 1 && l.position < 4);
  assert.equal(l.book, W.stages[l.stage].book);
  assert.ok(l.near && l.near.book === l.book);
});

test('level on real pieces: an early Beyer piece is placed in stage 1, a late Czerny 30 study in stage 3', async () => {
  const recs = dataset().records.filter(r => !r.holdout);
  const early = recs.filter(r => r.book === 'beyer').sort((a, b) => a.no - b.no)[2];
  const late = recs.filter(r => r.book === 'czerny849').sort((a, b) => b.no - a.no)[0];
  const W = weights();
  const le = D.assess(await graphOf(relOf(early)), W).level, ll = D.assess(await graphOf(relOf(late)), W).level;
  assert.equal(le.stage, 1, early.id + ' at ' + JSON.stringify(le));
  assert.equal(ll.stage, 3, late.id + ' at ' + JSON.stringify(ll));
  assert.ok(ll.position > le.position);
});

test('hotspots: a one-note pickup is ranked by the share of a bar it is, not by rates over its eighth of a bar', () => {
  /* the pickup's lone off-beat C#: 2 accidentals and 2 off-beat notes per beat, over half a beat; bar 2 is a
     real chromatic run of eighths (1 accidental and 1 off-beat note per beat, over four beats) */
  const g = mk({ time: [4, 4], durs: ['1/8', '1'], implicitFirst: true, rh: 'C#5:8 | C#5:8 D5:8 D#5:8 E5:8 F5:8 F#5:8 G5:8 G#5:8', lh: 'r:8 | C3:w' });
  const p = D.assess(g, weights());
  const rows = Object.fromEntries(p.measures.map(m => [m.number, m.score]));
  assert.ok(rows['1'] > rows['2'] && rows['2'] > 0, 'per beat, the pickup fragment looks hotter (' + rows['1'] + ' vs ' + rows['2'] + ')');
  assert.equal(p.hotspots[0].number, '2');
});

/* G06 §7: measured with difficulty/tools/perf.js (warm: G6's own features + inference <= 4 ms per piece; with
   the G5 run it makes on key-normalised attacks, <= 18 ms). One cold run here, with CI headroom, the way
   tests/playability/playability.test.js guards G5's own budget on the same piece.
   G10a-0: the budget was 100 ms; a GitHub runner took 118 ms cold (a dev machine is several times faster), so the bound is 250 ms -
   still an order of magnitude under what a regression to a per-attack O(n^2) pass would cost. */
test('performance: the longest method piece (sonatina/020, 1,401 attacks) is assessed in <= 250 ms, cold', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const W = weights();
  const t0 = process.hrtime.bigint();
  D.assess(g, W);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms <= 250, 'assess took ' + ms.toFixed(1) + ' ms');
});

test('hotspots: the one busy, chromatic, right-hand bar is the top hotspot, and its hand is the right hand', () => {
  const g = mk({
    rh: 'C5:h E5:h | C5:h G5:h | C#5:16 D#5:16 F#5:16 G#5:16 A#5:16 C#6:16 D#6:16 F#6:16 G#6:16 F#6:16 D#6:16 C#6:16 A#5:16 G#5:16 F#5:16 D#5:16 | C5:w',
    lh: 'C3:w | C3:w | C3:w | C3:w'
  });
  const p = D.assess(g, weights());
  assert.ok(p.hotspots.length >= 1);
  assert.equal(p.hotspots[0].number, '3');
  assert.equal(p.hotspots[0].hand, 'RH');
  assert.ok(p.hotspots[0].reasons.length >= 1);
  const byNumber = Object.fromEntries(p.measures.map(m => [m.number, m.score]));
  assert.ok(byNumber['3'] > byNumber['1'] && byNumber['3'] > byNumber['4']);
});
