/* G13-7a (G13-D11): the server's counters and its one log line an hour (server-stats.js).

     node tests/server-stats.test.js            the counters on fake requests, then the real server.js on a free port
     node tests/server-stats.test.js --unit     only the first part (the mutation runner, tests/release/mutants.js, runs this one)

   PPP_STATS_MODULE: the module under test (default: the repository's server-stats.js); the mutation runner points it at a copy with one rule broken.

   Part 1, on fake requests: the route classes; a 5xx (and a 4xx, and a 429 apart) is counted when the answer is sent (not before, not for an aborted request); an idle
   pool error is its own number; a store error is counted for the
   request it happened in and for `other` outside one; the line is only numbers (no address, id, path, header); a window with nothing prints nothing and the
   counters start again after a line; the hourly timer and the SIGTERM line (a child process) - the timer must not keep a process alive.
   Part 2, the real server: a 503 planted through /helper (a production host without the helper answers 503 there) is in the line; the line holds no address;
   no route serves the numbers; booting prints no `stats:` line; and (not on Windows, which has no SIGTERM to catch) the stop signal prints the last line and then stops. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const MODULE = process.env.PPP_STATS_MODULE ? path.resolve(process.env.PPP_STATS_MODULE) : path.join(REPO, 'server-stats.js');
const { createStats, classify } = require(MODULE);
const UNIT_ONLY = process.argv.includes('--unit');

let failed = 0, passed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' - ' + detail : ''));
  if (cond) passed++; else failed++;
};
const heading = t => console.log('\n-- ' + t + ' --');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const later = fn => new Promise((resolve, reject) => setImmediate(() => { Promise.resolve().then(fn).then(resolve, reject); }));   /* a fresh async context */

/* a request/response pair as http gives them to a listener */
function pair(url, headers) {
  const req = new EventEmitter(); req.url = url; req.headers = headers || {};
  const res = new EventEmitter(); res.statusCode = 200;
  res.answer = status => { res.statusCode = status; res.emit('finish'); res.emit('close'); };
  return { req, res };
}
const rig = opts => {
  const lines = [];
  let t = 1000000;
  const stats = createStats(Object.assign({ log: l => lines.push(l), sigterm: false, now: () => t }, opts || {}));
  return { stats, lines, tick: ms => { t += ms; } };
};
const parse = line => JSON.parse(String(line).replace(/^stats: /, ''));

