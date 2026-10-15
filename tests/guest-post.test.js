/* G13 "no login anywhere": a visitor with no account can POST a score to the public Shared Scores, see their own posts, take one down, put it back,
   and delete it - with the guest key of their own browser as the only capability. This is the server half (the file store, no Postgres; tests/guest-post-pg.test.js
   is the Postgres twin, tests/guest-share.test.js the links this builds on). The real server.js is started on a free port with its own data directory and driven
   over HTTP. Every request names its client address with X-Forwarded-For, so each case has its own rate-limit bucket.

   What is held to: the pure rules first (the name, the end dates, the caps), then over HTTP - ownership isolation (a wrong key, another guest's key and no key
   are the same 403, byte for byte), the YouTube guard for a guest, the limits (per browser a day, per address a day, the site a day, posts held at once per
   browser, per address and in all, bytes of posts), a refusal that makes room by evicting nobody, the races, end dates, and that an account is not changed.
   Each limit has a mutant in tests/guest-post.mutants.js (a copy of the source with that one number or line changed: this suite has to fail).

   Run: node tests/guest-post.test.js   (PPP_SRC_DIR=<dir with server.js and share-guest.js> runs it against a mutant) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { freePort } = require('./serve-free');
const SRC = process.env.PPP_SRC_DIR ? path.resolve(process.env.PPP_SRC_DIR) : path.resolve(__dirname, '..');
const G = require(path.join(SRC, 'share-guest'));
const homeJobs = require(path.join(SRC, 'home-jobs'));

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const DAY = 24 * 3600 * 1000;

/* ---------- the pure rules ---------- */
function rules() {
  console.log('\n── the rules: the name, the end dates, the caps ──');
  const GG = G.GUEST;
  /* GUEST_POST_NO_CONSTANTS=1 (the second pass of the mutation run) leaves this one out, so each number is found only by what it DOES in the tests below */
  if (!process.env.GUEST_POST_NO_CONSTANTS) ok('the limits are the ones named',
    GG.PER_GUEST_LISTED === 10 && GG.PER_ADDR_LISTED === 20 && GG.TOTAL_LISTED === 300 && GG.TOTAL_LISTED_BYTES === 24 * 1024 * 1024
    && GG.POST_PER_KEY_PER_DAY === 5 && GG.POST_PER_IP_PER_DAY === 10 && GG.POST_GLOBAL_PER_DAY === 150 && GG.TTL_LISTED_MS === 90 * DAY && GG.TTL_MS === 30 * DAY
    && GG.MAX_BYTES === 1024 * 1024 && GG.NAME_MAX === 24);
  const T0 = Date.parse('2026-10-01T00:00:00Z');
  ok('a link ends in 30 days, a post in 90', Date.parse(G.expiryFor(T0)) - T0 === 30 * DAY && Date.parse(G.expiryFor(T0, false)) - T0 === 30 * DAY && Date.parse(G.expiryFor(T0, true)) - T0 === 90 * DAY);
  ok('no name is "Guest"; a name is trimmed, collapsed and kept', G.guestName(undefined) === 'Guest' && G.guestName('') === 'Guest' && G.guestName('   ') === 'Guest' && G.guestName('  Pat   Pianist ') === 'Pat Pianist');
  ok('Korean, Japanese, Chinese and accents are names', G.guestName('김피아노') === '김피아노' && G.guestName('ピアノさん') === 'ピアノさん' && G.guestName('钢琴') === '钢琴' && G.guestName('José') === 'José');
  ok('a name is cut to 24 characters by code point (no pair is split)', Array.from(G.guestName('가'.repeat(40))).length === 24 && G.guestName('😀'.repeat(30)) === '😀'.repeat(24));
  ok('control and bidi-override characters are dropped', G.guestName('A‮B\u0007C​D') === 'A B C D' && !/[‮\u0007​]/.test(G.guestName('x‮y')));
  ok('the site\'s own name is not a guest\'s, wherever it stands ("PPP Library", "ppp admin", "The PPP team", "Pppfan")',
    G.guestName('PPP Library') === 'Guest' && G.guestName('ppp admin') === 'Guest' && G.guestName('PPP') === 'Guest' && G.guestName('The PPP team') === 'Guest' && G.guestName('Pppfan') === 'Guest');
  ok('an address or a contact is not a name', ['me@example.com', 'https://x.example', 'www.foo.org', 'see foo.com', 'kim@naver'].every(n => G.guestName(n) === 'Guest'));

  const none = { ownerListed: 0, addrListed: 0, totalListed: 0, totalListedBytes: 0 };
  const dec = (prev, listing, bytes) => G.decide(prev, 0, { count: 5, bytes: 1000 }, bytes == null ? 1000 : bytes, listing);
  ok('a post under every cap is allowed; not listing asks nothing of the post caps', dec(null, none) === null && dec(null, null) === null
    && G.decide(null, 0, { count: 5, bytes: 1000 }, 1000, undefined) === null);
  const own = dec(null, Object.assign({}, none, { ownerListed: 10 }));
  ok('the 11th post of one browser is 429 too-many-posts', own && own.status === 429 && own.code === 'too-many-posts' && /Take one down/.test(own.error), JSON.stringify(own));
  ok('the 10th is allowed', dec(null, Object.assign({}, none, { ownerListed: 9 })) === null);
  const addr = dec(null, Object.assign({}, none, { addrListed: 20 }));
  ok('the 21st post from one address is 429 too-many-posts', addr && addr.status === 429 && addr.code === 'too-many-posts' && dec(null, Object.assign({}, none, { addrListed: 19 })) === null, JSON.stringify(addr));
  const tot = dec(null, Object.assign({}, none, { totalListed: 300 }));
  ok('the 301st post of the site is 503 busy (refused, not made room for)', tot && tot.status === 503 && tot.code === 'busy' && dec(null, Object.assign({}, none, { totalListed: 299 })) === null, JSON.stringify(tot));
  const big = dec(null, Object.assign({}, none, { totalListedBytes: GG.TOTAL_LISTED_BYTES - 500 }), 1000);
  ok('the bytes of all posts are capped (503 busy), counted with the new one', big && big.status === 503 && big.code === 'busy'
    && dec(null, Object.assign({}, none, { totalListedBytes: GG.TOTAL_LISTED_BYTES - 1000 }), 1000) === null, JSON.stringify(big));
  ok('a post that is re-sent is not a new post (no count is asked), only its growth in bytes',
    G.decide({ listed: true, bytes: 500 }, 1, { count: 5, bytes: 1000 }, 600, { ownerListed: 10, addrListed: 20, totalListed: 300, totalListedBytes: GG.TOTAL_LISTED_BYTES - 100 }) === null
    && G.decide({ listed: true, bytes: 500 }, 1, { count: 5, bytes: 1000 }, 700, { ownerListed: 10, addrListed: 20, totalListed: 300, totalListedBytes: GG.TOTAL_LISTED_BYTES - 100 }).status === 503);
  ok('a link put into the list is a new post', G.decide({ listed: false, bytes: 500 }, 1, { count: 5, bytes: 1000 }, 500, Object.assign({}, none, { ownerListed: 10 })).status === 429);
  ok('the older caps still come first (20 rows a browser, 1000 rows, 50 MB)', G.decide(null, 20, { count: 20, bytes: 0 }, 1, none).status === 429
    && G.decide(null, 0, { count: 1000, bytes: 0 }, 1, none).code === 'guest-full');
}

/* ---------- the server ---------- */
function req(port, method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body == null ? null : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
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
    r.on('error', err => { if (opts.tolerateReset) resolve({ status: 'reset', body: null, text: '', headers: {} }); else reject(err); });
    r.end(body);
  });
}
const smallScore = (title, extra) => Object.assign({ title: title || 'Guest song', composer: 'Someone', tempo: 100, measures: [{ n: 1 }, { n: 2 }], notes: [{ m: 1, b: 1, midi: 60, dur: 1 }] }, extra || {});
const secretOf = () => crypto.randomBytes(32).toString('hex');
let ipN = 0;
const nextIp = () => '203.0.' + Math.floor(++ipN / 250) + '.' + (ipN % 250 + 1);
/* a POST into the public list, or (listed false/omitted) a link */
const postAs = (port, key, o, ip) => req(port, 'POST', '/api/shares', { guest: key, ip: ip || nextIp(), body: Object.assign({ songKey: 'sk-' + crypto.randomBytes(5).toString('hex'), title: 'A post', score: smallScore('A post') }, o) });

