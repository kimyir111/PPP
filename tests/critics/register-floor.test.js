/* Critics - notes below the register floor (critics/register-floor.js; G9 post-H-8). Counts ARRANGED notes below E2 (MIDI 40);
   a note the source piece has is never a defect. Report only: weight 0 in candidate selection. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const RF = require(path.join(REPO, 'critics/register-floor.js'));
const CRIT = require(path.join(REPO, 'critics/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const REPAIR = require(path.join(REPO, 'repair/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

/* RH melody C5 D5 E5 F5; LH bass E1 (28), C2 (36), G2 (43), C3 (48) */
const g = () => mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'E1:q C2:q G2:q C3:q' });

test('registerFloor: counts the arranged notes below E2, not the ones at or above it', () => {
  const graph = g();
  const melody = M.graphNoteList(graph).filter(n => n.midi >= 60); /* the source: the melody only */
  const r = RF.registerFloor(graph, { sourceNotes: melody });
  assert.equal(r.floor, 40);
  assert.equal(r.total, 8);
  assert.equal(r.arranged, 4);
  assert.equal(r.below, 2, 'E1 (28) and C2 (36); G2 (43) is above E2');
  assert.equal(r.belowSource, 0);
  assert.equal(r.lowest, 28);
  assert.equal(r.lowestArranged, 28);
  assert.equal(r.sourceKnown, true);
});

test('registerFloor: a note the source has is source, not arranged - reported, never a defect', () => {
  const graph = g();
  const all = M.graphNoteList(graph); /* the source has every one of these notes */
  const r = RF.registerFloor(graph, { sourceNotes: all });
  assert.equal(r.below, 0);
  assert.equal(r.belowSource, 2);
  assert.equal(r.arranged, 0);
  /* same pitch at a DIFFERENT onset is not the source's note */
  const shifted = all.map(n => Object.assign({}, n, { onsetQ: n.onsetQ + 1 }));
  assert.equal(RF.registerFloor(graph, { sourceNotes: shifted }).below, 2);
  /* same onset, different pitch is not either */
  const other = all.map(n => Object.assign({}, n, { midi: n.midi + 1 }));
  assert.equal(RF.registerFloor(graph, { sourceNotes: other }).below, 2);
});

test('registerFloor: without sourceNotes every note counts as arranged and sourceKnown says so', () => {
  const r = RF.registerFloor(g(), {});
  assert.equal(r.sourceKnown, false);
  assert.equal(r.below, 2);
  assert.equal(r.belowSource, 0);
});

test('registerFloor: the floor is an option; a graph with no low note reads 0; an empty graph does not throw', () => {
  const graph = g();
  assert.equal(RF.registerFloor(graph, { sourceNotes: [], floor: 30 }).below, 1, 'only E1 is below 30');
  assert.equal(RF.registerFloor(graph, { sourceNotes: [], floor: 20 }).below, 0);
  assert.equal(RF.registerFloor(graph, { sourceNotes: [], floor: 60 }).below, 4, 'all four bass notes, not the melody at 72+');
  const empty = { timeline: { measures: [] }, parts: [] };
  const r = RF.registerFloor(empty, { sourceNotes: [] });
  assert.equal(r.total, 0);
  assert.equal(r.below, 0);
  assert.equal(r.lowest, null);
});

test('registerFloor: deterministic - the same graph and source give the same result, call after call', () => {
  const graph = g(), src = M.graphNoteList(graph).slice(0, 3);
  assert.equal(JSON.stringify(RF.registerFloor(graph, { sourceNotes: src })), JSON.stringify(RF.registerFloor(graph, { sourceNotes: src })));
});

test('evaluate: the critic set carries registerFloor, fed by ctx.sourceNotes / ctx.registerFloor', () => {
  assert.ok(CRIT.NAMES.includes('registerFloor'));
  const graph = g();
  const ev = CRIT.evaluate(graph, { profile: 'large', skipEngrave: true, sourceNotes: M.graphNoteList(graph).filter(n => n.midi >= 60) });
  assert.equal(ev.critics.registerFloor.below, 2);
  assert.equal(ev.critics.registerFloorError, undefined);
  assert.equal(CRIT.evaluate(graph, { profile: 'large', skipEngrave: true, sourceNotes: [], registerFloor: 30 }).critics.registerFloor.below, 1);
});

test('selection: registerFloor is report-only - weight 0, so it cannot change a badness total or a winner', () => {
  assert.equal(CAND.DEFAULT_WEIGHTS.registerFloor, 0);
  const base = { level: 3, melody: 1, harmony: { rootQuality: 0.9, rootOnly: 0.95 }, engrave: { silent: 0, hardLayout: 0 }, voiceLeading: { count: 0 }, registerDensity: { overage: 0 } };
  const clean = CAND.badnessOf(Object.assign({}, base, { registerFloor: { below: 0 } }), 3);
  const dirty = CAND.badnessOf(Object.assign({}, base, { registerFloor: { below: 50 } }), 3);
  const missing = CAND.badnessOf(base, 3);
  assert.equal(clean.total, dirty.total);
  assert.equal(clean.total, missing.total);
  assert.equal(dirty.parts.registerFloor, 1, 'the badness is still computed and visible per part');
  /* and weight 1 (the opt-in `--weights registerFloor=1`) does count it */
  assert.ok(CAND.badnessOf(Object.assign({}, base, { registerFloor: { below: 5 } }), 3, { registerFloor: 1 }).total > clean.total);
});

/* the H-8 pieces through the real pipeline: candidates.run then repair.repairSelection */
test('pipeline: G9a + G9b on the worst H-8 pieces leave 0 arranged notes below E2; the floor is what does it', async () => {
  const cases = [
    { file: 'catalog/method/sonatina/025.mxl', targetLevel: 3.4 },
    { file: 'catalog/hymns/pass-me-not.musicxml', targetLevel: 3.87 }
  ];
  for (const c of cases) {
    const graph = await H.graphOf(c.file), sg = SGG.analyze(graph);
    const src = M.graphNoteList(graph);
    const request = { targetLevel: c.targetLevel, handProfile: 'large', sections: 'all' };
    const sel = CAND.run(graph, sg, request, {});
    assert.ok(sel.ok, c.file);
    assert.equal(sel.selected.scores.registerFloor.below, 0, c.file + ': the scored candidate');
    assert.equal(sel.selected.scores.registerFloor.sourceKnown, true, 'candidates feed the source notes to the critic');
    const rr = REPAIR.repairSelection(sel, graph, sg, request);
    assert.ok(rr.ok);
    assert.equal(RF.registerFloor(rr.graph, { sourceNotes: src }).below, 0, c.file + ': after repair');
    /* with the floor off the same request DOES put arranged notes low (so the assertion above is not vacuous) */
    const off = CAND.run(graph, sg, request, { registerFloor: null });
    assert.ok(off.ok);
    assert.ok(RF.registerFloor(off.selected.graph, { sourceNotes: src }).below > 0, c.file + ': fixture assumption, the pre-floor pipeline is low here');
  }
});
