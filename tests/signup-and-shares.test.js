'use strict';
/* G13-5: the signup limiter (TD26) and the paged list of Shared Scores, on this tree's server.js with the file store (the Postgres half is
   tests/signup-and-shares-pg.test.js). Node only.

   Addresses are named with X-Forwarded-For (the entry one place from the right, as behind Render's one proxy): a request that names no address is the
   developer's own machine (the socket, loopback) and is not limited per address - the browser suites sign up many accounts from it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SECRET = 'signup-test-secret';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
async function boot(dir, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '', PPP_DATA_DIR: dir, SESSION_SECRET: SECRET }, env || {})
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 30000);
    const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
  });
  return { port, log: () => out, close: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-signup-'));
const rm = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* stays */ } };
function req(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
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
let seq = 0;
const signup = (port, ip, o) => req(port, 'POST', '/api/auth/signup', { ip: ip, body: Object.assign({ email: 'u' + Date.now() + '-' + (++seq) + '@example.com', password: 'practice-ok', displayName: 'T' }, o || {}) });

/* the tag the server keeps of an address (home-jobs addrKey, keyed with the session secret) - the same as server.js, so a test can write the store a restart would find */
const { addrKey } = require(path.join(REPO, 'home-jobs.js'));
const tagOf = ip => {
  const key = crypto.createHmac('sha256', SECRET).update('ppp-signup-address').digest();
  return crypto.createHmac('sha256', key).update(addrKey(ip)).digest('hex').slice(0, 16);
};
const user = (i, ip, ageMs) => ({ id: 'seed-' + i, email: 'seed' + i + '@example.com', displayName: 'S', passwordHash: 'x', ipTag: ip ? tagOf(ip) : undefined, createdAt: new Date(Date.now() - ageMs).toISOString() });

/* ---- the rules themselves (signup-limit.js), with no server ---- */
const SL = require(path.join(REPO, 'signup-limit.js'));

test('signup-limit: the numbers, what a count of recent accounts allows, and how long a refused person is told to wait', () => {
  assert.deepEqual(SL.SIGNUP, { ATTEMPTS: 20, ATTEMPT_MS: 900000, PER_ADDRESS_HOUR: 10, PER_ADDRESS_DAY: 30, SITE_HOUR: 100, HOUR_MS: 3600000, DAY_MS: 86400000 });
  assert.equal(SL.refusal({ siteHour: 0, addrHour: 9, addrDay: 29 }, false), null);
  assert.equal(SL.refusal({ siteHour: 0, addrHour: 10, addrDay: 10 }, false), 'hour');
  assert.equal(SL.refusal({ siteHour: 0, addrHour: 3, addrDay: 30 }, false), 'day');
  assert.equal(SL.refusal({ siteHour: 0, addrHour: 10, addrDay: 30 }, false), 'day', 'the day is the longer wait: it is named first');
  assert.equal(SL.refusal({ siteHour: 99, addrHour: 0, addrDay: 0 }, false), null);
  assert.equal(SL.refusal({ siteHour: 100, addrHour: 0, addrDay: 0 }, false), 'site');
  assert.equal(SL.refusal({ siteHour: 100, addrHour: 10, addrDay: 30 }, false), 'site', 'the site first');
  /* the machine itself is not limited per address, the site's cap is the site's */
  assert.equal(SL.refusal({ siteHour: 0, addrHour: 500, addrDay: 500 }, true), null);
  assert.equal(SL.refusal({ siteHour: 100, addrHour: 0, addrDay: 0 }, true), 'site');
  assert.equal(SL.retryAfter('hour'), 3600);
  assert.equal(SL.retryAfter('site'), 3600);
  assert.equal(SL.retryAfter('day'), 86400);
  assert.equal(SL.retryAfter('attempts'), 900);
  ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'].forEach(ip => assert.ok(SL.LOOPBACK.test(ip), ip));
  ['128.0.0.1', '10.0.0.1', '1127.0.0.1', '::2', '::ffff:10.0.0.1', '', '127.0.0.1.evil', 'x127.0.0.1'].forEach(ip => assert.ok(!SL.LOOPBACK.test(ip), ip));
});

test('signup-limit: serial() runs one at a time, in order, and a failure does not stop the next', async () => {
  const run = SL.serial();
  const log = [];
  const task = (name, ms, fail) => () => new Promise((resolve, reject) => {
    log.push('start ' + name);
    setTimeout(() => { log.push('end ' + name); if (fail) reject(new Error(name)); else resolve(name); }, ms);
  });
  const results = await Promise.allSettled([run(task('a', 30)), run(task('b', 1, true)), run(task('c', 5)), run(() => 'sync')]);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  assert.equal(results[0].value, 'a');
  assert.equal(results[1].reason.message, 'b');
  assert.equal(results[3].value, 'sync');
  assert.equal(await run(() => 42), 42, 'and it is free again afterwards');
});

test('signup: 10 accounts an hour from one address, then 429; another address is unaffected', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    const a = [];
    for (let i = 0; i < 10; i++) a.push((await signup(srv.port, '203.0.113.7')).status);
    assert.deepEqual(a, new Array(10).fill(201));
    const eleventh = await signup(srv.port, '203.0.113.7');
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.code, 'too-many');
    assert.match(eleventh.body.error, /Too many accounts were made from here/);
    assert.equal(eleventh.headers['retry-after'], '3600', 'the hour cap: wait an hour at most');
    assert.equal((await signup(srv.port, '203.0.113.8')).status, 201, 'a neighbour address is another address');
    /* an IPv6 address counts as its /48: other /64s of the same /48 are the same address, another /48 is not */
    for (let i = 0; i < 10; i++) assert.equal((await signup(srv.port, '2001:db8:aaaa:' + (i + 1) + '::1')).status, 201, 'v6 #' + i);
    assert.equal((await signup(srv.port, '2001:db8:aaaa:ffff::9')).status, 429, 'the same /48');
    assert.equal((await signup(srv.port, '2001:db8:bbbb:1::1')).status, 201, 'another /48');
    /* the answer carries no secrets and the stored row no address */
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
    assert.ok(store.users.every(u => !u.ipTag || /^[0-9a-f]{16}$/.test(u.ipTag)));
    assert.ok(!JSON.stringify(store).includes('203.0.113'), 'the address itself is never kept');
  } finally { await srv.close(); rm(dir); }
});

