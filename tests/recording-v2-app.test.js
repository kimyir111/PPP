/* ============================================================================
   G10a-4: the recording conversion v2 in the real page (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6 and 10)

   PPP.recording = 'legacy' (default) | 'v2'. What this checks, in the real page and the real screens (the transcription model is replaced by a stub that returns heard notes made
   from numbers, tests/recording-v2-fixtures.js; everything after the notes - the lazy load, the conversion, the review screen, Accept, the saved song, the reload, the Song Arranger - is the real app):
     - the switch: legacy by default; 'v2' accepted; any other value (typos, null, 'V2', 'g8', true) is legacy; remembered in localStorage ('v2' stored, the key removed for legacy), honoured
       from ?recording=v2, a value in the address is for that visit only
     - the lazy load: a fresh page, however long it stays and whichever screens open, asks for none of v2's 17 files; with v2 selected they come when the Add-sheet-music screen opens or the first
       conversion starts, once each, in the order rec/index.js's header gives, weights before the modules; a file that cannot be fetched (or arrives as something else) is asked for again ALONE - plus the few files that read its export when
       they loaded (model, metre and index read attacks, beats, hands) - and nothing that loaded is run twice; the conversion made meanwhile is the classic one, said so on the review screen
       (never a blank page)
     - the opt-in: the chip on the Add-sheet-music screen and on the review screen, off by default, in English, Korean, Japanese and Chinese, inside the viewport at 400 px, switching it sets PPP.recording
     - the conversion at the call sites: an import with v2 on is marked source.recordingPipeline 'v2' and transcriptionVersion 8 (TRANSCRIPTION_VERSION stays 7 for every other song), has its bars-that-add-up
       checks at zero (scoregraph/tools/notation-check.js classes 1-7, in the Score and in the graph), a graph that agrees with its Score (via 'live'), no validator error; a stated metre ("Rewrite the
       rhythm") is written the classic way and drops the mark; "Apply arrangement" uses the conversion that wrote the song while its rhythm controls are untouched
     - what is drawn = what is played: every sounded note is a drawn one at the same place, every drawn head is a Score note, a sounding length is the written length (and the pedal); on pieces with
       voices 2 and 6, 3:2 brackets of 16ths over half beats, pedal spanners and key changes; the saved song after a reload; the one-note arranger on the v2 graph does not crash
     - "Write the notation again": the same heard notes with the chosen method, Undo (the notation, its graph, its report and the practice progress that was there), nothing rewritten until it is pressed;
       also for a song opened from My Songs, whose heard notes are its kept graph's; not offered for a 'Full song' (playable piano arrangement) import, which is not a transcription; the shelf card
       says the new count of measures
     - the one-note arranger's refusal of a v2 song (ALL_CANDIDATES_HAVE_HARD_VIOLATIONS): one more try on the conversion of the same heard notes with the classic hands, marked in the copy's source;
       nothing else is retried
     - a v2 result the page cannot believe (a tempo outside the rhythm controls' range) is written the classic way and said so; Write again changes nothing
     - the flags: amber cells and a legend for the bars PPP was not sure about, kept in the saved report
     - "Play as recorded": the heard notes at their own times and velocities through the piano, the highlight follows, the ordinary Play and it stop each other, a song without heard notes says so
     - the classic path: a fresh page, an import and a rewrite with PPP.recording = 'legacy' have no v2 mark and no v2 request

   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build. node tests/recording-v2-app.test.js
   ========================================================================== */
'use strict';
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const F = require('./recording-v2-fixtures');
const L = require('./recording-v2-lib');
const { fs, path, REPO, errors, sleep, ok, REC_FILES, SCRIPTS, WEIGHTS, CATALOG, want, setBase, openPage, recReqs, clean, errs, addChecker, importHeard, press, stateOf, drawSound, arrangeCheck, accept, slotOf } = L;

const NEW_KEYS = [
  'New transcription method (experimental)', 'A newer way of reading the beat, the hands and the rests. Off keeps the classic method.',
  'This notation was written with the new method.', 'This notation was written with the classic method.', 'Write the notation again', 'Writing…',
  'Writes the notation of this song again from the notes PPP heard, with the method chosen above. The bars may change, so practice history for this song starts over.',
  'An arrangement made from it is taken off.', 'Undo', 'Wrote the notation again with the new method.', 'Wrote the notation again with the classic method.',
  'Before: {{m1}} measures, {{r1}} rests, {{b1}} tuplet brackets. Now: {{m2}} measures, {{r2}} rests, {{b2}} tuplet brackets.',
  'With the new method on, a metre or tempo you set here is written by the classic method. To let the new method decide again, use "Write the notation again".',
  'Measures where PPP was not sure of the hands or the beat ({{n}})', 'PPP was not sure of the beat', 'PPP was not sure which hand plays some notes',
  'The new transcription method could not be loaded, so the classic method wrote this score.', 'The new transcription method could not be used for this recording, so the classic method wrote this score.',
  'The new transcription method gave an unlikely tempo or length for this recording, so the classic method wrote this score.',
  'PPP read this piece as {{metre}} but was not sure of it ({{pct}}%); the bar lines may be in the wrong place.', 'The new transcription method could not be loaded, so nothing was changed.',
  'The heard notes of this song are not kept on this device, so its notation cannot be written again.', 'The new transcription method could not read this performance, so nothing was changed.',
  'Put back the notation that was there before.'
];

