/* ============================================================================
   G10b-6: the QR encoder inside the page (qrMatrix, between the markers /* QR-BEGIN *\/ and /* QR-END *\/ of "Piano Coach App.dc.html") - byte mode, error correction M, versions 1-10.

   It draws the pairing link for a phone without a library and without a network request. Node only: the function is cut out of the page and run here.
     - the version follows the length exactly (14 / 26 / 42 / 62 / 84 / 106 / 122 / 152 / 180 / 213 bytes), 214 does not fit (null)
     - the structure: the three finder patterns with their white borders, the timing patterns, the dark module, the format information (both copies equal, a valid BCH code, level M, a mask
       0-7) and, from version 7, the version information (both copies, valid BCH)
     - fixed texts give fixed pictures (a hash of the matrix of each): the hashes below were checked by DECODING the pictures with an independent decoder (OpenCV's QRCodeDetector; also every length
       from 1 to 213 bytes, twice, on random texts) when the encoder was written - a change to the encoder that is not a mistake has to be re-checked the same way, then the hashes updated

   node tests/home-worker/qr.test.js */
'use strict';
const L = require('./lib');
const { ok, heading } = L;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = fs.readFileSync(path.join(L.MODS, 'Piano Coach App.dc.html'), 'utf8');
const a = src.indexOf('/* QR-BEGIN */'), b = src.indexOf('/* QR-END */');
if (a < 0 || b < a) { console.error('the QR markers are not in the page'); process.exit(1); }
const qrMatrix = new Function(src.slice(a, b) + '; return qrMatrix;')();
const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const fill = n => { let t = ''; const al = 'abcdef0123456789'; for (let i = 0; i < n; i++) t += al[(i * 7 + (i >> 3)) % 16]; return t; };
const hash = m => crypto.createHash('sha256').update(m.map(r => r.join('')).join('\n')).digest('hex').slice(0, 16);
const GOLD = {
  'v1 max': ['', 14, '72863a791f5f9793'], 'v2 max': ['', 26, '7ae4d1e3c32cfc9b'], 'v3 max': ['', 42, 'cc4b0cda2915dbb4'], 'v4 max': ['', 62, 'a5a5cfa77d81ba9c'], 'v5 max': ['', 84, '9f70c8cd913aba85'],
  'v6 max': ['', 106, '86eb1a8677efc5a2'], 'v7 max': ['', 122, '8c4f3aa8083abc8b'], 'v8 max': ['', 152, '493c3eff00535949'], 'v9 max': ['', 180, 'dfad1db6a0cf5fe1'], 'v10 max': ['', 213, '2afb96a304fdb3f0'],
  'v2 min': ['', 15, 'd82c4dffe387d9a1']
};
const bch = (value, poly, bits, top) => { let r = value; for (let i = 0; i < bits; i++) r = (r << 1) ^ ((r >>> top) * poly); return r; };

heading('the version follows the length');
CAP.forEach((c, i) => {
  const m = qrMatrix(fill(c));
  ok(c + ' bytes: version ' + (i + 1) + ' (' + (17 + 4 * (i + 1)) + ' x ' + (17 + 4 * (i + 1)) + ' modules), a square of 0 and 1', m && m.length === 17 + 4 * (i + 1) && m.every(r => r.length === m.length && r.every(v => v === 0 || v === 1)));
  const next = qrMatrix(fill(c + 1));
  ok((c + 1) + ' bytes: ' + (i + 1 < 10 ? 'version ' + (i + 2) : 'does not fit (null)'), i + 1 < 10 ? next && next.length === 17 + 4 * (i + 2) : next === null);
});
ok('a text that is not a string is made one; an empty text is a version 1 code; the same text twice gives the same picture', qrMatrix(12345).length === 21 && qrMatrix('').length === 21 && JSON.stringify(qrMatrix('abc')) === JSON.stringify(qrMatrix('abc')) && JSON.stringify(qrMatrix('abc')) !== JSON.stringify(qrMatrix('abd')));
ok('UTF-8 is counted in bytes: 40 Korean letters are 120 bytes, a version 7 code', qrMatrix('한'.repeat(40)).length === 45);

heading('the structure of every version');
for (let v = 1; v <= 10; v++) {
  const m = qrMatrix(fill(CAP[v - 1])), n = m.length;
  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const want = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)) ? 1 : 0;
      if (m[r][c] !== want) return false;
    }
    return true;
  };
  let timing = true;
  for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0 ? 1 : 0) || m[i][6] !== (i % 2 === 0 ? 1 : 0)) timing = false;
  const bit = (value, i) => (value >>> i) & 1;
  const read1 = () => { let f = 0; const pos = []; for (let i = 0; i <= 5; i++) pos.push([i, 8]); pos.push([7, 8], [8, 8], [8, 7]); for (let i = 9; i < 15; i++) pos.push([8, 14 - i]); pos.forEach((p, i) => { f |= m[p[0]][p[1]] << i; }); return f; };
  const read2 = () => { let f = 0; for (let i = 0; i < 8; i++) f |= m[8][n - 1 - i] << i; for (let i = 8; i < 15; i++) f |= m[n - 15 + i][8] << i; return f; };
  const f1 = read1(), f2 = read2(), dec = (f1 ^ 0x5412);
  const data = dec >>> 10;
  const fmtOk = f1 === f2 && ((data << 10) | bch(data, 0x537, 10, 9)) === dec && (data >>> 3) === 0 && (data & 7) <= 7;
  let verOk = true;
  if (v >= 7) {
    const want = (v << 12) | bch(v, 0x1F25, 12, 11);
    let a1 = 0, a2 = 0;
    for (let i = 0; i < 18; i++) { const x = n - 11 + (i % 3), y = Math.floor(i / 3); a1 |= m[y][x] << i; a2 |= m[x][y] << i; }
    verOk = a1 === want && a2 === want;
  }
  ok('version ' + v + ': three finder patterns with white borders, timing patterns, the dark module', finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0) && timing && m[n - 8][8] === 1);
  ok('version ' + v + ': the format information is in both places, valid, level M, a mask 0-7 (mask ' + (data & 7) + ')' + (v >= 7 ? ', and so is the version information' : ''), fmtOk && verOk);
}

heading('fixed texts, fixed pictures (checked by decoding them with an independent decoder)');
Object.keys(GOLD).forEach(k => {
  const g = GOLD[k];
  ok(k + ' (' + g[1] + ' bytes): ' + g[2], hash(qrMatrix(fill(g[1]))) === g[2], hash(qrMatrix(fill(g[1]))));
});
ok('a pairing link (https://ppp-web-2o99.onrender.com/#pc=<64 hex>, 102 bytes): version 6, b8fce17b4c2e6c17', (() => { const m = qrMatrix('https://ppp-web-2o99.onrender.com/#pc=' + 'a1b2c3d4'.repeat(8)); return m.length === 41 && hash(m) === 'b8fce17b4c2e6c17'; })());
ok('a link with Korean letters in its path (98 bytes): a04055e6212aeb24', hash(qrMatrix('https://example.com/한국어/#pc=' + '0123456789abcdef'.repeat(4))) === 'a04055e6212aeb24');
L.finish('the QR encoder of the page');
