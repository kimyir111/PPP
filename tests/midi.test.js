const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const path = require('path');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* A fake Web MIDI implementation, installed before the app boots so the
   support check sees it. Tests push raw bytes through window.__fake.send(). */
function installFakeMidi() {
  const mkPort = (id, name) => ({
    id, name, manufacturer: 'PPP Test', state: 'connected', type: 'input',
    onmidimessage: null, open() { return Promise.resolve(this); }, close() { return Promise.resolve(this); }
  });
  const p1 = mkPort('fake-1', 'Fake Piano');
  const p2 = mkPort('fake-2', 'Second Keyboard');
  const inputs = new Map([['fake-1', p1], ['fake-2', p2]]);
  const access = { inputs, outputs: new Map(), onstatechange: null, addEventListener() {}, removeEventListener() {} };
  navigator.requestMIDIAccess = () => Promise.resolve(access);
  window.__fake = {
    access, p1, p2,
    send(bytes, t, which) {
      const p = which === 2 ? p2 : p1;
      if (p.onmidimessage) p.onmidimessage({ data: new Uint8Array(bytes), timeStamp: t == null ? performance.now() : t });
    }
  };
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  await page.evaluateOnNewDocument(installFakeMidi);
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(600);

  /* ================= 1. MIDI event normalization ================= */
  console.log('\n── MIDI event normalization ──');
  const norm = await page.evaluate(async () => {
    const seen = [];
    const input = new PPP.MidiInput({ onEvent: e => seen.push(e), request: () => Promise.resolve(window.__fake.access) });
    const supported = input.supported();
    await input.start();
    const devices = input.devices().map(d => d.name);
    const selected = input.deviceId;
    window.__fake.send([0x90, 60, 100], 1000);      /* note on, ch 1 */
    window.__fake.send([0x94, 62, 64], 1100);       /* note on, ch 5 */
    window.__fake.send([0x90, 60, 0], 1200);        /* note on vel 0 == note off */
    window.__fake.send([0x80, 62, 64], 1300);       /* note off */
    window.__fake.send([0xB0, 7, 127], 1400);       /* control change — ignored */
    window.__fake.send([0xE0, 0, 64], 1500);        /* pitch bend — ignored */
    window.__fake.send([0xF8], 1600);               /* clock — ignored */
    return { supported, devices, selected, seen, snapshot: input.snapshot() };
  });
  ok('Web MIDI detected', norm.supported === true);
  ok('devices enumerated', norm.devices.length === 2 && norm.devices[0] === 'Fake Piano', norm.devices.join(', '));
  ok('first device auto-selected', norm.selected === 'fake-1', String(norm.selected));
  ok('only note messages emitted', norm.seen.length === 4, norm.seen.length + ' events from 7 messages');
  const e0 = norm.seen[0] || {};
  ok('note-on normalized', e0.type === 'on' && e0.midi === 60 && e0.velocity === 100 && e0.channel === 1,
    JSON.stringify({ type: e0.type, midi: e0.midi, velocity: e0.velocity, channel: e0.channel }));
  ok('timestamp preserved', e0.t === 1000, String(e0.t));
  ok('device identified', e0.device === 'fake-1' && e0.deviceName === 'Fake Piano', e0.device + ' / ' + e0.deviceName);
  ok('channel decoded from status byte', (norm.seen[1] || {}).channel === 5, String((norm.seen[1] || {}).channel));
  ok('note-on velocity 0 treated as note-off', (norm.seen[2] || {}).type === 'off', (norm.seen[2] || {}).type);
  ok('note-off normalized', (norm.seen[3] || {}).type === 'off' && (norm.seen[3] || {}).midi === 62);

  /* ================= 2. matching, timing, chords, hands ================= */
  console.log('\n── performance engine ──');
  const eng = await page.evaluate(() => {
    const S = PPP.Score;
    /* tempo 60 → one quarter note is exactly 1000 ms, so timings read directly */
    const mkScore = (notes, bars, beats, beatType) => S.finalize({
      id: 'test:' + Math.random(), title: 'test', composer: '-', tempo: 60, staves: 2,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1, time: { beats: beats || 4, beatType: beatType || 4 },
        key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' }
      })),
      notes, sections: [{ id: 's1', from: 1, to: bars }]
    });
    const N = (m, b, p, hand, dur) => ({
      m, b, dur: dur == null ? 1 : dur, p, midi: PPP.pitchToMidi(p),
      hand: hand || 'r', staff: hand === 'l' ? 2 : 1, voice: 1, type: 'quarter', dots: 0
    });
    const out = {};

    /* --- scale: one note per beat --- */
    const scale = mkScore([N(1, 0, 'C4'), N(1, 1, 'D4'), N(1, 2, 'E4'), N(1, 3, 'F4')], 1);
    const run = { from: 1, to: 1, hands: 'both', tempo: 60, startedAt: 0 };
    let e = new PPP.PerformanceEngine(scale).begin(run);
    out.expectedTimes = e.expected.map(x => x.tMs);
    out.onTime = e.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on', velocity: 80 }).verdict;
    out.slightlyOff = e.noteOn({ t: 1040, midi: PPP.pitchToMidi('D4'), type: 'on' }).verdict;
    out.early = e.noteOn({ t: 1850, midi: PPP.pitchToMidi('E4'), type: 'on' }).verdict;
    out.late = e.noteOn({ t: 3200, midi: PPP.pitchToMidi('F4'), type: 'on' }).verdict;
    out.perfectRun = e.result();

    /* --- wrong pitch at the right moment vs a note from nowhere --- */
    e = new PPP.PerformanceEngine(scale).begin(run);
    out.wrongPitch = e.noteOn({ t: 10, midi: PPP.pitchToMidi('C#4'), type: 'on' }).verdict;
    out.extraNote = e.noteOn({ t: 9000, midi: PPP.pitchToMidi('C4'), type: 'on' }).verdict;
    /* the expected note stays open, so correcting yourself still scores */
    out.recovered = e.noteOn({ t: 40, midi: PPP.pitchToMidi('C4'), type: 'on' }).verdict;
    out.afterWrong = e.result().counts;

    /* --- beyond the window is not a match at all --- */
    e = new PPP.PerformanceEngine(scale).begin(run);
    out.tooLate = e.noteOn({ t: 400, midi: PPP.pitchToMidi('C4'), type: 'on' }).verdict;

    /* --- missed notes: nothing arrives before the window shuts --- */
    e = new PPP.PerformanceEngine(scale).begin(run);
    e.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on' });
    e.advanceTo(5000);
    out.missed = e.result().counts;

    /* --- configurable window --- */
    e = new PPP.PerformanceEngine(scale, { timing: { perfect: 10, good: 20, window: 30 } }).begin(run);
    out.tightWindow = e.noteOn({ t: 100, midi: PPP.pitchToMidi('C4'), type: 'on' }).verdict;
    out.tightWindowOk = new PPP.PerformanceEngine(scale, { timing: { perfect: 10, good: 20, window: 30 } })
      .begin(run).noteOn({ t: 5, midi: PPP.pitchToMidi('C4'), type: 'on' }).verdict;

    /* --- chord: three notes on one onset, rolled slightly --- */
    const chord = mkScore([N(1, 0, 'C4', 'r', 4), N(1, 0, 'E4', 'r', 4), N(1, 0, 'G4', 'r', 4)], 1);
    e = new PPP.PerformanceEngine(chord).begin(run);
    e.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on' });
    e.noteOn({ t: 30, midi: PPP.pitchToMidi('E4'), type: 'on' });
    e.noteOn({ t: 60, midi: PPP.pitchToMidi('G4'), type: 'on' });
    out.chord = e.result().counts;

    /* the same three keys against three *sequential* expected notes must NOT
       all match — that is the melodic case the chord case must not resemble */
    e = new PPP.PerformanceEngine(scale).begin(run);
    e.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on' });
    e.noteOn({ t: 30, midi: PPP.pitchToMidi('D4'), type: 'on' });
    e.noteOn({ t: 60, midi: PPP.pitchToMidi('E4'), type: 'on' });
    out.melodic = e.result().counts;

    /* --- hand filtering --- */
    const hands = mkScore([N(1, 0, 'C5', 'r'), N(1, 0, 'C3', 'l'), N(1, 1, 'D5', 'r'), N(1, 1, 'D3', 'l')], 1);
    const rh = new PPP.PerformanceEngine(hands).begin({ from: 1, to: 1, hands: 'right', tempo: 60, startedAt: 0 });
    const lh = new PPP.PerformanceEngine(hands).begin({ from: 1, to: 1, hands: 'left', tempo: 60, startedAt: 0 });
    const both = new PPP.PerformanceEngine(hands).begin({ from: 1, to: 1, hands: 'both', tempo: 60, startedAt: 0 });
    out.handCounts = { right: rh.expected.length, left: lh.expected.length, both: both.expected.length };
    out.rightHands = [...new Set(rh.expected.map(x => x.hand))];
    out.leftHands = [...new Set(lh.expected.map(x => x.hand))];
    /* per-hand accuracy */
    both.noteOn({ t: 0, midi: PPP.pitchToMidi('C5'), type: 'on' });
    both.noteOn({ t: 1000, midi: PPP.pitchToMidi('D5'), type: 'on' });
    both.advanceTo(5000);
    const bh = both.result();
    out.byHand = { r: bh.byHand.r.accuracy, l: bh.byHand.l.accuracy };

    /* --- measure transitions, 4/4 and 3/4 --- */
    const two44 = mkScore([N(1, 0, 'C4'), N(2, 0, 'D4')], 2, 4, 4);
    const two34 = mkScore([N(1, 0, 'C4'), N(2, 0, 'D4')], 2, 3, 4);
    const e44 = new PPP.PerformanceEngine(two44).begin({ from: 1, to: 2, hands: 'both', tempo: 60, startedAt: 0 });
    const e34 = new PPP.PerformanceEngine(two34).begin({ from: 1, to: 2, hands: 'both', tempo: 60, startedAt: 0 });
    out.bar2_44 = e44.expected[1].tMs;
    out.bar2_34 = e34.expected[1].tMs;
    out.measureNumbers = e44.expected.map(x => x.m);
    e44.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on' });
    e44.advanceTo(99999);
    out.byMeasure = e44.result().byMeasure;

    /* --- a range that starts mid-score keeps real measure numbers --- */
    const four = mkScore([N(1, 0, 'C4'), N(2, 0, 'D4'), N(3, 0, 'E4'), N(4, 0, 'F4')], 4);
    const mid = new PPP.PerformanceEngine(four).begin({ from: 3, to: 4, hands: 'both', tempo: 60, startedAt: 0 });
    out.midRange = { count: mid.expected.length, measures: mid.expected.map(x => x.m), firstT: mid.expected[0].tMs };

    /* --- run completion --- */
    e = new PPP.PerformanceEngine(scale).begin(run);
    [['C4', 0], ['D4', 1000], ['E4', 2000], ['F4', 3000]].forEach(([p, t]) =>
      e.noteOn({ t, midi: PPP.pitchToMidi(p), type: 'on' }));
    e.advanceTo(99999);
    out.clean = e.result();
    e = new PPP.PerformanceEngine(scale).begin(run);
    e.noteOn({ t: 0, midi: PPP.pitchToMidi('C4'), type: 'on' });
    e.noteOn({ t: 1000, midi: PPP.pitchToMidi('D4'), type: 'on' });
    e.advanceTo(99999);
    out.half = e.result();

    /* --- held notes track note-on/off --- */
    e = new PPP.PerformanceEngine(scale).begin(run);
    e.noteOn({ t: 0, midi: 60, type: 'on' });
    e.noteOn({ t: 5, midi: 64, type: 'on' });
    out.heldBoth = e.heldNotes().slice().sort((a, b) => a - b);
    e.noteOff({ t: 10, midi: 60, type: 'off' });
    out.heldAfterOff = e.heldNotes();
    return out;
  });

  ok('expected notes placed on the clock', JSON.stringify(eng.expectedTimes) === JSON.stringify([0, 1000, 2000, 3000]),
    JSON.stringify(eng.expectedTimes));
  ok('exact hit is on time', eng.onTime === 'on', eng.onTime);
  ok('40ms off is still on time', eng.slightlyOff === 'on', eng.slightlyOff);
  ok('150ms ahead is early, not wrong', eng.early === 'early', eng.early);
  ok('200ms behind is late, not wrong', eng.late === 'late', eng.late);
  ok('clean run scores 100% notes', eng.perfectRun.noteAccuracy === 1, (eng.perfectRun.noteAccuracy * 100) + '%');
  ok('wrong pitch in the window is a wrong note', eng.wrongPitch === 'wrong', eng.wrongPitch);
  ok('note far from any onset is an extra note', eng.extraNote === 'extra', eng.extraNote);
  ok('correcting yourself still scores the note', eng.recovered === 'on', eng.recovered);
  ok('wrong + recovery counted separately', eng.afterWrong.matched === 1 && eng.afterWrong.wrong === 1 && eng.afterWrong.extra === 1,
    JSON.stringify(eng.afterWrong));
  ok('beyond the window is not a match', eng.tooLate === 'extra' || eng.tooLate === 'wrong', eng.tooLate);
  ok('missed note detected when nothing arrives', eng.missed.missed === 3 && eng.missed.matched === 1,
    JSON.stringify(eng.missed));
  ok('timing window is configurable (reject)', eng.tightWindow !== 'on', eng.tightWindow);
  ok('timing window is configurable (accept)', eng.tightWindowOk === 'on', eng.tightWindowOk);
  ok('rolled chord matches all three notes', eng.chord.matched === 3 && eng.chord.extra === 0 && eng.chord.wrong === 0,
    JSON.stringify(eng.chord));
  ok('same keys against sequential notes do NOT all match', eng.melodic.matched === 1 && eng.melodic.extra === 2,
    JSON.stringify(eng.melodic));
  ok('hand filter narrows the expected set', eng.handCounts.right === 2 && eng.handCounts.left === 2 && eng.handCounts.both === 4,
    JSON.stringify(eng.handCounts));
  ok('right-hand run expects only right-hand notes', eng.rightHands.length === 1 && eng.rightHands[0] === 'r', eng.rightHands.join(''));
  ok('left-hand run expects only left-hand notes', eng.leftHands.length === 1 && eng.leftHands[0] === 'l', eng.leftHands.join(''));
  ok('per-hand accuracy computed', eng.byHand.r === 1 && eng.byHand.l === 0, JSON.stringify(eng.byHand));
  ok('measure 2 of 4/4 starts at 4 quarters', eng.bar2_44 === 4000, eng.bar2_44 + ' ms');
  ok('measure 2 of 3/4 starts at 3 quarters', eng.bar2_34 === 3000, eng.bar2_34 + ' ms');
  ok('notes carry their real measure number', JSON.stringify(eng.measureNumbers) === '[1,2]', JSON.stringify(eng.measureNumbers));
  ok('per-measure accuracy computed', eng.byMeasure['1'].accuracy === 1 && eng.byMeasure['2'].accuracy === 0,
    JSON.stringify(eng.byMeasure));
  ok('mid-score range keeps real measure numbers', eng.midRange.count === 2 && JSON.stringify(eng.midRange.measures) === '[3,4]' && eng.midRange.firstT === 0,
    JSON.stringify(eng.midRange));
  ok('run completion: clean run', eng.clean.accuracy === 1 && eng.clean.counts.missed === 0, (eng.clean.accuracy * 100).toFixed(0) + '%');
  ok('run completion: half the notes', eng.half.noteAccuracy === 0.5 && eng.half.counts.missed === 2,
    (eng.half.noteAccuracy * 100) + '%, ' + eng.half.counts.missed + ' missed');
  ok('run completion reports the range', eng.clean.run.from === 1 && eng.clean.run.to === 1 && eng.clean.run.hands === 'both',
    JSON.stringify(eng.clean.run));
  ok('held notes tracked', JSON.stringify(eng.heldBoth) === '[60,64]' && JSON.stringify(eng.heldAfterOff) === '[64]',
    JSON.stringify(eng.heldBoth) + ' → ' + JSON.stringify(eng.heldAfterOff));

  /* ================= 3. end to end through the UI ================= */
  console.log('\n── UI integration ──');
  const badge = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('main button, main span')]
      .find(x => /MIDI Connected|Demo Input/.test((x.textContent || '').trim()));
    return b ? b.textContent.trim() : null;
  });

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  ok('starts on Demo Input, not a fake connection', /Demo Input/.test(await badge()), await badge());

  /* connect from the player badge */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /Demo Input/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(700);
  ok('badge reports a real connection after connecting', /MIDI Connected/.test(await badge()), await badge());

  const devices = await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Settings/.test(x.innerText || ''));
    if (b) b.click();
    return new Promise(r => setTimeout(() => {
      r([...document.querySelectorAll('main button')].map(x => (x.innerText || '').trim())
        .filter(t => /Fake Piano|Second Keyboard/.test(t)));
    }, 500));
  });
  ok('device picker lists both inputs', devices.length === 2, devices.join(', '));

  const switched = await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /Second Keyboard/.test(x.innerText || ''));
    if (b) b.click();
    return new Promise(r => setTimeout(() => r(document.body.innerText), 500));
  });
  ok('selecting another device takes effect', /Second Keyboard · connected/.test(switched),
    (switched.match(/MIDI keyboard\s*\n?\s*([^\n]+)/) || [])[1]);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /Fake Piano/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);

  /* held keys light up from real input */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(500);
  const held = await page.evaluate(async () => {
    /* This is about the timed transport's held-key display. Follow mode is on
       by default once a keyboard is connected, and there an unexpected key is
       correctly shown as wrong rather than merely held — so switch it off and
       test the thing this case is actually about. */
    const f = [...document.querySelectorAll('main button')].find(x => /Follow on/.test(x.innerText || ''));
    if (f) f.click();
    await new Promise(r => setTimeout(r, 400));
    const before = document.querySelectorAll('svg rect[fill="var(--accent)"]').length;
    window.__fake.send([0x90, 60, 100]);
    window.__fake.send([0x90, 64, 100]);
    await new Promise(r => setTimeout(r, 350));
    const during = document.querySelectorAll('svg rect[fill="var(--accent)"]').length;
    window.__fake.send([0x80, 60, 0]);
    window.__fake.send([0x80, 64, 0]);
    await new Promise(r => setTimeout(r, 350));
    const after = document.querySelectorAll('svg rect[fill="var(--accent)"]').length;
    return { before, during, after };
  });
  ok('two held keys light two keys', held.during - held.before === 2 && held.after === held.before,
    held.before + ' → ' + held.during + ' → ' + held.after);

  /* a real run updates the live accuracy read-out */
  const live = await page.evaluate(async () => {
    /* one-measure loop at a brisk tempo so a lap completes quickly */
    const click = re => { const b = [...document.querySelectorAll('main button, aside button')].find(x => re.test((x.innerText || '').trim())); if (b) b.click(); };
    click(/^Measure Loop$/);
    await new Promise(r => setTimeout(r, 400));
    const cells = document.querySelectorAll('button[title^="Measure "]');
    cells[20].click(); cells[20].click();
    await new Promise(r => setTimeout(r, 300));
    click(/^Play$/);
    /* play a spray of the notes this measure actually contains */
    const before = document.body.innerText;
    for (let i = 0; i < 12; i++) {
      window.__fake.send([0x90, 60 + (i % 5), 90]);
      await new Promise(r => setTimeout(r, 120));
      window.__fake.send([0x80, 60 + (i % 5), 0]);
    }
    await new Promise(r => setTimeout(r, 1200));
    click(/^Pause$/);
    return { before: before.slice(0, 0), after: document.body.innerText };
  });
  ok('a live run produces a real accuracy figure', /\d+%/.test(live.after));

  /* disconnect returns to demo input */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /MIDI Connected/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(500);
  ok('disconnecting falls back to Demo Input', /Demo Input/.test(await badge()), await badge());

  /* ================= 4. no Web MIDI at all ================= */
  console.log('\n── unsupported browser ──');
  const page2 = await browser.newPage();
  await page2.evaluateOnNewDocument(() => { try { delete navigator.requestMIDIAccess; } catch (e) {} navigator.requestMIDIAccess = undefined; });
  page2.on('pageerror', e => errors.push('[pageerror:noMidi] ' + e.message));
  await page2.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page2.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(500);
  await page2.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  const noMidi = await page2.evaluate(() => document.body.innerText);
  ok('labels itself Demo Input without Web MIDI', /Demo Input/.test(noMidi));
  ok('never claims a connection it does not have', !/MIDI Connected/.test(noMidi));

  const stillWorks = await page2.evaluate(async () => {
    const b = [...document.querySelectorAll('main button')].find(x => /^Play$/.test((x.innerText || '').trim()));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 1200));
    const el = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
    return el ? el.textContent.trim() : null;
  });
  ok('demo playback still runs without MIDI', !!stillWorks, stillWorks);
  await page2.close();

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('MIDI input, matching and the performance engine all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
