/* G07B §7 performance: "<=200ms per piece" (the design doc's own estimate, flagged as
   needing correction once real numbers exist). Measured directly (arrangement/tools/
   corpus-check.js, over the full 369-file corpus x 3 levels x 3 hand profiles = 3,321
   plan() calls, 2026-09-28): p50 0.16ms, p90 1.0ms, p99 7.0ms, worst case 48.7ms
   (catalog/method/sonatina/020.mxl - the same file G5/G6/G7a's own perf checks already use
   as the corpus's longest). Comfortably inside the 200ms budget; §7's estimate is confirmed
   realistic, not revised. This test re-measures that one file directly so a real regression
   trips CI without needing the full corpus scan on every run. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SGG, AP } = require('./helpers.js');

test('perf: arrangement.plan() on the longest corpus piece is well inside the 200ms budget', async () => {
  const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
  const f = 'catalog/method/sonatina/020.mxl';
  const bytes = fs.readFileSync(path.join(REPO, f));
  const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
  assert.ok(r.ok, f + ' failed to import');
  const g = r.graph;
  const sg = SGG.analyze(g);
  const req = { targetLevel: 3.5, handProfile: 'large' };
  AP.plan(g, sg, req); /* one warm call (JIT) */
  const t0 = process.hrtime.bigint();
  AP.plan(g, sg, req);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms <= 200, 'arrangement.plan() took ' + ms.toFixed(1) + 'ms on ' + f + ', over the 200ms budget');
});
