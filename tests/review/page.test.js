/* G9c: the reviewer page in a real browser (headless Chrome via puppeteer): both scores render, the form works, ratings survive a
   reload, export is valid JSON, playback starts and stops, nothing is requested from the network, and the page still works when
   the browser refuses storage. Skipped (with a reason) if puppeteer cannot be found. Audio is started and stopped, not heard. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, ITEMS, CACHE, tmpDir } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));

function findPuppeteer() {
  for (const p of ['puppeteer', 'D:/PPP/node_modules/puppeteer', path.join(REPO, 'node_modules', 'puppeteer')]) {
    try { return require(p); } catch (e) { /* try the next */ }
  }
  return null;
}
const puppeteer = findPuppeteer();
const skip = puppeteer ? false : 'puppeteer is not installed';

let browser, packet, url;
before(async () => {
  if (!puppeteer) return;
  packet = await buildPacket({ mode: 'h8', seed: 'page-test-seed-1-0123456789', out: path.join(tmpDir('page'), 'p'), keyOut: path.join(tmpDir('pagek'), 'key'), items: ITEMS.slice(0, 2), cache: CACHE });
  url = pathToFileURL(packet.files.html).href;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { if (browser) await browser.close(); });

async function open(opts) {
  const page = await browser.newPage();
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
  }, !!(opts && opts.noStorage));
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, requests };
}

test('both scores of every item render with real size (one drawing per side is shown), and the page makes no network request', { skip }, async () => {
  const { page, errors, requests } = await open();
  const boxes = await page.$$eval('article.item svg', els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  assert.equal(boxes.length, 8, 'two items, two scores each, each drawn wide and narrow');
  assert.equal(boxes.filter(b => b[0] > 0).length, 4, 'a wide window shows the wide drawing of each side only');
  boxes.filter(b => b[0] > 0).forEach(b => { assert.ok(b[0] > 300 && b[1] > 100, 'an svg has a real size: ' + b); });
  const glyphs = await page.$$eval('article.item svg', els => els.map(e => e.querySelectorAll('use, path').length));
  glyphs.forEach(n => assert.ok(n > 50, 'the score has drawn marks'));
  assert.deepEqual(requests, [], 'nothing was requested from the network');
  assert.deepEqual(errors, []);
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 2 문항 평가함');
  await page.close();
});

test('phone width (400 px): the narrow drawing is shown, the page and the score box need no sideways scrolling, staff spaces are not tiny', { skip }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 800 });
  await page.goto(url, { waitUntil: 'load' });
  const r = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('article.item .paper')].map(p => {
      const svgs = [...p.querySelectorAll('svg')].filter(s => s.getBoundingClientRect().width > 0);
      const s = svgs[0], vb = s.viewBox.baseVal;
      return { shown: svgs.length, inNarrow: !!s.closest('.narrow'), boxW: p.clientWidth, scrollW: p.scrollWidth, pxPerSp: s.getBoundingClientRect().width / vb.width };
    });
    return { vis: vis, docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth };
  });
  assert.equal(r.docScroll, r.docClient, 'the page does not scroll sideways');
  assert.equal(r.vis.length, 4);
  r.vis.forEach(v => {
    assert.equal(v.shown, 1); assert.equal(v.inNarrow, true);
    assert.ok(v.scrollW <= v.boxW, 'the score box does not scroll sideways');
    assert.ok(v.pxPerSp >= 7, 'a staff space is at least 7 px at 400 px wide (was 6.2 at the forced 640 px, scrolled): ' + v.pxPerSp);
  });
  await page.setViewport({ width: 721, height: 800 });
  const wide = await page.$$eval('article.item .paper', ps => ps.map(p => !!([...p.querySelectorAll('svg')].find(s => s.getBoundingClientRect().width > 0) || { closest: () => null }).closest('.wide')));
  assert.ok(wide.every(Boolean), 'just above the breakpoint the wide drawing is shown');
  await page.setViewport({ width: 720, height: 800 });
  const narrow = await page.$$eval('article.item .paper', ps => ps.map(p => !!([...p.querySelectorAll('svg')].find(s => s.getBoundingClientRect().width > 0) || { closest: () => null }).closest('.narrow')));
  assert.ok(narrow.every(Boolean), 'at 720 px the narrow drawing is shown (the engraver phone breakpoint)');
  await page.close();
});

