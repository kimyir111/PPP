/* G11b-2: the simulator's new arms and the evaluation (tests/practice-sim/drivers.js, policy-eval.js; docs/GOALS/G11 §20).

     - the learner model watching a legacy arm changes nothing: the row is the committed legacy-gate.json row, byte for byte;
     - the policy arm is deterministic and its row is the committed policy-gate.json row (the CI job checks all of them);
     - the tuning set is the tune pieces and the seeds k < 100 and nothing else, the hold-out set the other cells; the hold-out is
       reported once (a second report with other parameters is refused);
     - a driver is never handed the learner: what it gets is the page (app, engines, score) and a seed of its own. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const L = require('./app-legacy.js');
const P = require('./pieces.js');
const RUN = require('./runner.js');
const B = require('./baseline.js');
const D = require('./drivers.js');
const EV = require('./policy-eval.js');

let env = null, pieces = null;
async function setup() {
  if (!env) { env = L.build(); pieces = new Map((await P.loadAll(env.E, ['czerny599-010'])).map(p => [p.id, p])); }
  return { env, piece: pieces.get('czerny599-010') };
}

test('the model watching a legacy arm changes nothing: the row is the committed legacy baseline\'s', async () => {
  const { env, piece } = await setup();
  const r = await RUN.simulate(env, piece, 'even', 0, 'coach', { observer: D.make('observer') });
  const committed = JSON.parse(fs.readFileSync(B.OUT.gate, 'utf8')).rows.find(x => x.key === 'coach|czerny599-010|even|0000');
  assert.deepEqual(B.rowOf(r), committed);
  assert.ok(r.brierPaired && r.brierPaired.n > 100, 'and it did predict: ' + (r.brierPaired && r.brierPaired.n));
  assert.ok(r.driver.entries > 100 && !r.driver.refused.simulated);
});

test('the policy arm is deterministic and its row is the committed gate row', async () => {
  const { env, piece } = await setup();
  const a = await RUN.simulate(env, piece, 'rushing', 0, 'policy', { driver: D.make('policy') });
  const b = await RUN.simulate(env, piece, 'rushing', 0, 'policy', { driver: D.make('policy') });
  assert.deepEqual(a, b);
  assert.equal(a.driver.policy.rejected + a.driver.policy.repaired, 0, 'every plan through Coach.validate untouched');
  if (fs.existsSync(EV.OUT.gate)) {
    const committed = JSON.parse(fs.readFileSync(EV.OUT.gate, 'utf8')).rows.find(x => x.key === 'policy|czerny599-010|rushing|0000');
    assert.deepEqual(EV.rowOf(a), committed);
  }
});

test('a driver gets the page and a seed of its own, never the learner', async () => {
  const { env, piece } = await setup();
  let seen = null;
  const spy = { init(c) { seen = c; }, step() { return false; } };
  await RUN.simulate(env, piece, 'even', 0, 'spy', { driver: spy });
  assert.ok(seen);
  assert.deepEqual(Object.keys(seen).sort(), ['E', 'app', 'driverSeed', 'env', 'idx', 'piece', 'score', 'scoreTempo']);
  assert.deepEqual(Object.keys(seen.piece).sort(), ['id', 'split']);
  await assert.rejects(() => RUN.simulate(env, piece, 'even', 0, 'coach', { driver: spy }), /arm name of its own/);
});

test('the tuning set and the hold-out set are what the split says, and the guard refuses the rest', () => {
  const tune = EV.jobsFor('tune', { arms: ['policy'] });
  assert.equal(tune.length, 4 * 6 * 100);
  assert.deepEqual([...new Set(tune.map(j => j.piece))].sort(), P.PIECES.filter(p => p.split === 'tune').map(p => p.id).sort());
  assert.ok(tune.every(j => j.k >= 0 && j.k < 100));
  const hold = EV.jobsFor('holdout', { arms: ['policy'] });
  assert.deepEqual([...new Set(hold.map(j => j.piece))].sort(), P.PIECES.filter(p => p.split === 'holdout').map(p => p.id).sort());
  assert.ok(hold.every(j => j.k >= 100 && j.k < 200));
  assert.throws(() => EV.jobsFor('tune', { arms: ['policy'], ks: [100] }), /hold-out seed/);
  assert.throws(() => EV.assertTuning([{ piece: 'rec-g01-leadsheet', k: 3 }]), /hold-out piece/);
  assert.throws(() => EV.assertHoldout([{ piece: 'beyer-050', k: 150 }]), /not a hold-out cell/);
  assert.equal(EV.holdoutRefusal(null, 'x'), null);
  assert.match(EV.holdoutRefusal({ params: { hash: 'a' } }, 'b'), /already reported/);
  assert.match(EV.holdoutRefusal({ params: { hash: 'a', source: 's1' } }, { hash: 'a', source: 's2' }), /already reported/, 'the same numbers on other code');
  assert.equal(EV.holdoutRefusal({ params: { hash: 'a', source: 's1' } }, { hash: 'a', source: 's1' }), null);
  if (fs.existsSync(EV.OUT.holdout)) {
    /* the numbers of the committed learner and policy are the ones the hold-out was reported with (new numbers need a new, deliberate
       report: the guard above refuses one while the old file is there) */
    const doc = JSON.parse(fs.readFileSync(EV.OUT.holdout, 'utf8'));
    assert.equal(doc.params.hash, EV.paramsHash(null));
  }
});
