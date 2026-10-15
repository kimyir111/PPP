'use strict';
/* G13-7b (U5): the page's anonymous counters, the inline head script PPP_COUNTS, run in a vm against a fake window (Node only; the browser half is tests/load-app/counters.test.js).

   What is proved: what counts as an error and in which class (never the message, the stack or the address); a thrown error is counted once; the timing buckets; one beacon a visit
   (a second only when something new happened); nothing is sent when a person turned it off, when the browser says Do Not Track or Global Privacy Control, or when there is nothing to say
   after the first; credentials are omitted; the body is under 1 KB even at every cap; a deferred global is never read directly (PPP_LAZY.peek); and nothing throws with every API missing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { script, pageText } = require('./head');

const SRC = script('anonymous counters');
const J = JSON.stringify;

/* a page: window, document and navigator as the script reads them */
function rig(o) {
  o = o || {};
  const sent = [], store = Object.assign({}, o.storage || {});
  const win = { listeners: {}, peeked: [] };
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
  if (o.perf !== false) win.performance = { now: () => (o.now === undefined ? 3100 : o.now), getEntriesByName: n => (n === 'first-contentful-paint' && o.fcp !== null ? [{ startTime: o.fcp === undefined ? 1500 : o.fcp }] : []) };
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
  const ctx = { window: win, document: doc, navigator: nav, JSON, Math, Object, String, Number, Array, Promise, RegExp };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const bodies = () => sent.map(s => JSON.parse(s.via === 'fetch' ? s.init.body : s.body));
  return { win, doc, nav, sent, bodies, store, lazy, counts: win.PPP_COUNTS };
}

const err = (name, extra) => Object.assign({ error: { name: name, message: 'secret text of ' + name + ' at https://example.com/a.js:1:2' }, message: 'secret text', filename: 'https://example.com/a.js', lineno: 1 }, extra || {});

test('the script is one inline script of the head, before i18n.js and every other script of the page, and small', () => {
  const page = pageText();
  const head = page.slice(0, page.indexOf('</head>'));
  const at = head.indexOf('anonymous counters');
  assert.ok(at > 0, 'it is in the head');
  assert.ok(at < head.indexOf('<script src="./i18n.js">'), 'before i18n.js');
  assert.ok(at < head.indexOf('<script src="./lazy-load.js'), 'before the lazy loader: it is not one of its groups, so a release that breaks the boot is still counted');
  assert.ok(SRC.length < 9000, 'a head script of this size is under 9 KB raw (' + SRC.length + ')');
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

test('classes: TypeError, ReferenceError, RangeError, SyntaxError, a script that failed to load, anything else', () => {
  const p = rig();
  p.win.fire('error', err('TypeError')); p.win.fire('error', err('TypeError'));
  p.win.fire('error', err('ReferenceError'));
  p.win.fire('error', err('RangeError'));
  p.win.fire('error', err('SyntaxError'));
  p.win.fire('error', err('Error')); p.win.fire('error', err('CustomThing')); p.win.fire('error', { message: 'Script error.', error: null });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT' } });
  p.win.fire('error', { target: { nodeType: 1, tagName: 'LINK' } });
  p.doc.hide();
  assert.deepEqual(p.bodies()[0].err, { type: 2, reference: 1, range: 1, syntax: 1, other: 3, load: 2 });
});

test('a picture that failed to load, a browser extension\'s error and a name that is a property of Object are not mistaken for the page\'s', () => {
  const p = rig();
  p.win.fire('error', { target: { nodeType: 1, tagName: 'IMG' } });
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
  const fb = {}, rs = {};
  ENG.forEach(k => { fb[k] = 9999; }); PRC.forEach(k => { rs[k] = 9999; });
  const groups = []; for (let i = 0; i < 40; i++) groups.push({ failed: true });
  const p = rig({ globals: { PPPEngravePage: { stats: { fallbacks: fb } } }, practice: { practiceFallback: { reasons: rs } }, groups, build: 'abcdef012345', lang: 'zh-CN', ua: 'Mobile Android' });
  p.counts.ready();
  ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'Error'].forEach(n => { for (let i = 0; i < 30; i++) p.win.fire('error', err(n)); });
  for (let i = 0; i < 30; i++) { p.win.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT' } }); p.win.fire('unhandledrejection', {}); }
  p.doc.hide();
  const raw = p.sent[0].init.body;
  assert.ok(Buffer.byteLength(raw) < 1024, 'the biggest beacon is ' + Buffer.byteLength(raw) + ' bytes');
  const b = JSON.parse(raw);
  assert.equal(b.err.type, 20);
  assert.equal(b.eng.PLAN_THREW, 20);
  assert.equal(b.lz, 20);
});

test('nothing throws with every API missing (no storage, no performance, no PPP_LAZY, no fetch, no beacon)', () => {
  const p = rig({ storage: null, perf: false, lazy: false, fetch: false, beacon: false });
  assert.doesNotThrow(() => {
    p.win.fire('error', err('TypeError'));
    p.win.fire('error', undefined);
    p.win.fire('error', { target: null });
    p.win.fire('unhandledrejection', undefined);
    p.counts.ready();
    p.counts.set(false); p.counts.set(true);
    p.counts.flush();
    p.doc.hide(); p.win.fire('pagehide');
  });
  assert.equal(p.sent.length, 0);
});

test('PPP_COUNTS is the only global the script makes, and ready() keeps the first time', () => {
  const p = rig({ now: 1000 });
  assert.deepEqual(Object.keys(p.win).filter(k => !['listeners', 'peeked', 'addEventListener', 'fire', 'captures', 'store', 'localStorage', 'performance', 'fetch', 'Request', 'PPP_BUILD', 'PPP_LAZY', 'window', 'PPP', 'directReads'].includes(k)), ['PPP_COUNTS']);
  p.counts.ready();
  p.win.performance.now = () => 9000;
  p.counts.ready();
  p.doc.hide();
  assert.equal(p.bodies()[0].rdy, 0, 'the first time (1 s), not the last');
});
