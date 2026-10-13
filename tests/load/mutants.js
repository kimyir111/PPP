/* G13-4 mutation checks. A small copy of the tree is made, ONE rule of the load-performance work is broken in it, and the tests that should notice are run against the copy
   (PPP_LOAD_ROOT, see lib.js): a mutant that survives is a rule nothing tests. The repository's own files are never touched.

     node tests/load/mutants.js            run them all (and the unmutated copy, which must pass)
     node tests/load/mutants.js C3 A1      only these

   Exit code 0 when every mutant is killed. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SERVER = ['server.js', 'static-allow.js', 'static-assets.js', 'share-guest.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'signup-limit.js', 'server-stats.js'];
const ROOT_FILES = ['Piano Coach App.dc.html', 'i18n.js', 'lazy-load.js', 'support.js', 'lessons.js', 'course.js', 'score-search.js', 'library-backup.js', 'audio-score.js', 'package.json', 'render.yaml'];
const DIRS = ['scoregraph', 'playability', 'difficulty', 'songgraph', 'arrangement', 'realize', 'engrave', 'vendor', 'i18n', 'candidates', 'critics', 'repair', 'rec'];
const SINGLES = ['audio/piano/A0.mp3', 'assets/hands/hand-right-black.png', 'catalog/shared-seeds.json', 'catalog/hymns/all-creatures.musicxml', 'difficulty/tools/dataset/method-books.json'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'tools' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-mut-'));
  for (const f of SERVER.concat(ROOT_FILES)) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  for (const d of DIRS) copyDir(path.join(REPO, d), path.join(dir, d));
  for (const f of SINGLES) {
    if (!fs.existsSync(path.join(REPO, f))) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  }
  return dir;
}

const SPLITN = 'lazy-load.test.js', SPLITB = 'load-app/split.test.js';
const LAZY = 'i18n-lazy.test.js', HASH = 'content-hash.test.js', FONTS = 'fonts.test.js', SAMPLES = 'load-app/samples.test.js', TEMPLATE = 'load-app/template.test.js', CJK = 'load-app/cjk-fonts.test.js';

/* id, file, what the mutant breaks, [from, to] or a list of them (each replaced once), the test that must fail */
const M = [
  /* G13-4a: i18n.js */
  ['A1', 'i18n.js', 'every catalog is fetched at boot again (the old behaviour)', ["var ready = load(locale);", "var ready = Promise.all(SUPPORTED.map(function (l) { return load(l); }));"], LAZY],
  ['A2', 'i18n.js', 'English waits for a catalog it does not have', ["loaded[DEFAULT_LOCALE] = true;", "loaded[DEFAULT_LOCALE] = false;"], LAZY],
  ['A3', 'i18n.js', 'a switch tells the listeners before the catalog is in (they translate nothing)', ["wait.then(function () { if (mine === switchSeq) fire(next); });", "fire(next); wait.then(function () { if (mine === switchSeq) fire(next); });"], LAZY],
  ['A4', 'i18n.js', 'a switch that was overtaken is still announced', ["if (mine === switchSeq) fire(next);", "fire(next);"], LAZY],
  ['A5', 'i18n.js', 'a catalog already fetched is fetched again at every switch', ["if (loaded[loc]) return Promise.resolve();\n    if (pending[loc]) return pending[loc];", "if (pending[loc]) return pending[loc];"], LAZY],
  ['A6', 'i18n.js', 'a catalog that failed is never asked for again', ["      .then(function () { pending[loc] = null; });", "      .then(function () { /* pending stays */ });"], LAZY],
  ['A7', 'i18n.js', 'ready stays the first catalog\'s promise after a switch', ["if (global.PPP_I18N) global.PPP_I18N.ready = wait;", ""], LAZY],
  ['H1', 'i18n.js', 'an answer that is not 2xx is taken for an (empty) catalog: English until a reload', ["if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();", "return r.ok ? r.json() : { content: {} };"], LAZY],
  ['H2', 'i18n.js', 'the retries have no end', ["if (loaded[loc] || retrying[loc] || n >= RETRY_MS.length) return;", "if (loaded[loc] || retrying[loc]) return; n = Math.min(n, RETRY_MS.length - 1);"], LAZY],
  ['H3', 'i18n.js', 'a catalog that arrives by a retry is not told to the listeners (the page stays English)', ["if (locale === loc) fire(loc);", ""], LAZY],
  ['H4', 'i18n.js', 'a catalog that arrives by a retry is announced although the person has gone to another language', ["if (locale === loc) fire(loc);", "fire(loc);"], LAZY],
  /* G13-4b: the page's head and vendor/fonts */
  ['B1', 'Piano Coach App.dc.html', 'a font face blocks text again (display: block)', ["font-weight:700;font-display:swap;src:url(./vendor/fonts/figtree-v9-latin.woff2", "font-weight:700;font-display:block;src:url(./vendor/fonts/figtree-v9-latin.woff2"], FONTS],
  ['B2', 'Piano Coach App.dc.html', 'a weight range replaces Google\'s steps (650 would draw as 650, not 700)', ["font-weight:600;font-display:swap;src:url(./vendor/fonts/figtree-v9-latin.woff2", "font-weight:400 700;font-display:swap;src:url(./vendor/fonts/figtree-v9-latin.woff2"], FONTS],
  ['B3', 'Piano Coach App.dc.html', 'a blocking stylesheet from another site is back in the template', ["<helmet>", "<helmet>\n<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+KR&display=swap\" rel=\"stylesheet\" />"], FONTS],
  ['B4', 'Piano Coach App.dc.html', 'the CJK stylesheet is asked for at once, not after load', ["if (document.readyState === 'complete') later(); else window.addEventListener('load', later);", "add();"], FONTS],
  ['B5', 'Piano Coach App.dc.html', 'the CJK request names the Latin families too (fetched twice)', ["family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Sans+JP", "family=Figtree&family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Sans+JP"], FONTS],
  ['B6', 'vendor/README.md', 'a font\'s sha256 in the README is not the file\'s', ["| `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd` |", "| `0ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd` |"], FONTS],
  ['B7', 'Piano Coach App.dc.html', 'the unicode-range of a latin face is not Google\'s (a glyph would not use it)', ["unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}\n@font-face{font-family:'Instrument Serif';font-style:italic", "unicode-range:U+0000-007F}\n@font-face{font-family:'Instrument Serif';font-style:italic"], FONTS],
  ['B8', 'Piano Coach App.dc.html', 'a Google link of the helmet is removed (the template has one element fewer: every data-dc-tpl stamp shifts)', ["<link rel=\"dns-prefetch\" href=\"https://fonts.googleapis.com\" />", ""], FONTS],
  ['B9', 'Piano Coach App.dc.html', 'a font is preloaded from the body (the browser finds it at once and it takes bandwidth from the scripts)', ["<link rel=\"dns-prefetch\" href=\"https://fonts.googleapis.com\" />", "<link rel=\"preload\" as=\"font\" type=\"font/woff2\" crossorigin=\"anonymous\" href=\"./vendor/fonts/figtree-v9-latin.woff2?v=1\" />"], FONTS],
  ['F1', 'Piano Coach App.dc.html', 'an installed Noto family is asked for anyway (it shadows the installed font while it loads)', ["if (!(a === b && (a !== m || b !== s))) return false;", "return false;"], CJK],
  ['F2', 'Piano Coach App.dc.html', 'a regular-only install counts (the bold would be faked)', ["return r !== w('400 40px monospace', latin) && w('700 40px \"' + name + '\", monospace', latin) !== r;", "return r !== w('400 40px monospace', latin);"], CJK],
  ['F3', 'Piano Coach App.dc.html', 'with every family installed the stylesheet is still asked for', ["return parts.length ? CJK.split('?')[0] + '?' + parts.join('&') + '&display=swap' : null;", "return CJK;"], CJK],
  /* G13-4d: the piano recordings, in the app's componentDidMount (a browser test: load-app/samples.test.js; not part of the unmutated-copy check above) */
  ['D1', 'Piano Coach App.dc.html', 'the recordings are asked for at mount again (not after the load event)', ["if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });", "go();"], SAMPLES],
  ['D2', 'Piano Coach App.dc.html', 'the recordings do not wait for the CJK stylesheet', ["idle(() => fontsIn().then(go))", "idle(go)"], SAMPLES],
  ['D3', 'Piano Coach App.dc.html', 'a stylesheet that never answers holds the recordings for ever', ["Promise.race([Promise.all([window.PPP_CJK_SETTLED, codeIn()]), new Promise(r => setTimeout(r, 7000))])", "Promise.all([window.PPP_CJK_SETTLED, codeIn()])"], SAMPLES],
  ['D4', 'Piano Coach App.dc.html', 'a tap no longer starts the recordings', ["this._wakeAt = (window.performance || Date).now();\n    PianoSamples.load();\n    if (!ac) return;", "this._wakeAt = (window.performance || Date).now();\n    if (!ac) return;"], SAMPLES],
  ['D5', 'Piano Coach App.dc.html', 'no stand-in: a note with no recording in is silent', ["    } else {\n      this.synth(voice, midi, t, peak, tone);\n    }", "    } else {\n      voice.srcs.push(ac.createBufferSource());\n    }"], SAMPLES],
  /* G13-4c (template re-fetch): the line in the head that turns the runtime's second fetch of the page off */
  ['E1', 'Piano Coach App.dc.html', 'the runtime fetches the page a second time again', ["<script>window.__resources = window.__resources || {};", "<script>window.__noResources = window.__resources || {};"], TEMPLATE],
  /* G13-4c3 (PR 2): the page's ETag */
  ['P1', 'server.js', 'the page\'s tag is not of its bytes (a new release is answered 304)', ["const etag = '\"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 20) + '\"';", "const etag = '\"00000000000000000000\"';"], HASH],
  ['P2', 'server.js', 'the page is answered 304 whatever tag the browser has', ["if (assets.ifNoneMatchHas(req.headers['if-none-match'], etag)) return send(res, 304, Buffer.alloc(0), headers);", "if (req.headers['if-none-match']) return send(res, 304, Buffer.alloc(0), headers);"], HASH],
  ['P3', 'server.js', 'the page is kept for an hour without asking', ["const headers = { 'Cache-Control': 'no-cache', 'ETag': etag };", "const headers = { 'Cache-Control': 'public, max-age=3600', 'ETag': etag };"], HASH],
  ['G1', 'static-assets.js', 'a request with other parameters beside the right hash is answered immutable (a retry stamp fills the cache)', ["return keys.length === 1 && keys[0] === 'h' ? searchParams.get('h') : null;", "return searchParams.get('h');"], HASH],
  ['G2', 'static-assets.js', 'a second h= is read as long as the first one is right', ["return keys.length === 1 && keys[0] === 'h' ? searchParams.get('h') : null;", "return keys[0] === 'h' ? searchParams.get('h') : null;"], HASH],
  /* G13-4c: static-assets.js, server.js, i18n.js */
  ['C1', 'server.js', 'a wrong hash is answered immutable (any ?h= is believed)', ["if (e.hash === want) {", "if (true) {"], HASH],
  ['C2', 'static-assets.js', 'the hash ignores the content', [".update(body).digest('hex').slice(0, 12)", ".update('same').digest('hex').slice(0, 12)"], HASH],
  ['C3', 'static-assets.js', 'the hash of a text file depends on CRLF vs LF', ["Buffer.from(buf.toString('utf8').replace(/\\r\\n/g, '\\n'), 'utf8')", "buf"], HASH],
  ['C4', 'static-assets.js', 'the page is not rewritten (scripts keep ?v=N, no hashes)', ["let out = cut < 0 ? text : rewriteHead(text.slice(0, cut), root) + text.slice(cut);", "let out = text;"], HASH],
  ['C5', 'static-assets.js', 'gzip is sent whatever the browser said', ["&& acceptsGzip(req.headers['accept-encoding']);", "&& true;"], HASH],
  ['C6', 'static-assets.js', 'gzip;q=0 is read as gzip (the header is matched as text)', ["if (name !== 'gzip' && name !== '*') continue;\n    let q = 1;", "if (name !== 'gzip' && name !== '*') continue;\n    let q = 1; return true;"], HASH],
  ['C7', 'static-assets.js', 'one entity tag for both encodings', ["const etag = '\"' + e.hash + (gz ? '-gz' : '') + '\"';", "const etag = '\"' + e.hash + '\"';"], HASH],
  ['C8', 'static-assets.js', 'an answer says gzip but sends the plain bytes', ["if (gz) { body = await gzipOnce(e, buf); headers['Content-Encoding'] = 'gzip'; }", "if (gz) { headers['Content-Encoding'] = 'gzip'; }"], HASH],
  ['C9', 'static-assets.js', 'the hash of a file is kept for ever (a changed file keeps its old hash)', ["if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;\n  const e = { mtimeMs: st.mtimeMs, size: st.size, hash: hashBytes(", "if (c) return c;\n  const e = { mtimeMs: st.mtimeMs, size: st.size, hash: hashBytes("], HASH],
  ['C10', 'static-assets.js', 'mp3 and pictures become hashable', ["const HASHABLE = new Set(['.js', '.json', '.css', '.woff2', '.woff']);", "const HASHABLE = new Set(['.js', '.json', '.css', '.woff2', '.woff', '.mp3', '.png']);"], HASH],
  ['C12', 'server.js', 'the served list is not asked (a server file is handed out)', ["if (!staticAllow.isServed(rel)) { noteNotServed(abs, rel); return jsonError(res, 404, 'Not found'); }", "if (false) { noteNotServed(abs, rel); return jsonError(res, 404, 'Not found'); }"], HASH],
  ['C13', 'static-assets.js', 'a file the server does not serve gets a hash in the page (a probe)', ["if (!HASHABLE.has(path.extname(r).toLowerCase()) || !allow.isServed(r)) return null;", "if (!HASHABLE.has(path.extname(r).toLowerCase())) return null;"], HASH],
  ['C14', 'static-assets.js', 'a Range request gets a slice of the (gzip) body', ["let body = buf;\n  if (gz)", "let body = buf;\n  if (req.headers.range) return { status: 206, headers: Object.assign(headers, { 'Content-Range': 'bytes 0-9/' + buf.length }), body: buf.slice(0, 10) };\n  if (gz)"], HASH],
  ['C15', 'static-assets.js', 'the catalogs\' hashes are not in the page', ["const tag = '<script>window.PPP_HASHES=' + JSON.stringify(hashMap(root)) + ';</script>';", "const tag = '<script>window.PPP_HASHES={};</script>';"], HASH],
  ['C16', 'static-assets.js', 'the body of the page after the head is changed', ["let out = cut < 0 ? text : rewriteHead(text.slice(0, cut), root) + text.slice(cut);", "let out = cut < 0 ? text : rewriteHead(text.slice(0, cut), root) + text.slice(cut).replace(/\?v=/g, '?h=');"], HASH],
  ['C17', 'static-assets.js', 'HEAD or GET with the wrong Content-Length for a gzip body', ["headers['Content-Length'] = body.length;", "headers['Content-Length'] = buf.length;"], HASH],
  ['C21', 'static-assets.js', 'a woff2 is gzipped again', ["&& !/^font\\//.test(type) && acceptsGzip", "&& acceptsGzip"], HASH],
  ['C18', 'i18n.js', 'a hashed catalog is fetched with cache: no-store (the browser never keeps it)', ["fetch(url, /[?]h=[0-9a-f]{12}$/.test(url) ? undefined : { cache: 'no-store' })", "fetch(url, { cache: 'no-store' })"], LAZY],
  ['C19', 'i18n.js', 'the catalog url ignores window.PPP_HASHES', ["var hash = hashes && hashes['i18n/' + loc + '.json'];", "var hash = null;"], LAZY],
  ['C20', 'i18n.js', 'the hash of i18n.js itself is passed on as the catalog\'s', [".replace(/\\?$|#$/, '').replace(/\\?h=[0-9a-f]+/, '')", ".replace(/\\?$|#$/, '')"], LAZY],
  /* G13-4e: lazy-load.js (the module, tests/load/lazy-load.test.js) */
  ['L1', 'lazy-load.js', 'a read of a global before its group is in answers undefined (no safety net)', ["loadSync(m.group, name);", ";"], SPLITN],
  ['L2', 'lazy-load.js', 'the safety net loads a group without what it needs first', ["var list = closure([g.name]);", "var list = [g];"], SPLITN],
  ['L3', 'lazy-load.js', 'a failed file is not asked for again', ["return afterPaint().then(attempt).then(function (ok) { return ok ? true : attempt(); });", "return afterPaint().then(attempt);"], SPLITN],
  ['L4', 'lazy-load.js', 'the second ask is for the same url (a cached failure would answer it)', ["function urlOf(f) { return f.failures ? withRetry(f.url) : f.url; }", "function urlOf(f) { return f.url; }"], SPLITN],
  ['L5', 'lazy-load.js', 'a group runs before the group it needs', ["var deps = g.after.map(function (n) { return byName[n]; }).filter(Boolean);", "var deps = [];"], SPLITN],
  ['L6', 'lazy-load.js', 'a group whose scripts did not make its globals counts as in', ["if (!g.globals.every(present)) {", "if (false) {"], SPLITN],
  ['L7', 'lazy-load.js', 'off still defers (the blocks are not written back)', ["if (mode === 'off') {\n      if (doc.readyState", "if (false) {\n      if (doc.readyState"], SPLITN],
  ['L8', 'lazy-load.js', 'off writes the blocks after the page was parsed (document.write would blank it)', ["if (doc.readyState === 'loading') doc.write(el.textContent);", "doc.write(el.textContent);"], SPLITN],
  ['L9', 'lazy-load.js', 'a remembered value that is garbage is taken for a choice', ["return m === 'on' || m === 'off' ? m : DEFAULT;", "return m || DEFAULT;"], SPLITN],
  ['L10', 'lazy-load.js', 'peek loads the group (a readiness check starts a download)', ["function peek(name) { return managed[name] ? managed[name].value : win[name]; }", "function peek(name) { return win[name]; }"], SPLITN],
  ['L11', 'lazy-load.js', 'the prefetch does not wait for the first paint', ["afterPaint().then(function () {\n      drain()", "Promise.resolve().then(function () {\n      drain()"], SPLITN],
  ['L12', 'lazy-load.js', 'ensure does not wait for the first paint', ["return afterPaint().then(attempt).then(", "return attempt().then("], SPLITN],
  ['L13', 'lazy-load.js', 'a download in flight is not shared (a second ask fetches every file again)', ["if (g.fetching) return g.fetching;", ""], SPLITN],
  ['L15', 'lazy-load.js', 'the accessors stay after the group is in', ["g.globals.forEach(unmanage);", ""], SPLITN],
  ['L16', 'lazy-load.js', 'a read from inside a running file starts a load of its own', ["if (mode !== 'on' || g.done || evaluating) return;", "if (mode !== 'on' || g.done) return;"], SPLITN],
  ['L17', 'lazy-load.js', 'a refused synchronous load is asked again at every read', ["if (g.syncFailedAt && Date.now() - g.syncFailedAt < 5000) return;", ""], SPLITN],
  ['L18', 'lazy-load.js', 'a tab in the background waits for ever for a paint', ["win.setTimeout(fire, hidden ? 1000 : 10000);", "win.setTimeout(fire, 1e9);"], SPLITN],
  ['L19', 'lazy-load.js', 'the first-paint entry (a blank paint) is taken for Home', ["if (es[i].name === 'first-contentful-paint') {", "if (es[i].name === 'first-paint' || es[i].name === 'first-contentful-paint') {"], SPLITN],
  ['L20', 'lazy-load.js', 'an engine that does not report paint timing is waited on for ten seconds', ["try { reports = !!win.PerformanceObserver && (win.PerformanceObserver.supportedEntryTypes || []).indexOf('paint') >= 0; } catch (e) { reports = false; }", "reports = true;"], SPLITN],
  ['L21', 'lazy-load.js', 'a namespace that the first file of a group made is handed out half built', ["if (!m.group.done) loadSync(m.group, name);", "if (m.value === undefined && !m.group.done) loadSync(m.group, name);"], SPLITN],
  /* G13-4e: the page's use of it (a browser test: load-app/split.test.js) */
  ['S1', 'Piano Coach App.dc.html', 'a drawing waits for every group, the arranger and audio-score.js too', ["function loadEngrave() {\n  let wait = null;\n  if (lazyOn()) {", "function loadEngrave() {\n  let wait = null;\n  if (false) {"], SPLITB],
  ['S2', 'Piano Coach App.dc.html', 'the readiness check reads a global (it loads the library at the first commit)', ["lazyPeek('PPPScoreGraph') && lazyPeek('PPPAudioScore')", "window.PPPScoreGraph && lazyPeek('PPPAudioScore')"], SPLITB],
  ['S3', 'Piano Coach App.dc.html', 'loadScoreModules does not ask for the groups (an import runs on the safety net)', ["window.PPP_LAZY.ensure(LAZY_SCORE_GROUPS).then(ok => {", "Promise.resolve(true).then(ok => {"], SPLITB],
  ['S4', 'Piano Coach App.dc.html', 'the backup module is loaded at every boot, not only for the note of a restore', ["    try { if (!window.sessionStorage.getItem('ppp-backup-flash')) return; } catch (e) { return; }\n", ""], SPLITB],
  ['S6', 'Piano Coach App.dc.html', 'PPP.split says on whatever this load did', ["get split() { return window.PPP_LAZY ? window.PPP_LAZY.mode : 'off'; },", "get split() { return 'on'; },"], SPLITB],
  ['S7', 'Piano Coach App.dc.html', 'the rest of the code is never prefetched', ["if (lazyOn()) window.PPP_LAZY.start();", ""], SPLITB],
  ['S8', 'Piano Coach App.dc.html', 'the piano recordings do not wait for the code', ["Promise.race([Promise.all([window.PPP_CJK_SETTLED, codeIn()]), new Promise(r => setTimeout(r, 7000))])", "Promise.race([window.PPP_CJK_SETTLED, new Promise(r => setTimeout(r, 7000))])"], SPLITB],
  ['S10', 'Piano Coach App.dc.html', 'the head names the score library as a plain script again (it is fetched before the paint)', ["<noscript data-ppp-lazy=\"score\" data-globals=\"PPPScoreGraph PPPScoreGraphModules\">\n", "<script src=\"./scoregraph/rational.js?v=8\"></script><noscript data-ppp-lazy=\"score\" data-globals=\"PPPScoreGraph PPPScoreGraphModules\">\n"], SPLITB],
  ['S11', 'Piano Coach App.dc.html', 'a file import reads the library and audio-score.js without asking for them first', ["async function importToGraph(bytes, name, kind) {\n  await needScoreGraph(kind === 'midi');", "async function importToGraph(bytes, name, kind) {"], SPLITB],
  ['S12', 'Piano Coach App.dc.html', 'shelving the open song reads the engraver before it looks at what the song is (the demo has nothing to keep)', ["if (!score || score.id === 'demo' || !songId || songId === 'demo') return;\n    /* G13-4e: lazyPeek", "if (!window.PPPEngrave || !score || score.id === 'demo' || !songId || songId === 'demo') return;\n    /* G13-4e: lazyPeek"], SPLITB],
];

