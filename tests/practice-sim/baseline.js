#!/usr/bin/env node
/* G11b-0: the LEGACY baseline of the practice simulator (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4, §10 row G11b-0).

     node tests/practice-sim/baseline.js --check [--part K/N]   the gate: recompute the gate set (or its K-th of N slices)
                                                                 and compare with the committed file
     node tests/practice-sim/baseline.js --write                rewrite tests/practice-sim/baselines/legacy-gate.json
     node tests/practice-sim/baseline.js --full --check|--write the doc's scale: 200 learners x 6 types x 8 pieces x 3 arms
                                                                 (28,800 runs, 47 minutes on 14 threads of an 8-core PC), aggregates
                                                                 only, legacy-full.json. Local, not in the gate.
     --workers N   worker threads (default: the CPUs, at most 8). The result depends on neither N nor the order.
     --reverse     run the jobs in reverse order (the determinism check; the file is the same)
     --table       print the per-arm, per-type table of a committed file

   Sets. A learner is (piece, type, k); the arms (coach, card, oracle; tests/practice-sim/runner.js) play the SAME learner
   (same parameters, same random stream), so the arms are a paired comparison. Seeds k < 100 are TUNING seeds, k >= 100
   HOLD-OUT seeds; pieces are `tune` or `holdout` (tests/practice-sim/pieces.js). G11b-2 fits only on tuning seeds of
   tune pieces and reports the hold-out cells. The gate set is k = 0 (a tuning seed) for every type x piece x arm: 144
   runs, kept per learner and aggregated. The full set is k = 0..199, aggregated.

   --part K/N recomputes only the rows whose index (in key order) is K-1 mod N and compares them with the committed rows,
   then rebuilds the whole document from the COMMITTED rows and compares that (aggregates, configuration): the N parts
   together check everything the unsliced check does, so the gate can spread the work over N jobs.

   The file: the configuration (the runner's CFG, the arms, every learner type's ranges, the pieces with the sha256 of
   each file, the G6 difficulty map), the app code the runner ran (the names of the extracted declarations and methods;
   their sha256 is printed, not stored, so an app change that leaves the results alone does not need a rewrite), the
   rows and the aggregates. Canonical JSON, compared byte for byte (written on Windows, checked on Linux in CI). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const REPO = path.resolve(__dirname, '..', '..');
const SIM = require(path.join(REPO, 'practice', 'sim.js'));
const OUT = { gate: path.join(__dirname, 'baselines', 'legacy-gate.json'), full: path.join(__dirname, 'baselines', 'legacy-full.json') };
const SCHEMA = 'ppp.practice-sim-baseline/1';
const METRICS = ['reached', 'minutesToMastery', 'minutesCapped', 'masteredShareEnd', 'retention30', 'retainedShare30',
  'weakQuartileShare', 'masteredTimeShare', 'flipsPerSession', 'flipsPerLap', 'longestStreak', 'brier', 'brierOracle',
  'laps', 'minutes', 'leftShare', 'rightShare', 'memoryLapShare', 'meanTempoRatio', 'memorizedShare'];

function jobsOf(set, pieces, types, arms) {
  const ks = set === 'full' ? Array.from({ length: 200 }, (_, i) => i) : [0];
  const out = [];
  arms.forEach(a => pieces.forEach(p => types.forEach(t => ks.forEach(k => out.push({ piece: p, type: t, k: k, arm: a })))));
  out.forEach(j => { j.key = keyOf(j); });
  return out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
function keyOf(j) { return [j.arm, j.piece, j.type, String(j.k).padStart(4, '0')].join('|'); }

/* one learner's row, rounded to 6 digits */
function rowOf(r) {
  const R6 = x => SIM.round(x, 6);
  return {
    key: keyOf(r), piece: r.piece, split: r.split, type: r.type, k: r.k, arm: r.arm, seed: r.seed,
    reached: r.minutesToMastery != null ? 1 : 0, minutesToMastery: R6(r.minutesToMastery),
    /* censored at what the learner practised: one that never got there counts with all of its minutes */
    minutesCapped: R6(r.minutesToMastery != null ? r.minutesToMastery : r.minutes),
    masteredShareEnd: R6(r.masteredShareEnd), retention30: R6(r.retention30), retainedShare30: R6(r.retainedShare30),
    weakQuartileShare: R6(r.weakQuartileShare), masteredTimeShare: R6(r.masteredTimeShare),
    flipsPerSession: R6(r.flipsPerSession), flipsPerLap: R6(r.flipsPerLap), longestStreak: r.longestStreak,
    brier: R6(r.brier), brierOracle: R6(r.brierOracle), brierN: r.brierN,
    laps: r.laps, minutes: R6(r.minutes),
    leftShare: R6(r.handsShare.left), rightShare: R6(r.handsShare.right), memoryLapShare: R6(r.memoryLapShare),
    meanTempoRatio: R6(r.meanTempoRatio), memorizedShare: R6(r.memorizedSections / r.sections)
  };
}

