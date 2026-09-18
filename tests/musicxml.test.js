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

  console.log('\n── vocal line over a piano ──');
  const vocal = await page.evaluate(() => {
    const n = (step, oct, staff) => '<note><pitch><step>' + step + '</step><octave>' + oct +
      '</octave></pitch><duration>4</duration><voice>' + staff + '</voice><type>whole</type><staff>' + staff + '</staff></note>';
    const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><staves>3</staves>' +
      '<clef number="1"><sign>G</sign><line>2</line></clef>' +
      '<clef number="2"><sign>G</sign><line>2</line></clef>' +
      '<clef number="3"><sign>F</sign><line>4</line></clef></attributes>' +
      n('G', 4, 1) + '<backup><duration>4</duration></backup>' +
      n('B', 4, 2) + '<backup><duration>4</duration></backup>' +
      n('G', 3, 3) + '</measure></part></score-partwise>';
    const s = PPP.parseMusicXML(xml, 'vocal-piano.musicxml');
    const byStaff = {};
    s.notes.filter(x => !x.rest).forEach(x => { byStaff[x.staff] = x.hand + ':' + x.p; });
    return { staves: s.staves, hands: byStaff };
  });
  ok('a melody staff above the grand staff is three staves', vocal.staves === 3, String(vocal.staves));
  ok('the melody is shown, not played; the piano is the last two staves',
    vocal.hands[1] === 'x:G4' && vocal.hands[2] === 'r:B4' && vocal.hands[3] === 'l:G3',
    JSON.stringify(vocal.hands));

  /* ---------- dynamics, form, tempo map, pedals (inline scores) ---------- */
  console.log('\n── sounding plan from MusicXML ──');
  const mx = body => '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' + body + '</part></score-partwise>';
  const sounding = await page.evaluate(src => {
    const S = PPP.Score, P = PPP.PianoScore;
    const dynXml = src.dyn;
    const d = PPP.parseMusicXML(dynXml, 'dyn.musicxml');
    const dPlan = P.of(d);
    const vels = dPlan.strikes.map(s => ({ p: s.note.p, vel: s.vel, m: s.m, accent: !!s.note.accent }));
    const pNotes = vels.filter(x => x.m === 1 && !x.accent);
    const accNotes = vels.filter(x => x.m === 1 && x.accent);
    const fNotes = vels.filter(x => x.m === 2);
    const hair = PPP.parseMusicXML(src.hair, 'hair.musicxml');
    const hPlan = P.of(hair);
    const hVel = hPlan.strikes.map(s => s.vel);
    const rep = PPP.parseMusicXML(src.rep, 'rep.musicxml');
    const rPlan = P.of(rep);
    const tempo = PPP.parseMusicXML(src.tempo, 'tempo.musicxml');
    const tPlan = P.of(tempo);
    const before = P.msAt(tPlan, 4, 1) - P.msAt(tPlan, 0, 1);
    const after = P.msAt(tPlan, 8, 1) - P.msAt(tPlan, 4, 1);
    const ped = PPP.parseMusicXML(src.ped, 'ped.musicxml');
    const kinds = (P.of(ped).ccsWritten || []).map(e => e.kind + ':' + e.type + ':' + e.value);
    const distinct = [...new Set((P.of(ped).ccsWritten || []).map(e => e.kind))];
    return {
      pVel: pNotes.map(x => x.vel),
      accVel: accNotes.map(x => x.vel),
      fVel: fNotes.map(x => x.vel),
      hairVel: hVel,
      visits: rPlan.visits.map(v => v.number),
      strikeMs: rPlan.strikes.map(s => s.q),
      before, after,
      tempoMap: tPlan.tempoMap.map(t => t.bpm),
      pedKinds: distinct.sort(),
      pedEvents: kinds
    };
  }, {
    dyn: mx(
      '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><articulations><accent/></articulations></notations></note>' +
      '<note><rest/><duration>1</duration><type>quarter</type></note></measure>' +
      '<measure number="2"><direction><direction-type><dynamics><f/></dynamics></direction-type></direction>' +
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><rest/><duration>2</duration><type>half</type></note></measure>'
    ),
    hair: mx(
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>' +
      '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<direction><direction-type><wedge type="stop"/></direction-type></direction>' +
      '<direction><direction-type><dynamics><f/></dynamics></direction-type></direction>' +
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure>'
    ),
    rep: mx(
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>' +
      '<measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>' +
      '<barline location="right"><repeat direction="backward"/></barline></measure>'
    ),
    tempo: mx(
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>' +
      '<measure number="2"><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>'
    ),
    ped: mx(
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<direction><direction-type><pedal type="start"/></direction-type><sound damper-pedal="yes"/></direction>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<direction><direction-type><words>una corda</words></direction-type><sound soft-pedal="yes"/></direction>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<direction><sound sostenuto-pedal="yes"/></direction>' +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<direction><direction-type><pedal type="change"/></direction-type><sound damper-pedal="0.5"/></direction>' +
      '<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure>'
    )
  });

  ok('piano passage is quieter than forte',
    sounding.pVel.length && sounding.fVel.length && Math.max.apply(null, sounding.pVel) < Math.min.apply(null, sounding.fVel),
    'p=' + sounding.pVel.join(',') + ' f=' + sounding.fVel.join(','));
  ok('accent is louder than unmarked at the same dynamic',
    sounding.accVel.length && sounding.pVel.length && Math.min.apply(null, sounding.accVel) > Math.max.apply(null, sounding.pVel),
    'accent=' + sounding.accVel.join(',') + ' p=' + sounding.pVel.join(','));
  ok('hairpin velocities rise toward forte',
    sounding.hairVel.length >= 3 && sounding.hairVel[0] < sounding.hairVel[1] && sounding.hairVel[1] < sounding.hairVel[sounding.hairVel.length - 1],
    sounding.hairVel.join(' → '));
  ok('repeat end sounds the two bars twice in order',
    JSON.stringify(sounding.visits) === JSON.stringify([1, 2, 1, 2]),
    JSON.stringify(sounding.visits));
  ok('later tempo mark shortens the millisecond-per-quarter',
    sounding.after > 0 && sounding.before > 0 && sounding.after < sounding.before,
    'before=' + Math.round(sounding.before) + ' after=' + Math.round(sounding.after) + ' map=' + sounding.tempoMap.join(','));
  ok('una-corda, sostenuto and damper are distinct pedal events',
    sounding.pedKinds.indexOf('damper') >= 0 && sounding.pedKinds.indexOf('soft') >= 0 && sounding.pedKinds.indexOf('sostenuto') >= 0,
    sounding.pedEvents.join(' | '));
  ok('damper change is not a second start of the same kind only',
    sounding.pedEvents.some(e => /damper:change/.test(e) || /damper:.*:64/.test(e)),
    sounding.pedEvents.join(' | '));

  const volta = await page.evaluate(xml => {
    const s = PPP.parseMusicXML(xml, 'volta.musicxml');
    return PPP.PianoScore.of(s).visits.map(v => v.number);
  }, mx(
    '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<barline location="left"><repeat direction="forward"/></barline>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>' +
    '<measure number="2"><barline location="left"><ending number="1" type="start">1.</ending></barline>' +
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>' +
    '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>' +
    '<measure number="3"><barline location="left"><ending number="2" type="start">2.</ending></barline>' +
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>' +
    '<barline location="right"><ending number="2" type="stop"/></barline></measure>'
  ));
  ok('first and second endings play as 1, 2, 1, 3',
    JSON.stringify(volta) === JSON.stringify([1, 2, 1, 3]),
    JSON.stringify(volta));

  const sfz = await page.evaluate(xml => {
    const s = PPP.parseMusicXML(xml, 'sfz.musicxml');
    const plan = PPP.PianoScore.of(s);
    const unmarked = plan.strikes.filter(x => !x.note.dyn && !x.note.accent)[0];
    const z = plan.strikes.filter(x => x.note.dyn === 'sfz')[0];
    return { u: unmarked && unmarked.vel, z: z && z.vel, dyn: z && z.note.dyn };
  }, mx(
    '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>' +
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type><notations><dynamics><sfz/></dynamics></notations></note></measure>'
  ));
  ok('sfz is louder than an unmarked note at the same dynamic',
    sfz.z > sfz.u, 'unmarked=' + sfz.u + ' sfz=' + sfz.z + ' dyn=' + sfz.dyn);

  /* ---------- import through the real UI ---------- */
  console.log('\n── import through the UI ──');
  await page.evaluate(() => {
    window.__pppTest.upload();
  });
  await sleep(250);
  const input = await page.$('input[type=file][data-add-file]');
  ok('file input present', !!input);
  if (input) {
    /* choosing the file is the whole gesture — reading starts at once */
    await input.uploadFile(SAMPLE);
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
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
  await sleep(200);
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
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
  await sleep(300);
  await page.screenshot({ path: path.join(__dirname, '.shots', 'parsed-loop.png') });

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('MusicXML parsing, engraving and the practice system all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
