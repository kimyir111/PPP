#!/usr/bin/env node
/* ============================================================================
   PPP rec/ (G10a-1, AI-5a) - training of the time-skeleton model (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8.3, 18)

     node rec/tools/train.js            write rec/weights/ai5a-v1.json and rec/tools/ai5a-v1.evaluation.json
     node rec/tools/train.js --check    recompute both and compare them byte for byte with the committed files (exit 1
                                        when they differ): the weights are a pure function of the catalogue and this code
     node rec/tools/train.js --cv       also a 5-fold cross-validation by reference (out-of-fold accuracy; slow), kept in the
                                        evaluation file (--check --cv checks it too)
     --data DIR                         keep the generated data set in DIR (default: a temporary directory, removed);
                                        an existing DIR is reused as it is (development only: --check always regenerates)
     --python PATH                      the Python that runs tests/bench/tools/rec_dataset.py (default: python3, python)

   THE DATA (tests/bench/tools/rec_dataset.py; licence-clean only, hold-out excluded, no external data, no real recording):
     truth   every non-hold-out reference of the benchmark's lint-clean, licence-evidenced catalogue: where onsets fall in
             their bars (the tables of rec/model.js are counted from these)
     train   the same references played by the benchmark's humanizer (perform/3: cover, cover-pedal, human-real, cover+of,
             seeds 101 and 102, no audio beats; cover and cover-pedal+helper, seed 103, with helper-like beats): the
             weights are fitted on these; no suite uses seeds 101-103
     holdout the hold-out references (G0's fnv1a32(id) % 5 == 0), the same families, seed 11: evaluated only, never fitted

   THE FIT: every reading of every training performance (rec/metre.js hypotheses), labelled right when its metre is the
   score's, its quarter tempo within 4 % of the score's and at least 90 % of the score's bar lines fall on its bar lines
   (within a 16th); the weights maximise the log-probability of the right readings under a softmax over all readings
   (a conditional logit, concave), with an L2 penalty of 1e-4, by Newton's method with a backtracking line search from
   zero. Deterministic: no random numbers, fixed order, Math.log/exp/sqrt/pow only (V8's are the same on every
   platform), every number written rounded to 6 decimals.
   ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const AS = require(path.join(REPO, 'audio-score.js'));
const ATT = require('../attacks.js');
const BEATS = require('../beats.js');
const MODEL = require('../model.js');
const METRE = require('../metre.js');

const NAME = 'ai5a', VERSION = 'v1';
const WEIGHTS = path.join(REPO, 'rec', 'weights', NAME + '-' + VERSION + '.json');
const EVALUATION = path.join(__dirname, NAME + '-' + VERSION + '.evaluation.json');
const DATASET = path.join(REPO, 'tests', 'bench', 'tools', 'rec_dataset.py');

/* the training set-up (G10 section 18 says why each value) */
const CONFIG = Object.freeze({
  sigma: 0.03,                 /* seconds: the timing kernel of an attack around its slot */
  tight: 100,                  /* the pulse tracker's step stiffness (rec/beats.js) */
  maxTracks: 6,                /* pulse tracks per performance */
  alpha: [0, 0.5],             /* per-attack evidence as a mean, per-beat evidence growing with the square root of the beats */
  l2: 1e-4,
  folds: 5,
  train: [{ profiles: 'cover,cover-pedal,human-real,cover+of', seeds: '101,102', beats: 'none' },
          { profiles: 'cover,cover-pedal+helper', seeds: '103', beats: 'oracle-noisy' }],
  holdout: [{ profiles: 'cover,cover-pedal,human-real,cover+of', seeds: '11', beats: 'none' },
            { profiles: 'cover,cover-pedal+helper', seeds: '11', beats: 'oracle-noisy' }]
});

const args = process.argv.slice(2);
const flag = k => args.indexOf(k) >= 0;
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const round6 = x => Math.round(x * 1e6) / 1e6;

