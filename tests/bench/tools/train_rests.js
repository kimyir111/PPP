#!/usr/bin/env node
/* ============================================================================
   PPP rec/ S6 (G10a-3, AI-5b) - training of the silence classifier (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8.3 and 22)

     node tests/bench/tools/train_rests.js            write rec/weights/ai5b-rests-v1.json and rec/tools/ai5b-rests-v1.evaluation.json
     node tests/bench/tools/train_rests.js --check    recompute both and compare them byte for byte with the committed files
     --data DIR       keep the generated data in DIR (default: a temporary directory, removed); an existing DIR is reused
                      as it is (development only: --check always regenerates)
     --python PATH    the Python that runs tests/bench/tools/rests_data.py (default: python3, python)
     --workers N      worker threads for the notation runs (default: the CPUs, at most 8; the result does not depend on it)

   THE DATA (tests/bench/tools/rests_data.py; licence-clean only, no external data, no recording, no user material):
     train    every non-hold-out reference of the benchmark's lint-clean, licence-evidenced catalogue played by the benchmark's
              humanizer (perform/3: cover, cover-pedal, human-real, cover+of without beats; cover and cover-pedal+helper with
              helper-like beats), seed 301 - no suite and no other model uses it
     holdout  the hold-out references (G0's fnv1a32(id) % 5 == 0), the same rows, seed 301: evaluated only, never fitted

   THE ROWS: each performance goes through audio-score.js's recording conversion v2 exactly as the app's options run it
   ({closeGaps, exactBars, recording: 'v2'}); rec/rests.js is replaced IN THIS PROCESS ONLY by a stand-in that keeps the
   writer's candidate silences (a silence of an eighth or more between the written release of a note and the next onset of
   its voice) and their features, and answers the old rule (every one is a rest), so the candidates are exactly the ones the
   model will be asked about. A candidate is labelled a rest when the written staff of its notes has a written silence (a 16th
   or more where no note of the staff sounds) between the written onset of its notes and the written onset of the next ones
   (the heard notes' links to the score they were played from); a candidate whose notes the performer or the AMT overlay
   added has no label and is left out.

   THE FIT: logistic regression over rec/rests.js FEATURES, L2 1e-3 (not on the bias), Newton's method with a backtracking line
   search from zero, to a gradient below 1e-9. The threshold is the one that maximises the share of right decisions on the
   training rows (each decision is a note value), searched on a 0.01 grid from 0.30 to 0.90. Deterministic: no random numbers,
   fixed order (the rows are put back in performance order whatever the workers), Math.exp/log only, every number written
   rounded to 6 decimals.
   ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const REPO = path.resolve(__dirname, '..', '..', '..');
const RESTS_PATH = path.join(REPO, 'rec', 'rests.js');
const NAME = 'ai5b-rests', VERSION = 'v1';
const WEIGHTS = path.join(REPO, 'rec', 'weights', NAME + '-' + VERSION + '.json');
const EVALUATION = path.join(REPO, 'rec', 'tools', NAME + '-' + VERSION + '.evaluation.json');
const DATASET = path.join(REPO, 'tests', 'bench', 'tools', 'rests_data.py');
const CONFIG = Object.freeze({ seeds: '301', l2: 1e-3, opts: { closeGaps: true, exactBars: true, recording: 'v2' }, thrLo: 0.30, thrHi: 0.90,
  form: 'logistic', stumps: { rounds: 300, rate: 0.1, lambda: 1, minH: 5, cuts: 32 } });
const round6 = x => Math.round(x * 1e6) / 1e6;

/* ------------------------------------------------------------------ the notation runs (a worker, or the main thread) */
function runPerfs(lines) {
  const REAL = require(RESTS_PATH);
  let rows = null;
  const stand = Object.assign({}, REAL, {
    decide: (cands, ctx) => {
      const X = REAL.features(cands, ctx);
      cands.forEach((c, i) => rows.push({ x: Array.from(X[i]), a: c.notes.map(n => [n.on, n.off, n.midi]), b: c.nextNotes.map(n => [n.on, n.off, n.midi]) }));
      return { rest: cands.map(() => true), p: cands.map(() => 1), report: { model: 'train-stand-in' } };
    }
  });
  require.cache[require.resolve(RESTS_PATH)].exports = stand;
  const AS = require(path.join(REPO, 'audio-score.js'));
  return lines.map(line => {
    const perf = JSON.parse(line);
    rows = [];
    let err = null;
    try { AS.toMusicXml(Object.assign({ title: 'train' }, perf.input), Object.assign({}, CONFIG.opts)); } catch (e) { err = String(e && e.message || e).slice(0, 200); }
    return { id: perf.id, rows: rows, err: err };
  });
}
if (!isMainThread) {
  parentPort.postMessage(runPerfs(workerData.lines));
  return;
}

