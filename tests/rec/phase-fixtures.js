/* The checks of G10a-1d (docs/GOALS/G10_AUDIO_TO_SCORE.md section 36): the bar phase from the notes (the harmonic rhythm, the
   metrical pulse levels) and from the helper's beats (the downbeats as phase evidence only, an audio beat track that is one pulse).
   Shared by skeleton-phase.test.js and the mutation test of the skeleton (skeleton-covers-mutation.test.js): every check returns
   { name, ok, got, want } and takes a rec/index.js (the repository's, or a mutated copy's). Synthetic music only. */
'use strict';
const { skeletonInput } = require('./helpers.js');
const { pop } = require('./covers-fixtures.js');

/* pop(32, 120) has its bar lines at 1 + 2k s and quarters every 0.5 s */
const BARS = 32, QPM = 120, SPQ = 0.5;
const beatsEvery = (n, from) => { const o = []; for (let k = 0; k < n; k++) o.push(Math.round((from + k * SPQ) * 1e4) / 1e4); return o; };

/* the helper's downbeats never choose the metre or the tempo: at every bar, at every half bar (Beat This on pop), every three beats
   (one real cover), or none, a 4/4 pop piece stays 4/4 at 120 */
function downMetreCheck(REC) {
  const notes = skeletonInput(pop(BARS, QPM, { jitter: 0.02, seed: 4 }).notes);
  const beats = beatsEvery(BARS * 4 + 1, 1);
  const variants = [['none', null], ['bars', beats.filter((t, i) => i % 4 === 0)], ['half bars', beats.filter((t, i) => i % 2 === 0)], ['three beats', beats.filter((t, i) => i % 3 === 0)]];
  const sks = variants.map(([name, downs]) => REC.skeleton(notes, downs ? { beats: beats, downbeats: downs } : {}));
  const got = variants.map(([name], i) => name + ': ' + (sks[i] ? sks[i].metre.key + ' at ' + Math.round(sks[i].qpm) : 'none'));
  const ok = sks.every(sk => sk && sk.metre.key === '4/4' && Math.abs(Math.log(sk.qpm / QPM)) < Math.log(1.04));
  return { name: 'the helper\'s downbeats never choose the metre or the tempo', ok: ok, got: got.join('; '), want: '4/4 at 120 in every case' };
}

/* the downbeats as phase evidence (the feature `down` of a model with downPhase): at the bar lines they favour phase 0 over every other
   phase; at every half bar they leave phase 0 and the half-bar phase alike and count against the others */
function downPhaseCheck(REC) {
  const W = REC.loadWeights();
  const att = REC.attacks.attacksOf(skeletonInput(pop(8, QPM, { jitter: 0.01, seed: 4 }).notes)), cls = REC.attacks.classes(att);
  const beats = beatsEvery(8 * 4 + 1, 1);
  const tr = REC.beats.audioTrack(beats, att);
  const M = REC.model, mi = M.BY_KEY['4/4'], F = M.FEATURES.length, fv = new Float64Array(F), D = M.FEATURES.indexOf('down');
  const at = (downs, phi) => {
    const fr = M.frame(att, cls, tr, 1, W.sigma, downs);
    fr.downPhase = true;
    M.features(fr, mi, phi, W.tables, fv, false);
    return fv[D];
  };
  const bars = beats.filter((t, i) => i % 4 === 0), halves = beats.filter((t, i) => i % 2 === 0);
  /* the four quarter phases of the track (phi counts quarters from the track's first beat, which need not be a bar line) */
  const b = [0, 1, 2, 3].map(p => at(bars, p)), h = [0, 1, 2, 3].map(p => at(halves, p));
  const top = b.indexOf(0), sorted = b.slice().sort((x, y) => x - y);
  const okBars = top >= 0 && sorted[2] < -0.5;                                         /* one phase at 0, the three others far below */
  const okHalf = Math.abs(h[top] - h[(top + 2) % 4]) < 0.05 && h[(top + 1) % 4] < -0.15 && h[(top + 3) % 4] < -0.15 && h[top] > -0.05;
  return { name: 'downbeats are phase evidence: on the bar lines they pick the phase; at half bars they leave the two half-bar phases alike', ok: okBars && okHalf,
    got: 'bars ' + b.map(x => x.toFixed(2)).join(' ') + ' | half bars ' + h.map(x => x.toFixed(2)).join(' '), want: 'bars: one 0, three < -0.5; half bars: that phase and the one two beats on alike near 0, the others < -0.15' };
}

