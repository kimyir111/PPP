/* G10c-0: the interim melody guard (candidates/index.js guardMelody, docs/GOALS/G10 section 9 and 19).

   A recording's hand split puts a melody note in the LEFT staff where the melody dips toward the split, and the melody voice has a hole. The guard looks across both staves, and moves the
   lower staff's top note into the melody voice when it continues the melody on both sides, before the arranger plans; gated to a transcription arranged one note per hand.

   What this checks: the move itself (the heard note is in the melody voice, the hole is closed, nothing else of the notes changes, the graph validates, the pass is idempotent); the gate (a
   printed score, a part that is not two staves, `melodyGuard: false`: untouched, the very same graph); a note that does not continue the line is left where it was; the arrangement of the
   guarded source has the melody note in the right hand and no hard violation, and an unguarded run does not; the selection names the source repairSelection reads. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../realize/app-single-extract.js');
const REPO = E.REPO;
const R = p => require(path.join(REPO, p));
const SG = R('scoregraph/index.js');
const RAT = R('scoregraph/rational.js');
const PITCH = R('scoregraph/pitch.js');
const SGG = R('songgraph/index.js');
const CAND = R('candidates/index.js');
const GAPS = R('scoregraph/gaps.js');
const AUDIO = R('audio-score.js');
const UTIL = R('songgraph/util.js');
const MET = R('critics/metrics.js');
const NC = R('scoregraph/tools/notation-check.js');

const ref = E.reference();
MET.setWeights(ref.weights);

/* 12 bars of 4/4 at 120 bpm: a stepwise melody that dips under C4 in bar 4 (the hand split puts its G3, on beat 2, in the left hand), a bass on beats 1 and 3, an inner note on beat 2 */
function recording() {
  const mel = [67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 57, 59, 60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 59, 57, 59, 60, 62, 64, 62, 60, 62, 64, 65, 67, 72, 71, 69, 67, 65, 64, 62, 60, 64];
  const notes = [], beat = 0.5, t0 = 1.0;
  mel.forEach((p, i) => notes.push({ on: t0 + i * beat, off: t0 + i * beat + 0.45, midi: p, vel: 80 }));
  for (let b = 0; b < 12; b++) {
    [36, 43].forEach((p, k) => notes.push({ on: t0 + (b * 4 + k * 2) * beat, off: t0 + (b * 4 + k * 2) * beat + 0.95, midi: p, vel: 60 }));
    notes.push({ on: t0 + (b * 4 + 1) * beat + 0.01, off: t0 + (b * 4 + 1) * beat + 0.4, midi: 52 + (b % 2) * 3, vel: 55 });
  }
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  return AUDIO.toMusicXml({ notes: notes, pedals: [], beats: [], downbeats: [] }, { title: 'synth', closeGaps: true, exactBars: true }).graph;
}
const G = recording();
const SGRAPH = SGG.analyze(G);

/* [{m: measure number (1-based), at, midi, staff: 0 upper | 1 lower, voice}] of every head */
function heads(g) {
  const si = new Map(); g.parts[0].staves.forEach((s, i) => si.set(s.id, i));
  const num = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
  const out = [];
  g.parts[0].events.forEach(e => { if (e.kind === 'note') e.heads.forEach(h => out.push({ id: h.id, m: num.get(e.m), at: e.at, midi: PITCH.midi(h.pitch), staff: si.get(e.staff), voice: e.voice, dur: e.dur })); });
  return out;
}
const at = (list, m, a, midi) => list.filter(h => h.m === m && h.at === a && h.midi === midi);
const errors = g => SG.validate(g).issues.filter(i => i.severity === 'ERROR');

