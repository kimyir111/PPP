/* Repair - G9b mutation-style suite (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5 G9b, §9).
   Every op has a PLANTED-DEFECT test (a hand-written graph with a known, exact defect that the
   op must fix) and a NEGATIVE CONTROL (a graph the op must leave alone, returned as the very
   same object). Plus: the structural rollback (a planted repair that WOULD add a hard violation
   is rolled back and the input comes back untouched), the definitions of "got worse" (judge()
   over synthetic snapshots), provenance, melody preservation, determinism, idempotence, and one
   real-corpus end-to-end run through candidates -> repair. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const P = require(path.join(REPO, 'scoregraph/pitch.js'));
const PROV = require(path.join(REPO, 'scoregraph/prov.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const HARM = require(path.join(REPO, 'songgraph/harmony.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const VL = require(path.join(REPO, 'critics/voice-leading.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const REP = require(path.join(REPO, 'repair/index.js'));

/* the first voice of the fixture (the RH melody line) as the original-melody note list */
function melodyOf(g, voiceIndex) {
  const vid = g.parts[0].voices[voiceIndex || 0].id;
  return U.noteWindows(g).filter(n => n.voiceId === vid).map(n => ({ onsetQ: R.toNumber(n.w0) * 4, midi: n.midi }));
}
function ctxOf(g, extra) {
  return Object.assign({ profile: 'large', origMelody: melodyOf(g), harmony: HARM.harmonyOf(g) }, extra || {});
}
const midiByHead = g => { const m = {}; U.noteWindows(g).forEach(n => { m[n.headId] = n.midi; }); return m; };
const sounding = g => U.noteWindows(g).map(n => R.format(n.w0) + '|' + n.midi + '|' + n.voiceId).sort();

/* ---------------------------------------------------------------- parallel */
test('parallel: planted parallel octaves between the outer voices are re-voiced (bass note up an octave = chord inversion)', () => {
  /* RH melody C5->D5; LH chord C3+G3 -> D3+A3: the outer voices are an octave-class apart (72/48, 74/50)
     and both move up - parallel octaves. Only the LH may move; the melody is protected. */
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  assert.equal(VL.voiceLeadingSmells(g).parallels.length, 1, 'the fixture must plant exactly one parallel');
  const ctx = ctxOf(g);
  const r = REP.repair(g, ctx, {});
  assert.equal(r.changed, true);
  assert.equal(r.report.accepted, 1);
  assert.equal(r.report.byOp.parallel.accepted, 1);
  assert.equal(VL.voiceLeadingSmells(r.graph).count, 0, 'the parallel must be gone');
  assert.equal(M.hardViolationsOfGraph(r.graph, 'large').hard, 0);
  /* melody untouched, note for note */
  const melodyAfter = M.melodyPreservation(ctx.origMelody, M.graphNoteList(r.graph));
  assert.equal(melodyAfter, 1);
  const before = midiByHead(g), after = midiByHead(r.graph);
  const moved = Object.keys(before).filter(h => after[h] !== before[h]);
  assert.equal(moved.length, 1);
  assert.equal(Math.abs(after[moved[0]] - before[moved[0]]) % 12, 0, 'a repair only moves a head by whole octaves');
  /* harmony reading unchanged */
  const ha = M.harmonyAgreement(ctx.harmony, r.graph);
  assert.equal(ha.rootQuality, M.harmonyAgreement(ctx.harmony, g).rootQuality);
});

test('parallel: every repaired head and its event carry provenance op "repaired"; untouched heads do not', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  const r = REP.repair(g, ctxOf(g), {});
  const before = midiByHead(g), after = midiByHead(r.graph);
  const ev = new Map(); r.graph.parts[0].events.forEach(e => (e.heads || []).forEach(h => ev.set(h.id, e)));
  Object.keys(after).forEach(id => {
    const op = PROV.provOf(r.graph, id, 'pitch').op;
    if (after[id] !== before[id]) {
      assert.equal(op, 'repaired', 'head ' + id + ' was moved and must say so');
      assert.equal(PROV.provOf(r.graph, ev.get(id).id, 'pitch').op, 'repaired', 'its event too');
      assert.equal(PROV.provOf(r.graph, id).src !== undefined, true);
    } else assert.notEqual(op, 'repaired', 'head ' + id + ' was not touched');
  });
  const src = r.graph.provenance.sources.find(s => s.kind === 'repair');
  assert.ok(src && src.tool === 'ppp.g9b-repair', 'the repair source is registered');
});

