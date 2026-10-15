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
    '`support.js`', 'carries no licence header', 'Onsets and Frames checkpoint', 'see the checkpoint\'s own terms',
    /* the catalogue */
    'Open Hymnal', 'Beyer', 'Czerny 100', 'Czerny 30', 'Czerny 40', 'Hanon', 'Burgm', 'Sonatinas', 'PDMX', 'Typesets under review', 'Seed library',
    'public domain or under free licences',
    /* the demo (U6 was decided on 2026-10-15: it is "PPP Practice Theme", by PPP) */
    'The built-in demo score', 'PPP Practice Theme',
    /* YouTube: what really happens, including the fallback site that receives the link */
    'YouTube links', 'Use recordings you have the right to use', 'cannot be posted to Shared Scores', 'loader.to', 'receives the link you pasted', 'youtube-nocookie.com',
    /* tools, models and packages, with the licences this repository states (and none invented) */
    'Audiveris', 'AGPL-3.0', 'Kong', 'TransKun', 'Aria-AMT', 'Beat This', 'PM2S', 'yt-dlp', 'YourMT3', 'SheetSage2', 'CC BY-NC 4.0: non-commercial use only',
    'MERT-v2-FullSong', 'Demucs', 'Demucs: MIT', 'librosa', 'pYIN', 'music21', 'Basic Pitch (the Python package', 'pg (node-postgres)', 'zod', '@anthropic-ai/sdk',
    'puppeteer', 'see the project\'s own licence'
  ];
  const missing = must.filter(s => !NOTICES.includes(s));
  assert.deepEqual(missing, []);
});

