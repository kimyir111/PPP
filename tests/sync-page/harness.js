/* G13-S1: the server of the browser suite. One address for the page and for the sync routes, so that the page's own requests (same origin, no CORS) reach both:
     - this tree's server.js as a child process on a port of its own (the page, its scripts, its catalogs, /health ...; PPP_SYNC is NOT set there: its sync routes are 404),
     - the song-library service of sync.js IN THIS PROCESS (tests/sync/lib.js's pieces: a file store in a temp folder, a store that counts its calls, a clock the test moves),
       mounted on /api/libs* and /api/sync/*, with a place for a test to make the next answers fail (busy, 429 with Retry-After, a dead connection) and a log of every URL.
   So a browser test can say "31 days pass", "the library answers busy twice", "this idle visit cost the store 1 call" - and a check that no code is ever in a URL reads the log.
   Ports come from PPP_PORT_RANGE (the suite sets 10850-10899). */
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const L = require('../sync/lib.js');
const { freePort } = require('../serve-free');

const REPO = L.REPO;

async function listenFree(server) {
  for (let tries = 0; ; tries++) {
    const port = await freePort();
    try {
      await new Promise((resolve, reject) => { const onErr = e => { server.removeListener('error', onErr); reject(e); }; server.once('error', onErr); server.listen(port, '127.0.0.1', () => { server.removeListener('error', onErr); resolve(); }); });
      return port;
    } catch (e) { if (tries >= 40 || !e || e.code !== 'EADDRINUSE') throw e; }
  }
}

/* o: { root (a tree to serve; default this one), config (sync.js config), env } */
async function startHarness(o) {
  o = o || {};
  const root = o.root || REPO;
  /* the page's own server on its own port */
  const appPort = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(appPort), DATABASE_URL: '', PPP_SYNC: '', PPP_COUNTS: '' }, o.env || {})
  });
  let childOut = '';
  child.stdout.on('data', d => { childOut += d; });
  child.stderr.on('data', d => { childOut += d; });
  const healthy = () => new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: appPort, path: '/health', timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !(await healthy())) await new Promise(r => setTimeout(r, 150));
  if (!(await healthy())) { child.kill(); throw new Error('server.js did not answer /health: ' + childOut.slice(-300)); }

  /* the sync service, in this process */
  const mkSync = require(path.join(root, 'sync.js'));
  const { fileSyncStore } = require(path.join(root, 'sync-store.js'));
  const dir = L.tmpDir('ppp-sync-harness-');
  const store = L.countingStore(fileSyncStore(dir, { memory: false }));
  const clock = { t: Date.parse('2026-10-15T12:00:00Z') };
  const logged = [];
  const svc = mkSync.create({
    store: store, send: L.send, jsonError: L.jsonError,
    clientIp: r => String((r.headers['x-forwarded-for'] || r.socket.remoteAddress || '127.0.0.1')).split(',').pop().trim(),
    ipSecret: 'harness-secret', now: () => clock.t, env: o.env || {}, config: o.config, logError: e => logged.push(String(e && e.message))
  });
  /* what a test makes happen: the next n answers of the sync routes that match are replaced */
  const faults = [];
  const urls = [];                      /* every request of the page to any route, as the server saw it: method + path + query */
  const syncSeen = [];                  /* { method, url, hasCode, status } of the sync routes */
  let libCounter = 0;
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://' + (rq.headers.host || 'localhost'));
    urls.push(rq.method + ' ' + rq.url);
    if (svc.owns(url.pathname)) {
      const entry = { method: rq.method, url: rq.url, hasCode: rq.headers['x-ppp-lib'] !== undefined, at: Date.now() };
      syncSeen.push(entry);
      const f = faults.find(x => x.times > 0 && (!x.method || x.method === rq.method) && (!x.path || url.pathname.indexOf(x.path) === 0));
      if (f) {
        f.times--;
        entry.faulted = f.kind;
        if (f.kind === 'drop') { rq.socket.destroy(); return; }
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        if (f.retryAfter) headers['Retry-After'] = String(f.retryAfter);
        rq.resume();
        rs.writeHead(f.status, headers);
        rs.end(JSON.stringify({ error: 'injected', code: f.code || 'busy' }));
        return;
      }
      /* every library is made from an address of its own: the per-address limits are not what this suite tests */
      if (rq.method === 'POST' && url.pathname === '/api/libs') rq.headers['x-forwarded-for'] = '10.250.' + ((++libCounter >> 8) & 255) + '.' + (libCounter & 255);
      else if (!rq.headers['x-forwarded-for']) rq.headers['x-forwarded-for'] = '10.249.0.1';
      return svc.handle(rq, rs, url);
    }
    /* everything else is the page's server's */
    const headers = Object.assign({}, rq.headers, { host: '127.0.0.1:' + appPort });
    delete headers.origin;
    const up = http.request({ host: '127.0.0.1', port: appPort, method: rq.method, path: rq.url, headers: headers }, ur => {
      rs.writeHead(ur.statusCode, ur.headers);
      ur.pipe(rs);
    });
    up.on('error', () => { try { rs.writeHead(502); rs.end('bad gateway'); } catch (e) { /* gone */ } });
    rq.pipe(up);
  });
  const port = await listenFree(server);
  const H = {
    port: port, url: 'http://127.0.0.1:' + port, pageUrl: 'http://127.0.0.1:' + port + '/Piano%20Coach%20App.dc.html',
    svc: svc, store: store, clock: clock, logged: logged, faults: faults, urls: urls, syncSeen: syncSeen, childLog: () => childOut, appPort: appPort,
    advance: ms => { clock.t += ms; },
    fail: (spec) => { faults.push(Object.assign({ times: 1, status: 503 }, spec)); },
    close: () => new Promise(resolve => {
      try { child.kill(); } catch (e) { /* gone */ }
      try { server.closeAllConnections && server.closeAllConnections(); } catch (e) { /* gone */ }
      server.close(() => { L.rmDir(dir); resolve(); });
    }),
    /* the plain text of every item the library holds (what a person's devices sent, unpacked): for a check that no secret is in any of them */
    itemTexts: async code => {
      const zlib = require('zlib');
      const id = mkSync.libIdOf(mkSync.codeHash(code));
      const rows = await store.changes(id, 0, 5000);
      const out = [];
      for (let i = 0; i < rows.length; i += 25) {
        const part = await store.getItems(id, rows.slice(i, i + 25).filter(r => !r.deleted).map(r => r.key), 64 * 1024 * 1024);
        part.forEach(r => { if (r.body) out.push(zlib.gunzipSync(r.body).toString('utf8')); });
      }
      return out;
    },
    /* the library's own listing, with the code a test holds */
    list: async code => {
      let since = 0, items = [], maxRev = 0;
      for (let i = 0; i < 20; i++) {
        const r = await new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: port, path: '/api/sync/changes?since=' + since, headers: { 'X-PPP-Lib': code, 'X-Forwarded-For': '10.249.0.2' } }, res => {
            const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (e) { reject(e); } });
          }).on('error', reject);
        });
        if (r.status !== 200) return { status: r.status, items: [], body: r.body };
        items = items.concat(r.body.items); maxRev = r.body.maxRev;
        if (!r.body.more) break;
        since = r.body.nextSince;
      }
      return { status: 200, items: items, maxRev: maxRev };
    }
  };
  return H;
}

module.exports = { startHarness };
