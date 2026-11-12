/* ============================================================================
   G10b-6: "Connect this PC", live status and instant start - the PPP page of a desktop browser talking to the localhost bridge (tools/home-worker/bridge.js), in a real Chrome.

   The page is the real page served by the real server (tests/serve-free.js, free ports, the real PC-link routes). The program on the PC is the REAL HTTP layer of the bridge (bridge.js: Host and
   Origin checks, preflight, body limits) with a scripted controller behind it, so every state can be set. Chrome is started with --ip-address-space-overrides so that the page counts as a PUBLIC
   page and the bridge as a loopback address - the production situation, in which Chrome's Local Network Access applies: the permission is granted per browser context through the DevTools protocol
   (a person would answer Chrome's question); a context without it must end in the plain "the program is not running" sentence.

     - nothing before the press: no request to the bridge on load, on a phone, or in a browser that has not been connected; a phone never calls it (not even with the markers in storage)
     - every state of the press: the program is off | neither has a link | the program has a link and the browser none | the same link | a different live link (asked once: Keep / Use) | the program has none |
       its link was rejected | it holds a link it cannot give | this browser's link is dead at the site | refusals (busy, code rejected)
     - after success: ppp.pclocal.v1 and ppp.bridge.v1 are set; the status line (idle | converting 45% - title | program off | back on) every ~5 s while Settings or the Add screen is open and the tab is
       visible - and not on other screens, not while hidden; a conversion that ends makes the site's list be read once
     - the Add screen: "High-quality (my PC)" asks the program to run (POST /v1/run) after the job is queued, no pppworker:// launch; the launch stays as the fallback when the program is not there
     - the other devices: a QR code of the existing #pc= link (the matrix is exactly the encoder's), Copy link, the warning; hidden when Settings is left
     - secrets: the PC code is only in localStorage and in the two requests that must carry it; the worker token the site gives at creation is thrown away; nothing in the DOM, console or bridge calls
     - Korean, Japanese, Chinese; the catalogs hold every new sentence; 400 px layout

   node tests/home-worker/bridge-page.test.js   (needs puppeteer: NODE_PATH=D:/PPP/node_modules)
   HOME_MODULES_DIR=<dir>: serve <dir>/Piano Coach App.dc.html as the page (the mutation runner) */
'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const L = require('./lib');
const { sleep, heading, req } = L;
const ok = (name, cond, detail) => { L.ok(name, cond, cond ? undefined : detail); if (!cond && process.env.HOME_FAIL_FAST) throw new Error('stopped at the first failed check: ' + name); };
const path = require('path');
const fs = require('fs');
const { startServer } = require('../serve-free');
const { spawn } = require('child_process');
const B = L.mod('tools/home-worker/bridge.js');
const J = L.mod('home-jobs.js');

const PAGE_FILE = path.join(L.MODS, 'Piano Coach App.dc.html');
const PAGE_SRC = fs.readFileSync(PAGE_FILE, 'utf8');
const qrMatrix = (() => { const a = PAGE_SRC.indexOf('/* QR-BEGIN */'), b = PAGE_SRC.indexOf('/* QR-END */'); return new Function(PAGE_SRC.slice(a, b) + '; return qrMatrix;')(); })();
const KEY = 'ppp.pclink.v1';
const SHOTS = process.env.PPP_SHOTS_DIR || '';
const shot = async (p, sel, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const el = await p.$(sel); if (el) await el.screenshot({ path: path.join(SHOTS, name) }); };
const tagOf = code => J.linkTagOf(J.linkIdOf(J.codeHash(code)));
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EN = {
  connectBtn: 'Connect this PC', idle: 'My PC is connected ✓ · Idle', off: 'The PC program is not running', none: 'Not connected yet', other: 'This PC uses another PC link',
  help: 'The PPP program is not running on this PC. Run tools/home-worker/install-startup.cmd once, then press the button again.',
  allow: 'If your browser asked to allow access to this device, choose Allow.',
  busyMsg: 'A conversion is running on this PC. Connect after it finishes.',
  unrec: 'This device holds a PC link that the site does not recognise right now.', left: 'Left as it was.', started: 'Started on your PC.', asked: 'Asked this PC to start. If nothing happens, run the desktop shortcut.',
  noconv: 'Connected, but this PC cannot convert yet. Run node tools/home-worker/worker.js --check on it.',
  phone: 'Connect a phone or tablet', warning: 'Anyone with this link can send conversions to your PC, read their results, replace the PC token and remove the link: send it only to yourself.',
  askOther: (old, id) => 'This PC is connected to PC link …' + old + '. Use this device\'s link …' + id + ' instead?', askUnknown: id => 'This PC is connected to another PC link. Use this device\'s link …' + id + ' instead?'
};
/* every sentence this change added (the English source is the key) */
const NEW_KEYS = ['Connect this PC', 'Not connected yet', 'My PC is connected ✓ · Idle', 'Converting {{pct}}%', 'The PC program is not running', 'This PC uses another PC link',
  'Connected, but this PC cannot convert yet. Run node tools/home-worker/worker.js --check on it.', EN.help, EN.allow,
  'This PC is connected to PC link …{{old}}. Use this device\'s link …{{id}} instead?', 'This PC is connected to another PC link. Use this device\'s link …{{id}} instead?', 'Use …{{id}}', 'Keep as it is', EN.left,
  'This PC is connected now.', EN.busyMsg, 'Could not connect. Try again in a moment.', EN.started, EN.phone, 'Scan this with the phone camera. The phone asks before it connects.', 'QR code of the PC link'];

