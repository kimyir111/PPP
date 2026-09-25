/* G04 §18.3: the text widths the layout reads, taken once from the font files the page loads.

     node tests/engrave/tools/make-text-metrics.js                  write engrave/metrics-text.js from the cached fonts
     node tests/engrave/tools/make-text-metrics.js --fetch          download the pinned fonts first (into the cache)
     node tests/engrave/tools/make-text-metrics.js --check          exit 1 if engrave/metrics-text.js is not what the fonts give - no
                                                                    network: the form and digest always, the rebuild when the fonts
                                                                    are cached (the PR gate)
     node tests/engrave/tools/make-text-metrics.js --check --fetch  the same, downloading what is not cached (FETCH_MS a font at most);
                                                                    a download that fails says "rebuild skipped (network)"
     ... --check --fetch --strict                                   and exit 1 when the rebuild did not run (the nightly job)

   The page draws text in three families from Google Fonts (App line 58): Instrument Serif (titles, words, tempo text),
   Figtree (chord names, fingering) and JetBrains Mono (bar numbers, hint letters). The layout never measures text in a
   DOM (A29): it reads each character's advance width from this table, so Node and every browser lay out the same
   geometry whether or not the web font has arrived (§18.3). Only the table is committed, never a font file: the fonts
   are fetched from their pinned, versioned URLs into tests/engrave/out/fonts/ (gitignored) and checked against the
   sha256 recorded here before anything is read from them.

   What the table holds per face: units per em, ascender, descender, cap height and x-height (OS/2), and the advance
   width of every character of the set below the font has, in thousandths of an em. A character the font lacks is not
   in the table; the layout gives it 0.6 em and says so (TEXT_GLYPH_MISSING). No kerning.

   --check: with the fonts at hand (cached, or --fetch), the table must be byte for byte what they give. Without them
   (no network) it checks what it can - the block is in its canonical form and its digest matches its content - and
   says that the rebuild was skipped, and why: "(network)" when a download failed or timed out, never silently. Exit 0
   only when every check that ran passed - and, with --strict, only when the rebuild ran (the G4d-1a review R4: a pull
   request's gate does not depend on the network; the nightly job does the rebuild and fails if it cannot). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..', '..');
const FILE = path.join(REPO, 'engrave', 'metrics-text.js');
const CACHE = path.join(REPO, 'tests', 'engrave', 'out', 'fonts');
const BEGIN = '  /* BEGIN GENERATED (tests/engrave/tools/make-text-metrics.js) */', END = '  /* END GENERATED */';
const GSTATIC = 'https://fonts.gstatic.com/s/';
const FETCH_MS = 30000;        /* one font's download at most, then the fetch is abandoned */

/* the faces the layout may name, each a pinned file of the Google Fonts css2 API (the URLs are versioned: v5, v9, v24) */
const FACES = [
  { role: 'serif', family: 'Instrument Serif', style: 'normal', weight: 400, url: 'instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf',
    sha256: 'a99e3db50076202713812ed541feeb23ffeebb61db1fa6b1cf48fe590d37ef18' },
  { role: 'serif-italic', family: 'Instrument Serif', style: 'italic', weight: 400, url: 'instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zATiw.ttf',
    sha256: 'fecf4861d5202405b8bd45c683858b6870642a026784fe0dbf88ff55dedee8a0' },
  { role: 'sans', family: 'Figtree', style: 'normal', weight: 400, url: 'figtree/v9/_Xmz-HUzqDCFdgfMsYiV_F7wfS-Bs_d_QF5e.ttf',
    sha256: '81f3fc9d8d4e307e5ae0dd43a03d22eb90d50b6cc72241552c460a59b6731b31' },
  { role: 'sans-bold', family: 'Figtree', style: 'normal', weight: 700, url: 'figtree/v9/_Xmz-HUzqDCFdgfMsYiV_F7wfS-Bs_eYR15e.ttf',
    sha256: '88aad0bfccf47bc631abd1351a0c815be98edf58c2c8706f72deb24a531639d6' },
  { role: 'mono', family: 'JetBrains Mono', style: 'normal', weight: 400, url: 'jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPQ.ttf',
    sha256: '44ce4a84f20d60f24539bd0cef11f79c29e38609e0f8adf18551c9794a5d9dc3' }
];
/* the characters (§18.3: Latin-1, sharp and flat, digits) and a few a score's text uses: dashes, quotes, the ellipsis */
function charset() {
  const out = [];
  for (let c = 0x20; c <= 0x7e; c++) out.push(c);
  for (let c = 0xa0; c <= 0xff; c++) out.push(c);
  [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x266d, 0x266e, 0x266f].forEach(c => out.push(c));
  return out;
}

