/* G05 G5b - the fingering DP's own test suite (node --test; wired into npm run test:playability by that
   script's existing glob over every .test.js file under tests/playability/ - no new npm script or CI
   line needed, unlike G5a which added the whole tests/playability/ suite; see
   docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 G5b for why a separate test:fingering script would be pure
   duplication here).

   Four parts: (1) the DP reproduces a representative slice of the legacy model's own "17 book cases"
   (tests/fingering.test.js) once ported onto the ScoreGraph, (2) a mutation suite - planted fingering
   defects a DP must never produce, plus the write() provenance guard, (3) the sonatina/020 and
   passage-resolve performance budgets (G05 §7), (4) the printed-fingering ground truth measurement,
   G5b vs the legacy model, on the same licence-clean set (G05 §3(d), §5's acceptance criterion). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, PL, mk, SG, graphOf } = require('./helpers.js');
const { withPositions } = require('../engrave/helpers.js');
const { appFingering } = require('./legacy-fingering-extract.js');
const T = require('../timing.js');

/* ------------------------------------------------------- book fingering (tests/fingering.test.js's 17) */
/* A representative slice of the same 17 cases (not all 17: several need multi-voice/chord DSL the mk()
   notation language does not add for this - see g3-helpers.js's own note "a head with limb, fingering or
   accidental extras are not needed by these tests"). Each is checked against the exact string the legacy
   model's own test asserts, on the ScoreGraph instead of the legacy Score. */
const BOOK_CASES = [
  ['C major scale, right hand up', { rh: 'C4:q D4:q E4:q F4:q | G4:q A4:q B4:q C5:q' }, 'RH', '1 2 3 1 2 3 4 5'],
  ['C major scale, left hand down', { rh: 'r:q r:q r:q r:q | r:q r:q r:q r:q', lh: 'C4:q B3:q A3:q G3:q | F3:q E3:q D3:q C3:q' }, 'LH', '1 2 3 1 2 3 4 5'],
  ['G major, right hand', { rh: 'G4:q A4:q B4:q C5:q | D5:q E5:q F#5:q G5:q' }, 'RH', '1 2 3 1 2 3 4 5'],
  ['F major keeps the thumb off B flat', { rh: 'F4:q G4:q A4:q Bb4:q | C5:q D5:q E5:q F5:q' }, 'RH', '1 2 3 4 1 2 3 4'],
  ['C triad, right hand', { rh: 'C4+E4+G4:w' }, 'RH', '135'],
  ['arpeggio, thumb under', { rh: 'C4:q E4:q G4:q C5:q | E5:q G5:q C6:q r:q' }, 'RH', '1 2 3 1 2 3 5']
];
BOOK_CASES.forEach(([name, spec, hand, want]) => {
  test('book fingering: ' + name, () => {
    const g = mk(spec);
    const solved = PL.fingering.solveGraph(g);
    const got = solved.hands[hand].fingers.map(f => f.filter(Boolean).join('')).join(' ');
    assert.equal(got, want);
  });
});

/* ------------------------------------------------------------------------- mutation suite (G05 §8) */
test('mutation: two heads sharing one physical key at the same instant always get the identical finger', () => {
  /* Two LH voices strike the same pitch (C3) at the same instant - a sustained bass note doubled by a
     restrike in a second voice, the pattern that made G5b under-perform the legacy model until this dedup
     was added (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 G5b traces czerny849/002's own worked
     example). A fingering DP must never invent two different fingers for one key: playability/fingering.js
     `eventsForHand`'s same-pitch dedup makes this a structural invariant, not a tested probability. */
  const g = mk({ rh: 'r:q r:q r:q r:q', lh: 'C3:q D3:q E3:q F3:q', lh2: 'C3:q r:q r:q r:q' });
  const solved = PL.fingering.solveGraph(g);
  const byHead = new Map(solved.results.map(r => [r.headId, r.finger]));
  const part = g.parts[0];
  const at0 = part.events.filter(e => e.at === '0' && e.staff === part.staves[1].id);
  const c3Heads = [];
  at0.forEach(e => (e.heads || []).forEach(h => { if (SG.pitch.midi(h.pitch) === 48) c3Heads.push(h.id); }));
  assert.equal(c3Heads.length, 2, 'expected the two voices\' C3 heads at onset 0');
  assert.equal(byHead.get(c3Heads[0]), byHead.get(c3Heads[1]));
  assert.ok(byHead.get(c3Heads[0]) >= 1 && byHead.get(c3Heads[0]) <= 5);
});

