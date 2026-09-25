/* Preload: run the browser suites (tests/*.test.js, which open 127.0.0.1:8777 by name) against the server of another
   worktree, without editing them. 8777 is often another session's server, serving another tree (G04 §32.12.9).

     PORT=8793 node server.js                                  (this worktree)
     PPP_PORT=8793 NODE_PATH=D:/PPP/node_modules node -r ./tests/engrave/tools/with-port.js tests/engraving.test.js

   It rewrites 127.0.0.1:8777 / localhost:8777 in puppeteer's page.goto, Node http.request/get and fetch. Check it took:
   the page's window.PPPEngrave.version is this tree's. */
'use strict';
const Module = require('module');
const http = require('http');
const TO = process.env.PPP_PORT || '8793';
const fix = u => (typeof u === 'string' ? u.replace(/(127\.0\.0\.1|localhost):8777/g, '127.0.0.1:' + TO) : u);
const patchPage = p => {
  if (!p || p.__ppp8777) return p;
  const goto = p.goto.bind(p);
  p.goto = (u, o) => goto(fix(u), o);
  p.__ppp8777 = true;
  return p;
};
const patchBrowser = b => {
  const np = b.newPage.bind(b);
  b.newPage = async function () { return patchPage(await np.apply(null, arguments)); };
  const pages = b.pages.bind(b);
  b.pages = async function () { return (await pages()).map(patchPage); };
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
