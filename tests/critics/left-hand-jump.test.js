/* Critics - left-hand jump rate (critics/left-hand-jump.js; G9 post-H-8 re-look).
   The share of left-hand steps whose bass (the lowest note below middle C at an onset) moves an octave or more to the next such
   onset. Report only: weight 0 in candidate selection. Planted-defect and negative-control fixtures, threshold edges, chords,
   the repair guard's helpers, determinism. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const LHJ = require(path.join(REPO, 'critics/left-hand-jump.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));

/* plain note lists: one note per quarter */
const line = midis => midis.map((m, i) => ({ onsetQ: i, midi: m }));
const rateOf = midis => LHJ.ofNotes(line(midis));

test('planted defect: an octave-leaping bass (an oom-pah with the chord an octave and more above) is a jump on every step', () => {
  const r = rateOf([36, 48, 36, 48, 36]); /* C2 C3 C2 C3 C2 */
  assert.equal(r.steps, 4);
  assert.equal(r.jumps, 4);
  assert.equal(r.rate, 1);
  assert.equal(r.maxJump, 12);
});

test('negative control: a stepwise or close bass has no jump', () => {
  const r = rateOf([48, 50, 52, 53, 55, 53, 52]);
  assert.equal(r.steps, 6);
  assert.equal(r.jumps, 0);
  assert.equal(r.rate, 0);
  assert.equal(r.maxJump, 2);
});

test('the threshold is an octave: 11 semitones is not a jump, 12 and 14 are', () => {
  assert.equal(rateOf([48, 59]).jumps, 0, 'a major seventh');
  assert.equal(rateOf([40, 52]).jumps, 1, 'exactly an octave');
  assert.equal(rateOf([43, 57]).jumps, 1, 'a ninth');
  assert.equal(rateOf([52, 40]).jumps, 1, 'downward counts the same');
  assert.equal(LHJ.ofNotes(line([48, 55]), { jumpSemitones: 7 }).jumps, 1, 'the threshold is an option');
});

test('a mixed line: the rate is jumps over steps', () => {
  const r = rateOf([48, 50, 38, 40, 52]); /* +2, -12 (jump), +2, +12 (jump) */
  assert.equal(r.steps, 4);
  assert.equal(r.jumps, 2);
  assert.equal(r.rate, 0.5);
});

test('a chord at an onset contributes its lowest note; notes at or above middle C are not bass', () => {
  const notes = [
    { onsetQ: 0, midi: 43 }, { onsetQ: 1, midi: 55 }, { onsetQ: 1, midi: 59 }, { onsetQ: 1, midi: 62 }, /* chord: the bass is 55 */
    { onsetQ: 2, midi: 43 }, { onsetQ: 2, midi: 72 }, /* the melody note at 72 is never the bass */
    { onsetQ: 3, midi: 76 } /* an onset with nothing below middle C is skipped, not a step */
  ];
  const r = LHJ.ofNotes(notes);
  assert.deepEqual(LHJ.bassLine(notes, 60).map(x => x.bass), [43, 55, 43]);
  assert.equal(r.steps, 2);
  assert.equal(r.jumps, 2, '43 to 55 and 55 to 43');
  /* only melody notes: no steps, rate 0, not NaN */
  const none = LHJ.ofNotes([{ onsetQ: 0, midi: 72 }, { onsetQ: 1, midi: 74 }]);
  assert.equal(none.steps, 0);
  assert.equal(none.rate, 0);
});

test('an onset with a low note skipped in between still links its neighbours (a rest in the left hand is not a step)', () => {
  const notes = [{ onsetQ: 0, midi: 40 }, { onsetQ: 1, midi: 70 }, { onsetQ: 2, midi: 52 }];
  const r = LHJ.ofNotes(notes);
  assert.equal(r.steps, 1);
  assert.equal(r.jumps, 1);
});

test('belowG2 counts every note under G2 (MIDI 43), source or not; lowest is reported', () => {
  const r = rateOf([40, 42, 43, 45, 30]);
  assert.equal(r.belowG2, 3);
  assert.equal(r.lowest, 30);
  assert.equal(LHJ.G2, 43);
});

test('leftHandJump on a real ScoreGraph: a planted octave stride against a close one', () => {
  const stride = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C2:q C3:q C2:q C3:q' });
  const close = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:q E3:q C3:q E3:q' });
  assert.equal(LHJ.leftHandJump(stride).rate, 1);
  assert.equal(LHJ.leftHandJump(close).rate, 0);
  assert.equal(LHJ.leftHandJump(stride).belowG2, 2, 'C2 twice');
  const empty = { timeline: { measures: [] }, parts: [] };
  const e = LHJ.leftHandJump(empty);
  assert.equal(e.steps, 0);
  assert.equal(e.rate, 0);
  assert.equal(e.lowest, null);
});

test('deterministic: the same graph gives the same result, call after call', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C2:q C3:q G2:q G3:q' });
  assert.equal(JSON.stringify(LHJ.leftHandJump(g)), JSON.stringify(LHJ.leftHandJump(g)));
});

test('evaluate: the critic set carries leftHandJump, computed from the graph alone', () => {
  assert.ok(CRIT.NAMES.includes('leftHandJump'));
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C2:q C3:q C2:q C3:q' });
  const ev = CRIT.evaluate(g, { profile: 'large', skipEngrave: true });
  assert.equal(ev.critics.leftHandJump.rate, 1);
  assert.equal(ev.critics.leftHandJumpError, undefined);
  assert.equal(CRIT.leftHandJump, LHJ);
});

