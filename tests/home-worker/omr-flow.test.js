/* G12-5: the life of a job of kind 'omr' in the home-PC queue, and the abuse analysis of docs/GOALS/G12_OMR.md section 24, one test per row (home-jobs.js, home-jobs-store.js, home-omr.js).
   Over real HTTP with the counting file store; tests/home-worker/omr-jobs-pg.test.js runs the same store and the migration on Postgres.

     - the whole job: asked for, claimed, pages fetched, progress told, result posted, opened by the page, removed; the images deleted at the result (counted)
     - the ways it ends without a result: a retry (images kept), the third attempt, a lease that runs out, a day nobody's PC took it, a cancel; a late result
     - the keeping: a finished score is purged after a day (a conversion after three); a removed link takes its images; a delete that failed is found again, at the next purge and at the boot
     - the scope of a worker: a result of the wrong kind, a result for a job another token holds (a token rotated meanwhile), pages only to the claiming token, each page a few times
     - a worker that cannot read scores is never handed one; the kind switched off (PPP_OMR_JOBS=0) leaves conversions alone
     - THE FREE-TIER RULE: idle polls of a worker that can read scores run no store call; the kind costs the statements it must

   Run: node tests/home-worker/omr-flow.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req, WATCH, goodResult } = L;
const { claimOmr, ready, sendOmr, page, pageFilesIn, jobOf } = require('./omr-jobs.test.js');
const MiB = 1048576;
const DAY = 24 * 3600 * 1000;
const post = (S, token, p, body) => S.worker(token).post(p, body);
const result = (S, token, id, body) => post(S, token, '/api/worker/jobs/' + id + '/result', body);
const fail = (S, token, id, body) => post(S, token, '/api/worker/jobs/' + id + '/fail', body || { error: 'The page could not be read.' });
const beat = (S, token, id, body) => post(S, token, '/api/worker/jobs/' + id + '/heartbeat', body || { stage: 'page', pct: 0.5, page: 1 });
const view = async (S, user, id) => (await S.as(user).get('/api/jobs/' + id));
const bigXml = mb => '<score-partwise><x>' + 'a'.repeat(Math.floor(mb * MiB)) + '</x></score-partwise>';

async function lifeOfAJob() {
  heading('a score, from the page to the PC and back');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const q = await sendOmr(S, 'u1', L.omrPages(3));
    const id = q.body.job.id, tok = S.token('u1');
    const afterQueue = Object.assign({}, S.store.calls);
    ok('queuing it is ONE store call (the job and its pages in one statement)', afterQueue.insertOmrJob === 1 && !afterQueue.insertJob && pageFilesIn(S) === 3, JSON.stringify(afterQueue));
    ok('the files are the three pages; jobs.json holds no image (nothing of it in the job file)', (() => { const t = L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8'); return t.indexOf('iVBOR') < 0 && t.indexOf('base64') < 0 && t.length < 4000; })());
    const c = await claimOmr(S, tok);
    ok('claimed: attempt 1 of 3, 3 pages', c.body.job.id === id && c.body.job.attempt === 1 && c.body.job.maxAttempts === 3 && c.body.job.pages === 3 && c.body.nextPollSeconds === 15, JSON.stringify(c.body));
    ok('the page sees it "claimed", with its progress', (await view(S, 'u1', id)).body.job.status === 'claimed' && (await view(S, 'u1', id)).body.job.progress.stage === 'claimed');
    ok('a worker that fetches the pages gets all three, as uploaded (the first is the first, ...)', await (async () => {
      for (let i = 0; i < 3; i++) { const r = await page(S, tok, id, i); if (r.status !== 200 || r.headers['content-type'] !== 'image/png') return false; }
      return true;
    })());
    const hb = await beat(S, tok, id, { stage: 'page', pct: 1 / 3, page: 1 });
    const pr = (await view(S, 'u1', id)).body.job.progress;
    ok('a heartbeat tells which page the PC is on: the page shows "reading page 1 of 3"', hb.status === 200 && pr.stage === 'page' && pr.page === 1 && Math.abs(pr.pct - 0.333) < 0.001, JSON.stringify(pr));
    await beat(S, tok, id, { stage: 'page', pct: 0.5, page: 99 });
    ok('a page number past the last is not taken', (await view(S, 'u1', id)).body.job.progress.page === undefined);
    await beat(S, tok, id, { stage: '<script>', pct: 0.1, page: 2 });
    ok('a stage that is not a plain word becomes "working"', (await view(S, 'u1', id)).body.job.progress.stage === 'working');
    const calls0 = S.store.total();
    await beat(S, tok, id, { stage: 'page', pct: 0.7, page: 2 });
    ok('a heartbeat runs no store call (memory only)', S.store.total() === calls0);

    const res = await result(S, tok, id, L.omrResult(3, { two: true }));
    ok('the result is taken: 200', res.status === 200 && res.body.ok === true, res.status + ' ' + res.text);
    ok('the job is done; its page files are GONE (and the store was asked to delete them: one call)', jobOf(S, id).status === 'done' && pageFilesIn(S) === 0 && S.store.calls.deleteOmrPages === 1, S.store.calls.deleteOmrPages + ' files=' + pageFilesIn(S));
    const got = await view(S, 'u1', id);
    ok('the page opens it: the result has every page and movement, the standard DOCTYPE cut out, the engine named',
      got.status === 200 && got.body.job.status === 'done' && got.body.result.kind === 'omr' && got.body.result.engine === 'Audiveris' && got.body.result.engineVersion === '5.11.0' && got.body.result.pages.length === 3
      && got.body.result.pages.every(p => p.ok && p.movements.length === 2 && p.movements.every(m => m.indexOf('<!DOCTYPE') < 0 && m.indexOf('<score-partwise') === 0 || /^<\?xml/.test(m))), got.text.slice(0, 200));
    ok('what is stored is the result: its size is the job\'s bytes', got.body.job.bytes === jobOf(S, id).bytes && jobOf(S, id).bytes > 1000);
    ok('the PC cannot fetch a page of a finished job (409, not waiting)', (await page(S, tok, id, 0)).status === 409);
    ok('a second result for it is 409 and changes nothing', (await result(S, tok, id, L.omrResult(3))).status === 409 && jobOf(S, id).status === 'done');
    const rm = await S.as('u1').del('/api/jobs/' + id);
    ok('the page removes it once it has taken the score: 200, and the job is gone (the notes of nothing are kept)', rm.status === 200 && !jobOf(S, id) && (await view(S, 'u1', id)).status === 404);
    ok('the list of conversions never held it', (await S.as('u1').get('/api/jobs')).body.jobs.length === 0);
    ok('no log line shows an image (the service logged: ' + S.logged.length + ' lines)', S.logged.every(l => !/iVBOR|base64|\/9j\//.test(l)));
  } finally { await S.close(); }
}

async function endsWithoutAResult() {
  heading('the ways a score ends without a result');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const tok = S.token('u1');
    {
      /* a retry keeps the images; the third attempt is the last */
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 900 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const f1 = await fail(S, tok, id, { error: 'Audiveris was busy.', retry: true });
      ok('fail with retry: the job is queued again with the reason, the images are kept (the retry needs them)', f1.status === 200 && f1.body.requeued === true && jobOf(S, id).status === 'queued' && pageFilesIn(S) === 2 && S.store.calls.deleteOmrPages === undefined, JSON.stringify(f1.body));
      ok('a job given back is not handed out again at once (held 2 minutes x attempts)', (await claimOmr(S, tok)).body.job === null);
      S.advance(3 * 60 * 1000);
      const c2 = await claimOmr(S, tok);
      ok('after the wait it is handed out again: attempt 2', c2.body.job && c2.body.job.id === id && c2.body.job.attempt === 2);
      ok('and the pages are fetched again (the per-job counter starts again with the claim)', (await page(S, tok, id, 0)).status === 200);
      await fail(S, tok, id, { error: 'again', retry: true });
      S.advance(7 * 60 * 1000);
      const c3 = await claimOmr(S, tok);
      ok('attempt 3', c3.body.job && c3.body.job.attempt === 3);
      const f3 = await fail(S, tok, id, { error: 'No page could be read.', retry: true });
      ok('a retry asked for after the third attempt is a failure: failed for good, the images deleted', f3.status === 200 && f3.body.requeued !== true && jobOf(S, id).status === 'failed' && pageFilesIn(S) === 0 && jobOf(S, id).error === 'No page could be read.', JSON.stringify(f3.body));
      ok('the page sees the reason', (await view(S, 'u1', id)).body.job.error === 'No page could be read.' && (await view(S, 'u1', id)).body.job.status === 'failed');
    }
    {
      /* no retry */
      const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 901 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const f = await fail(S, tok, id, { error: 'No musical notation was detected on this page.' });
      ok('a failure with no retry: failed at once, the images deleted', f.status === 200 && jobOf(S, id).status === 'failed' && pageFilesIn(S) === 0);
      await S.as('u1').del('/api/jobs/' + id);
    }
    {
      /* a lease that runs out */
      S.advance(2 * 3600 * 1000);
      const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 902 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      S.advance(31 * 60 * 1000);
      await S.as('u1').get('/api/jobs');
      ok('a PC that was not heard of for 30 minutes gives the job back (the images are still there)', jobOf(S, id).status === 'queued' && pageFilesIn(S) === 1 && jobOf(S, id).attempts === 1);
      S.advance(5 * 60 * 1000);
      await claimOmr(S, tok); S.advance(31 * 60 * 1000); await S.as('u1').get('/api/jobs');
      S.advance(10 * 60 * 1000);
      await claimOmr(S, tok); S.advance(31 * 60 * 1000); await S.as('u1').get('/api/jobs');
      ok('after the third lease that ran out it is failed, and the images go with it', jobOf(S, id).status === 'failed' && /did not finish/.test(jobOf(S, id).error) && pageFilesIn(S) === 0, jobOf(S, id).status + ' ' + pageFilesIn(S));
      await S.as('u1').del('/api/jobs/' + id);
    }
    {
      /* nobody's PC took it for a day */
      S.advance(2 * 3600 * 1000);
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 903 }));
      const id = q.body.job.id;
      S.advance(DAY - 60 * 1000);
      await S.as('u1').get('/api/jobs');
      ok('a score still waiting just under a day is still waiting', jobOf(S, id).status === 'queued' && pageFilesIn(S) === 2);
      S.advance(2 * 60 * 1000);
      await S.as('u1').get('/api/jobs');
      ok('a day with no PC taking it: expired, and the images are deleted (a conversion waits three days)', jobOf(S, id).status === 'expired' && pageFilesIn(S) === 0 && /No PC picked this up/.test(jobOf(S, id).error), jobOf(S, id).status);
      ok('and a conversion of a link waits longer: still queued after the same day', await (async () => {
        const y = await S.as('u1').post('/api/jobs', { url: WATCH('bbbbbbbbbbb') });
        S.advance(DAY + 60 * 1000);
        await S.as('u1').get('/api/jobs');
        const st = S.svc._state.jobs.get(y.body.job.id).status;
        return y.status === 201 && st === 'queued';
      })());
    }
    {
      /* cancelled while the PC is reading it */
      const w = await S.as('u1').get('/api/jobs');
      for (const j of w.body.jobs) await S.as('u1').post('/api/jobs/' + j.id + '/cancel', {});
      S.advance(2 * 3600 * 1000);
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 904 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      const cx = await S.as('u1').post('/api/jobs/' + id + '/cancel', {});
      ok('cancelled while claimed: 200, the images deleted at once', cx.status === 200 && cx.body.job.status === 'cancelled' && pageFilesIn(S) === 0);
      const hb = await beat(S, tok, id);
      ok('the PC\'s next heartbeat says cancelled (it kills the engine)', hb.status === 200 && hb.body.cancelled === true);
      ok('its result is refused: 409 cancelled; its next page fetch too', (await result(S, tok, id, L.omrResult(2))).body.code === 'cancelled' && (await page(S, tok, id, 0)).status === 409);
      ok('a cancel of a cancelled job is the same job (200)', (await S.as('u1').post('/api/jobs/' + id + '/cancel', {})).status === 200);
    }
    {
      /* a result that comes late: the job went back to the queue */
      S.advance(2 * 3600 * 1000);
      const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 905 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      S.advance(31 * 60 * 1000);
      await S.as('u1').get('/api/jobs');
      ok('(the job went back to the queue)', jobOf(S, id).status === 'queued');
      const late = await result(S, tok, id, L.omrResult(1));
      ok('a result from the PC that was slow is still taken (first result wins), and the images go', late.status === 200 && jobOf(S, id).status === 'done' && pageFilesIn(S) === 0, late.status + ' ' + late.text);
    }
  } finally { await S.close(); }
}

