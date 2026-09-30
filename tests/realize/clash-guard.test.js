/* G9 clash guard, seconds and one-hand spans (docs/GOALS/G09 section 12 "G9 clash guard, seconds and one-hand spans (post user review 3)").

   The user's third look at G9 output ("notes stuck together, a second", "an octave or more at once in one hand is very hard", "the harmony got weirder"),
   measured: a generated left-hand tone a semitone off the melody note sounding with it, a generated maj7 stack that holds its own major seventh, generated
   stacks voiced up to 13 semitones, and a verbatim `hymn` copy that stacks tenor and bass a tenth apart. Three switches (opts.melodyClash, opts.handGuard,
   opts.hymnThin), each with its stage gate; `false` restores the previous behaviour exactly (the fingerprints below are origin/main d5f715f's). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const PAT = require(path.join(REPO, 'realize/patterns.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));
const PLA = require(path.join(REPO, 'playability/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const P = require(path.join(REPO, 'scoregraph/pitch.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const VC = require(path.join(REPO, 'critics/vertical-clash.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

const OFF = { melodyClash: false, handGuard: false, hymnThin: false };
async function planOf(file, targetLevel, handProfile) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: targetLevel, handProfile: handProfile || 'large', sections: 'all' });
  assert.ok(p.ok, file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan, source: M.graphNoteList(g) };
}
const fp = r => { assert.ok(r.ok); return SER.fingerprint(r.graph); };
/* the harsh vertical pairs of `graph` that involve a note the source does not have AND that the source does not sound (both pitch classes together at that instant): the ones the guard must have removed */
function unexcusedClashes(graph, g) {
  const srcNotes = VC.notesOf(g);
  const srcKeys = new Set(srcNotes.map(n => n.midi + '@' + n.on.toFixed(4)));
  let n = 0;
  VC.slices(VC.notesOf(graph)).forEach(s => {
    const att = new Set(s.attack);
    const srcPcs = new Set(); srcNotes.forEach(x => { if (x.on <= s.t + 1e-6 && x.off > s.t + 1e-6) srcPcs.add(((x.midi % 12) + 12) % 12); });
    for (let i = 0; i < s.sounding.length; i++) for (let j = i + 1; j < s.sounding.length; j++) {
      const a = s.sounding[i], b = s.sounding[j];
      if (!(att.has(a) || att.has(b)) || !VC.isHarshInterval(a.midi, b.midi)) continue;
      if (srcKeys.has(a.midi + '@' + a.on.toFixed(4)) && srcKeys.has(b.midi + '@' + b.on.toFixed(4))) continue; /* both notes are the source's own */
      if (srcPcs.has(((a.midi % 12) + 12) % 12) && srcPcs.has(((b.midi % 12) + 12) % 12)) continue; /* the source sounds the pair */
      n++;
    }
  });
  return n;
}
const melodyOk = (f, r) => M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(r.graph)) === 1;

/* ================================================================ pure pieces (theory.js) */
test('harsh pairs: pitch-class interval 1 or 11 at any octave (minor second, major seventh, minor ninth); nothing else', () => {
  assert.ok(TH.isHarshPair(60, 61) && TH.isHarshPair(61, 60), 'minor second, both orders');
  assert.ok(TH.isHarshPair(48, 59), 'major seventh');
  assert.ok(TH.isHarshPair(55, 68), 'minor ninth (13 semitones)');
  assert.ok(TH.isHarshPair(36, 71), 'a major seventh plus two octaves');
  [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 24].forEach(d => assert.ok(!TH.isHarshPair(60, 60 + d), d + ' semitones is not harsh'));
  assert.deepEqual(TH.HARSH_PC_INTERVALS.slice(), [1, 11]);
});

test('the stage gates: seconds anywhere, the span cap and the stack clash up to stage 3; stage 4 keeps the old rules', () => {
  [1, 2, 3].forEach(st => assert.deepEqual(TH.handGuardFor(st), { secondBelow: TH.ANY_SECOND, spanCap: TH.ONE_HAND_SPAN_CAP, stackClash: true }, 'stage ' + st));
  assert.deepEqual(TH.handGuardFor(4), { secondBelow: null, spanCap: null, stackClash: false });
  assert.equal(TH.ONE_HAND_SPAN_CAP, 10, 'under an octave');
  assert.equal(TH.NO_SECONDS_MAX_STAGE, 3); assert.equal(TH.SPAN_CAP_MAX_STAGE, 3); assert.equal(TH.STACK_CLASH_MAX_STAGE, 3); assert.equal(TH.HYMN_THIN_MAX_STAGE, 3);
  assert.equal(TH.MELODY_CLASH_MAX_STAGE, 4, 'the melody clash guard covers every stage');
});

