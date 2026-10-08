/* The checks of G10a-1d (docs/GOALS/G10_AUDIO_TO_SCORE.md section 36): the phase step after the metre model. The metre, the pulse and
   the tempo of a reading are the metre model's (ai5a v1.1, unchanged); the phase step chooses only the bar phase among the readings of the
   same pulse frame and metre, from the harmonic rhythm and the helper's downbeats. The helper's beats are used as before only when they are
   steady (one pulse, one bar); otherwise their downbeats are phase evidence only. Shared by skeleton-phase.test.js and the mutation test of
   the skeleton (skeleton-covers-mutation.test.js): every check returns { name, ok, got, want } and takes a rec/index.js. Synthetic music only. */
'use strict';
const path = require('path');
const { REPO, skeletonInput, march, waltz, jig } = require('./helpers.js');
const { pop, swung } = require('./covers-fixtures.js');

/* pop(n, 120) has its bar lines at 1 + 2k s and quarters every 0.5 s */
const QPM = 120, SPQ = 0.5;
const beatsEvery = (n, from) => { const o = []; for (let k = 0; k < n; k++) o.push(Math.round((from + k * SPQ) * 1e4) / 1e4); return o; };
const withoutPhase = W => { const o = Object.assign({}, W); delete o.phase; return o; };

/* a 4/4 pop piece whose recording starts 1, 2 or 3 beats into a bar (an intro, a pickup, a cut) */
function laterStart(bars, cut, seed) {
  return { notes: pop(bars, QPM, { jitter: 0.02, seed: seed }).notes.filter(n => n.on >= 1 + cut * SPQ - 0.03) };
}

/* the phase step never changes the metre, the pulse frame or the tempo of the metre model's reading: on march, waltz, jig, pop, swung pop and
   later-start pieces the reading with the phase step and without it differ at most in the bar phase */
function decoupledCheck(REC) {
  const W = REC.loadWeights(), W0 = withoutPhase(W);
  const pieces = [march(16, 100, { jitter: 0.02, seed: 3 }), waltz(16, 120, { jitter: 0.02, seed: 5 }), jig(16, 90, { jitter: 0.02, seed: 9 }),
    pop(32, QPM, { jitter: 0.02, seed: 4 }), swung(pop(16, QPM, { jitter: 0.02, seed: 4 }), QPM, 0.65, 1), laterStart(16, 1, 4), laterStart(16, 2, 4), laterStart(32, 3, 5)];
  let bad = 0, moved = 0;
  const got = [];
  pieces.forEach(p => {
    const notes = skeletonInput(p.notes);
    const a = REC.skeleton(notes, { weights: W }), b = REC.skeleton(notes, { weights: W0 });
    const ca = a.report.chosen, cb = b.report.chosen;
    const same = a.metre.key === b.metre.key && a.qpm === b.qpm && ca.track === cb.track && ca.rho === cb.rho && (ca.swing || 0) === (cb.swing || 0);
    if (!same) bad++;
    if (ca.phi !== cb.phi) moved++;
    got.push(a.metre.key + '@' + Math.round(a.qpm) + (ca.phi !== cb.phi ? ' phase ' + cb.phi + '->' + ca.phi : ''));
  });
  return { name: 'the phase step changes only the bar phase: metre, pulse frame and tempo are the metre model\'s', ok: bad === 0 && moved > 0 && !!W.phase,
    got: bad + ' changed beyond the phase, ' + moved + ' phases moved: ' + got.join('; '), want: 'none beyond the phase, some phases moved' };
}

/* a 4/4 pop piece that starts 1-3 beats into a bar keeps its bar lines where its chords change (the first full bar at 3 s): ai5a v1.1 alone put
   them on the first onset in each of these */
