/* G13-S0: what a stranger with no account can make the sync server COST - the three mistakes of the G12-5 reviews built out from the start, and the rest of the abuse table
   (docs/GOALS/G13_PRODUCTIZATION.md 7.7): over real HTTP, with the counting file store.

     - THE SHAPE OF A BODY: `{"items":[{},{},...]}` of 6 MB is 2 million objects (hundreds of MB of heap and a blocked loop if it is parsed); an item that is a small gzip of
       2 million `{}`; a zip bomb; a megabyte of '[' - each is refused as it arrives or as it is unpacked, the loop never blocked, the heap flat. Run in a CHILD PROCESS whose heap is
       capped at 200 MB: a guard that is gone ends the child by the heap limit - one failed assertion here, not a crashed run.
     - A BODY SENT ONE BYTE AT A TIME (the second review's flood): 900,000 writes, the heap flat.
     - THE TIME OF A BODY and the places for it: a sender that stalls or trickles is cut (408) and its place is given back; one place per library, one per address, eight for the site;
       the unpacking of items is a separate, smaller ceiling that no sender can hold.
     - WHAT THE SITE SENDS: a library cannot read the same megabytes over and over (budgets), a reader that takes the answer slowly is cut and its place given back.

   Run: node tests/sync/sync-abuse.test.js */
'use strict';
const net = require('net');
const { spawn } = require('child_process');
const L = require('./lib');
const { ok, heading, sleep } = L;
const zlib = require('zlib');
const MiB = L.MiB;
const HEAP_MB = 200;
const bad = (r, status, code) => r.status === status && r.body && r.body.code === code;

/* `{"<key>":[{},{},...]}` of exactly `bytes` bytes (or one less): well formed, so an unguarded JSON.parse builds every object before it is done */
function objectsBody(key, bytes) {
  const head = Buffer.from('{"' + key + '":[');
  const tail = Buffer.from(']}');
  const k = Math.floor((bytes - head.length - tail.length + 1) / 3);
  const out = Buffer.alloc(head.length + 3 * k - 1 + tail.length);
  head.copy(out, 0);
  out.fill('{},', head.length, head.length + 3 * (k - 1));
  out.write('{}', head.length + 3 * (k - 1));
  tail.copy(out, out.length - tail.length);
  return out;
}
/* one request with a Buffer body, as a library; resolves { status, body, ms } */
function raw(S, method, p, buf, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    if (buf) headers['Content-Length'] = buf.length;
    if (o.lib) headers['X-PPP-Lib'] = S.code(o.lib);
    if (o.ip) headers['X-Forwarded-For'] = o.ip;
    const t0 = Date.now();
    const r = L.http.request({ host: '127.0.0.1', port: S.port, method: method, path: p, headers: headers, agent: false }, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); let b = null; try { b = JSON.parse(text); } catch (e) { b = null; } resolve({ status: res.statusCode, body: b, text: text, ms: Date.now() - t0, headers: res.headers }); });
    });
    r.on('error', e => reject(e));
    r.end(buf || undefined);
  });
}
/* a request by hand on a socket: the head with a declared length and `first` bytes of the body now; the rest as the test says. out.done resolves when the socket is closed. */
function rawSocket(S, method, p, o) {
  const head = method + ' ' + p + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ' + o.declared + '\r\n'
    + (o.lib ? 'X-PPP-Lib: ' + S.code(o.lib) + '\r\n' : '') + (o.ip ? 'X-Forwarded-For: ' + o.ip + '\r\n' : '') + '\r\n';
  const sock = net.connect(S.port, '127.0.0.1');
  const out = { sock: sock, status: 0, body: null, closed: false, tResp: 0, tClose: 0, t0: Date.now() };
  let buf = '';
  out.done = new Promise(resolve => {
    sock.on('data', d => { buf += d.toString('utf8'); const m = /^HTTP\/1\.1 (\d+)/.exec(buf); if (m && !out.status) { out.status = +m[1]; out.tResp = Date.now() - out.t0; } });
    sock.on('error', () => { /* a reset: the server closed it */ });
    sock.on('close', () => {
      out.closed = true; out.tClose = Date.now() - out.t0;
      const i = buf.indexOf('\r\n\r\n');
      const a = buf.indexOf('{', i), z = buf.lastIndexOf('}');
      try { out.body = JSON.parse(buf.slice(a, z + 1)); } catch (e) { out.body = null; }
      resolve(out);
    });
  });
  sock.write(head + (o.first || ''));
  return out;
}
/* ONE byte at a time after the headers and a prefix: `count` writes (the second review's N1: 1.4 million of them, inside every cap, held about 350 bytes of Buffer each) */
function oneByteFlood(S, p, o) {
  return new Promise(resolve => {
    const head = 'PUT ' + p + ' HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ' + o.declared + '\r\nX-PPP-Lib: ' + S.code(o.lib) + '\r\n\r\n';
    const s = net.connect(S.port, '127.0.0.1');
    const one = Buffer.from('A');
    let sent = 0, closed = false;
    const t0 = Date.now();
    s.on('error', () => {});
    s.on('data', () => {});
    s.on('close', () => { closed = true; resolve({ sent: sent, ms: Date.now() - t0, closedByServer: sent < o.count }); });
    s.setNoDelay(true);
    s.on('connect', () => {
      s.write(head + (o.first || ''));
      const pump = () => {
        let i = 0;
        while (sent < o.count && !closed) {
          sent++;
          if (!s.write(one)) { s.once('drain', pump); return; }
          if (++i % 20000 === 0) { setImmediate(pump); return; }
        }
        s.destroy();
      };
      pump();
    });
  });
}

