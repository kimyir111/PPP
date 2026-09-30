/* G9c: the reviewer page in a real browser (headless Chrome via puppeteer): both scores render, the form works, ratings survive a
   reload, export is valid JSON, playback starts and stops, nothing is requested from the network, and the page still works when
   the browser refuses storage. The sound is the app's sampled piano: all 30 recordings are embedded once and decode, Play schedules one voice per
   note, the plain synth takes over when decoding fails, a phrase renders offline without clipping, and the page works as an Artifact-style
   fragment with every request blocked. Skipped (with a reason) if puppeteer cannot be found. Audio is started, stopped and rendered offline,
   not heard. */
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
  if (opts && opts.init) await page.evaluateOnNewDocument(opts.init);
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
  await page.goto(opts && opts.url ? opts.url : url, { waitUntil: 'load' });
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

const PLAY = id => 'article[data-item="' + id + '"] button[data-play="X"]';
const textOf = async (page, sel) => page.$eval(sel, e => e.textContent);
const waitText = (page, sel, text) => page.waitForFunction((sel, text) => document.querySelector(sel).textContent === text, { timeout: 20000 }, sel, text);

test('Play starts and Stop stops a sampled-piano playback without an error (the recordings load on the first press; audio itself is not heard here)', { skip }, async () => {
  const { page, errors, requests } = await open();
  await page.click('article[data-item="i01"] button[data-play="X"]');
  await waitText(page, PLAY('i01'), '정지');
  /* starting the other one stops the first */
  await page.click('article[data-item="i01"] button[data-play="Y"]');
  assert.equal(await textOf(page, PLAY('i01')), '재생');
  await waitText(page, 'article[data-item="i01"] button[data-play="Y"]', '정지');
  await page.click('article[data-item="i01"] button[data-play="Y"]');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="Y"]', e => e.textContent), '재생');
  assert.equal(await page.$eval('article[data-item="i01"] button[data-play="Y"]', e => e.getAttribute('aria-pressed')), 'false');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await page.close();
});

