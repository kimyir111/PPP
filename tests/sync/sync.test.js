/* G13-S0: the song-library sync service (sync.js + sync-store.js) over real HTTP with the counting file store: who may ask, what a library holds and refuses, every limit of
   docs/GOALS/G13_PRODUCTIZATION.md 7.3 and 7.7, isolation between libraries, the keeping times, races, a store that fails. tests/sync/sync-abuse.test.js is the part that needs a
   child process with a small heap (amplification, floods, slow senders, zip bombs); tests/sync/sync-pg.test.js runs the same store on Postgres (and the migration).

   Run: node tests/sync/sync.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req, sleep } = L;
const MiB = L.MiB;
const ROW = 256;

const acct = it => Buffer.from(it.body, 'base64').length + ROW;
const SS = L.mod('sync-store.js');
const Sync = L.mod('sync.js');
const D = 24 * 3600 * 1000;
const codeOf = S => (n => S.code(n));
const bad = (r, status, code) => r.status === status && r.body && r.body.code === code;
const ownRows = async (S, n) => (await S.inner.changes(S.libId(n), 0, 100000));
const libRow = async (S, n) => (await S.inner.loadAll()).libs.find(l => l.id === S.libId(n));

async function main() {
  heading('the numbers of the design (docs/GOALS/G13_PRODUCTIZATION.md 7.3, 7.7, U2, U3)');
  {
    const Lm = Sync.LIMITS;
    ok('libraries: 5 an hour and 20 a day per address, 100 an hour for the site, 2,000 live', Lm.LIBS_PER_IP_PER_HOUR === 5 && Lm.LIBS_PER_IP_PER_DAY === 20 && Lm.LIBS_PER_HOUR === 100 && Lm.MAX_LIBS === 2000);
    ok('keeping: 180 days from the last sync, 14 for an empty library, 30 for a tombstone, 2 for a deleted library', Lm.KEEP_MS === 180 * D && Lm.EMPTY_KEEP_MS === 14 * D && Lm.TOMBSTONE_KEEP_MS === 30 * D && Lm.REVOKED_KEEP_MS === 2 * D);
    ok('items: 25 to a batch, 1 MB of gzip each, 8 MB when unpacked, 16 MB for the unpacked items of one request', Lm.KEYS_PER_BATCH === 25 && Lm.ITEM_GZIP_MAX === MiB && Lm.ITEM_INFLATED_MAX === 8 * MiB && Lm.REQUEST_INFLATED_MAX === 16 * MiB);
    ok('stored: 16 MB a library, 48 MB an address, 128 MB the site (the sync cap of U3), warned at 80 %', Lm.LIB_BYTES === 16 * MiB && Lm.ADDRESS_BYTES === 48 * MiB && Lm.TOTAL_BYTES === 128 * MiB && Lm.WARN_AT === 0.8);
    ok('rates: 240 items written an hour, 20 wrong codes an hour, 300 items read an hour, 5 code changes an hour', Lm.WRITES_PER_HOUR === 240 && Lm.BAD_CODES_PER_HOUR === 20 && Lm.READ_ITEMS_PER_HOUR === 300 && Lm.ROTATES_PER_HOUR === 5);
    ok('bytes: the site reads at most 150 MB a day; a library and an address use a quarter of each budget at most', Lm.EGRESS_PER_DAY === 150 * MiB && Lm.BUDGET_SHARE === 0.25);
    ok('a body has 60 s in all and 10 s without a byte; a request may be 6 MB; 8 bodies are received at once and 2 unpacked; 6 answers with bodies are made at once; an answer holds 6 MB of bodies; changes come 500 at a time',
      Lm.BODY_TOTAL_MS === 60000 && Lm.BODY_IDLE_MS === 10000 && Lm.PUT_BODY === 6 * MiB && Lm.PUTS_AT_ONCE === 8 && Lm.PROCESS_AT_ONCE === 2 && Lm.READS_AT_ONCE === 6 && Lm.READ_BODY_CAP === 6 * MiB && Lm.CHANGES_PAGE === 500);
    ok('rows: 3,000 to a library and 60,000 in all; requests that write: 120 an hour (480 for an address); deletions 60 an hour; changes that ask the database 120 an hour; code changes 20 an hour an address',
      Lm.LIB_ROWS === 3000 && Lm.SITE_ROWS === 60000 && Lm.WRITE_REQUESTS_PER_HOUR === 120 && Lm.WRITE_REQUESTS_PER_IP_PER_HOUR === 480 && Lm.DELETES_PER_HOUR === 60 && Lm.CHANGES_SQL_PER_HOUR === 120 && Lm.ROTATES_PER_IP_PER_HOUR === 20);
    ok('the library is touched in the database at most once a day; the purge runs at most every 6 hours', Lm.TOUCH_MS === D && Lm.PURGE_EVERY_MS === 6 * 3600 * 1000);
    ok('the code is 64 hex and its id is domain separated (a PC link\'s code of the same bytes is another library)', (() => {
      const n = Sync.newLibrary();
      const crypto = L.crypto;
      return /^[0-9a-f]{64}$/.test(n.code) && n.id === 'lib_' + crypto.createHash('sha256').update('ppp-lib-v1:' + n.code).digest('hex').slice(0, 22)
        && n.id !== 'pc_' + crypto.createHash('sha256').update('ppp-pc-link-v1:' + n.code).digest('hex').slice(0, 22);
    })());
  }

  heading('who may ask: the code, the origin, and what is counted');
  {
    const S = await L.startSync({ libs: ['a', 'b'] });
    try {
      const code = S.code('a');
      const p = '/api/sync/changes?since=0';
      let r = await S.anon.get(p);
      ok('no header: 401 no-lib', bad(r, 401, 'no-lib'), r.status + ' ' + r.text);
      ok('... and it is answered before a body is read: a PUT that announces 4 GB and sends nothing is 401 at once, not held', await (async () => {
        const t0 = Date.now();
        const x = await rawHead(S.port, 'PUT /api/sync/items HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 4000000000\r\n\r\n');
        return x.status === 401 && Date.now() - t0 < 2000;
      })());
      ok('... and the refusal closes the connection: the body that was announced is not read only to be thrown away', await (async () => {
        const x = await rawHead(S.port, 'PUT /api/sync/items HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 4000000000\r\n\r\n');
        return x.status === 401 && /\r\nconnection: close\r\n/i.test(x.text);
      })());
      ok('... and with a VALID code the same announcement is refused before a byte is read as well (413 too-large, connection closed)', await (async () => {
        const x = await rawHead(S.port, 'PUT /api/sync/items HTTP/1.1\r\nHost: x\r\nX-PPP-Lib: ' + code + '\r\nContent-Type: application/json\r\nContent-Length: 4000000000\r\n\r\n');
        return x.status === 413;
      })());
      for (const [name, o] of [
        ['a code in the query string', { }],
        ['a code in the body of a GET', { body: { code: code } }],
        ['a code as a cookie', { headers: { Cookie: 'x-ppp-lib=' + code + '; ppp_session=' + code } }],
        ['a bearer token', { headers: { Authorization: 'Bearer ' + code } }],
        ['a PC link\'s header (X-PPP-PC)', { headers: { 'X-PPP-PC': code } }],
        ['a guest key header', { headers: { 'X-PPP-Guest': code } }]
      ]) {
        const path = name === 'a code in the query string' ? p + '&code=' + code + '&lib=' + code : p;
        r = await S.anon.get(path, o);
        ok(name + ' is not a code: 401 no-lib', bad(r, 401, 'no-lib'), r.status + ' ' + r.text.slice(0, 80));
      }
      r = await S.as('a').changes(0);
      ok('the right code: 200', r.status === 200 && r.body.maxRev === 0);
      ok('no Access-Control header on any answer (CORS is closed), and no cookie is set', !Object.keys(r.headers).some(h => /^access-control-/i.test(h)) && !r.headers['set-cookie']);
      r = await L.req(S.port, 'OPTIONS', '/api/sync/changes', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-ppp-lib' } });
      ok('a preflight fails: no 2xx, no Access-Control-Allow-*', r.status >= 400 && !r.headers['access-control-allow-origin'], r.status + '');
      r = await S.as('a').changes(0, { headers: { Origin: 'https://evil.example' } });
      ok('an Origin that is not this site is 403 cross-site, even with a valid code', bad(r, 403, 'cross-site'), r.status + ' ' + r.text);
      r = await S.as('a').changes(0, { raw: '0'.repeat(64), headers: { Origin: 'https://evil.example' } });
      ok('... and 403 (not 401) with a wrong one: the origin is checked BEFORE the code is read', bad(r, 403, 'cross-site'));
      r = await S.as('a').changes(0, { headers: { Origin: 'null' } });
      ok('Origin: null is refused too', bad(r, 403, 'cross-site'));
      r = await S.as('a').changes(0, { headers: { Origin: 'http://127.0.0.1:' + S.port } });
      ok('this site\'s own Origin is let in', r.status === 200);
      r = await L.req(S.port, 'POST', '/api/libs', { body: {}, headers: { Origin: 'https://evil.example' } });
      ok('making a library from a page of another site is 403 too', bad(r, 403, 'cross-site'));
      r = await L.req(S.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': code, Origin: 'https://evil.example' }, body: { items: [] } });
      r = await L.req(S.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': code, Origin: 'https://evil.example' } });
      ok('and deleting one', bad(r, 403, 'cross-site'));
      ok('(and the library is still there)', (await S.as('a').changes(0)).status === 200);
      /* wrong codes: counted per address, failures only */
      const wrongs = [];
      for (let i = 0; i < 25; i++) wrongs.push((await S.as('a').changes(0, { raw: L.crypto.randomBytes(32).toString('hex'), ip: '203.0.113.9' })).status);
      ok('20 wrong codes an hour from one address are 401 bad-code, then 429 too-many', wrongs.slice(0, 20).every(s => s === 401) && wrongs.slice(20).every(s => s === 429), wrongs.join());
      ok('a VALID code from that address is not refused for it (failures only)', (await S.as('a').changes(0, { ip: '203.0.113.9' })).status === 200 && (await S.as('b').changes(0, { ip: '203.0.113.9' })).status === 200);
      ok('another address is not affected', (await S.as('a').changes(0, { raw: '1'.repeat(64), ip: '203.0.113.10' })).status === 401);
      S.advance(61 * 60 * 1000);
      ok('and an hour later the address is let try again', (await S.as('a').changes(0, { raw: '2'.repeat(64), ip: '203.0.113.9' })).status === 401);
      /* what counts as a code: exactly 64 lowercase hex */
      const shapes = { 'upper case': code.toUpperCase(), 'one short': code.slice(1), 'one long': code + '0', 'with dashes': code.replace(/(.{8})/g, '$1-'), 'with a space': code.slice(0, 32) + ' ' + code.slice(32), 'two codes': code + ', ' + code, 'a library id': S.libId('a') };
      for (const k of Object.keys(shapes)) {
        r = await S.as('a').changes(0, { raw: shapes[k], ip: '203.0.113.' + (50 + Object.keys(shapes).indexOf(k)) });
        ok('a code with ' + k + ' is not a code: 401 bad-code', bad(r, 401, 'bad-code'), r.status + ' ' + r.text.slice(0, 80));
      }
      ok('what a failure says does not tell a short code from an unknown one', (await S.as('a').changes(0, { raw: 'z', ip: '203.0.113.99' })).text === (await S.as('a').changes(0, { raw: '3'.repeat(64), ip: '203.0.113.99' })).text);
    } finally { await S.close(); }

    /* a record found by the id alone is not enough: the whole hash is compared */
    const S2 = await L.startSync({});
    try {
      const code = 'ab'.repeat(32);
      const id = Sync.libIdOf(Sync.codeHash(code));
      await S2.inner.createLib({ id: id, hash: 'cd'.repeat(32), createdAt: S2.clock.t, ipTag: '' }, 100);
      const r = await L.req(S2.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } });
      ok('a row whose id is the code\'s but whose stored hash is not: refused (the full hash is compared, not the id)', bad(r, 401, 'bad-code'), r.status + ' ' + r.text);
      await S2.inner.createLib({ id: Sync.libIdOf(Sync.codeHash('ef'.repeat(32))), hash: Sync.codeHash('ef'.repeat(32)).toString('hex'), createdAt: S2.clock.t, ipTag: '' }, 100);
      S2.svc._state.forgetAll();
      ok('... and a row that is right is let in', (await L.req(S2.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': 'ef'.repeat(32) } })).status === 200);
      ok('the code is stored as its hash (never the code), and the hash is of the domain-separated string', (await S2.inner.loadAll()).libs.every(l => l.hash !== 'ef'.repeat(32) && /^[0-9a-f]{64}$/.test(l.hash)));
    } finally { await S2.close(); }
  }

  heading('making libraries: per address, per day, per site, and the cap');
  {
    const S = await L.startSync({ memory: true });
    try {
      const mk = ip => S.anon.post('/api/libs', {}, { ip: ip });
      const st = [];
      for (let i = 0; i < 7; i++) st.push((await mk('198.51.100.7')).status);
      ok('5 an hour from one address; the 6th and 7th are 429 too-many', st.join() === '201,201,201,201,201,429,429', st.join());
      let r = await mk('198.51.100.7');
      ok('the answer says when to come back (Retry-After) and why', r.status === 429 && r.body.code === 'too-many' && +r.headers['retry-after'] >= 60, JSON.stringify(r.headers['retry-after']));
      ok('another address is not affected', (await mk('198.51.100.8')).status === 201);
      S.advance(61 * 60 * 1000);
      ok('an hour later the address may make 5 more', (await mk('198.51.100.7')).status === 201);
      /* the day: 20 */
      const S2 = await L.startSync({ memory: true });
      try {
        let made = 0;
        for (let h = 0; h < 4; h++) { for (let i = 0; i < 5; i++) if ((await S2.anon.post('/api/libs', {}, { ip: '2001:db8:1:2:3:4:5:6' })).status === 201) made++; S2.advance(61 * 60 * 1000); }
        r = await S2.anon.post('/api/libs', {}, { ip: '2001:db8:1:2:3:4:5:6' });
        ok('20 in 4 hours, then the 21st is 429 although the hour is clear (the day: 20)', made === 20 && r.status === 429, made + ' ' + r.status);
        r = await S2.anon.post('/api/libs', {}, { ip: '2001:db8:1:ffff:0:0:0:1' });
        ok('an IPv6 address counts as its /48: another address of the same /48 is the same address', r.status === 429);
        r = await S2.anon.post('/api/libs', {}, { ip: '2001:db8:2:1::1' });
        ok('... and another /48 is another address', r.status === 201);
        S2.advance(24 * 3600 * 1000);
        ok('after a day it may make more', (await S2.anon.post('/api/libs', {}, { ip: '2001:db8:1:2:3:4:5:6' })).status === 201);
        const five = [];
        for (let i = 0; i < 5; i++) five.push((await S2.anon.post('/api/libs', {}, { ip: '198.51.100.200' })).status);
        r = await S2.anon.post('/api/libs', {}, { ip: '::ffff:198.51.100.200' });
        ok('an IPv4-mapped IPv6 address is the IPv4 one: five from 198.51.100.200, the sixth as ::ffff:198.51.100.200 is 429', five.every(s => s === 201) && r.status === 429, five.join() + ' ' + r.status);
      } finally { await S2.close(); }
      /* the site: 100 an hour */
      const S3 = await L.startSync({ memory: true });
      try {
        const codes = [];
        for (let i = 0; i < 100; i++) codes.push((await S3.anon.post('/api/libs', {}, { ip: '10.9.' + (i >> 8) + '.' + (i & 255) })).status);
        r = await S3.anon.post('/api/libs', {}, { ip: '10.9.9.9' });
        ok('100 an hour for the whole site, from 100 addresses; the 101st is 429 too-many', codes.every(s => s === 201) && r.status === 429 && r.body.code === 'too-many', codes.filter(s => s !== 201).join() + ' ' + r.status);
        S3.advance(61 * 60 * 1000);
        ok('an hour later it is let make more', (await S3.anon.post('/api/libs', {}, { ip: '10.9.9.9' })).status === 201);
      } finally { await S3.close(); }
      /* the cap on live libraries: 503 busy, nobody is evicted */
      const S4 = await L.startSync({ memory: true, config: { maxLibs: 12 } });
      try {
        const mine = [];
        for (let i = 0; i < 12; i++) { if (i % 90 === 0 && i) S4.advance(61 * 60 * 1000); const x = await S4.anon.post('/api/libs', {}, { ip: '10.8.0.' + i }); mine.push(x); }
        const over = await S4.anon.post('/api/libs', {}, { ip: '10.8.1.1' });
        ok('at the cap of live libraries the answer is 503 busy: nobody is evicted', mine.every(x => x.status === 201) && over.status === 503 && over.body.code === 'busy', over.status + ' ' + over.text);
        const first = mine[0].body;
        const w = await L.req(S4.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': first.code }, body: { device: 'a1b2c3d4e5f60718', items: [L.item('song:keep')] } });
        ok('... and the first library is still there, and works', w.status === 200, w.status + ' ' + w.text.slice(0, 100));
        const del = await L.req(S4.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': mine[1].body.code } });
        const again = await S4.anon.post('/api/libs', {}, { ip: '10.8.1.1' });
        ok('a place freed by deleting a library is a place again (a deleted one does not count towards the cap)', del.status === 200 && again.status === 201, del.status + ' ' + again.status);
      } finally { await S4.close(); }
    } finally { await S.close(); }
  }

  heading('items: write, read, revisions, conflicts, deletion');
  {
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      let r = await A.putItems([L.item('song:one'), L.item('state', { v: 1, xp: 5 })]);
      ok('a batch of two new items: 200, revisions 1 and 2, maxRev 2, the counters of the library', r.status === 200 && r.body.maxRev === 2 && r.body.applied.map(x => x.key + '@' + x.rev).join() === 'song:one@1,state@2' && r.body.conflicts.length === 0
        && r.body.library.items === 2 && r.body.library.tombs === 0, JSON.stringify(r.body));
      const bytes1 = r.body.library.bytes;
      const one = L.item('song:one'), st = L.item('state', { v: 1, xp: 5 });
      ok('the library counts each row\'s body and a fixed overhead for the row (bytes = ' + bytes1 + ')', bytes1 === acct(one) + acct(st), bytes1 + ' vs ' + (acct(one) + acct(st)));
      r = await A.changes(0);
      ok('changes since 0: both, oldest first, with their metadata and no body', r.status === 200 && r.body.items.length === 2 && r.body.items[0].key === 'song:one' && r.body.items[1].rev === 2 && !('body' in r.body.items[0])
        && r.body.items[0].hash === one.hash && r.body.items[0].bytes === acct(one) - ROW && r.body.items[0].device === 'a1b2c3d4e5f60718' && /^\d{4}-/.test(r.body.items[0].updatedAt) && r.body.maxRev === 2 && r.body.nextSince === 2, JSON.stringify(r.body).slice(0, 300));
      r = await A.changes(1);
      ok('changes since 1: only the second', r.body.items.length === 1 && r.body.items[0].key === 'state');
      r = await A.items(['song:one', 'state', 'song:none']);
      const back = r.body.items.find(i => i.key === 'song:one');
      ok('the items come back with their gzip bodies exactly as they were sent, and a key that is not there is listed as missing', r.status === 200 && back.body === one.body && r.body.items.length === 2 && r.body.missing.join() === 'song:none', r.text.slice(0, 100));
      ok('the body inflates to the song', JSON.parse(require('zlib').gunzipSync(Buffer.from(back.body, 'base64')).toString('utf8')).score.notes.length === 8);
      /* revisions: base rev rule */
      r = await A.putItems([L.item('song:one', L.songBody(9), 0)]);
      ok('a write over a revision the writer did not see (base 0, the item is at 1): 409 conflict with the server\'s metadata, nothing written', r.status === 409 && r.body.applied.length === 0 && r.body.conflicts.length === 1 && r.body.conflicts[0].rev === 1 && r.body.conflicts[0].hash === one.hash && r.body.maxRev === 2, JSON.stringify(r.body).slice(0, 200));
      r = await A.putItems([L.item('song:one', L.songBody(9), 1), L.item('song:new', L.songBody(10), 0), L.item('state', { v: 1, xp: 9 }, 0)]);
      ok('a batch with one stale item: the others are written (revs 3 and 4), the stale one is listed, the answer is 409', r.status === 409 && r.body.applied.map(x => x.key + '@' + x.rev).join() === 'song:one@3,song:new@4' && r.body.conflicts.map(c => c.key + '@' + c.rev).join() === 'state@2' && r.body.maxRev === 4, JSON.stringify(r.body).slice(0, 300));
      r = await A.putItems([L.item('song:one', L.songBody(9), 3)]);
      ok('the same body again over its own revision is simply written (rev 5): a retry is safe', r.status === 200 && r.body.applied[0].rev === 5);
      r = await A.putItems([L.item('song:one', L.songBody(9), 99)]);
      ok('a base ahead of the item is fine (the rule is "the item is not newer than what you saw")', r.status === 200 && r.body.applied[0].rev === 6);
      /* deletion */
      r = await A.delItem('song:new', 3);
      ok('a delete over a stale revision is a conflict with the metadata, nothing is deleted', r.status === 409 && r.body.conflicts[0].key === 'song:new' && r.body.conflicts[0].rev === 4 && !r.body.conflicts[0].deleted, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
      r = await A.delItem('song:new', 4);
      ok('a delete over the revision seen: a tombstone with the next revision, the library counts a tombstone', r.status === 200 && r.body.deleted === true && r.body.rev === 7 && r.body.library.tombs === 1 && r.body.library.items === 2, JSON.stringify(r.body));
      r = await A.changes(6);
      ok('the tombstone is in changes with deleted:true and deletedAt, no hash, no body; `deletions` says how many', r.body.items.length === 1 && r.body.items[0].deleted === true && !!r.body.items[0].deletedAt && r.body.items[0].bytes === 0 && r.body.deletions === 1, JSON.stringify(r.body).slice(0, 300));
      r = await A.items(['song:new']);
      ok('reading a tombstone gives its metadata and no body', r.body.items[0].deleted === true && !r.body.items[0].body);
      r = await A.delItem('song:new', 4);
      ok('deleting it again is not an error (a retried delete): 200 already:true, the same revision, nothing new written', r.status === 200 && r.body.already === true && r.body.rev === 7 && r.body.maxRev === 7);
      r = await A.delItem('song:never', 0);
      ok('deleting what was never there is 404 (a tombstone is not made for a name)', bad(r, 404, 'not-found'));
      r = await A.putItems([L.item('song:new', L.songBody(11), 4)]);
      ok('writing over a tombstone from before it (base 4, the tombstone is at 7) is a conflict: whoever deleted it must be seen first', r.status === 409 && r.body.conflicts[0].deleted === true && r.body.conflicts[0].rev === 7);
      r = await A.putItems([L.item('song:new', L.songBody(11), 7)]);
      ok('over the tombstone\'s own revision it is brought back (rev 8): the library has 3 items, 0 tombstones', r.status === 200 && r.body.applied[0].rev === 8 && r.body.library.items === 3 && r.body.library.tombs === 0, JSON.stringify(r.body.library));
      /* the library's numbers equal what its rows hold */
      const rows = await ownRows(S, 'a');
      const lib = await libRow(S, 'a');
      ok('the counters of the library equal its rows (items, tombstones, revision, accounted bytes)', lib.items === rows.filter(x => !x.deleted).length && lib.tombs === rows.filter(x => x.deleted).length && lib.maxRev === 8
        && lib.bytes === rows.reduce((n, x) => n + (x.deleted ? ROW : x.bytes + ROW), 0), JSON.stringify(lib));
      /* bad names, bad numbers */
      for (const [what, key] of [['a name with a slash', 'song:a/b'], ['no prefix', 'one'], ['the empty id', 'song:'], ['an id of 65 characters', 'song:' + 'x'.repeat(65)], ['a space', 'song:a b'], ['upper case state', 'State'], ['a path', '../state'], ['a NUL', 'song:a\u0000b']]) {
        r = await A.putItems([L.item(key)]);
        ok('an item named with ' + what + ' is refused (422 bad-key; a NUL is stopped even earlier, as the text of the request)', r.status === 422 && (r.body.code === 'bad-key' || (key.indexOf('\u0000') >= 0 && r.body.code === 'bad-body')), r.status + ' ' + JSON.stringify(r.body));
      }
      r = await A.putItems([L.item('song:x'), L.item('song:x')]);
      ok('the same key twice in one batch is refused whole (422 dup-key), nothing written (the revision is still 8)', bad(r, 422, 'dup-key') && (await A.changes(0)).body.maxRev === 8);
      const nums = [['a string', '3'], ['a float', 1.5], ['negative', -1], ['null', null], ['huge', 1e20]];
      for (const [w, v] of nums) { const it = L.item('song:y'); it.baseRev = v; r = await A.putItems([it]); ok('baseRev ' + w + ' is refused (422 bad-rev)', bad(r, 422, 'bad-rev'), r.status + ' ' + JSON.stringify(r.body)); }
      r = await A.putItems(Array.from({ length: 26 }, (_, i) => L.item('song:b' + i)));
      ok('26 items in a batch: 422 too-many-items', bad(r, 422, 'too-many-items'));
      r = await A.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:c' + i)));
      ok('25 items in a batch: written, 25 consecutive revisions', r.status === 200 && r.body.applied.length === 25 && r.body.applied[24].rev === r.body.applied[0].rev + 24);
      r = await A.putItems([]);
      ok('an empty batch: 422 no-items', bad(r, 422, 'no-items'));
      r = await A.putItems([L.item('song:z')], { body: { device: 'NOT-HEX', items: [L.item('song:z')] } });
      ok('a device name that is not 16 hex is refused (422 bad-device)', bad(r, 422, 'bad-device'));
      r = await A.items(Array.from({ length: 26 }, (_, i) => 'song:c' + i));
      ok('26 keys to read: 422 too-many-items', bad(r, 422, 'too-many-items'));
      r = await A.get('/api/sync/items');
      ok('no keys to read: 422 no-keys', bad(r, 422, 'no-keys'));
      r = await A.get('/api/sync/items?keys=song:a,song:a');
      ok('the same key twice to read: 422 dup-key', bad(r, 422, 'dup-key'));
      r = await A.get('/api/sync/changes?since=abc');
      ok('since that is not a number: 422 bad-rev', bad(r, 422, 'bad-rev'));
      r = await A.delItem('song:one', 'x');
      ok('a delete with a baseRev that is not a number is 422', bad(r, 422, 'bad-rev'));
      r = await A.del('/api/sync/items/' + encodeURIComponent('song:one'));
      ok('a delete with no baseRev is refused (a blind delete is the dangerous one): 422 bad-rev', bad(r, 422, 'bad-rev'));
      r = await A.changes(9999);
      ok('a device AHEAD of the library (a restored database) is told: reset:true, and the revision the library has', r.status === 200 && r.body.reset === true && r.body.maxRev === 8 + 25 && r.body.items.length === 0, JSON.stringify(r.body).slice(0, 120));
      r = await A.del('/api/sync/changes');
      ok('a method a route does not have is 405; an unknown path is 404', r.status === 405 && (await A.get('/api/sync/nothing')).status === 404 && (await L.req(S.port, 'PATCH', '/api/libs')).status === 405);
    } finally { await S.close(); }
  }

  heading('what an item must be (shape, size, unpacked size)');
  {
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      const mk = (key, buf, over) => Object.assign({ key: key, baseRev: 0, hash: 'h'.repeat(16), body: buf.toString('base64') }, over || {});
      const zlib = require('zlib');
      const put = (items, o) => A.putItems(items, o);
      let r = await put([mk('song:p1', zlib.deflateSync(Buffer.from(JSON.stringify(L.songBody(8)))))]);
      ok('a zlib stream is not gzip: 422 bad-gzip', bad(r, 422, 'bad-gzip'), r.status + ' ' + r.text);
      r = await put([mk('song:p1', Buffer.from(JSON.stringify(L.songBody(8))))]);
      ok('plain JSON is not gzip: 422 bad-gzip', bad(r, 422, 'bad-gzip'));
      r = await put([{ key: 'song:p1', baseRev: 0, hash: 'h'.repeat(16), body: '!!!!' }]);
      ok('a body that is not base64: 422 bad-item', bad(r, 422, 'bad-item'));
      const truncated = zlib.gzipSync(Buffer.from(JSON.stringify(L.songBody(40)))).subarray(0, 60);
      r = await put([mk('song:p1', Buffer.concat([truncated, Buffer.alloc(20)]))]);
      ok('a gzip stream that is cut or corrupt: 422 bad-gzip', bad(r, 422, 'bad-gzip'), r.status + ' ' + r.text);
      r = await put([mk('song:p1', L.gz('not json at all'))]);
      ok('gzip of something that is not JSON: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz('[1,2,3]'))]);
      ok('JSON that is an array: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz({ v: 1 }))]);
      ok('a song with no score: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz({ v: 1, score: { measures: [], notes: [] } }))]);
      ok('a song whose score has no measures: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz({ v: 1, score: { measures: [{}], notes: 'x' } }))]);
      ok('a song whose notes are not an array: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz(Object.assign(L.songBody(8), { notes: 1, secret: 'x' })))]);
      ok('a field a song does not have is refused (an item is a song, not a place for anything): 422 bad-item', bad(r, 422, 'bad-item') && /does not have/.test(r.body.error), r.text);
      r = await put([mk('song:p1', L.gz({ v: 1, score: L.score(8, 4), graph: [1] }))]);
      ok('the graph (S2) is accepted but must be an object', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p1', L.gz({ v: 1, score: L.score(8, 4), graph: { anything: { at: ['all'] } }, scoreHash: 'abc' }))]);
      ok('an opaque graph object and a scoreHash are accepted', r.status === 200, r.text);
      r = await put([mk('state', L.gz({ v: 1, a: 1 }))]);
      ok('the state item is any small object', r.status === 200);
      const many = {}; for (let i = 0; i < 65; i++) many['k' + i] = i;
      r = await put([mk('state', L.gz(many))], { });
      ok('the state item with 65 fields: 422', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p2', L.gz({ v: 1, score: L.score(8, 4), card: { title: 'a\u0000b' } }))]);
      ok('a NUL in a string is refused (Postgres cannot keep it): 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p2', L.gz('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":' + '['.repeat(30) + ']'.repeat(30) + '}'))]);
      ok('nesting past 24 containers is refused: 422 bad-item', bad(r, 422, 'bad-item'));
      r = await put([mk('song:p2', L.gz({ v: 1, score: { measures: Array.from({ length: 5001 }, () => ({})), notes: [] } }))]);
      ok('a score of 5,001 measures is not a score (the rule of every share): 422', bad(r, 422, 'bad-item'));
      /* sizes */
      const big = L.songBody(8); big.card = { text: L.crypto.randomBytes(1024 * 1024 + 4096).toString('base64') };
      r = await put([mk('song:big', L.gz(big))]);
      ok('an item of more than 1 MB of gzip: 413 item-too-large', bad(r, 413, 'item-too-large'), r.status + ' ' + r.text.slice(0, 100));
      const edge = L.songBody(8); edge.card = { text: L.crypto.randomBytes(700 * 1024).toString('base64') };
      const edgeGz = L.gz(edge);
      r = await put([mk('song:edge', edgeGz)]);
      ok('an item of ' + Math.round(edgeGz.length / 1024) + ' KB of gzip (under the 1 MB) is kept', edgeGz.length < MiB && r.status === 200, r.status + ' ' + r.text.slice(0, 100));
      /* the zip bomb: small in gzip, huge unpacked */
      const bomb = zlib.gzipSync(Buffer.alloc(200 * MiB, 0x20));
      r = await put([mk('song:bomb', bomb)]);
      ok('a zip bomb (' + Math.round(bomb.length / 1024) + ' KB of gzip that unpacks to 200 MB) stops at 8 MB: 413 item-too-large, nothing stored', bad(r, 413, 'item-too-large') && (await S.inner.changes(S.libId('a'), 0, 99)).every(x => x.key !== 'song:bomb'), r.status + ' ' + r.text.slice(0, 100));
      const justOver = L.gz(Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"t":"' + 'a'.repeat(8 * MiB) + '"}}'));
      r = await put([mk('song:over', justOver)]);
      ok('an item that unpacks to a little over 8 MB is refused the same way', bad(r, 413, 'item-too-large'), r.status + ' ' + r.text.slice(0, 100));
      const justUnder = L.gz(Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"t":"' + 'a'.repeat(7 * MiB) + '"}}'));
      r = await put([mk('song:under', justUnder)]);
      ok('and one of 7 MB unpacked (a few KB of gzip) is taken', r.status === 200, r.status + ' ' + r.text.slice(0, 100));
      /* the sum of the unpacked items of one request */
      const seven = idx => mk('song:u' + idx, L.gz(Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"t":"' + String.fromCharCode(97 + idx).repeat(7 * MiB) + '"}}')));
      r = await put([seven(0), seven(1), seven(2)]);
      ok('three items of 7 MB unpacked in one request (21 MB: more than the 16 MB a request may unpack): 413', bad(r, 413, 'item-too-large'), r.status + ' ' + r.text.slice(0, 100));
      /* the amplification: a million small objects inside a small gzip */
      const objs = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"x":[' + '{},'.repeat(2 * 1024 * 1024) + '{}]}}');
      const t0 = Date.now(), heap0 = process.memoryUsage().heapUsed;
      r = await put([mk('song:amp', L.gz(objs))]);
      ok('a gzip of ' + Math.round(objs.length / MiB) + ' MB of {} (2 million objects: ~130 MB of heap if it were parsed) is refused by its structure before it is parsed: 422 bad-item, in ' + (Date.now() - t0) + ' ms',
        bad(r, 422, 'bad-item') && Date.now() - t0 < 4000 && process.memoryUsage().heapUsed - heap0 < 80 * MiB, r.status + ' ' + r.text.slice(0, 100) + ' ' + Math.round((process.memoryUsage().heapUsed - heap0) / MiB) + ' MB');
      const deep = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":' + '['.repeat(5000) + ']'.repeat(5000) + '}');
      r = await put([mk('song:deep', L.gz(deep))]);
      ok('a gzip of 5,000 nested arrays: 422 bad-item (and the process is alive: no stack overflow)', bad(r, 422, 'bad-item'));
      ok('(and nothing of any of those was stored)', (await S.inner.changes(S.libId('a'), 0, 99)).map(x => x.key).sort().join() === 'song:edge,song:p1,song:under,state', (await S.inner.changes(S.libId('a'), 0, 99)).map(x => x.key).join());
      /* batch size on the wire */
      r = await put(Array.from({ length: 5 }, (_, i) => mk('song:w' + i, L.gz(Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(860 * 1024).toString('base64') } })))));
      ok('five items of ~860 KB of gzip each (4.3 MB of gzip, 5.7 MB of request: under the 6 MB the request may be, over the 4 MB of gzip): 413 batch-too-large, nothing stored', bad(r, 413, 'batch-too-large') && (await S.inner.changes(S.libId('a'), 0, 99)).every(x => !/^song:w/.test(x.key)), r.status + ' ' + r.text.slice(0, 100));
      r = await put(Array.from({ length: 6 }, (_, i) => mk('song:w' + i, L.gz(Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(900 * 1024).toString('base64') } })))));
      ok('six of them (7.2 MB of request, more than the 6 MB a request may be): 413 too-large, nothing stored', bad(r, 413, 'too-large') && (await S.inner.changes(S.libId('a'), 0, 99)).every(x => !/^song:w/.test(x.key)), r.status + ' ' + r.text.slice(0, 100));
    } finally { await S.close(); }
  }

  heading('long answers: changes come in pages, bodies in answers of at most 6 MB');
  {
    const S = await L.startSync({ libs: ['a'], memory: true });
    try {
      const A = S.as('a');
      for (let b = 0; b < 21; b++) {
        if (b % 9 === 8) S.advance(61 * 60 * 1000);
        const r = await A.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:p' + (b * 25 + i), L.songBody(5))));
        if (r.status !== 200) throw new Error('page fixture: ' + r.status + ' ' + r.text.slice(0, 120));
      }
      const first = await A.changes(0);
      ok('525 items: the first answer holds 500, says there is more, and where to go on from (nextSince = the last revision it gave)', first.status === 200 && first.body.items.length === 500 && first.body.more === true && first.body.nextSince === 500 && first.body.maxRev === 525 && first.body.items[499].rev === 500, JSON.stringify([first.body.items.length, first.body.more, first.body.nextSince]));
      const rest = await A.changes(first.body.nextSince);
      ok('the next answer holds the other 25, no more, and nextSince is the revision of the library: a device that has them asks nothing after it', rest.body.items.length === 25 && rest.body.more === false && rest.body.nextSince === 525 && rest.body.items[0].rev === 501, JSON.stringify([rest.body.items.length, rest.body.more, rest.body.nextSince]));
      S.advance(61 * 60 * 1000);
      for (let i = 0; i < 4; i++) await A.delItem('song:p' + i, i + 1);
      const del = await A.changes(525);
      ok('`deletions` counts the tombstones of an answer: the number a device asks about before it removes songs (G13 doc 7.5: more than three)', del.body.deletions === 4 && del.body.items.every(x => x.deleted === true), JSON.stringify([del.body.deletions, del.body.items.length]));
      ok('...and a mixed answer counts only the tombstones', (await A.changes(520)).body.deletions === 4 && (await A.changes(520)).body.items.length === 9);
    } finally { await S.close(); }
    const S2 = await L.startSync({ libs: ['a'], memory: true });
    try {
      const A = S2.as('a');
      const big = (k, i) => L.item(k, Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(850 * 1024).toString('base64') + i } }));
      await A.putItems([big('song:g0', 0), big('song:g1', 1), big('song:g2', 2), big('song:g3', 3)]);
      await A.putItems([big('song:g4', 4), big('song:g5', 5), big('song:g6', 6), big('song:g7', 7)]);
      const keys = Array.from({ length: 8 }, (_, i) => 'song:g' + i);
      const r = await A.items(keys);
      const inline = r.body.items.filter(i => i.body).length, deferred = r.body.items.filter(i => i.deferred).length;
      const bodiesBytes = r.body.items.reduce((n, i) => n + (i.body ? Buffer.from(i.body, 'base64').length : 0), 0);
      ok('eight items of ~870 KB of gzip (7 MB in all): an answer holds bodies up to 6 MB of gzip and says which items it deferred; the order asked for is kept', r.status === 200 && inline >= 6 && inline <= 7 && deferred === 8 - inline && bodiesBytes <= 6 * MiB
        && r.body.items.slice(0, inline).every(i => !!i.body) && r.body.items.slice(inline).every(i => i.deferred === true && !i.body), JSON.stringify([inline, deferred, bodiesBytes]));
      const more = await A.items(keys.slice(inline));
      ok('and the deferred ones are asked for again and come', more.status === 200 && more.body.items.every(i => !!i.body && !i.deferred));
    } finally { await S2.close(); }
    const S3 = await L.startSync({ libs: ['a'], memory: true });
    try {
      const A = S3.as('a');
      await A.putItems([L.item('song:one')]);
      const code = S3.code('a');
      const heads = (method, p, extra) => method + ' ' + p + ' HTTP/1.1\r\nHost: x\r\nX-PPP-Lib: ' + code + '\r\n' + extra + '\r\n';
      const g = await rawHead(S3.port, heads('GET', '/api/sync/changes?since=0', 'Content-Length: 5\r\n') + 'hello');
      const d = await rawHead(S3.port, heads('DELETE', '/api/sync/items/song%3Aone?baseRev=1', 'Content-Length: 5\r\n') + 'hello');
      const t = await rawHead(S3.port, heads('GET', '/api/sync/changes?since=0', 'Transfer-Encoding: chunked\r\n') + '5\r\nhello\r\n0\r\n\r\n');
      ok('a GET or a DELETE that carries a body is refused (400 no-body-expected) and the connection closed: the body is never read or held', g.status === 400 && d.status === 400 && t.status === 400 && /no-body-expected/.test(g.text), [g.status, d.status, t.status].join());
      ok('(and the item was not deleted)', (await A.items(['song:one'])).body.items[0].deleted === false);
    } finally { await S3.close(); }
  }

  heading('what a library may hold: bytes, rows; nothing is ever evicted');
  {
    const a1 = acct(L.item('song:q1'));
    const S = await L.startSync({ libs: ['a'], config: { libBytes: a1 * 3 + 40 } });
    try {
      const A = S.as('a');
      let r = await A.putItems([L.item('song:q1'), L.item('song:q2'), L.item('song:q3')]);
      ok('three items fit a library of ' + (a1 * 3 + 40) + ' bytes', r.status === 200 && r.body.library.bytes === a1 * 3);
      r = await A.putItems([L.item('song:q4')]);
      ok('the fourth is refused: 503 quota; the sentence says the library is full', bad(r, 503, 'quota') && /full/.test(r.body.error), r.status + ' ' + r.text);
      const before = await A.items(['song:q1', 'song:q2', 'song:q3']);
      ok('what was kept is exactly as it was (nothing is evicted to make room)', before.status === 200 && before.body.items.length === 3 && before.body.items.every(i => !i.deferred && i.body));
      const bigger = L.item('song:q1', L.songBody(60), 1);
      r = await A.putItems([bigger]);
      ok('a replacement that is bigger and does not fit is refused too (the growth is what counts)', bad(r, 503, 'quota'), r.status + ' ' + r.text);
      const smaller = L.item('song:q1', L.songBody(2), 1);
      r = await A.putItems([smaller]);
      ok('a replacement that is smaller is taken at the cap (the room it frees is its own)', r.status === 200 && r.body.library.bytes < a1 * 3);
      r = await A.delItem('song:q2', 2);
      ok('a deletion frees the body (a tombstone costs its row)', r.status === 200 && r.body.library.bytes <= a1 * 3 - (a1 - ROW) + 1);
      /* a batch that does not fit is refused whole */
      const S2 = await L.startSync({ libs: ['b'], config: { libBytes: a1 * 3 + 40 } });
      try {
        const B = S2.as('b');
        r = await B.putItems([L.item('song:r1'), L.item('song:r2'), L.item('song:r3'), L.item('song:r4')]);
        ok('a batch of four into room for three: refused whole (503 quota), none of the four is stored', bad(r, 503, 'quota') && (await B.changes(0)).body.items.length === 0);
        ok('and the library is not damaged by it: three items go in afterwards', (await B.putItems(Array.from({ length: 3 }, (_, i) => L.item('song:s' + i)))).status === 200);
      } finally { await S2.close(); }
    } finally { await S.close(); }

    /* an address: the libraries made from one address share 48 MB (here: 4 items) */
    const S3 = await L.startSync({ config: { addressBytes: a1 * 4 + 40, libBytes: a1 * 10 } });
    try {
      await S3.make('x1', { ip: '192.0.2.50' }); await S3.make('x2', { ip: '192.0.2.50' }); await S3.make('y', { ip: '192.0.2.51' });
      let r = await S3.as('x1').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      ok('library x1 of address 1 keeps three', r.status === 200);
      r = await S3.as('x2').putItems([L.item('song:a'), L.item('song:b')]);
      ok('library x2 of the SAME address is refused two more: 503 quota (this network)', bad(r, 503, 'quota') && /network/.test(r.body.error), r.status + ' ' + r.text);
      r = await S3.as('x2').putItems([L.item('song:a')]);
      ok('... one fits (the address holds four)', r.status === 200);
      r = await S3.as('y').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c'), L.item('song:d')]);
      ok('a library of another address is not affected (it has its own four)', r.status === 200);
    } finally { await S3.close(); }

    /* the site */
    const S4 = await L.startSync({ config: { totalBytes: a1 * 5 + 40, libBytes: a1 * 10, addressBytes: a1 * 10 } });
    try {
      await S4.make('p', { ip: '192.0.2.60' }); await S4.make('q', { ip: '192.0.2.61' });
      let r = await S4.as('p').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      r = await S4.as('q').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      ok('past the site\'s cap the answer is 503 busy (the cap of U3: refuse, never evict), and p keeps what it had', bad(r, 503, 'busy') && (await S4.as('p').items(['song:a', 'song:b', 'song:c'])).body.items.length === 3, r.status + ' ' + r.text);
      r = await S4.as('q').putItems([L.item('song:a'), L.item('song:b')]);
      ok('what fits is taken', r.status === 200);
      const g = S4.svc.gauge(false);
      ok('the gauge says the site is at its cap (and warns: 80 % is passed)', g.bytes === a1 * 5 && g.pct >= 80 && /cap/.test(g.warn || ''), JSON.stringify(g).slice(0, 200));
    } finally { await S4.close(); }

    /* rows: a row costs its overhead whatever its body; a tombstone is a row until it is purged */
    const S5 = await L.startSync({ libs: ['a'], config: { libRows: 4, siteRows: 100 } });
    try {
      const A = S5.as('a');
      let r = await A.putItems([L.item('song:a'), L.item('song:b'), L.item('song:c'), L.item('song:d')]);
      ok('a library of at most 4 rows takes four', r.status === 200);
      r = await A.putItems([L.item('song:e')]);
      ok('the fifth row is refused: 503 quota', bad(r, 503, 'quota') && /as many items/.test(r.body.error), r.status + ' ' + r.text);
      r = await A.delItem('song:a', 1);
      r = await A.putItems([L.item('song:e')]);
      ok('a deleted item is a tombstone, which is still a row: the fifth is still refused', bad(r, 503, 'quota'));
      r = await A.putItems([L.item('song:a', L.songBody(8), 5)]);
      ok('but the tombstone\'s own row can be brought back', r.status === 200);
    } finally { await S5.close(); }
    const S6 = await L.startSync({ config: { libRows: 100, siteRows: 5 } });
    try {
      await S6.make('p', { ip: '192.0.2.70' }); await S6.make('q', { ip: '192.0.2.71' });
      await S6.as('p').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      const r = await S6.as('q').putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      ok('the site\'s rows are capped too: 503 quota', bad(r, 503, 'quota'), r.status + ' ' + r.text);
    } finally { await S6.close(); }
  }

  heading('rates: items written, deleted, requests, changes that ask the database, items read, code changes');
  {
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      let st = [];
      for (let i = 0; i < 10; i++) st.push((await A.putItems(Array.from({ length: 24 }, (_, j) => L.item('song:w' + (i * 24 + j))))).status);
      ok('240 items an hour in ten batches are all taken', st.every(s => s === 200), st.join());
      let r = await A.putItems([L.item('song:w240')]);
      ok('the 241st is 429 too-many with a Retry-After', bad(r, 429, 'too-many') && +r.headers['retry-after'] > 0, r.status + ' ' + r.text);
      S.advance(61 * 60 * 1000);
      r = await A.putItems([L.item('song:w240')]);
      ok('an hour later it is taken', r.status === 200);
      /* a conflict gives its slots back: 24 stale items do not use the hour */
      const S2 = await L.startSync({ libs: ['a'] });
      try {
        const B = S2.as('a');
        await B.putItems([L.item('song:k')]);
        let n409 = 0;
        for (let i = 0; i < 25; i++) { const x = await B.putItems(Array.from({ length: 10 }, (_, j) => (j === 0 ? L.item('song:k', L.songBody(8), 0) : L.item('song:z' + i + '_' + j, L.songBody(8), 0)))); if (x.status === 409) n409++; }
        ok('items that conflict give their place in the hour back (25 batches of 10 with one stale item each: 226 items written; had the stale ones kept their places it would be 251 of 240)', n409 === 25 && (await B.changes(0)).body.items.length === 226, n409 + ' ' + (await B.changes(0)).body.items.length);
      } finally { await S2.close(); }
      /* deletions: 60 an hour */
      const S3 = await L.startSync({ libs: ['a'] });
      try {
        const D3 = S3.as('a');
        for (let i = 0; i < 3; i++) await D3.putItems(Array.from({ length: 25 }, (_, j) => L.item('song:d' + (i * 25 + j))));
        const res = [];
        for (let i = 0; i < 62; i++) res.push((await D3.delItem('song:d' + i, 1 + i)).status);
        ok('60 deletions an hour; the 61st is 429', res.slice(0, 60).every(s => s === 200) && res[60] === 429 && res[61] === 429, res.slice(55).join());
        const rc = await D3.changes(0);
        ok('and the refused ones deleted nothing', rc.body.items.filter(x => x.deleted).length === 60);
      } finally { await S3.close(); }
      /* write requests: 120 an hour whatever came of them */
      const S4 = await L.startSync({ libs: ['a'] });
      try {
        const W4 = S4.as('a');
        const res = [];
        for (let i = 0; i < 122; i++) res.push((await W4.putItems([L.item('song:same', L.songBody(8), 0)])).status);
        ok('120 write requests an hour even when each conflicts (the work is counted, not only what is kept); the 121st is 429', res[0] === 200 && res.slice(1, 120).every(s => s === 409) && res[120] === 429 && res[121] === 429, res.slice(115).join());
      } finally { await S4.close(); }
      /* write requests count for a DELETE of something that is not there as well (nothing is deleted, the work was done) */
      const S8 = await L.startSync({ libs: ['a'], memory: true });
      try {
        const D8 = S8.as('a');
        const st8 = [];
        for (let i = 0; i < 122; i++) st8.push((await D8.delItem('song:none', 0)).status);
        ok('120 delete requests an hour even when they delete nothing (404 each); the 121st is 429 too-many', st8.slice(0, 120).every(s => s === 404) && st8[120] === 429 && st8[121] === 429, st8.slice(115).join());
      } finally { await S8.close(); }
      /* changes that need the database: 120 an hour */
      const S5 = await L.startSync({ libs: ['a'] });
      try {
        const C5 = S5.as('a');
        await C5.putItems([L.item('song:one')]);
        const res = [];
        for (let i = 0; i < 122; i++) res.push((await C5.changes(0)).status);
        ok('120 changes an hour that ask the database; the 121st is 429 too-many', res.slice(0, 120).every(s => s === 200) && res[120] === 429, res.slice(115).join());
        ok('... but a poll that asks nothing is never refused for it (since = the library\'s revision)', (await C5.changes(1)).status === 200);
      } finally { await S5.close(); }
      /* reads: 300 items an hour */
      const S6 = await L.startSync({ libs: ['a'] });
      try {
        const R6 = S6.as('a');
        await R6.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:r' + i)));
        const keys = Array.from({ length: 25 }, (_, i) => 'song:r' + i);
        const res = [];
        for (let i = 0; i < 13; i++) res.push((await R6.items(keys)).status);
        ok('300 items read an hour (12 reads of 25); the 13th is 429', res.slice(0, 12).every(s => s === 200) && res[12] === 429, res.join());
      } finally { await S6.close(); }
      /* the code: 5 changes an hour */
      const S7 = await L.startSync({ libs: ['a'] });
      try {
        const codes = [S7.code('a')];
        const res = [];
        let cur = S7.code('a');
        for (let i = 0; i < 6; i++) {
          const x = await L.req(S7.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': cur }, body: {} });
          res.push(x.status);
          if (x.status === 201) cur = x.body.code;
        }
        ok('the code can be changed 5 times an hour; the 6th is 429', res.join() === '201,201,201,201,201,429', res.join());
      } finally { await S7.close(); }
    } finally { await S.close(); }
  }

  heading('bytes in and out: a library and an address have a quarter of the site\'s budget');
  {
    const a1 = acct(L.item('song:q1')) - ROW;
    /* ingress: site hour 8*a1, day 100*a1 -> a library's hour share is 2*a1 */
    const S = await L.startSync({ libs: ['a'], config: { ingressPerHour: a1 * 8, ingressPerDay: a1 * 100 } });
    try {
      const A = S.as('a');
      let r = await A.putItems([L.item('song:a'), L.item('song:b')]);
      ok('two items are exactly the library\'s quarter of the site\'s hour', r.status === 200);
      r = await A.putItems([L.item('song:c')]);
      ok('the third is refused: 429 share, with Retry-After, though the site\'s budget has room (it is the library\'s share)', bad(r, 429, 'share') && +r.headers['retry-after'] >= 60, r.status + ' ' + r.text);
      ok('(and what was refused was not written)', (await A.changes(0)).body.items.length === 2);
      S.advance(61 * 60 * 1000);
      r = await A.putItems([L.item('song:c')]);
      ok('an hour later the share is whole again', r.status === 200);
    } finally { await S.close(); }
    /* a stranger cannot use the site's budget up for somebody else: three libraries of three addresses, each its quarter */
    const S2 = await L.startSync({ config: { ingressPerHour: a1 * 8, ingressPerDay: a1 * 100 } });
    try {
      await S2.make('p', { ip: '192.0.2.80' }); await S2.make('q', { ip: '192.0.2.81' }); await S2.make('r', { ip: '192.0.2.82' }); await S2.make('t', { ip: '192.0.2.84' });
      await S2.as('p').putItems([L.item('song:a'), L.item('song:b')]);
      const pr = await S2.as('p').putItems([L.item('song:c')]);
      const qr = await S2.as('q').putItems([L.item('song:a'), L.item('song:b')]);
      const rr = await S2.as('r').putItems([L.item('song:a'), L.item('song:b')]);
      const tr = await S2.as('t').putItems([L.item('song:a'), L.item('song:b')]);
      ok('p used its quarter and is refused; q, r and t are not affected', pr.status === 429 && qr.status === 200 && rr.status === 200 && tr.status === 200);
      await S2.make('s', { ip: '192.0.2.83' });
      const sr = await S2.as('s').putItems([L.item('song:a')]);
      ok('and when the site\'s own hour is used up (four quarters), the next library is 503 budget (the site\'s)', bad(sr, 503, 'budget'), sr.status + ' ' + sr.text);
    } finally { await S2.close(); }
    /* an address: its libraries share a quarter */
    const S3 = await L.startSync({ config: { ingressPerHour: a1 * 8, ingressPerDay: a1 * 100 } });
    try {
      await S3.make('x1', { ip: '192.0.2.90' }); await S3.make('x2', { ip: '192.0.2.90' }); await S3.make('y', { ip: '192.0.2.91' });
      await S3.as('x1').putItems([L.item('song:a')]);
      await S3.as('x2').putItems([L.item('song:a')]);
      const r = await S3.as('x2').putItems([L.item('song:b')]);
      ok('two libraries of one address share the address\'s quarter: the second one\'s second item is 429 share', bad(r, 429, 'share'), r.status + ' ' + r.text);
      ok('a library of another address is not (its quarter, whole)', (await S3.as('y').putItems([L.item('song:a'), L.item('song:b')])).status === 200);
    } finally { await S3.close(); }
    /* a library with no address tag (an older row) is held to its own quarter */
    const S7 = await L.startSync({ config: { ingressPerHour: a1 * 8, ingressPerDay: a1 * 100 } });
    try {
      const codeU = 'cd'.repeat(32);
      await S7.inner.createLib({ id: Sync.libIdOf(Sync.codeHash(codeU)), hash: Sync.codeHash(codeU).toString('hex'), createdAt: S7.clock.t, ipTag: '' }, 100);
      const putU = list => L.req(S7.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': codeU }, body: { device: 'a1b2c3d4e5f60718', items: list } });
      const first = await putU([L.item('song:a'), L.item('song:b')]);
      const third = await putU([L.item('song:c')]);
      ok('a library that has no address tag is held to its own quarter: two items, the third is 429 share', first.status === 200 && bad(third, 429, 'share'), first.status + ' ' + third.status + ' ' + third.text);
    } finally { await S7.close(); }
    /* the day */
    const S4 = await L.startSync({ libs: ['a'], config: { ingressPerHour: a1 * 100, ingressPerDay: a1 * 8 } });
    try {
      const A = S4.as('a');
      await A.putItems([L.item('song:a'), L.item('song:b')]);
      S4.advance(2 * 3600 * 1000);
      const r = await A.putItems([L.item('song:c')]);
      ok('the day has its own window: two hours later the library\'s quarter of the DAY is still used (429 share)', bad(r, 429, 'share'));
      S4.advance(23 * 3600 * 1000);
      ok('and the next day it is whole', (await A.putItems([L.item('song:c')])).status === 200);
    } finally { await S4.close(); }
    /* egress: a library reads at most its quarter of the site's hour (the answer that crosses is served) */
    const S5 = await L.startSync({ libs: ['a', 'b'], config: { egressPerHour: a1 * 8, egressPerDay: a1 * 100, ingressPerHour: a1 * 1000, ingressPerDay: a1 * 1000 } });
    try {
      const A = S5.as('a');
      await A.putItems([L.item('song:a'), L.item('song:b'), L.item('song:c')]);
      const reads = [];
      for (let i = 0; i < 4; i++) reads.push((await A.items(['song:a', 'song:b', 'song:c'])).status);
      ok('reading is limited to the library\'s quarter of the hour: the answer that crosses it is served (3 items, more than the quarter), the next ones are 429 share', reads.join() === '200,429,429,429', reads.join());
      const r = await A.items(['song:a']);
      ok('the refusal says when (Retry-After) and is the library\'s share, not the site\'s', bad(r, 429, 'share') && +r.headers['retry-after'] >= 60, r.status + ' ' + r.text);
      ok('another library\'s reads are not affected', (await S5.as('b').items(['song:a'])).status === 200);
      const manyKeys = Array.from({ length: 25 }, (_, i) => 'song:none' + i);
      const refusals = [];
      for (let i = 0; i < 15; i++) refusals.push((await A.items(manyKeys)).body.code);
      ok('refused reads do not use up the 300 items an hour: fifteen refused reads of 25 names are all "share" (the items are given back), none is "too-many"', refusals.every(c => c === 'share'), refusals.join());
      S5.advance(61 * 60 * 1000);
      ok('an hour later the library reads again', (await A.items(['song:a'])).status === 200);
    } finally { await S5.close(); }
    /* the budgets for what is served: a read the budget refuses costs the database nothing */
    const S6 = await L.startSync({ libs: ['a'], config: { egressPerHour: 4000, egressPerDay: 40000 } });
    try {
      const A = S6.as('a');
      await A.putItems([L.item('song:a'), L.item('song:b'), L.item('song:c'), L.item('song:d')]);
      for (let i = 0; i < 6; i++) await A.items(['song:a', 'song:b', 'song:c', 'song:d']);
      S6.store.reset();
      const r = await A.items(['song:a']);
      ok('a read that is refused for the budget asks the store for nothing', r.status === 429 && !S6.store.calls.getItems, r.status + ' ' + JSON.stringify(S6.store.calls));
    } finally { await S6.close(); }
  }

  heading('an idle poll runs no statement; the database is told of a library once a day');
  {
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      await A.putItems([L.item('song:one')]);
      S.svc._state.forgetAll();
      S.store.reset();
      let r = await A.changes(1);
      ok('the first request after a boot reads the libraries once (loadAll) and nothing else', r.status === 200 && S.store.calls.loadAll === 1 && S.store.total() === 1, JSON.stringify(S.store.calls));
      S.store.reset();
      S.advance(10 * 60 * 1000);
      for (let i = 0; i < 100; i++) await A.changes(1);
      ok('100 polls that find nothing new (since = the revision the library has) ran ZERO store calls', S.store.total() === 0, JSON.stringify(S.store.calls));
      for (let i = 0; i < 30; i++) { await A.changes(7); }
      ok('... and a device that says it is AHEAD costs one SELECT of the library\'s own row each time (the cache may be the one that is behind) and nothing else', S.store.calls.libState === 30 && S.store.total() === 30, JSON.stringify(S.store.calls));
      S.store.reset();
      S.advance(25 * 3600 * 1000);
      await A.changes(1);
      ok('a day later one poll tells the database the library was used (touchLib) - and no more', S.store.calls.touchLib === 1 && S.store.total() === 1, JSON.stringify(S.store.calls));
      for (let i = 0; i < 50; i++) await A.changes(1);
      ok('and 50 more polls the same day cost nothing', S.store.total() === 1);
      const row = await libRow(S, 'a');
      ok('the time the library was used is what was written', row.lastUsedAt === S.clock.t - 0 || Math.abs(row.lastUsedAt - S.clock.t) < 1000);
      /* a poll that has something to fetch costs ONE statement, the indexed one */
      await A.putItems([L.item('song:two')]);
      S.store.reset();
      r = await A.changes(1);
      ok('a poll that finds something new is one statement (changes)', r.body.items.length === 1 && S.store.calls.changes === 1 && S.store.total() === 1, JSON.stringify(S.store.calls));
      S.store.reset();
      await A.items(['song:two']);
      ok('reading the items is one statement', S.store.calls.getItems === 1 && S.store.total() === 1);
      S.store.reset();
      await A.putItems([L.item('song:three')]);
      ok('a write is ONE statement (conflicts, revisions, counters and rows together)', S.store.calls.putItems === 1 && S.store.total() === 1, JSON.stringify(S.store.calls));
      S.store.reset();
      await A.delItem('song:three', 4);
      ok('a deletion is one statement', S.store.calls.deleteItem === 1 && S.store.total() === 1);
      S.store.reset();
      await A.putItems([L.item('song:two', L.songBody(8), 0)]);
      ok('a write that only conflicts is still one statement and writes nothing', S.store.total() === 1);
    } finally { await S.close(); }
  }

  heading('isolation: a library is its code, and nothing else names it');
  {
    const S = await L.startSync({ libs: ['a', 'b'] });
    try {
      const A = S.as('a'), B = S.as('b');
      await A.putItems([L.item('song:shared', L.songBody(8)), L.item('state', { v: 1, who: 'a' })]);
      await B.putItems([L.item('song:shared', L.songBody(12)), L.item('song:bonly', L.songBody(5)), L.item('state', { v: 1, who: 'b' })]);
      const ra = await A.items(['song:shared', 'state']), rb = await B.items(['song:shared', 'state']);
      const plain = r => r.body.items.map(i => JSON.parse(require('zlib').gunzipSync(Buffer.from(i.body, 'base64')).toString('utf8')));
      ok('the same names in two libraries are two items', plain(ra)[0].score.notes.length === 8 && plain(rb)[0].score.notes.length === 12 && plain(ra)[1].who === 'a' && plain(rb)[1].who === 'b');
      ok('revisions are per library (a has 1 and 2, b has 1, 2 and 3)', ra.body.items.map(i => i.rev).join() === '1,2' && rb.body.items.map(i => i.rev).join() === '1,3');
      const ca = await A.changes(0), cb = await B.changes(0);
      ok('changes show only the library\'s own items', ca.body.items.length === 2 && cb.body.items.length === 3 && ca.body.items.every(i => i.key !== 'song:bonly'));
      /* an item of b is "missing" for a: byte for byte the same answer as a name nobody ever wrote */
      const foreign = await A.items(['song:bonly']), never = await A.items(['song:nobody-ever']);
      ok('a name that only another library has is answered exactly like a name nobody ever wrote (status and body, byte for byte except the name asked)', foreign.status === never.status && foreign.text.replace('song:bonly', 'X') === never.text.replace('song:nobody-ever', 'X'), foreign.text + ' | ' + never.text);
      const delF = await A.delItem('song:bonly', 5), delN = await A.delItem('song:nobody-ever', 5);
      ok('deleting a name only another library has is the same 404 as one nobody wrote', delF.status === 404 && delF.text === delN.text);
      ok('... and it deleted nothing of b\'s', (await B.items(['song:bonly'])).body.items[0].deleted === false);
      /* b's library id and b's tag as a code do not work */
      let r = await A.changes(0, { raw: S.libId('b') });
      ok('a library\'s id is not its code', bad(r, 401, 'bad-code'));
      /* a's code never reaches b's rows through a conflict either */
      r = await A.putItems([L.item('song:bonly', L.songBody(1), 0)]);
      ok('writing a name that only b has is a plain NEW item for a (no conflict, no hint that b has it)', r.status === 200 && r.body.applied[0].rev === 3, r.text);
      ok('(and b\'s own copy is unchanged)', plain(await B.items(['song:bonly']))[0].score.notes.length === 5);
      /* deleting a's library leaves b alone */
      r = await A.del('/api/libs/me');
      ok('deleting a library removes its items and leaves every other library whole', r.status === 200 && (await B.changes(0)).body.items.length === 3 && (await S.inner.changes(S.libId('a'), 0, 99)).length === 0);
    } finally { await S.close(); }
  }

  heading('changing the code, and deleting the library');
  {
    const S = await L.startSync({ libs: ['a', 'b'] });
    try {
      const A = S.as('a');
      await A.putItems([L.item('song:one'), L.item('song:two')]);
      await A.delItem('song:two', 2);
      const before = (await A.changes(0)).body;
      const old = S.code('a');
      let r = await L.req(S.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': old }, body: {} });
      ok('changing the code: 201 with the new code, id and tag, shown once', r.status === 201 && /^[0-9a-f]{64}$/.test(r.body.code) && r.body.code !== old && r.body.rotated === true && r.body.maxRev === 3, r.text.slice(0, 120));
      const neu = r.body.code;
      r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': old } });
      ok('the old code is dead at once: 401 rotated ("enter the new code")', bad(r, 401, 'rotated'), r.status + ' ' + r.text);
      const wrongs = [];
      for (let i = 0; i < 30; i++) wrongs.push((await L.req(S.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': old }, ip: '203.0.113.77' })).status);
      ok('and it is not counted as a wrong code (it was right once): 30 polls with it are all 401, none 429', wrongs.every(s => s === 401), wrongs.join());
      r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': neu } });
      ok('the new code reads the same items, revisions and tombstones', r.status === 200 && JSON.stringify(r.body.items) === JSON.stringify(before.items) && r.body.maxRev === 3);
      r = await L.req(S.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': old }, body: { items: [L.item('song:x')] } });
      ok('a write with the old code is refused the same way (and before its body is read)', bad(r, 401, 'rotated'));
      r = await L.req(S.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': neu }, body: { device: 'a1b2c3d4e5f60718', items: [L.item('song:three')] } });
      ok('and writes go on from the revision it had (4)', r.status === 200 && r.body.applied[0].rev === 4);
      r = await L.req(S.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': old }, body: {} });
      ok('the old code cannot change the code again', bad(r, 401, 'rotated'));
      /* rotating is not making a library: the per-address count of libraries made does not grow */
      const rows = (await S.inner.loadAll()).libs;
      ok('the old row is kept (revoked), the new row names it, and rotating did not make a library (the new row carries the old one\'s birth)', rows.filter(l => l.revokedAt).length === 1 && rows.filter(l => l.rotatedFrom === S.libId('a')).length === 1
        && rows.find(l => l.rotatedFrom === S.libId('a')).createdAt === rows.find(l => l.id === S.libId('a')).createdAt);
      /* deleting */
      const ipA = '198.51.100.123';
      const T = await L.startSync({ memory: true });
      try {
        const codes = [];
        for (let i = 0; i < 5; i++) { const x = await T.anon.post('/api/libs', {}, { ip: ipA }); codes.push(x.body.code); }
        let st = (await T.anon.post('/api/libs', {}, { ip: ipA })).status;
        ok('(five made from one address, the sixth is refused)', st === 429);
        const del = await L.req(T.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': codes[0] } });
        await T.svc._state.purge(T.clock.t);
        st = (await T.anon.post('/api/libs', {}, { ip: ipA })).status;
        ok('making and deleting is no way round the per-address limit: the deleted one still counts for the hour (and a purge run at once does not take it: it is kept two days)', del.status === 200 && st === 429, del.status + ' ' + st);
        const rr = await L.req(T.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': codes[0] } });
        ok('the code of a deleted library says so (401 deleted), and is not counted as a wrong one', bad(rr, 401, 'deleted'));
        ok('the deleted library\'s items are gone from the store', (await T.inner.changes(Sync.libIdOf(Sync.codeHash(codes[0])), 0, 99)).length === 0);
        T.advance(3 * D);
        await T.svc._state.purge(T.clock.t);
        ok('two days later the deleted row is purged from the store', !(await T.inner.loadAll()).libs.some(l => l.id === Sync.libIdOf(Sync.codeHash(codes[0]))));
        ok('and after that its code is simply not a code (401 bad-code)', bad(await L.req(T.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': codes[0] } }), 401, 'bad-code'));
      } finally { await T.close(); }
      /* changing the code is not making a library: it does not use the address's five an hour */
      const U = await L.startSync({ memory: true });
      try {
        const cs = [];
        for (let i = 0; i < 4; i++) cs.push((await U.anon.post('/api/libs', {}, { ip: '198.51.100.124' })).body.code);
        const rot = await L.req(U.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': cs[0] }, body: {} });
        const fifth = await U.anon.post('/api/libs', {}, { ip: '198.51.100.124' });
        const sixth = await U.anon.post('/api/libs', {}, { ip: '198.51.100.124' });
        ok('four libraries made, one of them given a new code: the address may still make its fifth (not its sixth)', rot.status === 201 && fifth.status === 201 && sixth.status === 429, rot.status + ' ' + fifth.status + ' ' + sixth.status);
      } finally { await U.close(); }
    } finally { await S.close(); }
  }

  heading('the keeping times');
  {
    const S = await L.startSync({ libs: ['a', 'b', 'c'] });
    try {
      const keep = n => S.as(n);
      for (const n of ['a', 'b']) await keep(n).putItems([L.item('song:one'), L.item('song:two')]);
      await keep('b').delItem('song:two', 2);
      const t0 = S.clock.t;
      let r = await keep('a').changes(0);
      ok('"kept until" is 180 days from the last use, in every answer', r.body.library.keptUntil === new Date(t0 + 180 * D).toISOString(), r.body.library.keptUntil);
      S.advance(13 * D);
      await S.svc._state.purge(S.clock.t);
      ok('at 13 days all three are there (the empty one c is kept 14 days)', (await S.inner.loadAll()).libs.length === 3);
      S.advance(87 * D);
      r = await keep('b').changes(0);
      ok('a read counts as using the library (U2: the last sync of any device): at day 100 b\'s date moves, a\'s does not', r.body.library.keptUntil === new Date(S.clock.t + 180 * D).toISOString() && (await libRow(S, 'a')).lastUsedAt === t0);
      S.advance(79 * D);
      await S.svc._state.purge(S.clock.t);
      let libs = (await S.inner.loadAll()).libs.map(l => l.id).sort();
      ok('at 179 days a and b are there; the empty c went at 14 days', libs.join() === [S.libId('a'), S.libId('b')].sort().join(), libs.join());
      S.advance(2 * D);
      await S.svc._state.purge(S.clock.t);
      libs = (await S.inner.loadAll()).libs.map(l => l.id);
      ok('at 181 days a and its items are gone, b (read at day 100) stays', libs.length === 1 && libs[0] === S.libId('b'), libs.join());
      ok('a\'s items are gone from the store with it', (await S.inner.changes(S.libId('a'), 0, 99)).length === 0);
      ok('and a\'s code is no code any more', bad(await keep('a').changes(0), 401, 'bad-code'));
      const orphan = await S.inner.loadAll();
      ok('no item of a purged library is left (none is an orphan)', orphan.orphanItems === 0);
    } finally { await S.close(); }
    /* an empty library: 14 days from its last use */
    const S2 = await L.startSync({ libs: ['e'] });
    try {
      S2.advance(13 * D);
      await S2.svc._state.purge(S2.clock.t);
      ok('an empty library is kept 13 days', (await S2.inner.loadAll()).libs.length === 1);
      await S2.as('e').changes(0);
      S2.advance(13 * D);
      await S2.svc._state.purge(S2.clock.t);
      ok('a use renews it (14 days from the last use, not from the day it was made)', (await S2.inner.loadAll()).libs.length === 1);
      S2.advance(2 * D);
      await S2.svc._state.purge(S2.clock.t);
      ok('and it goes 14 days after its last use', (await S2.inner.loadAll()).libs.length === 0);
    } finally { await S2.close(); }
    /* a library of tombstones only still has what can be brought back */
    const S3 = await L.startSync({ libs: ['t'] });
    try {
      const T = S3.as('t');
      await T.putItems([L.item('song:one'), L.item('song:two')]);
      await T.delItem('song:one', 1); await T.delItem('song:two', 2);
      S3.advance(20 * D);
      await T.changes(0);
      S3.advance(10 * D);
      await S3.svc._state.purge(S3.clock.t);
      ok('a library holding only tombstones is not "empty" while they are kept (they are what "recently deleted" shows)', (await S3.inner.loadAll()).libs.length === 1);
    } finally { await S3.close(); }
    /* tombstones: 30 days */
    const S4 = await L.startSync({ libs: ['a'] });
    try {
      const A = S4.as('a');
      await A.putItems([L.item('song:one'), L.item('song:two'), L.item('song:three')]);
      await A.delItem('song:one', 1);
      S4.advance(10 * D);
      await A.delItem('song:two', 2);
      S4.advance(19 * D);
      await S4.svc._state.purge(S4.clock.t);
      let r = await A.changes(0);
      ok('at 29 days both tombstones are still there', r.body.items.filter(x => x.deleted).length === 2 && r.body.library.tombs === 2);
      S4.advance(2 * D);
      S4.store.reset();
      await S4.svc._state.purge(S4.clock.t);
      ok('the purge of tombstones is ONE statement', S4.store.calls.purge === 1 && S4.store.total() === 1, JSON.stringify(S4.store.calls));
      r = await A.changes(0);
      ok('at 31 days the first tombstone is gone, the second (made 10 days later) is not; the counters follow', r.body.items.filter(x => x.deleted).map(x => x.key).join() === 'song:two' && r.body.library.tombs === 1 && r.body.library.items === 1, JSON.stringify(r.body.library));
      const lib = await libRow(S4, 'a');
      const rows = await ownRows(S4, 'a');
      ok('the stored counters equal the rows after it', lib.tombs === 1 && lib.items === 1 && lib.bytes === rows.reduce((n, x) => n + (x.deleted ? ROW : x.bytes + ROW), 0), JSON.stringify(lib));
      S4.advance(10 * D);
      await S4.svc._state.purge(S4.clock.t);
      ok('and the second at its own 30 days', (await A.changes(0)).body.library.tombs === 0);
      S4.store.reset();
      await S4.svc._state.purge(S4.clock.t + 10000);
      ok('a purge with nothing to purge runs no statement', S4.store.total() === 0, JSON.stringify(S4.store.calls));
    } finally { await S4.close(); }
    /* the lazy purge: at most every 6 hours, piggybacked on a write */
    const S5 = await L.startSync({ libs: ['a', 'b'] });
    try {
      await S5.as('a').putItems([L.item('song:one')]);
      S5.advance(200 * D);
      S5.store.reset();
      await S5.as('b').changes(0);
      await S5.as('b').putItems([L.item('song:z')]);
      ok('a write purges what ran out (a ran out): the libraries are gone from the store without a call of the test', !(await S5.inner.loadAll()).libs.some(l => l.id === S5.libId('a')), JSON.stringify(S5.store.calls));
    } finally { await S5.close(); }
    /* item rows that no library names */
    const S6 = await L.startSync({ libs: ['a'] });
    try {
      await S6.as('a').putItems([L.item('song:one')]);
      const fs = L.fs, pth = L.path.join(S6.dir, 'sync.json');
      const d = JSON.parse(fs.readFileSync(pth, 'utf8'));
      d.items.lib_ffffffffffffffffffffff = { 'song:ghost': { rev: 1, deletedAt: 0, hash: 'x', device: '', bytes: 10, body: Buffer.from('x').toString('base64'), updatedAt: 1 } };
      fs.writeFileSync(pth, JSON.stringify(d));
      S6.svc._state.forgetAll();
      S6.store.reset();
      await S6.as('a').changes(1);
      const left = JSON.parse(fs.readFileSync(pth, 'utf8')).items;
      ok('item rows no library names are found at the boot read and deleted by the purge', !left.lib_ffffffffffffffffffffff && S6.store.calls.deleteOrphans === 1, JSON.stringify(Object.keys(left)));
    } finally { await S6.close(); }
  }

  heading('races: the same moment, twelve times');
  {
    const S = await L.startSync({ memory: true, libs: ['a'] });
    try {
      const ip = '198.51.100.222';
      const made = await Promise.all(Array.from({ length: 12 }, () => S.anon.post('/api/libs', {}, { ip: ip })));
      ok('twelve libraries made at once from one address: exactly five are made (the place is taken before anything is awaited)', made.filter(x => x.status === 201).length === 5 && made.filter(x => x.status === 429).length === 7, made.map(x => x.status).join());
      ok('and the codes are all different', new Set(made.filter(x => x.status === 201).map(x => x.body.code)).size === 5);
      {
        /* a store that takes its time: the place of a library being made must be taken before the store is asked, or twelve at once all pass the limit */
        const innerS = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-slowmake-'), { memory: true });
        const slowMake = Object.assign({}, innerS, { createLib: async function () { await sleep(80); return innerS.createLib.apply(innerS, arguments); } });
        const Tm = await L.startSync({ store: slowMake });
        try {
          const m2 = await Promise.all(Array.from({ length: 12 }, () => Tm.anon.post('/api/libs', {}, { ip: '198.51.100.230' })));
          ok('with a store that takes 80 ms, twelve libraries made at once from one address are still exactly five: the place is taken before the store is asked', m2.filter(x => x.status === 201).length === 5 && m2.filter(x => x.status === 429).length === 7, m2.map(x => x.status).join());
        } finally { await Tm.close(); }
      }
      const codes = made.filter(x => x.status === 201).map(x => x.body.code);
      const rot = await Promise.all(Array.from({ length: 12 }, () => L.req(S.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': codes[0] }, body: {} })));
      ok('twelve code changes at once with one code: exactly one succeeds, the others are told "rotated" (or 429)', rot.filter(x => x.status === 201).length === 1 && rot.filter(x => x.status !== 201).every(x => (x.status === 401 && x.body.code === 'rotated') || x.status === 429), rot.map(x => x.status + (x.body && x.body.code ? ':' + x.body.code : '')).join());
      const libs = (await S.inner.loadAll()).libs.filter(l => l.rotatedFrom);
      ok('and only ONE library was made of it', libs.length === 1);
      const put = await Promise.all(Array.from({ length: 12 }, () => S.as('a').putItems([L.item('song:race', L.songBody(8), 0)])));
      const wins = put.filter(x => x.status === 200).length;
      ok('twelve writes of one name from base 0 at once: exactly one is written, the rest are told to wait (429 in-flight) or are conflicts (409) - never two writers', wins === 1 && put.every(x => [200, 409, 429].indexOf(x.status) >= 0), put.map(x => x.status).join());
      ok('one row, revision 1', (await ownRows(S, 'a')).filter(x => x.key === 'song:race').length === 1 && (await S.as('a').changes(0)).body.items.filter(i => i.key === 'song:race')[0].rev === 1);
      /* two writers of different devices one after the other (the real race): the second is a conflict, not an overwrite */
      const w1 = await S.as('a').putItems([L.item('song:two', L.songBody(8), 0)]);
      const w2 = await S.as('a').putItems([L.item('song:two', L.songBody(9), 0)]);
      ok('a second device that wrote from the same base after the first is a conflict (409) and the first one\'s body stands', w1.status === 200 && w2.status === 409 && (await S.as('a').items(['song:two'])).body.items[0].body === L.item('song:two', L.songBody(8), 0).body);
      /* write and delete at once */
      const mix = await Promise.all([S.as('a').putItems([L.item('song:two', L.songBody(10), w1.body.applied[0].rev)]), S.as('a').delItem('song:two', w1.body.applied[0].rev)]);
      const final = (await S.as('a').changes(0)).body.items.find(i => i.key === 'song:two');
      ok('a write and a delete of the same item at once: one of them is applied, the other is refused or conflicts, and the item is in a state one of them made', mix.filter(x => x.status === 200).length >= 1 && !!final, mix.map(x => x.status).join());
      const lib = await libRow(S, 'a');
      const rows = await ownRows(S, 'a');
      ok('the counters equal the rows after all of it', lib.items === rows.filter(x => !x.deleted).length && lib.tombs === rows.filter(x => x.deleted).length && lib.bytes === rows.reduce((n, x) => n + (x.deleted ? ROW : x.bytes + ROW), 0));
    } finally { await S.close(); }
  }

  heading('a restart, and a store that fails');
  {
    const dirStore = L.tmpDir('ppp-sync-restart-');
    const mkStore = () => SS.fileSyncStore(dirStore);
    const S1 = await L.startSync({ store: mkStore(), libs: ['a'] });
    let creds;
    try {
      await S1.as('a').putItems([L.item('song:one'), L.item('song:two')]);
      await S1.as('a').delItem('song:one', 1);
      creds = S1.creds();
      for (let i = 0; i < 4; i++) await S1.anon.post('/api/libs', {}, { ip: '198.51.100.55' });
    } finally { await S1.close(); }
    const S2 = await L.startSync({ store: mkStore(), resume: creds });
    try {
      const r = await S2.as('a').changes(0);
      ok('a restart keeps the library: the same code, items, revisions, tombstones, counters', r.status === 200 && r.body.items.length === 2 && r.body.maxRev === 3 && r.body.library.items === 1 && r.body.library.tombs === 1, r.text.slice(0, 200));
      const more = await S2.anon.post('/api/libs', {}, { ip: '198.51.100.55' });
      const over = await S2.anon.post('/api/libs', {}, { ip: '198.51.100.55' });
      ok('the per-address count of libraries made survives a restart (it is counted from the rows): the 5th is made, the 6th is not', more.status === 201 && over.status === 429, more.status + ' ' + over.status);
      const w = await S2.as('a').putItems([L.item('song:three')]);
      ok('and writes go on from the stored revision', w.status === 200 && w.body.applied[0].rev === 4);
    } finally { await S2.close(); L.rmDir(dirStore); }
    /* a store that fails: 503 store, nothing half done, the next request is right */
    const S3 = await L.startSync({ libs: ['a'] });
    try {
      const A = S3.as('a');
      await A.putItems([L.item('song:one')]);
      const before = (await A.changes(0)).body;
      S3.store.fail.on = true; S3.store.fail.only = 'putItems';
      let r = await A.putItems([L.item('song:two')]);
      ok('a write while the store is down: 503 store (a sentence, no stack, no SQL)', bad(r, 503, 'store') && !/at |Error|SELECT|INSERT/.test(r.text), r.status + ' ' + r.text);
      S3.store.fail.on = false;
      r = await A.changes(0);
      ok('and the library is as it was (nothing was counted that was not written)', r.status === 200 && JSON.stringify(r.body.items) === JSON.stringify(before.items) && r.body.library.bytes === before.library.bytes);
      r = await A.putItems([L.item('song:two')]);
      ok('the next write works, with the next revision', r.status === 200 && r.body.applied[0].rev === 2);
      S3.store.fail.on = true; S3.store.fail.only = 'loadAll';
      S3.svc._state.forgetAll();
      r = await A.changes(2);
      ok('a store that cannot be read at the first request: 503 store, and the next request (the store is back) is answered', bad(r, 503, 'store'));
      S3.store.fail.on = false;
      ok('... answered', (await A.changes(2)).status === 200);
      S3.store.fail.on = true; S3.store.fail.only = 'touchLib';
      S3.advance(2 * D);
      ok('a store that fails only the daily touch does not fail the request', (await A.changes(2)).status === 200);
      S3.store.fail.on = false;
      /* a write that was made durable but whose answer was lost: the memory is the database's after it */
      S3.store.fail.on = true; S3.store.fail.only = 'deleteItem';
      r = await A.delItem('song:one', 1);
      ok('a failed deletion is a 503, not a half deletion', bad(r, 503, 'store'));
      S3.store.fail.on = false;
      ok('the item is still there and the counters are right', (await A.items(['song:one'])).body.items[0].deleted === false && (await A.changes(2)).body.library.tombs === 0);
    } finally { await S3.close(); }
    {
      /* a write that is made durable and whose answer is lost (the connection dropped after the commit) */
      const innerL = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-lost-'), { memory: true });
      const flag = { throwAfter: false };
      const lossy = Object.assign({}, innerL, { putItems: async function () { const x = await innerL.putItems.apply(innerL, arguments); if (flag.throwAfter) throw new Error('the answer was lost'); return x; } });
      const S5 = await L.startSync({ store: lossy, libs: ['a'] });
      try {
        const A = S5.as('a');
        await A.putItems([L.item('song:one')]);
        flag.throwAfter = true;
        const lost = await A.putItems([L.item('song:two')]);
        flag.throwAfter = false;
        const after = await A.changes(1);
        ok('a write that was made durable but whose answer was lost is a 503 for its sender and is not lost for the others: the library is read again and the next poll sees it (revision 2)',
          bad(lost, 503, 'store') && after.status === 200 && after.body.items.length === 1 && after.body.items[0].key === 'song:two' && after.body.maxRev === 2, JSON.stringify([lost.status, after.body && after.body.maxRev]));
      } finally { await S5.close(); }
    }
    const S4 = await L.startSync({ libs: ['a'] });
    try {
      S4.svc.disable('tables could not be made');
      const n0 = S4.store.total();
      const r = await S4.as('a').changes(0);
      const r2 = await S4.anon.post('/api/libs', {});
      ok('a feature that is switched off answers 503 store with disabled:true on every route (making a library too), and asks the store for nothing', r.status === 503 && r.body.code === 'store' && r.body.disabled === true && r2.status === 503 && r2.body.disabled === true && S4.store.total() === n0, r.text);
    } finally { await S4.close(); }
  }

  heading('the position a device is given, what a page of changes costs, a library that moved on without the cache');
  {
    /* the reviewer's reproduction: the rows travel back while another device writes */
    const innerS = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-pos-'), { memory: true });
    let delay = 0, after = false;
    const slow = Object.assign({}, innerS, { changes: async function () {
      if (after && delay) await sleep(delay);                      /* the query runs after the other device's write */
      const r = await innerS.changes.apply(innerS, arguments);     /* ... or before it: the rows are those of the moment it ran */
      if (!after && delay) await sleep(delay);                     /* ... and travel back for a while */
      return r;
    } });
    const S = await L.startSync({ store: slow, libs: ['a'] });
    try {
      const A = S.as('a');
      let r = await A.putItems([L.item('song:s1'), L.item('song:s2')]);
      delay = 400; after = false;
      const poll = A.changes(0);
      await sleep(100);
      const w = await A.putItems([L.item('song:s3')]);
      const got = await poll;
      ok('a device polls from 0 while another writes revision 3: the answer lists revisions 1 and 2 and its position is 2 - not 3, which it was never given', w.status === 200 && got.status === 200
        && got.body.items.map(i => i.rev).join() === '1,2' && got.body.nextSince === 2 && got.body.maxRev === 2, JSON.stringify([got.body.items.map(i => i.rev), got.body.nextSince, got.body.maxRev]));
      delay = 0;
      const next = await A.changes(got.body.nextSince);
      ok('and the next poll from that position delivers revision 3', next.body.items.map(i => i.key).join() === 'song:s3' && next.body.nextSince === 3);
      /* the other order: the query runs after the write, so the answer holds revision 3 and the position says 3 (nothing is held back or skipped) */
      delay = 300; after = true;
      const poll2 = A.changes(0);
      await sleep(80);
      await A.putItems([L.item('song:s4')]);
      const got2 = await poll2;
      ok('a query that ran after the write lists it and its position is past it: the position is the highest of the library\'s revision when the poll began and the last row listed', got2.body.items.map(i => i.rev).join() === '1,2,3,4' && got2.body.nextSince === 4 && got2.body.maxRev === 4, JSON.stringify([got2.body.items.map(i => i.rev), got2.body.nextSince]));
    } finally { await S.close(); }
  }
  {
    /* the metadata of a page of changes is bytes out of the database: counted against the budgets (the reviewer measured 92.6 KB for a page of 500) */
    const S = await L.startSync({ libs: ['a', 'b'], memory: true, config: { egressPerHour: 400000, egressPerDay: 4000000 } });
    try {
      const A = S.as('a');
      for (let b = 0; b < 20; b++) {
        if (b % 9 === 8) S.advance(61 * 60 * 1000);
        const r = await A.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:m' + (b * 25 + i), L.songBody(2))));
        if (r.status !== 200) throw new Error('fixture ' + r.status + ' ' + r.text.slice(0, 100));
      }
      S.advance(61 * 60 * 1000);
      const out0 = S.svc.gauge(false).bytesOut;
      const r1 = await A.changes(0);
      const out1 = S.svc.gauge(false).bytesOut;
      ok('a page of 500 rows is ' + r1.text.length + ' bytes (' + Math.round(r1.text.length / 500) + ' a row) and what was charged is exactly what was sent', r1.status === 200 && r1.body.items.length === 500 && out1 - out0 === Buffer.byteLength(r1.text), out1 - out0 + ' vs ' + Buffer.byteLength(r1.text));
      const r2 = await A.changes(0);
      const r3 = await A.changes(0);
      ok('a library\'s quarter of the hour (100,000 here) is two pages: the second crosses it and is served, the third is 429 share with a Retry-After - before the database is asked', r2.status === 200 && bad(r3, 429, 'share') && +r3.headers['retry-after'] >= 60, r2.status + ' ' + r3.status + ' ' + r3.text);
      S.store.reset();
      const r4 = await A.changes(0);
      ok('a refused poll asks the store for nothing', r4.status === 429 && !S.store.calls.changes, JSON.stringify(S.store.calls));
      ok('a poll that finds nothing new is still free and never refused for it (the answer is a few bytes from memory)', (await A.changes(500)).status === 200);
      const nB = await S.as('b').putItems([L.item('song:one', L.songBody(2))]);
      ok('another library is not held up by it', nB.status === 200 && (await S.as('b').changes(0)).status === 200);
      S.advance(61 * 60 * 1000);
      ok('and an hour later the page is served again', (await A.changes(0)).status === 200);
    } finally { await S.close(); }
    /* the day: the site's 150 MB a day cannot be reached by polling a library of 500 small songs */
    const S2 = await L.startSync({ libs: ['a'], memory: true, config: { egressPerHour: 64 * L.MiB, egressPerDay: 400000 } });
    try {
      const A = S2.as('a');
      for (let b = 0; b < 20; b++) { if (b % 9 === 8) S2.advance(61 * 60 * 1000); await A.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:m' + (b * 25 + i), L.songBody(2)))); }
      S2.advance(61 * 60 * 1000);
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await A.changes(0)).status);
      ok('the day has its own share: a library of 500 songs polled from 0 gets its quarter of the day (100,000 here: two pages), then 429', codes.slice(0, 2).every(s => s === 200) && codes.slice(2).every(s => s === 429), codes.join());
    } finally { await S2.close(); }
  }
  {
    /* concurrent reads: the worst case is reserved before the store is asked (the reviewer measured 34.5 MB served against a 2 MB share) */
    const innerS = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-resv-'), { memory: true });
    let delay = 0;
    const slow = Object.assign({}, innerS, { getItems: async function () { if (delay) await sleep(delay); return innerS.getItems.apply(innerS, arguments); } });
    const S = await L.startSync({ store: slow, libs: ['a'], config: { egressPerHour: 8 * L.MiB, egressPerDay: 80 * L.MiB, ingressPerHour: 64 * L.MiB, ingressPerDay: 128 * L.MiB } });
    try {
      const A = S.as('a');
      const big = (k, i) => L.item(k, Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(520 * 1024).toString('base64') + i } }));
      await A.putItems([big('song:r0', 0), big('song:r1', 1), big('song:r2', 2), big('song:r3', 3), L.item('song:tiny')]);
      const keys = ['song:r0', 'song:r1', 'song:r2', 'song:r3'];
      delay = 300;
      const six = await Promise.all(Array.from({ length: 6 }, () => A.items(keys)));
      const served = six.filter(x => x.status === 200);
      const bytes = served.reduce((n, x) => n + x.body.items.reduce((m, i) => m + (i.bytes || 0), 0), 0);
      const one = served.length ? bytes / served.length : 0;
      ok('six reads at the same moment of a library whose quarter of the hour is 2 MiB (each answer is about 2.1 MB): the first reserves its worst case before the store is asked, so one or two are served and the others are 429 share - not six',
        served.length >= 1 && served.length <= 2 && six.filter(x => x.status === 429 && x.body.code === 'share').length === 6 - served.length, six.map(x => x.status).join() + ' served ' + bytes);
      ok('what was served is the share and at most one answer more (' + Math.round(bytes / 1024) + ' KB of ' + Math.round(2 * L.MiB / 1024) + ' KB + one answer); six answers are 12.5 MB', bytes <= 2 * L.MiB + one + 1, String(bytes));
      delay = 0;
      S.advance(61 * 60 * 1000);
      /* the reservation is given back: reading one small song of a big library, over and over, is not charged for its worst case */
      const small = [];
      for (let i = 0; i < 12; i++) small.push((await A.items(['song:tiny'])).status);
      ok('reading one small song of a library of 2 MB twelve times is not charged for the 1 MB it could have been each time: the reservation is settled to what was sent', small.every(s => s === 200), small.join());
    } finally { await S.close(); }
  }
  {
    /* a device ahead of what the cache knows: the library's own row is read before it is told "reset" */
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      await A.putItems([L.item('song:one')]);
      /* another process wrote: the database is at revision 3, this process's memory at 1 */
      const w = await S.inner.putItems(S.libId('a'), [{ key: 'song:two', base: 0, hash: 'h'.repeat(16), bytes: 30, body: Buffer.alloc(30, 1), device: '' }, { key: 'song:three', base: 0, hash: 'h'.repeat(16), bytes: 30, body: Buffer.alloc(30, 2), device: '' }],
        S.clock.t, { growthMax: 1e9, rowsRoom: 1e6 });
      ok('(fixture: the store is ahead of the service\'s memory)', w.ok && w.maxRev === 3 && S.svc._state.libs.get(S.libId('a')).maxRev === 1);
      const r = await A.changes(3);
      ok('a device that has revision 3 is not told "reset" by a cache that is at 1: the library\'s row is read, the answer is a normal "nothing new" with the revision 3, and the memory moved on', r.status === 200 && !r.body.reset && r.body.maxRev === 3 && r.body.items.length === 0 && S.svc._state.libs.get(S.libId('a')).maxRev === 3, JSON.stringify(r.body).slice(0, 160));
      const r2 = await A.changes(1);
      ok('and a device that is behind it now gets the two rows', r2.body.items.map(i => i.key).join() === 'song:two,song:three');
      const r3 = await A.changes(9);
      ok('a device that is really ahead (9, the library is at 3) is told "reset" with the revision the library has', r3.body.reset === true && r3.body.maxRev === 3);
      /* a deleted library is not read back */
      S.store.reset();
      await A.changes(50);
      ok('the SELECT is counted like a poll that asks the database (the hour of the library and of the address)', S.store.calls.libState === 1 && S.store.total() === 1, JSON.stringify(S.store.calls));
    } finally { await S.close(); }
  }

  heading('a device that was away: tombstones that were purged, items that are gone, a retried write');
  {
    const S = await L.startSync({ libs: ['a'] });
    try {
      const A = S.as('a');
      await A.putItems([L.item('song:one'), L.item('song:two'), L.item('song:three')]);
      await A.delItem('song:one', 1);                                  /* revision 4 */
      let r = await A.changes(0);
      ok('no tombstone has been purged: the answer has no tooOld', r.body.tooOld === undefined && r.body.purgedThrough === undefined);
      S.advance(31 * D);
      await S.svc._state.purge(S.clock.t);
      r = await A.changes(2);
      ok('a device that last saw revision 2, when the tombstone of revision 4 has been purged: tooOld:true with the revision (purgedThrough 4) - it may have missed the deletion and must ask before it pushes', r.status === 200 && r.body.tooOld === true && r.body.purgedThrough === 4 && r.body.items.map(i => i.key).join() === 'song:three', JSON.stringify(r.body).slice(0, 200));
      r = await A.changes(4);
      ok('a device that has seen revision 4 is not too old (and a poll with nothing new is the idle answer)', r.status === 200 && r.body.tooOld === undefined);
      /* the number is kept by the library and by its new code */
      const rot = await L.req(S.port, 'POST', '/api/libs/me/rotate', { headers: { 'X-PPP-Lib': S.code('a') }, body: {} });
      const r5 = await L.req(S.port, 'GET', '/api/sync/changes?since=1', { headers: { 'X-PPP-Lib': rot.body.code } });
      ok('purgedThrough survives a new code', r5.body.tooOld === true && r5.body.purgedThrough === 4);
      S.svc._state.forgetAll();
      const r6 = await L.req(S.port, 'GET', '/api/sync/changes?since=1', { headers: { 'X-PPP-Lib': rot.body.code } });
      ok('... and a restart (it is a column of the library)', r6.body.tooOld === true && r6.body.purgedThrough === 4);
      /* a write that names a revision of a row that is not there */
      const B = { put: (list, o) => L.req(S.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': rot.body.code }, body: { device: 'a1b2c3d4e5f60718', items: list } }) };
      let w = await B.put([L.item('song:one', L.songBody(9), 4)]);
      ok('a write over revision 4 of a song whose tombstone is gone is a conflict `gone` (409), nothing is written: a stale device must not bring a deleted song back without saying so', w.status === 409 && w.body.conflicts.length === 1 && w.body.conflicts[0].gone === true && w.body.conflicts[0].key === 'song:one' && w.body.applied.length === 0, JSON.stringify(w.body).slice(0, 220));
      const c = await L.req(S.port, 'GET', '/api/sync/items?keys=song%3Aone', { headers: { 'X-PPP-Lib': rot.body.code } });
      ok('(and no row was made)', c.body.missing.join() === 'song:one');
      w = await B.put([L.item('song:never', L.songBody(9), 3)]);
      ok('a revision of a song the library never had is `gone` as well', w.status === 409 && w.body.conflicts[0].gone === true);
      w = await B.put([L.item('song:one', L.songBody(9), 0), L.item('song:two', L.songBody(9), 2)]);
      ok('saying so (base 0) brings it back as a new item, and the other items of a batch are not held up by a gone one', w.status === 200 && w.body.applied.length === 2);
      w = await B.put([L.item('song:ghost', L.songBody(9), 7), L.item('song:fresh', L.songBody(9), 0)]);
      ok('a batch with one gone item applies the others and is 409', w.status === 409 && w.body.applied.map(a => a.key).join() === 'song:fresh' && w.body.conflicts[0].gone === true && w.body.conflicts[0].key === 'song:ghost', JSON.stringify(w.body).slice(0, 200));
    } finally { await S.close(); }
    /* a retried write whose answer was lost */
    const S2 = await L.startSync({ libs: ['a'] });
    try {
      const A = S2.as('a');
      const it = L.item('song:retry', L.songBody(8), 0);
      const first = await A.putItems([it]);
      const again = await A.putItems([it]);
      ok('a write that is sent again after its answer was lost comes back 409 with the server\'s own metadata, and its hash equals the one that was sent: that is "applied" (G13-S1 reads it so)', first.status === 200 && again.status === 409
        && again.body.conflicts[0].hash === it.hash && again.body.conflicts[0].rev === first.body.applied[0].rev, JSON.stringify(again.body.conflicts));
    } finally { await S2.close(); }
  }

  heading('the recovery code: a second secret that can only give the library a new code');
  {
    const S = await L.startSync({ memory: true });
    try {
      const mk = await S.anon.post('/api/libs', {}, { ip: '198.51.100.140' });
      const code = mk.body.code, rec = mk.body.recovery;
      ok('making a library shows the code and a recovery code, once: two different 64-hex secrets', mk.status === 201 && /^[0-9a-f]{64}$/.test(rec) && rec !== code);
      const lib = (await S.inner.loadAll()).libs[0];
      ok('only the hash of the recovery code is stored (and not the hash of the code: a different domain)', lib.recoveryHash !== rec && /^[0-9a-f]{64}$/.test(lib.recoveryHash)
        && lib.recoveryHash === Sync.recoveryHashOf(rec).toString('hex') && lib.recoveryHash !== lib.hash);
      const H = c => ({ headers: { 'X-PPP-Lib': c } });
      await L.req(S.port, 'PUT', '/api/sync/items', Object.assign({ body: { items: [L.item('song:one')] } }, H(code)));
      let r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', H(rec));
      ok('the recovery code is not a library code: it opens nothing (401 bad-code, counted)', bad(r, 401, 'bad-code'));
      r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Recovery': rec } });
      ok('and sent as the recovery header to a route that reads: no code at all (401 no-lib)', bad(r, 401, 'no-lib'));
      r = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { Origin: 'https://evil.example', 'X-PPP-Recovery': rec } });
      ok('another origin: 403 cross-site, before the recovery code is read', bad(r, 403, 'cross-site'));
      r = await L.req(S.port, 'POST', '/api/libs/recover', { body: {} });
      ok('no recovery header: 401 no-recovery', bad(r, 401, 'no-recovery'));
      r = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': code } });
      ok('the library code is not a recovery code (401 bad-recovery)', bad(r, 401, 'bad-recovery'));
      r = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': rec } });
      ok('the recovery code gives the library a new code AND a new recovery code (it is used once): 201, the items and revisions are there', r.status === 201 && /^[0-9a-f]{64}$/.test(r.body.code) && r.body.code !== code && /^[0-9a-f]{64}$/.test(r.body.recovery) && r.body.recovery !== rec && r.body.recovered === true && r.body.maxRev === 1, r.text.slice(0, 160));
      const neu = r.body;
      r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', H(neu.code));
      ok('the new code reads the library', r.status === 200 && r.body.items.length === 1);
      r = await L.req(S.port, 'GET', '/api/sync/changes?since=0', H(code));
      ok('the old code is `rotated`', bad(r, 401, 'rotated'));
      r = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': rec } });
      ok('the recovery code that was used is not valid any more (401 bad-recovery)', bad(r, 401, 'bad-recovery'));
      r = await L.req(S.port, 'POST', '/api/libs/me/rotate', Object.assign({ body: {} }, H(neu.code)));
      ok('a change of code with the code keeps the recovery code as it was (it is shown once): the recovery of the new library still works after it', r.status === 201 && !r.body.recovery);
      const afterRotate = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': neu.recovery } });
      ok('... and does give the library a new code', afterRotate.status === 201 && afterRotate.body.code !== r.body.code);
      /* the rows after a restart */
      S.svc._state.forgetAll();
      const n2 = afterRotate.body;
      const again = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': n2.recovery } });
      ok('a restart keeps the recovery code (a column of the library)', again.status === 201);
      /* a deleted library cannot be recovered */
      const del = await L.req(S.port, 'DELETE', '/api/libs/me', H(again.body.code));
      const gone = await L.req(S.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': again.body.recovery } });
      ok('a deleted library is not recovered: 401 bad-recovery', del.status === 200 && bad(gone, 401, 'bad-recovery'));
    } finally { await S.close(); }
    /* the index finds a row by the first 22 hex of the hash of the recovery code; the whole hash is compared */
    const S3 = await L.startSync({});
    try {
      const rc = 'ab'.repeat(32);
      const full = Sync.recoveryHashOf(rc).toString('hex');
      await S3.inner.createLib({ id: 'lib_' + '5'.repeat(22), hash: 'cd'.repeat(32), recoveryHash: full.slice(0, 22) + '0'.repeat(42), createdAt: S3.clock.t, ipTag: '' }, 100);
      let r = await L.req(S3.port, 'POST', '/api/libs/recover', { body: {}, headers: { 'X-PPP-Recovery': rc } });
      ok('a row the index finds by the start of the hash but whose stored hash is not that of the recovery code: refused (the whole hash is compared)', bad(r, 401, 'bad-recovery'), r.status + ' ' + r.text.slice(0, 100));
      await S3.inner.createLib({ id: 'lib_' + '6'.repeat(22), hash: 'ef'.repeat(32), recoveryHash: Sync.recoveryHashOf('cd'.repeat(32)).toString('hex'), createdAt: S3.clock.t, ipTag: '' }, 100);
      S3.svc._state.forgetAll();
      r = await L.req(S3.port, 'POST', '/api/libs/recover', { body: {}, ip: '203.0.113.88', headers: { 'X-PPP-Recovery': 'cd'.repeat(32) } });
      ok('... and a row that is right is let in', r.status === 201, r.status + ' ' + r.text.slice(0, 100));
      ok('the hash of a recovery code is of a domain of its own: the same 64 hex hash differently as a code and as a recovery code', !Sync.recoveryHashOf(rc).equals(Sync.codeHash(rc)));
    } finally { await S3.close(); }
    /* failures are counted like wrong codes; successes are limited like a change of code */
    const S2 = await L.startSync({ memory: true });
    try {
      const mk = await S2.anon.post('/api/libs', {}, { ip: '198.51.100.141' });
      const wrongs = [];
      for (let i = 0; i < 25; i++) wrongs.push((await L.req(S2.port, 'POST', '/api/libs/recover', { body: {}, ip: '203.0.113.77', headers: { 'X-PPP-Recovery': L.crypto.randomBytes(32).toString('hex') } })).status);
      ok('20 wrong recovery codes an hour from one address are 401, then 429 (the same count as wrong codes)', wrongs.slice(0, 20).every(s => s === 401) && wrongs.slice(20).every(s => s === 429), wrongs.join());
      const okOne = await L.req(S2.port, 'POST', '/api/libs/recover', { body: {}, ip: '203.0.113.78', headers: { 'X-PPP-Recovery': mk.body.recovery } });
      ok('a right one from another address is let through', okOne.status === 201);
      let cur = okOne.body, res = [];
      for (let i = 0; i < 6; i++) { const x = await L.req(S2.port, 'POST', '/api/libs/recover', { body: {}, ip: '203.0.113.79', headers: { 'X-PPP-Recovery': cur.recovery } }); res.push(x.status); if (x.status === 201) cur = x.body; }
      ok('recoveries and changes of code share the 5 an hour of a library (the first one above was the first): the 5th and 6th are 429', res.join() === '201,201,201,201,429,429', res.join());
    } finally { await S2.close(); }
  }

  heading('a hung store does not freeze the writer');
  {
    const innerS = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-hang-'), { memory: true });
    const hang = { lib: null };
    const stuck = Object.assign({}, innerS, { putItems: function (libId) { if (hang.lib && libId === hang.lib) return new Promise(() => {}); return innerS.putItems.apply(innerS, arguments); } });
    const S = await L.startSync({ store: stuck, libs: ['a', 'b'], config: { storeTimeoutMs: 400 } });
    try {
      await S.as('a').putItems([L.item('song:one')]);
      hang.lib = S.libId('a');
      const t0 = Date.now();
      const first = S.as('a').putItems([L.item('song:two')], { ip: '198.51.100.201' });
      await sleep(50);
      const other = await S.as('b').putItems([L.item('song:other')], { ip: '198.51.100.202' });
      const f = await first;
      ok('a write whose store call never comes back is a 503 store after the time-out (400 ms here, 15 s in production)', bad(f, 503, 'store') && Date.now() - t0 >= 350 && Date.now() - t0 < 3000, f.status + ' ' + (Date.now() - t0));
      ok('and the writer is not held for ever: another library\'s write (queued behind it) is served as soon as the time-out has passed', other.status === 200 && Date.now() - t0 < 3000, other.status + ' ' + (Date.now() - t0));
      hang.lib = null;
      ok('the library of the hung call is read again at the next request and works', (await S.as('a').putItems([L.item('song:three')], { ip: '198.51.100.201' })).status === 200);
    } finally { await S.close(); }
    /* reads and polls that hang end the same way, and a read that failed gives back what it reserved */
    const innerR = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-hang3-'), { memory: true });
    const hangR = { on: false };
    const never = name => function () { if (hangR.on) return new Promise(() => {}); return innerR[name].apply(innerR, arguments); };
    const stuckR = Object.assign({}, innerR, { getItems: never('getItems'), changes: never('changes') });
    const SR = await L.startSync({ store: stuckR, libs: ['a'], config: { storeTimeoutMs: 300 } });
    try {
      await SR.as('a').putItems([L.item('song:one')]);
      const before = SR.svc._state.budget('out', SR.clock.t);
      hangR.on = true;
      let t0 = Date.now();
      let r = await SR.as('a').items(['song:one']);
      ok('a read whose store call never comes back: 503 store after the time-out', bad(r, 503, 'store') && Date.now() - t0 < 3000, r.status + ' ' + (Date.now() - t0));
      const after = SR.svc._state.budget('out', SR.clock.t);
      ok('... and what it reserved of the hour and day budgets is given back (nothing was sent)', after.hour === before.hour && after.day === before.day, JSON.stringify([before, after]));
      t0 = Date.now();
      r = await SR.as('a').changes(0);
      ok('a poll whose store call never comes back: 503 store after the time-out', bad(r, 503, 'store') && Date.now() - t0 < 3000, r.status + ' ' + (Date.now() - t0));
      hangR.on = false;
      ok('and the next read is served (the place it held was given back)', (await SR.as('a').items(['song:one'])).status === 200);
    } finally { await SR.close(); }
    const innerL = L.mod('sync-store.js').fileSyncStore(L.tmpDir('ppp-sync-hang2-'), { memory: true });
    const hang2 = { on: true };
    const stuckLoad = Object.assign({}, innerL, { loadAll: function () { if (hang2.on) return new Promise(() => {}); return innerL.loadAll.apply(innerL, arguments); } });
    const S2 = await L.startSync({ store: stuckLoad, config: { storeTimeoutMs: 300 } });
    try {
      const t0 = Date.now();
      const r = await S2.anon.post('/api/libs', {}, { ip: '198.51.100.150' });
      ok('the first read of the libraries that never comes back: 503 store after the time-out, not a request that hangs', bad(r, 503, 'store') && Date.now() - t0 < 3000, r.status + ' ' + (Date.now() - t0));
      hang2.on = false;
      ok('and the next request (the store is back) is served', (await S2.anon.post('/api/libs', {}, { ip: '198.51.100.150' })).status === 201);
    } finally { await S2.close(); }
  }

  heading('the operator\'s tools refuse a database that is not on this machine');
  {
    const cp = require('child_process');
    const run = (script, args, env) => cp.spawnSync(process.execPath, [L.path.join(L.MODS, 'tools', 'sync-admin', script)].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: '' }, env || {}), timeout: 20000 });
    const remote = 'postgres://neondb_owner:s3cret-pw@ep-cool-123.eu-central-1.aws.neon.tech/ppp?sslmode=require';
    let r = run('list.js', ['--url', remote]);
    ok('list.js on a remote database without --allow-remote: exit 2, says where it is and that it will not, shows no password', r.status === 2 && /ep-cool-123/.test(r.stderr) && /--allow-remote/.test(r.stderr) && !/s3cret/.test(r.stdout + r.stderr), r.status + ' ' + r.stderr.slice(0, 200));
    r = run('delete.js', ['--id', 'lib_' + 'a'.repeat(22), '--confirm', '--url', remote]);
    ok('delete.js on a remote database with --confirm but not --allow-remote: exit 2, nothing done', r.status === 2 && /--allow-remote/.test(r.stderr), r.status + ' ' + r.stderr.slice(0, 200));
    r = run('delete.js', ['--id', 'not-an-id', '--url', 'postgres://u:p@127.0.0.1:1/x']);
    ok('delete.js with something that is not a library id: exit 2', r.status === 2 && /--id/.test(r.stderr));
    r = run('list.js', []);
    ok('no database named: exit 2 and a sentence', r.status === 2 && /DATABASE_URL/.test(r.stderr));
    r = run('list.js', ['--url', 'mysql://u:p@localhost/x']);
    ok('a URL that is not postgres: exit 2', r.status === 2);
  }

  heading('a first sync of 500 songs under the limits as built (the arithmetic of 7.9: what the person waits)');
  {
    const S = await L.startSync({ libs: ['a'], memory: true });
    try {
      const A = S.as('a');
      let seed = 12345;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
      /* a song of 2,000 packed note rows of 8 values (a real packed row is longer still), irregular pitches and lengths: tens of KB as JSON, about 20 KB as gzip */
      const song = i => {
        const o = L.songBody(8);
        o.card.title = 'Song ' + i;
        o.score.notes = Array.from({ length: 2000 }, (_, k) => [1 + (k >> 5), 1 + (k & 1), 1, 40 + Math.floor(rnd() * 45), Math.round(rnd() * 64) / 4, [0.25, 0.5, 0.75, 1, 2][Math.floor(rnd() * 5)], 'n-' + k + '-' + Math.floor(rnd() * 1000), Math.floor(rnd() * 3)]);
        o.score.measures = Array.from({ length: 63 }, (_, k) => ({ number: k + 1, time: { beats: 4, beatType: 4 } }));
        return o;
      };
      const t0 = S.clock.t;
      let written = 0, calls = 0, waits = 0;
      const refusals = {};
      for (let guard = 0; written < 500 && guard < 400; guard++) {
        const n = Math.min(25, 500 - written);
        const items = Array.from({ length: n }, (_, k) => L.item('song:s' + (written + k), song(written + k), 0));
        const r = await A.putItems(items);
        calls++;
        if (r.status === 200) { written += n; continue; }
        const key = r.status + ' ' + (r.body && r.body.code);
        refusals[key] = (refusals[key] || 0) + 1;
        const wait = Math.max(1, Number(r.headers['retry-after']) || 600);
        S.advance(wait * 1000);
        waits++;
      }
      const upHours = (S.clock.t - t0) / 3600000;
      const g = (await A.changes(0)).body;
      ok('500 songs are all written (' + calls + ' requests, ' + waits + ' waits on Retry-After): ' + upHours.toFixed(2) + ' hours of the device\'s clock; the library holds ' + (g.library.bytes / 1048576).toFixed(1) + ' MB',
        written === 500 && g.library.items === 500 && upHours >= 1.9 && upHours <= 2.2, JSON.stringify({ written: written, upHours: upHours, refusals: refusals, library: g.library }));
      /* the listing of all 500 rows is ONE page and costs the budgets what it weighs */
      const hourBefore = S.svc._state.budget('out', S.clock.t).hour;
      const list = await A.changes(0);
      const weighed = S.svc._state.budget('out', S.clock.t).hour - hourBefore;
      ok('the second device\'s first poll lists the 500 items in one answer of about ' + Math.round(weighed / 1024) + ' KB, charged to the read budgets (a library has a quarter of 64 MB an hour)', list.body.items.length === 500 && list.body.more === false && weighed === Buffer.byteLength(list.text) && weighed < 150 * 1024, weighed + ' ' + list.body.items.length);
      /* the second device reads the bodies, 25 at a time, 300 items an hour: 300 now, 200 an hour later */
      const t1 = S.clock.t;
      let got = 0, readWaits = 0;
      const reads = {};
      for (let guard = 0; got < 500 && guard < 400; guard++) {
        const n = Math.min(25, 500 - got);
        const keys = Array.from({ length: n }, (_, k) => 'song:s' + (got + k));
        const r = await A.items(keys);
        if (r.status === 200) { got += r.body.items.filter(x => x.body).length; continue; }
        const key = r.status + ' ' + (r.body && r.body.code);
        reads[key] = (reads[key] || 0) + 1;
        S.advance(Math.max(1, Number(r.headers['retry-after']) || 600) * 1000);
        readWaits++;
      }
      const downHours = (S.clock.t - t1) / 3600000;
      ok('and reads all 500 bodies: ' + downHours.toFixed(2) + ' hours of the device\'s clock (' + readWaits + ' waits)', got === 500 && downHours >= 0.9 && downHours <= 1.2, JSON.stringify({ got: got, downHours: downHours, reads: reads }));
    } finally { await S.close(); }
  }

  heading('the numbers of the hourly line');
  {
    const S = await L.startSync({ libs: ['a', 'b'], config: { totalBytes: 1200 } });
    try {
      await S.as('a').putItems([L.item('song:one'), L.item('song:two')]);
      await S.as('a').putItems([L.item('song:one', L.songBody(8), 0)]);
      await S.as('b').changes(0, { raw: '7'.repeat(64) });
      await S.as('a').items(['song:one']);
      const g = S.svc.gauge(true);
      ok('libraries, rows, bytes, the cap, what was written and read, the refusals by kind', g.libs === 2 && g.items === 2 && g.bytes > 0 && g.capBytes === 1200 && g.written === 2 && g.read === 1 && g.conflicts === 1 && g.refused.badCode === 1 && g.made === 2, JSON.stringify(g));
      ok('only numbers, and no name, id, code, address or path', JSON.stringify(g).indexOf('lib_') < 0 && !/[0-9a-f]{20,}/.test(JSON.stringify(g)) && Object.values(g).every(v => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'object'));
      ok('it starts again from zero after being read (the stored totals do not)', S.svc.gauge(false).written === 0 && S.svc.gauge(false).libs === 2);
      ok('at 80 % of the cap it says so in a sentence of numbers', /sync storage is at \d+(\.\d)? % of its/.test(g.warn || '') || (g.pct >= 80 && !!g.warn), JSON.stringify([g.pct, g.warn]));
    } finally { await S.close(); }
  }
}

/* one request by hand on a socket: the head (and no body); resolves { status } when the status line has come, or when the server closes it */
function rawHead(port, head) {
  return new Promise(resolve => {
    const s = require('net').connect(port, '127.0.0.1');
    let buf = '', done = false;
    const end = status => { if (done) return; done = true; s.destroy(); resolve({ status: status, text: buf }); };
    s.on('data', d => { buf += d.toString('latin1'); const m = /^HTTP\/1\.1 (\d+)/.exec(buf); if (m) end(+m[1]); });
    s.on('error', () => end(0));
    s.on('close', () => end(0));
    s.setTimeout(5000, () => end(-1));
    s.write(head);
  });
}

main().then(() => L.finish('the song-library sync service'), e => { console.error(e); process.exit(1); });