test('the form works, ratings survive a reload, and the export is valid JSON in the documented shape', { skip }, async () => {
  const { page, errors } = await open();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('input[name="pref-i01"][value="Y"]');
  await page.click('article[data-item="i01"] input[data-issue="too-hard"][data-side="X"]');
  await page.click('article[data-item="i01"] input[data-issue="thin-muddy"][data-side="Y"]');
  await page.type('article[data-item="i01"] textarea[data-side="X"]', 'bar 5 jumps');
  await page.type('#role', 'test pianist');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함');
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함', 'the count survives');
  assert.equal(await page.$eval('input[name="pref-i01"][value="Y"]', e => e.checked), true);
  assert.equal(await page.$eval('article[data-item="i01"] input[data-issue="too-hard"][data-side="X"]', e => e.checked), true);
  assert.equal(await page.$eval('article[data-item="i01"] textarea[data-side="X"]', e => e.value), 'bar 5 jumps');
  assert.equal(await page.$eval('#role', e => e.value), 'test pianist');
  /* the download button hands the same JSON to a file */
  await page.click('#export-btn');
  const text = await page.evaluate(async () => window.__blobs.length ? await window.__blobs[window.__blobs.length - 1].text() : null);
  assert.ok(text, 'the export button made a file');
  const dl = await page.evaluate(() => window.__lastDownload);
  assert.match(dl.name, /^ratings-h8-[0-9a-f]{12}\.json$/);
  const o = JSON.parse(text);
  assert.equal(o.format, 'ppp-review-ratings/1'); assert.equal(o.mode, 'h8'); assert.equal(o.packetId, packet.packetId); assert.equal(o.reviewer, 'test pianist');
  assert.deepEqual(o.ratings.map(r => r.id), ['i01', 'i02']);
  assert.equal(o.ratings[0].preference, 'Y');
  assert.deepEqual(o.ratings[0].X.issues, ['too-hard']); assert.deepEqual(o.ratings[0].Y.issues, ['thin-muddy']); assert.equal(o.ratings[0].X.text, 'bar 5 jumps');
  assert.equal(o.ratings[1].preference, null, 'an unrated item is exported as null, not dropped');
  /* the text box shows the same JSON (for a blocked download) */
  const shown = JSON.parse(await page.$eval('#export-json', e => e.value));
  assert.equal(shown.ratings[0].preference, 'Y');
  /* and it decodes with the key */
  const { decode } = require(path.join(REPO, 'review/decode.js'));
  const d = decode(JSON.parse(fs.readFileSync(packet.files.key, 'utf8')), o);
  assert.equal(d.items, 2); assert.equal(d.preference.g9 + d.preference.legacy, 1);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.localStorage.clear());
  await page.close();
});

test('Clear ratings erases them (after the confirm)', { skip }, async () => {
  const { page } = await open();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  page.on('dialog', d => d.accept());
  await page.click('input[name="pref-i02"][value="same"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함');
  await page.click('#clear-btn');
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 2 문항 평가함');
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 2 문항 평가함');
  await page.close();
});

test('Play starts and Stop stops a synthesised playback without an error (audio itself is not heard here)', { skip }, async () => {
  const { page, errors, requests } = await open();
  await page.click('article[data-item="i01"] button[data-play="X"]');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="X"]', e => e.textContent), '정지');
  /* starting the other one stops the first */
  await page.click('article[data-item="i01"] button[data-play="Y"]');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="X"]', e => e.textContent), '재생');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="Y"]', e => e.textContent), '정지');
  await page.click('article[data-item="i01"] button[data-play="Y"]');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="Y"]', e => e.textContent), '재생');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await page.close();
});

test('with storage refused the page still works (it just does not remember)', { skip }, async () => {
  const { page, errors } = await open({ noStorage: true });
  await page.click('input[name="pref-i01"][value="X"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함');
  assert.equal(JSON.parse(await page.$eval('#export-json', e => e.value)).ratings[0].preference, 'X');
  assert.deepEqual(errors, []);
  await page.close();
});

test('an H-9 page: pass/fail per arrangement, complete only when both are marked', { skip }, async () => {
  const p9 = await buildPacket({ mode: 'h9', seed: 'page-test-seed-2-0123456789', out: path.join(tmpDir('page9'), 'p'), keyOut: path.join(tmpDir('page9k'), 'key'), items: ITEMS.slice(0, 2), cache: CACHE });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(p9.files.html).href, { waitUntil: 'load' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('input[name="pass-i01-X"][value="pass"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 2 문항 평가함', 'one side is not enough');
  await page.click('input[name="pass-i01-Y"][value="fail"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함');
  const o = await page.evaluate(() => window.__pppReview.exportObject());
  assert.equal(o.ratings[0].X.pass, true); assert.equal(o.ratings[0].Y.pass, false); assert.equal(o.ratings[1].X.pass, null);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.localStorage.clear());
  await page.close();
});

test('the real Download button writes a real file through the browser\'s own download path (no stub)', { skip }, async () => {
  const dir = tmpDir('dl');
  const client = await browser.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('input[name="pref-i02"][value="X"]');
  await page.click('#export-btn');
  let file = null;
  for (let i = 0; i < 100 && !file; i++) {
    await new Promise(r => setTimeout(r, 100));
    file = fs.readdirSync(dir).find(f => /^ratings-h8-[0-9a-f]{12}\.json$/.test(f));
  }
  assert.ok(file, 'a ratings file appeared in the download folder; found ' + JSON.stringify(fs.readdirSync(dir)));
  const o = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.equal(o.packetId, packet.packetId); assert.equal(o.ratings[1].preference, 'X');
  await page.evaluate(() => window.localStorage.clear());
  await page.close();
});

test('the page does not claim both arrangements hit the requested level', { skip }, async () => {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const text = await page.evaluate(() => document.body.innerText);
  assert.ok(!/겨냥/.test(text), 'no claim that both aim at the level');
  assert.ok(/난이도 [0-9.]+ 수준으로 요청/.test(text) && /정확히 그 난이도가 되리라는 보장은 없습니다/.test(text));
  await page.close();
});
