/* G4e - print/PDF (docs/GOALS/G04 §15.5, §17, §24.7; A11, A38, A40, B8). Node only, no DOM: the print pipeline's
   pagination, multi-rest merging, title area and page numbers are pure (engrave/layout.js layoutPrint, breaks.js
   printBreakLines) and checked here the way l2.js checks the screen layout - the DOM half (the hidden container,
   @media print, window.print(), document.fonts.ready) is engrave/page.js's own functions, exercised by a browser
   suite and by hand (G04 §39), not here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, E, graphOf } = require('./helpers.js');
const PL2 = require('./print-l2.js');

const L = E.layout;
const CN = require(path.join(REPO, 'engrave', 'canon.js'));
const BR = require(path.join(REPO, 'engrave', 'breaks.js'));
const PAGE = require(path.join(REPO, 'engrave', 'page.js'));
const SV = require(path.join(REPO, 'engrave', 'svg.js'));

const efix = () => fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).filter(f => f.endsWith('.musicxml')).sort();
const eGraph = f => graphOf('tests/engrave/fixtures/e/' + f);

test('printBreakLines (§15.5): 100*(stretch-1.15)^2, a one-bar system +50 unless the piece has one bar, 1-6 bars, the last system free when it would need compressing (ragged)', () => {
  const meas = (i, j) => ({ minWidth: (j - i + 1) * 4, natural: (j - i + 1) * 8 });
  const r = BR.printBreakLines(10, 24, meas, null, null);
  assert.deepEqual(r.systems, [[0, 2], [3, 5], [6, 9]]);
  assert.ok(Math.abs(r.cost - 4.5) < 1e-6, 'two systems at stretch 1.0 (cost 2.25 each), the last free (ragged, stretch 0.75 < 1)');
  /* a single bar far too wide for anything else: unavoidable, no alternative scores lower */
  const one = BR.printBreakLines(1, 24, () => ({ minWidth: 40, natural: 80 }), null, null);
  assert.deepEqual(one.systems, [[0, 0]]);
  /* banned: a bar a multi-measure rest merges may not start a system - the run stays whole */
  const banned = new Set([1, 2]);
  const r2 = BR.printBreakLines(4, 24, (i, j) => ({ minWidth: (j - i + 1) * 4, natural: (j - i + 1) * 8 }), null, banned);
  assert.ok(r2.systems.every(([i]) => !banned.has(i)), 'no system starts on a banned bar');
});

/* the +50 itself, direct on printSystemCost (exported): a real corpus fixture never happens to make a lone bar cheap
   enough to choose over folding it in (a 60-file sweep found none, breaks.js's own stretch penalty already keeps it
   away by a wide margin) - so the rule is proved here, on the cost function itself, rather than by a mutation none
   of today's fixtures would catch. Removing PCOST.ONE (breaks.js) would make these two equal; they must not be. */
test('printSystemCost: a one-bar system costs +50 over the same stretch with more bars, unless the whole piece is one bar', () => {
  /* the same stretch (1.0) either way: one bar filling the width alone, or three bars together filling it */
  const lone = BR.printSystemCost({ bars: 1, total: 5, width: 24, minWidth: 4, natural: 24, last: false });
  const withNeighbours = BR.printSystemCost({ bars: 3, total: 5, width: 24, minWidth: 12, natural: 24, last: false });
  assert.ok(Math.abs(lone - (100 * Math.pow(1 - 1.15, 2) + 50)) < 1e-9);
  assert.ok(Math.abs(withNeighbours - 100 * Math.pow(1 - 1.15, 2)) < 1e-9);
  assert.ok(Math.abs(lone - withNeighbours - 50) < 1e-9, 'the one-bar system costs exactly 50 more at the same stretch');
  /* the whole piece is one bar: no neighbour exists, so it is not a choice - not penalized */
  const onlyBar = BR.printSystemCost({ bars: 1, total: 1, width: 24, minWidth: 4, natural: 24, last: false });
  assert.ok(Math.abs(onlyBar - 100 * Math.pow(1 - 1.15, 2)) < 1e-9);
});

