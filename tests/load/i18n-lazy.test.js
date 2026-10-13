'use strict';
/* G13-4a: i18n.js fetches only the catalog of the language in use; the others come when the language is switched (docs/GOALS/G13_PRODUCTIZATION.md E2, G13-4).

   Node only: i18n.js runs in a vm context with a stand-in for what it asks of the browser (document, localStorage, navigator, fetch), so every
   request it makes is counted and every answer is released by the test, in the order the test chooses (a slow network, a switch while one is on its way).
   The browser side (the page still translates; the cached coach text is rebuilt when a catalog arrives late) is tests/i18n-and-auth.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(require('./lib').REPO, 'i18n.js'), 'utf8');
const CATALOG = {
  'ko-KR': { Home: '홈', 'Hello {{n}}': '안녕 {{n}}' },
  'ja-JP': { Home: 'ホーム' },
  'zh-CN': { Home: '首页' }
};

/* a page for i18n.js. `saved` is the language in localStorage, `languages` the browser's; fetch answers are held until `release(locale)` / `fail(locale)`. */
function page(opts) {
  opts = opts || {};
  const asked = [];
  const timers = [];
  const inits = [];
  const held = {};
  const storage = {};
  if (opts.saved) storage['ppp-locale'] = opts.saved;
  const doc = {
    cookie: '',
    documentElement: { dataset: {}, classList: { add() {} }, setAttribute() {}, lang: '' },
    getElementsByTagName: () => [{ src: opts.scriptSrc || 'http://localhost/i18n.js?v=1' }]
  };
  const win = {};
  const ctx = {
    window: win,
    document: doc,
    location: { protocol: 'http:' },
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    navigator: { languages: opts.languages || ['en-US'], language: (opts.languages || ['en-US'])[0] },
    Promise, Intl, JSON, Object, String, Array, RegExp, Math, console,
    NodeFilter: { SHOW_TEXT: 4 },
    fetch(url, init) {
      const m = /i18n\/([A-Za-z-]+)\.json/.exec(url);
      const loc = m ? m[1] : '?';
      asked.push(String(url));
      inits.push(init);
      return new Promise((resolve, reject) => { (held[loc] = held[loc] || []).push({ resolve, reject }); });
    }
  };
  if (opts.hashes) ctx.PPP_HASHES = opts.hashes;
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };   /* the retries wait for the test, not for the clock */
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'i18n.js' });
  const I = ctx.PPP_I18N;
  const answer = (loc, how) => { const q = held[loc] || []; held[loc] = []; q.forEach(h => (how === 'fail' ? h.reject(new Error('offline')) : h.resolve({ ok: how !== 'http404' && how !== 'http503', status: how === 'http503' ? 503 : how === 'http404' ? 404 : 200, json: async () => ({ content: CATALOG[loc] || {} }) }))); };
  return {
    I, asked, inits, timers, storage, doc,
    runTimers: async () => { const t = timers.splice(0); t.forEach(x => x.fn()); await new Promise(r => setImmediate(r)); },
    http503: loc => { answer(loc, 'http503'); return new Promise(r => setImmediate(r)); },
    release: loc => { answer(loc); return new Promise(r => setImmediate(r)); },
    fail: loc => { answer(loc, 'fail'); return new Promise(r => setImmediate(r)); },
    http404: loc => { answer(loc, 'http404'); return new Promise(r => setImmediate(r)); },
    locales: () => asked.map(u => /i18n\/([A-Za-z-]+)\.json/.exec(u)[1])
  };
}
const tick = () => new Promise(r => setImmediate(r));

test('English (the default) needs no catalog: nothing is fetched, ready is already done', async () => {
  const p = page();
  assert.equal(p.I.getLocale(), 'en-US');
  await p.I.ready;
  assert.deepEqual(p.asked, []);
  assert.equal(p.I.tx('Home'), 'Home');
});

test('a Korean visitor fetches ko-KR.json and nothing else; ready waits for it', async () => {
  const p = page({ saved: 'ko-KR' });
  let done = false;
  p.I.ready.then(() => { done = true; });
  await tick();
  assert.deepEqual(p.locales(), ['ko-KR'], 'one request, for the language in use');
  assert.equal(done, false, 'ready is not done before the catalog is');
  assert.equal(p.I.tx('Home'), 'Home', 'English until it arrives');
  await p.release('ko-KR');
  await p.I.ready;
  assert.equal(done, true);
  assert.equal(p.I.tx('Home'), '홈');
  assert.equal(p.I.tx('Hello {{n}}', { n: 3 }), '안녕 3');
  assert.deepEqual(p.locales(), ['ko-KR'], 'still one request');
});

test('the browser language picks the catalog when nothing is saved', async () => {
  const p = page({ languages: ['ja-JP', 'en-US'] });
  await tick();
  assert.deepEqual(p.locales(), ['ja-JP']);
  const z = page({ languages: ['zh-CN'] });
  await tick();
  assert.deepEqual(z.locales(), ['zh-CN']);
});

