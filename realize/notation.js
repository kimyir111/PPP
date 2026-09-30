/* ============================================================================
   PPP Arrangement Realization — small notation helpers (docs/GOALS/G08 — G8a).

   Every duration realize/patterns.js emits is deliberately a clean binary subdivision of a
   real notated beat (chord counts are capped at 3 - see realize/index.js's header - so no
   pattern ever needs a tuplet to notate its own output): `displayFor` is a plain inverse
   lookup against scoregraph/schema.js's own `noteValue(type, dots)`, not a rhythm-spelling
   algorithm (that harder problem is G3's pro-rhythm.js, and does not need reproducing here
   because G8a never emits anything G3 would need to re-spell).

   G8b note (docs/GOALS/G08B_LEGACY_RETIREMENT.md): wrapped in the same UMD shape every
   sibling module already uses, so the app can load it via <script> - a pure packaging
   change, no logic below this point was touched.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/schema.js'), require('../scoregraph/pro-spell.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPRealizeModules = root.PPPRealizeModules || {};
    M.notation = factory(SG.rational, SG.schema, SG.proSpell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, SP) {
  'use strict';

const TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'];

/* {type, dots} for a rational duration that matches a plain (<=2 dots) note value exactly,
   or null if it doesn't (a real bug in a pattern generator, not an expected case - see
   header). Callers should treat null as a hard error, not silently guess. */
function displayFor(dur) {
  for (const t of TYPES) {
    for (let dots = 0; dots <= 2; dots++) {
      const v = S.noteValue(t, dots);
      if (v && R.eq(v, dur)) return dots ? { type: t, dots: dots } : { type: t };
    }
  }
  return null;
}

/* The tonic pitch class (0-11) of a written key signature: fifths=0/major -> C (0);
   fifths=0/minor -> A (9, the relative minor); every other key by the standard
   circle-of-fifths step (+7 semitones per sharp, i.e. -5 mod 12, per fifth). This is the
   WRITTEN key signature's own tonic (always well-defined), not songgraph/keys.js's
   `keyRegionsOf` modulation analysis (which returns null for a piece shorter than its
   12-measure window - confirmed directly, e.g. catalog/method/beyer/007.mxl - so is not a
   safe source for a plain "what's the key signature" lookup as every corpus piece has one
   whether or not it is long enough for region analysis). */
function tonicPcOf(fifths, mode) {
  const majorTonic = (((7 * fifths) % 12) + 12) % 12;
  return mode === 'minor' ? (majorTonic + 9) % 12 : majorTonic;
}

/* scoregraph/pro-spell.js's own spellMidi(midi, table) (line ~172) is not exported (only
   spellingTable is, per its module footer) - reimplemented here verbatim (3 lines, no
   dependencies beyond the table spellingTable already returns) rather than changing
   already-reviewed G1/G3 code to export one more function. */
function spellMidiFromTable(midi, table) {
  const x = table[((midi % 12) + 12) % 12];
  const oct = Math.floor((midi - x.alter) / 12) - 1;
  return x.alter ? { step: x.step, alter: x.alter, oct: oct } : { step: x.step, oct: oct };
}

/* A cached {fifths,mode} -> spelling table, and the key in force at a given ORIGINAL
   measure index (the latest KeyEvent at or before it - g.timeline.keys is always non-empty
   for an imported score). */
function keyTracker(g) {
  const keys = g.timeline.keys.slice();
  const idxOf = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  keys.sort((a, b) => (idxOf.get(a.m) || 0) - (idxOf.get(b.m) || 0));
  const cache = new Map();
  function tableFor(fifths, mode) {
    const key = fifths + ':' + mode;
    if (!cache.has(key)) cache.set(key, SP.spellingTable({ fifths: fifths, mode: mode || 'major', tonic: tonicPcOf(fifths, mode) }));
    return cache.get(key);
  }
  function keyEventAt(measureIdx) {
    let found = keys[0] || { fifths: 0, mode: 'major' };
    keys.forEach(k => { if ((idxOf.get(k.m) || 0) <= measureIdx) found = k; });
    return found;
  }
  return {
    keyAt(measureIdx) { const k = keyEventAt(measureIdx); return { fifths: k.fifths || 0, mode: k.mode || 'major' }; },
    tableAt(measureIdx) { const k = keyEventAt(measureIdx); return tableFor(k.fifths, k.mode); },
    spellAt(midi, measureIdx) { return spellMidiFromTable(midi, this.tableAt(measureIdx)); }
  };
}

  return { displayFor, tonicPcOf, keyTracker, TYPES };
});
