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
  ok('a guest link lives 30 days', Date.parse(G.expiryFor(T0)) - T0 === 30 * 24 * 3600 * 1000);
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
  const reqOf = (headers, ip) => ({ headers: headers, socket: { remoteAddress: ip || '::1' } });
  /* peek records nothing; a refused hit adds no key; the table is bounded; release gives a hit back */
  now = T0;
  const w4 = G.slidingWindow(1, 1000, () => now);
  const peeked = w4.peek('p') && w4.size() === 0;
  w4.take('p');
  const refusedKeys = [w4.take('p'), w4.take('p'), w4.peek('p')];
  ok('peek records nothing, and a refused hit is not recorded', peeked && refusedKeys.join() === 'false,false,false' && w4.size() === 1);
  w4.release('p');
  ok('release gives the newest hit back', w4.peek('p') === true && w4.size() === 0);
  const w5 = G.slidingWindow(1, 3600000, () => now, 100);
  for (let i = 0; i < 5000; i++) w5.take('spoof-' + i);
  ok('a table with a bound never holds more keys than it, however many addresses are made up', w5.size() === 100, String(w5.size()));
  const w6 = G.slidingWindow(1, 3600000, () => now, 100);
  w6.take('real'); w6.take('real');
  for (let i = 0; i < 99; i++) w6.take('a' + i);
  w6.take('real');
  for (let i = 0; i < 50; i++) w6.take('b' + i);
  ok('the oldest key is the one dropped, the newest are kept', w6.size() === 100 && w6.take('real') === true && w6.take('b49') === false);
  const w7 = G.slidingWindow(1, 1000, () => now, 100000);
  const t0w = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) w7.take('k' + (i % 50));
  const ms = Number(process.hrtime.bigint() - t0w) / 1e6;
  ok('a take is cheap (20000 takes over 50 keys in well under a second)', ms < 500, ms.toFixed(0) + ' ms');

  console.log('\n── the client address: nothing the client writes names it ──');
  ok('behind one proxy the address is the LAST X-Forwarded-For entry; the first (client-written) is ignored',
    G.clientIp(reqOf({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }), {}) === '1.2.3.4'
    && G.clientIp(reqOf({ 'x-forwarded-for': 'a, b, c, 9.9.9.9' }), {}) === '9.9.9.9');
  ok('with PPP_PROXY_HOPS=2 it is the entry two from the right',
    G.clientIp(reqOf({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.1' }), { PPP_PROXY_HOPS: '2' }) === '1.2.3.4'
    && G.clientIp(reqOf({ 'x-forwarded-for': '1.2.3.4' }), { PPP_PROXY_HOPS: '2' }) === '::1');
  ok('a bad hop count falls back to 1', G.clientIp(reqOf({ 'x-forwarded-for': 'x, 1.2.3.4' }), { PPP_PROXY_HOPS: 'banana' }) === '1.2.3.4'
    && G.clientIp(reqOf({ 'x-forwarded-for': 'x, 1.2.3.4' }), { PPP_PROXY_HOPS: '0' }) === '1.2.3.4');
  ok('with no header it is the socket address', G.clientIp(reqOf({}, '10.1.1.1'), {}) === '10.1.1.1');
  ok('on Render, CF-Connecting-IP wins, then True-Client-IP; off Render they are ignored',
    G.clientIp(reqOf({ 'true-client-ip': '7.7.7.7', 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' }), { RENDER: 'true' }) === '8.8.8.8'
    && G.clientIp(reqOf({ 'true-client-ip': '7.7.7.7', 'x-forwarded-for': '1.1.1.1' }), { RENDER: 'true' }) === '7.7.7.7'
    && G.clientIp(reqOf({ 'x-forwarded-for': '1.1.1.1' }), { RENDER: 'true' }) === '1.1.1.1'
    && G.clientIp(reqOf({ 'cf-connecting-ip': '8.8.8.8', 'true-client-ip': '7.7.7.7', 'x-forwarded-for': '1.1.1.1' }), {}) === '1.1.1.1');
  ok('and it says where the address came from',
    G.clientAddress(reqOf({ 'cf-connecting-ip': '8.8.8.8' }), { RENDER: '1' }).source === 'cf-connecting-ip'
    && G.clientAddress(reqOf({ 'true-client-ip': '7.7.7.7' }), { RENDER: '1' }).source === 'true-client-ip'
    && /^x-forwarded-for/.test(G.clientAddress(reqOf({ 'x-forwarded-for': 'a, b' }), {}).source)
    && G.clientAddress(reqOf({}), {}).source === 'socket');

  console.log('\n── what cannot be stored: NUL, lone surrogates, nesting too deep ──');
  const nest = n => { let a = []; for (let i = 0; i < n; i++) a = [a]; return a; };
  ok('a NUL, a lone high surrogate and a lone low surrogate in a string are found', G.inspect({ a: ['x' + String.fromCharCode(0) + 'y'] }) === 'text'
    && G.inspect({ a: String.fromCharCode(0xd800) }) === 'text' && G.inspect({ a: 'x' + String.fromCharCode(0xdc00) }) === 'text');
  const keyWithNul = {}; keyWithNul['k' + String.fromCharCode(0)] = 1;
  ok('in a key too', G.inspect(keyWithNul) === 'text');
  ok('Korean, Japanese, accents and an emoji (a proper surrogate pair) are text', G.inspect({ a: '한글 かな é 😀 𝄞' }) === null);
  ok('nesting up to 64 containers is allowed, 65 is not', G.inspect(nest(63)) === null && G.inspect(nest(64)) === 'depth');
  ok('and 200000 levels is judged without overflowing the stack', G.inspect(JSON.parse('['.repeat(200000) + ']'.repeat(200000))) === 'depth');

  console.log('\n── what may be stored: a re-send is held to the caps as growth ──');
  const GG = G.GUEST;
  ok('a new link under every cap is allowed', G.decide(null, 0, { count: 5, bytes: 1000 }, 1000) === null);
  ok('a browser at 20 may not make a 21st, but may re-send one of its 20', G.decide(null, 20, { count: 20, bytes: 0 }, 1).status === 429 && G.decide({ bytes: 1 }, 20, { count: 20, bytes: 1 }, 1) === null);
  ok('the count cap: 1000 held, a new one is 503 (code guest-full)', (() => { const d = G.decide(null, 0, { count: 1000, bytes: 0 }, 1); return d.status === 503 && d.code === 'guest-full'; })());
  ok('the byte cap counts a new link in full', G.decide(null, 0, { count: 1, bytes: GG.TOTAL_BYTES - 10 }, 11).status === 503 && G.decide(null, 0, { count: 1, bytes: GG.TOTAL_BYTES - 10 }, 10) === null);
  ok('a tiny link re-sent at 1 MB is a growth of 1 MB less its old size, and is refused when that passes the cap',
    G.decide({ bytes: 500 }, 1, { count: 1, bytes: GG.TOTAL_BYTES - 1000 }, GG.MAX_BYTES).status === 503
    && G.decide({ bytes: GG.MAX_BYTES }, 1, { count: 1, bytes: GG.TOTAL_BYTES }, GG.MAX_BYTES) === null);
  const pv = { measures: [{}], notes: [{ m: 1 }] };
  ok('what a row holds counts its preview too', G.rowBytes({ a: 1 }, pv) === Buffer.byteLength(JSON.stringify({ a: 1 })) + Buffer.byteLength(JSON.stringify(pv)) && G.rowBytes({ a: 1 }, null) < G.rowBytes({ a: 1 }, pv));
  ok('the limits are the ones named',
    GG.PER_GUEST === 20 && GG.PER_IP_PER_HOUR === 30 && GG.GLOBAL_PER_HOUR === 200 && GG.TTL_MS === 30 * 86400000 && GG.TOTAL_SHARES === 1000
    && GG.TOTAL_BYTES === 50 * 1024 * 1024 && GG.MAX_BYTES === 1024 * 1024 && GG.PREVIEW_MAX_BYTES === 24 * 1024);
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

async function server(extraEnv, preRows, capture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-guest-share-'));
  const port = await freePort();
  if (preRows) fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: preRows }));
  const env = Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, DATABASE_URL: '' });
  delete env.RENDER; delete env.PPP_PROXY_HOPS;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore', env: Object.assign(env, extraEnv || {})
  });
  const log = { text: '' };
  if (capture) { child.stdout.on('data', d => { log.text += d; }); child.stderr.on('data', d => { log.text += d; }); }
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early');
    try { const h = await req(port, 'GET', '/health'); if (h.status === 200) break; } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > 20000) { child.kill(); throw new Error('server.js did not come up'); }
    await new Promise(r => setTimeout(r, 120));
  }
  return { port: port, dir: dir, log: log, close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
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
    ok('named Guest, mine, with a link and an end date 30 days out',
      c.body.owner === 'Guest' && c.body.mine === true && c.body.url === '/?share=' + id
      && Math.abs(Date.parse(c.body.expiresAt) - (Date.now() + 30 * 86400000)) < 120000, c.body.expiresAt);
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
    const bigBody = n => JSON.stringify({ songKey: 'big', title: 'Big', score: smallScore('Big', { pad: 'x'.repeat(n) }) });
    const big = await req(P, 'POST', '/api/shares', { guest: A, ip: ipA, tolerateReset: true, body: bigBody(1024 * 1024 + 10) });
    ok('a guest body over 1 MB is refused with a real 413 JSON answer (not a reset)', big.status === 413 && /too large/.test(big.body.error) && /guest/.test(big.body.error), big.status + ' ' + big.text.slice(0, 80));
    const huge = await req(P, 'POST', '/api/shares', { guest: A, ip: ipA, tolerateReset: true, body: bigBody(20 * 1024 * 1024) });
    ok('one far over the limit is refused too (413, or the connection is cut)', huge.status === 413 || huge.status === 'reset', String(huge.status));
    const nearly = await post(P, A, { songKey: 'nearly', title: 'Nearly 1 MB', score: smallScore('Nearly', { pad: 'x'.repeat(900 * 1024) }) }, ipA);
    ok('900 KB of score is fine for a guest', nearly.status === 201, nearly.status + '');
    const withPreview = await post(P, A, { songKey: 'pv', title: 'With a preview', score: smallScore('P'), preview: smallScore('P') }, ipA);
    const pvRow = readRows(srv.dir).find(r => r.id === withPreview.body.id);
    ok('a small preview is kept, and counted in the row\'s bytes', withPreview.status === 201 && !!pvRow.preview && pvRow.bytes === G.rowBytes(smallScore('P'), smallScore('P')), pvRow && String(pvRow.bytes));
    const bigPreview = await post(P, A, { songKey: 'pv2', title: 'Big preview', score: smallScore('P'), preview: smallScore('P', { pad: 'x'.repeat(30 * 1024) }) }, ipA);
    const pvRow2 = readRows(srv.dir).find(r => r.id === bigPreview.body.id);
    ok('a preview over 24 KB is dropped, and not counted', bigPreview.status === 201 && pvRow2.preview === null && pvRow2.bytes === G.rowBytes(smallScore('P'), null), pvRow2 && String(pvRow2.bytes));
    const nullMeasure = await post(P, A, { songKey: 'nm', title: 'T', score: { measures: [null], notes: [] } }, ipA);
    const nullNote = await post(P, A, { songKey: 'nn', title: 'T', score: { measures: [{}], notes: [null] } }, ipA);
    ok('measures:[null] and notes:[null] are 422, not stored', nullMeasure.status === 422 && nullNote.status === 422 && !readRows(srv.dir).some(r => r.songKey === 'nm' || r.songKey === 'nn'), nullMeasure.status + '/' + nullNote.status);
    const deep = await req(P, 'POST', '/api/shares', { guest: A, ip: ipA, tolerateReset: true,
      body: '{"songKey":"deep","title":"T","score":{"measures":[{}],"notes":[],"x":' + '['.repeat(200000) + ']'.repeat(200000) + '}}' });
    ok('JSON nested far too deep is a 4xx, not a 500', deep.status >= 400 && deep.status < 500, String(deep.status));
    const deepPreview = await req(P, 'POST', '/api/shares', { guest: A, ip: ipA, tolerateReset: true,
      body: '{"songKey":"deep2","title":"T","score":{"measures":[{}],"notes":[]},"preview":{"measures":[{}],"notes":[],"x":' + '['.repeat(200000) + ']'.repeat(200000) + '}}' });
    ok('and so is a preview nested too deep', deepPreview.status >= 400 && deepPreview.status < 500, String(deepPreview.status));

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
    for (let i = 0; i < 32; i++) results.push((await post(P, secretOf(), { songKey: 'ip-' + i, title: 'Ip ' + i, score: smallScore() }, ipC)).status);
    ok('30 go through, the 31st and 32nd are 429', results.slice(0, 30).every(s => s === 201) && results[30] === 429 && results[31] === 429, results.join(' '));
    const fresh = await post(P, secretOf(), { songKey: 'ip-x', title: 'Other address', score: smallScore() }, '192.0.2.78');
    ok('another address is not held up', fresh.status === 201, fresh.status + '');
    const bodyLess = await req(P, 'POST', '/api/shares', { ip: ipC });
    ok('a refused address cannot even make the server read a body, but an unkeyed request is still the old 401', bodyLess.status === 401, bodyLess.status + '');

    console.log('\n── a spoofed X-Forwarded-For does not name the client ──');
    /* one real address behind one proxy: the proxy appends it; whatever the client wrote in front is ignored */
    const spoof = [];
    for (let i = 0; i < 32; i++) spoof.push((await post(P, secretOf(), { songKey: 'sp-' + i, title: 'Spoof ' + i, score: smallScore() }, 'fake-' + i + '-' + crypto.randomBytes(4).toString('hex') + ', 192.0.2.150')).status);
    ok('rotating made-up first entries gets nowhere: the 31st from the same real address is still 429', spoof.slice(0, 30).every(s => s === 201) && spoof[30] === 429 && spoof[31] === 429, spoof.join(' '));
    const viaTwo = await post(P, secretOf(), { songKey: 'sp-z', title: 'Other real address', score: smallScore() }, 'same-first, 192.0.2.151');
    ok('a different real (last) address has its own budget', viaTwo.status === 201, viaTwo.status + '');
    const manyEntries = await post(P, secretOf(), { songKey: 'sp-many', title: 'Long chain', score: smallScore() }, 'a, b, c, d, e, f, 192.0.2.152');
    ok('a long client-written chain is still read from the right', manyEntries.status === 201);

    console.log('\n── garbage cannot burn the budget honest guests share ──');
    /* 260 requests that fail validation, each from an address of its own: before, they used up the server-wide 200 per hour */
    let garbage = 0;
    for (let i = 0; i < 260; i++) {
      const r = await post(P, secretOf(), { songKey: 'g-' + i, title: 'T', score: { measures: [], notes: [] } }, '198.18.' + Math.floor(i / 200) + '.' + (i % 200));
      if (r.status === 422) garbage++;
    }
    ok('260 invalid requests are all answered 422 (none was a 429)', garbage === 260, String(garbage));
    const honest = await post(P, secretOf(), { songKey: 'honest', title: 'Honest guest', score: smallScore() }, '198.19.0.1');
    ok('and an honest guest still gets a link afterwards', honest.status === 201, honest.status + '');
    const failures = [];
    for (let i = 0; i < 62; i++) failures.push((await post(P, secretOf(), { songKey: 'f-' + i, title: 'T', score: { measures: [], notes: [] } }, '198.19.0.2')).status);
    ok('one address that keeps sending garbage runs out of its small budget: 60 answered 422, then 429', failures.slice(0, 60).every(s => s === 422) && failures[60] === 429, failures.slice(58).join(' '));
    const sameAddr = await post(P, secretOf(), { songKey: 'f-ok', title: 'Valid but from the bad address', score: smallScore() }, '198.19.0.2');
    ok('...and a valid request from it waits too', sameAddr.status === 429);

    console.log('\n── a score that cannot be stored is a 422, and charged ──');
    const NUL = String.fromCharCode(0);
    const nulIn = (where, ip) => {
      const body = { songKey: 'nul', title: 'T', score: smallScore('N') };
      if (where === 'score') body.score.notes[0].lyric = 'a' + NUL + 'b';
      if (where === 'title') body.title = 'T' + NUL;
      if (where === 'composer') body.composer = 'C' + NUL;
      if (where === 'songKey') body.songKey = 'k' + NUL;
      if (where === 'preview') body.preview = smallScore('P', { pad: 'a' + NUL });
      if (where === 'key') body.score['k' + NUL] = 1;
      if (where === 'surrogate') body.score.notes[0].lyric = String.fromCharCode(0xd800);
      return post(P, secretOf(), body, ip);
    };
    const nulAnswers = [];
    for (const where of ['score', 'title', 'composer', 'songKey', 'preview', 'key', 'surrogate']) nulAnswers.push((await nulIn(where, nextIp())).status);
    ok('a NUL (in the score, title, composer, song key, preview or a key) or a lone surrogate is 422, not 500', nulAnswers.every(x => x === 422), nulAnswers.join(' '));
    const nulRaw = await req(P, 'POST', '/api/shares', { guest: secretOf(), ip: nextIp(), body: '{"songKey":"r","title":"T","score":{"measures":[{}],"notes":[],"x":"a\\u0000b"}}' });
    ok('written as the JSON escape \\u0000 it is the same 422', nulRaw.status === 422, nulRaw.status + '');
    const nul80 = [];
    for (let i = 0; i < 80; i++) nul80.push((await nulIn('score', '198.51.200.1')).status);
    ok('80 NUL requests from one address: 60 answered 422, then the failure budget says 429', nul80.slice(0, 60).every(x => x === 422) && nul80.slice(60).every(x => x === 429), nul80.filter((x, i) => i === 0 || nul80[i - 1] !== x).join(' then '));
    const burst = await Promise.all(Array.from({ length: 250 }, (_, i) => nulIn('score', '198.51.' + (201 + Math.floor(i / 200)) + '.' + (i % 200))));
    const afterBurst = await post(P, secretOf(), { songKey: 'after-burst', title: 'An honest guest', score: smallScore() }, '198.51.210.1');
    ok('250 NUL requests at once (from 250 addresses) are all 422, and an honest guest is still served (the server-wide budget is untouched)', burst.every(r => r.status === 422) && afterBurst.status === 201, burst.filter(r => r.status !== 422).length + ' not 422; honest ' + afterBurst.status);
    const nestN = n => { let a = []; for (let i = 0; i < n; i++) a = [a]; return a; };
    const d40 = await post(P, secretOf(), { songKey: 'd40', title: 'T', score: smallScore('D', { x: nestN(40) }) }, nextIp());
    const d65 = await post(P, secretOf(), { songKey: 'd65', title: 'T', score: smallScore('D', { x: nestN(65) }) }, nextIp());
    const d4753 = await req(P, 'POST', '/api/shares', { guest: secretOf(), ip: nextIp(), body: '{"songKey":"d4753","title":"T","score":{"measures":[{}],"notes":[],"x":' + '['.repeat(4753) + ']'.repeat(4753) + '}}' });
    ok('a score nested 40 deep is fine, 65 deep and 4753 deep are 422', d40.status === 201 && d65.status === 422 && d4753.status === 422, d40.status + '/' + d65.status + '/' + d4753.status);
    const gotDeep = await req(P, 'GET', '/api/shares/' + d40.body.id);
    ok('and the one that was kept reads back', gotDeep.status === 200);

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
    const filler = (n, bytes, owner) => ({
      id: 'fill' + String(n).padStart(8, '0'), ownerId: owner || ('g_' + ('f' + n).padStart(24, '0').slice(-24).replace(/[^0-9a-f]/g, '0')), ownerName: 'Guest', songKey: 'f', title: 'Filler', composer: '', genre: '',
      kind: '', measures: 2, listed: false, preview: null, score: smallScore(), bytes: bytes || 100,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
    });
    const keep = readRows(srv.dir);
    const guestsNow = keep.filter(r => G.isGuestOwner(r.ownerId)).length;
    const fill = [];
    for (let i = 0; i < G.GUEST.TOTAL_SHARES - guestsNow; i++) fill.push(filler(i));
    writeRows(srv.dir, keep.concat(fill));
    const full = await post(P, secretOf(), { songKey: 'full', title: 'One too many', score: smallScore() }, nextIp());
    ok('with 1000 guest links in all, a new one is refused: 503 with the code the app reads', full.status === 503 && /full/i.test(full.body.error) && full.body.code === 'guest-full', full.status + '');
    const upd2 = await post(P, C, { songKey: 'exp-live', title: 'Edited while full', score: smallScore() }, nextIp());
    ok('but a guest may still update a link they already have', upd2.status === 200, upd2.status + '');

    /* bytes: the old bug - fill the cap, then re-send tiny links at full size */
    const rowsBase = readRows(srv.dir).filter(r => !String(r.id).startsWith('fill'));
    writeRows(srv.dir, rowsBase);
    const E = secretOf();
    const tiny = [];
    for (let i = 0; i < 3; i++) tiny.push((await post(P, E, { songKey: 'tiny-' + i, title: 'Tiny ' + i, score: smallScore() }, nextIp())).body.id);
    const mineNow = readRows(srv.dir);
    const held = mineNow.filter(r => G.isGuestOwner(r.ownerId)).reduce((n, r) => n + (r.bytes != null ? r.bytes : 0), 0);
    const spare = 800 * 1024;
    writeRows(srv.dir, mineNow.concat([filler(1, G.GUEST.TOTAL_BYTES - held - spare)]));
    const growBig = (i, kb) => post(P, E, { songKey: 'tiny-' + i, title: 'Tiny ' + i, score: smallScore('Tiny', { pad: 'x'.repeat(kb * 1024) }) }, nextIp());
    const g1 = await growBig(0, 700);
    ok('there is room for one re-send that grows to 700 KB: 200', g1.status === 200, g1.status + '');
    const g2 = await growBig(1, 700);
    const g3 = await growBig(2, 700);
    ok('but the other two re-sends, which would pass 50 MB in all, are refused: 503 (a tiny link cannot be re-sent at full size past the cap)', g2.status === 503 && g3.status === 503, g2.status + '/' + g3.status);
    const heldAfter = readRows(srv.dir).filter(r => G.isGuestOwner(r.ownerId)).reduce((n, r) => n + r.bytes, 0);
    ok('the bytes held never passed the cap', heldAfter <= G.GUEST.TOTAL_BYTES, heldAfter + ' of ' + G.GUEST.TOTAL_BYTES);
    const shrink = await growBig(0, 1);
    ok('a re-send that shrinks is always welcome', shrink.status === 200, shrink.status + '');
    const withPrev = await post(P, E, { songKey: 'tiny-0', title: 'Tiny 0', score: smallScore('Tiny', { pad: 'x'.repeat(100 * 1024) }), preview: smallScore('P', { pad: 'y'.repeat(20 * 1024) }) }, nextIp());
    ok('a re-send with a preview counts the preview in its growth', withPrev.status === 200 && readRows(srv.dir).find(r => r.id === tiny[0]).bytes === G.rowBytes(smallScore('Tiny', { pad: 'x'.repeat(100 * 1024) }), smallScore('P', { pad: 'y'.repeat(20 * 1024) })));
    writeRows(srv.dir, rowsBase);
    const smallOk = await post(P, secretOf(), { songKey: 'bytes-ok', title: 'Small', score: smallScore() }, nextIp());
    ok('with the filler gone, a new link fits again', smallOk.status === 201, smallOk.status + '');

    console.log('\n── guests creating at the same moment cannot race the caps ──');
    writeRows(srv.dir, rowsBase);
    const F = secretOf();
    const parallel = await Promise.all(Array.from({ length: 30 }, (_, i) => post(P, F, { songKey: 'par-' + i, title: 'Par ' + i, score: smallScore() }, '100.64.1.' + i)));
    const made = parallel.filter(r => r.status === 201).length, refused = parallel.filter(r => r.status === 429).length;
    ok('30 at once with one key: exactly 20 made, 10 refused (429), none lost to an error', made === 20 && refused === 10, made + ' made, ' + refused + ' refused, others ' + parallel.map(r => r.status).filter(x => x !== 201 && x !== 429).join());
    ok('and the file holds exactly 20 for that browser', readRows(srv.dir).filter(r => r.ownerId === G.guestOwnerId(F)).length === 20);

    writeRows(srv.dir, rowsBase);
    const baseGuests = rowsBase.filter(r => G.isGuestOwner(r.ownerId)).length;
    const slots = 5;
    const fill2 = [];
    for (let i = 0; i < G.GUEST.TOTAL_SHARES - baseGuests - slots; i++) fill2.push(filler(i + 5000));
    writeRows(srv.dir, rowsBase.concat(fill2));
    const par2 = await Promise.all(Array.from({ length: 20 }, (_, i) => post(P, secretOf(), { songKey: 'cnt-' + i, title: 'Cnt ' + i, score: smallScore() }, '100.64.2.' + i)));
    ok('with 5 places left, 20 guests at once: exactly 5 get one, 15 are 503', par2.filter(r => r.status === 201).length === slots && par2.filter(r => r.status === 503).length === 20 - slots, par2.map(r => r.status).join());
    ok('and the count never passed 1000', readRows(srv.dir).filter(r => G.isGuestOwner(r.ownerId)).length === G.GUEST.TOTAL_SHARES);

    writeRows(srv.dir, rowsBase);
    const heldBase = rowsBase.filter(r => G.isGuestOwner(r.ownerId)).reduce((n, r) => n + (r.bytes || 0), 0);
    const one = G.rowBytes(smallScore('B', { pad: 'z'.repeat(300 * 1024) }), null);
    const roomFor = 3;
    writeRows(srv.dir, rowsBase.concat([filler(9, G.GUEST.TOTAL_BYTES - heldBase - roomFor * one - 1000)]));
    const par3 = await Promise.all(Array.from({ length: 12 }, (_, i) => post(P, secretOf(), { songKey: 'byt-' + i, title: 'B', score: smallScore('B', { pad: 'z'.repeat(300 * 1024) }) }, '100.64.3.' + i)));
    ok('with room for 3 big links, 12 at once: exactly 3 are made and 9 are 503', par3.filter(r => r.status === 201).length === roomFor && par3.filter(r => r.status === 503).length === 12 - roomFor, par3.map(r => r.status).join());
    ok('and the bytes never passed 50 MB', readRows(srv.dir).filter(r => G.isGuestOwner(r.ownerId)).reduce((n, r) => n + (r.bytes != null ? r.bytes : 0), 0) <= G.GUEST.TOTAL_BYTES);
    writeRows(srv.dir, rowsBase);

    const same = secretOf();
    const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => post(P, same, { songKey: 'same-song', title: 'Same ' + i, score: smallScore() }, '100.64.4.' + i)));
    ok('10 at once for the same song: one row, answers 200/201 only (never a 500), one link', racers.every(r => r.status === 200 || r.status === 201) && racers.filter(r => r.status === 201).length === 1 && new Set(racers.map(r => r.body.id)).size === 1
      && readRows(srv.dir).filter(r => r.ownerId === G.guestOwnerId(same)).length === 1, racers.map(r => r.status).join());

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
    const accRace = await Promise.all(Array.from({ length: 8 }, (_, i) => U('POST', '/api/shares', { songKey: 'u-race', title: 'Race ' + i, score: smallScore('Race') })));
    ok('an account sending the same song 8 times at once: only 200/201 and one link', accRace.every(r => r.status === 200 || r.status === 201) && new Set(accRace.map(r => r.body.id)).size === 1, accRace.map(r => r.status).join());
    const accNul = await U('POST', '/api/shares', { songKey: 'u-nul', title: 'T', score: smallScore('N', { lyric: 'a' + String.fromCharCode(0) + 'b' }) });
    const accDeep = await U('POST', '/api/shares', { songKey: 'u-deep', title: 'T', score: smallScore('N', { x: nestN(65) }) });
    ok('an account\'s NUL is a 422 (it was a 500), and so is a score nested 65 deep', accNul.status === 422 && accDeep.status === 422, accNul.status + '/' + accDeep.status);
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

