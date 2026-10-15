#!/usr/bin/env node
/* G11b-2: the tuning of practice/learner.js and practice/policy.js on the simulator's TUNING set only
   (tests/practice-sim/policy-eval.js assertTuning: the four `tune` pieces, seeds k < 100). Local; not in CI.

     node tests/practice-sim/policy-tune.js learner --seeds 4 --grid FILE.json [--workers 8]
          the learner's Brier score for every parameter set of the grid (an array of overrides of PPPLearner.DEFAULTS) at once:
          several models watch the SAME laps of the legacy arms and the two open-loop controls (random, through; their choices do
          not depend on the model), each scored on the measure-attempts recentAcc predicts and on every attempt
     node tests/practice-sim/policy-tune.js policy --seeds 8 --grid FILE.json [--learner JSON] [--workers 8]
          the closed loop: the policy arm once per parameter set (an array of overrides of PPPPolicy.DEFAULTS), against the legacy
          arms of the same learners (computed once per seed set and kept in the scratch file --legacy-cache)
   Output: one line per parameter set, and --out FILE with everything. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const REPO = path.resolve(__dirname, '..', '..');
const SIM = require(path.join(REPO, 'practice', 'sim.js'));
const LEARNER = require(path.join(REPO, 'practice', 'learner.js'));
const EV = require('./policy-eval.js');

/* several learner models on the same laps */
function multiObserver(D, grid) {
  const subs = grid.map(g => D.make('observer', { learner: g }));
  const sq = grid.map(() => ({ pn: 0, pm: 0, pl: 0, an: 0, am: 0, ppn: 0, ppm: 0, ppl: 0 }));
  let pending = null;
  return {
    init(c) { subs.forEach(s => s.init(c)); this.c = c; },
    predictor(now, cond) {
      const fns = subs.map(s => s.predictor(now, cond));
      pending = { fns: fns, cond: cond };
      return fns[0];
    },
    afterLap(lap) {
      if (pending) {
        const byM = (lap.result && lap.result.byMeasure) || {};
        const hist = lap.S.history.byMeasure;
        Object.keys(byM).forEach(key => {
          const b = byM[key];
          if (!b || !b.total) return;
          const i = this.c.idx[+key];
          const obs = b.matched / b.total;
          const st = hist[+key];
          let leg = null;
          if (st && st.attempts) leg = lap.E.Learning.measureView(st).recentAcc;
          pending.fns.forEach((fn, gi) => {
            const p = fn(i);
            if (p == null) return;
            const q = sq[gi];
            q.an++; q.am += (p - obs) * (p - obs);
            if (leg != null) {
              q.pn++; q.pm += (p - obs) * (p - obs); q.pl += (leg - obs) * (leg - obs);
              if (!lap.memory) { q.ppn++; q.ppm += (p - obs) * (p - obs); q.ppl += (leg - obs) * (leg - obs); }
            }
          });
        });
        pending = null;
      }
      subs.forEach(s => s.afterLap(lap));
    },
    report() { return { sq: sq }; }
  };
}

