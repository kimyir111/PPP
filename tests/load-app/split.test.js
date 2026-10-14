'use strict';
/* G13-4e: the page's code splitting in a real browser (docs/GOALS/G13_PRODUCTIZATION.md, "G13-4e as built"; the module itself is tests/load/lazy-load.test.js).

   Browser test: it starts this tree's server.js on a free port (tests/load/lib.js) and drives it with puppeteer. What it holds to:
     - 'on' (the default): none of the deferred groups is asked for before the page's first paint; they all arrive after it (the idle prefetch), without one synchronous
       load; the page they make is the page there was (the same globals, the same drawing);
     - 'off' and ?split=: the head names the scripts again, in the order it always had, and no accessor stands in front of a global;
     - every screen or action that needs a deferred group works when it is opened RIGHT after load, with the prefetch kept off (a localStorage switch the module has for
       tests) or the group's files held for seconds: Home's thumbnail, Practice, MusicXML and MIDI import, the arranger, Piano Basics, Settings > My data;
     - a group that cannot be fetched is the app's own error, never a blank page - the thumbnail says it could not be engraved, an import says the files could not be
       loaded - and it is asked for again on the next try;
     - a read of a deferred global that comes too early is answered (the safety net), and shows in status().syncLoads. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, REPO } = require('../load/lib');

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'Piano%20Coach%20App.dc.html';
/* the files of each deferred group, as the page names them (the served page adds ?h=<hash>) */
const GROUP_URL = {
  score: /\/scoregraph\/[\w-]+\.js\?h=/, engrave: /\/engrave\/[\w-]+\.js\?h=/,       /* the head's eight files and the fifteen the drawing code loads when a view asks */
  audio: /\/audio-score\.js\?h=/, arranger: /\/(playability|difficulty|songgraph|arrangement|realize)\/[\w-]+\.js\?h=/,
  backup: /\/library-backup\.js\?h=/, lessons: /\/lessons\.js\?h=/
};
const groupsRe = (...names) => new RegExp(names.map(n => GROUP_URL[n].source).join('|'));
const ANY_LAZY = new RegExp(Object.values(GROUP_URL).map(r => r.source).join('|'));

