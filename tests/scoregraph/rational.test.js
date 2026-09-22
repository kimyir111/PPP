'use strict';
/* Exact rationals (G01 §6.1, §6.10, A2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, lcg } = require('./helpers.js');
const R = SG.rational;

test('make reduces by the gcd and keeps the sign in the numerator', () => {
  assert.deepEqual(R.make(2, 4), { n: 1, d: 2 });
  assert.deepEqual(R.make(-3, -6), { n: 1, d: 2 });
  assert.deepEqual(R.make(3, -6), { n: -1, d: 2 });
  assert.deepEqual(R.make(0, 7), { n: 0, d: 1 });
  assert.throws(() => R.make(1, 0), RangeError);
  assert.throws(() => R.make(0.5, 1), TypeError);
});

test('arithmetic and comparison are exact', () => {
  const q = R.parse;
  assert.equal(R.format(R.add(q('1/12'), q('1/12'))), '1/6');
  assert.equal(R.format(R.add(R.add(q('1/12'), q('1/12')), q('1/12'))), '1/4');
  assert.equal(R.format(R.sub(q('1/4'), q('1/3'))), '-1/12');
  assert.equal(R.format(R.mul(q('1/32'), R.mul(q('2/3'), q('4/5')))), '1/60');
  assert.equal(R.format(R.div(q('3/8'), q('1/8'))), '3');
  assert.equal(R.cmp(q('1/3'), q('333333/1000000')), 1);
  assert.equal(R.cmp(R.make(2, 6), q('1/3')), 0);
  assert.equal(R.floor(q('-1/2')), -1);
  assert.equal(R.floor(q('7/2')), 3);
});

test('the text form is reduced, "/d" only for d >= 2, within 2^31 - 1', () => {
  ['0', '5', '-1/4', '3/8', '2147483647', '1/2147483647'].forEach(s => assert.equal(R.format(R.parse(s)), s));
  ['2/4', '0/1', '3/1', '1/0', '01', '-0', '1.5', '', ' 1', '1/ 2', '2147483648', 'a'].forEach(s => {
    assert.equal(R.isValid(s), false, s);
    assert.throws(() => R.parse(s), e => e.code === 'E-RATIONAL', s);
  });
  assert.equal(R.isValid(1), false);
});

test('an intermediate beyond the safe integers throws RationalOverflow', () => {
  const big = R.make(Number.MAX_SAFE_INTEGER, 1);
  assert.throws(() => R.add(big, R.ONE), e => e.code === 'RationalOverflow');
  assert.throws(() => R.mul(R.make(2 ** 30), R.make(2 ** 30)), e => e.code === 'RationalOverflow');
  assert.throws(() => R.make(2 ** 53, 1), e => e.code === 'RationalOverflow');
  /* comparison stays exact past the safe range through BigInt */
  assert.equal(R.cmp(R.make(Number.MAX_SAFE_INTEGER, 3), R.make(Number.MAX_SAFE_INTEGER - 1, 3)), 1);
});

test('10,000 LCG pairs: (a + b) - b == a and format(parse(s)) == s', () => {
  const rnd = lcg(20260922);
  const DENOMS = [1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 60, 64, 96, 120, 480, 960, 10080];
  for (let i = 0; i < 10000; i++) {
    const a = R.make(Math.floor(rnd() * 20001) - 10000, DENOMS[Math.floor(rnd() * DENOMS.length)]);
    const b = R.make(Math.floor(rnd() * 20001) - 10000, DENOMS[Math.floor(rnd() * DENOMS.length)]);
    assert.ok(R.eq(R.sub(R.add(a, b), b), a), R.format(a) + ' ' + R.format(b));
    const s = R.format(a);
    assert.equal(R.format(R.parse(s)), s);
  }
});

test('microseconds round half up once, from a rational or a decimal of seconds (§6.10)', () => {
  assert.equal(R.micros(R.make(20, 3)), 6666667);
  assert.equal(R.micros(R.make(1, 2000000)), 1);        /* 0.5 us rounds up */
  assert.equal(R.micros(R.make(1, 2000001)), 0);
  assert.equal(R.secondsToMicros(1.037), 1037000);
  assert.equal(R.secondsToMicros(0.0000005), 1);        /* "5e-7" */
  assert.equal(R.secondsToMicros(12.3456785), 12345679);
  assert.throws(() => R.secondsToMicros(-1), RangeError);
});
