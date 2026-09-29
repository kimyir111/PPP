/* Candidates — engrave-gated selection suite (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §12
   "round 2" and the round-2 fix pass). Hand-built candidates (real ScoreGraphs from mk() where
   the real engrave critic must run, hand-written score objects everywhere else) so each
   property under test - top-K gating, skip-if-already-real, empty pool, ablation via a zeroed
   weight, errored/missing scores counting WORST, the cache key - is isolated and known in
   advance rather than inferred from a real corpus run. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const CAND = require(path.join(REPO, 'candidates/index.js'));

const REQUEST = { targetLevel: 2, handProfile: 'large' };
const PERFECT = { melody: 1, harmony: { rootQuality: 1 }, voiceLeading: { count: 0 }, registerDensity: { overage: 0 } };

/* a cheap-scored candidate (engrave deferred: null), level chosen per test */
function cheap(index, level, extra, graph) {
  return {
    index: index, spec: { handProfile: 'large', pattern: 'p' + index }, fingerprint: 'fp' + index,
    graph: graph === undefined ? mk({ time: [1, 4], rh: 'C5:q', lh: 'C3:q' }) : graph,
    scores: Object.assign({ level: level, engrave: null }, PERFECT, extra || {}), hardOk: true
  };
}

test('gate: only the top K cheap-ranked candidates are engrave-checked; the rest are reported in notEngraveChecked and the caller\'s pool is not mutated', () => {
  const pool = [cheap(0, 2.0), cheap(1, 2.5), cheap(2, 3.0), cheap(3, 3.5), cheap(4, 4.0)];
  const calls = [];
  const orig = require(path.join(REPO, 'critics/metrics.js')).engraveMetrics;
  const M = require(path.join(REPO, 'critics/metrics.js'));
  M.engraveMetrics = function (g, id) { calls.push(id); return orig.apply(this, arguments); };
  let sel;
  try { sel = CAND.selectWithEngraveGate(pool, null, null, REQUEST, { topKForEngrave: 2 }); }
  finally { M.engraveMetrics = orig; }
  assert.equal(sel.ok, true);
  assert.equal(calls.length, 2, 'the expensive engrave critic must run exactly K=2 times, not once per candidate');
  assert.equal(sel.topK, 2);
  assert.deepEqual(sel.ranked.map(c => c.index), [0, 1], 'the final pick is made among just the cheap top-K');
  assert.deepEqual(sel.notEngraveChecked.map(c => c.index), [2, 3, 4]);
  sel.ranked.forEach(c => assert.equal(typeof c.scores.engrave.silent, 'number', 'top-K members carry a real engrave result'));
  assert.equal(sel.selected.index, 0);
  assert.match(sel.explanation, /top 2 of 5/);
  pool.forEach(c => assert.equal(c.scores.engrave, null, 'the gate must not mutate the caller\'s scored candidates'));
});

test('gate: an engrave result the candidate already carries (or the engraveCache holds) is reused, never recomputed', () => {
  const M = require(path.join(REPO, 'critics/metrics.js'));
  const orig = M.engraveMetrics;
  let calls = 0;
  M.engraveMetrics = function () { calls++; return orig.apply(this, arguments); };
  try {
    const sentinel = { silent: 0, hardLayout: 0, sentinel: true };
    /* graph null: recomputing would throw and be recorded as an error - so a surviving sentinel proves skip-if-real */
    const carried = cheap(0, 2.0, { engrave: sentinel }, null);
    const sel = CAND.selectWithEngraveGate([carried], null, null, REQUEST, { topKForEngrave: 3 });
    assert.equal(sel.ok, true);
    assert.equal(sel.selected.scores.engrave, sentinel, 'the already-real engrave result must be kept as-is');
    assert.equal(calls, 0);

    const memo = { silent: 0, hardLayout: 0, memo: true };
    const cache = new Map([['fp0', memo]]);
    const sel2 = CAND.selectWithEngraveGate([cheap(0, 2.0, {}, null)], null, null, REQUEST, { topKForEngrave: 3, engraveCache: cache });
    assert.equal(sel2.selected.scores.engrave, memo, 'a memoised result (keyed by fingerprint) must be reused');
    assert.equal(calls, 0);

    /* a fresh computation is memoised for the next call */
    const cache3 = new Map();
    CAND.selectWithEngraveGate([cheap(0, 2.0)], null, null, REQUEST, { topKForEngrave: 3, engraveCache: cache3 });
    assert.equal(calls, 1);
    assert.ok(cache3.has('fp0'));
  } finally { M.engraveMetrics = orig; }
});

test('empty pool: select() and selectWithEngraveGate() report NO_CANDIDATES, not ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', () => {
  const a = CAND.select([], REQUEST, {});
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'NO_CANDIDATES');
  const b = CAND.selectWithEngraveGate([], null, null, REQUEST, {});
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'NO_CANDIDATES');
  assert.deepEqual(b.notEngraveChecked, []);
  /* and a non-empty all-violating pool still reports the hard-violation reason */
  const bad = Object.assign(cheap(0, 2.0), { hardOk: false });
  assert.equal(CAND.selectWithEngraveGate([bad], null, null, REQUEST, {}).reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
});

