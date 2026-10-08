/* toMusicXml(input, { recording: 'v2' }) (G10a-1, docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6, 8 and 18): the time
   skeleton of rec/ under audio-score.js's own writer; issue 1 (the compound tempo) and TD20 (a pedal pressed at the end)
   fixed for v2 only; legacy unchanged. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, waltz, march, jig } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const ATT = require(path.join(REPO, 'rec', 'attacks.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const app = { title: 't', closeGaps: true, exactBars: true };
const soundTempo = xml => { const m = /<sound tempo="([0-9.]+)"/.exec(xml); return m ? +m[1] : null; };

test('rec/ cleans notes exactly as audio-score.js does (the training tool and toMusicXml see the same notes)', () => {
  const raw = [{ on: 1, off: 1.2, midi: 60, vel: 70 }, { on: 0.5, off: 0.51, midi: 64 }, { on: 2, off: 3, midi: 109, vel: 60 },
    { on: 2, off: 3, midi: 21, vel: 7 }, { on: -0.1, off: 0.3, midi: 50, vel: 90 }, { on: 1, off: 1.2, midi: 55, vel: 70 }];
  assert.deepEqual(ATT.cleanNotes(raw), AS._.clean(raw));
});

test('v2 writes the metre, tempo and bar lines of rec/: a waltz in 3/4 at its tempo, the first bar line at the first note', () => {
  const p = waltz(16, 120, { jitter: 0.01, seed: 4 });
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  assert.deepEqual([r.stats.beatsPerBar, r.stats.beatType], [3, 4]);
  assert.ok(Math.abs(r.stats.tempo - 120) <= 4, r.stats.tempo);
  assert.equal(r.stats.bars, 16);
  assert.ok(Math.abs(r.stats.barStarts[0] - 1) < 0.05);
  assert.equal(r.stats.beatSource, 'onset-v2');
  assert.ok(r.recReport && r.recReport.metre.key === '3/4' && r.recReport.model.name === 'ai5a');
  /* the graph says where its time skeleton came from */
  const src = r.graph.provenance.sources[0];
  assert.equal(src.params.recording.pipeline, 'v2');
  assert.equal(src.params.recording.skeleton.metre, '3/4');
  assert.equal(SG.validate(r.graph).issues.filter(i => i.severity === 'error').length, 0);
});

test('issue 1 fixed in v2: a 6/8 piece prints dotted quarter = bpm and plays 1.5 x bpm quarters (legacy kept as it was)', () => {
  const p = jig(16, 90, { seed: 6 });
  /* the model's own weights with the 6/8 bias raised, so that v2 surely reads 6/8 and the test checks the arithmetic */
  const W = JSON.parse(JSON.stringify(REC.loadWeights()));
  W.weights[W.features.indexOf('is6/8')] += 100;
  const r = AS.toMusicXml({ notes: p.notes }, Object.assign({ recWeights: W }, v2));
  assert.deepEqual([r.stats.beatsPerBar, r.stats.beatType], [6, 8]);
  const dotted = /<per-minute>([0-9.]+)<\/per-minute>/.exec(r.xml);
  assert.ok(dotted && /<beat-unit-dot\/>/.test(r.xml), 'a printed dotted-quarter mark');
  assert.ok(Math.abs(+dotted[1] - 60) <= 2, 'dotted quarter = ' + dotted[1]);
  assert.equal(soundTempo(r.xml), +dotted[1] * 1.5);
  assert.equal(r.stats.tempo, soundTempo(r.xml));
  assert.ok(!SG.validate(r.graph).issues.some(i => i.code === 'W-TEMPO-MARK-MISMATCH'));
  /* legacy, compound by its own reading or a lock, is untouched: it prints bpm and plays bpm (issue 1) */
  const lg = AS.toMusicXml({ notes: p.notes }, { title: 't', lock: { bpm: 60, beatsPerBar: 6, beatType: 8, firstDownbeat: 1 } });
  assert.equal(soundTempo(lg.xml), 60);
  assert.ok(SG.validate(lg.graph).issues.some(i => i.code === 'W-TEMPO-MARK-MISMATCH'));
});

