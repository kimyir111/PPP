/* rec/hands.js, stage S4 (G10a-2, docs/GOALS/G10_AUDIO_TO_SCORE.md section 8): the staff of every heard note, and its
   wiring into toMusicXml (recording 'v2'; opts.hands). node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, lcg } = require('./helpers.js');
const H = require(path.join(REPO, 'rec', 'hands.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));
const AS = require(path.join(REPO, 'audio-score.js'));

const MODEL_FILE = path.join(REPO, 'rec', 'weights', 'hands-v1.json');

/* notes of a little piece: groups = [[seconds, [midi, ...]], ...], one tick per group */
function piece(groups, spq) {
  const notes = [];
  groups.forEach(([t, midis], i) => midis.forEach(m => notes.push({ midi: m, tick: i * 6, on: t, off: t + (spq || 0.25) })));
  return notes;
}
const staffOf = (notes, r) => notes.map((n, i) => [n.midi, r.staff[i]]);

test('the model file: its schema, a style per texture, a cost per table cell, within the section 11 budget', () => {
  const m = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  assert.equal(m.schema, H.SCHEMA);
  assert.deepEqual(m.styles.map(s => s.name), ['piano', 'chorale']);
  const L = H._.layout(m.params);
  m.styles.forEach(s => {
    assert.equal(s.costs.length, L.size);
    assert.ok(s.costs.every(c => Number.isInteger(c) && c >= 0));
  });
  H._.TABLES.forEach(t => assert.ok(Number.isFinite(m.weights[t]) && m.weights[t] >= 0, t));
  assert.ok(fs.statSync(MODEL_FILE).size < 100 * 1024, 'hand model under 100 KB (all rec/ models: 200 KB)');
  assert.ok(m.trained && /hold-out excluded/.test(m.trained.data));
});

test('assign: one staff (1 right / 2 left) and a confidence per note; a note that has a staff keeps it; a note without a pitch is left out', () => {
  const notes = piece([[0, [48, 64, 67, 72]], [0.5, [67]], [1, [43, 62, 65, 71]], [1.5, [67]]]);
  notes.push({ midi: 50, tick: 6, on: 0.5, staff: 2 });
  notes.push({ tick: 6, on: 0.5 });
  const r = H.assign(notes);
  assert.equal(r.staff.length, notes.length);
  r.staff.slice(0, -2).forEach(s => assert.ok(s === 1 || s === 2));
  r.conf.slice(0, -2).forEach(c => assert.ok(c >= 0 && c <= 1));
  assert.equal(r.staff[notes.length - 2], 2);
  assert.equal(r.conf[notes.length - 2], 1);
  assert.equal(r.staff[notes.length - 1], 0);
  assert.equal(r.report.notes, notes.length - 2);
  assert.equal(r.report.model, 'hands-v1');
  assert.ok(['piano', 'chorale'].includes(r.report.style));
});

test('assign is a pure function: the same notes in any order get the same staves, run after run', () => {
  const rnd = lcg(7);
  const groups = [];
  for (let i = 0; i < 64; i++) groups.push([i * 0.25, i % 4 === 0 ? [36 + (i % 12), 60 + (i % 7), 64 + (i % 5)] : [62 + Math.floor(rnd() * 14)]]);
  const notes = piece(groups);
  const a = H.assign(notes), b = H.assign(notes);
  assert.deepEqual(a, b);
  const order = notes.map((n, i) => i).sort((x, y) => (Math.imul(x + 1, 2654435761) >>> 0) - (Math.imul(y + 1, 2654435761) >>> 0));
  const c = H.assign(order.map(i => notes[i]));
  order.forEach((i, j) => { assert.equal(c.staff[j], a.staff[i]); assert.equal(c.conf[j], a.conf[i]); });
});

test('without ticks the onset groups come from the attack times (a chord one 32-ms frame apart is one group)', () => {
  const ticked = piece([[0, [48, 72]], [0.5, [52, 76]], [1, [55, 79]], [1.5, [60, 84]]]);
  const timed = ticked.map((n, i) => ({ midi: n.midi, on: n.on + (i % 2 ? 0.032 : 0) }));
  assert.deepEqual(H.assign(timed).staff, H.assign(ticked).staff);
});

test('parallel octaves (Hanon, Beyer\'s first pieces) are one note per hand, the lower in the left', () => {
  const run = [48, 50, 52, 53, 55, 53, 52, 50, 48, 52, 55, 60, 55, 52, 48, 47];
  const notes = piece(run.map((m, i) => [i * 0.25, [m, m + 12]]));
  const r = H.assign(notes);
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi === Math.min(...notes.filter(x => x.tick === n.tick).map(x => x.midi)) ? 2 : 1,
    'midi ' + n.midi + ' at tick ' + n.tick));
});

test('a left-hand broken chord in the treble stays in the left hand under a right-hand melody (Beyer 52), where the legacy split moved it', () => {
  const bar = (c, melody) => [[0, [c, melody[0]]], [0.25, [c + 4]], [0.5, [c + 7, melody[1]]], [0.75, [c + 4]], [1, [c, melody[2]]], [1.25, [c + 4]], [1.5, [c + 7]]];
  const groups = [];
  [[60, [76, 74, 72]], [59, [74, 79, 77]], [60, [76, 74, 72]], [60, [76, 74, 72]]].forEach(([c, mel], b) =>
    bar(c, mel).forEach(([t, m]) => groups.push([b * 2 + t, m])));
  const notes = piece(groups);
  const r = H.assign(notes);
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi >= 72 ? 1 : 2, 'midi ' + n.midi + ' at tick ' + n.tick));
});

