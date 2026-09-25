/* ============================================================================
   PPP engrave — glyph metrics (docs/GOALS/G04 §9.3, §18.2, §20)

   The layout's only source of glyph sizes. GLYPHS is generated from the pinned
   font data (tests/engrave/tools/make-metrics.js, `--check` in CI): each entry
   is a Bravura glyph's bounding box [xMin, xMax, yMin, yMax] in staff spaces
   (SMuFL: one em = 4 sp), y up, 0.001 sp. Nothing here loads VexFlow or
   measures a DOM, so Node and a browser lay out the same numbers.

   The lookups below turn notation (a notehead shape, an accidental, a rest
   value, a clef sign) into glyph names. A name the pinned font lacks falls back
   to the nearest glyph it has and says so (`missing: true`); the layout turns
   that into a MISSING_GLYPH diagnostic.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).metrics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* BEGIN GENERATED (tests/engrave/tools/make-metrics.js) */
  const GLYPHS = Object.freeze({
    "noteheadBlack": [0, 1.18, -0.5, 0.5],
    "noteheadHalf": [0, 1.18, -0.5, 0.5],
    "noteheadWhole": [0, 1.688, -0.5, 0.5],
    "noteheadDoubleWhole": [0, 2.396, -0.62, 0.62],
    "noteheadXBlack": [0, 1.16, -0.5, 0.5],
    "noteheadXHalf": [0, 1.336, -0.5, 0.5],
    "noteheadXWhole": [0, 1.508, -0.5, 0.5],
    "noteheadCircleX": [0, 0.996, -0.5, 0.5],
    "noteheadDiamondBlack": [0, 1, -0.5, 0.5],
    "noteheadDiamondHalf": [0, 1.004, -0.5, 0.5],
    "noteheadDiamondWhole": [0, 1.08, -0.5, 0.5],
    "noteheadTriangleUpBlack": [0, 1.172, -0.5, 0.5],
    "noteheadTriangleUpHalf": [0, 1.14, -0.5, 0.5],
    "noteheadTriangleUpWhole": [0, 1.276, -0.5, 0.5],
    "noteheadSquareBlack": [0, 1.252, -0.5, 0.5],
    "noteheadSquareWhite": [0, 1.252, -0.5, 0.5],
    "noteheadParenthesisLeft": [0, 0.436, -0.724, 0.724],
    "noteheadParenthesisRight": [-0.144, 0.292, -0.724, 0.724],
    "accidentalSharp": [0, 0.996, -1.392, 1.4],
    "accidentalFlat": [0, 0.904, -0.7, 1.756],
    "accidentalNatural": [0, 0.672, -1.34, 1.364],
    "accidentalDoubleSharp": [0, 0.988, -0.5, 0.508],
    "accidentalDoubleFlat": [0, 1.644, -0.7, 1.748],
    "accidentalQuarterToneSharpStein": [0, 0.716, -1.412, 1.228],
    "accidentalQuarterToneFlatStein": [0.004, 0.908, -0.7, 1.756],
    "accidentalParensLeft": [0, 0.564, -0.992, 0.988],
    "accidentalParensRight": [0, 0.564, -0.992, 0.988],
    "augmentationDot": [0, 0.4, -0.2, 0.2],
    "gClef": [0, 2.684, -2.632, 4.392],
    "fClef": [-0.02, 2.736, -2.54, 1.048],
    "cClef": [0, 2.796, -2.024, 2.024],
    "unpitchedPercussionClef1": [0, 1.528, -1, 1],
    "6stringTabClef": [-0.012, 1.632, -2.992, 3.056],
    "timeSig0": [0.08, 1.8, -1, 1.004],
    "timeSig1": [0.08, 1.256, -1, 1.004],
    "timeSig2": [0.08, 1.704, -1.028, 1.016],
    "timeSig3": [0.08, 1.604, -1.004, 0.996],
    "timeSig4": [0.08, 1.8, -1, 1.004],
    "timeSig5": [0.08, 1.532, -1.004, 0.984],
    "timeSig6": [0.08, 1.656, -0.996, 1.004],
    "timeSig7": [0.08, 1.684, -1, 0.996],
    "timeSig8": [0.08, 1.664, -1.036, 1.036],
    "timeSig9": [0.08, 1.656, -0.996, 1.004],
    "timeSigCommon": [0.02, 1.696, -0.996, 1.004],
    "timeSigCutCommon": [0, 1.672, -1.436, 1.444],
    "timeSigPlus": [-0.004, 1.996, -1, 1],
    "timeSigPlusSmall": [-0.004, 1.02, -0.532, 0.492],
    "restDoubleWhole": [0, 0.5, 0, 1],
    "restWhole": [0, 1.128, -0.54, 0.036],
    "restHalf": [0, 1.128, -0.008, 0.568],
    "restQuarter": [0.004, 1.08, -1.5, 1.492],
    "rest8th": [0, 0.988, -1.004, 0.696],
    "rest16th": [0, 1.28, -2, 0.716],
    "rest32nd": [0, 1.452, -2, 1.704],
    "rest64th": [0, 1.692, -3.012, 1.72],
    "rest128th": [0, 1.94, -3, 2.756],
    "flag8thUp": [0, 1.056, -3.24, 0.036],
    "flag8thDown": [0, 1.224, -0.056, 3.232],
    "flag16thUp": [0, 1.116, -3.252, 0.008],
    "flag16thDown": [0, 1.164, -0.036, 3.248],
    "flag32ndUp": [0, 1.044, -3.248, 0.596],
    "flag32ndDown": [0, 1.092, -0.688, 3.248],
    "flag64thUp": [0, 1.044, -3.248, 1.388],
    "flag64thDown": [0, 1.092, -1.504, 3.248],
    "flag128thUp": [0, 1.044, -3.248, 2.132],
    "flag128thDown": [0, 1.092, -2.32, 3.248]
  });
  /* END GENERATED */

  /* Engraving constants in staff spaces (G04 §9.3, §10, §15.3; Bravura engravingDefaults where G04 names none) */
  const ENGRAVING = Object.freeze({
    staffLine: 0.13,        /* staff line thickness */
    stem: 0.12,             /* stem thickness */
    stemLength: 3.5,        /* an unbeamed stem, from the outermost head (G4c sets beamed stems) */
    ledger: 0.16,           /* ledger line thickness */
    ledgerOverhang: 0.2,    /* ledger line beyond the notehead, each side (§9.3) */
    thinBar: 0.16, thickBar: 0.5, barGap: 0.4,     /* barlines */
    repeatDotGap: 0.16,     /* between a repeat barline and its dots */
    dotGap: 0.3,            /* notehead to the first augmentation dot */
    dotSpacing: 0.2,        /* between augmentation dots */
    accidentalGap: 0.2,     /* accidental to notehead, and between accidental columns */
    keyAccidentalGap: 0.1,  /* between the accidentals of a key signature */
    timeDigitGap: 0.05,     /* between the digits of one time signature number */
    graceGap: 0.2           /* between grace notes, and to the principal note */
  });
  /* sizes relative to a normal glyph */
  const SCALE = Object.freeze({ grace: 0.66, clefChange: 2 / 3, octaveDigit: 0.55 });
  /* Shapes the pinned font has no outline for but VexFlow draws as a path of its own, with the size it draws them:
     the slash notehead is Tables.SLASH_NOTEHEAD_WIDTH = 15 px wide (1.5 sp at 10 px a staff space) and reaches a
     space above and below its position. A backend draws these (`drawn: true`); they are not fallbacks. */
  const DRAWN = Object.freeze({ noteheadSlashHorizontalEnds: [0, 1.5, -1, 1] });

  const table = name => (Object.prototype.hasOwnProperty.call(GLYPHS, name) ? GLYPHS[name]
    : Object.prototype.hasOwnProperty.call(DRAWN, name) ? DRAWN[name] : null);
  const has = name => table(name) !== null;
  const drawn = name => Object.prototype.hasOwnProperty.call(DRAWN, name);
  /* -> {name, xMin, xMax, yMin, yMax, w} | null */
  function glyph(name) {
    const g = table(name);
    if (!g) return null;
    return { name: name, xMin: g[0], xMax: g[1], yMin: g[2], yMax: g[3], w: g[1] - g[0] };
  }
  /* the screen box (y down) of a glyph drawn with its origin at (x, y) and the given scale */
  function box(name, x, y, scale) {
    const g = table(name), s = scale === undefined ? 1 : scale;
    if (!g) return [x, y, x, y];
    return [x + g[0] * s, y - g[3] * s, x + g[1] * s, y - g[2] * s];
  }
  /* a name, or a substitute when the pinned font lacks it: {name, missing, wanted} (the layout reports GLYPH_FALLBACK) */
  const pick = (want, fallback) => (has(want) ? { name: want, missing: false } : { name: fallback, missing: true, wanted: want });

  /* ---- noteheads: the shape the graph states, filled as the value is (or as the graph says) */
  function headClass(type, filled) {
    const t = type || 'quarter';
    let cls = t === 'whole' ? 'whole' : (t === 'breve' || t === 'long' || t === 'maxima') ? 'breve' : t === 'half' ? 'half' : 'black';
    if (filled === true) cls = 'black';
    else if (filled === false && cls === 'black') cls = 'half';
    return cls;
  }
  const HEADS = {
    normal: { black: 'noteheadBlack', half: 'noteheadHalf', whole: 'noteheadWhole', breve: 'noteheadDoubleWhole' },
    'x': { black: 'noteheadXBlack', half: 'noteheadXHalf', whole: 'noteheadXWhole', breve: 'noteheadXWhole' },
    'circle-x': { black: 'noteheadCircleX', half: 'noteheadCircleX', whole: 'noteheadCircleX', breve: 'noteheadCircleX' },
    diamond: { black: 'noteheadDiamondBlack', half: 'noteheadDiamondHalf', whole: 'noteheadDiamondWhole', breve: 'noteheadDiamondWhole' },
    triangle: { black: 'noteheadTriangleUpBlack', half: 'noteheadTriangleUpHalf', whole: 'noteheadTriangleUpWhole', breve: 'noteheadTriangleUpWhole' },
    square: { black: 'noteheadSquareBlack', half: 'noteheadSquareWhite', whole: 'noteheadSquareWhite', breve: 'noteheadSquareWhite' },
    /* slash: a shape VexFlow draws (DRAWN); cross (a plus): no glyph and no drawn shape - the x head stands in */
    slash: { black: 'noteheadSlashHorizontalEnds', half: 'noteheadSlashHorizontalEnds', whole: 'noteheadSlashHorizontalEnds', breve: 'noteheadSlashHorizontalEnds' },
    cross: { black: 'noteheadPlusBlack', half: 'noteheadPlusHalf', whole: 'noteheadPlusWhole', breve: 'noteheadPlusWhole' }
  };
  const HEAD_FALLBACK = { cross: 'x' };
  function notehead(type, shape, filled) {
    const cls = headClass(type, filled);
    const row = HEADS[shape || 'normal'] || HEADS.normal;
    return pick(row[cls], (HEADS[HEAD_FALLBACK[shape]] || HEADS.normal)[cls]);
  }

  /* ---- accidentals: one or more glyphs, left to right */
  const ACC = {
    'sharp': ['accidentalSharp'], 'flat': ['accidentalFlat'], 'natural': ['accidentalNatural'],
    'double-sharp': ['accidentalDoubleSharp'], 'flat-flat': ['accidentalDoubleFlat'],
    'sharp-sharp': ['accidentalSharp', 'accidentalSharp'], 'natural-sharp': ['accidentalNatural', 'accidentalSharp'],
    'natural-flat': ['accidentalNatural', 'accidentalFlat'],
    'quarter-sharp': ['accidentalQuarterToneSharpStein'], 'quarter-flat': ['accidentalQuarterToneFlatStein']
  };
  function accidental(type) { return (ACC[type] || ['accidentalNatural']).map(n => pick(n, 'accidentalNatural')); }

  /* ---- rests, flags */
  const RESTS = { maxima: 'restDoubleWhole', long: 'restDoubleWhole', breve: 'restDoubleWhole', whole: 'restWhole', half: 'restHalf',
    quarter: 'restQuarter', eighth: 'rest8th', '16th': 'rest16th', '32nd': 'rest32nd', '64th': 'rest64th', '128th': 'rest128th' };
  function rest(type) { return pick(RESTS[type || 'quarter'] || 'rest256th', 'rest128th'); }
  const FLAGS = { eighth: '8th', '16th': '16th', '32nd': '32nd', '64th': '64th', '128th': '128th' };
  const FLAG_COUNT = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5, '256th': 6, '512th': 7, '1024th': 8 };
  /* -> null when the value has no flag */
  function flag(type, up) {
    if (!FLAG_COUNT[type]) return null;
    const d = up ? 'Up' : 'Down';
    return pick('flag' + (FLAGS[type] || '256th') + d, 'flag128th' + d);
  }
  const flagCount = type => FLAG_COUNT[type] || 0;

  /* ---- clefs, time signatures */
  const CLEFS = { G: 'gClef', F: 'fClef', C: 'cClef', percussion: 'unpitchedPercussionClef1', TAB: '6stringTabClef' };
  function clef(sign) { return CLEFS[sign] ? pick(CLEFS[sign], 'gClef') : null; }
  const digit = d => pick('timeSig' + d, 'timeSig0');

  return Object.freeze({ GLYPHS, DRAWN, ENGRAVING, SCALE, glyph, box, has, drawn, headClass, notehead, accidental, rest, flag, flagCount, clef, digit });
});
