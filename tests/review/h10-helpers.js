/* Shared helpers for the H-10 tests (tests/review/h10-*.test.js): small heard-notes fixtures, a heard folder, the leak scan. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, tmpDir, splitAudio, checkAudioBlob } = require('./helpers.js');

/* Heard notes of real Onsets & Frames runs on rendered public-domain scores (tests/bench/replay-of, committed by G10a-0): the same shape as the app's
   browser transcription. Nothing of the teacher's piece is used in the repository's tests. */
const FIXTURES = {
  nearer: 'tests/bench/replay-of/4fb73c6d8194.json',
  know: 'tests/bench/replay-of/4029d7d13cbd.json',
  notone: 'tests/bench/replay-of/11c4b15eccc9.json',
  gather: 'tests/bench/replay-of/1887a5b86760.json',
  fount: 'tests/bench/replay-of/2bfabaff0ea6.json',
  take: 'tests/bench/replay-of/643c14da13da.json',
  risen: 'tests/bench/replay-of/717fb41b2481.json',
  hail: 'tests/bench/replay-of/81d93bf749d7.json',
  holy: 'tests/bench/replay-of/82de5e245e39.json',
  joyful: 'tests/bench/replay-of/aa0360468d49.json',
  hark: 'tests/bench/replay-of/b9d6041dc18a.json'
};
const heardOf = name => JSON.parse(fs.readFileSync(path.join(REPO, FIXTURES[name]), 'utf8')).helper_result;

/* a folder like the collector's: items.json and <id>.json per item */
function heardDir(names, extra) {
  const dir = tmpDir('h10heard');
  const items = names.map(n => Object.assign({ id: n, url: 'https://www.youtube.com/watch?v=' + (n + 'xxxxxxxxxxx').slice(0, 11), title: 'Piece ' + n }, (extra && extra[n]) || {}));
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(items, null, 1));
  names.forEach(n => fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(heardOf(n))));
  return dir;
}

/* ---- the leak scan ----
   What a reader can see or a script can read must not say which score is v2 and which is classic, nor how a score was made, nor carry a version or a
   build stamp, nor the seed. Path data (d="...") is checked to be nothing but path characters and then left out (a glyph outline is numbers and the
   letters M L H V C S Q T A Z, "V2.5" is not a version); the piano recordings are checked by helpers.js splitAudio. Returns a list of problems.
   G10b-0: the word lists and the scanning functions live in review/lib/h10-leak.js (the engine comparison's builder uses them too); the engine comparison's extra
   vocabulary (browser, helper, engine, TransKun, Kong, ensemble, local ...) is passed as `opts.engine`. */
const LEAK = require(path.join(REPO, 'review/lib/h10-leak.js'));
const { WORDS, STAMPS, PATHDATA, scanText, withoutPathData } = LEAK;

/* html: the page; manifest: its text; drawings: { key: [wide, narrow] } from page-h10 drawingsOf; seed: the packet's secret; opts.engine: also the engine comparison's vocabulary */
function leakScan(html, manifest, drawings, seed, opts) {
  const engine = !!(opts && opts.engine), extraWords = engine ? LEAK.ENGINE_WORDS : [], whole = engine ? LEAK.ENGINE_WHOLE : [];
  const bad = [];
  const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
  if (html.indexOf(PAGE.CREDIT) < 0) bad.push('the piano credit is missing or changed');
  const parts = splitAudio(html.replace(PAGE.CREDIT, '<footer class="credit">[credit]</footer>'));   /* the credit names the recordings ("Piano V3"): checked here to be exactly the fixed text */
  if (parts.blob !== null) checkAudioBlob(parts.blob);
  /* the drawings travel packed inside svg-data: they are scanned below, unpacked, which covers every byte of them (the shared glyphs and the fragment list stay in the page scan) */
  const page = withoutPathData(parts.rest.replace(/(<script id="svg-data" type="application\/json">)[\s\S]*?(<\/script>)/, '$1[drawings]$2'));
  bad.push.apply(bad, page.bad);
  bad.push.apply(bad, scanText('the page', page.rest, (seed ? [seed] : []).concat(extraWords), whole));
  bad.push.apply(bad, scanText('the manifest', manifest, (seed ? [seed] : []).concat(extraWords), whole));
  Object.keys(drawings).forEach(k => drawings[k].forEach((svg, i) => {
    const d = withoutPathData(svg);
    bad.push.apply(bad, d.bad);
    bad.push.apply(bad, scanText('drawing ' + k + (i ? ' narrow' : ' wide'), d.rest, (seed ? [seed] : []).concat(extraWords), whole));
  }));
  return bad;
}

/* ---- G10b-0: the engine comparison's fixtures ----
   The "helper" notes of a fixture piece: a deterministic, helper-shaped file (the raw output of transcribe.py: notes with confidence, support and models, pedals, uncertain
   notes, an ensemble summary) that holds more notes than the browser's (a third above every fourth note) and lacks some (every ninth is kept apart as uncertain). Synthetic:
   nothing of the teacher's pieces is in the repository. */
function helperRaw(heard) {
  const notes = [], uncertain = [], models = ['piano-transcription', 'transkun'];
  heard.notes.forEach((n, i) => {
    if (i % 9 === 4) { uncertain.push({ on: n.on, off: n.off, midi: n.midi, vel: n.vel, confidence: 0.5, support: 1, models: ['piano-transcription'] }); return; }
    notes.push({ on: Math.round((n.on + 0.004) * 10000) / 10000, off: n.off, midi: n.midi, vel: n.vel, confidence: 1, support: 2, models: models });
    if (i % 4 === 0 && n.midi + 4 <= 100) notes.push({ on: Math.round((n.on + 0.003) * 10000) / 10000, off: n.off, midi: n.midi + 4, vel: 70, confidence: 1, support: 2, models: models });
  });
  return { engine: 'ensemble', model: 'TransKun V2 + Kong et al. (synthetic test fixture)', device: 'cpu', duration: heard.duration, ms: 1, notes: notes, pedals: [{ on: 1, off: 2 }, { on: 3, off: 4 }], uncertainNotes: uncertain,
    ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 1, accepted: notes.length, uncertain: uncertain.length, pedalSource: 'transkun' }, modelFailures: [] };
}
/* two folders like the collector's and review/h10/helper-heard.js's: the browser's heard notes and the helper's (converted), for the same pieces */
function heardDirs(names, extra) {
  const { convertHelperNotes } = require(path.join(REPO, 'review/h10/helper-heard.js'));
  const heard = heardDir(names, extra), heardB = tmpDir('h10helper');
  fs.copyFileSync(path.join(heard, 'items.json'), path.join(heardB, 'items.json'));
  names.forEach(n => fs.writeFileSync(path.join(heardB, n + '.json'), JSON.stringify(convertHelperNotes(helperRaw(heardOf(n))).heard)));
  return { heard: heard, heardB: heardB };
}

module.exports = { REPO, FIXTURES, heardOf, heardDir, heardDirs, helperRaw, leakScan, scanText, withoutPathData, WORDS, LEAK, tmpDir, os };