function laterCheck(REC, list) {
  const got = (list || [[16, 1], [16, 2], [16, 3], [32, 1], [32, 2], [32, 3]]).map(([bars, cut]) => {
    const sk = REC.skeleton(skeletonInput(laterStart(bars, cut, 4).notes), {});
    const ok = !!sk && sk.metre.key === '4/4' && Math.abs(Math.log(sk.qpm / QPM)) < Math.log(1.04) && sk.beats.some((t, i) => i % 4 === 0 && Math.abs(t - 3) < 0.06);
    return { ok: ok, s: bars + ' bars from beat ' + (cut + 1) + ': ' + (sk ? sk.metre.key + ' at ' + Math.round(sk.qpm) + ', bar line at ' + sk.beats[0].toFixed(2) + ' s' : 'none') + (ok ? '' : ' WRONG') };
  });
  return { name: 'a piece that starts inside a bar keeps its bar lines where the chords change', ok: got.every(g => g.ok), got: got.map(g => g.s).join('; '), want: '4/4 at 120 with a bar line at 3 s' };
}

/* the helper's beats: steady (one pulse, one downbeat a bar) are used as before; downbeats that mix bars and half bars (Beat This on pop) make
   them phase evidence only, and then the metre, pulse and tempo are exactly the notes' own */
function helperGateCheck(REC) {
  const W = REC.loadWeights();
  const notes = skeletonInput(pop(32, QPM, { jitter: 0.02, seed: 4 }).notes), att = REC.attacks.attacksOf(notes);
  const beats = beatsEvery(32 * 4 + 1, 1);
  const bars = beats.filter((t, i) => i % 4 === 0), halves = beats.filter((t, i) => i % 2 === 0), threes = beats.filter((t, i) => i % 3 === 0);
  const mixed = beats.filter((t, i) => i % 8 === 0 || i % 8 === 2 || i % 8 === 4);   /* intervals of 2, 2, 4 beats: half bars and bars */
  const none = REC.skeleton(notes, {});
  const same = sk => sk && sk.metre.key === none.metre.key && sk.qpm === none.qpm && sk.report.chosen.track === none.report.chosen.track && sk.report.chosen.rho === none.report.chosen.rho;
  /* a real tracker's beats (not marked trusted): steady bars, steady half bars, steady three-beat groups, a mixture - never the metre model's */
  const real = [['bars', bars], ['half bars', halves], ['three beats', threes], ['mixed', mixed]].map(([n, d]) => [n, REC.skeleton(notes, { beats: beats, downbeats: d })]);
  const useTrusted = REC.helperUse(beats, bars, att, W, true), useReal = REC.helperUse(beats, bars, att, W, false), useMixed = REC.helperUse(beats, mixed, att, W, true);
  const ok = useTrusted === 'used' && useReal === 'phase' && useMixed === 'phase' && real.every(([n, sk]) => same(sk) && sk.report.chosen.helperBeats === 'phase');
  return { name: 'a real tracker\'s beats never reach the metre model: steady bars, half bars or three-beat groups leave the notes\' 4/4 and tempo; only trusted beats are used', ok: ok,
    got: 'trusted ' + useTrusted + ', real ' + useReal + ', trusted but unsteady ' + useMixed + '; ' + real.map(([n, sk]) => n + ' ' + (sk ? sk.metre.key + '@' + Math.round(sk.qpm) + ' ' + sk.report.chosen.helperBeats : 'none')).join(', ') + ' against ' + none.metre.key + '@' + Math.round(none.qpm),
    want: 'used, phase; every real case the notes\' reading, phase' };
}

/* the downbeats as phase evidence reach the phase step (rec/index.js phaseDownbeats): on a piece whose notes say nothing about the phase (the
   same chord on every quarter) a real tracker's downbeats on the second quarter of the notes' bars move the bar lines there */
function downWiringCheck(REC) {
  const notes = [];
  for (let k = 0; k < 64; k++) [48, 52, 55, 60].forEach(m => notes.push({ on: Math.round((1 + k * SPQ) * 1e3) / 1e3, off: Math.round((1 + k * SPQ + 0.4) * 1e3) / 1e3, midi: m, vel: 64 }));
  const input = skeletonInput(notes), none = REC.skeleton(input, {});
  const per = 4, lines = none.beats.filter((t, i) => i % per === 0);
  const downs = lines.map(t => Math.round((t + SPQ) * 1e4) / 1e4);
  const beats = beatsEvery(64, 1);
  const sk = REC.skeleton(input, { beats: beats, downbeats: downs });
  const onDowns = sk.beats.filter((t, i) => i % per === 0).filter(t => downs.some(d => Math.abs(d - t) < 0.06)).length;
  return { name: 'a real tracker\'s downbeats reach the phase step and move the bar lines of a piece whose notes cannot tell', ok: sk.metre.key === none.metre.key && onDowns >= 0.8 * downs.length,
    got: onDowns + ' of ' + downs.length + ' bar lines on the downbeats (' + sk.metre.key + ')', want: 'at least 80 %' };
}