/* ------------------------------------------------------------------ a TrueType reader: just what the table needs */
function tables(buf) {
  const n = buf.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i;
    t[buf.toString('latin1', o, o + 4)] = { offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) };
  }
  ['head', 'hhea', 'hmtx', 'cmap', 'OS/2'].forEach(k => { if (!t[k]) throw new Error('no ' + k + ' table'); });
  return t;
}
/* character code -> glyph index, from the Windows Unicode cmap (format 12, else format 4) */
function cmapOf(buf, t) {
  const base = t.cmap.offset, n = buf.readUInt16BE(base + 2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const o = base + 4 + 8 * i;
    subs.push({ pid: buf.readUInt16BE(o), eid: buf.readUInt16BE(o + 2), off: base + buf.readUInt32BE(o + 4) });
  }
  subs.forEach(s => { s.format = buf.readUInt16BE(s.off); });
  const pick = subs.find(s => s.pid === 3 && s.eid === 10 && s.format === 12) || subs.find(s => s.pid === 0 && s.format === 12) ||
    subs.find(s => s.pid === 3 && s.eid === 1 && s.format === 4) || subs.find(s => s.pid === 0 && s.format === 4);
  if (!pick) throw new Error('no Unicode cmap');
  const o = pick.off;
  if (pick.format === 12) {
    const groups = buf.readUInt32BE(o + 12), list = [];
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + 12 * i;
      list.push([buf.readUInt32BE(g), buf.readUInt32BE(g + 4), buf.readUInt32BE(g + 8)]);
    }
    return c => { const g = list.find(x => c >= x[0] && c <= x[1]); return g ? g[2] + (c - g[0]) : 0; };
  }
  const segs = buf.readUInt16BE(o + 6) / 2;
  const endAt = o + 14, startAt = endAt + 2 * segs + 2, deltaAt = startAt + 2 * segs, rangeAt = deltaAt + 2 * segs;
  return c => {
    for (let i = 0; i < segs; i++) {
      const end = buf.readUInt16BE(endAt + 2 * i);
      if (c > end) continue;
      const start = buf.readUInt16BE(startAt + 2 * i);
      if (c < start) return 0;
      const delta = buf.readInt16BE(deltaAt + 2 * i), ro = buf.readUInt16BE(rangeAt + 2 * i);
      if (!ro) return (c + delta) & 0xffff;
      const gi = buf.readUInt16BE(rangeAt + 2 * i + ro + 2 * (c - start));
      return gi ? (gi + delta) & 0xffff : 0;
    }
    return 0;
  };
}
function readFace(buf) {
  const t = tables(buf);
  const upm = buf.readUInt16BE(t.head.offset + 18);
  const nh = buf.readUInt16BE(t.hhea.offset + 34);
  const os2 = t['OS/2'].offset, ver = buf.readUInt16BE(os2);
  const adv = gi => buf.readUInt16BE(t.hmtx.offset + 4 * Math.min(gi, nh - 1));
  const cmap = cmapOf(buf, t);
  const em = v => Math.round(v * 1000 / upm);
  const widths = {};
  charset().forEach(c => { const gi = cmap(c); if (gi) widths[c] = em(adv(gi)); });
  return {
    upm: upm,
    ascender: em(buf.readInt16BE(os2 + 68)), descender: em(-buf.readInt16BE(os2 + 70)),
    capHeight: ver >= 2 ? em(buf.readInt16BE(os2 + 88)) : null, xHeight: ver >= 2 ? em(buf.readInt16BE(os2 + 86)) : null,
    widths: widths
  };
}

/* ------------------------------------------------------------------ fonts: cached, fetched, verified */
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const cached = f => path.join(CACHE, path.basename(f.url));
async function fetchFonts() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of FACES) {
    const p = cached(f);
    if (fs.existsSync(p) && sha(fs.readFileSync(p)) === f.sha256) continue;
    const r = await fetch(GSTATIC + f.url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) throw new Error(f.url + ': HTTP ' + r.status);
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
}
/* -> the fonts' bytes, each checked against its recorded sha256, or null when one is not cached */
function loadFonts() {
  const out = [];
  for (const f of FACES) {
    const p = cached(f);
    if (!fs.existsSync(p)) return null;
    const b = fs.readFileSync(p);
    if (sha(b) !== f.sha256) throw new Error(path.basename(p) + ': sha256 ' + sha(b) + ', the table was made from ' + f.sha256);
    out.push(b);
  }
  return out;
}

