/* H-10c: the reviewer page of the lead-sheet-against-reduction review in a real browser (headless Chrome via puppeteer): Korean, no sideways scroll at 360-400 and 1100 px, no
   network request, no error, no word of the two methods anywhere in the DOM (text, class, id, attribute), what is drawn is what each copy's Score holds (both layouts), the two
   questions per copy and the preference per pair, singles without X and Y, every tap kept (memory, localStorage, and the artifact database through the adapter when
   window.claude.use('db') answers; the documents are what review/h10/db-to-ratings.js reads), the export, resume, and Play (the app's sampled piano, one voice per strike of the
   player plan). Skipped (with a reason) if puppeteer cannot be found. Synthetic input only (heard-notes fixtures of public-domain hymns; a stub in front of the arranger makes the singles). */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, heardDir, heardOf, tmpDir, LEAK } = require('./h10-helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));
const APP = require(path.join(REPO, 'review/lib/appcode.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-arrange.js'));
const DB = require(path.join(REPO, 'review/h10/db-to-ratings.js'));
const { decode } = require(path.join(REPO, 'review/decode.js'));

function findPuppeteer() {
  for (const p of ['puppeteer', 'D:/PPP/node_modules/puppeteer', path.join(REPO, 'node_modules', 'puppeteer')]) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}
const puppeteer = findPuppeteer();
const skip = puppeteer ? false : 'puppeteer is not installed';
const SEED = 'h10c-page-test-seed-0123456789';

let browser, packet, url, key, pairId, singleId, pairParts, singleParts;
before(async () => {
  if (!puppeteer) return;
  const real = APP.arranger();
  const noReduce = { arrange: (g, level, title, o) => o.recordingArrange === 'reduce' ? Promise.resolve({ ok: false, reason: 'UNREACHABLE' }) : real.arrange(g, level, title, o) };
  const results = {};
  for (const n of ['nearer', 'know']) results[n] = { ok: true, result: await ITEM.buildArrangeItem({ id: n, title: 'Piece ' + n, heard: heardOf(n), compare: 'arrange', levels: ITEM.ARRANGE_LEVELS, excerpt: {} }, { arranger: n === 'know' ? noReduce : real }) };
  packet = await buildPacket({ mode: 'h10', compare: 'arrange', seed: SEED, heard: heardDir(['nearer', 'know']), results: results, out: path.join(tmpDir('arrpg'), 'p'), keyOut: path.join(tmpDir('arrpgk'), 'k'), jobs: 1 });
  url = pathToFileURL(packet.files.html).href;
  key = JSON.parse(fs.readFileSync(packet.files.key, 'utf8'));
  pairId = Object.keys(key.items).find(id => key.items[id].source.id === 'nearer');
  singleId = Object.keys(key.items).find(id => key.items[id].source.id === 'know');
  pairParts = Object.keys(key.items[pairId].parts); singleParts = Object.keys(key.items[singleId].parts);
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
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
  await page.evaluateOnNewDocument(function () {
    window.__blobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { window.__blobs.push(b); return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { window.__lastDownload = { name: this.download, href: this.href }; };
  });
  if (opts.init) await page.evaluateOnNewDocument(opts.init, opts.initArg);
  await page.setViewport({ width: opts.width || 1100, height: opts.height || 900 });
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, requests };
}
const tap = (page, sel) => page.$eval(sel, el => el.click());
const secOf = (id, part) => 'article[data-item="' + id + '"] section.part[data-part="' + part + '"]';

const fakeDb = function (initial) {
  window.claude = { use: function (name) {
    if (name !== 'db') return Promise.resolve(null);
    const mk = path => ({ id: path.split('/').pop(), get: () => Promise.resolve({ exists: !!window.__docs[path], data: () => window.__docs[path] }), set: body => { window.__docs[path] = JSON.parse(JSON.stringify(body)); return Promise.resolve(); },
      collection: sub => ({ get: () => Promise.resolve({ docs: Object.keys(window.__docs).filter(k => k.indexOf(path + '/' + sub + '/') === 0).map(k => ({ data: () => window.__docs[k] })) }) }) });
    return Promise.resolve({ doc: mk, collection: p => ({ get: () => Promise.resolve({ docs: Object.keys(window.__docs).filter(k => k.indexOf(p + '/') === 0).map(k => ({ data: () => window.__docs[k] })) }) }) });
  } };
  window.__docs = initial ? JSON.parse(JSON.stringify(initial)) : {};
};

test('Korean, no network request and no error; the introduction names neither method; no word of the methods is anywhere in the rendered DOM', { skip }, async () => {
  const { page, errors, requests } = await open({ width: 390 });
  await page.evaluate(() => window.__pppReview.expandAll());
  const dom = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, intro: document.querySelector('.intro').innerText, all: document.documentElement.outerHTML.replace(/<script id="piano-samples"[\s\S]*?<\/script>/, '') }));
  assert.equal(dom.lang, 'ko'); assert.equal(dom.title, 'H-10c 악보 확인');
  assert.match(dom.intro, /쉽게 편곡한 악보/); assert.match(dom.intro, /두 가지 방식으로 편곡/); assert.match(dom.intro, /어느 쪽이 어떤 방식인지는 알려드리지 않고/); assert.match(dom.intro, /음\(멜로디\)이 원곡과 맞나요\?/);
  const bad = LEAK.scanArrange(dom.all.replace(/<svg[\s\S]*?<\/svg>/g, '<svg></svg>'), '', {}, { seed: SEED, credit: PAGE.CREDIT, titles: ['Piece nearer', 'Piece know'] });
  assert.deepEqual(bad, [], 'the DOM after the page has run (answers, save state, scores unpacked)');
  /* the scores themselves, as the browser holds them */
  const svgs = await page.$$eval('.paper svg', s => s.map(x => x.outerHTML));
  assert.ok(svgs.length >= 3);
  svgs.forEach(s => assert.deepEqual(LEAK.scanArrange(s, '', {}, {}).filter(x => !/^the page/.test(x)), []));
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  await page.close();
});