async function server(extraEnv, preRows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-guest-post-'));
  const port = await freePort();
  if (preRows) fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: preRows }));
  const env = Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, DATABASE_URL: '', SESSION_SECRET: 'guest-post-test-secret' });
  delete env.RENDER; delete env.PPP_PROXY_HOPS;
  const child = spawn(process.execPath, ['server.js'], { cwd: SRC, stdio: 'ignore', env: Object.assign(env, extraEnv || {}) });
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
const isGuestRow = r => G.isGuestOwner(r.ownerId);
/* the tag the server makes of an address (the keyed hash of its /48), computed from the test's own secret: the tests read it back from the file instead of trusting this */
const filler = (n, o) => Object.assign({
  id: 'fp' + String(n).padStart(9, '0'), ownerId: 'g_' + crypto.createHash('sha256').update('filler-' + n).digest('hex').slice(0, 24), ownerName: 'Guest', songKey: 'f' + n, title: 'Filler ' + n,
  composer: '', genre: '', kind: '', measures: 2, listed: true, preview: null, score: smallScore('Filler'), bytes: 100, addrTag: 'fffff' + String(n % 1000).padStart(3, '0') + 'aaaaaaaa',
  createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - n * 1000).toISOString(), expiresAt: new Date(Date.now() + 40 * DAY).toISOString()
}, o || {});

