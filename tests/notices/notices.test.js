'use strict';
/* G13-3: THIRD_PARTY_NOTICES.md (tools/notices/build.js). Node only.

   1. The committed file is what the sources say, and every thing PPP serves or loads has a row: every file of vendor/ (and every font family) in vendor/README.md,
      every library the page names at a CDN in tools/notices/notices.json, the Salamander attribution in audio/piano/README.md.
   2. The file says every item of the G13 doc's section E8, with the CC BY 3.0 attribution (author, licence, link, changes).
   3. It is served at /THIRD_PARTY_NOTICES.md, as text.
   4. MUTANTS: a copy of the inputs is broken on purpose (a vendor folder or a font file with no row, a licence file gone, the attribution cut, a library the page
      names that no row covers, a stale row, a hand-edited notices file) and `build.js --check` must fail each, naming it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { REPO, ROOT, makeCopy, rmCopy, edit, BUILD_INPUTS } = require('./lib.js');

const BUILD = path.join(ROOT, 'tools', 'notices', 'build.js');
const lf = s => s.replace(/\r\n?/g, '\n');
const read = rel => lf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const NOTICES = read('THIRD_PARTY_NOTICES.md');
const walk = rel => fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(rel + '/' + e.name) : [rel + '/' + e.name]));

/* run build.js on a tree; the exit code and what it said */
function check(root) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'notices', 'build.js'), '--check', '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('build.js --check passes on this tree: the file is what the sources say, and every source has a row', () => {
  const r = spawnSync(process.execPath, [BUILD, '--check', '--root', ROOT], { encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

test('every file of vendor/ is in vendor/README.md and in the notices; every folder has a section; every font family has its licence', () => {
  const readme = read('vendor/README.md');
  const headings = Array.from(readme.matchAll(/^## (.+?)\s*$/gm)).map(m => m[1].replace(/\/$/, ''));
  const files = walk('vendor').map(f => f.slice('vendor/'.length)).filter(f => f !== 'README.md' && f !== '.gitattributes');
  assert.ok(files.length >= 20, 'vendor files: ' + files.length);
  files.forEach(f => {
    assert.ok(readme.includes(f), 'vendor/' + f + ' is not named in vendor/README.md');
    assert.ok(NOTICES.includes(path.basename(f)), 'vendor/' + f + ' is not in THIRD_PARTY_NOTICES.md');
  });
  fs.readdirSync(path.join(ROOT, 'vendor')).filter(n => n !== 'README.md' && n !== '.gitattributes' && !/^LICENSE/.test(n))
    .forEach(n => assert.ok(headings.includes(n), 'vendor/' + n + ' has no "## ' + n + '" section in vendor/README.md'));
  files.filter(f => /\.woff2$/.test(f)).forEach(f => {
    const stem = path.basename(f).replace(/-v\d+.*$/, '');
    assert.ok(files.includes('fonts/LICENSE-' + stem + '-OFL.txt'), 'the font family ' + stem + ' has no OFL licence file');
    assert.ok(NOTICES.includes('vendor/fonts/LICENSE-' + stem + '-OFL.txt'), 'the notices do not give the licence file of ' + stem);
  });
});

test('the notices say every item of G13 section E8', () => {
  const must = [
    /* the piano recordings, with the CC BY 3.0 attribution: author, licence, link to it, the changes */
    'Salamander Grand Piano V3', 'Alexander Holm', 'CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/', 'Changed here: notes longer than nine seconds',
    /* code and fonts */
    'React and ReactDOM 18.3.1', 'VexFlow 4.2.3', 'MIT', 'Babel standalone', 'pdf.js', 'TensorFlow.js', 'Magenta.js', 'Basic Pitch', 'Apache-2.0',
    'Bravura', 'Petaluma', 'Leland', 'Gonville', 'Figtree', 'Instrument Serif', 'JetBrains Mono', 'Noto Music', 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', 'SIL Open Font License 1.1',
    '`support.js`', 'carries no licence header', 'Onsets and Frames checkpoint', 'not stated in this repository',
    /* the catalogue */
    'Open Hymnal', 'Beyer', 'Czerny 100', 'Czerny 30', 'Czerny 40', 'Hanon', 'Burgm', 'Sonatinas', 'PDMX', 'Typesets being replaced', 'Seed library',
    /* the demo, and the decision that is pending */
    'The built-in demo score', 'TODO(U6)',
    /* YouTube */
    'YouTube links', 'Use recordings you have the right to use', 'cannot be posted to Shared Scores',
    /* tools */
    'Audiveris', 'AGPL-3.0', 'Kong', 'TransKun', 'Aria-AMT', 'Beat This', 'PM2S', 'yt-dlp'
  ];
  const missing = must.filter(s => !NOTICES.includes(s));
  assert.deepEqual(missing, []);
});

test('the quarantined-typesets count the notices state is the one the benchmark records', () => {
  const reg = JSON.parse(read('tools/notices/notices.json'));
  const rel = 'tests/bench/corpus/provenance.json';
  if (!fs.existsSync(path.join(ROOT, rel))) return;   /* a copy without the benchmark */
  const prov = JSON.parse(read(rel));
  const n = prov.entries.filter(e => e.quarantine_reason && /^catalog\/method\//.test(e.path || '')).length;
  assert.equal(n, reg.catalogue.quarantined.count, 'tests/bench/corpus/provenance.json quarantines ' + n + ' method-book files: update the notice in tools/notices/notices.json (catalogue.quarantined) and regenerate');
});

/* ---- served ---- */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
test('the server hands out /THIRD_PARTY_NOTICES.md as text, and not the generator or its data', async () => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-notices-srv-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '', PPP_DATA_DIR: dir })
  });
  let out = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 30000);
      const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', seen); child.stderr.on('data', seen);
      child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
    });
    const get = p => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: port, path: p }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
      }).on('error', reject);
    });
    const r = await get('/THIRD_PARTY_NOTICES.md');
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/plain; charset=utf-8$/, 'shown, not downloaded');
    assert.equal(lf(r.body), NOTICES);
    assert.match(r.body, /Alexander Holm/);
    for (const hidden of ['/tools/notices/build.js', '/tools/notices/notices.json', '/vendor/README.md', '/audio/piano/README.md']) {
      assert.equal((await get(hidden)).status, 404, hidden);
    }
  } finally { child.kill(); rmCopy(dir); }
});

