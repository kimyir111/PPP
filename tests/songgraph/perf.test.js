/* G07 §8 performance: "Analysis <=500ms for the longest corpus piece in Node." Measured directly
   (songgraph/tools/corpus-check.js, 2026-09-28): the worst of the full committed corpus (369 files)
   is catalog/method/sonatina/020.mxl at ~53ms (158 measures, 1423 notes) - the same file G6a's own
   Node benchmark and G5's fingering.test.js perf check already use as "the longest corpus piece".
   This test re-measures that one file directly (not the whole corpus - corpus-check.js is the tool
   for that) so a real regression trips CI without needing the full 369-file scan on every run. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SGG } = require('./helpers.js');

test('perf: songgraph.analyze() on the longest corpus piece is well inside the 500ms budget', async () => {
  const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
  const f = 'catalog/method/sonatina/020.mxl';
  const bytes = fs.readFileSync(path.join(REPO, f));
  const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
  assert.ok(r.ok, f + ' failed to import');
  const g = r.graph;
  /* one warm call (JIT), then the timed one */
  SGG.analyze(g);
  const t0 = process.hrtime.bigint();
  SGG.analyze(g);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms <= 500, 'songgraph.analyze() took ' + ms.toFixed(1) + 'ms on ' + f + ', over the 500ms budget');
});
