/* PPP home worker: the localhost bridge (G10b-6, docs/GOALS/G10B_HOME_WORKER.md section 16).

   `worker.js --serve` keeps the worker running on this PC and listens on 127.0.0.1 (never any other address) so that the PPP page, open in a browser on THIS PC, can
   see at once whether the program is there, connect to it with one press, start it, and show its progress. Nothing here talks to the site faster than the worker
   already does: the page's status looks never reach the site (they are answered from memory), and a "run now" is one check, limited to a few a minute.

   This file is the HTTP layer (createBridge: every security rule is here) and the small controller behind it (createController: what the four routes do).
   The routes (JSON, all need an allowed Origin and a loopback Host):

     GET  /v1/status    what the program is doing - version, link (its NAME only), busy, the job's title and percent, last check, setup check - never a secret
     GET  /v1/link      the PC link's client code, for a second browser on this PC (the one place a secret leaves; see section 16 for the risk and why there is no extra secret)
     POST /v1/connect   { clientCode }  the worker gets its OWN worker token from the site with that code and saves both; no worker token ever passes through the page
     POST /v1/run       check the site now and convert what is waiting (the same as --once, in this process, under the same run lock)

   What a request can never do: reach a command, a path or a log (the only request data that is used is a 64-hex code that goes into one header of one request to the
   site and into the settings file at its fixed place). */
'use strict';
const http = require('http');

const DEFAULT_PORT = 47613;
const MAX_BODY = 2048;                                   /* the largest body any route takes: a code is 64 characters */
const CODE_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/;
/* test mode only (an explicit switch, see worker.js): the page of a test is served from a loopback address with a port of the test's own */
const TEST_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/;

/* the origin ("https://host[:port]") of a site address, or '' */
function originOf(url) {
  try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch (e) { return ''; }
}

/* at most `max` takes in any `windowMs`; take() returns 0 when allowed, else the seconds to wait */
function limiter(max, windowMs, now) {
  const hits = [];
  return {
    take() {
      const t = now();
      while (hits.length && t - hits[0] >= windowMs) hits.shift();
      if (hits.length >= max) return Math.max(1, Math.ceil((windowMs - (t - hits[0])) / 1000));
      hits.push(t);
      return 0;
    }
  };
}

/* text from the site (a video's title) as one short, plain line: controls, zero-width, bidi and line-separator characters become spaces */
function plain(s, n) {
  let t = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    const bad = c < 32 || (c >= 0x7f && c <= 0x9f) || c === 0xad || c === 0x61c || c === 0x180e || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
    t += bad ? ' ' : ch;
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, n || 100);
}

