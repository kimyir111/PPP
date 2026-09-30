/* ============================================================================
   PPP Critics - low-register clusters (G9 post-H-8 re-look, docs/GOALS/G09 section 12
   "G9 left-hand jumps (post H-8 re-look)").

   The left-hand jump fix (a chord voiced just above its bass) traded an octave-leap defect for a muddier low register: a triad
   whose lowest note sits low has a third or second between two low notes. An independent review measured it on the 11
   re-review pieces (chord attacks with a second or third whose lower note is below C3): wide 15.1%, close 37.3%, legacy 3.7%,
   source 2.8%. This critic counts it, report only.

   lowRegisterCluster(graph, opts) -> { clusterBelow, chordAttacks, clusterAttacks, clusterRate,
                                        bassChordPairs, closeBassChords, closeBassChordRate, notesBelow42 }
     CLUSTER ATTACK: at one onset, two sounding notes a second or third apart (1 to 4 semitones) whose LOWER note is below
     `clusterBelow` (MIDI 48, C3). `chordAttacks` = onsets with two or more notes; `clusterRate` = clusterAttacks / chordAttacks
     (0 when there is no chord attack). Every note counts, source or arranged, exactly as the review count did.
     CLOSE BASS-CHORD: the left hand's bass-then-chord pair. Take the onsets that have a note below middle C; a pair is two
     consecutive such onsets, the first a single note (a bass) and the second two or more notes; it is CLOSE when the bass is
     below `clusterBelow` and the chord's lowest note is within a third (4 semitones) of it, in either direction.
     `closeBassChordRate` = closeBassChords / bassChordPairs, over ALL bass-then-chord pairs (0 when there are none), so a piece
     whose stride sits high in the register reads 0.
     `notesBelow42` counts every note below F#2 (MIDI 42).

   Deterministic, no randomness, no clock. Weight 0 in `candidates/index.js` DEFAULT_WEIGHTS (report only). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./register-floor.js'));
  } else {
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.lowRegisterCluster = factory(M.registerFloor);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RF) {
  'use strict';

  const CLUSTER_BELOW = 48; /* C3 */
  const LH_SPLIT = 60;      /* middle C: the left-hand register, as in critics/left-hand-jump.js */
  const CLOSE_SEMITONES = 4; /* a major third */
  const F_SHARP_2 = 42;

  const keyOf = q => Math.round(q * 1e6);

  function byOnset(notes) {
    const m = new Map();
    notes.forEach(n => { const k = keyOf(n.onsetQ); if (!m.has(k)) m.set(k, { onsetQ: n.onsetQ, midis: [] }); m.get(k).midis.push(n.midi); });
    return Array.from(m.values()).sort((a, b) => a.onsetQ - b.onsetQ);
  }

  function ofNotes(notes, opts) {
    opts = opts || {};
    const below = opts.clusterBelow == null ? CLUSTER_BELOW : opts.clusterBelow;
    const out = { clusterBelow: below, chordAttacks: 0, clusterAttacks: 0, clusterRate: 0, bassChordPairs: 0, closeBassChords: 0, closeBassChordRate: 0, notesBelow42: 0 };
    const slices = byOnset(notes);
    slices.forEach(s => {
      if (s.midis.length < 2) return;
      out.chordAttacks++;
      const sorted = s.midis.slice().sort((a, b) => a - b);
      let cluster = false;
      for (let i = 0; i < sorted.length && !cluster; i++) {
        if (sorted[i] >= below) break;
        for (let j = i + 1; j < sorted.length; j++) {
          const d = sorted[j] - sorted[i];
          if (d > 0 && d <= CLOSE_SEMITONES) { cluster = true; break; }
        }
      }
      if (cluster) out.clusterAttacks++;
    });
    out.clusterRate = out.chordAttacks ? out.clusterAttacks / out.chordAttacks : 0;
    const lh = slices.map(s => s.midis.filter(m => m < LH_SPLIT)).filter(l => l.length);
    for (let i = 1; i < lh.length; i++) {
      if (lh[i - 1].length !== 1 || lh[i].length < 2) continue;
      out.bassChordPairs++;
      const bass = lh[i - 1][0], low = Math.min.apply(null, lh[i]);
      if (bass < below && Math.abs(low - bass) <= CLOSE_SEMITONES) out.closeBassChords++;
    }
    out.closeBassChordRate = out.bassChordPairs ? out.closeBassChords / out.bassChordPairs : 0;
    notes.forEach(n => { if (n.midi < F_SHARP_2) out.notesBelow42++; });
    return out;
  }

  function lowRegisterCluster(graph, opts) { return ofNotes(RF.notesOf(graph), opts); }

  return Object.freeze({ CLUSTER_BELOW, CLOSE_SEMITONES, ofNotes, lowRegisterCluster });
});
