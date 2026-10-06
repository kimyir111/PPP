/* ============================================================================
   G10a-4: the recording conversion v2 in the real page (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6 and 10)

   PPP.recording = 'v2' (the default since G10a-5b, docs/GOALS/G10 section 31) | 'legacy'. What this checks, in the real page and the real screens (the transcription model is replaced by a stub that
   returns heard notes made from numbers, tests/recording-v2-fixtures.js; everything after the notes - the lazy load, the conversion, the review screen, Accept, the saved song, the reload, the Song
   Arranger - is the real app). A page opened with nothing remembered is the default (v2); a test of the classic path opens it the way a person gets it, with 'legacy' remembered (openPage {legacy: true}):
     - the switch: v2 by default (a device with no remembered choice, the key absent, loading writes nothing); 'legacy' and 'v2' accepted and remembered in localStorage ('ppp.recording.v1'); any other
       value (typos, null, 'V2', 'g8', true) is no choice: the default comes back and the remembered choice is forgotten; ?recording=legacy and ?recording=v2 are for that visit only (they win over a
       remembered choice and are not stored); an unknown value in the address has no say (the remembered choice, else the default); a device that remembered 'v2' (the old opt-in) is v2
     - the lazy load: a page that holds 'legacy' asks for none of v2's 17 files however long it stays and whichever screens open; a default page asks for none until a screen that converts opens (not
       on its first paint, not on the other screens), then they come once each, in the order rec/index.js's header gives, weights before the modules; a file that cannot be fetched (or arrives as something
       else) is asked for again ALONE - plus the few files that read its export when they loaded (model, metre and index read attacks, beats, hands) - and nothing that loaded is run twice; the conversion
       made meanwhile is the classic one, said so on the review screen (never a blank page); EACH of the 17 files blocked in turn: the import still reaches the review screen, classic, with the notice
     - the switch control: the chip on the Add-sheet-music screen and on the review screen, ON by default, in English, Korean, Japanese and Chinese, inside the viewport at 400 px, switching it sets
       PPP.recording and the line under it follows (what it is now, how to go back)
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
     - the classic path (chip off, a remembered 'legacy', ?recording=legacy): no v2 mark, no v2 request, and what the conversion hands the page - options, MusicXML, graph, stats, the Score - is what
       origin/main 26417f4 handed it for the same heard notes (tests/fixtures/g10a5b-classic-identity.json, tests/recording-v2-identity.js)

   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build. node tests/recording-v2-app.test.js
   V2_ONLY=basics|block|fixtures|calls|saved|flags|fullsong|undo|fallback|plausible (a regular expression) runs only those sections ('block' is the slow one: 17 imports).
   ========================================================================== */
'use strict';
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const F = require('./recording-v2-fixtures');
const L = require('./recording-v2-lib');
const { fs, path, REPO, errors, sleep, ok, REC_FILES, SCRIPTS, WEIGHTS, CATALOG, want, setBase, openPage, recReqs, clean, errs, addChecker, importHeard, press, stateOf, drawSound, arrangeCheck, accept, slotOf } = L;
const I = require('./recording-v2-identity');
const IDENTITY = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'g10a5b-classic-identity.json'), 'utf8')).fixtures;