function run(m, dir) {
  const [, file, , edits, test] = m;
  const list = Array.isArray(edits[0]) ? edits : [edits];
  for (let [from, to] of list) {
    const f = path.join(dir, file);
    const src = fs.readFileSync(f, 'utf8');
    const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
    if (src.indexOf(from) < 0 && src.indexOf(CR + LF) >= 0) { from = from.split(LF).join(CR + LF); to = to.split(LF).join(CR + LF); }   /* a Windows checkout */
    const first = src.indexOf(from);
    if (first < 0 || src.indexOf(from, first + 1) >= 0) throw new Error(m[0] + ': the text to break is ' + (first < 0 ? 'not in ' : 'more than once in ') + file + ': ' + JSON.stringify(from.slice(0, 80)));
    fs.writeFileSync(f, src.slice(0, first) + to + src.slice(first + from.length));
  }
  const browser = test.includes('/');          /* a browser test: slower, and it finds puppeteer through NODE_PATH or D:/PPP/node_modules */
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=' + (browser ? 60000 : 8000), path.join(REPO, 'tests', browser ? '' : 'load', test)], { env: Object.assign({}, process.env, { PPP_LOAD_ROOT: dir }), encoding: 'utf8', timeout: browser ? 300000 : 120000 });
  return r.status;
}

