'use strict';
/* G13-4b: the Korean/Japanese/Chinese stylesheet does not ask for a family the device already has.

   Why: a web face of the same name shadows the installed font while it loads, so a device that has Noto Sans KR went installed font -> the system's default -> the same font again, a layout
   shift of the whole page (CLS 0.14 -> 0.34 on such a PC, measured) and 100+ KB of stylesheet and slices for nothing. The head script asks canvas whether a family is there (it draws a sample
   differently from the generic fallbacks, the same under two of them, and has a real bold), and leaves the installed ones out of the request.

   Browser test on this tree's own server (tests/load/lib.js) with puppeteer. canvas measureText is replaced by a model of a device, so the answer does not depend on this machine's fonts. */
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

/* a device: which families it has, with a real bold or not; `throws`: canvas is not there */
async function families(device) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(d => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* */ }
    const proto = CanvasRenderingContext2D.prototype;
    proto.measureText = function (text) {
      if (d.throws) throw new Error('no canvas');
      const font = String(this.font);
      const fam = /"([^"]+)"/.exec(font);
      const name = fam ? fam[1] : null;
      const bold = /(^|\s)(700|bold)\s/.test(font);
      const latin = /^[\x20-\x7e]+$/.test(text);
      const generic = /serif$/.test(font) && !/sans-serif$/.test(font) ? 'serif' : 'monospace';
      let per;
      if (name && d.has[name] != null) per = (latin ? 10 : 20) * (latin && bold && d.has[name] ? 1.2 : 1);   // the installed family: the same under any fallback
      else per = generic === 'serif' ? 8 : 6;                                                                  // an unknown family is its fallback
      return { width: per * text.length };
    };
  }, device);
  const requested = [];
  let settled = false;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/fonts\.googleapis\.com/.test(u)) { requested.push(u); return r.respond({ status: 200, contentType: 'text/css', body: '/* test */' }); }
    if (/fonts\.gstatic\.com/.test(u)) return r.abort();
    r.continue().catch(() => {});
  });
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  settled = await page.evaluate(() => Promise.race([window.PPP_CJK_SETTLED.then(() => true), new Promise(r => setTimeout(() => r(false), 6000))]));
  await ctx.close();
  const fams = requested.length ? new URL(requested[0]).searchParams.getAll('family').map(f => f.split(':')[0]) : [];
  return { fams, n: requested.length, settled };
}

test('a device with none of the families asks for all three, as before', async () => {
  const r = await families({ has: {} });
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
  assert.equal(r.n, 1);
  assert.ok(r.settled);
});

test('Noto Sans KR installed with a real bold: only JP and SC are asked for', async () => {
  const r = await families({ has: { 'Noto Sans KR': true } });
  assert.deepEqual(r.fams, ['Noto Sans JP', 'Noto Sans SC']);
});

test('Noto Sans JP installed: KR and SC are asked for, in the same order', async () => {
  const r = await families({ has: { 'Noto Sans JP': true } });
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans SC']);
});

test('all three installed: nothing is asked for, and the recordings are not held up', async () => {
  const r = await families({ has: { 'Noto Sans KR': true, 'Noto Sans JP': true, 'Noto Sans SC': true } });
  assert.deepEqual(r.fams, []);
  assert.equal(r.n, 0);
  assert.ok(r.settled);
});

test('installed with a regular only (the bold would be faked): the web family is still asked for', async () => {
  const r = await families({ has: { 'Noto Sans KR': false } });   // the family draws the same under any fallback, but 700 is not wider than 400
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});

test('no canvas: nothing is assumed installed', async () => {
  const r = await families({ has: { 'Noto Sans KR': true }, throws: true });
  assert.deepEqual(r.fams, ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC']);
});
