'use strict';
/* G11b-2: practice/learner.js, the learner model v1 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.2, §20). Every entry is made by
   practice/runlog.js's own builder (tests/practice/learner-helpers.js), the shape the page logs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const LE = require(path.join(__dirname, '..', '..', 'practice', 'learner.js'));
const { piece, entry, DAY, MIN, T0 } = require('./learner-helpers.js');

const acc = (m, i, cond, t) => LE.predictMeasure(m, i, Object.assign({ ratio: 1, hands: 'both' }, cond), t);
const sdA = (m, i, h) => Math.sqrt(m.measures[i][h || 'r'].vaa);

test('a new model: every measure starts from the population prior, wide; a piece is required', () => {
  const m = LE.create(piece(4));
  assert.equal(m.measures.length, 4);
  for (let i = 0; i < 4; i++) {
    const p = acc(m, i, {}, T0);
    assert.ok(Math.abs(p - 0.75) < 0.12, 'prior accuracy near 0.75 (the mean of sigma under the spread is pulled toward 0.5): ' + p);
    assert.equal(LE.view(m, i, T0).state, 'new');
  }
  assert.throws(() => LE.create(null), /needs its measures/);
  assert.equal(JSON.stringify(LE.create(piece(3))), JSON.stringify(LE.create(piece(3))), 'deterministic');
});

test('typed evidence: a simulated run, an unknown kind or a broken entry is refused and changes nothing (G11-D5)', () => {
  const pc = piece(4);
  const m = LE.create(pc);
  const before = JSON.stringify(m.measures);
  assert.deepEqual(LE.update(m, entry(pc, T0, 0, 3, 0.9, { src: 'simulated' })), { ok: false, code: 'simulated' });
  assert.deepEqual(LE.update(m, Object.assign(entry(pc, T0, 0, 3, 0.9), { src: 'idle' })), { ok: false, code: 'source' });
  assert.deepEqual(LE.update(m, Object.assign(entry(pc, T0, 0, 3, 0.9), { at: NaN })), { ok: false, code: 'invalid' });
  assert.deepEqual(LE.update(m, null), { ok: false, code: 'invalid' });
  assert.deepEqual(LE.update(m, Object.assign(entry(pc, T0, 0, 3, 0.9), { R: 'x' })), { ok: false, code: 'invalid' });
  assert.equal(JSON.stringify(m.measures), before);
  assert.equal(m.version, 0);
  assert.deepEqual(m.refused, { simulated: 1, source: 1, invalid: 3 });
});

test('a measured run moves the belief toward what was played and narrows it', () => {
  const pc = piece(3);
  const m = LE.create(pc);
  const p0 = acc(m, 0, {}, T0), s0 = sdA(m, 0);
  for (let k = 0; k < 6; k++) LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1.0));
  for (let k = 0; k < 6; k++) LE.update(m, entry(pc, T0 + k * MIN, 1, 1, 0.34));
  const t = T0 + 6 * MIN;
  assert.ok(acc(m, 0, {}, t) > p0 + 0.1 && acc(m, 0, {}, t) > 0.9, 'clean runs: ' + acc(m, 0, {}, t));
  assert.ok(acc(m, 1, {}, t) < 0.5, 'poor runs: ' + acc(m, 1, {}, t));
  assert.ok(sdA(m, 0) < s0 * 0.7, 'narrower');
  assert.equal(m.measures[0].r.runs, 6);
  assert.equal(m.runs, 12);
  assert.equal(LE.view(m, 2, t).state, 'new', 'a bar nobody played is still new');
});

test('tempo: clean when slow and lost at the score tempo is believed - and slowing down never hurts (t >= 0)', () => {
  const pc = piece(1);
  const m = LE.create(pc);
  for (let k = 0; k < 12; k++) {
    LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1, { ratio: 0.6 }));
    LE.update(m, entry(pc, T0 + k * MIN + 1000, 0, 0, 0.4, { ratio: 1 }));
  }
  const t = T0 + 13 * MIN;
  const slow = acc(m, 0, { ratio: 0.6 }, t), full = acc(m, 0, { ratio: 1 }, t);
  /* (the model expects a player to improve a little with every run, `learn`: 0.4 played sixteen times reads somewhat higher) */
  assert.ok(slow > 0.8 && full < 0.66 && slow - full > 0.2, slow + ' ' + full);
  assert.ok(m.measures[0].r.t > 0 && m.measures[0].l.t > 0);
  /* the credibility of "clean" only grows as the tempo comes down; cleanTempo is the fastest step where it reaches 80 % */
  let prev = -1;
  for (let r = 1; r >= 0.4 - 1e-9; r -= 0.05) { const p = LE.pAtLeast(m, 0, 0.9, r, t); assert.ok(p >= prev - 1e-12); prev = p; }
  const ct = LE.cleanTempo(m, 0, t);
  assert.ok(ct === null || (ct < 0.9 && LE.pAtLeast(m, 0, 0.9, ct, t) >= 0.8 && !(LE.pAtLeast(m, 0, 0.9, ct + 0.05, t) >= 0.8)), 'cleanTempo ' + ct);
  const mc = LE.create(pc);
  for (let k = 0; k < 30; k++) LE.update(mc, entry(pc, T0 + k * MIN, 0, 0, 1));
  assert.equal(LE.cleanTempo(mc, 0, T0 + 31 * MIN), 1, 'clean at the score tempo');
  const mp = LE.create(pc);
  for (let k = 0; k < 30; k++) LE.update(mp, entry(pc, T0 + k * MIN, 0, 0, 0.2, { ratio: 0.4 }));
  assert.equal(LE.cleanTempo(mp, 0, T0 + 31 * MIN), null, 'never clean');
  /* fast-and-clean, slow-and-poor (impossible by the model's shape) does not make slowing down harmful */
  const m2 = LE.create(pc);
  for (let k = 0; k < 8; k++) { LE.update(m2, entry(pc, T0 + k * MIN, 0, 0, 0.3, { ratio: 0.5 })); LE.update(m2, entry(pc, T0 + k * MIN + 1, 0, 0, 0.95, { ratio: 1 })); }
  assert.ok(m2.measures[0].r.t >= 0 && acc(m2, 0, { ratio: 0.5 }, t) >= acc(m2, 0, { ratio: 1 }, t) - 1e-12);
});