/* an audio beat track that changes its pulse level is not read (the weights' audioMaxIrregular); a regular one with a few missed beats is */
function audioGateCheck(REC) {
  const W = REC.loadWeights();
  const att = [{ t: 1 }, { t: 60 }];
  const regular = beatsEvery(120, 1).filter((t, i) => i % 23 !== 7);
  /* half a minute at the quarter, then forty beats a dotted quarter apart (the tracker's level changed) */
  const levels = beatsEvery(60, 1).concat(Array.from({ length: 40 }, (x, k) => Math.round((31 + k * 0.75) * 1e4) / 1e4));
  const o = W.audioMaxIrregular != null ? { maxIrregular: W.audioMaxIrregular } : null;
  if (o) o.maxExtra = W.audioMaxExtra;
  /* ... and one with a beat too many every 20 beats (each shifts every later beat by one) */
  const extras = beatsEvery(120, 1).reduce((acc, t, i) => acc.concat(i % 20 === 10 ? [t, Math.round((t + 0.15) * 1e4) / 1e4] : [t]), []);
  const a = REC.beats.audioTrack(regular, att, o), b = REC.beats.audioTrack(levels, att, o), c = REC.beats.audioTrack(extras, att, o);
  return { name: 'an audio beat track that changes its pulse level or adds beats is not read; a regular one with missed beats is', ok: !!a && !b && !c && W.audioMaxIrregular > 0,
    got: 'regular ' + (a ? 'read' : 'refused') + ', two levels ' + (b ? 'read' : 'refused') + ', extra beats ' + (c ? 'read' : 'refused'), want: 'regular read, the others refused' };
}

/* a reading tracks a metrical level of its metre (the weights' metricalRho): no 4/4 reading on a pulse of three quarters, a dotted quarter
   or two thirds of a quarter; no 6/8 reading on a quarter */
function metricalCheck(REC) {
  const W = REC.loadWeights();
  const att = REC.attacks.attacksOf(skeletonInput(pop(8, QPM, { jitter: 0.02, seed: 4 }).notes)), cls = REC.attacks.classes(att);
  const tracks = REC.beats.tracks(att, { tight: W.tight, maxTracks: W.maxTracks });
  const H = REC.metre.hypotheses(att, cls, tracks, W.tables, { sigma: W.sigma, swing: W.swing, metricalRho: !!W.metricalRho });
  const M = REC.model;
  const bad = H.list.filter(h => (M.METRES[h.mi].key === '4/4' && [3, 1.5, 2 / 3].indexOf(h.rho) >= 0) || (M.METRES[h.mi].key === '6/8' && h.rho === 1)).length;
  const good = H.list.filter(h => M.METRES[h.mi].key === '4/4' && [0.5, 1, 2, 4].indexOf(h.rho) >= 0).length;
  return { name: 'a reading tracks a metrical level of its metre', ok: !!W.metricalRho && bad === 0 && good > 0, got: bad + ' non-metrical readings, ' + good + ' metrical 4/4 ones', want: 'none, some' };
}

/* the harmonic rhythm (model.harmonicContrast): chords that change at every bar line score the bar's phase above its half-bar phase, by
   the same amount the other way; a piece whose harmony never changes scores 0 */
function harmonyCheck(REC) {
  const M = REC.model, m = M.METRES[M.BY_KEY['4/4']];
  const chords = [[48, 0x91], [53, 0x221], [55, 0x884], [45, 0x211]];      /* C, F, G, Am as pitch-class masks with their bass */
  const att = [], slots = [];
  for (let b = 0; b < 16; b++) for (let q = 0; q < 4; q++) {
    const [low, pcs] = chords[b % 4];
    att.push({ low: q % 2 ? low + 12 : low, pcs: pcs | (1 << ((low + 4 * q) % 12)) });
    slots.push((b * 4 + q) * M.R);
  }
  const c0 = M.harmonicContrast(m, slots, att, att.length), c2 = M.harmonicContrast(m, slots.map(s => s - 2 * M.R), att, att.length);
  const flat = M.harmonicContrast(m, slots, att.map(a => ({ low: 48, pcs: 0x91 })), att.length);
  const ok = c0 > 0.2 && Math.abs(c0 + c2) < 0.05 && Math.abs(flat) < 1e-12;
  return { name: 'the harmonic rhythm scores the phase whose bar lines are where the chords change', ok: ok,
    got: 'bar phase ' + c0.toFixed(3) + ', half-bar phase ' + c2.toFixed(3) + ', no change ' + flat.toFixed(3), want: '> 0.2, its negative, 0' };
}