/* ---------- behind a proxy, the whole-server budget, the sweep at start ---------- */
async function proxies() {
  const mk = (n, extra) => Object.assign({ songKey: 'px-' + n, title: 'Px ' + n, score: smallScore() }, extra || {});

  console.log('\n── the right hop, from the right ──');
  let srv = await server({ PPP_PROXY_HOPS: '2' });
  try {
    const out = [];
    for (let i = 0; i < 32; i++) out.push((await post(srv.port, secretOf(), mk(i), 'spoof' + i + ', 192.0.2.40, 10.9.9.' + i)).status);
    ok('with PPP_PROXY_HOPS=2 the address is the second from the right: 30 pass, then 429, whatever the other entries say', out.slice(0, 30).every(x => x === 201) && out[30] === 429 && out[31] === 429, out.join(' '));
    ok('another address in that place has its own budget', (await post(srv.port, secretOf(), mk('o'), 'spoof, 192.0.2.41, 10.9.9.1')).status === 201);
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── on Render: the edge\'s own headers ──');
  srv = await server({ RENDER: 'true' });
  try {
    const viaCf = [];
    for (let i = 0; i < 32; i++) viaCf.push((await req(srv.port, 'POST', '/api/shares', { guest: secretOf(), ip: 'made-up-' + i + ', 10.0.0.' + i, headers: { 'CF-Connecting-IP': '192.0.2.60', 'True-Client-IP': '203.0.113.' + (100 + i) }, body: mk('c' + i) })).status);
    ok('CF-Connecting-IP names the client, ahead of True-Client-IP and X-Forwarded-For: 30 pass, then 429', viaCf.slice(0, 30).every(x => x === 201) && viaCf[30] === 429 && viaCf[31] === 429, viaCf.join(' '));
    const viaTrue = [];
    for (let i = 0; i < 32; i++) viaTrue.push((await req(srv.port, 'POST', '/api/shares', { guest: secretOf(), ip: 'made-up-' + i, headers: { 'True-Client-IP': '192.0.2.50' }, body: mk(i) })).status);
    ok('without it, True-Client-IP does', viaTrue.slice(0, 30).every(x => x === 201) && viaTrue[30] === 429, viaTrue.join(' '));
    const other = await req(srv.port, 'POST', '/api/shares', { guest: secretOf(), ip: 'made-up-0', headers: { 'True-Client-IP': '192.0.2.51' }, body: mk('other') });
    ok('another client address is not held up', other.status === 201, other.status + '');
    const xffOnly = [];
    for (let i = 0; i < 31; i++) xffOnly.push((await post(srv.port, secretOf(), mk('x' + i), 'first-' + i + ', 192.0.2.70')).status);
    ok('with neither header on Render, the last X-Forwarded-For entry is used', xffOnly.slice(0, 30).every(x => x === 201) && xffOnly[30] === 429, xffOnly.join(' '));
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── the server-wide budget ──');
  srv = await server();
  try {
    const all = [];
    for (let i = 0; i < 201; i++) all.push((await post(srv.port, secretOf(), mk(i), '172.16.' + Math.floor(i / 100) + '.' + (i % 100))).status);
    ok('200 creates an hour from 200 addresses are fine, the 201st is 429', all.slice(0, 200).every(x => x === 201) && all[200] === 429, all.slice(195).join(' '));
    const keyed = secretOf();
    const one = await post(srv.port, keyed, mk('z'), '172.17.0.1');
    ok('and still 429 from a fresh address (it is the whole server\'s budget)', one.status === 429, one.status + '');
    const link = readRows(srv.dir).find(r => r.ownerId && r.ownerId.indexOf('g_') === 0);
    ok('reading a link and taking one down are not rationed', (await req(srv.port, 'GET', '/api/shares/' + link.id)).status === 200);
    ok('the table of addresses is bounded (the server holds at most 10000 per window)', G.GUEST.MAX_KEYS === 10000);
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── a store that fails: charged, and one line in the log ──');
  srv = await server(null, null, true);
  try {
    /* the shares file becomes a directory: every write to it fails, the way a full or broken disk would */
    await new Promise(r => setTimeout(r, 1500));
    fs.rmSync(sharesFile(srv.dir), { force: true });
    fs.mkdirSync(sharesFile(srv.dir));
    const answers = [];
    for (let i = 0; i < 75; i++) answers.push((await post(srv.port, secretOf(), mk('fail' + i), '198.51.100.9')).status);
    ok('a guest create that the store fails is 500, and the address is charged: 60 of them, then 429', answers.slice(0, 60).every(x => x === 500) && answers.slice(60).every(x => x === 429), answers.filter((x, i) => i === 0 || answers[i - 1] !== x).join(' then '));
    const others = [];
    for (let i = 0; i < 8; i++) others.push((await post(srv.port, secretOf(), mk('o' + i), '198.51.100.' + (20 + i))).status);
    ok('while another address is only told 500 (the server-wide budget was given back)', others.every(x => x === 500), others.join(' '));
    await new Promise(r => setTimeout(r, 300));
    const lines = srv.log.text.split('\n');
    const errLines = lines.filter(l => /Share store error/.test(l));
    ok('the log has at most 5 one-line store errors in a minute, and no stack traces', errLines.length >= 1 && errLines.length <= 5 && !lines.some(l => /^\s+at /.test(l)), errLines.length + ' lines');
    ok('the log says once where the client address came from, and how it is read at boot',
      lines.filter(l => /the first request named its client from x-forwarded-for/.test(l)).length === 1 && lines.some(l => /Guest links: the client address is read from X-Forwarded-For \(1 from the right\)/.test(l)));
    const accountAnswers = [];
    const su = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'store-fail-' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'Store Fail' }, ip: '198.51.100.99' });
    const cookie = (su.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    for (let i = 0; i < 3; i++) accountAnswers.push((await req(srv.port, 'POST', '/api/shares', { cookie: cookie, body: mk('acc' + i) })).status);
    ok('an account whose share the store fails is told 500 in one line too (no crash, no stack)', accountAnswers.every(x => x === 500) && !srv.log.text.split('\n').some(l => /^\s+at /.test(l)), accountAnswers.join(' '));
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── expired guest rows are swept when the server starts ──');
  const row = (id, owner, expires) => ({ id: id, ownerId: owner, ownerName: 'Guest', songKey: id, title: id, composer: '', genre: '', kind: '', measures: 2, listed: false,
    preview: null, score: smallScore(), bytes: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: expires });
  const gOwner = G.guestOwnerId(secretOf());
  srv = await server(null, [row('expired-start1', gOwner, new Date(Date.now() - 5000).toISOString()), row('live-at-start1', gOwner, new Date(Date.now() + 86400000).toISOString())]);
  try {
    const rows = readRows(srv.dir);
    ok('the expired row is gone before the first request, the live one stays', !rows.some(r => r.id === 'expired-start1') && rows.some(r => r.id === 'live-at-start1'));
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
}

main().then(proxies).then(() => {
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('A guest can send an unlisted link, take it back, and stay inside the limits; accounts are as they were.');
  process.exit(0);
}).catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