async function keeping() {
  heading('the keeping time: a finished score a day, a removed link at once, a delete that failed is found again');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const mk = async (n, w) => { const q = await sendOmr(S, 'u1', L.omrPages(n, { w: w })); const c = await claimOmr(S, tok); await result(S, tok, c.body.job.id, L.omrResult(n)); return q.body.job.id; };
      const scoreId = await mk(1, 800);
      const y = await S.as('u1').post('/api/jobs', { url: WATCH('ccccccccccc') });
      const yc = await S.worker(tok).post('/api/worker/claim', { once: true, omr: true });
      await S.worker(tok).post('/api/worker/jobs/' + yc.body.job.id + '/result', goodResult(40));
      S.advance(DAY - 60 * 1000);
      await S.svc._state.purge(S.clock.t);
      ok('just under a day: the finished score is still there', !!jobOf(S, scoreId));
      S.advance(2 * 60 * 1000);
      await S.svc._state.purge(S.clock.t);
      ok('a day and a minute: the finished score is purged (and so would be its image rows: none), the conversion of the same age is kept (three days)', !jobOf(S, scoreId) && !!jobOf(S, y.body.job.id), String(!!jobOf(S, scoreId)));
      ok('what is purged cannot be read: 404', (await view(S, 'u1', scoreId)).status === 404);
      S.advance(3 * DAY);
      await S.svc._state.purge(S.clock.t);
      ok('three days on, the conversion goes too', !jobOf(S, y.body.job.id));
    } finally { await S.close(); }
  }
  {
    /* removing the link takes the images */
    const S = await L.startService({ users: ['u1', 'u2'] });
    try {
      await ready(S, 'u1'); await ready(S, 'u2');
      await sendOmr(S, 'u1', L.omrPages(3, { w: 800 }));
      await sendOmr(S, 'u2', L.omrPages(2, { w: 810 }));
      ok('(five page files for two links)', pageFilesIn(S) === 5);
      const rm = await S.as('u1').del('/api/pc-links/me');
      ok('removing a link removes its waiting scores and their images; the other link keeps its own', rm.status === 200 && pageFilesIn(S) === 2 && S.svc._state.jobs.size === 1, rm.status + ' ' + pageFilesIn(S));
      ok('the removed link\'s code and token are dead', (await S.as('u1').get('/api/jobs')).status === 401 && (await claimOmr(S, S.token('u1'))).status === 401);
    } finally { await S.close(); }
  }
  {
    /* a delete that fails: the job is done; the images are found again at the next purge, and at a boot */
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 820 }));
      const id = q.body.job.id;
      await claimOmr(S, tok);
      S.store.fail.on = true; S.store.fail.only = 'deleteOmrPages';
      const r = await result(S, tok, id, L.omrResult(2));
      S.store.fail.on = false;
      ok('the result is taken although the delete of the images failed (the job is done; the failure is logged once)', r.status === 200 && jobOf(S, id).status === 'done' && pageFilesIn(S) === 2 && S.logged.length >= 1, r.status + ' ' + pageFilesIn(S) + ' logged=' + S.logged.length);
      S.advance(7 * 3600 * 1000);
      await S.svc._state.purge(S.clock.t);
      ok('the next purge deletes them', pageFilesIn(S) === 0 && jobOf(S, id).status === 'done');
      /* a restart that finds a finished job with images */
      const q2 = await sendOmr(S, 'u1', L.omrPages(2, { w: 821 }));
      const id2 = q2.body.job.id;
      await claimOmr(S, tok);
      S.store.fail.on = true; S.store.fail.only = 'deleteOmrPages';
      await result(S, tok, id2, L.omrResult(2));
      S.store.fail.on = false;
      ok('(again: done, two files left)', pageFilesIn(S) === 2);
      const S2 = await L.startService({ store: S.inner, resume: S.creds() });
      try {
        S2.clock.t = S.clock.t;
        const st = await S2.as('u1').get('/api/jobs');
        ok('a restart that reads a finished job that still holds images deletes them with its boot read', st.status === 200 && pageFilesIn(S) === 0, st.status + ' files=' + pageFilesIn(S));
      } finally { await S2.close(); }
    } finally { await S.close(); }
  }
}

