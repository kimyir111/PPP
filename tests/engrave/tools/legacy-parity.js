/* G4a draws nothing new (docs/GOALS/G04 §25, A45): the legacy renderer's SVG, byte for byte, against a build of
   another commit. Local: needs both builds served and puppeteer.

     PORT=8791 node server.js                                      (this branch)
     git archive 55d1bd5 | tar -x -C <dir>; cd <dir>; PORT=8792 node server.js   (the base)
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/legacy-parity.js --a http://127.0.0.1:8792 --b http://127.0.0.1:8791

   Each score is opened the same way in both (scoreFromXml, or the app's own parser, then adopt + enter song), drawn
   in the close view and the whole-score view, and the staff SVG is compared after numbering VexFlow's automatic
   element IDs in document order. Exit 1 on any difference. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const A = require(path.join(REPO, 'audio-score.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--a', 'http://127.0.0.1:8792'), HEAD = arg('--b', 'http://127.0.0.1:8791');
const rd = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const golden = key => { const d = JSON.parse(rd('tests/bench/golden/inputs/' + key + '.json')); return A.toMusicXml(d.input, d.opts || {}).xml; };
const SCORES = [
  { name: 'fur-elise', how: 'xml', xml: () => rd('catalog/fur-elise.musicxml') },
  { name: 'engraving-stress', how: 'parse', xml: () => rd('tests/fixtures/engraving-stress.musicxml') },
  { name: 'ottava', how: 'xml', xml: () => rd('tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml') },
  { name: 'piano-marks', how: 'xml', xml: () => rd('tests/scoregraph/fixtures/xml/piano-marks.musicxml') },
  { name: 'tuplets-nested', how: 'xml', xml: () => rd('tests/scoregraph/fixtures/xml/tuplets-nested.musicxml') },
  { name: 'voices-4', how: 'xml', xml: () => rd('tests/scoregraph/fixtures/xml/voices-4.musicxml') },
  { name: 'recording-G03', how: 'recording', xml: () => golden('G03') },
  { name: 'recording-G10', how: 'recording', xml: () => golden('G10') }
];

async function renders(url) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(url + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex && window.Vex.Flow, { timeout: 30000 });
  await page.evaluate(() => window.__pppTest.practice());
  await new Promise(r => setTimeout(r, 1200));
  const out = {};
  for (const s of SCORES) {
    const xml = s.xml();
    for (const whole of [false, true]) {
      const svg = await page.evaluate(async (how, xml, name, whole) => {
        const P = window.PPP, App = P.app;
        let score = how === 'xml' ? P.scoreFromXml(xml, name) : P.parseMusicXML(xml, name);
        if (how === 'recording') score.source = { kind: 'audio', status: 'transcribed', amt: 'ensemble', transcriptionVersion: P.TRANSCRIPTION_VERSION };
        score.id = 'parity:' + name;
        App.shelveSong();
        App.adoptScore(score);
        App.enterSong(score, { kind: 'musicxml', name: name, importedAt: 0, status: 'parsed' }, false);
        App.go('player')();
        await new Promise(r => App.setState({ wholeScore: whole, beat: 0, playing: false }, r));
        await new Promise(r => setTimeout(r, 700));
        const el = document.querySelector('.ppp-staffwrap svg');
        if (!el) return null;
        let n = 0;
        const ids = new Map();
        return el.outerHTML.replace(/vf-auto\d+/g, m => { if (!ids.has(m)) ids.set(m, 'vf-auto#' + (n++)); return ids.get(m); });
      }, s.how, xml, s.name + '.musicxml', whole);
      out[s.name + (whole ? ' (whole score)' : ' (close view)')] = svg;
    }
  }
  await browser.close();
  return out;
}

(async () => {
  const a = await renders(BASE), b = await renders(HEAD);
  let bad = 0;
  Object.keys(a).forEach(k => {
    const same = a[k] !== null && a[k] === b[k];
    if (!same) bad++;
    console.log((same ? '  same  ' : '  DIFF  ') + k + '  ' + (a[k] ? a[k].length : 'none') + ' / ' + (b[k] ? b[k].length : 'none') + ' chars');
  });
  console.log(bad ? '\n' + bad + ' DIFFERENT' : '\nthe legacy renderer draws byte for byte what ' + BASE + ' draws (' + Object.keys(a).length + ' renders)');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