/* ---- mutants ---- */
const MUTANTS = [
  ['a vendor folder with no row', c => {
    fs.mkdirSync(path.join(c, 'vendor', 'pdfjs-3.11.174'));
    fs.writeFileSync(path.join(c, 'vendor', 'pdfjs-3.11.174', 'pdf.min.js'), '/* pdf.js */\n');
  }, /vendor\/pdfjs-3\.11\.174.*has no "## pdfjs-3\.11\.174" section/],
  ['a file in a vendor folder that README does not name', c => {
    fs.writeFileSync(path.join(c, 'vendor', 'react-18.3.1', 'react-extra.js'), '/* extra */\n');
  }, /vendor\/react-18\.3\.1\/react-extra\.js has no row in vendor\/README\.md/],
  ['a font file whose family has no licence row', c => {
    fs.writeFileSync(path.join(c, 'vendor', 'fonts', 'newfamily-v1-latin.woff2'), 'wOF2');
    edit(c, 'vendor/README.md', '| `fonts/noto-music-v21-music.woff2` |', '| `fonts/newfamily-v1-latin.woff2` | NewFamily 400, latin | `https://fonts.gstatic.com/s/newfamily/v1/x.woff2` | 4 bytes | `00` |\n| `fonts/noto-music-v21-music.woff2` |');
  }, /the family "newfamily" has no licence row/],
  ['a font file that README does not name', c => {
    fs.copyFileSync(path.join(c, 'vendor', 'fonts', 'figtree-v9-latin.woff2'), path.join(c, 'vendor', 'fonts', 'figtree-v9-cyrillic.woff2'));
  }, /vendor\/fonts\/figtree-v9-cyrillic\.woff2 has no row in vendor\/README\.md/],
  ['a licence file that is gone', c => { fs.rmSync(path.join(c, 'vendor', 'fonts', 'LICENSE-figtree-OFL.txt')); }, /LICENSE-figtree-OFL\.txt/],
  ['the attribution paragraph without its author', c => { edit(c, 'audio/piano/README.md', 'by Alexander Holm', 'by someone'); }, /does not name its author/],
  ['the attribution without the licence link', c => { edit(c, 'audio/piano/README.md', '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)', 'CC BY 3.0'); }, /does not link the CC BY 3\.0 licence/],
  ['the changes line gone', c => { edit(c, 'audio/piano/README.md', 'Changed here:', 'Edited:'); }, /"Changed here:" paragraph/],
  ['a CDN library the page loads that no row covers', c => {
    const f = path.join(c, 'Piano Coach App.dc.html');
    fs.appendFileSync(f, '\n<script>const X = "https://cdn.jsdelivr.net/npm/some-new-lib@1.2.3/dist/lib.min.js";</script>\n');
  }, /some-new-lib from a CDN and tools\/notices\/notices\.json has no licence row/],
  ['a row for a library the page no longer names', c => {
    const f = path.join(c, 'tools', 'notices', 'notices.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.cdn.packages['gone-lib'] = { name: 'Gone', licence: 'MIT', use: 'nothing' };
    fs.writeFileSync(f, JSON.stringify(j));
  }, /lists gone-lib as loaded from a CDN, but the page no longer names it/],
  ['a Google Storage file with no row', c => {
    fs.appendFileSync(path.join(c, 'Piano Coach App.dc.html'), '\n<script>const W = "https://storage.googleapis.com/some-bucket/model.bin";</script>\n');
  }, /storage\.googleapis\.com\/some-bucket\/model\.bin and tools\/notices\/notices\.json has no row/],
  ['the committed notices file edited by hand', c => { edit(c, 'THIRD_PARTY_NOTICES.md', 'Alexander Holm', 'A. Holm'); }, /is not what the sources say/],
  ['the committed notices file gone', c => { fs.rmSync(path.join(c, 'THIRD_PARTY_NOTICES.md')); }, /THIRD_PARTY_NOTICES\.md is missing/],
  ['a licence code the catalogue notice does not name', c => {
    const f = path.join(c, 'catalog', 'method', 'index.json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"license": "pd"', '"license": "unknown"'));
  }, /licence code "unknown"/]
];

test('the unbroken copy passes (so each mutant below fails for its own reason)', () => {
  const c = makeCopy(BUILD_INPUTS);
  try { const r = check(c); assert.equal(r.code, 0, r.out); } finally { rmCopy(c); }
});
MUTANTS.forEach(([name, mutate, expected]) => {
  test('mutant: ' + name + ' is refused by build.js --check', () => {
    const c = makeCopy(BUILD_INPUTS);
    try {
      mutate(c);
      const r = check(c);
      assert.equal(r.code, 1, 'the check passed a tree with ' + name + ': ' + r.out);
      assert.match(r.out, expected, r.out);
    } finally { rmCopy(c); }
  });
});
