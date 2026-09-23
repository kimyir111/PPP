'use strict';
/* G3 Step 4: logical tuplets, G1 F1 (docs/GOALS/G03 §7; A9 tuplet part, A10, A11, A13). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG, codes } = require('./helpers.js');
const { render, runSpec, appBrackets } = require('./g3-helpers.js');
const D = require('./g3-corpus-data.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'tuplet');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

test('A11: every T fixture gives exactly its sidecar (members, ratio, unit, parent)', () => {
  assert.ok(specs.length >= 8, specs.length + ' fixtures');
  specs.forEach(f => {
    const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const r = runSpec(spec);
    const ex = spec.expect;
    if (ex.same) assert.equal(r.output, r.input, f + ': the graph comes back unchanged');
    if (ex.rh !== undefined) assert.equal(render(r.output)[0], ex.rh, f);
    if (ex.lh !== undefined) assert.equal(render(r.output)[1], ex.lh, f);
    if (ex.warnings) assert.deepEqual(codes(SG.validate(r.output).issues, 'WARNING'), ex.warnings, f);
    if (ex.issues) assert.deepEqual(codes(r.report.issues), ex.issues, f);
  });
});

test('T09 / A13: export then import gives back the same tuplets (members, ratios, units, parents)', () => {
  const shape = g => {
    const p = g.parts[0];
    const at = new Map(p.events.map(e => [e.id, e.m + '@' + e.at + '/' + e.voice]));
    const byId = new Map(p.spanners.filter(s => s.type === 'tuplet').map(s => [s.id, s]));
    return p.spanners.filter(s => s.type === 'tuplet').map(s => JSON.stringify([s.events.map(id => at.get(id)), s.actual, s.normal, s.unit || null,
      s.parent ? byId.get(s.parent).events.map(id => at.get(id)) : null])).sort();
  };
  const check = (g, label) => {
    const x = SG.musicxml.export(g);
    assert.equal(x.ok, true, label);
    const back = SG.musicxml.import(x.xml, { scoreId: 'rt' });
    assert.equal(back.ok, true, label);
    /* the importer names voices by their MusicXML number; compare by position and voice order */
    const norm = gg => { const vs = gg.parts[0].voices.map(v => v.id); return shape(gg).map(s => vs.reduce((t, v, i) => t.split('/' + v).join('/V' + i), s)); };
    assert.deepEqual(norm(back.graph), norm(g), label);
  };
  specs.forEach(f => check(runSpec(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).output, f));
  const rows = D.recorded(['core']).filter(r => r.graph.parts[0].spanners.some(s => s.type === 'tuplet'));
  rows.slice(0, 50).forEach(r => check(SG.professionalize(r.graph, { strict: true }).graph, r.id));
});

test('A10 (F1): on method/czerny849/020 the app draws one bracket per logical tuplet, and none has one note', { todo: 'Step 5: the last loose pieces sit next to rests only R-repr rewrites' }, () => {
  const rows = D.recorded(['core']).filter(r => r.id.indexOf('czerny849/020|') >= 0);
  assert.ok(rows.length >= 1);
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    const tuplets = out.parts[0].spanners.filter(s => s.type === 'tuplet');
    assert.ok(tuplets.length > 0, r.id);
    assert.equal(tuplets.filter(t => t.events.length === 1).length, 0, r.id + ': one-note tuplets');
    const whole = tuplets.filter(t => {
      const evs = t.events.map(id => out.parts[0].events.find(e => e.id === id));
      const sum = evs.reduce((s, e) => SG.rational.add(s, SG.rational.parse(e.dur)), SG.rational.ZERO);
      return SG.rational.eq(sum, SG.rational.mul(SG.rational.make(t.normal), SG.schema.noteValue(t.unit.type)));
    });
    assert.equal(whole.length, tuplets.length, r.id + ': every group fills its span');
    const drawnBefore = appBrackets(SG.musicxml.export(r.graph).xml), drawnAfter = appBrackets(SG.musicxml.export(out).xml);
    assert.equal(drawnAfter, tuplets.length, r.id + ': the app draws ' + drawnAfter + ' brackets for ' + tuplets.length + ' tuplets (before G3: ' + drawnBefore + ')');
  });
});

test('A9 (tuplet part): G3 leaves no W-TUPLET-INCOMPLETE on the recording graphs where it grouped', { todo: 'Step 5: loose triplet pieces next to rests R-repr rewrites' }, () => {
  const rows = D.recorded(['core']);
  let before = 0, after = 0, dispBefore = 0, dispAfter = 0;
  rows.forEach(r => {
    const a = codes(SG.validate(r.graph).issues, 'WARNING');
    const b = codes(SG.validate(SG.professionalize(r.graph, { strict: true }).graph).issues, 'WARNING');
    before += a['W-TUPLET-INCOMPLETE'] || 0; after += b['W-TUPLET-INCOMPLETE'] || 0;
    dispBefore += a['W-DISPLAY-DURATION'] || 0; dispAfter += b['W-DISPLAY-DURATION'] || 0;
  });
  console.log('# W-TUPLET-INCOMPLETE ' + before + ' -> ' + after + ', W-DISPLAY-DURATION ' + dispBefore + ' -> ' + dispAfter);
  assert.ok(after < before / 10, 'W-TUPLET-INCOMPLETE ' + before + ' -> ' + after);
});