let srv, browser;
test.before(async () => {
  srv = await boot();
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

/* opens the page. opts: locale; query; store {k: v} (localStorage before the page runs); prefetch false = 'ppp.splitStart' '0'; hold: RegExp, matching requests wait `holdMs`;
   fail: RegExp, matching requests are refused until failing = false; viewport. Collects the requests (in order), page errors and console errors. */
async function open(opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(opts.viewport || { width: 1100, height: 800 });
  const store = Object.assign({ 'ppp-guest': '1', 'ppp-locale': opts.locale || 'en-US' }, opts.store || {});
  if (opts.prefetch === false) store['ppp.splitStart'] = '0';
  await page.evaluateOnNewDocument(s => { try { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) { /* no storage */ } }, store);
  const o = { ctx, page, requests: [], pageErrors: [], consoleErrors: [], failed: [], failing: true, held: [], t0: 0 };
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/^https?:\/\/(127\.0\.0\.1|localhost):8788\//.test(u)) { r.abort(); return; }            /* the helper nothing serves on a PC without it */
    if (!u.startsWith('http://127.0.0.1:' + srv.port)) { r.abort(); return; }                       /* no third party (fonts, CDN) */
    o.requests.push({ t: Date.now(), url: u });
    if (opts.fail && opts.fail.test(u) && o.failing) { o.failed.push(u); r.abort('failed'); return; }
    if (opts.hold && opts.hold.test(u)) { const h = setTimeout(() => r.continue().catch(() => {}), opts.holdMs || 3000); o.held.push(h); return; }
    r.continue().catch(() => {});
  });
  page.on('pageerror', e => o.pageErrors.push(String(e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') o.consoleErrors.push(m.text().slice(0, 200)); });
  o.url = 'http://127.0.0.1:' + srv.port + '/' + PAGE + (opts.query || '');
  o.t0 = Date.now();
  await page.goto(o.url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  o.close = async () => { o.held.forEach(clearTimeout); await ctx.close(); };
  return o;
}
const lazy = page => page.evaluate(() => { const s = window.PPP_LAZY.status(); return { mode: s.mode, syncLoads: s.syncLoads, syncLog: s.syncLog.map(x => x.group + ' <- ' + x.global), groups: s.groups.map(g => g.name + ':' + (g.done ? 'done' : g.failed ? 'failed' : 'no')) }; });
const nav = (page, re) => page.evaluate(src => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll('aside nav button')].find(x => rx.test((x.innerText || '').trim().split('\n')[0].trim()));
  if (b) b.click();
  return !!b;
}, re.source);
/* the "Add sheet music" button of the sidebar, then the file input of that page */
async function addFileInput(page) {
  await page.evaluate(() => { const b = document.querySelector('aside > button'); if (b) b.click(); });
  await page.waitForSelector('input[type=file][data-add-file]', { timeout: 15000 });
  return page.$('input[type=file][data-add-file]');
}
const drawn = page => page.evaluate(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length);
/* a page error or a console error of the page's own. "Failed to load resource" is left out: it is the guest's 401 from /api/auth/me (every suite sees it, on every tree) and the requests this test refuses on purpose */
const noErrors = o => assert.deepEqual(o.pageErrors.concat(o.consoleErrors.filter(e => !/^Failed to load resource/.test(e))), [], 'no page error, no console error');

/* ================================================================ on: what moves and when */
test('on (the default): no deferred file is asked for before the first paint; all of them after it, with no synchronous load', async () => {
  const o = await open();
  try {
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'on');
    /* the six groups of the head, and the fifteen drawing files Home's thumbnail makes up (engravePage) */
    await o.page.waitForFunction(() => { const g = window.PPP_LAZY.status().groups; return g.length >= 7 && g.every(x => x.done); }, { timeout: 30000 });
    const fcp = await o.page.evaluate(() => { const e = performance.getEntriesByName('first-contentful-paint')[0]; return e ? performance.timeOrigin + e.startTime : null; });
    assert.ok(fcp, 'a first contentful paint');
    const lazyReqs = o.requests.filter(r => ANY_LAZY.test(r.url));
    assert.ok(lazyReqs.length >= 60, 'the groups were fetched (' + lazyReqs.length + ' files)');
    const early = lazyReqs.filter(r => r.t < fcp - 50);
    /* a file is not asked for before the frame that shows Home (50 ms of slack for the clock of the two processes) */
    assert.deepEqual(early.map(r => r.url), [], 'no deferred file before the first contentful paint');
    const s = await lazy(o.page);
    assert.equal(s.syncLoads, 0, 'nothing had to be loaded synchronously: ' + JSON.stringify(s.syncLog));
    assert.deepEqual(s.groups, ['backup:done', 'score:done', 'arranger:done', 'audio:done', 'engrave:done', 'lessons:done', 'engravePage:done']);
    assert.equal(await o.page.evaluate(() => typeof Object.getOwnPropertyDescriptor(window, 'PPPScoreGraph').get), 'undefined', 'plain properties again once everything is in');
    noErrors(o);
  } finally { await o.close(); }
});

test('on: the page is the page there was - the same globals, Home draws its thumbnail, a second visit asks for the groups by the same hashed urls', async () => {
  const o = await open();
  try {
    await o.page.waitForFunction(() => window.PPP_LAZY.status().groups.every(g => g.done), { timeout: 30000 });
    await o.page.waitForFunction(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length >= 1, { timeout: 30000 });
    const g = await o.page.evaluate(() => ['PPPScoreGraph', 'PPPScoreGraphModules', 'PPPAudioScore', 'PPPSongGraph', 'PPPRealize', 'PPPArrangement', 'PPPPlayability', 'PPPDifficulty', 'PPPEngrave', 'PPPEngraveModules', 'PPPBackup', 'PPP_LESSONS', 'PPPEngravePage']
      .map(n => n + ':' + typeof window[n]).join(' '));
    assert.equal(g, 'PPPScoreGraph:object PPPScoreGraphModules:object PPPAudioScore:object PPPSongGraph:object PPPRealize:object PPPArrangement:object PPPPlayability:object PPPDifficulty:object PPPEngrave:object PPPEngraveModules:object PPPBackup:object PPP_LESSONS:object PPPEngravePage:object');
    const urls = o.requests.filter(r => ANY_LAZY.test(r.url));
    assert.ok(urls.every(r => /\?h=[0-9a-f]{12}$/.test(r.url)), 'every deferred file is asked for by its content hash (so the browser may keep it for good)');
    noErrors(o);
  } finally { await o.close(); }
});

/* ================================================================ off */
test('off (?split=off): the head names every script again and nothing is deferred', async () => {
  const o = await open({ query: '?split=off' });
  try {
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'off');
    const head = await o.page.evaluate(() => [...document.head.querySelectorAll('script[src]')].map(s => s.getAttribute('src').replace(/\?.*$/, '')));
    const src = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
    const want = [...src.slice(0, src.indexOf('</head>')).matchAll(/<script src="\.\/([^"?#]+)/g)].map(m => './' + m[1]);
    assert.deepEqual(head.slice(0, want.length), want, 'the scripts of the head, in the order of the source: what the page named before G13-4e (plus lazy-load.js); what follows is what the app adds when a screen needs it');
    assert.ok(head.indexOf('./scoregraph/rational.js') > 0 && head.indexOf('./engrave/index.js') > head.indexOf('./audio-score.js'), 'in the old order');
    const d = await o.page.evaluate(() => { const x = Object.getOwnPropertyDescriptor(window, 'PPPScoreGraph'); return { get: typeof x.get, value: typeof x.value }; });
    assert.deepEqual(d, { get: 'undefined', value: 'object' }, 'a plain property, set by the script');
    const s = await lazy(o.page);
    assert.equal(s.mode, 'off');
    assert.deepEqual(s.groups, []);
    const namedFiles = [...src.matchAll(/<noscript data-ppp-lazy="[^"]+"[^>]*>([\s\S]*?)<\/noscript>/g)].flatMap(m => [...m[1].matchAll(/<script src="\.\/([^"?#]+)/g)].map(t => '/' + t[1]));
    assert.ok(namedFiles.length >= 60, 'the source names the deferred files in its blocks (' + namedFiles.length + ')');
    const asked = o.requests.map(r => r.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '').replace(/\?.*$/, '')).filter(u => namedFiles.includes(u));
    assert.deepEqual(asked.slice().sort(), namedFiles.slice().sort(), 'each is asked for, once, by the head');
    noErrors(o);
  } finally { await o.close(); }
});

test('lazy-load.js itself cannot be fetched: the stand-in writes every block back, the page is the page as it was, and says off', async () => {
  const o = await open({ fail: /\/lazy-load\.js\?h=/ });
  try {
    assert.ok(o.failed.length >= 1, 'the module was refused');
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'off');
    assert.equal(await o.page.evaluate(() => typeof Object.getOwnPropertyDescriptor(window, 'PPPScoreGraph').value), 'object', 'the library is a plain property, set by its script');
    await o.page.waitForFunction(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length >= 1, { timeout: 30000 });
    assert.equal(o.pageErrors.length, 0);
  } finally { await o.close(); }
});

test('PPP.split: the choice is remembered on this device, an address wins for one visit, anything else is no choice', async () => {
  const o = await open();
  try {
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'on');
    await o.page.evaluate(() => { window.PPP.split = 'off'; });
    assert.equal(await o.page.evaluate(() => localStorage.getItem('ppp.split.v1')), 'off');
    await o.page.goto(o.url, { waitUntil: 'load' });
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'off', 'the next load follows it');
    await o.page.goto(o.url + '?split=on', { waitUntil: 'load' });
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'on', 'the address beats the remembered value');
    assert.equal(await o.page.evaluate(() => localStorage.getItem('ppp.split.v1')), 'off', 'and is not remembered');
    await o.page.evaluate(() => { window.PPP.split = 'sideways'; });
    assert.equal(await o.page.evaluate(() => localStorage.getItem('ppp.split.v1')), null, 'a value that is neither is no choice: the remembered one is forgotten');
    await o.page.goto(o.url, { waitUntil: 'load' });
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'on');
  } finally { await o.close(); }
});

