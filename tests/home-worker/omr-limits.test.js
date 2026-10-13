/* G12-5: the limits of the home-PC queue's kind 'omr' (home-jobs.js; docs/GOALS/G12_OMR.md section 24), over real HTTP with the file store and no engine: every cap has a test that goes past
   it by one, and every refusal is shown to cost nothing (nothing stored, no hourly slot kept).

     - the uploads: pages, bytes of a page and a job, pixels, what is not an image, a body over the cap, a body that announces more than it may
     - the queue: scores waiting per link (2), conversions and scores together (5), the same pages twice, a place given back by a cancel
     - an hour: 6 scores a link, 12 an address (links made from one address share it), the answer says when to come back
     - the images held: per link, per creating address, for the site; freed when a job is finished
     - uploads at the same moment (2 in the whole site), an upload that is cut off

   Run: node tests/home-worker/omr-limits.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req, WATCH } = L;
const { claimOmr, ready, sendOmr, pageFilesIn } = require('./omr-jobs.test.js');
const MiB = 1048576;

async function uploadRules() {
  heading('uploads: what is refused, with what status, and what it costs to be refused');
  const S = await L.startService({ users: ['u1', 'u2'] });
  try {
    await ready(S, 'u1');
    const noJobs = () => S.svc._state.jobs.size === 0 && pageFilesIn(S) === 0;
    const refused = async (name, body, status, code, extra) => {
      const r = await S.as('u1').post('/api/jobs/omr', body, extra);
      ok(name, r.status === status && (!code || (r.body && r.body.code === code)) && noJobs(), r.status + ' ' + r.text.slice(0, 160) + ' jobs=' + S.svc._state.jobs.size + ' files=' + pageFilesIn(S));
      return r;
    };
    await refused('no pages key: 422 no-pages', { title: 'x' }, 422, 'no-pages');
    await refused('pages: [] : 422 no-pages', { pages: [] }, 422, 'no-pages');
    await refused('pages as an object: 422 no-pages', { pages: { 0: 'x' } }, 422, 'no-pages');
    await refused('13 pages: 413 too-many-pages', { pages: L.omrPages(13) }, 413, 'too-many-pages');
    await refused('a page that is not an image: 422 bad-image', { pages: L.omrPages(1).concat([Buffer.from('hello world, this is not an image at all, no no no no no no no no no no no no no no no no no').toString('base64')]) }, 422, 'bad-image');
    await refused('a page that is a GIF: 422 bad-image', { pages: [Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400)]).toString('base64')] }, 422, 'bad-image');
    await refused('a page of 100000 x 100000 pixels: 422 image-size', { pages: [L.pngBytes(100000, 100000, 400).toString('base64')] }, 422, 'image-size');
    await refused('a page of 1.5 MB and one byte: 413 page-too-large', { pages: [L.pngBytes(1240, 1754, Math.floor(1.5 * MiB) + 1).toString('base64')] }, 413, 'page-too-large');
    await refused('twelve pages of 1.01 MB (12.1 MB): 413 job-too-large', { pages: Array.from({ length: 12 }, (_, i) => L.pngBytes(1240, 1754 - i, Math.floor(1.01 * MiB)).toString('base64')) }, 413, 'job-too-large');
    await refused('nine pages of 1.4 MB (16.8 MB as base64, over the cap of the body itself): 413 too-large', { pages: Array.from({ length: 9 }, (_, i) => L.pngBytes(1240, 1754 - i, Math.floor(1.4 * MiB)).toString('base64')) }, 413, 'too-large');
    await refused('a body that is not JSON: 400', 'not json at all', 400, null);
    await refused('a body that is a JSON array: 422 bad-body', [1, 2], 422, 'bad-body');
    await refused('a NUL in the title: 422 bad-body (the shared inspector)', { title: 'a\u0000b', pages: L.omrPages(1) }, 422, 'bad-body');
    const huge = await S.as('u1').post('/api/jobs/omr', { pages: ['A'.repeat(17 * MiB)] });
    ok('a body over the cap (17 MB): 413 too-large, nothing stored', huge.status === 413 && huge.body && huge.body.code === 'too-large' && noJobs(), huge.status + ' ' + huge.text.slice(0, 100));
    const declared = await req(S.port, 'POST', '/api/jobs/omr', { user: 'u1', headers: { 'Content-Length': String(40 * MiB), 'Content-Type': 'application/json' }, abortAfter: 1500 }).catch(e => ({ status: 0, error: String(e) }));
    ok('a body that ANNOUNCES 40 MB is refused before a byte is read (413, or the connection cut), nothing stored', (declared.status === 413 || declared.status === 0) && noJobs(), JSON.stringify(declared).slice(0, 120));
    const first = await sendOmr(S, 'u1', L.omrPages(1, { w: 1200 }));
    ok('every refusal above gave its hourly budget back: a score is accepted at the end (six an hour, a dozen refused)', first.status === 201, first.status + ' ' + first.text.slice(0, 100));
  } finally { await S.close(); }

  {
    const S = await L.startService({ users: ['w1'] });
    try {
      await ready(S, 'w1');
      const r24 = await sendOmr(S, 'w1', L.omrPages(24, { bytes: 3000 }), { large: true });
      ok('24 pages with large: true are accepted (the job holds 24 files)', r24.status === 201 && r24.body.job.pages === 24 && pageFilesIn(S) === 24, r24.status + ' ' + r24.text.slice(0, 120));
      const S2 = await L.startService({ users: ['x1'] });
      try {
        await ready(S2, 'x1');
        const r25 = await sendOmr(S2, 'x1', L.omrPages(25, { bytes: 3000 }), { large: true });
        ok('25 are not, large or not', r25.status === 413 && r25.body.code === 'too-many-pages');
        const r13 = await sendOmr(S2, 'x1', L.omrPages(13, { bytes: 3000 }));
        ok('13 without large are not either', r13.status === 413);
        ok('12 are accepted', (await sendOmr(S2, 'x1', L.omrPages(12, { bytes: 3000 }))).status === 201);
      } finally { await S2.close(); }
    } finally { await S.close(); }
  }
}

async function quotaRules() {
  heading('the queue: scores waiting');
  {
    const S = await L.startService({ users: ['a', 'b', 'c'] });
    try {
      for (const u of ['a', 'b', 'c']) await ready(S, u);
      const one = n => L.omrPages(1, { w: 1200 + n, bytes: 3000 });
      ok('two scores may wait for one link', (await sendOmr(S, 'a', one(1))).status === 201 && (await sendOmr(S, 'a', one(2))).status === 201);
      const third = await sendOmr(S, 'a', one(3));
      ok('the third is 429 queue-full, nothing stored for it', third.status === 429 && third.body.code === 'queue-full' && S.svc._state.jobs.size === 2 && pageFilesIn(S) === 2, third.status + ' ' + third.text);
      ok('another link is not touched', (await sendOmr(S, 'b', one(4))).status === 201);
      const dup = await sendOmr(S, 'b', one(4));
      ok('the same pages asked for again while they wait are the same job (200, existing), not a second', dup.status === 200 && dup.body.existing === true && S.svc._state.jobs.size === 3 && pageFilesIn(S) === 3, dup.status + ' ' + dup.text.slice(0, 100));
      const conv = await Promise.all([1, 2, 3].map(i => S.as('c').post('/api/jobs', { url: WATCH('c'.repeat(10) + i) })));
      ok('conversions and scores together are at most five waiting: three conversions and two scores are fine, a sixth thing is 429', conv.every(r => r.status === 201)
        && (await sendOmr(S, 'c', one(5))).status === 201 && (await sendOmr(S, 'c', one(6))).status === 201 && (await sendOmr(S, 'c', one(7))).status === 429);
      const mine = Array.from(S.svc._state.jobs.values()).find(j => j.ownerId === S.linkId('a'));
      const files0 = pageFilesIn(S);
      const cx = await S.as('a').post('/api/jobs/' + mine.id + '/cancel', {});
      ok('cancelling a waiting score deletes its page files at once and gives its place back', cx.status === 200 && cx.body.job.status === 'cancelled' && pageFilesIn(S) === files0 - 1 && (await sendOmr(S, 'a', one(8))).status === 201);
    } finally { await S.close(); }
  }

  heading('an hour: scores a link and an address may ask for');
  {
    const S = await L.startService({ users: [] });
    try {
      await S.makeLink('a1', { ip: '203.0.113.5' });
      await ready(S, 'a1');
      let done = 0;
      const asked = [];
      for (let i = 0; i < 8; i++) {
        const r = await sendOmr(S, 'a1', L.omrPages(1, { w: 800 + i, bytes: 2000 }));
        asked.push(r.status);
        if (r.status === 201) {
          done++;
          const c = await claimOmr(S, S.token('a1'));
          await S.worker(S.token('a1')).post('/api/worker/jobs/' + c.body.job.id + '/result', L.omrResult(1));
          await S.as('a1').del('/api/jobs/' + c.body.job.id);
        }
      }
      ok('a link may ask for six scores in an hour (finishing each); the seventh and eighth are 429 too-many', done === 6 && asked.slice(6).every(s => s === 429), JSON.stringify(asked));
      const r429 = await sendOmr(S, 'a1', L.omrPages(1, { w: 99 + 800, bytes: 2000 }));
      ok('the answer says when to come back (Retry-After) and holds nothing', r429.status === 429 && r429.body.code === 'too-many' && Number(r429.headers['retry-after']) > 0 && S.svc._state.jobs.size === 0 && pageFilesIn(S) === 0, r429.status + ' ' + r429.text);
      S.advance(3600 * 1000 + 1000);
      await ready(S, 'a1');
      ok('an hour later the same link may ask again', (await sendOmr(S, 'a1', L.omrPages(1, { w: 1000, bytes: 2000 }))).status === 201);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: [] });
    try {
      const names = [];
      for (let i = 0; i < 4; i++) { await S.makeLink('l' + i, { ip: '198.51.100.20' }); await ready(S, 'l' + i); names.push('l' + i); }
      let accepted = 0, refusal = null;
      for (let i = 0; i < 14; i++) {
        const u = names[i % 4];
        const waiting = Array.from(S.svc._state.jobs.values()).filter(j => j.ownerId === S.linkId(u) && j.status === 'queued');
        if (waiting.length >= 2) { const c = await claimOmr(S, S.token(u)); await S.worker(S.token(u)).post('/api/worker/jobs/' + c.body.job.id + '/fail', { error: 'x' }); }
        const r = await sendOmr(S, u, L.omrPages(1, { w: 700 + i, bytes: 2000 }));
        if (r.status === 201) accepted++; else if (!refusal) refusal = r.status + ' ' + r.body.code;
      }
      ok('links made from one address share its 12 scores an hour: the 13th is 429 too-many whichever link asks', accepted === 12 && refusal === '429 too-many', accepted + ' ' + refusal);
    } finally { await S.close(); }
  }

  heading('the images held: a link, an address, the site');
  {
    const S = await L.startService({ users: [], config: { omrImageBytesPerLink: 20000, omrImageBytesPerAddress: 30000, omrImageBytesTotal: 50000 } });
    try {
      for (const [n, ip] of [['p', '198.51.100.31'], ['q', '198.51.100.31'], ['r', '198.51.100.32'], ['s', '198.51.100.33'], ['t', '198.51.100.34']]) { await S.makeLink(n, { ip: ip }); await ready(S, n); }
      const kb = (n, k) => L.omrPages(1, { w: 900 + n, bytes: k * 1000, vary: false });
      ok('a link holds up to its share of images (here 20 KB): 12 KB, then 7 KB', (await sendOmr(S, 'p', kb(1, 12))).status === 201 && (await sendOmr(S, 'p', kb(2, 7))).status === 201);
      const over = await sendOmr(S, 'p', kb(3, 3));
      ok('...and the next is refused (2 jobs waiting here, so queue-full first); free one place to see the bytes rule', over.status === 429, over.status + ' ' + over.text);
      const firstJob = Array.from(S.svc._state.jobs.values()).find(j => j.ownerId === S.linkId('p') && j.bytes < 8000);
      await S.as('p').post('/api/jobs/' + firstJob.id + '/cancel', {});     /* the 7 KB one goes: 12 KB held, one place free */
      const bytesOver = await sendOmr(S, 'p', kb(4, 9));
      ok('12 KB held and 9 KB more is over 20 KB: 429 quota, and nothing stored', bytesOver.status === 429 && bytesOver.body.code === 'quota' && S.svc._state.jobs.size === 2, bytesOver.status + ' ' + bytesOver.text);
      ok('8 KB more fits exactly (12 + 8 = 20 KB, "over" is strictly more)', (await sendOmr(S, 'p', kb(5, 8))).status === 201);
      const addr = await sendOmr(S, 'q', kb(6, 12));
      ok('another link from the same address: 20 KB held by its address, 12 KB more is over 30 KB: 503 quota (the address\'s share, not the link\'s)', addr.status === 503 && addr.body.code === 'quota', addr.status + ' ' + addr.text);
      ok('a link from another address has its own share', (await sendOmr(S, 'r', kb(7, 16))).status === 201);
      const site = await sendOmr(S, 's', kb(8, 18));
      ok('the site\'s total is the last: 36 KB held, 18 KB more is over 50 KB: 503 busy', site.status === 503 && site.body.code === 'busy', site.status + ' ' + site.text);
      ok('and 14 KB fits (36 + 14 = 50)', (await sendOmr(S, 't', kb(9, 14))).status === 201);
      const c = await claimOmr(S, S.token('p'));
      await S.worker(S.token('p')).post('/api/worker/jobs/' + c.body.job.id + '/result', L.omrResult(1));
      ok('a job that is done holds none: the link may send 9 KB again (its other job holds 8 KB)', (await sendOmr(S, 'p', kb(10, 9))).status === 201);
    } finally { await S.close(); }
  }

  heading('uploads at the same moment, and an upload that is cut off');
  {
    const S = await L.startService({ users: ['u1', 'u2', 'u3'] });
    try {
      for (const u of ['u1', 'u2', 'u3']) await ready(S, u);
      const body = JSON.stringify({ title: 'slow', pages: L.omrPages(1, { w: 1000, bytes: 4000 }) });
      const open = user => new Promise((resolve, reject) => {
        const r = L.http.request({ host: '127.0.0.1', port: S.port, method: 'POST', path: '/api/jobs/omr', agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-PPP-PC': S.code(user) } }, res => {
          const ch = [];
          res.on('data', c => ch.push(c));
          res.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch (e) { b = null; } r.__res({ status: res.statusCode, body: b }); });
        });
        r.__done = new Promise(res => { r.__res = res; });
        r.on('error', e => { r.__res({ status: 0, error: String(e) }); });
        r.write(body.slice(0, 50));
        setTimeout(() => resolve(r), 120);
        void reject;
      });
      const s1 = await open('u1'), s2 = await open('u2');
      const third = await sendOmr(S, 'u3', L.omrPages(1, { w: 1100 }));
      ok('two uploads in flight: a third is 503 busy with a Retry-After', third.status === 503 && third.body.code === 'busy' && Number(third.headers['retry-after']) > 0, third.status + ' ' + third.text);
      s1.end(body.slice(50)); s2.end(body.slice(50));
      const [d1, d2] = await Promise.all([s1.__done, s2.__done]);
      ok('the two that were in flight finish and are queued', d1.status === 201 && d2.status === 201, JSON.stringify([d1.status, d2.status]));
      ok('and, once they are done, the third gets in - the refusal cost it no hourly slot', (await sendOmr(S, 'u3', L.omrPages(1, { w: 1100 }))).status === 201);
      const s4 = await open('u1');
      s4.destroy();
      await sleep(250);
      ok('an upload that is cut off in the middle stores nothing and gives its place back', S.svc._state.jobs.size === 3 && pageFilesIn(S) === 3);
      const again = await Promise.all([(async () => { const c = await claimOmr(S, S.token('u1')); await S.worker(S.token('u1')).post('/api/worker/jobs/' + c.body.job.id + '/fail', { error: 'x' }); return (await sendOmr(S, 'u1', L.omrPages(1, { w: 1301 }))).status; })(), sendOmr(S, 'u2', L.omrPages(1, { w: 1300 })).then(r => r.status)]);
      ok('(the places are free: two more go through)', again.every(s => s === 201), JSON.stringify(again));
    } finally { await S.close(); }
  }
}

(async () => {
  await uploadRules();
  await quotaRules();
  L.finish('the home-PC queue, kind omr: limits');
})().catch(e => { console.error(e); process.exit(1); });
