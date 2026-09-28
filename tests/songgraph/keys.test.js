/* songgraph/keys.js: the regionKeys() wrapper. regionKeys itself (scoregraph/pro-spell.js) had no
   test anywhere in this repo before G07 (confirmed by grep) — real corpus data turned out to have
   zero modulating pieces (songgraph/tools/corpus-check.js; see the design doc's §12 correction), so
   this is also the first real check that regionKeys can find a modulation at all, on a synthetic
   piece built for the purpose (12 measures of C major then 12 of D major - long enough to clear
   regionKeys' own WINDOW+HOP=12-measure minimum twice over). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { K, mk } = require('./helpers.js');

function bars(pitches, n) { return Array.from({ length: n }, () => pitches).join(' | '); }

test('keyRegionsOf: a piece shorter than 12 measures reports regions: null, not a guess', () => {
  const g = mk({ time: [4, 4], rh: bars('C5:q E5:q G5:q C6:q', 4), lh: bars('C3:w', 4) });
  const [{ regions }] = K.keyRegionsOf(g);
  assert.equal(regions, null);
});

test('keyRegionsOf: 24 measures of plain C major triads is one region, fifths 0', () => {
  const g = mk({ time: [4, 4], rh: bars('C5:q E5:q G5:q C6:q', 24), lh: bars('C3:w', 24) });
  const [{ regions }] = K.keyRegionsOf(g);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].fifths, 0);
});

test('keyRegionsOf: 16 measures of C major then 16 of D major is detected as two regions', () => {
  const c = bars('C5:q E5:q G5:q C6:q', 16);
  const d = bars('D5:q F#5:q A5:q D6:q', 16);
  const cLh = bars('C3:w', 16), dLh = bars('D3:w', 16);
  const g = mk({ time: [4, 4], rh: c + ' | ' + d, lh: cLh + ' | ' + dLh });
  const [{ regions }] = K.keyRegionsOf(g);
  assert.ok(regions.length >= 2, 'expected a detected key change, got ' + JSON.stringify(regions));
  assert.equal(regions[0].fifths, 0);
  assert.equal(regions[regions.length - 1].fifths, 2);
});
