/* rec/rests.js (S6, AI-5b), G10a-3: the silence classifier. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { REPO } = require('./helpers.js');
const RS = require(path.join(REPO, 'rec', 'rests.js'));

/* a placed note: ticks (24 a quarter) and heard seconds at 120 bpm (a quarter = 0.5 s) */
const N = (tick, midi, staff, offSec, voice) => ({ tick: tick, endTick: tick + 6, midi: midi, staff: staff || 1, voice: voice || 1, on: tick / 48, off: offSec != null ? offSec : tick / 48 + 0.45, vel: 64 });
const cand = (a, b, end) => ({ staff: a.staff, voice: a.voice, start: a.tick, end: end, next: b.tick, notes: [a], nextNotes: [b] });

test('S6: the committed model matches the features; without a model every candidate is a rest (the REST_MIN rule)', () => {
  const W = JSON.parse(fs.readFileSync(path.join(REPO, 'rec', 'weights', 'ai5b-rests-v1.json'), 'utf8'));
  assert.equal(W.schema, RS.SCHEMA);
  assert.deepEqual(W.features, RS.FEATURES.slice());
  assert.ok(W.form === 'logistic' ? W.weights.length === RS.FEATURES.length : Array.isArray(W.trees));
  assert.ok(W.threshold > 0.2 && W.threshold < 0.9);
  const a = N(0, 60, 1, 0.1), b = N(48, 62, 1);
  /* a page without the weights: every candidate is a rest, as the REST_MIN rule wrote it */
  RS.setModel(null);
  try {
    const rule = RS.decide([cand(a, b, 12), cand(b, a, 60)], { bar: 96, unit: 24, notes: [a, b] });
    assert.deepEqual(rule.rest, [true, true]);
    assert.equal(rule.report.model, 'rule');
  } finally { RS.setModel(W); }
  assert.ok(RS.decide([cand(a, b, 12)], { bar: 96, unit: 24, notes: [a, b] }).report.model.startsWith('ai5b-rests@'));
});

test('S6: a note held to the next onset is legato; a short note before a long silence on the beat, with the other hand silent too, is a rest', () => {
  /* the same written gap (an eighth at the end of a quarter) heard two ways */
  const held = N(0, 60, 1, 0.99), nxt = N(48, 62, 1);
  const shortly = N(96, 64, 1, 2.05), nxt2 = N(144, 65, 1);
  const notes = [held, nxt, shortly, nxt2];
  const d = RS.decide([cand(held, nxt, 24), cand(shortly, nxt2, 120)], { bar: 96, unit: 24, notes: notes });
  assert.equal(d.rest[0], false, 'a note heard to the next onset is not followed by a rest (p ' + d.p[0] + ')');
  assert.ok(d.p[1] > d.p[0], 'a note released early before a long silence is likelier a rest');
});

test('S6: features are deterministic and bounded', () => {
  const notes = [N(0, 60, 1, 0.2), N(24, 62, 1, 0.6), N(48, 64, 1, 0.8), N(72, 48, 2, 1.9), N(96, 67, 1)];
  const cs = [cand(notes[0], notes[1], 12), cand(notes[1], notes[2], 36), cand(notes[2], notes[4], 60)];
  const X1 = RS.features(cs, { bar: 96, unit: 24, notes: notes, pedals: [{ on: 0.5, off: 1.2 }] });
  const X2 = RS.features(cs, { bar: 96, unit: 24, notes: notes, pedals: [{ on: 0.5, off: 1.2 }] });
  assert.deepEqual(X1.map(x => Array.from(x)), X2.map(x => Array.from(x)));
  X1.forEach(x => { assert.equal(x.length, RS.FEATURES.length); x.forEach(v => assert.ok(isFinite(v) && Math.abs(v) <= 8)); });
  assert.equal(X1[0][RS.FEATURES.indexOf('pedalKnown')], 1);
});
