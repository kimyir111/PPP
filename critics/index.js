/* ============================================================================
   PPP Critics (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §4) — the seven deterministic
   critics G9a's candidate selection scores every surviving candidate with.

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
   score itself. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./metrics.js'), require('./voice-leading.js'), require('./register-density.js'));
  } else {
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    root.PPPCritics = factory(M.metrics, M.voiceLeading, M.registerDensity);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (METRICS, VL, RD) {
  'use strict';

  const NAMES = Object.freeze(['hard', 'level', 'melody', 'harmony', 'engrave', 'voiceLeading', 'registerDensity']);

  function evaluate(graph, ctx) {
    ctx = ctx || {};
    const out = {};
    try { out.hard = METRICS.hardViolationsOfGraph(graph, ctx.profile); } catch (e) { out.hard = { error: String(e && e.message || e) }; }
    try { out.level = METRICS.levelOfGraph(graph); } catch (e) { out.levelError = String(e && e.message || e); }
    try { out.melody = METRICS.melodyPreservation(ctx.origMelodyNotes || [], METRICS.graphNoteList(graph)); } catch (e) { out.melodyError = String(e && e.message || e); }
    try { out.harmony = METRICS.harmonyAgreement(ctx.origHarmony || [], graph); } catch (e) { out.harmonyError = String(e && e.message || e); }
    try { out.engrave = METRICS.engraveMetrics(graph, ctx.id || 'candidate'); } catch (e) { out.engrave = { error: String(e && e.message || e) }; }
    try { out.voiceLeading = VL.voiceLeadingSmells(graph); } catch (e) { out.voiceLeadingError = String(e && e.message || e); }
    try { out.registerDensity = RD.registerDensity(graph, ctx.stage, { reference: ctx.reference }); } catch (e) { out.registerDensityError = String(e && e.message || e); }
    const hardOk = !!out.hard && !out.hard.error && out.hard.hard === 0;
    return { critics: out, hardOk: hardOk };
  }

  return Object.freeze({ NAMES, metrics: METRICS, voiceLeading: VL, registerDensity: RD, evaluate });
});
