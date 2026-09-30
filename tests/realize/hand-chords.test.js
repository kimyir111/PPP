/* G9 source-copied hand chords (docs/GOALS/G09 section 12 "G9 source-copied hand chords (post user review 4)").

   The user (a piano teacher, blind) still found a second stacked on a second (noteheads touching) and two notes an octave or more apart played "by one
   hand" in levels 2-4 output. Measured: the hands as written held 1 second and 0 octave chords on the 8 hymns of the h8i packet, the pitch grouping around
   middle C (the notes below C4 / at or above it: how the reviewer reads the page) 6 seconds and 33 octave chords, nearly all of it a voice of one hand
   sounding beside or an octave under a voice of the other hand. realize/handchords.js removes the least important note(s); realize() runs it behind
   `opts.handChords` (default OFF for a direct call, ON from candidates/).
   Part 1 is the pure pass on hand-built note lists; part 2 is realize() on real hymns.
   Default model 'limbSeconds' (after the independent review of the first version): the hands as written, plus seconds between the two hands' notes (B3 under C4,
   C#4 under D#4); the pitch grouping's octave-plus rule is the opt-in models 'pitch' and 'both' (the first version's default, whose numbers the tests below keep). */
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

/* ================================================================ part 1: the pure pass */
let nid = 0;
/* n(hand, midi, opts): a one-beat note at time 0 unless given; `chain` defaults to its own id */
function n(hand, midi, o) {
  o = o || {};
  const id = o.id || ('n' + (nid++));
  return { id: id, hand: hand, on: o.on == null ? 0 : o.on, off: o.off == null ? 1 : o.off, midi: midi, cont: !!o.cont, chain: o.chain || id, keep: !!o.keep, low: !!o.low };
}
const ids = r => r.removedIds.slice().sort();

test('a second between two inner notes: one goes, the one farther from the protected melody; nothing else moves', () => {
  const mel = n('RH', 84, { keep: true }), a = n('RH', 72), b = n('RH', 73);
  const r = HC.thin([mel, a, b], { model: 'limb' });
  assert.deepEqual(ids(r), [a.id], 'C5/C#5: the one farther from the melody (72) goes');
  assert.equal(r.stats.violationsBefore, 1); assert.equal(r.stats.violationsAfter, 0); assert.equal(r.stats.unfixable, 0);
});

test('an octave or more in one hand: the inner note that makes it goes, never the melody (top) or the bass (bottom)', () => {
  const bass = n('LH', 40, { keep: true }), inner = n('LH', 55), tenor = n('LH', 55 + 12 - 1 /* 66 */);
  const r = HC.thin([bass, inner, tenor], { model: 'limb' });
  /* span 26: the top unprotected note (tenor) is involved and removable; after it goes, bass-inner span is 15, so the inner goes as well */
  assert.deepEqual(ids(r), [inner.id, tenor.id].sort());
  assert.equal(r.stats.violationsAfter, 0);
  const mel = n('RH', 79, { keep: true }), low = n('RH', 62);
  assert.deepEqual(ids(HC.thin([mel, low], { model: 'limb' })), [low.id], 'melody 79 over 62: the lower note goes (an octave and a fifth)');
});

test('an exact octave is a violation (12), eleven semitones is not; a unison is not a second', () => {
  assert.equal(HC.thin([n('RH', 60), n('RH', 72)], { model: 'limb' }).removedIds.length, 1);
  assert.equal(HC.thin([n('RH', 60), n('RH', 71)], { model: 'limb' }).removedIds.length, 0);
  assert.equal(HC.thin([n('RH', 64), n('RH', 64)], { model: 'limb' }).removedIds.length, 0, 'the same pitch twice: no second');
  assert.equal(HC.thin([n('RH', 64), n('RH', 66)], { model: 'limb' }).removedIds.length, 1, 'a whole tone is a second');
  assert.equal(HC.thin([n('RH', 64), n('RH', 67)], { model: 'limb' }).removedIds.length, 0, 'a minor third is not');
});

