/* ============================================================================
   G10b-5: "THE HIGH-QUALITY BUTTON IS ALWAYS FINDABLE, AND A PC LINK IS NEVER FORGOTTEN ON ONE 401", in the real page against the real server (tests/serve-free.js).

   What the user hit (2026-10-08, a screenshot of the Add screen with a YouTube link typed and only "Make sheet music"): "where on earth is the high-quality conversion?" The button had been
   shown only when this browser had a PC link AND the worker status had loaded AND the PC had been seen - and the page forgot its only copy of the code on the FIRST answer of 401.

     - the states of the button on the Add screen (a YouTube link typed):
         no link (queue on)            a secondary "High-quality (my PC)" button -> a sheet with the exact one-tap path; the sheet shows no secret and creates nothing
         link, status loading          the button, enabled, "Checking your PC…"
         link, status failed           the button, enabled, "Could not check your PC right now…"
         link, PC never seen           the button, enabled, "Your PC has not connected yet: it will take the job when it does" (and it queues the job)
         link, PC seen                 the button as before, with its note
         link, not recognised          the button DISABLED, with the reason and "Check again"
         "Full song" recording type    nothing; the site's queue switched off: nothing; storage blocked: nothing
     - a code the site does not recognise (401 "bad-code") is KEPT: the state is "unrecognised", the site is asked again now, +5 s and +30 s (a fake clock), on every opening of the Add and Settings
       screens and when the tab is seen again; the code is let go of only by "Remove it", or after three answers each at least 4 s after the one before, the first at least 60 s ago
     - Settings says it, with Check again and Remove it
     - the pairing banner is in the flow of the page (above the header, not over it) at 400 px, with its buttons reachable
     - Korean, Japanese and Chinese; the catalogs hold every new sentence; 400 px layout (screenshots when PPP_SHOTS_DIR is set)

   node tests/home-worker/findable.test.js   (needs puppeteer: NODE_PATH=D:/PPP/node_modules if this tree has none)
   HOME_MODULES_DIR=<dir>: serve <dir>/Piano Coach App.dc.html as the page (the mutation runner, tests/home-worker/mutants.js)   HOME_FAIL_FAST: stop at the first failed check */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const L = require('./lib');
const { sleep, heading, req } = L;
const ok = (name, cond, detail) => { L.ok(name, cond, detail); if (!cond && process.env.HOME_FAIL_FAST) throw new Error('stopped at the first failed check: ' + name); };
const { startServer } = require('../serve-free');

const PAGE_FILE = path.join(L.MODS, 'Piano Coach App.dc.html');
const SHOTS = process.env.PPP_SHOTS_DIR || '';
const KEY = 'ppp.pclink.v1';
const YT = 'https://www.youtube.com/watch?v=vgnliVjJUOo';
const UNREC = 'This device holds a PC link that the site does not recognise right now.';
const STEP_PC = 'On your PC double-click the desktop shortcut “PPP connect my devices (pair)”: it opens PPP already connected.';
const STEP_OTHER = 'From another device: open the link you copied with “Connect another device: copy link”.';
const NEW_KEYS = ['Checking your PC…', 'Your PC has not connected yet: it will take the job when it does', 'Could not check your PC right now. You can still send the job.', UNREC, 'Remove it',
  'The PC link was removed from this device.', 'High-quality conversion uses your own PC. This device is not connected to it yet. The quickest way:', STEP_PC, STEP_OTHER, 'More in Settings'];

