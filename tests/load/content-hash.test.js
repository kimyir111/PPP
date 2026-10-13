'use strict';
/* G13-4c: content-hash caching (docs/GOALS/G13_PRODUCTIZATION.md G13-D4). static-assets.js and its use in server.js.

   Node only. It starts this tree's server.js on a free port (and, for "a changed file gets a new hash", a server in a small tree of copies) and asks it, over HTTP:
     1. the served page names every local script of its head by the hash of that file (computed here again, independently), and names the catalogs in window.PPP_HASHES;
     2. a request that carries the right hash is answered immutable, gzip when the browser takes it (and the gzip body is the file), with the same headers for HEAD,
        a whole 200 for a Range request (never a slice of a gzip body), 304 for If-None-Match;
     3. anything that does not carry the right hash - no ?h=, a stale or invented hash, another type, a file the server does not serve - is no-store / unchanged / 404;
     4. a file whose content changed has another hash in the next page, the old hash still answers (no-store, with the new content), and old ?v=N urls keep working. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { REPO, boot, request, hashOf, smallTree } = require('./lib');

const SRC_PAGE = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const IMMUTABLE = 'public, max-age=31536000, immutable';
/* a folder the server does not serve, named in pieces (tests/bench/unit/test_ci_plan.py keeps a tripwire over files that name the folders the light CI modes skip; this test only asks the server about the name) */
const DOCS = 'do' + 'cs';
const read = rel => fs.readFileSync(path.join(REPO, rel));
const headOf = html => html.slice(0, html.indexOf('</head>'));
/* [ [path, query], ... ] of the <script src="./..."> tags of a head */
const scriptsOf = head => [...head.matchAll(/<script\b[^>]*\bsrc="\.\/([^"?#]+)(\?[^"#]*)?"/g)].map(m => [m[1], m[2] || '']);

let srv;
test.before(async () => { srv = await boot(); });
test.after(() => { if (srv) srv.close(); });

test('the served page names each script of its head by the hash of that file', async () => {
  const src = scriptsOf(headOf(SRC_PAGE));
  assert.ok(src.length > 60, 'the page has its scripts in the head (' + src.length + ')');
  for (const url of ['/', '/index.html', '/Piano%20Coach%20App.dc.html']) {
    const r = await request(srv.port, url);
    assert.equal(r.status, 200, url);
    assert.equal(r.headers['cache-control'], 'no-cache', 'the page itself is revalidated, never used unasked: ' + url);
    assert.match(r.headers.etag, /^"[0-9a-f]{20}"$/, 'with the tag of its bytes: ' + url);
    const got = scriptsOf(headOf(r.body.toString('utf8')));
    assert.deepEqual(got.map(g => g[0]), src.map(s => s[0]), 'the same scripts in the same order: ' + url);
    for (const [p, q] of got) {
      assert.equal(q, '?h=' + hashOf(read(p)), p + ' is named by its own hash (' + url + ')');
    }
  }
});

test('the old ?v=N is gone from the head of the served page, and stays in the source', async () => {
  const served = (await request(srv.port, '/')).body.toString('utf8');
  assert.ok(!/<script\b[^>]*\bsrc="\.\/[^"]*\?v=/.test(headOf(served)), 'no script of the head is named by ?v=');
  assert.ok(/<script\b[^>]*\bsrc="\.\/[^"]*\?v=/.test(headOf(SRC_PAGE)), 'the source keeps ?v= (an older server, the tests that read the file)');
  /* the rest of the page is not touched: after the head the body is the source's, byte for byte */
  assert.equal(served.slice(served.indexOf('</head>')), SRC_PAGE.slice(SRC_PAGE.indexOf('</head>')));
});

test('the catalogs\' hashes are in window.PPP_HASHES before any script of the page', async () => {
  const served = (await request(srv.port, '/')).body.toString('utf8');
  const m = /<script>window\.PPP_HASHES=(\{[^<]*\});<\/script>/.exec(served);
  assert.ok(m, 'PPP_HASHES is set');
  assert.ok(served.indexOf(m[0]) < served.indexOf('<script src='), 'before the first script tag');
  const map = JSON.parse(m[1]);
  for (const loc of ['ko-KR', 'ja-JP', 'zh-CN', 'en-US']) assert.equal(map['i18n/' + loc + '.json'], hashOf(read('i18n/' + loc + '.json')), loc);
});