/* ------------------------------------------------------------------ the generated block */
function faceData(f, face) {
  return { family: f.family, style: f.style, weight: f.weight, source: GSTATIC + f.url, sha256: f.sha256, upm: face.upm, ascender: face.ascender,
    descender: face.descender, capHeight: face.capHeight, xHeight: face.xHeight, widths: face.widths };
}
function render(data) {
  const lines = [];
  Object.keys(data).forEach((role, i, all) => {
    const d = data[role];
    const head = ['family', 'style', 'weight', 'source', 'sha256', 'upm', 'ascender', 'descender', 'capHeight', 'xHeight']
      .map(k => JSON.stringify(k) + ': ' + JSON.stringify(d[k])).join(', ');
    const codes = Object.keys(d.widths).map(Number).sort((a, b) => a - b);
    const rows = [];
    for (let k = 0; k < codes.length; k += 12) rows.push('        ' + codes.slice(k, k + 12).map(c => '"' + c + '": ' + d.widths[c]).join(', '));
    lines.push('    ' + JSON.stringify(role) + ': {\n      ' + head + ',\n      "widths": {\n' + rows.join(',\n') + '\n      }\n    }' + (i < all.length - 1 ? ',' : ''));
  });
  const body = lines.join('\n');
  const digest = sha(JSON.stringify(data));
  return BEGIN + '\n  const FACES = Object.freeze({\n' + body + '\n  });\n  const DIGEST = ' + JSON.stringify(digest) + ';\n' + END;
}
function build(bufs) {
  const data = {};
  FACES.forEach((f, i) => { data[f.role] = faceData(f, readFace(bufs[i])); });
  return render(data);
}
/* the block of the committed file, and the data it holds (read back as JSON) */
function current() {
  const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('engrave/metrics-text.js has no generated block');
  const block = text.slice(a, b + END.length);
  const m = /const FACES = Object\.freeze\((\{[\s\S]*\})\);\n\s*const DIGEST = "([0-9a-f]{64})";/.exec(block);
  if (!m) throw new Error('engrave/metrics-text.js: the generated block is not in its form');
  const data = JSON.parse(m[1]);
  /* the widths come back keyed by strings; render sorts them numerically */
  return { text: text, block: block, data: data, digest: m[2] };
}
function splice(text, block) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  return text.slice(0, a) + block + text.slice(b + END.length);
}

async function main() {
  const check = process.argv.indexOf('--check') > 0, fetchIt = process.argv.indexOf('--fetch') > 0, strict = process.argv.indexOf('--strict') > 0;
  let fetchErr = null;
  if (fetchIt) { try { await fetchFonts(); } catch (e) { fetchErr = e; } }
  const bufs = loadFonts();
  if (!check) {
    if (!bufs) { console.error('the fonts are not cached: run with --fetch' + (fetchErr ? ' (' + fetchErr.message + ')' : '')); process.exit(1); }
    const cur = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(FILE, splice(cur, build(bufs)));
    console.log('wrote the widths of ' + FACES.length + ' faces into engrave/metrics-text.js');
    return;
  }
  const cur = current();
  const bad = [];
  /* what holds without the fonts: the canonical form, and the digest of what the block says */
  if (render(cur.data) !== cur.block) bad.push('the generated block is not in the form this tool writes (edited by hand?)');
  if (sha(JSON.stringify(cur.data)) !== cur.digest) bad.push('the digest does not match the table (a width edited by hand?)');
  FACES.forEach(f => {
    const d = cur.data[f.role];
    if (!d) { bad.push('no face ' + f.role); return; }
    if (d.sha256 !== f.sha256 || d.source !== GSTATIC + f.url) bad.push(f.role + ': made from another file than this tool pins');
    ['0123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'].forEach(s => s.split('').forEach(ch => {
      if (!(String(ch.charCodeAt(0)) in d.widths)) bad.push(f.role + ' has no width for ' + ch);
    }));
  });
  let rebuilt = fetchErr ? 'skipped (network): ' + (fetchErr.name === 'TimeoutError' ? 'no answer in ' + FETCH_MS / 1000 + ' s' : fetchErr.message)
    : 'skipped (the fonts are not cached; --fetch downloads them)';
  if (bufs) {
    const next = build(bufs);
    rebuilt = next === cur.block ? 'the pinned fonts give this table byte for byte' : 'DIFFERS from what the pinned fonts give';
    if (next !== cur.block) bad.push('the table differs from the pinned fonts');
  } else if (strict) bad.push('--strict: the rebuild from the pinned fonts did not run (' + rebuilt + ')');
  console.log('engrave/metrics-text.js: ' + (bad.length ? 'FAIL' : 'PASS') + ' - form and digest checked; rebuild ' + rebuilt);
  bad.forEach(b => console.log('  ' + b));
  process.exit(bad.length ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { FACES, charset, readFace, render, build, current, CACHE };