test('signup: the count is in the accounts, so a restart does not forget it; older accounts and other hours do not count', async () => {
  const dir = tmp();
  const H = 3600e3;
  /* 9 accounts from the address in the last hour, 4 an hour and a half old (within the day: 13 a day), 30 from another address */
  const users = [];
  for (let i = 0; i < 9; i++) users.push(user(i, '198.51.100.9', 5 * 60e3 + i * 1000));
  for (let i = 0; i < 4; i++) users.push(user(100 + i, '198.51.100.9', 1.5 * H + i * 1000));
  for (let i = 0; i < 30; i++) users.push(user(200 + i, '198.51.100.10', 30 * 60e3));
  for (let i = 0; i < 3; i++) users.push(user(300 + i, null, 1000)); /* the library's own, made by hand: no tag, not counted */
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  let srv = await boot(dir);
  try {
    assert.equal((await signup(srv.port, '198.51.100.9')).status, 201, 'the 10th of the hour');
    assert.equal((await signup(srv.port, '198.51.100.9')).status, 429, 'the 11th, seen by a fresh process');
    await srv.close();
    srv = await boot(dir); /* and again after a restart: nothing in memory */
    assert.equal((await signup(srv.port, '198.51.100.9')).status, 429, 'still the 11th after a restart');
    assert.equal((await signup(srv.port, '198.51.100.10')).status, 429, '30 from another address in the last hour');
    assert.equal((await signup(srv.port, '198.51.100.11')).status, 201);
  } finally { await srv.close(); rm(dir); }
});

