/* The two loaders of the page that share v2's files, run for real against a fake page (G10c-1b, docs/GOALS/G10_AUDIO_TO_SCORE.md section 34.4):
   loadRecordingModules (v2's seventeen files) and loadLeadsheetModule (the grid model, rec/grid.js, rec/writer.js, rec/leadsheet.js). Their own source is read out of Piano Coach App.dc.html and run
   here against a fake document (script elements that load after a delay, run in the order they were added when async is false, and fail on request), a fake fetch (the real weights files) and
   a window; nothing of them is replaced. What is pinned:
     - the two loaders may be on their way at once, in either order and at any moment of each other's load, and BOTH resolve true (a wait each way had them hold each other until their 15 s ran out: both false)
     - every file is asked for once and runs once, in the order that gives rec/leadsheet.js its writer and its grid before it runs (what it read when it ran is what it keeps)
     - a load in which one of the files rec/leadsheet.js reads fails leaves NO lead sheet on the page (it would hold no writer, or no grid), and the next asker asks for that file AND for rec/leadsheet.js, which
       then holds what is there now; nothing else is asked for again
     - a lead sheet on the page with its files is not asked for again; with one of them gone it is
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO } = require('./helpers.js');

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
const between = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, 'the page has ' + from.slice(0, 40) + ' ... ' + to.slice(0, 40));
  return html.slice(a, b);
};
const WEIGHTS_JSON = {};
['ai5a-v1', 'hands-v1', 'ai5b-grid-v1', 'ai5b-rests-v1'].forEach(n => { WEIGHTS_JSON['rec/weights/' + n + '.json'] = JSON.parse(fs.readFileSync(path.join(REPO, 'rec', 'weights', n + '.json'), 'utf8')); });
/* the page's own loader code: the lists, the shared state, v2's loader, the lead sheet's; the timeout of 15 s is shortened so that a stall is a test that ends (and says false) */
const SRC = between('const RECORDING_WEIGHTS = [', 'const RECORDING_DEFAULT')
  + between('const _recLoaded = new Set();', '/* is a v2 conversion\'s result believable').replace('const REC_LOAD_TIMEOUT_MS = 15000;', 'const REC_LOAD_TIMEOUT_MS = 1500;')
  + between('const LEADSHEET_SCRIPT =', '/* is this request one the lead sheet may make?')
  + 'return { loadRecordingModules, loadLeadsheetModule, recordingModulesReady, loaded: _recLoaded, globals: _recGlobals, error: () => RECORDING_LOAD_ERROR };';

/* what each script leaves on the window when it runs (what rec/ files do): the lead sheet keeps what it read when it ran */
const RUN = {
  'rec/attacks.js': w => { (w.PPPRecModules = w.PPPRecModules || {}).attacks = {}; },
  'rec/beats.js': w => { (w.PPPRecModules = w.PPPRecModules || {}).beats = {}; },
  'rec/model.js': w => { (w.PPPRecModules = w.PPPRecModules || {}).model = {}; },
  'rec/metre.js': w => { (w.PPPRecModules = w.PPPRecModules || {}).metre = {}; },
  'rec/hands.js': w => { (w.PPPRecModules = w.PPPRecModules || {}).hands = {}; },
  'rec/index.js': w => { w.PPPRec = { skeleton: {} }; },
  'rec/grid.js': w => { w.PPPRecGrid = { model: w.PPPRecGridModel || null }; },
  'rec/voices.js': w => { w.PPPRecVoices = {}; },
  'rec/rests.js': w => { w.PPPRecRests = {}; },
  'rec/writer.js': w => { w.PPPRecWriter = {}; },
  'rec/key.js': w => { w.PPPRecKey = {}; },
  'rec/pedal.js': w => { w.PPPRecPedal = {}; },
  'rec/app.js': w => { w.PPPRecApp = {}; },
  'realize/ottava.js': w => { (w.PPPRealizeModules = w.PPPRealizeModules || {}).ottava = {}; },
  'rec/leadsheet.js': w => { w.PPPRecLeadsheet = { WR: w.PPPRecWriter, RG: w.PPPRecGrid }; }
};