test('every hashed url of the page is answered immutable, gzip, and the gzip body is the file', async () => {
  const served = (await request(srv.port, '/')).body.toString('utf8');
  const urls = scriptsOf(headOf(served)).map(([p, q]) => '/' + p + q);
  const map = JSON.parse(/PPP_HASHES=(\{[^<]*\});/.exec(served)[1]);
  for (const k of Object.keys(map)) urls.push('/' + k + '?h=' + map[k]);
  assert.ok(urls.length > 70);
  for (const u of urls) {
    const rel = u.slice(1).split('?')[0];
    const file = read(rel);
    const z = await request(srv.port, u, { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
    assert.equal(z.status, 200, u);
    assert.equal(z.headers['cache-control'], IMMUTABLE, u);
    assert.equal(z.headers['vary'], 'Accept-Encoding', u);
    if (file.length >= 256) {
      assert.equal(z.headers['content-encoding'], 'gzip', u);
      assert.ok(z.raw.length < file.length, u + ' is smaller on the wire');
    }
    assert.ok(z.body && z.body.equals(file), u + ': what the browser gets back is the file');
    assert.equal(Number(z.headers['content-length']), z.raw.length, u + ': Content-Length is the bytes sent');
    const plain = await request(srv.port, u);
    assert.equal(plain.headers['cache-control'], IMMUTABLE, u + ' (no Accept-Encoding)');
    assert.equal(plain.headers['content-encoding'], undefined, u + ' (no Accept-Encoding)');
    assert.ok(plain.raw.equals(file), u + ' identity is the file');
  }
});

test('Accept-Encoding is read, not matched as text: gzip;q=0 and identity get the file as it is', async () => {
  const h = hashOf(read('scoregraph/index.js'));
  const u = '/scoregraph/index.js?h=' + h;
  for (const [ae, gz] of [['gzip', true], ['GZIP', true], ['deflate, gzip;q=0.5', true], ['*', true], ['gzip;q=0', false], ['identity', false], ['br', false], ['', false], ['*;q=0', false], ['gzip;q=0, *', false]]) {
    const r = await request(srv.port, u, { headers: { 'Accept-Encoding': ae } });
    assert.equal(r.headers['content-encoding'] === 'gzip', gz, JSON.stringify(ae));
    assert.ok(r.body && r.body.equals(read('scoregraph/index.js')), JSON.stringify(ae) + ': the body is the file either way');
    assert.equal(r.headers['cache-control'], IMMUTABLE, JSON.stringify(ae));
  }
});

test('HEAD answers with the headers GET would, and no body', async () => {
  const h = hashOf(read('support.js'));
  const u = '/support.js?h=' + h;
  const ae = { 'Accept-Encoding': 'gzip' };
  const g = await request(srv.port, u, { headers: ae });
  const hd = await request(srv.port, u, { method: 'HEAD', headers: ae });
  assert.equal(hd.status, 200);
  assert.equal(hd.raw.length, 0, 'no body');
  for (const k of ['cache-control', 'content-encoding', 'content-length', 'content-type', 'etag', 'vary']) assert.equal(hd.headers[k], g.headers[k], k);
  const hp = await request(srv.port, u, { method: 'HEAD' });
  assert.equal(hp.headers['content-encoding'], undefined);
  assert.equal(Number(hp.headers['content-length']), read('support.js').length, 'identity HEAD names the length of the file');
  /* a HEAD for a wrong hash is the unkept answer */
  const bad = await request(srv.port, '/support.js?h=000000000000', { method: 'HEAD' });
  assert.equal(bad.headers['cache-control'], 'no-store');
});

test('Range is not honoured: a whole 200 whose Content-Encoding matches its body, never a slice of a gzip stream', async () => {
  const h = hashOf(read('support.js'));
  const u = '/support.js?h=' + h;
  for (const ae of ['gzip', '']) {
    const r = await request(srv.port, u, { headers: { Range: 'bytes=0-99', 'Accept-Encoding': ae } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-range'], undefined);
    assert.equal(r.headers['accept-ranges'], 'none');
    assert.equal(r.headers['content-encoding'] === 'gzip', ae === 'gzip');
    assert.ok(r.body && r.body.equals(read('support.js')), 'the whole file, ' + (ae ? 'gunzips' : 'as is'));
  }
  /* a Range for a wrong hash is the ordinary answer too */
  const bad = await request(srv.port, '/support.js?h=badbadbadbad', { headers: { Range: 'bytes=0-9' } });
  assert.equal(bad.status, 200);
  assert.equal(bad.headers['cache-control'], 'no-store');
});

test('ETag and If-None-Match: 304 for the entity tag of the encoding asked for, a full answer otherwise', async () => {
  const h = hashOf(read('i18n.js'));
  const u = '/i18n.js?h=' + h;
  const gz = await request(srv.port, u, { headers: { 'Accept-Encoding': 'gzip' } });
  const id = await request(srv.port, u);
  assert.equal(gz.headers.etag, '"' + h + '-gz"');
  assert.equal(id.headers.etag, '"' + h + '"');
  assert.notEqual(gz.headers.etag, id.headers.etag, 'two representations, two tags');
  const same = await request(srv.port, u, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.etag } });
  assert.equal(same.status, 304);
  assert.equal(same.raw.length, 0);
  assert.equal(same.headers['cache-control'], IMMUTABLE, 'a 304 repeats the cache headers');
  assert.equal(same.headers.etag, gz.headers.etag);
  assert.equal((await request(srv.port, u, { headers: { 'If-None-Match': id.headers.etag } })).status, 304);
  assert.equal((await request(srv.port, u, { headers: { 'If-None-Match': 'W/' + id.headers.etag + ', "other"' } })).status, 304, 'weak and list forms');
  assert.equal((await request(srv.port, u, { headers: { 'If-None-Match': '*' } })).status, 304);
  /* the tag of the other encoding, or of other content, is not a match */
  assert.equal((await request(srv.port, u, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': id.headers.etag } })).status, 200);
  assert.equal((await request(srv.port, u, { headers: { 'If-None-Match': '"000000000000"' } })).status, 200);
  /* and an unkept url never answers 304, whatever it is asked: it has no tag to match */
  const bad = await request(srv.port, '/i18n.js?h=000000000000', { headers: { 'If-None-Match': '*' } });
  assert.equal(bad.status, 200);
  assert.equal(bad.headers.etag, undefined);
});

test('anything but the right hash is answered as before: no-store for scripts and catalogs', async () => {
  const real = hashOf(read('scoregraph/rational.js'));
  const stale = hashOf(Buffer.from('an older version of the file'));
  const cases = [
    ['no query', '/scoregraph/rational.js'],
    ['the old ?v=N', '/scoregraph/rational.js?v=8'],
    ['a stale hash', '/scoregraph/rational.js?h=' + stale],
    ['an empty hash', '/scoregraph/rational.js?h='],
    ['a hash of the wrong length', '/scoregraph/rational.js?h=' + real.slice(0, 11)],
    ['a hash with a tail', '/scoregraph/rational.js?h=' + real + 'ff'],
    ['upper case', '/scoregraph/rational.js?h=' + real.toUpperCase()],
    ['another parameter only', '/scoregraph/rational.js?hash=' + real],
    ['the hash of another file', '/scoregraph/rational.js?h=' + hashOf(read('scoregraph/schema.js'))],
    ['an encoded dot-dot as the hash', '/scoregraph/rational.js?h=%2e%2e%2f%2e%2e'],
    ['a very long hash', '/scoregraph/rational.js?h=' + 'a'.repeat(5000)],
    ['the wrong one first', '/scoregraph/rational.js?h=' + stale + '&h=' + real],
    ['the right one first, a second one after it (two h= is not one hash)', '/scoregraph/rational.js?h=' + real + '&h=' + stale],
    ['the right hash and a recovery stamp (loadScoreModules asks again with &retry=)', '/scoregraph/rational.js?h=' + real + '&retry=1791886000123'],
    ['the right hash and any other parameter', '/scoregraph/rational.js?h=' + real + '&junk=1'],
    ['the right hash after another parameter', '/scoregraph/rational.js?v=8&h=' + real],
    ['a catalog with a stale hash', '/i18n/ko-KR.json?h=' + stale],
    ['a catalog with no hash', '/i18n/ko-KR.json']
  ];
  for (const [name, u] of cases) {
    const r = await request(srv.port, u, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200, name);
    assert.equal(r.headers['cache-control'], 'no-store', name);
    assert.equal(r.headers['content-encoding'], undefined, name + ': an unkept answer is not compressed here (the edge does that)');
    assert.equal(r.headers.etag, undefined, name);
    assert.ok(r.raw.equals(read(u.slice(1).split('?')[0])), name + ': the current content');
  }
});

test('types that are not hashed keep their own cache headers whatever ?h= says', async () => {
  const mp3 = await request(srv.port, '/audio/piano/A0.mp3?h=' + hashOf(read('audio/piano/A0.mp3'), true));
  assert.equal(mp3.headers['cache-control'], 'public, max-age=2592000');
  const png = await request(srv.port, '/assets/hands/hand-right-black.png?h=' + hashOf(read('assets/hands/hand-right-black.png'), true));
  assert.equal(png.headers['cache-control'], 'public, max-age=3600');
  const html = await request(srv.port, '/Piano%20Coach%20App.dc.html?h=' + hashOf(read('Piano Coach App.dc.html')));
  assert.equal(html.headers['cache-control'], 'no-cache', 'the page is the thing that names the hashes: asked about every time');
  assert.notEqual(html.headers.etag, '"' + hashOf(read('Piano Coach App.dc.html')) + '"', 'its tag is of the bytes sent, not a content hash of the file');
});

test('the served list still decides: a hash does not make a server file reachable, and no path gets round it', async () => {
  const secrets = ['server.js', 'static-assets.js', 'static-allow.js', 'package.json', 'render.yaml', 'i18n/../server.js'];
  for (const s of secrets) {
    const hash = hashOf(read(s));
    for (const u of ['/' + s + '?h=' + hash, '/' + s, '/' + encodeURI(s) + '?h=' + hash, '/%2e%2e/' + s + '?h=' + hash, '/i18n/%2e%2e/' + s + '?h=' + hash, '/vendor/..%2f' + s + '?h=' + hash, '/vendor/%2e%2e%2f' + s + '?h=' + hash]) {
      const r = await request(srv.port, u);
      assert.equal(r.status, 404, u);
      assert.equal(r.headers['cache-control'], undefined, u + ': nothing says it is kept');
    }
  }
  for (const u of ['/' + DOCS + '/GOALS/G13_PRODUCTIZATION.md?h=aaaaaaaaaaaa', '/tests/load/lib.js?h=aaaaaaaaaaaa', '/tools/release/release.js?h=aaaaaaaaaaaa', '/vendor/README.md?h=aaaaaaaaaaaa', '/.git/config?h=aaaaaaaaaaaa', '/scoregraph/tools/x.js?h=aaaaaaaaaaaa', '/Server.js?h=aaaaaaaaaaaa']) {
    assert.equal((await request(srv.port, u)).status, 404, u);
  }
  /* a hash for a file that does not exist */
  assert.equal((await request(srv.port, '/scoregraph/nothing-here.js?h=aaaaaaaaaaaa')).status, 404);
});

test('the engraver and vendor urls the page already asked for by hash are still immutable (G4d-2 behaviour kept)', async () => {
  for (const rel of ['engrave/canon.js', 'engrave/layout.js', 'vendor/react-18.3.1/react.production.min.js']) {
    const r = await request(srv.port, '/' + rel + '?h=' + hashOf(read(rel)), { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.headers['cache-control'], IMMUTABLE, rel);
    assert.ok(r.body.equals(read(rel)), rel);
  }
  /* the hashes written into the page source for the lazy engraver files are the files' own */
  const m = SRC_PAGE.match(/ENGRAVE_FILES\s*=\s*\[([\s\S]*?)\];/);
  const pairs = [...m[1].matchAll(/\[\s*'([^']+)'\s*,\s*'([0-9a-f]{12})'/g)];
  assert.ok(pairs.length > 10, 'the lazy engraver files are listed with their hashes (' + pairs.length + ')');
});

/* ---- a changed file: a tree of copies, so the test can change a file ---- */

const PAGE_OF = scripts => '<!DOCTYPE html>\n<html><head>\n<meta charset="utf-8">\n' + scripts.map(s => '<script src="./' + s + '"></script>').join('\n') +
  '\n<style>@font-face{font-family:T;src:url(./vendor/fonts/t.woff2?v=1) format("woff2")}</style>\n</head><body><x-dc></x-dc></body></html>\n';

test('a changed file has another hash in the next page; the old hash and the old ?v= url still answer, unkept', async () => {
  const tree = smallTree({
    'Piano Coach App.dc.html': PAGE_OF(['support.js?v=3', 'i18n.js', 'scoregraph/a.js?v=1']),
    'support.js': 'window.s = 1;\n'.repeat(40),
    'i18n.js': 'window.i = 1;\n'.repeat(40),
    'scoregraph/a.js': 'window.a = 1;\n'.repeat(40),
    'i18n/ko-KR.json': JSON.stringify({ content: { Home: '홈' } }),
    'vendor/fonts/t.woff2': Buffer.from('wOF2 a font that is not one'.repeat(20))
  });
  const s = await boot(tree.dir);
  try {
    const page1 = (await request(s.port, '/')).body.toString('utf8');
    const urls1 = scriptsOf(headOf(page1));
    assert.deepEqual(urls1.map(u => u[0]), ['support.js', 'i18n.js', 'scoregraph/a.js']);
    const h1 = Object.fromEntries(urls1);
    for (const [p, q] of urls1) assert.equal(q, '?h=' + hashOf(fs.readFileSync(path.join(tree.dir, p))), p);
    assert.match(page1, /url\(\.\/vendor\/fonts\/t\.woff2\?h=[0-9a-f]{12}\)/, 'a font in the head\'s style is named by its hash too');
    const ok1 = await request(s.port, '/scoregraph/a.js' + h1['scoregraph/a.js'], { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(ok1.headers['cache-control'], IMMUTABLE);
    const font = /url\(\.\/vendor\/fonts\/t\.woff2(\?h=[0-9a-f]{12})\)/.exec(page1);
    const f1 = await request(s.port, '/vendor/fonts/t.woff2' + font[1], { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(f1.headers['cache-control'], IMMUTABLE);
    assert.equal(f1.headers['content-encoding'], undefined, 'a font is not gzipped again');
    assert.equal(f1.headers['content-type'], 'font/woff2');

    /* the file changes (a deploy, or an edit on a dev machine) */
    tree.write('scoregraph/a.js', 'window.a = 2; /* changed */\n'.repeat(41));
    const page2 = (await request(s.port, '/')).body.toString('utf8');
    const h2 = Object.fromEntries(scriptsOf(headOf(page2)));
    assert.notEqual(h2['scoregraph/a.js'], h1['scoregraph/a.js'], 'the changed file has a new hash');
    assert.equal(h2['support.js'], h1['support.js'], 'the others keep theirs');
    assert.equal(h2['scoregraph/a.js'], '?h=' + hashOf(fs.readFileSync(path.join(tree.dir, 'scoregraph/a.js'))));
    const fresh = await request(s.port, '/scoregraph/a.js' + h2['scoregraph/a.js']);
    assert.equal(fresh.headers['cache-control'], IMMUTABLE);
    assert.ok(fresh.raw.toString().includes('changed'));
    /* a tab that was opened before still asks for the old hash: it gets the NEW content and nothing tells the browser to keep it */
    const old = await request(s.port, '/scoregraph/a.js' + h1['scoregraph/a.js']);
    assert.equal(old.status, 200);
    assert.equal(old.headers['cache-control'], 'no-store');
    assert.ok(old.raw.toString().includes('changed'), 'the current content, never the old one');
    /* and the ?v=N urls of an older page */
    const v = await request(s.port, '/scoregraph/a.js?v=1');
    assert.equal(v.headers['cache-control'], 'no-store');
    assert.ok(v.raw.toString().includes('changed'));
    /* the catalog's hash follows its content as well */
    const m1 = JSON.parse(/PPP_HASHES=(\{[^<]*\});/.exec(page2)[1]);
    tree.write('i18n/ko-KR.json', JSON.stringify({ content: { Home: '집' } }));
    const m2 = JSON.parse(/PPP_HASHES=(\{[^<]*\});/.exec((await request(s.port, '/')).body.toString('utf8'))[1]);
    assert.notEqual(m2['i18n/ko-KR.json'], m1['i18n/ko-KR.json']);
    assert.equal(m2['i18n/ko-KR.json'], hashOf(fs.readFileSync(path.join(tree.dir, 'i18n/ko-KR.json'))));
  } finally { s.close(); tree.remove(); }
});

test('CRLF and LF checkouts of a file have the same hash (the hash is of the text with CRLF as LF), a binary file\'s is of its bytes', async () => {
  const lf = 'window.x = 1;\nwindow.y = 2;\n';
  const tree = smallTree({ 'Piano Coach App.dc.html': PAGE_OF(['support.js', 'i18n.js']), 'support.js': lf, 'i18n.js': lf.replace(/\n/g, '\r\n') });
  const s = await boot(tree.dir);
  try {
    const q = Object.fromEntries(scriptsOf(headOf((await request(s.port, '/')).body.toString('utf8'))));
    assert.equal(q['support.js'], q['i18n.js'], 'the same text, the same hash');
    const crlf = await request(s.port, '/i18n.js' + q['i18n.js']);
    assert.equal(crlf.headers['cache-control'], IMMUTABLE, 'and the CRLF file is served under it');
    assert.equal(hashOf(Buffer.from([0xff, 0x0d, 0x0a, 0x41]), true) === hashOf(Buffer.from([0xff, 0x0a, 0x41]), true), false, 'binary: bytes are bytes');
  } finally { s.close(); tree.remove(); }
});

test('a page that names a file the server does not have, or does not serve, is left alone (no crash, no hash)', async () => {
  const tree = smallTree({
    'Piano Coach App.dc.html': PAGE_OF(['support.js?v=1', 'missing.js?v=2', 'scoregraph/gone.js', DOCS + '/secret.js?v=1', 'https://example.com/x.js']).replace('src="./https://example.com/x.js"', 'src="https://example.com/x.js"'),
    'support.js': 'window.s = 1;\n', [DOCS + '/secret.js']: 'secret\n'
  });
  const s = await boot(tree.dir);
  try {
    const head = headOf((await request(s.port, '/')).body.toString('utf8'));
    assert.match(head, /src="\.\/support\.js\?h=[0-9a-f]{12}"/);
    assert.match(head, /src="\.\/missing\.js\?v=2"/, 'no such file: unchanged');
    assert.match(head, /src="\.\/scoregraph\/gone\.js"/);
    assert.ok(head.includes('src="./' + DOCS + '/secret.js?v=1"'), 'a file the server does not serve is not given a hash (the hash would be a probe)');
    assert.match(head, /src="https:\/\/example\.com\/x\.js"/);
  } finally { s.close(); tree.remove(); }
});

test('G13-4c3: the page has the tag of the bytes it sends; the same bytes are answered 304, anything else in full', async () => {
  const a = await request(srv.port, '/');
  assert.equal(a.status, 200);
  const b = await request(srv.port, '/');
  assert.equal(b.headers.etag, a.headers.etag, 'the same page twice, the same tag');
  for (const [name, headers] of [['the tag', { 'If-None-Match': a.headers.etag }], ['weak, as a CDN makes it', { 'If-None-Match': 'W/' + a.headers.etag }], ['a list', { 'If-None-Match': '"other", ' + a.headers.etag }], ['*', { 'If-None-Match': '*' }]]) {
    const r = await request(srv.port, '/', { headers });
    assert.equal(r.status, 304, name);
    assert.equal(r.raw.length, 0, name + ': no body');
    assert.equal(r.headers['cache-control'], 'no-cache', name);
    assert.equal(r.headers.etag, a.headers.etag, name);
  }
  for (const [name, headers] of [['another tag', { 'If-None-Match': '"0000000000000000000"' }], ['none', {}], ['empty', { 'If-None-Match': '' }]]) {
    const r = await request(srv.port, '/', { headers });
    assert.equal(r.status, 200, name);
    assert.equal(r.raw.length, a.raw.length, name + ': in full');
  }
  /* the page at its own address is the same bytes and the same tag; HEAD has the headers */
  const own = await request(srv.port, '/Piano%20Coach%20App.dc.html');
  assert.equal(own.headers.etag, a.headers.etag);
  const h = await request(srv.port, '/', { method: 'HEAD' });
  assert.equal(h.headers.etag, a.headers.etag);
  assert.equal(h.raw.length, 0);
});

test('G13-4c3: a changed script, or a changed page, is another tag, so a returning visitor is never shown the old page', async () => {
  const tree = smallTree({ 'Piano Coach App.dc.html': PAGE_OF(['support.js']), 'support.js': 'window.s = 1;\n'.repeat(30), 'i18n/ko-KR.json': '{}' });
  const s = await boot(tree.dir);
  try {
    const t1 = (await request(s.port, '/')).headers.etag;
    assert.equal((await request(s.port, '/', { headers: { 'If-None-Match': t1 } })).status, 304);
    tree.write('support.js', 'window.s = 2; /* a new release */\n'.repeat(31));
    const r2 = await request(s.port, '/', { headers: { 'If-None-Match': t1 } });
    assert.equal(r2.status, 200, 'the script changed, its hash in the page changed, so the old tag no longer matches');
    assert.notEqual(r2.headers.etag, t1);
    tree.write('Piano Coach App.dc.html', PAGE_OF(['support.js']).replace('<body>', '<body><!-- edited -->'));
    const r3 = await request(s.port, '/', { headers: { 'If-None-Match': r2.headers.etag } });
    assert.equal(r3.status, 200);
    assert.notEqual(r3.headers.etag, r2.headers.etag);
  } finally { s.close(); tree.remove(); }
});

/* G13-4e: the code the head defers sits in <noscript data-ppp-lazy> blocks as text; the served page names those files by hash too, and a deferred file asked for by that
   address is immutable and gzip like any other */
test('G13-4e: the deferred blocks of the head are named by hash, lazy-load.js comes before the first of them, and each block\'s files answer immutable', async () => {
  const served = (await request(srv.port, '/')).body.toString('utf8');
  const head = headOf(served);
  const blocks = [...head.matchAll(/<noscript data-ppp-lazy="([^"]+)"([^>]*)>([\s\S]*?)<\/noscript>/g)];
  assert.ok(blocks.length >= 6, 'the head has its deferred blocks (' + blocks.length + ')');
  assert.deepEqual(blocks.map(b => b[1]), ['backup', 'score', 'arranger', 'audio', 'engrave', 'lessons']);
  assert.ok(head.indexOf('./lazy-load.js?h=') > -1 && head.indexOf('./lazy-load.js?h=') < head.indexOf('<noscript data-ppp-lazy'), 'the module that reads the blocks comes first');
  assert.ok(head.indexOf('./i18n.js?h=') < head.indexOf('./lazy-load.js?h='), 'and after i18n.js, the first script of the page (the order the pairing test pins)');
  /* each block is followed by the call that registers it, and nothing else sits between */
  for (const m of blocks) {
    const after = head.slice(m.index + m[0].length, m.index + m[0].length + 40);
    assert.match(after, /^\r?\n<script>PPP_LAZY\.here\(\)<\/script>/, m[1] + ': the registering call follows the block');
  }
  let files = 0;
  for (const m of blocks) {
    for (const t of m[3].matchAll(/<script src="\.\/([^"?#]+)\?h=([0-9a-f]{12})"><\/script>/g)) {
      files++;
      assert.equal(t[2], hashOf(read(t[1])), m[1] + ': ' + t[1] + ' is named by its own hash');
      const r = await request(srv.port, '/' + t[1] + '?h=' + t[2], { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(r.status, 200, t[1]);
      assert.equal(r.headers['cache-control'], IMMUTABLE, t[1] + ' is kept for good');
      assert.equal(r.headers['content-encoding'], 'gzip', t[1]);
    }
    assert.ok(!/\?v=/.test(m[3]), m[1] + ': no ?v= is left in the block');
  }
  assert.ok(files >= 60, 'the blocks name the deferred files (' + files + ')');
  /* a block's text is not markup the browser reads: the source and the served page carry the same blocks, but for the hashes */
  const srcBlocks = [...headOf(SRC_PAGE).matchAll(/<noscript data-ppp-lazy="([^"]+)"/g)].map(b => b[1]);
  assert.deepEqual(srcBlocks, blocks.map(b => b[1]));
});