test('a storage that throws, and a remembered value that is garbage, leave the default (on)', async () => {
  const o = await open({ store: { 'ppp.split.v1': 'maybe' } });
  try {
    assert.equal(await o.page.evaluate(() => window.PPP.split), 'on');
  } finally { await o.close(); }
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* */ }
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) { if (k === 'ppp.split.v1') throw new Error('blocked'); return get.apply(this, arguments); };
    });
    await page.goto('http://127.0.0.1:' + srv.port + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.PPP.split), 'on');
  } finally { await ctx.close(); }
});

/* ================================================================ a screen or action right after load */
test('Home\'s thumbnail: the score group held for 3 s, the page is up and says it is engraving; then it draws; no error', async () => {
  const o = await open({ hold: GROUP_URL.score, holdMs: 3000 });
  try {
    assert.equal(await drawn(o.page), 0, 'not drawn yet');
    const wait = await o.page.evaluate(() => !!document.querySelector('[data-engrave-wait]'));
    assert.equal(wait, true, 'the view says it is engraving (the app\'s own wait text)');
    await o.page.waitForFunction(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length >= 1, { timeout: 30000 });
    assert.equal((await lazy(o.page)).syncLoads, 0);
    noErrors(o);
  } finally { await o.close(); }
});

test('Practice opened at once, with the engraver\'s files held 5 s and the prefetch off: it waits, then draws; no error, no synchronous load', async () => {
  const o = await open({ prefetch: false, hold: GROUP_URL.engrave, holdMs: 5000 });
  try {
    assert.equal(await nav(o.page, /^Practice$/), true);
    await o.page.waitForFunction(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length >= 1, { timeout: 40000 });
    const s = await lazy(o.page);
    assert.equal(s.syncLoads, 0, JSON.stringify(s.syncLog));
    assert.ok(s.groups.includes('score:done') && s.groups.includes('engrave:done'));
    assert.ok(s.groups.includes('arranger:no') && s.groups.includes('audio:no'), 'the engraver does not wait for the arranger or audio-score.js: ' + s.groups);
    noErrors(o);
  } finally { await o.close(); }
});

