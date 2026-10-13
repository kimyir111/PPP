/* ============================================================================
   G12-5: the page's PC path for a printed score (docs/GOALS/G12_OMR.md section 24), in the real page against the real server (tests/serve-free.js), with a FAKE WORKER (this file, over
   the worker's own HTTP routes): no engine, no PC.

   What it pins:
     - the gate: PPP.omr = 'v2' AND a PC link AND no local helper. 'legacy' (the default), a device with no link, and a link whose PC has not connected or cannot read scores make NO request
       to the score queue and import what they imported before
     - the flow: the pages are sent (one POST /api/jobs/omr with this device's code), the screen says it is waiting, then "reading page n of N" (what the PC's heartbeat says), then the
       result goes through the same import as a helper's (omr/normalize.js, the ScoreGraph, the flags), the review opens, and the score is removed from the site
     - the way out: "Use the draft instead" (the job is cancelled on the site, the draft is made and the review SAYS why), Cancel (the job is cancelled), a PC that fails (the line it gave is shown),
       a PC that is not on (the hint appears)
     - the pages that are sent: a big photo is re-encoded (JPEG) to fit 1.5 MB and 3500 px, a job of more than 12 pages asks for "large", the PNG of a clean page goes as it is
     - Korean: the screen, the button and the line in the review

   node tests/home-worker/omr-page.test.js   (needs puppeteer: NODE_PATH=D:/PPP/node_modules if this tree has none)
   HOME_MODULES_DIR=<dir>: serve <dir>/Piano Coach App.dc.html as the page (the mutation runner)   HOME_FAIL_FAST: stop at the first failed check */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const L = require('./lib');
const { sleep, heading, req } = L;
const ok = (name, cond, detail) => { L.ok(name, cond, detail); if (!cond && process.env.HOME_FAIL_FAST) throw new Error('stopped at the first failed check: ' + name); };
const { startServer } = require('../serve-free');
const NL = require('../omr/normalize/lib.js');
const SC = require('../omr/normalize/scenarios.js');

const PAGE_FILE = path.join(L.MODS, 'Piano Coach App.dc.html');
const KEY = 'ppp.pclink.v1';
const FIX = path.join(__dirname, '..', 'fixtures');
const PNG = path.join(FIX, 'piano-clean.png');
const PDF = path.join(FIX, 'piano-clean.pdf');
/* what the engine would write for the fixture: two staves, 4 bars */
const SCORE_XML = NL.doc([NL.part('P1', SC.series(0, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), NL.part('P2', SC.series(0, 4, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 })]);

let pageCount = 0;
/* a page in a context of its own. o: locale, store (localStorage), omr ('v2' | 'legacy' | none), hintAfterMs, pollMs */
async function openPage(browser, srv, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  const rec = { requests: [], posts: [], errors: [], pageErrors: [], bodies: [] };
  page.__rec = rec;
  await page.evaluateOnNewDocument(opts => {
    try {
      localStorage.setItem('ppp-locale', opts.locale); localStorage.setItem('ppp-guest', '1');
      if (opts.omr) localStorage.setItem('ppp.omr.v1', opts.omr);
      Object.keys(opts.store || {}).forEach(k => localStorage.setItem(k, opts.store[k]));
    } catch (e) { /* blocked */ }
  }, { locale: o.locale || 'en-US', omr: o.omr === undefined ? 'v2' : o.omr, store: o.store || {} });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url(), p = u.replace(/^https?:\/\/[^/]+/, '');
    rec.requests.push(r.method() + ' ' + p);
    if (r.method() !== 'GET' && /\/api\/(jobs|worker|pc-links)/.test(p)) { rec.posts.push({ method: r.method(), path: p }); if (r.postData()) rec.bodies.push({ path: p, body: r.postData() }); }
    if (process.env.HOME_MODULES_DIR && r.resourceType() === 'document' && r.method() === 'GET' && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) {
      return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(PAGE_FILE), headers: { 'Cache-Control': 'no-store' } });
    }
    r.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|pppworker/.test(m.text())) rec.errors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: 1100, height: 1000 });
  await page.goto('http://127.0.0.1:' + srv.port + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  if (o.hintAfterMs != null) await page.evaluate(ms => { window.PPP.PC_OMR.hintAfterMs = ms; }, o.hintAfterMs);
  if (o.pollMs) await page.evaluate(ms => { const P = window.PPP.PC_OMR.poll; P.reading = ms; P.early = ms; P.mid = ms; P.late = ms; }, o.pollMs);
  await sleep(300);
  pageCount++;
  return page;
}
const clean = p => p.__rec.errors.length === 0 && p.__rec.pageErrors.length === 0;
const errs = p => JSON.stringify(p.__rec.errors.concat(p.__rec.pageErrors));
const has = (p, sel) => p.evaluate(q => !!document.querySelector(q), sel);
const text = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const stages = p => p.evaluate(() => (window.PPP.app.state.stageLog || []).map(x => x.label));
const goAdd = async p => { await p.evaluate(() => window.PPP.app.go('upload')()); await p.waitForSelector('[data-add-file]', { timeout: 10000 }); await sleep(500); };
/* what the score queue is asked: a score uploaded, or a job of it looked at (the page's own look at the list of conversions and the one probe of a device with no link are not this feature's) */
const queueCalls = p => p.__rec.requests.filter(r => /\/api\/jobs\/omr|\/api\/jobs\/[A-Za-z0-9_-]{16}(\/|$)/.test(r));
const state = (p, key) => p.evaluate(k => window.PPP.app.state[k], key);
const waitFor = async (p, fn, arg, ms) => { const t0 = Date.now(); for (;;) { const v = await p.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > (ms || 20000)) return false; await sleep(120); } };
async function chooseFile(p, file) {
  const input = await p.$('[data-add-file]');
  await input.uploadFile(file);
}

