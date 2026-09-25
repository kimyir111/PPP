/* ============================================================================
   PPP engrave — which SMuFL glyph draws each ornament (docs/GOALS/G04 §18.2)

   The plan names the glyph an ornament needs by its SMuFL name, so the plan
   stays engine-independent (SMuFL is the standard, not VexFlow). The pinned
   font data (vendor/vexflow-4.2.3.js, Bravura subset) does not hold every
   SMuFL glyph. An ornament of the schema whose glyph is missing is deferred
   (code ornament-glyph, user decision G4-U5): what to draw instead is a G4d
   decision about marks, not a G4a one. An ornament the schema does not know is
   unsupported (the audit fails). tests/engrave/glyphs.test.js checks the table
   against the vendored file, both ways. This table decides a disposition; it
   draws nothing.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).glyphs = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* every ornament the schema knows (schema.js ORNAMENTS) -> its SMuFL glyph */
  const ORNAMENT = Object.freeze({
    'trill': 'ornamentTrill',
    'mordent': 'ornamentMordent',
    'inverted-mordent': 'ornamentShortTrill',
    'turn': 'ornamentTurn',
    'inverted-turn': 'ornamentTurnInverted',
    'tremolo': 'tremolo1',
    'shake': 'ornamentShake3',
    'schleifer': 'ornamentSchleifer'
  });

  /* the SMuFL glyphs above that the pinned font data lacks (checked against the vendored file) */
  const MISSING = Object.freeze(['ornamentTurnInverted', 'ornamentShake3', 'ornamentSchleifer']);

  /* -> {known, glyph, missing} */
  function ornament(type) {
    const glyph = Object.prototype.hasOwnProperty.call(ORNAMENT, type) ? ORNAMENT[type] : null;
    return { known: !!glyph, glyph: glyph, missing: !!glyph && MISSING.indexOf(glyph) >= 0 };
  }

  return Object.freeze({ ORNAMENT, MISSING, ornament });
});
