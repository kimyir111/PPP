'use strict';
/* G11b-2: practice/policy.js, the practice policy v1 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.3, §20): each rule on a small
   piece whose evidence the test writes (through practice/runlog.js's builder), and Coach.validate - the app's own, cut out of
   the app file by tests/practice-sim/app-legacy.js - as the only door. The 10^4 random states are tests/practice/policy-validate.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const LE = require(path.join(__dirname, '..', '..', 'practice', 'learner.js'));
const PO = require(path.join(__dirname, '..', '..', 'practice', 'policy.js'));
const { piece, entry, ctxOf, DAY, MIN, T0 } = require('./learner-helpers.js');

let COACH = null;
const coach = () => COACH || (COACH = require('../practice-sim/app-legacy.js').build().E.Coach);

const idx = (pc, number) => pc.measures.findIndex(m => m.number === number);
const cur = t => ({ from: t.range.start, to: t.range.end, hands: t.hand, tempoPct: t.tempoPercent, mode: t.mode });

/* a person who does what the policy says: decide, play the task once with accFn, the model reads the lap */
function make(pc, o) {
  const s = { pc: pc, m: LE.create(pc, o && o.learner), st: PO.initState(), t: (o && o.t0) || T0, current: null, log: [], opts: o && o.policy, ctx: o && o.ctx };
  s.step = (accFn, lapMin) => {
    const d = PO.decide(s.m, s.t, s.st, { current: s.current, ctx: s.ctx, opts: s.opts });
    s.st = d.state;
    s.current = cur(d.task);
    s.log.push(d);
    const a = idx(pc, d.task.range.start), b = idx(pc, d.task.range.end);
    if (accFn) LE.update(s.m, entry(pc, s.t, a, b, accFn, { ratio: d.task.tempoPercent / 100, hands: d.task.hand, src: d.task.mode === 'memory' ? 'memory' : 'measured' }));
    s.t += (lapMin == null ? 0.5 : lapMin) * MIN;
    return d;
  };
  return s;
}
const clean = () => 1;
function cleanAll(s, n) { for (let i = 0; i < n; i++) LE.update(s.m, entry(s.pc, s.t - 1000 * (n - i), 0, s.pc.measures.length - 1, 1)); }

test('a piece nobody has played: the first task reads it through, hands together, once', () => {
  const pc = piece(12);
  const s = make(pc);
  const d = s.step(null);
  assert.equal(d.kind, 'read');
  assert.deepEqual(d.task.range, { start: 1, end: 12 });
  assert.equal(d.task.hand, 'both');
  assert.equal(d.task.mode, 'practice');
  assert.equal(d.task.repetitions, 1);
  assert.equal(d.task.tempoPercent, 100);
  assert.equal(d.changed, true);
  assert.equal(PO.decide(s.m, s.t, d.state, { current: cur(d.task) }).changed, false, 'the same task again is no change');
});

test('after the reading, the passage the model finds weakest is the one practised', () => {
  const pc = piece(12);
  const weak = (i) => (i === 6 || i === 7 ? 0.3 : 1);
  const s = make(pc, { policy: { maxLen: 4 } });
  s.step(weak);
  const d = s.step(weak);
  assert.equal(d.kind, 'focus');
  const a = idx(pc, d.task.range.start), b = idx(pc, d.task.range.end);
  assert.ok(a <= 6 && b >= 7 && b - a + 1 <= 4, 'window ' + a + '..' + b);
  /* with the default (up to 16 bars) the window holds them too */
  const s2 = make(pc);
  s2.step(weak);
  const d2 = s2.step(weak);
  assert.ok(idx(pc, d2.task.range.start) <= 6 && idx(pc, d2.task.range.end) >= 7);
});