(async () => {
  const srv = await startServer();
  setBase(srv.url);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  const heardFor = {
    sextuplets: F.sextuplets(14, 7),
    keys: F.keyChange([[20, 0], [16, 3], [20, 0]], 3, 0.004),
    pedal: F.pedalPiece(16, true)
  };
  /* a four-part hymn played the way a person plays it (each note held 90% of its length, a little timing noise): the notes come from the page's own reading of a committed hymn */
  {
    const hp = await openPage(browser);
    const list = await hp.evaluate(async () => {
      const x = await (await fetch('/catalog/hymns/christ-arose.musicxml')).text();
      return window.PPP.parseMusicXML(x, 'christ-arose').notes.filter(n => !n.rest && !n.tieStop).map(n => ({ abs: n.abs, dur: n.dur, midi: n.midi }));
    });
    await hp.close();
    heardFor.hymn = { notes: F.performanceOf(list, 80, 11, 0.9) };
  }
  try {
    /* ------------------------------------------------------------------ the switch and the lazy load */
    if (want('basics')) {
    console.log('\n── the switch ──');
    const p0 = await openPage(browser);
    const sw = await p0.evaluate(() => {
      const P = window.PPP, out = { start: P.recording };
      P.recording = 'v2'; out.v2 = P.recording; out.stored = localStorage.getItem('ppp.recording.v1');
      [null, undefined, 'V2', 'v1', 'g8', true, 1, '', ' v2', 'legacy', 'typo'].forEach((v, i) => { P.recording = 'v2'; P.recording = v; out['bad' + i] = P.recording; });
      out.storedAfterLegacy = localStorage.getItem('ppp.recording.v1');
      P.recording = 'v2'; out.again = P.recording;
      return out;
    });
    ok('PPP.recording is legacy at page load', sw.start === 'legacy', sw.start);
    ok("'v2' is accepted and remembered on this device", sw.v2 === 'v2' && sw.stored === 'v2', JSON.stringify(sw));
    ok("any other value is legacy (null, undefined, 'V2', 'v1', 'g8', true, 1, '', ' v2', 'legacy', 'typo'), and legacy removes the stored choice", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(i => sw['bad' + i] === 'legacy') && sw.storedAfterLegacy === null, JSON.stringify(sw));
    await p0.evaluate(() => { window.PPP.recording = 'v2'; });
    await p0.reload({ waitUntil: 'networkidle2' });
    await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
    ok('a remembered v2 is v2 after a reload', (await p0.evaluate(() => window.PPP.recording)) === 'v2');
    await p0.evaluate(() => { window.PPP.recording = 'legacy'; });
    ok('and legacy is the default again after it is switched back', (await p0.evaluate(() => { try { return localStorage.getItem('ppp.recording.v1'); } catch (e) { return 'x'; } })) === null);
    await p0.close();
    const pq = await openPage(browser, { query: '?recording=v2' });
    ok('?recording=v2 in the address is v2 for that visit', (await pq.evaluate(() => window.PPP.recording)) === 'v2');
    ok('and is not remembered', (await pq.evaluate(() => localStorage.getItem('ppp.recording.v1'))) === null);
    await pq.close();
    const pb = await openPage(browser, { query: '?recording=bogus', store: { 'ppp.recording.v1': 'v2' } });
    ok('?recording=<anything but v2> is legacy, even over a remembered v2', (await pb.evaluate(() => window.PPP.recording)) === 'legacy');
    await pb.close();
    const ps = await openPage(browser, { store: { 'ppp.recording.v1': 'g8' } });
    ok('a stored value that is not v2 is legacy', (await ps.evaluate(() => window.PPP.recording)) === 'legacy');
    await ps.close();

    console.log('\n── nothing is asked for by a page that does not use v2 ──');
    const pl = await openPage(browser);
    await sleep(3500);
    const idle0 = recReqs(pl);
    await pl.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(300);
    await pl.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(1200);
    const upl = await pl.evaluate(() => window.PPP.app.state.screen);
    const idle1 = recReqs(pl);
    ok('a fresh page, 3.5 s after load, has requested none of v2\'s files', idle0.length === 0, idle0.join(', '));
    ok('and none when the Add-sheet-music screen opens (' + upl + ')', idle1.length === 0 && upl === 'upload', idle1.join(', '));
    ok('no window global of v2 exists', await pl.evaluate(() => !window.PPPRec && !window.PPPRecApp && !window.PPPRecGrid && !window.PPPRecWeights && !window.PPPRecModules && window.PPP.recordingModulesReady() === false));
    ok('no page or console error', clean(pl), errs(pl));
    /* a saved song's version is only ever raised by v2: 7 stays a current version, 8 is never "old" (migrateSavedTranscription retires stale review flags of a version below 7) */
    const mig = await pl.evaluate(() => {
      const P = window.PPP, mk = v => ({ score: { source: {} }, source: { transcriptionVersion: v, amt: 'onsets-and-frames' }, report: { suspectMeasures: [3], issues: [] } });
      return { v6: P.migrateSavedTranscription(mk(6).score, mk(6).source, mk(6).report).changed, v7: P.migrateSavedTranscription(mk(7).score, mk(7).source, mk(7).report).changed,
        v8: P.migrateSavedTranscription(mk(8).score, mk(8).source, mk(8).report).changed, cur: P.TRANSCRIPTION_VERSION, v2: P.TRANSCRIPTION_VERSION_V2 };
    });
    ok('TRANSCRIPTION_VERSION stays 7 (the classic songs), v2 songs are 8, and neither is rewritten on open (6 is the only one migrated)', mig.cur === 7 && mig.v2 === 8 && mig.v6 === true && mig.v7 === false && mig.v8 === false, JSON.stringify(mig));
    await pl.close();

    console.log('\n── v2 selected: the files come, once each, in order ──');
    const pv = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await sleep(2500);
    ok('v2 remembered but no screen that converts is open: still nothing asked for', recReqs(pv).length === 0, recReqs(pv).join(', '));
    await pv.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(250);
    await pv.evaluate(() => document.querySelector('[data-add-card]').click());
    await pv.waitForFunction(() => window.PPP.recordingModulesReady(), { timeout: 30000 });
    await sleep(500);
    const files = pv.__rec.requests.filter(u => REC_FILES.test(u)).map(u => u.split('?')[0]);
    ok('opening the Add-sheet-music screen fetches 17 files: the four weights, then the thirteen scripts in rec/index.js\'s header order, each exactly once',
      JSON.stringify(files.slice(0, 4).sort()) === JSON.stringify(WEIGHTS.slice().sort()) && JSON.stringify(files.slice(4)) === JSON.stringify(SCRIPTS) && files.length === 17, files.join(' '));
    ok('the weights are the globals the modules read, and every module registered', await pv.evaluate(() => !!(window.PPPRecWeights && window.PPPRecHandsWeights && window.PPPRecGridModel && window.PPPRecRestsModel && window.PPPRec && window.PPPRecGrid && window.PPPRecVoices && window.PPPRecRests && window.PPPRecWriter && window.PPPRecKey && window.PPPRecPedal && window.PPPRecApp)));
    ok('the files come after the load event (the page is not slowed by v2)', await pv.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {}, mine = performance.getEntriesByType('resource').filter(r => /\/rec\//.test(r.name));
      return mine.length === 17 && Math.min.apply(null, mine.map(r => r.startTime)) > nav.domContentLoadedEventEnd;
    }));
    await pv.evaluate(() => window.PPP.loadRecordingModules());
    await pv.evaluate(() => document.querySelector('[data-recording-v2-option]').click());
    await pv.evaluate(() => document.querySelector('[data-recording-v2-option]').click());
    await sleep(300);
    ok('asking again, and pressing the chip off and on, fetches nothing more', recReqs(pv).length === 17, String(recReqs(pv).length));
    ok('no page or console error', clean(pv), errs(pv));
    await pv.close();

    console.log('\n── a file that cannot be fetched ──');
    const pf = await openPage(browser, { failWhile: /\/rec\/writer\.js/ });
    await addChecker(pf);
    await pf.evaluate(() => { window.PPP.recording = 'v2'; });
    const fail1 = await pf.evaluate(() => window.PPP.loadRecordingModules());
    ok('a script that fails: the load reports false, v2 is not ready, nothing throws', fail1 === false && (await pf.evaluate(() => window.PPP.recordingModulesReady())) === false && pf.__rec.pageErrors.length === 0);
    const imp1 = await importHeard(pf, heardFor.sextuplets);
    const s1 = await stateOf(pf);
    ok('an import made meanwhile is written the classic way, marked so, and the review screen says it (an issue line)', imp1.screen === 'review' && s1.pipeline === null && s1.version === 7 && s1.issues.indexOf('recording-v2') > -1, JSON.stringify({ imp1: imp1, p: s1.pipeline, v: s1.version, i: s1.issues }));
    ok('and the review screen shows that line, in English', await pf.evaluate(() => /could not be loaded, so the classic method wrote this score/.test(document.body.innerText)));
    pf.__rec.failOn = false;
    const okAgain = await pf.evaluate(() => window.PPP.loadRecordingModules());
    const after = recReqs(pf);
    const once = n => after.filter(u => u === '/rec/' + n + '.js').length;
    const others = SCRIPTS.map(s => s.replace(/^\/rec\/|\.js$/g, '')).filter(n => n !== 'writer');
    ok('every attempt asks for the failed script ALONE: writer.js again (and again), every other script and every weights file exactly once, nothing that loaded is run twice',
      okAgain === true && once('writer') >= 2 && others.every(n => once(n) === 1) && WEIGHTS.every(w => after.filter(u => u === w).length === 1), JSON.stringify({ writer: once('writer'), others: others.map(n => n + ':' + once(n)).join(' '), total: after.length }));
    ok('and the page ran each script once (one script element a request: nothing is run twice)', await pf.evaluate(() => document.querySelectorAll('script[src*="/rec/"]').length) === after.filter(u => /\.js$/.test(u)).length);
    const imp2 = await importHeard(pf, heardFor.sextuplets);
    const s2 = await stateOf(pf);
    ok('and the import after that is v2', imp2.screen === 'review' && s2.pipeline === 'v2' && s2.version === 8, JSON.stringify({ p: s2.pipeline, v: s2.version }));
    ok('no page error through all of it', pf.__rec.pageErrors.length === 0, errs(pf));
    await pf.close();
    /* an early file that fails: the three files that read its export when they loaded come with it, and only those */
    const pe = await openPage(browser, { failWhile: /\/rec\/attacks\.js/ });
    await pe.evaluate(() => { window.PPP.recording = 'v2'; });
    ok('attacks.js fails: the load reports false, nothing throws', (await pe.evaluate(() => window.PPP.loadRecordingModules())) === false && (await pe.evaluate(() => window.PPP.recordingModulesReady())) === false && pe.__rec.pageErrors.every(m => /attacks|undefined|Cannot read/.test(m)));
    pe.__rec.pageErrors.length = 0;
    pe.__rec.failOn = false;
    ok('the next attempt loads', (await pe.evaluate(() => window.PPP.loadRecordingModules())) === true && (await pe.evaluate(() => window.PPP.recordingModulesReady())) === true);
    const pea = recReqs(pe), oncePe = n => pea.filter(u => u === '/rec/' + n + '.js').length;
    ok('attacks.js and the three files that took its export (model, metre, index) were asked for again, once; the other nine were not',
      ['attacks', 'model', 'metre', 'index'].every(n => oncePe(n) === 2) && ['beats', 'hands', 'grid', 'voices', 'rests', 'writer', 'key', 'pedal', 'app'].every(n => oncePe(n) === 1), SCRIPTS.map(s => s.slice(5, -3) + ':' + oncePe(s.slice(5, -3))).join(' '));
    const heMade = await pe.evaluate(() => { const r = window.PPPRec; return !!(r && r.skeleton && r.hands && window.PPPRecModules.model && window.PPPRecModules.metre); });
    ok('and v2 is whole: rec/index.js holds the stages (skeleton, hands) it was loaded with the second time', heMade);
    await addChecker(pe);
    const impE = await importHeard(pe, heardFor.sextuplets);
    const sE = await stateOf(pe);
    ok('an import after that is v2, with its bars adding up', impE.screen === 'review' && sE.pipeline === 'v2' && Object.values(sE.scoreClasses).every(v => v === 0), JSON.stringify({ p: sE.pipeline, sc: sE.scoreClasses }));
    await pe.close();
    /* a file the server answers 200 with something that is not the script (an error page): it fires load, leaves no global, and is not "loaded" */
    const pcx = await openPage(browser, { corrupt: { re: /\/rec\/key\.js/, body: '<!doctype html><html><body>Service unavailable</body></html>' } });
    await addChecker(pcx);
    await pcx.evaluate(() => { window.PPP.recording = 'v2'; });
    const cx1 = await pcx.evaluate(() => window.PPP.loadRecordingModules());
    ok('a corrupt 200 (key.js is an HTML page): the load reports false, v2 is not ready, key.js is not marked loaded (no PPPRecKey), the other twelve scripts are', cx1 === false && (await pcx.evaluate(() => window.PPP.recordingModulesReady())) === false && (await pcx.evaluate(() => !window.PPPRecKey && !!window.PPPRec && !!window.PPPRecPedal && !!window.PPPRecApp)), String(cx1));
    ok('its only page error is the syntax error of that file', pcx.__rec.pageErrors.length === 1 && /Unexpected token/.test(pcx.__rec.pageErrors[0]), errs(pcx));
    const impX = await importHeard(pcx, heardFor.sextuplets);
    const sX = await stateOf(pcx);
    ok('an import meanwhile is the classic one, said so', impX.screen === 'review' && sX.pipeline === null && sX.issues.indexOf('recording-v2') > -1, JSON.stringify({ p: sX.pipeline, i: sX.issues }));
    pcx.__rec.failOn = false;
    const cx2 = await pcx.evaluate(() => window.PPP.loadRecordingModules());
    const cxr = recReqs(pcx), onceX = n => cxr.filter(u => u === '/rec/' + n + '.js').length;
    ok('the next attempt asks for key.js alone and v2 is ready', cx2 === true && (await pcx.evaluate(() => window.PPP.recordingModulesReady())) === true && onceX('key') >= 2 && SCRIPTS.map(s => s.slice(5, -3)).filter(n => n !== 'key').every(n => onceX(n) === 1), SCRIPTS.map(s => s.slice(5, -3) + ':' + onceX(s.slice(5, -3))).join(' '));
    await pcx.close();
    const pw = await openPage(browser, { failWhile: /ai5b-grid-v1\.json/ });
    await pw.evaluate(() => { window.PPP.recording = 'v2'; });
    const fw = await pw.evaluate(() => window.PPP.loadRecordingModules());
    ok('a weights file that fails is a false, not a throw, and no script ran without its weights', fw === false && (await pw.evaluate(() => !window.PPPRec)) && recReqs(pw).filter(u => /\.js$/.test(u)).length === 0, recReqs(pw).join(' '));
    pw.__rec.failOn = false;
    ok('and the next attempt loads everything', (await pw.evaluate(() => window.PPP.loadRecordingModules())) === true);
    await pw.close();

    /* ------------------------------------------------------------------ the control */
    console.log('\n── the opt-in control ──');
    for (const loc of ['en-US', 'ko-KR', 'ja-JP', 'zh-CN']) {
      const cp = await openPage(browser, { locale: loc, width: 400, height: 900 });
      await cp.evaluate(() => window.PPP.app.go('upload')()); await sleep(600);   /* by the app's own route, not the English label of the sidebar */
      const c = await cp.evaluate(() => {
        const b = document.querySelector('[data-recording-choice="upload"] [data-recording-v2-option]'); if (!b) return null;
        const r = b.getBoundingClientRect(), hint = b.parentElement.querySelector('p');
        return { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), inView: r.left >= 0 && r.right <= window.innerWidth + 1, noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1, hint: hint && hint.innerText.trim() };
      });
      const want = loc === 'en-US' ? 'New transcription method (experimental)' : CATALOG[loc]['New transcription method (experimental)'];
      const wantHint = loc === 'en-US' ? NEW_KEYS[1] : CATALOG[loc][NEW_KEYS[1]];
      ok(loc + ': the chip is on the Add-sheet-music screen, off, labelled "' + want + '", with its one-line explanation, inside a 400 px viewport with no sideways scroll',
        !!c && c.text === want && c.pressed === 'false' && c.hint === wantHint && c.inView && c.noSideScroll, JSON.stringify(c));
      if (loc === 'ko-KR') ok('the Korean label is the one the product owner asked for', c && c.text === '새 받아쓰기 방식 (실험)', c && c.text);
      await cp.close();
    }
    NEW_KEYS.forEach(k => ['ko-KR', 'ja-JP', 'zh-CN'].forEach(l => { if (!(CATALOG[l][k] && CATALOG[l][k] !== k)) ok(l + ' has the string "' + k.slice(0, 50) + '"', false); }));
    ok('every new string has a Korean, a Japanese and a Chinese translation (' + NEW_KEYS.length + ' strings)', NEW_KEYS.every(k => ['ko-KR', 'ja-JP', 'zh-CN'].every(l => CATALOG[l][k] && CATALOG[l][k] !== k)));
    ok('and each keeps the placeholders of the English', NEW_KEYS.every(k => { const ph = (k.match(/\{\{\w+\}\}/g) || []).sort().join(); return ['ko-KR', 'ja-JP', 'zh-CN'].every(l => (CATALOG[l][k].match(/\{\{\w+\}\}/g) || []).sort().join() === ph); }));
    const pc = await openPage(browser);
    await pc.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(250);
    await pc.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(500);
    await press(pc, '[data-recording-choice="upload"] [data-recording-v2-option]');
    await sleep(300);
    const cc = await pc.evaluate(() => ({ mode: window.PPP.recording, pressed: document.querySelector('[data-recording-v2-option]').getAttribute('aria-pressed'), stored: localStorage.getItem('ppp.recording.v1') }));
    ok('pressing the chip sets PPP.recording to v2, shows it pressed and remembers it', cc.mode === 'v2' && cc.pressed === 'true' && cc.stored === 'v2', JSON.stringify(cc));
    await pc.waitForFunction(() => window.PPP.recordingModulesReady(), { timeout: 30000 });
    await press(pc, '[data-recording-choice="upload"] [data-recording-v2-option]');
    await sleep(300);
    ok('pressing it again turns it off', (await pc.evaluate(() => window.PPP.recording)) === 'legacy' && (await pc.evaluate(() => document.querySelector('[data-recording-v2-option]').getAttribute('aria-pressed'))) === 'false');
    await pc.close();

    /* ------------------------------------------------------------------ the classic path */
    console.log('\n── the classic path: PPP.recording = legacy ──');
    const pcl = await openPage(browser);
    await addChecker(pcl);
    const impL = await importHeard(pcl, heardFor.sextuplets);
    const sL = await stateOf(pcl);
    ok('an import with the default is the classic conversion: no v2 mark, version 7, no flags, no v2 request', impL.screen === 'review' && sL.pipeline === null && sL.version === 7 && sL.unc === null && recReqs(pcl).length === 0, JSON.stringify({ p: sL.pipeline, v: sL.version, unc: sL.unc, req: recReqs(pcl).length }));
    const legacySource = await pcl.evaluate(() => Object.keys(window.PPP.app.state.importSource).join());
    ok('its source has exactly the keys it always had (no recordingPipeline)', !/recordingPipeline/.test(legacySource), legacySource);
    ok('the review screen shows the chip off, says the notation is the classic one, and has no amber legend', await pcl.evaluate(() => {
      const b = document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]');
      return !!b && b.getAttribute('aria-pressed') === 'false' && /classic method/.test(document.querySelector('[data-recording-method]').innerText) && !document.querySelector('[data-uncertain-legend]');
    }));
    await pcl.click('[data-lock-rewrite]');
    await pcl.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
    const sL2 = await stateOf(pcl);
    ok('"Rewrite the rhythm" is as it was: classic, version 7', sL2.pipeline === null && sL2.version === 7);
    ok('no page or console error', clean(pcl), errs(pcl));
    await pcl.close();

        }