test('signup: 30 a day from one address, and an account older than a day is forgotten', async () => {
  const dir = tmp();
  const H = 3600e3;
  const users = [];
  for (let i = 0; i < 30; i++) users.push(user(i, '192.0.2.50', (2 + i * 0.5) * H)); /* none in the last hour, 30 in the last day */
  for (let i = 0; i < 40; i++) users.push(user(100 + i, '192.0.2.51', 25 * H)); /* a day and an hour ago: gone */
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv = await boot(dir);
  try {
    const day = await signup(srv.port, '192.0.2.50');
    assert.equal(day.status, 429, 'the 31st of the day');
    assert.equal(day.headers['retry-after'], '86400', 'the day cap: up to a day');
    assert.equal((await signup(srv.port, '192.0.2.51')).status, 201, 'a day-old crowd is not counted');
  } finally { await srv.close(); rm(dir); }
});

test('signup: 100 accounts an hour for the whole site, then 429 for everybody', async () => {
  const dir = tmp();
  const users = [];
  for (let i = 0; i < 99; i++) users.push(user(i, '10.' + (i % 250) + '.0.1', 10 * 60e3)); /* 99 different addresses, 99 accounts in the last hour */
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv = await boot(dir);
  try {
    assert.equal((await signup(srv.port, '192.0.2.77')).status, 201, 'the 100th');
    const no = await signup(srv.port, '192.0.2.78');
    assert.equal(no.status, 429);
    assert.match(no.body.error, /making a lot of accounts/);
    assert.equal(no.headers['retry-after'], '3600');
    /* a developer's own machine is not limited per address, but the site's cap is the site's */
    assert.equal((await signup(srv.port, null)).status, 429);
  } finally { await srv.close(); rm(dir); }
});

test('signup: every request is counted - 20 in 15 minutes from one address, valid or not - and the limit is not the login\'s', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    const seen = [];
    for (let i = 0; i < 20; i++) seen.push((await signup(srv.port, '203.0.113.99', { email: 'not-an-email' })).status);
    assert.deepEqual(seen, new Array(20).fill(422));
    const next = await signup(srv.port, '203.0.113.99', { email: 'ok@example.com' });
    assert.equal(next.status, 429, 'the 21st request, though it is a good one');
    assert.equal(next.body.code, 'too-many');
    assert.equal(next.body.error, 'Too many attempts. Try again later.');
    assert.equal(next.headers['retry-after'], '900', 'the request limit: 15 minutes at most');
    /* the same address cannot get round it by changing its X-Forwarded-For text: only the entry from the right counts, and 1 proxy is the default */
    assert.equal((await req(srv.port, 'POST', '/api/auth/signup', { ip: '1.2.3.4, 203.0.113.99', body: { email: 'z@example.com', password: 'practice-ok' } })).status, 429);
    /* the existing errors are what they were */
    assert.equal((await signup(srv.port, '203.0.113.100', { password: 'short' })).status, 422);
    const ok = await signup(srv.port, '203.0.113.100', { email: 'dup@example.com' });
    assert.equal(ok.status, 201);
    assert.equal((await signup(srv.port, '203.0.113.100', { email: 'dup@example.com' })).status, 409);
    assert.equal((await req(srv.port, 'POST', '/api/auth/signup', { ip: '203.0.113.100', body: '{nope' })).status, 400);
    /* the new account signs in (the limiter did not change what is stored) */
    const login = await req(srv.port, 'POST', '/api/auth/login', { ip: '203.0.113.100', body: { email: 'dup@example.com', password: 'practice-ok' } });
    assert.equal(login.status, 200);
  } finally { await srv.close(); rm(dir); }
});

test('login: 40 attempts in 15 minutes from one address, then the same kind of 429 as the signup limiter\'s (code, Retry-After), and nothing else changes', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    const ok1 = await signup(srv.port, '203.0.113.150', { email: 'who@example.com' });
    assert.equal(ok1.status, 201);
    const login = (ip, o) => req(srv.port, 'POST', '/api/auth/login', { ip: ip, body: Object.assign({ email: 'who@example.com', password: 'practice-ok' }, o || {}) });
    const seen = [];
    for (let i = 0; i < 40; i++) seen.push((await login('203.0.113.151', { password: 'wrong-password' })).status);
    assert.deepEqual(seen, new Array(40).fill(401), 'a wrong password is a 401 until the limit');
    const limited = await login('203.0.113.151', { password: 'wrong-password' });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: 'Too many attempts. Try again later.', code: 'too-many' });
    assert.equal(limited.headers['retry-after'], '900', 'the window is 15 minutes: wait that long at most');
    assert.equal((await login('203.0.113.151')).status, 429, 'the right password is limited as well, from that address');
    assert.equal((await login('203.0.113.152')).status, 200, 'another address signs in');
    assert.equal((await login('203.0.113.152', { password: 'nope-nope' })).status, 401);
  } finally { await srv.close(); rm(dir); }
});

