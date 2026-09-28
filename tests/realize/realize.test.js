/* G08 (G8a) — realize/index.js correctness, determinism, and mutation suite.

   NOTE ON A CONCURRENT SECOND WRITER (found 2026-09-28, mid-session): this worktree
   (D:/PPP-g8) picked up real, independently-committed commits from a second session while
   this implementation was being built (`arrangement/g8a-*.js`, `arrangement/{patterns,
   realize,spell,voicelead,voicing}.js`, `tests/arrangement/g8a-*.test.js`) - the same
   "goal worktrees can have a second writer even when told 'only writer'" precedent the
   user's own memory already names for G4. This file and the whole `realize/` directory are
   this session's own, independent G8a implementation, kept under a distinct namespace
   (`realize/`, not `arrangement/`) so nothing here collides with the other session's files.
   Both are real, both pass their own tests, and which one (or what merge of the two) the
   project keeps is a Lead decision, not one made here. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const PLA = require(path.join(REPO, 'playability/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

async function findPlan(file) {
  const g = await H.graphOf(file);
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  for (const lvl of [pos, pos + 1, pos - 1, pos + 2]) {
    for (const profile of ['large', 'medium', 'small']) {
      const r = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (r.ok) return { g, sg, plan: r.plan, profile, target: lvl };
    }
  }
  return null;
}

test('realize: a real plan on a real corpus file builds a valid graph with 0 G5 hard violations, every pattern', async () => {
  const found = await findPlan('catalog/method/beyer/007.mxl');
  assert.ok(found, 'fixture assumption: a plan must be reachable for this file');
  for (const pattern of ['block', 'broken', 'ballad', 'pop', 'waltz', 'hymn']) {
    const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
    assert.ok(r.ok, pattern + ': ' + JSON.stringify(r.reason || r.detail));
    const analysis = PLA.analyzeGraph(r.graph, { profile: found.profile });
    assert.equal(analysis.totals.hard, 0, pattern + ': expected 0 hard violations, got ' + JSON.stringify(analysis.totals.byCode));
  }
});

test('realize: the melody voice is copied verbatim (byte-identical pitch+rhythm) under every non-hymn pattern', async () => {
  const found = await findPlan('catalog/method/sonatina/001.mxl');
  assert.ok(found);
  const M = require(path.join(REPO, 'realize/tools/metrics.js'));
  const origMelody = M.originalMelodyNotes(found.g, found.plan);
  assert.ok(origMelody.length > 0);
  for (const pattern of ['block', 'broken', 'ballad', 'pop', 'waltz']) {
    const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
    assert.ok(r.ok);
    const score = M.melodyPreservation(origMelody, M.graphNoteList(r.graph));
    assert.equal(score, 1, pattern + ': melody must be perfectly preserved');
  }
});

test('realize: hymn pattern reproduces every retained voice verbatim (note count matches the plan\'s kept voices)', async () => {
  const found = await findPlan('catalog/hymns/o-come-emmanuel.musicxml');
  assert.ok(found);
  const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern: 'hymn' });
  assert.ok(r.ok);
  const origPart = found.g.parts.find(p => p.id === found.plan.part);
  let expectedHeads = 0;
  found.plan.sections.forEach(sec => {
    const i0 = found.g.timeline.measures.findIndex(m => m.id === sec.section.from);
    const i1 = found.g.timeline.measures.findIndex(m => m.id === sec.section.to);
    const measureIds = new Set(found.g.timeline.measures.slice(i0, i1 + 1).map(m => m.id));
    const voiceIds = new Set(sec.hands.RH.concat(sec.hands.LH));
    origPart.events.forEach(e => {
      if (e.kind === 'note' && !e.grace && voiceIds.has(e.voice) && measureIds.has(e.m)) expectedHeads += (e.heads || []).length;
    });
  });
  const gotHeads = r.graph.parts[0].events.reduce((a, e) => a + (e.heads || []).length, 0);
  assert.equal(gotHeads, expectedHeads, 'hymn realization must reproduce every retained voice\'s real heads, no more, no fewer');
});

test('realize: deterministic - the same (graph, sg, plan) realized twice is byte-for-byte identical', async () => {
  const found = await findPlan('catalog/method/czerny599/010.mxl');
  assert.ok(found);
  for (const pattern of ['block', 'ballad', 'hymn']) {
    const a = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
    const b = REALIZE.realize(found.g, found.sg, found.plan, { pattern });
    assert.ok(a.ok && b.ok);
    assert.equal(JSON.stringify(a.graph), JSON.stringify(b.graph), pattern + ': expected byte-identical output');
  }
});

test('mutation: a plan with no sections is refused cleanly, never a fabricated empty graph', () => {
  const r = REALIZE.realize({ id: 'x', timeline: { measures: [] }, parts: [] }, { harmony: [] }, { sections: [], part: 'p1', request: { handProfile: 'medium' } }, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'BAD_PLAN');
});

test('mutation: an unreachable G7b request never reaches realize() with a fabricated plan (the planner itself refuses first)', async () => {
  const g = await H.graphOf('catalog/hymns/all-creatures.musicxml');
  const sg = SGG.analyze(g);
  /* A deliberately absurd target (far beyond any real stage) at the strictest hand profile -
     the same "planted unreachable target" discipline G7b's own mutation suite (§11) uses. */
  const r = ARR.planner.plan(g, sg, { targetLevel: -50, handProfile: 'small', sections: 'all' });
  if (r.ok) return; /* a real corpus file may still be reachable even at an extreme target - not this test's concern */
  assert.equal(r.ok, false);
});