const CHIP_LABEL = 'New transcription method';
const CHIP_ON = 'On (the default): a newer way of reading the beat, the hands and the rests. Turn it off to use the classic method.';
const CHIP_OFF = 'Off: the classic method writes the notation. Turn it on to use the newer way of reading the beat, the hands and the rests.';
const NEW_KEYS = [
  CHIP_LABEL, CHIP_ON, CHIP_OFF,
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
  const heardFor = await I.heardFixtures(browser);
  try {
    /* ------------------------------------------------------------------ the switch and the lazy load */
    if (want('basics')) {
    console.log('\n── the switch ──');
    const KEY = 'ppp.recording.v1';
    const p0 = await openPage(browser);
    const sw = await p0.evaluate(() => {
      const P = window.PPP, K = 'ppp.recording.v1', out = { start: P.recording, storedAtStart: localStorage.getItem(K) };
      P.recording = 'legacy'; out.legacy = P.recording; out.storedLegacy = localStorage.getItem(K);
      P.recording = 'v2'; out.v2 = P.recording; out.storedV2 = localStorage.getItem(K);
      [null, undefined, 'V2', 'v1', 'g8', true, 1, '', ' v2', 'typo'].forEach((v, i) => { P.recording = 'legacy'; P.recording = v; out['bad' + i] = P.recording; out['badStored' + i] = localStorage.getItem(K); });
      return out;
    });
    ok('PPP.recording is v2 at page load on a device that remembered nothing (the key was absent until now), and loading wrote nothing', sw.start === 'v2' && sw.storedAtStart === null, JSON.stringify({ start: sw.start, stored: sw.storedAtStart }));
    ok("'legacy' is accepted and remembered on this device", sw.legacy === 'legacy' && sw.storedLegacy === 'legacy', JSON.stringify({ v: sw.legacy, stored: sw.storedLegacy }));
    ok("'v2' is accepted and remembered on this device", sw.v2 === 'v2' && sw.storedV2 === 'v2', JSON.stringify({ v: sw.v2, stored: sw.storedV2 }));
    ok("any other value (null, undefined, 'V2', 'v1', 'g8', true, 1, '', ' v2', 'typo') is no choice: the default (v2) comes back and the remembered choice is forgotten",
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].every(i => sw['bad' + i] === 'v2' && sw['badStored' + i] === null), JSON.stringify(sw));
    await p0.evaluate(() => { window.PPP.recording = 'legacy'; });
    await p0.reload({ waitUntil: 'networkidle2' });
    await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
    ok('a remembered legacy is legacy after a reload (the chip turned off stays off on this device)', (await p0.evaluate(() => window.PPP.recording)) === 'legacy');
    await p0.reload({ waitUntil: 'networkidle2' });
    await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
    ok('and after a SECOND reload too: still legacy and the key is still "legacy" (loading the page rewrites nothing)', (await p0.evaluate(() => [window.PPP.recording, localStorage.getItem('ppp.recording.v1')])).join() === 'legacy,legacy');
    await p0.evaluate(() => { window.PPP.recording = 'v2'; });
    await p0.reload({ waitUntil: 'networkidle2' });
    await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
    ok('a remembered v2 is v2 after a reload', (await p0.evaluate(() => window.PPP.recording)) === 'v2');
    await p0.evaluate(() => { window.PPP.recording = 'typo'; });
    await p0.reload({ waitUntil: 'networkidle2' });
    await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
    ok('and forgetting the choice (a value that is no choice) leaves the key absent and the default after a reload', (await p0.evaluate(() => [window.PPP.recording, localStorage.getItem('ppp.recording.v1')])).join() === 'v2,');
    await p0.close();
    const stored = p => p.evaluate(() => localStorage.getItem('ppp.recording.v1'));
    const mode = p => p.evaluate(() => window.PPP.recording);
    const pq = await openPage(browser, { query: '?recording=legacy' });
    ok('?recording=legacy in the address is legacy for that visit', (await mode(pq)) === 'legacy');
    ok('and is not remembered', (await stored(pq)) === null);
    await pq.close();
    const pq2 = await openPage(browser, { query: '?recording=v2' });
    ok('?recording=v2 in the address is v2 for that visit and is not remembered', (await mode(pq2)) === 'v2' && (await stored(pq2)) === null);
    await pq2.close();
    const pq3 = await openPage(browser, { query: '?recording=v2', store: { [KEY]: 'legacy' } });
    ok('?recording=v2 wins over a remembered legacy for that visit, and the remembered choice is not overwritten', (await mode(pq3)) === 'v2' && (await stored(pq3)) === 'legacy');
    await pq3.close();
    const pq4 = await openPage(browser, { query: '?recording=legacy', store: { [KEY]: 'v2' } });
    ok('?recording=legacy wins over a remembered v2 for that visit, and the remembered choice is not overwritten', (await mode(pq4)) === 'legacy' && (await stored(pq4)) === 'v2');
    await pq4.close();
    const pb = await openPage(browser, { query: '?recording=bogus' });
    ok('?recording=<an unknown value> has no say: a device that remembered nothing gets the default (v2)', (await mode(pb)) === 'v2');
    await pb.close();
    const pb2 = await openPage(browser, { query: '?recording=bogus', store: { [KEY]: 'legacy' } });
    ok('and an unknown value in the address does not take away a remembered legacy (the old convention made it legacy; it is no choice now)', (await mode(pb2)) === 'legacy');
    await pb2.close();
    const pb3 = await openPage(browser, { query: '?recording=' });
    ok('an empty ?recording= is no choice either: v2', (await mode(pb3)) === 'v2');
    await pb3.close();
    const ps = await openPage(browser, { store: { [KEY]: 'g8' } });
    ok('a remembered value that is neither (corrupt, from another build) is no choice: the default (v2)', (await mode(ps)) === 'v2');
    await ps.close();
    const ps2 = await openPage(browser, { store: { [KEY]: 'v2' } });
    ok('a device that remembered v2 (the opt-in of G10a-4) is v2: nobody stored a v2 that meant something else', (await mode(ps2)) === 'v2');
    await ps2.close();

    console.log('\n── nothing is asked for by a page that holds legacy ──');
    const pl = await openPage(browser, { legacy: true });
    await sleep(3500);
    const idle0 = recReqs(pl);
    await pl.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(300);
    await pl.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(1200);
    const upl = await pl.evaluate(() => window.PPP.app.state.screen);
    const idle1 = recReqs(pl);
    ok('a page that remembers legacy has requested none of v2\'s files 3.5 s after load', idle0.length === 0, idle0.join(', '));
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

    console.log('\n── the default: the files are not asked for by the first paint or the other screens, they come once each, in order, when a screen that converts opens ──');
    const pv = await openPage(browser);
    ok('a fresh page is v2 and nothing is remembered', (await mode(pv)) === 'v2' && (await stored(pv)) === null);
    await sleep(3000);
    ok('v2 is the default but no screen that converts is open: 3 s after load nothing is asked for', recReqs(pv).length === 0, recReqs(pv).join(', '));
    const elsewhere = [];
    for (const label of ['My Songs', 'Practice', 'Home']) { await pv.evaluate(l => window.__pppTest.nav(l), label); await sleep(500); elsewhere.push(recReqs(pv).length); }
    ok('and none while the person looks at My Songs, Practice and Home', elsewhere.every(n => n === 0), elsewhere.join());
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
    /* a device that remembered v2 behaves exactly the same (the key is only a remembered choice) */
    const pv2 = await openPage(browser, { store: { [KEY]: 'v2' } });
    await sleep(1500);
    ok('a device that remembered v2: nothing asked for until a screen that converts opens', recReqs(pv2).length === 0);
    await pv2.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(250);
    await pv2.evaluate(() => document.querySelector('[data-add-card]').click());
    await pv2.waitForFunction(() => window.PPP.recordingModulesReady(), { timeout: 30000 });
    await sleep(300);
    ok('and then the same 17 files, each once', recReqs(pv2).length === 17, String(recReqs(pv2).length));
    await pv2.close();

    console.log('\n── a file that cannot be fetched ──');
    const pf = await openPage(browser, { failWhile: /\/rec\/writer\.js/ });
    await addChecker(pf);
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
    const fw = await pw.evaluate(() => window.PPP.loadRecordingModules());
    ok('a weights file that fails is a false, not a throw, and no script ran without its weights', fw === false && (await pw.evaluate(() => !window.PPPRec)) && recReqs(pw).filter(u => /\.js$/.test(u)).length === 0, recReqs(pw).join(' '));
    pw.__rec.failOn = false;
    ok('and the next attempt loads everything', (await pw.evaluate(() => window.PPP.loadRecordingModules())) === true);
    await pw.close();

    /* ------------------------------------------------------------------ the control */
    console.log('\n── the switch control: on by default, off and on again ──');
    for (const loc of ['en-US', 'ko-KR', 'ja-JP', 'zh-CN']) {
      const tr = k => (loc === 'en-US' ? k : CATALOG[loc][k]);
      const cp = await openPage(browser, { locale: loc, width: 400, height: 900 });
      await cp.evaluate(() => window.PPP.app.go('upload')()); await sleep(600);   /* by the app's own route, not the English label of the sidebar */
      const read = () => cp.evaluate(() => {
        const b = document.querySelector('[data-recording-choice="upload"] [data-recording-v2-option]'); if (!b) return null;
        const r = b.getBoundingClientRect(), hint = b.parentElement.querySelector('p');
        return { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), inView: r.left >= 0 && r.right <= window.innerWidth + 1, noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1, hint: hint && hint.innerText.trim(),
          stored: localStorage.getItem('ppp.recording.v1'), mode: window.PPP.recording };
      });
      const c = await read();
      ok(loc + ': the chip is on the Add-sheet-music screen, ON by default, labelled "' + tr(CHIP_LABEL) + '", with the line that says it is the default and how to go back, inside a 400 px viewport with no sideways scroll',
        !!c && c.text === tr(CHIP_LABEL) && c.pressed === 'true' && c.mode === 'v2' && c.stored === null && c.hint === tr(CHIP_ON) && c.inView && c.noSideScroll, JSON.stringify(c));
      if (loc === 'ko-KR') ok('the Korean label is "새 받아쓰기 방식" (the opt-in\'s "(실험)", experimental, is gone: it is the default now)', c && c.text === '새 받아쓰기 방식' && !/실험/.test(c.hint), c && c.text);
      await press(cp, '[data-recording-choice="upload"] [data-recording-v2-option]'); await sleep(400);
      const off = await read();
      ok(loc + ': pressed once the chip is OFF: PPP.recording legacy, remembered as legacy, the line says it is off and how to turn it on', !!off && off.pressed === 'false' && off.mode === 'legacy' && off.stored === 'legacy' && off.hint === tr(CHIP_OFF) && off.text === tr(CHIP_LABEL), JSON.stringify(off));
      await press(cp, '[data-recording-choice="upload"] [data-recording-v2-option]'); await sleep(400);
      const on = await read();
      ok(loc + ': pressed again it is ON: v2, remembered as v2, the line is the first one again', !!on && on.pressed === 'true' && on.mode === 'v2' && on.stored === 'v2' && on.hint === tr(CHIP_ON), JSON.stringify(on));
      await cp.close();
    }
    NEW_KEYS.forEach(k => ['ko-KR', 'ja-JP', 'zh-CN'].forEach(l => { if (!(CATALOG[l][k] && CATALOG[l][k] !== k)) ok(l + ' has the string "' + k.slice(0, 50) + '"', false); }));
    ok('every new string has a Korean, a Japanese and a Chinese translation (' + NEW_KEYS.length + ' strings)', NEW_KEYS.every(k => ['ko-KR', 'ja-JP', 'zh-CN'].every(l => CATALOG[l][k] && CATALOG[l][k] !== k)));
    ok('and each keeps the placeholders of the English', NEW_KEYS.every(k => { const ph = (k.match(/\{\{\w+\}\}/g) || []).sort().join(); return ['ko-KR', 'ja-JP', 'zh-CN'].every(l => (CATALOG[l][k].match(/\{\{\w+\}\}/g) || []).sort().join() === ph); }));
    ok('the strings of the opt-in that is gone ("(experimental)", "Off keeps the classic method.") are not in the catalogs any more', ['ko-KR', 'ja-JP', 'zh-CN'].every(l => !CATALOG[l]['New transcription method (experimental)'] && !CATALOG[l]['A newer way of reading the beat, the hands and the rests. Off keeps the classic method.']));
    /* the chip on the review screen of a default import: ON, the notation says it was written with the new method; turned off it says how to write it again */
    const pc = await openPage(browser);
    await addChecker(pc);
    await importHeard(pc, heardFor.sextuplets);
    const rv = () => pc.evaluate(() => {
      const b = document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]');
      return b ? { pressed: b.getAttribute('aria-pressed'), text: b.innerText.trim(), hint: b.parentElement.querySelector('p').innerText.trim(), method: document.querySelector('[data-recording-method]').innerText.trim() } : null;
    });
    const rv0 = await rv();
    ok('the review screen of a default import shows the chip ON, with the line for ON, and says the notation was written with the new method', !!rv0 && rv0.pressed === 'true' && rv0.text === CHIP_LABEL && rv0.hint === CHIP_ON && /new method/.test(rv0.method), JSON.stringify(rv0));
    await press(pc, '[data-recording-choice="review"] [data-recording-v2-option]'); await sleep(400);
    const rv1 = await rv();
    ok('pressed there the chip is OFF (the notation already written stays what it is until "Write the notation again")', !!rv1 && rv1.pressed === 'false' && rv1.hint === CHIP_OFF && /new method/.test(rv1.method) && (await pc.evaluate(() => window.PPP.recording)) === 'legacy' && (await stateOf(pc)).pipeline === 'v2');
    /* Space on the focused chip presses the chip; it does not start playback (the global key handler exempts it, as it exempts the one-note chip). A control: Space elsewhere does play. */
    await pc.evaluate(() => { const b = document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]'); b.focus(); });
    await pc.keyboard.press('Space'); await sleep(700);
    const sp = await pc.evaluate(() => ({ playing: !!window.PPP.app.state.playing, focus: document.activeElement && document.activeElement.hasAttribute('data-recording-v2-option') }));
    ok('Space on the focused chip does not start playback', sp.playing === false, JSON.stringify(sp));
    await pc.evaluate(() => document.activeElement && document.activeElement.blur());
    await pc.keyboard.press('Space'); await sleep(700);
    ok('control: Space with the focus elsewhere starts playback (the key handler is live on this screen)', await pc.evaluate(() => !!window.PPP.app.state.playing));
    await pc.evaluate(() => { if (window.PPP.app.state.playing) window.PPP.app.togglePlay(); });
    await pc.close();

    /* ------------------------------------------------------------------ the classic path */
    console.log('\n── the classic path: PPP.recording = legacy (a remembered legacy, the chip turned off, ?recording=legacy) ──');
    const pcl = await openPage(browser, { legacy: true });
    await addChecker(pcl);
    const impL = await importHeard(pcl, heardFor.sextuplets);
    const sL = await stateOf(pcl);
    ok('an import on a page that remembers legacy is the classic conversion: no v2 mark, version 7, no flags, ZERO /rec/ requests', impL.screen === 'review' && sL.pipeline === null && sL.version === 7 && sL.unc === null && recReqs(pcl).length === 0, JSON.stringify({ p: sL.pipeline, v: sL.version, unc: sL.unc, req: recReqs(pcl).length }));
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
    ok('the classic review\'s tiles are the classic ones: no "Unsure measures" tile, "Needs a look" is there', await pcl.evaluate(() => { const k = [...document.querySelectorAll('[data-review-stat]')].map(e => e.getAttribute('data-review-stat')); return k.indexOf('Unsure measures') < 0 && k.indexOf('Needs a look') > -1 && k.slice(1, 6).join() === 'Measures,Notes,Tempo,Time,Needs a look' && k.indexOf('Unsure measures') < 0; }));
    ok('no page or console error', clean(pcl), errs(pcl));
    await pcl.close();
    /* what the classic conversion hands the page is what origin/main handed it (26417f4, the last page whose default was classic): the options, the MusicXML, the graph, the stats, the Score, the source and
       the report, for each fixture, by each way to be classic: a remembered legacy, ?recording=legacy, and the chip pressed off on a default page */
    const sameAsMain = (name, got) => {
      const want = IDENTITY[name];
      const diffs = [];
      if (JSON.stringify(got.calls) !== JSON.stringify(want.calls)) diffs.push('calls ' + JSON.stringify(got.calls) + ' vs ' + JSON.stringify(want.calls));
      ['score', 'sourceKeys', 'tempo', 'version', 'pipeline', 'engine', 'quantizer', 'reportKeys', 'issues', 'level'].forEach(k => { if (got[k] !== want[k]) diffs.push(k + ' ' + got[k] + ' vs ' + want[k]); });
      return diffs;
    };
    for (const name of ['sextuplets', 'keys', 'pedal', 'hymn']) {
      const pi = await openPage(browser, { legacy: true });
      await I.installRecorder(pi);
      await importHeard(pi, heardFor[name]);
      const fp = await I.fingerprint(pi);
      const d = sameAsMain(name, fp);
      ok('classic identity, "' + name + '" (remembered legacy): one conversion, its options, MusicXML, graph and stats, the Score, the source and the report are exactly what origin/main 26417f4 made for the same heard notes, and no /rec/ request', d.length === 0 && fp.calls.length === 1 && recReqs(pi).length === 0, d.join(' | ').slice(0, 600));
      await pi.close();
    }
    {
      const pi = await openPage(browser, { query: '?recording=legacy' });
      await I.installRecorder(pi);
      await importHeard(pi, heardFor.sextuplets);
      const d = sameAsMain('sextuplets', await I.fingerprint(pi));
      ok('classic identity through ?recording=legacy: the same as origin/main, and nothing remembered', d.length === 0 && (await pi.evaluate(() => localStorage.getItem('ppp.recording.v1'))) === null && recReqs(pi).length === 0, d.join(' | ').slice(0, 400));
      await pi.close();
      const pj = await openPage(browser);
      await I.installRecorder(pj);
      await pj.evaluate(() => window.PPP.app.go('upload')()); await sleep(500);
      await press(pj, '[data-recording-choice="upload"] [data-recording-v2-option]'); await sleep(300);   /* the chip pressed off, on the Add screen, after the files were asked for */
      const dj = sameAsMain('sextuplets', await (async () => { await importHeard(pj, heardFor.sextuplets); return I.fingerprint(pj); })());
      ok('classic identity through the chip pressed off on a default page: the same as origin/main (the files the Add screen had asked for are loaded and unused)', dj.length === 0 && (await pj.evaluate(() => window.PPP.recording)) === 'legacy', dj.join(' | ').slice(0, 400));
      await pj.close();
    }

        }