async function work(jobs, mode, grid, learnerOver, onRow) {
  const L = require('./app-legacy.js');
  const P = require('./pieces.js');
  const RUN = require('./runner.js');
  const D = require('./drivers.js');
  const env = L.build();
  const pieces = new Map((await P.loadAll(env.E, [...new Set(jobs.map(j => j.piece))])).map(p => [p.id, p]));
  for (const j of jobs) {
    const piece = pieces.get(j.piece);
    if (mode === 'learner') {
      const obs = multiObserver(D, grid);
      let opts;
      if (j.arm === 'coach' || j.arm === 'card') opts = { observer: obs };
      else {
        const drv = D.make(j.arm, {});
        const st = drv.step.bind(drv);
        /* an open-loop control driving, the multi-observer watching */
        opts = { driver: { init: c => { drv.init(c); obs.init(c); }, step: st, predictor: (n, c) => obs.predictor(n, c), afterLap: lap => { drv.afterLap(lap); obs.afterLap(lap); }, report: () => obs.report() } };
      }
      const r = await RUN.simulate(env, piece, j.type, j.k, j.arm, opts);
      onRow({ key: j.key, arm: j.arm, type: j.type, sq: r.driver.sq });
    } else {
      const g = grid[j.g];
      const r = await RUN.simulate(env, piece, j.type, j.k, 'policy', { driver: D.make('policy', { policy: g, learner: learnerOver }) });
      onRow(Object.assign(rowLite(r), { key: j.key, g: j.g, type: j.type }));
    }
  }
}
function rowLite(r) {
  return { minutesCapped: r.minutesToMastery != null ? r.minutesToMastery : r.minutes, reached: r.minutesToMastery != null ? 1 : 0, masteredShareEnd: r.masteredShareEnd,
    retention30: r.retention30, retainedShare30: r.retainedShare30, flipsPerLap: r.flipsPerLap, weakQuartileShare: r.weakQuartileSharePre,
    left: r.handsShare.left + r.handsShare.right, tempo: r.meanTempoRatio,
    brierM: r.brierPaired ? r.brierPaired.model : null, brierL: r.brierPaired ? r.brierPaired.legacy : null, pairN: r.brierPaired ? r.brierPaired.n : 0,
    rejected: r.driver && r.driver.policy ? r.driver.policy.rejected + r.driver.policy.repaired : 0 };
}