/* ------------------------------------------------------------------ v2 through the real screens, on each fixture */
    if (want('fixtures')) {
    for (const name of ['sextuplets', 'keys', 'pedal', 'hymn']) {
      console.log('\n── v2 on the fixture "' + name + '": import, review, Accept, the saved song, a reload ──');
      const pg = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
      await addChecker(pg);
      const imp = await importHeard(pg, heardFor[name]);
      const s = await stateOf(pg);
      ok('the import reaches the review screen', imp.screen === 'review' && !imp.error, JSON.stringify(imp));
      ok('marked: source.recordingPipeline v2, transcriptionVersion 8', s.pipeline === 'v2' && s.version === 8, JSON.stringify({ p: s.pipeline, v: s.version }));
      ok('the files were fetched by the import itself (17, once each)', recReqs(pg).length === 17, String(recReqs(pg).length));
      ok('the report carries the flags: a list of measures PPP was not sure about (' + (s.unc ? s.unc.length : 'none') + ' of ' + s.measures + '), each a measure of the Score',
        Array.isArray(s.unc) && s.unc.every(m => m >= 1 && m <= s.measures) && s.unc.length < s.measures, JSON.stringify({ unc: s.unc, issues: s.issues }));
      ok('bars that add up, rests, tuplets: notation-check classes 1-7 are 0 in the Score and in the graph the page draws; the graph is the Score\'s own (via live), valid, no W-DISPLAY-DURATION',
        Object.values(s.scoreClasses).every(v => v === 0) && Object.values(s.graphClasses).every(v => v === 0) && s.via === 'live' && s.errors.length === 0 && s.warnDisplay === 0, JSON.stringify({ sc: s.scoreClasses, gc: s.graphClasses, via: s.via, errors: s.errors, w: s.warnDisplay }));
      if (name === 'sextuplets') ok('it has the 3:2 brackets of 16ths over half beats (' + s.brackets + ' in the Score)', s.brackets >= 20, JSON.stringify({ br: s.brackets, voices: s.voices }));
      if (name === 'hymn') ok('four-part writing is two voices on each staff (the Score reads staff 1 voices 1 and 2, staff 2 voices 5 and 6)', ['1:1', '1:2', '2:5', '2:6'].every(v => s.voices.split(',').indexOf(v) > -1), s.voices);
      if (name === 'keys') {
        const keys = await pg.evaluate(() => window.PPP.app.state.score.measures.map(m => m.key.fifths).filter((k, i, a) => i === 0 || k !== a[i - 1]));
        ok('a key change is written and the Score reads it (C, E flat, C)', JSON.stringify(keys) === JSON.stringify([0, -3, 0]), JSON.stringify(keys));
      }
      if (name === 'pedal') {
        const pm = await pg.evaluate(() => ({ marks: window.PPP.PianoScore.of(window.PPP.app.state.score).pedal.length, ccs: window.PPP.PianoScore.of(window.PPP.app.state.score).ccsWritten.length }));
        ok('pedal spanners are written and the player has them', pm.marks >= 1 || pm.ccs >= 16, JSON.stringify(pm));
      }
      const ds = await drawSound(pg);
      ok('what is drawn = what is played: ' + ds.struck + ' sounded notes are exactly the ' + (ds.notes - ds.tieStops) + ' written ones that are struck, at the same places; no sounded note is unwritten, no written note is silent',
        ds.onlyWritten === 0 && ds.onlySounded === 0 && ds.struck === ds.notes - ds.tieStops, JSON.stringify(ds));
      ok('every Score note has a drawn head (' + ds.heads + ' heads for ' + ds.notes + ' notes), brackets are drawn (' + ds.brackets + ' for ' + ds.bracketStarts + '), and no note sounds shorter than it is written', ds.heads === ds.notes && ds.brackets === ds.bracketStarts && ds.tooShort === 0, JSON.stringify(ds));
      for (const level of ['beginner', 'intermediate', 'advanced']) {
        const a = await arrangeCheck(pg, level);
        ok('the one-note arranger on the v2 graph (' + level + ') does not crash: ' + (a.ok ? a.notes + ' of ' + s.notes + ' notes, at most ' + a.maxPerHand + ' a hand at once' : 'refused ' + a.reason), a.ok ? a.maxPerHand === 1 && a.plays > 0 : !/THROWN|CRASH|NOT_LOADED/.test(a.reason), JSON.stringify(a));
      }
      await pg.evaluate(() => window.PPP.app.setState({ screen: 'review' })); await sleep(500);
      await accept(pg);
      const sid = s.songId;
      const slot = await slotOf(pg, sid);
      ok('Accept saves the song with the mark', !!slot && slot.importSource.recordingPipeline === 'v2' && slot.importSource.transcriptionVersion === 8, slot ? JSON.stringify({ p: slot.importSource.recordingPipeline, v: slot.importSource.transcriptionVersion }) : 'no slot');
      await sleep(2500);
      await pg.reload({ waitUntil: 'networkidle2' });
      await pg.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
      await addChecker(pg);
      await pg.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
      await pg.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid); await sleep(3000);
      const sr = await stateOf(pg);
      ok('after a reload the saved song has the mark, the same notation and its graph from the store; classes 1-7 are 0', sr.pipeline === 'v2' && sr.version === 8 && sr.hash === s.hash && sr.via === 'store' && Object.values(sr.scoreClasses).every(v => v === 0) && Object.values(sr.graphClasses).every(v => v === 0), JSON.stringify({ p: sr.pipeline, v: sr.version, same: sr.hash === s.hash, via: sr.via, sc: sr.scoreClasses }));
      ok('the flags are saved with the song: the same unsure bars, reasons and metre note after the reload', JSON.stringify(sr.unc) === JSON.stringify(s.unc) && JSON.stringify(sr.uncWhy) === JSON.stringify(s.uncWhy) && JSON.stringify(sr.uncPiece) === JSON.stringify(s.uncPiece), JSON.stringify({ before: [s.unc, s.uncPiece], after: [sr.unc, sr.uncPiece] }));
      const dsr = await drawSound(pg);
      ok('and drawn = played after the reload', dsr.onlyWritten === 0 && dsr.onlySounded === 0 && dsr.heads === dsr.notes && dsr.tooShort === 0, JSON.stringify(dsr));
      ok('no page or console error', clean(pg), errs(pg));
      await pg.close();
    }

        }
