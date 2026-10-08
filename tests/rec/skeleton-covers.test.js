/* rec/ S1-S2 on pieces shaped like the covers users record (G10a-1b, docs/GOALS/G10_AUDIO_TO_SCORE.md section 28): long
   performances (the per-beat evidence cap) and swung eighths (the swung frames of the simple metres).
   node --test tests/rec/skeleton-covers.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, march, skeletonInput } = require('./helpers.js');
const ATT = require(path.join(REPO, 'rec', 'attacks.js'));
const BEATS = require(path.join(REPO, 'rec', 'beats.js'));
const MODEL = require(path.join(REPO, 'rec', 'model.js'));
const METRE = require(path.join(REPO, 'rec', 'metre.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));

const FX = require('./covers-fixtures.js');
const { pop, swung } = FX;
const W = REC.loadWeights();
/* the same weights without the G10a-1b terms read at inference (no cap, no swung frames, no convention preference) */
const WITHOUT = Object.assign({}, W, { beatCap: 0, swing: null, conventionPrior: null, metricalRho: false });
const read = (p, w) => REC.skeleton(skeletonInput(p.notes), { weights: w || W });

test('the committed model carries both terms: a beat cap within the training lengths and swung frames', () => {
  assert.ok(W.beatCap > 0 && W.beatCap <= 334, 'beatCap ' + W.beatCap);
  assert.ok(Array.isArray(W.swing) && W.swing.length >= 1 && W.swing.every(s => s > 0.5 && s < 0.75), 'swing ' + JSON.stringify(W.swing));
  assert.equal(W.weights.length, MODEL.FEATURES.length);
  assert.ok(MODEL.FEATURES.indexOf('swing') === 25 && MODEL.FEATURES[MODEL.FEATURES.length - 1] === 'hbar', 'G10a-1d appended hbar after swing');
  assert.ok(W.conventionPrior && W.conventionPrior['2/4'] < 0 && Object.keys(W.conventionPrior).length === 1, 'conventionPrior ' + JSON.stringify(W.conventionPrior));
});

test('the committed model is the trainer\'s configuration: the cap, the swing points, the convention preference (rec/tools/train.js CONFIG)', () => {
  const x = FX.configCheck(REC);
  assert.ok(x.ok, x.got + ' (want ' + x.want + ')');
});

test('a swung frame looks for each attack\'s written slot 1.5 times as far as the straight frame', () => {
  const x = FX.windowCheck(REC);
  assert.ok(x.ok, x.got);
});

test('the convention preference: 2/4 against 4/4 moves by the prior when no downbeats are heard, and (G10a-1d, downbeats as phase) when they are', () => {
  const x = FX.priorCheck(REC);
  assert.ok(x.ok, x.got + ' (want ' + x.want + ')');
});

