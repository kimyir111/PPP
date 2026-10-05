/* G10a-5 (H-10): the reviewer page in a real browser (headless Chrome via puppeteer): no sideways scroll at 360-400 px, the layout that fits the width, what is
   drawn in the DOM equals what the arm's Score says, big touch targets, every tap kept (memory, localStorage, and the artifact database through the adapter
   when window.claude.use('db') answers), resume, the summary, the export, the sound (the app's sampled piano, the player plan's velocities). Skipped (with
   a reason) if puppeteer cannot be found. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, heardDir, tmpDir } = require('./h10-helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));

function findPuppeteer() {
  for (const p of ['puppeteer', 'D:/PPP/node_modules/puppeteer', path.join(REPO, 'node_modules', 'puppeteer')]) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}
const puppeteer = findPuppeteer();
const skip = puppeteer ? false : 'puppeteer is not installed';

let browser, packet, url, key;
const PID = () => packet.packetId;
before(async () => {
  if (!puppeteer) return;
  packet = await buildPacket({ mode: 'h10', seed: 'h10-page-test-seed-0123456789', heard: heardDir(['nearer', 'know']), out: path.join(tmpDir('h10pg'), 'p'), keyOut: path.join(tmpDir('h10pgk'), 'k'), jobs: 1 });
  url = pathToFileURL(packet.files.html).href;
  key = JSON.parse(fs.readFileSync(packet.files.key, 'utf8'));
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { if (browser) await browser.close(); });

/* a page with the errors and requests collected; `init` runs before the page's own scripts */
/* a browser context of its own for every page: localStorage (the same file, the same packet) is not shared between the tests */
async function isolatedPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  return page;
}
async function open(opts) {
  opts = opts || {};
  const page = await isolatedPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:|about:)/.test(u)) requests.push(u); r.continue(); });
  await page.evaluateOnNewDocument(function (noStorage) {
    if (noStorage) {
      Storage.prototype.getItem = function () { throw new Error('storage blocked'); };
      Storage.prototype.setItem = function () { throw new Error('storage blocked'); };
      Storage.prototype.removeItem = function () { throw new Error('storage blocked'); };
    }
    window.__blobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { window.__blobs.push(b); return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { window.__lastDownload = { name: this.download, href: this.href }; };
  }, !!opts.noStorage);
  if (opts.init) await page.evaluateOnNewDocument(opts.init, opts.initArg);
  await page.setViewport({ width: opts.width || 1100, height: opts.height || 900 });
  await page.goto(opts.url || url, { waitUntil: 'load' });
  return { page, errors, requests };
}
const tap = (page, sel) => page.$eval(sel, el => el.click());

test('no network request and no error; the page needs no sideways scroll at 360, 390, 400 and 1100 px', { skip }, async () => {
  for (const w of [360, 390, 400, 1100]) {
    const { page, errors, requests } = await open({ width: w });
    await page.evaluate(() => window.__pppReview.expandAll());
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
      papers: [...document.querySelectorAll('.paper')].map(p => ({ w: p.clientWidth, sw: p.scrollWidth })) }));
    assert.equal(r.sw, r.cw, w + ' px: the page does not scroll sideways');
    assert.equal(r.over, 0, w + ' px: nothing sticks out on the right');
    assert.equal(r.papers.length, 8, 'two pieces, two parts, X and Y');
    r.papers.forEach(p => assert.ok(p.sw <= p.w, 'a score box does not scroll sideways'));
    assert.deepEqual(requests, [], 'nothing was requested from the network');
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('the layout that fits: the phone drawing up to 720 px, the desktop one above, and it follows a resize', { skip }, async () => {
  const { page } = await open({ width: 390 });
  await page.evaluate(() => window.__pppReview.expandAll());
  const lay = () => page.$$eval('.paper', ps => ps.map(p => p.getAttribute('data-layout')));
  assert.ok((await lay()).every(l => l === '1'), 'phone: narrow');
  await page.setViewport({ width: 721, height: 900 }); await new Promise(r => setTimeout(r, 200));
  assert.ok((await lay()).every(l => l === '0'), '721 px: wide');
  await page.setViewport({ width: 720, height: 900 }); await new Promise(r => setTimeout(r, 200));
  assert.ok((await lay()).every(l => l === '1'), '720 px: narrow again');
  const px = await page.$$eval('.paper svg', els => els.map(e => e.getBoundingClientRect().width / e.viewBox.baseVal.width));
  px.forEach(v => assert.ok(v >= 7, 'a staff space is at least 7 px: ' + v));
  await page.close();
});

