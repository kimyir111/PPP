#!/usr/bin/env node
/* Train the hand model of rec/hands.js (G10a-2, stage S4; docs/GOALS/G10 section 8.3 AI-5b; playability G10a-2b, section 26).

     python tests/bench/tools/hands_data.py                                   # the truth (git-ignored cache), textures included
     python tests/bench/tools/hands_data.py --perfs tests/bench/.cache/hands/perfs.jsonl   # humanized performances, seed 201
     node tests/bench/tools/train_hands.js [--out rec/weights/hands-v1.json] [--eval-out rec/tools/hands-v1.evaluation.json]
                                           [--eval-only] [--tune truth|perfs|both] [--no-perfs] [--recapture]
     node tests/bench/tools/train_hands.js --check      # CI: the committed weights and evaluation are what training makes

   1. Counts: every TRAINING reference (hold-out excluded: fnv1a32(id) % 5 == 0, the benchmark's rule) is walked along
      its written hands with rec/hands.js's own step(), so the counted events are exactly the ones inference scores. Each
      table becomes -log of its smoothed frequencies (add 0.5), in thousandths, rounded: integers, so the JSON is the
      same on every platform. One set of tables per style (piano: every collection but the hymns; chorale: the hymns).
      G10a-2b (section 26): the partition table is counted per context class of a group (params.ctx: a note far below
      or above within half a second, hand-free). The references re-voiced as piano covers are (hands_data.py,
      pppbench/texture.py: single notes doubled in octaves, hands kept) are evaluated, never counted: counted into the
      tables (all of them, three of them, or a second set for octave groups) they took the unison exercises' octaves into
      one hand on performances (section 26.5).
   2. The onset groups S4 really receives: each training performance (hands_data.py --perfs: the calibrated humanizer's
      families at seed 201, which no suite uses) goes through audio-score.js toMusicXml with the recording conversion v2
      (the app's options + recording 'v2'); S4's input (the quantized notes) is read where audio-score.js hands it to
      rec/index.js's S4 (a require-cache stand-in for rec/index.js in THIS process only; no production code is
      changed for it) and every heard note is labelled with its written hand (0: a note the AMT or the performer added,
      not scored). Cached in tests/bench/.cache/hands/pipeline.json (--recapture rebuilds it). The textured performances
      (cover and cover+of of the three textures) are reported apart.
   3. Weights: one per table, chosen by coordinate search over a fixed grid, in a fixed order, maximising the mean
      per-reference hand accuracy on the truth groups of the training references as written (--tune perfs|both: on S4's
      real input, or the mean of the two means; measured and not used, see `tune` below). The benchmark's notation.hand.accuracy is a per-case mean. Deterministic: no random, no clock; ties keep
      the earlier value; the decoding is spread over worker threads and put back in piece order.
      The hard term (params.play) is not learned: it is the G5a analyzer's own hard violations (playability/reach.js:
      MAX_KEYS, the medium hand's reach, PER_SEMITONE_S), a hand's span capped at the widest hand any training reference
      writes, at a cost no table cell reaches.
   4. Evaluation (rec/tools/hands-v1.evaluation.json): training and hold-out accuracy per family, against the legacy
      split (audio-score.js assignHands, reproduced here) on the same onset groups, for the references as written and for
      each texture; the G5a hard violations per 100 onset groups of the written hands, the legacy split and S4; the same
      on S4's real input when the performances are in the cache. --check retrains from the truth (hands_data.py must have
      run) and requires the weights file and the truth part of the evaluation to be the committed ones, byte for byte (the
      performance part depends on S2/S3, which other phases change, and is not checked).

   Only aggregate tables leave this script; the note-level data stays in the cache. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const repo = path.resolve(__dirname, '..', '..', '..');
function arg(name, dflt) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; }
const checkMode = process.argv.includes('--check');
const cacheDir = path.join(repo, 'tests', 'bench', '.cache', 'hands');
const dataPath = path.resolve(arg('--data', path.join(cacheDir, 'truth.json')));
const perfsPath = path.resolve(arg('--perfs', path.join(cacheDir, 'perfs.jsonl')));
const usePerfs = !checkMode && !process.argv.includes('--no-perfs') && fs.existsSync(perfsPath);
/* the weights are fitted on the truth by default; S4's real input (the performances) is reported, not fitted: it carries
   today's grid (S3) and skeleton (S2) artifacts, which later phases change (G10a-2 record: tuned on both, the mean hand
   accuracy on rec-core and rec-robust was the same, 0.9706 against 0.9703, and 7 fewer cases passed the hands gate) */
