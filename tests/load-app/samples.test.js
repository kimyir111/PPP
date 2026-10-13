'use strict';
/* G13-4d: the piano recordings start loading after the page has been drawn, and a note played before they are in still sounds.
   (docs/GOALS/G13_PRODUCTIZATION.md G13-4 (d)).

   Browser test: it starts this tree's server.js on a free port (tests/load/lib.js) and drives it with puppeteer, so it needs no other server and no
   port 8777. The two things that could change what a person hears are:
     - the recordings (audio/piano/*.mp3, 1.3 MB) are asked for only after the window's load event, the first paint and Google's CJK stylesheet (or its
       failure), and all of them are asked for in the end - also when Google is unreachable or never answers;
     - a note struck at once, with no recording in, is the synthesized stand-in (oscillators) and sounds; when the recordings are in, the same note is a
       recording (a buffer source). A tap or key starts the load at once, as before.
   Google Fonts is answered by the test itself (a stylesheet it controls), so the result does not depend on the network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../load/lib');

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let srv, browser;
test.before(async () => {
  srv = await boot();
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

/* opens the page; `google` decides what Google's stylesheet does: 'css' (answers after googleDelay ms), 'abort', 'hang'; `mp3` 'pass' or 'hold' (released by held.release()) */
async function open(opts) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  /* a device with none of the Noto families (this PC may have some: the head script then leaves them out of the request) */
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* */ }
    CanvasRenderingContext2D.prototype.measureText = function (t) { return { width: (/serif$/.test(this.font) && !/sans-serif$/.test(this.font) ? 8 : 6) * String(t).length }; };
  });
  const log = { mp3: [], google: null, googleDone: null, load: null };
  const held = [];
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/fonts\.googleapis\.com/.test(u)) {
      log.google = Date.now();
      if (opts.google === 'abort') { r.abort('internetdisconnected'); log.googleDone = Date.now(); return; }
      if (opts.google === 'hang') return;                       // never answered: only the page's own timeout ends the wait
      setTimeout(() => { r.respond({ status: 200, contentType: 'text/css', body: '/* test stylesheet */' }).catch(() => {}); log.googleDone = Date.now(); }, opts.googleDelay || 0);
      return;
    }
    if (/fonts\.gstatic\.com/.test(u)) { r.abort(); return; }
    if (/\/audio\/piano\/[\w-]+\.mp3/.test(u)) {
      log.mp3.push({ t: Date.now(), url: u });
      if (opts.mp3 === 'hold') { held.push(r); return; }
    }
    r.continue().catch(() => {});
  });
  page.on('load', () => { log.load = Date.now(); });
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  return { ctx, page, log, held, release: () => { const hs = held.splice(0); hs.forEach(r => r.continue().catch(() => {})); return hs.length; } };
}
const fcpOf = page => page.evaluate(() => { const e = performance.getEntriesByName('first-contentful-paint')[0]; return e ? performance.timeOrigin + e.startTime : null; });

test('the recordings wait for load, first paint and the CJK stylesheet, then all 30 are asked for', async () => {
  const p = await open({ google: 'css', googleDelay: 1500 });
  try {
    await p.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 30000 });
    const fcp = await fcpOf(p.page);
    assert.equal(p.log.mp3.length, 30, 'every recording is asked for');
    const first = Math.min(...p.log.mp3.map(m => m.t));
    assert.ok(p.log.load != null && first >= p.log.load, 'not before the window load event');
    assert.ok(fcp != null && first >= fcp, 'not before the first contentful paint');
    assert.ok(p.log.google != null, 'the CJK stylesheet was asked for');
    assert.ok(p.log.googleDone != null && first >= p.log.googleDone, 'not before the CJK stylesheet had arrived (' + (first - p.log.googleDone) + ' ms after)');
    assert.ok(p.log.google >= p.log.load, 'the stylesheet itself is asked for after load');
  } finally { await p.ctx.close(); }
});

