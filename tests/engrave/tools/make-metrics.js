/* G04 §18.2, §9.3: the glyph metrics the layout reads, taken once from the pinned font data.

     node tests/engrave/tools/make-metrics.js           write the table into engrave/metrics.js
     node tests/engrave/tools/make-metrics.js --check   exit 1 if engrave/metrics.js holds another table

   The layout never loads VexFlow and never measures a DOM: it reads this table. Each entry is the glyph's bounding box
   in the Bravura outlines of vendor/vexflow-4.2.3.js, in staff spaces (SMuFL: one em = 4 staff spaces, so a font unit
   is 4 / resolution sp), y up, rounded to 0.001 sp. A glyph the pinned font lacks is not in the table; the layout
   says so (MISSING_GLYPH) and uses the fallback metrics.js names. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const FILE = path.join(REPO, 'engrave', 'metrics.js');
const BEGIN = '  /* BEGIN GENERATED (tests/engrave/tools/make-metrics.js) */', END = '  /* END GENERATED */';

/* every glyph metrics.js may name */
const NAMES = [
  'noteheadBlack', 'noteheadHalf', 'noteheadWhole', 'noteheadDoubleWhole',
  'noteheadXBlack', 'noteheadXHalf', 'noteheadXWhole', 'noteheadCircleX',
  'noteheadDiamondBlack', 'noteheadDiamondHalf', 'noteheadDiamondWhole',
  'noteheadTriangleUpBlack', 'noteheadTriangleUpHalf', 'noteheadTriangleUpWhole',
  'noteheadSquareBlack', 'noteheadSquareWhite', 'noteheadParenthesisLeft', 'noteheadParenthesisRight',
  'accidentalSharp', 'accidentalFlat', 'accidentalNatural', 'accidentalDoubleSharp', 'accidentalDoubleFlat',
  'accidentalQuarterToneSharpStein', 'accidentalQuarterToneFlatStein', 'accidentalParensLeft', 'accidentalParensRight',
  'augmentationDot',
  'gClef', 'fClef', 'cClef', 'unpitchedPercussionClef1', '6stringTabClef',
  'timeSig0', 'timeSig1', 'timeSig2', 'timeSig3', 'timeSig4', 'timeSig5', 'timeSig6', 'timeSig7', 'timeSig8', 'timeSig9',
  'timeSigCommon', 'timeSigCutCommon', 'timeSigPlus', 'timeSigPlusSmall',
  'restDoubleWhole', 'restWhole', 'restHalf', 'restQuarter', 'rest8th', 'rest16th', 'rest32nd', 'rest64th', 'rest128th',
  'flag8thUp', 'flag8thDown', 'flag16thUp', 'flag16thDown', 'flag32ndUp', 'flag32ndDown', 'flag64thUp', 'flag64thDown',
  'flag128thUp', 'flag128thDown',
  /* G4d-1a: marks attached to notes (G04 §10.2 priority 5) */
  'articStaccatoAbove', 'articStaccatoBelow', 'articStaccatissimoAbove', 'articStaccatissimoBelow', 'articTenutoAbove', 'articTenutoBelow',
  'articAccentAbove', 'articAccentBelow', 'articMarcatoAbove', 'articMarcatoBelow',
  'fermataAbove', 'fermataBelow', 'fermataShortAbove', 'fermataShortBelow', 'fermataLongAbove', 'fermataLongBelow',
  'ornamentTrill', 'ornamentMordent', 'ornamentShortTrill', 'ornamentTurn', 'tremolo1', 'breathMarkComma', 'caesura',
  /* G4d-1b: marks attached to systems (G04 §10.2 priorities 8-10, §18.2): the dynamics letters, the pedal signs, segno and coda */
  'dynamicPiano', 'dynamicMezzo', 'dynamicForte', 'dynamicRinforzando', 'dynamicSforzando', 'dynamicZ',
  'keyboardPedalPed', 'keyboardPedalUp', 'segno', 'coda'
];

function build() {
  const m = require(path.join(REPO, 'vendor', 'vexflow-4.2.3.js'));
  const VF = m.Flow || m;
  const font = VF.getMusicFontStack()[0];
  if (font.getName() !== 'Bravura') throw new Error('the first font of the pinned stack is ' + font.getName());
  const glyphs = font.getGlyphs(), res = font.getResolution();
  const sp = u => Math.round(u * 4 / res * 1000) / 1000;
  const lines = [];
  NAMES.forEach(n => {
    const g = glyphs[n];
    if (!g) return;
    lines.push('    ' + JSON.stringify(n) + ': [' + [g.x_min, g.x_max, g.y_min, g.y_max].map(sp).join(', ') + ']');
  });
  return BEGIN + '\n  const GLYPHS = Object.freeze({\n' + lines.join(',\n') + '\n  });\n' + END;
}

function splice(text, block) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('engrave/metrics.js has no generated block');
  return text.slice(0, a) + block + text.slice(b + END.length);
}

if (require.main === module) {
  const cur = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const next = splice(cur, build());
  if (process.argv.indexOf('--check') > 0) {
    console.log(cur === next ? 'engrave/metrics.js holds the pinned font\'s metrics' : 'engrave/metrics.js DIFFERS from the pinned font');
    process.exit(cur === next ? 0 : 1);
  }
  fs.writeFileSync(FILE, next);
  console.log('wrote the metrics of ' + (next.match(/^\s{4}"/gm) || []).length + ' glyphs into engrave/metrics.js');
}
module.exports = { build, NAMES };
