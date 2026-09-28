/* The G6a dataset and its discipline (docs/GOALS/G06_DIFFICULTY.md §3(b), §5 "hold-out files never used for
   training"): the committed dataset is the corpus registry's current reading, and the committed dataset and
   weights are exactly what the committed code produces. node --test. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, dataset } = require('./helpers.js');
const build = require(path.join(REPO, 'difficulty', 'tools', 'build-dataset.js'));
const train = require(path.join(REPO, 'difficulty', 'tools', 'train.js'));

const json = p => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));

test('the dataset is the registry: every registered method file, its hold-out flag copied, no excluded file', () => {
  const data = dataset();
  const refs = json('tests/bench/corpus/references.json').references.filter(r => r.set === 'method');
  const excluded = new Set(json('tests/bench/corpus/excluded.json').excluded.map(e => e.id));
  const byId = new Map(data.records.map(r => [r.id, r]));
  assert.equal(data.records.length, refs.length);
  refs.forEach(r => {
    assert.ok(byId.has(r.id), r.id + ' is registered but not in the dataset');
    assert.equal(byId.get(r.id).holdout, !!r.holdout, r.id + ': hold-out flag');
  });
  data.records.forEach(r => assert.ok(!excluded.has(r.id), r.id + ' is excluded (excluded.json) but in the dataset'));
});

test('labels come from course.js: PATH stages, a side book at its one stage, hanon (a warm-up in several stages) unlabelled', () => {
  const data = dataset();
  require(path.join(REPO, 'course.js'));
  globalThis.PPP_COURSE.PATH.forEach(s => assert.equal(data.stages[s.book], s.stage));
  assert.equal(data.stages.hanon, null);
  assert.equal(data.stages.burgmuller25, 2);
  assert.equal(data.stages.sonatina, 3);
  data.records.filter(r => r.book === 'hanon').forEach(r => { assert.equal(r.stage, null); assert.equal(r.order, null); });
  /* the sonatina album is ordered only between Clementi Op. 36 sonatinas; movements of one share an order */
  const son = data.records.filter(r => r.book === 'sonatina');
  son.filter(r => r.order != null).forEach(r => assert.ok(r.order >= 1 && r.order <= 6));
  assert.ok(son.some(r => r.order === null), 'Kuhlau and Beethoven movements carry no within-book order');
});

test('the committed dataset is what build-dataset.js builds from the committed code and registry', async () => {
  const text = JSON.stringify(await build.build(), null, 1) + '\n';
  const committed = fs.readFileSync(build.OUT, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text === committed, 'stale: run node difficulty/tools/build-dataset.js (then train.js --write)');
});

test('the committed weights are what train.js fits from the committed dataset (hold-out never in training)', () => {
  const text = JSON.stringify(train.finalWeightsDoc(), null, 1) + '\n';
  const committed = fs.readFileSync(train.WEIGHTS, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text === committed, 'stale: run node difficulty/tools/train.js --write --holdout');
  const W = JSON.parse(committed);
  const d = dataset();
  const holdout = new Set(d.records.filter(r => r.holdout).map(r => r.id));
  /* the same training set, rebuilt here from the dataset alone: labelled and not hold-out */
  const trainable = d.records.filter(r => !holdout.has(r.id) && (r.stage != null || r.order != null));
  assert.equal(W.training.pieces, trainable.length);
});