test('unclashStack: a maj7 stack gives its seventh up for the fifth; a clean chord is returned as the same array; idempotent and deterministic', () => {
  const c = [48, 52, 59]; /* C3 E3 B3: root, third, major seventh */
  assert.deepEqual(TH.unclashStack(c, 0), [48, 52, 55], 'C E B -> C E G');
  assert.deepEqual(TH.unclashStack(TH.unclashStack(c, 0), 0), [48, 52, 55], 'idempotent');
  assert.deepEqual(TH.unclashStack(c, 0), TH.unclashStack(c.slice(), 0), 'deterministic');
  const g7 = [43, 47, 54]; /* G2 B2 F#3: a G major seventh, the seventh a semitone under the root's octave */
  assert.deepEqual(TH.unclashStack(g7, 7), [43, 47, 50], 'G B F# -> G B D');
  const triad = [48, 52, 55];
  assert.equal(TH.unclashStack(triad, 0), triad, 'no harsh pair: the same array');
  const dom7 = [43, 47, 53]; /* G B F: a dominant seventh without its fifth has no harsh pair */
  assert.equal(TH.unclashStack(dom7, 7), dom7);
});

test('guardTones: clashing tones go; a lone clashing tone is replaced by another tone of its chord; every tone clashing leaves the event (unresolved)', () => {
  const clashes = m => TH.isHarshPair(m, 66); /* melody F#4 */
  const two = TH.guardTones([43, 50], clashes, [7, 11, 2], 40); /* G2 (clashes, 66-43 = 23) and D3 */
  assert.deepEqual(two.midis, [50]); assert.equal(two.dropped, 1); assert.equal(two.replaced, 0);
  const lone = TH.guardTones([55], clashes, [7, 11, 2], 40); /* G3 against F#4 */
  assert.equal(lone.replaced, 1); assert.equal(lone.midis.length, 1);
  assert.ok(!clashes(lone.midis[0]) && [7, 11, 2].indexOf(lone.midis[0] % 12) >= 0, 'another tone of the same chord, clashing with nothing');
  assert.ok(Math.abs(lone.midis[0] - 55) <= 7, 'the nearest one');
  const stuck = TH.guardTones([55], clashes, [7], 40);
  assert.equal(stuck.unresolved, 1); assert.deepEqual(stuck.midis, [55], 'left as it was');
  const clean = [50, 57];
  assert.equal(TH.guardTones(clean, clashes, [2, 9], 40).midis, clean, 'nothing clashes: the same array');
  const again = TH.guardTones(lone.midis, clashes, [7, 11, 2], 40);
  assert.equal(again.midis, lone.midis, 'idempotent: the guarded event has no clash left');
  const low = TH.guardTones([42], m => TH.isHarshPair(m, 55), [6, 9, 1], 40); /* F#2 against G3; floor 40 */
  assert.ok(low.midis[0] >= 40, 'a replacement is never under the register floor');
});

test('guardEvent: the melody clash is left alone where the SOURCE itself sounds the pair, and only where the melody note sounds', () => {
  const melody = [{ w0: 0, w1: 0.25, midi: 66 }]; /* F#4 for the first quarter */
  const noSource = () => false, sourceSoundsG = pc => pc === 7;
  /* G3 over [0, 0.25): a major seventh under the melody note F#4 */
  const without = TH.guardEvent([55], 0, 0.25, melody, noSource, [7, 11, 2], 40);
  assert.equal(without.replaced, 1, 'no source clash: replaced');
  const withSrc = TH.guardEvent([55], 0, 0.25, melody, sourceSoundsG, [7, 11, 2], 40);
  assert.deepEqual(withSrc.midis, [55]); assert.equal(withSrc.replaced + withSrc.dropped + withSrc.unresolved, 0, 'the source sounds G with F#: left as it is');
  const after = TH.guardEvent([55], 0.25, 0.5, melody, noSource, [7, 11, 2], 40);
  assert.deepEqual(after.midis, [55], 'the melody note has ended: no clash');
  const half = TH.guardEvent([55], 0.125, 0.375, melody, (pc, a, b) => { assert.ok(a >= 0.125 && b <= 0.25 + 1e-9, 'the source question is asked over the overlap only'); return false; }, [7, 11, 2], 40);
  assert.equal(half.replaced, 1);
  /* a minor ninth counts too: G3 against Ab4 */
  assert.equal(TH.guardEvent([55], 0, 0.25, [{ w0: 0, w1: 0.25, midi: 68 }], noSource, [7, 11, 2], 40).replaced, 1);
});

