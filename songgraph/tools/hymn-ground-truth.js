/* Hymn-SATB ground truth extraction, shared by songgraph/tools/hymn-eval.js (the reporting CLI) and
   tests/songgraph/hymn-corpus.test.js (the regression assertions), so the two can never quietly
   drift apart (design doc §4, §6). See hymn-eval.js's own header for what the ground truth is and
   why it is real, not invented. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const R = require(path.join(REPO, 'scoregraph', 'rational.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));

function hymnFiles() {
  return fs.readdirSync(path.join(REPO, 'catalog', 'hymns')).filter(f => f.endsWith('.musicxml')).sort();
}

/* {s, a, t, b} voice ids by Voice.label ('1' soprano, '2' alto, '5' tenor, '6' bass — the Finale
   convention these files use, confirmed against the raw MusicXML, not the 1/2/3/4 one might guess). */
function satbVoices(part) {
  const byLabel = {};
  part.voices.forEach(v => { byLabel[v.label] = v.id; });
  return { s: byLabel['1'], a: byLabel['2'], t: byLabel['5'], b: byLabel['6'] };
}

function pcAt(notes, voiceId, w) {
  if (!voiceId) return undefined;
  const here = notes.filter(n => n.voiceId === voiceId && R.le(n.w0, w) && R.gt(n.w1, w));
  return here.length ? here[0].pc : undefined;
}
function midiAt(notes, voiceId, w) {
  if (!voiceId) return undefined;
  const here = notes.filter(n => n.voiceId === voiceId && R.le(n.w0, w) && R.gt(n.w1, w));
  return here.length ? here[0].midi : undefined;
}

module.exports = { hymnFiles, satbVoices, pcAt, midiAt };
