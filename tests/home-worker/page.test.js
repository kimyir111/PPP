/* ============================================================================
   G10b-1 / G10b-2: "High-quality (my PC)" in the real page, against the real server (tests/serve-free.js, a data directory of its own). NO ACCOUNT, NO SIGN-IN: the page makes
   a PC link for anybody (Settings > Connect my PC > Create my PC link), keeps its PC code in localStorage (ppp.pclink.v1) and sends it as X-PPP-PC; a second browser context
   types the code to use the same link. The test plays the worker's part with plain HTTP calls (claim, heartbeat, result) - tests/home-worker/worker.test.js has the real
   worker - so what is checked here is the PAGE: when the button shows, what it sends, the list, what a reload keeps, Open writing the score from the PC's notes (v2 or
   classic), the review screen's words, saving, and that nothing changes for anyone who has no link.

     - no link on this device: no primary button, no note, no list, no request about jobs (G10b-5: ONE probe, GET /api/worker/status with no header, to learn whether the site has the queue); the
       Add-sheet-music card is identical, tag for tag, to the card of the commit before the feature EXCEPT for the one secondary button "High-quality (my PC)" that opens the sheet saying how to
       connect (G10b-5: the button must always be findable; tests/home-worker/findable.test.js has every state of it); the Settings card offers "Create my PC link" and "Use a PC link from
       another device" and says no sign-in is needed
     - a private window (localStorage blocked, or its getter throwing): no card, no request, no error
     - making a link: both secrets shown once with copy buttons, the exact lines for the PC, a warning to keep them secret; the code is in localStorage, no cookie is sent
     - a link on this device: status, Show my PC code, New PC token (asked twice; the old token is dead), Remove link (asked twice), Forget on this device
     - a second device types the code (pasted with spaces, dashes and capitals), sees the same list, opens the result; a wrong code is said and not kept; a code the site does not know right now is KEPT and said (G10b-5)
     - the PC connects: the button beside "Make sheet music", the honest note, the list, Cancel, Remove, Open (v2 or classic), the review, Accept
     - the polling: a timer only while something is waiting or converting
     - Korean, Japanese and Chinese: the card, the button, the note and the statuses

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

/* a page in a context of its own (its own localStorage and cookies). o.store: localStorage before the page runs; o.baseHtml: serve this as the page (a past version);
   o.block: 'set' (setItem throws, as a private window of some browsers does) or 'all' (reading localStorage throws a SecurityError) */
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
  if (o.block === 'set') await page.evaluateOnNewDocument(() => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  if (o.block === 'all') await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); });
  /* what the page fetches from the queue's routes: the credentials mode and the headers (to see that no cookie is involved and where X-PPP-PC goes) */
  await page.evaluateOnNewDocument(() => {
    const f = window.fetch; window.__fetches = [];
    window.fetch = function (u, o) { try { if (/\/api\/(jobs|worker|pc-links)/.test(String(u))) window.__fetches.push({ u: String(u), method: (o && o.method) || 'GET', credentials: o && o.credentials, headers: Object.assign({}, o && o.headers) }); } catch (e) {} return f.apply(this, arguments); };
  });
  const rec = { requests: [], posts: [], consoleErrors: [], pageErrors: [], audio: 0 };
  page.__rec = rec;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url(), p = u.replace(/^https?:\/\/[^/]+/, '');
    rec.requests.push(r.method() + ' ' + p);
    if (r.method() !== 'GET' && /\/api\/(jobs|worker|pc-links)/.test(p)) rec.posts.push({ method: r.method(), path: p, body: r.postData() });
    if (/:8788\/|\/helper(\/|$|\?)/.test(u)) return r.abort();
    /* a server whose queue is off (o.queue503 'off': 503 "store" marked disabled, as server.js answers it) or that fails for a moment (o.queue503 'blip': the same, not marked) */
    if (o.queue503 && /^\/api\/(jobs|worker|pc-links)(\/|\?|$)/.test(p)) return r.respond({ status: 503, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(Object.assign({ error: 'The queue is not available right now. Try again in a minute.', code: 'store' }, o.queue503 === 'off' ? { disabled: true } : {})) });
    /* a DELETE of a conversion that the test makes fail: rec.failDelete = a status */
    if (rec.failDelete && r.method() === 'DELETE' && /^\/api\/jobs\//.test(p)) return r.respond({ status: rec.failDelete, contentType: 'application/json', body: JSON.stringify({ error: 'The queue is not available right now. Try again in a minute.', code: 'store' }) });
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
/* G10b-3: the card shows ONE button; Show my PC code, New PC token, Remove link, Forget on this device and the paste form are under "More" */
const openMore = async page => { if (!(await page.evaluate(() => !!document.querySelector('[data-home-more-box]')))) { await page.evaluate(() => document.querySelector('[data-home-more]').click()); await sleep(300); } };
const text = (page, sel) => page.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const val = (page, sel) => page.evaluate(q => { const e = document.querySelector(q); return e ? e.value : null; }, sel);
const click = (page, sel) => page.evaluate(q => document.querySelector(q).click(), sel);
const stored = page => page.evaluate(() => { try { return localStorage.getItem('ppp.pclink.v1'); } catch (e) { return 'ERR'; } });
const typeLink = async (page, url) => {
  await page.evaluate(() => { const i = document.querySelector('[data-youtube-url]'); i.value = ''; });
  await page.type('[data-youtube-url]', url);
  await page.evaluate(() => { const i = document.querySelector('[data-youtube-url]'); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(250);
};
const typeCode = async (page, code) => {
  await page.evaluate(() => { const i = document.querySelector('[data-home-use-input]'); i.value = ''; });
  await page.type('[data-home-use-input]', code);
  await page.evaluate(() => { const i = document.querySelector('[data-home-use-input]'); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(250);
};
const refresh = async page => { await page.evaluate(() => window.PPP.app.homeRefresh(false)); await sleep(500); };
const queued = page => page.__rec.requests.filter(r => /\/api\/(jobs|worker|pc-links)/.test(r));

(async () => {
  const dir = L.tmpDir('ppp-hw-page-');
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  const base = srv.url;
  const port = srv.port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  let codeA = null;
  try {
    heading('no link on this device: nothing of it, no request, and the card of the commit before is the same');
    const guest = await openPage(browser, base);
    await goAdd(guest);
    ok('no primary button, no note, no list on the Add screen; the secondary button (how to connect) is there instead (G10b-5)', !(await has(guest, '[data-home-pc]')) && !(await has(guest, '[data-home-note]')) && !(await has(guest, '[data-home-jobs]')) && await has(guest, '[data-home-pc-help]'));
    ok('a device with no link asks the site NOTHING about jobs or links while the Add screen is open - only the one probe that learns whether the site has the queue (GET /api/worker/status, no PC code)', queued(guest).join() === 'GET /api/worker/status' && await guest.evaluate(() => window.__fetches.every(f => !f.headers || !f.headers['X-PPP-PC'])), queued(guest).join(', '));
    let baseHtml = null;
    /* b7f9fb5: main as it was before G10b-2 (the home-PC queue with accounts; for a device with no account and no link the Add card is the plain one) */
    try { baseHtml = execFileSync('git', ['show', 'b7f9fb5:Piano Coach App.dc.html'], { cwd: L.REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { baseHtml = null; }
    if (baseHtml) {
      const old = await openPage(browser, base, { baseHtml: baseHtml });
      await goAdd(old);
      const norm = h => h.replace(/\s+/g, ' ').replace(/ data-reactroot=""/g, '');
      const a = norm(await old.evaluate(() => document.querySelector('[data-add-sheet]').outerHTML));
      const bRaw = await guest.evaluate(() => { window.PPP.app.go('upload')(); return new Promise(r => setTimeout(() => r(document.querySelector('[data-add-sheet]').outerHTML), 700)); });
      /* G10b-5 (deliberate): the card used to be identical to this one for everybody with no link; it now differs by EXACTLY one element, the secondary button "High-quality (my PC)" (data-home-pc-help) that opens the
         sheet saying how to connect. Everything else of the card is the same, tag for tag. */
      const helpRe = /<button\b[^>]*data-home-pc-help[^>]*>.*?<\/button>/;
      const helpBtn = (bRaw.match(helpRe) || [''])[0];
      const b = norm(bRaw.replace(helpRe, ''));
      ok('the Add-sheet-music card of a device with no link is identical to the one of main before this change (b7f9fb5; ' + a.length + ' characters) except for ONE added element: the secondary button "High-quality (my PC)" (G10b-5)', a === b && a.length > 3000 && /High-quality \(my PC\)/.test(helpBtn) && norm(bRaw) !== a && (bRaw.match(/data-home-pc-help/g) || []).length === 1, a === b ? '' : 'differs near ' + [...a].findIndex((c, i) => c !== b[i]));
      ok('and that button sits in the row of "Make sheet music" (same parent), after it', await guest.evaluate(() => { const h = document.querySelector('[data-home-pc-help]'), m = [...document.querySelectorAll('[data-youtube] button')].find(x => /Make sheet music/.test(x.innerText)); return !!h && !!m && h.parentElement === m.parentElement && !!(m.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); }));
      await old.close();
    } else console.log('  - git history of b7f9fb5 not available: the identical-card check is skipped');
    await goSettings(guest);
    await openMore(guest);
    ok('Settings has the Connect my PC card for everybody, with no sign-in: the button to make a link, the way to use one from another device', await has(guest, '[data-home-settings]') && /Connect my PC/.test(await text(guest, '[data-home-settings]'))
      && /Create my PC link/.test(await text(guest, '[data-home-link-make]')) && (await has(guest, '[data-home-use-input]')) && (await has(guest, '[data-home-use-go]')) && /Use a PC link from another device/.test(await text(guest, '[data-home-use]')));
    ok('it says that no account or sign-in is needed, and offers none of the link\'s buttons yet', /No account or sign-in is needed/.test(await text(guest, '[data-home-no-account]')) && !(await has(guest, '[data-home-link]')) && !(await has(guest, '[data-home-new]')));
    ok('the Settings screen asked the site once (no header) whether it has the queue; nothing about jobs', queued(guest).join() === 'GET /api/worker/status', queued(guest).join(', '));
    ok('no page or console error', clean(guest), errs(guest));
    await guest.close();

    heading('a private window: localStorage blocked - the feature is simply not offered, nothing is asked, nothing breaks');
    for (const mode of ['set', 'all']) {
      const pw = await openPage(browser, base, { block: mode });
      /* with no storage the page cannot remember that this is a guest, so it shows its sign-in gate first: "Continue as guest" is the way in (as ever) */
      await pw.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Continue as guest/.test(x.innerText || '')); if (b) b.click(); });
      await sleep(500);
      await goAdd(pw); await goSettings(pw); await goAdd(pw);
      ok('(' + mode + ') no card on Settings, no button, no list, no request to the queue at all, no page or console error', !(await has(pw, '[data-home-pc]')) && !(await has(pw, '[data-home-jobs]')) && !(await has(pw, '[data-home-settings]')) && queued(pw).length === 0 && clean(pw), queued(pw).join(', ') + ' ' + errs(pw));
      await goSettings(pw);
      ok('(' + mode + ') the rest of Settings is still there (the page is on its Settings screen and draws its other cards: theme, language, MIDI, reset)', (await pw.evaluate(() => window.PPP.app.state.screen)) === 'settings' && (await text(pw, 'body')).length > 400 && (await pw.evaluate(() => document.querySelectorAll('button').length)) > 8);
      await pw.close();
    }

    heading('making a link: no sign-in, both secrets shown once');
    const pg = await openPage(browser, base, { store: { 'ppp.recording.v1': 'v2' } });
    await goSettings(pg);
    await click(pg, '[data-home-link-make]');
    await pg.waitForSelector('[data-home-new]', { timeout: 8000 });
    const token = await val(pg, '[data-home-token-value]'), pairLink = await val(pg, '[data-home-pair-link-new]'), code = (pairLink || '').split('#pc=')[1];
    codeA = code;
    const post = pg.__rec.posts.filter(p => p.path === '/api/pc-links')[0];
    ok('Create my PC link POSTs /api/pc-links with an empty body and no PC code (there is none yet)', !!post && post.method === 'POST' && JSON.parse(post.body || '{}') && Object.keys(JSON.parse(post.body || '{}')).length === 0
      && (await pg.evaluate(() => window.__fetches.find(f => f.u === '/api/pc-links')).then(f => !!f && !('X-PPP-PC' in f.headers))));
    ok('the PC token (ppw_...) and the pairing link (this site, #pc=, the 64 hex of the code) are shown, each with a Copy button', /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token) && /^[0-9a-f]{64}$/.test(code) && pairLink === new URL(base).origin + '/#pc=' + code && /Copy/.test(await text(pg, '[data-home-token-copy]')) && /Copy/.test(await text(pg, '[data-home-pair-copy-new]')), token.slice(0, 8));
    ok('an explicit warning under the link that says what a holder can do (G10b-4): send conversions to your PC, read their results, replace the PC token, remove the link - send it only to yourself', await text(pg, '[data-home-warning]') === 'Anyone with this link can send conversions to your PC, read their results, replace the PC token and remove the link: send it only to yourself.', await text(pg, '[data-home-warning]'));
    const steps = await text(pg, '[data-home-steps]');
    ok('and the exact lines for the PC: the file to copy, the siteUrl of this site, this token, the --check and --once commands', /worker\.config\.example\.json/.test(steps) && steps.indexOf('"siteUrl": "' + new URL(base).origin + '"') > 0 && steps.indexOf('"token": "' + token + '"') > 0 && /worker\.js --check/.test(steps) && /worker\.js --once/.test(steps), JSON.stringify({ base: base, tokenLen: token.length, a: /worker\.config\.example\.json/.test(steps), b: steps.indexOf('"siteUrl": "' + new URL(base).origin + '"'), c: steps.indexOf('"token": "' + token + '"') }));
    ok('this browser keeps the code in localStorage (ppp.pclink.v1) - and only the code, not the token', JSON.parse(await stored(pg)).code === code && (await stored(pg)).indexOf(token) < 0 && (await pg.evaluate(() => Object.keys(localStorage).filter(k => localStorage.getItem(k).indexOf('ppw_') >= 0).length)) === 0);
    ok('no cookie is involved: every call to the queue was made with credentials "omit", and the code goes in X-PPP-PC', await pg.evaluate(() => window.__fetches.every(f => f.credentials === 'omit') && window.__fetches.some(f => f.headers && f.headers['X-PPP-PC'])));
    ok('after the link is made the card shows its status (waiting for the PC); "Create my PC link" is gone, and the other buttons are under More (closed)', /^Waiting for your PC · PC link …[0-9a-f]{6}$/.test(await text(pg, '[data-home-status-line]')) && !(await has(pg, '[data-home-link-make]')) && !(await has(pg, '[data-home-use]')) && !(await has(pg, '[data-home-link]')));
    await openMore(pg);
    ok('under More: show my code, new token, remove link, forget on this device, and the paste form', await pg.evaluate(() => ['[data-home-code-show]', '[data-home-token-rotate]', '[data-home-link-remove]', '[data-home-link-forget]', '[data-home-use-input]'].every(s => !!document.querySelector(s))));
    await pg.evaluate(() => document.querySelector('[data-home-more]').click()); await sleep(300);
    await click(pg, '[data-home-new-done]');
    await sleep(300);
    ok('"I have saved them" puts the secrets away', !(await has(pg, '[data-home-new]')));
    await pg.reload({ waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 20000 });
    await goSettings(pg);
    ok('after a reload the link is still this device\'s (localStorage: the one button is there) and the token is NOT shown again (it is kept nowhere on this device)', (await has(pg, '[data-home-pair-copy]')) && !(await has(pg, '[data-home-new]')) && JSON.parse(await stored(pg)).code === code && !(await text(pg, '[data-home-settings]')).includes(token.slice(0, 20)));
    ok('Show my PC code (under More) reveals the code (to type on another device) with a Copy button and the warning; Hide takes it away again', await (async () => {
      await openMore(pg);
      await click(pg, '[data-home-code-show]'); await sleep(300);
      const shown = (await val(pg, '[data-home-code-shown]')) === code && /Type or paste this code on another device/.test(await text(pg, '[data-home-code-box]')) && /Keep these secret/.test(await text(pg, '[data-home-code-box]')) && /Hide my PC code/.test(await text(pg, '[data-home-code-show]'));
      await click(pg, '[data-home-code-show]'); await sleep(300);
      return shown && !(await has(pg, '[data-home-code-shown]')) && /Show my PC code/.test(await text(pg, '[data-home-code-show]'));
    })());
    await goAdd(pg);
    ok('a link whose PC has never connected still shows the button (G10b-5: it is always findable), enabled, with one line under it: the PC has not connected yet, it will take the job when it does; no note, no list', await (async () => {
      await sleep(300);
      const b = await pg.evaluate(() => { const e = document.querySelector('[data-home-pc]'); return e && { disabled: e.disabled }; });
      return !!b && b.disabled === false && (await text(pg, '[data-home-pc-state]')) === 'Your PC has not connected yet: it will take the job when it does' && (await pg.evaluate(() => document.querySelector('[data-home-pc-state]').getAttribute('data-home-pc-state'))) === 'never-seen' && !(await has(pg, '[data-home-note]')) && !(await has(pg, '[data-home-jobs]'));
    })());
    ok('the Add screen now asks for the list with the code (and the Settings screen asked nothing without a link: the probe was made once before the link existed)', pg.__rec.requests.some(r => r === 'GET /api/jobs'));

    heading('the PC connects: the button, the note');
    const token0 = token;
    let tokenNow = token0;
    const worker = {
      claim: async o => (await req(port, 'POST', '/api/worker/claim', { token: tokenNow, body: Object.assign({ once: true }, o) })),
      hb: async (id, b) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/heartbeat', { token: tokenNow, body: b })),
      result: async (id, notes, extra) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/result', { token: tokenNow, body: Object.assign({ notes: notes, duration: 20, engine: 'ensemble', model: 'TransKun V2 + Kong', device: 'cuda', ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 0.83, accepted: notes.length, uncertain: 12 } }, extra || {}) })),
      fail: async (id, error) => (await req(port, 'POST', '/api/worker/jobs/' + id + '/fail', { token: tokenNow, body: { error: error } }))
    };
    await worker.claim({ waitSeconds: 1200 });   /* the PC checks in: nothing is waiting */
    await goAdd(pg); await refresh(pg);
    ok('a PC that has checked in: the button is there, beside "Make sheet music"', await has(pg, '[data-home-pc]') && /High-quality \(my PC\)/.test(await text(pg, '[data-home-pc]')));
    const note = await text(pg, '[data-home-note]');
    ok('the note is honest: about once an hour, must be on, a few minutes a song, run the desktop shortcut to start now', /about once an hour/.test(note) && /switched on/.test(note) && /few minutes/.test(note) && /run the desktop shortcut/.test(note) && !/20 minutes/.test(note), note);
    ok('the PC is alive, so no "has not checked in" sentence, and no state line under the button any more', !/has not checked in/.test(note) && !(await has(pg, '[data-home-pc-state]')));
    ok('the two buttons are in the same row', await pg.evaluate(() => { const a = document.querySelector('[data-home-pc]'), b = [...document.querySelectorAll('[data-youtube] button')].find(x => /Make sheet music/.test(x.innerText)); return !!a && !!b && a.parentElement === b.parentElement; }));
    ok('the Full song recording type hides it (the helper makes faithful transcriptions)', await (async () => { await pg.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' })); await sleep(300); const gone = !(await has(pg, '[data-home-pc]')); await pg.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'auto' })); await sleep(300); return gone; })());
    ok('a PC the server has not heard of lately adds one honest sentence', await pg.evaluate(() => { const n = window.PPP.app.homeView({ homeWorker: { everSeen: true, alive: false, idlePollSeconds: 3600 }, homeJobs: [] }).homePcNote; return /about once an hour/.test(n) && /has not checked in lately/.test(n); }));
    ok('the interval is said in the words the site\'s setting calls for: 15 minutes, half an hour, an hour, 3 hours, a day', await pg.evaluate(() => { const f = secs => window.PPP.app.homeView({ homeWorker: { everSeen: true, alive: true, idlePollSeconds: secs }, homeJobs: [] }).homePcNote; return /about every 15 minutes/.test(f(900)) && /about every 30 minutes/.test(f(1800)) && /about once an hour/.test(f(3600)) && /about every 3 hours/.test(f(10800)) && /about every 24 hours/.test(f(86400)); }));

    await goSettings(pg); await refresh(pg);
    ok('Settings now says the PC is connected, and when it was last seen (the time of its first check): one line', /^PC connected · last seen (just now|\d+ min ago) · PC link …[0-9a-f]{6}$/.test(await text(pg, '[data-home-status-line]')) && !(await has(pg, '[data-home-last-seen]')), await text(pg, '[data-home-status-line]'));
    ok('G10b-4: the name in the status line is the site\'s linkTag of this device\'s link (the last 6 hex of the link id), and not a piece of the code', await (async () => {
      const J = L.mod('home-jobs.js'), c = JSON.parse(await stored(pg)).code, tag = J.linkTagOf(J.linkIdOf(J.codeHash(c)));
      return (await text(pg, '[data-home-status-line]')).endsWith('…' + tag) && !c.includes(tag) && !(await pg.evaluate(() => document.body.innerText)).includes(c);
    })());
    await goAdd(pg);

    heading('asking for a conversion');
    await typeLink(pg, YT);
    await click(pg, '[data-home-pc]');
    await pg.waitForSelector('[data-home-job]', { timeout: 8000 });
    const jpost = pg.__rec.posts.filter(p => p.path === '/api/jobs' && p.method === 'POST')[0];
    ok('the button POSTs the link and the video\'s title to /api/jobs, with the PC code in X-PPP-PC and no cookie', !!jpost && JSON.parse(jpost.body).url === YT && JSON.parse(jpost.body).title === 'Teacher Piece'
      && await pg.evaluate(c => { const f = window.__fetches.filter(x => x.u === '/api/jobs' && x.method === 'POST')[0]; return !!f && f.headers['X-PPP-PC'] === c && f.credentials === 'omit'; }, code), jpost && jpost.body);
    ok('the list shows it as waiting for the PC, with a Cancel button and no Open', /Waiting for your PC/.test(await text(pg, '[data-home-status]')) && (await has(pg, '[data-home-cancel]')) && !(await has(pg, '[data-home-open]')));
    ok('the title is Teacher Piece', /Teacher Piece/.test(await text(pg, '[data-home-job]')));
    const jobId = await pg.evaluate(() => document.querySelector('[data-home-job]').getAttribute('data-home-job'));
    ok('the page set a timer to look again (a job is waiting)', await pg.evaluate(() => !!window.PPP.app._homeTimer));
    await pg.reload({ waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 20000 });
    await goAdd(pg); await sleep(600);
    ok('after a reload the list is still there (the server is the truth, the code is in localStorage)', (await pg.evaluate(() => document.querySelectorAll('[data-home-job]').length)) === 1 && /Waiting for your PC/.test(await text(pg, '[data-home-status]')));
    await typeLink(pg, YT);
    await click(pg, '[data-home-pc]');
    await sleep(900);
    ok('the same link again is not a second job', (await pg.evaluate(() => document.querySelectorAll('[data-home-job]').length)) === 1);
    const postsBefore = pg.__rec.posts.filter(p => p.path === '/api/jobs').length;
    await typeLink(pg, 'https://example.com/nope');
    await click(pg, '[data-home-pc]');
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

    heading('a second device types the PC code: the same link, the same list, and it can open the result');
    {
      const dev2 = await openPage(browser, base);
      await goSettings(dev2);
      await openMore(dev2);
      ok('it starts with nothing: the Create button and the form (under More)', await has(dev2, '[data-home-link-make]') && await has(dev2, '[data-home-use-input]') && !(await has(dev2, '[data-home-link]')));
      await typeCode(dev2, 'nonsense');
      const sent = dev2.__rec.requests.length;
      await click(dev2, '[data-home-use-go]'); await sleep(500);
      ok('something that is not a code is said so in the page, and nothing is sent to the site', /That is not a PC code/.test(await text(dev2, '[data-home-error]')) && dev2.__rec.requests.length === sent && (await stored(dev2)) === null, dev2.__rec.requests.slice(sent).join());
      await typeCode(dev2, 'a'.repeat(64));
      await click(dev2, '[data-home-use-go]'); await sleep(700);
      ok('64 hex that is not a link of the site is refused by the site ("not valid"), and nothing is kept', /That PC link is not valid/.test(await text(dev2, '[data-home-error]')) && (await stored(dev2)) === null && !(await has(dev2, '[data-home-link]')), await text(dev2, '[data-home-error]'));
      /* pasted as people paste it: capitals, spaces every 8 characters, dashes */
      const spaced = code.toUpperCase().match(/.{1,8}/g).join(' ');
      await typeCode(dev2, spaced);
      await click(dev2, '[data-home-use-go]');
      await dev2.waitForSelector('[data-home-link]', { timeout: 8000 });
      ok('the code pasted with capitals and spaces is accepted (the site is asked with the cleaned code in X-PPP-PC), the link is this device\'s now (the one button is there), and the status shows', JSON.parse(await stored(dev2)).code === code && (await has(dev2, '[data-home-pair-copy]')) && /PC connected|Waiting for your PC/.test(await text(dev2, '[data-home-status-line]'))
        && await dev2.evaluate(c => window.__fetches.some(f => f.u === '/api/worker/status' && f.headers['X-PPP-PC'] === c), code));
      await goAdd(dev2); await refresh(dev2);
      ok('its Add screen has the same list and the Open button (the server is the truth)', (await dev2.evaluate(() => document.querySelectorAll('[data-home-job]').length)) === 1 && (await has(dev2, '[data-home-open]')) && /Ready to open/.test(await text(dev2, '[data-home-status]')));
      ok('and the same button, because the PC of the link has connected', await has(dev2, '[data-home-pc]'));
      ok('no page or console error on the second device', clean(dev2), errs(dev2));
      await dev2.close();
    }

    heading('Open: the review screen, written from the PC\'s notes');
    const audioBefore = pg.__rec.audio;
    await click(pg, '[data-home-open]');
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
    /* G10a-1d: a result with the PC's beats carries them into the heard object (v2 reads them as bar-phase evidence); one without carries none */
    const hb = await pg.evaluate(() => { const A = window.PPP.app; const b = [0.5, 1, 1.5, 2, 2.5]; const x = A.homeHeard({ notes: [], duration: 3, beats: b, downbeats: [0.5, 2.5] }), y = A.homeHeard({ notes: [], duration: 3, beats: [1, 2] });
      return { beats: x.beats, downbeats: x.downbeats, none: !('beats' in y) && !('downbeats' in y) }; });
    ok('a PC result with beats gives the heard object its beats and downbeats; fewer than four beats, none', JSON.stringify(hb.beats) === '[0.5,1,1.5,2,2.5]' && JSON.stringify(hb.downbeats) === '[0.5,2.5]' && hb.none, JSON.stringify(hb));
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
    await click(pg, '[data-write-again]');
    await pg.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(500);
    ok('Write again with the classic method writes the same notes the classic way (pipeline cleared), and Undo puts v2 back', await (async () => {
      const a = await pg.evaluate(() => ({ p: (window.PPP.app.state.importSource || {}).recordingPipeline || null }));
      await click(pg, '[data-notation-undo]');
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
    const j2 = (await req(port, 'POST', '/api/jobs', { code: code, body: { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Second piece' } })).body.job;
    await worker.claim({}); await worker.result(j2.id, F.sextuplets(10, 3).notes);
    await pg.evaluate(() => { window.PPP.recording = 'legacy'; });
    await goAdd(pg); await refresh(pg);
    await pg.evaluate(id => document.querySelector('[data-home-open="' + id + '"]').click(), j2.id);
    await pg.waitForFunction(() => window.PPP.app.state.screen === 'review' && window.PPP.app.state.score.title !== undefined, { timeout: 60000 });
    await sleep(1500);
    const cl = await pg.evaluate(() => { const S = window.PPP.app.state, src = S.importSource || {}; return { p: src.recordingPipeline || null, v: src.transcriptionVersion, e: src.engine, n: S.score.notes.filter(x => !x.rest).length }; });
    ok('with the classic method selected the classic conversion writes it (no v2 mark), from the same kind of notes', cl.p === null && cl.v === 7 && cl.e === 'Piano ensemble on your PC' && cl.n > 50, JSON.stringify(cl));
    await pg.evaluate(() => { window.PPP.recording = 'v2'; });

    heading('failed, cancelled, removed');
    const j3 = (await req(port, 'POST', '/api/jobs', { code: code, body: { url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz', title: 'Bad one' } })).body.job;
    await worker.claim({}); await worker.fail(j3.id, 'The audio could not be downloaded');
    const j4 = (await req(port, 'POST', '/api/jobs', { code: code, body: { url: 'https://www.youtube.com/watch?v=yyyyyyyyyyy', title: 'Cancel me' } })).body.job;
    await goAdd(pg); await refresh(pg);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('[data-home-job]')].map(r => ({ id: r.getAttribute('data-home-job'), status: r.querySelector('[data-home-status]').innerText, open: !!r.querySelector('[data-home-open]'), cancel: !!r.querySelector('[data-home-cancel]') })));
    const r3 = rows.find(r => r.id === j3.id), r4 = rows.find(r => r.id === j4.id);
    ok('a failed job says Failed with the PC\'s reason, no Open, no Cancel', r3 && /Failed · The audio could not be downloaded/.test(r3.status) && !r3.open && !r3.cancel, JSON.stringify(r3));
    ok('a waiting one has Cancel and no Remove (it is cancelled first)', r4 && r4.cancel && !r4.open && !(await has(pg, '[data-home-remove="' + j4.id + '"]')));
    ok('a failed one has Remove; a ready one has Open and Remove', (await has(pg, '[data-home-remove="' + j3.id + '"]')) && (await has(pg, '[data-home-open="' + jobId + '"]')) && (await has(pg, '[data-home-remove="' + jobId + '"]')));
    await pg.evaluate(id => document.querySelector('[data-home-cancel="' + id + '"]').click(), j4.id);
    await sleep(900);
    ok('Cancel cancels it on the server and the list says Cancelled', /Cancelled/.test(await pg.evaluate(id => document.querySelector('[data-home-job="' + id + '"] [data-home-status]').innerText, j4.id)) && (await req(port, 'GET', '/api/jobs/' + j4.id, { code: code })).body.job.status === 'cancelled');
    await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), j3.id);
    await sleep(900);
    ok('Remove on a failed conversion: the row goes, and so does the conversion on the server (404)', !(await has(pg, '[data-home-job="' + j3.id + '"]')) && (await req(port, 'GET', '/api/jobs/' + j3.id, { code: code })).status === 404);
    await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), j4.id);
    await sleep(900);
    ok('and on a cancelled one', !(await has(pg, '[data-home-job="' + j4.id + '"]')));
    heading('Remove on a conversion that is gone already (cleared to make room, or removed in another tab)');
    const failedJob = async (id, title) => { const j = (await req(port, 'POST', '/api/jobs', { code: code, body: { url: 'https://www.youtube.com/watch?v=' + id, title: title } })).body.job; await worker.claim({}); await worker.fail(j.id, 'The audio could not be downloaded'); return j; };
    const j5 = await failedJob('xxxxxxxxxxx', 'Gone already'), j6 = await failedJob('wwwwwwwwwww', 'Stays');
    await goAdd(pg); await refresh(pg);
    ok('two failed conversions are listed, each with Remove', (await has(pg, '[data-home-remove="' + j5.id + '"]')) && (await has(pg, '[data-home-remove="' + j6.id + '"]')));
    ok('meanwhile the site removes one (another tab): 200', (await req(port, 'DELETE', '/api/jobs/' + j5.id, { code: code })).status === 200);
    await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), j5.id);
    await sleep(900);
    ok('Remove on it (the site says 404: it is gone) is a success: the row leaves the list, and no error line is shown', !(await has(pg, '[data-home-job="' + j5.id + '"]')) && !(await pg.evaluate(() => window.PPP.app.state.ytError)) && !/not there/.test(await text(pg, '[data-youtube]')), String(await pg.evaluate(() => window.PPP.app.state.ytError)));
    pg.__rec.failDelete = 503;
    await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), j6.id);
    await sleep(900);
    ok('any other failure of Remove is still shown (a 503): the error line says so and the row stays', /not available right now/.test(await text(pg, '[data-youtube]')) && (await has(pg, '[data-home-job="' + j6.id + '"]')), String(await text(pg, '[data-youtube]')).slice(0, 120));
    pg.__rec.failDelete = 0;
    await pg.evaluate(() => window.PPP.app.setState({ ytError: null }));
    await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), j6.id);
    await sleep(900);
    ok('and once the site is back, Remove works', !(await has(pg, '[data-home-job="' + j6.id + '"]')));
    ok('the page\'s own link check takes exactly 11 characters of video id, like the server', await pg.evaluate(() => { const f = u => window.PPP.Import.youtubeId(u); return f('https://www.youtube.com/watch?v=abcdefghijk') === 'abcdefghijk' && f('https://youtu.be/ab-_Efgh1jK') === 'ab-_Efgh1jK' && f('https://www.youtube.com/shorts/abcdefghijk') === 'abcdefghijk'
      && f('https://www.youtube.com/watch?v=abcdef') === null && f('https://www.youtube.com/watch?v=abcdefghij') === null && f('https://www.youtube.com/watch?v=abcdefghijkl') === null && f('https://youtu.be/abcdef') === null && f('https://youtu.be/abcdefghijkl') === null && f('https://www.youtube.com/shorts/abcdefghijkl') === null && f('https://www.youtube.com/embed/abcdefghijk/x') === 'abcdefghijk'; }));
    heading('a title with markup is text, not markup (the site strips <> and the page prints text)');
    {
      const jx = (await req(port, 'POST', '/api/jobs', { code: code, body: { url: 'https://www.youtube.com/watch?v=xssxssxssxs', title: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>' } })).body.job;
      await goAdd(pg); await refresh(pg);
      ok('the list shows the title as plain text; no element was made from it and no script ran', await pg.evaluate(() => !window.__xss && !document.querySelector('[data-home-jobs] img') && !document.querySelector('[data-home-jobs] script')) && /img src=x onerror/.test(await text(pg, '[data-home-job="' + jx.id + '"]')));
      await pg.evaluate(id => document.querySelector('[data-home-cancel="' + id + '"]').click(), jx.id); await sleep(600);
      await pg.evaluate(id => document.querySelector('[data-home-remove="' + id + '"]').click(), jx.id); await sleep(600);
    }

    heading('a new PC token from the page: asked twice, the old token dies at once');
    await goSettings(pg);
    await openMore(pg);
    await click(pg, '[data-home-token-rotate]'); await sleep(300);
    ok('"New PC token" (under More) asks first (the old token would stop at once); nothing is sent yet', (await has(pg, '[data-home-confirm="rotate"]')) && /old token stops working at once/.test(await text(pg, '[data-home-confirm]')) && !pg.__rec.posts.some(p => /worker-token/.test(p.path)));
    await click(pg, '[data-home-confirm-no]'); await sleep(300);
    ok('Cancel puts the question away and sends nothing; the token still works', !(await has(pg, '[data-home-confirm]')) && !pg.__rec.posts.some(p => /worker-token/.test(p.path)) && (await req(port, 'GET', '/api/worker/ping', { token: tokenNow })).status === 200);
    await click(pg, '[data-home-token-rotate]'); await sleep(300);
    await click(pg, '[data-home-confirm-yes]');
    await pg.waitForSelector('[data-home-new]', { timeout: 8000 });
    const token2 = await val(pg, '[data-home-token-value]');
    ok('Yes: a new token is shown once (not a code: the code is not shown again), with the one line to change', /^ppw_/.test(token2) && token2 !== token0 && !(await has(pg, '[data-home-code-value]')) && /Your new PC token/.test(await text(pg, '[data-home-new]')) && /"token": "/.test(await text(pg, '[data-home-steps]')) && !/siteUrl/.test(await text(pg, '[data-home-steps]')));
    ok('the old token is dead (401) and the new one works; the page keeps its button (the PC has been heard of)', (await req(port, 'GET', '/api/worker/ping', { token: token0 })).status === 401 && (await req(port, 'GET', '/api/worker/ping', { token: token2 })).status === 200 && (await has(pg, '[data-home-link]')));
    tokenNow = token2;
    await click(pg, '[data-home-new-done]'); await sleep(200);
    await goAdd(pg); await refresh(pg);
    ok('and the button is still on the Add screen', await has(pg, '[data-home-pc]'));

    heading('forget on this device: the link stays, the other device is not touched');
    {
      const dev3 = await openPage(browser, base, { store: { 'ppp.pclink.v1': JSON.stringify({ v: 1, code: code }) } });
      await goSettings(dev3);
      ok('a device that already has the code in localStorage shows the link: the one button', await has(dev3, '[data-home-pair-copy]'));
      await openMore(dev3);
      await click(dev3, '[data-home-link-forget]'); await sleep(500);
      ok('Forget on this device: its localStorage is cleared, the card offers to make or use a link again, and the link itself still works on the site', (await stored(dev3)) === null && await has(dev3, '[data-home-link-make]') && !(await has(dev3, '[data-home-link]')) && (await req(port, 'GET', '/api/worker/status', { code: code })).status === 200);
      await goAdd(dev3);
      ok('and its Add screen is as for a device with no link', !(await has(dev3, '[data-home-pc]')) && !(await has(dev3, '[data-home-jobs]')));
      await dev3.close();
    }

    heading('a code the site does not know right now (G10b-5): the device KEEPS it, says so, and asks again; only the person (or three spaced answers over a minute, tests/home-worker/findable.test.js) lets go of it');
    {
      const stale = await openPage(browser, base, { store: { 'ppp.pclink.v1': JSON.stringify({ v: 1, code: 'ab'.repeat(32) }) } });
      await goAdd(stale); await sleep(800);
      ok('the page is told 401 "not valid" ONCE: the code is still in localStorage; the button is there but disabled, with the reason; no list; no polling timer', (await stored(stale)) !== null && await stale.evaluate(() => { const b = document.querySelector('[data-home-pc]'); return !!b && b.disabled === true; })
        && /does not recognise right now/.test(await text(stale, '[data-home-pc-state]')) && !(await has(stale, '[data-home-jobs]')) && !(await stale.evaluate(() => !!window.PPP.app._homeTimer)));
      const countAsked = stale.__rec.requests.filter(r => r === 'GET /api/jobs').length;
      await goSettings(stale);
      ok('Settings says so, with Check again and Remove it; it does not offer to create a new link (this device still holds one), and it asked the site again on opening', /does not recognise right now/.test(await text(stale, '[data-home-unrec-text]')) && await has(stale, '[data-home-unrec-check]') && await has(stale, '[data-home-unrec-remove]') && !(await has(stale, '[data-home-gone]')) && !(await has(stale, '[data-home-link-make]'))
        && stale.__rec.requests.filter(r => r === 'GET /api/jobs').length > countAsked && clean(stale), errs(stale));
      await click(stale, '[data-home-unrec-remove]'); await sleep(500);
      ok('Remove it: this device lets go of the code (the person said so); the card is back to "Create my PC link"', (await stored(stale)) === null && await has(stale, '[data-home-link-make]') && !(await has(stale, '[data-home-unrec]')));
      await stale.close();
    }

    heading('removing the link from the page: asked twice; everything of it is gone, for every device that has the code');
    {
      const devB = await openPage(browser, base, { store: { 'ppp.pclink.v1': JSON.stringify({ v: 1, code: code }) } });
      await goAdd(devB); await refresh(devB);
      ok('(a second device that has the code, and sees the conversions)', (await devB.evaluate(() => document.querySelectorAll('[data-home-job]').length)) >= 1);
      await goSettings(pg);
      await openMore(pg);
      await click(pg, '[data-home-link-remove]'); await sleep(300);
      ok('"Remove link" (under More) asks first: its conversions are deleted, the PC stops, every device with the code loses it; nothing is sent yet', (await has(pg, '[data-home-confirm="remove"]')) && /conversions are deleted/.test(await text(pg, '[data-home-confirm]')) && !pg.__rec.posts.some(p => p.method === 'DELETE' && /pc-links/.test(p.path)));
      await click(pg, '[data-home-confirm-yes]'); await sleep(900);
      ok('Yes: DELETE /api/pc-links/me with the code; this device\'s localStorage is cleared, the card is back to "Create my PC link"; the Add screen has no button and no list', pg.__rec.posts.some(p => p.method === 'DELETE' && p.path === '/api/pc-links/me') && (await stored(pg)) === null && await has(pg, '[data-home-link-make]') && !(await has(pg, '[data-home-link]')));
      await goAdd(pg);
      ok('(the Add screen of this device)', !(await has(pg, '[data-home-pc]')) && !(await has(pg, '[data-home-jobs]')));
      ok('the PC token is refused at once (401), the code is refused (401), and the conversions are gone from the site', (await req(port, 'POST', '/api/worker/claim', { token: tokenNow, body: {} })).status === 401 && (await req(port, 'GET', '/api/jobs', { code: code })).status === 401);
      await refresh(devB);
      ok('the other device finds out at its next look - and keeps the code (G10b-5: one answer of "not valid" proves nothing): the state is "unrecognised", no list, the button disabled', (await stored(devB)) !== null && !(await has(devB, '[data-home-jobs]')) && await devB.evaluate(() => { const b = document.querySelector('[data-home-pc]'); return !!b && b.disabled === true; }) && await devB.evaluate(() => !!window.PPP.app.state.homeUnrec));
      await devB.close();
      ok('no page or console error', clean(pg), errs(pg));
    }
    await pg.close();

    heading('a server whose queue is switched off: no button, no list, no Settings card; a passing failure hides nothing');
    {
      const off = await openPage(browser, base, { queue503: 'off', store: { 'ppp.pclink.v1': JSON.stringify({ v: 1, code: 'cd'.repeat(32) }) } });
      await goAdd(off); await sleep(700);
      ok('with a link on the device: the queue answers 503 "store" marked disabled: no button, no note, no list on Add sheet music', !(await has(off, '[data-home-pc]')) && !(await has(off, '[data-home-note]')) && !(await has(off, '[data-home-jobs]')));
      await goSettings(off);
      ok('and no "Connect my PC" card on Settings (there would be nothing to connect to)', !(await has(off, '[data-home-settings]')) && await off.evaluate(() => window.PPP.app.state.homeOff === true));
      ok('the page asked the server, and sets no timer to ask again', off.__rec.requests.some(r => r === 'GET /api/jobs') && !(await off.evaluate(() => !!window.PPP.app._homeTimer)));
      ok('the Add sheet music card is otherwise as ever: "Make sheet music" is there', await off.evaluate(() => { window.PPP.app.go('upload')(); return new Promise(r => setTimeout(() => r([...document.querySelectorAll('[data-youtube] button')].some(b => /Make sheet music/.test(b.innerText))), 700)); }));
      ok('no page or console error', clean(off), errs(off));
      await off.close();
      const off2 = await openPage(browser, base, { queue503: 'off' });
      await goSettings(off2); await sleep(500);
      ok('a device with NO link learns it from the one probe of the Settings screen: the card is not offered', !(await has(off2, '[data-home-settings]')) && off2.__rec.requests.filter(r => /^GET \/api\/worker\/status/.test(r)).length === 1 && queued(off2).length === 1, queued(off2).join());
      await off2.close();
      const blip = await openPage(browser, base, { queue503: 'blip' });
      await goSettings(blip);
      ok('a 503 that is not marked disabled (a passing failure of the store) leaves the Settings card where it is', await has(blip, '[data-home-settings]') && !(await blip.evaluate(() => window.PPP.app.state.homeOff)));
      await click(blip, '[data-home-link-make]'); await sleep(700);
      ok('and making a link then says so (an error line), keeps the card, and makes no link on this device', /not available right now/.test(await text(blip, '[data-home-error]')) && await has(blip, '[data-home-link-make]') && (await stored(blip)) === null);
      await blip.close();
    }

    heading('Korean, Japanese, Chinese');
    for (const [loc, want] of [
      ['ko-KR', { btn: '고품질 변환 (내 PC)', st: 'PC를 기다리는 중', note: '약 한 시간에 한 번', card: '내 PC 연결', make: '내 PC 링크 만들기', warn: '나에게만 보내세요', nolog: '계정이나 로그인 없이', use: '다른 기기의 PC 링크 쓰기', shown: '내 PC 코드 보기', rot: '새 PC 토큰', rm: '링크 지우기' }],
      ['ja-JP', { btn: '高品質変換（自分のPC）', st: 'PCを待っています', note: '約1時間に1回', card: '自分のPCを接続', make: '自分のPCリンクを作る', warn: '自分だけに送ってください', nolog: 'アカウントやログインは不要', use: '別の端末のPCリンクを使う', shown: 'PCコードを表示', rot: '新しいPCトークン', rm: 'リンクを削除' }],
      ['zh-CN', { btn: '高质量转换（我的电脑）', st: '等待你的电脑', note: '大约每小时', card: '连接我的电脑', make: '创建我的电脑链接', warn: '请只发给你自己', nolog: '无需账号或登录', use: '使用另一台设备的电脑链接', shown: '显示我的电脑代码', rot: '新电脑令牌', rm: '删除链接' }]]) {
      const lp = await openPage(browser, base, { locale: loc });
      await goSettings(lp);
      await openMore(lp);
      ok(loc + ': the card of a device with no link is in the person\'s language (title, no-sign-in line, the button, the other-device form)', (await text(lp, '[data-home-settings]')).indexOf(want.card) >= 0 && (await text(lp, '[data-home-no-account]')).indexOf(want.nolog) >= 0 && (await text(lp, '[data-home-link-make]')).indexOf(want.make) >= 0 && (await text(lp, '[data-home-use]')).indexOf(want.use) >= 0, (await text(lp, '[data-home-settings]')).slice(0, 120));
      await click(lp, '[data-home-link-make]');
      await lp.waitForSelector('[data-home-new]', { timeout: 8000 });
      await sleep(400);
      const t = await val(lp, '[data-home-token-value]');
      ok(loc + ': the warning to keep the secrets is in the person\'s language, and the steps', (await text(lp, '[data-home-warning]')).indexOf(want.warn) >= 0 && !/^1\. On your PC/.test(await text(lp, '[data-home-steps]')), (await text(lp, '[data-home-warning]')).slice(0, 80));
      await click(lp, '[data-home-new-done]'); await sleep(300);
      await openMore(lp);
      ok(loc + ': the buttons of the link (show the code, new token, remove)', (await text(lp, '[data-home-code-show]')).indexOf(want.shown) >= 0 && (await text(lp, '[data-home-token-rotate]')).indexOf(want.rot) >= 0 && (await text(lp, '[data-home-link-remove]')).indexOf(want.rm) >= 0);
      await req(port, 'POST', '/api/worker/claim', { token: t, body: { once: true } });
      await goAdd(lp); await refresh(lp);
      await typeLink(lp, YT);
      await click(lp, '[data-home-pc]');
      await lp.waitForSelector('[data-home-job]', { timeout: 8000 });
      await sleep(700);
      ok(loc + ': the button, the note and the status are in the person\'s language', (await text(lp, '[data-home-pc]')).indexOf(want.btn) >= 0 && (await text(lp, '[data-home-note]')).indexOf(want.note) >= 0 && (await text(lp, '[data-home-status]')).indexOf(want.st) >= 0,
        [await text(lp, '[data-home-pc]'), await text(lp, '[data-home-status]')].join(' | '));
      await goSettings(lp);
      await openMore(lp);
      await click(lp, '[data-home-link-remove]'); await sleep(300);
      ok(loc + ': the question before removing is in the person\'s language too', (await text(lp, '[data-home-confirm]')).length > 20 && !/Remove this PC link/.test(await text(lp, '[data-home-confirm]')), (await text(lp, '[data-home-confirm]')).slice(0, 60));
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
