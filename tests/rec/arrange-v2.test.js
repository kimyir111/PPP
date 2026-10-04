/* scoregraph/rec-tuplet.js with opts.v2 and the arrangement of a v2 recording (G10a-3, docs/GOALS/G10_AUDIO_TO_SCORE.md section 22.3):
   the recording conversion v2 writes triplet 16ths as one 3:2 bracket of 16ths per half beat; an arrangement copies the events without
   tuplets and repair/index.js brackets them again with addTriplets - with { v2: true } only when the source is a v2 recording.
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const AS = require(path.join(REPO, 'audio-score.js'));
const RT = require(path.join(REPO, 'scoregraph', 'rec-tuplet.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));
const E = require(path.join(REPO, 'tests', 'realize', 'app-single-extract.js'));
const MET = require(path.join(REPO, 'critics', 'metrics.js'));

/* a 4/4 performance: bass and a chord on every beat, the right hand in triplet 16ths on beats 2 and 4 */
function sixths() {
  const notes = [], spb = 0.6;
  for (let bar = 0; bar < 16; bar++) for (let k = 0; k < 4; k++) {
    const t0 = 1 + (bar * 4 + k) * spb, acc = k === 0;
    notes.push({ on: t0, off: t0 + spb * 0.95, midi: (k === 0 ? 36 : 43) + (bar % 3), vel: acc ? 84 : 62 }, { on: t0, off: t0 + spb * 0.9, midi: 52 + (bar % 3), vel: acc ? 80 : 60 });
    if (k % 2) for (let s = 0; s < 6; s++) notes.push({ on: Math.round((t0 + s * spb / 6) * 1000) / 1000, off: t0 + (s + 1) * spb / 6, midi: 72 + ((s * 2 + bar) % 7), vel: 60 });
    else notes.push({ on: t0, off: t0 + spb * 0.9, midi: 76 + (bar % 4), vel: acc ? 82 : 62 });
  }
  return notes;
}
const halves = g => g.parts[0].spanners.filter(s => s.type === 'tuplet' && s.unit && s.unit.type === '16th').length;
/* the graph without its tuplets (what an arrangement's copy of the events looks like) */
function stripped(g) {
  const x = JSON.parse(JSON.stringify(g));
  x.parts.forEach(p => { p.spanners = p.spanners.filter(s => s.type !== 'tuplet'); });
  return x;
}

test('a v2 recording is one (isV2Recording); its writer brackets triplet 16ths per half beat; the checker accepts them', () => {
  const r = AS.toMusicXml({ notes: sixths() }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  assert.equal(RT.isV2Recording(r.graph), true);
  assert.ok(halves(r.graph) >= 30, 'half-beat brackets: ' + halves(r.graph));
  assert.equal(NC.checkGraph(r.graph).total, 0);
  const app = AS.toMusicXml({ notes: sixths() }, { title: 't', closeGaps: true, exactBars: true });
  assert.equal(RT.isV2Recording(app.graph), false);
});

test('addTriplets brackets triplet-16th half beats again only with { v2: true }; without it, exactly as before', () => {
  const r = AS.toMusicXml({ notes: sixths() }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  const bare = stripped(r.graph);
  const plain = RT.addTriplets(bare);
  assert.equal(halves(plain.graph), 0);
  const v2 = RT.addTriplets(bare, { v2: true });
  assert.equal(halves(v2.graph), halves(r.graph));
  assert.equal(NC.checkGraph(v2.graph).total, 0);
  /* idempotent */
  assert.equal(RT.addTriplets(v2.graph, { v2: true }).changed, false);
});

test('the arrangement of a v2 recording keeps its triplet-16th brackets (repair/index.js passes { v2: true })', async () => {
  const ref = E.reference();
  MET.setWeights(ref.weights);
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });
  const r = AS.toMusicXml({ notes: sixths() }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  const res = await app.arrangeSingleNote(r.graph, { level: 'intermediate' });
  assert.equal(res.ok, true);
  assert.ok(halves(res.graph) > 0, 'the arrangement has no half-beat bracket');
  const rep = NC.checkGraph(res.graph);
  assert.equal(rep.classes[6].count + rep.classes[7].count, 0, NC.summarize(rep));
});
