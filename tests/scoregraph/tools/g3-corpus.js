#!/usr/bin/env node
/* The committed MusicXML corpus as ScoreGraphs, for G3's corpus-wide checks (docs/GOALS/G03 §18.2, A8, A29).

     node tests/scoregraph/tools/g3-corpus.js [--codes W-BEAM-SHAPE,W-TUPLET-DISPLAY]

   Every tracked .musicxml/.mxl/.xml under catalog/, samples/, tests/bench/corpus/ and tests/fixtures/ (the
   sg-roundtrip set, G01 §16.2), imported through scoregraph/import.js. The CLI prints how many files carry
   each validator code; with --codes it prints only those codes and exits 1 when any of them occurs. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const ROOTS = ['catalog/', 'samples/', 'tests/bench/corpus/', 'tests/fixtures/'];
const EXTS = ['.musicxml', '.mxl', '.xml'];

function corpusFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\0').filter(p => p && ROOTS.some(r => p.startsWith(r)) && EXTS.some(e => p.toLowerCase().endsWith(e))).sort();
}

/* [{path, ok, graph, code}] in path order. */
async function importCorpus(files) {
  const rows = [];
  for (const p of files || corpusFiles()) {
    const bytes = fs.readFileSync(path.join(REPO, p));
    const r = await SG.importFile(new Uint8Array(bytes), { name: path.basename(p), scoreId: 'corpus' });
    rows.push({ path: p, ok: r.ok, graph: r.ok ? r.graph : null, code: r.ok ? null : r.code });
  }
  return rows;
}

module.exports = { corpusFiles, importCorpus, REPO };

if (require.main === module) {
  const i = process.argv.indexOf('--codes');
  const only = i >= 0 ? process.argv[i + 1].split(',') : null;
  importCorpus().then(rows => {
    const files = {}, total = {};
    let failed = 0;
    rows.forEach(r => {
      if (!r.ok) { failed++; return; }
      const seen = new Set();
      SG.validate(r.graph).issues.forEach(it => {
        if (only && only.indexOf(it.code) < 0) return;
        total[it.code] = (total[it.code] || 0) + 1;
        if (!seen.has(it.code)) { seen.add(it.code); (files[it.code] = files[it.code] || []).push(r.path); }
      });
    });
    console.log(rows.length + ' files, ' + failed + ' not imported');
    Object.keys(total).sort().forEach(c => console.log(c.padEnd(24) + String(total[c]).padStart(7) + ' in ' + files[c].length + ' file(s)' +
      (only ? ': ' + files[c].slice(0, 5).join(', ') : '')));
    if (only && Object.keys(total).length) process.exitCode = 1;
  });
}
