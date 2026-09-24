/* G4a: the glyph table against the pinned font (docs/GOALS/G04 §18.2).

   Every ornament the schema knows has a SMuFL glyph named; a glyph the vendored Bravura data lacks is listed as
   missing with a substitute the data has (or 'text'), and a glyph listed as missing really is. A plan that needs a
   substitute draws the mark and says so (code substitute-glyph, diagnostic MISSING_GLYPH), never defers it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E } = require('./helpers.js');

const vex = fs.readFileSync(path.join(REPO, 'vendor', 'vexflow-4.2.3.js'), 'latin1');
const has = name => new RegExp('[,{]' + name + ':\\{').test(vex);

test('every schema ornament has a glyph; the missing ones really are missing, and their substitutes are there', () => {
  const G = E.glyphs;
  assert.deepEqual(Object.keys(G.ORNAMENT).sort(), SG.schema.ORNAMENTS.slice().sort());
  Object.values(G.ORNAMENT).forEach(glyph => {
    if (G.MISSING[glyph]) {
      assert.equal(has(glyph), false, glyph + ' is listed missing and is');
      const sub = G.MISSING[glyph];
      assert.ok(sub === 'text' || has(sub), glyph + ' -> ' + sub + ' is in the font');
    } else assert.ok(has(glyph), glyph + ' is in the pinned font');
  });
});

test('an ornament with a substitute glyph is drawn and says so; none is deferred', () => {
  const b = SG.builder({ id: 'orn', meta: {} });
  const src = b.source({ kind: 'user' });
  b.setDefault({ src: src.id });
  const m = b.measure({ number: '1', dur: '1' });
  b.meter({ m: m.id, beats: [4], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  const v = b.voice(part, { staff: st.id, label: '1' });
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' });
  SG.schema.ORNAMENTS.slice(0, 4).forEach((o, i) => b.event(part, { kind: 'note', m: m.id, at: ['0', '1/4', '1/2', '3/4'][i], dur: '1/4', voice: v.id, staff: st.id,
    heads: [{ pitch: { step: 'C', oct: 5 } }], orn: [{ type: SG.schema.ORNAMENTS[i + 4] }] }));
  const g = b.finish().graph;
  const p = E.plan(g);
  assert.ok(E.audit(g, p).ok);
  const orn = p.ledger.filter(en => en.kind === 'ornament');
  assert.equal(orn.length, 4);
  assert.ok(orn.every(en => en.status === 'drawn'));
  const subs = orn.filter(en => en.code === 'substitute-glyph').length;
  assert.equal(subs, p.diagnostics.filter(d => d.code === 'MISSING_GLYPH').length);
  assert.ok(subs >= 2, subs + ' of shake, schleifer, tremolo, inverted-turn need a substitute');
});
