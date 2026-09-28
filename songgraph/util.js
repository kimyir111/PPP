/* ============================================================================
   PPP SongGraph — shared timing/pitch helpers (docs/GOALS/G07 §5)

   beatGrid(g)      every notated beat window across the whole score, in time order:
                    [{m, beat, w0, w1}] (ScorePos Rats), from time.js's own meterAt/groups
                    (G01 §6.4) — the same beat grouping time.metric() uses for a position.
   noteWindows(g, opts) every sounding note across every part (or opts.part), grace notes
                    excluded, as [{w0, w1, pc, midi, partId, voiceId, staff, eventId, headId}],
                    sorted by w0. This is SongGraph's one pass over the graph's notes; every
                    other module (harmony, voices, energy) reads this instead of re-walking
                    g.parts itself.
   pcWeights(notes, w0, w1) the pitch-class histogram (12 numbers) of every note overlapping
                    [w0, w1), weighted by the overlap's length — the "beat window content" G07
                    §5's harmony pass reads.
   overlap(notes, w0, w1) the notes (not just their pitch classes) overlapping [w0, w1).

   None of this re-derives resolveSpan/spanOf/fingerprint/scoreRef (G07 design doc §3, §11) —
   they are not needed here (this module reads notes directly, not spans), but index.js uses
   scoreRef/fingerprint for freshness, per the design doc's plumbing requirement.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/pitch.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.util = factory(SG.rational, SG.time, SG.pitch);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, P) {
  'use strict';

  /* Every notated beat window, in time order. A measure with no time signature in force (invalid input;
     time.metric throws E-METER on it) is treated as one whole-measure beat so this never throws on a graph
     the validator would reject anyway — callers that need a valid graph should validate first. */
  function beatGrid(g) {
    const out = [];
    g.timeline.measures.forEach(m => {
      const start = T.measureStart(g, m.id);
      const dur = R.parse(m.dur);
      let meter = null;
      try { meter = T.meterAt(g, m.id); } catch (e) { meter = null; }
      if (!meter) { out.push({ m: m.id, beat: 0, w0: start, w1: R.add(start, dur) }); return; }
      const gr = T.groups(meter);
      let acc = R.ZERO;
      gr.forEach((size, bi) => {
        const w0 = R.add(start, acc);
        acc = R.add(acc, size);
        out.push({ m: m.id, beat: bi, w0: w0, w1: R.add(start, acc) });
      });
    });
    return out;
  }

  /* Every sounding, non-grace note across the parts (or one part, opts.part), sorted by onset then end. */
  function noteWindows(g, opts) {
    opts = opts || {};
    const out = [];
    g.parts.forEach(part => {
      if (opts.part && part.id !== opts.part) return;
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        const w0 = T.scorePos(g, e);
        const w1 = R.add(w0, R.parse(e.dur));
        (e.heads || []).forEach(h => {
          if (!h.pitch) return;
          out.push({
            w0: w0, w1: w1, pc: ((P.midi(h.pitch) % 12) + 12) % 12, midi: P.midi(h.pitch),
            partId: part.id, voiceId: e.voice, staff: h.staff || e.staff, eventId: e.id, headId: h.id, m: e.m
          });
        });
      });
    });
    out.sort((a, b) => R.cmp(a.w0, b.w0) || R.cmp(a.w1, b.w1));
    return out;
  }

  /* The notes (already sorted by noteWindows) overlapping [w0, w1): w0e < w1 and w1e > w0. */
  function overlap(notes, w0, w1) {
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (R.ge(n.w0, w1)) break; /* sorted by w0: nothing further starts before w1 */
      if (R.gt(n.w1, w0)) out.push(n);
    }
    return out;
  }

  /* The pitch-class histogram of [w0, w1), each note weighted by how much of it overlaps the window (in W,
     as a plain number — exact enough for a weighting, not stored). */
  function pcWeights(notes, w0, w1) {
    const h = new Array(12).fill(0);
    overlap(notes, w0, w1).forEach(n => {
      const a = R.gt(n.w0, w0) ? n.w0 : w0;
      const b = R.lt(n.w1, w1) ? n.w1 : w1;
      const len = R.toNumber(R.sub(b, a));
      if (len > 0) h[n.pc] += len;
    });
    return h;
  }

  /* The notes sounding at an exact instant w (w0 <= w < w1); notes must be sorted by w0 (noteWindows'
     order). Used where a caller needs "what's playing right now", not a window's aggregate content. */
  function soundingAt(notes, w) {
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (R.gt(n.w0, w)) break;
      if (R.gt(n.w1, w)) out.push(n);
    }
    return out;
  }

  return Object.freeze({ beatGrid, noteWindows, overlap, pcWeights, soundingAt });
});
