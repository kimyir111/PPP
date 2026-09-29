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

module.exports = { REPO, ITEMS, CACHE, tmpDir, readAll };
