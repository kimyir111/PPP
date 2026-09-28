/* songgraph/harmony.js unit tests: fitChord on known pitch-class histograms, and harmonyOf() on a
   simple synthetic progression. The real accuracy numbers (hymn SATB ground truth) are in
   hymn-corpus.test.js; this file is about the chord-fitting arithmetic itself. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { H, mk } = require('./helpers.js');

function hist(pcs) { const h = new Array(12).fill(0); pcs.forEach(pc => { h[pc] += 1; }); return h; }

test('fitChord: a pure C major triad (C,E,G) is C major, not anything else', () => {
  const r = H.fitChord(hist([0, 4, 7]));
  assert.equal(r.root, 0);
  assert.equal(r.quality, 'maj');
  assert.deepEqual(r.pcs, [0, 4, 7]);
});

test('fitChord: A minor (A,C,E) is A minor', () => {
  const r = H.fitChord(hist([9, 0, 4]));
  assert.equal(r.root, 9);
  assert.equal(r.quality, 'min');
});

test('fitChord: a dominant 7th (G,B,D,F) is G7, not a bare G major triad', () => {
  const r = H.fitChord(hist([7, 11, 2, 5]));
  assert.equal(r.root, 7);
  assert.equal(r.quality, 'dom7');
});

test('fitChord: silence (an all-zero histogram) has no meaningful best fit', () => {
  const r = H.fitChord(new Array(12).fill(0));
  /* every candidate scores identically (0 in, 0 out): fitChord still returns *a* candidate (root 0, the
     first tried), which is why harmonyOf() checks the histogram's total itself before calling fitChord
     and reports {root: null} for a genuinely silent window instead of trusting this edge case */
  assert.ok(r);
});

test('fitChord: an added passing tone lowers confidence but does not flip a clear triad', () => {
  const clean = H.fitChord(hist([0, 4, 7, 0, 4, 7, 0, 4, 7]));
  const withPassing = H.fitChord(hist([0, 4, 7, 0, 4, 7, 0, 4, 7, 1]));
  assert.equal(withPassing.root, clean.root);
  assert.equal(withPassing.quality, clean.quality);
  assert.ok(withPassing.conf <= clean.conf);
});

test('harmonyOf: a whole piece of C major triads reports C major at every beat, full confidence', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q E5:q G5:q C6:q | C5:q E5:q G5:q C6:q', lh: 'C3:w | C3:w' });
  const rows = H.harmonyOf(g);
  assert.ok(rows.length >= 8);
  rows.forEach(r => { assert.equal(r.root, 0); assert.equal(r.quality, 'maj'); });
});

test('harmonyOf: silent measures (all rests) report root/quality null, not a guess', () => {
  const g = mk({ time: [4, 4], rh: 'r:w', lh: 'r:w' });
  const rows = H.harmonyOf(g);
  rows.forEach(r => { assert.equal(r.root, null); assert.equal(r.quality, null); });
});
