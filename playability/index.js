/* ============================================================================
   PPP Playability (docs/GOALS/G05) - G5a: the analyzer, over a ScoreGraph, plus its metrics.

   A pure-function UMD module, outside the app file, alongside `scoregraph/` and `engrave/`
   (docs/GOALS/G05 §3(a)). Not loaded by the app (G05 §9): nothing here changes what a user sees.

     reach      hand-profile reach and keyboard-velocity constants, cited (playability/reach.js)
     graph      attacksOf(scoreGraph, opts): the ScoreGraph -> per-hand keyboard attacks (playability/graph.js)
     analyze    analyze(attacks, opts): attacks -> a PlayabilityReport (playability/analyze.js)
     fingering  solveGraph/write/fingerGraph: the fingering DP -> Head.fingering (playability/fingering.js, G5b)
     analyzeGraph(graph, opts) = analyze(graph.attacksOf(graph, opts), opts): the common case

   Browser order: reach, graph, analyze, fingering, index (after scoregraph/*.js, which graph.js and
   fingering.js need for rational/pitch/time/ops/prov). Node: require('./playability/index.js').
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./reach.js'), require('./graph.js'), require('./analyze.js'), require('./fingering.js'));
  } else {
    const M = root.PPPPlayabilityModules = root.PPPPlayabilityModules || {};
    root.PPPPlayability = factory(M.reach, M.graph, M.analyze, M.fingering);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (reach, graph, analyze, fingering) {
  'use strict';

  const version = '0.2.0';

  function analyzeGraph(g, opts) {
    return analyze.analyze(graph.attacksOf(g, opts), opts);
  }

  return Object.freeze({
    version: version,
    reach: reach,
    graph: graph,
    analyze: analyze.analyze,
    analyzeHand: analyze.analyzeHand,
    analyzeGraph: analyzeGraph,
    fingering: fingering
  });
});