test('signup: a request from this machine itself (no proxy header) is not limited per address', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    for (let i = 0; i < 25; i++) assert.equal((await signup(srv.port, null)).status, 201, 'local #' + i);
  } finally { await srv.close(); rm(dir); }
});

test('signup: 16 requests at once from one address make exactly 10 accounts, and 5 at once at 99 for the site make exactly 1', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    const all = await Promise.all(Array.from({ length: 16 }, () => signup(srv.port, '198.51.100.200')));
    assert.equal(all.filter(r => r.status === 201).length, 10, all.map(r => r.status).join());
    assert.equal(all.filter(r => r.status === 429).length, 6);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')).users.filter(u => u.ipTag === tagOf('198.51.100.200')).length, 10, 'and ten rows');
  } finally { await srv.close(); rm(dir); }
  const dir2 = tmp();
  const users = [];
  for (let i = 0; i < 99; i++) users.push(user(i, '10.' + (i % 250) + '.0.1', 10 * 60e3));
  fs.writeFileSync(path.join(dir2, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv2 = await boot(dir2);
  try {
    const five = await Promise.all(['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4', '192.0.2.5'].map(ip => signup(srv2.port, ip)));
    assert.equal(five.filter(r => r.status === 201).length, 1, five.map(r => r.status).join());
    assert.equal(five.filter(r => r.status === 429).length, 4);
  } finally { await srv2.close(); rm(dir2); }
});

test('signup: the limit is checked BEFORE the password is hashed (scrypt is never run for a refused or an invalid request)', async () => {
  const dir = tmp();
  const preload = path.join(dir, 'count-scrypt.js');
  fs.writeFileSync(preload, "const c = require('crypto'); const o = c.scryptSync; c.scryptSync = function () { process.stderr.write('SCRYPT-CALL\\n'); return o.apply(this, arguments); };\n");
  const users = [];
  for (let i = 0; i < 10; i++) users.push(user(i, '198.51.100.30', 5 * 60e3));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv = await boot(dir, { NODE_OPTIONS: '--require ' + JSON.stringify(preload.replace(/\\/g, '/')) });
  const scrypts = () => (srv.log().match(/SCRYPT-CALL/g) || []).length;
  try {
    assert.equal(scrypts(), 0, 'the server itself runs none at boot');
    assert.equal((await signup(srv.port, '198.51.100.30')).status, 429, 'the address cap');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(scrypts(), 0, 'a refused signup is not hashed');
    assert.equal((await signup(srv.port, '198.51.100.31', { email: 'nope' })).status, 422);
    assert.equal((await signup(srv.port, '198.51.100.31', { password: 'short' })).status, 422);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(scrypts(), 0, 'an invalid one is not hashed');
    for (let i = 0; i < 20; i++) await signup(srv.port, '198.51.100.32', { email: 'x' });
    assert.equal((await signup(srv.port, '198.51.100.32')).status, 429, 'the request limit (20 counted)');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(scrypts(), 0, 'a request over the request limit is not hashed');
    assert.equal((await signup(srv.port, '198.51.100.33')).status, 201);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(scrypts(), 1, 'one account, one hash');
  } finally { await srv.close(); rm(dir); }
});

test('signup: the keyed address hash of an account is forgotten after two days, the account is not', async () => {
  const dir = tmp();
  const H = 3600e3;
  const users = [user(1, '198.51.100.40', 3 * 24 * H), user(2, '198.51.100.40', 47 * H), user(3, '198.51.100.40', 5 * 60e3), user(4, null, 9 * 24 * H)];
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv = await boot(dir); /* the sweep runs before it listens */
  try {
    const now = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')).users;
    assert.ok(['seed-1', 'seed-2', 'seed-3', 'seed-4'].every(id => now.some(u => u.id === id)), 'every account is still there');
    assert.equal(now.find(u => u.id === 'seed-1').ipTag, undefined, 'three days old: forgotten');
    assert.equal(now.find(u => u.id === 'seed-2').ipTag, tagOf('198.51.100.40'), '47 hours old: kept (the limit looks back a day)');
    assert.equal(now.find(u => u.id === 'seed-3').ipTag, tagOf('198.51.100.40'));
    assert.equal(now.find(u => u.id === 'seed-1').email, 'seed1@example.com');
  } finally { await srv.close(); rm(dir); }
});