async function scopeOfAWorker() {
  heading('what a worker token may do with a score');
  const S = await L.startService({ users: ['u1', 'u2'], config: { omrPageReadsPerHour: 6 } });
  try {
    await ready(S, 'u1'); await ready(S, 'u2');
    const tok = S.token('u1');
    /* kinds */
    const y = await S.as('u1').post('/api/jobs', { url: WATCH('ddddddddddd') });
    const yc = await S.worker(tok).post('/api/worker/claim', { once: true });
    ok('a conversion is handed to a worker that is not for scores too (it never needed omr: true)', yc.body.job && yc.body.job.id === y.body.job.id && yc.body.job.kind === 'youtube');
    const asScore = await result(S, tok, y.body.job.id, L.omrResult(1));
    ok('a result of pages posted for a conversion is 422 (a conversion takes notes), and it stays claimed', asScore.status === 422 && jobOf(S, y.body.job.id).status === 'claimed', asScore.status + ' ' + asScore.text);
    ok('a conversion has no pages to fetch: 404', (await page(S, tok, y.body.job.id, 0)).status === 404);
    await result(S, tok, y.body.job.id, goodResult(30));
    await ready(S, 'u1');      /* (that claim did not say omr: true, so the site took the worker for one that cannot) */
    const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 700 }));
    const id = q.body.job.id;
    await claimOmr(S, tok);
    const notes = await result(S, tok, id, goodResult(30));
    ok('notes posted for a score are 422 (a score takes pages), and it stays claimed with its images', notes.status === 422 && jobOf(S, id).status === 'claimed' && pageFilesIn(S) === 2, notes.status + ' ' + notes.text);
    ok('a result with the wrong number of pages is 422 (2 for a job of 3 is the same rule)', (await result(S, tok, id, L.omrResult(3))).status === 422 && (await result(S, tok, id, L.omrResult(1))).status === 422);
    ok('a result in which nothing was read is 422 nothing-read: the PC says fail instead', (await result(S, tok, id, L.omrResult(2, { failed: [0, 1] }))).body.code === 'nothing-read');
    const bomb = L.omrResult(2);
    bomb.pages[0].movements = ['<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><score-partwise>&b;</score-partwise>'];
    const b = await result(S, tok, id, bomb);
    ok('a document with entities (a billion laughs) is 422 bad-xml, and nothing of it is kept', b.status === 422 && b.body.code === 'bad-xml' && jobOf(S, id).status === 'claimed');
    const huge = await post(S, tok, '/api/worker/jobs/' + id + '/result', { pages: [{ index: 0, ok: true, movements: ['A'.repeat(6 * MiB)] }, { index: 1, ok: false }] });
    ok('a body of 6 MB is 413 (the result body is capped: 5 MB), and nothing of it is stored', huge.status === 413 && jobOf(S, id).status === 'claimed', huge.status + '');
    const tooBig = L.omrResult(2);
    tooBig.pages[0].movements = [bigXml(2.9)]; tooBig.pages[1].movements = [bigXml(2.9)];
    const tb = await result(S, tok, id, tooBig);
    ok('5.8 MB of notation is 422 too-large (a result is 4 MB at the most)', tb.status === 422 && tb.body.code === 'too-large' || tb.status === 413, tb.status + ' ' + tb.text.slice(0, 100));

    /* the pages of a job go to the token that claimed it, a few times each */
    ok('a page is fetched 3 times at most per claim: the 4th read of one page is 429 (the other page is still there)', await (async () => {
      const st = [];
      for (let i = 0; i < 3; i++) st.push((await page(S, tok, id, 0)).status);
      st.push((await page(S, tok, id, 0)).status);
      return st.join() === '200,200,200,429';
    })());
    ok('(the other page is still fetchable, and the counter is per page)', (await page(S, tok, id, 1)).status === 200 && jobOf(S, id).pageReads[0] === 4 && jobOf(S, id).pageReads[1] === 1, JSON.stringify(jobOf(S, id).pageReads));
  } finally { await S.close(); }

  {
    const S = await L.startService({ users: ['u1'], config: { omrPageReadsPerHour: 4 } });
    try {
      await ready(S, 'u1');
      const tok = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 710 }));
      await claimOmr(S, tok);
      const id = q.body.job.id;
      const st = [];
      for (let i = 0; i < 6; i++) st.push((await page(S, tok, id, i % 2)).status);
      ok('a token may fetch only so many pages an hour (4 here): then 429 whatever the job', st.join() === '200,200,200,200,429,429', st.join());
      S.advance(3600 * 1000 + 1000);
      ok('an hour later the budget of the token is back: it may fetch again', (await page(S, tok, id, 0)).status === 200);
    } finally { await S.close(); }
  }
  {
    /* a token that is not the one that holds the claim: the link's token was replaced while the PC was reading */
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      const a = S.token('u1');
      const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 720 }));
      const id = q.body.job.id;
      await claimOmr(S, a);
      const rot = await S.as('u1').post('/api/pc-links/me/worker-token', {});
      const b = rot.body.workerToken;
      ok('(the token was replaced: 201, a new one)', rot.status === 201 && b && b !== a);
      ok('the old token is dead at once: 401 on every route', (await page(S, a, id, 0)).status === 401 && (await result(S, a, id, L.omrResult(2))).status === 401 && (await beat(S, a, id)).status === 401);
      const rb = await result(S, b, id, L.omrResult(2));
      ok('the new token of the SAME link cannot finish a job the old one holds: 409 not-yours, nothing stored', rb.status === 409 && rb.body.code === 'not-yours' && jobOf(S, id).status === 'claimed' && pageFilesIn(S) === 2, rb.status + ' ' + rb.text);
      ok('nor fetch its pages, beat for it, or fail it: 409 each', (await page(S, b, id, 0)).status === 409 && (await beat(S, b, id)).status === 409 && (await fail(S, b, id)).status === 409);
      S.advance(31 * 60 * 1000);
      await S.as('u1').get('/api/jobs');
      const again = await claimOmr(S, b);
      ok('when the lease runs out the job goes back to the queue and the new token takes it (attempt 2), then finishes it', again.body.job && again.body.job.id === id && again.body.job.attempt === 2 && (await result(S, b, id, L.omrResult(2))).status === 200 && pageFilesIn(S) === 0);
    } finally { await S.close(); }
  }
}

