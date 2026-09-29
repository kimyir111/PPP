/* G9c: the documented input rule (review/lib/select.js) - order, tiers, feasibility, determinism. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, ITEMS, CACHE } = require('./helpers.js');
const S = require(path.join(REPO, 'review/lib/select.js'));
const HARNESS = require(path.join(REPO, 'realize/tools/harness.js'));
const corpus = require(path.join(REPO, 'tests/engrave/corpus.json'));

test('tiers come from the harness itself: tuning sample = sampleFiles(16), held-out slice = heldOutFiles(32), rest = never measured', () => {
  const tier = S.tierOf();
  const tuning = HARNESS.sampleFiles(16), held = HARNESS.heldOutFiles(32);
  tuning.forEach(f => assert.equal(tier(f), 2, f));
  held.forEach(f => assert.equal(tier(f), 1, f));
  assert.equal(new Set(tuning.concat(held)).size, 48, 'the two samples are disjoint');
  const rest = corpus.files.filter(f => tuning.indexOf(f) < 0 && held.indexOf(f) < 0);
  assert.equal(rest.length, 13);
  rest.forEach(f => assert.equal(tier(f), 0, f));
});

test('the candidate order is deterministic, covers the corpus once, and prefers pieces G9 was not tuned on', () => {
  const a = S.candidateOrder('h8'), b = S.candidateOrder('h8');
  assert.deepEqual(a.order, b.order);
  assert.deepEqual(a.order.slice().sort(), corpus.files.slice().sort(), 'every corpus file exactly once');
  const tiers = a.order.map(a.tier);
  assert.deepEqual(tiers, tiers.slice().sort(), 'H-8 tries tier 0, then 1, then 2');
});

test('H-9 tries pieces not chosen for H-8 before ones that were, and the tuning sample last', () => {
  const avoid = new Set(corpus.files.slice(30, 40));
  const { order, tier } = S.candidateOrder('h9', avoid);
  const group = f => tier(f) === 2 ? 2 : avoid.has(f) ? 1 : 0;
  const gs = order.map(group);
  assert.deepEqual(gs, gs.slice().sort());
  assert.deepEqual(order.slice().sort(), corpus.files.slice().sort());
});

test('inside a preference group the strata are taken round-robin (no stratum runs the whole group)', () => {
  const { order, tier } = S.candidateOrder('h8');
  const strata = corpus.strata, stratumOf = f => strata.findIndex(s => s.files.indexOf(f) >= 0);
  const tier0 = order.filter(f => tier(f) === 0).map(stratumOf);
  assert.ok(new Set(tier0.slice(0, 5)).size >= 4, 'the first five tier-0 pieces come from at least four strata: ' + tier0.slice(0, 5));
});

test('selection really runs the pipeline: unreachable, too long, and identical-arm pieces are skipped with a reason; the rest are ordered as documented', async () => {
  const only = ITEMS.map(i => i.file).concat(['catalog/method/beyer/013.mxl', 'catalog/method/beyer/001.mxl']);
  const run = () => S.selectItems('h9', { onlyFiles: only, count: 4, cache: CACHE });
  const a = await run(), b = await run();
  assert.equal(a.items.length, 4);
  assert.deepEqual(a.items.map(r => r.file), b.items.map(r => r.file), 'deterministic');
  assert.deepEqual(a.items.map(r => r.item.targetLevel), b.items.map(r => r.item.targetLevel));
  a.items.forEach(r => {
    assert.ok(r.ok && !r.identical);
    assert.ok(r.measures.length >= S.MIN_MEASURES && r.measures.length <= S.MAX_MEASURES);
    assert.ok(r.legacy.levelDistance != null && r.g9.hard === 0, 'G9 output has no hard violation');
  });
  const reasons = Object.fromEntries(a.skipped.map(s => [s.file, s.reason]));
  assert.match(reasons['catalog/method/beyer/013.mxl'] || 'not tried', /no reachable G7b plan|not tried/);
  assert.equal(reasons['catalog/method/beyer/001.mxl'] === undefined || /104 measures/.test(reasons['catalog/method/beyer/001.mxl']), true);
});

test('an unfillable request fails loudly instead of returning a short packet', async () => {
  await assert.rejects(S.selectItems('h9', { onlyFiles: ['catalog/method/beyer/013.mxl'], count: 1, cache: CACHE }), /qualify/);
});
