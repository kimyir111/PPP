/* Shared parts of the home-PC worker's tests (G10b-1): a checker, a request helper, the queue service on a real HTTP server of its
   own with a COUNTING store (so a test can say "this poll ran no SQL"), and a clock the test moves.

   The modules under test are the repository's, or - for the mutation runner (tests/home-worker/mutants.js) - the copies in HOME_MODULES_DIR. Nothing here is read by the app. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
/* where the modules under test are read from: the repository, or (the mutation runner, tests/home-worker/mutants.js) a copy with one rule broken */
const MODS = process.env.HOME_MODULES_DIR ? path.resolve(process.env.HOME_MODULES_DIR) : REPO;
const mod = rel => require(path.join(MODS, rel));
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

/* one request to 127.0.0.1:port; body: object (JSON) or string; returns { status, body (parsed or null), text, headers } */
function req(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    const headers = Object.assign({}, o.headers || {});
    if (body) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; headers['Content-Length'] = body.length; }
    if (o.user) headers['x-test-user'] = o.user;
    if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
    if (o.cookie) headers['Cookie'] = o.cookie;
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
    if (o.abortAfter) setTimeout(() => r.destroy(), o.abortAfter);
    r.end(body);
  });
}

/* the same body as readBody of server.js (this file does not import server.js: it starts nothing) */
function readBody(r, limit, drain) {
  const max = limit || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let chunks = [], n = 0, over = false;
    const tooLarge = () => { const e = new Error('payload too large'); e.code = 'TOO_LARGE'; return e; };
    r.on('data', c => {
      n += c.length;
      if (n > max) {
        if (drain && n <= drain) { over = true; chunks = []; return; }
        r.destroy(); reject(tooLarge()); return;
      }
      chunks.push(c);
    });
    r.on('end', () => (over ? reject(tooLarge()) : resolve(Buffer.concat(chunks))));
    r.on('error', reject);
  });
}
function send(res, status, body, headers) {
  const extra = headers || {};
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) { extra['Content-Type'] = 'application/json; charset=utf-8'; body = JSON.stringify(body); }
  extra['X-Content-Type-Options'] = 'nosniff';
  res.writeHead(status, extra);
  res.end(body);
}
const jsonError = (res, status, message, extra) => send(res, status, Object.assign({ error: message }, extra || {}));

/* the copy of server.js's parseYoutubeWatch the service is given (the same code: it is read out of server.js's source) */
function youtubeParser() {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const a = src.indexOf('function parseYoutubeWatch(raw) {');
  const b = src.indexOf('function looksLikeAudioFile');
  if (a < 0 || b < 0) throw new Error('parseYoutubeWatch not found in server.js');
  // eslint-disable-next-line no-new-func
  return new Function('URL', src.slice(a, b) + '; return parseYoutubeWatch;')(URL);
}

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

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'ppp-hw-')); }
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gone */ } }

/* The service on its own HTTP server. opts: { store (an inner store; default a file store in a temp dir), config, users (ids), env } */
async function startService(opts) {
  opts = opts || {};
  const homeJobs = mod('home-jobs.js');
  const { fileJobStore } = mod('home-jobs-store.js');
  const dir = tmpDir();
  const inner = opts.store || fileJobStore(dir);
  const store = countingStore(inner);
  const clock = { t: Date.parse('2026-10-06T12:00:00Z') };
  const users = opts.users || ['u1', 'u2'];
  const logged = [];
  const svc = homeJobs.create({
    store: store, send: send, jsonError: jsonError, readBody: readBody, parseYoutube: youtubeParser(),
    clientIp: r => String((r.headers['x-forwarded-for'] || '127.0.0.1')).split(',').pop().trim(),
    sessionUid: r => { const u = r.headers['x-test-user']; return u && users.indexOf(String(u)) >= 0 ? String(u) : null; },
    findUser: async id => (users.indexOf(id) >= 0 ? { id: id, displayName: 'User ' + id } : null),
    now: () => clock.t, env: opts.env || {}, config: Object.assign({ longPollMs: 300 }, opts.config || {}),
    logError: e => logged.push(String(e && e.message))
  });
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://' + (rq.headers.host || 'localhost'));
    if (svc.owns(url.pathname)) return svc.handle(rq, rs, url);
    if (opts.extra && opts.extra(rq, rs, url)) return;
    jsonError(rs, 404, 'Not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port: port, svc: svc, store: store, inner: inner, clock: clock, dir: dir, logged: logged,
    advance: ms => { clock.t += ms; },
    close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(() => { rmDir(dir); r(); }); }),
    /* a signed-in user's request */
    as: user => ({
      get: (p, o) => req(port, 'GET', p, Object.assign({ user: user }, o)),
      post: (p, body, o) => req(port, 'POST', p, Object.assign({ user: user, body: body == null ? {} : body }, o)),
      del: (p, o) => req(port, 'DELETE', p, Object.assign({ user: user }, o))
    }),
    /* a worker's request */
    worker: token => ({
      get: (p, o) => req(port, 'GET', p, Object.assign({ token: token }, o)),
      post: (p, body, o) => req(port, 'POST', p, Object.assign({ token: token, body: body == null ? {} : body }, o))
    })
  };
}

const WATCH = id => 'https://www.youtube.com/watch?v=' + id;
/* n plausible helper notes of a piece `secs` long */
function notes(n, secs) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const on = (i * (secs || 60)) / n;
    out.push({ on: Math.round(on * 1000) / 1000, off: Math.round((on + 0.4) * 1000) / 1000, midi: 48 + (i * 7) % 40, vel: 40 + (i * 13) % 80 });
  }
  return out;
}
const goodResult = n => ({ notes: notes(n || 40, 60), duration: 61.5, engine: 'ensemble', model: 'TransKun V2 + Kong', device: 'cuda',
  ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 0.83, accepted: n || 40, uncertain: 7 } });

module.exports = { REPO, MODS, mod, ok, errors, sleep, heading, finish, req, readBody, send, jsonError, youtubeParser, countingStore, tmpDir, rmDir, startService, WATCH, notes, goodResult, crypto, http, fs, path, os };
