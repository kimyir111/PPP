/* G9 last defect round (docs/GOALS/G09 section 12 "G9 last defect round (compound meter, chromatic harmony, chord thickness)").

   Three content defects two blind AI teacher judges and the user's blind reviews found in G9's output, each with its fix in the realizer:
     1. compound meter: `broken`/`ballad` cut a dotted beat into 4 (dotted eighths, 8 per 6/4 bar); now in threes (opts.compoundBeat)
     2. chromatic harmony at stages 1-2: a chord tone outside the key that the source does not sound is replaced (opts.diatonicLow)
     3. thickness: block chords are a dyad at stage 2, at or under middle C, with no second below C4 (opts.leftShape)
   Each switch defaults ON and `false` restores the previous behaviour exactly (the same output as origin/main 387b4c5; checked with a
   fingerprint sweep over 70 realizations, recorded in the G09 doc). The source melody and every verbatim voice stay byte-identical. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const PAT = require(path.join(REPO, 'realize/patterns.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));
const PLA = require(path.join(REPO, 'playability/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const P = require(path.join(REPO, 'scoregraph/pitch.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const LHT = require(path.join(REPO, 'critics/left-hand-thickness.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

const OFF = { compoundBeat: false, diatonicLow: false, leftShape: false };
async function planOf(file, targetLevel, handProfile) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: targetLevel, handProfile: handProfile || 'large', sections: 'all' });
  assert.ok(p.ok, file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan, source: M.graphNoteList(g) };
}
const fp = r => { assert.ok(r.ok); return SER.fingerprint(r.graph); };
/* the left-hand events of a realized graph: [{at (absolute whole notes), dur, midis ascending}] */
function lhEvents(graph) {
  const part = graph.parts[0];
  const mStart = new Map(); let acc = R.ZERO;
  graph.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
  const out = [];
  part.events.forEach(e => {
    if (e.kind !== 'note') return;
    const heads = e.heads.filter(h => P.limbOf(part, e, h) === 'LH');
    if (heads.length) out.push({ m: e.m, at: R.add(mStart.get(e.m), R.parse(e.at)), dur: R.parse(e.dur), midis: heads.map(h => P.midi(h.pitch)).sort((a, b) => a - b) });
  });
  return out;
}
const rh = graph => {
  const part = graph.parts[0];
  return part.events.filter(e => e.kind === 'note')
    .map(e => ({ m: e.m, at: e.at, dur: e.dur, h: e.heads.filter(h => P.limbOf(part, e, h) === 'RH').map(h => P.midi(h.pitch)).join() }))
    .filter(x => x.h);
};

/* ================================================================ 1. compound meter */
/* the windows of one bar of a meter: `count` beat windows of `len` */
const bar = (count, len) => Array.from({ length: count }, (_, i) => ({ w0: R.mul(len, R.make(i, 1)), w1: R.mul(len, R.make(i + 1, 1)), root: [0, 7, 5, 9][i % 4], quality: 'maj' }));
const PAT_OPTS = { anchor: 50, count: 3, maxSpan: 14, floor: 40 };

test('compound meters: broken and ballad split every beat window in THREE equal plain values (6/8, 9/8, 12/8 and 6/4)', () => {
  const cases = [
    ['6/8', 2, R.make(3, 8), R.make(1, 8)],
    ['9/8', 3, R.make(3, 8), R.make(1, 8)],
    ['12/8', 4, R.make(3, 8), R.make(1, 8)],
    ['6/4', 2, R.make(3, 4), R.make(1, 4)]
  ];
  cases.forEach(([meter, beats, len, part]) => {
    ['broken', 'ballad'].forEach(name => {
      const r = PAT.run(name, bar(beats, len), null, PAT_OPTS);
      assert.equal(r.events.length, beats * 3, meter + ' ' + name + ': three events per beat');
      r.events.forEach(e => assert.ok(R.eq(e.dur, part), meter + ' ' + name + ': each part is ' + R.format(part) + ', got ' + R.format(e.dur)));
      let t = R.ZERO;
      r.events.forEach(e => { assert.ok(R.eq(e.at, t), meter + ' ' + name + ': contiguous'); t = R.add(t, e.dur); });
      assert.ok(R.eq(t, R.mul(len, R.make(beats, 1))), meter + ' ' + name + ': tiles the bar');
      r.events.forEach(e => assert.equal(e.midis.length, 1, 'one note at a time'));
    });
  });
});