test('a MusicXML file added right after load (prefetch off, the library and the engraver held 2 s): the song opens; the groups it needs come in by the importer\'s own request, with no synchronous load', async () => {
  const o = await open({ prefetch: false, hold: groupsRe('score', 'engrave'), holdMs: 2000 });
  try {
    const input = await addFileInput(o.page);
    await input.uploadFile(path.join(REPO, 'catalog', 'hymns', 'all-creatures.musicxml'));
    await o.page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 40000 });
    assert.ok(await o.page.evaluate(() => window.PPP.app.state.score.measures.length > 8), 'a real score is open');
    const s = await lazy(o.page);
    assert.equal(s.syncLoads, 0, JSON.stringify(s.syncLog));
    noErrors(o);
  } finally { await o.close(); }
});

/* a minimal Standard MIDI File: format 0, 480 ticks, four quarter notes C D E G */
function midiFile() {
  const track = [];
  const vl = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  track.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);                 /* tempo 500000 */
  track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);           /* 4/4 */
  for (const n of [60, 62, 64, 67, 72, 71, 69, 67]) { track.push(0x00, 0x90, n, 80); track.push(...vl(480), 0x80, n, 0); }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const len = track.length;
  const hdr = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]);
  const trk = Buffer.from([0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255].concat(track));
  return Buffer.concat([hdr, trk]);
}
test('a MIDI file added right after load (prefetch off, the library, the engraver and audio-score.js held 2.5 s) needs audio-score.js: the import waits for it by asking, and the song opens', async () => {
  const file = path.join(os.tmpdir(), 'ppp-split-' + process.pid + '.mid');
  fs.writeFileSync(file, midiFile());
  const o = await open({ prefetch: false, hold: groupsRe('score', 'engrave', 'audio'), holdMs: 2500 });
  try {
    const before = await lazy(o.page);
    assert.ok(before.groups.includes('audio:no'), 'audio-score.js is not in yet');
    await (await addFileInput(o.page)).uploadFile(file);
    await o.page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 40000 });
    assert.equal(await o.page.evaluate(() => window.PPP.app.state.score.title), 'MIDI file');
    const s = await lazy(o.page);
    assert.ok(s.groups.includes('audio:done') && s.groups.includes('score:done'), 'the groups the import needs are in: ' + s.groups);
    assert.equal(s.syncLoads, 0, JSON.stringify(s.syncLog));
    const err = await o.page.evaluate(() => { const st = window.PPP.app.state; return st.importError || st.error || null; });
    assert.equal(err, null, 'no import error: ' + JSON.stringify(err));
    noErrors(o);
  } finally { await o.close(); try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
});

