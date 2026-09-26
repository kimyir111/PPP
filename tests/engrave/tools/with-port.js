/* Preload: run the browser suites (tests/*.test.js, which open 127.0.0.1:8777 by name) against the server of another
   worktree, without editing them. 8777 is often another session's server, serving another tree (G04 §32.12.9).

     NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js          (this worktree; production mode spawns nothing on 8788)
     PPP_PORT=8801 NODE_PATH=D:/PPP/node_modules node -r ./tests/engrave/tools/with-port.js tests/engraving.test.js

   It rewrites 127.0.0.1:8777 / localhost:8777 in puppeteer's page.goto - pages from browser.newPage and from every browser
   context (createBrowserContext, the default one: auth-ui's guest, share's second person; G4d-2) - and in Node
   http.request/get and fetch. Check it took: the page's window.PPPEngrave.version is this tree's (the summary line below
   prints it).

   G4d-2 (docs/GOALS/G04 §16, A30):
     PPP_RENDERER=legacy    every page opens with the rollback on (localStorage 'ppp.renderer', set before the app runs on
                            every document, so a reload keeps it). G4f-2 flipped the default to 'engrave': with no
                            PPP_RENDERER a suite runs the default page, the engraver's; PPP_RENDERER=engrave says so
                            explicitly (under G4d-2 it switched the engraver on). PPP_STRICT=1 adds 'ppp.strictEngrave'
     the page's own health check of the local helper (http://127.0.0.1:8788/health, which nothing serves on a PC without the
     helper) is kept out of the suites' console and requestfailed listeners - it failed the suites that count console errors
     on every tree alike (G04 §33.14); PPP_KEEP_8788=1 turns this off
     at exit one line: the tree's PPPEngrave.version, the renderer, and the engraver's draws and fallbacks by code over every
     page the suite opened (read before each navigation and close) - so a pass under 'engrave' is known to be the engraver's */
'use strict';
const Module = require('module');
const http = require('http');
const TO = process.env.PPP_PORT || '8793';
const RENDERER = process.env.PPP_RENDERER || '';
const STRICT = process.env.PPP_STRICT === '1';
const KEEP_8788 = process.env.PPP_KEEP_8788 === '1';
const fix = u => (typeof u === 'string' ? u.replace(/(127\.0\.0\.1|localhost):8777/g, '127.0.0.1:' + TO) : u);
const helperUrl = u => /^https?:\/\/(127\.0\.0\.1|localhost):8788\//.test(String(u || ''));

const summary = { pages: 0, versions: new Set(), renderer: new Set(), draws: 0, fallbacks: {}, fallbackWarnings: 0, fallbackTexts: [], songs: [], routed: 0, errors: 0 };
async function collect(p) {
  try {
    if (p.isClosed && p.isClosed()) return;
    const r = await Promise.race([
      p.evaluate(() => {
        const S = window.PPPEngravePage && window.PPPEngravePage.stats;
        return { v: window.PPPEngrave && window.PPPEngrave.version, r: window.PPP && window.PPP.renderer,
          draws: S ? S.draws : 0, routed: (S ? S.routed : 0) + (window.PPP && window.PPP.engraveStats ? window.PPP.engraveStats.routed || 0 : 0), fb: window.PPP && window.PPP.engraveStats ? window.PPP.engraveStats.fallbacks : null,
          songs: window.PPP && window.PPP.engraveStats ? Object.keys(window.PPP.engraveStats.bySong).map(k => k + ' ' + window.PPP.engraveStats.bySong[k]) : [] };
      }),
      new Promise(res => setTimeout(() => res(null), 1500))
    ]);
    if (!r) return;
    if (r.v) summary.versions.add(r.v);
    if (r.r) summary.renderer.add(r.r);
    summary.draws += r.draws || 0;
    summary.routed += r.routed || 0;
    Object.keys(r.fb || {}).forEach(k => { summary.fallbacks[k] = (summary.fallbacks[k] || 0) + r.fb[k]; });
    (r.songs || []).forEach(s => { if (summary.songs.length < 12 && summary.songs.indexOf(s) < 0) summary.songs.push(s); });
  } catch (e) { summary.errors++; }
}

