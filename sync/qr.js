/* A small QR Code encoder (G13-S1): byte mode, error correction L or M, versions 1-10, the best of the eight masks. It exists for one thing - drawing the link of a song
   library so that a phone can scan it from the PC's screen - without any other site being asked to draw it (no external service, nothing about the code leaves the page).

     PPPQr.encode(text, { ecc: 'M' | 'L' }) -> { size, version, ecc, mask, modules: [[bool, ...], ...] }   (true is a dark module)
     PPPQr.toSvg(qr, { border: 4, dark: '#000', light: '#fff' }) -> an <svg> string
   It throws { code: 'too-long' } for a text that does not fit version 10 (271 bytes at L), and the page then shows the link alone.

   Written to the standard (ISO/IEC 18004) tables: every symbol it makes for a text of any length and either level is decoded by an independent reader in
   tests/sync-page/qr.test.js (jsQR where it is installed; the structure checks - finder, timing, the format word, every block's codewords against Reed-Solomon - always). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPQr = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* codewords in all, per version 1..10 */
  const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  /* error correction codewords per block, and the blocks as [count, data codewords each] */
  const BLOCKS = {
    L: [null, [7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]], [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]], [18, [[2, 68], [2, 69]]]],
    M: [null, [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]], [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]]
  };
  const FORMAT_BITS = { L: 1, M: 0 };
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  /* GF(256), x^8 + x^4 + x^3 + x^2 + 1 */
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  function generator(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
      g = next;
    }
    return g;                                         /* highest degree first, monic */
  }
  function remainder(data, deg) {
    const g = generator(deg), r = new Array(deg).fill(0);
    data.forEach(b => {
      const f = b ^ r[0];
      r.shift(); r.push(0);
      if (f) for (let i = 0; i < deg; i++) r[i] ^= gmul(g[i + 1], f);
    });
    return r;
  }

  /* the bits of the data of a version: mode, count, bytes, terminator, padding */
  function dataCodewords(bytes, version, level) {
    const spec = BLOCKS[level][version];
    const cap = spec[1].reduce((n, b) => n + b[0] * b[1], 0);
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const room = cap * 8;
    if (bits.length > room) return null;
    put(0, Math.min(4, room - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }
  /* data -> blocks -> error correction -> interleaved */
  function codewords(data, version, level) {
    const spec = BLOCKS[level][version], ec = spec[0];
    const blocks = [];
    let at = 0;
    spec[1].forEach(b => { for (let i = 0; i < b[0]; i++) { blocks.push(data.slice(at, at + b[1])); at += b[1]; } });
    const ecs = blocks.map(b => remainder(b, ec));
    const out = [];
    const longest = Math.max.apply(null, blocks.map(b => b.length));
    for (let i = 0; i < longest; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < ec; i++) ecs.forEach(e => out.push(e[i]));
    return out;
  }

  const bchFormat = v => { let r = v << 10; for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10); return ((v << 10) | r) ^ 0x5412; };
  const bchVersion = v => { let r = v << 12; for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12); return (v << 12) | r; };

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  /* the symbol: function patterns, then the data in the zigzag, then a mask and the format word */
  function build(cw, version, level) {
    const n = 17 + 4 * version;
    const mod = [], fn = [];
    for (let i = 0; i < n; i++) { mod.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); }
    const set = (r, c, dark) => { if (r >= 0 && r < n && c >= 0 && c < n) { mod[r][c] = dark; fn[r][c] = true; } };
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const in7 = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = in7 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(r0 + dr, c0 + dc, dark);
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const pos = ALIGN[version];
    pos.forEach(r => pos.forEach(c => {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    /* the format and version areas are reserved (drawn below), and the one dark module */
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true; }
    set(n - 8, 8, true);
    if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fn[i][n - 11 + j] = true; fn[n - 11 + j][i] = true; }
    /* the data, two columns at a time from the right, up and down, skipping the timing column */
    let bit = 0;
    const total = cw.length * 8;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < n; v++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const up = ((right + 1) & 2) === 0;
          const r = up ? n - 1 - v : v;
          if (fn[r][c]) continue;
          let dark = false;
          if (bit < total) { dark = ((cw[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1; bit++; }
          mod[r][c] = dark;
        }
      }
    }
    const apply = m => {
      const fmt = bchFormat((FORMAT_BITS[level] << 3) | m);
      const out = mod.map(row => row.slice());
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r][c] && MASKS[m](r, c)) out[r][c] = !out[r][c];
      /* the format word, twice; bit i from the least significant */
      const f = i => ((fmt >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) out[i][8] = f(i);
      out[7][8] = f(6); out[8][8] = f(7); out[8][7] = f(8);
      for (let i = 9; i < 15; i++) out[8][14 - i] = f(i);
      for (let i = 0; i < 8; i++) out[8][n - 1 - i] = f(i);
      for (let i = 8; i < 15; i++) out[n - 15 + i][8] = f(i);
      out[n - 8][8] = true;
      if (version >= 7) {
        const vb = bchVersion(version);
        for (let i = 0; i < 18; i++) { const dark = ((vb >>> i) & 1) === 1, a = n - 11 + (i % 3), b = Math.floor(i / 3); out[b][a] = dark; out[a][b] = dark; }
      }
      return out;
    };
    return { apply: apply, size: n };
  }
  function penalty(m) {
    const n = m.length;
    let p = 0;
    const run = line => {
      let s = 0, k = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && line[i] === line[i - 1]) k++;
        else { if (k >= 5) s += 3 + (k - 5); k = 1; }
      }
      return s;
    };
    for (let i = 0; i < n; i++) { p += run(m[i]); p += run(m.map(row => row[i])); }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true, false, false, false, false], rev = pat.slice().reverse();
    const hit = (get) => { let s = 0; for (let i = 0; i <= n - 11; i++) { let a = true, b = true; for (let k = 0; k < 11; k++) { const v = get(i + k); if (v !== pat[k]) a = false; if (v !== rev[k]) b = false; } if (a) s += 40; if (b) s += 40; } return s; };
    for (let i = 0; i < n; i++) { p += hit(k => m[i][k]); p += hit(k => m[k][i]); }
    let dark = 0;
    m.forEach(row => row.forEach(v => { if (v) dark++; }));
    p += 10 * Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n));
    return p;
  }

  function utf8(text) {
    if (typeof TextEncoder === 'function') return Array.from(new TextEncoder().encode(String(text)));
    const s = unescape(encodeURIComponent(String(text))), out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  /* -> { size, version, ecc, mask, modules } */
  function encode(text, opts) {
    opts = opts || {};
    const bytes = utf8(text);
    const levels = opts.ecc === 'L' ? ['L'] : opts.ecc === 'M' ? ['M', 'L'] : ['M', 'L'];
    for (const level of levels) {
      for (let version = 1; version <= 10; version++) {
        const data = dataCodewords(bytes, version, level);
        if (!data) continue;
        const cw = codewords(data, version, level);
        if (cw.length !== TOTAL[version]) throw new Error('internal: codeword count');
        const sym = build(cw, version, level);
        let best = null, bestScore = Infinity, bestMask = 0;
        for (let m = 0; m < 8; m++) {
          const mm = sym.apply(m);
          const s = penalty(mm);
          if (s < bestScore) { bestScore = s; best = mm; bestMask = m; }
        }
        return { size: best.length, version: version, ecc: level, mask: bestMask, modules: best };
      }
    }
    const e = new Error('that text is too long for a QR code of this encoder');
    e.code = 'too-long';
    throw e;
  }

  function toSvg(qr, o) {
    o = o || {};
    const b = o.border === undefined ? 4 : o.border, n = qr.size, s = n + 2 * b;
    const dark = o.dark || '#000', light = o.light || '#fff';
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.modules[r][c]) { c++; continue; }
        let k = c;
        while (k < n && qr.modules[r][k]) k++;
        d += 'M' + (c + b) + ' ' + (r + b) + 'h' + (k - c) + 'v1h-' + (k - c) + 'z';
        c = k;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges" role="img"' + (o.label ? ' aria-label="' + String(o.label).replace(/"/g, '&quot;') + '"' : '') + '>'
      + '<rect width="' + s + '" height="' + s + '" fill="' + light + '"/><path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  return Object.freeze({ encode, toSvg, _internals: { remainder, generator, codewords, dataCodewords, bchFormat, bchVersion, BLOCKS, TOTAL } });
});
