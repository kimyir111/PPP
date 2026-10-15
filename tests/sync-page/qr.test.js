/* G13-S1: sync/qr.js, the QR encoder the sync page draws its link with (no external service, nothing about the code leaves the page).

   Three kinds of check:
     - structure, read back by a reader written here from the standard and not from the encoder: the finder patterns, the timing lines, the dark module, the format word
       (a valid BCH word, and its second copy), the version word, and, after unmasking and reading the codewords in the zigzag, the Reed-Solomon codewords of every block
       (the syndromes are zero) and the bytes of the text;
     - golden symbols: the hash of the modules of ten texts, which were made once and decoded by jsQR (an independent reader) - a change of the encoder that changes a
       symbol fails here;
     - where jsQR can be required (PPP_JSQR=<path of the module>, or a `jsqr` that resolves), every symbol of every version and level is decoded by it as well. */
'use strict';
const path = require('path');
const crypto = require('crypto');
const { ok, heading, finish } = require('../sync/lib.js');
const MODS = process.env.PPP_SYNC_MODULES_DIR ? path.resolve(process.env.PPP_SYNC_MODULES_DIR) : path.resolve(__dirname, '..', '..');
const Q = require(path.join(MODS, 'sync', 'qr.js'));

/* GF(256) written again here (x^8+x^4+x^3+x^2+1) */
const EXP = [], LOG = [];
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 285; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
/* a polynomial (highest degree first) evaluated at x */
const evalAt = (poly, x) => poly.reduce((acc, c) => mul(acc, x) ^ c, 0);

/* what the standard says about a version */
const SPEC = {
  M: { 1: [10, [16]], 2: [16, [28]], 3: [26, [44]], 4: [18, [32, 32]], 5: [24, [43, 43]], 6: [16, [27, 27, 27, 27]], 7: [18, [31, 31, 31, 31]], 8: [22, [38, 38, 39, 39]], 9: [22, [36, 36, 36, 37, 37]], 10: [26, [43, 43, 43, 43, 44]] },
  L: { 1: [7, [19]], 2: [10, [34]], 3: [15, [55]], 4: [20, [80]], 5: [26, [108]], 6: [18, [68, 68]], 7: [20, [78, 78]], 8: [24, [97, 97]], 9: [30, [116, 116]], 10: [18, [68, 68, 69, 69]] }
};

function bchOk15(word) {
  /* a valid format word, once the mask 0x5412 is taken off, is a multiple of the generator 0x537 */
  let r = word ^ 0x5412;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return r === 0;
}