/* a page in a context of its own. o: locale, store (localStorage before the page runs), block ('set' | 'all'), width, height, noGuest, queue ('off'), ctl (see below) */
let pageCount = 0;
async function openPage(browser, srv, hash, o) {
  o = o || {};
  const pageNo = ++pageCount;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  /* what the test tells the page's network to do: bad (the next N looks at the list answer 401 "bad-code"), badAlways, badPost (the next N asks to queue answer 401), fail (503, not marked disabled),
     hold (a promise: the list is not answered until it is settled) */
  const ctl = { bad: 0, badAlways: false, badPost: 0, fail: false, hold: null };
  const rec = { requests: [], posts: [], errors: [], pageErrors: [] };
  page.__rec = rec; page.__ctl = ctl;
  await page.evaluateOnNewDocument(opts => {
    try { localStorage.setItem('ppp-locale', opts.locale); if (!opts.noGuest) localStorage.setItem('ppp-guest', '1'); } catch (e) { /* blocked */ }
  }, { locale: o.locale || 'en-US', noGuest: !!o.noGuest });
  if (o.store) await page.evaluateOnNewDocument(st => { try { Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); } catch (e) { /* blocked */ } }, o.store);
  if (o.block === 'set') await page.evaluateOnNewDocument(() => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  if (o.block === 'all') await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); });
  /* a clock the test holds (Date.now is frozen where the test says so) and the page's longer timers (1 s and more) caught instead of scheduled, so that a test can say "5 seconds later" */
  await page.evaluateOnNewDocument(() => {
    window.__clock = { t: null, base: 0 };
    const realNow = Date.now.bind(Date);
    Date.now = () => (window.__clock.t === null ? realNow() : window.__clock.t);
    window.__timers = null;
    const rst = window.setTimeout.bind(window), rct = window.clearTimeout.bind(window);
    let n = 1e9;
    window.setTimeout = function (f, ms) { if (window.__timers && ms >= 1000 && typeof f === 'function') { const id = ++n; window.__timers.push({ id: id, f: f, ms: ms }); return id; } return rst.apply(null, arguments); };
    window.clearTimeout = function (id) { if (window.__timers) { const i = window.__timers.findIndex(t => t.id === id); if (i >= 0) { window.__timers.splice(i, 1); return; } } return rct(id); };
  });
  await page.setRequestInterception(true);
  page.on('request', async r => {
    const u = r.url(), p = u.replace(/^https?:\/\/[^/]+/, '');
    rec.requests.push(r.method() + ' ' + p);
    if (r.method() !== 'GET' && /\/api\/(jobs|worker|pc-links)/.test(p)) rec.posts.push({ method: r.method(), path: p, body: r.postData() });
    if (/:8788\/|\/helper(\/|$|\?)/.test(u)) return r.abort();
    if (/\/api\/youtube-title/.test(p) || /youtube\.com\/oembed/.test(u)) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Teacher Piece' }) });
    const json = (status, body) => r.respond({ status: status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
    if (o.queue === 'off' && /^\/api\/(jobs|worker|pc-links)(\/|\?|$)/.test(p)) return json(503, { error: 'The queue is not available right now. Try again in a minute.', code: 'store', disabled: true });
    const jobsGet = r.method() === 'GET' && /^\/api\/jobs(\?|$)/.test(p), jobsPost = r.method() === 'POST' && /^\/api\/jobs$/.test(p);
    if (jobsGet && ctl.hold) await ctl.hold;
    if (jobsGet && ctl.fail) return json(503, { error: 'The queue is not available right now. Try again in a minute.', code: 'store' });
    if (jobsGet && (ctl.badAlways || ctl.bad > 0)) { if (ctl.bad > 0) ctl.bad--; return json(401, { error: 'That PC link is not valid.', code: 'bad-code' }); }
    if (jobsPost && ctl.badPost > 0) { ctl.badPost--; return json(401, { error: 'That PC link is not valid.', code: 'bad-code' }); }
    if (o.baseHtml && r.resourceType() === 'document' && r.method() === 'GET' && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: o.baseHtml, headers: { 'Cache-Control': 'no-store' } });
    if (process.env.HOME_MODULES_DIR && r.resourceType() === 'document' && r.method() === 'GET' && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) {
      return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(PAGE_FILE), headers: { 'Cache-Control': 'no-store' } });
    }
    r.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) rec.errors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto('http://127.0.0.1:' + srv.port + '/' + (hash || ''), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  await sleep(400);
  return page;
}
const { execFileSync } = require('child_process');
const clean = p => p.__rec.errors.length === 0 && p.__rec.pageErrors.length === 0;
const errs = p => JSON.stringify(p.__rec.errors.concat(p.__rec.pageErrors));
const has = (p, sel) => p.evaluate(q => !!document.querySelector(q), sel);
const text = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const click = (p, sel) => p.evaluate(q => document.querySelector(q).click(), sel);
const stored = p => p.evaluate(k => { try { return localStorage.getItem(k); } catch (e) { return 'ERR'; } }, KEY);
const goAdd = async p => { await p.evaluate(() => window.PPP.app.go('upload')()); await p.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(700); };
const goSettings = async p => { await p.evaluate(() => window.PPP.app.go('settings')()); await sleep(900); };
const typeLink = async (p, url) => {
  await p.evaluate(() => { document.querySelector('[data-youtube-url]').value = ''; });
  await p.type('[data-youtube-url]', url);
  await p.evaluate(() => document.querySelector('[data-youtube-url]').dispatchEvent(new Event('change', { bubbles: true })));
  await sleep(250);
};
const shot = async (p, sel, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const el = sel ? await p.$(sel) : null; if (sel && !el) return; if (el) { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(150); await el.screenshot({ path: path.join(SHOTS, name) }); } else await p.screenshot({ path: path.join(SHOTS, name) }); };
/* what the YouTube card shows of the PC button */
const addState = p => p.evaluate(() => {
  const q = s => document.querySelector(s), pc = q('[data-home-pc]'), help = q('[data-home-pc-help]'), st = q('[data-home-pc-state]');
  return { pc: !!pc, disabled: pc ? pc.disabled : null, aria: pc ? pc.getAttribute('aria-disabled') : null, label: pc ? pc.innerText.trim() : null, help: !!help, helpLabel: help ? help.innerText.trim() : null,
    kind: st ? st.getAttribute('data-home-pc-state') : null, stateText: st ? st.innerText.trim().split('\n')[0] : null, recheck: !!q('[data-home-pc-recheck]'), note: !!q('[data-home-note]'), jobs: !!q('[data-home-jobs]') };
});
/* the test's clock: from startClock on, Date.now() is what the test says (seconds since the start) and the page's timers of 1 s and more are caught */
const startClock = p => p.evaluate(() => { window.__clock.base = Date.now(); window.__clock.t = window.__clock.base; window.__timers = []; });
const clockAt = (p, s) => p.evaluate(sec => { window.__clock.t = window.__clock.base + Math.round(sec * 1000); }, s);
const timers = p => p.evaluate(() => (window.__timers || []).map(t => t.ms));
/* the page's caught timers fire (what the passing of time would do), and the page gets a moment to ask the site */
const fireTimers = async p => { const ms = await p.evaluate(() => { const ts = window.__timers.splice(0); ts.forEach(t => t.f()); return ts.map(t => t.ms); }); await sleep(700); return ms; };
/* a PC link of the site, made as a browser makes it; seen: its PC has checked in */
let linkNo = 0;
const mkLink = async (srv, seen) => {
  const r = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '10.88.' + (++linkNo) + '.1' });
  if (seen) await req(srv.port, 'GET', '/api/worker/ping', { token: r.body.workerToken });
  return { code: r.body.clientCode, token: r.body.workerToken };
};
const storeOf = code => ({ [KEY]: JSON.stringify({ v: 1, code: code }) });
const GONE = 'cd'.repeat(32);          /* a well-formed code that no link of the site has */

