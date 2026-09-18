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
  /* note heads, in the music font: two in each bar on each staff */
  [[90, 685], [140, 682], [230, 679], [300, 688], [380, 694], [450, 682]].forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  [[90, 605], [230, 605], [380, 605]].forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  /* chord names, one of them in pieces with a flat from the music font */
  text('F1', 11, 88, 720, 'G');
  text('F1', 11, 138, 720, 'D');
  text('F1', 11, 228, 720, 'C');
  text('F1', 11, 378, 720, 'C');
  text('F1', 11, 386, 720, 'm');
  text('F1', 11, 395, 720, '/E');
  text('F2', 14, 405, 724, 'b');
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
  bar(1, 150, note('G4', 2, 1, 'half', 1, 40) + note('A4', 2, 1, 'half', 1, 90), note('G3', 4, 5, 'whole', 2, 40),
    '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
    '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>') +
  bar(2, 150, note('C5', 2, 1, 'half', 1, 30) + note('E5', 2, 1, 'half', 1, 100), note('C3', 4, 5, 'whole', 2, 30)) +
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
      ottavas: score.ottavas,
      pitches: score.notes.filter(n => n.staff === 1).map(n => n.m + '|' + n.b + '|' + n.p),
      untouched: untouched, otherChords: (other.chords || []).length,
      saved: JSON.stringify({ score: score })
    };
  }, makePdf(), XML, PDFJS_WORKER);

  console.log('\n── reading the page ───────────────────');
  ok('one system of two staves is found', r.staves === 2);
  ok('three bars, and the stem that is nearly a bar line is not one', r.bars.length === 3, r.bars.join(', '));

  console.log('\n── putting it on the score ────────────');
  ok('the page is used', r.out.pages === 1, JSON.stringify(r.out));
  ok('the chord names land on the notes under them',
    ['1|0|G', '1|2|D', '2|0|C', '3|0|Cm/Eb'].every(c => r.chords.indexOf(c) > -1) && r.chords.length === 4, r.chords.join(', '));
  ok('a chord name set in pieces is read whole', r.chords.indexOf('3|0|Cm/Eb') > -1);
  ok('the 8va runs from the note under its sign to the last note before its hook',
    r.ottavas.length === 1 && r.ottavas[0].m === 2 && r.ottavas[0].b === 2 && r.ottavas[0].endM === 3 && r.ottavas[0].dir === 1 && r.ottavas[0].staff === 1,
    JSON.stringify(r.ottavas));
  ok('the notes under it sound an octave higher; the one after it does not',
    r.pitches.indexOf('2|2|E6') > -1 && r.pitches.indexOf('3|0|G6') > -1 && r.pitches.indexOf('3|2|B4') > -1 && r.pitches.indexOf('2|0|C5') > -1,
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
      sus: sus.chords.map(c => c.text)
    };
  });
  ok('chord names OCR garbled are mended', ['1:A/C#', '2:Am7', '3:D7sus4', '4:Cm/Eb'].every(c => mended.fromOmr.indexOf(c) > -1), mended.fromOmr.join(', '));
  ok('words that are not chord names stay words', mended.fromOmr.length === 4, mended.fromOmr.length + ' chords');
  ok('in a file someone wrote, words are never taken for chords', mended.written === 0);
  ok('a degree the printed name already shows is not added twice', mended.sus[0] === 'D7sus4', mended.sus[0]);

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
    return {
      texts: texts, ottava: svg.querySelectorAll('.ppp-ottava').length,
      staffTop: sb ? sb.y : null, staffBottom: sb ? sb.y + sb.height : null, headY: hb ? hb.y : null
    };
  });
  ok('the chord names are printed, with the flat as a sign', !!d && d.texts.indexOf('Cm/E♭') > -1 && d.texts.indexOf('G') > -1, d ? d.texts.filter(t => /^[A-G]/.test(t)).join(' ') : 'no staff');
  ok('the 8va bracket is drawn', !!d && d.ottava > 0 && d.texts.indexOf('8va') > -1);
  ok('a note under the 8va is drawn where the page writes it, inside the staff',
    !!d && d.headY != null && d.headY >= d.staffTop - 6 && d.headY <= d.staffBottom,
    d ? 'head at ' + Math.round(d.headY) + ', staff ' + Math.round(d.staffTop) + '–' + Math.round(d.staffBottom) : '');
  ok('the title from the page heads the score', !!d && d.texts.indexOf('Vector Song') > -1);
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
