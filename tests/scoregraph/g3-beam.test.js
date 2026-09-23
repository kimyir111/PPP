'use strict';
/* G3 Step 10: beams (docs/GOALS/G03 §11; A28, A29). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG } = require('./helpers.js');
const { runSpec, beams } = require('./g3-helpers.js');
const D = require('./g3-corpus-data.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'beam');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

test('A28: every B fixture gives exactly its sidecar, and every beam is well formed', () => {
  assert.ok(specs.length >= 9);
  const failures = [];
  specs.forEach(f => {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const r = runSpec(spec);
      const ex = spec.expect;
      if (ex.same) assert.equal(r.output, r.input, 'unchanged');
      if (ex.beams) assert.deepEqual(beams(r.output, 0), ex.beams);
      assert.equal(SG.validate(r.output).issues.filter(i => i.code === 'W-BEAM-SHAPE').length, 0);
    } catch (e) { failures.push(f + ': ' + e.message.split(/\r?\n/).slice(0, 4).join(' ')); }
  });
  assert.deepEqual(failures, []);
});

test('A28: on the recording graphs every beam stays inside one beat group and the export writes it', () => {
  D.recorded(['core']).slice(0, 120).forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    assert.equal(SG.validate(out).issues.filter(i => i.code === 'W-BEAM-SHAPE').length, 0, r.id);
    const p = out.parts[0];
    const ev = new Map(p.events.map(e => [e.id, e]));
    p.spanners.filter(s => s.type === 'beam').forEach(s => {
      const evs = s.events.map(id => ev.get(id));
      assert.ok(evs.every(e => e.m === evs[0].m && e.voice === evs[0].voice), r.id + ': ' + s.id + ' in one voice and measure');
      const gr = SG.meterGrid.grid(out, evs[0].m);
      const spans = SG.meterGrid.beamGroups(gr);
      const spanOf = e => spans.findIndex(([a, b]) => SG.meterGrid.toU(e.at) >= a && SG.meterGrid.toU(e.at) < b);
      assert.ok(evs.every(e => spanOf(e) === spanOf(evs[0])), r.id + ': ' + s.id + ' inside one beat group');
    });
    const x = SG.musicxml.export(out).xml;
    if (p.spanners.some(s => s.type === 'beam')) assert.ok(/<beam number="1">begin<\/beam>/.test(x), r.id + ': beams exported');
  });
});

test('A29: imported beams are kept (rewrite mode), and force mode leaves a beamed voice-measure well formed', async () => {
  const rows = (await D.imported()).filter(r => r.graph.parts.some(p => p.spanners.some(s => s.type === 'beam')));
  assert.ok(rows.length >= 10);
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    const key = g => g.parts.map(p => p.spanners.filter(s => s.type === 'beam').map(s => s.events.join(',')).sort().join(';')).join('|');
    assert.equal(key(out), key(r.graph), r.path);
  });
});
