/* ============================================================================
   PPP Arrangement Planner (docs/GOALS/G07B_ARRANGEMENT_PLANNER.md) — G7b.

   A pure-function UMD module outside the app file, alongside scoregraph/, playability/,
   difficulty/ and songgraph/. Node-only, not loaded by the app (design doc §9/§13):
   nothing here changes what a user sees. Consumes G7a's SongGraph (songgraph/index.js's
   analyze()), G5's real reach constants (playability/reach.js) and G6's real trained
   corpus (difficulty/weights, difficulty/tools/dataset) to search for an ArrangementPlan -
   never writes a note (G8, later, does that).

     reference   real per-stage difficulty/register/density bands from G6's own training
                 corpus (arrangement/reference.js)
     texture     the real, voice-role-grounded retention ladder (arrangement/texture.js)
     plan        plan(g, sg, request, opts): the search itself (arrangement/plan.js)

   Node: require('./arrangement/index.js').
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./reference.js'), require('./texture.js'), require('./plan.js'));
  } else {
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    root.PPPArrangement = factory(M.reference, M.texture, M.plan);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (reference, texture, plan) {
  'use strict';

  const version = '0.1.0';

  return Object.freeze({ version: version, reference: reference, texture: texture, plan: plan.plan, planner: plan });
});
