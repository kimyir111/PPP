/* Repair - the left-hand jump guard (G9 post-H-8 re-look; repair/plan.js createsLeftHandJump, repair/index.js tryUnit).
   A repair may not move a note so that it creates a left-hand jump (the lowest note below middle C moving an octave or more
   between consecutive onsets, critics/left-hand-jump.js) where there was none. It may move a note out of a jump or leave one in
   place. `ctx.leftHandJumpGuard: false` switches the guard off. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const HARM = require(path.join(REPO, 'songgraph/harmony.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const LHJ = require(path.join(REPO, 'critics/left-hand-jump.js'));
const RF = require(path.join(REPO, 'critics/register-floor.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const PLAN = require(path.join(REPO, 'repair/plan.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

function melodyOf(g) {
  const vid = g.parts[0].voices[0].id;
  return U.noteWindows(g).filter(n => n.voiceId === vid).map(n => ({ onsetQ: R.toNumber(n.w0) * 4, midi: n.midi }));
}
/* registerFloor null: these fixtures move notes under E2 on purpose, to isolate the jump guard from the floor guard */
const ctxOf = (g, extra) => Object.assign({ profile: 'large', origMelody: melodyOf(g), harmony: HARM.harmonyOf(g), registerFloor: null }, extra || {});
const seedOf = (g, from, to, atQ) => {
  const n = U.noteWindows(g).find(x => x.midi === from && (atQ == null || Math.abs(R.toNumber(x.w0) * 4 - atQ) < 1e-6));
  return { op: 'parallel', m: n.m, key: 'planted', smellsBefore: 2, smellsAfter: 1, edits: [{ headId: n.headId, eventId: n.eventId, from: from, to: to, pitch: n.pitch }] };
};
const notesOf = g => RF.notesOf(g);

/* RH C5 D5 E5 over LH C3 D3 E3: two runs of parallel octaves; the LH bass line is 48, 50, 52 (no jump) */
const fixture = () => mk({ time: [3, 4], rh: 'C5:q D5:q E5:q', lh: 'C3:q D3:q E3:q' });

test('the fixture: the bass line has no jump, and the planted unit (the middle D3 down an octave, to D2) would create one', () => {
  const g = fixture();
  assert.equal(LHJ.leftHandJump(g).jumps, 0);
  const moved = REP.applyUnit(g, seedOf(g, 50, 38, 1)).graph; /* 48, 38, 52: 48>38 is 10, 38>52 is 14 */
  assert.equal(LHJ.leftHandJump(moved).jumps, 1);
  assert.equal(LHJ.newJumps(notesOf(g), notesOf(moved)), 1);
});

test('rollback: a planted move that creates a left-hand jump is refused (LEFT_HAND_JUMP) and the input comes back untouched', () => {
  const g = fixture();
  const seed = seedOf(g, 50, 38, 1);
  const r = REP.repair(g, ctxOf(g), { seedUnits: [seed], maxTrials: 1 });
  assert.equal(r.graph, g, 'the very same object');
  assert.equal(r.changed, false);
  assert.equal(r.report.accepted, 0);
  assert.equal(r.report.rolledBack, 1);
  assert.deepEqual(r.report.units[0].reasons, ['LEFT_HAND_JUMP']);
  /* not vacuous: with the guard off the same unit is a real repair (it removes a parallel) and is accepted */
  const off = REP.repair(g, ctxOf(g, { leftHandJumpGuard: false }), { seedUnits: [seed], maxTrials: 1 });
  assert.ok(!(off.report.units[0].reasons || []).includes('LEFT_HAND_JUMP'), 'the reason is the guard\'s, not another check\'s');
  assert.equal(off.changed, true, 'accepted without the guard: ' + JSON.stringify(off.report.units[0].reasons));
  assert.equal(LHJ.leftHandJump(off.graph).jumps, 1, 'and it did create the jump');
});

