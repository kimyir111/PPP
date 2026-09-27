/* Extracts the app's in-page `ScoreArranger` (App 8977-9213) so its own, unmodified output can be run
   through the playability analyzer for the "legacy-arranger baseline" (docs/GOALS/G05 §3(d)) - the
   same technique tests/engrave/helpers.js's appFinalize() already uses for Score.finalize, and for the
   same reason: this reads the app file to test it, it never writes to it, and nothing here is loaded by
   the app itself (playability/ is Node-only, G05 §9).

   ScoreArranger's own closure needs three small globals that live elsewhere in the file: `midiName` and
   `typeFromQ` (pure formatting helpers, App 3471-3475 and 10688-10690) and `Score.finalize` (reused
   directly from tests/engrave/helpers.js's own extraction, so this file does not re-implement it). */
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO, appFinalize } = require('../engrave/helpers.js');

let cached = null;
function scoreArranger() {
  if (cached) return cached;
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const line = name => {
    const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(html);
    if (!m) throw new Error('ScoreArranger extraction: ' + name + ' not found');
    return m[0] + '\n';
  };
  const fn = name => {
    const i = html.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('ScoreArranger extraction: function ' + name + ' not found');
    return html.slice(i + 1, html.indexOf('\n}\n', i) + 2);
  };
  const a = html.indexOf('\nconst ScoreArranger = (() => {');
  const z = html.indexOf('\n})();', a);
  if (a < 0 || z < a) throw new Error('ScoreArranger is not where it was (App 8977-9213)');
  const body = line('NOTE_NAMES') + line('midiName') + line('Q_TYPE') + fn('typeFromQ') +
    'const Score = { finalize: __finalize, count: s => (s.measures||[]).length };\n' +
    html.slice(a + 1, z + 5) + '\n' +
    'return ScoreArranger;';
  const build = new Function('__finalize', body);
  cached = build(appFinalize());
  return cached;
}

module.exports = { scoreArranger };
