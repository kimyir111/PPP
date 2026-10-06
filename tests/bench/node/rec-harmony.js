#!/usr/bin/env node
/* G10a-0: the bar chords of reference scores (docs/GOALS/G10 section 7.5, rec.harmony.agreement).

     node tests/bench/node/rec-harmony.js --in jobs.jsonl --out out.jsonl            jobs: {"id", "xml"} (MusicXML text; Python opens .mxl)
     node tests/bench/node/rec-harmony.js --graphs graphs.jsonl --out out.jsonl      graphs: notate.js --emit-graph lines {"id", "graph"}

   Each output line is {"id", "harmony": [...]} with, for each
   bar of the imported graph in order, "root:quality" of the bar's most frequent chord window of songgraph/harmony.js
   (G7a), or null. The same reduction notate.js --check applies to a transcription's graph, so the two lists compare
   bar for bar. Metric tool, not part of the system under test: it reads the repository's scoregraph/ and songgraph/.

   With --graphs each row also has "ledger" (G10a-6, rec.ledger.* metrics): scoregraph/tools/ledger-stats.js on the same parsed graph, the ledger lines
   its heads are drawn on once the octave lines are applied ({heads, hist, ge2, ge3, ge4, shifted, spans, plain: the same with every line ignored}).
   The tool is this repository's, never the system under test's, so a graph made by an older audio-score.js is counted by the same rule. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(repoRoot, 'scoregraph', 'index.js'));
const HM = require(path.join(repoRoot, 'songgraph', 'harmony.js'));
const LS = require(path.join(repoRoot, 'scoregraph', 'tools', 'ledger-stats.js'));
const graphsPath = arg('--graphs');
const inPath = arg('--in') || graphsPath, outPath = arg('--out');
if (!inPath || !outPath) { process.stderr.write('usage: rec-harmony.js --in jobs.jsonl --out out.jsonl\n'); process.exit(2); }

function barChords(g) {
  const by = {};
  HM.harmonyOf(g).forEach(w => {
    if (w.root === null || w.root === undefined) return;
    const k = w.root + ':' + w.quality;
    (by[w.m] = by[w.m] || {})[k] = (by[w.m][k] || 0) + 1;
  });
  return g.timeline.measures.map(m => {
    const c = by[m.id];
    if (!c) return null;
    return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))[0];
  });
}

function ledgerOf(g) {
  const a = LS.ledgerStats(g), b = LS.ledgerStats(g, { display: false });
  return { heads: a.heads, hist: a.hist, ge2: a.ge2, ge3: a.ge3, ge4: a.ge4, shifted: a.shifted, spans: a.spans, plain: { hist: b.hist, ge2: b.ge2, ge3: b.ge3, ge4: b.ge4 } };
}

const out = fs.openSync(outPath, 'w');
function one(line) {
  const job = JSON.parse(line);
  let row;
  try {
    if (graphsPath) {
      if (!job.graph) row = { id: job.id, ok: false, harmony: null };
      else { const g = SG.parse(job.graph); row = { id: job.id, ok: true, harmony: barChords(g), ledger: ledgerOf(g) }; }
    } else {
      const r = SG.musicxml.import(job.xml, { scoreId: 'ref' });
      row = { id: job.id, ok: true, harmony: barChords(r.graph || r) };
    }
  } catch (e) {
    row = { id: job.id, ok: false, error: String(e && e.message || e), harmony: null };
  }
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
/* line by line: a batch of graphs is hundreds of megabytes, more than a string may hold */
const rl = require('readline').createInterface({ input: fs.createReadStream(inPath, { encoding: 'utf8' }), crlfDelay: Infinity });
rl.on('line', line => { if (line.trim()) one(line); });
rl.on('close', () => fs.closeSync(out));