/* ------------------------------------------------------------------ each of the 17 files, blocked in turn */
    if (want('block')) {
    console.log('\n── every one of v2\'s 17 files, blocked in turn: the import still reaches the review screen, written the classic way, with the notice ──');
    {
      const all = WEIGHTS.concat(SCRIPTS);
      let n = 0;
      for (const f of all) {
        /* a fresh default profile; the file never arrives (the request is refused for the whole life of the page); the person imports as usual */
        const pk = await openPage(browser, { failWhile: new RegExp(f.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '(\\?|$)') });
        await addChecker(pk);
        const imp = await importHeard(pk, heardFor.sextuplets);
        const sk = await stateOf(pk);
        const notice = await pk.evaluate(() => /could not be loaded, so the classic method wrote this score/.test(document.body.innerText));
        const classicOk = imp.screen === 'review' && !imp.error && sk.pipeline === null && sk.version === 7 && sk.unc === null && sk.issues.indexOf('recording-v2') > -1 && notice
          && Object.values(sk.scoreClasses).every(v => v === 0) && sk.measures > 0 && sk.notes > 0 && pk.__rec.failed.length > 0;
        if (!classicOk) ok(f + ' blocked: the import reaches the review screen, classic, with the notice', false, JSON.stringify({ imp: imp, p: sk.pipeline, v: sk.version, issues: sk.issues, notice: notice, failed: pk.__rec.failed.length }));
        else n++;
        /* a failed script is a syntax-free abort: only network errors, never a page error that stops the import */
        if (!classicOk) { await pk.close(); continue; }
        if (pk.__rec.pageErrors.some(m => !/attacks|beats|model|metre|hands|index|grid|voices|rests|writer|key|pedal|app|undefined|Cannot read|PPPRec/.test(m))) ok(f + ' blocked: no unrelated page error', false, errs(pk));
        await pk.close();
      }
      ok('each of the 17 files blocked alone (' + all.map(x => x.replace(/^\/rec\/(weights\/)?|\.js(on)?$/g, '')).join(' ') + '): the import reaches the review screen, is the classic conversion (no v2 mark, version 7), says why, and its bars add up (' + n + ' of ' + all.length + ')', n === all.length);
    }

    /* G10a-5b: a weights file that is JSON but not the file ({} or []) is not accepted: the stages would run on an empty model and write a worse score without a word */
    console.log('\n\u2500\u2500 each weights file served as {} and as [] (valid JSON, the wrong shape) \u2500\u2500');
    {
      let bad = 0;
      for (const f of WEIGHTS) for (const body of ['{}', '[]']) {
        const pk = await openPage(browser, { corrupt: { re: new RegExp(f.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '(\\?|$)'), body: body } });
        await addChecker(pk);
        const imp = await importHeard(pk, heardFor.sextuplets);
        const sk = await stateOf(pk);
        const info = await pk.evaluate(() => ({ notice: /could not be loaded, so the classic method wrote this score/.test(document.body.innerText), noStages: !window.PPPRec && !window.PPPRecWriter, ready: window.PPP.recordingModulesReady() }));
        const good = imp.screen === 'review' && sk.pipeline === null && sk.version === 7 && sk.issues.indexOf('recording-v2') > -1 && info.notice && info.noStages && !info.ready && Object.values(sk.scoreClasses).every(v => v === 0);
        if (!good) { bad++; ok(f + ' served as ' + body + ': classic, with the notice, no stage ran', false, JSON.stringify({ p: sk.pipeline, v: sk.version, issues: sk.issues, info: info, rests: sk.rests })); }
        await pk.close();
      }
      ok('each of the four weights files served as {} and as [] (8 runs): the load is refused, no stage script runs, the import is the classic one with the notice', bad === 0);
      /* the page's own check, on the real files and on a few wrong ones */
      const pv = await openPage(browser);
      const shape = await pv.evaluate(async () => {
        const out = {};
        for (const w of window.PPP.RECORDING_WEIGHTS) { const j = await (await fetch('./' + w[1])).json(); out[w[0]] = { real: window.PPP.recWeightsShapeOk(w[0], j), empty: window.PPP.recWeightsShapeOk(w[0], {}), arr: window.PPP.recWeightsShapeOk(w[0], []), nul: window.PPP.recWeightsShapeOk(w[0], null), noWeights: window.PPP.recWeightsShapeOk(w[0], Object.assign({}, j, { weights: undefined, params: undefined })) }; }
        return out;
      });
      ok('the real files pass the shape check and {}, [], null and a file without its weights do not (' + Object.keys(shape).join(', ') + ')', Object.values(shape).every(r => r.real === true && r.empty === false && r.arr === false && r.nul === false), JSON.stringify(shape));
      await pv.close();
    }

    /* G10a-5b: a v2 file that never answers does not hold the import (nor every later one) */
    console.log('\n\u2500\u2500 a v2 file that never answers (rec/grid.js held): the import waits about 15 s, then is classic; the next import is not held; when the file comes, v2 works \u2500\u2500');
    {
      const ph = await openPage(browser, { holdWhile: /\/rec\/grid\.js/ });
      await addChecker(ph);
      const t0 = Date.now();
      const imp1 = await importHeard(ph, heardFor.sextuplets);
      const secs1 = (Date.now() - t0) / 1000;
      const s1 = await stateOf(ph);
      ok('the import reaches the review screen in about 15 s (' + secs1.toFixed(1) + ' s), classic, with the notice', imp1.screen === 'review' && secs1 >= 12 && secs1 < 40 && s1.pipeline === null && s1.version === 7 && s1.issues.indexOf('recording-v2') > -1 && Object.values(s1.scoreClasses).every(v => v === 0), JSON.stringify({ secs: secs1, p: s1.pipeline, issues: s1.issues }));
      const t1 = Date.now();
      const imp2 = await importHeard(ph, heardFor.sextuplets);
      const secs2 = (Date.now() - t1) / 1000;
      const s2 = await stateOf(ph);
      ok('the next import in the same session is not held for ever either (' + secs2.toFixed(1) + ' s): classic, with the notice (the shared load was reset, so it tried again)', imp2.screen === 'review' && secs2 >= 12 && secs2 < 40 && s2.pipeline === null && s2.issues.indexOf('recording-v2') > -1, JSON.stringify({ secs: secs2, p: s2.pipeline }));
      ok('the stalled file was asked for once, and one script element holds it (a second would run the file twice when it arrives)', recReqs(ph).filter(u => u === '/rec/grid.js').length === 1 && (await ph.evaluate(() => document.querySelectorAll('script[src*="/rec/grid.js"]').length)) === 1, String(recReqs(ph).filter(u => u === '/rec/grid.js').length));
      ph.__rec.release();
      await ph.waitForFunction(() => window.PPP.recordingModulesReady(), { timeout: 30000 }).catch(() => {});
      const readyNow = await ph.evaluate(() => window.PPP.recordingModulesReady());
      const t2 = Date.now();
      const imp3 = await importHeard(ph, heardFor.sextuplets);
      const secs3 = (Date.now() - t2) / 1000;
      const s3 = await stateOf(ph);
      ok('when the file arrives v2 is ready and the next import is v2 at once (' + secs3.toFixed(1) + ' s)', readyNow === true && imp3.screen === 'review' && s3.pipeline === 'v2' && secs3 < 12, JSON.stringify({ ready: readyNow, p: s3.pipeline, secs: secs3 }));
      ok('and each script ran once (one element a request), no page error', (await ph.evaluate(() => document.querySelectorAll('script[src*="/rec/"]').length)) === recReqs(ph).filter(u => /\.js$/.test(u)).length && ph.__rec.pageErrors.length === 0, errs(ph));
      await ph.close();
    }

        }
