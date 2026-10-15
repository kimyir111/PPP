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
  assert.match(page, /workerSrc = new URL\(src\.worker, document\.baseURI\)\.href/);
  /* the weights are still Google's (U8), and a failed download says so */
  assert.match(page, /storage\.googleapis\.com\/magentadata\/js\/checkpoints\/transcription\/onsets_frames_uni/);
  assert.match(page, /tx\('The piano model could not be downloaded\. Reading a recording in this browser needs an internet connection/);
});

test('online (PPP_VENDOR_ONLINE=1): each file is byte for byte the one in its npm tarball', { skip: !process.env.PPP_VENDOR_ONLINE }, async () => {
  const { verify } = require(path.join(REPO, 'tools', 'notices', 'verify-tarballs.js'));
  const problems = await verify(REPO, {});
  assert.deepEqual(problems, []);
});
