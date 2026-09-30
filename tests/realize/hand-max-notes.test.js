/* G9 single-note hands (docs/GOALS/G09 section 12 "G9 single-note hands (post user review 5: the teacher's criterion)").

   The teacher (blind) kept finding two-note chords in both hands (thirds with touching noteheads, a sixth, a diminished fifth) after seconds and octave-plus
   chords were gone, and picked "one hand playing two notes at once". The criterion for students at the generated levels: ONE HAND PLAYS ONE NOTE AT A TIME.
   `opts.maxNotes` of realize/handchords.js (`opts.handMaxNotes` of realize(), needs `opts.handChords`; candidates/ passes 1 at stages 1-3) keeps at most N notes
   per written hand at every onset: never the top of a melody-voice event, never the bass; nothing shortened or moved.
   Part 1 is the pure pass on hand-built note lists; part 2 is realize() / candidates on real pieces. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const HC = require(path.join(REPO, 'realize/handchords.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const VC = require(path.join(REPO, 'critics/vertical-clash.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const GOLDEN = require('../fixtures/hand-chords-golden.json');

let nid = 0;
function n(hand, midi, o) {
  o = o || {};
  const id = o.id || ('m' + (nid++));
  return { id: id, hand: hand, on: o.on == null ? 0 : o.on, off: o.off == null ? 1 : o.off, midi: midi, cont: !!o.cont, chain: o.chain || id, keep: !!o.keep, low: !!o.low };
}
const ids = r => r.removedIds.slice().sort();
const one = notes => HC.thin(notes, { model: 'limb', maxNotes: 1 });

/* ================================================================ part 1: the pure pass */
test('N = 1: a third in the right hand loses the lower note (the melody on top stays), a fifth in the left hand loses the upper (the bass stays)', () => {
  const mel = n('RH', 76, { keep: true }), alto = n('RH', 72), bass = n('LH', 43, { keep: true }), tenor = n('LH', 50);
  const r = one([mel, alto, bass, tenor]);
  assert.deepEqual(ids(r), [alto.id, tenor.id].sort());
  assert.equal(r.stats.maxNotes.unfixable, 0);
  assert.equal(r.stats.maxNotes.before.RH.multi, 1); assert.equal(r.stats.maxNotes.after.RH.multi, 0); assert.equal(r.stats.maxNotes.after.LH.multi, 0);
  assert.equal(r.stats.maxNotes.after.LH.max, 1); assert.equal(r.stats.maxNotes.after.RH.max, 1);
});

test('N = 1 removes pairs the old rules leave alone (a third, a sixth, a diminished fifth), and a triad goes down to the bass', () => {
  [[72, 76], [60, 69], [60, 66], [64, 67]].forEach(([lo, hi]) => {
    const a = n('RH', hi, { keep: true }), b = n('RH', lo);
    assert.deepEqual(ids(one([a, b])), [b.id], 'right hand ' + lo + '/' + hi);
    assert.equal(HC.thin([n('RH', hi, { keep: true }), n('RH', lo)], { model: 'limb' }).removedIds.length, 0, 'the old rules do not touch ' + lo + '/' + hi);
  });
  const b = n('LH', 40, { keep: true }), x = n('LH', 47), y = n('LH', 52);
  assert.deepEqual(ids(one([b, x, y])), [x.id, y.id].sort());
});

test('melody top and bass are never removed; the melody event\'s own extra head goes before anything', () => {
  const top = n('RH', 80, { keep: true }), harm = n('RH', 77, { low: true }), inner = n('RH', 70);
  assert.deepEqual(ids(one([top, harm, inner])), [harm.id, inner.id].sort());
  /* no protected note in the hand: the right hand keeps its top note, the left hand its lowest */
  const a = n('RH', 67), b = n('RH', 71), c = n('RH', 74);
  assert.deepEqual(ids(one([a, b, c])), [a.id, b.id].sort(), 'right hand: the top survives');
  const d = n('LH', 38), e = n('LH', 45), f = n('LH', 50);
  assert.deepEqual(ids(one([d, e, f])), [e.id, f.id].sort(), 'left hand: the lowest survives');
});

test('unfixable: a hand whose protected notes are more than N is left and counted; the unprotected are still removed', () => {
  const m = n('LH', 64, { keep: true }), bs = n('LH', 40, { keep: true }), mid = n('LH', 52);
  const r = one([m, bs, mid]);
  assert.deepEqual(ids(r), [mid.id]);
  assert.equal(r.stats.maxNotes.unfixable, 1); assert.equal(r.stats.maxNotes.after.LH.over, 1);
  /* N = 2 allows the pair */
  const r2 = HC.thin([n('LH', 64, { keep: true }), n('LH', 40, { keep: true }), n('LH', 52)], { model: 'limb', maxNotes: 2 });
  assert.equal(r2.removedIds.length, 1); assert.equal(r2.stats.maxNotes.unfixable, 0);
});