test('stability (§7.3): the passage does not change for minDwell laps, whatever the laps show', () => {
  const pc = piece(12);
  const s = make(pc, { policy: { maxLen: 4 } });
  s.step(i => (i === 2 ? 0.3 : 1));
  const first = s.step(i => (i === 2 ? 0.3 : 1));
  const ranges = [];
  for (let k = 0; k < PO.DEFAULTS.minDwell - 1; k++) ranges.push(s.step(i => (i === 10 ? 0 : 1)).task.range);
  ranges.forEach(r => assert.deepEqual(r, first.task.range));
  /* and over a long run the passage changes at most once in three laps */
  const s2 = make(pc, { policy: { maxLen: 4 } });
  let flips = 0, prev = null;
  for (let k = 0; k < 300; k++) {
    const d = s2.step(i => 0.3 + 0.7 * ((i * 7 + k) % 5) / 4);
    const key = d.task.range.start + '-' + d.task.range.end;
    if (prev != null && key !== prev) flips++;
    prev = key;
  }
  assert.ok(flips <= 300 / 3, 'flips ' + flips);
});

test('the tempo ladder: start where most notes land, one step up after two clean laps, one down after two lost ones, within 40-100 %', () => {
  const pc = piece(4);
  const s = make(pc, { policy: { maxLen: 2 } });
  s.step(i => (i < 2 ? 0.2 : 1));                  /* the reading: bars 1-2 are lost at the score tempo ... */
  for (let k = 0; k < 6; k++) LE.update(s.m, entry(pc, s.t - 1000 + k, 0, 1, 0.15));
  for (let k = 0; k < 6; k++) LE.update(s.m, entry(pc, s.t - 500 + k, 0, 1, 1, { ratio: 0.5 }));   /* ... and clean at half the tempo */
  const d = s.step(null);
  assert.equal(d.kind, 'focus');
  const p0 = d.task.tempoPercent;
  assert.ok(p0 < 100 && p0 >= 40, 'starts slower: ' + p0);
  s.step(clean);
  s.step(clean);
  const up = s.step(clean);
  assert.equal(up.task.tempoPercent, Math.min(100, p0 + 10), 'one step up');
  assert.equal(up.suggestion, true, 'a suggestion (U6: the automatic step is off)');
  /* the step decided after the lap that made it is played next; two lost laps later the tempo comes down one step */
  const seen = [];
  for (let k = 0; k < 4; k++) seen.push(s.step(() => 0.1));
  const down = seen.find(x => x.task.tempoPercent !== up.task.tempoPercent);
  assert.ok(down && down.task.tempoPercent === up.task.tempoPercent - 10 && seen.indexOf(down) === 2, JSON.stringify(seen.map(x => x.task.tempoPercent)));
  let lo = 100, hi = 0;
  for (let k = 0; k < 30; k++) { const x = s.step(() => 0.05); lo = Math.min(lo, x.task.tempoPercent); }
  for (let k = 0; k < 60; k++) { const x = s.step(clean); hi = Math.max(hi, x.task.tempoPercent); }
  assert.ok(lo >= 40 && hi <= 100, lo + '..' + hi);
  const auto = PO.decide(s.m, s.t, s.st, { current: s.current, opts: { autoTempo: true } });
  assert.equal(auto.suggestion, false);
});

test('hands separately: a passage with one hand far behind starts with that hand alone, then both hands at the same tempo', () => {
  const pc = piece(4);
  const s = make(pc, { policy: { maxLen: 4 } });
  const lefty = (i, h) => (h === 'l' ? 0.3 : 1);
  s.step(lefty);
  const d = s.step(lefty);
  assert.equal(d.task.hand, 'left');
  const laps = [d];
  for (let k = 0; k < PO.DEFAULTS.aloneLaps; k++) laps.push(s.step(lefty));
  const after = laps[laps.length - 1];
  assert.equal(after.task.hand, 'both');
  assert.equal(after.task.tempoPercent, d.task.tempoPercent);
  /* a hand with no notes in the passage is never asked for alone */
  const pc2 = piece(4, { l: 0 });
  const s2 = make(pc2);
  for (let k = 0; k < 20; k++) { const x = s2.step(() => 0.3); assert.notEqual(x.task.hand, 'left'); }
});

