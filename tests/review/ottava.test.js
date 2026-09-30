/* TD16: review/lib/neutral.js applies the automatic 8va/8vb (realize/ottava.js) to BOTH arms through the one drawing path.
   The drawing changes (notes far off the staff print an octave away under a line and label); the sound must not, and nothing
   about the pass may tell one arm from the other. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const N = require(path.join(REPO, 'review/lib/neutral.js'));

const measures = [1, 2, 3].map(n => ({ number: n, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const note = (m, b, p, midi, extra) => Object.assign({ m: m, b: b, dur: 0.5, type: 'eighth', dots: 0, p: p, midi: midi, staff: 1, hand: 'r', rest: false, chord: false, voice: 1, acc: null }, extra || {});
/* bar 1: a right-hand run up to A6 (3 to 4 ledger lines); bar 2: a left-hand bass on A1/C2 (3 and 2 lines); a plain bar 3 */
const HIGH = [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93]].map((x, i) => note(1, i * 0.5, x[0], x[1]));
const LOW = [['A1', 33], ['C2', 36], ['A1', 33], ['E2', 40]].map((x, i) => note(2, i, x[0], x[1], { staff: 2, hand: 'l', voice: 2, dur: 1, type: 'quarter' }));
const PLAIN = [note(3, 0, 'C5', 72, { dur: 1, type: 'quarter' }), note(3, 1, 'E5', 76, { dur: 1, type: 'quarter' }), note(3, 0, 'C3', 48, { dur: 1, type: 'quarter', staff: 2, hand: 'l', voice: 2 })];
const labels = svg => [...svg.matchAll(/>(8va|8vb|15ma|15mb|\(8\)|\(15\))</g)].map(m => m[1]);

test('a drawing with notes far off the staff carries 8va and 8vb, and one without them is byte-identical to the drawing without the pass', () => {
  const extreme = HIGH.concat(LOW.map(n => Object.assign({}, n, { m: 2 })));
  const on = N.render(measures, 100, extreme, 'p-'), off = N.render(measures, 100, extreme, 'p-', { ottava: false });
  assert.notEqual(on.svg, off.svg);
  const found = labels(on.svg);
  assert.ok(found.includes('8va') && found.includes('8vb'), 'labels drawn: ' + found.join(','));
  assert.deepEqual(labels(off.svg), []);
  const plain = N.render(measures, 100, PLAIN, 'p-'), plainOff = N.render(measures, 100, PLAIN, 'p-', { ottava: false });
  assert.equal(plain.svg, plainOff.svg, 'nothing to do: not one byte differs');
});

test('the sound is the sounding pitch: the audio note list is the same with and without the ottava pass', () => {
  const extreme = HIGH.concat(LOW.map(n => Object.assign({}, n, { m: 2 })), PLAIN);
  const on = N.render(measures, 100, extreme, 'p-'), off = N.render(measures, 100, extreme, 'p-', { ottava: false });
  assert.deepEqual(on.notes, off.notes);
  assert.deepEqual(on.notes, N.audioNotes(measures, extreme));
  /* the extreme pitches are still there, unshifted, in the audio */
  const midis = on.notes.map(n => n[2]);
  [88, 89, 91, 93, 33, 36, 40, 72, 76, 48].forEach(m => assert.ok(midis.includes(m), 'midi ' + m + ' sounds'));
});

test('both arms go through the same pass: engine-specific fields and emission order make no difference to the drawing, 8va included', () => {
  const a = HIGH.concat(LOW.map(n => Object.assign({}, n, { m: 2 })), PLAIN);
  /* the "other engine": fingering, ids, tie flags and different voice numbers, notes in the reverse order */
  const b = a.slice().reverse().map(n => Object.assign({}, n, { finger: 2, sgHead: 'x', tieStart: false, voice: n.voice + 4 }));
  const ra = N.render(measures, 100, a, 'p-'), rb = N.render(measures, 100, b, 'p-');
  assert.equal(ra.svg, rb.svg);
  assert.ok(labels(ra.svg).length >= 2);
  assert.deepEqual(ra.notes, rb.notes);
});

test('the ottava labels carry no data-* attribute or engine name, like the rest of the drawing', () => {
  const svg = N.render(measures, 100, HIGH.concat(LOW.map(n => Object.assign({}, n, { m: 2 }))), 'i03X-').svg;
  assert.ok(labels(svg).length >= 2);
  assert.ok(!/ data-/.test(svg));
  assert.ok(!/g9|legacy|ScoreArranger/i.test(svg.replace(/id="[^"]*"/g, '')), 'no engine name');
});