/* the committed model carries the trainer's G10a-1d configuration (rec/tools/train.js CONFIG): downbeats as phase, metrical pulses, the
   audio track's gate, and no weight for standing on the helper's beat track */
function configCheck(REC) {
  const C = require(require('path').join(require('./helpers.js').REPO, 'rec', 'tools', 'train.js')).CONFIG, W = REC.loadWeights();
  const audio = W.weights[REC.model.FEATURES.indexOf('audio')], hbar = W.weights[REC.model.FEATURES.indexOf('hbar')];
  const ok = !!W.downPhase === !!C.downPhase && !!W.metricalRho === !!C.metricalRho && W.audioMaxIrregular === C.audioMaxIrregular && W.audioMaxExtra === C.audioMaxExtra &&
    C.downPhase && hbar > 0;
  return { name: 'the committed model carries the trainer\'s G10a-1d configuration', ok: ok,
    got: JSON.stringify({ downPhase: W.downPhase, metricalRho: W.metricalRho, audioMaxIrregular: W.audioMaxIrregular, audioMaxExtra: W.audioMaxExtra, audio: audio, hbar: hbar }), want: 'as CONFIG, hbar > 0' };
}

/* a 4/4 pop piece whose recording starts 1, 2 or 3 beats into a bar (an intro, a pickup, a cut): its bar lines stay where its chords
   change (the first full bar at 3 s), not on the first onset. ai5a v1.1 put them on the first onset in all of these (G10 section 36) */
function laterStart(bars, cut, seed) {
  return { notes: pop(bars, QPM, { jitter: 0.02, seed: seed }).notes.filter(n => n.on >= 1 + cut * SPQ - 0.03) };
}
function laterCheck(REC, list) {
  const got = (list || [[16, 1], [16, 2], [16, 3], [32, 1], [32, 2], [32, 3]]).map(([bars, cut]) => {
    const sk = REC.skeleton(skeletonInput(laterStart(bars, cut, 4).notes), {});
    const ok = !!sk && sk.metre.key === '4/4' && Math.abs(Math.log(sk.qpm / QPM)) < Math.log(1.04) && sk.beats.some((t, i) => i % 4 === 0 && Math.abs(t - 3) < 0.06);
    return { ok: ok, s: bars + ' bars from beat ' + (cut + 1) + ': ' + (sk ? sk.metre.key + ' at ' + Math.round(sk.qpm) + ', bar line at ' + sk.beats[0].toFixed(2) + ' s' : 'none') + (ok ? '' : ' WRONG') };
  });
  return { name: 'a piece that starts inside a bar keeps its bar lines where the chords change', ok: got.every(g => g.ok), got: got.map(g => g.s).join('; '), want: '4/4 at 120 with a bar line at 3 s' };
}

/* standing on the helper's beat track (feature audio) counts for a reading whose bar holds two of its beats or more, not for one that makes
   each of its beats a bar (3/8 at one and a half times the tempo: two real covers before this rule) */
function audioBarCheck(REC) {
  const W = REC.loadWeights();
  const att = REC.attacks.attacksOf(skeletonInput(pop(8, QPM, { jitter: 0.01, seed: 4 }).notes)), cls = REC.attacks.classes(att);
  const beats = beatsEvery(8 * 4 + 1, 1);
  const tr = REC.beats.audioTrack(beats, att), M = REC.model, fv = new Float64Array(M.FEATURES.length), A = M.FEATURES.indexOf('audio');
  const at = (key, rho) => { const fr = M.frame(att, cls, tr, rho, W.sigma, beats.filter((t, i) => i % 2 === 0)); fr.downPhase = true; M.features(fr, M.BY_KEY[key], 0, W.tables, fv, false); return fv[A]; };
  const four = at('4/4', 1), three8 = at('3/8', 1.5), two = at('2/4', 1);
  return { name: 'the helper\'s beat track counts for a reading whose bar holds two of its beats or more', ok: four === 1 && two === 1 && three8 === 0,
    got: '4/4 ' + four + ', 2/4 ' + two + ', 3/8 one beat a bar ' + three8, want: '1, 1, 0' };
}

function checks(REC) { return [downMetreCheck(REC), downPhaseCheck(REC), audioGateCheck(REC), metricalCheck(REC), harmonyCheck(REC), configCheck(REC), laterCheck(REC), audioBarCheck(REC)]; }

module.exports = { checks, audioBarCheck, laterStart, laterCheck, downMetreCheck, downPhaseCheck, audioGateCheck, metricalCheck, harmonyCheck, configCheck };
