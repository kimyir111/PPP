/* ============================================================================
   PPP SongGraph — harmony per beat window (docs/GOALS/G07 §5 "harmony per beat window")

   fitChord(hist) -> {root (0-11, pc), quality, score, pcs}: the best-fitting chord for a 12-bin
   pitch-class weight histogram, scored as (weight of its own tones) − OUT × (weight of everything
   else) − a small per-tone size bias (so a triad beats a seventh unless the extra tone earns its
   keep) − a small bass-agreement bonus (a tie-breaker only: real ties are rare and it never
   overturns a clear pitch-class-coverage winner, see the constants below).

   harmonyOf(g, opts) -> [{m, beat, w0, w1, root, quality, score, conf}], one entry per
   util.beatGrid(g) window, fit against the duration-weighted pitch-class content of every part
   (opts.part restricts to one). `conf` is the winning score's margin over the runner-up, scaled
   into 0..1 (a proxy for "how much better the pick fit than the next-best guess" — not a
   probability).

   Ground truth (G07 design doc §4): hymn SATB. That comparison lives in
   tests/songgraph/hymn-corpus.test.js, not here — this module reads a ScoreGraph the same way
   for every corpus stratum, hymn or not, and does not know what a "voice 1/6" convention means
   (that is hymn-specific ground-truth-extraction logic, kept out of the analyzer itself).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('./util.js'));
  } else {
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    root.PPPSongGraphModules.harmony = factory(root.PPPScoreGraphModules.rational, M.util);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, U) {
  'use strict';

  /* Root-relative semitone sets. Kept to the common triads/sevenths a hymn or method-book piece
     actually writes — no altered/extended jazz vocabulary, since G07 is symbolic-corpus harmony,
     not audio transcription (no ground truth here would exercise anything richer). */
  const QUALITIES = Object.freeze([
    { name: 'maj', iv: [0, 4, 7] },
    { name: 'min', iv: [0, 3, 7] },
    { name: 'dim', iv: [0, 3, 6] },
    { name: 'aug', iv: [0, 4, 8] },
    { name: 'dom7', iv: [0, 4, 7, 10] },
    { name: 'maj7', iv: [0, 4, 7, 11] },
    { name: 'min7', iv: [0, 3, 7, 10] },
    { name: 'm7b5', iv: [0, 3, 6, 10] },
    { name: 'dim7', iv: [0, 3, 6, 9] }
  ]);
  const OUT = 1.1;          /* weight charged per unit of hist mass outside the chord */
  const SIZE_BIAS = 0.06;   /* per extra chord tone (a triad needs a 4th tone's weight to beat it) */
  const BASS_BONUS = 0.02;  /* tie-breaker only: root pc equal to the window's lowest-sounding pc */

  function totalOf(hist) { return hist.reduce((a, b) => a + b, 0); }

  /* The best-fitting {root, quality, score} for a pitch-class weight histogram (12 numbers), plus the
     runner-up's score (for a confidence margin). bassPc (optional) only nudges a genuine near-tie. */
  function fitChord(hist, bassPc) {
    const total = totalOf(hist);
    let best = null, second = -Infinity;
    for (let r = 0; r < 12; r++) {
      QUALITIES.forEach(q => {
        let inW = 0;
        q.iv.forEach(iv => { inW += hist[(r + iv) % 12]; });
        const outW = total - inW;
        let score = inW - OUT * outW - SIZE_BIAS * q.iv.length;
        if (bassPc !== undefined && bassPc === r) score += BASS_BONUS;
        if (!best || score > best.score) { second = best ? best.score : second; best = { root: r, quality: q.name, score: score, iv: q.iv }; }
        else if (score > second) second = score;
      });
    }
    if (!best) return null;
    const margin = best.score - second;
    /* squashed into 0..1: no theoretical ceiling on the margin, so this is a monotone proxy, not a
       calibrated probability (documented in the module header) */
    const conf = margin <= 0 ? 0 : margin / (margin + 1);
    return { root: best.root, quality: best.quality, score: Math.round(best.score * 1000) / 1000, conf: Math.round(conf * 1000) / 1000, pcs: best.iv.map(iv => (best.root + iv) % 12).sort((a, b) => a - b) };
  }

  function lowestPc(notes, w0, w1) {
    const here = U.overlap(notes, w0, w1);
    if (!here.length) return undefined;
    let lo = here[0];
    here.forEach(n => { if (n.midi < lo.midi) lo = n; });
    return lo.pc;
  }

  /* One chord fit per beat window of the whole score (or one part). Silent windows (no sounding pitch
     content at all) are reported with root/quality null rather than guessing. */
  function harmonyOf(g, opts) {
    opts = opts || {};
    const notes = U.noteWindows(g, opts);
    const grid = U.beatGrid(g);
    return grid.map(w => {
      const hist = U.pcWeights(notes, w.w0, w.w1);
      if (totalOf(hist) <= 0) return { m: w.m, beat: w.beat, w0: w.w0, w1: w.w1, root: null, quality: null, score: 0, conf: 0, pcs: [] };
      const fit = fitChord(hist, lowestPc(notes, w.w0, w.w1));
      return Object.assign({ m: w.m, beat: w.beat, w0: w.w0, w1: w.w1 }, fit);
    });
  }

  return Object.freeze({ QUALITIES, fitChord, harmonyOf });
});
