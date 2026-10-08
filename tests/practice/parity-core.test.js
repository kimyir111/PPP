'use strict';
/* Does the cause table of the parity harness (tests/practice/parity-core.js) say no when it should? (docs/GOALS/G11 section 6.2, item 5)

   The page run of tests/practice/parity.js proves that practice/plan.js is the old player's plan and that its fixes differ from it only by the four allowed causes. That proof
   is worth what the rule table is worth: a table that explained everything would pass anything. So the table is held here to the other half of the claim - what it does NOT
   explain. Real plans of the G11a-1 fixtures (the app's own PianoScore read out of the page file, as parity.test.js does, against practice/plan.js) are taken apart with one planted
   error at a time - a velocity, a place, a missing strike, an extra one, a way-back visit that is another bar, a pedal event, a grace where there is none, a gate note nobody
   owes - and each must come out UNEXPLAINED, while the genuine differences of the four causes come out explained and counted. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const X = require('./parity-core.js');
const C = require('./canon.js');

const { PLAN } = H;
const app = H.appPlayer();
const clone = x => JSON.parse(JSON.stringify(x));

function setup(name, options) {
  const g = H.fixtureGraph(name), score = app.scoreOf(g);
  const first = app.Score.first(score), last = app.Score.last(score);
  const L = app.PianoScore.build(score, first, last);
  const graceMeasures = new Set();
  const idx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  g.parts.forEach(p => p.events.forEach(e => { if (e.grace && e.kind !== 'rest') graceMeasures.add(idx.get(e.m)); }));
  const N = PLAN.build(g, Object.assign({ defaultQpm: score.tempo }, options || {}));
  return { g, score, first, last, L, N, dL: X.dumpOf(L), dN: X.dumpOf(N), graceMeasures };
}
const BOTH = { JUMP: true, GRACE: true };
const explain = (s, dN, allow) => X.explainPlan(s.dL, dN || s.dN, { allow: allow || BOTH, graceMeasures: s.graceMeasures });

/* ---------------------------------------------------------------- what is explained */
test('PLAN: with no option the new plan is the old one - strictly, and the rule table has nothing to explain', () => {
  for (const name of ['jump-ds-al-fine', 'grace-notes', 'ties-edge', 'pedals', 'meters-pickup', 'tempo-change']) {
    const s = setup(name);
    assert.equal(X.firstDiff(X.strictOf(s.L), X.strictOf(s.N)), '', name);
    assert.deepEqual(s.dL, s.dN, name + ': the dumps (with the bar indexes and places)');
    const none = explain(s, null, {});
    assert.deepEqual([none.bad, none.unexplained], [0, []], name);
  }
});

test('PLAN: JUMP - the way back is counted and explained; the first leg is the old order', () => {
  const s = setup('jump-ds-al-fine', { jumps: 'once' });
  assert.equal(H.order(s.N), "1 2 3 4 2' 3'");
  const ex = explain(s);
  assert.deepEqual(ex.unexplained, []);
  assert.deepEqual(ex.jump, { turned: 1, visitsAdded: 2, visitsSkipped: 0, strikes: 2, unchecked: 0 });
  assert.deepEqual(ex.grace, { strikes: 0, moved: 0, cut: 0 });
  /* a D.C. over a volta: the way back plays the second ending */
  const v = setup('jump-dc-al-fine-volta', { jumps: 'once' });
  const ev = explain(v);
  assert.deepEqual([ev.bad, ev.jump.visitsAdded], [0, 3]);
  /* D.S. al Coda: the old order goes on to the coda, the new one turns back first: the visits the jump moved are its territory */
  const c = setup('jump-ds-al-coda', { jumps: 'once' });
  const ec = explain(c);
  assert.deepEqual([ec.bad, ec.jump.visitsAdded > 0, ec.jump.visitsSkipped > 0], [0, true, true]);
});