test('a score box holds its height before its drawing is unpacked, so the page does not jump while pieces come near; the drawings are unpacked only near the screen', { skip }, async () => {
  for (const w of [390, 1100]) {
    const { page } = await open({ width: w });
    const before = await page.$$eval('.paper', ps => ps.map(p => ({ k: p.getAttribute('data-svg'), painted: !!p.firstChild, h: p.getBoundingClientRect().height })));
    assert.ok(before.some(b => !b.painted), w + ' px: not every drawing is unpacked at the start (the far ones wait)');
    assert.ok(before.some(b => b.painted), 'the near ones are');
    const waiting = before.filter(b => !b.painted);
    waiting.forEach(b => assert.ok(b.h > 60, w + ' px ' + b.k + ' holds a height before it is drawn: ' + b.h));
    await page.evaluate(() => window.__pppReview.expandAll());
    const after = await page.$$eval('.paper', ps => ps.map(p => ({ k: p.getAttribute('data-svg'), h: p.getBoundingClientRect().height })));
    waiting.forEach(b => { const a = after.find(x => x.k === b.k); assert.ok(Math.abs(a.h - b.h) < 2, w + ' px ' + b.k + ': ' + b.h + ' before, ' + a.h + ' after'); });
    await page.close();
  }
});

test('what is drawn (DOM) is what the arm\'s Score holds: note heads and rests per side, in both layouts, equal the key\'s counts', { skip }, async () => {
  for (const w of [390, 1100]) {
    const { page } = await open({ width: w });
    await page.evaluate(() => window.__pppReview.expandAll());
    const got = await page.$$eval('.paper', ps => ps.map(p => ({ k: p.getAttribute('data-svg'), layout: p.getAttribute('data-layout'), heads: p.querySelectorAll('svg use.vf-notehead:not(.vf-rest)').length, rests: p.querySelectorAll('svg use.vf-rest').length, svgs: p.querySelectorAll('svg').length })));
    assert.equal(got.length, 8);
    got.forEach(g => {
      const m = /^(i\d\d)([ta])([XY])$/.exec(g.k), it = key.items[m[1]], arm = it[m[3]], part = m[2].toUpperCase(), c = it.arms[arm].counts[part];
      assert.equal(g.svgs, 1, g.k + ': one drawing in the box');
      const l = g.layout === '1' ? 'narrow' : 'wide';
      assert.equal(g.heads, c.score.heads, w + ' px ' + g.k + ' heads drawn = the Score\'s');
      assert.equal(g.rests, c.score.rests, w + ' px ' + g.k + ' rests drawn = the Score\'s');
      assert.equal(g.heads, c[l].heads); assert.equal(g.rests, c[l].rests);
    });
    await page.close();
  }
});

test('touch targets: every choice is at least 40 px tall and the text at least 14 px', { skip }, async () => {
  const { page } = await open({ width: 390 });
  const r = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, select, summary, input[type=text]')].filter(e => e.offsetParent !== null).map(e => ({ t: (e.textContent || e.id || '').trim().slice(0, 20), h: Math.round(e.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(e).fontSize) })));
  assert.ok(r.length > 40);
  r.forEach(x => { assert.ok(x.h >= 38, x.t + ' is ' + x.h + ' px tall'); assert.ok(x.fs >= 14, x.t + ' text is ' + x.fs + ' px'); });
  assert.ok(r.filter(x => x.h >= 44).length > r.length * 0.8, 'most are 44 px or more');
  await page.close();
});

