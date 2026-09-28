/* ============================================================================
   PPP Difficulty (docs/GOALS/G06_DIFFICULTY.md) - G6a: features, and the ranker's inference.

   A pure-function UMD module outside the app file, alongside scoregraph/, engrave/ and playability/. Not loaded
   by the app (G06 §4, §9): nothing here changes what a user sees. G6b is the separate phase that may wire it in,
   behind PPP.difficulty.

     features   featuresOf(scoreGraph, opts): the §3(a) features, per piece and per measure (difficulty/features.js)
     model      predict(features, weights): level, reasons, hotspot map (difficulty/model.js)
     assess(graph, weights, opts) = model.predict(features.featuresOf(graph, opts), weights, opts)

   The weights are data, not code: difficulty/weights/g6a-v1.json, written by difficulty/tools/train.js.

   Browser order: scoregraph/*.js, playability/*.js, then features, model, index. Node:
   require('./difficulty/index.js').
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./features.js'), require('./model.js'));
  else {
    const M = root.PPPDifficultyModules = root.PPPDifficultyModules || {};
    root.PPPDifficulty = factory(M.features, M.model);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (features, model) {
  'use strict';

  const version = '0.1.0';
  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g6a', version: features.VERSION });

  function assess(g, weights, opts) {
    return model.predict(features.featuresOf(g, opts), weights, opts);
  }

  return Object.freeze({ version: version, SOURCE: SOURCE, features: features, model: model, assess: assess });
});
