/* Extracts the app's own `Fingering` DP (App 8337-8775) so its unmodified output can be measured
   against the printed-fingering set alongside G5b's port (docs/GOALS/G05 §11 G5b) - the same technique
   tests/engrave/helpers.js's appFinalize() and score-arranger-extract.js's scoreArranger() already use,
   and for the same reason: this reads the app file to test it, never writes to it, and nothing here is
   loaded by the app itself (playability/ is Node-only, G05 §9).

   `Fingering`'s own closure needs four small globals that live earlier in the same file: `SCORE_HAND_HOLD_Q`
   and `scoreNoteEnd` (App 8306-8307, the hand-guide's minimum visual hold - only `plan()`'s tie handling
   calls it) and `KEY_POS`/`KEY_BLACK` (App 8334-8335, keyboard geometry). All four are plain, single-line
   consts with no further dependency. */
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO } = require('../engrave/helpers.js');

let cached = null;
function appFingering() {
  if (cached) return cached;
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const line = name => {
    const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(html);
    if (!m) throw new Error('Fingering extraction: ' + name + ' not found');
    return m[0] + '\n';
  };
  const a = html.indexOf('\nconst Fingering = {');
  const z = html.indexOf('\n};\n', a);
  if (a < 0 || z < a) throw new Error('Fingering is not where it was (App 8337-8775)');
  const body = line('SCORE_HAND_HOLD_Q') + line('scoreNoteEnd') + line('KEY_POS') + line('KEY_BLACK') +
    html.slice(a + 1, z + 2) + '\nreturn Fingering;';
  cached = new Function(body)();
  return cached;
}

module.exports = { appFingering };
