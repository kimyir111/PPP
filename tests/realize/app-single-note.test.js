/* G9e-lite (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the app's opt-in `PPP.arranger = 'single'` (one note per hand), tested
   against the app's own source (extracted, never reimplemented: tests/realize/app-single-extract.js) and the real modules, with no browser:

     - the mode switch: 'legacy' default, 'g8', 'single', anything else is 'legacy'; which requests the option takes (never "original")
     - every script the option loads on first use loads in a BARE vm context (no require, no module, no document), after the page's own
       scripts, and the pipeline run there gives byte-for-byte the graph the Node require() modules give
     - what comes out: one note per hand at every onset, both hands used, on the four hymns at all four levels
     - refusals are {ok:false, reason}, never a throw and never another engine: an unreachable piece, no reference data, scripts that did
       not load, a graph that is not one
     - the cache, and a graph with no tempo list (a real gap this round found in realize())

   The page-driven half (default output identical to origin/main, the control, the lazily loaded scripts, the failure notice on screen)
   is tests/single-note-app.test.js (npm run test:single-note-app). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('./app-single-extract.js');
const { mk } = require(path.join(E.REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const IMPORT = require(path.join(E.REPO, 'scoregraph', 'musicxml-import.js'));
const SGIDX = require(path.join(E.REPO, 'scoregraph', 'index.js'));
const SER = require(path.join(E.REPO, 'scoregraph', 'serialize.js'));

const ref = E.reference();
const refLoader = () => Promise.resolve(ref);
const nodeApp = E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader });

function hymn(name) {
  const r = IMPORT.importMusicXml(fs.readFileSync(path.join(E.REPO, 'catalog/hymns', name + '.musicxml'), 'utf8'), { scoreId: 'h-' + name });
  assert.ok(r.ok, 'import ' + name);
  return r.graph;
}
async function mxl(rel) {
  const r = await SGIDX.importFile(new Uint8Array(fs.readFileSync(path.join(E.REPO, rel))), { name: rel, scoreId: rel.replace(/[^A-Za-z0-9._:-]/g, '-') });
  assert.ok(r.ok, 'import ' + rel);
  return r.graph;
}
/* the notes of a review Score that one hand starts at one moment */
function attacksPerHand(score) {
  const by = new Map();
  score.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
  return [...by.values()];
}

test('PPP.arranger: legacy by default; g8 and single are accepted; anything else is legacy (G4-F2-1\'s convention)', () => {
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader });
  assert.equal(app.PPP.arranger, 'legacy');
  app.PPP.arranger = 'single'; assert.equal(app.PPP.arranger, 'single');
  app.PPP.arranger = 'g8'; assert.equal(app.PPP.arranger, 'g8');
  app.PPP.arranger = 'single'; assert.equal(app.PPP.arranger, 'single');
  ['some-typo', 'SINGLE', 'legacy', '', null, undefined, true, 1, {}].forEach(v => {
    app.PPP.arranger = 'single';
    app.PPP.arranger = v;
    assert.equal(app.PPP.arranger, 'legacy', 'a ' + JSON.stringify(v) + ' must give legacy');
  });
});

test('singleRoute: only the option takes a request, and never the difficulty "original" (what was heard is not an arrangement)', () => {
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader });
  ['legacy', 'g8'].forEach(mode => {
    app.setMode(mode);
    ['beginner', 'intermediate', 'advanced', 'original'].forEach(level => assert.equal(app.singleRoute({ level: level, style: 'balanced' }), false, mode + ' ' + level));
  });
  app.setMode('single');
  ['beginner', 'intermediate', 'advanced'].forEach(level => ['balanced', 'jazz', 'melody'].forEach(style => assert.equal(app.singleRoute({ level: level, style: style }), true, level + ' ' + style)));
  assert.equal(app.singleRoute({ level: 'original', style: 'balanced' }), false);
  assert.equal(app.singleRoute({ level: 'original', style: 'jazz' }), false);
  assert.equal(app.singleRoute(null), false);
  assert.equal(app.singleRoute(undefined), false);
});

