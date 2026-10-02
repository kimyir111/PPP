#!/usr/bin/env node
/* Train the hand model of rec/hands.js (G10a-2, stage S4; docs/GOALS/G10 section 8.3 AI-5b).

     python tests/bench/tools/hands_data.py                       # the truth (git-ignored cache)
     node tests/bench/tools/train_hands.js [--data tests/bench/.cache/hands/truth.json] [--out rec/hands-model.json]
                                           [--eval-only] [--report report.json]

   1. Counts: every TRAINING reference (hold-out excluded: fnv1a32(id) % 5 == 0, the benchmark's rule, marked by
      hands_data.py) is walked along its written hands with rec/hands.js's own step(), so the counted events are
      exactly the ones inference scores. Each table becomes -log of its smoothed frequencies (add 0.5), in
      thousandths, rounded: integers, so the JSON is the same on every platform.
   2. Weights: one per table, chosen by coordinate search over a fixed grid, in a fixed order, maximising the mean
      per-reference hand accuracy of the decoded training references (the benchmark's notation.hand.accuracy is a
      per-case mean). Deterministic: no random, no clock; ties keep the earlier value.
   3. Report: training and hold-out accuracy per family, against the legacy split (audio-score.js assignHands,
      reproduced here) on the same onset groups.

   Only aggregate tables leave this script; the note-level data stays in the cache. */
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
function arg(name, dflt) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; }
const dataPath = path.resolve(arg('--data', path.join(repo, 'tests', 'bench', '.cache', 'hands', 'truth.json')));
const outPath = path.resolve(arg('--out', path.join(repo, 'rec', 'hands-model.json')));
const evalOnly = process.argv.includes('--eval-only');
const reportPath = arg('--report', null);

const H = require(path.join(repo, 'rec', 'hands.js'));
const X = H._;

const PARAMS = { beam: 32, dtEdges: [0.15, 0.3, 0.6, 1.2, 2.4] };
const GRID = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const ALPHA = 0.5;

/* ---------------------------------------------------------------- data */
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const pieces = data.pieces.map(p => {
  const notes = p.notes.map(r => ({ midi: r[2], tick: Math.round(r[0] * 1e4), on: r[1], gold: r[3] }));
  const groups = X.groupsOf(notes, {});
  return { id: p.id, set: p.set, book: p.book, holdout: p.holdout, notes: notes, groups: groups,
    family: p.set === 'method' ? p.book : p.set };
});
const train = pieces.filter(p => !p.holdout);

/* ---------------------------------------------------------------- counting */
function goldK(p, g) {
  const lh = g.idx.filter(i => p.notes[i].gold === 2).length;
  /* a group whose written hands cross (a right-hand note below a left-hand one) is no pitch split: not counted */
  const crossing = g.idx.some((i, pos) => (p.notes[i].gold === 2) !== (pos < lh));
  return { k: lh, crossing: crossing };
}
/* The styles: a chorale (four parts on two staves, tenor and bass in the lower staff: the hymnal's convention) and the
   piano. A training reference's style is its collection (hymns are chorales); at inference no label exists: each
   piece is decoded under both and the cheaper path's style is taken (rec/hands.js decodeStyles). */