test('one hand alone: evidence of one hand moves only that hand, and the alone bonus is taken off for hands together', () => {
  const pc = piece(1);
  const m = LE.create(pc);
  for (let k = 0; k < 8; k++) LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.9, { hands: 'left' }));
  const t = T0 + 9 * MIN;
  assert.equal(m.measures[0].r.runs, 0);
  assert.equal(m.measures[0].l.runs, 8);
  const alone = LE.predictMeasure(m, 0, { ratio: 1, hands: 'left' }, t);
  const together = LE.itemZ(m, 0, 'l', { ratio: 1, alone: false }, t);
  assert.ok(alone > LE.meanSigma(together.m, together.v), 'the left hand with both hands is believed worse than alone');
});

test('forgetting: the learned part decays toward the first estimate, the belief widens, and a new day of practice slows forgetting', () => {
  const pc = piece(1);
  const m = LE.create(pc);
  LE.update(m, entry(pc, T0, 0, 0, 0.5));
  for (let k = 1; k <= 30; k++) LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1));
  const t = T0 + 31 * MIN;
  const now = acc(m, 0, {}, t), later = acc(m, 0, {}, t + 10 * DAY), much = acc(m, 0, {}, t + 200 * DAY);
  const base = LE.sigma(m.measures[0].r.b);
  assert.ok(now > later + 0.02, 'it is forgotten: ' + now + ' -> ' + later);
  assert.ok(Math.abs(much - acc(Object.assign({}, m), 0, {}, t + 400 * DAY)) < 0.02 && much < now, 'toward a floor');
  assert.ok(base < now);
  assert.ok(LE.itemZ(m, 0, 'r', { ratio: 1 }, t + 10 * DAY).v > LE.itemZ(m, 0, 'r', { ratio: 1 }, t).v, 'wider after a pause');
  const h0 = m.measures[0].r.h;
  LE.update(m, entry(pc, t + 1 * DAY, 0, 0, 1));
  assert.ok(m.measures[0].r.h > h0, 'practised again on another day: forgets more slowly');
  const h1 = m.measures[0].r.h;
  LE.update(m, entry(pc, t + 1 * DAY + MIN, 0, 0, 1));
  assert.equal(m.measures[0].r.h, h1, 'the same day does not consolidate twice');
  /* predicting does not change the model */
  const snap = JSON.stringify(m);
  acc(m, 0, {}, t + 50 * DAY); LE.view(m, 0, t + 50 * DAY); LE.shortfall(m, 0, 0.9, t + 50 * DAY);
  assert.equal(JSON.stringify(m), snap);
});

