/* Critics — register/density against G7b's real per-stage bands (docs/GOALS/
   G09_CANDIDATES_CRITICS_REPAIR.md §4). Uses a real corpus file's own G8a realization
   (the same reuse the design doc asks for - real bands, real difficulty/features.js
   output) rather than a synthetic fixture, since the critic's whole point is to compare
   against REAL, corpus-derived percentile bands. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const RD = require(path.join(REPO, 'critics/register-density.js'));

async function findPlan(file) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  for (const lvl of [pos, pos + 1, pos - 1, pos + 2]) {
    for (const profile of ['large', 'medium', 'small']) {
      const r = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (r.ok) return { g, sg, plan: r.plan, profile, target: lvl };
    }
  }
  return null;
}

test('registerDensity: a real, already-tuned G8a realization at its own real stage has low overage', async () => {
  const found = await findPlan('catalog/method/beyer/007.mxl');
  const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern: 'auto' });
  assert.ok(r.ok);
  const out = RD.registerDensity(r.graph, found.plan.stage);
  assert.ok(out.band, 'a real stage-' + found.plan.stage + ' band should be available');
  assert.equal(typeof out.overage, 'number');
  assert.ok(Number.isFinite(out.overage));
  RD.P90_KEYS.concat(RD.MAX_KEYS).forEach(k => {
    assert.ok(out.detail[k], 'missing detail for ' + k);
    assert.ok(out.detail[k].over >= 0);
  });
});

test('registerDensity: an unknown/no-reference stage returns overage 0 and band null rather than throwing', () => {
  const fakeGraph = { timeline: { measures: [] }, parts: [] };
  const out = RD.registerDensity(fakeGraph, 999, { reference: { weights: { stages: {}, anchors: [] }, dataset: { records: [] } } });
  assert.equal(out.overage, 0);
  assert.equal(out.band, null);
});

test('registerDensity is deterministic (same graph+stage, same result, repeat call)', async () => {
  const found = await findPlan('catalog/method/beyer/007.mxl');
  const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern: 'auto' });
  const a = RD.registerDensity(r.graph, found.plan.stage);
  const b = RD.registerDensity(r.graph, found.plan.stage);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
