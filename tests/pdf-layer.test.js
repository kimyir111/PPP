/* ============================================================================
   PDF LAYER — what a PDF says in its own text and lines.

   A PDF made by notation software carries its chord names, title and tempo
   as text, and its staff lines, bar lines and 8va brackets as lines. Reading
   the picture misses them: a real file came back from recognition with no
   chord names, no title and no 8va. PPP reads them from the PDF itself and
   puts them on the bars recognition found.

   The PDF here is written by hand, so it is exact and carries no one's music:
   one system of two staves and three bars, chord names above it (one set in
   pieces, "C" "m" "/E" and a flat from the music font, as Finale writes it),
   an "8va" with a dashed line and a hook, and a stem almost exactly as tall
   as the staff to tempt the bar-line finder. The score it is laid on is the
   MusicXML recognition would give for it, with the positions it drew each
   note at.
   ========================================================================== */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* ---- a one-page PDF, written out byte by byte ---- */
function makePdf() {
  const ops = [];
  const text = (font, size, x, y, s) => ops.push('BT /' + font + ' ' + size + ' Tf ' + x + ' ' + y + ' Td (' + s + ') Tj ET');
  const line = (x0, y0, x1, y1) => ops.push(x0 + ' ' + y0 + ' m ' + x1 + ' ' + y1 + ' l S');
  ops.push('0.5 w');
  text('F1', 24, 220, 790, 'Vector Song');
  text('F1', 11, 420, 765, 'Music by Test Composer');
  text('F2', 14, 60, 745, 'q');                     /* the crotchet of the tempo mark */
  text('F1', 10, 69, 747, '=70');
  /* two staves, five lines each */
  [700, 620].forEach(top => { for (let i = 0; i < 5; i++) line(50, top - 6 * i, 550, top - 6 * i); });
  /* bar lines through the system, the first one being its opening line */
  [50, 200, 350, 550].forEach(x => line(x, 596, x, 700));
  /* a stem nearly as tall as the staff, which is not a bar line */
  line(450, 677, 450, 701.2);
  /* note heads, in the music font, each on its own line or space: G4 A4 |
     C5 E5 | G5 B4 on top, the first a G-B-D chord (and two more in bar 3
     that recognition will miss),
     G3 | C3 | G2 below */
  [[90, 682], [90, 688], [90, 694], [140, 685], [230, 691], [300, 697], [380, 703], [450, 688], [500, 694], [520, 691]]
    .forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  [[90, 617], [230, 605], [380, 596]].forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  /* an arpeggio before the first note, in pieces as Finale sets it */
  text('F2', 20, 76, 680, 'g');
  text('F2', 20, 76, 686, 'g');
  /* a flat in front of the B in bar 3 */
  text('F2', 20, 440, 688, 'b');
  /* chord names, one of them in pieces with a flat from the music font */
  text('F1', 11, 88, 720, 'G');
  text('F1', 11, 138, 720, 'D');
  text('F1', 11, 228, 720, 'C');
  text('F1', 11, 378, 720, 'C');
  text('F1', 11, 386, 720, 'm');
  text('F1', 11, 395, 720, '/E');
  text('F2', 14, 405, 724, 'b');
  /* a change of bass alone over the E in bar 2 */
  text('F1', 11, 298, 720, '/E');
  /* segno at the start of bar 2, a coda sign just before the bar line into
     bar 3 (Maestro's coda comes out of WinAnsi as "Þ"), "To Coda" at the end
     of bar 1 and "D.S. al Coda" under the end of bar 3 */
  text('F2', 20, 205, 706, '%');
  text('F2', 20, 342, 706, '\\336');
  text('F1', 10, 150, 703, 'To Coda');
  text('F1', 10, 470, 585, 'D.S. al Coda');
  /* 8va, its dashed line and the hook at its end */
  text('F1', 10, 292, 708, '8va');
  for (let x = 312; x < 400; x += 6) line(x, 711, x + 3, 711);
  line(400, 711, 400, 705);
  const stream = ops.join('\n');

  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
    offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1').toString('base64');
}