/* ---------------- the HTTP layer ---------------- */
/* o: ctl (the controller: status() link() connect(code) run()), port (0 = any, tests), siteUrl, testOrigins (test mode only), log, now */
function createBridge(o) {
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  const ctl = o.ctl;
  const allowed = new Set();
  const site = originOf(o.siteUrl);
  if (site) allowed.add(site);
  (o.testOrigins || []).forEach(x => { if (TEST_ORIGIN_RE.test(String(x))) allowed.add(String(x)); });
  const limits = { status: limiter(600, 60000, now), link: limiter(30, 60000, now), connect: limiter(6, 60000, now), run: limiter(12, 60000, now) };
  const lastSaid = {};
  /* a refused request is told to the log, but not more than once in 30 s for each reason (a page that retries would fill the log) */
  const said = (key, text) => { const t = now(); if (!lastSaid[key] || t - lastSaid[key] > 30000) { lastSaid[key] = t; log('Bridge: ' + text); } };

  const server = http.createServer();
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000; server.maxConnections = 64; server.maxHeadersCount = 40;
  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch (e) { /* gone */ } });

  const portNow = () => { const a = server.address(); return a && typeof a === 'object' ? a.port : o.port; };
  /* only this machine's own name for itself, with the port that is really open: a page of another site that was made to resolve to 127.0.0.1 (DNS rebinding) sends ITS name */
  const hostOk = h => typeof h === 'string' && (h.toLowerCase() === '127.0.0.1:' + portNow() || h.toLowerCase() === 'localhost:' + portNow());

  function send(res, status, body, extra) {
    const buf = Buffer.from(JSON.stringify(body));
    const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' }, extra || {});
    res.writeHead(status, headers);
    res.end(buf);
  }
  const fail = (res, status, error, extra) => send(res, status, { ok: false, error: error }, extra);

  /* a body of at most MAX_BODY bytes, as a JSON object; rejects with { status, error } */
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '');
      /* application/json only: a page of another site cannot send it without a preflight, which only an allowed Origin passes */
      if (!/^application\/json\s*(;\s*charset\s*=\s*"?utf-?8"?\s*)?$/i.test(ct)) return reject({ status: 415, error: 'content-type' });
      const declared = req.headers['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(declared) || +declared > MAX_BODY)) return reject({ status: 413, error: 'too-large', close: true });
      const chunks = [];
      let n = 0, over = false;
      req.on('data', c => { n += c.length; if (n > MAX_BODY) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
      req.on('end', () => {
        if (over) return reject({ status: 413, error: 'too-large', close: true });
        let v;
        try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { return reject({ status: 400, error: 'bad-json' }); }
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return reject({ status: 400, error: 'bad-json' });
        resolve(v);
      });
      req.on('error', () => reject({ status: 400, error: 'bad-request', close: true }));
    });
  }
  /* exactly these keys, no others */
  const onlyKeys = (v, keys) => Object.keys(v).every(k => keys.indexOf(k) >= 0);

  async function route(req, res, p, origin) {
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
    const wait = (kind) => { const s = limits[kind].take(); if (s) { fail(res, 429, 'rate-limited', Object.assign({ 'Retry-After': String(s) }, cors)); return true; } return false; };
    const ok = (status, body) => send(res, status, body, cors);
    const bad = (e) => fail(res, e.status || 400, e.error || 'bad-request', Object.assign({}, cors, e.close ? { Connection: 'close' } : {}));
    if (p === '/v1/status') {
      if (req.method !== 'GET') return fail(res, 405, 'method', Object.assign({ Allow: 'GET' }, cors));
      if (wait('status')) return;
      return ok(200, Object.assign({ ok: true }, ctl.status()));
    }
    if (p === '/v1/link') {
      if (req.method !== 'GET') return fail(res, 405, 'method', Object.assign({ Allow: 'GET' }, cors));
      if (wait('link')) return;
      const l = ctl.link();
      return l ? ok(200, { ok: true, clientCode: l.clientCode, linkTag: l.linkTag }) : fail(res, 404, 'no-code', cors);
    }
    if (p === '/v1/connect') {
      if (req.method !== 'POST') return fail(res, 405, 'method', Object.assign({ Allow: 'POST' }, cors));
      if (wait('connect')) return;
      let body;
      try { body = await readJson(req); } catch (e) { return bad(e); }
      if (!onlyKeys(body, ['clientCode']) || typeof body.clientCode !== 'string' || !CODE_RE.test(body.clientCode)) return fail(res, 400, 'bad-code', cors);
      const r = await ctl.connect(body.clientCode);
      return ok(r.status, r.body);
    }
    if (p === '/v1/run') {
      if (req.method !== 'POST') return fail(res, 405, 'method', Object.assign({ Allow: 'POST' }, cors));
      if (wait('run')) return;
      let body;
      try { body = await readJson(req); } catch (e) { return bad(e); }
      if (!onlyKeys(body, [])) return fail(res, 400, 'bad-request', cors);
      const r = await ctl.run();
      return ok(r.status, r.body);
    }
    return fail(res, 404, 'not-found', cors);
  }

  server.on('request', (req, res) => {
    /* 1. the Host: this machine's own name and the open port, nothing else */
    if (!hostOk(req.headers.host)) { said('host', 'refused a request with another Host name (DNS rebinding?).'); return fail(res, 403, 'bad-host', { Connection: 'close' }); }
    /* 2. the Origin: the site this program was set up for (and, in test mode, the test's own page). A request with no Origin is not a page of any site: refused too. */
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      said('origin', 'refused a request from ' + (typeof origin === 'string' ? plain(origin, 60) : '(no Origin)') + ' (only ' + Array.from(allowed).join(', ') + ' may use it).');
      return fail(res, 403, 'bad-origin', { Connection: 'close' });
    }
    /* 3. the path: an exact route, never a name taken from the request */
    const raw = String(req.url || '');
    if (!/^\/[\x21-\x7e]*$/.test(raw)) return fail(res, 400, 'bad-request', { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' });
    const q = raw.indexOf('?');
    const p = q < 0 ? raw : raw.slice(0, q);
    /* 4. the preflight (also Chrome's Private Network Access one: the page is public, this address is not) */
    if (req.method === 'OPTIONS') {
      const h = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' };
      res.writeHead(204, h);
      return res.end();
    }
    Promise.resolve().then(() => route(req, res, p, origin)).catch(e => {
      log('Bridge: a request failed inside the program (' + plain(e && e.message, 80) + ').');
      if (!res.headersSent) fail(res, 500, 'internal', { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }); else try { res.end(); } catch (x) { /* gone */ }
    });
  });

  return {
    server: server,
    allowedOrigins: () => Array.from(allowed),
    /* 127.0.0.1 only: the address is not an option of this function */
    listen() {
      return new Promise((resolve, reject) => {
        const onErr = e => reject(e);
        server.once('error', onErr);
        server.listen(o.port == null ? DEFAULT_PORT : o.port, '127.0.0.1', () => { server.removeListener('error', onErr); resolve(portNow()); });
      });
    },
    close() {
      return new Promise(resolve => { try { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); } catch (e) { resolve(); } });
    }
  };
}

