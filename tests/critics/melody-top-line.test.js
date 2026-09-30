/* melodyTopLine (report only; G9 single-note hands, docs/GOALS/G09 section 12): the share of the original melody's onsets whose TOP head is still sounded.
   `melodyPreservation` counts every head of a melody voice written in chords; the top-line number does not, so keeping the tune and dropping the chord
   notes under it is not a loss. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const M = require(path.join(REPO, 'critics/metrics.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

const orig = [{ onsetQ: 0, midi: 72 }, { onsetQ: 0, midi: 64 }, { onsetQ: 1, midi: 74 }, { onsetQ: 1, midi: 65 }, { onsetQ: 2, midi: 76 }];

test('all top notes present: 1, whatever happens to the chord heads under them', () => {
  assert.equal(M.melodyTopLine(orig, [{ onsetQ: 0, midi: 72 }, { onsetQ: 1, midi: 74 }, { onsetQ: 2, midi: 76 }]), 1);
  assert.ok(M.melodyPreservation(orig, [{ onsetQ: 0, midi: 72 }, { onsetQ: 1, midi: 74 }, { onsetQ: 2, midi: 76 }]) < 1, 'the every-head number does fall (3 of 5)');
});

test('a lost top note is caught; a lost inner head is not', () => {
  const missTop = [{ onsetQ: 0, midi: 72 }, { onsetQ: 0, midi: 64 }, { onsetQ: 1, midi: 65 }, { onsetQ: 2, midi: 76 }];
  assert.equal(M.melodyTopLine(orig, missTop), 2 / 3);
  const missInner = [{ onsetQ: 0, midi: 72 }, { onsetQ: 1, midi: 74 }, { onsetQ: 1, midi: 65 }, { onsetQ: 2, midi: 76 }];
  assert.equal(M.melodyTopLine(orig, missInner), 1);
  assert.equal(M.melodyTopLine(orig, []), 0);
  assert.equal(M.melodyTopLine([], [{ onsetQ: 0, midi: 60 }]), null);
});

test('a wrong pitch or an onset off by more than the tolerance does not count; within it does', () => {
  assert.equal(M.melodyTopLine([{ onsetQ: 0, midi: 72 }], [{ onsetQ: 0, midi: 73 }]), 0);
  assert.equal(M.melodyTopLine([{ onsetQ: 0, midi: 72 }], [{ onsetQ: 0.5, midi: 72 }]), 0);
  assert.equal(M.melodyTopLine([{ onsetQ: 0, midi: 72 }], [{ onsetQ: 0.1, midi: 72 }]), 1);
});

test('the critic reports it beside the melody number, and a one-note-per-hand realization keeps the top line at 1', async () => {
  const g = await H.graphOf('catalog/hymns/christ-arose.musicxml'), sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: 2.76, handProfile: 'large', sections: 'all' });
  const om = M.originalMelodyNotes(g, p.plan);
  const r = REALIZE.realize(g, sg, p.plan, { pattern: 'hymn', hymnThin: true, handChords: true, handMaxNotes: 1 });
  const ev = CRIT.evaluate(r.graph, { profile: 'large', targetLevel: 2.76, origMelodyNotes: om, origHarmony: sg.harmony, skipEngrave: true });
  assert.equal(ev.critics.melodyTopLine, 1);
  assert.equal(typeof ev.critics.melody, 'number');
});
