/* G04 A28, A29, §19.2: the layout in a browser is the layout in Node - the same EngravedScore hash for every committed
   score at both screen configs, and (G4c) the same SVG text, whose glyphs Chrome draws at the boxes the layout
   measured - and how long it takes there, at full speed and on a 4x slower CPU.

     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/browser-parity.js [--quick]

   No server and no port: headless Chrome opens a blank page and the scripts go in as they are, in the app's order
   (scoregraph/*.js, then engrave/*.js with the G4b layout core before index.js - the page loads it, the app does not
   yet). Graphs cross as their canonical JSON; the page parses, plans, lays out and hashes. Nothing touches the
   network (requests are refused). --quick: the E fixtures and the R suite only. Writes tests/engrave/out/browser-parity.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const H = require('../helpers.js');
const { REPO, SG, E } = H;

const CONFIGS = { desktop: { breakpoint: 'desktop' }, phone: { breakpoint: 'phone' } };
const LAYOUT_CORE = ['metrics', 'space', 'breaks', 'skyline', 'canon', 'notation', 'layout', 'practice', 'outlines', 'svg'];

function scripts() {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="\.\/((?:scoregraph|engrave)\/[\w-]+\.js)\?v=[^"]*"><\/script>/g)].map(m => m[1]);
  const i = srcs.indexOf('engrave/index.js');
  return srcs.slice(0, i).concat(LAYOUT_CORE.map(n => 'engrave/' + n + '.js'), ['engrave/index.js']);
}

async function inputs(quick) {
  const out = [];
  const d = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.musicxml')).sort()) out.push(['e/' + f, await H.graphOf('tests/engrave/fixtures/e/' + f)]);
  if (quick) {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
    for (const rel of m.files) out.push([rel, await H.graphOf(rel)]);
  } else (await H.corpusGraphs()).forEach(x => out.push(x));
  H.goldenGraphs().forEach(x => out.push(x));
  return out;
}

async function main() {
  const quick = process.argv.indexOf('--quick') > 0;
  const items = await inputs(quick);
  /* Node's hashes, and a hash of the SVG each layout draws (G4c: the backend's text is the same in Node and Chrome) */
  const Z = require('../../../scoregraph/serialize.js');
  const svgHash = s => Z.fnv1a64(Z.utf8(s));
  const node = {}, nodeSvg = {};
  items.forEach(([id, g]) => {
    const p = E.plan(g);
    node[id] = {}; nodeSvg[id] = {};
    Object.keys(CONFIGS).forEach(c => { const e = E.engrave(p, CONFIGS[c]); node[id][c] = E.layoutHash(e); nodeSvg[id][c] = svgHash(E.svg(e, p)); });
  });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  let requests = 0;
  page.on('request', r => { if (r.url().startsWith('data:') || r.url() === 'about:blank') r.continue(); else { requests++; r.abort(); } });
  await page.goto('about:blank');
  for (const s of scripts()) await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, s), 'utf8') + '\n//# sourceURL=' + s });
  const ready = await page.evaluate(() => !!(window.PPPEngrave && window.PPPEngrave.layout && window.PPPEngrave.practice && window.PPPEngrave.svg && window.PPPEngrave.version));
  if (!ready) throw new Error('the page did not load the layout core');
  /* the browser's hashes, a batch at a time */
  const got = {}, gotSvg = {};
  const BATCH = 25;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH).map(([id, g]) => [id, SG.serialize(g)]);
    const res = await page.evaluate((batch, CONFIGS) => {
      const out = {}, svg = {};
      const Z = window.PPPScoreGraphModules.serialize;
      batch.forEach(([id, text]) => {
        const g = window.PPPScoreGraph.parse(text);
        const p = window.PPPEngrave.plan(g);
        out[id] = {}; svg[id] = {};
        Object.keys(CONFIGS).forEach(c => {
          const e = window.PPPEngrave.engrave(p, CONFIGS[c]);
          out[id][c] = window.PPPEngrave.layoutHash(e);
          svg[id][c] = Z.fnv1a64(Z.utf8(window.PPPEngrave.svg(e, p)));
        });
      });
      return { out: out, svg: svg };
    }, batch, CONFIGS);
    Object.assign(got, res.out);
    Object.assign(gotSvg, res.svg);
  }
  const differ = [], svgDiffer = [];
  Object.keys(node).forEach(id => Object.keys(CONFIGS).forEach(c => {
    if (node[id][c] !== (got[id] || {})[c]) differ.push(id + ' ' + c);
    if (nodeSvg[id][c] !== (gotSvg[id] || {})[c]) svgDiffer.push(id + ' ' + c);
  }));
  /* the SVG drawn in the page: every glyph Chrome renders from a <use> sits at the box the layout measured (R7: the
     outlines at the metrics' scale), for a fixture of full-size and grace (0.66) glyphs */
  const drawnBoxes = await page.evaluate(text => {
    const E = window.PPPEngrave, g = window.PPPScoreGraph.parse(text), p = E.plan(g), e = E.engrave(p, { breakpoint: 'desktop' });
    document.body.innerHTML = E.svg(e, p);
    const svg = document.querySelector('svg');
    const uses = [...svg.querySelectorAll('use')];
    const objs = e.objects.filter(o => o.glyph && !o.drawn);
    const pt = svg.createSVGPoint();
    let worst = 0;
    uses.forEach(u => {
      const b = u.getBBox(), name = u.getAttribute('href').replace(/^#ppp-g-/, '');
      /* the box's corners in the svg's own coordinates (the use's transform or x/y applied) */
      /* getCTM maps to the svg's viewport, in px: back to staff spaces by the viewBox's scale */
      const m = u.getCTM(), k = svg.width.baseVal.value / svg.viewBox.baseVal.width;
      const toRoot = (x, y) => { pt.x = x; pt.y = y; const q = pt.matrixTransform(m); return [q.x / k, q.y / k]; };
      const [x0, y0] = toRoot(b.x, b.y), [x1, y1] = toRoot(b.x + b.width, b.y + b.height);
      /* the object this glyph draws: the one of its name whose box it is nearest */
      const d = Math.min(...objs.filter(o => o.glyph === name).map(o => Math.max(Math.abs(x0 - o.box[0]), Math.abs(y0 - o.box[1]), Math.abs(x1 - o.box[2]), Math.abs(y1 - o.box[3]))));
      worst = Math.max(worst, d);
    });
    return { uses: uses.length, objects: objs.length, worst: Math.round(worst * 1000) / 1000 };
  }, SG.serialize(await H.graphOf('tests/engrave/fixtures/e/E14-grace.musicxml')));
  /* timing in the browser: sonatina/020 at 1x and 4x CPU */
  const g020 = SG.serialize(await H.graphOf('catalog/method/sonatina/020.mxl'));
  const client = await page.target().createCDPSession();
  const timing = {};
  for (const rate of [1, 4]) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: rate });
    timing[rate + 'x'] = await page.evaluate(text => {
      const now = () => performance.now();
      const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
      const E = window.PPPEngrave, g = window.PPPScoreGraph.parse(text);
      const med = f => { const xs = []; for (let r = 0; r < 5; r++) { const a = now(); f(); xs.push(now() - a); } return pct(xs, 0.5); };
      const p = E.plan(g);
      let P, eng;
      const plan = med(() => E.plan(g));
      const prepare = med(() => { P = E.layout.prepare(p); });
      const layout = med(() => { eng = E.layout.layout(P, { breakpoint: 'desktop' }); });
      const windows = [];
      const en = E.layout.createEngraver(p);
      for (let i = 0; i + 3 < p.measures.length; i += 4) { const a = now(); en.layout({ window: [i, i + 3] }); windows.push(now() - a); }
      const map = E.practice.createPracticeMap(eng, p), h = E.practice.createHighlighter(map), ups = [];
      for (let q = 0; q < 300; q += 0.08) { const a = now(); h.update(q); ups.push(now() - a); }
      const r = v => Math.round(v * 100) / 100;
      return { planMs: r(plan), prepareMs: r(prepare), layoutMs: r(layout), wholeMs: r(prepare + layout), windowP95Ms: r(pct(windows, 0.95)),
        highlightP95Ms: r(pct(ups, 0.95)), highlightMaxMs: r(Math.max(...ups)) };
    }, g020);
  }
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const version = await browser.version();
  await browser.close();
  const report = { browser: version, scores: items.length, configs: Object.keys(CONFIGS), equal: items.length * 2 - differ.length, differ: differ,
    svgEqual: items.length * 2 - svgDiffer.length, svgDiffer: svgDiffer, drawnBoxes: drawnBoxes, networkRequests: requests, timing020: timing };
  const dir = path.join(REPO, 'tests', 'engrave', 'out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'browser-parity.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(version + ': ' + report.equal + '/' + items.length * 2 + ' layouts hash the same as Node' + (differ.length ? ' - DIFFER: ' + differ.slice(0, 10).join(', ') : '') +
    '; SVG ' + report.svgEqual + '/' + items.length * 2 + ' byte-identical' + (svgDiffer.length ? ' - DIFFER: ' + svgDiffer.slice(0, 10).join(', ') : '') +
    '; E14 drawn in the page: ' + JSON.stringify(drawnBoxes) + '; network requests ' + requests);
  Object.keys(timing).forEach(k => console.log('sonatina/020 ' + k + ' CPU: ' + JSON.stringify(timing[k])));
  process.exit(differ.length || svgDiffer.length || requests || drawnBoxes.uses !== drawnBoxes.objects || drawnBoxes.worst > 0.05 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
