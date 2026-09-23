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
  assert.equal(specs.length, 11);
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
