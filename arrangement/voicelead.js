/* ============================================================================
   PPP Arrangement Realizer — voice leading (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §6a)

   G8a's pattern library (arrangement/g8a-accompaniment.js) needs to turn a sequence of real
   per-window harmony fits (songgraph/harmony.js's {root, quality} per beatGrid window) into REAL
   MIDI pitches for a generated accompaniment voice/chord, with SMOOTH motion from one window to
   the next (design doc §6a: "voice leading between successive harmony windows... not
   independently randomized voicings per window").

   chordTones(root, iv, size) -> pcs, size entries, ascending, pcs[0] always the root pc (the
   bass of the group). Which non-root tones survive when size < iv.length is a declared priority
   (fifth before third before a seventh) - the same "open before full" idea arrange_score.py's
   own voicing preferred (informal prior art, not ported code).

   voiceGroup(prevMidis, pcs, opts) -> new MIDI array, same length as pcs, ascending, chosen by
   nearest-pitch-class-to-the-previous-voice's-own-note (a real per-voice nearest-neighbor, not a
   whole-chord distance minimization - simple, deterministic, and enough to make each real voice
   move by step or small leap between two real chords rather than jump to an unrelated octave).
   Falls back to a fresh close-position voicing seeded near opts.seed when there is no previous
   voicing to lead from, or when the voice count changed since the last window (a texture-tier
   change is the only place this happens - see plan.section.texture in g8a-realize.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPArrangementModules = root.PPPArrangementModules || {}; M.voicelead = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const pc = m => ((m % 12) + 12) % 12;

  /* The non-root tones to prefer, by iv INDEX, when a chord must be thinned: fifth (index 2, if
     the quality has one) before the third (index 1), before any extension (index 3+, e.g. a
     seventh) - "root+fifth" is the simplest real open accompaniment before "root+third" adds
     the mode's own colour. A chord with no fifth at all (nothing in songgraph/harmony.js's
     QUALITIES lacks one) never reaches the iv.length<3 branch in real data, but it is handled
     for safety (keeps every non-root tone, in their given order). */
  function priorityIdx(iv) {
    if (iv.length >= 3) return [2, 1].concat(iv.map((_, i) => i).filter(i => i > 2));
    return iv.map((_, i) => i).filter(i => i > 0);
  }

  /* size real pitch classes for this chord, ascending, pcs[0] the root. size is clamped to
     [1, iv.length] - asking for more tones than the fitted chord has just returns all of them. */
  function chordTones(rootPc, iv, size) {
    const want = Math.max(1, Math.min(size, iv.length));
    const idx = [0].concat(priorityIdx(iv).slice(0, want - 1));
    return idx.map(i => iv[i]).sort((a, b) => a - b).map(x => (rootPc + x) % 12);
  }

  /* The MIDI pitch with pitch class `targetPc` nearest to `near` (ties broken downward - an
     arbitrary but deterministic choice, documented rather than left to Math.min's own tie
     behaviour, which already picks the first/lowest candidate found). */
  function nearestPitch(targetPc, near) {
    let best = null, bestDist = Infinity;
    for (let oct = -3; oct <= 3; oct++) {
      const cand = near + oct * 12 - pc(near) + targetPc;
      const d = Math.abs(cand - near);
      if (d < bestDist - 1e-9) { bestDist = d; best = cand; }
    }
    return best;
  }

  /* A fresh close-position voicing for `pcs` (ascending, pcs[0] root), the bass placed at the
     nearest occurrence of pcs[0] to `seed`, each further tone the smallest MIDI value strictly
     greater than the one before it with that pitch class (so the group starts in as narrow a
     span as its own pitch classes allow). */
  function seedVoicing(pcs, seed) {
    const out = [nearestPitch(pcs[0], seed)];
    for (let i = 1; i < pcs.length; i++) {
      let cand = out[i - 1] - pc(out[i - 1]) + pcs[i];
      while (cand <= out[i - 1]) cand += 12;
      out.push(cand);
    }
    return out;
  }

  /* Clamp a whole ascending voicing to a maximum span (top-to-bottom semitones) by moving the
     TOP note down an octave, repeatedly, while it stays above the note below it (a real chord
     inversion move, not a musically arbitrary clip) - and to a register window [lo, hi] by
     shifting the whole voicing by octaves (every real voice moves together, so relative spacing
     - the thing voice leading actually cares about - is untouched). */
  function clamp(voicing, opts) {
    let v = voicing.slice();
    const maxSpan = opts.maxSpan;
    if (maxSpan) {
      let guard = 0;
      while (v[v.length - 1] - v[0] > maxSpan && guard++ < 8) {
        const i = v.length - 1;
        const moved = v[i] - 12;
        if (moved <= v[i - 1]) break; /* cannot compress further without crossing voices */
        v[i] = moved;
        v.sort((a, b) => a - b);
      }
    }
    if (opts.register) {
      const { lo, hi } = opts.register;
      let guard = 0;
      while (lo != null && v[0] < lo && guard++ < 8) v = v.map(x => x + 12);
      guard = 0;
      while (hi != null && v[v.length - 1] > hi && guard++ < 8) v = v.map(x => x - 12);
    }
    return v;
  }

  function voiceGroup(prevMidis, pcs, opts) {
    opts = opts || {};
    let v;
    if (!prevMidis || !prevMidis.length || prevMidis.length !== pcs.length) {
      v = seedVoicing(pcs, opts.seed != null ? opts.seed : 48);
    } else {
      v = pcs.map((p, i) => nearestPitch(p, prevMidis[i]));
      /* keep the group's own ascending voice order (a real chord's voices do not cross each
         other from one window to the next in this simple model): if leading independently put
         two voices out of order, re-sort by pitch - still each voice's OWN nearest choice, just
         relabelled by final pitch order rather than original index. */
      v.sort((a, b) => a - b);
    }
    return clamp(v, opts);
  }

  return Object.freeze({ chordTones, nearestPitch, seedVoicing, clamp, voiceGroup });
});