function readBack(qr) {
  const m = qr.modules, n = qr.size, v = qr.version;
  const res = { n: n, problems: [] };
  const bad = s => res.problems.push(s);
  if (n !== 17 + 4 * v) bad('size ' + n + ' for version ' + v);
  /* finders */
  const fin = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) { const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4); if (m[r0 + r][c0 + c] !== want) return false; } return true; };
  if (!fin(0, 0) || !fin(0, n - 7) || !fin(n - 7, 0)) bad('finder pattern');
  for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0) || m[i][6] !== (i % 2 === 0)) { bad('timing line'); break; }
  if (!m[n - 8][8]) bad('dark module');
  /* the format word, both copies */
  let a = 0, b = 0;
  const bitA = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  bitA.forEach((p, i) => { if (m[p[0]][p[1]]) a |= 1 << i; });
  for (let i = 0; i < 8; i++) if (m[8][n - 1 - i]) b |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[n - 15 + i][8]) b |= 1 << i;
  if (a !== b) bad('the two copies of the format word differ');
  if (!bchOk15(a)) bad('the format word is not a valid BCH word');
  const level = ((a ^ 0x5412) >>> 13) & 3, mask = ((a ^ 0x5412) >>> 10) & 7;
  if ((level === 1 ? 'L' : level === 0 ? 'M' : '?') !== qr.ecc) bad('level in the format word');
  if (mask !== qr.mask) bad('mask in the format word');
  /* the data: unmasked, in the zigzag, skipping every function module (re-derived here from the standard: a module is a function module in these places) */
  const isFn = (r, c) => {
    if (r < 9 && c < 9) return true;
    if (r < 9 && c >= n - 8) return true;
    if (r >= n - 8 && c < 9) return true;
    if (r === 6 || c === 6) return true;
    if (v >= 7 && ((r < 6 && c >= n - 11) || (c < 6 && r >= n - 11))) return true;
    const pos = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }[v];
    for (const pr of pos) for (const pc of pos) {
      if ((pr === 6 && pc === 6) || (pr === 6 && pc === n - 7) || (pr === n - 7 && pc === 6)) continue;
      if (Math.abs(r - pr) <= 2 && Math.abs(c - pc) <= 2) return true;
    }
    return false;
  };
  const maskFn = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => (((r + c) % 2) + (r * c) % 3) % 2 === 0][mask];
  const bits = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (isFn(r, c)) continue;
        bits.push(m[r][c] !== maskFn(r, c) ? 1 : 0);
      }
    }
    up = !up;
  }
  const cws = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; cws.push(x); }
  const [ec, blocks] = [SPEC[qr.ecc][v] ? SPEC[qr.ecc][v][0] : null, SPEC[qr.ecc][v] ? SPEC[qr.ecc][v][1] : null];
  res.codewords = cws;
  if (ec === null) return res;
  const total = blocks.reduce((s, x) => s + x, 0) + ec * blocks.length;
  if (cws.length < total) { bad('fewer codewords than the version has: ' + cws.length + ' < ' + total); return res; }
  /* de-interleave */
  const bl = blocks.map(() => []);
  let at = 0;
  const longest = Math.max.apply(null, blocks);
  for (let i = 0; i < longest; i++) blocks.forEach((len, k) => { if (i < len) bl[k].push(cws[at++]); });
  const ecs = blocks.map(() => []);
  for (let i = 0; i < ec; i++) blocks.forEach((len, k) => ecs[k].push(cws[at++]));
  /* every block (data then its error correction) is a multiple of the generator: its value is zero at alpha^0 .. alpha^(ec-1) */
  bl.forEach((d, k) => {
    const word = d.concat(ecs[k]);
    for (let i = 0; i < ec; i++) if (evalAt(word, EXP[i]) !== 0) { bad('block ' + k + ' is not a Reed-Solomon codeword'); break; }
  });
  /* the text */
  const data = [].concat.apply([], bl);
  let p = 0;
  const take = k => { let x = 0; for (let i = 0; i < k; i++) { x = (x << 1) | ((data[p >> 3] >> (7 - (p & 7))) & 1); p++; } return x; };
  if (take(4) !== 4) bad('mode is not byte');
  const len = take(v < 10 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  res.text = Buffer.from(out).toString('utf8');
  return res;
}

heading('structure, read back by a reader that is not the encoder');
const link = h => 'https://ppp-web.onrender.com/?sync=on#lib=' + h;
const samples = [
  ['1', 'M'], ['HELLO WORLD', 'M'], [link('ab12cd34'.repeat(8)), 'M'], [link('0123456789abcdef'.repeat(4)), 'L'], ['x'.repeat(100), 'M'], ['x'.repeat(122), 'M'],
  ['x'.repeat(123), 'M'], ['y'.repeat(213), 'M'], ['z'.repeat(271), 'L'], ['한글 동기화 코드', 'M'], ['http://127.0.0.1:10850/?sync=on#lib=' + 'f'.repeat(64), 'M']
];
let all = true;
samples.forEach(([t, l]) => {
  const q = Q.encode(t, { ecc: l });
  const r = readBack(q);
  const good = r.problems.length === 0 && r.text === t;
  if (!good) all = false;
  ok('v' + q.version + '-' + q.ecc + ' mask ' + q.mask + ' of ' + Buffer.byteLength(t) + ' bytes reads back (' + (t.length > 18 ? t.slice(0, 12) + '...' : t) + ')', good, r.problems.join('; ') + (r.text !== t ? ' text: ' + String(r.text).slice(0, 30) : ''));
});
ok('all of them', all);

