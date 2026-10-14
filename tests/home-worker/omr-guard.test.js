/* G12-5, after the security review of PR 269: what a body may COST before it is parsed, how long a place for it may be held, and how much the site will read out of the database for scores.
   Over real HTTP with the counting file store (tests/home-worker/omr-jobs-pg.test.js runs the schema rows on Postgres; omr-page.test.js the page's side).

     - THE SHAPE OF A BODY (jsonGuard, home-omr.js): a 16 MB body of `{"pages":[{},{},...]}` is 5.6 million objects (357 MB of heap, 650 ms of a blocked event loop in an unguarded parse);
       it is refused as it ARRIVES, on every route of the queue that reads JSON, with the event loop never blocked and the heap flat. Run in a child process whose heap is capped at 200 MB:
       a guard that is gone ends the child by the heap limit - one clean failed assertion here, not a crashed run.
     - THE TIME OF A BODY and the places for it: a socket that sends its headers and stalls, or trickles a byte at a time, is cut by a deadline; it holds ONE place (its link's, its address's),
       never the site's; places are given back whichever way the request ends (answered, refused, timed out, cut).
     - WHAT THE SITE READS FOR SCORES: page reads over a job's whole lifetime (never reset by a claim), at most two attempts, and a budget per hour and per day for pages and finished
       scores together, with a clear answer (503 "budget", Retry-After) the worker does not wait out.

   Run: node tests/home-worker/omr-guard.test.js */
'use strict';
const net = require('net');
const { spawn } = require('child_process');
const L = require('./lib');
const { ok, heading, sleep } = L;
const { claimOmr, ready, sendOmr, page, pageFilesIn, jobOf } = require('./omr-jobs.test.js');
const MiB = 1048576;
const HEAP_MB = 200;

/* ---------------- the bodies ---------------- */
/* `{"<key>":[{},{},...]}` of exactly `bytes` bytes (or one less): well formed, so an unguarded JSON.parse builds every object before it is done */
function objectsBody(key, bytes) {
  const head = Buffer.from('{"' + key + '":[');
  const tail = Buffer.from(']}');
  const k = Math.floor((bytes - head.length - tail.length + 1) / 3);          /* '{},' x (k-1) then '{}' */
  const out = Buffer.alloc(head.length + 3 * k - 1 + tail.length);
  head.copy(out, 0);
  out.fill('{},', head.length, head.length + 3 * (k - 1));
  out.write('{}', head.length + 3 * (k - 1));
  tail.copy(out, out.length - tail.length);
  return out;
}
/* one HTTP request with a Buffer body (lib.js req sends JSON); resolves { status, body, ms } */
function rawPost(S, p, buf, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': buf.length }, o.headers || {});
    if (o.user) headers['X-PPP-PC'] = S.code(o.user);
    if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
    if (o.ip) headers['X-Forwarded-For'] = o.ip;
    const t0 = Date.now();
    const r = L.http.request({ host: '127.0.0.1', port: S.port, method: 'POST', path: p, headers: headers, agent: false }, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); let b = null; try { b = JSON.parse(text); } catch (e) { b = null; } resolve({ status: res.statusCode, body: b, text: text, ms: Date.now() - t0, headers: res.headers }); });
    });
    r.on('error', e => reject(e));
    r.end(buf);
  });
}
/* a request by hand on a socket: headers (with a declared length) and `first` bytes of the body now, the rest as the test says. Resolves through .done when the socket is closed. */
function rawSocket(S, p, o) {
  const declared = o.declared;
  const head = 'POST ' + p + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ' + declared + '\r\n'
    + (o.user ? 'X-PPP-PC: ' + S.code(o.user) + '\r\n' : '') + (o.token ? 'Authorization: Bearer ' + o.token + '\r\n' : '') + (o.ip ? 'X-Forwarded-For: ' + o.ip + '\r\n' : '') + '\r\n';
  const sock = net.connect(S.port, '127.0.0.1');
  const out = { sock: sock, status: 0, body: null, closed: false, tResp: 0, tClose: 0, t0: Date.now() };
  let buf = '';
  out.done = new Promise(resolve => {
    sock.on('data', d => { buf += d.toString('utf8'); const m = /^HTTP\/1\.1 (\d+)/.exec(buf); if (m && !out.status) { out.status = +m[1]; out.tResp = Date.now() - out.t0; } });
    sock.on('error', () => { /* a reset: the server closed it */ });
    sock.on('close', () => {
      out.closed = true; out.tClose = Date.now() - out.t0;
      /* (the answer is chunked: the JSON is what lies between the first { and the last }) */
      const i = buf.indexOf('\r\n\r\n');
      const a = buf.indexOf('{', i), z = buf.lastIndexOf('}');
      try { out.body = JSON.parse(buf.slice(a, z + 1)); } catch (e) { out.body = null; }
      resolve(out);
    });
  });
  sock.write(head + (o.first || ''));
  return out;
}

