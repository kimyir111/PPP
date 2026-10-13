/* The hand-written PDF page and the MusicXML recognition would give for it, shared by tests/omr-apply-app.test.js (G12-2).
   A copy of the fixture of tests/pdf-layer.test.js (it exercises every finding PdfLayer.apply makes: a phantom note read from an arpeggio line, an arpeggio,
   a flat not read, a voice started late, chord names, segno / coda / jump words, an 8va, the title, composer and tempo). The page was written for
   that suite and is not changed here; tests/omr-apply-app.test.js checks the copy still gives the findings (so a drift fails loudly). */
'use strict';

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


module.exports = { makePdf, XML };
