/* The validator's warnings on the graphs audio-score.js makes for a benchmark suite (docs/GOALS/G03 A9).

     node tests/scoregraph/tools/validate-preds.js [--suite core] [--g3] [--json out.json]

   Without --g3: the warning codes of every case's graph as the writer builds it (G3 off). With --g3: the same graphs
   before and after professionalize, side by side, and the four notation warnings A9 is about (W-TUPLET-INCOMPLETE,
   W-DISPLAY-DURATION, W-BEAM-SHAPE, W-TUPLET-DISPLAY). Exit 1 when --g3 leaves any of the four in a case, or G3
   adds a warning of any code a case did not have; 0 otherwise. ERRORs count as failures in either mode. */
'use strict';
const fs = require('fs');
const path = require('path');
const { graphs } = require('./g3-graphs.js');
const SG = require(path.join(__dirname, '..', '..', '..', 'scoregraph', 'index.js'));

const A9 = ['W-TUPLET-INCOMPLETE', 'W-DISPLAY-DURATION', 'W-BEAM-SHAPE', 'W-TUPLET-DISPLAY'];

function main(argv) {
  const suite = argv.includes('--suite') ? argv[argv.indexOf('--suite') + 1] : 'core';
  const g3 = argv.includes('--g3');
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  const tally = { before: {}, after: {} };
  const cases = [];
  let errors = 0, added = 0, left = 0;
  const count = (issues, into) => {
    const c = {};
    issues.forEach(i => { c[i.code] = (c[i.code] || 0) + 1; into[i.code] = (into[i.code] || 0) + 1; });
    return c;
  };
  graphs(suite).forEach(r => {
    if (!r.graph) { cases.push({ id: r.id, error: r.error }); errors++; return; }
    const v0 = SG.validate(r.graph).issues;
    const row = { id: r.id, before: count(v0, tally.before) };
    if (v0.some(i => i.severity === 'ERROR')) errors++;
    if (g3) {
      const out = SG.professionalize(r.graph, {}).graph;
      const v1 = SG.validate(out).issues;
      row.after = count(v1, tally.after);
      if (v1.some(i => i.severity === 'ERROR')) errors++;
      const was = new Set(v0.map(i => i.code + '|' + (i.ids || []).slice().sort().join(',')));
      row.added = v1.filter(i => !was.has(i.code + '|' + (i.ids || []).slice().sort().join(','))).map(i => i.code);
      added += row.added.length;
      row.a9 = A9.reduce((s, k) => s + (row.after[k] || 0), 0);
      if (row.a9) left++;
    }
    cases.push(row);
  });
  const codes = Array.from(new Set(Object.keys(tally.before).concat(Object.keys(tally.after)))).sort();
  console.log(`${suite}: ${cases.length} cases, ${errors} with an ERROR or no graph`);
  codes.forEach(k => console.log(`  ${k.padEnd(26)} ${String(tally.before[k] || 0).padStart(7)}` + (g3 ? ` -> ${String(tally.after[k] || 0).padStart(7)}` : '')));
  if (g3) {
    console.log(`A9: ${left} case(s) keep one of ${A9.join(', ')}; ${added} warning(s) G3 added that a case did not have`);
    cases.filter(c => c.a9).sort((a, b) => b.a9 - a.a9).slice(0, 10).forEach(c => console.log(`  ${c.id}: ${A9.map(k => (c.after[k] ? k + ' ' + c.after[k] : '')).filter(Boolean).join(', ')}`));
    cases.filter(c => c.added && c.added.length).slice(0, 10).forEach(c => console.log(`  added in ${c.id}: ${c.added.join(', ')}`));
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ suite: suite, g3: g3, tally: tally, cases: cases }, null, 1));
  return errors || (g3 && (left || added)) ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, A9 };