test('scaled(): the per-beat evidence grows with the beats up to the cap, then stays; the other features do not move', () => {
  const F = MODEL.FEATURES.length, fv = new Float64Array(F).fill(1), a = new Float64Array(F), b = new Float64Array(F), c = new Float64Array(F);
  MODEL.scaled(fv, 400, [0, 0.5], a, 80, 0);         /* no cap */
  MODEL.scaled(fv, 400, [0, 0.5], b, 80, 100);       /* under the cap: the same */
  MODEL.scaled(fv, 400, [0, 0.5], c, 900, 100);      /* over it: sqrt(100) / 900 per unit of summed evidence */
  for (let k = 0; k < F; k++) assert.equal(a[k], b[k], MODEL.FEATURES[k]);
  for (let k = 0; k < MODEL.PER_ATTACK; k++) assert.equal(c[k], 1 / 400);
  for (let k = MODEL.PER_ATTACK; k < MODEL.PER_BEAT; k++) assert.ok(Math.abs(c[k] - Math.sqrt(100) / 900) < 1e-15, MODEL.FEATURES[k]);
  /* G10a-1d: the harmonic rhythm (hbar) is per-beat evidence too */
  assert.ok(Math.abs(c[MODEL.HBAR] - Math.sqrt(100) / 900) < 1e-15, 'hbar');
  for (let k = MODEL.PER_BEAT; k < F; k++) if (k !== MODEL.HBAR) assert.equal(c[k], 1);
  /* the same music k times as long weighs the same once past the cap (a sum that grows with the beats, divided by the beats, times
     the square root of the counted beats) */
  [2, 4, 8].forEach(k => {
    const x = new Float64Array(F);
    MODEL.scaled(new Float64Array(F).fill(0.2 * 120 * k), 400 * k, [0, 0.5], x, 120 * k, 100);
    for (let j = MODEL.PER_ATTACK; j < MODEL.PER_BEAT; j++) assert.ok(Math.abs(x[j] - 0.2 * 10) < 1e-12, 'x' + k);
  });
  /* the same evidence per beat over three times the beats (a 3/8 reading counts eighths) weighs no more once both are capped */
  const d = new Float64Array(F), e = new Float64Array(F);
  MODEL.scaled(new Float64Array(F).fill(300), 400, [0, 0.5], d, 300, 100);
  MODEL.scaled(new Float64Array(F).fill(900), 400, [0, 0.5], e, 900, 100);
  for (let k = MODEL.PER_ATTACK; k < MODEL.PER_BEAT; k++) assert.ok(Math.abs(d[k] - e[k]) < 1e-12);
});

test('swingHeard and swingWritten are inverses; s = 1/2 is straight; the quarter phase o moves the quarters', () => {
  [0.6, 0.64, 2 / 3].forEach(s => [0, 12].forEach(o => {
    for (let c = -30; c <= 60; c += 1) assert.ok(Math.abs(MODEL.swingWritten(MODEL.swingHeard(c, s, o), s, o) - c) < 1e-9, s + ' ' + o + ' ' + c);
    assert.ok(Math.abs(MODEL.swingHeard(o + 12, s, o) - (o + 24 * s)) < 1e-9);    /* the second eighth of a quarter is heard at s */
    assert.equal(MODEL.swingHeard(o + 24, s, o), o + 24);                          /* the beats do not move */
  }));
  for (let c = 0; c < 48; c++) assert.ok(Math.abs(MODEL.swingHeard(c, 0.5, 0) - c) < 1e-12);
});

test('the hypotheses: swung readings only for the simple metres, each on the quarter phase of its frame', () => {
  const att = ATT.attacksOf(skeletonInput(march(8, 100, {}).notes));
  const tracks = BEATS.tracks(att, {});
  const H = METRE.hypotheses(att, ATT.classes(att), tracks, W.tables, { sigma: W.sigma, swing: W.swing });
  const sw = H.list.filter(h => h.swing);
  assert.ok(sw.length > 0);
  sw.forEach(h => {
    assert.ok(!MODEL.METRES[h.mi].compound);
    assert.equal(Math.round(h.phi * MODEL.R) % MODEL.R, H.frames[h.fr].swing.o);
    assert.equal(H.frames[h.fr].swing.s, h.swing);
  });
  /* without swing points: exactly the readings of ai5a-v1 (every metre, every eighth-note phase of each frame) */
  const H0 = METRE.hypotheses(att, ATT.classes(att), tracks, W.tables, { sigma: W.sigma });
  const perFrame = MODEL.METRES.reduce((s, m) => s + Math.round(m.barQ / MODEL.PHASE_STEP_Q), 0);
  assert.equal(H0.list.length, H0.frames.length * perFrame);
  assert.equal(H0.list.filter(h => h.swing).length, 0);
});

test('cover-shaped pieces: long (96 bars of a march, a waltz, a jig) and swung (a pop bar at 8, 32 and 96 bars) keep their metre and tempo; the pop bar straight at 32 bars', () => {
  FX.check(REC).forEach(x => assert.ok(x.ok, x.name + ': ' + x.got + ' (want ' + x.want + ')'));
});