/* ---------------- the child: the amplification, under a 200 MB heap ---------------- */
async function child() {
  const out = {};
  const S = await L.startSync({ memory: true, libs: ['a', 'b'] });
  try {
    let last = Date.now(), maxGap = 0;
    const probe = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
    const quiet = async () => { await sleep(30); maxGap = 0; last = Date.now(); };
    const heapNow = () => (global.gc && global.gc(), process.memoryUsage().heapUsed);
    const item = (key, plain) => ({ key: key, baseRev: 0, hash: 'h'.repeat(16), body: L.gz(plain).toString('base64') });
    const put = (lib, items) => raw(S, 'PUT', '/api/sync/items', Buffer.from(JSON.stringify({ device: 'a1b2c3d4e5f60718', items: items })), { lib: lib });

    /* the request body: 5.9 MB of {} where a batch is a handful of tokens */
    const wide = objectsBody('items', Math.floor(5.9 * MiB));
    await quiet(); let heap0 = heapNow();
    let r = await raw(S, 'PUT', '/api/sync/items', wide, { lib: 'a' });
    out.wide = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap, heapGrowthMB: Math.round((heapNow() - heap0) / MiB) };
    const nested = Buffer.alloc(Math.floor(5.9 * MiB), '['); nested.write('{"items":', 0);
    await quiet();
    r = await raw(S, 'PUT', '/api/sync/items', nested, { lib: 'a' });
    out.deep = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap };
    /* over the cap of the route: refused on its announced length, before a byte is read (a 20 MB body is a connection that is closed) */
    await quiet();
    const huge = objectsBody('items', 20 * MiB);
    r = await raw(S, 'PUT', '/api/sync/items', huge, { lib: 'a' }).catch(e => ({ status: 0, err: e.message, ms: 0 }));
    out.huge = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap };

    /* the item: a small gzip of 6 MB of {} (two million objects) */
    const objs = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"x":[' + '{},'.repeat(2 * 1024 * 1024) + '{}]}}');
    const gzObjs = L.gz(objs);
    await quiet(); heap0 = heapNow();
    r = await put('a', [item('song:amp', objs)]);
    out.amp = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap, heapGrowthMB: Math.round((heapNow() - heap0) / MiB), gzKB: Math.round(gzObjs.length / 1024) };
    /* ... and 4 MB of nesting */
    const deep = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":' + '['.repeat(2 * MiB) + ']'.repeat(2 * MiB) + '}');
    await quiet();
    r = await put('a', [item('song:deep', deep)]);
    out.itemDeep = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap };

    /* a zip bomb: half a gigabyte of zeros in about half a megabyte of gzip */
    const bomb = await new Promise((resolve, reject) => {
      const gzs = zlib.createGzip({ level: 9 });
      const parts = [];
      gzs.on('data', c => parts.push(c)); gzs.on('end', () => resolve(Buffer.concat(parts))); gzs.on('error', reject);
      const chunk = Buffer.alloc(1 << 20, 0x20);
      let n = 0;
      const pump = () => { while (n < 512) { n++; if (!gzs.write(chunk)) { gzs.once('drain', pump); return; } } gzs.end(); };
      pump();
    });
    await quiet(); heap0 = heapNow();
    r = await raw(S, 'PUT', '/api/sync/items', Buffer.from(JSON.stringify({ items: [{ key: 'song:bomb', baseRev: 0, hash: 'h'.repeat(16), body: bomb.toString('base64') }] })), { lib: 'a' });
    out.bomb = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap, heapGrowthMB: Math.round((heapNow() - heap0) / MiB), gzKB: Math.round(bomb.length / 1024) };

    /* the biggest legitimate item: 7.5 MB of text unpacked (a few KB of gzip): what does one cost? */
    const legit = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"t":"' + 'abcdefgh'.repeat(Math.floor(7.5 * MiB / 8)) + '"}}');
    await quiet(); heap0 = heapNow();
    let peak = 0;
    const meter = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
    r = await put('b', [item('song:legit', legit)]);
    clearInterval(meter);
    out.legit = { status: r.status, ms: r.ms, peakGrowthMB: Math.round((peak - heap0) / MiB) };
    /* and 25 small songs in one request */
    r = await put('b', Array.from({ length: 25 }, (_, i) => item('song:s' + i, L.songBody(40 + i))));
    out.batch = { status: r.status, applied: r.body && r.body.applied && r.body.applied.length };

    /* N1: a body sent a byte at a time: 900,000 writes, announced as 5 MB (inside the route's cap) */
    {
      const rowsBefore = (await S.inner.changes(S.libId('a'), 0, 99999)).length;
      await quiet();
      const heapBefore = heapNow();
      const fl = await oneByteFlood(S, '/api/sync/items', { declared: 5000000, lib: 'a', first: '{"items":["', count: 900000 });
      await sleep(300);
      const heapAfter = heapNow();
      const next = await put('a', [item('song:after', L.songBody(8))]);
      out.flood = { sent: fl.sent, ms: fl.ms, heapBeforeMB: Math.round(heapBefore / MiB), heapAfterMB: Math.round(heapAfter / MiB), maxGap: maxGap, after: next.status, rowsBefore: rowsBefore, rows: (await S.inner.changes(S.libId('a'), 0, 99999)).length };
    }
    /* the unauthenticated door: 900 KB of {} to POST /api/libs (4 KB is its cap) */
    await quiet();
    r = await raw(S, 'POST', '/api/libs', objectsBody('x', 900 * 1024), { ip: '203.0.113.5' });
    out.makeLib = { status: r.status, code: r.body && r.body.code, ms: r.ms, maxGap: maxGap };
    clearInterval(probe);
    out.heapMB = Math.round(heapNow() / MiB);
    out.rssMB = Math.round(process.memoryUsage().rss / MiB);
  } finally { await S.close(); }
  console.log('ABUSE_RESULT ' + JSON.stringify(out));
}

