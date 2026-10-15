#!/usr/bin/env node
/* G11b-2: the learner model and the practice policy (practice/learner.js, practice/policy.js) against the legacy app on the
   synthetic learners of practice/sim.js, at equal practice minutes (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §20).

     node tests/practice-sim/policy-eval.js --set tune [--k 0..99 | --seeds N] [--arms a,b] [--workers N] [--json FILE]
          the TUNING set: the four `tune` pieces x the six types x tuning seeds (k < 100). The only set parameters may be set on.
     node tests/practice-sim/policy-eval.js --set holdout --final [--workers N]
          the HELD-OUT set: the four `holdout` pieces x the six types x hold-out seeds k = 100..199, reported ONCE: the file
          tests/practice-sim/baselines/policy-holdout.json records the hash of the parameters it was run with; with other
          parameters the run is refused (tuning after looking at the hold-out is what this guard is for).
     node tests/practice-sim/policy-eval.js --set gate --check | --write
          the gate set (k = 0 on all eight pieces, as legacy-gate.json): the policy and the controls, row for row, against
          tests/practice-sim/baselines/policy-gate.json (determinism; CI). Written once the parameters were frozen.
     --table FILE   print the per-type table of a written report

   Arms: policy (practice/policy.js), random and through (negative controls, tests/practice-sim/drivers.js), none (no practice
   at all: the floor), and the legacy arms coach and card re-run on the same learners with the learner model watching them
   (the paired Brier score: the model and recentAcc predicting the same measure-attempts). The legacy arms' rows are the
   committed baseline's (tests/practice-sim/baseline.js) - they are recomputed here only to carry the observer. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const REPO = path.resolve(__dirname, '..', '..');
const SIM = require(path.join(REPO, 'practice', 'sim.js'));
const LEARNER = require(path.join(REPO, 'practice', 'learner.js'));
const POLICY = require(path.join(REPO, 'practice', 'policy.js'));
const P = require('./pieces.js');
const B = require('./baseline.js');
const RUN = require('./runner.js');

const OUT = {
  gate: path.join(__dirname, 'baselines', 'policy-gate.json'),
  tune: path.join(__dirname, 'baselines', 'policy-tune.json'),
  holdout: path.join(__dirname, 'baselines', 'policy-holdout.json')
};
const SCHEMA = 'ppp.practice-policy-eval/1';
const NEW_ARMS = ['policy', 'random', 'through', 'none'];
const LEGACY = ['coach', 'card'];
const ALL_ARMS = NEW_ARMS.concat(LEGACY);
const TUNE_K = 100;                                   /* seeds k < 100 tune, k >= 100 hold out (baseline.js) */

/* ---------------------------------------------------------------- the guard */
/* The tuning set is the tune pieces and the tuning seeds, and nothing else: a job outside it is refused, whoever asks. */
function assertTuning(jobs) {
  const split = new Map(P.PIECES.map(p => [p.id, p.split]));
  jobs.forEach(j => {
    if (split.get(j.piece) !== 'tune') throw new Error('policy-eval: ' + j.piece + ' is a hold-out piece: not in the tuning set');
    if (!(j.k >= 0 && j.k < TUNE_K)) throw new Error('policy-eval: seed k = ' + j.k + ' is a hold-out seed: not in the tuning set');
  });
  return jobs;
}
function assertHoldout(jobs) {
  const split = new Map(P.PIECES.map(p => [p.id, p.split]));
  jobs.forEach(j => {
    if (split.get(j.piece) !== 'holdout' || !(j.k >= TUNE_K)) throw new Error('policy-eval: ' + j.piece + ' k = ' + j.k + ' is not a hold-out cell');
  });
  return jobs;
}

/* The hold-out set is reported once: a report made with other numbers or on another source of the two modules refuses a new one.
   now: {hash, source} of today's files (or a numbers hash alone). -> the reason, or null */
function holdoutRefusal(old, now) {
  if (!old || !old.params || !old.params.hash) return null;
  const cur = typeof now === 'string' ? { hash: now, source: old.params.source } : now;
  if (old.params.hash === cur.hash && (!old.params.source || old.params.source === cur.source)) return null;
  return 'the hold-out set was already reported with other parameters (' + String(old.params.hash).slice(0, 12) + '); a second report with tuned-again parameters is refused';
}