/* ------------------------------------------------------------------ data */
function python() {
  const given = opt('--python') || process.env.PPP_PYTHON;
  const cands = given ? [given] : ['python3', 'python'];
  for (const c of cands) { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); if (r.status === 0) return c; }
  throw new Error('no Python found for ' + DATASET + ' (give --python)');
}
function runDataset(py, dir, extra) {
  const r = spawnSync(py, [DATASET].concat(extra), { cwd: REPO, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('rec_dataset.py failed: ' + (r.stderr || '').slice(-2000));
}
function dataset(dir, reuse) {
  const files = { truth: path.join(dir, 'truth.jsonl') };
  CONFIG.train.forEach((t, i) => { files['train' + i] = path.join(dir, 'train' + i + '.jsonl'); });
  CONFIG.holdout.forEach((t, i) => { files['holdout' + i] = path.join(dir, 'holdout' + i + '.jsonl'); });
  if (reuse && Object.values(files).every(f => fs.existsSync(f))) return files;
  const py = python();
  runDataset(py, dir, ['--truth', files.truth]);
  CONFIG.train.forEach((t, i) => runDataset(py, dir, ['--perfs', files['train' + i], '--profiles', t.profiles, '--seeds', t.seeds, '--beats', t.beats]));
  CONFIG.holdout.forEach((t, i) => runDataset(py, dir, ['--perfs', files['holdout' + i], '--profiles', t.profiles, '--seeds', t.seeds, '--beats', t.beats, '--holdout']));
  return files;
}
function readJsonl(f) { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

/* ------------------------------------------------------------------ readings and labels */
/* exactly what audio-score.js gives rec/ for a recording: its clean() and clusterNotes() */
function skeletonInput(notes) { return AS._.clusterNotes(ATT.cleanNotes(notes)); }

function rightReading(h, tracks, truth) {
  const m = MODEL.METRES[h.mi];
  if (m.key !== truth.time[0] + '/' + truth.time[1]) return 0;
  if (Math.abs(Math.log(h.qpm / truth.qpm)) > Math.log(1.04)) return 0;
  const bs = truth.bar_starts;
  if (!bs.length) return 0;
  let ok = 0;
  bs.forEach(t => {
    const q = h.rho * BEATS.position(tracks[h.track].beats, t) - h.phi, d = q / m.barQ;
    if (Math.abs(d - Math.round(d)) * m.barQ < 0.25) ok++;
  });
  return ok >= 0.9 * bs.length ? 1 : 0;
}

const F = MODEL.FEATURES.length;
/* one performance: its readings' scaled features (Float32), labels, and what evaluation needs; null when unreadable */
function extract(row, tables) {
  if (row.truth.multi_time) return null;
  const att = ATT.attacksOf(skeletonInput(row.input.notes));
  const key = row.truth.time[0] + '/' + row.truth.time[1];
  const base = { id: row.id, ref: row.ref, metre: key, n: 0 };
  if (att.length < 4) return base;
  const cls = ATT.classes(att);
  const tracks = BEATS.tracks(att, { tight: CONFIG.tight, maxTracks: CONFIG.maxTracks });
  const audio = row.input.beats ? BEATS.audioTrack(row.input.beats, att) : null;
  if (audio) tracks.unshift(audio);
  if (!tracks.length) return base;
  const H = METRE.hypotheses(att, cls, tracks, tables, { sigma: CONFIG.sigma, downbeats: audio && row.input.downbeats && row.input.downbeats.length ? row.input.downbeats : null });
  const n = H.list.length;
  const X = new Float32Array(n * F), lab = new Uint8Array(n), mi = new Uint8Array(n), qpm = new Float32Array(n);
  const sv = new Float64Array(F);
  let any = 0;
  for (let i = 0; i < n; i++) {
    METRE.scaledRow(H, i, CONFIG.alpha, sv);
    for (let k = 0; k < F; k++) X[i * F + k] = sv[k];
    lab[i] = rightReading(H.list[i], tracks, row.truth); any += lab[i];
    mi[i] = H.list[i].mi; qpm[i] = H.list[i].qpm;
  }
  return Object.assign(base, { n: n, X: X, lab: lab, mi: mi, qpm: qpm, any: any, truthQpm: row.truth.qpm });
}

/* ------------------------------------------------------------------ the fit */
/* the loss, its gradient and two curvature matrices: Hp = Cov_p(x) (positive semi-definite: a Gauss-Newton step) and
   H = Cov_p(x) - Cov_q(x), the exact Hessian of -log sum_right p (q: p restricted to the right readings) */
function lossGrad(cases, w, wantH) {
  let loss = 0;
  const g = new Float64Array(F), Hm = new Float64Array(F * F), Hq = new Float64Array(F * F), ep = new Float64Array(F), eq = new Float64Array(F);
  cases.forEach(c => {
    const n = c.n, sc = new Float64Array(n);
    let mx = -Infinity;
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < F; k++) s += c.X[i * F + k] * w[k]; sc[i] = s; if (s > mx) mx = s; }
    let z = 0, zc = 0;
    for (let i = 0; i < n; i++) { sc[i] = Math.exp(sc[i] - mx); z += sc[i]; if (c.lab[i]) zc += sc[i]; }
    loss -= Math.log(zc / z);
    ep.fill(0); eq.fill(0);
    for (let i = 0; i < n; i++) {
      const p = sc[i] / z, q = c.lab[i] ? sc[i] / zc : 0;
      if (p < 1e-12 && q === 0) continue;
      for (let k = 0; k < F; k++) { const x = c.X[i * F + k]; ep[k] += p * x; eq[k] += q * x; }
      if (wantH && p > 1e-9) for (let k = 0; k < F; k++) { const xk = p * c.X[i * F + k]; for (let l = k; l < F; l++) Hm[k * F + l] += xk * c.X[i * F + l]; }
      if (wantH && q > 1e-9) for (let k = 0; k < F; k++) { const xk = q * c.X[i * F + k]; for (let l = k; l < F; l++) Hq[k * F + l] += xk * c.X[i * F + l]; }
    }
    for (let k = 0; k < F; k++) g[k] += ep[k] - eq[k];
    if (wantH) for (let k = 0; k < F; k++) for (let l = k; l < F; l++) { Hm[k * F + l] -= ep[k] * ep[l]; Hq[k * F + l] -= eq[k] * eq[l]; }
  });
  const N = cases.length;
  for (let k = 0; k < F; k++) for (let l = 0; l < k; l++) { Hm[k * F + l] = Hm[l * F + k]; Hq[k * F + l] = Hq[l * F + k]; }
  return { loss: loss / N, g: Array.from(g, x => x / N), Hp: Array.from(Hm, x => x / N), H: Array.from(Hm, (x, i) => (x - Hq[i]) / N) };
}
function solve(Hm, b) {
  const n = b.length, a = [];
  for (let i = 0; i < n; i++) a.push(Hm.slice(i * n, i * n + n).concat([b[i]]));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    const t = a[i]; a[i] = a[p]; a[p] = t;
    for (let r = 0; r < n; r++) {
      if (r === i || !a[r][i]) continue;
      const f = a[r][i] / a[i][i];
      for (let k = i; k <= n; k++) a[r][k] -= f * a[i][k];
    }
  }
  return a.map((r, i) => r[n] / r[i]);
}
function fit(cases, log) {
  const use = cases.filter(c => c && c.n && c.any);
  const L2 = CONFIG.l2;
  const obj = (lg, w) => lg.loss + 0.5 * L2 * w.reduce((s, x) => s + x * x, 0);
  let w = new Array(F).fill(0), cur = lossGrad(use, w, true);
  for (let it = 0; it < 100; it++) {
    const g = cur.g.map((x, k) => x + L2 * w[k]);
    /* the exact Newton step when it goes downhill, else the Gauss-Newton one (always downhill) */
    let d = solve(cur.H.map((x, i) => x + (i % (F + 1) === 0 ? L2 : 0)), g.map(x => -x));
    let slope = g.reduce((s, x, k) => s + x * d[k], 0);
    if (!(slope < 0) || d.some(x => !Number.isFinite(x))) {
      d = solve(cur.Hp.map((x, i) => x + (i % (F + 1) === 0 ? L2 + 1e-9 : 0)), g.map(x => -x));
      slope = g.reduce((s, x, k) => s + x * d[k], 0);
    }
    const base = obj(cur, w);
    let step = 1, nw = w, next = cur;
    for (let ls = 0; ls < 30; ls++) {
      nw = w.map((x, k) => x + step * d[k]);
      next = lossGrad(use, nw, true);
      if (obj(next, nw) <= base + 1e-4 * step * slope) break;
      step *= 0.5;
    }
    const gain = base - obj(next, nw);
    w = nw; cur = next;
    if (log) log('  newton ' + it + ' loss ' + cur.loss.toFixed(6) + ' step ' + step);
    if (gain < 1e-8) break;
  }
  return { weights: w.map(round6), loss: round6(cur.loss), cases: use.length };
}

