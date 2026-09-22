#!/usr/bin/env node
/* G1 corpus round-trip adapter (docs/GOALS/G01 §16.2): MusicXML -> ScoreGraph ->
   MusicXML -> ScoreGraph for every job of a JSONL batch.

     node tests/bench/node/sg-roundtrip.js --in jobs.jsonl --out out.jsonl [--scoregraph dir]

   Each input line is {"id", "xml", "name", "sha256", "container"} (the XML text:
   Python opens .mxl). Each output line is {"id", "ok", ...}:
     graph     serialize(import(original))            canonical ScoreGraph JSON
     xml       export(import(original))               the round-tripped MusicXML
     graph2    serialize(import(export(import(original))))
     report    the first import's report (issues, dropped)
     issues    validate(graph) codes and counts; warnings in detail
     unroll    the play order as measure indices (A17)
   or {"id", "ok": false, "stage", "code", "message"}. One failing file never stops
   the batch; the output is a pure function of the input and scoregraph/. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(path.resolve(arg('--scoregraph') || path.join(repoRoot, 'scoregraph')), 'index.js'));
const inPath = arg('--in'), outPath = arg('--out');
if (!inPath || !outPath) {
  process.stderr.write('usage: sg-roundtrip.js --in jobs.jsonl --out out.jsonl [--scoregraph dir]\n');
  process.exit(2);
}

const out = fs.openSync(outPath, 'w');
fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim()).forEach(line => {
  const job = JSON.parse(line);
  const t0 = process.hrtime.bigint();
  let row;
  try {
    const opts = { scoreId: 'roundtrip', sourceName: job.name, sourceSha256: job.sha256, container: job.container };
    const a = SG.musicxml.import(job.xml, opts);
    if (!a.ok) row = { id: job.id, ok: false, stage: 'import', code: a.code, message: a.message, report: a.report };
    else {
      const src = a.graph.provenance.sources[0];
      const x = SG.musicxml.export(a.graph, { software: src.tool });
      if (!x.ok) row = { id: job.id, ok: false, stage: 'export', code: x.code, message: x.message };
      else {
        const b = SG.musicxml.import(x.xml, opts);
        const v = SG.validate(a.graph);
        const counts = {};
        v.issues.forEach(i => { counts[i.code] = (counts[i.code] || 0) + 1; });
        const index = new Map(a.graph.timeline.measures.map((m, i) => [m.id, i]));
        row = {
          id: job.id, ok: true, graph: SG.serialize(a.graph), xml: x.xml,
          graph2: b.ok ? SG.serialize(b.graph) : null, reimport: b.ok ? null : { code: b.code, message: b.message },
          report: a.report, issues: counts,
          warnings: v.issues.filter(i => i.severity === 'WARNING').map(i => ({ code: i.code, ids: i.ids || [] })),
          unroll: SG.time.unroll(a.graph).map(vv => index.get(vv.m))
        };
      }
    }
  } catch (e) {
    row = { id: job.id, ok: false, stage: 'exception', code: e.code || 'exception', message: String(e && e.stack || e) };
  }
  row.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeSync(out, JSON.stringify(row) + '\n');
});
fs.closeSync(out);
