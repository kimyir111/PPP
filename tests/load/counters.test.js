'use strict';
/* G13-7b (U5): the page's anonymous counters, the inline head script PPP_COUNTS, run in a vm against a fake window (Node only; the browser half is tests/load-app/counters.test.js).

   What is proved: what counts as an error and in which class (never the message, the stack or the address; a failed script of this site is `load`, of another site `thirdparty`); a thrown error
   is counted once; the timing buckets; one beacon a visit (a second only when something new happened, at most 5 a page load); nothing is sent when a person turned it off, when the browser says
   Do Not Track or Global Privacy Control, or when there is nothing to say after the first; credentials are omitted; the body is under 1 KB at every cap and for any code; a deferred global is
   never read directly (PPP_LAZY.peek); nothing throws with every API missing; and - the cost rule - a beacon is never the request that wakes a sleeping server: it is sent only when the server
   answered this page in the last ten minutes, otherwise it waits in localStorage and goes with the next visit (a fake clock and fake resource timings drive that). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { script, pageText } = require('./head');

const SRC = script('anonymous counters');
const J = JSON.stringify;
const MIN = 60 * 1000;
const ORIGIN = 'https://ppp.example';
const PEND = 'ppp.counts.pending.v1';

/* a page: window, document and navigator as the script reads them. The clock is the wall clock (Date.now); the page was opened `age` ms ago and the server answered it at once (cold: nothing
   answered it recently). */
