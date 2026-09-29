/* ============================================================================
   PPP Critics - notes below the register floor (G9 post-H-8, docs/GOALS/G09 section 12
   "G9 register floor").

   The user's first blind review (H-8) found that G9 arrangements often put the bass too low
   (lowest note mean MIDI 34 and 24.9 notes below E2 in the arrangements the reviewer flagged
   "awkward hand position", 39 and 6.1 in the others). Nothing measured it: G5's hard
   violations are about hand span and `register-density.js` scores overage against G7b's
   per-stage bands. This critic counts it. The floor itself is `realize/theory.js`
   REGISTER_FLOOR (E2 = MIDI 40) - one constant, read here, by the realizer and by repair.

   registerFloor(graph, opts) -> { floor, total, arranged, below, belowSource, lowest,
                                   lowestArranged, sourceKnown }
     Every sounding note is either SOURCE (the same pitch at the same onset exists in the
     original piece, `opts.sourceNotes` = `critics/metrics.js graphNoteList(originalGraph)`:
     the melody and, in a 'hymn' section, the copied voices) or ARRANGED (anything else - the
     accompaniment the realizer generated). `below` is the number of ARRANGED notes below the
     floor - the critic's number, the thing the realizer's floor is meant to make 0.
     `belowSource` counts source notes below the floor: reported, never a defect (a floor must
     not push notes the source itself has that low; burgmuller25/019 goes down to MIDI 25).
     A generated note that happens to equal a source note (same onset, same pitch) counts as
     source - it is a pitch the piece has. Without `opts.sourceNotes` every note counts as
     arranged and `sourceKnown` is false.

   Deterministic, no randomness, no clock. Not a hard filter and weight 0 in
   `candidates/index.js` DEFAULT_WEIGHTS (report only) - see the doc for why. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../realize/theory.js'), require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.registerFloor = factory((root.PPPRealizeModules || {}).theory, SG.rational, SG.pitch);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TH, R, P) {
  'use strict';

  const FLOOR_DEFAULT = TH.REGISTER_FLOOR;
  const ONSET_TOL_Q = 1e-6; /* quarters: onsets are rationals turned into numbers, so compare with a hair of slack */

  /* every sounding note {onsetQ, midi} of a graph (grace notes are not sounding notes here either) */
  function notesOf(g) {
    const mStart = new Map(); let acc = R.ZERO;
    g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    const out = [];
    g.parts.forEach(part => part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace) return;
      const onsetQ = R.toNumber(R.add(mStart.get(e.m), R.parse(e.at))) * 4;
      (e.heads || []).forEach(h => { if (h.pitch) out.push({ onsetQ: onsetQ, midi: P.midi(h.pitch) }); });
    }));
    return out;
  }

  function sourceIndex(sourceNotes) {
    const byMidi = new Map();
    sourceNotes.forEach(n => { if (!byMidi.has(n.midi)) byMidi.set(n.midi, []); byMidi.get(n.midi).push(n.onsetQ); });
    return byMidi;
  }

  function registerFloor(graph, opts) {
    opts = opts || {};
    const floor = opts.floor == null ? FLOOR_DEFAULT : opts.floor;
    const sourceKnown = Array.isArray(opts.sourceNotes);
    const src = sourceKnown ? sourceIndex(opts.sourceNotes) : null;
    const out = { floor: floor, total: 0, arranged: 0, below: 0, belowSource: 0, lowest: null, lowestArranged: null, sourceKnown: sourceKnown };
    notesOf(graph).forEach(n => {
      out.total++;
      if (out.lowest == null || n.midi < out.lowest) out.lowest = n.midi;
      const isSource = sourceKnown && (src.get(n.midi) || []).some(q => Math.abs(q - n.onsetQ) <= ONSET_TOL_Q);
      if (isSource) { if (n.midi < floor) out.belowSource++; return; }
      out.arranged++;
      if (out.lowestArranged == null || n.midi < out.lowestArranged) out.lowestArranged = n.midi;
      if (n.midi < floor) out.below++;
    });
    return out;
  }

  return Object.freeze({ FLOOR_DEFAULT, notesOf, registerFloor });
});
