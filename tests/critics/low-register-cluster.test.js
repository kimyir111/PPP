/* Critics - low-register clusters (critics/low-register-cluster.js; G9 post-H-8 re-look).
   A second or third between two sounding notes whose lower note is below C3 (MIDI 48), as a share of chord attacks; and the
   left hand's bass-then-chord pairs whose chord starts within a third of a bass below C3. Report only: weight 0 in selection.
   Planted-defect and negative-control fixtures, threshold edges, determinism, and the realizer's open geometry against 'close'. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const LRC = require(path.join(REPO, 'critics/low-register-cluster.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

/* a note list where each entry is the set of MIDI pitches struck at one quarter */
const attacks = sets => { const out = []; sets.forEach((ms, i) => ms.forEach(m => out.push({ onsetQ: i, midi: m }))); return out; };
const of = sets => LRC.ofNotes(attacks(sets));

test('planted defect: a low chord with a third or second between its low notes is a cluster attack', () => {
  const r = of([[43, 46, 50], [40, 41, 47], [45, 49, 52]]); /* G2 Bb2 D3: a third under C3; E2 F2: a second; A2 C#3 E3: a third */
  assert.equal(r.chordAttacks, 3);
  assert.equal(r.clusterAttacks, 3);
  assert.equal(r.clusterRate, 1);
});

test('negative control: chords above C3, and open low voicings, are not clusters', () => {
  const r = of([[48, 52, 55], [50, 54, 57], [43, 55, 59, 62], [40, 52, 56], [36, 48]]);
  /* [48,52,55]: lower note exactly C3, not below it; [43 | 55 ..]: a fifth-plus gap; [40, 52, 56]: 52 and 56 are a third but their lower note is 52 >= 48 */
  assert.equal(r.chordAttacks, 5);
  assert.equal(r.clusterAttacks, 0);
  assert.equal(r.clusterRate, 0);
});

test('thresholds: an interval of 4 semitones counts and 5 does not; a lower note of 47 counts and 48 does not', () => {
  assert.equal(of([[44, 48]]).clusterAttacks, 1, 'a major third, lower note 44');
  assert.equal(of([[44, 49]]).clusterAttacks, 0, 'a fourth is not a second or third');
  assert.equal(of([[47, 50]]).clusterAttacks, 1);
  assert.equal(of([[48, 51]]).clusterAttacks, 0);
  assert.equal(of([[46, 47]]).clusterAttacks, 1, 'a second');
  assert.equal(LRC.ofNotes(attacks([[44, 48]]), { clusterBelow: 44 }).clusterAttacks, 0, 'the C3 threshold is an option');
});

test('a single note is not a chord attack; an empty list reads 0 (not NaN)', () => {
  const r = of([[40], [41], [42]]);
  assert.equal(r.chordAttacks, 0);
  assert.equal(r.clusterRate, 0);
  const e = LRC.ofNotes([]);
  assert.equal(e.chordAttacks, 0);
  assert.equal(e.clusterRate, 0);
  assert.equal(e.closeBassChordRate, 0);
});

test('close bass-chord pairs: a chord within a third of a bass below C3 is counted, a fifth-plus gap or a bass at C3 is not', () => {
  const close = of([[43], [46, 50, 55], [43], [47, 50, 55]]); /* bass G2, chord low 46 (3 up) and 47 (4 up) */
  assert.equal(close.bassChordPairs, 2);
  assert.equal(close.closeBassChords, 2);
  assert.equal(close.closeBassChordRate, 1);
  const open = of([[43], [48, 52, 55], [43], [50, 55, 59]]); /* the chord starts 5 and 7 above the bass */
  assert.equal(open.bassChordPairs, 2);
  assert.equal(open.closeBassChords, 0);
  const high = of([[48], [51, 55, 58]]); /* the bass is at C3: not "below C3" */
  assert.equal(high.bassChordPairs, 1);
  assert.equal(high.closeBassChords, 0);
  /* notes at or above middle C are not left hand: a melody above does not turn a lone bass into a chord */
  const withMelody = LRC.ofNotes([{ onsetQ: 0, midi: 43 }, { onsetQ: 0, midi: 72 }, { onsetQ: 1, midi: 46 }, { onsetQ: 1, midi: 50 }, { onsetQ: 1, midi: 74 }]);
  assert.equal(withMelody.bassChordPairs, 1);
  assert.equal(withMelody.closeBassChords, 1);
});

