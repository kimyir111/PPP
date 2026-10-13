#!/usr/bin/env node
/* omr-live-2 (G12-3): fit omr/flags.js' PARAMS on the TUNING half and judge them once on the other half.

     node tests/omr/node/flags-fit.js table [--data DIR]                 per-signal precision / recall on the tuning half, and how often each fires on truth files
     node tests/omr/node/flags-fit.js fit [--data DIR] [--out FILE]      choose which signals are strong, which weak, and every threshold; cross-validated inside the tuning half
     node tests/omr/node/flags-fit.js eval --params FILE [--half tune]   a PARAMS on the tuning half
     node tests/omr/node/flags-fit.js eval --params FILE --half held     the held-out half: ONCE (refuses a second time without --again; it says so in its output)

   DIR (default tests/omr/out/flags) is written by `python tests/bench/run.py omr-live-2 flags-data`: tune.jsonl, held.jsonl, truth.jsonl, held-truth.jsonl.
   `fit` and `table` read only tune.jsonl and truth.jsonl; held.jsonl and held-truth.jsonl are opened by `eval --half held` and by nothing else.

   The rule being fitted (omr/flags.js): a bar is suspect when ANY strong signal fires or TWO weak ones. Fitting is a greedy forward selection of
   weak signals (each with a grid of thresholds) under the targets of gate A3, with a margin:
     recall >= 0.90 on clean and scan, >= 0.85 on photo; precision >= PRECISION_FLOOR on every tier; <= TRUTH_MAX flags per 20 bars on truth files.
   A signal is STRONG when, on the tuning half, it is right at least STRONG_PRECISION of the time, fires at least STRONG_MIN times, and fires at most
   STRONG_TRUTH_MAX per 20 bars on truth files. Nothing else is learned. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const F = require(path.join(REPO, 'omr', 'flags.js'));

const GROUPS = ['clean', 'scan', 'photo'];
const TARGET = { clean: 0.90, scan: 0.90, photo: 0.85 };
const MARGIN = 1.04;                  /* stop adding when every tier is 4 % above its target on the tuning half: room for the other half */
const PRECISION_FLOOR = 0.65;         /* the gate says 0.60 */
const TRUTH_MAX = 0.9;                /* the gate says 1 flag per 20 bars on a truth file */
const STRONG_PRECISION = 0.85, STRONG_MIN = 25, STRONG_TRUTH_MAX = 0.15;
const SPECIAL = new Set(['bad-page', 'next-to-bad', 'page-bars']);
/* strong by what they ARE, not by a statistic (the benchmark replay has too few of them to count, or none): the importer or the normaliser says
   that content was lost. They stay strong whatever the table says. `page-bars` is not here: the bars per line PdfLayer finds were measured on the app
   path (G12 section 23) and are not good enough to flag a bar by, so the signal is unused until a layout source is. */
