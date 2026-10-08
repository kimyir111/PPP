/* G11b-0: practice/sim.js, the synthetic learners (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4). The model is a set of
   assumptions (its header says which); these tests pin that it does what the header says, and that a learner is a
   pure function of (type, piece, seed): no Math.random, integer-only random numbers, the same on every platform. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const SIM = require(path.join(__dirname, '..', '..', 'practice', 'sim.js'));

const DAY = SIM.DAY;
/* a small made-up piece: four measures, the third harder, the fourth empty (a rest bar) */
const PIECE = { id: 'unit', measures: [
  { index: 0, d: { r: 1, l: 1 }, notes: { r: 4, l: 2 } },
  { index: 1, d: { r: 1, l: 1.2 }, notes: { r: 4, l: 2 } },
  { index: 2, d: { r: 2.5, l: 2 }, notes: { r: 6, l: 3 } },
  { index: 3, d: { r: 1, l: 1 }, notes: { r: 0, l: 0 } }
] };
const ctx1 = { ratio: 1, both: true, hide: 0, fatigue: 0 };

test('the LCG and the seed hash are pinned (Numerical Recipes a, c; FNV-1a): the same numbers on every platform', () => {
  const g = SIM.rng(1);
  assert.deepEqual([g.next(), g.next(), g.next()], [1015568748, 1586005467, 2165703038]);
  assert.equal(SIM.rng(42).float(), 0.25234514474868774);
  assert.equal(SIM.hashSeed('abc'), 440920331);
  assert.equal(SIM.hashSeed('beyer-050|even|0'), 2389210468);
  const n = SIM.rng(7);
  let s = 0, s2 = 0;
  for (let i = 0; i < 20000; i++) { const x = n.normal(); s += x; s2 += x * x; }
  assert.ok(Math.abs(s / 20000) < 0.03 && Math.abs(s2 / 20000 - 1) < 0.03, 'Irwin-Hall: mean 0, variance 1');
});

test('a learner is a function of (type, piece, seed), and nothing in the model calls Math.random', () => {
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    const a = SIM.makeLearner('even', PIECE, 123, 0), b = SIM.makeLearner('even', PIECE, 123, 0);
    assert.deepEqual(a, b);
    assert.notDeepEqual(SIM.makeLearner('even', PIECE, 124, 0).params, a.params);
    const notes = [{ midi: 60, tMs: 1000, i: 0, hand: 'r', rep: '0|0', q: 0 }, { midi: 48, tMs: 1000, i: 0, hand: 'l', rep: '0|0', q: 0 }];
    const p1 = SIM.perform(a, notes, ctx1, SIM.rng(5)), p2 = SIM.perform(b, notes, ctx1, SIM.rng(5));
    assert.deepEqual(p1, p2);
    SIM.practise(a, p1.reps, ctx1, 0);
    SIM.advance(a, 3 * DAY);
    assert.ok(SIM.truth(a, 1).length === 4);
  } finally { Math.random = random; }
  assert.throws(() => SIM.makeLearner('nobody', PIECE, 1, 0), /unknown learner type/);
  assert.deepEqual(SIM.TYPE_NAMES, ['even', 'weak-left', 'rushing', 'slow', 'forgetter', 'beginner']);
});

test('every parameter is drawn inside its type\'s range', () => {
  SIM.TYPE_NAMES.forEach(type => {
    const R = SIM.rangesOf(type);
    for (let k = 0; k < 20; k++) {
      const L = SIM.makeLearner(type, PIECE, SIM.hashSeed(type + k), 0);
      Object.keys(R).forEach(name => assert.ok(L.params[name] >= R[name][0] && L.params[name] <= R[name][1], type + '.' + name));
    }
  });
});

test('P(hit): harder measures, faster tempo, two hands, fatigue and hidden notes each lower it; a measure without notes has no truth', () => {
  const L = SIM.makeLearner('even', PIECE, 9, 0);
  const p = (i, c) => SIM.pHit(L, i, 'r', Object.assign({}, ctx1, c));
  assert.ok(p(2, {}) < p(0, {}) - 0.05, 'the harder measure');
  assert.ok(p(0, { ratio: 0.5 }) > p(0, {}), 'slower is easier');
  assert.ok(p(0, { both: false }) > p(0, {}), 'one hand alone is easier');
  assert.ok(p(0, { fatigue: 1 }) < p(0, {}), 'tired');
  assert.ok(p(0, { hide: 1 }) < p(0, {}) * 0.2, 'from memory, with nothing memorised yet');
  assert.ok(p(0, { ratio: 0.1, both: false }) <= 1 - L.params.slip + 1e-12, 'slips put a ceiling under 1');
  assert.equal(SIM.truth(L, 1)[3], null);
  assert.equal(SIM.fatigueAt(5), 0);
  assert.equal(SIM.fatigueAt(20), 0.5);
  assert.equal(SIM.fatigueAt(45), 1);
});