(async () => {
  const dir = L.tmpDir('ppp-findable-');
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=en-US'], protocolTimeout: 600000 });
  const pages = [];
  const open = async (...a) => { const p = await openPage(browser, srv, ...a); pages.push(p); return p; };
  try {
    heading('no link on this device: a secondary button, and a sheet with the one-tap path');
    {
      const p = await open('', {});
      await goAdd(p); await typeLink(p, YT);
      let s = await addState(p);
      ok('the Add screen with a YouTube link typed has a "High-quality (my PC)" button that opens the sheet (not the Settings page); the primary button and its note are not there', s.help && s.helpLabel === 'High-quality (my PC)' && !s.pc && !s.note && !s.jobs && !s.kind, JSON.stringify(s));
      ok('it is in the row of "Make sheet music"', await p.evaluate(() => { const h = document.querySelector('[data-home-pc-help]'), m = [...document.querySelectorAll('[data-youtube] button')].find(x => /Make sheet music/.test(x.innerText)); return !!h && !!m && h.parentElement === m.parentElement; }));
      ok('the page asked the site once whether it has the queue (no PC code, nothing about jobs) and asked nothing more', p.__rec.requests.filter(r => /\/api\/(jobs|worker|pc-links)/.test(r)).join() === 'GET /api/worker/status', p.__rec.requests.filter(r => /\/api\/(jobs|worker|pc-links)/.test(r)).join());
      await shot(p, '[data-youtube]', 'g10b5-nolink-card-1100-en.png');
      await click(p, '[data-home-pc-help]'); await sleep(400);
      const sheet = await text(p, '[data-home-sheet]');
      ok('the sheet opens over the Add screen (a dialog), and the screen is still the Add screen', await has(p, '[data-home-sheet] [role="dialog"][aria-modal="true"]') && (await p.evaluate(() => window.PPP.app.state.screen)) === 'upload');
      ok('it says the exact path for the PC: double-click the desktop shortcut “PPP connect my devices (pair)”, it opens PPP already connected', (await text(p, '[data-home-sheet-step="pc"]')) === STEP_PC, String(await text(p, '[data-home-sheet-step="pc"]')));
      ok('and for another device: open the link copied with “Connect another device: copy link”', (await text(p, '[data-home-sheet-step="other"]')) === STEP_OTHER, String(await text(p, '[data-home-sheet-step="other"]')));
      ok('a "More in Settings" link and a Close button', (await text(p, '[data-home-sheet-settings]')) === 'More in Settings' && await has(p, '[data-home-sheet-close]'));
      const html = await p.evaluate(() => document.querySelector('[data-home-sheet]').outerHTML);
      ok('the sheet shows no secret: no 64-hex code, no PC token (ppw_), no pairing link (#pc=), no input field', !/[0-9a-f]{64}/i.test(html + sheet) && !/ppw_/.test(html + sheet) && !/#pc=/.test(html + sheet) && !/<input|<textarea/i.test(html), sheet.slice(0, 80));
      ok('opening it created nothing: no link in this browser, no request to make one, nothing sent to the queue but the one probe', (await stored(p)) === null && !p.__rec.posts.length && (await p.evaluate(() => Object.keys(localStorage).filter(k => /pclink/.test(k)).length)) === 0, JSON.stringify(p.__rec.posts));
      await shot(p, null, 'g10b5-sheet-1100-en.png');
      await click(p, '[data-home-sheet-close]'); await sleep(250);
      ok('Close puts it away', !(await has(p, '[data-home-sheet]')));
      await click(p, '[data-home-pc-help]'); await sleep(250);
      await p.keyboard.press('Escape'); await sleep(250);
      ok('Escape puts it away', !(await has(p, '[data-home-sheet]')));
      await click(p, '[data-home-pc-help]'); await sleep(250);
      await click(p, '[data-home-sheet-backdrop]'); await sleep(250);
      ok('so does a tap outside it', !(await has(p, '[data-home-sheet]')));
      await click(p, '[data-home-pc-help]'); await sleep(250);
      await p.evaluate(() => window.PPP.app.go('songs')()); await sleep(600);
      ok('the sheet does not follow the person to another screen', !(await has(p, '[data-home-sheet]')) && (await p.evaluate(() => window.PPP.app.state.screen)) === 'songs');
      await goAdd(p);
      await click(p, '[data-home-pc-help]'); await sleep(250);
      await click(p, '[data-home-sheet-settings]'); await sleep(900);
      ok('"More in Settings" goes to the Settings page (the sheet is put away); the card there offers "Create my PC link"; still nothing was created', (await p.evaluate(() => window.PPP.app.state.screen)) === 'settings' && !(await has(p, '[data-home-sheet]')) && /Create my PC link/.test(await text(p, '[data-home-link-make]')) && (await stored(p)) === null && !p.__rec.posts.length);
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('a link whose status has not come yet: the button is there, enabled, "Checking your PC…"; then the PC has not connected yet; and the job is queued all the same');
    {
      const A = await mkLink(srv, false);
      const p = await open('', { store: storeOf(A.code) });
      let release; p.__ctl.hold = new Promise(res => { release = res; });
      await p.evaluate(() => window.PPP.app.go('upload')()); await p.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(500);
      await typeLink(p, YT);
      let s = await addState(p);
      ok('while the status is on its way: the button is shown and enabled, with the one line "Checking your PC…" under it; no secondary button', s.pc && s.disabled === false && s.kind === 'checking' && s.stateText === 'Checking your PC…' && !s.help && !s.note && !s.jobs, JSON.stringify(s));
      release(); await sleep(900);
      s = await addState(p);
      ok('the site answers: the PC of this link has never connected - the button stays, enabled, the line says "Your PC has not connected yet: it will take the job when it does"; no note yet', s.pc && s.disabled === false && s.kind === 'never-seen' && s.stateText === 'Your PC has not connected yet: it will take the job when it does' && !s.note && !s.help, JSON.stringify(s));
      await shot(p, '[data-youtube]', 'g10b5-neverseen-card-1100-en.png');
      await click(p, '[data-home-pc]');
      await p.waitForSelector('[data-home-job]', { timeout: 8000 });
      ok('pressing it queues the conversion (POST /api/jobs with the link), and the list shows it waiting for the PC', p.__rec.posts.some(x => x.path === '/api/jobs' && x.method === 'POST' && JSON.parse(x.body).url === YT) && /Waiting for your PC/.test(await text(p, '[data-home-status]')));
      ok('the site really holds it: one waiting job for this link', (await req(srv.port, 'GET', '/api/jobs', { code: A.code })).body.jobs.filter(j => j.status === 'queued').length === 1);
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('a link whose status check failed (the site not answering): the button is there, enabled, and says so');
    {
      const A = await mkLink(srv, false);
      const p = await open('', { store: storeOf(A.code) });
      p.__ctl.fail = true;
      await goAdd(p); await typeLink(p, YT);
      const s = await addState(p);
      ok('"Could not check your PC right now. You can still send the job." under an enabled button; the code is kept', s.pc && s.disabled === false && s.kind === 'failed' && s.stateText === 'Could not check your PC right now. You can still send the job.' && (await stored(p)) !== null, JSON.stringify(s));
      p.__ctl.fail = false;
      await p.evaluate(() => window.PPP.app.homeRefresh()); await sleep(800);
      ok('and when the site answers again the line follows it (the PC has not connected yet)', (await addState(p)).kind === 'never-seen');
      await p.close();
    }

    heading('a link whose PC has connected: the button as it was, with its note and no state line');
    {
      const A = await mkLink(srv, true);
      const p = await open('', { store: storeOf(A.code) });
      await goAdd(p); await typeLink(p, YT);
      const s = await addState(p);
      ok('the button, enabled, the honest note, no state line, no secondary button', s.pc && s.disabled === false && s.aria === 'false' && s.label === 'High-quality (my PC)' && s.note && s.kind === null && !s.help, JSON.stringify(s));
      ok('"Full song" hides it (and puts it back with another recording type)', await (async () => {
        await p.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' })); await sleep(300);
        const a = await addState(p);
        await p.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'auto' })); await sleep(300);
        const b = await addState(p);
        return !a.pc && !a.help && a.kind === null && !a.note && b.pc;
      })());
      await p.close();
      const q = await open('', { store: storeOf((await mkLink(srv, false)).code) });
      await goAdd(q); await sleep(500);
      await q.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' })); await sleep(300);
      const a2 = await addState(q);
      ok('"Full song" hides it for a link whose PC has not connected too, with its line', !a2.pc && !a2.help && a2.kind === null, JSON.stringify(a2));
      await q.close();
      const n = await open('', {});
      await goAdd(n); await n.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' })); await sleep(300);
      const a3 = await addState(n);
      ok('"Full song" hides the secondary button of a device with no link', !a3.help && !a3.pc, JSON.stringify(a3));
      await n.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'solo' })); await sleep(300);
      ok('and "Solo piano" shows it', (await addState(n)).help);
      await n.close();
    }

    heading('the site has the queue switched off, or the browser cannot keep a link: nothing is offered, and the Add card is the old one, tag for tag');
    {
      /* b7f9fb5: main as it was before G10b-2 (the card of a device that has nothing of the feature) */
      let baseHtml = null;
      try { baseHtml = execFileSync('git', ['show', 'b7f9fb5:Piano Coach App.dc.html'], { cwd: L.REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { baseHtml = null; }
      const cardOf = p => p.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('[data-add-sheet]').outerHTML.replace(/\s+/g, ' ').replace(/ data-reactroot=""/g, '')), 300)));
      let oldCard = null;
      if (baseHtml) { const old = await open('', { baseHtml: baseHtml }); await goAdd(old); oldCard = await cardOf(old); await old.close(); } else console.log('  - git history of b7f9fb5 not available: the identical-card checks of this section are skipped');
      const off = await open('', { queue: 'off' });
      await goAdd(off); await sleep(600);
      ok('no link, queue off: no button of any kind, no state line', await (async () => { const s = await addState(off); return !s.pc && !s.help && !s.kind; })());
      if (oldCard) ok('and the Add card of that visitor is the one of main before the feature, tag for tag (' + oldCard.length + ' characters)', (await cardOf(off)) === oldCard, '');
      await off.close();
      const off2 = await open('', { queue: 'off', store: storeOf((await mkLink(srv, true)).code) });
      await goAdd(off2); await sleep(600);
      ok('a link on the device, queue off: no button, no state line, no note, no list', await (async () => { const s = await addState(off2); return !s.pc && !s.help && !s.kind && !s.note && !s.jobs; })());
      await off2.close();
      for (const mode of ['set', 'all']) {
        const pw = await open('', { block: mode });
        await pw.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Continue as guest/.test(x.innerText || '')); if (b) b.click(); });
        await sleep(500);
        await goAdd(pw); await sleep(400);
        if (oldCard) ok('(' + mode + ') and the Add card of that visitor is the one of main before the feature, tag for tag', (await cardOf(pw)) === oldCard, '');
        ok('(' + mode + ') storage blocked: no button of any kind, no request to the queue, no error', await (async () => { const s = await addState(pw); return !s.pc && !s.help && !s.kind; })() && !pw.__rec.requests.some(r => /\/api\/(jobs|worker|pc-links)/.test(r)) && clean(pw), pw.__rec.requests.join(' | ') + errs(pw));
        await pw.close();
      }
    }

    heading('one answer of "not valid": the code is kept, the button is disabled with the reason, the site is asked again (now, +5 s, +30 s) - and it recovers when the site knows the code again');
    {
      const A = await mkLink(srv, true);
      const p = await open('', { store: storeOf(A.code) });
      p.__ctl.bad = 1;                       /* the site does not know the code ONCE (a restart, a cold start, a hiccup), then it does */
      await startClock(p);
      await goAdd(p); await typeLink(p, YT);
      let s = await addState(p), t = await timers(p);
      ok('after ONE 401: the code is still in localStorage (nothing was forgotten)', (await stored(p)) !== null && JSON.parse(await stored(p)).code === A.code);
      ok('the button is there but disabled (disabled and aria-disabled), with the reason under it and a Check again button', s.pc && s.disabled === true && s.aria === 'true' && s.kind === 'unrecognised' && s.stateText === UNREC && s.recheck && !s.help && !s.note, JSON.stringify(s));
      ok('the site will be asked again in 5 s (a timer of 5000 ms is set; none of the page\'s polling timers)', t.length === 1 && t[0] === 5000, JSON.stringify(t));
      await shot(p, '[data-youtube]', 'g10b5-unrecognised-card-1100-en.png');
      const before = p.__rec.posts.length;
      await p.evaluate(() => document.querySelector('[data-home-pc]').click()); await sleep(300);
      ok('pressing the disabled button asks nothing of the site', p.__rec.posts.length === before);
      await clockAt(p, 5.2);
      const fired = await fireTimers(p);
      s = await addState(p);
      ok('5 s later the timer fires and the site is asked: it knows the code again - the button is enabled, the PC is "connected" (note), no reason line, no Check again', fired.length >= 1 && s.pc && s.disabled === false && s.kind === null && s.note && !s.recheck, JSON.stringify({ fired: fired, s: s }));
      ok('the code was never touched', JSON.parse(await stored(p)).code === A.code && !(await p.evaluate(() => !!window.PPP.app.state.homeUnrec)));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('the site does not know the code at all: nothing is let go of before three spaced answers over a minute; then it is, and the device says so');
    {
      const p = await open('', { store: storeOf(GONE) });
      p.__ctl.badAlways = true;
      await startClock(p); await clockAt(p, 0);
      await goAdd(p);
      const kept = async () => (await stored(p)) !== null && JSON.parse(await stored(p)).code === GONE;
      let t = await timers(p);
      ok('t = 0 s, answer 1: kept; "unrecognised"; the next look is in 5 s', (await kept()) && (await addState(p)).kind === 'unrecognised' && t.length === 1 && t[0] === 5000, JSON.stringify(t));
      await clockAt(p, 5.2); await fireTimers(p); t = await timers(p);
      ok('t = 5.2 s, answer 2: kept; the next look is at 30 s (24.8 s from now)', (await kept()) && t.length === 1 && t[0] === 24800, JSON.stringify(t));
      await clockAt(p, 30.5); await fireTimers(p); t = await timers(p);
      ok('t = 30.5 s, answer 3: STILL kept (three answers, but over 30 s, not a minute); no more timers - from here on it is looked at when the Add or Settings screen opens or the tab is seen', (await kept()) && t.length === 0 && (await addState(p)).kind === 'unrecognised', JSON.stringify(t));
      await clockAt(p, 31); await click(p, '[data-home-pc-recheck]'); await sleep(700);
      ok('t = 31 s, Check again: kept (an answer 0.5 s after the last is not a new one)', await kept());
      await clockAt(p, 45); await goSettings(p);
      ok('Settings says so, with Check again and Remove it; it has no "Create my PC link" (the device holds a link) and no "no longer valid" line', (await text(p, '[data-home-unrec-text]')) === UNREC && (await text(p, '[data-home-unrec-check]')) === 'Check again' && (await text(p, '[data-home-unrec-remove]')) === 'Remove it' && !(await has(p, '[data-home-link-make]')) && !(await has(p, '[data-home-gone]')));
      ok('and it does not offer to copy a pairing link of a link the site does not recognise', !(await has(p, '[data-home-pair-copy]')));
      await shot(p, '[data-home-settings]', 'g10b5-unrecognised-settings-1100-en.png');
      await goAdd(p); await sleep(300);
      ok('t = 45 s, the screens opened: kept (the first answer was 45 s ago, not 60)', await kept());
      await clockAt(p, 62);
      await click(p, '[data-home-pc-recheck]'); await sleep(900);
      ok('t = 62 s, Check again: the site has said "not valid" on spaced looks over a minute - the code is let go of (localStorage empty)', (await stored(p)) === null);
      const s = await addState(p);
      ok('the Add screen is as for a device with no link: the secondary button, no primary one, no reason line', s.help && !s.pc && !s.kind, JSON.stringify(s));
      await goSettings(p);
      ok('Settings says the link is no longer valid and offers to create a new one', /no longer valid/.test(await text(p, '[data-home-gone]')) && await has(p, '[data-home-link-make]') && !(await has(p, '[data-home-unrec]')));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('answers that come too fast are one answer: pressing Check again again and again does not use the code up');
    {
      const p = await open('', { store: storeOf(GONE) });
      p.__ctl.badAlways = true;
      await startClock(p); await clockAt(p, 0);
      await goAdd(p);
      for (const s of [0.5, 1, 1.5, 2, 2.5]) { await clockAt(p, s); await click(p, '[data-home-pc-recheck]'); await sleep(500); }
      await clockAt(p, 61); await click(p, '[data-home-pc-recheck]'); await sleep(800);
      ok('six looks within 2.5 s and one at 61 s: two answers that count, so the code is kept', (await stored(p)) !== null);
      await clockAt(p, 70); await click(p, '[data-home-pc-recheck]'); await sleep(800);
      ok('one more at 70 s (9 s after the last that counted): three that count, the first over a minute ago - now it is let go of', (await stored(p)) === null);
      await p.close();
    }

    heading('a tab that is seen again, and the screens, look again (after the timers have run out)');
    {
      const A = await mkLink(srv, true);
      const p = await open('', { store: storeOf(A.code) });
      p.__ctl.badAlways = true;
      await startClock(p); await clockAt(p, 0);
      await goAdd(p);
      await clockAt(p, 5.2); await fireTimers(p); await clockAt(p, 30.5); await fireTimers(p);
      ok('(three answers, no timers left, still unrecognised)', (await timers(p)).length === 0 && (await addState(p)).kind === 'unrecognised');
      p.__ctl.badAlways = false;
      await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(900);
      const s = await addState(p);
      ok('the tab is seen again (visibilitychange): the site is asked, knows the code, and the button is back to normal', s.pc && s.disabled === false && s.kind === null && s.note && JSON.parse(await stored(p)).code === A.code, JSON.stringify(s));
      await p.close();
      const q = await open('', { store: storeOf(A.code) });
      q.__ctl.bad = 1;
      await startClock(q); await clockAt(q, 0);
      await goAdd(q);
      ok('(one answer, unrecognised)', (await addState(q)).kind === 'unrecognised');
      await goSettings(q);
      ok('opening Settings asks again: the site knows the code now, the unrecognised card is gone and the status line is back', !(await has(q, '[data-home-unrec]')) && /PC connected/.test(await text(q, '[data-home-status-line]')), String(await text(q, '[data-home-status-line]')));
      await q.close();
    }

    heading('"Remove it": the person lets go of the code - at once, with no waiting; the link itself is not touched');
    {
      const A = await mkLink(srv, true);
      const p = await open('', { store: storeOf(A.code) });
      p.__ctl.badAlways = true;
      await goSettings(p);
      await click(p, '[data-home-unrec-remove]'); await sleep(600);
      ok('the code is gone from localStorage, the card is back to "Create my PC link", no reason line; the link still exists on the site', (await stored(p)) === null && await has(p, '[data-home-link-make]') && !(await has(p, '[data-home-unrec]')) && (await req(srv.port, 'GET', '/api/worker/status', { code: A.code })).status === 200 && !p.__rec.posts.some(x => x.method === 'DELETE'));
      await goAdd(p);
      ok('and the Add screen has the secondary button', (await addState(p)).help);
      await p.close();
    }

    heading('every other call that hears "not valid" keeps the code too');
    {
      const A = await mkLink(srv, true);
      const p = await open('', { store: storeOf(A.code) });
      await goAdd(p); await typeLink(p, YT);
      ok('(the link is fine)', (await addState(p)).pc);
      /* a failed rotate / use of the link calls afterLinkError: it used to forget the code at once */
      await p.evaluate(() => window.PPP.app.afterLinkError({ status: 401, code: 'bad-code', message: 'That PC link is not valid.' })); await sleep(500);
      ok('a "not valid" from the token or removal calls (afterLinkError): the code is kept, the state is "unrecognised"', (await stored(p)) !== null && await p.evaluate(() => !!window.PPP.app.state.homeUnrec));
      await p.close();
      const q = await open('', { store: storeOf(A.code) });
      await goAdd(q); await typeLink(q, YT);
      q.__ctl.badPost = 1;
      await click(q, '[data-home-pc]'); await sleep(900);
      const s = await addState(q);
      ok('asking for a conversion and hearing "not valid": the code is kept, the page says what is wrong in its own words, and the button is disabled', (await stored(q)) !== null && /does not recognise right now/.test(await text(q, '[data-youtube]')) && await q.evaluate(() => !!window.PPP.app.state.homeUnrec) && s.pc, JSON.stringify(s));
      await q.close();
    }

    heading('the pairing banner is in the flow of the page: at 400 px it is above the header, not over it, and its buttons can be reached');
    for (const loc of ['en-US', 'ko-KR']) {
      const A = await mkLink(srv, true), B = await mkLink(srv, true);
      const geo = p => p.evaluate(() => {
        const b = document.querySelector('[data-pair-note]'), h = document.querySelector('.ppp-header'), br = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
        const hit = x => { const r = x.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { t: (x.innerText || '').trim(), top: r.top, bottom: r.bottom, ok: e === x || x.contains(e) }; };
        const hb = [...h.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(hit);
        return { pos: getComputedStyle(b).position, bTop: br.top, bBottom: br.bottom, bLeft: br.left, bRight: br.right, hTop: hr.top, hBottom: hr.bottom, vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
          btns: [...b.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(hit), headerBtns: hb };
      });
      const check = (what, g) => ok(loc + ' 400 px: ' + what + ' - the banner is in the flow (not fixed), ends above the header (' + Math.round(g.bBottom) + ' <= ' + Math.round(g.hTop) + '), is inside the screen, and every button of the banner and of the header can be hit', g.pos !== 'fixed' && g.bBottom <= g.hTop + 1 && g.bLeft >= 0 && g.bRight <= 400 && g.docW <= 400 && g.btns.length >= 1 && g.btns.every(x => x.ok && x.bottom <= g.vh) && g.headerBtns.length >= 1 && g.headerBtns.every(x => x.ok), JSON.stringify(g));
      const p = await open('#pc=' + A.code, { locale: loc, width: 400, height: 900, noGuest: true });
      await p.waitForSelector('[data-pair-note]', { timeout: 15000 }); await sleep(600);
      check('the success banner', await geo(p));
      await shot(p, null, 'g10b5-banner-paired-400-' + loc + '.png');
      await click(p, '[data-pair-note-close]'); await sleep(300);
      ok(loc + ': Close puts the banner away, and the header is where it was', !(await has(p, '[data-pair-note]')) && (await p.evaluate(() => Math.round(document.querySelector('.ppp-header').getBoundingClientRect().top))) === 0);
      await p.evaluate(c => { location.hash = '#pc=' + c; }, B.code);
      await p.waitForSelector('[data-pair-ask-yes]', { timeout: 15000 }); await sleep(500);
      check('the question that replaces a link', await geo(p));
      await shot(p, null, 'g10b5-banner-ask-400-' + loc + '.png');
      await p.close();
    }

    heading('400 px, Korean and English: every state of the button, the sheet and the Settings card fit the screen');
    for (const loc of ['en-US', 'ko-KR']) {
      const fits = async (p, sel, what) => {
        const m = await p.evaluate(q => { const c = document.querySelector(q), r = c.getBoundingClientRect(); return { left: r.left, right: r.right, over: [...c.querySelectorAll('button, input, div, span, p, li')].filter(e => e.offsetParent !== null && (e.getBoundingClientRect().right > r.right + 1 || e.getBoundingClientRect().left < r.left - 1)).length, docW: document.documentElement.scrollWidth, vw: innerWidth }; }, sel);
        ok(loc + ' 400 px: ' + what + ' - nothing past its edge, no sideways scroll', m.vw === 400 && m.left >= 0 && m.right <= 400 && m.over === 0 && m.docW <= 400, JSON.stringify(m));
      };
      const n = await open('', { locale: loc, width: 400, height: 900 });
      await goAdd(n); await typeLink(n, YT);
      await fits(n, '[data-youtube]', 'the card with the secondary button');
      await shot(n, '[data-youtube]', 'g10b5-nolink-card-400-' + loc + '.png');
      await click(n, '[data-home-pc-help]'); await sleep(400);
      await fits(n, '[data-home-sheet] [role="dialog"]', 'the sheet');
      await shot(n, null, 'g10b5-sheet-400-' + loc + '.png');
      await n.close();
      const w = await open('', { locale: loc, width: 400, height: 900, store: storeOf((await mkLink(srv, false)).code) });
      await goAdd(w); await typeLink(w, YT);
      await fits(w, '[data-youtube]', 'the card with a link whose PC has not connected');
      await shot(w, '[data-youtube]', 'g10b5-neverseen-card-400-' + loc + '.png');
      await w.close();
      const u = await open('', { locale: loc, width: 400, height: 900, store: storeOf(GONE) });
      await goAdd(u); await typeLink(u, YT);
      await fits(u, '[data-youtube]', 'the card with a link the site does not recognise');
      await shot(u, '[data-youtube]', 'g10b5-unrecognised-card-400-' + loc + '.png');
      await goSettings(u);
      await fits(u, '[data-home-settings]', 'the Settings card with the unrecognised link');
      await shot(u, '[data-home-settings]', 'g10b5-unrecognised-settings-400-' + loc + '.png');
      await u.close();
      const s = await open('', { locale: loc, width: 400, height: 900, store: storeOf((await mkLink(srv, true)).code) });
      await goAdd(s); await typeLink(s, YT);
      await fits(s, '[data-youtube]', 'the card with the PC connected');
      await shot(s, '[data-youtube]', 'g10b5-seen-card-400-' + loc + '.png');
      await s.close();
    }

    heading('Korean, Japanese, Chinese: the catalogs hold every new sentence, and the page shows them');
    {
      const cat = loc => JSON.parse(fs.readFileSync(path.join(L.REPO, 'i18n', loc + '.json'), 'utf8')).content;
      for (const [loc, label] of [['ko-KR', '고품질 변환 (내 PC)'], ['ja-JP', '高品質変換（自分のPC）'], ['zh-CN', '高质量转换（我的电脑）']]) {
        const c = cat(loc);
        ok(loc + ': the catalog has all ' + NEW_KEYS.length + ' new sentences, each translated (not the English, not empty)', NEW_KEYS.every(k => typeof c[k] === 'string' && c[k].length > 0 && c[k] !== k), NEW_KEYS.filter(k => !(typeof c[k] === 'string' && c[k].length > 0 && c[k] !== k)).join(' | '));
        ok(loc + ': the shortcut name is kept as it is written on the desktop in the path, and the “Connect another device: copy link” button is quoted as the page translates it', c[STEP_PC].includes('PPP connect my devices (pair)') && c[STEP_OTHER].includes(c['Connect another device: copy link']), c[STEP_OTHER]);
        const n = await open('', { locale: loc });
        await goAdd(n); await typeLink(n, YT);
        ok(loc + ': the secondary button is in the person\'s language (the same words as the primary button)', (await addState(n)).helpLabel === label, String((await addState(n)).helpLabel));
        await click(n, '[data-home-pc-help]'); await sleep(400);
        ok(loc + ': the sheet: the sentence above, both steps, the Settings link and the Close label, from the catalog', (await text(n, '[data-home-sheet-intro]')) === c[NEW_KEYS[6]] && (await text(n, '[data-home-sheet-step="pc"]')) === c[STEP_PC] && (await text(n, '[data-home-sheet-step="other"]')) === c[STEP_OTHER] && (await text(n, '[data-home-sheet-settings]')) === c['More in Settings'] && (await n.evaluate(() => document.querySelector('[data-home-sheet-close]').getAttribute('aria-label'))) === c['Close'], String(await text(n, '[data-home-sheet]')).slice(0, 160));
        ok(loc + ': no page or console error', clean(n), errs(n));
        await n.close();
        const w = await open('', { locale: loc, store: storeOf((await mkLink(srv, false)).code) });
        w.__ctl.hold = new Promise(() => {});
        await w.evaluate(() => window.PPP.app.go('upload')()); await w.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(500);
        ok(loc + ': "Checking your PC…" in the person\'s language', (await addState(w)).stateText === c['Checking your PC…']);
        await w.close();
        const w2 = await open('', { locale: loc, store: storeOf((await mkLink(srv, false)).code) });
        await goAdd(w2); await sleep(300);
        ok(loc + ': "Your PC has not connected yet…" in the person\'s language', (await addState(w2)).stateText === c['Your PC has not connected yet: it will take the job when it does']);
        await w2.close();
        const f = await open('', { locale: loc, store: storeOf((await mkLink(srv, false)).code) });
        f.__ctl.fail = true; await goAdd(f); await sleep(300);
        ok(loc + ': "Could not check your PC right now…" in the person\'s language', (await addState(f)).stateText === c['Could not check your PC right now. You can still send the job.']);
        await f.close();
        const u = await open('', { locale: loc, store: storeOf(GONE) });
        await goAdd(u); await sleep(300);
        const su = await addState(u);
        await goSettings(u);
        ok(loc + ': the unrecognised link: the reason under the disabled button, and on Settings with Check again and Remove it, from the catalog', su.disabled === true && su.stateText === c[UNREC] && (await text(u, '[data-home-unrec-text]')) === c[UNREC] && (await text(u, '[data-home-unrec-check]')) === c['Check again'] && (await text(u, '[data-home-unrec-remove]')) === c['Remove it'], JSON.stringify(su));
        await click(u, '[data-home-unrec-remove]'); await sleep(500);
        ok(loc + ': "Remove it" says so in the person\'s language (a toast)', (await u.evaluate(() => window.PPP.app.state.toast || '')) === c['The PC link was removed from this device.'], String(await u.evaluate(() => window.PPP.app.state.toast || '')));
        ok(loc + ': no page or console error', clean(u), errs(u));
        await u.close();
      }
    }

    heading('the whole run');
    ok('no page or console error in any page of this run (' + pages.length + ' pages)', pages.every(clean), pages.filter(p => !clean(p)).map(errs).slice(0, 2).join(' | '));
  } catch (e) {
    L.ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    L.rmDir(dir);
  }
  L.finish('the PC button is always findable; a link is never forgotten on one 401');
})();
