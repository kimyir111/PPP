/* G10b-1: the home-PC queue as server.js serves it: the real server on a free port with a data directory of its own (the file store, no
   Postgres), real sign-up cookies, a worker token made through the page's own route. What it adds to tests/home-worker/jobs.test.js: the
   WIRING (the routes are where the page expects them, behind the same session cookie as everything else), a restart that keeps the queue,
   and that nothing else changed (the account routes, the static page, /tools stay as they were).

   Run: node tests/home-worker/server.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req, WATCH, goodResult } = L;
const { spawn } = require('child_process');
const { freePort } = require('../serve-free');

async function start(dataDir, env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: L.REPO, stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PPP_DATA_DIR: dataDir, SESSION_SECRET: 'home-worker-test-secret' }, env || {})
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early');
    try { if ((await req(port, 'GET', '/health')).status === 200) break; } catch (e) { /* not up */ }
    if (Date.now() - t0 > 30000) { child.kill(); throw new Error('server.js did not come up'); }
    await L.sleep(100);
  }
  return { port: port, close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
const cookieOf = r => { const c = [].concat(r.headers['set-cookie'] || [])[0] || ''; return c.split(';')[0]; };

(async () => {
  const dir = L.tmpDir('ppp-hw-srv-');
  let srv = await start(dir);
  try {
    heading('signed in, as the page is');
    const su = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'hw1@example.com', password: 'longenough1', displayName: 'HW One' } });
    const su2 = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'hw2@example.com', password: 'longenough2', displayName: 'HW Two' } });
    const c1 = cookieOf(su), c2 = cookieOf(su2);
    ok('two accounts with session cookies', su.status === 201 && su2.status === 201 && /^ppp_session=/.test(c1) && c1 !== c2);
    const get = (c, p) => req(srv.port, 'GET', p, { cookie: c });
    const post = (c, p, b, h) => req(srv.port, 'POST', p, { cookie: c, body: b == null ? {} : b, headers: h });
    ok('no cookie: 401 on the list and on enqueue', (await req(srv.port, 'GET', '/api/jobs')).status === 401 && (await req(srv.port, 'POST', '/api/jobs', { body: { url: WATCH('vgnliVjJUOo') } })).status === 401);
    ok('a forged session is 401', (await get('ppp_session=' + encodeURIComponent('eyJ1aWQiOiJ4In0.AAAA'), '/api/jobs')).status === 401);
    ok('a broken cookie is 401, not a crash', (await get('ppp_session=%E0%A4%A', '/api/jobs')).status === 401 && (await req(srv.port, 'GET', '/health')).status === 200);
    const tk = await post(c1, '/api/worker/tokens', { label: 'Studio' });
    ok('the token comes once', tk.status === 201 && /^ppw_/.test(tk.body.token));
    const token = tk.body.token;
    const q = await post(c1, '/api/jobs', { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo', title: 'Teacher piece' });
    ok('a job is queued', q.status === 201 && q.body.job.status === 'queued' && q.body.worker.hasToken === true && q.body.worker.everSeen === false, q.text.slice(0, 160));
    ok('the other account does not see it', (await get(c2, '/api/jobs')).body.jobs.length === 0 && (await get(c2, '/api/jobs/' + q.body.job.id)).status === 404);
    const cx = await post(c1, '/api/jobs', { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' }, { Origin: 'https://evil.example' });
    ok('a cross-site request with the cookie is refused', cx.status === 403);

    heading('the worker, over the same server');
    const wk = (p, b) => req(srv.port, 'POST', p, { token: token, body: b == null ? {} : b });
    const cl = await wk('/api/worker/claim', { waitSeconds: 1200 });
    ok('the claim hands over the job and says 15 s', cl.status === 200 && cl.body.job && cl.body.job.url === 'https://www.youtube.com/watch?v=vgnliVjJUOo' && cl.body.nextPollSeconds === 15, cl.text);
    ok('the owner sees it claimed and the worker seen', (await get(c1, '/api/jobs')).body.jobs[0].status === 'claimed' && (await get(c1, '/api/worker/status')).body.worker.alive === true);
    ok('the other account\'s token (none) and cookie cannot touch the worker routes', (await req(srv.port, 'POST', '/api/worker/claim', { cookie: c1, body: {} })).status === 401);
    ok('a heartbeat', (await wk('/api/worker/jobs/' + cl.body.job.id + '/heartbeat', { stage: 'transcribe', pct: 0.5 })).status === 200);

    heading('a restart keeps the queue');
    await srv.close();
    srv = await start(dir);
    const after = await get(c1, '/api/jobs');
    ok('after a restart the job is still claimed, the cookie still works', after.status === 200 && after.body.jobs.length === 1 && after.body.jobs[0].status === 'claimed' && after.body.worker.everSeen === true);
    const rs = await req(srv.port, 'POST', '/api/worker/jobs/' + cl.body.job.id + '/result', { token: token, body: goodResult(300) });
    ok('the token still works, the result is taken', rs.status === 200, rs.text);
    const got = await get(c1, '/api/jobs/' + cl.body.job.id);
    ok('the page can read it: done, with its notes', got.status === 200 && got.body.job.status === 'done' && got.body.result.notes.length === 300 && got.body.result.ensemble.models.length === 2);
    const idle = await req(srv.port, 'POST', '/api/worker/claim', { token: token, body: {} });
    ok('right after, the worker is still told 15 s; then idle would be 1200 (the server default)', idle.body.nextPollSeconds === 15);

    heading('nothing else changed');
    ok('/api/auth/me still answers the signed-in user', (await get(c1, '/api/auth/me')).body.email === 'hw1@example.com');
    ok('/api/shares is unchanged (401 to create without a session or key)', (await req(srv.port, 'POST', '/api/shares', { body: {} })).status === 401);
    ok('an unknown /api route is still 404', (await req(srv.port, 'GET', '/api/nothing')).status === 404 && (await req(srv.port, 'GET', '/api/worker/nothing', { token: token })).status === 404);
    ok('a wrong method is 405', (await req(srv.port, 'PUT', '/api/jobs', { cookie: c1, body: {} })).status === 405);
    ok('the worker script and its folder are not served (tools/ is blocked)', (await req(srv.port, 'GET', '/tools/home-worker/worker.js')).status === 404 && (await req(srv.port, 'GET', '/tools/home-worker/worker.config.json')).status === 404);
    ok('the page is served', (await req(srv.port, 'GET', '/')).status === 200);
    const jf = L.fs.readFileSync(L.path.join(dir, 'jobs.json'), 'utf8');
    ok('the data file has no token secret', jf.indexOf(token) < 0 && jf.indexOf(token.slice(17)) < 0);

    heading('the idle wait is a setting');
    await srv.close();
    srv = await start(dir, { PPP_WORKER_IDLE_POLL_S: '3600', PPP_WORKER_ACTIVE_POLL_S: '20' });
    const pi = await req(srv.port, 'POST', '/api/worker/claim', { token: token, body: {} });
    ok('PPP_WORKER_IDLE_POLL_S / PPP_WORKER_ACTIVE_POLL_S are read (the finish was a few seconds ago: active 20)', pi.body.nextPollSeconds === 20, pi.text);
    ok('and the page is told the idle wait', (await get(c1, '/api/worker/status')).body.worker.idlePollSeconds === 3600);
  } finally { await srv.close(); L.rmDir(dir); }
})().then(() => L.finish('server.js with the home-PC queue'), e => { console.error(e); process.exit(1); });