test('notesBelow42 counts every note under F#2', () => {
  assert.equal(of([[40, 41], [42], [30]]).notesBelow42, 3);
});

test('lowRegisterCluster on a real ScoreGraph: planted low thirds against an open voicing', () => {
  const bad = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'G2+Bb2+D3:q C2+E2+G2:q' });
  const good = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+E3+G3:q D3+F3+A3:q' });
  assert.equal(LRC.lowRegisterCluster(bad).clusterRate, 1);
  assert.equal(LRC.lowRegisterCluster(good).clusterRate, 0);
  const empty = { timeline: { measures: [] }, parts: [] };
  assert.equal(LRC.lowRegisterCluster(empty).chordAttacks, 0);
});

test('deterministic; evaluate carries it; weight 0 so it changes no ranking, weight 1 would count it', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'G2+Bb2+D3:q C2+E2+G2:q' });
  assert.equal(JSON.stringify(LRC.lowRegisterCluster(g)), JSON.stringify(LRC.lowRegisterCluster(g)));
  assert.ok(CRIT.NAMES.includes('lowRegisterCluster'));
  const ev = CRIT.evaluate(g, { profile: 'large', skipEngrave: true });
  assert.equal(ev.critics.lowRegisterCluster.clusterRate, 1);
  assert.equal(ev.critics.lowRegisterClusterError, undefined);
  assert.equal(CAND.DEFAULT_WEIGHTS.lowRegisterCluster, 0);
  const base = { level: 3, melody: 1, harmony: { rootQuality: 1 }, engrave: { silent: 0, hardLayout: 0 }, voiceLeading: { count: 0 }, registerDensity: { overage: 0 }, registerFloor: { below: 0 }, leftHandJump: { rate: 0 } };
  const good = Object.assign({}, base, { lowRegisterCluster: { clusterRate: 0 } }), bad = Object.assign({}, base, { lowRegisterCluster: { clusterRate: 0.9 } });
  assert.equal(CAND.badnessOf(good, 3).total, CAND.badnessOf(bad, 3).total);
  assert.ok(CAND.badnessOf(bad, 3, { lowRegisterCluster: 1 }).total > CAND.badnessOf(good, 3, { lowRegisterCluster: 1 }).total);
});

test("the realizer's default 'open' geometry has far fewer low-register clusters than 'close' on pieces the close geometry made muddy", async () => {
  let closeAtt = 0, closeChords = 0, openAtt = 0, openChords = 0;
  for (const [file, level, pattern] of [['catalog/method/sonatina/025.mxl', 3.4, 'waltz'], ['catalog/method/beyer/061.mxl', 3.24, 'pop'], ['catalog/method/beyer/020.mxl', 2.55, 'waltz']]) {
    const g = await H.graphOf(file), sg = SGG.analyze(g);
    const p = ARR.planner.plan(g, sg, { targetLevel: level, handProfile: 'large', sections: 'all' });
    assert.ok(p.ok, file);
    const close = LRC.lowRegisterCluster(REALIZE.realize(g, sg, p.plan, { pattern, stride: 'close' }).graph);
    const open = LRC.lowRegisterCluster(REALIZE.realize(g, sg, p.plan, { pattern }).graph);
    assert.ok(open.clusterRate < close.clusterRate, file + ': ' + open.clusterRate + ' vs ' + close.clusterRate);
    assert.ok(open.clusterRate <= 0.05, file + ': open cluster rate ' + open.clusterRate);
    assert.ok(open.closeBassChords <= 1, file);
    closeAtt += close.clusterAttacks; closeChords += close.chordAttacks; openAtt += open.clusterAttacks; openChords += open.chordAttacks;
  }
  assert.ok(closeAtt / closeChords >= 0.15, 'fixture assumption: close is muddy here (' + closeAtt / closeChords + ')');
  assert.ok(openAtt / openChords <= 0.03, 'pooled open rate ' + openAtt / openChords);
  assert.equal(TH.CLUSTER_BELOW, LRC.CLUSTER_BELOW, 'the realizer and the critic agree on where the low register ends');
});
