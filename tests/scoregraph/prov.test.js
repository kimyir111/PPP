'use strict';
/* Provenance: sparse, inherited field by field (G01 §11, A28, A29). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SG, FIX, read, xml, importXml, codes } = require('./helpers.js');

test('provOf resolves each field from the most specific place: aspect, entity, containers, default (A28)', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'prov.sg.json')));
  const [xmlSrc, amtSrc] = g.provenance.sources.map(s => s.id);
  const part = g.parts[0];
  const [e1, e2] = part.events;
  const h1 = e1.heads[0].id, h2 = e2.heads[0].id;
  const m1 = g.timeline.measures[0].id;
  const P = (id, aspect) => SG.prov.provOf(g, id, aspect);
  /* 1. a head's aspect: the aspect's op and conf, the event's source */
  assert.deepEqual(P(h1, 'pitch'), { src: amtSrc, op: 'repaired', conf: 0.8 });
  /* 2. the same head without an aspect: the event's source and conf, the part's op */
  assert.deepEqual(P(h1), { src: amtSrc, op: 'inferred', conf: 0.9 });
  /* 3. an aspect the head does not state falls through the same way */
  assert.deepEqual(P(h1, 'limb'), { src: amtSrc, op: 'inferred', conf: 0.9 });
  /* 4. a head and event with no prov: the part's op, the default's source, no conf (unknown is not 1) */
  assert.deepEqual(P(h2), { src: xmlSrc, op: 'inferred' });
  /* 5. a measure: its own op and conf over the default */
  assert.deepEqual(P(m1), { src: xmlSrc, op: 'edited', conf: 0.5 });
  /* 6. a clef (a part's entity with no prov): the part, then the default */
  assert.deepEqual(P(part.clefs[0].id), { src: xmlSrc, op: 'inferred' });
  assert.throws(() => P('e999'), e => e.code === 'E-REF-MISSING');
});

test('a MusicXML import has one source, an "imported" default and no prov on any entity (A28)', () => {
  ['grand-staff', 'tuplets-nested', 'transposing'].forEach(name => {
    const g = importXml(xml(name), { scoreId: 'p', sourceName: name + '.musicxml' }).graph;
    assert.equal(g.provenance.sources.length, 1);
    assert.equal(g.provenance.sources[0].kind, 'musicxml');
    assert.deepEqual(g.provenance.default, { src: g.provenance.sources[0].id, op: 'imported' });
    assert.ok(!/"prov":/.test(SG.serialize(g)), name);
  });
});

test('a prov that repeats what the entity inherits is reported as I-PROV-REDUNDANT (A29)', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'info-prov-redundant.sg.json')));
  const r = SG.validate(g);
  assert.equal(r.ok, true);
  assert.equal(codes(r.issues)['I-PROV-REDUNDANT'], 1);
  const clean = SG.parse(read(path.join(FIX, 'valid', 'prov.sg.json')));
  assert.equal(codes(SG.validate(clean).issues)['I-PROV-REDUNDANT'], undefined);
});
