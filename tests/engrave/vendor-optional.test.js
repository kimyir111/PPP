/* G13-8 (docs/GOALS/G13_PRODUCTIZATION.md section 4 G13-D2/D3, section 6 row 10): the optional libraries are served by PPP itself, byte for byte as published.

   pdf.js 3.11.174 and its worker, TensorFlow.js 2.8.6, Magenta.js 1.23.1 (transcription.js), TensorFlow.js 3.21.0 and Basic Pitch 1.0.1 with its model live under
   vendor/<package>-<version>/. The proof that they are the published files is the tarball's integrity (sha512) that vendor/README.md records for each, and the
   sha256 of each file, which this test checks every run; `node tools/notices/verify-tarballs.js` (and this test with PPP_VENDOR_ONLINE=1) checks the other link,
   from the registry, that each file is the one in that tarball. Then: nothing converted the bytes, the Apache licence travels with them, the page asks for each
   file by the content hash static-assets.js answers as immutable, the CDN address that remains is the same package at the same version (the way back,
   PPP.cdn), and none of the five is named by the head of the page (they are loaded on demand, never at boot).
   No DOM, no network by default. The browser side (offline, ?cdn=1) is tests/load-app/vendor-optional.test.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(REPO, rel));
const readme = read('vendor/README.md').toString('utf8').replace(/\r\n/g, '\n');
const page = read('Piano Coach App.dc.html').toString('utf8').replace(/\r\n/g, '\n');
const assets = require(path.join(REPO, 'static-assets.js'));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const FOLDERS = ['pdfjs-3.11.174', 'tfjs-2.8.6', 'magenta-music-1.23.1', 'tfjs-3.21.0', 'basic-pitch-1.0.1'];
const NPM = { 'pdfjs-3.11.174': 'pdfjs-dist@3.11.174', 'tfjs-2.8.6': '@tensorflow/tfjs@2.8.6', 'magenta-music-1.23.1': '@magenta/music@1.23.1',
  'tfjs-3.21.0': '@tensorflow/tfjs@3.21.0', 'basic-pitch-1.0.1': '@spotify/basic-pitch@1.0.1' };

/* the section of a folder: { files: [{ file, size, sha256, tar }], tarball, integrity, licence } */
function section(folder) {
  const start = readme.indexOf('\n## ' + folder + '/\n');
  assert.ok(start >= 0, 'vendor/README.md has a section "## ' + folder + '/"');
  const rest = readme.slice(start + 1);
  const end = rest.slice(3).search(/\n## /);
  const body = end < 0 ? rest : rest.slice(0, end + 3);
  const files = [];
  body.split('\n').forEach(line => {
    if (!/^\|/.test(line)) return;
    const c = line.replace(/^\||\|\s*$/g, '').split('|').map(x => x.trim());
    const f = /^`([^`]+)`$/.exec(c[0] || '');
    const sha = /^`([0-9a-f]{64})`$/.exec(c[3] || '');
    if (f && sha) files.push({ file: f[1], from: c[1], size: parseInt((c[2] || '').replace(/[^\d]/g, ''), 10), sha256: sha[1], tar: ((/^`([^`]+)`$/.exec(c[4] || '') || [])[1]) });
  });
  const t = /^Tarball: `([^`]+)`, integrity `(sha512-[A-Za-z0-9+/]+={0,2})`/m.exec(body);
  const lic = /^Licence: Apache-2\.0, `([^`]+)`/m.exec(body);
  return { body, files, tarball: t && t[1], integrity: t && t[2], licence: lic && lic[1] };
}

test('every file of the five libraries is in the README with its size and sha256, and the README names no file that is not there', () => {
  FOLDERS.forEach(folder => {
    const s = section(folder);
    assert.ok(s.files.length > 0, folder + ' has a table of files');
    s.files.forEach(f => {
      assert.ok(f.file.startsWith(folder + '/'), f.file + ' is under ' + folder + '/');
      const buf = read('vendor/' + f.file);
      assert.equal(buf.length, f.size, f.file + ': the size in the README');
      assert.equal(sha256(buf), f.sha256, f.file + ': the sha256 in the README (the file is not what was published, or the README is out of date)');
      assert.ok(f.tar && /^package\//.test(f.tar), f.file + ': the README says which file of the tarball it is');
    });
    /* nothing else in the folder but the licence */
    const listed = new Set(s.files.map(f => f.file).concat([folder + '/LICENSE.txt']));
    const walk = d => fs.readdirSync(path.join(REPO, 'vendor', d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]));
    walk(folder).forEach(f => assert.ok(listed.has(f), 'vendor/' + f + ' is in the README table (or it is the licence)'));
  });
});

test('the registry\'s integrity is recorded for each tarball, in the form the registry gives it, and is the right package and version', () => {
  FOLDERS.forEach(folder => {
    const s = section(folder);
    assert.ok(s.integrity, folder + ': "Tarball: `<url>`, integrity `sha512-...`" is in the README');
    assert.equal(Buffer.from(s.integrity.slice('sha512-'.length), 'base64').length, 64, folder + ': a sha512 digest');
    const [name, version] = [NPM[folder].replace(/@[^@]+$/, ''), NPM[folder].replace(/^.*@/, '')];
    const base = name.replace(/^@[^/]+\//, '');
    assert.equal(s.tarball, 'https://registry.npmjs.org/' + name + '/-/' + base + '-' + version + '.tgz', folder + ': the tarball is ' + NPM[folder]);
    assert.ok(folder.endsWith('-' + version), folder + ': the folder carries the version');
  });
});

test('nothing converted the bytes: git keeps them as they are, and every Apache licence travels with its folder', () => {
  assert.match(read('vendor/.gitattributes').toString('utf8'), /^\* -text$/m, 'vendor/.gitattributes turns line-ending conversion off for everything under vendor/');
  FOLDERS.forEach(folder => {
    const s = section(folder);
    assert.equal(s.licence, folder + '/LICENSE.txt', folder + ': the README names its licence file');
    const t = read('vendor/' + s.licence).toString('utf8');
    assert.match(t, /Apache License\s+Version 2\.0, January 2004/, folder + ': the Apache 2.0 text');
    assert.match(t, /END OF TERMS AND CONDITIONS/, folder + ': the licence is whole (sections 1 to 9 and the closing line)');
    /* a NOTICE would have to travel too (Apache 2.0 section 4d): none of the five packages has one, and the README says so */
    assert.ok(!fs.readdirSync(path.join(REPO, 'vendor', folder)).some(n => /^NOTICE/i.test(n)), folder + ' has no NOTICE file here');
    assert.match(s.body, /has no NOTICE file/, folder + ': the README states that the package has no NOTICE file');
    assert.match(s.body, /^Copyright: Copyright /m, folder + ': the README carries the copyright notice');
  });
  /* the model weights are the one binary, and they are the only file in the five folders that is not text */
  const bin = read('vendor/basic-pitch-1.0.1/model/group1-shard1of1.bin');
  assert.equal(bin.length, 742392);
  const model = JSON.parse(read('vendor/basic-pitch-1.0.1/model/model.json').toString('utf8'));
  assert.deepEqual(model.weightsManifest[0].paths, ['group1-shard1of1.bin'], 'model.json names exactly the one weights file that is here');
});

/* ---- the page ---- */
/* the PPP_LIBS table of the page: every string literal of it */
const libsText = (() => {
  const a = page.indexOf('const PPP_LIBS = {');
  assert.ok(a > 0, 'the page has PPP_LIBS');
  const b = page.indexOf('\n};', a);
  return page.slice(a, b + 3);
})();
const libUrls = Array.from(libsText.matchAll(/'((?:\.\/vendor\/|https:\/\/)[^']+)'/g)).map(m => m[1]);
const vendoredUrls = libUrls.filter(u => u.startsWith('./vendor/'));
const cdnUrls = libUrls.filter(u => u.startsWith('https://'));

test('the page asks for each vendored file by its own content hash (the ?h= that server.js answers immutable), and for no file that is not in the README', () => {
  assert.equal(vendoredUrls.length, 10, 'the page names 10 vendored URLs: pdf.js + worker, tf 2.8.6, transcription.js, tf 3.21.0, 3 Basic Pitch modules, model.json, the weights');
  const known = new Map();
  FOLDERS.forEach(folder => section(folder).files.forEach(f => known.set('./vendor/' + f.file, f)));
  vendoredUrls.forEach(u => {
    const m = /^(\.\/vendor\/[^?]+)\?h=([0-9a-f]{12})$/.exec(u);
    assert.ok(m, u + ' has the form <path>?h=<12 hex>');
    assert.ok(known.has(m[1]), m[1] + ' is a file of the README');
    const ext = path.extname(m[1]).toLowerCase();
    assert.ok(assets.HASHABLE.has(ext), ext + ' is a type server.js answers by hash (static-assets.js HASHABLE)');
    assert.equal(m[2], assets.hashBytes(read(m[1].slice(2)), ext), m[1] + ': the ?h= is the 12 hex server.js would compute for the file (a stale one only costs the cache, but this test wants it right)');
  });
  /* the files of the README the page does not ask for are the licences' neighbours only: every file the README lists, the page asks for */
  known.forEach((f, k) => assert.ok(vendoredUrls.some(u => u.startsWith(k + '?h=')), k + ' is asked for by the page (a file nobody loads should not be here)'));
});

test('the way back: every CDN address of PPP_LIBS is the same package at the same version as the folder it stands in for', () => {
  assert.equal(cdnUrls.length, 5, 'CDN addresses: ' + cdnUrls.length);
  const want = ['pdfjs-dist@3.11.174/legacy/build/pdf.min.js', 'pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js', '@tensorflow/tfjs@2.8.6/dist/tf.min.js',
    '@magenta/music@1.23.1/es6/transcription.js', '@spotify/basic-pitch@1.0.1/model/model.json'];
  want.forEach(w => assert.ok(cdnUrls.includes('https://cdn.jsdelivr.net/npm/' + w), 'PPP_LIBS names https://cdn.jsdelivr.net/npm/' + w));
  /* and each of them is a file the README says it came from (its "From" cell), so the two copies are one file */
  cdnUrls.forEach(u => {
    const hit = FOLDERS.some(folder => section(folder).files.some(f => f.from.indexOf('`' + u + '`') >= 0));
    assert.ok(hit, u + ' is the "From" address of a file in vendor/README.md');
  });
  /* the Basic Pitch code on esm.sh / jsDelivr that the page falls back to names the same versions */
  assert.match(page, /import\('https:\/\/esm\.sh\/@tensorflow\/tfjs@3\.21\.0'\)/);
  assert.match(page, /import\('https:\/\/esm\.sh\/@spotify\/basic-pitch@1\.0\.1'\)/);
  assert.match(page, /import\('https:\/\/cdn\.jsdelivr\.net\/npm\/@tensorflow\/tfjs@3\.21\.0\/\+esm'\)/);
});

test('they are loaded on demand: the head of the page names none of the five, and the loaders honour PPP.cdn', () => {
  const head = page.slice(0, page.indexOf('</head>'));
  FOLDERS.forEach(folder => assert.ok(head.indexOf('vendor/' + folder) < 0, 'the head does not name vendor/' + folder));
  assert.equal(page.split('window.PPP_CDN = (function').length, 2, 'PPP_CDN is decided once, in the head (G13-1)');
  assert.match(page, /const pppWantsCdn = \(\) => typeof window !== 'undefined' && window\.PPP_CDN === true;/);
  /* each of the three loaders asks the switch */
  const uses = (page.match(/pppWantsCdn\(\)/g) || []).length;
  assert.ok(uses >= 3, 'the PDF, Onsets and Frames and Basic Pitch loaders ask pppWantsCdn(): ' + uses);
  /* a worker whose address comes from the vendored file must resolve against the page */
  assert.ok(/let worker = src\.worker;\s*try \{ worker = new URL\(src\.worker, document\.baseURI\)\.href; \}/.test(page) && /GlobalWorkerOptions\.workerSrc = worker;/.test(page), 'the worker address is made absolute against the page and probed first');
  /* the weights are still Google's (U8), and a failed download says so */
  assert.match(page, /storage\.googleapis\.com\/magentadata\/js\/checkpoints\/transcription\/onsets_frames_uni/);
  assert.match(page, /tx\('The piano model could not be downloaded\. Reading a recording in this browser needs an internet connection/);
});

/* ---- SRI of the CDN copies ---- */
test('the CDN copy of each plain script is loaded with the sha384 of the published file (= the vendored file), and crossorigin', () => {
  const sri = rel => 'sha384-' + crypto.createHash('sha384').update(read(rel)).digest('base64');
  const want = [
    ["sri: '", 'vendor/pdfjs-3.11.174/pdf.min.js'],
    ["cdnSri: '", 'vendor/tfjs-2.8.6/tf.min.js'],
    ["cdnSri: '", 'vendor/magenta-music-1.23.1/transcription.js']
  ];
  const found = Array.from(libsText.matchAll(/(?:sri|cdnSri): '(sha384-[A-Za-z0-9+/]+=*)'/g)).map(m => m[1]);
  assert.equal(found.length, 3, 'three CDN scripts carry an SRI in PPP_LIBS');
  want.forEach(([, rel]) => assert.ok(found.includes(sri(rel)), rel + ': its sha384 is one of them (the CDN copy is the published file)'));
  /* the script elements get integrity and crossOrigin when they have one; the worker and import() cannot, and the page says so */
  assert.match(page, /if \(src\.sri\) \{ s\.integrity = src\.sri; s\.crossOrigin = 'anonymous'; \}/, 'pdf.js: integrity + crossOrigin on the CDN script');
  assert.match(page, /if \(sri\) \{ s\.integrity = sri; s\.crossOrigin = 'anonymous'; \}/, 'TensorFlow.js 2.8.6 and transcription.js: the same');
  assert.match(libsText, /SRI cannot be put on those/, 'PPP_LIBS says what SRI cannot cover');
});

/* ---- what is compiled into the vendored files ---- */
/* The notices an author's bundler left in a file (Copyright with a year, a (c)/(C) line, a licence marker), and the packages whose licence the file's own text names. Each must be in the README's "Embedded" table
   and its text in vendor/LICENSE-embedded.txt: a new version of a library that brings another package fails here, not unseen. */
const NOTICE_RX = [/Copyright (?:\(c\) )?(?:19|20)\d\d[A-Za-z0-9 .,()<>@:\/_-]{0,50}/g, /\u00a9 (?:19|20)\d\d(?:-(?:19|20)\d\d)? [A-Za-z]+(?: [A-Za-z]+)?/g, /@license +[A-Za-z0-9-]+/g, /(?:BSD-3-Clause|MIT|ISC|BSD-2-Clause) License\. [A-Za-z]+ [A-Za-z]+/g];
const noticesOf = rel => {
  const t = read(rel).toString('utf8');
  const out = new Set();
  NOTICE_RX.forEach(rx => { (t.match(rx) || []).forEach(m => out.add(m.replace(/\s+/g, ' ').trim())); });
  return Array.from(out).sort();
};
const EXPECT = {
  'vendor/pdfjs-3.11.174/pdf.min.js': ['Copyright 2023 Mozilla Foundation', '\u00a9 2014-2023 Denis Pushkarev'],
  'vendor/pdfjs-3.11.174/pdf.worker.min.js': ['Copyright 2023 Mozilla Foundation', '\u00a9 2014-2023 Denis Pushkarev'],
  'vendor/tfjs-2.8.6/tf.min.js': ['Copyright 2021 Google LLC. All Rights Reserved.', '\u00a9 2020 Denis Pushkarev'],
  'vendor/tfjs-3.21.0/tf.fesm.min.js': ['Copyright 2022 Google LLC. All Rights Reserved.'],
  'vendor/magenta-music-1.23.1/transcription.js': ['@license MIT', 'BSD-3-Clause License. Feross Aboukhadijeh']
};
test('the notices the vendored files carry are the ones the README lists as embedded, and every embedded package has its licence text', () => {
  Object.keys(EXPECT).forEach(rel => {
    assert.deepEqual(noticesOf(rel), EXPECT[rel].slice().sort(), rel + ': a notice appeared or went (a new package compiled in?): list it under "Embedded" in vendor/README.md, its text in vendor/LICENSE-embedded.txt, then this list');
  });
  /* what each file's own text names, by the package's marker */
  const file = rel => read(rel).toString('utf8');
  const MARK = [
    ['vendor/pdfjs-3.11.174/pdf.min.js', /version:"3\.32\.2",mode:[^,]+,copyright:"\u00a9 2014-2023 Denis Pushkarev \(zloirock\.ru\)"/, 'core-js', '3.32.2'],
    ['vendor/pdfjs-3.11.174/pdf.worker.min.js', /version:"3\.32\.2",mode:[^,]+,copyright:"\u00a9 2014-2023 Denis Pushkarev \(zloirock\.ru\)"/, 'core-js', '3.32.2'],
    ['vendor/tfjs-2.8.6/tf.min.js', /version:"3\.6\.5",mode:"global",copyright:"\u00a9 2020 Denis Pushkarev \(zloirock\.ru\)"/, 'core-js', '3.6.5'],
    ['vendor/tfjs-2.8.6/tf.min.js', /xorshift7=[\s\S]*seedrandom=/, 'seedrandom', '2.4.3'],
    ['vendor/tfjs-3.21.0/tf.fesm.min.js', /xorshift7=[\s\S]*seedrandom=/, 'seedrandom', '3.0.5'],
    ['vendor/magenta-music-1.23.1/transcription.js', /@author +Feross Aboukhadijeh/, 'buffer', '4.x or 6.x'],
    ['vendor/magenta-music-1.23.1/transcription.js', /ieee754\. BSD-3-Clause License\. Feross Aboukhadijeh/, 'ieee754', '1.x'],
    ['vendor/magenta-music-1.23.1/transcription.js', /Invalid string\. Length must be a multiple of 4/, 'base64-js', '1.x'],
    ['vendor/magenta-music-1.23.1/transcription.js', /FFT size must be a power of two/, 'fft.js', '4.0.x'],
    ['vendor/magenta-music-1.23.1/transcription.js', /ndarray-resample: input and output arrays should have the same dimensions/, 'ndarray-resample', '1.0.x'],
    ['vendor/magenta-music-1.23.1/transcription.js', /illegal buffer/, 'protobufjs', '6.x']
  ];
  const embeddedText = read('vendor/LICENSE-embedded.txt').toString('utf8');
  MARK.forEach(([rel, rx, name, version]) => {
    assert.match(file(rel), rx, rel + ' still holds ' + name);
    const folder = rel.split('/')[1];
    const sec = section(folder).body;
    assert.ok(new RegExp('\| ' + name.replace(/[.]/g, '\.') + '[^|]*\| ' + version.replace(/[.]/g, '\.')).test(sec), folder + ': the README lists ' + name + ' ' + version + ' as embedded');
    assert.ok(embeddedText.indexOf('\n' + name) >= 0, 'vendor/LICENSE-embedded.txt has the text of ' + name);
  });
  /* long is in the 3.21.0 build (its Long class), and Apache-2.0 */
  assert.match(file('vendor/tfjs-3.21.0/tf.fesm.min.js'), /\.fromBits\(|fromBytesLE|\bLong\b/);
  assert.match(section('tfjs-3.21.0').body, /\| long \| 4\.0\.0 \| Apache-2\.0 \|/);
  assert.match(embeddedText, /\nlong 4\.0\.0 - Apache-2\.0/);
});

test('online (PPP_VENDOR_ONLINE=1): each file is byte for byte the one in its npm tarball', { skip: !process.env.PPP_VENDOR_ONLINE }, async () => {
  const { verify } = require(path.join(REPO, 'tools', 'notices', 'verify-tarballs.js'));
  const problems = await verify(REPO, {});
  assert.deepEqual(problems, []);
});