const patchPage = p => {
  if (!p || p.__ppp8777) return p;
  p.__ppp8777 = true;
  summary.pages++;
  const goto = p.goto.bind(p);
  p.goto = async (u, o) => { await collect(p); return goto(fix(u), o); };
  const reload = p.reload.bind(p);
  p.reload = async o => { await collect(p); return reload(o); };
  const close = p.close.bind(p);
  p.close = async o => { await collect(p); return close(o); };
  if (RENDERER) {
    p.evaluateOnNewDocument((r, strict) => {
      try { localStorage.setItem('ppp.renderer', r); if (strict) localStorage.setItem('ppp.strictEngrave', '1'); } catch (e) { /* no storage */ }
    }, RENDERER, STRICT).catch(() => {});
  }
  p.on('console', m => {
    if (!/\[ppp\] engrave fallback/.test(m.text())) return;
    summary.fallbackWarnings++;
    if (summary.fallbackTexts.length < 6) summary.fallbackTexts.push(m.text().slice(0, 400));
  });
  if (!KEEP_8788) {
    /* the suites' own listeners never see the helper's refused health check */
    const on = p.on.bind(p);
    const quiet = (ev, fn) => {
      if (ev === 'console') return function (m) { const loc = m && m.location && m.location(); if (loc && helperUrl(loc.url)) return; return fn.apply(this, arguments); };
      if (ev === 'requestfailed') return function (req) { if (req && helperUrl(req.url())) return; return fn.apply(this, arguments); };
      return fn;
    };
    const once = p.once.bind(p), off = p.off.bind(p);
    const wrapped = new WeakMap();
    p.on = (ev, fn) => { const w = quiet(ev, fn); if (w !== fn) wrapped.set(fn, w); return on(ev, w); };
    p.once = (ev, fn) => { const w = quiet(ev, fn); if (w !== fn) wrapped.set(fn, w); return once(ev, w); };
    p.off = (ev, fn) => off(ev, wrapped.get(fn) || fn);
  }
  return p;
};
const patchContext = c => {
  if (!c || c.__ppp8777) return c;
  c.__ppp8777 = true;
  const np = c.newPage.bind(c);
  c.newPage = async function () { return patchPage(await np.apply(null, arguments)); };
  const pages = c.pages.bind(c);
  c.pages = async function () { return (await pages()).map(patchPage); };
  return c;
};
const patchBrowser = b => {
  const np = b.newPage.bind(b);
  b.newPage = async function () { return patchPage(await np.apply(null, arguments)); };
  const pages = b.pages.bind(b);
  b.pages = async function () { return (await pages()).map(patchPage); };
  if (typeof b.createBrowserContext === 'function') {
    const cc = b.createBrowserContext.bind(b);
    b.createBrowserContext = async function () { return patchContext(await cc.apply(null, arguments)); };
  }
  if (typeof b.createIncognitoBrowserContext === 'function') {
    const ci = b.createIncognitoBrowserContext.bind(b);
    b.createIncognitoBrowserContext = async function () { return patchContext(await ci.apply(null, arguments)); };
  }
  if (typeof b.defaultBrowserContext === 'function') patchContext(b.defaultBrowserContext());
  const close = b.close.bind(b);
  b.close = async function () {
    try { for (const p of await pages()) if (p.__ppp8777) await collect(p); } catch (e) { /* closing anyway */ }
    return close.apply(null, arguments);
  };
  return b;
};
const cache = new Map();
const origLoad = Module._load;
Module._load = function (req) {
  const m = origLoad.apply(this, arguments);
  if (req !== 'puppeteer' && req !== 'puppeteer-core') return m;
  if (cache.has(m)) return cache.get(m);
  /* a copy of the module with launch wrapped: the module namespace itself is read-only */
  const w = {};
  Object.keys(m).forEach(k => { w[k] = m[k]; });
  const launch = (m.launch || (m.default && m.default.launch)).bind(m.default || m);
  w.launch = async function () { return patchBrowser(await launch.apply(null, arguments)); };
  if (m.default) {
    const d = Object.create(m.default);
    d.launch = w.launch;
    w.default = d;
  }
  cache.set(m, w);
  return w;
};
const wrap = fn => function (a, b, c) {
  if (typeof a === 'string') a = fix(a);
  else if (a instanceof URL) { if (a.port === '8777') { a = new URL(a.href); a.port = TO; } }
  else if (a && typeof a === 'object' && String(a.port) === '8777') a = Object.assign({}, a, { port: +TO });
  return fn.call(this, a, b, c);
};
http.request = wrap(http.request);
http.get = wrap(http.get);
if (typeof globalThis.fetch === 'function') {
  const f = globalThis.fetch;
  globalThis.fetch = (u, o) => f(typeof u === 'string' ? fix(u) : u, o);
}
process.on('exit', () => {
  const fb = Object.keys(summary.fallbacks).map(k => k + ' ' + summary.fallbacks[k]).join(', ') || 'none';
  process.stdout.write('[with-port] ' + TO + ': PPPEngrave ' + ([...summary.versions].join('/') || '?') + ', renderer ' + ([...summary.renderer].join('/') || '?') +
    ', engraver draws ' + summary.draws + ', fallbacks ' + fb + ' (warnings ' + summary.fallbackWarnings + '), routed to legacy ' + summary.routed +
    ', pages ' + summary.pages + '\n');
  summary.fallbackTexts.forEach(t => process.stdout.write('[with-port]   ' + t + '\n'));
  if (summary.songs.length) process.stdout.write('[with-port]   songs: ' + summary.songs.join('; ') + '\n');
});
