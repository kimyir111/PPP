/* Guest link sharing: a visitor with no account can send a song as an UNLISTED link.

   Two halves. The pure rules (share-guest.js) run with a clock the test gives them. Then the real
   server.js is started on a free port with its own empty data directory (PPP_DATA_DIR, the file
   store - no Postgres) and driven over HTTP: no browser. Every request names its "client address"
   with X-Forwarded-For, the way the login limit already finds a client, so each case has its own
   rate-limit bucket.

   Run: node tests/guest-share.test.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { freePort } = require('./serve-free');
const G = require('../share-guest');

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* ---------- the pure rules ---------- */
function rules() {
  console.log('\n── the rules, with a clock the test gives them ──');
  const secret = crypto.randomBytes(32).toString('hex');
  const id = G.guestOwnerId(secret);
  ok('a guest id is g_ + 24 hex of the sha256 of the secret',
    id === 'g_' + crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24) && /^g_[0-9a-f]{24}$/.test(id), id);
  ok('it neither equals nor contains the secret, nor any 8-char slice of it',
    id !== secret && id.indexOf(secret) < 0 && !secret.match(/.{8}/g).some(piece => id.indexOf(piece) > -1));
  ok('the same secret names the same owner; another secret another', G.guestOwnerId(secret) === id && G.guestOwnerId(secret + 'x') !== id);
  ok('a short, missing or odd secret names nobody',
    [undefined, null, '', 'short', 'x'.repeat(31), 'x'.repeat(129), 'a b'.repeat(20), 42, ['a'.repeat(40)]].every(v => G.guestOwnerId(v) === null));
  ok('31 characters is too few, 32 is enough', G.guestOwnerId('a'.repeat(31)) === null && G.guestOwnerId('a'.repeat(32)) !== null);
  ok('isGuestOwner tells a guest id from a user id', G.isGuestOwner(id) && !G.isGuestOwner('0b9f5b7e-4f55-4d1e-9c1e-111111111111') && !G.isGuestOwner('ppp-library') && !G.isGuestOwner('g_short'));
  ok('owners compare equal only when they are the same string', G.sameOwner(id, id) && !G.sameOwner(id, G.guestOwnerId('b'.repeat(40))) && !G.sameOwner(id, 'g_') && !G.sameOwner(id, null));

  const T0 = Date.parse('2026-10-01T00:00:00Z');
  ok('a guest link lives 90 days', Date.parse(G.expiryFor(T0)) - T0 === 90 * 24 * 3600 * 1000);
  const row = { expiresAt: G.expiryFor(T0) };
  ok('before its end date it is live; at and after, it is expired',
    !G.expired(row, T0) && !G.expired(row, T0 + G.GUEST.TTL_MS - 1) && G.expired(row, T0 + G.GUEST.TTL_MS) && G.expired(row, T0 + G.GUEST.TTL_MS + 1));
  ok('a row with no end date (an account\'s) never expires; a Date from Postgres is read too',
    !G.expired({}, T0 * 10) && !G.expired({ expiresAt: null }, T0 * 10) && G.expired({ expiresAt: new Date(T0 - 1) }, T0) && !G.expired({ expiresAt: new Date(T0 + 1) }, T0));

  let now = T0;
  const w = G.slidingWindow(3, 1000, () => now);
  const run = [w.take('a'), w.take('a'), w.take('a'), w.take('a')];
  ok('a sliding window lets 3 through and refuses the 4th', run.join() === 'true,true,true,false', run.join());
  ok('another key has its own window', w.take('b') === true);
  now += 999;
  ok('still refused 999 ms after the first', w.take('a') === false);
  now += 2;
  ok('free again once the first hits are out of the window', w.take('a') === true);
  now = T0;
  const w2 = G.slidingWindow(2, 1000, () => now);
  w2.take('k'); w2.take('k');
  for (let i = 0; i < 5; i++) { now += 400; w2.take('k'); }
  ok('a refused hit is not recorded, so waiting always frees the key', (() => { now += 1000; return w2.take('k'); })());
  const w3 = G.slidingWindow(1, 1000, () => now);
  for (let i = 0; i < 6000; i++) w3.take('ip-' + i);
  now += 5000;
  w3.take('late');
  ok('idle keys are dropped, so the table cannot grow for ever', w3.size() < 10, String(w3.size()));
  ok('the client address is the first X-Forwarded-For entry, else the socket, as the login limit finds it',
    G.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, socket: { remoteAddress: '::1' } }) === '1.2.3.4'
    && G.clientIp({ headers: {}, socket: { remoteAddress: '::1' } }) === '::1');
  ok('the limits are the ones the design names',
    G.GUEST.PER_GUEST === 20 && G.GUEST.PER_IP_PER_HOUR === 10 && G.GUEST.TTL_MS === 90 * 86400000 && G.GUEST.TOTAL_SHARES === 1000);
}

