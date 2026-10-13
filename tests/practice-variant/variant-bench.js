#!/usr/bin/env node
/* G11c-0 benchmark (docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 8.2, "Benchmark (G11c-0)"): how often can the passage splice of practice/variant.js
   make an easier (or harder) version of 4 bars of a piece, and when it cannot, why not. It is also the proof that it never hands back a broken score:
   every accepted splice goes through tests/practice-variant/variant-verify.js, which reads the result with code of its own. "verification failures" must be 0.

     node tests/practice-variant/variant-bench.js --full [--out result.json] [--shard I/N] [--engrave]     the 325 catalogue pieces + the recording covers
     node tests/practice-variant/variant-bench.js --check [--live]                                          the CI sample against tests/practice-variant/variant-bench.baseline.json (on the
                                                                                                            frozen variants of fixtures/sample-variants.json; --live: on the arranger as it is now)
     node tests/practice-variant/variant-bench.js --freeze                                                  write fixtures/sample-variants.json from the arranger as it is now
     node tests/practice-variant/variant-bench.js --only substring ...                                      pieces whose id contains the text
     node tests/practice-variant/variant-bench.js --merge a.json b.json ... --out result.json               join the shards of a --full run (concatenate pieces)
     node tests/practice-variant/variant-bench.js --record                                                  rewrite the baseline from a --full result given with --in

   What is measured. Every piece is a BASE; its variant is the arranger's work on the whole piece (the app's own glue, tests/realize/app-single-extract.js):
     easier   base = the piece as written, variant = arrangeSingleNote at the level one step below the piece's G6 stage (beginner for stage 1-2,
              intermediate for stage 3); a recording's variant is its lead sheet at 'beginner' (recordingArrange 'leadsheet', rec/leadsheet.js)
     harder   base = that arrangement (the copy the person practises), variant = the piece as written (the source the copy was arranged from)
     up       base = that same arrangement, variant = the arrangement one level up (intermediate / advanced; a recording's lead sheet at 'intermediate')
   and 10 seeded 4-bar windows (distinct starts, seeded by the piece's id) in each direction. The result of a window is one character:
     A accepted     I identical (the bars sound the same in both)     E not easier / not harder (G6)     S seam (a hand cannot cross it, even widened)
     T timeline     P parts     F staves     X invalid (validator)     N notation (checker)     H hard (G5)     O any other refusal
     V accepted, but the independent verification found something: a VERIFICATION FAILURE (the number that must be 0)
     -  no variant: the arranger refused the piece (not a splice outcome)
   Catalogue pieces are the 325 committed files (catalog/); the recording tier is the synthetic covers of the G10 tests (tests/rec/*-fixtures.js). */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const R = p => require(path.join(REPO, p));
const V = R('practice/variant.js');
const VERIFY = require('./variant-verify.js');

const WINDOWS = 10, LEN = 4, SEED = 'g11c0-v1';
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const BASELINE = path.join(__dirname, 'variant-bench.baseline.json');

function fnv(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/* the windows of a piece of n bars: up to `count` distinct starts, in order, each `len` bars long (a shorter piece: one window of all its bars) */
function windowsOf(id, n, len, count) {
  len = Math.min(len, n);
  const starts = []; for (let i = 0; i + len <= n; i++) starts.push(i);
  const rnd = lcg(fnv(id + '|' + SEED));
  const pick = [];
  const pool = starts.slice();
  while (pick.length < count && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return pick.sort((a, b) => a - b).map(s => ({ from: s, to: s + len - 1 }));
}

const arrangerCache = {};
function arranger() {
  if (arrangerCache.app) return arrangerCache.app;
  const E = R('tests/realize/app-single-extract.js');
  const ref = E.reference();
  arrangerCache.ref = ref;
  arrangerCache.app = E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(ref) });
  return arrangerCache.app;
}

