#!/usr/bin/env node
/* Corpus-wide sanity + performance check for G07 (design doc §8 "confirm <=500ms for the longest
   corpus piece", §5 "confirm regionKeys handles every corpus stratum reasonably"). Runs
   songgraph.analyze() over every importable file under catalog/, samples/, tests/bench/corpus/,
   tests/fixtures/ (tests/scoregraph/tools/g3-corpus.js's own corpus definition) and reports:
   crashes (should be none), per-file timing (worst case), and key-region counts by stratum
   (catalog/hymns vs catalog/method/* vs everything else).

     node songgraph/tools/corpus-check.js
   ========================================================================== */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { corpusFiles, importCorpus } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));

function stratumOf(p) {
  if (p.startsWith('catalog/hymns/')) return 'hymns';
  const m = p.match(/^catalog\/method\/([^/]+)\//);
  if (m) return 'method/' + m[1];
  if (p.startsWith('catalog/')) return 'catalog/other';
  return 'other';
}

async function main() {
  const files = corpusFiles();
  const rows = await importCorpus(files);
  let crashes = 0, ok = 0;
  let worst = { ms: -1 };
  const regionStats = {}; /* stratum -> {files, withRegions, totalRegions} */
  const timings = [];
  for (const r of rows) {
    if (!r.ok) continue;
    const g = r.graph;
    const strat = stratumOf(r.path);
    regionStats[strat] = regionStats[strat] || { files: 0, withRegions: 0, totalRegions: 0, tooShort: 0 };
    const t0 = process.hrtime.bigint();
    let sg;
    try {
      sg = SGG.analyze(g);
      ok++;
    } catch (e) {
      crashes++;
      console.log('CRASH', r.path, e.stack || e.message);
      continue;
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    timings.push({ path: r.path, ms: ms, measures: g.timeline.measures.length, notes: g.parts.reduce((a, p) => a + p.events.filter(e => e.kind === 'note').length, 0) });
    if (ms > worst.ms) worst = { path: r.path, ms: ms, measures: g.timeline.measures.length };

    regionStats[strat].files++;
    const kr = sg.keyRegions[0];
    if (!kr || kr.regions === null) regionStats[strat].tooShort++;
    else if (kr.regions.length) { regionStats[strat].withRegions++; regionStats[strat].totalRegions += kr.regions.length; }
  }
  console.log(rows.length + ' corpus files, ' + ok + ' analyzed, ' + crashes + ' crashed, ' + (rows.length - ok - crashes) + ' failed to import');
  console.log('\n=== key regions by stratum (part 0 only) ===');
  Object.keys(regionStats).sort().forEach(s => {
    const r = regionStats[s];
    console.log(s.padEnd(18), 'files=' + r.files, 'too-short=' + r.tooShort, 'with-regions=' + r.withRegions,
      'avg-regions(of those)=' + (r.withRegions ? (r.totalRegions / r.withRegions).toFixed(2) : 'n/a'));
  });
  timings.sort((a, b) => b.ms - a.ms);
  console.log('\n=== slowest 10 pieces (full analyze() wall time) ===');
  timings.slice(0, 10).forEach(t => console.log(t.ms.toFixed(2) + ' ms', t.path, t.measures + ' measures', t.notes + ' notes'));
  console.log('\nworst overall:', worst.path, worst.ms.toFixed(2) + ' ms', worst.measures + ' measures');
}

main().catch(e => { console.error(e); process.exit(1); });
