/* G4c - the SVG backend (docs/GOALS/G04 §16.3, §16.4, §18.2, §19 B9, §20; G4-L1): an EngravedScore becomes one
   deterministic SVG string, glyphs defined once and placed with <use> at the metrics' scale (the G4b review R7), the
   legacy renderer's DOM contract as classes and data attributes, and no DOM measurement - it emits text. Node only;
   tests/engrave/tools/browser-parity.js checks the same strings in Chrome. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, E, graphOf } = require('./helpers.js');

const MT = E.metrics;
const OL = require(path.join(REPO, 'engrave', 'outlines.js'));
const efile = k => 'tests/engrave/fixtures/e/' + fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).find(f => f.startsWith(k + '-'));
async function draw(rel, cfg) {
  const g = await graphOf(rel.indexOf('/') >= 0 ? rel : efile(rel));
  const p = E.plan(g);
  const e = E.engrave(p, cfg || {});
  return { g, p, e, svg: E.svg(e, p) };
}
/* a small XML check: every tag closes in order, every attribute is name="value" with no raw < or " inside */
function wellFormed(s) {
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<[^>]*>/g;
  let m, last = 0, root = 0;
  while ((m = re.exec(s))) {
    if (!m[2]) { if (m[0].indexOf('<!--') !== 0) return 'bad tag ' + m[0].slice(0, 60); continue; }
    if (/[<>]/.test(s.slice(last, m.index))) return 'stray bracket before ' + m[0].slice(0, 40);
    last = re.lastIndex;
    if (m[1]) { if (stack.pop() !== m[2]) return 'unbalanced </' + m[2] + '>'; }
    else if (!m[4]) { stack.push(m[2]); if (stack.length === 1) root++; }
  }
  return stack.length ? 'unclosed ' + stack.join('>') : root === 1 ? null : root + ' roots';
}
const count = (s, re) => (s.match(re) || []).length;
const attrsOf = (s, cls) => [...s.matchAll(new RegExp('<g class="' + cls + '([^>]*)>', 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])));

