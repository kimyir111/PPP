/* ============================================================================
   PPP Arrangement Realizer — pitch spelling (G8a, docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §6a)

   G8a is the first Goal in the G5-G9 chain to invent new pitches (a pattern-generated
   accompaniment note has no written source to copy a spelling from), so it needs its own
   MIDI -> {step, alter, oct} function. scoregraph/pitch.js only ever goes the other way
   (pitch -> midi); no spell-from-midi helper exists anywhere in the repo (checked: grepped
   scoregraph/, songgraph/, arrangement/, tests/ for SHARP_NAMES/PC_STEP/spellMidi-shaped
   names before writing this - the app file's own NOTE_NAMES, App 10787, gives plain
   "C#"-style strings, not the {step,alter,oct} object the schema requires).

   Standard key-signature spelling (circle of fifths), not derived from arrange_score.py's
   own midi_name()/prefer_flats (that gives a flat string name and a binary sharp/flat
   choice with no key-aware diatonic-vs-chromatic distinction; this gives the schema's
   {step,alter,oct} shape and spells a chromatic tone as the sharp of the diatonic step
   below it in a sharp-side key, or the flat of the step above it in a flat-side key - the
   ordinary notation convention). A minor key shares its relative major's key-signature
   spelling for this purpose (spelling accidentals, not naming scale degrees), so `fifths`
   alone is enough; `mode` is not needed here. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPArrangementModules = root.PPPArrangementModules || {}; M.spell = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  /* the order a key signature adds sharps/flats in */
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

  function diatonicAlters(fifths) {
    const alters = {};
    LETTERS.forEach(s => { alters[s] = 0; });
    if (fifths > 0) SHARP_ORDER.slice(0, Math.min(7, fifths)).forEach(s => { alters[s] = 1; });
    else if (fifths < 0) FLAT_ORDER.slice(0, Math.min(7, -fifths)).forEach(s => { alters[s] = -1; });
    return alters;
  }
  const pcOf = (step, alter) => (((NATURAL_PC[step] + alter) % 12) + 12) % 12;

  /* MIDI -> {step, alter?, oct} for the key signature `fifths` (default 0 = C major/A minor). */
  function spellMidi(midi, fifths) {
    const f = fifths || 0;
    const alters = diatonicAlters(f);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    let spelled = null;
    LETTERS.forEach(step => { if (pcOf(step, alters[step]) === pc) spelled = { step: step, alter: alters[step] }; });
    if (!spelled) {
      const delta = f >= 0 ? 1 : -1; /* a chromatic tone: sharp of the step below (sharp-side) or flat of the step above (flat-side) */
      LETTERS.forEach(step => { if (pcOf(step, alters[step] + delta) === pc) spelled = { step: step, alter: alters[step] + delta }; });
    }
    if (!spelled) spelled = { step: 'C', alter: pc }; /* unreachable for a real pc 0-11, kept as a safe fallback */
    const oct = (Math.round(midi) - NATURAL_PC[spelled.step] - spelled.alter) / 12 - 1;
    return spelled.alter ? { step: spelled.step, alter: spelled.alter, oct: oct } : { step: spelled.step, oct: oct };
  }

  return Object.freeze({ spellMidi, diatonicAlters });
});
