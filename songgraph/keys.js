/* ============================================================================
   PPP SongGraph — key regions (docs/GOALS/G07 §5 "key regions")

   keyRegionsOf(g, opts) -> [{part, regions: [{from, to, tonic, mode, fifths}] | null}]

   This wires up scoregraph/pro-spell.js's regionKeys(g, part, opening) directly (G07 design doc
   §3, §11: "reuse regionKeys() directly for key regions; do not write a second key-detection
   algorithm") and only compresses its per-measure output into contiguous regions. `regions` is
   null for a part too short to have windows (regionKeys' own rule: fewer than WINDOW+HOP=12
   measures) — reported as null, not an empty array, so a caller can tell "too short to say" apart
   from "one region, the whole piece" (which regionKeys also reports honestly when nothing changes).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/pro-spell.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.keys = factory(SG.proSpell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SP) {
  'use strict';

  function keyRegionsOf(g, opts) {
    opts = opts || {};
    return g.parts.filter(p => !opts.part || p.id === opts.part).map(part => {
      const perM = SP.regionKeys(g, part, opts.opening);
      if (!perM) return { part: part.id, regions: null };
      const ms = g.timeline.measures;
      const regions = [];
      let start = 0;
      for (let i = 1; i <= ms.length; i++) {
        if (i === ms.length || perM[i].fifths !== perM[start].fifths || perM[i].mode !== perM[start].mode) {
          regions.push({ from: ms[start].id, to: ms[i - 1].id, tonic: perM[start].tonic, mode: perM[start].mode, fifths: perM[start].fifths });
          start = i;
        }
      }
      return { part: part.id, regions: regions };
    });
  }

  return Object.freeze({ keyRegionsOf });
});