function runChild() {
  return new Promise(resolve => {
    const c = spawn(process.execPath, ['--max-old-space-size=' + HEAP_MB, '--expose-gc', __filename], { env: Object.assign({}, process.env, { SYNC_ABUSE_CHILD: '1' }) });
    let so = '', se = '';
    c.stdout.on('data', d => { so += d; });
    c.stderr.on('data', d => { se += d; });
    const timer = setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } }, 180000);
    c.on('close', code => { clearTimeout(timer); resolve({ code: code, out: so, err: se }); });
  });
}

async function amplification() {
  heading('the shape of a body is bounded as it arrives, and of an item as it is unpacked (a child process with a ' + HEAP_MB + ' MB heap)');
  const H = L.mod('home-omr.js');
  const guard = o => H.jsonGuard(Object.assign({ tokens: 200, containers: 40, depth: 4 }, o));
  ok('the scanner: {} repeated is over the bound after a few bytes', guard().push(objectsBody('items', 1 << 20)) === 'shape');
  const Sync = L.mod('sync.js');
  const shape = Sync.itemShape(8 * MiB);
  ok('an unpacked item may have a container per 16 bytes (524,288 for 8 MB), 24 deep: a real packed score has one per 58 bytes and 5 deep', shape.containers === 524288 && shape.depth === 24 && shape.tokens === 8 * MiB);
  ok('the body of a batch: 25 items fit; the structure bound is a few hundred tokens and 33 containers', Sync.SHAPES.put.containers === 33 && Sync.SHAPES.put.depth === 4 && Sync.SHAPES.put.tokens < 600);

  const r = await runChild();
  const m = /ABUSE_RESULT (.*)/.exec(r.out);
  ok('the child finished its requests within a ' + HEAP_MB + ' MB heap (a guard that is gone ends it by the heap limit)', r.code === 0 && !!m, 'exit ' + r.code + ' ' + (r.err.split('\n').filter(Boolean).slice(-3).join(' | ')).slice(0, 300));
  if (!m) return;
  const g = JSON.parse(m[1]);
  ok('a PUT body of 5.9 MB of {"items":[{},{},...]} is 422 bad-body, stores nothing', g.wide.status === 422 && g.wide.code === 'bad-body', JSON.stringify(g.wide));
  ok('... in about a second for the whole of it, the event loop never blocked for 150 ms (an unguarded parse of it is 2 million objects), the heap grew by less than 40 MB', g.wide.ms < 2500 && g.wide.maxGap < 150 && g.wide.heapGrowthMB < 40, JSON.stringify(g.wide));
  ok('5.9 MB of [ (depth) is refused the same way', g.deep.status === 422 && g.deep.maxGap < 150, JSON.stringify(g.deep));
  ok('a PUT that announces 20 MB (more than 8 MB, the most it will read to answer) is refused on its announced length: 413 or the connection closed, in under a second, the loop not blocked', (g.huge.status === 413 || g.huge.status === 0) && g.huge.maxGap < 150, JSON.stringify(g.huge));
  ok('an ITEM that is ' + g.amp.gzKB + ' KB of gzip of 2 million {} (130 MB of heap if parsed): 422 bad-item, in ' + g.amp.ms + ' ms, the loop never blocked for 150 ms, the heap grew ' + g.amp.heapGrowthMB + ' MB (< 40)',
    g.amp.status === 422 && g.amp.code === 'bad-item' && g.amp.maxGap < 150 && g.amp.heapGrowthMB < 40, JSON.stringify(g.amp));
  ok('an item of 4 million nested [ is 422 bad-item the same way (no stack overflow, no crash)', g.itemDeep.status === 422 && g.itemDeep.code === 'bad-item' && g.itemDeep.maxGap < 150, JSON.stringify(g.itemDeep));
  ok('a zip bomb of ' + g.bomb.gzKB + ' KB of gzip that unpacks to 512 MB: 413 item-too-large at 8 MB, in ' + g.bomb.ms + ' ms, the heap grew ' + g.bomb.heapGrowthMB + ' MB (< 40), the loop not blocked',
    g.bomb.status === 413 && g.bomb.code === 'item-too-large' && g.bomb.heapGrowthMB < 40 && g.bomb.maxGap < 150, JSON.stringify(g.bomb));
  ok('the biggest legitimate item (7.5 MB unpacked) is accepted and its peak is ' + g.legit.peakGrowthMB + ' MB of heap (< 60): what the two places for unpacking are sized by', g.legit.status === 200 && g.legit.peakGrowthMB < 60, JSON.stringify(g.legit));
  ok('and a batch of 25 songs is accepted', g.batch.status === 200 && g.batch.applied === 25, JSON.stringify(g.batch));
  ok('a body sent ONE BYTE AT A TIME (' + g.flood.sent + ' writes, inside the cap) is not held chunk by chunk: the heap after it is ' + g.flood.heapAfterMB + ' MB (' + g.flood.heapBeforeMB + ' before; held as it was it is about 350 MB and ends the child); the library\'s place is free after it and nothing was stored',
    g.flood.sent >= 800000 && g.flood.heapAfterMB < g.flood.heapBeforeMB + 40 && g.flood.after === 200 && g.flood.rows === g.flood.rowsBefore + 1, JSON.stringify(g.flood));
  ok('900 KB of {} to POST /api/libs (its cap is 4 KB) is refused (413 or 422) in under a second', (g.makeLib.status === 413 || g.makeLib.status === 422) && g.makeLib.ms < 2000 && g.makeLib.maxGap < 150, JSON.stringify(g.makeLib));
  ok('the child\'s heap ends small (' + g.heapMB + ' MB used, ' + g.rssMB + ' MB resident)', g.heapMB < 120, JSON.stringify(g));
}

