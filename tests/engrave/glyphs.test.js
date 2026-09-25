/* G4a: the ornament glyph table against the pinned font (docs/GOALS/G04 §18.2, user decision G4-U5).

   Every ornament the schema knows has a SMuFL glyph named; a glyph listed as missing from the vendored Bravura data
   really is missing, and every other one is there. The plan defers exactly the ornaments whose glyph is missing
   (code ornament-glyph, G4d chooses what to draw), and an ornament the schema does not know is unsupported: named,
   and the audit fails. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E } = require('./helpers.js');

const vex = fs.readFileSync(path.join(REPO, 'vendor', 'vexflow-4.2.3.js'), 'latin1');
const has = name => new RegExp('[,{]' + name + ':\\{').test(vex);

test('every schema ornament has a glyph; the ones listed missing really are, and the others are in the pinned font', () => {
  const G = E.glyphs;
  assert.deepEqual(Object.keys(G.ORNAMENT).sort(), SG.schema.ORNAMENTS.slice().sort());
  G.MISSING.forEach(glyph => assert.ok(Object.values(G.ORNAMENT).indexOf(glyph) >= 0, glyph + ' is a glyph of the table'));
  Object.values(G.ORNAMENT).forEach(glyph => {
    if (G.MISSING.indexOf(glyph) >= 0) assert.equal(has(glyph), false, glyph + ' is listed missing and is');
    else assert.ok(has(glyph), glyph + ' is in the pinned font');
  });
});

function ornamentGraph(types) {
  const b = SG.builder({ id: 'orn', meta: {} });
  const src = b.source({ kind: 'user' });
  b.setDefault({ src: src.id });
  const R = SG.rational;
  const m = b.measure({ number: '1', dur: R.format(R.make(types.length, 4)) });
  b.meter({ m: m.id, beats: [types.length], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  const v = b.voice(part, { staff: st.id, label: '1' });
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' });
  types.forEach((t, i) => b.event(part, { kind: 'note', m: m.id, at: R.format(R.make(i, 4)), dur: '1/4', voice: v.id, staff: st.id,
    heads: [{ pitch: { step: 'C', oct: 5 } }], orn: [{ type: t }] }));
  return b.finish().graph;
}

test('the plan draws an ornament whose glyph is there and defers one whose glyph is missing - no substitute, no silence', () => {
  const g = ornamentGraph(SG.schema.ORNAMENTS.slice());
  const p = E.plan(g);
  assert.ok(E.audit(g, p).ok);
  const orn = p.ledger.filter(en => en.kind === 'ornament');
  assert.equal(orn.length, SG.schema.ORNAMENTS.length);
  SG.schema.ORNAMENTS.forEach((t, i) => {
    const gl = E.glyphs.ornament(t);
    const en = orn[i];
    if (gl.missing) assert.deepEqual([en.status, en.code], ['deferred', 'ornament-glyph'], t);
    else assert.deepEqual([en.status, en.code], ['drawn', undefined], t);
  });
  assert.equal(orn.filter(en => en.status === 'deferred').length, E.glyphs.MISSING.length);
  assert.equal(p.diagnostics.filter(d => d.code === 'MISSING_GLYPH').length, E.glyphs.MISSING.length);
  /* the output says which ones wait, so a renderer does not draw them */
  const out = p.events.flatMap(e => e.orn);
  assert.equal(out.filter(o => o.deferred === 'ornament-glyph').length, E.glyphs.MISSING.length);
});

test('an ornament or a spanner the schema does not know is unsupported: named, diagnosed, and the audit fails', () => {
  const g = ornamentGraph(['trill', 'mordent']);
  /* a graph no validator would pass, handed straight to the plan */
  const bad = JSON.parse(JSON.stringify(g));
  bad.parts[0].events[1].orn = [{ type: 'bebung' }];
  bad.parts[0].spanners.push({ id: 's9001', type: 'glissando-wave', from: bad.parts[0].events[0].id, to: bad.parts[0].events[1].id });
  const p = E.plan(bad);
  const un = p.ledger.filter(en => en.status === E.ledger.UNSUPPORTED);
  assert.deepEqual(un.map(en => en.code).sort(), ['unknown-ornament', 'unknown-spanner']);
  assert.ok(p.diagnostics.some(d => d.code === 'UNSUPPORTED_ORNAMENT') && p.diagnostics.some(d => d.code === 'UNSUPPORTED_SPANNER'));
  assert.equal(p.ledger.filter(en => en.status === 'deferred').length, 0, 'never deferred');
  const a = E.audit(bad, p);
  assert.equal(a.ok, false);
  assert.equal(a.unsupported.length, 2);
});
