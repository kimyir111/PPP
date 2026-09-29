/* G9c: review/lib/neutral.js - both arms are drawn and sounded through one path; nothing an engine added survives, and printed
   accidentals are recomputed the same way for both. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const N = require(path.join(REPO, 'review/lib/neutral.js'));

const measures = fifths => [1, 2, 3].map(n => ({ number: n, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: fifths, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const note = (m, b, p, midi, extra) => Object.assign({ m: m, b: b, dur: 1, type: 'quarter', dots: 0, p: p, midi: midi, staff: 1, hand: 'r', rest: false, chord: false, voice: 1, acc: null }, extra || {});

test('neutralNotes drops everything an engine may have added and keeps only what the notes are', () => {
  const dirty = [
    note(1, 0, 'C4', 60, { finger: 3, sgHead: 'h1', sgEvent: 'e1', stem: 'up', tieStart: true, slurStart: true, voice: 5, ottavaShift: 0, writtenP: 'C4' }),
    { m: 1, b: 1, dur: 1, rest: true, staff: 1 },
    note(1, 2, 'E4', 64, { voice: 9 })
  ];
  const out = N.neutralNotes(measures(0), dirty);
  assert.equal(out.length, 2, 'the rest is gone');
  out.forEach(n => assert.deepEqual(Object.keys(n).sort(), ['acc', 'b', 'chord', 'dots', 'dur', 'hand', 'm', 'midi', 'p', 'rest', 'staff', 'type', 'voice']));
  assert.deepEqual(out.map(n => n.voice), [1, 1], 'voices are re-derived from the staff, not the engine\'s voice numbers');
});

test('the same notes in a different emission order (and with different engine fields) give byte-identical drawings and sound', () => {
  const a = [note(1, 0, 'C4', 60), note(1, 1, 'E4', 64), note(1, 0, 'C3', 48, { staff: 2, hand: 'l', voice: 2 }), note(2, 0, 'G4', 67, { dur: 2, type: 'half' })];
  const b = a.slice().reverse().map(n => Object.assign({}, n, { finger: 1, sgHead: 'x', voice: n.voice + 4, tieStart: false }));
  const ra = N.render(measures(0), 100, a, 'p-'), rb = N.render(measures(0), 100, b, 'p-');
  assert.equal(ra.svg, rb.svg);
  assert.deepEqual(ra.notes, rb.notes);
});

test('printed accidentals follow the key signature and the measure, whatever the engine put in acc', () => {
  /* C major: D#4, D#4 again (no second sign), D4 (natural), and the next measure starts clean */
  const notes = [note(1, 0, 'D#4', 63, { acc: 'flat' }), note(1, 1, 'D#4', 63), note(1, 2, 'D4', 62), note(2, 0, 'D#4', 63), note(2, 1, 'F4', 65, { acc: 'sharp' })];
  const out = N.neutralNotes(measures(0), notes);
  assert.deepEqual(out.map(n => n.acc), ['sharp', null, 'natural', 'sharp', null]);
  /* D major (2 sharps): F#4 and C#5 need no sign, F4 needs a natural, D#4 a sharp; an F#3 in the bass follows the key too */
  const d = [note(1, 0, 'F#4', 66), note(1, 1, 'C#5', 73), note(1, 2, 'F4', 65), note(1, 3, 'F4', 65), note(2, 0, 'D#4', 63), note(2, 1, 'F#3', 54, { staff: 2, hand: 'l' })];
  assert.deepEqual(N.neutralNotes(measures(2), d).map(n => n.acc), [null, null, 'natural', null, 'sharp', null]);
  /* flats: Bb major */
  const f = [note(1, 0, 'Bb4', 70), note(1, 1, 'B4', 71), note(1, 2, 'Bb4', 70)];
  assert.deepEqual(N.neutralNotes(measures(-2), f).map(n => n.acc), [null, 'natural', 'flat']);
});