let linkNo = 0;
/* a PC link of the site; the worker said omr: true (seen) or nothing (never seen) */
async function mkLink(srv, how) {
  const r = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '10.77.' + (++linkNo) + '.1' });
  const token = r.body.workerToken, code = r.body.clientCode;
  if (how === 'able') await req(srv.port, 'POST', '/api/worker/claim', { token: token, body: { once: true, omr: true } });
  else if (how === 'unable') await req(srv.port, 'POST', '/api/worker/claim', { token: token, body: { once: true } });
  return { code: code, token: token };
}
const storeOf = code => ({ [KEY]: JSON.stringify({ v: 1, code: code }) });
/* the fake worker: one claim, the pages fetched, and what the test says to do with them */
const W = {
  claim: async A => (await req(L.__port, 'POST', '/api/worker/claim', { token: A.token, body: { once: true, omr: true } })).body.job,
  page: (A, id, i) => req(L.__port, 'GET', '/api/worker/jobs/' + id + '/pages/' + i, { token: A.token }),
  beat: (A, id, page, pct) => req(L.__port, 'POST', '/api/worker/jobs/' + id + '/heartbeat', { token: A.token, body: { stage: 'page', pct: pct, page: page } }),
  done: (A, id, n, xml) => req(L.__port, 'POST', '/api/worker/jobs/' + id + '/result', { token: A.token, body: { engine: 'Audiveris', engineVersion: '5.11.0', ms: 4200, pages: Array.from({ length: n }, (_, i) => ({ index: i, ok: true, ms: 2000, movements: [xml || SCORE_XML] })) } }),
  fail: (A, id, why) => req(L.__port, 'POST', '/api/worker/jobs/' + id + '/fail', { token: A.token, body: { error: why } })
};
const jobsOf = A => req(L.__port, 'GET', '/api/jobs', { code: A.code });
/* the job the page queued, as the worker claims it (waits for it to be there) */
async function claimSoon(A, ms) {
  const t0 = Date.now();
  for (;;) {
    const job = await W.claim(A);
    if (job) return job;
    if (Date.now() - t0 > (ms || 15000)) return null;
    await sleep(150);
  }
}

