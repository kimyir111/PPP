/* scoregraph/ops.js's new addSection/addPhrase (G07 §5, §11: "write them carefully against ops.js's
   existing conventions"). These are ScoreGraph ops, not SongGraph-specific, but G07 is what needed
   them, so their tests live here rather than in tests/scoregraph (matching G05/G06's own precedent
   of a new Goal's tests living under its own tests/<goal>/ directory even when it touches a shared
   module - e.g. tests/playability/fingering.test.js exercises scoregraph/ops.js's fingering writes). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { O, mk } = require('./helpers.js');

function piece() {
  return mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:q F5:q E5:q D5:q | C5:w', lh: 'C3:w | C3:w | C3:w' });
}

test('addSection: writes a validated Section with default-shaped provenance', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  const { graph, issues } = O.addSection(g, ms[0], ms[1], { label: 'A', prov: { op: 'inferred', source: { kind: 'generator', tool: 'ppp.test' } } });
  assert.equal(issues.filter(i => i.severity === 'ERROR').length, 0);
  assert.equal(graph.structure.sections.length, 1);
  const s = graph.structure.sections[0];
  assert.equal(s.from, ms[0]);
  assert.equal(s.to, ms[1]);
  assert.equal(s.label, 'A');
  assert.equal(s.prov.op, 'inferred');
});

test('addSection: an unknown measure is rejected (E-OP-TARGET), not silently accepted', () => {
  const g = piece();
  assert.throws(() => O.addSection(g, 'm999', 'm999'), /E-OP-TARGET/);
});

test('addSection: overlapping sibling sections (no parent) are rejected by the validator (E-STRUCTURE)', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  const once = O.addSection(g, ms[0], ms[1]).graph;
  assert.throws(() => O.addSection(once, ms[1], ms[2]), /E-OP-RESULT/);
});

test('addSection: a section may nest inside a real parent, and is rejected for a fake one', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  const withParent = O.addSection(g, ms[0], ms[2]).graph;
  const parentId = withParent.structure.sections[0].id;
  const { graph } = O.addSection(withParent, ms[0], ms[1], { parent: parentId });
  assert.equal(graph.structure.sections[1].parent, parentId);
  assert.throws(() => O.addSection(withParent, ms[0], ms[1], { parent: 'sc999' }), /E-OP-TARGET/);
});

test('addPhrase: writes a validated Phrase with from < to enforced by the validator', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  const { graph, issues } = O.addPhrase(g, { m: ms[0], at: '0' }, { m: ms[1], at: '0' });
  assert.equal(issues.filter(i => i.severity === 'ERROR').length, 0);
  assert.equal(graph.structure.phrases.length, 1);
  assert.throws(() => O.addPhrase(g, { m: ms[1], at: '0' }, { m: ms[0], at: '0' }), /E-OP-RESULT/);
});

test('addPhrase: an unknown part is rejected', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  assert.throws(() => O.addPhrase(g, { m: ms[0], at: '0' }, { m: ms[1], at: '0' }, { part: 'p999' }), /E-OP-TARGET/);
});

test('addSection/addPhrase: repeated {kind,tool} provenance sources are reused, not duplicated', () => {
  const g = piece();
  const ms = g.timeline.measures.map(m => m.id);
  const prov = { op: 'inferred', source: { kind: 'generator', tool: 'ppp.songgraph.sections' } };
  const r1 = O.addSection(g, ms[0], ms[0], { prov: prov });
  const r2 = O.addSection(r1.graph, ms[1], ms[1], { prov: prov });
  const sources = r2.graph.provenance.sources.filter(s => s.tool === 'ppp.songgraph.sections');
  assert.equal(sources.length, 1);
  assert.equal(r2.graph.structure.sections[0].prov.src, sources[0].id);
  assert.equal(r2.graph.structure.sections[1].prov.src, sources[0].id);
});