/* the posterior and the confidence say how sure the metre model's choice is; the phase step does not change them (a confidence that fell
   after a phase move made the review screen say "the metre was hard to hear" on exactly the pieces the step fixed) */
function confidenceCheck(REC) {
  const W = REC.loadWeights(), W0 = Object.assign({}, W); delete W0.phase;
  let moved = 0, bad = 0;
  [[16, 1], [16, 2], [16, 3], [32, 1], [32, 2], [32, 3]].forEach(([bars, cut]) => {
    const notes = skeletonInput(laterStart(bars, cut, 4).notes);
    const a = REC.skeleton(notes, { weights: W }), b = REC.skeleton(notes, { weights: W0 });
    if (a.report.chosen.phi !== b.report.chosen.phi) moved++;
    if (a.conf !== b.conf || a.posterior !== b.posterior) bad++;
  });
  return { name: 'a phase move leaves the metre choice\'s posterior and confidence as they were', ok: moved > 0 && bad === 0, got: moved + ' phases moved, ' + bad + ' confidences changed', want: 'some moved, none changed' };
}

/* an audio beat track that changes its pulse level or adds beats is not one pulse; a regular one with missed beats is */
function audioGateCheck(REC) {
  const g = REC.loadWeights().phase.helperGate, att = [{ t: 1 }, { t: 60 }], o = { maxIrregular: g.maxIrregular, maxExtra: g.maxExtra };
  const regular = beatsEvery(120, 1).filter((t, i) => i % 23 !== 7);
  const levels = beatsEvery(60, 1).concat(Array.from({ length: 40 }, (x, k) => Math.round((31 + k * 0.75) * 1e4) / 1e4));
  const extras = beatsEvery(120, 1).reduce((acc, t, i) => acc.concat(i % 20 === 10 ? [t, Math.round((t + 0.15) * 1e4) / 1e4] : [t]), []);
  const a = REC.beats.audioTrack(regular, att, o), b = REC.beats.audioTrack(levels, att, o), c = REC.beats.audioTrack(extras, att, o);
  return { name: 'an audio beat track that changes its pulse level or adds beats is not one pulse; a regular one with missed beats is', ok: !!a && !b && !c,
    got: 'regular ' + (a ? 'one pulse' : 'refused') + ', two levels ' + (b ? 'one pulse' : 'refused') + ', extra beats ' + (c ? 'one pulse' : 'refused'), want: 'regular one pulse, the others refused' };
}

/* the downbeats' phase evidence (model.phaseDown): on the bar lines it picks one phase; every half bar it leaves the two half-bar phases alike;
   every three beats under 4/4 it says nothing */
function downPhaseCheck(REC) {
  const M = REC.model, m = M.METRES[M.BY_KEY['4/4']];
  const track = { beats: beatsEvery(64, 1) };
  const at = downs => { const sh = M.phaseShares(track, 1, m, downs); return [0, 1, 2, 3, 4, 5, 6, 7].map(k => M.phaseDown(sh, k, m)); };
  const bars = at(track.beats.filter((t, i) => i % 4 === 0)), halves = at(track.beats.filter((t, i) => i % 2 === 0)), threes = at(track.beats.filter((t, i) => i % 3 === 0));
  const ok = bars[0] === 0 && bars.slice(1).every(x => x < -0.5) && Math.abs(halves[0] - halves[4]) < 0.05 && halves[0] > -0.05 && halves[2] < -0.1 &&
    threes.every(x => Math.abs(x) < 0.1);
  const f = xs => xs.map(x => x.toFixed(2)).join(' ');
  return { name: 'the downbeats as phase evidence: bars pick a phase, half bars leave two alike, three beats say nothing', ok: ok,
    got: 'bars ' + f(bars) + ' | half bars ' + f(halves) + ' | threes ' + f(threes), want: 'one 0 then < -0.5 | phases 0 and 4 alike near 0 | all near 0' };
}