test('Google unreachable: the recordings still load, right after the failure', async () => {
  const p = await open({ google: 'abort' });
  try {
    await p.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 30000 });
    const first = Math.min(...p.log.mp3.map(m => m.t));
    assert.ok(first >= p.log.googleDone, 'after the stylesheet failed');
    assert.ok(first - p.log.googleDone < 5000, 'and soon after (' + (first - p.log.googleDone) + ' ms)');
  } finally { await p.ctx.close(); }
});

test('Google never answers: the recordings load anyway, within the page\'s own wait', async () => {
  const p = await open({ google: 'hang' });
  try {
    await p.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 30000 });
    assert.equal(p.log.mp3.length, 30);
    const first = Math.min(...p.log.mp3.map(m => m.t));
    assert.ok(first - p.log.load < 14000, 'within 14 s of load (' + (first - p.log.load) + ' ms)');
  } finally { await p.ctx.close(); }
});

test('a note struck at once, before any recording is in, is the synthesized stand-in and sounds; later the same note is a recording', async () => {
  const p = await open({ google: 'hang', mp3: 'hold' });
  try {
    /* a tap is the gesture that unlocks sound; it also starts the recordings (held here), as it always did */
    await p.page.mouse.click(550, 400);
    const first = await p.page.evaluate(async () => {
      const A = window.PPP.app, pl = A.piano();
      pl.wake();
      for (let i = 0; i < 40 && !(pl.ac && pl.ac.state === 'running'); i++) await new Promise(r => setTimeout(r, 50));
      const v = pl.strike(60, null, 90);
      return { state: pl.ac && pl.ac.state, loaded: window.PPP.PianoSamples.count(), kinds: v ? v.srcs.map(s => s.constructor.name) : null, end: v ? v.end - v.t : null };
    });
    assert.equal(first.state, 'running', 'sound is unlocked by the gesture');
    assert.equal(first.loaded, 0, 'no recording is in yet');
    assert.ok(first.kinds && first.kinds.length >= 1 && first.kinds.every(k => k === 'OscillatorNode'), 'the stand-in sounds: ' + JSON.stringify(first.kinds));
    assert.ok(first.end > 0.3, 'and lasts (' + first.end + ' s)');
    /* the tap asks for all thirty in one burst; this process learns of them as the page's other requests (the page's own code, G13-4e) are answered beside them, so it is given a moment to count - the mutant
       D4 (no load on a tap) is still caught: with it nothing is asked for before the 7 s the held stylesheet is waited for */
    for (let i = 0; i < 100 && p.log.mp3.length < 30; i++) await sleep(50);
    assert.ok(p.log.mp3.length >= 30, 'the tap asked for the recordings at once (' + p.log.mp3.length + ')');
    p.release();
    await p.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 30000 });
    const later = await p.page.evaluate(() => {
      const v = window.PPP.app.piano().strike(60, null, 90);
      return { kinds: v.srcs.map(s => s.constructor.name), loaded: window.PPP.PianoSamples.count() };
    });
    assert.deepEqual(later.kinds, ['AudioBufferSourceNode'], 'the recording has taken over');
  } finally { await p.ctx.close(); }
});

test('with nothing touched, a hung stylesheet and held recordings, no recording is asked for before the page has loaded and gone idle', async () => {
  const p = await open({ google: 'hang', mp3: 'hold' });
  try {
    const at = Date.now();
    await sleep(1500);
    assert.ok(p.log.load != null);
    for (const m of p.log.mp3) assert.ok(m.t >= p.log.load, 'after the load event');
    /* the stand-in is also what a note is at this point */
    const kinds = await p.page.evaluate(() => { const pl = window.PPP.app.piano(); pl.wake(); const v = pl.strike(72, null, 80); return v ? v.srcs.map(s => s.constructor.name) : null; });
    assert.ok(kinds === null || kinds.every(k => k === 'OscillatorNode'), JSON.stringify(kinds));
    assert.ok(Date.now() - at >= 1500);
  } finally { await p.ctx.close(); }
});
