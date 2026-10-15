'use strict';
/* G13-4b2 (U7): Korean, Japanese and Chinese text is drawn in the device's own fonts; Google's Noto Sans is asked for only for a script the device cannot draw, one family a request, after the
   page has loaded and the browser is idle.

   Why: a web face of the same name shadows an installed font while it loads (the text went installed font -> the system's default -> the same font again: CLS 0.14 -> 0.34 on a PC that had Noto
   Sans KR, measured in G13-4), and a stylesheet of 331 KB was asked for by every visitor whatever their device had. Now the device's own fonts are the first choice in the font stack (the
   variable --ppp-cjk, by language), and the head script asks canvas whether the device can draw a short sample of each script (tests/load/cjk-detect.test.js runs that decision on a model).

   Browser test on this tree's own server (tests/load/lib.js) with puppeteer. The decision is tested on models of devices (canvas measureText is replaced, so the answer does not depend on this
   machine's fonts); the last two tests use this machine's own fonts and say what they found. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../load/lib');

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}

let srv, browser;
test.before(async () => {
  srv = await boot();
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

/* a device: which scripts it can draw (ko, ja, zh); `throws`: canvas is not there; `real`: leave canvas alone (this machine's own fonts) */
async function visit(device, locale, opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument((d, loc) => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', loc); } catch (e) { /* */ }
    if (d.real) return;
    const proto = CanvasRenderingContext2D.prototype;
    proto.measureText = function (text) {
      if (d.throws) throw new Error('no canvas');
      const c = String(text).codePointAt(0);
      let has;
      if (c === 0xd7fc) has = false;
      else if (c >= 0xac00 && c <= 0xd7a3) has = !!d.ko;
      else if (c >= 0x3040 && c <= 0x30ff) has = !!d.ja;
      else if (c === 0x6c49 || c === 0x7b80 || c === 0x4f53) has = !!d.zh;
      else if (c >= 0x4e00 && c <= 0x9fff) has = !!(d.ko || d.ja || d.zh);
      else has = true;
      if (!has) return { width: 32, actualBoundingBoxLeft: -2, actualBoundingBoxRight: 30, actualBoundingBoxAscent: 29, actualBoundingBoxDescent: 4 };
      return { width: 32, actualBoundingBoxLeft: -(c % 5), actualBoundingBoxRight: 25 + (c % 7), actualBoundingBoxAscent: 22 + (c % 6), actualBoundingBoxDescent: c % 4 };
    };
  }, device, locale);
  const requested = [], gstatic = [];
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/fonts\.googleapis\.com/.test(u)) { requested.push(u); return r.respond({ status: 200, contentType: 'text/css', body: '/* test */' }); }
    if (/fonts\.gstatic\.com/.test(u)) { gstatic.push(u); return r.abort(); }
    r.continue().catch(() => {});
  });
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  const settled = await page.evaluate(() => Promise.race([window.PPP_CJK_SETTLED.then(() => true), new Promise(r => setTimeout(() => r(false), 8000))]));
  await new Promise(r => setTimeout(r, opts.wait || 2500));         /* the other scripts come a second after the first has settled */
  const state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    body: getComputedStyle(document.body).fontFamily,
    cjk: getComputedStyle(document.documentElement).getPropertyValue('--ppp-cjk').split(',')[0].trim(),
    links: [...document.querySelectorAll('link[data-ppp-cjk]')].map(l => l.getAttribute('data-ppp-cjk'))
  }));
  let fonts = null;
  if (opts.fontsOf) {
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    await cdp.send('DOM.getDocument', { depth: -1 });
    const found = await cdp.send('DOM.performSearch', { query: '//*[text()[contains(., "' + opts.fontsOf + '")]]' });
    if (found.resultCount) {
      const nodes = await cdp.send('DOM.getSearchResults', { searchId: found.searchId, fromIndex: 0, toIndex: 1 });
      fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodes.nodeIds[0] })).fonts.map(f => f.familyName);
    }
  }
  await ctx.close();
  const fams = requested.map(u => new URL(u).searchParams.getAll('family').map(f => f.split(':')[0]).join('+'));
  return { fams, n: requested.length, settled, state, fonts, gstatic };
}

test('a device that can draw all three scripts asks for nothing and settles, and the page is in --ppp-cjk', async () => {
  const r = await visit({ ko: true, ja: true, zh: true }, 'ko-KR');
  assert.deepEqual(r.fams, []);
  assert.ok(r.settled);
  assert.equal(r.state.cjk, '"Malgun Gothic"');
  assert.match(r.state.body, /^Figtree, "Malgun Gothic", /);
  assert.deepEqual(r.state.links, []);
});

test('a device with none, a Korean page: Korean first, alone; Japanese and Chinese after it, one request each', async () => {
  const r = await visit({}, 'ko-KR');
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
  assert.ok(r.settled);
  assert.deepEqual(r.state.links, ['ko', 'ja', 'zh']);
});

test('a Japanese page: Japanese first, and --ppp-cjk puts the Japanese fonts first', async () => {
  const r = await visit({}, 'ja-JP');
  assert.deepEqual(r.fams, ['Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC']);
  assert.equal(r.state.cjk, '"Hiragino Sans"');
});

test('a Chinese page: Chinese first, and --ppp-cjk puts the Chinese fonts first', async () => {
  const r = await visit({}, 'zh-CN');
  assert.deepEqual(r.fams, ['Noto Sans SC', 'Noto Sans KR', 'Noto Sans JP']);
  assert.equal(r.state.cjk, '"PingFang SC"');
});

test('an English page on a device with none: the recordings are not held up, and the three come after', async () => {
  const r = await visit({}, 'en-US');
  assert.ok(r.settled);
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});

test('a device that has Korean and Chinese but not kana: Japanese only', async () => {
  const r = await visit({ ko: true, zh: true }, 'ko-KR');
  assert.deepEqual(r.fams, ['Noto Sans JP']);
});

test('no canvas: nothing is assumed to be there, as before', async () => {
  const r = await visit({ throws: true }, 'ko-KR');
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});

test('this machine\'s own fonts: a Windows or macOS PC draws all three and asks for nothing; Korean text is in the system\'s Korean font, not in a web font', async t => {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return t.skip('this machine is not Windows or macOS: its fonts are whatever it has');
  const r = await visit({ real: true }, 'ko-KR', { fontsOf: '연습' });
  assert.deepEqual(r.fams, [], 'no stylesheet of another site was asked for');
  assert.ok(r.settled);
  assert.ok(r.fonts && r.fonts.length, 'the text was drawn');
  assert.ok(!r.fonts.some(f => /^Noto Sans (KR|JP|SC)$/.test(f)) || r.fonts[0] !== 'Noto Sans KR', 'the first font of the Korean text is the system\'s own: ' + JSON.stringify(r.fonts));
  assert.ok(/Malgun Gothic|Apple SD Gothic Neo|Noto Sans CJK|Nanum/.test(r.fonts.join()), JSON.stringify(r.fonts));
});

test('the language of the page changes which fonts come first (Settings > language): the stack follows <html lang>', async () => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'ko-KR'); } catch (e) { /* */ } });
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  const first = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ppp-cjk').split(',')[0].trim());
  assert.equal(await first(), '"Malgun Gothic"');
  await page.evaluate(() => { document.documentElement.lang = 'ja-JP'; });
  assert.equal(await first(), '"Hiragino Sans"');
  await page.evaluate(() => { document.documentElement.lang = 'zh-CN'; });
  assert.equal(await first(), '"PingFang SC"');
  await ctx.close();
});