test('what is served is what a reader may see: no internal note, no promise, no "not stated" that reads as "unlicensed", no unqualified public domain for all hymns', () => {
  assert.ok(!/TODO\(/.test(NOTICES), 'an internal TODO is in the served notices (it belongs in tools/notices/notices.json)');
  assert.ok(!NOTICES.includes('<!--'), 'an HTML comment is in the served notices');
  assert.ok(!/not stated in this repository/.test(NOTICES), '"not stated" reads as "unlicensed": say "see the project\'s own licence"');
  assert.ok(!/replac(?:e|es|ing) them/.test(NOTICES), 'the notices promise that PPP will replace something');
  assert.ok(!/hymn tunes[^.]*are public[- ]domain/i.test(NOTICES), 'the hymns are said to be public domain without the qualification');
  const reg = JSON.parse(read('tools/notices/notices.json'));
  /* U6 is decided (2026-10-15): no pending note is left, and the demo is not named after a film piece or a living composer */
  assert.ok(!('todo' in reg.demo), 'the U6 note is still in notices.json after the decision');
  assert.ok(!/Interstellar|Zimmer/.test(NOTICES) && !/Interstellar|Zimmer/.test(reg.demo.text), 'the demo is still named after a film piece or its composer');
  /* a table that is a table in markdown reads badly as the plain text it is served as: none is left */
  assert.ok(!/^\| ---/m.test(NOTICES), 'a pipe table is in the served notices');
});

test('the pieces the notices mark "under review" are the ones the benchmark records as quarantined', () => {
  const reg = JSON.parse(read('tools/notices/notices.json'));
  const rel = 'tests/bench/corpus/provenance.json';
  if (!fs.existsSync(path.join(ROOT, rel))) return;   /* a copy without the benchmark */
  const prov = JSON.parse(read(rel));
  const method = JSON.parse(read('catalog/method/index.json'));
  const got = {};
  prov.entries.filter(e => e.quarantine_reason).forEach(e => {
    const m = /^catalog\/method\/([\w-]+)\/(\d+)\.mxl$/.exec(e.path || '');
    if (m) (got[m[1]] = got[m[1]] || []).push(+m[2]);
  });
  const want = {};
  Object.keys(reg.catalogue.underReview).forEach(id => {
    const book = method.books.find(b => b.id === id);
    const r = reg.catalogue.underReview[id];
    want[id] = (r === 'all' ? book.pieces.map((p, i) => i + 1) : r).slice().sort((a, b) => a - b);
  });
  Object.keys(got).forEach(id => got[id].sort((a, b) => a - b));
  assert.deepEqual(got, want, 'tests/bench/corpus/provenance.json quarantines other pieces than tools/notices/notices.json marks (catalogue.underReview): update the notice and regenerate');
  const marked = NOTICES.split('\n').filter(l => /is under review$/.test(l));
  assert.equal(marked.length, Object.keys(want).length, 'the method-book list marks each book that has pieces under review');
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
  ['a pinned Python requirement with no helper row', c => {
    fs.appendFileSync(path.join(c, 'requirements-transcription.txt'), 'brand-new-package==1.0\n');
  }, /requirements-transcription\.txt names brand-new-package/],
  ['a model a setup script downloads that has no row', c => {
    edit(c, 'tools/home-worker/setup-yourmt3.cmd', "repo_id='mimbres/YourMT3'", "repo_id='someone/NewModel'");
  }, /setup-yourmt3\.cmd names someone\/NewModel/],
  ['a runtime dependency of the server with no row', c => {
    const f = path.join(c, 'package.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.dependencies['left-pad'] = '1.3.0';
    fs.writeFileSync(f, JSON.stringify(j));
  }, /package\.json names left-pad/],
  ['a licence statement a row relies on that is gone', c => { edit(c, 'sheetsage2_run.py', 'CC BY-NC 4.0', 'a licence'); }, /helper row "SheetSage2 weights[^"]*": sheetsage2_run\.py no longer says/],
  ['a script from a host nobody has classified (cdnjs)', c => {
    fs.appendFileSync(path.join(c, 'Piano Coach App.dc.html'), '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>\n');
  }, /names https:\/\/cdnjs\.cloudflare\.com .*does not know that host/],
  ['a file from raw.githubusercontent.com', c => {
    fs.appendFileSync(path.join(c, 'Piano Coach App.dc.html'), '\n<script>fetch("https://raw.githubusercontent.com/someone/repo/main/data.json");</script>\n');
  }, /names https:\/\/raw\.githubusercontent\.com/],
  ['a module the page loads (not the page itself) that names a new host', c => {
    fs.appendFileSync(path.join(c, 'rec', 'key.js'), "\nconst EXTRA = 'https://cdn.example.net/lib.js';\n");
  }, /names https:\/\/cdn\.example\.net \(rec\/key\.js\)/],
  ['an unpinned path at a library host (a GitHub path at jsDelivr)', c => {
    fs.appendFileSync(path.join(c, 'Piano Coach App.dc.html'), '\n<script>import("https://cdn.jsdelivr.net/gh/someone/repo@main/file.js");</script>\n');
  }, /must be named with its version/],
  ['a service row for a host no served file names any more', c => {
    const f = path.join(c, 'tools', 'notices', 'notices.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.hosts.service['gone.example'] = 'nothing';
    fs.writeFileSync(f, JSON.stringify(j));
  }, /lists gone\.example under hosts \(service\) but no served file names it any more/],
  ['a book marked "under review" that the catalogue does not have', c => {
    const f = path.join(c, 'tools', 'notices', 'notices.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.catalogue.underReview['no-such-book'] = 'all';
    fs.writeFileSync(f, JSON.stringify(j));
  }, /names book no-such-book/],
  ['a licence code the catalogue notice does not name', c => {
    const f = path.join(c, 'catalog', 'method', 'index.json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"license": "pd"', '"license": "unknown"'));
  }, /licence code "unknown"/]
];

test('the unbroken copy passes (so each mutant below fails for its own reason)', () => {
  const c = makeCopy(BUILD_INPUTS);
  try { const r = check(c); assert.equal(r.code, 0, r.out); } finally { rmCopy(c); }
});
test('a host named only in a comment is not a finding, and a link to a known host is not either', () => {
  const c = makeCopy(BUILD_INPUTS);
  try {
    fs.appendFileSync(path.join(c, 'rec', 'key.js'), "\n/* see https://not-loaded.example/paper.pdf */\n// and https://also-not-loaded.example/x\nconst YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';\n");
    const r = check(c);
    assert.equal(r.code, 0, r.out);
  } finally { rmCopy(c); }
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