test('compound meters: compound:false restores the old dotted split; a simple meter is identical either way', () => {
  const old = PAT.run('broken', bar(2, R.make(3, 8)), null, Object.assign({ compound: false }, PAT_OPTS));
  assert.equal(old.events.length, 8);
  assert.ok(old.events.every(e => R.eq(e.dur, R.make(3, 32))), 'the old split: 3/32 (a dotted sixteenth) in 6/8, not a beat value');
  const four4 = bar(4, R.make(1, 4));
  ['broken', 'ballad', 'pop'].forEach(name => {
    const a = PAT.run(name, four4, null, PAT_OPTS), b = PAT.run(name, four4, null, Object.assign({ compound: false }, PAT_OPTS));
    assert.deepEqual(a.events, b.events, name + ': a simple meter is identical with or without the compound rule');
  });
});

test('compound meters: pop gives a long two thirds and a short third (no dotted split)', () => {
  const r = PAT.run('pop', bar(2, R.make(3, 8)), null, PAT_OPTS);
  assert.equal(r.events.length, 4);
  r.events.forEach((e, i) => assert.ok(R.eq(e.dur, i % 2 === 0 ? R.make(1, 4) : R.make(1, 8)), 'pop part ' + i + ': ' + R.format(e.dur)));
});

test('compound meters on real pieces: nearer-my-god (6/4) and burgmuller25/003 (6/8), every accompaniment value is a third of the beat', async () => {
  const a = await planOf('catalog/hymns/nearer-my-god.musicxml', 2.4);
  ['broken', 'ballad'].forEach(pattern => {
    const on = REALIZE.realize(a.g, a.sg, a.plan, { pattern });
    const off = REALIZE.realize(a.g, a.sg, a.plan, Object.assign({ pattern }, OFF));
    assert.ok(on.ok && off.ok);
    assert.deepEqual(Array.from(new Set(lhEvents(on.graph).map(e => R.format(e.dur)))), ['1/4'], 'nearer-my-god 6/4: quarter notes, three to a dotted-half beat');
    assert.ok(lhEvents(off.graph).some(e => R.eq(e.dur, R.make(3, 16))), 'the old output has the dotted eighths');
    assert.equal(PLA.analyzeGraph(on.graph, { profile: 'large' }).totals.hard, 0);
  });
  const b = await planOf('catalog/method/burgmuller25/003.mxl', 3.8, 'medium');
  const on = REALIZE.realize(b.g, b.sg, b.plan, { pattern: 'broken' });
  assert.ok(on.ok);
  const durs = new Set(lhEvents(on.graph).map(e => R.format(e.dur)));
  assert.ok(durs.has('1/8') && !durs.has('3/32') && !durs.has('3/16'), 'burgmuller25/003: ' + Array.from(durs).join(','));
});

