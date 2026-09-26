/* G4-U1: a graph cache that cannot be used never costs a song (fixer P8). Local: the app served, puppeteer.

     PORT=8793 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/storage-failure.js [--url http://127.0.0.1:8793]

   Three browsers the cache cannot use, each set up before the page's first script runs:
     no-indexeddb   window.indexedDB is not there (some private windows, embedded views)
     open-throws    indexedDB.open throws (restricted storage)
     quota          every IndexedDB write fails with QuotaExceededError (a full disk)
   In each, a MusicXML file is imported the way a person imports it (startImport), saved, reloaded and opened again,
   and practised: the song must be there, drawn (G4a: by the legacy renderer; since the G4f-2 flip by the default, the
   engraver, from the Score's projection), with no page error; the source says why nothing was kept, and still gives
   every Score a graph. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8793') + '/Piano%20Coach%20App.dc.html';
const XML = [...fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e', 'E15-articulations.musicxml'))];
const errors = [];
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) errors.push(name); };

const SETUPS = {
  'no-indexeddb': () => { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) {} },
  'open-throws': () => { const f = indexedDB; f.open = function () { throw new DOMException('restricted', 'SecurityError'); }; },
  quota: () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (this.name === 'graphs' || this.name === 'meta') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.call(this, v, k);
    };
  }
};

(async () => {
  for (const name of Object.keys(SETUPS)) {
    console.log('\n-- ' + name);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await preparePage(page);
    await page.evaluateOnNewDocument(SETUPS[name]);
    await page.setViewport({ width: 1400, height: 900 });
    const boot = () => page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await boot();
    const r = await page.evaluate(async bytes => {
      const A = window.PPP.app, I = window.PPP.Import, before = A.state.songId;
      const f = new File([new Uint8Array(bytes)], 'articulations.musicxml');
      A.startImport({ file: f, name: f.name, kind: I.kindOf(f) });
      for (let i = 0; i < 200 && (A.state.songId === before || A.state.analysis !== 'done'); i++) await new Promise(res => setTimeout(res, 100));
      await new Promise(res => setTimeout(res, 2500));
      const E = window.PPPEngrave.app;
      const src = await E.resolve(A.state.score, { key: A.state.songId });
      return { songId: A.state.songId, notes: A.state.score.notes.length, store: E.store ? E.store.backend : null, via: src.via,
        persist: JSON.parse(JSON.stringify(E.stats.persist)), storeErrors: E.store ? JSON.parse(JSON.stringify(E.store.stats)) : null };
    }, XML);
    ok(name + ': the import made a song', /^song-/.test(r.songId) && r.notes > 0, JSON.stringify(r));
    await page.reload({ waitUntil: 'networkidle2' });
    await boot();
    const back = await page.evaluate(async id => {
      const A = window.PPP.app;
      A.openSong(id, { stay: true, quiet: true });
      for (let i = 0; i < 50 && A.state.songId !== id; i++) await new Promise(res => setTimeout(res, 50));
      await window.__pppTest.practice();
      await new Promise(res => setTimeout(res, 1500));
      const svg = document.querySelector('.ppp-staffwrap svg');
      const src = await window.PPPEngrave.app.resolve(A.state.score, { key: id });
      return { songId: A.state.songId, drawn: svg ? svg.querySelectorAll('g.ppp-note').length : 0, via: src.via, link: !!(src.link && src.link.ok),
        diag: (src.diagnostics || []).map(d => d.code) };
    }, r.songId);
    ok(name + ': after a reload the song opens, is practised and drawn, and still has a graph', back.songId === r.songId && back.drawn > 0 && back.via === 'projected' && back.link, JSON.stringify(back));
    ok(name + ': no page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    await browser.close();
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\na cache that cannot be used costs no song: all checks passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