/* ------------------------------------------------------------------ data */
const args = process.argv.slice(2);
const flag = k => args.indexOf(k) >= 0;
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
function python() {
  const given = opt('--python') || process.env.PPP_PYTHON;
  const cands = given ? [given] : ['python3', 'python'];
  for (const c of cands) { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); if (r.status === 0) return c; }
  throw new Error('no Python found for ' + DATASET + ' (give --python)');
}
function dataset(dir, holdout, reuse) {
  const sub = path.join(dir, holdout ? 'holdout' : 'train');
  if (!(reuse && fs.existsSync(path.join(sub, 'perfs.jsonl')))) {
    const r = spawnSync(python(), [DATASET, '--out', sub, '--seeds', CONFIG.seeds].concat(holdout ? ['--holdout'] : []),
      { cwd: REPO, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }), maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error('rests_data.py failed: ' + (r.stderr || '').slice(-2000));
  }
  return { lines: fs.readFileSync(path.join(sub, 'perfs.jsonl'), 'utf8').split('\n').filter(l => l.trim()),
    truth: JSON.parse(fs.readFileSync(path.join(sub, 'truth.json'), 'utf8')).references };
}
async function notate(lines) {
  const n = Math.max(1, Math.min(+opt('--workers') || Math.min(8, os.cpus().length), lines.length));
  if (n === 1) return runPerfs(lines);
  const shares = [];
  for (let w = 0; w < n; w++) shares.push(lines.filter((_, i) => i % n === w));
  const parts = await Promise.all(shares.map(ls => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { lines: ls } });
    wk.once('message', res); wk.once('error', rej);
  })));
  /* back in performance order */
  const out = new Array(lines.length);
  parts.forEach((part, w) => part.forEach((r, k) => { out[k * n + w] = r; }));
  return out;
}

/* label every candidate from the heard notes' links to the score */
function label(lines, results, truth) {
  const rows = [];
  let unlabeled = 0;
  results.forEach((res, i) => {
    const perf = JSON.parse(lines[i]);
    const key = n => n.on + '|' + n.off + '|' + n.midi;
    const links = new Map();
    perf.input.notes.forEach((n, j) => {
      const k = key({ on: Math.max(0, +n.on), off: Math.max(+n.on + 0.03, +n.off), midi: n.midi | 0 });
      if (!links.has(k)) links.set(k, []);
      links.get(k).push(perf.truth[j]);
    });
    const sil = (truth[perf.ref] || {}).silences || {};
    const onsetOf = list => {
      const c = new Map();
      list.forEach(x => {
        (links.get(x[0] + '|' + x[1] + '|' + x[2]) || []).forEach(t => { if (t && t.length) { const k = t[0] + '|' + t[1]; c.set(k, (c.get(k) || 0) + 1); } });
      });
      let best = null, bn = 0;
      Array.from(c.keys()).sort().forEach(k => { if (c.get(k) > bn) { bn = c.get(k); best = k; } });
      return best ? best.split('|').map(Number) : null;
    };
    const OV = require(RESTS_PATH).FEATURES.indexOf('otherVoice');
    res.rows.forEach(r => {
      if (r.x[OV]) return;                 /* the staff's other part sounds: legato by rule (rec/rests.js decide), not a training row */
      const A = onsetOf(r.a), B = onsetOf(r.b);
      if (!A || !B || !(B[0] > A[0] + 1e-9)) { unlabeled++; return; }
      const list = sil[String(A[1])] || [];
      const y = list.some(s => s[0] >= A[0] - 1e-6 && s[1] <= B[0] + 1e-6) ? 1 : 0;
      rows.push({ x: r.x, y: y, perf: i });
    });
  });
  return { rows: rows, unlabeled: unlabeled };
}

