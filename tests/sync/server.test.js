/* G13-S0: server.js itself, on its file store (no Postgres needed): the flag, the routes through the real request handler, the hourly stats line, and what the log and
   the data file hold. tests/sync/sync-pg.test.js does the same on a database, with the boots PR -> main -> PR.

   Run: node tests/sync/server.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req, sleep } = L;
const { spawn } = require('child_process');
const { freePort } = require('../serve-free');
const path = L.path, fs = L.fs;
const bad = (r, status, code) => r.status === status && r.body && r.body.code === code;

async function start(env, dir) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(L.MODS, 'server.js')], {
    cwd: L.REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, SESSION_SECRET: 'sync-server-test', DATABASE_URL: '' }, env || {})
  });
  let exited = false;
  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early: ' + logs.join('').slice(-300));
    try { if ((await req(port, 'GET', '/health')).status === 200) break; } catch (e) { /* not up */ }
    if (Date.now() - t0 > 30000) { child.kill(); throw new Error('server.js did not come up'); }
    await sleep(120);
  }
  return { port: port, log: () => logs.join(''), close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
/* the stats lines of a log, parsed */
const statsLines = out => out.split(/\r?\n/).filter(l => /^stats: \{/.test(l)).map(l => JSON.parse(l.slice(7)));

(async () => {
  heading('PPP_SYNC unset: nothing is mounted');
  {
    const dir = L.tmpDir('ppp-sync-srv-');
    const s = await start({ PPP_STATS_INTERVAL_MS: '1200' }, dir);
    try {
      const unknown = await req(s.port, 'GET', '/api/no-such-route');
      const rs = [
        await req(s.port, 'POST', '/api/libs', { body: {} }),
        await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': '0'.repeat(64) } }),
        await req(s.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': '0'.repeat(64) }, body: { items: [] } }),
        await req(s.port, 'DELETE', '/api/sync/items/song%3Aa?baseRev=0', { headers: { 'X-PPP-Lib': '0'.repeat(64) } }),
        await req(s.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': '0'.repeat(64) }, body: {} }),
        await req(s.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': '0'.repeat(64) } })
      ];
      ok('every route of the feature answers exactly as a route that never existed (404, the same body)', rs.every(r => r.status === 404 && r.text === unknown.text), rs.map(r => r.status).join());
      ok('no data file of the feature is made, and the log says nothing of it', !fs.existsSync(path.join(dir, 'sync.json')) && !/Song sync/i.test(s.log()));
      await sleep(1700);
      const lines = statsLines(s.log());
      ok('the stats line has no `sync` block and no `api-sync` class: it is the line of a server without the feature', lines.length >= 1 && lines.every(d => !('sync' in d) && !('api-sync' in d.by) && Object.keys(d.by).join() === 'static,api-auth,api-shares,api-jobs,api-stats,health,other'), s.log().slice(-300));
    } finally { await s.close(); L.rmDir(dir); }
  }

  heading('PPP_SYNC=1: the routes through the real server');
  {
    const dir = L.tmpDir('ppp-sync-srv-');
    const env = { PPP_SYNC: '1', PPP_STATS_INTERVAL_MS: '1500', PPP_SYNC_TOTAL_MB: '4' };
    let s = await start(env, dir);
    let code, id;
    try {
      ok('the boot says the feature is on, once', (s.log().match(/Song sync: on/g) || []).length === 1);
      const mk = await req(s.port, 'POST', '/api/libs', { body: {}, ip: '198.51.100.40' });
      code = mk.body.code; id = mk.body.id;
      ok('a library is made with no sign-in and no cookie: 201 with its code, once', mk.status === 201 && /^[0-9a-f]{64}$/.test(code) && !mk.headers['set-cookie'] && !Object.keys(mk.headers).some(h => /^access-control/i.test(h)));
      const H = { 'X-PPP-Lib': code };
      const one = L.item('song:one');
      let r = await req(s.port, 'PUT', '/api/sync/items', { headers: H, body: { device: 'a1b2c3d4e5f60718', items: [one, L.item('state', { v: 1, xp: 2 })] } });
      ok('items are written through the real handler', r.status === 200 && r.body.applied.length === 2 && r.headers['cache-control'] === 'no-store' && r.headers['x-content-type-options'] === 'nosniff', r.status + ' ' + r.text.slice(0, 100));
      r = await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: H });
      ok('and listed', r.status === 200 && r.body.items.length === 2 && r.body.maxRev === 2);
      r = await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': '1'.repeat(64) } });
      ok('a wrong code: 401 bad-code', bad(r, 401, 'bad-code'));
      r = await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: Object.assign({ Origin: 'https://evil.example' }, H) });
      ok('another origin: 403 cross-site (the real server\'s own Host header is compared)', bad(r, 403, 'cross-site'));
      r = await req(s.port, 'OPTIONS', '/api/sync/items', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } });
      ok('a preflight gets no Access-Control-Allow-* (CORS closed)', !r.headers['access-control-allow-origin'] && r.status >= 400);
      r = await req(s.port, 'GET', '/');
      ok('the page itself is unaffected', r.status === 200 && /<html|<!doctype/i.test(r.text));
      /* fill the site past 80 %: six items of about 640 KB of gzip each (the cap here is 4 MB) */
      const big = i => L.item('song:big' + i, Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(640 * 1024).toString('base64') } }));
      for (let i = 0; i < 6; i++) r = await req(s.port, 'PUT', '/api/sync/items', { headers: H, body: { items: [big(i)] } });
      ok('the sixth big item is taken (about 94 % of the 4 MB cap)', r.status === 200, r.status + ' ' + r.text.slice(0, 80));
      await sleep(2100);
      const out = s.log();
      /* every line there is: the first has the first requests, the last has the cap; the windows start again from zero, so they add up */
      const lines = statsLines(out).filter(d => d.sync);
      const last = lines[lines.length - 1];
      const total = lines.reduce((o, x) => ({ written: o.written + x.sync.written, made: o.made + x.sync.made, reqs: o.reqs + (x.by['api-sync'] ? x.by['api-sync'].requests : 0) }), { written: 0, made: 0, reqs: 0 });
      ok('the hourly lines have a `sync` block: libraries, rows, bytes against the cap, written and read, refused by kind, and the class api-sync with the requests',
        !!last && last.sync.libs === 1 && last.sync.items >= 2 && last.sync.capBytes === 4 * 1048576 && total.made === 1 && total.written >= 6 && !!last.sync.refused && total.reqs >= 10, lines.length + ' ' + JSON.stringify(total) + ' ' + out.slice(-300));
      ok('past 80 % of the cap the line is followed by one `stats: WARNING` line, and the block says it too', !!last && last.sync.pct >= 80 && /stats: WARNING sync storage is at \d+(\.\d)? % of its 4 MB cap/.test(out) && /sync storage is at/.test(last.sync.warn || ''), String(last && last.sync.pct) + ' ' + out.slice(-200));
      ok('the line holds no code, no id, no address', out.indexOf(code) < 0 && out.indexOf(id) < 0 && out.indexOf('198.51.100.40') < 0);
      ok('and nothing in the log is the code (it is never logged)', out.indexOf(code) < 0);
    } finally { await s.close(); }
    const data = fs.readFileSync(path.join(dir, 'sync.json'), 'utf8');
    ok('the data file holds the hash of the code and the id: never the code', data.indexOf(code) < 0 && data.indexOf(id) >= 0 && data.indexOf(require('crypto').createHash('sha256').update('ppp-lib-v1:' + code).digest('hex')) >= 0);
    /* a restart on the same data */
    s = await start(env, dir);
    try {
      const r = await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } });
      ok('a restart keeps the library: same code, items, revisions', r.status === 200 && r.body.items.length >= 2 && r.body.maxRev >= 2);
      const del = await req(s.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': code } });
      const after = await req(s.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } });
      ok('deleting the library through the real server: 200, then the code says "deleted"', del.status === 200 && bad(after, 401, 'deleted'));
    } finally { await s.close(); L.rmDir(dir); }
  }
})().then(() => L.finish('server.js and the sync feature'), e => { console.error(e); process.exit(1); });