/* ================================================================ shaped stacks (patterns.js shapeChord) */
const QUALITIES = ['maj', 'min', 'dim', 'aug', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7'];
const win = (root, quality, i) => ({ w0: R.make(i, 4), w1: R.make(i + 1, 4), root: root, quality: quality });
function blockSweep(stage, maxSpan) {
  const windows = []; let i = 0;
  for (let root = 0; root < 12; root++) QUALITIES.forEach(q => windows.push(win(root, q, i++)));
  const hg = TH.handGuardFor(stage);
  const shape = { maxStack: TH.maxStackForStage(stage), top: TH.LH_CHORD_TOP, floor: TH.REGISTER_FLOOR, state: { prev: null }, secondBelow: hg.secondBelow, spanCap: hg.spanCap, stackClash: hg.stackClash };
  return PAT.run('block', windows, null, { anchor: 48, count: stage <= 1 ? 1 : 3, maxSpan: maxSpan, floor: TH.REGISTER_FLOOR, shape: shape }).events.map(e => e.midis.slice().sort((a, b) => a - b));
}
const hasSecond = s => s.some((m, k) => k && s[k] - s[k - 1] <= 2 && s[k] - s[k - 1] > 0);
const hasHarsh = s => s.some((m, a) => s.some((n, b) => b > a && TH.isHarshPair(m, n)));

test('a generated stack at stage 2 and 3: span under an octave, no second anywhere, no harsh pair, top at or under middle C, floor held (every root x quality, profile large)', () => {
  [2, 3].forEach(stage => {
    const chords = blockSweep(stage, 14);
    assert.equal(chords.length, 12 * QUALITIES.length);
    chords.forEach((s, k) => {
      assert.ok(s[s.length - 1] - s[0] <= TH.ONE_HAND_SPAN_CAP, 'stage ' + stage + ' chord ' + k + ' span ' + (s[s.length - 1] - s[0]) + ' [' + s.join(',') + ']');
      assert.ok(!hasSecond(s), 'stage ' + stage + ' chord ' + k + ' has a second [' + s.join(',') + ']');
      assert.ok(!hasHarsh(s), 'stage ' + stage + ' chord ' + k + ' has a harsh pair [' + s.join(',') + ']');
      assert.ok(s[s.length - 1] <= TH.LH_CHORD_TOP && s[0] >= TH.REGISTER_FLOOR, 'register ' + s.join(','));
    });
    assert.equal(chords.filter(s => s.length === 3).length, chords.length, 'a triad for every root and quality: a seventh chord that cannot be placed gives its seventh up for the fifth, not the third');
  });
});

test('stage 4 keeps the old rules: the stack is exactly what the old shape gave (the guard fields are absent), and the span is the hand\'s', () => {
  const windows = []; let i = 0;
  for (let root = 0; root < 12; root++) QUALITIES.forEach(q => windows.push(win(root, q, i++)));
  const old = { maxStack: 3, top: TH.LH_CHORD_TOP, floor: TH.REGISTER_FLOOR, state: { prev: null } };
  const a = PAT.run('block', windows, null, { anchor: 48, count: 3, maxSpan: 14, floor: TH.REGISTER_FLOOR, shape: old }).events.map(e => e.midis.join());
  assert.deepEqual(blockSweep(4, 14).map(s => s.join()), a);
  assert.ok(blockSweep(4, 14).some(s => s[s.length - 1] - s[0] > TH.ONE_HAND_SPAN_CAP), 'the old voicing still has chords wider than ten semitones at stage 4 (fixture assumption)');
});

test('the span cap is the smaller of the cap and the hand profile (profile small = 10 is unchanged; 12 and 14 are cut to 10 at stages 1-3)', () => {
  [10, 12, 14].forEach(span => blockSweep(2, span).forEach(s => assert.ok(s[s.length - 1] - s[0] <= Math.min(span, 10))));
});

/* ================================================================ realize(): the melody clash guard */
test('melody clash guard on a real piece (all-creatures, the worst in the review): generated tones against the melody fall from 13 to 1, and only where the source sounds the pair', async () => {
  const f = await planOf('catalog/hymns/all-creatures.musicxml', 3.88);
  ['broken', 'block'].forEach(pattern => {
    const off = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true, melodyClash: false });
    const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true });
    const vOff = VC.verticalClash(off.graph, { sourceNotes: f.source }), vOn = VC.verticalClash(on.graph, { sourceNotes: f.source });
    assert.equal(vOff.harshArranged, 13, pattern + ': fixture assumption');
    assert.equal(vOn.harshArranged, 1, pattern + ': one left');
    assert.equal(unexcusedClashes(on.graph, f.g), 0, pattern + ': and the source sounds that pair');
    assert.ok(unexcusedClashes(off.graph, f.g) >= 10, pattern + ': the guard off leaves the clashes the source does not have');
    assert.ok(on.report.clash.eventsWithClash >= 10 && on.report.clash.unresolved === 0, pattern + ': the report counts the events it changed');
    assert.ok(melodyOk(f, on) && melodyOk(f, off), pattern + ': melody untouched');
    assert.equal(PLA.analyzeGraph(on.graph, { profile: 'large' }).totals.hard, 0, pattern + ': no hard violation');
  });
});