heading('golden symbols (made once, decoded by jsQR)');
const GOLDEN = [
  ['1', 'M', 1, 6, '444da9acc36112ca'], ['HELLO WORLD', 'M', 1, 4, 'f516d851861750f4'], [link('ab12cd34'.repeat(8)), 'M', 6, 2, '84c176faefa46e1a'],
  [link('0123456789abcdef'.repeat(4)), 'L', 5, 2, '991c69c08100e7cc'], ['x'.repeat(100), 'M', 6, 0, '3b1cbac996b5a950'], ['x'.repeat(122), 'M', 7, 0, '39fabad74b9daeba'],
  ['x'.repeat(123), 'M', 8, 0, '52b1e1c88bbcd999'], ['y'.repeat(213), 'M', 10, 1, 'f07f0416270dd373'], ['z'.repeat(271), 'L', 10, 1, '2d9234da39da9eea'], ['한글 동기화 코드', 'M', 2, 2, '951967edbb82abb3']
];
GOLDEN.forEach(([t, l, ver, mask, h]) => {
  const q = Q.encode(t, { ecc: l });
  const got = crypto.createHash('sha256').update(q.modules.map(r => r.map(v => (v ? '1' : '0')).join('')).join('')).digest('hex').slice(0, 16);
  ok('the symbol of ' + Buffer.byteLength(t) + ' bytes at ' + l + ' is the one that was decoded (v' + ver + ', mask ' + mask + ')', q.version === ver && q.mask === mask && got === h, 'v' + q.version + ' mask ' + q.mask + ' ' + got);
});

heading('limits and the drawing');
ok('the capacity at M: 14 bytes in version 1, 213 in version 10; one more goes to L', Q.encode('a'.repeat(14), { ecc: 'M' }).version === 1 && Q.encode('a'.repeat(15), { ecc: 'M' }).version === 2 && Q.encode('a'.repeat(213), { ecc: 'M' }).version === 10 && Q.encode('a'.repeat(214), { ecc: 'M' }).ecc === 'L');
ok('a text that does not fit version 10 throws, and says why', (() => { try { Q.encode('a'.repeat(272), { ecc: 'L' }); return false; } catch (e) { return e.code === 'too-long'; } })());
const svg = Q.toSvg(Q.encode('hi', { ecc: 'M' }), { border: 4, label: 'A "code"' });
ok('the drawing is one SVG with its own viewBox, a quiet zone of 4 and no script', /^<svg [^>]*viewBox="0 0 29 29"/.test(svg) && !/<script|onload/i.test(svg) && svg.indexOf('aria-label="A &quot;code&quot;"') > 0);

heading('an independent decoder, where there is one');
let jsQR = null;
try { jsQR = require(process.env.PPP_JSQR || 'jsqr'); } catch (e) { jsQR = null; }
if (!jsQR) console.log('    (jsQR is not installed here: set PPP_JSQR=<path of the module> to decode every symbol with it)');
else {
  let bad = 0, n = 0;
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789:/?#=&.-_';
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (const level of ['M', 'L']) for (let len = 1; len <= 270; len += (len < 40 ? 1 : 7)) {
    let t = ''; for (let i = 0; i < len; i++) t += alpha[Math.floor(rnd() * alpha.length)];
    let q;
    try { q = Q.encode(t, { ecc: level }); } catch (e) { continue; }
    const scale = 4, border = 4, S = (q.size + 2 * border) * scale, px = new Uint8ClampedArray(S * S * 4).fill(255);
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.modules[r][c]) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + border) * scale + y) * S + (c + border) * scale + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    const got = jsQR(px, S, S);
    n++;
    if (!got || got.data !== t) bad++;
  }
  ok('jsQR reads ' + n + ' symbols of versions 1-10 at both levels', bad === 0 && n > 100, bad + ' wrong of ' + n);
}

finish('the QR encoder of sync/qr.js');
