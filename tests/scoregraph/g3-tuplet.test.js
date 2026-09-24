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
    if (ex.unprinted !== undefined) assert.equal(r.output.parts[0].spanners.filter(s => s.type === 'tuplet' && s.printed === false).length, ex.unprinted, f);
  });
});

test('T09 / A13: export then import gives back the same tuplets (members, ratios, units, parents)', () => {
  const shape = g => {
    const p = g.parts[0];
    /* members by measure index, position and the voice's place among the part's voices (IDs differ after an import) */
    const mi = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    const vi = new Map(p.voices.map((v, i) => [v.id, i]));
    const at = new Map(p.events.map(e => [e.id, mi.get(e.m) + '@' + e.at + '/V' + vi.get(e.voice)]));
    const byId = new Map(p.spanners.filter(s => s.type === 'tuplet').map(s => [s.id, s]));
    /* a printed tuplet by its members; an unprinted one (no <tuplet> marks: MusicXML does not say where it starts and
       stops) by the ratio each of its events carries */
    const printed = p.spanners.filter(s => s.type === 'tuplet' && s.printed !== false).map(s => JSON.stringify([s.events.map(id => at.get(id)), s.actual, s.normal, s.unit || null,
      s.parent ? byId.get(s.parent).events.map(id => at.get(id)) : null]));
    const loose = [];
    p.spanners.filter(s => s.type === 'tuplet' && s.printed === false).forEach(s => s.events.forEach(id => loose.push(JSON.stringify([at.get(id), s.actual, s.normal]))));
    return printed.concat(loose).sort();
  };
  const check = (g, label) => {
    const x = SG.musicxml.export(g);
    assert.equal(x.ok, true, label);
    const back = SG.musicxml.import(x.xml, { scoreId: 'rt' });
    assert.equal(back.ok, true, label);
    assert.deepEqual(shape(back.graph), shape(g), label);
  };
  specs.forEach(f => check(runSpec(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).output, f));
  const rows = D.recorded(['core']).filter(r => r.graph.parts[0].spanners.some(s => s.type === 'tuplet'));
  rows.slice(0, 50).forEach(r => check(SG.professionalize(r.graph, { strict: true }).graph, r.id));
});

test('A10 (F1): on method/czerny849/020 no logical tuplet has one note, each fills its span, and the app draws every one', () => {
  const rows = D.recorded(['core']).filter(r => r.id.indexOf('czerny849/020|') >= 0);
  assert.ok(rows.length >= 1);
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    const tuplets = out.parts[0].spanners.filter(s => s.type === 'tuplet');
    assert.ok(tuplets.length > 0, r.id);
    /* G3 makes no one-note tuplet; one it could not group is the writer's own, left as it was (§28 M5) */
    const before = new Map(r.graph.parts[0].spanners.filter(s => s.type === 'tuplet').map(s => [s.id, JSON.stringify(s)]));
    tuplets.filter(t => t.events.length === 1).forEach(t => assert.equal(JSON.stringify(t), before.get(t.id), r.id + ': one-note tuplet ' + t.id + ' is not the writer\'s own'));
    const printed = tuplets.filter(t => t.printed !== false && t.events.length > 1);
    const whole = printed.filter(t => {
      const evs = t.events.map(id => out.parts[0].events.find(e => e.id === id));
      const sum = evs.reduce((s, e) => SG.rational.add(s, SG.rational.parse(e.dur)), SG.rational.ZERO);
      return SG.rational.eq(sum, SG.rational.mul(SG.rational.make(t.normal), SG.schema.noteValue(t.unit.type)));
    });
    assert.equal(whole.length, printed.length, r.id + ': every printed group fills its span');
    /* the app's renderer closes a bracket when `normal` times the shortest value it has seen has gone by, so a group
       holding a triplet 32nd is drawn as more than one bracket (G4, D4); every group is drawn at least once */
    const drawnBefore = appBrackets(SG.musicxml.export(r.graph).xml), drawnAfter = appBrackets(SG.musicxml.export(out).xml);
    console.log('# ' + r.id + ': ' + printed.length + ' printed groups (' + (tuplets.length - printed.length) + ' one-note tuplets left as the writer wrote them), the app draws ' + drawnAfter + ' brackets (before G3: ' + drawnBefore + ')');
    assert.ok(drawnAfter >= printed.length, r.id + ': the app draws ' + drawnAfter + ' brackets for ' + printed.length + ' tuplets');
  });
});

