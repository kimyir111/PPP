#!/usr/bin/env node
/* G0 benchmark adapter: runs audio-score.js toMusicXml() over a JSONL batch.

     node tests/bench/node/notate.js --in jobs.jsonl --out out.jsonl [--audio-score path]

   Each input line is {"id", "input", "opts"}; each output line is
   {"id", "ok": true, "xml", "stats", "ms"} or {"id", "ok": false, "error",
   "code", "ms"}, in input order, followed by one {"meta": {...}} line.
   One failing case never stops the batch. No Date or Math.random here:
   the output (except "ms") is a pure function of the input and the SUT. */
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
if (!inPath || !outPath) {
  process.stderr.write('usage: notate.js --in jobs.jsonl --out out.jsonl [--audio-score path]\n');
  process.exit(2);
}

const A = require(sut);
const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim());
const out = fs.openSync(outPath, 'w');
for (const line of lines) {
  const job = JSON.parse(line);
  const t0 = process.hrtime.bigint();
  let row;
  try {
    const r = A.toMusicXml(job.input, job.opts || {});
    row = { id: job.id, ok: true, xml: r.xml, stats: r.stats };
  } catch (e) {
    row = { id: job.id, ok: false, error: String(e && e.message || e), code: (e && e.code) || null };
  }
  row.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
const sha = crypto.createHash('sha256').update(fs.readFileSync(sut)).digest('hex');
fs.writeSync(out, JSON.stringify({ meta: { audio_score_path: sut, audio_score_sha256: sha, node: process.version } }) + '\n');
fs.closeSync(out);