test('held notes count: a held inner note under new attacks is removed whole (its tie chain), nothing is shortened', () => {
  const b1 = n('LH', 36, { keep: true, on: 0, off: 1 }), b2 = n('LH', 43, { keep: true, on: 1, off: 2 }), ten = n('LH', 52, { on: 0, off: 2 });
  assert.deepEqual(ids(one([b1, b2, ten])), [ten.id]);
  /* a tie chain: two heads, both go together */
  const t1 = n('LH', 55, { on: 0, off: 1, chain: 'c' }), t2 = n('LH', 55, { on: 1, off: 2, cont: true, chain: 'c' });
  assert.deepEqual(ids(one([n('LH', 36, { keep: true, on: 0, off: 2 }), t1, t2])), [t1.id, t2.id].sort(), 'the whole chain goes');
  /* a kept tie chain keeps every head */
  const k1 = n('RH', 72, { keep: true, on: 0, off: 1, chain: 'k' }), k2 = n('RH', 72, { keep: true, on: 1, off: 2, cont: true, chain: 'k' }), low = n('RH', 65, { on: 1, off: 2 });
  assert.deepEqual(ids(one([k1, k2, low])), [low.id]);
});

test('one note at a time is untouched: a single-note hand, arpeggios (one note at a time) and the other hand are not removed from', () => {
  const notes = [n('RH', 72, { keep: true, on: 0, off: 1 }), n('RH', 74, { keep: true, on: 1, off: 2 }), n('LH', 40, { keep: true, on: 0, off: 0.5 }), n('LH', 47, { on: 0.5, off: 1 }), n('LH', 52, { on: 1, off: 2 })];
  const r = one(notes);
  assert.equal(r.removedIds.length, 0); assert.equal(r.stats.maxNotes.unfixable, 0);
});

test('deterministic, idempotent, input untouched; the old rules still run after (a cross-hand second), and off = the old behaviour exactly', () => {
  const build = () => [n('RH', 76, { keep: true, id: 'a' }), n('RH', 72, { id: 'b' }), n('RH', 69, { id: 'c', low: true }), n('LH', 43, { keep: true, id: 'd' }), n('LH', 50, { id: 'e' }), n('LH', 59, { id: 'f' })];
  const r1 = HC.thin(build(), { maxNotes: 1 }), r2 = HC.thin(build(), { maxNotes: 1 });
  assert.deepEqual(r1, r2);
  const gone = new Set(r1.removedIds);
  const left = build().filter(x => !gone.has(x.id));
  assert.equal(HC.thin(left, { maxNotes: 1 }).removedIds.length, 0, 'the survivors need no further removal');
  const src = build(), copy = JSON.stringify(src); HC.thin(src, { maxNotes: 1 }); assert.equal(JSON.stringify(src), copy);
  /* after N = 1 a cross-hand second between two single notes is still handled by the default model: removed if one is unprotected, counted if both are protected */
  const rh = n('RH', 61, { keep: true }), lhKeep = n('LH', 60, { keep: true });
  const r = HC.thin([rh, lhKeep], { maxNotes: 1 });
  assert.equal(r.removedIds.length, 0);
  assert.equal(r.stats.unfixableCross, 1, 'C4 (bass, protected) under C#4 (melody, protected): a cross-hand second left and counted');
  /* off: no maxNotes key in the stats, the same removals as before */
  assert.equal(HC.thin(build(), { model: 'limb' }).stats.maxNotes, null);
  assert.equal(HC.thin(build()).removedIds.length, HC.thin(build(), { maxNotes: null }).removedIds.length);
});

test('opts.maxNotes must be an integer >= 1', () => {
  [0, -1, 1.5, '1', NaN].forEach(v => assert.throws(() => HC.thin([n('RH', 60)], { maxNotes: v }), /maxNotes/));
});

/* ================================================================ part 2: realize() and candidates */
async function planOf(file, targetLevel, handProfile) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: targetLevel, handProfile: handProfile || 'large', sections: 'all' });
  assert.ok(p.ok, file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan };
}
const fp = r => { assert.ok(r.ok, r.reason); return SER.fingerprint(r.graph); };
const noteKeys = g => VC.notesOf(g).map(x => [x.on, x.off, x.midi, x.hand, x.cont].join('|')).sort();
const perHand = g => { const v = VC.verticalClash(g); return { LH: v.handMaxLH, RH: v.handMaxRH, chordsLH: v.handChordsLH, chordsRH: v.handChordsRH }; };