test('mutation: a note struck while an adjacent held note still sounds does not steal its finger', () => {
  /* LH: C3 sounds for the first half of the bar (a half note); D3 is struck one beat in, while C3 is
     still down (until=2 > at=1) - a finger already committed to C3 cannot also be at D3 (App 8410-8416,
     `stepCost`'s heldFinger=8 cost, ported verbatim). Four other fingers are free, so the DP should never
     pick C3's own finger for D3 - the mutation this case is built to catch is a DP that reused it anyway. */
  const g = mk({ rh: 'r:w', lh: 'C3:h r:h', lh2: 'r:q D3:q r:h' });
  const solved = PL.fingering.solveGraph(g);
  const byHead = new Map(solved.results.map(r => [r.headId, r.finger]));
  const part = g.parts[0];
  let c3 = null, d3 = null;
  part.events.forEach(e => (e.heads || []).forEach(h => {
    const m = SG.pitch.midi(h.pitch);
    if (m === 48) c3 = h.id; else if (m === 50) d3 = h.id;
  }));
  assert.ok(c3 && d3, 'expected one C3 head and one D3 head');
  assert.notEqual(byHead.get(c3), byHead.get(d3), 'D3 should not reuse the finger still holding C3 down');
});

test('mutation: a dead mutation (a cosmetic key-signature change) leaves every finger byte-for-byte identical', () => {
  const spec = { rh: 'C4:q D4:q E4:q F4:q | G4:q A4:q B4:q C5:q' };
  const before = PL.fingering.solveGraph(mk(spec)).hands.RH.fingers;
  const after = PL.fingering.solveGraph(mk(Object.assign({}, spec, { key: { fifths: 3, mode: 'major' } }))).hands.RH.fingers;
  assert.deepEqual(after, before);
});

test('write(): a head with printed (imported) fingering is never overwritten; an unset one is freely filled', () => {
  const g = mk({ rh: 'C4:q D4:q E4:q r:q', op: 'imported' });
  const firstHead = g.parts[0].events[0].heads[0].id;
  const planted = SG.ops.edit(g, d => { const h = d.head(firstHead); h.fingering = [{ f: '3' }]; d.touch(); }).graph;
  const solved = PL.fingering.solveGraph(planted);
  const out = PL.fingering.write(planted, solved.results);
  const headById = id => { let found = null; out.graph.parts[0].events.forEach(e => (e.heads || []).forEach(h => { if (h.id === id) found = h; })); return found; };
  assert.deepEqual(headById(firstHead).fingering, [{ f: '3' }], 'the printed fingering must survive untouched');
  const secondHead = g.parts[0].events[1].heads[0].id;
  const second = headById(secondHead);
  assert.ok(second.fingering && second.fingering.length, 'an unset head should be filled in');
  assert.equal(second.prov.asp.fingering.op, 'inferred');
});

test('write(): a head with user-edited fingering is never overwritten', () => {
  const g = mk({ rh: 'C4:q D4:q r:q r:q' });
  const firstHead = g.parts[0].events[0].heads[0].id;
  const edited = SG.ops.edit(g, d => {
    const h = d.head(firstHead);
    h.fingering = [{ f: '4' }];
    d.markProv(h, ['fingering'], 'edited');
    d.touch();
  }).graph;
  const solved = PL.fingering.solveGraph(edited);
  const out = PL.fingering.write(edited, solved.results);
  const head = out.graph.parts[0].events[0].heads.find(h => h.id === firstHead);
  assert.deepEqual(head.fingering, [{ f: '4' }]);
});