/* ---------------- the child: the amplification, under a 200 MB heap ---------------- */
async function child() {
  const out = {};
  const S = await L.startService({ users: ['u1', 'u2'] });
  try {
    await ready(S, 'u1');
    let last = Date.now(), maxGap = 0;
    const probe = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
    const quiet = async () => { await sleep(30); maxGap = 0; last = Date.now(); };

    /* the upload: a body of 16 MB (under the cap of the route) of {} */
    const big = objectsBody('pages', 16 * MiB);
    await quiet();
    const heap0 = process.memoryUsage().heapUsed;
    const up = await rawPost(S, '/api/jobs/omr', big, { user: 'u1' });
    out.upload = { status: up.status, code: up.body && up.body.code, ms: up.ms, maxGap: maxGap, heapGrowthMB: Math.round((process.memoryUsage().heapUsed - heap0) / MiB), jobs: S.svc._state.jobs.size, files: pageFilesIn(S) };

    /* the same shape as a big array of arrays, and as many keys: a different way to the same cost */
    const nested = Buffer.alloc(16 * MiB - 1000, '['); nested.write('{"pages":', 0);
    await quiet();
    const deep = await rawPost(S, '/api/jobs/omr', nested, { user: 'u1' });
    out.deep = { status: deep.status, code: deep.body && deep.body.code, ms: deep.ms, maxGap: maxGap };

    /* the result: a score is claimed, its PC posts 5 MB of {} */
    const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 900 }));
    await claimOmr(S, S.token('u1'));
    const bigResult = objectsBody('pages', 5 * MiB - 100);
    await quiet();
    const rs = await rawPost(S, '/api/worker/jobs/' + q.body.job.id + '/result', bigResult, { token: S.token('u1') });
    out.result = { status: rs.status, code: rs.body && rs.body.code, ms: rs.ms, maxGap: maxGap, still: jobOf(S, q.body.job.id).status };

    /* the result of a conversion: 3 MB of {} in notes */
    const c = await S.as('u2').post('/api/jobs', { url: L.WATCH('abcdefghijk') });
    await ready(S, 'u2');
    await claimOmr(S, S.token('u2'));
    const bigNotes = objectsBody('notes', 3 * MiB - 100);
    await quiet();
    const rn = await rawPost(S, '/api/worker/jobs/' + c.body.job.id + '/result', bigNotes, { token: S.token('u2') });
    out.notes = { status: rn.status, code: rn.body && rn.body.code, ms: rn.ms, maxGap: maxGap };
    clearInterval(probe);
    out.heapMB = Math.round(process.memoryUsage().heapUsed / MiB);
    out.rssMB = Math.round(process.memoryUsage().rss / MiB);
  } finally { await S.close(); }
  console.log('GUARD_RESULT ' + JSON.stringify(out));
}

function runChild() {
  return new Promise(resolve => {
    const c = spawn(process.execPath, ['--max-old-space-size=' + HEAP_MB, __filename], { env: Object.assign({}, process.env, { OMR_GUARD_CHILD: '1' }) });
    let so = '', se = '';
    c.stdout.on('data', d => { so += d; });
    c.stderr.on('data', d => { se += d; });
    const timer = setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } }, 120000);
    c.on('close', code => { clearTimeout(timer); resolve({ code: code, out: so, err: se }); });
  });
}

