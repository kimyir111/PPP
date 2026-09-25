/* G4b-G4c: the layout's metrics and checks are not dead (docs/GOALS/G04 §23; the G4b review R2).

   Each mutation edits the SOURCE of engrave/ - a copy in a temporary directory, one anchored edit in one file (the
   layout, or the plan's beam and tuplet rules for the mutations §23 words as plan defects) - the way a real regression
   would, lays out fixed probe graphs with the mutated code at both screen configs, and computes the L2 metrics (l2.js,
   given the graph, so a plan that drops what the graph states is caught against the graph), the determinism check
   (A27) and the static check (A29, a29.js) on what comes out. A mutation must
     1. find each of its anchors exactly once after CRLF is normalised to LF (the copy is written with CRLF line ends,
        as a Windows checkout has them, so this holds on every OS - the G2 MD-TEMPO-LAST-ONLY lesson),
     2. change the output for the probes (else it is dead and proves nothing - the G3 M3 lesson): the EngravedScores
        byte for byte, or for a static mutation (M18: a DOM call has nothing to measure in Node) the A29 findings, and
     3. be caught by the NAMED metric or check it plants a defect for, which is clean on the same probes without it -
        never by the committed layout hash alone.
   The no-op controls N1 (a comment reworded) and N2 (two independent statements swapped) must give byte-identical
   output and a clean check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SG, graphOf } = require('./helpers.js');
const { l2 } = require('./l2.js');
const A29 = require('./a29.js');

const REST_PUSH = "        objs.push(o);\n        restY.set(e.id, y);\n";
const ONE_REST = "        if (e === plan.events.find(x => x.kind === 'rest' && !x.hidden)) objs.push(Object.assign({}, o, ";
const LAYOUT_TOP = '    counters.layout++;\n    const cfg = normalizeConfig(config);';
const MUTATIONS = [
  /* G4b (§33.16.3) */
  { id: 'M6', expect: ['eg.overlap.acc'], what: 'an accidental 0.8 sp into its head',
    edits: [['let x = right - a.w;', 'let x = right - a.w + 0.8;']] },
  { id: 'M7a', expect: ['eg.spacing.monotonic_violations'], what: 'u -> 0 in the placement only: every spring at its rod, the reported u kept',
    edits: [['x += Math.max(u * g.spring.g, g.spring.rod);', 'x += Math.max(0 * g.spring.g, g.spring.rod);']] },
  { id: 'M7b', expect: ['eg.system.fill_err'], what: 'u -> 0 everywhere (the §23 wording: rods only, the reported u 0 too)',
    edits: [['u = sol.u;', 'u = 0;'], ['{ u = uRef; ragged = true; }', '{ u = 0; ragged = true; }']] },
  { id: 'M9', expect: ['eg.system.scaled_avoidable'], what: 'a line break removed: the first two systems laid out as one',
    edits: [['const br = { systems: br0.systems.map(([i, j]) => [lo + i, lo + j]), cost: br0.cost };',
      'const br0s = br0.systems.map(([i, j]) => [lo + i, lo + j]);\n' +
      '    const br = { systems: br0s.length > 1 ? [[br0s[0][0], br0s[1][1]]].concat(br0s.slice(2)) : br0s, cost: br0.cost };']] },
  { id: 'M10', expect: ['eg.clip.count'], what: 'the last system pushed off the page',
    edits: [['const x0 = MARGIN.left + braceSpace;', 'const x0 = MARGIN.left + braceSpace + (last ? 150 : 0);']] },
  { id: 'M11a', expect: ['eg.layout.multiset_diff'], what: 'one rest (the piece\'s first) drawn twice under its own id',
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ box: o.box.slice() }));\n']] },
  { id: 'M11b', expect: ['eg.layout.multiset_diff'], what: 'one rest (the piece\'s first) drawn twice, the copy under a new id',
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ id: e.id + \'#copy\', box: o.box.slice() }));\n']] },
  { id: 'M17', expect: ['eg.layout.nondeterministic'], what: 'insertion order leaks: every third layout reversed, then sorted without the id tie-break',
    edits: [['objects.sort((a, b) => a.system - b.system || (a.box[0] - b.box[0]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));',
      'if (counters.layout % 3 === 0) objects.reverse();\n    objects.sort((a, b) => a.system - b.system || (a.box[0] - b.box[0]));']] },
  { id: 'M18a', static: true, expect: ['dom-measure'], what: 'the layout measures text with getComputedTextLength',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const textWidth = el => (el && el.getComputedTextLength ? el.getComputedTextLength() : 0);\n    textWidth(null);']] },
  { id: 'M18b', static: true, expect: ['dom-global', 'global-object'], what: 'the layout reads globalThis.document',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const doc = globalThis.document;\n    if (doc && doc.fonts) cfg.fontsLoaded = doc.fonts.status === \'loaded\';']] },
  { id: 'M18c', static: true, expect: ['dom-measure'], what: 'the layout measures a box with getBBox',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const bbox = el => (el && el.getBBox ? el.getBBox() : null);\n    bbox(null);']] },
  { id: 'M21', expect: ['eg.layout.head_staff_wrong'], what: 'the layout picks the staff by pitch (octave 4 and up on the upper staff of a two-staff part)',
    edits: [
      ['const heads = e.heads.filter(h => (h.staff || e.staff) === staffId && (h.written || h.pos));',
        'const heads = e.heads.filter(h => {\n' +
        '          const own = staffById.get(h.staff || e.staff), ps = own ? staves.filter(t => t.part === own.part) : [], p = h.written || h.pos;\n' +
        '          return p && (ps.length === 2 ? ps[p.oct >= 4 ? 0 : 1].id : (h.staff || e.staff)) === staffId;\n' +
        '        });'],
      ['const here = evs.filter(e => R.eq(R.parse(e.at), R.parse(col.at)) && (e.staff === s.id || e.heads.some(h => h.staff === s.id)));',
        'const here = evs.filter(e => R.eq(R.parse(e.at), R.parse(col.at)) && (e.staff === s.id ||\n' +
        '            e.heads.some(h => { const o = staffById.get(h.staff || e.staff); return o && o.part === s.part; })));']] },
  /* G4c (§23 M1-M5, M16, M24) */
  { id: 'M1', file: 'plan-beams.js', expect: ['eg.beam.graph_missing'], what: 'the graph\'s beams ignored: none carried, every part derived by the rule',
    edits: [['        out.push(b);\n', '        void b;\n'], ["      if (part.spanners.some(s => s.type === 'beam')) return;\n", '']] },
  { id: 'M2', expect: ['eg.beam.derived_missing'], what: 'derived beams off: the layout draws the graph\'s beams only',
    edits: [['const beams = plan.beams.filter(b => !graceBeam(b)).map(', "const beams = plan.beams.filter(b => !graceBeam(b) && b.source !== 'derived').map("]] },
  { id: 'M3', expect: ['eg.voice.stem_policy_violations'], what: 'the stems of two voices flipped (the up voice down, the down voice up)',
    edits: [["const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);",
      "const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? (e.stem === 'up' ? 'down' : 'up') : null);"]] },
  { id: 'M4', expect: ['eg.tuplet.missing'], what: 'no tuplet number or bracket drawn',
    edits: [['      if (!digits.length && !t.bracket) return;\n', '      return;\n']] },
  { id: 'M5', file: 'plan-tuplets.js', expect: ['eg.tuplet.show_errors', 'eg.tuplet.suppressed_rendered'], what: 'show.number \'none\' ignored: every tuplet shows its number',
    edits: [["const number = show.number || 'actual';", "const number = 'actual';"]] },
  { id: 'M16', expect: ['eg.grace.misplaced', 'eg.layout.multiset_diff'], what: 'grace notes laid out as ordinary notes, on the time columns',
    edits: [['const evs = evByM.get(m.id).filter(e => !e.grace);', 'const evs = evByM.get(m.id).filter(e => !e.grace || e.grace.after);'],
      ['      if (!e.grace || e.grace.after || e.hidden || deferred.has(e.id)) return;\n', '      return;\n']] },
  { id: 'M24', expect: ['eg.tuplet.extent_err'], what: 'a tuplet bracket ends at its last note, leaving out a rest that ends the group',
    edits: [['const firstEv = present[0], lastEv = present[present.length - 1];',
      "const firstEv = present[0], lastEv = present.filter(id => mem.some(o => o.event === id && o.kind === 'notehead')).pop() || present[present.length - 1];"]] }
];
const CONTROLS = [
  { id: 'N1', what: 'a comment reworded',
    edits: [['/* horizontal gaps, sp (G04 §9.3, §15.4) */', '/* horizontal gaps in staff spaces (G04 §9.3, §15.4) */']] },
  { id: 'N2', what: 'two independent statements swapped (the grace-beam test and the tie starts)',
    edits: [['    const graceBeam = b => b.events.every(id => evById.get(id) && evById.get(id).grace);\n' +
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n',
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n' +
      '    const graceBeam = b => b.events.every(id => evById.get(id) && evById.get(id).grace);\n']] }
];
/* a triplet whose last member is a rest, bracketed (no beam holds it): the §23 M24 case */
function tripletEndingInARest() {
  const R = SG.rational;
  const b = SG.builder({ id: 'm24', meta: { title: 'M24' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const m = b.measure({ number: '1', dur: '1' });
  b.meter({ m: m.id, beats: [4], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  const v = b.voice(part, { staff: st.id, label: '1' });
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' });
  const ev = [];
  [['C', 5], ['D', 5], null].forEach((p, k) => ev.push(b.event(part, Object.assign({ kind: p ? 'note' : 'rest', m: m.id, at: R.format(R.make(k, 12)), dur: '1/12',
    voice: v.id, staff: st.id, display: { type: 'eighth' } }, p ? { heads: [{ pitch: { step: p[0], alter: 0, oct: p[1] } }] } : {}))));
  b.spanner(part, { type: 'tuplet', events: ev.map(e => e.id), actual: 3, normal: 2 });
  b.event(part, { kind: 'note', m: m.id, at: '1/4', dur: '3/4', voice: v.id, staff: st.id, display: { type: 'half', dots: 1 }, heads: [{ pitch: { step: 'E', alter: 0, oct: 5 } }] });
  return b.finish().graph;
}
/* the probes: two voices with rests, an accidental chord, a long grand-staff piece (several systems), two piano pieces
   whose hands cross middle C - Czerny 849/005 dense (its phone systems already at a smaller staff size), Burgmuller
   015 - and for G4c beams with secondary breaks and hooks (E02), tuplets shown as the file says (E04), two voices'
   seconds and unisons (E12), grace notes (E14), the recording shape with derived beams (E38), and the M24 triplet.
   Every catch below is carried by probes that contain what it plants a defect in. */
const PROBES = {
  E02: 'tests/engrave/fixtures/e/E02-beams-compound-secondary.musicxml',
  E04: 'tests/engrave/fixtures/e/E04-tuplet-show.musicxml',
  E12: 'tests/engrave/fixtures/e/E12-two-voices-heads.musicxml',
  E13: 'tests/engrave/fixtures/e/E13-two-voices-rests.musicxml',
  E14: 'tests/engrave/fixtures/e/E14-grace.musicxml',
  E33: 'tests/engrave/fixtures/e/E33-accidental-chord.musicxml',
  E37: 'tests/engrave/fixtures/e/E37-long.musicxml',
  E38: 'tests/engrave/fixtures/e/E38-recording-shape.musicxml',
  czerny849_005: 'catalog/method/czerny849/005.mxl',
  burg015: 'catalog/method/burgmuller25/015.mxl',
  m24: tripletEndingInARest
};
const CONFIGS = [{ breakpoint: 'desktop' }, { breakpoint: 'phone' }];
const FILE = 'layout.js';

let tmp = null;
const load = () => {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(tmp)) delete require.cache[k]; });
  return require(path.join(tmp, 'engrave', 'index.js'));
};
function withEdits(m, fn) {
  const file = path.join(tmp, 'engrave', m.file || FILE);
  const orig = fs.readFileSync(file, 'utf8');
  let text = orig.replace(/\r\n/g, '\n');
  m.edits.forEach(([from, to]) => {
    assert.equal(text.split(from).length - 1, 1, m.id + ': the anchor is found exactly once - ' + from.slice(0, 70));
    text = text.replace(from, () => to);
  });
  fs.writeFileSync(file, text);
  try { return fn(load()); } finally { fs.writeFileSync(file, orig); }
}

/* everything the probes give with one engrave/: the EngravedScores (the output), the L2 metrics summed over probes and
   configs, whether three more layouts of each probe hash the same (A27), and the A29 findings */
function run(E, graphs) {
  const out = [];
  const m = {};
  let nondet = 0;
  Object.keys(graphs).forEach(k => {
    const p = E.plan(graphs[k]);
    const P = E.layout.prepare(p);
    const lays = CONFIGS.map(c => E.layout.layout(P, c));
    lays.forEach(eng => {
      out.push(JSON.stringify(eng));
      const x = l2(eng, p, { prepared: P, layout: E.layout, graph: graphs[k] });
      Object.keys(x).forEach(key => { m[key] = (m[key] || 0) + x[key]; });
    });
    /* A27: the same graph three more times - prepared once, afresh, through the engraver's cache */
    const again = [E.layout.layout(P, CONFIGS[0]), E.engrave(E.plan(graphs[k]), CONFIGS[0]), E.layout.createEngraver(E.plan(graphs[k])).layout(CONFIGS[0])];
    again.forEach(eng => out.push(JSON.stringify(eng)));
    if (new Set([lays[0]].concat(again).map(eng => E.layoutHash(eng))).size !== 1) nondet++;
  });
  m['eg.layout.nondeterministic'] = nondet;
  const findings = A29.scanDir(path.join(tmp, 'engrave')).findings;
  return { output: out.join('\n'), metrics: m, findings: findings };
}
const caught = (r, name, file) => (name.indexOf('eg.') === 0 ? r.metrics[name] > 0 : r.findings.some(f => f.rule === name && f.file === (file || FILE)));

test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-layout-mut-'));
  ['engrave', 'scoregraph'].forEach(d => fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true }));
  /* the engrave/ copy as a Windows checkout holds it: CRLF line ends, whatever this checkout has */
  const dir = path.join(tmp, 'engrave');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  });
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('every layout mutation (G04 §23: M1-M7, M9-M11, M16-M18, M21, M24) is live and caught by the metric or check it names; N1 and N2 change nothing', async (t) => {
  const graphs = {};
  for (const k of Object.keys(PROBES)) {
    graphs[k] = typeof PROBES[k] === 'function' ? PROBES[k]() : await graphOf(PROBES[k]);
    assert.ok(graphs[k], k + ' opens');
  }
  assert.match(fs.readFileSync(path.join(tmp, 'engrave', FILE), 'utf8'), /\r\n/, 'the copy has CRLF line ends');
  const base = run(load(), graphs);
  /* every name a mutation expects is clean without it, on the same probes */
  MUTATIONS.forEach(m => m.expect.forEach(name => assert.ok(!caught(base, name, m.file), m.id + ': ' + name + ' is clean on the real code')));
  assert.deepEqual(base.findings, []);
  const report = [];
  MUTATIONS.forEach(m => withEdits(m, E => {
    const r = run(E, graphs);
    if (m.static) assert.notDeepEqual(r.findings, base.findings, m.id + ' (' + m.what + '): the A29 findings changed - the mutation is live');
    else assert.notEqual(r.output, base.output, m.id + ' (' + m.what + '): the EngravedScores changed - the mutation is live');
    m.expect.forEach(name => assert.ok(caught(r, name, m.file), m.id + ' (' + m.what + '): caught by ' + name + ' - ' +
      JSON.stringify(m.static ? r.findings : Object.fromEntries(Object.entries(r.metrics).filter(([k, v]) => v !== base.metrics[k])))));
    const also = Object.keys(r.metrics).filter(k => r.metrics[k] !== base.metrics[k] && m.expect.indexOf(k) < 0).sort();
    report.push(m.id + ' ' + m.expect.map(name => name + (name.indexOf('eg.') === 0 ? '=' + r.metrics[name] : '')).join(',') + (also.length ? ' (also ' + also.join(',') + ')' : ''));
  }));
  CONTROLS.forEach(c => withEdits(c, E => {
    const r = run(E, graphs);
    assert.equal(r.output, base.output, c.id + ' (' + c.what + '): byte-identical output');
    assert.deepEqual(r.metrics, base.metrics, c.id + ': the same metrics');
    assert.deepEqual(r.findings, [], c.id + ': a clean static check');
    report.push(c.id + ' byte-identical');
  }));
  assert.equal(report.length, MUTATIONS.length + CONTROLS.length);
  t.diagnostic(report.join('; '));
  /* an anchor that is not there, or not only once, fails its mutation: none dies silently */
  assert.throws(() => withEdits({ id: 'X1', edits: [['this anchor is nowhere in the layout', '']] }, () => null), /X1: the anchor is found exactly once/);
  assert.throws(() => withEdits({ id: 'X2', edits: [['const ', 'let ']] }, () => null), /X2: the anchor is found exactly once/);
  /* the copy is back to what it was */
  assert.deepEqual(run(load(), graphs).output, base.output);
});

