'use strict';
/* G3 preservation over the corpus (docs/GOALS/G03 §15; A3, A6, A8): professionalize in strict mode on every graph
   the recording path writes for core and the golden inputs (robust too with PPP_G3_SUITES), and on the committed
   corpus imported and forced through the rewrite; the critic must find nothing and the result must validate. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const D = require('./g3-corpus-data.js');
const C = require('../../scoregraph/pro-critic.js');

test('A3 + A6: every recording graph goes through G3 in strict mode; the performance layer is byte for byte the same', () => {
  const rows = D.recorded();
  assert.ok(rows.length >= 100, rows.length + ' graphs');
  let changed = 0;
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true });
    assert.equal(out.report.fallback, false, r.id);
    assert.equal(out.report.rollbacks.length, 0, r.id);
    assert.equal(JSON.stringify(out.graph.performances || []), JSON.stringify(r.graph.performances || []), r.id + ': performance layer');
    assert.equal(SG.validate(out.graph).ok, true, r.id + ': ERROR 0');
    if (out.graph !== r.graph) changed++;
  });
  console.log('# G3 changed ' + changed + ' of ' + rows.length + ' recording graphs');
});

test('A8: imported scores are never changed in rewrite mode (the corpus, 369 files)', async () => {
  const rows = await D.imported();
  assert.ok(rows.length >= 70, rows.length + ' files');
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true });
    assert.equal(out.graph, r.graph, r.path + ': an imported graph comes back as it went in');
  });
});

test('force mode on the imported corpus keeps the music (strict critic, A5/A6 on imported notation)', async () => {
  const rows = await D.imported();
  let changed = 0;
  rows.forEach(r => {
    const out = SG.professionalize(r.graph, { mode: 'force', strict: true });
    const v = C.diff(C.fingerprint(r.graph), C.fingerprint(out.graph), C.FIXED.concat(['sound']));
    assert.deepEqual(v, [], r.path);
    if (out.graph !== r.graph) changed++;
  });
  console.log('# force mode changed ' + changed + ' of ' + rows.length + ' imported graphs');
});
