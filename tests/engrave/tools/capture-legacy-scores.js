/* Capture legacy Scores from the real app, for the Node tests of legacy.fromScore / agree / link (G04 A16, A48).

   node tests/engrave/tools/capture-legacy-scores.js [--url http://127.0.0.1:8791]

   Needs the app served (PORT=8791 node server.js) and puppeteer (NODE_PATH=D:/PPP/node_modules). Writes
   tests/engrave/fixtures/legacy/<name>.score.json: the Score object the renderer and the practice layer hold
   (Score.finalize'd: 8va moved, notes sorted, positions stamped), from each way a Score is made today:
     recording   toMusicXml (G3 off, audio-score.js in Node) -> parseMusicXML in the page, source marked as a
                 transcription the way the app marks it
     parse       parseMusicXML of MusicXML (the OMR, catalogue-match and legacy-import path)
     graph       scoreFromXml (the import door: graph -> toScore -> finalize)
     stored      any of those through packScore -> JSON -> unpackScore -> finalize (a song slot, reloaded)
     demo        buildDemoScore (the built-in sample, no file at all)
   A fixture changes only when the app's Score changes; re-run and commit the files with that change. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const A = require(path.join(REPO, 'audio-score.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8791') + '/Piano%20Coach%20App.dc.html';
const OUT = path.join(REPO, 'tests', 'engrave', 'fixtures', 'legacy');
const rd = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const golden = key => { const d = JSON.parse(rd('tests/bench/golden/inputs/' + key + '.json')); return A.toMusicXml(d.input, d.opts || {}).xml; };

const JOBS = [
  { name: 'recording-G02', how: 'recording', xml: () => golden('G02') },
  { name: 'recording-G03-triplets', how: 'recording', xml: () => golden('G03') },
  { name: 'recording-G06', how: 'recording', xml: () => golden('G06') },
  { name: 'parse-ottava-8va-8vb', how: 'parse', xml: () => rd('tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml') },
  { name: 'parse-engraving-stress', how: 'parse', xml: () => rd('tests/fixtures/engraving-stress.musicxml') },
  { name: 'parse-tuplets-nested', how: 'parse', xml: () => rd('tests/scoregraph/fixtures/xml/tuplets-nested.musicxml') },
  { name: 'parse-piano-marks', how: 'parse', xml: () => rd('tests/scoregraph/fixtures/xml/piano-marks.musicxml') },
  { name: 'parse-voices-4', how: 'parse', xml: () => rd('tests/scoregraph/fixtures/xml/voices-4.musicxml') },
  { name: 'graph-grand-staff', how: 'graph', xml: () => rd('tests/scoregraph/fixtures/xml/grand-staff.musicxml') },
  { name: 'graph-fur-elise', how: 'graph', xml: () => rd('catalog/fur-elise.musicxml') },
  { name: 'stored-recording-G02', how: 'stored-recording', xml: () => golden('G02') },
  { name: 'stored-graph-ottava', how: 'stored-graph', xml: () => rd('tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml') },
  { name: 'demo', how: 'demo', xml: () => null }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.Score && window.PPP.scoreFromXml, { timeout: 30000 });
  for (const job of JOBS) {
    const xml = job.xml();
    const out = await page.evaluate((how, xml, name) => {
      const P = window.PPP;
      const clean = s => JSON.parse(JSON.stringify(s, (k, v) => (k === '_byNumber' ? undefined : v)));
      const transcribed = s => { s.source = { kind: 'audio', status: 'transcribed', amt: 'ensemble', transcriptionVersion: P.TRANSCRIPTION_VERSION }; return s; };
      const reload = s => P.Score.finalize(P.unpackScore(JSON.parse(JSON.stringify(P.packScore(s)))));
      let s;
      if (how === 'recording') s = transcribed(P.parseMusicXML(xml, name));
      else if (how === 'parse') s = P.parseMusicXML(xml, name);
      else if (how === 'graph') s = P.scoreFromXml(xml, name);
      else if (how === 'stored-recording') s = reload(transcribed(P.parseMusicXML(xml, name)));
      else if (how === 'stored-graph') s = reload(P.scoreFromXml(xml, name));
      else if (how === 'demo') s = P.buildDemoScore();
      return clean(s);
    }, job.how, xml, job.name + '.musicxml');
    /* the id carries Date.now(); a fixed one keeps the fixture stable */
    out.id = 'fixture:' + job.name;
    const file = path.join(OUT, job.name + '.score.json');
    fs.writeFileSync(file, JSON.stringify({ name: job.name, how: job.how, score: out }) + '\n');
    console.log(job.name, out.notes.length, 'notes', Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
