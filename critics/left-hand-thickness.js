/* ============================================================================
   PPP Critics - left-hand thickness (G9 last defect round, docs/GOALS/G09 section 12 "G9 last defect round").

   Two blind AI teacher judges and the user's blind reviews called G9's left hand too thick for the stage: block chords of three notes on every
   beat, close seconds below middle C and chord tops at E4 or above (which draws an 8va over the bass staff). This critic counts it, report only
   (weight 0, not part of `evaluate`).

   leftHandThickness(graph) -> { onsets, notes, notesPerOnset, onsets3plus, onsets3plusRate, secondsBelowC4, secondsRate, topsAtOrAboveE4,
                                  topsRate, clusterAttacks }
     The left hand is the notes whose limb is 'LH' (scoregraph/pitch.js limbOf: the head's, else the voice's, else the staff's; whatever their pitch; grace notes excluded).
     ONSET: a moment at which the left hand attacks at least one note. `notesPerOnset` = left-hand notes / onsets.
     `onsets3plus`: onsets with three or more notes at once. `secondsBelowC4`: onsets with two left-hand notes a second (1 or 2 semitones)
     apart whose lower note is below middle C. `topsAtOrAboveE4`: onsets of TWO OR MORE notes whose highest note is at E4 (MIDI 64) or above
     (a single line note that high is not a chord top). `clusterAttacks`: onsets with a second or third whose lower note is below C3, the
     same test as critics/low-register-cluster.js but on left-hand notes only. Rates are over `onsets` (0 when there are none).
   Deterministic, no randomness, no clock. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.leftHandThickness = factory(SG.rational, SG.pitch);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P) {
  'use strict';

  const SECOND_BELOW = 60; /* middle C */
  const CLUSTER_BELOW = 48; /* C3 */
  const CHORD_TOP_E4 = 64;

  function leftHandOnsets(g) {
    const mStart = new Map(); let acc = R.ZERO;
    g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    const byOnset = new Map();
    g.parts.forEach(part => {
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        const key = R.format(R.add(mStart.get(e.m), R.parse(e.at)));
        (e.heads || []).forEach(h => {
          if (!h.pitch || P.limbOf(part, e, h) !== 'LH') return; /* head limb, else voice limb, else staff limb (scoregraph/pitch.js) */
          if (!byOnset.has(key)) byOnset.set(key, []);
          byOnset.get(key).push(P.midi(h.pitch));
        });
      });
    });
    return Array.from(byOnset.values()).filter(l => l.length);
  }

  function ofOnsets(onsets) {
    const out = { onsets: onsets.length, notes: 0, notesPerOnset: 0, onsets3plus: 0, onsets3plusRate: 0, secondsBelowC4: 0, secondsRate: 0, topsAtOrAboveE4: 0, topsRate: 0, clusterAttacks: 0 };
    onsets.forEach(l => {
      const s = l.slice().sort((a, b) => a - b);
      out.notes += s.length;
      if (s.length >= 3) out.onsets3plus++;
      if (s.length >= 2 && s[s.length - 1] >= CHORD_TOP_E4) out.topsAtOrAboveE4++;
      let second = false, cluster = false;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        const d = s[j] - s[i];
        if (d > 0 && d <= 2 && s[i] < SECOND_BELOW) second = true;
        if (d > 0 && d <= 4 && s[i] < CLUSTER_BELOW) cluster = true;
      }
      if (second) out.secondsBelowC4++;
      if (cluster) out.clusterAttacks++;
    });
    out.notesPerOnset = out.onsets ? out.notes / out.onsets : 0;
    out.onsets3plusRate = out.onsets ? out.onsets3plus / out.onsets : 0;
    out.secondsRate = out.onsets ? out.secondsBelowC4 / out.onsets : 0;
    out.topsRate = out.onsets ? out.topsAtOrAboveE4 / out.onsets : 0;
    return out;
  }

  function leftHandThickness(graph) { return ofOnsets(leftHandOnsets(graph)); }

  return Object.freeze({ SECOND_BELOW, CLUSTER_BELOW, CHORD_TOP_E4, leftHandOnsets, ofOnsets, leftHandThickness });
});