test('layoutPrint: a real score paginates - A4 content width ~103 sp, systems never split across pages, page numbers from page 2, a title area only when the graph names one', async () => {
  const g = await graphOf('catalog/method/sonatina/001.mxl');
  const plan = E.plan(g, { mode: 'print' });
  const eng = L.engrave(plan, { mode: 'print' });
  assert.ok(eng.pages.length >= 2, 'sonatina/001 is long enough to need a second page');
  const m = PL2.pageMetrics(eng, g, L.engrave(E.plan(g, { mode: 'screen' }), {}));
  Object.entries(m).forEach(([k, v]) => assert.equal(v, 0, k + ' = ' + v));
  eng.pages.forEach((pg, i) => {
    assert.equal(pg.w, L.PRINT.pageW);
    assert.equal(pg.h, L.PRINT.pageH);
    if (i > 0) assert.ok(eng.objects.some(o => o.id === 'd:pageno:' + i), 'page ' + (i + 1) + ' has its number');
  });
  assert.ok(!eng.objects.some(o => o.id === 'd:pageno:0'), 'page 1 has no number (§15.5)');
  assert.ok(eng.objects.some(o => o.id === 'd:meta:title'), 'the graph names a title, so it is drawn');
});

test('layoutPrint: the title area is 0 sp with no title and no composer, and exactly titleHeight() otherwise (real text metrics, deterministic)', async () => {
  const g = await eGraph('E01-beams-basic.musicxml');
  const plan = E.plan(g, { mode: 'print' });
  const eng = L.engrave(plan, { mode: 'print' });
  /* this fixture names both (E fixtures always do, App 49) - the reserved area is titleHeight()'s number exactly:
     margin + titleHeight - topReach is the first system's y (the same formula layoutPrint uses to place it) */
  const h = L.titleHeight(plan.meta);
  assert.ok(h > 0, 'this fixture has a title and a composer');
  const sys0 = eng.systems.find(s => s.index === 0);
  /* the first system's own top reach always sits exactly at the margin plus whatever the title area reserved -
     that is what reserving the area means (layoutPrint: sys.y = margin + extra - topReach, box[1] = sys.y + topReach) */
  assert.ok(Math.abs(sys0.box[1] - (L.PRINT.margin + h)) < 0.02);
  /* no meta at all: an empty object gives 0 */
  assert.equal(L.titleHeight({}), 0);
  assert.equal(L.titleHeight(null), 0);
});

test('A38: the print EngravedScore hash is deterministic - three more layouts, and fixture order reversed', async () => {
  const files = efix();
  const graphs = {};
  for (const f of files) graphs[f] = await eGraph(f);
  const hashOf = g => CN.hash(L.engrave(E.plan(g, { mode: 'print' }), { mode: 'print' }));
  const order = Object.keys(graphs);
  const first = {};
  order.forEach(f => { first[f] = hashOf(graphs[f]); });
  order.forEach(f => assert.equal(hashOf(graphs[f]), first[f], f + ': again'));
  order.slice().reverse().forEach(f => assert.equal(hashOf(graphs[f]), first[f], f + ': fixture order reversed'));
  /* PDF bytes are not compared (§17.3) - only the EngravedScore's hash is a determinism target */
});

test('A11, E28: multi-measure rests merge only in print - screen keeps every bar, print merges the run into one wide bar with its count', async () => {
  const g = await eGraph('E28-multirest.musicxml');
  const screenEng = L.engrave(E.plan(g, { mode: 'screen' }), {});
  const printEng = L.engrave(E.plan(g, { mode: 'print' }), { mode: 'print' });
  assert.ok(!screenEng.objects.some(o => String(o.id).indexOf('d:multirest:') === 0), 'screen draws no merged rest');
  const label = printEng.objects.find(o => String(o.id).indexOf('d:multirest-n:') === 0);
  assert.ok(label, 'print draws the run\'s bar count');
  assert.equal(screenEng.measures.length, printEng.measures.length, 'the same bars exist in both - only the drawing differs');
});

test('A40: the screen and print ledgers agree, ref for ref, except the allow-listed print-only differences', async () => {
  for (const f of efix()) {
    const g = await eGraph(f);
    const r = PL2.ledgerAllowDiff(E.plan(g, { mode: 'screen' }), E.plan(g, { mode: 'print' }));
    assert.ok(r.ok, f + ': ' + JSON.stringify(r.diffs.slice(0, 5)));
  }
});

