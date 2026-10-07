/* ============================================================================
   G10b-6: the localhost bridge of the home-PC worker (tools/home-worker/bridge.js and `worker.js --serve`), Node only - no browser, no real conversion, nothing installed or registered.

   The PPP page of THIS PC talks to the program on 127.0.0.1 (one-press "Connect this PC", live status, instant start). What is checked here is the part a stranger could use:

     - the HTTP layer: only 127.0.0.1 is bound; a strict Host check (DNS rebinding); an Origin allow-list (the site's origin, and in an explicit test mode a loopback origin of a test - never a wildcard,
       never "no Origin"); the preflight, with Chrome's Private Network Access answer, and CORS headers for the allowed origin only; bodies of at most 2 KB, application/json only, strict keys and a 64-hex code;
       the mutating routes are rate limited; nothing from a request reaches a command, a path or the log
     - /v1/connect against the REAL site code (home-jobs.js on a local HTTP server): the worker gets its OWN token (rotation), saves token and code to the settings file (other keys kept), a second press does
       not spend another token, a wrong code changes nothing, a running conversion is not taken away, a failing disk does not lose the link
     - /v1/run: the run lock, one at a time (a call during a run asks for one more look), no site request when another run holds the lock
     - the --serve loop: waits without a link, survives a rejected token, never polls faster than the site says, answers status without touching the site
     - real processes: the second start of --serve finds the port taken and stops; a port held by another program is said; test mode needs both variables and a loopback origin

   node tests/home-worker/bridge.test.js */
'use strict';
const L = require('./lib');
const { heading, sleep } = L;
/* HOME_FAIL_FAST (the mutation runner): stop at the first failed check - a mutant is killed by it. A detail is shown only when a check fails. */
const ok = (name, cond, detail) => { L.ok(name, cond, cond ? undefined : detail); if (!cond && process.env.HOME_FAIL_FAST) throw new Error('stopped at the first failed check: ' + name); };
const W = L.mod('tools/home-worker/worker.js');
const B = L.mod('tools/home-worker/bridge.js');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CODE_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/;
let ORIGIN = 'https://ppp.example.com';
const rnd = () => require('crypto').randomBytes(32).toString('hex');

/* one request to the bridge. o: origin (undefined = the allowed one, null = no Origin header), host (default 127.0.0.1:port), type (content type), body (object | string), chunks (a chunked body of n KB), headers */
function bx(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    const h = Object.assign({}, o.headers || {});
    if (o.origin !== null) h.Origin = o.origin === undefined ? ORIGIN : o.origin;
    h.Host = o.host === undefined ? '127.0.0.1:' + port : o.host;
    if (body || o.chunks) h['Content-Type'] = o.type === undefined ? 'application/json' : o.type;
    if (body && !o.chunks) h['Content-Length'] = body.length;
    let settled = false;
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { settled = true; const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } resolve({ status: res.statusCode, headers: res.headers, text: text, body: json }); });
    });
    r.on('error', e => { if (!settled) reject(e); });
    if (o.chunks) { for (let i = 0; i < o.chunks; i++) r.write(Buffer.alloc(1024, 0x20)); r.end(); } else r.end(body);
  });
}
const has = (res, name) => Object.prototype.hasOwnProperty.call(res.headers, name.toLowerCase());
const noCors = res => !Object.keys(res.headers).some(k => /^access-control-/.test(k));

function logger() { const lines = []; const log = m => lines.push(String(m)); log.warn = log; log.lines = lines; return log; }

/* a worker with the settings file of a test; deps: the worker's own (request, runTool, lockApi...) */
function makeWorker(siteUrl, over, deps) {
  const dir = L.tmpDir('ppp-hw-br-');
  const file = path.join(dir, 'worker.config.json');
  fs.writeFileSync(file, JSON.stringify(Object.assign({ siteUrl: siteUrl, pythonPath: process.execPath, transcribePy: file, scratchDir: path.join(dir, 'scratch'), ffmpegPath: process.execPath, kongCheckpoint: 'x', keepKept: 'yes' }, over || {}), null, 2));
  const cfg = W.loadConfig(file, {});
  const log = logger();
  const w = W.createWorker(cfg, Object.assign({ log: log, waitScale: 0.001, jitter: () => 0 }, deps || {}));
  return { dir: dir, file: file, cfg: cfg, log: log, w: w };
}
const readSettings = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/* the controller + the bridge on port 0 */
async function makeBridge(X, o) {
  o = o || {};
  const env = o.env || { checked: true, ok: true, device: 'cuda' };
  const ctl = B.createController({ cfg: X.cfg, worker: X.w, request: o.request || W.request, findPcCode: c => W.findPcCode(c, { homedir: () => X.dir }), linkTagOf: W.linkTagOf,
    saveSettings: o.saveSettings || ((c, p) => W.saveSettings(c, p)), env: env, allowLink: o.allowLink !== false, log: X.log, version: W.VERSION, now: o.now });
  const spy = { connect: 0, run: 0, status: 0, link: 0 };
  const wrapped = o.stub ? o.stub : { status: () => { spy.status++; return ctl.status(); }, link: () => { spy.link++; return ctl.link(); }, connect: c => { spy.connect++; return ctl.connect(c); }, run: () => { spy.run++; return ctl.run(); } };
  const bridge = B.createBridge({ ctl: wrapped, port: 0, siteUrl: o.siteUrl || ORIGIN, testOrigins: o.testOrigins, log: X.log, now: o.now });
  const port = await bridge.listen();
  return { ctl: ctl, bridge: bridge, port: port, spy: spy, close: () => bridge.close() };
}

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }

