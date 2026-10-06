/* ============================================================================
   G10b-1: "High-quality (my PC)" in the real page, against the real server (tests/serve-free.js, a data directory of its own, real sign-up
   cookies). The test plays the worker's part with plain HTTP calls (claim, heartbeat, result) - tests/home-worker/worker.test.js has the real
   worker - so what is checked here is the PAGE: when the button shows, what it sends, the list, what a reload keeps, Open writing the score from
   the PC's notes (v2 or classic), the review screen's words, saving, and that nothing changes for anyone who has no PC.

     - no PC (a guest, an account with no token, a token never seen, 'Full song' mode): no button, no note, no list; a guest never asks the server
       about jobs; the Add-sheet-music card is identical to the card of the commit before this change, tag for tag
     - a connected PC: the button beside "Make sheet music", the honest note (about every 20 minutes, must be on), the list (waiting, converting
       with its percentage, ready with Open, failed with its reason, cancelled), Cancel, a list that survives a reload, a second account that sees none of it
     - Open: the heard object is the one the review screen expects (qualityTier 'local-piano-ensemble', the ensemble summary, no pedal, no beats),
       the review says "Piano ensemble on your PC" and shows the models' agreement, no "less precise fallback" warning, v2 writes the notation when v2
       is selected and the classic conversion when it is not, "Write again" and "Play as recorded" have their notes, Accept keeps the song
     - Settings > Connect my PC: the token is shown once, a reload does not show it again, it can be removed
     - the polling: a timer only while something is waiting or converting
     - Korean, Japanese and Chinese: the button, the note and the statuses are in those languages

   node tests/home-worker/page.test.js   (needs puppeteer: NODE_PATH=D:/PPP/node_modules if this tree has none) */
'use strict';
const puppeteer = require('puppeteer');
const { execFileSync } = require('child_process');
const { startServer } = require('../serve-free');
const { preparePage } = require('../boot');
const F = require('../recording-v2-fixtures');
const L = require('./lib');
const { ok, sleep, heading, req } = L;
const path = require('path');
const fs = require('fs');

const YT = 'https://www.youtube.com/watch?v=vgnliVjJUOo';
const WAV = (() => {
  const n = 800, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); buf.fill(128, 44);
  return buf;
})();