test('known limit: a straight pop bar played 96 bars is read 6/8 at quarter 60 (both readings past the cap, 0.11 nats apart)', { todo: 'G10a-1b limit, G10 section 28.8' }, () => {
  FX.check(REC, FX.knownLimits()).forEach(x => assert.ok(x.ok, x.name + ': ' + x.got + ' (want ' + x.want + ')'));
});

/* the two terms are what makes the difference: without them the same model reads these pieces as before G10a-1b (the
   failures of the real covers: a long piece in 3/8 or 6/8, a swung one in 3/8 at one and a half times its tempo) */
test('without the cap and the swung frames the long and the swung pieces are misread (what G10a-1b fixed)', () => {
  const long = read(pop(96, 120, { jitter: 0.02, seed: 4 }), WITHOUT);
  assert.notEqual(long.metre.key, '4/4', 'the long pop piece was read right without the terms: the test no longer shows the cause');
  const sw = read(swung(pop(32, 120, { jitter: 0.02, seed: 4 }), 120, 0.65, 1), WITHOUT);
  assert.ok(sw.metre.compound, 'the swung piece was read in a simple metre without the swung frames: ' + sw.metre.key);
});

test('the trainer\'s held-out families: a performance played k times keeps its bar grid; swung all through moves only the off-beat eighths', () => {
  const T = require(path.join(REPO, 'rec', 'tools', 'train.js'));
  /* a 4/4 row at 120 (0.5 s a quarter), two bars, eighths from 1 s */
  const eighths = [], notes = [];
  for (let k = 0; k <= 18; k++) eighths.push(1 + k * 0.25);
  for (let k = 0; k < 16; k++) notes.push({ on: 1 + k * 0.25, off: 1 + k * 0.25 + 0.2, midi: 60 + (k % 5), vel: 64 });
  const row = { id: 'x|cover|none|s11', ref: 'x', input: { notes: notes }, truth: { time: [4, 4], qpm: 120, bar_starts: [1, 3, 5], eighths: eighths, first_full_q: 0, multi_time: false } };
  const r3 = T.repeated(row, 3);
  assert.equal(r3.input.notes.length, 48);
  assert.deepEqual(r3.truth.bar_starts, [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.equal(r3.input.notes[16].on, 7);                     /* the second copy starts a whole number of bars later */
  assert.equal(T.repeated(row, 1), row);
  const sw = T.swungAll(row);
  const s = sw.input.notes[1].on - 1.0;                       /* the first off-beat eighth, as a share of the 0.5 s quarter */
  assert.ok(s / 0.5 >= 0.6 - 1e-9 && s / 0.5 <= 0.6667 + 1e-9, 'swing point ' + s / 0.5);
  sw.input.notes.forEach((n, k) => { if (k % 2 === 0) assert.ok(Math.abs(n.on - notes[k].on) < 1e-9, 'an on-beat eighth moved'); });
  assert.equal(T.swungAll(Object.assign({}, row, { truth: Object.assign({}, row.truth, { time: [6, 8] }) })), null);
});

test('a model without beatCap and swing (ai5a-v1) reads as it was trained: no swung reading, no cap', () => {
  const p = march(16, 100, { jitter: 0.015, seed: 2 });
  const a = read(p, WITHOUT);
  assert.ok(!a.report.chosen.swing);
  const att = ATT.attacksOf(skeletonInput(p.notes));
  const tracks = BEATS.tracks(att, { tight: W.tight, maxTracks: W.maxTracks });
  const ch = METRE.choose(att, ATT.classes(att), tracks, WITHOUT, {});
  assert.equal(ch.count, METRE.hypotheses(att, ATT.classes(att), tracks, W.tables, { sigma: W.sigma }).list.length);
});
