/* G13-S1: the sync page against the REAL server.js on a real Postgres (the production shape: PPP_SYNC=1, DATABASE_URL), in real browsers, with the statements counted in the
   database's own log:

     - 30 songs are synced by device A and read by device B (the tables hold them);
     - an idle visit of a device (nothing changed) costs the feature's tables at most 4 statements - also the first visit after a server restart (the libraries are read
       once per boot), which is the visit a device that wakes the free instance makes.

   Needs a THROWAWAY Postgres and the `pg` package:

     docker run -d --name ppp-g13s1-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 127.0.0.1:55447:5432 postgres:17 -c log_statement=all
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55447/ppp PPP_TEST_PG_CONTAINER=ppp-g13s1-pg NODE_PATH=D:/PPP/node_modules node tests/sync-page/pg.test.js
     docker rm -f ppp-g13s1-pg

   It DROPS the ppp_sync_* tables first, so it refuses any database that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const http = require('http');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  - PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
process.env.PPP_PORT_RANGE = process.env.PPP_PORT_RANGE || '10850-10899';
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const { freePort } = require('../serve-free');

const REPO = path.resolve(__dirname, '..', '..');
const KO = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
const CONTAINER = process.env.PPP_TEST_PG_CONTAINER || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let passed = 0;
const ok = (name, cond, detail) => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : '')); if (cond) passed++; else errors.push(name + (detail ? ' — ' + detail : '')); };
const ko = key => { const v = KO[key]; return typeof v === 'string' ? v : '⟨no Korean: ' + key + '⟩'; };

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: URL_, SESSION_SECRET: 'sync-page-pg-secret', PPP_SYNC: '1' })
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const healthy = () => new Promise(resolve => { const r = http.get({ host: '127.0.0.1', port: port, path: '/health', timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); }); r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); }); });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && !(await healthy())) await sleep(200);
  if (!(await healthy())) { child.kill(); throw new Error('server.js did not answer: ' + log.slice(-400)); }
  return { port: port, url: 'http://127.0.0.1:' + port, log: () => log, stop: () => new Promise(r => { child.once('exit', r); child.kill(); setTimeout(r, 3000); }) };
}
/* the statements on the feature's tables since `mark` (an ISO time), from the database's own log */
function statements(mark) {
  if (!CONTAINER) return null;
  const r = spawnSync('docker', ['logs', '--since', mark, CONTAINER], { encoding: 'utf8' });
  const text = (r.stdout || '') + (r.stderr || '');
  return text.split('\n').filter(l => /ppp_sync_/.test(l) && /statement:|execute/.test(l));
}

(async () => {
  const pool = new Pool({ connectionString: URL_ });
  await pool.query('DROP TABLE IF EXISTS ppp_sync_items, ppp_sync_libs');
  let srv = await startServer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const allRequests = [], pageErrors = [];
  const pageUrl = () => srv.url + '/Piano%20Coach%20App.dc.html';
  try {
    ok('the boot made the two tables and says so', (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('ppp_sync_libs','ppp_sync_items')")).rows[0].n === 2 && /Song sync: on/.test(srv.log()));
    const proxy = { get pageUrl() { return pageUrl(); } };
    const BL = require('./browser-lib.js').make({ browser: browser, pageUrl: proxy.pageUrl, ko: ko, allRequests: allRequests, pageErrors: pageErrors, mutant: null, repo: REPO });
    const SONGS = await BL.prepSongs(30, false);
    const A = await BL.newDevice('A', { cards: SONGS.cards, slots: SONGS.slots });
    await A.open('?sync=on');
    await A.settings();
    const m0 = new Date().toISOString();
    await A.click('[data-sync-on]');
    await BL.waitFor(() => A.exists('[data-sync-link]'), 15000);
    const link = await A.value('[data-sync-link]');
    await A.click('[data-sync-recovery-saved]');
    const s = await A.synced(60000);
    await sleep(1200);
    ok('30 songs are synced by the page to the real server on Postgres', !!s && s.songs.done === 30, JSON.stringify(s && s.songs));
    const rows = (await pool.query('SELECT count(*)::int n, count(*) FILTER (WHERE deleted_at IS NULL)::int live FROM ppp_sync_items')).rows[0];
    ok('the table holds 31 items (30 songs and the state)', rows.n === 31 && rows.live === 31, JSON.stringify(rows));
    const first = statements(m0);
    if (first) console.log('    (turning on and syncing 30 songs: ' + first.length + ' statements on the tables)');

    const B = await BL.newDevice('B');
    await B.page.goto(link.replace(/^http:\/\/127\.0\.0\.1:\d+/, srv.url), { waitUntil: 'networkidle2', timeout: 60000 });
    await BL.waitFor(() => B.exists('[data-sync-join-box]'), 20000);
    const m1 = new Date().toISOString();
    await B.click('[data-sync-join-yes]');
    const sb = await B.synced(60000);
    await sleep(1200);
    ok('B joined and has the 30 songs', !!sb && (await B.cards()).length === 30);
    const joinStmts = statements(m1);
    if (joinStmts) console.log('    (joining and reading 30 songs: ' + joinStmts.length + ' statements)');

    /* the two devices meet each other's state once (a join is a change for the other one); then nothing changes anywhere */
    for (const d of [B, A, B, A]) { await d.open(''); await sleep(4500); await d.synced(30000); }
    /* an idle visit of A */
    await sleep(1100);
    const m2 = new Date().toISOString();
    await sleep(1100);
    await A.open('');
    await sleep(5000);                                  /* the page's own first cycle is 2.5 s after its load */
    await A.synced(30000);
    await sleep(1200);
    const idle = statements(m2);
    ok('an idle visit of A costs the feature\'s tables ' + (idle ? idle.length : '?') + ' statements (≤ 4)', !idle || idle.length <= 4, idle ? idle.slice(0, 4).map(x => x.replace(/^.*(statement|execute)[^:]*:\s*/, '').slice(0, 70)).join(' | ') : 'no container: not counted');

    /* the first visit after the server restarted (the libraries are read once per boot) */
    await srv.stop();
    srv = await startServer();
    await sleep(1100);
    const m3 = new Date().toISOString();
    await sleep(1100);
    await A.open('');
    await sleep(5000);
    await A.synced(30000);
    await sleep(1200);
    const cold = statements(m3);
    ok('the first visit after a restart of the server costs ' + (cold ? cold.length : '?') + ' statements (≤ 4: the libraries are read once, then the poll)', !cold || cold.length <= 4, cold ? cold.slice(0, 5).map(x => x.replace(/^.*(statement|execute)[^:]*:\s*/, '').slice(0, 70)).join(' | ') : 'no container: not counted');
    ok('and the page is synced and in no error', (await A.status()).error === null);
    ok('no page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } finally {
    try { await browser.close(); } catch (e) { /* gone */ }
    try { await srv.stop(); } catch (e) { /* gone */ }
    await pool.end();
  }
  if (errors.length) { console.error('\n' + errors.length + ' failed (' + passed + ' passed)'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
  console.log('\n' + passed + ' passed: the sync page on the real server and Postgres');
})().catch(e => { console.error(e); process.exit(1); });