/* a page in a context of its own (its own localStorage and cookies). o.store: localStorage before the page runs; o.baseHtml: serve this as the page (a past version) */
async function openPage(browser, base, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  await preparePage(page);
  if (o.guest === false) await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ppp-guest'); } catch (e) {} });
  if (o.locale) await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); } catch (e) {} }, o.locale);
  if (o.store) await page.evaluateOnNewDocument(st => { try { Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); } catch (e) {} }, o.store);
  const rec = { requests: [], posts: [], consoleErrors: [], pageErrors: [], audio: 0 };
  page.__rec = rec;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url(), p = u.replace(/^https?:\/\/[^/]+/, '');
    rec.requests.push(r.method() + ' ' + p);
    if (r.method() !== 'GET' && /\/api\/(jobs|worker)/.test(p)) rec.posts.push({ method: r.method(), path: p, body: r.postData() });
    if (/:8788\/|\/helper(\/|$|\?)/.test(u)) return r.abort();
    if (/\/api\/youtube-audio/.test(p)) { rec.audio++; return r.respond({ status: 200, contentType: 'audio/wav', body: WAV, headers: { 'Cache-Control': 'no-store' } }); }
    if (/\/api\/youtube-title/.test(p)) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Teacher Piece' }) });
    if (/youtube\.com\/oembed/.test(u)) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Teacher Piece' }) });
    if (o.baseHtml && /^\/(Piano%20Coach%20App\.dc\.html)?(\?|$)/.test(p) && r.method() === 'GET' && (r.resourceType() === 'document')) return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: o.baseHtml, headers: { 'Cache-Control': 'no-store' } });
    r.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) rec.consoleErrors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: 1100, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  await sleep(300);
  return page;
}
const clean = page => page.__rec.pageErrors.length === 0 && page.__rec.consoleErrors.length === 0;
const errs = page => JSON.stringify(page.__rec.pageErrors.concat(page.__rec.consoleErrors));
const goAdd = async page => { await page.evaluate(() => window.PPP.app.go('upload')()); await page.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(500); };
const goSettings = async page => { await page.evaluate(() => window.PPP.app.go('settings')()); await sleep(900); };
const has = (page, sel) => page.evaluate(q => !!document.querySelector(q), sel);
const text = (page, sel) => page.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const signUp = async (page, email) => {
  const st = await page.evaluate(async e => (await fetch('/api/auth/signup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'longenough1', displayName: 'Piano ' + e.split('@')[0] }) })).status, email);
  if (st !== 201) throw new Error('sign-up ' + st);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app && window.PPP.app.state.user), { timeout: 20000 });
  await sleep(500);
};
const typeLink = async (page, url) => {
  await page.evaluate(() => { const i = document.querySelector('[data-youtube-url]'); i.value = ''; });
  await page.type('[data-youtube-url]', url);
  await page.evaluate(() => { const i = document.querySelector('[data-youtube-url]'); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(250);
};
const refresh = async (page, withTokens) => { await page.evaluate(w => window.PPP.app.homeRefresh(w), !!withTokens); await sleep(500); };

(async () => {
  const dir = L.tmpDir('ppp-hw-page-');
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  const base = srv.url;
  const port = srv.port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  const cookieOf = async page => (await page.cookies()).map(c => c.name + '=' + c.value).join('; ');
  try {
    heading('nobody with a PC sees anything of it');
    const guest = await openPage(browser, base);
    await goAdd(guest);
    ok('a guest: no button, no note, no list, no Settings card', !(await has(guest, '[data-home-pc]')) && !(await has(guest, '[data-home-note]')) && !(await has(guest, '[data-home-jobs]')));
    await goSettings(guest);
    ok('and none on Settings', !(await has(guest, '[data-home-settings]')));
    ok('a guest never asks the server about jobs or workers', !guest.__rec.requests.some(r => /\/api\/(jobs|worker)/.test(r)), guest.__rec.requests.filter(r => /\/api\/(jobs|worker)/.test(r)).join(', '));
    ok('no page or console error', clean(guest), errs(guest));
    /* the Add-sheet-music card of a person with no PC is, tag for tag, the card before this change */
    let baseHtml = null;
    try { baseHtml = execFileSync('git', ['show', '26417f4:Piano Coach App.dc.html'], { cwd: L.REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { baseHtml = null; }
    if (baseHtml) {
      const old = await openPage(browser, base, { baseHtml: baseHtml });
      await goAdd(old);
      const norm = h => h.replace(/\s+/g, ' ').replace(/ data-reactroot=""/g, '');
      const a = norm(await old.evaluate(() => document.querySelector('[data-add-sheet]').outerHTML));
      const b = norm(await guest.evaluate(() => { window.PPP.app.go('upload')(); return new Promise(r => setTimeout(() => r(document.querySelector('[data-add-sheet]').outerHTML), 700)); }));
      ok('the Add-sheet-music card of a guest is identical to the one of the commit before (' + a.length + ' characters)', a === b && a.length > 3000, a === b ? '' : 'differs near ' + [...a].findIndex((c, i) => c !== b[i]));
      await old.close();
    } else console.log('  - git history of 26417f4 not available: the identical-card check is skipped');
    await guest.close();

    heading('signed in, no PC yet');
    const pg = await openPage(browser, base, { store: { 'ppp.recording.v1': 'v2' } });
    await signUp(pg, 'home1@example.com');
    await goAdd(pg);
    ok('a signed-in account with no token: no button, no list', !(await has(pg, '[data-home-pc]')) && !(await has(pg, '[data-home-jobs]')));
    ok('the page asked the server for the list (the account may have a PC)', pg.__rec.requests.some(r => r === 'GET /api/jobs'));
    await goSettings(pg);
    ok('Settings has the Connect my PC card', await has(pg, '[data-home-settings]') && /Connect my PC/.test(await text(pg, '[data-home-settings]')));
    ok('with a "Make a token" button, and nothing else yet', /Make a token/.test(await text(pg, '[data-home-token-make]')) && !(await has(pg, '[data-home-token-new]')) && !(await has(pg, '[data-home-token]')));
    await pg.evaluate(() => document.querySelector('[data-home-token-make]').click());
    await pg.waitForSelector('[data-home-token-new]', { timeout: 8000 });
    const token = await pg.evaluate(() => document.querySelector('[data-home-token-value]').value);
    ok('Make a token shows it once, with the steps and a Copy button', /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token) && /worker\.config\.json/.test(await text(pg, '[data-home-token-new]')) && /Copy/.test(await text(pg, '[data-home-token-copy]')), token.slice(0, 8));
    ok('and the card lists it as "Not seen yet"', /Not seen yet/.test(await text(pg, '[data-home-settings]')) && (await pg.evaluate(() => document.querySelectorAll('[data-home-token]').length)) === 1);
    await pg.reload({ waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => !!(window.PPP.app.state.user), { timeout: 20000 });
    await goSettings(pg);
    ok('after a reload the token is not shown again (it is not kept anywhere); its row is', !(await has(pg, '[data-home-token-new]')) && !(await text(pg, '[data-home-settings]')).includes(token.slice(0, 20)) && (await pg.evaluate(() => document.querySelectorAll('[data-home-token]').length)) === 1);
    await goAdd(pg);
    ok('a token that has never connected shows no button (nothing could pick the job up)', !(await has(pg, '[data-home-pc]')));

    heading('the PC connects: the button, the note');
    const worker = {
      claim: async o => (await req(port, 'POST', '/api/worker/claim', { token: token, body: Object.assign({ once: true }, o) })),
      hb: async (id, b) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/heartbeat', { token: token, body: b })),
      result: async (id, notes, extra) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/result', { token: token, body: Object.assign({ notes: notes, duration: 20, engine: 'ensemble', model: 'TransKun V2 + Kong', device: 'cuda', ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 0.83, accepted: notes.length, uncertain: 12 } }, extra || {}) })),
      fail: async (id, error) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/fail', { token: token, body: { error: error } }))
    };
    await worker.claim({ waitSeconds: 1200 });   /* the PC checks in: nothing is waiting */
    await goAdd(pg); await refresh(pg);
    ok('a PC that has checked in: the button is there, beside "Make sheet music"', await has(pg, '[data-home-pc]') && /High-quality \(my PC\)/.test(await text(pg, '[data-home-pc]')));
    const note = await text(pg, '[data-home-note]');
    ok('the note is honest: about once an hour, must be on, a few minutes a song, run the desktop shortcut to start now', /about once an hour/.test(note) && /switched on/.test(note) && /few minutes/.test(note) && /run the desktop shortcut/.test(note) && !/20 minutes/.test(note), note);
    ok('the PC is alive, so no "has not checked in" sentence', !/has not checked in/.test(note));
    ok('the two buttons are in the same row', await pg.evaluate(() => { const a = document.querySelector('[data-home-pc]'), b = [...document.querySelectorAll('[data-youtube] button')].find(x => /Make sheet music/.test(x.innerText)); return !!a && !!b && a.parentElement === b.parentElement; }));
    ok('the Full song recording type hides it (the helper makes faithful transcriptions)', await (async () => { await pg.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' })); await sleep(300); const gone = !(await has(pg, '[data-home-pc]')); await pg.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'auto' })); await sleep(300); return gone; })());
    ok('a PC the server has not heard of lately adds one honest sentence', await pg.evaluate(() => { const n = window.PPP.app.homeView({ user: { id: 1 }, homeWorker: { everSeen: true, alive: false, idlePollSeconds: 3600 }, homeJobs: [] }).homePcNote; return /about once an hour/.test(n) && /has not checked in lately/.test(n); }));
    ok('the interval is said in the words the site\'s setting calls for: 15 minutes, half an hour, an hour, 3 hours, a day', await pg.evaluate(() => { const f = secs => window.PPP.app.homeView({ user: { id: 1 }, homeWorker: { everSeen: true, alive: true, idlePollSeconds: secs }, homeJobs: [] }).homePcNote; return /about every 15 minutes/.test(f(900)) && /about every 30 minutes/.test(f(1800)) && /about once an hour/.test(f(3600)) && /about every 3 hours/.test(f(10800)) && /about every 24 hours/.test(f(86400)); }));

    heading('asking for a conversion');
    await typeLink(pg, YT);
    await pg.evaluate(() => document.querySelector('[data-home-pc]').click());
    await pg.waitForSelector('[data-home-job]', { timeout: 8000 });
    const post = pg.__rec.posts.filter(p => p.path === '/api/jobs' && p.method === 'POST')[0];
    ok('the button POSTs the link and the video\'s title to /api/jobs', !!post && JSON.parse(post.body).url === YT && JSON.parse(post.body).title === 'Teacher Piece', post && post.body);
    ok('the list shows it as waiting for the PC, with a Cancel button and no Open', /Waiting for your PC/.test(await text(pg, '[data-home-status]')) && (await has(pg, '[data-home-cancel]')) && !(await has(pg, '[data-home-open]')));
    ok('the title is Teacher Piece', /Teacher Piece/.test(await text(pg, '[data-home-job]')));
    const jobId = await pg.evaluate(() => document.querySelector('[data-home-job]').getAttribute('data-home-job'));
    ok('the page set a timer to look again (a job is waiting)', await pg.evaluate(() => !!window.PPP.app._homeTimer));
    await pg.reload({ waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => !!(window.PPP.app.state.user), { timeout: 20000 });
    await goAdd(pg); await sleep(600);
    ok('after a reload the list is still there (the server is the truth)', (await pg.evaluate(() => document.querySelectorAll('[data-home-job]').length)) === 1 && /Waiting for your PC/.test(await text(pg, '[data-home-status]')));
    await typeLink(pg, YT);
    await pg.evaluate(() => document.querySelector('[data-home-pc]').click());
    await sleep(900);
    ok('the same link again is not a second job', (await pg.evaluate(() => document.querySelectorAll('[data-home-job]').length)) === 1);
    const postsBefore = pg.__rec.posts.filter(p => p.path === '/api/jobs').length;
    await typeLink(pg, 'https://example.com/nope');
    await pg.evaluate(() => document.querySelector('[data-home-pc]').click());
    await sleep(500);
    ok('a link that is not YouTube is refused by the page, before any request', /not a link to a YouTube video/.test(await text(pg, '[data-youtube]')) && pg.__rec.posts.filter(p => p.path === '/api/jobs').length === postsBefore);

    heading('looking again: backing off, stopping, a way to look once more');
    {
      const table = await pg.evaluate(() => {
        const A = window.PPP.app, M = 60 * 1000, q = [{ status: 'queued' }], c = [{ status: 'claimed' }];
        return { q0: A.homePollDelay(q, 0), q49: A.homePollDelay(q, 4.9 * M), q5: A.homePollDelay(q, 5 * M), q149: A.homePollDelay(q, 14.9 * M), q15: A.homePollDelay(q, 15 * M), q299: A.homePollDelay(q, 29.9 * M), q30: A.homePollDelay(q, 30 * M), q90: A.homePollDelay(q, 90 * M),
          c0: A.homePollDelay(c, 0), c29: A.homePollDelay(c, 29 * M), c31: A.homePollDelay(c, 31 * M), both: A.homePollDelay(q.concat(c), 20 * M), done: A.homePollDelay([{ status: 'done' }, { status: 'failed' }, { status: 'cancelled' }], 0), none: A.homePollDelay([], 0), nul: A.homePollDelay(null, 0) };
      });
      ok('a waiting job is looked at every 90 s for 5 minutes, every 5 minutes until 15, every 15 minutes until 30, and then not any more', table.q0 === 90000 && table.q49 === 90000 && table.q5 === 300000 && table.q149 === 300000 && table.q15 === 900000 && table.q299 === 900000 && table.q30 === 0 && table.q90 === 0, JSON.stringify(table));
      ok('one being converted is looked at every 20 s (until the 30 minutes are up); finished ones and an empty list are not looked at', table.c0 === 20000 && table.c29 === 20000 && table.c31 === 0 && table.both === 20000 && table.done === 0 && table.none === 0 && table.nul === 0, JSON.stringify(table));
      await pg.evaluate(() => { window.__delays = []; const o = window.setTimeout; window.__setTimeout = o; window.setTimeout = (f, ms, ...r) => { window.__delays.push(ms); return o(f, ms, ...r); }; });
      const lastDelay = async minutesAgo => pg.evaluate(async m => { const A = window.PPP.app; A._homeWatch.t0 = Date.now() - m * 60 * 1000; window.__delays.length = 0; await A.homeRefresh(false, true); return { d: window.__delays.filter(x => x >= 20000).slice(-1)[0] || 0, stale: !!A.state.homeStale, timer: !!A._homeTimer }; }, minutesAgo);
      const d3 = await lastDelay(3), d8 = await lastDelay(8), d20 = await lastDelay(20);
      ok('the page really uses it: its own timer is set for 90 s, then 5 minutes, then 15 minutes as the watch grows older', d3.d === 90000 && d8.d === 300000 && d20.d === 900000 && !d3.stale && !d8.stale && !d20.stale, JSON.stringify([d3, d8, d20]));
      const d31 = await lastDelay(31);
      ok('after 30 minutes it stops: no timer, and the list says so with a "Check again" button', d31.d === 0 && d31.stale && !d31.timer && (await has(pg, '[data-home-stale]')) && /Not checking any more/.test(await text(pg, '[data-home-stale]')) && /Check again/.test(await text(pg, '[data-home-check-again]')), JSON.stringify(d31));
      await pg.evaluate(() => { window.__delays.length = 0; document.querySelector('[data-home-check-again]').click(); });
      await sleep(900);
      const again = await pg.evaluate(() => ({ stale: !!window.PPP.app.state.homeStale, timer: !!window.PPP.app._homeTimer, delays: window.__delays.filter(x => x >= 20000) }));
      ok('"Check again" looks once more, starts a new watch (90 s) and the control goes', !again.stale && again.timer && again.delays.slice(-1)[0] === 90000 && !(await has(pg, '[data-home-stale]')), JSON.stringify(again));
      /* a hidden tab keeps stopping */
      await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
      const hid = await pg.evaluate(async () => { const A = window.PPP.app; window.__delays.length = 0; await A.homeRefresh(false, true); return { timer: !!A._homeTimer, delays: window.__delays.filter(x => x >= 20000) }; });
      await pg.evaluate(() => { delete document.visibilityState; });
      ok('a hidden tab sets no timer (and asks nothing more)', !hid.timer && hid.delays.length === 0, JSON.stringify(hid));
      await pg.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(900);
      ok('and when the tab is seen again it looks once and starts a new watch', await pg.evaluate(() => !!window.PPP.app._homeTimer));
      await pg.evaluate(() => { window.setTimeout = window.__setTimeout; });
    }

    heading('the PC works on it');
    const got = await worker.claim({});
    ok('the PC claims it (the test plays the worker)', got.status === 200 && got.body.job && got.body.job.id === jobId);
    await worker.hb(jobId, { stage: 'transcribe', pct: 0.4 });
    await refresh(pg);
    ok('the page says it is being converted, with the percentage', /Converting on your PC — 40%/.test(await text(pg, '[data-home-status]')), await text(pg, '[data-home-status]'));
    ok('and a faster timer is set (20 s), and the status change started a new watch', await pg.evaluate(() => !!window.PPP.app._homeTimer && Date.now() - window.PPP.app._homeWatch.t0 < 60000));
    const heard = F.sextuplets(14, 7).notes;
    const posted = await worker.result(jobId, heard);
    ok('the PC posts the notes', posted.status === 200, posted.text);
    await refresh(pg);
    const toast = await pg.evaluate(() => window.PPP.app.state.toast || '');
    ok('the list says Ready to open, with an Open button, and no Cancel', /Ready to open/.test(await text(pg, '[data-home-status]')) && (await has(pg, '[data-home-open]')) && !(await has(pg, '[data-home-cancel]')));
    ok('and no timer is left (nothing is pending)', await pg.evaluate(() => !window.PPP.app._homeTimer));
    ok('the page said so when the status changed (a toast: the conversion is ready)', /high-quality conversion of Teacher Piece is ready/.test(toast), toast);

    heading('Open: the review screen, written from the PC\'s notes');
    const audioBefore = pg.__rec.audio;
    await pg.evaluate(() => document.querySelector('[data-home-open]').click());
    await pg.waitForFunction(() => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', { timeout: 90000 });
    await sleep(1500);
    const rv = await pg.evaluate(() => {
      const A = window.PPP.app, S = A.state, h = A._heard || {}, src = S.importSource || {}, rep = S.importReport || {};
      return { screen: S.screen, err: S.parseError || null, heard: { tier: h.qualityTier, engine: h.engine, homePc: h.homePc, pedals: 'pedals' in h, beats: 'beats' in h, n: (h.notes || []).length, agreement: h.ensemble && h.ensemble.agreement, models: h.ensemble && h.ensemble.models, uncertain: h.ensemble && h.ensemble.uncertain, device: h.device },
        pipeline: src.recordingPipeline || null, version: src.transcriptionVersion, engineLabel: src.engine, amt: src.amt, kind: src.kind, url: src.url, device: src.device, modelAgreement: src.modelAgreement, amtModels: src.amtModels,
        confidenceKind: rep.confidenceKind, repAgreement: rep.modelAgreement, modelCount: rep.modelCount, issues: (rep.issues || []).map(i => i.kind), level: rep.level, measures: S.score.measures.length, notes: S.score.notes.filter(n => !n.rest).length,
        hasRecording: !!(A._recording && A._recording.url), body: document.body.innerText };
    });
    ok('the review screen opened (no error)', rv.screen === 'review' && !rv.err, rv.err || rv.screen);
    ok('the heard object is the page\'s own format: tier local-piano-ensemble, engine ensemble, notes only (no pedals, no beats)', rv.heard.tier === 'local-piano-ensemble' && rv.heard.engine === 'ensemble' && rv.heard.homePc === true && !rv.heard.pedals && !rv.heard.beats && rv.heard.n === heard.length, JSON.stringify(rv.heard));
    ok('it carries the ensemble summary (models, agreement 0.83, 12 kept apart)', rv.heard.agreement === 0.83 && rv.heard.models.join() === 'transkun,piano-transcription' && rv.heard.uncertain === 12 && rv.heard.device === 'cuda');
    ok('v2 was selected, so v2 wrote the notation (pipeline v2, version 8)', rv.pipeline === 'v2' && rv.version === 8, JSON.stringify({ p: rv.pipeline, v: rv.version }));
    ok('the source says where it came from: YouTube, this link, "Piano ensemble on your PC"', rv.kind === 'youtube' && rv.url === YT && rv.engineLabel === 'Piano ensemble on your PC' && rv.amt === 'ensemble' && rv.device === 'cuda', JSON.stringify({ k: rv.kind, e: rv.engineLabel }));
    ok('the report reads the models\' agreement (model-agreement, 83%, two models), as it does for the local helper', rv.confidenceKind === 'model-agreement' && rv.repAgreement === 0.83 && rv.modelCount === 2, JSON.stringify({ c: rv.confidenceKind, a: rv.repAgreement, m: rv.modelCount }));
    ok('no "less precise fallback" issue, no single-model issue', rv.issues.indexOf('fallback') < 0 && rv.issues.indexOf('single-model') < 0, rv.issues.join());
    ok('the screen shows the engine and the agreement in the person\'s words', /Piano ensemble on your PC/.test(rv.body) && /model agreement/i.test(rv.body) && !/less precise fallback/.test(rv.body), JSON.stringify({ eng: /Piano ensemble on your PC/.test(rv.body), agr: /model agreement/i.test(rv.body), fb: /less precise fallback/.test(rv.body), head: rv.body.slice(0, 500) }));
    ok('a score was written (' + rv.measures + ' measures, ' + rv.notes + ' notes)', rv.measures >= 10 && rv.notes > 100);
    ok('the page asked for the recording to play beside it (as the browser path does) and got it', pg.__rec.audio === audioBefore + 1 && rv.hasRecording);
    ok('no request was made to the PC-side helper, and the browser model was not loaded', !pg.__rec.requests.some(r => /magenta|transcription\.js|basic-pitch/.test(r)), pg.__rec.requests.filter(r => /magenta|basic-pitch/.test(r)).join());
    const heardKept = await pg.evaluate(() => window.PPP.app.heardForSong().then(h => ({ n: h && h.notes && h.notes.length, d: h && h.duration })));
    ok('"Play as recorded" and "Write again" have their notes (heardForSong)', heardKept.n === heard.length, JSON.stringify(heardKept));
    ok('"Write the notation again" is offered, "Play as recorded" too', (await has(pg, '[data-write-again]')) && (await has(pg, '[data-as-recorded]')));
    await pg.evaluate(() => { window.PPP.recording = 'legacy'; });
    await pg.evaluate(() => document.querySelector('[data-write-again]').click());
    await pg.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(500);
    ok('Write again with the classic method writes the same notes the classic way (pipeline cleared), and Undo puts v2 back', await (async () => {
      const a = await pg.evaluate(() => ({ p: (window.PPP.app.state.importSource || {}).recordingPipeline || null }));
      await pg.evaluate(() => document.querySelector('[data-notation-undo]').click());
      await sleep(900);
      const b = await pg.evaluate(() => ({ p: (window.PPP.app.state.importSource || {}).recordingPipeline || null }));
      return a.p === null && b.p === 'v2';
    })());
    await pg.evaluate(() => { window.PPP.recording = 'v2'; });
    const songId = await pg.evaluate(() => window.PPP.app.state.songId);
    await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise/.test(x.innerText)); if (b) b.click(); });
    await sleep(2500);
    const slot = await pg.evaluate(i => JSON.parse(localStorage.getItem('ppp.song.v1.' + i) || 'null'), songId);
    ok('Accept keeps the song: its slot has the source (YouTube, the PC engine) and the score', !!slot && !!slot.score && /Piano ensemble on your PC/.test(JSON.stringify(slot.importSource || {})) && (slot.importSource.recordingPipeline === 'v2'), slot ? Object.keys(slot).join() : 'no slot');
    ok('no page or console error so far', clean(pg), errs(pg));

    heading('the classic conversion, when v2 is not selected');
    const j2 = (await req(port, 'POST', '/api/jobs', { cookie: await cookieOf(pg), body: { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Second piece' } })).body.job;
    await worker.claim({}); await worker.result(j2.id, F.sextuplets(10, 3).notes);
    await pg.evaluate(() => { window.PPP.recording = 'legacy'; });
    await goAdd(pg); await refresh(pg);
    await pg.evaluate(id => document.querySelector('[data-home-open="' + id + '"]').click(), j2.id);
    await pg.waitForFunction(() => window.PPP.app.state.screen === 'review' && window.PPP.app.state.score.title !== undefined, { timeout: 60000 });
    await sleep(1500);
    const cl = await pg.evaluate(() => { const S = window.PPP.app.state, src = S.importSource || {}; return { p: src.recordingPipeline || null, v: src.transcriptionVersion, e: src.engine, n: S.score.notes.filter(x => !x.rest).length }; });
    ok('with the classic method selected the classic conversion writes it (no v2 mark), from the same kind of notes', cl.p === null && cl.v === 7 && cl.e === 'Piano ensemble on your PC' && cl.n > 50, JSON.stringify(cl));
    await pg.evaluate(() => { window.PPP.recording = 'v2'; });

    heading('failed, cancelled, and a second account');
    const j3 = (await req(port, 'POST', '/api/jobs', { cookie: await cookieOf(pg), body: { url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz', title: 'Bad one' } })).body.job;
    await worker.claim({}); await worker.fail(j3.id, 'The audio could not be downloaded');
    const j4 = (await req(port, 'POST', '/api/jobs', { cookie: await cookieOf(pg), body: { url: 'https://www.youtube.com/watch?v=yyyyyyyyyyy', title: 'Cancel me' } })).body.job;
    await goAdd(pg); await refresh(pg);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('[data-home-job]')].map(r => ({ id: r.getAttribute('data-home-job'), status: r.querySelector('[data-home-status]').innerText, open: !!r.querySelector('[data-home-open]'), cancel: !!r.querySelector('[data-home-cancel]') })));
    const r3 = rows.find(r => r.id === j3.id), r4 = rows.find(r => r.id === j4.id);
    ok('a failed job says Failed with the PC\'s reason, no Open, no Cancel', r3 && /Failed · The audio could not be downloaded/.test(r3.status) && !r3.open && !r3.cancel, JSON.stringify(r3));
    ok('a waiting one has Cancel', r4 && r4.cancel && !r4.open);
    await pg.evaluate(id => document.querySelector('[data-home-cancel="' + id + '"]').click(), j4.id);
    await sleep(900);
    ok('Cancel cancels it on the server and the list says Cancelled', /Cancelled/.test(await pg.evaluate(id => document.querySelector('[data-home-job="' + id + '"] [data-home-status]').innerText, j4.id)) && (await req(port, 'GET', '/api/jobs/' + j4.id, { cookie: await cookieOf(pg) })).body.job.status === 'cancelled');
    const pg2 = await openPage(browser, base);
    await signUp(pg2, 'home2@example.com');
    await goAdd(pg2);
    ok('a second account sees none of it, and has no button', !(await has(pg2, '[data-home-pc]')) && !(await has(pg2, '[data-home-jobs]')));
    ok('and the first account\'s job is not there for it (404)', (await req(port, 'GET', '/api/jobs/' + jobId, { cookie: await cookieOf(pg2) })).status === 404);
    await pg2.close();

    heading('removing the token');
    await goSettings(pg);
    await pg.evaluate(() => document.querySelector('[data-home-token-remove]').click());
    await sleep(1000);
    ok('removing it: the list is empty, the PC is refused at once', (await pg.evaluate(() => document.querySelectorAll('[data-home-token]').length)) === 0 && (await worker.claim({})).status === 401);
    await goAdd(pg); await refresh(pg);
    ok('and with no token the button is gone (the finished conversions stay listed)', !(await has(pg, '[data-home-pc]')) && (await has(pg, '[data-home-jobs]')));
    ok('no page or console error', clean(pg), errs(pg));
    await pg.close();

    heading('Korean, Japanese, Chinese');
    for (const [loc, want] of [['ko-KR', { btn: '고품질 변환 (내 PC)', st: 'PC를 기다리는 중', note: '약 한 시간에 한 번', card: '내 PC 연결' }], ['ja-JP', { btn: '高品質変換（自分のPC）', st: 'PCを待っています', note: '約1時間に1回', card: '自分のPCを接続' }], ['zh-CN', { btn: '高质量转换（我的电脑）', st: '等待你的电脑', note: '大约每小时', card: '连接我的电脑' }]]) {
      const lp = await openPage(browser, base, { locale: loc });
      await signUp(lp, 'home-' + loc.toLowerCase() + '@example.com');
      const t = (await lp.evaluate(() => window.PPP.app.state.user.id), (await lp.evaluate(async () => (await (await fetch('/api/worker/tokens', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).token)));
      await req(port, 'POST', '/api/worker/claim', { token: t, body: { once: true } });
      await goAdd(lp); await refresh(lp);
      await typeLink(lp, YT);
      await lp.evaluate(() => document.querySelector('[data-home-pc]').click());
      await lp.waitForSelector('[data-home-job]', { timeout: 8000 });
      await sleep(700);
      ok(loc + ': the button, the note and the status are in the person\'s language', (await text(lp, '[data-home-pc]')).indexOf(want.btn) >= 0 && (await text(lp, '[data-home-note]')).indexOf(want.note) >= 0 && (await text(lp, '[data-home-status]')).indexOf(want.st) >= 0,
        [await text(lp, '[data-home-pc]'), await text(lp, '[data-home-status]')].join(' | '));
      await goSettings(lp);
      ok(loc + ': the Settings card too', (await text(lp, '[data-home-settings]')).indexOf(want.card) >= 0, (await text(lp, '[data-home-settings]')).slice(0, 80));
      ok(loc + ': no page or console error', clean(lp), errs(lp));
      await lp.close();
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    L.rmDir(dir);
  }
  console.log(L.errors.length ? '\n' + L.errors.length + ' FAILED' : '\nall passed');
  L.errors.slice(0, 15).forEach(e => console.log('  - ' + e));
  process.exit(L.errors.length ? 1 : 0);
})();
