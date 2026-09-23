'use strict';
/* G3 Step 2: the notation ops of G03 §5.5 and the G01 §12.3 ID rules they keep. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const { mk, render } = require('./g3-helpers.js');
const O = SG.ops;

const part = g => g.parts[0];
const evAt = (g, m, at, voiceLabel) => {
  const v = part(g).voices.find(x => x.label === (voiceLabel || '1')).id;
  return part(g).events.find(e => e.m === g.timeline.measures[m].id && e.at === at && e.voice === v && !e.grace);
};
const ties = g => part(g).spanners.filter(s => s.type === 'tie');

test('edit with no change gives back the same graph object (R2 by construction)', () => {
  const g = mk({ rh: 'C5:q D5:q E5:q F5:q' });
  const r = O.edit(g, d => { d.setAcc(evAt(g, 0, '0').heads[0].id, null); });
  assert.equal(r.graph, g);
  assert.equal(r.changed, false);
  assert.deepEqual(r.idMap, {});
});

test('splitEvent: the first piece keeps its IDs, the second is new and tied; a tie going on moves to it (§12.3)', () => {
  const g = mk({ rh: 'C5:h~ C5:h | D5:w' });
  const e = evAt(g, 0, '0');
  const h = e.heads[0].id;
  const r = O.edit(g, d => d.splitEvent(e.id, '1/4', { type: 'quarter' }, { type: 'quarter' }));
  const g2 = r.graph;
  assert.equal(g2.rev, g.rev + 1);
  assert.equal(render(g2)[0], 'C5:q~ C5:q~ C5:h | D5:w');
  const front = evAt(g2, 0, '0'), back = evAt(g2, 0, '1/4');
  assert.equal(front.id, e.id);
  assert.equal(front.heads[0].id, h);
  assert.notEqual(back.id, e.id);
  assert.ok(ties(g2).some(t => t.from === h && t.to === back.heads[0].id));
  assert.ok(ties(g2).some(t => t.from === back.heads[0].id), 'the old tie now leaves the second piece');
  assert.deepEqual(r.idMap, {}, 'nothing retired');
});

test('splitEvent: staccato stays on the first piece, tenuto and a fermata go to the last (§12.2)', () => {
  const g0 = mk({ rh: 'C5:h r:h' });
  const doc = JSON.parse(SG.serialize(g0));
  const e = doc.parts[0].events.find(x => x.kind === 'note');
  e.arts = ['staccato', 'tenuto']; e.fermata = {};
  const g = SG.parse(JSON.stringify(doc));
  const g2 = O.edit(g, d => d.splitEvent(e.id, '1/4', { type: 'quarter' }, { type: 'quarter' })).graph;
  const a = evAt(g2, 0, '0'), b = evAt(g2, 0, '1/4');
  assert.deepEqual(a.arts, ['staccato']);
  assert.deepEqual(b.arts, ['tenuto']);
  assert.equal(a.fermata, undefined);
  assert.deepEqual(b.fermata, {});
});

test('mergeTied: the first keeps its IDs, the second retires into it; a tie going on leaves from the merged note', () => {
  const g = mk({ rh: 'C5:8~ C5:8~ C5:h. | C5:w' });
  const a = evAt(g, 0, '0'), b = evAt(g, 0, '1/8');
  const r = O.edit(g, d => d.mergeTied(a.id, b.id, { type: 'quarter' }));
  assert.equal(render(r.graph)[0], 'C5:q~ C5:h. | C5:w');
  assert.equal(r.idMap[b.id], a.id);
  assert.equal(r.idMap[b.heads[0].id], a.heads[0].id);
  assert.ok(ties(r.graph).some(t => t.from === a.heads[0].id));
});

test('a head the performance links to may not be retired (I5, R4)', () => {
  const g = mk({ rh: 'C5:8 C5:8~ C5:8 r:8 r:h', perf: true });
  const a = evAt(g, 0, '1/8'), b = evAt(g, 0, '1/4');
  /* b is a tie continuation: not linked; a is linked */
  assert.doesNotThrow(() => O.edit(g, d => d.mergeTied(a.id, b.id, { type: 'quarter' })));
  const plan = [{ kind: 'rest', at: '0', dur: '1', display: { type: 'whole', measureRest: true } }];
  const v = part(g).voices[0].id;
  assert.throws(() => O.edit(g, d => d.retimeVoiceMeasure(v, g.timeline.measures[0].id, plan)), /linked from performance/);
});