/* ---------- the server ---------- */
const jar = { cookie: '' };
function req(port, method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body == null ? null : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    const headers = Object.assign({}, opts.headers || {});
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
    if (opts.guest) headers['X-PPP-Guest'] = opts.guest;
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json, text: text, headers: res.headers });
      });
    });
    r.on('error', err => {
      /* the server hangs up on a body over its limit; some stacks report that as a reset */
      if (opts.tolerateReset) resolve({ status: 'reset', body: null, text: '', headers: {} }); else reject(err);
    });
    r.end(body);
  });
}

/* a score as small as a score can be: PPP checks only that it has measures and notes */
function smallScore(title, extra) {
  return Object.assign({
    title: title || 'Guest song', composer: 'Someone', tempo: 100,
    measures: [{ n: 1 }, { n: 2 }], notes: [{ m: 1, b: 1, midi: 60, dur: 1 }]
  }, extra || {});
}
const post = (port, guest, o, ip) => req(port, 'POST', '/api/shares', { guest: guest, ip: ip, body: o });
const secretOf = () => crypto.randomBytes(32).toString('hex');
let ipN = 0;
const nextIp = () => '203.0.113.' + (++ipN);

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-guest-share-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, DATABASE_URL: '' })
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early');
    try { const h = await req(port, 'GET', '/health'); if (h.status === 200) break; } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > 20000) { child.kill(); throw new Error('server.js did not come up'); }
    await new Promise(r => setTimeout(r, 120));
  }
  return { port: port, dir: dir, close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}

const sharesFile = dir => path.join(dir, 'shares.json');
const readRows = dir => { try { return JSON.parse(fs.readFileSync(sharesFile(dir), 'utf8')).shares; } catch (e) { return []; } };
const writeRows = (dir, rows) => fs.writeFileSync(sharesFile(dir), JSON.stringify({ shares: rows }));

