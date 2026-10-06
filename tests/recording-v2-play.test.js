/* ============================================================================
   G10a-4: "Play as recorded" in the real page (docs/GOALS/G10_AUDIO_TO_SCORE.md section 6.2)

   A second, labelled rendering of a recording: the notes PPP heard, at their own times and velocities, through the page's piano, while the score highlight follows them (where each linked heard note
   sits in the written score). Never the default Play: the ordinary Play, the metronome and practice still use the written score. What this checks, with a spy on the piano's strike():
     - the review screen has the button; pressing it plays: the button says Stop, the ordinary Play is not running, notes are struck, the highlight moves and a note is lit, from the linked notes
     - what is struck is what was heard, at its velocity
     - the ordinary Play stops it (and plays); it stops the ordinary Play; pressing it again stops it; the practice screen has it next to Play and it runs there too
     - a song whose heard notes are not kept on this device says so and plays nothing; a saved song opened from My Songs plays from its kept graph (its heard notes), after a reload
     - the review screen of a 'Full song' (playable piano arrangement) import keeps Play as recorded, has no chip (G10a-5b) and no "Write the notation again" (#161 review)
     - the English, Korean, Japanese and Chinese strings exist; no page or console error

   Runs against its own server on a free port (tests/serve-free.js). node tests/recording-v2-play.test.js
   ========================================================================== */
'use strict';
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const F = require('./recording-v2-fixtures');
const L = require('./recording-v2-lib');
const { errors, sleep, ok, CATALOG, setBase, openPage, clean, errs, importHeard, press, accept } = L;

const PLAY_KEYS = [
  'Play as recorded', 'Stop', 'Plays the notes PPP heard, with their own timing and loudness. The ordinary Play plays the written score.',
  'The heard notes of this song are not kept on this device, so it cannot be played as recorded.'
];