test('the setup: the hand split gave the melody\'s G3 of bar 4 to the lower staff, and the melody voice has a rest there', () => {
  const h = heads(G);
  assert.equal(at(h, 4, '1/4', 55).length, 1);
  assert.equal(at(h, 4, '1/4', 55)[0].staff, 1);
  const mv = SGRAPH.melodyBass.parts[0].melodyVoice;
  const rest = G.parts[0].events.filter(e => e.kind === 'rest' && e.voice === mv && e.m === G.timeline.measures[3].id && e.at === '1/4');
  assert.equal(rest.length, 1, 'a rest in the melody voice where the melody note was heard');
});

test('the guard moves that note into the melody voice: same head, same pitch, same onset; the rest is gone; every other head stays where it was', () => {
  const r = CAND.guardMelody(G, SGRAPH);
  assert.equal(r.changed, true);
  assert.equal(r.stats.moved, 1);
  assert.deepEqual(errors(r.graph), [], 'the graph validates');
  const before = heads(G), after = heads(r.graph);
  assert.equal(after.length, before.length, 'no head is added or lost');
  const moved = after.filter(h => { const b = before.find(x => x.id === h.id); return b.staff !== h.staff; });
  assert.deepEqual(moved.map(h => [h.m, h.at, h.midi, h.staff]), [[4, '1/4', 55, 0]], 'exactly the one note moved, to the upper staff');
  after.forEach(h => { const b = before.find(x => x.id === h.id); assert.equal(h.midi, b.midi); assert.equal(h.at, b.at); assert.equal(h.m, b.m); });
  const mv = SGRAPH.melodyBass.parts[0].melodyVoice;
  assert.equal(after.find(h => h.id === moved[0].id).voice, mv, 'in the melody voice');
  const m10 = r.graph.timeline.measures[3].id;
  assert.equal(r.graph.parts[0].events.filter(e => e.kind === 'rest' && e.voice === mv && e.m === m10 && e.at === '1/4').length, 0, 'the hole is closed');
  assert.deepEqual(r.graph.performances, G.performances, 'the performance layer is untouched');
  const rep = NC.checkGraph(r.graph), base = NC.checkGraph(G);
  for (let c = 1; c <= 7; c++) assert.ok(rep.classes[c].count <= base.classes[c].count, 'checker class ' + c + ' does not rise');
});

test('idempotent: the guarded source needs nothing more', () => {
  const once = CAND.guardMelody(G, SGRAPH);
  const twice = CAND.guardMelody(once.graph, SGG.analyze(once.graph));
  assert.equal(twice.changed, false);
  assert.equal(twice.graph, once.graph);
});

test('gated: a printed score, and a graph with no transcription provenance, come back as the very same graph', () => {
  const xml = fs.readFileSync(path.join(REPO, 'catalog/gymnopedie-1.musicxml'), 'utf8');
  const imp = SG.musicxml.import(xml, { scoreId: 'p' });
  const printed = imp.graph || imp;
  const r = CAND.guardMelody(printed, SGG.analyze(printed));
  assert.equal(r.changed, false);
  assert.equal(r.graph, printed);
  assert.match(r.stats.skipped, /not a transcription/);
  assert.equal(GAPS.isTranscription(printed), false);
  assert.equal(GAPS.isTranscription(G), true);
  /* the same recording with its provenance taken away is not touched */
  const plain = JSON.parse(JSON.stringify(G));
  plain.provenance.sources = plain.provenance.sources.filter(s => s.kind !== 'audio-score');
  assert.equal(CAND.guardMelody(plain, SGRAPH).changed, false);
});

test('a lower-staff note that does not continue the melody is left where it was (a leap of more than a fifth)', () => {
  /* the same recording with the melody note of bar 4 raised an octave: no longer a neighbour of 57 and 57 */
  const g = JSON.parse(JSON.stringify(G));
  g.parts[0].events.forEach(e => { if (e.kind === 'note' && e.m === g.timeline.measures[3].id && e.at === '1/4') e.heads.forEach(h => { h.pitch = Object.assign({}, h.pitch, { oct: h.pitch.oct + 1 }); }); });
  const r = CAND.guardMelody(g, SGRAPH);
  assert.equal(r.changed, false);
});

