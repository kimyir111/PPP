/* Shared parts of the song-library sync tests (G13-S0): the checker and the request helper of the home-PC worker's tests, and a service of sync.js on a real HTTP server of
   its own with a COUNTING store (so a test can say "this poll ran no SQL"), a clock the test moves, and helpers that make the items a page makes: a song as gzip JSON.

   The modules under test are the repository's, or - for the mutation runner (tests/sync/mutants.js) - the copies in HOME_MODULES_DIR (the same variable the PC queue's runner
   uses: the copy holds every module the service needs). Nothing here is read by the app. */
'use strict';
const zlib = require('zlib');
const W = require('../home-worker/lib');
const { freePort } = require('../serve-free');
const { http, crypto } = W;

const MiB = 1048576;

/* one gzip JSON item as the page makes it */
const gz = obj => zlib.gzipSync(Buffer.isBuffer(obj) ? obj : Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
const b64 = obj => gz(obj).toString('base64');
/* a packed score of n notes in m measures (a note is a row), the shape validScore knows */
function score(n, m) {
  const measures = [];
  for (let i = 0; i < (m || 4); i++) measures.push({ number: i + 1, time: { beats: 4, beatType: 4 } });
  const notes = [];
  for (let i = 0; i < (n || 8); i++) notes.push([60 + (i % 12), (i % 4) * 0.5, 0.5, 1 + (i >> 2) % (m || 4)]);
  return { title: 'Test', measures: measures, notes: notes, _packedNoteKeys: ['midi', 'q', 'dur', 'm'] };
}
/* a song item: its card, the score, its progress */
const songBody = (n, o) => Object.assign({ v: 1, card: { title: 'Song ' + (n || 8), composer: 'Test' }, score: score(n || 8, 4), progress: { plays: 1 } }, o || {});
const hashOf = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);
/* { key, baseRev, hash, body } of a song for a PUT */
function item(key, obj, baseRev) {
  const o = obj === undefined ? songBody(8) : obj;
  return { key: key, baseRev: baseRev || 0, hash: hashOf(o), body: b64(o) };
}

/* The service on its own HTTP server. opts: { store (an inner store; default a file store in a temp dir), config, env, libs (names of the libraries to make; default none),
   ipSecret, resume (the creds() of an earlier service: the same libraries on a store that kept them - a restart) }. Each library is made through POST /api/libs from an
   address of its own (10.251.x.y), so the per-address limits never get in the way of a test that is about something else. */
async function startSync(opts) {
  opts = opts || {};
  const mkSync = W.mod('sync.js');
  const { fileSyncStore } = W.mod('sync-store.js');
  const dir = W.tmpDir('ppp-sync-');
  const inner = opts.store || fileSyncStore(dir, { memory: !!opts.memory });
  const store = W.countingStore(inner);
  const clock = { t: Date.parse('2026-10-15T12:00:00Z') };
  const logged = [];
  const svc = mkSync.create({
    store: store, send: W.send, jsonError: W.jsonError,
    clientIp: r => String((r.headers['x-forwarded-for'] || '127.0.0.1')).split(',').pop().trim(),
    ipSecret: opts.ipSecret || 'test-secret', now: () => clock.t, env: opts.env || {}, config: opts.config,
    logError: e => logged.push(String(e && e.message))
  });
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://' + (rq.headers.host || 'localhost'));
    if (svc.owns(url.pathname)) return svc.handle(rq, rs, url);
    W.jsonError(rs, 404, 'Not found');
  });
  /* a free port: asked of serve-free (PPP_PORT_RANGE=10601-10649 keeps a machine that reserves a band for its suites inside it); a port taken between the asking and the
     listening is asked for again */
  let port = 0;
  for (let tries = 0; ; tries++) {
    port = await freePort();
    try {
      await new Promise((resolve, reject) => { const onErr = e => { server.removeListener('error', onErr); reject(e); }; server.once('error', onErr); server.listen(port, '127.0.0.1', () => { server.removeListener('error', onErr); resolve(); }); });
      break;
    } catch (e) { if (tries >= 40 || !e || e.code !== 'EADDRINUSE') throw e; }
  }
  const codes = {}, ids = {};
  if (opts.resume) { Object.assign(codes, opts.resume.codes); Object.assign(ids, opts.resume.ids); }
  let nextAddr = 1;
  const call = (method, p, o) => W.req(port, method, p, o);
  const S = {
    port: port, svc: svc, store: store, inner: inner, clock: clock, dir: dir, logged: logged, module: mkSync,
    advance: ms => { clock.t += ms; },
    close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(() => { W.rmDir(dir); r(); }); }),
    code: n => codes[n], libId: n => ids[n],
    creds: () => ({ codes: Object.assign({}, codes), ids: Object.assign({}, ids) }),
    /* make a library as a browser does (no sign-in); `name` is what the test calls it; o.ip: the address it is made from (default: a new one each time) */
    make: async (name, o) => {
      o = o || {};
      const n = nextAddr++;
      const r = await call('POST', '/api/libs', { body: {}, ip: o.ip || ('10.251.' + (n >> 8) + '.' + (n & 255)), headers: o.headers });
      if (r.status !== 201) throw new Error('making the library ' + name + ': ' + r.status + ' ' + r.text);
      codes[name] = r.body.code; ids[name] = r.body.id;
      return r;
    },
    /* a library's requests: S.as('a').get(...) sends its code as X-PPP-Lib; o.ip is the address, o.headers more headers, o.raw a code to send instead */
    as: name => {
      const withCode = o => { o = Object.assign({}, o); o.headers = Object.assign({}, o.headers); const c = o.raw !== undefined ? o.raw : codes[name]; if (c !== null) o.headers['X-PPP-Lib'] = c; delete o.raw; return o; };
      return {
        get: (p, o) => call('GET', p, withCode(o)),
        put: (p, body, o) => call('PUT', p, withCode(Object.assign({ body: body }, o))),
        post: (p, body, o) => call('POST', p, withCode(Object.assign({ body: body == null ? {} : body }, o))),
        del: (p, o) => call('DELETE', p, withCode(o)),
        changes: (since, o) => call('GET', '/api/sync/changes?since=' + (since || 0), withCode(o)),
        items: (keys, o) => call('GET', '/api/sync/items?keys=' + keys.map(encodeURIComponent).join(','), withCode(o)),
        putItems: (list, o) => call('PUT', '/api/sync/items', withCode(Object.assign({ body: { device: 'a1b2c3d4e5f60718', items: list } }, o))),
        delItem: (key, baseRev, o) => call('DELETE', '/api/sync/items/' + encodeURIComponent(key) + '?baseRev=' + baseRev + '&device=a1b2c3d4e5f60718', withCode(o))
      };
    },
    anon: { get: (p, o) => call('GET', p, o), post: (p, body, o) => call('POST', p, Object.assign({ body: body == null ? {} : body }, o)), del: (p, o) => call('DELETE', p, o), put: (p, body, o) => call('PUT', p, Object.assign({ body: body }, o)) }
  };
  for (const n of (opts.resume ? [] : (opts.libs || []))) await S.make(n);
  return S;
}

/* the statements a block of code ran: a pool-like query function that counts (and keeps the first 60 characters of each) */
function countingQuery(pool) {
  const o = { n: 0, seen: [], query: (sql, params) => { o.n++; o.seen.push(String(sql).replace(/\s+/g, ' ').slice(0, 60)); return pool.query(sql, params); }, reset: () => { o.n = 0; o.seen.length = 0; } };
  return o;
}

module.exports = Object.assign({}, W, { MiB, gz, b64, score, songBody, hashOf, item, startSync, countingQuery });