function aggregate(rows) {
  const out = { n: rows.length };
  METRICS.forEach(name => {
    const s = SIM.summary(rows.map(r => r[name]));
    out[name] = { n: s.n, mean: SIM.round(s.mean, 4), median: SIM.round(s.median, 4) };
  });
  /* the Brier over every measure-attempt of the group (weighted by attempts, not a mean of per-learner scores) */
  let n = 0, s = 0, so = 0;
  rows.forEach(r => { if (r.brierN) { n += r.brierN; s += r.brier * r.brierN; so += r.brierOracle * r.brierN; } });
  out.brierPooled = n ? SIM.round(s / n, 6) : null;
  out.brierOraclePooled = n ? SIM.round(so / n, 6) : null;
  out.brierN = n;
  return out;
}
function groupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  const o = {};
  [...m.keys()].sort().forEach(k => { o[k] = aggregate(m.get(k)); });
  return o;
}
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

/* one thread: build the app once, load the pieces it needs, play its jobs in the order given */
async function runJobs(jobs, onRow) {
  const L = require('./app-legacy.js');
  const P = require('./pieces.js');
  const RUN = require('./runner.js');
  const env = L.build();
  const pieces = new Map((await P.loadAll(env.E, [...new Set(jobs.map(j => j.piece))])).map(p => [p.id, p]));
  for (const j of jobs) onRow(rowOf(await RUN.simulate(env, pieces.get(j.piece), j.type, j.k, j.arm)));
}

async function rowsFor(jobs, opts) {
  opts = opts || {};
  const list = opts.reverse ? jobs.slice().reverse() : jobs;
  const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  const nW = Math.max(1, Math.min(opts.workers || Math.min(8, cpus), list.length));
  const rows = [];
  const t0 = Date.now();
  if (nW === 1) await runJobs(list, r => rows.push(r));
  else {
    await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((resolve, reject) => {
      const wk = new Worker(__filename, { workerData: { jobs: list.filter((_, i) => i % nW === w) } });
      wk.on('message', m => { if (m.row) rows.push(m.row); else if (m.done) resolve(); else if (m.error) reject(new Error(m.error)); });
      wk.on('error', reject);
      wk.on('exit', code => { if (code !== 0) reject(new Error('worker exited ' + code)); });
    })));
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!opts.quiet) process.stderr.write(rows.length + ' runs in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s on ' + nW + ' thread(s)\n');
  return rows;
}

function docFrom(set, rows) {
  const P = require('./pieces.js');
  const L = require('./app-legacy.js');
  const RUN = require('./runner.js');
  const x = L.extract();
  return {
    schema: SCHEMA, tool: 'tests/practice-sim/baseline.js', simVersion: SIM.VERSION, set: set,
    note: 'Synthetic learners are assumptions, not data (practice/sim.js). coach and card are what the LEGACY policy - the app\'s own Learning, Memory and Coach, run from the app file - does with them; oracle reads the simulator\'s ground truth and is a reference, not a policy. None of it says how a real pupil learns (that is H-11).',
    config: {
      cfg: RUN.CFG, arms: RUN.ARMS, legacyArms: RUN.LEGACY_ARMS,
      seeds: set === 'full' ? 'k = 0..199 (tuning k < 100, hold-out k >= 100)' : 'k = 0 (a tuning seed)',
      types: SIM.TYPE_NAMES.map(t => ({ type: t, ranges: SIM.rangesOf(t) })),
      pieces: P.PIECES.map(p => ({ id: p.id, family: p.family, split: p.split, file: p.file, sha256: sha(P.pieceBytes(p.file)) })),
      difficultyMap: { base: P.D_BASE, slope: P.D_SLOPE, min: P.D_MIN, max: P.D_MAX }
    },
    appCode: { declarations: x.engines.map(c => c.name), methods: x.methods.map(m => m.name).concat(['startToday (render values)', 'state (class field)']) },
    aggregates: {
      byArm: groupBy(rows, r => r.arm),
      byArmType: groupBy(rows, r => r.arm + '|' + r.type),
      byArmTypeSplit: groupBy(rows, r => r.arm + '|' + r.type + '|' + r.split),
      byArmPiece: groupBy(rows, r => r.arm + '|' + r.piece)
    },
    rows: set === 'full' ? undefined : rows
  };
}
function appSha() {
  const x = require('./app-legacy.js').extract();
  return sha(x.engines.map(c => c.text).join('\n') + '\n' + x.methods.map(m => m.text).join('\n') + '\n' + x.stateInit + '\n' + x.startToday);
}
function canonical(doc) { return JSON.stringify(doc, null, 1) + '\n'; }

async function compute(set, opts) {
  const P = require('./pieces.js');
  const RUN = require('./runner.js');
  opts = opts || {};
  const jobs = jobsOf(set, opts.pieces || P.PIECES.map(p => p.id), opts.types || SIM.TYPE_NAMES, opts.arms || RUN.ARMS);
  const rows = await rowsFor(jobs, opts);
  return { rows, doc: docFrom(set, rows) };
}

