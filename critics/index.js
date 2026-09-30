/* ============================================================================
   PPP Critics (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §4) — the seven deterministic
   critics G9a's candidate selection scores every surviving candidate with, plus three
   REPORT-ONLY ones (post-H-8, weight 0 in selection): `registerFloor` (arranged notes below E2) and
   `leftHandJump` (the share of left-hand steps whose bass moves an octave or more) and
   `lowRegisterCluster` (chord attacks with a second or third whose lower note is below C3) and `verticalClash` (harsh minor-second /
   major-seventh pairs per onset, one-hand octave-plus chords and one-hand seconds, G9 clash guard).

   Five are PROMOTED, verbatim, from G8a's comparison harness (`critics/metrics.js`, moved
   from `realize/tools/metrics.js` - see that file's header): G5 hard violations, G6 level,
   melody preservation, harmony agreement, engraving L1/L2. Two are NEW here:
   voice-leading smells (`critics/voice-leading.js`) and register/density
   (`critics/register-density.js`).

   `evaluate(graph, ctx)` runs all seven on one candidate graph and returns a uniform
   `{ critics: {...}, hardOk }` — `candidates/index.js` is the only caller that turns this
   into a badness score and a selection; this module stays a pure, critic-only layer (no
   weighting, no selection policy) so the critics can be tested and reasoned about one at a
   time. `ctx` carries the per-request context every critic needs that is NOT part of the
   candidate graph itself: `profile` (hand profile name, for the G5 filter), `targetLevel`
   (G6), `origHarmony` (`sg.harmony`, the SAME piece's real analysis) and `origMelodyNotes`
   (`critics/metrics.js`'s `originalMelodyNotes(g, plan)` — computed ONCE per plan by the
   caller, since every pattern variant of the same plan shares the same declared melody
   voice; recomputing it per candidate would be wasted, not wrong).

   **Hard constraints are filters, not scores** (G9 §2, structural rule, restated here):
   `hardOk` is a boolean the caller MUST check before trusting any of the other six scores
   for selection purposes - `evaluate` still computes and returns every critic's real
   number even when `hardOk` is false (useful for diagnostics/reporting a discarded
   candidate's real numbers), but never blends the hard-violation count into a weighted
   score itself.

   `ctx.skipEngrave` (G9a round 2, docs/GOALS/G09 §12 "round 2": engrave (G4 L2) is ~85-90%
   of one candidate's scoring cost, measured, and round 1's own ablation found it has zero
   discriminative power on the round-1 sample - `candidates/index.js` uses this to score
   every enumerated candidate on the six CHEAP critics first and run engrave only as a gate
   on a small top-K, not on every candidate) skips the `engrave` critic entirely
   (`out.engrave = null`, not an error - `badnessOf`'s existing "no engrave data ->
   engraveBad 0" handling already treats `null` the same way it already treats a computed
   0/0 result, so this is not a new code path in the scorer, just a cheaper input to it). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./metrics.js'), require('./voice-leading.js'), require('./register-density.js'), require('./register-floor.js'), require('./left-hand-jump.js'), require('./low-register-cluster.js'), require('./vertical-clash.js'));
  } else {
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    root.PPPCritics = factory(M.metrics, M.voiceLeading, M.registerDensity, M.registerFloor, M.leftHandJump, M.lowRegisterCluster, M.verticalClash);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (METRICS, VL, RD, RF, LHJ, LRC, VCL) {
  'use strict';

  const NAMES = Object.freeze(['hard', 'level', 'melody', 'harmony', 'engrave', 'voiceLeading', 'registerDensity', 'registerFloor', 'leftHandJump', 'lowRegisterCluster', 'verticalClash']);

  function evaluate(graph, ctx) {
    ctx = ctx || {};
    const out = {};
    try { out.hard = METRICS.hardViolationsOfGraph(graph, ctx.profile); } catch (e) { out.hard = { error: String(e && e.message || e) }; }
    try { out.level = METRICS.levelOfGraph(graph); } catch (e) { out.levelError = String(e && e.message || e); }
    try { out.melody = METRICS.melodyPreservation(ctx.origMelodyNotes || [], METRICS.graphNoteList(graph)); } catch (e) { out.melodyError = String(e && e.message || e); }
    try { out.harmony = METRICS.harmonyAgreement(ctx.origHarmony || [], graph); } catch (e) { out.harmonyError = String(e && e.message || e); }
    if (ctx.skipEngrave) { out.engrave = null; }
    else { try { out.engrave = METRICS.engraveMetrics(graph, ctx.id || 'candidate'); } catch (e) { out.engrave = { error: String(e && e.message || e) }; } }
    try { out.voiceLeading = VL.voiceLeadingSmells(graph); } catch (e) { out.voiceLeadingError = String(e && e.message || e); }
    try { out.registerDensity = RD.registerDensity(graph, ctx.stage, { reference: ctx.reference }); } catch (e) { out.registerDensityError = String(e && e.message || e); }
    /* G9 post-H-8: arranged notes below the register floor (ctx.sourceNotes = the original piece's notes, so a
       source note is never counted; ctx.registerFloor overrides the default, realize/theory.js REGISTER_FLOOR) */
    try { out.registerFloor = RF.registerFloor(graph, { sourceNotes: ctx.sourceNotes, floor: ctx.registerFloor }); } catch (e) { out.registerFloorError = String(e && e.message || e); }
    /* G9 post-H-8 re-look: left-hand jump rate (report only; pure function of the graph) */
    try { out.leftHandJump = LHJ.leftHandJump(graph); } catch (e) { out.leftHandJumpError = String(e && e.message || e); }
    /* G9 post-H-8 re-look: low-register cluster rate (report only; pure function of the graph) */
    try { out.lowRegisterCluster = LRC.lowRegisterCluster(graph); } catch (e) { out.lowRegisterClusterError = String(e && e.message || e); }
    /* G9 clash guard: harsh vertical pairs and one-hand octave-plus chords and seconds (report only; ctx.sourceNotes splits the pairs into arranged ones) */
    try { out.verticalClash = VCL.verticalClash(graph, { sourceNotes: ctx.sourceNotes }); } catch (e) { out.verticalClashError = String(e && e.message || e); }
    const hardOk = !!out.hard && !out.hard.error && out.hard.hard === 0;
    return { critics: out, hardOk: hardOk };
  }

  return Object.freeze({ NAMES, metrics: METRICS, voiceLeading: VL, registerDensity: RD, registerFloor: RF, leftHandJump: LHJ, lowRegisterCluster: LRC, verticalClash: VCL, evaluate });
});
