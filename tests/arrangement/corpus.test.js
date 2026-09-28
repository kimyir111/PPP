/* G07B §5 acceptance, over the real corpus (hymns first, per the design doc's own priority -
   "the richest SongGraph ground truth already"). Real baseline measured by
   arrangement/tools/corpus-check.js (2026-09-28): requesting each piece's OWN real G6-
   assessed level (difficulty/index.js's assess(), medium hand profile) succeeds for 169 of
   369 corpus files overall, 67 of 100 hymns specifically; zero crashes; 400/400 sampled
   determinism checks identical byte-for-byte. These are regression floors, set a safe
   margin below the real measured numbers (the same discipline tests/songgraph/hymn-
   corpus.test.js's floors use) - a real drop means something regressed, not corpus noise.
   `run: node arrangement/tools/corpus-check.js` reproduces the full numbers (369 files x
   3 levels x 3 hand profiles, performance, determinism over 400 samples). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, SGG, AP, importCorpus, corpusFiles } = require('./helpers.js');
const DIFF = require(path.join(REPO, 'difficulty', 'index.js'));
const weights = require(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'));

function hymnFiles() { return corpusFiles().filter(f => f.startsWith('catalog/hymns/')); }

test('corpus: zero crashes over every importable file (analyze + plan at the piece\'s own real level)', async () => {
  const rows = await importCorpus(corpusFiles());
  let crashes = 0;
  rows.forEach(r => {
    if (!r.ok) return;
    try {
      const sg = SGG.analyze(r.graph);
      const level = DIFF.assess(r.graph, weights).level;
      if (level) AP.plan(r.graph, sg, { targetLevel: level.position, handProfile: 'medium' });
    } catch (e) { crashes++; console.log('CRASH', r.path, e.message); }
  });
  assert.equal(crashes, 0);
});

test('corpus: at least 55 of the 100 real hymns can be planned at their own real level and hand=medium (baseline 67/100)', async () => {
  const rows = await importCorpus(hymnFiles());
  let ok = 0, total = 0;
  rows.forEach(r => {
    if (!r.ok) return;
    const sg = SGG.analyze(r.graph);
    const level = DIFF.assess(r.graph, weights).level;
    if (!level) return;
    total++;
    if (AP.plan(r.graph, sg, { targetLevel: level.position, handProfile: 'medium' }).ok) ok++;
  });
  assert.equal(total, 100);
  assert.ok(ok >= 55, 'hymn coverage dropped to ' + ok + '/100, below the 55 floor (baseline 67/100)');
});

test('corpus: at least 130 of the full 369-file corpus can be planned at their own real level and hand=medium (baseline 169/369)', async () => {
  const rows = await importCorpus(corpusFiles());
  let ok = 0, total = 0;
  rows.forEach(r => {
    if (!r.ok) return;
    const sg = SGG.analyze(r.graph);
    const level = DIFF.assess(r.graph, weights).level;
    if (!level) return;
    total++;
    if (AP.plan(r.graph, sg, { targetLevel: level.position, handProfile: 'medium' }).ok) ok++;
  });
  assert.ok(ok >= 130, 'corpus coverage dropped to ' + ok + '/' + total + ', below the 130 floor (baseline 169/369)');
});

test('corpus: determinism holds over a real sample (hymns), byte-for-byte, replanned', async () => {
  const rows = await importCorpus(hymnFiles().slice(0, 20));
  rows.forEach(r => {
    if (!r.ok) return;
    const sg = SGG.analyze(r.graph);
    const req = { targetLevel: 2.0, handProfile: 'medium' };
    const a = JSON.stringify(AP.plan(r.graph, sg, req));
    const b = JSON.stringify(AP.plan(r.graph, sg, req));
    assert.equal(a, b, r.path + ' plan() is not deterministic');
  });
});