function rig(o) {
  o = o || {};
  const sent = [], store = Object.assign({}, o.storage || {});
  const clock = { now: o.now0 || 100 * 24 * 60 * MIN };
  const win = { peeked: [] };
  const L = { window: {}, doc: {} };
  win.addEventListener = (t, fn, cap) => { (L.window[t] = L.window[t] || []).push({ fn, cap }); };
  win.fire = (t, ev) => (L.window[t] || []).forEach(l => l.fn(ev || {}));
  win.captures = t => (L.window[t] || []).map(l => l.cap);
  const doc = { visibilityState: 'visible', documentElement: { lang: o.lang === undefined ? 'ko-KR' : o.lang } };
  doc.addEventListener = (t, fn) => { (L.doc[t] = L.doc[t] || []).push(fn); };
  doc.hide = () => { doc.visibilityState = 'hidden'; (L.doc.visibilitychange || []).forEach(f => f({})); };
  doc.show = () => { doc.visibilityState = 'visible'; (L.doc.visibilitychange || []).forEach(f => f({})); };
  if (o.storage !== null) {
    win.localStorage = o.storageThrows ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  }
  win.store = store;
  win.location = { origin: o.origin || ORIGIN };
  /* resource timings: the page opened `age` ms ago and its own document came over the network 400 ms after that, unless the test says the server was not asked (cold) */
  const entries = [];
  const timeOrigin = clock.now - (o.age === undefined ? 60 * 1000 : o.age);
  const navigation = o.cold ? [] : [{ name: (o.origin || ORIGIN) + '/Piano%20Coach%20App.dc.html', responseEnd: 400, transferSize: 300000 }];
  const observers = [];
  if (o.perf !== false) {
    win.performance = {
      timeOrigin, now: () => (o.now === undefined ? 3100 : o.now),
      getEntriesByName: n => (n === 'first-contentful-paint' && o.fcp !== null ? [{ startTime: o.fcp === undefined ? 1500 : o.fcp }] : []),
      getEntriesByType: t => (t === 'navigation' ? navigation : [])
    };
  }
  if (o.observer !== false) {
    win.PerformanceObserver = function (cb) { this.cb = cb; this.observe = opts => { this.opts = opts; observers.push(this); entries.forEach(e => cb({ getEntries: () => [e] })); }; };
  }
  /* an answer of the server (or of another site) at `ago` ms before now */
  win.answered = (name, ago, extra) => {
    const e = Object.assign({ name: name, responseEnd: clock.now - ago - timeOrigin, transferSize: 1200 }, extra || {});
    entries.push(e);
    observers.forEach(ob => ob.cb({ getEntries: () => [e] }));
  };
  if (o.fetch !== false) {
    win.fetch = (url, init) => { sent.push({ via: 'fetch', url, init }); return o.fetchRejects ? Promise.reject(new Error('offline')) : Promise.resolve({}); };
    win.Request = function Request() {};
    if (o.keepalive !== false) win.Request.prototype.keepalive = false;
  }
  win.PPP_BUILD = o.build === undefined ? 'fab0ba3' : o.build;
  const lazy = { groups: o.groups || [] };
  if (o.lazy !== false) {
    win.PPP_LAZY = {
      peek: name => { win.peeked.push(name); return (o.globals || {})[name]; },
      status: () => ({ mode: 'on', groups: lazy.groups })
    };
  }
  if (o.practice) win.PPP = { practiceStats: o.practice };
  if (o.globals) Object.keys(o.globals).forEach(k => {
    Object.defineProperty(win, k, { configurable: true, enumerable: false, get() { win.directReads = (win.directReads || 0) + 1; return o.globals[k]; } });
  });
  const nav = { userAgent: o.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36', doNotTrack: o.dnt === undefined ? null : o.dnt, maxTouchPoints: o.touch || 0 };
  if (o.globalPrivacyControl !== undefined) nav.globalPrivacyControl = o.globalPrivacyControl;
  if (o.beacon !== false) nav.sendBeacon = (url, body) => { sent.push({ via: 'beacon', url, body }); return true; };
  const timers = [];
  const ctx = { window: win, document: doc, navigator: nav, JSON, Math, Object, String, Number, Array, Promise, RegExp, Date: { now: () => clock.now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const bodies = () => sent.map(s => JSON.parse(s.via === 'fetch' ? s.init.body : s.body));
  return { win, doc, nav, sent, bodies, store, lazy, counts: win.PPP_COUNTS, clock, timers, runTimers: () => { const q = timers.splice(0); q.forEach(t => t.fn()); return q.length; } };
}

const err = (name, extra) => Object.assign({ error: { name: name, message: 'secret text of ' + name + ' at https://example.com/a.js:1:2' }, message: 'secret text', filename: 'https://example.com/a.js', lineno: 1 }, extra || {});

test('the script is one inline script of the head, before i18n.js and every other script of the page, and small', () => {
  const page = pageText();
  const head = page.slice(0, page.indexOf('</head>'));
  const at = head.indexOf('anonymous counters');
  assert.ok(at > 0, 'it is in the head');
  assert.ok(at < head.indexOf('<script src="./i18n.js">'), 'before i18n.js');
  assert.ok(at < head.indexOf('<script src="./lazy-load.js'), 'before the lazy loader: it is not one of its groups, so a release that breaks the boot is still counted');
  assert.ok(SRC.length < 12000, 'a head script of this size is under 12 KB raw (' + SRC.length + ')');
});

test('a thrown error is counted once, by class, and the beacon holds no text of it', () => {
  const p = rig();
  p.win.fire('error', err('TypeError'));
  p.doc.hide();
  assert.equal(p.sent.length, 1);
  const b = p.bodies()[0];
  assert.deepEqual(b.err, { type: 1 });
  const s = J(b);
  assert.ok(!/secret|example|a\.js|at https/.test(s), s);
  p.win.fire('pagehide');
  p.doc.hide();
  assert.equal(p.sent.length, 1, 'the same error is not sent again at pagehide or at the next hide');
});

test('classes: TypeError, ReferenceError, RangeError, SyntaxError, a script of this site that failed to load, one of another site, anything else', () => {
  const p = rig();
  p.win.fire('error', err('TypeError')); p.win.fire('error', err('TypeError'));
  p.win.fire('error', err('ReferenceError'));
  p.win.fire('error', err('RangeError'));
  p.win.fire('error', err('SyntaxError'));
  p.win.fire('error', err('Error')); p.win.fire('error', err('CustomThing')); p.win.fire('error', { message: 'Script error.', error: null });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: ORIGIN + '/scoregraph/index.js?h=abc' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'LINK', href: ORIGIN + '/x.css' } });
  p.doc.hide();
  assert.deepEqual(p.bodies()[0].err, { type: 2, reference: 1, range: 1, syntax: 1, other: 3, load: 2 });
});