test('report only: weight 0 in selection, so the critic changes no candidate ranking; weight 1 would count it', () => {
  assert.equal(CAND.DEFAULT_WEIGHTS.leftHandJump, 0);
  const base = { level: 3, melody: 1, harmony: { rootQuality: 1 }, engrave: { silent: 0, hardLayout: 0 }, voiceLeading: { count: 0 }, registerDensity: { overage: 0 }, registerFloor: { below: 0 } };
  const good = Object.assign({}, base, { leftHandJump: { rate: 0 } }), bad = Object.assign({}, base, { leftHandJump: { rate: 0.6 } });
  assert.equal(CAND.badnessOf(good, 3).total, CAND.badnessOf(bad, 3).total);
  assert.ok(CAND.badnessOf(bad, 3, { leftHandJump: 1 }).total > CAND.badnessOf(good, 3, { leftHandJump: 1 }).total);
  /* a missing or failed critic can never make a candidate look better, but at weight 0 it changes nothing either */
  assert.equal(CAND.badnessOf(Object.assign({}, base), 3).total, CAND.badnessOf(good, 3).total);
});

/* ---------------------------------------------------------------- the repair guard's helpers */
test('jumpIds / newJumps: a jump is identified by its two onsets; only a jump that was not there counts as new', () => {
  const before = line([48, 50, 52]);
  const after = line([48, 36, 52]); /* the middle note 50 -> 36: 48>36 is 12, 36>52 is 16 */
  assert.equal(LHJ.jumpIds(before).size, 0);
  assert.equal(LHJ.jumpIds(after).size, 2);
  assert.equal(LHJ.newJumps(before, after), 2);
  assert.equal(LHJ.newJumps(after, before), 0, 'removing jumps creates none');
  assert.equal(LHJ.newJumps(after, after), 0, 'the same jumps are not new');
});

test('createsJump agrees with a full recount on every single-note octave move of a bass line with chords', () => {
  const notes = [];
  [[43], [55, 59, 62], [45], [57, 60, 64], [47], [50, 55, 59], [48], [52, 55, 60]].forEach((ms, i) => ms.forEach(m => notes.push({ onsetQ: i, midi: m })));
  const idx = LHJ.bassIndex(notes);
  let checked = 0;
  notes.forEach((n, i) => [-24, -12, 12, 24].forEach(sh => {
    const moved = notes.map((x, j) => (j === i ? Object.assign({}, x, { midi: x.midi + sh }) : x));
    assert.equal(LHJ.createsJump(idx, n.onsetQ, n.midi, n.midi + sh), LHJ.newJumps(notes, moved) > 0, 'note ' + i + ' shift ' + sh);
    checked++;
  }));
  assert.equal(checked, notes.length * 4);
});

test('createsJump handles a note moving out of, or into, the left-hand register', () => {
  /* 43, then 48+72 (the 48 leaves bass duty when moved to 60: the onset has no low note any more), then 45 */
  const notes = [{ onsetQ: 0, midi: 43 }, { onsetQ: 1, midi: 48 }, { onsetQ: 1, midi: 72 }, { onsetQ: 2, midi: 45 }];
  const idx = LHJ.bassIndex(notes);
  assert.equal(LHJ.createsJump(idx, 1, 48, 60), false, 'the step 43>45 that remains is 2 semitones');
  assert.equal(LHJ.createsJump(idx, 1, 48, 36), false, '43>36 is 7, 36>45 is 9');
  assert.equal(LHJ.createsJump(idx, 1, 48, 31), true, '43>31 is 12');
  assert.equal(LHJ.createsJump(idx, 1, 72, 30), true, 'the melody note dropped to 30 becomes the bass: 43>30 is 13');
});

/* ---------------------------------------------------------------- G9a end to end, on pieces the reviewer flagged */
test('G9a on flagged pieces (H-8 requests): the selected arrangement is far under the flagged 18% (before the fix: 13%, 30%, 30%), and the run is deterministic', async () => {
  const SGG = require(path.join(REPO, 'songgraph/index.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  for (const [file, level] of [['catalog/hymns/nearer-my-god.musicxml', 2.4], ['catalog/method/beyer/038.mxl', 2.58], ['catalog/method/sonatina/025.mxl', 3.4]]) {
    const g = await H.graphOf(file), sg = SGG.analyze(g);
    const request = { targetLevel: level, handProfile: 'large', sections: 'all' };
    const a = CAND.run(g, sg, request, {}), b = CAND.run(g, sg, request, {});
    assert.ok(a.ok, file);
    const rate = a.selected.scores.leftHandJump.rate;
    assert.ok(rate <= 0.11, file + ': selected left-hand jump rate ' + rate);
    assert.equal(a.selected.scores.leftHandJump.rate, LHJ.leftHandJump(a.selected.graph).rate, 'the scored value is the critic on the graph');
    assert.equal(a.selected.fingerprint, b.selected.fingerprint, file + ': deterministic');
    assert.equal(a.selected.badness.parts.leftHandJump != null, true, 'reported in the badness parts, at weight 0');
    assert.equal(a.selected.badness.weights.leftHandJump, 0);
  }
});
