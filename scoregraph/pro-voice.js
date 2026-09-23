/* ============================================================================
   PPP ScoreGraph — G3 pass: P3 voices (§8): G3a numbering and gaps; G3b performance voices (off by default: D1)
   (docs/GOALS/G03)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proVoice = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const voice = Object.freeze({
    name: 'voice',
    may: ['place', 'rests', 'pieces', 'tuplets', 'beams'],
    run(g, ctx) { void ctx; return { graph: g, idMap: {}, changes: [] }; }
  });

  return Object.freeze({ voice });
});