test('TD20 fixed in v2: a pedal pressed in the score\'s last tick no longer throws E-SPAN-ORDER (legacy still does: TD20 stays a legacy defect)', () => {
  const notes = [];
  for (let i = 0; i < 16; i++) notes.push({ on: 1 + i * 0.5, off: 1 + i * 0.5 + 0.4, midi: 60 + (i % 5), vel: 70 });
  let legacyThrows = 0, v2Throws = 0, tried = 0;
  for (let k = 0; k < 400; k++) {
    const on = 8.51 + k * 0.005, off = on + 0.3 + (k % 7) * 0.1;
    const input = { notes: notes, pedals: [{ on: 1, off: 2 }, { on: on, off: off }] };
    tried++;
    try { AS.toMusicXml(input, { title: 't' }); } catch (e) { if (/E-SPAN-ORDER/.test(e.message)) legacyThrows++; else throw e; }
    try { AS.toMusicXml(input, { title: 't', recording: 'v2' }); } catch (e) { v2Throws++; }
  }
  assert.ok(legacyThrows > 0, 'the input reproduces TD20 on legacy');
  assert.equal(v2Throws, 0);
  assert.equal(tried, 400);
});

test('v2 writes an onset that lies on a beat on that beat (the legacy quantiser puts it one beat late; kept in legacy)', () => {
  const beats = [0, 0.5, 1, 1.5, 2];
  const n = { on: 0.5 - 1e-12, off: 0.9, midi: 60, vel: 64, attack: 0.5 - 1e-12 };
  assert.ok(AS._.beatPosition(beats, n.attack) < 1);
  assert.equal(AS._.quantize([n], beats, {}, true).q[0].tick, AS._.Q);           /* v2: on beat 1 */
  assert.equal(AS._.quantize([n], beats, {}, false).q[0].tick, 2 * AS._.Q);      /* legacy, unchanged: beat 2 */
});

test('without recording v2 (or with "legacy") toMusicXml is the legacy writer: the same bytes', () => {
  const p = march(8, 100, { jitter: 0.02, seed: 3 });
  const a = AS.toMusicXml({ notes: p.notes }, app), b = AS.toMusicXml({ notes: p.notes }, Object.assign({ recording: 'legacy' }, app));
  assert.equal(a.xml, b.xml);
  assert.equal(JSON.stringify(a.stats), JSON.stringify(b.stats));
  assert.equal(a.recReport, undefined);
  assert.equal(a.stats.beatSource, 'onset');
});

test('v2 does not decide what the caller fixed: a lock or a stated metre writes the legacy way', () => {
  const p = waltz(8, 100, { seed: 2 });
  const lock = { bpm: 100, beatsPerBar: 3, beatType: 4, firstDownbeat: 1 };
  assert.equal(AS.toMusicXml({ notes: p.notes }, Object.assign({ lock: lock }, v2)).xml, AS.toMusicXml({ notes: p.notes }, Object.assign({ lock: lock }, app)).xml);
  assert.equal(AS.toMusicXml({ notes: p.notes }, Object.assign({ beatsPerBar: 3 }, v2)).xml, AS.toMusicXml({ notes: p.notes }, Object.assign({ beatsPerBar: 3 }, app)).xml);
});

test('v2 with the helper\'s audio beats and downbeats reads them and keeps their bar lines (G10a-1d: the beat track is one more pulse track, no bonus)', () => {
  const p = march(16, 100, { jitter: 0.015, seed: 8 });
  const beats = [], downbeats = [];
  for (let k = 0; k <= 16 * 4; k++) { beats.push(1 + k * 0.6); if (k % 4 === 0) downbeats.push(1 + k * 0.6); }
  const r = AS.toMusicXml({ notes: p.notes, beats: beats, downbeats: downbeats }, v2);
  assert.ok(['audio-v2', 'onset-v2'].indexOf(r.stats.beatSource) >= 0, r.stats.beatSource);
  assert.deepEqual([r.stats.beatsPerBar, r.stats.beatType], [4, 4]);
  assert.ok(Math.abs(r.stats.barStarts[0] - 1) < 0.05);
});

test('a page that has no weights (no rec/ or a broken weights file) writes the legacy way, never throws', () => {
  const p = march(8, 100, { seed: 9 });
  const r = AS.toMusicXml({ notes: p.notes }, Object.assign({ recWeights: { schema: 'not-the-model' } }, v2));
  assert.equal(r.xml, AS.toMusicXml({ notes: p.notes }, app).xml);
});