test('page.js printSvgs: each page gets its own glyph-symbol id prefix - a real bug this session\'s own puppeteer check found (a print page\'s <use> resolving to the screen SVG\'s ten-times-larger symbol, sharing the default "ppp-g-" prefix, made a notehead the size of the page)', async () => {
  const g = await graphOf('catalog/method/sonatina/001.mxl');
  const { plan, eng } = PAGE.printLayout(g, {});
  const svgs = PAGE.printSvgs(eng, plan);
  assert.ok(svgs.length >= 2);
  const idsOf = s => [...s.matchAll(/\bid="(ppp-g-[^"]*|ppp-print-\d+-g-[^"]*)"/g)].map(m => m[1]);
  const seen = new Set();
  svgs.forEach((s, i) => {
    const ids = idsOf(s);
    assert.ok(ids.length, 'page ' + i + ' defines glyph symbols');
    ids.forEach(id => {
      assert.ok(!seen.has(id), 'page ' + i + ': id ' + id + ' also defined on an earlier page');
      seen.add(id);
    });
    assert.ok(ids.every(id => id.indexOf('ppp-print-' + i + '-g-') === 0), 'page ' + i + '\'s own prefix, not the default "ppp-g-" every screen SVG on the same document already uses');
  });
});

test('A39: no raster element in the print output (page.js printSvgs, noRaster)', async () => {
  const g = await graphOf('catalog/method/sonatina/001.mxl');
  const { plan, eng } = PAGE.printLayout(g, {});
  const svgs = PAGE.printSvgs(eng, plan);
  assert.ok(svgs.length >= 2);
  const r = PAGE.noRaster(svgs);
  assert.ok(r.ok, JSON.stringify(r.bad));
});

test('svg.js: page selects which of a print EngravedScore\'s pages to draw - a screen SVG (no page field on its objects) is unaffected by the option', async () => {
  const g = await graphOf('catalog/method/sonatina/001.mxl');
  const plan = E.plan(g, { mode: 'print' });
  const eng = L.engrave(plan, { mode: 'print' });
  const p0 = SV.svg(eng, plan, { unit: 1, px: 1, page: 0 });
  const p1 = SV.svg(eng, plan, { unit: 1, px: 1, page: 1 });
  assert.notEqual(p0, p1);
  assert.ok(p0.indexOf('data-system="0"') >= 0 && p0.indexOf('data-system="' + eng.pages[1].systems[0] + '"') < 0);
  const screenPlan = E.plan(g, {});
  const screenEng = L.engrave(screenPlan, {});
  const s0 = SV.svg(screenEng, screenPlan, { unit: 1 });
  const s0again = SV.svg(screenEng, screenPlan, { unit: 1, page: 0 });
  assert.equal(s0, s0again, 'the default page (0) and an explicit page: 0 draw the same screen SVG');
});

/* the one committed score whose measure width holds no rod at all (layout.test.js's own OVERFLOW_ALLOWED): its last
   measure is 175/4 whole notes (166 events, the rest of the hymn in one bar - a source defect, not a print or
   screen regression) - it overflows the page and cannot help being a lone system, on both renderers */
const OVERFLOW_ALLOWED = new Set(['catalog/hymns/in-the-bleak-midwinter.musicxml']);
test('the print metrics are clean over the R corpus (tests/engrave/corpus.json, ~60 files)', async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  const files = [];
  corpus.strata.forEach(s => s.files.forEach(f => files.push(f)));
  const bad = [];
  for (const rel of files) {
    if (OVERFLOW_ALLOWED.has(rel)) continue;
    const g = await graphOf(rel);
    if (!g) continue;
    const printEng = L.engrave(E.plan(g, { mode: 'print' }), { mode: 'print' });
    const screenEng = L.engrave(E.plan(g, { mode: 'screen' }), {});
    const m = PL2.pageMetrics(printEng, g, screenEng);
    Object.entries(m).forEach(([k, v]) => { if (v !== 0) bad.push(rel + ' ' + k + '=' + v); });
    const ledger = PL2.ledgerAllowDiff(E.plan(g, { mode: 'screen' }), E.plan(g, { mode: 'print' }));
    if (!ledger.ok) bad.push(rel + ' ledger: ' + JSON.stringify(ledger.diffs.slice(0, 3)));
  }
  assert.deepEqual(bad, []);
});

test('B8 (perf, reported not gated here): print layout of the longest R corpus piece', async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  const files = [];
  corpus.strata.forEach(s => s.files.forEach(f => files.push(f)));
  let longest = null, n = -1;
  for (const rel of files) {
    const g = await graphOf(rel);
    if (!g) continue;
    const c = (g.timeline.measures || []).length;
    if (c > n) { n = c; longest = [rel, g]; }
  }
  const [id, g] = longest;
  const t0 = Date.now();
  const eng = L.engrave(E.plan(g, { mode: 'print' }), { mode: 'print' });
  const ms = Date.now() - t0;
  assert.ok(eng.pages.length >= 1);
  console.log('    B8 (this run): ' + id + ', ' + n + ' bars, ' + eng.pages.length + ' pages, ' + ms + ' ms (budget <= 2000 ms, §19.2)');
});