test('the SVG is one well-formed document, the same bytes every time, in staff spaces with ink in currentColor', async () => {
  for (const k of ['E01', 'E04', 'E12', 'E14', 'E22', 'E26', 'E37']) {
    const x = await draw(k);
    assert.equal(wellFormed(x.svg), null, k);
    assert.equal(E.svg(x.e, x.p), x.svg, k + ': again');
    assert.equal(E.svg(E.engrave(E.plan(await graphOf(efile(k))), {}), E.plan(await graphOf(efile(k)))), x.svg, k + ': afresh');
    assert.match(x.svg, new RegExp('^<svg xmlns="http://www.w3.org/2000/svg" class="ppp-engraved" viewBox="0 0 ' + x.e.pages[0].w + ' ' + x.e.pages[0].h + '"'));
    assert.match(x.svg, /fill="currentColor"/);
    assert.doesNotMatch(x.svg, /#000|black|rgb\(/, k + ': no fixed colour');
    assert.doesNotMatch(x.svg, /NaN|undefined|Infinity/, k);
    /* every coordinate to 0.01 (the glyph symbols' path data is the font's own integer units; data-onset keeps the legacy
       key's three decimals) */
    const body = x.svg.replace(/<defs>[\s\S]*<\/defs>/, '').replace(/ data-[\w-]+="[^"]*"/g, '');
    assert.ok([...body.matchAll(/-?\d+\.(\d+)/g)].every(m => m[1].length <= 2), k + ': two decimals at most');
  }
  const x = await draw('E37');
  assert.equal(E.svg(x.e, x.p, { hash: true }).indexOf('data-layout="' + E.layoutHash(x.e) + '"') > 0, true, 'the layout hash on request');
});

test('R7: glyphs are defined once as <symbol> from the pinned Bravura outlines at the metrics\' scale, and placed with <use> where the layout puts them', async () => {
  /* the outlines' extent, at 1/360 sp a unit, is the metrics table's box - for every glyph (control points included) */
  Object.keys(OL.PATHS).forEach(n => {
    const v = OL.PATHS[n].match(/-?\d+/g).map(Number);
    const xs = v.filter((_, i) => i % 2 === 0).map(x => x / OL.UNITS), ys = v.filter((_, i) => i % 2 === 1).map(y => y / OL.UNITS);
    const g = MT.GLYPHS[n];
    [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].forEach((got, i) => assert.ok(Math.abs(got - g[i]) < 0.03, n + ' ' + i + ': ' + got + ' vs ' + g[i]));
  });
  assert.deepEqual(Object.keys(OL.PATHS).sort(), Object.keys(MT.GLYPHS).sort(), 'an outline for every glyph the layout sizes');
  /* the generated file is what the pinned font gives (CI runs the same check) */
  const out = require('child_process').execFileSync(process.execPath, [path.join(REPO, 'tests', 'engrave', 'tools', 'make-outlines.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, /holds the pinned font's outlines/);
  for (const k of ['E02', 'E14', 'E33', 'E37']) {
    const x = await draw(k);
    const glyphObjs = x.e.objects.filter(o => o.glyph && !o.drawn);
    const names = [...new Set(glyphObjs.map(o => o.glyph))].sort();
    assert.equal(count(x.svg, /<symbol /g), names.length, k + ': each glyph defined once');
    assert.deepEqual([...x.svg.matchAll(/<symbol id="ppp-g-(\w+)"/g)].map(m => m[1]), names);
    assert.equal(count(x.svg, /<use /g), glyphObjs.length, k + ': one <use> per glyph object');
    assert.equal(count(x.svg, /<path transform="scale\(0\.002777778 -0\.002777778\)"/g), names.length, 'the outlines drawn at 1/360 sp a unit');
    /* each glyph's box is its origin plus the metrics' box at its scale: the backend draws where the layout measured */
    glyphObjs.forEach(o => {
      const g = MT.glyph(o.glyph), s = o.scale || 1;
      const want = [o.origin[0] + g.xMin * s, o.origin[1] - g.yMax * s, o.origin[0] + g.xMax * s, o.origin[1] - g.yMin * s];
      want.forEach((v, i) => assert.ok(Math.abs(v - o.box[i]) < 0.02, k + ' ' + o.id + ' box ' + i));
      const at = s === 1 ? 'x="' + o.origin[0] + '" y="' + o.origin[1] + '"' : 'transform="translate(' + o.origin[0] + ' ' + o.origin[1] + ') scale(' + s + ')"';
      assert.ok(x.svg.indexOf('href="#ppp-g-' + o.glyph + '"') > 0 && x.svg.indexOf(at) > 0, k + ' ' + o.id + ' placed at its origin');
    });
  }
  /* the development view draws through the backend: no outline code of its own left to be wrong */
  const view = fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'tools', 'layout-view.js'), 'utf8');
  assert.doesNotMatch(view, /getGlyphs|getResolution|vexflow/i);
  const V = require('./tools/layout-view.js');
  const x = await draw('E01');
  assert.ok(V.svgOf(x.e, x.p, {}).indexOf(x.svg.slice(x.svg.indexOf('<defs>'), x.svg.indexOf('</defs>'))) > 0);
});

test('§16.4: the DOM contract - g.ppp-stave per measure and staff with the legacy data attributes, g.ppp-note per event and staff with data-onset and data-ev, data-rest, g.ppp-tuplet, VexFlow class names', async () => {
  const x = await draw('E22');
  const staves = attrsOf(x.svg, 'ppp-stave');
  assert.equal(staves.length, x.p.measures.length * x.p.staves.length, 'one per measure and staff');
  x.p.measures.forEach(m => [1, 2].forEach(n => assert.ok(staves.some(a => a['data-m'] === m.number && a['data-staff'] === String(n)), m.number + '/' + n)));
  const beginM = x.p.measures.filter(m => m.barline && m.barline.left && m.barline.left.repeat === 'forward').map(m => m.number);
  assert.deepEqual([...new Set(staves.filter(a => a['data-begin'] === 'repeat').map(a => a['data-m']))], beginM, 'data-begin on a forward repeat');
  assert.ok(staves.some(a => a['data-end'] === 'repeat') && staves.some(a => a['data-end'] === 'final'), 'data-end repeat and final');
  const voltas = staves.filter(a => a['data-volta']);
  assert.ok(voltas.length >= 2 && voltas.every(a => a['data-staff'] === '1'), 'data-volta on the top staff');
  assert.ok(voltas.some(a => /^BEGIN(_END)?:1$/.test(a['data-volta'])), JSON.stringify(voltas.map(a => a['data-volta'])));
  assert.deepEqual(staves.filter(a => a['data-time']).map(a => a['data-time']).slice(0, 2), ['4/4', '4/4'], 'data-time where the time signature is drawn');
  /* notes: one group per event and staff; the key is the legacy one */
  for (const k of ['E13', 'E26', 'E37']) {
    const y = await draw(k);
    const notes = attrsOf(y.svg, 'ppp-note vf-stavenote');
    const want = [];
    y.p.events.filter(e => !e.hidden && !e.grace && y.e.objects.some(o => o.event === e.id)).forEach(e => {
      const staves2 = [...new Set(y.e.objects.filter(o => o.event === e.id).map(o => o.staffKey))];
      staves2.forEach(s => want.push(e.id + '|' + E.onsetKey(y.p, e, e.kind === 'rest' ? e.staff : s) + '|' + (e.kind === 'rest' ? '1' : '')));
    });
    assert.deepEqual(notes.map(a => a['data-ev'] + '|' + a['data-onset'] + '|' + (a['data-rest'] || '')).sort(), want.sort(), k);
    assert.equal(count(y.svg, /class="vf-notehead"/g), y.e.objects.filter(o => o.kind === 'notehead').length, k + ': .vf-notehead on every head');
    assert.equal(count(y.svg, /class="vf-stem"/g), y.e.objects.filter(o => o.kind === 'stem').length, k + ': .vf-stem on every stem');
  }
  /* tuplets, grace notes, beams, clefs */
  const t = await draw('E04');
  assert.equal(count(t.svg, /<g class="ppp-tuplet" data-tuplet="/g), t.p.tuplets.length);
  const gr = await draw('E14');
  assert.equal(count(gr.svg, /<g class="ppp-grace" data-ev="/g), gr.p.events.filter(e => e.grace && !e.grace.after).length);
  assert.equal(count(gr.svg, /class="vf-beam" data-beam="/g), gr.e.objects.filter(o => o.kind === 'beam').length);
  assert.equal(count(gr.svg, /class="vf-clef"/g), gr.e.objects.filter(o => o.kind === 'clef').length);
});

test('§20: the backend measures nothing and needs no DOM - it runs in Node on plain data; A29 holds it to every rule though §20 would allow it DOM measurement', () => {
  const src = fs.readFileSync(path.join(REPO, 'engrave', 'svg.js'), 'utf8');
  const A29 = require('./a29.js');
  assert.deepEqual(A29.scanSource(src, 'not-the-backend.js'), []);
  assert.equal(typeof globalThis.document, 'undefined');
});

/* G04 §19.1's legacy whole-score SVG sizes (the design session, headless Chrome): of the pieces outside the G0 hold-out */
const LEGACY_KB = { 'catalog/method/burgmuller25/021.mxl': 828, 'catalog/method/czerny849/001.mxl': 725, 'catalog/method/sonatina/013.mxl': 2182,
  'catalog/method/sonatina/016.mxl': 1894, 'catalog/method/sonatina/020.mxl': 2154 };
test('B9: a whole score\'s SVG is at most half the legacy renderer\'s (§19.1), glyphs by reference', async () => {
  const H = require('./helpers.js');
  const holdout = H.holdoutPaths();
  for (const rel of Object.keys(LEGACY_KB)) {
    assert.ok(!holdout.has(rel), rel + ' is not a G0 hold-out');
    const x = await draw(rel);
    const kb = Buffer.byteLength(x.svg) / 1024;
    assert.ok(kb <= 0.5 * LEGACY_KB[rel], rel + ': ' + kb.toFixed(1) + ' KB > half of ' + LEGACY_KB[rel] + ' KB');
  }
});