test('write(): G5b\'s own earlier ("inferred") fingering may be recomputed on a later pass', () => {
  const g = mk({ rh: 'C4:q D4:q E4:q r:q' });
  const solved1 = PL.fingering.solveGraph(g);
  const once = PL.fingering.write(g, solved1.results).graph;
  /* re-run write() on the SAME results (a no-op idempotence check) and on a fresh solve (should agree,
     since nothing about the input changed) - both must succeed without the guard refusing its own output. */
  const solved2 = PL.fingering.solveGraph(once);
  const twice = PL.fingering.write(once, solved2.results).graph;
  const firstHead = g.parts[0].events[0].heads[0].id;
  const f1 = once.parts[0].events[0].heads.find(h => h.id === firstHead).fingering;
  const f2 = twice.parts[0].events[0].heads.find(h => h.id === firstHead).fingering;
  assert.deepEqual(f1, f2, 'recomputing an inferred value should be allowed and deterministic');
});

test('invariant at scale (sonatina/020): every shared pitch within an attack gets one shared finger', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const solved = PL.fingering.solveGraph(g);
  let checked = 0;
  ['RH', 'LH'].forEach(hand => {
    solved.hands[hand].events.forEach((e, i) => {
      e.headIds.forEach((ids, j) => {
        if (ids.length < 2) return;
        checked++;
        const fingers = new Set(ids.map(id => solved.results.find(r => r.headId === id).finger));
        assert.equal(fingers.size, 1, hand + ' event ' + i + ' pitch slot ' + j + ' (' + e.midi[j] + '): ' + ids.length + ' heads must share one finger');
      });
    });
  });
  assert.ok(checked > 0, 'sonatina/020 should contain at least one duplicated-pitch attack to exercise this');
});

/* --------------------------------------------------------------------- performance (G05 §7) */
/* One warm call and the median of five timed ones (tests/timing.js): a single call also timed the test files running beside this
   one, and failed twice on the runner (171.0 ms on 2026-10-07, 155.2 ms on 2026-10-06; both passed on the rerun). The runner's own
   median is 105 ms against 24-35 ms here, so under CI the budget is T.CI_FACTOR times the number written (T.budget). */
test('performance: analyzer + fingering over sonatina/020 (1,776 heads) stays inside the 150ms combined budget', async (t) => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  assert.ok(g);
  const ms = T.samples(() => { PL.analyzeGraph(g, { profile: 'medium' }); PL.fingering.solveGraph(g); });
  const budget = T.budget(150);
  const detail = 'combined analyze+fingering: ' + T.describe(ms);
  t.diagnostic(detail + ' (budget ' + budget + ' ms)');
  assert.ok(T.median(ms) <= budget, detail + ', over the ' + budget + 'ms budget (150 ms outside CI)');
});

test('performance: re-solving one passage alone (not the whole piece) is well inside the 20ms budget (G9)', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  const Graph = require(path.join(REPO, 'playability', 'graph.js'));
  const attacks = Graph.attacksOf(g);
  const rh = attacks.filter(a => a.limb === 'RH');
  const evs = PL.fingering.eventsForHand(rh);
  const mid = Math.floor(evs.length / 2);
  const passage = evs.slice(mid, mid + 24); /* a phrase-sized slice, not the whole piece */
  const ms = T.samples(() => PL.fingering.solve(passage, 'r')); /* a warm call, then the median of five */
  assert.ok(T.median(ms) <= T.budget(20), 're-solving a 24-event passage took ' + T.describe(ms) + ', over the ' + T.budget(20) + 'ms budget (20 ms outside CI)');
});

/* -------------------------------- printed-fingering ground truth + legacy comparison (G05 §3(d), §5) */
/* The licence-clean method-set files with at least one printed <fingering> (tests/bench/corpus/
   references.json, the same registry G0/G4 use - not a second corpus definition). See
   docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 G5b for how this measured count corrects the design doc's
   original, never-verified "14,305 heads / 84 files": those 84/14,305 also include 17 quarantined
   (licence-unevidenced) method files - tests/bench/corpus/excluded.json's own P1 entries - which cannot
   be "licence-clean" ground truth by definition. The real, licence-clean set is smaller. */