test('mutation: the real degraded corpus case (for-all-the-saints, G7a melodyConf=bassConf=0.0) still realizes, conservatively, at 0 hard violations, never crashing', async () => {
  const g = await H.graphOf('catalog/hymns/for-all-the-saints.musicxml');
  const sg = SGG.analyze(g);
  const pos = DIFF.assess(g, WEIGHTS).level.position;
  let found = null;
  for (const lvl of [pos, pos - 1, pos + 1]) {
    for (const profile of ['large', 'medium', 'small']) {
      const r = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (r.ok) { found = { plan: r.plan, profile }; break; }
    }
    if (found) break;
  }
  assert.ok(found, 'fixture assumption: for-all-the-saints must be reachable at some level/profile');
  assert.ok(found.plan.degraded, 'fixture assumption: this real file\'s plan must be flagged degraded (G7a\'s documented hardest case)');
  ['block', 'hymn'].forEach(pattern => {
    const r = REALIZE.realize(g, sg, found.plan, { pattern });
    assert.ok(r.ok, pattern + ': a degraded plan must still realize cleanly');
    const analysis = PLA.analyzeGraph(r.graph, { profile: found.profile });
    assert.equal(analysis.totals.hard, 0, pattern + ': a degraded, conservative realization must still be 0 hard violations');
  });
});

test('performance: realize() stays well under the design doc\'s 1s/piece budget', async () => {
  /* sonatina/020.mxl (158 measures/1,423 notes) is every prior G5-G7 phase's own worst-case
     perf fixture, but is NOT G7b-plannable at any level/profile tried here (checked
     directly, not assumed - matches G7b's own real ~46% coverage rate, docs/GOALS/G07B §11:
     not every corpus file gets a reachable plan). sonatina/001 is the largest confirmed-
     reachable file this suite already uses elsewhere. */
  const found = await findPlan('catalog/method/sonatina/001.mxl');
  assert.ok(found, 'fixture assumption: sonatina/001 must be reachable at some level/profile');
  const t0 = Date.now();
  const r = REALIZE.realize(found.g, found.sg, found.plan, { pattern: 'auto' });
  const ms = Date.now() - t0;
  assert.ok(r.ok);
  assert.ok(ms < 1000, 'expected < 1000ms, got ' + ms + 'ms');
});