/* the harmonic rhythm (model.harmonicContrast): chords that change at every bar line score the bar's phase above its half-bar phase, by the same
   amount the other way; a piece whose harmony never changes scores 0 */
function harmonyCheck(REC) {
  const M = REC.model, m = M.METRES[M.BY_KEY['4/4']];
  const chords = [[48, 0x91], [53, 0x221], [55, 0x884], [45, 0x211]];
  const att = [], slots = [];
  for (let b = 0; b < 16; b++) for (let q = 0; q < 4; q++) {
    const [low, pcs] = chords[b % 4];
    att.push({ low: q % 2 ? low + 12 : low, pcs: pcs | (1 << ((low + 4 * q) % 12)) });
    slots.push((b * 4 + q) * M.R);
  }
  const c0 = M.harmonicContrast(m, slots, att, att.length), c2 = M.harmonicContrast(m, slots.map(s => s - 2 * M.R), att, att.length);
  const flat = M.harmonicContrast(m, slots, att.map(() => ({ low: 48, pcs: 0x91 })), att.length);
  return { name: 'the harmonic rhythm scores the phase whose bar lines are where the chords change', ok: c0 > 0.2 && Math.abs(c0 + c2) < 0.05 && Math.abs(flat) < 1e-12,
    got: 'bar phase ' + c0.toFixed(3) + ', half-bar phase ' + c2.toFixed(3) + ', no change ' + flat.toFixed(3), want: '> 0.2, its negative, 0' };
}

/* the committed model carries the trainer's phase step: three weights (the metre model's score, the harmony, the downbeats; the harmony's
   positive) and the helper gate of rec/tools/train.js CONFIG */
function configCheck(REC) {
  const C = require(path.join(REPO, 'rec', 'tools', 'train.js')).CONFIG, W = REC.loadWeights();
  const ph = W.phase || {};
  const ok = Array.isArray(ph.weights) && ph.weights.length === 3 && ph.weights[0] > 0 && ph.weights[1] > 0 && JSON.stringify(ph.helperGate) === JSON.stringify(C.phase.helperGate);
  return { name: 'the committed model carries the trainer\'s phase step', ok: ok, got: JSON.stringify(ph.weights) + ' ' + JSON.stringify(ph.helperGate), want: '3 weights, harmony > 0, the CONFIG gate' };
}

/* the phase step's candidates (metre.phaseGroup) are exactly the readings of the chosen reading's pulse frame and metre: every phase of it,
   nothing of another metre or frame */
function groupCheck(REC) {
  const W = REC.loadWeights();
  const att = REC.attacks.attacksOf(skeletonInput(pop(8, QPM, { jitter: 0.02, seed: 4 }).notes)), cls = REC.attacks.classes(att);
  const tracks = REC.beats.tracks(att, { tight: W.tight, maxTracks: W.maxTracks });
  const H = REC.metre.hypotheses(att, cls, tracks, W.tables, { sigma: W.sigma, swing: W.swing });
  let bad = 0, n = 0;
  [0, 7, 40, Math.floor(H.list.length / 2), H.list.length - 1].forEach(bi => {
    const g = REC.metre.phaseGroup(H, bi), b = H.list[bi], m = REC.model.METRES[b.mi];
    const want = H.list.filter(h => h.fr === b.fr && h.mi === b.mi).length;
    if (g.length !== want || g.some(i => H.list[i].fr !== b.fr || H.list[i].mi !== b.mi) || want > Math.round(m.barQ / REC.model.PHASE_STEP_Q)) bad++;
    n++;
  });
  return { name: 'the phase step\'s candidates are the phases of one pulse frame and one metre', ok: bad === 0, got: bad + ' of ' + n + ' groups wrong', want: 'none' };
}

function checks(REC) { return [decoupledCheck(REC), laterCheck(REC), helperGateCheck(REC), audioGateCheck(REC), downPhaseCheck(REC), harmonyCheck(REC), configCheck(REC), groupCheck(REC), downWiringCheck(REC), confidenceCheck(REC)]; }

module.exports = { checks, groupCheck, downWiringCheck, confidenceCheck, laterStart, laterCheck, decoupledCheck, helperGateCheck, audioGateCheck, downPhaseCheck, harmonyCheck, configCheck };