test('the melody note and the bass are never removed, whatever else is stacked', () => {
  /* left hand: bass C3 (kept), D3 (a second above it, inner), melody-hand: nothing; violation = second C3-D3: the inner D3 goes, the bass stays */
  const bass = n('LH', 48, { keep: true }), inner = n('LH', 50);
  assert.deepEqual(ids(HC.thin([bass, inner], { model: 'limb' })), [inner.id]);
  /* two protected notes forming a second or an octave: nothing can go */
  const r = HC.thin([n('RH', 72, { keep: true }), n('RH', 73, { keep: true })], { model: 'limb' });
  assert.equal(r.removedIds.length, 0); assert.equal(r.stats.unfixable, 1); assert.equal(r.stats.unfixableSeconds, 1);
  /* bass 40 (kept), a kept note at 52 and an unprotected 55: span 15 -> the unprotected top goes; then bass and 52 are exactly an octave, both protected: left */
  const mid = n('LH', 55), r2 = HC.thin([n('LH', 40, { keep: true }), mid, n('LH', 52, { keep: true })], { model: 'limb' });
  assert.deepEqual(ids(r2), [mid.id], 'only the unprotected note is ever a candidate');
  assert.equal(r2.stats.unfixable, 1, 'the protected octave that is left is counted');
});

test('a melody note and its own octave double: the doubling goes (the melody event keeps its top head)', () => {
  const t2 = n('RH', 76, { keep: true }), d2 = n('RH', 64, { low: true });
  assert.deepEqual(ids(HC.thin([t2, d2], { model: 'limb' })), [d2.id], 'E5 with its double E4: the double goes, E5 stays');
  /* class order: where removing either clears the violation, an inner voice goes before a harmony note inside the melody's own event */
  const top = n('RH', 80, { keep: true }), inner = n('RH', 70), harmony = n('RH', 71, { low: true });
  const r = HC.thin([top, inner, harmony], { model: 'limb' });
  assert.deepEqual(ids(r), [inner.id], 'the inner voice goes, the melody-event harmony note stays');
  /* when only melody-event heads are involved, the lower head goes */
  const r2 = HC.thin([n('RH', 80, { keep: true }), n('RH', 79, { low: true, id: 'low79' })], { model: 'limb' });
  assert.deepEqual(ids(r2), ['low79']);
});

test('a violation only protected notes make is left and counted (unfixable), and nothing is removed for it', () => {
  /* a bass at E4 under a melody at E5, pitch grouping: both protected */
  const bass = n('LH', 64, { keep: true }), mel = n('RH', 76, { keep: true }), mid = n('RH', 69);
  const r = HC.thin([bass, mel, mid], { model: 'pitch' });
  assert.equal(r.removedIds.length, 0, 'the middle note is not involved (neither the extreme nor in a second): removing it would not help');
  assert.equal(r.stats.unfixable, 1); assert.equal(r.stats.unfixableOctave, 1);
});

test('ties: a removed note goes with its whole chain, a kept tied note keeps its continuation, and nothing is shortened', () => {
  const mel = n('RH', 84, { keep: true, on: 0, off: 4 });
  const a1 = n('RH', 72, { id: 'a1', chain: 'A', on: 0, off: 1 }), a2 = n('RH', 72, { id: 'a2', chain: 'A', on: 1, off: 2, cont: true });
  const k1 = n('RH', 76, { id: 'k1', chain: 'K', on: 0, off: 1 }), k2 = n('RH', 76, { id: 'k2', chain: 'K', on: 1, off: 2, cont: true });
  /* at 0: 84 over 72 is an octave-plus (12); removing a1 (chain A) clears it; a2 (the continuation) must go too; k1/k2 stay (76 is 8 under 84) */
  const r = HC.thin([mel, a1, a2, k1, k2], { model: 'limb' });
  assert.deepEqual(ids(r), ['a1', 'a2']);
  assert.equal(r.removedChains, 1);
});

test('only chords with an attack count: a held pair that clashes is not a chord until something attacks with it', () => {
  /* two held notes a second apart, sounding from 0 to 2; a third note attacks at 1 (well away): the pair is a second at onset 1 (held notes included) */
  const h1 = n('RH', 60, { on: 0, off: 2 }), h2 = n('RH', 61, { on: 0, off: 2 }), late = n('RH', 72, { on: 1, off: 2, keep: true });
  const r = HC.thin([h1, h2, late], { model: 'limb' });
  assert.ok(r.removedIds.length >= 1, 'at onset 0 the pair attacks together: a second');
  assert.equal(r.stats.violationsAfter, 0);
});

