/* Extracts the app's G08b glue (window.PPP.arranger, realizeWithG8, graphToReviewScore) so it
   can be tested directly with real G8a modules, without a browser - the same technique
   tests/playability/score-arranger-extract.js and tests/engrave/helpers.js's appFinalize()
   already use for exactly this reason: this reads the app file to test it, it never writes to
   it, and nothing here is loaded by the app itself except by <script> tag at runtime.

   realizeWithG8/graphToReviewScore close over four names that are globals/args in the app
   (`window`, `tx`, `Score`, `loadArrangerReference`) - supplied here as real Node-side
   equivalents: `window.PPPSongGraph/PPPArrangement/PPPRealize` are the same UMD modules'
   real Node `require()` exports (byte-identical code path to what <script> loads in the
   browser - confirmed separately by a vm-based browser-load smoke check, not assumed here);
   `Score.finalize` is tests/engrave/helpers.js's own appFinalize() (the app's real
   finalize, already an established extraction reused across this codebase); `tx` is an
   identity stub (graphToReviewScore only ever calls it with a plain string, no interpolation);
   `loadArrangerReference` is a Node-side stand-in for the app's lazy `fetch()` (which does not
   exist in Node) returning the SAME two real committed files the app fetches. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { appFinalize } = require('../engrave/helpers.js');

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const line = name => {
    const m = new RegExp('^(?:let|const) ' + name + ' = .*$', 'm').exec(html);
    if (!m) throw new Error('app-arranger extraction: ' + name + ' not found');
    return m[0] + '\n';
  };
  const fn = (name, isAsync) => {
    const marker = '\n' + (isAsync ? 'async function ' : 'function ') + name + '(';
    const i = html.indexOf(marker);
    if (i < 0) throw new Error('app-arranger extraction: function ' + name + ' not found');
    const end = html.indexOf('\n}\n', i);
    if (end < 0) throw new Error('app-arranger extraction: function ' + name + ' has no clean end');
    return html.slice(i + 1, end + 2);
  };
  const body =
    line('ARRANGER_LEVEL_TO_STAGE') +
    line('ARRANGER_HAND_PROFILES') +
    fn('realizeWithG8', true) +
    fn('graphToReviewScore', false) +
    'return { realizeWithG8: realizeWithG8, graphToReviewScore: graphToReviewScore, ' +
    'ARRANGER_LEVEL_TO_STAGE: ARRANGER_LEVEL_TO_STAGE, ARRANGER_HAND_PROFILES: ARRANGER_HAND_PROFILES };';
  return new Function('window', 'tx', 'Score', 'loadArrangerReference', body);
}

let cached = null;
function appArranger() {
  if (cached) return cached;
  const factory = extract();
  const window_ = {
    PPPSongGraph: require(path.join(REPO, 'songgraph/index.js')),
    PPPArrangement: require(path.join(REPO, 'arrangement/index.js')),
    PPPRealize: require(path.join(REPO, 'realize/index.js')),
    PPPScoreGraphModules: {
      legacyScore: require(path.join(REPO, 'scoregraph/legacy-score.js')),
      pitch: require(path.join(REPO, 'scoregraph/pitch.js'))
    }
  };
  const tx = s => s;
  const Score = { finalize: appFinalize() };
  const weights = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
  const dataset = require(path.join(REPO, 'difficulty/tools/dataset/method-books.json'));
  const loadArrangerReference = () => Promise.resolve({ weights: weights, dataset: dataset });
  cached = factory(window_, tx, Score, loadArrangerReference);
  return cached;
}

module.exports = { appArranger, REPO };