/* the numbers that set what the policy and the model do (their defaults and any overrides) ... */
function paramsHash(over) {
  return crypto.createHash('sha256').update(JSON.stringify({ learner: LEARNER.DEFAULTS, policy: POLICY.DEFAULTS, over: over || null })).digest('hex');
}
/* ... and the code that reads them */
function sourceHash() {
  const src = ['practice/learner.js', 'practice/policy.js'].map(f => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
  return crypto.createHash('sha256').update(src).digest('hex');
}

function jobsFor(set, o) {
  o = o || {};
  const arms = o.arms || ALL_ARMS;
  const types = o.types || SIM.TYPE_NAMES;
  let pieces, ks;
  if (set === 'tune') {
    pieces = P.PIECES.filter(p => p.split === 'tune').map(p => p.id);
    ks = o.ks || Array.from({ length: o.seeds || TUNE_K }, (_, i) => i);
  } else if (set === 'holdout') {
    pieces = P.PIECES.filter(p => p.split === 'holdout').map(p => p.id);
    ks = Array.from({ length: 100 }, (_, i) => TUNE_K + i);
  } else if (set === 'gate') {
    pieces = P.PIECES.map(p => p.id);
    ks = [0];
  } else throw new Error('policy-eval: unknown set ' + set);
  if (o.pieces) pieces = pieces.filter(id => o.pieces.indexOf(id) >= 0);
  const jobs = [];
  arms.forEach(a => pieces.forEach(pc => types.forEach(t => ks.forEach(k => jobs.push({ arm: a, piece: pc, type: t, k: k })))));
  jobs.forEach(j => { j.key = [j.arm, j.piece, j.type, String(j.k).padStart(4, '0')].join('|'); });
  jobs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  if (set === 'tune') assertTuning(jobs);
  if (set === 'holdout') assertHoldout(jobs);
  return jobs;
}

/* ---------------------------------------------------------------- one learner */
const R6 = x => SIM.round(x, 6);
function rowOf(r) {
  const row = B.rowOf(r);
  row.weakQuartileSharePre = R6(r.weakQuartileSharePre);
  const bp = r.brierPaired, ba = r.brierModelAll, d = r.driver && r.driver.policy;
  row.pairN = bp ? bp.n : 0;
  row.brierLegacyPaired = bp ? R6(bp.legacy) : null;
  row.brierModelPaired = bp ? R6(bp.model) : null;
  row.pairNP = bp ? bp.nP : 0;
  row.brierLegacyP = bp && bp.nP ? R6(bp.legacyP) : null;
  row.brierModelP = bp && bp.nP ? R6(bp.modelP) : null;
  row.modelAllN = ba ? ba.n : 0;
  row.brierModelAll = ba ? R6(ba.model) : null;
  if (d) { row.plans = d.plans; row.rejected = d.rejected; row.repaired = d.repaired; row.firstDiffers = d.firstDiffers || 0; row.suggestions = d.suggestions || 0; row.stuck = d.stuck || 0; }
  return row;
}

/* the floor: nobody practises; the learner only forgets toward where it started (it starts there) */
function noneRow(piece, type, k) {
  const seed = SIM.hashSeed(piece.id + '|' + type + '|' + k);
  const L = SIM.makeLearner(type, piece, seed, RUN.CFG.t0);
  SIM.advance(L, RUN.CFG.t0 + (RUN.CFG.practiceDays - 1) * SIM.DAY);
  const end = SIM.truth(L, RUN.CFG.masteryRatio).filter(a => a != null);
  SIM.advance(L, RUN.CFG.t0 + RUN.CFG.retentionDay * SIM.DAY);
  const r1 = SIM.truth(L, 1).filter(a => a != null), rM = SIM.truth(L, RUN.CFG.masteryRatio).filter(a => a != null);
  const ok = a => a >= RUN.CFG.masteryAcc;
  return rowOf({
    piece: piece.id, split: piece.split, type: type, k: k, arm: 'none', seed: seed, laps: 0,
    minutes: RUN.CFG.practiceDays * RUN.CFG.sessionMinutes, sessions: RUN.CFG.practiceDays, minutesToMastery: end.every(ok) ? 0 : null,
    masteredShareEnd: end.filter(ok).length / end.length, retention30: r1.reduce((a, b) => a + b, 0) / r1.length,
    retainedShare30: rM.filter(ok).length / rM.length, weakQuartileShare: null, masteredTimeShare: null, longestStreak: 0,
    flipsPerSession: 0, flipsPerLap: 0, brier: null, brierOracle: null, brierN: 0, handsShare: { left: 0, right: 0 },
    memoryLapShare: 0, meanTempoRatio: 0, memorizedSections: 0, sections: piece.score.sections.length
  });
}

async function runJobs(jobs, over, onRow) {
  const L = require('./app-legacy.js');
  const D = require('./drivers.js');
  const env = L.build();
  const pieces = new Map((await P.loadAll(env.E, [...new Set(jobs.map(j => j.piece))])).map(p => [p.id, p]));
  for (const j of jobs) {
    const piece = pieces.get(j.piece);
    if (j.arm === 'none') { onRow(noneRow(piece, j.type, j.k)); continue; }
    const o = { learner: over && over.learner, policy: over && over.policy };
    const opts = LEGACY.indexOf(j.arm) >= 0 ? { observer: D.make('observer', o) } : { driver: D.make(j.arm, o) };
    onRow(rowOf(await RUN.simulate(env, piece, j.type, j.k, j.arm, opts)));
  }
}

async function rowsFor(jobs, o) {
  o = o || {};
  const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  const nW = Math.max(1, Math.min(o.workers || Math.min(8, cpus), jobs.length));
  const rows = [];
  const t0 = Date.now();
  if (nW === 1) await runJobs(jobs, o.over, r => rows.push(r));
  else {
    /* interleave by key, so every worker gets every arm and piece */
    await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((resolve, reject) => {
      const wk = new Worker(__filename, { workerData: { jobs: jobs.filter((_, i) => i % nW === w), over: o.over || null } });
      wk.on('message', m => { if (m.row) rows.push(m.row); else if (m.done) resolve(); else if (m.error) reject(new Error(m.error)); });
      wk.on('error', reject);
      wk.on('exit', code => { if (code !== 0) reject(new Error('worker exited ' + code)); });
    })));
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!o.quiet) process.stderr.write(rows.length + ' runs in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s on ' + nW + ' thread(s)\n');
  return rows;
}

