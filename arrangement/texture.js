/* ============================================================================
   PPP Arrangement Planner — texture vocabulary (docs/GOALS/G07B §4)

   The design doc's own examples ("block chords, Alberti bass, arpeggiated") are RHYTHMIC-
   PATTERN distinctions - how a hand's notes are spaced out in time. G7a's voice-role
   analysis (songgraph/voices.js) cannot tell an Alberti bass from a block chord: both are
   the SAME voice playing the SAME pitches, just with a different onset pattern within a
   beat, and voiceRolesOf only ever sees "which voice is on top/bottom/inner/accompaniment
   at each of ITS OWN onsets" - it has no rhythmic-pattern feature at all. Naming a texture
   "Alberti bass" here would be inventing a category nothing in this codebase can actually
   tell apart from a block chord; §4 of the design doc explicitly warns against exactly this.

   What G7a's roles genuinely support distinguishing is VOICE COUNT AND ROLE: a real part
   has some number of real voices (1-4 in this corpus), each already labelled melody / bass
   / inner / accompaniment (songgraph/voices.js's voiceRolesOf). G7b's texture vocabulary is
   built directly from that, as a RETENTION LADDER: which of the real, already-identified
   voices are kept, not an invented rhythmic style:

     full      every real voice the part has (1-4), each hand assigned by its own actual
               register within the section (arrangement/plan.js), not by role label.
     partial   one inner/accompaniment voice dropped (only meaningfully different from
               'full' when the part has 2+ non-melody/bass voices, i.e. 4 real voices).
     reduced   melody and bass only (or melody alone, for a 1-voice part) - every
               inner/accompaniment voice dropped.

   This is deliberately a SELECTION policy, not a generative one: G7b never invents a note.
   Every voice a plan keeps is a real voice with real notes already in the ScoreGraph; every
   voice it drops is simply omitted. The one thing this vocabulary cannot express - added
   content beyond what's already written (a block-chord fill under a bare melody line, a
   doubled octave, a broken-chord accompaniment invented under a hymn tune that has none) -
   is G8's job, not G7b's (see plan.js's header, "deferred to G8").
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPArrangementModules = root.PPPArrangementModules || {}; M.texture = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIERS = Object.freeze(['full', 'partial', 'reduced']);

  /* [{tier, voiceIds, dropped, extraKept}], most complete first (extraKept descending),
     ending at extraKept=0 (melody+bass only, or melody alone for a 1-voice part). `roles`
     is one songgraph/voices.js voiceRolesOf(g).parts[i].roles entry; the drop order's
     tie-break is the LEAST confident non-melody/bass voice first. `extraKept` (how many
     non-melody/bass voices survive) is the real gating value the search uses
     (rungsFrom/startExtraForStage below) - NOT the `tier` label, which can't tell a
     2-voice part's only rung (label 'full', extraKept 0) apart from a 4-voice part's
     fully-reduced rung (label 'reduced', also extraKept 0) by label alone. */
  function ladder(roles, mb) {
    const melody = roles.find(r => r.role === 'melody');
    const bass = roles.find(r => r.role === 'bass');
    const rest = roles.filter(r => r.role !== 'melody' && r.role !== 'bass')
      .slice()
      .sort((a, b) => (a.conf - b.conf) || (a.voice < b.voice ? -1 : a.voice > b.voice ? 1 : 0));
    const base = [melody, bass].filter(Boolean).map(r => r.voice);
    const out = [];
    for (let dropped = 0; dropped <= rest.length; dropped++) {
      const kept = rest.slice(dropped).map(r => r.voice);
      const voiceIds = base.concat(kept);
      const extraKept = rest.length - dropped;
      const tier = dropped === 0 ? 'full' : (extraKept === 0 ? 'reduced' : 'partial');
      out.push({ tier: tier, voiceIds: voiceIds, dropped: rest.slice(0, dropped).map(r => r.voice), extraKept: extraKept });
    }
    return out;
  }

  /* The most non-melody/bass voices a request should try to keep, from the requested
     stage (1..4, difficulty/weights' own stage numbers): stage 1 starts at 0 extra voices
     (melody+bass only - Beyer-level simplicity), stage 2 keeps at most 1, stage 3+ keeps
     everything the part actually has. This is a declared G7b policy (not derived from G6's
     trained model, which does not decompose this way - see reference.js's header), grounded
     in the real, ordered voice-count-and-role ladder above, never in an invented texture. */
  function startExtraForStage(stage) {
    if (stage <= 1) return 0;
    if (stage === 2) return 1;
    return Infinity;
  }

  function tierIndex(tier) { return TIERS.indexOf(tier); }

  /* The ladder rungs keeping at most `maxExtra` non-melody/bass voices, most-ambitious
     (highest extraKept) first - what the search actually walks (arrangement/plan.js).
     Skips any rung more complete than requested. Always includes the extraKept=0 rung
     (melody+bass / melody-only) so a search always has a floor to fail cleanly from. */
  function rungsFrom(fullLadder, maxExtra) {
    return fullLadder.filter(r => r.extraKept <= maxExtra).sort((a, b) => b.extraKept - a.extraKept);
  }

  return Object.freeze({ TIERS, ladder, startExtraForStage, tierIndex, rungsFrom });
});