function freePort() { return new Promise((resolve, reject) => { const s = require('net').createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }

/* the program on the PC: the real HTTP layer, a scripted controller. P.calls: what the page asked (no codes in it); P.connected: the codes it handed over. */
async function program(origin, over) {
  let t = 0;
  const P = Object.assign({
    calls: [], connected: [], port: 0,
    link: { has: false, tag: null, rejected: false, shareable: false }, code: '', job: null, env: { checked: true, ok: true, device: 'cuda' },
    runReply: { started: true }, connectReply: null
  }, over || {});
  const ctl = {
    status: () => { P.calls.push('status'); return { app: 'ppp-home-worker', api: 1, version: '1.0', link: P.link, busy: !!P.job, checking: false, job: P.job, lastCheckAt: null, lastCheckOk: null, nextCheckAt: null, env: P.env }; },
    link: () => { P.calls.push('link'); return P.link.shareable && P.code ? { clientCode: P.code, linkTag: P.link.tag } : null; },
    connect: async code => {
      P.calls.push('connect'); P.connected.push(code);
      const r = P.connectReply ? P.connectReply(code) : null;
      if (r) return r;
      P.code = code; P.link = { has: true, tag: tagOf(code), rejected: false, shareable: true };
      return { status: 200, body: { ok: true, rotated: true, saved: true, linkTag: tagOf(code) } };
    },
    run: async () => { P.calls.push('run'); return { status: 200, body: Object.assign({ ok: true }, P.runReply) }; }
  };
  const make = port => B.createBridge({ ctl: ctl, port: port, siteUrl: origin, log: () => {}, now: () => (t += 20000) });
  P.bridge = make(0);
  P.port = await P.bridge.listen();
  P.stop = () => P.bridge.close();
  P.restart = async () => { P.bridge = make(P.port); await P.bridge.listen(); };
  P.count = k => P.calls.filter(c => c === k).length;
  return P;
}

let pageNo = 0;
const sessions = [];
/* a page in a context of its own. o: store (localStorage before the page runs), locale, ua, width, program (the program's port, or 0), grant (default true: the permission to reach this device is given) */
async function openPage(browser, srv, o) {
  o = o || {};
  const n = ++pageNo;
  const ctx = await browser.createBrowserContext();
  if (o.grant !== false) {
    const cdp = await browser.target().createCDPSession();        /* kept open: the permission is the session's override and goes when the session is detached */
    sessions.push(cdp);
    for (const name of ['local-network-access', 'loopback-network', 'local-network']) {
      try { await cdp.send('Browser.setPermission', { permission: { name: name }, setting: 'granted', origin: srv.origin, browserContextId: ctx.id }); } catch (e) { /* a name this Chrome does not know */ }
    }
  }
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  const rec = { requests: [], console: [], errors: [], pageErrors: [], bridgeReqs: [], preflights: [] };
  page.__rec = rec;
  await page.evaluateOnNewDocument(opts => {
    try { localStorage.setItem('ppp-locale', opts.locale); localStorage.setItem('ppp-guest', '1'); Object.keys(opts.store || {}).forEach(k => localStorage.setItem(k, opts.store[k])); } catch (e) { /* blocked */ }
    if (opts.port) window.PPP_BRIDGE_PORT = opts.port;
    window.__launches = [];
    document.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && /^pppworker:/i.test(a.getAttribute('href') || '')) { e.preventDefault(); window.__launches.push({ href: a.getAttribute('href'), at: Date.now() }); }
    }, true);
    window.__clip = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } });
  }, { locale: o.locale || 'en-US', store: o.store || {}, port: o.program || 0 });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    rec.requests.push({ method: r.method(), url: u, headers: r.headers(), post: r.postData() || '' });
    if (o.program !== undefined && u.startsWith('http://127.0.0.1:' + o.program + '/')) (r.method() === 'OPTIONS' ? rec.preflights : rec.bridgeReqs).push({ method: r.method(), path: new URL(u).pathname, post: r.postData() || '' });
    if (/:8788\/|\/helper(\/|$|\?)/.test(u)) return r.abort();
    if (/\/api\/youtube-title/.test(u) || /youtube\.com\/oembed/.test(u)) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Teacher Piece' }) });
    if (r.method() === 'POST' && /\/api\/pc-links$/.test(u)) return r.continue({ headers: Object.assign({}, r.headers(), { 'x-forwarded-for': '10.99.' + (n >> 8) + '.' + (n & 255) }) });
    if (process.env.HOME_MODULES_DIR && r.resourceType() === 'document' && r.method() === 'GET' && new URL(u).origin === srv.origin && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) {
      return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(PAGE_FILE), headers: { 'Cache-Control': 'no-store' } });
    }
    r.continue();
  });
  page.on('response', async r => { if (r.request().method() === 'POST' && /\/api\/pc-links$/.test(r.url())) { try { rec.created = await r.json(); } catch (e) { /* none */ } } });
  page.on('console', m => { rec.console.push(m.type() + ': ' + m.text()); if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED|blocked by CORS|Access to fetch/.test(m.text())) rec.errors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  if (o.ua) await page.setUserAgent(o.ua);
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000, isMobile: !!o.phone, hasTouch: !!o.phone });
  await page.goto(srv.origin + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  await sleep(400);
  return page;
}
const clean = p => p.__rec.errors.length === 0 && p.__rec.pageErrors.length === 0;
const errs = p => JSON.stringify(p.__rec.errors.concat(p.__rec.pageErrors));
const has = (p, sel) => p.evaluate(q => !!document.querySelector(q), sel);
const text = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const click = async (p, sel) => { await p.evaluate(q => document.querySelector(q).click(), sel); };
const lsGet = (p, k) => p.evaluate(key => { try { return localStorage.getItem(key); } catch (e) { return 'ERR'; } }, k);
const storedCode = async p => { const s = await lsGet(p, KEY); try { return JSON.parse(s).code; } catch (e) { return s; } };
const goSettings = async p => { await p.evaluate(() => window.PPP.app.go('settings')()); await p.waitForSelector('[data-home-settings]', { timeout: 10000 }); await sleep(500); };
const goAdd = async p => { await p.evaluate(() => window.PPP.app.go('upload')()); await p.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(500); };
const goHome = async p => { await p.evaluate(() => window.PPP.app.go('home')()); await sleep(500); };
const waitFor = async (p, fn, arg, ms) => { try { await p.waitForFunction(fn, { timeout: ms || 12000 }, arg); return true; } catch (e) { return false; } };
const line = p => text(p, '[data-bridge-status]');
const press = async p => { await click(p, '[data-bridge-connect]'); };
const pressAndWait = async (p, fn, arg, ms) => { await press(p); return waitFor(p, fn, arg, ms || 15000); };
const connectedLine = EN.idle;
const wantLine = (p, want) => waitFor(p, w => { const e = document.querySelector('[data-bridge-status]'); return !!e && (e.innerText || '').trim() === w; }, want, 15000);
const typeLink = async (p, url) => {
  await p.evaluate(() => { document.querySelector('[data-youtube-url]').value = ''; });
  await p.type('[data-youtube-url]', url);
  await p.evaluate(() => document.querySelector('[data-youtube-url]').dispatchEvent(new Event('change', { bubbles: true })));
  await sleep(250);
};

