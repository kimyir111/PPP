/* G13 "no login anywhere" on a real Postgres: the migration (the address-tag column), a guest posting to the public list, the lists, the caps under concurrency, and an
   account that is as it was. The file-store half is tests/guest-post.test.js; the guest links this builds on are tests/guest-share-pg.test.js.

   Needs a THROWAWAY Postgres and the `pg` package (NODE_PATH may point at a tree that has it):

     docker run -d --name ppp-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 55432:5432 postgres:17-alpine
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/ppp NODE_PATH=D:/PPP/node_modules node tests/guest-post-pg.test.js
     docker rm -f ppp-pg-test

   It DROPS the ppp_* tables first, so it refuses any database that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0.
   (PPP_SRC_DIR=<dir with server.js and share-guest.js> runs it against a mutant: tests/guest-post.mutants.js P1-P3.) */
'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { freePort } = require('./serve-free');
const SRC = process.env.PPP_SRC_DIR ? path.resolve(process.env.PPP_SRC_DIR) : path.resolve(__dirname, '..');
const G = require(path.join(SRC, 'share-guest'));
const homeJobs = require(path.join(SRC, 'home-jobs'));

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  – PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Client } = require('pg');

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const DAY = 24 * 3600 * 1000;
const SECRET = 'guest-post-pg-secret';
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
const secretOf = () => crypto.randomBytes(32).toString('hex');
let ipN = 0;
const nextIp = () => '203.1.' + Math.floor(++ipN / 250) + '.' + (ipN % 250 + 1);
const postAs = (port, key, o, ip) => req(port, 'POST', '/api/shares', { guest: key, ip: ip || nextIp(), body: Object.assign({ songKey: 'sk-' + crypto.randomBytes(5).toString('hex'), title: 'A post', score: smallScore('A post') }, o) });

async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC, stdio: 'ignore',
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