/* ------------------------------------------------------------------ rewrite, arrangement, write again, undo */
    if (want('calls')) {
    console.log('\n── the call sites after a v2 import: Rewrite the rhythm, Apply arrangement, Write the notation again, Undo ──');
    const pr = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await addChecker(pr);
    await importHeard(pr, heardFor.sextuplets);
    const r0 = await stateOf(pr);
    /* Apply arrangement with the controls untouched: the conversion that wrote the song, the one-note arrangement made from it */
    await pr.select('[data-arrangement-level]', 'intermediate');
    await pr.click('[data-apply-arrangement]');
    await pr.waitForFunction(() => { const s = window.PPP.app.state; return !s.arrangementBusy && s.importSource && s.importSource.arrangement && s.importSource.arrangement.level; }, { timeout: 120000 });
    await sleep(800);
    const r1 = await pr.evaluate(() => { const s = window.PPP.app.state; return { eng: s.importSource.arrangement.engine, fallback: s.importSource.arrangement.singleFallback || null, pipeline: s.importSource.recordingPipeline || null, version: s.importSource.transcriptionVersion, notes: s.score.notes.filter(n => !n.rest).length }; });
    ok('Apply arrangement (controls untouched): a one-note-per-hand copy of the v2 transcription, still marked v2', r1.eng === 'ppp.g9-single' && !r1.fallback && r1.pipeline === 'v2' && r1.version === 8, JSON.stringify(r1));
    ok('no page error', pr.__rec.pageErrors.length === 0, errs(pr));
    /* Write again with legacy: the classic notation, mark dropped; Undo restores v2 */
    await pr.evaluate(() => window.PPP.recording = 'legacy');
    await pr.evaluate(() => window.PPP.app.setState({ recordingTick: 1 })); await sleep(300);
    await press(pr, '[data-write-again]');
    await pr.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(600);
    const w1 = await stateOf(pr);
    const status1 = await pr.evaluate(() => (document.querySelector('[data-notation-status]') || {}).innerText);
    ok('Write the notation again with the classic method: the same heard notes, version 7, no v2 mark, the arrangement taken off, the status line says what happened',
      w1.pipeline === null && w1.version === 7 && w1.unc === null && /with the classic method\. Before: \d+ measures, \d+ rests, \d+ tuplet brackets\. Now: \d+ measures/.test(status1) && (await pr.evaluate(() => !window.PPP.app.state.importSource.arrangement)), JSON.stringify({ p: w1.pipeline, v: w1.version, status: status1 }));
    ok('and the classic notation has the classic bars', Object.values(w1.scoreClasses).every(v => v === 0) && w1.via === 'live', JSON.stringify(w1.scoreClasses));
    await press(pr, '[data-notation-undo]');
    await sleep(800);
    const u1 = await stateOf(pr);
    ok('Undo puts the arrangement back (it is the Score that was there)', u1.songId === w1.songId && !!(await pr.evaluate(() => window.PPP.app.state.importSource.arrangement)), JSON.stringify({ p: u1.pipeline }));
    /* back to v2 and write again with v2 */
    await pr.evaluate(() => window.PPP.recording = 'v2');
    await pr.evaluate(() => window.PPP.loadRecordingModules());
    await press(pr, '[data-write-again]');
    await pr.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation && window.PPP.app.state.recNotation.method === 'v2', { timeout: 60000 });
    await sleep(600);
    const w2 = await stateOf(pr);
    ok('Write the notation again with v2: marked v2 and 8, flags kept in the report, and the notation is the one the import made', w2.pipeline === 'v2' && w2.version === 8 && w2.hash === r0.hash, JSON.stringify({ p: w2.pipeline, v: w2.version, same: w2.hash === r0.hash }));
    /* Rewrite the rhythm: a stated metre is the classic writer's */
    await pr.click('[data-lock-rewrite]');
    await pr.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
    await sleep(500);
    const w3 = await stateOf(pr);
    ok('Rewrite the rhythm (a stated metre) is written the classic way and drops the v2 mark; the review screen says so beside the controls', w3.pipeline === null && w3.version === 7 && (await pr.evaluate(() => !!document.querySelector('[data-lock-v2-note]'))), JSON.stringify({ p: w3.pipeline, v: w3.version }));
    ok('no page or console error', clean(pr), errs(pr));
    await pr.close();

        }