test('the piano samples: embedded once, all 30 decode to real recordings (the first press shows the loading label), one voice is scheduled per note, the note list is the packet list', { skip }, async () => {
  const html = fs.readFileSync(packet.files.html, 'utf8');
  assert.equal((html.match(/id="piano-samples"/g) || []).length, 1, 'one sample block per page, not per item');
  const { page, errors, requests } = await open();
  await page.evaluate(() => { window.__texts = []; const b = document.querySelector('article[data-item="i01"] button[data-play="X"]'); new MutationObserver(() => window.__texts.push(b.textContent)).observe(b, { childList: true, characterData: true, subtree: true }); });
  assert.equal(await page.evaluate(() => window.__pppReview.sound.samples.done), false, 'nothing is decoded before the first Play (no audio work at page load)');
  await page.click(PLAY('i01'));
  await waitText(page, PLAY('i01'), '정지');
  const r = await page.evaluate(() => {
    const S = window.__pppReview.sound, list = S.samples.list;
    return { texts: window.__texts, got: S.samples.got, last: S.lastRun(), notes: S.notes('i01', 'X'),
      bufs: list.map(s => { if (!s) return null; const d = s.buffer.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; } return { dur: s.buffer.duration, peak: pk, ch: s.buffer.numberOfChannels, onset: s.onset }; }) };
  });
  assert.equal(r.texts[0], '소리 불러오는 중...', 'the button says the sound is loading while it decodes');
  assert.equal(r.texts[r.texts.length - 1], '정지');
  assert.equal(r.got, 30); assert.equal(r.bufs.length, 30);
  r.bufs.forEach((b, k) => { assert.ok(b, 'sample ' + k + ' decoded'); assert.ok(b.dur > 3 && b.dur < 9.5, 'sample ' + k + ' plausible length ' + b.dur); assert.ok(b.peak > 0.05 && b.peak <= 1.0, 'sample ' + k + ' has sound: ' + b.peak); assert.ok(b.onset >= 0 && b.onset < 0.1, 'hammer onset ' + b.onset); });
  assert.equal(r.last.mode, 'samples'); assert.equal(r.last.voices, r.notes.length); assert.ok(r.notes.length > 20);
  /* the page's note list is exactly the packet's [startQ, durQ, midi] list */
  const data = JSON.parse(html.match(/<script id="packet-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(r.notes, data.items.i01.X);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await page.close();
});

test('the nearest-recording pick is the app pick (one every minor third from A0, pitched by at most a semitone)', { skip }, async () => {
  const { page } = await open();
  await page.evaluate(() => window.__pppReview.sound.load());
  const picks = await page.evaluate(() => { const S = window.__pppReview.sound, out = []; for (let m = 21; m <= 108; m++) { const p = S.pick(m); out.push([m, Math.round(12 * Math.log2(p.rate) * 1000) / 1000]); } return out; });
  picks.forEach(([m, semis]) => assert.ok(Math.abs(semis) <= 1.0001, 'key ' + m + ' pitched ' + semis + ' semitones'));
  assert.equal(picks.find(p => p[0] === 21)[1], 0);
  assert.equal(picks.find(p => p[0] === 60)[1], 0, 'middle C has its own recording');
  assert.equal(picks.find(p => p[0] === 61)[1], 1, 'C#4 is C4 up a semitone');
  assert.equal(picks.find(p => p[0] === 62)[1], -1, 'D4 is Ds4 down a semitone');
  await page.close();
});

test('every speed and both sides play through the sampler, one voice per note', { skip }, async () => {
  const { page, errors } = await open();
  for (const [id, side, sp] of [['i01', 'X', '0.6'], ['i01', 'Y', '0.8'], ['i02', 'X', '1'], ['i02', 'Y', '0.6']]) {
    await page.select('article[data-item="' + id + '"] select[data-speed="' + side + '"]', sp);
    const sel = 'article[data-item="' + id + '"] button[data-play="' + side + '"]';
    await page.click(sel); await waitText(page, sel, '정지');
    const lr = await page.evaluate(() => window.__pppReview.sound.lastRun());
    assert.equal(lr.mode, 'samples'); assert.equal(lr.id, id); assert.equal(lr.side, side);
    assert.equal(lr.voices, await page.evaluate((id, side) => window.__pppReview.sound.notes(id, side).length, id, side));
    await page.click(sel); assert.equal(await textOf(page, sel), '재생');
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('stopping while the sound is still loading cancels that play (nothing starts afterwards)', { skip }, async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { const o = window.OfflineAudioContext.prototype.decodeAudioData; window.OfflineAudioContext.prototype.decodeAudioData = function () { const a = arguments, self = this; return new Promise(r => setTimeout(r, 400)).then(() => o.apply(self, a)); }; });
  await page.click(PLAY('i01'));
  assert.equal(await textOf(page, PLAY('i01')), '소리 불러오는 중...');
  await page.click(PLAY('i01'));
  assert.equal(await textOf(page, PLAY('i01')), '재생');
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(await textOf(page, PLAY('i01')), '재생', 'it did not start after the stop');
  assert.equal(await page.evaluate(() => window.__pppReview.sound.lastRun()), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('if the recordings cannot be decoded the plain synth plays the same notes (a note is never silent)', { skip }, async () => {
  /* decodeAudioData refuses everything */
  const { page, errors, requests } = await open({ init: function () { const fail = function () { return Promise.reject(new Error('decode refused')); }; ['BaseAudioContext', 'OfflineAudioContext', 'AudioContext'].forEach(function (n) { if (window[n]) window[n].prototype.decodeAudioData = fail; }); } });
  await page.click(PLAY('i01'));
  await waitText(page, PLAY('i01'), '정지');
  const r = await page.evaluate(() => ({ last: window.__pppReview.sound.lastRun(), got: window.__pppReview.sound.samples.got, n: window.__pppReview.sound.notes('i01', 'X').length }));
  assert.equal(r.got, 0); assert.equal(r.last.mode, 'synth'); assert.equal(r.last.voices, r.n);
  await page.click(PLAY('i01')); assert.equal(await textOf(page, PLAY('i01')), '재생');
  const off = await page.evaluate(async () => { const x = await window.__pppReview.sound.renderOffline('i01', 'X', 1, 'samples', 6); const d = x.buffer.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return { mode: x.mode, peak: pk }; });
  assert.equal(off.mode, 'synth'); assert.ok(off.peak > 0.05, 'the synth fallback is not silent');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await page.close();
  /* a page with no sample block at all does the same */
  const { page: p2, errors: e2 } = await open();
  await p2.evaluate(() => { document.getElementById('piano-samples').remove(); });
  await p2.click(PLAY('i02')); await waitText(p2, PLAY('i02'), '정지');
  assert.equal((await p2.evaluate(() => window.__pppReview.sound.lastRun())).mode, 'synth');
  assert.deepEqual(e2, []);
  await p2.close();
});

test('one corrupted recording: a neighbour is pitched to cover its keys and the others still play (not the synth)', { skip }, async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { const el = document.getElementById('piano-samples'), a = JSON.parse(el.textContent); a[17] = 'AAAA'; el.textContent = JSON.stringify(a); });
  await page.click(PLAY('i01')); await waitText(page, PLAY('i01'), '정지');
  const r = await page.evaluate(() => { const S = window.__pppReview.sound; return { got: S.samples.got, last: S.lastRun(), semis: 12 * Math.log2(S.pick(72).rate) }; });
  assert.equal(r.got, 29); assert.equal(r.last.mode, 'samples');
  assert.ok(Math.abs(Math.abs(r.semis) - 3) < 1e-6, 'C5 is covered by a neighbour three semitones away: ' + r.semis);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a phrase rendered offline through the sampler (the code Play uses) is audible and does not clip, and is not the synth', { skip }, async () => {
  const { page } = await open();
  const out = {};
  for (const mode of ['samples', 'synth']) {
    out[mode] = await page.evaluate(async (mode) => {
      const x = await window.__pppReview.sound.renderOffline('i01', 'X', 1, mode, 12);
      const d = x.buffer.getChannelData(0); let pk = 0, sum = 0, clip = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; sum += d[i] * d[i]; if (a >= 0.999) clip++; }
      /* brightness: the share of the energy in the first difference (a crude high-pass) */
      let hp = 0; for (let i = 1; i < d.length; i++) { const v = d[i] - d[i - 1]; hp += v * v; }
      return { mode: x.mode, voices: x.voices, notes: x.notes, peak: pk, rms: Math.sqrt(sum / d.length), clip: clip, hf: hp / sum };
    }, mode);
  }
  assert.equal(out.samples.mode, 'samples'); assert.equal(out.synth.mode, 'synth');
  assert.equal(out.samples.voices, out.samples.notes); assert.ok(out.samples.notes > 10);
  assert.ok(out.samples.peak > 0.1 && out.samples.peak < 0.999 && out.samples.clip === 0, 'audible and not clipping: ' + JSON.stringify(out.samples));
  assert.ok(out.samples.rms > 0.02, 'not near-silent: ' + out.samples.rms);
  assert.ok(Math.abs(out.samples.hf - out.synth.hf) > 0.0001 || Math.abs(out.samples.rms - out.synth.rms) > 0.001, 'it is not the synth');
  await page.close();
});

test('as an Artifact-style fragment (no doctype, html, head or body tags) with every request blocked: the page works, plays and remembers', { skip }, async () => {
  const html = fs.readFileSync(packet.files.html, 'utf8');
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0], body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const fragment = style + body;
  assert.ok(!/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(fragment));
  const f = path.join(tmpDir('frag'), 'wrapped.html');
  fs.writeFileSync(f, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fragment + '</body></html>');
  const { page, errors, requests } = await open({ url: pathToFileURL(f).href, init: function () {
    window.fetch = function () { throw new Error('fetch is blocked'); };
    window.XMLHttpRequest = function () { throw new Error('XHR is blocked'); };
  } });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '0 / 2 문항 평가함');
  await page.click(PLAY('i02')); await waitText(page, PLAY('i02'), '정지');
  const lr = await page.evaluate(() => window.__pppReview.sound.lastRun());
  assert.equal(lr.mode, 'samples'); assert.equal(await page.evaluate(() => window.__pppReview.sound.samples.got), 30);
  await page.click(PLAY('i02'));
  await page.click('input[name="pref-i01"][value="X"]');
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#progress', e => e.textContent), '1 / 2 문항 평가함');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await page.evaluate(() => window.localStorage.clear());
  await page.close();
});

