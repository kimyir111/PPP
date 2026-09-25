/* G4d-2 in the real page (docs/GOALS/G04 §16, §19, §24: A16, A31, A32, A33; A47 measured). Local: needs this tree served
   and puppeteer.

     NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/page-check.js --url http://127.0.0.1:8801 [--part a16,a31,a32,a33,corpus,perf,shots]
       [--out tests/engrave/out/page] [--cpu 1,4]

   Every part opens the app itself, the way a person's song is opened (scoreFromXml, parseMusicXML or an import through the
   import door, then adoptScore + enterSong), and draws it through ScoreView - the legacy renderer with ?renderer=legacy,
   the engraver with ?renderer=engrave:
     a16     the Score, PianoScore's playback plan and the practice judge's expected notes are byte for byte the same under
             both renderers, whole score and close view (the renderer reads the Score and changes nothing)
     a31     sonatina/020's whole score, a playback frame at a time: the elements whose class is written (a count of
             classList.toggle calls) are no more than the elements whose class changed (a MutationObserver), and the
             engraver's sync p95 (PPPEngravePage.stats.syncTimes) - at each --cpu rate; the legacy renderer's for contrast
     a32     a resize inside a breakpoint lays nothing out and draws nothing; across 720 px one layout, and back a cache hit;
             the close view's zoom lays out once per zoom, then from the cache
     a33     dark theme without paper: the noteheads, stems, staff lines and every .ppp-ann text are light; with paper, dark
             on the paper; switching draws nothing (CSS variables)
     corpus  every committed score a G4 set may read (helpers.corpusFiles: no G0 hold-out) and the E fixtures, through the
             import door (a live graph) and through the app's own reader (a projection): drawn by the engraver, or fell
             back - by code (A47 is judged in G4f; this measures it)
     perf    sonatina/020, whole score and close view, first draw, page turns, the playback frame, long tasks - at each
             --cpu rate, both renderers; and a reloaded song's resolve (the graph from the store)
     shots   PNGs of pieces under the engraver: whole score and close view, desktop and phone, and the dark theme
   Writes <out>/page-check.json and prints a summary; exit 1 when a16, a31, a32 or a33 fail. G0 hold-out files are never
   opened or named. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const H = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));
const A = require(path.join(REPO, 'audio-score.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://127.0.0.1:8801');
const PARTS = arg('--part', 'a16,a31,a32,a33,corpus,perf,shots').split(',');
const OUT = path.resolve(REPO, arg('--out', 'tests/engrave/out/page'));
const CPUS = arg('--cpu', '1,4').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const rd = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const HOLDOUT = H.holdoutPaths();
const notHoldout = p => { if (HOLDOUT.has(p)) throw new Error('a G0 hold-out file is never opened here'); return p; };
const golden = key => { const d = JSON.parse(rd('tests/bench/golden/inputs/' + key + '.json')); return A.toMusicXml(d.input, d.opts || {}).xml; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { url: BASE, when: null, parts: {} };
let failed = 0;
const check = (part, name, ok, detail) => {
  (report.parts[part] = report.parts[part] || { checks: [] }).checks.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail !== undefined ? ' - ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
};

async function openPage(browser, renderer, width, height) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (/\[ppp\]/.test(m.text())) logs.push(m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await preparePage(page);
  await page.setViewport({ width: width || 1400, height: height || 1000 });
  await page.goto(BASE + '/Piano%20Coach%20App.dc.html?renderer=' + renderer, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex && window.Vex.Flow, { timeout: 30000 });
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(800);
  page.__logs = logs;
  return page;
}
async function cpu(page, rate) {
  const s = await page.target().createCDPSession();
  await s.send('Emulation.setCPUThrottlingRate', { rate: rate });
  return s;
}
/* a song, opened the way the app opens one (how: xml = scoreFromXml, the import door's live graph; parse = the app's own
   reader, a projection; recording = the recording path's Score) - then drawn */