test('PLAN: GRACE - the extra strikes are counted, the notes they moved or cut are explained, nothing else moved', () => {
  const s = setup('grace-notes', { graces: 'play' });
  const ex = explain(s);
  assert.deepEqual(ex.unexplained, []);
  assert.equal(ex.grace.strikes, 9);
  assert.ok(ex.grace.moved > 0 && ex.grace.cut > 0, JSON.stringify(ex.grace));
  assert.equal(ex.jump.turned, 0);
  /* the other strikes are exactly the old ones, and controller events, beats, tempo and length are untouched */
  assert.equal(s.dN.s.filter(x => !x[8]).length, s.dL.s.length);
  assert.deepEqual([s.dN.c, s.dN.b, s.dN.t, s.dN.len], [s.dL.c, s.dL.b, s.dL.t, s.dL.len]);
});

test('PLAN: both options on a file that has both - each alone is explained by its own cause only', () => {
  const s = setup('jump-ds-al-fine', { jumps: 'once', graces: 'play' });
  assert.deepEqual(explain(s).unexplained, []);
  /* a plan with a way back is not explained when jumps were not asked, and one with graces is not when graces were not asked */
  assert.ok(explain(s, null, { GRACE: true }).bad > 0, 'a way back with no JUMP option');
  const g = setup('grace-notes', { graces: 'play' });
  assert.ok(explain(g, null, { JUMP: true }).bad > 0, 'grace strikes with no GRACE option');
});

/* ---------------------------------------------------------------- what is not */
function planted(name, options, change) {
  const s = setup(name, options);
  const dN = clone(s.dN);
  change(dN, s);
  return explain(s, dN);
}
const some = (ex, re) => assert.ok(ex.bad > 0 && ex.unexplained.some(m => re.test(m)), 'unexplained: ' + JSON.stringify(ex.unexplained) + ' (wanted ' + re + ')');

test('PLAN planted: a first-leg strike that is louder, quieter, another pitch or the other hand', () => {
  for (const [what, edit] of [['velocity', x => { x[5] += 1; }], ['pitch', x => { x[4] += 1; }], ['hand', x => { x[6] = x[6] === 'r' ? 'l' : 'r'; }], ['bar', x => { x[7] += 1; }]]) {
    const ex = planted('jump-ds-al-fine', { jumps: 'once' }, d => edit(d.s[1]));
    assert.ok(ex.bad > 0, what);
  }
});

test('PLAN planted: a first-leg strike moved or cut where no grace is, or with no GRACE option', () => {
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s[1][2] += 0.25; }), /no grace note near it/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s[1][3] -= 0.25; }), /no grace note near it/);
  const s = setup('grace-notes', { graces: 'play' });
  const dN = clone(s.dN);
  const moved = dN.s.find(x => !x[8] && s.dL.s.every(y => y[2] !== x[2] || y[4] !== x[4]));
  assert.ok(moved, 'a strike the graces moved');
  assert.ok(X.explainPlan(s.dL, dN, { allow: { JUMP: true }, graceMeasures: s.graceMeasures }).bad > 0, 'moved with GRACE not asked');
});

/* a non-grace strike of the new plan that a grace moved: [its index, the old plan's strike] */
function movedStrike(s) {
  for (let i = 0; i < s.dN.s.length; i++) {
    const x = s.dN.s[i];
    if (x[8]) continue;
    const y = s.dL.s.find(z => z[0] === x[0] && z[1] === x[1] && z[4] === x[4] && z[5] === x[5] && z[6] === x[6] && z[7] === x[7] && Math.abs(z[2] - x[2]) > 1e-6);
    if (y) return [i, y];
  }
  return null;
}
test('PLAN planted: a grace may only delay a note or shorten the one before; earlier, or released later, is not a grace', () => {
  const s = setup('grace-notes', { graces: 'play' });
  const m = movedStrike(s);
  assert.ok(m, 'a strike the graces moved exists in the fixture');
  const [k, old] = m;
  const early = clone(s.dN); early.s[k][2] = old[2] - 0.5;
  assert.ok(X.explainPlan(s.dL, early, { allow: BOTH, graceMeasures: s.graceMeasures }).bad > 0, 'moved earlier');
  const late = clone(s.dN); late.s[k][2] = old[2]; late.s[k][3] = old[3] + 2;
  assert.ok(X.explainPlan(s.dL, late, { allow: BOTH, graceMeasures: s.graceMeasures }).bad > 0, 'released later at the same place');
  const ok = X.explainPlan(s.dL, s.dN, { allow: BOTH, graceMeasures: s.graceMeasures });
  assert.equal(ok.bad, 0);
});