test('parallel negative control: contrary motion has no smell and the graph comes back as the SAME object', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q B4:q', lh: 'C3:q D3:q' });
  const r = REP.repair(g, ctxOf(g), {});
  assert.equal(r.changed, false);
  assert.equal(r.graph, g);
  assert.equal(r.report.units.length, 0);
});

test('parallel negative control: a stepwise octave-doubled run is a smell but is LEFT ALONE (the only fixes would be octave leaps)', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C4:q D4:q E4:q F4:q' });
  assert.ok(VL.voiceLeadingSmells(g).parallels.length >= 1);
  const r = REP.repair(g, ctxOf(g), {});
  assert.equal(r.changed, false);
  assert.equal(r.graph, g, 'no candidate meets the same-line smoothness bound, so nothing may change');
  assert.ok(r.report.unplannable >= 1, 'reported as not repairable, not silently ignored');
});

test('parallel negative control: with no melody supplied the top note of every slice is still protected', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  const r = REP.repair(g, { profile: 'large', harmony: HARM.harmonyOf(g) }, {});
  assert.equal(M.melodyPreservation(melodyOf(g), M.graphNoteList(r.graph)), 1);
});

/* ---------------------------------------------------------------- innerLeap */
test('innerLeap: a planted 21-semitone inner-voice leap is brought inside an octave', () => {
  /* rh melody C6 C6 (top), lh bass C3 C3 (bottom), rh2 (inner) D4 -> B5: 21 semitones */
  const g = mk({ time: [2, 4], rh: 'C6:q C6:q', rh2: 'D4:q B5:q', lh: 'C3:q C3:q' });
  const s0 = VL.voiceLeadingSmells(g);
  assert.equal(s0.innerLeaps.length, 1);
  const hard0 = M.hardViolationsOfGraph(g, 'large').hard;
  const r = REP.repair(g, ctxOf(g, { harmony: HARM.harmonyOf(g) }), {});
  assert.equal(r.report.byOp.innerLeap.accepted, 1, JSON.stringify(r.report.units));
  const s1 = VL.voiceLeadingSmells(r.graph);
  assert.equal(s1.innerLeaps.length, 0);
  assert.equal(s1.count, 0);
  assert.ok(M.hardViolationsOfGraph(r.graph, 'large').hard <= hard0, 'never more hard violations than the input had');
  assert.equal(M.melodyPreservation(melodyOf(g), M.graphNoteList(r.graph)), 1);
});

test('innerLeap negative control: a leap of exactly an octave is not a smell and nothing moves', () => {
  const g = mk({ time: [2, 4], rh: 'C6:q C6:q', rh2: 'D4:q D5:q', lh: 'C3:q C3:q' });
  assert.equal(VL.voiceLeadingSmells(g).innerLeaps.length, 0);
  const r = REP.repair(g, ctxOf(g), {});
  assert.equal(r.graph, g);
});

/* ---------------------------------------------------------------- crossing */
test('crossing: a planted voice crossing is restored by moving the non-melody voice an octave', () => {
  /* rh (melody) G5 E5 G5; rh2 E5 G5 E5 swaps above it on the middle beat; lh only widens the range
     so a one-octave move stays inside the piece's own range */
  const g = mk({ time: [3, 4], rh: 'G5:q E5:q G5:q', rh2: 'E5:q G5:q E5:q', lh: 'C3:q C3:q C3:q' });
  assert.equal(VL.voiceLeadingSmells(g).crossings.length, 1);
  const r = REP.repair(g, ctxOf(g), {});
  assert.equal(r.report.byOp.crossing.accepted, 1, JSON.stringify(r.report.units));
  assert.equal(VL.voiceLeadingSmells(r.graph).crossings.length, 0);
  assert.equal(M.melodyPreservation(melodyOf(g), M.graphNoteList(r.graph)), 1);
  assert.equal(M.hardViolationsOfGraph(r.graph, 'large').hard, 0);
});

test('crossing negative control: voices that keep their order are untouched', () => {
  const g = mk({ time: [3, 4], rh: 'G5:q G5:q G5:q', rh2: 'E5:q E5:q E5:q', lh: 'C3:q C3:q C3:q' });
  assert.equal(REP.repair(g, ctxOf(g), {}).graph, g);
});