test('the catalog url keeps the script\'s ?v= when the server has not named a hash', async () => {
  const p = page({ saved: 'ko-KR', scriptSrc: 'http://localhost/i18n.js?v=7' });
  assert.match(p.asked[0], /\/i18n\/ko-KR\.json\?v=7$/);
  assert.equal(p.inits[0].cache, 'no-store', 'a url that does not name the content is never taken from the cache');
});

test('G13-4c: with window.PPP_HASHES the catalog is asked for by its own content hash, and may come from the browser cache', async () => {
  const hashes = { 'i18n/ko-KR.json': 'aaaaaaaaaaaa', 'i18n/ja-JP.json': 'bbbbbbbbbbbb', 'i18n/zh-CN.json': 'cccccccccccc', 'i18n/en-US.json': 'dddddddddddd' };
  /* the script tag carries the hash of i18n.js itself: it must not be taken for the catalog's */
  const p = page({ saved: 'ko-KR', hashes, scriptSrc: 'http://localhost/i18n.js?h=0123456789ab' });
  assert.match(p.asked[0], /^http:\/\/localhost\/i18n\/ko-KR\.json\?h=aaaaaaaaaaaa$/);
  assert.equal(p.inits[0], undefined, 'no cache: no-store, so the immutable answer is used');
  p.I.setLocale('ja-JP');
  assert.match(p.asked[1], /\/i18n\/ja-JP\.json\?h=bbbbbbbbbbbb$/);
  /* a hash for one catalog only: the others are asked for as before */
  const q = page({ saved: 'ja-JP', hashes: { 'i18n/ko-KR.json': 'aaaaaaaaaaaa' }, scriptSrc: 'http://localhost/i18n.js?h=0123456789ab' });
  assert.match(q.asked[0], /\/i18n\/ja-JP\.json$/, 'the script\'s own ?h= is dropped, not passed on');
  assert.equal(q.inits[0].cache, 'no-store');
});

test('G13-4c: a script tag with no query at all', async () => {
  const p = page({ saved: 'zh-CN', hashes: { 'i18n/zh-CN.json': 'eeeeeeeeeeee' }, scriptSrc: 'http://localhost/Piano/i18n.js' });
  assert.match(p.asked[0], /^http:\/\/localhost\/Piano\/i18n\/zh-CN\.json\?h=eeeeeeeeeeee$/);
});

test('switching to a language fetches only that catalog, and tells the listeners when it is in', async () => {
  const p = page();
  const heard = [];
  p.I.onChange(l => heard.push(l + ':' + p.I.tx('Home')));
  assert.equal(p.I.setLocale('ja-JP'), 'ja-JP');
  assert.equal(p.I.getLocale(), 'ja-JP', 'the language is the new one at once');
  assert.equal(p.doc.documentElement.dataset.locale, 'ja-JP');
  assert.equal(p.storage['ppp-locale'], 'ja-JP');
  await tick();
  assert.deepEqual(p.locales(), ['ja-JP']);
  assert.deepEqual(heard, [], 'the listeners wait for the catalog: they would translate nothing');
  await p.release('ja-JP');
  assert.deepEqual(heard, ['ja-JP:ホーム'], 'told once, with the catalog in');
  await p.I.ready;
});

test('switching to a language the page already has fetches nothing and tells the listeners at once', async () => {
  const p = page({ saved: 'ko-KR' });
  await p.release('ko-KR');
  const heard = [];
  p.I.onChange(l => heard.push(l));
  p.I.setLocale('en-US');
  assert.deepEqual(heard, ['en-US'], 'English: synchronously, as before');
  p.I.setLocale('ko-KR');
  assert.deepEqual(heard, ['en-US', 'ko-KR'], 'Korean again: from memory');
  assert.deepEqual(p.locales(), ['ko-KR'], 'no second request');
});

test('a switch that is overtaken by another is not announced; only the last one is', async () => {
  const p = page();
  const heard = [];
  p.I.onChange(l => heard.push(l));
  p.I.setLocale('ko-KR');
  p.I.setLocale('ja-JP');
  p.I.setLocale('ko-KR');
  await tick();
  assert.deepEqual(p.locales().sort(), ['ja-JP', 'ko-KR'], 'ko-KR is asked for once although it was chosen twice');
  await p.release('ja-JP');
  assert.deepEqual(heard, [], 'ja-JP arrived but is no longer the language');
  await p.release('ko-KR');
  assert.deepEqual(heard, ['ko-KR'], 'one announcement, for the language in use');
  assert.equal(p.I.tx('Home'), '홈');
});