test('the same accidental rule runs for both arms: a chromatic note gets its sign whichever engine wrote it', () => {
  const g9Style = [note(1, 0, 'D#4', 63, { acc: null, finger: 2 })];
  const legacyStyle = [note(1, 0, 'D#4', 63, { acc: 'sharp' })];
  const a = N.render(measures(0), 100, g9Style, 'p-'), b = N.render(measures(0), 100, legacyStyle, 'p-');
  assert.equal(a.svg, b.svg);
  assert.ok(/vf-accidental/.test(a.svg), 'the sign is drawn');
});

test('the drawing carries no data-* attribute, no graph fingerprint, no fingering, and a per-drawing glyph prefix only', () => {
  const svg = N.render(measures(0), 100, [note(1, 0, 'C4', 60, { finger: 1 }), note(1, 1, 'E4', 64)], 'i07X-').svg;
  assert.ok(!/ data-/.test(svg));
  assert.ok(!/ppp-fingering|data-plan|plan\/\d/.test(svg));
  assert.ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="score-svg" viewBox="[\d. ]+" fill="currentColor">/.test(svg), svg.slice(0, 200));
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 0 && ids.every(i => i.startsWith('i07X-')));
});

test('audio: a pitch struck by both hands at one onset sounds once (the drawn score keeps both)', () => {
  const both = [note(1, 0, 'C4', 60, { dur: 2, type: 'half' }), note(1, 0, 'C4', 60, { staff: 2, hand: 'l', voice: 2 }), note(1, 1, 'E4', 64)];
  assert.deepEqual(N.audioNotes(measures(0), both), [[0, 2, 60], [1, 1, 64]], 'one C4, the longer duration kept');
  assert.equal(N.neutralNotes(measures(0), both).length, 3, 'the drawing still has all three notes');
  /* the same for the other arm's style of notes */
  assert.deepEqual(N.audioNotes(measures(0), both.slice().reverse()), N.audioNotes(measures(0), both));
});

test('audio: a tied continuation is joined to the note it continues, not re-struck; a repeated note that is not tied is', () => {
  /* C4 half in bar 1 beats 2-4 tied across the barline to a quarter in bar 2, then a plain repeat of C4 */
  const tied = [note(1, 2, 'C4', 60, { dur: 2, type: 'half', tieStart: true }), note(2, 0, 'C4', 60, { tieStop: true }), note(2, 1, 'C4', 60)];
  assert.deepEqual(N.audioNotes(measures(0), tied), [[2, 3, 60], [5, 1, 60]]);
  /* a tieStop flag with nothing ending where it starts is just a note */
  assert.deepEqual(N.audioNotes(measures(0), [note(1, 0, 'C4', 60, { tieStop: true })]), [[0, 1, 60]]);
  /* the drawing does not merge (both arms alike); tied notes stay two drawn notes */
  assert.equal(N.neutralNotes(measures(0), tied).length, 3);
  /* an arm without tie flags (the legacy engine's shape) is unchanged */
  assert.deepEqual(N.audioNotes(measures(0), [note(1, 0, 'C4', 60), note(1, 1, 'C4', 60)]), [[0, 1, 60], [1, 1, 60]]);
});

test('density: drawn notes and the left-hand share, from the same neutral notes', () => {
  const ns = [note(1, 0, 'C4', 60), note(1, 0, 'C3', 48, { staff: 2, hand: 'l' }), note(1, 0, 'G3', 55, { staff: 2, hand: 'l' })];
  assert.deepEqual(N.density(measures(0), ns), { notes: 3, leftHand: 2 });
});

test('audio notes are [startQ, durQ, midi] from the measure list, rests excluded, sorted', () => {
  const ns = [note(2, 1, 'G4', 67, { dur: 2 }), note(1, 0, 'C4', 60), { m: 1, b: 2, dur: 1, rest: true }];
  assert.deepEqual(N.audioNotes(measures(0), ns), [[0, 1, 60], [5, 2, 67]]);
});
