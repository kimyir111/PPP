#!/usr/bin/env node
/* ============================================================================
   PPP rec/ (G10a-1, AI-5a) - training of the time-skeleton model (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8.3, 18)

     node rec/tools/train.js            write rec/weights/ai5a-v1.json and rec/tools/ai5a-v1.evaluation.json
     node rec/tools/train.js --check    recompute both and compare them byte for byte with the committed files (exit 1
                                        when they differ): the weights are a pure function of the catalogue and this code
     node rec/tools/train.js --cv       also a 5-fold cross-validation by reference (out-of-fold accuracy; slow), kept in the
                                        evaluation file (--check --cv checks it too)
     node rec/tools/train.js --families also the held-out families of G10a-1b (section 28; a few minutes), kept in the
                                        evaluation file (--check --families checks them too): the hold-out performances
                                        played three and six times in a row (a cover's length), the humanizer's swing family
                                        on the hold-out references, and a "pop cover" family (the hold-out x/4 references
                                        swung all through, once and four times in a row). Evaluated only, never fitted.
     --data DIR                         keep the generated data set in DIR (default: a temporary directory, removed);
                                        an existing DIR is reused as it is (development only: --check always regenerates)
     --python PATH                      the Python that runs tests/bench/tools/rec_dataset.py (default: python3, python)
     --workers N                        worker threads for the readings (default: the CPUs, at most 8; the result does not depend on it)
     --out DIR                          development: write the weights and the evaluation into DIR (with PPP_AI5A_DEV, a variant)

   THE DATA (tests/bench/tools/rec_dataset.py; licence-clean only, hold-out excluded, no external data, no real recording):
     truth   every non-hold-out reference of the benchmark's lint-clean, licence-evidenced catalogue: where onsets fall in
             their bars (the tables of rec/model.js are counted from these)
     train   the same references played by the benchmark's humanizer (perform/3: cover, cover-pedal, human-real, cover+of,
             seeds 101 and 102, no audio beats; cover and cover-pedal+helper, seed 103, with helper-like beats; since
             G10a-1b swing and swing+of, seed 105, no audio beats): the weights are fitted on these; no suite uses seeds
             101-105
     holdout the hold-out references (G0's fnv1a32(id) % 5 == 0), the same families, seed 11: evaluated only, never fitted

   THE FIT: every reading of every training performance (rec/metre.js hypotheses), labelled right when its metre is the
   score's, its quarter tempo within 4 % of the score's and at least 90 % of the score's bar lines fall on its bar lines
   (within a 16th; a swung reading of G10a-1b is right on the same terms: swing is how the eighths are played, not what is
   written); the weights maximise the log-probability of the right readings under a softmax over all readings
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
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const REPO = path.resolve(__dirname, '..', '..');
const AS = require(path.join(REPO, 'audio-score.js'));
const ATT = require('../attacks.js');
const BEATS = require('../beats.js');
const MODEL = require('../model.js');
const METRE = require('../metre.js');

/* the file keeps its name (the page loads rec/weights/ai5a-v1.json); the model inside is v1.1 since G10a-1b (the evidence cap and the swung frames) */
const NAME = 'ai5a', VERSION = 'v1', MODEL_VERSION = 'v1.1';
/* --out DIR (development: an experiment's files go there, not over the committed ones; refused with --check) */
const OUT_DIR = process.argv.indexOf('--out') >= 0 ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : null;
if (OUT_DIR && process.argv.indexOf('--check') >= 0) throw new Error('--out is for experiments; --check compares the committed files');
const WEIGHTS = OUT_DIR ? path.join(OUT_DIR, NAME + '-' + VERSION + '.json') : path.join(REPO, 'rec', 'weights', NAME + '-' + VERSION + '.json');
const EVALUATION = OUT_DIR ? path.join(OUT_DIR, NAME + '-' + VERSION + '.evaluation.json') : path.join(__dirname, NAME + '-' + VERSION + '.evaluation.json');
const DATASET = path.join(REPO, 'tests', 'bench', 'tools', 'rec_dataset.py');

const args = process.argv.slice(2);
const flag = k => args.indexOf(k) >= 0;
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