async function whoIsHandedWhat() {
  heading('a worker that cannot read scores is never handed one; the kind can be switched off');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const tok = S.token('u1');
    const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 730 }));
    const y = await S.as('u1').post('/api/jobs', { url: WATCH('eeeeeeeeeee') });
    const plain = await S.worker(tok).post('/api/worker/claim', { once: true, song: true });
    ok('a worker that does not say omr: true is handed the CONVERSION, not the score that was queued first', plain.body.job && plain.body.job.id === y.body.job.id && plain.body.job.kind === 'youtube', JSON.stringify(plain.body));
    const noOmr = await S.worker(tok).post('/api/worker/claim', { once: true, song: true, omr: false });
    ok('and, with nothing else waiting, it is told there is nothing (the score waits: for a day, then expires)', noOmr.body.job === null && jobOf(S, q.body.job.id).status === 'queued');
    ok('omr: "true" (a string) is not omr: true', (await S.worker(tok).post('/api/worker/claim', { once: true, omr: 'true' })).body.job === null && (await S.worker(tok).post('/api/worker/claim', { once: true, omr: 1 })).body.job === null);
    const got = await claimOmr(S, tok);
    ok('with omr: true it is handed out', got.body.job && got.body.job.id === q.body.job.id);

    /* the kind switched off: a restart with PPP_OMR_JOBS=0 over the same store */
    await S.as('u1').post('/api/jobs/' + q.body.job.id + '/cancel', {});
    const q2 = await sendOmr(S, 'u1', L.omrPages(1, { w: 731 }));
    const S2 = await L.startService({ store: S.inner, resume: S.creds(), env: { PPP_OMR_JOBS: '0' } });
    try {
      S2.clock.t = S.clock.t;
      const off = await S2.as('u1').post('/api/jobs/omr', { pages: L.omrPages(1, { w: 732 }) });
      ok('PPP_OMR_JOBS=0: a new score is 503 omr-off', off.status === 503 && off.body.code === 'omr-off', off.status + ' ' + off.text);
      ok('the status says omrMode "off" (not false: the PC is able, the site is not), so the page does not offer it and says why', (await S2.as('u1').get('/api/worker/status')).body.worker.omrMode === 'off');
      const claim = await S2.worker(S2.token('u1')).post('/api/worker/claim', { once: true, omr: true });
      ok('a worker with omr: true is not handed the score that was waiting', claim.status === 200 && claim.body.job === null && S2.svc._state.jobs.get(q2.body.job.id).status === 'queued');
      const yt = await S2.as('u1').post('/api/jobs', { url: WATCH('fffffffffff') });
      const yc = await S2.worker(S2.token('u1')).post('/api/worker/claim', { once: true, omr: true });
      ok('conversions of YouTube links are untouched: queued and handed out', yt.status === 201 && yc.body.job && yc.body.job.id === yt.body.job.id);
      ok('and the list of conversions is as ever: the conversions, no score', (await S2.as('u1').get('/api/jobs')).body.jobs.every(j => j.kind === 'youtube') && (await S2.as('u1').get('/api/jobs')).body.jobs.some(j => j.id === yt.body.job.id));
    } finally { await S2.close(); }
  } finally { await S.close(); }
}

