'use strict';
/* G13-7b (U5): the anonymous counters, in the real page (browser test on this tree's own server, tests/load/lib.js, with puppeteer). Node-only half: tests/load/counters.test.js (the head
   script against a fake window) and tests/client-stats.test.js (the server's side).

   Here: a thrown error of the page is counted once and the beacon holds no text of it; a page that did nothing sends its timing only; the app's own "ready" mark is in the timing; nothing is
   sent when it is turned off (stored, or Do Not Track); the switch in Settings > About & licences turns it off and on and says so; the beacon has no cookie; and the server prints what it got
   in its hourly line. */
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
  srv = await boot(undefined, { PPP_STATS_INTERVAL_MS: '1500' });
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

/* a visit; `before` runs in every new document before the page's own scripts; `again` is the context of an earlier visit (same localStorage: "the next visit") */
async function open(before, locale, again) {
  const ctx = again || await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((src, loc) => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', loc); } catch (e) { /* */ }
    if (src) (0, eval)(src);
  }, before || '', locale || 'en-US');
  const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/stats$/.test(r.url())) posts.push({ body: r.postData(), headers: r.headers() }); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  await sleep(500);
  const hide = async () => { await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); }); await sleep(400); };
  const settings = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll('aside nav button')].find(x => /^(Settings|설정)$/.test((x.innerText || '').trim().split('\n')[0].trim())); b.click(); });
    await page.waitForSelector('[data-counts-toggle]', { timeout: 15000 });
  };
  return { ctx, page, posts, errors, hide, settings, close: () => (again ? page.close() : ctx.close()) };
}
const parse = p => JSON.parse(p.body);
/* run `code` as an inline script of the page (an error thrown by puppeteer's own evaluate is not the page's: the window sees it without its Error object) */
const inPage = (v, code) => v.page.evaluate(src => { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s); }, code);

test('a visit that did nothing sends its timing and nothing more, once, without a cookie', async () => {
  const v = await open();
  await v.hide();
  assert.equal(v.posts.length, 1);
  const b = parse(v.posts[0]);
  assert.deepEqual(Object.keys(b).sort(), ['b', 'fcp', 'loc', 'mob', 'pv', 'rdy', 'v'], JSON.stringify(b));
  assert.equal(b.v, 1);
  assert.equal(b.pv, 1);
  assert.equal(b.loc, 'en');
  assert.equal(b.mob, 0);
  assert.ok(b.fcp >= 0 && b.fcp <= 3, 'the first paint was seen: ' + b.fcp);
  assert.ok(b.rdy >= 0 && b.rdy <= 3, 'the app\'s own "ready" mark was made: ' + b.rdy);
  assert.equal(v.posts[0].headers.cookie, undefined, 'no cookie goes with it');
  assert.ok(Buffer.byteLength(v.posts[0].body) < 1024);
  await v.hide();
  assert.equal(v.posts.length, 1, 'a second hide with nothing new sends nothing');
  assert.deepEqual(v.errors, []);
  await v.close();
});

test('an error thrown by the page is counted once, by class, and the beacon holds none of its text', async () => {
  const v = await open();
  await inPage(v, "setTimeout(function () { throw new TypeError('boom-secret-message at https://example.com/x.js'); }, 0);");
  await sleep(300);
  await v.hide();
  assert.equal(v.posts.length, 1);
  const b = parse(v.posts[0]);
  assert.deepEqual(b.err, { type: 1 });
  assert.ok(!/boom|secret|example|x\.js/.test(v.posts[0].body), v.posts[0].body);
  await v.hide();
  assert.equal(v.posts.length, 1, 'the same error is not sent again');
  /* a later error is a new one, and the second beacon carries no timing */
  await inPage(v, "setTimeout(function () { throw new ReferenceError('again'); }, 0);");
  await sleep(300);
  await v.hide();
  assert.equal(v.posts.length, 2);
  const c = parse(v.posts[1]);
  assert.deepEqual(c.err, { reference: 1 });
  assert.equal(c.pv, undefined);
  await v.close();
});

test('an unhandled rejection is counted', async () => {
  const v = await open();
  await inPage(v, "Promise.reject(new Error('nobody catches this'));");
  await sleep(300);
  await v.hide();
  const b = parse(v.posts[0]);
  assert.equal(b.rej, 1);
  assert.ok(!/nobody|catches/.test(v.posts[0].body));
  await v.close();
});

test('turned off in the browser\'s storage: nothing is sent, however much happened', async () => {
  const v = await open('try { localStorage.setItem("ppp.counts.v1", "0"); } catch (e) {}');
  await inPage(v, "setTimeout(function () { throw new TypeError('x'); }, 0);");
  await sleep(300);
  await v.hide();
  assert.equal(v.posts.length, 0);
  await v.close();
});

