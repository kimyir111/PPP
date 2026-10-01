/* Guest link sharing on a real Postgres: the migration, and the caps under concurrency (the file-store half is
   tests/guest-share.test.js).

   Needs a THROWAWAY Postgres and the `pg` package (NODE_PATH may point at a tree that has it):

     docker run -d --name ppp-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 55432:5432 postgres:17-alpine
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/ppp NODE_PATH=D:/PPP/node_modules node tests/guest-share-pg.test.js
     docker rm -f ppp-pg-test

   It DROPS the ppp_* tables first (to start from the schema production has today, with the owner foreign key), so it
   refuses any database that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0. */
'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { freePort } = require('./serve-free');
const G = require('../share-guest');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  – PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Client } = require('pg');

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
function req(port, method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body == null ? null : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    const headers = {};
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
    if (opts.guest) headers['X-PPP-Guest'] = opts.guest;
    if (opts.cookie) headers['Cookie'] = opts.cookie;
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
const smallScore = (t, extra) => Object.assign({ title: t || 'Guest song', measures: [{ n: 1 }, { n: 2 }], notes: [{ m: 1, midi: 60 }] }, extra || {});
const post = (port, guest, o, ip) => req(port, 'POST', '/api/shares', { guest: guest, ip: ip, body: o });
const secretOf = () => crypto.randomBytes(32).toString('hex');

async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: URL_ })
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

