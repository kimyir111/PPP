/* G04 §21.5, §21.6, A43: what the legacy renderer's own SVG lets a generic geometry pass count, in the same metric
   names L2 uses where the concept maps directly - so the two renderers are directly comparable, category by
   category (A43: "G4 is at least as good as legacy in every category"). This tool has no engine cooperation: it
   does not read the ScoreGraph, the NotationPlan or the legacy Score - only the drawn SVG's own classed groups and
   their getBBox(), the way a person's eye (or a generic score-checking tool with no access to PPP's internals)
   could. Local: needs this tree served and puppeteer (not a CI gate job - a nightly one, G04 §21.5).

     NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/legacy-geometry.js --url http://127.0.0.1:8801
       [--suite r|e] [--out tests/engrave/out/legacy-geometry.json] [--limit N]

   Categories - the concepts a plain SVG pass can see, named the way L2 (tests/engrave/l2.js) names the same concept:
     eg.clip.count         a drawn element (notehead, stem, beam, tie, tuplet bracket, clef, stave) outside the SVG's
                            own viewBox - the page/viewport clipping L2 counts by the same name (target 0 for both)
     eg.overlap.head_head  two noteheads' boxes truly overlapping and NOT at (nearly) the same position - a position
                            match is the one thing a generic pass can take as an intended shared unison; a real
                            legality check (G04 §14.2: same written pitch, dots, opposite stems, different voices)
                            needs the graph, which this tool does not read - engrave-side L2 has that check, this
                            heuristic does not, and this file says so rather than claiming more than it measures
     eg.beam.count         beam groups drawn (legacy: .vf-beam; G4: EngravedScore objects of kind 'beam')
     eg.tie.count          tie groups drawn (legacy: .vf-stavetie; G4: kind 'tie')
     eg.tuplet.count       tuplet-bracket groups drawn (legacy: .ppp-tuplet, the app's own wrapper around VexFlow's
                            tuplet draw call; G4: kind 'tuplet-bracket')

   The G4 (engrave) side of the same categories is computed in Node, no browser, from the same file's EngravedScore
   at the desktop breakpoint (l2.js's own eg.clip.count/eg.overlap.head_head, and the three kind counts above) - the
   same corpus, the same categories, so the report is a direct A43 table: G4 vs legacy, summed over the suite.

   Because this tool has no graph, its beam/tie/tuplet counts are structural (how many groups a browser's DOM shows),
   not coverage ratios - G4 already proves its own coverage exactly elsewhere (L1's *_drawn_ratio, all 1 over every
   suite, tests/engrave/tools/bench.js). Reading legacy's count against G4's here is a floor, not a re-proof: where
   legacy's count exceeds G4's, that is flagged for the Lead (a real gap or a structural mismatch this generic pass
   cannot tell apart - never silently patched or loosened here, per the brief). No G0 hold-out file is ever opened,
   read from disk, or named in the report. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const H = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));
const { l2 } = require(path.join(REPO, 'tests', 'engrave', 'l2.js'));
const E = H.E;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://127.0.0.1:8801');
const SUITE = arg('--suite', 'r');
const LIMIT = arg('--limit', null);
const OUT = path.resolve(REPO, arg('--out', 'tests/engrave/out/legacy-geometry.json'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const HOLDOUT = H.holdoutPaths();
const notHoldout = p => { if (HOLDOUT.has(p)) throw new Error('a G0 hold-out file is never opened here'); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function suiteFiles(suite) {
  if (suite === 'r') {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
    return m.files.map(notHoldout);
  }
  if (suite === 'e') {
    const d = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
    return fs.readdirSync(d).filter(f => f.endsWith('.musicxml')).sort().map(f => 'tests/engrave/fixtures/e/' + f);
  }
  throw new Error('unknown suite ' + suite + ' (r, e)');
}

/* the browser side: legacy's own SVG, generic geometry only - no PPP internals past what the DOM shows */
async function legacyMetrics(page, rel) {
  const bytes = [...fs.readFileSync(path.join(REPO, rel))];
  return page.evaluate(async (bytes, name) => {
    const P = window.PPP, App = P.app;
    let score;
    try { score = await P.scoreFromFile(new File([new Uint8Array(bytes)], name)); }
    catch (e) { return { error: 'open: ' + (e.code || e.message) }; }
    score.id = 'legacy-geometry:' + name;
    App.shelveSong();
    App.adoptScore(score);
    App.enterSong(score, { kind: /\.mxl$/i.test(name) ? 'mxl' : 'musicxml', name: name, importedAt: 0, status: 'parsed' }, false);
    App.go('player')();
    await new Promise(r => App.setState({ wholeScore: true, beat: 0, playing: false, renderer: 'legacy' }, r));
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 60));
      const svg = document.querySelector('.ppp-staffwrap svg');
      if (svg && svg.querySelector('.vf-stave')) break;
    }
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg) return { error: 'no svg' };
    if (svg.classList.contains('ppp-engraved')) return { error: 'drawn by the engraver, not the legacy renderer' };
    /* the SVG's own declared drawing frame: the one boundary a generic pass can call "the page" for a renderer that
       has no page model of its own (legacy has no A4/print layout - only this continuous view) */
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    const frame = vb.length === 4 && vb.every(n => Number.isFinite(n)) ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null;
    const boxOf = el => { const b = el.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; };
    const collect = sel => [...svg.querySelectorAll(sel)].map(el => boxOf(el));
    const noteheads = collect('.vf-notehead');
    const clipCandidates = [].concat(noteheads, collect('.vf-stem'), collect('.vf-beam'), collect('.vf-stavetie'),
      collect('.ppp-tuplet'), collect('.vf-clef'), collect('.vf-stave'));
    const EPS = 0.5;
    let clip = 0;
    if (frame) clipCandidates.forEach(b => { if (b[0] < frame.x - EPS || b[1] < frame.y - EPS || b[2] > frame.x + frame.w + EPS || b[3] > frame.y + frame.h + EPS) clip++; });
    /* head-head: a true AABB overlap that is not (nearly) the same box - the one shape a generic pass can call an
       intended shared unison without reading the graph (G04 §14.2's real legality test needs it) */
    const SAME = 0.75;
    const over = (a, b) => a[2] > b[0] + EPS && b[2] > a[0] + EPS && a[3] > b[1] + EPS && b[3] > a[1] + EPS;
    const same = (a, b) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME && Math.abs(a[2] - b[2]) < SAME && Math.abs(a[3] - b[3]) < SAME;
    const byX = noteheads.slice().sort((a, b) => a[0] - b[0]);
    let hh = 0;
    for (let i = 0; i < byX.length; i++) {
      for (let j = i + 1; j < byX.length && byX[j][0] < byX[i][2] + EPS; j++) {
        if (over(byX[i], byX[j]) && !same(byX[i], byX[j])) hh++;
      }
    }
    return { clip: clip, headHead: hh, beams: collect('.vf-beam').length, ties: collect('.vf-stavetie').length,
      tuplets: collect('.ppp-tuplet').length, noteheads: noteheads.length, frame: frame };
  }, bytes, path.basename(rel));
}