async function openSong(page, s, whole) {
  return page.evaluate(async (how, xml, name, whole) => {
    const P = window.PPP, App = P.app;
    let score = how === 'xml' ? P.scoreFromXml(xml, name) : P.parseMusicXML(xml, name);
    if (how === 'recording') score.source = { kind: 'audio', status: 'transcribed', amt: 'ensemble', transcriptionVersion: P.TRANSCRIPTION_VERSION };
    score.id = 'check:' + name;
    App.shelveSong();
    App.adoptScore(score);
    App.enterSong(score, { kind: 'musicxml', name: name, importedAt: 0, status: 'parsed' }, false);
    App.go('player')();
    await new Promise(r => App.setState({ wholeScore: whole, beat: 0, playing: false }, r));
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      const svg = document.querySelector('.ppp-staffwrap svg');
      if (svg && svg.__ppp) break;
    }
    const svg = document.querySelector('.ppp-staffwrap svg');
    return { engraved: !!(svg && svg.classList.contains('ppp-engraved')), via: svg && svg.__ppp && svg.__ppp.engraved ? svg.__ppp.engraved.via : null };
  }, s.how, s.xml(), s.name, !!whole);
}

const SONGS = [
  { name: 'fur-elise.musicxml', how: 'xml', xml: () => rd(notHoldout('catalog/fur-elise.musicxml')) },
  { name: 'sonatina-020.mxl', how: 'file', file: 'catalog/method/sonatina/020.mxl' },
  { name: 'engraving-stress.musicxml', how: 'parse', xml: () => rd('tests/fixtures/engraving-stress.musicxml') },
  { name: 'E18-ottava.musicxml', how: 'xml', xml: () => rd('tests/engrave/fixtures/e/E18-ottava.musicxml') },
  { name: 'piano-marks.musicxml', how: 'xml', xml: () => rd('tests/scoregraph/fixtures/xml/piano-marks.musicxml') },
  { name: 'for-all-the-saints.musicxml', how: 'xml', xml: () => rd(notHoldout('catalog/hymns/for-all-the-saints.musicxml')) },
  { name: 'recording-G03', how: 'recording', xml: () => golden('G03') }
];
/* an .mxl read in the page through the app's own file reader, the import door (scoreFromFile) */
async function openFile(page, rel, whole, extra) {
  const bytes = [...fs.readFileSync(path.join(REPO, notHoldout(rel)))];
  return page.evaluate(async (bytes, name, whole, extra) => {
    const P = window.PPP, App = P.app;
    const score = await P.scoreFromFile(new File([new Uint8Array(bytes)], name));
    score.id = 'check:' + name;
    App.shelveSong();
    App.adoptScore(score);
    App.enterSong(score, { kind: 'mxl', name: name, importedAt: 0, status: 'parsed' }, false);
    App.go('player')();
    await new Promise(r => App.setState(Object.assign({ wholeScore: whole, beat: 0, playing: false }, extra || {}), r));
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100));
      const svg = document.querySelector('.ppp-staffwrap svg');
      if (svg && svg.__ppp) break;
    }
    const svg = document.querySelector('.ppp-staffwrap svg');
    return { engraved: !!(svg && svg.classList.contains('ppp-engraved')), via: svg && svg.__ppp && svg.__ppp.engraved ? svg.__ppp.engraved.via : null };
  }, bytes, path.basename(rel), !!whole, extra || null);
}
const open = (page, s, whole) => (s.file ? openFile(page, s.file, whole) : openSong(page, s, whole));

/* what the practice layer and playback read, as text: the Score (packScore), PianoScore's plan, the judge's expected notes */
const practiceFacts = page => page.evaluate(() => {
  const P = window.PPP, App = P.app, score = App.state.score;
  const plain = (k, v) => (v instanceof Map ? { map: [...v.entries()] } : v instanceof Set ? { set: [...v] } : v);
  const first = P.Score.first(score), last = P.Score.last(score);
  const eng = new P.PerformanceEngine(score);
  eng.begin({ from: first, to: last, hands: 'both', tempo: score.tempo || 84, startedAt: 0, practiceMode: 'practice' });
  return {
    score: JSON.stringify(P.packScore(score)),
    piano: JSON.stringify(P.PianoScore.build(score, first, last), plain),
    judge: JSON.stringify(eng.expected.map(e => Object.assign({}, e, { note: e.note ? { m: e.note.m, b: e.note.b, midi: e.note.midi, staff: e.note.staff, hand: e.note.hand } : null })))
  };
});

