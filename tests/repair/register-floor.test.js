/* Repair - the register floor's guard (G9 post-H-8; repair/plan.js belowFloor, repair/index.js tryUnit).
   A repair never moves a note below E2 (MIDI 40), nor further down a note that is already below it. It may move such a note UP,
   even if that still falls short of the floor. `ctx.registerFloor: null` switches the guard off. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const HARM = require(path.join(REPO, 'songgraph/harmony.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const PLAN = require(path.join(REPO, 'repair/plan.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));

function melodyOf(g) {
  const vid = g.parts[0].voices[0].id;
  return U.noteWindows(g).filter(n => n.voiceId === vid).map(n => ({ onsetQ: R.toNumber(n.w0) * 4, midi: n.midi }));
}
const ctxOf = (g, extra) => Object.assign({ profile: 'large', origMelody: melodyOf(g), harmony: HARM.harmonyOf(g) }, extra || {});
const seedOf = (g, from, to) => {
  const n = U.noteWindows(g).find(x => x.midi === from);
  return { op: 'parallel', m: n.m, key: 'planted', smellsBefore: 1, smellsAfter: 0, edits: [{ headId: n.headId, eventId: n.eventId, from: from, to: to, pitch: n.pitch }] };
};

test('belowFloor: the guard is "would land under the floor AND lower than it was"; null is no guard', () => {
  assert.equal(PLAN.belowFloor(50, 38, 40), true, 'a normal note dropped under the floor');
  assert.equal(PLAN.belowFloor(36, 24, 40), true, 'a note already low goes lower');
  assert.equal(PLAN.belowFloor(36, 48, 40), false, 'a low note moved up past the floor');
  assert.equal(PLAN.belowFloor(30, 36, 40), false, 'a low note moved up but still short of the floor: allowed');
  assert.equal(PLAN.belowFloor(60, 48, 40), false);
  assert.equal(PLAN.belowFloor(50, 40, 40), false, 'landing exactly on the floor is fine');
  assert.equal(PLAN.belowFloor(50, 38, null), false);
  assert.equal(PLAN.belowFloor(50, 38, undefined), false);
});

test('rollback: a planted octave-down that lands under E2 is refused (BELOW_FLOOR) and the input comes back untouched', () => {
  /* RH C5 -> D5 over LH C3 -> D3: parallel octaves. The seeded unit moves the second bass note D3 (50) down to D2 (38). */
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3:q D3:q' });
  const seed = seedOf(g, 50, 38);
  const r = REP.repair(g, ctxOf(g), { seedUnits: [seed], maxTrials: 1 });
  assert.equal(r.graph, g, 'the very same object');
  assert.equal(r.changed, false);
  assert.equal(r.report.accepted, 0);
  assert.equal(r.report.rolledBack, 1);
  assert.deepEqual(r.report.units[0].reasons, ['BELOW_FLOOR']);
  /* not vacuous: with the guard off the same unit is a real repair (it fixes the parallel) and is accepted */
  const off = REP.repair(g, ctxOf(g, { registerFloor: null }), { seedUnits: [seed], maxTrials: 1 });
  assert.equal(off.changed, true);
  assert.equal(off.report.accepted, 1);
  assert.ok(U.noteWindows(off.graph).some(n => n.midi === 38));
  /* the floor is an option: a floor of 30 lets D2 (38) through */
  const f30 = REP.repair(g, ctxOf(g, { registerFloor: 30 }), { seedUnits: [seed], maxTrials: 1 });
  assert.equal(f30.changed, true);
});

test('a note already below the floor may be moved UP by a repair, never further down', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C2:q D2:q' }); /* LH 36, 38: below E2 already */
  const up = REP.repair(g, ctxOf(g), { seedUnits: [seedOf(g, 36, 48)], maxTrials: 1 });
  assert.equal(up.changed, true, 'C2 up to C3 (48): allowed, and it removes the parallel octaves');
  assert.ok(U.noteWindows(up.graph).some(n => n.midi === 48));
  const down = REP.repair(g, ctxOf(g), { seedUnits: [seedOf(g, 38, 26)], maxTrials: 1 });
  assert.equal(down.changed, false);
  assert.deepEqual(down.report.units[0].reasons, ['BELOW_FLOOR']);
});

test('the default guard is the realizer\'s REGISTER_FLOOR, and the planner state carries it', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3:q D3:q' });
  assert.equal(PLAN.annotate(g, { registerFloor: 40 }).floor, 40);
  assert.equal(PLAN.annotate(g, {}).floor, null, 'plan.js alone has no default: repair() resolves it');
  assert.equal(TH.REGISTER_FLOOR, 40);
  const r = REP.repair(g, ctxOf(g), { seedUnits: [seedOf(g, 50, 38)], maxTrials: 1 });
  assert.deepEqual(r.report.units[0].reasons, ['BELOW_FLOOR'], 'no ctx.registerFloor given: the default 40 applies');
});

test('repair with the guard is deterministic and idempotent on a graph the guard leaves alone', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  const a = REP.repair(g, ctxOf(g), {}), b = REP.repair(g, ctxOf(g), {});
  assert.equal(JSON.stringify(a.report.units), JSON.stringify(b.report.units));
  const again = REP.repair(a.graph, ctxOf(a.graph), {});
  assert.equal(again.graph, a.graph, 'repair(repair(g)) returns its input');
});
