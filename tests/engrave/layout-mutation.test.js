/* G4b: the layout's metrics and checks are not dead (docs/GOALS/G04 §23; the G4b review R2).

   Each mutation edits the layout's SOURCE - a copy of engrave/ in a temporary directory, one anchored edit - the way a
   real regression would, lays out fixed probe graphs with the mutated code at both screen configs, and computes the L2
   metrics (l2.js), the determinism check (A27) and the static check (A29, a29.js) on what comes out. A mutation must
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
const { REPO, graphOf } = require('./helpers.js');
const { l2 } = require('./l2.js');
const A29 = require('./a29.js');

const REST_PUSH = "        objs.push({ id: e.id, kind: 'rest', refs: [e.id], event: e.id, glyph: name, center: !!e.measureRest,\n" +
  "          box: MT.box(name, -g.xMin, y), layer: 'note' });\n";
const ONE_REST = "        if (e === plan.events.find(x => x.kind === 'rest' && !x.hidden)) objs.push(Object.assign({}, objs[objs.length - 1], ";
const LAYOUT_TOP = '    counters.layout++;\n    const cfg = normalizeConfig(config);';
const MUTATIONS = [
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
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ box: objs[objs.length - 1].box.slice() }));\n']] },
  { id: 'M11b', expect: ['eg.layout.multiset_diff'], what: 'one rest (the piece\'s first) drawn twice, the copy under a new id',
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ id: e.id + \'#copy\', box: objs[objs.length - 1].box.slice() }));\n']] },
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
        '            e.heads.some(h => { const o = staffById.get(h.staff || e.staff); return o && o.part === s.part; })));']] }
];
const CONTROLS = [
  { id: 'N1', what: 'a comment reworded',
    edits: [['/* horizontal gaps, sp (G04 §9.3, §15.4) */', '/* horizontal gaps in staff spaces (G04 §9.3, §15.4) */']] },
  { id: 'N2', what: 'two independent statements swapped (the beamed set and the tie starts)',
    edits: [['    const beamed = new Set();\n    plan.beams.forEach(b => b.events.forEach(id => beamed.add(id)));\n' +
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n',
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n' +
      '    const beamed = new Set();\n    plan.beams.forEach(b => b.events.forEach(id => beamed.add(id)));\n']] }
];
/* the probes: two voices with rests, an accidental chord, a long grand-staff piece (several systems), and two piano
   pieces whose hands cross middle C - Czerny 849/005 dense (its phone systems already at a smaller staff size),
   Burgmuller 015. Every catch below is carried by two probes or more. */
const PROBES = {
  E13: 'tests/engrave/fixtures/e/E13-two-voices-rests.musicxml',
  E33: 'tests/engrave/fixtures/e/E33-accidental-chord.musicxml',
  E37: 'tests/engrave/fixtures/e/E37-long.musicxml',
  czerny849_005: 'catalog/method/czerny849/005.mxl',
  burg015: 'catalog/method/burgmuller25/015.mxl'
};
const CONFIGS = [{ breakpoint: 'desktop' }, { breakpoint: 'phone' }];
const FILE = 'layout.js';

let tmp = null;
const load = () => {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(tmp)) delete require.cache[k]; });
  return require(path.join(tmp, 'engrave', 'index.js'));
};
function withEdits(m, fn) {
  const file = path.join(tmp, 'engrave', FILE);
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
      const x = l2(eng, p, { prepared: P, layout: E.layout });
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
const caught = (r, name) => (name.indexOf('eg.') === 0 ? r.metrics[name] > 0 : r.findings.some(f => f.rule === name && f.file === FILE));

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

test('every layout mutation (G04 §23: M6, M7, M9, M10, M11, M17, M18, M21) is live and caught by the metric or check it names; N1 and N2 change nothing', async (t) => {
  const graphs = {};
  for (const k of Object.keys(PROBES)) {
    graphs[k] = await graphOf(PROBES[k]);
    assert.ok(graphs[k], k + ' opens');
  }
  assert.match(fs.readFileSync(path.join(tmp, 'engrave', FILE), 'utf8'), /\r\n/, 'the copy has CRLF line ends');
  const base = run(load(), graphs);
  /* every name a mutation expects is clean without it, on the same probes */
  MUTATIONS.forEach(m => m.expect.forEach(name => assert.ok(!caught(base, name), m.id + ': ' + name + ' is clean on the real code')));
  assert.deepEqual(base.findings, []);
  const report = [];
  MUTATIONS.forEach(m => withEdits(m, E => {
    const r = run(E, graphs);
    if (m.static) assert.notDeepEqual(r.findings, base.findings, m.id + ' (' + m.what + '): the A29 findings changed - the mutation is live');
    else assert.notEqual(r.output, base.output, m.id + ' (' + m.what + '): the EngravedScores changed - the mutation is live');
    m.expect.forEach(name => assert.ok(caught(r, name), m.id + ' (' + m.what + '): caught by ' + name + ' - ' +
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