async function pool(jobs, mode, grid, learnerOver, workers) {
  const nW = Math.max(1, Math.min(workers, jobs.length));
  const rows = [];
  await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((resolve, reject) => {
    const wk = new Worker(__filename, { workerData: { jobs: jobs.filter((_, i) => i % nW === w), mode, grid, learnerOver } });
    wk.on('message', m => { if (m.row) rows.push(m.row); else if (m.done) resolve(); else if (m.error) reject(new Error(m.error)); });
    wk.on('error', reject);
    wk.on('exit', code => { if (code !== 0) reject(new Error('worker exited ' + code)); });
  })));
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const seeds = +(val('--seeds') || 4);
  const workers = +(val('--workers') || 8);
  const grid = JSON.parse(fs.readFileSync(val('--grid'), 'utf8'));
  const learnerOver = val('--learner') ? JSON.parse(val('--learner')) : undefined;
  const t0 = Date.now();
  if (mode === 'learner') {
    const jobs = EV.jobsFor('tune', { arms: ['coach', 'card', 'through', 'random'], seeds: seeds });
    const rows = await pool(jobs, 'learner', grid, null, workers);
    const res = grid.map((g, gi) => {
      const tot = { pn: 0, pm: 0, pl: 0, an: 0, am: 0, ppn: 0, ppm: 0, ppl: 0 }, byType = {};
      rows.forEach(r => { const q = r.sq[gi]; Object.keys(tot).forEach(k => { tot[k] += q[k]; }); const bt = byType[r.type] || (byType[r.type] = { pn: 0, pm: 0, pl: 0 }); bt.pn += q.pn; bt.pm += q.pm; bt.pl += q.pl; });
      const types = {};
      Object.keys(byType).forEach(t => { types[t] = [+(byType[t].pm / byType[t].pn).toFixed(5), +(byType[t].pl / byType[t].pn).toFixed(5)]; });
      return { g, paired: +(tot.pm / tot.pn).toFixed(6), legacy: +(tot.pl / tot.pn).toFixed(6), all: +(tot.am / tot.an).toFixed(6), practiceOnly: [+(tot.ppm / tot.ppn).toFixed(6), +(tot.ppl / tot.ppn).toFixed(6)], n: tot.pn, types };
    });
    res.forEach(r => console.log(JSON.stringify(r.g), 'paired', r.paired, 'legacy', r.legacy, 'all', r.all, 'practice', JSON.stringify(r.practiceOnly), 'types', JSON.stringify(r.types)));
    if (val('--out')) fs.writeFileSync(val('--out'), JSON.stringify(res, null, 1));
  } else if (mode === 'policy') {
    const base = EV.jobsFor('tune', { arms: ['policy'], seeds: seeds });
    const jobs = [];
    grid.forEach((g, gi) => base.forEach(j => jobs.push(Object.assign({}, j, { g: gi, key: j.key + '|' + gi }))));
    EV.assertTuning(jobs);
    const rows = await pool(jobs, 'policy', grid, learnerOver, workers);
    /* the legacy arms of the same learners, from the cache or computed once */
    const cache = val('--legacy-cache');
    let legacy = cache && fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
    if (!legacy || legacy.seeds !== seeds) {
      const lj = EV.jobsFor('tune', { arms: ['coach', 'card'], seeds: seeds });
      const lr = await EV.rowsFor(lj, { workers: workers, quiet: true });
      const by = {};
      lr.forEach(r => { const k = r.arm + '|' + r.type; (by[k] || (by[k] = [])).push(r); });
      legacy = { seeds: seeds, byArmType: {} };
      Object.keys(by).forEach(k => {
        const a = by[k];
        const mean = f => a.reduce((s, r) => s + r[f], 0) / a.length;
        legacy.byArmType[k] = { minutesCapped: mean('minutesCapped'), retention30: mean('retention30'), retainedShare30: mean('retainedShare30'), masteredShareEnd: mean('masteredShareEnd') };
      });
      if (cache) fs.writeFileSync(cache, JSON.stringify(legacy, null, 1));
    }
    const res = grid.map((g, gi) => {
      const mine = rows.filter(r => r.g === gi);
      const per = {};
      SIM.TYPE_NAMES.forEach(t => {
        const a = mine.filter(r => r.type === t);
        const mean = f => a.reduce((s, r) => s + (r[f] || 0), 0) / a.length;
        const c = legacy.byArmType['coach|' + t], d = legacy.byArmType['card|' + t];
        const lm = Math.min(c.minutesCapped, d.minutesCapped), lret = Math.max(c.retention30, d.retention30);
        let bm = 0, bl = 0, bn = 0;
        a.forEach(r => { if (r.pairN) { bm += r.brierM * r.pairN; bl += r.brierL * r.pairN; bn += r.pairN; } });
        per[t] = { min: +mean('minutesCapped').toFixed(1), ch: +(mean('minutesCapped') / lm - 1).toFixed(4), reached: +mean('reached').toFixed(3), ret: +mean('retention30').toFixed(4), retCh: +(mean('retention30') / lret - 1).toFixed(4),
          retS: +mean('retainedShare30').toFixed(3), flips: +mean('flipsPerLap').toFixed(4), weakQ: +mean('weakQuartileShare').toFixed(3), alone: +mean('left').toFixed(3), tempo: +mean('tempo').toFixed(3), brier: [+(bm / bn).toFixed(5), +(bl / bn).toFixed(5)], bad: a.reduce((s, r) => s + r.rejected, 0) };
      });
      const vals = Object.values(per);
      return { g, meanCh: +(vals.reduce((s, v) => s + v.ch, 0) / vals.length).toFixed(4), worstCh: Math.max(...vals.map(v => v.ch)), meanRetCh: +(vals.reduce((s, v) => s + v.retCh, 0) / vals.length).toFixed(4), minRetCh: Math.min(...vals.map(v => v.retCh)), maxFlips: Math.max(...vals.map(v => v.flips)), per };
    });
    res.forEach(r => console.log(JSON.stringify(r.g), 'meanCh', r.meanCh, 'worstCh', r.worstCh, 'meanRetCh', r.meanRetCh, 'minRetCh', r.minRetCh, 'maxFlips', r.maxFlips,
      Object.keys(r.per).map(t => t + ':' + r.per[t].min + '/' + r.per[t].ret + '/' + r.per[t].reached + '/wq' + r.per[t].weakQ + '/h' + r.per[t].alone + '/t' + r.per[t].tempo).join(' ')));
    if (val('--out')) fs.writeFileSync(val('--out'), JSON.stringify(res, null, 1));
  } else throw new Error('mode: learner | policy');
  process.stderr.write(((Date.now() - t0) / 1000).toFixed(1) + ' s\n');
}

if (!isMainThread && require.main === module) {
  work(workerData.jobs, workerData.mode, workerData.grid, workerData.learnerOver, row => parentPort.postMessage({ row }))
    .then(() => parentPort.postMessage({ done: true }), e => parentPort.postMessage({ error: (e && e.stack) || String(e) }));
} else if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