async function freeTier() {
  heading('the free-tier rule: idle polls of a worker that can read scores run no store call');
  const S = await L.startService({ users: ['u1'] });
  try {
    const tok = S.token('u1');
    await claimOmr(S, tok);      /* the cold first poll: the boot read and the last-seen write */
    S.store.reset();
    for (let i = 0; i < 60; i++) { S.advance(60 * 60 * 1000); await claimOmr(S, tok, { waitSeconds: 3600 }); }
    ok('60 idle polls over 60 hours, each saying omr: true: ZERO store calls', S.store.total() === 0, JSON.stringify(S.store.calls));
    const last = await claimOmr(S, tok);
    ok('each is told to wait an hour', last.body.nextPollSeconds === 3600, JSON.stringify(last.body));
    await S.as('u1').get('/api/worker/status'); await S.as('u1').get('/api/jobs');
    ok('and the page\'s status and list reads run none either (the link\'s use is written at most every six hours)', S.store.total() <= 1, JSON.stringify(S.store.calls));
    S.store.reset();
    const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 740 }));
    ok('asking for a score costs one statement: the job and its pages (and nothing else: no purge ran with nothing to purge)', S.store.calls.insertOmrJob === 1 && S.store.total() <= 3, JSON.stringify(S.store.calls));
    S.store.reset();
    const c = await claimOmr(S, tok);
    ok('the claim is one write (the state change); the long wait before it ran none', S.store.calls.claimJob === 1 && S.store.total() <= 2, JSON.stringify(S.store.calls));
    ok('and the worker is told to come back in 15 s while it has something to do', c.body.nextPollSeconds === 15);
    S.store.reset();
    await page(S, tok, q.body.job.id, 0); await page(S, tok, q.body.job.id, 1);
    ok('a page read is one store call each (it reads the image from the database, nothing else)', S.store.calls.getOmrPage === 2 && S.store.total() === 2, JSON.stringify(S.store.calls));
    S.store.reset();
    await beat(S, tok, q.body.job.id); await beat(S, tok, q.body.job.id);
    ok('heartbeats run none', S.store.total() === 0);
    await result(S, tok, q.body.job.id, L.omrResult(2));
    ok('the result is a write of the job and the delete of its images', S.store.calls.finishJob === 1 && S.store.calls.deleteOmrPages === 1, JSON.stringify(S.store.calls));
  } finally { await S.close(); }
  /* two claims at the same moment for one waiting score: one wins */
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      await ready(S, 'u1');
      await sendOmr(S, 'u1', L.omrPages(1, { w: 750 }));
      const claims = await Promise.all(Array.from({ length: 8 }, () => claimOmr(S, S.token('u1'))));
      ok('eight claims at once for one waiting score: exactly one is handed it', claims.filter(r => r.body.job).length === 1 && claims.every(r => r.status === 200), claims.map(r => r.body.job ? 'job' : 'none').join());
    } finally { await S.close(); }
  }
}

