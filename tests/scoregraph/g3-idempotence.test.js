'use strict';
/* G3 idempotence and determinism (docs/GOALS/G03 §16; A4, A5): P(P(g)) is P(g) byte for byte (nextId and rev
   included); every pass is a fixed point of itself (the same object back); two runs, another process and another
   working directory give the same bytes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { SG, REPO } = require('./helpers.js');
const D = require('./g3-corpus-data.js');
const Pro = SG.pro;

function idempotent(g, opts, label) {
  const a = SG.professionalize(g, opts).graph;
  const b = SG.professionalize(a, opts);
  assert.equal(b.graph, a, label + ': the second run changes nothing (same object)');
  assert.equal(SG.serialize(b.graph), SG.serialize(a), label);
  /* each pass on the pipeline's output is a fixed point of itself */
  Pro.passList(opts || {}).forEach(p => {
    const ctx = passCtx(a, opts);
    const r = p.run(a, ctx);
    assert.equal(r.graph, a, label + ': pass ' + p.name + ' is not a fixed point');
  });
  return a;
}
/* the context a pass sees inside professionalize */
function passCtx(g, opts) {
  opts = Object.assign({ mode: 'rewrite' }, opts || {});
  const grids = new Map();
  return { mode: opts.mode, opts: opts, report: { issues: [] }, source: Pro.SOURCE, skip: new Set(), perm: Pro.permission(g, opts.mode),
    grid(graph, m) { if (!grids.has(m)) grids.set(m, SG.meterGrid.grid(graph, m)); return grids.get(m); }, issue() {} };
}

test('A5: professionalize is idempotent on the recording graphs (core, golden)', () => {
  D.recorded().forEach(r => idempotent(r.graph, {}, r.id));
});

test('A5: idempotent on the committed corpus in force mode', async () => {
  (await D.imported()).forEach(r => idempotent(r.graph, { mode: 'force' }, r.path));
});

test('A5: idempotent on every G3 fixture', () => {
  D.fixtures().forEach(f => idempotent(f.graph, {}, f.path));
});

test('A4: two runs, another process and another working directory give the same bytes', () => {
  const rows = D.recorded(['golden']);
  const here = rows.map(r => SG.fingerprint(SG.professionalize(r.graph).graph));
  const again = rows.map(r => SG.fingerprint(SG.professionalize(r.graph).graph));
  assert.deepEqual(again, here);
  const script = "const G=require(process.argv[1]);const SG=require(process.argv[2]);" +
    "console.log(JSON.stringify(G.graphs('golden').filter(r=>r.graph).map(r=>SG.fingerprint(SG.professionalize(r.graph).graph))))";
  const out = execFileSync(process.execPath, ['-e', script, path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-graphs.js'),
    path.join(REPO, 'scoregraph', 'index.js')], { cwd: path.join(REPO, 'tests'), encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.deepEqual(JSON.parse(out), here);
});
