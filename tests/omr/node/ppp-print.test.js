/* omr-live-2, engraver B (tests/omr/node/ppp-print.js) and the SVG sizing of raster.js: the Node parts of the benchmark that do not need
   Chrome. Run by the CI gate through tests/bench/unit/test_omr2_node.py; locally: `npm run test:omr`.

   A0: the pages must be the same bytes in every run and in any order ("3 runs, reversed order") and on Windows and Linux (nothing here
   reads a clock, a random number, a font file or the platform: the layout uses the committed text-width tables). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const { printPages } = require('./ppp-print.js');
const { sizeSvg } = require('./raster.js');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const note = (step, oct, dur, type, staff, voice) =>
  '<note><pitch><step>' + step + '</step><octave>' + oct + '</octave></pitch><duration>' + dur + '</duration><voice>' + voice +
  '</voice><type>' + type + '</type><staff>' + staff + '</staff></note>';

/* a small grand-staff piece of N bars of 4/4: a rising right hand over a held left hand */
function piece(bars, title) {
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  let body = '';
  for (let i = 0; i < bars; i++) {
    const attrs = i ? '' : '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
    let rh = '';
    for (let k = 0; k < 4; k++) rh += note(steps[(i + k) % 7], 4 + ((i + k) >= 7 ? 1 : 0), 1, 'quarter', 1, 1);
    body += '<measure number="' + (i + 1) + '">' + attrs + rh + '<backup><duration>4</duration></backup>' + note(steps[i % 7], 3, 4, 'whole', 2, 2) + '</measure>';
  }
  return '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>' + title + '</work-title></work>' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' + body + '</part></score-partwise>';
}

const INPUTS = [piece(4, 'Four'), piece(16, 'Sixteen'), piece(40, 'Forty')];

test('ppp-print: a score becomes SVG pages, vector only, A4 print layout', async () => {
  const r = await printPages(INPUTS[1], 'sixteen.musicxml');
  assert.ok(r.pages.length >= 1);
  r.pages.forEach(svg => {
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /viewBox="0 0 120 169\.71"/, 'the A4 print page in staff spaces');
    assert.ok(!/<image[\s>]|<canvas[\s>]/.test(svg), 'no raster element');
  });
  assert.equal(r.meta.pages, r.pages.length);
  assert.equal(r.meta.svg_sha256.length, r.pages.length);
  assert.ok(r.meta.systems >= 2, '16 bars need more than one system');
  assert.deepEqual(r.meta.diagnostics.filter(d => d !== 'SYSTEM_SCALED'), []);
});

test('ppp-print: a longer piece takes more pages (the pagination is real)', async () => {
  const a = await printPages(INPUTS[0], 'four.musicxml');
  const c = await printPages(INPUTS[2], 'forty.musicxml');
  assert.equal(a.pages.length, 1);
  assert.ok(c.pages.length > a.pages.length);
});

test('ppp-print: the same bytes in, the same SVG out: 3 runs, and in reversed order (A0)', async () => {
  const run = async order => {
    const out = {};
    for (const i of order) out[i] = (await printPages(INPUTS[i], 'x' + i + '.musicxml')).pages.map(sha);
    return out;
  };
  const a = await run([0, 1, 2]);
  const b = await run([2, 1, 0]);
  const c = await run([1, 2, 0]);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('ppp-print: the title is printed from the work title, and two different scores are two different pages', async () => {
  const a = await printPages(piece(4, 'Alpha'), 'a.musicxml');
  const b = await printPages(piece(4, 'Bravo'), 'b.musicxml');
  assert.notEqual(sha(a.pages[0]), sha(b.pages[0]));
  assert.match(a.pages[0], /Alpha/);
});

test('ppp-print: something that is not a score is an error, not an empty page', async () => {
  await assert.rejects(() => printPages('not a score at all', 'bad.musicxml'));
});

test('raster.sizeSvg: the root size is replaced and a viewBox added only when there is none', () => {
  const verovio = '<svg xmlns="http://www.w3.org/2000/svg" width="2100px" height="2970px"><svg class="definition-scale" viewBox="0 0 21000 29700"></svg></svg>';
  const a = sizeSvg(verovio, '210mm', '297mm');
  assert.match(a, /^<svg width="210mm" height="297mm" viewBox="0 0 2100 2970" xmlns=/);
  assert.match(a, /<svg class="definition-scale" viewBox="0 0 21000 29700">/, 'the inner svg is left alone');
  const ppp = '<svg xmlns="http://www.w3.org/2000/svg" class="ppp-engraved" viewBox="0 0 120 169.71" width="120" height="169.71" fill="currentColor"><g/></svg>';
  const b = sizeSvg(ppp, '2480px', '3508px');
  assert.match(b, /width="2480px" height="3508px"/);
  assert.equal((b.match(/viewBox=/g) || []).length, 1);
  assert.match(b, /viewBox="0 0 120 169\.71"/);
  assert.throws(() => sizeSvg('<svg xmlns="x"></svg>', '1px', '1px'));
  assert.throws(() => sizeSvg('no svg here', '1px', '1px'));
});
