/* G9f (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12 "G9f final-review fixes"): a repair must not change notes the SOURCE itself wrote that way.
   The G9b voice-leading moves (parallel, innerLeap, crossing) fix a smell the critics find in the ARRANGED graph. A smell the SOURCE graph has too, at the same
   onset and (mod an octave) with the same pitches, is the source's own (hanon/010 is built on parallel octaves between the hands: the `parallel` move used to
   break ten of them), so it is never planned. `ctx.sourceSmells` carries the source's smells; repairSelection supplies it, `opts.sourceGuard: false` turns it off. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const HARM = require(path.join(REPO, 'songgraph/harmony.js'));
const VL = require(path.join(REPO, 'critics/voice-leading.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const PLAN = REP.plan;

const melodyOf = g => { const vid = g.parts[0].voices[0].id; return U.noteWindows(g).filter(n => n.voiceId === vid).map(n => ({ onsetQ: R.toNumber(n.w0) * 4, midi: n.midi })); };
const ctxOf = (g, extra) => Object.assign({ profile: 'large', origMelody: melodyOf(g), harmony: HARM.harmonyOf(g) }, extra || {});
/* RH melody C5 -> D5 over LH C3+G3 -> D3+A3: the outer voices are an octave-class apart (72/48, 74/50) and both move up: one parallel octave, repairable */
const FIX = { time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' };

test('source guard: a parallel the source has (the same onset, the same pitches) is left alone: the very same graph comes back', () => {
  const g = mk(FIX);
  assert.equal(VL.voiceLeadingSmells(g).parallels.length, 1);
  const r = REP.repair(g, ctxOf(g, { sourceSmells: VL.voiceLeadingSmells(g) }), {});
  assert.equal(r.changed, false);
  assert.equal(r.graph, g);
  assert.equal(r.report.accepted, 0);
  assert.equal(r.report.byOp.parallel, undefined, 'no parallel move was even planned');
  assert.equal(VL.voiceLeadingSmells(r.graph).parallels.length, 1, 'the smell is still there, still counted');
});

test('source guard: the same arrangement is repaired as before when the source does NOT have that smell (a different source, an absent list, or the switch)', () => {
  const g = mk(FIX);
  const plain = REP.repair(g, ctxOf(g), {});
  assert.equal(plain.changed, true);
  assert.equal(plain.report.byOp.parallel.accepted, 1);
  /* a source without parallels */
  const clean = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q B2+F3:q' });
  assert.equal(VL.voiceLeadingSmells(clean).parallels.length, 0);
  const r1 = REP.repair(g, ctxOf(g, { sourceSmells: VL.voiceLeadingSmells(clean) }), {});
  assert.equal(r1.changed, true);
  assert.equal(r1.report.byOp.parallel.accepted, 1);
  /* a source with a parallel octave at the same onset but other pitches (D5 -> E5 over D3 -> E3): not the same relation */
  const other = mk({ time: [2, 4], rh: 'D5:q E5:q', lh: 'D3+A3:q E3+B3:q' });
  assert.equal(VL.voiceLeadingSmells(other).parallels.length, 1);
  const r2 = REP.repair(g, ctxOf(g, { sourceSmells: VL.voiceLeadingSmells(other) }), {});
  assert.equal(r2.changed, true, 'another pair of pitches at that onset is not the source\'s smell');
  /* the result of a guarded repair with an unrelated source is byte for byte the unguarded one */
  assert.equal(JSON.stringify(r1.graph), JSON.stringify(plain.graph));
});

test('source guard: the identity of a smell is octave-free (an arrangement an octave away from the source is still the source\'s smell)', () => {
  const g = mk(FIX);
  const arranged = mk({ time: [2, 4], rh: 'C6:q D6:q', lh: 'C2+G2:q D2+A2:q' });
  const keys = PLAN.sourceKeysOf(VL.voiceLeadingSmells(g));
  const s = VL.voiceLeadingSmells(arranged).parallels[0];
  assert.ok(keys.has(PLAN.smellId('parallel', s)), 'the same relation two octaves apart');
  const state = PLAN.annotate(arranged, { origMelody: melodyOf(arranged), sourceSmells: VL.voiceLeadingSmells(g) });
  assert.equal(PLAN.listSmells(state).list.length, 0, 'not planned');
  const state2 = PLAN.annotate(arranged, { origMelody: melodyOf(arranged) });
  assert.equal(PLAN.listSmells(state2).list.length, 1, 'planned without the source');
});

test('source guard: innerLeap and crossing smells follow the same rule (same onset, same pitches mod an octave)', () => {
  const id = PLAN.smellId;
  assert.equal(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/4', from: 62, to: 60 }), 'pitch classes 2 and 0: the same leap, whatever the octave');
  assert.notEqual(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/2', from: 50, to: 72 }), 'another onset');
  assert.notEqual(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/4', from: 51, to: 72 }), 'another pitch');
  assert.equal(id('crossing', { w0: '0', midis: [60, 48] }), id('crossing', { w0: '0', midis: [36, 72] }));
  assert.notEqual(id('crossing', { w0: '0', midis: [60, 48] }), id('crossing', { w0: '0', midis: [60, 49] }));
  /* a planted crossing the source has too is not repaired; the same arrangement without that source smell is */
  const crossed = mk({ rh: 'C5:q C5:q C5:q C5:q', rh2: 'G3:q G3:q G6:q G3:q', lh: 'C3:w' }); /* the second voice (lower on average) jumps above the first on beat 3 */
  const sm = VL.voiceLeadingSmells(crossed);
  assert.equal(sm.crossings.length, 1);
  const plain = REP.repair(crossed, ctxOf(crossed), {});
  assert.deepEqual(plain.report.byOp, { crossing: { accepted: 1, rolledBack: 0 } }, 'repaired without the source smell');
  const r = REP.repair(crossed, ctxOf(crossed, { sourceSmells: sm }), {});
  assert.equal(r.changed, false);
  assert.equal(r.graph, crossed);
  assert.deepEqual(r.report.byOp, {}, 'the source crossing is not repaired');
});
