/* G9f on the real case of the teacher's review: catalog/method/hanon/010.mxl (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12 "G9f final-review fixes").
   The source is one note per hand and built on deliberate parallel octaves between the hands. The G9b `parallel` move used to move ten left-hand notes (beat 1 of
   bars 15-24) down an octave to break them; the source guard (repair/plan.js) leaves what the source does. What is left of the difference from the source is ONE note,
   the last bar's left hand (C2 in the source, C3 in the arrangement): the realizer's rebalanceHands puts the lower of two voices that both landed in the left hand into the
   RIGHT hand, and repair's `crossing` move then lifts it; realize's opts.orderedHands (off by default, see the doc) does not do that. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const P = require(path.join(REPO, 'scoregraph/pitch.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));

const key = (g, e) => {
  const m = new Map(g.timeline.measures.map((x, i) => [x.id, i + 1]));
  return (g.parts[0].staves.findIndex(s => s.id === e.staff) + 1) + '|' + m.get(e.m) + '|' + e.at;
};
const notes = g => { const o = new Map(); g.parts[0].events.filter(e => e.kind === 'note').forEach(e => o.set(key(g, e), e.heads.map(h => P.midi(h.pitch)).join(','))); return o; };
const differing = (src, arr) => { const out = []; src.forEach((v, k) => { if (arr.get(k) !== v) out.push(k + ' source ' + v + ' arranged ' + arr.get(k)); }); arr.forEach((v, k) => { if (!src.has(k)) out.push(k + ' extra ' + v); }); return out; };

async function select() {
  const g = await H.graphOf('catalog/method/hanon/010.mxl');
  const sg = SGG.analyze(g);
  const request = { targetLevel: 3, handProfile: 'large', sections: 'all' };
  let sel = CAND.run(g, sg, request, { singleNoteHands: true });
  if (!sel.ok) sel = CAND.run(g, sg, request, { singleNoteHands: true, relax: 2 });
  assert.ok(sel.ok);
  return { g, sg, request, sel };
}

test('hanon/010: the parallel octaves the source writes are not repaired; the arrangement differs from the source in one note (the last bar\'s left hand)', async () => {
  const { g, sg, request, sel } = await select();
  const src = notes(g);
  const off = REP.repairSelection(sel, g, sg, request, { sourceGuard: false, closeGaps: false });
  assert.equal(off.report.byOp.parallel.accepted, 10, 'without the guard: the ten left-hand notes of bars 15-24 are moved down an octave');
  const offDiff = differing(src, notes(off.graph));
  assert.equal(offDiff.length, 11, offDiff.join('; '));
  const on = REP.repairSelection(sel, g, sg, request, {});
  assert.equal(on.report.byOp.parallel, undefined, 'with the guard: no parallel move is planned');
  const d = differing(src, notes(on.graph));
  assert.deepEqual(d, ['2|29|0 source 36 arranged 48'], 'only the last bar\'s left hand differs: ' + d.join('; '));
});

test('hanon/010: the last bar\'s left hand moved because the realizer put the lower of two left-hand voices in the right hand; opts.orderedHands keeps the hands in order (off by default)', async () => {
  const { g, sg, sel } = await select();
  const base = { pattern: sel.selected.spec.pattern, noStride: true, diatonicLow: true, hymnThin: true, handChords: true, handMaxNotes: 1, handMaxNotesMaxStage: 4, handDropBass: true };
  const lastBar = r => {
    const gr = r.graph, last = gr.timeline.measures[gr.timeline.measures.length - 1].id;
    return gr.parts[0].events.filter(e => e.kind === 'note' && e.m === last).map(e => (gr.parts[0].staves.findIndex(s => s.id === e.staff) + 1) + ':' + e.heads.map(h => P.midi(h.pitch)).join(',')).sort();
  };
  const plain = REALIZE.realize(g, sg, sel.selected.plan, base);
  const ordered = REALIZE.realize(g, sg, sel.selected.plan, Object.assign({ orderedHands: true }, base));
  assert.ok(plain.ok && ordered.ok);
  assert.deepEqual(lastBar(plain), ['1:36', '2:48'], 'default: the right hand plays C2 under the left hand\'s C3');
  assert.deepEqual(lastBar(ordered), ['1:48', '2:36'], 'ordered: the source\'s hands (C3 right, C2 left)');
  /* nothing else differs: the same notes before the last bar */
  const a = notes(plain.graph), b = notes(ordered.graph);
  const d = differing(a, b);
  assert.equal(d.length, 2, d.join('; '));
  assert.ok(d.every(x => x.startsWith('1|29|0') || x.startsWith('2|29|0')));
});