async function unitPart() {
  heading('the route classes');
  const table = {
    '/': 'static', '/index.html': 'static', '/Piano%20Coach%20App.dc.html': 'static', '/engrave/page.js?h=abc': 'static', '/nothing-here': 'static',
    '/health': 'health', '/api/health': 'health', '/health?x=1': 'health',
    '/api/auth/me': 'api-auth', '/api/auth/login': 'api-auth',
    '/api/shares': 'api-shares', '/api/shares?mine=1': 'api-shares', '/api/shares/abc123': 'api-shares',
    '/api/jobs': 'api-jobs', '/api/jobs/42': 'api-jobs', '/api/worker/claim': 'api-jobs', '/api/pc-links': 'api-jobs', '/api/pc-links/me/worker-token': 'api-jobs',
    '/api/youtube-title?url=x': 'other', '/api/audio': 'other', '/api': 'other', '/helper/health': 'other', '/helper': 'other',
    '/api/sharesx': 'other', '/api/jobsx': 'other', '/api/authx': 'other'
  };
  const wrong = Object.keys(table).filter(u => classify(u) !== table[u]).map(u => u + ' -> ' + classify(u) + ' (wanted ' + table[u] + ')');
  ok('every address falls in the class the table gives it', wrong.length === 0, wrong.join('; '));
  ok('an address that cannot be read is `other`, never a throw', classify('http://[bad') === 'other' && classify(undefined) !== undefined);

  heading('counting');
  {
    const { stats, lines } = rig();
    const answers = [['/', 200], ['/x.js', 404], ['/health', 200], ['/api/shares', 500], ['/api/shares', 200], ['/api/jobs', 401], ['/helper/a', 503], ['/api/auth/me', 200], ['/', 502], ['/api/auth/signup', 429], ['/api/auth/login', 429], ['/x.css', 404], ['/', 399], ['/', 599]];
    answers.forEach(([u, s]) => { const p = pair(u); stats.track(p.req, p.res); p.res.answer(s); });
    const line = stats.flush();
    const d = line && parse(line);
    ok('one line for the window, starting `stats: `', !!line && lines.length === 1 && lines[0] === line && line.startsWith('stats: '), String(line).slice(0, 80));
    ok('the totals: 14 requests; 5xx 4 (500, 502, 503, 599); 4xx 5 (404, 401, 429, 429, 404; 399 is not one); 429 2; no store error, no idle pool error',
      d && d.requests === 14 && d['5xx'] === 4 && d['4xx'] === 5 && d.tooMany === 2 && d.storeErrors === 0 && d.idlePoolErrors === 0, JSON.stringify(d && [d.requests, d['5xx'], d['4xx'], d.tooMany, d.storeErrors, d.idlePoolErrors]));
    ok('by class (requests/4xx/429/5xx): static 6/2/0/2, api-shares 2/0/0/1, other 1/0/0/1, health 1/0/0/0, api-jobs 1/1/0/0, api-auth 3/2/2/0',
      d && ['static:6:2:0:2', 'api-shares:2:0:0:1', 'other:1:0:0:1', 'health:1:0:0:0', 'api-jobs:1:1:0:0', 'api-auth:3:2:2:0'].every(x => { const [k, r, f4, f429, f5] = x.split(':'); return d.by[k].requests === +r && d.by[k]['4xx'] === +f4 && d.by[k].tooMany === +f429 && d.by[k]['5xx'] === +f5; }),
      JSON.stringify(d && d.by));
    ok('the 4xx, 429 and 5xx of the classes add up to the totals', d && ['4xx', 'tooMany'].every(k => Object.keys(d.by).reduce((n, c) => n + d.by[c][k], 0) === d[k]));
    ok('the 5xx of the classes add up to the total', d && Object.keys(d.by).reduce((n, k) => n + d.by[k]['5xx'], 0) === d['5xx']);
    ok('a second flush right after has nothing to say: no line, and nothing logged', stats.flush() === null && lines.length === 1);
  }
  {
    const { stats } = rig();
    const p = pair('/api/shares'); stats.track(p.req, p.res);
    ok('a 5xx is counted when the answer is sent, not when the request arrives', parse(stats.flush()).by['api-shares']['5xx'] === 0);
    const q = pair('/api/shares'); stats.track(q.req, q.res); q.res.statusCode = 500; q.res.emit('close');
    ok('a request whose connection closed without an answer is counted as a request and not as a 5xx', (d => d.requests === 1 && d['5xx'] === 0)(parse(stats.flush())));
    const r = pair('/api/shares'); stats.track(r.req, r.res); r.res.answer(499 + 1);
    ok('500 itself is a 5xx; 499 is not', parse(stats.flush())['5xx'] === 1);
    const w = pair('/'); stats.track(w.req, w.res); w.res.answer(499);
    ok('499 is not', parse(stats.flush())['5xx'] === 0);
  }
  {
    const { stats } = rig();
    stats.track(null, null);
    stats.track({}, {});
    ok('a request object that is not one does not throw (counting never touches a request)', true);
  }

  heading('store errors: counted for the request they happened in');
  {
    const { stats } = rig();
    await later(async () => {
      const p = pair('/api/shares'); stats.track(p.req, p.res);
      await sleep(5); stats.storeError();                       /* after an await, as the real store errors are */
      await Promise.resolve(); stats.storeError();
      p.res.answer(500);
    });
    await later(async () => {
      const p = pair('/api/jobs/1'); stats.track(p.req, p.res);
      setTimeout(() => stats.storeError(), 5);
      await sleep(20);
      p.res.answer(200);
    });
    await later(async () => { stats.storeError(); });           /* no request in flight */
    await later(async () => {
      const p = pair('/api/shares'); stats.track(p.req, p.res);
      p.res.answer(200);                                         /* the answer was sent ... */
      await sleep(5); stats.storeError();                        /* ... a failure after that is not this request's */
    });
    const d = parse(stats.flush());
    ok('two store errors in a shares request count under api-shares', d.by['api-shares'].storeErrors === 2, JSON.stringify(d.by['api-shares']));
    ok('one in a timer started by a jobs request counts under api-jobs', d.by['api-jobs'].storeErrors === 1, JSON.stringify(d.by['api-jobs']));
    ok('one with no request, and one after the answer was sent, count under other', d.by.other.storeErrors === 2, JSON.stringify(d.by.other));
    ok('the total is 5', d.storeErrors === 5);
  }
  {
    const { stats, lines } = rig();
    await later(async () => { stats.storeError(); });
    ok('a store error alone (no request at all) is a window worth a line', lines.length === 0 && stats.flush() !== null);
  }

  heading('idle pool errors are a number of their own');
  {
    const { stats, lines } = rig();
    await later(async () => {
      const p = pair('/api/shares'); stats.track(p.req, p.res);
      await sleep(2); stats.storeError('idle'); stats.storeError('idle');       /* even inside a request's context: the caller says it is the pool's */
      stats.storeError();
      p.res.answer(200);
    });
    await later(async () => { stats.storeError('idle'); });
    const d = parse(stats.flush());
    ok('three idle pool errors are in idlePoolErrors, and not in storeErrors (the one real store error is, under api-shares)', d.idlePoolErrors === 3 && d.storeErrors === 1 && d.by['api-shares'].storeErrors === 1 && d.by.other.storeErrors === 0, JSON.stringify([d.idlePoolErrors, d.storeErrors, d.by]));
    await later(async () => { stats.storeError('idle'); });
    ok('a window with only an idle pool error is worth a line, and the counter starts again after it', stats.flush() !== null && lines.length === 2 && stats.flush() === null);
  }

  heading('the line holds numbers only');
  {
    const { stats } = rig();
    const secret = [
      pair('/api/shares/SHAREID123?token=SECRETTOKEN', { 'x-forwarded-for': '203.0.113.77', cookie: 'ppp_session=SESSIONCOOKIE', 'x-ppp-pc': 'a'.repeat(64), authorization: 'Bearer ppw_WORKERTOKEN' }),
      pair('/api/jobs/job-9f8e7d', { 'x-ppp-pc': 'b'.repeat(64) }),
      pair('/api/auth/login?email=someone@example.com')
    ];
    secret.forEach((p, i) => { p.req.socket = { remoteAddress: '198.51.100.9' }; stats.track(p.req, p.res); p.res.answer(i === 0 ? 500 : 200); });
    await later(async () => { stats.storeError(); });
    const line = stats.flush();
    const d = parse(line);
    const keys = o => Object.keys(o).sort().join();
    ok('the keys are fixed: v, windowS, upS, requests, 4xx, tooMany, 5xx, storeErrors, idlePoolErrors, by', keys(d) === '4xx,5xx,by,idlePoolErrors,requests,storeErrors,tooMany,upS,v,windowS', keys(d));
    ok('by has the six classes and each has five counts', keys(d.by) === 'api-auth,api-jobs,api-shares,health,other,static' && Object.values(d.by).every(v => keys(v) === '4xx,5xx,requests,storeErrors,tooMany'));
    const strings = []; (function walk(x) { if (x && typeof x === 'object') Object.values(x).forEach(walk); else if (typeof x === 'string') strings.push(x); })(d);
    ok('there is no string value in it at all, and no number is fractional or negative', strings.length === 0 && !/\d\.\d|-\d/.test(line));
    ok('no address, id, token, cookie, email or path of the requests is in it', !/203\.0\.113|198\.51\.100|SHAREID|SECRET|SESSIONCOOKIE|WORKERTOKEN|job-9f|example\.com|someone|aaaa|bbbb|\/api/.test(line), line);
  }

  heading('the window and the hour');
  {
    const { stats, tick } = rig();
    const p = pair('/'); stats.track(p.req, p.res); p.res.answer(200);
    tick(61 * 60 * 1000 + 400);
    const d = parse(stats.flush());
    ok('windowS and upS come from the clock (here 3660 s)', d.windowS === 3660 && d.upS === 3660, d.windowS + ' / ' + d.upS);
    const q = pair('/'); stats.track(q.req, q.res); q.res.answer(200);
    tick(10 * 1000);
    const e = parse(stats.flush());
    ok('the next window starts at the last line: windowS 10, upS 3670, and the counters began again from zero', e.windowS === 10 && e.upS === 3670 && e.requests === 1, JSON.stringify([e.windowS, e.upS, e.requests]));
  }
  {
    /* the real timer, fast: the interval flushes by itself once a request has armed it */
    const lines = [];
    const stats = createStats({ log: l => lines.push(l), sigterm: false, intervalMs: 40 });
    ok('nothing is scheduled or printed before the first request', lines.length === 0);
    const p = pair('/health'); stats.track(p.req, p.res); p.res.answer(200);
    await sleep(160);
    ok('the interval printed the window by itself, once (the next windows are empty and print nothing)', lines.length === 1 && parse(lines[0]).by.health.requests === 1, lines.length + ' lines');
    const q = pair('/api/shares'); stats.track(q.req, q.res); q.res.answer(500);
    await sleep(120);
    ok('and the next window with a 5xx in it printed a second line', lines.length === 2 && parse(lines[1])['5xx'] === 1);
  }

  heading('the timer does not keep a process alive; SIGTERM prints the last line');
  {
    const code = "const m = require(" + JSON.stringify(MODULE) + "); const s = m.createStats({ intervalMs: 3600000, sigterm: false, log: l => console.log(l) });" +
      "const EE = require('events'); const rq = new EE(); rq.url = '/'; const rs = new EE(); rs.statusCode = 200; s.track(rq, rs); rs.statusCode = 200; rs.emit('finish'); console.log('armed');";
    const r = await runNode(code, 5000);
    ok('a process whose only live handle is the hourly timer exits by itself (the timer is unref\'d)', r.code === 0 && !r.timedOut && r.out.includes('armed'), 'exit ' + r.code + (r.timedOut ? ', still running after 8 s' : ''));

    const term = "const m = require(" + JSON.stringify(MODULE) + "); const s = m.createStats({ intervalMs: 3600000, log: l => console.log(l) });" +
      "const EE = require('events'); const rq = new EE(); rq.url = '/helper/x'; const rs = new EE(); s.track(rq, rs); rs.statusCode = 503; rs.emit('finish');" +
      "setInterval(() => {}, 1000); console.log('armed'); process.emit('SIGTERM'); setTimeout(() => console.log('STILL RUNNING'), 3000);";
    const t = await runNode(term, 6000);
    const last = t.out.split(/\r?\n/).filter(l => l.startsWith('stats: '));
    ok('on SIGTERM the process prints one last line, with final:true and the 503 in it', last.length === 1 && parse(last[0]).final === true && parse(last[0])['5xx'] === 1 && parse(last[0]).by.other['5xx'] === 1, last.join(' | ') || t.out.slice(0, 200));
    ok('and it then stops (it does not stay up because a handler took the signal)', !t.timedOut && !t.out.includes('STILL RUNNING') && (t.code !== 0 || t.signal), 'exit ' + t.code + ' ' + t.signal);
  }
}

