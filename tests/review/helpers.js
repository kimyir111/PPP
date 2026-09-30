/* Shared helpers for tests/review/*.test.js (node --test). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

/* four small real corpus pieces (8-20 bars), each with a request G9 can reach; two of them (when-i-survey, gymnopedie-1) also have
   a distinct higher level, which the selection test relies on only through the documented rule, not through these numbers */
const ITEMS = [
  { file: 'catalog/gymnopedie-1.musicxml', targetLevel: 2.4, handProfile: 'large' },
  { file: 'catalog/hymns/when-i-survey.musicxml', targetLevel: 2.24, handProfile: 'large' },
  { file: 'catalog/hymns/nearer-my-god.musicxml', targetLevel: 2.4, handProfile: 'large' },
  { file: 'catalog/hymns/christ-arose.musicxml', targetLevel: 2.76, handProfile: 'large' }
];

/* one arrangement cache for the whole test process (arranging a piece takes about a second; the results are deterministic) */
const CACHE = new Map();

const made = [];
function tmpDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-review-test-' + tag + '-'));
  made.push(d);
  return d;
}
process.on('exit', () => { made.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }); });

function readAll(dir) {
  const out = {};
  fs.readdirSync(dir).sort().forEach(f => { out[f] = fs.readFileSync(path.join(dir, f)); });
  return out;
}

/* The page carries the app's piano recordings as one base64 block (<script id="piano-samples" type="application/json">). Word scans
   (the leak scan: "g9", "repair", "pattern", "seed" ...) must not read random base64, where a short word turns up by chance in 1.9 MB
   of it, so they read the page WITHOUT that block. It is safe to leave out because the block is checked here to be nothing but a JSON
   list of 30 base64 strings (a closed alphabet with no spaces, letters cannot form text a reviewer reads, and the page never shows
   it), each of which is an MP3 whose bytes are the repository's own recording for that key, the same 30 on every page. The scan
   therefore still covers every byte that a reviewer could read or that could carry a word: all of the rest of the file, and the
   block's shape and content. Returns { rest, blob } (rest has the block replaced by a fixed marker). */
const PIANO_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
const AUDIO_BLOCK = /<script id="piano-samples" type="application\/json">([\s\S]*?)<\/script>/;
function splitAudio(html) {
  const m = html.match(AUDIO_BLOCK);
  if (!m) return { rest: html, blob: null };
  return { rest: html.replace(AUDIO_BLOCK, '<script id="piano-samples">[audio block]</script>'), blob: m[1] };
}
/* the block is exactly the 30 repository recordings, in order, as base64 (throws an assertion message otherwise) */
function checkAudioBlob(blob) {
  const assert = require('node:assert/strict');
  assert.ok(/^\["[A-Za-z0-9+/=]+"(,"[A-Za-z0-9+/=]+"){29}\]$/.test(blob), 'the audio block is a JSON list of exactly 30 base64 strings and nothing else');
  const list = JSON.parse(blob);
  list.forEach((b64, k) => {
    const bytes = Buffer.from(b64, 'base64');
    const file = fs.readFileSync(path.join(REPO, 'audio', 'piano', PIANO_NAMES[k] + '.mp3'));
    assert.ok(bytes.equals(file), 'sample ' + k + ' (' + PIANO_NAMES[k] + ') is the repository recording');
    assert.ok((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), 'sample ' + k + ' is an MP3');
  });
  return list;
}

module.exports = { REPO, ITEMS, CACHE, tmpDir, readAll, splitAudio, checkAudioBlob, PIANO_NAMES };