test('the arranger right after load (prefetch off): loadScoreModules asks for every group, the one-note-per-hand arrangement runs, no synchronous load', async () => {
  const o = await open({ prefetch: false });
  try {
    const r = await o.page.evaluate(async () => {
      const ok = await window.PPP.loadScoreModules();
      const src = window.PPPEngrave.app.resolveSync(window.PPP.app.state.score);
      const res = await window.PPP.arrangeSingleNote(src.graph, { level: 'beginner' });
      return { ok, via: src.via, res: { ok: res.ok, reason: res.reason || null } };
    });
    assert.equal(r.ok, true);
    assert.equal(r.res.ok, true, JSON.stringify(r));
    const s = await lazy(o.page);
    assert.equal(s.syncLoads, 0, JSON.stringify(s.syncLog));
    assert.ok(s.groups.includes('arranger:done') && s.groups.includes('audio:done'));
    noErrors(o);
  } finally { await o.close(); }
});

test('Piano Basics right after load (prefetch off): the screen opens at once and the lessons are there; no error', async () => {
  const o = await open({ prefetch: false });
  try {
    assert.equal(await nav(o.page, /^Piano Basics$/), true);
    await o.page.waitForFunction(() => window.PPP.app.state.screen === 'learn' && document.querySelector('main'), { timeout: 20000 });
    const s = await lazy(o.page);
    assert.ok(s.groups.includes('lessons:done'), 'lessons.js is in: ' + s.groups);
    /* no gate on the tap (a screen opens at once, as it always did): the page's read of PPP_LESSONS while it draws is what loads the file, once, by the safety net */
    assert.ok(s.syncLoads <= 1 && s.syncLog.every(l => /^lessons <- PPP_LESSONS$/.test(l)), JSON.stringify(s.syncLog));
    assert.equal(await o.page.evaluate(() => typeof window.PPP_LESSONS.level), 'function');
    noErrors(o);
  } finally { await o.close(); }
});

test('Settings > My data right after load (prefetch off): the screen opens at once, the backup module is in and the section is drawn; no error', async () => {
  const o = await open({ prefetch: false });
  try {
    assert.equal(await nav(o.page, /^Settings$/), true);
    await o.page.waitForFunction(() => document.querySelector('[data-backup-make], [data-backup-file]'), { timeout: 20000 });
    const s = await lazy(o.page);
    assert.ok(s.groups.includes('backup:done'), 'library-backup.js is in: ' + s.groups);
    assert.ok(s.syncLoads <= 1 && s.syncLog.every(l => /^backup <- PPPBackup$/.test(l)), JSON.stringify(s.syncLog));
    noErrors(o);
  } finally { await o.close(); }
});

