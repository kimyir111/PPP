/* G4a: the fidelity ledger catches what a renderer would silently drop (docs/GOALS/G04 §21.1 L1, A1).

   Three readings: what the graph states (expected), what the plan's OUTPUT carries (consumed), and the plan's own
   ledger. Each case here is a plan that went wrong in one way - it dropped an object from its output, carried one
   changed, forgot a disposition, invented an entry, counted one twice, used an unapproved code - and the audit must
   name it. The plan is changed after it is made (JSON copy), so the same audit reads a plan that is really wrong. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, E, graphOf, goldenGraphs } = require('./helpers.js');

const L = E.ledger;
const clone = p => JSON.parse(JSON.stringify(p));

test('the three readings are independent: expected() reads the graph only, consumed() the plan output only', () => {
  const src = fs.readFileSync(path.join(REPO, 'engrave', 'ledger.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]\.\/plan/, 'ledger.js does not load the plan');
  assert.doesNotMatch(src, /PPPEngraveModules\.plan|M\.plan\b/);
  const body = name => { const i = src.indexOf('function ' + name + '('); const j = src.indexOf('\n  }\n', i); return src.slice(i, j); };
  assert.doesNotMatch(body('consumed'), /\.ledger\b|\bg\.|timeline|spanners|directions/, 'consumed() reads no graph field and no ledger');
  assert.doesNotMatch(body('expected'), /\bplan\b/, 'expected() reads no plan');
});

test('"this graph states N of kind X; the plan draws, derives, merges, suppresses or defers each"', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const p = E.plan(g);
  const a = E.audit(g, p);
  assert.ok(a.ok, JSON.stringify(a.missing.slice(0, 3)));
  const inv = E.inventory(g);
  const perKind = {};
  inv.forEach(kind => { perKind[kind] = (perKind[kind] || 0) + 1; });
  Object.keys(perKind).forEach(kind => {
    const k = a.byKind[kind];
    assert.equal(k.total, perKind[kind], kind + ': every one of them has a disposition');
    assert.equal(k.drawn + k.merged + k.suppressed + k.deferred, perKind[kind], kind);
    assert.equal(k.silent, 0, kind);
  });
  /* the statuses are G04's, every entry that is not simply drawn says why, and only with a code its status allows */
  p.ledger.forEach(en => {
    assert.ok(L.STATUS.indexOf(en.status) >= 0, en.ref);
    if (en.status !== 'drawn') assert.ok(en.code, en.ref + ' ' + en.status + ' has a code');
    if (en.code && en.status !== 'projected-loss') assert.ok(L.CODES[en.status].indexOf(en.code) >= 0, en.ref + ' ' + en.code);
  });
});

test('A1: deferred is G04\'s allow-list and nothing else', () => {
  assert.deepEqual(L.DEFERRED_ALLOWED.slice().sort(), ['cross-staff-beam', 'cross-staff-chord', 'grace-after', 'nested-3', 'stem-double', 'tab']);
  assert.deepEqual(L.STATUS.slice(), ['drawn', 'derived', 'merged', 'suppressed', 'deferred', 'projected-loss']);
});

/* ---------------------------------------------------------------- one defect at a time */
/* burgmuller25/015 (articulations, slurs, dynamics, 8va, pedal, hairpins, ties, fingering, graph beams), piano-marks
   (pedal changes), a transcription with ties and rests (G16), sonatina/020 (chords, long beams) and the nested tuplet
   fixture: between them every kind a mutation below touches. None is a G0 hold-out file. */
