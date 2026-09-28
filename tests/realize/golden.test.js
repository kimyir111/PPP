/* G08 §8 "golden arrangements (deterministic - same input, same output, byte for byte)".
   Same discipline G7b's own determinism check uses (docs/GOALS/G07B_ARRANGEMENT_PLANNER.md
   §11: "400/400 sampled determinism checks identical byte-for-byte") - a real corpus-wide
   sweep, not one hand-picked fixture, comparing two independent realize() calls on the SAME
   (graph, sg, plan) byte-for-byte via canonical JSON. A checked-in golden FILE was
   considered and rejected for v1: scoregraph/build.js's own IDs are already deterministic
   by construction (assigned in call order - "the same calls give the same IDs and the same
   bytes", scoregraph/build.js's own header), so the real risk this suite guards against is
   realize() itself introducing non-determinism (Map/Set iteration order, floating-point
   octave search order in realize/theory.js's `leadVoicing`), which a same-run comparison
   catches exactly as well as a committed file would, without a second file to keep in sync
   every time the realizer's real output legitimately changes. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

const SAMPLE = [
  'catalog/hymns/o-come-emmanuel.musicxml', 'catalog/hymns/all-creatures.musicxml',
  'catalog/hymns/when-i-survey.musicxml', 'catalog/method/beyer/001.mxl',
  'catalog/method/beyer/007.mxl', 'catalog/method/czerny599/010.mxl',
  'catalog/method/sonatina/001.mxl', 'catalog/method/burgmuller25/003.mxl'
];

async function findPlan(file) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  for (const lvl of [pos, pos + 1, pos - 1, pos + 2]) {
    for (const profile of ['large', 'medium', 'small']) {
      const r = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (r.ok) return { g, sg, plan: r.plan };
    }
  }
  return null;
}

test('golden: realize() is byte-for-byte deterministic across a real corpus sample, every pattern', async () => {
  let checked = 0, unreachable = 0;
  for (const file of SAMPLE) {
    const found = await findPlan(file);
    if (!found) { unreachable++; continue; }
    for (const pattern of ['auto', 'block', 'broken', 'ballad', 'pop', 'waltz', 'hymn']) {
      const a = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
      const b = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
      assert.equal(a.ok, b.ok, file + '/' + pattern + ': ok must agree');
      if (a.ok) assert.equal(JSON.stringify(a.graph), JSON.stringify(b.graph), file + '/' + pattern + ': expected byte-identical output');
      checked++;
    }
  }
  assert.ok(checked >= 5 * 7, 'expected at least 5 reachable files x 7 patterns actually checked, got ' + checked + ' (unreachable: ' + unreachable + ')');
});