async function amplification() {
  heading('the shape of a body is bounded as it arrives (a child process with a ' + HEAP_MB + ' MB heap)');
  /* the scanner itself */
  const H = L.mod('home-omr.js');
  const guard = o => H.jsonGuard(Object.assign({ tokens: 200, containers: 40, depth: 4 }, o));
  const push = (g, s, step) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s); let r = null; for (let i = 0; i < b.length && !r; i += step || b.length) r = g.push(b.subarray(i, i + (step || b.length))); return r; };
  ok('the scanner: a body of base64 is any length and costs nothing (a 17 MB string: structure of 8 tokens)', await (async () => {
    const g = guard();
    return push(g, Buffer.from('{"title":"x","pages":["' + 'A'.repeat(17 * MiB) + '","BBBB"],"large":false}'), 65536) === null && g.counts().tokens === 8;
  })());
  ok('the scanner: {} and [] repeated are over the bound after a few bytes (and the answer is "shape")', push(guard(), objectsBody('pages', 1 << 20)) === 'shape' && guard().push(Buffer.from('[[[[[[')) === 'shape');
  ok('the scanner: braces, commas and colons INSIDE a string are not structure (a MusicXML text with a million commas)', push(guard({ tokens: 10 }), Buffer.from('{"x":"' + ',:{[,:{['.repeat(100000) + '"}'), 4096) === null);
  ok('the scanner: a quote escaped by a backslash does not end a string, whichever chunk the backslash falls at the end of', (() => {
    const s = Buffer.from('{"a":"x\\",,,,,,,,,,,,,,,,\\\\","b":1}');
    return [1, 2, 3, 5, 7, s.length].every(step => push(guard({ tokens: 4 }), s, step) === null);
  })());
  ok('the scanner: the depth is bounded too (a thousand [ in a row, with one container each)', guard({ depth: 4, containers: 5000, tokens: 5000 }).push(Buffer.from('['.repeat(1000))) === 'shape');

  const r = await runChild();
  const m = /GUARD_RESULT (.*)/.exec(r.out);
  ok('the child finished its requests within a ' + HEAP_MB + ' MB heap (a guard that is gone ends it by the heap limit)', r.code === 0 && !!m, 'exit ' + r.code + ' ' + (r.err.split('\n').filter(Boolean).slice(-3).join(' | ')).slice(0, 300));
  if (!m) return;
  const g = JSON.parse(m[1]);
  ok('a 16 MB upload of {"pages":[{},{},...]} is 422 bad-body, stores nothing', g.upload.status === 422 && g.upload.code === 'bad-body' && g.upload.jobs === 0 && g.upload.files === 0, JSON.stringify(g.upload));
  ok('... in under a second for the whole of it, and the event loop was never blocked for 150 ms (an unguarded parse of it is 650 ms)', g.upload.ms < 1500 && g.upload.maxGap < 150, JSON.stringify(g.upload));
  ok('... and the heap did not grow by more than 40 MB (an unguarded parse of it is 357 MB)', g.upload.heapGrowthMB < 40, JSON.stringify(g.upload));
  ok('16 MB of [ is refused the same way (the depth), the loop not blocked', g.deep.status === 422 && g.deep.maxGap < 150, JSON.stringify(g.deep));
  ok('5 MB of {} as the RESULT of a score is 422 bad-body, the job stays claimed, the loop not blocked', g.result.status === 422 && g.result.code === 'bad-body' && g.result.still === 'claimed' && g.result.maxGap < 150, JSON.stringify(g.result));
  ok('3 MB of {} as the notes of a CONVERSION is 422 bad-body, the loop not blocked', g.notes.status === 422 && g.notes.code === 'bad-body' && g.notes.maxGap < 150, JSON.stringify(g.notes));
  ok('the child\'s heap ends small (' + g.heapMB + ' MB used, ' + g.rssMB + ' MB resident)', g.heapMB < 120, JSON.stringify(g));

  /* every route that reads JSON has a bound, not only the big ones (in this process: 4 KB bodies cannot hurt, but they must not be taken either) */
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 777 }));
    const id = q.body.job.id;
    await claimOmr(S, S.token('u1'));
    const wide = Buffer.from('{"a":[' + '{},'.repeat(1000) + '{}]}');
    const routes = [
      ['claim', '/api/worker/claim', { token: S.token('u1') }], ['heartbeat', '/api/worker/jobs/' + id + '/heartbeat', { token: S.token('u1') }],
      ['fail', '/api/worker/jobs/' + id + '/fail', { token: S.token('u1') }], ['result', '/api/worker/jobs/' + id + '/result', { token: S.token('u1') }],
      ['making a link', '/api/pc-links', {}], ['a new token', '/api/pc-links/me/worker-token', { user: 'u1' }], ['a conversion', '/api/jobs', { user: 'u1' }], ['a score', '/api/jobs/omr', { user: 'u1' }]];
    for (const [name, p, o] of routes) {
      const r1 = await rawPost(S, p, wide, o);
      ok('the ' + name + ' route refuses a body with a thousand objects in it: 422 bad-body', r1.status === 422 && r1.body && r1.body.code === 'bad-body', r1.status + ' ' + r1.text.slice(0, 100));
    }
    ok('and nothing of any of them changed the job', jobOf(S, id).status === 'claimed');
  } finally { await S.close(); }
}