/* ---- GET /api/shares, a page at a time ---- */
function bar(n) { return { number: n, num: n }; }
function row(id, updatedAt, o) {
  return Object.assign({
    id: id, ownerId: 'u-seed', ownerName: 'Seeder', songKey: 'k-' + id, title: 'Song ' + id, composer: 'C ' + id, genre: 'Classical', kind: 'seed', measures: 1, listed: true,
    preview: { measures: [bar(1)], notes: [] }, score: { measures: [bar(1)], notes: [] }, createdAt: updatedAt, updatedAt: updatedAt
  }, o || {});
}
const ids = r => r.body.shares.map(s => s.id);

test('shares: 24 a page, a cursor for the next, genres on the first page, the old shape kept', async () => {
  const dir = tmp();
  const rows = [];
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  /* 130 listed rows (more than the 100 a page may be), in pairs that share a millisecond (the id breaks the tie), 3 genres, one unlisted */
  for (let i = 0; i < 130; i++) rows.push(row('r' + String(i).padStart(3, '0'), new Date(base + Math.floor(i / 2) * 1000).toISOString(), { genre: ['Classical', 'Jazz', 'Hymn'][i % 3], title: i === 7 ? 'Amazing Special' : 'Song ' + i }));
  rows.push(row('unlisted1', new Date(base + 99e3).toISOString(), { listed: false }));
  fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: rows }));
  const srv = await boot(dir);
  try {
    const first = await req(srv.port, 'GET', '/api/shares');
    assert.equal(first.status, 200);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.body.shares.length, 24, 'a page is 24 without ?limit');
    assert.equal(typeof first.body.next, 'string');
    assert.ok(Array.isArray(first.body.genres) && first.body.genres.indexOf('Jazz') > -1 && first.body.genres.indexOf('Hymn') > -1, JSON.stringify(first.body.genres));
    const card = first.body.shares[0];
    ['id', 'title', 'composer', 'kind', 'genre', 'measures', 'owner', 'mine', 'listed', 'preview', 'createdAt', 'updatedAt'].forEach(k => assert.ok(k in card, 'the card keeps ' + k));
    assert.ok(!('score' in card), 'no score in the list');
    /* follow the cursors: every listed row once, newest first, ties by id */
    const seen = []; let page = first, pages = 1;
    for (;;) {
      seen.push.apply(seen, ids(page));
      if (!page.body.next) break;
      page = await req(srv.port, 'GET', '/api/shares?cursor=' + encodeURIComponent(page.body.next));
      assert.equal(page.status, 200);
      assert.ok(!('genres' in page.body), 'genres only on the first page');
      pages++;
      assert.ok(pages < 20);
    }
    const listedIds = new Set(seen);
    assert.equal(seen.length, listedIds.size, 'no row twice');
    assert.equal(seen.length, 130 + 7, '130 here and the 7 the server seeds');
    assert.ok(!listedIds.has('unlisted1'));
    assert.equal(pages, Math.ceil(137 / 24));
    const mine60 = seen.filter(id => /^r\d+$/.test(id));
    assert.deepEqual(mine60, mine60.slice().sort((a, b) => {
      const ra = rows.find(r => r.id === a), rb = rows.find(r => r.id === b);
      return rb.updatedAt.localeCompare(ra.updatedAt) || b.localeCompare(a);
    }), 'newest first, the id breaks a tie');
    /* limit: asked, clamped, and nonsense */
    assert.equal((await req(srv.port, 'GET', '/api/shares?limit=5')).body.shares.length, 5);
    const clamped = await req(srv.port, 'GET', '/api/shares?limit=100000');
    assert.equal(clamped.body.shares.length, 100, 'clamped to 100');
    assert.equal(typeof clamped.body.next, 'string');
    assert.equal((await req(srv.port, 'GET', '/api/shares?limit=0')).body.shares.length, 24);
    assert.equal((await req(srv.port, 'GET', '/api/shares?limit=-4')).body.shares.length, 24);
    assert.equal((await req(srv.port, 'GET', '/api/shares?limit=abc')).body.shares.length, 24);
    const hundred = await req(srv.port, 'GET', '/api/shares?limit=100');
    assert.equal(hundred.body.shares.length, 100);
    const tail = await req(srv.port, 'GET', '/api/shares?limit=100&cursor=' + encodeURIComponent(hundred.body.next));
    assert.equal(tail.body.shares.length, 37);
    assert.equal(tail.body.next, null, 'the end of the list has no cursor');
    /* a page of exactly the rest has no cursor either */
    const rest = await req(srv.port, 'GET', '/api/shares?limit=37&cursor=' + encodeURIComponent(hundred.body.next));
    assert.equal(rest.body.next, null);
    assert.deepEqual(ids(rest), ids(tail));
    assert.deepEqual(ids(hundred).concat(ids(tail)), seen, 'two pages of 100 and the rest are the same list as the pages of 24');
    /* filters: the search, the genre, both, with paging */
    const q = await req(srv.port, 'GET', '/api/shares?q=amazing');
    assert.ok(ids(q).indexOf('r007') > -1 && q.body.shares.every(s => /amazing/i.test(s.title + ' ' + s.composer + ' ' + s.owner)));
    const jazz = await req(srv.port, 'GET', '/api/shares?genre=Jazz&limit=10');
    assert.ok(typeof jazz.body.next === 'string');
    assert.equal(jazz.body.shares.length, 10);
    assert.ok(jazz.body.shares.every(s => s.genre === 'Jazz'));
    const jazz2 = await req(srv.port, 'GET', '/api/shares?genre=Jazz&limit=10&cursor=' + encodeURIComponent(jazz.body.next));
    assert.ok(jazz2.body.shares.every(s => s.genre === 'Jazz') && jazz2.body.shares.length === 10 + 0 && !jazz2.body.shares.some(s => ids(jazz).indexOf(s.id) > -1));
    assert.equal((await req(srv.port, 'GET', '/api/shares?genre=Nope')).body.shares.length, 0);
    /* a cursor that is not one of ours is refused, not guessed at */
    for (const bad of ['x', '!!', 'e30', Buffer.from('["no","r001"]').toString('base64url'), Buffer.from('["2026-01-01T00:00:00.000Z","a b"]').toString('base64url'), Buffer.from('[1,2]').toString('base64url'), 'A'.repeat(300)]) {
      assert.equal((await req(srv.port, 'GET', '/api/shares?cursor=' + encodeURIComponent(bad))).status, 400, bad.slice(0, 20));
    }
    assert.equal((await req(srv.port, 'GET', '/api/shares?mine=1')).status, 401, 'mine still needs an account');
  } finally { await srv.close(); rm(dir); }
});