test('a four-part chorale is read as a chorale: soprano and alto in the upper staff, tenor and bass in the lower', () => {
  const chords = [[48, 55, 64, 72], [53, 57, 65, 72], [55, 59, 62, 71], [48, 55, 64, 72], [45, 57, 64, 72], [50, 57, 65, 69],
    [43, 55, 62, 71], [48, 52, 60, 67], [41, 57, 60, 69], [43, 55, 59, 67], [48, 55, 64, 72], [55, 59, 62, 67]];
  const notes = piece(chords.map((c, i) => [i * 0.6, c]));
  const r = H.assign(notes);
  assert.equal(r.report.style, 'chorale');
  notes.forEach((n, i) => {
    const g = notes.filter(x => x.tick === n.tick).map(x => x.midi).sort((a, b) => a - b);
    assert.equal(r.staff[i], g.indexOf(n.midi) < 2 ? 2 : 1, 'midi ' + n.midi + ' at tick ' + n.tick);
  });
});

test('piano block chords are not a chorale: a bass note under a right-hand triad is one plus three (Czerny 599 no. 35)', () => {
  const groups = [];
  for (let b = 0; b < 8; b++) {
    const bass = [36, 43, 36, 43][b % 4], triad = b % 2 ? [62, 67, 71] : [64, 67, 72];
    groups.push([b * 2, [bass].concat(triad)], [b * 2 + 0.5, [bass + 12].concat(triad)], [b * 2 + 1, [bass + 12].concat(triad)], [b * 2 + 1.5, [bass + 12]]);
  }
  const notes = piece(groups);
  const r = H.assign(notes);
  assert.equal(r.report.style, 'piano');
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi < 60 ? 2 : 1, 'midi ' + n.midi + ' at tick ' + n.tick));
});

test('no model, no guess: assign throws E-HANDS-NO-MODEL; under v2 toMusicXml then keeps the legacy split and says so', () => {
  assert.throws(() => H.assign(piece([[0, [60]]]), { model: { schema: 'something else' } }), e => e.code === 'E-HANDS-NO-MODEL');
  const notes = [];
  for (let i = 0; i < 48; i++) notes.push({ on: 1 + i * 0.25, off: 1.2 + i * 0.25, midi: i % 4 === 0 ? 48 : 64 + (i % 5), vel: 64 });
  H.setModel({ schema: 'not the hand model' });
  try {
    const r = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
    assert.deepEqual(r.handsReport, { fallback: 'legacy', code: 'E-HANDS-NO-MODEL' });
    const legacyHands = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2', hands: 'legacy' });
    assert.equal(r.xml, legacyHands.xml);
    /* asked for by name, a missing model is an error: a measurement must know which hands ran */
    assert.throws(() => AS.toMusicXml({ notes: notes }, { title: 't', hands: 'v2' }), e => e.code === 'E-HANDS-NO-MODEL');
  } finally {
    H.setModel(null);
  }
});

test('toMusicXml: v2 writes S4\'s hands and reports them; hands \'legacy\' keeps assignHands under v2; without options nothing changes', () => {
  const notes = [];
  /* a left-hand broken chord in the treble under a melody: the legacy split puts the figure's top in the right hand */
  for (let b = 0; b < 12; b++) {
    const t0 = 1 + b * 2;
    [[0, 60], [0.25, 64], [0.5, 67], [0.75, 64], [1, 60], [1.25, 64], [1.5, 67], [1.75, 64]].forEach(([q, m]) =>
      notes.push({ on: t0 + q, off: t0 + q + 0.24, midi: m, vel: 60 }));
    [[0, 76], [0.5, 74], [1, 72]].forEach(([q, m]) => notes.push({ on: t0 + q, off: t0 + q + 0.48, midi: m, vel: 70 }));
  }
  const base = { title: 't', closeGaps: true, exactBars: true };
  const v2 = AS.toMusicXml({ notes: notes }, Object.assign({ recording: 'v2' }, base));
  assert.ok(v2.handsReport && v2.handsReport.model === 'hands-v1', JSON.stringify(v2.handsReport));
  assert.equal(v2.stats.lh, notes.filter(n => n.midi < 72).length);
  const v2legacy = AS.toMusicXml({ notes: notes }, Object.assign({ recording: 'v2', hands: 'legacy' }, base));
  assert.equal(v2legacy.handsReport, undefined);
  assert.ok(v2legacy.stats.lh < v2.stats.lh, 'the legacy split moved part of the figure: ' + v2legacy.stats.lh);
  /* the app's path and the library default: no handsReport, the legacy split (the bench's ab proves byte identity) */
  assert.equal(AS.toMusicXml({ notes: notes }, base).handsReport, undefined);
  assert.equal(AS.toMusicXml({ notes: notes }, {}).handsReport, undefined);
  /* the app's path with only S4 swapped (the rec-hands measurement suite) */
  assert.equal(AS.toMusicXml({ notes: notes }, Object.assign({ hands: 'v2' }, base)).handsReport.model, 'hands-v1');
  /* rec/index.js exposes the stage */
  assert.equal(REC.hands, H);
});

test('budget (section 11): S4 on a 1,800-note piece in well under the 300 ms all of rec/ may take', () => {
  const rnd = lcg(3);
  const notes = [];
  for (let i = 0; i < 600; i++) {
    const t = i * 0.1, bass = 36 + Math.floor(rnd() * 12);
    notes.push({ midi: bass, tick: i * 3, on: t }, { midi: bass + 7 + Math.floor(rnd() * 5), tick: i * 3, on: t },
      { midi: 64 + Math.floor(rnd() * 20), tick: i * 3, on: t });
  }
  H.assign(notes);
  const t0 = process.hrtime.bigint();
  H.assign(notes);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 250, 'S4 took ' + ms.toFixed(1) + ' ms');
});
