/* G07B §7 performance: "<=200ms per piece" (the design doc's own estimate, flagged as
   needing correction once real numbers exist). Measured directly (arrangement/tools/
   corpus-check.js, over the full 369-file corpus x 3 levels x 3 hand profiles = 3,321
   plan() calls, 2026-09-28): p50 0.16ms, p90 1.0ms, p99 7.0ms, worst case 48.7ms
   (catalog/method/sonatina/020.mxl - the same file G5/G6/G7a's own perf checks already use
   as the corpus's longest). Comfortably inside the 200ms budget; §7's estimate is confirmed
   realistic, not revised. This test re-measures that one file directly so a real regression
   trips CI without needing the full corpus scan on every run.

   How the time is taken (tests/timing.js): one warm call, then five timed calls, and the MEDIAN is held to the budget. A single
   call also measured the test files running beside this one - on a 4-vCPU runner `node --test` runs three at once, and the
   corpus file keeps one core busy for 26 s - so the same 60 ms call read 210-280 ms there and failed the gate on main
   (2026-10-07). `npm run test:arrangement-planner` runs the files one after the other (--test-concurrency=1), so on the runner
   this number is the planner's own; the median of five is the second line of defence when someone runs the files side by side. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SGG, AP } = require('./helpers.js');
const T = require('../timing.js');

const BUDGET_MS = 200;

test('perf: arrangement.plan() on the longest corpus piece is well inside the 200ms budget', async (t) => {
  const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
  const f = 'catalog/method/sonatina/020.mxl';
  const bytes = fs.readFileSync(path.join(REPO, f));
  const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
  assert.ok(r.ok, f + ' failed to import');
  const g = r.graph;
  const sg = SGG.analyze(g);
  const req = { targetLevel: 3.5, handProfile: 'large' };
  const ms = T.samples(() => AP.plan(g, sg, req)); /* a warm call first, then five timed ones */
  const detail = 'arrangement.plan() on ' + f + ': ' + T.describe(ms);
  t.diagnostic(detail + ' (budget ' + BUDGET_MS + ' ms; ' + os.availableParallelism() + ' CPUs)');
  assert.ok(T.median(ms) <= BUDGET_MS, detail + ', over the ' + BUDGET_MS + 'ms budget');
});