/* ------------------------------------------------------------------ which review screens ask for v2's files */
    if (want('warm')) {
    console.log('\n\u2500\u2500 the review screen of a saved MusicXML song asks for none of v2\'s files; the review screen of a saved recording asks for them (opened without visiting Add) \u2500\u2500');
    const HYMN = path.join(REPO, 'catalog', 'hymns', 'christ-arose.musicxml');
    const seed = await openPage(browser);
    await seed.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(250);
    await seed.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(300);
    await (await seed.$('input[type=file][data-add-file]')).uploadFile(HYMN);
    await seed.waitForFunction(() => window.PPP.app.state.score && window.PPP.app.state.score.id !== 'demo' && window.PPP.app.state.screen !== 'analysis-pending', { timeout: 30000 });
    await sleep(1500);
    const idM = await seed.evaluate(() => window.PPP.app.state.songId);
    if ((await seed.evaluate(() => window.PPP.app.state.screen)) === 'review') await accept(seed);
    await importHeard(seed, heardFor.sextuplets);
    const idR = await seed.evaluate(() => window.PPP.app.state.songId);
    await accept(seed);
    ok('two saved songs: a MusicXML score and a recording (v2)', !!(await slotOf(seed, idM)) && !!(await slotOf(seed, idR)) && (await slotOf(seed, idR)).importSource.recordingPipeline === 'v2' && !(await slotOf(seed, idM)).importSource.recordingPipeline);
    await sleep(2500);
    const keep = await seed.evaluate(() => { const o = {}; Object.keys(localStorage).forEach(k => { o[k] = localStorage.getItem(k); }); return o; });
    await seed.close();
    for (const mode of ['default', 'legacy']) {
      const pw = await openPage(browser, { store: Object.assign({}, keep, mode === 'legacy' ? L.CLASSIC : {}) });
      await sleep(1500);
      await pw.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
      await pw.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, idM); await sleep(2500);
      await pw.evaluate(() => window.PPP.app.setState({ screen: 'review' })); await sleep(2500);
      ok(mode + ': the review screen of the saved MusicXML song (Add never opened) asks for none of v2\'s files', recReqs(pw).length === 0 && (await pw.evaluate(() => window.PPP.recordingModulesReady())) === false, recReqs(pw).join(' '));
      await pw.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
      await pw.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, idR); await sleep(2500);
      await pw.evaluate(() => window.PPP.app.setState({ screen: 'review' }));
      if (mode === 'default') {
        const got = await pw.waitForFunction(() => window.PPP.recordingModulesReady(), { timeout: 30000 }).then(() => true).catch(() => false);
        await sleep(400);
        ok('default: the review screen of the saved recording (Add never opened) asks for them, once each (17)', got && recReqs(pw).length === 17, String(recReqs(pw).length));
      } else {
        await sleep(2500);
        ok('legacy remembered: the review screen of the saved recording asks for none', recReqs(pw).length === 0, recReqs(pw).join(' '));
      }
      ok('no page or console error', clean(pw), errs(pw));
      await pw.close();
    }

        }
