/* The app's own difficulty heuristics, extracted verbatim so G6a can measure the REAL legacy baseline
   (docs/GOALS/G06_DIFFICULTY.md §1, §5, §10) instead of a paraphrase of it: `Score.finalize` (App 3560),
   which calls `Score.deriveSections` (App 3668) exactly as the app does for every imported score
   (App 3615: `if (!score.sections || !score.sections.length) score.sections = Score.deriveSections(score)`),
   and `Coach.structural` (App 8005), which reads those sections.

   Same technique, and same placement, as G5b's tests/playability/legacy-fingering-extract.js and G4's
   tests/engrave/helpers.js appFinalize(): read the app file, slice out the named top-level objects by their
   source-text boundaries, evaluate them in a Function with the few single-line globals they need. Nothing is
   re-implemented and the app file is never written. Not loaded by the app.

   Pulled whole: `const Score = {...}` (App 3559-3768) and `const Coach = {...}` (App 7841-8341). An object
   literal's methods run only when called, so bringing the siblings along costs nothing and keeps every helper
   deriveSections/structural call (Score.notesIn/first/last/startQ/endQ/measure) the app's own. The only thing
   evaluated at construction is Coach's `COACH: COACH` data property (App 7842, the plan tunables); structural()
   never reads it, which this file checks rather than assumes (see STRUCTURAL_READS_COACH below). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const APP = path.join(REPO, 'Piano Coach App.dc.html');

function objectLiteral(html, name) {
  const start = html.indexOf('\nconst ' + name + ' = {\n');
  if (start < 0) throw new Error('const ' + name + ' = {...} not found in the app file');
  const end = html.indexOf('\n};\n', start);
  if (end < 0) throw new Error('const ' + name + ' = {...} has no closing "};" at column 0');
  return html.slice(start + 1, end + 3);
}

let cached = null;
function legacyDifficulty() {
  if (cached) return cached;
  const html = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
  const line = name => {
    const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(html);
    if (!m) throw new Error('legacy difficulty extraction: const ' + name + ' not found');
    return m[0] + '\n';
  };
  /* a top-level function: one line (`function clampN(v, a, b) { return ...; }`) or a block closed by `}` at column 0 */
  const fn = name => {
    const i = html.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('legacy difficulty extraction: function ' + name + ' not found');
    const eol = html.indexOf('\n', i + 1);
    const first = html.slice(i + 1, eol);
    if (/\}\s*$/.test(first)) return first + '\n';
    return html.slice(i + 1, html.indexOf('\n}\n', i) + 3);
  };
  const scoreSrc = objectLiteral(html, 'Score');
  const coachSrc = objectLiteral(html, 'Coach');
  ['finalize(score) {', 'deriveSections(score, chunk) {', 'notesIn(score, from, to) {'].forEach(sig => {
    if (scoreSrc.indexOf(sig) < 0) throw new Error('Score.' + sig + ' is not inside the extracted Score object');
  });
  const sIdx = coachSrc.indexOf('\n  structural(score) {');
  if (sIdx < 0) throw new Error('Coach.structural is not inside the extracted Coach object');
  const structuralSrc = coachSrc.slice(sIdx, coachSrc.indexOf('\n  },\n', sIdx));
  if (/\bCOACH\b/.test(structuralSrc)) throw new Error('Coach.structural now reads COACH: the {} stub below is no longer safe');

  const body =
    line('STEP_SEMI') + line('PITCH_RE') + fn('pitchToMidi') + fn('shiftPitchOctave') + fn('ottavaSemitones') +
    fn('clampN') + fn('pctOf') +
    'const COACH = {};\n' + scoreSrc + coachSrc +
    'return { finalize: s => Score.finalize(s), deriveSections: (s, c) => Score.deriveSections(s, c), ' +
    'structural: s => Coach.structural(s) };';
  cached = new Function(body)();
  return cached;
}

/* The Score the app holds for an imported graph (App 4569/4590/7609: Score.finalize(legacy.toScore(graph))),
   with the sections the app itself derives. */
function appScoreOf(SG, graph, name) {
  return legacyDifficulty().finalize(SG.legacy.toScore(graph, { name: name || 'g6a', id: 'g6a:' + (name || graph.id) }));
}

module.exports = { legacyDifficulty, appScoreOf, APP };