/* ------------------------------------------------------------------ A16 */
async function a16(browser) {
  console.log('\nA16: the Score, playback and the practice judge are the same under both renderers');
  const pages = { legacy: await openPage(browser, 'legacy'), engrave: await openPage(browser, 'engrave') };
  for (const s of SONGS) {
    const facts = {};
    for (const r of ['legacy', 'engrave']) {
      const views = [];
      for (const whole of [true, false]) {
        const o = await open(pages[r], s, whole);
        views.push(o);
        const f = await practiceFacts(pages[r]);
        facts[r + (whole ? ':whole' : ':close')] = { score: sha(f.score), piano: sha(f.piano), judge: sha(f.judge), engraved: o.engraved, via: o.via };
      }
    }
    const L = facts['legacy:whole'], rows = Object.values(facts);
    const same = rows.every(x => x.score === L.score && x.piano === L.piano && x.judge === L.judge);
    const drew = facts['engrave:whole'].engraved && facts['engrave:close'].engraved && !facts['legacy:whole'].engraved;
    check('a16', s.name + ': Score, PianoScore and judge byte-identical; the engraver drew under engrave (' + facts['engrave:whole'].via + ')', same && drew,
      { score: L.score, piano: L.piano, judge: L.judge, differs: rows.filter(x => x.score !== L.score || x.piano !== L.piano || x.judge !== L.judge).length });
  }
  report.parts.a16.fallbacks = await pages.engrave.evaluate(() => window.PPP.engraveStats.fallbacks);
  for (const p of Object.values(pages)) await p.close();
}