test('melody clash guard: with a source clash the generated tone stays (a piece whose source holds the same pair keeps it); the guard never touches the right hand', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true });
  const off = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, melodyClash: false });
  const v = VC.verticalClash(on.graph, { sourceNotes: f.source });
  assert.ok(VC.verticalClash(off.graph, { sourceNotes: f.source }).harshArranged >= 2, 'fixture assumption (melodyClash off, handGuard on)');
  assert.ok(unexcusedClashes(off.graph, f.g) >= 1, 'with the guard off a clash the source does not have is written');
  assert.equal(v.harshArranged, 1, 'one generated pair is left');
  assert.equal(unexcusedClashes(on.graph, f.g), 0, 'and it is one the source sounds too (both pitch classes together at that instant): the guard leaves a source clash alone');
  const rhOf = graph => graph.parts[0].events.filter(e => e.kind === 'note').map(e => e.at + '|' + e.m + '|' + e.heads.filter(h => P.limbOf(graph.parts[0], e, h) === 'RH').map(h => P.midi(h.pitch)).join()).filter(x => !x.endsWith('|'));
  assert.deepEqual(rhOf(on.graph), rhOf(off.graph), 'right hand identical with and without the guard');
});

/* ================================================================ realize(): seconds and the span cap */
test('stage 2-3 generated chords on real pieces: no one-hand octave chord and no one-hand second in the generated hand (block), stage 4 not gated', async () => {
  for (const [file, lvl] of [['catalog/hymns/christ-arose.musicxml', 2.76], ['catalog/hymns/all-glory-laud.musicxml', 2.76], ['catalog/hymns/god-rest-ye-merry.musicxml', 2.87], ['catalog/hymns/nearer-my-god.musicxml', 2.4]]) {
    const f = await planOf(file, lvl);
    const off = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: 'block', noStride: true }, OFF));
    const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true });
    assert.equal(f.plan.stage, 2, file);
    const vOff = VC.verticalClash(off.graph), vOn = VC.verticalClash(on.graph);
    assert.ok(vOff.octaveChordsLH >= 1, file + ': fixture assumption, the old voicing has an octave chord');
    assert.equal(vOn.octaveChordsLH, 0, file + ': none now');
    assert.equal(vOn.secondsLH, 0, file + ': no second');
    assert.ok(melodyOk(f, on), file + ': melody');
  }
  /* stage 4: not gated, the old voicing keeps chords of 10 semitones and more */
  const hi = await planOf('catalog/hymns/christ-arose.musicxml', 4.4);
  if (hi.plan.stage === 4) {
    const on = REALIZE.realize(hi.g, hi.sg, hi.plan, { pattern: 'block', noStride: true });
    const off = REALIZE.realize(hi.g, hi.sg, hi.plan, Object.assign({ pattern: 'block', noStride: true }, { handGuard: false }));
    const gate = on.report.clash;
    assert.equal(gate.hymnThinActive, false);
    assert.ok(VC.verticalClash(on.graph).octaveChordsLH >= VC.verticalClash(off.graph).octaveChordsLH - 0, 'stage 4: the span cap does not apply');
  }
});