test('a new session starts with the spaced re-check of the bars that are due, one lap at the score tempo', () => {
  const pc = piece(8);
  const s = make(pc);
  cleanAll(s, 3);
  s.step(clean);
  s.t += 1 * DAY;
  const d = s.step(clean);
  assert.equal(d.kind, 'review');
  assert.equal(d.task.repetitions, 1);
  assert.equal(d.task.tempoPercent, 100);
  assert.equal(d.task.hand, 'both');
  const due = LE.due(s.m, s.t);
  assert.ok(d.task.range.start <= pc.measures[0].number && d.task.range.end >= pc.measures[7].number || due.length === 0);
  assert.notEqual(s.step(clean).kind, 'review', 'once a session');
  const off = PO.decide(s.m, s.t + DAY, s.st, { current: s.current, opts: { review: false } });
  assert.notEqual(off.kind, 'review');
});

test('memory work only behind the app\'s gate; a due memory review first, unless a severe weakness', () => {
  const pc = piece(8);
  const sec = { id: 's1', from: 1, to: 8, state: 'memory-ready' };
  const s = make(pc);
  cleanAll(s, 40);
  const open = ctxOf(pc, { eligible: [{ from: 1, to: 8 }], sections: [sec] });
  const closed = ctxOf(pc, { sections: [sec] });
  const dOpen = PO.decide(s.m, s.t, PO.initState(), { ctx: open });
  const dClosed = PO.decide(s.m, s.t, PO.initState(), { ctx: closed });
  assert.equal(dOpen.task.mode, 'memory');
  assert.deepEqual(dOpen.task.range, { start: 1, end: 8 });
  assert.notEqual(dClosed.task.mode, 'memory');
  assert.equal(dClosed.kind, 'through');
  /* a memory task whose gate closes again is dropped */
  const later = PO.decide(s.m, s.t + MIN, dOpen.state, { current: cur(dOpen.task), ctx: closed });
  assert.notEqual(later.task.mode, 'memory');
  /* a due review */
  const due = ctxOf(pc, { eligible: [{ from: 1, to: 8 }], sections: [Object.assign({}, sec, { state: 'due' })], due: [{ id: 's1', from: 1, to: 8, daysOverdue: 1 }] });
  assert.equal(PO.decide(s.m, s.t, PO.initState(), { ctx: due }).task.mode, 'memory');
  const s2 = make(pc);
  cleanAll(s2, 20);
  for (let k = 0; k < 10; k++) LE.update(s2.m, entry(pc, s2.t + k, 3, 3, 0.1));
  const dSevere = PO.decide(s2.m, s2.t + 20, PO.initState(), { ctx: due });
  assert.equal(dSevere.task.mode, 'practice');
  assert.equal(dSevere.kind, 'focus');
});

test('stuck detection (input to G11c): the same slow passage chosen in three sessions with no gain is flagged, never acted on', () => {
  const pc = piece(6);
  const s = make(pc, { policy: { maxLen: 2, review: false } });
  const hopeless = i => (i === 0 ? 0.05 : 1);
  let flagged = null;
  for (let day = 0; day < 5 && !flagged; day++) {
    for (let k = 0; k < 8; k++) { const d = s.step(hopeless); if (d.stuck) flagged = d; }
    s.t += DAY;
  }
  assert.ok(flagged, 'flagged');
  assert.equal(flagged.stuck.from, 1);
  assert.ok(flagged.task.tempoPercent <= PO.DEFAULTS.stuckPct);
  assert.equal(flagged.task.mode, 'practice', 'the flag changes nothing in the task');
});

test('pure: the input state and the model are not changed, and the same input gives the same decision', () => {
  const pc = piece(10);
  const s = make(pc);
  for (let k = 0; k < 8; k++) s.step(i => 0.4 + 0.06 * i);
  const st = JSON.stringify(s.st), m = JSON.stringify(s.m);
  const a = PO.decide(s.m, s.t, s.st, { current: s.current });
  const b = PO.decide(s.m, s.t, s.st, { current: s.current });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(s.st), st);
  assert.equal(JSON.stringify(s.m), m);
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random'); };
  try { PO.decide(s.m, s.t + DAY, s.st, { current: s.current }); PO.plan(s.m, s.t, s.st, null); } finally { Math.random = random; }
});