async function probes() {
  const golden = new Map(goldenGraphs());
  return [
    ['burg015', await graphOf('catalog/method/burgmuller25/015.mxl')],
    ['piano-marks', await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml')],
    ['G16', golden.get('golden/G16.sg.json')],
    ['sonatina/020', await graphOf('catalog/method/sonatina/020.mxl')],
    ['tuplets-nested', await graphOf('tests/scoregraph/fixtures/xml/tuplets-nested.musicxml')]
  ];
}
const find = (list, name) => list.find(x => x[0] === name)[1];

test('an object dropped from the OUTPUT while its ledger entry stays is missing - ties, articulations, slurs, beams, lines, marks, heads', async () => {
  const P = await probes();
  const cases = [
    ['G16', 'a tie', q => { q.ties.splice(0, 1); }, 'missing'],
    ['burg015', 'an articulation', q => { const e = q.events.find(x => x.arts.length); e.arts = []; }, 'missing'],
    ['burg015', 'a slur', q => { q.slurs.splice(0, 1); }, 'missing'],
    ['piano-marks', 'a pedal line', q => { q.lines = q.lines.filter(l => l.kind !== 'pedal'); }, 'missing'],
    ['piano-marks', 'a pedal change', q => { q.lines.find(l => l.kind === 'pedal' && l.changes.length).changes = []; }, 'missing'],
    ['burg015', 'a hairpin', q => { q.lines = q.lines.filter(l => l.kind !== 'wedge'); }, 'missing'],
    ['burg015', 'an 8va', q => { q.lines = q.lines.filter(l => l.kind !== 'ottava'); }, 'missing'],
    ['burg015', 'a dynamic', q => { q.marks = q.marks.filter(m => m.kind !== 'dynamic'); }, 'missing'],
    ['piano-marks', 'a fingering', q => { const e = q.events.find(x => x.heads.some(h => h.fingering.length)); e.heads.find(h => h.fingering.length).fingering = []; }, 'missing'],
    ['sonatina/020', 'a graph beam', q => { q.beams.splice(q.beams.findIndex(b => b.source === 'graph'), 1); }, 'missing'],
    ['sonatina/020', 'a head of a chord', q => { const e = q.events.find(x => x.heads.length > 1); e.heads.pop(); }, 'missing'],
    ['tuplets-nested', 'a tuplet', q => { q.tuplets.splice(0, 1); }, 'missing'],
    ['G16', 'a rest', q => { q.events.splice(q.events.findIndex(x => x.kind === 'rest'), 1); }, 'missing']
  ];
  cases.forEach(([probe, what, mutate, field]) => {
    const g = find(P, probe);
    const p = E.plan(g);
    assert.ok(E.audit(g, p).ok, probe + ' audits clean first');
    const q = clone(p);
    mutate(q);
    assert.notEqual(JSON.stringify(q), JSON.stringify(p), what + ': the mutation changed the output');
    const a = E.audit(g, q);
    assert.equal(a.ok, false, what + ' dropped from the output is caught');
    assert.ok(a[field].length >= 1, what + ': named as ' + field);
  });
});

test('an object the output carries CHANGED is altered - a tie\'s ends, a pitch, a beam\'s notes, a time, an articulation', async () => {
  const P = await probes();
  const cases = [
    ['G16', 'a tie with other ends', q => { const t = q.ties.find(x => x.from && x.to); const f = t.from; t.from = t.to; t.to = f; }],
    ['sonatina/020', 'a head at another pitch', q => { const h = q.events.find(x => x.heads.length).heads[0]; h.pitch.oct += 1; }],
    ['sonatina/020', 'a beam over other notes', q => { const b = q.beams.find(x => x.source === 'graph' && x.events.length > 2); b.events.pop(); }],
    ['G16', 'an event at another time', q => { q.events[0].at = '1/64'; }],
    ['burg015', 'another articulation', q => { const e = q.events.find(x => x.arts.length); e.arts[0] = e.arts[0] === 'staccato' ? 'tenuto' : 'staccato'; }],
    ['burg015', 'a slur between other notes', q => { const s = q.slurs[0]; s.to = s.from; }],
    ['burg015', 'an 8va of another size', q => { const o = q.lines.find(l => l.kind === 'ottava'); o.shift = o.shift * 2; }]
  ];
  cases.forEach(([probe, what, mutate]) => {
    const g = find(P, probe);
    const p = E.plan(g);
    const q = clone(p);
    mutate(q);
    assert.notEqual(JSON.stringify(q), JSON.stringify(p), what + ': the mutation changed the output');
    const a = E.audit(g, q);
    assert.equal(a.ok, false, what + ' is caught');
    assert.ok(a.altered.length >= 1, what + ': named as altered, not ' + JSON.stringify({ missing: a.missing.slice(0, 2) }));
  });
});

test('dropped with no disposition is silent: output and ledger entry both gone, per kind', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const p = E.plan(g);
  const kinds = [...new Set(p.ledger.map(en => en.kind))];
  assert.ok(kinds.length >= 20, kinds.length + ' kinds in this score');
  kinds.forEach(kind => {
    const q = clone(p);
    const n = q.ledger.filter(en => en.kind === kind && en.status !== 'derived' && en.status !== 'projected-loss').length;
    if (!n) return;
    q.ledger = q.ledger.filter(en => en.kind !== kind);
    const a = E.audit(g, q);
    assert.equal(a.ok, false, 'forgetting ' + kind + ' is caught');
    assert.equal(a.silent.length, n, kind + ': every one of them is named');
  });
});