/* ================================================================ 2. chromatic harmony at low stages */
test('keyPcs: the written key signature set (minor adds the raised seventh)', () => {
  assert.deepEqual(Array.from(TH.keyPcs(0, 'major').set).sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(TH.keyPcs(1, 'major').tonic, 7);
  assert.ok(TH.keyPcs(1, 'major').set.has(6) && !TH.keyPcs(1, 'major').set.has(5));
  const am = TH.keyPcs(0, 'minor');
  assert.equal(am.tonic, 9);
  assert.ok(am.set.has(8) && am.set.has(7), 'A minor: G and G# are both in the set');
});

test('diatonicSubstitute: an unsounded tone outside the key becomes a diatonic chord; one the source sounds, or none, is left alone', () => {
  const C = TH.keyPcs(0, 'major');
  const played = (root, q) => TH.playedPcs(root, q, 3, null);
  /* beyer/020: E augmented over C (melody) and E (left hand); the source sounds C and E */
  assert.deepEqual(TH.diatonicSubstitute(4, 'aug', played(4, 'aug'), C, [0, 4]), { root: 0, quality: 'maj' }, 'E+ with C and E sounding becomes C major');
  /* a chromatic tone the source itself sounds is the composer's accidental: untouched */
  assert.equal(TH.diatonicSubstitute(4, 'aug', played(4, 'aug'), C, [0, 4, 8]), null);
  assert.equal(TH.diatonicSubstitute(4, 'maj', played(4, 'maj'), C, [4, 8, 11]), null);
  /* diatonic chords: untouched */
  assert.equal(TH.diatonicSubstitute(7, 'maj', played(7, 'maj'), C, [7]), null);
  assert.equal(TH.diatonicSubstitute(7, 'dom7', played(7, 'dom7'), C, [7, 11]), null);
  /* E major (V/vi) over E and B becomes E minor: the root is kept */
  assert.deepEqual(TH.diatonicSubstitute(4, 'maj', played(4, 'maj'), C, [4, 11]), { root: 4, quality: 'min' });
  /* only the tones that will SOUND count: with a stack of 2 the augmented E keeps root and fifth (E, C), both diatonic */
  assert.equal(TH.diatonicSubstitute(4, 'aug', TH.playedPcs(4, 'aug', 3, 2), C, [0, 4]), null);
  /* in A minor the raised seventh is diatonic */
  assert.equal(TH.diatonicSubstitute(4, 'maj', played(4, 'maj'), TH.keyPcs(0, 'minor'), [4]), null);
  /* every substitute is wholly in the key */
  for (let root = 0; root < 12; root++) {
    Object.keys(TH.CHORD_INTERVALS).forEach(q => {
      const s = TH.diatonicSubstitute(root, q, played(root, q), C, [root]);
      if (s) assert.ok(TH.intervalsFor(s.quality).every(iv => C.set.has((s.root + iv) % 12)), root + q + ' -> ' + JSON.stringify(s));
    });
  }
});

test('beyer/020 (stage 2): no left-hand tone outside C major that the source does not sound; the old output had them', async () => {
  const f = await planOf('catalog/method/beyer/020.mxl', 2.55);
  assert.equal(f.plan.stage, 2);
  const base = { pattern: 'auto', noStride: true, diatonicLow: true };
  const on = REALIZE.realize(f.g, f.sg, f.plan, base);
  const off = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({}, base, { diatonicLow: false, leftShape: false }));
  assert.ok(on.ok && off.ok);
  const C = TH.keyPcs(0, 'major').set;
  const notes = U.noteWindows(f.g);
  const srcAt = t => new Set(notes.filter(n => R.le(n.w0, t) && R.gt(n.w1, t)).map(n => n.pc));
  const chromatic = graph => lhEvents(graph).filter(e => { const s = srcAt(e.at); return e.midis.some(m => !C.has(m % 12) && !s.has(m % 12)); }).length;
  assert.ok(chromatic(off.graph) > 10, 'fixture assumption: the old output writes invented chromatic tones (' + chromatic(off.graph) + ')');
  assert.equal(chromatic(on.graph), 0);
  assert.ok(on.report.diatonic.active);
  const subOnly = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({}, base, { leftShape: false }));
  assert.equal(chromatic(subOnly.graph), 0, 'the substitution alone (no thinning) already removes them');
  assert.ok(subOnly.report.diatonic.substituted > 0);
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(on.graph)), 1, 'melody untouched');
});

