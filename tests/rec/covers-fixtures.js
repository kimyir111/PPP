/* Synthetic pieces shaped like the covers users record (G10a-1b, docs/GOALS/G10_AUDIO_TO_SCORE.md section 28), and the checks
   of the time skeleton on them, shared by skeleton-covers.test.js and its mutation test: long performances (three to four
   minutes: the per-beat evidence cap) and swung eighths (the swung frames of the simple metres). */
'use strict';
const path = require('path');
const { REPO, perform, march, jig, waltz, skeletonInput } = require('./helpers.js');

/* a pop-like 4/4 bar: a bass octave on 1 and 3, chords on 2 and 4, a line in eighths above */
function popBar(r) {
  return [[0, [r, r + 24], 1], [0.5, [r + 28], 0.5], [1, [r + 16, r + 19, r + 31], 0.5], [1.5, [r + 31], 0.5], [2, [r + 7, r + 24], 1],
    [2.5, [r + 26], 0.5], [3, [r + 16, r + 19, r + 28], 0.5], [3.5, [r + 24], 0.5]];
}
function pop(bars, qpm, opts) {
  const roots = [48, 53, 55, 48, 45, 50, 55, 48], out = { notes: [] };
  for (let b = 0; b < bars; b++) {
    const p = perform(popBar(roots[b % 8]), 4, 1, qpm, Object.assign({}, opts, { start: 1 + b * 4 * 60 / qpm, seed: (opts.seed || 1) + b }));
    out.notes.push(...p.notes);
  }
  return out;
}
/* an off-beat eighth before the first bar line (the bars still start at 1 s) */
function withPickup(p, qpm) {
  const spq = 60 / qpm;
  return { notes: [{ on: Math.round((1 - 0.5 * spq) * 1000) / 1000, off: Math.round((1 - 0.1 * spq) * 1000) / 1000, midi: 72, vel: 64 }].concat(p.notes) };
}
/* every quarter's second eighth heard at s of the quarter, everything inside the quarter moved with it (the humanizer's
   swing map, pppbench/humanize.py _swing_map); start = the first bar line in seconds */
function swung(p, qpm, s, start) {
  const spq = 60 / qpm;
  const warp = t => { const q = (t - start) / spq, b = Math.floor(q), u = q - b; return start + (b + (u < 0.5 ? u * 2 * s : s + (u - 0.5) * 2 * (1 - s))) * spq; };
  return { notes: p.notes.map(n => Object.assign({}, n, { on: Math.round(warp(n.on) * 1000) / 1000, off: Math.round(warp(n.off) * 1000) / 1000 })) };
}

const near = (a, b) => Math.abs(Math.log(a / b)) < Math.log(1.04);
/* the cases: [name, metre, quarter tempo, performance, swung? (true, false, or null: a piece without off-beat eighths cannot tell)] */
function cases() {
  return [
    ['march, 96 bars (230 s)', '4/4', 100, march(96, 100, { jitter: 0.02, seed: 3 }), null],
    ['waltz, 96 bars (144 s)', '3/4', 120, waltz(96, 120, { jitter: 0.02, seed: 5 }), null],
    ['jig, 96 bars (192 s)', '6/8', 90, jig(96, 90, { jitter: 0.02, seed: 9 }), null],
    ['pop, 32 bars', '4/4', 120, pop(32, 120, { jitter: 0.02, seed: 4 }), false],
    ['pop swung, 8 bars', '4/4', 120, swung(pop(8, 120, { jitter: 0.02, seed: 4 }), 120, 0.65, 1), true],
    ['pop swung, 32 bars', '4/4', 120, swung(pop(32, 120, { jitter: 0.02, seed: 4 }), 120, 0.65, 1), true],
    ['pop swung, 96 bars', '4/4', 120, swung(pop(96, 120, { jitter: 0.02, seed: 4 }), 120, 0.65, 1), true]
  ];
}
/* a known limit (G10 section 28.8): a straight pop bar played 96 bars is read 6/8 at quarter 60 (the two readings both past the beat cap,
   0.11 nats apart: the means decide, and the coarse reading's few beats are cleaner) */
function knownLimits() {
  return [['pop, 96 bars (192 s)', '4/4', 120, pop(96, 120, { jitter: 0.02, seed: 4 }), false]];
}
/* every case through a rec/index.js (the repository's, or a mutated copy's): [{name, ok, got}] */
function check(REC, list) {
  return (list || cases()).map(([name, metre, qpm, p, sw]) => {
    const sk = REC.skeleton(skeletonInput(p.notes), {});
    const got = sk ? sk.metre.key + ' at ' + Math.round(sk.qpm) + (sk.report.chosen.swing ? ', swung' : ', straight') + ', first bar line ' + sk.beats[0].toFixed(2) + ' s' : 'none';
    /* a bar line where the music's bars start (every case's first bar line is at 1 s) */
    const per = sk ? (sk.metre.compound ? sk.metre.beats / 3 : sk.metre.beats) : 1;
    const barLine = !!sk && sk.beats.some((t, i) => i % per === 0 && Math.abs(t - 1) < 0.06);
    const ok = !!sk && sk.metre.key === metre && near(sk.qpm, qpm) && barLine && (sw === null || !!sk.report.chosen.swing === sw);
    return { name: name, ok: ok, got: got, want: metre + ' at ' + qpm + (sw === null ? '' : sw ? ', swung' : ', straight') };
  });
}

/* the swung readings of a rec/index.js's metre stage: each on the quarter phase of its frame (a reading whose bar phase is an odd
   eighth takes the frame whose quarters start half a beat later), and some on each phase; as a case of check()'s shape */
function phaseCheck(REC) {
  const W = REC.loadWeights();
  const att = REC.attacks.attacksOf(skeletonInput(swung(pop(8, 120, { jitter: 0.02, seed: 4 }), 120, 0.65, 1).notes));
  const tracks = REC.beats.tracks(att, { tight: W.tight, maxTracks: W.maxTracks });
  const H = REC.metre.hypotheses(att, REC.attacks.classes(att), tracks, W.tables, { sigma: W.sigma, swing: W.swing });
  const R = REC.model.R, sw = H.list.filter(h => h.swing);
  const bad = sw.filter(h => Math.round(h.phi * R) % R !== H.frames[h.fr].swing.o).length;
  const odd = sw.filter(h => Math.round(h.phi * R) % R === R / 2).length;
  return { name: 'swung readings on their frames\' quarter phases', ok: sw.length > 0 && bad === 0 && odd > 0, got: sw.length + ' swung, ' + bad + ' off phase, ' + odd + ' on odd eighths', want: 'none off phase, some on odd eighths' };
}

module.exports = { REPO, pop, popBar, swung, withPickup, cases, knownLimits, check, phaseCheck, near, skeletonInput, path };