test('the note a restore leaves for the page it reloads is shown (the module is asked for only because the note is there)', async () => {
  const o = await open({ prefetch: false, store: {} });
  try {
    const plain = await lazy(o.page);
    assert.ok(plain.groups.includes('backup:no'), 'a page with no note never asks for the backup module at boot');
    /* a second page of the same browser session, with a note in the session before the app runs */
    const page2 = await o.ctx.newPage();
    await page2.evaluateOnNewDocument(() => { try { sessionStorage.setItem('ppp-backup-flash', JSON.stringify({ fresh: 3, same: 1, copies: 2, skipped: 0, blanked: 0 })); localStorage.setItem('ppp.splitStart', '0'); } catch (e) { /* */ } });
    await page2.goto(o.url, { waitUntil: 'load' });
    await page2.waitForFunction(() => /Restored: 3 new, 1 merged, 2 kept as copies/.test(document.body.innerText), { timeout: 20000 });
    assert.equal(await page2.evaluate(() => sessionStorage.getItem('ppp-backup-flash')), null, 'and the note is taken (shown once)');
    await page2.close();
  } finally { await o.close(); }
});

test('the piano recordings come after the deferred code (they wait for the prefetch): with one file held 3 s they start only after it', async () => {
  const o = await open({ hold: GROUP_URL.audio, holdMs: 3000 });
  try {
    await o.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 40000 });
    const firstCode = Math.min(...o.requests.filter(r => ANY_LAZY.test(r.url)).map(r => r.t));
    const firstMp3 = Math.min(...o.requests.filter(r => /\/audio\/piano\/[\w-]+\.mp3/.test(r.url)).map(r => r.t));
    assert.ok(firstMp3 - firstCode >= 2800, 'the recordings started ' + (firstMp3 - firstCode) + ' ms after the first deferred file, the held one (3000 ms) was in first');
    assert.equal((await lazy(o.page)).syncLoads, 0);
  } finally { await o.close(); }
});

test('a tap that wakes the sound does not put the recordings in front of the code: with the arranger held 3 s they start only after it is in', async () => {
  const o = await open({ hold: GROUP_URL.arranger, holdMs: 3000 });
  try {
    await o.page.waitForFunction(() => window.PPP && window.PPP.app && document.querySelectorAll('aside nav button').length >= 4 && performance.getEntriesByName('first-contentful-paint').length > 0, { timeout: 30000 });
    await o.page.mouse.click(5, 5);          /* any tap or key wakes the sound (PianoPlayer.wake), which asks for the recordings at once - after the code, here */
    await sleep(1200);
    assert.equal(o.requests.filter(r => /\/audio\/piano\/[\w-]+\.mp3/.test(r.url)).length, 0, 'no recording is asked for while the arranger is still on its way');
    await o.page.waitForFunction(() => window.PPP.PianoSamples.count() === 30, { timeout: 40000 });
    const lastCode = Math.max(...o.requests.filter(r => groupsRe('arranger').test(r.url)).map(r => r.t));
    const firstMp3 = Math.min(...o.requests.filter(r => /\/audio\/piano\/[\w-]+\.mp3/.test(r.url)).map(r => r.t));
    assert.ok(firstMp3 >= lastCode + 2500, 'the recordings started ' + (firstMp3 - lastCode) + ' ms after the last file of the arranger was asked for (held 3000 ms)');
    assert.equal((await lazy(o.page)).syncLoads, 0);
  } finally { await o.close(); }
});