/* the first places two values differ */
function diffs(a, b, p, out) {
  out = out || [];
  if (out.length >= 12) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => diffs(a[k], b[k], p + '.' + k, out));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push((p || '.') + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b));
  return out;
}

function table(doc) {
  const A = doc.aggregates.byArmType;
  const cols = [['n', a => a.n], ['reached', a => a.reached.mean], ['min->mastery', a => a.minutesToMastery.mean], ['minCapped', a => a.minutesCapped.mean],
    ['masteredEnd', a => a.masteredShareEnd.mean], ['ret30', a => a.retention30.mean], ['retained30', a => a.retainedShare30.mean],
    ['weakQ', a => a.weakQuartileShare.mean], ['onMastered', a => a.masteredTimeShare.mean], ['flips/s', a => a.flipsPerSession.mean],
    ['flips/lap', a => a.flipsPerLap.mean], ['streak', a => a.longestStreak.mean], ['brier', a => a.brierPooled], ['brierOracle', a => a.brierOraclePooled],
    ['memLaps', a => a.memoryLapShare.mean], ['tempo', a => a.meanTempoRatio.mean]];
  const lines = [['arm|type'].concat(cols.map(c => c[0])).join(' | ')];
  Object.keys(A).forEach(k => lines.push([k].concat(cols.map(c => { const v = c[1](A[k]); return v == null ? '-' : String(Math.round(v * 1000) / 1000); })).join(' | ')));
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const set = argv.includes('--full') ? 'full' : 'gate';
  const num = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const file = OUT[set];
  const rel = path.relative(REPO, file).replace(/\\/g, '/');
  if (argv.includes('--table')) { console.log(table(JSON.parse(fs.readFileSync(file, 'utf8')))); return; }
  const opts = { workers: num('--workers') ? +num('--workers') : undefined, reverse: argv.includes('--reverse') };
  process.stderr.write('app practice code sha256 ' + appSha().slice(0, 16) + '\n');

  if (argv.includes('--write')) {
    const { doc } = await compute(set, opts);
    const text = canonical(doc);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log('wrote ' + rel + ' (' + text.length + ' bytes)');
    return;
  }
  if (!fs.existsSync(file)) { console.error('no ' + rel + ': run with --write'); process.exit(1); }
  const committedText = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const committed = JSON.parse(committedText);
  const fail = lines => {
    console.error('practice-sim ' + set + ' baseline: DIFFERENT from ' + rel + ':');
    lines.forEach(d => console.error('  ' + d));
    console.error('If the change is intended (the simulator, the runner or the app\'s practice code changed what the legacy policy does), rewrite it with --write and say why in the commit.');
    process.exit(1);
  };

  const part = num('--part');
  if (part) {
    if (set === 'full') { console.error('--part is for the gate set'); process.exit(2); }
    const m = /^(\d+)\/(\d+)$/.exec(part);
    const K = m ? +m[1] : 0, N = m ? +m[2] : 0;
    if (!(K >= 1 && K <= N)) { console.error('--part K/N with 1 <= K <= N'); process.exit(2); }
    const P = require('./pieces.js');
    const RUN = require('./runner.js');
    const all = jobsOf(set, P.PIECES.map(p => p.id), SIM.TYPE_NAMES, RUN.ARMS);
    const mine = all.filter((_, i) => i % N === K - 1);
    const rows = await rowsFor(mine, opts);
    const byKey = new Map((committed.rows || []).map(r => [r.key, r]));
    const bad = [];
    rows.forEach(r => { const c = byKey.get(r.key); if (!c) bad.push(r.key + ': not in the committed rows'); else diffs(c, r, r.key, bad); });
    if ((committed.rows || []).length !== all.length) bad.push('the committed file has ' + (committed.rows || []).length + ' rows, the gate set ' + all.length);
    /* the rest of the document, rebuilt from the committed rows: aggregates and configuration are what they must be */
    const rebuilt = canonical(docFrom(set, committed.rows || []));
    if (rebuilt !== committedText) diffs(committed, JSON.parse(rebuilt), '', bad);
    if (bad.length) fail(bad);
    console.log('practice-sim gate baseline, part ' + K + '/' + N + ': ' + rows.length + ' runs identical to ' + rel + '; aggregates and configuration consistent');
    return;
  }
  const { doc } = await compute(set, opts);
  const text = canonical(doc);
  if (text !== committedText) fail(diffs(committed, JSON.parse(text), ''));
  console.log('practice-sim ' + set + ' baseline: identical (' + rel + ')');
}

if (!isMainThread) {
  runJobs(workerData.jobs, row => parentPort.postMessage({ row }))
    .then(() => parentPort.postMessage({ done: true }), e => parentPort.postMessage({ error: (e && e.stack) || String(e) }));
} else if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { compute, rowsFor, docFrom, canonical, jobsOf, rowOf, aggregate, table, diffs, METRICS, OUT };
