/* G13-7b (U5, G13-D11): the anonymous counters the page's browsers send - what the server accepts, what it keeps, and what the hourly `stats:` line shows (client-stats.js, server-stats.js,
   POST /api/stats in server.js).

     node tests/client-stats.test.js            the whitelist and the line on fake data, then the real server.js on a free port
     node tests/client-stats.test.js --unit     only the first part (the mutation runner, tests/release/mutants.js, runs this one)

   PPP_CLIENT_STATS_MODULE / PPP_STATS_MODULE: the modules under test (default: the repository's client-stats.js and server-stats.js); the mutation runner points them at copies with one rule broken.

   Part 1: sanitize() takes only the whitelisted keys of the right kind; a number that is not a whole number is dropped and a big one is capped; a code it has no name for is `other`; a body that is not
   an object, or is another version, is refused; prototype keys do nothing; add()/snapshot() add up, in fixed keys; the line gets a `client` key only when a beacon arrived, holds numbers only, and the
   counters start again after it.
   Part 2, the real server: a beacon is answered 204 with no body and no cookie; a bad body is 400, a big one 413, another site's Origin 403, the 61st from one address in ten minutes 429 (here the
   limit is made 5), GET is still a 404; a stale build is counted as stale; the numbers are in the hourly line, and nothing of the request (address, cookie, an unknown key's value) is. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const MODULE = process.env.PPP_CLIENT_STATS_MODULE ? path.resolve(process.env.PPP_CLIENT_STATS_MODULE) : path.join(REPO, 'client-stats.js');
const CS = require(MODULE);
/* PPP_STATS_MODULE: server-stats.js with one rule broken (the mutation runner); it finds client-stats.js beside it */
const { createStats } = require(process.env.PPP_STATS_MODULE ? path.resolve(process.env.PPP_STATS_MODULE) : path.join(REPO, 'server-stats.js'));
const UNIT_ONLY = process.argv.includes('--unit');

let failed = 0, passed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' - ' + detail : ''));
  if (cond) passed++; else failed++;
};
const heading = t => console.log('\n-- ' + t + ' --');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;

