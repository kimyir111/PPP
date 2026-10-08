/* G11b-0: the legacy-policy runner (tests/practice-sim/app-legacy.js, runner.js, baseline.js).

     - what runs is the app file's own text: every extracted declaration and method is a slice of the page's script, the
       engines the practice loop uses are all there, and a change to one of the app's thresholds in a copy of the app
       changes what the simulated learner is told to do;
     - the runner's one speed-up (the measureView cache) changes nothing, and no code in the page writes to a view;
     - determinism: three runs give the same rows, so do the reversed order and two threads, and they are the rows of
       the committed baseline (written on Windows; the gate's --check recomputes them on Linux). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./app-legacy.js');
const P = require('./pieces.js');
const RUN = require('./runner.js');
const B = require('./baseline.js');

const x = L.extract();
const script = L.inlineScript(L.appHtml());

test('every piece of code the runner runs is a slice of the app\'s own script, and the practice engines are all there', () => {
  x.engines.forEach(c => assert.ok(script.indexOf(c.text) >= 0, c.name));
  x.methods.forEach(m => assert.ok(script.indexOf(m.text) >= 0, m.name));
  assert.ok(script.indexOf(x.stateInit) >= 0 && script.indexOf(x.startToday) >= 0);
  const names = x.engines.map(c => c.name);
  ['PianoScore', 'Score', 'PerformanceEngine', 'TIMING_DEFAULTS', 'Learning', 'LEARN', 'Memory', 'MEMORY', 'Coach', 'COACH', 'Clock', 'seedSecs']
    .forEach(n => assert.ok(names.indexOf(n) >= 0, n));
  assert.ok(names.indexOf('h') < 0 && names.indexOf('Component') < 0, 'React and the component class are not loaded');
  L.METHODS.forEach(n => assert.ok(x.methods.some(m => m.name === n), n));
  /* the methods really are the component's: the lap's end, the coach session, the card */
  assert.match(x.methods.find(m => m.name === 'completeLap').text, /patch\.history = Learning\.record\(S\.history, measured,/);
  assert.match(x.methods.find(m => m.name === 'maybeReplan').text, /Coach\.shouldReplan\(this\._coachPrint, now\)/);
  assert.match(x.methods.find(m => m.name === 'recommendation').text, /return Memory\.nextTask\(S\.score, S\.history, S\.memory,/);
});

test('no code the runner runs writes to a measure view (what makes the measureView cache safe)', () => {
  const code = x.engines.map(c => c.text).join('\n') + '\n' + x.methods.map(m => m.text).join('\n');
  const writes = code.match(/\b(?:v|view|vw|views\[[^\]]+\])\.(?!soundQ\b)\w+\s*(?:=(?!=)|\+=|-=|\+\+)/g) || [];
  assert.deepEqual(writes, []);
  assert.equal((code.match(/measureView\(/g) || []).length, 2, 'measureView is called from views() and defined once');
});

async function oneRow(env, pieceId, type, arm) {
  const [piece] = await P.loadAll(env.E, [pieceId]);
  return B.rowOf(await RUN.simulate(env, piece, type, 0, arm));
}

test('the cache changes nothing: a learner\'s row is the same with Learning.measureView uncached', async () => {
  const a = await oneRow(L.build(), 'czerny599-010', 'even', 'coach');
  const b = await oneRow(L.build({ memo: false }), 'czerny599-010', 'even', 'coach');
  assert.deepEqual(a, b);
});

test('the runner runs the app, not a copy of it: LEARN.weakAt changed in a copy of the app file changes what the learner does', async () => {
  const html = fs.readFileSync(L.APP, 'utf8');
  const marker = 'weakAt: 0.30,';
  assert.equal(html.split(marker).length, 2, 'LEARN.weakAt is where it was');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-sim-')), 'app.html');
  fs.writeFileSync(tmp, html.replace(marker, 'weakAt: 0.15,'));
  try {
    const base = await oneRow(L.build(), 'czerny599-010', 'even', 'coach');
    const changed = await oneRow(L.build({ file: tmp }), 'czerny599-010', 'even', 'coach');
    assert.notDeepEqual(changed, base);
    assert.notEqual(changed.weakQuartileShare, base.weakQuartileShare);
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
});

test('deterministic: three runs, the reversed order and two threads give the same rows, and they are the committed baseline\'s', async () => {
  const jobs = B.jobsOf('gate', ['czerny599-010'], ['even', 'rushing'], ['coach', 'card']);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await B.rowsFor(jobs, { workers: 1, quiet: true }));
  runs.push(await B.rowsFor(jobs, { workers: 1, reverse: true, quiet: true }));
  runs.push(await B.rowsFor(jobs, { workers: 2, quiet: true }));
  runs.slice(1).forEach(r => assert.deepEqual(r, runs[0]));
  const committed = JSON.parse(fs.readFileSync(B.OUT.gate, 'utf8'));
  const byKey = new Map(committed.rows.map(r => [r.key, r]));
  runs[0].forEach(r => assert.deepEqual(r, byKey.get(r.key), r.key));
});

test('the committed gate baseline is consistent: its aggregates and configuration are what its rows and today\'s code make', () => {
  const text = fs.readFileSync(B.OUT.gate, 'utf8').replace(/\r\n/g, '\n');
  const doc = JSON.parse(text);
  assert.equal(doc.rows.length, B.jobsOf('gate', P.PIECES.map(p => p.id), require('../../practice/sim.js').TYPE_NAMES, RUN.ARMS).length);
  assert.equal(B.canonical(B.docFrom('gate', doc.rows)), text);
});

test('the committed full-scale baseline (local: --full --check) was made by today\'s configuration and app code list', () => {
  const doc = JSON.parse(fs.readFileSync(B.OUT.full, 'utf8'));
  const now = B.docFrom('full', []);
  ['schema', 'tool', 'simVersion', 'set', 'note', 'config', 'appCode'].forEach(k => assert.deepEqual(doc[k], now[k], k));
  assert.equal(doc.aggregates.byArm.coach.n, 200 * 6 * 8);
  assert.equal(doc.rows, undefined);
});
