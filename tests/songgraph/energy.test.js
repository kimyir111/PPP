/* songgraph/energy.js unit tests: the per-measure density/spread/thickness curve, and that a
   printed dynamic (a real signal) changes the reading while its absence is reported honestly (null,
   not a guessed loudness). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E, mk } = require('./helpers.js');

test('energyOf: a measure of running sixteenths is busier than a measure of one whole note', () => {
  const g = mk({
    time: [4, 4],
    rh: 'C5:16 D5:16 E5:16 F5:16 G5:16 A5:16 B5:16 C6:16 D6:16 E6:16 F6:16 G6:16 A6:16 B6:16 C7:16 D7:16 | C5:w',
    lh: 'C3:w | C3:w'
  });
  const rows = E.energyOf(g);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].density > rows[1].density, 'the sixteenth-note measure should be denser');
  assert.ok(rows[0].energy > rows[1].energy, 'the busier measure should read as higher energy');
});

test('energyOf: a wide-register chord has a larger spread than a close one', () => {
  const g = mk({ time: [4, 4], rh: 'C4+C7:w', lh: 'r:w' });
  const [row] = E.energyOf(g);
  assert.equal(row.spread, 36); /* C4 (60) to C7 (96): 3 octaves */
});

test('energyOf: no printed dynamics anywhere reports dynamic: null throughout, not an invented loudness', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:w', lh: 'C3:w | C3:w' });
  const rows = E.energyOf(g);
  rows.forEach(r => assert.equal(r.dynamic, null));
});
