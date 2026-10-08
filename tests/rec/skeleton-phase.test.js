/* G10a-1d (docs/GOALS/G10_AUDIO_TO_SCORE.md section 36): the phase step after the metre model, and the helper's beats.
   node --test tests/rec/skeleton-phase.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REC = require('../../rec/index.js');
const P = require('./phase-fixtures.js');
const { REPO } = require('./helpers.js');

for (const [name, fn] of [['decoupledCheck', P.decoupledCheck], ['laterCheck', P.laterCheck], ['helperGateCheck', P.helperGateCheck], ['audioGateCheck', P.audioGateCheck],
  ['downPhaseCheck', P.downPhaseCheck], ['harmonyCheck', P.harmonyCheck], ['configCheck', P.configCheck], ['groupCheck', P.groupCheck]]) {
  const x = fn(REC);
  test(x.name, () => assert.ok(x.ok, name + ': ' + x.got + ' (want ' + x.want + ')'));
}

test('the evaluation keeps the phase step before and after on every set (the hold-out performances that start inside a bar included)', () => {
  const ev = JSON.parse(fs.readFileSync(path.join(REPO, 'rec', 'tools', 'ai5a-v1.evaluation.json'), 'utf8'));
  assert.ok(ev.phase && ev.phase.holdoutLater && ev.phase.holdoutLater.n > 150, 'the evaluation keeps the later-start hold-out');
  assert.ok(ev.phase.holdoutLater.rightAfter > ev.phase.holdoutLater.rightBefore, JSON.stringify(ev.phase.holdoutLater));
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

test('steadyShare: one bar is steady, a mixture of bars and half bars is not', () => {
  const t = []; for (let k = 0; k < 40; k++) t.push(1 + k * 2);
  assert.ok(REC.beats.steadyShare(t) > 0.99);
  const mixed = []; let x = 1; for (let k = 0; k < 40; k++) { mixed.push(x); x += k % 3 === 2 ? 2 : 1; }
  assert.ok(REC.beats.steadyShare(mixed) < 0.8, String(REC.beats.steadyShare(mixed)));
});
