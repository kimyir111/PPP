/* practice/variant.js (G11c-0, docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 8.2): the checks of tests/practice-variant/variant-checks.js, one test each, on the real module, and the
   module as a browser script (the files in a bare vm context with no require, in the page's order).
   node --test tests/practice-variant/variant.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const V = require(path.join(REPO, 'practice', 'variant.js'));
const { CHECKS } = require('./variant-checks.js');
const F = require('./variant-fixtures.js');

CHECKS.forEach(c => test(c.name, () => { c.fn(V); }));

test('the module also runs as a browser script: the page\'s files in a bare vm context give the same graph and the same refusals', () => {
  const ctx = vm.createContext({ console });
  ctx.window = ctx; ctx.globalThis = ctx;
  [ 'scoregraph/rational.js', 'scoregraph/schema.js', 'scoregraph/pitch.js', 'scoregraph/time.js', 'scoregraph/serialize.js', 'scoregraph/validate.js', 'scoregraph/build.js',
    'scoregraph/prov.js', 'scoregraph/ops.js', 'scoregraph/gaps.js', 'scoregraph/tools/notation-check.js',
    'playability/reach.js', 'playability/graph.js', 'playability/analyze.js', 'playability/fingering.js', 'playability/index.js',
    'difficulty/features.js', 'difficulty/model.js', 'difficulty/index.js', 'practice/variant.js'
  ].forEach(p => vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), ctx, { filename: p }));
  const B = ctx.PPPPracticeVariant;
  assert.ok(B && typeof B.splice === 'function', 'the module leaves window.PPPPracticeVariant');
  const parse = ctx.PPPScoreGraphModules.serialize.parse;
  const weights = JSON.parse(fs.readFileSync(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'), 'utf8'));
  const SG = F.SG;
  const base = F.piece('busy'), variant = F.piece('plain');
  const inPage = (b, v, o) => B.splice(parse(SG.serialize(b)), parse(SG.serialize(v)), Object.assign({ weights: weights }, o));
  const here = V.splice(base, variant, { from: 2, to: 5, songId: 's', level: 'beginner' });
  const there = inPage(base, variant, { from: 2, to: 5, songId: 's', level: 'beginner' });
  assert.equal(there.ok, true, there.reason + ' ' + there.detail);
  assert.equal(ctx.PPPScoreGraphModules.serialize.serialize(there.graph), SG.serialize(here.graph), 'byte for byte the graph Node makes');
  assert.deepEqual(JSON.parse(JSON.stringify(there.seams)), here.seams);
  assert.equal(inPage(base, base, { from: 2, to: 5 }).reason, 'VARIANT_IDENTICAL');
  assert.equal(B.splice(parse(SG.serialize(base)), parse(SG.serialize(variant)), { from: 2, to: 5 }).reason, 'VARIANT_NOT_LOADED', 'a page that does not hand over the G6 weights is told so');
  assert.deepEqual(Array.from(B.CODES), Array.from(V.CODES));
});