test('off by default for a direct realize() call: nothing changes unless handChords is on and handMaxNotes is given', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const direct = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', noStride: true });
  assert.equal(direct.report.handChords, undefined);
  assert.equal(fp(direct), GOLDEN.default['christ-arose.musicxml@2.76:hymn'], 'byte for byte the origin/main default');
  assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', noStride: true, handMaxNotes: 1 })), fp(direct), 'handMaxNotes alone (no handChords) does nothing');
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true });
  const b = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true, handMaxNotes: null });
  assert.equal(fp(a), fp(b), 'null is off');
  assert.equal(a.report.handChords.handMaxNotes, undefined);
  assert.throws(() => REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', handChords: true, handMaxNotes: 0 }), /handMaxNotes/);
});

test('candidates/ do NOT pass handMaxNotes by default (origin/main behaviour); opts.last.handMaxNotes: 1 is the stage-3-gated counterfactual (stage 4 untouched)', async () => {
  const f = await planOf('catalog/hymns/pass-me-not.musicxml', 3.87);
  const req = { targetLevel: 3.87, handProfile: 'large', sections: 'all' };
  const def = CAND.enumerate(f.g, f.sg, req, { n: 8 });
  const off = CAND.enumerate(f.g, f.sg, req, { n: 8, singleNoteHands: false });
  assert.deepEqual(def.candidates.map(c => c.fingerprint), off.candidates.map(c => c.fingerprint), 'singleNoteHands false = the default');
  def.candidates.forEach(c => assert.equal(c.report.handChords.handMaxNotes, undefined, 'the default carries no single-note request'));
  assert.ok(def.candidates.some(c => { const pm = perHand(c.graph); return pm.LH > 1 || pm.RH > 1; }), 'the default candidates hold multi-note chords');
  const gated = CAND.enumerate(f.g, f.sg, req, { n: 8, last: { handMaxNotes: 1 } });
  assert.ok(gated.candidates.some(c => c.plan.stage <= 3) && gated.candidates.some(c => c.plan.stage === 4), 'fixture: both stage bands occur');
  gated.candidates.forEach(c => {
    assert.equal(c.report.handChords.handMaxNotes, 1);
    assert.equal(c.report.handChords.active, c.plan.stage <= 3);
    const pm = perHand(c.graph);
    if (c.plan.stage <= 3) assert.ok(pm.LH <= 1 && pm.RH <= 1, 'stage ' + c.plan.stage + ' candidate: one note per hand (' + JSON.stringify(pm) + ')');
  });
  assert.ok(gated.candidates.filter(c => c.plan.stage === 4).some(c => { const pm = perHand(c.graph); return pm.LH > 1 || pm.RH > 1; }), 'stage 4 is not thinned');
});

test('christ-arose (hymn, stage 3), N = 1: one note per hand at every onset, only removal, melody top and bass kept, durations intact, deterministic', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  assert.ok(f.plan.stage <= 3);
  const opts = { pattern: 'hymn', hymnThin: true, handChords: true };
  const before = REALIZE.realize(f.g, f.sg, f.plan, opts);
  const a = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ handMaxNotes: 1 }, opts));
  const b = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ handMaxNotes: 1 }, opts));
  assert.equal(fp(a), fp(b), 'deterministic');
  assert.deepEqual(perHand(a.graph), { LH: 1, RH: 1, chordsLH: 0, chordsRH: 0 });
  const hc = a.report.handChords;
  assert.equal(hc.handMaxNotes, 1); assert.equal(hc.maxNotes.unfixable, 0);
  assert.equal(hc.maxNotes.after.LH.max, 1); assert.equal(hc.maxNotes.after.RH.max, 1);
  assert.ok(hc.removedNotes > 50, 'a hymn loses its inner voices (' + hc.removedNotes + ')');
  /* only removal: every note kept is a note the graph had with the same pitch, onset, end, hand and tie role, none shortened */
  const kb = noteKeys(before.graph), ka = noteKeys(a.graph);
  const pool = new Map(); kb.forEach(k => pool.set(k, (pool.get(k) || 0) + 1));
  ka.forEach(k => { const c = pool.get(k) || 0; assert.ok(c > 0, 'a note that was not there: ' + k); pool.set(k, c - 1); });
  assert.equal(kb.length - ka.length, hc.removedNotes);
  /* melody preserved; the lowest left-hand note at each left-hand onset is the copy's own lowest */
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(a.graph)), 1);
  const low = g => { const m = new Map(); VC.notesOf(g).forEach(x => { if (x.hand !== 'LH' || x.cont) return; const k = x.on.toFixed(3); m.set(k, Math.min(m.has(k) ? m.get(k) : 999, x.midi)); }); return m; };
  const lb = low(before.graph), la = low(a.graph);
  la.forEach((midi, k) => assert.equal(midi, lb.get(k), 'the bass at ' + k + ' is the copy\'s lowest left-hand note'));
  const v = VC.verticalClash(a.graph);
  assert.equal(v.violations + v.crossSeconds, 0);
});