/* ------------------------------------------------------------------ v2 through the real screens, on each fixture */
    if (want('fixtures')) {
    for (const name of ['sextuplets', 'keys', 'pedal', 'hymn']) {
      console.log('\n── v2 on the fixture "' + name + '": import, review, Accept, the saved song, a reload ──');
      const pg = await openPage(browser);
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
      const tiles = await pg.evaluate(() => { const o = {}; document.querySelectorAll('[data-review-stat]').forEach(e => { o[e.getAttribute('data-review-stat')] = e.innerText.split('\n').pop().trim(); }); return o; });
      ok('the review tiles say what the strip shows: "Unsure measures" is the count of the amber flags (' + (s.unc ? s.unc.length : 0) + '; no such tile when there are none), "Needs a look" is still the red count',
        (s.unc && s.unc.length ? tiles['Unsure measures'] === String(s.unc.length) : tiles['Unsure measures'] === undefined) && typeof tiles['Needs a look'] === 'string', JSON.stringify(tiles));
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
    const pr = await openPage(browser);
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
    const ps2 = await openPage(browser, { legacy: true });   /* an old saved classic song: made by the classic conversion, the chip off */
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
    const tl = await pu.evaluate(() => { const o = {}; document.querySelectorAll('[data-review-stat]').forEach(e => { o[e.getAttribute('data-review-stat')] = e.innerText.split('\n').pop().trim(); }); return o; });
    ok('the tiles follow the report: "Unsure measures" 2 (the amber flags), "Needs a look" 1 (the red one)', tl['Unsure measures'] === '2' && tl['Needs a look'] === '1', JSON.stringify(tl));
    ok('an unsure bar is amber with its reason in the tooltip, a bar that needs checking stays red (and names both reasons), a sure bar is neither; the legend counts them',
      !!fl.c2 && /warn/.test(fl.c2.bg) && /not sure of the beat/.test(fl.c2.title) && /bad/.test(fl.c5.bg) && /which hand/.test(fl.c5.title) && !/warn|bad/.test(fl.c1.bg) && /Measures where PPP was not sure of the hands or the beat \(2\)/.test(fl.legend), JSON.stringify(fl));
    await pu.close();
    const pk = await openPage(browser, { locale: 'ko-KR' });
    await importHeard(pk, heardFor.sextuplets);
    await pk.evaluate(() => { const A = window.PPP.app, S = A.state; A.setState({ importReport: Object.assign({}, S.importReport, { uncertainMeasures: [3], uncertainWhy: { 3: ['grid'] } }) }); });
    await sleep(600);
    const kl = await pk.evaluate(() => { const l = document.querySelector('[data-uncertain-legend]'); return l && l.innerText.trim(); });
    const kt = await pk.evaluate(() => { const e = document.querySelector('[data-review-stat="Unsure measures"]'); return e && e.innerText.replace(/\s+/g, ' ').trim(); });
    ok('in Korean the tile reads "' + CATALOG['ko-KR']['Unsure measures'] + ' 1" (from the catalog)', kt === CATALOG['ko-KR']['Unsure measures'] + ' 1', kt);
    ok('in Korean the legend says "PPP가 손 배분이나 박자를 확신하지 못한 마디" (the hands or the beat)', /PPP가 손 배분이나 박자를 확신하지 못한 마디 \(1개\)/.test(kl || ''), kl);
    await pk.close();

        }
/* ------------------------------------------------------------------ a "Full song" import is not a transcription */
    if (want('fullsong')) {
    console.log('\n── a "Full song" import: no "Write the notation again" (it would replace the easy arrangement with the full transcription) ──');
    const pa = await openPage(browser);
    await addChecker(pa);
    await pa.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' }));
    const impA = await importHeard(pa, heardFor.sextuplets);
    const a0 = await stateOf(pa);
    const ui = () => pa.evaluate(() => ({
      taskMode: window.PPP.app.state.importSource && window.PPP.app.state.importSource.taskMode,
      block: !!document.querySelector('[data-recording-choice="review"]'), chip: !!document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]'),
      method: !!document.querySelector('[data-recording-method]'), write: !!document.querySelector('[data-write-again]'), undo: !!document.querySelector('[data-notation-undo]'),
      hint: /Writes the notation of this song again/.test(document.body.innerText),
      /* G10a-5b: the chip, the line under it and the note beside the rhythm controls are for a faithful transcription */
      chipLine: /On \(the default\)|Off: the classic method|a newer way of reading the beat/.test(document.body.innerText), lockNote: !!document.querySelector('[data-lock-v2-note]'),
      lockBox: !!document.querySelector('[data-rhythm-lock]'), methodText: (document.querySelector('[data-recording-method]') || {}).innerText || '', pointsToWriteAgain: /use "Write the notation again"/.test(document.body.innerText),
      asRecorded: !!document.querySelector('[data-recording-choice="review"] [data-as-recorded]')
    }));
    const ua = await ui();
    ok('a Full song import is the easy arrangement (taskMode piano-arrangement), written the classic way (v2 is for faithful transcriptions)', impA.screen === 'review' && ua.taskMode === 'piano-arrangement' && a0.pipeline === null, JSON.stringify({ imp: impA.screen, ua: ua, p: a0.pipeline }));
    ok('its review screen has no "Write the notation again" button and no hint for it', ua.write === false && ua.hint === false && ua.undo === false, JSON.stringify(ua));
    ok('the recording block keeps the method line (classic) and "Play as recorded", and has NO chip, no line about the new method being on, and nothing that points to "Write the notation again" (the Fix the beat box is still there, without the note)',
      ua.block && ua.method && /classic method/.test(ua.methodText) && ua.asRecorded && ua.chip === false && ua.chipLine === false && ua.lockBox === true && ua.lockNote === false && ua.pointsToWriteAgain === false, JSON.stringify(ua));
    /* a stale click, or a script, cannot do it either: the same Score and graph afterwards */
    await pa.evaluate(() => window.PPP.app.writeNotationAgain());
    await sleep(2500);
    const a1 = await stateOf(pa), ua1 = await ui();
    ok('calling writeNotationAgain() on it changes nothing: the same notation, still the arrangement, no status line, nothing to undo', a1.hash === a0.hash && a1.songId === a0.songId && a1.notes === a0.notes && ua1.taskMode === 'piano-arrangement' && !(await pa.evaluate(() => !!window.PPP.app.state.recNotation)) && !ua1.undo, JSON.stringify({ a0: a0.hash, a1: a1.hash, ua1: ua1 }));
    /* saved, reloaded, opened from My Songs: the same review screen */
    await accept(pa);
    const idA = a0.songId;
    await sleep(2500);
    await pa.reload({ waitUntil: 'networkidle2' });
    await pa.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await pa.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
    await pa.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, idA); await sleep(2500);
    await pa.evaluate(() => window.PPP.app.setState({ screen: 'review' })); await sleep(900);
    const ua2 = await ui();
    ok('the saved Full song, reopened: the same review screen (no chip, no line, no note, no Write again; the method line says classic)', ua2.taskMode === 'piano-arrangement' && ua2.block && ua2.chip === false && ua2.chipLine === false && ua2.lockNote === false && ua2.write === false && /classic method/.test(ua2.methodText), JSON.stringify(ua2));
    ok('no page or console error', clean(pa), errs(pa));
    await pa.close();
    const pt = await openPage(browser);
    await importHeard(pt, heardFor.sextuplets);
    const ut = await pt.evaluate(() => ({ taskMode: window.PPP.app.state.importSource.taskMode, write: !!document.querySelector('[data-write-again]'), hint: /Writes the notation of this song again/.test(document.body.innerText),
      chip: !!document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]'), lockNote: !!document.querySelector('[data-lock-v2-note]') }));
    ok('and a faithful transcription (the default recording type) still has the button and its hint, the chip and the note beside the rhythm controls', ut.taskMode === 'faithful-transcription' && ut.write && ut.hint && ut.chip && ut.lockNote, JSON.stringify(ut));
    await pt.close();
    /* a page that remembers legacy: the note beside the rhythm controls is about the new method being ON, so it is not there */
    const pq = await openPage(browser, { legacy: true });
    await importHeard(pq, heardFor.sextuplets);
    ok('with legacy remembered the review screen has the chip (off) and no "new method is on" note', await pq.evaluate(() => !!document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]') && !document.querySelector('[data-lock-v2-note]')));
    await pq.close();

        }
/* ------------------------------------------------------------------ Undo puts the practice progress back; the shelf card follows the notation */
    if (want('undo')) {
    console.log('\n── Undo restores what Write again starts over (mastered, memory level, blind runs, tempo, loop range); the shelf card says the new measure count ──');
    const pn = await openPage(browser);
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
        if (m === 'always' || (m === 'first' && n === 1) || (m === 'twice' && n <= 2)) return Promise.resolve({ ok: false, reason: 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', discarded: [] });
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
    const pk2 = await openPage(browser);
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
    ok('refused every time (v2, v2 with the classic hands, the classic conversion): the refusal notice is shown (ALL_CANDIDATES_HAVE_HARD_VIOLATIONS), nothing is saved, and the candidates stage ran exactly three times, two conversions (no loop)',
      rB.refusal === 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS' && rB.notice && rB.newKeys.length === 0 && rB.runs === 3 && rB.conv.length === 2 && rB.conv.filter(c => c.recording === 'v2').length === 1, JSON.stringify(rB));
    /* G10a-5b: refused twice (v2, then v2 with the classic hands), the classic conversion of the same heard notes is arranged: the copy says classicFallback, the saved song is as it was */
    const rE = await arrangerCopy(pk2, idK, 'advanced', 'twice');
    const convE = rE.conv;
    ok('refused twice, the classic conversion is arranged: a copy is saved, the candidates stage ran three times, the conversions were v2 with the classic hands and then the classic one (no recording option)',
      rE.refusal === null && rE.newKeys.length === 1 && rE.runs === 3 && convE.length === 2 && convE[0].recording === 'v2' && convE[0].hands === 'legacy' && convE[1].recording === null && convE[1].hands === null && convE[1].closeGaps && convE[1].exactBars, JSON.stringify(rE));
    const copyE = await slotOf(pk2, (rE.newKeys[0] || '').replace('ppp.song.v1.', '')), origE = await slotOf(pk2, idK);
    ok('its source says so: arrangement.classicFallback true (and no handsFallback), the one-note-per-hand engine; the saved v2 song is untouched',
      !!copyE && copyE.importSource.arrangement.classicFallback === true && !copyE.importSource.arrangement.handsFallback && copyE.importSource.arrangement.engine === 'ppp.g9-single'
      && !!origE && origE.importSource.recordingPipeline === 'v2' && origE.importSource.transcriptionVersion === 8 && !origE.importSource.arrangement, copyE ? JSON.stringify(copyE.importSource.arrangement) : 'no copy');
    /* any other code: no retry */
    const rC = await arrangerCopy(pk2, idK, 'advanced', 'other');
    ok('a refusal with another code (NO_SELECTION) is not retried: the candidates stage ran once, no conversion, the notice is shown', rC.refusal === 'NO_SELECTION' && rC.notice && rC.runs === 1 && rC.conv.length === 0 && rC.newKeys.length === 0, JSON.stringify(rC));
    ok('no page or console error', clean(pk2), errs(pk2));
    await pk2.close();
    /* a classic song: the same refusal is not retried */
    const pk3 = await openPage(browser, { legacy: true });
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
    const pz = await openPage(browser);
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