test('run(): the selection names the guarded source; `melodyGuard: false` is the rollback', () => {
  const request = { targetLevel: 2.5, handProfile: 'large', sections: 'all' };
  const opts = { singleNoteHands: true, skipEngrave: true, reference: ref };
  const on = CAND.run(G, SGRAPH, request, opts), off = CAND.run(G, SGRAPH, request, Object.assign({ melodyGuard: false }, opts));
  assert.equal(on.ok, true);
  assert.equal(off.ok, true);
  assert.equal(on.melodyGuard.moved, 1);
  assert.ok(on.source && on.source !== G);
  assert.equal(off.source, undefined);
  assert.equal(off.melodyGuard, undefined);
  /* without singleNoteHands (the legacy candidate path) the guard is not run at all */
  const plain = CAND.run(G, SGRAPH, request, { skipEngrave: true, reference: ref });
  assert.equal(plain.melodyGuard, undefined);
});

test('the app\'s arrangement of the guarded source has the melody note in the right hand at the three levels, with no hard violation; an unguarded run drops it', async () => {
  const mk = guard => {
    const w = E.nodeWindow(), C = w.PPPCandidates;
    w.PPPCandidates = Object.assign({}, C, { runAsync: (g, sg, rq, o) => C.runAsync(g, sg, rq, guard ? o : Object.assign({}, o, { melodyGuard: false })) });
    return E.make({ window: w, loadArrangerReference: () => Promise.resolve(ref) });
  };
  const PLA = R('playability/index.js');
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    const on = await mk(true).arrangeSingleNote(G, { level }), off = await mk(false).arrangeSingleNote(G, { level });
    assert.equal(on.ok, true, level + ' ' + on.reason);
    assert.equal(off.ok, true, level + ' ' + off.reason);
    const inRight = r => heads(r.graph).filter(h => h.m === 4 && h.midi === 55 && h.staff === 0 && h.at === '1/4').length;
    assert.equal(inRight(on), 1, level + ': the melody note is in the right hand');
    assert.equal(inRight(off), 0, level + ': without the guard it is not');
    assert.equal(PLA.analyzeGraph(on.graph, { profile: on.report.request.handProfile }).totals.hard, 0, level + ': no hard violation');
    assert.deepEqual(errors(on.graph), []);
  }
});

test('the real piece (the stored graph of the teacher-like transcription, 90 bars): the guard moves a few notes, the graph validates, no head is added or lost, and every moved head keeps its pitch and onset', () => {
  const real = SG.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.graph.json'), 'utf8'));
  const r = CAND.guardMelody(real, SGG.analyze(real));
  assert.equal(r.changed, true);
  assert.ok(r.stats.moved >= 1 && r.stats.moved <= 30, 'a few notes, not the accompaniment: ' + r.stats.moved);
  assert.deepEqual(errors(r.graph), []);
  const b = heads(real), a = heads(r.graph);
  assert.equal(a.length, b.length);
  const byId = new Map(b.map(h => [h.id, h]));
  a.forEach(h => { const x = byId.get(h.id); assert.equal(h.midi, x.midi); assert.equal(h.m, x.m); assert.equal(h.at, x.at); });
  const moved = a.filter(h => byId.get(h.id).staff !== h.staff);
  assert.equal(moved.length, r.stats.moved);
  assert.ok(moved.every(h => h.staff === 0 && byId.get(h.id).staff === 1), 'only lower to upper');
});

test('in the page (a bare vm context with the page\'s own scripts: no require, no module) the guard is there and moves the same note', () => {
  const w = E.browserWindow();
  assert.equal(typeof w.PPPCandidates.guardMelody, 'function');
  const r = w.PPPCandidates.guardMelody(G, SGRAPH);
  assert.equal(r.changed, true);
  assert.equal(r.stats.moved, 1);
  assert.equal(SG.fingerprint(r.graph), SG.fingerprint(CAND.guardMelody(G, SGRAPH).graph), 'the same graph as in Node');
});