function unitPart() {
  heading('sanitize: only what is whitelisted, of the right kind');
  {
    const r = CS.sanitize({ v: 1, b: 'fab0ba3', loc: 'ko', mob: 1, pv: 1, fcp: 1, rdy: 2, err: { type: 2, other: 1 }, rej: 1, eng: { PLAN_THREW: 3 }, prc: { NOT_READY: 4 }, lz: 1 });
    ok('a full beacon comes through as it is', r.ok && J(r.doc) === J({ v: 1, b: 'fab0ba3', loc: 'ko', mob: 1, pv: 1, fcp: 1, rdy: 2, err: { type: 2, other: 1 }, rej: 1, eng: { PLAN_THREW: 3 }, prc: { NOT_READY: 4 }, lz: 1 }), r.ok && J(r.doc));
  }
  {
    const r = CS.sanitize({ v: 1, user: 'alice@example.com', url: 'https://x/y', ua: 'Mozilla', stack: 'at foo (x.js:1)', message: 'secret text', id: 'abc', err: { type: 1, 'at a.js:3': 5, message: 9 }, loc: 'fr', b: '<script>', ip: '1.2.3.4' });
    const s = J(r.doc);
    ok('unknown keys are dropped, and no text of the beacon survives', r.ok && !/alice|example|Mozilla|stack|secret|abc|a\.js|fr|script|1\.2\.3\.4/.test(s.replace(/"v":1/, '')), s);
    ok('an unknown error class is counted as `other`, nothing else of it', r.ok && r.doc.err && r.doc.err.type === 1 && r.doc.err.other === 14 && Object.keys(r.doc.err).sort().join() === 'other,type', J(r.doc.err));
  }
  {
    /* G13-8: the optional libraries PPP could not serve itself (PPP.libFallbacks): the four names the page has, anything else is `other`, capped like every count */
    const r = CS.sanitize({ v: 1, lib: { pdfjs: 2, 'tfjs-2.8.6': 1, 'basic-pitch': 999, 'something-new': 4, 'magenta-music': 0 } });
    ok('lib: the known library names are kept (capped), another is `other`, a zero is nothing', r.ok && J(r.doc.lib) === J({ pdfjs: 2, 'tfjs-2.8.6': 1, 'basic-pitch': 50, other: 4 }), J(r.doc));
    ok('lib is dropped when it is not an object', CS.sanitize({ v: 1, lib: [1, 2] }).doc.lib === undefined && CS.sanitize({ v: 1, lib: 'pdfjs' }).doc.lib === undefined);
  }
  {
    const r = CS.sanitize({ v: 1, err: { thirdparty: 3, load: 1 } });
    ok('`thirdparty` is a class of error of its own (another site\'s file that did not load)', r.ok && J(r.doc.err) === J({ thirdparty: 3, load: 1 }), J(r.doc));
  }
  {
    const r = CS.sanitize({ v: 1, rej: 9999, lz: 51, err: { type: 1e9, load: 7.5, syntax: -3, range: '4', reference: null, other: true } });
    ok('a number over the cap is the cap (50)', r.ok && r.doc.rej === 50 && r.doc.lz === 50 && r.doc.err.type === 50, J(r.doc));
    ok('a number that is not a whole number, is negative, or is not a number is dropped', r.ok && J(Object.keys(r.doc.err)) === J(['type']), J(r.doc.err));
  }
  {
    const r = CS.sanitize({ v: 1, pv: 1, fcp: 5, rdy: -1, mob: 2, loc: 'xx' });
    ok('a bucket outside 0..4, a mobile flag that is not 0 or 1 and a locale that is not ko/ja/zh/en are dropped', r.ok && J(r.doc) === J({ v: 1, pv: 1 }), J(r.doc));
    const q = CS.sanitize({ v: 1, pv: 0, fcp: 1, rdy: 1, loc: 'ko', mob: 1 });
    ok('the timing of a beacon that is not the first of a page is not taken (pv is 1 or nothing)', q.ok && q.doc.fcp === undefined && q.doc.rdy === undefined && q.doc.pv === undefined, J(q.doc));
  }
  {
    const long = {}; long['x'.repeat(500)] = 1;
    const r = CS.sanitize({ v: 1, eng: Object.assign({ SOURCE_NONE: 1, 'WHATEVER_IT_IS': 2 }, long), prc: { NOT_READY: 2, BOGUS: 5, LINK_FAILED: 1 } });
    ok('engraver and practice codes: the known ones by name, the others together as `other`', r.ok && J(r.doc.eng) === J({ SOURCE_NONE: 1, other: 3 }) && r.doc.prc.NOT_READY === 2 && r.doc.prc.LINK_FAILED === 1 && r.doc.prc.other === 5, J(r.doc));
  }
  {
    const many = {};
    for (let i = 0; i < 200; i++) many['CODE_' + i] = 50;
    const r = CS.sanitize({ v: 1, eng: many });
    ok('a map of hundreds of unknown codes is read for a few dozen at most and its `other` is capped', r.ok && r.doc.eng.other === 50 && Object.keys(r.doc.eng).length === 1, J(r.doc));
  }
  {
    const evil = JSON.parse('{"v":1,"err":{"__proto__":{"polluted":1},"constructor":3,"toString":2},"eng":{"__proto__":4},"__proto__":{"admin":true}}');
    const r = CS.sanitize(evil);
    ok('prototype keys do nothing: no pollution, and an own key named so is only an unknown code', r.ok && ({}).polluted === undefined && ({}).admin === undefined && Object.getPrototypeOf(r.doc) === Object.prototype && (r.doc.err === undefined || r.doc.err.other >= 2), J(r.doc));
  }
  {
    const r = CS.sanitize({ v: 1, err: [5, 5], eng: [1], prc: 'NOT_READY', rej: [3], lz: { a: 1 } });
    ok('an array, a string or an object where a map or a number should be is not read (the beacon is still one, with nothing in it)', r.ok && J(r.doc) === '{"v":1}', J(r.doc));
  }
  {
    const bads = [null, undefined, 5, 'x', [], [1], true, {}, { v: 2 }, { v: '1' }, { v: 1.5 }, { pv: 1 }];
    ok('a body that is not an object of version 1 is refused', bads.every(b => CS.sanitize(b).ok === false), bads.map(b => J(b)).join(' '));
    ok('{"v":1} alone is a beacon with nothing in it', CS.sanitize({ v: 1 }).ok === true && J(CS.sanitize({ v: 1 }).doc) === '{"v":1}');
  }

  heading('add and snapshot: fixed keys, totals, numbers');
  {
    const agg = CS.fresh();
    const docs = [
      { v: 1, pv: 1, mob: 1, loc: 'ko', fcp: 0, rdy: 1 },
      { v: 1, pv: 1, mob: 0, loc: 'en', fcp: 3, rdy: 4, err: { type: 2 }, eng: { PLAN_THREW: 1 } },
      { v: 1, err: { load: 1, other: 1 }, rej: 2, lz: 1, prc: { NOT_READY: 3 } },
      { v: 1, pv: 1, mob: 1, loc: 'ja', fcp: 2, rdy: 2 }
    ];
    docs.forEach((d, i) => CS.add(agg, d, i === 3));
    const s = CS.snapshot(agg);
    ok('beacons 4, visits 3, stale 1, mobile 2, desktop 1, withErrors 2', s.beacons === 4 && s.visits === 3 && s.stale === 1 && s.mobile === 2 && s.desktop === 1 && s.withErrors === 2, J(s));
    ok('locale ko 1 ja 1 zh 0 en 1; fcp lt2 1 lt8 1 ge8 1; ready lt4 1 lt8 1 none 1', J(s.locale) === J({ ko: 1, ja: 1, zh: 0, en: 1 }) && s.fcp.lt2 === 1 && s.fcp.lt8 === 1 && s.fcp.ge8 === 1 && s.fcp.lt4 === 0 && s.ready.lt4 === 1 && s.ready.lt8 === 1 && s.ready.none === 1, J([s.locale, s.fcp, s.ready]));
    ok('errors type 2 load 1 other 1; rejections 2; lazyFailed 1; engrave PLAN_THREW 1 only; practice NOT_READY 3 only', J(s.errors) === J({ type: 2, reference: 0, range: 0, syntax: 0, load: 1, thirdparty: 0, other: 1 }) && s.rejections === 2 && s.lazyFailed === 1 && J(s.engrave) === J({ PLAN_THREW: 1 }) && J(s.practice) === J({ NOT_READY: 3 }), J(s));
    const keys = o => Object.keys(o).sort().join();
    ok('the keys of a snapshot are fixed whatever came', keys(CS.snapshot(CS.fresh())) === keys(s) || keys(CS.snapshot(CS.fresh())) === 'beacons,desktop,engrave,errors,fcp,lazyFailed,libFallbacks,locale,mobile,practice,ready,rejections,stale,visits,withErrors', keys(s));
    const nums = []; (function walk(x) { if (x && typeof x === 'object') Object.values(x).forEach(walk); else nums.push(x); })(s);
    ok('every value of it is a whole number', nums.length >= 30 && nums.every(n => Number.isInteger(n) && n >= 0), String(nums.length));
  }

  heading('the hourly line');
  {
    const lines = [];
    let t = 1000000;
    const stats = createStats({ log: l => lines.push(l), sigterm: false, now: () => t });
    ok('with no beacon and no request there is nothing to print', stats.flush() === null);
    stats.clientBeacon(CS.sanitize({ v: 1, pv: 1, mob: 1, loc: 'ko', fcp: 1, rdy: 1, err: { type: 1 } }).doc, false);
    stats.clientBeacon(CS.sanitize({ v: 1, pv: 1, mob: 0, loc: 'zh', fcp: 2, rdy: 2, eng: { LINK_FAILED: 2 } }).doc, true);
    t += 61 * 60 * 1000;
    const line = stats.flush();
    const d = line && JSON.parse(line.replace(/^stats: /, ''));
    ok('beacons alone are a window worth a line, with a `client` key', !!d && d.client && d.client.beacons === 2 && d.requests === 0, String(line).slice(0, 120));
    ok('the server\'s own keys are the ones they were (v, windowS, upS, requests, 4xx, tooMany, 5xx, storeErrors, idlePoolErrors, by) plus client', d && Object.keys(d).sort().join() === '4xx,5xx,by,client,idlePoolErrors,requests,storeErrors,tooMany,upS,v,windowS', d && Object.keys(d).sort().join());
    const strings = []; (function walk(x) { if (x && typeof x === 'object') Object.values(x).forEach(walk); else if (typeof x === 'string') strings.push(x); })(d);
    ok('there is no string value in it, and no number is fractional or negative', strings.length === 0 && !/\d\.\d|-\d/.test(line));
    ok('the counters start again: the next window has no client key, and prints nothing when nothing came', stats.flush() === null);
    stats.clientBeacon(CS.sanitize({ v: 1, pv: 1, loc: 'en' }).doc, false);
    t += 1000;
    ok('and another beacon after it is a window of its own', (x => x && JSON.parse(x.replace(/^stats: /, '')).client.beacons === 1)(stats.flush()));
    const s2 = createStats({ log: () => {}, sigterm: false });
    s2.clientBeacon(null, false);
    s2.clientBeacon(undefined, true);
    ok('a document that is not one does not throw (counting never touches a request)', true);
  }
}

