/* ============================================================================
   PPP Critics — voice-leading smells (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §4).

   One of G9a's two NEW critics (the other five are promoted from G8a's harness, see
   critics/metrics.js). Checked first, per the design doc's instruction, whether anything
   already computed in this codebase covers this: `scoregraph/pro-voice.js` only cleans up
   second-voice rests/placement (G3's engraving pass, `may: ['place','rests','pieces',
   'tuplets','beams']` - no pitch-relationship check at all); `songgraph/voices.js` only
   scores which voice is melody/bass/inner by top/bottom-of-texture FREQUENCY
   (`melodyBassOf`/`voiceRolesOf`) - a role classification, not a smell detector. Neither
   computes parallel motion, leap size, or crossing. This module is genuinely new, built
   directly on `songgraph/util.js`'s existing `noteWindows` (read-only reuse, the same
   onset-slicing primitive `songgraph/voices.js`'s own `perPartVoiceStats` already uses)
   and `songgraph/voices.js`'s `perPartVoiceStats` (for each voice's whole-piece average
   register, used only to decide which of a simultaneous pair is the "expected" upper
   voice for crossing detection - not re-deriving melody/bass roles).

   voiceLeadingSmells(g) -> { parallels, innerLeaps, crossings, count }
     parallels   consecutive-slice parallel perfect fifths/octaves between the OUTER
                 voices (the highest- and lowest-sounding pitch at each onset slice,
                 whichever real voice happens to carry them - a candidate's melody can
                 move to the alto register in a thin texture, so tracking by CURRENT
                 register rather than by a fixed voice id is the textbook definition:
                 "soprano" and "bass" name the outer lines, not one fixed part).
     innerLeaps  a leap larger than LARGE_LEAP semitones between two consecutive notes
                 of the SAME voice id, where NEITHER endpoint was an outer voice at its
                 own onset (a melody or bass line is allowed to leap; an inner/
                 accompaniment voice leaping like one is the smell).
     crossings   two different voices of the SAME part sounding at the same onset whose
                 relative pitch order is reversed from that voice pair's own whole-piece
                 average order (voiceRolesOf's own real avgMidi, not a fixed staff/label
                 convention - G8a's own voice-to-hand assignment is by real average
                 register too, arrangement/plan.js's planSection, so this is the same
                 idea applied within a hand/part instead of across hands).

   Deterministic: no randomness, iteration order fixed by w0 (score position, exact
   rational comparison via scoregraph/rational.js) then voice/part id string order. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../songgraph/util.js'), require('../songgraph/voices.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.voiceLeading = factory(SG.rational, SGG.util, SGG.voices);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, U, VOICES) {
  'use strict';

  const LARGE_LEAP = 12; /* semitones: more than an octave between two consecutive notes
    of what should be a smoothly-moving inner voice - a declared threshold (an octave is
    the textbook "still acceptable, watch closer" line for an inner voice; anything past
    it is the smell this critic flags), not a value tuned against any specific corpus. */
  const PERFECT = new Set([0, 7]); /* mod-12 interval class: unison/octave, perfect fifth */

  /* Every part's real notes, grouped into onset "slices" by exact score position (w0),
     across the WHOLE graph (not per part) for parallels/leaps (the outer voices of a
     two-hand piano candidate span both parts' worth of staves in the SAME `part` object
     G8a's realize() builds - one `Piano` part, two staves - so a single part-wide pass is
     correct here, unlike voiceRolesOf's own per-part scoring which intentionally treats
     each `part` as one texture). */
  function slicesFromNotes(notes) {
    const byOnset = new Map();
    notes.forEach(n => {
      const k = R.format(n.w0);
      if (!byOnset.has(k)) byOnset.set(k, { w0: n.w0, notes: [] });
      byOnset.get(k).notes.push(n);
    });
    return Array.from(byOnset.values()).sort((a, b) => R.cmp(a.w0, b.w0));
  }
  function slicesOf(g) { return slicesFromNotes(U.noteWindows(g)); }

  function outerOf(slice) {
    /* the highest and lowest attacking pitch of a slice; a lone note is BOTH (hi === lo), which is
       what `innerVoiceLeaps` needs: a lone melody or lone bass note is still an OUTER voice there
       (exempt from the inner-leap smell), exactly as in G9a. */
    if (!slice.notes.length) return null;
    let hi = -Infinity, lo = Infinity;
    slice.notes.forEach(n => { if (n.midi > hi) hi = n.midi; if (n.midi < lo) lo = n.midi; });
    return { w0: slice.w0, hi: hi, lo: lo };
  }

  /* the outer PAIR, for parallel-motion detection only: two outer voices need at least two
     attacking notes (a one-note slice has no pair - hi === lo is one voice, not a unison between
     two), so it returns null. G9b correction (docs/GOALS/G09 section 12 "G9b - repair"): G9a counted
     a lone melody note moving stepwise as a "parallel unison/octave" at every step of any texture
     whose other hand was resting or sustaining, inflating the count by orders of magnitude. The
     correction applies to parallels ONLY; an earlier G9b draft put it in outerOf and so also made a
     lone bass/melody note an INNER voice for the leap smell (reviewer-found regression). */
  function outerPairOf(slice) {
    if (slice.notes.length < 2) return null;
    return outerOf(slice);
  }

  /* Consecutive-slice parallel perfect 5ths/8ves between the two outer voices: both slices
     read the SAME perfect interval class, BOTH outer voices actually move (oblique motion
     - one voice holding while the other moves - is not "parallel motion"), and they move
     in the SAME direction (similar motion; contrary motion into/out of a perfect interval
     is the textbook-approved way to reach one, not a smell). */
  function parallelFifthsOctaves(slices) {
    const outer = slices.map(outerPairOf);
    const found = [];
    for (let i = 1; i < outer.length; i++) {
      const a = outer[i - 1], b = outer[i];
      if (!a || !b) continue;
      const ivA = ((a.hi - a.lo) % 12 + 12) % 12;
      const ivB = ((b.hi - b.lo) % 12 + 12) % 12;
      if (!PERFECT.has(ivA) || !PERFECT.has(ivB) || ivA !== ivB) continue;
      const sopranoMove = b.hi - a.hi, bassMove = b.lo - a.lo;
      if (sopranoMove === 0 || bassMove === 0) continue; /* oblique - not parallel */
      if (Math.sign(sopranoMove) !== Math.sign(bassMove)) continue; /* contrary - fine */
      found.push({
        w0: R.format(b.w0), interval: ivA === 0 ? 'octave/unison' : 'fifth',
        from: { hi: a.hi, lo: a.lo }, to: { hi: b.hi, lo: b.lo }
      });
    }
    return found;
  }

  /* A leap > LARGE_LEAP between two consecutive real notes of the SAME voice id, counted
     only when NEITHER endpoint was the outer (melody/bass) voice at its own onset - a
     voice that is genuinely inner/accompaniment for both notes of the leap. A voice that
     is outer at one endpoint and inner at the other is a real register handoff (a texture
     thinning/thickening at a section boundary, G8a's own `structuralFallback`/
     `hymnHandsReachable` downgrades produce exactly this) - not counted, since it is not
     "an inner voice leaping like a melody," it is a voice CEASING to be inner. */
  function innerVoiceLeaps(slices) {
    const byVoice = new Map();
    slices.forEach(slice => {
      const outer = outerOf(slice);
      slice.notes.forEach(n => {
        if (!byVoice.has(n.voiceId)) byVoice.set(n.voiceId, []);
        byVoice.get(n.voiceId).push({ w0: n.w0, midi: n.midi, outer: outer && (n.midi === outer.hi || n.midi === outer.lo) });
      });
    });
    const found = [];
    Array.from(byVoice.keys()).sort().forEach(voiceId => {
      const seq = byVoice.get(voiceId).slice().sort((a, b) => R.cmp(a.w0, b.w0));
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1], b = seq[i];
        if (a.outer || b.outer) continue;
        const leap = Math.abs(b.midi - a.midi);
        if (leap > LARGE_LEAP) found.push({ voiceId: voiceId, w0: R.format(b.w0), leap: leap, from: a.midi, to: b.midi });
      }
    });
    return found;
  }

  /* Voice crossing within one part: two distinct voices sounding at the same onset whose
     pitch order is reversed from that PAIR's own whole-piece average order
     (`songgraph/voices.js`'s `perPartVoiceStats`, real avgMidi - the SAME real-average-
     register idea G7b's own hand assignment already trusts, `arrangement/plan.js`'s
     planSection: "a real average pitch cannot cross itself" - applied here within a hand
     instead of across hands). A pair with no real average difference (both voices average
     the same register, or one is silent) is skipped - "expected order" is undefined. */
  /* every voice's whole-piece average register, per part: {partId: {voiceId: avgMidi|null}} */
  function voiceAveragesOf(g) {
    const out = {};
    g.parts.forEach(part => {
      const stats = VOICES.perPartVoiceStats(g, part);
      const avg = {};
      Object.keys(stats).forEach(v => { avg[v] = stats[v].total ? stats[v].sumMidi / stats[v].total : null; });
      out[part.id] = avg;
    });
    return out;
  }

  /* `notes` = songgraph/util.js noteWindows-shaped notes (each carries partId); `avgByPart` =
     voiceAveragesOf(g). Split from voiceCrossings(g) in G9b so a repair can re-detect on a
     hypothetical note list without building a graph; voiceCrossings(g) is unchanged in behaviour. */
  function voiceCrossingsFromNotes(notes, avgByPart) {
    const found = [];
    Object.keys(avgByPart).forEach(partId => {
      const avg = avgByPart[partId];
      const byOnset = new Map();
      notes.forEach(n => {
        if (n.partId !== partId) return;
        const k = R.format(n.w0); if (!byOnset.has(k)) byOnset.set(k, []); byOnset.get(k).push(n);
      });
      Array.from(byOnset.keys()).sort().forEach(k => {
        const list = byOnset.get(k);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const A = list[i], B = list[j];
            if (A.voiceId === B.voiceId || A.midi === B.midi) continue;
            const aAvg = avg[A.voiceId], bAvg = avg[B.voiceId];
            if (aAvg == null || bAvg == null || aAvg === bAvg) continue;
            const expectAAbove = aAvg > bAvg, actualAAbove = A.midi > B.midi;
            if (expectAAbove !== actualAAbove) {
              found.push({ w0: k, part: partId, voices: [A.voiceId, B.voiceId].sort(), midis: [A.midi, B.midi] });
            }
          }
        }
      });
    });
    return found;
  }
  function voiceCrossings(g) { return voiceCrossingsFromNotes(U.noteWindows(g), voiceAveragesOf(g)); }

  function smellsFromNotes(notes, avgByPart) {
    const slices = slicesFromNotes(notes);
    const parallels = parallelFifthsOctaves(slices);
    const innerLeaps = innerVoiceLeaps(slices);
    const crossings = voiceCrossingsFromNotes(notes, avgByPart);
    return { parallels: parallels, innerLeaps: innerLeaps, crossings: crossings, count: parallels.length + innerLeaps.length + crossings.length };
  }

  function voiceLeadingSmells(g) { return smellsFromNotes(U.noteWindows(g), voiceAveragesOf(g)); }

  return Object.freeze({ LARGE_LEAP, slicesOf, slicesFromNotes, outerOf, outerPairOf, parallelFifthsOctaves, innerVoiceLeaps, voiceCrossings,
    voiceAveragesOf, voiceCrossingsFromNotes, smellsFromNotes, voiceLeadingSmells });
});
