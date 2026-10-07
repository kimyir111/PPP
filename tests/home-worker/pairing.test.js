/* ============================================================================
   G10b-3: ONE-TAP PAIRING of a device with the PC link, in the real page against the real server (tests/serve-free.js).

   A pairing link is  https://<site>/#pc=<the 64 hex of the link's client code>  (a URL FRAGMENT: browsers never send it to a server). Opening it on any device pairs it:
   the head script of the page takes it off the address bar (history.replaceState) before any other script or request, the page asks the site (GET /api/worker/status, the code
   in X-PPP-PC: 200 = the link exists), keeps the code (localStorage ppp.pclink.v1) and says so; a code the site does not know, a fragment that is not a code, and a browser that
   cannot keep the connection each get a notice and store nothing.

     - the page is opened on the link, on a fresh profile (no sign-in, no guest flag): the address is clean before the FIRST script runs and before every request; the notice; the sign-in gate
       is not in the way; nothing navigates; the code is in localStorage and nowhere else
     - the page is already open in the tab (hashchange): same; no history entry keeps the code
     - an unknown code, a revoked one; fragments that are not codes (63 and 65 hex, junk, empty); capitals, spaces, dashes and %20 are forgiven; other fragments are left alone;
       the query and other parameters stay
     - a device that already holds another link is switched, and says so; the same link again is not "switched"
     - localStorage blocked (setItem throws / reading throws): a notice, no request with the code, nothing stored
     - nothing leaks: the code is in no URL, no header but X-PPP-PC, no body, no console line, no cookie, no other storage key, not in document.referrer after leaving for another origin
     - the Settings card: status line, ONE button "Connect another device: copy link", its warning, Share when the browser has it, the copy fallbacks, "More"
     - a device with no link: one button; the result dialog says what to do in order (the link for the other devices, then the PC's part "only if your PC has no worker yet")
     - Korean, Japanese, Chinese; the catalogs hold every new sentence; 400 px layout (screenshots when PPP_SHOTS_DIR is set)

   node tests/home-worker/pairing.test.js   (needs puppeteer: NODE_PATH=D:/PPP/node_modules if this tree has none)
   HOME_MODULES_DIR=<dir>: serve <dir>/Piano Coach App.dc.html as the page (the mutation runner, tests/home-worker/mutants.js) */
'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const net = require('net');
const L = require('./lib');
const { ok, sleep, heading, req } = L;
const path = require('path');
const fs = require('fs');
const { startServer } = require('../serve-free');

const PAGE_FILE = path.join(L.MODS, 'Piano Coach App.dc.html');
const SHOTS = process.env.PPP_SHOTS_DIR || '';
const KEY = 'ppp.pclink.v1';
const EN = {
  connected: 'Your PC is connected. Now paste a YouTube link and the "High-quality (my PC)" button will show.',
  replaced: 'Your PC is connected. This device used another PC link before; it now uses this new one.',
  mismatch: 'That connection code does not match. Copy a new link from the device that made the connection.',
  incomplete: 'This link is incomplete. Copy it again from the device that made the connection.',
  nostorage: 'This browser cannot keep the connection (a private window, or blocked storage). Open the link in a normal window.',
  unreachable: 'The connection could not be checked right now. Open the link again in a minute.',
  copyLabel: 'Connect another device: copy link',
  warning: 'Anyone with this link can send conversions to your PC: send it only to yourself.'
};
/* every sentence this change added to the catalogs (the English source is the key) */
const NEW_KEYS = [EN.connected, EN.replaced, EN.mismatch, EN.incomplete, EN.nostorage, EN.unreachable, EN.copyLabel, EN.warning, 'More', 'PC connected', 'last seen {{ago}}', 'just now',
  '{{n}} min ago', '{{n}} h ago', '{{n}} days ago', 'Could not copy by itself. The link is selected: copy it by hand.', 'Your PC link is ready.', '1. Copy this link and open it on your other devices.',
  '2. Only if your PC has no worker yet:', 'This browser could not keep the PC link. Copy the link now: without it this device cannot use the connection.', 'Paste the link or the PC code from the device that made the connection.'];

/* A TCP pass-through in front of the server that keeps every byte the BROWSER sent: what a server (and any proxy in front of it) would see on the wire. Puppeteer reports the URL of a
   navigation WITH its fragment, but the request line that goes out never has one - this is the proof. */
