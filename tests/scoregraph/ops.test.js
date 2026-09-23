'use strict';
/* Edit operations and what they do to IDs (G01 §12.3, §12.4, A31). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SG, FIX, read, codes } = require('./helpers.js');
const O = SG.ops;

const waltz = () => SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
const ids = g => {
  const out = new Set();
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { if (typeof v.id === 'string' && SG.schema.ID_RE.test(v.id)) out.add(v.id); Object.values(v).forEach(walk); }
  })(g);
  return out;
};
const spanner = (g, id) => g.parts[0].spanners.find(s => s.id === id);

test('updateHead keeps the head\'s and event\'s IDs, raises rev by one and leaves the input as it was', () => {
  const g = waltz(), before = SG.serialize(g);
  const r = O.updateHead(g, 'h35', { pitch: { step: 'F', oct: 5 }, acc: { type: 'natural' }, fingering: [{ f: '4' }], limb: 'LH' });
  assert.equal(SG.serialize(g), before);
  assert.equal(r.graph.rev, g.rev + 1);
  assert.deepEqual(r.idMap, {});
  assert.deepEqual(ids(r.graph), ids(g));
  const e = r.graph.parts[0].events.find(x => x.id === 'e34');
  assert.deepEqual(e.heads[0], { id: 'h35', pitch: { step: 'F', oct: 5 }, acc: { type: 'natural' }, fingering: [{ f: '4' }], limb: 'LH' });
  assert.deepEqual(O.updateHead(r.graph, 'h35', { acc: null, limb: null }).graph.parts[0].events.find(x => x.id === 'e34').heads[0],
    { id: 'h35', pitch: { step: 'F', oct: 5 }, fingering: [{ f: '4' }] });
  assert.throws(() => O.updateHead(g, 'h999', {}), e => e.code === 'E-OP-TARGET');
  /* a change that breaks a rule is refused whole: G5 tied to a G5 cannot become A5 */
  assert.throws(() => O.updateHead(g, 'h28', { pitch: { step: 'A', oct: 5 } }), e => e.code === 'E-OP-RESULT' && e.issues.some(i => i.code === 'E-TIE-PITCH'));
});

test('removeEvents opens a tie that loses one end and drops one that loses both; slurs and tuplets shrink (§12.3)', () => {
  const g = waltz();
  /* the tie s47 runs h28 (e27) -> h33 (e32) */
  const a = O.removeEvents(g, ['e27']);
  assert.deepEqual(a.idMap, { e27: null, h28: null });
  assert.deepEqual(spanner(a.graph, 's47'), { id: 's47', type: 'tie', to: 'h33' });
  assert.equal(codes(a.issues)['W-TIE-OPEN'], 1);
  const b = O.removeEvents(g, ['e27', 'e32']);
  assert.equal(spanner(b.graph, 's47'), undefined);
  assert.equal(b.idMap.s47, null);
  /* the slur s48 runs e21 -> e32: it keeps its start */
  assert.deepEqual(spanner(b.graph, 's48'), { id: 's48', type: 'slur', from: 'e21' });
  /* the triplet s46 over e21, e23, e25 loses e23, then all three */
  const c = O.removeEvents(g, ['e23']);
  assert.deepEqual(spanner(c.graph, 's46').events, ['e21', 'e25']);
  assert.equal(codes(c.issues)['W-TUPLET-INCOMPLETE'], 1);
  const d = O.removeEvents(g, ['e21', 'e23', 'e25']);
  assert.equal(spanner(d.graph, 's46'), undefined);
  assert.deepEqual(spanner(d.graph, 's48'), { id: 's48', type: 'slur', to: 'e32' });
  assert.equal(d.idMap.s46, null);
  /* a performed note linked to a removed head loses the link, not the note */
  const e = O.removeEvents(g, ['e18']);
  assert.equal(e.graph.performances[0].notes.find(n => n.id === 'pn52').link, undefined);
  assert.equal(e.graph.rev, 1);
  assert.throws(() => O.removeEvents(g, ['e999']), x => x.code === 'E-OP-TARGET');
});

/* five 4/4 measures of whole notes in one voice: C5 tied from bar 2 into bar 3, D5 tied from bar 4 into bar 5 */
function fiveBars() {
  const b = SG.builder({ id: 'fx-region', source: { kind: 'user' } });
  const p = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(p, { limb: 'RH' }).id, st2 = b.staff(p, { limb: 'LH' }).id;
  const v = b.voice(p, { staff: st, label: '1' }).id;
  const ms = [1, 2, 3, 4, 5].map(n => b.measure({ number: String(n), dur: '1' }).id);
  b.meter({ m: ms[0], beats: [4], beatType: 4 });
  b.clef(p, { staff: st, m: ms[0], at: '0', sign: 'G' }); b.clef(p, { staff: st2, m: ms[0], at: '0', sign: 'F' });
  const steps = ['A', 'C', 'C', 'D', 'D'];
  const evs = ms.map((m, i) => b.event(p, { kind: 'note', m: m, at: '0', dur: '1', voice: v, staff: st, display: { type: 'whole' }, heads: [{ pitch: { step: steps[i], oct: 5 } }] }));
  b.spanner(p, { type: 'tie', from: evs[1].heads[0].id, to: evs[2].heads[0].id });
  b.spanner(p, { type: 'tie', from: evs[3].heads[0].id, to: evs[4].heads[0].id });
  b.spanner(p, { type: 'slur', from: evs[0].id, to: evs[4].id });
  return { g: b.finish().graph, ms: ms, v: v, st: st, evs: evs.map(e => e.id), heads: evs.map(e => e.heads[0].id) };
}

