/* toMusicXml with the pedal policy (G10a-3, S9): recording 'v2' writes the marks the heard notes agree with and keeps every heard span in the
   performance layer; opts.pedal 'legacy' writes every span under v2; opts.pedal 'v2' swaps only S9 on any path; a compound skeleton's marks land
   on their bars; the edge cases of a pedal (after the last note, zero-length, overlapping, before the first note, no release, not a number) never
   throw and never write a span the validator refuses (TD20 and its family). docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8 and 23. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, jig } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const app = { title: 't', closeGaps: true, exactBars: true };
const errors = r => SG.validate(r.graph).issues.filter(i => i.severity === 'error');
const pedalMarks = r => (r.xml.match(/<pedal type="(start|stop|change)"/g) || []).length;
const pedalSpanners = r => r.graph.parts[0].spanners.filter(s => s.type === 'pedal');

/* 4/4 at 120 quarters a minute from 1 s: per bar a bass half note, a chord on beat 3 and a melody of four quarters; `sustain` makes every note struck in
   a pedal ring to the pedal's end (the pedal's mechanism), otherwise every note is released 0.45 s after its onset */
function piece(bars, sustain) {
  const notes = [], pedals = [];
  for (let b = 0; b < bars; b++) {
    const t0 = 1 + b * 2, up = t0 + 1.98;
    if (sustain) pedals.push({ on: t0 + 0.05, off: up });
    const end = (on, len) => (sustain && on >= t0 + 0.05 ? up : on + len);
    notes.push({ on: t0, off: end(t0, 0.9), midi: 48, vel: 80 });
    notes.push({ on: t0 + 1, off: end(t0 + 1, 0.45), midi: 55, vel: 70 });
    [64, 67, 72, 67].forEach((m, k) => notes.push({ on: t0 + k * 0.5, off: end(t0 + k * 0.5, 0.45), midi: m, vel: 70 }));
  }
  return { notes: notes.sort((a, b) => a.on - b.on || a.midi - b.midi), pedals: pedals };
}

test('v2 writes the pedal marks the notes agree with, every bar, and says so in the graph\'s provenance', () => {
  const p = piece(16, true);
  const r = AS.toMusicXml({ notes: p.notes, pedals: p.pedals }, v2);
  assert.equal(errors(r).length, 0);
  assert.ok(r.pedalReport && r.pedalReport.report.heard === 16 && r.pedalReport.report.kept === 16);
  assert.equal(r.graph.provenance.sources[0].params.pedal.kept, 16);
  assert.ok(pedalSpanners(r).length >= 1);
  assert.ok(pedalMarks(r) >= 16, 'at least a start or a change per bar: ' + pedalMarks(r));
  const perf = r.graph.performances[0];
  assert.equal(perf.pedals.length, 16, 'the performance layer has every heard span');
});

test('a pedal no note agrees with is not written, but the performance layer keeps it (the invented pedal of the helper)', () => {
  const free = piece(16, false);
  const invented = Array.from({ length: 14 }, (_, b) => ({ on: 1.55 + b * 2, off: 2.2 + b * 2 }));
  const r = AS.toMusicXml({ notes: free.notes, pedals: invented }, v2);
  assert.equal(errors(r).length, 0);
  assert.equal(pedalMarks(r), 0);
  assert.equal(r.pedalReport.report.kept, 0);
  assert.equal(r.pedalReport.report.dropped.weak, 14);
  assert.equal(r.graph.performances[0].pedals.length, 14, 'the heard pedal always stays in the performance layer');
  /* the before arm and the browser model (no pedals at all) */
  const all = AS.toMusicXml({ notes: free.notes, pedals: invented }, Object.assign({ pedal: 'legacy' }, v2));
  assert.ok(pedalMarks(all) >= 14, 'opts.pedal legacy writes every heard span');
  assert.equal(pedalMarks(AS.toMusicXml({ notes: free.notes }, v2)), 0, 'no pedals, no marks');
});

test('the library default and the app\'s options never see the policy; opts.pedal v2 swaps only S9 on the app\'s path; a MIDI file\'s controllers are exact', () => {
  const free = piece(16, false);
  const invented = Array.from({ length: 14 }, (_, b) => ({ on: 1.55 + b * 2, off: 2.2 + b * 2 }));
  const input = { notes: free.notes, pedals: invented };
  const lib = AS.toMusicXml(input, { title: 't' }), a = AS.toMusicXml(input, app);
  assert.equal(lib.pedalReport, undefined);
  assert.equal(a.pedalReport, undefined);
  assert.ok(pedalMarks(a) >= 14);
  assert.equal(AS.toMusicXml(input, Object.assign({ pedal: 'legacy' }, app)).xml, a.xml, 'pedal legacy is the default off v2');
  const k = AS.toMusicXml(input, Object.assign({ pedal: 'v2' }, app));
  assert.ok(k.pedalReport);
  assert.equal(pedalMarks(k), 0);
  assert.equal(errors(k).length, 0);
  /* a MIDI file's pedal is the player's own: the policy never judges it (sourceKind midi-file) */
  const midi = AS.toMusicXml(input, Object.assign({ pedal: 'v2', sourceKind: 'midi-file' }, app));
  assert.equal(midi.pedalReport, undefined);
});

