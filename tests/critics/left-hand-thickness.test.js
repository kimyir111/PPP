/* G9 last defect round: critics/left-hand-thickness.js (report only, weight 0; not part of evaluate). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const LHT = require(path.join(REPO, 'critics/left-hand-thickness.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

test('ofOnsets counts notes per onset, 3+ onsets, seconds below C4, chord tops at E4 or above and low clusters', () => {
  const r = LHT.ofOnsets([
    [48],                 /* a single note */
    [48, 55],             /* a fifth */
    [48, 52, 55],         /* a triad: 3+ */
    [50, 52, 57],         /* a second below C4 (D3 E3); not a low cluster, since D3 is above C3 */
    [36, 40, 43],         /* a third below C3: cluster */
    [52, 60, 64],         /* top E4, two or more notes */
    [64]                  /* a single note at E4 is not a chord top */
  ]);
  assert.equal(r.onsets, 7);
  assert.equal(r.notes, 1 + 2 + 3 + 3 + 3 + 3 + 1);
  assert.equal(r.onsets3plus, 4);
  assert.equal(r.secondsBelowC4, 1);
  assert.equal(r.topsAtOrAboveE4, 1);
  assert.equal(r.clusterAttacks, 1);
  assert.ok(Math.abs(r.notesPerOnset - 16 / 7) < 1e-9);
  assert.ok(Math.abs(r.onsets3plusRate - 4 / 7) < 1e-9);
});

test('an empty input is all zeros; the critic is not one of evaluate\'s ten', () => {
  const r = LHT.ofOnsets([]);
  assert.equal(r.onsets, 0);
  assert.equal(r.notesPerOnset, 0);
  assert.equal(CRIT.NAMES.indexOf('leftHandThickness'), -1, 'report only: evaluate and the selection weights are untouched');
});

test('on a realized piece it reads the left hand only, and the shape fix removes the seconds and the tops it reports', async () => {
  const g = await H.graphOf('catalog/method/beyer/061.mxl');
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: 2.24, handProfile: 'large', sections: 'all' });
  assert.ok(p.ok);
  const on = REALIZE.realize(g, sg, p.plan, { pattern: 'block', noStride: true });
  const off = REALIZE.realize(g, sg, p.plan, { pattern: 'block', noStride: true, compoundBeat: false, diatonicLow: false, leftShape: false });
  const a = LHT.leftHandThickness(on.graph), b = LHT.leftHandThickness(off.graph);
  assert.ok(a.onsets > 0 && a.onsets === b.onsets, 'same onsets, only thinner');
  assert.ok(a.secondsBelowC4 < b.secondsBelowC4 && a.topsAtOrAboveE4 < b.topsAtOrAboveE4);
  assert.deepEqual(LHT.leftHandThickness(on.graph), a, 'deterministic');
});