test('the audit names an invented entry, a duplicate, a wrong kind, a bad status, an unapproved code, an orphan output object', async () => {
  const g = await graphOf('catalog/method/burgmuller25/015.mxl');
  const p = E.plan(g);
  assert.ok(E.audit(g, p).ok);
  const mut = f => { const q = clone(p); f(q); return E.audit(g, q); };
  assert.ok(mut(q => q.ledger.push({ ref: 'e99999', kind: 'note', status: 'drawn' })).invented.includes('e99999'));
  assert.ok(mut(q => q.ledger.push(Object.assign({}, q.ledger[3]))).duplicate.length === 1);
  assert.ok(mut(q => { q.ledger.find(en => en.kind === 'note').kind = 'rest'; }).kindMismatch.length === 1);
  assert.ok(mut(q => { q.ledger[0].status = 'ignored'; }).badStatus.length === 1);
  /* a new way of not drawing something: deferred with a code G04 A1 does not list */
  const art = p.ledger.find(en => en.kind === 'articulation');
  assert.ok(mut(q => { const en = q.ledger.find(x => x.ref === art.ref); en.status = 'deferred'; en.code = 'renderer-cannot'; }).unapproved.length === 1);
  assert.ok(mut(q => { const en = q.ledger.find(x => x.ref === art.ref); en.status = 'suppressed'; delete en.code; }).uncoded.length === 1);
  /* an object in the output that is neither the graph's nor a ledgered derived one */
  assert.ok(mut(q => q.beams.push({ id: 'd:beam:e999', events: ['e1', 'e2'], breaks: [], source: 'derived' })).orphan.includes('d:beam:e999'));
  /* a derived object the ledger names is the plan's own: not invented, not an orphan */
  const a = mut(q => { q.beams.push({ id: 'd:beam:e999', events: ['e1', 'e2'], breaks: [], source: 'derived' });
    q.ledger.push({ ref: 'd:beam:e999', kind: 'beam', status: 'derived', code: 'part-states-no-beams' }); });
  assert.deepEqual([a.invented, a.orphan], [[], []]);
});

test('a projection\'s losses are named as projected-loss, and only under p: references', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const p = E.plan(g, { projection: { unsupported: [{ code: 'transposition', count: 2, example: 'Bb4/C5' }] } });
  const a = E.audit(g, p);
  assert.ok(a.ok);
  const losses = p.ledger.filter(en => en.status === 'projected-loss');
  assert.deepEqual(losses.map(en => en.ref), ['p:legacy-score', 'p:transposition']);
  assert.equal(losses[1].count, 2);
  const q = clone(p); q.ledger.push({ ref: 'e1', kind: 'note', status: 'projected-loss', code: 'x' });
  assert.ok(E.audit(g, q).invented.includes('e1') || E.audit(g, q).duplicate.includes('e1'), 'a projected-loss entry may not claim a graph object');
});
