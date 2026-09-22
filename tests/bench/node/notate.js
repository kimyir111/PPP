#!/usr/bin/env node
/* G0 benchmark adapter: runs audio-score.js toMusicXml() over a JSONL batch.

     node tests/bench/node/notate.js --in jobs.jsonl --out out.jsonl [--audio-score path] [--emit-graph graphs.jsonl]

   Each input line is {"id", "input", "opts"}; each output line is
   {"id", "ok": true, "xml", "stats", "ms"} or {"id", "ok": false, "error",
   "code", "ms"}, in input order, followed by one {"meta": {...}} line.
   One failing case never stops the batch. No Date or Math.random here:
   the output (except "ms") is a pure function of the input and the SUT.

   The meta line also names every module Node loaded for the SUT
   (sut_modules, relative to the SUT's directory) and any it loaded from
   outside that directory (sut_outside): the SUT is audio-score.js plus the
   scoregraph/ library beside it (docs/GOALS/G01 §15.4), and the bench
   refuses a run whose module closure leaves its snapshot.

   --emit-graph (off by default; out.jsonl is the same with it) writes, per
   job, the ScoreGraph toMusicXml returned: {"id", "graph" (canonical text),
   "fingerprint", "issues": [{severity, code}]} (G01 A40). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const sut = path.resolve(arg('--audio-score') || process.env.PPP_BENCH_AUDIO_SCORE || path.join(repoRoot, 'audio-score.js'));
const inPath = arg('--in');
const outPath = arg('--out');
const graphPath = arg('--emit-graph');
if (!inPath || !outPath) {
  process.stderr.write('usage: notate.js --in jobs.jsonl --out out.jsonl [--audio-score path]\n');
  process.exit(2);
}

const A = require(sut);
const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim());
const out = fs.openSync(outPath, 'w');
const graphs = graphPath ? fs.openSync(graphPath, 'w') : null;
function emitGraph(id, r) {
  let g = null;
  if (r.graph) {
    const SG = require(path.join(path.dirname(sut), 'scoregraph', 'index.js'));
    g = { graph: SG.serialize(r.graph), fingerprint: SG.fingerprint(r.graph) };
  }
  const issues = (r.graphIssues || []).map(i => ({ severity: i.severity, code: i.code }));
  fs.writeSync(graphs, JSON.stringify(Object.assign({ id: id }, g || { graph: null }, { issues: issues })) + '\n');
}

for (const line of lines) {
  const job = JSON.parse(line);
  const t0 = process.hrtime.bigint();
  let row;
  try {
    const r = A.toMusicXml(job.input, job.opts || {});
    row = { id: job.id, ok: true, xml: r.xml, stats: r.stats };
    if (graphs) emitGraph(job.id, r);
  } catch (e) {
    row = { id: job.id, ok: false, error: String(e && e.message || e), code: (e && e.code) || null };
  }
  row.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
if (graphs) fs.closeSync(graphs);
const sha = crypto.createHash('sha256').update(fs.readFileSync(sut)).digest('hex');
/* Collected after every job: a module the SUT requires lazily is in the closure too. */
const sutDir = path.dirname(sut);
const loaded = Object.keys(require.cache).filter(f => path.resolve(f) !== path.resolve(__filename));
const inside = f => { const r = path.relative(sutDir, f); return r && !r.startsWith('..') && !path.isAbsolute(r); };
const sutModules = loaded.filter(inside).map(f => path.relative(sutDir, f).split(path.sep).join('/')).sort();
const sutOutside = loaded.filter(f => !inside(f)).sort();
fs.writeSync(out, JSON.stringify({ meta: { audio_score_path: sut, audio_score_sha256: sha, node: process.version,
  sut_modules: sutModules, sut_outside: sutOutside } }) + '\n');
fs.closeSync(out);
