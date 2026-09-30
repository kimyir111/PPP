/* G9 clash guard: critics/vertical-clash.js (report only, weight 0): harsh vertical pairs per onset, one-hand octave-plus chords, one-hand seconds.
   Planted-defect fixtures (small hand-built scores) and negative controls, then the critic on real pieces and its place in evaluate() and the selection. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const B = require(path.join(REPO, 'scoregraph/build.js'));
const VC = require(path.join(REPO, 'critics/vertical-clash.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

const STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'], SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const pitchOf = m => { const pc = ((m % 12) + 12) % 12, o = { step: STEP[pc], oct: Math.floor(m / 12) - 1 }; if (SHARP[pc]) o.alter = 1; return o; };
/* a two-bar 4/4 piano score from [{hand, m (0|1), at, dur, midis, tieTo?}]; `tieTo` ties this event's first head to the event at that index */
function score(evs) {
  const b = B.builder({ id: 't', meta: {}, source: { kind: 'generator', tool: 't', version: '1' } });
  const ms = [b.measure({ number: '1', dur: '1' }), b.measure({ number: '2', dur: '1' })];
  b.meter({ m: ms[0].id, beats: [4], beatType: 4 });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const rs = b.staff(part, { limb: 'RH' }), ls = b.staff(part, { limb: 'LH' });
  const rv = b.voice(part, { staff: rs.id, limb: 'RH', label: '1' }), lv = b.voice(part, { staff: ls.id, limb: 'LH', label: '5' }), lv2 = b.voice(part, { staff: ls.id, limb: 'LH', label: '6' });
  const made = evs.map(e => b.event(part, { kind: 'note', m: ms[e.m || 0].id, at: e.at, dur: e.dur, voice: (e.hand === 'RH' ? rv : e.lh2 ? lv2 : lv).id, staff: (e.hand === 'RH' ? rs : ls).id, display: { type: 'quarter' }, heads: e.midis.map(x => ({ pitch: pitchOf(x) })) }));
  evs.forEach((e, i) => { if (e.tieTo != null) b.spanner(part, { type: 'tie', from: made[i].heads[0].id, to: made[e.tieTo].heads[0].id }); });
  return b.finish().graph;
}
const at = ['0', '1/4', '1/2', '3/4'];

test('planted defect: a left-hand chord with a major seventh and a minor ninth under the melody is two harsh pairs at one onset', () => {
  const g = score([{ hand: 'RH', at: at[0], dur: '1/4', midis: [72] }, { hand: 'LH', at: at[0], dur: '1/4', midis: [48, 59] }]); /* C5 over C3 and B3 */
  const v = VC.verticalClash(g);
  assert.equal(v.onsets, 1); assert.equal(v.harshPairs, 2, 'C3-B3 (M7) and B3-C5 (m9)'); assert.equal(v.harshOnsets, 1); assert.equal(v.harshPerOnset, 2);
});

test('negative control: a clean triad under the melody, and a second of 2 and a tritone, are not harsh', () => {
  const g = score([{ hand: 'RH', at: at[0], dur: '1/4', midis: [72] }, { hand: 'LH', at: at[0], dur: '1/4', midis: [48, 52, 55] },
    { hand: 'RH', at: at[1], dur: '1/4', midis: [62] }, { hand: 'LH', at: at[1], dur: '1/4', midis: [48, 54] }]); /* D4 over C3 F#3: a ninth and a tritone, a major second */
  const v = VC.verticalClash(g);
  assert.equal(v.onsets, 2); assert.equal(v.harshPairs, 0); assert.equal(v.harshPerOnset, 0);
});

