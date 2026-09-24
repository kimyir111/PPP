/* G4a: the fidelity ledger catches what a renderer would silently drop (docs/GOALS/G04 §21.1 L1, A1).

   The inventory walks the graph on its own; the audit holds the plan's ledger against it. Each case here is a plan
   that went wrong in one way - it forgot a kind, invented an entry, counted one twice, claimed a drawing it does not
   hold - and the audit must name it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, E, graphOf } = require('./helpers.js');

const clonePlan = p => {
  const q = JSON.parse(JSON.stringify(p));
  Object.defineProperty(q, 'index', { value: new Set(p.index), enumerable: false });
  return q;
};

test('the inventory is independent of the plan: ledger.js reads the graph and nothing of the plan', () => {
  const src = fs.readFileSync(path.join(REPO, 'engrave', 'ledger.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]\.\/plan/, 'ledger.js does not load the plan');
  assert.doesNotMatch(src, /PPPEngraveModules\.plan|M\.plan\b/);
});

test('"this graph states N of kind X; the plan draws, derives, merges, suppresses or defers each"', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const p = E.plan(g);
  const a = E.audit(g, p);
  assert.ok(a.ok);
  const inv = E.inventory(g);
  const perKind = {};
  inv.forEach(kind => { perKind[kind] = (perKind[kind] || 0) + 1; });
  Object.keys(perKind).forEach(kind => {
    const k = a.byKind[kind];
    assert.equal(k.total, perKind[kind], kind + ': every one of them has a disposition');
    assert.equal(k.drawn + k.merged + k.suppressed + k.deferred, perKind[kind], kind);
    assert.equal(k.silent, 0, kind);
  });
  /* the statuses are G04's, and every entry that is not simply drawn says why */
  p.ledger.forEach(en => {
    assert.ok(E.ledger.STATUS.indexOf(en.status) >= 0, en.ref);
    if (en.status !== 'drawn') assert.ok(en.code, en.ref + ' ' + en.status + ' has a code');
  });
});

test('the audit names a plan that forgets a kind, per kind', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const p = E.plan(g);
  const kinds = [...new Set(p.ledger.map(en => en.kind))];
  assert.ok(kinds.length >= 20, kinds.length + ' kinds in this score');
  kinds.forEach(kind => {
    const q = clonePlan(p);
    const n = q.ledger.filter(en => en.kind === kind && en.status !== 'derived').length;
    if (!n) return;
    q.ledger = q.ledger.filter(en => en.kind !== kind);
    const a = E.audit(g, q);
    assert.equal(a.ok, false, 'forgetting ' + kind + ' is caught');
    assert.equal(a.silent.length, n, kind + ': every one of them is named');
  });
});

test('the audit names an invented entry, a duplicate, a wrong kind, a bad status and a drawing the plan does not hold', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const p = E.plan(g);
  assert.ok(E.audit(g, p).ok);
  const mut = f => { const q = clonePlan(p); f(q); return E.audit(g, q); };
  assert.ok(mut(q => q.ledger.push({ ref: 'e99999', kind: 'note', status: 'drawn', plan: 'e99999' })).invented.includes('e99999'));
  assert.ok(mut(q => q.ledger.push(Object.assign({}, q.ledger[3]))).duplicate.length === 1);
  assert.ok(mut(q => { q.ledger.find(en => en.kind === 'note').kind = 'rest'; }).kindMismatch.length === 1);
  assert.ok(mut(q => { q.ledger[0].status = 'ignored'; }).badStatus.length === 1);
  const noteEntry = p.ledger.find(en => en.kind === 'note');
  assert.ok(mut(q => { q.index.delete(noteEntry.plan); }).missing.includes(noteEntry.ref), 'drawn, but the object is gone from the plan');
  /* a derived object is the plan's own, not the graph's: not invented */
  assert.deepEqual(mut(q => q.ledger.push({ ref: 'd:beam:e1', kind: 'beam', status: 'derived', plan: 'd:beam:e1' })).invented, []);
});
