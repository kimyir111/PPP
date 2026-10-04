/* G10a-5 (H-10): which seconds of a piece are shown - the same seconds for both ways of writing it, chosen from the heard notes alone. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const EX = require(path.join(REPO, 'review/lib/h10-excerpt.js'));

/* notes of `perSecond` onsets a second, each held 0.4 s, between a and b seconds */
const run = (a, b, perSecond) => { const out = []; for (let t = a; t < b - 1e-9; t += 1 / perSecond) out.push({ on: Math.round(t * 1000) / 1000, off: Math.round((t + 0.4) * 1000) / 1000, midi: 60 }); return out; };
const bars = (start, len, n) => Array.from({ length: n + 1 }, (_, i) => Math.round((start + i * len) * 1000) / 1000);

test('a steady piece: the window is in the middle, as long as 12 of the arms\' bars, and the choice repeats exactly', () => {
  const heard = run(1, 101, 4);
  const o = { heard: heard, barStarts: { classic: bars(0.9, 2, 51), v2: bars(1.4, 2, 50) } };
  const a = EX.pickExcerpt(o), b = EX.pickExcerpt(o);
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(Math.abs(a.seconds - 24) < 0.01, 'twelve 2-second bars: ' + a.seconds);
  assert.ok(Math.abs((a.start + a.end) / 2 - 51) < 1, 'centred on the middle of the piece: ' + a.start);
});

test('silence is avoided: a gap in the middle moves the window to the nearer side with sound', () => {
  const heard = run(1, 45, 4).concat(run(60, 101, 4));      /* 15 s of nothing in the middle */
  const e = EX.pickExcerpt({ heard: heard, barStarts: { classic: bars(1, 2, 50), v2: bars(1, 2, 50) } });
  assert.ok(e.sounding >= 0.95, 'sounding: ' + e.sounding);
  assert.ok(e.end <= 47 || e.start >= 58, 'the window [' + e.start + ', ' + e.end + '] does not lie across the gap');
});

test('a near-empty stretch of long notes is passed over for a window with the piece\'s usual density', () => {
  const sparse = []; for (let t = 30; t < 70; t += 5) sparse.push({ on: t, off: t + 5.2, midi: 60 });   /* sounding all the time, one onset every 5 s */
  const heard = run(1, 30, 4).concat(sparse, run(70, 100, 4));
  const e = EX.pickExcerpt({ heard: heard, seconds: 12, barStarts: { classic: bars(1, 2, 49), v2: bars(1, 2, 49) } });
  assert.ok(e.onsetsPerSecond >= 0.6 * e.pieceMedianOnsetsPerSecond - 1e-9, 'density ' + e.onsetsPerSecond + ' vs median ' + e.pieceMedianOnsetsPerSecond);
});

test('both arms cover the window, whatever their bars are: at most one bar of margin at each end', () => {
  const heard = run(1, 101, 4);
  const barStarts = { classic: bars(-0.37, 1.48, 68), v2: bars(0.31, 3.1, 33) };       /* very different readings of the bars */
  const e = EX.pickExcerpt({ heard: heard, barStarts: barStarts });
  Object.keys(barStarts).forEach(a => {
    const arm = e.arms[a], bs = barStarts[a];
    assert.ok(arm.covers[0] <= e.start + 1e-6 && arm.covers[1] >= e.end - 1e-6, a + ' covers [' + arm.covers + '] which holds [' + e.start + ', ' + e.end + ']');
    assert.ok(e.start - arm.covers[0] < bs[1] - bs[0] + 1e-6 && arm.covers[1] - e.end < bs[1] - bs[0] + 1e-6, a + ' margin is under one bar');
    assert.equal(arm.count, arm.bars[1] - arm.bars[0] + 1);
  });
});

test('overrides: seconds, a given start, and a start outside the piece is moved inside; a short piece is shown whole', () => {
  const heard = run(1, 101, 4), bs = { classic: bars(1, 2, 50), v2: bars(1, 2, 50) };
  const a = EX.pickExcerpt({ heard: heard, barStarts: bs, seconds: 10 });
  assert.equal(a.seconds, 10);
  const b = EX.pickExcerpt({ heard: heard, barStarts: bs, seconds: 10, start: 20 });
  assert.equal(b.start, 20); assert.equal(b.end, 30); assert.match(b.how, /given start/);
  const c = EX.pickExcerpt({ heard: heard, barStarts: bs, seconds: 10, start: 500 });
  assert.ok(c.end <= 101.2 && /moved/.test(c.how), 'moved inside: ' + c.end + ' ' + c.how);
  const short = EX.pickExcerpt({ heard: run(1, 6, 4), barStarts: { classic: bars(1, 1, 5), v2: bars(1, 1, 5) }, seconds: 30 });
  assert.ok(short.seconds <= 5.5, 'never longer than the piece: ' + short.seconds);
});

test('barsCovering: the bar that holds the start through the bar that holds the end (the end belongs to the bar before one that begins on it)', () => {
  const bs = [0, 2, 4, 6, 8];
  assert.deepEqual(EX.barsCovering(bs, 2, 6), [1, 2]);
  assert.deepEqual(EX.barsCovering(bs, 2.5, 5.9), [1, 2]);
  assert.deepEqual(EX.barsCovering(bs, -3, 1), [0, 0]);
  assert.deepEqual(EX.barsCovering(bs, 0, 8), [0, 3]);
  assert.throws(() => EX.barsCovering([5], 0, 1), /no bars/);
});

test('no heard notes: an error, never a made-up window', () => {
  assert.throws(() => EX.chooseWindow([]), /no heard notes/);
});