const tune = arg('--tune', 'truth');
const outPath = path.resolve(arg('--out', path.join(repo, 'rec', 'weights', 'hands-v1.json')));
const evalOnly = process.argv.includes('--eval-only');
const evalPath = path.resolve(arg('--eval-out', path.join(repo, 'rec', 'tools', 'hands-v1.evaluation.json')));

const H = require(path.join(repo, 'rec', 'hands.js'));
const X = H._;
const REACH = require(path.join(repo, 'playability', 'reach.js'));

/* A worker thread decodes its share of the pieces for each set of weights the main thread sends (the pieces and
   the tables are sent once); the main thread puts the accuracies back in piece order, so the result is the same
   whatever the number of threads. */
if (!isMainThread) {
  const list = workerData.pieces.map(p => ({ notes: p.notes, groups: X.groupsOf(p.notes, {}) }));
  parentPort.on('message', m => {
    const M = X.prepare({ schema: H.SCHEMA, params: workerData.params, weights: m.weights, styles: workerData.styles });
    parentPort.postMessage(list.map(p => {
      const d = X.decodeStyles(M, p.groups);
      let ok = 0, n = 0;
      p.groups.forEach((g, gi) => g.idx.forEach((ni, pos) => {
        const gold = p.notes[ni].gold;
        if (gold === 1 || gold === 2) { n++; if ((pos < d.ks[gi] ? 2 : 1) === gold) ok++; }
      }));
      return n ? ok / n : 0;
    }));
  });
  return;
}

const GRID = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const ALPHA = 0.5;
/* the textures (pppbench/texture.py, written by hands_data.py), reported (G10a-2b, section 26): the left hand's single
   notes doubled, the right hand's, both */
const TEXTURES = ['octaves-l', 'octaves-r', 'octaves'];
/* G5a's hard violations at the medium hand (playability/analyze.js, reach.js): what the evaluation counts */
const G5A = { span: REACH.MAX_SPAN.medium, keys: REACH.MAX_KEYS, reach: REACH.MAX_SPAN.medium, perSemi: REACH.PER_SEMITONE_S };

/* ---------------------------------------------------------------- data */
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const pieces = data.pieces.map(p => {
  const notes = p.notes.map(r => ({ midi: r[2], tick: Math.round(r[0] * 1e4), on: r[1], gold: r[3] }));
  const groups = X.groupsOf(notes, {});
  return { id: p.id, set: p.set, book: p.book, holdout: p.holdout, texture: p.texture || null, notes: notes, groups: groups,
    family: p.set === 'method' ? p.book : p.set };
});
const plain = pieces.filter(p => !p.texture);
const train = plain.filter(p => !p.holdout);
const hold = plain.filter(p => p.holdout);
const textured = name => pieces.filter(p => p.texture === name);

/* the widest hand any training reference writes: S4 never writes a wider one (the hymnal's left hand passes G5a's medium
   octave; nothing in the catalogue is wider than this) */
function widestHand(list) {
  let w = 0;
  list.forEach(p => p.groups.forEach(g => [1, 2].forEach(h => {
    const ms = g.idx.filter(i => p.notes[i].gold === h).map(i => p.notes[i].midi);
    if (ms.length > 1) w = Math.max(w, Math.max.apply(null, ms) - Math.min.apply(null, ms));
  })));
  return w;
}
const PARAMS = { beam: 32, dtEdges: [0.15, 0.3, 0.6, 1.2, 2.4], ctx: { w: 0.5, d: 12 },
  play: { w: 50, span: widestHand(train), keys: G5A.keys, reach: G5A.reach, perSemi: G5A.perSemi } };