test("M5 (G03 §28): G3 creates no one-note tuplet; every one it leaves is the writer's own, unchanged, where it reports N-TUPLET-UNGROUPABLE", () => {
  let left = 0, hidden = 0;
  D.recorded().forEach(r => {
    const res = SG.professionalize(r.graph);
    const said = new Set(res.report.issues.filter(i => i.code === 'N-TUPLET-UNGROUPABLE' && i.at).map(i => i.at.m + '|' + i.at.voice));
    const before = new Map();
    r.graph.parts.forEach(p => p.spanners.forEach(s => { if (s.type === 'tuplet') before.set(s.id, JSON.stringify(s)); }));
    res.graph.parts.forEach(p => {
      const ev = new Map(p.events.map(e => [e.id, e]));
      p.spanners.forEach(s => {
        if (s.type !== 'tuplet' || s.events.length !== 1) return;
        left++;
        assert.equal(JSON.stringify(s), before.get(s.id), r.id + ': one-note tuplet ' + s.id + ' made or changed by G3');
        /* G3 hides none: one not printed is a piece the writer itself hid (buildGraph prints a split triplet's first and
           last pieces only, G1 F1), kept as it was; nq counts it (a time-modified note under no bracket) */
        if (s.printed === false) { hidden++; assert.equal(JSON.parse(before.get(s.id)).printed, false, r.id + ': ' + s.id + ' hidden by G3'); }
        const e = ev.get(s.events[0]);
        assert.ok(said.has(e.m + '|' + e.voice), r.id + ': ' + s.id + ' left without N-TUPLET-UNGROUPABLE');
      });
    });
  });
  console.log('# one-note tuplets left as written, every one reported: ' + left + ' (' + hidden + ' the writer hid)');
});

test('A9 (tuplet part): every W-TUPLET-INCOMPLETE and W-DISPLAY-DURATION G3 leaves is in a voice-measure it reports', () => {
  const rows = D.recorded(['core']);
  let before = 0, after = 0, dispBefore = 0, dispAfter = 0;
  rows.forEach(r => {
    const a = codes(SG.validate(r.graph).issues, 'WARNING');
    const res = SG.professionalize(r.graph, { strict: true });
    const iss = SG.validate(res.graph).issues;
    const b = codes(iss, 'WARNING');
    before += a['W-TUPLET-INCOMPLETE'] || 0; after += b['W-TUPLET-INCOMPLETE'] || 0;
    dispBefore += a['W-DISPLAY-DURATION'] || 0; dispAfter += b['W-DISPLAY-DURATION'] || 0;
    const said = new Set(res.report.issues.filter(i => i.at && (i.code === 'N-RHYTHM-UNREPRESENTABLE' || i.code === 'N-TUPLET-UNGROUPABLE')).map(i => i.at.m));
    iss.filter(i => i.code === 'W-TUPLET-INCOMPLETE' || i.code === 'W-DISPLAY-DURATION').forEach(i => {
      assert.ok(i.at && said.has(i.at.m), r.id + ': ' + i.code + ' ' + i.message + ' in a measure G3 says nothing about');
    });
  });
  console.log('# W-TUPLET-INCOMPLETE ' + before + ' -> ' + after + ', W-DISPLAY-DURATION ' + dispBefore + ' -> ' + dispAfter);
  assert.ok(after < before / 10 && dispAfter < dispBefore / 2);
});
