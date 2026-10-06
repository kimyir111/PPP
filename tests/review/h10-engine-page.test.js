/* G10b-0: the reviewer page of the ENGINE comparison in a real browser (headless Chrome via puppeteer): the same page as H-10, so only what the comparison adds is
   checked here - its introduction says "two readings of one recording" and names neither, nothing in the DOM (text, class, id, attribute) carries the vocabulary of the
   sources, what is drawn is what each reading's Score holds (heads and rests, both layouts), no sideways scroll at 390 and 1100 px, no network request, and the answers
   survive a reload and reach the artifact database through the page's adapter. Skipped (with a reason) if puppeteer cannot be found. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, heardDirs, tmpDir, LEAK } = require('./h10-helpers.js');
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
before(async () => {
  if (!puppeteer) return;
  const d = heardDirs(['nearer', 'know']);
  packet = await buildPacket({ mode: 'h10', compare: 'engine', seed: 'g10b0-page-test-seed-0123456789', heard: d.heard, heardB: d.heardB, out: path.join(tmpDir('engpg'), 'p'), keyOut: path.join(tmpDir('engpgk'), 'k'), jobs: 1 });
  url = pathToFileURL(packet.files.html).href;
  key = JSON.parse(fs.readFileSync(packet.files.key, 'utf8'));
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); });

async function open(opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:|about:)/.test(u)) requests.push(u); r.continue(); });
  if (opts.init) await page.evaluateOnNewDocument(opts.init);
  await page.setViewport({ width: opts.width || 1100, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, requests };
}
const tap = (page, sel) => page.$eval(sel, el => el.click());

test('the introduction says the two scores are two readings of one recording and names neither; no word of the sources is anywhere in the rendered DOM', { skip }, async () => {
  const { page, errors, requests } = await open({ width: 390 });
  await page.evaluate(() => window.__pppReview.expandAll());
  const dom = await page.evaluate(() => ({ title: document.title, intro: document.querySelector('.intro').innerText, all: document.documentElement.outerHTML.replace(/<script id="piano-samples"[\s\S]*?<\/script>/, '') }));
  assert.equal(dom.title, 'H-10b 악보 비교');
  assert.match(dom.intro, /두 가지로 듣고/); assert.match(dom.intro, /서로 다르게 읽어서/); assert.match(dom.intro, /음이 빠졌거나 많아요/);
  assert.doesNotMatch(dom.intro, /두 가지 방법/);
  const bad = LEAK.scanEngine(dom.all.replace(/<svg[\s\S]*?<\/svg>/g, '<svg></svg>'), '', {}, { seed: 'g10b0-page-test-seed-0123456789', credit: require(path.join(REPO, 'review/lib/page-h10.js')).CREDIT, titles: ['Piece nearer', 'Piece know'] });
  assert.deepEqual(bad, [], 'the DOM after the page has run (answers, save state, scores unpacked)');
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  await page.close();
});

test('what is drawn (DOM) is what each reading\'s Score holds, in both layouts, for every score; no sideways scroll at 390 and 1100 px', { skip }, async () => {
  for (const w of [390, 1100]) {
    const { page } = await open({ width: w });
    await page.evaluate(() => window.__pppReview.expandAll());
    const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length }));
    assert.equal(geo.sw, geo.cw, w + ' px: no sideways scroll'); assert.equal(geo.over, 0);
    const got = await page.$$eval('.paper', ps => ps.map(p => ({ k: p.getAttribute('data-svg'), layout: p.getAttribute('data-layout'), heads: p.querySelectorAll('svg use.vf-notehead:not(.vf-rest)').length, rests: p.querySelectorAll('svg use.vf-rest').length, svgs: p.querySelectorAll('svg').length })));
    assert.equal(got.length, Object.values(key.items).reduce((a, it) => a + it.parts.length * 2, 0));
    got.forEach(g => {
      const m = /^(i\d\d)([ta])([XY])$/.exec(g.k), it = key.items[m[1]], arm = it[m[3]], part = m[2].toUpperCase(), c = it.arms[arm].counts[part];
      assert.ok(arm === 'browser' || arm === 'helper');
      assert.equal(g.svgs, 1, g.k);
      assert.equal(g.heads, c.score.heads, w + ' px ' + g.k + ' (' + arm + ') heads drawn = the Score\'s');
      assert.equal(g.rests, c.score.rests, w + ' px ' + g.k + ' (' + arm + ') rests drawn = the Score\'s');
      assert.equal(g.heads, c[g.layout === '1' ? 'narrow' : 'wide'].heads);
    });
    await page.close();
  }
});

async function answer(page, id, part, o) {
  const sec = 'article[data-item="' + id + '"] section.part[data-part="' + part + '"]';
  await tap(page, sec + ' button[data-act="pass"][data-side="X"][data-value="' + (o.x ? 'pass' : 'fail') + '"]');
  await tap(page, sec + ' button[data-act="pass"][data-side="Y"][data-value="' + (o.y ? 'pass' : 'fail') + '"]');
  for (const t of o.tagsY || []) await tap(page, sec + ' button[data-act="tag"][data-side="Y"][data-value="' + t + '"]');
  await tap(page, sec + ' button[data-act="pref"][data-value="' + o.pref + '"]');
}

test('answers survive a reload, the export has the documented shape, and they reach the artifact database (answers/<packet>/items/<id>) through the adapter', { skip }, async () => {
  const { page, errors } = await open({ width: 390, init: function () {
    window.claude = { use: function (name) {
      if (name !== 'db') return Promise.resolve(null);
      const mk = path => ({ id: path.split('/').pop(), get: () => Promise.resolve({ exists: !!window.__docs[path], data: () => window.__docs[path] }), set: body => { window.__docs[path] = JSON.parse(JSON.stringify(body)); return Promise.resolve(); },
        collection: sub => ({ get: () => Promise.resolve({ docs: Object.keys(window.__docs).filter(k => k.indexOf(path + '/' + sub + '/') === 0).map(k => ({ data: () => window.__docs[k] })) }) }) });
      return Promise.resolve({ doc: mk, collection: p => ({ get: () => Promise.resolve({ docs: Object.keys(window.__docs).filter(k => k.indexOf(p + '/') === 0).map(k => ({ data: () => window.__docs[k] })) }) }) });
    } };
    window.__docs = {};
  } });
  await page.evaluate(() => window.localStorage.clear()); await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));
  await answer(page, 'i01', 'T', { x: true, y: false, tagsY: ['missing-extra'], pref: 'X' });
  const total = (await page.$eval('#progress', e => e.textContent)).split(' / ')[1];
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total);
  await page.evaluate(() => window.__pppReview.store.flush());
  const saved = await page.evaluate(() => window.__docs);
  const path1 = 'answers/' + packet.packetId + '/items/i01';
  assert.ok(saved[path1], 'the answer is in the database: ' + Object.keys(saved));
  assert.equal(saved[path1].T.pref, 'X'); assert.deepEqual(saved[path1].T.Y.tags, ['missing-extra']);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total, 'kept across a reload');
  const ex = await page.evaluate(() => window.__pppReview.exportObject());
  assert.equal(ex.format, 'ppp-review-ratings/2'); assert.equal(ex.mode, 'h10'); assert.equal(ex.packetId, packet.packetId);
  assert.deepEqual(ex.items[0].T, { preference: 'X', X: { pass: true, tags: [], text: '' }, Y: { pass: false, tags: ['missing-extra'], text: '' } });
  assert.equal(JSON.stringify(ex).toLowerCase().indexOf('engine'), -1, 'the export names no comparison');
  assert.deepEqual(errors, []);
  await page.close();
});
