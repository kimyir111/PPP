/* M-H1, the user's first look at the engraver (docs/GOALS/G04 §22.4, roadmap §10 and §15): the blind X/Y review packet.
   Local: needs this tree served and puppeteer.

     NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/review-build.js --url http://127.0.0.1:8801
       [--out tests/engrave/out/review/m-h1] [--key tests/engrave/out/review/m-h1-key] [--seed g4-mh1-2026-09-26]

   What it builds (both directories are under tests/engrave/out/, which git ignores; the reviewer is given the first, never
   the second):
     <out>/index.html            sixteen excerpts of eight bars, each drawn twice - X and Y - one above the other, with the
                                 questions; open it in a browser (it needs the page fonts from Google Fonts, as the app)
     <out>/svg/Hnn-X.svg, -Y.svg the drawings, as the page drew them, stripped of anything that names the renderer
     <out>/manifest.json         the seed, the selection rule, the strata, the excerpts (file, bars, what was counted) - no key
     <out>/results-template.json the answers to fill in, per excerpt and version
     <key>/key.json              which of X and Y is the legacy renderer and which the engraver, per excerpt
   The selection (§22.4): 16 excerpts x 8 bars from the R corpus (tests/engrave/corpus.json - eligible, not quarantined, no
   G0 hold-out; every file checked again here), stratified hymn polyphony 3, triplets 3, dense marks (sonatinas) 4, basic
   method books (Beyer, Czerny 599) 3, grace notes and 8va 2, repeats 1. Per stratum the candidate files are ordered by
   sha256(seed:stratum:path) and the first unused ones taken; in each, the eight bars where the stratum's feature is densest
   (the earliest on a tie). The order of the excerpts (H01...H16) and which renderer is X are drawn from the seed as well.
   Both versions are drawn by the real page's ScoreView from the same Score (the app's import door, so the engraver draws
   the file's own graph), at the same width, eight bars four to a line, bar numbers on, no note-name letters, nothing lit.
   A version that was not drawn by the renderer it claims (a fallback) stops the build. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const H = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));
const E = H.E;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://127.0.0.1:8801');
const OUT = path.resolve(REPO, arg('--out', 'tests/engrave/out/review/m-h1'));
const KEY = path.resolve(REPO, arg('--key', 'tests/engrave/out/review/m-h1-key'));
const SEED = arg('--seed', 'g4-mh1-2026-09-26');
const BARS = 8, WIDTH = 1000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const CORPUS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
const HOLDOUT = H.holdoutPaths();
const rStratum = name => (CORPUS.strata.find(s => s.name === name) || { files: [] }).files;
const allR = CORPUS.strata.reduce((a, s) => a.concat(s.files), []);

/* per measure (plan order), what each stratum counts */
function features(plan) {
  const n = plan.measures.length, mi = new Map(plan.measures.map((m, i) => [m.id, i]));
  const f = { poly: new Array(n).fill(0), triplets: new Array(n).fill(0), marks: new Array(n).fill(0), notes: new Array(n).fill(0),
    graceOttava: new Array(n).fill(0), repeats: new Array(n).fill(0) };
  const ev = new Map(plan.events.map(e => [e.id, e]));
  const voices = new Map();
  plan.events.forEach(e => {
    const i = mi.get(e.m);
    if (e.kind !== 'rest' && !e.hidden) {
      const k = e.staff + '|' + e.m;
      if (!voices.has(k)) voices.set(k, new Set());
      voices.get(k).add(e.voice);
      if (!e.grace) f.notes[i]++;
      f.marks[i] += (e.arts || []).length + (e.orn || []).length + (e.fermata ? 1 : 0) + (e.heads || []).reduce((s, h) => s + ((h.fingering || []).length), 0);
    }
    if (e.grace) f.graceOttava[i]++;
  });
  voices.forEach((set, k) => { if (set.size >= 2) f.poly[mi.get(k.split('|')[1])]++; });
  plan.tuplets.forEach(t => { const e = ev.get(t.events[0]); if (e && t.actual === 3 && (t.number !== 'none' || t.bracket)) f.triplets[mi.get(e.m)]++; });
  plan.slurs.forEach(s => { const e = ev.get(s.from); if (e) f.marks[mi.get(e.m)]++; });
  plan.marks.forEach(m => { if (mi.has(m.m) && (m.kind === 'dynamic' || m.kind === 'words')) f.marks[mi.get(m.m)]++; });
  plan.lines.forEach(l => {
    if (l.kind === 'wedge' && l.from && mi.has(l.from.m)) f.marks[mi.get(l.from.m)]++;
    if (l.kind === 'ottava' && l.from && l.to && mi.has(l.from.m) && mi.has(l.to.m)) for (let i = mi.get(l.from.m); i <= mi.get(l.to.m); i++) f.graceOttava[i]++;
  });
  plan.measures.forEach((m, i) => {
    const b = m.barline || {};
    if ((b.left && b.left.repeat) || (b.right && b.right.repeat)) f.repeats[i]++;
  });
  (plan.endings || []).forEach(en => { if (mi.has(en.from)) f.repeats[mi.get(en.from)] += 2; });
  return f;
}
/* the densest eight bars of a per-measure count (the earliest on a tie) */
function window(count) {
  const n = count.length;
  if (n <= BARS) return { from: 0, to: n - 1, score: count.reduce((a, b) => a + b, 0) };
  let best = null;
  for (let i = 0; i + BARS <= n; i++) {
    const s = count.slice(i, i + BARS).reduce((a, b) => a + b, 0);
    if (!best || s > best.score) best = { from: i, to: i + BARS - 1, score: s };
  }
  return best;
}