test('the diatonic rule is gated by stage: active at 1 and 2, inactive (output identical to diatonicLow:false) at 3 and up', async () => {
  assert.equal(TH.DIATONIC_MAX_STAGE, 2);
  const hi = await planOf('catalog/method/beyer/061.mxl', 3.6);
  assert.ok(hi.plan.stage >= 3);
  const a = REALIZE.realize(hi.g, hi.sg, hi.plan, { pattern: 'broken', noStride: true, diatonicLow: true });
  const b = REALIZE.realize(hi.g, hi.sg, hi.plan, { pattern: 'broken', noStride: true, diatonicLow: false });
  assert.equal(a.report.diatonic.active, false);
  assert.equal(a.report.diatonic.substituted, 0);
  assert.equal(fp(a), fp(b));
  const lo = await planOf('catalog/method/beyer/061.mxl', 2.24);
  assert.equal(lo.plan.stage, 2);
  const c = REALIZE.realize(lo.g, lo.sg, lo.plan, { pattern: 'block', noStride: true, diatonicLow: true });
  assert.ok(c.report.diatonic.active && c.report.diatonic.windows > 0);
  assert.ok(c.report.diatonic.substituted > 0, 'beyer/061 has windows read as chromatic chords (Bmaj, Dmaj) the source does not sound');
});

/* ================================================================ 3. thickness */
test('thinChord: root first, then fifth, then third, then seventh; a chord within the cap is the same array', () => {
  const Cmaj = [48, 52, 55];
  assert.equal(TH.thinChord(Cmaj, 0, 3), Cmaj);
  assert.deepEqual(TH.thinChord(Cmaj, 0, 2), [48, 55], 'root and fifth');
  assert.deepEqual(TH.thinChord(Cmaj, 0, 1), [48]);
  assert.deepEqual(TH.thinChord([55, 59, 62], 7, 2), [55, 62]);
  assert.deepEqual(TH.thinChord([55, 59, 65], 7, 2), [55, 59], 'a dom7 voiced root, third, seventh (no fifth): root and third');
  assert.deepEqual(TH.thinChord([52, 56, 60], 4, 2), [52, 60], 'augmented: its fifth (C) counts as the fifth');
  assert.deepEqual(TH.thinChord([48, 55, 60], 0, 2), [48, 55], 'a doubled root is dropped before the fifth');
  assert.deepEqual(TH.thinChord([60, 52, 55], 0, 2), [55, 60], 'input order does not matter; the higher duplicate root is what stays with the fifth');
  assert.deepEqual(TH.STACK_MAX_BY_STAGE, { 1: 1, 2: 3, 3: 3, 4: 3 }, 'a triad from stage 2 (the dyad cap lost harmony on the SATB hymns)');
  assert.equal(TH.maxStackForStage(2), 3);
});

test('settleChord: a legal chord stays; a high one drops an octave; seconds below C4 and thirds below C3 are avoided; pitch classes and count kept', () => {
  const o = { top: 60, floor: 40, maxSpan: 14 };
  const legal = [48, 55, 60];
  assert.equal(TH.settleChord(legal, o), legal, 'already legal: the same array');
  const high = TH.settleChord([55, 59, 62], o);
  assert.ok(Math.max.apply(null, high) <= 60, 'top under middle C: ' + high.join());
  assert.deepEqual(new Set(high.map(m => m % 12)), new Set([7, 11, 2]));
  assert.equal(high.length, 3);
  assert.equal(TH.clusterPairs(high), 0);
  const second = TH.settleChord([50, 52, 57], o); /* D3 E3 A3: a second below C4 */
  assert.equal(TH.clusterPairs(second), 0, 'no second: ' + second.join());
  assert.deepEqual(new Set(second.map(m => m % 12)), new Set([2, 4, 9]));
  const low = TH.settleChord([43, 47, 50], o); /* G2 B2 D3: a third below C3 */
  assert.equal(TH.clusterPairs(low), 0, 'no low third: ' + low.join());
  assert.ok(Math.min.apply(null, low) >= 40);
  [[40, 55, 62], [52, 60, 67]].forEach(c => {
    const s = TH.settleChord(c, { top: 127, floor: 40, maxSpan: 10 });
    assert.ok(Math.max.apply(null, s) - Math.min.apply(null, s) <= 10, s.join());
  });
  assert.deepEqual(TH.settleChord([55, 59, 62], o), high, 'deterministic');
  assert.deepEqual(TH.settleChord(high, o), high, 'idempotent on a legal result');
  for (let root = 0; root < 12; root++) {
    ['maj', 'min', 'dim'].forEach(q => {
      const s = TH.settleChord(TH.freshVoicing(root, q, 3, 52), o);
      assert.deepEqual(new Set(s.map(m => m % 12)), new Set(TH.targetPcs(root, q, 3)));
      assert.ok(Math.min.apply(null, s) >= 40 && Math.max.apply(null, s) <= 62, root + q + ' ' + s.join());
    });
  }
});