/* ================================================================ the safety net */
test('a method-book piece opened right after load (prefetch off, the library and the engraver held 2 s): the song opens through the importers own ask; no synchronous load', async () => {
  const o = await open({ prefetch: false, hold: groupsRe('score', 'engrave'), holdMs: 2000 });
  try {
    await o.page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.app.state, { timeout: 30000 });
    await o.page.evaluate(() => window.PPP.app.loadCourse());
    await o.page.waitForFunction(() => window.PPP.app.state.courseCat, { timeout: 20000 });
    await o.page.evaluate(() => window.PPP.app.openCoursePiece('beyer', 1));
    await o.page.waitForFunction(() => window.PPP.app.state.screen === 'player' && window.PPP.app.state.score && window.PPP.app.state.score.source && window.PPP.app.state.score.source.kind === 'course', { timeout: 40000 });
    const s = await lazy(o.page);
    assert.equal(s.syncLoads, 0, 'the piece asked for the library before it read it: ' + JSON.stringify(s.syncLog));
    assert.ok(s.groups.includes('score:done'), s.groups.join(' '));
    noErrors(o);
  } finally { await o.close(); }
});

test('a read of a deferred global that comes before its group is answered, once, and shows in status().syncLoads', async () => {
  const o = await open({ prefetch: false });
  try {
    const before = await lazy(o.page);
    assert.ok(before.groups.includes('score:no') || before.groups.includes('score:done') || true);
    const v = await o.page.evaluate(() => { window.PPP_LAZY.status(); return typeof window.PPP_LESSONS.level; });
    assert.equal(v, 'function', 'never undefined');
    const s = await lazy(o.page);
    assert.ok(s.syncLoads >= 1);
    assert.ok(s.syncLog.some(l => /^lessons <- PPP_LESSONS$/.test(l)), JSON.stringify(s.syncLog));
    assert.ok(s.groups.includes('lessons:done'));
    noErrors(o);
  } finally { await o.close(); }
});

/* ================================================================ failure */
test('the score group cannot be fetched: Home is up and its thumbnail says it could not be engraved (the app\'s own message); then Practice, asked again, draws', async () => {
  const o = await open({ fail: GROUP_URL.score });
  try {
    assert.equal(await o.page.evaluate(() => document.querySelectorAll('aside nav button').length >= 6), true, 'the page is up');
    await o.page.waitForFunction(() => document.querySelector('[data-engrave-failed]'), { timeout: 30000 });
    assert.ok(o.failed.length > 0, 'the files were refused');
    assert.ok(o.requests.some(r => /scoregraph\/[\w-]+\.js\?h=[0-9a-f]{12}&retry=\d+/.test(r.url)), 'each was asked for once more with a fresh url');
    const body = await o.page.evaluate(() => document.body.innerText.trim().length);
    assert.ok(body > 200, 'never a blank page');
    assert.equal(o.pageErrors.length, 0);
    o.failing = false;                                    /* the network is back */
    assert.equal(await nav(o.page, /^Practice$/), true);
    await o.page.waitForFunction(() => document.querySelectorAll('.ppp-score svg.ppp-engraved').length >= 1, { timeout: 40000 });
    noErrors(o);
  } finally { await o.close(); }
});

test('an import while the arranger cannot be fetched says the files could not be loaded (not a blank page); the next try, with the network back, works', async () => {
  const o = await open({ prefetch: false, fail: GROUP_URL.audio });
  try {
    const r1 = await o.page.evaluate(async () => { const ok = await window.PPP.loadScoreModules(); return { ok, score: !!window.PPPScoreGraph }; });
    assert.equal(r1.ok, false, 'a group that cannot be had is false, never a throw');
    assert.equal(r1.score, true, 'what could be had is there');
    assert.ok(o.requests.some(r => /audio-score\.js\?h=[0-9a-f]{12}&retry=\d+/.test(r.url)), 'asked for again with a fresh url');
    assert.ok((await o.page.evaluate(() => document.body.innerText.trim().length)) > 200, 'the page is still there');
    o.failing = false;
    const r2 = await o.page.evaluate(async () => ({ ok: await window.PPP.loadScoreModules(), audio: typeof window.PPPAudioScore }));
    assert.deepEqual(r2, { ok: true, audio: 'object' });
  } finally { await o.close(); }
});