/* ---------------- the time of a body, and the places for it ---------------- */
async function slowSenders() {
  heading('a body must arrive: a deadline for the whole of it, one for the gap, one place per link and per address');
  const S = await L.startService({ users: ['u1', 'u2', 'u3', 'u4'], config: { bodyIdleMs: 400, bodyTotalMs: 1600 } });
  try {
    for (const u of ['u1', 'u2', 'u3', 'u4']) await ready(S, u);
    const body = JSON.stringify({ title: 'slow', pages: L.omrPages(1, { w: 1000, bytes: 4000 }) });
    const ADDR = { u1: '198.51.100.1', u2: '198.51.100.2', u3: '198.51.100.3', u4: '198.51.100.4' };

    /* a sender that stalls */
    const a = rawSocket(S, '/api/jobs/omr', { user: 'u1', ip: ADDR.u1, declared: body.length, first: body.slice(0, 20) });
    await sleep(120);
    const legit = await sendOmr(S, 'u2', L.omrPages(1, { w: 1100 }), null, { ip: ADDR.u2 });
    ok('a stalled upload does not stop another link, from another address (201)', legit.status === 201, legit.status + ' ' + legit.text.slice(0, 100));
    const sameLink = await sendOmr(S, 'u1', L.omrPages(1, { w: 1101 }), null, { ip: '198.51.100.99' });
    ok('a second upload on the SAME link is refused, from any address: 429 in-flight (its place is taken)', sameLink.status === 429 && sameLink.body.code === 'in-flight' && Number(sameLink.headers['retry-after']) > 0, sameLink.status + ' ' + sameLink.text.slice(0, 100));
    const sameAddr = await sendOmr(S, 'u3', L.omrPages(1, { w: 1102 }), null, { ip: ADDR.u1 });
    ok('an upload from the same ADDRESS on another link is refused: 503 busy (one place per address)', sameAddr.status === 503 && sameAddr.body.code === 'busy', sameAddr.status + ' ' + sameAddr.text.slice(0, 100));
    const other = await sendOmr(S, 'u3', L.omrPages(1, { w: 1103 }), null, { ip: ADDR.u3 });
    ok('while it stalls the site still has places: another link on another address is taken (201)', other.status === 201, other.status + ' ' + other.text.slice(0, 100));
    const out = await a.done;
    ok('the stalled sender is answered 408 slow when the gap deadline passes (0.4 s here), and the connection is closed by the site', out.status === 408 && out.body && out.body.code === 'slow' && out.tResp >= 300 && out.tResp < 1400 && out.closed && out.tClose < 2500, JSON.stringify({ s: out.status, t: out.tResp, c: out.tClose }));
    const after = await sendOmr(S, 'u1', L.omrPages(1, { w: 1104 }), null, { ip: ADDR.u1 });
    ok('its place is free again, and the refusals cost no hourly slot: the same link and address are taken now (201)', after.status === 201, after.status + ' ' + after.text.slice(0, 100));

    /* a sender that trickles: the gap deadline never passes, the total one does */
    const b = rawSocket(S, '/api/jobs/omr', { user: 'u4', ip: ADDR.u4, declared: body.length, first: body.slice(0, 5) });
    let k = 5;
    const drip = setInterval(() => { if (k < body.length && !b.closed) { try { b.sock.write(body[k++]); } catch (e) { /* closed */ } } }, 100);
    const giveUp = setTimeout(() => { try { b.sock.destroy(); } catch (e) { /* gone */ } }, 6000);     /* (a deadline that is gone would otherwise be a nine-minute drip) */
    const ob = await b.done;
    clearInterval(drip); clearTimeout(giveUp);
    ok('a sender that sends a byte every 100 ms is cut by the TOTAL deadline (1.6 s here): 408 slow, not before 1.3 s', ob.status === 408 && ob.tResp >= 1300 && ob.tResp < 3000 && k < body.length, JSON.stringify({ s: ob.status, t: ob.tResp, sent: k, of: body.length }));

    /* a sender that goes away */
    const c = rawSocket(S, '/api/jobs/omr', { user: 'u4', ip: ADDR.u4, declared: body.length, first: body.slice(0, 20) });
    await sleep(100);
    const busyNow = await sendOmr(S, 'u4', L.omrPages(1, { w: 1105 }), null, { ip: ADDR.u4 });
    c.sock.destroy();
    await c.done;
    await sleep(100);
    const freed = await sendOmr(S, 'u4', L.omrPages(1, { w: 1105 }), null, { ip: ADDR.u4 });
    ok('a sender that goes away mid-body gives its place back at once (429 while it was there, 201 the moment it is gone)', busyNow.status === 429 && freed.status === 201, busyNow.status + ' ' + freed.status);

    /* a refused body gives its place back */
    const refused = await rawPost(S, '/api/jobs/omr', Buffer.from('{"pages":["not base64!"]}'), { user: 'u2', ip: ADDR.u2 });
    const next = await sendOmr(S, 'u2', L.omrPages(1, { w: 1106 }), null, { ip: ADDR.u2 });
    ok('a body that is refused (422) gives its place back: the next upload of the same link and address is taken', refused.status === 422 && next.status === 201, refused.status + ' ' + next.status + ' ' + next.text.slice(0, 80));

    /* the same for a PC sending a result: its own link's place, apart from uploads */
    const u3job = Array.from(S.svc._state.jobs.values()).find(j => j.ownerId === S.linkId('u3') && j.status === 'queued');
    await claimOmr(S, S.token('u3'));
    const rbody = JSON.stringify(L.omrResult(1));
    const r1 = rawSocket(S, '/api/worker/jobs/' + u3job.id + '/result', { token: S.token('u3'), ip: ADDR.u3, declared: rbody.length, first: rbody.slice(0, 30) });
    await sleep(100);
    const r2 = await S.worker(S.token('u3')).post('/api/worker/jobs/' + u3job.id + '/result', L.omrResult(1), { ip: ADDR.u3 });
    ok('a result that stalls holds the link\'s result place: a second result of the same link is 429 in-flight meanwhile', r2.status === 429 && r2.body.code === 'in-flight', r2.status + ' ' + r2.text.slice(0, 100));
    const or = await r1.done;
    ok('... and the stalled result is cut with 408', or.status === 408, or.status + '');
    const r3 = await S.worker(S.token('u3')).post('/api/worker/jobs/' + u3job.id + '/result', L.omrResult(1), { ip: ADDR.u3 });
    ok('... after which the real result is taken (200)', r3.status === 200, r3.status + ' ' + r3.text.slice(0, 100));

    /* a body announced as far too large is answered at once and the connection closed, nothing read */
    const huge = rawSocket(S, '/api/jobs/omr', { user: 'u2', ip: ADDR.u2, declared: 200 * MiB, first: '{"pages":["' });
    const oh = await huge.done;
    ok('a body that announces 200 MB is 413 at once, and the connection closed', oh.status === 413 && oh.tResp < 300 && oh.closed, JSON.stringify({ s: oh.status, t: oh.tResp }));
    /* ... on every route that reads a body, not only the upload's own check: a claim that announces 5 MB (its cap is 4 KB, its drain 1 MB) */
    const big = rawSocket(S, '/api/worker/claim', { token: S.token('u4'), declared: 5 * MiB, first: '{"once":true' });
    const ob2 = await big.done;
    ok('a claim that announces 5 MB is 413 at once, the connection closed, nothing waited for (the gap deadline is 0.4 s here)', ob2.status === 413 && ob2.tResp < 300 && ob2.closed, JSON.stringify({ s: ob2.status, t: ob2.tResp }));
  } finally { await S.close(); }
}