/* a spy for the audio calls, installed before the page's own script runs */
const SPY = function () {
  window.__log = []; window.__gainHolds = 0; window.__srcStarts = [];
  const log = (...a) => window.__log.push(a.join(':'));
  const AC0 = window.AudioContext;
  window.AudioContext = class extends AC0 {
    constructor(...a) { super(...a); log('ctor'); }
    resume() { log('resume'); return super.resume(); }
    createBufferSource() {
      const src = super.createBufferSource(), start = src.start.bind(src), ctx = this;
      src.start = function (when, off) { log('start', src.buffer ? src.buffer.length : 'none'); window.__srcStarts.push({ len: src.buffer ? src.buffer.length : 0, when: when, at: ctx.currentTime }); return start.apply(null, arguments); };
      return src;
    }
    createConvolver() { const c = super.createConvolver(); const t = performance.now(); while (performance.now() - t < 150); window.__convolverDoneAt = this.currentTime; log('player-built'); return c; }
  };
  const dec = OfflineAudioContext.prototype.decodeAudioData;
  OfflineAudioContext.prototype.decodeAudioData = function () { const p = dec.apply(this, arguments); p.then(() => log('decode-done'), () => {}); return p; };
  const hold = AudioParam.prototype.cancelAndHoldAtTime;
  if (hold) AudioParam.prototype.cancelAndHoldAtTime = function () { window.__gainHolds++; return hold.apply(this, arguments); };
};

