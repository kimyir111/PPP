'use strict';
/* G3 Step 7: hands, staves and clefs (docs/GOALS/G03 §9; A22) on the H fixtures, and the automatic 8va (§13.3, D2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG } = require('./helpers.js');
const { mk, render, runSpec } = require('./g3-helpers.js');
const C = require('../../scoregraph/pro-critic.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'hands');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const clefs = g => {
  const p = g.parts[0], limb = new Map(p.staves.map(s => [s.id, s.limb]));
  const num = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
  return p.clefs.map(c => limb.get(c.staff) + ' m' + num.get(c.m) + ' ' + c.sign).sort();
};
const heads = g => {
  const out = {};
  g.parts[0].events.forEach(e => (e.heads || []).forEach(h => { out[h.id] = SG.pitch.midi(h.pitch); }));
  return out;
};

test('A22: every H fixture gives exactly its sidecar; heads keep their IDs; the music is the same', () => {
  assert.equal(specs.length, 17);
  const failures = [];
  specs.forEach(f => {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const r = runSpec(spec);
      const ex = spec.expect;
      if (ex.same) assert.equal(r.output, r.input, 'unchanged');
      if (ex.rh !== undefined) assert.equal(render(r.output)[0], ex.rh);
      if (ex.lh !== undefined) assert.equal(render(r.output)[1], ex.lh);
      if (ex.clefs) assert.deepEqual(clefs(r.output), ex.clefs.slice().sort());
      /* every head of the input is still there with its ID and pitch (a moved head is moved, never remade) */
      const a = heads(r.input), b = heads(r.output);
      Object.keys(a).forEach(id => assert.equal(b[id], a[id], 'head ' + id));
      assert.deepEqual(C.diff(C.fingerprint(r.input), C.fingerprint(r.output), ['onsets', 'sound', 'marks', 'perf', 'timeline']), []);
    } catch (e) { failures.push(f + ': ' + e.message.split(/\r?\n/).slice(0, 4).join(' ')); }
  });
  assert.deepEqual(failures, []);
});

test('a moved note keeps the performance link of its head (I5)', () => {
  const g = mk({ time: [3, 4], rh: 'D5+D6:q C5+C6:q B4+B5:q | A4+A5:h.', lh: 'r:h. | r:h.', perf: true });
  const out = SG.professionalize(g, { strict: true }).graph;
  assert.equal(JSON.stringify(out.performances), JSON.stringify(g.performances));
  const lh = out.parts[0].staves.find(s => s.limb === 'LH').id;
  const linked = new Set(out.performances[0].notes.map(n => n.link));
  const moved = out.parts[0].events.filter(e => e.staff === lh && e.kind === 'note');
  assert.ok(moved.length >= 4 && moved.every(e => e.heads.every(h => linked.has(h.id))));
});

test('the automatic 8va is off unless asked for (D2), and marks a measure or more of high right-hand notes', () => {
  const g = mk({ rh: 'C5:w | C7:q D7:q E7:h | C5:w', lh: 'C3:w | C3:w | C3:w' });
  assert.equal(SG.professionalize(g, { strict: true }).graph.parts[0].spanners.filter(s => s.type === 'ottava').length, 0);
  const on = SG.professionalize(g, { strict: true, ottava: true });
  const ot = on.graph.parts[0].spanners.filter(s => s.type === 'ottava');
  assert.equal(ot.length, 1);
  assert.equal(ot[0].shift, 1);
  assert.equal(ot[0].from.m, g.timeline.measures[1].id);
  assert.equal(SG.professionalize(on.graph, { strict: true, ottava: true }).graph, on.graph, 'idempotent');
});

/* G03 §28 M1: the review's hand regressions, cut from the corpus with the bars before them (the DP carries each hand's
   position along). In the named bar the writer had every note in the right hand (the reference agrees) and G3 moved some
   to the left; nothing there may change hands now. */
const CORPUS = path.join(DIR, 'corpus');
const KEEP_BAR = { 'H18-m04-amt-noise.sg.json': 2, 'H19-m15-octave-noise.sg.json': 2, 'H20-m15-octave-chord.sg.json': 2 };
const limbOf = (g, e, h) => { const p = g.parts[0]; return (p.staves.find(s => s.id === (h.staff || e.staff)) || {}).limb; };

test("M1: the review's hand regressions (micro M04, M15 x2) keep the writer's hands in the bar G3 used to break", () => {
  Object.keys(KEEP_BAR).forEach(f => {
    const g = SG.parse(fs.readFileSync(path.join(CORPUS, f), 'utf8'));
    const out = SG.professionalize(g, { strict: true }).graph;
    const m = g.timeline.measures[KEEP_BAR[f]].id;
    const was = new Map();
    g.parts[0].events.forEach(e => { if (e.m === m && e.kind === 'note') e.heads.forEach(h => was.set(h.id, limbOf(g, e, h))); });
    const moved = [];
    out.parts[0].events.forEach(e => { if (e.m === m && e.kind === 'note') e.heads.forEach(h => { if (was.get(h.id) !== limbOf(out, e, h)) moved.push(SG.pitch.midi(h.pitch) + ' ' + was.get(h.id) + '->' + limbOf(out, e, h)); }); });
    assert.deepEqual(moved, [], f);
  });
});

test('M1: a figure the hands share one note at a time (Czerny 849/027) is not folded into one hand', () => {
  const g = SG.parse(fs.readFileSync(path.join(CORPUS, 'H21-czerny849-027-alternating.sg.json'), 'utf8'));
  const out = SG.professionalize(g, { strict: true }).graph;
  const eb4 = (x, limb) => x.parts[0].events.reduce((n, e) => n + (e.kind === 'note' ? e.heads.filter(h => SG.pitch.midi(h.pitch) === 63 && limbOf(x, e, h) === limb).length : 0), 0);
  assert.ok(eb4(g, 'RH') >= 20, 'the writer (and the reference) has the repeated E flats in the right hand');
  assert.equal(eb4(out, 'LH'), eb4(g, 'LH'), 'no E flat of the right hand moved to the left');
});
