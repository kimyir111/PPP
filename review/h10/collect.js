#!/usr/bin/env node
/* ============================================================================
   G10a-5 (H-10) - the collector: the HEARD NOTES of YouTube pieces, exactly as the app's own browser transcription gives them.

     node review/h10/collect.js --items items.json --out <dir> [--parallel 2] [--max-minutes 15] [--timeout-min 45] [--force]
                                [--only id1,id2] [--audio-base https://ppp-web-2o99.onrender.com] [--stub-dir <dir>]

   items.json   [{ id, url (a YouTube link), title? , ...anything else (excerpt, inputClass: kept for the builder) }]
   --out        the ONLY place this tool writes: <id>.json (the heard notes, the format of the app's `PPP.app._heard`: { notes: [{ on, off, midi, vel }],
                duration, engine, qualityTier, fallbackFrom, truncated, ... }), collect-status.json (per item: status, timings, model, notes, error),
                and items.json (the list, with later runs' items added). review/build.js --mode h10 --heard <dir> reads exactly this folder.

   How (per item, in its own browser process and on its own port): a local server of THIS tree (tests/serve-free.js: NODE_ENV=production, a free
   port, nothing spawned on 8788), the real page under puppeteer, driven as a person drives it - My Songs, the add card, the link, "Make sheet
   music" - with the real in-browser Onsets & Frames model (about 6 minutes a piece). The one thing the local server cannot do is download the
   audio (it has no yt-dlp), so the page's GET /api/youtube-audio is answered by the PRODUCTION endpoint (the audio base; a read-only GET, the only
   request this tool makes of production; every other request is the page's own and goes where the page sends it, nothing but GETs to anywhere
   outside this machine). The notes are taken from the review screen's state; the conversion that runs there is the page's default (v2 since G10a-5b, classic before; the mode
   is recorded in the status as recordingMode) and is not used: the builder converts the heard notes itself.

   Never silent: an item that is refused (the link, the download, the model), too long (the decoded audio is longer than --max-minutes, default 15 = the
   app's own limit, checked before the model starts so no 40 minutes are spent), cut by the app (truncated), hears no notes, or times out is
   REPORTED in collect-status.json and on the console with its reason; a piece whose <id>.json exists is skipped on the next run (resumable;
   --force collects it again).

   --stub-dir <dir>  tests of the tool itself: for an item with <dir>/<id>.json the model is replaced by those notes and the audio request is answered with a
                     tiny wav (no network at all). Recorded in the status as `stubbed: true`.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const REPO = path.resolve(__dirname, '..', '..');

function findPuppeteer() {
  for (const p of ['puppeteer', 'D:/PPP/node_modules/puppeteer', path.join(REPO, 'node_modules', 'puppeteer')]) {
    try { return require(p); } catch (e) { /* next */ }
  }
  throw new Error('puppeteer is not installed (npm install, or D:/PPP/node_modules/puppeteer)');
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const WAV = (() => {   /* 800 samples of silence, 8 kHz mono 8-bit: the page's own tests use the same */
  const n = 800, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); buf.fill(128, 44);
  return buf;
})();