test('the models: a left-hand tenor C#4 under a right-hand alto D#4 is a second for the default and for pitch/both, not for limb', () => {
  const build = () => [n('LH', 61, { id: 'tenor' }), n('RH', 63, { id: 'alto' }), n('RH', 70, { id: 'mel', keep: true })];
  assert.equal(HC.thin(build(), { model: 'limb' }).removedIds.length, 0, 'the hands as written: no violation');
  assert.deepEqual(ids(HC.thin(build(), { model: 'limbSeconds' })), ['tenor'], 'the default: the one farther from the melody goes');
  assert.deepEqual(ids(HC.thin(build())), ['tenor'], 'and it is the default');
  assert.deepEqual(ids(HC.thin(build(), { model: 'pitch' })), ['tenor']);
  assert.deepEqual(ids(HC.thin(build(), { model: 'both' })), ['tenor']);
  assert.equal(HC.DEFAULT_MODEL, 'limbSeconds');
  assert.throws(() => HC.thin([], { model: 'nope' }), /unknown model/);
});

test('the boundary: B3 under C4 is a second across the split at 60 for the default, which the pitch grouping cannot see', () => {
  const build = () => [n('LH', 59, { id: 'tenor' }), n('RH', 60, { id: 'alto' }), n('RH', 67, { id: 'mel', keep: true })];
  assert.deepEqual(ids(HC.thin(build())), ['tenor'], 'default: the one farther from the melody goes');
  assert.equal(HC.thin(build(), { model: 'pitch' }).removedIds.length, 0, 'pitch grouping: B3 and C4 are on different sides of 60, not adjacent');
  assert.equal(HC.thin(build(), { model: 'limb' }).removedIds.length, 0);
});

test('octave-plus across the two hands is NOT removed by the default, only by the opt-in models', () => {
  const build = () => [n('LH', 60, { id: 'tenor' }), n('RH', 69, { id: 'alto' }), n('RH', 72, { id: 'mel', keep: true })]; /* C4 A4 C5 */
  assert.equal(HC.thin(build()).removedIds.length, 0, 'default: each hand holds a third at most');
  assert.equal(HC.thin(build(), { model: 'limb' }).removedIds.length, 0);
  assert.deepEqual(ids(HC.thin(build(), { model: 'pitch' })), ['tenor']);
  assert.deepEqual(ids(HC.thin(build(), { model: 'both' })), ['tenor']);
});

test('a cross-hand second needs an attack and two notes; a same-hand octave still counts in the default (limb)', () => {
  const held = [n('LH', 61, { on: 0, off: 2, cont: true }), n('RH', 63, { on: 0, off: 2, cont: true })];
  assert.equal(HC.thin(held).removedIds.length, 0, 'no attack: not a chord');
  const oct = [n('RH', 60), n('RH', 72)];
  assert.equal(HC.thin(oct).removedIds.length, 1, 'limb octave-plus is in the default');
});

test('deterministic and idempotent: same input, same removals; the survivors need no further removal', () => {
  const mk = () => [n('LH', 40, { id: 'b', keep: true }), n('LH', 52, { id: 'x' }), n('LH', 53, { id: 'y' }), n('RH', 64, { id: 'p' }), n('RH', 65, { id: 'q' }), n('RH', 79, { id: 'm', keep: true }), n('RH', 67, { id: 'r', low: true })];
  const r1 = HC.thin(mk(), { model: 'both' }), r2 = HC.thin(mk(), { model: 'both' });
  assert.deepEqual(r1.removedIds, r2.removedIds);
  const left = mk().filter(x => !r1.removedIds.includes(x.id));
  const again = HC.thin(left, { model: 'both' });
  assert.equal(again.removedIds.length, 0, 'idempotent');
  assert.equal(again.stats.unfixable, r1.stats.unfixable, 'the same chords are left');
  assert.equal(r1.stats.violationsAfter, r1.stats.unfixable);
});

test('what stays is untouched: the pass returns ids only, never a changed pitch, onset or length', () => {
  const src = [n('LH', 40, { keep: true }), n('LH', 52), n('RH', 79, { keep: true }), n('RH', 64)];
  const copy = JSON.stringify(src);
  HC.thin(src, { model: 'both' });
  assert.equal(JSON.stringify(src), copy, 'the input notes are not modified');
});

/* ================================================================ part 2: realize() */
async function planOf(file, targetLevel, handProfile) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: targetLevel, handProfile: handProfile || 'large', sections: 'all' });
  assert.ok(p.ok, file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan };
}
const fp = r => { assert.ok(r.ok, r.reason); return SER.fingerprint(r.graph); };
const CASES = [['catalog/hymns/nearer-my-god.musicxml', 2.4], ['catalog/hymns/christ-arose.musicxml', 2.76], ['catalog/hymns/all-creatures.musicxml', 3.88], ['catalog/method/beyer/061.mxl', 2.24], ['catalog/method/czerny599/013.mxl', 2.11], ['catalog/method/burgmuller25/016.mxl', 3.9]];
const PATTERNS = ['auto', 'block', 'broken', 'ballad', 'hymn'];