/* ------------------------------------------------------------------ evaluation */
function evaluate(cases, w) {
  const by = {}, all = { n: 0, right: 0, metre: 0, tempo: 0, reachable: 0 };
  cases.forEach(c => {
    if (!c) return;
    const r = { n: 1, right: 0, metre: 0, tempo: 0, reachable: c.any ? 1 : 0 };
    if (c.n) {
      let bi = 0, bs = -Infinity;
      for (let i = 0; i < c.n; i++) { let s = 0; for (let k = 0; k < F; k++) s += c.X[i * F + k] * w[k]; if (s > bs) { bs = s; bi = i; } }
      r.right = c.lab[bi];
      r.metre = MODEL.METRES[c.mi[bi]].key === c.metre ? 1 : 0;
      r.tempo = Math.abs(Math.log(c.qpm[bi] / c.truthQpm)) <= Math.log(1.04) ? 1 : 0;
    }
    const b = by[c.metre] = by[c.metre] || { n: 0, right: 0, metre: 0, tempo: 0, reachable: 0 };
    for (const k in r) { b[k] += r[k]; all[k] += r[k]; }
  });
  const rate = o => ({ n: o.n, right: round6(o.right / o.n), metre: round6(o.metre / o.n), tempo: round6(o.tempo / o.n), reachable: round6(o.reachable / o.n) });
  const out = rate(all);
  out.byMetre = {};
  Object.keys(by).sort().forEach(k => { out.byMetre[k] = rate(by[k]); });
  return out;
}

