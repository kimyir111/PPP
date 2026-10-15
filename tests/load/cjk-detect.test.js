'use strict';
/* G13-4b2 (U7): Korean, Japanese and Chinese text is drawn in the device's own fonts; Google's Noto Sans is asked for only for a script the device cannot draw. This is the head script that
   decides it, run in a vm against a model of a device (Node only; the real browser is tests/load-app/cjk-fonts.test.js).

   The model: a canvas whose measureText gives every character a width - 32 for a character the device has a glyph for, 19 for the "no glyph" box - from which the script decides. A device
   is { ko, ja, zh } (which scripts it has a font for); the simplified-only characters of the Chinese sample need zh, a kana needs ja, a Hangul syllable needs ko, any other Han is drawn by any. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { script, pageText } = require('./head');

const SRC = script("Google's Noto Sans for a script only when the device has no font");
const settledAfter = async (p) => { let s = false; p.then(() => { s = true; }); for (let i = 0; i < 5; i++) await Promise.resolve(); return s; };

function device(d, o) {
  d = d || {}; o = o || {};
  const links = [], timers = [], idle = [];
  const doc = {
    readyState: o.readyState || 'complete',
    documentElement: { lang: o.lang === undefined ? 'ko-KR' : o.lang },
    head: { appendChild: l => { links.push(l); } },
    createElement: tag => {
      if (tag === 'canvas') return { getContext: () => { if (d.noCanvas) throw new Error('no canvas'); return ctx; } };
      const el = { tag, attrs: {}, setAttribute(k, v) { el.attrs[k] = v; } };
      return el;
    }
  };
  /* a canvas: a character the device has a glyph for measures as a glyph (width 32 or 29.44 and a box of its own); one it does not, as the "no glyph" box the browser draws for any such
     character - which on Windows is itself 32 wide, as wide as a kana (so the width alone says nothing) */
  const ctx = {
    font: '',
    measureText: text => {
      const c = String(text).codePointAt(0);
      let has;
      if (c === 0xd7fc) has = false;
      else if (c >= 0xac00 && c <= 0xd7a3) has = !!d.ko;
      else if (c >= 0x3040 && c <= 0x30ff) has = !!d.ja;
      else if (c === 0x6c49 || c === 0x7b80 || c === 0x4f53) has = !!d.zh;
      else if (c >= 0x4e00 && c <= 0x9fff) has = !!(d.ko || d.ja || d.zh);
      else has = true;
      if (!has) return { width: 32, actualBoundingBoxLeft: -2, actualBoundingBoxRight: 30, actualBoundingBoxAscent: 29, actualBoundingBoxDescent: 4 };
      return { width: d.narrow ? 29.44 : 32, actualBoundingBoxLeft: -(c % 5), actualBoundingBoxRight: 25 + (c % 7), actualBoundingBoxAscent: 22 + (c % 6), actualBoundingBoxDescent: c % 4 };
    }
  };
  const observers = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'load') win.onload = fn; },
    requestIdleCallback: o.noIdle ? undefined : (cb) => { idle.push(cb); }
  };
  const sandbox = {
    window: win, document: doc, Object, String, Promise,
    navigator: { connection: o.saveData ? { saveData: true } : undefined },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    MutationObserver: function (cb) { this.cb = cb; this.observe = (el, opts) => { this.opts = opts; observers.push(this); }; }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const urlsOf = () => links.map(l => l.href);
  const runIdle = () => { const q = idle.splice(0); q.forEach(f => f()); };
  /* the stylesheet of a link answers (or fails), then the timers that are due within ms run */
  const answer = (i, how) => { (how === 'error' ? links[i].onerror : links[i].onload)(); };
  const tick = ms => { const due = timers.filter(t => t.ms <= ms); due.forEach(t => timers.splice(timers.indexOf(t), 1)); due.forEach(t => t.fn()); return due.length; };
  return { win, doc, links, urlsOf, runIdle, answer, tick, idle, timers, observers, settled: () => settledAfter(win.PPP_CJK_SETTLED), setLang: l => { doc.documentElement.lang = l; observers.forEach(o => o.cb([])); } };
}
const family = u => new URL(u).searchParams.get('family').split(':')[0];

test('a device that can draw all three scripts asks for nothing, and settles at once', async () => {
  const p = device({ ko: true, ja: true, zh: true });
  assert.equal(p.links.length, 0, 'nothing before idle');
  assert.equal(await p.settled(), false, 'not before the idle moment');
  p.runIdle();
  assert.equal(p.links.length, 0);
  assert.equal(await p.settled(), true);
  p.tick(60000);
  assert.equal(p.links.length, 0, 'and nothing later');
});

