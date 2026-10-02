/* Shared helpers of the rec/ tests (G10a-1): synthetic performances whose metre, tempo and bar lines are known. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

/* a deterministic LCG (no Math.random in tests) */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* A performance of `bars` bars of a pattern: pattern = [[beat position in quarters, midis[], length in quarters], ...]
   per bar (positions from the bar line), at `qpm` quarters a minute, starting at `start` seconds, with up to +-jitter
   seconds of timing noise per attack (all notes of an attack move together). */
function perform(pattern, barQ, bars, qpm, opts) {
  opts = opts || {};
  const spq = 60 / qpm, start = opts.start == null ? 1 : opts.start, rnd = lcg(opts.seed || 1), jit = opts.jitter || 0;
  const notes = [];
  for (let b = 0; b < bars; b++) {
    pattern.forEach(([q, midis, len], i) => {
      const t = start + (b * barQ + q) * spq + (jit ? (rnd() * 2 - 1) * jit : 0);
      const vel = opts.accent && q === 0 ? 80 : 64;
      midis.forEach(m => notes.push({ on: Math.round(t * 1000) / 1000, off: Math.round((t + len * spq * 0.95) * 1000) / 1000, midi: m, vel: vel }));
    });
  }
  return { notes: notes, barStarts: Array.from({ length: bars + 1 }, (_, b) => start + b * barQ * spq) };
}

/* the patterns of a few metres: a bass note on the downbeat (and a new harmony each bar), lighter chords after it */
function harmonies(i) { const roots = [48, 53, 55, 48, 45, 50, 55, 48]; return roots[i % roots.length]; }
function waltz(bars, qpm, opts) {      /* 3/4: bass, chord, chord */
  const out = { notes: [], barStarts: [] };
  for (let b = 0; b < bars; b++) {
    const r = harmonies(b);
    const p = perform([[0, [r], 1], [1, [r + 16, r + 19], 1], [2, [r + 16, r + 19], 1]], 3, 1, qpm, Object.assign({}, opts, { start: (opts && opts.start || 1) + b * 3 * 60 / qpm, seed: (opts && opts.seed || 1) + b }));
    out.notes.push(...p.notes);
  }
  return out;
}
function march(bars, qpm, opts) {      /* 4/4: half-note bass on 1 and 3 (a new harmony on 1), quarter chords */
  const out = { notes: [] };
  for (let b = 0; b < bars; b++) {
    const r = harmonies(b);
    const p = perform([[0, [r, r + 16, r + 19, r + 24], 2], [1, [r + 19], 1], [2, [r + 7, r + 16], 1], [3, [r + 19, r + 23], 1]], 4, 1, qpm,
      Object.assign({}, opts, { start: (opts && opts.start || 1) + b * 4 * 60 / qpm, seed: (opts && opts.seed || 1) + b }));
    out.notes.push(...p.notes);
  }
  return out;
}
function jig(bars, qpm, opts) {        /* 6/8 as the catalogue writes it: running eighths, a bass note on each dotted-quarter beat */
  const out = { notes: [] };
  for (let b = 0; b < bars; b++) {
    const r = harmonies(b);
    const p = perform([[0, [r, r + 24], 1.5], [0.5, [r + 28], 0.5], [1, [r + 31], 0.5], [1.5, [r + 7, r + 24], 1.5], [2, [r + 28], 0.5], [2.5, [r + 31], 0.5]], 3, 1, qpm,
      Object.assign({}, opts, { start: (opts && opts.start || 1) + b * 3 * 60 / qpm, seed: (opts && opts.seed || 1) + b }));
    out.notes.push(...p.notes);
  }
  return out;
}

/* what audio-score.js gives rec/: clean() and clusterNotes() */
function skeletonInput(notes) {
  const AS = require(path.join(REPO, 'audio-score.js'));
  const ATT = require(path.join(REPO, 'rec', 'attacks.js'));
  return AS._.clusterNotes(ATT.cleanNotes(notes));
}

module.exports = { REPO, lcg, perform, waltz, march, jig, skeletonInput };
