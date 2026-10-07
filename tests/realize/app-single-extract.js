/* Extracts the app's G9e-lite glue (window.PPP.arranger's setter, singleRoute, arrangeSingleNote, SINGLE_SCRIPTS, graphToReviewScore)
   so it can be tested without a browser, the same technique tests/realize/app-arranger-extract.js uses for the G8b glue: this reads the
   app file to test it and never writes to it.

   `make({ window, ... })` closes the extracted functions over the names they use in the page: `window` (the object holding PPPSongGraph,
   PPPArrangement, PPPCandidates, PPPRepair, PPPCriticsModules, PPPRealizeModules, PPPArrangementModules, PPPScoreGraphModules), `Score`
   (appFinalize), `loadArrangerReference`, `loadSingleModules` (the page loads scripts; here the modules are already in `window`) and
   `singleTick`. Two windows are used by the tests: one made of the Node `require()` exports, and one made by loading the page's own
   <script> files in a bare `vm` context (no require, no module), which is what the browser runs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..', '..');
const { appFinalize } = require('../engrave/helpers.js');

function appHtml() { return fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n'); }

function extractSource() {
  const html = appHtml();
  const line = name => {
    const m = new RegExp('^(?:let|const) ' + name + ' = .*$', 'm').exec(html);
    if (!m) throw new Error('app-single extraction: ' + name + ' not found');
    return m[0] + '\n';
  };
  const fn = (name, isAsync) => {
    const marker = '\n' + (isAsync ? 'async function ' : 'function ') + name + '(';
    const i = html.indexOf(marker);
    if (i < 0) throw new Error('app-single extraction: function ' + name + ' not found');
    if (html.slice(i + 1).split('\n', 1)[0].endsWith('}')) return html.slice(i + 1, html.indexOf('\n', i + 1) + 1); /* a one-line function */
    const end = html.indexOf('\n}\n', i);
    if (end < 0) throw new Error('app-single extraction: function ' + name + ' has no clean end');
    return html.slice(i + 1, end + 2);
  };
  /* the SINGLE_SCRIPTS array literal, as written in the app */
  const scripts = /const SINGLE_SCRIPTS = \[[\s\S]*?\n\];\n/.exec(html);
  if (!scripts) throw new Error('app-single extraction: SINGLE_SCRIPTS not found');
  /* the PPP.arranger accessor pair, as written in the app */
  const acc = /get arranger\(\) \{ return ARRANGER_MODE; \},\n\s*set arranger\(v\) \{[^\n]*\},/.exec(html);
  if (!acc) throw new Error('app-single extraction: PPP.arranger accessor not found');
  return {
    body:
      line('ARRANGER_LEVEL_TO_STAGE') + line('ARRANGER_HAND_PROFILES') + line('ARRANGER_MODE') + /* the app's own default, not a copy of it */
      scripts[0] +
      'const SINGLE_CACHE = new Map();\n' + line('SINGLE_CACHE_MAX') +
      fn('singleRoute', false) + fn('arrangeSingleNote', true) + fn('graphToReviewScore', false) +
      'const PPP = { ' + acc[0] + ' };\n' +
      'return { arrangeSingleNote, graphToReviewScore, singleRoute, SINGLE_SCRIPTS, SINGLE_CACHE, PPP, ' +
      'ARRANGER_LEVEL_TO_STAGE, ARRANGER_HAND_PROFILES, setMode: v => { ARRANGER_MODE = v; }, getMode: () => ARRANGER_MODE };',
    scripts: scripts[0]
  };
}

/* the app's reference loaders (G6a weights + method-books dataset), closed over a stub `fetch` */
function makeReferenceLoader(fetchStub) {
  const html = appHtml();
  const line = name => { const m = new RegExp('^(?:let|const) ' + name + ' = .*$', 'm').exec(html); if (!m) throw new Error('not found: ' + name); return m[0] + '\n'; };
  const fn = name => { const i = html.indexOf('\nfunction ' + name + '('); const end = html.indexOf('\n}\n', i); if (i < 0 || end < 0) throw new Error('not found: ' + name); return html.slice(i + 1, end + 2); };
  const body = line('DIFFICULTY_WEIGHTS') + line('_difficultyWeightsPromise') + fn('loadDifficultyWeights') + line('ARRANGER_REFERENCE') + line('_arrangerReferencePromise') + fn('loadArrangerReference') +
    'return { loadArrangerReference, loadDifficultyWeights };';
  return new Function('fetch', body)(fetchStub);
}