/* ------------------------------------------------------------------ the fit */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    const d = M[c][c];
    if (Math.abs(d) < 1e-14) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[n] / r[i]));
}
function fit(rows, nf, l2) {
  let w = new Array(nf).fill(0);
  const loss = ww => {
    let s = 0;
    rows.forEach(r => { let z = 0; for (let k = 0; k < nf; k++) z += ww[k] * r.x[k]; s += r.y ? Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)); });
    for (let k = 1; k < nf; k++) s += 0.5 * l2 * rows.length * ww[k] * ww[k];
    return s;
  };
  let cur = loss(w);
  for (let it = 0; it < 100; it++) {
    const g = new Array(nf).fill(0), H = [];
    for (let k = 0; k < nf; k++) H.push(new Array(nf).fill(0));
    rows.forEach(r => {
      let z = 0;
      for (let k = 0; k < nf; k++) z += w[k] * r.x[k];
      const p = 1 / (1 + Math.exp(-z)), e = p - r.y, v = p * (1 - p);
      for (let a = 0; a < nf; a++) {
        if (!r.x[a]) continue;
        g[a] += e * r.x[a];
        for (let c = 0; c < nf; c++) if (r.x[c]) H[a][c] += v * r.x[a] * r.x[c];
      }
    });
    for (let k = 1; k < nf; k++) { g[k] += l2 * rows.length * w[k]; H[k][k] += l2 * rows.length; }
    for (let k = 0; k < nf; k++) H[k][k] += 1e-9;
    const gn = Math.sqrt(g.reduce((s, x) => s + x * x, 0)) / rows.length;
    if (gn < 1e-9) break;
    const d = solve(H, g);
    let step = 1, next = null, nl = Infinity;
    for (let ls = 0; ls < 30; ls++) {
      next = w.map((x, k) => x - step * d[k]);
      nl = loss(next);
      if (nl <= cur) break;
      step /= 2;
    }
    if (!(nl <= cur)) break;
    const done = cur - nl < 1e-10 * rows.length;
    w = next; cur = nl;
    if (done) break;
  }
  return w;
}
function probs(rows, w) {
  return rows.map(r => { let z = 0; for (let k = 0; k < w.length; k++) z += w[k] * r.x[k]; return 1 / (1 + Math.exp(-z)); });
}
/* boosted stumps: Newton boosting of depth-1 trees on the logistic loss. Each feature's candidate thresholds are the
   midpoints between its distinct training values (at most CUTS of them, at evenly spaced ranks); each round takes the
   (feature, threshold) of largest gain (ties: the lower feature, then the lower threshold), its two leaves -G/(H+lambda)
   shrunk by the rate. Deterministic. */
