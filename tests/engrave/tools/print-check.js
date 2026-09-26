/* G4e: print a real page's print command through headless Chrome (docs/GOALS/G04 §17, §27 G4e card - "look at the
   output"). Local: needs this tree served and puppeteer.

     NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/print-check.js --url http://127.0.0.1:8801
       [--out tests/engrave/out/print]

   For each of SONGS: opens the app's default page (the engraver since the G4f-2 flip; G4e opened ?renderer=engrave,
   then the only way to the command - --renderer engrave does that still), checks the "Print / Save as PDF" command is
   shown in the whole-score view, loads the piece the way a person's song opens (the
   import door - scoreFromXml/scoreFromFile - or the app's own reader), switches to the whole-score view, then calls
   window.PPPEngravePage.printScore() itself (the same function the "Print / Save as PDF" button calls) - the real
   pipeline: PPPEngrave.app.resolve, printLayout, printSvgs, the hidden container, document.fonts.ready,
   window.print(). Puppeteer's page.pdf() substitutes for a person's own "Save as PDF": Chrome headless renders
   exactly what @media print shows (G04 §27 G4e: "puppeteer's page.pdf() can substitute"). Writes one PDF a piece to
   <out> (gitignored, tests/engrave/out/) and a JSON summary; exit 1 on any failure. No G0 hold-out file is opened.

   G4f-2 review R2: then the shared seed songs (catalog/shared-seeds.json), opened as a shared song opens, whole score:
   the command is shown exactly when the engraver drew the song - a song that fell back to the legacy renderer (its
   source disagrees, so the print layout has nothing to read) shows none - and asking such a song to print anyway (the
   app's own printScore(), window.print stubbed) tells the person, in a toast, instead of doing nothing. All 7 real
   seeds now agree (G4 polish m2 fixed catalog/build-shared-seeds.js's wrong <stave-count> tag), so a cloned,
   deliberately re-broken seed is the negative control that keeps the gating itself under test. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const H = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://127.0.0.1:8801');
/* the page's renderer: 'default' (no ?renderer - what a person gets) or a ?renderer= value */
const RENDERER = arg('--renderer', 'default');
const OUT = path.resolve(REPO, arg('--out', 'tests/engrave/out/print'));
fs.mkdirSync(OUT, { recursive: true });
const rd = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const HOLDOUT = H.holdoutPaths();
const notHoldout = p => { if (HOLDOUT.has(p)) throw new Error('a G0 hold-out file is never opened here'); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* four real catalogue pieces (one long enough for several pages), plus two fixtures for the features their names
   check: E28 multi-rest merging, E35 a multi-part score (its part name on the first system) */
const SONGS = [
  { name: 'fur-elise.musicxml', how: 'xml', xml: () => rd(notHoldout('catalog/fur-elise.musicxml')) },
  { name: 'for-all-the-saints.musicxml', how: 'xml', xml: () => rd(notHoldout('catalog/hymns/for-all-the-saints.musicxml')) },
  { name: 'czerny849-002.mxl', how: 'file', file: 'catalog/method/czerny849/002.mxl' },
  { name: 'sonatina-020.mxl', how: 'file', file: 'catalog/method/sonatina/020.mxl' },
  { name: 'E28-multirest.musicxml', how: 'xml', xml: () => rd('tests/engrave/fixtures/e/E28-multirest.musicxml') },
  { name: 'E35-voice-and-piano.musicxml', how: 'xml', xml: () => rd('tests/engrave/fixtures/e/E35-voice-and-piano.musicxml') }
];

async function openPage(browser) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(BASE + '/Piano%20Coach%20App.dc.html' + (RENDERER === 'default' ? '' : '?renderer=' + RENDERER), { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex && window.Vex.Flow, { timeout: 30000 });
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(500);
  page.__logs = logs;
  return page;
}
async function openSong(page, s) {
  const load = s.how === 'file'
    ? page.evaluate(async (bytes, name) => {
      const P = window.PPP, App = P.app;
      const score = await P.scoreFromFile(new File([new Uint8Array(bytes)], name));
      score.id = 'print-check:' + name;
      App.shelveSong(); App.adoptScore(score);
      App.enterSong(score, { kind: 'mxl', name: name, importedAt: 0, status: 'parsed' }, false);
      App.go('player')();
      await new Promise(r => App.setState({ wholeScore: true, beat: 0, playing: false }, r));
    }, [...fs.readFileSync(path.join(REPO, notHoldout(s.file)))], path.basename(s.file))
    : page.evaluate(async (how, xml, name) => {
      const P = window.PPP, App = P.app;
      const score = how === 'xml' ? P.scoreFromXml(xml, name) : P.parseMusicXML(xml, name);
      score.id = 'print-check:' + name;
      App.shelveSong(); App.adoptScore(score);
      App.enterSong(score, { kind: 'musicxml', name: name, importedAt: 0, status: 'parsed' }, false);
      App.go('player')();
      await new Promise(r => App.setState({ wholeScore: true, beat: 0, playing: false }, r));
    }, s.how, s.xml(), s.name);
  await load;
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const svg = await page.evaluate(() => { const s = document.querySelector('.ppp-staffwrap svg'); return !!(s && s.__ppp); });
    if (svg) break;
  }
}
/* the print command itself, in the page - the same call the button makes (App printScore()) */
async function printIt(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    if (!window.PPPEngravePage) { reject(new Error('engrave/page.js not loaded')); return; }
    const App = window.PPP.app;
    const score = App.state.score;
    window.PPPEngravePage.printScore({
      source: () => window.PPPEngrave.app,
      songKey: () => App.state.songId || null,
      window: window, document: document
    }, score).then(resolve, reject);
  }));
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const summary = { url: BASE, pieces: [] };
  let failed = 0;
  try {
    for (const s of SONGS) {
      const page = await openPage(browser);
      try {
        await openSong(page, s);
        /* the command a person presses is there (whole-score view, the engraver's page) */
        const shown = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Print / Save as PDF'));
        if (!shown) throw new Error('the "Print / Save as PDF" command is not shown in the whole-score view');
        const r = await printIt(page);
        const ok = r && r.ok;
        const pageCount = await page.evaluate(() => document.querySelectorAll('#ppp-print-root .ppp-print-page').length);
        /* window.print() was actually called (stubbed by preparePage/the test harness's own print stub if any; here we
           just confirm the container built the right number of pages and no raster, then take Chrome's own PDF of
           the print media - the closest thing to a person choosing "Save as PDF" in the dialog window.print() opens */
        const outFile = path.join(OUT, s.name.replace(/\.(musicxml|mxl)$/, '') + '.pdf');
        await page.pdf({ path: outFile, printBackground: true, preferCSSPageSize: true });
        const stat = fs.statSync(outFile);
        console.log((ok ? 'ok  ' : 'FAIL') + ' ' + s.name + ' - pages ' + pageCount + ' (engine: ' + (r && r.pages) + '), raster ' +
          JSON.stringify(r && r.raster) + ', pdf ' + stat.size + ' bytes -> ' + path.relative(REPO, outFile));
        if (!ok || pageCount !== (r && r.pages) || !(r && r.raster && r.raster.ok)) failed++;
        summary.pieces.push({ name: s.name, ok: !!ok, pages: pageCount, enginePages: r && r.pages, raster: r && r.raster, pdfBytes: stat.size, logs: page.__logs.slice(0, 20) });
      } catch (e) {
        failed++;
        console.log('FAIL ' + s.name + ' - ' + e.message);
        summary.pieces.push({ name: s.name, ok: false, error: e.message, logs: page.__logs.slice(0, 20) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  /* G4f-2 review R2: the shared seed songs - the command only where the engraver drew; a refused print is said */
  {
    const browser2 = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    try {
      const page = await openPage(browser2);
      await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
      const seeds = JSON.parse(rd('catalog/shared-seeds.json')).seeds;
      /* a deliberate negative control (G4 polish m2): every real seed now agrees (catalog/build-shared-seeds.js used
         to write the non-standard <stave-count> instead of MusicXML's <staves>, so 4 of 7 seeds looked single-staff
         and their staff 2 came back hand 'x' - fixed). To keep proving the gating itself still works, clone one seed
         and break it the same way that bug did: force a hand no 2-staff layout can reproduce. */
      const broken = JSON.parse(JSON.stringify(seeds[0]));
      broken.id = 'synthetic-broken-hand'; broken.title = 'synthetic (m2 negative control)';
      broken.score.notes.filter(n => (n.staff || 1) === 2).forEach(n => { n.hand = 'x'; });
      const allSeeds = seeds.concat([broken]);
      summary.seeds = [];
      let fell = 0, drew = 0;
      for (const seed of allSeeds) {
        const r = await page.evaluate(async seed => {
          const P = window.PPP, App = P.app;
          const score = P.Score.finalize(P.unpackScore(JSON.parse(JSON.stringify(seed.score))));
          score.id = 'shared:' + seed.id;
          App.shelveSong(); App.adoptScore(score);
          App.enterSong(score, { kind: 'shared', name: seed.title, importedAt: 0, status: 'parsed' }, false);
          App.go('player')();
          await new Promise(r => App.setState({ wholeScore: true, beat: 0, playing: false }, r));
          for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const s = document.querySelector('.ppp-staffwrap svg'); if (s && s.__ppp) break; }
          await new Promise(r => setTimeout(r, 400));
          const svg = document.querySelector('.ppp-staffwrap svg');
          const shown = [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Print / Save as PDF');
          const engraved = !!(svg && svg.classList.contains('ppp-engraved'));
          let toast = null;
          if (!engraved) {
            App.setState({ toast: '' });
            App.printScore();
            for (let i = 0; i < 40 && !App.state.toast; i++) await new Promise(r => setTimeout(r, 100));
            toast = App.state.toast || null;
          }
          return { id: seed.id, engraved, shown, toast };
        }, seed);
        const ok = r.shown === r.engraved && (r.engraved || !!r.toast);
        if (!ok) failed++;
        if (r.engraved) drew++; else fell++;
        console.log((ok ? 'ok  ' : 'FAIL') + ' shared seed ' + r.id + ' - drawn by the engraver ' + r.engraved + ', command shown ' + r.shown + (r.toast ? ', a print asked anyway says "' + r.toast + '"' : ''));
        summary.seeds.push(r);
      }
      if (drew !== seeds.length) { failed++; console.log('FAIL all ' + seeds.length + ' real seeds should draw with the engraver now (drew ' + drew + ')'); }
      if (fell !== 1) { failed++; console.log('FAIL expected exactly the one synthetic negative control to fall back (fell ' + fell + ')'); }
      const prints = await page.evaluate(() => window.__prints);
      if (prints) { failed++; console.log('FAIL a refused print reached window.print (' + prints + ')'); }
      await page.close();
    } finally { await browser2.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'print-check.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(failed ? (failed + ' FAILED') : 'all pieces printed cleanly');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