(async () => {
  const dir = L.tmpDir('ppp-omr-page-');
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  L.__port = srv.port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=en-US'], protocolTimeout: 600000 });
  try {
    heading('the gate: legacy, no link, a PC that has not connected or cannot read scores: the queue is not asked');
    {
      const A = await mkLink(srv, 'able');
      /* legacy (the default): a link and a PC that is able, and nothing of the queue is touched */
      const legacy = await openPage(browser, srv, { omr: 'legacy', store: storeOf(A.code) });
      await goAdd(legacy);
      await chooseFile(legacy, PDF);
      await waitFor(legacy, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      ok('PPP.omr "legacy" (the default), a PC link, an able PC: the import makes no request to the score queue (/api/jobs/omr, /api/worker/*)', queueCalls(legacy).length === 0, queueCalls(legacy).join(' | '));
      ok('...and it did what it always did on a site with no helper: the browser draft', (await state(legacy, 'importSource') || {}).engine === 'pdf' || (await state(legacy, 'analysis')) === 'error', JSON.stringify(await state(legacy, 'importSource')).slice(0, 120));
      ok('no page error', clean(legacy), errs(legacy));
      await legacy.close();

      const nolink = await openPage(browser, srv, { omr: 'v2' });
      await goAdd(nolink);
      await chooseFile(nolink, PDF);
      await waitFor(nolink, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      ok('v2 with no PC link on this device: no request to the queue, the draft as ever, and no "your PC" line in the report', queueCalls(nolink).length === 0 && !((await state(nolink, 'importReport')) || { issues: [] }).issues.some(i => i.kind === 'pc-omr-fallback'), queueCalls(nolink).join(' | '));
      await nolink.close();

      const never = await mkLink(srv, 'never');
      const p1 = await openPage(browser, srv, { omr: 'v2', store: storeOf(never.code) });
      await goAdd(p1);
      await chooseFile(p1, PDF);
      await waitFor(p1, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      const rep1 = await state(p1, 'importReport');
      ok('v2, a link whose PC has never connected: nothing is queued (the status is looked at, one GET), the draft is made, and the review says why', !p1.__rec.posts.some(x => /\/api\/jobs\/omr/.test(x.path))
        && rep1 && rep1.issues.some(i => i.kind === 'pc-omr-fallback' && /has not connected yet/.test(i.message)), JSON.stringify(rep1 && rep1.issues).slice(0, 300));
      await p1.close();

      const unable = await mkLink(srv, 'unable');
      const p2 = await openPage(browser, srv, { omr: 'v2', store: storeOf(unable.code) });
      await goAdd(p2);
      await chooseFile(p2, PDF);
      await waitFor(p2, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      const rep2 = await state(p2, 'importReport');
      ok('v2, a PC whose worker has said it cannot read scores: nothing is queued; the draft says "the PPP worker on your PC cannot read scores yet: update it"',
        !p2.__rec.posts.some(x => /\/api\/jobs\/omr/.test(x.path)) && rep2 && rep2.issues.some(i => i.kind === 'pc-omr-fallback' && /cannot read scores yet/.test(i.message)), JSON.stringify(rep2 && rep2.issues).slice(0, 300));
      await p2.close();

      /* a site that has the kind switched off (PPP_OMR_JOBS=0): the status says so, the page does not queue, the draft says why */
      const offDir = L.tmpDir('ppp-omr-off-');
      const offSrv = await startServer({ env: { PPP_DATA_DIR: offDir, PPP_OMR_JOBS: '0' } });
      try {
        const lk = await req(offSrv.port, 'POST', '/api/pc-links', { body: {}, ip: '10.78.1.1' });
        await req(offSrv.port, 'POST', '/api/worker/claim', { token: lk.body.workerToken, body: { once: true, omr: true } });
        const po = await openPage(browser, offSrv, { omr: 'v2', store: storeOf(lk.body.clientCode) });
        await goAdd(po);
        await chooseFile(po, PDF);
        await waitFor(po, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
        const repOff = await state(po, 'importReport');
        ok('a site that has scores switched off (PPP_OMR_JOBS=0): nothing is queued, and the draft says "Reading scores on your PC is switched off on this site."',
          !po.__rec.posts.some(x => /\/api\/jobs\/omr/.test(x.path)) && repOff && repOff.issues.some(i => i.kind === 'pc-omr-fallback' && /switched off on this site/.test(i.message)), JSON.stringify(repOff && repOff.issues).slice(0, 300));
        await po.close();
      } finally { await offSrv.close(); L.rmDir(offDir); }
    }

    heading('the flow: sent, waiting, "reading page 1 of 1", the score, the review');
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', store: storeOf(A.code), pollMs: 400 });
      await goAdd(p);
      await chooseFile(p, PNG);
      const posted = await waitFor(p, () => true, null, 100) && await waitFor(p, () => (window.PPP.app.state.stageLog || []).some(x => /Waiting for your PC/.test(x.label)), null, 30000);
      ok('the screen says it is waiting for the PC (a stage that really is happening), and the "Use the draft instead" button is there', posted && (await has(p, '[data-pc-omr-draft]')) && (await text(p, '[data-pc-omr-draft]')) === 'Use the draft instead', JSON.stringify(await stages(p)));
      const post = p.__rec.bodies.find(b => b.path === '/api/jobs/omr');
      const body = post && JSON.parse(post.body);
      ok('one POST /api/jobs/omr: the file name without its extension as the title, one page that is the fixture\'s PNG as it is (it fits), nothing else', body && body.title === 'piano-clean' && body.pages.length === 1
        && Buffer.from(body.pages[0], 'base64').subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && Buffer.from(body.pages[0], 'base64').length < 1.5 * 1048576
        && Object.keys(body).sort().join() === 'pages,title', body && Object.keys(body).join());
      ok('and it went with this device\'s code in X-PPP-PC only (not in the body, not in the address)', post && post.body.indexOf(A.code) < 0 && !p.__rec.requests.some(r => r.indexOf(A.code) >= 0));
      const job = await claimSoon(A);
      ok('the PC\'s worker finds it: kind omr, one page, no url, the title', job && job.kind === 'omr' && job.pages === 1 && job.url === '' && job.title === 'piano-clean', JSON.stringify(job));
      const pg = await W.page(A, job.id, 0);
      ok('and the page it fetches is the one uploaded', pg.status === 200 && pg.headers['content-type'] === 'image/png' && pg.text.length > 1000);
      await W.beat(A, job.id, 1, 0.1);
      const reading = await waitFor(p, () => (window.PPP.app.state.stageLog || []).some(x => /Your PC is reading page 1 of 1/.test(x.label)), null, 15000);
      ok('the PC\'s heartbeat is shown: "Your PC is reading page 1 of 1"', !!reading, JSON.stringify(await stages(p)));
      await W.done(A, job.id, 1);
      const arrived = await waitFor(p, () => window.PPP.app.state.screen === 'review', null, 60000);
      ok('the review opens (the result went through the page\'s own import)', !!arrived, JSON.stringify(await stages(p)) + ' ' + JSON.stringify(await state(p, 'parseError')));
      const src = await state(p, 'importSource'), rep = await state(p, 'importReport');
      ok('the score is read: Audiveris on your PC is the engine, the page was read (1 of 1), 4 bars, v2\'s normaliser ran (report.normalize) and the flags ran', src && src.engine === 'Audiveris on your PC' && src.viaPc === true && src.pages.length === 1 && src.pages[0].ok
        && rep && rep.normalize && typeof rep.flagsVersion !== 'undefined' && (await p.evaluate(() => window.PPP.app.state.score.measures.length)) === 4, JSON.stringify({ src: src, flags: rep && rep.flagsVersion, fail: rep && (rep.flagsFailed || rep.normalizeFailed || rep.graphFailed) }).slice(0, 300));
      ok('its graph is the import\'s own (S4: the engine\'s beams, the kept graph)', await p.evaluate(() => { const r = window.PPPEngrave && window.PPPEngrave.app && window.PPPEngrave.app.resolveSync ? window.PPPEngrave.app.resolveSync(window.PPP.app.state.score) : null; return !r || r.via === 'live' || r.via === undefined; }));
      ok('no request went to the local helper', !p.__rec.requests.some(r => /\/helper\/omr|:8788/.test(r)));
      await sleep(500);
      const claimAgain = await W.claim(A);
      ok('and the site keeps nothing of it: the page removed the job (DELETE) - a PC asking again is told there is none', p.__rec.posts.some(x => x.method === 'DELETE' && /^\/api\/jobs\/[A-Za-z0-9_-]{16}$/.test(x.path)) && claimAgain === null && (await req(srv.port, 'GET', '/api/jobs/' + job.id, { code: A.code })).status === 404);
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('the way out: "Use the draft instead" while waiting, a PC that is not on, a PC that fails, Cancel');
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', store: storeOf(A.code), hintAfterMs: 600, pollMs: 300 });
      await goAdd(p);
      await chooseFile(p, PDF);
      await waitFor(p, () => !!document.querySelector('[data-pc-omr-draft]'), null, 30000);
      const hint = await waitFor(p, () => (window.PPP.app.state.importHints || []).join(' ').indexOf('Your PC is not on yet. Start it, or use the draft.') >= 0, null, 15000);
      ok('a PC that has not taken the score after a while: the screen says "Your PC is not on yet. Start it, or use the draft." and the button is there', !!hint && (await has(p, '[data-pc-omr-draft]')));
      await p.evaluate(() => document.querySelector('[data-pc-omr-draft]').click());
      const done = await waitFor(p, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      const rep = await state(p, 'importReport');
      ok('"Use the draft instead": the import goes on with the browser draft and the review says why (a line "Your PC did not read this score (You chose the draft.), so this is the browser draft.")', !!done && rep && rep.issues.some(i => i.kind === 'pc-omr-fallback' && /You chose the draft/.test(i.message))
        && rep.issues.some(i => i.kind === 'browser-fallback') && (await state(p, 'importSource')).engine === 'pdf', JSON.stringify(rep && rep.issues).slice(0, 300));
      ok('and the job was cancelled on the site: a PC that asks is told there is nothing, and its pages are gone', (await W.claim(A)) === null && p.__rec.posts.some(x => x.method === 'POST' && /\/cancel$/.test(x.path)));
      ok('the draft is not given as good: the confidence is capped (0.45, "poor") as for any browser draft', rep && rep.level === 'poor' && rep.confidence <= 0.45);
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', store: storeOf(A.code), pollMs: 300 });
      await goAdd(p);
      await chooseFile(p, PDF);
      const job = await claimSoon(A);
      await W.beat(A, job.id, 1, 0.2);
      await W.fail(A, job.id, 'No musical notation was detected on this page.');
      const done = await waitFor(p, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      const rep = await state(p, 'importReport');
      ok('a PC that could not read the page: its line is shown in the review ("Your PC did not read this score (Your PC could not read this score: No musical notation was detected on this page.), so this is the browser draft.")',
        !!done && rep && rep.issues.some(i => i.kind === 'pc-omr-fallback' && /could not read this score: No musical notation was detected/.test(i.message)), JSON.stringify(rep && rep.issues).slice(0, 300));
      await p.close();
    }
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', store: storeOf(A.code), pollMs: 300 });
      await goAdd(p);
      await chooseFile(p, PDF);
      await waitFor(p, () => !!document.querySelector('[data-pc-omr-draft]'), null, 30000);
      await p.evaluate(() => { [...document.querySelectorAll('button')].find(b => /^Cancel$/.test((b.innerText || '').trim())).click(); });
      await sleep(1500);
      ok('Cancel on the analysis card: the import stops, the job is cancelled on the site (a PC is told there is nothing) and the page is back at "Add"', (await W.claim(A)) === null && (await state(p, 'analysis')) === 'idle', String(await state(p, 'analysis')));
      await p.close();
    }

    heading('the pages that are sent: a big photo is re-encoded to fit; more than 12 pages ask for "large"');
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', store: storeOf(A.code), pollMs: 300 });
      const r = await p.evaluate(async () => {
        /* a noisy 3000 x 4200 picture, as a phone photo is: its PNG is far over 1.5 MB */
        const c = document.createElement('canvas'); c.width = 3000; c.height = 4200;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 3000, 4200);
        /* a band of per-pixel noise (incompressible: several MB of PNG), as the grain of a photo is */
        const band = g.createImageData(3000, 600);
        let seed = 7;
        for (let i = 0; i < band.data.length; i += 4) { seed = (seed * 1664525 + 1013904223) >>> 0; band.data[i] = seed >>> 24; band.data[i + 1] = (seed >>> 16) & 255; band.data[i + 2] = (seed >>> 8) & 255; band.data[i + 3] = 255; }
        g.putImageData(band, 0, 1000);
        const dataUrl = c.toDataURL('image/png');
        const png = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
        const cap = 1.5 * 1048576 * 0.97;
        const b64 = await window.PPP.Import.pcPageData({ dataUrl: dataUrl, width: 3000, height: 4200 }, cap);
        const bin = atob(b64.slice(0, 16));
        const img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/jpeg;base64,' + b64; });
        return { pngBytes: png, outBytes: Math.floor(b64.length * 3 / 4), jpeg: bin.charCodeAt(0) === 0xff && bin.charCodeAt(1) === 0xd8, w: img.naturalWidth, h: img.naturalHeight };
      });
      ok('a 3000 x 4200 photo whose PNG is ' + Math.round(r.pngBytes / 1048576 * 10) / 10 + ' MB goes as a JPEG of ' + Math.round(r.outBytes / 1024) + ' KB, longest side 3500 px at most', r.pngBytes > 1.5 * 1048576 && r.jpeg && r.outBytes <= 1.5 * 1048576 && Math.max(r.w, r.h) <= 3500, JSON.stringify(r));
      const small = await p.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754); g.fillStyle = '#000'; g.fillRect(100, 100, 900, 4);
        const u = c.toDataURL('image/png');
        const b64 = await window.PPP.Import.pcPageData({ dataUrl: u, width: 1240, height: 1754 }, 1.5 * 1048576);
        return b64 === u.split(',')[1];
      });
      ok('a clean page whose PNG fits is sent as the PNG it is (nothing is re-encoded)', small === true);
      const tooBig = await p.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 400; c.height = 400;
        try { await window.PPP.Import.pcPageData({ dataUrl: c.toDataURL('image/png'), width: 400, height: 400 }, 10); return 'sent'; } catch (e) { return e.code || e.message; }
      });
      ok('a page that cannot be made to fit says so (an error the import falls back from), it is never sent as it is', tooBig === 'too-large', String(tooBig));
      /* 13 pages: "large" */
      const big = await p.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 1000; c.height = 1400;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 1400); g.fillStyle = '#000'; g.fillRect(50, 60, 800, 3);
        const u = c.toDataURL('image/png');
        const pages = Array.from({ length: 13 }, () => ({ dataUrl: u, width: 1000, height: 1400 }));
        try { await window.PPP.Import.recogniseOnPc(pages, 'thirteen.pdf', null, { cancelled: false, pcDraft: true }); } catch (e) { return 'threw ' + (e.pcWhy || e.message); }
        return 'returned';
      });
      const posted13 = p.__rec.bodies.find(b => b.path === '/api/jobs/omr');
      ok('13 pages are sent in one job with "large": true (the site accepts up to 24 then)', posted13 && JSON.parse(posted13.body).large === true && JSON.parse(posted13.body).pages.length === 13, big + ' ' + (posted13 ? Object.keys(JSON.parse(posted13.body)).join() : 'no post'));
      await p.close();
    }

    heading('Korean');
    {
      const A = await mkLink(srv, 'able');
      const p = await openPage(browser, srv, { omr: 'v2', locale: 'ko-KR', store: storeOf(A.code), hintAfterMs: 400, pollMs: 300 });
      await goAdd(p);
      await chooseFile(p, PDF);
      await waitFor(p, () => !!document.querySelector('[data-pc-omr-draft]'), null, 30000);
      await waitFor(p, () => (window.PPP.app.state.importHints || []).length > 0, null, 10000);
      const ko = JSON.parse(fs.readFileSync(path.join(L.MODS, 'i18n', 'ko-KR.json'), 'utf8')).content;
      const label = await text(p, '[data-pc-omr-draft]');
      const labels = await stages(p);
      const hints = await state(p, 'importHints');
      ok('the button is "' + ko['Use the draft instead'] + '", the stage row is "' + ko['Waiting for your PC to read the pages'] + '", the hint is "' + ko['Your PC is not on yet. Start it, or use the draft.'] + '"',
        label === ko['Use the draft instead'] && labels.some(l => l === ko['Waiting for your PC to read the pages']) && hints.join(' ') === ko['Your PC is not on yet. Start it, or use the draft.'], JSON.stringify({ label: label, labels: labels, hints: hints }));
      await p.evaluate(() => document.querySelector('[data-pc-omr-draft]').click());
      await waitFor(p, () => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', null, 60000);
      const rep = await state(p, 'importReport');
      ok('and the line in the review is in Korean (the reason too)', rep && rep.issues.some(i => i.kind === 'pc-omr-fallback' && i.message === ko['Your PC did not read this score ({{why}}), so this is the browser draft.'].replace('{{why}}', ko['You chose the draft.'])), JSON.stringify(rep && rep.issues).slice(0, 300));
      await p.close();
    }
    ok('(' + pageCount + ' pages opened)', true);
  } finally {
    await browser.close().catch(() => {});
    await srv.close();
    L.rmDir(dir);
  }
  L.finish('the page: a printed score read by the person\'s own PC');
})().catch(e => { console.error(e); process.exit(1); });