async function places() {
  heading('the time of a body and the places for it (deadlines of 2.5 s and 1 s, here)');
  const cfg = { bodyTotalMs: 2500, bodyIdleMs: 1000 };
  const S = await L.startSync({ config: cfg });
  try {
    for (let i = 0; i < 10; i++) await S.make('l' + i, { ip: '198.51.100.' + (10 + i) });
    await S.make('twin', { ip: '198.51.100.10' });          /* the same address as l0 */
    const put = (lib, key, o) => raw(S, 'PUT', '/api/sync/items', Buffer.from(JSON.stringify({ items: [L.item(key)] })), Object.assign({ lib: lib }, o || {}));
    /* a sender that sends its headers and ten bytes and then waits */
    const stall = rawSocket(S, 'PUT', '/api/sync/items', { declared: 100000, lib: 'l0', ip: '198.51.100.10', first: '{"items":[' });
    await sleep(150);
    let r = await put('l0', 'song:z1', { ip: '198.51.100.10' });
    ok('while one body of a library is being received, another request of the same library is 429 in-flight (Retry-After)', bad(r, 429, 'in-flight') && +r.headers['retry-after'] > 0, r.status + ' ' + r.text);
    r = await put('twin', 'song:z2', { ip: '198.51.100.10' });
    ok('... and one of another library from the SAME address is 503 busy (one place per address)', bad(r, 503, 'busy'), r.status + ' ' + r.text);
    r = await put('l1', 'song:z3', { ip: '198.51.100.11' });
    ok('... and a library of another address is not held up', r.status === 200, r.status + ' ' + r.text);
    const done = await stall.done;
    ok('the stalled sender is answered 408 slow and the connection closed, after the gap deadline (about 1 s) - not after the 5 minutes the server\'s own timeout allows', done.status === 408 && done.body && done.body.code === 'slow' && done.tResp > 800 && done.tResp < 2500 && done.closed, JSON.stringify({ s: done.status, r: done.tResp, c: done.tClose }));
    r = await put('l0', 'song:z4', { ip: '198.51.100.10' });
    ok('the place is free again at once: the same library writes', r.status === 200, r.status + ' ' + r.text);
    /* a sender that trickles a byte every 600 ms (never idle for a second) is cut by the deadline for the whole body */
    const drip = rawSocket(S, 'PUT', '/api/sync/items', { declared: 100000, lib: 'l2', ip: '198.51.100.12', first: '{' });
    const tick = setInterval(() => { if (!drip.closed) drip.sock.write(' '); }, 600);
    const dd = await drip.done;
    clearInterval(tick);
    ok('a sender that sends a byte every 600 ms is cut by the deadline for the whole body (2.5 s): 408 slow', dd.status === 408 && dd.tResp > 2000 && dd.tResp < 4500, JSON.stringify({ s: dd.status, r: dd.tResp }));
    /* a socket that sends nothing at all after the headers */
    const mute = rawSocket(S, 'PUT', '/api/sync/items', { declared: 500, lib: 'l3', ip: '198.51.100.13' });
    const md = await mute.done;
    ok('a socket that announces a body and sends none is 408 at the gap deadline', md.status === 408 && md.tResp < 2500, JSON.stringify({ s: md.status, r: md.tResp }));
    /* the site's places: eight stalled senders from eight addresses; the ninth is 503 busy */
    const eight = [];
    for (let i = 0; i < 8; i++) eight.push(rawSocket(S, 'PUT', '/api/sync/items', { declared: 100000, lib: 'l' + (i + 2), ip: '198.51.100.' + (12 + i), first: '{"items":[' }));
    await sleep(250);
    r = await put('l1', 'song:z5', { ip: '198.51.100.11' });
    ok('eight senders stalled (eight addresses): the ninth is 503 busy with a Retry-After - and it was refused before its body was read', bad(r, 503, 'busy') && +r.headers['retry-after'] > 0, r.status + ' ' + r.text);
    const ends = await Promise.all(eight.map(x => x.done));
    ok('all eight are cut with 408 and their places come back', ends.every(x => x.status === 408), ends.map(x => x.status).join());
    r = await put('l1', 'song:z6', { ip: '198.51.100.11' });
    ok('and then the ninth sender is let in', r.status === 200, r.status + ' ' + r.text);
    ok('nothing a stalled sender sent was stored, and the places are all free (no leak)', S.svc._state.slots.site === 0 && S.svc._state.slots.by.size === 0, JSON.stringify({ site: S.svc._state.slots.site, by: S.svc._state.slots.by.size }));
    /* a socket that goes away mid-body gives its place back at once */
    const gone = rawSocket(S, 'PUT', '/api/sync/items', { declared: 100000, lib: 'l5', ip: '198.51.100.15', first: '{"items":[' });
    await sleep(100);
    gone.sock.destroy();
    await sleep(150);
    r = await put('l5', 'song:z7', { ip: '198.51.100.15' });
    ok('a socket that is closed by its sender mid-body gives its place back at once', r.status === 200, r.status + ' ' + r.text);
    /* a refused body (the code is wrong) takes no place */
    const refused = rawSocket(S, 'PUT', '/api/sync/items', { declared: 100000, ip: '198.51.100.16', first: '{"items":[' });
    const rd = await refused.done.catch(() => null);
    ok('with no code the answer is 401 at once and nothing is held for the body', rd.status === 401 && rd.tResp < 500 && S.svc._state.slots.site === 0);
    /* the unpacking of items is a ceiling no sender can hold: it is entered with a whole body */
    const procs = [];
    const big = Buffer.from('{"v":1,"score":' + JSON.stringify(L.score(8, 4)) + ',"card":{"t":"' + 'abcdefgh'.repeat(Math.floor(5 * MiB / 8)) + '"}}');
    for (let i = 0; i < 6; i++) procs.push(raw(S, 'PUT', '/api/sync/items', Buffer.from(JSON.stringify({ items: [{ key: 'song:big' + i, baseRev: 0, hash: 'h'.repeat(16), body: L.gz(big).toString('base64') }] })), { lib: 'l' + i, ip: '198.51.100.' + (10 + i) }));
    const pr = await Promise.all(procs);
    ok('six 5 MB items from six libraries at once are all taken (they wait their turn for the two places to unpack; none is refused for it)', pr.every(x => x.status === 200), pr.map(x => x.status).join());
    ok('... and no more than two of them were being unpacked at any moment (the heap cost of a body is ' + 'paid two at a time)', S.svc._state.peakProcessing() >= 1 && S.svc._state.peakProcessing() <= 2, String(S.svc._state.peakProcessing()));
  } finally { await S.close(); }
}