async function catalogItems(filter) {
  const { corpusFiles, importCorpus } = R('tests/scoregraph/tools/g3-corpus.js');
  const files = corpusFiles().filter(p => p.startsWith('catalog/') && (!filter || filter(p)));
  const rows = await importCorpus(files);
  return rows.map(r => ({ id: r.path.replace(/^catalog\//, ''), tier: r.path.split('/')[1] === 'hymns' ? 'hymn' : r.path.startsWith('catalog/method/') ? 'method' : 'piece', graph: r.graph, code: r.code }));
}

/* the synthetic covers of the G10 tests, as the app's v2 conversion writes them */
function recordingItems(filter) {
  const AS = R('audio-score.js'), H = R('tests/rec/helpers.js'), LF = R('tests/rec/leadsheet-fixtures.js'), CF = R('tests/rec/covers-fixtures.js');
  const conv = n => AS.toMusicXml({ notes: n.notes }, LF.OPTS).graph;
  const defs = [
    ['rec:tune-16', () => LF.convert(LF.cover(16, LF.tune))],
    ['rec:tune-24-d', () => LF.convert(LF.cover(24, LF.tune, { shift: 2 }))],
    ['rec:staccato-16', () => LF.convert(LF.cover(16, LF.tune, { melodyLen: 0.4 }))],
    ['rec:held-12', () => LF.convert(LF.heldTune())],
    ['rec:march-24', () => conv(H.march(24, 100, { jitter: 0.02, seed: 3 }))],
    ['rec:waltz-24', () => conv(H.waltz(24, 120, { jitter: 0.02, seed: 5 }))],
    ['rec:jig-24', () => conv(H.jig(24, 90, { jitter: 0.02, seed: 9 }))],
    ['rec:pop-32', () => conv(CF.pop(32, 120, { jitter: 0.02, seed: 4 }))]
  ];
  return defs.filter(d => !filter || filter(d[0])).map(d => ({ id: d[0], tier: 'recording', graph: d[1]() }));
}

function stageLevel(graph) {
  const DIFF = R('difficulty/index.js');
  const st = DIFF.assess(graph, R('difficulty/weights/g6a-v1.json')).level;
  const stage = st && st.stage ? st.stage : 2;
  return { stage: stage, easy: LEVELS[Math.max(1, Math.min(3, stage) - 1) - 1] };
}

const CODE = { VARIANT_IDENTICAL: 'I', VARIANT_NOT_EASIER: 'E', VARIANT_NOT_HARDER: 'E', VARIANT_SEAM: 'S', VARIANT_TIMELINE: 'T', VARIANT_PARTS: 'P', VARIANT_STAVES: 'F',
  VARIANT_INVALID: 'X', VARIANT_NOTATION: 'N', VARIANT_HARD: 'H' };
const CODE_NAMES = { A: 'accepted', I: 'identical', E: 'not easier/harder', S: 'seam', T: 'timeline', P: 'parts', F: 'staves', X: 'invalid', N: 'notation', H: 'hard', O: 'other', V: 'VERIFICATION FAILURE', '-': 'no variant' };

/* The variants of a piece. LIVE: the arranger's work now (the app's own glue). FROZEN: what it made when tests/practice-variant/fixtures/sample-variants.json was written
   (--freeze), so that the CI sample tests the splice on fixed inputs and does not fail when an arranger improves (the full run, --full, is always live).
   -> { level, stage, arranged: 'ok' | reason, profile, copy, upLevel, upArranged, upProfile, up, arrangeMs, base? (a frozen recording's own graph) } */
async function liveVariants(item) {
  const g = item.graph, rec = item.tier === 'recording';
  let level = 'beginner', stage = null;
  if (!rec) { const s = stageLevel(g); level = s.easy; stage = s.stage; }
  const t0 = Date.now();
  const arr = await arranger().arrangeSingleNote(g, rec ? { level: level, recordingArrange: 'leadsheet' } : { level: level });
  const out = { level: level, stage: stage, arranged: arr.ok ? 'ok' : arr.reason, arrangeMs: Date.now() - t0 };
  if (!arr.ok) return out;
  out.profile = arr.report && arr.report.request ? arr.report.request.handProfile : 'large';
  out.copy = arr.graph;
  out.upLevel = LEVELS[Math.min(2, LEVELS.indexOf(level) + 1)];
  const upArr = await arranger().arrangeSingleNote(g, rec ? { level: out.upLevel, recordingArrange: 'leadsheet' } : { level: out.upLevel });
  out.upArranged = upArr.ok ? 'ok' : upArr.reason;
  out.upProfile = upArr.ok && upArr.report && upArr.report.request ? upArr.report.request.handProfile : 'large';
  if (upArr.ok) out.up = upArr.graph;
  return out;
}
const FIXTURES = path.join(__dirname, 'fixtures', 'sample-variants.json');
function loadFrozen() {
  const SG = R('scoregraph/index.js');
  const raw = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
  const g = o => (o ? SG.parse(JSON.stringify(o)) : null);
  const out = {};
  Object.keys(raw.pieces).forEach(id => {
    const p = raw.pieces[id];
    out[id] = { level: p.level, stage: p.stage, arranged: 'ok', profile: p.profile, copy: g(p.copy), upLevel: p.upLevel, upArranged: 'ok', upProfile: p.upProfile,
      up: p.up === 'same' ? null : g(p.up), base: g(p.base), arrangeMs: 0 };
    if (p.up === 'same') out[id].up = out[id].copy;
  });
  return out;
}
function frozenVariants(frozen) { return async item => { const f = frozen[item.id]; if (!f) throw new Error('no frozen variant for ' + item.id); return f; }; }

/* one piece: its variants, then its windows in each direction */
async function benchPiece(item, o) {
  o = o || {};
  const v = await (o.variants || liveVariants)(item);
  if (v.base) item = Object.assign({}, item, { graph: v.base });       /* a frozen recording is its own graph, not today's conversion */
  const g = item.graph, n = g.timeline.measures.length;
  const rec0 = { id: item.id, tier: item.tier, bars: n, windows: windowsOf(item.id, n, LEN, WINDOWS), easier: '', harder: '', up: '', failures: [], ms: [], deltas: [], widened: [], seams: [], notes: {} };
  rec0.stage = v.stage; rec0.level = v.level; rec0.arrangeMs = v.arrangeMs; rec0.arranged = v.arranged;
  if (v.arranged !== 'ok') { rec0.easier = rec0.harder = rec0.up = '-'.repeat(rec0.windows.length); return rec0; }
  rec0.profile = v.profile;
  rec0.up_arranged = v.upArranged;
  const copy = v.copy, level = v.level;
  const run = (dir, base, variant, prof, w, lvl) => {
    const sopts = { from: w.from, to: w.to, direction: dir, profile: prof, songId: item.id, level: lvl || (dir === 'easier' ? level : 'as-written') };
    const t = process.hrtime.bigint();
    const res = V.splice(base, variant, sopts);
    rec0.ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    if (!res.ok) return CODE[res.reason] || 'O';
    rec0.deltas.push(res.judge.delta);
    rec0.widened.push(res.widened.left + res.widened.right);
    rec0.seams.push(res.seams);
    if (o.verify === false) return 'A';
    o.counter = (o.counter || 0) + 1;
    if (Number.isInteger(o.verifyEvery) && o.verifyEvery > 1 && o.counter % o.verifyEvery !== 1) return 'A';    /* the sample reads every other accepted splice; the full run, all of them */
    /* the engraver is the slow check: o.engrave true asks it of every accepted splice, a number N of every N-th */
    const engrave = o.engrave === true || (Number.isInteger(o.engrave) && o.engrave > 0 && o.counter % o.engrave === 1 % o.engrave);
    const fails = VERIFY.verify(base, variant, res, { direction: dir, profile: prof, engrave: engrave, determinism: !!o.determinism, idempotent: !!o.idempotent, spliceOpts: sopts });
    if (fails.length) { rec0.failures.push({ dir: dir, from: w.from, to: w.to, fails: fails.slice(0, 5) }); return 'V'; }
    return 'A';
  };
  rec0.windows.forEach(w => {
    rec0.easier += run('easier', g, copy, v.profile, w);
    rec0.harder += run('harder', copy, g, 'large', w);
    rec0.up += v.upArranged === 'ok' ? run('harder', copy, v.up, v.upProfile, w, v.upLevel) : '-';
  });
  return rec0;
}

async function runBench(items, o) {
  o = o || {};
  const out = [];
  for (const item of items) {
    if (!item.graph && !(o.variants && item.tier === 'recording')) { out.push({ id: item.id, tier: item.tier, bars: 0, windows: [], easier: '', harder: '', up: '', failures: [], ms: [], deltas: [], widened: [], seams: [], arranged: 'IMPORT_' + item.code }); continue; }
    const r = await benchPiece(item, o);
    out.push(r);
    if (o.onPiece) o.onPiece(r);
  }
  return out;
}

const quant = (xs, q) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const sum = xs => xs.reduce((a, b) => a + b, 0);

function summarize(records) {
  const tiers = ['hymn', 'method', 'piece', 'recording'];
  const sumry = { pieces: records.length, byTier: {}, all: {}, verificationFailures: 0, failures: [], noVariant: {}, widened: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, seams: {}, delta: {}, ms: {}, arrangeMs: 0 };
  const cell = () => ({ easier: {}, harder: {}, up: {}, windows: 0 });
  const bump = (c, dir, ch) => { c[dir][ch] = (c[dir][ch] || 0) + 1; c.windows += dir === 'easier' ? 1 : 0; };
  sumry.all = cell();
  records.forEach(r => {
    if (!sumry.byTier[r.tier]) sumry.byTier[r.tier] = cell();
    for (let i = 0; i < r.windows.length; i++) ['easier', 'harder', 'up'].forEach(dir => { bump(sumry.byTier[r.tier], dir, r[dir][i]); bump(sumry.all, dir, r[dir][i]); });
    if (r.arranged !== 'ok') sumry.noVariant[r.arranged] = (sumry.noVariant[r.arranged] || 0) + 1;
    r.failures.forEach(f => { sumry.verificationFailures++; sumry.failures.push({ id: r.id, dir: f.dir, from: f.from, to: f.to, fails: f.fails }); });
    r.widened.forEach(w => { sumry.widened[w] = (sumry.widened[w] || 0) + 1; });
    r.seams.forEach(s => Object.keys(s).forEach(k => { sumry.seams[k] = (sumry.seams[k] || 0) + s[k]; }));
    sumry.arrangeMs += r.arrangeMs || 0;
  });
  const deltas = [].concat(...records.map(r => r.deltas)), ms = [].concat(...records.map(r => r.ms));
  sumry.delta = { n: deltas.length, mean: deltas.length ? sum(deltas) / deltas.length : null, p10: quant(deltas, 0.1), median: quant(deltas, 0.5), p90: quant(deltas, 0.9) };
  sumry.ms = { n: ms.length, mean: ms.length ? sum(ms) / ms.length : null, median: quant(ms, 0.5), p95: quant(ms, 0.95), max: ms.length ? Math.max(...ms) : null };
  void tiers;
  return sumry;
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
function table(sumry) {
  const codes = ['A', 'I', 'E', 'S', 'T', 'P', 'F', 'X', 'N', 'H', 'O', 'V', '-'];
  const lines = [];
  const row = (name, cellv, dir) => {
    const c = cellv[dir], tot = sum(Object.values(c));
    lines.push(name.padEnd(10) + dir.padEnd(8) + String(tot).padStart(6) + codes.map(k => String(c[k] || 0).padStart(6)).join('') + '   ' + pct(c.A || 0, tot).padStart(6) + ' ' + pct(c.I || 0, tot).padStart(6));
  };
  lines.push(''.padEnd(18) + 'n'.padStart(6) + codes.map(k => k.padStart(6)).join('') + '   accept identical');
  Object.keys(sumry.byTier).forEach(t => ['easier', 'harder', 'up'].forEach(d => row(t, sumry.byTier[t], d)));
  ['easier', 'harder', 'up'].forEach(d => row('ALL', sumry.all, d));
  lines.push('');
  lines.push(codes.map(k => k + '=' + CODE_NAMES[k]).join('  '));
  lines.push('verification failures: ' + sumry.verificationFailures + '   widened bars (accepted splices): ' + JSON.stringify(sumry.widened));
  lines.push('seams of accepted splices (sum): ' + JSON.stringify(sumry.seams));
  lines.push('G6 passage change of accepted splices (positive = in the direction asked): ' + JSON.stringify(sumry.delta, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
  lines.push('splice + checks: ' + JSON.stringify(sumry.ms, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)) + ' ms (the splice alone, the independent verification not counted); arranger total ' + Math.round(sumry.arrangeMs / 1000) + ' s');
  if (Object.keys(sumry.noVariant).length) lines.push('no variant (arranger refused): ' + JSON.stringify(sumry.noVariant));
  return lines.join('\n');
}

/* the part of a record that is a result of the code (not a clock): what --check compares */
const digestOf = r => ({ id: r.id, level: r.level, arranged: r.arranged, easier: r.easier, harder: r.harder, up: r.up });

function loadBaseline() { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }

/* The CI sample: the pieces named in the baseline, spliced in both directions and one level up, every accepted splice read by variant-verify.js, the outcomes
   compared with the baseline's (the full run's) for the same pieces. -> { records, summary, problems: [text] } (no problem = the sample is as recorded and clean) */
async function checkSample(live) {
  const base = loadBaseline();
  const ids = new Set(base.sample);
  const frozen = live ? null : loadFrozen();
  const items = (await catalogItems(p => ids.has(p.replace(/^catalog\//, '')))).concat(live ? recordingItems(id => ids.has(id))
    : Object.keys(frozen).filter(id => id.indexOf('rec:') === 0).map(id => ({ id: id, tier: 'recording', graph: null })));
  const records = await runBench(items, { verify: true, verifyEvery: 2, engrave: 3, determinism: false, idempotent: true, variants: live ? liveVariants : frozenVariants(frozen) });
  const summary = summarize(records), problems = [];
  const want = new Map(base.pieces.map(p => [p.id, p]));
  if (records.length !== base.sample.length) problems.push('the sample has ' + base.sample.length + ' pieces, ' + records.length + ' ran');
  records.forEach(r => {
    const w = want.get(r.id), d = digestOf(r);
    if (!w || JSON.stringify(w) !== JSON.stringify(d)) problems.push('DIFFERENT ' + r.id + '\n  baseline ' + JSON.stringify(w) + '\n  now      ' + JSON.stringify(d));
  });
  if (summary.verificationFailures) problems.push('VERIFICATION FAILURES ' + JSON.stringify(summary.failures, null, 1));
  return { records: records, summary: summary, problems: problems };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const flag = name => process.argv.indexOf(name) >= 0;

async function main() {
  if (flag('--merge')) {
    const i = process.argv.indexOf('--merge');
    const files = process.argv.slice(i + 1).filter(a => !a.startsWith('--') && a !== arg('--out'));
    const records = [].concat(...files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')).records)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const out = arg('--out');
    fs.writeFileSync(out, JSON.stringify({ params: { windows: WINDOWS, len: LEN, seed: SEED }, records: records }) + '\n');
    console.log('merged ' + records.length + ' pieces');
    console.log(table(summarize(records)));
    return;
  }
  if (flag('--record')) {
    const full = JSON.parse(fs.readFileSync(arg('--in'), 'utf8'));
    const sample = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).sample;
    const base = { version: 1, params: full.params, sample: sample, summary: summarize(full.records), pieces: full.records.map(digestOf) };
    fs.writeFileSync(BASELINE, JSON.stringify(base) + '\n');
    console.log('baseline: ' + base.pieces.length + ' pieces');
    return;
  }
  if (flag('--freeze')) {
    const base = loadBaseline();
    const ids = new Set(base.sample);
    const items = (await catalogItems(p => ids.has(p.replace(/^catalog\//, '')))).concat(recordingItems(id => ids.has(id)));
    const raw = { version: 1, note: 'the arranger\'s work on the CI sample pieces, frozen by `node tests/practice-variant/variant-bench.js --freeze` (practice/variant.js is tested on these fixed inputs; a changed arranger does not move them)', pieces: {} };
    for (const it of items) {
      const v = await liveVariants(it);
      if (v.arranged !== 'ok') throw new Error(it.id + ': ' + v.arranged);
      raw.pieces[it.id] = { level: v.level, stage: v.stage, profile: v.profile, copy: v.copy, upLevel: v.upLevel, upProfile: v.upProfile,
        up: v.upArranged !== 'ok' ? null : JSON.stringify(v.up) === JSON.stringify(v.copy) ? 'same' : v.up };
      if (it.tier === 'recording') raw.pieces[it.id].base = it.graph;
    }
    fs.mkdirSync(path.dirname(FIXTURES), { recursive: true });
    fs.writeFileSync(FIXTURES, JSON.stringify(raw) + '\n');
    console.log('froze ' + items.length + ' pieces: ' + fs.statSync(FIXTURES).size + ' bytes');
    return;
  }
  if (flag('--check')) {
    const r = await checkSample(flag('--live'));
    console.log(table(r.summary));
    r.problems.forEach(t => console.log(t));
    process.exit(r.problems.length ? 1 : 0);
  }
  const only = arg('--only');
  const filter = only ? (id => id.indexOf(only) >= 0) : null;
  let items = (await catalogItems(filter ? (p => filter(p.replace(/^catalog\//, ''))) : null)).concat(recordingItems(filter));
  const sh = arg('--shard');
  if (sh) { const [i, n] = sh.split('/').map(Number); items = items.filter((_, k) => k % n === i); }
  const t0 = Date.now();
  let done = 0;
  const records = await runBench(items, { verify: !flag('--no-verify'), engrave: flag('--engrave'), determinism: flag('--determinism'), idempotent: flag('--idempotent'),
    onPiece: r => { done++; if (!flag('--quiet') && (done % 20 === 0 || r.failures.length)) console.log(done + '/' + items.length + ' ' + r.id + ' ' + r.easier + ' ' + r.harder + (r.failures.length ? ' FAILURES ' + JSON.stringify(r.failures) : '')); } });
  console.log(table(summarize(records)));
  console.log('wall ' + Math.round((Date.now() - t0) / 1000) + ' s');
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ params: { windows: WINDOWS, len: LEN, seed: SEED }, records: records }) + '\n');
  process.exit(summarize(records).verificationFailures ? 1 : 0);
}

module.exports = { checkSample, windowsOf, catalogItems, recordingItems, benchPiece, runBench, summarize, table, digestOf, loadBaseline, loadFrozen, frozenVariants, liveVariants, stageLevel, CODE, WINDOWS, LEN, SEED, BASELINE, FIXTURES };

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