/* ------------------------------------------------------------------ the saved song: nothing rewritten silently; write again from the kept graph */
    if (want('saved')) {
    console.log('\n── a saved song: opened as saved; "Write the notation again" from the kept graph of this device ──');
    const ps2 = await openPage(browser);
    await addChecker(ps2);
    await importHeard(ps2, heardFor.sextuplets);
    const old = await stateOf(ps2);
    await accept(ps2);
    const sid2 = old.songId;
    const slot0 = JSON.stringify(await slotOf(ps2, sid2));
    await sleep(3000);
    await ps2.reload({ waitUntil: 'networkidle2' });
    await ps2.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await addChecker(ps2);
    await ps2.evaluate(() => { window.PPP.recording = 'v2'; });
    await ps2.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
    await ps2.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid2); await sleep(3000);
    const opened = await stateOf(ps2);
    ok('a saved classic song opens exactly as saved even with v2 selected: version 7, no mark, same notation, not rewritten (the slot is byte-identical)', opened.pipeline === null && opened.version === 7 && opened.hash === old.hash && JSON.stringify(await slotOf(ps2, sid2)) === slot0, JSON.stringify({ p: opened.pipeline, v: opened.version, same: opened.hash === old.hash }));
    await ps2.evaluate(() => window.PPP.app.setState({ screen: 'review' })); await sleep(800);
    ok('the review screen of the saved song offers the chip and "Write the notation again", and says the notation is the classic one', await ps2.evaluate(() => !!(document.querySelector('[data-recording-choice="review"] [data-write-again]') && /classic method/.test(document.querySelector('[data-recording-method]').innerText))));
    ok('its heard notes are not in memory (a reload), so they come from the kept graph', await ps2.evaluate(() => !window.PPP.app._heard));
    await press(ps2, '[data-write-again]');
    await ps2.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(2500);
    const again = await stateOf(ps2);
    ok('written again with v2 from the kept graph: marked v2 and 8, the same song, valid, classes 1-7 are 0', again.pipeline === 'v2' && again.version === 8 && again.songId === sid2 && again.via === 'live' && again.errors.length === 0 && Object.values(again.scoreClasses).every(v => v === 0), JSON.stringify({ p: again.pipeline, v: again.version, via: again.via }));
    const slot1 = await slotOf(ps2, sid2);
    ok('and saved: the slot has the v2 mark', !!slot1 && slot1.importSource.recordingPipeline === 'v2' && slot1.importSource.transcriptionVersion === 8);
    await press(ps2, '[data-notation-undo]'); await sleep(2500);
    const undone = await stateOf(ps2);
    const slot2 = JSON.stringify(await slotOf(ps2, sid2));
    ok('Undo puts the classic notation back and saves it (the same notation and mark as before)', undone.pipeline === null && undone.version === 7 && undone.hash === old.hash, JSON.stringify({ p: undone.pipeline, v: undone.version, same: undone.hash === old.hash }));
    /* the saved graph follows the notation: after Undo, and after a write again, a reload gives the song's graph from the store with its heard notes */
    await ps2.reload({ waitUntil: 'networkidle2' });
    await ps2.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await addChecker(ps2);
    await ps2.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
    await ps2.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid2); await sleep(3000);
    const afterUndo = await stateOf(ps2);
    const keptHeard = await ps2.evaluate(async () => { const h = await window.PPP.app.heardForSong(); return h && h.notes.length; });
    ok('after Undo and a reload the song is the classic notation again with its own graph from the store (via store) and its heard notes (' + keptHeard + ')', afterUndo.pipeline === null && afterUndo.via === 'store' && keptHeard === heardFor.sextuplets.notes.length, JSON.stringify({ p: afterUndo.pipeline, via: afterUndo.via, heard: keptHeard }));
    await ps2.evaluate(() => { window.PPP.recording = 'v2'; window.PPP.app.setState({ screen: 'review' }); }); await sleep(800);
    await ps2.evaluate(() => window.PPP.loadRecordingModules());
    await press(ps2, '[data-write-again]');
    await ps2.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(3500);
    await ps2.reload({ waitUntil: 'networkidle2' });
    await ps2.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await addChecker(ps2);
    await ps2.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
    await ps2.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid2); await sleep(3000);
    const afterAgain = await stateOf(ps2);
    const keptHeard2 = await ps2.evaluate(async () => { const h = await window.PPP.app.heardForSong(); return h && h.notes.length; });
    ok('after a write again and a reload the song is the v2 notation with its v2 graph from the store, and still has its heard notes', afterAgain.pipeline === 'v2' && afterAgain.version === 8 && afterAgain.via === 'store' && keptHeard2 === heardFor.sextuplets.notes.length, JSON.stringify({ p: afterAgain.pipeline, via: afterAgain.via, heard: keptHeard2 }));
    ok('no page or console error', clean(ps2), errs(ps2));
    await ps2.close();

        }
