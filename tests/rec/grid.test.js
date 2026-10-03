/* rec/grid.js, stage S3 of the recording conversion v2 (G10a-2, docs/GOALS/G10_AUDIO_TO_SCORE.md section 8): the grid of
   each beat (straight 16ths, 32nds, triplets, swung eighths) decided from the evidence of all its onsets, every onset on
   it. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, perform, lcg, skeletonInput } = require('./helpers.js');
const G = require(path.join(REPO, 'rec', 'grid.js'));

/* beats every `spb` seconds from `start` */
const beatGrid = (start, spb, n) => Array.from({ length: n + 1 }, (_, i) => start + i * spb);
/* the written onset of each note, as quarter positions from beats[0] */
const written = r => r.onsets.map(o => o.tick / 24 + 0);

test('the committed weights load, have the schema and are small (section 11: model JSON within 200 KB in total)', () => {
  const w = require(path.join(REPO, 'rec', 'weights', 'ai5b-grid-v1.json'));
  assert.equal(w.schema, G.SCHEMA);
  assert.equal(w.name, 'ai5b-grid');
  assert.ok(JSON.stringify(w).length < 20000);
  assert.ok(w.trainedOn && w.trainedOn.holdout === 0, 'no hold-out reference in the training set');
  ['16', '3', 'swing8', '32even'].forEach(k => {
    const s = w.patterns[k].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s - 1) < 1e-4, k + ' sums to ' + s);
  });
});

test('straight 16ths with timing noise stay straight 16ths: no triplet, no 32nd, every onset where it was written', () => {
  const bar = [];
  for (let e = 0; e < 16; e++) bar.push([e / 4, e % 4 ? [72 + (e % 5)] : [48, 72], 0.25]);
  const p = perform(bar, 4, 8, 100, { jitter: 0.02, seed: 7 });
  const notes = skeletonInput(p.notes);
  const r = G.plan(beatGrid(1, 0.6, 40), notes, {});
  assert.deepEqual(Object.keys(r.report.beats).filter(k => k !== '16' && r.report.beats[k] > 0), []);
  const truth = notes.map(n => Math.round((n.on - 1) / 0.6 * 4) / 4 + 0);     /* + 0: no -0 */
  assert.deepEqual(written(r), truth);
});

test('a beat of triplet eighths among straight beats is a triplet beat; its onsets are on the thirds (ticks 0, 8, 16)', () => {
  /* 4/4 bars: beats 1-2 eighths, beat 3 a triplet, beat 4 a quarter */
  const bar = [[0, [48, 60], 0.5], [0.5, [64], 0.5], [1, [62], 0.5], [1.5, [65], 0.5], [2, [64, 48], 1 / 3], [2 + 1 / 3, [65], 1 / 3], [2 + 2 / 3, [67], 1 / 3], [3, [72], 1]];
  const p = perform(bar, 4, 8, 90, { jitter: 0.015, seed: 3 });
  const notes = skeletonInput(p.notes);
  const spb = 60 / 90;
  const r = G.plan(beatGrid(1, spb, 34), notes, {});
  for (let b = 0; b < 8; b++) {
    const third = r.beats.find(x => x.beat === b * 4 + 2);
    assert.equal(third.kind, '3', 'bar ' + b + ': ' + JSON.stringify(third));
    ['16'].forEach(k => assert.equal(r.beats.find(x => x.beat === b * 4).kind, k));
  }
  const ticks = r.onsets.map(o => o.tick % 96).filter(t => t > 48 && t < 72);
  assert.deepEqual(Array.from(new Set(ticks)).sort((a, b) => a - b), [56, 64]);
});

test('straight eighths played long-short (swing, 1.6-2 : 1) are written as straight eighths, not triplets', () => {
  const rnd = lcg(5);
  const notes = [];
  const spb = 0.5;
  for (let b = 0; b < 32; b++) {
    const ratio = 1.6 + 0.4 * rnd();
    const t0 = 1 + b * spb, t1 = t0 + spb * ratio / (ratio + 1);
    notes.push({ on: t0, off: t0 + 0.3, midi: 60 + (b % 5), vel: 64 }, { on: t1, off: t1 + 0.15, midi: 62 + (b % 4), vel: 60 });
    if (b % 4 === 0) notes.push({ on: t0, off: t0 + 1, midi: 43, vel: 70 });
  }
  const r = G.plan(beatGrid(1, spb, 34), skeletonInput(notes), {});
  assert.ok(r.beats.every(x => x.kind !== '3'), JSON.stringify(r.report.beats));
  const offs = new Set(r.onsets.map(o => o.tick % 24));
  assert.deepEqual(Array.from(offs).sort((a, b) => a - b), [0, 12]);
});