(async () => {
  const db = new Client({ connectionString: URL_ });
  await db.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows;
  let srv = null;
  const fillers = (n, o) => db.query(`INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, listed, expires_at, bytes, addr_tag)
      SELECT $2::text || i, COALESCE($3, 'g_' || lpad(to_hex(i + $4::int), 24, '0')), 'Guest', 'f' || i, 'f', '{"measures":[{}],"notes":[]}', 1, true, now() + interval '40 days', $5::int,
        COALESCE($6, 'ffff' || lpad(to_hex(i + $4::int), 12, '0')) FROM generate_series(1, $1::int) i`,
    [n, (o && o.prefix) || 'pf', (o && o.owner) || null, (o && o.offset) || 0, (o && o.bytes) || 100, (o && o.tag) || null]);
  const count = async where => (await one('SELECT count(*)::int AS n FROM ppp_shares WHERE ' + (where || 'true')))[0].n;
  try {
    /* production today (before this change): the shares table with the guest columns and no addr_tag */
    await db.query('DROP TABLE IF EXISTS ppp_shares, ppp_progress, ppp_users CASCADE');
    await db.query(`
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, song_key TEXT NOT NULL, title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false, preview JSONB, score JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ, bytes INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX ppp_shares_owner_song ON ppp_shares (owner_id, song_key);
      INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score, measures, listed, expires_at, bytes) VALUES
        ('oldguestpost', 'g_00000000000000000000aaaa', 'Guest', 'k', 'An older guest link', '{"measures":[{}],"notes":[]}', 1, false, now() + interval '10 days', 40);`);
    console.log('\n── the migration is additive ──');
    srv = await start();
    const cols = async () => (await one(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ppp_shares' AND column_name = 'addr_tag'`)).length;
    ok('the addr_tag column is added to the table production has', (await cols()) === 1);
    ok('an older row keeps NULL there, and still opens', (await one(`SELECT addr_tag FROM ppp_shares WHERE id = 'oldguestpost'`))[0].addr_tag === null && (await req(srv.port, 'GET', '/api/shares/oldguestpost')).status === 200);
    await srv.close();
    srv = await start();
    ok('a second boot (the migration again) is harmless', (await cols()) === 1);
    const P = () => srv.port;

    console.log('\n── a guest posts to the public list ──');
    const K = secretOf(), ipK = nextIp();
    const c = await postAs(P(), K, { songKey: 'moon', title: 'Moonlight', listed: true, displayName: 'Pat Pianist' }, ipK);
    ok('201, listed, named, 90 days out, guest-marked', c.status === 201 && c.body.listed === true && c.body.owner === 'Pat Pianist' && c.body.guest === true
      && Math.abs(Date.parse(c.body.expiresAt) - (Date.now() + 90 * DAY)) < 120000 && c.text.indexOf(K) < 0, c.status + ' ' + JSON.stringify(c.body).slice(0, 120));
    const id = c.body.id;
    const row = (await one('SELECT owner_id, owner_name, listed, addr_tag, bytes, expires_at FROM ppp_shares WHERE id = $1', [id]))[0];
    const wantTag = crypto.createHmac('sha256', crypto.createHmac('sha256', SECRET).update('ppp-guest-post-address').digest()).update(homeJobs.addrKey(ipK)).digest('hex').slice(0, 16);
    ok('the row: owner g_<hash>, listed, the keyed address tag, the bytes', row.owner_id === G.guestOwnerId(K) && row.listed === true && row.addr_tag === wantTag && row.bytes === G.rowBytes(smallScore('A post'), null) && row.owner_name === 'Pat Pianist', JSON.stringify(row));
    ok('the address and the key are not in the row', JSON.stringify(row).indexOf(ipK) < 0 && JSON.stringify(row).indexOf(K) < 0);
    const pub = await req(P(), 'GET', '/api/shares?limit=100');
    ok('it is in the public list, as somebody else\'s', pub.body.shares.some(s => s.id === id && s.mine === false && s.guest === true));
    ok('a search finds it by title and by the name', (await req(P(), 'GET', '/api/shares?q=moonlight')).body.shares.some(s => s.id === id) && (await req(P(), 'GET', '/api/shares?q=pat%20pianist')).body.shares.some(s => s.id === id));
    const mine = await req(P(), 'GET', '/api/shares?mine=1', { guest: K });
    ok('"mine" with the key lists it (as theirs), and with another key does not', mine.body.shares.length === 1 && mine.body.shares[0].mine === true && (await req(P(), 'GET', '/api/shares?mine=1', { guest: secretOf() })).body.shares.length === 0);
    const f1 = await req(P(), 'PATCH', '/api/shares/' + id, { body: { listed: false } });
    const f2 = await req(P(), 'PATCH', '/api/shares/' + id, { guest: secretOf(), body: { listed: false } });
    ok('PATCH by no key or by another guest: 403, the same bytes', f1.status === 403 && f2.status === 403 && f1.text === f2.text);
    ok('DELETE by another guest: 403', (await req(P(), 'DELETE', '/api/shares/' + id, { guest: secretOf() })).status === 403 && (await count('id = $$' + id + '$$')) === 1);
    const down = await req(P(), 'PATCH', '/api/shares/' + id, { guest: K, body: { listed: false } });
    ok('the owner takes it down: unlisted, not in the list, the tag cleared in the row', down.status === 200 && down.body.listed === false
      && !(await req(P(), 'GET', '/api/shares?limit=100')).body.shares.some(s => s.id === id) && (await one('SELECT addr_tag FROM ppp_shares WHERE id = $1', [id]))[0].addr_tag === null);
    const back = await req(P(), 'PATCH', '/api/shares/' + id, { guest: K, body: { listed: true }, ip: ipK });
    ok('and puts it back: listed, tagged, in the list', back.status === 200 && back.body.listed === true && (await one('SELECT addr_tag FROM ppp_shares WHERE id = $1', [id]))[0].addr_tag === wantTag
      && (await req(P(), 'GET', '/api/shares?limit=100')).body.shares.some(s => s.id === id));
    const yt = await postAs(P(), K, { listed: true, youtubeDerived: true });
    ok('a YouTube-derived score is refused to the list for a guest: 403 youtube-not-public', yt.status === 403 && yt.body.code === 'youtube-not-public');

    console.log('\n── an ended post is in no list ──');
    const kE = secretOf();
    const e1 = await postAs(P(), kE, { listed: true });
    await db.query(`UPDATE ppp_shares SET expires_at = now() - interval '1 second', genre = 'Expired' WHERE id = $1`, [e1.body.id]);
    const afterE = await req(P(), 'GET', '/api/shares?limit=100');
    ok('not in the public list, nor the genres, nor "mine"; its link is 404', !afterE.body.shares.some(s => s.id === e1.body.id) && !(afterE.body.genres || []).includes('Expired')
      && (await req(P(), 'GET', '/api/shares?mine=1', { guest: kE })).body.shares.length === 0 && (await req(P(), 'GET', '/api/shares/' + e1.body.id)).status === 404);
    ok('and the row is still there until a guest writes (then swept)', (await count(`id = '${e1.body.id}'`)) === 1);

    console.log('\n── the caps, counted by the database ──');
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');
    const kM = secretOf(), gM = G.guestOwnerId(kM);
    await fillers(10, { owner: gM, prefix: 'own', addr: null, tag: 'eeeeeeeeeeeeeeee' });
    /* ten rows with ONE owner and the unique (owner, song_key) index: song keys are f1..f10 */
    const over = await postAs(P(), kM, { listed: true });
    ok('the 11th post of a browser is 429 too-many-posts, nothing evicted', over.status === 429 && over.body.code === 'too-many-posts' && (await count(`owner_id = '${gM}' AND listed`)) === 10, over.status + ' ' + JSON.stringify(over.body));
    const lnk = await postAs(P(), kM, { listed: false });
    ok('a link is still made, and putting it into the list is the same 429', lnk.status === 201
      && (await req(P(), 'PATCH', '/api/shares/' + lnk.body.id, { guest: kM, body: { listed: true }, ip: nextIp() })).status === 429);
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');

    const ipH = '192.0.2.77';
    const seed = await postAs(P(), secretOf(), { listed: true }, ipH);
    const hTag = (await one('SELECT addr_tag FROM ppp_shares WHERE id = $1', [seed.body.id]))[0].addr_tag;
    await fillers(19, { tag: hTag, offset: 5000 });
    const atCap = await postAs(P(), secretOf(), { listed: true }, ipH);
    ok('20 posts from one address held: the next is 429 too-many-posts', atCap.status === 429 && atCap.body.code === 'too-many-posts', atCap.status + '');
    ok('another address is not held', (await postAs(P(), secretOf(), { listed: true }, '192.0.2.78')).status === 201);
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');

    await fillers(G.GUEST.TOTAL_LISTED, { offset: 9000 });
    const full = await postAs(P(), secretOf(), { listed: true });
    ok('300 posts held: the 301st is 503 busy, and nobody was evicted', full.status === 503 && full.body.code === 'busy' && (await count('listed AND expires_at IS NOT NULL')) === 300, full.status + ' ' + JSON.stringify(full.body));
    const linkFull = await postAs(P(), secretOf(), { listed: false });
    ok('a link is still made', linkFull.status === 201);
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');

    await fillers(1, { offset: 20000, prefix: 'hv', bytes: G.GUEST.TOTAL_LISTED_BYTES - 5000 });
    const heavy = await postAs(P(), secretOf(), { listed: true, score: smallScore('Heavy', { pad: 'x'.repeat(8000) }) });
    ok('a post that would pass 24 MB in all is 503 busy', heavy.status === 503 && heavy.body.code === 'busy', heavy.status + '');
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');

    console.log('\n── posts at the same moment cannot race the caps ──');
    await fillers(G.GUEST.TOTAL_LISTED - 5, { offset: 30000 });
    const par = await Promise.all(Array.from({ length: 20 }, (_, i) => postAs(P(), secretOf(), { listed: true }, '100.64.' + (i + 1) + '.1')));
    ok('with 5 places left, 20 at once: exactly 5 are made, 15 are 503 busy, none an error',
      par.filter(r => r.status === 201).length === 5 && par.filter(r => r.status === 503).length === 15, par.map(r => r.status).join());
    ok('and the table holds exactly 300 posts', (await count('listed AND expires_at IS NOT NULL')) === 300);
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');

    await fillers(G.GUEST.TOTAL_LISTED - 3, { offset: 40000 });
    const keys = Array.from({ length: 10 }, () => secretOf());
    const links = [];
    for (let i = 0; i < keys.length; i++) links.push((await postAs(P(), keys[i], { listed: false }, '100.65.' + (i + 1) + '.1')).body.id);
    const puts = await Promise.all(keys.map((k, i) => req(P(), 'PATCH', '/api/shares/' + links[i], { guest: k, body: { listed: true }, ip: '100.66.' + (i + 1) + '.1' })));
    ok('with 3 places left, 10 links put into the list at once: exactly 3 are listed, 7 are 503 busy',
      puts.filter(r => r.status === 200).length === 3 && puts.filter(r => r.status === 503).length === 7, puts.map(r => r.status).join());
    ok('and the table holds exactly 300 posts', (await count('listed AND expires_at IS NOT NULL')) === 300);
    await db.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL');
    const same = secretOf();
    const racers = await Promise.all(Array.from({ length: 5 }, (_, i) => postAs(P(), same, { songKey: 'one', title: 'S' + i, listed: true }, '100.67.' + (i + 1) + '.1')));
    ok('5 at once for the same song: 200/201 only, one 201, one row', racers.every(r => r.status === 200 || r.status === 201) && racers.filter(r => r.status === 201).length === 1
      && (await count(`owner_id = '${G.guestOwnerId(same)}'`)) === 1, racers.map(r => r.status).join());

    console.log('\n── an account on Postgres is as it was ──');
    const su = await req(P(), 'POST', '/api/auth/signup', { body: { email: 'pgp-' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'PG User' }, ip: nextIp() });
    const cookie = (su.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ');
    const acc = await req(P(), 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'u1', title: 'U', genre: 'Classical', listed: true, score: smallScore('U') } });
    ok('listed as asked, genre kept, no end date, no address tag, not guest-marked', acc.status === 201 && acc.body.listed === true && acc.body.genre === 'Classical' && acc.body.guest === undefined
      && (await one(`SELECT expires_at IS NULL AS open, addr_tag FROM ppp_shares WHERE id = $1`, [acc.body.id]))[0].open === true);
    const accMine = await req(P(), 'GET', '/api/shares?mine=1', { cookie: cookie, guest: secretOf() });
    ok('"mine" of an account (with some guest key beside it) lists the account\'s', accMine.status === 200 && accMine.body.shares.some(s => s.id === acc.body.id));
    ok('an account PATCHes its own', (await req(P(), 'PATCH', '/api/shares/' + acc.body.id, { cookie: cookie, body: { listed: false } })).body.listed === false);

    console.log('\n── the read-only look, on this database ──');
    const kA = secretOf();
    await postAs(P(), kA, { listed: true, title: 'PG-ADMIN-SECRET-TITLE' }, '100.68.0.1');
    const out = execFileSync(process.execPath, [path.join(SRC, 'tools', 'shares-admin', 'list.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: URL_ }) });
    ok('it lists the tags and totals, and no content or key', out.indexOf(G.guestOwnerId(kA).replace(/^g_/, '').slice(0, 8)) > -1 && /read-only/.test(out) && !/PG-ADMIN-SECRET/.test(out) && out.indexOf(kA) < 0, out.split('\n').slice(1, 3).join(' | '));
    ok('and it changed nothing (a read only transaction)', (await count(`title = 'PG-ADMIN-SECRET-TITLE'`)) === 1);
  } finally {
    if (srv) await srv.close();
    await db.end();
  }
  console.log('\n────────────────────────────────────────');
  if (errors.length) { console.log(errors.length + ' PROBLEM(S):'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('Guest posts hold their caps on Postgres, under concurrency; the migration is additive and repeatable.');
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