test('PLAN planted: a strike gone, a strike that nobody wrote, a grace in a bar with no grace, a grace that starts before 0', () => {
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s.splice(1, 1); }), /strike\(s\) of/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s.push(d.s[0].slice()); d.s[d.s.length - 1][4] += 7; }), /strike\(s\) of/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s.push([0, 0, 0, 1, 60, 80, 'r', 1, 1]); }), /holds no grace note/);
  some(planted('grace-notes', { graces: 'play' }, d => { const g = d.s.find(x => x[8]); g[2] = -0.5; g[3] = 0; }), /starts at/);
});

test('PLAN planted: the order - a first-leg visit in the wrong place, a way back that is another bar, a missing way back, a wrong length', () => {
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.v[1][2] = 9; }), /visit 1 is/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, (d, s) => { const j = d.v.length - 1; d.v[j][0] = 0; d.v[j][1] = 1; }), /way-back visit/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.v.length -= 2; d.s = d.s.filter(x => x[0] < d.v.length); d.len = d.v[d.v.length - 1][6] + d.v[d.v.length - 1][5]; }), /stops after|sounding length|first leg/);
  some(planted('ties-edge', {}, d => { d.len += 4; }), /sounding length/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.v[4][6] += 1; }), /way back starts at/);
  /* a visit after a way-back visit that is a first-leg visit again */
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.v[d.v.length - 1][3] = 0; }), /first-leg visit after a way-back/);
});

test('PLAN planted: a way back that sounds other than the bar it plays (a note, its loudness, its release, its pedal)', () => {
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { const j = d.s.findIndex(x => x[0] === 4); d.s[j][5] += 5; }), /does not sound what the legacy plays/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { const j = d.s.findIndex(x => x[0] === 5); d.s[j][3] += 1; }), /does not sound what the legacy plays/);
  some(planted('jump-ds-al-fine', { jumps: 'once' }, d => { d.s.splice(d.s.findIndex(x => x[0] === 4), 1); }), /does not sound what the legacy plays/);
});

test('PLAN planted: the first leg\'s pedal events, beats and tempo map must be the old ones, to the bit', () => {
  const edits = [['ccs', d => { d.c[0][2] = d.c[0][2] === 0 ? 127 : 0; }], ['beats', d => { d.b[0][1] = 1 - d.b[0][1]; }], ['tempo map', d => { d.t[0][1] += 1; }]];
  for (const [what, edit] of edits) {
    const s = setup('pedals', {});
    const dN = clone(s.dN);
    edit(dN);
    const ex = X.explainPlan(s.dL, dN, { allow: BOTH, graceMeasures: s.graceMeasures });
    assert.ok(ex.bad > 0 && ex.unexplained.some(m => m.includes(what)), what + ': ' + JSON.stringify(ex.unexplained));
  }
});

/* ---------------------------------------------------------------- the follow gates */
function gatesOf(s, hands, opts, plan) {
  return { legacy: C.gatesOf(app.gates(s.score, s.first, s.last, hands)), nu: C.gatesOf(PLAN.followGates(plan || s.N, hands, opts)) };
}
const dangling = (s, hands) => s.score.notes.filter(n => !n.rest && n.midi != null && n.tieStop && !s.L.cont.has(n) && app.Score && n.hand !== 'x' && (hands === 'both' || n.hand === (hands === 'right' ? 'r' : 'l')))
  .map(n => [C.r6(n.abs), n.m, n.midi, n.hand === 'l' ? 'l' : 'r']);