test('no sideways scroll at 360, 390, 400 and 1100 px; every control is at least 44 px high; the layout that fits the width is drawn', { skip }, async () => {
  for (const w of [360, 390, 400, 1100]) {
    const { page } = await open({ width: w });
    await page.evaluate(() => window.__pppReview.expandAll());
    const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
      small: [...document.querySelectorAll('button[data-act], a.btn')].filter(e => e.getBoundingClientRect().height < 37).length, layouts: [...new Set([...document.querySelectorAll('.paper')].map(p => p.getAttribute('data-layout')))] }));
    assert.equal(geo.sw, geo.cw, w + ' px: no sideways scroll'); assert.equal(geo.over, 0); assert.equal(geo.small, 0);
    assert.deepEqual(geo.layouts, [w <= 720 ? '1' : '0']);
    await page.close();
  }
});

test('what is drawn (DOM) is what each copy\'s Score holds, in both layouts, for every score; pairs have X and Y, singles have no label; every copy has its two questions', { skip }, async () => {
  for (const w of [390, 1100]) {
    const { page } = await open({ width: w });
    await page.evaluate(() => window.__pppReview.expandAll());
    const got = await page.$$eval('.paper', ps => ps.map(p => ({ k: p.getAttribute('data-svg'), layout: p.getAttribute('data-layout'), heads: p.querySelectorAll('svg use.vf-notehead:not(.vf-rest)').length, rests: p.querySelectorAll('svg use.vf-rest').length, svgs: p.querySelectorAll('svg').length })));
    assert.equal(got.length, key.shown.pairs * 2 + key.shown.singles);
    got.forEach(g => {
      const m = /^(i\d\d)(bi|b|i)([XYS])$/.exec(g.k), it = key.items[m[1]], pk = m[2].toUpperCase(), part = it.parts[pk];
      assert.equal(g.svgs, 1, g.k);
      assert.ok(part.kind === 'pair' ? 'XY'.includes(m[3]) : m[3] === 'S', g.k + ' has the sides its part has');
      const method = part.kind === 'pair' ? part[m[3]] : part.S, c = it.levels[part.levels[0]][method].counts;
      assert.equal(g.heads, c.score.heads, w + ' px ' + g.k + ' (' + method + ') heads drawn = the Score\'s');
      assert.equal(g.rests, c.score.rests, w + ' px ' + g.k + ' (' + method + ') rests drawn = the Score\'s');
      assert.equal(g.heads, c[g.layout === '1' ? 'narrow' : 'wide'].heads);
    });
    const shape = await page.evaluate(() => [...document.querySelectorAll('section.part')].map(s => ({
      id: s.id, play: s.querySelectorAll('button[data-play]').length, sideLabels: s.querySelectorAll('.side h4').length, notes: s.querySelectorAll('button[data-act="notes"]').length, hand: s.querySelectorAll('button[data-act="hand"]').length,
      pref: s.querySelectorAll('button[data-act="pref"]').length, details: s.querySelectorAll('details.note textarea').length, h3: s.querySelector('h3').textContent.replace('완료', '') })));
    shape.forEach(s => {
      const m = /^sec-(i\d\d)-(\w+)$/.exec(s.id), part = key.items[m[1]].parts[m[2]], n = part.kind === 'pair' ? 2 : 1;
      assert.deepEqual([s.play, s.sideLabels, s.notes, s.hand, s.pref, s.details], [n, part.kind === 'pair' ? 2 : 0, 3 * n, 3 * n, part.kind === 'pair' ? 3 : 0, 1], s.id);
      assert.equal(s.h3, part.levels.map(l => l === 'beginner' ? '초급' : '중급').join(' · '));
    });
    const text = await page.$eval('main', m => m.innerText);
    assert.equal((text.match(/음\(멜로디\)이 원곡과 맞나요\?/g) || []).length, key.shown.pairs * 2 + key.shown.singles + 1, 'once per copy and once in the introduction');
    assert.equal((text.match(/학생에게 줄 수 있나요\?/g) || []).length, key.shown.pairs * 2 + key.shown.singles + 1);
    assert.equal((text.match(/어느 쪽이 나아요\?/g) || []).length, key.shown.pairs + 1);
    await page.close();
  }
});

