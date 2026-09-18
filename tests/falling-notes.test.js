const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const SAMPLE = path.join(__dirname, '..', 'samples', 'prelude-fragment.musicxml');
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = (name, condition, detail) => {
  console.log((condition ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!condition) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* A minimal stored ZIP is enough for the app's real MXL reader. CRC values are
   not consulted by readMxl; local headers and byte sizes are. */
function storedZip(entries) {
  const chunks = [];
  Object.entries(entries).forEach(([name, body]) => {
    const n = Buffer.from(name, 'utf8');
    const b = Buffer.from(body, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(0, 28);
    chunks.push(h, n, b);
  });
  return Buffer.concat(chunks);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try { localStorage.removeItem('ppp.state.v2'); localStorage.setItem('ppp-guest', '1'); } catch (e) {}
  });
  await preparePage(page);
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && PPP.PianoVisual && PPP.app, { timeout: 25000 });

  console.log('\n── normalized visual timeline ──');
  const model = await page.evaluate(() => {
    const V = PPP.PianoVisual;
    const score = PPP.buildDemoScore();
    const tl = V.scoreToTimeline(score, { tempo: score.tempo });
    const chord = tl.notes.filter(n => Math.abs(n.startTime - tl.notes[0].startTime) < 1e-8);
    const geo = V.buildKeyboardGeometry([60, 72], 700, 120);
    const c = geo.byMidi[60], cs = geo.byMidi[61];
    const rect = V.getNoteRect({ midi: 61, startTime: 4, endTime: 5, duration: 1 }, 0, geo, 500, 480, 4);

    const tieScore = PPP.Score.finalize({
      id: 'tie-test', title: 'Tie', tempo: 60, staves: 1,
      measures: [
        { number: 0, lenQ: 1, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' } },
        { number: 4, lenQ: 3, time: { beats: 3, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' } }
      ],
      notes: [
        { m: 0, b: 0, dur: 1, p: 'C4', midi: 60, hand: 'r', staff: 1, voice: 1, tieStart: true },
        { m: 4, b: 0, dur: 2, p: 'C4', midi: 60, hand: 'r', staff: 1, voice: 1, tieStop: true }
      ]
    });
    const tied = V.scoreToTimeline(tieScore, { tempo: 60 });

    const repeated = PPP.Score.finalize({
      id: 'repeat-test', title: 'Repeat', tempo: 60, staves: 1,
      measures: [
        { number: 10, lenQ: 1, time: { beats: 1, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' }, bar: { repeatStart: true } },
        { number: 20, lenQ: 1, time: { beats: 1, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' }, bar: { repeatEnd: 2 } }
      ],
      notes: [
        { m: 10, b: 0, dur: 1, p: 'C4', midi: 60, hand: 'r', staff: 1, voice: 1 },
        { m: 20, b: 0, dur: 1, p: 'E4', midi: 64, hand: 'r', staff: 1, voice: 1 }
      ]
    });
    const rep = V.scoreToTimeline(repeated, { tempo: 60 });
    const visible = V.getVisibleNotes(tl, tl.notes[20].startTime, 4, 0.34);
    return {
      notes: tl.notes.length,
      hands: [...new Set(tl.notes.map(n => n.hand))].sort(),
      ordered: tl.notes.every((n, i, a) => !i || a[i - 1].startTime <= n.startTime),
      chordCount: chord.length,
      range: tl.range,
      tiedCount: tied.notes.length,
      tiedDuration: tied.notes[0] && tied.notes[0].duration,
      repeatMeasures: rep.measures.map(m => m.number),
      repeatStarts: rep.notes.map(n => n.startTime),
      blackCentered: Math.abs((cs.x + cs.width / 2) - (c.x + c.width)) < 0.001,
      rectCentered: Math.abs((rect.x + rect.width / 2) - (cs.x + cs.width / 2)) < 0.001,
      blackNarrower: cs.width < c.width,
      visible: visible.length,
      defaults: V.defaults
    };
  });
  ok('demo becomes a sorted source-neutral note timeline', model.notes > 500 && model.ordered, model.notes + ' notes');
  ok('both piano hands survive normalization', model.hands.join(',') === 'left,right', model.hands.join(', '));
  ok('simultaneous chord tones keep the same start time', model.chordCount >= 2, model.chordCount + ' tones at the first onset');
  ok('ties become one sustained visual note', model.tiedCount === 1 && Math.abs(model.tiedDuration - 3) < 0.001, JSON.stringify({ count: model.tiedCount, seconds: model.tiedDuration }));
  ok('repeat visits use the audio plan order', JSON.stringify(model.repeatMeasures) === JSON.stringify([10, 20, 10, 20]), model.repeatMeasures.join(' → '));
  ok('repeat note times remain increasing', model.repeatStarts.join(',') === '0,1,2,3', model.repeatStarts.join(', '));
  ok('black keys are narrow and centered on white-key boundaries', model.blackCentered && model.blackNarrower);
  ok('falling note rectangles align to their piano keys', model.rectCentered);
  ok('visible-note lookup culls with a bounded time window', model.visible > 0 && model.visible < model.notes, model.visible + ' / ' + model.notes);
  ok('requested defaults are exposed as settings', model.defaults.lookAheadSeconds === 4 && model.defaults.keyboardRangeMode === 'auto' && model.defaults.showHitEffects);

  console.log('\n── MusicXML and MXL use the same converter ──');
  const xml = fs.readFileSync(SAMPLE, 'utf8');
  const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>';
  const mxl = storedZip({ 'META-INF/container.xml': container, 'score.musicxml': xml });
  const imports = await page.evaluate(async (src, bytes) => {
    const xmlScore = PPP.parseMusicXML(src, 'sample.musicxml');
    const unzipped = await PPP.readMxl(Uint8Array.from(bytes).buffer);
    const mxlScore = PPP.parseMusicXML(unzipped, 'sample.mxl');
    const a = PPP.PianoVisual.scoreToTimeline(xmlScore);
    const b = PPP.PianoVisual.scoreToTimeline(mxlScore);
    return { a: a.notes.length, b: b.notes.length, firstA: a.notes[0].midi, firstB: b.notes[0].midi };
  }, xml, [...mxl]);
  ok('MusicXML produces visual notes', imports.a > 0, String(imports.a));
  ok('MXL reaches the identical normalized path', imports.a === imports.b && imports.firstA === imports.firstB, JSON.stringify(imports));

  console.log('\n── live practice view ──');
  await page.evaluate(() => window.__pppTest.nav('Practice'));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Falling Notes'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Falling Notes').click());
  await page.waitForSelector('[data-piano-visualizer-canvas="true"]');
  await sleep(350);

  const canvas = await page.evaluate(() => {
    const c = document.querySelector('[data-piano-visualizer-canvas="true"]');
    const r = c.getBoundingClientRect();
    const card = c.closest('.ppp-staffcard');
    return {
      mode: card && card.getAttribute('data-visual-mode'),
      cssWidth: r.width, cssHeight: r.height,
      pixelsWidth: c.width, pixelsHeight: c.height,
      dpr: devicePixelRatio,
      visible: +c.dataset.visibleNotes,
      externalKeyboard: !!document.querySelector('.ppp-kbwrap'),
      hands: c.__pppVisualizer && c.__pppVisualizer.props.hands
    };
  });
  ok('Falling Notes switches the real practice card', canvas.mode === 'falling');
  ok('the canvas renders visible score notes', canvas.visible > 0, String(canvas.visible));
  ok('the canvas backing store follows devicePixelRatio', Math.abs(canvas.pixelsWidth - canvas.cssWidth * canvas.dpr) <= 3 && Math.abs(canvas.pixelsHeight - canvas.cssHeight * canvas.dpr) <= 3, JSON.stringify(canvas));
  ok('the canvas keyboard replaces the separate SVG keyboard in this mode', !canvas.externalKeyboard);

  const time0 = await page.$eval('[data-piano-visualizer-canvas="true"]', c => +c.dataset.currentTime);
  await page.click('.ppp-playbtn');
  await sleep(700);
  const running = await page.$eval('[data-piano-visualizer-canvas="true"]', c => ({ time: +c.dataset.currentTime, fps: +c.dataset.fps }));
  const time1 = running.time;
  ok('Play advances the canvas from the transport anchor', time1 > time0 + 0.35, time0.toFixed(3) + ' → ' + time1.toFixed(3));
  ok('the requestAnimationFrame renderer stays near display rate', running.fps >= 45, running.fps + ' FPS');
  await page.click('.ppp-playbtn');
  await sleep(100);
  const pause0 = await page.$eval('[data-piano-visualizer-canvas="true"]', c => +c.dataset.currentTime);
  await sleep(350);
  const pause1 = await page.$eval('[data-piano-visualizer-canvas="true"]', c => +c.dataset.currentTime);
  ok('Pause freezes immediately without canvas drift', Math.abs(pause1 - pause0) < 0.03, pause0.toFixed(3) + ' / ' + pause1.toFixed(3));

  const seek = await page.evaluate(async () => {
    const app = PPP.app, score = app.state.score;
    const target = PPP.Score.startQ(score, app.state.loopFrom) + 2;
    await new Promise(resolve => app.setState({ beat: target }, resolve));
    await new Promise(resolve => setTimeout(resolve, 100));
    const c = document.querySelector('[data-piano-visualizer-canvas="true"]');
    return { time: +c.dataset.currentTime, beat: app.state.beat, target: target };
  });
  ok('seeking repositions the visualization immediately', Math.abs(seek.beat - seek.target) < 1e-6 && seek.time > pause1 + 0.5, JSON.stringify(seek));

  const tempo = await page.evaluate(async () => {
    const c = document.querySelector('[data-piano-visualizer-canvas="true"]');
    const before = c.__pppVisualizer.props.timeline.duration;
    const next = Math.max(30, Math.round(PPP.app.state.score.tempo / 2));
    await new Promise(resolve => PPP.app.setState({ tempo: next }, resolve));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before: before, after: c.__pppVisualizer.props.timeline.duration, tempo: next };
  });
  ok('tempo changes rebuild the visual time mapping', tempo.after > tempo.before * 1.8, JSON.stringify(tempo));

  const hand = await page.evaluate(async () => {
    await new Promise(resolve => PPP.app.setState({ hands: 'left' }, resolve));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const c = document.querySelector('[data-piano-visualizer-canvas="true"]');
    return c.__pppVisualizer && c.__pppVisualizer.props.hands;
  });
  ok('left/right/both practice state reaches the renderer as a view filter', hand === 'left', String(hand));

  const split = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Split');
    if (b) b.click();
    await new Promise(resolve => setTimeout(resolve, 250));
    return {
      clicked: !!b,
      mode: document.querySelector('.ppp-staffcard') && document.querySelector('.ppp-staffcard').getAttribute('data-visual-mode'),
      sheet: !!document.querySelector('.ppp-staffwrap'),
      falling: !!document.querySelector('[data-piano-visualizer-canvas="true"]')
    };
  });
  ok('Split reuses the same sheet and falling-note views', split.clicked && split.mode === 'split' && split.sheet && split.falling, JSON.stringify(split));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Falling Notes').click());
  await sleep(150);

  const looped = await page.evaluate(async () => {
    const app = PPP.app, score = app.state.score, m = app.state.loopFrom;
    if (app.state.playing) app.togglePlay();
    await new Promise(resolve => app.setState({ loop: true, loopFrom: m, loopTo: m, tempo: 200, beat: PPP.Score.startQ(score, m), hands: 'both' }, resolve));
    app.togglePlay();
    const values = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const c = document.querySelector('[data-piano-visualizer-canvas="true"]');
      values.push(+c.dataset.currentTime);
    }
    if (app.state.playing) app.togglePlay();
    let backwards = false;
    for (let i = 1; i < values.length; i++) if (values[i] + 0.2 < values[i - 1]) backwards = true;
    return { backwards: backwards, min: Math.min(...values), max: Math.max(...values) };
  });
  ok('measure looping resets the canvas from the transport loop', looped.backwards && looped.max > 0.8, JSON.stringify(looped));

  await page.setViewport({ width: 820, height: 1080, deviceScaleFactor: 1.5 });
  await sleep(300);
  const resized = await page.$eval('[data-piano-visualizer-canvas="true"]', c => {
    const r = c.getBoundingClientRect();
    return { css: [r.width, r.height], pixels: [c.width, c.height], dpr: devicePixelRatio };
  });
  ok('resize keeps CSS and backing-store geometry aligned', Math.abs(resized.pixels[0] - resized.css[0] * resized.dpr) <= 3 && Math.abs(resized.pixels[1] - resized.css[1] * resized.dpr) <= 3, JSON.stringify(resized));
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');

  await browser.close();
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  • ' + e));
    process.exit(1);
  }
  console.log('Falling Notes stays aligned to PPP’s score and transport.');
})().catch(error => { console.error(error); process.exit(1); });