/* a waiting score whose images are gone (lost by a restore, a manual delete): nothing can read it, so it is failed with a sentence instead of waiting a day for a PC */
async function aScoreWithNoImages() {
  heading('a waiting score whose images are not there');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const q = await sendOmr(S, 'u1', L.omrPages(2, { w: 770 }));
    const id = q.body.job.id;
    L.fs.readdirSync(L.path.join(S.dir, 'omr-pages')).forEach(f => L.fs.unlinkSync(L.path.join(S.dir, 'omr-pages', f)));
    const S2 = await L.startService({ store: S.inner, resume: S.creds() });
    try {
      S2.clock.t = S.clock.t;
      const list = await S2.as('u1').get('/api/jobs');
      ok('a score whose page files are gone is failed by the first look at the queue, with a sentence that says to send it again', list.status === 200 && S2.svc._state.jobs.get(id).status === 'failed' && /images of this job are gone/.test(S2.svc._state.jobs.get(id).error), JSON.stringify(S2.svc._state.jobs.get(id)).slice(0, 160));
      ok('and a PC is not handed it', (await claimOmr(S2, S2.token('u1'))).body.job === null);
    } finally { await S2.close(); }
  } finally { await S.close(); }
}

async function resultsAndTheirQuota() {
  heading('a finished score counts among the link\'s notes: the oldest finished one makes room');
  const S = await L.startService({ users: ['u1'] });
  try {
    await ready(S, 'u1');
    const tok = S.token('u1');
    const ids = [];
    for (let i = 0; i < 4; i++) {
      S.advance(5 * 60 * 1000);
      const q = await sendOmr(S, 'u1', L.omrPages(1, { w: 760 + i }));
      if (q.status !== 201) { ids.push(null); continue; }
      const c = await claimOmr(S, tok);
      const r = L.omrResult(1);
      r.pages[0].movements = [bigXml(2.9)];
      const posted = await result(S, tok, c.body.job.id, r);
      ids.push(posted.status === 200 ? c.body.job.id : 'refused ' + posted.status + ' ' + posted.text.slice(0, 80));
    }
    ok('four scores of 2.9 MB each are all taken (the share of a link is 8 MB: the oldest finished ones are cleared to make room, never refused)', ids.every(x => /^[A-Za-z0-9_-]{16}$/.test(x)), JSON.stringify(ids));
    const held = Array.from(S.svc._state.jobs.values()).filter(j => j.status === 'done').length;
    ok('and at most two of them are still held (2 x 2.9 MB under 8 MB; three would be 8.7)', held === 2, 'held ' + held);
    ok('the oldest finished are gone, the newest two are there', !jobOf(S, ids[0]) && !jobOf(S, ids[1]) && !!jobOf(S, ids[2]) && !!jobOf(S, ids[3]));
  } finally { await S.close(); }
}

(async () => {
  await lifeOfAJob();
  await endsWithoutAResult();
  await keeping();
  await scopeOfAWorker();
  await whoIsHandedWhat();
  await freeTier();
  await resultsAndTheirQuota();
  await aScoreWithNoImages();
  L.finish('the home-PC queue, kind omr: the life of a job and the scope of a worker');
})().catch(e => { console.error(e); process.exit(1); });
