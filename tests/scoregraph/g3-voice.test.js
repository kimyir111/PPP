'use strict';
/* G3 Step 8: voices, G3a (docs/GOALS/G03 §8.2; A23) on the V fixtures and the core recording graphs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG } = require('./helpers.js');
const { render, runSpec } = require('./g3-helpers.js');
const D = require('./g3-corpus-data.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'voice');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

test('A23: every V fixture gives exactly its sidecar', () => {
  assert.equal(specs.length, 6);
  const failures = [];
  specs.forEach(f => {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const r = runSpec(spec);
      const ex = spec.expect;
      if (ex.same) assert.equal(r.output, r.input, 'unchanged');
      if (ex.rh !== undefined) assert.equal(render(r.output)[0], ex.rh);
      if (ex.lh !== undefined) assert.equal(render(r.output)[1], ex.lh);
      if (ex.voices !== undefined) assert.equal(r.output.parts[0].voices.length, ex.voices);
      assert.equal(SG.validate(r.output).ok, true);
    } catch (e) { failures.push(f + ': ' + e.message.split(/\r?\n/).slice(0, 4).join(' ')); }
  });
  assert.deepEqual(failures, []);
});

test('A23: on the recording graphs no voice overlaps, a staff has at most two voices, a voice keeps to one staff', () => {
  D.recorded(['core']).forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    assert.equal(SG.validate(out).issues.filter(i => i.code === 'E-VOICE-OVERLAP').length, 0, r.id);
    const p = out.parts[0];
    p.staves.forEach(st => assert.ok(p.voices.filter(v => v.staff === st.id).length <= 2, r.id + ': voices on ' + st.id));
    p.events.forEach(e => assert.equal(e.staff, p.voices.find(v => v.id === e.voice).staff, r.id + ': ' + e.id + ' off the staff of its voice'));
  });
});
