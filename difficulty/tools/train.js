#!/usr/bin/env node
/* G6a: train the difficulty ranker, and measure it against the app's legacy heuristic by leave-one-book-out
   (docs/GOALS/G06_DIFFICULTY.md §3(b), §4, §5).

     node difficulty/tools/train.js --legacy-only   the legacy baseline alone, on the leave-one-book-out pairs
     node difficulty/tools/train.js                 + the model's leave-one-book-out evaluation (no hold-out)
     node difficulty/tools/train.js --holdout       + the final model on the registry's hold-out files
     node difficulty/tools/train.js --write         write difficulty/weights/g6a-v1.json and
                                                    difficulty/tools/dataset/g6a-v1.evaluation.json (add
                                                    --holdout to include the one hold-out test)
     node difficulty/tools/train.js --check         exit 1 if the committed weights/evaluation are not what
                                                    this computes from the committed dataset

   Reads difficulty/tools/dataset/method-books.json (build-dataset.js). Node only, no dependency: the model is
   small enough that numpy would buy nothing, and training here means every evaluation scores pieces through
   the SAME inference code that ships (difficulty/model.js scoreOf) - no second implementation to drift.
   Deterministic: no random initialisation, a fixed number of iterations, a seeded bootstrap.

   ---- Pairs: only what course.js claims (build-dataset.js header) ----
   b is harder than a when a's stage < b's stage (any two books with a stage), or when a and b are in the
   same book and a's order < b's order. Nothing else: two books of the same stage (czerny599 and
   burgmuller25, "alongside") are never ordered against each other, hanon (no stage, no order) never enters
   a pair, and neither do Kuhlau/Beethoven movements against each other.

   ---- Leave-one-book-out (G06 §4) ----
   A fold holds out one PATH book B that has data (czerny299 has none: all ten files are P1-quarantined, so
   there are three folds, not four). It trains on every labelled, non-hold-out piece EXCEPT book B and the
   side-books of B's own stage (burgmuller25 is studied alongside czerny599: training on it would tell the
   model where stage 2 sits, which is what the fold is testing). It is tested on the pairs that involve B:
     within     two pieces of B, by B's own order - neither piece was seen in training;
     crossMain  a piece of B against a piece of another PATH book, by stage;
     crossSide  a piece of B against a side-book of another stage, by stage (reported, not primary).
   primary = within + crossMain. Hold-out files are in no fold, train or test: they are kept for one final
   test of the final model (--holdout), so no development choice ever looked at them.

   ---- The legacy baseline, measured the same way ----
   The legacy code ranks sections inside one piece, not pieces (tests/difficulty/legacy-difficulty-extract.js;
   build-dataset.js legacyOf), so each way of reading a piece order out of it is scored on exactly the same
   pairs, and the best of them is the bar. Legacy needs no training, so it cannot leak.

   ---- The model ----
   Pairwise logistic loss over the training pairs, L2 penalty LAMBDA, weights constrained to w >= 0
   (difficulty/model.js header), solved by projected accelerated gradient (FISTA) with step 1/L. Within-book
   and cross-stage pairs carry equal total weight (cross-stage pairs outnumber within-book ones about 3:1 and
   are the easier kind; left alone they would decide the fit). LAMBDA and that balance were fixed before any
   model was evaluated and are not tuned on these folds; the sensitivity table is reported, not selected on. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const M = require(path.join(REPO, 'difficulty', 'model.js'));
require(path.join(REPO, 'course.js'));
const COURSE = globalThis.PPP_COURSE;

const DATASET = path.join(__dirname, 'dataset', 'method-books.json');
const WEIGHTS = path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json');
const EVALUATION = path.join(__dirname, 'dataset', 'g6a-v1.evaluation.json');

const WEIGHTS_VERSION = '1.0.0';
const LAMBDA = 0.01;
const ITERS = 3000;
const BOOTSTRAP = 2000;
const SEED = 20260928;
/* The acceptance bar, fixed after the legacy-only run (best legacy reading: sectionMax, 89.5% pooled primary
   accuracy) and before the first model run (G06 §5; §11 records the order this was done in):
     1. pooled primary accuracy >= best legacy reading + MARGIN (2.0 points: about a fifth of legacy's errors);
     2. the piece-level bootstrap's 95% interval for (model - best legacy) lies above zero;
     3. no fold's primary accuracy is more than FOLD_TOLERANCE below that legacy reading's on the same fold
        (so a regressed book cannot hide inside the pooled number). */
