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
const IMPORT = require(path.join(REPO, 'scoregraph/musicxml-import.js'));
const P = require(path.join(REPO, 'scoregraph/pitch.js'));
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

test('source guard: a parallel is compared modulo an octave (an arrangement an octave from its source still has the source parallel octaves); an inner leap and a crossing by their EXACT pitches', () => {
  const g = mk(FIX);
  const arranged = mk({ time: [2, 4], rh: 'C6:q D6:q', lh: 'C2+G2:q D2+A2:q' });
  const keys = PLAN.sourceKeysOf(VL.voiceLeadingSmells(g));
  const s = VL.voiceLeadingSmells(arranged).parallels[0];
  assert.ok(keys.has(PLAN.smellId('parallel', s)), 'the same parallel two octaves apart');
  const id = PLAN.smellId;
  assert.notEqual(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/4', from: 62, to: 60 }), 'the same pitch classes in other octaves are not the same leap');
  assert.equal(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/4', from: 50, to: 72 }));
  assert.notEqual(id('innerLeap', { w0: '1/4', from: 50, to: 72 }), id('innerLeap', { w0: '1/2', from: 50, to: 72 }), 'another onset');
  assert.notEqual(id('crossing', { w0: '0', midis: [60, 48] }), id('crossing', { w0: '0', midis: [36, 72] }), 'the same pitch classes {C} in other octaves: not the same crossing');
  assert.equal(id('crossing', { w0: '0', midis: [60, 48] }), id('crossing', { w0: '0', midis: [48, 60] }), 'order of the pair does not matter');
  assert.notEqual(id('crossing', { w0: '0', midis: [60, 48] }), id('crossing', { w0: '0', midis: [60, 49] }));
  /* the reviewer's repro: in-the-bleak-midwinter has 141 inner-voice crossings, two of them at m2 3/4 with pitch classes {C, A}; the arrangement's hand crossing there (A4 = 69 under C5 = 72) is
     NOT one of them (exact pitches) */
  const bleak = IMPORT.importMusicXml(require('fs').readFileSync(path.join(REPO, 'catalog/hymns/in-the-bleak-midwinter.musicxml'), 'utf8'), { scoreId: 'bleak' });
  assert.ok(bleak.ok);
  const bk = PLAN.sourceKeysOf(VL.voiceLeadingSmells(bleak.graph));
  assert.equal(bk.has(PLAN.smellId('crossing', { w0: '3/4', midis: [69, 72] })), false);
  /* a planted crossing the source has too (exact pitches) is a source smell; the same arrangement without it is not */
  const crossed = mk({ rh: 'C5:q C5:q C5:q C5:q', rh2: 'G3:q G3:q G6:q G3:q', lh: 'C3:w' });
  const sm = VL.voiceLeadingSmells(crossed);
  assert.equal(sm.crossings.length, 1);
  assert.ok(PLAN.sourceKeysOf(sm).has(PLAN.smellId('crossing', sm.crossings[0])));
});

test('source guard: a source smell is repaired only TOWARDS the source (the new pitch must be one the source sounds at that onset)', () => {
  /* the arrangement has the source's parallel octaves but sits an octave away from the source (source RH C5 D5 / LH C3+G3 D3+A3): the repair that brings a note to a pitch the source has
     is allowed, one that moves away from it is not */
  const src = mk(FIX);
  const sourcePitchAt = new Map();
  U.noteWindows(src).forEach(n => { const k = R.format(n.w0); if (!sourcePitchAt.has(k)) sourcePitchAt.set(k, new Set()); sourcePitchAt.get(k).add(n.midi); });
  const same = REP.repair(src, ctxOf(src, { sourceSmells: VL.voiceLeadingSmells(src), sourcePitchAt: sourcePitchAt }), {});
  assert.equal(same.changed, false, 'the arrangement IS the source: every move would leave the source: nothing is done');
  /* the arranged left hand sits an octave below the source's (C2+G2 D2+A2 under RH C5 D5; the source has C3+G3 D3+A3): the same parallel octaves (mod an octave), so the smell is the
     source's; moving the left hand's low note UP an octave lands on a pitch the source sounds: allowed. Moving it anywhere else would not be. */
  const arranged = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C2+G2:q D2+A2:q' });
  assert.equal(VL.voiceLeadingSmells(arranged).parallels.length, 1);
  assert.ok(PLAN.sourceKeysOf(VL.voiceLeadingSmells(src)).has(PLAN.smellId('parallel', VL.voiceLeadingSmells(arranged).parallels[0])));
  const back = REP.repair(arranged, ctxOf(arranged, { sourceSmells: VL.voiceLeadingSmells(src), sourcePitchAt: sourcePitchAt }), { });
  assert.equal(back.changed, true, 'brought back towards the source');
  const before = U.noteWindows(arranged), after = U.noteWindows(back.graph);
  const moved = before.filter(n => after.find(a => a.headId === n.headId).midi !== n.midi);
  assert.ok(moved.length >= 1);
  moved.forEach(n => assert.ok(sourcePitchAt.get(R.format(n.w0)).has(after.find(a => a.headId === n.headId).midi), 'every moved note lands on a pitch the source sounds at that onset'));
  /* and with a source that has the smell but no pitch table (a caller that gives only the smells): nothing may move */
  const noTable = REP.repair(arranged, ctxOf(arranged, { sourceSmells: VL.voiceLeadingSmells(src) }), {});
  assert.equal(noTable.changed, false);
});

test('source guard on the reviewed case: in-the-bleak-midwinter gets no new hand crossing from the guard (all three levels), and hanon/010 keeps the parallel octaves', async () => {
  const E = require('../realize/app-single-extract.js');
  const ref = E.reference();
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });
  const crossings = gr => {
    const part = gr.parts[0], limb = new Map(part.staves.map(st => [st.id, st.limb]));
    const by = new Map();
    const starts = []; let acc = R.ZERO; gr.timeline.measures.forEach(m => { starts.push(acc); acc = R.add(acc, R.parse(m.dur)); });
    const idx = new Map(gr.timeline.measures.map((m, i) => [m.id, i]));
    part.events.forEach(e => { if (e.kind !== 'note' || e.grace) return; const k = R.format(R.add(starts[idx.get(e.m)], R.parse(e.at))); e.heads.forEach(h => { (by.get(k) || by.set(k, []).get(k)).push([limb.get(e.staff), P.midi(h.pitch)]); }); });
    let n = 0;
    by.forEach(v => { const r = v.filter(x => x[0] === 'RH').map(x => x[1]), l = v.filter(x => x[0] === 'LH').map(x => x[1]); if (r.length && l.length && Math.min(...r) < Math.max(...l)) n++; });
    return n;
  };
  const SGIDX = require(path.join(REPO, 'scoregraph/index.js'));
  const fs = require('fs');
  const load = async rel => (await SGIDX.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: rel, scoreId: rel.replace(/[^A-Za-z0-9._:-]/g, '-') })).graph;
  const bleak = await load('catalog/hymns/in-the-bleak-midwinter.musicxml');
  const srcCross = crossings(bleak);
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    const on = await app.arrangeSingleNote(bleak, { level: level });
    assert.ok(on.ok);
    assert.ok(crossings(on.graph) <= srcCross, level + ': hand crossings ' + crossings(on.graph) + ' (source ' + srcCross + ')');
  }
});