/* ---------------------------------------------------------------- dropDoubling */
test('dropDoubling: octave doublings in a measure over the stage chord-load ceiling are dropped, the pitch classes are kept', () => {
  /* stage 1's real chordLoad ceiling (max over the stage-1 corpus) is 1.16 extra keys per beat; four LH
     triads doubled at the octave are 2.0 per beat. Dropping one doubling per attack brings it to 1.0. */
  const lh = 'C3+G3+C4:q G2+D3+G3:q C3+G3+C4:q G2+D3+G3:q';
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: lh });
  const ctx = ctxOf(g, { stage: 1 });
  const before = REP.snapshot(g, ctx, { refHarmony: ctx.harmony, band: require(path.join(REPO, 'critics/register-density.js')).densityBand(1) });
  assert.ok(Object.values(before.density.chordExcess)[0] > 0.5, 'the fixture must plant a chord-load overage');
  const r = REP.repair(g, ctx, {});
  assert.equal(r.changed, true);
  assert.equal(r.report.byOp.dropDoubling.accepted, 4, JSON.stringify(r.report.units));
  const lows = U.noteWindows(r.graph).map(n => n.midi).filter(x => x < 72).sort((a, b) => a - b);
  assert.deepEqual(lows, [43, 43, 48, 48, 50, 50, 55, 55], 'the upper doubling of each triad went; bass and pitch classes stay');
  const pcs = a => Array.from(new Set(a.map(x => x % 12))).sort((a, b) => a - b);
  assert.deepEqual(pcs(U.noteWindows(r.graph).map(n => n.midi)), pcs(U.noteWindows(g).map(n => n.midi)));
  assert.equal(M.melodyPreservation(ctx.origMelody, M.graphNoteList(r.graph)), 1);
  assert.equal(M.hardViolationsOfGraph(r.graph, 'large').hard, 0);
  const changedEv = r.graph.parts[0].events.filter(e => PROV.provOf(r.graph, e.id, 'exists').op === 'repaired');
  assert.equal(changedEv.length, 4, 'each event that lost a head says so');
  assert.ok(r.report.after.densityOverage <= r.report.before.densityOverage);
  assert.equal(r.report.after.harmonyRootQuality, r.report.before.harmonyRootQuality);
});

test('dropDoubling negative controls: no doubling to drop, and a chord within the band at a higher stage', () => {
  const noDoubling = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3+E3+G3:q G2+B2+D3:q C3+E3+G3:q G2+B2+D3:q' });
  const a = REP.repair(noDoubling, ctxOf(noDoubling, { stage: 1 }), {});
  assert.equal(a.graph, noDoubling, 'a triad with no doubled pitch class has nothing to drop (over-ceiling is reported, not "fixed" by deleting chord tones)');
  const withinBand = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3+C4:q G2+G3:q C3+C4:q G2+G3:q' });
  const b = REP.repair(withinBand, ctxOf(withinBand, { stage: 3 }), {});
  assert.equal(b.graph, withinBand, 'at stage 3 an octave-doubled dyad (1.0 extra key per beat) is inside the real ceiling (1.73): not a defect, not touched');
});

test('dropDoubling never drops a protected melody note', () => {
  /* the doubled pitch class is in the melody voice itself: RH chord C5+C6, declared melody */
  const g = mk({ time: [2, 4], rh: 'C5+C6:h', lh: 'C3:h' });
  const r = REP.repair(g, ctxOf(g, { stage: 1 }), {});
  assert.equal(r.graph, g);
});

/* ---------------------------------------------------------------- rollback: never adds a hard violation */
test('rollback: a planted repair that WOULD add a hard violation is rolled back and the input comes back untouched', () => {
  /* LH chord C3 E3 G3 -> D3 F3 A3 under RH C5 -> D5: parallel octaves (72/48, 74/50). The right repair is the
     bass note up ONE octave (chord inversion). The seeded unit moves it up TWO octaves instead: the
     smell count still falls (the outer interval stops being perfect) but the LH span becomes 20 > 14, a
     G5 SPAN hard violation. maxTrials 1 tries only the seed. */
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+E3+G3:q D3+F3+A3:q' });
  const c3 = U.noteWindows(g).find(n => n.midi === 48);
  const seed = { op: 'parallel', m: c3.m, key: 'planted', smellsBefore: 1, smellsAfter: 0, edits: [{ headId: c3.headId, eventId: c3.eventId, from: 48, to: 72, pitch: c3.pitch }] };
  const ctx = ctxOf(g);
  const r = REP.repair(g, ctx, { seedUnits: [seed], maxTrials: 1 });
  assert.equal(r.graph, g, 'the input comes back as the very same object');
  assert.equal(r.changed, false);
  assert.equal(r.report.accepted, 0);
  assert.equal(r.report.rolledBack, 1);
  assert.ok(r.report.units[0].reasons.some(x => x.startsWith('HARD_')), 'rejected for the hard violation, got ' + JSON.stringify(r.report.units[0].reasons));
  assert.deepEqual(r.report.rolledBackMeasures, [c3.m]);
  /* the hard violation really is there if the unit is applied: this is not a vacuous rollback */
  const forced = REP.applyUnit(g, seed).graph;
  assert.ok(M.hardViolationsOfGraph(forced, 'large').hard > M.hardViolationsOfGraph(g, 'large').hard);
  /* and with no seed the honest one-octave repair is accepted, so the rollback above was the guard's doing */
  const honest = REP.repair(g, ctx, {});
  assert.equal(honest.changed, true);
  assert.equal(M.hardViolationsOfGraph(honest.graph, 'large').hard, 0);
});