test('replaceRegion over bars 3-4: IDs outside kept, new IDs from nextId, boundary ties opened or joined again, no ERROR (A31)', () => {
  const f = fiveBars();
  const g = f.g;
  const region = { part: g.parts[0].id, from: { m: f.ms[2], at: '0' }, to: { m: f.ms[4], at: '0' } };
  const note = (m, id, hid, step) => ({ id: id, kind: 'note', m: m, at: '0', dur: '1', voice: f.v, staff: f.st, display: { type: 'whole' }, heads: [{ id: hid, pitch: { step: step, oct: 5 } }] });
  /* a fragment that joins the incoming tie again and leaves the outgoing one open */
  const r = O.replaceRegion(g, region, {
    events: [note(f.ms[2], 'x1', 'x2', 'C'), note(f.ms[3], 'x3', 'x4', 'E')],
    spanners: [{ id: 'x5', type: 'tie', from: f.heads[1], to: 'x2' }],
    directions: [{ id: 'x6', kind: 'words', m: f.ms[2], at: '0', text: 'new' }]
  });
  const before = ids(g), after = ids(r.graph);
  const inside = new Set([f.evs[2], f.evs[3], f.heads[2], f.heads[3]]);
  const tieIn = g.parts[0].spanners.find(s => s.type === 'tie' && s.from === f.heads[1]).id;
  before.forEach(id => { if (!inside.has(id) && id !== tieIn) assert.ok(after.has(id), id + ' kept'); });
  const fresh = Array.from(after).filter(id => !before.has(id));
  assert.ok(fresh.length >= 5);
  fresh.forEach(id => assert.ok(SG.schema.idNumber(id) >= g.nextId, id + ' >= ' + g.nextId));
  assert.equal(r.graph.nextId, g.nextId + fresh.length);
  /* the incoming tie: the old one (to the replaced head) is replaced by the fragment's, which joins it again */
  assert.equal(r.idMap[tieIn], r.graph.parts[0].spanners.find(s => s.type === 'tie' && s.from === f.heads[1]).id);
  /* the outgoing tie lost its start with bar 4's D: an open tie to bar 5 */
  const out = r.graph.parts[0].spanners.find(s => s.type === 'tie' && s.to === f.heads[4]);
  assert.equal(out.from, undefined);
  assert.equal(r.idMap[f.evs[2]], null);
  assert.equal(r.idMap[f.heads[3]], null);
  assert.equal(SG.validate(r.graph).ok, true);
  assert.equal(codes(r.issues)['W-TIE-OPEN'], 1);
  assert.equal(r.graph.rev, g.rev + 1);
});

test('replaceRegion keeps an event the fragment names, and refuses a region that cuts an event (A31, E-REGION-BOUNDARY)', () => {
  const f = fiveBars();
  const g = f.g, before = SG.serialize(g);
  const keep = JSON.parse(JSON.stringify(g.parts[0].events.find(e => e.id === f.evs[3])));
  keep.heads[0].fingering = [{ f: '2' }];
  const r = O.replaceRegion(g, { part: g.parts[0].id, from: { m: f.ms[3], at: '0' }, to: { m: f.ms[4], at: '0' } }, { events: [keep] });
  assert.ok(r.graph.parts[0].events.some(e => e.id === f.evs[3] && e.heads[0].id === f.heads[3] && e.heads[0].fingering));
  assert.deepEqual(r.idMap, {});
  /* half a whole note: the region [bar 3 at 1/2, bar 4 at 0) cuts bar 3's event */
  assert.throws(() => O.replaceRegion(g, { part: g.parts[0].id, from: { m: f.ms[2], at: '1/2' }, to: { m: f.ms[3], at: '0' } }, { events: [] }),
    e => e.code === 'E-REGION-BOUNDARY');
  assert.equal(SG.serialize(g), before);
  /* a fragment that breaks a rule is refused whole, and the graph stays as it was */
  assert.throws(() => O.replaceRegion(g, { part: g.parts[0].id, from: { m: f.ms[2], at: '0' }, to: { m: f.ms[3], at: '0' } },
    { events: [{ id: 'x1', kind: 'note', m: f.ms[2], at: '0', dur: '2', voice: f.v, staff: f.st, heads: [{ id: 'x2', pitch: { step: 'C', oct: 5 } }] }] }),
  e => e.code === 'E-OP-RESULT');
  assert.equal(SG.serialize(g), before);
  assert.ok(O.CODES.includes('E-REGION-BOUNDARY'));
  assert.ok(!SG.CODES.includes('E-REGION-BOUNDARY'));
});