/* S4's real input on the training performances (step 2 above) */
function pipelinePieces() {
  const cachePath = path.join(cacheDir, 'pipeline.json');
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= fs.statSync(perfsPath).mtimeMs && !process.argv.includes('--recapture'))
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const idx = require.resolve(path.join(repo, 'rec', 'index.js'));
  const real = require(idx);
  let cap = null;
  const stand = Object.assign({}, real, { hands: Object.assign({}, real.hands, { assignQ: q => {
    cap = q.map(n => ({ midi: n.midi, tick: n.tick, attack: n.attack, on: n.on }));
    q.forEach(n => { if (!n.staff) n.staff = 1; });
    return { staff: [], conf: [], report: {} };
  } }) });
  require.cache[idx].exports = stand;
  const A = require(path.join(repo, 'audio-score.js'));
  const out = [];
  fs.readFileSync(perfsPath, 'utf8').split('\n').filter(Boolean).forEach(line => {
    const r = JSON.parse(line);
    cap = null;
    try { A.toMusicXml(r.input, Object.assign({ closeGaps: true, exactBars: true, recording: 'v2' }, r.input.beats ? { recBeats: 'oracle' } : {})); } catch (e) { cap = null; }
    if (!cap) return;                                   /* the legacy path ran (no v2 skeleton): S4 v2 never sees it */
    const byKey = new Map();
    r.input.notes.forEach((n, i) => {
      const k = n.midi + '|' + Math.max(0, n.on);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r.hands[i]);
    });
    const notes = cap.map(n => {
      const list = byKey.get(n.midi + '|' + n.on);
      return [n.midi, n.tick, n.attack != null ? n.attack : n.on, list && list.length ? list.shift() : 0];
    });
    out.push(Object.assign({ id: r.id, ref: r.ref, set: r.set, book: r.book, notes: notes }, r.texture ? { texture: r.texture } : {}));
  });
  fs.writeFileSync(cachePath, JSON.stringify(out));
  return out;
}
const perfAll = usePerfs ? pipelinePieces().map(p => {
  const notes = p.notes.map(r => ({ midi: r[0], tick: r[1], attack: r[2], gold: r[3] }));
  return { id: p.id, set: p.set, book: p.book, holdout: false, texture: p.texture || null, notes: notes, groups: X.groupsOf(notes, {}),
    family: p.set === 'method' ? p.book : p.set };
}) : [];
const perfPieces = perfAll.filter(p => !p.texture);
const perfTex = perfAll.filter(p => p.texture);

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
    X.contextOf(p.groups, PARAMS);
    let s = X.startOf(p.groups);
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
  const shapes = X.SHAPES * (PARAMS.ctx ? X.CONTEXTS : 1);         /* params.ctx: one partition block per shape and context */
  for (let s = 0; s < shapes; s++) block(L.part + s * C1 * C1, C1 * C1);
  for (let h = 0; h < 2; h++) for (let c = 0; c < C1; c++) block(L.span + (h * C1 + c) * 25, 25);
  for (let h = 0; h < 2; h++) for (let b = 0; b < L.NB; b++) block(L.move + (h * L.NB + b) * 121, 121);
  for (let h = 0; h < 2; h++) block(L.reg + h * 128 + 21, 88);
  for (let h = 0; h < 2; h++) for (let m = 0; m < 21; m++) costs[L.reg + h * 128 + m] = costs[L.reg + h * 128 + 21];
  for (let h = 0; h < 2; h++) for (let m = 109; m < 128; m++) costs[L.reg + h * 128 + m] = costs[L.reg + h * 128 + 108];
  block(L.gap, 25);
  for (let h = 0; h < 2; h++) block(L.rel + h * 49, 49);
  for (let h = 0; h < 2; h++) for (let c = 0; c < C1; c++) block(L.cnt + (h * C1 + c) * C1, C1);
  for (let h = 0; h < 2; h++) block(L.ioi + h * X.IOI_N, X.IOI_N);
  return costs;
}

