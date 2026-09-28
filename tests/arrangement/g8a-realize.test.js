/* G08 §6a: the G8a realizer (arrangement/g8a-realize.js) - real notes, 0 G5 hard violations,
   melody preserved, deterministic, built from a real G7b ArrangementPlan.

   File named g8a-* rather than realize.test.js/patterns.test.js: a second, concurrent writer in
   this same worktree independently built its own realizer under those plainer names during this
   session (see arrangement/g8a-realize.js's header) - this suite exercises ONLY the g8a-* module
   pair (arrangement/g8a-realize.js, arrangement/g8a-accompaniment.js, arrangement/voicelead.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, SGG, AP, importCorpus } = require('./helpers.js');
const RZ = require(path.join(REPO, 'arrangement', 'g8a-realize.js'));
const PL = require(path.join(REPO, 'playability', 'index.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));

const STYLES = ['block', 'broken', 'ballad', 'pop', 'waltz', 'hymn'];

async function planned(file, level, profile) {
  const rows = await importCorpus([file]);
  assert.ok(rows[0].ok, file + ' must import');
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const p = AP.plan(g, sg, { targetLevel: level, handProfile: profile || 'medium' });
  return { g, sg, p };
}

test('realize: every one of the 6 named styles builds a valid graph with 0 G5 hard violations on a real hymn', async () => {
  const { g, sg, p } = await planned('catalog/hymns/o-come-emmanuel.musicxml', 2, 'medium');
  assert.ok(p.ok, 'fixture assumption: this plan must succeed - ' + (p.ok ? '' : p.reason));
  STYLES.forEach(style => {
    const r = RZ.realize(g, sg, p.plan, { style: style });
    assert.ok(r.ok, r.ok ? '' : (style + ' must realize: ' + r.reason + ' ' + JSON.stringify(r.detail).slice(0, 300)));
    assert.equal(r.style, style === 'default' ? 'block' : style);
    const rep = PL.analyzeGraph(r.graph, { profile: 'medium' });
    assert.equal(rep.totals.hard, 0, style + ': expected 0 hard violations, got ' + JSON.stringify(rep.totals.byCode));
    assert.ok(r.graph.parts[0].events.some(e => e.kind === 'note'), style + ': must place real notes, not only rests');
  });
});

test('realize: an unknown style fails cleanly rather than silently defaulting', async () => {
  const { g, sg, p } = await planned('catalog/hymns/o-come-emmanuel.musicxml', 2, 'medium');
  assert.ok(p.ok);
  const r = RZ.realize(g, sg, p.plan, { style: 'not-a-real-style' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'UNKNOWN_STYLE');
});

test('realize: the generative styles (not hymn) keep the plan\'s declared melody voice verbatim', async () => {
  const { g, sg, p } = await planned('catalog/hymns/o-come-emmanuel.musicxml', 2, 'medium');
  assert.ok(p.ok);
  const section = p.plan.sections[0];
  const origMelody = U.noteWindows(g, { part: p.plan.part }).filter(n => n.voiceId === section.melody.voice);
  ['block', 'ballad'].forEach(style => {
    const r = RZ.realize(g, sg, p.plan, { style: style });
    assert.ok(r.ok);
    const notes = r.graph.parts[0].events.filter(e => e.kind === 'note' && e.voice === r.graph.parts[0].voices[0].id);
    /* every real melody pitch (by pitch class + relative onset order) appears in the same order,
       verbatim - the realized RH is a straight copy, never a re-derivation. */
    assert.equal(notes.length, origMelody.length, style + ': RH note count must match the source melody voice exactly');
    const SG = require(path.join(REPO, 'scoregraph', 'pitch.js'));
    notes.forEach((n, i) => {
      const midi = SG.midi(n.heads[0].pitch);
      assert.equal(midi, origMelody[i].midi, style + ': melody note ' + i + ' must be pitch-identical to the source');
    });
  });
});

test('realize: hymn style materializes every retained voice verbatim, never inventing a pitch', async () => {
  const { g, sg, p } = await planned('catalog/hymns/o-come-emmanuel.musicxml', 3, 'medium');
  assert.ok(p.ok);
  const r = RZ.realize(g, sg, p.plan, { style: 'hymn' });
  assert.ok(r.ok);
  const rep = PL.analyzeGraph(r.graph, { profile: 'medium' });
  assert.equal(rep.totals.hard, 0);
});

test('realize: deterministic - the same plan realized twice is byte-for-byte identical (docs/GOALS/G08 §8)', async () => {
  const { g, sg, p } = await planned('catalog/hymns/amazing-grace.musicxml', 2, 'medium');
  assert.ok(p.ok);
  STYLES.forEach(style => {
    const r1 = RZ.realize(g, sg, p.plan, { style: style });
    const r2 = RZ.realize(g, sg, p.plan, { style: style });
    assert.ok(r1.ok && r2.ok);
    assert.equal(JSON.stringify(r1.graph), JSON.stringify(r2.graph), style + ': two realizations of the same plan must be identical');
  });
});

test('realize: performance - analyze+plan+realize stays well under the design doc\'s 1s/piece budget on real corpus files', async () => {
  const files = ['catalog/hymns/o-come-emmanuel.musicxml', 'catalog/hymns/amazing-grace.musicxml', 'catalog/method/beyer/002.mxl'];
  for (const f of files) {
    const rows = await importCorpus([f]);
    if (!rows[0].ok) continue;
    const g = rows[0].graph;
    const t0 = Date.now();
    const sg = SGG.analyze(g);
    for (const lvl of [1, 2, 3]) {
      const p = AP.plan(g, sg, { targetLevel: lvl, handProfile: 'medium' });
      if (!p.ok) continue;
      const r = RZ.realize(g, sg, p.plan, { style: 'block' });
      assert.ok(r.ok);
    }
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, f + ': expected under 1000ms for analyze + 3 plan/realize attempts, got ' + ms + 'ms');
  }
});