(async () => {
  /* ------------------------------------------------------------------ the HTTP layer, with a stub behind it */
  heading('the bridge listens on 127.0.0.1 and nowhere else');
  {
    const X = makeWorker('https://ppp.example.com');
    const stubs = { status: () => ({ app: 'ppp-home-worker', secret: 'must-not-be-needed' }), link: () => ({ clientCode: rnd(), linkTag: 'abcdef' }), connect: async () => ({ status: 200, body: { ok: true } }), run: async () => ({ status: 200, body: { ok: true } }) };
    const M = await makeBridge(X, { stub: stubs });
    try {
      const a = M.bridge.server.address();
      ok('the socket is IPv4 127.0.0.1 (not 0.0.0.0, not ::)', a.address === '127.0.0.1' && a.family === 'IPv4', JSON.stringify(a));
      const ext = [].concat(...Object.values(os.networkInterfaces())).filter(i => i && !i.internal && i.family === 'IPv4').map(i => i.address)[0];
      if (ext) {
        const refused = await new Promise(res => { const s = net.connect({ host: ext, port: M.port, timeout: 2000 }); s.on('connect', () => { s.destroy(); res(false); }); s.on('error', () => res(true)); s.on('timeout', () => { s.destroy(); res(true); }); });
        ok('the same port on this PC\'s network address (' + ext.replace(/\d+$/, 'x') + ') is not open', refused);
      } else console.log('  - no non-loopback IPv4 address on this machine: the network-address check is skipped');
      const src = fs.readFileSync(path.join(L.MODS, 'tools/home-worker/bridge.js'), 'utf8');
      ok('the source binds the literal 127.0.0.1 and has no 0.0.0.0, "::" or host option', /server\.listen\([^)]*'127\.0\.0\.1'/.test(src) && !/0\.0\.0\.0/.test(src) && !/listen\([^)]*(o\.host|opts\.host|'::')/.test(src));
      ok('bridge.js starts no program (no child_process, no exec, no spawn, no shell)', !/child_process|\bexec(Sync|File)?\s*\(|\bspawn\s*\(|shell\s*:/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
    } finally { await M.close(); }
  }

  heading('Host: only this machine\'s own name with the open port (DNS rebinding)');
  {
    const X = makeWorker('https://ppp.example.com');
    const M = await makeBridge(X, { stub: { status: () => ({ app: 'ppp-home-worker' }), link: () => null, connect: async () => ({ status: 200, body: { ok: true } }), run: async () => ({ status: 200, body: { ok: true } }) } });
    try {
      const p = M.port;
      const r1 = await bx(p, 'GET', '/v1/status');
      ok('127.0.0.1:port is served', r1.status === 200 && r1.body && r1.body.app === 'ppp-home-worker');
      ok('localhost:port is served', (await bx(p, 'GET', '/v1/status', { host: 'localhost:' + p })).status === 200);
      ok('LOCALHOST:port is served (a host name is not case sensitive)', (await bx(p, 'GET', '/v1/status', { host: 'LOCALHOST:' + p })).status === 200);
      for (const h of ['attacker.example:' + p, 'attacker.example', '127.0.0.1', 'localhost', '127.0.0.1:' + (p + 1), '127.0.0.1:' + p + '.attacker.example', '0.0.0.0:' + p, '[::1]:' + p, '127.0.0.1:' + p + '@attacker.example', ' 127.0.0.1:' + p + 'x']) {
        const r = await bx(p, 'GET', '/v1/status', { host: h });
        ok('Host "' + h + '" is refused (403 bad-host, no CORS headers, connection closed)', r.status === 403 && r.body && r.body.error === 'bad-host' && noCors(r) && /close/i.test(r.headers.connection || ''), r.status + ' ' + r.text);
      }
      const rawReq = text => new Promise(res => { const s = net.connect(p, '127.0.0.1', () => { s.write(text); }); let t = ''; s.on('data', d => { t += d; s.end(); }); s.on('close', () => res(t)); s.on('error', () => res(t)); setTimeout(() => { s.destroy(); res(t); }, 2000); });
      ok('an EMPTY Host header is refused', /^HTTP\/1\.1 403/.test(await rawReq('GET /v1/status HTTP/1.1\r\nHost:\r\nOrigin: ' + ORIGIN + '\r\n\r\n')));
      ok('no Host header at all (HTTP/1.0) is refused', /^HTTP\/1\.[01] 40[03]/.test(await rawReq('GET /v1/status HTTP/1.0\r\nOrigin: ' + ORIGIN + '\r\n\r\n')));
      const rebind = await bx(p, 'POST', '/v1/connect', { host: 'attacker.example:' + p, origin: 'http://attacker.example:' + p, body: { clientCode: rnd() } });
      ok('a rebound page (its own Host and Origin) gets nothing', rebind.status === 403 && noCors(rebind) && M.spy.connect === 0);
    } finally { await M.close(); }
  }

  heading('Origin: the site\'s origin only; a test origin only in test mode; no wildcard, no missing Origin');
  {
    const X = makeWorker('https://ppp.example.com');
    const seen = { link: 0, connect: 0, run: 0 };
    const stub = { status: () => ({ app: 'ppp-home-worker' }), link: () => { seen.link++; return { clientCode: rnd(), linkTag: 'abcdef' }; }, connect: async () => { seen.connect++; return { status: 200, body: { ok: true } }; }, run: async () => { seen.run++; return { status: 200, body: { ok: true } }; } };
    const M = await makeBridge(X, { stub: stub });
    try {
      const p = M.port;
      const good = await bx(p, 'GET', '/v1/status');
      ok('the site\'s origin is served, with Access-Control-Allow-Origin = that origin (never *) and Vary: Origin', good.status === 200 && good.headers['access-control-allow-origin'] === ORIGIN && /origin/i.test(good.headers.vary || ''));
      ok('every answer is JSON, no-store, nosniff, and cross-origin-resource-policy same-origin (no-cors loads of it are blocked)', /application\/json/.test(good.headers['content-type']) && good.headers['cache-control'] === 'no-store' && good.headers['x-content-type-options'] === 'nosniff' && good.headers['cross-origin-resource-policy'] === 'same-origin');
      const bad = ['https://attacker.example', 'http://ppp.example.com', 'https://ppp.example.com/', 'https://PPP.example.com', 'https://ppp.example.com.attacker.example', 'https://attacker.example/https://ppp.example.com', 'null', '*', 'http://127.0.0.1:' + p, 'http://localhost:' + p, 'file://', ''];
      for (const o of bad) {
        const r = await bx(p, 'GET', '/v1/status', { origin: o });
        ok('Origin "' + o + '" is refused (403 bad-origin and no CORS headers: the page cannot read the refusal either)', r.status === 403 && r.body && r.body.error === 'bad-origin' && noCors(r), r.status);
      }
      const none = await bx(p, 'GET', '/v1/status', { origin: null });
      ok('a request with no Origin at all is refused (it is no page of any site)', none.status === 403 && noCors(none));
      for (const route of [['GET', '/v1/link'], ['POST', '/v1/connect', { clientCode: rnd() }], ['POST', '/v1/run', {}]]) {
        const r = await bx(p, route[0], route[1], { origin: 'https://attacker.example', body: route[2] });
        ok(route[0] + ' ' + route[1] + ' from another site: 403, nothing done', r.status === 403 && noCors(r));
      }
      ok('the controller was never asked for a link, a connect or a run by any of those', seen.link === 0 && seen.connect === 0 && seen.run === 0);
    } finally { await M.close(); }
    /* test mode */
    const T = await makeBridge(X, { stub: stub, testOrigins: ['http://127.0.0.1:5555', 'http://attacker.example:5555', 'https://127.0.0.1:5555', 'http://127.0.0.1:5555/', 'http://127.0.0.1:55555555', '*', 'http://localhost:5555', 'http://127.0.0.1:5'] });
    try {
      ok('in test mode a loopback origin with a port is allowed, and the allow-list holds exactly it and the site (the other strings given were dropped: not loopback, not http, a path, a long port, a wildcard, localhost, a one-digit port)', JSON.stringify(T.bridge.allowedOrigins().sort()) === JSON.stringify([ORIGIN, 'http://127.0.0.1:5555'].sort()), JSON.stringify(T.bridge.allowedOrigins()));
      const r = await bx(T.port, 'GET', '/v1/status', { origin: 'http://127.0.0.1:5555' });
      ok('the test origin is served with its own Access-Control-Allow-Origin', r.status === 200 && r.headers['access-control-allow-origin'] === 'http://127.0.0.1:5555');
      ok('another loopback port is not', (await bx(T.port, 'GET', '/v1/status', { origin: 'http://127.0.0.1:5556' })).status === 403);
    } finally { await T.close(); }
    /* the same without test mode: a loopback origin is refused */
    const N = await makeBridge(X, { stub: stub });
    try { ok('with no test mode the same loopback origin is refused', (await bx(N.port, 'GET', '/v1/status', { origin: 'http://127.0.0.1:5555' })).status === 403 && N.bridge.allowedOrigins().length === 1); } finally { await N.close(); }
  }

  heading('the preflight, with the Private Network Access answer');
  {
    const X = makeWorker('https://ppp.example.com');
    const M = await makeBridge(X, { stub: { status: () => ({ app: 'ppp-home-worker' }), link: () => null, connect: async () => ({ status: 200, body: { ok: true } }), run: async () => ({ status: 200, body: { ok: true } }) } });
    try {
      const pre = { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type', 'Access-Control-Request-Private-Network': 'true' };
      const r = await bx(M.port, 'OPTIONS', '/v1/connect', { headers: pre });
      ok('an allowed origin\'s preflight: 204, Allow-Origin = the origin, Allow-Private-Network: true, Allow-Methods GET/POST/OPTIONS, Allow-Headers Content-Type only',
        r.status === 204 && r.headers['access-control-allow-origin'] === ORIGIN && r.headers['access-control-allow-private-network'] === 'true' && /POST/.test(r.headers['access-control-allow-methods']) && r.headers['access-control-allow-headers'] === 'Content-Type', JSON.stringify(r.headers));
      ok('no wildcard in any preflight header, and a short max-age', !/\*/.test(JSON.stringify(Object.keys(r.headers).filter(k => /^access-control-/.test(k)).map(k => r.headers[k]))) && +r.headers['access-control-max-age'] <= 600);
      for (const route of ['/v1/status', '/v1/link', '/v1/run']) ok('the preflight of ' + route + ' is answered the same way', (await bx(M.port, 'OPTIONS', route, { headers: pre })).status === 204);
      const evil = await bx(M.port, 'OPTIONS', '/v1/connect', { origin: 'https://attacker.example', headers: pre });
      ok('a preflight from another site: 403 and not one Access-Control header (so the browser refuses the real request)', evil.status === 403 && noCors(evil));
      const rebind = await bx(M.port, 'OPTIONS', '/v1/connect', { host: 'attacker.example:' + M.port, headers: pre });
      ok('a preflight with a foreign Host: 403, no CORS headers', rebind.status === 403 && noCors(rebind));
      const noOrigin = await bx(M.port, 'OPTIONS', '/v1/connect', { origin: null, headers: pre });
      ok('a preflight with no Origin: 403', noOrigin.status === 403 && noCors(noOrigin));
    } finally { await M.close(); }
  }

  heading('bodies: at most 2 KB, application/json, strict keys, a 64-hex code; the answers say nothing of what was sent');
  {
    const X = makeWorker('https://ppp.example.com');
    let tick = 0;                                           /* a clock that moves 15 s at every look: this test is about bodies, not about the rate limit (the next section) */
    const M = await makeBridge(X, { now: () => (tick += 15000), request: async () => { throw new Error('the site must not be asked'); } });
    try {
      const p = M.port;
      const code = rnd();
      const cases = [
        ['3 KB body', { body: JSON.stringify({ clientCode: code, pad: 'x'.repeat(3000) }) }, 413],
        ['a 2 KB body of spaces and then a code (over the limit)', { body: ' '.repeat(2100) + JSON.stringify({ clientCode: code }) }, 413],
        ['a chunked body of 5 KB with no Content-Length', { chunks: 5 }, 413],
        ['text/plain (the kind of POST a page can send without a preflight)', { body: JSON.stringify({ clientCode: code }), type: 'text/plain' }, 415],
        ['application/x-www-form-urlencoded', { body: 'clientCode=' + code, type: 'application/x-www-form-urlencoded' }, 415],
        ['multipart/form-data', { body: JSON.stringify({ clientCode: code }), type: 'multipart/form-data; boundary=x' }, 415],
        ['application/json with a charset other than utf-8', { body: JSON.stringify({ clientCode: code }), type: 'application/json; charset=utf-7' }, 415],
        ['not JSON', { body: '{oops' }, 400],
        ['the JSON value null', { body: 'null' }, 400],
        ['a JSON array', { body: '[1]' }, 400],
        ['a JSON string', { body: '"abc"' }, 400],
        ['an empty body', { body: '' }, 400],
        ['an extra key next to the code', { body: { clientCode: code, token: 'ppw_x' } }, 400],
        ['no code', { body: {} }, 400],
        ['a code that is a number', { body: { clientCode: 12345 } }, 400],
        ['a code that is an array', { body: { clientCode: [code] } }, 400],
        ['a code of 63 hex', { body: { clientCode: code.slice(1) } }, 400],
        ['a code of 65 hex', { body: { clientCode: code + 'a' } }, 400],
        ['a code in capitals', { body: { clientCode: code.toUpperCase() } }, 400],
        ['a code with a space', { body: { clientCode: code.slice(0, 63) + ' ' } }, 400],
        ['a code that is a shell command', { body: { clientCode: '"; calc.exe; "' + 'a'.repeat(54) } }, 400],
        ['a code that is a path', { body: { clientCode: '..\\..\\..\\Windows\\win.ini' + '0'.repeat(40) } }, 400],
        ['a code that is a pairing link', { body: { clientCode: 'https://ppp.example.com/#pc=' + code } }, 400],
        ['__proto__ as a key', { body: '{"__proto__":{"clientCode":"' + code + '"}}' }, 400]
      ];
      for (const c of cases) {
        const r = await bx(p, 'POST', '/v1/connect', c[1]);
        ok('POST /v1/connect with ' + c[0] + ': ' + c[2], r.status === c[2] && r.body && r.body.ok === false && typeof r.body.error === 'string' && !r.text.includes(code), r.status + ' ' + r.text.slice(0, 80));
      }
      ok('none of them reached the controller or the site', M.spy.connect === 0);
      const r1 = await bx(p, 'POST', '/v1/run', { body: { now: true } });
      ok('POST /v1/run takes no key: {now:true} is 400, text/plain is 415', r1.status === 400 && (await bx(p, 'POST', '/v1/run', { body: '{}', type: 'text/plain' })).status === 415 && M.spy.run === 0);
      ok('a 5 KB chunked body is cut off and does not hang the program: the next request is served', (await bx(p, 'GET', '/v1/status')).status === 200);
      const m = [['GET', '/v1/connect'], ['POST', '/v1/status'], ['PUT', '/v1/run'], ['DELETE', '/v1/link'], ['POST', '/v1/link']];
      for (const x of m) { const r = await bx(p, x[0], x[1], { body: x[0] === 'GET' ? undefined : {} }); ok(x[0] + ' ' + x[1] + ': 405 with Allow', r.status === 405 && !!r.headers.allow, r.status); }
      for (const x of ['/', '/v1', '/v1/', '/v1/status/', '/v2/status', '/v1/status/../link', '/v1/%73tatus', '/V1/status', '/v1/statuss', '/etc/passwd', '/v1/status%00', '//v1/status']) { const r = await bx(p, 'GET', x); ok('GET ' + x + ' is 404 (an exact route only)', r.status === 404 || r.status === 400, r.status); }
      ok('a query string on a route is ignored, not used', (await bx(p, 'GET', '/v1/status?code=' + code)).status === 200);
      const bad = await new Promise(res => { const s = net.connect(p, '127.0.0.1', () => { s.write('GET http://attacker.example/v1/status HTTP/1.1\r\nHost: 127.0.0.1:' + p + '\r\nOrigin: ' + ORIGIN + '\r\n\r\n'); }); let t = ''; s.on('data', d => { t += d; s.end(); }); s.on('close', () => res(t)); s.on('error', () => res(t)); setTimeout(() => { s.destroy(); res(t); }, 2000); });
      ok('an absolute-form request line (a proxy-style URL) is refused, not routed', /^HTTP\/1\.1 400/.test(bad), bad.slice(0, 40));
    } finally { await M.close(); }
  }

  heading('the mutating routes are rate limited (a clock the test moves)');
  {
    const X = makeWorker('https://ppp.example.com');
    const clock = { t: 1000000 };
    const M = await makeBridge(X, { now: () => clock.t, stub: { status: () => ({ app: 'ppp-home-worker' }), link: () => null, connect: async () => ({ status: 200, body: { ok: true } }), run: async () => ({ status: 200, body: { ok: true } }) } });
    try {
      const codes = [];
      for (let i = 0; i < 8; i++) codes.push((await bx(M.port, 'POST', '/v1/connect', { body: { clientCode: rnd() } })).status);
      ok('connect: 6 a minute, then 429 with Retry-After', codes.slice(0, 6).every(c => c === 200) && codes[6] === 429 && codes[7] === 429, codes.join(','));
      const r = await bx(M.port, 'POST', '/v1/connect', { body: { clientCode: rnd() } });
      ok('the 429 says rate-limited and when to come back, and has the CORS header (the page can read it)', r.body && r.body.error === 'rate-limited' && +r.headers['retry-after'] >= 1 && r.headers['access-control-allow-origin'] === ORIGIN);
      clock.t += 61000;
      ok('a minute later it is allowed again', (await bx(M.port, 'POST', '/v1/connect', { body: { clientCode: rnd() } })).status === 200);
      const runs = [];
      for (let i = 0; i < 14; i++) runs.push((await bx(M.port, 'POST', '/v1/run', { body: {} })).status);
      ok('run: 12 a minute, then 429', runs.slice(0, 12).every(c => c === 200) && runs[12] === 429, runs.join(','));
      const l = [];
      for (let i = 0; i < 32; i++) l.push((await bx(M.port, 'GET', '/v1/link')).status);
      ok('link: 30 a minute (404 here: the stub has none), then 429', l.slice(0, 30).every(c => c === 404) && l[30] === 429, l.join(','));
      ok('the refusals of a stranger (wrong Host / Origin) cost nobody\'s budget: they are refused before the limiter', (await (async () => { for (let i = 0; i < 40; i++) await bx(M.port, 'POST', '/v1/connect', { origin: 'https://attacker.example', body: { clientCode: rnd() } }); return (await bx(M.port, 'GET', '/v1/status')).status; })()) === 200);
    } finally { await M.close(); }
  }

  /* ------------------------------------------------------------------ connect, against the real site code */
  heading('/v1/connect against the real site: the worker gets its OWN token, saves it, and nothing secret goes back to the page');
  const S = await L.startService({ users: ['u1', 'u2', 'u3'] });
  const SITE = 'http://127.0.0.1:' + S.port;
  ORIGIN = SITE;                       /* the bridge's allowed origin is the site's own (cfg.siteUrl) */
  const commands = [];
  const fakeRun = async (cmd, args) => { commands.push({ cmd: cmd, args: args }); return { code: 0, tail: 'cuda' }; };
  try {
    const X = makeWorker(SITE, { clientCode: '' }, { runTool: fakeRun });
    const M = await makeBridge(X);
    try {
      const p = M.port;
      const c1 = S.code('u1'), creationToken = S.token('u1');
      let st = (await bx(p, 'GET', '/v1/status')).body;
      ok('a worker with no link says so: link.has false, no name, nothing else secret', st.ok === true && st.app === 'ppp-home-worker' && st.api === 1 && st.link.has === false && st.link.tag === null && st.link.rejected === false && st.link.shareable === false && st.busy === false && st.job === null);
      ok('/v1/link has nothing to give (404)', (await bx(p, 'GET', '/v1/link')).status === 404);
      const before = fs.readFileSync(X.file, 'utf8');
      const r = await bx(p, 'POST', '/v1/connect', { body: { clientCode: c1 } });
      ok('connect: 200 ok, rotated, saved, and the NAME of the link (6 hex)', r.status === 200 && r.body.ok === true && r.body.rotated === true && r.body.saved === true && r.body.linkTag === W.linkTagOf(c1) && /^[0-9a-f]{6}$/.test(r.body.linkTag), r.text);
      ok('the answer holds neither a token nor the code (only the name)', !/ppw_/.test(r.text) && !r.text.includes(c1) && Object.keys(r.body).sort().join() === 'linkTag,ok,rotated,saved');
      ok('the worker has a token of its own: the right shape and not the one the link was made with', TOKEN_RE.test(X.cfg.token) && X.cfg.token !== creationToken);
      ok('the token the browser was given when the link was made is dead now (rotated)', (await S.worker(creationToken).get('/api/worker/ping')).status === 401);
      ok('the worker\'s new token works at the site', (await S.worker(X.cfg.token).get('/api/worker/ping')).status === 200);
      const saved = readSettings(X.file);
      ok('the settings file got the token and the code, and every other key of it is as it was', saved.token === X.cfg.token && saved.clientCode === c1 && saved.keepKept === 'yes' && saved.siteUrl === SITE && Object.keys(JSON.parse(before)).every(k => k === 'token' || k === 'clientCode' || saved[k] === JSON.parse(before)[k]));
      ok('no temporary file was left beside it', fs.readdirSync(X.dir).filter(f => /\.tmp$/.test(f)).length === 0);
      ok('the site marks the PC as seen at once (the page can offer its button)', (await S.as('u1').get('/api/worker/status')).body.worker.everSeen === true);
      st = (await bx(p, 'GET', '/v1/status')).body;
      ok('status now: linked, the name equals the site\'s linkTag, shareable (the code is held)', st.link.has === true && st.link.tag === (await S.as('u1').get('/api/worker/status')).body.worker.linkTag && st.link.shareable === true);
      ok('the status answer holds no secret (neither the token nor the code, anywhere in it)', !JSON.stringify(st).includes(X.cfg.token) && !JSON.stringify(st).includes(c1) && !/ppw_/.test(JSON.stringify(st)));
      const l = await bx(p, 'GET', '/v1/link');
      ok('/v1/link gives the code and the name to the allowed origin', l.status === 200 && l.body.clientCode === c1 && l.body.linkTag === st.link.tag);
      const rot = (await S.as('u1').get('/api/worker/status')).body;
      const again = [];
      for (let i = 0; i < 12; i++) again.push(await M.ctl.connect(c1));
      ok('pressing it twelve more times is "already connected": no rotation, the token is the same (the site allows ten new tokens an hour)', again.every(a => a.status === 200 && a.body.rotated === false) && S.worker(X.cfg.token) && (await S.worker(X.cfg.token).get('/api/worker/ping')).status === 200 && X.cfg.token === saved.token);
      const NL = await makeBridge(X, { allowLink: false });
      try {
        const nl = await bx(NL.port, 'GET', '/v1/link');
        ok('with "bridgeLink": false the program gives the code to nobody: /v1/link is 404 and the status says it is not shareable', nl.status === 404 && !nl.text.includes(c1) && (await bx(NL.port, 'GET', '/v1/status')).body.link.shareable === false);
      } finally { await NL.close(); }
      /* a wrong code */
      const tokenNow = X.cfg.token, fileNow = fs.readFileSync(X.file, 'utf8');
      const wrong = await bx(p, 'POST', '/v1/connect', { body: { clientCode: rnd() } });
      ok('a code the site does not know: 422 code-rejected, nothing changed (token, file)', wrong.status === 422 && wrong.body.error === 'code-rejected' && X.cfg.token === tokenNow && fs.readFileSync(X.file, 'utf8') === fileNow);
      /* another link, a conversion in hand */
      X.w.state.job = { title: 'A song', stage: 'transcribe', pct: 0.4 };
      const c2 = S.code('u2');
      const busy = await bx(p, 'POST', '/v1/connect', { body: { clientCode: c2 } });
      ok('another link while a conversion runs: 409 busy, the token and the file are untouched', busy.status === 409 && busy.body.error === 'busy' && X.cfg.token === tokenNow && fs.readFileSync(X.file, 'utf8') === fileNow);
      const same = await bx(p, 'POST', '/v1/connect', { body: { clientCode: c1 } });
      ok('the same link while it runs is fine (nothing changes)', same.status === 200 && same.body.rotated === false);
      const live = (await bx(p, 'GET', '/v1/status')).body;
      ok('status during the job: busy, the title, the stage, a percent (40% of the models is 10 + 85 x 0.4 = 44)', live.busy === true && live.job.title === 'A song' && live.job.stage === 'transcribe' && live.job.percent === 44);
      X.w.state.job = null;
      const sw = await bx(p, 'POST', '/v1/connect', { body: { clientCode: c2 } });
      ok('idle again: the worker is switched to the other link (new token, new code in the file)', sw.status === 200 && sw.body.rotated === true && X.cfg.token !== tokenNow && TOKEN_RE.test(X.cfg.token) && readSettings(X.file).clientCode === c2 && readSettings(X.file).token === X.cfg.token);
      ok('and the first link\'s name is no longer the worker\'s', (await bx(p, 'GET', '/v1/status')).body.link.tag === W.linkTagOf(c2));
      /* a site that is down, a site that says no */
      const tok2 = X.cfg.token, file2 = fs.readFileSync(X.file, 'utf8');
      const D = await makeBridge(X, { request: async () => { throw new Error('connection refused'); } });
      try {
        const r502 = await bx(D.port, 'POST', '/v1/connect', { body: { clientCode: S.code('u3') } });
        ok('the site is down: 502 site-unreachable, nothing changed', r502.status === 502 && r502.body.error === 'site-unreachable' && X.cfg.token === tok2 && fs.readFileSync(X.file, 'utf8') === file2);
      } finally { await D.close(); }
      const D2 = await makeBridge(X, { request: async (cfg, m, pth) => (pth === '/api/worker/status' ? { status: 200, body: { worker: {} } } : { status: 429, body: { error: 'x', code: 'too-many' }, headers: {} }) });
      try {
        const r429 = await bx(D2.port, 'POST', '/v1/connect', { body: { clientCode: S.code('u3') } });
        ok('the site refuses a new token (its own limit): 429 site-busy, nothing changed', r429.status === 429 && r429.body.error === 'site-busy' && X.cfg.token === tok2 && fs.readFileSync(X.file, 'utf8') === file2);
      } finally { await D2.close(); }
      const D3 = await makeBridge(X, { request: async (cfg, m, pth) => (pth === '/api/worker/status' ? { status: 200, body: { worker: {} } } : { status: 201, body: { workerToken: 'not a token' }, headers: {} }) });
      try {
        const rbad = await bx(D3.port, 'POST', '/v1/connect', { body: { clientCode: S.code('u3') } });
        ok('a site that answers with something that is not a token: 502, nothing stored', rbad.status === 502 && X.cfg.token === tok2 && fs.readFileSync(X.file, 'utf8') === file2);
      } finally { await D3.close(); }
      /* what the page said never became a command, and no secret is in a log line */
      ok('no program was started by any of this (the fake tool runner saw nothing: connect starts no tool)', commands.length === 0);
      const logText = X.log.lines.join('\n');
      ok('no log line holds a client code or a worker token (the log here is NOT the redacting one)', ![S.code('u1'), S.code('u2'), S.code('u3'), creationToken, tok2, X.cfg.token].some(s => logText.includes(s)) && !/ppw_[A-Za-z0-9_-]{12}_/.test(logText) && !/\b[0-9a-f]{64}\b/.test(logText), logText.slice(0, 300));
      ok('the log says what happened (the link\'s name, not the code)', /now connected to PC link \.\.\.[0-9a-f]{6}/.test(logText));
    } finally { await M.close(); }

    /* the disk */
    heading('/v1/connect when the settings file cannot be written: the link is used, the next press saves it; a file that is not JSON is never overwritten');
    {
      const Y = makeWorker(SITE, {}, { runTool: fakeRun });
      const blocker = path.join(Y.dir, 'a-file');
      fs.writeFileSync(blocker, 'x');
      const goodFile = Y.cfg._file;
      Y.cfg._file = path.join(blocker, 'worker.config.json');          /* a "folder" that is a file: nothing can be written there */
      const M2 = await makeBridge(Y);
      try {
        const c = S.code('u3');
        const r = await bx(M2.port, 'POST', '/v1/connect', { body: { clientCode: c } });
        ok('the answer says saved:false, and the worker uses the new token at once', r.status === 200 && r.body.saved === false && TOKEN_RE.test(Y.cfg.token) && (await S.worker(Y.cfg.token).get('/api/worker/ping')).status === 200, r.text);
        ok('the log says it could not write (and has no secret)', /could not be written to the settings file/.test(Y.log.lines.join('\n')) && !Y.log.lines.join('\n').includes(c));
        const tk = Y.cfg.token;
        Y.cfg._file = goodFile;
        const r2 = await bx(M2.port, 'POST', '/v1/connect', { body: { clientCode: c } });
        ok('pressing again (the folder is fine now): rotated:false, saved:true, the file has the SAME token', r2.status === 200 && r2.body.rotated === false && r2.body.saved === true && Y.cfg.token === tk && readSettings(goodFile).token === tk && readSettings(goodFile).clientCode === c, r2.text);
        const Z = makeWorker(SITE, {}, { runTool: fakeRun });
        fs.writeFileSync(Z.file, '{ "siteUrl": oops');
        const M3 = await makeBridge(Z);
        try {
          const r3 = await bx(M3.port, 'POST', '/v1/connect', { body: { clientCode: S.code('u2') } });
          ok('a settings file that is not JSON: saved:false and the file is left exactly as it was', r3.status === 200 && r3.body.saved === false && fs.readFileSync(Z.file, 'utf8') === '{ "siteUrl": oops');
        } finally { await M3.close(); }
        const E = makeWorker(SITE, {}, { runTool: fakeRun });
        E.cfg._file = '';                                                  /* settings that are only the environment: a new file in the home folder's .ppp-home-worker */
        const home = L.tmpDir('ppp-hw-home-');
        const e1 = await new Promise(res => { try { W.saveSettings(E.cfg, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43), clientCode: c }, { homedir: () => home }); res(null); } catch (e) { res(e); } });
        const made = path.join(home, '.ppp-home-worker', 'worker.config.json');
        ok('with no settings file a new one is made in ~/.ppp-home-worker with the site address, the token and the code', e1 === null && fs.existsSync(made) && readSettings(made).siteUrl === SITE && readSettings(made).clientCode === c && /^ppw_/.test(readSettings(made).token));
      } finally { await M2.close(); }
    }

    /* /v1/run */
    heading('/v1/run: the run lock, one at a time, nothing when another run holds the lock');
    {
      const claims = { n: 0, gate: null, answer: () => ({ status: 200, body: { job: null, nextPollSeconds: 3600 }, headers: {} }) };
      const fakeSite = async (cfg, m, pth) => { if (pth === '/api/worker/claim') { claims.n++; if (claims.gate) await claims.gate; return claims.answer(); } return { status: 200, body: {}, headers: {} }; };
      const locks = { took: 0, released: 0, free: true };
      const lockApi = { take: () => { if (!locks.free) return { ok: false, pid: 4242 }; locks.took++; locks.free = false; return { ok: true }; }, release: () => { locks.released++; locks.free = true; } };
      const R = makeWorker(SITE, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) }, { request: fakeSite, runTool: fakeRun, lockApi: lockApi });
      const M4 = await makeBridge(R, { request: fakeSite });
      try {
        let release; claims.gate = new Promise(r => { release = r; });
        const a = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        ok('the first call starts a run (200 started)', a.status === 200 && a.body.ok === true && a.body.started === true && !a.body.queued, a.text);
        await sleep(50);
        ok('it holds the run lock and the worker says it is checking', locks.took === 1 && locks.free === false && R.w.state.running === true && (await bx(M4.port, 'GET', '/v1/status')).body.checking === true);
        const b = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        ok('a call while a run is going asks for one more look at the queue (started, queued) and starts no second run', b.body.started === true && b.body.queued === true && locks.took === 1);
        release(); claims.gate = null;
        for (let i = 0; i < 100 && R.w.state.running; i++) await sleep(20);
        ok('the run ends: lock released, not running, and the queue was looked at TWICE (the run, and the one more look)', R.w.state.running === false && locks.released === 1 && locks.free === true && claims.n === 2, 'claims ' + claims.n);
        const c = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        ok('a call within 2 s of the last start: started false, too-soon (nothing is asked of the site)', c.body.started === false && c.body.reason === 'too-soon' && claims.n === 2, c.text);
        R.w.state.lastRunAt = 0;
        locks.free = false;
        const d = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        ok('another run (the scheduled task, the desktop shortcut) holds the lock: started false, other-run, and NOT ONE request went to the site', d.body.started === false && d.body.reason === 'other-run' && claims.n === 2 && R.w.state.running === false, d.text);
        locks.free = true;
        R.cfg.token = '';
        const e = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        ok('no link: started false, no-link', e.body.started === false && e.body.reason === 'no-link' && claims.n === 2);
        R.cfg.token = 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43); R.w.state.rejected = true;
        ok('a rejected link: started false, rejected', (await bx(M4.port, 'POST', '/v1/run', { body: {} })).body.reason === 'rejected');
        R.w.state.rejected = false;
        claims.answer = () => ({ status: 401, body: { error: 'x', code: 'bad-token' }, headers: {} });
        const f = await bx(M4.port, 'POST', '/v1/run', { body: {} });
        for (let i = 0; i < 100 && R.w.state.running; i++) await sleep(20);
        ok('a run that finds the token rejected marks the link as rejected (the page then offers the button again), and the lock is released', f.body.started === true && R.w.state.rejected === true && locks.free === true && (await bx(M4.port, 'GET', '/v1/status')).body.link.rejected === true);
      } finally { await M4.close(); }
      /* the real lock file, in a real process's way: acquireRunLock */
      const T = makeWorker(SITE, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) }, {});
      const real = { take: () => W.acquireRunLock(T.cfg), release: l => W.releaseRunLock(l) };
      const T1 = makeWorker(SITE, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) }, { request: fakeSite, runTool: fakeRun, lockApi: real });
      T1.cfg._file = T.cfg._file;
      let rel; claims.gate = new Promise(r => { rel = r; }); claims.answer = () => ({ status: 200, body: { job: null, nextPollSeconds: 3600 }, headers: {} });
      const n0 = claims.n;
      const s1 = T1.w.runNow();
      await sleep(30);
      const lockFile = path.join(path.dirname(T.cfg._file), 'worker.lock');
      ok('the real lock file worker.lock exists while the bridge\'s run is going, with this process as owner', s1.started === true && fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.pid);
      const T2 = makeWorker(SITE, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) }, { request: fakeSite, runTool: fakeRun, lockApi: real });
      T2.cfg._file = T.cfg._file;
      const s2 = T2.w.runNow();
      ok('a second worker object on the same settings folder (another process would be the same) is refused: other-run', s2.started === false && s2.reason === 'other-run');
      rel(); claims.gate = null;
      for (let i = 0; i < 100 && T1.w.state.running; i++) await sleep(20);
      ok('when the run ends the lock file is gone', !fs.existsSync(lockFile) && claims.n === n0 + 1);
    }

    /* the loop */
    heading('--serve loop: waits for a link, survives a rejected token, honours the site\'s wait, and status never touches the site');
    {
      const claims = { n: 0, status: 200, next: 3600 };
      const siteCalls = [];
      const fakeSite = async (cfg, m, pth, o) => {
        siteCalls.push(m + ' ' + pth);
        if (pth === '/api/worker/claim') { claims.n++; return claims.status === 401 ? { status: 401, body: { error: 'x', code: 'bad-token' }, headers: {} } : { status: 200, body: { job: null, nextPollSeconds: claims.next }, headers: {} }; }
        if (pth === '/api/worker/status') return { status: 200, body: { worker: {} }, headers: {} };
        if (pth === '/api/pc-links/me/worker-token') return { status: 201, body: { workerToken: 'ppw_' + 'N'.repeat(12) + '_' + 'm'.repeat(43) }, headers: {} };
        if (pth === '/api/worker/ping') return { status: 200, body: { ok: true }, headers: {} };
        return { status: 404, body: {}, headers: {} };
      };
      const V = makeWorker(SITE, {}, { request: fakeSite, runTool: fakeRun, lockApi: { take: () => ({ ok: true }), release: () => {} }, waitScale: 1 });
      const M5 = await makeBridge(V, { request: fakeSite });
      const loop = V.w.runForever({ serve: true });
      let ended = false; loop.then(() => { ended = true; });
      try {
        await sleep(150);
        ok('no PC link: the loop makes NO request to the site and does not end', claims.n === 0 && siteCalls.length === 0 && !ended);
        const sx = (await bx(M5.port, 'GET', '/v1/status')).body;
        ok('and the bridge says so (link.has false, next check none)', sx.link.has === false && sx.nextCheckAt === null);
        const code = rnd();
        const r = await bx(M5.port, 'POST', '/v1/connect', { body: { clientCode: code } });
        ok('connect gives it a link', r.status === 200 && r.body.rotated === true && TOKEN_RE.test(V.cfg.token));
        for (let i = 0; i < 100 && claims.n < 1; i++) await sleep(20);
        ok('the connect wakes the loop: it checks the site at once, with the new token', claims.n === 1);
        await sleep(100);
        const s2 = (await bx(M5.port, 'GET', '/v1/status')).body;
        const wait = (Date.parse(s2.nextCheckAt) - Date.now()) / 1000;
        ok('then it waits what the site said (3600 s idle), not less: next check in ' + Math.round(wait) + ' s', wait > 3590 && wait <= 3600, String(wait));
        ok('the status shows the last check (ok) and its time', s2.lastCheckOk === true && Date.now() - Date.parse(s2.lastCheckAt) < 5000);
        const before = siteCalls.length;
        for (let i = 0; i < 60; i++) await bx(M5.port, 'GET', '/v1/status');
        ok('sixty status looks later the site has been asked NOTHING (a status look is answered from memory)', siteCalls.length === before && claims.n === 1);
        await sleep(300);
        ok('and nothing polled by itself in the meantime (no faster than the site\'s hour)', claims.n === 1);
        /* a token the site rejects: the loop survives */
        claims.status = 401;
        V.w.ctl.wake();
        for (let i = 0; i < 100 && !V.w.state.rejected; i++) await sleep(20);
        ok('the site rejects the token: the loop does NOT end (a worker that exits cannot be reconnected by the page), the link is marked rejected', V.w.state.rejected === true && !ended && (await bx(M5.port, 'GET', '/v1/status')).body.link.rejected === true);
        const n = claims.n;
        await sleep(300);
        ok('and it asks no more until a new link comes', claims.n === n);
        claims.status = 200;
        const r2 = await bx(M5.port, 'POST', '/v1/connect', { body: { clientCode: rnd() } });
        for (let i = 0; i < 100 && claims.n < n + 1; i++) await sleep(20);
        ok('a new connect clears the rejection and the loop goes on', r2.status === 200 && V.w.state.rejected === false && claims.n === n + 1 && !ended);
      } finally {
        V.w.ctl.stop = true; V.w.ctl.wake();
        const code = await Promise.race([loop, sleep(3000).then(() => 'hang')]);
        ok('stop: the loop ends with 0 (not stuck in its day-long wait)', code === 0, String(code));
        await M5.close();
        const closed = await new Promise(res => { const s = net.connect(M5.port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(false); }); s.on('error', () => res(true)); });
        ok('and the bridge\'s port is closed after it', closed);
      }
    }

    /* a token changed while a check was on its way */
    heading('a 401 for the OLD token, answered after the link changed, does not mark the new link as rejected');
    {
      let gate; const hold = new Promise(r => { gate = r; });
      const fakeSite = async (cfg, m, pth) => { if (pth === '/api/worker/claim') { await hold; return { status: 401, body: { error: 'x', code: 'bad-token' }, headers: {} }; } return { status: 200, body: {}, headers: {} }; };
      const V = makeWorker(SITE, { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) }, { request: fakeSite, runTool: fakeRun });
      const pr = V.w.poll(false);
      V.cfg.token = 'ppw_' + 'C'.repeat(12) + '_' + 'd'.repeat(43);
      gate();
      const got = await pr.catch(e => e);
      ok('the poll that was asked with the old token comes back "look again soon" (job null, 5 s), not as a rejection', got && got.job === null && got.next === 5 && V.w.state.rejected === false, JSON.stringify(got && got.message || got));
    }

    /* real processes */
    heading('real processes: a second --serve stops at once; a port held by another program is said; test mode needs both variables and a loopback origin');
    {
      const dir = L.tmpDir('ppp-hw-proc-');
      const file = path.join(dir, 'worker.config.json');
      fs.writeFileSync(file, JSON.stringify({ siteUrl: SITE, scratchDir: path.join(dir, 'scratch'), pythonPath: process.execPath, transcribePy: file, ffmpegPath: process.execPath, keepKept: 1 }));
      const port = await freePort();
      const start = (extraEnv) => {
        const child = spawn(process.execPath, [path.join(L.MODS, 'tools/home-worker/worker.js'), '--serve', '--config', file], { env: Object.assign({}, process.env, { PPP_WORKER_BRIDGE_PORT: String(port), PPP_WORKER_TOKEN: '' }, extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const o = { out: '', code: null, child: child };
        child.stdout.on('data', d => { o.out += d; }); child.stderr.on('data', d => { o.out += d; });
        o.done = new Promise(res => child.on('close', c => { o.code = c; res(c); }));
        return o;
      };
      const up = async () => { for (let i = 0; i < 100; i++) { try { const r = await bx(port, 'GET', '/v1/status', { origin: SITE }); if (r.status === 200) return r; } catch (e) { /* not yet */ } await sleep(100); } return null; };
      const first = start();
      try {
        const r = await up();
        ok('the first `worker.js --serve` (no token in its settings: fine) answers on the configured port', !!r && r.body.app === 'ppp-home-worker' && r.body.link.has === false, first.out.slice(0, 300));
        ok('its log says where it listens and who may use it', /Bridge: listening on 127\.0\.0\.1:\d+ for http:\/\/127\.0\.0\.1:\d+/.test(first.out) && !/\b[0-9a-f]{64}\b/.test(first.out), first.out.slice(0, 300));
        const second = start();
        const c2 = await Promise.race([second.done, sleep(15000).then(() => 'hang')]);
        ok('a second `--serve` finds the port taken by this program, says so (Korean and English) and stops with 0', c2 === 0 && /이미 실행 중이에요/.test(second.out) && /already running/.test(second.out), 'code ' + c2 + ' ' + second.out.slice(0, 300));
        ok('the first is still serving', (await bx(port, 'GET', '/v1/status', { origin: SITE })).status === 200 && first.code === null);
        const code = S.code('u2');
        const cr = await bx(port, 'POST', '/v1/connect', { origin: SITE, body: { clientCode: code } });
        ok('through the real process: connect rotates, saves, and the settings file of the process has them', cr.status === 200 && cr.body.rotated === true && readSettings(file).clientCode === code && TOKEN_RE.test(readSettings(file).token) && readSettings(file).keepKept === 1 && !/\b[0-9a-f]{64}\b/.test(first.out) && !/ppw_[A-Za-z0-9_-]{12}_/.test(first.out), first.out.slice(-400));
        ok('its log does not show the code or the token (the redacting log, as in production)', !first.out.includes(code) && !first.out.includes(readSettings(file).token));
        const lk = await bx(port, 'GET', '/v1/link', { origin: SITE });
        ok('/v1/link through the real process gives the saved code', lk.status === 200 && lk.body.clientCode === code);
      } finally { first.child.kill(); await first.done; }
      /* a port held by something else */
      const blocker = http.createServer((q, r) => { r.end('hello'); });
      await new Promise(r => blocker.listen(port, '127.0.0.1', r));
      const third = start();
      const c3 = await Promise.race([third.done, sleep(15000).then(() => 'hang')]);
      ok('a port held by ANOTHER program: exit 1 and a sentence that says to change bridgePort', c3 === 1 && /다른 프로그램/.test(third.out) && /bridgePort/.test(third.out), 'code ' + c3 + ' ' + third.out.slice(0, 300));
      await new Promise(r => blocker.close(r));
      /* test mode */
      const tport = await freePort();
      const TO = 'http://127.0.0.1:' + (tport + 1);
      const probeWith = async (extra, o) => {
        const pr = start(Object.assign({ PPP_WORKER_BRIDGE_PORT: String(tport) }, extra));
        try {
          for (let i = 0; i < 100; i++) { try { const r = await bx(tport, 'GET', '/v1/status', { origin: SITE }); if (r.status === 200) break; } catch (e) { /* not yet */ } await sleep(100); }
          return (await bx(tport, 'GET', '/v1/status', { origin: o })).status;
        } finally { pr.child.kill(); await pr.done; }
      };
      ok('PPP_WORKER_TEST_ORIGIN alone (no PPP_WORKER_TEST_MODE=1) opens nothing', (await probeWith({ PPP_WORKER_TEST_ORIGIN: TO }, TO)) === 403);
      ok('both variables with a loopback origin: that origin is served', (await probeWith({ PPP_WORKER_TEST_MODE: '1', PPP_WORKER_TEST_ORIGIN: TO }, TO)) === 200);
      ok('both variables with an origin that is not loopback (or not http): still refused', (await probeWith({ PPP_WORKER_TEST_MODE: '1', PPP_WORKER_TEST_ORIGIN: 'https://attacker.example' }, 'https://attacker.example')) === 403);
      L.rmDir(dir);
    }
  } finally { await S.close(); }
  L.finish('the localhost bridge of the home-PC worker');
})().catch(e => { console.error(e); process.exit(1); });
