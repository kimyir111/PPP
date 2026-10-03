/* G10c-0: the pure rec-arrange metrics on hand-made notes (tests/bench/node/rec-arrange-metrics.js). Each metric has a case that moves it and a case that must not. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./rec-arrange-metrics.js');

const n = (q0, q1, midi, staff, tieStop) => ({ q0, q1, midi, staff, tieStop: !!tieStop });
const melody = [{ q: 0, midi: 72 }, { q: 1, midi: 74 }, { q: 2, midi: 76 }, { q: 3, midi: 77 }];

test('a melody kept in the upper staff: kept 1, no gap', () => {
  const ix = M.indexNotes([n(0, 1, 72, 0), n(1, 2, 74, 0), n(2, 3, 76, 0), n(3, 4, 77, 0), n(0, 4, 48, 1)]);
  assert.deepEqual(M.melodyStats(ix, melody), { kept: 1, cross: 0, lost: 0, gap_rate: 0 });
});

test('a melody note the hand split gave to the lower staff: cross, and a gap in the upper staff', () => {
  const ix = M.indexNotes([n(0, 1, 72, 0), n(1, 2, 74, 1), n(2, 3, 76, 0), n(3, 4, 77, 0)]);
  assert.deepEqual(M.melodyStats(ix, melody), { kept: 0.75, cross: 0.25, lost: 0, gap_rate: 0.25 });
});

test('a melody note nowhere: lost, and a gap; a note held through the onset is no gap', () => {
  const lost = M.indexNotes([n(0, 1, 72, 0), n(2, 3, 76, 0), n(3, 4, 77, 0)]);
  assert.deepEqual(M.melodyStats(lost, melody), { kept: 0.75, cross: 0, lost: 0.25, gap_rate: 0.25 });
  /* the 74 is lost, but the upper staff sounds the 72 through it: lost without a gap (a different defect) */
  const held = M.indexNotes([n(0, 2, 72, 0), n(2, 3, 76, 0), n(3, 4, 77, 0)]);
  assert.deepEqual(M.melodyStats(held, melody), { kept: 0.75, cross: 0, lost: 0.25, gap_rate: 0 });
});

test('a tie continuation is no onset; the position slack is 0.15 quarter; another pitch does not count', () => {
  const ix = M.indexNotes([n(0, 1, 72, 0), n(1.1, 2, 74, 0), n(2, 3, 77, 0), n(3, 4, 77, 0, true)]);
  const s = M.melodyStats(ix, melody);
  assert.equal(s.kept, 0.5);                    /* 72 and 74 (1.1 is within 0.15); 76 was written as 77; the tied 77 is not an onset */
  assert.equal(s.lost, 0.5);
  assert.equal(M.melodyStats(ix, []), null);
});

test('the attacks of the melody hand that are no melody note: an accompaniment note in it is counted, a melody note is not', () => {
  const ix = M.indexNotes([n(0, 1, 72, 0), n(1, 2, 74, 0), n(2, 3, 62, 0), n(3, 4, 77, 0, true), n(0, 4, 48, 1)]);
  assert.equal(M.notMelody(ix, melody), 1 / 3);            /* 72 and 74 are melody, the 62 is not; the tied 77 is no attack; the left hand is not counted */
  assert.equal(M.notMelody(M.indexNotes([n(0, 4, 48, 1)]), melody), null);
});

test('chord agreement counts only the positions a window covers', () => {
  const win = [{ q0: 0, q1: 2, chord: '0:maj' }, { q0: 2, q1: 4, chord: '7:maj' }];
  assert.equal(M.chordAgreement(win, [{ q: 1, chord: '0:maj' }, { q: 3, chord: '0:maj' }, { q: 9, chord: '5:maj' }]), 0.5);
  assert.equal(M.chordAgreement(win, [{ q: 9, chord: '5:maj' }]), null);
});

test('left-hand attacks per bar and the right hand above C6', () => {
  const ix = M.indexNotes([n(0, 1, 90, 0), n(1, 2, 84, 0), n(2, 3, 72, 0), n(3, 4, 96, 0), n(0, 1, 40, 1), n(1, 2, 40, 1), n(2, 3, 40, 1, true), n(3, 4, 45, 1)]);
  assert.deepEqual(M.handStats(ix, 2), { lh_notes_per_bar: 1.5, rh_above_c6: 0.5 });   /* 84 is C6 itself: not above it */
});

test('level spread: three equal levels collapse (0, 0); three different ones are 1 apart', () => {
  const a = { keys: new Set(['0|60|0', '96|62|0']), fp: 'a' };
  assert.deepEqual(M.levelSpread([a, { keys: new Set(a.keys), fp: 'a' }, { keys: new Set(a.keys), fp: 'a' }]), { distinct: 0, distance: 0 });
  const s = M.levelSpread([a, { keys: new Set(['0|60|0']), fp: 'b' }, { keys: new Set(['0|60|0', '96|62|0', '192|64|0']), fp: 'c' }]);
  assert.equal(s.distinct, 1);
  assert.ok(s.distance > 0.3 && s.distance < 0.6, String(s.distance));
  assert.equal(M.levelSpread([a]), null);
});

test('matching true melody to heard notes is one to one, by pitch, nearest in time, within the window', () => {
  const truth = [{ sec: 1.0, midi: 60, q: 0 }, { sec: 1.1, midi: 60, q: 1 }, { sec: 2.0, midi: 62, q: 2 }];
  const heard = [{ sec: 1.05, midi: 60, ref: 'a' }, { sec: 5, midi: 62, ref: 'far' }];
  const m = M.matchHeard(truth, heard, 0.2);
  assert.deepEqual(m.map(x => [x.truth.q, x.heard.ref]), [[0, 'a']]);       /* the second 60 finds the one heard 60 used; the 62 is 3 s away */
});
