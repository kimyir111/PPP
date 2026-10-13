'use strict';
/* G13-4b: the Latin fonts are served by PPP, and the page no longer waits for another site's stylesheet (docs/GOALS/G13_PRODUCTIZATION.md G13-4, U7).

   Node only. Checks, from the files and from a running server.js:
     1. vendor/fonts holds exactly the files vendor/README.md lists, with the sizes and sha256 it states, each a real woff2 and each used by a @font-face of the page;
     2. the @font-face rules in the head of the page are Google Fonts' own for these families (same weights, styles, unicode-ranges, display: swap: GOOGLE_FACES / the
        two ranges below are the face table Google published on 2026-10-08), so what is drawn does not change - 650 and 800 still resolve to 700;
     3. every family has its SIL OFL licence beside the files, with the copyright line the README quotes;
     4. nothing in the page's head or template is a stylesheet from another site (the first paint cannot wait for one); the Korean/Japanese/Chinese stylesheet is added by a
        script after load, for the CJK families only, and the body's font stack is unchanged;
     5. the server hands each font out under its hash, immutable, and does not gzip a woff2. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO, boot, request, hashOf } = require('./lib');

/* family, style, weight, file: the faces fonts.googleapis.com/css2 lists for these families (one block per weight; a variable file is listed once per weight) */
const GOOGLE_FACES = [
  ['Figtree', 'normal', 400, 'figtree-v9-latin-ext.woff2'], ['Figtree', 'normal', 400, 'figtree-v9-latin.woff2'],
  ['Figtree', 'normal', 500, 'figtree-v9-latin-ext.woff2'], ['Figtree', 'normal', 500, 'figtree-v9-latin.woff2'],
  ['Figtree', 'normal', 600, 'figtree-v9-latin-ext.woff2'], ['Figtree', 'normal', 600, 'figtree-v9-latin.woff2'],
  ['Figtree', 'normal', 700, 'figtree-v9-latin-ext.woff2'], ['Figtree', 'normal', 700, 'figtree-v9-latin.woff2'],
  ['Instrument Serif', 'italic', 400, 'instrument-serif-v5-italic-latin-ext.woff2'], ['Instrument Serif', 'italic', 400, 'instrument-serif-v5-italic-latin.woff2'],
  ['Instrument Serif', 'normal', 400, 'instrument-serif-v5-latin-ext.woff2'], ['Instrument Serif', 'normal', 400, 'instrument-serif-v5-latin.woff2'],
  ['JetBrains Mono', 'normal', 400, 'jetbrains-mono-v24-latin-ext.woff2'], ['JetBrains Mono', 'normal', 400, 'jetbrains-mono-v24-latin.woff2'],
  ['JetBrains Mono', 'normal', 500, 'jetbrains-mono-v24-latin-ext.woff2'], ['JetBrains Mono', 'normal', 500, 'jetbrains-mono-v24-latin.woff2'],
  ['Noto Music', 'normal', 400, 'noto-music-v21-music.woff2']
];
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
const MUSIC = 'U+25CC, U+2669-266F, U+1D000-1D0F5, U+1D100-1D245';
const rangeOf = file => (/music\.woff2$/.test(file) ? MUSIC : /latin-ext\.woff2$/.test(file) ? LATIN_EXT : LATIN);

const PAGE = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const README = fs.readFileSync(path.join(REPO, 'vendor', 'README.md'), 'utf8');
const FONTS = path.join(REPO, 'vendor', 'fonts');
const head = PAGE.slice(0, PAGE.indexOf('</head>'));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const woff2s = () => fs.readdirSync(FONTS).filter(f => f.endsWith('.woff2')).sort();

