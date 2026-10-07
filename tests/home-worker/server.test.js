/* G10b-1 / G10b-2: the home-PC queue as server.js serves it: the real server on a free port with a data directory of its own (the file store, no
   Postgres). NO ACCOUNT: the test never signs up (except to show that an account's cookie is irrelevant to the queue): a PC link is made with POST /api/pc-links, the page's
   calls carry its client code in X-PPP-PC, the worker its token. What it adds to tests/home-worker/jobs.test.js: the WIRING (the routes are where the page expects them), a
   restart that keeps the links and the queue, the guest-link key and the client code side by side, and that nothing else changed (the account routes, the shares, the static
   page, /tools stay as they were).

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
let addr = 1;
const nextIp = () => '10.200.' + (addr >> 8) + '.' + (addr++ & 255);

(async () => {
  const dir = L.tmpDir('ppp-hw-srv-');
  let srv = await start(dir);
  try {
    heading('no sign-in: a PC link, as the page makes it');
    const mkLink = async () => req(srv.port, 'POST', '/api/pc-links', { ip: nextIp(), body: {} });
    const made = await mkLink(), made2 = await mkLink();
    const code1 = made.body.clientCode, code2 = made2.body.clientCode, token = made.body.workerToken;
    ok('POST /api/pc-links with no cookie, no session and no account: 201, a client code, a worker token', made.status === 201 && /^[0-9a-f]{64}$/.test(code1) && /^ppw_/.test(token) && code1 !== code2 && !made.headers['set-cookie']);
    const get = (c, p, h) => req(srv.port, 'GET', p, { code: c, headers: h });
    const post = (c, p, b, h) => req(srv.port, 'POST', p, { code: c, body: b == null ? {} : b, headers: h });
    ok('no header: 401 on the list and on enqueue (and it says "no PC link on this device")', (await req(srv.port, 'GET', '/api/jobs')).body.code === 'no-link' && (await req(srv.port, 'POST', '/api/jobs', { body: { url: WATCH('vgnliVjJUOo') } })).status === 401);
    ok('a code that is not a link is 401, and a broken header value is a 401, not a crash', (await get('0'.repeat(64), '/api/jobs')).status === 401 && (await get('%E0%A4%A', '/api/jobs')).status === 401 && (await req(srv.port, 'GET', '/health')).status === 200);
    const q = await post(code1, '/api/jobs', { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo', title: 'Teacher piece' });
    ok('a job is queued', q.status === 201 && q.body.job.status === 'queued' && q.body.worker.hasToken === true && q.body.worker.everSeen === false, q.text.slice(0, 160));
    ok('the other link does not see it', (await get(code2, '/api/jobs')).body.jobs.length === 0 && (await get(code2, '/api/jobs/' + q.body.job.id)).status === 404);
    const cx = await post(code1, '/api/jobs', { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' }, { Origin: 'https://evil.example' });
    ok('a cross-site request with the right code is refused', cx.status === 403);
    const cxr = await get(code1, '/api/jobs', { Origin: 'https://evil.example' });
    ok('and so is a cross-site READ (the header would never get there from another origin; if it did, it is refused)', cxr.status === 403);
    const pre = await req(srv.port, 'OPTIONS', '/api/jobs', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-ppp-pc' } });
    ok('a preflight asking to send X-PPP-PC from another origin gets no Access-Control-Allow-* (the browser then never sends the request)', !Object.keys(pre.headers).some(h => /^access-control-allow/i.test(h)));

    heading('the worker, over the same server');
    const wk = (p, b) => req(srv.port, 'POST', p, { token: token, body: b == null ? {} : b });
    const cl = await wk('/api/worker/claim', { waitSeconds: 1200 });
    ok('the claim hands over the job and says 15 s', cl.status === 200 && cl.body.job && cl.body.job.url === 'https://www.youtube.com/watch?v=vgnliVjJUOo' && cl.body.nextPollSeconds === 15, cl.text);
    const stRes = await get(code1, '/api/worker/status');
    ok('G10b-4, over the real server: the status answer names the link (linkTag: 6 hex, the last 6 of the link id), keeps its other fields, and holds no 64-hex secret', /^[0-9a-f]{6}$/.test(stRes.body.worker.linkTag) && made.body.id.endsWith(stRes.body.worker.linkTag) && stRes.body.worker.linkTag !== (await get(code2, '/api/worker/status')).body.worker.linkTag && Object.keys(stRes.body.worker).sort().join() === 'activePollSeconds,alive,everSeen,hasToken,idlePollSeconds,lastSeenAt,linkTag' && !/[0-9a-f]{64}/.test(stRes.text), stRes.text);
    ok('the owner sees it claimed and the worker seen',(await get(code1, '/api/jobs')).body.jobs[0].status === 'claimed' && (await get(code1, '/api/worker/status')).body.worker.alive === true);
    ok('the client code is not a worker token, and the token is not a code', (await req(srv.port, 'POST', '/api/worker/claim', { token: code1, body: {} })).status === 401 && (await req(srv.port, 'GET', '/api/jobs', { code: token })).status === 401);
    ok('a heartbeat', (await wk('/api/worker/jobs/' + cl.body.job.id + '/heartbeat', { stage: 'transcribe', pct: 0.5 })).status === 200);

    heading('a restart keeps the links and the queue');
    await srv.close();
    srv = await start(dir);
    const after = await get(code1, '/api/jobs');
    ok('after a restart the code still works, the job is still claimed, the PC was heard of', after.status === 200 && after.body.jobs.length === 1 && after.body.jobs[0].status === 'claimed' && after.body.worker.everSeen === true);
    const rs = await req(srv.port, 'POST', '/api/worker/jobs/' + cl.body.job.id + '/result', { token: token, body: goodResult(300) });
    ok('the token still works, the result is taken', rs.status === 200, rs.text);
    const got = await get(code1, '/api/jobs/' + cl.body.job.id);
    ok('the page can read it: done, with its notes', got.status === 200 && got.body.job.status === 'done' && got.body.result.notes.length === 300 && got.body.result.ensemble.models.length === 2);
    const idle = await req(srv.port, 'POST', '/api/worker/claim', { token: token, body: {} });
    ok('right after, the worker is still told 15 s (an hour once nothing has happened for 5 minutes: the server default)', idle.body.nextPollSeconds === 15);
    const rot = await post(code1, '/api/pc-links/me/worker-token', {});
    ok('a new token (rotation) over the real server: the old one is dead, the new one works', rot.status === 201 && (await req(srv.port, 'GET', '/api/worker/ping', { token: token })).status === 401 && (await req(srv.port, 'GET', '/api/worker/ping', { token: rot.body.workerToken })).status === 200);

    heading('an account, a guest key and a PC link side by side: nothing mixes');
    const su = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'hw1@example.com', password: 'longenough1', displayName: 'HW One' } });
    const cookie = cookieOf(su);
    ok('an account can still be made, as ever', su.status === 201 && /^ppp_session=/.test(cookie));
    ok('its session cookie is not a PC link: with the cookie and no header the queue says 401 "no-link"; with the header the cookie changes nothing (same answer as without it)', (await req(srv.port, 'GET', '/api/jobs', { cookie: cookie })).body.code === 'no-link'
      && (await req(srv.port, 'GET', '/api/jobs', { cookie: cookie, code: code1 })).text === (await get(code1, '/api/jobs')).text);
    const guestKey = 'g'.repeat(8) + 'abcdef0123456789'.repeat(3);
    const sharePayload = { songKey: 'k1', title: 'Guest song', score: { measures: [{ id: 1 }], notes: [] }, listed: false };
    const gs = await req(srv.port, 'POST', '/api/shares', { headers: { 'X-PPP-Guest': guestKey, 'X-PPP-PC': code1 }, body: sharePayload, ip: nextIp() });
    ok('a guest link is still shared with a guest key even when the request ALSO carries a client code (the shares read X-PPP-Guest only)', gs.status === 201 || gs.status === 200, gs.status + ' ' + gs.text.slice(0, 120));
    const gsList = await req(srv.port, 'GET', '/api/shares?mine=1', { headers: { 'X-PPP-Guest': guestKey } });
    ok('and the shares list is as before (mine=1 is for an account)', gsList.status === 401 || gsList.status === 200);
    ok('the guest key alone is not a PC link, and a client code alone is not a guest key (no guest link is made with it)', (await req(srv.port, 'GET', '/api/jobs', { headers: { 'X-PPP-Guest': guestKey } })).body.code === 'no-link'
      && (await req(srv.port, 'POST', '/api/shares', { headers: { 'X-PPP-PC': code1 }, body: sharePayload, ip: nextIp() })).status === 401);
    ok('the same 64 hex used as a guest key and as a client code are two different things: the guest key of a link\'s code makes a guest link of its own and does not read the queue', await (async () => {
      const asGuest = await req(srv.port, 'POST', '/api/shares', { headers: { 'X-PPP-Guest': code2 }, body: Object.assign({}, sharePayload, { songKey: 'k2' }), ip: nextIp() });
      return asGuest.status === 201 && (await req(srv.port, 'GET', '/api/jobs', { headers: { 'X-PPP-Guest': code2 } })).status === 401 && (await get(code2, '/api/jobs')).status === 200;
    })());

    heading('nothing else changed');
    ok('/api/auth/me still answers the signed-in user', (await req(srv.port, 'GET', '/api/auth/me', { cookie: cookie })).body.email === 'hw1@example.com');
    ok('/api/shares is unchanged (401 to create without a session or key)', (await req(srv.port, 'POST', '/api/shares', { body: {} })).status === 401);
    ok('a video id of 6 characters is refused by /api/youtube-audio and /api/youtube-title as well (the one rule: 11)', (await req(srv.port, 'GET', '/api/youtube-audio?url=' + encodeURIComponent('https://youtu.be/abcdef'))).status === 422 && (await req(srv.port, 'GET', '/api/youtube-title?url=' + encodeURIComponent('https://www.youtube.com/watch?v=abcdef'))).status === 422);
    ok('an unknown /api route is still 404', (await req(srv.port, 'GET', '/api/nothing')).status === 404 && (await req(srv.port, 'GET', '/api/worker/nothing', { token: token })).status === 404 && (await req(srv.port, 'GET', '/api/pc-links/nothing', { code: code1 })).status === 404);
    ok('the routes of PR 178 that needed an account are gone (404): the token list, make and remove', (await get(code1, '/api/worker/tokens')).status === 404 && (await post(code1, '/api/worker/tokens', {})).status === 404);
    ok('a wrong method is 405', (await req(srv.port, 'PUT', '/api/jobs', { code: code1, body: {} })).status === 405);
    ok('the worker script and its folder are not served (tools/ is blocked)', (await req(srv.port, 'GET', '/tools/home-worker/worker.js')).status === 404 && (await req(srv.port, 'GET', '/tools/home-worker/worker.config.json')).status === 404);
    ok('the page is served', (await req(srv.port, 'GET', '/')).status === 200);
    const jf = L.fs.readFileSync(L.path.join(dir, 'jobs.json'), 'utf8');
    ok('the data file has no secret: neither code, no token, no address', jf.indexOf(token) < 0 && jf.indexOf(token.slice(17)) < 0 && jf.indexOf(code1) < 0 && jf.indexOf(code2) < 0 && !/10\.200\./.test(jf));

    heading('the idle wait: an hour unless it is set, and never under 15 minutes');
    await srv.close();
    srv = await start(dir, { PPP_WORKER_IDLE_POLL_S: '60' });
    ok('PPP_WORKER_IDLE_POLL_S=60 is raised to 900 (and the server says so in its log)', (await get(code1, '/api/worker/status')).body.worker.idlePollSeconds === 900);
    await srv.close();
    srv = await start(dir, {});
    ok('with nothing set the page is told an hour', (await get(code1, '/api/worker/status')).body.worker.idlePollSeconds === 3600);
    heading('the idle wait is a setting');
    await srv.close();
    srv = await start(dir, { PPP_WORKER_IDLE_POLL_S: '7200', PPP_WORKER_ACTIVE_POLL_S: '20' });
    const pi = await req(srv.port, 'POST', '/api/worker/claim', { token: rot.body.workerToken, body: {} });
    ok('PPP_WORKER_IDLE_POLL_S / PPP_WORKER_ACTIVE_POLL_S are read (the finish was a few seconds ago: active 20)', pi.body.nextPollSeconds === 20, pi.text);
    ok('and the page is told the idle wait', (await get(code1, '/api/worker/status')).body.worker.idlePollSeconds === 7200);
    heading('the per-address limit on making links, over the real server (the address is the one the proxy names), and across a restart');
    {
      const out = [];
      for (let i = 0; i < 7; i++) out.push((await req(srv.port, 'POST', '/api/pc-links', { ip: '203.0.113.9', body: {} })).status);
      ok('five an hour from one address, then 429; another address is fine', out.join() === '201,201,201,201,201,429,429' && (await req(srv.port, 'POST', '/api/pc-links', { ip: '203.0.113.10', body: {} })).status === 201, out.join());
      await srv.close();
      srv = await start(dir, { PPP_WORKER_IDLE_POLL_S: '7200', PPP_WORKER_ACTIVE_POLL_S: '20' });
      ok('after a restart (Render wakes the site from its sleep: the server\'s memory is new) the same address is STILL at five an hour: the counts are in the links, and the tag of the address is keyed by the same secret', (await req(srv.port, 'POST', '/api/pc-links', { ip: '203.0.113.9', body: {} })).status === 429
        && (await req(srv.port, 'POST', '/api/pc-links', { ip: '203.0.113.11', body: {} })).status === 201);
    }
  } finally { await srv.close(); L.rmDir(dir); }
})().then(() => L.finish('server.js with the home-PC queue'), e => { console.error(e); process.exit(1); });
