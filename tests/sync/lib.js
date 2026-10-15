/* Shared parts of the song-library sync tests (G13-S0): a checker, a request helper, a service of sync.js on a real HTTP server of its own with a COUNTING store (so a test can say
   "this poll ran no SQL"), a clock the test moves, and helpers that make the items a page makes: a song as gzip JSON.

   The modules under test are the repository's, or - for the mutation runner (tests/sync/mutants.js) - the copies in HOME_MODULES_DIR (a folder that holds every module the service needs;
   the variable is the one the PC queue's runner uses). Nothing here is read by the app. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { freePort } = require('../serve-free');

const REPO = path.resolve(__dirname, '..', '..');
const MODS = process.env.HOME_MODULES_DIR ? path.resolve(process.env.HOME_MODULES_DIR) : REPO;
const mod = rel => require(path.join(MODS, rel));
const MiB = 1048576;

const errors = [];
let passed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (cond) passed++; else errors.push(name + (detail ? ' — ' + detail : ''));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const heading = t => console.log('\n── ' + t + ' ──');
function finish(label) {
  if (errors.length) {
    console.error('\n' + errors.length + ' failed (' + passed + ' passed): ' + label);
    errors.slice(0, 12).forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  console.log('\n' + passed + ' passed: ' + label);
}

/* one request to 127.0.0.1:port; o.body: an object (JSON) or a string; o.headers; o.ip: the client address (X-Forwarded-For); returns { status, body (parsed or null), text, headers } */
function req(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    const headers = Object.assign({}, o.headers || {});
    if (body) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; headers['Content-Length'] = body.length; }
    if (o.ip) headers['X-Forwarded-For'] = o.ip;
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json, text: text, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.end(body);
  });
}
/* the same two functions as server.js's send and jsonError (this file does not import server.js: it starts nothing) */
function send(res, status, body, headers) {
  const extra = headers || {};
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) { extra['Content-Type'] = 'application/json; charset=utf-8'; body = JSON.stringify(body); }
  extra['X-Content-Type-Options'] = 'nosniff';
  res.writeHead(status, extra);
  res.end(body);
}
const jsonError = (res, status, message, extra) => send(res, status, Object.assign({ error: message }, extra || {}));

/* wraps a store: every method call is counted (by name) and can be made to fail */
function countingStore(inner) {
  const calls = {};
  const fail = { on: false, only: null };
  const wrapped = { kind: inner.kind, calls: calls, fail: fail, total: () => Object.values(calls).reduce((a, b) => a + b, 0), reset: () => { Object.keys(calls).forEach(k => delete calls[k]); } };
  Object.keys(inner).forEach(k => {
    if (typeof inner[k] !== 'function') return;
    wrapped[k] = async function () {
      calls[k] = (calls[k] || 0) + 1;
      if (fail.on && (!fail.only || fail.only === k)) throw new Error('store is down (test)');
      return inner[k].apply(inner, arguments);
    };
  });
  return wrapped;
}
const tmpDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'ppp-sync-'));
const rmDir = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gone */ } };

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

/* The service on its own HTTP server. opts: { store (an inner store; default a file store in a temp dir), memory (the default store keeps its data in memory), config, env, libs (names of
   the libraries to make; default none), ipSecret, resume (the creds() of an earlier service: the same libraries on a store that kept them - a restart) }. Each library is made through
   POST /api/libs from an address of its own (10.251.x.y), so the per-address limits never get in the way of a test that is about something else. */
async function startSync(opts) {
  opts = opts || {};
  const mkSync = mod('sync.js');
  const { fileSyncStore } = mod('sync-store.js');
  const dir = tmpDir('ppp-sync-');
  const inner = opts.store || fileSyncStore(dir, { memory: !!opts.memory });
  const store = countingStore(inner);
  const clock = { t: Date.parse('2026-10-15T12:00:00Z') };
  const logged = [];
  const svc = mkSync.create({
    store: store, send: send, jsonError: jsonError,
    clientIp: r => String((r.headers['x-forwarded-for'] || '127.0.0.1')).split(',').pop().trim(),
    ipSecret: opts.ipSecret || 'test-secret', now: () => clock.t, env: opts.env || {}, config: opts.config,
    logError: e => logged.push(String(e && e.message))
  });
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://' + (rq.headers.host || 'localhost'));
    if (svc.owns(url.pathname)) return svc.handle(rq, rs, url);
    jsonError(rs, 404, 'Not found');
  });
  /* a free port: asked of serve-free (PPP_PORT_RANGE=10601-10649 keeps a machine that reserves a band for its suites inside it); a port taken between the asking and the listening
     is asked for again */
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
  const call = (method, p, o) => req(port, method, p, o);
  const S = {
    port: port, svc: svc, store: store, inner: inner, clock: clock, dir: dir, logged: logged, module: mkSync,
    advance: ms => { clock.t += ms; },
    close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(() => { rmDir(dir); r(); }); }),
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

module.exports = { REPO, MODS, mod, MiB, ok, errors, sleep, heading, finish, req, send, jsonError, countingStore, tmpDir, rmDir, http, fs, path, os, crypto,
  gz, b64, score, songBody, hashOf, item, startSync, countingQuery };