test('a compound skeleton\'s marks land on their bars (the v2 tick unit: a beat is a dotted quarter, 36 ticks)', () => {
  /* 6/8 as the catalogue writes it, 90 dotted quarters a minute from 1 s: 2 s a bar; the pedal goes down a hair after each bar line and comes
     up a hair before the next; every note struck in it rings to the pedal's end */
  const p = jig(20, 90, { seed: 6 });
  const bars = p.notes.reduce((m, n) => Math.max(m, n.on), 0) / 2;
  const t0 = Math.min.apply(null, p.notes.map(n => n.on));
  const pedals = [];
  for (let b = 1; b < Math.floor(bars); b++) pedals.push({ on: t0 + b * 2 + 0.05, off: t0 + (b + 1) * 2 - 0.02 });
  const notes = p.notes.map(n => {
    const b = Math.floor((n.on - t0) / 2), up = t0 + (b + 1) * 2 - 0.02;
    return b >= 1 ? Object.assign({}, n, { off: Math.max(n.off, up) }) : n;
  });
  const W = JSON.parse(JSON.stringify(REC.loadWeights()));
  W.weights[W.features.indexOf('is6/8')] += 100;
  const r = AS.toMusicXml({ notes: notes, pedals: pedals }, Object.assign({ recWeights: W }, v2));
  assert.deepEqual([r.stats.beatsPerBar, r.stats.beatType], [6, 8]);
  assert.equal(errors(r).length, 0);
  assert.ok(r.pedalReport.report.kept >= pedals.length - 1, 'the spans are confirmed: ' + JSON.stringify(r.pedalReport.report));
  /* the first mark of each span is a start or change at the bar line: one per measure, the same measure as the span's bar */
  const g = r.graph;
  const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const starts = pedalSpanners(r).map(s => mIdx.get(s.from.m));
  assert.ok(starts.length >= 1);
  const perMeasure = new Map();
  pedalSpanners(r).forEach(s => {
    [s.from].concat(s.changes || []).forEach(x => perMeasure.set(mIdx.get(x.m), (perMeasure.get(mIdx.get(x.m)) || 0) + 1));
  });
  perMeasure.forEach((n, m) => assert.ok(n <= 1, 'measure ' + m + ' holds ' + n + ' starts: the marks drift when the unit is wrong'));
  assert.ok(perMeasure.size >= pedals.length - 2, 'a mark in nearly every bar: ' + perMeasure.size + ' of ' + pedals.length);
  /* with the v2 tick unit the whole span ends in the bar it was heard in: the last mark is in the last bars */
  const lastMeasure = Math.max.apply(null, pedalSpanners(r).map(s => mIdx.get((s.to || s.from).m)));
  assert.ok(lastMeasure >= g.timeline.measures.length - 3, 'the last mark is in measure ' + lastMeasure + ' of ' + g.timeline.measures.length);
});

test('a pedal\'s edge cases never throw and never reach the graph as a span the validator refuses', () => {
  const p = piece(16, true);
  const last = Math.max.apply(null, p.notes.map(n => n.off));
  const first = Math.min.apply(null, p.notes.map(n => n.on));
  const cases = {
    'after the last note': [{ on: last + 1, off: last + 3 }],
    'pressed in the last tick, never released': [{ on: last - 0.01, off: Infinity }],
    'zero length': [{ on: 5, off: 5 }, { on: 7, off: 7.0001 }],
    'overlapping': [{ on: 3, off: 6 }, { on: 5, off: 9 }, { on: 8.5, off: 9.5 }],
    'before the first note': [{ on: 0.1, off: first - 0.05 }, { on: 0.2, off: first + 1.5 }],
    'not numbers': [{ on: NaN, off: 4 }, { on: 4, off: NaN }, { on: 'a', off: 'b' }],
    'a press with no release': [{ on: 3, off: Infinity }],
    'a long one over the whole piece': [{ on: 0, off: last + 5 }]
  };
  Object.keys(cases).forEach(name => {
    [v2, Object.assign({ pedal: 'legacy' }, v2), Object.assign({ pedal: 'v2' }, app)].forEach((opts, k) => {
      /* legacy keeps TD20 and the overlap defect (G10 section 17): only the v2 arms are asked never to throw on them */
      if (k === 1 && (name === 'pressed in the last tick, never released' || name === 'overlapping')) return;
      let r;
      assert.doesNotThrow(() => { r = AS.toMusicXml({ notes: p.notes, pedals: cases[name] }, opts); }, name + ' / arm ' + k);
      assert.equal(errors(r).length, 0, name + ' / arm ' + k);
    });
  });
  /* overlapping spans are one pedal: the policy merges them into one that the writer can place */
  const o = AS.toMusicXml({ notes: p.notes, pedals: cases.overlapping }, v2);
  assert.equal(o.pedalReport.report.merged, 2);
});