(function main() {
  const only = process.argv.slice(2);
  const todo = M.filter(m => !only.length || only.includes(m[0]));
  const base = makeCopy();
  let bad = 0;
  try {
    for (const t of [LAZY, HASH, FONTS, SPLITN]) {
      const r = spawnSync(process.execPath, ['--test', '--test-timeout=20000', path.join(REPO, 'tests', 'load', t)], { env: Object.assign({}, process.env, { PPP_LOAD_ROOT: base }), encoding: 'utf8', timeout: 120000 });
      console.log((r.status === 0 ? 'ok      ' : 'FAIL    ') + 'unmutated copy: ' + t);
      if (r.status !== 0) { bad++; console.log((r.stdout || '').split('\n').filter(l => /✖|Error|expected|actual/.test(l)).slice(0, 12).join('\n')); }
    }
    for (const m of todo) {
      const dir = makeCopy();
      let status;
      try { status = run(m, dir); } catch (e) { console.log('ERROR   ' + m[0] + ' ' + e.message); bad++; continue; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      const killed = status !== 0;
      if (!killed) bad++;
      console.log((killed ? 'killed  ' : 'SURVIVED') + ' ' + m[0].padEnd(4) + ' ' + m[1].padEnd(18) + ' ' + m[2]);
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  console.log(bad ? '\n' + bad + ' problem(s)' : '\nall ' + todo.length + ' mutants killed');
  process.exitCode = bad ? 1 : 0;
})();