/* GET one URL, whole body in memory: { status, type, body } (the only call this tool makes of production) */
function getBytes(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = /^https:/.test(url) ? https : http;
    const req = lib.get(url, { timeout: timeoutMs || 180000, headers: { 'User-Agent': 'ppp-h10-collector/1' } }, res => {
      const parts = [];
      res.on('data', d => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || 'application/octet-stream', body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

const isLocal = u => /^(https?:\/\/(127\.0\.0\.1|localhost)(:|\/)|data:|blob:|about:|file:)/.test(u);

/* one item, start to finish. opts: { out, audioBase, maxMinutes, timeoutMin, stubDir, log } -> the status record */
async function collectOne(item, opts) {
  const log = (...a) => opts.log(item.id + ':', ...a);
  const st = { status: 'failed', url: item.url, title: null, startedAt: new Date().toISOString() };
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  const stubFile = opts.stubDir ? path.join(opts.stubDir, item.id + '.json') : null;
  const stub = stubFile && fs.existsSync(stubFile) ? JSON.parse(fs.readFileSync(stubFile, 'utf8')) : null;
  st.stubbed = !!stub;
  const puppeteer = findPuppeteer();
  const { startServer } = require(path.join(REPO, 'tests', 'serve-free.js'));
  const { preparePage } = require(path.join(REPO, 'tests', 'boot.js'));
  let srv = null, browser = null;
  const abort = {};
  abort.promise = new Promise(r => { abort.fire = r; });
  try {
    srv = await startServer({ root: REPO });
    if (srv.external) throw new Error('PPP_URL is set: the collector serves this tree itself; unset it');
    browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 4 * 3600 * 1000,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await preparePage(page);
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(String(e && e.message || e).slice(0, 200)); });
    await page.setViewport({ width: 1200, height: 1000 });
    const foreign = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.indexOf('/api/youtube-audio') >= 0 && req.method() === 'GET') {
        if (stub) { st.audioBytes = WAV.length; return req.respond({ status: 200, contentType: 'audio/wav', body: WAV, headers: { 'Access-Control-Allow-Origin': '*' } }); }
        const q = u.slice(u.indexOf('/api/youtube-audio'));
        const tDl = Date.now();
        getBytes(opts.audioBase.replace(/\/+$/, '') + q).then(r => {
          st.audioBytes = r.body.length; st.downloadSeconds = Math.round((Date.now() - tDl) / 100) / 10; st.audioStatus = r.status;
          log('audio', r.status, (r.body.length / 1048576).toFixed(1) + ' MB in ' + st.downloadSeconds + ' s');
          req.respond({ status: r.status, contentType: r.type, body: r.body, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
        }, e => { st.audioError = String(e && e.message || e); log('audio request failed:', st.audioError); req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'download-failed' }) }); });
        return;
      }
      if (u.indexOf(':8788/') >= 0 || /\/helper(\/|$|\?)/.test(u)) return req.abort();      /* there is no local helper: the browser model only */
      if (req.method() !== 'GET' && !isLocal(u)) { foreign.push(req.method() + ' ' + u.slice(0, 80)); return req.abort(); }
      req.continue();
    });
    await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => !!(window.PPP && window.PPP.app && window.PPP.Import), { timeout: 60000 });
    st.recordingMode = await page.evaluate(() => window.PPP.recording);

    /* the length guard (before the model) and, for a test of the tool itself, the stub of the model */
    await page.exposeFunction('__collectAudio', sec => {
      st.audioSeconds = sec == null ? null : Math.round(sec * 10) / 10;
      st.transcribeStartedAt = Date.now();
      if (sec != null && sec > opts.maxMinutes * 60) { st.status = 'too-long'; st.error = 'the audio is ' + (sec / 60).toFixed(1) + ' minutes; the limit is ' + opts.maxMinutes; abort.fire('too-long'); return 'abort'; }
      return 'go';
    });
    await page.evaluate(stubNotes => {
      const Imp = window.PPP.Import, orig = Imp.pianoAmtNotes;
      Imp.pianoAmtNotes = async function (buf, onPct) {
        let dur = null;
        if (!stubNotes) {
          try {
            const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ac = new OAC(1, 1, 16000);
            const d = await new Promise((ok, fail) => { const p = ac.decodeAudioData(buf.slice(0), ok, fail); if (p && p.then) p.then(ok, fail); });
            dur = d.duration;
          } catch (e) { dur = null; }
        }
        const verdict = await window.__collectAudio(stubNotes ? 1 : dur);
        if (verdict === 'abort') return new Promise(() => {});
        if (stubNotes) return JSON.parse(JSON.stringify(stubNotes));
        return orig.call(this, buf, onPct);
      };
    }, stub);

    log('page up (' + srv.url + '), ' + (stub ? 'STUB model' : 'real model'));
    await page.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(300);
    await page.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(400);
    await page.waitForSelector('[data-youtube-url]', { timeout: 10000 });
    await page.type('[data-youtube-url]', item.url);
    await page.evaluate(() => { const i = document.querySelector('[data-youtube-url]'); i.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(200);
    const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-youtube] button')].find(x => /Make sheet music/.test(x.innerText)); if (b) b.click(); return !!b; });
    if (!clicked) throw new Error('the page has no "Make sheet music" button for a link');
    const done = page.waitForFunction(() => !!document.querySelector('[data-recording]') || window.PPP.app.state.analysis === 'error', { timeout: opts.timeoutMin * 60 * 1000, polling: 3000 })
      .then(() => 'finished', e => 'timeout: ' + e.message);
    const outcome = await Promise.race([done, abort.promise]);
    st.pageErrors = pageErrors.slice(-5);
    if (foreign.length) st.blockedRequests = foreign.slice(0, 10);
    if (outcome === 'too-long') { log('TOO LONG:', st.error); return st; }
    if (String(outcome).startsWith('timeout')) { st.status = 'failed'; st.error = 'no result after ' + opts.timeoutMin + ' minutes'; log('FAILED:', st.error); return st; }
    await sleep(1500);
    const res = await page.evaluate(() => {
      const A = window.PPP.app, S = A.state;
      const h = A._heard ? JSON.parse(JSON.stringify(A._heard)) : null;
      return { screen: S.screen, analysis: S.analysis, error: S.parseError ? (S.parseError.message || String(S.parseError)) : null, code: S.parseError && S.parseError.code || null, heard: h, title: S.score && S.score.title || null };
    });
    st.transcribeSeconds = st.transcribeStartedAt ? Math.round((Date.now() - st.transcribeStartedAt) / 1000) : null;
    delete st.transcribeStartedAt;
    st.title = res.title && !/^Transcribed recording$/.test(res.title) ? res.title : null;
    if (res.analysis === 'error' || !res.heard) {
      st.status = res.code === 'download-failed' || st.audioStatus >= 400 || st.audioError ? 'refused' : (res.code === 'no-notes' ? 'no-notes' : 'refused');
      st.error = (res.code ? res.code + ': ' : '') + (res.error || 'the page reported an error');
      log('REFUSED:', st.error);
      return st;
    }
    const heard = res.heard;
    const n = (heard.notes || []).length;
    st.model = { engine: heard.engine || null, qualityTier: heard.qualityTier || null, fallbackFrom: heard.fallbackFrom || null };
    st.notes = n; st.duration = heard.duration || null; st.truncated = !!heard.truncated;
    if (n < 4) { st.status = 'no-notes'; st.error = 'only ' + n + ' notes were heard'; log('NO NOTES'); return st; }
    const file = path.join(opts.out, item.id + '.json'), tmp = file + '.part';
    fs.writeFileSync(tmp, JSON.stringify(heard));
    fs.renameSync(tmp, file);
    st.status = 'ok';
    st.seconds = { download: st.downloadSeconds != null ? st.downloadSeconds : null, transcribe: st.transcribeSeconds, total: secs() };
    log('OK', n + ' notes, ' + (heard.duration || 0).toFixed(1) + ' s of music, ' + st.seconds.total + ' s' + (st.truncated ? ' (CUT by the app at its limit)' : ''));
    return st;
  } catch (e) {
    st.status = 'failed'; st.error = String(e && e.message || e).slice(0, 400);
    log('FAILED:', st.error);
    return st;
  } finally {
    st.finishedAt = new Date().toISOString();
    delete st.transcribeStartedAt;
    try { if (browser) await browser.close(); } catch (e) { /* closed */ }
    try { if (srv) await srv.close(); } catch (e) { /* closed */ }
  }
}