test('a device that can draw none: the page\'s language first (alone), the others a second after it has settled', async () => {
  const p = device({}, { lang: 'ja-JP' });
  p.runIdle();
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans JP']);
  assert.equal(p.links[0].rel, 'stylesheet');
  assert.equal(p.links[0].attrs['data-ppp-cjk'], 'ja');
  assert.equal(await p.settled(), false, 'not until it has arrived');
  p.answer(0);
  p.tick(600);
  assert.equal(await p.settled(), true);
  assert.equal(p.links.length, 1, 'the others wait');
  p.tick(1000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC']);
  for (const u of p.urlsOf()) {
    const x = new URL(u);
    assert.equal(x.origin + x.pathname, 'https://fonts.googleapis.com/css2');
    assert.equal(x.searchParams.getAll('family').length, 1, 'one family a request');
    assert.equal(x.searchParams.get('family').split(':')[1], 'wght@400;500;600;700');
    assert.equal(x.searchParams.get('display'), 'swap');
  }
});

test('a stylesheet that fails settles too, and the others are still asked for', async () => {
  const p = device({}, { lang: 'ko-KR' });
  p.runIdle();
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans KR']);
  p.answer(0, 'error');
  p.tick(600);
  assert.equal(await p.settled(), true);
  p.tick(1000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});

test('Chinese: its family first', () => {
  const p = device({}, { lang: 'zh-CN' });
  p.runIdle();
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans SC']);
});

test('English: the page has no script of its own, so nothing is asked for before the settle, then all three that are lacking, in the order ko ja zh', async () => {
  const p = device({}, { lang: 'en-US' });
  p.runIdle();
  assert.equal(p.links.length, 0);
  assert.equal(await p.settled(), true, 'the recordings are not held up for a title in another language');
  p.tick(1000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});

test('only the scripts that are lacking: a Korean-only device in a Korean page asks for Japanese and Chinese a moment later, not for Korean', async () => {
  const p = device({ ko: true }, { lang: 'ko-KR' });
  p.runIdle();
  assert.equal(p.links.length, 0);
  assert.equal(await p.settled(), true);
  p.tick(1000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans JP', 'Noto Sans SC']);
});

test('a device that has Chinese and Korean but not kana asks for Japanese only', async () => {
  const p = device({ ko: true, zh: true }, { lang: 'zh-CN' });
  p.runIdle();
  p.tick(1000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans JP']);
});

test('a data saver gets the page\'s own language and no more', async () => {
  const p = device({}, { lang: 'ko-KR', saveData: true });
  p.runIdle();
  p.answer(0);
  p.tick(600);
  p.tick(60000);
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans KR']);
  assert.equal(await p.settled(), true);
});

test('no canvas, or a canvas that throws: the device is taken to have no font (the web font, as it always was)', async () => {
  const p = device({ noCanvas: true }, { lang: 'ko-KR' });
  p.runIdle();
  assert.deepEqual(p.urlsOf().map(family), ['Noto Sans KR']);
});

test('a language change in Settings asks for that script if the device lacks it and it was not asked for yet', async () => {
  const none = device({ ko: true, ja: true, zh: true }, { lang: 'ko-KR' });
  none.runIdle();
  assert.equal(none.links.length, 0);
  assert.ok(none.observers.length === 1 && JSON.stringify(none.observers[0].opts) === JSON.stringify({ attributes: true, attributeFilter: ['lang'] }));
  none.setLang('zh-CN');
  assert.equal(none.links.length, 0, 'the device has it: nothing');
  /* a data saver lacking Chinese: not asked for with the page in Korean, asked for once the person chooses Chinese (and once) */
  const q = device({ ko: true, ja: true }, { lang: 'ko-KR', saveData: true });
  q.runIdle();
  q.tick(60000);
  assert.equal(q.links.length, 0);
  q.setLang('zh-CN');
  assert.deepEqual(q.urlsOf().map(family), ['Noto Sans SC']);
  q.setLang('zh-CN');
  assert.equal(q.links.length, 1, 'not twice');
  q.setLang('en-US');
  assert.equal(q.links.length, 1, 'English has no script of its own');
});

test('before the window has loaded it waits for it, and with no idle callback it uses a timer', async () => {
  const p = device({}, { readyState: 'loading', lang: 'ko-KR' });
  assert.equal(p.idle.length, 0);
  assert.equal(typeof p.win.onload, 'function');
  p.win.onload();
  assert.equal(p.idle.length, 1);
  const q = device({}, { noIdle: true, lang: 'ko-KR' });
  assert.equal(q.timers.length, 1);
  assert.equal(q.timers[0].ms, 1500);
  q.tick(1500);
  assert.deepEqual(q.urlsOf().map(family), ['Noto Sans KR']);
});

test('the script holds no stylesheet link of another site as a tag, makes no preconnect, and does not touch an installed font (no @font-face of its own)', () => {
  assert.ok(!/preconnect|dns-prefetch|@font-face|document\.write/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));
  const page = pageText();
  const head = page.slice(0, page.indexOf('</head>'));
  assert.ok(!/<link[^>]+fonts\.(googleapis|gstatic)\.com/.test(page), 'no <link> to Google Fonts anywhere in the page');
  assert.ok(!/preconnect|dns-prefetch/.test(head + page.slice(page.indexOf('<helmet>'), page.indexOf('</helmet>'))), 'no connection hint to another site');
});