function fitStumps(rows, nf, cfg) {
  const n = rows.length;
  const cuts = [];
  for (let f = 0; f < nf; f++) {
    const vals = Array.from(new Set(rows.map(r => r.x[f]))).sort((a, b) => a - b);
    const mids = [];
    for (let i = 0; i + 1 < vals.length; i++) mids.push(round6((vals[i] + vals[i + 1]) / 2));
    const pick = mids.length <= cfg.cuts ? mids : Array.from({ length: cfg.cuts }, (_, k) => mids[Math.floor((k + 0.5) * mids.length / cfg.cuts)]);
    cuts.push(Array.from(new Set(pick)).sort((a, b) => a - b));
  }
  /* each row's bin per feature (index of the first cut >= value; values above every cut: cuts.length) */
  const bins = cuts.map((cs, f) => Int32Array.from(rows.map(r => { let lo = 0, hi = cs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (r.x[f] <= cs[m]) hi = m; else lo = m + 1; } return lo; })));
  const pos = rows.reduce((s, r) => s + r.y, 0);
  const bias = round6(Math.log((pos + 1) / (n - pos + 1)));
  const z = new Float64Array(n).fill(bias);
  const trees = [];
  for (let it = 0; it < cfg.rounds; it++) {
    const g = new Float64Array(n), h = new Float64Array(n);
    let G = 0, Hs = 0;
    for (let i = 0; i < n; i++) { const p = 1 / (1 + Math.exp(-z[i])); g[i] = p - rows[i].y; h[i] = p * (1 - p); G += g[i]; Hs += h[i]; }
    let best = null;
    for (let f = 0; f < nf; f++) {
      const nb = cuts[f].length + 1, GB = new Float64Array(nb), HB = new Float64Array(nb);
      const bf = bins[f];
      for (let i = 0; i < n; i++) { GB[bf[i]] += g[i]; HB[bf[i]] += h[i]; }
      let GL = 0, HL = 0;
      for (let c = 0; c < nb - 1; c++) {
        GL += GB[c]; HL += HB[c];
        const GR = G - GL, HR = Hs - HL;
        if (HL < cfg.minH || HR < cfg.minH) continue;
        const gain = GL * GL / (HL + cfg.lambda) + GR * GR / (HR + cfg.lambda) - G * G / (Hs + cfg.lambda);
        if (!best || gain > best.gain + 1e-12) best = { gain: gain, f: f, c: c, GL: GL, HL: HL, GR: GR, HR: HR };
      }
    }
    if (!best || best.gain < 1e-9) break;
    const l = round6(-cfg.rate * best.GL / (best.HL + cfg.lambda)), r = round6(-cfg.rate * best.GR / (best.HR + cfg.lambda));
    const t = cuts[best.f][best.c];
    trees.push([best.f, t, l, r]);
    const bf = bins[best.f];
    for (let i = 0; i < n; i++) z[i] += bf[i] <= best.c ? l : r;
  }
  return { bias: bias, trees: trees };
}
function probsStumps(rows, m) {
  return rows.map(r => { let z = m.bias; m.trees.forEach(t => { z += r.x[t[0]] <= t[1] ? t[2] : t[3]; }); return 1 / (1 + Math.exp(-z)); });
}
function scores(rows, p, thr) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  rows.forEach((r, i) => { const pr = p[i] >= thr; if (pr && r.y) tp++; else if (pr) fp++; else if (r.y) fn++; else tn++; });
  return { n: rows.length, rests: tp + fn, accuracy: round6((tp + tn) / Math.max(1, rows.length)), precision: round6(tp / Math.max(1, tp + fp)),
    recall: round6(tp / Math.max(1, tp + fn)), rule: { accuracy: round6((tp + fn) / Math.max(1, rows.length)), precision: round6((tp + fn) / Math.max(1, rows.length)), recall: 1 } };
}