async function main() {
  rules();
  const srv = await server();
  const P = srv.port;
  try {
    console.log('\n── a guest posts a score ──');
    const A = secretOf(), ipA = nextIp();
    const c = await postAs(P, A, { songKey: 'moon', title: 'Moonlight', composer: 'Beethoven', listed: true, displayName: 'Pat Pianist', genre: 'Classical' }, ipA);
    ok('201, listed, in the guest\'s own name, with an end date 90 days out', c.status === 201 && c.body.listed === true && c.body.owner === 'Pat Pianist'
      && Math.abs(Date.parse(c.body.expiresAt) - (Date.now() + 90 * DAY)) < 120000, c.status + ' ' + JSON.stringify(c.body).slice(0, 160));
    const id = c.body.id;
    ok('it is marked mine and guest, with its link; the genre is not the guest\'s to set', c.body.mine === true && c.body.guest === true && c.body.url === '/?share=' + id && c.body.genre === '');
    ok('the answer carries neither the key, the owner id nor the address tag', c.text.indexOf(A) < 0 && c.text.indexOf('g_') < 0 && !('ownerId' in c.body) && !('addrTag' in c.body));
    const row = readRows(srv.dir).find(r => r.id === id);
    ok('stored: owner g_<24 hex of sha256(key)>, listed, an address tag of 16 hex, the end date, bytes counted',
      row.ownerId === G.guestOwnerId(A) && row.listed === true && /^[0-9a-f]{16}$/.test(row.addrTag) && Date.parse(row.expiresAt) > Date.now() + 89 * DAY && row.bytes === G.rowBytes(row.score, row.preview));
    ok('the address itself, and the key, are nowhere in the data directory', !fs.readdirSync(srv.dir).some(f => { const t = fs.readFileSync(path.join(srv.dir, f), 'utf8'); return t.indexOf(A) > -1 || t.indexOf(ipA) > -1; }));
    const tag = row.addrTag;
    ok('the tag is the keyed hash of the address\'s /48 and the same address gives the same tag', (() => {
      const k = crypto.createHmac('sha256', 'guest-post-test-secret').update('ppp-guest-post-address').digest();
      return tag === crypto.createHmac('sha256', k).update(homeJobs.addrKey(ipA)).digest('hex').slice(0, 16);
    })());

    console.log('\n── everybody sees it; the owner sees it as theirs ──');
    const pub = await req(P, 'GET', '/api/shares');
    const card = pub.body.shares.find(s => s.id === id);
    ok('it is in the public list, as somebody else\'s, with the guest mark', !!card && card.mine === false && card.guest === true && card.owner === 'Pat Pianist' && card.songKey === undefined);
    const search = await req(P, 'GET', '/api/shares?q=Moonlight');
    ok('and in a search by title, and by the name the guest gave', search.body.shares.some(s => s.id === id) && (await req(P, 'GET', '/api/shares?q=Pat%20Pianist')).body.shares.some(s => s.id === id));
    const mine = await req(P, 'GET', '/api/shares?mine=1', { guest: A });
    ok('"mine" with the key lists it, as theirs, with its song key', mine.status === 200 && mine.body.shares.length === 1 && mine.body.shares[0].id === id && mine.body.shares[0].mine === true && mine.body.shares[0].songKey === 'moon');
    const mineOther = await req(P, 'GET', '/api/shares?mine=1', { guest: secretOf() });
    ok('"mine" with another key lists nothing of theirs', mineOther.status === 200 && mineOther.body.shares.length === 0);
    const opened = await req(P, 'GET', '/api/shares/' + id);
    ok('it opens by its link for anyone', opened.status === 200 && opened.body.score && opened.body.mine === false && opened.body.guest === true);
    /* a mutant copy (tests/guest-post.mutants.js) holds the server's modules only, not the page */
    if (fs.existsSync(path.join(SRC, 'Piano Coach App.dc.html'))) ok('its link page asks search engines not to index it', /noindex/.test((await req(P, 'GET', '/?share=' + id)).text));

    console.log('\n── nobody else can change it: a wrong key, no key and another guest are the same 403 ──');
    const B = secretOf();
    const forbid = async (method, body, key) => req(P, method, '/api/shares/' + id, { guest: key, body: body, ip: nextIp() });
    const p1 = await forbid('PATCH', { listed: false }, null);
    const p2 = await forbid('PATCH', { listed: false }, B);
    const p3 = await forbid('PATCH', { listed: false }, A.slice(0, -1) + (A.slice(-1) === 'a' ? 'b' : 'a'));
    const p4 = await forbid('PATCH', { listed: false }, 'short');
    ok('PATCH: no key, another guest\'s key, a key one character off, and a bad key are all 403',
      [p1, p2, p3, p4].every(r => r.status === 403), [p1, p2, p3, p4].map(r => r.status).join());
    ok('and the answers are the same bytes (nothing tells a wrong key from a missing one)', p1.text === p2.text && p2.text === p3.text && p3.text === p4.text, p1.text);
    const d1 = await forbid('DELETE', null, null), d2 = await forbid('DELETE', null, B);
    ok('DELETE by no key or by another guest is the same 403', d1.status === 403 && d2.status === 403 && d1.text === d2.text && d1.text === p1.text);
    ok('it is still listed, still the guest\'s', (await req(P, 'GET', '/api/shares')).body.shares.some(s => s.id === id) && readRows(srv.dir).find(r => r.id === id).ownerId === G.guestOwnerId(A));
    const accEmail = 'guest-post-' + Date.now() + '@example.com';
    const su = await req(P, 'POST', '/api/auth/signup', { body: { email: accEmail, password: 'practice-ok', displayName: 'Real User' }, ip: nextIp() });
    const cookie = (su.headers['set-cookie'] || []).map(c2 => c2.split(';')[0]).join('; ');
    const pa = await req(P, 'PATCH', '/api/shares/' + id, { cookie: cookie, body: { listed: false } });
    ok('an account cannot change a guest\'s post either (without the key)', su.status === 201 && pa.status === 403 && pa.text === p1.text);
    ok('the key is read from a header only: in a URL or a body it is nothing', (await req(P, 'PATCH', '/api/shares/' + id + '?guest=' + A, { body: { listed: false, guest: A, key: A } })).status === 403
      && (await req(P, 'GET', '/api/shares?mine=1&guest=' + A)).status === 401);

    console.log('\n── the owner takes it down, puts it back, deletes it ──');
    const down = await req(P, 'PATCH', '/api/shares/' + id, { guest: A, body: { listed: false } });
    ok('PATCH listed:false by the key: 200, unlisted, gone from the public list, still opens by link, the address tag is cleared',
      down.status === 200 && down.body.listed === false && !(await req(P, 'GET', '/api/shares')).body.shares.some(s => s.id === id)
      && (await req(P, 'GET', '/api/shares/' + id)).status === 200 && !readRows(srv.dir).find(r => r.id === id).addrTag, down.status + '');
    const mineDown = await req(P, 'GET', '/api/shares?mine=1', { guest: A });
    ok('and "mine" still lists it, as a link only', mineDown.body.shares.length === 1 && mineDown.body.shares[0].listed === false);
    const up = await req(P, 'PATCH', '/api/shares/' + id, { guest: A, body: { listed: true }, ip: ipA });
    ok('PATCH listed:true puts it back: 200, listed, in the list, tagged again, 90 days from now',
      up.status === 200 && up.body.listed === true && (await req(P, 'GET', '/api/shares')).body.shares.some(s => s.id === id)
      && readRows(srv.dir).find(r => r.id === id).addrTag === tag && Math.abs(Date.parse(up.body.expiresAt) - (Date.now() + 90 * DAY)) < 120000, up.status + '');
    const same = await req(P, 'PATCH', '/api/shares/' + id, { guest: A, body: { listed: true }, ip: ipA });
    ok('PATCH listed:true on a post that is listed changes nothing and is not charged', same.status === 200 && same.body.listed === true);
    const wrongBody = await req(P, 'PATCH', '/api/shares/' + id, { guest: A, body: { listed: 'yes' } });
    ok('a body that is not a boolean is 422', wrongBody.status === 422);
    const resend = await postAs(P, A, { songKey: 'moon', title: 'Moonlight (edited)', score: smallScore('Moonlight (edited)') }, ipA);
    ok('sending the song again with `listed` left out keeps it posted: 200, same id, new title, still listed', resend.status === 200 && resend.body.id === id && resend.body.listed === true && resend.body.title === 'Moonlight (edited)');
    const asLink = await postAs(P, A, { songKey: 'moon', title: 'Moonlight', listed: false, score: smallScore('Moonlight') }, ipA);
    ok('`listed:false` takes it out of the list (the same row and link), and the name goes back to Guest', asLink.status === 200 && asLink.body.id === id && asLink.body.listed === false && asLink.body.owner === 'Guest');
    ok('a re-send as a link ends in 30 days, not 90', Math.abs(Date.parse(asLink.body.expiresAt) - (Date.now() + 30 * DAY)) < 120000);
    const del = await req(P, 'DELETE', '/api/shares/' + id, { guest: A });
    ok('DELETE by the key: 200, the link is 404, and the row is gone from the file', del.status === 200 && (await req(P, 'GET', '/api/shares/' + id)).status === 404 && !readRows(srv.dir).some(r => r.id === id));
    ok('taking it down twice is a 404, like any share that is gone', (await req(P, 'DELETE', '/api/shares/' + id, { guest: A })).status === 404);

    console.log('\n── the YouTube guard holds for a guest ──');
    const yt1 = await postAs(P, A, { listed: true, youtubeDerived: true });
    ok('listed:true with the flag: 403 youtube-not-public, nothing stored', yt1.status === 403 && yt1.body.code === 'youtube-not-public' && !readRows(srv.dir).some(r => r.songKey && r.id === (yt1.body || {}).id));
    const yt2 = await postAs(P, A, { listed: true, score: smallScore('X', { source: { kind: 'shared', youtubeDerived: true } }) });
    ok('the mark inside the score is read: 403', yt2.status === 403 && yt2.body.code === 'youtube-not-public');
    const ytLink = await postAs(P, A, { songKey: 'yt-link', youtubeDerived: true, score: smallScore('Y', { source: { kind: 'youtube', youtubeDerived: true } }) });
    ok('the same song as a link (listed left out) is made: 201, unlisted', ytLink.status === 201 && ytLink.body.listed === false);
    const ytPatch = await req(P, 'PATCH', '/api/shares/' + ytLink.body.id, { guest: A, body: { listed: true }, ip: nextIp() });
    ok('putting that link into the list afterwards is refused too, and charged nothing', ytPatch.status === 403 && ytPatch.body.code === 'youtube-not-public');
    ok('a link of it is not in the public list', !(await req(P, 'GET', '/api/shares')).body.shares.some(s => s.id === ytLink.body.id));

    console.log('\n── a name is a label, not a trust ──');
    const names = [['PPP Library', 'Guest'], ['me@example.com', 'Guest'], ['  Min   Ji  ', 'Min Ji'], ['', 'Guest']];
    const got = [];
    for (const [typed] of names) got.push((await postAs(P, secretOf(), { listed: true, displayName: typed })).body.owner);
    ok('"PPP Library", an address, a padded name and an empty one', got.join('|') === names.map(n => n[1]).join('|'), got.join('|'));
    const asNumber = await postAs(P, secretOf(), { listed: true, displayName: { a: 1 } });
    ok('a name that is not text is Guest, not an error', asNumber.status === 201 && asNumber.body.owner === 'Guest');
    ok('the library\'s own seeds are not touched by any of it', (await req(P, 'GET', '/api/shares')).body.shares.some(s => s.owner === 'PPP Library'));

    console.log('\n── how many posts one browser may make in a day: 5 ──');
    const K = secretOf();
    const perKey = [];
    for (let i = 0; i < 7; i++) perKey.push(await postAs(P, K, { listed: true }, nextIp()));
    ok('5 are made (201), the 6th and 7th are 429 too-many-posts', perKey.slice(0, 5).every(r => r.status === 201) && perKey[5].status === 429 && perKey[6].status === 429
      && perKey[5].body.code === 'too-many-posts', perKey.map(r => r.status).join(' '));
    const asLink2 = await postAs(P, K, { listed: false }, nextIp());
    ok('a link is still made (a link is not a post)', asLink2.status === 201 && asLink2.body.listed === false);
    const downK = await req(P, 'PATCH', '/api/shares/' + perKey[0].body.id, { guest: K, body: { listed: false } });
    ok('taking one down costs nothing and is always allowed', downK.status === 200 && downK.body.listed === false);
    const upK = await req(P, 'PATCH', '/api/shares/' + perKey[0].body.id, { guest: K, body: { listed: true }, ip: nextIp() });
    ok('putting it back the same day is the same post: 200, no new place of the day', upK.status === 200 && upK.body.listed === true, upK.status + '');
    const putLinkK = await req(P, 'PATCH', '/api/shares/' + asLink2.body.id, { guest: K, body: { listed: true }, ip: nextIp() });
    ok('but putting a link that was never listed into the list is a new post: refused today (429)', putLinkK.status === 429 && putLinkK.body.code === 'too-many-posts');
    ok('the refused ones left nothing posted', readRows(srv.dir).filter(r => r.ownerId === G.guestOwnerId(K) && r.listed).length === 5);

    console.log('\n── how many one address may post in a day: 10 ──');
    const ipX = '198.51.100.7';
    const perIp = [];
    for (let i = 0; i < 12; i++) perIp.push(await postAs(P, secretOf(), { listed: true }, ipX));
    ok('10 are made, the 11th and 12th are 429 (whatever key they carry)', perIp.slice(0, 10).every(r => r.status === 201) && perIp[10].status === 429 && perIp[11].status === 429, perIp.map(r => r.status).join(' '));
    const otherAddr = await postAs(P, secretOf(), { listed: true }, '198.51.100.8');
    ok('another address is not held up', otherAddr.status === 201);
    const spoofed = await postAs(P, secretOf(), { listed: true }, 'made-up-' + crypto.randomBytes(3).toString('hex') + ', ' + ipX);
    ok('a made-up first X-Forwarded-For entry does not name the client', spoofed.status === 429, String(spoofed.status));
    const linkFromX = await postAs(P, secretOf(), { listed: false }, ipX);
    ok('and a link from that address is still made (the hourly budget is another limit)', linkFromX.status === 201);

    console.log('\n── how many posts one browser holds at once: 10 (refused, nothing evicted) ──');
    const keyM = secretOf(), gM = G.guestOwnerId(keyM);
    const base = readRows(srv.dir);
    writeRows(srv.dir, base.concat(Array.from({ length: 10 }, (_, i) => filler(100 + i, { ownerId: gM, songKey: 'own' + i, addrTag: null }))));
    const over = await postAs(P, keyM, { listed: true });
    ok('the 11th is 429 too-many-posts: "take one down first"', over.status === 429 && over.body.code === 'too-many-posts' && /Take one down/.test(over.body.error), over.status + ' ' + JSON.stringify(over.body));
    ok('none of the 10 was evicted', readRows(srv.dir).filter(r => r.ownerId === gM && r.listed).length === 10);
    const asLinkM = await postAs(P, keyM, { listed: false });
    ok('a link is still made at 10 posts', asLinkM.status === 201);
    const putBack = await req(P, 'PATCH', '/api/shares/' + asLinkM.body.id, { guest: keyM, body: { listed: true }, ip: nextIp() });
    ok('so is not putting a link in the list: PATCH is the same 429', putBack.status === 429 && putBack.body.code === 'too-many-posts');
    const freeOne = await req(P, 'DELETE', '/api/shares/' + filler(100).id, { guest: keyM });
    const afterFree = await postAs(P, keyM, { listed: true });
    ok('taking one down makes room: the next post is made', freeOne.status === 200 && afterFree.status === 201, freeOne.status + '/' + afterFree.status);
    writeRows(srv.dir, base);

    console.log('\n── how many posts one address holds at once: 20 ──');
    const ipH = '192.0.2.200';
    const seed = await postAs(P, secretOf(), { listed: true }, ipH);
    const hTag = readRows(srv.dir).find(r => r.id === seed.body.id).addrTag;
    writeRows(srv.dir, readRows(srv.dir).concat(Array.from({ length: 19 }, (_, i) => filler(200 + i, { addrTag: hTag }))));
    const atCap = await postAs(P, secretOf(), { listed: true }, ipH);
    ok('with 20 posts from that address held, the next from it is 429 too-many-posts', atCap.status === 429 && atCap.body.code === 'too-many-posts', atCap.status + ' ' + JSON.stringify(atCap.body));
    ok('another address is not held (the count is the address\'s)', (await postAs(P, secretOf(), { listed: true }, '192.0.2.201')).status === 201);
    ok('a link from the full address is made', (await postAs(P, secretOf(), { listed: false }, ipH)).status === 201);
    writeRows(srv.dir, base);

    console.log('\n── the site\'s posts in all: 300, then 503 busy, and nobody is evicted ──');
    const fillers = Array.from({ length: 300 }, (_, i) => filler(1000 + i));
    writeRows(srv.dir, base.concat(fillers));
    const heldBefore = readRows(srv.dir).filter(r => r.listed && isGuestRow(r)).length;
    const full = await postAs(P, secretOf(), { listed: true });
    ok('the 301st is 503 with the code busy and a plain reason', full.status === 503 && full.body.code === 'busy' && /no room/.test(full.body.error) && heldBefore >= 300, full.status + ' ' + JSON.stringify(full.body));
    ok('nothing was evicted to make room: every guest row is still there', readRows(srv.dir).filter(r => r.listed && isGuestRow(r)).length === heldBefore);
    const keyL = secretOf();
    const linkFull = await postAs(P, keyL, { listed: false });
    ok('a link is still made while the list is full', linkFull.status === 201 && linkFull.body.listed === false);
    const putFull = await req(P, 'PATCH', '/api/shares/' + linkFull.body.id, { guest: keyL, body: { listed: true }, ip: nextIp() });
    ok('putting a link into the full list is the same 503 busy', putFull.status === 503 && putFull.body.code === 'busy', putFull.status + ' ' + JSON.stringify(putFull.body));
    const stillLink = await req(P, 'GET', '/api/shares?mine=1', { guest: keyL });
    ok('and it stays a link', stillLink.body.shares.length === 1 && stillLink.body.shares[0].listed === false);
    const resendFull = await postAs(P, secretOf(), { songKey: 'seed-resend', listed: false }, nextIp());
    ok('and an account\'s post is not a guest post: not counted, not refused', await (async () => {
      const r = await req(P, 'POST', '/api/shares', { cookie: cookie, ip: nextIp(), body: { songKey: 'acc-1', title: 'Account song', listed: true, score: smallScore('Acc') } });
      return r.status === 201 && r.body.listed === true && r.body.guest === undefined;
    })() && resendFull.status === 201);
    /* a refusal gives the day's places back: this key asked 6 times while full and can still post when there is room */
    const keyR = secretOf();
    const refused = [];
    for (let i = 0; i < 7; i++) refused.push((await postAs(P, keyR, { listed: true }, '198.18.5.5')).status);
    writeRows(srv.dir, base);
    const roomNow = await postAs(P, keyR, { listed: true }, '198.18.5.5');
    ok('a refused post costs no place of the day: 7 refusals (503), then, with room, 201', refused.every(s => s === 503) && roomNow.status === 201, refused.join(' ') + ' then ' + roomNow.status);

    console.log('\n── the bytes of all posts: 24 MB ──');
    const heavy = filler(2000, { bytes: G.GUEST.TOTAL_LISTED_BYTES - 5000 });
    writeRows(srv.dir, base.concat([heavy]));
    const tooHeavy = await postAs(P, secretOf(), { listed: true, score: smallScore('Heavy', { pad: 'x'.repeat(8000) }) });
    ok('a post that would pass 24 MB in all is 503 busy', tooHeavy.status === 503 && tooHeavy.body.code === 'busy', tooHeavy.status + '');
    const lightOk = await postAs(P, secretOf(), { listed: true });
    ok('a small one still fits', lightOk.status === 201, lightOk.status + '');
    const noEvict = readRows(srv.dir).some(r => r.id === heavy.id);
    ok('and the big row is still there', noEvict);
    writeRows(srv.dir, base);

    console.log('\n── the body: 1 MB, and what is not a score ──');
    const bigBody = n => JSON.stringify({ songKey: 'big', title: 'Big', listed: true, score: smallScore('Big', { pad: 'x'.repeat(n) }) });
    const tooBig = await req(P, 'POST', '/api/shares', { guest: secretOf(), ip: nextIp(), tolerateReset: true, body: bigBody(1024 * 1024 + 10) });
    ok('over 1 MB is 413', tooBig.status === 413, String(tooBig.status));
    const notScore = await postAs(P, secretOf(), { listed: true, score: { measures: [], notes: [] } });
    ok('not a score is 422', notScore.status === 422);
    const nul = await postAs(P, secretOf(), { listed: true, title: 'T' + String.fromCharCode(0) });
    ok('a NUL is 422, not 500', nul.status === 422);
    const bigOne = await postAs(P, secretOf(), { listed: true, score: smallScore('Nearly', { pad: 'x'.repeat(900 * 1024) }) });
    ok('900 KB is fine', bigOne.status === 201);

    console.log('\n── end dates ──');
    const kE = secretOf(), gE = G.guestOwnerId(kE);
    const live = await postAs(P, kE, { listed: true, songKey: 'e-live' });
    const rowsE = readRows(srv.dir);
    const stale = Object.assign({}, rowsE.find(r => r.id === live.body.id), { id: 'gone000000001', songKey: 'e-old', title: 'Old post', genre: 'Expired', expiresAt: new Date(Date.now() - 1000).toISOString() });
    writeRows(srv.dir, rowsE.concat([stale]));
    const listAfter = await req(P, 'GET', '/api/shares?limit=100');
    ok('a post past its end date is in no list at once, though nothing has swept it', !listAfter.body.shares.some(s => s.id === stale.id) && listAfter.body.shares.some(s => s.id === live.body.id));
    ok('not in "mine" either, and its link is 404', !(await req(P, 'GET', '/api/shares?mine=1', { guest: kE })).body.shares.some(s => s.id === stale.id) && (await req(P, 'GET', '/api/shares/' + stale.id)).status === 404);
    ok('its owner cannot put it back: 404', (await req(P, 'PATCH', '/api/shares/' + stale.id, { guest: kE, body: { listed: true } })).status === 404);
    ok('the genre chips do not count it', !(await req(P, 'GET', '/api/shares')).body.genres.includes('Expired'));

    console.log('\n── posts made at the same moment cannot race the caps ──');
    const have = readRows(srv.dir).filter(r => r.listed && isGuestRow(r)).length;
    const slots = 5;
    writeRows(srv.dir, readRows(srv.dir).filter(r => r.id !== stale.id).concat(Array.from({ length: G.GUEST.TOTAL_LISTED - have + 1 - slots }, (_, i) => filler(3000 + i))));
    const heldNow = readRows(srv.dir).filter(r => r.listed && isGuestRow(r)).length;
    const par = await Promise.all(Array.from({ length: 20 }, (_, i) => postAs(P, secretOf(), { listed: true }, '100.64.' + (i + 1) + '.1')));
    ok('with ' + (G.GUEST.TOTAL_LISTED - heldNow) + ' places left, 20 at once: exactly that many are made, the rest 503 busy',
      par.filter(r => r.status === 201).length === G.GUEST.TOTAL_LISTED - heldNow && par.filter(r => r.status === 503).length === 20 - (G.GUEST.TOTAL_LISTED - heldNow), par.map(r => r.status).join());
    ok('and the count never passed 300 (the site\'s own: there may be older rows over it)', readRows(srv.dir).filter(r => r.listed && isGuestRow(r)).length <= Math.max(heldNow, G.GUEST.TOTAL_LISTED));
    writeRows(srv.dir, base);
    const same2 = secretOf();
    const racers = await Promise.all(Array.from({ length: 5 }, (_, i) => postAs(P, same2, { songKey: 'one-song', title: 'Same ' + i, listed: true }, '100.65.' + (i + 1) + '.1')));
    ok('5 at once for the same song: one row, answers 200/201 only, one link', racers.every(r => r.status === 200 || r.status === 201) && new Set(racers.map(r => r.body.id)).size === 1
      && readRows(srv.dir).filter(r => r.ownerId === G.guestOwnerId(same2)).length === 1, racers.map(r => r.status).join());
    ok('(they were ONE post: the day still has four places for four new posts, and the fifth is refused)', await (async () => {
      for (let i = 0; i < 4; i++) { const r = await postAs(P, same2, { songKey: 'more-' + i, title: 'more', listed: true }, nextIp()); if (r.status !== 201) return false; }
      return (await postAs(P, same2, { songKey: 'more-x', title: 'more', listed: true }, nextIp())).status === 429;
    })());

    console.log('\n── an account is not changed ──');
    const U = (method, p, body) => req(P, method, p, { cookie: cookie, body: body, ip: nextIp() });
    const accPost = await U('POST', '/api/shares', { songKey: 'u1', title: 'Account song', genre: 'Classical', listed: true, score: smallScore('Account song') });
    ok('signed in: 201, listed, genre kept, no end date, not marked guest', accPost.status === 201 && accPost.body.listed === true && accPost.body.genre === 'Classical' && accPost.body.expiresAt === undefined && accPost.body.guest === undefined);
    const accMine = await U('GET', '/api/shares?mine=1');
    ok('"mine" of an account lists the account\'s shares', accMine.status === 200 && accMine.body.shares.some(s => s.id === accPost.body.id));
    const both = await req(P, 'GET', '/api/shares?mine=1', { cookie: cookie, guest: A });
    ok('with a session and a guest key, "mine" is both (a person who signed in later still sees their guest posts)', both.status === 200 && both.body.shares.some(s => s.id === accPost.body.id));
    const accDown = await U('PATCH', '/api/shares/' + accPost.body.id, { listed: false });
    ok('an account PATCHes its own as before', accDown.status === 200 && accDown.body.listed === false);
    const accYt = await U('POST', '/api/shares', { songKey: 'u-yt', title: 'YT', listed: true, youtubeDerived: true, score: smallScore('YT') });
    ok('and the guard still refuses it', accYt.status === 403 && accYt.body.code === 'youtube-not-public');
    const rowsAll = readRows(srv.dir);
    ok('in the file: every guest row has an end date; every listed one has an address tag, every unlisted one none; an account row has neither',
      rowsAll.filter(isGuestRow).every(r => !!r.expiresAt && (r.listed ? !!r.addrTag : !r.addrTag)) && rowsAll.filter(r => !isGuestRow(r)).every(r => !r.expiresAt && !r.addrTag));

    console.log('\n── the read-only admin look lists tags, not content ──');
    const keyZ = secretOf();
    await postAs(P, keyZ, { listed: true, title: 'ADMIN-SECRET-TITLE-QQQ', composer: 'ADMIN-SECRET-COMPOSER', displayName: 'ADMIN-SECRET-NAME' }, '100.66.0.1');
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [path.join(SRC, 'tools', 'shares-admin', 'list.js'), '--data-dir', srv.dir], { encoding: 'utf8' });
    const gZ = G.guestOwnerId(keyZ).replace(/^g_/, '').slice(0, 8);
    ok('it names the key tag and the address tag of a post, the totals against the caps, and says read-only',
      out.indexOf(gZ) > -1 && /read-only/.test(out) && /of 300 allowed/.test(out) && /busiest address tags/.test(out), out.split('\n').slice(0, 4).join(' | '));
    ok('and prints no title, composer, name, key or score', !/ADMIN-SECRET/.test(out) && out.indexOf(keyZ) < 0 && !/"measures"|"notes"/.test(out));
    const asJson = JSON.parse(execFileSync(process.execPath, [path.join(SRC, 'tools', 'shares-admin', 'list.js'), '--data-dir', srv.dir, '--json'], { encoding: 'utf8' }));
    ok('--json has the same: rows with tags and sizes only', asJson.readOnly === true && asJson.rows.length >= 1 && asJson.rows.every(r => Object.keys(r).sort().join() === 'addrTag,bars,bytes,created,expires,id,keyTag,listed,updated'));
    const before = fs.readFileSync(sharesFile(srv.dir), 'utf8');
    execFileSync(process.execPath, [path.join(SRC, 'tools', 'shares-admin', 'list.js'), '--data-dir', srv.dir, '--all'], { encoding: 'utf8' });
    ok('it changes nothing', fs.readFileSync(sharesFile(srv.dir), 'utf8') === before);
    let refused2 = false;
    try { execFileSync(process.execPath, [path.join(SRC, 'tools', 'shares-admin', 'list.js'), '--db-url', 'postgres://u:p@db.example.net/ppp'], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { refused2 = e.status === 2 && /refusing/.test(String(e.stderr)) && !/u:p/.test(String(e.stderr)); }
    ok('it refuses a database that is not on this machine unless told, and never prints the URL', refused2);
  } finally {
    await srv.close();
    try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  }

  console.log('\n── how many posts the whole site takes in a day: 150 ──');
  const srv3 = await server();
  try {
    const made = [];
    const k0 = secretOf();
    let firstId = null;
    for (let i = 0; i < 150; i++) {
      const r = await postAs(srv3.port, i === 0 ? k0 : secretOf(), { listed: true }, '172.20.' + Math.floor(i / 50) + '.' + (i % 50 + 1));
      if (i === 0) firstId = r.body.id;
      made.push(r.status);
    }
    const sixtyFirst = await postAs(srv3.port, secretOf(), { listed: true }, '172.21.0.1');
    ok('150 posts from 150 browsers and addresses are made; the 151st is 503 busy', made.every(s => s === 201) && sixtyFirst.status === 503 && sixtyFirst.body.code === 'busy', made.filter(s => s !== 201).join(',') + ' / ' + sixtyFirst.status);
    ok('a link is still made', (await postAs(srv3.port, secretOf(), { listed: false }, '172.21.0.2')).status === 201);
    const downSite = await req(srv3.port, 'PATCH', '/api/shares/' + firstId, { guest: k0, body: { listed: false } });
    ok('and taking one down is not refused', downSite.status === 200 && downSite.body.listed === false);
  } finally { await srv3.close(); try { fs.rmSync(srv3.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── the owner\'s switch: PPP_GUEST_POSTS=0 ──');
  const srv4 = await server({ PPP_GUEST_POSTS: '0' });
  try {
    const k4 = secretOf();
    const off = await postAs(srv4.port, k4, { listed: true });
    ok('a guest post is refused with the plain busy answer (503 busy)', off.status === 503 && off.body.code === 'busy', off.status + '');
    const link4 = await postAs(srv4.port, k4, { listed: false });
    ok('a link is still made', link4.status === 201 && link4.body.listed === false);
    const put4 = await req(srv4.port, 'PATCH', '/api/shares/' + link4.body.id, { guest: k4, body: { listed: true }, ip: nextIp() });
    ok('putting a link into the list is refused too; taking down is not', put4.status === 503 && (await req(srv4.port, 'PATCH', '/api/shares/' + link4.body.id, { guest: k4, body: { listed: false } })).status === 200);
    const su4 = await req(srv4.port, 'POST', '/api/auth/signup', { body: { email: 'sw-' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'Switch' }, ip: nextIp() });
    const c4 = (su4.headers['set-cookie'] || []).map(c2 => c2.split(';')[0]).join('; ');
    ok('an account may still post', (await req(srv4.port, 'POST', '/api/shares', { cookie: c4, ip: nextIp(), body: { songKey: 'sw1', title: 'Account', listed: true, score: smallScore('A') } })).status === 201);
  } finally { await srv4.close(); try { fs.rmSync(srv4.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── a restart does not lose a post, and the sweep takes the ended ones ──');
  const gOwner = G.guestOwnerId(secretOf());
  const old = filler(5000, { ownerId: gOwner, expiresAt: new Date(Date.now() - 5000).toISOString() });
  const keep = filler(5001, { ownerId: gOwner, expiresAt: new Date(Date.now() + 5 * DAY).toISOString() });
  const srv2 = await server(null, [old, keep]);
  try {
    const rows = readRows(srv2.dir);
    ok('at start the ended post is swept and the live one stays, listed', !rows.some(r => r.id === old.id) && rows.some(r => r.id === keep.id && r.listed));
    ok('and the live one is in the list', (await req(srv2.port, 'GET', '/api/shares?limit=100')).body.shares.some(s => s.id === keep.id));
  } finally { await srv2.close(); try { fs.rmSync(srv2.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
}


/* ---------- the review of PR 275: a preview is drawn by every viewer's engraver; the address is the /48; text is cleaned; the names; the messages ---------- */
const PREVIEWS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guest-previews.json'), 'utf8'));
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* what the page's engraver may be given (the invariants, written down here independently of the rebuilding code) */
function unsafePreview(p) {
  const why = [];
  if (!isObj(p)) return ['not an object'];
  if (![1, 2, 3, 4].includes(p.staves)) why.push('staves ' + JSON.stringify(p.staves));
  if (!Array.isArray(p.measures) || p.measures.length < 1 || p.measures.length > 4) why.push('measures');
  if (!Array.isArray(p.notes) || p.notes.length > 400) why.push('notes');
  const nums = new Set((p.measures || []).map(m => m.number));
  (p.notes || []).forEach((n, i) => {
    if (!Number.isInteger(n.staff) || n.staff < 1 || n.staff > 4) why.push('note ' + i + ' staff ' + n.staff);
    if (!Number.isInteger(n.voice) || n.voice < 1 || n.voice > 8) why.push('note ' + i + ' voice ' + n.voice);
    if (!Number.isInteger(n.dots) || n.dots < 0 || n.dots > 4) why.push('note ' + i + ' dots ' + n.dots);
    if (!nums.has(n.m)) why.push('note ' + i + ' bar ' + n.m);
  });
  (p.measures || []).forEach((m, i) => {
    if (!isObj(m.time) || !Number.isInteger(m.time.beats) || m.time.beats < 1 || m.time.beats > 32) why.push('measure ' + i + ' beats');
    if (m.lenQ !== undefined && !(m.lenQ > 0 && m.lenQ <= 32)) why.push('measure ' + i + ' lenQ');
  });
  const walk = (v, d, where) => {
    if (d > 8) { why.push('deep at ' + where); return; }
    if (typeof v === 'number' && !(Number.isFinite(v) && Math.abs(v) <= 1000)) why.push('number ' + v + ' at ' + where);
    if (typeof v === 'string' && (v.length > 400 || /[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(v))) why.push('string at ' + where);
    if (Array.isArray(v)) { if (v.length > 400) why.push('array ' + v.length + ' at ' + where); v.forEach((x, i) => walk(x, d + 1, where + '[' + i + ']')); }
    else if (isObj(v)) { if (Object.keys(v).length > 60) why.push('keys at ' + where); Object.keys(v).forEach(k => { if (k === '__proto__') why.push('__proto__ at ' + where); walk(v[k], d + 1, where + '.' + k); }); }
  };
  walk(p, 0, '$');
  return why;
}
/* the page's own copy of the rebuilding (thumbSafe, between the markers), run here to be held to the same answers as the server's */
function pageThumbSafe() {
  const html = fs.readFileSync(process.env.PPP_PAGE_FILE || path.join(path.resolve(__dirname, '..'), 'Piano Coach App.dc.html'), 'utf8');
  const a = html.indexOf('/* thumb-safe:begin */'), b = html.indexOf('/* thumb-safe:end */');
  if (a < 0 || b < a) return null;
  const T = new Function('class T {\n' + html.slice(a, b) + '\n}\nreturn T;')();
  return new T();
}
function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* a random preview that is wrong in one or two places: the values are the ones that hang or bloat a drawing */
function mutated(rand) {
  const names = Object.keys(PREVIEWS);
  const p = JSON.parse(JSON.stringify(PREVIEWS[names[Math.floor(rand() * names.length)]]));
  const pool = [0, -1, 1, 2, 3, 4, 5, 8, 100, 1e6, 1e9, -1e9, 0.5, 1e-9, null, true, false, '', 'abc', '1000000', '\u202e', 'x'.repeat(5000), {}, [], [1, 2, 3], { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } },
    Array.from({ length: 700 }, (_, i) => ({ m: 1, b: i % 4, dur: 1, staff: 1, voice: 1, midi: 60 })), 1e300, -1e300];
  const paths = [];
  const collect = (v, pre, d) => { if (d > 3 || v === null || typeof v !== 'object') return; Object.keys(v).slice(0, 12).forEach(k => { paths.push(pre.concat(k)); collect(v[k], pre.concat(k), d + 1); }); };
  collect(p, [], 0);
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const at = paths[Math.floor(rand() * paths.length)];
    let o = p;
    for (let j = 0; j < at.length - 1; j++) { if (o && typeof o === 'object') o = o[at[j]]; }
    const val = pool[Math.floor(rand() * pool.length)];
    if (o && typeof o === 'object') o[at[at.length - 1]] = JSON.parse(JSON.stringify(val === undefined ? null : val));
  }
  if (rand() < 0.15) p['__proto__x'] = 1;
  return p;
}

async function hardening() {
  console.log('\n── a preview is rebuilt: what the engraver is given is bounded (the staves 1e6 post that hung every viewer) ──');
  const base = PREVIEWS['prelude-fragment'];
  const same = x => JSON.stringify(x);
  ok('a real preview of a real score is returned unchanged, for each sample (marks, chords, a 3-staff vocal part)', Object.keys(PREVIEWS).every(k => same(G.normalizePreview(PREVIEWS[k], 4)) === same(PREVIEWS[k]) || (() => { try { require('assert').deepStrictEqual(G.normalizePreview(PREVIEWS[k], 4), PREVIEWS[k]); return true; } catch (e) { return false; } })()));
  ok('rebuilding is idempotent', Object.keys(PREVIEWS).every(k => { const o = G.normalizePreview(PREVIEWS[k], 4); try { require('assert').deepStrictEqual(G.normalizePreview(o, 4), o); return true; } catch (e) { return false; } }));
  const huge = JSON.parse(JSON.stringify(base));
  huge.notes = Array.from({ length: 1500 }, (_, i) => ({ m: 1, b: i % 4, dur: 1, staff: 1, voice: 1, dots: 0, midi: 60 }));
  huge.measures = Array.from({ length: 9 }, (_, i) => Object.assign({}, base.measures[0], { number: i + 1 }));
  huge.pedals = Array.from({ length: 500 }, () => ({ m: 1, b: 0, type: 'start', kind: 'damper' }));
  const hugeOut = G.normalizePreview(huge, 4);
  ok('caps: 4 bars, 400 notes, 64 events in a list (1500 notes, 9 bars and 500 pedals sent)', hugeOut.measures.length === 4 && hugeOut.notes.length === 400 && hugeOut.pedals.length === 64, hugeOut.measures.length + '/' + hugeOut.notes.length + '/' + hugeOut.pedals.length);
  ok('a 2-bar ask is 2 bars', G.normalizePreview(huge, 2).measures.length === 2);
  const staffy = JSON.parse(JSON.stringify(base)); staffy.staves = 1e6; staffy.notes[0].staff = 1e6; staffy.notes[1].voice = -5; staffy.notes[2].dots = 99;
  const so = G.normalizePreview(staffy, 4);
  ok('staves and staff are 1..4, voices 1..8, dots 0..4', so.staves === 4 && so.notes[0].staff === 4 && so.notes[1].voice === 1 && so.notes[2].dots === 4);
  const cases = [
    ['staves 1e6', p => { p.staves = 1e6; }], ['a note on staff 1e6', p => { p.notes[0].staff = 1e6; }], ['staves as a string "1000000"', p => { p.staves = '1000000'; }],
    ['voice 1e9', p => { p.notes[0].voice = 1e9; }], ['dots 1e6', p => { p.notes[0].dots = 1e6; }], ['time.beats 1e7', p => { p.measures[0].time.beats = 1e7; }],
    ['lenQ 1e9', p => { p.measures[0].lenQ = 1e9; }], ['dur 1e9', p => { p.notes[0].dur = 1e9; }], ['b 1e9', p => { p.notes[0].b = 1e9; }],
    ['1500 notes', p => { p.notes = Array.from({ length: 1500 },(_, i) => Object.assign({}, p.notes[0], { b: i % 4 })); }],
    ['9 bars', p => { p.measures = Array.from({ length: 9 }, (_, i) => Object.assign({}, p.measures[0], { number: i + 1 })); }],
    ['nested 40 deep', p => { let o = {}; for (let i = 0; i < 40; i++) o = { o: o }; p.marks = [{ m: 1, b: 0, x: o }]; }],
    ['NaN-like and Infinity-like numbers (as 1e999 in JSON text)', p => { p.tempo = 1e999; p.notes[0].midi = -1e999; }],
    ['control and bidi characters in every string', p => { p.title = 'T\u202eitle\u0007'; p.notes[0].p = 'C\u202e5'; p.chords = [{ m: 1, b: 0, text: 'G\u2066\u200b' }]; }]
  ];
  const K = secretOf();
  const srv = await server();
  const P = srv.port;
  try {
    for (const [name, f] of cases) {
      const p = JSON.parse(JSON.stringify(base));
      f(p);
      const raw = JSON.stringify({ songKey: 'pv-' + crypto.randomBytes(4).toString('hex'), title: 'Poison ' + name, listed: true, preview: p, score: smallScore('P') }).replace(/"tempo":null/, '"tempo":1e999');
      const r = await req(P, 'POST', '/api/shares', { guest: secretOf(), ip: nextIp(), body: raw });
      const stored = r.status === 201 ? readRows(srv.dir).find(x => x.id === r.body.id) : null;
      const bad = stored ? (stored.preview === null ? [] : unsafePreview(stored.preview)) : null;   /* null: too big once rebuilt, dropped as before */
      const listed = r.status === 201 ? ((await req(P, 'GET', '/api/shares?limit=100')).body.shares.find(s => s.id === r.body.id) || {}).preview : null;
      ok(name + ': stored rebuilt (or refused), and what the list hands out is safe', (r.status === 422 || (r.status === 201 && stored && bad.length === 0 && (listed === null || unsafePreview(listed).length === 0))),
        r.status + ' ' + (bad ? bad.slice(0, 3).join('; ') : '') + ' ' + (listed ? unsafePreview(listed).slice(0, 2).join('; ') : ''));
    }
    const notPreview = [['a string', 'x'], ['an empty object', {}], ['no bars', { measures: [], notes: [] }], ['bars that are not objects', { measures: [1, 2], notes: [] }], ['an array', []]];
    for (const [name, v] of notPreview) {
      const r = await postAs(P, secretOf(), { listed: true, preview: v });
      ok('a preview that is ' + name + ' is 422, nothing stored', r.status === 422 && !readRows(srv.dir).some(x => x.id === (r.body || {}).id));
    }
    const su = await req(P, 'POST', '/api/auth/signup', { body: { email: 'pv-' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'Pv' }, ip: nextIp() });
    const cookieA = (su.headers['set-cookie'] || []).map(c2 => c2.split(';')[0]).join('; ');
    const accBig = await req(P, 'POST', '/api/shares', { cookie: cookieA, ip: nextIp(), body: { songKey: 'acc-big', title: 'Account big preview', listed: true, score: smallScore('A'), preview: huge } });
    const accRow = accBig.status === 201 ? readRows(srv.dir).find(x => x.id === accBig.body.id) : null;
    ok('an account\'s preview is rebuilt too: 1500 notes and 9 bars sent, 400 notes and 4 bars kept, safe', !!accRow && accRow.preview && accRow.preview.notes.length === 400 && accRow.preview.measures.length === 4 && unsafePreview(accRow.preview).length === 0, accBig.status + '');
    const noPreview = await postAs(P, secretOf(), { listed: true });
    ok('and no preview at all is fine: 201, preview null', noPreview.status === 201 && readRows(srv.dir).find(x => x.id === noPreview.body.id).preview === null);

    console.log('\n── a row stored before the rules (poisoned in the file) is handed out rebuilt ──');
    const poisonOwner = G.guestOwnerId(secretOf());
    const poisonRow = (id, mut) => {
      const p = JSON.parse(JSON.stringify(base)); mut(p);
      return { id: id, ownerId: poisonOwner, ownerName: 'Evil\u202eName', songKey: id, title: 'Old\u202etitle', composer: 'Co\u0007mp', genre: '', kind: '', measures: 2, listed: true, preview: p,
        score: smallScore('Old'), bytes: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 40 * DAY).toISOString() };
    };
    writeRows(srv.dir, readRows(srv.dir).concat([poisonRow('poison0000001', p => { p.staves = 1e6; }), poisonRow('poison0000002', p => { p.notes[0].staff = 1e6; }), poisonRow('poison0000003', p => { p.staves = '1000000'; })]));
    const list = await req(P, 'GET', '/api/shares?limit=100');
    const poisoned = list.body.shares.filter(s => /^poison/.test(s.id));
    ok('the three poisoned rows are in the list, and each preview is safe', poisoned.length === 3 && poisoned.every(s => unsafePreview(s.preview).length === 0), poisoned.map(s => unsafePreview(s.preview).join(',')).join(' | '));
    ok('their title, composer and owner are cleaned on the way out', poisoned.every(s => !/[\u202e\u0007]/.test(s.title + s.composer + s.owner)) && poisoned[0].title === 'Old title', poisoned[0].title + ' / ' + poisoned[0].owner);
    const one = await req(P, 'GET', '/api/shares/poison0000001');
    ok('the link of a poisoned row hands out a safe preview too', unsafePreview(one.body.preview).length === 0);

    console.log('\n── titles, composers and names carry no control or bidi character ──');
    const t = await postAs(P, secretOf(), { listed: true, title: 'Moon\u202elight\u0007', composer: 'Bee\u200bthoven\u2066', displayName: 'Pa\u202et', kind: 'x\u0007y' });
    const trow = readRows(srv.dir).find(x => x.id === t.body.id);
    ok('stored cleaned (title, composer, name, kind)', t.status === 201 && trow.title === 'Moon light' && trow.composer === 'Bee thoven' && trow.ownerName === 'Pa t' && !/[\u0000-\u001f\u202e]/.test(trow.kind), JSON.stringify([trow.title, trow.composer, trow.ownerName, trow.kind]));
    const t2 = await postAs(P, secretOf(), { listed: true, score: smallScore('Inner\u202etitle', { composer: 'In\u0007ner' }) });
    ok('and the score\'s own title and composer too', !/[\u202e\u0007]/.test(JSON.stringify(readRows(srv.dir).find(x => x.id === t2.body.id).score)));
    const t3 = await postAs(P, secretOf(), { listed: false, score: smallScore('Staves', { staves: 1e6, notes: [{ m: 1, b: 1, midi: 60, dur: 1, staff: 1e6 }, { m: 1, b: 2, midi: 62, dur: 1, staff: -3 }, { m: 1, b: 3, midi: 64, dur: 1, staff: 2 }] }) });
    const sc3 = readRows(srv.dir).find(x => x.id === t3.body.id).score;
    ok('a whole score is stored with its staves and every staff bounded (1..8): 1e6 and -3 are neutralised, 2 is left', t3.status === 201 && sc3.staves === 8 && sc3.notes.map(n => n.staff).join() === '8,1,2', JSON.stringify([sc3.staves, sc3.notes.map(n => n.staff)]));

    console.log('\n── the address is the /48: a new /64 or a new key is not a new place ──');
    const v6 = [];
    for (let i = 0; i < 12; i++) v6.push(await postAs(P, secretOf(), { listed: true }, '2001:db8:abcd:' + (i + 1).toString(16) + '::' + (i + 7).toString(16)));
    ok('10 posts from one /48 (12 different /64s, 12 different keys) are made; the 11th and 12th are 429', v6.slice(0, 10).every(r => r.status === 201) && v6[10].status === 429 && v6[11].status === 429, v6.map(r => r.status).join(' '));
    const tagOf = id => readRows(srv.dir).find(x => x.id === id).addrTag;
    const tagsSame = new Set(v6.slice(0, 10).map(r => tagOf(r.body.id)));
    const other48 = await postAs(P, secretOf(), { listed: true }, '2001:db8:abce:1::1');
    ok('all ten carry one address tag; another /48 has another and is not held up', tagsSame.size === 1 && other48.status === 201 && tagOf(other48.body.id) !== [...tagsSame][0]);
    const mapped = await postAs(P, secretOf(), { listed: true }, '::ffff:198.51.100.9');
    const plain4 = await postAs(P, secretOf(), { listed: true }, '198.51.100.9');
    ok('an IPv4-mapped address is the IPv4 (the same tag)', mapped.status === 201 && plain4.status === 201 && tagOf(mapped.body.id) === tagOf(plain4.body.id));
    const links = [];
    for (let i = 0; i < 32; i++) links.push((await postAs(P, secretOf(), { listed: false }, '2001:db8:1111:' + (i + 1).toString(16) + '::5')).status);
    ok('links: 30 an hour from one /48 (32 different /64s), the 31st and 32nd are 429', links.slice(0, 30).every(s => s === 201) && links[30] === 429 && links[31] === 429, links.join(' '));
    ok('and a guest at another address is served', (await postAs(P, secretOf(), { listed: false }, '2001:db8:2222::9')).status === 201);

    console.log('\n── a post put back the same day is one post; sending a posted score again asks nothing ──');
    const Kp = secretOf();
    const mine5 = [];
    for (let i = 0; i < 5; i++) mine5.push(await postAs(P, Kp, { listed: true }, '192.0.2.' + (50 + i)));
    ok('five posts are the day of a browser', mine5.every(r => r.status === 201));
    const down1 = await req(P, 'PATCH', '/api/shares/' + mine5[0].body.id, { guest: Kp, body: { listed: false } });
    const back1 = await req(P, 'PATCH', '/api/shares/' + mine5[0].body.id, { guest: Kp, body: { listed: true }, ip: '192.0.2.60' });
    ok('taken down and put back the same day: 200 (the same post, no new place)', down1.status === 200 && back1.status === 200 && back1.body.listed === true, back1.status + '');
    const again = await postAs(P, Kp, { songKey: mine5[1].body.songKey || 'x', listed: true, title: 'Again' }, '192.0.2.61');
    const rowOf = id => readRows(srv.dir).find(x => x.id === id);
    const sk = rowOf(mine5[2].body.id).songKey;
    const resend = await postAs(P, Kp, { songKey: sk, listed: true, title: 'Resent' }, '192.0.2.62');
    ok('a posted score sent again with listed:true is the same post: 200, no new place', resend.status === 200 && resend.body.id === mine5[2].body.id, resend.status + '');
    const linkResend = await postAs(P, Kp, { songKey: sk, title: 'Link again' }, '192.0.2.63');
    ok('and re-sent as a link (listed left out) it stays posted: 200', linkResend.status === 200 && linkResend.body.listed === true && linkResend.body.id === mine5[2].body.id);
    const sk3 = rowOf(mine5[3].body.id).songKey;
    await req(P, 'PATCH', '/api/shares/' + mine5[3].body.id, { guest: Kp, body: { listed: false } });
    const postBack = await postAs(P, Kp, { songKey: sk3, listed: true, title: 'Back by POST' }, '192.0.2.67');
    ok('a post taken down and sent again by POST the same day is the same post: 200 (no new place)', postBack.status === 200 && postBack.body.listed === true && postBack.body.id === mine5[3].body.id, postBack.status + '');
    const sixth = await postAs(P, Kp, { listed: true }, '192.0.2.64');
    ok('a sixth NEW post is still 429', sixth.status === 429 && sixth.body.code === 'too-many-posts', sixth.status + '');
    const lnk = await postAs(P, Kp, { listed: false }, '192.0.2.65');
    const putLink = await req(P, 'PATCH', '/api/shares/' + lnk.body.id, { guest: Kp, body: { listed: true }, ip: '192.0.2.66' });
    ok('and putting a link that was never listed into the list is a new post: 429', putLink.status === 429, putLink.status + '');
    void again;

    console.log('\n── putting links into the list is counted by the /48 too ──');
    const putters = [];
    for (let i = 0; i < 12; i++) {
      const kk = secretOf();
      const l = await postAs(P, kk, { listed: false }, '2001:db8:70' + (i % 10) + ':' + i + '::1');
      putters.push({ key: kk, id: l.body.id });
    }
    const puts = [];
    for (let i = 0; i < putters.length; i++) puts.push((await req(P, 'PATCH', '/api/shares/' + putters[i].id, { guest: putters[i].key, body: { listed: true }, ip: '2001:db8:beef:' + (i + 1).toString(16) + '::2' })).status);
    ok('12 links put into the list from 12 different /64s of one /48: 10 are 200, the rest 429', puts.slice(0, 10).every(s => s === 200) && puts[10] === 429 && puts[11] === 429, puts.join(' '));

    console.log('\n── a guest is not told to sign in ──');
    const said = [];
    const big = await req(P, 'POST', '/api/shares', { guest: secretOf(), ip: nextIp(), tolerateReset: true, body: JSON.stringify({ songKey: 'b', title: 'B', score: smallScore('B', { pad: 'x'.repeat(1024 * 1024 + 10) }) }) });
    said.push(big.text);
    said.push((await req(P, 'POST', '/api/shares', { ip: nextIp(), body: { songKey: 'n', title: 'N', score: smallScore() } })).text);
    said.push((await req(P, 'GET', '/api/shares?mine=1')).text);
    const Kf = secretOf();
    for (let i = 0; i < 21; i++) { const r = await postAs(P, Kf, { listed: false }, '203.1.' + (100 + Math.floor(i / 4)) + '.' + (i % 4 + 1)); if (r.status !== 201) said.push(r.text); }
    said.push(sixth.text, putLink.text, v6[10].text);
    ok('no refusal of the server (too big, no key, too many links, too many posts, day, address) says "sign in"', said.length >= 7 && said.every(s => !/sign in/i.test(s)), said.filter(s => /sign in/i.test(s)).join(' | ').slice(0, 200));
  } finally { await srv.close(); try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── the read-only look treats a host in the query string as a host ──');
  {
    const { execFileSync } = require('child_process');
    const tool = path.join(SRC, 'tools', 'shares-admin', 'list.js');
    const refused = url => { try { execFileSync(process.execPath, [tool, '--db-url', url], { encoding: 'utf8', stdio: 'pipe', timeout: 20000 }); return false; } catch (e) { return e.status === 2 && /refusing/.test(String(e.stderr)) && !/u:p/.test(String(e.stderr)); } };
    ok('postgres://u:p@localhost/ppp?host=db.example.net is remote', refused('postgres://u:p@localhost/ppp?host=db.example.net'));
    ok('postgres://u:p@localhost/ppp?hostaddr=203.0.113.5 is remote', refused('postgres://u:p@localhost/ppp?hostaddr=203.0.113.5'));
    ok('postgres://u:p@/ppp?host=localhost,db.example.net is remote (a list)', refused('postgres://u:p@/ppp?host=localhost,db.example.net'));
    ok('postgres://u:p@db.example.net/ppp is remote', refused('postgres://u:p@db.example.net/ppp'));
    const localFails = url => { try { execFileSync(process.execPath, [tool, '--db-url', url], { encoding: 'utf8', stdio: 'pipe', timeout: 20000 }); return false; } catch (e) { return !/refusing/.test(String(e.stderr)); } };
    ok('a local URL is not refused (it fails to connect, here, and says so)', localFails('postgres://u:p@127.0.0.1:1/ppp') && localFails('postgres://u:p@localhost:1/ppp?host=127.0.0.1'));
  }

  console.log('\n── the page and the server rebuild a preview the same way ──');
  const page = pageThumbSafe();
  ok('the page has thumbSafe between its markers', !!page && typeof page.thumbSafe === 'function');
  if (page) {
    const rand = prng(20261015);
    let differ = 0, unsafe = 0, firstBad = '';
    for (let i = 0; i < 1500; i++) {
      const p = mutated(rand);
      const a = G.normalizePreview(p, 4), b = page.thumbSafe(p, 4);
      if (JSON.stringify(a) !== JSON.stringify(b)) { differ++; if (!firstBad) firstBad = 'case ' + i; }
      if (a && unsafePreview(a).length) { unsafe++; if (!firstBad) firstBad = 'unsafe ' + i + ': ' + unsafePreview(a).slice(0, 2).join(','); }
      if (b && unsafePreview(b).length) { unsafe++; }
    }
    ok('1,500 random wrong previews: the page and the server give the same answer, and it is always safe', differ === 0 && unsafe === 0, differ + ' differ, ' + unsafe + ' unsafe ' + firstBad);
    const twoBars = G.normalizePreview(mutated(prng(7)), 2);
    ok('a preview asked for 2 bars has at most 2', !twoBars || twoBars.measures.length <= 2);
    const sc = page.scoreSafe({ staves: 1e6, notes: [{ staff: 1e6 }, { staff: -5 }, { staff: 'x' }] });
    ok('the page bounds the staves of a whole score before it is kept (1..8)', sc.staves === 8 && sc.notes.map(n => n.staff).join() === '8,1,1');
  }
  console.log('\n── names that pass for the site, and the unit rules of the review ──');
  const bad = ['The PPP team', 'Official PPP', 'PPP Library', 'ppp', 'p.p.p', 'P P P', 'ＰＰＰ', 'Р P P', 'ΡΡΡ', 'admin', 'Admin', 'Administrator', 'support', 'Support Team', 'moderator', 'staff', 'owner',
    '관리자', '운영자', '공식 계정', '管理员', '官方', '管理者', '運営', 'サポート', 'a\u0301\u0301\u0301\u0301\u0301dmin', 'ａｄｍｉｎ'];
  const failed = bad.filter(n => G.guestName(n) !== 'Guest');
  ok('every name that passes for the site, its owner or its staff is "Guest" (' + bad.length + ' tried: English, Korean, Chinese, Japanese, fullwidth, Cyrillic, Greek, spaced, zalgo)', failed.length === 0, failed.join(' | '));
  const fine = ['Alice', '김피아노', 'Mina Park', 'José', '田中', 'Piano Fan', 'Лена'];
  ok('ordinary names are kept', fine.every(n => G.guestName(n) === n), fine.filter(n => G.guestName(n) !== n).join(' | '));
  const zalgo = 'x' + '\u0301'.repeat(30);
  ok('a name of 30 combining marks is cut to two', Array.from(G.guestName(zalgo)).length <= 3, JSON.stringify(G.guestName(zalgo)));
  ok('cleanText takes the controls and bidi overrides out', G.cleanText('a\u202eb\u0007c\u200bd\u2066e', 40) === 'a b c d e' && G.cleanText('x'.repeat(500), 10).length === 10);
  const T0 = Date.parse('2026-10-01T00:00:00Z');
  ok('recentlyListed: a row listed within the day (end date > 89 days away) is, a link or a post of last week is not',
    G.recentlyListed({ expiresAt: G.expiryFor(T0 - 3600e3, true) }, T0) && !G.recentlyListed({ expiresAt: G.expiryFor(T0 - 2 * DAY, true) }, T0) && !G.recentlyListed({ expiresAt: G.expiryFor(T0, false) }, T0) && !G.recentlyListed(null, T0));

  console.log('\n── no secret on Render: guest posting is off by itself ──');
  const srv5 = await server({ RENDER: 'true', SESSION_SECRET: '' });
  try {
    const k5 = secretOf();
    const off = await req(srv5.port, 'POST', '/api/shares', { guest: k5, headers: {}, ip: nextIp(), body: { songKey: 'r1', title: 'R', listed: true, score: smallScore() } });
    ok('a guest post is 503 busy', off.status === 503 && off.body.code === 'busy', off.status + '');
    const lk = await req(srv5.port, 'POST', '/api/shares', { guest: k5, ip: nextIp(), body: { songKey: 'r2', title: 'R2', score: smallScore() } });
    ok('a link is still made', lk.status === 201);
  } finally { await srv5.close(); try { fs.rmSync(srv5.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }

  console.log('\n── PPP_GUEST_POSTS=0 does not stop a link re-send of a score that is already posted ──');
  const kq = secretOf();
  const posted = { id: 'seededpost01', ownerId: G.guestOwnerId(kq), ownerName: 'Guest', songKey: 'sx', title: 'Posted', composer: '', genre: '', kind: '', measures: 2, listed: true, preview: null, score: smallScore('Posted'),
    bytes: 100, addrTag: 'abcd1234abcd1234', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 80 * DAY).toISOString() };
  const srv6 = await server({ PPP_GUEST_POSTS: '0' }, [posted]);
  try {
    const re = await req(srv6.port, 'POST', '/api/shares', { guest: kq, ip: nextIp(), body: { songKey: 'sx', title: 'Posted again', score: smallScore('Posted again') } });
    ok('the link re-send is 200 and stays posted', re.status === 200 && re.body.listed === true && re.body.id === 'seededpost01', re.status + ' ' + JSON.stringify(re.body).slice(0, 80));
    const fresh = await req(srv6.port, 'POST', '/api/shares', { guest: kq, ip: nextIp(), body: { songKey: 'sy', title: 'New', listed: true, score: smallScore() } });
    ok('a NEW post is 503 busy under the switch', fresh.status === 503);
  } finally { await srv6.close(); try { fs.rmSync(srv6.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
}

main().then(hardening).then(() => {
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('A guest can post, see, take down, put back and delete their own scores in the public list, inside the limits; nobody else can; an account is as it was.');
  process.exit(0);
}).catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