function wireProxy(targetPort) {
  const wire = { text: '', conns: 0 };
  return new Promise(resolve => {
    const server = net.createServer(c => {
      wire.conns++;
      const up = net.connect(targetPort, '127.0.0.1');
      c.on('data', d => { wire.text += d.toString('latin1'); });
      c.pipe(up); up.pipe(c);
      const end = () => { c.destroy(); up.destroy(); };
      c.on('error', end); up.on('error', end); c.on('close', end); up.on('close', end);
    });
    server.listen(0, '127.0.0.1', () => resolve({ wire: wire, port: server.address().port, close: () => { server.close(); } }));
  });
}
/* what is on the wire besides the X-PPP-PC header lines: no fragment, and none of the codes */
const wireLeaks = (wire, codes) => {
  const rest = wire.text.replace(/^x-ppp-pc:.*$/gmi, '').toLowerCase();
  const bad = [];
  if (/#|%23/.test(rest.replace(/^referer:.*$/gmi, '')) ) bad.push('a "#" in what the browser sent');
  if (/pc=/.test(rest)) bad.push('"pc=" in what the browser sent');
  codes.forEach(c => { if (rest.includes(c)) bad.push('a code outside X-PPP-PC'); });
  return bad;
};

/* what a test page records, for every page it opens */
function instrument(o) {
  return () => {
    window.__calls = [];
    const rec = (kind, u) => { try { window.__calls.push({ kind: kind, u: String(u), hash: location.hash }); } catch (e) { /* nothing */ } };
    const f = window.fetch; window.fetch = function (u) { rec('fetch', u && u.url ? u.url : u); return f.apply(this, arguments); };
    const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { rec('xhr', u); return open.apply(this, arguments); };
    if (navigator.sendBeacon) { const sb = navigator.sendBeacon; navigator.sendBeacon = function (u) { rec('beacon', u); return sb.apply(navigator, arguments); }; }
    /* what the address bar held when the FIRST script of the page (i18n.js, right after the head script) ran */
    let v; Object.defineProperty(window, 'PPP_I18N', { configurable: true, get() { return v; }, set(x) { if (window.__hashAtI18n === undefined) window.__hashAtI18n = location.hash; v = x; } });
    try { sessionStorage.setItem('__loads', String((+sessionStorage.getItem('__loads') || 0) + 1)); } catch (e) { /* nothing */ }
  };
}

/* a page in a context of its own. o: locale, noGuest (a fresh profile: the sign-in gate would show), store (localStorage before the page runs), block ('set' | 'all'), share (a navigator.share stub),
   clip ('ok' | 'reject' | 'missing'), exec ('false' | 'true': document.execCommand), width, height */
let pageCount = 0;
async function openPage(browser, srv, hash, o) {
  o = o || {};
  const pageNo = ++pageCount;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  const rec = { requests: [], console: [], errors: [], pageErrors: [] };
  page.__rec = rec;
  await page.evaluateOnNewDocument(instrument());
  await page.evaluateOnNewDocument(opts => {
    try { localStorage.setItem('ppp-locale', opts.locale); if (!opts.noGuest) localStorage.setItem('ppp-guest', '1'); } catch (e) { /* blocked */ }
  }, { locale: o.locale || 'en-US', noGuest: !!o.noGuest });
  if (o.store) await page.evaluateOnNewDocument(st => { try { Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); } catch (e) { /* blocked */ } }, o.store);
  if (o.block === 'set') await page.evaluateOnNewDocument(() => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  if (o.block === 'all') await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); });
  if (o.share === 'none') await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  else if (o.share) await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { window.__shared = d; } }); });
  if (o.clip) await page.evaluateOnNewDocument(mode => {
    if (mode === 'missing') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => (mode === 'reject' ? Promise.reject(new DOMException('denied', 'NotAllowedError')) : (window.__clip = t, Promise.resolve())) } });
  }, o.clip);
  if (o.exec) await page.evaluateOnNewDocument(mode => {
    document.execCommand = function (c) { const el = document.activeElement; window.__exec = { cmd: c, value: el && el.value, from: el && el.selectionStart, to: el && el.selectionEnd, attr: el && [...el.attributes].map(a => a.name).filter(n => /^data-/.test(n)).join() }; return mode === 'true'; };
  }, o.exec);
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    rec.requests.push({ method: r.method(), url: u, headers: r.headers(), post: r.postData() || '', type: r.resourceType() });
    if (/:8788\/|\/helper(\/|$|\?)/.test(u)) return r.abort();
    /* every page its own address for the site's per-address limits (making a link: 5 an hour) */
    if (r.method() === 'POST' && /\/api\/pc-links$/.test(u)) return r.continue({ headers: Object.assign({}, r.headers(), { 'x-forwarded-for': '10.99.' + (pageNo >> 8) + '.' + (pageNo & 255) }) });
    if (o.baseHtml && r.resourceType() === 'document' && r.method() === 'GET' && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) {
      return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: o.baseHtml, headers: { 'Cache-Control': 'no-store' } });
    }
    if (process.env.HOME_MODULES_DIR && r.resourceType() === 'document' && r.method() === 'GET' && new URL(u).origin === srv.origin && /^\/(Piano%20Coach%20App\.dc\.html)?$/.test(new URL(u).pathname)) {
      return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(PAGE_FILE), headers: { 'Cache-Control': 'no-store' } });
    }
    r.continue();
  });
  page.on('console', m => { rec.console.push(m.type() + ': ' + m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) rec.errors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto(srv.origin + '/' + (hash || ''), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  await sleep(500);
  return page;
}
const clean = p => p.__rec.errors.length === 0 && p.__rec.pageErrors.length === 0;
const errs = p => JSON.stringify(p.__rec.errors.concat(p.__rec.pageErrors));
const has = (p, sel) => p.evaluate(q => !!document.querySelector(q), sel);
const text = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? (e.innerText || '').trim() : null; }, sel);
const val = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? e.value : null; }, sel);
const click = (p, sel) => p.evaluate(q => document.querySelector(q).click(), sel);
const stored = p => p.evaluate(k => { try { return localStorage.getItem(k); } catch (e) { return 'ERR'; } }, KEY);
const storedCode = async p => { const s = await stored(p); try { return JSON.parse(s).code; } catch (e) { return s; } };
const note = p => p.evaluate(() => { const e = document.querySelector('[data-pair-note]'); return e ? (e.firstElementChild.innerText || '').trim() : null; });
const waitNote = async (p, ms) => { try { await p.waitForSelector('[data-pair-note]', { timeout: ms || 15000 }); } catch (e) { /* the test says so */ } await sleep(500); };
const statusCalls = p => p.__rec.requests.filter(r => /\/api\/worker\/status/.test(r.url));
const withCode = (p, code) => p.__rec.requests.filter(r => r.headers['x-ppp-pc'] === code);
const shot = async (p, sel, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const el = await p.$(sel); if (el) await el.screenshot({ path: path.join(SHOTS, name) }); };
const goAdd = async p => { await p.evaluate(() => window.PPP.app.go('upload')()); await p.waitForSelector('[data-youtube-url]', { timeout: 10000 }); await sleep(500); };
const cardButtons = p => p.evaluate(() => [...document.querySelectorAll('[data-home-settings] button')].filter(b => b.offsetParent !== null).map(b => (b.innerText || '').trim()));
const goSettings = async p => { await p.evaluate(() => window.PPP.app.go('settings')()); await sleep(900); };