/* ---- what recognition would give for it ---- */
const note = (p, dur, voice, type, staff, dx, chord) => {
  const m = /^([A-G])(\d)$/.exec(p);
  return '<note default-x="' + dx + '">' + (chord ? '<chord/>' : '') + '<pitch><step>' + m[1] + '</step><octave>' + m[2] +
    '</octave></pitch><duration>' + dur + '</duration><voice>' + voice + '</voice><type>' + type + '</type><staff>' + staff + '</staff></note>';
};
const bar = (n, width, rh, lh, head) => '<measure number="' + n + '" width="' + width + '">' + (head || '') + rh + '<backup><duration>4</duration></backup>' + lh + '</measure>';
const XML = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">' +
  '<identification><encoding><software>Audiveris 5.11.0</software></encoding></identification>' +
  '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' +
  /* bar 1: the arpeggio line read as an E5 in front of the real notes */
  bar(1, 150, note('E5', 1, 1, 'quarter', 1, 27) + note('G4', 1, 1, 'quarter', 1, 40) + note('B4', 1, 1, 'quarter', 1, 40, true) + note('D5', 1, 1, 'quarter', 1, 40, true) +
    note('A4', 2, 1, 'half', 1, 90),
    note('G3', 4, 5, 'whole', 2, 40),
    '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
    '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>') +
  /* bar 2: the left hand started two beats late, though it is drawn under the first note */
  bar(2, 150, note('C5', 2, 1, 'half', 1, 30) + note('E5', 2, 1, 'half', 1, 100),
    '<forward><duration>2</duration><voice>5</voice><staff>2</staff></forward>' + note('C3', 2, 5, 'half', 2, 30)) +
  /* bar 3: the flat before the B not read, and two notes not read at all */
  bar(3, 200, note('G5', 2, 1, 'half', 1, 30) + note('B4', 2, 1, 'half', 1, 100), note('G2', 4, 5, 'whole', 2, 30)) +
  '</part></score-partwise>';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const page = await browser.newPage();
  await preparePage(page);
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPP.Import.pdfLayer, { timeout: 25000 });
  await page.addScriptTag({ url: PDFJS });

  const r = await page.evaluate(async (b64, xml, worker) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const doc = await pdfjsLib.getDocument({ data: u }).promise;
    const L = await PPP.Import.pdfLayer.read(await doc.getPage(1), pdfjsLib);
    const PL = PPP.Import.pdfLayer;
    const lay = PL.layout(L, 2);

    const score = PPP.parseMusicXML(xml, 'vector.pdf');
    const before = { title: score.title, tempo: score.tempo, chords: (score.chords || []).length };
    const out = PL.apply(score, [L], [xml], 'vector.pdf');
    /* a page whose bar lines do not agree with recognition is left alone */
    const two = xml.replace(/<measure number="3"[\s\S]*?<\/measure>/, '');
    const other = PPP.parseMusicXML(two, 'vector.pdf');
    const untouched = PL.apply(other, [L], [two], 'vector.pdf');
    return {
      staves: lay.systems.length ? lay.systems[0].staves.length : 0,
      bars: lay.systems.length ? lay.systems[0].bars.map(b => Math.round(b.x0) + '-' + Math.round(b.x1)) : [],
      out: out, before: before,
      title: score.title, composer: score.composer, tempo: score.tempo,
      chords: score.chords.map(c => c.m + '|' + c.b + '|' + c.text),
      marks: (score.marks || []).map(k => k.m + ':' + k.kind + (k.text ? '(' + k.text + ')' : '')),
      ottavas: score.ottavas,
      pitches: score.notes.filter(n => n.staff === 1).map(n => n.m + '|' + n.b + '|' + n.p),
      left: score.notes.filter(n => n.staff === 2).map(n => n.m + '|' + n.b + '|' + n.p),
      rolled: score.notes.filter(n => n.arp).map(n => n.m + '|' + n.b + '|' + n.p),
      flats: score.notes.filter(n => n.acc === 'flat').map(n => n.m + '|' + n.b + '|' + n.p),
      untouched: untouched, otherChords: (other.chords || []).length,
      saved: JSON.stringify({ score: score })
    };
  }, makePdf(), XML, PDFJS_WORKER);

  const built = await page.evaluate(async (b64, worker) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const raw = u.slice();
    const doc = await pdfjsLib.getDocument({ data: u }).promise;
    const page1 = await doc.getPage(1);
    const L = await PPP.Import.pdfLayer.read(page1, pdfjsLib);
    const vp = page1.getViewport({ scale: 1 });
    const old = PPP.Import.health;
    PPP.Import.health = () => Promise.resolve({ ok: false, remote: true, unreachable: true });
    let load = null;
    try {
      const file = {
        name: 'vector.pdf', type: 'application/pdf', size: raw.byteLength,
        arrayBuffer: () => Promise.resolve(raw.slice().buffer)
      };
      load = await PPP.Import.load(file);
    } catch (e) { load = { error: e.message, size: raw.byteLength }; }
    PPP.Import.health = old;
    const n = PPP.Import.pdfLayer.notate([{ layer: L, width: vp.width, height: vp.height }], 'vector.pdf');
    const score = n && n.xml ? PPP.parseMusicXML(n.xml, 'vector.pdf') : null;
    return {
      notes: n && n.notes, measures: n && n.measures, title: n && n.title,
      pitches: score ? score.notes.filter(x => !x.rest).map(x => x.p) : [],
      engine: load && load.source && load.source.engine,
      loadNotes: load && load.score ? load.score.notes.filter(x => !x.rest).length : 0,
      loadError: load && load.error
    };
  }, makePdf(), PDFJS_WORKER);

  console.log('\n── reading the page as a score, without a helper ──');
  ok('the vector page notates itself', built.notes >= 8 && built.measures >= 3,
    'notes=' + built.notes + ' measures=' + built.measures);
  ok('title is taken from the page', built.title === 'Vector Song', built.title);
  ok('G4 and C5 are on the page', built.pitches.indexOf('G4') > -1 && built.pitches.indexOf('C5') > -1,
    built.pitches.join(', '));
  ok('Import.load reads a PDF when the helper is not there',
    built.engine === 'pdf' && built.loadNotes >= 8 && !built.loadError,
    JSON.stringify({ engine: built.engine, notes: built.loadNotes, error: built.loadError }));

  console.log('\n── reading the page ───────────────────');
  ok('one system of two staves is found', r.staves === 2);
  ok('three bars, and the stem that is nearly a bar line is not one', r.bars.length === 3, r.bars.join(', '));

  console.log('\n── putting it on the score ────────────');
  ok('the page is used', r.out.pages === 1, JSON.stringify(r.out));
  ok('the arpeggio line read as a note is not a note; what followed moves back',
    r.out.phantoms === 1 && r.pitches.indexOf('1|0|G4') > -1 && r.pitches.indexOf('1|1|A4') > -1 && !r.pitches.some(p => /E5$/.test(p) && p.indexOf('1|') === 0),
    r.pitches.join(', '));
  ok('the arpeggio is put on the chord to its right', r.rolled.join(',') === '1|0|G4,1|0|B4,1|0|D5', r.rolled.join(', ') || 'none');
  ok('the flat printed before the B is read into it', r.flats.join(',') === '3|2|Bb4' && r.out.accidentals === 1, r.flats.join(', ') || 'none');
  ok('a left hand recognition started late joins the note it is drawn under',
    r.left.indexOf('2|0|C3') > -1 && r.out.realigned === 1, r.left.join(', '));
  ok('the bar with notes recognition missed is reported',
    (r.out.missing || []).length === 1 && r.out.missing[0].m === 3 && r.out.missing[0].staff === 1 && r.out.missing[0].page === 4,
    JSON.stringify(r.out.missing));
  ok('the chord names land on the notes under them',
    ['1|0|G', '1|1|D', '2|0|C', '3|0|Cm/Eb'].every(c => r.chords.indexOf(c) > -1) && r.chords.length === 5, r.chords.join(', '));
  ok('a change of bass alone is a chord name too', r.chords.indexOf('2|2|/E') > -1);
  ok('segno, coda, To Coda and D.S. al Coda land on their bars',
    ['2:segno', '3:coda', '1:tocoda(To Coda)', '3:ds(D.S. al Coda)'].every(k => r.marks.indexOf(k) > -1) && r.marks.length === 4,
    r.marks.join(', '));
  ok('a chord name set in pieces is read whole', r.chords.indexOf('3|0|Cm/Eb') > -1);
  ok('the 8va runs from the note under its sign to the last note before its hook',
    r.ottavas.length === 1 && r.ottavas[0].m === 2 && r.ottavas[0].b === 2 && r.ottavas[0].endM === 3 && r.ottavas[0].dir === 1 && r.ottavas[0].staff === 1,
    JSON.stringify(r.ottavas));
  ok('the notes under it sound an octave higher; the one after it does not',
    r.pitches.indexOf('2|2|E6') > -1 && r.pitches.indexOf('3|0|G6') > -1 && r.pitches.indexOf('3|2|Bb4') > -1 && r.pitches.indexOf('2|0|C5') > -1,
    r.pitches.join(', '));
  ok('the title comes from the page, not the file name', r.before.title === 'vector.pdf' && r.title === 'Vector Song', r.title);
  ok('the composer comes from the page', r.composer === 'Music by Test Composer', r.composer);
  ok('the tempo comes from the page', r.tempo === 70, String(r.tempo));
  ok('a page whose bars do not agree with recognition is left alone',
    r.untouched.pages === 0 && r.untouched.chords === 0 && r.untouched.ottavas === 0, JSON.stringify(r.untouched));

  console.log('\n── words recognition could not finish ─');
  const mended = await page.evaluate(() => {
    const w = t => '<direction placement="above"><direction-type><words>' + t + '</words></direction-type></direction>';
    const n = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>';
    const bars = ['A/Cﬂ', 'Am?', 'D73us4', 'Cm/El’', 'akbobada.com', 'T0 Coda', '0/5', 'DM7/F11']
      .map((t, i) => '<measure number="' + (i + 1) + '">' + (i ? '' : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>') + w(t) + n + '</measure>').join('');
    const head = '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">';
    const omr = '<?xml version="1.0"?><score-partwise><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">';
    const harmony = '<harmony><root><root-step>D</root-step></root><kind text="7sus4">suspended-fourth</kind><degree><degree-value>7</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree></harmony>';
    const sus = PPP.parseMusicXML(head + '<measure number="1"><attributes><divisions>1</divisions></attributes>' + harmony + n + '</measure></part></score-partwise>', 'x');
    return {
      fromOmr: PPP.parseMusicXML(omr + bars + '</part></score-partwise>', 'x').chords.map(c => c.m + ':' + c.text),
      written: PPP.parseMusicXML(head + bars + '</part></score-partwise>', 'x').chords.length,
      sus: sus.chords.map(c => c.text),
      nav: (() => {
        const dir = x => '<direction placement="above"><direction-type>' + x + '</direction-type></direction>';
        const xml = omr +
          '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          dir('<segno/>') + n + dir('<words>T0 Coda</words>') + '</measure>' +
          '<measure number="2">' + dir('<coda/>') + n + dir('<words>D.S. al Coda</words>') + dir('<words>Fine</words>') + '</measure>' +
          '</part></score-partwise>';
        return PPP.parseMusicXML(xml, 'x').marks.map(k => k.m + ':' + k.kind + (k.text ? '(' + k.text + ')' : ''));
      })()
    };
  });
  ok('chord names OCR garbled are mended', ['1:A/C#', '2:Am7', '3:D7sus4', '4:Cm/Eb'].every(c => mended.fromOmr.indexOf(c) > -1), mended.fromOmr.join(', '));
  ok('words that are not chord names stay words', mended.fromOmr.length === 4, mended.fromOmr.length + ' chords');
  ok('in a file someone wrote, words are never taken for chords', mended.written === 0);
  ok('a degree the printed name already shows is not added twice', mended.sus[0] === 'D7sus4', mended.sus[0]);
  ok('segno, coda and the words around them are read from a file, and the "T0 Coda" OCR makes too',
    ['1:segno', '1:tocoda(To Coda)', '2:coda', '2:ds(D.S. al Coda)', '2:fine(Fine)'].every(k => mended.nav.indexOf(k) > -1) && mended.nav.length === 5,
    mended.nav.join(', '));

  console.log('\n── a photo of vocal + piano ───────────');
  const raster = await page.evaluate(() => {
    const staffYs = [
      [706, 701, 696, 692, 687], [627, 622, 617, 611, 606], [559, 554, 548, 543, 537],
      [456, 451, 446, 442, 437], [377, 372, 367, 361, 356], [309, 304, 298, 293, 287],
      [206, 201, 197, 192, 187], [128, 122, 117, 112, 106], [59, 54, 48, 43, 38]
    ];
    const hl = [];
    staffYs.forEach(lines => lines.forEach(y => hl.push({ x0: 8, x1: 712, y: y })));
    const vl = [];
    [[0, 2], [3, 5], [6, 8]].forEach(pair => {
      const top = staffYs[pair[0]][0], bot = staffYs[pair[1]][4];
      [50, 200, 350, 500, 680].forEach(x => vl.push({ x: x, y0: bot, y1: top }));
    });
    const blobs = [];
    [[0, 1, 2], [3, 4, 5], [6, 7, 8]].forEach(triple => {
      const vocal = staffYs[triple[0]], treble = staffYs[triple[1]], bass = staffYs[triple[2]];
      [90, 240, 390, 540].forEach(x => {
        blobs.push({ x0: x, x1: x + 6, y0: vocal[2] - 3, y1: vocal[2] + 3 });
        blobs.push({ x0: x, x1: x + 6, y0: treble[2] - 3, y1: treble[2] + 3 });
        blobs.push({ x0: x, x1: x + 6, y0: bass[2] - 3, y1: bass[2] + 3 });
      });
    });
    const L = { w: 720, h: 1018, texts: [], hl: hl, vl: vl, blobs: blobs };
    const lay = PPP.Import.pdfLayer.layout(L, 0);
    const built = PPP.Import.pdfLayer.notate([{ layer: L, width: 720, height: 1018 }], 'scan.jpg');
    const score = built && built.xml ? PPP.parseMusicXML(built.xml, 'scan.jpg') : null;
    return {
      systems: (lay.systems || []).map(s => s.staves.length),
      bars: (lay.systems || []).map(s => s.bars.length),
      notes: built && built.notes,
      measures: built && built.measures,
      staves: score && score.staves,
      hands: score ? {
        x: score.notes.filter(n => !n.rest && n.hand === 'x').length,
        r: score.notes.filter(n => !n.rest && n.hand === 'r').length,
        l: score.notes.filter(n => !n.rest && n.hand === 'l').length
      } : null
    };
  });
  ok('uneven staff lines still group into 5-line staves',
    raster.systems.length === 3 && raster.systems.every(n => n === 3),
    JSON.stringify(raster.systems));
  ok('each system has the printed bars', raster.bars.every(n => n >= 3), JSON.stringify(raster.bars));
  ok('the page notates itself without a helper',
    raster.notes >= 8 && raster.measures >= 3,
    'notes=' + raster.notes + ' measures=' + raster.measures);
  ok('the piano is the last two of three staves',
    raster.staves === 3 && raster.hands && raster.hands.x > 0 && raster.hands.r > 0 && raster.hands.l > 0,
    JSON.stringify({ staves: raster.staves, hands: raster.hands }));

  const cleanPng = fs.readFileSync(path.join(__dirname, 'fixtures', 'piano-clean.png')).toString('base64');
  const fromPng = await page.evaluate(async b64 => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], 'piano-clean.png', { type: 'image/png' });
    const pages = await PPP.Import.imageToPage(file);
    const L = pages[0].layer || {};
    const lay = PPP.Import.pdfLayer.layout(L, 0);
    const built = PPP.Import.pdfLayer.notate(pages, 'piano-clean.png');
    return {
      hl: (L.hl || []).length, blobs: (L.blobs || []).length,
      systems: (lay.systems || []).map(s => s.staves.length),
      notes: built && built.notes, measures: built && built.measures
    };
  }, cleanPng);
  ok('a clean piano PNG still shows staff lines in the browser',
    fromPng.hl >= 20, 'hl=' + fromPng.hl + ' blobs=' + fromPng.blobs);
  ok('that PNG notates as a grand staff without a helper',
    fromPng.systems.some(n => n >= 2) && fromPng.notes >= 8,
    JSON.stringify(fromPng));

  console.log('\n── a rolled chord ─────────────────────');
  const roll = await page.evaluate(() => {
    const nt = (step, oct, chord, arp) => '<note>' + (chord ? '<chord/>' : '') + '<pitch><step>' + step + '</step><octave>' + oct +
      '</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' + (arp ? '<notations><arpeggiate/></notations>' : '') + '</note>';
    const xml = '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
      nt('C', 4, false, true) + nt('E', 4, true, true) + nt('G', 4, true, true) +
      nt('C', 4, false, false) + nt('E', 4, true, false) + nt('G', 4, true, false) +
      '<note><rest/><duration>2</duration><voice>1</voice><type>half</type></note></measure></part></score-partwise>';
    const sc = PPP.parseMusicXML(xml, 'x');
    const E = new PPP.PerformanceEngine(sc);
    /* 60 a minute: the rolled chord at 1000 ms, the plain one at 2000 ms */
    E.begin({ from: 1, to: 1, hands: 'both', tempo: 60, startedAt: 1000 });
    const rolled = [E.noteOn({ midi: 60, t: 1000 }).verdict, E.noteOn({ midi: 64, t: 1080 }).verdict, E.noteOn({ midi: 67, t: 1160 }).verdict];
    const plain = [E.noteOn({ midi: 60, t: 2000 }).verdict, E.noteOn({ midi: 67, t: 2160 }).verdict];
    return { arp: sc.notes.filter(n => n.arp).length, rolled: rolled, plain: plain };
  });
  ok('an arpeggiated chord is read from the file', roll.arp === 3, roll.arp + ' notes');
  ok('its notes played bottom to top are all on time', roll.rolled.every(v => v === 'on'), roll.rolled.join(', '));
  ok('the same spread on a plain chord is late', roll.plain[1] === 'late', roll.plain.join(', '));

  console.log('\n── drawing it ─────────────────────────');
  await page.close();
  const view = await browser.newPage();
  await view.evaluateOnNewDocument(s => { try { localStorage.setItem('ppp.state.v2', s); } catch (e) {} }, r.saved);
  await preparePage(view);
  await view.setViewport({ width: 1500, height: 1000 });
  view.on('pageerror', e => pageErrors.push(e.message));
  await view.goto(URL, { waitUntil: 'networkidle2' });
  await view.waitForFunction(() => window.PPP && window.PPP.Score, { timeout: 25000 });
  await sleep(1200);
  await view.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')]
      .find(x => /^(Practice|연습)$/.test(((x.innerText || '').trim().split('\n')[0] || '').trim()));
    if (b) b.click();
  });
  await sleep(3500);
  const d = await view.evaluate(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg) return null;
    const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
    const staff = [...svg.querySelectorAll('g.ppp-stave')].filter(g => g.getAttribute('data-m') === '2' && g.getAttribute('data-staff') === '1')[0];
    const head = [...svg.querySelectorAll('g.ppp-note[data-onset]')].filter(g => /^2\|2\.000\|1$/.test(g.getAttribute('data-onset')))[0];
    const sb = staff ? staff.getBBox() : null;
    const hb = head ? head.querySelector('.vf-notehead').getBBox() : null;
    /* the rolled G4: its wavy line is drawn with it, to the left of its head */
    const g4 = [...svg.querySelectorAll('g.ppp-note[data-onset]')].filter(g => /^1\|0\.000\|1$/.test(g.getAttribute('data-onset')))[0];
    /* the head is the first shape of its group; VexFlow draws the wavy line into the same group */
    const gb = g4 ? g4.getBBox() : null, g4h = g4 ? g4.querySelector('.vf-notehead path').getBBox() : null;
    return {
      texts: texts, ottava: svg.querySelectorAll('.ppp-ottava').length,
      staffTop: sb ? sb.y : null, staffBottom: sb ? sb.y + sb.height : null, headY: hb ? hb.y : null,
      wavyReach: gb && g4h ? g4h.x - gb.x : null
    };
  });
  ok('the chord names are printed, with the flat as a sign', !!d && d.texts.indexOf('Cm/E♭') > -1 && d.texts.indexOf('G') > -1, d ? d.texts.filter(t => /^[A-G]/.test(t)).join(' ') : 'no staff');
  ok('the 8va bracket is drawn', !!d && d.ottava > 0 && d.texts.indexOf('8va') > -1);
  ok('a note under the 8va is drawn where the page writes it, inside the staff',
    !!d && d.headY != null && d.headY >= d.staffTop - 6 && d.headY <= d.staffBottom,
    d ? 'head at ' + Math.round(d.headY) + ', staff ' + Math.round(d.staffTop) + '–' + Math.round(d.staffBottom) : '');
  ok('the title from the page heads the score', !!d && d.texts.indexOf('Vector Song') > -1);
  ok('the segno and coda signs and their words are printed',
    !!d && ['𝄋', '𝄌', 'To Coda', 'D.S. al Coda'].every(t => d.texts.indexOf(t) > -1),
    d ? d.texts.filter(t => /𝄋|𝄌|Coda/.test(t)).join(' | ') : '');
  ok('the arpeggio is drawn beside its chord', !!d && d.wavyReach != null && d.wavyReach > 6,
    d && d.wavyReach != null ? 'reaches ' + d.wavyReach.toFixed(1) + 'px left of the head' : 'not found');
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');
  await view.evaluate(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });

  await browser.close();
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('What the PDF says in its own words reaches the score.');
})().catch(e => { console.error(e); process.exit(1); });