/* ---------------------------------------------------------------- aggregates and the comparison */
const METRICS = B.METRICS.concat(['weakQuartileSharePre', 'brierLegacyPaired', 'brierModelPaired', 'brierLegacyP', 'brierModelP', 'brierModelAll', 'rejected', 'repaired', 'firstDiffers']);
function aggregate(rows) {
  const out = B.aggregate(rows);
  METRICS.slice(B.METRICS.length).forEach(name => {
    const s = SIM.summary(rows.map(r => r[name]));
    out[name] = { n: s.n, mean: SIM.round(s.mean, 6), median: SIM.round(s.median, 6) };
  });
  /* Brier pooled over measure-attempts (weighted by attempts): the model and recentAcc on the same attempts */
  const pool = (nk, vk) => { let n = 0, s = 0; rows.forEach(r => { if (r[nk] && r[vk] != null) { n += r[nk]; s += r[vk] * r[nk]; } }); return n ? SIM.round(s / n, 6) : null; };
  out.pairN = rows.reduce((a, r) => a + (r.pairN || 0), 0);
  out.brierLegacyPairedPooled = pool('pairN', 'brierLegacyPaired');
  out.brierModelPairedPooled = pool('pairN', 'brierModelPaired');
  out.pairNP = rows.reduce((a, r) => a + (r.pairNP || 0), 0);
  out.brierLegacyPPooled = pool('pairNP', 'brierLegacyP');
  out.brierModelPPooled = pool('pairNP', 'brierModelP');
  out.rejectedTotal = rows.reduce((a, r) => a + (r.rejected || 0), 0);
  out.repairedTotal = rows.reduce((a, r) => a + (r.repaired || 0), 0);
  out.plansTotal = rows.reduce((a, r) => a + (r.plans || 0), 0);
  return out;
}
function groupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  const o = {};
  [...m.keys()].sort().forEach(k => { o[k] = aggregate(m.get(k)); });
  return o;
}