/* the training set-up (G10 sections 18 and 28 say why each value) */
const BASE_CONFIG = {
  sigma: 0.03,                 /* seconds: the timing kernel of an attack around its slot */
  tight: 100,                  /* the pulse tracker's step stiffness (rec/beats.js) */
  maxTracks: 6,                /* pulse tracks per performance */
  alpha: [0, 0.5],             /* per-attack evidence as a mean, per-beat evidence growing with the square root of the beats */
  beatCap: 100,                /* G10a-1b: a reading's per-beat evidence grows with its beats only up to this many (0: no cap); chosen by
                                  the out-of-fold accuracy on the training references played four times in a row (G10 section 28.4) */
  swing: [0.64],               /* G10a-1b: the long-short points of the swung frames of the simple metres ([]: none) */
  l2: 1e-4,
  folds: 5,
  train: [{ profiles: 'cover,cover-pedal,human-real,cover+of', seeds: '101,102', beats: 'none' },
          { profiles: 'cover,cover-pedal+helper', seeds: '103', beats: 'oracle-noisy' },
          /* G10a-1b: the humanizer's swing family (half of the four-bar blocks swung 1.6-2:1, the truth straight), so that a
             swung simple metre is a reading the weights have seen; seed 105, which no suite and no other model uses */
          { profiles: 'swing,swing+of', seeds: '105', beats: 'none' }],
  holdout: [{ profiles: 'cover,cover-pedal,human-real,cover+of', seeds: '11', beats: 'none' },
            { profiles: 'cover,cover-pedal+helper', seeds: '11', beats: 'oracle-noisy' }]
};
/* development only (refused with --check): PPP_AI5A_DEV='{"beatCap":0,"swing":[]}' overrides CONFIG fields for an experiment */
if (process.env.PPP_AI5A_DEV && flag('--check')) throw new Error('PPP_AI5A_DEV is for experiments; --check uses the committed CONFIG');
const CONFIG = Object.freeze(Object.assign({}, BASE_CONFIG, process.env.PPP_AI5A_DEV ? JSON.parse(process.env.PPP_AI5A_DEV) : {}));
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
function dataset(dir, reuse, families) {
  const files = { truth: path.join(dir, 'truth.jsonl') };
  CONFIG.train.forEach((t, i) => { files['train' + i] = path.join(dir, 'train' + i + '.jsonl'); });
  CONFIG.holdout.forEach((t, i) => { files['holdout' + i] = path.join(dir, 'holdout' + i + '.jsonl'); });
  const fam = families ? { swingHold: path.join(dir, 'holdout-swing.jsonl') } : {};
  if (reuse && Object.values(files).concat(Object.values(fam)).every(f => fs.existsSync(f))) return { files: files, fam: fam };
  const py = python();
  runDataset(py, dir, ['--truth', files.truth]);
  CONFIG.train.forEach((t, i) => runDataset(py, dir, ['--perfs', files['train' + i], '--profiles', t.profiles, '--seeds', t.seeds, '--beats', t.beats]));
  CONFIG.holdout.forEach((t, i) => runDataset(py, dir, ['--perfs', files['holdout' + i], '--profiles', t.profiles, '--seeds', t.seeds, '--beats', t.beats, '--holdout']));
  if (families) runDataset(py, dir, ['--perfs', fam.swingHold].concat(FAMILY_SWING, ['--holdout']));
  return { files: files, fam: fam };
}
/* the humanizer's swing family on the hold-out references (the families' data; never fitted) */
const FAMILY_SWING = ['--profiles', 'swing,swing+of', '--seeds', '11', '--beats', 'none'];
function readJsonl(f) { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

/* ------------------------------------------------------------------ the held-out families (G10a-1b) */
function fnv1a32(text) { let h = 2166136261; for (const b of Buffer.from(text, 'utf8')) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h; }
const r4 = x => Math.round(x * 1e4) / 1e4;
function repeatTimes(ts, k, span) { const o = []; for (let j = 0; j < k; j++) ts.forEach(t => o.push(r4(t + j * span))); return o; }
/* a performance played k times in a row, each copy a whole number of bars later (the last bar's length after the last bar
   line): the same metre, tempo and bar lines all through, as a song repeats its sections */
function repeated(row, k) {
  const bs = row.truth.bar_starts;
  if (k <= 1 || bs.length < 3) return row;
  const span = bs[bs.length - 1] - bs[0] + (bs[bs.length - 1] - bs[bs.length - 2]);
  const notes = [];
  for (let j = 0; j < k; j++) row.input.notes.forEach(n => notes.push({ on: r4(n.on + j * span), off: r4(n.off + j * span), midi: n.midi, vel: n.vel }));
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off);
  const input = { notes: notes };
  if (row.input.beats) input.beats = repeatTimes(row.input.beats, k, span);
  if (row.input.downbeats) input.downbeats = repeatTimes(row.input.downbeats, k, span);
  return Object.assign({}, row, { id: row.id + '|x' + k, input: input, truth: Object.assign({}, row.truth, { bar_starts: repeatTimes(bs, k, span) }) });
}
/* a performance of an x/4 reference swung all through: the second eighth of every written quarter heard at s of the quarter
   (s from the id, 0.60 to 0.667: the humanizer's range), everything inside the quarter moved with it (pppbench/humanize.py
   _swing_map, applied to every bar instead of half of the four-bar blocks); null for another metre. The truth stays as written */
