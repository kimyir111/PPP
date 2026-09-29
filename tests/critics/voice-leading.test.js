/* Critics — voice-leading smells (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §9 mutation
   suite: "a planted parallel fifth must be caught by the voice-leading critic"). Uses
   tests/scoregraph/g3-helpers.js's `mk()` (the same hand-written-graph fixture builder G3's
   own test suite uses) to plant EXACT, hand-picked pitch sequences - never a real corpus
   file for these cases, since the point is to know in advance what the critic must find. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const VL = require(path.join(REPO, 'critics/voice-leading.js'));

test('mutation: parallel perfect fifths between the outer voices are caught', () => {
  /* RH G4->A4 (67->69), LH C4->D4 (60->62): both a real perfect fifth (7 semitones) at
     each of the two chords, both voices moving up by the SAME whole step - textbook
     parallel fifths. */
  const g = mk({ time: [2, 4], rh: 'G4:q A4:q', lh: 'C4:q D4:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.ok(smells.parallels.length >= 1, 'expected at least one planted parallel fifth, got ' + JSON.stringify(smells.parallels));
  assert.equal(smells.parallels[0].interval, 'fifth');
});

test('mutation: parallel octaves between the outer voices are caught', () => {
  /* RH C5->D5 (72->74), LH C4->D4 (60->62): both exactly an octave apart, both moving up
     by the same whole step. */
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C4:q D4:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.ok(smells.parallels.length >= 1, 'expected at least one planted parallel octave');
  assert.equal(smells.parallels[0].interval, 'octave/unison');
});