test('settleChord: a chord that has to move stays close to the chord written before it; one that is legal is not touched', () => {
  const o = { top: 60, floor: 40, maxSpan: 14 };
  const prev = [43, 50, 55];
  const legal = [48, 55, 60];
  assert.equal(TH.settleChord(legal, Object.assign({ prev: prev }, o)), legal, 'legal: the same array, prev or not');
  const s = TH.settleChord([55, 59, 62], Object.assign({ prev: prev }, o)); /* top D4 is over the bound */
  assert.ok(Math.max.apply(null, s) <= 60 && Math.abs(s[0] - prev[0]) < 12, 'bass ' + prev[0] + ' -> ' + s[0] + ' (' + s.join() + ')');
});

test('beyer/061 at stage 2: the block chord is a triad at most, at or under middle C, never a second below C4; the old output had seconds and tops at E4 or above', async () => {
  const f = await planOf('catalog/method/beyer/061.mxl', 2.24);
  assert.equal(f.plan.stage, 2);
  const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true });
  const off = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: 'block', noStride: true }, OFF));
  assert.ok(on.ok && off.ok);
  const a = LHT.leftHandThickness(on.graph), b = LHT.leftHandThickness(off.graph);
  assert.ok(b.secondsBelowC4 > 0 && b.topsAtOrAboveE4 > 0, 'fixture: the old output had seconds below C4 and tops at E4 or above');
  assert.ok(a.notesPerOnset > 2.5 && a.notesPerOnset <= 3, 'a triad is kept (' + a.notesPerOnset.toFixed(2) + ')');
  assert.equal(a.secondsBelowC4, 0);
  assert.equal(a.topsAtOrAboveE4, 0);
  assert.equal(a.clusterAttacks, 0);
  lhEvents(on.graph).forEach(e => assert.ok(e.midis.length <= 3 && e.midis[e.midis.length - 1] <= TH.LH_CHORD_TOP && e.midis[0] >= TH.REGISTER_FLOOR, e.midis.join()));
  assert.equal(PLA.analyzeGraph(on.graph, { profile: 'large' }).totals.hard, 0);
});

test('block: a triad that cannot be placed legally falls back to the dyad (root and fifth) for that window only', () => {
  const win = (root, quality) => ({ w0: R.ZERO, w1: R.make(1, 4), root: root, quality: quality });
  const opts = { anchor: 48, count: 3, maxSpan: 14, shape: { maxStack: 3, top: 52, floor: 40, state: { prev: null } } };
  /* D minor in 40..52: D3, F2, A2 only, F2-A2 is a third below C3 */
  const r = PAT.run('block', [win(2, 'min'), win(0, 'maj')], null, opts);
  assert.deepEqual(r.events[0].midis.map(m => m % 12).sort((a, b) => a - b), [2, 9], 'D minor: root and fifth');
  assert.equal(r.events[1].midis.length, 3, 'C major fits: the triad stays');
  assert.ok(r.events.every(e => Math.max.apply(null, e.midis) <= 52));
});

test('the stack cap is by stage: one note at stage 1, a triad from stage 2; broken and ballad keep their triad tones (one note at a time) under middle C', async () => {
  const s1 = await planOf('catalog/method/beyer/020.mxl', 1.5);
  assert.equal(s1.plan.stage, 1);
  assert.equal(LHT.leftHandThickness(REALIZE.realize(s1.g, s1.sg, s1.plan, { pattern: 'auto', noStride: true }).graph).notesPerOnset, 1);
  const s2 = await planOf('catalog/method/beyer/061.mxl', 2.24);
  ['broken', 'ballad'].forEach(pattern => {
    const evs = lhEvents(REALIZE.realize(s2.g, s2.sg, s2.plan, { pattern, noStride: true }).graph);
    assert.ok(evs.every(e => e.midis.length === 1), pattern + ': single notes');
    assert.ok(new Set(evs.slice(0, 4).map(e => e.midis[0] % 12)).size >= 2, pattern + ': more than one tone of the chord sounds in a beat');
    assert.ok(Math.max.apply(null, evs.map(e => e.midis[0])) <= TH.LH_CHORD_TOP, pattern + ': top at or under middle C');
  });
  assert.equal(TH.maxStackForStage(2), 3);
  assert.equal(TH.maxStackForStage(3), 3, 'a stage-3 stack may be a triad');
});