test('the only door: a plan is used only as the app\'s Coach.validate returns it, and every task of these plans passes it untouched', () => {
  const C = coach();
  const pc = piece(12, { first: 0 });
  const ctx = ctxOf(pc);
  const s = make(pc, { ctx: ctx });
  for (let k = 0; k < 40; k++) {
    s.step(i => (i % 4 === 1 ? 0.4 : 0.95));
    const p = PO.plan(s.m, s.t, s.st, ctx);
    const r = PO.checked(p, ctx, C.validate);
    assert.equal(r.ok, true);
    assert.equal(r.issues.length, 0, JSON.stringify(r.issues));
    assert.equal(JSON.stringify(r.plan.tasks), JSON.stringify(p.tasks), 'nothing repaired or dropped');
    assert.equal(JSON.stringify(p.tasks[0]), JSON.stringify(s.log[s.log.length - 1].task), 'the plan starts with the task of the decision');
  }
  assert.equal(PO.checked({ tasks: [] }, ctx, C.validate).ok, false);
  assert.equal(PO.checked({ tasks: [{ range: { start: 99, end: 99 } }] }, ctx, C.validate).ok, false, 'a bar that is not there');
  assert.equal(PO.checked(PO.plan(s.m, s.t, s.st, ctx), ctx, () => ({ ok: false, issues: [{ level: 'reject' }] })).ok, false);
  assert.equal(PO.checked(PO.plan(s.m, s.t, s.st, ctx), ctx, null).ok, false, 'no validator, no plan');
  const repaired = PO.checked(PO.plan(s.m, s.t, s.st, ctx), ctx, (p) => ({ ok: true, plan: Object.assign({}, p, { tasks: p.tasks.map(t => Object.assign({}, t, { repetitions: 1 })) }), issues: [{ level: 'repair' }] }));
  assert.ok(repaired.plan.tasks.every(t => t.repetitions === 1), 'what the validator returns is what is used');
});

test('never invents music: measure numbers of the piece (pickups, gaps), hands that play there, ladder tempos, the app\'s modes', () => {
  [piece(9, { first: 0 }), piece(7, { numbers: [1, 2, 4, 5, 8, 9, 10] }), piece(5, { notes: [{ r: 3, l: 0 }, { r: 0, l: 0 }, { r: 2, l: 2 }, { r: 0, l: 5 }, { r: 4, l: 1 }] })].forEach(pc => {
    const s = make(pc);
    const nums = new Set(pc.measures.map(m => m.number));
    for (let k = 0; k < 120; k++) {
      const d = s.step((i, h) => (h === 'l' ? 0.35 : 0.6 + 0.04 * i));
      const t = d.task;
      assert.ok(nums.has(t.range.start) && nums.has(t.range.end) && t.range.start <= t.range.end);
      assert.ok(['both', 'left', 'right'].indexOf(t.hand) >= 0 && ['practice', 'memory'].indexOf(t.mode) >= 0);
      assert.ok(Number.isInteger(t.tempoPercent) && t.tempoPercent >= 40 && t.tempoPercent <= 100);
      assert.ok(t.repetitions >= 1 && t.repetitions <= 8);
      assert.ok(!/\d/.test(t.reason), 'no figure in a reason PPP did not measure');
      if (t.hand !== 'both') {
        const h = t.hand === 'left' ? 'l' : 'r';
        let n = 0;
        for (let i = idx(pc, t.range.start); i <= idx(pc, t.range.end); i++) n += pc.measures[i].notes[h];
        assert.ok(n > 0, 'the hand asked for has notes there');
      }
      if (k % 30 === 29) s.t += DAY;
    }
  });
});

test('the cost of a decision for a 160-bar piece', () => {
  const pc = piece(160);
  const s = make(pc);
  for (let k = 0; k < 60; k++) LE.update(s.m, entry(pc, T0 + k * MIN, (k * 9) % 150, (k * 9) % 150 + 9, i => 0.5 + 0.4 * ((i * 13) % 7) / 6));
  s.t = T0 + 61 * MIN;
  for (let k = 0; k < 10; k++) s.step(() => 0.7);
  const times = [];
  for (let k = 0; k < 60; k++) {
    const t0 = process.hrtime.bigint();
    PO.decide(s.m, s.t + k * 1000, s.st, { current: s.current });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[30] < 2, 'median ' + times[30].toFixed(3) + ' ms (the budget is 2 ms at 4x CPU in the page; this is Node at 1x)');
});