const STYLES = [{ name: 'piano', of: p => p.set !== 'hymns' }, { name: 'chorale', of: p => p.set === 'hymns' }];
function count(L, list) {
  const counts = new Float64Array(L.size);
  list.forEach(p => {
    let s = X.START;
    p.groups.forEach(g => {
      const gk = goldK(p, g);
      s = X.step(PARAMS, L, s, g, gk.k, gk.crossing ? () => {} : i => { counts[i] += 1; });
    });
  });
  return counts;
}
/* -log of the smoothed frequencies, block by block (each block is one conditional distribution) */
function costsOf(L, counts) {
  const costs = new Array(L.size).fill(0);
  const C1 = X.CAP + 1;
  const block = (start, len) => {
    let tot = 0;
    for (let i = start; i < start + len; i++) tot += counts[i] + ALPHA;
    for (let i = start; i < start + len; i++) costs[i] = Math.round(-1000 * Math.log((counts[i] + ALPHA) / tot));
  };
  for (let s = 0; s < X.SHAPES; s++) block(L.part + s * C1 * C1, C1 * C1);
  for (let h = 0; h < 2; h++) for (let c = 0; c < C1; c++) block(L.span + (h * C1 + c) * 25, 25);
  for (let h = 0; h < 2; h++) for (let b = 0; b < L.NB; b++) block(L.move + (h * L.NB + b) * 121, 121);
  for (let h = 0; h < 2; h++) block(L.reg + h * 128 + 21, 88);
  for (let h = 0; h < 2; h++) for (let m = 0; m < 21; m++) costs[L.reg + h * 128 + m] = costs[L.reg + h * 128 + 21];
  for (let h = 0; h < 2; h++) for (let m = 109; m < 128; m++) costs[L.reg + h * 128 + m] = costs[L.reg + h * 128 + 108];
  block(L.gap, 25);
  for (let h = 0; h < 2; h++) block(L.rel + h * 49, 49);
  /* a hand's first notes: the expected move cost of its longest-rest bucket (neutral: no position to move from) */
  for (let h = 0; h < 2; h++) {
    const start = L.move + (h * L.NB + (L.NB - 1)) * 121;
    let tot = 0, ent = 0;
    for (let i = start; i < start + 121; i++) tot += counts[i] + ALPHA;
    for (let i = start; i < start + 121; i++) { const q = (counts[i] + ALPHA) / tot; ent += -q * Math.log(q); }
    costs[L.first + h] = Math.round(1000 * ent);
  }
  return costs;
}

