/* ============================================================================
   PPP ScoreGraph — G3 pass: P2 staff and limb, clef changes (§9); the automatic 8va (§13.3, off by default: D2)
   (docs/GOALS/G03)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proStaff = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const staff = Object.freeze({
    name: 'staff',
    may: ['place', 'rests', 'pieces', 'tuplets', 'beams', 'clefs', 'acc'],
    run(g, ctx) { void ctx; return { graph: g, idMap: {}, changes: [] }; }
  });
  const ottava = Object.freeze({
    name: 'ottava',
    may: ['ottava'],
    run(g, ctx) { void ctx; return { graph: g, idMap: {}, changes: [] }; }
  });

  return Object.freeze({ staff, ottava });
});