/* ---- part 2: the real server.js ---- */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function call(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({ agent: false }, {});
    const hdrs = Object.assign({}, headers || {});
    if (body !== undefined && body !== null) hdrs['Content-Length'] = Buffer.byteLength(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: hdrs, agent: false }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== undefined && body !== null) r.write(body);
    r.end();
  });
}
async function startServer(env) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-cstats-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, SESSION_SECRET: 'cstats-test-secret', PPP_HELPER: '', DATABASE_URL: '' }, env || {})
  });
  const srv = { port, child, out: '', exited: false };
  child.stdout.on('data', d => { srv.out += d; });
  child.stderr.on('data', d => { srv.out += d; });
  child.on('exit', () => { srv.exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (srv.exited) throw new Error('server.js exited early: ' + srv.out.slice(0, 300));
    if (srv.out.includes('PPP listening')) break;
    if (Date.now() - t0 > 30000) { child.kill(); throw new Error('server.js did not come up'); }
    await sleep(50);
  }
  await sleep(150);
  srv.statsLines = () => srv.out.split(/\r?\n/).filter(l => l.startsWith('stats: '));
  srv.clientTotals = () => {
    const t = { beacons: 0, visits: 0, stale: 0, mobile: 0, desktop: 0, withErrors: 0, rejections: 0, lazyFailed: 0, errors: {}, engrave: {}, practice: {}, locale: {}, fcp: {}, ready: {}, requests: 0, stats: { requests: 0, '4xx': 0, tooMany: 0, '5xx': 0 }, tooMany: 0, fourxx: 0 };
    srv.statsLines().map(l => JSON.parse(l.slice(7))).forEach(d => {
      t.requests += d.requests; t.tooMany += d.tooMany; t.fourxx += d['4xx'];
      Object.keys(t.stats).forEach(k => { t.stats[k] += d.by['api-stats'][k]; });
      const c = d.client;
      if (!c) return;
      ['beacons', 'visits', 'stale', 'mobile', 'desktop', 'withErrors', 'rejections', 'lazyFailed'].forEach(k => { t[k] += c[k]; });
      ['errors', 'engrave', 'practice', 'locale', 'fcp', 'ready'].forEach(g => Object.keys(c[g]).forEach(k => { t[g][k] = (t[g][k] || 0) + c[g][k]; }));
    });
    return t;
  };
  srv.close = () => new Promise(res => { if (srv.exited) return res(); child.on('exit', () => res()); child.kill(); });
  return srv;
}