test('options off = origin/main byte for byte: a direct realize() call (default, and handChords:false), and the candidate-like options without the pass', async () => {
  for (const [file, lvl] of CASES) {
    const f = await planOf(file, lvl);
    for (const pattern of PATTERNS) {
      const name = file.split('/').pop() + '@' + lvl + ':' + pattern;
      assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true })), GOLDEN.default[name], name + ': default');
      assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true, handChords: false })), GOLDEN.default[name], name + ': handChords false');
      assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true, diatonicLow: true, hymnThin: true })), GOLDEN.candidateLike[name], name + ': what candidates/ wrote before');
    }
  }
});

test('a direct realize() call has no hand-chords report (the pass is off); candidates/ turns it on, and opts.last can turn it off', async () => {
  const f = await planOf('catalog/hymns/pass-me-not.musicxml', 3.87);
  const direct = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' });
  assert.equal(direct.report.handChords, undefined);
  const req = { targetLevel: 3.87, handProfile: 'large', sections: 'all' };
  const on = CAND.enumerate(f.g, f.sg, req, { n: 6 });
  assert.ok(on.candidates.length > 0);
  on.candidates.forEach(c => { assert.ok(c.report.handChords, 'every candidate carries the report'); assert.equal(c.report.handChords.active, c.plan.stage <= 3); assert.equal(c.report.handChords.model, 'limbSeconds', 'the default model'); });
  const off = CAND.enumerate(f.g, f.sg, req, { n: 6, last: { handChords: false } });
  off.candidates.forEach(c => assert.equal(c.report.handChords, undefined));
  assert.notDeepEqual(on.candidates.map(c => c.fingerprint), off.candidates.map(c => c.fingerprint), 'the pass changes at least one candidate of this piece');
});

/* the notes of a graph as a comparable list */
const noteKeys = g => VC.notesOf(g).map(x => [x.on, x.off, x.midi, x.hand, x.cont].join('|')).sort();

test('christ-arose, opt-in model both (hymn, stage 3): violations removed, only notes removed, nothing shortened, melody top and bass intact, deterministic', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  assert.ok(f.plan.stage <= 3);
  const before = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true });
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true, handChordsModel: 'both' });
  const b = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true, handChordsModel: 'both' });
  assert.equal(fp(a), fp(b), 'deterministic');
  const hc = a.report.handChords;
  assert.equal(hc.active, true);
  assert.ok(hc.removedNotes > 0, 'it removed something on this piece');
  const vb = VC.verticalClash(before.graph), va = VC.verticalClash(a.graph);
  assert.ok(vb.violations + vb.pitchViolations > 0, 'fixture: the piece has violating chords before');
  assert.equal(hc.violationsBefore, vb.violations + vb.pitchViolations, 'the pass counts the chords the critic counts, before');
  assert.equal(hc.violationsAfter, va.violations + va.pitchViolations, 'and after');
  assert.ok(va.violations + va.pitchViolations < vb.violations + vb.pitchViolations);
  assert.equal(hc.unfixable, hc.violationsAfter);
  /* only removal: every note kept is a note the graph had, same pitch, onset, end, hand and tie role */
  const kb = noteKeys(before.graph), ka = noteKeys(a.graph);
  const pool = new Map(); kb.forEach(k => pool.set(k, (pool.get(k) || 0) + 1));
  ka.forEach(k => { const c = pool.get(k) || 0; assert.ok(c > 0, 'a note that was not there: ' + k); pool.set(k, c - 1); });
  assert.equal(kb.length - ka.length, hc.removedNotes, 'exactly the removed notes are missing');
  /* the melody top note at every onset is still there */
  const mel = M.originalMelodyNotes(f.g, f.plan);
  const topAt = new Map(); mel.forEach(m => { const k = m.onsetQ.toFixed(3); if (!topAt.has(k) || m.midi > topAt.get(k)) topAt.set(k, m.midi); });
  const have = M.graphNoteList(a.graph);
  topAt.forEach((midi, k) => assert.ok(have.some(x => x.midi === midi && Math.abs(x.onsetQ - Number(k)) <= 0.15), 'melody top ' + midi + ' at ' + k + ' is kept'));
  /* the lowest left-hand note at every left-hand onset is still the bass the copy had */
  const low = g => { const m = new Map(); VC.notesOf(g).forEach(x => { if (x.hand !== 'LH' || x.cont) return; const k = x.on.toFixed(3); m.set(k, Math.min(m.has(k) ? m.get(k) : 999, x.midi)); }); return m; };
  const lb = low(before.graph), la = low(a.graph);
  lb.forEach((midi, k) => assert.equal(la.get(k), midi, 'the bass at ' + k + ' is kept'));
});