test('a move that creates no jump is not blocked; moving a note OUT of a jump is allowed', () => {
  const g = fixture();
  /* D3 up an octave to D4 (62): it leaves the bass register, the line 48, 52 has no jump */
  const up = REP.repair(g, ctxOf(g), { seedUnits: [seedOf(g, 50, 62, 1)], maxTrials: 1 });
  assert.notDeepEqual(up.report.units[0].reasons, ['LEFT_HAND_JUMP']);
  assert.equal(LHJ.newJumps(notesOf(g), notesOf(REP.applyUnit(g, seedOf(g, 50, 62, 1)).graph)), 0);
  /* a graph that already has a jump: moving the low note up out of it creates none, and the guard lets it through */
  const gj = mk({ time: [3, 4], rh: 'C5:q D5:q E5:q', lh: 'C3:q D2:q E3:q' }); /* 48, 38, 52: jumps 10 no, 14 yes */
  assert.equal(LHJ.leftHandJump(gj).jumps, 1);
  const fixed = REP.applyUnit(gj, seedOf(gj, 38, 50, 1)).graph;
  assert.equal(LHJ.newJumps(notesOf(gj), notesOf(fixed)), 0);
  assert.equal(LHJ.leftHandJump(fixed).jumps, 0);
  const r = REP.repair(gj, ctxOf(gj), { seedUnits: [seedOf(gj, 38, 50, 1)], maxTrials: 1 });
  assert.ok(!(r.report.units[0].reasons || []).includes('LEFT_HAND_JUMP'), 'not refused for the jump it removes');
  /* leaving an existing jump in place is not "creating" one: moving an unrelated RH note in a graph that has a jump */
  const rhMove = REP.applyUnit(gj, seedOf(gj, 76, 64, 2)).graph;
  assert.equal(LHJ.newJumps(notesOf(gj), notesOf(rhMove)), 0);
});

test('the planner carries the guard: createsLeftHandJump agrees with a recount, and the state can turn it off', () => {
  const g = fixture();
  const st = PLAN.annotate(g, { registerFloor: null });
  const d3 = st.notes.find(n => n.midi === 50);
  assert.equal(PLAN.createsLeftHandJump(st, d3, 38), true, '48>38 is 10, 38>52 is 14');
  assert.equal(PLAN.createsLeftHandJump(st, d3, 62), false, 'D4 is out of the bass register');
  assert.equal(PLAN.createsLeftHandJump(st, d3, 26), true);
  assert.equal(PLAN.createsLeftHandJump(PLAN.annotate(g, { registerFloor: null, leftHandJumpGuard: false }), d3, 38), false, 'the guard is off');
  /* every octave move of every note: the planner's local answer equals the full recount */
  st.notes.forEach(n => [-24, -12, 12, 24].forEach(sh => {
    const moved = st.notes.map(x => (x === n ? Object.assign({}, x, { midi: x.midi + sh }) : x));
    assert.equal(PLAN.createsLeftHandJump(st, n, n.midi + sh), LHJ.newJumps(st.notes, moved) > 0, 'note ' + n.midi + ' shift ' + sh);
  }));
});

test('repair with the guard is deterministic and idempotent, and on real selections it never adds a left-hand jump', async () => {
  const g = fixture();
  const a = REP.repair(g, ctxOf(g), {}), b = REP.repair(g, ctxOf(g), {});
  assert.equal(JSON.stringify(a.report.units), JSON.stringify(b.report.units));
  assert.equal(REP.repair(a.graph, ctxOf(a.graph), {}).graph, a.graph, 'repair(repair(g)) returns its input');
  assert.equal(LHJ.newJumps(notesOf(g), notesOf(a.graph)), 0);
  for (const [file, level] of [['catalog/hymns/all-glory-laud.musicxml', 3.0], ['catalog/hymns/nearer-my-god.musicxml', 2.4]]) {
    const gg = await H.graphOf(file), sg = SGG.analyze(gg);
    const request = { targetLevel: level, handProfile: 'large', sections: 'all' };
    const selection = CAND.run(gg, sg, request, { n: 9, levelOffsets: [0] });
    assert.ok(selection.ok, file);
    const r = REP.repairSelection(selection, gg, sg, request, {});
    assert.ok(r.ok && r.report.fallback === null, file);
    assert.equal(LHJ.newJumps(notesOf(selection.selected.graph), notesOf(r.graph)), 0, file + ': repair added no left-hand jump');
    assert.equal(M.melodyPreservation(r.ctx.origMelody, M.graphNoteList(r.graph)), M.melodyPreservation(r.ctx.origMelody, M.graphNoteList(selection.selected.graph)), file + ': melody untouched');
    assert.equal(JSON.stringify(r.graph), JSON.stringify(REP.repairSelection(selection, gg, sg, request, {}).graph), file + ': deterministic');
  }
});
