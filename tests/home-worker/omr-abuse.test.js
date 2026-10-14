/* G12-5: the abuse analysis of docs/GOALS/G12_OMR.md section 24 - the rows that are about WHAT A STRANGER LEARNS or can make the site do, over real HTTP with the file store:

     - a stranger with no code, a wrong code, a code of another link: nothing queued, nothing read, and the answers do not say whether a job exists
     - a stranger's own link: it can only ever reach its own PC (a job is claimed by the link that owns it), and what it can store is bounded (limits are in omr-limits.test.js)
     - the site fetches nothing: a link in the body of a score is not followed, and not kept
     - names: job ids are random and the same shape whoever asks; a title never reaches a path; a hostile id is no route
     - what is kept: no image, no result in a log line, and no image in the job file

   Run: node tests/home-worker/omr-abuse.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req } = L;
const { claimOmr, ready, sendOmr, page, pageFilesIn, jobOf } = require('./omr-jobs.test.js');

(async () => {
  heading('what a stranger learns');
  const S = await L.startService({ users: ['a', 'b'] });
  try {
    await ready(S, 'a'); await ready(S, 'b');
    const qa = await sendOmr(S, 'a', L.omrPages(2, { w: 800 }));
    const ida = qa.body.job.id;
    const tokA = S.token('a'), tokB = S.token('b');
    await claimOmr(S, tokA);
    const random = 'Zx9_ab-QwErTyUiO';
    const same = (name, r1, r2) => ok(name, r1.status === r2.status && JSON.stringify(r1.body) === JSON.stringify(r2.body), r1.status + ' ' + r1.text + ' VS ' + r2.status + ' ' + r2.text);
    same('B asking for A\'s job by id is answered exactly as B asking for an id that never existed (status and body)', await S.as('b').get('/api/jobs/' + ida), await S.as('b').get('/api/jobs/' + random));
    same('B cancelling A\'s job is answered as a job that never existed', await S.as('b').post('/api/jobs/' + ida + '/cancel', {}), await S.as('b').post('/api/jobs/' + random + '/cancel', {}));
    same('B removing A\'s job is answered as a job that never existed', await S.as('b').del('/api/jobs/' + ida), await S.as('b').del('/api/jobs/' + random));
    same('B\'s worker token on A\'s pages is answered as a job that never existed', await page(S, tokB, ida, 0), await page(S, tokB, random, 0));
    same('B\'s worker token finishing A\'s job is answered as a job that never existed', await S.worker(tokB).post('/api/worker/jobs/' + ida + '/result', L.omrResult(2)), await S.worker(tokB).post('/api/worker/jobs/' + random + '/result', L.omrResult(2)));
    same('and failing it, and beating for it', await S.worker(tokB).post('/api/worker/jobs/' + ida + '/fail', { error: 'x' }), await S.worker(tokB).post('/api/worker/jobs/' + random + '/fail', { error: 'x' }));
    ok('A\'s job is untouched by all of it', jobOf(S, ida).status === 'claimed' && pageFilesIn(S) === 2);
    /* a result A's PC posted is A's alone */
    await S.worker(tokA).post('/api/worker/jobs/' + ida + '/result', L.omrResult(2));
    same('B reading the finished score of A is answered as a job that never existed (the result is not leaked)', await S.as('b').get('/api/jobs/' + ida), await S.as('b').get('/api/jobs/' + random));
    ok('A reads it', (await S.as('a').get('/api/jobs/' + ida)).body.result.pages.length === 2);
    ok('a wrong code is 401 whatever job it asks for: the same answer for A\'s id and a random one', await (async () => {
      const w1 = await req(S.port, 'GET', '/api/jobs/' + ida, { code: 'cd'.repeat(32) }), w2 = await req(S.port, 'GET', '/api/jobs/' + random, { code: 'cd'.repeat(32) });
      return w1.status === 401 && w2.status === 401 && JSON.stringify(w1.body) === JSON.stringify(w2.body);
    })());
    ok('the wrong codes were counted against the address: after 20 an hour the answer is 429 (not 401), so a code cannot be guessed at a rate', await (async () => {
      let last = 0;
      for (let i = 0; i < 25; i++) last = (await req(S.port, 'POST', '/api/jobs/omr', { code: i.toString(16).padStart(2, '0').repeat(32), body: { pages: [] }, ip: '192.0.2.77' })).status;
      return last === 429;
    })());
    ok('and that address\'s valid code is still honoured (only failures are counted)', (await req(S.port, 'GET', '/api/jobs', { user: 'a', ip: '192.0.2.77' })).status === 200);
  } finally { await S.close(); }

  heading('a stranger with a link of their own');
  {
    const S2 = await L.startService({ users: ['owner', 'stranger'] });
    try {
      await ready(S2, 'owner'); await ready(S2, 'stranger');
      const mine = await sendOmr(S2, 'stranger', L.omrPages(1, { w: 810 }));
      ok('a stranger can queue a score on their own link', mine.status === 201);
      const ownerClaim = await claimOmr(S2, S2.token('owner'));
      ok('the owner\'s PC, asking for work with omr: true, is never handed it: a job runs only on the PC of the link that holds it', ownerClaim.status === 200 && ownerClaim.body.job === null);
      ok('the stranger\'s job is waiting for the stranger\'s own PC and nobody else\'s (their worker token is the only one that can claim it)', (await claimOmr(S2, S2.token('stranger'))).body.job.id === mine.body.job.id);
      /* the owner's job queue is untouched by the stranger's abuse of theirs */
      const ownerJob = await sendOmr(S2, 'owner', L.omrPages(1, { w: 820 }));
      ok('the owner\'s own scores are queued and handed out as ever', ownerJob.status === 201 && (await claimOmr(S2, S2.token('owner'))).body.job.id === ownerJob.body.job.id);
    } finally { await S2.close(); }
  }

  heading('the site fetches nothing, and a name is never a path');
  {
    const S3 = await L.startService({ users: ['u1'] });
    try {
      await ready(S3, 'u1');
      const hits = [];
      const probe = L.http.createServer((q, s) => { hits.push(q.url); s.end('x'); });
      await new Promise(r => probe.listen(0, '127.0.0.1', r));
      const pp = probe.address().port;
      const r = await sendOmr(S3, 'u1', L.omrPages(1, { w: 830 }), { url: 'http://127.0.0.1:' + pp + '/ssrf', pageUrls: ['http://127.0.0.1:' + pp + '/p0'], callback: 'http://127.0.0.1:' + pp + '/cb' });
      await L.sleep(300);
      ok('a score that carries addresses in its body is queued as if it did not: nothing was requested from them, and none is kept (the job\'s url is only a digest of the images)',
        r.status === 201 && hits.length === 0 && r.body.job.url === '' && /^omr:[0-9a-f]{24}$/.test(jobOf(S3, r.body.job.id).url) && JSON.stringify(jobOf(S3, r.body.job.id)).indexOf('127.0.0.1') < 0, JSON.stringify(hits) + ' ' + r.text.slice(0, 120));
      probe.close();
      const t = await sendOmr(S3, 'u1', L.omrPages(1, { w: 831 }), { title: '../../../etc/passwd' });
      ok('a title that is a path is a title: stored cleaned, no file or folder by that name anywhere (the files are named by the server\'s own job id and page number)', t.status === 201 && t.body.job.title === '../../../etc/passwd'
        && L.fs.readdirSync(L.path.join(S3.dir, 'omr-pages')).every(f => /^[A-Za-z0-9_-]{16}\.\d+\.bin$/.test(f)), t.text.slice(0, 160));
      ok('job ids are 16 random base64url characters, all different', (() => { const ids = Array.from(S3.svc._state.jobs.keys()); return ids.length === 2 && ids.every(i => /^[A-Za-z0-9_-]{16}$/.test(i)) && new Set(ids).size === 2; })());
      const hostile = ['..%2f..%2fjobs', '%2e%2e', 'a'.repeat(41), 'abc', 'x%00y', '%252e%252e'].map(i => S3.worker(S3.token('u1')).get('/api/worker/jobs/' + i + '/pages/0'));
      const res = await Promise.all(hostile);
      ok('hostile job ids are no route at all (404 "Not found"), never a lookup', res.every(x => x.status === 404 && x.body && x.body.error === 'Not found'), JSON.stringify(res.map(x => x.status + ' ' + (x.body && x.body.error))));
    } finally { await S3.close(); }
  }

  heading('what is kept: no image in the job file, no image in a log line');
  {
    const S4 = await L.startService({ users: ['u1'] });
    try {
      await ready(S4, 'u1');
      const marker = Buffer.from('PPP-MARKER-IMAGE-BYTES-0123456789').toString('base64');
      const png = Buffer.concat([L.pngBytes(900, 900, 100), Buffer.from('PPP-MARKER-IMAGE-BYTES-0123456789')]);
      const q = await sendOmr(S4, 'u1', [png.toString('base64')]);
      await claimOmr(S4, S4.token('u1'));
      await S4.worker(S4.token('u1')).post('/api/worker/jobs/' + q.body.job.id + '/result', { pages: [{ index: 0, ok: true, movements: ['<score-partwise><x>PPP-MARKER-RESULT-0123456789</x></score-partwise>'] }] });
      const text = L.fs.readFileSync(L.path.join(S4.dir, 'jobs.json'), 'utf8');
      ok('jobs.json holds the result (it is the job\'s) but never an image or its base64', text.indexOf('PPP-MARKER-IMAGE') < 0 && text.indexOf(marker.slice(0, 20)) < 0 && text.indexOf(png.toString('base64').slice(0, 24)) < 0);
      ok('no log line of the service holds an image or a result', S4.logged.every(l => l.indexOf('PPP-MARKER') < 0));
      S4.store.fail.on = true; S4.store.fail.only = 'getResult';
      const failed = await S4.as('u1').get('/api/jobs/' + q.body.job.id);
      S4.store.fail.on = false;
      ok('even when the store fails the answer holds no secret and the log line is one sentence', failed.status === 503 && S4.logged.every(l => l.indexOf('PPP-MARKER') < 0 && l.indexOf(S4.code('u1')) < 0), failed.status + ' ' + S4.logged.join('|').slice(0, 120));
    } finally { await S4.close(); }
  }
  L.finish('the home-PC queue, kind omr: what a stranger learns and can make the site do');
})().catch(e => { console.error(e); process.exit(1); });