async function main() {
  rules();
  const srv = await server();
  const P = srv.port;
  try {
    console.log('\n── creating a guest link ──');
    const A = secretOf();
    const none = await post(P, null, { songKey: 's1', title: 'T', score: smallScore() }, nextIp());
    ok('no guest key and no session: 401, as before', none.status === 401 && /Sign in to share/.test(none.body.error), none.status + '');
    const shortKey = await post(P, 'tooshort', { songKey: 's1', title: 'T', score: smallScore() }, nextIp());
    ok('a key that is not a key is the same 401', shortKey.status === 401, shortKey.status + '');

    const ipA = nextIp();
    const c = await post(P, A, { songKey: 'song-1', title: 'Moonlight', composer: 'Beethoven', genre: 'Classical', listed: true, kind: 'musicxml', score: smallScore('Moonlight') }, ipA);
    ok('a guest create is 201', c.status === 201, c.status + ' ' + JSON.stringify(c.body).slice(0, 120));
    const id = c.body && c.body.id;
    ok('it comes back unlisted whatever the body said (listed:true, genre ignored)', c.body.listed === false && c.body.genre === '', JSON.stringify({ l: c.body.listed, g: c.body.genre }));
    ok('named Guest, mine, with a link and an end date 90 days out',
      c.body.owner === 'Guest' && c.body.mine === true && c.body.url === '/?share=' + id
      && Math.abs(Date.parse(c.body.expiresAt) - (Date.now() + 90 * 86400000)) < 120000, c.body.expiresAt);
    ok('the answer never carries the secret or the owner id', c.text.indexOf(A) < 0 && c.text.indexOf('g_') < 0 && !('ownerId' in c.body));

    /* the library seeds (PPP Library) are in the file too; look at this link's row */
    const mineRows = readRows(srv.dir).filter(r => r.id === id);
    const gid = G.guestOwnerId(A);
    ok('the server stored owner g_<24 hex of sha256(secret)>, listed false, owner name Guest',
      mineRows.length === 1 && mineRows[0].ownerId === gid && mineRows[0].listed === false && mineRows[0].ownerName === 'Guest' && !!mineRows[0].expiresAt, mineRows[0] && mineRows[0].ownerId);
    ok('the secret is nowhere in the data directory', !fs.readdirSync(srv.dir).some(f => fs.readFileSync(path.join(srv.dir, f), 'utf8').indexOf(A) > -1));

    console.log('\n── never in the directory; no listing, no listing rights ──');
    const everyone = await req(P, 'GET', '/api/shares');
    ok('it is not in Shared Scores', everyone.status === 200 && !everyone.body.shares.some(s => s.id === id));
    const everyoneSearch = await req(P, 'GET', '/api/shares?q=Moonlight', { guest: A });
    ok('not even for a search, not even for its own guest key', !everyoneSearch.body.shares.some(s => s.id === id));
    const mine = await req(P, 'GET', '/api/shares?mine=1', { guest: A });
    ok('a guest cannot list "mine" (that stays an account feature)', mine.status === 401, mine.status + '');
    const patch = await req(P, 'PATCH', '/api/shares/' + id, { guest: A, body: { listed: true } });
    ok('a guest cannot post it: PATCH is 403', patch.status === 403, patch.status + '');
    const still = await req(P, 'GET', '/api/shares');
    ok('and it is still not listed', !still.body.shares.some(s => s.id === id));

    console.log('\n── opening a link, with no key and no account ──');
    const g = await req(P, 'GET', '/api/shares/' + id);
    ok('GET by link works for anyone', g.status === 200 && g.body.score && g.body.score.notes.length === 1 && g.body.title === 'Moonlight', g.status + '');
    ok('and says Guest, not mine, with no song key', g.body.owner === 'Guest' && g.body.mine === false && g.body.songKey === undefined);
    const gOwn = await req(P, 'GET', '/api/shares/' + id, { guest: A });
    ok('with the key, the same link says it is mine (and gives the song key)', gOwn.body.mine === true && gOwn.body.songKey === 'song-1');
    const page = await req(P, 'GET', '/?share=' + id);
    ok('the link page carries Open Graph tags, and asks search engines not to index it',
      /property="og:title" content="Moonlight · Beethoven"/.test(page.text) && /<meta name="robots" content="noindex">/.test(page.text), page.status + '');

    console.log('\n── sharing the same song again ──');
    const before = readRows(srv.dir).find(r => r.id === id);
    await new Promise(r => setTimeout(r, 15));
    const again = await post(P, A, { songKey: 'song-1', title: 'Moonlight (edited)', score: smallScore('Moonlight (edited)') }, ipA);
    ok('the same song key updates the same row: 200, same id, same link', again.status === 200 && again.body.id === id, again.status + ' ' + (again.body && again.body.id));
    const after = readRows(srv.dir).filter(r => r.ownerId === before.ownerId);
    ok('one row, new title, still unlisted, created time kept, end date moved forward',
      after.length === 1 && after[0].title === 'Moonlight (edited)' && after[0].listed === false && after[0].createdAt === before.createdAt && after[0].expiresAt > before.expiresAt,
      after.length + ' row(s)');
    const other = await post(P, secretOf(), { songKey: 'song-1', title: 'Same key, another guest', score: smallScore() }, nextIp());
    ok('another guest using the same song key gets a row of their own', other.status === 201 && other.body.id !== id, other.status + '');

    console.log('\n── checks the signed-in path already made ──');
    const notScore = await post(P, A, { songKey: 'x', title: 'T', score: { measures: [], notes: [] } }, ipA);
    ok('not a score: 422', notScore.status === 422, notScore.status + '');
    const noTitle = await post(P, A, { songKey: 'x', score: { measures: [{}], notes: [] } }, ipA);
    ok('no title: 422', noTitle.status === 422, noTitle.status + '');
    const noKey = await post(P, A, { title: 'T', score: smallScore() }, ipA);
    ok('no song key: 422', noKey.status === 422, noKey.status + '');
    const long = await post(P, A, { songKey: 'k-long', title: 'T'.repeat(500), composer: 'C'.repeat(500), score: smallScore() }, ipA);
    ok('title and composer are clipped (120, 160) as for an account', long.status === 201 && long.body.title.length === 120 && long.body.composer.length === 160, long.body && long.body.title.length + '/' + long.body.composer.length);
    const big = await req(P, 'POST', '/api/shares', { guest: A, ip: ipA, tolerateReset: true,
      body: JSON.stringify({ songKey: 'big', title: 'Big', score: smallScore('Big', { pad: 'x'.repeat(4 * 1024 * 1024 + 10) }) }) });
    ok('a body over 4 MB is refused: 413', big.status === 413 || big.status === 'reset', String(big.status));

    console.log('\n── taking a link down ──');
    const del = (guest, ip) => req(P, 'DELETE', '/api/shares/' + id, { guest: guest, ip: ip });
    const d1 = await del(null);
    ok('anonymous cannot: 403', d1.status === 403, d1.status + '');
    const d2 = await del(secretOf());
    ok('another guest key cannot: 403', d2.status === 403, d2.status + '');
    const d3 = await del(A.slice(0, -1) + (A.slice(-1) === 'a' ? 'b' : 'a'));
    ok('a key that is one character off cannot: 403', d3.status === 403, d3.status + '');
    const d4 = await del('short');
    ok('a bad key is no key: 403', d4.status === 403, d4.status + '');
    ok('and the link still opens', (await req(P, 'GET', '/api/shares/' + id)).status === 200);
    const d5 = await del(A);
    ok('the key that made it can: 200', d5.status === 200, d5.status + '');
    ok('then the link is 404', (await req(P, 'GET', '/api/shares/' + id)).status === 404);
    ok('and the page for it has no Open Graph card', !/og:title/.test((await req(P, 'GET', '/?share=' + id)).text));
    ok('the row is gone from the file', !readRows(srv.dir).some(r => r.id === id));

    console.log('\n── how many one browser may keep ──');
    const B = secretOf();
    let created = 0, last = null;
    for (let i = 0; i < 20; i++) {
      /* four per address, so the address limit is not what is being tested */
      const r = await post(P, B, { songKey: 'cap-' + i, title: 'Cap ' + i, score: smallScore() }, '198.51.100.' + (10 + Math.floor(i / 4)));
      if (r.status === 201) created++;
      last = r;
    }
    ok('20 links are fine', created === 20, created + ' ' + (last && last.status));
    const over = await post(P, B, { songKey: 'cap-20', title: 'Cap 20', score: smallScore() }, '198.51.100.99');
    ok('the 21st is 429 (one browser keeps 20)', over.status === 429 && /guest links/i.test(over.body.error), over.status + '');
    const upd = await post(P, B, { songKey: 'cap-3', title: 'Cap 3 again', score: smallScore() }, '198.51.100.98');
    ok('but sharing one of the 20 again still works', upd.status === 200, upd.status + '');
    const freed = await req(P, 'DELETE', '/api/shares/' + upd.body.id, { guest: B });
    const room = await post(P, B, { songKey: 'cap-20', title: 'Cap 20', score: smallScore() }, '198.51.100.97');
    ok('stopping one makes room', freed.status === 200 && room.status === 201, freed.status + '/' + room.status);

    console.log('\n── how many one address may make in an hour ──');
    const ipC = '192.0.2.77';
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await post(P, secretOf(), { songKey: 'ip-' + i, title: 'Ip ' + i, score: smallScore() }, ipC)).status);
    ok('10 go through, the 11th and 12th are 429', results.slice(0, 10).every(s => s === 201) && results[10] === 429 && results[11] === 429, results.join(' '));
    const fresh = await post(P, secretOf(), { songKey: 'ip-x', title: 'Other address', score: smallScore() }, '192.0.2.78');
    ok('another address is not held up', fresh.status === 201, fresh.status + '');
    const viaOne = await post(P, A, { songKey: 'ip-y', title: 'Chain', score: smallScore() }, '192.0.2.79, 10.0.0.1');
    const viaTwo = await post(P, A, { songKey: 'ip-z', title: 'Chain', score: smallScore() }, '192.0.2.79, 10.0.0.9');
    ok('the address is the first X-Forwarded-For entry (as the login limit reads it)', viaOne.status === 201 && viaTwo.status === 201);
    const bodyLess = await req(P, 'POST', '/api/shares', { ip: ipC });
    ok('a refused address cannot even make the server read a body, but an unkeyed request is still the old 401', bodyLess.status === 401, bodyLess.status + '');

    console.log('\n── end dates ──');
    const C = secretOf(), gc = G.guestOwnerId(C);
    const created2 = await post(P, C, { songKey: 'exp-live', title: 'Will live', score: smallScore() }, nextIp());
    const liveId = created2.body.id;
    const rowsNow = readRows(srv.dir);
    const base = rowsNow.find(r => r.id === liveId);
    const past = new Date(Date.now() - 1000).toISOString();
    const stale = Object.assign({}, base, { id: 'expiredRow01', songKey: 'exp-old', title: 'Old link', expiresAt: past });
    writeRows(srv.dir, rowsNow.concat([stale]));
    const gone = await req(P, 'GET', '/api/shares/expiredRow01');
    ok('a link past its end date is 404 at once, though nothing has swept it', gone.status === 404, gone.status + '');
    ok('and its page has no Open Graph card', !/og:title/.test((await req(P, 'GET', '/?share=expiredRow01')).text));
    ok('its owner cannot take it down any more: also 404', (await req(P, 'DELETE', '/api/shares/expiredRow01', { guest: C })).status === 404);
    ok('the row is still in the file until a guest makes a link', readRows(srv.dir).some(r => r.id === 'expiredRow01'));
    ok('a live link is untouched', (await req(P, 'GET', '/api/shares/' + liveId)).status === 200);
    const trigger = await post(P, secretOf(), { songKey: 'sweep', title: 'Sweeper', score: smallScore() }, nextIp());
    ok('the next guest create sweeps expired guest rows', trigger.status === 201 && !readRows(srv.dir).some(r => r.id === 'expiredRow01'));
    ok('without touching live ones', readRows(srv.dir).some(r => r.id === liveId));
    const stale2 = Object.assign({}, base, { id: 'expiredRow02', songKey: 'exp-same', title: 'Old', expiresAt: past });
    writeRows(srv.dir, readRows(srv.dir).concat([stale2]));
    const redo = await post(P, C, { songKey: 'exp-same', title: 'Again', score: smallScore() }, nextIp());
    ok('sharing a song whose old link ran out makes a new link', redo.status === 201 && redo.body.id !== 'expiredRow02', redo.status + ' ' + (redo.body && redo.body.id));

    console.log('\n── what all guests together may hold ──');
    const filler = (n, bytes) => ({
      id: 'fill' + String(n).padStart(8, '0'), ownerId: 'g_' + String(n).padStart(24, '0').replace(/\D/g, '0'), ownerName: 'Guest', songKey: 'f', title: 'Filler', composer: '', genre: '',
      kind: '', measures: 2, listed: false, preview: null, score: bytes ? Object.assign(smallScore(), { pad: 'x'.repeat(bytes) }) : smallScore(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
    });
    const keep = readRows(srv.dir);
    const room1000 = Math.max(0, G.GUEST.TOTAL_SHARES - keep.filter(r => G.isGuestOwner(r.ownerId)).length);
    const fill = [];
    for (let i = 0; i < room1000; i++) fill.push(filler(i));
    writeRows(srv.dir, keep.concat(fill));
    const full = await post(P, secretOf(), { songKey: 'full', title: 'One too many', score: smallScore() }, nextIp());
    ok('with 1000 guest links in all, a new one is refused: 503', full.status === 503 && /full/i.test(full.body.error), full.status + '');
    const upd2 = await post(P, C, { songKey: 'exp-live', title: 'Edited while full', score: smallScore() }, nextIp());
    ok('but a guest may still update a link they already have', upd2.status === 200, upd2.status + '');
    writeRows(srv.dir, keep.concat([filler(1, 99 * 1024 * 1024)]));
    const tooBig = await post(P, secretOf(), { songKey: 'bytes', title: 'Over the bytes', score: smallScore('x', { pad: 'y'.repeat(2 * 1024 * 1024) }) }, nextIp());
    ok('with ~99 MB held, another 2 MB link would pass 100 MB: 503', tooBig.status === 503, tooBig.status + '');
    const smallOk = await post(P, secretOf(), { songKey: 'bytes-ok', title: 'Small', score: smallScore() }, nextIp());
    ok('a small one still fits', smallOk.status === 201, smallOk.status + '');
    writeRows(srv.dir, keep);

    console.log('\n── an account is not changed ──');
    const email = 'guest-share-' + Date.now() + '@example.com';
    const su = await req(P, 'POST', '/api/auth/signup', { body: { email: email, password: 'practice-ok', displayName: 'Real User' }, ip: nextIp() });
    const cookie = (su.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    ok('an account for the test', su.status === 201 && !!cookie, su.status + '');
    const U = (method, p, body, extra) => req(P, method, p, Object.assign({ cookie: cookie, body: body, ip: nextIp() }, extra || {}));
    const up = await U('POST', '/api/shares', { songKey: 'u1', title: 'Account song', genre: 'Classical', listed: true, score: smallScore('Account song') });
    ok('signed in: 201, listed as asked, genre kept, no end date', up.status === 201 && up.body.listed === true && up.body.genre === 'Classical' && up.body.owner === 'Real User' && up.body.expiresAt === undefined, JSON.stringify(up.body).slice(0, 100));
    const dir2 = await req(P, 'GET', '/api/shares');
    ok('it is in Shared Scores', dir2.body.shares.some(s => s.id === up.body.id));
    ok('GET ?mine=1 lists it, and none of the guest links', (await U('GET', '/api/shares?mine=1')).body.shares.map(s => s.id).join() === up.body.id);
    const unl = await U('PATCH', '/api/shares/' + up.body.id, { listed: false });
    ok('PATCH listed:false still works for the owner', unl.status === 200 && unl.body.listed === false);
    const withKey = await U('POST', '/api/shares', { songKey: 'u2', title: 'Both', listed: true, score: smallScore() }, { guest: secretOf() });
    ok('with a session and a guest key, the account wins: owned by the account, listed as asked', withKey.status === 201 && withKey.body.listed === true && withKey.body.owner === 'Real User');
    const again2 = await U('POST', '/api/shares', { songKey: 'u2', title: 'Both', score: smallScore() });
    ok('re-sending a link keeps a posted score posted, as before', again2.status === 200 && again2.body.listed === true);
    const guestRow = (await post(P, secretOf(), { songKey: 'gx', title: 'Someone else\'s guest link', score: smallScore() }, nextIp())).body;
    ok('an account cannot delete or change a guest\'s link', (await U('DELETE', '/api/shares/' + guestRow.id)).status === 403 && (await U('PATCH', '/api/shares/' + guestRow.id, { listed: true })).status === 403);
    const D = secretOf();
    const mineAsGuest = (await post(P, D, { songKey: 'gy', title: 'Mine before sign-in', score: smallScore() }, nextIp())).body;
    const delBoth = await U('DELETE', '/api/shares/' + mineAsGuest.id, null, { guest: D });
    ok('someone who signed in later can still take down the link their browser made (key + session)', delBoth.status === 200, delBoth.status + '');
    ok('an account\'s share cannot be deleted with a guest key', (await req(P, 'DELETE', '/api/shares/' + up.body.id, { guest: D })).status === 403);
    ok('and anonymous still cannot delete an account\'s share', (await req(P, 'DELETE', '/api/shares/' + up.body.id)).status === 403);
    const meta = await req(P, 'GET', '/?share=' + up.body.id);
    ok('an account\'s link page has its Open Graph card, with no noindex', /og:title/.test(meta.text) && !/noindex/.test(meta.text));
    const all = readRows(srv.dir);
    ok('in the file: every guest row is unlisted with an end date, and no account row has one',
      all.filter(r => G.isGuestOwner(r.ownerId)).every(r => r.listed === false && !!r.expiresAt && r.ownerName === 'Guest')
      && all.filter(r => !G.isGuestOwner(r.ownerId)).every(r => !r.expiresAt));
  } finally {
    await srv.close();
    try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  }
}

main().then(() => {
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('A guest can send an unlisted link, take it back, and stay inside the limits; accounts are as they were.');
  process.exit(0);
}).catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
