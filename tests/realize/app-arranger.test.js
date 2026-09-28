/* G08b (docs/GOALS/G08B_LEGACY_RETIREMENT.md) - the app's G8a wiring (PPP.arranger, S4 fix to
   applyRichReviewArrangement), tested directly against the app's real source (extracted, not
   reimplemented - tests/realize/app-arranger-extract.js) and real G8a/G7b/G7a modules. No
   browser needed: realizeWithG8/graphToReviewScore only close over window/tx/Score/
   loadArrangerReference, all real Node-side equivalents here (see the extractor's own header).

   A full page-driven check of the 'legacy' (off, default, byte-identical) vs 'g8' (on) review-
   screen flow, and the PPP.arranger switch's own default/fallback, lives in
   tests/transcription.test.js's end-to-end section (needs the real local transcription helper
   running, so it cannot run in every environment); this suite covers the same real behaviour
   with no such dependency, using real corpus files instead of a synthesised recording. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { appArranger, REPO } = require('./app-arranger-extract.js');
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const IMPORT = require(path.join(REPO, 'scoregraph', 'musicxml-import.js'));
const fs = require('fs');

const A = appArranger();

function importCorpus(rel) {
  const xml = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const r = IMPORT.importMusicXml(xml, { scoreId: rel.replace(/[^A-Za-z0-9._:-]/g, '-').slice(-64) });
  assert.ok(r.ok, 'import ' + rel + ' failed: ' + JSON.stringify(r.report));
  return r.graph;
}

test('ARRANGER_LEVEL_TO_STAGE: a declared, approximate crosswalk onto G6\'s 4 stages, in order', () => {
  assert.deepEqual(A.ARRANGER_LEVEL_TO_STAGE, { beginner: 1, intermediate: 2, advanced: 3, original: 4 });
});

test('ARRANGER_HAND_PROFILES: most- to least-permissive, matching corpus-check.js/harness.js\'s own search order', () => {
  assert.deepEqual(A.ARRANGER_HAND_PROFILES, ['large', 'medium', 'small']);
});

test('realizeWithG8: a real corpus hymn realizes ok, a real G8a graph, not a fabricated one', async () => {
  const g = importCorpus('catalog/hymns/amazing-grace.musicxml');
  const res = await A.realizeWithG8(g, { level: 'beginner', style: 'ballad' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.graph && Array.isArray(res.graph.parts) && res.graph.parts.length === 1, 'a real single-part two-staff ScoreGraph');
  assert.ok(res.report && Array.isArray(res.report.sections) && res.report.sections.length > 0, 'a real per-section report, not empty');
  assert.equal(typeof res.degraded, 'boolean');
});

test('realizeWithG8: an unreachable request (G7b\'s own planted physical-impossibility fixture) fails cleanly, never crashes', async () => {
  /* The SAME fixture tests/arrangement/mutation.test.js uses: a bass voice written as a real
     2-octave dyad at every attack, wider than even the LARGE hand profile's MAX_SPAN - no rung
     of G7b's own retention ladder can ever fit it, at any level. */
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q', lh: 'C2+C4:q G1+G3:q C2+C4:q G1+G3:q' });
  const res = await A.realizeWithG8(g, { level: 'advanced', style: 'ballad' });
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.equal(res.reason, 'UNREACHABLE');
});

test('realizeWithG8: the real degraded corpus case (for-all-the-saints, G7a melodyConf=bassConf=0.0) still realizes, flagged degraded, never crashing', async () => {
  const g = importCorpus('catalog/hymns/for-all-the-saints.musicxml');
  const res = await A.realizeWithG8(g, { level: 'intermediate', style: 'ballad' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.degraded, true, 'this exact corpus file is G7a\'s own documented degraded case - it should say so, not silently look confident');
});

test('graphToReviewScore: a real G8a graph becomes a real Score, with real hands substituted (not toScore\'s hand:\'r\' default)', async () => {
  const g = importCorpus('catalog/hymns/amazing-grace.musicxml');
  const res = await A.realizeWithG8(g, { level: 'beginner', style: 'ballad' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const score = A.graphToReviewScore(res.graph, 'Amazing Grace (g8)');
  const sounding = score.notes.filter(n => !n.rest);
  assert.ok(sounding.length > 0, 'a real, non-empty Score');
  const hands = new Set(sounding.map(n => n.hand));
  assert.ok(hands.has('l') && hands.has('r'),
    'both hands must be real (toScore\'s own default writes hand:\'r\' for every note - the app must substitute the graph\'s real limb back in, the same technique tests/playability/arranger-baseline.test.js\'s legacyScoreFromGraph already uses): got ' + JSON.stringify([...hands]));
  assert.equal(score.staves, 2);
});

test('performance: realizeWithG8 end to end (analyze+plan+realize, real reference data, real corpus file) stays comfortably under a 200ms per-arrangement budget', async () => {
  const g = importCorpus('catalog/hymns/amazing-grace.musicxml');
  const t0 = Date.now();
  const res = await A.realizeWithG8(g, { level: 'intermediate', style: 'ballad' });
  const ms = Date.now() - t0;
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(ms < 200, ms + 'ms');
});