test('GATES: with no option the new gates are the old ones; FOLLOW_TIE adds exactly the notes a tie leads into from nowhere', () => {
  const s = setup('ties-edge');
  for (const h of ['both', 'right', 'left']) {
    const a = gatesOf(s, h, {});
    assert.deepEqual(X.explainGatesExact(a.legacy, a.nu), { bad: 0, unexplained: [] }, h);
    const t = gatesOf(s, h, { ties: true });
    const dang = dangling(s, h);
    const ex = X.explainGatesTies(a.legacy, t.nu, dang);
    assert.deepEqual(ex.unexplained, [], h);
    assert.equal(ex.notes, dang.length, h + ': every dangling note is asked, no more');
  }
  const t = gatesOf(setup('ties-edge'), 'both', { ties: true });
  assert.ok(JSON.stringify(t.nu) !== JSON.stringify(t.legacy), 'the fixture has a tie that leads nowhere');
});

test('GATES planted: a note nobody owes, a note missing, a tie note that is not dangling, a rest cut for no reason, a gate gone', () => {
  const s = setup('ties-edge');
  const a = gatesOf(s, 'both', {}), t = gatesOf(s, 'both', { ties: true });
  const dang = dangling(s, 'both');
  assert.ok(dang.length >= 2);
  /* no dangling note is declared: the extra notes are unexplained */
  assert.ok(X.explainGatesTies(a.legacy, t.nu, []).bad > 0);
  /* declared, but one of them is not asked */
  const miss = clone(t.nu);
  const gi = miss.findIndex((g, i) => JSON.stringify(g) !== JSON.stringify(a.legacy[i]));
  miss[gi] = a.legacy[gi];
  assert.ok(X.explainGatesTies(a.legacy, miss, dang).bad > 0, 'a dangling note not asked');
  /* a note added that is not a tie's end */
  const extra = clone(t.nu);
  extra[0][4].push([99, 'r']);
  assert.ok(X.explainGatesTies(a.legacy, extra, dang).bad > 0, 'a stray note');
  /* a gate lost */
  const lost = clone(t.nu); lost.splice(0, 1);
  assert.ok(X.explainGatesTies(a.legacy, lost, dang).bad > 0, 'a gate lost');
  /* a rest gate shortened with no onset inside it */
  const rest = clone(t.nu);
  const ri = rest.findIndex((g, i) => g[2] && JSON.stringify(g) === JSON.stringify(a.legacy.find(x => x[0] === g[0])));
  if (ri >= 0) { rest[ri][3] = rest[ri][3] / 2; assert.ok(X.explainGatesTies(a.legacy, rest, dang).bad > 0, 'a rest cut for no reason'); }
  /* and with the tie option off, any difference at all is unexplained */
  assert.ok(X.explainGatesExact(a.legacy, t.nu).bad > 0);
  assert.ok(X.explainGatesExact(a.legacy, t.nu.slice(1)).bad > 0);
});

test('GATES: FOLLOW_REPEAT - the stretches of the play order, and the old function asked once per stretch is the oracle', () => {
  const s = setup('jump-dc-repeats', { jumps: 'once' });
  const runs = X.runsOf(s.dN);
  /* 1 2 | 1 2 3 | 1' 2' 3': three stretches, the last on the way back */
  assert.deepEqual(runs.map(r => [r.first, r.last, r.leg]), [[0, 1, 0], [0, 2, 0], [0, 2, 1]]);
  const nu = C.gatesOf(PLAN.followGates(s.N, 'both', { repeats: true }));
  const oracle = [].concat(...runs.map(r => C.gatesOf(app.gates(s.score, s.score.measures[r.first].number, s.score.measures[r.last].number, 'both'))));
  assert.deepEqual(X.explainGatesExact(oracle, nu), { bad: 0, unexplained: [] });
  assert.ok(nu.length > C.gatesOf(app.gates(s.score, s.first, s.last, 'both')).length, 'a passage played twice is asked twice');
  const wrong = clone(nu); wrong[2][1] += 1;
  assert.ok(X.explainGatesExact(oracle, wrong).bad > 0);
  assert.ok(X.explainGatesExact(oracle, nu.slice(0, -1)).bad > 0);
});