/* policy against the better legacy arm of each type (the lower minutes, the higher retention: the stricter comparison) */
function compare(byArmType, byArm) {
  const types = SIM.TYPE_NAMES;
  const g = (arm, t) => byArmType[arm + '|' + t];
  const cmp = {};
  const arms = ['policy', 'random', 'through', 'none'].filter(a => types.some(t => g(a, t)));
  arms.forEach(arm => {
    const per = {};
    types.forEach(t => {
      const a = g(arm, t), c = g('coach', t), d = g('card', t);
      if (!a || !c || !d) return;
      const legMin = Math.min(c.minutesCapped.mean, d.minutesCapped.mean);
      const legRet = Math.max(c.retention30.mean, d.retention30.mean);
      const legRetS = Math.max(c.retainedShare30.mean, d.retainedShare30.mean);
      per[t] = {
        minutesCapped: a.minutesCapped.mean, legacyMinutesCapped: legMin, minutesChange: SIM.round(a.minutesCapped.mean / legMin - 1, 4),
        reached: a.reached.mean, legacyReached: Math.max(c.reached.mean, d.reached.mean),
        masteredShareEnd: a.masteredShareEnd.mean, legacyMasteredShareEnd: Math.max(c.masteredShareEnd.mean, d.masteredShareEnd.mean),
        retention30: a.retention30.mean, legacyRetention30: legRet, retentionChange: SIM.round(a.retention30.mean / legRet - 1, 4),
        retainedShare30: a.retainedShare30.mean, legacyRetainedShare30: legRetS,
        flipsPerLap: a.flipsPerLap.mean,
        brierModelPaired: a.brierModelPairedPooled, brierLegacyPaired: a.brierLegacyPairedPooled,
        brierModelP: a.brierModelPPooled, brierLegacyP: a.brierLegacyPPooled,
        /* the model next to the legacy arms, on their own attempts */
        legacyArmsBrierModel: SIM.round(((c.brierModelPairedPooled || 0) * c.pairN + (d.brierModelPairedPooled || 0) * d.pairN) / Math.max(1, c.pairN + d.pairN), 6),
        legacyArmsBrierRecentAcc: SIM.round(((c.brierLegacyPairedPooled || 0) * c.pairN + (d.brierLegacyPairedPooled || 0) * d.pairN) / Math.max(1, c.pairN + d.pairN), 6)
      };
    });
    const vals = Object.values(per);
    if (!vals.length) return;
    const mean = f => SIM.round(vals.reduce((s, v) => s + f(v), 0) / vals.length, 4);
    const worst = (f, hi) => vals.reduce((w, v, i) => { const t = Object.keys(per)[i]; const x = f(v); return (w == null || (hi ? x > w.x : x < w.x)) ? { type: t, x: x } : w; }, null);
    cmp[arm] = {
      perType: per,
      meanMinutesChange: mean(v => v.minutesChange),
      worstMinutes: worst(v => v.minutesChange, true),
      meanRetentionChange: mean(v => v.retentionChange),
      worstRetention: worst(v => v.retentionChange, false),
      worstFlips: worst(v => v.flipsPerLap, true),
      /* the acceptance bar of the G11b-2 row, read on this set */
      acceptance: arm !== 'policy' ? undefined : {
        minutesMinus20: mean(v => v.minutesChange) <= -0.2,
        noTypeWorseBy5: vals.every(v => v.minutesChange <= 0.05),
        retentionNotWorse: vals.every(v => v.retention30 >= v.legacyRetention30),
        flipsAtMostOnePer3Laps: vals.every(v => v.flipsPerLap <= 1 / 3),
        brierNotWorse: vals.every(v => v.brierModelPaired != null && v.brierModelPaired <= v.brierLegacyPaired) &&
          vals.every(v => v.legacyArmsBrierModel <= v.legacyArmsBrierRecentAcc),
        everyPlanValid: byArm.policy ? byArm.policy.rejectedTotal === 0 && byArm.policy.repairedTotal === 0 : false
      }
    };
  });
  return cmp;
}