const MARGIN = 0.02;
const FOLD_TOLERANCE = 0.01;

const LEGACY = ['sectionMax', 'sectionMean', 'whole', 'structuralMax', 'structuralTraits', 'hardShare'];
const PATH_BOOKS = COURSE.PATH.map(s => s.book);
/* The ranker's inputs: every features.js feature except `length`. features.js still measures length (G06 §3(a)
   lists it) and reports it; the ranker leaves it out because in this corpus it is a book proxy, not a
   difficulty: within the main books it orders pieces at chance (beyer 52%, czerny599 42%, czerny849 55%), and
   the two longest pieces in the course are its two easiest (Beyer 1 and 2, 104 and 144 bars of a one-line
   pupil's part), which the first model placed near the top of Beyer on length alone (§11, the development
   log). */
const RANKER_EXCLUDES = ['length'];
/* Training labels for the side books: their own within-book order only, no stage. course.js's chooseWithPath
   fills the "side" slot only when it is free (`if (!s.side)`), so a pupil moving on to czerny849 keeps
   burgmuller25 beside it: "studied alongside stage 2" is a much weaker ordinal claim than the main path's
   strict book-after-book order, and the model is not trained to assert it. Evaluation still reports the side
   books against the held-out book by stage (crossSide), as a secondary number. */
const SIDE_STAGE_IN_TRAINING = false;
function trainingView(records) {
  if (SIDE_STAGE_IN_TRAINING) return records;
  return records.map(r => (PATH_BOOKS.includes(r.book) || r.stage == null ? r : Object.assign({}, r, { stage: null })));
}

/* ------------------------------------------------------------- pairs */
function relation(a, b) {
  if (a.stage != null && b.stage != null && a.stage !== b.stage) return { sign: Math.sign(b.stage - a.stage), kind: 'cross' };
  if (a.book === b.book && a.order != null && b.order != null && a.order !== b.order) return { sign: Math.sign(b.order - a.order), kind: 'within' };
  return null;
}
/* [{easy, hard, kind}] over every labelled pair in `records` (indices into records) */
function pairsAmong(records) {
  const out = [];
  for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
    const r = relation(records[i], records[j]);
    if (!r) continue;
    out.push(r.sign > 0 ? { easy: i, hard: j, kind: r.kind } : { easy: j, hard: i, kind: r.kind });
  }
  return out;
}
function isLabelled(r) { return r.stage != null || r.order != null; }