/* ------------------------------------------------------------------ the flags */
    if (want('flags')) {
    console.log('\n── the bars PPP was not sure about ──');
    const pu = await openPage(browser);
    await importHeard(pu, heardFor.sextuplets);
    const flagged = await pu.evaluate(() => {
      const A = window.PPP.app, S = A.state, m = S.score.measures.map(x => x.number);
      A.setState({ importReport: Object.assign({}, S.importReport, { uncertainMeasures: [m[2], m[5]], uncertainWhy: { [m[2]]: ['grid'], [m[5]]: ['hands', 'grid'] }, suspectMeasures: [m[5]] }), reviewFrom: m[0] });
      return { m2: m[2], m5: m[5] };
    });
    await sleep(500);
    const fl = await pu.evaluate(f => {
      const cells = [...document.querySelectorAll('button[title^="Measure "]')];
      const by = n => cells.find(c => c.getAttribute('title').indexOf('Measure ' + n + ' ') === 0 || c.getAttribute('title') === 'Measure ' + n);
      const c2 = by(f.m2), c5 = by(f.m5), c1 = by(1);
      const legend = document.querySelector('[data-uncertain-legend]');
      return { c2: c2 && { bg: c2.style.background, title: c2.getAttribute('title') }, c5: c5 && { bg: c5.style.background, title: c5.getAttribute('title') }, c1: c1 && { bg: c1.style.background, title: c1.getAttribute('title') }, legend: legend && legend.innerText.trim() };
    }, flagged);
    await pu.evaluate(() => { const A = window.PPP.app, S = A.state; A.setState({ importReport: Object.assign({}, S.importReport, { uncertainPiece: { metre: '4/4', posterior: 0.42, alternatives: ['2/4', '3/4'] } }) }); });
    await sleep(400);
    ok('a metre the new method was not sure of is said on the review screen, from the saved flags', await pu.evaluate(() => /PPP read this piece as 4\/4 but was not sure of it \(42%\)/.test(document.body.innerText)));
    ok('an unsure bar is amber with its reason in the tooltip, a bar that needs checking stays red (and names both reasons), a sure bar is neither; the legend counts them',
      !!fl.c2 && /warn/.test(fl.c2.bg) && /not sure of the beat/.test(fl.c2.title) && /bad/.test(fl.c5.bg) && /which hand/.test(fl.c5.title) && !/warn|bad/.test(fl.c1.bg) && /Measures where PPP was not sure of the hands or the beat \(2\)/.test(fl.legend), JSON.stringify(fl));
    await pu.close();
    const pk = await openPage(browser, { locale: 'ko-KR' });
    await importHeard(pk, heardFor.sextuplets);
    await pk.evaluate(() => { const A = window.PPP.app, S = A.state; A.setState({ importReport: Object.assign({}, S.importReport, { uncertainMeasures: [3], uncertainWhy: { 3: ['grid'] } }) }); });
    await sleep(600);
    const kl = await pk.evaluate(() => { const l = document.querySelector('[data-uncertain-legend]'); return l && l.innerText.trim(); });
    ok('in Korean the legend says "PPP가 손 배분이나 박자를 확신하지 못한 마디" (the hands or the beat)', /PPP가 손 배분이나 박자를 확신하지 못한 마디 \(1개\)/.test(kl || ''), kl);
    await pk.close();

        }
/* ------------------------------------------------------------------ a "Full song" import is not a transcription */
    if (want('fullsong')) {
    console.log('\n── a "Full song" import: no "Write the notation again" (it would replace the easy arrangement with the full transcription) ──');
    const pa = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await addChecker(pa);
    await pa.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' }));
    const impA = await importHeard(pa, heardFor.sextuplets);
    const a0 = await stateOf(pa);
    const ui = () => pa.evaluate(() => ({
      taskMode: window.PPP.app.state.importSource && window.PPP.app.state.importSource.taskMode,
      block: !!document.querySelector('[data-recording-choice="review"]'), chip: !!document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]'),
      method: !!document.querySelector('[data-recording-method]'), write: !!document.querySelector('[data-write-again]'), undo: !!document.querySelector('[data-notation-undo]'),
      hint: /Writes the notation of this song again/.test(document.body.innerText)
    }));
    const ua = await ui();
    ok('a Full song import is the easy arrangement (taskMode piano-arrangement), written the classic way (v2 is for faithful transcriptions)', impA.screen === 'review' && ua.taskMode === 'piano-arrangement' && a0.pipeline === null, JSON.stringify({ imp: impA.screen, ua: ua, p: a0.pipeline }));
    ok('its review screen has no "Write the notation again" button and no hint for it', ua.write === false && ua.hint === false && ua.undo === false, JSON.stringify(ua));
    ok('the rest of the recording block stays as it was: the method line and the chip', ua.block && ua.chip && ua.method, JSON.stringify(ua));
    /* a stale click, or a script, cannot do it either: the same Score and graph afterwards */
    await pa.evaluate(() => window.PPP.app.writeNotationAgain());
    await sleep(2500);
    const a1 = await stateOf(pa), ua1 = await ui();
    ok('calling writeNotationAgain() on it changes nothing: the same notation, still the arrangement, no status line, nothing to undo', a1.hash === a0.hash && a1.songId === a0.songId && a1.notes === a0.notes && ua1.taskMode === 'piano-arrangement' && !(await pa.evaluate(() => !!window.PPP.app.state.recNotation)) && !ua1.undo, JSON.stringify({ a0: a0.hash, a1: a1.hash, ua1: ua1 }));
    ok('no page or console error', clean(pa), errs(pa));
    await pa.close();
    const pt = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await importHeard(pt, heardFor.sextuplets);
    const ut = await pt.evaluate(() => ({ taskMode: window.PPP.app.state.importSource.taskMode, write: !!document.querySelector('[data-write-again]'), hint: /Writes the notation of this song again/.test(document.body.innerText) }));
    ok('and a faithful transcription (the default recording type) still has the button and its hint', ut.taskMode === 'faithful-transcription' && ut.write && ut.hint, JSON.stringify(ut));
    await pt.close();

        }
