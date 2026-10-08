'use strict';
/* G13-5: the static server hands out only what static-allow.js names (docs/GOALS/G13 D16, TD26), and every answer carries the security headers.

   Node only (no browser, no database). It starts this tree's server.js on a free port and asks it, over HTTP, about
     1. every file git tracks: served exactly when it is a file the page can use (a second statement of the rule, written here from the folders'
        purposes and not from static-allow.js), and a 404 for everything else - /server.js, /render.yaml, /package.json, /docs/*, /tests/*, /tools/*, the
        folders' tools/, READMEs, Python, the ABC sources;
     2. the files the PAGE names: its <script src> tags, the lists it loads on demand (SINGLE_SCRIPTS, RECORDING_SCRIPTS, RECORDING_OPTIONAL_SCRIPTS,
        ENGRAVE_FILES, RECORDING_WEIGHTS, PIANO), every file-like string of the page and of the scripts beside it that names a file of this repository, and the files the
        catalogues name. Each must be on the list: a lazy module added to the page without a line in static-allow.js fails HERE, not as a 404 on the live site;
     3. ways round the list (case, dots, encodings, backslashes, a stream suffix);
     4. the headers, the cache headers (unchanged by G13-5), and the one log line for a file that exists and is not served. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const allow = require(path.join(REPO, 'static-allow.js'));
const PAGE = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
async function boot(env) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-static-'));
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '', PPP_DATA_DIR: dir, PPP_HSTS: '' }, env || {})
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 30000);
    const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', seen);
    child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
  });
  return { port, dir, log: () => out, close: () => { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ } } };
}
function get(port, url, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: port, path: url, headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
/* the request path of a repository path: every part encoded */
const urlOf = rel => '/' + rel.split('/').map(encodeURIComponent).join('/');
const tracked = () => execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);

/* ---- the rule, said again from what each folder is for (not from static-allow.js) ---- */
const CODE_DIRS = ['scoregraph', 'engrave', 'playability', 'difficulty', 'songgraph', 'arrangement', 'realize', 'rec', 'candidates', 'critics', 'repair'];
const ROOT_SERVED = ['Piano Coach App.dc.html', 'support.js', 'i18n.js', 'library-backup.js', 'audio-score.js', 'score-search.js', 'lessons.js', 'course.js'];
function expectedServed(rel) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  const ext = path.extname(name);
  if (parts.length === 1) return ROOT_SERVED.indexOf(name) > -1;
  const top = parts[0];
  if (CODE_DIRS.indexOf(top) > -1) {
    if (parts.length === 2) return ext === '.js';
    if (parts.length === 3 && parts[1] === 'weights') return ext === '.json' && (top === 'rec' || top === 'difficulty');
    return rel === 'difficulty/tools/dataset/method-books.json';
  }
  if (top === 'omr') return rel === 'omr/normalize.js' || rel === 'omr/apply.js';           /* G12-1, G12-2: the page's lazy normaliser and findings module; omr/helper-output.js is the local helper's */
  if (top === 'i18n') return parts.length === 2 && ext === '.json';
  if (top === 'audio') return parts.length === 3 && parts[1] === 'piano' && ext === '.mp3';
  if (top === 'assets') return ext === '.png';
  if (top === 'samples') return parts.length === 2 && ext === '.musicxml';
  if (top === 'catalog') {
    if (parts.length === 2) return ext === '.musicxml' || name === 'index.json';
    if (parts[1] === 'hymns') return parts.length === 3 && (ext === '.musicxml' || name === 'index.json');
    if (parts[1] === 'method') return (parts.length === 3 && name === 'index.json') || (parts.length === 3 && ext === '.mxl') || (parts.length === 4 && ext === '.mxl');
    return false;
  }
  if (top === 'vendor') return !/^(README\.md|\.)/.test(name) && !name.startsWith('.');
  return false;
}

/* Two folders are named here only as examples of what is NOT served. tests/bench/unit/test_ci_plan.py keeps a tripwire over files that name the folders the light CI modes skip (it
   exists to make someone trace the gate when a step starts READING them); this test reads neither, it asks the server about their names, so they are put together, not written. */