test('the guard uses the REQUEST hand profile: the same re-voicing is accepted for large hands and rolled back for small', () => {
  /* LH C3+G3 -> D3+Eb3 under RH C5 -> D5: parallel octaves. The only re-voicing lifts the second bass note an
     octave: the LH dyad (51,62) then spans 11 semitones - inside a large hand (14), outside a small one (10). */
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+Eb3:q' });
  assert.equal(M.hardViolationsOfGraph(g, 'small').hard, 0);
  const large = REP.repair(g, ctxOf(g, { profile: 'large' }), {});
  assert.equal(large.changed, true);
  assert.equal(M.hardViolationsOfGraph(large.graph, 'large').hard, 0);
  const small = REP.repair(g, ctxOf(g, { profile: 'small' }), {});
  assert.equal(small.graph, g, 'for a small hand the same move adds a hard violation, so it is rolled back');
  assert.ok(small.report.rolledBack >= 1);
  assert.ok(small.report.units.some(u => (u.reasons || []).some(x => x.startsWith('HARD_'))), JSON.stringify(small.report.units));
  assert.equal(M.hardViolationsOfGraph(small.graph, 'small').hard, 0);
});

/* ---------------------------------------------------------------- what "worse" means */
test('judge: each declared definition of "got worse" is enforced (synthetic snapshots)', () => {
  const base = () => ({
    hard: { total: 0, byCode: {}, perM: {} },
    smells: { total: 2, byCat: { parallels: 2, innerLeaps: 0, crossings: 0 }, perM: { m1: { parallels: 2, innerLeaps: 0, crossings: 0 } } },
    harmony: { perM: { m1: 4, m2: 4 }, matched: 8, n: 8 },
    melody: { perM: { m1: 4, m2: 4 }, matched: 8, n: 8 },
    density: { perM: { m1: 0, m2: 0 }, chordExcess: { m1: 0, m2: 0 }, piece: 0 },
    level: 2
  });
  const better = () => { const s = base(); s.smells.total = 1; s.smells.perM.m1.parallels = 1; return s; };
  const unit = { op: 'parallel', m: 'm1' };
  const ctx = { targetLevel: 2 };
  const j = (mutate, u) => { const n = better(); mutate(n); return REP.judge(base(), n, u || unit, base(), ctx); };
  assert.deepEqual(j(() => {}), [], 'a clean smell-reducing unit passes');
  assert.ok(j(n => { n.hard.total = 1; n.hard.perM.m2 = { hard: 1, byCode: { SPAN: 1 } }; }).some(x => x.startsWith('HARD')), 'a new hard violation, even in the NEXT measure');
  assert.ok(j(n => { n.hard.total = 0; n.hard.perM.m1 = { hard: 1, byCode: { KEYS: 1 } }; }).some(x => x === 'HARD_UP@m1'));
  assert.ok(j(n => { n.smells.perM.m2 = { parallels: 0, innerLeaps: 1, crossings: 0 }; }).some(x => x.startsWith('SMELL_innerLeaps_UP')), 'a smell category rising anywhere');
  assert.ok(j(n => { n.smells.total = 2; n.smells.perM.m1.parallels = 2; }).includes('SMELLS_NOT_DOWN'), 'a repair that does not reduce smells is pointless');
  assert.ok(j(n => { n.harmony.perM.m2 = 3; }).includes('HARMONY_DOWN@m2'));
  assert.ok(j(n => { n.melody.perM.m1 = 3; n.melody.matched = 7; }).includes('MELODY_DOWN'));
  assert.ok(j(n => { n.density.perM.m2 = 0.5; }).includes('DENSITY_UP@m2'));
  assert.ok(j(n => { n.density.piece = 0.2; }).includes('PIECE_DENSITY_UP'));
  assert.ok(j(n => { n.level = 2.4; }).includes('LEVEL_DRIFT'));
  assert.equal(j(n => { n.level = 2.03; }).includes('LEVEL_DRIFT'), false, 'inside the 0.05 slack');
  const drop = { op: 'dropDoubling', m: 'm1' };
  const dropSnap = () => { const p = base(); p.density.chordExcess.m1 = 1; return p; };
  const okDrop = base(); okDrop.density.chordExcess.m1 = 0.5; okDrop.smells.total = 2;
  assert.deepEqual(REP.judge(dropSnap(), okDrop, drop, base(), ctx), []);
  assert.ok(REP.judge(dropSnap(), dropSnap(), drop, base(), ctx).some(x => x.startsWith('CHORD_EXCESS_NOT_DOWN')));
});

