const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const path = require('path');
const fs = require('fs');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const SAMPLE = 'D:/PPP/samples/prelude-fragment.musicxml';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

(async () => {
  fs.mkdirSync(path.join(__dirname, '.shots'), { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });

  /* ---------- parse the sample in-page and assert against the file ---------- */
  const xml = fs.readFileSync(SAMPLE, 'utf8');
  const r = await page.evaluate(src => {
    const s = PPP.parseMusicXML(src, 'prelude-fragment.musicxml');
    const sounding = s.notes.filter(n => !n.rest);
    const m2 = s.notes.filter(n => n.m === 2 && n.staff === 2);
    const tied = s.notes.filter(n => n.tieStop);
    const acc = s.notes.filter(n => n.acc);
    return {
      title: s.title, composer: s.composer, tempo: s.tempo, staves: s.staves,
      measures: s.measures.length,
      firstNumber: s.measures[0].number, lastNumber: s.measures[s.measures.length - 1].number,
      time: s.measures[0].time, key: s.measures[0].key,
      clefs: s.measures[0].clefs,
      lenQ: s.measures[0].lenQ, totalQ: s.lengthQ,
      startQ3: s.measures[2].startQ,
      notes: sounding.length, rests: s.notes.length - sounding.length,
      right: sounding.filter(n => n.hand === 'r').length,
      left: sounding.filter(n => n.hand === 'l').length,
      /* measure 2 left hand is a dotted-half D3+A3 chord */
      m2chord: m2.map(n => n.p + '/' + n.dur + '/' + (n.chord ? 'c' : '-')),
      /* the printed accidental in measure 5 */
      accCount: acc.length, accNote: acc.length ? acc[0].p + ':' + acc[0].acc : null,
      tieCount: tied.length,
      /* dotted quarter at the top of measure 2 */
      m2first: (() => { const n = s.notes.filter(x => x.m === 2 && x.staff === 1)[0]; return n.p + '/' + n.dur + '/dots' + n.dots; })(),
      /* eighth run in measure 3 */
      m3eighths: s.notes.filter(n => n.m === 3 && n.staff === 1).map(n => n.p).join(' '),
      midiOfFs5: s.notes.filter(n => n.p === 'F#5')[0].midi,
      sections: s.sections.map(x => x.id + ':' + x.from + '-' + x.to + (x.hard ? '*' : '')),
      keyName: PPP.keyName(s.measures[0].key.fifths, s.measures[0].key.mode),
      kbRange: PPP.Score.keyRange(s)
    };
  }, xml);

  console.log('\n── MusicXML parse ──');
  ok('title', r.title === 'Prelude Fragment', r.title);
  ok('composer', /Bach/.test(r.composer), r.composer);
  ok('tempo from metronome mark', r.tempo === 72, r.tempo + ' BPM');
  ok('two staves', r.staves === 2, String(r.staves));
  ok('measure count', r.measures === 8, String(r.measures));
  ok('measure numbering', r.firstNumber === 1 && r.lastNumber === 8, r.firstNumber + '..' + r.lastNumber);
  ok('time signature', r.time.beats === 3 && r.time.beatType === 4, r.time.beats + '/' + r.time.beatType);
  ok('key signature', r.key.fifths === 1 && r.key.mode === 'major', r.keyName);
  ok('clefs', r.clefs['1'] === 'treble' && r.clefs['2'] === 'bass', JSON.stringify(r.clefs));
  ok('3/4 measure is 3 quarters', Math.abs(r.lenQ - 3) < 1e-6, String(r.lenQ));
  ok('measure 3 starts at quarter 6', Math.abs(r.startQ3 - 6) < 1e-6, String(r.startQ3));
  ok('total length 24 quarters', Math.abs(r.totalQ - 24) < 1e-6, String(r.totalQ));
  ok('rests parsed', r.rests === 4, r.rests + ' rests');
  ok('hands split by staff', r.right > 0 && r.left > 0, r.right + ' right / ' + r.left + ' left');
  ok('chord on one onset', r.m2chord.length === 2 && /c$/.test(r.m2chord[1]), r.m2chord.join(', '));
  ok('dotted half = 3 quarters', /\/3\//.test(r.m2chord[0]), r.m2chord[0]);
  ok('dotted quarter = 1.5 quarters', r.m2first === 'F#5/1.5/dots1', r.m2first);
  ok('eighth run pitches', r.m3eighths === 'C5 D5 E5 F#5 G5 A5', r.m3eighths);
  ok('alter → pitch → midi', r.midiOfFs5 === 78, 'F#5 = ' + r.midiOfFs5);
  ok('printed accidental kept', r.accCount === 1 && r.accNote === 'G#5:sharp', r.accNote);
  ok('tie stop marked', r.tieCount === 1, r.tieCount + ' tied');
  ok('sections derived', r.sections.length >= 1, r.sections.join(' '));
  ok('keyboard range fits the piece', r.kbRange[0] <= 38 && r.kbRange[1] >= 81, r.kbRange.join('..'));

  /* ---------- import through the real UI ---------- */
  console.log('\n── import through the UI ──');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside button')].find(x => /^Upload$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(250);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Show drop zone/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(250);
  const input = await page.$('input[type=file]');
  ok('file input present', !!input);
  if (input) {
    await input.uploadFile(SAMPLE);
    await sleep(400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Run analysis/.test(x.innerText || ''));
      if (b) b.click();
    });
    await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 20000 })
      .catch(() => errors.push('import never completed'));
    await sleep(400);
    const summary = await page.evaluate(() => document.body.innerText);
    ok('import summary reports the parse', /Parsed 8 measures in 3\/4/.test(summary) && /G major/.test(summary),
      (summary.match(/Parsed [^\n]+/) || ['?'])[0]);
  }

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /See analysis/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  const facts = await page.evaluate(() => document.body.innerText);
  ok('analysis facts come from the file', /3\/4/.test(facts) && /72 BPM/.test(facts) && /G major/.test(facts));

  /* ---------- the practice system now runs on parsed measures ---------- */
  console.log('\n── practice system on parsed data ──');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside button')].find(x => /Measure Loop/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  const cells = await page.evaluate(() => document.querySelectorAll('button[title^="Measure "]').length);
  ok('measure strip uses parsed measures', cells === 8, cells + ' cells');

  const beatLabel = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
    return el ? el.textContent.trim() : null;
  });
  /* the beat read-out lives on the practice player, not the loop screen */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Play$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(2600);
  const bl = await beatLabel();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Pause$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  ok('playhead advances in 3/4', !!bl && /beat [123]$/.test(bl), bl);
  ok('no beat 4 in 3/4 time', !/beat 4/.test(bl || ''), bl);

  const engraved = await page.evaluate(() => ({
    svgs: document.querySelectorAll('.ppp-score svg').length,
    notes: document.querySelectorAll('.ppp-note').length
  }));
  ok('VexFlow engraved the score', engraved.svgs > 0 && engraved.notes > 0,
    engraved.svgs + ' svg, ' + engraved.notes + ' note groups');

  /* hand filtering must follow the parsed staff */
  const hidden = async hand => page.evaluate(h => {
    const b = [...document.querySelectorAll('main button')].find(x => (x.innerText || '').trim() === h);
    if (b) b.click();
    return new Promise(r => setTimeout(() => r(document.querySelectorAll('.ppp-note.ppp-off').length), 250));
  }, hand);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  const both = await hidden('Both Hands');
  const right = await hidden('Right');
  const left = await hidden('Left');
  ok('hand filter uses real staff data', both === 0 && right > 0 && left > 0,
    'both=' + both + ' hidden, right=' + right + ', left=' + left);

  await page.screenshot({ path: path.join(__dirname, '.shots', 'parsed-player.png') });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside button')].find(x => /Measure Loop/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(500);
  await page.screenshot({ path: path.join(__dirname, '.shots', 'parsed-loop.png') });

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('MusicXML parsing, engraving and the practice system all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