function swungAll(row) {
  const t = row.truth;
  if (t.time[1] !== 4 || t.multi_time) return null;
  const E = t.eighths, ff = t.first_full_q, s = 0.6 + 0.0667 * (fnv1a32(row.id) % 1000) / 999;
  const qOf = x => {
    let lo = 0, hi = E.length - 1;
    if (x <= E[0]) return (x - E[0]) / (E[1] - E[0]) / 2;
    if (x >= E[hi]) return (hi + (x - E[hi]) / (E[hi] - E[hi - 1])) / 2;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (E[m] <= x) lo = m; else hi = m; }
    return (lo + (x - E[lo]) / (E[lo + 1] - E[lo])) / 2;
  };
  const tOf = q => { const e = q * 2, k = Math.max(0, Math.min(E.length - 2, Math.floor(e))); return E[k] + (e - k) * (E[k + 1] - E[k]); };
  const warp = x => { const q = qOf(x), b = Math.floor(q - ff), u = q - ff - b; return tOf(ff + b + (u < 0.5 ? u * 2 * s : s + (u - 0.5) * 2 * (1 - s))); };
  const notes = row.input.notes.map(n => { const on = r4(warp(n.on)); return { on: on, off: Math.max(r4(on + 0.03), r4(warp(n.off))), midi: n.midi, vel: n.vel }; });
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off);
  return Object.assign({}, row, { id: row.id + '|swung', input: { notes: notes } });
}

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
  const H = METRE.hypotheses(att, cls, tracks, tables, { sigma: CONFIG.sigma, swing: CONFIG.swing,
    downbeats: audio && row.input.downbeats && row.input.downbeats.length ? row.input.downbeats : null });
  const n = H.list.length;
  const X = new Float32Array(n * F), lab = new Uint8Array(n), mi = new Uint8Array(n), qpm = new Float32Array(n);
  const sv = new Float64Array(F);
  let any = 0;
  for (let i = 0; i < n; i++) {
    METRE.scaledRow(H, i, CONFIG.alpha, sv, CONFIG.beatCap);
    for (let k = 0; k < F; k++) X[i * F + k] = sv[k];
    lab[i] = rightReading(H.list[i], tracks, row.truth); any += lab[i];
    mi[i] = H.list[i].mi; qpm[i] = H.list[i].qpm;
  }
  return Object.assign(base, { n: n, X: X, lab: lab, mi: mi, qpm: qpm, any: any, truthQpm: row.truth.qpm });
}

/* every row's extract(), spread over worker threads (--workers N, default the CPUs up to 8) and put back in row order: the
   result is the same whatever the number of threads (extract() is a pure function of the row and the tables) */
