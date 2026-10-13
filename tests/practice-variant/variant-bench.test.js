/* The benchmark of practice/variant.js in the gate (G11c-0, docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 8.2): the sample of ten pieces on the arranger's frozen work, every accepted splice read
   by variant-verify.js and every outcome compared with the full run's, and the full run's own record (tests/practice-variant/variant-bench.baseline.json: all 325 catalogue pieces and 8
   recording covers, 10 windows of 4 bars, easier / harder / one level up) checked for what it must say. The full run is `node tests/practice-variant/variant-bench.js --full`.
   node --test tests/practice-variant/variant-bench.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('./variant-bench.js');

test('the windows of a piece are seeded: the same ones every time, distinct, 4 bars each, inside the piece', () => {
  const a = B.windowsOf('method/beyer/067.mxl', 18, 4, 10), b = B.windowsOf('method/beyer/067.mxl', 18, 4, 10);
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  assert.equal(new Set(a.map(w => w.from)).size, 10);
  a.forEach(w => { assert.equal(w.to - w.from, 3); assert.ok(w.from >= 0 && w.to < 18); });
  assert.deepEqual(a.map(w => w.from), a.map(w => w.from).slice().sort((x, y) => x - y));
  assert.notDeepEqual(a, B.windowsOf('method/beyer/068.mxl', 18, 4, 10));
  assert.deepEqual(B.windowsOf('x', 3, 4, 10), [{ from: 0, to: 2 }], 'a piece of 3 bars: one window of all of them');
  assert.equal(B.windowsOf('x', 6, 4, 10).length, 3, 'as many windows as there are starts');
});

test('the committed full run: 325 catalogue pieces and the recording covers, no verification failure, every outcome accounted for', () => {
  const base = B.loadBaseline();
  assert.deepEqual(base.params, { windows: B.WINDOWS, len: B.LEN, seed: B.SEED }, 'the baseline was made with the parameters of this code');
  assert.equal(base.pieces.length, 333);
  assert.equal(base.pieces.filter(p => p.id.indexOf('rec:') === 0).length, 8);
  assert.equal(base.summary.verificationFailures, 0);
  assert.equal(base.summary.pieces, 333);
  ['easier', 'harder', 'up'].forEach(dir => {
    const total = Object.keys(base.summary.all[dir]).reduce((s, k) => s + base.summary.all[dir][k], 0);
    assert.equal(total, base.summary.all.windows, dir + ' accounts for every window');
    assert.ok(!base.summary.all[dir].V, dir + ' has no verification failure');
  });
  base.pieces.forEach(p => {
    assert.equal(p.easier.length, p.harder.length);
    assert.equal(p.easier.length, p.up.length);
    assert.ok(/^[AIESTPFXNHO-]+$/.test(p.easier + p.harder + p.up), p.id + ' has an outcome code the table does not know');
  });
  base.sample.forEach(id => assert.ok(base.pieces.some(p => p.id === id), id + ' is in the full run'));
});

test('the sample: the frozen variants of ten pieces give the recorded outcomes, and no splice the verification finds fault with', async () => {
  const frozen = B.loadFrozen();
  assert.deepEqual(Object.keys(frozen).sort(), B.loadBaseline().sample.slice().sort(), 'the fixtures are the sample');
  const r = await B.checkSample(false);
  assert.deepEqual(r.problems, []);
  assert.equal(r.summary.verificationFailures, 0);
  assert.ok(r.summary.all.easier.A > 0 && r.summary.all.easier.I > 0 && r.summary.all.easier.E > 0, 'the sample reaches accepted, identical and not-easier');
  assert.ok(r.summary.all.harder.H > 0, 'and the hard violations of a source');
});