/* ------------------------------------------------------------------ A31 */
async function a31(browser) {
  console.log('\nA31: the page\'s sync - touched <= changed, p95');
  const out = {};
  for (const rate of CPUS) {
    for (const r of ['engrave', 'legacy']) {
      const page = await openPage(browser, r);
      await openFile(page, 'catalog/method/sonatina/020.mxl', true);
      const s = await cpu(page, rate);
      const res = await page.evaluate(async (frames) => {
        const App = window.PPP.app;
        const svg = document.querySelector('.ppp-staffwrap svg');
        const notes = new Set(svg.querySelectorAll('g.ppp-note'));
        /* what is written: classList.toggle calls on note groups; what changed: their class attribute, as observed */
        const touched = new Set();
        const orig = DOMTokenList.prototype.toggle;
        const owner = new WeakMap();
        notes.forEach(g => owner.set(g.classList, g));
        DOMTokenList.prototype.toggle = function () { const g = owner.get(this); if (g) touched.add(g); return orig.apply(this, arguments); };
        /* the observer's callback runs on the await below and would take the records itself: keep them */
        const seen = [];
        const mo = new MutationObserver(recs => { seen.push(...recs); });
        mo.observe(svg, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        const S = window.PPPEngravePage && window.PPPEngravePage.stats;
        const sync0 = S ? S.syncTimes.length : 0;
        const rows = [];
        let q = 0;
        for (let i = 0; i < frames; i++) {
          touched.clear();
          seen.length = 0;
          const t0 = performance.now();
          await new Promise(res => App.setState({ beat: q }, res));
          const dt = performance.now() - t0;
          const recs = seen.concat(mo.takeRecords()).filter(x => notes.has(x.target));
          const changed = new Set(recs.filter(x => x.oldValue !== x.target.getAttribute('class')).map(x => x.target));
          let over = 0;
          touched.forEach(g => { if (!changed.has(g)) over++; });
          rows.push([touched.size, changed.size, over, dt]);
          q += 0.08;
        }
        DOMTokenList.prototype.toggle = orig;
        mo.disconnect();
        const syncMs = S ? S.syncTimes.slice(sync0) : [];
        return { notes: notes.size, rows: rows, syncMs: syncMs };
      }, rate === 1 ? 1000 : 400);
      await s.detach();
      const p95 = a => { const x = a.slice().sort((u, v) => u - v); return x.length ? +x[Math.floor(x.length * 0.95)].toFixed(3) : null; };
      const touched = res.rows.map(x => x[0]), over = res.rows.reduce((t, x) => t + x[2], 0);
      out[r + '@' + rate + 'x'] = { notes: res.notes, frames: res.rows.length, touchedMax: Math.max(...touched), touchedMean: +(touched.reduce((a, b) => a + b, 0) / touched.length).toFixed(2),
        touchedNotChanged: over, frameP95: p95(res.rows.map(x => x[3])), syncP95: p95(res.syncMs), syncMax: res.syncMs.length ? +Math.max(...res.syncMs).toFixed(3) : null };
      console.log('  ' + r + ' @' + rate + 'x ' + JSON.stringify(out[r + '@' + rate + 'x']));
      if (r === 'engrave') {
        check('a31', 'engrave @' + rate + 'x: no frame writes a note whose class does not change', over === 0, out[r + '@' + rate + 'x'].touchedNotChanged + ' writes');
        if (rate === 1) check('a31', 'engrave @1x: sync p95 <= 1 ms on sonatina/020\'s whole score', out[r + '@1x'].syncP95 !== null && out[r + '@1x'].syncP95 <= 1, out[r + '@1x'].syncP95 + ' ms');
        else check('a31', 'engrave @' + rate + 'x: sync p95 <= 3 ms (A37\'s tablet budget for B6)', out[r + '@' + rate + 'x'].syncP95 !== null && out[r + '@' + rate + 'x'].syncP95 <= 3,
          out[r + '@' + rate + 'x'].syncP95 + ' ms');
      }
      await page.close();
    }
  }
  report.parts.a31.data = out;
}

/* ------------------------------------------------------------------ A32 */
async function a32(browser) {
  console.log('\nA32: a resize inside a breakpoint lays nothing out; zoom from the cache');
  const page = await openPage(browser, 'engrave', 1400, 1000);
  await openFile(page, 'catalog/method/sonatina/020.mxl', true);
  const st = () => page.evaluate(() => { const S = window.PPPEngravePage.stats; return { layouts: S.layouts, layoutHits: S.layoutHits, draws: S.draws }; });
  const repaint = () => page.evaluate(() => new Promise(r => window.PPP.app.setState({}, r)));
  const s0 = await st();
  for (const w of [1200, 1000, 800, 1600, 1400]) { await page.setViewport({ width: w, height: 1000 }); await repaint(); await sleep(150); }
  const s1 = await st();
  check('a32', 'whole score: five resizes between 800 and 1600 px - no layout, no drawing', s1.layouts === s0.layouts && s1.draws === s0.draws, { before: s0, after: s1 });
  await page.setViewport({ width: 700, height: 1000 }); await repaint(); await sleep(400);
  const s2 = await st();
  await page.setViewport({ width: 1400, height: 1000 }); await repaint(); await sleep(400);
  const s3 = await st();
  check('a32', 'across 720 px: one layout for the phone; back to the desktop from the cache', s2.layouts === s1.layouts + 1 && s3.layouts === s2.layouts && s3.layoutHits > s2.layoutHits,
    { phone: s2, back: s3 });
  /* the close view's zoom */
  await page.evaluate(() => new Promise(r => window.PPP.app.setState({ wholeScore: false, zoom: 1 }, r)));
  await sleep(300);
  const z0 = await st();
  const zooms = [1.25, 1, 1.25, 1.6, 1];
  const seen = [];
  for (const z of zooms) { await page.evaluate(z => new Promise(r => window.PPP.app.setState({ zoom: z }, r)), z); await sleep(200); seen.push(await st()); }
  const newLayouts = seen[seen.length - 1].layouts - z0.layouts;
  check('a32', 'close view zoom 1 -> 1.25 -> 1 -> 1.25 -> 1.6 -> 1: a layout for each new zoom only (2), the rest from the cache', newLayouts === 2, { before: z0, after: seen[seen.length - 1] });
  report.parts.a32.data = { s0, s1, s2, s3, z0, zoomed: seen };
  await page.close();
}

/* ------------------------------------------------------------------ A33 */
async function a33(browser) {
  console.log('\nA33: the ink follows the theme');
  const page = await openPage(browser, 'engrave', 1400, 1000);
  await open(page, SONGS[2], true);
  const lum = () => page.evaluate(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    const L = c => { const m = String(c).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : null; };
    /* the ink of what is not lit (a sounding note takes the accent) */
    const fillOf = sel => [...svg.querySelectorAll(sel)].filter(e => !e.closest('.ppp-on, .ppp-bad')).slice(0, 30).map(e => L(getComputedStyle(e).fill));
    const strokeOf = sel => [...svg.querySelectorAll(sel)].slice(0, 10).map(e => L(getComputedStyle(e).stroke));
    return { heads: fillOf('.vf-notehead'), stems: fillOf('.vf-stem'), ann: fillOf('text.ppp-ann'), staff: strokeOf('path.vf-stave'), draws: window.PPPEngravePage.stats.draws,
      theme: document.querySelector('[data-app]') && document.querySelector('[data-app]').getAttribute('data-app') };
  });
  const light = await lum();
  await page.evaluate(() => new Promise(r => window.PPP.app.setState(st => ({ theme: 'dark', toggles: Object.assign({}, st.toggles, { paper: false }) }), r)));
  await sleep(500);
  const dark = await lum();
  await page.evaluate(() => new Promise(r => window.PPP.app.setState(st => ({ toggles: Object.assign({}, st.toggles, { paper: true }) }), r)));
  await sleep(500);
  const paper = await lum();
  const all = (a, f) => a.length > 0 && a.every(v => v !== null && f(v));
  check('a33', 'dark theme, no paper: noteheads, stems and every label light (> 0.7), staff lines lighter than the page',
    all(dark.heads, v => v > 0.7) && all(dark.stems, v => v > 0.7) && all(dark.ann, v => v > 0.7) && all(dark.staff, v => v > 0.25),
    { heads: Math.min(...dark.heads).toFixed(2), ann: Math.min(...dark.ann).toFixed(2), staff: Math.min(...dark.staff).toFixed(2), theme: dark.theme });
  check('a33', 'light theme and dark theme on paper: the ink is dark (< 0.3)', all(light.heads, v => v < 0.3) && all(paper.heads, v => v < 0.3) && all(paper.ann, v => v < 0.3),
    { light: Math.max(...light.heads).toFixed(2), paper: Math.max(...paper.heads).toFixed(2) });
  check('a33', 'the theme and paper switches drew nothing (CSS variables)', dark.draws === light.draws && paper.draws === light.draws, [light.draws, dark.draws, paper.draws]);
  const shot = await page.$('.ppp-staffwrap');
  await page.evaluate(() => new Promise(r => window.PPP.app.setState(st => ({ toggles: Object.assign({}, st.toggles, { paper: false }) }), r)));
  await sleep(300);
  if (shot) await shot.screenshot({ path: path.join(OUT, 'a33-dark.png') });
  await page.close();
}