test('negative control: contrary motion into a perfect fifth is NOT a smell', () => {
  /* RH descends C5->B4 (72->71), LH ascends C3->D3 (48->50): both perfect intervals
     (C5/C3 = 2 octaves = unison-class; B4/D3 is NOT perfect, so this pair only touches one
     perfect interval, not two in a row - a clean negative control, no parallel motion
     between two perfect intervals at all). */
  const g = mk({ time: [2, 4], rh: 'C5:q B4:q', lh: 'C3:q D3:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.equal(smells.parallels.length, 0, 'contrary motion (or non-perfect intervals) must not be flagged: ' + JSON.stringify(smells.parallels));
});

test('negative control: a held outer voice (oblique motion) into a repeated perfect interval is NOT a smell', () => {
  /* LH holds C3 (48) across both chords (oblique motion - only RH moves), even though
     both chords happen to be perfect fifths (G3/C3-ish) - real oblique motion into a
     perfect interval is textbook-legal, unlike similar motion. */
  const g = mk({ time: [2, 4], rh: 'G3:q G3:q', lh: 'C3:q C3:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.equal(smells.parallels.length, 0, 'no motion at all in either voice must not be flagged: ' + JSON.stringify(smells.parallels));
});

test('mutation: a large leap in a genuinely inner voice is caught', () => {
  /* A 3-voice texture: RH melody voice1 stays put at C6/72 (outer/top every chord), LH
     bass stays put at C3/48 (outer/bottom every chord), RH voice2 (genuinely inner - its
     midi is strictly between 48 and 72 at BOTH chords, so it is never the outer voice)
     leaps D4/50 -> B5/71, 21 semitones, well past LARGE_LEAP (12). */
  const g = mk({ time: [2, 4], rh: 'C6:q C6:q', rh2: 'D4:q B5:q', lh: 'C3:q C3:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.ok(smells.innerLeaps.length >= 1, 'expected the planted 23-semitone inner leap: ' + JSON.stringify(smells.innerLeaps));
});

test('negative control: a large leap in the outer (melody) voice is NOT flagged as an inner leap', () => {
  const g = mk({ time: [2, 4], rh: 'C4:q C6:q', lh: 'C3:q C3:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.equal(smells.innerLeaps.length, 0, 'a melody/outer-voice leap is not an inner-voice smell: ' + JSON.stringify(smells.innerLeaps));
});

test('mutation: voice crossing (two voices of one part swapping relative order) is caught', () => {
  /* rh (whole-piece avg higher, by construction - it starts and stays high in bar 1-2 of
     3) and rh2 (avg lower) swap at the middle chord: rh dips to C4 while rh2 rises to C6 -
     a real crossing against their own whole-piece average order. */
  const g = mk({ time: [3, 4], rh: 'C6:q C4:q C6:q', rh2: 'C4:q C6:q C4:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.ok(smells.crossings.length >= 1, 'expected the planted crossing: ' + JSON.stringify(smells.crossings));
});

test('negative control: two voices that never swap relative order are never flagged as crossing', () => {
  const g = mk({ time: [2, 4], rh: 'C6:q C6:q', rh2: 'C4:q C4:q' });
  const smells = VL.voiceLeadingSmells(g);
  assert.equal(smells.crossings.length, 0);
});

test('voiceLeadingSmells is deterministic (same graph, same result, repeat call)', () => {
  const g = mk({ time: [2, 4], rh: 'G4:q A4:q', lh: 'C4:q D4:q' });
  const a = VL.voiceLeadingSmells(g), b = VL.voiceLeadingSmells(g);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('regression (G9b correction): a lone melody note moving stepwise is NOT a parallel unison/octave', () => {
  /* G9a's outerOf treated a slice with ONE note as hi === lo (a "unison") and so counted every same-direction
     step of a single line as a parallel octave (hundreds per file). Two outer voices need two attacking notes. */
  const restLH = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'r:h' });
  assert.equal(VL.voiceLeadingSmells(restLH).parallels.length, 0, 'a melody over a resting hand has no outer pair');
  const heldLH = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3:h' });
  assert.equal(VL.voiceLeadingSmells(heldLH).parallels.length, 0, 'a melody over a sustained bass: only one attack at the second onset');
  /* the real unison of two voices is still a parallel */
  const real = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C5:q D5:q' });
  assert.equal(VL.voiceLeadingSmells(real).parallels.length, 1);
});

test('regression (G9b review): a lone BASS or lone MELODY note leaping is still an outer voice, NOT an inner leap', () => {
  /* the G9b two-note-slice rule belongs to parallel detection only; a one-note slice is still outer for the
     leap smell. (An earlier G9b draft returned null from outerOf for it, turning every lone bass/melody leap
     into an "inner" leap: C4 C6 C4 C6 counted 3.) */
  const lone = mk({ time: [4, 4], rh: 'C4:q C6:q C4:q C6:q', lh: 'r:w' });
  assert.equal(VL.voiceLeadingSmells(lone).innerLeaps.length, 0, 'lone melody leaps over a resting hand: ' + JSON.stringify(VL.voiceLeadingSmells(lone).innerLeaps));
  const loneBass = mk({ time: [4, 4], rh: 'r:w', lh: 'C2:q C4:q C2:q C4:q' });
  assert.equal(VL.voiceLeadingSmells(loneBass).innerLeaps.length, 0, 'lone bass leaps under a resting hand');
  /* a bass note alone at one onset, a chord at the next (the beyer/001 waltz shape): the lone note is the bass */
  const waltz = mk({ time: [2, 4], rh: 'r:q E5+G5:q', lh: 'C2:q C4+E4:q' });
  assert.equal(VL.voiceLeadingSmells(waltz).innerLeaps.length, 0, 'a lone bass note leaping to a chord: ' + JSON.stringify(VL.voiceLeadingSmells(waltz).innerLeaps));
  /* the planted true inner-voice leap is still one, and its parallel count is unaffected */
  const inner = mk({ time: [2, 4], rh: 'C6:q C6:q', rh2: 'D4:q B5:q', lh: 'C3:q C3:q' });
  assert.equal(VL.voiceLeadingSmells(inner).innerLeaps.length, 1);
  /* and the original bug stays fixed: a lone melody note is not a parallel octave */
  assert.equal(VL.voiceLeadingSmells(lone).parallels.length, 0);
  assert.equal(VL.voiceLeadingSmells(mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'r:h' })).parallels.length, 0);
});