test('a clash is counted when it begins, not again on every onset it survives; a new attack against a held note is counted', () => {
  const g = score([{ hand: 'LH', at: at[0], dur: '1', midis: [59] }, /* B3 held all bar */
    { hand: 'RH', at: at[0], dur: '1/4', midis: [72] },   /* C5: harsh with B3, counted */
    { hand: 'RH', at: at[1], dur: '1/4', midis: [74] },   /* D5: not harsh with B3 */
    { hand: 'RH', at: at[2], dur: '1/4', midis: [72] }]); /* C5 again: counted again */
  const v = VC.verticalClash(g);
  assert.equal(v.onsets, 3); assert.equal(v.harshPairs, 2);
  assert.equal(v.harshOnsets, 2);
});

test('the continuation of a tie is not an attack: a note tied over does not create an onset or re-count a pair', () => {
  const g = score([{ hand: 'RH', at: at[0], dur: '1/2', midis: [72] },                 /* C5, half note */
    { hand: 'LH', at: at[0], dur: '1/4', midis: [59], tieTo: 2 },                       /* B3 quarter, tied to the next B3 */
    { hand: 'LH', at: at[1], dur: '1/4', midis: [59] }]);                               /* the tie's other end: sounds, but does not attack */
  const v = VC.verticalClash(g);
  assert.equal(v.onsets, 1, 'only the first attack is an onset');
  assert.equal(v.harshPairs, 1);
  const untied = score([{ hand: 'RH', at: at[0], dur: '1/2', midis: [72] }, { hand: 'LH', at: at[0], dur: '1/4', midis: [59] }, { hand: 'LH', at: at[1], dur: '1/4', midis: [59] }]);
  assert.equal(VC.verticalClash(untied).harshPairs, 2, 'without the tie the second B3 is a new attack against the sounding C5');
});

test('planted defect: a one-hand chord of an octave or more (held notes included) is counted per hand; 11 semitones is not', () => {
  const g = score([{ hand: 'LH', at: at[0], dur: '1/4', midis: [48, 55, 60] },   /* C3 G3 C4: exactly an octave */
    { hand: 'RH', at: at[0], dur: '1/4', midis: [60, 72] },                        /* an octave in the right hand */
    { hand: 'LH', at: at[1], dur: '1/4', midis: [48, 55, 59] },                    /* 11 semitones: fine */
    { hand: 'LH', at: at[2], dur: '1/2', midis: [36] },                            /* a low note held ... */
    { hand: 'LH', lh2: true, at: at[3], dur: '1/4', midis: [50] }]);                /* ... while D3 attacks (a second left-hand voice): 14 semitones sounding in one hand */
  const v = VC.verticalClash(g);
  assert.equal(v.octaveChordsLH, 2); assert.equal(v.octaveChordsRH, 1); assert.equal(v.octaveChords, 3);
  assert.equal(v.handOnsets, 4, 'four one-hand chords of two or more notes (the lone low note is not a chord)');
  assert.ok(Math.abs(v.octaveChordRate - 3 / 4) < 1e-9);
});

test('planted defect: a one-hand second (1 or 2 semitones between adjacent notes) is counted per hand; a third and a cross-hand second are not', () => {
  const g = score([{ hand: 'LH', at: at[0], dur: '1/4', midis: [48, 50, 55] },   /* C3 D3 G3: a second */
    { hand: 'RH', at: at[0], dur: '1/4', midis: [64, 65] },                        /* E4 F4: a semitone */
    { hand: 'LH', at: at[1], dur: '1/4', midis: [48, 51, 55] },                    /* a third: fine */
    { hand: 'LH', at: at[2], dur: '1/4', midis: [48] }, { hand: 'RH', at: at[2], dur: '1/4', midis: [50] }]); /* C3 and D3 in different hands: not a one-hand second */
  const v = VC.verticalClash(g);
  assert.equal(v.secondsLH, 1); assert.equal(v.secondsRH, 1); assert.equal(v.seconds, 2);
  assert.equal(v.handOnsets, 3);
});