test('pass-me-not, the DEFAULT model (hymn, stage 3): the four cross-hand seconds go (C#4 tenor under D#4 alto), nothing else; only removal; melody and bass kept', async () => {
  const f = await planOf('catalog/hymns/pass-me-not.musicxml', 3.87);
  const before = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true });
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true });
  const hc = a.report.handChords;
  assert.equal(hc.model, 'limbSeconds');
  const vb = VC.verticalClash(before.graph), va = VC.verticalClash(a.graph);
  assert.ok(vb.crossSeconds >= 4, 'fixture: the copy has cross-hand seconds (' + vb.crossSeconds + ')');
  assert.equal(va.crossSeconds, 0); assert.equal(va.pitchSeconds, 0);
  assert.equal(hc.violationsBefore, vb.violations + vb.crossSeconds, 'the pass counts what the critic counts');
  assert.equal(hc.violationsAfter, va.violations + va.crossSeconds);
  assert.equal(hc.removedNotes, hc.removedChains);
  assert.ok(hc.removedNotes <= 6, 'a handful of notes, not a thinned hymn (' + hc.removedNotes + ')');
  const kb = noteKeys(before.graph), ka = noteKeys(a.graph);
  const pool = new Map(); kb.forEach(k => pool.set(k, (pool.get(k) || 0) + 1));
  ka.forEach(k => { const c = pool.get(k) || 0; assert.ok(c > 0, 'a note that was not there: ' + k); pool.set(k, c - 1); });
  assert.equal(kb.length - ka.length, hc.removedNotes);
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(a.graph)), 1);
});

test('the pass also runs on a generated (block) realization and on an auto one; violations fall, nothing is added', async () => {
  for (const [file, lvl, pattern] of [['catalog/hymns/god-rest-ye-merry.musicxml', 2.87, 'block'], ['catalog/hymns/pass-me-not.musicxml', 3.87, 'auto']]) {
    const f = await planOf(file, lvl);
    const off = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true, hymnThin: true, diatonicLow: true });
    const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true, hymnThin: true, diatonicLow: true, handChords: true });
    const vo = VC.verticalClash(off.graph), vn = VC.verticalClash(on.graph);
    assert.ok(vn.violations + vn.pitchViolations <= vo.violations + vo.pitchViolations, file);
    assert.ok(noteKeys(on.graph).length <= noteKeys(off.graph).length, file + ': no note added');
  }
});

test('stage gate: at stage 4 the pass does not run and the graph is the same as with it off', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const p4 = Object.assign({}, f.plan, { stage: 4 });
  const on = REALIZE.realize(f.g, f.sg, p4, { pattern: 'hymn', handChords: true });
  const off = REALIZE.realize(f.g, f.sg, p4, { pattern: 'hymn' });
  assert.equal(fp(on), fp(off));
  assert.equal(on.report.handChords.active, false);
  assert.equal(HC.HAND_CHORDS_MAX_STAGE, 3);
});

test('the four models on christ-arose: limb and the default need none (no cross-hand second there), pitch and both remove the same octave-plus notes', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const run = model => REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: 'hymn', hymnThin: true, handChords: true }, model ? { handChordsModel: model } : {}));
  const l = run('limb'), d = run(), p = run('pitch'), b = run('both');
  assert.equal(l.report.handChords.removedNotes, 0, 'hymnThin already cleared the hands as written on this piece');
  assert.equal(d.report.handChords.removedNotes, 0, 'no cross-hand second on this piece');
  assert.equal(fp(d), fp(run('limbSeconds')), 'the default is limbSeconds');
  assert.ok(p.report.handChords.removedNotes > 0);
  assert.equal(fp(p), fp(b));
});

test('melody preservation is 1 when no melody-voice event has a second head; removed notes are inner voices (christ-arose)', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true, handChords: true });
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(a.graph)), 1);
});