(async () => {
  const srv = await startServer();
  setBase(srv.url);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  const heardFor = { sextuplets: F.sextuplets(14, 7) };
  try {
    console.log('\n── Play as recorded ──');
    ok('every new string has a Korean, a Japanese and a Chinese translation (' + PLAY_KEYS.length + ' strings)', PLAY_KEYS.every(k => ['ko-KR', 'ja-JP', 'zh-CN'].every(l => CATALOG[l][k] && CATALOG[l][k] !== k)));
    const pp = await openPage(browser);
    await importHeard(pp, heardFor.sextuplets);
    await pp.evaluate(() => {
      window.__strikes = [];
      const proto = window.PPP.PianoPlayer.prototype, orig = proto.strike;
      proto.strike = function (midi, when, vel) { window.__strikes.push({ midi: midi, vel: vel }); return orig.call(this, midi, when, vel); };
    });
    await press(pp, '[data-recording-choice="review"] [data-as-recorded]');
    await sleep(3500);
    const a1 = await pp.evaluate(() => { const A = window.PPP.app, S = A.state; return { on: S.asRecorded, beat: S.beat, strikes: window.__strikes.length, label: document.querySelector('[data-as-recorded]').innerText, playing: S.playing, lit: document.querySelectorAll('.ppp-note.ppp-on').length, map: A._ar && A._ar.map.kind }; });
    ok('"Play as recorded" runs: the button says Stop, the ordinary Play is not running, notes are struck, the highlight moved and a note is lit, from the linked notes', a1.on && a1.label === 'Stop' && !a1.playing && a1.strikes > 8 && a1.beat > 2 && a1.map === 'links', JSON.stringify(a1));
    const heardNote = await pp.evaluate(() => window.__heard.notes.length);
    const expectVels = await pp.evaluate(() => { const h = window.__heard.notes; const m = new Map(); h.forEach(n => m.set(n.midi + '|' + n.vel, 1)); return window.__strikes.every(s => m.has(s.midi + '|' + s.vel)); });
    ok('what is struck is what was heard, at its velocity (' + heardNote + ' heard notes; every strike is one of them)', expectVels);
    await pp.evaluate(() => window.PPP.app.togglePlay());
    await sleep(400);
    const a2 = await pp.evaluate(() => ({ on: window.PPP.app.state.asRecorded, ar: !!window.PPP.app._ar, playing: window.PPP.app.state.playing }));
    ok('the ordinary Play stops it and plays', !a2.on && !a2.ar && a2.playing, JSON.stringify(a2));
    await pp.evaluate(() => { window.PPP.app.togglePlay(); });
    await sleep(300);
    await pp.evaluate(() => window.PPP.app.setState({ screen: 'player' })); await sleep(1200);
    await press(pp, '.ppp-transport [data-as-recorded]');
    await sleep(2500);
    const a3 = await pp.evaluate(() => ({ on: window.PPP.app.state.asRecorded, beat: window.PPP.app.state.beat, n: window.__strikes.length }));
    ok('the practice screen has it next to Play and it runs there too', a3.on && a3.beat > 1, JSON.stringify(a3));
    await press(pp, '.ppp-transport [data-as-recorded]');
    await sleep(300);
    ok('pressing it again stops it', await pp.evaluate(() => !window.PPP.app.state.asRecorded && !window.PPP.app._ar));
    await pp.evaluate(() => { window.PPP.app.setState({ screen: 'analysis' }); });
    ok('no page or console error', clean(pp), errs(pp));
    await pp.close();
    const pn = await openPage(browser);
    await pn.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(300);
    await pn.evaluate(() => { const A = window.PPP.app; A.setState({ importSource: Object.assign({}, A.state.importSource || {}, { kind: 'youtube', transcriptionVersion: 7, amt: 'onsets-and-frames' }) }); A.setState({ screen: 'player' }); });
    await sleep(800);
    const none = await pn.evaluate(async () => { await window.PPP.app.toggleAsRecorded(); return { on: !!window.PPP.app.state.asRecorded, toast: window.PPP.app.state.toast }; });
    ok('a song whose heard notes are not kept says so and plays nothing', !none.on && /not kept on this device/.test(none.toast), JSON.stringify(none));
    await pn.close();

    /* a saved song, after a reload: its heard notes are its kept graph's, and it plays as recorded from there (the review screen's notes are gone) */
    const ps = await openPage(browser, { legacy: true });   /* a classic song (the chip off): "Play as recorded" from its kept graph needs only rec/app.js */
    await importHeard(ps, heardFor.sextuplets);
    await accept(ps);
    const sid = await ps.evaluate(() => window.PPP.app.state.songId);
    await sleep(3000);
    await ps.reload({ waitUntil: 'networkidle2' });
    await ps.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await ps.evaluate(() => {
      window.__strikes = [];
      const proto = window.PPP.PianoPlayer.prototype, orig = proto.strike;
      proto.strike = function (midi, when, vel) { window.__strikes.push({ midi: midi, vel: vel }); return orig.call(this, midi, when, vel); };
    });
    await ps.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
    await ps.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid); await sleep(3000);
    await ps.evaluate(() => window.PPP.app.setState({ screen: 'player' })); await sleep(1200);
    ok('after a reload the heard notes are not in memory', await ps.evaluate(() => !window.PPP.app._heard));
    await press(ps, '.ppp-transport [data-as-recorded]');
    await sleep(3500);
    const b1 = await ps.evaluate(() => { const A = window.PPP.app; return { on: A.state.asRecorded, beat: A.state.beat, strikes: window.__strikes.length, map: A._ar && A._ar.map.kind }; });
    ok('the saved song plays as recorded from its kept graph, with the highlight following', b1.on && b1.strikes > 8 && b1.beat > 1 && b1.map === 'links', JSON.stringify(b1));
    await press(ps, '.ppp-transport [data-as-recorded]');
    ok('no page or console error', clean(ps), errs(ps));
    await ps.close();
    /* a 'Full song' import has no "Write the notation again" (the review of #161: it would replace the easy arrangement), and keeps "Play as recorded" */
    const pa = await openPage(browser);
    await pa.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' }));
    await importHeard(pa, heardFor.sextuplets);
    const fa = await pa.evaluate(() => ({ taskMode: window.PPP.app.state.importSource.taskMode, write: !!document.querySelector('[data-write-again]'), play: !!document.querySelector('[data-recording-choice="review"] [data-as-recorded]'), chip: !!document.querySelector('[data-recording-choice="review"] [data-recording-v2-option]') }));
    ok('the review screen of a Full song import has Play as recorded, no chip (G10a-5b: the method does not apply to an arrangement) and no Write the notation again', fa.taskMode === 'piano-arrangement' && fa.play && !fa.chip && !fa.write, JSON.stringify(fa));
    ok('no page or console error', clean(pa), errs(pa));
    await pa.close();
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    try { L.fs.unlinkSync(L.WAV); } catch (e) { /* the temp file */ }
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
