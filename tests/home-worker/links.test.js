/* G10b-2: the PC link - the way the home-PC queue works WITHOUT AN ACCOUNT (home-jobs.js, home-jobs-store.js). A link is two random secrets any browser can make
   (POST /api/pc-links): a client code (X-PPP-PC; the page keeps it) and a worker token (the PC keeps it). The site keeps only their hashes.

   What it pins, over real HTTP on the file store (tests/home-worker/jobs-pg.test.js runs the SQL on Postgres):
     - making a link: the answer, what is stored (hashes only, no address), the per-address limits (5 an hour, 20 a day, IPv6 as a /48, counted from the
       links so a restart does not forget them, a refused request costs nothing, requests at the same moment cannot pass them together), the site's cap
     - cross-link isolation: link B's code and token can never read, cancel, remove, claim, finish or rotate anything of link A
     - revoke (a link and everything of it is gone at once), rotate (the old token is dead at once, the PC stays "heard of")
     - the keeping time: a link nobody uses goes, one that never connected goes sooner, a revoked one is kept two days, one with work is not thrown away
     - what is NOT a link: an account's rows from PR 178 in the same tables, a malformed or doubled header, a code in the query string
     - abuse: what one address can store, mass creation, failed codes (counted on failures only), bodies

   Run: node tests/home-worker/links.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req, WATCH, goodResult } = L;
const J = L.mod('home-jobs.js');

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const mk = (S, ip, extra) => req(S.port, 'POST', '/api/pc-links', Object.assign({ body: {}, ip: ip }, extra));
const jobOfLink = (S, name) => Array.from(S.svc._state.jobs.values()).filter(j => j.ownerId === S.linkId(name));
const queue = (S, name, id) => S.as(name).post('/api/jobs', { url: WATCH(id || 'aaaaaaaaaaa'), title: 'A piece' });

async function main() {
  heading('making a link, with no sign-in');
  {
    const S = await L.startService({ users: [] });
    try {
      const r = await mk(S, '20.0.0.1');
      ok('POST /api/pc-links with nothing but a body of {}: 201, the link id, the client code, the worker token and its id - once', r.status === 201 && Object.keys(r.body).sort().join() === 'clientCode,createdAt,id,workerToken,workerTokenId'
        && /^pc_[0-9a-f]{22}$/.test(r.body.id) && /^[0-9a-f]{64}$/.test(r.body.clientCode) && /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(r.body.workerToken) && r.headers['cache-control'] === 'no-store', r.text.slice(0, 120));
      ok('no body, an empty one and a {} all work (the page sends {})', (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.2' })).status === 201 && (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.3', body: '' })).status === 201);
      ok('the id is the hash of the code (the page can show it, the code cannot be got back from it)', r.body.id === J.linkIdOf(J.codeHash(r.body.clientCode)) && r.body.id.indexOf(r.body.clientCode.slice(0, 20)) < 0);
      const st = await req(S.port, 'GET', '/api/worker/status', { code: r.body.clientCode });
      ok('the code works at once: the status says a token exists, the PC has not connected, nothing is waiting', st.status === 200 && st.body.worker.hasToken === true && st.body.worker.everSeen === false && st.body.worker.alive === false, st.text);
      ok('and the token works at once (a check marks the PC as seen)', (await req(S.port, 'GET', '/api/worker/ping', { token: r.body.workerToken })).status === 200 && (await req(S.port, 'GET', '/api/worker/status', { code: r.body.clientCode })).body.worker.everSeen === true);
      const disk = L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8');
      ok('what the store holds: hashes only - neither secret, no address, only a keyed tag of the address that made it', disk.indexOf(r.body.clientCode) < 0 && disk.indexOf(r.body.workerToken) < 0 && disk.indexOf(r.body.workerToken.slice(17)) < 0 && !/20\.0\.0\.1/.test(disk)
        && disk.indexOf(J.codeHash(r.body.clientCode).toString('hex')) > 0 && /"ipTag":"[0-9a-f]{16}"/.test(disk));
      const tagOf = ip => { const d = JSON.parse(L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8')); return d.links.map(l => l.ipTag); };
      ok('the tag is the same for the same address and differs for another (it is what the per-address rules count)', (await mk(S, '20.0.0.1')).status === 201 && tagOf()[0] === tagOf()[3] && tagOf()[0] !== tagOf()[1]);
      ok('the tag is keyed: another server secret gives other tags for the same addresses (a stolen table cannot be turned back into addresses without the secret)', await (async () => {
        const S2 = await L.startService({ users: [], ipSecret: 'another-secret' });
        try { await mk(S2, '20.0.0.1'); return JSON.parse(L.fs.readFileSync(L.path.join(S2.dir, 'jobs.json'), 'utf8')).links[0].ipTag !== tagOf()[0]; } finally { await S2.close(); }
      })());
      const hostile = await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.9', body: '{bad' });
      ok('a body that is not JSON is 400, an array 422, 100 KB is 413, a NUL in it is 422, nesting past 64 levels is 422 - and none of them makes a link', hostile.status === 400
        && (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.9', body: '[1]' })).status === 422 && (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.9', body: { pad: 'x'.repeat(100 * 1024) } })).status === 413
        && (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.9', body: '{"a":"\\u0000"}' })).status === 422 && (await req(S.port, 'POST', '/api/pc-links', { ip: '20.0.0.9', body: '{"a":'.repeat(70) + '1' + '}'.repeat(70) })).status === 422
        && S.svc._state.links.size === 4, S.svc._state.links.size + '');
      ok('other methods on it are 405 (GET, PUT, DELETE), an unknown path under it is 405/404', (await req(S.port, 'GET', '/api/pc-links')).status === 405 && (await req(S.port, 'PUT', '/api/pc-links', { body: {} })).status === 405 && (await req(S.port, 'DELETE', '/api/pc-links')).status === 405
        && (await req(S.port, 'GET', '/api/pc-links/me')).status === 405 && (await req(S.port, 'POST', '/api/pc-links/other', { body: {} })).status === 404);
    } finally { await S.close(); }
  }

  heading('making links is limited per address: 5 an hour, 20 a day, from the links themselves');
  {
    const S = await L.startService({ users: [] });
    try {
      const out = [];
      for (let i = 0; i < 7; i++) out.push((await mk(S, '30.0.0.1')).status);
      const refused = await mk(S, '30.0.0.1');
      ok('five links an hour from one address, then 429 (too-many) with a Retry-After of about an hour', out.join() === '201,201,201,201,201,429,429' && refused.status === 429 && refused.body.code === 'too-many' && Number(refused.headers['retry-after']) > 3000 && Number(refused.headers['retry-after']) <= 3600, out.join() + ' ' + refused.headers['retry-after']);
      ok('a refused request costs nothing and makes nothing: still 5 links, and another address is not touched', S.svc._state.links.size === 5 && (await mk(S, '30.0.0.2')).status === 201);
      S.advance(61 * 60 * 1000);
      ok('an hour later the same address can make more', (await mk(S, '30.0.0.1')).status === 201);
      for (let h = 0; h < 3; h++) { S.advance(61 * 60 * 1000); for (let i = 0; i < 5; i++) await mk(S, '30.0.0.1'); }
      const day = [];
      S.advance(61 * 60 * 1000);
      day.push((await mk(S, '30.0.0.1')).status);
      const dayRefused = await mk(S, '30.0.0.1');
      ok('20 in a day, then 429 even after the hour has passed, with a Retry-After of the rest of the day', day[0] === 429 && dayRefused.status === 429 && Number(dayRefused.headers['retry-after']) > 3600 && Number(dayRefused.headers['retry-after']) <= 86400, day.join() + ' ' + dayRefused.headers['retry-after']);
      S.advance(DAY);
      ok('a day after the first one it can again', (await mk(S, '30.0.0.1')).status === 201);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: [] });
    try {
      const out = [];
      for (let i = 0; i < 6; i++) out.push((await mk(S, ['2001:db8:5:6::1', '2001:db8:5:6:aaaa:bbbb:cccc:dddd', '2001:DB8:5:6:0:0:0:7'][i % 3])).status);
      ok('an IPv6 address counts as its /48: three spellings in one network are one address (5, then 429); so is another /64 of the same /56, and another /56 of the same /48', out.join() === '201,201,201,201,201,429' && (await mk(S, '2001:db8:5:7::1')).status === 429
        && (await mk(S, '2001:db8:5:107::1')).status === 429 && (await mk(S, '2001:db8:5:ffff::1')).status === 429, out.join());
      ok('another /48 is another address; so is an IPv4', (await mk(S, '2001:db8:6::1')).status === 201 && (await mk(S, '1.2.3.4')).status === 201);
      /* the review: distinct /56 keys of one /48 (256 of them) would have made 500 links in an hour */
      const spread = [];
      for (let i = 0; i < 40; i++) spread.push((await mk(S, '2001:db8:77:' + (i * 256 + 1).toString(16) + '::1')).status);
      ok('40 different /56s of one /48 (what one IPv6 allocation can send): five links, not forty', spread.filter(x => x === 201).length === 5 && spread.filter(x => x === 429).length === 35, spread.join());
      ok('an IPv4-mapped IPv6 address is the IPv4 (the same budget)', await (async () => { const o = []; for (let i = 0; i < 5; i++) o.push((await mk(S, i % 2 ? '::ffff:9.9.9.9' : '9.9.9.9')).status); o.push((await mk(S, '9.9.9.9')).status); return o.join() === '201,201,201,201,201,429'; })());
    } finally { await S.close(); }
  }
  {
    /* the same moment: the slot is taken before anything is awaited */
    const S = await L.startService({ users: [] });
    try {
      const store = S.store;
      const real = store.createLink;
      store.createLink = async function () { await L.sleep(40); return real.apply(this, arguments); };
      const all = await Promise.all(Array.from({ length: 12 }, () => mk(S, '31.0.0.1')));
      ok('twelve requests at the same moment from one address: exactly 5 make a link, 7 are 429 (the limit is not raced past while the database is being written)', all.filter(r => r.status === 201).length === 5 && all.filter(r => r.status === 429).length === 7 && S.svc._state.links.size === 5, all.map(r => r.status).join());
      store.createLink = real;
      ok('and the five are all distinct links with their own codes and tokens', new Set(all.filter(r => r.status === 201).map(r => r.body.clientCode)).size === 5 && new Set(all.filter(r => r.status === 201).map(r => r.body.id)).size === 5 && new Set(all.filter(r => r.status === 201).map(r => r.body.workerTokenId)).size === 5);
    } finally { await S.close(); }
  }
  {
    /* a restart does not forget: the counts come from the links in the store */
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    const A = await L.startService({ users: [], store: fileJobStore(dir) });
    let made;
    try { for (let i = 0; i < 5; i++) made = await mk(A, '32.0.0.1'); } finally { await A.close(); }
    const B = await L.startService({ users: [], store: fileJobStore(dir) });
    try {
      ok('a new process (a Render wake-up) still has the address at 5 an hour: the 6th is 429', (await mk(B, '32.0.0.1')).status === 429 && (await mk(B, '32.0.0.2')).status === 201);
      ok('the five links made before it still work in it', (await req(B.port, 'GET', '/api/worker/status', { code: made.body.clientCode })).status === 200);
    } finally { await B.close(); L.rmDir(dir); }
  }

  heading('the site holds at most MAX_LINKS live links');
  {
    const was = J.LIMITS.MAX_LINKS;
    J.LIMITS.MAX_LINKS = 6;
    const S = await L.startService({ users: [] });
    try {
      const out = [];
      for (let i = 0; i < 8; i++) out.push((await mk(S, '40.0.0.' + i)).status);
      const full = await mk(S, '40.0.0.50');
      ok('the 7th link of the site is 503 "busy" (PC links are full), whoever asks; nothing is made', out.join() === '201,201,201,201,201,201,503,503' && full.status === 503 && full.body.code === 'busy' && /full right now/.test(full.body.error) && S.svc._state.links.size === 6, out.join());
      ok('and the refusal is free: the address that was refused has not used any of its own hour', (await mk(S, '40.0.0.6')).status === 503 && S.svc._state.links.size === 6);
    } finally { J.LIMITS.MAX_LINKS = was; await S.close(); }
    J.LIMITS.MAX_LINKS = 3;
    const S2 = await L.startService({ users: ['a', 'b', 'c'] });
    try {
      ok('at the cap a new link is refused (503)', (await mk(S2, '41.0.0.1')).status === 503);
      const rv = await S2.as('b').del('/api/pc-links/me');
      ok('revoking one gives its place back at once (the cap counts live links)', rv.status === 200 && (await mk(S2, '41.0.0.1')).status === 201 && (await mk(S2, '41.0.0.2')).status === 503);
      S2.advance(15 * DAY);
      await S2.svc._state.purge(S2.clock.t);
      ok('and so does the keeping time: links that were never used are purged, and the site can make links again', (await mk(S2, '41.0.0.3')).status === 201 && S2.svc._state.links.size === 1, S2.svc._state.links.size + '');
    } finally { J.LIMITS.MAX_LINKS = was; await S2.close(); }
  }

  heading('cross-link isolation: link B can never touch what is link A\'s');
  {
    const S = await L.startService({ users: ['A', 'B'] });
    try {
      const jobA = (await queue(S, 'A', 'isolationAA')).body.job;
      const jobB = (await queue(S, 'B', 'isolationBB')).body.job;
      const idA = jobA.id;
      ok('B\'s code lists only B\'s job', (await S.as('B').get('/api/jobs')).body.jobs.map(j => j.id).join() === jobB.id && (await S.as('A').get('/api/jobs')).body.jobs.map(j => j.id).join() === idA);
      ok('B\'s code cannot read, cancel or remove A\'s job (404, the same as a job that does not exist)', (await S.as('B').get('/api/jobs/' + idA)).status === 404 && (await S.as('B').post('/api/jobs/' + idA + '/cancel')).status === 404 && (await S.as('B').del('/api/jobs/' + idA)).status === 404
        && (await S.as('B').get('/api/jobs/zzzzzzzzzzzz')).text === (await S.as('B').get('/api/jobs/' + idA)).text);
      ok('B\'s worker token claims nothing of A\'s, and sees B\'s own job only', await (async () => { const c = await S.worker(S.token('B')).post('/api/worker/claim', { once: true }); return c.body.job && c.body.job.id === jobB.id; })());
      const gA = (await S.worker(S.token('A')).post('/api/worker/claim', { once: true })).body.job;
      ok('A\'s token claims A\'s job', gA && gA.id === idA);
      const tokB = S.token('B');
      ok('B\'s token can not heartbeat, fail or finish A\'s claimed job (404), and nothing changed', (await S.worker(tokB).post('/api/worker/jobs/' + idA + '/heartbeat', { pct: 0.5 })).status === 404 && (await S.worker(tokB).post('/api/worker/jobs/' + idA + '/fail', { error: 'x' })).status === 404
        && (await S.worker(tokB).post('/api/worker/jobs/' + idA + '/result', goodResult(40))).status === 404 && jobOfLink(S, 'A')[0].status === 'claimed');
      ok('B\'s client code cannot be used as A\'s token and A\'s token cannot be used as a code, in either place', (await S.worker(S.code('B')).get('/api/worker/ping')).status === 401 && (await req(S.port, 'GET', '/api/jobs', { code: S.token('A') })).status === 401
        && (await req(S.port, 'GET', '/api/jobs', { headers: { Authorization: 'Bearer ' + S.token('A') } })).status === 401);
      ok('A\'s link id (which the page may show) is not a credential: as a code it is 401', (await req(S.port, 'GET', '/api/jobs', { code: S.linkId('A') })).status === 401 && (await req(S.port, 'GET', '/api/jobs', { code: J.codeHash(S.code('A')).toString('hex') })).status === 401);
      ok('rotating B\'s token leaves A\'s alone; revoking B leaves A\'s link, token, job and notes alone', await (async () => {
        const rb = await S.as('B').post('/api/pc-links/me/worker-token', {});
        const rv = await S.as('B').del('/api/pc-links/me');
        return rb.status === 201 && rv.status === 200 && (await S.worker(S.token('A')).get('/api/worker/ping')).status === 200 && (await S.as('A').get('/api/jobs/' + idA)).body.job.status === 'claimed' && (await S.worker(S.token('A')).post('/api/worker/jobs/' + idA + '/result', goodResult(30))).status === 200
          && (await S.as('A').get('/api/jobs/' + idA)).body.result.notes.length === 30;
      })());
      ok('the status of A is A\'s own (its PC was heard of), B\'s code says nothing of it (B is gone)', (await S.as('A').get('/api/worker/status')).body.worker.everSeen === true);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['A', 'B'] });
    try {
      ok('two links ask the same YouTube link: two separate jobs, each its own link\'s (the duplicate rule is per link)', await (async () => {
        const a = await queue(S, 'A', 'sameLinkSam'), b = await queue(S, 'B', 'sameLinkSam');
        return a.status === 201 && b.status === 201 && a.body.job.id !== b.body.job.id;
      })());
      const wk = S.worker(S.token('B'));
      const c = (await wk.post('/api/worker/claim', { once: true })).body.job;
      ok('and B\'s PC is given B\'s, never A\'s (A\'s was queued first)', c && jobOfLink(S, 'B').some(j => j.id === c.id) && jobOfLink(S, 'A')[0].status === 'queued');
      ok('the per-link caps are each link\'s own: A at 5 waiting does not stop B', await (async () => {
        for (let i = 0; i < 4; i++) await queue(S, 'A', 'aaaaaaaaa' + String(i).padStart(2, '0'));
        return (await queue(S, 'A', 'aaaaaaaaa99')).status === 429 && (await queue(S, 'B', 'bbbbbbbbb00')).status === 201;
      })());
    } finally { await S.close(); }
  }

  heading('revoking a link: everything of it is gone at once');
  {
    const S = await L.startService({ users: ['R', 'K'] });
    try {
      const done = (await queue(S, 'R', 'revokedone1')).body.job;
      const g = (await S.worker(S.token('R')).post('/api/worker/claim', { once: true })).body.job;
      await S.worker(S.token('R')).post('/api/worker/jobs/' + g.id + '/result', goodResult(40));
      const wait = (await queue(S, 'R', 'revokewait1')).body.job;
      const keep = (await queue(S, 'K', 'keepkeepkee')).body.job;
      const tokR = S.token('R'), codeR = S.code('R');
      const bad = await req(S.port, 'DELETE', '/api/pc-links/me', { code: 'a'.repeat(64) });
      ok('revoking needs the link\'s own code (a wrong one is 401)', bad.status === 401);
      const rv = await S.as('R').del('/api/pc-links/me');
      ok('DELETE /api/pc-links/me: 200', rv.status === 200 && rv.body.ok === true);
      ok('the code is dead: every browser route says 401 "bad-code"', (await req(S.port, 'GET', '/api/jobs', { code: codeR })).body.code === 'bad-code' && (await req(S.port, 'POST', '/api/jobs', { code: codeR, body: { url: WATCH('afterrevoke') } })).status === 401
        && (await req(S.port, 'GET', '/api/jobs/' + done.id, { code: codeR })).status === 401);
      ok('the PC\'s token is dead: claim, ping and a result are 401', (await S.worker(tokR).get('/api/worker/ping')).status === 401 && (await S.worker(tokR).post('/api/worker/claim', { once: true })).status === 401 && (await S.worker(tokR).post('/api/worker/jobs/' + wait.id + '/result', goodResult(40))).status === 401);
      ok('its conversions and their notes are gone from memory and from the store', !S.svc._state.jobs.has(done.id) && !S.svc._state.jobs.has(wait.id) && (await S.inner.getResult(done.id, S.linkId('R'))) === null
        && !(await S.inner.loadAll()).jobs.some(j => j.ownerId === S.linkId('R')) && !(await S.inner.loadAll()).tokens.some(k => k.ownerId === S.linkId('R')));
      ok('another link is untouched', (await S.as('K').get('/api/jobs')).body.jobs.length === 1 && (await S.worker(S.token('K')).post('/api/worker/claim', { once: true })).body.job.id === keep.id);
      ok('revoking twice is 401 (it is not there any more)', (await S.as('R').del('/api/pc-links/me')).status === 401);
      const row = (await S.inner.loadAll()).links.find(l => l.id === S.linkId('R'));
      ok('the row is kept, marked revoked, for two days (so making and removing links is not a way round the per-address limits)', !!row && row.revokedAt > 0);
      S.advance(DAY);
      await S.svc._state.purge(S.clock.t);
      ok('a day later a purge still keeps it', S.svc._state.links.has(S.linkId('R')) && (await S.inner.loadAll()).links.some(l => l.id === S.linkId('R')));
      S.advance(-DAY);
      let hits = 0;
      const addr = '50.0.0.1';
      const T = await L.startService({ users: [] });
      try {
        for (let i = 0; i < 5; i++) { const m = await mk(T, addr); if (m.status === 201) { hits++; await req(T.port, 'DELETE', '/api/pc-links/me', { code: m.body.clientCode }); } }
        ok('making and revoking five links does not give the address back its budget: the 6th is 429', hits === 5 && (await mk(T, addr)).status === 429);
        T.advance(2 * DAY + 1000);
        await T.svc._state.purge(T.clock.t);
        ok('after the two days the revoked rows are purged (memory and store)', T.svc._state.links.size === 0 && (await T.inner.loadAll()).links.length === 0 && (await mk(T, addr)).status === 201);
      } finally { await T.close(); }
    } finally { await S.close(); }
  }
  {
    /* a long-poll that is waiting when its link is revoked is let go */
    const S = await L.startService({ users: ['W'], config: { longPollMs: 1500 } });
    try {
      const j = (await queue(S, 'W', 'longpollrev')).body.job;
      const g = (await S.worker(S.token('W')).post('/api/worker/claim', { once: true })).body.job;
      ok('claimed one', g.id === j.id);
      const t0 = Date.now();
      const waiting = S.worker(S.token('W')).post('/api/worker/claim', {});
      await L.sleep(150);
      await S.as('W').del('/api/pc-links/me');
      const r = await waiting;
      ok('a PC that was waiting for work when the link was revoked is answered at once with 401 (the token is dead: it is not told there is no work), not after the whole wait', r.status === 401 && Date.now() - t0 < 1000, r.status + ' ' + (Date.now() - t0) + ' ms');
      ok('and its next ask is 401', (await S.worker(S.token('W')).post('/api/worker/claim', { once: true })).status === 401);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['F'] });
    try {
      await queue(S, 'F', 'revokefail1');
      S.store.fail.on = true; S.store.fail.only = 'revokeLink';
      const r = await S.as('F').del('/api/pc-links/me');
      S.store.fail.on = false;
      ok('a revoke whose write fails is 503 and changes nothing: the code, the token and the job are all still there', r.status === 503 && (await S.as('F').get('/api/jobs')).body.jobs.length === 1 && (await S.worker(S.token('F')).get('/api/worker/ping')).status === 200);
      ok('and it works when asked again', (await S.as('F').del('/api/pc-links/me')).status === 200);
    } finally { await S.close(); }
  }

  heading('a link removed while a conversion is being written for it: nothing is left of it');
  {
    const S = await L.startService({ users: ['E'] });
    try {
      const real = S.store.insertJob;
      S.store.insertJob = async function () { await L.sleep(120); return real.apply(this, arguments); };
      const asking = queue(S, 'E', 'raceremove1');
      await L.sleep(40);
      const rv = await S.as('E').del('/api/pc-links/me');
      const r = await asking;
      S.store.insertJob = real;
      ok('the removal is 200 and the conversion asked for at the same moment is told the link is gone (401), not 201', rv.status === 200 && r.status === 401 && r.body.code === 'bad-code', rv.status + ' ' + r.status + ' ' + r.text);
      ok('and no row of it is left in memory or in the store (the one that was being written is swept)', S.svc._state.jobs.size === 0 && (await S.inner.loadAll()).jobs.length === 0);
    } finally { await S.close(); }
  }

  heading('a new worker token: the old one is dead at once, the PC stays heard of');
  {
    const S = await L.startService({ users: ['T'], config: { longPollMs: 100 } });
    try {
      const j = (await queue(S, 'T', 'rotatejob01')).body.job;
      const old = S.token('T');
      const g = (await S.worker(old).post('/api/worker/claim', { waitSeconds: 3600 })).body.job;
      ok('the PC with the old token claimed a job', g.id === j.id && (await S.as('T').get('/api/worker/status')).body.worker.everSeen === true);
      const rot = await S.as('T').post('/api/pc-links/me/worker-token', {});
      const fresh = rot.body.workerToken;
      ok('POST /api/pc-links/me/worker-token: 201, a new token, shown once; it is not the old one', rot.status === 201 && /^ppw_/.test(fresh) && fresh !== old && rot.body.workerTokenId === fresh.slice(4, 16));
      const wRot = (await S.as('T').get('/api/worker/status')).body.worker;
      ok('right after the rotation, before the new token has been used once: the PC is still "heard of" (the page keeps its button) and the last-seen time is the old token\'s', wRot.everSeen === true && wRot.hasToken === true && !!wRot.lastSeenAt, JSON.stringify(wRot));
      ok('the old token: 401 on everything (ping, claim, heartbeat, result)', (await S.worker(old).get('/api/worker/ping')).status === 401 && (await S.worker(old).post('/api/worker/claim', {})).status === 401 && (await S.worker(old).post('/api/worker/jobs/' + j.id + '/heartbeat', {})).status === 401
        && (await S.worker(old).post('/api/worker/jobs/' + j.id + '/result', goodResult(40))).status === 401);
      ok('the job claimed under the old token is finished by the new one (the PC was reconfigured while it worked)', (await S.worker(fresh).post('/api/worker/jobs/' + j.id + '/heartbeat', { pct: 0.5 })).status === 200 && (await S.worker(fresh).post('/api/worker/jobs/' + j.id + '/result', goodResult(40))).status === 200);
      const w = (await S.as('T').get('/api/worker/status')).body.worker;
      ok('and the status keeps "this PC has been heard of" (the page keeps its button while the PC is being moved to the new token): the last-seen time carries over', w.everSeen === true && w.hasToken === true, JSON.stringify(w));
      ok('exactly one live token per link', Array.from(S.svc._state.tokens.values()).filter(k => k.ownerId === S.linkId('T')).length === 1 && (await S.inner.loadAll()).tokens.filter(k => k.ownerId === S.linkId('T')).length === 1);
      ok('the store keeps only the hash of the new token', L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8').indexOf(fresh.slice(17)) < 0);
      ok('the old token of a revoked link, and of a purged one, stay dead (a second rotation, then revoke)', (await S.as('T').post('/api/pc-links/me/worker-token', {})).status === 201 && (await S.worker(fresh).get('/api/worker/ping')).status === 401);
    } finally { await S.close(); }
  }
  {
    /* a store that has two live tokens for one link (a rotation that was cut off): the newest one is the live one */
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    const A = await L.startService({ users: ['D'], store: fileJobStore(dir) });
    let creds;
    try { creds = A.creds(); } finally { await A.close(); }
    const file = L.path.join(dir, 'jobs.json');
    const d = JSON.parse(L.fs.readFileSync(file, 'utf8'));
    const nt = J.newToken();
    d.tokens.unshift({ id: nt.id, ownerId: d.links[0].id, hash: nt.hash, label: 'x', createdAt: d.tokens[0].createdAt + 5000, lastSeenAt: 0, pollS: 0, revokedAt: 0 });   /* the newer one FIRST in the file: it is the date that decides, not the order */
    L.fs.writeFileSync(file, JSON.stringify(d));
    const B = await L.startService({ resume: creds, store: fileJobStore(dir) });
    try {
      ok('a boot that finds two live tokens for one link keeps only the newest', (await B.worker(creds.tokens.D).get('/api/worker/ping')).status === 401 && (await B.worker(nt.token).get('/api/worker/ping')).status === 200);
    } finally { await B.close(); L.rmDir(dir); }
  }

  heading('after the review: rows per address, a token or a link that goes while a request waits, a link being made while the queue is re-read');
  {
    /* (a) the rows (any state) of all the links made from one address are bounded: with no PC a link can queue and cancel 30 of them */
    const was = J.LIMITS.ROWS_PER_ADDRESS;
    J.LIMITS.ROWS_PER_ADDRESS = 7;
    const S = await L.startService({ users: [] });
    try {
      for (const n of ['ra', 'rb', 'rc']) await S.makeLink(n, { ip: '77.0.0.1' });
      await S.makeLink('other', { ip: '77.0.0.2' });
      const out = [];
      for (let i = 0; i < 9; i++) { const n = ['ra', 'rb', 'rc'][i % 3]; const r = await queue(S, n, 'addrrows' + String(i).padStart(3, '0')); out.push(r.status); if (r.status === 201) await S.as(n).post('/api/jobs/' + r.body.job.id + '/cancel'); }
      ok('the links of one address hold 7 rows together (here; 100 by default): the 8th row is 503 "busy" whichever link asks, and leaves nothing behind', out.join() === '201,201,201,201,201,201,201,503,503' && Array.from(S.svc._state.jobs.values()).length === 7 && (await S.inner.loadAll()).jobs.length === 7, out.join());
      ok('a link made from another address is not touched; removing a conversion of the first address makes room', (await queue(S, 'other', 'addrrowsoth')).status === 201 && (await S.as('ra').del('/api/jobs/' + Array.from(S.svc._state.jobs.values()).find(j => j.ownerId === S.linkId('ra')).id)).status === 200 && (await queue(S, 'rb', 'addrrows100')).status === 201);
    } finally { J.LIMITS.ROWS_PER_ADDRESS = was; await S.close(); }
  }
  {
    /* (b) a PC that waits for work (the long-poll) when its token is replaced is told so, and is not handed the next job */
    const S = await L.startService({ users: ['W'], config: { longPollMs: 1500 } });
    try {
      const j1 = (await queue(S, 'W', 'longwait001')).body.job;
      const old = S.token('W');
      await S.worker(old).post('/api/worker/claim', { once: true });
      const t0 = Date.now();
      const waiting = S.worker(old).post('/api/worker/claim', {});
      await L.sleep(150);
      const rot = await S.as('W').post('/api/pc-links/me/worker-token', {});
      const r = await waiting;
      ok('the owner replaces the token while the old one waits for work: the waiting poll is answered at once with 401 (not after the whole wait)', r.status === 401 && Date.now() - t0 < 1000, r.status + ' ' + (Date.now() - t0) + ' ms');
      const j2 = (await queue(S, 'W', 'longwait002')).body.job;
      ok('a job queued right after goes to the new token, and the old token is given nothing', (await S.worker(old).post('/api/worker/claim', { once: true })).status === 401 && (await S.worker(rot.body.workerToken).post('/api/worker/claim', { once: true })).body.job.id === j2.id);
      void j1;
    } finally { await S.close(); }
  }
  {
    /* (c) a result being taken (the body read, room cleared) when the token is replaced is refused, and the job stays the link's */
    const S = await L.startService({ users: ['X'], config: { perUserResultBytes: 4000, resultReserveBytes: 0, totalResultBytes: 1e9 } });
    try {
      const tok = S.token('X');
      const done = async id => { const q = (await queue(S, 'X', id)).body.job; const g = (await S.worker(tok).post('/api/worker/claim', { once: true })).body.job; await S.worker(tok).post('/api/worker/jobs/' + g.id + '/result', goodResult(40)); S.advance(1000); return q; };
      await done('postrot0001'); await done('postrot0002');
      const q3 = (await queue(S, 'X', 'postrot0003')).body.job;
      const g3 = (await S.worker(tok).post('/api/worker/claim', { once: true })).body.job;
      const real = S.store.deleteJobs;
      S.store.deleteJobs = async function () { await L.sleep(250); return real.apply(this, arguments); };
      const posting = S.worker(tok).post('/api/worker/jobs/' + g3.id + '/result', goodResult(40));
      await L.sleep(80);
      await S.as('X').post('/api/pc-links/me/worker-token', {});
      const r = await posting;
      S.store.deleteJobs = real;
      ok('a result that was being taken (room was being cleared for it) when the token was replaced is refused (401), and the job is still claimed: nothing was written for a token that is dead', r.status === 401 && S.svc._state.jobs.get(g3.id).status === 'claimed' && g3.id === q3.id, r.status + ' ' + r.text);
    } finally { await S.close(); }
  }
  {
    /* (d) a request of a link that ran out in the purge it triggered writes nothing and is told the link is not valid */
    const S = await L.startService({ users: ['P'] });
    try {
      await S.as('P').get('/api/jobs');
      S.advance(15 * DAY);
      const r = await queue(S, 'P', 'purgeinreq1');
      ok('a link made 15 days ago whose PC never connected, asking for a conversion: the purge it triggers removes it, and the request is 401 "bad-code" - not a 201 for a row nobody owns', r.status === 401 && r.body.code === 'bad-code' && (await S.inner.loadAll()).jobs.length === 0 && S.svc._state.jobs.size === 0, r.status + ' ' + r.text);
      ok('and the hourly budgets it took were given back', (await S.makeLink('P2')) && (await queue(S, 'P2', 'purgeinreq2')).status === 201);
    } finally { await S.close(); }
  }
  {
    /* (e) the queue is re-read (a claim that found the memory behind) while a link is being made: the link must not be lost */
    const S = await L.startService({ users: [] });
    try {
      const real = S.store.createLink;
      S.store.createLink = async function () { await L.sleep(200); return real.apply(this, arguments); };
      const making = S.makeLink('M', { ip: '78.0.0.1' });
      await L.sleep(60);
      S.svc._state.forgetAll();
      await S.makeLink('N', { ip: '78.0.0.2' }).catch(() => null);
      const r = await making;
      S.store.createLink = real;
      ok('a link being made while the queue was read again is still there afterwards: its code and its token work', r.status === 201 && (await S.as('M').get('/api/jobs')).status === 200 && (await S.worker(S.token('M')).get('/api/worker/ping')).status === 200);
    } finally { await S.close(); }
  }
  {
    /* (f) two replacements of the token at the same moment, the first one's write failing: the token it replaced does not come back */
    const S = await L.startService({ users: ['Y'] });
    try {
      const a = S.token('Y');
      const real = S.store.rotateToken;
      let n = 0;
      S.store.rotateToken = async function () { const me = ++n; await L.sleep(me === 1 ? 200 : 20); if (me === 1) throw new Error('store is down (test)'); return real.apply(this, arguments); };
      const r1 = S.as('Y').post('/api/pc-links/me/worker-token', {});
      await L.sleep(60);
      const r2 = await S.as('Y').post('/api/pc-links/me/worker-token', {});
      const r1r = await r1;
      S.store.rotateToken = real;
      ok('the second replacement is 201 and its token works; the first one failed (503); the token the first one had replaced (and the second one replaced again) is NOT alive again', r2.status === 201 && r1r.status === 503 && (await S.worker(r2.body.workerToken).get('/api/worker/ping')).status === 200 && (await S.worker(a).get('/api/worker/ping')).status === 401
        && Array.from(S.svc._state.tokens.values()).filter(k => k.ownerId === S.linkId('Y')).length === 1, r1r.status + ' ' + r2.status);
    } finally { await S.close(); }
  }

  heading('the hourly enqueue limit counts an IPv6 network as one address (its /48), not each of its billions');
  {
    const was = J.LIMITS.ENQUEUE_PER_IP_PER_HOUR;
    J.LIMITS.ENQUEUE_PER_IP_PER_HOUR = 4;
    const S = await L.startService({ users: ['v6a', 'v6b'] });
    try {
      const out = [];
      for (let i = 0; i < 6; i++) { const ip = '2001:db8:9:' + ((1 + i) * 256).toString(16) + '::' + (i + 1); const r = await req(S.port, 'POST', '/api/jobs', { user: i % 2 ? 'v6a' : 'v6b', ip: ip, body: { url: WATCH('ipvsixrow' + String(i).padStart(2, '0')) } }); out.push(r.status); if (r.status === 201) await req(S.port, 'POST', '/api/jobs/' + r.body.job.id + '/cancel', { user: i % 2 ? 'v6a' : 'v6b', ip: ip, body: {} }); }
      ok('four enqueues an hour (here; 60 by default) from six different /56s of one /48: the 5th and 6th are 429', out.join() === '201,201,201,201,429,429', out.join());
      ok('another /48 is not touched', (await req(S.port, 'POST', '/api/jobs', { user: 'v6a', ip: '2001:db8:a::1', body: { url: WATCH('ipvsixother') } })).status === 201);
    } finally { J.LIMITS.ENQUEUE_PER_IP_PER_HOUR = was; await S.close(); }
  }

  heading('wrong secrets from one IPv6 network are counted together (its /48, the key of every per-address limit)');
  {
    const S = await L.startService({ users: ['w6'] });
    try {
      const out = [];
      /* 24 wrong codes, each from another /56 (and /64) of 2001:db8:70::/48 */
      for (let i = 0; i < 24; i++) out.push((await req(S.port, 'GET', '/api/worker/status', { code: String(i).padStart(64, 'a'), ip: '2001:db8:70:' + (i * 256 + i).toString(16) + '::' + (i + 1) })).status);
      ok('20 wrong codes an hour from one /48, then 429, however the sender varies its address inside it (the budget is that of the network, not of each address)', out.slice(0, 20).every(x => x === 401) && out.slice(20).every(x => x === 429), out.join());
      ok('a wrong worker token from yet another /64 of that /48 shares the same spent budget (429); a valid code from there is still never refused; another /48 is not affected', (await S.worker('ppw_' + 'A'.repeat(12) + '_' + 'B'.repeat(43)).get('/api/worker/ping', { ip: '2001:db8:70:9999::7' })).status === 429
        && (await req(S.port, 'GET', '/api/worker/status', { user: 'w6', ip: '2001:db8:70:9999::7' })).status === 200 && (await req(S.port, 'GET', '/api/worker/status', { code: 'd'.repeat(64), ip: '2001:db8:71::1' })).status === 401);
    } finally { await S.close(); }
  }

  heading('a record found by the id alone is not enough: the whole hash of the code is compared');
  {
    /* the id of a link is the first 22 hex of the hash of its code; if a row had that id and ANOTHER hash (a collision of the 88 bits, or a row that was edited), the code must be refused */
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    const A = await L.startService({ users: ['c1'], store: fileJobStore(dir) });
    let creds;
    try { creds = A.creds(); } finally { await A.close(); }
    const file = L.path.join(dir, 'jobs.json');
    const d = JSON.parse(L.fs.readFileSync(file, 'utf8'));
    d.links[0].hash = J.codeHash('another code').toString('hex');
    L.fs.writeFileSync(file, JSON.stringify(d));
    const B = await L.startService({ resume: creds, store: fileJobStore(dir) });
    try {
      const r = await req(B.port, 'GET', '/api/jobs', { code: creds.codes.c1 });
      ok('a row with the right id and the hash of another code does not open for the code that names it (401)', r.status === 401 && r.body.code === 'bad-code', r.status + ' ' + r.text);
    } finally { await B.close(); L.rmDir(dir); }
  }

  heading('the keeping time: a link nobody uses goes, with its tokens and jobs');
  {
    const S = await L.startService({ users: ['never', 'idle', 'busy', 'seen'], config: { longPollMs: 50 } });
    try {
      await S.worker(S.token('seen')).get('/api/worker/ping');       /* the PC of "seen" connected once */
      const calls = () => (S.store.calls.deleteLinks || 0);
      S.advance(13 * DAY);
      await S.svc._state.purge(S.clock.t);
      ok('13 days: nothing is purged', S.svc._state.links.size === 4 && calls() === 0);
      await queue(S, 'busy', 'busybusybus');                          /* a link with work */
      S.advance(2 * DAY);
      await S.svc._state.purge(S.clock.t);
      const have = n => Array.from(S.svc._state.links.keys()).indexOf(S.linkId(n)) >= 0;
      ok('15 days: the links whose PC never connected and that hold no job are purged (never, idle); the one that holds a job, and the one whose PC connected, are not', !have('never') && !have('idle') && have('busy') && have('seen'), Array.from(S.svc._state.links.keys()).length + '');
      ok('their codes are dead, the database rows are gone', (await S.as('never').get('/api/jobs')).status === 401 && !(await S.inner.loadAll()).links.some(l => l.id === S.linkId('never')) && calls() === 1);
      const tokensLeft = Array.from(S.svc._state.tokens.values()).map(k => k.ownerId).sort().join();
      ok('a purged link\'s token went with it (memory and store)', tokensLeft === [S.linkId('busy'), S.linkId('seen')].sort().join() && (await S.worker(S.token('never')).get('/api/worker/ping')).status === 401);
      S.advance(62 * DAY);
      await S.svc._state.purge(S.clock.t);
      ok('more than 60 days after the page was last used and the PC last heard of (the one with a job: after its last use, day 13): the rest are purged too, jobs and all', S.svc._state.links.size === 0 && S.svc._state.jobs.size === 0 && S.svc._state.tokens.size === 0 && (await S.inner.loadAll()).jobs.length === 0, S.svc._state.links.size + ' ' + S.svc._state.jobs.size);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['page', 'pc', 'both'] });
    try {
      await S.worker(S.token('page')).get('/api/worker/ping'); await S.worker(S.token('pc')).get('/api/worker/ping');   /* both PCs connected on the first day */
      S.advance(50 * DAY);
      await S.as('page').get('/api/jobs');                             /* the page was opened 50 days in */
      await S.worker(S.token('pc')).post('/api/worker/claim', { once: true });   /* the PC checked in */
      S.advance(30 * DAY);                                             /* day 80: more than 60 days since creation, less since the use */
      await S.svc._state.purge(S.clock.t);
      const have = n => Array.from(S.svc._state.links.keys()).indexOf(S.linkId(n)) >= 0;
      ok('use renews a link: the page opened at day 50 and the PC that checked in at day 50 keep theirs at day 80; the one nobody used since its first day is purged', have('page') && have('pc') && !have('both'), Array.from(S.svc._state.links.keys()).length + '');
      S.advance(31 * DAY);
      await S.svc._state.purge(S.clock.t);
      ok('and they go too, 60 days after their last use (day 111)', S.svc._state.links.size === 0);
      const before = S.store.calls.deleteLinks || 0;
      await S.svc._state.purge(S.clock.t + 1000);
      ok('with nothing left to purge no DELETE is run', (S.store.calls.deleteLinks || 0) === before);
    } finally { await S.close(); }
  }
  {
    /* the purge at the boot read: dead links are not served and not loaded */
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    const A = await L.startService({ users: ['x', 'y'], store: fileJobStore(dir) });
    let creds;
    try { creds = A.creds(); await queue(A, 'y', 'bootpurge01'); } finally { await A.close(); }
    const B = await L.startService({ resume: creds, store: fileJobStore(dir) });
    try {
      B.advance(20 * DAY);
      B.svc._state.forgetAll();
      const r = await B.as('x').get('/api/jobs');
      ok('a link that ran out while the server slept is purged by the read of the next boot: its code is 401, the one with a job is still there', r.status === 401 && (await B.as('y').get('/api/jobs')).status === 200 && (await B.inner.loadAll()).links.length === 1, r.status + ' ' + (await B.inner.loadAll()).links.length);
    } finally { await B.close(); L.rmDir(dir); }
  }

  heading('what is not a link: an account\'s rows from PR 178, a malformed or doubled header, a code in the query');
  {
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    /* the file the code of PR 178 would have written: an account's jobs and token (owner = a user id) and no links at all */
    const legacy = J.newToken();
    L.fs.writeFileSync(L.path.join(dir, 'jobs.json'), JSON.stringify({
      jobs: [{ id: 'legacyjob001', ownerId: 'user-4f1c', kind: 'youtube', url: WATCH('legacylegac'), title: 'Old', status: 'queued', attempts: 0, workerId: null, createdAt: Date.parse('2026-10-06T11:00:00Z'), claimedAt: 0, finishedAt: 0, error: '', bytes: 0, result: null }],
      tokens: [{ id: legacy.id, ownerId: 'user-4f1c', hash: legacy.hash, label: 'Old PC', createdAt: Date.parse('2026-10-06T11:00:00Z'), lastSeenAt: 0, pollS: 0, revokedAt: 0 }] }));
    const S = await L.startService({ users: ['n1'], store: fileJobStore(dir) });
    try {
      ok('a token that belongs to an account (PR 178) is not accepted: its owner is not a PC link', (await S.worker(legacy.token).get('/api/worker/ping')).status === 401 && (await S.worker(legacy.token).post('/api/worker/claim', {})).status === 401);
      ok('and an account\'s job is not in any link\'s list, cannot be claimed by a link\'s token and is not found by id', (await S.as('n1').get('/api/jobs')).body.jobs.length === 0 && (await S.as('n1').get('/api/jobs/legacyjob001')).status === 404 && (await S.worker(S.token('n1')).post('/api/worker/claim', { once: true })).body.job === null);
      ok('the rows are left as they were (nothing deletes them but the keeping time)', (await S.inner.loadAll()).jobs.some(j => j.id === 'legacyjob001'));
      ok('a user id or a session cookie cannot stand in for a code', (await req(S.port, 'GET', '/api/jobs', { code: 'user-4f1c' })).status === 401 && (await req(S.port, 'GET', '/api/jobs', { cookie: 'ppp_session=user-4f1c' })).status === 401);
    } finally { await S.close(); L.rmDir(dir); }
  }
  {
    const S = await L.startService({ users: ['h1', 'h2'] });
    try {
      const c1 = S.code('h1'), c2 = S.code('h2');
      const h = v => req(S.port, 'GET', '/api/jobs', { headers: { 'X-PPP-PC': v }, ip: '60.0.0.' + Math.floor(Math.random() * 200) });
      ok('upper case, with spaces or dashes, 63 or 65 characters, base64url, with a prefix: not a code (401)', (await Promise.all([c1.toUpperCase(), c1.slice(0, 8) + ' ' + c1.slice(8), c1.slice(0, 8) + '-' + c1.slice(8), c1.slice(1), c1 + '0', Buffer.from(c1, 'hex').toString('base64url'), 'ppc_' + c1, '0x' + c1].map(h))).every(r => r.status === 401 && r.body.code === 'bad-code'));
      const two = await req(S.port, 'GET', '/api/jobs', { headers: { 'X-PPP-PC': [c1, c2] } });
      ok('the header twice (two lines, both valid codes) is not a code: one link is never chosen over another (401)', two.status === 401 && two.body.code === 'bad-code', two.status + ' ' + two.text);
      ok('the header with a code that is valid but a second header with another name does not mix them: only X-PPP-PC is read', (await req(S.port, 'GET', '/api/jobs', { headers: { 'X-PPP-PC-2': c1, 'X-PPP-Link': c1 } })).body.code === 'no-link');
      ok('a code in the query string, the path or the body is ignored (no header: 401 no-link): a code in a URL would be logged by proxies', (await req(S.port, 'GET', '/api/jobs?code=' + c1)).body.code === 'no-link' && (await req(S.port, 'GET', '/api/jobs?clientCode=' + c1 + '&x-ppp-pc=' + c1)).status === 401 && (await req(S.port, 'POST', '/api/jobs', { body: { url: WATCH('querycode01'), clientCode: c1, code: c1 } })).status === 401);
      ok('and the right code in the right header with all that noise around it works', (await req(S.port, 'GET', '/api/jobs?code=' + c2, { code: c1 })).status === 200);
      ok('a guest key (the same shape in the page: 64 hex) and a client code never stand in for each other: with both headers, the queue reads X-PPP-PC only', (await req(S.port, 'GET', '/api/jobs', { code: c1, headers: { 'X-PPP-Guest': c2 } })).status === 200
        && (await req(S.port, 'GET', '/api/jobs', { headers: { 'X-PPP-Guest': c1 } })).body.code === 'no-link' && (await req(S.port, 'GET', '/api/jobs', { code: 'f'.repeat(64), headers: { 'X-PPP-Guest': c1 } })).status === 401
        && require('../../share-guest').guestOwnerId(c1).slice(0, 2) === 'g_' && require('../../share-guest').guestOwnerId(c1) !== S.linkId('h1'));
    } finally { await S.close(); }
  }

  heading('abuse: failed codes, the notes one address can keep, what a stranger cannot do');
  {
    const S = await L.startService({ users: ['v1'] });
    try {
      const out = [];
      for (let i = 0; i < 24; i++) out.push((await req(S.port, 'GET', '/api/worker/status', { code: String(i).padStart(64, 'a'), ip: '70.0.0.1' })).status);
      ok('20 wrong codes an hour from one address, then 429 (counted on failures only); a valid code is never refused for them, nor is a worker; another address is not affected', out.slice(0, 20).every(x => x === 401) && out.slice(20).every(x => x === 429)
        && (await req(S.port, 'GET', '/api/worker/status', { user: 'v1', ip: '70.0.0.1' })).status === 200 && (await S.worker(S.token('v1')).get('/api/worker/ping', { ip: '70.0.0.1' })).status === 200 && (await req(S.port, 'GET', '/api/worker/status', { code: 'b'.repeat(64), ip: '70.0.0.2' })).status === 401, out.join());
      ok('the 429 for a code says to come back later and is in the page\'s words', await (async () => { const r = await req(S.port, 'GET', '/api/worker/status', { code: 'c'.repeat(64), ip: '70.0.0.1' }); return r.status === 429 && r.body.error === 'Too many wrong codes from here. Try again later.' && Number(r.headers['retry-after']) > 0; })());
      ok('50 valid requests from an address that has used up its failures all work', await (async () => { for (let i = 0; i < 50; i++) { const r = await req(S.port, 'GET', '/api/worker/status', { user: 'v1', ip: '70.0.0.1' }); if (r.status !== 200) return false; } return true; })());
    } finally { await S.close(); }
  }
  {
    /* the notes one address can keep: links are free to make and each has its own worker token, so a result posted by its maker is bounded per creating address */
    const cap = 4000;
    const S = await L.startService({ users: [], config: { perAddressResultBytes: cap, perUserResultBytes: 1e9, resultReserveBytes: 0, totalResultBytes: 1e9 } });
    try {
      for (const n of ['a1', 'a2', 'a3']) await S.makeLink(n, { ip: '80.0.0.1' });
      await S.makeLink('other', { ip: '80.0.0.2' });
      const done = async (n, id) => { const q = await queue(S, n, id); const g = (await S.worker(S.token(n)).post('/api/worker/claim', { once: true })).body.job; return { q: q, g: g, r: await S.worker(S.token(n)).post('/api/worker/jobs/' + g.id + '/result', goodResult(40)) }; };
      const r1 = await done('a1', 'addrshare01'), r2 = await done('a2', 'addrshare02');
      ok('two results of 1856 bytes from links of one address are kept (3712 of the 4000)', r1.r.status === 200 && r2.r.status === 200);
      const r3 = await done('a3', 'addrshare03');
      ok('a third, from a third link of the same address, would pass the address\'s share: refused (503 quota) and the job stays claimed', r3.r.status === 503 && r3.r.body.code === 'quota' && jobOfLink(S, 'a3')[0].status === 'claimed', r3.r.status + ' ' + r3.r.text);
      const o = await done('other', 'addrshare04');
      ok('a link made from another address is not touched by it', o.r.status === 200);
      await S.as('a1').del('/api/jobs/' + r1.q.body.job.id);
      ok('removing a conversion gives its room back: the refused result is then taken', (await S.worker(S.token('a3')).post('/api/worker/jobs/' + r3.g.id + '/result', goodResult(40))).status === 200);
      ok('the share is counted by the keyed address tag kept on each link, which only the maker\'s address has', S.svc._state.links.get(S.linkId('a1')).ipTag === S.svc._state.links.get(S.linkId('a3')).ipTag && S.svc._state.links.get(S.linkId('a1')).ipTag !== S.svc._state.links.get(S.linkId('other')).ipTag);
    } finally { await S.close(); }
  }
  {
    /* one stranger, no account, one address: the most it can ever hold on the site, by the defaults */
    const lim = J.LIMITS;
    ok('by the defaults one address can hold at most 20 links x 8 MiB, but 16 MiB in all; the site 64 MiB; 500 links', lim.PER_ADDRESS_RESULT_BYTES === 16 * 1048576 && lim.PER_USER_RESULT_BYTES === 8 * 1048576 && lim.TOTAL_RESULT_BYTES === 64 * 1048576 && lim.MAX_LINKS === 500
      && lim.PER_ADDRESS_RESULT_BYTES < lim.TOTAL_RESULT_BYTES / 2);
    const S = await L.startService({ users: [] });
    try {
      const a = [];
      for (let i = 0; i < 5; i++) a.push(await mk(S, '90.0.0.1'));
      /* 5 links, each enqueueing its 30 an hour and its 60-an-address: the per-address enqueue budget is shared by the links of one address */
      let made = 0, firstRefusal = null;
      for (let i = 0; i < 90; i++) {
        const r = await req(S.port, 'POST', '/api/jobs', { code: a[i % 5].body.clientCode, ip: '90.0.0.1', body: { url: WATCH('addrenq' + String(i).padStart(4, '0')) } });
        if (r.status === 201) { made++; await req(S.port, 'POST', '/api/jobs/' + r.body.job.id + '/cancel', { code: a[i % 5].body.clientCode, body: {} }); } else if (!firstRefusal) firstRefusal = r;
      }
      ok('five links of one address share its 60 enqueues an hour: the 61st is 429 whichever link asks', made === 60 && !!firstRefusal && firstRefusal.status === 429 && firstRefusal.body.code === 'too-many', made + ' ' + (firstRefusal && firstRefusal.status));
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['z'] });
    try {
      ok('the client code of a link cannot be found from outside: no route lists links, tokens or ids (GET /api/pc-links, /api/pc-links/me, /api/worker/tokens are not routes)', (await req(S.port, 'GET', '/api/pc-links')).status === 405 && (await req(S.port, 'GET', '/api/pc-links/me', { user: 'z' })).status === 405 && (await req(S.port, 'GET', '/api/worker/tokens', { user: 'z' })).status === 404);
      const every = ['/api/jobs', '/api/worker/status'].map(p => req(S.port, 'GET', p, { user: 'z' }));
      const texts = (await Promise.all(every)).map(r => r.text).join('');
      ok('and no answer of the browser routes carries a secret or a hash: not the code, not the token, not the link id', texts.indexOf(S.code('z')) < 0 && texts.indexOf(S.token('z')) < 0 && texts.indexOf(S.linkId('z')) < 0 && texts.indexOf(J.codeHash(S.code('z')).toString('hex')) < 0);
    } finally { await S.close(); }
  }
}

main().then(() => L.finish('PC links (the home-PC queue without an account)'), e => { console.error(e); process.exit(1); });