(async () => {
  const dir = L.tmpDir('ppp-bridge-page-');
  const server = await startServer({ env: { PPP_DATA_DIR: dir } });
  const srv = { port: server.port, origin: 'http://127.0.0.1:' + server.port, url: server.url };
  /* the page counts as PUBLIC, 127.0.0.1:<bridge> as loopback: Chrome's Local Network Access applies, as in production */
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=en-US', '--ip-address-space-overrides=127.0.0.1:' + srv.port + '=public'], protocolTimeout: 600000 });
  const programs = [];
  const mkProgram = async over => { const P = await program(srv.origin, over); programs.push(P); return P; };
  let seq = 0;
  /* a PC link made through the API, as browsers make them; ping=true: its PC has checked in (the page can offer the High-quality button) */
  const mk = async ping => { const n = ++seq; const r = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '10.88.' + n + '.1' }); if (ping) await req(srv.port, 'GET', '/api/worker/ping', { token: r.body.workerToken }); return { code: r.body.clientCode, token: r.body.workerToken }; };
  const linkStore = (code, extra) => Object.assign({ [KEY]: JSON.stringify({ v: 1, code: code }) }, extra || {});
  const pages = [];
  const open = async o => { const p = await openPage(browser, srv, o); pages.push(p); return p; };
  try {
    heading('nothing before the press: no request to the program on load, on a phone, or in a browser that has never been connected');
    {
      const P = await mkProgram();
      const p = await open({ program: P.port });
      await goSettings(p);
      await sleep(1500);
      ok('a desktop browser that has never been connected makes NO request to the program, on load or in Settings', p.__rec.bridgeReqs.length === 0 && P.calls.length === 0, JSON.stringify(p.__rec.bridgeReqs));
      ok('Settings shows the card with the status "Not connected yet" and ONE primary button "Connect this PC"', (await line(p)) === EN.none && (await text(p, '[data-bridge-connect]')) === EN.connectBtn);
      await shot(p, '[data-home-settings]', 'bridge-1-not-connected.png');
      ok('the old pairing / token controls are not changed by this (the "Create my PC link" button is still there)', await has(p, '[data-home-link-make]'));
      ok('no page error', clean(p), errs(p));
      await p.close();
      const A = await mk(false);
      const ph = await open({ program: P.port, ua: PHONE_UA, phone: true, store: linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' }) });
      await goSettings(ph);
      await goAdd(ph);
      await goSettings(ph);
      await sleep(7000);
      ok('a PHONE (even with both markers in its storage) never calls the program, and the card has no connect block at all', ph.__rec.bridgeReqs.length === 0 && P.calls.length === 0 && !(await has(ph, '[data-bridge-box]')) && !(await has(ph, '[data-bridge-connect]')), JSON.stringify(ph.__rec.bridgeReqs));
      ok('and the phone\'s existing card is there (status of the link, the pairing button)', await has(ph, '[data-home-pair-copy]'));
      await ph.close();
    }

    heading('the program is not running (nothing listens): one plain sentence, nothing stored, nothing created');
    {
      const dead = await freePort();
      const p = await open({ program: dead });
      await goSettings(p);
      await press(p);
      ok('the status says the program is not running', await wantLine(p, EN.off), String(await line(p)));
      await shot(p, '[data-home-settings]', 'bridge-2-off.png');
      ok('with the plain sentence and how to start it (install-startup.cmd, once) - and the Allow hint', (await text(p, '[data-bridge-help]')) === EN.help + '\n' + EN.allow || (await text(p, '[data-bridge-help]')).includes(EN.help) && (await text(p, '[data-bridge-help]')).includes(EN.allow), String(await text(p, '[data-bridge-help]')));
      ok('no PC link was made, no marker or flag was stored (a failed press remembers nothing)', (await lsGet(p, KEY)) === null && (await lsGet(p, 'ppp.bridge.v1')) === null && (await lsGet(p, 'ppp.pclocal.v1')) === null && !p.__rec.requests.some(r => /\/api\/pc-links/.test(r.url)));
      ok('the button is still there to try again, and no banner maze: no pairing banner, no error line', await has(p, '[data-bridge-connect]') && !(await has(p, '[data-pair-note]')) && !(await has(p, '[data-bridge-msg]')));
      ok('no page error', clean(p), errs(p));
      await p.close();
    }

    heading('a context WITHOUT the permission to reach this device (Chrome\'s Local Network Access, the person said no): the same plain sentence');
    {
      const P = await mkProgram();
      const p = await open({ program: P.port, grant: false });
      await goSettings(p);
      await press(p);
      ok('the press ends in "not running" with the Allow hint (the page cannot tell the two apart, so it says both)', await wantLine(p, EN.off) && (await text(p, '[data-bridge-help]')).includes(EN.allow), String(await line(p)));
      ok('the program saw nothing (the browser stopped the request)', P.calls.length === 0);
      await p.close();
    }

    heading('neither the program nor the browser has a link: one press makes one and connects it');
    {
      const P = await mkProgram();
      const p = await open({ program: P.port });
      await goSettings(p);
      await press(p);
      ok('the line becomes "My PC is connected ✓ · Idle"', await wantLine(p, connectedLine), String(await line(p)));
      const code = await storedCode(p);
      ok('exactly ONE link was made on the site (POST /api/pc-links), and its code is what the browser keeps', /^[0-9a-f]{64}$/.test(code) && p.__rec.requests.filter(r => r.method === 'POST' && /\/api\/pc-links$/.test(r.url)).length === 1 && p.__rec.created && p.__rec.created.clientCode === code);
      ok('the program was asked to connect ONCE, with that code (a single request: POST /v1/connect {clientCode})', P.connected.length === 1 && P.connected[0] === code && p.__rec.bridgeReqs.filter(r => r.path === '/v1/connect').length === 1 && JSON.stringify(JSON.parse(p.__rec.bridgeReqs.find(r => r.path === '/v1/connect').post)) === JSON.stringify({ clientCode: code }));
      const tok = p.__rec.created && p.__rec.created.workerToken;
      ok('the worker token the site gave at creation went nowhere: not in storage, not in the page, not in a request to the program, not on the console', !!tok && !(await p.evaluate(t => { let s = ''; try { Object.keys(localStorage).forEach(k => { s += localStorage.getItem(k); }); Object.keys(sessionStorage).forEach(k => { s += sessionStorage.getItem(k); }); } catch (e) { /* none */ } return s.includes(t) || document.documentElement.outerHTML.includes(t); }, tok)) && !p.__rec.bridgeReqs.some(r => r.post.includes(tok)) && !p.__rec.console.some(c => c.includes(tok)));
      ok('the code is on the screen nowhere (not in the text, not in an attribute) and in no console line', !(await p.evaluate(c => (document.body.innerText + document.documentElement.outerHTML.replace(/ppp\.pclink[^"]*/g, '')).includes(c), code)) && !p.__rec.console.some(c => c.includes(code)));
      ok('the POST to the program was preceded by a preflight (the browser asked first), and the program answered it (the connect went through)', p.__rec.preflights.some(r => r.path === '/v1/connect'));
      ok('the code was sent to the site only in X-PPP-PC, and to the program only in the body of /v1/connect (never in a URL)', !p.__rec.requests.some(r => r.url.includes(code)) && p.__rec.bridgeReqs.every(r => r.path === '/v1/connect' || !r.post.includes(code)));
      ok('this browser is remembered as the PC with the program (ppp.pclocal.v1 and ppp.bridge.v1)', (await lsGet(p, 'ppp.pclocal.v1')) === '1' && (await lsGet(p, 'ppp.bridge.v1')) === '1');
      await shot(p, '[data-home-settings]', 'bridge-3-connected.png');
      ok('the primary button is gone (connected), the site agrees (the link exists)', !(await has(p, '[data-bridge-connect]')) && (await req(srv.port, 'GET', '/api/worker/status', { code: code })).status === 200);
      const n0 = P.count('status');
      await sleep(11500);
      const n1 = P.count('status') - n0;
      ok('it then looks at the program\'s status every ~5 s while Settings is open: ' + n1 + ' looks in 11.5 s (2 or 3)', n1 >= 2 && n1 <= 3, String(n1));
      ok('no page error', clean(p), errs(p));
      await p.close();
    }

    heading('the program has a live link and this browser has none: the browser takes the program\'s link (no new link, no connect)');
    {
      const A = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const p = await open({ program: P.port });
      await goSettings(p);
      await press(p);
      ok('the line becomes connected', await wantLine(p, connectedLine), String(await line(p)));
      ok('the browser keeps the program\'s code (checked with the site first) and made no link, handed over nothing', (await storedCode(p)) === A.code && !p.__rec.requests.some(r => r.method === 'POST' && /\/api\/pc-links/.test(r.url)) && P.connected.length === 0 && P.count('link') === 1);
      ok('the card now shows what the site knows too (PC link name …' + tagOf(A.code) + ')', (await text(p, '[data-home-status-line]') || '').includes(tagOf(A.code)));
      ok('no character of the code is on the screen', !(await p.evaluate(c => document.body.innerText.includes(c), A.code)));
      await p.close();
    }

    heading('the program\'s link is the same as this browser\'s: nothing to do');
    {
      const A = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const p = await open({ program: P.port, store: linkStore(A.code) });
      await goSettings(p);
      await press(p);
      ok('connected, with no /v1/connect and no /v1/link and no new link', await wantLine(p, connectedLine) && P.connected.length === 0 && P.count('link') === 0 && !p.__rec.requests.some(r => r.method === 'POST' && /\/api\/pc-links/.test(r.url)));
      await p.close();
    }

    heading('the program holds a DIFFERENT live link: asked once; Keep leaves both; Use hands this device\'s link over');
    {
      const A = await mk(true), Bk = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(Bk.code), rejected: false, shareable: true }, code: Bk.code });
      const p = await open({ program: P.port, store: linkStore(A.code) });
      await goSettings(p);
      await press(p);
      await waitFor(p, () => !!document.querySelector('[data-bridge-ask]'));
      await shot(p, '[data-home-settings]', 'bridge-4-ask.png');
      ok('the question names both links', await waitFor(p, () => !!document.querySelector('[data-bridge-ask]')) && (await text(p, '[data-bridge-ask-text]')) === EN.askOther(tagOf(Bk.code), tagOf(A.code)), String(await text(p, '[data-bridge-ask-text]')));
      ok('nothing was replaced yet: no connect, the primary button is hidden while the question is open', P.connected.length === 0 && !(await has(p, '[data-bridge-connect]')));
      await click(p, '[data-bridge-ask-no]');
      ok('Keep: "Left as it was.", still nothing connected, the button is back', await waitFor(p, w => (document.querySelector('[data-bridge-msg]') || {}).innerText === w, EN.left) && P.connected.length === 0 && (await has(p, '[data-bridge-connect]')) && (await storedCode(p)) === A.code);
      await press(p);
      await waitFor(p, () => !!document.querySelector('[data-bridge-ask-yes]'));
      ok('asked again (nothing is remembered from "Keep"); the Use button names this device\'s link', (await text(p, '[data-bridge-ask-yes]')) === 'Use …' + tagOf(A.code));
      await click(p, '[data-bridge-ask-yes]');
      ok('Use: this device\'s code is handed over (once) and the line becomes connected', await wantLine(p, connectedLine) && P.connected.length === 1 && P.connected[0] === A.code && P.link.tag === tagOf(A.code));
      await p.close();
    }

    heading('the program has no link / a rejected link / a link it cannot give, and this browser has one or none');
    {
      const A = await mk(true);
      const P1 = await mkProgram();
      const p1 = await open({ program: P1.port, store: linkStore(A.code) });
      await goSettings(p1); await press(p1);
      ok('the program has none, this browser has one: it is handed over, no new link is made, no question', await wantLine(p1, connectedLine) && P1.connected.length === 1 && P1.connected[0] === A.code && !p1.__rec.requests.some(r => r.method === 'POST' && /\/api\/pc-links/.test(r.url)));
      await p1.close();
      const A2 = await mk(true), B2 = await mk(true);
      const P2 = await mkProgram({ link: { has: true, tag: tagOf(B2.code), rejected: true, shareable: true }, code: B2.code });
      const p2 = await open({ program: P2.port, store: linkStore(A2.code) });
      await goSettings(p2); await press(p2);
      ok('the program\'s link was REJECTED by the site: it counts as none (no question), this browser\'s link is handed over', await wantLine(p2, connectedLine) && P2.connected[0] === A2.code && !(await has(p2, '[data-bridge-ask]')));
      await p2.close();
      const P3 = await mkProgram({ link: { has: true, tag: null, rejected: false, shareable: false } });
      const A3 = await mk(true);
      const p3 = await open({ program: P3.port });
      await goSettings(p3); await press(p3);
      ok('the program has a link it cannot give (an older install without the code) and this browser has none: a new link is made and handed over', await wantLine(p3, connectedLine) && P3.connected.length === 1 && p3.__rec.requests.filter(r => r.method === 'POST' && /\/api\/pc-links$/.test(r.url)).length === 1);
      await p3.close();
      const P4 = await mkProgram({ link: { has: true, tag: null, rejected: false, shareable: false } });
      const p4 = await open({ program: P4.port, store: linkStore(A3.code) });
      await goSettings(p4); await press(p4);
      await waitFor(p4, () => !!document.querySelector('[data-bridge-ask]'));
      ok('a link of unknown name on the program and one here: asked, without a name for the program\'s link', (await text(p4, '[data-bridge-ask-text]')) === EN.askUnknown(tagOf(A3.code)), String(await text(p4, '[data-bridge-ask-text]')));
      await p4.close();
    }

    heading('this browser\'s link is dead at the site; the program\'s code is dead at the site');
    {
      const dead = 'f'.repeat(64);
      const P = await mkProgram();
      const p = await open({ program: P.port, store: linkStore(dead) });
      await goSettings(p); await press(p);
      ok('G10b-5: a link the site does not recognise is NOT forgotten on one answer: the sentence is shown, the card says so (Check again / Remove it), the code is kept, nothing was made or handed over', await waitFor(p, w => (document.querySelector('[data-bridge-msg]') || {}).innerText === w, EN.unrec) && await waitFor(p, () => !!document.querySelector('[data-home-unrec]')) && (await storedCode(p)) === dead && P.connected.length === 0 && !p.__rec.requests.some(r => r.method === 'POST' && /\/api\/pc-links/.test(r.url)) && (await lsGet(p, 'ppp.bridge.v1')) === null);
      await click(p, '[data-home-unrec-remove]');
      await sleep(400);
      await press(p);
      ok('after the person removes it ("Remove it") the next press makes a new link and hands it over', await wantLine(p, connectedLine) && P.connected.length === 1 && P.connected[0] !== dead && (await storedCode(p)) === P.connected[0]);
      await p.close();
      const P2 = await mkProgram({ link: { has: true, tag: 'abcdef', rejected: false, shareable: true }, code: dead });
      const p2 = await open({ program: P2.port });
      await goSettings(p2); await press(p2);
      ok('the program\'s code is not accepted by the site: it is NOT kept; a new link is made and handed over', await wantLine(p2, connectedLine) && (await storedCode(p2)) !== dead && P2.connected.length === 1);
      await p2.close();
    }

    heading('the program refuses: a conversion is running; the site dropped the link meanwhile');
    {
      const A = await mk(true);
      const P = await mkProgram({ connectReply: () => ({ status: 409, body: { ok: false, error: 'busy' } }) });
      const p = await open({ program: P.port, store: linkStore(A.code) });
      await goSettings(p); await press(p);
      ok('busy: the sentence is shown, the button stays, nothing is remembered', await waitFor(p, w => (document.querySelector('[data-bridge-msg]') || {}).innerText === w, EN.busyMsg) && await has(p, '[data-bridge-connect]') && (await lsGet(p, 'ppp.bridge.v1')) === null && (await lsGet(p, 'ppp.pclocal.v1')) === null);
      await p.close();
      const B2 = await mk(true);
      let first = true;
      const P2 = await mkProgram({ connectReply: () => { if (first) { first = false; return { status: 422, body: { ok: false, error: 'code-rejected' } }; } return null; } });
      const p2 = await open({ program: P2.port, store: linkStore(B2.code) });
      await goSettings(p2); await press(p2);
      ok('code-rejected for this browser\'s link: kept (G10b-5: one "not valid" forgets nothing), the sentence says the site does not recognise it, no new link is made', await waitFor(p2, w => (document.querySelector('[data-bridge-msg]') || {}).innerText === w, EN.unrec) && (await storedCode(p2)) === B2.code && P2.connected.length === 1 && !p2.__rec.requests.some(r => r.method === 'POST' && /\/api\/pc-links/.test(r.url)));
      await sleep(7000);
      ok('the site does know it, so the card\'s own look (now, +5 s) clears the "unrecognised" state again by itself', !(await has(p2, '[data-home-unrec]')));
      await press(p2);
      ok('and the next press hands the same code over and connects', await wantLine(p2, connectedLine) && P2.connected.length === 2 && P2.connected[1] === B2.code);
      await p2.close();
    }

    heading('live status every ~5 s while Settings or the Add screen is open and the tab is visible; the program turned off and on');
    {
      const A = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const p = await open({ program: P.port, store: linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' }) });
      await goSettings(p);
      ok('a browser that was connected before shows the state at once (one look on opening Settings, no press): connected', await wantLine(p, connectedLine) && p.__rec.bridgeReqs.every(r => r.path === '/v1/status'));
      P.job = { title: 'Moonlight Sonata', stage: 'transcribe', percent: 45 };
      ok('a conversion on the PC: "Converting 45% · Moonlight Sonata" within ~6 s', await wantLine(p, 'Converting 45% · Moonlight Sonata'), String(await line(p)));
      await shot(p, '[data-home-settings]', 'bridge-5-converting.png');
      const refreshesBefore = p.__rec.requests.filter(r => /\/api\/jobs$/.test(r.url) && r.method === 'GET').length;
      P.job = null;
      ok('it ends: back to idle, and the site\'s list is read ONCE for it (the finished conversion then shows Open)', await wantLine(p, connectedLine) && (await sleep(900), true) && p.__rec.requests.filter(r => /\/api\/jobs$/.test(r.url) && r.method === 'GET').length === refreshesBefore + 1, String(p.__rec.requests.filter(r => /\/api\/jobs$/.test(r.url)).length - refreshesBefore));
      P.link = { has: true, tag: 'abcdef', rejected: false, shareable: true };
      ok('the program is now connected to ANOTHER PC link than the one of this browser: the line says so and the button is offered', await wantLine(p, EN.other) && await has(p, '[data-bridge-connect]'), String(await line(p)));
      P.link = { has: true, tag: tagOf(A.code), rejected: false, shareable: true };
      await wantLine(p, connectedLine);
      P.env = { checked: true, ok: false, device: null };
      ok('the program is up but its setup check failed: it says so (and gives the command)', await waitFor(p, () => /cannot convert yet/.test((document.querySelector('[data-bridge-status]') || {}).innerText || '')));
      P.env = { checked: true, ok: true, device: 'cuda' };
      await P.stop();
      ok('the program is turned off: "The PC program is not running" within ~6 s, with the help sentence, on the Settings card', await wantLine(p, EN.off) && (await text(p, '[data-bridge-help]')).includes('install-startup.cmd'));
      await goAdd(p);
      ok('and the Add screen shows the same line (data-bridge-add)', (await text(p, '[data-bridge-add]')) === EN.off);
      await shot(p, '[data-youtube]', 'bridge-6-add-off.png');
      await P.restart();
      ok('the program is started again: the line on the Add screen is back to connected within ~6 s', await waitFor(p, w => (document.querySelector('[data-bridge-add]') || {}).innerText === w, connectedLine, 15000), String(await text(p, '[data-bridge-add]')));
      await p.close();
      const P3 = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const q = await open({ program: P3.port, store: linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' }) });
      await goAdd(q);
      ok('the Add screen of a connected browser shows the idle line too', await waitFor(q, w => (document.querySelector('[data-bridge-add]') || {}).innerText === w, connectedLine));
      /* polling stops when the screen is left and when the tab is hidden */
      await goHome(q);
      const n0 = P3.count('status');
      await sleep(6500);
      ok('on another screen (Home) it does not look at all (6.5 s: ' + (P3.count('status') - n0) + ' looks)', P3.count('status') === n0);
      await goSettings(q);
      await sleep(600);
      const n1 = P3.count('status');
      await q.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(6500);
      ok('while the tab is hidden it does not look (6.5 s)', P3.count('status') === n1);
      await q.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(1500);
      ok('visible again: it looks again at once', P3.count('status') > n1);
      ok('no page error', clean(q), errs(q));
      await q.close();
    }

    heading('the Add screen: "High-quality (my PC)" asks the program to run after the job is queued; the pppworker:// launch is only the fallback');
    {
      const A = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const store = linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' });
      const p = await open({ program: P.port, store: store });
      await goAdd(p);
      await typeLink(p, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await click(p, '[data-home-pc]');
      ok('POST /v1/run is called ONCE, after the job was queued (not before), and no pppworker:// link was launched', await waitFor(p, () => 1) && await (async () => { for (let i = 0; i < 60 && P.count('run') < 1; i++) await sleep(100); return true; })() && P.count('run') === 1 && (await p.evaluate(() => window.__launches.length)) === 0, 'runs ' + P.count('run'));
      const order = p.__rec.requests.filter(r => (r.method === 'POST' && /\/api\/jobs$/.test(r.url)) || (r.method === 'POST' && /127\.0\.0\.1:\d+\/v1\/run/.test(r.url))).map(r => (/v1\/run/.test(r.url) ? 'run' : 'job'));
      ok('the order is: job queued, then run' + ' (' + order.join(' > ') + ')', order.join() === 'job,run', order.join());
      ok('it says "Started on your PC." (the program said it started), not "Asked this PC to start"', await waitFor(p, w => document.body.innerText.includes(w), EN.started) && !(await p.evaluate(w => document.body.innerText.includes(w), EN.asked)));
      ok('the body of the call is {} - the page sent nothing else to the program', p.__rec.bridgeReqs.filter(r => r.path === '/v1/run').every(r => r.post === '{}'));
      /* the program answers started:false (another run holds the lock): the launch is the fallback */
      P.runReply = { started: false, reason: 'other-run' };
      await typeLink(p, 'https://www.youtube.com/watch?v=9bZkp7q19f0');
      await click(p, '[data-home-pc]');
      ok('"started: false" from the program: the pppworker:// launch is made as before', await waitFor(p, () => window.__launches.length === 1) && (await p.evaluate(() => window.__launches[0].href)) === 'pppworker://run');
      await p.close();
      /* the program is not there at all */
      const dead = await freePort();
      const q = await open({ program: dead, store: store });
      await goAdd(q);
      await typeLink(q, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
      await click(q, '[data-home-pc]');
      ok('the program is not there: the launch is the fallback (exactly one) and the old wording is used', await waitFor(q, () => window.__launches.length === 1) && await waitFor(q, w => document.body.innerText.includes(w), EN.asked));
      ok('and the line on the Add screen says the program is not running', await waitFor(q, w => (document.querySelector('[data-bridge-add]') || {}).innerText === w, EN.off));
      await q.close();
      /* a browser that was never connected to the program: the old way, untouched, and no request to the program */
      const P2 = await mkProgram();
      const r = await open({ program: P2.port, store: linkStore(A.code, { 'ppp.pclocal.v1': '1' }) });
      await goAdd(r);
      await typeLink(r, 'https://www.youtube.com/watch?v=kJQP7kiw5Fk');
      await click(r, '[data-home-pc]');
      ok('a "start at once" browser that never met the program uses the launch, and makes no request to it', await waitFor(r, () => window.__launches.length === 1) && r.__rec.bridgeReqs.length === 0 && P2.calls.length === 0);
      await r.close();
    }

    heading('end to end: the page, the REAL `worker.js --serve` process and the real site (nothing scripted)');
    {
      const wdir = L.tmpDir('ppp-bridge-e2e-');
      const cfgFile = path.join(wdir, 'worker.config.json');
      fs.writeFileSync(cfgFile, JSON.stringify({ siteUrl: srv.origin, scratchDir: path.join(wdir, 'scratch'), pythonPath: process.execPath, transcribePy: cfgFile, ffmpegPath: process.execPath, keepKept: 7 }));
      const bport = await freePort();
      const child = spawn(process.execPath, [path.join(L.MODS, 'tools', 'home-worker', 'worker.js'), '--serve', '--config', cfgFile], { env: Object.assign({}, process.env, { PPP_WORKER_BRIDGE_PORT: String(bport), PPP_WORKER_TOKEN: '' }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      const closed = new Promise(res => child.on('close', res));
      try {
        let up = false;
        for (let i = 0; i < 100 && !up; i++) { up = await new Promise(res => { const r = http.get({ host: '127.0.0.1', port: bport, path: '/v1/status', headers: { Origin: srv.origin, Host: '127.0.0.1:' + bport } }, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); }); if (!up) await sleep(100); }
        ok('(the real program is up on its port)', up, out.slice(0, 300));
        const p = await open({ program: bport });
        await goSettings(p);
        await press(p);
        /* (this test PC has no Python models in the program's settings - node stands in for both tools - so the program's REAL setup check fails, and the page says so honestly instead of "Idle") */
        ok('one press: the page makes a link, the real program gets its own token from the real site, and the line becomes connected - with the verdict of the real setup check (it cannot convert here)', await wantLine(p, EN.noconv), String(await line(p)) + ' | ' + out.slice(-300));
        const code = await storedCode(p);
        const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        ok('the program\'s settings file now has the browser\'s code and a worker token of its own (the other keys stay)', saved.clientCode === code && /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(saved.token) && saved.keepKept === 7 && saved.siteUrl === srv.origin);
        ok('the token works at the site, and the one the site gave the page at creation is dead', (await req(srv.port, 'GET', '/api/worker/ping', { token: saved.token })).status === 200 && (await req(srv.port, 'GET', '/api/worker/ping', { token: p.__rec.created.workerToken })).status === 401);
        ok('the site says the PC has connected (the page can offer the High-quality button)', (await req(srv.port, 'GET', '/api/worker/status', { code: code })).body.worker.everSeen === true);
        await goAdd(p);
        ok('the Add screen shows the High-quality button and the connected line', await waitFor(p, () => !!document.querySelector('[data-home-pc]')) && (await text(p, '[data-bridge-add]')) === EN.noconv);
        await typeLink(p, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
        await click(p, '[data-home-pc]');
        let left = false, last = '';
        for (let i = 0; i < 60 && !left; i++) { const r = await req(srv.port, 'GET', '/api/jobs', { code: code }); last = JSON.stringify(r.body.jobs && r.body.jobs.map(j => j.status)); left = !!(r.body.jobs && r.body.jobs.length && r.body.jobs.every(j => j.status !== 'queued')); if (!left) await sleep(250); }
        ok('the press of High-quality starts the real worker at once (POST /v1/run): the job leaves the queue within seconds, with no pppworker:// launch', left && (await p.evaluate(() => window.__launches.length)) === 0 && p.__rec.bridgeReqs.some(r => r.path === '/v1/run'), last);
        ok('the program\'s log holds neither the code nor a token', !out.includes(code) && !out.includes(saved.token) && !/\b[0-9a-f]{64}\b/.test(out), out.slice(-300));
        ok('no page error', clean(p), errs(p));
        await p.close();
      } finally { child.kill(); await closed; L.rmDir(wdir); }
    }

    heading('the other devices: a QR code of the existing #pc= link, Copy link, the warning');
    {
      const A = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
      const p = await open({ program: P.port, store: linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' }) });
      await goSettings(p);
      const pc0 = P.calls.length;
      ok('the button "Connect a phone or tablet" is there for a linked desktop browser; no code is drawn yet', (await text(p, '[data-bridge-phone]')) === EN.phone && !(await has(p, '[data-bridge-qr]')));
      await click(p, '[data-bridge-phone]');
      ok('pressed: a QR canvas, a note, Copy link and the warning appear', await waitFor(p, () => !!document.querySelector('[data-bridge-qr]')) && (await text(p, '[data-bridge-qr-warning]')) === EN.warning && (await text(p, '[data-bridge-copy]')) === 'Copy link');
      await sleep(300);
      const link = srv.origin + '/#pc=' + A.code;
      const want = qrMatrix(link);
      const got = await p.evaluate(n => {
        const c = document.querySelector('[data-bridge-qr]'), g = c.getContext('2d');
        const scale = Math.max(1, Math.floor(c.width / (n + 8))), off = Math.floor((c.width - n * scale) / 2);
        const out = [];
        for (let r = 0; r < n; r++) { const row = []; for (let q = 0; q < n; q++) { const d = g.getImageData(off + q * scale + (scale >> 1), off + r * scale + (scale >> 1), 1, 1).data; row.push(d[0] < 128 ? 1 : 0); } out.push(row); }
        const corner = g.getImageData(1, 1, 1, 1).data;
        return { m: out, white: corner[0] === 255 && corner[1] === 255 && corner[2] === 255 && corner[3] === 255 };
      }, want.length);
      await shot(p, '[data-home-settings]', 'bridge-7-qr.png');
      ok('the picture IS the encoder\'s QR matrix of  <this site>/#pc=<the code>  (' + want.length + ' x ' + want.length + ' modules; version ' + ((want.length - 17) / 4) + '), dark on a white quiet zone', JSON.stringify(got.m) === JSON.stringify(want) && got.white);
      await click(p, '[data-bridge-copy]');
      ok('Copy link puts exactly that pairing link on the clipboard', (await p.evaluate(() => window.__clip)) === link);
      ok('the code is not in the text of the page or in an attribute (only the picture)', !(await p.evaluate(c => document.body.innerText.includes(c) || [...document.querySelectorAll('[data-bridge-qr-box] *')].some(e => [...e.attributes].some(a => a.value.includes(c))), A.code)));
      ok('the program was not asked anything for it (the code is the browser\'s own)', P.calls.slice(pc0).every(c => c === 'status'));
      await goHome(p);
      await goSettings(p);
      ok('leaving Settings puts the code away', !(await has(p, '[data-bridge-qr]')));
      await click(p, '[data-bridge-phone]');
      await waitFor(p, () => !!document.querySelector('[data-bridge-qr]'));
      await click(p, '[data-bridge-phone]');
      ok('the button hides it again', !(await has(p, '[data-bridge-qr]')) && (await text(p, '[data-bridge-phone]')) === EN.phone);
      ok('no page error', clean(p), errs(p));
      await p.close();
    }

    heading('Korean, Japanese, Chinese: the line, the button, the help, the question');
    {
      const A = await mk(true), Bk = await mk(true);
      const I = { 'ko-KR': { btn: '이 PC 연결', idle: '내 PC 연결됨 ✓ · 대기 중', off: 'PC 프로그램이 꺼져 있어요', none: '아직 연결되지 않았어요', phone: '휴대폰·태블릿 연결', conv: '변환 중 45% · 곡' },
        'ja-JP': { btn: 'このPCを接続', idle: 'マイPC接続済み ✓ · 待機中', off: 'PCのプログラムが起動していません', none: 'まだ接続されていません', phone: 'スマホ・タブレットを接続', conv: '変換中 45% · 曲' },
        'zh-CN': { btn: '连接这台电脑', idle: '我的电脑已连接 ✓ · 空闲', off: '电脑上的程序没有运行', none: '尚未连接', phone: '连接手机或平板', conv: '转换中 45% · 曲' } };
      for (const loc of Object.keys(I)) {
        const t = I[loc];
        const P = await mkProgram({ link: { has: true, tag: tagOf(A.code), rejected: false, shareable: true }, code: A.code });
        const p0 = await open({ program: P.port, locale: loc });
        await goSettings(p0);
        ok(loc + ': the status before any press and the one button are translated', (await line(p0)) === t.none && (await text(p0, '[data-bridge-connect]')) === t.btn, String(await line(p0)) + ' | ' + String(await text(p0, '[data-bridge-connect]')));
        await p0.close();
        const p = await open({ program: P.port, locale: loc, store: linkStore(A.code, { 'ppp.pclocal.v1': '1', 'ppp.bridge.v1': '1' }) });
        await goSettings(p);
        ok(loc + ': connected line', await wantLine(p, t.idle), String(await line(p)));
        ok(loc + ': the phone button', (await text(p, '[data-bridge-phone]')) === t.phone);
        P.job = { title: t.conv.split(' · ')[1], stage: 'transcribe', percent: 45 };
        ok(loc + ': converting line', await wantLine(p, t.conv), String(await line(p)));
        await P.stop();
        ok(loc + ': program off', await wantLine(p, t.off));
        await p.close();
      }
      /* the question, in Korean */
      const P = await mkProgram({ link: { has: true, tag: tagOf(Bk.code), rejected: false, shareable: true }, code: Bk.code });
      const q = await open({ program: P.port, locale: 'ko-KR', store: linkStore(A.code) });
      await goSettings(q); await press(q);
      await waitFor(q, () => !!document.querySelector('[data-bridge-ask]'));
      ok('ko: the question names both links, and the buttons say "…X 쓰기" and "그대로 두기"', (await text(q, '[data-bridge-ask-text]')) === '이 PC는 PC 링크 …' + tagOf(Bk.code) + '에 연결돼 있어요. 이 기기의 링크 …' + tagOf(A.code) + '로 바꿀까요?' && (await text(q, '[data-bridge-ask-yes]')) === '…' + tagOf(A.code) + ' 쓰기' && (await text(q, '[data-bridge-ask-no]')) === '그대로 두기');
      await q.close();
      const cat = {};
      for (const loc of Object.keys(I)) cat[loc] = JSON.parse(fs.readFileSync(path.join(L.MODS, 'i18n', loc + '.json'), 'utf8')).content;
      for (const loc of Object.keys(cat)) {
        const miss = NEW_KEYS.filter(k => !(k in cat[loc]) || !String(cat[loc][k]).trim());
        const slots = NEW_KEYS.filter(k => k in cat[loc] && (k.match(/\{\{\w+\}\}/g) || []).sort().join() !== (String(cat[loc][k]).match(/\{\{\w+\}\}/g) || []).sort().join());
        ok(loc + ': the catalog has all ' + NEW_KEYS.length + ' new sentences, each with the same {{slots}}', miss.length === 0 && slots.length === 0, 'missing: ' + miss.join(' | ') + ' slots: ' + slots.join(' | '));
      }
      const used = NEW_KEYS.filter(k => !PAGE_SRC.includes(k.replace(/'/g, '\\\'')) && !PAGE_SRC.includes(k));
      ok('every new sentence is used by the page', used.length === 0, used.join(' | '));
    }

    heading('400 px: the connect block, the question and the QR code do not make the page wider');
    {
      const A = await mk(true), Bk = await mk(true);
      const P = await mkProgram({ link: { has: true, tag: tagOf(Bk.code), rejected: false, shareable: true }, code: Bk.code });
      const p = await open({ program: P.port, store: linkStore(A.code), width: 400, height: 900 });
      await goSettings(p); await press(p);
      await waitFor(p, () => !!document.querySelector('[data-bridge-ask]'));
      const wide = () => p.evaluate(() => { const cs = document.querySelector('[data-home-settings]'); const r = cs.getBoundingClientRect(); return { sx: document.documentElement.scrollWidth > innerWidth + 1, card: r.right <= innerWidth + 1 && r.left >= -1, kids: [...cs.querySelectorAll('[data-bridge-box] *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length }; });
      await shot(p, '[data-home-settings]', 'bridge-8-ask-400.png');
      let w = await wide();
      ok('the question at 400 px: no sideways scroll, the card is inside the screen, nothing sticks out', !w.sx && w.card && w.kids === 0, JSON.stringify(w));
      await click(p, '[data-bridge-ask-no]');
      await click(p, '[data-bridge-phone]');
      await waitFor(p, () => !!document.querySelector('[data-bridge-qr]'));
      await shot(p, '[data-home-settings]', 'bridge-9-qr-400.png');
      w = await wide();
      ok('the QR code open at 400 px: the same', !w.sx && w.card && w.kids === 0, JSON.stringify(w));
      const sz = await p.evaluate(() => { const r = document.querySelector('[data-bridge-qr]').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      ok('and the code stays square and large enough to scan (' + sz.join(' x ') + ' px)', sz[0] === sz[1] && sz[0] >= 200);
      await p.close();
    }
  } finally {
    for (const p of pages) { try { await p.close(); } catch (e) { /* closed */ } }
    for (const P of programs) { try { await P.stop(); } catch (e) { /* stopped */ } }
    await browser.close();
    await server.close();
    L.rmDir(dir);
  }
  L.finish('the Connect this PC page and the localhost bridge');
})().catch(e => { console.error(e); process.exit(1); });