async function serverPart() {
  heading('the real server.js: POST /api/stats');
  const srv = await startServer({ PPP_STATS_INTERVAL_MS: '900', PPP_BUILD: 'abc1234', PPP_STATS_BEACONS: '5' });
  try {
    const same = { Origin: 'http://127.0.0.1:' + srv.port };
    const beacon = (o, headers) => call(srv.port, 'POST', '/api/stats', typeof o === 'string' ? o : J(o), Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, headers || {}));

    const a = await beacon({ v: 1, b: 'abc1234', loc: 'ko', mob: 1, pv: 1, fcp: 1, rdy: 1, err: { type: 2 }, eng: { PLAN_THREW: 1 } }, Object.assign({ Cookie: 'ppp_session=SESSIONCOOKIE; ppp_locale=ko-KR' }, same));
    ok('a beacon is answered 204 with no body', a.status === 204 && a.text === '', a.status + ' ' + a.text.slice(0, 40));
    ok('and no cookie is set, nothing is cached, and nosniff is there', !a.headers['set-cookie'] && a.headers['cache-control'] === 'no-store' && a.headers['x-content-type-options'] === 'nosniff', J(a.headers));
    const b = await beacon({ v: 1, b: 'deadbee', loc: 'en', mob: 0, pv: 1, fcp: 3, rdy: 4, rej: 1, lz: 2, prc: { NOT_READY: 1 }, secret: 'SECRETVALUE', user: 'someone@example.com' });
    ok('a beacon with unknown keys is still accepted (they are dropped, not an error)', b.status === 204, String(b.status));
    ok('the contents of the answers are the same shape whether the build is stale or not: 204', b.status === a.status);

    ok('GET /api/stats is still a 404, and no route serves the numbers', (await call(srv.port, 'GET', '/api/stats')).status === 404 && (await call(srv.port, 'GET', '/stats')).status === 404);
    ok('PUT /api/stats is not a way in either (404)', (await call(srv.port, 'PUT', '/api/stats', '{"v":1}')).status === 404);

    const bad = {
      'not json': await beacon('not json'),
      'an array': await beacon('[1,2]'),
      'null': await beacon('null'),
      'another version': await beacon('{"v":2}'),
      'empty': await beacon('')
    };
    ok('bad bodies are 400: not JSON, an array, null, another version, an empty body', Object.values(bad).every(r => r.status === 400), Object.keys(bad).map(k => k + ' ' + bad[k].status).join(', '));
    const big = await beacon(J({ v: 1, err: { type: 1 }, pad: 'x'.repeat(3000) }));
    ok('a body over 1 KB is 413 and is not counted', big.status === 413, String(big.status));
    const deep = await beacon('{"v":1,"err":{"a":{"b":{"c":{"d":1}}}}}');
    ok('a body that is nested deeper than the beacon ever is is refused before it is parsed (400/413)', deep.status === 400 || deep.status === 413, String(deep.status));
    const other = await beacon({ v: 1, pv: 1, loc: 'ja' }, { Origin: 'https://evil.example' });
    ok('another site\'s Origin is refused: 403 (and not counted)', other.status === 403, String(other.status));
    const nul = await beacon({ v: 1, pv: 1, loc: 'ja' }, { Origin: 'null' });
    ok('an Origin of "null" (a sandboxed frame) is refused too', nul.status === 403, String(nul.status));

    /* the limit is 5 an address in ten minutes (PPP_STATS_BEACONS): the proxy header makes this a "remote" address, the machine itself is not limited */
    const xff = { 'X-Forwarded-For': '203.0.113.9' };
    const rs = [];
    for (let i = 0; i < 7; i++) rs.push((await beacon({ v: 1, pv: 1, loc: 'zh', mob: 0, fcp: 0, rdy: 0 }, xff)).status);
    ok('from one address: 5 are 204 and the 6th and 7th are 429 (and the next, below, too)', rs.slice(0, 5).every(s => s === 204) && rs[5] === 429 && rs[6] === 429, rs.join());
    const lim = await beacon({ v: 1 }, xff);
    ok('the 429 says how long to wait and sets no cookie', lim.status === 429 && lim.headers['retry-after'] === '600' && !lim.headers['set-cookie'], J(lim.headers));
    const other2 = await beacon({ v: 1, pv: 1, loc: 'zh', mob: 0, fcp: 0, rdy: 0 }, { 'X-Forwarded-For': '203.0.113.10' });
    ok('another address is not affected', other2.status === 204, String(other2.status));

    /* wait for the interval to print what was counted (the windows may split it across lines: add them up) */
    const t0 = Date.now();
    while (srv.clientTotals().beacons < 8 && Date.now() - t0 < 10000) await sleep(100);
    await sleep(1100);                                   /* one more interval: a line that is late would show as more than 8 */
    const t = srv.clientTotals();
    ok('exactly 8 beacons were counted: the two unlimited, five of the limited address (its 6th, 7th and 8th were refused) and the other address', t.beacons === 8, J(t));
    const lines = srv.statsLines();
    ok('one beacon carried the stale build (deadbee) and the others did not', t.stale === 1, String(t.stale));
    ok('every one was the first of a page: visits 8, mobile 1, desktop 7', t.visits === 8 && t.mobile === 1 && t.desktop === 7, J([t.visits, t.mobile, t.desktop]));
    ok('the numbers of the first two are in: type errors 2, a rejection, 2 lazy failures, PLAN_THREW 1, NOT_READY 1, and 2 beacons with an error', t.errors.type === 2 && t.rejections === 1 && t.lazyFailed === 2 && t.engrave.PLAN_THREW === 1 && t.practice.NOT_READY === 1 && t.withErrors === 2, J(t));
    ok('and the language of the beacons: ko 1, en 1, zh 6', t.locale.ko === 1 && t.locale.en === 1 && t.locale.zh === 6, J(t.locale));
    ok('the timing: first paint lt4 1 (a), ge8 1 (b), lt2 6; ready lt4 1, none 1, lt2 6', t.fcp.lt4 === 1 && t.fcp.ge8 === 1 && t.fcp.lt2 === 6 && t.ready.lt4 === 1 && t.ready.none === 1 && t.ready.lt2 === 6, J([t.fcp, t.ready]));
    ok('the requests of the route are in its own class, api-stats: 22 with the GET and the PUT (and the GET of /stats is a static 404, the 23rd request)', t.stats.requests === 22 && t.requests === 23, J([t.stats, t.requests]));
    ok('its refusals - 5 x 400, 413, 400 (deep), 2 x 403, 3 x 429, GET and PUT 404 = 14, 3 of them 429 - are counted there, and are NOT in the totals 4xx and tooMany (the release alarms): only the 404 of /stats is', t.stats['4xx'] === 14 && t.stats.tooMany === 3 && t.fourxx === 1 && t.tooMany === 0 && t.stats['5xx'] === 0, J([t.stats, t.fourxx, t.tooMany]));
    const text = lines.join('\n');
    ok('no address, cookie, key value or text of the requests is in the lines', !/127\.0\.0\.1|203\.0\.113|SESSIONCOOKIE|ppp_session|SECRETVALUE|someone|example|evil|deadbee|abc1234|cstats-test-secret/.test(text), lines[0] && lines[0].slice(0, 200));
    ok('every line is the strict shape: numbers and names, nothing else', lines.length >= 1 && lines.every(l => /^stats: \{[\w",:{}-]+\}$/.test(l)) && !/"[^"]*":"/.test(text), lines[0] && lines[0].slice(0, 120));
    ok('the client key is there only in lines that had a beacon, and lines are at the interval, not per request', lines.length <= 8, lines.length + ' lines');
    ok('the boot lines of the server are the ones of today (nothing new at start)', srv.out.split(/\r?\n/).filter(l => l && !l.startsWith('stats: ')).every(l => /^(PPP listening|Home-PC worker queue|Guest links|Seeded shared score|Local helper)/.test(l)), srv.out.split(/\r?\n/).filter(l => l && !l.startsWith('stats: ')).join(' | ').slice(0, 300));
  } finally { await srv.close(); }

  heading('the machine itself is not limited (a developer\'s server, the browser suites)');
  const srv2 = await startServer({ PPP_STATS_INTERVAL_MS: '900', PPP_STATS_BEACONS: '2' });
  try {
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push((await call(srv2.port, 'POST', '/api/stats', '{"v":1}')).status);
    ok('six beacons from loopback with a limit of two: all 204', rs.every(s => s === 204), rs.join());
  } finally { await srv2.close(); }

  heading('the default limit is 300 beacons an address in ten minutes (a classroom behind one address)');
  const srv3 = await startServer({ PPP_STATS_INTERVAL_MS: '900' });
  try {
    const xff = { 'X-Forwarded-For': '203.0.113.77' };
    const rs = [];
    for (let i = 0; i < 305; i++) rs.push((await call(srv3.port, 'POST', '/api/stats', '{"v":1}', xff)).status);
    ok('305 from one remote address: the first 300 are 204, the next 5 are 429', rs.slice(0, 300).every(s => s === 204) && rs.slice(300).every(s => s === 429), [rs.filter(s => s === 204).length, rs.filter(s => s === 429).length].join('/'));
  } finally { await srv3.close(); }
}

(async () => {
  unitPart();
  if (!UNIT_ONLY) await serverPart();
  if (failed) { console.error('\n' + failed + ' failed (' + passed + ' passed): client-stats'); process.exit(1); }
  console.log('\n' + passed + ' passed: client-stats');
})().catch(e => { console.error('client-stats test crashed:', e && e.stack || e); process.exit(2); });