const DESIGN_STRONG = ['fill-overlap', 'dropped', 'unreadable-lengths'];
const THR_GRID = {
  leap: [12, 15, 17, 19, 21, 24], sparse: [0.4, 0.5, 0.6, 0.7, 0.8], voiceLoss: [1], badPage: [0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
  offKey: [1, 2, 3, 4], ledger: [3, 4, 5], xMis: [10, 15, 20, 30], dense: [1.3, 1.5, 1.8, 2.2]
};
const THR_OF = { 'big-leap': 'leap', 'sparse': 'sparse', 'voice-loss': 'voiceLoss', 'bad-page': 'badPage', 'off-key': 'offKey', 'ledger': 'ledger', 'x-misaligned': 'xMis', 'dense': 'dense' };

const sha = file => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const groupOf = tier => (tier.startsWith('clean') ? 'clean' : tier.startsWith('scan') ? 'scan' : tier.startsWith('photo') ? 'photo' : tier);

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
/* rows -> documents: {key, case, tier, group, feat, normalize, wrong: [bool]} */
function documents(rows) {
  const by = new Map();
  rows.forEach(r => { const k = r.case + '|' + r.tier; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  const docs = [];
  by.forEach((rs, key) => {
    rs.sort((a, b) => a.bar - b.bar);
    const flags = {};
    rs.forEach(r => { if (r.n && r.n.length) flags[r.bar] = r.n; });
    docs.push({ key, case: rs[0].case, tier: rs[0].tier, group: groupOf(rs[0].tier), feat: F.derive({ bars: rs.map(r => r.raw), doc: Object.assign({}, rs[0].doc) }), normalize: { flags },
      wrong: rs.map(r => !!r.wrong), cause: rs.map(r => r.cause) });
  });
  docs.sort((a, b) => (a.key < b.key ? -1 : 1));
  return docs;
}

function score(docs, truthDocs, params) {
  const t = {};
  GROUPS.forEach(g => { t[g] = { bars: 0, wrong: 0, flagged: 0, tp: 0 }; });
  docs.forEach(d => {
    const res = F.decide(d.feat, { normalize: d.normalize }, params);
    const s = t[d.group];
    if (!s) return;
    res.forEach((b, i) => { s.bars++; s.wrong += d.wrong[i]; s.flagged += b.suspect; s.tp += b.suspect && d.wrong[i]; });
  });
  let tBars = 0, tFlag = 0;
  truthDocs.forEach(d => { const res = F.decide(d.feat, { normalize: d.normalize }, params); tBars += res.length; tFlag += res.filter(b => b.suspect).length; });
  const out = { groups: {}, truthPer20: tBars ? 20 * tFlag / tBars : 0, truthFlags: tFlag, truthBars: tBars };
  GROUPS.forEach(g => { const s = t[g]; out.groups[g] = Object.assign({}, s, { recall: s.wrong ? s.tp / s.wrong : 1, precision: s.flagged ? s.tp / s.flagged : 1 }); });
  return out;
}
/* the objective: feasible first; then the weakest tier against its target, up to MARGIN (more recall than that is no reason to flag more);
   then the precision (fewer flags); then the mean recall */
function value(r) {
  /* how far from feasible: precision under its floor on a tier, flags on truth files over their allowance (both counted in the same unit) */
  const penalty = GROUPS.reduce((s, g) => s + Math.max(0, PRECISION_FLOOR - r.groups[g].precision), 0) + Math.max(0, r.truthPer20 - TRUTH_MAX) / 20;
  const minRatio = Math.min(MARGIN, Math.min.apply(null, GROUPS.map(g => r.groups[g].recall / TARGET[g])));
  const meanR = GROUPS.reduce((s, g) => s + r.groups[g].recall, 0) / GROUPS.length;
  const meanP = GROUPS.reduce((s, g) => s + r.groups[g].precision, 0) / GROUPS.length;
  return { penalty, feasible: penalty <= 1e-12, minRatio, meanR, meanP };
}
const better = (a, b) => {
  if (!b) return true;
  if (Math.abs(a.penalty - b.penalty) > 1e-9) return a.penalty < b.penalty;
  if (Math.abs(a.minRatio - b.minRatio) > 1e-9) return a.minRatio > b.minRatio;
  if (Math.abs(a.meanP - b.meanP) > 1e-9) return a.meanP > b.meanP;
  return a.meanR > b.meanR;
};
const fmt = r => GROUPS.map(g => g + ' R ' + r.groups[g].recall.toFixed(3) + ' P ' + r.groups[g].precision.toFixed(3) + ' (' + r.groups[g].tp + '/' + r.groups[g].wrong + ', ' + r.groups[g].flagged + ' flagged)').join(' | ') + ' | truth ' + r.truthPer20.toFixed(2) + '/20 bars';

/* ---------------------------------------------------------------- per-signal table */
function firing(docs, code, thr) {
  const out = [];
  docs.forEach(d => {
    const c = { thr, n: [], shown: null, badPage: 0, nextToBad: false };
    d.feat.bars.forEach((b, i) => {
      c.n = (d.normalize.flags[i + 1]) || [];
      out.push({ group: d.group, wrong: d.wrong[i], fired: !!F.SIGNALS[code].test(b, c), case: d.case });
    });
  });
  return out;
}
function table(docs, truthDocs, thr) {
  const rows = [];
  F.CODES.filter(c => !SPECIAL.has(c)).forEach(code => {
    const f = firing(docs, code, thr), tf = firing(truthDocs, code, thr);
    const line = { code, n: 0, tp: 0, truth: tf.filter(x => x.fired).length, truthBars: tf.length };
    GROUPS.forEach(g => { const xs = f.filter(x => x.group === g); const fl = xs.filter(x => x.fired), w = xs.filter(x => x.wrong).length; line[g] = { n: fl.length, p: fl.length ? fl.filter(x => x.wrong).length / fl.length : null, r: w ? fl.filter(x => x.wrong).length / w : null }; });
    const fl = f.filter(x => x.fired);
    line.n = fl.length; line.tp = fl.filter(x => x.wrong).length;
    line.precision = line.n ? line.tp / line.n : null;
    line.truthPer20 = line.truthBars ? 20 * line.truth / line.truthBars : 0;
    rows.push(line);
  });
  return rows;
}
function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('signal', 20), pad('n', 6), pad('precision', 10), GROUPS.map(g => pad(g + ' n/P/R', 22)).join(''), 'truth /20 bars');
  rows.forEach(r => console.log(pad(r.code, 20), pad(r.n, 6), pad(r.precision === null ? '-' : r.precision.toFixed(2), 10),
    GROUPS.map(g => pad(r[g].n + ' / ' + (r[g].p === null ? '-' : r[g].p.toFixed(2)) + ' / ' + (r[g].r === null ? '-' : r[g].r.toFixed(2)), 22)).join(''), r.truthPer20.toFixed(2)));
}

/* ---------------------------------------------------------------- the fit */
/* Start with every candidate weak signal at its default threshold, then move one thing at a time (drop a signal, add one back, change a
   threshold) while the objective improves. A single weak signal never flags a bar (TWO are needed), so signals cannot be added one by one. */
function fit(docs, truthDocs, log) {
  const thr0 = Object.assign({}, F.PARAMS.thr);
  const rows = table(docs, truthDocs, thr0);
  const byRule = rows.filter(r => r.n >= STRONG_MIN && r.precision >= STRONG_PRECISION && r.truthPer20 <= STRONG_TRUTH_MAX).map(r => r.code);
  const strong = Array.from(new Set(DESIGN_STRONG.concat(byRule))).filter(c => F.CODES.includes(c));
  const candidates = F.CODES.filter(c => !strong.includes(c) && c !== 'page-bars');
  let params = { strong: strong.slice(), weak: candidates.slice(), weakNeeded: 2, thr: thr0 };
  let cur = score(docs, truthDocs, params), curV = value(cur);
  log('strong by the rule: ' + strong.join(', '));
  log('start (every candidate weak): ' + fmt(cur));
  for (let step = 0; step < 60; step++) {
    let best = null;
    const tryP = (p, what) => { const r = score(docs, truthDocs, p), val = value(r); if (better(val, curV) && better(val, best && best.val) && (val.penalty < curV.penalty - 1e-9 || val.minRatio > curV.minRatio + 0.002 || val.meanP > curV.meanP + 0.002)) best = { p, r, val, what }; };
    candidates.forEach(code => {
      const has = params.weak.includes(code);
      tryP({ strong: params.strong, weak: has ? params.weak.filter(c => c !== code) : params.weak.concat([code]), weakNeeded: 2, thr: params.thr }, (has ? 'drop ' : 'add ') + code);
      const key = THR_OF[code];
      if (key && has) THR_GRID[key].forEach(v => { if (v !== params.thr[key]) tryP({ strong: params.strong, weak: params.weak, weakNeeded: 2, thr: Object.assign({}, params.thr, { [key]: v }) }, 'set ' + key + ' ' + v); });
    });
    if (!best) break;
    params = best.p; cur = best.r; curV = best.val;
    log(best.what + ' -> ' + fmt(cur));
  }
  /* the smallest rule that is as good as the one found (measured against that one, so the drift of many small prunes cannot add up): a weak
     signal whose removal changes nothing that matters goes */
  const base = curV;
  for (let again = true; again;) {
    again = false;
    for (const code of params.weak.slice()) {
      const p = { strong: params.strong, weak: params.weak.filter(c => c !== code), weakNeeded: 2, thr: params.thr };
      const r = score(docs, truthDocs, p), val = value(r);
      if (val.penalty <= base.penalty + 1e-9 && val.minRatio >= base.minRatio - 0.003 && val.meanP >= base.meanP - 0.003) {
        params = p; cur = r; curV = val; again = true; log('prune ' + code + ' -> ' + fmt(cur)); break;
      }
    }
  }
  return { params, result: cur, table: rows };
}

/* folds by case: fit on four fifths, judge on the fifth that was left out (all inside the tuning half) */
function crossValidate(docs, truthDocs, k) {
  const cases = Array.from(new Set(docs.map(d => d.case))).sort();
  const fold = new Map(cases.map((c, i) => [c, i % k]));
  const pooled = {};
  GROUPS.forEach(g => { pooled[g] = { wrong: 0, tp: 0, flagged: 0 }; });
  let tBars = 0, tFlag = 0;
  for (let f = 0; f < k; f++) {
    const train = docs.filter(d => fold.get(d.case) !== f), test = docs.filter(d => fold.get(d.case) === f);
    const trT = truthDocs.filter(d => fold.get(d.case) !== f), teT = truthDocs.filter(d => fold.get(d.case) === f);
    const { params } = fit(train, trT, () => {});
    const r = score(test, teT, params);
    GROUPS.forEach(g => { pooled[g].wrong += r.groups[g].wrong; pooled[g].tp += r.groups[g].tp; pooled[g].flagged += r.groups[g].flagged; });
    tBars += r.truthBars; tFlag += r.truthFlags;
  }
  const out = { groups: {}, truthPer20: tBars ? 20 * tFlag / tBars : 0, truthFlags: tFlag, truthBars: tBars };
  GROUPS.forEach(g => { const s = pooled[g]; out.groups[g] = Object.assign({ bars: 0 }, s, { recall: s.wrong ? s.tp / s.wrong : 1, precision: s.flagged ? s.tp / s.flagged : 1 }); });
  return out;
}

/* ---------------------------------------------------------------- main */
function load(dir, half) {
  const rows = readJsonl(path.join(dir, half + '.jsonl'));
  const truth = readJsonl(path.join(dir, half === 'held' ? 'held-truth.jsonl' : 'truth.jsonl'));
  return { docs: documents(rows), truthDocs: documents(truth) };
}

function main() {
  const cmd = process.argv[2];
  const dir = arg('--data', path.join(REPO, 'tests', 'omr', 'out', 'flags'));
  if (cmd === 'table') {
    const { docs, truthDocs } = load(dir, 'tune');
    printTable(table(docs, truthDocs, F.PARAMS.thr));
  } else if (cmd === 'fit') {
    const { docs, truthDocs } = load(dir, 'tune');
    const res = fit(docs, truthDocs, s => console.log(s));
    console.log('\nFIT on the tuning half: ' + fmt(res.result));
    console.log(JSON.stringify(res.params));
    const cv = crossValidate(docs, truthDocs, 5);
    console.log('\n5-fold cross-validation inside the tuning half (fit on 4/5 of the cases, judged on the rest): ' + fmt(cv));
    const out = arg('--out', null);
    const record = {
      about: 'The fit of omr/flags.js PARAMS on the TUNING half of omr-live-2 (tests/omr/node/flags-fit.js fit --record). A test compares params with omr/flags.js.',
      procedure: { precisionFloor: PRECISION_FLOOR, truthMax: TRUTH_MAX, margin: MARGIN, target: TARGET, strongPrecision: STRONG_PRECISION, strongMin: STRONG_MIN, strongTruthMax: STRONG_TRUTH_MAX,
        designStrong: DESIGN_STRONG, grids: THR_GRID, folds: 5 },
      data: { tuneSha256: sha(path.join(dir, 'tune.jsonl')), truthSha256: sha(path.join(dir, 'truth.jsonl')), tuneBars: docs.reduce((s, d) => s + d.wrong.length, 0), truthBars: truthDocs.reduce((s, d) => s + d.wrong.length, 0) },
      params: res.params, tune: res.result, crossValidation: cv, signals: res.table.map(r => ({ code: r.code, n: r.n, precision: r.precision, truthPer20: r.truthPer20 }))
    };
    if (out) fs.writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
    if (process.argv.includes('--record')) {
      const target = path.join(REPO, 'tests', 'omr', 'flags', 'flags-fit.json');
      let old = null;
      try { old = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { old = null; }
      if (old && old.heldOut) record.heldOut = old.heldOut;
      fs.writeFileSync(target, JSON.stringify(record, null, 1) + '\n');
      console.log('recorded ' + path.relative(REPO, target));
    }
  } else if (cmd === 'eval') {
    const half = arg('--half', 'tune');
    const params = JSON.parse(fs.readFileSync(arg('--params'), 'utf8'));
    const p = params.params || params;
    if (half === 'held') {
      const mark = path.join(dir, 'held-evaluated.json');
      if (fs.existsSync(mark) && !process.argv.includes('--again')) {
        console.log('REFUSED: the held-out half was judged already (' + fs.readFileSync(mark, 'utf8').trim().slice(0, 200) + '). A second look is tuning on it. --again if you must, and say so.');
        process.exit(3);
      }
      const { docs, truthDocs } = load(dir, 'held');
      const r = score(docs, truthDocs, p);
      fs.writeFileSync(mark, JSON.stringify({ at: new Date().toISOString(), params: p, result: r }) + '\n');
      console.log('HELD-OUT (once): ' + fmt(r));
      console.log(JSON.stringify(r));
      if (process.argv.includes('--record')) {
        const target = path.join(REPO, 'tests', 'omr', 'flags', 'flags-fit.json');
        const rec = JSON.parse(fs.readFileSync(target, 'utf8'));
        rec.heldOut = { at: new Date().toISOString(), heldSha256: sha(path.join(dir, 'held.jsonl')), heldTruthSha256: sha(path.join(dir, 'held-truth.jsonl')), result: r };
        fs.writeFileSync(target, JSON.stringify(rec, null, 1) + '\n');
        console.log('recorded the held-out result in ' + path.relative(REPO, target));
      }
    } else {
      const { docs, truthDocs } = load(dir, 'tune');
      const r = score(docs, truthDocs, p);
      console.log('tune: ' + fmt(r));
    }
  } else if (cmd === 'record-held') {
    /* put the one held-out evaluation (held-evaluated.json, written by `eval --half held`) into the record beside the fit; it changes nothing else */
    const mark = JSON.parse(fs.readFileSync(path.join(dir, 'held-evaluated.json'), 'utf8'));
    const target = path.join(REPO, 'tests', 'omr', 'flags', 'flags-fit.json');
    const rec = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (JSON.stringify(mark.params) !== JSON.stringify(rec.params)) { console.log('REFUSED: the held-out half was judged with other parameters than the record holds'); process.exit(3); }
    rec.heldOut = { at: mark.at, heldSha256: sha(path.join(dir, 'held.jsonl')), heldTruthSha256: sha(path.join(dir, 'held-truth.jsonl')), result: mark.result };
    fs.writeFileSync(target, JSON.stringify(rec, null, 1) + '\n');
    console.log('recorded the held-out result in ' + path.relative(REPO, target));
  } else {
    console.log('usage: flags-fit.js table|fit|eval|record-held [--data DIR] [--out FILE] [--params FILE] [--half tune|held] [--record]');
    process.exit(2);
  }
}
if (require.main === module) main();
module.exports = { documents, score, value, fit, table, crossValidate, GROUPS, TARGET };