test('Do Not Track turns it off, and Settings says why', async () => {
  const v = await open('Object.defineProperty(Navigator.prototype, "doNotTrack", { get() { return "1"; }, configurable: true });');
  await v.hide();
  assert.equal(v.posts.length, 0);
  await v.settings();
  const note = await v.page.evaluate(() => ({ note: document.querySelector('[data-counts-note]').innerText, pressed: document.querySelector('[data-counts-toggle]').getAttribute('aria-pressed') }));
  assert.match(note.note, /Do Not Track/);
  assert.equal(note.pressed, 'false');
  await v.close();
});

test('the switch in Settings > About & licences: on by default, off sends nothing and is remembered, on again sends', async () => {
  const v = await open();
  await v.settings();
  const read = () => v.page.evaluate(() => ({
    pressed: document.querySelector('[data-counts-toggle]').getAttribute('aria-pressed'),
    note: document.querySelector('[data-counts-note]').innerText,
    label: document.querySelector('[data-counts-toggle]').innerText,
    text: document.querySelector('[data-about-counts-text]').innerText,
    stored: localStorage.getItem('ppp.counts.v1'),
    inAbout: !!document.querySelector('[data-about-section] [data-counts-toggle]')
  }));
  let s = await read();
  assert.equal(s.pressed, 'true');
  assert.equal(s.stored, null);
  assert.ok(s.inAbout, 'in the About & licences card');
  assert.match(s.text, /anonymous counts/);
  assert.match(s.note, /^On\./);
  await v.page.click('[data-counts-toggle]');
  await sleep(300);
  s = await read();
  assert.equal(s.pressed, 'false');
  assert.equal(s.stored, '0');
  assert.match(s.note, /^Off\./);
  assert.equal(s.label, 'Send anonymous counts', 'the label is the same in both states');
  await inPage(v, "setTimeout(function () { throw new TypeError('x'); }, 0);");
  await sleep(300);
  await v.hide();
  assert.equal(v.posts.length, 0, 'off: nothing');
  await v.page.click('[data-counts-toggle]');
  await sleep(300);
  s = await read();
  assert.equal(s.pressed, 'true');
  assert.equal(s.stored, null);
  await v.hide();
  assert.equal(v.posts.length, 1, 'on again: the visit is counted');
  await v.close();
});

test('the switch is in the page\'s language (Korean)', async () => {
  const v = await open(null, 'ko-KR');
  await v.page.evaluate(() => { const b = [...document.querySelectorAll('aside nav button')].find(x => /^설정$/.test((x.innerText || '').trim().split('\n')[0].trim())); b.click(); });
  await v.page.waitForSelector('[data-counts-toggle]', { timeout: 15000 });
  const t = await v.page.evaluate(() => ({ label: document.querySelector('[data-counts-toggle]').innerText, note: document.querySelector('[data-counts-note]').innerText, text: document.querySelector('[data-about-counts-text]').innerText }));
  assert.equal(t.label, '익명 숫자 보내기');
  assert.match(t.note, /켜져 있어요/);
  assert.match(t.text, /익명/);
  await v.close();
});

test('end to end: the server prints what the browsers sent in its hourly line, as numbers', async () => {
  const v = await open();
  await inPage(v, "setTimeout(function () { throw new RangeError('x'); }, 0);");
  await sleep(300);
  await v.hide();
  await v.close();
  const clientLines = () => srv.log().split(/\r?\n/).filter(l => l.startsWith('stats: ') && l.includes('"client":'));
  const sum = () => clientLines().map(l => JSON.parse(l.slice(7)).client)
    .reduce((a, c) => { a.beacons += c.beacons; a.range += c.errors.range; a.visits += c.visits; a.lines++; return a; }, { beacons: 0, range: 0, visits: 0, lines: 0 });
  const t0 = Date.now();
  while (sum().range < 1 && Date.now() - t0 < 12000) await sleep(200);      /* the windows may split the visits across lines: add them up */
  const s = sum();
  assert.ok(s.lines >= 1 && s.beacons >= 1 && s.visits >= 1 && s.range >= 1, JSON.stringify(s) + ' ' + srv.log().slice(-300));
  const text = clientLines().join('\n');
  assert.ok(!/boom|127\.0\.0\.1|example|ppp_locale|Mozilla/.test(text));
});

/* ---- the server must never be woken by a beacon (G13-D11): the exit of a long quiet session is kept, not sent ---- */