function extractAll(rows, tables) {
  const n = Math.max(1, Math.min(+opt('--workers') || Math.min(8, os.cpus().length), rows.length));
  if (n === 1) return Promise.resolve(rows.map(r => extract(r, tables)));
  const shares = [];
  for (let w = 0; w < n; w++) shares.push(rows.filter((_, i) => i % n === w));
  return Promise.all(shares.map(rs => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { ai5aExtract: true, rows: rs, tables: tables } });
    wk.once('message', res); wk.once('error', rej);
  }))).then(parts => {
    const out = new Array(rows.length);
    parts.forEach((part, w) => part.forEach((c, k) => { out[k * n + w] = c; }));
    return out;
  });
}
if (!isMainThread && workerData && workerData.ai5aExtract) {
  parentPort.postMessage(workerData.rows.map(r => extract(r, workerData.tables)));
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
function stable(o) { return JSON.stringify(o, null, 1) + '\n'; }

/* the held-out families (--families): every one made of hold-out references only, evaluated with the fitted weights */
async function familyEval(holdRows0, swingRows, tables, w) {
  const ev = async rows => evaluate(await extractAll(rows.filter(Boolean), tables), w);
  const pop = holdRows0.map(swungAll).filter(Boolean);
  return {
    note: 'hold-out references only (never counted, never fitted): long-x3 / long-x6 = the hold-out performances without beats ' +
      'played 3 / 6 times in a row; swing / swing-x6 = the humanizer\'s swing family (half of the four-bar blocks swung, ' +
      'swing and swing+of, seed 11), once / six times in a row; pop / pop-x4 = the hold-out performances without beats of ' +
      'the x/4 references swung all through, once / four times in a row',
    'long-x3': await ev(holdRows0.map(r => repeated(r, 3))),
    'long-x6': await ev(holdRows0.map(r => repeated(r, 6))),
    swing: await ev(swingRows),
    'swing-x6': await ev(swingRows.map(r => repeated(r, 6))),
    pop: await ev(pop),
    'pop-x4': await ev(pop.map(r => repeated(r, 4)))
  };
}

async function main() {
  const check = flag('--check'), cv = flag('--cv'), families = flag('--families');
  const t0 = Date.now();
  const log = flag('--quiet') ? () => {} : s => process.stderr.write(s + '\n');
  const given = opt('--data');
  const dir = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ai5a-'));
  if (given) fs.mkdirSync(dir, { recursive: true });
  try {
    const ds = dataset(dir, !!given && !check, families), files = ds.files;
    const truth = readJsonl(files.truth);
    const trainRows = [].concat(...CONFIG.train.map((t, i) => readJsonl(files['train' + i]).map(r => Object.assign(r, { trainRow: i }))));
    const holdRows = [].concat(...CONFIG.holdout.map((t, i) => readJsonl(files['holdout' + i])));
    const dataSha = sha256(Object.keys(files).sort().map(k => k + ':' + sha256(fs.readFileSync(files[k]))).join('\n'));
    log('data: ' + truth.length + ' references, ' + trainRows.length + ' training and ' + holdRows.length + ' hold-out performances (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    const tables = MODEL.buildTables(truth);
    const train = await extractAll(trainRows, tables);
    log('readings extracted (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    const f = fit(train, log);
    const body = Object.assign({ schema: MODEL.SCHEMA, name: NAME, version: MODEL_VERSION, features: MODEL.FEATURES, weights: f.weights,
      alpha: CONFIG.alpha, sigma: CONFIG.sigma, tight: CONFIG.tight, maxTracks: CONFIG.maxTracks },
      CONFIG.beatCap ? { beatCap: CONFIG.beatCap } : {}, CONFIG.swing && CONFIG.swing.length ? { swing: CONFIG.swing } : {}, { tables: tables });
    const W = Object.assign({ sha256: sha256(JSON.stringify(body)) }, body, {
      training: { references: truth.length, holdout: 'excluded (fnv1a32(id) % 5 == 0)', performances: trainRows.length,
        sets: CONFIG.train, l2: CONFIG.l2, loss: f.loss, fitted: f.cases, data_sha256: dataSha,
        tool: 'rec/tools/train.js', data: 'tests/bench/tools/rec_dataset.py (licence-clean catalogue, humanizer perform/3)' } });
    const hold = await extractAll(holdRows, tables);
    const evaluation = { schema: 'ppp.rec-time-skeleton-evaluation/1', weights_sha256: W.sha256,
      note: 'skeleton right = metre, quarter tempo within 4 % and >= 90 % of the bar lines; reachable = some reading of the pulse tracks is right',
      train: evaluate(train, f.weights), holdout: evaluate(hold, f.weights), cv: null, families: null };
    /* per training row (CONFIG.train): G10a-1b added a row, so the first rows alone are what ai5a-v1's numbers compare with */
    if (CONFIG.train.length > 1) evaluation.trainByRow = CONFIG.train.map((t, i) => evaluate(train.filter((c, j) => trainRows[j].trainRow === i), f.weights));
    if (cv) {
      /* G10a-1b: also the out-of-fold performances of the first training row (no beats) played four times in a row (long-x4)
         and, of its x/4 references, swung all through and played four times (pop-x4): a cover's length and swing on references
         the fold's tables and weights never saw; what beatCap is chosen by (G10 section 28.4) */
      const K = CONFIG.folds, oof = [], oofLong = [], oofPop = [];
      const row0 = readJsonl(files.train0);
      for (let k = 0; k < K; k++) {
        const inFold = id => fnv1a32(id) % K === k;
        const tbl = MODEL.buildTables(truth.filter(r => !inFold(r.id)));
        const tr = await extractAll(trainRows.filter(r => !inFold(r.ref)), tbl);
        const fk = fit(tr, null);
        const tag = list => c => { if (c) { c.w = fk.weights; list.push(c); } };
        const inRows = trainRows.filter(r => inFold(r.ref));
        (await extractAll(inRows, tbl)).forEach((c, j) => { if (c) { c.trainRow = inRows[j].trainRow; } tag(oof)(c); });
        const held = row0.filter(r => inFold(r.ref) && !r.truth.multi_time);
        (await extractAll(held.map(r => repeated(r, 4)), tbl)).forEach(tag(oofLong));
        (await extractAll(held.map(swungAll).filter(Boolean).map(r => repeated(r, 4)), tbl)).forEach(tag(oofPop));
        log('  fold ' + k + ' done (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      }
      /* each out-of-fold case scored with its own fold's weights */
      const pooled = list => {
        const byW = new Map();
        list.forEach(c => { const key = c.w.join(','); if (!byW.has(key)) byW.set(key, []); byW.get(key).push(c); });
        return mergeEval(Array.from(byW.values()).map(cs => evaluate(cs, cs[0].w)), K);
      };
      evaluation.cv = Object.assign(pooled(oof), { byRow: CONFIG.train.length > 1 ? CONFIG.train.map((t, i) => pooled(oof.filter(c => c.trainRow === i))) : null,
        'long-x4': pooled(oofLong), 'pop-x4': pooled(oofPop) });
    }
    if (families) {
      evaluation.families = await familyEval(readJsonl(files.holdout0), readJsonl(ds.fam.swingHold), tables, f.weights);
      log('families evaluated (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
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
        if (!families) { have.families = null; }
        sameE = stable(have) === stable(Object.assign({}, evaluation, cv ? {} : { cv: null }, families ? {} : { families: null }));
      } else sameE = false;
      console.log((same ? 'same ' : 'DIFFERS ') + path.relative(REPO, WEIGHTS).split(path.sep).join('/'));
      console.log((sameE ? 'same ' : 'DIFFERS ') + path.relative(REPO, EVALUATION).split(path.sep).join('/') +
        (cv && families ? '' : ' (' + [cv ? null : 'cv', families ? null : 'families'].filter(Boolean).join(', ') + ' not checked)'));
      return same && sameE ? 0 : 1;
    }
    fs.mkdirSync(path.dirname(WEIGHTS), { recursive: true });
    fs.writeFileSync(WEIGHTS, wText);
    if ((!cv || !families) && fs.existsSync(EVALUATION)) {
      /* keep a committed cross-validation or families evaluation when this run did not recompute it, if it belongs to these weights */
      const have = JSON.parse(fs.readFileSync(EVALUATION, 'utf8'));
      if (have.weights_sha256 === W.sha256) {
        if (!cv) evaluation.cv = have.cv;
        if (!families) evaluation.families = have.families || null;
      }
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

if (require.main === module && isMainThread) main().then(code => process.exit(code), e => { console.error(e && e.stack || e); process.exit(2); });
module.exports = { CONFIG, extract, fit, evaluate, rightReading, skeletonInput, repeated, swungAll };