/* items -> status (and files in opts.out), `opts.parallel` at a time */
async function collect(items, opts) {
  opts = Object.assign({ parallel: 2, maxMinutes: 15, timeoutMin: 45, audioBase: 'https://ppp-web-2o99.onrender.com', force: false, only: null, log: (...a) => console.log(ts(), ...a) }, opts);
  if (!opts.out) throw new Error('--out is required');
  if (!Array.isArray(items) || !items.length) throw new Error('no items');
  const seen = new Set();
  items.forEach(it => {
    if (!it || !ID_RE.test(String(it.id))) throw new Error('an item has no usable id (letters, digits, - and _, up to 40): ' + JSON.stringify(it));
    if (seen.has(it.id)) throw new Error('two items with the id ' + it.id);
    seen.add(it.id);
    if (!opts.stubDir && !/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(String(it.url || ''))) throw new Error('item ' + it.id + ' has no YouTube link: ' + JSON.stringify(it.url));
  });
  fs.mkdirSync(opts.out, { recursive: true });
  const statusFile = path.join(opts.out, 'collect-status.json');
  let status = { format: 'ppp-h10-collect/1', items: {} };
  if (fs.existsSync(statusFile)) { try { const o = JSON.parse(fs.readFileSync(statusFile, 'utf8')); if (o && o.items) status = o; } catch (e) { /* start again */ } }
  const saveStatus = () => { const tmp = statusFile + '.part'; fs.writeFileSync(tmp, JSON.stringify(status, null, 1) + '\n'); fs.renameSync(tmp, statusFile); };
  /* items.json of the folder: what was there, with these items added (an item with the same id is replaced), so a later run with a few more links keeps the earlier ones */
  const itemsFile = path.join(opts.out, 'items.json');
  let had = [];
  if (fs.existsSync(itemsFile)) { try { const o = JSON.parse(fs.readFileSync(itemsFile, 'utf8')); if (Array.isArray(o)) had = o; } catch (e) { had = []; } }
  const merged = had.map(h => items.find(i => i.id === h.id) || h).concat(items.filter(i => !had.some(h => h.id === i.id)));
  fs.writeFileSync(itemsFile + '.part', JSON.stringify(merged, null, 1) + '\n');
  fs.renameSync(itemsFile + '.part', itemsFile);
  const want = opts.only ? new Set(opts.only) : null;
  const todo = [];
  items.forEach(it => {
    if (want && !want.has(it.id)) return;
    if (!opts.force && fs.existsSync(path.join(opts.out, it.id + '.json'))) {
      const prev = status.items[it.id] || {};
      status.items[it.id] = Object.assign({}, prev, { status: 'ok', url: it.url, skipped: 'already collected' });
      opts.log(it.id + ': already collected, skipped');
      return;
    }
    todo.push(it);
  });
  saveStatus();
  let next = 0, writing = Promise.resolve();
  const lane = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      const st = await collectOne(it, opts);
      status.items[it.id] = st;
      writing = writing.then(saveStatus);
      await writing;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, todo.length || 1)) }, lane));
  const counts = {};
  Object.keys(status.items).forEach(id => { if (seen.has(id)) counts[status.items[id].status] = (counts[status.items[id].status] || 0) + 1; });
  return { status: status, counts: counts, collected: todo.map(i => i.id) };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const flag = n => args.indexOf(n) >= 0;
  if (flag('--help') || !opt('--items') || !opt('--out')) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 30).join('\n')); process.exit(opt('--items') ? 0 : 2); }
  const items = JSON.parse(fs.readFileSync(opt('--items'), 'utf8'));
  collect(items, { out: path.resolve(opt('--out')), parallel: Number(opt('--parallel', 2)), maxMinutes: Number(opt('--max-minutes', 15)), timeoutMin: Number(opt('--timeout-min', 45)),
    force: flag('--force'), only: opt('--only') ? opt('--only').split(',') : null, audioBase: opt('--audio-base', 'https://ppp-web-2o99.onrender.com'), stubDir: opt('--stub-dir') ? path.resolve(opt('--stub-dir')) : null })
    .then(r => {
      console.log('\nstatus:', JSON.stringify(r.counts));
      Object.keys(r.status.items).forEach(id => { const s = r.status.items[id]; if (s.status !== 'ok') console.log('NOT COLLECTED', id, s.status, s.error || ''); else if (s.truncated) console.log('NOTE', id, 'was cut by the app at its length limit'); });
      process.exit(Object.keys(r.counts).some(k => k !== 'ok') ? 1 : 0);
    }, e => { console.error(e.message || e); process.exit(2); });
}

if (require.main === module) main();
module.exports = { collect, collectOne, getBytes };