test('iOS unlock: the AudioContext is created and a silent buffer is started synchronously inside the tap, before the recordings decode', { skip }, async () => {
  const { page, errors } = await open({ init: SPY });
  const sync = await page.evaluate(() => { document.querySelector('article[data-item="i01"] button[data-play="X"]').click(); return window.__log.slice(); });
  assert.ok(sync.includes('ctor'), 'the context was made in the tap: ' + JSON.stringify(sync));
  assert.ok(sync.includes('start:1'), 'a one-frame silent buffer was started in the tap: ' + JSON.stringify(sync));
  assert.ok(sync.indexOf('ctor') < sync.indexOf('start:1'));
  assert.ok(!sync.includes('decode-done') && !sync.includes('player-built'), 'nothing of the decode or the player had happened yet');
  await waitText(page, PLAY('i01'), '정지');
  const all = await page.evaluate(() => window.__log.slice());
  assert.ok(all.indexOf('decode-done') > all.indexOf('start:1'), 'the decode finished after the unlock: ' + JSON.stringify(all));
  assert.equal(all.filter(x => x === 'ctor').length, 1);
  /* a second press reuses the context and unlocks again in its own tap */
  await page.click(PLAY('i01'));
  const again = await page.evaluate(() => { const n0 = window.__log.length; document.querySelector('article[data-item="i01"] button[data-play="X"]').click(); return window.__log.slice(n0); });
  assert.ok(again.includes('start:1') && !again.includes('ctor'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('the lead before the first note is taken after the player and decode are ready (a slow player build cannot make the first chord late)', { skip }, async () => {
  const { page, errors } = await open({ init: SPY });
  await page.click(PLAY('i01')); await waitText(page, PLAY('i01'), '정지');
  const r = await page.evaluate(() => ({ built: window.__convolverDoneAt, real: window.__srcStarts.filter(s => s.len > 1000) }));
  assert.ok(r.real.length > 20, 'the notes were started');
  const first = Math.min(...r.real.map(s => s.when));
  assert.ok(first >= r.built + 0.119, 'first note at ' + first + ' is at least 0.12 s after the player was built at ' + r.built);
  r.real.forEach(s => assert.ok(s.when >= s.at, 'no note is started in the past'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('a phrase that plays to its end is not cut by a final silence (the last high notes ring out their damper release); Stop still silences', { skip }, async () => {
  const { page, errors } = await open({ init: '(' + SPY.toString() + ')();' +
    /* only the long end-of-phrase timer is hurried, so the natural end can be seen */
    'window.__st = window.setTimeout; window.setTimeout = function (f, ms) { return window.__st.call(window, f, ms > 2000 ? 300 : ms); };' });
  await page.click(PLAY('i01')); await waitText(page, PLAY('i01'), '정지');
  const scheduled = await page.evaluate(() => window.__gainHolds);
  assert.ok(scheduled >= await page.evaluate(() => window.__pppReview.sound.lastRun().voices), 'at least one damper release per note while scheduling (a re-struck key also stops its old string)');
  await waitText(page, PLAY('i01'), '재생');
  assert.equal(await page.evaluate(() => window.__gainHolds), scheduled, 'the natural end released nothing more: no silence() cut the tail');
  assert.equal(await page.$eval(PLAY('i01'), e => e.getAttribute('aria-pressed')), 'false');
  /* pressing Stop during a play does call silence (the spy sees the extra releases) */
  await page.evaluate(() => { window.setTimeout = function () { return 0; }; });
  await page.click(PLAY('i01')); await waitText(page, PLAY('i01'), '정지');
  await new Promise(r => setTimeout(r, 1500));     /* some notes are sounding by now */
  const before = await page.evaluate(() => window.__gainHolds);
  await page.click(PLAY('i01'));
  assert.ok(await page.evaluate(() => window.__gainHolds) > before, 'Stop released the sounding voices');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the page credits the piano recordings (CC BY 3.0) in Korean and English at the bottom, with no link', { skip }, async () => {
  const { page } = await open();
  const r = await page.evaluate(() => { const f = document.querySelector('footer.credit'); return { text: f.innerText, last: f === document.querySelector('main').lastElementChild, english: !!f.querySelector('[lang="en"]') }; });
  assert.ok(r.last, 'the credit is the last thing on the page');
  assert.ok(/피아노 소리/.test(r.text) && /Salamander/.test(r.text) && /Alexander Holm/.test(r.text) && /CC BY 3\.0/.test(r.text) && /Piano sound/.test(r.text) && r.english);
  assert.ok(!/https?:|\/\//.test(r.text));
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
