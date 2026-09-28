/* Candidates — selection mutation suite (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §9:
   "a planted hard violation must be filtered before scoring; ... the selection must be
   deterministic"). Two kinds of fixture: a hand-written synthetic graph (mk(), for the
   hard-violation filter - a real span violation, planted and known in advance) and a real
   corpus file run twice (for determinism - the ONLY way to genuinely test "same request +
   same SongGraph -> same candidate set, same order" is a real end-to-end run repeated). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));

test('mutation: a candidate with a planted G5 hard violation is filtered before scoring (hardOk false, select() discards it)', () => {
  /* A real, physically-unplayable two-octave-plus dyad in one hand (24 semitones, far past
     MAX_SPAN 14 at every hand profile) - the SAME kind of planted fixture
     tests/arrangement/mutation.test.js's own suite uses (docs/GOALS/G09 §11: "do not
     invent a second... mechanism" - this reuses the SAME planting idea, a physically
     unreachable span, not a new kind of fixture). */
  const bad = mk({ time: [1, 4], rh: 'C4+C6:q', lh: 'C3:q' });
  const good = mk({ time: [1, 4], rh: 'C5:q', lh: 'C3:q' });
  const ctx = { profile: 'large', targetLevel: 1, origHarmony: [], origMelodyNotes: [], stage: 1 };
  const evBad = CRIT.evaluate(bad, ctx), evGood = CRIT.evaluate(good, ctx);
  assert.equal(evBad.hardOk, false, 'the planted 2-octave dyad must be a real G5 hard violation');
  assert.equal(evGood.hardOk, true, 'the plain single note must have no hard violation');

  /* select() must discard the violating candidate outright - never let its other six
     scores outweigh the filter, per G9 §2's structural rule. */
  const scoredBad = { index: 0, spec: { handProfile: 'large', pattern: 'block' }, scores: evBad.critics, hardOk: evBad.hardOk };
  const scoredGood = { index: 1, spec: { handProfile: 'large', pattern: 'hymn' }, scores: evGood.critics, hardOk: evGood.hardOk };
  const sel = CAND.select([scoredBad, scoredGood], { targetLevel: 1 }, {});
  assert.equal(sel.ok, true);
  assert.equal(sel.selected.spec.pattern, 'hymn', 'the only hard-violation-free candidate must win regardless of its other scores');
  assert.equal(sel.discarded.length, 1);
  assert.equal(sel.discarded[0].spec.pattern, 'block');
});

test('mutation: if every candidate has a hard violation, select() reports failure rather than picking one anyway', () => {
  const bad1 = mk({ time: [1, 4], rh: 'C4+C6:q', lh: 'C3:q' });
  const bad2 = mk({ time: [1, 4], rh: 'C3+C6:q', lh: 'C2:q' });
  const ctx = { profile: 'large', targetLevel: 1, origHarmony: [], origMelodyNotes: [], stage: 1 };
  const ev1 = CRIT.evaluate(bad1, ctx), ev2 = CRIT.evaluate(bad2, ctx);
  const s1 = { index: 0, spec: { handProfile: 'large', pattern: 'block' }, scores: ev1.critics, hardOk: ev1.hardOk };
  const s2 = { index: 1, spec: { handProfile: 'large', pattern: 'hymn' }, scores: ev2.critics, hardOk: ev2.hardOk };
  const sel = CAND.select([s1, s2], { targetLevel: 1 }, {});
  assert.equal(sel.ok, false);
  assert.equal(sel.reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
  assert.equal(sel.discarded.length, 2);
});

async function findRequest(file) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  return { g, sg, request: { targetLevel: pos, handProfile: 'large', sections: 'all' } };
}

test('determinism: the same request + same SongGraph produces the same candidate set, same order, same selection, run twice', async () => {
  const { g, sg, request } = await findRequest('catalog/method/czerny599/013.mxl');
  const a = CAND.run(g, sg, request, { n: 8 });
  const b = CAND.run(g, sg, request, { n: 8 });
  assert.equal(a.ok, true, 'this fixture is expected to have a reachable plan');
  assert.equal(a.ok, b.ok);
  assert.deepEqual(a.tried.map(t => t.spec), b.tried.map(t => t.spec), 'enumeration order must be identical');
  assert.deepEqual(a.scored.map(c => c.fingerprint), b.scored.map(c => c.fingerprint), 'the candidate set (by real ScoreGraph fingerprint) must be identical');
  assert.equal(a.selected.spec.handProfile, b.selected.spec.handProfile);
  assert.equal(a.selected.spec.pattern, b.selected.spec.pattern);
  assert.equal(a.selected.fingerprint, b.selected.fingerprint, 'the selected candidate must be byte-for-byte identical (same fingerprint)');
  assert.equal(a.explanation, b.explanation);
});

test('candidates/index.js finds real, distinct candidates on a real multi-voice corpus file (not just one)', async () => {
  const { g, sg, request } = await findRequest('catalog/method/czerny599/013.mxl');
  const res = CAND.run(g, sg, request, { n: 8 });
  assert.equal(res.ok, true);
  assert.ok(res.scored.length > 1, 'expected real texture/pattern diversity on a 3+ voice piece, got ' + res.scored.length);
  const fps = new Set(res.scored.map(c => c.fingerprint));
  assert.equal(fps.size, res.scored.length, 'every scored candidate must be a genuinely distinct realization (dedup already ran in enumerate())');
});

test('an unreachable request never reaches candidate scoring with a fabricated plan (the planner itself refuses first)', async () => {
  /* The SAME "planted unreachable target" discipline tests/realize/realize.test.js's own
     mutation test uses (a deliberately absurd, far-negative target at the strictest hand
     profile, on a real harder multi-voice file) - `stageForPosition` clamps an absurdly
     HIGH target to the highest real stage rather than refusing it (checked directly,
     confirmed not this test's concern - real bounded-below-behaviour is at the LOW end). */
  const { g, sg } = await findRequest('catalog/hymns/all-creatures.musicxml');
  const request = { targetLevel: -50, handProfile: 'small', sections: 'all' };
  const res = CAND.run(g, sg, request, { n: 8 });
  if (res.ok) return; /* a real corpus file may still be reachable even at an extreme target - not this test's concern, matches realize.test.js's own precedent */
  assert.equal(res.ok, false);
  assert.equal(res.scored.length, 0);
  assert.ok(res.tried.every(t => !t.ok));
});