async function answerPart(page, id, part, o) {
  const sec = 'article[data-item="' + id + '"] section.part[data-part="' + part + '"]';
  if (o.x !== undefined) await tap(page, sec + ' button[data-act="pass"][data-side="X"][data-value="' + (o.x ? 'pass' : 'fail') + '"]');
  if (o.y !== undefined) await tap(page, sec + ' button[data-act="pass"][data-side="Y"][data-value="' + (o.y ? 'pass' : 'fail') + '"]');
  for (const t of o.tagsX || []) await tap(page, sec + ' button[data-act="tag"][data-side="X"][data-value="' + t + '"]');
  for (const t of o.tagsY || []) await tap(page, sec + ' button[data-act="tag"][data-side="Y"][data-value="' + t + '"]');
  if (o.pref) await tap(page, sec + ' button[data-act="pref"][data-value="' + o.pref + '"]');
}

test('answers: one tap each, toggles off on a second tap, progress and the part\'s done mark follow, they survive a reload, the export has the documented shape', { skip }, async () => {
  const { page, errors } = await open({ width: 390 });
  await page.evaluate(() => window.localStorage.clear()); await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 4');
  await answerPart(page, 'i01', 'T', { x: true, y: false, tagsY: ['rests', 'hands'], pref: 'X' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 4');
  assert.ok(await page.$eval('#sec-i01-T', e => e.classList.contains('done')));
  await tap(page, '#sec-i01-T details[data-side="Y"] summary');     /* the note box is folded until it is wanted */
  await page.type('article[data-item="i01"] section[data-part="T"] textarea[data-side="Y"]', '5번째 마디 쉼표');
  /* a second tap clears */
  await tap(page, '#sec-i01-T button[data-act="pref"][data-value="X"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 4');
  await tap(page, '#sec-i01-T button[data-act="pref"][data-value="same"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 4');
  assert.equal(await page.$eval('#sec-i01-T button[data-act="pref"][data-value="same"]', e => e.getAttribute('aria-pressed')), 'true');
  await page.type('#role', '피아노 선생님');
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 4', 'kept across a reload');
  assert.equal(await page.$eval('#sec-i01-T button[data-act="pass"][data-side="X"][data-value="pass"]', e => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#sec-i01-T button[data-act="tag"][data-side="Y"][data-value="hands"]', e => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#sec-i01-T textarea[data-side="Y"]', e => e.value), '5번째 마디 쉼표');
  assert.equal(await page.$eval('#role', e => e.value), '피아노 선생님');
  const ex = await page.evaluate(() => window.__pppReview.exportObject());
  assert.equal(ex.format, 'ppp-review-ratings/2'); assert.equal(ex.mode, 'h10'); assert.equal(ex.packetId, PID()); assert.equal(ex.reviewer, '피아노 선생님');
  assert.deepEqual(ex.items.map(i => i.id), ['i01', 'i02']);
  assert.deepEqual(ex.items[0].T, { preference: 'same', X: { pass: true, tags: [], text: '' }, Y: { pass: false, tags: ['rests', 'hands'], text: '5번째 마디 쉼표' } });
  assert.deepEqual(ex.items[0].A, { preference: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } });
  /* the resume button and the summary */
  assert.equal(await page.$eval('#resume-btn', e => e.hidden), false);
  assert.match(await page.$eval('#summary-status', e => e.textContent), /0 \/ 2곡 완료 \(부분 1 \/ 4\)/);
  assert.equal(await page.$$eval('#summary-open a', a => a.length), 3, 'three parts still open');
  assert.equal(await page.$eval('#summary-open li:first-child a', a => a.getAttribute('href')), '#sec-i01-A');
  for (const [id, p] of [['i01', 'A'], ['i02', 'T'], ['i02', 'A']]) await answerPart(page, id, p, { x: true, y: true, pref: 'Y' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '4 / 4');
  assert.match(await page.$eval('#summary-status', e => e.textContent), /모두 끝났어요/);
  assert.equal(await page.$eval('#summary-open-wrap', e => e.hidden), true);
  assert.equal(await page.$eval('#resume-btn', e => e.hidden), true);
  const text = JSON.parse(await page.$eval('#export-json', e => e.value));
  assert.deepEqual(text.items[1].A.preference, 'Y');
  await page.click('#export-btn');
  const dl = await page.evaluate(() => window.__lastDownload);
  assert.equal(dl.name, 'ratings-h10-' + PID() + '.json');
  const blob = JSON.parse(await page.evaluate(() => window.__blobs[0].text()));
  assert.equal(blob.packetId, PID()); assert.equal(blob.items.length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('resume: opening the page again with answers scrolls to the first part left open, and the resume button goes there', { skip }, async () => {
  const { page } = await open({ width: 390 });
  await page.evaluate(() => window.localStorage.clear()); await page.reload({ waitUntil: 'load' });
  for (const [id, p] of [['i01', 'T'], ['i01', 'A']]) await answerPart(page, id, p, { x: true, y: true, pref: 'X' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 400));
  const top = await page.$eval('#sec-i02-T', e => Math.round(e.getBoundingClientRect().top));
  assert.ok(Math.abs(top) < 120, 'the first open part (piece 2, part 1) is at the top: ' + top);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#resume-btn');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(Math.abs(await page.$eval('#sec-i02-T', e => Math.round(e.getBoundingClientRect().top))) < 120);
  await page.close();
});

test('with storage refused the page still works (it just does not remember)', { skip }, async () => {
  const { page, errors } = await open({ noStorage: true, width: 390 });
  await answerPart(page, 'i01', 'T', { x: true, y: true, pref: 'X' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 4');
  assert.equal(await page.$eval('#save-state', e => e.textContent), '이 기기에 저장됨', 'the label is the one it has (it cannot know the storage refused)');
  assert.deepEqual(errors, []);
  await page.close();
});

/* a fake artifact database: the page's window.claude.use('db'), with the documents kept in Node so a second page (another device) sees them */
const fakeClaude = function (opts) {
  const call = (name, ...a) => window['__db_' + name](...a);
  const mk = path => ({
    id: path.split('/').pop(), path: path,
    get: async () => { const d = await call('get', path); return { id: path.split('/').pop(), exists: !!d, data: () => d ? JSON.parse(JSON.stringify(d)) : undefined }; },
    set: async body => { if (opts.failWrites) { const e = new Error('full'); e.code = opts.failWrites; throw e; } await call('set', path, JSON.parse(JSON.stringify(body))); },
    collection: sub => coll(path + '/' + sub)
  });
  const coll = path => ({ path: path, doc: id => mk(path + '/' + id), get: async () => { const l = await call('list', path); return { docs: l.map(x => ({ id: x.id, exists: true, data: () => JSON.parse(JSON.stringify(x.data)) })), size: l.length, empty: !l.length }; } });
  window.claude = { use: async name => name === 'db' && !opts.noDb ? { doc: mk, collection: coll } : null };
};
function dbInit(store) {
  return async page => {
    await page.exposeFunction('__db_get', async p => store.has(p) ? store.get(p) : null);
    await page.exposeFunction('__db_set', async (p, b) => { store.set(p, b); return true; });
    await page.exposeFunction('__db_list', async p => [...store.keys()].filter(k => k.startsWith(p + '/') && k.slice(p.length + 1).indexOf('/') < 0).map(k => ({ id: k.slice(p.length + 1), data: store.get(k) })));
  };
}
async function openWithDb(store, o) {
  const page = await isolatedPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await dbInit(store)(page);
  await page.evaluateOnNewDocument(fakeClaude, o || {});
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));
  return { page, errors };
}

test('the artifact database: every answer is written to answers/<packet>/items/<id> (and the role to answers/<packet>), the label says so, and another device resumes from it', { skip }, async () => {
  const store = new Map();
  const { page, errors } = await openWithDb(store);
  assert.equal(await page.$eval('#save-state', e => e.textContent), '저장됨 (서버)');
  await answerPart(page, 'i01', 'T', { x: true, y: false, tagsY: ['rests'], pref: 'Y' });
  await page.type('#role', '선생님');
  await page.evaluate(() => window.__pppReview.store.flush());
  await new Promise(r => setTimeout(r, 1200));
  const item = store.get('answers/' + PID() + '/items/i01');
  assert.ok(item, 'the item document exists: ' + [...store.keys()].join(', '));
  assert.equal(item.id, 'i01'); assert.equal(item.packetId, PID()); assert.ok(item.t > 0);
  assert.deepEqual(item.T, { pref: 'Y', X: { pass: true, tags: [], text: '' }, Y: { pass: false, tags: ['rests'], text: '' } });
  assert.deepEqual(item.A, { pref: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } });
  assert.equal(store.get('answers/' + PID()).role, '선생님');
  assert.equal(store.has('answers/' + PID() + '/items/i02'), false, 'an item with no answer is not written');
  assert.equal(await page.$eval('#save-state', e => e.textContent), '저장됨 (서버)');
  assert.deepEqual(errors, []);
  await page.close();
  /* another device: empty localStorage (a fresh context), the same database */
  const ctx = await browser.createBrowserContext();
  const page2 = await ctx.newPage();
  await dbInit(store)(page2);
  await page2.evaluateOnNewDocument(fakeClaude, {});
  await page2.setViewport({ width: 390, height: 900 });
  await page2.goto(url, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(await page2.$eval('#progress', e => e.textContent), '1 / 4', 'resumed from the database');
  assert.equal(await page2.$eval('#sec-i01-T button[data-act="pref"][data-value="Y"]', e => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await page2.$eval('#role', e => e.value), '선생님');
  await ctx.close();
});

test('database and this device together: the newer answer of an item wins, and what only this device has goes up', { skip }, async () => {
  const store = new Map();
  const old = { id: 'i01', packetId: PID(), t: 1000, v: 1, T: { pref: 'X', X: { pass: true, tags: [], text: '' }, Y: { pass: true, tags: [], text: '' } }, A: { pref: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } } };
  const newer = { id: 'i02', packetId: PID(), t: Date.now() + 1e6, v: 1, T: { pref: 'Y', X: { pass: false, tags: ['other'], text: 'db' }, Y: { pass: true, tags: [], text: '' } }, A: { pref: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } } };
  store.set('answers/' + PID() + '/items/i01', old); store.set('answers/' + PID() + '/items/i02', newer);
  const page = await isolatedPage();
  await dbInit(store)(page);
  await page.evaluateOnNewDocument(fakeClaude, {});
  /* this device has a newer i01 and an older i02 */
  const local = { packetId: PID(), role: '', answers: {
    i01: { t: 5000, T: { pref: 'Y', X: { pass: false, tags: [], text: 'local' }, Y: { pass: true, tags: [], text: '' } }, A: { pref: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } } },
    i02: { t: 10, T: { pref: 'X', X: { pass: true, tags: [], text: '' }, Y: { pass: true, tags: [], text: '' } }, A: { pref: null, X: { pass: null, tags: [], text: '' }, Y: { pass: null, tags: [], text: '' } } } } };
  await page.evaluateOnNewDocument((k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, 'ppp-review:' + PID(), JSON.stringify(local));
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1800));
  const ans = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pppReview.answers())));
  assert.equal(ans.i01.T.pref, 'Y', 'this device\'s newer i01 stays'); assert.equal(ans.i01.T.X.text, 'local');
  assert.equal(ans.i02.T.pref, 'Y', 'the database\'s newer i02 is adopted'); assert.equal(ans.i02.T.X.text, 'db');
  assert.equal(store.get('answers/' + PID() + '/items/i01').T.pref, 'Y', 'the newer local i01 went up');
  assert.equal(store.get('answers/' + PID() + '/items/i02').T.X.text, 'db', 'the newer database i02 was left alone');
  assert.equal(await page.$eval('#sec-i02-T textarea[data-side="X"]', e => e.value), 'db', 'and it is on the screen');
  await page.close();
});

test('the database refuses or is not there: the page says so (or says nothing of a server) and every answer stays on this device', { skip }, async () => {
  const store = new Map();
  const a = await openWithDb(store, { failWrites: 'quota_exceeded' });
  await answerPart(a.page, 'i01', 'T', { x: true, y: true, pref: 'X' });
  await a.page.evaluate(() => window.__pppReview.store.flush());
  await new Promise(r => setTimeout(r, 500));
  assert.match(await a.page.$eval('#save-state', e => e.textContent), /서버 저장 실패/);
  assert.equal(await a.page.evaluate(() => window.__pppReview.store.lastError()), 'quota_exceeded');
  assert.equal(JSON.parse(await a.page.evaluate(k => localStorage.getItem(k), 'ppp-review:' + PID())).answers.i01.T.pref, 'X', 'kept locally');
  assert.deepEqual(a.errors, []);
  await a.page.close();
  const b = await openWithDb(new Map(), { noDb: true });     /* claude.use('db') resolves null: signed out, not granted */
  assert.equal(await b.page.$eval('#save-state', e => e.textContent), '이 기기에 저장됨');
  await answerPart(b.page, 'i01', 'T', { x: true, y: true, pref: 'X' });
  assert.equal(await b.page.$eval('#progress', e => e.textContent), '1 / 4');
  assert.deepEqual(b.errors, []);
  await b.page.close();
});

test('sound: the 30 recordings decode, Play schedules one voice per strike of the app\'s player plan, a phrase renders, and a note\'s own velocity is used', { skip }, async () => {
  const { page, errors } = await open({ width: 390 });
  const n = await page.evaluate(() => window.__pppReview.sound.load().then(ok => ({ ok: ok, got: window.__pppReview.sound.samples.got })));
  assert.equal(n.ok, true); assert.equal(n.got, 30);
  /* the notes of a side are the strikes of its arm's player plan */
  const r = await page.evaluate(() => ['i01t', 'i01a', 'i02t', 'i02a'].map(k => ['X', 'Y'].map(s => window.__pppReview.sound.notes(k, s).length)));
  ['i01', 'i02'].forEach((id, i) => ['t', 'a'].forEach((p, j) => ['X', 'Y'].forEach((s, k) => {
    const it = key.items[id], c = it.arms[it[s]].counts[p.toUpperCase()];
    assert.equal(r[i * 2 + j][k], c.struck, id + p + s + ': ' + c.struck + ' strikes');
  })));
  await page.click('#sec-i01-T button[data-play="X"]');
  await page.waitForFunction(() => window.__pppReview.sound.lastRun(), { timeout: 15000 });
  const run = await page.evaluate(() => window.__pppReview.sound.lastRun());
  assert.equal(run.mode, 'samples'); assert.equal(run.voices, run.notes); assert.equal(run.id, 'i01t'); assert.equal(run.side, 'X');
  await page.click('#sec-i01-T button[data-play="X"]');      /* a second tap stops */
  assert.equal(await page.$eval('#sec-i01-T button[data-play="X"]', e => e.textContent), '재생');
  const off = await page.evaluate(() => window.__pppReview.sound.renderOffline('i01t', 'X', 1, 'samples', 6).then(x => { let p = 0; const b = x.buffer; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; } } return { peak: p, notes: x.notes, mode: x.mode }; }));
  assert.equal(off.mode, 'samples'); assert.ok(off.peak > 0.02 && off.peak <= 1.0001, 'a phrase renders, audible and not clipping: ' + off.peak);
  /* velocity: the same note at 30 and at 120 */
  const v = await page.evaluate(() => window.__pppReview.sound.renderNotes([[0, 1, 60, 30]]).then(a => window.__pppReview.sound.renderNotes([[0, 1, 60, 120]]).then(b => {
    const peak = x => { let p = 0; const bb = x.buffer; for (let c = 0; c < bb.numberOfChannels; c++) { const d = bb.getChannelData(c); for (let i = 0; i < d.length; i++) { const q = Math.abs(d[i]); if (q > p) p = q; } } return p; };
    return { soft: peak(a), loud: peak(b) };
  })));
  assert.ok(v.loud > v.soft * 1.5, 'a harder strike is louder: ' + JSON.stringify(v));
  assert.deepEqual(errors, []);
  await page.close();
});