const STRATA = [
  { name: 'hymn polyphony', n: 3, feature: 'poly', pool: () => rStratum('hymns') },
  { name: 'triplets', n: 3, feature: 'triplets', pool: () => allR, min: 3 },
  { name: 'dense marks (sonatinas)', n: 4, feature: 'marks', pool: () => rStratum('sonatina') },
  { name: 'basic method books (Beyer, Czerny 599)', n: 3, feature: 'notes', pool: () => rStratum('beyer').concat(rStratum('czerny599')) },
  { name: 'grace notes and 8va', n: 2, feature: 'graceOttava', pool: () => allR, min: 1 },
  { name: 'repeats', n: 1, feature: 'repeats', pool: () => allR, min: 1 }
];

async function select() {
  const used = new Set();
  const chosen = [];
  for (const st of STRATA) {
    const pool = st.pool().filter(p => !HOLDOUT.has(p)).slice().sort((a, b) => (sha(SEED + ':' + st.name + ':' + a) < sha(SEED + ':' + st.name + ':' + b) ? -1 : 1));
    let got = 0;
    for (const rel of pool) {
      if (got >= st.n) break;
      if (used.has(rel)) continue;
      const g = await H.graphOf(rel);
      if (!g) continue;
      const plan = E.plan(g);
      if (plan.measures.length < BARS) continue;
      const f = features(plan)[st.feature];
      const total = f.reduce((a, b) => a + b, 0);
      if (total < (st.min || 1)) continue;
      const w = window(f);
      used.add(rel);
      got++;
      chosen.push({ stratum: st.name, file: rel, fromIndex: w.from, toIndex: w.to, bars: [plan.measures[w.from].number, plan.measures[w.to].number],
        counted: { feature: st.feature, inWindow: w.score, inFile: total } });
    }
    if (got < st.n) throw new Error('stratum ' + st.name + ': only ' + got + ' of ' + st.n + ' files qualify');
  }
  /* the order the reviewer sees them in, and which renderer is X */
  chosen.sort((a, b) => (sha(SEED + ':order:' + a.file) < sha(SEED + ':order:' + b.file) ? -1 : 1));
  chosen.forEach((c, i) => {
    c.id = 'H' + String(i + 1).padStart(2, '0');
    c.x = parseInt(sha(SEED + ':xy:' + c.file).slice(0, 8), 16) % 2 === 0 ? 'legacy' : 'engrave';
  });
  return chosen;
}

/* in the page: the Score through the import door, both renderers side by side in one page, each copied out with its computed
   colours written on it and anything that names the renderer taken off */
