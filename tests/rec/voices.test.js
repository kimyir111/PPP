/* rec/voices.js (S5), G10a-3: the voices of each staff. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const VO = require(path.join(REPO, 'rec', 'voices.js'));

/* a placed note: ticks (24 a quarter) and heard seconds at 120 bpm (a quarter = 0.5 s) */
const N = (tick, midi, staff, offSec, voice) => ({ tick: tick, endTick: tick + 6, midi: midi, staff: staff || 1, voice: voice || 1, on: tick / 48, off: offSec != null ? offSec : tick / 48 + 0.45, vel: 64 });

test('S5: piano writing keeps one voice per staff', () => {
  const notes = [N(0, 60, 1), N(0, 64, 1), N(24, 62, 1), N(0, 48, 2), N(0, 55, 2)];
  const r = VO.assign(notes, { style: 'piano' });
  assert.ok(r.voice.every(v => v === 1));
});

test('S5: four-part writing splits each staff into an upper and a lower part; a single note goes to the part it continues', () => {
  /* lower staff: tenor and bass in quarters, then the bass alone (held tenor), then both again */
  const notes = [];
  [[0, 55, 43], [24, 57, 45], [48, 59, 47], [72, 60, 48]].forEach(([t, ten, bas]) => { notes.push(N(t, ten, 2, t / 48 + 0.45), N(t, bas, 2, t / 48 + 0.45)); });
  /* beat 5: the tenor holds, the bass moves alone (by step: it continues the bass) */
  notes.push(N(96, 62, 2, 3.0), N(96, 50, 2, 2.45), N(120, 52, 2, 2.95), N(144, 64, 2), N(144, 53, 2));
  const r = VO.assign(notes, { style: 'chorale' });
  notes.forEach((n, i) => { if (n.tick !== 120) assert.equal(r.voice[i], n.midi >= 55 ? 1 : 2, 'note ' + n.midi + ' at ' + n.tick); });
  assert.equal(r.voice[notes.findIndex(n => n.tick === 120)], 2, 'the single note that continues the bass belongs to it');
  assert.deepEqual(r.report.staves, [0, 2]);
});

test('S5: a staff of block chords is one part even in a chorale-style piece', () => {
  const notes = [];
  for (let t = 0; t < 192; t += 24) notes.push(N(t, 60, 1), N(t, 64, 1), N(t, 67, 1), N(t, 48, 2), N(t, 55, 2));
  const r = VO.assign(notes, { style: 'chorale' });
  assert.ok(notes.every((n, i) => n.staff === 2 || r.voice[i] === 1), 'the three-note chords of the upper staff stay one voice');
  assert.deepEqual(r.report.staves, [1, 2]);
});