/* ---------------------------------------------------------------- evaluation */
function accuracy(p, staffOf) {
  let ok = 0, n = 0;
  p.notes.forEach((x, i) => { if (x.gold === 1 || x.gold === 2) { n++; if (staffOf[i] === x.gold) ok++; } });
  return n ? ok / n : 0;
}
/* the G5a hard violations (medium hand) of a split given as k per group, walked with step()'s states */
function hardCount(p, ks) {
  const Pq = { beam: 32, dtEdges: PARAMS.dtEdges };
  const Lq = X.layout(Pq);
  let s = X.startOf(p.groups), v = 0;
  p.groups.forEach((g, gi) => { v += X.hardOf(G5A, s, g, ks[gi]); s = X.step(Pq, Lq, s, g, ks[gi], () => {}); });
  return v;
}
let lastStyles = null, lastHard = null;
function decodeAcc(model, list) {
  const M = X.prepare(model);
  lastStyles = [];
  lastHard = [];
  return list.map(p => {
    const d = X.decodeStyles(M, p.groups);
    lastStyles.push(M.styles[d.style].name);
    lastHard.push(hardCount(p, d.ks));
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
const sum = xs => xs.reduce((a, b) => a + b, 0);

/* the legacy split (audio-score.js splitCost / centreSplit / assignHands at 2e09fad), on the same groups: its accuracy,
   and (lastLegacyHard) its G5a hard violations */
let lastLegacyHard = 0;
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
  const ks = new Array(groups.length);
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const s = S0 + at;
    ks[gi] = 0;
    groups[gi].notes.forEach(n => { staff[n.i] = n.midi >= s ? 1 : 2; if (n.midi < s) ks[gi]++; });
    if (gi > 0) at = prevArg[gi - 1][at];
  }
  lastLegacyHard = hardCount(p, ks);
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
/* accuracy and G5a hard violations (per 100 onset groups: the written hands, the legacy split, S4) of a list */
function evaluate(model, list, withFamilies, withStyles) {
  const acc = decodeAcc(model, list), styles = lastStyles, hard = lastHard;
  const legacy = [], legacyHard = [];
  list.forEach(p => { legacy.push(legacyAcc(p)); legacyHard.push(lastLegacyHard); });
  const groups = sum(list.map(p => p.groups.length));
  const truthHard = sum(list.map(p => hardCount(p, p.groups.map(g => goldK(p, g).k))));
  const per100 = v => +(100 * v / Math.max(1, groups)).toFixed(3);
  const out = { n: list.length, legacy: +mean(legacy).toFixed(4), v2: +mean(acc).toFixed(4) };
  if (withStyles) out.styles = styleConfusion(list, styles);
  if (withFamilies) out.families = familyTable(list, acc, legacy);
  out.hardPer100Groups = { written: per100(truthHard), legacy: per100(sum(legacyHard)), v2: per100(sum(hard)) };
  return out;
}

/* ---------------------------------------------------------------- the worker pool */
function makePool(list, styles) {
  const n = Math.max(1, Math.min(8, (os.cpus() || []).length - 1));
  const shares = [];
  for (let w = 0; w < n; w++) shares.push([]);
  list.forEach((p, i) => shares[i % n].push(i));
  const workers = shares.map(ix => new Worker(__filename, { workerData: { params: PARAMS, styles: styles,
    pieces: ix.map(i => ({ notes: list[i].notes })) } }));
  return {
    run: weights => Promise.all(workers.map(w => new Promise(res => { w.once('message', res); w.postMessage({ weights: weights }); })))
      .then(parts => {
        const out = new Array(list.length);
        parts.forEach((accs, w) => accs.forEach((a, j) => { out[shares[w][j]] = a; }));
        return out;
      }),
    close: () => workers.forEach(w => w.terminate())
  };
}

/* ---------------------------------------------------------------- main */
(async function main() {
const L = X.layout(PARAMS);
let model;
if (evalOnly) {
  model = JSON.parse(fs.readFileSync(outPath, 'utf8'));
} else {
  const styles = STYLES.map(st => ({ name: st.name, references: train.filter(st.of).length, costs: costsOf(L, count(L, train.filter(st.of))) }));
  const weights = {};
  X.TABLES.forEach(t => { weights[t] = 1; });
  const make = w => ({ schema: H.SCHEMA, version: 'hands-v1.1', params: PARAMS, weights: Object.assign({}, w), styles: styles });
  const pool = makePool(tune === 'truth' ? train : tune === 'perfs' ? perfPieces : train.concat(perfPieces), styles);
  const objective = async m => {
    const acc = await pool.run(m.weights);
    const a = acc.slice(0, tune === 'perfs' ? 0 : train.length), b = acc.slice(tune === 'perfs' ? 0 : train.length);
    return tune === 'truth' ? mean(a) : tune === 'perfs' ? mean(b) : (mean(a) + mean(b)) / 2;
  };
  let best = await objective(make(weights));
  process.stderr.write('tune on ' + tune + '; start (all weights 1): ' + best.toFixed(5) + '\n');
  const order = ['part', 'move', 'span', 'reg', 'gap', 'rel', 'cnt', 'ioi'];
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const t of order) {
      const keep = weights[t];
      let bestV = keep;
      for (const v of GRID) {
        if (v === keep) continue;
        weights[t] = v;
        const a = await objective(make(weights));
        if (a > best + 1e-9) { best = a; bestV = v; }
      }
      weights[t] = bestV;
      if (bestV !== keep) moved = true;
      process.stderr.write('round ' + round + ' ' + t + ' = ' + bestV + ': ' + best.toFixed(5) + '\n');
    }
    if (!moved) break;
  }
  pool.close();
  const trained = { data: 'tests/bench/tools/hands_data.py (the lint-clean licence-clean references with two staves; hold-out excluded)',
    references: train.length, notes: train.reduce((s, p) => s + p.notes.length, 0),
    textures: { evaluated: TEXTURES, counted: [] },
    objective: tune === 'both' ? 'mean of the per-reference (truth) and per-performance (S4 input) mean hand accuracies' : 'mean hand accuracy on ' + tune,
    grid: GRID, smoothing: ALPHA, play: 'G5a hard violations (playability/reach.js: MAX_KEYS, MAX_SPAN.medium as reach, PER_SEMITONE_S), span = the widest written hand of the training references' };
  model = { schema: H.SCHEMA, version: 'hands-v1.1', trained: trained, params: PARAMS, weights: weights, styles: styles };
  const text = JSON.stringify(model) + '\n';
  if (checkMode) {
    const same = fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') === text;
    process.stderr.write((same ? 'same ' : 'DIFFERS ') + path.relative(repo, outPath) + '\n');
    if (!same) process.exitCode = 1;
  } else {
    fs.writeFileSync(outPath, text);
    process.stderr.write('wrote ' + path.relative(repo, outPath) + '\n');
  }
}
const report = {
  model: model.version, weights: model.weights, tune: tune,
  train: evaluate(model, train, true, true),
  holdout: evaluate(model, hold, true, true),
  textures: {}
};
TEXTURES.forEach(name => {
  const list = textured(name);
  report.textures[name] = { train: evaluate(model, list.filter(p => !p.holdout), false, false),
    holdout: evaluate(model, list.filter(p => p.holdout), true, false) };
});
const truthText = JSON.stringify(report, null, 1);
if (perfPieces.length) {
  const acc = decodeAcc(model, perfPieces), legacy = perfPieces.map(legacyAcc);
  report.perfs = { n: perfPieces.length, seeds: [201], role: tune === 'truth' ? 'evaluated, not fitted' : 'fitted',
    pipeline: 'audio-score.js toMusicXml, closeGaps + exactBars + recording v2 (S4 input)', legacy: +mean(legacy).toFixed(4),
    v2: +mean(acc).toFixed(4), families: familyTable(perfPieces, acc, legacy) };
}
if (perfTex.length) {
  report.perfsTextures = {};
  TEXTURES.forEach(name => {
    const list = perfTex.filter(p => p.texture === name);
    if (!list.length) return;
    const acc = decodeAcc(model, list), hard = lastHard, legacy = [], legacyHard = [];
    list.forEach(p => { legacy.push(legacyAcc(p)); legacyHard.push(lastLegacyHard); });
    const groups = sum(list.map(p => p.groups.length));
    report.perfsTextures[name] = { n: list.length, legacy: +mean(legacy).toFixed(4), v2: +mean(acc).toFixed(4),
      hardPer100Groups: { legacy: +(100 * sum(legacyHard) / groups).toFixed(3), v2: +(100 * sum(hard) / groups).toFixed(3) } };
  });
}
console.log(JSON.stringify(report, null, 1));
if (checkMode) {
  const have = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  delete have.perfs;
  delete have.perfsTextures;
  const same = JSON.stringify(have, null, 1) === truthText;
  process.stderr.write((same ? 'same ' : 'DIFFERS ') + path.relative(repo, evalPath) + ' (truth part)\n');
  if (!same) process.exitCode = 1;
} else if (!evalOnly) {
  fs.writeFileSync(evalPath, JSON.stringify(report, null, 1) + '\n');
  process.stderr.write('wrote ' + path.relative(repo, evalPath) + '\n');
}
})();