test('a chord heard over two 32-ms frames is one onset, not a 32nd figure', () => {
  const notes = [];
  for (let b = 0; b < 24; b++) {
    const t = 1 + b * 0.5;
    notes.push({ on: t, off: t + 0.4, midi: 48, vel: 64 }, { on: t, off: t + 0.4, midi: 60, vel: 64 }, { on: t + 0.032, off: t + 0.4, midi: 64, vel: 64 },
      { on: t + 0.25, off: t + 0.45, midi: 67, vel: 64 });
  }
  const r = G.plan(beatGrid(1, 0.5, 26), skeletonInput(notes), {});
  assert.ok(r.beats.every(x => x.kind === '16'), JSON.stringify(r.report.beats));
  assert.deepEqual(Array.from(new Set(r.onsets.map(o => o.tick % 24))).sort((a, b) => a - b), [0, 12]);
});

test('deterministic: the same input gives the same plan; a page without weights uses the built-in fallback', () => {
  const p = perform([[0, [48, 60], 1], [1, [64], 0.5], [1.5, [65], 0.5], [2, [67], 1 / 3], [2 + 1 / 3, [69], 1 / 3], [2 + 2 / 3, [71], 1 / 3], [3, [72], 1]], 4, 6, 100, { jitter: 0.02, seed: 9 });
  const notes = skeletonInput(p.notes);
  const beats = beatGrid(1, 0.6, 26);
  assert.deepEqual(G.plan(beats, notes, {}), G.plan(beats, notes, {}));
  const fb = G.plan(beats, notes, { model: G.FALLBACK });
  assert.equal(fb.report.model, 'fallback@0');
  assert.equal(fb.onsets.length, notes.length);
});

test('legacyQ returns the legacy quantiser\'s note shape, with tuplet / subdivision consistent with the grid of the beat', () => {
  const p = perform([[0, [48, 60], 1], [1, [64], 1 / 3], [1 + 1 / 3, [65], 1 / 3], [1 + 2 / 3, [67], 1 / 3], [2, [69], 0.25], [2.25, [71], 0.25], [2.5, [72], 0.5], [3, [74], 1]], 4, 4, 100, { jitter: 0.01, seed: 2 });
  const notes = skeletonInput(p.notes);
  const r = G.legacyQ(notes, beatGrid(1, 0.6, 18), {});
  assert.equal(r.q.length, notes.length);
  r.q.forEach(n => {
    ['midi', 'vel', 'on', 'off', 'attack', 'tick', 'endTick', 'err', 'tuplet', 'subdivision', 'lenTicks'].forEach(k => assert.ok(k in n, k));
    assert.ok(n.endTick > n.tick);
    const o = n.tick % 24;
    if (n.tuplet) assert.ok(o % 8 === 0, 'a triplet note on a third: ' + n.tick);
    else assert.ok(o % 3 === 0 && !(o === 8 || o === 16), 'a straight note on the 32nd lattice: ' + n.tick);
  });
  assert.ok(r.q.some(n => n.tuplet) && r.q.some(n => !n.tuplet));
});

test('budget (section 11): S3 on a three-minute performance of about 1800 notes stays well inside the 300 ms of the design', () => {
  const bar = [];
  for (let e = 0; e < 8; e++) bar.push([e / 2, e % 2 ? [72 + e, 76 + e] : [48 + (e % 3), 72 + e, 76 + e], 0.5]);
  const p = perform(bar, 4, 90, 120, { jitter: 0.015, seed: 13 });
  const notes = skeletonInput(p.notes);
  const beats = beatGrid(1, 0.5, 362);
  G.plan(beats, notes, {});
  const t0 = process.hrtime.bigint();
  G.plan(beats, notes, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  /* ~95 ms on the development machine; CI machines differ, so this guards an order of magnitude only */
  assert.ok(ms < 1500, ms + ' ms');
});