async function draw(page, c) {
  const bytes = [...fs.readFileSync(path.join(REPO, c.file))];
  return page.evaluate(async (bytes, name, fromIndex, WIDTH, BARS) => {
    const P = window.PPP, App = P.app, ReactDOM = window.ReactDOM;
    const score = await P.scoreFromFile(new File([new Uint8Array(bytes)], name));
    score.id = 'review:' + name;
    const out = {};
    for (const r of ['legacy', 'engrave']) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;width:' + WIDTH + 'px;background:#fff;';
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host);
      root.render(App.sv({ score: score, staves: score.staves, grand: (score.staves || 1) > 1, startM: score.measures[fromIndex].number, count: BARS, perRow: 4, fluid: true, numbers: true, heading: false,
        guidance: false, paper: true, theme: 'light', chords: true, marks: true, renderer: r }));
      let svg = null;
      for (let i = 0; i < 200; i++) {
        await new Promise(res => setTimeout(res, 50));
        svg = host.querySelector('svg');
        if (svg && svg.__ppp && (r === 'legacy' || svg.classList.contains('ppp-engraved'))) break;
        svg = null;
      }
      if (!svg) { out[r] = { error: 'not drawn', fallbacks: P.engraveStats.fallbacks }; root.unmount(); host.remove(); continue; }
      const engraved = svg.classList.contains('ppp-engraved');
      /* a copy with the computed paint written on every shape, then nothing that names who drew it */
      const copy = svg.cloneNode(true);
      const live = [svg, ...svg.querySelectorAll('*')], dead = [copy, ...copy.querySelectorAll('*')];
      live.forEach((e, i) => {
        const d = dead[i];
        if (!/^(path|rect|text|line|circle|ellipse|polygon|polyline|use|tspan)$/.test(e.tagName)) return;
        const cs = getComputedStyle(e);
        d.setAttribute('fill', cs.fill);
        d.setAttribute('stroke', cs.stroke);
        if (cs.strokeWidth) d.setAttribute('stroke-width', cs.strokeWidth);
        if (cs.opacity !== '1') d.setAttribute('opacity', cs.opacity);
      });
      /* the practice layer's marks (hidden: nothing is lit) go; so do classes, ids, data-* and the root's sizing */
      [...copy.querySelectorAll('[opacity="0"]')].forEach(e => e.remove());
      [copy, ...copy.querySelectorAll('*')].forEach(e => {
        [...e.attributes].forEach(a => { if (a.name === 'class' || a.name === 'id' || /^data-/.test(a.name) || (e === copy && a.name === 'style')) e.removeAttribute(a.name); });
      });
      copy.setAttribute('width', '100%');
      copy.removeAttribute('height');
      copy.setAttribute('style', 'display:block;background:#fffefc');
      const vb = copy.getAttribute('viewBox');
      out[r] = { engraved: engraved, svg: new XMLSerializer().serializeToString(copy), viewBox: vb, bars: svg.__ppp.bars.map(b => b.m) };
      root.unmount();
      host.remove();
    }
    out.fallbacks = P.engraveStats.fallbacks;
    return out;
  }, bytes, path.basename(c.file), c.fromIndex, WIDTH, BARS);
}

const AXES = [
  ['readability', 'How easy is it to read? (1 hard - 5 easy)'],
  ['wrong', 'Does any notation look wrong? (yes / no; say where)'],
  ['spacing', 'Spacing: are notes, bars and lines well spaced? (1 poor - 5 good)'],
  ['marks', 'Placement of marks - dynamics, slurs, fingering, pedal, text (1 poor - 5 good)'],
  ['overall', 'Overall (1 poor - 5 good)'],
  ['practise', 'Would you practise from this? (yes / fix / no)']
];