/* the G4 (engrave) side of the same categories, Node only, from the same file's EngravedScore (desktop) */
async function engraveMetrics(rel) {
  const graph = await H.graphOf(rel);
  if (!graph) return { error: 'graph did not open' };
  const p = E.plan(graph);
  const P = E.layout.prepare(p);
  const eng = E.layout.createEngraver(p).layout({ breakpoint: 'desktop' });
  const m = l2(eng, p, { prepared: P, layout: E.layout, graph: graph });
  const count = kind => eng.objects.filter(o => o.kind === kind).length;
  /* ties (and slurs, glissandi) are not in eng.objects - they are Bezier curves on eng.curves (l2.js's own reading,
     G04 §21.2's eg.clip.curves); a tie split across a system break is two curve pieces, one each side (G04 §13.1) -
     counted here as two, the same granularity a generic SVG pass sees in either renderer's drawn groups.
     tuplets: a tuplet may have a bracket object, a number object, both or (bracket:false, the common case per the
     census, G04 §39 appendix A-1) only a number - deduped by the tuplet's own id (before its '#bracket'/'#num'
     suffix) so one tuplet is counted once, matching legacy's one .ppp-tuplet group per tuplet drawn. */
  const ties = (eng.curves || []).filter(c => c.kind === 'tie').length;
  const tupletIds = new Set();
  eng.objects.forEach(o => { if (o.kind === 'tuplet-bracket' || o.kind === 'tuplet-number') tupletIds.add(o.id.split('#')[0]); });
  return { clip: m['eg.clip.count'] || 0, headHead: m['eg.overlap.head_head'] || 0, beams: count('beam'), ties: ties, tuplets: tupletIds.size };
}