/* a page: o.script / o.weights the delay of a script / of a weights file (default 5 / 12 ms), o.ms[file] one file's own, fail: a Set of the scripts that fail while it holds them */
function makePage(o) {
  o = o || {};
  const win = {}, fail = new Set(), reqs = [], runs = [], queue = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pump = () => {
    while (queue.length && queue[0].state !== 'loading') {
      const e = queue.shift();
      if (e.state === 'failed') { e.el.onerror(); continue; }
      RUN[e.src](win); runs.push(e.src);
      e.el.onload();
    }
  };
  const document = { createElement: () => ({}), head: { appendChild: el => {
    const src = el.src.replace(/^\.\//, '').replace(/\?.*$/, '');
    assert.equal(el.async, false, src + ': the script is added with async false (executed in the order added)');
    reqs.push(src);
    const e = { el, src, state: 'loading' };
    queue.push(e);
    wait((o.ms && o.ms[src]) || o.script || 5).then(() => { e.state = fail.has(src) ? 'failed' : 'loaded'; pump(); });
  } } };
  const fetch = async url => {
    const f = url.replace(/^\.\//, '').replace(/\?.*$/, '');
    reqs.push(f);
    await wait((o.ms && o.ms[f]) || o.weights || 12);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(WEIGHTS_JSON[f])) };
  };
  /* This harness exercises the rec loaders after the eager notation core is ready. */
  const api = new Function('window', 'document', 'fetch', 'scoreModulesReady', '_scoreModulesPromise', SRC)(win, document, fetch, () => true, null);
  return Object.assign({ win, reqs, runs, fail, wait }, api);
}
const count = (list, f) => list.filter(x => x === f).length;
const timed = async (p, name) => { const t0 = Date.now(); const v = await p; return { name, v, ms: Date.now() - t0 }; };
const V2_FILES = ['rec/attacks.js', 'rec/beats.js', 'rec/model.js', 'rec/metre.js', 'rec/hands.js', 'rec/index.js', 'rec/grid.js', 'rec/voices.js', 'rec/rests.js', 'rec/writer.js', 'rec/key.js', 'rec/pedal.js', 'rec/app.js'];

test('the lead sheet\'s loader and v2\'s, started together in either order or one during the other\'s weights fetch, both say true, at once, and ask for every file once', async () => {
  for (const [name, start] of [
    ['v2 then lead (the same moment)', async p => [timed(p.loadRecordingModules(), 'rec'), timed(p.loadLeadsheetModule(), 'lead')]],
    ['lead then v2 (the same moment)', async p => [timed(p.loadLeadsheetModule(), 'lead'), timed(p.loadRecordingModules(), 'rec')]],
    ['v2, then the lead sheet during its weights fetch', async p => { const a = timed(p.loadRecordingModules(), 'rec'); await p.wait(3); return [a, timed(p.loadLeadsheetModule(), 'lead')]; }],
    ['v2, then the lead sheet after its weights, while its scripts load', async p => { const a = timed(p.loadRecordingModules(), 'rec'); await p.wait(45); return [a, timed(p.loadLeadsheetModule(), 'lead')]; }],
    ['lead, then v2 during the lead sheet\'s model fetch', async p => { const a = timed(p.loadLeadsheetModule(), 'lead'); await p.wait(3); return [a, timed(p.loadRecordingModules(), 'rec')]; }],
    ['lead, then v2 while the lead sheet\'s scripts load', async p => { const a = timed(p.loadLeadsheetModule(), 'lead'); await p.wait(45); return [a, timed(p.loadRecordingModules(), 'rec')]; }]
  ]) {
    const p = makePage({ script: 40, weights: 30 });   /* slow enough for one loader to start while the other is mid-way */
    const res = await Promise.all(await start(p));
    res.forEach(r => { assert.equal(r.v, true, name + ': ' + r.name + ' resolves true'); assert.ok(r.ms < 1000, name + ': ' + r.name + ' did not wait for a timeout (' + r.ms + ' ms)'); });
    assert.equal(p.recordingModulesReady(), true, name + ': v2 is ready');
    assert.ok(p.win.PPPRecLeadsheet, name + ': the lead sheet is there');
    for (const f of V2_FILES.concat(['rec/leadsheet.js'])) assert.equal(count(p.reqs, f), 1, name + ': ' + f + ' asked for once');
    for (const f of Object.keys(WEIGHTS_JSON)) assert.equal(count(p.reqs, f), 1, name + ': ' + f + ' fetched once');
    for (const f of V2_FILES.concat(['rec/leadsheet.js'])) assert.equal(count(p.runs, f), 1, name + ': ' + f + ' ran once');
    assert.ok(p.runs.indexOf('rec/grid.js') < p.runs.indexOf('rec/leadsheet.js') && p.runs.indexOf('rec/writer.js') < p.runs.indexOf('rec/leadsheet.js'), name + ': the lead sheet ran after the two files it reads');
    assert.equal(p.win.PPPRecLeadsheet.WR, p.win.PPPRecWriter, name + ': it holds the writer');
    assert.equal(p.win.PPPRecLeadsheet.RG, p.win.PPPRecGrid, name + ': it holds the grid');
    assert.ok(p.win.PPPRecGrid.model, name + ': the grid read its model when it ran');
  }
});

