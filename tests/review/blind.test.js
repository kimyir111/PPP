/* G9c: the blind assignment rule (review/lib/blind.js) - pure, no arranging. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const B = require(path.join(REPO, 'review/lib/blind.js'));

const fake = n => Array.from({ length: n }, (_, i) => ({ file: 'catalog/x/' + String(i).padStart(3, '0') + '.mxl', targetLevel: 2 + (i % 5) / 2, handProfile: 'large' }));
const asMap = a => Object.fromEntries(a.map(s => [s.key, s.x + '@' + s.id]));

test('the same items and seed give the same assignment and order, however the caller listed the items', () => {
  const items = fake(12);
  const a = B.assign(items, 'secret-one');
  const shuffled = items.slice().reverse();
  [3, 7, 1, 9].forEach(i => shuffled.push(shuffled.splice(i, 1)[0]));
  const b = B.assign(shuffled, 'secret-one');
  assert.deepEqual(asMap(a), asMap(b));
  assert.deepEqual(a.map(s => s.key), b.map(s => s.key), 'the shown order is the same too');
});

test('a different seed gives a different assignment and a different order', () => {
  const items = fake(16);
  const a = B.assign(items, 'secret-one'), b = B.assign(items, 'secret-two');
  const xs = s => Object.fromEntries(s.map(x => [x.key, x.x]));
  assert.notDeepEqual(xs(a), xs(b), 'X/Y assignment differs');
  assert.notDeepEqual(a.map(s => s.key), b.map(s => s.key), 'shown order differs');
});

test('the split is as even as it can be (position bias cannot pass for a preference)', () => {
  [4, 7, 12, 13, 16].forEach(n => {
    ['s1-abcd', 's2-abcd', 's3-abcd'].forEach(seed => {
      const g9x = B.assign(fake(n), seed).filter(s => s.x === 'g9').length;
      assert.ok(Math.abs(g9x - n / 2) <= 0.5, 'n=' + n + ' seed=' + seed + ': ' + g9x + ' items have G9 as X');
    });
  });
});

test('every item has G9 on exactly one side, and ids are i01.. in shown order', () => {
  const a = B.assign(fake(10), 'secret-one');
  a.forEach((s, i) => {
    assert.equal(s.id, 'i' + String(i + 1).padStart(2, '0'));
    assert.deepEqual([s.x, s.y].sort(), ['g9', 'legacy']);
  });
});

test('a missing or trivial seed is refused, and so are duplicate items', () => {
  assert.throws(() => B.assign(fake(3), ''), /seed/);
  assert.throws(() => B.assign(fake(3), null), /seed/);
  assert.throws(() => B.assign(fake(3), 'ab'), /seed/);
  const items = fake(3); items.push(Object.assign({}, items[0]));
  assert.throws(() => B.assign(items, 'secret-one'), /same file/);
});

test('the assignment is keyed: without the seed the public rule (unkeyed hash) does not reproduce it', () => {
  const items = fake(16), a = B.assign(items, 'a-long-secret-seed');
  /* a reviewer who knew the rule but not the seed would try an unkeyed hash of the item key, or of key+guess: none should match X/Y on all 16 */
  const crypto = require('crypto');
  const tries = [k => k, k => 'xy|' + k, k => '|' + k].map(f => it => parseInt(crypto.createHash('sha256').update(f(it)).digest('hex').slice(0, 8), 16) % 2 === 0);
  tries.forEach(t => {
    const hits = a.filter(s => (t(s.key) ? 'g9' : 'legacy') === s.x).length;
    assert.ok(hits < 16 && hits > 0, 'an unkeyed guess reproduced ' + hits + '/16 - it should look like chance');
  });
});