(async () => {
  const chosen = await select();
  chosen.forEach(c => { if (HOLDOUT.has(c.file)) throw new Error('a G0 hold-out file'); });
  fs.mkdirSync(path.join(OUT, 'svg'), { recursive: true });
  fs.mkdirSync(KEY, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (/\[ppp\]/.test(m.text())) logs.push(m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await preparePage(page);
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(BASE + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.Vex && window.Vex.Flow, { timeout: 30000 });
  const version = await page.evaluate(() => window.PPPEngrave.version);
  const rows = [];
  for (const c of chosen) {
    const d = await draw(page, c);
    if (!d.legacy || !d.engrave || d.legacy.error || d.engrave.error || d.legacy.engraved || !d.engrave.engraved) {
      throw new Error(c.file + ': a version was not drawn by its renderer - ' + JSON.stringify({ legacy: d.legacy && (d.legacy.error || d.legacy.engraved), engrave: d.engrave && (d.engrave.error || !d.engrave.engraved), fallbacks: d.fallbacks }));
    }
    const y = c.x === 'legacy' ? 'engrave' : 'legacy';
    fs.writeFileSync(path.join(OUT, 'svg', c.id + '-X.svg'), d[c.x].svg);
    fs.writeFileSync(path.join(OUT, 'svg', c.id + '-Y.svg'), d[y].svg);
    rows.push({ c: c, X: d[c.x].svg, Y: d[y].svg, bars: d.legacy.bars });
    console.log('  ' + c.id + ' ' + c.stratum.padEnd(40) + ' ' + c.file + ' bars ' + c.bars.join('-'));
  }
  const fallbacks = await page.evaluate(() => window.PPP.engraveStats.fallbacks);
  await browser.close();
  if (Object.keys(fallbacks).length) throw new Error('fallbacks while drawing: ' + JSON.stringify(fallbacks));

  const commit = (() => { try { return require('child_process').execSync('git -C "' + REPO + '" rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch (e) { return null; } })();
  const manifest = {
    review: 'M-H1', doc: 'docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md §22.4', seed: SEED, bars: BARS, width: WIDTH, built: { commit: commit, engrave: version, server: BASE },
    rule: 'R corpus (tests/engrave/corpus.json, no G0 hold-out, not quarantined); per stratum, candidates ordered by sha256(seed:stratum:path), first n unused ' +
      'with at least 8 measures and the feature present; in each, the 8 bars where the feature is densest (earliest on a tie); excerpt order by ' +
      'sha256(seed:order:path); X is the legacy renderer when parseInt(sha256(seed:xy:path)[0..8], 16) is even',
    strata: STRATA.map(s => ({ name: s.name, n: s.n, feature: s.feature, min: s.min || 1 })),
    excerpts: chosen.map(c => ({ id: c.id, stratum: c.stratum, file: c.file, bars: c.bars, counted: c.counted })),
    drawing: 'both by the app\'s ScoreView in one page (renderer prop legacy / engrave), from the same Score (the import door), ' + WIDTH +
      ' px wide, 8 bars 4 to a line, bar numbers on, no note-name letters, nothing lit, on paper; colours written on each shape; classes, ids and data-* removed'
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const blank = () => Object.fromEntries(AXES.map(([k]) => [k, null]));
  const template = { review: 'M-H1', seed: SEED, reviewer: 'role, never a name', date: null, limitation: 'one reviewer (G03 §21.4.5)',
    axes: Object.fromEntries(AXES), excerpts: chosen.map(c => ({ id: c.id, X: blank(), Y: blank(), prefer: null, notes: '' })) };
  fs.writeFileSync(path.join(OUT, 'results-template.json'), JSON.stringify(template, null, 1) + '\n');
  fs.writeFileSync(path.join(KEY, 'key.json'), JSON.stringify({ review: 'M-H1', seed: SEED, commit: commit,
    key: Object.fromEntries(chosen.map(c => [c.id, { X: c.x, Y: c.x === 'legacy' ? 'engrave' : 'legacy', file: c.file, bars: c.bars, stratum: c.stratum }])) }, null, 1) + '\n');

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = ['<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>M-H1 review</title>',
    '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Noto+Music&display=swap" rel="stylesheet">',
    '<style>body{font-family:Figtree,Arial,sans-serif;background:#f6f4f1;color:#1b1a18;margin:0;padding:24px 32px;max-width:1100px}',
    'h2{margin:40px 0 8px;font-size:20px}.v{background:#fffefc;border:1px solid #e6e0d8;border-radius:10px;padding:14px;margin:10px 0}',
    '.v h3{margin:0 0 6px;font-size:15px;color:#5d574f}ol{line-height:1.6}code{background:#eee;padding:1px 4px;border-radius:4px}</style></head><body>',
    '<h1>M-H1 - two drawings of the same music</h1>',
    '<p>Each of the sixteen excerpts below is eight bars of a piece from PPP\'s catalogue, drawn twice, <b>X</b> and <b>Y</b>. The notes are the same; ',
    'only the drawing differs. Which is which is not said, and it changes from one excerpt to the next.</p>',
    '<p>For each version, please answer in <code>results-template.json</code> (one entry per excerpt, X and Y):</p><ol>',
    AXES.map(([k, q]) => '<li><b>' + k + '</b>: ' + esc(q) + '</li>').join(''), '</ol>',
    '<p>and, if you like, which of the two you prefer (<code>prefer</code>: X, Y or same) and a note (a bar number helps).</p>'];
  rows.forEach(r => {
    html.push('<h2>' + r.c.id + '</h2>');
    html.push('<div class="v"><h3>' + r.c.id + ' - X</h3>' + r.X + '</div>');
    html.push('<div class="v"><h3>' + r.c.id + ' - Y</h3>' + r.Y + '</div>');
  });
  html.push('</body></html>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html.join('\n'));
  console.log('\nthe packet: ' + path.relative(REPO, OUT).replace(/\\/g, '/') + '/index.html (' + rows.length + ' excerpts)');
  console.log('the key (not for the reviewer): ' + path.relative(REPO, path.join(KEY, 'key.json')).replace(/\\/g, '/'));
  if (logs.length) console.log('page: ' + logs.slice(0, 5).join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
