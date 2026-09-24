/* G4a: the R reference corpus (docs/GOALS/G04 §22.2) and the plan-level L1 benchmark over it (§21.1).

   corpus.json is written by tests/engrave/tools/make-corpus.js from a seed and a rule, and must be what the tool
   writes; it holds no quarantined file and no G0 hold-out reference. The L1 benchmark (tools/bench.js) must pass its
   committed baselines on R, on the E fixtures and on PPP's own graphs (X). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, json, holdoutPaths } = require('./helpers.js');
const make = require('./tools/make-corpus.js');
const bench = require('./tools/bench.js');

test('corpus.json is what make-corpus.js writes: seeded, per stratum, no quarantine, no hold-out', () => {
  const committed = fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, JSON.stringify(make.build(), null, 2) + '\n');
  const m = JSON.parse(committed);
  assert.equal(m.seed, make.SEED);
  assert.deepEqual(m.strata.map(s => [s.name, s.files.length]), make.STRATA.map(s => [s[0], s[2]]));
  assert.equal(m.files.length, 61);
  const holdout = holdoutPaths();
  const quarantined = new Set(json(path.join(REPO, 'tests', 'bench', 'corpus', 'provenance.json')).entries.filter(e => e.quarantine_reason).map(e => e.path));
  m.files.forEach(f => {
    assert.ok(!holdout.has(f), f + ' is a G0 hold-out reference');
    assert.ok(!quarantined.has(f), f + ' is quarantined');
    assert.ok(fs.existsSync(path.join(REPO, f)), f);
  });
  assert.equal(m.excluded.holdoutInStrata, 52, 'every hold-out reference sits in a stratum and is left out');
});

for (const suite of ['r', 'e', 'x']) {
  test('L1 (plan level) on suite ' + suite + ': every zero-target metric is 0, every ratio is 1, and nothing is worse than the baseline', async () => {
    const rows = (await bench.inputs(suite)).map(bench.measure);
    const sum = bench.summarise(rows);
    const base = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'baselines', suite + '.l1.json'), 'utf8'));
    assert.deepEqual(bench.compare(sum, base), []);
  });
}