function fingeringReferences() {
  const refs = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'bench', 'corpus', 'references.json'), 'utf8')).references;
  return refs.filter(r => r.set === 'method');
}
function groundTruthOf(g) {
  const out = new Map();
  g.parts.forEach(part => part.events.forEach(e => (e.heads || []).forEach(h => {
    if (!h.pitch || !h.fingering || !h.fingering.length) return;
    const f = parseInt(h.fingering[0].f, 10);
    if (!(f >= 1 && f <= 5)) return;
    const limb = SG.pitch.limbOf(part, e, h);
    if (limb !== 'RH' && limb !== 'LH') return;
    out.set(h.id, { finger: f, limb: limb });
  })));
  return out;
}
function g5bPredict(g) {
  const out = new Map();
  PL.fingering.solveGraph(g).results.forEach(r => { if (r.finger != null) out.set(r.headId, r.finger); });
  return out;
}
function legacyPredict(g, name) {
  const F = appFingering();
  const score = withPositions(SG.legacy.toScore(g, { name: name, id: 'meas:' + name, ids: true }));
  const part = g.parts[0];
  score.notes.forEach(n => {
    n.finger = undefined; /* never let the legacy model see the printed answer either - a fair comparison */
    if (n.rest) return;
    const ev = part.events.find(e => e.id === n.sgEvent);
    const head = ev && (ev.heads || []).find(h => h.id === n.sgHead);
    const limb = head ? SG.pitch.limbOf(part, ev, head) : undefined;
    if (limb === 'LH') n.hand = 'l'; else if (limb === 'RH') n.hand = 'r';
  });
  const plan = F.plan(score);
  const out = new Map();
  score.notes.forEach(n => { if (!n.rest && n.sgHead) { const f = plan.finger.get(n); if (f >= 1 && f <= 5) out.set(n.sgHead, f); } });
  return out;
}

test('printed-fingering set: the design doc\'s "14,305/84" corrected to the measured licence-clean 66 files / 10,358 heads', async () => {
  let files = 0, heads = 0;
  for (const r of fingeringReferences()) {
    const g = await graphOf(r.path);
    if (!g) continue;
    const gt = groundTruthOf(g);
    if (gt.size) { files++; heads += gt.size; }
  }
  assert.equal(files, 66, 'licence-clean files with a printed fingering');
  assert.equal(heads, 10358, 'licence-clean printed-fingering heads');
});

/* Regression baseline (the same "gate on growth, not on hitting zero" shape as G5a's R_CORPUS_BASELINE,
   tests/playability/playability.test.js): measured 2026-09-28 on the 66-file licence-clean set above.
   G5b beats the legacy model on BOTH hands and overall - not by a wide margin (this is a faithful port
   of the same cost model, not a different algorithm), but the acceptance criterion (G05 §5) is a per-hand
   comparison on the same set, and it is met. The gate fails if either side's count moves in the wrong
   direction: G5b dropping (a real regression) or legacy's own count changing at all (this extraction
   should be exactly reproducible - if it isn't, the app's Fingering DP moved and this baseline needs a
   deliberate update, not a silent drift). */
const AGREEMENT_BASELINE = {
  RH: { g5b: 4750, legacy: 4737, total: 6928 },
  LH: { g5b: 2577, legacy: 2573, total: 3430 }
};
test('fingering beats the legacy model on printed-finger agreement, per hand, on the licence-clean set', async () => {
  const tally = { RH: { g5b: 0, legacy: 0, total: 0 }, LH: { g5b: 0, legacy: 0, total: 0 } };
  for (const r of fingeringReferences()) {
    const g = await graphOf(r.path);
    if (!g) continue;
    const gt = groundTruthOf(g);
    if (!gt.size) continue;
    const g5b = g5bPredict(g);
    const legacy = legacyPredict(g, r.id.replace(/\//g, '_'));
    gt.forEach((truth, headId) => {
      const t = tally[truth.limb];
      t.total++;
      if (g5b.get(headId) === truth.finger) t.g5b++;
      if (legacy.get(headId) === truth.finger) t.legacy++;
    });
  }
  ['RH', 'LH'].forEach(hand => {
    const t = tally[hand], b = AGREEMENT_BASELINE[hand];
    assert.equal(t.total, b.total, hand + ' ground-truth head count changed - update the baseline deliberately');
    assert.ok(t.g5b >= b.g5b, hand + ' G5b agreement regressed: ' + t.g5b + ' < baseline ' + b.g5b);
    assert.equal(t.legacy, b.legacy, hand + ' legacy agreement changed (the app\'s Fingering DP moved) - update the baseline deliberately');
    assert.ok(t.g5b >= t.legacy, hand + ': G5b (' + t.g5b + ') must beat or match the legacy model (' + t.legacy + ') per G05 §5');
  });
});