/* ---------------------------------------------------------------- evaluation */
function accuracy(p, staffOf) {
  let ok = 0;
  p.notes.forEach((n, i) => { if (staffOf[i] === n.gold) ok++; });
  return p.notes.length ? ok / p.notes.length : 0;
}
let lastStyles = null;
function decodeAcc(model, list) {
  const M = X.prepare(model);
  lastStyles = [];
  return list.map(p => {
    const d = X.decodeStyles(M, p.groups);
    lastStyles.push(M.styles[d.style].name);
    const staff = new Array(p.notes.length).fill(0);
    p.groups.forEach((g, gi) => g.idx.forEach((ni, pos) => { staff[ni] = pos < d.ks[gi] ? 2 : 1; }));
    return accuracy(p, staff);
  });
}
function styleConfusion(list, chosen) {
  const out = {};
  list.forEach((p, i) => {
    const truth = STYLES.find(st => st.of(p)).name;
    const k = truth + '->' + chosen[i];
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/* the legacy split (audio-score.js splitCost / centreSplit / assignHands at 2e09fad), on the same groups */
function legacyAcc(p) {
  const groups = p.groups.map(g => ({ notes: g.idx.map(i => ({ midi: p.notes[i].midi, i: i })) }));
  const splitCost = (g, s) => {
    let rLo = 999, rHi = -1, lLo = 999, lHi = -1, nr = 0, nl = 0;
    g.notes.forEach(n => {
      if (n.midi >= s) { nr++; rLo = Math.min(rLo, n.midi); rHi = Math.max(rHi, n.midi); }
      else { nl++; lLo = Math.min(lLo, n.midi); lHi = Math.max(lHi, n.midi); }
    });
    const over = span => (span > 12 ? (span - 12) * 1.5 : 0);
    let c = (nr ? over(rHi - rLo) : 0) + (nl ? over(lHi - lLo) : 0);
    if (nr > 5) c += (nr - 5) * 2;
    if (nl > 5) c += (nl - 5) * 2;
    if (nr && nl) c += 0.5 * Math.max(0, 7 - (rLo - lHi)) / 7;
    return c;
  };
  let centre = 60, bestCost = Infinity;
  for (let s = 48; s <= 72; s++) {
    let c = 0;
    groups.forEach(g => { c += splitCost(g, s); });
    c += 0.001 * Math.abs(s - 60);
    if (c < bestCost) { bestCost = c; centre = s; }
  }
  const S0 = 36, S1 = 84, NS = S1 - S0 + 1;
  const local = (g, s) => splitCost(g, s) + 0.004 * Math.abs(s - centre);
  let cost = new Float64Array(NS);
  const prevArg = [];
  for (let i = 0; i < NS; i++) cost[i] = local(groups[0], S0 + i);
  for (let gi = 1; gi < groups.length; gi++) {
    const next = new Float64Array(NS), argm = new Int16Array(NS);
    for (let i = 0; i < NS; i++) {
      let best = Infinity, bi = 0;
      for (let j = 0; j < NS; j++) { const v = cost[j] + 0.08 * Math.abs(i - j); if (v < best) { best = v; bi = j; } }
      next[i] = best + local(groups[gi], S0 + i);
      argm[i] = bi;
    }
    prevArg.push(argm);
    cost = next;
  }
  let at = 0;
  for (let k = 1; k < NS; k++) if (cost[k] < cost[at]) at = k;
  const staff = new Array(p.notes.length).fill(0);
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const s = S0 + at;
    groups[gi].notes.forEach(n => { staff[n.i] = n.midi >= s ? 1 : 2; });
    if (gi > 0) at = prevArg[gi - 1][at];
  }
  return accuracy(p, staff);
}

function familyTable(list, accs, legacy) {
  const fam = {};
  list.forEach((p, i) => {
    const f = fam[p.family] = fam[p.family] || { n: 0, v2: 0, legacy: 0, v2gate: 0, legacyGate: 0 };
    f.n++; f.v2 += accs[i]; f.legacy += legacy[i];
    f.v2gate += accs[i] >= 0.8 ? 1 : 0; f.legacyGate += legacy[i] >= 0.8 ? 1 : 0;
  });
  const out = {};
  Object.keys(fam).sort().forEach(k => {
    const f = fam[k];
    out[k] = { n: f.n, legacy: +(f.legacy / f.n).toFixed(4), v2: +(f.v2 / f.n).toFixed(4),
      legacyGate: +(f.legacyGate / f.n).toFixed(4), v2Gate: +(f.v2gate / f.n).toFixed(4) };
  });
  return out;
}

/* ---------------------------------------------------------------- main */
const L = X.layout(PARAMS);
let model;
if (evalOnly) {
  model = JSON.parse(fs.readFileSync(outPath, 'utf8'));
} else {
  const styles = STYLES.map(st => ({ name: st.name, references: train.filter(st.of).length, costs: costsOf(L, count(L, train.filter(st.of))) }));
  const weights = {};
  X.TABLES.forEach(t => { weights[t] = 1; });
  const make = w => ({ schema: H.SCHEMA, version: 'hands-v1', params: PARAMS, weights: Object.assign({}, w), styles: styles });
  let best = mean(decodeAcc(make(weights), train));
  process.stderr.write('start (all weights 1): train mean ' + best.toFixed(5) + '\n');
  const order = ['part', 'move', 'span', 'reg', 'gap', 'rel', 'first'];
  for (let round = 0; round < 3; round++) {
    let moved = false;
    order.forEach(t => {
      const keep = weights[t];
      let bestV = keep;
      GRID.forEach(v => {
        if (v === keep) return;
        weights[t] = v;
        const a = mean(decodeAcc(make(weights), train));
        if (a > best + 1e-9) { best = a; bestV = v; }
      });
      weights[t] = bestV;
      if (bestV !== keep) moved = true;
      process.stderr.write('round ' + round + ' ' + t + ' = ' + bestV + ': train mean ' + best.toFixed(5) + '\n');
    });
    if (!moved) break;
  }
  const trained = { data: 'tests/bench/tools/hands_data.py (registered licence-clean references, two staves; hold-out excluded)',
    references: train.length, notes: train.reduce((s, p) => s + p.notes.length, 0), objective: 'mean per-reference hand accuracy',
    grid: GRID, smoothing: ALPHA };
  model = { schema: H.SCHEMA, version: 'hands-v1', trained: trained, params: PARAMS, weights: weights, styles: styles };
  fs.writeFileSync(outPath, JSON.stringify(model) + '\n');
  process.stderr.write('wrote ' + path.relative(repo, outPath) + '\n');
}
const trainAcc = decodeAcc(model, train), trainStyles = lastStyles, trainLegacy = train.map(legacyAcc);
const hold = pieces.filter(p => p.holdout);
const holdAcc = decodeAcc(model, hold), holdStyles = lastStyles, holdLegacy = hold.map(legacyAcc);
const report = {
  model: model.version, weights: model.weights,
  train: { n: train.length, legacy: +mean(trainLegacy).toFixed(4), v2: +mean(trainAcc).toFixed(4), styles: styleConfusion(train, trainStyles),
    families: familyTable(train, trainAcc, trainLegacy) },
  holdout: { n: hold.length, legacy: +mean(holdLegacy).toFixed(4), v2: +mean(holdAcc).toFixed(4), styles: styleConfusion(hold, holdStyles),
    families: familyTable(hold, holdAcc, holdLegacy) }
};
console.log(JSON.stringify(report, null, 1));
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
