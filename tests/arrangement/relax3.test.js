/* arrangement/plan.js, relax 3 (G10c-1a, docs/GOALS/G10_AUDIO_TO_SCORE.md section 33.5): the last tier of the relaxed search, asked for only by the lead sheet of a recording.
   On the FLOOR rung (nothing left to drop: the melody alone, or the melody and bass) the key signature ceiling and the right hand's density ceiling no longer refuse a section
   (the melody is copied verbatim and the arranger does not transpose); the left hand's density and the chord load stay checked in the code (arrangement/plan.js). Everything the strict search plans
   is planned exactly as before: a plan made with relax 3 for a piece the strict search fits is byte for byte the strict plan.
   node --test tests/arrangement */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const ARR = require(path.join(REPO, 'arrangement', 'index.js'));
const IMPORT = require(path.join(REPO, 'scoregraph', 'musicxml-import.js'));
const E = require(path.join(REPO, 'tests', 'realize', 'app-single-extract.js'));
const ref = E.reference();

function hymn(name) {
  const r = IMPORT.importMusicXml(fs.readFileSync(path.join(REPO, 'catalog', 'hymns', name + '.musicxml'), 'utf8'), { scoreId: 'h-' + name });
  assert.ok(r.ok, 'import ' + name);
  return r.graph;
}
const plan = (g, sg, stage, relax, profile) => ARR.planner.plan(g, sg, { targetLevel: stage, handProfile: profile || 'large', sections: 'all' }, relax ? { reference: ref, relax: relax } : { reference: ref });
/* the same piece with a key signature of six sharps in its first bar (the notes are what they are: the planner reads only the signature) */
function sharpKey(g) {
  const x = JSON.parse(JSON.stringify(g));
  x.timeline.keys[0].fifths = 6;
  return x;
}

test('a key of six sharps is refused at every stage by the strict search and by relax 2; relax 3 plans it, on the floor rung, and says so', () => {
  const g = sharpKey(hymn('silent-night'));
  const sg = SGG.analyze(g);
  for (const stage of [1, 2, 3, 4]) {
    assert.equal(plan(g, sg, stage, 0).ok, false, 'strict, stage ' + stage);
    assert.equal(plan(g, sg, stage, 2).ok, false, 'relax 2, stage ' + stage);
    const p = plan(g, sg, stage, 3);
    assert.equal(p.ok, true, 'relax 3, stage ' + stage + ': ' + p.reason);
    assert.equal(p.plan.relaxed, 3);
    p.plan.sections.forEach(s => {
      assert.equal(s.relaxed, 3);
      assert.equal(s.texture, 'reduced', 'a section planned at tier 3 is on the floor rung (melody and bass only)');
      assert.ok(/key signature and right-hand density ceilings dropped/.test(s.explanation));
    });
  }
});

test('relax 3 asks the strict search first: a piece it fits is planned byte for byte as without the option, at every stage', () => {
  for (const name of ['silent-night', 'holy-holy-holy', 'midnight-clear', 'take-my-life']) {
    const g = hymn(name), sg = SGG.analyze(g);
    for (const stage of [1, 2, 3, 4]) {
      const strict = plan(g, sg, stage, 0);
      if (!strict.ok) continue;
      assert.equal(JSON.stringify(plan(g, sg, stage, 3)), JSON.stringify(strict), name + ' stage ' + stage);
    }
  }
});

test('relax 3 is not relax 2 with a ceiling less: where relax 2 plans a section, relax 3 plans it the same way (its extra tier is reached only when relax 2 would refuse)', () => {
  for (const name of ['silent-night', 'holy-holy-holy']) {
    const g = hymn(name), sg = SGG.analyze(g);
    for (const stage of [1, 2, 3, 4]) {
      const two = plan(g, sg, stage, 2);
      if (!two.ok) continue;
      assert.equal(JSON.stringify(plan(g, sg, stage, 3)), JSON.stringify(two), name + ' stage ' + stage);
    }
  }
});