test('shares: a hostile genre or search is only a string - no error, no more rows, nothing from other genres', async () => {
  const dir = tmp();
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(row('g' + String(i).padStart(2, '0'), new Date(Date.parse('2026-02-01T00:00:00.000Z') + i * 1000).toISOString(), { genre: i % 2 ? 'Jazz' : 'Classical', title: i === 3 ? '100% Swing_ok' : 'Tune ' + i }));
  fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: rows }));
  const srv = await boot(dir);
  try {
    const total = (await req(srv.port, 'GET', '/api/shares?limit=100')).body.shares.length;
    const asked = async qs => req(srv.port, 'GET', '/api/shares?' + qs);
    const jazz = (await asked('genre=Jazz&limit=100')).body.shares;
    assert.ok(jazz.length >= 6 && jazz.every(s => s.genre === 'Jazz'));
    for (const g of ["' OR 1=1 --", "Jazz' OR genre <> '", 'Jazz"; DROP TABLE ppp_shares; --', 'Jazz%', '%', '_azz', 'J_zz', '\\', 'x'.repeat(5000), '\u00e9\u{1F3B9}', 'jazz', 'JAZZ']) {
      const r = await asked('genre=' + encodeURIComponent(g) + '&limit=100');
      assert.equal(r.status, 200, JSON.stringify(g.slice(0, 20)));
      assert.deepEqual(r.body.shares, [], 'no row has the genre ' + JSON.stringify(g.slice(0, 20)) + ': it is matched whole, as it is');
    }
    /* a NUL is dropped (Postgres cannot hold it): the rest is the genre */
    for (const g of ['Jazz%00', '%00Jazz', 'Ja%00zz']) {
      const r = await asked('genre=' + g + '&limit=100');
      assert.equal(r.status, 200, g);
      assert.ok(r.body.shares.length === jazz.length && r.body.shares.every(s => s.genre === 'Jazz'), g);
    }
    assert.equal((await asked('genre=Jazz&genre=Classical&limit=100')).body.shares.length, jazz.length, 'two genre fields: the first');
    assert.equal((await asked('genre=&limit=100')).body.shares.length, total, 'an empty genre is no genre');
    /* the search: % and _ are letters, not wildcards; a backslash and a NUL are fine */
    assert.deepEqual((await asked('q=' + encodeURIComponent('100%'))).body.shares.map(s => s.id), ['g03']);
    assert.deepEqual((await asked('q=' + encodeURIComponent('Swing_ok'))).body.shares.map(s => s.id), ['g03']);
    assert.deepEqual((await asked('q=' + encodeURIComponent('Swing_o'))).body.shares.map(s => s.id), ['g03']);
    assert.deepEqual((await asked('q=' + encodeURIComponent('Swing.ok'))).body.shares, [], '_ is not a wildcard');
    assert.deepEqual((await asked('q=' + encodeURIComponent('%'))).body.shares.map(s => s.id), ['g03'], '% alone is only the one title that has one');
    for (const q of ["' OR 1=1 --", '\\', '%00', 'Tune%00%205', 'x'.repeat(5000)]) {
      const r = await asked('q=' + (q.indexOf('%') >= 0 ? q : encodeURIComponent(q)));
      assert.equal(r.status, 200, JSON.stringify(q.slice(0, 20)));
    }
    assert.deepEqual((await asked('q=Tune%00%205')).body.shares.map(s => s.id), ['g05'], 'a NUL in the search is dropped');
  } finally { await srv.close(); rm(dir); }
});