test('retimeVoiceMeasure: reused pieces keep IDs, ties in and out follow the notes, retired ones map forward', () => {
  const g = mk({ rh: 'C5:h~ C5:8~ C5:8 r:q | D5:w', lh: 'C3:w | C3:w' });
  const v = part(g).voices[0].id, m = g.timeline.measures[0].id;
  const first = evAt(g, 0, '0'), second = evAt(g, 0, '1/2'), third = evAt(g, 0, '5/8'), rest = evAt(g, 0, '3/4');
  const plan = [
    { reuse: first.id, kind: 'note', at: '0', dur: '1/2', display: { type: 'half' }, heads: [{ reuse: first.heads[0].id }], tieNext: true },
    { reuse: second.id, kind: 'note', at: '1/2', dur: '1/4', display: { type: 'quarter' }, heads: [{ reuse: second.heads[0].id }] },
    { reuse: rest.id, kind: 'rest', at: '3/4', dur: '1/4', display: { type: 'quarter' } }
  ];
  const r = O.edit(g, d => d.retimeVoiceMeasure(v, m, plan));
  assert.equal(render(r.graph)[0], 'C5:h~ C5:q r:q | D5:w');
  assert.equal(r.idMap[third.id], second.id, 'the merged tail maps to the note that now covers it');
  assert.equal(r.idMap[third.heads[0].id], second.heads[0].id);
  assert.equal(SG.validate(r.graph).ok, true);
});

test('retimeVoiceMeasure: a slur keeps its ends on the pieces that start and end where it did; tuplets over the region retire', () => {
  const g0 = mk({ rh: '3e[C5:8 D5:8 E5:8] F5:q G5:h' });
  const doc = JSON.parse(SG.serialize(g0));
  const evs = doc.parts[0].events.filter(e => e.kind === 'note');
  doc.parts[0].spanners.push({ id: 's' + doc.nextId, type: 'slur', from: evs[0].id, to: evs[3].id });
  doc.nextId += 1;
  const g = SG.parse(JSON.stringify(doc));
  const v = part(g).voices[0].id, m = g.timeline.measures[0].id;
  const keep = e => ({ reuse: e.id, kind: 'note', at: e.at, dur: e.dur, display: e.display, heads: e.heads.map(h => ({ reuse: h.id })) });
  const plan = evs.map(keep);
  const r = O.edit(g, d => d.retimeVoiceMeasure(v, m, plan));
  assert.equal(part(r.graph).spanners.filter(s => s.type === 'tuplet').length, 0);
  const slur = part(r.graph).spanners.find(s => s.type === 'slur');
  assert.equal(slur.from, evs[0].id);
  assert.equal(slur.to, evs[3].id);
});

test('moveHeads: a chord keeps its ID; the moved heads keep theirs in a new event on the other staff (§9.2)', () => {
  const g = mk({ rh: 'C4+E4+C5:w', lh: 'r:w' });
  const e = evAt(g, 0, '0');
  const low = e.heads.filter(h => h.pitch.oct === 4).map(h => h.id);
  const lh = part(g).voices.find(x => x.label === '5');
  const r = O.edit(g, d => {
    const ne = d.moveHeads(e.id, low, lh.id);
    d.refillRests(lh.id, g.timeline.measures[0].id, () => []);
    return ne;
  });
  const moved = part(r.graph).events.find(x => x.id === r.result);
  assert.deepEqual(moved.heads.map(h => h.id).sort(), low.slice().sort());
  assert.equal(moved.staff, lh.staff);
  assert.deepEqual(evAt(r.graph, 0, '0').heads.map(h => h.pitch.oct), [5]);
  assert.equal(render(r.graph)[1], 'C4+E4:w');
});

test('setTuplets: the same members keep the spanner (same object back); other members retire it', () => {
  const g = mk({ rh: '3[C5:8] 3[D5:8] 3[E5:8] r:q r:h' });
  const v = part(g).voices[0].id, m = g.timeline.measures[0].id;
  const notes = part(g).events.filter(e => e.kind === 'note').map(e => e.id);
  const r1 = O.edit(g, d => d.setTuplets(v, m, [{ events: notes, actual: 3, normal: 2, unit: { type: 'eighth' } }]));
  assert.equal(render(r1.graph)[0], '3e[C5:8 D5:8 E5:8] r:q r:h');
  assert.equal(Object.values(r1.idMap).filter(x => x === null).length, 3, 'three one-note brackets retired');
  const r2 = O.edit(r1.graph, d => d.setTuplets(v, m, [{ events: notes, actual: 3, normal: 2, unit: { type: 'eighth' } }]));
  assert.equal(r2.graph, r1.graph);
});

test('setSpelling keeps what a head sounds; setKey writes one key per measure', () => {
  const g = mk({ rh: 'C#5:w' });
  const h = evAt(g, 0, '0').heads[0].id;
  const r = O.edit(g, d => d.setSpelling(h, { step: 'D', alter: -1, oct: 5 }));
  assert.equal(render(r.graph)[0], 'Db5:w');
  assert.throws(() => O.edit(g, d => d.setSpelling(h, { step: 'D', oct: 5 })), /may not change what/);
  const k = O.edit(g, d => { d.setKey(g.timeline.measures[0].id, 2, 'major'); });
  assert.equal(k.graph.timeline.keys.length, 1);
  assert.equal(k.graph.timeline.keys[0].fifths, 2);
});