/* ---------------------------------------------------------------- locked heads */
test('gliss heads are locked like tie and arpeggio heads: a glissando end is never moved', () => {
  const PLAN = require(path.join(REPO, 'repair/plan.js'));
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  assert.equal(REP.repair(g, ctxOf(g), {}).changed, true, 'control: without the spanner the planted parallel is repaired');
  const lh = U.noteWindows(g).filter(n => n.midi < 60);
  const lo1 = lh.filter(n => n.midi === 48)[0], lo2 = lh.filter(n => n.midi === 50)[0];
  const gl = JSON.parse(JSON.stringify(g));
  gl.parts[0].spanners = (gl.parts[0].spanners || []).concat([{ id: 'sp_gl1', type: 'gliss', from: lo1.headId, to: lo2.headId }]);
  const state = PLAN.annotate(gl, ctxOf(gl));
  const locked = state.notes.filter(n => n.locked).map(n => n.headId).sort();
  assert.deepEqual(locked, [lo1.headId, lo2.headId].sort(), 'exactly the two gliss ends are locked');
  const r = REP.repair(gl, ctxOf(gl), {});
  assert.equal(r.changed, false, 'the bass note that would have been re-voiced is a gliss end, so nothing moves');
  assert.equal(r.graph, gl);
});

/* ---------------------------------------------------------------- determinism, idempotence */
test('determinism and idempotence: same input -> byte-identical output; repairing a repaired graph changes nothing', () => {
  const g = mk({ time: [2, 4], rh: 'C5:q D5:q', lh: 'C3+G3:q D3+A3:q' });
  const ctx = ctxOf(g);
  const a = REP.repair(g, ctx, {}), b = REP.repair(g, ctx, {});
  assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph));
  assert.equal(JSON.stringify(a.graph), JSON.stringify(b.graph));
  const strip = rep => { const c = JSON.parse(JSON.stringify(rep)); delete c.ms; return c; };
  assert.deepEqual(strip(a.report), strip(b.report));
  const again = REP.repair(a.graph, ctx, {});
  assert.equal(again.changed, false);
  assert.equal(again.graph, a.graph, 'a repaired graph is a fixed point (the input object itself comes back)');
});

/* ---------------------------------------------------------------- real corpus, end to end */
async function pipeline(file, n) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  const ARR = require(path.join(REPO, 'arrangement/index.js'));
  for (const lvl of [pos, pos + 1, pos - 1, pos + 2]) {
    for (const profile of ['large', 'medium', 'small']) {
      const p = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (!p.ok) continue;
      const request = { targetLevel: lvl, handProfile: profile, sections: 'all' };
      return { g, sg, request, selection: CAND.run(g, sg, request, { n: n || 9, levelOffsets: [0] }) };
    }
  }
  return null;
}

test('real corpus: repair of the selected candidate keeps melody, adds no hard violation, is deterministic and idempotent', async () => {
  const x = await pipeline('catalog/hymns/all-glory-laud.musicxml', 9);
  assert.ok(x && x.selection.ok, 'the fixture piece must select a candidate');
  const r = REP.repairSelection(x.selection, x.g, x.sg, x.request, {});
  assert.equal(r.ok, true);
  const sel = x.selection.selected;
  assert.ok(r.report.fallback === null, String(r.report.fallback));
  assert.ok(M.hardViolationsOfGraph(r.graph, x.request.handProfile).hard <= M.hardViolationsOfGraph(sel.graph, x.request.handProfile).hard);
  assert.equal(M.melodyPreservation(r.ctx.origMelody, M.graphNoteList(r.graph)), M.melodyPreservation(r.ctx.origMelody, M.graphNoteList(sel.graph)));
  assert.ok(VL.voiceLeadingSmells(r.graph).count <= VL.voiceLeadingSmells(sel.graph).count);
  const r2 = REP.repairSelection(x.selection, x.g, x.sg, x.request, {});
  assert.equal(JSON.stringify(r.graph), JSON.stringify(r2.graph), 'deterministic');
  const again = REP.repair(r.graph, r.ctx, {});
  assert.equal(again.changed, false, 'idempotent');
  assert.equal(again.graph, r.graph);
});