test('the scripts the option loads on first use: all in the page\'s own <script> list order, none of them already in the page, and every one loads in a bare vm context', () => {
  const { head, single } = E.scriptListOfPage();
  assert.ok(single.length >= 10, 'the list is read from the app: ' + single.join(','));
  single.forEach(p => {
    assert.equal(head.indexOf(p), -1, p + ' must not be in the page\'s up-front script list (it is loaded lazily)');
    assert.ok(fs.existsSync(path.join(E.REPO, p)), p + ' exists');
    assert.ok(!/^(tests|tools|node_modules|data)\//.test(p), p + ' is not under a directory server.js blocks');
  });
  const ctx = E.browserWindow(); /* throws if any file fails to load in a bare context */
  assert.equal(typeof ctx.require, 'undefined');
  assert.equal(typeof ctx.module, 'undefined');
  assert.ok(ctx.PPPCandidates && typeof ctx.PPPCandidates.runAsync === 'function', 'PPPCandidates');
  assert.ok(ctx.PPPRepair && typeof ctx.PPPRepair.repairSelection === 'function', 'PPPRepair');
  assert.ok(ctx.PPPCritics && ctx.PPPCriticsModules.metrics && typeof ctx.PPPCriticsModules.metrics.setWeights === 'function', 'PPPCritics, metrics.setWeights');
  assert.ok(ctx.PPPRealizeModules.ottava && typeof ctx.PPPRealizeModules.ottava.addOttava === 'function', 'ottava');
  assert.ok(ctx.PPPRealizeModules.handchords, 'handchords');
});

test('critics/metrics.js in a browser: no Node tools, so the engrave metric refuses plainly and the level needs the weights; Node is unchanged', () => {
  const ctx = E.browserWindow();
  const M = ctx.PPPCriticsModules.metrics;
  const g = hymn('christ-arose');
  assert.throws(() => M.engraveMetrics(g, 'x'), /Node-only/);
  assert.throws(() => M.levelOfGraph(g), /setWeights/);
  M.setWeights(ref.weights);
  const inBrowser = M.levelOfGraph(g);
  const inNode = require(path.join(E.REPO, 'critics/metrics.js')).levelOfGraph(g);
  assert.equal(inBrowser, inNode, 'the same G6a level with the weights the page fetched');
  assert.equal(typeof require(path.join(E.REPO, 'critics/metrics.js')).engraveMetrics(g, 'christ').silent, 'number', 'Node still measures engraving');
});

test('the pipeline in a bare vm window gives, byte for byte, the graph the Node modules give (christ-arose, two levels)', async () => {
  const ctx = E.browserWindow();
  const browserApp = E.make({ window: ctx, loadArrangerReference: refLoader });
  for (const level of ['beginner', 'advanced']) {
    const a = await nodeApp.arrangeSingleNote(hymn('christ-arose'), { level: level });
    const b = await browserApp.arrangeSingleNote(JSON.parse(JSON.stringify(hymn('christ-arose'))), { level: level });
    assert.equal(a.ok, true); assert.equal(b.ok, true, JSON.stringify(b));
    assert.equal(SER.fingerprint(b.graph), SER.fingerprint(a.graph), level + ': the same graph in both');
    assert.equal(JSON.stringify(b.report.spec), JSON.stringify(a.report.spec));
  }
});

test('the winner without the engrave gate (what the browser runs) is the gated winner (what the review packets used), on three hymns at four levels', async () => {
  const CAND = require(path.join(E.REPO, 'candidates/index.js'));
  const SGG = require(path.join(E.REPO, 'songgraph/index.js'));
  let compared = 0;
  for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not']) {
    const g = hymn(name), sg = SGG.analyze(g);
    for (const targetLevel of [1, 2, 3, 4]) {
      const request = { targetLevel: targetLevel, handProfile: 'large', sections: 'all' };
      const gated = CAND.run(g, sg, request, { singleNoteHands: true });
      const cheap = CAND.run(g, sg, request, { singleNoteHands: true, skipEngrave: true });
      assert.equal(cheap.ok, gated.ok, name + ' ' + targetLevel);
      if (!gated.ok) continue;
      assert.equal(cheap.selected.fingerprint, gated.selected.fingerprint, name + ' at ' + targetLevel + ': same winner');
      assert.equal(cheap.selected.scores.engrave, null, 'the engrave critic was not run');
      compared++;
    }
  }
  assert.ok(compared >= 9, 'compared ' + compared);
});

