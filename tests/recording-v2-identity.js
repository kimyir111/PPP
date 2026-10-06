/* G10a-5b: what the CLASSIC recording conversion hands the page, as a fingerprint (docs/GOALS/G10_AUDIO_TO_SCORE.md section 31).

   v2 is the default, so "PPP.recording = 'legacy'" (the chip off, ?recording=legacy, a remembered 'legacy') has to be what the page was before: the same heard notes give the same MusicXML, graph, stats and
   Score. Every conversion the page makes is recorded as the page's own PPPAudioScore.toMusicXml answers it (its options, sha-256 of the MusicXML, of the graph, of the stats), and the Score the
   review screen holds is hashed (notes, measures, key, tempo). tests/fixtures/g10a5b-classic-identity.json holds the hashes made from a clean build of origin/main 26417f4 (the last page whose default was
   classic; node tests/recording-v2-identity.js --write <url of that build's page> makes it again), and tests/recording-v2-app.test.js compares the page of this tree, with the classic method, to it.
   Nothing is stripped but the stub file's name (see stable()). */
'use strict';
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/* in the page, before the import: record every conversion */
async function installRecorder(page) {
  await page.evaluate(() => {
    const A = window.PPPAudioScore, real = A.toMusicXml;
    window.__fp = [];
    window.PPPAudioScore = Object.assign({}, A, { toMusicXml: function (i, o) {
      const r = real.apply(this, arguments);
      window.__fp.push({ options: JSON.stringify(o || {}, Object.keys(o || {}).sort()), xml: r.xml, graph: JSON.stringify(r.graph), stats: JSON.stringify(r.stats), keys: Object.keys(r).sort().join(), v2: !!r.recReport });
      return r;
    } });
  });
}
/* what differs from run to run: nothing but the stub file's name (it carries the test's process id and the page titles the song with it); two runs of origin/main's page gave the same hashes */
function stable(json) { return String(json).replace(/zz-ppp-fixture-\d+/g, 'zz-ppp-fixture-N'); }
/* after the import: the conversions and the Score */
async function fingerprint(page) {
  const raw = await page.evaluate(() => {
    const A = window.PPP.app, S = A.state, sc = S.score, src = S.importSource || {}, rep = S.importReport || {};
    return {
      calls: window.__fp,
      score: JSON.stringify({ notes: sc.notes.map(n => [n.m, n.b, n.midi, Math.round(n.dur * 1e6) / 1e6, n.rest ? 1 : 0, n.staff, n.voice, n.tupletStart ? 1 : 0, n.tieStart ? 1 : 0, n.tieStop ? 1 : 0]), measures: sc.measures.length,
        keys: sc.measures.map(m => m.key && m.key.fifths), tempo: sc.tempo }),
      sourceKeys: Object.keys(src).sort().join(), tempo: src.tempo, version: src.transcriptionVersion, pipeline: src.recordingPipeline || null, engine: src.engine, quantizer: src.quantizer,
      reportKeys: Object.keys(rep).sort().join(), issues: (rep.issues || []).map(i => i.kind).join(), level: rep.level
    };
  });
  return {
    calls: raw.calls.map(c => ({ options: stable(c.options), xml: sha(stable(c.xml)), graph: sha(stable(c.graph)), stats: sha(stable(c.stats)), keys: c.keys, v2: c.v2 })),
    score: sha(raw.score), sourceKeys: sha(raw.sourceKeys), tempo: raw.tempo, version: raw.version, pipeline: raw.pipeline, engine: raw.engine, quantizer: raw.quantizer,
    reportKeys: sha(raw.reportKeys), issues: raw.issues, level: raw.level
  };
}

/* the four heard-note fixtures of tests/recording-v2-app.test.js: three made from numbers (tests/recording-v2-fixtures.js) and a four-part hymn played the way a person plays it (each note held 90% of its
   length, a little timing noise: the notes come from the page's own reading of a committed hymn). L.setBase must have been called. */
async function heardFixtures(browser) {
  const F = require('./recording-v2-fixtures');
  const L = require('./recording-v2-lib');
  const heardFor = { sextuplets: F.sextuplets(14, 7), keys: F.keyChange([[20, 0], [16, 3], [20, 0]], 3, 0.004), pedal: F.pedalPiece(16, true) };
  const hp = await L.openPage(browser);
  const list = await hp.evaluate(async () => {
    const x = await (await fetch('/catalog/hymns/christ-arose.musicxml')).text();
    return window.PPP.parseMusicXML(x, 'christ-arose').notes.filter(n => !n.rest && !n.tieStop).map(n => ({ abs: n.abs, dur: n.dur, midi: n.midi }));
  });
  await hp.close();
  heardFor.hymn = { notes: F.performanceOf(list, 80, 11, 0.9) };
  return heardFor;
}

module.exports = { installRecorder, fingerprint, sha, stable, heardFixtures };

if (require.main === module) {
  /* node tests/recording-v2-identity.js --write <url of the page of the build to take it from> [out.json]: makes the committed fixture from that build (it must default to, or be told, 'legacy') */
  (async () => {
    const puppeteer = require('puppeteer');
    const L = require('./recording-v2-lib');
    const fs = require('fs'), path = require('path');
    const url = process.argv[3];
    if (process.argv[2] !== '--write' || !url) { console.log('usage: node tests/recording-v2-identity.js --write <page url> [out.json]'); process.exit(2); }
    const out = process.argv[4] || path.join(__dirname, 'fixtures', 'g10a5b-classic-identity.json');
    L.setBase(url);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
    const heardFor = await heardFixtures(browser);
    const got = {};
    for (const name of Object.keys(heardFor)) {
      const page = await L.openPage(browser, { store: L.CLASSIC });
      await installRecorder(page);
      await L.importHeard(page, heardFor[name]);
      got[name] = await fingerprint(page);
      await page.close();
    }
    fs.writeFileSync(out, JSON.stringify({ madeFrom: 'origin/main 26417f4 (PPP.recording legacy, the default then)', fixtures: got }, null, 1) + '\n');
    console.log('wrote ' + out + ' (' + Object.keys(got).length + ' fixtures)');
    await browser.close();
    try { fs.unlinkSync(L.WAV); } catch (e) { /* the temp file */ }
  })().catch(e => { console.error(e); process.exit(1); });
}