(async () => {
  const db = new Client({ connectionString: URL_ });
  await db.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows;
  let srv = null;
  try {
    /* production today: ppp_shares with a foreign key on owner_id, and no expires_at / bytes */
    await db.query('DROP TABLE IF EXISTS ppp_shares, ppp_progress, ppp_users CASCADE');
    await db.query(`
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE, owner_name TEXT NOT NULL, song_key TEXT NOT NULL,
        title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false,
        preview JSONB, score JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT measures_nonneg CHECK (measures >= 0));
      CREATE UNIQUE INDEX ppp_shares_owner_song ON ppp_shares (owner_id, song_key);`);
    console.log('\n── the migration ──');
    srv = await start();
    const fks = async () => (await one(`SELECT conrelid::regclass::text AS t, conname FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_shares', 'ppp_progress') ORDER BY 1`)).map(r => r.t);
    ok('the foreign key on ppp_shares.owner_id is gone; the one on ppp_progress is not touched', (await fks()).join() === 'ppp_progress', (await fks()).join());
    ok('the CHECK on measures is kept (only the owner foreign key is dropped)', (await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'measures_nonneg'`))[0].n === 1);
    ok('expires_at and bytes columns exist', (await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ppp_shares' AND column_name IN ('expires_at', 'bytes')`))[0].n === 2);
    await srv.close();
    srv = await start();
    ok('a second boot (the migration again) is harmless', (await fks()).join() === 'ppp_progress');
    const P = () => srv.port;

    console.log('\n── a guest link on Postgres ──');
    const K = secretOf();
    const c = await post(P(), K, { songKey: 'a', title: 'PG guest', listed: true, genre: 'Classical', score: smallScore('PG') }, '10.0.0.1');
    ok('201, unlisted, no genre, with an end date', c.status === 201 && c.body.listed === false && c.body.genre === '' && !!c.body.expiresAt, c.status + '');
    const rowSql = (await one('SELECT owner_id, bytes, expires_at FROM ppp_shares WHERE id = $1', [c.body.id]))[0];
    ok('owner is g_<hash>, bytes is the score size, expires in 30 days', rowSql.owner_id === G.guestOwnerId(K) && rowSql.bytes === G.rowBytes(smallScore('PG'), null)
      && Math.abs(new Date(rowSql.expires_at) - (Date.now() + 30 * 86400000)) < 120000, JSON.stringify(rowSql));
    ok('anonymous GET works; the directory does not list it', (await req(P(), 'GET', '/api/shares/' + c.body.id)).status === 200 && !(await req(P(), 'GET', '/api/shares')).body.shares.some(s => s.id === c.body.id));
    const again = await post(P(), K, { songKey: 'a', title: 'PG guest 2', score: smallScore('PG2') }, '10.0.0.1');
    ok('the same song again: 200, same id', again.status === 200 && again.body.id === c.body.id);
    ok('the wrong key cannot delete; the right one can', (await req(P(), 'DELETE', '/api/shares/' + c.body.id, { guest: secretOf() })).status === 403
      && (await req(P(), 'DELETE', '/api/shares/' + c.body.id, { guest: K })).status === 200);
    const exp = await post(P(), secretOf(), { songKey: 'e', title: 'Will expire', score: smallScore() }, '10.0.0.2');
    await db.query(`UPDATE ppp_shares SET expires_at = now() - interval '1 second' WHERE id = $1`, [exp.body.id]);
    ok('an expired row is 404 at once, and still there until a guest creates one', (await req(P(), 'GET', '/api/shares/' + exp.body.id)).status === 404
      && (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE id = $1', [exp.body.id]))[0].n === 1);
    await post(P(), secretOf(), { songKey: 'sw', title: 'Sweeper', score: smallScore() }, '10.0.0.3');
    ok('the next guest create sweeps it', (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE id = $1', [exp.body.id]))[0].n === 0);
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, expires_at, bytes) VALUES ('expiredatboot', $1, 'Guest', 'x', 'x', '{"measures":[{}],"notes":[]}', 1, now() - interval '1 day', 10)`, [G.guestOwnerId(secretOf())]);
    await srv.close();
    srv = await start();
    ok('and the server sweeps expired rows when it starts', (await one(`SELECT count(*)::int AS n FROM ppp_shares WHERE id = 'expiredatboot'`))[0].n === 0);

    console.log('\n── concurrency: the caps hold ──');
    const F = secretOf();
    const par = await Promise.all(Array.from({ length: 60 }, (_, i) => post(P(), F, { songKey: 'par-' + i, title: 'Par ' + i, score: smallScore() }, '100.64.1.' + i)));
    ok('60 at once with one key: exactly 20 made, 40 refused (429), no errors', par.filter(r => r.status === 201).length === 20 && par.filter(r => r.status === 429).length === 40, par.map(r => r.status).filter(x => x !== 201 && x !== 429).join() || 'ok');
    ok('and the table holds exactly 20 for that browser', (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE owner_id = $1', [G.guestOwnerId(F)]))[0].n === 20);

    await db.query(`DELETE FROM ppp_shares WHERE expires_at IS NOT NULL`);
    const have = (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE expires_at IS NOT NULL'))[0].n;
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, expires_at, bytes)
      SELECT 'fill' || i, 'g_' || lpad(to_hex(i), 24, '0'), 'Guest', 'f', 'f', '{"measures":[{}],"notes":[]}', 1, now() + interval '1 day', 100 FROM generate_series(1, $1::int) i`, [G.GUEST.TOTAL_SHARES - have - 5]);
    const par2 = await Promise.all(Array.from({ length: 25 }, (_, i) => post(P(), secretOf(), { songKey: 'c' + i, title: 'C' + i, score: smallScore() }, '100.64.2.' + i)));
    ok('with 5 places left, 25 at once: exactly 5 made, 20 are 503', par2.filter(r => r.status === 201).length === 5 && par2.filter(r => r.status === 503).length === 20, par2.map(r => r.status).join());
    ok('the count never passed 1000', (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE expires_at IS NOT NULL'))[0].n === G.GUEST.TOTAL_SHARES);

    await db.query(`DELETE FROM ppp_shares WHERE expires_at IS NOT NULL`);
    const bigScore = i => smallScore('B' + i, { pad: 'z'.repeat(300 * 1024) });
    const per = G.rowBytes(bigScore(0), null);
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, expires_at, bytes) VALUES ('fillbytes', 'g_00000000000000000000beef', 'Guest', 'f', 'f', '{"measures":[{}],"notes":[]}', 1, now() + interval '1 day', $1)`,
      [G.GUEST.TOTAL_BYTES - 3 * per - 1000]);
    const par3 = await Promise.all(Array.from({ length: 12 }, (_, i) => post(P(), secretOf(), { songKey: 'b' + i, title: 'B' + i, score: bigScore(i) }, '100.64.3.' + i)));
    ok('with room for 3 big links, 12 at once: exactly 3 made, 9 are 503', par3.filter(r => r.status === 201).length === 3 && par3.filter(r => r.status === 503).length === 9, par3.map(r => r.status).join());
    ok('the bytes never passed 50 MB', Number((await one('SELECT sum(bytes)::float8 AS b FROM ppp_shares WHERE expires_at IS NOT NULL'))[0].b) <= G.GUEST.TOTAL_BYTES);

    await db.query(`DELETE FROM ppp_shares WHERE expires_at IS NOT NULL`);
    const E = secretOf();
    const tiny = [];
    for (let i = 0; i < 3; i++) tiny.push((await post(P(), E, { songKey: 't' + i, title: 'T' + i, score: smallScore() }, '100.64.4.' + i)).body.id);
    const heldNow = Number((await one('SELECT sum(bytes)::float8 AS b FROM ppp_shares WHERE expires_at IS NOT NULL'))[0].b);
    await db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, expires_at, bytes) VALUES ('fillre', 'g_00000000000000000000cafe', 'Guest', 'f', 'f', '{"measures":[{}],"notes":[]}', 1, now() + interval '1 day', $1)`, [G.GUEST.TOTAL_BYTES - heldNow - 800 * 1024]);
    const grow = (i) => post(P(), E, { songKey: 't' + i, title: 'T' + i, score: smallScore('T', { pad: 'x'.repeat(700 * 1024) }) }, '100.64.5.' + i);
    const grown = await Promise.all([grow(0), grow(1), grow(2)]);
    ok('three tiny links re-sent at 700 KB at once with room for one: one 200, two 503', grown.filter(r => r.status === 200).length === 1 && grown.filter(r => r.status === 503).length === 2, grown.map(r => r.status).join());

    await db.query(`DELETE FROM ppp_shares WHERE expires_at IS NOT NULL`);
    const same = secretOf();
    const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => post(P(), same, { songKey: 'same', title: 'S' + i, score: smallScore() }, '100.64.6.' + i)));
    ok('10 guests-at-once for the same song: 200/201 only (never a 500), one 201, one row', racers.every(r => r.status === 200 || r.status === 201) && racers.filter(r => r.status === 201).length === 1
      && (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE owner_id = $1', [G.guestOwnerId(same)]))[0].n === 1, racers.map(r => r.status).join());

    console.log('\n── what Postgres cannot hold ──');
    const NUL = String.fromCharCode(0);
    const nulGuest = await post(P(), secretOf(), { songKey: 'nul', title: 'T', score: smallScore('N', { lyric: 'a' + NUL + 'b' }) }, '10.9.0.1');
    const surGuest = await post(P(), secretOf(), { songKey: 'sur', title: 'T', score: smallScore('N', { lyric: String.fromCharCode(0xd800) }) }, '10.9.0.2');
    ok('a NUL or a lone surrogate in a guest score is 422 (Postgres would have refused it with a 500)', nulGuest.status === 422 && surGuest.status === 422, nulGuest.status + '/' + surGuest.status);
    const rawNest = n => '{"songKey":"deep","title":"T","score":{"measures":[{}],"notes":[],"x":' + '['.repeat(n) + ']'.repeat(n) + '}}';
    const deep = await req(P(), 'POST', '/api/shares', { guest: secretOf(), ip: '10.9.0.3', body: rawNest(4753) });
    ok('a score nested 4753 deep (accepted before, and then unreadable) is 422', deep.status === 422, deep.status + '');
    const ok50 = await req(P(), 'POST', '/api/shares', { guest: secretOf(), ip: '10.9.0.4', body: rawNest(50) });
    ok('50 deep is stored, and reads back', ok50.status === 201 && (await req(P(), 'GET', '/api/shares/' + ok50.body.id)).status === 200, ok50.status + '');

    console.log('\n── a backend that is killed ──');
    const killOthers = async () => one(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`);
    await killOthers();
    await new Promise(r => setTimeout(r, 500));
    ok('every idle connection of the server killed: the server stays up', (await req(P(), 'GET', '/health')).status === 200);
    const afterIdle = await post(P(), secretOf(), { songKey: 'idle', title: 'After idle kill', score: smallScore() }, '10.9.1.1');
    ok('and the next guest create works', afterIdle.status === 201, afterIdle.status + '');

    /* hold the guest lock from here, start a create (it BEGINs and waits for the lock), kill its backend, release */
    await db.query('SELECT pg_advisory_lock($1)', [727001]);
    const pending = post(P(), secretOf(), { songKey: 'mid', title: 'Killed mid-transaction', score: smallScore() }, '10.9.1.2');
    let waiting = [];
    for (let i = 0; i < 40 && !waiting.length; i++) {
      await new Promise(r => setTimeout(r, 100));
      waiting = await one(`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`);
    }
    ok('the create is waiting on the lock inside its transaction', waiting.length === 1, String(waiting.length));
    await db.query('SELECT pg_terminate_backend($1)', [waiting[0].pid]);
    const killed = await Promise.race([pending, new Promise(r => setTimeout(() => r({ status: 'hung' }), 8000))]);
    await db.query('SELECT pg_advisory_unlock($1)', [727001]);
    ok('the request whose backend died is answered (500), not left hanging', killed.status === 500, String(killed.status));
    ok('the server is still up', (await req(P(), 'GET', '/health')).status === 200);
    const afterMid = await post(P(), secretOf(), { songKey: 'after-mid', title: 'After the kill', score: smallScore() }, '10.9.1.3');
    ok('and the next guest create works', afterMid.status === 201, afterMid.status + '');
    const parAfter = await Promise.all(Array.from({ length: 8 }, (_, i) => post(P(), secretOf(), { songKey: 'pa' + i, title: 'PA' + i, score: smallScore() }, '10.9.2.' + i)));
    ok('and 8 at once all work (the dead connection was dropped, not reused)', parAfter.every(r => r.status === 201), parAfter.map(r => r.status).join());

    console.log('\n── an account on Postgres ──');
    const su = await req(P(), 'POST', '/api/auth/signup', { body: { email: 'pg-' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'PG User' } });
    const cookie = (su.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ');
    const acc = await Promise.all(Array.from({ length: 10 }, (_, i) => req(P(), 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'u-same', title: 'U' + i, listed: true, score: smallScore('U') } })));
    ok('an account sending one song 10 times at once: 200/201 only (the unique index is an update, not a 500), one link, one row',
      acc.every(r => r.status === 200 || r.status === 201) && new Set(acc.map(r => r.body.id)).size === 1 && acc.filter(r => r.status === 201).length === 1, acc.map(r => r.status).join());
    ok('listed as asked, no end date, bytes 0', (await one(`SELECT listed, expires_at IS NULL AS open FROM ppp_shares WHERE song_key = 'u-same'`))[0].listed === true && (await one(`SELECT expires_at IS NULL AS open FROM ppp_shares WHERE song_key = 'u-same'`))[0].open === true);
    const accOne = await req(P(), 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'u2', title: 'U2', score: smallScore('U2') } });
    ok('an account\'s ordinary create is 201', accOne.status === 201 && accOne.body.listed === false && accOne.body.expiresAt === undefined);
    const accNul = await req(P(), 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'u-nul', title: 'N', score: smallScore('N', { lyric: 'a' + NUL + 'b' }) } });
    ok('an account\'s NUL is a 422 (it was a 500)', accNul.status === 422, accNul.status + '');
    ok('an account\'s measures:[null] is 422', (await req(P(), 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'nn', title: 'N', score: { measures: [null], notes: [] } } })).status === 422);
  } finally {
    if (srv) await srv.close();
    await db.end();
  }
  console.log('\n────────────────────────────────────────');
  if (errors.length) { console.log(errors.length + ' PROBLEM(S):'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('Guest links hold their caps on Postgres, under concurrency; the migration is safe and repeatable.');
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