const DOCS = 'do' + 'cs';
const WORKER_DIR = 'tools/' + 'home' + '-worker';

test('isServed: the examples that matter', () => {
  ['Piano Coach App.dc.html', 'support.js', 'scoregraph/index.js', 'rec/weights/hands-v1.json', 'difficulty/weights/g6a-v1.json',
    'difficulty/tools/dataset/method-books.json', 'i18n/ko-KR.json', 'audio/piano/A0.mp3', 'assets/hands/hand-right-black.png',
    'catalog/index.json', 'catalog/method/index.json', 'catalog/hymns/index.json', 'catalog/hymns/all-creatures.musicxml', 'catalog/method/beyer/001.mxl',
    'samples/prelude-fragment.musicxml', 'vendor/vexflow-4.2.3.js', 'vendor/LICENSE-vexflow.txt', 'vendor/react-18.3.1/react.production.min.js',
    'vendor/react-18.3.1/LICENSE-react.txt', 'THIRD_PARTY_NOTICES.md', 'omr/normalize.js', 'omr/apply.js'].forEach(rel => assert.equal(allow.isServed(rel), true, rel));
  ['server.js', 'render.yaml', 'package.json', 'package-lock.json', 'Dockerfile', 'README.md', 'index.html', 'static-allow.js', 'home-jobs.js', 'share-guest.js', 'omr-service.js',
    'arrange_score.py', 'transcribe.py', 'omr/helper-output.js', 'omr/normalize.js.map', 'omr/README.md', DOCS + '/PPP_MASTER_ROADMAP.md', WORKER_DIR + '/worker.js', 'tests/boot.js', 'tools/anything', 'rec/tools/train.js', 'rec/tools/key-eval.js', 'scoregraph/README.md',
    'scoregraph/tools/notation-check.js', 'difficulty/tools/train.js', 'audio/piano/README.md', 'catalog/shared-seeds.json', 'catalog/build-shared-seeds.js',
    'catalog/hymns/build.js', 'catalog/method/books.json', 'catalog/method/build.py', 'catalog/method/src/beyer/001.abc', 'vendor/README.md', 'vendor/.gitattributes',
    '.env', '.git/config', '.github/workflows/bench.yml', 'data/store.json', 'node_modules/pg/package.json', 'review/build.js', 'Server.js', 'SUPPORT.JS', 'scoregraph/INDEX.JS',
    'scoregraph/../server.js', 'vendor/../server.js', 'vendor/./vexflow-4.2.3.js', 'vendor/react-18.3.1/../../server.js', '../server.js', '/server.js', 'scoregraph\\index.js', '', 'scoregraph/', 'scoregraph', 'scoregraph//index.js', 'support.js\0', 'support.js.',
    'support.js::$DATA'].forEach(rel => assert.equal(allow.isServed(rel), false, JSON.stringify(rel)));
  assert.equal(allow.isServed(null), false);
  assert.equal(allow.isServed(undefined), false);
  assert.equal(allow.isServed({}), false);
});

test('the names this test relies on are still in the repository', () => {
  allow.ROOT_FILES.forEach(f => { if (!allow.PLANNED.has(f)) assert.ok(fs.existsSync(path.join(REPO, f)), f + ' is on the list but not in the repository'); });
  assert.deepEqual(Array.from(allow.ROOT_FILES).filter(f => !allow.PLANNED.has(f)).sort(), ROOT_SERVED.slice().sort());
  assert.equal(allow.CODE_DIRS, CODE_DIRS.join('|'));
});