test('the lead sheet alone asks for four files and nothing else of v2; v2 after it asks for the rest only', async () => {
  const p = makePage();
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.deepEqual(p.reqs, ['rec/weights/ai5b-grid-v1.json', 'rec/grid.js', 'rec/writer.js', 'rec/leadsheet.js']);
  assert.equal(p.recordingModulesReady(), false);
  assert.equal(await p.loadRecordingModules(), true);
  const all = p.reqs.slice(4);
  assert.equal(all.filter(f => /^rec\//.test(f) && !/weights/.test(f)).length, 11, 'the 11 other files');
  for (const f of ['rec/grid.js', 'rec/writer.js', 'rec/leadsheet.js']) assert.equal(count(p.reqs, f), 1, f + ' not asked for again');
  assert.equal(count(p.reqs, 'rec/weights/ai5b-grid-v1.json'), 1, 'the model is fetched once');
  assert.equal(p.recordingModulesReady(), true);
});

test('v2 first, then the lead sheet: v2 asks for the rest only', async () => {
  const p = makePage();
  assert.equal(await p.loadRecordingModules(), true);
  const n = p.reqs.length;
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.deepEqual(p.reqs.slice(n), ['rec/leadsheet.js'], 'only the lead sheet itself');
  assert.equal(p.win.PPPRecLeadsheet.WR, p.win.PPPRecWriter);
});

test('a lead sheet on the page with its files is not asked for again; with a file it read gone, it is, with that file', async () => {
  const p = makePage();
  assert.equal(await p.loadLeadsheetModule(), true);
  const n = p.reqs.length;
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.equal(p.reqs.length, n, 'nothing asked for');
  /* the writer is gone from the page (a half-loaded state): the module is not "there" any more */
  delete p.win.PPPRecWriter; p.loaded.delete('rec/writer.js');
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.deepEqual(p.reqs.slice(n), ['rec/writer.js', 'rec/leadsheet.js'], 'the writer, and the lead sheet again so that it holds it');
  assert.equal(p.win.PPPRecLeadsheet.WR, p.win.PPPRecWriter, 'and it holds the new one');
  assert.ok(p.win.PPPRecWriter);
});

test('rec/writer.js fails once: no lead sheet is left on the page, and the next load asks for the writer and the lead sheet, which holds the writer', async () => {
  const p = makePage();
  p.fail.add('rec/writer.js');
  assert.equal(await p.loadLeadsheetModule(), false, 'the first load says no');
  assert.equal(p.win.PPPRecLeadsheet, undefined, 'and leaves no lead sheet that ran with no writer');
  assert.equal(p.win.PPPRecWriter, undefined);
  assert.equal(p.win.PPPRecGrid !== undefined, true, 'the grid that did load stays');
  const n = p.reqs.length;
  p.fail.delete('rec/writer.js');
  assert.equal(await p.loadLeadsheetModule(), true, 'the next load makes it');
  assert.deepEqual(p.reqs.slice(n), ['rec/writer.js', 'rec/leadsheet.js'], 'asking for the writer and the lead sheet, not the grid, not the model');
  assert.equal(p.win.PPPRecLeadsheet.WR, p.win.PPPRecWriter, 'the lead sheet holds the writer');
  assert.ok(p.win.PPPRecLeadsheet.WR, 'a writer');
  assert.equal(p.win.PPPRecLeadsheet.RG, p.win.PPPRecGrid);
  assert.equal(count(p.reqs, 'rec/grid.js'), 1);
});

test('rec/grid.js fails once: no lead sheet that would write another lead sheet with no grid; the next load asks for the grid and the lead sheet', async () => {
  const p = makePage();
  p.fail.add('rec/grid.js');
  assert.equal(await p.loadLeadsheetModule(), false);
  assert.equal(p.win.PPPRecLeadsheet, undefined, 'no lead sheet that ran with no grid');
  const n = p.reqs.length;
  p.fail.delete('rec/grid.js');
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.deepEqual(p.reqs.slice(n), ['rec/grid.js', 'rec/leadsheet.js']);
  assert.ok(p.win.PPPRecLeadsheet.RG && p.win.PPPRecLeadsheet.RG === p.win.PPPRecGrid, 'the lead sheet holds the grid');
  assert.ok(p.win.PPPRecLeadsheet.WR, 'and the writer');
});

test('rec/leadsheet.js itself fails once: nothing of it is left, the next load asks for it alone', async () => {
  const p = makePage();
  p.fail.add('rec/leadsheet.js');
  assert.equal(await p.loadLeadsheetModule(), false);
  assert.equal(p.win.PPPRecLeadsheet, undefined);
  const n = p.reqs.length;
  p.fail.delete('rec/leadsheet.js');
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.deepEqual(p.reqs.slice(n), ['rec/leadsheet.js']);
});

test('the model that is not the model: no lead sheet, and nothing of the scripts is asked for', async () => {
  const p = makePage();
  const K = 'rec/weights/ai5b-grid-v1.json', keep = WEIGHTS_JSON[K];
  WEIGHTS_JSON[K] = { not: 'the model' };
  try {
    assert.equal(await p.loadLeadsheetModule(), false);
    assert.deepEqual(p.reqs, [K]);
    assert.equal(p.win.PPPRecLeadsheet, undefined);
  } finally { WEIGHTS_JSON[K] = keep; }
});

test('both loaders on their way and the writer failing: both say no, no lead sheet; then the lead sheet alone and then v2 make it, asking for the writer once each time', async () => {
  const p = makePage();
  p.fail.add('rec/writer.js');
  const res = await Promise.all([p.loadRecordingModules(), p.loadLeadsheetModule()]);
  assert.deepEqual(res, [false, false]);
  assert.equal(p.win.PPPRecLeadsheet, undefined);
  assert.equal(p.error(), 'rec/writer.js', 'v2 names the file');
  assert.equal(count(p.reqs, 'rec/writer.js'), 1, 'asked for once for the two loaders');
  p.fail.delete('rec/writer.js');
  assert.equal(await p.loadLeadsheetModule(), true);
  assert.equal(count(p.reqs, 'rec/writer.js'), 2, 'asked for again, once');
  assert.equal(p.win.PPPRecLeadsheet.WR, p.win.PPPRecWriter);
  assert.equal(await p.loadRecordingModules(), true);
  assert.equal(count(p.reqs, 'rec/writer.js'), 2, 'v2 did not ask for it again');
  assert.equal(count(p.reqs, 'rec/grid.js'), 1);
  assert.equal(p.recordingModulesReady(), true);
});

test('the page\'s source: neither loader waits for the other', () => {
  const lead = between('function loadLeadsheetModule() {', '/* is this request one the lead sheet may make?');
  assert.equal(lead.indexOf('_recPromise'), -1, 'the lead sheet\'s loader does not wait for v2\'s');
  const rec = between('function loadRecordingModules() {', 'function loadRecApp()');
  assert.equal(rec.indexOf('_leadPromise'), -1, 'v2\'s does not wait for the lead sheet\'s: a wait each way is a deadlock');
});