function runNode(code, ms) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, ms);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, timedOut }); });
  });
}

/* ---- part 2: the real server.js ---- */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function get(port, method, p, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: headers || {}, agent: false }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject); r.end();
  });
}
async function startServer(env) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-stats-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dir, SESSION_SECRET: 'stats-test-secret', PPP_HELPER: '', DATABASE_URL: '' }, env || {})
  });
  const srv = { port, child, out: '', exited: false, exit: null, dir };
  child.stdout.on('data', d => { srv.out += d; });
  child.stderr.on('data', d => { srv.out += d; });
  child.on('exit', (code, signal) => { srv.exited = true; srv.exit = { code, signal }; });
  srv.bootOut = null;
  const t0 = Date.now();
  for (;;) {
    if (srv.exited) throw new Error('server.js exited early: ' + srv.out.slice(0, 300));
    if (srv.out.includes('PPP listening')) break;                  /* listening: read what booting printed, before any request */
    if (Date.now() - t0 > 30000) { child.kill(); throw new Error('server.js did not come up'); }
    await sleep(50);
  }
  await sleep(150);
  srv.bootOut = srv.out;
  srv.statsLines = () => srv.out.split(/\r?\n/).filter(l => l.startsWith('stats: '));
  srv.close = () => new Promise(res => { if (srv.exited) return res(); child.on('exit', () => res()); child.kill(); });
  return srv;
}