test('follow and memory runs: notes known and recall move, the playing skill and the timing do not', () => {
  const pc = piece(2);
  const m = LE.create(pc);
  const skill = () => JSON.stringify(m.measures.map(x => [x.r.a, x.r.t, x.r.vaa, x.r.runs, x.r.ts, x.l.a, x.l.runs]));
  const before = skill();
  assert.ok(LE.update(m, entry(pc, T0, 0, 1, 0.4, { src: 'follow', signed: -90 })).ok);
  assert.ok(LE.update(m, entry(pc, T0 + MIN, 0, 1, 0.3, { src: 'memory' })).ok);
  assert.equal(skill(), before);
  const v = LE.view(m, 0, T0 + 2 * MIN);
  assert.ok(Math.abs(v.follow - 0.4) < 0.11, 'notes known ' + v.follow);
  assert.ok(Math.abs(v.recall - 0.3) < 0.11, 'recall ' + v.recall);
  assert.equal(v.state, 'new', 'no measured run yet');
  assert.equal(m.runs, 0, 'only measured runs count as runs');
});

test('timing: the signed mean says rushing, the device offset is a hint from on-time notes only', () => {
  const pc = piece(2);
  const m = LE.create(pc);
  for (let k = 0; k < 10; k++) LE.update(m, entry(pc, T0 + k * MIN, 0, 1, 0.9, { signed: -70, abs: 80 }));
  const v = LE.view(m, 0, T0 + 11 * MIN);
  assert.ok(v.timing.signed < -60 && v.timing.signed > -80, 'rushing ' + v.timing.signed);
  assert.ok(v.timing.abs > 70 && v.timing.abs < 90);
  assert.ok(Math.abs(LE.deviceOffset(m) + 70) < 1);
  const m2 = LE.create(pc);
  for (let k = 0; k < 10; k++) LE.update(m2, entry(pc, T0 + k * MIN, 0, 1, 0.9, { signed: 200, abs: 220 }));
  assert.equal(LE.deviceOffset(m2), null, 'notes far off are not "on time"');
});

test('the review boxes (§7.3 item 2): a clean run at tempo promotes a due measure once, a failed one drops it, a slow one does nothing', () => {
  const pc = piece(3);
  const m = LE.create(pc);
  LE.update(m, entry(pc, T0, 0, 2, 1));
  assert.deepEqual(m.measures.map(x => x.box), [0, 0, 0]);
  assert.equal(m.measures[0].due, T0 + 1 * DAY);
  LE.update(m, entry(pc, T0 + MIN, 0, 2, 1));
  assert.equal(m.measures[0].box, 0, 'not due yet: not promoted again');
  assert.deepEqual(LE.due(m, T0 + DAY - 1), []);
  assert.deepEqual(LE.due(m, T0 + DAY), [0, 1, 2]);
  LE.update(m, entry(pc, T0 + DAY, 0, 0, 1));
  LE.update(m, entry(pc, T0 + DAY, 1, 1, 0.3));
  LE.update(m, entry(pc, T0 + DAY, 2, 2, 1, { ratio: 0.5 }));
  assert.equal(m.measures[0].box, 1);
  assert.equal(m.measures[0].due, T0 + DAY + 2 * DAY);
  assert.equal(m.measures[1].box, -1, 'failed');
  assert.equal(m.measures[2].box, 0, 'a slow run neither promotes nor fails');
  assert.equal(LE.view(m, 2, T0 + DAY).reviewDue, true);
  LE.update(m, entry(pc, T0 + 2 * DAY, 0, 0, 1, { hands: 'left' }));
  assert.equal(m.measures[0].box, 1, 'one hand alone is not a check of the bar');
});

test('a merged row (a long lap: g > 1) shares its counts among the measures it covers', () => {
  const pc = piece(4);
  const m = LE.create(pc);
  const e = entry(pc, T0, 0, 3, 0.8);
  /* merge by two by hand, the way runlog does */
  const R = [];
  [0, 2].forEach(mi => [0, 1].forEach(h => { const rows = e.R.filter(r => (r[0] === mi || r[0] === mi + 1) && r[1] === h); R.push([mi, h, rows.reduce((s, r) => s + r[2], 0), rows.reduce((s, r) => s + r[3], 0), 0, 40]); }));
  assert.ok(LE.update(m, Object.assign({}, e, { g: 2, R: R })).ok);
  assert.deepEqual(m.measures.map(x => x.r.runs), [1, 1, 1, 1]);
});

