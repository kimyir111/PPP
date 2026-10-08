'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'Piano Coach App.dc.html'), 'utf8');
const urls = [...page.split('</head>')[0].matchAll(/<script src="([^\"]+)"/g)]
  .map(m => m[1]).filter(s => /^\.\/(?:scoregraph|playability|difficulty|songgraph|arrangement|realize|engrave)\/|^\.\/audio-score\.js/.test(s));
const loader = page.slice(page.indexOf('let _scoreModulesPromise = null;'), page.indexOf('const SINGLE_SCRIPTS = ['));
const heard = require('../recording-v2-fixtures').keyChange([[8, 0]], 3, 0.004);

/* Run the shipped UMD scripts, including the consumers that captured a failed
   dependency at boot. The fake head delivers dynamic scripts in async=false
   order and can fail downloads, serve an empty 200, or leave a request pending. */
function boot(missing) {
  const requests = [], elements = [], stalled = [], errors = [];
  let fail = () => false, empty = () => false, stall = () => false;
  const ctx = vm.createContext({ console, setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? 30 : ms), clearTimeout });
  ctx.window = ctx;
  function run(src) {
    const file = src.replace(/^\.\//, '').split('?')[0];
    try { vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file }); }
    catch (e) { errors.push(e); }
  }
  for (const src of urls) if (!src.includes(missing || '\0')) run(src);
  ctx.document = {
    createElement() { return { setAttribute() {}, remove() {} }; },
    head: {
      querySelectorAll() { return urls.map(src => ({ getAttribute: () => src })); },
      appendChild(el) {
        assert.equal(el.async, false);
        requests.push(el.src); elements.push(el);
        const deliver = () => {
          if (fail(el.src)) el.onerror();
          else { if (!empty(el.src)) run(el.src); el.onload(); }
        };
        if (stall(el.src)) stalled.push(deliver);
        else queueMicrotask(deliver);
      }
    }
  };
  vm.runInContext(loader, ctx);
  return { ctx, requests, elements, errors, stalled,
    fail: fn => { fail = fn; }, empty: fn => { empty = fn; }, stall: fn => { stall = fn; } };
}

function converts(b) {
  const actual = b.ctx.PPPAudioScore.toMusicXml(heard, { title: 'Recovery', closeGaps: true, exactBars: true });
  const expected = require('../../audio-score').toMusicXml(heard, { title: 'Recovery', closeGaps: true, exactBars: true });
  assert.equal(actual.xml, expected.xml);
  assert.equal(b.ctx.PPPScoreGraph.validate(actual.graph).ok, true);
  assert.ok(b.ctx.PPPSongGraph.analyze(actual.graph).ref);
  assert.ok(b.ctx.PPPEngrave.plan(actual.graph));
}

test('healthy page adds no requests and keeps its notation unchanged', async () => {
  const b = boot();
  assert.equal(await b.ctx.loadScoreModules(), true);
  assert.equal(b.requests.length, 0);
  converts(b);
});

for (const missing of ['scoregraph/rational.js', 'scoregraph/musicxml-export.js', 'scoregraph/index.js', 'audio-score.js']) {
  test('a failed boot download recovers without a page reload: ' + missing, async () => {
    const b = boot(missing);
    assert.equal(b.ctx.scoreModulesReady(), false);
    assert.equal(await b.ctx.loadScoreModules(), true);
    assert.equal(b.requests.length, urls.length);
    assert.ok(b.requests.every(s => s.includes('retry=')));
    converts(b);
    assert.equal(await b.ctx.loadScoreModules(), true);
    assert.equal(b.requests.length, urls.length);
  });
}

test('concurrent imports share recovery until every consumer has run', async () => {
  const b = boot('scoregraph/index.js');
  b.stall(src => src.includes('engrave/index.js'));
  const p = b.ctx.loadScoreModules(), q = b.ctx.loadScoreModules();
  await Promise.resolve();
  assert.equal(b.requests.length, urls.length);
  b.stalled.forEach(fn => fn());
  assert.equal(await p, true);
  assert.equal(await q, true);
  converts(b);
});

test('a failed recovery can be retried after the network returns', async () => {
  const b = boot('scoregraph/rational.js');
  b.fail(src => src.includes('scoregraph/rational.js'));
  assert.equal(await b.ctx.loadScoreModules(), false);
  b.fail(() => false);
  assert.equal(await b.ctx.loadScoreModules(), true);
  assert.equal(b.requests.length, urls.length * 2);
  converts(b);
});

test('an empty 200 response does not count as a restored score engine', async () => {
  const b = boot('scoregraph/index.js');
  b.empty(src => src.includes('scoregraph/index.js'));
  assert.equal(await b.ctx.loadScoreModules(), false);
  b.empty(() => false);
  assert.equal(await b.ctx.loadScoreModules(), true);
  converts(b);
});

test('a stalled recovery releases callers and keeps sharing the late download', async () => {
  const b = boot('scoregraph/index.js');
  b.stall(() => true);
  assert.equal(await b.ctx.loadScoreModules(), false);
  assert.equal(await b.ctx.loadScoreModules(), false);
  assert.equal(b.requests.length, urls.length);
  b.stalled.forEach(fn => fn());
  assert.equal(await b.ctx.loadScoreModules(), true);
  assert.equal(b.requests.length, urls.length);
  converts(b);
});