test('shares: an account\'s own list is still one answer, and an older client that reads only .shares still works', async () => {
  const dir = tmp(); const srv = await boot(dir);
  try {
    const su = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'owner@example.com', password: 'practice-ok', displayName: 'Owner' } });
    assert.equal(su.status, 201);
    const cookie = String(su.headers['set-cookie'][0]).split(';')[0];
    const score = { title: 'Mine', measures: [bar(1)], notes: [] };
    for (let i = 0; i < 30; i++) {
      const r = await req(srv.port, 'POST', '/api/shares', { cookie: cookie, body: { songKey: 'k' + i, title: 'Mine ' + i, listed: i % 2 === 0, score: score } });
      assert.equal(r.status, 201, 'share ' + i);
    }
    const mine = await req(srv.port, 'GET', '/api/shares?mine=1', { cookie: cookie });
    assert.equal(mine.body.shares.length, 30, 'all 30 of them: the page marks its songs "shared" from this list');
    assert.equal(mine.body.next, null);
    assert.ok(mine.body.shares.every(s => s.mine === true));
    assert.equal(mine.body.genres, undefined);
    const pub = await req(srv.port, 'GET', '/api/shares?limit=100');
    assert.equal(pub.body.shares.filter(s => s.owner === 'Owner').length, 15, 'only the posted ones are public');
    /* what an old page does: read .shares and nothing else */
    const old = await req(srv.port, 'GET', '/api/shares');
    assert.ok(Array.isArray(old.body.shares) && old.body.shares.length === 22 && old.body.next === null, '7 seeds and the 15 posted: fewer than a page');
    const one = await req(srv.port, 'GET', '/api/shares/' + mine.body.shares[0].id);
    assert.equal(one.status, 200);
    assert.ok(one.body.score, 'one share still carries its score');
  } finally { await srv.close(); rm(dir); }
});