test('a bar nobody has played borrows the FIRST readings of the others, not what practice made of them', () => {
  const pc = piece(3);
  const m = LE.create(pc);
  LE.update(m, entry(pc, T0, 0, 0, 0.5));
  const t1 = T0 + MIN;
  const unplayed = acc(m, 2, {}, t1);
  for (let k = 0; k < 40; k++) LE.update(m, entry(pc, T0 + (k + 2) * MIN, 0, 0, 1));
  const t2 = T0 + 50 * MIN;
  assert.ok(acc(m, 0, {}, t2) > 0.9);
  assert.ok(Math.abs(acc(m, 2, {}, t2) - unplayed) < 0.02, 'unplayed bar: ' + unplayed + ' -> ' + acc(m, 2, {}, t2));
});

test('views: the legacy state names, P(mastered) between 0 and 1 under uncertainty, and fold equals the updates in time order', () => {
  const pc = piece(4);
  const es = [];
  for (let k = 0; k < 12; k++) es.push(entry(pc, T0 + k * MIN, 0, 1, 1));
  for (let k = 0; k < 4; k++) es.push(entry(pc, T0 + (k + 20) * MIN, 2, 2, 0.3));
  const a = LE.create(pc);
  es.forEach(e => LE.update(a, e));
  const b = LE.fold(pc, es.slice().reverse());
  assert.equal(JSON.stringify(b.measures), JSON.stringify(a.measures));
  const t = T0 + 30 * MIN;
  const names = ['new', 'weak', 'learning', 'improving', 'stable', 'memory-ready', 'memorized', 'due'];
  for (let i = 0; i < 4; i++) assert.ok(names.indexOf(LE.view(a, i, t).state) >= 0);
  assert.equal(LE.view(a, 0, t).state, 'stable');
  assert.equal(LE.view(a, 0, t, { eligible: true }).state, 'memory-ready');
  assert.equal(LE.view(a, 0, t, { memorized: true, due: true }).state, 'due');
  assert.equal(LE.view(a, 2, t).state, 'weak');
  assert.equal(LE.view(a, 3, t).state, 'new');
  const pm = LE.view(a, 3, t).pMastered;
  assert.ok(pm > 0 && pm < 1, 'an unplayed bar is neither surely mastered nor surely not: ' + pm);
  /* a JSON round trip (the page would store or rebuild it) answers the same */
  const c = JSON.parse(JSON.stringify(a));
  assert.equal(acc(c, 1, { ratio: 0.8 }, t + DAY), acc(a, 1, { ratio: 0.8 }, t + DAY));
});

test('the shortfall below a target counts the uncertainty: an uncertain bar with a good mean still has one', () => {
  const pc = piece(2);
  const m = LE.create(pc);
  for (let k = 0; k < 60; k++) LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.97));
  LE.update(m, entry(pc, T0 + 61 * MIN, 1, 1, 0.97));
  const t = T0 + 62 * MIN;
  const sure = LE.shortfall(m, 0, 0.9, t), unsure = LE.shortfall(m, 1, 0.9, t);
  assert.ok(unsure > 3 * sure, sure + ' vs ' + unsure);
  assert.ok(LE.shortfall(m, 1, 0.9, t, null, true) < unsure, 'without the uncertainty it is smaller');
  assert.ok(LE.belowTarget(m, 1, 0.9, t) > LE.belowTarget(m, 0, 0.9, t));
});

test('the model never calls Math.random and costs little (160 bars: a lap update and a whole-piece update)', () => {
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random'); };
  try {
    const pc = piece(160);
    const m = LE.create(pc);
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 200; k++) LE.update(m, entry(pc, T0 + k * MIN, (k * 7) % 150, (k * 7) % 150 + 8, 0.7));
    const per = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    const t1 = process.hrtime.bigint();
    LE.update(m, entry(pc, T0 + 300 * MIN, 0, 159, 0.8));
    const whole = Number(process.hrtime.bigint() - t1) / 1e6;
    assert.ok(per < 5 && whole < 25, 'per lap ' + per.toFixed(3) + ' ms, whole piece ' + whole.toFixed(3) + ' ms (entry building included)');
  } finally { Math.random = random; }
});