(async () => {
  const files = suiteFiles(SUITE).slice(0, LIMIT ? Number(LIMIT) : undefined);
  console.log('legacy-geometry: ' + files.length + ' files (suite ' + SUITE + '), legacy at ' + BASE + ', G4 in Node');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 1000 });
  /* G4f-2: the default page is the engraver's since the flip - the legacy side of A43 is the rollback, ?renderer=legacy
     (App.setState's `renderer` below never reached a ScoreView: this tool read the legacy renderer because it was the
     default; a drawing by the engraver is refused below) */
  await page.goto(BASE + '/Piano%20Coach%20App.dc.html?renderer=legacy', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex && window.Vex.Flow, { timeout: 30000 });
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(500);

  const rows = [];
  const CATS = ['clip', 'headHead', 'beams', 'ties', 'tuplets'];
  const totals = { g4: {}, legacy: {} };
  CATS.forEach(c => { totals.g4[c] = 0; totals.legacy[c] = 0; });
  let errors = 0;
  for (const rel of files) {
    const [g4, legacy] = [await engraveMetrics(rel), await legacyMetrics(page, rel)];
    if (g4.error || legacy.error) { errors++; console.log('  ' + rel + ' ERROR g4=' + (g4.error || '-') + ' legacy=' + (legacy.error || '-')); continue; }
    CATS.forEach(c => { totals.g4[c] += g4[c]; totals.legacy[c] += legacy[c]; });
    rows.push({ file: rel, g4: g4, legacy: legacy });
    console.log('  ' + rel + ' g4 clip=' + g4.clip + ' hh=' + g4.headHead + ' beams=' + g4.beams + ' ties=' + g4.ties + ' tuplets=' + g4.tuplets +
      ' | legacy clip=' + legacy.clip + ' hh=' + legacy.headHead + ' beams=' + legacy.beams + ' ties=' + legacy.ties + ' tuplets=' + legacy.tuplets);
  }
  await browser.close();

  /* A43: G4 >= legacy in every category. For a defect count (clip, headHead) that means G4's total must not exceed
     legacy's (fewer or equal drawn defects is at least as good); for a structural coverage count (beams, ties,
     tuplets) it means G4's total must not fall short of legacy's (G4's own coverage is already proven exact
     elsewhere, tests/engrave/tools/bench.js's *_drawn_ratio = 1, so a G4 count at or above legacy's is consistent
     with that; a shortfall would contradict it and is reported, not hidden). */
  const DEFECT = new Set(['clip', 'headHead']);
  const verdict = {};
  let allPass = true;
  CATS.forEach(c => {
    const g4 = totals.g4[c], legacy = totals.legacy[c];
    const ok = DEFECT.has(c) ? g4 <= legacy : g4 >= legacy;
    verdict[c] = { g4: g4, legacy: legacy, ok: ok };
    if (!ok) allPass = false;
  });
  console.log('\nA43 (' + SUITE + ' suite, ' + files.length + ' files, ' + errors + ' errors):');
  CATS.forEach(c => console.log('  ' + (verdict[c].ok ? 'ok  ' : 'FAIL') + ' ' + c + ': g4=' + verdict[c].g4 + ' legacy=' + verdict[c].legacy +
    (DEFECT.has(c) ? ' (defect count, g4 <= legacy wanted)' : ' (coverage count, g4 >= legacy wanted)')));
  console.log(allPass ? '\nA43: G4 at least as good as legacy in every category' : '\nA43: NOT met in every category - see above, a real finding for the Lead');

  fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), suite: SUITE, url: BASE, files: files.length, errors: errors, totals: totals, verdict: verdict, rows: rows }, null, 1));
  console.log('\nwritten ' + path.relative(REPO, OUT));
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