test('the six types differ where the doc says they do', () => {
  const mean = (type, f) => { let s = 0; for (let k = 0; k < 40; k++) s += f(SIM.makeLearner(type, PIECE, SIM.hashSeed('t' + type + k), 0)); return s / 40; };
  const gap = L => SIM.pTech(L, 0, 'r', ctx1) - SIM.pTech(L, 0, 'l', ctx1);
  assert.ok(mean('weak-left', gap) > mean('even', gap) + 0.1, 'weak left hand');
  assert.ok(mean('beginner', L => SIM.truth(L, 1)[0]) < mean('even', L => SIM.truth(L, 1)[0]) - 0.15, 'beginner');
  assert.ok(mean('slow', L => L.params.eta) < mean('even', L => L.params.eta) / 2, 'slow learner');
  assert.ok(mean('forgetter', L => L.params.halfLife) < mean('even', L => L.params.halfLife) / 2, 'fast forgetter');
  /* rushing: notes land early on average */
  const L = SIM.makeLearner('rushing', PIECE, 77, 0);
  const notes = Array.from({ length: 400 }, (_, j) => ({ midi: 60 + (j % 5), tMs: 1000 * j, i: j % 3, hand: 'r', rep: j + '|' + (j % 3), q: j }));
  const g = SIM.rng(3);
  const ev = SIM.perform(L, notes, ctx1, g).events.filter(e => Math.abs(e.t - 1000 * Math.round(e.t / 1000)) < 400);
  const dt = ev.reduce((a, e) => a + (e.t - 1000 * Math.round(e.t / 1000)), 0) / ev.length;
  assert.ok(dt < -30, 'rushing: mean timing ' + dt.toFixed(1) + ' ms');
});

test('practice raises skill, most at a moderate challenge; hands alone transfer the share kappa; forgetting halves the learned part in h days; a new day consolidates', () => {
  const L = SIM.makeLearner('even', PIECE, 11, 0);
  const it = L.items[0].r;
  const before = it.s;
  const P = SIM.pTech(L, 0, 'r', ctx1);
  SIM.practise(L, [{ i: 0, hand: 'r', P: P }], ctx1, 0);
  const gain = it.s - before;
  assert.ok(Math.abs(gain - L.params.eta * (1 - P) * Math.min(1, P / 0.35)) < 1e-12);
  /* the gain curve: small when nearly everything lands, small when almost nothing does */
  const g = P0 => L.params.eta * (1 - P0) * Math.min(1, P0 / 0.35);
  assert.ok(g(0.35) > g(0.05) && g(0.35) > g(0.95));
  const L2 = SIM.makeLearner('even', PIECE, 11, 0);
  SIM.practise(L2, [{ i: 0, hand: 'r', P: P }], Object.assign({}, ctx1, { both: false }), 0);
  assert.ok(Math.abs((L2.items[0].r.s - before) - gain * L2.params.kappa) < 1e-12, 'kappa');
  /* forgetting */
  const learned = it.s - it.s0, h = it.h;
  SIM.advance(L, h * DAY);
  assert.ok(Math.abs((it.s - it.s0) - learned / 2) < 1e-9);
  /* spacing: practised again on another day, the half-life grows by (1 + phi) */
  SIM.practise(L, [{ i: 0, hand: 'r', P: 0.5 }], ctx1, 1);
  assert.ok(Math.abs(it.h - Math.min(L.params.hMax, h * (1 + L.params.phi))) < 1e-12);
  SIM.practise(L, [{ i: 0, hand: 'r', P: 0.5 }], ctx1, 1);
  assert.ok(Math.abs(it.h - Math.min(L.params.hMax, h * (1 + L.params.phi))) < 1e-12, 'the same day does not consolidate twice');
});

test('perform: the key presses are sorted, a chord\'s notes share a timing draw, a miss is silence or a near key', () => {
  const L = SIM.makeLearner('beginner', PIECE, 21, 0);
  const notes = [];
  for (let j = 0; j < 50; j++) [60, 64, 67].forEach(m => notes.push({ midi: m, tMs: 500 * j, i: j % 3, hand: 'r', rep: j + '|' + (j % 3), q: j }));
  const out = SIM.perform(L, notes, ctx1, SIM.rng(8));
  for (let k = 1; k < out.events.length; k++) assert.ok(out.events[k - 1].t < out.events[k].t || (out.events[k - 1].t === out.events[k].t && out.events[k - 1].midi <= out.events[k].midi));
  assert.ok(out.events.length <= notes.length);
  out.events.forEach(e => assert.ok(e.midi >= 58 && e.midi <= 69 && e.type === 'on'));
  assert.equal(out.reps.length, 50, 'one repetition per (visit, measure, hand)');
});

test('summary, quantile and Brier', () => {
  assert.equal(SIM.brier([[0.5, 1], [1, 1]]), 0.125);
  assert.equal(SIM.brier([]), null);
  assert.deepEqual(SIM.summary([3, 1, null, 2]), { n: 3, mean: 2, median: 2, p10: 1.2, p90: 2.8 });
  assert.equal(SIM.round(1 / 3, 4), 0.3333);
});