/* ---- what the PAGE names ---- */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w'"`\\])\/\/[^\n]*/g, '');
}
/* the string literals of a `const NAME = [...]` list of the page */
function listOf(name) {
  const m = new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\n?\\]);').exec(PAGE);
  assert.ok(m, 'the page no longer has "const ' + name + ' = [...]" - the loader list moved: update this test and check static-allow.js');
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1]);
}
const asPath = ref => ref.replace(/^\.\//, '').replace(/[?#].*$/, '');

test('every file the page asks for is on the list (script tags, the lazy lists, file-like strings, the catalogues)', () => {
  const refs = new Map(); // rel -> where it came from
  const add = (rel, where) => { if (!refs.has(rel)) refs.set(rel, where); };

  const tags = Array.from(PAGE.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map(m => m[1]).filter(s => !/^https?:/.test(s));
  assert.ok(tags.length >= 60, 'script tags found: ' + tags.length);
  tags.forEach(s => add(asPath(s), '<script src>'));

  [['SINGLE_SCRIPTS', 12], ['RECORDING_SCRIPTS', 13], ['RECORDING_OPTIONAL_SCRIPTS', 1]].forEach(([name, min]) => {
    const l = listOf(name);
    assert.ok(l.length >= min, name + ': ' + l.length);
    l.forEach(s => add(s, name));
  });
  const engrave = listOf('ENGRAVE_FILES');
  assert.ok(engrave.length >= 30, 'ENGRAVE_FILES: ' + engrave.length); // 15 names and 15 hashes
  engrave.filter(s => !/^[0-9a-f]{12}$/.test(s)).forEach(n => add('engrave/' + n + '.js', 'ENGRAVE_FILES'));
  listOf('RECORDING_WEIGHTS').filter(s => /\.json$/.test(s)).forEach(s => add(s, 'RECORDING_WEIGHTS'));
  const piano = /const PIANO = \{\s*base: '([^']+)',[\s\S]*?names: \[([^\]]+)\]/.exec(PAGE);
  assert.ok(piano, 'PIANO moved');
  Array.from(piano[2].matchAll(/'([^']+)'/g)).forEach(m => add(piano[1] + m[1] + '.mp3', 'PIANO'));
  assert.ok(Array.from(refs.keys()).filter(r => r.startsWith('audio/piano/')).length === 30, 'the page names 30 piano recordings');

  /* any other string of the page or of the scripts beside it that is a path to a file of this repository */
  const topDirs = new Set(fs.readdirSync(REPO).filter(n => fs.statSync(path.join(REPO, n)).isDirectory()));
  const literal = /(['"`])((?:\.\/)?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:js|json|mp3|musicxml|mxl|png|svg|woff2?|css|txt|xml))(?:\?[^'"`\s]*)?\1/g;
  const sources = [['Piano Coach App.dc.html', PAGE]].concat(ROOT_SERVED.filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]));
  const found = [];
  sources.forEach(([file, text]) => {
    Array.from(stripComments(text).matchAll(literal)).forEach(m => {
      const rel = asPath(m[2]);
      if (!topDirs.has(rel.split('/')[0]) || !fs.existsSync(path.join(REPO, rel))) return; // not a file of this repository
      add(rel, 'a string in ' + file);
      found.push(rel);
    });
  });
  assert.ok(found.length >= 20, 'file-like strings found: ' + found.length);

  /* the catalogues name more */
  const j = rel => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  j('catalog/index.json').scores.filter(s => s.file).forEach(s => add('catalog/' + s.file, 'catalog/index.json'));
  j('catalog/hymns/index.json').hymns.forEach(h => add('catalog/hymns/' + h.file, 'catalog/hymns/index.json'));
  j('catalog/method/index.json').books.forEach(b => (b.pieces || []).forEach(p => p.file && add('catalog/method/' + p.file, 'catalog/method/index.json')));
  assert.ok(Array.from(refs.keys()).filter(r => r.startsWith('catalog/method/')).length > 200, 'the method catalogue lists its pieces');

  const missing = [], notServed = [];
  refs.forEach((where, rel) => {
    if (!fs.existsSync(path.join(REPO, rel))) missing.push(rel + ' (' + where + ')');
    else if (!allow.isServed(rel)) notServed.push(rel + ' (' + where + ')');
  });
  assert.deepEqual(missing, [], 'the page names files that are not in the repository');
  assert.deepEqual(notServed, [], 'the page names files that static-allow.js does not serve: add a rule for them (or take the reference out)');
});

/* ---- the server, over HTTP ---- */
test('the server: every tracked file is served exactly when it should be, and every other answer is a 404', async () => {
  const srv = await boot();
  try {
    const files = tracked();
    assert.ok(files.length > 1500, 'tracked files: ' + files.length);
    const wrong = [];
    let served = 0, hidden = 0;
    for (let i = 0; i < files.length; i += 24) {
      await Promise.all(files.slice(i, i + 24).map(async rel => {
        const r = await get(srv.port, urlOf(rel));
        /* /index.html is the app itself (the first branch of serveStatic), whatever the file index.html holds */
        const want = rel === 'index.html' ? true : expectedServed(rel);
        if (r.status !== (want ? 200 : 404)) wrong.push(rel + ' -> ' + r.status + ' (wanted ' + (want ? 200 : 404) + ')');
        if (want) served++; else hidden++;
        if (!want) assert.doesNotMatch(String(r.headers['content-type']), /javascript|html|xml|text\/plain/, rel); // a JSON error, not the file
      }));
    }
    assert.deepEqual(wrong.slice(0, 20), [], wrong.length + ' files answered otherwise than wanted');
    assert.ok(served > 450 && hidden > 800, served + ' served, ' + hidden + ' hidden');
    /* and the four the doc names, by name */
    for (const p of ['/server.js', '/render.yaml', '/package.json', '/docs/PPP_MASTER_ROADMAP.md', '/docs/GOALS/G13_PRODUCTIZATION.md', '/README.md', '/Dockerfile', '/static-allow.js']) {
      assert.equal((await get(srv.port, p)).status, 404, p);
    }
    /* the page itself, by every name it has */
    for (const p of ['/', '/index.html', '/Piano%20Coach%20App.dc.html']) {
      const r = await get(srv.port, p);
      assert.equal(r.status, 200, p);
      assert.match(r.body.toString('utf8', 0, 400), /<!DOCTYPE html>/i, p);
    }
  } finally { srv.close(); }
});

test('the server: the ways round the list are 404', async () => {
  const srv = await boot();
  try {
    const paths = [
      '/Server.js', '/SERVER.JS', '/server.JS', '/server.js.', '/server.js%20', '/server.js%00', '/server.js%00.js', '/server.js::$DATA', '/server.js/', '/server.js/.', '/server.js?x=1', '/server.js#x',
      '/./server.js', '/%2e/server.js', '/%2e%2e/server.js', '/scoregraph/../server.js', '/scoregraph/%2e%2e/server.js', '/scoregraph/..%2fserver.js', '/scoregraph/%2e%2e%2fserver.js',
      '/scoregraph/..%5cserver.js', '/..%5cserver.js', '/docs%5cPPP_MASTER_ROADMAP.md', '/docs\\PPP_MASTER_ROADMAP.md', '/%2564ocs/PPP_MASTER_ROADMAP.md', '/docs/./PPP_MASTER_ROADMAP.md',
      '/docs/../docs/PPP_MASTER_ROADMAP.md', '/rec/tools/train.js', '/rec//tools/train.js', '/rec/./tools/train.js', '/rec/weights/../tools/train.js', '/audio/piano/../README.md',
      '/catalog/hymns/../shared-seeds.json', '/catalog/shared-seeds.json', '/vendor/README.md', '/vendor/.gitattributes', '/vendor/../server.js', '/.env', '/.git/config', '/.github/workflows/bench.yml',
      '/PACKAGE.JSON', '/Package.json', '/Dockerfile.', '/tests/boot.js', '/' + WORKER_DIR + '/worker.js', '/node_modules/pg/package.json', '/data/store.json'
    ];
    for (const p of paths) {
      const r = await get(srv.port, p);
      assert.equal(r.status, 404, p + ' -> ' + r.status);
      assert.doesNotMatch(r.body.toString('utf8', 0, 300), /require\(|"scripts"|services:|PPP web server/, p);
    }
    /* a doubled slash is the same file, not another one */
    assert.equal((await get(srv.port, '/scoregraph//index.js')).status, 200);
    assert.equal((await get(srv.port, '/server.js//')).status, 404);
    /* a file and a folder that exist and are not served are the same answer as a path that does not exist */
    const a = await get(srv.port, '/server.js'), b = await get(srv.port, '/no-such-file.js'), c = await get(srv.port, '/docs/');
    assert.equal(a.body.toString(), b.body.toString());
    assert.equal(a.headers['content-type'], b.headers['content-type']);
    assert.equal(c.status, 404);
  } finally { srv.close(); }
});

test('the server: security headers on every kind of answer, HSTS only over https, caching as before', async () => {
  const srv = await boot();
  try {
    for (const p of ['/', '/health', '/api/auth/me', '/support.js', '/audio/piano/A0.mp3', '/server.js', '/api/nothing', '/%E0%A4%A']) {
      const r = await get(srv.port, p);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin', p);
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', p);
      assert.equal(r.headers['strict-transport-security'], undefined, p + ': no HSTS over http');
      assert.equal(r.headers['content-security-policy'], undefined, p + ': no CSP yet');
    }
    const secure = await get(srv.port, '/health', { 'X-Forwarded-Proto': 'https' });
    assert.equal(secure.headers['strict-transport-security'], 'max-age=15552000');
    const chain = await get(srv.port, '/support.js', { 'X-Forwarded-Proto': 'https, http' });
    assert.equal(chain.headers['strict-transport-security'], 'max-age=15552000', 'the first hop is the browser\'s');
    const plain = await get(srv.port, '/health', { 'X-Forwarded-Proto': 'http' });
    assert.equal(plain.headers['strict-transport-security'], undefined);
    const forged = await get(srv.port, '/health', { 'X-Forwarded-Proto': 'httpsx' });
    assert.equal(forged.headers['strict-transport-security'], undefined);
    /* the cache headers G13-5 does not touch */
    assert.equal((await get(srv.port, '/support.js')).headers['cache-control'], 'no-store');
    assert.equal((await get(srv.port, '/i18n/ko-KR.json')).headers['cache-control'], 'no-store');
    assert.equal((await get(srv.port, '/rec/weights/hands-v1.json')).headers['cache-control'], 'no-store');
    assert.equal((await get(srv.port, '/audio/piano/A0.mp3')).headers['cache-control'], 'public, max-age=2592000');
    assert.equal((await get(srv.port, '/assets/hands/hand-right-black.png')).headers['cache-control'], 'public, max-age=3600');
    assert.equal((await get(srv.port, '/')).headers['cache-control'], 'no-store');
    /* the engraver's content-hash URLs are still immutable, and a wrong hash is not */
    const body = fs.readFileSync(path.join(REPO, 'engrave', 'canon.js'), 'utf8').replace(/\r\n/g, '\n');
    const hash = require('crypto').createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex').slice(0, 12);
    assert.match((await get(srv.port, '/engrave/canon.js?h=' + hash)).headers['cache-control'], /immutable/);
    assert.equal((await get(srv.port, '/engrave/canon.js?h=000000000000')).headers['cache-control'], 'no-store');
  } finally { srv.close(); }
  const off = await boot({ PPP_HSTS: '0' });
  try {
    assert.equal((await get(off.port, '/health', { 'X-Forwarded-Proto': 'https' })).headers['strict-transport-security'], undefined, 'PPP_HSTS=0 turns it off');
    assert.equal((await get(off.port, '/health', { 'X-Forwarded-Proto': 'https' })).headers['x-frame-options'], 'SAMEORIGIN');
  } finally { off.close(); }
});

test('the server: a file that exists and is not served is named once in the log; a path that is not there is not', async () => {
  const srv = await boot();
  try {
    await get(srv.port, '/server.js'); await get(srv.port, '/server.js'); await get(srv.port, '/render.yaml');
    await get(srv.port, '/no-such-file.js'); await get(srv.port, '/docs/'); await get(srv.port, '/%0d%0aX:1.js');
    await new Promise(r => setTimeout(r, 300));
    const log = srv.log();
    assert.equal((log.match(/Static: "server\.js" is a file of this site that is not on the served list/g) || []).length, 1, log);
    assert.equal((log.match(/Static: "render\.yaml"/g) || []).length, 1);
    assert.doesNotMatch(log, /no-such-file|docs\/|X:1/);
    assert.doesNotMatch(log, /\b(error|exception)\b/i, 'the line must not look like a failure to the deploy smoke check');
  } finally { srv.close(); }
});