function docFrom(set, rows, meta) {
  const byArmType = groupBy(rows, r => r.arm + '|' + r.type);
  const byArm = groupBy(rows, r => r.arm);
  return {
    schema: SCHEMA, tool: 'tests/practice-sim/policy-eval.js', simVersion: SIM.VERSION, set: set,
    note: 'Synthetic learners are assumptions, not data (practice/sim.js). policy is practice/policy.js on practice/learner.js; random, through and none are negative controls; coach and card are the legacy app (its own Learning, Memory and Coach). Equal practice minutes for every arm but none (which practises nothing). None of it says how a real pupil learns (H-11).',
    params: { learner: LEARNER.DEFAULTS, policy: POLICY.DEFAULTS, over: (meta && meta.over) || null, hash: paramsHash(meta && meta.over), source: sourceHash() },
    config: { cfg: RUN.CFG, seeds: meta && meta.seeds, pieces: [...new Set(rows.map(r => r.piece))].sort(), types: SIM.TYPE_NAMES },
    aggregates: { byArm: byArm, byArmType: byArmType, byArmPiece: groupBy(rows, r => r.arm + '|' + r.piece) },
    comparison: compare(byArmType, byArm),
    rows: set === 'gate' ? rows : undefined
  };
}
const canonical = doc => JSON.stringify(doc, null, 1) + '\n';

function table(doc) {
  const c = doc.comparison;
  const lines = [];
  Object.keys(c).forEach(arm => {
    lines.push('== ' + arm + (c[arm].acceptance ? '  acceptance ' + JSON.stringify(c[arm].acceptance) : ''));
    lines.push('type | min capped (legacy) | change | reached (legacy) | mastered end (legacy) | ret30 (legacy) | retained30 (legacy) | flips/lap | Brier model vs recentAcc (same attempts) | on legacy arms');
    Object.keys(c[arm].perType).forEach(t => {
      const v = c[arm].perType[t];
      const f = (x, k) => x == null ? '-' : (+x).toFixed(k == null ? 3 : k);
      lines.push([t, f(v.minutesCapped, 1) + ' (' + f(v.legacyMinutesCapped, 1) + ')', f(v.minutesChange * 100, 1) + '%', f(v.reached, 2) + ' (' + f(v.legacyReached, 2) + ')',
        f(v.masteredShareEnd) + ' (' + f(v.legacyMasteredShareEnd) + ')', f(v.retention30) + ' (' + f(v.legacyRetention30) + ')', f(v.retainedShare30) + ' (' + f(v.legacyRetainedShare30) + ')',
        f(v.flipsPerLap), f(v.brierModelPaired, 4) + ' vs ' + f(v.brierLegacyPaired, 4), f(v.legacyArmsBrierModel, 4) + ' vs ' + f(v.legacyArmsBrierRecentAcc, 4)].join(' | '));
    });
    lines.push('mean minutes change ' + (c[arm].meanMinutesChange * 100).toFixed(1) + '%, worst ' + JSON.stringify(c[arm].worstMinutes) + ', mean retention change ' + (c[arm].meanRetentionChange * 100).toFixed(1) + '%, worst ' + JSON.stringify(c[arm].worstRetention));
  });
  return lines.join('\n');
}