/* ------------------------------------------------------------------ main */
function fnv1a32(text) { let h = 2166136261; for (const b of Buffer.from(text, 'utf8')) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h; }
function stable(o) { return JSON.stringify(o, null, 1) + '\n'; }

function main() {
  const check = flag('--check'), cv = flag('--cv');
  const t0 = Date.now();
  const log = flag('--quiet') ? () => {} : s => process.stderr.write(s + '\n');
  const given = opt('--data');
  const dir = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ai5a-'));
  if (given) fs.mkdirSync(dir, { recursive: true });
  try {
    const files = dataset(dir, !!given && !check);
    const truth = readJsonl(files.truth);
    const trainRows = [].concat(...CONFIG.train.map((t, i) => readJsonl(files['train' + i])));
    const holdRows = [].concat(...CONFIG.holdout.map((t, i) => readJsonl(files['holdout' + i])));
    const dataSha = sha256(Object.keys(files).sort().map(k => k + ':' + sha256(fs.readFileSync(files[k]))).join('\n'));
    log('data: ' + truth.length + ' references, ' + trainRows.length + ' training and ' + holdRows.length + ' hold-out performances (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    const tables = MODEL.buildTables(truth);
    const train = trainRows.map(r => extract(r, tables));
    log('readings extracted (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    const f = fit(train, log);
    const body = { schema: MODEL.SCHEMA, name: NAME, version: VERSION, features: MODEL.FEATURES, weights: f.weights,
      alpha: CONFIG.alpha, sigma: CONFIG.sigma, tight: CONFIG.tight, maxTracks: CONFIG.maxTracks, tables: tables };
    const W = Object.assign({ sha256: sha256(JSON.stringify(body)) }, body, {
      training: { references: truth.length, holdout: 'excluded (fnv1a32(id) % 5 == 0)', performances: trainRows.length,
        sets: CONFIG.train, l2: CONFIG.l2, loss: f.loss, fitted: f.cases, data_sha256: dataSha,
        tool: 'rec/tools/train.js', data: 'tests/bench/tools/rec_dataset.py (licence-clean catalogue, humanizer perform/3)' } });
    const hold = holdRows.map(r => extract(r, tables));
    const evaluation = { schema: 'ppp.rec-time-skeleton-evaluation/1', weights_sha256: W.sha256,
      note: 'skeleton right = metre, quarter tempo within 4 % and >= 90 % of the bar lines; reachable = some reading of the pulse tracks is right',
      train: evaluate(train, f.weights), holdout: evaluate(hold, f.weights), cv: null };
    if (cv) {
      const K = CONFIG.folds, oof = [];
      for (let k = 0; k < K; k++) {
        const inFold = id => fnv1a32(id) % K === k;
        const tbl = MODEL.buildTables(truth.filter(r => !inFold(r.id)));
        const tr = trainRows.filter(r => !inFold(r.ref)).map(r => extract(r, tbl));
        const fk = fit(tr, null);
        trainRows.filter(r => inFold(r.ref)).forEach(r => { const c = extract(r, tbl); if (c) { c.w = fk.weights; oof.push(c); } });
        log('  fold ' + k + ' done (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      }
      /* each out-of-fold case scored with its own fold's weights */
      const byW = new Map();
      oof.forEach(c => { const key = c.w.join(','); if (!byW.has(key)) byW.set(key, []); byW.get(key).push(c); });
      const parts = Array.from(byW.values()).map(cs => evaluate(cs, cs[0].w));
      evaluation.cv = mergeEval(parts, K);
    }
    const wText = stable(W), eText = stable(evaluation);
    log('fit ' + f.cases + ' performances, loss ' + f.loss + '; train right ' + evaluation.train.right + ', hold-out right ' + evaluation.holdout.right +
      (evaluation.cv ? ', cv right ' + evaluation.cv.right : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s); weights ' + (wText.length / 1024).toFixed(1) + ' KB');
    if (check) {
      const same = fs.existsSync(WEIGHTS) && fs.readFileSync(WEIGHTS, 'utf8').replace(/\r\n/g, '\n') === wText;
      let sameE = true;
      if (fs.existsSync(EVALUATION)) {
        const have = JSON.parse(fs.readFileSync(EVALUATION, 'utf8'));
        if (!cv) { have.cv = null; }
        sameE = stable(have) === (cv ? eText : stable(Object.assign({}, evaluation, { cv: null })));
      } else sameE = false;
      console.log((same ? 'same ' : 'DIFFERS ') + path.relative(REPO, WEIGHTS).split(path.sep).join('/'));
      console.log((sameE ? 'same ' : 'DIFFERS ') + path.relative(REPO, EVALUATION).split(path.sep).join('/') + (cv ? '' : ' (cv not checked)'));
      return same && sameE ? 0 : 1;
    }
    fs.mkdirSync(path.dirname(WEIGHTS), { recursive: true });
    fs.writeFileSync(WEIGHTS, wText);
    if (!cv && fs.existsSync(EVALUATION)) {
      /* keep a committed cross-validation when this run did not recompute it, if it belongs to these weights */
      const have = JSON.parse(fs.readFileSync(EVALUATION, 'utf8'));
      if (have.weights_sha256 === W.sha256) evaluation.cv = have.cv;
    }
    fs.writeFileSync(EVALUATION, stable(evaluation));
    console.log('wrote ' + path.relative(REPO, WEIGHTS) + ' and ' + path.relative(REPO, EVALUATION));
    return 0;
  } finally {
    if (!given) fs.rmSync(dir, { recursive: true, force: true });
  }
}
function mergeEval(parts, K) {
  const all = { n: 0, right: 0, metre: 0, tempo: 0, reachable: 0 }, by = {};
  parts.forEach(p => {
    ['right', 'metre', 'tempo', 'reachable'].forEach(k => { all[k] += p[k] * p.n; });
    all.n += p.n;
    Object.keys(p.byMetre).forEach(m => {
      const b = by[m] = by[m] || { n: 0, right: 0, metre: 0, tempo: 0, reachable: 0 }, q = p.byMetre[m];
      ['right', 'metre', 'tempo', 'reachable'].forEach(k => { b[k] += q[k] * q.n; });
      b.n += q.n;
    });
  });
  const rate = o => ({ n: o.n, right: round6(o.right / o.n), metre: round6(o.metre / o.n), tempo: round6(o.tempo / o.n), reachable: round6(o.reachable / o.n) });
  const out = Object.assign({ folds: K, by: 'reference (fnv1a32(id) % 5)' }, rate(all));
  out.byMetre = {};
  Object.keys(by).sort().forEach(m => { out.byMetre[m] = rate(by[m]); });
  return out;
}

if (require.main === module) process.exit(main());
module.exports = { CONFIG, extract, fit, evaluate, rightReading, skeletonInput };
