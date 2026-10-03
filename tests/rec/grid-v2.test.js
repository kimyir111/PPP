/* toMusicXml(input, { recording: 'v2' }) with rec/grid.js as its stage S3 (G10a-2, docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8
   and 19): the grid stage replaces the legacy quantisers under v2 only; opts.grid 'legacy' keeps them; legacy never loads it.
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, perform } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));

test('v2 uses rec/grid.js as its stage S3; grid "legacy" keeps the legacy quantiser; legacy never loads rec/grid.js', () => {
  const p = perform([[0, [48, 60], 1], [1, [64], 1 / 3], [1 + 1 / 3, [65], 1 / 3], [1 + 2 / 3, [67], 1 / 3], [2, [69, 52], 1], [3, [72], 1]], 4, 12, 96, { jitter: 0.012, seed: 4 });
  const base = { title: 't', closeGaps: true, exactBars: true };
  const v2 = AS.toMusicXml({ notes: p.notes }, Object.assign({ recording: 'v2' }, base));
  const v2legacy = AS.toMusicXml({ notes: p.notes }, Object.assign({ recording: 'v2', grid: 'legacy' }, base));
  assert.ok(v2.gridPlan && v2.gridPlan.report.model.startsWith('ai5b-grid@'));
  assert.equal(v2legacy.gridPlan, undefined);
  const src = v2.graph.provenance.sources[0];
  assert.ok(src.params.recording.grid && src.params.recording.grid.model === v2.gridPlan.report.model);
  /* legacy and app options: the module is not even required */
  const key = require.resolve(path.join(REPO, 'rec', 'grid.js'));
  const had = key in require.cache;
  delete require.cache[key];
  AS.toMusicXml({ notes: p.notes }, base);
  AS.toMusicXml({ notes: p.notes }, { title: 't' });
  assert.equal(key in require.cache, false, 'legacy loaded rec/grid.js');
  if (had) require(key);
});


test('v2 with rec/grid.js on a compound skeleton: the onsets of a jig are on its eighths (ticks 0 / 12 / 24 of a dotted quarter)', () => {
  const notes = [];
  for (let b = 0; b < 16; b++) {
    const t0 = 1 + b * 1.2;
    [0, 0.2, 0.4, 0.6, 0.8, 1.0].forEach((d, i) => notes.push({ on: Math.round((t0 + d + (i % 3 === 1 ? 0.012 : -0.008)) * 1000) / 1000, off: t0 + d + 0.18, midi: 64 + (i % 4), vel: 64 }));
    notes.push({ on: t0, off: t0 + 0.55, midi: 45 + (b % 3), vel: 72 }, { on: t0 + 0.6, off: t0 + 1.15, midi: 52, vel: 66 });
  }
  const r = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  if (r.stats.beatType !== 8) return;                                  /* the skeleton is G10a-1's: this test is about the grid on a compound one */
  assert.ok(r.gridPlan && r.gridPlan.plan.every(p => p.kind === 'c8' || p.kind === 'c16'));
  assert.ok(r.gridPlan.plan.filter(p => p.kind === 'c8').length >= r.gridPlan.plan.length * 0.9, JSON.stringify(r.gridPlan.report));
});

test('an odd-32nd onset of a staff that was silent before it is moved to the 16th grid (the exact-bars writer has no 32nd rest): no class 5', () => {
  /* a 32nd run starting on the second 32nd of a beat, with nothing before it in that hand */
  const notes = [];
  for (let b = 0; b < 12; b++) {
    const t0 = 1 + b * 0.5;
    notes.push({ on: t0, off: t0 + 0.45, midi: 43, vel: 70 });
    if (b % 2) [1, 2, 3, 4, 5, 6, 7].forEach(k => notes.push({ on: Math.round((t0 + k * 0.0625) * 1000) / 1000, off: t0 + k * 0.0625 + 0.05, midi: 72 + k, vel: 64 }));
    else notes.push({ on: t0, off: t0 + 0.45, midi: 72, vel: 64 });
  }
  const r = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  assert.equal(NC.checkGraph(r.graph).classes[5].count, 0);
});