/* ================================================================ realize(): hymn thinning */
test('hymn thinning (stage 2): the tenor goes where it stacks an octave on the bass; melody and bass notes are never touched; harmony tones are not invented', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const verbatim = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' });
  const thin = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true });
  assert.ok(verbatim.ok && thin.ok);
  assert.equal(VC.verticalClash(verbatim.graph).octaveChordsLH, 27, 'fixture assumption: a verbatim copy has 27 one-hand octave chords');
  const v = VC.verticalClash(thin.graph);
  assert.equal(v.octaveChords, 0); assert.equal(v.seconds, 0);
  assert.equal(thin.report.clash.hymnNotesDropped, 27);
  const notesOf = g => VC.notesOf(g);
  const a = notesOf(verbatim.graph), b = notesOf(thin.graph);
  assert.equal(a.length - b.length, 27, 'exactly the dropped notes are gone');
  const key = n => n.hand + '|' + n.on.toFixed(4) + '|' + n.midi;
  const keep = new Set(b.map(key));
  const gone = a.filter(n => !keep.has(key(n)));
  assert.equal(gone.length, 27);
  /* never the melody (every source melody note is still there: melody preservation 1) and never the bass (the lowest LH note at each onset is unchanged) */
  assert.ok(melodyOk(f, thin), 'melody preservation 1');
  const lowestLH = notes => { const m = new Map(); notes.filter(n => n.hand === 'LH' && !n.cont).forEach(n => { const k = n.on.toFixed(4); if (!m.has(k) || n.midi < m.get(k)) m.set(k, n.midi); }); return m; };
  const la = lowestLH(a), lb = lowestLH(b);
  la.forEach((midi, k) => assert.equal(lb.get(k), midi, 'the bass at ' + k + ' is untouched'));
  b.forEach(n => assert.ok(keep.has(key(n)) && a.some(x => key(x) === key(n)), 'no note is added or moved'));
  assert.equal(PLA.analyzeGraph(thin.graph, { profile: 'large' }).totals.hard, 0);
});

test('hymn thinning keeps the LOWEST SOUNDING left-hand pitch at every onset (a check on the bass voice protection; a separate lowest-sounding-note protection was tried and not adopted, see the doc)', async () => {
  for (const [file, lvl] of [['catalog/hymns/all-creatures.musicxml', 3.88], ['catalog/hymns/christ-arose.musicxml', 2.76], ['catalog/hymns/god-rest-ye-merry.musicxml', 2.87]]) {
    const f = await planOf(file, lvl);
    const verbatim = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' }), thin = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true });
    const lowAt = (graph, t) => { const l = VC.notesOf(graph).filter(n => n.hand === 'LH' && n.on <= t + 1e-6 && n.off > t + 1e-6).map(n => n.midi); return l.length ? Math.min.apply(null, l) : null; };
    const times = Array.from(new Set(VC.notesOf(verbatim.graph).filter(n => n.hand === 'LH' && !n.cont).map(n => n.on.toFixed(4)))).map(Number);
    let checked = 0;
    times.forEach(t => { assert.equal(lowAt(thin.graph, t), lowAt(verbatim.graph, t), file + ': the lowest sounding left-hand note at quarter ' + t + ' is kept'); checked++; });
    assert.ok(checked > 20, file + ': ' + checked + ' onsets checked');
    assert.ok(thin.report.clash.hymnNotesDropped > 0);
  }
});

test('hymn thinning is off by default for a direct call (a verbatim copy stays verbatim), on from candidates/, and gated to stages 1-3', async () => {
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' })), fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: false })), 'default = off');
  assert.notEqual(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', hymnThin: true })), fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' })));
  const hi = await planOf('catalog/hymns/christ-arose.musicxml', 3.9);
  assert.equal(hi.plan.stage, 3, 'fixture assumption: stage 3 is still gated on');
  const s4 = await planOf('catalog/hymns/how-firm-a-foundation.musicxml', 3.76);
  if (s4.plan.stage === 4) {
    const r = REALIZE.realize(s4.g, s4.sg, s4.plan, { pattern: 'hymn', hymnThin: true });
    assert.equal(r.report.clash.hymnThinActive, false);
    assert.equal(fp(r), fp(REALIZE.realize(s4.g, s4.sg, s4.plan, { pattern: 'hymn' })), 'stage 4: a verbatim copy stays verbatim');
  }
  /* candidates/ turns it on: its hymn candidate at stage 2 has no one-hand octave chord (a direct hymn realization has 27) */
  const sel = CAND.run(f.g, f.sg, { targetLevel: 2.76, handProfile: 'large', sections: 'all' }, { patterns: ['hymn'], n: 1, levelOffsets: [0], topKForEngrave: 1 });
  assert.ok(sel.ok);
  assert.equal(VC.verticalClash(sel.selected.graph).octaveChordsLH, 0);
  const keep = CAND.run(f.g, f.sg, { targetLevel: 2.76, handProfile: 'large', sections: 'all' }, { patterns: ['hymn'], n: 1, levelOffsets: [0], topKForEngrave: 1, last: { hymnThin: false, handChords: false } }); /* the hand-chords pass would also thin the copy (docs/GOALS/G09 post user review 4) */
  assert.equal(keep.ok, false, 'opts.last.hymnThin:false keeps the verbatim copy, which has G5 hard violations (span) at profile large: no survivor');
  assert.equal(keep.reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
  assert.equal(keep.discarded[0].scores.hard.hard, 3);
  assert.equal(sel.selected.scores.hard.hard, 0, 'the thinned copy has none');
});