/* is something that answers like this program already on the port? (a second start says so and stops) */
function probe(port, origin) {
  return new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: port, path: '/v1/status', headers: { Host: '127.0.0.1:' + port, Origin: origin }, agent: false, timeout: 2500 }, res => {
      const chunks = [];
      res.on('data', c => { if (chunks.length < 20) chunks.push(c); });
      res.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(!!j && j.app === 'ppp-home-worker'); } catch (e) { resolve(false); } });
    });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}

/* ---------------- what the routes do ---------------- */
/* d: cfg (the worker's live settings object: the token and the code change in it), worker (createWorker's answer: state, ctl, runNow), request (the site), findPcCode, linkTagOf, saveSettings,
   env (the setup check's result holder), allowLink, log, version, now */
function createController(d) {
  const cfg = d.cfg, worker = d.worker, state = worker.state;
  const now = d.now || Date.now;
  const log = d.log || (() => {});
  let connecting = false;
  const iso = t => (t ? new Date(t).toISOString() : null);
  const heldCode = () => { try { return d.findPcCode(cfg).code || ''; } catch (e) { return ''; } };
  /* the share of the job that each stage is: download 0-5, decode 5-10, transcribe 10-95, upload 95-100 */
  const percent = j => {
    const p = Math.max(0, Math.min(1, +j.pct || 0));
    return Math.round(j.stage === 'download' ? 0 : j.stage === 'decode' ? 5 : j.stage === 'transcribe' ? 10 + 85 * p : 97);
  };

  function status() {
    const code = heldCode();
    const j = state.job;
    const env = d.env || {};
    return {
      app: 'ppp-home-worker', api: 1, version: d.version,
      link: { has: !!cfg.token, tag: code ? d.linkTagOf(code) || null : null, rejected: !!state.rejected, shareable: !!(d.allowLink && code) },
      busy: !!j, checking: !!state.running && !j,
      job: j ? { title: plain(j.title, 100), stage: j.stage, percent: percent(j) } : null,
      lastCheckAt: iso(state.lastCheckAt), lastCheckOk: state.lastCheckOk, nextCheckAt: iso(state.nextCheckAt),
      env: { checked: !!env.checked, ok: env.checked ? !!env.ok : null, device: env.device || null }
    };
  }

  function link() {
    if (!d.allowLink) return null;
    const code = heldCode();
    return code ? { clientCode: code, linkTag: d.linkTagOf(code) } : null;
  }

  const done = (status, body) => ({ status: status, body: body });
  const siteDown = () => done(502, { ok: false, error: 'site-unreachable' });

  async function connect(code) {
    if (connecting) return done(409, { ok: false, error: 'busy' });
    connecting = true;
    try {
      /* 1. the site must know the code (the same question the page asks) */
      let r;
      try { r = await d.request(cfg, 'GET', '/api/worker/status', { pcCode: code, timeoutMs: 20000 }); } catch (e) { return siteDown(); }
      if (r.status === 401) return done(422, { ok: false, error: 'code-rejected' });
      if (r.status !== 200) return done(502, { ok: false, error: 'site-unavailable' });
      const tag = d.linkTagOf(code);
      /* 2. already this link, and the worker's token works: nothing to change (a second press must not cost a token: the site allows ten an hour) */
      if (cfg.token && heldCode() === code && !state.rejected) {
        let pr = null;
        try { pr = await d.request(cfg, 'GET', '/api/worker/ping', { timeoutMs: 20000 }); } catch (e) { return siteDown(); }
        if (pr.status === 200) {
          let saved = !state.unsaved;
          if (!saved) { try { d.saveSettings(cfg, { token: cfg.token, clientCode: code }); state.unsaved = false; saved = true; } catch (e) { /* still unsaved */ } }
          return done(200, { ok: true, rotated: false, saved: saved, linkTag: tag });
        }
        if (pr.status !== 401) return done(502, { ok: false, error: 'site-unavailable' });
      }
      /* 3. a conversion is running for another link: it is not taken away from under it */
      if (state.job) return done(409, { ok: false, error: 'busy' });
      /* 4. the worker's OWN token: the site makes it for the holder of the code and answers once; it goes into the settings file and the worker's memory, never to the page */
      let t;
      try { t = await d.request(cfg, 'POST', '/api/pc-links/me/worker-token', { pcCode: code, json: {}, timeoutMs: 20000 }); } catch (e) { return siteDown(); }
      if (t.status === 401) return done(422, { ok: false, error: 'code-rejected' });
      if (t.status === 429) return done(429, { ok: false, error: 'site-busy' });
      const token = t.body && t.body.workerToken;
      if ((t.status !== 200 && t.status !== 201) || typeof token !== 'string' || !TOKEN_RE.test(token)) return done(502, { ok: false, error: 'site-unavailable' });
      cfg.token = token; cfg.clientCode = code; state.rejected = false;
      let saved = true;
      try { d.saveSettings(cfg, { token: token, clientCode: code }); state.unsaved = false; }
      catch (e) { saved = false; state.unsaved = true; log('Bridge: the new PC link could not be written to the settings file (' + plain(e && (e.code || e.message), 60) + '). It is used until this program stops; press the button again to try to save it.'); }
      log('Bridge: this PC is now connected to PC link ...' + tag + '.');
      /* the first contact with the new token (it marks the PC as seen, so the page can offer its button), then the loop looks at the queue at once */
      try { await d.request(cfg, 'GET', '/api/worker/ping', { timeoutMs: 20000 }); } catch (e) { /* the loop's own check will say */ }
      if (worker.ctl && worker.ctl.wake) worker.ctl.wake();
      return done(200, { ok: true, rotated: true, saved: saved, linkTag: tag });
    } finally { connecting = false; }
  }

  async function run() {
    const r = worker.runNow();
    return done(200, Object.assign({ ok: true }, r));
  }

  return { status: status, link: link, connect: connect, run: run };
}

module.exports = { createBridge, createController, probe, originOf, limiter, plain, DEFAULT_PORT, MAX_BODY, CODE_RE, TOKEN_RE, TEST_ORIGIN_RE };
