'use strict';
/* G3 performance (docs/GOALS/G03 A39): professionalize on a synthetic 2,000-measure piano score of about 40,000 heads,
   written the way audio-score writes, in under 2 s. The best of three runs counts (the first pays for the JIT).

   The time is only a number on a machine that runs nothing else: inside `npm run test:scoregraph` every test file runs
   at once and this one takes about twice as long (CPU time as much as wall time). So the budget is checked by
   `npm run test:scoregraph:perf`, which runs this file alone (PPP_PERF=1); in the full suite the same run is made and
   checked for real work, and the time is only reported. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const { perfGraph } = require('./g3-perf-graph.js');

const BUDGET_MS = 2000;
const ALONE = process.env.PPP_PERF === '1';

test('A39: professionalize on 2,000 measures and 40,000 heads takes under 2 s', t => {
  const g = perfGraph(2000);
  const heads = g.parts[0].events.reduce((n, e) => n + (e.heads || []).length, 0);
  assert.equal(g.timeline.measures.length, 2000);
  assert.ok(heads >= 40000, 'the score has ' + heads + ' heads');
  let best = Infinity, r = null;
  for (let i = 0; i < 3 && best >= BUDGET_MS; i++) {
    const t0 = process.hrtime.bigint();
    r = SG.professionalize(g, {});
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  /* the time is for real work: no fallback, and the passes that own this score's problems changed it */
  assert.equal(r.report.fallback, false, JSON.stringify(r.report.issues.slice(0, 3)));
  const changed = new Set(r.report.passes.filter(p => p.changed).map(p => p.name));
  ['staff', 'rhythm', 'tuplet', 'beam'].forEach(p => assert.ok(changed.has(p), 'pass ' + p + ' changed nothing'));
  const detail = best.toFixed(0) + ' ms (' + r.report.passes.map(p => p.name + ' ' + p.ms).join(', ') + ')';
  t.diagnostic('professionalize ' + detail + (ALONE ? '' : ' (with the other test files running: not held to the budget)'));
  if (ALONE) assert.ok(best < BUDGET_MS, 'professionalize took ' + detail);
});