/* ------------------------------------------------------------------ Undo puts the practice progress back; the shelf card follows the notation */
    if (want('undo')) {
    console.log('\n── Undo restores what Write again starts over (mastered, memory level, blind runs, tempo, loop range); the shelf card says the new measure count ──');
    const pn = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await importHeard(pn, heardFor.sextuplets);
    const prog = { mastered: true, memLevel: 3, blindRuns: 2, tempo: 70, loopFrom: 3, loopTo: 6 };
    await pn.evaluate(p => window.PPP.app.setState(p), prog);
    const progNow = () => pn.evaluate(() => { const S = window.PPP.app.state, e = (S.library || []).find(x => x.id === S.songId); return { mastered: S.mastered, memLevel: S.memLevel, blindRuns: S.blindRuns, tempo: S.tempo, loopFrom: S.loopFrom, loopTo: S.loopTo, card: e && e.measures, n: S.score.measures.length }; });
    const setCard = n => pn.evaluate(c => { const A = window.PPP.app, lib = A.libraryRead(), e = lib.songs.find(x => x.id === A.state.songId); e.measures = c; A.libraryWrite(lib); }, n);
    const n0 = (await progNow()).n;
    await setCard(999);   /* a card that says the wrong count: the rewrite must correct it */
    ok('before: the progress is set', JSON.stringify(Object.assign({}, await progNow(), { card: 0, n: 0 })) === JSON.stringify(Object.assign({}, prog, { card: 0, n: 0 })));
    await press(pn, '[data-write-again]');
    await pn.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(800);
    const w = await progNow();
    ok('Write again starts the practice over (the notation is new), and the shelf card says the notation has its count of measures (it said 999)', w.mastered === false && w.memLevel === 0 && w.blindRuns === 0 && w.loopFrom !== 3 && w.card === w.n && w.n === n0, JSON.stringify(w));
    await setCard(888);
    await press(pn, '[data-notation-undo]');
    await sleep(1000);
    const u = await progNow();
    ok('Undo gives back mastered, memory level, blind runs, tempo and the loop range exactly as they were, and corrects the shelf card', u.mastered === true && u.memLevel === 3 && u.blindRuns === 2 && u.tempo === 70 && u.loopFrom === 3 && u.loopTo === 6 && u.card === u.n, JSON.stringify(u));
    ok('and what Undo saved is what is on the screen: the slot has the loop range, the tempo and the progress', await pn.evaluate(() => { const S = window.PPP.app.state, slot = JSON.parse(localStorage.getItem('ppp.song.v1.' + S.songId) || 'null'); return !!slot && slot.loopFrom === 3 && slot.loopTo === 6 && slot.tempo === 70 && slot.mastered === true && slot.memLevel === 3 && slot.blindRuns === 2; }));
    ok('no page or console error', clean(pn), errs(pn));
    await pn.close();

        }