test('the switches each restore the previous behaviour; none changes the melody, the right hand or a verbatim (hymn) voice', async () => {
  const f = await planOf('catalog/method/beyer/020.mxl', 2.55);
  const base = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, diatonicLow: true });
  const allOff = REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: 'block', noStride: true }, OFF));
  assert.notEqual(fp(base), fp(allOff));
  /* a 4/4 piece: the compound rule alone changes nothing */
  assert.equal(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, diatonicLow: false, leftShape: false })), fp(allOff));
  assert.notEqual(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, diatonicLow: true, compoundBeat: false, leftShape: false })), fp(allOff), 'the diatonic rule alone changes this piece');
  assert.notEqual(fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, compoundBeat: false })), fp(allOff), 'the shape alone changes this piece');
  assert.deepEqual(rh(base.graph), rh(allOff.graph), 'right hand identical with and without every fix');
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(base.graph)), 1);
  const hy = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' });
  assert.equal(fp(hy), fp(REALIZE.realize(f.g, f.sg, f.plan, Object.assign({ pattern: 'hymn' }, OFF))), 'hymn: a verbatim copy, identical on or off');
});

test('determinism: the same request gives the same graph; no hard violation, melody untouched, no generated left-hand note under the floor', async () => {
  for (const [file, lvl] of [['catalog/method/beyer/020.mxl', 2.55], ['catalog/method/beyer/061.mxl', 2.24], ['catalog/hymns/nearer-my-god.musicxml', 2.4], ['catalog/method/sonatina/025.mxl', 3.4]]) {
    const f = await planOf(file, lvl);
    for (const pattern of ['block', 'broken', 'ballad']) {
      const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true }), b = REALIZE.realize(f.g, f.sg, f.plan, { pattern, noStride: true });
      assert.equal(fp(a), fp(b), file + ' ' + pattern + ': deterministic');
      assert.equal(PLA.analyzeGraph(a.graph, { profile: 'large' }).totals.hard, 0, file + ' ' + pattern + ': no hard violation');
      assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(a.graph)), 1, file + ' ' + pattern + ': melody');
      assert.ok(Math.min.apply(null, lhEvents(a.graph).map(e => e.midis[0])) >= TH.REGISTER_FLOOR, file + ' ' + pattern + ': floor');
    }
  }
});

test('diatonicLow is OFF for a direct realize() call (the app g8 path) and ON from candidates/', async () => {
  const f = await planOf('catalog/method/beyer/020.mxl', 2.55);
  const direct = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true });
  assert.equal(direct.report.diatonic.active, false);
  assert.equal(direct.report.diatonic.substituted, 0);
  assert.equal(fp(direct), fp(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, diatonicLow: false })));
  assert.equal(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', noStride: true, diatonicLow: true }).report.diatonic.active, true);
  const CAND = require(path.join(REPO, 'candidates/index.js'));
  const en = CAND.enumerate(f.g, f.sg, { targetLevel: 2.55, handProfile: 'large', sections: 'all' }, { patterns: ['block'] });
  assert.ok(en.candidates.length > 0);
  assert.ok(en.candidates.every(c => c.report.diatonic.active === (c.plan.stage <= TH.DIATONIC_MAX_STAGE)), 'candidates turn it on (for stages 1-2)');
  const en2 = CAND.enumerate(f.g, f.sg, { targetLevel: 2.55, handProfile: 'large', sections: 'all' }, { patterns: ['block'], last: { diatonicLow: false } });
  assert.ok(en2.candidates.every(c => c.report.diatonic.active === false), 'and opts.last overrides it');
});
