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
   letters M L H V C S Q T A Z, "V2.5" is not a version); the piano recordings are checked by helpers.js splitAudio. Returns a list of problems. */
const WORDS = ['classic', 'legacy', 'fallback', 'pipeline', 'hmac', 'seed', 'exactbars', 'closegaps', 'audio-score', 'handsfallback', 'hands:', 'arranger', 'g9', 'g10', 'sha256', 'commit', 'recording:', 'rec/'];
const STAMPS = [/\bv\d+(\.\d+)*\b/i, /\bbuild\b/i];
const PATHDATA = /\sd="([^"]*)"/g;

function scanText(label, text, extra) {
  const bad = [];
  const low = text.toLowerCase();
  WORDS.concat(extra || []).forEach(w => {
    const at = low.indexOf(w.toLowerCase());
    if (at >= 0) bad.push(label + ' contains "' + w + '": ' + JSON.stringify(text.slice(Math.max(0, at - 30), at + 40)));
  });
  /* a word that names a way of writing (the plain words, so a class or an id cannot say it either) */
  STAMPS.forEach(re => { const m = re.exec(text); if (m) bad.push(label + ' has a version or build stamp ' + JSON.stringify(m[0]) + ' near ' + JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 40))); });
  return bad;
}
function withoutPathData(text) {
  const bad = [];
  const rest = text.replace(PATHDATA, (all, d) => { if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]*$/.test(d)) bad.push('path data holds more than path characters: ' + d.slice(0, 60)); return ' d=""'; });
  return { rest: rest, bad: bad };
}

/* html: the page; manifest: its text; drawings: { key: [wide, narrow] } from page-h10 drawingsOf; seed: the packet's secret */
function leakScan(html, manifest, drawings, seed) {
  const bad = [];
  const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
  if (html.indexOf(PAGE.CREDIT) < 0) bad.push('the piano credit is missing or changed');
  const parts = splitAudio(html.replace(PAGE.CREDIT, '<footer class="credit">[credit]</footer>'));   /* the credit names the recordings ("Piano V3"): checked here to be exactly the fixed text */
  if (parts.blob !== null) checkAudioBlob(parts.blob);
  /* the drawings travel packed inside svg-data: they are scanned below, unpacked, which covers every byte of them (the shared glyphs and the fragment list stay in the page scan) */
  const page = withoutPathData(parts.rest.replace(/(<script id="svg-data" type="application\/json">)[\s\S]*?(<\/script>)/, '$1[drawings]$2'));
  bad.push.apply(bad, page.bad);
  bad.push.apply(bad, scanText('the page', page.rest, seed ? [seed] : []));
  bad.push.apply(bad, scanText('the manifest', manifest, seed ? [seed] : []));
  Object.keys(drawings).forEach(k => drawings[k].forEach((svg, i) => {
    const d = withoutPathData(svg);
    bad.push.apply(bad, d.bad);
    bad.push.apply(bad, scanText('drawing ' + k + (i ? ' narrow' : ' wide'), d.rest, seed ? [seed] : []));
  }));
  return bad;
}

module.exports = { REPO, FIXTURES, heardOf, heardDir, leakScan, scanText, withoutPathData, WORDS, tmpDir, os };
