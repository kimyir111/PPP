const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const ok = (name, condition, detail) => {
  console.log((condition ? '  PASS ' : '  FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!condition) errors.push(name + (detail ? ' - ' + detail : ''));
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && PPP.app && PPP.PianoPlayer, { timeout: 25000 });

  const result = await page.evaluate(() => {
    const app = PPP.app;
    if (app.state.playing) app.togglePlay();

    /* Four-note 32nd-note chords are dense enough to exceed the old 400 ms
       horizon and the 72-voice bookkeeping limit. */
    const measures = [];
    const notes = [];
    for (let m = 1; m <= 3; m++) {
      measures.push({
        number: m, lenQ: 4,
        time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' },
        clefs: { 1: 'treble', 2: 'bass' }
      });
      for (let b = 0; b < 4; b += 0.125) {
        [48, 55, 64, 72].forEach((midi, k) => notes.push({
          m: m, b: b, dur: 0.1, p: null, midi: midi,
          hand: k < 2 ? 'l' : 'r', staff: k < 2 ? 2 : 1,
          voice: 1, type: '32nd', dots: 0, chord: k > 0
        }));
      }
    }
    const score = PPP.Score.finalize({
      id: 'dense-playback-regression', title: 'Dense playback', tempo: 120,
      staves: 2, measures: measures, notes: notes,
      sections: [{ id: 'all', from: 1, to: 3 }]
    });

    const strikes = [];
    const fake = {
      running: () => true,
      wake: () => {},
      now: () => performance.now() / 1000,
      clockOffset: () => 0,
      strike: (midi, when, vel) => {
        const voice = { midi: midi, t: when, end: when + 1, off: Infinity };
        strikes.push({ midi: midi, when: when, vel: vel });
        return voice;
      },
      release: (voice, when) => { if (voice) voice.off = when; },
      click: () => {}, cancelAfter: () => {}, silence: () => {}
    };
    const realPiano = app._piano;
    const realSchedule = app.schedule;
    let synchronousScheduleCalls = 0;
    app._piano = fake;
    app.schedule = function (now) {
      synchronousScheduleCalls++;
      return realSchedule.call(this, now);
    };
    app.state.score = score;
    app.state.tempo = 120;
    app.state.loop = false;
    app.state.loopFrom = 1;
    app.state.loopTo = 3;
    app.state.beat = 0;
    app.state.playing = false;
    app.state.hands = 'both';
    app.state.practiceMode = 'practice';
    app.state.toggles = Object.assign({}, app.state.toggles, {
      notes: true, follow: false, midiOut: false
    });

    app.togglePlay();
    const callsOnReturn = synchronousScheduleCalls;
    const queuedOnReturn = strikes.length;
    const times = [...new Set(strikes.map(x => Math.round(x.when * 1000)))].sort((a, b) => a - b);
    const span = times.length ? times[times.length - 1] - times[0] : 0;
    if (app.state.playing) app.togglePlay();
    app.schedule = realSchedule;
    app._piano = realPiano;

    /* Polyphony is measured at the requested strike time. Twenty future nodes
       must not cause any current voice to be stolen. */
    const player = Object.create(PPP.PianoPlayer.prototype);
    player.voices = [];
    for (let i = 0; i < 71; i++) player.voices.push({ midi: 40 + i % 40, t: 10, end: 30, off: Infinity });
    for (let i = 0; i < 20; i++) player.voices.push({ midi: 60 + i % 20, t: 20 + i / 100, end: 30, off: Infinity });
    const released = [];
    player.release = (voice, when) => {
      released.push({ voice: voice, when: when });
      voice.off = when;
      voice.end = Math.min(voice.end, when + 0.16);
    };
    player.prune(5, 12);

    player.voices.push({ midi: 90, t: 12, end: 20, off: Infinity });
    player.prune(5, 12.1);
    const futureReleased = released.some(x => x.voice.t > x.when);

    return {
      lookahead: PPP.PIANO.lookaheadMs,
      callsOnReturn: callsOnReturn,
      queuedOnReturn: queuedOnReturn,
      queuedSpanMs: span,
      futureReleased: futureReleased,
      releaseCount: released.length
    };
  });

  ok('audio lookahead covers a long UI stall', result.lookahead >= 1500, result.lookahead + ' ms');
  ok('Play queues audio synchronously before rendering', result.callsOnReturn >= 1 && result.queuedOnReturn > 0,
    JSON.stringify({ calls: result.callsOnReturn, notes: result.queuedOnReturn }));
  ok('the first scheduling pass covers more than one second of dense music', result.queuedSpanMs >= 1500,
    result.queuedSpanMs + ' ms');
  ok('future scheduled notes are not stolen as current polyphony', !result.futureReleased,
    'released=' + result.releaseCount);

  await browser.close();
  if (errors.length) {
    console.error('\n' + errors.length + ' playback scheduler problem(s):');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  console.log('\nDense playback scheduling checks out.');
})().catch(e => { console.error(e); process.exit(2); });