test('a catalog that cannot be fetched leaves English, ready still ends, and the next switch asks again', async () => {
  const p = page({ saved: 'zh-CN' });
  await p.fail('zh-CN');
  await p.I.ready;
  assert.equal(p.I.tx('Home'), 'Home');
  p.I.setLocale('en-US');
  p.I.setLocale('zh-CN');
  await tick();
  assert.deepEqual(p.locales(), ['zh-CN', 'zh-CN'], 'asked again');
  await p.release('zh-CN');
  assert.equal(p.I.tx('Home'), '首页');
});

test('an answer that is not 2xx (503 while the server restarts) is not a catalog: English for now, asked again 2 s and 6 s later, translated when it comes', async () => {
  const p = page({ saved: 'ko-KR' });
  const heard = [];
  p.I.onChange(l => heard.push(l + ':' + p.I.tx('Home')));
  await p.http503('ko-KR');
  await p.I.ready;
  assert.equal(p.I.tx('Home'), 'Home', 'English: a 503 is not a catalog');
  assert.deepEqual(p.timers.map(t => t.ms), [2000], 'one retry is waiting, 2 s');
  await p.runTimers();
  assert.deepEqual(p.locales(), ['ko-KR', 'ko-KR'], 'asked again');
  await p.release('ko-KR');
  assert.equal(p.I.tx('Home'), '홈', 'translated without a reload');
  assert.deepEqual(heard, ['ko-KR:홈'], 'and told to the listeners once, so the page is translated');
  assert.deepEqual(p.timers, [], 'nothing left to retry');
});

test('the retries are bounded: three asks in all, then it waits for the next switch to that language', async () => {
  const p = page({ saved: 'ja-JP' });
  await p.http503('ja-JP');
  assert.deepEqual(p.timers.map(t => t.ms), [2000]);
  await p.runTimers();
  await p.http503('ja-JP');
  assert.deepEqual(p.timers.map(t => t.ms), [6000], 'the second wait is longer');
  await p.runTimers();
  await p.http503('ja-JP');
  assert.deepEqual(p.timers, [], 'no fourth try');
  assert.deepEqual(p.locales(), ['ja-JP', 'ja-JP', 'ja-JP']);
  assert.equal(p.I.tx('Home'), 'Home');
  /* a person who switches away and back asks again */
  p.I.setLocale('en-US');
  p.I.setLocale('ja-JP');
  await tick();
  assert.equal(p.locales().length, 4);
  await p.release('ja-JP');
  assert.equal(p.I.tx('Home'), 'ホーム');
});

test('a 404 is not a catalog either (same retries), and a network error is the same as a 503', async () => {
  const p = page({ saved: 'zh-CN' });
  await p.http404('zh-CN');
  assert.deepEqual(p.timers.map(t => t.ms), [2000]);
  await p.runTimers();
  await p.fail('zh-CN');
  assert.deepEqual(p.timers.map(t => t.ms), [6000]);
  await p.runTimers();
  await p.release('zh-CN');
  assert.equal(p.I.tx('Home'), '首页');
});

test('a catalog that comes after the person switched to another language is kept, not announced', async () => {
  const p = page({ saved: 'ko-KR' });
  const heard = [];
  p.I.onChange(l => heard.push(l));
  await p.http503('ko-KR');
  p.I.setLocale('en-US');
  assert.deepEqual(heard, ['en-US']);
  await p.runTimers();
  await p.release('ko-KR');
  assert.deepEqual(heard, ['en-US'], 'Korean arrived, but the page is English: nobody is told');
  p.I.setLocale('ko-KR');
  assert.equal(p.locales().length, 2, 'switching back asks for nothing more');
  assert.equal(p.I.tx('Home'), '홈');
});

test('ready follows the language in use: after a switch it is the new catalog\'s promise', async () => {
  const p = page();
  const first = p.I.ready;
  await first;
  p.I.setLocale('ko-KR');
  assert.notEqual(p.I.ready, first);
  let done = false;
  p.I.ready.then(() => { done = true; });
  await tick();
  assert.equal(done, false);
  await p.release('ko-KR');
  await p.I.ready;
  assert.equal(done, true);
});

test('setAutomaticLocale goes through the same wait', async () => {
  const p = page({ saved: 'en-US', languages: ['ko-KR'] });
  const heard = [];
  p.I.onChange(l => heard.push(l));
  p.I.setAutomaticLocale();
  assert.equal(p.I.getLocale(), 'ko-KR');
  assert.deepEqual(heard, []);
  await p.release('ko-KR');
  assert.deepEqual(heard, ['ko-KR']);
});

test('PPP_I18N.load(locale) is the way to have a catalog without switching (the live walk, a test)', async () => {
  const p = page();
  const w = p.I.load('ja-JP');
  await tick();
  assert.deepEqual(p.locales(), ['ja-JP']);
  assert.equal(p.I.getLocale(), 'en-US', 'the language is not changed');
  await p.release('ja-JP');
  await w;
  p.I.setLocale('ja-JP');
  assert.equal(p.I.tx('Home'), 'ホーム', 'switching afterwards is instant');
  assert.deepEqual(p.locales(), ['ja-JP']);
});