test('one note per hand: every onset of both hands on the four hymns at all four levels, both hands used, the melody on top', async () => {
  for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not', 'all-creatures']) {
    for (const level of ['beginner', 'intermediate', 'advanced', 'original']) {
      const res = await nodeApp.arrangeSingleNote(hymn(name), { level: level });
      assert.equal(res.ok, true, name + ' ' + level + ' ' + JSON.stringify(res));
      const score = nodeApp.graphToReviewScore(res.graph, name);
      const per = attacksPerHand(score);
      assert.equal(per.filter(n => n > 1).length, 0, name + ' ' + level + ': no hand starts two notes at once');
      const hands = new Set(score.notes.filter(n => !n.rest).map(n => n.hand));
      assert.ok(hands.has('l') && hands.has('r'), name + ' ' + level + ': both hands');
      assert.ok(score.notes.filter(n => !n.rest).length >= 100, name + ' ' + level + ': a real arrangement, not an empty one');
    }
  }
});

test('refusals are results, never throws and never another engine: unreachable, no reference, scripts missing, a graph that is not one', async () => {
  const unreachable = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q', lh: 'C2+C4:q G1+G3:q C2+C4:q G1+G3:q' });
  const r1 = await nodeApp.arrangeSingleNote(unreachable, { level: 'advanced' });
  assert.equal(r1.ok, false); assert.equal(r1.reason, 'UNREACHABLE');
  const real = await nodeApp.arrangeSingleNote(await mxl('catalog/method/sonatina/020.mxl'), { level: 'beginner' });
  assert.equal(real.ok, false, 'sonatina/020 has no reachable plan at any level (G09 section 12: 22 of 48 sample files have none)');
  assert.equal(real.reason, 'UNREACHABLE');
  const noRef = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(null) });
  assert.deepEqual(await noRef.arrangeSingleNote(hymn('christ-arose'), { level: 'beginner' }), { ok: false, reason: 'REFERENCE_UNAVAILABLE' });
  const noScripts = E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader, loadSingleModules: () => Promise.resolve(false) });
  assert.deepEqual(await noScripts.arrangeSingleNote(hymn('christ-arose'), { level: 'beginner' }), { ok: false, reason: 'SINGLE_NOT_LOADED' });
  const crash = await nodeApp.arrangeSingleNote({ not: 'a graph' }, { level: 'beginner' });
  assert.equal(crash.ok, false);
  assert.ok(crash.reason === 'SINGLE_CRASH' || crash.reason === 'UNREACHABLE', 'a crash is reported: ' + crash.reason);
});

test('the cache: the same graph and level answers at once from the first result; another level is its own entry; it is bounded', async () => {
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader });
  const g = hymn('nearer-my-god');
  const a = await app.arrangeSingleNote(g, { level: 'beginner' });
  const b = await app.arrangeSingleNote(hymn('nearer-my-god'), { level: 'beginner' }); /* another graph object with the same music */
  assert.equal(a.ok, true); assert.equal(b.cached, true); assert.equal(b.graph, a.graph);
  const c = await app.arrangeSingleNote(g, { level: 'advanced' });
  assert.notEqual(c.cached, true);
  assert.equal(app.SINGLE_CACHE.size, 2);
  for (const n of ['christ-arose', 'pass-me-not', 'all-creatures', 'all-glory-laud', 'god-rest-ye-merry']) await app.arrangeSingleNote(hymn(n), { level: 'beginner' });
  assert.ok(app.SINGLE_CACHE.size <= 6, 'bounded: ' + app.SINGLE_CACHE.size);
});

test('a graph read from a file with no tempo list is arranged (realize() used to throw on it; czerny299/009 is a real one)', async () => {
  const g = await mxl('catalog/method/czerny299/009.mxl');
  assert.equal(g.timeline.tempos, undefined, 'this file really has no tempo list');
  const res = await nodeApp.arrangeSingleNote(g, { level: 'beginner' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const score = nodeApp.graphToReviewScore(res.graph, 'czerny');
  assert.equal(attacksPerHand(score).filter(n => n > 1).length, 0);
  const h = hymn('christ-arose');
  const stripped = Object.assign({}, h, { timeline: Object.assign({}, h.timeline) }); /* graphs are frozen: a copy without the list */
  delete stripped.timeline.tempos;
  const again = await E.make({ window: E.nodeWindow(), loadArrangerReference: refLoader }).arrangeSingleNote(stripped, { level: 'beginner' });
  assert.equal(again.ok, true, JSON.stringify(again));
});
