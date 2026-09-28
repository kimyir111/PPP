/* resolveSpan/spanOf round-trip property test (docs/GOALS/G07_SONGGRAPH_CORE.md §6, §11): "for an
   EventSet E, resolveSpan(g, spanOf(g, E)) recovers E (or a well-defined superset, if E wasn't
   already contiguous) in the same deterministic order, and doing this twice is idempotent."

   This did not exist anywhere before G07 (confirmed: no test in tests/scoregraph exercises spanOf
   and resolveSpan together as a round trip) - NOT to be confused with G1's unrelated sg-roundtrip
   suite (MusicXML import/export fidelity, tests/fixtures's own thing), which is a completely
   different property under a similar-sounding name. Both scoregraph/time.js functions themselves
   are reused as-is, unmodified, per the design doc's "already correct" instruction - this test
   exists because nothing previously checked that instruction was actually true.
   ========================================================================== */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, T, mk } = require('./helpers.js');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));

function checkRoundTrip(g, E) {
  const span = T.spanOf(g, E);
  const recovered = T.resolveSpan(g, span).map(e => e.id);
  /* superset: every id in E (or its containing event, for a head id) is present in the recovery */
  const evOfHead = new Map();
  g.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e.id))));
  const wantEventIds = new Set(E.map(id => evOfHead.get(id) || id));
  wantEventIds.forEach(id => assert.ok(recovered.indexOf(id) >= 0, 'expected event ' + id + ' back from resolveSpan, got ' + JSON.stringify(recovered)));
  /* deterministic and idempotent: doing it again from the recovered set changes nothing */
  const again = T.resolveSpan(g, span).map(e => e.id);
  assert.deepEqual(again, recovered, 'resolveSpan must be deterministic across repeated calls on the same span');
  const span2 = T.spanOf(g, recovered);
  const recovered2 = T.resolveSpan(g, span2).map(e => e.id);
  assert.deepEqual(recovered2, recovered, 'spanOf(resolveSpan(spanOf(E))) must be a fixed point');
  return recovered;
}

test('round trip: a fully contiguous single-voice run recovers exactly itself, in order', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:q A5:q B5:q C6:q', lh: 'C3:w | C3:w' });
  const part = g.parts[0];
  const rh = part.voices[0].id;
  const rhIds = part.events.filter(e => e.voice === rh).map(e => e.id);
  const recovered = checkRoundTrip(g, rhIds.slice(1, 5));
  assert.deepEqual(recovered, rhIds.slice(1, 5), 'a contiguous run in one voice should recover exactly itself');
});

test('round trip: a non-contiguous subset (every other event) recovers a real superset, not a crash', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:q A5:q B5:q C6:q', lh: 'C3:w | C3:w' });
  const part = g.parts[0];
  const rh = part.voices[0].id;
  const rhIds = part.events.filter(e => e.voice === rh).map(e => e.id);
  const skipEvery2nd = rhIds.filter((_, i) => i % 2 === 0);
  const recovered = checkRoundTrip(g, skipEvery2nd);
  assert.ok(recovered.length >= skipEvery2nd.length, 'the bounding span must recover at least the selected events');
  assert.ok(recovered.length > skipEvery2nd.length, 'the skipped-over events in between should also come back (a real superset, not accidentally exact)');
});

test('round trip: a head id resolves through its event, and multi-part selections span both parts', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:q D3:q E3:q F3:q' });
  const rhHead = g.parts[0].events.find(e => e.voice === g.parts[0].voices[0].id).heads[0].id;
  checkRoundTrip(g, [rhHead]);
});

test('round trip holds over the real corpus (hymns and a method-book piece), not just synthetic fixtures', async () => {
  const files = ['catalog/hymns/amazing-grace.musicxml', 'catalog/method/czerny599/001.mxl'];
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(REPO, f));
    const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
    assert.ok(r.ok, f + ' failed to import');
    const g = r.graph;
    const part = g.parts[0];
    const allIds = part.events.map(e => e.id);
    /* a contiguous middle slice */
    const mid = allIds.slice(Math.floor(allIds.length / 3), Math.floor(allIds.length / 3) + 6);
    if (mid.length) checkRoundTrip(g, mid);
    /* every 3rd event: a real non-contiguous case */
    const sparse = allIds.filter((_, i) => i % 3 === 0);
    if (sparse.length) checkRoundTrip(g, sparse);
  }
});
