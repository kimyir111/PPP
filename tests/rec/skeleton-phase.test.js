/* G10a-1d (docs/GOALS/G10_AUDIO_TO_SCORE.md section 36): the bar phase of the time skeleton, from the notes and from the helper's beats.
   node --test tests/rec/skeleton-phase.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REC = require('../../rec/index.js');
const P = require('./phase-fixtures.js');
const { REPO, skeletonInput } = require('./helpers.js');

for (const [name, fn] of [['downMetreCheck', P.downMetreCheck], ['downPhaseCheck', P.downPhaseCheck], ['audioGateCheck', P.audioGateCheck], ['metricalCheck', P.metricalCheck],
  ['harmonyCheck', P.harmonyCheck], ['configCheck', P.configCheck], ['laterCheck', P.laterCheck], ['audioBarCheck', P.audioBarCheck]]) {
  const x = fn(REC);
  test(x.name, () => assert.ok(x.ok, name + ': ' + x.got + ' (want ' + x.want + ')'));
}

test('a model without downPhase reads the downbeats as before (the plain share of them on the bar lines, which shorter bars raise)', () => {
  const W = Object.assign({}, REC.loadWeights(), { downPhase: false });
  const att = REC.attacks.attacksOf(skeletonInput(P.laterStart(8, 0, 4).notes)), cls = REC.attacks.classes(att);
  const beats = []; for (let k = 0; k <= 32; k++) beats.push(1 + k * 0.5);
  const tr = REC.beats.audioTrack(beats, att), M = REC.model, fv = new Float64Array(M.FEATURES.length), D = M.FEATURES.indexOf('down');
  const fr = M.frame(att, cls, tr, 1, W.sigma, beats.filter((t, i) => i % 2 === 0));
  const phi = Math.round(REC.beats.position(tr.beats, 1) * 2) / 2;          /* the phase whose bar line is at 1 s */
  M.features(fr, M.BY_KEY['2/4'], phi, W.tables, fv, false);
  const two = fv[D];
  M.features(fr, M.BY_KEY['4/4'], phi, W.tables, fv, false);
  assert.ok(two > 0.9 && fv[D] > 0.4 && fv[D] < 0.6, 'plain shares ' + two + ' / ' + fv[D]);
});

test('the evaluation keeps the trainer\'s hold-out performances that start inside a bar (holdoutLater, never fitted)', () => {
  const T = require(path.join(REPO, 'rec', 'tools', 'train.js'));
  const ev = JSON.parse(fs.readFileSync(path.join(REPO, 'rec', 'tools', 'ai5a-v1.evaluation.json'), 'utf8'));
  assert.ok(ev.holdoutLater && ev.holdoutLater.n > 150, 'the evaluation keeps the later-start hold-out family');
  assert.ok(T.CONFIG.startsLater && T.CONFIG.startsLater.every > 0);
});

test('the trainer\'s startsLater: the notes, beats and bar lines before the cut are left out; the truth is otherwise the same', () => {
  const T = require(path.join(REPO, 'rec', 'tools', 'train.js'));
  const eighths = [], notes = [];
  for (let k = 0; k <= 40; k++) eighths.push(1 + k * 0.25);
  for (let k = 0; k < 36; k++) notes.push({ on: 1 + k * 0.25, off: 1 + k * 0.25 + 0.2, midi: 60 + (k % 5), vel: 64 });
  const row = { id: 'x|cover|none|s11', ref: 'x', input: { notes: notes, beats: eighths.filter((t, i) => i % 2 === 0), downbeats: [1, 3, 5, 7, 9] },
    truth: { time: [4, 4], qpm: 120, bar_starts: [1, 3, 5, 7, 9], eighths: eighths, first_full_q: 0, multi_time: false } };
  const r = T.startsLater(row);
  assert.ok(r, 'a 4/4 row of five bars starts later');
  const k = +/later(\d)$/.exec(r.id)[1];
  assert.ok(k >= 1 && k <= 3);
  const cut = 1 + k * 0.5 - 0.04;
  assert.ok(r.input.notes.every(n => n.on >= cut) && r.input.notes.length === notes.filter(n => n.on >= cut).length);
  assert.deepEqual(r.truth.bar_starts, [3, 5, 7, 9]);
  assert.ok(r.input.downbeats.every(t => t >= cut) && r.input.beats.every(t => t >= cut));
  assert.equal(T.startsLater(Object.assign({}, row, { truth: Object.assign({}, row.truth, { time: [3, 8] }) })), null, 'a one-beat bar has no later start');
});