/* ------------------------------------------------------------------ the one-note arranger's refusal of a v2 song: one more try with the classic hands */
    if (want('fallback')) {
    console.log('\n── the Song Arranger and a refusal for hard violations: one more try on the same heard notes with the classic hands ──');
    /* The refusal itself is the teacher's piece (three of three runs); no committed fixture reproduces it, so the candidates stage is wrapped: it refuses when the test says so and otherwise runs for real.
       Everything else is the real page: the saved v2 song, its kept graph, the conversion again with {recording: 'v2', hands: 'legacy'}, the one-note arranger on that graph, the copy and its source. */
    const wrap = () => {
      window.__runs = []; window.__conv = []; window.__refuse = 'none';
      const real = window.PPPCandidates;
      window.PPPCandidates = Object.assign({}, real, { runAsync: function () {
        window.__runs.push(1);
        const m = window.__refuse, n = window.__runs.length;
        if (m === 'always' || (m === 'first' && n === 1)) return Promise.resolve({ ok: false, reason: 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', discarded: [] });
        if (m === 'other') return Promise.resolve({ ok: false, reason: 'NO_SELECTION' });
        return real.runAsync.apply(real, arguments);
      } });
      const A = window.PPPAudioScore, realConv = A.toMusicXml;
      window.PPPAudioScore = Object.assign({}, A, { toMusicXml: function (i, o) { window.__conv.push({ recording: o && o.recording || null, hands: o && o.hands || null, closeGaps: !!(o && o.closeGaps), exactBars: !!(o && o.exactBars) }); return realConv.apply(this, arguments); } });
    };
    const arrangerCopy = async (page, songId, level, mode) => {
      await page.evaluate(() => { try { window.PPP.app.closeSongArranger(); } catch (e) { /* none open */ } });
      await page.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(800);
      await page.waitForSelector('[data-arrange-song="' + songId + '"]', { timeout: 30000 });
      await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId); await sleep(700);
      await page.waitForFunction(() => !!(window.PPPCandidates && window.PPPCandidates.runAsync), { timeout: 60000 });
      await page.evaluate(src => { if (!window.__wrapped) { (0, eval)('(' + src + ')')(); window.__wrapped = true; } window.__runs = []; window.__conv = []; }, wrap.toString());
      await page.evaluate(m => { window.__refuse = m; }, mode);
      await page.select('[data-song-arrange-level]', level);
      await page.select('[data-song-arrange-style]', 'balanced');
      const before = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ppp.song.v1.')));
      await page.click('[data-create-song-arrangement]');
      await page.waitForFunction(() => { const S = window.PPP.app.state; return !S.songArrange || (!S.songArrange.busy && (S.songArrange.singleRefusal || S.songArrange.status)); }, { timeout: 300000, polling: 400 });
      await sleep(800);
      return page.evaluate(b => {
        const S = window.PPP.app.state, keys = Object.keys(localStorage).filter(k => k.startsWith('ppp.song.v1.') && b.indexOf(k) < 0);
        return { refusal: S.songArrange && S.songArrange.singleRefusal ? S.songArrange.singleRefusal.reason : null, notice: !!document.querySelector('[data-single-refusal]'), newKeys: keys, runs: window.__runs.length, conv: window.__conv.slice() };
      }, before);
    };
    const pk2 = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await addChecker(pk2);
    const impK = await importHeard(pk2, heardFor.sextuplets);
    const sK = await stateOf(pk2);
    await accept(pk2);
    const idK = sK.songId;
    ok('a saved v2 song to arrange (the import marked v2, accepted)', impK.screen === 'review' && sK.pipeline === 'v2' && !!(await slotOf(pk2, idK)), JSON.stringify({ p: sK.pipeline }));
    /* a reload: the arranger then has only what the device keeps (the song's graph from the store), as it does for the teacher's saved song; v2's files are not loaded until the fallback needs them */
    await sleep(2500);
    await pk2.reload({ waitUntil: 'networkidle2' });
    await pk2.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await pk2.evaluate(() => { window.PPP.recording = 'legacy'; });
    ok('after the reload v2 is not loaded (nothing asked for yet)', (await pk2.evaluate(() => window.PPP.recordingModulesReady())) === false);
    const rA = await arrangerCopy(pk2, idK, 'intermediate', 'first');
    ok('the first arrangement is refused for hard violations, the retry on the conversion with the classic hands arranges it: a copy is saved, the candidates stage ran twice',
      rA.refusal === null && rA.newKeys.length === 1 && rA.runs === 2, JSON.stringify(rA));
    const convA = rA.conv.filter(c => c.recording === 'v2');
    ok('exactly one conversion was made for it: v2 with hands legacy, closeGaps and exactBars (v2\'s files were fetched for it)', convA.length === 1 && convA[0].hands === 'legacy' && convA[0].closeGaps && convA[0].exactBars && (await pk2.evaluate(() => window.PPP.recordingModulesReady())) === true, JSON.stringify(rA.conv));
    const copyId = (rA.newKeys[0] || '').replace('ppp.song.v1.', '');
    const copy = await slotOf(pk2, copyId), orig = await slotOf(pk2, idK);
    ok('the copy\'s source says it: one-note-per-hand arrangement with handsFallback "legacy", no singleFallback; its library card carries it',
      !!copy && copy.importSource.kind === 'arrangement' && copy.importSource.arrangement.engine === 'ppp.g9-single' && copy.importSource.arrangement.handsFallback === 'legacy' && !copy.importSource.arrangement.singleFallback
      && await pk2.evaluate(i => { const e = (window.PPP.app.state.library || []).find(x => x.id === i); return !!e && !!e.arrangement && e.arrangement.handsFallback === 'legacy'; }, copyId), copy ? JSON.stringify(copy.importSource.arrangement) : 'no copy');
    ok('the saved song itself is untouched (still the v2 notation, version 8, no arrangement)', !!orig && orig.importSource.recordingPipeline === 'v2' && orig.importSource.transcriptionVersion === 8 && !orig.importSource.arrangement);
    await pk2.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
    await pk2.evaluate(i => document.querySelector('[data-open-song="' + i + '"]').click(), copyId); await sleep(3000);
    ok('the copy is a one-note-per-hand arrangement: it opens, the notes are there, at most one a hand at once', await pk2.evaluate(() => {
      const sc = window.PPP.app.state.score, by = new Map();
      sc.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
      return sc.notes.filter(n => !n.rest).length > 20 && Math.max.apply(null, [...by.values()]) === 1;
    }));
    /* a second refusal: the refusal the person sees today, one retry only */
    const rB = await arrangerCopy(pk2, idK, 'beginner', 'always');
    ok('refused again after the retry: the refusal notice is shown (ALL_CANDIDATES_HAVE_HARD_VIOLATIONS), nothing is saved, and the candidates stage ran exactly twice (no loop)',
      rB.refusal === 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS' && rB.notice && rB.newKeys.length === 0 && rB.runs === 2 && rB.conv.filter(c => c.recording === 'v2').length === 1, JSON.stringify(rB));
    /* any other code: no retry */
    const rC = await arrangerCopy(pk2, idK, 'advanced', 'other');
    ok('a refusal with another code (NO_SELECTION) is not retried: the candidates stage ran once, no conversion, the notice is shown', rC.refusal === 'NO_SELECTION' && rC.notice && rC.runs === 1 && rC.conv.length === 0 && rC.newKeys.length === 0, JSON.stringify(rC));
    ok('no page or console error', clean(pk2), errs(pk2));
    await pk2.close();
    /* a classic song: the same refusal is not retried */
    const pk3 = await openPage(browser);
    await addChecker(pk3);
    await importHeard(pk3, heardFor.sextuplets);
    const sK3 = await stateOf(pk3);
    await accept(pk3);
    await sleep(2500);
    const rD = await arrangerCopy(pk3, sK3.songId, 'intermediate', 'always');
    ok('a classic song refused for hard violations is NOT retried: the stage ran once, no v2 conversion, the notice is shown', sK3.pipeline === null && rD.refusal === 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS' && rD.notice && rD.runs === 1 && rD.conv.length === 0 && rD.newKeys.length === 0
      && (await pk3.evaluate(() => window.PPP.recordingModulesReady())) === false && recReqs(pk3).length === 0, JSON.stringify(rD));
    ok('no page or console error', clean(pk3), errs(pk3));
    await pk3.close();

        }
/* ------------------------------------------------------------------ a v2 result the page cannot believe */
    if (want('plausible')) {
    console.log('\n── a v2 result outside what a person could mean (tempo above the rhythm controls\' 240) is not kept ──');
    const pz = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await addChecker(pz);
    await pz.evaluate(() => {
      const A = window.PPPAudioScore, real = A.toMusicXml;
      window.__calls = []; window.__bad = true;
      window.PPPAudioScore = Object.assign({}, A, { toMusicXml: function (i, o) {
        /* window.__unreadable: rec/ cannot read the performance (the conversion comes back classic, as it does for notes the skeleton cannot place) */
        if (window.__unreadable && o && o.recording === 'v2') return real.call(this, i, Object.assign({}, o, { recording: undefined }));
        const r = real.apply(this, arguments);
        window.__calls.push({ recording: o && o.recording || null, v2: !!r.recReport });
        if (window.__bad && o && o.recording === 'v2' && r.recReport) r.stats.tempo = 243;   /* what the review measured on a 17-minute recording: 3/8 at 243 */
        return r;
      } });
    });
    const impZ = await importHeard(pz, heardFor.sextuplets);
    const z0 = await stateOf(pz);
    const callsZ = await pz.evaluate(() => window.__calls.slice());
    ok('the import converts twice: v2 (which gave 243), then the classic way; the score is the classic one: no v2 mark, version 7, no flags', impZ.screen === 'review' && callsZ.length === 2 && callsZ[0].recording === 'v2' && callsZ[0].v2 === true && callsZ[1].recording === null && callsZ[1].v2 === false
      && z0.pipeline === null && z0.version === 7 && z0.unc === null, JSON.stringify({ calls: callsZ, p: z0.pipeline, v: z0.version }));
    ok('the review screen says so, in the existing notice style (an issue line, kind recording-v2), in English', z0.issues.indexOf('recording-v2') > -1 && await pz.evaluate(() => /gave an unlikely tempo or length for this recording, so the classic method wrote this score/.test(document.body.innerText)));
    ok('the classic score has its bars adding up as ever', Object.values(z0.scoreClasses).every(v => v === 0) && z0.via === 'live', JSON.stringify(z0.scoreClasses));
    await press(pz, '[data-write-again]');
    await sleep(2500);
    const z1 = await stateOf(pz);
    ok('Write again with v2 on, while v2 still gives 243: nothing is changed, and the page says so', z1.hash === z0.hash && z1.pipeline === null && !(await pz.evaluate(() => !!window.PPP.app.state.recNotation)) && await pz.evaluate(() => /could not read this performance, so nothing was changed/.test(document.body.innerText + (window.PPP.app.state.toast || ''))), JSON.stringify({ same: z1.hash === z0.hash }));
    await pz.evaluate(() => { window.__bad = false; window.__unreadable = true; });
    await press(pz, '[data-write-again]');
    await sleep(2500);
    const z1b = await stateOf(pz);
    ok('Write again with v2 on, while rec/ cannot read the performance (the conversion comes back classic): nothing is changed, and the page says so', z1b.hash === z0.hash && z1b.pipeline === null && !(await pz.evaluate(() => !!window.PPP.app.state.recNotation)), JSON.stringify({ same: z1b.hash === z0.hash, p: z1b.pipeline }));
    await pz.evaluate(() => { window.__unreadable = false; });
    await press(pz, '[data-write-again]');
    await pz.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(600);
    const z2 = await stateOf(pz);
    ok('and with a believable result it is v2 as ever', z2.pipeline === 'v2' && z2.version === 8, JSON.stringify({ p: z2.pipeline }));
    ok('no page or console error', clean(pz), errs(pz));
    await pz.close();

        }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    try { fs.unlinkSync(WAV); } catch (e) { /* the temp file */ }
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