/* the page believes 20 minutes have passed since the server last answered it (the clock the page reads, not the machine's) */
const later = (v, ms) => v.page.evaluate(n => { const real = Date.now; Date.now = () => real.call(Date) + n; }, ms);

test('a session that was quiet for 20 minutes sends nothing when it closes: the counts wait in localStorage and go with the next visit, once the server has answered that one', async () => {
  const v = await open();
  await later(v, 20 * 60 * 1000);
  await inPage(v, "setTimeout(function () { throw new TypeError('after a long session'); }, 0);");
  await sleep(300);
  await v.hide();
  assert.equal(v.posts.length, 0, 'no request: it would be the one that wakes the instance');
  const kept = await v.page.evaluate(() => localStorage.getItem('ppp.counts.pending.v1'));
  assert.ok(kept, 'kept');
  const list = JSON.parse(kept);
  assert.equal(list.length, 1);
  assert.deepEqual(JSON.parse(list[0].b).err, { type: 1 });
  assert.equal(JSON.parse(list[0].b).pv, 1);
  /* the clock the page read ran 20 minutes ahead of the machine's: put the time of the kept entry back to the machine's, as 20 real minutes would have made it */
  await v.page.evaluate(() => { const l = JSON.parse(localStorage.getItem('ppp.counts.pending.v1')); l.forEach(e => { e.t -= 20 * 60 * 1000; }); localStorage.setItem('ppp.counts.pending.v1', JSON.stringify(l)); });
  await v.page.close();
  /* the next visit, same profile: its own load has just come from the server; 4 s after its app is ready the kept counts go */
  const w = await open(null, 'en-US', v.ctx);
  const t0 = Date.now();
  while (w.posts.length < 1 && Date.now() - t0 < 15000) await sleep(200);
  assert.equal(w.posts.length, 1, 'the kept counts were sent by the next visit');
  const b = parse(w.posts[0]);
  assert.deepEqual(b.err, { type: 1 });
  assert.equal(b.loc, 'en', 'the visit that was kept, with its own language');
  assert.equal(await w.page.evaluate(() => localStorage.getItem('ppp.counts.pending.v1')), null, 'and removed');
  await w.hide();
  assert.equal(w.posts.length, 2, 'the visit\'s own beacon follows, as always');
  await w.page.close();
  await v.ctx.close();
});

test('a failed file is `load` when it is this site\'s and `thirdparty` when it is another\'s', async () => {
  const v = await open();
  await inPage(v, "var a = document.createElement('script'); a.src = '/no-such-file-g13.js'; document.head.appendChild(a); var b = document.createElement('script'); b.src = 'http://127.0.0.1:1/x.js'; document.head.appendChild(b); var c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'http://127.0.0.1:1/y.css'; document.head.appendChild(c);");
  await sleep(1500);
  await v.hide();
  const b = parse(v.posts[0]);
  assert.deepEqual(b.err, { load: 1, thirdparty: 2 });
  await v.close();
});

test('at most five beacons a page load', async () => {
  const v = await open();
  for (let i = 0; i < 8; i++) {
    await inPage(v, "setTimeout(function () { throw new TypeError('n'); }, 0);");
    await sleep(150);
    await v.hide();
  }
  assert.equal(v.posts.length, 5);
  await v.close();
});

test('"Delete everything on this device" keeps a person\'s choice not to send counts, and says so; everything else of ppp* goes', async () => {
  const v = await open('try { localStorage.setItem("ppp.counts.v1", "0"); localStorage.setItem("ppp.counts.pending.v1", "[]"); localStorage.setItem("ppp.something", "x"); } catch (e) {}', 'ko-KR');
  const noted = await v.page.evaluate(() => { const b = [...document.querySelectorAll('aside nav button')].find(x => /^설정$/.test((x.innerText || '').trim().split('\n')[0].trim())); b.click(); return true; });
  assert.ok(noted);
  await v.page.waitForSelector('[data-counts-toggle]', { timeout: 15000 });
  const note = await v.page.evaluate(() => document.body.innerText.includes('익명 숫자 보내기를 꺼 두었다면 그 설정은 그대로 남아요.'));
  assert.ok(note, 'the delete section says the choice stays (Korean)');
  const r = await v.page.evaluate(async () => {
    const rep = await window.PPPBackup.wipe({});
    return { ok: rep.ok, kept: rep.kept, keys: Object.keys(localStorage).filter(k => /^ppp/i.test(k)), optOut: localStorage.getItem('ppp.counts.v1') };
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.keys, ['ppp.counts.v1']);
  assert.equal(r.optOut, '0');
  assert.deepEqual(r.kept, ['ppp.counts.v1']);
  await v.close();
});
