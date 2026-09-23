/* ============================================================================
   PPP ScoreGraph — G3 pass: P4 R-repr (§6.2, §6.3) and P4b R-reg (§6.4, G3b, off by default: D1)
   (docs/GOALS/G03)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proRhythm = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const rhythm = Object.freeze({
    name: 'rhythm',
    may: ['pieces', 'tuplets', 'beams', 'acc'],
    run(g, ctx) { void ctx; return { graph: g, idMap: {}, changes: [] }; }
  });
  const regularize = Object.freeze({
    name: 'regularize', g3b: true,
    may: ['sound', 'rests', 'pieces', 'tuplets', 'beams', 'acc'],
    run(g, ctx) { void ctx; return { graph: g, idMap: {}, changes: [] }; }
  });

  return Object.freeze({ rhythm, regularize });
});