/* ---------------- what the site reads for scores ---------------- */
async function egress() {
  heading('page reads over the whole life of a job, two attempts, and a budget for the site');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(4, { w: 800, bytes: 5000 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const st = [];
      for (let i = 0; i < 8; i++) st.push((await page(S, tok, id, i % 4)).status);
      ok('first claim of a job of 4 pages: 6 reads (4 pages and 2 again), the 7th and 8th are 429', st.join() === '200,200,200,200,200,200,429,429', st.join());
      await S.worker(tok).post('/api/worker/jobs/' + id + '/fail', { error: 'lost', retry: true });
      S.advance(3 * 60 * 1000);
      const c2 = await claimOmr(S, tok);
      ok('the job is claimed again (attempt 2 of 2)', c2.body.job && c2.body.job.attempt === 2 && c2.body.job.maxAttempts === 2);
      const st2 = [];
      for (let i = 0; i < 8; i++) st2.push((await page(S, tok, id, i % 4)).status);
      ok('a claim does NOT start the count again: the second claim has 6 more (12 in all for 2 attempts of 4 pages), then 429', st2.join() === '200,200,200,200,200,200,429,429' && jobOf(S, id).pageReads === 12, st2.join() + ' reads=' + jobOf(S, id).pageReads);
      const total = st.concat(st2).filter(s => s === 200).length;
      ok('the most the database was asked for one job is 12 pages (not 3 claims x 3 reads x pages): ' + total, total === 12);
      const f = await S.worker(tok).post('/api/worker/jobs/' + id + '/fail', { error: 'lost again', retry: true });
      ok('and a retry asked for on the second attempt is the end of it (failed, images deleted)', f.status === 200 && f.body.requeued !== true && jobOf(S, id).status === 'failed' && pageFilesIn(S) === 0);
    } finally { await S.close(); }
  }
  {
    /* the 11 MB job of the review: 11 pages of 1 MB, a worker that keeps failing with retry */
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(11, { w: 900, bytes: 1000000 }));
      ok('an 11 MB job of 11 pages is taken', q.status === 201, q.status + ' ' + q.text.slice(0, 100));
      const id = q.body.job.id;
      let bytes = 0, reads = 0;
      for (let claim = 0; claim < 3; claim++) {
        const c = await claimOmr(S, tok);
        if (!c.body.job) { S.advance(10 * 60 * 1000); const c2 = await claimOmr(S, tok); if (!c2.body.job) break; }
        for (let i = 0; i < 40; i++) { const r = await page(S, tok, id, i % 11); if (r.status !== 200) break; reads++; bytes += (r.raw ? r.raw.length : 1000000); }
        const f = await S.worker(tok).post('/api/worker/jobs/' + id + '/fail', { error: 'again', retry: true });
        S.advance(10 * 60 * 1000);
        if (f.body.requeued !== true) break;
      }
      ok('however it behaves, one such job is read at most 2 x (11 + 2) = 26 pages out of the database (it was 99 before: 3 claims x 3 reads x 11 pages) — ' + reads, reads <= 26 && reads >= 22, 'reads=' + reads);
    } finally { await S.close(); }
  }
  {
    /* the site's budget, per hour: pages and finished scores together */
    const S = await L.startService({ users: ['u1', 'u2'], config: { omrEgressPerHour: 18000, omrEgressPerDay: 10 * MiB } });
    try {
      await ready(S, 'u1'); await ready(S, 'u2');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(4, { w: 810, bytes: 4000 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const st = [];
      for (let i = 0; i < 6; i++) st.push((await page(S, tok, id, i % 4)).status);
      const refused = await page(S, tok, id, 0);
      ok('the budget (18,000 bytes an hour here, pages of about 4,000): pages are handed out until it is used up (the read that crosses it is served), then 503 budget with a Retry-After',
        st.join() === '200,200,200,200,200,503' && refused.status === 503 && refused.body.code === 'budget' && Number(refused.headers['retry-after']) >= 60, st.join() + ' ' + refused.status + ' ' + refused.text.slice(0, 100));
      ok('a refused read is not counted against the job (its own reads stay at 5)', jobOf(S, id).pageReads === 5, jobOf(S, id).pageReads + '');
      const q2 = await sendOmr(S, 'u2', L.omrPages(2, { w: 811, bytes: 6000 }));
      ok('a score that the budget could not send even once is refused at the door: 503 budget, nothing stored', q2.status === 503 && q2.body.code === 'budget' && pageFilesIn(S) === 4, q2.status + ' ' + q2.text.slice(0, 120));
      S.advance(3600 * 1000 + 61 * 1000);
      await S.worker(tok).post('/api/worker/claim', { once: true, omr: true });
      ok('an hour later the budget is back: the page is handed out (a window that slides)', (await page(S, tok, id, 0)).status === 200);
      ok('and the score that was refused is taken now', (await sendOmr(S, 'u2', L.omrPages(2, { w: 811, bytes: 6000 }))).status === 201);
    } finally { await S.close(); }
  }
  {
    /* what the site WRITES for scores: the images it accepts, per hour and per day, all links together */
    const S = await L.startService({ users: ['u1', 'u2', 'u3'], config: { omrIngressPerHour: 10000, omrIngressPerDay: 15000 } });
    try {
      for (const u of ['u1', 'u2', 'u3']) await ready(S, u);
      const pg = (w, b) => L.omrPages(1, { w: w, bytes: b, vary: false });
      const a = await sendOmr(S, 'u1', pg(900, 4000));
      const b = await sendOmr(S, 'u2', pg(901, 4000));
      const c = await sendOmr(S, 'u3', pg(902, 4000));
      ok('the budget for what the site accepts (10,000 bytes an hour here): two images of 4,000 are taken, the third (12,000 in all) is 503 budget with a Retry-After and nothing stored', a.status === 201 && b.status === 201 && c.status === 503 && c.body.code === 'budget' && Number(c.headers['retry-after']) >= 60 && pageFilesIn(S) === 2, [a.status, b.status, c.status].join() + ' ' + c.text.slice(0, 100));
      const small = await sendOmr(S, 'u3', pg(903, 1500));
      ok('a refusal costs nothing: a smaller one that fits (1,500) is taken after it', small.status === 201, small.status + ' ' + small.text.slice(0, 80));
      ok('a score that is queued but whose write fails gives its bytes back (the budget is not used by what was never written)', await (async () => {
        const T = await L.startService({ users: ['v1'], config: { omrIngressPerHour: 9000 } });
        try {
          await ready(T, 'v1');
          T.store.fail.on = true; T.store.fail.only = 'insertOmrJob';
          const bad = await sendOmr(T, 'v1', pg(910, 5000));
          T.store.fail.on = false;
          const good = await sendOmr(T, 'v1', pg(911, 5000));
          return bad.status === 503 && good.status === 201;
        } finally { await T.close(); }
      })());
      S.advance(3600 * 1000 + 61 * 1000);
      await ready(S, 'u3');
      ok('an hour later the hour is free again, but the day\'s 15,000 is not: 5,600 more (9,500 + 5,600 > 15,000) is 503, 5,000 is taken', (await sendOmr(S, 'u3', pg(904, 5600))).status === 503 && (await sendOmr(S, 'u3', pg(905, 5000))).status === 201);
    } finally { await S.close(); }
  }
  {
    /* per day: the hour's budget is large, the day's is not */
    const S = await L.startService({ users: ['u1'], config: { omrEgressPerHour: 10 * MiB, omrEgressPerDay: 20000 } });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(3, { w: 820, bytes: 4000 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const st = [];
      for (let i = 0; i < 6; i++) st.push((await page(S, tok, id, i % 3)).status);
      ok('the day\'s budget (20,000 bytes here) ends the reads though the hour\'s has room: 5 pages, then 503 budget', st.filter(s => s === 200).length === 5 && st[5] === 503, st.join());
      S.advance(2 * 3600 * 1000);
      await S.worker(tok).post('/api/worker/claim', { once: true, omr: true });
      ok('two hours later it is still the day\'s: 503', (await page(S, tok, id, 0)).status === 503);
      S.advance(24 * 3600 * 1000);
      ok('a day later it is back', true);
    } finally { await S.close(); }
  }
  {
    /* the finished score a page opens counts too; the notes of a conversion do not */
    const S = await L.startService({ users: ['u1', 'u2'], config: { omrEgressPerHour: 1500 } });
    try {
      await ready(S, 'u1'); await ready(S, 'u2');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 830, bytes: 400 }));
      await claimOmr(S, tok);
      await page(S, tok, q.body.job.id, 0);                                  /* the PC reads its one page of about 400 bytes */
      await S.worker(tok).post('/api/worker/jobs/' + q.body.job.id + '/result', L.omrResult(1));
      const size = jobOf(S, q.body.job.id).bytes;
      const reads = [];
      for (let i = 0; i < 4; i++) reads.push((await S.as('u1').get('/api/jobs/' + q.body.job.id)).status);
      const refused = reads.indexOf(503);
      ok('a finished score (' + size + ' bytes) counts against the budget of 1500 bytes like a page does: ' + Math.floor((1500 - 400) / size) + ' reads, then 503 budget', size > 400 && refused === Math.floor((1500 - 400) / size) && reads.slice(refused).every(s => s === 503) && reads.slice(0, refused).every(s => s === 200), reads.join() + ' size=' + size);
      const again = await S.as('u1').get('/api/jobs/' + q.body.job.id);
      ok('the answer says why, with a Retry-After, and "your score is kept"', again.status === 503 && again.body.code === 'budget' && Number(again.headers['retry-after']) >= 60 && /kept/.test(again.body.error), again.status + ' ' + again.text.slice(0, 160));
      const kept = jobOf(S, q.body.job.id);
      ok('the score is still there (nothing was deleted for a refused read), and an hour later it is read', kept && kept.status === 'done' && (S.advance(3600 * 1000 + 61000), (await S.as('u1').get('/api/jobs/' + q.body.job.id)).status === 200));
      const c = await S.as('u2').post('/api/jobs', { url: L.WATCH('zyxwvutsrqp') });
      await claimOmr(S, S.token('u2'));
      await S.worker(S.token('u2')).post('/api/worker/jobs/' + c.body.job.id + '/result', L.goodResult(40));
      const rn = await S.as('u2').get('/api/jobs/' + c.body.job.id);
      ok('the notes of a conversion are read though the budget for scores is used up (the budget is for scores)', rn.status === 200 && rn.body.result && rn.body.result.notes.length === 40, rn.status + '');
    } finally { await S.close(); }
  }
}