function make(deps) {
  const src = extractSource();
  const factory = new Function('window', 'tx', 'Score', 'loadArrangerReference', 'loadSingleModules', 'singleTick', src.body);
  return factory(deps.window, s => s, deps.Score || { finalize: appFinalize() }, deps.loadArrangerReference, deps.loadSingleModules || (() => Promise.resolve(true)), deps.singleTick || (() => Promise.resolve()));
}

function reference() {
  return {
    weights: require(path.join(REPO, 'difficulty/weights/g6a-v1.json')),
    dataset: require(path.join(REPO, 'difficulty/tools/dataset/method-books.json'))
  };
}

/* a window of the Node require() exports (the modules the pipeline needs, by the browser globals' names) */
function nodeWindow() {
  const R = p => require(path.join(REPO, p));
  return {
    PPPSongGraph: R('songgraph/index.js'), PPPArrangement: R('arrangement/index.js'),
    PPPCandidates: R('candidates/index.js'), PPPRepair: R('repair/index.js'),
    PPPCriticsModules: { metrics: R('critics/metrics.js') },
    PPPArrangementModules: { reference: R('arrangement/reference.js') },
    PPPRealizeModules: { ottava: R('realize/ottava.js'), clefs: R('realize/clefs.js') },
    PPPScoreGraphModules: { serialize: R('scoregraph/serialize.js'), legacyScore: R('scoregraph/legacy-score.js'), pitch: R('scoregraph/pitch.js') },
    PPPRecLeadsheet: R('rec/leadsheet.js') /* G10c-1a: the lead sheet of a recording (plan.recordingArrange 'leadsheet'); the page loads it from G10c-1b on */
  };
}

/* The page's own scripts, in the page's own order, in a bare vm context: no require, no module, no document. The list is read from the
   app's <script src> tags (the G8 modules it loads up front) followed by the app's own SINGLE_SCRIPTS (what it loads on first use).
   G10c-1b: and what a lead sheet of a recording needs on the page, in the order loadLeadsheetModule asks for it and nothing more: LEADSHEET_MODEL (the grid weights, a window global rec/grid.js reads when
   it loads), LEADSHEET_NEEDS (rec/grid.js, rec/writer.js) and LEADSHEET_SCRIPT (rec/leadsheet.js), all read from the app's own source; none of them is in the up-front list or in SINGLE_SCRIPTS (rec/grid.js and
   rec/writer.js are two of RECORDING_SCRIPTS' thirteen as well, shared with that loader): a bare vm context that holds exactly this set gives the lead sheet Node gives (tests/rec/leadsheet.test.js). */
function scriptListOfPage() {
  const html = appHtml();
  const head = [...html.matchAll(/<script src="\.\/([^"?]+)(?:\?v=\d+)?"><\/script>/g)].map(m => m[1]);
  const single = [...extractSource().scripts.matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
  const recArr = /const RECORDING_SCRIPTS = \[([\s\S]*?)\];/.exec(html);
  const lead = /^const LEADSHEET_SCRIPT = '([^']+)';/m.exec(html);
  const needs = /^const LEADSHEET_NEEDS = \[([^\]]*)\];/m.exec(html);
  const model = /^const LEADSHEET_MODEL = \['(\w+)', '([^']+)'\];/m.exec(html);
  if (!recArr || !lead || !needs || !model) throw new Error('app-single extraction: RECORDING_SCRIPTS, LEADSHEET_SCRIPT, LEADSHEET_NEEDS or LEADSHEET_MODEL not found');
  return {
    head: head, single: single,
    rec: [...recArr[1].matchAll(/'([^']+\.js)'/g)].map(m => m[1]),
    leadNeeds: [...needs[1].matchAll(/'([^']+\.js)'/g)].map(m => m[1]),
    leadModel: [model[1], model[2]],
    lead: lead[1]
  };
}
function browserWindow() {
  const { head, single, leadNeeds, leadModel, lead } = scriptListOfPage();
  const ctx = vm.createContext({ console });
  ctx.window = ctx; ctx.globalThis = ctx;
  const run = p => {
    try { vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), ctx, { filename: p }); }
    catch (e) { throw new Error('bare vm load of ' + p + ' failed: ' + e.message); }
  };
  head.filter(p => /^(scoregraph|playability|difficulty|songgraph|arrangement|realize)\//.test(p)).concat(single).forEach(run);
  /* the model as a window global first (the page sets it from its fetch), then the files the lead sheet reads, then the lead sheet */
  ctx[leadModel[0]] = JSON.parse(fs.readFileSync(path.join(REPO, leadModel[1]), 'utf8'));
  leadNeeds.concat([lead]).forEach(run);
  return ctx;
}

module.exports = { make, makeReferenceLoader, reference, nodeWindow, browserWindow, scriptListOfPage, extractSource, REPO, appFinalize };