test('ablation: zeroing one critic\'s weight changes the choice on hand-built candidates', () => {
  /* A: level exactly on target but a poor melody (0.5). B: level 1 position off (badness 1/3)
     but a perfect melody. Default weights: A 0.5 vs B 0.333 -> B wins. Melody weight 0 -> A
     wins. Level weight 0 -> B wins (A's melody cost remains). Engrave results are pre-supplied
     (already real) so nothing else moves. */
  const real = { silent: 0, hardLayout: 0 };
  const A = cheap(0, 2.0, { melody: 0.5, engrave: real }, null);
  const B = cheap(1, 3.0, { engrave: real }, null);
  const w = k => Object.assign({}, CAND.DEFAULT_WEIGHTS, { [k]: 0 });
  const base = CAND.selectWithEngraveGate([A, B], null, null, REQUEST, {});
  assert.equal(base.selected.index, 1);
  const noMelody = CAND.selectWithEngraveGate([A, B], null, null, REQUEST, { weights: w('melody') });
  assert.equal(noMelody.selected.index, 0, 'with the melody critic zeroed the choice must flip');
  const noLevel = CAND.selectWithEngraveGate([A, B], null, null, REQUEST, { weights: w('level') });
  assert.equal(noLevel.selected.index, 1);
});

test('a candidate whose engrave critic throws is counted WORST for engrave and cannot beat a clean candidate', () => {
  /* A is cheap-best (level exactly on target) but its graph is null, so the engrave critic
     throws inside the gate. B is cheap-worse but clean. Before the fix an errored engrave
     scored 0 (perfect) and A would have won on its cheap edge; now A carries a full engrave
     penalty (1 x weight) and B must win. */
  const A = cheap(0, 2.0, {}, null);
  const B = cheap(1, 2.3);
  const sel = CAND.selectWithEngraveGate([A, B], null, null, REQUEST, { topKForEngrave: 2 });
  assert.equal(sel.ok, true);
  const ranked = Object.fromEntries(sel.ranked.map(c => [c.index, c]));
  assert.ok(ranked[0].scores.engrave.error, 'the throw must be recorded as an error result');
  assert.equal(ranked[0].badness.parts.engrave, 1, 'an errored engrave counts as the worst engrave score');
  assert.equal(sel.selected.index, 1, 'a candidate whose engrave errored must not beat a clean one');
});

test('badnessOf: errored or absent scores count worst; null means not-applicable/deferred only where documented', () => {
  const full = Object.assign({ level: 2, engrave: { silent: 0, hardLayout: 0 } }, PERFECT);
  const clean = CAND.badnessOf(full, 2, {});
  assert.equal(clean.total, 0);
  assert.equal(CAND.badnessOf(Object.assign({}, full, { engrave: { error: 'x', silent: null, hardLayout: null } }), 2, {}).parts.engrave, 1);
  assert.equal(CAND.badnessOf(Object.assign({}, full, { engrave: null }), 2, {}).parts.engrave, 1, 'engrave not computed and not deferred = worst');
  assert.equal(CAND.badnessOf(Object.assign({}, full, { engrave: null }), 2, {}, { deferEngrave: true }).parts.engrave, 0, 'deliberately deferred (cheap phase) is neutral');
  const noMelody = Object.assign({}, full); delete noMelody.melody; noMelody.melodyError = 'boom';
  assert.equal(CAND.badnessOf(noMelody, 2, {}).parts.melody, 1);
  const noHarmony = Object.assign({}, full); delete noHarmony.harmony; noHarmony.harmonyError = 'boom';
  assert.equal(CAND.badnessOf(noHarmony, 2, {}).parts.harmony, 1);
  const noVl = Object.assign({}, full); delete noVl.voiceLeading;
  assert.equal(CAND.badnessOf(noVl, 2, {}).parts.voiceLeading, 1);
  const noRd = Object.assign({}, full); delete noRd.registerDensity; noRd.registerDensityError = 'boom';
  assert.equal(CAND.badnessOf(noRd, 2, {}).parts.registerDensity, 1);
  assert.equal(CAND.badnessOf(Object.assign({}, full, { level: undefined, levelError: 'boom' }), 2, {}).parts.level, 1);
  /* not-applicable: nothing to compare against in the original is not a defect */
  assert.equal(CAND.badnessOf(Object.assign({}, full, { melody: null }), 2, {}).parts.melody, 0);
});

test('cache: the key includes planOpts and reference, and a hit is a copy (mutating a result never poisons the cache)', async () => {
  const g = await H.graphOf('catalog/hymns/all-glory-laud.musicxml');
  const sg = SGG.analyze(g);
  const request = { targetLevel: DIFF.assess(g, WEIGHTS).level.position, handProfile: 'large', sections: 'all' };
  const cache = new Map();
  const opts = { n: 2, topKForEngrave: 1, cache: cache };
  const r1 = CAND.run(g, sg, request, opts);
  assert.equal(cache.size, 1);
  CAND.run(g, sg, request, Object.assign({}, opts, { planOpts: {} }));
  assert.equal(cache.size, 2, 'different planOpts must be a different cache entry');
  CAND.run(g, sg, request, Object.assign({}, opts, { reference: null, planOpts: undefined }));
  assert.equal(cache.size, 2, 'an equivalent option set hits the existing entry');
  CAND.run(g, sg, request, Object.assign({}, opts, { reference: { marker: 'other' } }));
  assert.equal(cache.size, 3, 'a different reference must be a different cache entry');
  const hit = CAND.run(g, sg, request, opts);
  assert.notEqual(hit, r1, 'a hit must be a copy, not the stored object');
  hit.scored = null; hit.selected = null;
  const hit2 = CAND.run(g, sg, request, opts);
  assert.ok(Array.isArray(hit2.scored) && hit2.selected, 'mutating a returned result must not affect later hits');
});