test('the patterns under N = 1: block becomes one bass note per beat, broken and ballad are unchanged (already one note at a time), auto and hymn leave one note per hand', async () => {
  const f = await planOf('catalog/hymns/god-rest-ye-merry.musicxml', 2.87);
  const run = (pattern, n1) => REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: pattern, noStride: true, hymnThin: true, diatonicLow: true, handChords: true }, n1 ? { handMaxNotes: 1 } : {}));
  ['block', 'broken', 'ballad', 'auto', 'hymn'].forEach(p => {
    const a = run(p, true), b = run(p, false);
    assert.ok(a.ok && b.ok, p);
    const pm = perHand(a.graph);
    assert.ok(pm.LH <= 1 && pm.RH <= 1, p + ' ' + JSON.stringify(pm));
    if (p === 'broken' || p === 'ballad') assert.equal(fp(a), fp(b), p + ': already one note at a time, nothing to remove');
    else assert.ok(a.report.handChords.removedNotes > 0, p + ' loses notes');
  });
  /* block: the left hand keeps the lowest note of each chord it had */
  const blk = run('block', true), blk0 = run('block', false);
  const lowAt = g => { const m = new Map(); VC.notesOf(g).forEach(x => { if (x.hand !== 'LH') return; const k = x.on.toFixed(3); m.set(k, Math.min(m.has(k) ? m.get(k) : 999, x.midi)); }); return m; };
  const l1 = lowAt(blk.graph), l0 = lowAt(blk0.graph);
  l1.forEach((midi, k) => assert.equal(midi, l0.get(k), 'block: the bass at ' + k + ' is the chord\'s lowest note'));
});

test('stage gate: at stage 4 the single-note pass does not run and the graph is the same as with it off', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const p4 = Object.assign({}, f.plan, { stage: 4 });
  const on = REALIZE.realize(f.g, f.sg, p4, { pattern: 'hymn', handChords: true, handMaxNotes: 1 });
  const off = REALIZE.realize(f.g, f.sg, p4, { pattern: 'hymn', handChords: true });
  assert.equal(fp(on), fp(off));
  assert.equal(on.report.handChords.active, false);
});

test('the critic counts what the pass counts: handChords per hand, and the multi key the repair guard uses', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const before = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true });
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true, handMaxNotes: 1 });
  const vb = VC.verticalClash(before.graph);
  assert.ok(vb.handChordsLH > 0 && vb.handMaxLH >= 2);
  assert.equal(a.report.handChords.maxNotes.before.RH.multi, vb.handChordsRH);
  assert.equal(a.report.handChords.maxNotes.before.LH.multi, vb.handChordsLH);
  assert.ok(VC.newViolations(a.graph, before.graph, { maxNotes: 1 }).multi > 0, 'putting the chords back is seen as new multi-note chords');
  assert.equal(VC.newViolations(before.graph, a.graph, { maxNotes: 1 }).multi, 0, 'removing them is not');
  assert.equal(VC.newViolations(a.graph, before.graph).multi, undefined, 'without opts.maxNotes the key is not looked for');
});

test('candidates singleNoteHands (default false): one note per hand at EVERY stage, and a separate cache entry', async () => {
  const f = await planOf('catalog/hymns/pass-me-not.musicxml', 3.87);
  const req = { targetLevel: 3.87, handProfile: 'large', sections: 'all' };
  const on = CAND.enumerate(f.g, f.sg, req, { n: 8, singleNoteHands: true });
  assert.ok(on.candidates.some(c => c.plan.stage === 4), 'fixture: a stage-4 candidate exists');
  on.candidates.forEach(c => { const pm = perHand(c.graph); assert.ok(pm.LH <= 1 && pm.RH <= 1, 'stage ' + c.plan.stage + ' ' + JSON.stringify(pm)); assert.equal(c.report.handChords.active, true); });
  const def = CAND.enumerate(f.g, f.sg, req, { n: 8 });
  assert.ok(def.candidates.some(c => c.plan.stage === 4 && !c.report.handChords.active), 'the default leaves stage 4 alone');
  const cache = new Map();
  const a = CAND.run(f.g, f.sg, req, { cache: cache });
  const b = CAND.run(f.g, f.sg, req, { cache: cache, singleNoteHands: true });
  assert.equal(cache.size, 2, 'two cache keys');
  assert.notEqual(SER.fingerprint(a.selected.graph), SER.fingerprint(b.selected.graph));
});