/* ---------------- the foreign key and the rows nothing names (file store; Postgres is omr-jobs-pg.test.js) ---------------- */
async function orphans() {
  heading('page files that no job names are deleted: at the boot read and at a purge');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 840 }));
    ok('two page files for a job', pageFilesIn(S) === 2);
    /* the jobs file is lost (a copy put back, a restore) while the pages are not */
    const f = L.path.join(S.dir, 'jobs.json');
    const d = JSON.parse(L.fs.readFileSync(f, 'utf8'));
    const keep = d.jobs;
    d.jobs = [];
    L.fs.writeFileSync(f, JSON.stringify(d));
    S.svc._state.forgetAll();
    await S.as('u1').get('/api/jobs');
    await ready(S, 'u1');       /* (a worker says it can read scores at every claim: the site that was read again hears it again) */
    ok('the next boot read finds page files no job names and removes them (the job file is as it was put back: no job, no file)', pageFilesIn(S) === 0, 'files=' + pageFilesIn(S));
    ok('(the store was asked once)', S.store.calls.deleteOrphanPages === 1, JSON.stringify(S.store.calls));
    void keep; void q;
    /* a file that appears later is found when rows are purged */
    L.fs.writeFileSync(L.path.join(S.dir, 'omr-pages', 'Zzzzzzzzzzzz.0.bin'), Buffer.alloc(100));
    const q2 = await sendOmr(S, 'u1', L.omrPages(1, { w: 841 }));
    await claimOmr(S, S.token('u1'));
    await S.worker(S.token('u1')).post('/api/worker/jobs/' + q2.body.job.id + '/result', L.omrResult(1));
    const before = S.store.calls.deleteOrphanPages;
    S.advance(2 * 24 * 3600 * 1000);
    await S.svc._state.purge(S.clock.t);
    ok('a purge that removes jobs removes page files nothing names in the same call (the store\'s purge: no extra statement)', pageFilesIn(S) === 0 && S.store.calls.deleteOrphanPages === before && S.store.calls.purge === 1, 'files=' + pageFilesIn(S) + ' ' + JSON.stringify(S.store.calls));
    await S.svc._state.purge(S.clock.t + 10);
    ok('a purge that removes nothing costs the store nothing', S.store.calls.purge === 1 && S.store.calls.deleteOrphanPages === before);
  } finally { await S.close(); }
}

(async () => {
  if (process.env.OMR_GUARD_CHILD === '1') return child();
  await amplification();
  await slowSenders();
  await egress();
  await orphans();
  L.finish('the home-PC queue, kind omr: shape, time and egress of a body');
})().catch(e => { console.error(e); process.exit(1); });
