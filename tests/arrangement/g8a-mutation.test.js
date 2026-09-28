/* G08 §8 mutation suite for the g8a-realize.js realizer (see g8a-realize.test.js's header for
   why this suite is named g8a-* rather than mutation.test.js - a second, concurrent writer in
   this worktree independently built its own realizer/mutation suite under the plainer name).

   Two real cases, the same discipline G7b's own mutation suite (tests/arrangement/mutation.test.js)
   and G6b's handFallback piece used: a planted structural impossibility must fail cleanly, and a
   REAL corpus section G7a found no clear melody/bass in must still realize, conservatively,
   never crashing or fabricating a confidently-wrong arrangement. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, SGG, AP, mk, importCorpus } = require('./helpers.js');
const RZ = require(path.join(REPO, 'arrangement', 'g8a-realize.js'));
const PL = require(path.join(REPO, 'playability', 'index.js'));

test('mutation: an unreachable request (arrangement/plan.js\'s own planted 2-octave-dyad bass) fails cleanly through arrange(), never reaching realize() with a fabricated plan', () => {
  /* Same planted fixture as tests/arrangement/mutation.test.js's "unreachable under any hand
     profile" case: the bass voice holds a 2-octave dyad at every attack, wider than even the
     LARGE profile's MAX_SPAN, so no ladder rung the planner tries can ever fit it. */
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q', lh: 'C2+C4:q G1+G3:q C2+C4:q G1+G3:q' });
  const sg = SGG.analyze(g);
  ['small', 'medium', 'large'].forEach(profile => {
    const res = RZ.arrange(g, sg, { targetLevel: 3.5, handProfile: profile }, { style: 'block' });
    assert.equal(res.ok, false, profile + ': expected a clean failure, not a fabricated plan/graph');
    assert.equal(res.reason, 'UNREACHABLE', profile + ': the failure must be G7b\'s own real reason, not a G8a-invented one');
  });
});

test('mutation: a real corpus section G7a found no clear melody/bass in (for-all-the-saints, melodyConf=bassConf=0.0) still realizes, conservatively, at 0 hard violations, never crashing', async () => {
  /* The same real fixture G7b's own mutation suite uses (docs/GOALS/G07B §11's documented
     hardest case, and G7a's own §12): checked directly there, not re-derived here, that this
     file's second part has real melodyConf/bassConf of exactly 0.0/0.0. */
  const rows = await importCorpus(['catalog/hymns/for-all-the-saints.musicxml']);
  assert.ok(rows[0].ok);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const p = AP.plan(g, sg, { targetLevel: 1.5, handProfile: 'medium' });
  assert.ok(p.ok, 'fixture assumption: a degraded plan must still be ok:true (G7b\'s own behaviour)');
  assert.equal(p.plan.degraded, true, 'fixture assumption: this plan must be flagged degraded');
  const sec = p.plan.sections.find(s => s.section.label === sg.sections[0].label);
  assert.equal(sec.texture, 'reduced', 'fixture assumption: a degraded section is always planned at the simplest texture');

  ['block', 'hymn'].forEach(style => {
    const r = RZ.realize(g, sg, p.plan, { style: style });
    assert.ok(r.ok, style + ': a degraded plan must still realize - ' + JSON.stringify(r.reason));
    const rep = PL.analyzeGraph(r.graph, { profile: 'medium' });
    assert.equal(rep.totals.hard, 0, style + ': a degraded, conservative realization must still be 0 hard violations');
  });
});

test('mutation: an empty plan (no sections) is refused, never silently producing an empty graph', () => {
  const r = RZ.realize(null, null, { sections: [] }, { style: 'block' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'EMPTY_PLAN');
});