/* ------------------------------------------------------------------ the corpus (A47, measured) */
async function corpus(browser) {
  console.log('\nThe corpus in the page: drawn by the engraver, or fell back');
  const files = H.corpusFiles().concat(fs.readdirSync(path.join(REPO, 'tests/engrave/fixtures/e')).filter(f => f.endsWith('.musicxml')).sort()
    .map(f => 'tests/engrave/fixtures/e/' + f));
  const page = await openPage(browser, 'engrave', 1400, 1000);
  const rows = [];
  for (const rel of files) {
    const bytes = [...fs.readFileSync(path.join(REPO, notHoldout(rel)))];
    const r = await page.evaluate(async (bytes, name) => {
      const P = window.PPP, App = P.app, React = window.React, ReactDOM = window.ReactDOM;
      const out = {};
      let host = document.getElementById('__corpus');
      if (!host) { host = document.createElement('div'); host.id = '__corpus'; host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;opacity:0;pointer-events:none;'; document.body.appendChild(host); }
      const draw = async (score, tag) => {
        const before = JSON.stringify(P.engraveStats.fallbacks);
        const div = document.createElement('div');
        host.appendChild(div);
        const root = ReactDOM.createRoot(div);
        const n = score.measures.length;
        root.render(App.sv({ score: score, startM: score.measures[0].number, count: n, perRow: 4, fluid: true, heading: true, renderer: 'engrave' }));
        let res = 'timeout';
        for (let i = 0; i < 100; i++) {
          await new Promise(r => setTimeout(r, 50));
          const svg = div.querySelector('svg');
          if (JSON.stringify(P.engraveStats.fallbacks) !== before) { res = 'fallback:' + Object.keys(P.engraveStats.bySong).filter(k => k === score.id).map(k => P.engraveStats.bySong[k]).join(); break; }
          if (svg && svg.classList.contains('ppp-engraved') && svg.__ppp) { res = 'drawn:' + svg.__ppp.engraved.via; break; }
          if (svg && !svg.classList.contains('ppp-engraved')) { res = 'legacy'; break; }
        }
        root.unmount();
        div.remove();
        out[tag] = res;
      };
      let live = null;
      try { live = await P.scoreFromFile(new File([new Uint8Array(bytes)], name)); } catch (e) { out.open = 'refused: ' + (e.code || e.message); }
      if (live) { live.id = 'corpus:live:' + name; await draw(live, 'live'); }
      /* the app's own reader (a recording, a catalogue match, an OMR result): a projection */
      if (/\.(musicxml|xml)$/i.test(name)) {
        try {
          const text = new TextDecoder().decode(new Uint8Array(bytes));
          const s = P.parseMusicXML(text, name);
          s.id = 'corpus:parse:' + name;
          await draw(s, 'parse');
        } catch (e) { out.parse = 'refused: ' + e.message; }
      }
      return out;
    }, bytes, path.basename(rel));
    rows.push([rel, r]);
    if (Object.values(r).some(v => !/^drawn|^refused/.test(v))) console.log('  ' + rel + ' ' + JSON.stringify(r));
  }
  /* by outcome: drawn:<via>, fallback:<code>, legacy (routed), timeout, refused */
  const count = tag => {
    const c = {};
    rows.forEach(([, r]) => { if (!r[tag]) return; const k = /^refused/.test(r[tag]) ? 'refused' : r[tag]; c[k] = (c[k] || 0) + 1; });
    return c;
  };
  const summary = { files: files.length, live: count('live'), parse: count('parse'), refused: rows.filter(([, r]) => r.open).length,
    fallbacks: await page.evaluate(() => window.PPP.engraveStats.fallbacks), errors: page.__logs.filter(l => /pageerror/.test(l)).length };
  console.log('  ' + JSON.stringify(summary));
  report.parts.corpus = { summary: summary, rows: rows.filter(([, r]) => Object.values(r).some(v => !/^drawn/.test(v))) };
  await page.close();
}

/* ------------------------------------------------------------------ performance (judged in G4f) */
async function perf(browser) {
  console.log('\nPage performance: sonatina/020');
  const out = {};
  for (const rate of CPUS) {
    for (const r of ['engrave', 'legacy']) {
      const page = await openPage(browser, r, 1400, 1000);
      const s = await cpu(page, rate);
      await page.evaluate(() => {
        window.__long = [];
        new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
      });
      const t0 = Date.now();
      await openFile(page, 'catalog/method/sonatina/020.mxl', true);
      const whole = Date.now() - t0;
      const res = await page.evaluate(async () => {
        const App = window.PPP.app, S = window.PPPEngravePage && window.PPPEngravePage.stats;
        const long = () => { const l = window.__long.splice(0); return { n: l.length, max: l.length ? Math.round(Math.max(...l)) : 0 }; };
        const lastDraw = () => (S && S.last ? Object.fromEntries(Object.entries(S.last).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])) : null);
        const wholeDraw = lastDraw();
        const wholeLong = long();
        /* frames on the whole score */
        const fr = [];
        for (let i = 0, q = 0; i < 60; i++, q += 0.08) { const t = performance.now(); await new Promise(r => App.setState({ beat: q }, r)); fr.push(performance.now() - t); }
        const wholeFrameLong = long();
        /* the close view: open, then turn the page ten times (a new window each), then back over them (cached) */
        let t = performance.now();
        await new Promise(r => App.setState({ wholeScore: false, beat: 0, loopFrom: null, loopTo: null }, r));
        await new Promise(r => setTimeout(r, 50));
        const closeOpen = performance.now() - t, closeDraw = lastDraw();
        const turns = [], back = [];
        const lenOf = m => App.state.score.measures.find(x => x.number === m);
        const starts = App.state.score.measures.filter((m, i) => i % 4 === 0).slice(1, 11).map(m => m.startQ);
        for (const q of starts) { t = performance.now(); await new Promise(r => App.setState({ beat: q + 0.01 }, r)); turns.push(performance.now() - t); }
        for (const q of starts.slice().reverse()) { t = performance.now(); await new Promise(r => App.setState({ beat: q + 0.01 }, r)); back.push(performance.now() - t); }
        const closeLong = long();
        const cf = [];
        for (let i = 0, q = starts[0]; i < 40; i++, q += 0.08) { const t2 = performance.now(); await new Promise(r => App.setState({ beat: q }, r)); cf.push(performance.now() - t2); }
        void lenOf;
        return { wholeDraw, wholeLong, wholeFrames: fr, wholeFrameLong, closeOpen, closeDraw, turns, back, closeLong, closeFrames: cf,
          syncMs: S ? S.syncTimes.slice(-100) : [] };
      });
      await s.detach();
      const med = a => { const x = a.slice().sort((u, v) => u - v); return +x[Math.floor(x.length / 2)].toFixed(1); };
      const p95 = a => { const x = a.slice().sort((u, v) => u - v); return +x[Math.floor(x.length * 0.95)].toFixed(1); };
      out[r + '@' + rate + 'x'] = { wholeOpenMs: whole, wholeDraw: res.wholeDraw, wholeLong: res.wholeLong, wholeFrameMedian: med(res.wholeFrames), wholeFrameP95: p95(res.wholeFrames),
        wholeFrameLong: res.wholeFrameLong, closeOpenMs: +res.closeOpen.toFixed(1), closeDraw: res.closeDraw, turnMedian: med(res.turns), turnMax: +Math.max(...res.turns).toFixed(1),
        turnBackMedian: med(res.back), closeLong: res.closeLong, closeFrameMedian: med(res.closeFrames), closeFrameP95: p95(res.closeFrames),
        syncP95: res.syncMs.length ? p95(res.syncMs) : null };
      console.log('  ' + r + ' @' + rate + 'x ' + JSON.stringify(out[r + '@' + rate + 'x']));
      await page.close();
    }
  }
  /* a reloaded song: the graph from the store (G4-U1), at each rate */
  for (const rate of CPUS) {
    const page = await openPage(browser, 'engrave', 1400, 1000);
    const bytes = [...fs.readFileSync(path.join(REPO, 'catalog/method/sonatina/020.mxl'))];
    const kept = await page.evaluate(async bytes => {
      const A = window.PPP.app, I = window.PPP.Import, E = window.PPPEngrave.app;
      const before = A.state.songId;
      const f = new File([new Uint8Array(bytes)], 'sonatina-020-reload.mxl');
      A.startImport({ file: f, name: f.name, kind: I.kindOf(f) });
      for (let i = 0; i < 300 && (A.state.songId === before || A.state.analysis !== 'done'); i++) await new Promise(r => setTimeout(r, 100));
      const id = A.state.songId;
      for (let i = 0; i < 100; i++) { const r = await E.store.get(id); if (r.ok) return id; await new Promise(r => setTimeout(r, 150)); }
      return null;
    }, bytes);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex, { timeout: 30000 });
    const s = await cpu(page, rate);
    const r = await page.evaluate(async id => {
      const A = window.PPP.app;
      window.__long = [];
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
      if (A.state.songId !== id) A.openSong(id, { quiet: true });
      await new Promise(r => setTimeout(r, 300));
      window.__pppTest.practice();
      await new Promise(r => setTimeout(r, 300));
      await new Promise(r => A.setState({ wholeScore: true, beat: 0 }, r));
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 100));
        const svg = document.querySelector('.ppp-staffwrap svg');
        if (svg && svg.__ppp && svg.__ppp.engraved) break;
      }
      const svg = document.querySelector('.ppp-staffwrap svg');
      const S = window.PPPEngravePage.stats;
      return { via: svg && svg.__ppp && svg.__ppp.engraved ? svg.__ppp.engraved.via : null, resolveMs: S.last ? +(S.last.resolve || 0).toFixed(1) : null,
        long: window.__long.length, longMax: window.__long.length ? Math.round(Math.max(...window.__long)) : 0 };
    }, kept);
    await s.detach();
    out['reload@' + rate + 'x'] = Object.assign({ kept: !!kept }, r);
    console.log('  reload @' + rate + 'x ' + JSON.stringify(out['reload@' + rate + 'x']));
    await page.close();
  }
  report.parts.perf = { data: out };
}

