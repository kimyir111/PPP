/* What keeping a song's graph costs the page (G04 §19, fixer "PERFORMANCE"). Local: the app served, puppeteer.

     PORT=8793 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/perf-persist.js [--url http://127.0.0.1:8793] [--json out.json]

   For the longest committed pieces, in the real page, at CPU 1x and 4x (Emulation.setCPUThrottlingRate):
     phases     the music hash, agree(), the canonical text (serialize) and gzip (CompressionStream), each timed alone
     persist    PPPEngrave.app.persist() end to end, as writeSlot runs it, with every long task (> 50 ms,
                PerformanceObserver 'longtask') seen while it runs - the main thread is handed back between its steps
     resolve    after a reload: the store's fast path (link) and a projection (fromScore + agree + link)
   And the cache at its limit (200 records): the JS heap while eviction reads what it needs - record sizes only - against
   reading every record (IndexedDB getAll on the graphs, what eviction did before the fixer), and the v1 -> v2 upgrade
   of a database left by an earlier build. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8793') + '/Piano%20Coach%20App.dc.html';
const PIECES = ['catalog/method/sonatina/020.mxl', 'catalog/method/sonatina/013.mxl', 'catalog/method/czerny849/001.mxl'];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'], protocolTimeout: 600000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });
  const cdp = await page.target().createCDPSession();
  const out = { pieces: {}, evict: null, upgrade: null };

  await page.evaluate(() => {
    window.__perf = {
      longTasks: [],
      watch() {
        const lt = window.__perf.longTasks = [];
        if (window.__perfObs) window.__perfObs.disconnect();
        window.__perfObs = new PerformanceObserver(list => list.getEntries().forEach(e => lt.push(Math.round(e.duration))));
        window.__perfObs.observe({ type: 'longtask', buffered: false });
      },
      async load(b64, name) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const xml = await window.PPP.readMxl(bytes.buffer);
        return window.PPP.scoreFromXml(xml, name);
      }
    };
  });

  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: rate });
    for (const rel of PIECES) {
      const b64 = fs.readFileSync(path.join(REPO, rel)).toString('base64');
      const r = await page.evaluate(async (b64, name, rate) => {
        const P = window.PPP, SG = window.PPPScoreGraph, L = SG.legacy, E = window.PPPEngrave;
        const score = await window.__perf.load(b64, name);
        const app = E.app;
        const src = E.createSource({ store: null });
        const graph = (await app.resolve(score, {})).graph;
        const t = f => { const t0 = performance.now(); const v = f(); return [v, +(performance.now() - t0).toFixed(1)]; };
        const ta = async f => { const t0 = performance.now(); const v = await f(); return [v, +(performance.now() - t0).toFixed(1)]; };
        const phases = {};
        phases.hash = t(() => src.scoreHash(score))[1];
        phases.agree = t(() => L.agree(score, graph))[1];
        const [text, ms] = t(() => SG.serialize(graph)); phases.serialize = ms;
        phases.gzip = (await ta(() => E.store.encode(graph, { key: 'x', text: text })))[1];
        /* persist end to end under a fresh key, with the long tasks it causes */
        window.__perf.watch();
        const [res, total] = await ta(() => app.persist('perf-' + name + '-' + rate, score));
        await new Promise(r => setTimeout(r, 200));
        const lt = window.__perf.longTasks.slice();
        /* after a reload: the store's fast path, and a projection */
        const copy = P.Score.finalize(P.unpackScore(JSON.parse(JSON.stringify(P.packScore(score)))));
        const fresh = E.createSource({ store: app.store });
        const [r1, store] = await ta(() => fresh.resolve(copy, { key: 'perf-' + name + '-' + rate }));
        const [r2, projected] = await ta(async () => E.createSource({ store: null }).resolve(P.Score.finalize(P.unpackScore(JSON.parse(JSON.stringify(P.packScore(score))))), {}));
        await app.forget('perf-' + name + '-' + rate);
        return { notes: score.notes.length, textKB: Math.round(text.length / 1024), phases: phases, persist: { ms: total, ok: res.ok, code: res.code || null, longTasks: lt },
          resolve: { storeMs: store, storeVia: r1.via, projectedMs: projected, projectedVia: r2.via } };
      }, b64, rel.split('/').slice(-2).join('-'), rate);
      out.pieces[rel + ' @' + rate + 'x'] = r;
      console.log(rel + ' @' + rate + 'x ' + JSON.stringify(r));
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  /* eviction at the limit: 200 records of the longest piece's graph, then one more */
  out.evict = await page.evaluate(async b64 => {
    const E = window.PPPEngrave, S = E.store;
    const score = await window.__perf.load(b64, 'evict');
    const graph = (await E.app.resolve(score, {})).graph;
    const backend = S.idbBackend(indexedDB);
    const st = S.createStore({ backend: backend });
    for (const k of await st.keys()) await st.del(k);
    for (let i = 0; i < 200; i++) await st.put('evict-' + String(i).padStart(3, '0'), graph, { via: 'live' });
    const heap = () => { if (window.gc) window.gc(); return performance.memory.usedJSHeapSize; };
    const before = heap();
    const sizes = await backend.sizes();
    const withSizes = performance.memory.usedJSHeapSize - before;
    const nSizes = sizes.length;
    const before2 = heap();
    const all = await new Promise((res, rej) => { const q = indexedDB.open(S.DB_NAME); q.onsuccess = () => { const t = q.result.transaction(S.STORE_NAME, 'readonly'); const r = t.objectStore(S.STORE_NAME).getAll(); r.onsuccess = () => { res(r.result); q.result.close(); }; r.onerror = () => rej(r.error); }; q.onerror = () => rej(q.error); });
    const withAll = performance.memory.usedJSHeapSize - before2;
    const stored = all.reduce((s, r) => s + r.stored, 0);
    const t0 = performance.now();
    const put = await st.put('evict-new', graph, { via: 'live' });
    const putMs = +(performance.now() - t0).toFixed(1);
    const left = (await st.keys()).length;
    for (const k of await st.keys()) await st.del(k);
    return { records: nSizes, storedKB: Math.round(stored / 1024), heapSizesKB: Math.round(withSizes / 1024), heapGetAllKB: Math.round(withAll / 1024),
      putAtLimit: { ok: put.ok, ms: putMs, evicted: st.stats.evicted, recordsAfter: left } };
  }, fs.readFileSync(path.join(REPO, PIECES[0])).toString('base64'));
  console.log('evict ' + JSON.stringify(out.evict));
  await browser.close();

  /* the upgrade: a v1 database (graphs only, the build before the fixer) opened by this build */
  const b2 = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p2 = await b2.newPage();
  await preparePage(p2);
  await p2.goto(URL.replace('Piano%20Coach%20App.dc.html', 'engrave/index.js'), { waitUntil: 'networkidle2' });
  await p2.evaluate(() => new Promise((res, rej) => {
    const d = indexedDB.deleteDatabase('ppp-engrave'); d.onsuccess = d.onerror = () => {
      const q = indexedDB.open('ppp-engrave', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('graphs', { keyPath: 'key' });
      q.onsuccess = () => { const t = q.result.transaction('graphs', 'readwrite'); t.objectStore('graphs').put({ key: 'song-old', v: 1, stored: 1234, savedAt: 1, data: new ArrayBuffer(4) }); t.oncomplete = () => { q.result.close(); res(); }; };
      q.onerror = () => rej(q.error);
    };
  }));
  await p2.goto(URL, { waitUntil: 'networkidle2' });
  await p2.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });
  out.upgrade = await p2.evaluate(async () => {
    const st = window.PPPEngrave.app.store;
    const keys = await st.keys();
    const got = await st.get('song-old');
    const after = await st.keys();
    return { keysAfterUpgrade: keys, oldRecordRead: got.ok ? 'ok' : got.code, keysAfterRead: after };
  });
  console.log('upgrade ' + JSON.stringify(out.upgrade));
  await b2.close();
  const file = arg('--json', null);
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
