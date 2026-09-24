/* G4-U1 on the paths a person takes (docs/GOALS/G04 §8.2, §32; fixer P3). Local, like the G2 page checks.

     PORT=8793 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/u1-paths.js [--url http://127.0.0.1:8793] [--json out.json]

   Each song enters the app through startImport(), the method the upload button and a dropped file call, so the
   import door, the review screen's pending song, enterSong, saveNow and writeSlot are the app's own. What this
   machine does not run is replaced at its edge only:
     recording        Import.fromRecording -> Import.finishHeard(heard) with the notes of a G0 golden input: everything
                      after the transcription service (toMusicXml, parseMusicXML, validation, adoption) is the app's
     rewrite          rewriteRhythm() and rewriteFromHeard() on that recording, then saveNow() (what leaving the page does)
     catalogue match  the same edge, with finishHeard's catalogue answer (the public-domain Fur Elise)
     OMR (photo)      Import.imageToPage / health / recognise -> the committed OMR fixture's MusicXML
     OMR fallback     the same, with the Score changed after it is read the way PdfLayer.apply changes it (a chord name)
   Then the page is reloaded, every song is opened from My Songs, and its render source is resolved. For each path:
   via before and after the reload, the graph's fingerprint, what the store kept, and the source's counters. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8793') + '/Piano%20Coach%20App.dc.html';
const rd = p => fs.readFileSync(path.join(REPO, p));
const errors = [];
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) errors.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FILES = {
  musicxml: { name: 'e16-dynamics.musicxml', bytes: [...rd('tests/engrave/fixtures/e/E16-dynamics-hairpins.musicxml')] },
  mxl: { name: 'czerny849-001.mxl', bytes: [...rd('catalog/method/czerny849/001.mxl')] },
  midi: { name: 'twenty-notes.mid', bytes: [...rd('tests/scoregraph/fixtures/midi/m27-twenty-notes.mid')] }
};
const GOLDEN = JSON.parse(rd('tests/bench/golden/inputs/G16.json').toString('utf8'));
const FUR = rd('catalog/fur-elise.musicxml').toString('utf8');
const OMR = rd('tests/bench/corpus/omr/piano-test-score.musicxml').toString('utf8');
const WAV = [...Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), ...new Array(64).fill(0)];
const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(64).fill(0)];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 180000 });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 900 });
  const boot = async () => { await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 }); await sleep(800); };
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await boot();
  /* a clean store for this run */
  await page.evaluate(async () => { const st = window.PPPEngrave.app.store; for (const k of await st.keys()) await st.del(k); });

  /* in the page: import through startImport with the given edges replaced, wait for the song, wait for its save */
  await page.evaluate(() => {
    window.__u1 = {
      async run(src, patch) {
        const A = window.PPP.app, I = window.PPP.Import, E = window.PPPEngrave.app;
        const before = A.state.songId;
        const orig = {};
        Object.keys(patch || {}).forEach(k => { orig[k] = I[k]; I[k] = patch[k]; });
        try {
          const f = new File([new Uint8Array(src.bytes)], src.name);
          A.startImport({ file: f, name: src.name, kind: I.kindOf(f) });
          for (let i = 0; i < 300 && (A.state.songId === before || A.state.analysis !== 'done'); i++) await new Promise(r => setTimeout(r, 100));
        } finally { Object.keys(orig).forEach(k => { I[k] = orig[k]; }); }
        if (A.state.songId === before) return { error: A.state.parseError || 'no song' };
        return this.settle();
      },
      async settle(wantFp) {
        const A = window.PPP.app, E = window.PPPEngrave.app;
        const songId = A.state.songId, score = A.state.score;
        const r = await E.resolve(score, { key: songId });
        const fp = r.graph ? window.PPPScoreGraph.fingerprint(r.graph) : null;
        /* the save runs when the page is idle: wait until the store holds this song's graph, or the save said why not */
        let kept = null;
        for (let i = 0; i < 80; i++) {
          const rec = await E.store.get(songId);
          kept = rec.ok ? window.PPPScoreGraph.fingerprint(rec.graph) : null;
          if (kept && kept === (wantFp || fp)) break;
          if (r.via !== 'live' && i > 20) break;
          await new Promise(res => setTimeout(res, 150));
        }
        return { songId: songId, scoreId: score.id, via: r.via, producer: r.producer || null, fp: fp, kept: kept,
          diag: (r.diagnostics || []).map(d => d.code), persist: JSON.parse(JSON.stringify(E.stats.persist)) };
      }
    };
  });

  const results = {};
  const report = (name, r) => { results[name] = r; console.log('  ' + name.padEnd(16) + JSON.stringify(r)); };

  console.log('\n-- imports, as a person makes them');
  report('musicxml', await page.evaluate(src => window.__u1.run(src), FILES.musicxml));
  report('mxl', await page.evaluate(src => window.__u1.run(src), FILES.mxl));
  report('midi', await page.evaluate(src => window.__u1.run(src), FILES.midi));

  report('recording', await page.evaluate((wav, golden) => window.__u1.run({ name: 'g16-recording.wav', bytes: wav }, {
    fromRecording: (what, onStage) => window.PPP.Import.finishHeard({ heard: Object.assign({}, golden.input, { engine: 'transkun', duration: 30 }),
      title: 'G16 recording', audioUrl: null }, what, onStage)
  }), WAV, GOLDEN));

  console.log('\n-- the recording, rewritten');
  report('rewrite-rhythm', await page.evaluate(async () => {
    const A = window.PPP.app, before = A.state.score;
    A.rewriteRhythm();
    for (let i = 0; i < 50 && A.state.score === before; i++) await new Promise(r => setTimeout(r, 100));
    if (A.state.score === before) return { error: 'the rhythm was not rewritten' };
    A.saveNow();
    return window.__u1.settle();
  }));
  report('rewrite-heard', await page.evaluate(async () => {
    const A = window.PPP.app, before = A.state.score;
    A.rewriteFromHeard({ easy: true });
    for (let i = 0; i < 50 && A.state.score === before; i++) await new Promise(r => setTimeout(r, 100));
    if (A.state.score === before) return { error: 'not rewritten' };
    A.saveNow();
    return window.__u1.settle();
  }));

  console.log('\n-- a recording the catalogue recognises');
  report('catalog-match', await page.evaluate((wav, xml) => window.__u1.run({ name: 'fur-elise-recording.wav', bytes: wav }, {
    fromRecording: (what, onStage) => window.PPP.Import.finishHeard({ heard: { engine: 'catalog', xml: xml, title: 'Fur Elise', composer: 'Beethoven',
      duration: 120, barStarts: Array.from({ length: 120 }, (_, i) => i) }, title: 'Fur Elise', audioUrl: null }, what, onStage)
  }), WAV, FUR));

  console.log('\n-- a photo of a page');
  const omrEdges = xml => ({
    imageToPage: async () => [{ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', width: 1, height: 1, layer: null }],
    health: async () => ({ ok: true, audiveris: true }),
    recognise: async () => ({ engine: 'Audiveris (page check)', pages: [{ index: 0, ok: true }], musicxml: [xml] })
  });
  report('omr', await page.evaluate((png, xml, edges) => {
    const e = eval('(' + edges + ')')(xml);
    return window.__u1.run({ name: 'page.png', bytes: png }, e);
  }, PNG, OMR, omrEdges.toString()));
  report('omr-fallback', await page.evaluate((png, xml, edges) => {
    const e = eval('(' + edges + ')')(xml);
    const validate = window.PPP.Import.validate;
    /* what PdfLayer.apply does to a Score read from a PDF: it writes the page's chord names into it */
    e.validate = function (score, o) { score.chords = (score.chords || []).concat([{ m: score.measures[0].number, b: 0, text: 'C' }]); return validate.call(this, score, o); };
    return window.__u1.run({ name: 'page-with-chords.png', bytes: png }, e);
  }, PNG, OMR, omrEdges.toString()));

  const kept = await page.evaluate(async () => window.PPPEngrave.app.store.keys());
  const statsBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.PPPEngrave.app.stats)));
  console.log('\n  kept graphs: ' + kept.length + '  stats ' + JSON.stringify(statsBefore));

  console.log('\n-- the page is reloaded, and every song opened from My Songs');
  await page.reload({ waitUntil: 'networkidle2' });
  await boot();
  const after = {};
  for (const name of Object.keys(results)) {
    const r = results[name];
    if (!r || r.error || after[r.songId]) continue;
    after[r.songId] = await page.evaluate(async id => {
      const A = window.PPP.app;
      A.openSong(id, { stay: true, quiet: true });
      for (let i = 0; i < 50 && A.state.songId !== id; i++) await new Promise(res => setTimeout(res, 50));
      const r2 = await window.PPPEngrave.app.resolve(A.state.score, { key: id });
      return { via: r2.via, fp: r2.graph ? window.PPPScoreGraph.fingerprint(r2.graph) : null, link: !!(r2.link && r2.link.ok),
        diag: (r2.diagnostics || []).map(d => d.code) };
    }, r.songId);
  }
  const final = {};
  Object.keys(results).forEach(name => {
    const r = results[name];
    const a = r && after[r.songId];
    final[name] = Object.assign({}, r, { afterReload: a });
    console.log('  ' + name.padEnd(16) + ' before ' + (r.via || r.error) + ' -> after ' + (a ? a.via + (a.fp && a.fp === r.kept ? ' (the kept graph)' : '') + (a.diag.length ? ' ' + a.diag.join(',') : '') : '-'));
  });

  console.log('\n-- what must hold');
  ['musicxml', 'mxl', 'midi', 'catalog-match'].forEach(n => {
    const r = final[n];
    ok(n + ': live, kept, and back from the store after a reload', r.via === 'live' && r.kept === r.fp && r.afterReload && r.afterReload.via === 'store' && r.afterReload.fp === r.fp && r.afterReload.link, JSON.stringify({ via: r.via, after: r.afterReload }));
  });
  /* the recording's song ends as the second rewrite: that graph is the one kept */
  const recSong = final['rewrite-heard'];
  ok('recording: live and kept', final.recording.via === 'live' && final.recording.kept === final.recording.fp);
  ok('rewrites: each live and kept in turn, the song\'s last one back after the reload',
    final['rewrite-rhythm'].via === 'live' && final['rewrite-rhythm'].kept === final['rewrite-rhythm'].fp && recSong.via === 'live' && recSong.kept === recSong.fp &&
    recSong.afterReload && recSong.afterReload.via === 'store' && recSong.afterReload.fp === recSong.fp && recSong.songId === final.recording.songId);
  ok('OMR (photo): live when the Score is what the XML says, and kept', final.omr.via === 'live' && final.omr.kept === final.omr.fp && final.omr.afterReload.via === 'store');
  ok('OMR fallback: the changed Score disagrees, nothing is kept, it is projected before and after the reload',
    final['omr-fallback'].via === 'projected' && final['omr-fallback'].diag.indexOf('SOURCE_DISAGREE') >= 0 && !final['omr-fallback'].kept &&
    final['omr-fallback'].afterReload.via === 'projected' && final['omr-fallback'].afterReload.link);
  ok('no page error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify({ results: final, statsBeforeReload: statsBefore, kept: kept }, null, 1));
  await browser.close();
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nG4-U1 on every path: all checks passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
