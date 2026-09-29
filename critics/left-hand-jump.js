/* ============================================================================
   PPP Critics - left-hand jump rate (G9 post-H-8 re-look, docs/GOALS/G09 section 12
   "G9 left-hand jumps (post H-8 re-look)").

   The user's first blind review (H-8) flagged "awkward hand position" on 9 of 16 G9 arrangements, with notes like
   "the distance between the low notes, an octave or a tenth, is too far". The register floor fixed the wrong main
   cause (it only removed extreme low notes); the cause was the bass jumping an octave or more from one left-hand
   note to the next. Nothing measured that. This critic does.

   leftHandJump(graph, opts) -> { splitMidi, jumpSemitones, steps, jumps, rate, maxJump, belowG2, lowest }
     A LEFT-HAND STEP is defined by pitch, the same proxy the review analysis used (so a legacy arrangement, whose
     hands are projected from note lists, and a G9 one are measured the same way): at every onset where some note
     sounds below `splitMidi` (MIDI 60, middle C), the BASS is the lowest such note; the steps are between
     consecutive such onsets (an onset with nothing below middle C is skipped, not a step). A JUMP is a step whose
     bass moves by `jumpSemitones` (12, an octave) or more. `rate` = jumps / steps (0 when there are no steps).
     `belowG2` counts every note below G2 (MIDI 43, the bottom line of the bass staff: the notes that need ledger
     lines), source and arranged alike (the register-floor critic separates arranged from source; this is the
     plain count the review comparison used). Tied continuations are not told apart from attacks (the realizer's
     accompaniment has no ties; a copied hymn voice may).

   Deterministic, no randomness, no clock. Report only: weight 0 in `candidates/index.js` DEFAULT_WEIGHTS (the standing
   rule is no further tuning of selection; the realizer's geometry is what changes). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./register-floor.js'));
  } else {
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.leftHandJump = factory(M.registerFloor);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RF) {
  'use strict';

  const SPLIT_MIDI = 60;   /* middle C: below it a sounding note counts as left-hand register */
  const JUMP_SEMITONES = 12; /* an octave or more between consecutive basses */
  const G2 = 43;           /* the bottom line of the bass staff */

  /* the bass line {onsetQ, bass} of a plain note list [{onsetQ, midi}], in time order, one entry per onset that has a
     note below `split` */
  function bassLine(notes, split) {
    const byOnset = new Map();
    notes.forEach(n => {
      if (n.midi >= split) return;
      const k = Math.round(n.onsetQ * 1e6);
      const cur = byOnset.get(k);
      if (!cur || n.midi < cur.bass) byOnset.set(k, { onsetQ: n.onsetQ, bass: n.midi });
    });
    return Array.from(byOnset.values()).sort((a, b) => a.onsetQ - b.onsetQ);
  }

  function ofNotes(notes, opts) {
    opts = opts || {};
    const split = opts.splitMidi == null ? SPLIT_MIDI : opts.splitMidi;
    const jump = opts.jumpSemitones == null ? JUMP_SEMITONES : opts.jumpSemitones;
    const line = bassLine(notes, split);
    const out = { splitMidi: split, jumpSemitones: jump, steps: 0, jumps: 0, rate: 0, maxJump: 0, belowG2: 0, lowest: null };
    for (let i = 1; i < line.length; i++) {
      const d = Math.abs(line[i].bass - line[i - 1].bass);
      out.steps++;
      if (d >= jump) out.jumps++;
      if (d > out.maxJump) out.maxJump = d;
    }
    out.rate = out.steps ? out.jumps / out.steps : 0;
    notes.forEach(n => {
      if (n.midi < G2) out.belowG2++;
      if (out.lowest == null || n.midi < out.lowest) out.lowest = n.midi;
    });
    return out;
  }

  function leftHandJump(graph, opts) { return ofNotes(RF.notesOf(graph), opts); }

  return Object.freeze({ SPLIT_MIDI, JUMP_SEMITONES, G2, bassLine, ofNotes, leftHandJump });
});