/* ------------------------------------------------------------- metrics */
/* pairs: [{easy, hard, kind, w?}] over one record list; score: index -> number. Ties count half. */
function accuracy(pairs, score) {
  let ok = 0, n = 0;
  pairs.forEach(p => {
    const w = p.w == null ? 1 : p.w;
    const d = score[p.hard] - score[p.easy];
    ok += w * (d > 0 ? 1 : d === 0 ? 0.5 : 0);
    n += w;
  });
  return n ? ok / n : null;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- the model */
function standardizer(records, names) {
  const n = records.length;
  const mean = names.map(k => records.reduce((s, r) => s + r.features[k], 0) / n);
  const std = names.map((k, i) => Math.sqrt(records.reduce((s, r) => s + (r.features[k] - mean[i]) ** 2, 0) / n));
  return { mean: mean, std: std.map(s => (s > 1e-12 ? s : 0)) };
}
function fit(records, names, opts) {
  opts = opts || {};
  const lambda = opts.lambda == null ? LAMBDA : opts.lambda;
  const balance = opts.balance !== false;
  const st = standardizer(records, names);
  const Z = records.map(r => names.map((k, i) => (st.std[i] > 0 ? (r.features[k] - st.mean[i]) / st.std[i] : 0)));
  const pairs = pairsAmong(records);
  const d = names.length;
  const counts = { within: 0, cross: 0 };
  pairs.forEach(p => { counts[p.kind]++; });
  const kinds = Object.keys(counts).filter(k => counts[k] > 0).length;
  const pw = pairs.map(p => (balance ? 1 / (kinds * counts[p.kind]) : 1 / pairs.length));
  const D = pairs.map(p => Z[p.hard].map((x, k) => x - Z[p.easy][k]));
  /* L: 0.25 * the largest eigenvalue of Σ pw d dᵀ (power iteration, deterministic start) + lambda */
  let v = new Array(d).fill(1 / Math.sqrt(d)), eig = 0;
  for (let it = 0; it < 100; it++) {
    const u = new Array(d).fill(0);
    D.forEach((row, p) => { let dot = 0; for (let k = 0; k < d; k++) dot += row[k] * v[k]; for (let k = 0; k < d; k++) u[k] += pw[p] * dot * row[k]; });
    eig = Math.sqrt(u.reduce((s, x) => s + x * x, 0));
    if (!(eig > 0)) break;
    v = u.map(x => x / eig);
  }
  const L = 0.25 * eig + lambda;
  const step = 1 / L;
  const grad = w => {
    const g = new Array(d).fill(0);
    let loss = 0;
    D.forEach((row, p) => {
      let m = 0;
      for (let k = 0; k < d; k++) m += w[k] * row[k];
      const s = 1 / (1 + Math.exp(m));            /* σ(−m) */
      loss += pw[p] * (m > 0 ? Math.log1p(Math.exp(-m)) : -m + Math.log1p(Math.exp(m)));
      for (let k = 0; k < d; k++) g[k] -= pw[p] * s * row[k];
    });
    for (let k = 0; k < d; k++) { g[k] += lambda * w[k]; loss += 0.5 * lambda * w[k] * w[k]; }
    return { g: g, loss: loss };
  };
  let w = new Array(d).fill(0), y = w.slice(), t = 1;
  for (let it = 0; it < (opts.iters || ITERS); it++) {
    const { g } = grad(y);
    const wNext = y.map((x, k) => Math.max(0, x - step * g[k]));
    const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
    y = wNext.map((x, k) => x + ((t - 1) / tNext) * (x - w[k]));
    w = wNext; t = tNext;
  }
  const end = grad(w);
  /* projected-gradient norm: 0 at the constrained optimum */
  const pg = Math.sqrt(end.g.reduce((s, gk, k) => s + (w[k] > 0 ? gk * gk : Math.min(0, gk) ** 2), 0));
  return { featureNames: names, mean: st.mean, std: st.std, weights: w, loss: end.loss, projGradNorm: pg, pairs: pairs.length, pairCounts: counts };
}
const modelScores = (model, records) => records.map(r => M.scoreOf(r.features, model));

/* ------------------------------------------------------------- leave-one-book-out */
function foldsOf(records) {
  return PATH_BOOKS.filter(b => records.filter(r => r.book === b && !r.holdout).length >= 2);
}
function foldData(records, held) {
  const stage = records.find(r => r.book === held).stage;
  const sideBooks = new Set(records.filter(r => r.stage === stage && r.book !== held).map(r => r.book));
  const pool = records.filter(r => !r.holdout && isLabelled(r));
  const train = pool.filter(r => r.book !== held && !sideBooks.has(r.book));
  /* test records: the held book first, then everything it can be compared with */
  const test = pool.filter(r => r.book === held).concat(pool.filter(r => r.book !== held));
  const nHeld = test.filter(r => r.book === held).length;
  const pairs = [];
  for (let i = 0; i < nHeld; i++) for (let j = 0; j < test.length; j++) {
    if (j < nHeld && j <= i) continue;
    const r = relation(test[i], test[j]);
    if (!r) continue;
    const kind = j < nHeld ? 'within' : PATH_BOOKS.includes(test[j].book) ? 'crossMain' : 'crossSide';
    const p = r.sign > 0 ? { easy: i, hard: j } : { easy: j, hard: i };
    p.kind = kind; p.held = [i, j].filter(x => x < nHeld);
    pairs.push(p);
  }
  return { held: held, stage: stage, sideBooks: Array.from(sideBooks), train: train, test: test, nHeld: nHeld, pairs: pairs };
}
const primary = pairs => pairs.filter(p => p.kind === 'within' || p.kind === 'crossMain');

function scorersFor(fold, opts) {
  const out = {};
  LEGACY.forEach(k => { out['legacy.' + k] = fold.test.map(r => r.legacy[k]); });
  if (!opts.legacyOnly) {
    const model = fit(trainingView(fold.train), opts.names);
    fold.model = model;
    out.g6 = modelScores(model, fold.test);
  }
  return out;
}
function foldReport(fold, scores) {
  const kinds = ['within', 'crossMain', 'crossSide'];
  const out = { held: fold.held, heldPieces: fold.nHeld, trainPieces: fold.train.length, excludedSideBooks: fold.sideBooks, pairs: {}, accuracy: {} };
  kinds.forEach(k => { out.pairs[k] = fold.pairs.filter(p => p.kind === k).length; });
  out.pairs.primary = out.pairs.within + out.pairs.crossMain;
  Object.keys(scores).forEach(name => {
    const a = { primary: accuracy(primary(fold.pairs), scores[name]) };
    kinds.forEach(k => { a[k] = accuracy(fold.pairs.filter(p => p.kind === k), scores[name]); });
    out.accuracy[name] = a;
  });
  return out;
}
/* pooled over folds: every primary pair of every fold, weight 1 */
function pooled(folds, name) {
  let ok = 0, n = 0;
  folds.forEach(f => primary(f.pairs).forEach(p => {
    const d = f.scores[name][p.hard] - f.scores[name][p.easy];
    ok += d > 0 ? 1 : d === 0 ? 0.5 : 0; n++;
  }));
  return n ? ok / n : null;
}
/* Piece-level bootstrap of pooled(a) − pooled(b): the held-out pieces of each fold are resampled with
   replacement; a pair counts once per draw of each held piece in it. */
function bootstrapDiff(folds, a, b) {
  const rnd = mulberry32(SEED);
  const diffs = [];
  for (let it = 0; it < BOOTSTRAP; it++) {
    let okA = 0, okB = 0, n = 0;
    folds.forEach(f => {
      const c = new Array(f.nHeld).fill(0);
      for (let k = 0; k < f.nHeld; k++) c[Math.floor(rnd() * f.nHeld)]++;
      primary(f.pairs).forEach(p => {
        const w = p.held.reduce((s, i) => s * c[i], 1);
        if (!w) return;
        const da = f.scores[a][p.hard] - f.scores[a][p.easy], db = f.scores[b][p.hard] - f.scores[b][p.easy];
        okA += w * (da > 0 ? 1 : da === 0 ? 0.5 : 0); okB += w * (db > 0 ? 1 : db === 0 ? 0.5 : 0); n += w;
      });
    });
    diffs.push(n ? (okA - okB) / n : 0);
  }
  diffs.sort((x, y) => x - y);
  return { lo: diffs[Math.floor(0.025 * BOOTSTRAP)], median: diffs[Math.floor(0.5 * BOOTSTRAP)], hi: diffs[Math.floor(0.975 * BOOTSTRAP) - 1] };
}

/* ------------------------------------------------------------- level anchors (final model) */
function isotonic(ys) {
  const blocks = [];
  ys.forEach(y => {
    blocks.push({ sum: y, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const b = blocks.pop();
      blocks[blocks.length - 1].sum += b.sum; blocks[blocks.length - 1].n += b.n;
    }
  });
  const out = [];
  blocks.forEach(b => { for (let i = 0; i < b.n; i++) out.push(b.sum / b.n); });
  return out;
}
function anchorsOf(model, records) {
  const main = records.filter(r => !r.holdout && PATH_BOOKS.includes(r.book) && r.order != null);
  const byBook = {};
  main.forEach(r => { (byBook[r.book] = byBook[r.book] || []).push(r); });
  Object.keys(byBook).forEach(b => byBook[b].sort((x, y) => x.order - y.order));
  const rows = main.map(r => {
    const list = byBook[r.book];
    return { book: r.book, no: r.no, score: M.scoreOf(r.features, model), position: r.stage + (list.indexOf(r) + 0.5) / list.length };
  }).sort((a, b) => a.score - b.score || a.position - b.position);
  const fitted = isotonic(rows.map(r => r.position));
  return rows.map((r, i) => ({ book: r.book, no: r.no, score: r.score, position: r.position, fit: fitted[i] }));
}

/* ------------------------------------------------------------- main */
function round(x, k) { return x == null ? null : Math.round(x * 10 ** k) / 10 ** k; }

function run(opts) {
  const data = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const names = data.featureNames.filter(k => !RANKER_EXCLUDES.includes(k));
  const records = data.records;
  const out = { dataset: {}, folds: [], pooled: {}, legacyBest: null };

  const labelled = records.filter(isLabelled);
  out.dataset = {
    records: records.length, labelled: labelled.length, holdout: records.filter(r => r.holdout).length,
    trainEligible: labelled.filter(r => !r.holdout).length,
    byBook: Object.fromEntries(Object.keys(data.counts).map(b => [b, {
      registered: data.counts[b].registered, holdout: data.counts[b].holdout, excluded: data.counts[b].excluded, stage: data.stages[b]
    }]))
  };

  const folds = foldsOf(records).map(b => foldData(records, b));
  folds.forEach(f => { f.scores = scorersFor(f, { legacyOnly: opts.legacyOnly, names: names }); out.folds.push(foldReport(f, f.scores)); });
  const names2 = Object.keys(folds[0].scores);
  names2.forEach(n => { out.pooled[n] = pooled(folds, n); });
  out.legacyBest = LEGACY.map(k => 'legacy.' + k).sort((a, b) => out.pooled[b] - out.pooled[a])[0];

  if (!opts.legacyOnly) {
    out.margin = MARGIN;
    out.bootstrap = bootstrapDiff(folds, 'g6', out.legacyBest);
    out.acceptance = {
      margin: MARGIN, foldTolerance: FOLD_TOLERANCE, against: out.legacyBest,
      pooled: out.pooled.g6 >= out.pooled[out.legacyBest] + MARGIN,
      bootstrap: out.bootstrap.lo > 0,
      folds: out.folds.every(f => f.accuracy.g6.primary >= f.accuracy[out.legacyBest].primary - FOLD_TOLERANCE)
    };
    out.acceptance.pass = out.acceptance.pooled && out.acceptance.bootstrap && out.acceptance.folds;
    out.foldWeights = folds.map(f => ({ held: f.held, weights: Object.fromEntries(names.map((k, i) => [k, round(f.model.weights[i], 4)])) }));
    out.sensitivity = [0.001, 0.01, 0.1, 1].map(lambda => {
      const acc = folds.map(f => {
        const m = fit(trainingView(f.train), names, { lambda: lambda });
        return { f: f, s: modelScores(m, f.test) };
      });
      let ok = 0, n = 0;
      acc.forEach(({ f, s }) => primary(f.pairs).forEach(p => { const d = s[p.hard] - s[p.easy]; ok += d > 0 ? 1 : d === 0 ? 0.5 : 0; n++; }));
      return { lambda: lambda, pooledPrimary: ok / n };
    });
    const unbalanced = folds.map(f => ({ f: f, s: modelScores(fit(trainingView(f.train), names, { balance: false }), f.test) }));
    let ok = 0, n = 0;
    unbalanced.forEach(({ f, s }) => primary(f.pairs).forEach(p => { const d = s[p.hard] - s[p.easy]; ok += d > 0 ? 1 : d === 0 ? 0.5 : 0; n++; }));
    out.sensitivity.push({ lambda: LAMBDA, balance: false, pooledPrimary: ok / n });

    Object.assign(out, finalPart(data));
    const final = out.finalModel;

    /* hanon: unlabelled, so no accuracy - where the final model places it (course.js: a warm-up for stages 2-4) */
    const hanon = records.filter(r => r.book === 'hanon' && !r.holdout);
    const w = { schema: M.SCHEMA, featureNames: names, mean: final.mean, std: final.std, weights: final.weights, anchors: out.anchors, stages: stagesOf() };
    out.hanon = hanon.map(r => ({ no: r.no, position: M.levelOf(M.scoreOf(r.features, w), w).position }));

    if (opts.holdout) out.holdout = holdoutReport(records, final);
  }
  return out;
}

/* The final model: every labelled, non-hold-out piece; and its level anchors. */
function finalPart(data) {
  const names = data.featureNames.filter(k => !RANKER_EXCLUDES.includes(k));
  const trainAll = data.records.filter(r => !r.holdout && isLabelled(r));
  const final = fit(trainingView(trainAll), names);
  return {
    final: { pieces: trainAll.length, pairs: final.pairs, pairCounts: final.pairCounts, loss: final.loss, projGradNorm: final.projGradNorm },
    finalModel: final,
    anchors: anchorsOf(final, data.records)
  };
}
/* What the committed weights file should be, from the committed dataset alone (no folds): the fast half of
   --check, used by tests/difficulty/dataset.test.js. */
function finalWeightsDoc() {
  return weightsDoc(finalPart(JSON.parse(fs.readFileSync(DATASET, 'utf8'))));
}

/* The registry's hold-out files, once, against the final model: every labelled pair with at least one
   hold-out piece in it (the other piece may be a training piece or another hold-out piece). */
function holdoutReport(records, final) {
  const test = records.filter(isLabelled);
  const pairs = pairsAmong(test).filter(p => test[p.easy].holdout || test[p.hard].holdout);
  const scores = { g6: modelScores(final, test) };
  LEGACY.forEach(k => { scores['legacy.' + k] = test.map(r => r.legacy[k]); });
  const out = { pieces: test.filter(r => r.holdout).length, pairs: { all: pairs.length }, accuracy: {} };
  ['within', 'cross'].forEach(k => { out.pairs[k] = pairs.filter(p => p.kind === k).length; });
  Object.keys(scores).forEach(n => {
    out.accuracy[n] = { all: accuracy(pairs, scores[n]) };
    ['within', 'cross'].forEach(k => { out.accuracy[n][k] = accuracy(pairs.filter(p => p.kind === k), scores[n]); });
  });
  /* reporting only (the model is final before this runs): a piece-level bootstrap of (g6 - the legacy reading
     the leave-one-book-out bar was fixed against), resampling the hold-out pieces, as bootstrapDiff does */
  const against = 'legacy.sectionMax';
  const hIdx = test.map((r, i) => (r.holdout ? i : -1)).filter(i => i >= 0);
  const rnd = mulberry32(SEED + 1);
  const diffs = [];
  for (let it = 0; it < BOOTSTRAP; it++) {
    const c = new Map(hIdx.map(i => [i, 0]));
    for (let k = 0; k < hIdx.length; k++) { const i = hIdx[Math.floor(rnd() * hIdx.length)]; c.set(i, c.get(i) + 1); }
    let okA = 0, okB = 0, n = 0;
    pairs.forEach(p => {
      const w = (c.has(p.easy) ? c.get(p.easy) : 1) * (c.has(p.hard) ? c.get(p.hard) : 1);
      if (!w) return;
      const da = scores.g6[p.hard] - scores.g6[p.easy], db = scores[against][p.hard] - scores[against][p.easy];
      okA += w * (da > 0 ? 1 : da === 0 ? 0.5 : 0); okB += w * (db > 0 ? 1 : db === 0 ? 0.5 : 0); n += w;
    });
    diffs.push(n ? (okA - okB) / n : 0);
  }
  diffs.sort((x, y) => x - y);
  out.bootstrap = { against: against, lo: diffs[Math.floor(0.025 * BOOTSTRAP)], median: diffs[Math.floor(0.5 * BOOTSTRAP)], hi: diffs[Math.floor(0.975 * BOOTSTRAP) - 1] };
  return out;
}

function stagesOf() {
  const out = {};
  COURSE.PATH.forEach(s => { out[s.stage] = { book: s.book, name: COURSE.STAGES[s.stage].name }; });
  return out;
}

function weightsDoc(out) {
  const f = out.finalModel;
  return {
    schema: M.SCHEMA,
    tool: 'ppp.g6a',
    version: WEIGHTS_VERSION,
    featureNames: f.featureNames,
    mean: f.mean,
    std: f.std,
    weights: f.weights,
    stages: stagesOf(),
    anchors: out.anchors,
    training: {
      dataset: 'difficulty/tools/dataset/method-books.json', pieces: out.final.pieces, pairs: out.final.pairs,
      pairCounts: out.final.pairCounts, lambda: LAMBDA, iterations: ITERS, balance: 'within-book and cross-stage pairs equal total weight',
      holdoutUsed: false
    }
  };
}
function evaluationDoc(out) {
  const copy = Object.assign({}, out);
  delete copy.finalModel;
  return Object.assign({ schema: 'ppp.difficulty-evaluation/1', weightsVersion: WEIGHTS_VERSION }, copy);
}

function print(out) {
  const pct = x => (x == null ? '   -  ' : (100 * x).toFixed(1).padStart(5) + '%');
  console.log('dataset:', JSON.stringify(out.dataset));
  out.folds.forEach(f => {
    console.log('\nfold: hold out', f.held, '| held pieces', f.heldPieces, '| train pieces', f.trainPieces, '| also out of training:', f.excludedSideBooks.join(',') || '-',
      '| pairs', JSON.stringify(f.pairs));
    Object.keys(f.accuracy).forEach(n => {
      const a = f.accuracy[n];
      console.log('  ' + n.padEnd(24), 'primary', pct(a.primary), ' within', pct(a.within), ' crossMain', pct(a.crossMain), ' crossSide', pct(a.crossSide));
    });
  });
  console.log('\npooled primary accuracy:');
  Object.keys(out.pooled).forEach(n => console.log('  ' + n.padEnd(24), pct(out.pooled[n])));
  console.log('best legacy reading:', out.legacyBest);
  if (out.bootstrap) console.log('g6 - best legacy, piece bootstrap 95%:', JSON.stringify(out.bootstrap), 'margin', out.margin);
  if (out.acceptance) console.log('acceptance:', JSON.stringify(out.acceptance));
  if (out.sensitivity) console.log('sensitivity (reported, not selected on):', JSON.stringify(out.sensitivity));
  if (out.foldWeights) out.foldWeights.forEach(f => console.log('weights, fold', f.held, JSON.stringify(f.weights)));
  if (out.final) console.log('final model:', JSON.stringify(out.final));
  if (out.finalModel) console.log('final weights:', JSON.stringify(Object.fromEntries(out.finalModel.featureNames.map((k, i) => [k, round(out.finalModel.weights[i], 4)]))));
  if (out.hanon) console.log('hanon placement (course position):', out.hanon.map(h => h.no + ':' + h.position).join(' '));
  if (out.holdout) console.log('hold-out:', JSON.stringify(out.holdout));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  /* --check recomputes exactly what the committed evaluation holds: with the hold-out test iff it has one */
  const committedHasHoldout = fs.existsSync(EVALUATION) && JSON.parse(fs.readFileSync(EVALUATION, 'utf8')).holdout != null;
  const opts = { legacyOnly: args.includes('--legacy-only'), holdout: args.includes('--holdout') || (args.includes('--check') && committedHasHoldout) };
  const out = run(opts);
  if (args.includes('--check')) {
    const w = JSON.stringify(weightsDoc(out), null, 1) + '\n', e = JSON.stringify(evaluationDoc(out), null, 1) + '\n';
    const same = (p, t) => fs.existsSync(p) && fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === t;
    if (!same(WEIGHTS, w) || !same(EVALUATION, e)) { console.error('difficulty weights/evaluation are stale: run node difficulty/tools/train.js --write'); process.exitCode = 1; }
    else console.log('difficulty weights and evaluation reproduce from the committed dataset');
  } else {
    print(out);
    if (args.includes('--write')) {
      fs.mkdirSync(path.dirname(WEIGHTS), { recursive: true });
      fs.writeFileSync(WEIGHTS, JSON.stringify(weightsDoc(out), null, 1) + '\n');
      fs.writeFileSync(EVALUATION, JSON.stringify(evaluationDoc(out), null, 1) + '\n');
      console.log('\nwrote', path.relative(REPO, WEIGHTS), 'and', path.relative(REPO, EVALUATION));
    }
  }
}

module.exports = { relation, pairsAmong, accuracy, fit, foldData, foldsOf, isotonic, anchorsOf, run, weightsDoc, finalWeightsDoc,
  trainingView, LEGACY, LAMBDA, MARGIN, FOLD_TOLERANCE, RANKER_EXCLUDES, WEIGHTS, EVALUATION, DATASET };