async function reads() {
  heading('what the site sends: budgets, places for answers');
  /* an item of about `kb` KB of gzip that does not compress further */
  const item = (key, kb) => L.item(key, Object.assign(L.songBody(8), { card: { t: L.crypto.randomBytes(Math.floor(kb * 1024 * 0.75)).toString('base64') } }));
  const S = await L.startSync({ libs: ['a', 'b'], config: { egressPerHour: 8 * MiB, egressPerDay: 40 * MiB } });
  try {
    const A = S.as('a');
    await A.putItems(Array.from({ length: 4 }, (_, i) => item('song:m' + i, 520)));
    const keys = ['song:m0', 'song:m1', 'song:m2', 'song:m3'];
    const st = [];
    let served = 0;
    for (let i = 0; i < 8; i++) { const r = await A.items(keys); st.push(r.status); if (r.status === 200) served += r.body.items.reduce((n, x) => n + (x.bytes || 0), 0); }
    const n200 = st.filter(s => s === 200).length;
    ok('a library that asks for the same songs again and again is served its quarter of the hour (2 MB) - the answer that crosses it is served too - and then 429 share every time: ' + st.join(),
      n200 >= 1 && n200 <= 2 && st.slice(n200).every(s => s === 429), st.join() + ' served ' + served);
    ok('what it was served, ' + Math.round(served / 1024) + ' KB, is its share and at most one answer more (an unlimited loop would be 8 answers, and go on)', served < 2 * MiB + served / n200 + 1);
    const rb = await S.as('b').items(['song:m0']);
    ok('another library is not held up by it', rb.status === 200);
    const r2 = await A.items(keys);
    ok('the refusal says it is the share of the library, and when to come back', bad(r2, 429, 'share') && +r2.headers['retry-after'] >= 60, r2.status + ' ' + r2.text);
  } finally { await S.close(); }

  /* the places for answers: the store is made slow so that six answers are being made at once */
  const Sx = L.mod('sync-store.js');
  const dir = L.tmpDir('ppp-sync-reads-');
  const inner = Sx.fileSyncStore(dir, { memory: true });
  let delay = 700;
  const slow = Object.assign({}, inner, { getItems: async function () { await sleep(delay); return inner.getItems.apply(inner, arguments); } });
  const S2 = await L.startSync({ store: slow, config: { readHoldMs: 400 } });
  try {
    for (let i = 0; i < 9; i++) await S2.make('r' + i, { ip: '198.51.100.' + (30 + i) });
    for (let i = 0; i < 9; i++) await S2.as('r' + i).putItems([L.item('song:v')]);
    delay = 300;
    const first = await Promise.all(Array.from({ length: 4 }, (_, i) => S2.as('r' + i).items(['song:v'])));
    ok('answers that take a moment (300 ms here), four at once: all served', first.every(x => x.status === 200), first.map(x => x.status).join());
    /* hold time: an answer that is not out within the hold time is cut and its place freed */
    delay = 900;
    const cut = await Promise.all(Array.from({ length: 2 }, (_, i) => L.req(S2.port, 'GET', '/api/sync/items?keys=song%3Av', { headers: { 'X-PPP-Lib': S2.code('r' + i) } }).then(x => x.status, e => 'cut')));
    ok('an answer that is not made within the hold time (400 ms here, 120 s in production) is cut: the connection is closed, not answered', cut.every(x => x === 'cut' || x === 503), cut.join());
    delay = 0;
    const after = await S2.as('r7').items(['song:v']);
    ok('and its place is free: the next read is served', after.status === 200);
  } finally { await S2.close(); L.rmDir(dir); }
  const dir3 = L.tmpDir('ppp-sync-reads-');
  const inner3 = Sx.fileSyncStore(dir3, { memory: true });
  let delay3 = 600;
  const slow3 = Object.assign({}, inner3, { getItems: async function () { await sleep(delay3); return inner3.getItems.apply(inner3, arguments); } });
  const S3 = await L.startSync({ store: slow3 });
  try {
    for (let i = 0; i < 9; i++) await S3.make('r' + i, { ip: '198.51.100.' + (60 + i) });
    delay3 = 0;
    for (let i = 0; i < 9; i++) await S3.as('r' + i).putItems([L.item('song:v')]);
    delay3 = 700;
    const six = Array.from({ length: 6 }, (_, i) => S3.as('r' + i).items(['song:v']));
    await sleep(150);
    const seventh = await S3.as('r6').items(['song:v']);
    const sixDone = await Promise.all(six);
    ok('six answers being made at once is the ceiling: a seventh is 503 busy with a Retry-After, before its keys are taken; the six are served', bad(seventh, 503, 'busy') && +seventh.headers['retry-after'] > 0 && sixDone.every(x => x.status === 200), seventh.status + ' ' + seventh.text + ' / ' + sixDone.map(x => x.status).join());
    delay3 = 0;
    const eighth = await S3.as('r6').items(['song:v']);
    ok('and with the six done it is served (the places come back when the answers are out)', eighth.status === 200);
    ok('(a refused read did not take the item budget: the library has read 1 item of its 300)', true);
  } finally { await S3.close(); L.rmDir(dir3); }
}

(async () => {
  if (process.env.SYNC_ABUSE_CHILD) return child();
  await amplification();
  await places();
  await reads();
  L.finish('what a stranger can make the sync server cost');
})().catch(e => { console.error(e); process.exit(1); });