test('a failure of another site\'s file is `thirdparty`, not `load` (Google Fonts blocked, a CDN down, a blocker): `load` stays "a file of this site did not load"', () => {
  const p = rig();
  p.win.fire('error', { target: { nodeType: 1, tagName: 'LINK', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: 'https://ppp.example.evil.com/x.js' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: ORIGIN + '/lessons.js' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT' } });
  p.doc.hide();
  assert.deepEqual(p.bodies()[0].err, { thirdparty: 4, load: 1 });
});

test('a picture that failed to load, a browser extension\'s error and a name that is a property of Object are not mistaken for the page\'s', () => {
  const p = rig();
  p.win.fire('error', { target: { nodeType: 1, tagName: 'IMG', src: ORIGIN + '/a.png' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'VIDEO' } });
  p.win.fire('error', Object.assign(err('TypeError'), { filename: 'chrome-extension://abcdef/content.js' }));
  p.win.fire('error', Object.assign(err('TypeError'), { filename: 'moz-extension://abcdef/content.js' }));
  p.win.fire('error', { error: { name: 'constructor' }, message: 'x' });
  p.win.fire('error', { error: { name: '__proto__' }, message: 'x' });
  p.win.fire('error', { error: { name: 'toString' }, message: 'x' });
  p.doc.hide();
  assert.deepEqual(p.bodies()[0].err, { other: 3 });
  assert.equal(({}).type, undefined);
});

test('the listener for failed resources is a capture listener (they do not bubble); rejections are counted', () => {
  const p = rig();
  assert.ok(p.win.captures('error').includes(true));
  p.win.fire('unhandledrejection', { reason: new Error('secret') });
  p.win.fire('unhandledrejection', {});
  p.doc.hide();
  const b = p.bodies()[0];
  assert.equal(b.rej, 2);
  assert.ok(!/secret/.test(J(b)));
});

test('a page that fails in a loop is one visit, not a flood: every count is capped', () => {
  const p = rig();
  for (let i = 0; i < 500; i++) { p.win.fire('error', err('TypeError')); p.win.fire('unhandledrejection', {}); }
  p.doc.hide();
  const b = p.bodies()[0];
  assert.equal(b.err.type, 20);
  assert.equal(b.rej, 20);
});

test('at most 5 beacons a page load, however often the page is hidden and shown with something new each time', () => {
  const p = rig();
  for (let i = 0; i < 12; i++) { p.win.fire('error', err('TypeError')); p.doc.hide(); p.doc.show(); }
  assert.equal(p.sent.length, 5);
  assert.equal(p.bodies()[0].pv, 1);
  p.win.fire('pagehide');
  assert.equal(p.sent.length, 5, 'and pagehide is not another');
  /* the count includes the beacons that were kept for the next visit */
  const q = rig({ cold: true });
  for (let i = 0; i < 12; i++) { q.win.fire('error', err('TypeError')); q.doc.hide(); q.doc.show(); }
  assert.equal(q.sent.length, 0);
  assert.ok(JSON.parse(q.store[PEND]).length <= 3, 'and at most three are kept');
});

test('the first beacon of a page says it is one (pv) with the timing in buckets; the second carries neither', () => {
  const p = rig({ fcp: 1500, now: 3100 });
  p.counts.ready();
  p.doc.hide();
  const a = p.bodies()[0];
  assert.deepEqual([a.v, a.pv, a.fcp, a.rdy, a.loc, a.mob, a.b], [1, 1, 0, 1, 'ko', 0, 'fab0ba3']);
  p.win.fire('error', err('TypeError'));
  p.doc.show(); p.doc.hide();
  const b = p.bodies()[1];
  assert.equal(b.pv, undefined);
  assert.equal(b.fcp, undefined);
  assert.equal(b.rdy, undefined);
  assert.deepEqual(b.err, { type: 1 });
});

test('buckets: under 2 s, under 4 s, under 8 s, 8 s and more, and "none" when it was not reached', () => {
  const at = (fcp, now, ready) => { const p = rig({ fcp: fcp, now: now }); if (ready !== false) p.counts.ready(); p.doc.hide(); return p.bodies()[0]; };
  assert.deepEqual([at(100, 1999).fcp, at(100, 1999).rdy], [0, 0]);
  assert.deepEqual([at(2000, 2000).fcp, at(2000, 2000).rdy], [1, 1]);
  assert.deepEqual([at(3999, 3999).fcp, at(3999, 3999).rdy], [1, 1]);
  assert.deepEqual([at(4000, 7999).fcp, at(4000, 7999).rdy], [2, 2]);
  assert.deepEqual([at(8000, 20000).fcp, at(8000, 20000).rdy], [3, 3]);
  const none = at(null, 500, false);
  assert.deepEqual([none.fcp, none.rdy], [4, 4]);
});

test('a visit with nothing to say sends its timing and nothing more, and only once', () => {
  const p = rig();
  p.counts.ready();
  p.doc.hide(); p.win.fire('pagehide'); p.doc.show(); p.doc.hide();
  assert.equal(p.sent.length, 1);
  assert.deepEqual(Object.keys(p.bodies()[0]).sort(), ['b', 'fcp', 'loc', 'mob', 'pv', 'rdy', 'v']);
});

test('locale and device class: ko ja zh en (anything else en); mobile by the browser\'s own words, an iPad that says Macintosh with touch', () => {
  const l = lang => { const p = rig({ lang: lang }); p.doc.hide(); return p.bodies()[0].loc; };
  assert.deepEqual(['ko-KR', 'ja-JP', 'zh-CN', 'en-US', 'fr-FR', ''].map(l), ['ko', 'ja', 'zh', 'en', 'en', 'en']);
  const m = ua => { const p = rig(ua); p.doc.hide(); return p.bodies()[0].mob; };
  assert.equal(m({}), 0);
  assert.equal(m({ ua: 'Mozilla/5.0 (Linux; Android 11; moto g) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36' }), 1);
  assert.equal(m({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148' }), 1);
  assert.equal(m({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605', touch: 5 }), 1);
  assert.equal(m({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605' }), 0);
});

test('it goes by fetch with keepalive, no credentials and no cache, to this site\'s /api/stats; sendBeacon only when fetch cannot keep alive', () => {
  const p = rig();
  p.doc.hide();
  const s = p.sent[0];
  assert.equal(s.via, 'fetch');
  assert.equal(s.url, '/api/stats');
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.keepalive, true);
  assert.equal(s.init.credentials, 'omit');
  assert.equal(s.init.cache, 'no-store');
  assert.equal(typeof s.init.body, 'string');
  assert.equal(s.init.headers, undefined, 'no header is added: a text/plain body is a simple request');
  const q = rig({ keepalive: false });
  q.doc.hide();
  assert.equal(q.sent[0].via, 'beacon');
  assert.equal(q.sent[0].url, '/api/stats');
  const r = rig({ fetch: false });
  r.doc.hide();
  assert.equal(r.sent[0].via, 'beacon');
});

test('a fetch that is refused or rejects is nobody\'s business', async () => {
  const p = rig({ fetchRejects: true });
  assert.doesNotThrow(() => p.doc.hide());
  await new Promise(r => setImmediate(r));
});

test('turned off: nothing is sent, however much happened; turned on again it is (the choice is the page\'s localStorage "ppp.counts.v1")', () => {
  const p = rig({ storage: { 'ppp.counts.v1': '0' } });
  p.counts.ready();
  p.win.fire('error', err('TypeError'));
  p.doc.hide(); p.win.fire('pagehide');
  assert.equal(p.sent.length, 0);
  assert.equal(p.counts.enabled(), false);
  assert.equal(p.counts.on(), false);
  p.counts.set(true);
  assert.equal(p.store['ppp.counts.v1'], undefined, 'on is the absence of the key');
  p.doc.show(); p.doc.hide();
  assert.equal(p.sent.length, 1);
  p.counts.set(false);
  assert.equal(p.store['ppp.counts.v1'], '0');
  p.win.fire('error', err('TypeError'));
  p.doc.show(); p.doc.hide();
  assert.equal(p.sent.length, 1, 'off again: nothing more');
});

test('Do Not Track and Global Privacy Control turn it off, whatever was chosen', () => {
  for (const o of [{ dnt: '1' }, { dnt: 'yes' }, { globalPrivacyControl: true }]) {
    const p = rig(o);
    p.win.fire('error', err('TypeError'));
    p.doc.hide(); p.win.fire('pagehide');
    assert.equal(p.sent.length, 0, J(o));
    assert.equal(p.counts.enabled(), false);
    assert.equal(p.counts.signal(), true);
    assert.equal(p.counts.on(), true, 'the person\'s own choice is separate from the browser\'s signal');
    assert.equal(p.store[PEND], undefined, 'and nothing is kept either');
  }
  for (const o of [{ dnt: '0' }, { dnt: 'unspecified' }, { globalPrivacyControl: false }, {}]) {
    const p = rig(o);
    p.doc.hide();
    assert.equal(p.sent.length, 1, J(o));
  }
});

test('a storage that cannot be read or written: on by default, and the choice holds for the visit', () => {
  const p = rig({ storageThrows: true });
  assert.equal(p.counts.on(), true);
  p.counts.set(false);
  assert.equal(p.counts.on(), false);
  p.doc.hide();
  assert.equal(p.sent.length, 0);
  const q = rig({ storage: null });
  q.doc.hide();
  assert.equal(q.sent.length, 1);
});

test('the engraver\'s and the practice plan\'s fallbacks and the lazy groups that failed are sent as what is new since the last beacon', () => {
  const eng = { fallbacks: { PLAN_THREW: 2, SOURCE_NONE: 1 } };
  const prc = { practiceFallback: { reasons: { NOT_READY: 3 } } };
  const p = rig({ globals: { PPPEngravePage: { stats: eng } }, practice: prc, groups: [{ name: 'score', failed: false }, { name: 'audio', failed: true }, { name: 'arranger', failed: true }] });
  p.doc.hide();
  const a = p.bodies()[0];
  assert.deepEqual(a.eng, { PLAN_THREW: 2, SOURCE_NONE: 1 });
  assert.deepEqual(a.prc, { NOT_READY: 3 });
  assert.equal(a.lz, 2);
  eng.fallbacks.PLAN_THREW = 5;
  prc.practiceFallback.reasons.NO_GRAPH = 1;
  p.doc.show(); p.doc.hide();
  const b = p.bodies()[1];
  assert.deepEqual(b.eng, { PLAN_THREW: 3 });
  assert.deepEqual(b.prc, { NO_GRAPH: 1 });
  assert.equal(b.lz, undefined);
  p.doc.show(); p.doc.hide();
  assert.equal(p.sent.length, 2, 'nothing new: nothing sent');
});

test('a code the server has no name for is counted as `other` here, so a body is never over 1 KB and never a 413', () => {
  const fb = { PLAN_THREW: 1 }, rs = { NOT_READY: 2 };
  for (let i = 0; i < 400; i++) { fb['SOMETHING_NEW_' + i] = 3; rs['NEW_REASON_WITH_A_LONG_NAME_' + i] = 2; }
  const p = rig({ globals: { PPPEngravePage: { stats: { fallbacks: fb } } }, practice: { practiceFallback: { reasons: rs } } });
  p.doc.hide();
  const raw = p.sent[0].init.body;
  assert.ok(Buffer.byteLength(raw) < 1024, Buffer.byteLength(raw) + ' bytes');
  const b = JSON.parse(raw);
  assert.deepEqual(b.eng, { PLAN_THREW: 1, other: 20 }, 'the sum, capped like every count');
  assert.deepEqual(b.prc, { NOT_READY: 2, other: 20 });
  assert.ok(!/SOMETHING_NEW|NEW_REASON/.test(raw));
});

test('a deferred global is read only through PPP_LAZY.peek (a plain read would load its group synchronously)', () => {
  const p = rig({ globals: { PPPEngravePage: { stats: { fallbacks: { PLAN_THREW: 1 } } } } });
  p.doc.hide();
  assert.ok(p.win.peeked.includes('PPPEngravePage'));
  assert.equal(p.win.directReads || 0, 0, 'window.PPPEngravePage was never read directly');
  assert.deepEqual(p.bodies()[0].eng, { PLAN_THREW: 1 });
});

test('the largest body there can be - every class, every code, every count at its cap - is under 1 KB', () => {
  const ENG = ['SOURCE_THREW', 'SOURCE_NONE', 'SOURCE_DISAGREES', 'LINK_FAILED', 'PLAN_THREW', 'LAYOUT_THREW', 'SYNC_THREW'];
  const PRC = ['NOT_LOADED', 'NO_ENGRAVER', 'EMPTY', 'RESOLVE_ERROR', 'NO_GRAPH', 'LINK_FAILED', 'MEASURES', 'IDENTITY', 'ABS_MISMATCH', 'BUILD_ERROR', 'NOT_READY'];
  const fb = { MYSTERY: 9999 }, rs = { MYSTERY: 9999 };
  ENG.forEach(k => { fb[k] = 9999; }); PRC.forEach(k => { rs[k] = 9999; });
  const groups = []; for (let i = 0; i < 40; i++) groups.push({ failed: true });
  const p = rig({ globals: { PPPEngravePage: { stats: { fallbacks: fb } } }, practice: { practiceFallback: { reasons: rs } }, groups, build: 'abcdef012345', lang: 'zh-CN', ua: 'Mobile Android' });
  p.counts.ready();
  ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'Error'].forEach(n => { for (let i = 0; i < 30; i++) p.win.fire('error', err(n)); });
  for (let i = 0; i < 30; i++) { p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: ORIGIN + '/a.js' } }); p.win.fire('error', { target: { nodeType: 1, tagName: 'LINK', href: 'https://x.example/a.css' } }); p.win.fire('unhandledrejection', {}); }
  p.doc.hide();
  const raw = p.sent[0].init.body;
  assert.ok(Buffer.byteLength(raw) < 1024, 'the biggest beacon is ' + Buffer.byteLength(raw) + ' bytes');
  const b = JSON.parse(raw);
  assert.equal(b.err.type, 20);
  assert.equal(b.err.thirdparty, 20);
  assert.equal(b.eng.PLAN_THREW, 20);
  assert.equal(b.eng.other, 20);
  assert.equal(b.lz, 20);
});

test('nothing throws with every API missing (no storage, no performance, no observer, no PPP_LAZY, no fetch, no beacon)', () => {
  const p = rig({ storage: null, perf: false, observer: false, lazy: false, fetch: false, beacon: false });
  assert.doesNotThrow(() => {
    p.win.fire('error', err('TypeError'));
    p.win.fire('error', undefined);
    p.win.fire('error', { target: null });
    p.win.fire('unhandledrejection', undefined);
    p.counts.ready();
    p.counts.set(false); p.counts.set(true);
    p.counts.flush();
    p.counts.sendPending();
    p.doc.hide(); p.win.fire('pagehide');
  });
  assert.equal(p.sent.length, 0);
});

test('PPP_COUNTS is the only global the script makes, and ready() keeps the first time', () => {
  const p = rig({ now: 1000 });
  assert.deepEqual(Object.keys(p.win).filter(k => !['peeked', 'addEventListener', 'fire', 'captures', 'store', 'localStorage', 'performance', 'PerformanceObserver', 'answered', 'fetch', 'Request', 'PPP_BUILD', 'PPP_LAZY', 'window', 'PPP', 'directReads', 'location'].includes(k)), ['PPP_COUNTS']);
  p.counts.ready();
  p.win.performance.now = () => 9000;
  p.counts.ready();
  p.doc.hide();
  assert.equal(p.bodies()[0].rdy, 0, 'the first time (1 s), not the last');
});

/* ------------------------------------------------------------------ the server must never be woken by a beacon */

test('COST: a page whose server last answered it more than ten minutes ago does not send: the counts wait in localStorage as numbers and fixed names', () => {
  const p = rig({ age: 25 * MIN });                     /* opened 25 minutes ago; the document came over the network at that time and nothing since */
  p.counts.ready();
  p.win.fire('error', err('TypeError'));
  p.doc.hide();
  assert.equal(p.sent.length, 0, 'no request: it would wake the instance');
  const kept = JSON.parse(p.store[PEND]);
  assert.equal(kept.length, 1);
  assert.equal(typeof kept[0].t, 'number');
  assert.deepEqual(JSON.parse(kept[0].b).err, { type: 1 });
  assert.equal(JSON.parse(kept[0].b).pv, 1, 'the visit itself is kept, with its timing');
  assert.ok(!/secret|example|a\.js/.test(p.store[PEND]));
  p.win.fire('pagehide');
  assert.equal(p.sent.length, 0);
});

test('COST: any same-origin answer from the network in the last ten minutes - a call of the app, a script, a sound - makes it safe to send; a cache hit or another site does not', () => {
  const sentWith = setup => { const p = rig({ age: 25 * MIN }); setup(p); p.doc.hide(); return p.sent.length; };
  assert.equal(sentWith(p => p.win.answered(ORIGIN + '/api/progress', 3 * MIN)), 1, 'an API call 3 minutes ago');
  assert.equal(sentWith(p => p.win.answered(ORIGIN + '/audio/piano/A0.mp3', 9 * MIN + 30000)), 1, 'a sound 9.5 minutes ago');
  assert.equal(sentWith(p => p.win.answered(ORIGIN + '/api/progress', 11 * MIN)), 0, 'but 11 minutes ago is the edge of the instance\'s sleep');
  assert.equal(sentWith(p => p.win.answered(ORIGIN + '/lessons.js', 1 * MIN, { transferSize: 0 })), 0, 'from the HTTP cache: the server was not asked');
  assert.equal(sentWith(p => p.win.answered('https://fonts.googleapis.com/css2?family=Noto+Sans+KR', 1 * MIN)), 0, 'another site\'s answer is not this server\'s');
  assert.equal(sentWith(p => p.win.answered('https://ppp.example.evil.com/x', 1 * MIN)), 0, 'nor is a host that merely starts with its name');
  assert.equal(sentWith(() => {}), 0, 'the page\'s own load, 25 minutes ago, is old');
});

test('COST: a fresh page (its own document just came) and one whose answers keep coming send as before', () => {
  const p = rig({ age: 40 * 1000 });
  p.doc.hide();
  assert.equal(p.sent.length, 1);
  assert.equal(p.store[PEND], undefined);
});

test('COST: a page with no timing API, and one the cache served, is taken to be cold: kept, never sent', () => {
  const a = rig({ perf: false });
  a.win.fire('error', err('TypeError')); a.doc.hide();
  assert.equal(a.sent.length, 0);
  const b = rig({ cold: true, observer: false });
  b.win.fire('error', err('TypeError')); b.doc.hide();
  assert.equal(b.sent.length, 0);
  assert.equal(JSON.parse(b.store[PEND]).length, 1);
});

test('COST: the kept counts go with the next visit, once it has proved the server awake (4 s after the app is ready), and are removed', () => {
  const body = J({ v: 1, b: 'fab0ba3', loc: 'ko', mob: 0, pv: 1, fcp: 1, rdy: 2, err: { type: 1 } });
  const body2 = J({ v: 1, b: 'fab0ba3', loc: 'en', mob: 1, pv: 1, fcp: 0, rdy: 0 });
  const t0 = 100 * 24 * 60 * MIN;
  const p = rig({ storage: { [PEND]: J([{ t: t0 - 3 * 60 * MIN, b: body }, { t: t0 - 60 * MIN, b: body2 }]) }, age: 5000 });
  assert.equal(p.sent.length, 0, 'not at load: the visit has its own business first');
  p.counts.ready();
  assert.equal(p.sent.length, 0);
  p.runTimers();
  assert.equal(p.sent.length, 2);
  assert.deepEqual(p.sent.map(s => s.init.body), [body, body2]);
  assert.ok(p.sent.every(s => s.url === '/api/stats' && s.init.credentials === 'omit'));
  assert.equal(p.store[PEND], undefined);
  p.runTimers();
  assert.equal(p.sent.length, 2, 'once');
});

test('COST: the kept counts are not sent while the page itself has not been answered (offline, or a cached page), and stay for a later visit', () => {
  const body = J({ v: 1, pv: 1 });
  const p = rig({ storage: { [PEND]: J([{ t: 100 * 24 * 60 * MIN - MIN, b: body }]) }, cold: true });
  p.counts.ready();
  p.runTimers();
  assert.equal(p.sent.length, 0);
  assert.ok(p.store[PEND], 'kept');
});

test('COST: kept counts older than seven days are dropped, at most three are read, an entry that is not one of ours is ignored', () => {
  const t0 = 100 * 24 * 60 * MIN, day = 24 * 60 * MIN;
  const good = n => J({ v: 1, pv: 1, fcp: n % 5 });
  const list = [{ t: t0 - 8 * day, b: good(0) }, { t: t0 - 6 * day, b: good(1) }, { t: t0 - 5 * day, b: good(2) }, { t: t0 - 4 * day, b: good(3) },
    { t: t0 - 3 * day, b: good(4) }, { t: 'x', b: good(1) }, { t: t0, b: 'y'.repeat(2000) }, { t: t0 + 10 * day, b: good(1) }, null, 5];
  const p = rig({ storage: { [PEND]: J(list) }, age: 5000 });
  p.counts.ready(); p.runTimers();
  assert.deepEqual(p.sent.map(s => JSON.parse(s.init.body).fcp), [1, 2, 3], 'the three newest valid ones, none of the eight days old');
  const q = rig({ storage: { [PEND]: 'not json' }, age: 5000 });
  q.counts.ready(); assert.doesNotThrow(() => q.runTimers());
  assert.equal(q.sent.length, 0);
});

test('COST: the kept counts follow the person\'s choice: turning the counters off drops them, and so does a turn-off found at the next visit, and Do Not Track keeps nothing out of it', () => {
  const body = J({ v: 1, pv: 1 });
  const p = rig({ storage: { [PEND]: J([{ t: 100 * 24 * 60 * MIN - MIN, b: body }]) } });
  p.counts.set(false);
  assert.equal(p.store[PEND], undefined, 'turned off: dropped at once');
  const q = rig({ storage: { 'ppp.counts.v1': '0', [PEND]: J([{ t: 100 * 24 * 60 * MIN - MIN, b: body }]) }, age: 5000 });
  q.counts.ready(); q.runTimers();
  assert.equal(q.sent.length, 0);
  assert.equal(q.store[PEND], undefined, 'dropped, not sent');
  const r = rig({ dnt: '1', storage: { [PEND]: J([{ t: 100 * 24 * 60 * MIN - MIN, b: body }]) }, age: 5000 });
  r.counts.ready(); r.runTimers();
  assert.equal(r.sent.length, 0);
});

test('COST: the kept counts hold the beacon bodies and nothing else (numbers and fixed names), and a page that is cold and has nothing new keeps nothing', () => {
  const p = rig({ age: 25 * MIN });
  p.counts.ready();
  p.doc.hide();                                              /* the visit's own timing: kept */
  p.doc.show(); p.doc.hide();                                /* nothing new: nothing more */
  assert.equal(JSON.parse(p.store[PEND]).length, 1);
  const allowed = new Set(['v', 'b', 'loc', 'mob', 'pv', 'fcp', 'rdy', 'err', 'rej', 'eng', 'prc', 'lz']);
  JSON.parse(p.store[PEND]).forEach(e => { assert.deepEqual(Object.keys(e).sort(), ['b', 't']); Object.keys(JSON.parse(e.b)).forEach(k => assert.ok(allowed.has(k), k)); });
});
