#!/usr/bin/env node
/* G6a performance (docs/GOALS/G06_DIFFICULTY.md §7: "<= 20 ms per piece given G5's report", to be confirmed or
   corrected once measured). Times, per piece, warm (median of RUNS):
     attacks   playability/graph.js attacksOf - G5's own input, shared with anything else that reads the graph
     g5        G5's analyzer + fingering DP, run by featuresOf on the key-normalised attacks (features.js header,
               property 3) - G6's own call of G5, which a caller's G5 report on the printed key cannot replace
     g6        the rest of featuresOf: G6's own features and the per-measure map
     predict   difficulty/model.js predict: inference, level, reasons, hotspots
   over every non-hold-out registered method piece, plus sonatina/020 (the longest piece in the method catalogue,
   1,401 attacks; L8-excluded from the registry, so never trained on, but a real score the app opens).

     node difficulty/tools/perf.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const PL = require(path.join(REPO, 'playability', 'index.js'));
const D = require(path.join(REPO, 'difficulty', 'index.js'));
const RUNS = 5;

function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function time(fn) { const xs = []; let out; for (let i = 0; i < RUNS; i++) { const t = performance.now(); out = fn(); xs.push(performance.now() - t); } return { ms: median(xs), out: out }; }

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset', 'method-books.json'), 'utf8'));
  const W = JSON.parse(fs.readFileSync(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'), 'utf8'));
  const rels = data.records.filter(r => !r.holdout).map(r => 'catalog/method/' + r.book + '/' + String(r.no).padStart(3, '0') + '.mxl')
    .concat(['catalog/method/sonatina/020.mxl']);
  const rows = [];
  for (const rel of rels) {
    const imp = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'g6a-perf' });
    const g = imp.graph;
    const a = time(() => PL.graph.attacksOf(g));
    const shift = D.features.keyShift(g);
    const shifted = a.out.map(x => Object.assign({}, x, { midis: x.midis.map(m => m + shift), heads: x.heads.map(h => Object.assign({}, h, { midi: h.midi + shift })) }));
    const g5 = time(() => {
      PL.analyze(shifted, { profile: 'medium' });
      ['RH', 'LH'].forEach(limb => { const evs = PL.fingering.eventsForHand(shifted.filter(x => x.limb === limb)); PL.fingering.solveHand(evs, limb === 'RH' ? 'r' : 'l'); });
    });
    const f = time(() => D.features.featuresOf(g, { attacks: a.out }));
    const p = time(() => D.model.predict(f.out, W));
    rows.push({ rel: rel, attacks: a.out.length, tAttacks: a.ms, tG5: g5.ms, tG6: Math.max(0, f.ms - g5.ms), tFeatures: f.ms, tPredict: p.ms });
  }
  const stat = k => { const xs = rows.map(r => r[k]); return { median: +median(xs).toFixed(2), p95: +xs.slice().sort((x, y) => x - y)[Math.floor(0.95 * xs.length)].toFixed(2), max: +Math.max.apply(null, xs).toFixed(2) }; };
  console.log('pieces', rows.length, '(non-hold-out registered method pieces + sonatina/020), ms, warm median of', RUNS);
  ['tAttacks', 'tG5', 'tG6', 'tFeatures', 'tPredict'].forEach(k => console.log(k.padEnd(10), JSON.stringify(stat(k))));
  const longest = rows.slice().sort((x, y) => y.attacks - x.attacks).slice(0, 3);
  longest.forEach(r => console.log('longest:', r.rel, r.attacks, 'attacks', JSON.stringify({ attacks: +r.tAttacks.toFixed(1), g5: +r.tG5.toFixed(1), g6: +r.tG6.toFixed(1), predict: +r.tPredict.toFixed(2) })));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