/* ------------------------------------------------------------------ screenshots */
/* The score as drawn, whole: a copy of the view's SVG in a layer over the page, inside the app's theme and a .ppp-score with
   the view's own ink variables - the practice page clips its staff to a scroll box a screenshot cannot see past. */
async function lift(page, width) {
  const size = await page.evaluate(width => {
    const src = document.querySelector('.ppp-staffwrap .ppp-score');
    const svg = src && src.querySelector('svg');
    if (!svg) return null;
    let layer = document.getElementById('__shot');
    if (layer) layer.remove();
    layer = document.createElement('div');
    layer.id = '__shot';
    layer.className = 'ppp-score';
    /* the staff's own background, or the page's where the staff has none (no paper) */
    const bgOf = e => { const c = e ? getComputedStyle(e).backgroundColor : ''; return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : null; };
    const bg = bgOf(document.querySelector('.ppp-staffwrap')) || bgOf(document.querySelector('[data-app]')) || bgOf(document.body) || 'white';
    layer.style.cssText = src.style.cssText + ';position:absolute;left:0;top:0;z-index:2147483647;padding:12px;box-sizing:border-box;width:' + width + 'px;' +
      'background:' + bg + ';';
    (document.querySelector('[data-app]') || document.body).appendChild(layer);
    const copy = svg.cloneNode(true);
    copy.style.width = '100%';
    copy.style.maxWidth = '100%';
    copy.style.margin = '0';
    layer.appendChild(copy);
    window.scrollTo(0, 0);
    const b = layer.getBoundingClientRect();
    return { w: Math.ceil(b.width), h: Math.ceil(b.height) };
  }, width);
  if (!size) return false;
  const vp = page.viewport();
  if (size.h > vp.height) await page.setViewport({ width: vp.width, height: Math.min(8000, size.h + 20) });
  await sleep(200);
  return true;
}
async function shots(browser) {
  console.log('\nScreenshots under the engraver');
  const dir = path.join(OUT, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const PIECES = ['catalog/method/burgmuller25/015.mxl', 'catalog/method/sonatina/028.mxl', 'catalog/method/czerny849/020.mxl', 'catalog/hymns/for-all-the-saints.musicxml',
    'catalog/method/beyer/046.mxl'];
  const list = [];
  for (const [w, h, tag] of [[1400, 1000, 'desktop'], [390, 844, 'phone']]) {
    const page = await openPage(browser, 'engrave', w, h);
    for (const rel of PIECES) {
      for (const whole of [true, false]) {
        await openFile(page, rel, whole);
        await sleep(300);
        const file = path.join(dir, path.basename(path.dirname(rel)) + '-' + path.basename(rel).replace(/\.\w+$/, '') + '.' + tag + '.' + (whole ? 'whole' : 'close') + '.png');
        if (await lift(page, w)) { const el = await page.$('#__shot'); await el.screenshot({ path: file }); list.push(path.relative(REPO, file).replace(/\\/g, '/')); }
      }
    }
    await page.close();
  }
  /* the dark theme once, whole score */
  const page = await openPage(browser, 'engrave', 1400, 1000);
  await openFile(page, PIECES[0], true);
  await page.evaluate(() => new Promise(r => window.PPP.app.setState(st => ({ theme: 'dark', toggles: Object.assign({}, st.toggles, { paper: false }) }), r)));
  await sleep(500);
  const file = path.join(dir, 'burgmuller25-015.desktop.whole.dark.png');
  if (await lift(page, 1400)) { const el = await page.$('#__shot'); await el.screenshot({ path: file }); list.push(path.relative(REPO, file).replace(/\\/g, '/')); }
  await page.close();
  list.forEach(f => console.log('  ' + f));
  report.parts.shots = { files: list };
}

(async () => {
  report.when = new Date().toISOString();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
  try {
    const v = await (async () => { const p = await browser.newPage(); await p.goto(BASE + '/engrave/index.js'); const t = await p.evaluate(() => document.body.innerText); await p.close(); return (/version = '([^']+)'/.exec(t) || [])[1]; })();
    console.log('PPPEngrave ' + v + ' at ' + BASE);
    report.version = v;
    if (PARTS.includes('a16')) await a16(browser);
    if (PARTS.includes('a31')) await a31(browser);
    if (PARTS.includes('a32')) await a32(browser);
    if (PARTS.includes('a33')) await a33(browser);
    if (PARTS.includes('corpus')) await corpus(browser);
    if (PARTS.includes('perf')) await perf(browser);
    if (PARTS.includes('shots')) await shots(browser);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'page-check.json'), JSON.stringify(report, null, 1));
  console.log('\n' + (failed ? failed + ' FAILED' : 'all checks pass') + ' - ' + path.relative(REPO, path.join(OUT, 'page-check.json')));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