/* the @font-face rules of the head's <style> blocks */
function rules() {
  const out = [];
  for (const st of head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = st[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const r of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const get = k => { const m = new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)').exec(r[1]); return m ? m[1].trim() : null; };
      const src = get('src') || '';
      out.push({ family: (get('font-family') || '').replace(/['"]/g, ''), style: get('font-style'), weight: get('font-weight'), display: get('font-display'),
        url: (/url\(([^)]+)\)/.exec(src) || [])[1] || null, format: (/format\('([^']+)'\)/.exec(src) || [])[1] || null, range: get('unicode-range') });
    }
  }
  return out;
}
const fileOf = url => path.basename(String(url).split('?')[0]);

test('vendor/fonts holds the files the README lists, with the size and sha256 it states', () => {
  const rows = [...README.matchAll(/^\| `fonts\/([^`]+\.woff2)` \|[^|]*\|[^|]*\| ([\d,]+) bytes \| `([0-9a-f]{64})` \|\r?$/gm)];
  assert.deepEqual(rows.map(r => r[1]).sort(), woff2s(), 'every font file has a row and every row a file');
  assert.equal(woff2s().length, 9);
  for (const [, file, size, hash] of rows) {
    const buf = fs.readFileSync(path.join(FONTS, file));
    assert.equal(buf.length, Number(size.replace(/,/g, '')), file + ' size');
    assert.equal(sha(buf), hash, file + ' sha256');
    assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2', file + ' is a woff2');
  }
});

test('the page declares exactly Google\'s faces for these families, each with a file that is there', () => {
  const rs = rules();
  assert.equal(rs.length, GOOGLE_FACES.length, 'one rule per published face');
  const key = a => a.join('|');
  assert.deepEqual(rs.map(r => key([r.family, r.style, Number(r.weight), fileOf(r.url)])).sort(), GOOGLE_FACES.map(key).sort());
  for (const r of rs) {
    assert.equal(r.display, 'swap', r.family + ': text is never blocked');
    assert.equal(r.format, 'woff2');
    assert.match(r.url, /^\.\/vendor\/fonts\/[\w-]+\.woff2\?v=1$/, 'a relative url the server can name by hash');
    assert.ok(fs.existsSync(path.join(FONTS, fileOf(r.url))), r.url);
    assert.equal(r.range, rangeOf(fileOf(r.url)), fileOf(r.url) + ': the unicode-range is Google\'s');
  }
  /* every file is used; no face wider than Google's steps, so 650 and 800 resolve to 700 as they did */
  assert.deepEqual([...new Set(rs.map(r => fileOf(r.url)))].sort(), woff2s());
  assert.deepEqual([...new Set(rs.filter(r => r.family === 'Figtree').map(r => r.weight))].sort(), ['400', '500', '600', '700']);
  assert.deepEqual([...new Set(rs.filter(r => r.family === 'JetBrains Mono').map(r => r.weight))].sort(), ['400', '500']);
});

test('every family has its OFL licence beside the files, and the README quotes its copyright line', () => {
  const lic = {
    'Figtree': 'LICENSE-figtree-OFL.txt', 'Instrument Serif': 'LICENSE-instrument-serif-OFL.txt',
    'JetBrains Mono': 'LICENSE-jetbrains-mono-OFL.txt', 'Noto Music': 'LICENSE-noto-music-OFL.txt'
  };
  for (const r of rules()) assert.ok(lic[r.family], 'a licence file is named for ' + r.family);
  for (const [family, file] of Object.entries(lic)) {
    const text = fs.readFileSync(path.join(FONTS, file), 'utf8');
    assert.match(text, /^Copyright \d{4} The .+ Project Authors/m, file);
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/, file + ' is the OFL 1.1');
    const line = text.split(/\r?\n/)[0].trim();
    assert.ok(README.includes('| ' + family + ' | ' + line + ' | `fonts/' + file + '` |'), family + ': the README row quotes "' + line + '"');
  }
});

test('the first paint waits for no other site: no stylesheet link to another host in the page, and the CJK sheet comes from a script after load', () => {
  const links = [...PAGE.matchAll(/<link\b[^>]*>/g)].map(m => m[0]);
  for (const l of links) assert.ok(!/rel=["']stylesheet["']/i.test(l) || !/href=["']https?:/i.test(l), 'no render-blocking stylesheet from another site: ' + l.slice(0, 100));
  assert.ok(!links.some(l => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(l)), 'the Google Fonts links are gone from the page markup');
  /* the script that adds Google's Noto Sans */
  const m = /\(function \(\) \{\s*var CJK = '([^']+)';[\s\S]*?\}\)\(\);/.exec(head);
  assert.ok(m, 'the head has the script that adds the CJK stylesheet');
  const url = new URL(m[1]);
  assert.equal(url.origin + url.pathname, 'https://fonts.googleapis.com/css2');
  const fam = url.searchParams.getAll('family').map(f => f.split(':')[0]);
  assert.deepEqual(fam, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC'], 'only the CJK families; the Latin ones are ours');
  for (const f of url.searchParams.getAll('family')) assert.equal(f.split(':')[1], 'wght@400;500;600;700', 'the weights the page has always asked for');
  assert.equal(url.searchParams.get('display'), 'swap');
  assert.match(m[0], /addEventListener\('load'/, 'after the page has loaded');
  assert.match(m[0], /requestIdleCallback/, 'and the browser is idle');
  assert.ok(!/document\.write/.test(m[0]));
  /* the font stack of the body is unchanged: Figtree, then the CJK families, then the system's */
  assert.match(PAGE, /body \{ background: #f7f5f2; font-family: Figtree, "Noto Sans KR", "Noto Sans JP", "Noto Sans SC", system-ui, sans-serif;/);
});

test('the server hands out each font by its hash: immutable, a woff2 is not gzipped again, and the licence files come with them', async () => {
  const srv = await boot();
  try {
    const page = (await request(srv.port, '/')).body.toString('utf8');
    const urls = [...page.matchAll(/url\(\.\/(vendor\/fonts\/[\w-]+\.woff2)\?h=([0-9a-f]{12})\)/g)].map(m => [m[1], m[2]]);
    assert.ok(urls.length >= GOOGLE_FACES.length, 'every rule of the served page names its file by hash (' + urls.length + ')');
    assert.ok(!/vendor\/fonts\/[\w-]+\.woff2\?v=/.test(page.slice(0, page.indexOf('</head>'))), 'no ?v= is left in the head');
    for (const [rel, h] of urls) {
      assert.equal(h, hashOf(fs.readFileSync(path.join(REPO, rel)), true), rel + ' is named by the hash of its bytes');
      const r = await request(srv.port, '/' + rel + '?h=' + h, { headers: { 'Accept-Encoding': 'gzip, br' } });
      assert.equal(r.status, 200, rel);
      assert.equal(r.headers['content-type'], 'font/woff2', rel);
      assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable', rel);
      assert.equal(r.headers['content-encoding'], undefined, rel + ': a woff2 is compressed already');
      assert.ok(r.raw.equals(fs.readFileSync(path.join(REPO, rel))), rel);
    }
    for (const f of fs.readdirSync(FONTS).filter(x => x.startsWith('LICENSE-'))) assert.equal((await request(srv.port, '/vendor/fonts/' + f)).status, 200, f);
    assert.equal((await request(srv.port, '/vendor/fonts/missing.woff2')).status, 404);
  } finally { srv.close(); }
});