async function serverPart() {
  heading('the real server.js: a planted 503 is counted, and nothing else is exposed');
  const srv = await startServer({ PPP_STATS_INTERVAL_MS: '700' });
  try {
    ok('booting printed no `stats:` line and the boot lines are the ones of today', !/stats:/.test(srv.bootOut) && srv.bootOut.split(/\r?\n/).filter(Boolean).every(l => /^(PPP listening|Home-PC worker queue|Guest links|Seeded shared score|Local helper)/.test(l)), srv.bootOut.split(/\r?\n/).filter(Boolean).join(' | ').slice(0, 300));
    const r = {
      page: await get(srv.port, 'GET', '/'),
      health: await get(srv.port, 'GET', '/health'),
      me: await get(srv.port, 'GET', '/api/auth/me'),
      shares: await get(srv.port, 'GET', '/api/shares'),
      jobs: await get(srv.port, 'GET', '/api/jobs'),
      planted: await get(srv.port, 'GET', '/helper/planted?id=1234567890abcdef'),
      post: await get(srv.port, 'POST', '/index.html')
    };
    ok('the requests were answered as they are today (page 200, health 200, auth/me 200, shares 200, jobs 401, /helper 503, POST to a page 405)',
      [r.page.status, r.health.status, r.me.status, r.shares.status, r.jobs.status, r.planted.status, r.post.status].join() === '200,200,200,200,401,503,405',
      [r.page.status, r.health.status, r.me.status, r.shares.status, r.jobs.status, r.planted.status, r.post.status].join());
    /* a planted 429: the signup limiter refuses the 21st request of one address in 15 minutes (the first 20 are answered 422: no email) */
    const signups = [];
    for (let i = 0; i < 21; i++) signups.push((await get(srv.port, 'POST', '/api/auth/signup', { 'X-Forwarded-For': '203.0.113.50' })).status);
    ok('21 signup requests from one address: 20 answered 422 and the 21st 429 (the limiter, as it is today)', signups.slice(0, 20).every(x => x === 422) && signups[20] === 429, signups.join());
    /* wait for the interval to print what was counted (the windows may split it across lines: add them up) */
    const sum = () => srv.statsLines().map(l => JSON.parse(l.slice(7))).reduce((a, d) => {
      a.requests += d.requests; a['5xx'] += d['5xx']; a['4xx'] += d['4xx']; a.tooMany += d.tooMany;
      Object.keys(d.by).forEach(k => {
        const b = a.by[k] = a.by[k] || { requests: 0, '4xx': 0, tooMany: 0, '5xx': 0 };
        ['requests', '4xx', 'tooMany', '5xx'].forEach(f => { b[f] += d.by[k][f]; });
      });
      return a;
    }, { requests: 0, '4xx': 0, tooMany: 0, '5xx': 0, by: {} });
    const t0 = Date.now();
    while (sum().requests < 28 && Date.now() - t0 < 8000) await sleep(100);
    const s = sum();
    const by = k => s.by[k] || { requests: 0, '4xx': 0, tooMany: 0, '5xx': 0 };
    ok('the lines add up to the 28 requests (the readiness probe is only booting, before the first count, and is not in them)', s.requests === 28, JSON.stringify(s));
    ok('the planted 503 is in the line: 1 answer with a 5xx, under `other` (the /helper route)', s['5xx'] === 1 && by('other')['5xx'] === 1 && by('other').requests === 1, JSON.stringify(s));
    ok('the planted 429 is in the line, under api-auth, and among its 4xx: 21 (the twenty 422s and the 429)', s.tooMany === 1 && by('api-auth').tooMany === 1 && by('api-auth')['4xx'] === 21 && by('api-auth').requests === 22, JSON.stringify(by('api-auth')));
    ok('static 2 requests with 1 4xx (the page; the POST to a page, 405), health 1, api-shares 1, api-jobs 1 (a 401, so 1 4xx)', by('static').requests === 2 && by('static')['4xx'] === 1 && by('health').requests === 1 && by('api-shares').requests === 1 && by('api-jobs').requests === 1 && by('api-jobs')['4xx'] === 1, JSON.stringify(s.by));
    const lines = srv.statsLines();
    ok('every line is the strict shape, and none holds an address, the query of the planted request, or a header value', lines.length >= 1 && lines.every(l => /^stats: \{[\d",:{}a-zA-Z\-]+\}$/.test(l)) && !/127\.0\.0\.1|203\.0\.113|1234567890abcdef|planted|ppp_|stats-test-secret/.test(lines.join('\n')), lines[0]);
    ok('lines come at the interval and not per request: 28 requests made at most a few lines', lines.length <= 6, lines.length + ' lines');
    const probes = {};
    for (const p of ['/stats', '/api/stats', '/api/metrics', '/metrics', '/__stats', '/health/stats', '/api/health/stats']) probes[p] = await get(srv.port, 'GET', p);
    ok('no route serves the numbers (each of seven guesses is a 404, and none has a stats document in its body)', Object.values(probes).every(x => x.status === 404 && !/"5xx"|storeErrors/.test(x.text)), Object.keys(probes).map(p => p + ' ' + probes[p].status).join(', '));
    ok('/health is still exactly {"ok":true,"service":"ppp"}', r.health.text === '{"ok":true,"service":"ppp"}', r.health.text);
  } finally { await srv.close(); }

  if (process.platform === 'win32') {
    console.log('  - the stop signal of the real server is not tested on Windows (no SIGTERM to catch there); the unit part above tests the handler in a child process');
    return;
  }
  heading('the real server.js: SIGTERM prints the last line, then stops');
  const srv2 = await startServer({});            /* the default interval: an hour */
  try {
    await get(srv2.port, 'GET', '/');
    await get(srv2.port, 'GET', '/helper/x');
    ok('no line yet: the hour has not passed', srv2.statsLines().length === 0);
    srv2.child.kill('SIGTERM');
    const t0 = Date.now();
    while (!srv2.exited && Date.now() - t0 < 8000) await sleep(50);
    const lines = srv2.statsLines();
    ok('the stop printed one line with final:true, 2 requests and the 503', lines.length === 1 && (d => d.final === true && d.requests === 2 && d['5xx'] === 1)(JSON.parse(lines[0].slice(7))), lines.join(' | ') || srv2.out.slice(-300));
    ok('and the process ended by the signal, as it would have without the handler', srv2.exited && srv2.exit.signal === 'SIGTERM', JSON.stringify(srv2.exit));
  } finally { await srv2.close(); }
}

(async () => {
  await unitPart();
  if (!UNIT_ONLY) await serverPart();
  if (failed) { console.error('\n' + failed + ' failed (' + passed + ' passed): server-stats'); process.exit(1); }
  console.log('\n' + passed + ' passed: server-stats');
})().catch(e => { console.error('server-stats test crashed:', e && e.stack || e); process.exit(2); });
