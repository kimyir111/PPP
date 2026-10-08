/* G13-5 on a real Postgres: the migration (a column on ppp_users), the signup limit counted from the accounts, and the paged list of Shared Scores (the file-store half
   is tests/signup-and-shares.test.js).

   Needs a THROWAWAY Postgres and the `pg` package (NODE_PATH may point at a tree that has it):

     docker run -d --name ppp-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 55432:5432 postgres:17-alpine
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/ppp NODE_PATH=D:/PPP/node_modules node tests/signup-and-shares-pg.test.js
     docker rm -f ppp-pg-test

   It DROPS the ppp_* tables first (to start from the schema production has today: no created_ip_tag), so it refuses any database that is not on localhost.
   Without PPP_TEST_PG_URL it says so and exits 0. */
'use strict';
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  – PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Client } = require('pg');
const SECRET = 'signup-pg-test-secret';

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function req(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(JSON.stringify(o.body));
    const headers = {};
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (o.ip) headers['X-Forwarded-For'] = o.ip;
    if (o.cookie) headers['Cookie'] = o.cookie;
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers }, res => {
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
async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: URL_, SESSION_SECRET: SECRET })
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early');
    try { if ((await req(port, 'GET', '/health')).status === 200) break; } catch (e) { /* not up */ }
    if (Date.now() - t0 > 30000) { child.kill(); throw new Error('server.js did not come up'); }
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 1500)); /* migration and seeds */
  return { port: port, close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
let seq = 0;
const signup = (port, ip) => req(port, 'POST', '/api/auth/signup', { ip: ip, body: { email: 'pg' + Date.now() + '-' + (++seq) + '@example.com', password: 'practice-ok', displayName: 'PG' } });
const { addrKey } = require(path.join(__dirname, '..', 'home-jobs.js'));
const tagOf = ip => {
  const key = crypto.createHmac('sha256', SECRET).update('ppp-signup-address').digest();
  return crypto.createHmac('sha256', key).update(addrKey(ip)).digest('hex').slice(0, 16);
};

(async () => {
  const db = new Client({ connectionString: URL_ });
  await db.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows;
  let srv = null;
  try {
    /* production today: no created_ip_tag on ppp_users; five accounts that exist already */
    await db.query('DROP TABLE IF EXISTS ppp_shares, ppp_progress, ppp_users CASCADE');
    await db.query(`
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, song_key TEXT NOT NULL,
        title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false,
        preview JSONB, score JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX ppp_shares_owner_song ON ppp_shares (owner_id, song_key);`);
    for (let i = 0; i < 5; i++) await db.query('INSERT INTO ppp_users (id, email, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, now() - interval \'3 days\')', ['old' + i, 'old' + i + '@example.com', 'Old', 'x']);

    console.log('\n── the migration ──');
    srv = await start();
    const col = async () => await one(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'ppp_users' AND column_name = 'created_ip_tag'`);
    ok('ppp_users has created_ip_tag, text, nullable', (await col()).length === 1 && (await col())[0].data_type === 'text' && (await col())[0].is_nullable === 'YES', JSON.stringify(await col()));
    ok('the five accounts that were there are untouched, with no tag', (await one(`SELECT count(*)::int AS n FROM ppp_users WHERE id LIKE 'old%' AND created_ip_tag IS NULL`))[0].n === 5);
    await srv.close();
    srv = await start();
    ok('a second boot (the migration again) is harmless', (await col()).length === 1 && (await one('SELECT count(*)::int AS n FROM ppp_users'))[0].n >= 5);
    /* the code before this change inserts the four columns it knows: that still works on the migrated table (rolling back = deploying it again) */
    let oldInsert = true;
    try { await db.query('INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)', ['old-code', 'oldcode@example.com', 'Old code', 'x']); } catch (e) { oldInsert = false; }
    ok('the previous code\'s INSERT still works on the migrated table', oldInsert);
    ok('the library\'s own account (made by the seeds) has no tag', (await one(`SELECT count(*)::int AS n FROM ppp_users WHERE id = 'ppp-library' AND created_ip_tag IS NULL`))[0].n === 1);
    const P = () => srv.port;

    console.log('\n── signup limit, counted from the accounts ──');
    const first = [];
    for (let i = 0; i < 10; i++) first.push((await signup(P(), '203.0.113.7')).status);
    ok('10 accounts an hour from one address', first.every(s => s === 201), first.join());
    const eleventh = await signup(P(), '203.0.113.7');
    ok('the 11th is 429 with the code too-many', eleventh.status === 429 && eleventh.body.code === 'too-many', eleventh.status + '');
    ok('another address is not limited', (await signup(P(), '203.0.113.8')).status === 201);
    const rows = await one('SELECT created_ip_tag, created_at FROM ppp_users WHERE created_ip_tag = $1', [tagOf('203.0.113.7')]);
    ok('the tag is the keyed hash of the address (16 hex), and the address itself is nowhere', rows.length === 10 && /^[0-9a-f]{16}$/.test(rows[0].created_ip_tag)
      && (await one(`SELECT count(*)::int AS n FROM ppp_users WHERE display_name LIKE '%203.0.113%' OR email LIKE '%203.0.113%' OR created_ip_tag LIKE '%203.0.113%'`))[0].n === 0);
    ok('created_at is the time of the signup', rows.every(r => Math.abs(Date.now() - new Date(r.created_at).getTime()) < 120000));
    /* the keyed address hash of an account is forgotten after two days (at boot and every six hours), the account is not */
    await db.query(`INSERT INTO ppp_users (id, email, display_name, password_hash, created_ip_tag, created_at) VALUES ('tag-old', 'tagold@example.com', 'T', 'x', 'aaaaaaaaaaaaaaaa', now() - interval '3 days'), ('tag-47h', 'tag47@example.com', 'T', 'x', 'bbbbbbbbbbbbbbbb', now() - interval '47 hours')`);
    await srv.close();
    srv = await start();
    ok('the address hash of an account three days old is gone, the account stays; 47 hours old: kept',
      (await one(`SELECT id, created_ip_tag FROM ppp_users WHERE id IN ('tag-old', 'tag-47h') ORDER BY id`)).map(r => r.id + ':' + r.created_ip_tag).join() === 'tag-47h:bbbbbbbbbbbbbbbb,tag-old:null');
    ok('after a restart the 11th is still refused (nothing in memory)', (await signup(P(), '203.0.113.7')).status === 429);
    ok('an IPv6 address counts as its /48', (await (async () => { for (let i = 0; i < 10; i++) await signup(P(), '2001:db8:1:' + (i + 1) + '::1'); return signup(P(), '2001:db8:1:ffff::1'); })()).status === 429);
    const all = await Promise.all(Array.from({ length: 16 }, () => signup(P(), '198.51.100.200')));
    const made = all.filter(r => r.status === 201).length;
    ok('16 at once from one address make exactly 10 and refuse 6', made === 10 && all.filter(r => r.status === 429).length === 6, all.map(r => r.status).join());
    ok('and ten rows are in the table', (await one('SELECT count(*)::int AS n FROM ppp_users WHERE created_ip_tag = $1', [tagOf('198.51.100.200')]))[0].n === 10);
    await db.query(`DELETE FROM ppp_users WHERE created_ip_tag IS NOT NULL`);
    /* 9 in the last hour and 4 an hour and a half old: 13 in the day, 9 in the hour - the 10th of the hour is made, the 11th is not */
    const T = tagOf('203.0.113.55');
    await db.query(`INSERT INTO ppp_users (id, email, display_name, password_hash, created_ip_tag, created_at) SELECT 'hr' || g, 'hr' || g || '@example.com', 'H', 'x', $1, now() - interval '5 minutes' FROM generate_series(1, 9) g`, [T]);
    await db.query(`INSERT INTO ppp_users (id, email, display_name, password_hash, created_ip_tag, created_at) SELECT 'old' || g || 'h', 'old' || g || 'h@example.com', 'H', 'x', $1, now() - interval '90 minutes' FROM generate_series(1, 4) g`, [T]);
    ok('9 in the hour and 4 older: the 10th of the hour is made (the hour is counted apart from the day)', (await signup(P(), '203.0.113.55')).status === 201);
    ok('and the 11th is refused', (await signup(P(), '203.0.113.55')).status === 429);
    await db.query(`DELETE FROM ppp_users WHERE created_ip_tag IS NOT NULL`);
    await db.query(`INSERT INTO ppp_users (id, email, display_name, password_hash, created_ip_tag, created_at) SELECT 'bulk' || g, 'bulk' || g || '@example.com', 'B', 'x', md5(g::text), now() - interval '10 minutes' FROM generate_series(1, 99) g`);
    const five = await Promise.all(['192.0.2.77', '192.0.2.81', '192.0.2.82', '192.0.2.83', '192.0.2.84'].map(ip => signup(P(), ip)));
    ok('five at once at 99 for the site: exactly the 100th is made', five.filter(r => r.status === 201).length === 1 && five.filter(r => r.status === 429).length === 4, five.map(r => r.status).join());
    const site = await signup(P(), '192.0.2.78');
    ok('the 101st is 429 for everybody', site.status === 429 && /making a lot of accounts/.test(site.body.error), site.status + '');
    await db.query(`UPDATE ppp_users SET created_at = now() - interval '2 hours' WHERE created_ip_tag IS NOT NULL`);
    ok('an hour later the site is open again', (await signup(P(), '192.0.2.79')).status === 201);
    const login = await req(P(), 'POST', '/api/auth/login', { ip: '192.0.2.80', body: { email: 'old0@example.com', password: 'nope' } });
    ok('login still answers (401 for a wrong password)', login.status === 401, login.status + '');

    console.log('\n── GET /api/shares, a page at a time ──');
    await db.query('DELETE FROM ppp_shares');
    /* 130 listed rows in pairs that share a millisecond, one with microseconds, ids that mix case, 3 genres; plus an unlisted one */
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, composer, genre, kind, measures, listed, preview, score, created_at, updated_at)
      SELECT CASE WHEN g % 4 = 0 THEN 'Ab' || lpad(g::text, 4, '0') WHEN g % 4 = 1 THEN 'ab' || lpad(g::text, 4, '0') WHEN g % 4 = 2 THEN 'A_' || lpad(g::text, 4, '0') ELSE 'a-' || lpad(g::text, 4, '0') END,
             'old0', 'Seeder', 'k' || g, CASE WHEN g = 7 THEN 'Amazing Special' ELSE 'Song ' || g END, 'C', (ARRAY['Classical','Jazz','Hymn'])[g % 3 + 1], 'seed', 1, true,
             '{"measures":[{"number":1}],"notes":[]}'::jsonb, '{"measures":[{"number":1}],"notes":[]}'::jsonb,
             timestamptz '2026-01-01 00:00:00+00' + (g / 2) * interval '1 second' + (CASE WHEN g = 10 THEN interval '456 microseconds' ELSE interval '0' END),
             timestamptz '2026-01-01 00:00:00+00' + (g / 2) * interval '1 second' + (CASE WHEN g = 10 THEN interval '456 microseconds' ELSE interval '0' END)
      FROM generate_series(1, 130) g`);
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, composer, genre, kind, measures, listed, preview, score) VALUES ('unl', 'old0', 'S', 'ku', 'U', '', '', '', 1, false, NULL, '{"measures":[{}],"notes":[]}')`);
    const total = (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE listed'))[0].n; /* 130 + the seeds the server made at boot */
    const page1 = await req(P(), 'GET', '/api/shares');
    ok('24 a page, a cursor, the genres', page1.status === 200 && page1.body.shares.length === 24 && typeof page1.body.next === 'string' && Array.isArray(page1.body.genres) && page1.body.genres.length >= 3, page1.status + ' ' + (page1.body && page1.body.shares && page1.body.shares.length));
    const seen = []; let page = page1, pages = 1;
    for (;;) {
      seen.push.apply(seen, page.body.shares.map(s => s.id));
      if (!page.body.next) break;
      page = await req(P(), 'GET', '/api/shares?cursor=' + encodeURIComponent(page.body.next));
      pages++;
      if (page.status !== 200 || pages > 40) break;
    }
    ok('following the cursors lists every listed row exactly once (ties, mixed-case ids, a microsecond row)', seen.length === total && new Set(seen).size === total && !seen.includes('unl'), seen.length + ' of ' + total + ', ' + new Set(seen).size + ' distinct');
    ok('and in the order of the database (newest first, then the id)', (await one(`SELECT string_agg(id, ',' ORDER BY date_trunc('milliseconds', updated_at) DESC, id DESC) AS ids FROM ppp_shares WHERE listed`))[0].ids === seen.join(','));
    const big = await req(P(), 'GET', '/api/shares?limit=100000');
    ok('limit is clamped to 100', big.body.shares.length === 100 && typeof big.body.next === 'string', big.body.shares.length + '');
    const jazz = await req(P(), 'GET', '/api/shares?genre=Jazz&limit=10');
    ok('the genre is asked of the database', jazz.body.shares.length === 10 && jazz.body.shares.every(s => s.genre === 'Jazz'));
    const q = await req(P(), 'GET', '/api/shares?q=amazing');
    ok('the search is asked of the database', q.body.shares.length >= 1 && q.body.shares.every(s => /amazing/i.test(s.title + s.composer + s.owner)));
    ok('a cursor that is not ours is a 400', (await req(P(), 'GET', '/api/shares?cursor=garbage')).status === 400);
    /* a hostile genre or search is only a string, whatever Postgres would make of it */
    const hostile = [];
    for (const g of ["' OR 1=1 --", "Jazz' OR genre <> '", 'Jazz"; DROP TABLE ppp_shares; --', 'Jazz%', '%', '_azz', 'jazz', 'x'.repeat(5000), '\\']) {
      const r = await req(P(), 'GET', '/api/shares?limit=100&genre=' + encodeURIComponent(g));
      if (r.status !== 200 || r.body.shares.length !== 0) hostile.push(g.slice(0, 12) + ' -> ' + r.status + '/' + (r.body && r.body.shares && r.body.shares.length));
    }
    ok('a hostile genre is a 200 with no row', hostile.length === 0, hostile.join('; '));
    const nul = [];
    for (const g of ['Jazz%00', '%00Jazz', 'Ja%00zz']) {
      const r = await req(P(), 'GET', '/api/shares?limit=100&genre=' + g);
      if (r.status !== 200 || r.body.shares.length < 20 || !r.body.shares.every(s => s.genre === 'Jazz')) nul.push(g + ' -> ' + r.status);
    }
    ok('a NUL in the genre is dropped (Postgres cannot hold it): a 200, the Jazz rows', nul.length === 0, nul.join('; '));
    const qs = [];
    for (const q of ["' OR 1=1 --", '%', '_', '%00', 'Song%00%201', 'x'.repeat(5000), '\\']) {
      const r = await req(P(), 'GET', '/api/shares?limit=100&q=' + (q.indexOf('%') >= 0 && q.length > 1 ? q : encodeURIComponent(q)));
      if (r.status !== 200) qs.push(q.slice(0, 12) + ' -> ' + r.status);
    }
    ok('a hostile search is a 200', qs.length === 0, qs.join('; '));
    ok('% and _ in the search are letters, not wildcards', (await req(P(), 'GET', '/api/shares?q=' + encodeURIComponent('%'))).body.shares.length === 0
      && (await req(P(), 'GET', '/api/shares?q=' + encodeURIComponent('_'))).body.shares.length === 0);
    ok('the genres are those of listed rows only', JSON.stringify(page1.body.genres) === JSON.stringify((await one(`SELECT DISTINCT genre FROM ppp_shares WHERE listed AND genre <> '' ORDER BY genre`)).map(r => r.genre)));
  } catch (e) {
    errors.push('crashed: ' + (e && e.stack || e));
    console.log('  ✗ crashed: ' + (e && e.stack || e));
  } finally {
    if (srv) await srv.close();
    await db.end();
  }
  console.log('\n' + (errors.length ? 'FAILED: ' + errors.length : 'all passed'));
  process.exit(errors.length ? 1 : 0);
})();
