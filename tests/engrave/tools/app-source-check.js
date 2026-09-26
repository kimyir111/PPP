/* G4a in the real page: every score on screen can get its ScoreGraph, and a song's graph outlives a reload
   (docs/GOALS/G04 §8.2, G4-U1, A16). Local, like the G2 page checks: needs the app served and puppeteer.

     PORT=8793 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/app-source-check.js [--url http://127.0.0.1:8793]

   Drives the app's own entry points - a method-book piece (openCoursePiece), a MusicXML and a MIDI file through
   the import door (scoreFromFile), the built-in sample - saves them as songs the way the app does, reloads the page,
   corrupts a kept graph, removes a song, and asks PPPEngrave.app for each Score's graph. Exit 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8793') + '/Piano%20Coach%20App.dc.html';
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!cond) errors.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
  const page = await browser.newPage();
  const pageErrors = [], engraveWarnings = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (/engrave/i.test(m.text()) && m.type() !== 'log') engraveWarnings.push(m.text()); });
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 900 });
  const boot = async () => {
    await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });
    await sleep(800);
  };
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await boot();

  const resolveCurrent = () => page.evaluate(async () => {
    const S = window.PPP.app.state;
    const r = await window.PPPEngrave.app.resolve(S.score, { key: S.songId });
    return { via: r.via, fp: r.graph ? window.PPPScoreGraph.fingerprint(r.graph) : null, link: !!(r.link && r.link.ok),
      diag: (r.diagnostics || []).map(d => d.code), songId: S.songId, scoreId: S.score.id };
  });
  const keys = () => page.evaluate(async () => window.PPPEngrave.app.store ? window.PPPEngrave.app.store.keys() : []);
  const waitKept = async id => { for (let i = 0; i < 60; i++) { if ((await keys()).indexOf(id) >= 0) return true; await sleep(250); } return false; };

  console.log('\n-- what loaded');
  const ver = await page.evaluate(() => ({ e: window.PPPEngrave.version, sg: window.PPPScoreGraph.version, store: window.PPPEngrave.app.store && window.PPPEngrave.app.store.backend }));
  ok('PPPEngrave is on the page', ver.e === '0.1.1-g4a', JSON.stringify(ver));
  ok('the graph cache is IndexedDB', ver.store === 'indexeddb');

  console.log('\n-- the built-in sample: no file, a graph rebuilt from the Score');
  const demo = await resolveCurrent();
  ok('the sample resolves', demo.via === 'projected' && demo.link, JSON.stringify(demo));

  console.log('\n-- a method-book piece, opened the way a person opens it');
  const course = await page.evaluate(async () => {
    const A = window.PPP.app;
    A.loadCourse();
    for (let i = 0; i < 80 && !A.state.courseCat; i++) await new Promise(r => setTimeout(r, 100));
    const C = window.PPP_COURSE, cat = A.state.courseCat;
    const book = (cat.books || cat)[0];
    const bookId = book.id, piece = (book.pieces || [])[0];
    A.openCoursePiece(bookId, piece.no);
    for (let i = 0; i < 100 && A.state.songId === 'demo'; i++) await new Promise(r => setTimeout(r, 100));
    return { songId: A.state.songId, scoreId: A.state.score.id };
  });
  ok('the piece becomes a song', /^song-/.test(course.songId), JSON.stringify(course));
  const c1 = await resolveCurrent();
  ok('its graph is the live one it was read with', c1.via === 'live' && c1.link, JSON.stringify(c1));
  ok('and it is kept beside the song', await waitKept(course.songId));

  console.log('\n-- a MusicXML file and a MIDI file through the import door');
  const xml = fs.readFileSync(path.join(REPO, 'tests', 'scoregraph', 'fixtures', 'xml', 'grand-staff.musicxml'), 'utf8');
  const mid = [...fs.readFileSync(path.join(REPO, 'tests', 'scoregraph', 'fixtures', 'midi', 'm27-twenty-notes.mid'))];
  const addFile = (name, content, bytes) => page.evaluate(async (name, content, bytes) => {
    const A = window.PPP.app;
    const file = new File([bytes ? new Uint8Array(bytes) : content], name);
    const score = await window.PPP.scoreFromFile(file);
    A.shelveSong();
    A.adoptScore(score);
    A.enterSong(score, { kind: /\.mid$/.test(name) ? 'midi' : 'musicxml', name: name, importedAt: Date.now(), status: 'parsed' }, false);
    for (let i = 0; i < 50 && A.state.score !== score; i++) await new Promise(r => setTimeout(r, 50));
    return A.state.songId;
  }, name, content, bytes);
  const xmlSong = await addFile('grand-staff.musicxml', xml, null);
  const x1 = await resolveCurrent();
  ok('the MusicXML song has its live graph', x1.via === 'live' && x1.link, JSON.stringify(x1));
  ok('and it is kept', await waitKept(xmlSong));
  const midSong = await addFile('m27-twenty-notes.mid', null, mid);
  const m1 = await resolveCurrent();
  ok('the MIDI song has its live graph', m1.via === 'live' && m1.link, JSON.stringify(m1));
  ok('and it is kept', await waitKept(midSong));

  console.log('\n-- the page is reloaded');
  await page.reload({ waitUntil: 'networkidle2' });
  await boot();
  const m2 = await resolveCurrent();
  ok('the open song comes back with its kept graph', m2.via === 'store' && m2.fp === m1.fp && m2.link, JSON.stringify(m2));
  const x2 = await page.evaluate(async id => {
    const A = window.PPP.app;
    A.openSong(id, { stay: true, quiet: true });
    for (let i = 0; i < 50 && A.state.songId !== id; i++) await new Promise(r => setTimeout(r, 50));
    const r = await window.PPPEngrave.app.resolve(A.state.score, { key: id });
    return { via: r.via, fp: window.PPPScoreGraph.fingerprint(r.graph), link: r.link.ok };
  }, xmlSong);
  ok('so does another song, opened from My Songs', x2.via === 'store' && x2.fp === x1.fp && x2.link, JSON.stringify(x2));

  console.log('\n-- a kept graph is damaged');
  await page.evaluate(async id => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('ppp-engrave');
      req.onsuccess = () => {
        const t = req.result.transaction('graphs', 'readwrite');
        const s = t.objectStore('graphs');
        const g = s.get(id);
        g.onsuccess = () => { const rec = g.result; if (!rec) return; rec.data = new Uint8Array([31, 139, 8, 0, 1, 2, 3]).buffer; s.put(rec); };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, xmlSong);
  await page.reload({ waitUntil: 'networkidle2' });
  await boot();
  const x3 = await resolveCurrent();
  ok('the song still opens, from a graph rebuilt from its Score', x3.songId === xmlSong && x3.via === 'projected' && x3.link, JSON.stringify(x3));
  ok('the damage is named', x3.diag.some(d => /^STORE_/.test(d)), x3.diag.join(','));
  ok('and the damaged graph is gone', (await keys()).indexOf(xmlSong) < 0);
  const drawn = await page.evaluate(() => { const svg = document.querySelector('.ppp-staffwrap svg'); return svg ? svg.querySelectorAll('g.ppp-note').length : 0; });
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(1500);
  const drawn2 = await page.evaluate(() => { const svg = document.querySelector('.ppp-staffwrap svg'); return svg ? svg.querySelectorAll('g.ppp-note').length : 0; });
  /* G4f-2: the default renderer draws it - the engraver since the flip (G4a wrote "the legacy renderer", then the default) */
  ok('and the default renderer draws it', Math.max(drawn, drawn2) > 0, drawn + '/' + drawn2 + ' note groups');

  console.log('\n-- every Score a screen can show gets a graph');
  const all = await page.evaluate(async () => {
    const A = window.PPP.app, P = window.PPP, E = window.PPPEngrave.app;
    const out = [];
    for (const s of A.state.library || []) {
      const d = A.readSong(s.id);
      if (!d || !d.score) continue;
      const score = P.Score.finalize(P.unpackScore(d.score));
      const r = await E.resolve(score, { key: s.id });
      out.push({ id: s.id, via: r.via, graph: !!r.graph, link: r.link.ok });
    }
    const q = E.resolveSync(A.quizScore());
    out.push({ id: 'quiz', via: q.via, graph: !!q.graph, link: q.link.ok });
    return out;
  });
  ok('My Songs, the thumbnails and the quiz', all.length >= 4 && all.every(x => x.graph && x.link), JSON.stringify(all));

  console.log('\n-- a song is removed');
  await page.evaluate(id => window.PPP.app.removeSong(id, { quiet: true }), midSong);
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) { gone = (await keys()).indexOf(midSong) < 0; if (!gone) await sleep(200); }
  ok('its graph goes with it', gone);

  const stats = await page.evaluate(() => JSON.parse(JSON.stringify(window.PPPEngrave.app.stats)));
  console.log('\n  stats', JSON.stringify(stats));
  ok('no page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  ok('no engrave warning', engraveWarnings.length === 0, engraveWarnings.slice(0, 2).join(' | '));
  await browser.close();
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nG4a in the page: all checks passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