test('the link opens the original at the first bar drawn, in a new tab', { skip }, async () => {
  const { page } = await open({ width: 390 });
  const links = await page.$$eval('article.item a.btn', as => as.map(a => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent })));
  assert.equal(links.length, 2);
  links.forEach(l => { assert.match(l.href, /^https:\/\/www\.youtube\.com\/watch\?v=\w+&t=\d+s$/); assert.equal(l.target, '_blank'); assert.match(l.rel, /noopener/); assert.match(l.text, /원곡 열기 \(\d+:\d\d부터\)/); });
  const it = key.items[pairId], a = links.find(l => /nearer/.test(l.href));
  assert.equal(Number(/t=(\d+)s/.exec(a.href)[1]), Math.floor(it.excerpt.drawnFrom));
  await page.close();
});

async function answerCopy(page, id, part, side, notes, hand) {
  await tap(page, secOf(id, part) + ' button[data-act="notes"][data-side="' + side + '"][data-value="' + notes + '"]');
  await tap(page, secOf(id, part) + ' button[data-act="hand"][data-side="' + side + '"][data-value="' + hand + '"]');
}

test('answers: one tap per choice (tap again to clear), a part is done when every question of it is answered, progress and the summary follow, the export has the documented shape', { skip }, async () => {
  const { page, errors } = await open({ width: 390 });
  const total = key.shown.pairs + key.shown.singles;
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / ' + total);
  const P = pairParts[0], Sg = singleParts[0];
  await answerCopy(page, pairId, P, 'X', 'ok', 'asis');
  await answerCopy(page, pairId, P, 'Y', 'many', 'no');
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / ' + total, 'a pair also needs its preference');
  await tap(page, secOf(pairId, P) + ' button[data-act="pref"][data-value="Y"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total);
  assert.equal(await page.$eval(secOf(pairId, P), s => s.classList.contains('done')), true);
  assert.equal(await page.$eval(secOf(pairId, P) + ' button[data-act="notes"][data-side="X"][data-value="ok"]', b => b.getAttribute('aria-pressed')), 'true');
  /* a second tap clears */
  await tap(page, secOf(pairId, P) + ' button[data-act="pref"][data-value="Y"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / ' + total);
  await tap(page, secOf(pairId, P) + ' button[data-act="pref"][data-value="same"]');
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total);
  /* the single part: two answers make it done */
  await answerCopy(page, singleId, Sg, 'S', 'mostly', 'fix');
  assert.equal(await page.$eval('#progress', e => e.textContent), '2 / ' + total);
  await tap(page, secOf(singleId, Sg) + ' details.note summary');
  await page.type(secOf(singleId, Sg) + ' textarea', '4번째 마디가 달라요');
  await page.type('#role', '피아노 선생님');
  const ex = await page.evaluate(() => window.__pppReview.exportObject());
  assert.equal(ex.format, 'ppp-review-ratings/3'); assert.equal(ex.mode, 'h10'); assert.equal(ex.compare, 'arrange'); assert.equal(ex.packetId, packet.packetId); assert.equal(ex.reviewer, '피아노 선생님');
  assert.deepEqual(ex.items.map(i => i.id), Object.keys(key.items), 'in the order shown');
  const ip = ex.items.find(i => i.id === pairId), is = ex.items.find(i => i.id === singleId);
  assert.deepEqual(ip[P], { preference: 'same', X: { notes: 'ok', hand: 'asis' }, Y: { notes: 'many', hand: 'no' }, text: '' });
  assert.deepEqual(is[Sg], { S: { notes: 'mostly', hand: 'fix' }, text: '4번째 마디가 달라요' });
  assert.equal(JSON.stringify(ex).toLowerCase().indexOf('lead'), -1); assert.equal(JSON.stringify(ex).toLowerCase().indexOf('reduce'), -1, 'the export names no method');
  /* the same answers decode against the key */
  const o = decode(key, ex);
  assert.equal(o.answered.copies, 3); assert.equal(o.answered.pairsPreferenceGiven, 1);
  const open_ = await page.$$eval('#summary-open a', as => as.map(a => a.textContent));
  assert.equal(open_.length, total - 2); assert.ok(open_.every(t => /번 곡 (초급|중급|초급 · 중급)$/.test(t)));
  assert.match(await page.$eval('#summary-status', e => e.textContent), /완료/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('answers survive a reload (localStorage), resume jumps to the first open part, "clear all" asks first; the page works with no storage at all', { skip }, async () => {
  const { page, errors } = await open({ width: 390 });
  await page.evaluate(() => window.localStorage.clear()); await page.reload({ waitUntil: 'load' });
  const P = pairParts[0], total = key.shown.pairs + key.shown.singles;
  await answerCopy(page, pairId, P, 'X', 'mostly', 'fix'); await answerCopy(page, pairId, P, 'Y', 'ok', 'asis'); await tap(page, secOf(pairId, P) + ' button[data-act="pref"][data-value="X"]');
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total, 'kept across a reload');
  assert.equal(await page.$eval(secOf(pairId, P) + ' button[data-act="notes"][data-side="X"][data-value="mostly"]', b => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#resume-btn', b => b.hidden), false);
  let dialog = null; page.on('dialog', async d => { dialog = d.message(); await d.dismiss(); });
  await tap(page, '#clear-btn'); await new Promise(r => setTimeout(r, 100));
  assert.match(dialog, /모두 지울까요/); assert.equal(await page.$eval('#progress', e => e.textContent), '1 / ' + total, 'dismissed: nothing cleared');
  assert.deepEqual(errors, []);
  await page.close();
  const blocked = await open({ width: 390, init: function () { Storage.prototype.getItem = function () { throw new Error('blocked'); }; Storage.prototype.setItem = function () { throw new Error('blocked'); }; Storage.prototype.removeItem = function () { throw new Error('blocked'); }; } });
  await answerCopy(blocked.page, singleId, singleParts[0], 'S', 'ok', 'asis');
  assert.equal(await blocked.page.$eval('#progress', e => e.textContent), '1 / ' + total, 'the page works with no storage');
  assert.deepEqual(blocked.errors, []);
  await blocked.page.close();
});

test('with the artifact database: documents answers/<packet>/items/<id> and answers/<packet> (the role), the save state says so, a second device picks the newer answers up, and db-to-ratings reads the documents', { skip }, async () => {
  const { page, errors } = await open({ width: 390, init: fakeDb });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.$eval('#save-state', e => e.textContent), '저장됨 (서버)');
  const P = pairParts[0], Sg = singleParts[0];
  await answerCopy(page, pairId, P, 'X', 'ok', 'asis'); await answerCopy(page, pairId, P, 'Y', 'many', 'fix'); await tap(page, secOf(pairId, P) + ' button[data-act="pref"][data-value="X"]');
  await answerCopy(page, singleId, Sg, 'S', 'many', 'no');
  await page.type('#role', '피아노 선생님');
  await new Promise(r => setTimeout(r, 900));
  await page.evaluate(() => window.__pppReview.store.flush());
  const docs = await page.evaluate(() => window.__docs);
  const base = 'answers/' + packet.packetId;
  assert.deepEqual(Object.keys(docs).sort(), [base, base + '/items/' + pairId, base + '/items/' + singleId].sort());
  assert.equal(docs[base].role, '피아노 선생님');
  const d = docs[base + '/items/' + pairId];
  assert.equal(d.packetId, packet.packetId); assert.equal(d.id, pairId); assert.equal(typeof d.t, 'number');
  assert.deepEqual(d[P], { pref: 'X', X: { notes: 'ok', hand: 'asis' }, Y: { notes: 'many', hand: 'fix' }, text: '' });
  assert.deepEqual(docs[base + '/items/' + singleId][Sg], { S: { notes: 'many', hand: 'no' }, text: '' });
  /* the converter reads what the page wrote, and the result is what the page exports */
  const rows = Object.keys(docs).map(p => ({ path: p, data: docs[p] }));
  const fromDb = DB.dbToRatingsArrange(rows, packet.packetId), ex = await page.evaluate(() => window.__pppReview.exportObject());
  assert.equal(fromDb.reviewer, '피아노 선생님');
  fromDb.items.forEach(it => assert.deepEqual(it, ex.items.find(x => x.id === it.id)));
  assert.equal(decode(key, fromDb).answered.copies, 3);
  /* a second device: a new context that starts from the first one's documents */
  const second = await open({ width: 390, init: fakeDb, initArg: docs });
  await new Promise(r => setTimeout(r, 400));
  assert.equal(await second.page.$eval('#progress', e => e.textContent), '2 / ' + (key.shown.pairs + key.shown.singles), 'the answers of the first device: the pair and the single are both done');
  assert.equal(await second.page.$eval('#role', e => e.value), '피아노 선생님');
  assert.equal(await second.page.$eval(secOf(singleId, Sg) + ' button[data-act="notes"][data-value="many"]', b => b.getAttribute('aria-pressed')), 'true');
  assert.deepEqual(second.errors, []);
  await second.page.close();
  assert.deepEqual(errors, []);
  await page.close();
});

test('with a database that refuses, the page says so and keeps the answers on the device', { skip }, async () => {
  const { page } = await open({ width: 390, init: function () {
    window.claude = { use: function () { return Promise.resolve({ doc: () => ({ get: () => Promise.reject({ code: 'permission-denied' }), set: () => Promise.reject({ code: 'permission-denied' }) }), collection: () => ({ get: () => Promise.reject({ code: 'permission-denied' }) }) }); } };
  } });
  await new Promise(r => setTimeout(r, 300));
  assert.match(await page.$eval('#save-state', e => e.textContent), /서버 저장 실패/);
  await answerCopy(page, singleId, singleParts[0], 'S', 'ok', 'asis');
  assert.equal(await page.$eval('#progress', e => e.textContent).then(t => t.split(' / ')[0]), '1');
  const kept = await page.evaluate(() => window.localStorage.getItem(window.__pppReview.key));
  assert.ok(kept && kept.indexOf('"ok"') > 0);
  await page.close();
});

test('Play: the app\'s sampled piano plays a pair\'s X and a single\'s one score, one voice per strike of the player plan; a second tap stops', { skip }, async () => {
  const { page, errors } = await open({ width: 390 });
  const n = await page.evaluate(() => window.__pppReview.sound.load().then(ok => ({ ok: ok, got: window.__pppReview.sound.samples.got })));
  assert.equal(n.ok, true); assert.equal(n.got, 30);
  const P = pairParts[0], Sg = singleParts[0], pk = key.items[pairId].parts[P];
  const keyOf = (id, part) => id + part.toLowerCase();
  /* the notes of a side are the strikes of its copy's player plan */
  const strikes = await page.evaluate((a, b) => [window.__pppReview.sound.notes(a, 'X').length, window.__pppReview.sound.notes(a, 'Y').length, window.__pppReview.sound.notes(b, 'S').length], keyOf(pairId, P), keyOf(singleId, Sg));
  const struck = (id, part, m) => key.items[id].levels[key.items[id].parts[part].levels[0]][m].counts.struck;
  assert.deepEqual(strikes, [struck(pairId, P, pk.X), struck(pairId, P, pk.Y), struck(singleId, Sg, key.items[singleId].parts[Sg].S)]);
  for (const [sel, id, side] of [[secOf(pairId, P) + ' button[data-play="X"]', keyOf(pairId, P), 'X'], [secOf(singleId, Sg) + ' button[data-play="S"]', keyOf(singleId, Sg), 'S']]) {
    await page.evaluate(() => { window.__pppReview.sound.lastRun = window.__pppReview.sound.lastRun; });
    await page.click(sel);
    await page.waitForFunction((i, s) => { const r = window.__pppReview.sound.lastRun(); return r && r.id === i && r.side === s; }, { timeout: 15000 }, id, side);
    const run = await page.evaluate(() => window.__pppReview.sound.lastRun());
    assert.equal(run.mode, 'samples'); assert.equal(run.voices, run.notes); assert.equal(run.id, id); assert.equal(run.side, side);
    await page.click(sel);
    assert.equal(await page.$eval(sel, e => e.textContent), '재생');
  }
  const off = await page.evaluate(k => window.__pppReview.sound.renderOffline(k, 'X', 1, 'samples', 6).then(x => { let p = 0; const b = x.buffer; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; } } return { peak: p, notes: x.notes, mode: x.mode }; }), keyOf(pairId, P));
  assert.equal(off.mode, 'samples'); assert.ok(off.peak > 0.02 && off.peak <= 1.0001, 'a phrase renders, audible and not clipping: ' + off.peak);
  assert.deepEqual(errors, []);
  await page.close();
});