test('arranged pairs: with the source notes, a harsh pair made of two source notes is not arranged; one with a generated note is', () => {
  const g = score([{ hand: 'RH', at: at[0], dur: '1/4', midis: [72] }, { hand: 'LH', at: at[0], dur: '1/4', midis: [59] },
    { hand: 'RH', at: at[1], dur: '1/4', midis: [72] }, { hand: 'LH', at: at[1], dur: '1/4', midis: [71] }]);
  const src = [{ onsetQ: 0, midi: 72 }, { onsetQ: 0, midi: 59 }, { onsetQ: 1, midi: 72 }]; /* the source has both notes at the first onset and only the C5 at the second */
  const v = VC.verticalClash(g, { sourceNotes: src });
  assert.equal(v.harshPairs, 2); /* first onset C5-B3 (a minor ninth); second onset C5-B4 (a minor second); the B3 has ended */
  assert.equal(v.harshArranged, 1, 'only the second onset involves a note the source does not have');
  assert.equal(v.sourceKnown, true);
  assert.equal(VC.verticalClash(g).harshArranged, null, 'without source notes it is not known');
});

test('an empty score is all zeros; rates are over their own denominators', () => {
  const v = VC.ofNotes([]);
  assert.equal(v.onsets, 0); assert.equal(v.harshPerOnset, 0); assert.equal(v.octaveChordRate, 0); assert.equal(v.secondsRate, 0);
});

test('the critic is in evaluate() and has weight 0 in the selection: it is reported, never a score', async () => {
  assert.ok(CRIT.NAMES.indexOf('verticalClash') >= 0);
  assert.equal(CAND.DEFAULT_WEIGHTS.verticalClash, 0);
  const g = await H.graphOf('catalog/hymns/nearer-my-god.musicxml');
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: 2.4, handProfile: 'large', sections: 'all' });
  const r = REALIZE.realize(g, sg, p.plan, { pattern: 'block', noStride: true });
  const ev = CRIT.evaluate(r.graph, { profile: 'large', targetLevel: 2.4, stage: 2, origHarmony: sg.harmony, origMelodyNotes: M.originalMelodyNotes(g, p.plan), skipEngrave: true, sourceNotes: M.graphNoteList(g) });
  assert.ok(ev.critics.verticalClash && ev.critics.verticalClash.sourceKnown === true);
  assert.equal(ev.critics.verticalClash.octaveChordsLH, 0);
  /* a candidate's badness with weight 0 is unchanged by the critic's value */
  const base = CAND.badnessOf(ev.critics, 2.4, undefined, { deferEngrave: true });
  const worse = Object.assign({}, ev.critics, { verticalClash: Object.assign({}, ev.critics.verticalClash, { harshPerOnset: 5 }) });
  assert.equal(CAND.badnessOf(worse, 2.4, undefined, { deferEngrave: true }).total, base.total, 'weight 0: no effect on selection');
  assert.ok(CAND.badnessOf(worse, 2.4, { verticalClash: 1 }, { deferEngrave: true }).total > base.total, '--weights verticalClash=1 counts it');
});

test('real pieces: the source hymn itself has octave chords and harsh pairs; an arrangement without the guard has arranged ones and with the guard none of the arranged-only kind', async () => {
  const g = await H.graphOf('catalog/hymns/christ-arose.musicxml');
  const src = VC.verticalClash(g);
  assert.ok(src.octaveChordsLH >= 20, 'the SATB source stacks tenor and bass an octave or more often (' + src.octaveChordsLH + ')');
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: 2.76, handProfile: 'large', sections: 'all' });
  const off = VC.verticalClash(REALIZE.realize(g, sg, p.plan, { pattern: 'block', noStride: true, melodyClash: false, handGuard: false }).graph, { sourceNotes: M.graphNoteList(g) });
  const on = VC.verticalClash(REALIZE.realize(g, sg, p.plan, { pattern: 'block', noStride: true }).graph, { sourceNotes: M.graphNoteList(g) });
  assert.equal(off.octaveChordsLH, 12); assert.equal(on.octaveChordsLH, 0);
  assert.ok(off.harshArranged > on.harshArranged);
});