/* ------------------------------------------------------------------ main */
(async function main() {
  const REAL = require(RESTS_PATH);
  const nf = REAL.FEATURES.length;
  const check = flag('--check');
  const keep = opt('--data');
  const dir = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-rests-'));
  try {
    const t0 = Date.now();
    const train = dataset(dir, false, !!keep && !check);
    const hold = dataset(dir, true, !!keep && !check);
    const tr = label(train.lines, await notate(train.lines), train.truth);
    const ho = label(hold.lines, await notate(hold.lines), hold.truth);
    const form = opt('--form') || CONFIG.form;
    let w = null, st = null, pTr, pHo;
    if (form === 'stumps') {
      st = fitStumps(tr.rows, nf, CONFIG.stumps);
      pTr = probsStumps(tr.rows, st); pHo = probsStumps(ho.rows, st);
    } else {
      w = fit(tr.rows, nf, CONFIG.l2).map(round6);
      pTr = probs(tr.rows, w); pHo = probs(ho.rows, w);
    }
    let thr = 0.5, best = -1;
    for (let k = Math.round(CONFIG.thrLo * 100); k <= Math.round(CONFIG.thrHi * 100); k++) {
      const s = scores(tr.rows, pTr, k / 100).accuracy;
      if (s > best + 1e-12) { best = s; thr = k / 100; }
    }
    const weights = { schema: REAL.SCHEMA, name: NAME, version: VERSION, form: form, features: REAL.FEATURES.slice() };
    if (st) { weights.bias = st.bias; weights.trees = st.trees; } else weights.weights = w;
    weights.threshold = thr;
    weights.training = { rows: tr.rows.length, unlabeled: tr.unlabeled, performances: train.lines.length, references: Object.keys(train.truth).length,
      seeds: CONFIG.seeds, data: 'tests/bench/tools/rests_data.py (perform/3, hold-out excluded)' };
    if (st) weights.training.stumps = CONFIG.stumps; else weights.training.l2 = CONFIG.l2;
    const body = JSON.stringify(Object.assign({}, weights, { sha256: null }));
    weights.sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const evaluation = { schema: 'ppp.rec-rests-evaluation/1', model: NAME + '@' + VERSION, threshold: thr,
      train: Object.assign(scores(tr.rows, pTr, thr), { unlabeled: tr.unlabeled }),
      holdout: Object.assign(scores(ho.rows, pHo, thr), { unlabeled: ho.unlabeled, references: Object.keys(hold.truth).length, performances: hold.lines.length }),
      at: [0.4, 0.5, 0.6, 0.7, 0.8].map(t => ({ threshold: t, train: scores(tr.rows, pTr, t), holdout: scores(ho.rows, pHo, t) })) };
    const wText = JSON.stringify(weights, null, 1) + '\n', eText = JSON.stringify(evaluation, null, 1) + '\n';
    const errs = train.lines.length;
    if (check) {
      const same = fs.existsSync(WEIGHTS) && fs.readFileSync(WEIGHTS, 'utf8').replace(/\r\n/g, '\n') === wText &&
        fs.existsSync(EVALUATION) && fs.readFileSync(EVALUATION, 'utf8').replace(/\r\n/g, '\n') === eText;
      console.log('train_rests --check: ' + (same ? 'same' : 'DIFFERENT') + ' (' + tr.rows.length + ' rows, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      if (!same) {
        fs.writeFileSync(path.join(os.tmpdir(), 'ai5b-rests-v1.check.json'), wText);
        fs.writeFileSync(path.join(os.tmpdir(), 'ai5b-rests-v1.evaluation.check.json'), eText);
        process.exitCode = 1;
      }
    } else {
      fs.mkdirSync(path.dirname(WEIGHTS), { recursive: true });
      fs.writeFileSync(WEIGHTS, wText);
      fs.mkdirSync(path.dirname(EVALUATION), { recursive: true });
      fs.writeFileSync(EVALUATION, eText);
      console.log('wrote ' + path.relative(REPO, WEIGHTS) + ' and ' + path.relative(REPO, EVALUATION) + ' (' + errs + ' performances, ' + tr.rows.length + ' rows, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      console.log('threshold ' + thr + ' train ' + JSON.stringify(evaluation.train) + '\nholdout ' + JSON.stringify(evaluation.holdout));
      REAL.FEATURES.forEach((f, k) => console.log('  ' + f.padEnd(16) + ' ' + w[k]));
    }
  } finally {
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(2); });
