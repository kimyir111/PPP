/* G13-7a (docs/GOALS/G13_PRODUCTIZATION.md, G13-D11): the server's own counters, and one log line an hour. Counters ONLY: nothing here changes what a
   request is answered.

   What is counted, in memory, per route class: requests, answers with a 5xx status, and store errors (every call of server.js's logStoreError - it
   logs at most five lines a minute, this counts them all). The classes are fixed, so the memory is fixed:
     static      the page and every file it loads (anything that is not /api, /helper or /health)
     api-auth    /api/auth/...           api-shares   /api/shares...        health   /health and /api/health
     api-jobs    /api/jobs..., /api/worker..., /api/pc-links... (the home-PC queue)
     other       every other /api route, /helper, and a request whose address cannot be read
   No address, no id, no path, no header, no user data is kept or printed - only the numbers. Nothing is served over HTTP.

   The line, once an hour of the process being awake (the timer is unref'd: it never keeps a process or a test alive), and once more when the
   process is told to stop (SIGTERM; Render spins the free instance down after 15 idle minutes, so most processes live less than an hour and would
   never print an hourly line). A window with nothing counted prints nothing. After the line the counters start again from zero:

     stats: {"v":1,"windowS":3600,"upS":3601,"requests":412,"5xx":1,"storeErrors":0,"by":{"static":{"requests":300,"5xx":0,"storeErrors":0}, ...}}
     (the last line of a process adds "final":true)

   A store error is attributed to the route class of the request it happened in (AsyncLocalStorage, entered by track() when the request arrives);
   one that happens with no request in flight, or after the answer was sent (an idle database connection that drops), counts under `other`.

   server.js: `server.prependListener('request', serverStats.track)` and `serverStats.storeError()` in logStoreError - three lines.
   tests/server-stats.test.js plants a 5xx and a store error and reads them in the line. */
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const CLASSES = ['static', 'api-auth', 'api-shares', 'api-jobs', 'health', 'other'];
const HOUR_MS = 60 * 60 * 1000;

/* the route class of a request line (the part of req.url before ? and #), read the way server.js reads it: new URL(req.url, base).pathname */
function classify(rawUrl) {
  let p;
  try { p = new URL(String(rawUrl), 'http://x').pathname; } catch (e) { return 'other'; }
  if (p === '/health' || p === '/api/health') return 'health';
  if (p === '/helper' || p.startsWith('/helper/')) return 'other';
  if (p === '/api/auth' || p.startsWith('/api/auth/')) return 'api-auth';
  if (p === '/api/shares' || p.startsWith('/api/shares/')) return 'api-shares';
  if (/^\/api\/(jobs|worker|pc-links)(\/|$)/.test(p)) return 'api-jobs';
  if (p === '/api' || p.startsWith('/api/')) return 'other';
  return 'static';
}

function createStats(opts) {
  opts = opts || {};
  const log = opts.log || (line => console.log(line));
  const intervalMs = opts.intervalMs > 0 ? opts.intervalMs : HOUR_MS;
  const now = opts.now || Date.now;
  const als = new AsyncLocalStorage();
  const bootAt = now();
  let windowAt = bootAt;
  let timer = null;
  let termHooked = false;
  let c = fresh();

  function fresh() {
    const o = { by: {} };
    CLASSES.forEach(k => { o.by[k] = { requests: 0, '5xx': 0, storeErrors: 0 }; });
    return o;
  }
  function total(key) { return CLASSES.reduce((n, k) => n + c.by[k][key], 0); }

  /* the line for the counters now (null when nothing was counted), and the counters start again */
  function flush(final) {
    const requests = total('requests'), fivexx = total('5xx'), storeErrors = total('storeErrors');
    if (!requests && !fivexx && !storeErrors) { windowAt = now(); return null; }
    const t = now();
    const doc = {
      v: 1,
      windowS: Math.round((t - windowAt) / 1000),
      upS: Math.round((t - bootAt) / 1000),
      requests: requests, '5xx': fivexx, storeErrors: storeErrors,
      by: c.by
    };
    if (final) doc.final = true;
    const line = 'stats: ' + JSON.stringify(doc);
    c = fresh(); windowAt = t;
    try { log(line); } catch (e) { /* a log that fails is not a reason to fail */ }
    return line;
  }

  /* the process is told to stop: the last line, then the stop the signal would have been (the handler was `once`, so the default action is back).
     Not before the line is out: an empty write is called back when the earlier writes have drained; 0.5 s at most if stdout never drains. */
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    try { process.kill(process.pid, 'SIGTERM'); } catch (e) { process.exit(143); }
  }
  function onTerm() {
    try { flush(true); } catch (e) { /* none */ }
    try { process.stdout.write('', stop); } catch (e) { stop(); }
    setTimeout(stop, 500);
  }
  /* started by the first request, so booting prints and schedules nothing */
  function arm() {
    if (!timer) {
      timer = setInterval(() => { try { flush(false); } catch (e) { /* none */ } }, intervalMs);
      timer.unref();
    }
    if (!termHooked && opts.sigterm !== false) { termHooked = true; process.once('SIGTERM', onTerm); }
  }

  /* a request has arrived: count it, and its answer when it is sent. Never throws: counting must not touch a request. */
  function track(req, res) {
    try {
      const cls = classify(req && req.url);
      c.by[cls].requests++;
      const ctx = { cls: cls, open: true };
      als.enterWith(ctx);
      res.once('finish', () => { if (res.statusCode >= 500) c.by[cls]['5xx']++; });
      res.once('close', () => { ctx.open = false; });
      arm();
    } catch (e) { /* none */ }
  }

  /* a store failed (server.js logStoreError): counted for the request in flight, else under `other` */
  function storeError() {
    try {
      const ctx = als.getStore();
      c.by[ctx && ctx.open ? ctx.cls : 'other'].storeErrors++;
    } catch (e) { /* none */ }
  }

  return { track: track, storeError: storeError, flush: flush, classify: classify, CLASSES: CLASSES };
}

/* the instance server.js uses; PPP_STATS_INTERVAL_MS is only for the test that starts the real server (default: an hour) */
const interval = Number(process.env.PPP_STATS_INTERVAL_MS);
module.exports = createStats({ intervalMs: interval > 0 ? interval : HOUR_MS });
module.exports.createStats = createStats;