/* ================================================================ determinism, idempotence, the switches */
test('determinism: the same request gives the same graph with every guard on; a thinned hymn realization is stable', async () => {
  for (const [file, lvl] of [['catalog/hymns/nearer-my-god.musicxml', 2.4], ['catalog/hymns/all-creatures.musicxml', 3.88], ['catalog/method/beyer/061.mxl', 2.24]]) {
    const f = await planOf(file, lvl);
    for (const pattern of ['block', 'broken', 'ballad', 'hymn']) {
      const o = { pattern, noStride: true, hymnThin: true };
      assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, o)), fp(REALIZE.realize(f.g, f.sg, f.plan, o)), file + ' ' + pattern);
    }
  }
});

test('idempotence: guarding an already guarded event changes nothing; settling a settled stack changes nothing', () => {
  const clashes = m => TH.isHarshPair(m, 66);
  for (let m = 40; m < 62; m++) {
    const once = TH.guardTones([m, m + 7], clashes, [m % 12, (m + 4) % 12, (m + 7) % 12], 40);
    const twice = TH.guardTones(once.midis, clashes, [m % 12, (m + 4) % 12, (m + 7) % 12], 40);
    assert.deepEqual(twice.midis, once.midis, 'tones ' + m);
  }
  const o = { top: 60, floor: 40, maxSpan: 10, secondBelow: TH.ANY_SECOND, cluster: true };
  let legal = 0;
  [[43, 47, 53], [41, 47, 55], [45, 48, 52], [38, 47, 55], [36, 40, 43], [50, 57, 59], [48, 52, 55]].forEach(c => {
    const a = TH.settleChord(c, o);
    if (!TH.chordLegal(a, o)) return; /* no legal placement: the best effort is returned, idempotence is only promised for a legal result */
    legal++;
    assert.equal(TH.settleChord(a, o), a, 'a legal stack is returned as it is: ' + c.join());
  });
  assert.ok(legal >= 4, 'fixture: several of the chords have a legal placement');
});

test('the switches off reproduce origin/main d5f715f exactly for a direct realize() call (30 fingerprints: 6 pieces x auto, block, broken, ballad, hymn)', async () => {
  const GOLDEN = require('../fixtures/clash-guard-golden.json');
  const cases = [['catalog/hymns/nearer-my-god.musicxml', 2.4], ['catalog/hymns/christ-arose.musicxml', 2.76], ['catalog/hymns/all-creatures.musicxml', 3.88], ['catalog/method/beyer/061.mxl', 2.24], ['catalog/method/czerny599/013.mxl', 2.11], ['catalog/method/burgmuller25/016.mxl', 3.9]];
  let changedByDefault = 0;
  for (const [file, lvl] of cases) {
    const f = await planOf(file, lvl);
    for (const pattern of ['auto', 'block', 'broken', 'ballad', 'hymn']) {
      const name = file.split('/').pop() + '@' + lvl + ':' + pattern;
      assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern, noStride: true }, OFF))), GOLDEN[name], name + ': all three off = the previous behaviour');
      if (fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true })) !== GOLDEN[name]) changedByDefault++;
    }
  }
  assert.ok(changedByDefault >= 10, 'the defaults do change the direct path (' + changedByDefault + ' of 30), as the doc says');
  /* each switch alone is independent: melodyClash off + handGuard on differs from both all-off and default on a piece where each matters */
  const f = await planOf('catalog/hymns/christ-arose.musicxml', 2.76);
  const a = fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, handGuard: false }));
  const b = fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, melodyClash: false }));
  const c = fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true }));
  assert.equal(new Set([a, b, c]).size, 3, 'handGuard alone, melodyClash alone and both give three different realizations');
});