/* what the page's requests and console show of the codes: the code may be in the X-PPP-PC header of a call to /api/ - and nowhere else */
function requestLeaks(rec, codes) {
  const bad = [];
  for (const code of codes) {
    const hits = s => String(s || '').toLowerCase().includes(code);
    rec.requests.forEach(r => {
      const u = r.type === 'document' ? r.url.replace(/#.*$/, '') : r.url;   /* a navigation's own fragment is never on the wire: wireLeaks proves it */
      if (hits(u)) bad.push('URL ' + u.replace(code, '<CODE>'));
      if (/#pc=/i.test(u)) bad.push('fragment in a URL ' + u);
      if (hits(r.post)) bad.push('body of ' + r.method + ' ' + r.url);
      Object.keys(r.headers).forEach(h => {
        if (hits(r.headers[h]) && !(h === 'x-ppp-pc' && /^https?:\/\/[^/]+\/api\//.test(r.url))) bad.push('header ' + h + ' of ' + r.url);
      });
    });
    rec.console.forEach(c => { if (hits(c)) bad.push('console: ' + c.replace(code, '<CODE>')); });
  }
  return bad;
}
/* ... and what is in the page itself (storage, cookie, address, referrer, attributes, text) */
async function leaks(p, codes, opt) {
  opt = opt || {};
  const bad = requestLeaks(p.__rec, codes);
  for (const code of codes) {
    const inPage = await p.evaluate((c, domOk) => {
      const out = [];
      try { Object.keys(localStorage).forEach(k => { if (k !== 'ppp.pclink.v1' && String(localStorage.getItem(k)).toLowerCase().includes(c)) out.push('localStorage ' + k); }); } catch (e) { /* blocked */ }
      try { Object.keys(sessionStorage).forEach(k => { if (String(sessionStorage.getItem(k)).toLowerCase().includes(c)) out.push('sessionStorage ' + k); }); } catch (e) { /* blocked */ }
      if (document.cookie.toLowerCase().includes(c)) out.push('cookie');
      if (location.href.toLowerCase().includes(c)) out.push('location.href');
      if (document.referrer.toLowerCase().includes(c)) out.push('document.referrer');
      const att = [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => a.value.toLowerCase().includes(c)) && e.tagName !== 'INPUT');
      if (att.length && !domOk) out.push('an attribute of <' + att[0].tagName.toLowerCase() + '>');
      if (!domOk && (document.body.innerText || '').toLowerCase().includes(c)) out.push('visible text');
      return out;
    }, code, !!opt.domOk);
    inPage.forEach(x => bad.push(x));
  }
  return bad;
}

(async () => {
  const dir = L.tmpDir('ppp-pair-');
  const server = await startServer({ env: { PPP_DATA_DIR: dir } });
  const proxy = await wireProxy(server.port);
  /* srv.port: the server itself (the test's own API calls); srv.origin: the address the pages are opened on, through the pass-through that records the wire */
  const srv = { port: server.port, origin: 'http://127.0.0.1:' + proxy.port, url: server.url, wire: proxy.wire };
  const mk = async n => { const r = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '10.77.' + n + '.1' }); return { code: r.body.clientCode, token: r.body.workerToken }; };
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=en-US'], protocolTimeout: 600000 });
  const allPages = [];
  const open = async (...a) => { const p = await openPage(browser, srv, ...a); allPages.push(p); return p; };
  try {
    const A = await mk(1), B = await mk(2), C = await mk(3), D = await mk(4), E = await mk(5);
    ok('(five PC links made through the API, as browsers make them)', [A, B, C, D, E].every(x => /^[0-9a-f]{64}$/.test(x.code)));
    /* a revoked link: made, then removed by its holder */
    ok('(link D is removed again: its code is dead)', (await req(srv.port, 'DELETE', '/api/pc-links/me', { code: D.code })).status === 200 && (await req(srv.port, 'GET', '/api/worker/status', { code: D.code })).status === 401);
    /* link E: its PC has connected (a worker poll), so the page can say "PC connected" */
    ok('(the PC of link E checks in)', (await req(srv.port, 'GET', '/api/worker/ping', { token: E.token })).status === 200);

    heading('opening the pairing link on a fresh profile: no sign-in, no guest flag, nothing stored');
    {
      const p = await open('#pc=' + A.code, { noGuest: true });
      await waitNote(p);
      const calls = await p.evaluate(() => window.__calls);
      ok('the address bar is clean (no fragment at all, the path stays)', await p.evaluate(() => location.hash === '' && location.href === location.origin + '/'));
      ok('it was clean already when the FIRST script of the page ran (the head script comes before i18n.js)', (await p.evaluate(() => window.__hashAtI18n)) === '', String(await p.evaluate(() => window.__hashAtI18n)));
      ok('and at EVERY request the page itself made (' + calls.length + ' of them): fetch, XHR, beacon', calls.length > 0 && calls.every(c => c.hash === ''), JSON.stringify(calls.filter(c => c.hash !== '').slice(0, 3)));
      ok('no history entry keeps the code (the whole history of the tab, by the browser\'s own list)', await (async () => {
        const cdp = await p.createCDPSession();
        const h = await cdp.send('Page.getNavigationHistory');
        return h.entries.length <= 2 && h.entries.every(e => !/pc=/.test(e.url) && !e.url.includes(A.code)) && h.entries[h.entries.length - 1].url === srv.origin + '/' && JSON.stringify(h.entries.map(e => e.url));
      })());
      ok('the page loaded once and did not navigate (the pairing is not a redirect)', (await p.evaluate(() => sessionStorage.getItem('__loads'))) === '1');
      ok('the notice says the PC is connected', (await note(p)) === EN.connected, String(await note(p)));
      ok('the sign-in gate is not in the way (a person who taps the link lands on the page), and it is not remembered as a guest either', !(await has(p, '[data-auth]')) && (await p.evaluate(() => localStorage.getItem('ppp-guest'))) === null);
      ok('the site was asked ONCE whether the code is a link: GET /api/worker/status with the code in X-PPP-PC and nothing in the URL', statusCalls(p).length === 1 && statusCalls(p)[0].headers['x-ppp-pc'] === A.code && statusCalls(p)[0].url === srv.origin + '/api/worker/status');
      ok('the code is kept (localStorage ppp.pclink.v1) - and the page used it for its own list', (await storedCode(p)) === A.code && withCode(p, A.code).some(r => /\/api\/jobs$/.test(r.url)));
      ok('no request had the fragment or the code but the calls to /api/ with X-PPP-PC; no console line, cookie or other storage key either; not in the page', (await leaks(p, [A.code])).length === 0, (await leaks(p, [A.code])).join(' | '));
      ok('ON THE WIRE (every byte the browser sent to the server, through a pass-through): no "#", no "pc=", the code only on X-PPP-PC lines - and it did get there', wireLeaks(srv.wire, [A.code]).length === 0 && /^x-ppp-pc: /mi.test(srv.wire.text) && srv.wire.text.toLowerCase().includes('x-ppp-pc: ' + A.code), wireLeaks(srv.wire, [A.code]).join(' | '));
      ok('no page or console error', clean(p), errs(p));
      /* after leaving for another origin: document.referrer */
      const spy = await new Promise(resolve => {
        const seen = { referer: undefined, hits: 0, all: [] };
        const s2 = http.createServer((rq, rs) => { seen.all.push(rq.url + ' <- ' + rq.headers.referer); if (rq.url === '/away') { seen.hits++; seen.referer = rq.headers.referer; } rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end('<!doctype html><title>other</title><p>other origin</p>'); });
        s2.listen(0, '127.0.0.1', () => resolve({ seen: seen, port: s2.address().port, close: () => s2.close() }));
      });
      await p.evaluate(port => { const a = document.createElement('a'); a.href = 'http://localhost:' + port + '/away'; a.id = '__away'; a.textContent = 'away'; document.body.appendChild(a); a.click(); }, spy.port);
      await p.waitForFunction(() => location.hostname === 'localhost', { timeout: 15000 });
      const ref = await p.evaluate(() => document.referrer);
      ok('leaving for another origin: the Referer the other site got and its document.referrer carry no code and no "#pc="', spy.seen.hits === 1 && !String(spy.seen.referer || '').includes(A.code) && !/pc=/.test(String(spy.seen.referer || '')) && !ref.includes(A.code) && !/pc=/.test(ref), JSON.stringify({ referer: spy.seen.referer, ref: ref, all: spy.seen.all }));
      spy.close();
      await p.close();
    }

    heading('a visit with no pairing link: the sign-in gate is there as ever (the bypass is only for the pairing link)');
    {
      const p = await open('', { noGuest: true });
      ok('a fresh profile with no link in the address sees the gate; no request about links at all', (await has(p, '[data-auth]')) && !p.__rec.requests.some(r => /\/api\/(worker|jobs|pc-links)/.test(r.url)));
      await p.close();
    }

    heading('capitals, spaces, dashes, %20, whitespace around: forgiven (as the paste field forgives them); the query and other parameters stay');
    {
      const spaced = A.code.match(/.{1,8}/g).join('%20');
      const variants = [
        ['capitals', '#pc=' + A.code.toUpperCase()],
        ['a space every 8 characters (%20)', '#pc=' + spaced],
        ['spaces around (%20%20 ... %20)', '#pc=%20%20' + A.code + '%20'],
        ['dashes every 8 characters', '#pc=' + A.code.match(/.{1,8}/g).join('-')],
        ['mixed: capitals, dashes and spaces', '#pc=' + A.code.slice(0, 16).toUpperCase() + '-' + A.code.slice(16, 40) + '%20' + A.code.slice(40).toUpperCase()]
      ];
      for (const [label, hash] of variants) {
        const p = await open(hash);
        await waitNote(p);
        ok(label + ': paired (the code is kept in its plain form), the address is clean', (await storedCode(p)) === A.code && (await note(p)) === EN.connected && (await p.evaluate(() => location.hash === '')), String(await note(p)));
        ok(label + ': the code the site was asked about is the plain one, in the header only', statusCalls(p).length === 1 && statusCalls(p)[0].headers['x-ppp-pc'] === A.code && (await leaks(p, [A.code])).length === 0, (await leaks(p, [A.code])).join(' | '));
        await p.close();
      }
    }
    {
      /* the query string and other parameters of the address stay when the fragment goes */
      const ctx = await browser.createBrowserContext();
      const pg = await ctx.newPage();
      await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); localStorage.setItem('ppp-guest', '1'); } catch (e) { /* nothing */ } });
      await pg.goto(srv.origin + '/?utm=1&x=%20y#pc=' + B.code, { waitUntil: 'networkidle2', timeout: 60000 });
      await pg.waitForFunction(() => !!(window.PPP && window.PPP.app) && !!document.querySelector('[data-pair-note]'), { timeout: 20000 });
      ok('the query string is untouched, only the fragment is gone: /?utm=1&x=%20y', await pg.evaluate(() => location.pathname === '/' && location.search === '?utm=1&x=%20y' && location.hash === '' && location.href === location.origin + '/?utm=1&x=%20y'), await pg.evaluate(() => location.href));
      await ctx.close();
    }

    heading('fragments that are not a code: no request, nothing stored');
    {
      const bad = [
        ['63 hex', '#pc=' + A.code.slice(0, 63)],
        ['65 hex', '#pc=' + A.code + 'a'],
        ['junk after the code', '#pc=' + A.code + '&x=1'],
        ['junk before the code', '#pc=zz' + A.code],
        ['letters outside 0-9a-f', '#pc=' + 'g'.repeat(64)],
        ['empty', '#pc='],
        ['two codes', '#pc=' + A.code + A.code]
      ];
      for (const [label, hash] of bad) {
        const p = await open(hash);
        await waitNote(p);
        ok(label + ': the notice says the link is incomplete; the fragment is off the address bar (the partial code does not stay in it); nothing is stored; the site is not asked', (await note(p)) === EN.incomplete && (await p.evaluate(() => location.hash === '')) && (await stored(p)) === null && statusCalls(p).length === 0 && p.__rec.requests.filter(r => r.headers['x-ppp-pc']).length === 0, JSON.stringify({ note: await note(p), st: await stored(p), n: statusCalls(p).length }));
        await p.close();
      }
      /* fragments that are not "#pc=" at all are the page's own business: left alone, no notice, no request */
      for (const hash of ['#something', '#pc', '#pcx=' + A.code, '#PC=' + A.code, '#/pc=' + A.code, '#!pc=' + A.code, '#section-2']) {
        const p = await open(hash);
        p.__skipLeak = true;   /* these fragments are NOT the pairing link: they stay in the address on purpose, so the request URLs of these pages show them */
        await sleep(300);
        ok(hash.replace(A.code, '<code>') + ': left alone (still in the address bar), no notice, nothing stored, nothing asked', (await p.evaluate(h => location.hash === h, hash)) && !(await has(p, '[data-pair-note]')) && (await stored(p)) === null && statusCalls(p).length === 0 && clean(p), await p.evaluate(() => location.hash));
        await p.close();
      }
    }

    heading('a code the site does not know, and a revoked one');
    {
      const unknown = 'ab'.repeat(32);
      for (const [label, code] of [['unknown', unknown], ['revoked (link D was removed)', D.code]]) {
        const p = await open('#pc=' + code);
        await waitNote(p);
        ok(label + ': the notice says the code does not match, with the way out; nothing is stored; the address is clean', (await note(p)) === EN.mismatch && (await stored(p)) === null && (await p.evaluate(() => location.hash === '')), String(await note(p)));
        ok(label + ': the site was asked once, with the header, and the page never asked for jobs with it', statusCalls(p).length === 1 && statusCalls(p)[0].headers['x-ppp-pc'] === code && !p.__rec.requests.some(r => /\/api\/jobs/.test(r.url)));
        ok(label + ': no leak, no error; the page is on its home screen (no gate)', (await leaks(p, [code])).length === 0 && clean(p) && !(await has(p, '[data-auth]')), (await leaks(p, [code])).join(' | ') + errs(p));
        await goSettings(p);
        ok(label + ': Settings offers to make a link (nothing was kept)', await has(p, '[data-home-link-make]') && !(await has(p, '[data-home-pair-copy]')));
        await p.close();
      }
    }

    heading('the site cannot be reached: a notice, nothing stored');
    {
      const ctx = await browser.createBrowserContext();
      const pg = await ctx.newPage();
      await pg.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); localStorage.setItem('ppp-guest', '1'); } catch (e) { /* nothing */ } });
      await pg.setRequestInterception(true);
      pg.on('request', r => { if (/\/api\/worker\/status/.test(r.url())) return r.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The queue is not available right now. Try again in a minute.', code: 'store' }) }); r.continue(); });
      await pg.goto(srv.origin + '/#pc=' + A.code, { waitUntil: 'networkidle2', timeout: 60000 });
      await pg.waitForSelector('[data-pair-note]', { timeout: 20000 });
      ok('a 503 from the site: the notice says it could not be checked; the code is NOT stored (it was not verified)', (await pg.evaluate(() => document.querySelector('[data-pair-note]').firstElementChild.innerText.trim())) === EN.unreachable && (await pg.evaluate(k => localStorage.getItem(k), KEY)) === null);
      await ctx.close();
    }

    heading('a device that already has a link: switched, and it says so; the same link again is not "switched"');
    {
      const p = await open('#pc=' + A.code);
      await waitNote(p);
      ok('first: paired to A', (await storedCode(p)) === A.code && (await note(p)) === EN.connected);
      await p.evaluate(() => { document.querySelector('[data-pair-note-close]').click(); });
      await sleep(200);
      ok('the notice can be closed', !(await has(p, '[data-pair-note]')));
      await p.evaluate(c => { location.hash = '#pc=' + c; }, B.code);
      await waitNote(p);
      ok('then #pc=B in the same tab: now this device uses B; the notice names that the old link was replaced', (await storedCode(p)) === B.code && (await note(p)) === EN.replaced, String(await note(p)));
      ok('the page asks for its jobs with the NEW code from then on, and the old link is untouched on the site', withCode(p, B.code).some(r => /\/api\/jobs$/.test(r.url)) && (await req(srv.port, 'GET', '/api/worker/status', { code: A.code })).status === 200);
      await p.evaluate(() => { document.querySelector('[data-pair-note-close]').click(); });
      await p.evaluate(c => { location.hash = '#pc=' + c; }, B.code);
      await waitNote(p);
      ok('B again: still B, and it does not say "replaced" (nothing was replaced)', (await storedCode(p)) === B.code && (await note(p)) === EN.connected, String(await note(p)));
      ok('no leak of either code, no error', (await leaks(p, [A.code, B.code])).length === 0 && clean(p), (await leaks(p, [A.code, B.code])).join(' | '));
      /* a wrong link opened by a device that is paired keeps the old pairing */
      await p.evaluate(() => { document.querySelector('[data-pair-note-close]').click(); });
      await p.evaluate(() => { location.hash = '#pc=' + 'cd'.repeat(32); });
      await waitNote(p);
      ok('an unknown code opened on a paired device: the notice says it does not match and the device KEEPS its link (B)', (await storedCode(p)) === B.code && (await note(p)) === EN.mismatch, String(await note(p)));
      await p.close();
    }

    heading('the page is already open in the tab: the same pairing by hashchange; no history entry keeps the code');
    {
      const p = await open('');
      ok('(open, no link)', (await stored(p)) === null && !(await has(p, '[data-pair-note]')));
      const before = p.__rec.requests.length;
      await p.evaluate(c => { location.hash = '#pc=' + c; }, C.code);
      await waitNote(p);
      ok('typing the link\'s fragment into the open tab pairs it', (await storedCode(p)) === C.code && (await note(p)) === EN.connected, String(await note(p)));
      ok('the address is clean, and the first request after the change was made with a clean address', await p.evaluate(() => location.hash === '' && window.__calls.every(c => c.hash === '')));
      ok('no history entry holds the code (the whole history, by the browser\'s own list)', await (async () => {
        const cdp = await p.createCDPSession();
        const h = await cdp.send('Page.getNavigationHistory');
        return h.entries.length <= 3 && h.entries.every(e => !e.url.includes(C.code) && !/pc=/.test(e.url)) && JSON.stringify(h.entries.map(e => e.url));
      })());
      ok('the document was not reloaded (a navigation would have lost this marker)', (await p.evaluate(() => sessionStorage.getItem('__loads'))) === '1');
      ok('exactly one request was about the pairing: the status call', p.__rec.requests.slice(before).filter(r => /\/api\/worker\/status/.test(r.url)).length === 1);
      /* page.goto to the same document with a different fragment is also a hashchange */
      await p.evaluate(() => { document.querySelector('[data-pair-note-close]').click(); });
      await p.goto(srv.origin + '/#pc=' + A.code, { waitUntil: 'load' });
      await waitNote(p);
      ok('navigating the tab to the link again (a same-document navigation) pairs it too, and switches', (await storedCode(p)) === A.code && (await note(p)) === EN.replaced, String(await note(p)));
      await p.close();
    }

    heading('localStorage blocked: a notice, no request with the code, nothing stored');
    for (const mode of ['set', 'all']) {
      const p = await open('#pc=' + A.code, { block: mode });
      await waitNote(p);
      ok('(' + mode + ') the notice says this browser cannot keep the connection; the address is clean', (await note(p)) === EN.nostorage && (await p.evaluate(() => location.hash === '')), String(await note(p)));
      ok('(' + mode + ') the code was not sent anywhere (nothing to keep it for), and nothing was stored', p.__rec.requests.filter(r => r.headers['x-ppp-pc']).length === 0 && (mode === 'all' || (await stored(p)) === null));
      ok('(' + mode + ') no leak, no error', (await leaks(p, [A.code])).length === 0 && clean(p), (await leaks(p, [A.code])).join(' | ') + errs(p));
      await p.close();
    }
    {
      /* storage that is readable but cannot be written, on a device that already holds a link: it is verified, and the keep fails - the old link stays */
      const p = await open('#pc=' + A.code, { store: { [KEY]: JSON.stringify({ v: 1, code: C.code }) }, block: 'set' });
      await waitNote(p);
      ok('(set, with a link already there) the notice says it cannot keep the connection, and the old link is still the device\'s', (await note(p)) === EN.nostorage && (await storedCode(p)) === C.code, String(await note(p)));
      await p.close();
    }

    heading('the Settings card of a device with a link: ONE button, its warning, the rest under "More"');
    const F = await mk(6), G = await mk(7), H = await mk(8);
    await req(srv.port, 'POST', '/api/worker/claim', { token: F.token, body: { once: true } });
    await req(srv.port, 'GET', '/api/worker/ping', { token: G.token });
    const linkOf = c => srv.origin + '/#pc=' + c;
    {
      const p = await open('#pc=' + F.code, { share: true, clip: 'ok' });
      await waitNote(p);
      await goSettings(p);
      const status = await text(p, '[data-home-status-line]');
      ok('the status line: "PC connected · last seen just now" (the PC polled a moment ago)', /^PC connected · last seen (just now|1 min ago)$/.test(status), String(status));
      ok('the card shows the copy button, the Share button (this browser has navigator.share) and "More" - nothing else', JSON.stringify(await cardButtons(p)) === JSON.stringify([EN.copyLabel, 'Share', 'More']), JSON.stringify(await cardButtons(p)));
      ok('the one-line warning is under the button', (await text(p, '[data-home-pair-warning]')) === EN.warning, String(await text(p, '[data-home-pair-warning]')));
      ok('the old buttons and the paste form are NOT in the page until More is opened', !(await has(p, '[data-home-code-show]')) && !(await has(p, '[data-home-token-rotate]')) && !(await has(p, '[data-home-link-remove]')) && !(await has(p, '[data-home-link-forget]')) && !(await has(p, '[data-home-use]')));
      ok('the link is not on the page either (it is a secret): no input holds it', !(await has(p, '[data-home-pair-link]')) && !(await has(p, '[data-home-pair-link-new]')) && (await leaks(p, [F.code])).length === 0, (await leaks(p, [F.code])).join(' | '));
      await shot(p, '[data-home-settings]', 'card-linked-1100.png');
      await click(p, '[data-home-pair-copy]');
      await sleep(300);
      ok('the button copies https://<site>/#pc=<code> to the clipboard', (await p.evaluate(() => window.__clip)) === linkOf(F.code), String(await p.evaluate(() => window.__clip)));
      ok('and says "Copied"; the link is still not shown on the page', (await text(p, '[data-home-pair-copy]')) === 'Copied' && !(await has(p, '[data-home-pair-link]')));
      await sleep(2800);
      ok('the label comes back after a moment', (await text(p, '[data-home-pair-copy]')) === EN.copyLabel);
      await click(p, '[data-home-pair-share]');
      await sleep(200);
      ok('Share calls navigator.share with the link (the page of this site)', await p.evaluate(l => window.__shared && window.__shared.url === l, linkOf(F.code)), JSON.stringify(await p.evaluate(() => window.__shared)));
      await click(p, '[data-home-more]');
      await sleep(300);
      ok('More opens the old buttons: Show my PC code, New PC token, Remove link, Forget on this device, and the paste form (Use a PC link from another device)', JSON.stringify(await cardButtons(p)) === JSON.stringify([EN.copyLabel, 'Share', 'Hide', 'Show my PC code', 'New PC token', 'Remove link', 'Forget on this device', 'Use this link']) && (await has(p, '[data-home-use-input]')), JSON.stringify(await cardButtons(p)));
      ok('Show my PC code still shows the raw code (to type it somewhere) - from under More', await (async () => { await click(p, '[data-home-code-show]'); await sleep(300); return (await val(p, '[data-home-code-shown]')) === F.code; })());
      await shot(p, '[data-home-settings]', 'card-more-1100.png');
      await click(p, '[data-home-more]');
      await sleep(300);
      ok('More closes them again', !(await has(p, '[data-home-link]')) && !(await has(p, '[data-home-use]')) && (await text(p, '[data-home-more]')) === 'More');
      ok('the Add screen asks for the list with the code (the status line and the list work as before)', await (async () => { await goAdd(p); return withCode(p, F.code).some(r => /\/api\/jobs$/.test(r.url)); })());
      await p.close();
    }
    {
      const p = await open('#pc=' + F.code, { share: 'none', clip: 'ok' });
      await waitNote(p); await goSettings(p);
      ok('without navigator.share there is no Share button: the copy button and More only', JSON.stringify(await cardButtons(p)) === JSON.stringify([EN.copyLabel, 'More']), JSON.stringify(await cardButtons(p)));
      await p.close();
    }
    {
      const p = await open('#pc=' + G.code, { share: 'none' });
      await waitNote(p); await goSettings(p);
      ok('a PC that has checked in once (a --check) shows what the site says: connected and last seen just now', /^(PC connected|Waiting for your PC) · last seen (just now|1 min ago)$/.test(await text(p, '[data-home-status-line]')), String(await text(p, '[data-home-status-line]')));
      const views = await p.evaluate(() => { const A = window.PPP.app, ago = ms => new Date(Date.now() - ms).toISOString(); const v = w => A.homeView(Object.assign({}, A.state, { homeWorker: w })).homeStatusLine; return { off3h: v({ everSeen: true, alive: false, hasToken: true, lastSeenAt: ago(3 * 3600e3) }), off2d: v({ everSeen: true, alive: false, hasToken: true, lastSeenAt: ago(3 * 86400e3) }), on5: v({ everSeen: true, alive: true, hasToken: true, lastSeenAt: ago(5 * 60e3) }), on90: v({ everSeen: true, alive: true, hasToken: true, lastSeenAt: ago(90 * 60e3) }) }; });
      ok('a PC that is not polling: "Waiting for your PC · last seen 3 h ago" (3 days: "3 days ago"); one that is: "PC connected · last seen 5 min ago" (90 min: "2 h ago")', views.off3h === 'Waiting for your PC · last seen 3 h ago' && views.off2d === 'Waiting for your PC · last seen 3 days ago' && views.on5 === 'PC connected · last seen 5 min ago' && views.on90 === 'PC connected · last seen 2 h ago', JSON.stringify(views));
      await p.close();
      const q = await open('#pc=' + H.code, { share: 'none' });
      await waitNote(q); await goSettings(q);
      ok('a PC that never connected: "Waiting for your PC" and no last seen', (await text(q, '[data-home-status-line]')) === 'Waiting for your PC', String(await text(q, '[data-home-status-line]')));
      await q.close();
    }

    heading('the copy falls back when the browser refuses: the link is shown, selected, for the person to copy');
    for (const [label, clip, exec, copied] of [['clipboard refuses (permission), execCommand fails', 'reject', 'false', false], ['no clipboard at all, execCommand works', 'missing', 'true', true], ['no clipboard, execCommand fails', 'missing', 'false', false], ['clipboard refuses, execCommand works', 'reject', 'true', true]]) {
      const p = await open('#pc=' + F.code, { clip: clip, exec: exec, share: 'none' });
      await waitNote(p); await goSettings(p);
      await click(p, '[data-home-pair-copy]');
      await sleep(500);
      const x = await p.evaluate(() => window.__exec || null);
      const shown = await has(p, '[data-home-pair-link]');
      if (copied) {
        ok(label + ': copied the old way - the field was selected (0..' + linkOf(F.code).length + ') and "Copied" is said; the link is not left on the page', !!x && x.cmd === 'copy' && x.value === linkOf(F.code) && x.from === 0 && x.to === linkOf(F.code).length && (await text(p, '[data-home-pair-copy]')) === 'Copied' && !shown, JSON.stringify(x));
      } else {
        ok(label + ': the link is shown in a read-only field, all of it selected, with "copy it by hand"', shown && (await val(p, '[data-home-pair-link]')) === linkOf(F.code) && await p.evaluate(() => { const e = document.querySelector('[data-home-pair-link]'); return e.selectionStart === 0 && e.selectionEnd === e.value.length && document.activeElement === e; }) && /copy it by hand/.test(await text(p, '[data-home-pair-manual]')), JSON.stringify(x));
        ok(label + ': nothing is claimed as copied', (await text(p, '[data-home-pair-copy]')) === EN.copyLabel);
      }
      ok(label + ': no page or console error', clean(p), errs(p));
      await p.close();
    }

    heading('a device with no link: ONE button; making a link says what to do, in order');
    {
      const p = await open('', { share: true, clip: 'ok' });
      await goSettings(p);
      ok('the card offers "Create my PC link" and "More" - nothing else', JSON.stringify(await cardButtons(p)) === JSON.stringify(['Create my PC link', 'More']), JSON.stringify(await cardButtons(p)));
      await shot(p, '[data-home-settings]', 'card-nolink-1100.png');
      await click(p, '[data-home-more]'); await sleep(300);
      ok('More has the paste form: "Use a PC link from another device", its hint says a link or a code', (await has(p, '[data-home-use-input]')) && /Paste the link or the PC code/.test(await text(p, '[data-home-use]')) && JSON.stringify(await cardButtons(p)) === JSON.stringify(['Create my PC link', 'Hide', 'Use this link']), JSON.stringify(await cardButtons(p)));
      await click(p, '[data-home-more]'); await sleep(200);
      await click(p, '[data-home-link-make]');
      await p.waitForSelector('[data-home-new]', { timeout: 10000 });
      await sleep(400);
      const code = await storedCode(p);
      const dlg = await text(p, '[data-home-new]');
      const i0 = dlg.indexOf('Your PC link is ready.'), i1 = dlg.indexOf('1. Copy this link and open it on your other devices.'), i2 = dlg.indexOf('2. Only if your PC has no worker yet:'), i3 = dlg.indexOf('worker.config.example.json');
      ok('the dialog says, in this order: the title, 1. copy this link and open it on your other devices, 2. only if your PC has no worker yet, then the PC\'s lines', i0 === 0 && i1 > i0 && i2 > i1 && i3 > i2, JSON.stringify([i0, i1, i2, i3]));
      ok('the pairing link is in the field (this site, #pc=, the 64 hex that this device keeps) and nothing else of the code is shown', (await val(p, '[data-home-pair-link-new]')) === linkOf(code) && /^[0-9a-f]{64}$/.test(code) && !(await has(p, '[data-home-code-value]')));
      ok('the link\'s step comes before the PC\'s step in the page itself, and the warning is under the link', await p.evaluate(() => { const a = document.querySelector('[data-home-step1]'), b = document.querySelector('[data-home-step2]'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !!a.querySelector('[data-home-warning]'); }) && (await text(p, '[data-home-warning]')) === EN.warning);
      const tok = await val(p, '[data-home-token-value]'), steps = await text(p, '[data-home-steps]');
      ok('step 2 holds the worker token and the existing lines (siteUrl, token, --check, --once), with no "1. 2. 3. 4." competing with the dialog\'s own numbers', /^ppw_/.test(tok) && steps.includes('"siteUrl": "' + srv.origin + '"') && steps.includes('"token": "' + tok + '"') && /worker\.js --check/.test(steps) && /worker\.js --once/.test(steps) && !/^\d\. /m.test(steps), steps.slice(0, 200));
      await click(p, '[data-home-pair-copy-new]'); await sleep(300);
      ok('Copy puts the pairing link on the clipboard', (await p.evaluate(() => window.__clip)) === linkOf(code), String(await p.evaluate(() => window.__clip)));
      await click(p, '[data-home-pair-share-new]'); await sleep(200);
      ok('Share (this browser has it) shares the same link', await p.evaluate(l => window.__shared && window.__shared.url === l, linkOf(code)));
      await shot(p, '[data-home-settings]', 'dialog-1100.png');
      await click(p, '[data-home-new-done]'); await sleep(300);
      ok('"I have saved them" puts the dialog away; the card is now the linked one with its one button', !(await has(p, '[data-home-new]')) && JSON.stringify(await cardButtons(p)) === JSON.stringify([EN.copyLabel, 'Share', 'More']), JSON.stringify(await cardButtons(p)));
      ok('the page never put the code in a request URL, a body, a console line, a cookie or another storage key', (await leaks(p, [code], { domOk: true })).length === 0, (await leaks(p, [code], { domOk: true })).join(' | '));
      await p.close();
      /* the paste form takes the whole link, too */
      const q = await open('', { share: 'none' });
      await goSettings(q);
      await click(q, '[data-home-more]'); await sleep(200);
      await q.type('[data-home-use-input]', 'Open this on your phone: ' + linkOf(F.code) + '  ');
      await q.evaluate(() => document.querySelector('[data-home-use-input]').dispatchEvent(new Event('change', { bubbles: true })));
      await click(q, '[data-home-use-go]');
      await sleep(900);
      ok('a whole pairing link pasted into "Use a PC link from another device" (with words before it, spaces after) is accepted: the device is linked', (await storedCode(q)) === F.code && await has(q, '[data-home-pair-copy]'), String(await storedCode(q)));
      await q.close();
    }

    heading('the Add screen of a device with no link is as it was before this change');
    {
      const { execFileSync } = require('child_process');
      let base = null;
      try { base = execFileSync('git', ['show', '2b1aa44:Piano Coach App.dc.html'], { cwd: L.REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { base = null; }
      if (base) {
        const norm = h => h.replace(/\s+/g, ' ').replace(/ data-reactroot=""/g, '');
        const old = await open('', { baseHtml: base });
        await goAdd(old);
        const a = norm(await old.evaluate(() => document.querySelector('[data-add-sheet]').outerHTML));
        const now = await open('', {});
        await goAdd(now);
        const b = norm(await now.evaluate(() => document.querySelector('[data-add-sheet]').outerHTML));
        ok('the Add-sheet-music card of a device with no link is identical, tag for tag, to the one of main before this change (2b1aa44; ' + a.length + ' characters)', a === b && a.length > 3000, a === b ? '' : 'differs near ' + [...a].findIndex((c, i) => c !== b[i]));
        ok('and it asks the site nothing about links or jobs', now.__rec.requests.filter(r => /\/api\/(jobs|worker|pc-links)/.test(r.url)).length === 0);
        await old.close(); await now.close();
      } else console.log('  - git history of 2b1aa44 not available: the Add-card check is skipped');
    }

    heading('Korean, Japanese, Chinese: the notices, the card and the dialog are in the person\'s language; the catalogs hold every new sentence');
    const cat = {};
    for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) cat[loc] = JSON.parse(fs.readFileSync(path.join(L.REPO, 'i18n', loc + '.json'), 'utf8')).content;
    const src = fs.readFileSync(PAGE_FILE, 'utf8');
    for (const loc of Object.keys(cat)) {
      const missing = NEW_KEYS.filter(k => !cat[loc][k] || cat[loc][k] === k);
      const slots = NEW_KEYS.filter(k => cat[loc][k] && (k.match(/\{\{\w+\}\}/g) || []).sort().join() !== (cat[loc][k].match(/\{\{\w+\}\}/g) || []).sort().join());
      ok(loc + ': all ' + NEW_KEYS.length + ' new sentences are in the catalog, translated, with their {{slots}}', missing.length === 0 && slots.length === 0, missing.concat(slots).join(' | ').slice(0, 200));
    }
    ok('every one of them is used by the page as tx(\'...\') (no dead key, no typo between the page and the catalogs)', NEW_KEYS.every(k => src.includes("tx('" + k + "'")), NEW_KEYS.filter(k => !src.includes("tx('" + k + "'")).join(' | '));
    ok('Korean, word for word as asked: the connected notice and the "code does not match" notice', cat['ko-KR'][EN.connected] === 'PC가 연결됐어요. 이제 유튜브 링크를 넣으면 「고품질 변환(내 PC)」 버튼이 보여요.' && cat['ko-KR'][EN.mismatch] === '연결 코드가 맞지 않아요. 연결을 만든 기기에서 새 링크를 복사해 주세요.');
    for (const loc of Object.keys(cat)) {
      const T = k => cat[loc][k];
      const p = await open('#pc=' + F.code, { locale: loc, share: 'none' });
      await waitNote(p);
      ok(loc + ': the connected notice', (await note(p)) === T(EN.connected), String(await note(p)));
      await p.evaluate(() => document.querySelector('[data-pair-note-close]').click());
      await p.evaluate(c => { location.hash = '#pc=' + c; }, A.code); await waitNote(p);
      ok(loc + ': the "replaced" notice', (await note(p)) === T(EN.replaced), String(await note(p)));
      await p.evaluate(() => document.querySelector('[data-pair-note-close]').click());
      await p.evaluate(() => { location.hash = '#pc=' + 'ef'.repeat(32); }); await waitNote(p);
      ok(loc + ': the "does not match" notice', (await note(p)) === T(EN.mismatch));
      await p.evaluate(() => document.querySelector('[data-pair-note-close]').click());
      await p.evaluate(() => { location.hash = '#pc=abc'; }); await waitNote(p);
      ok(loc + ': the "incomplete" notice', (await note(p)) === T(EN.incomplete));
      await p.evaluate(c => { location.hash = '#pc=' + c; }, F.code); await waitNote(p);
      await goSettings(p);
      ok(loc + ': the card: the one button, its warning, More, and the status line', JSON.stringify(await cardButtons(p)) === JSON.stringify([T(EN.copyLabel), T('More')]) && (await text(p, '[data-home-pair-warning]')) === T(EN.warning) && new RegExp('^' + T('PC connected') + ' · ' + T('last seen {{ago}}').replace('{{ago}}', '(' + T('just now') + '|' + T('{{n}} min ago').replace('{{n}}', '\\d+') + ')') + '$').test(await text(p, '[data-home-status-line]')), JSON.stringify(await cardButtons(p)) + ' | ' + (await text(p, '[data-home-status-line]')));
      await p.close();
      const q = await open('', { locale: loc, share: 'none' });
      await goSettings(q);
      await click(q, '[data-home-link-make]'); await q.waitForSelector('[data-home-new]', { timeout: 10000 }); await sleep(400);
      const d = await text(q, '[data-home-new]');
      ok(loc + ': the dialog: title, step 1, step 2, in order, translated', d.indexOf(T('Your PC link is ready.')) === 0 && d.indexOf(T('1. Copy this link and open it on your other devices.')) > 0 && d.indexOf(T('2. Only if your PC has no worker yet:')) > d.indexOf(T('1. Copy this link and open it on your other devices.')) && (await text(q, '[data-home-warning]')) === T(EN.warning), d.slice(0, 120));
      ok(loc + ': no page or console error', clean(q), errs(q));
      await q.close();
    }

    heading('400 px wide (a phone): nothing sticks out of the card, the buttons wrap');
    for (const loc of ['en-US', 'ko-KR']) {
      const fit = async (p, what) => {
        const m = await p.evaluate(() => {
          const card = document.querySelector('[data-home-settings]'), r = card.getBoundingClientRect();
          const out = [...card.querySelectorAll('button, input, div')].filter(e => e.offsetParent !== null).map(e => ({ t: e.tagName + (e.getAttribute('data-home-pair-copy') !== null ? '[copy]' : ''), right: e.getBoundingClientRect().right, left: e.getBoundingClientRect().left })).filter(x => x.right > r.right + 1 || x.left < r.left - 1);
          return { cardRight: r.right, cardLeft: r.left, vw: window.innerWidth, docW: document.documentElement.scrollWidth, over: out.slice(0, 3), cardScroll: card.scrollWidth, cardClient: card.clientWidth };
        });
        ok(loc + ' 400 px: ' + what + ' - the card is inside the screen, no element past its edge, no sideways scroll of the page', m.vw === 400 && m.cardRight <= 400 && m.cardLeft >= 0 && m.over.length === 0 && m.cardScroll <= m.cardClient + 1 && m.docW <= 400, JSON.stringify(m));
      };
      const p = await open('#pc=' + F.code, { locale: loc, width: 400, height: 900, share: true, noGuest: true });
      await waitNote(p);
      await shot(p, '[data-pair-note]', 'notice-400-' + loc + '.png');
      await goSettings(p);
      await p.evaluate(() => document.querySelector('[data-home-settings]').scrollIntoView());
      await fit(p, 'a linked device');
      await shot(p, '[data-home-settings]', 'card-linked-400-' + loc + '.png');
      await click(p, '[data-home-more]'); await sleep(300);
      await click(p, '[data-home-code-show]'); await sleep(300);
      await fit(p, 'More open, the code shown');
      await shot(p, '[data-home-settings]', 'card-more-400-' + loc + '.png');
      await p.close();
      const q = await open('', { locale: loc, width: 400, height: 900, share: true });
      await goSettings(q);
      await fit(q, 'no link');
      await shot(q, '[data-home-settings]', 'card-nolink-400-' + loc + '.png');
      await click(q, '[data-home-link-make]'); await q.waitForSelector('[data-home-new]', { timeout: 10000 }); await sleep(400);
      await fit(q, 'the dialog');
      await shot(q, '[data-home-settings]', 'dialog-400-' + loc + '.png');
      await q.close();
    }

    heading('no leak, over every page of this run: the codes are in no URL, no header but X-PPP-PC to /api/, no body, no console line - and on the wire');
    {
      const codes = [A, B, C, D, E].map(x => x.code);
      const bad = [];
      allPages.filter(pg => !pg.__skipLeak).forEach(pg => bad.push(...requestLeaks(pg.__rec, codes)));
      ok('over ' + allPages.length + ' pages and ' + allPages.reduce((n, p) => n + p.__rec.requests.length, 0) + ' requests: nothing', bad.length === 0, bad.slice(0, 5).join(' | '));
      ok('and on the wire, over everything the browsers sent (' + Math.round(srv.wire.text.length / 1024) + ' KB, ' + srv.wire.conns + ' connections): no "#", no "pc=", no code outside the X-PPP-PC lines', wireLeaks(srv.wire, codes).length === 0, wireLeaks(srv.wire, codes).join(' | '));
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    proxy.close();
    await server.close();
    L.rmDir(dir);
  }
  L.finish('pairing in the page');
})();
