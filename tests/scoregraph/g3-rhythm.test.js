'use strict';
/* G3 Step 5: R-repr (docs/GOALS/G03 §6.2, §6.3; A16, A18) on the R fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG, codes } = require('./helpers.js');
const { mk, render, runSpec } = require('./g3-helpers.js');
const C = require('../../scoregraph/pro-critic.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'rhythm');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

test('A16: every R fixture gives exactly its sidecar, and keeps onsets, tied lengths and rests', () => {
  assert.ok(specs.length >= 24, specs.length + ' fixtures');
  const failures = [];
  specs.forEach(f => { try { one(f); } catch (e) { failures.push(f + ': ' + e.message.split(/\r?\n/).slice(0, 6).join(' ')); } });
  assert.deepEqual(failures, []);
});
function one(f) {
  {
    const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const r = runSpec(spec);
    const ex = spec.expect;
    if (ex.same) assert.equal(r.output, r.input, f + ': the graph comes back unchanged');
    if (ex.rh !== undefined) assert.equal(render(r.output)[0], ex.rh, f);
    if (ex.warnings) assert.deepEqual(codes(SG.validate(r.output).issues, 'WARNING'), ex.warnings, f);
    if (ex.issues) assert.deepEqual(codes(r.report.issues), ex.issues, f);
    if (ex.graces !== undefined) assert.equal(r.output.parts[0].events.filter(e => e.grace).length, ex.graces, f);
    /* R-repr keeps every onset, every tie-merged length and every stretch of rest (I2, I8, I9) */
    const v = C.diff(C.fingerprint(r.input), C.fingerprint(r.output), ['sound', 'onsets', 'rests', 'marks', 'perf', 'timeline']);
    assert.deepEqual(v, [], f);
  }
}

test('A18: an unrepresentable piece leaves the graph as it was and says so once', () => {
  const r = runSpec(JSON.parse(fs.readFileSync(path.join(DIR, 'R22.json'), 'utf8')));
  assert.equal(r.output, r.input);
  assert.equal(r.report.issues.filter(i => i.code === 'N-RHYTHM-UNREPRESENTABLE').length, 1);
});

test('the rewritten pieces name G3 as their rhythm source; the first piece keeps the event the performance links to', () => {
  const g = mk({ rh: 'C5:8~ C5:8 D5:q E5:h', perf: true });
  const out = SG.professionalize(g, { strict: true }).graph;
  const c5 = out.parts[0].events.find(e => e.at === '0' && e.kind === 'note');
  const src = out.provenance.sources.find(s => s.tool === 'ppp.g3');
  assert.ok(src, 'a G3 source');
  assert.equal(SG.prov.provOf(out, c5.id, 'rhythm').src, src.id);
  assert.equal(SG.prov.provOf(out, c5.id, 'rhythm').op, 'inferred');
  assert.equal(JSON.stringify(out.performances), JSON.stringify(g.performances));
  assert.equal(c5.id, g.parts[0].events.find(e => e.at === '0' && e.kind === 'note').id);
});