/* ---------------------------------------------------------------- command line */
async function main() {
  const argv = process.argv.slice(2);
  const val = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--table')) { console.log(table(JSON.parse(fs.readFileSync(val('--table'), 'utf8')))); return; }
  const set = val('--set') || 'gate';
  const workers = val('--workers') ? +val('--workers') : undefined;
  const arms = val('--arms') ? val('--arms').split(',') : undefined;
  const over = val('--over') ? JSON.parse(val('--over')) : null;
  let ks;
  if (val('--k')) { const m = /^(\d+)\.\.(\d+)$/.exec(val('--k')); ks = []; for (let k = +m[1]; k <= +m[2]; k++) ks.push(k); }
  const seeds = val('--seeds') ? +val('--seeds') : undefined;
  if (set === 'holdout') {
    if (!argv.includes('--final')) { console.error('the hold-out set is reported once, with the final parameters: --final'); process.exit(2); }
    if (over) { console.error('the hold-out set runs the committed defaults only (no --over)'); process.exit(2); }
    if (fs.existsSync(OUT.holdout)) {
      const why = holdoutRefusal(JSON.parse(fs.readFileSync(OUT.holdout, 'utf8')), { hash: paramsHash(null), source: sourceHash() });
      if (why) { console.error('policy-eval: ' + why); process.exit(3); }
    }
  }
  /* the gate check in N slices (CI runs two): the K-th slice recomputes the rows K-1 mod N and compares them with the committed rows, and every
     slice rebuilds the whole document from the committed rows (aggregates, parameters, the modules' source hash) and compares that - the N
     slices together check what the unsliced check does */
  const part = val('--part');
  if (set === 'gate' && argv.includes('--check') && part) {
    const m = /^(\d+)\/(\d+)$/.exec(part);
    const K = m ? +m[1] : 0, N = m ? +m[2] : 0;
    if (!(K >= 1 && K <= N)) { console.error('--part K/N with 1 <= K <= N'); process.exit(2); }
    const file = OUT.gate;
    const committedText = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const committed = JSON.parse(committedText);
    const all = jobsFor('gate');
    const t1 = Date.now();
    const rows = await rowsFor(all.filter((_, i) => i % N === K - 1), { workers: workers });
    const byKey = new Map((committed.rows || []).map(r => [r.key, r]));
    const bad = [];
    rows.forEach(r => { const c = byKey.get(r.key); if (!c) bad.push(r.key + ': not in the committed rows'); else B.diffs(c, r, r.key, bad); });
    if ((committed.rows || []).length !== all.length) bad.push('the committed file has ' + (committed.rows || []).length + ' rows, the gate set ' + all.length);
    const rebuilt = canonical(docFrom('gate', committed.rows || [], { over: null, seeds: '0' }));
    if (rebuilt !== committedText) B.diffs(committed, JSON.parse(rebuilt), '', bad);
    if (bad.length) {
      console.error('policy-eval gate, part ' + K + '/' + N + ': DIFFERENT from ' + path.relative(REPO, file) + ':');
      bad.slice(0, 12).forEach(d => console.error('  ' + d));
      process.exit(1);
    }
    console.log('policy-eval gate, part ' + K + '/' + N + ': ' + rows.length + ' runs identical to ' + path.relative(REPO, file) + '; aggregates, parameters and source consistent (' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)');
    return;
  }
  const jobs = jobsFor(set, { arms: arms, ks: ks, seeds: seeds });
  const t0 = Date.now();
  const rows = await rowsFor(jobs, { workers: workers, over: over });
  const doc = docFrom(set, rows, { over: over, seeds: set === 'tune' ? (ks ? ks[0] + '..' + ks[ks.length - 1] : '0..' + ((seeds || TUNE_K) - 1)) : set === 'holdout' ? '100..199' : '0' });
  const text = canonical(doc);
  if (set === 'gate' && argv.includes('--check')) {
    const file = OUT.gate;
    const committed = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (committed !== text) {
      const bad = B.diffs(JSON.parse(committed), doc, '');
      console.error('policy-eval gate: DIFFERENT from ' + path.relative(REPO, file) + ':');
      bad.forEach(d => console.error('  ' + d));
      process.exit(1);
    }
    console.log('policy-eval gate: ' + rows.length + ' runs identical to ' + path.relative(REPO, file) + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    console.log(table(doc));
    return;
  }
  const out = val('--json') || (argv.includes('--write') || set === 'holdout' ? OUT[set] : null);
  if (out) { fs.writeFileSync(out, text); console.error('wrote ' + path.relative(REPO, out)); }
  console.log(table(doc));
}

if (!isMainThread && require.main === module) {
  runJobs(workerData.jobs, workerData.over, row => parentPort.postMessage({ row }))
    .then(() => parentPort.postMessage({ done: true }), e => parentPort.postMessage({ error: (e && e.stack) || String(e) }));
} else if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { rowOf, sourceHash, jobsFor, assertTuning, assertHoldout, holdoutRefusal, rowsFor, docFrom, aggregate, compare, table, canonical, paramsHash, noneRow, OUT, ALL_ARMS, NEW_ARMS, TUNE_K };
