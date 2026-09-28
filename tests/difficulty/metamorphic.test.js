/* Metamorphic tests (docs/GOALS/G06_DIFFICULTY.md §5): each must pass 100%.
     - a faster tempo is not easier (and a slower one is not harder);
     - transposing to a key with more accidentals is not easier (harder or equal, never strictly easier);
     - fewer notes is not automatically harder or easier without checking why;
     - stable under no-op edits.
   Run on hand-written fixtures AND on real non-hold-out method pieces (helpers.js samplePieces: the first,
   middle and last registered non-hold-out piece of every book), against the committed weights. Where a
   property holds by construction (difficulty/features.js header, difficulty/model.js header), the test also
   checks the construction itself feature by feature - so it fails on a feature that breaks the rule even if
   today's weights happen to hide it. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { F, M, SG, mk, weights, graphOf, relOf, samplePieces, withTempo, scoreAt, transposed, fifthsOfInterval,
  withoutNotes } = require('./helpers.js');

const EPS = 1e-9;
const score = g => M.scoreOf(F.featuresOf(g).piece, weights());
async function pieces() {
  const out = [];
  for (const rec of samplePieces()) out.push([rec.id, await graphOf(relOf(rec))]);
  return out;
}
const fixtures = () => [
  ['fixture/scale', mk({ rh: 'C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8 | C6:8 B5:8 A5:8 G5:8 F5:8 E5:8 D5:8 C5:8', lh: 'C3:q G2:q C3:q G2:q | C3:q G2:q C3:q G2:q' })],
  ['fixture/repeats', mk({ rh: 'C5:16 C5:16 C5:16 C5:16 D5:16 D5:16 D5:16 D5:16 E5:16 E5:16 E5:16 E5:16 F5:16 F5:16 F5:16 F5:16', lh: 'C3:w' })],
  ['fixture/leaps', mk({ rh: 'C5:8 C6:8 D5:8 D6:8 E5:8 E6:8 F5:8 F6:8', lh: 'C2:8 C3:8 G2:8 G3:8 C2:8 C3:8 G2:8 G3:8' })]
];

/* ------------------------------------------------------------------ tempo */
test('tempo: a faster notated tempo never lowers any feature or the score; a slower one never raises them', async t => {
  const all = fixtures().concat(await pieces());
  let rose = 0;
  for (const [id, g] of all) {
    const base = F.featuresOf(g).piece, s0 = score(g);
    for (const k of [0.5, 0.9, 1.1, 1.5, 2, 4]) {
      const gk = withTempo(g, k);
      const fk = F.featuresOf(gk, { defaultQpm: 120 * k }).piece, sk = scoreAt(gk, k);
      F.FEATURE_NAMES.forEach(n => {
        if (k > 1) assert.ok(fk[n] >= base[n] - EPS, id + ' x' + k + ': ' + n + ' fell ' + base[n] + ' -> ' + fk[n]);
        else assert.ok(fk[n] <= base[n] + EPS, id + ' x' + k + ': ' + n + ' rose ' + base[n] + ' -> ' + fk[n]);
      });
      if (k > 1) assert.ok(sk >= s0 - EPS, id + ' x' + k + ': faster scored easier ' + s0 + ' -> ' + sk);
      else assert.ok(sk <= s0 + EPS, id + ' x' + k + ': slower scored harder ' + s0 + ' -> ' + sk);
      if (k === 2 && sk > s0 + 1e-6) rose++;
    }
  }
  t.diagnostic(all.length + ' graphs x 6 tempo factors; at 2x the score rose on ' + rose);
  assert.ok(rose >= all.length / 2, 'the score should actually respond to tempo (it rose on ' + rose + ' of ' + all.length + ')');
});

/* ------------------------------------------------------------------ transposition */
/* every interval class up to a major seventh, up and down: [diatonic steps, semitones] */
const INTERVALS = [[0, 1], [1, 1], [1, 2], [2, 3], [2, 4], [3, 5], [3, 6], [4, 6], [4, 7], [5, 8], [5, 9], [6, 10], [6, 11]];
test('transposition: to a key with more accidentals is never easier - only keyLoad moves, and only up', async t => {
  const all = [['fixture/c-major', mk({ rh: 'C5:q D5:q E5:q F#5:q | G5:q A5:q B5:q C6:q', lh: 'C3:h G2:h | C3:h G2:h' })],
    ['fixture/a-minor', mk({ key: { fifths: 0, mode: 'minor' }, rh: 'A4:q B4:q C5:q D5:q | E5:q F5:q G#5:q A5:q', lh: 'A2:h E3:h | A2:h E3:h' })]]
    .concat(await pieces());
  let checked = 0, equalChecked = 0;
  for (const [id, g] of all) {
    const f0 = F.featuresOf(g).piece, s0 = score(g);
    const keys = (g.timeline.keys || []).map(k => k.fifths);
    if (!keys.length) keys.push(0);
    for (const [d, c] of INTERVALS) for (const dir of [1, -1]) {
      const df = dir * fifthsOfInterval(d, c);
      const moved = keys.map(k => k + df);
      if (moved.some(k => Math.abs(k) > 7)) continue;
      const more = moved.every((k, i) => Math.abs(k) > Math.abs(keys[i]));
      const same = moved.every((k, i) => Math.abs(k) === Math.abs(keys[i]));
      if (!more && !same) continue;
      const gt = transposed(g, dir * d, dir * c);
      const ft = F.featuresOf(gt).piece, st = score(gt);
      F.FEATURE_NAMES.forEach(n => {
        if (n === 'keyLoad') return;
        assert.ok(Math.abs(ft[n] - f0[n]) <= EPS, id + ' by ' + dir * c + ' semitones: ' + n + ' changed ' + f0[n] + ' -> ' + ft[n]);
      });
      if (more) {
        assert.ok(ft.keyLoad > f0.keyLoad, id + ': more accidentals but keyLoad ' + f0.keyLoad + ' -> ' + ft.keyLoad);
        assert.ok(st >= s0 - EPS, id + ' by ' + dir * c + ' semitones (fifths ' + keys + ' -> ' + moved + '): scored easier ' + s0 + ' -> ' + st);
        checked++;
      } else {
        assert.ok(Math.abs(st - s0) <= EPS, id + ': same number of accidentals but the score moved ' + s0 + ' -> ' + st);
        equalChecked++;
      }
    }
  }
  t.diagnostic(all.length + ' graphs: ' + checked + ' transpositions to more accidentals, ' + equalChecked + ' to as many');
  assert.ok(checked >= 100 && equalChecked >= 10, 'transpositions checked: ' + checked + ' to more accidentals, ' + equalChecked + ' to as many');
});

/* ------------------------------------------------------------------ fewer notes */
/* The features that CAN rise when notes are removed, and why (difficulty/features.js header): a removed note can
   leave a leap behind (G5 jump strain, the DP's relocation cost, a VELOCITY limit between the notes that are
   left), or expose one hand's rhythm against the other's held note (independence). Nothing else may rise: in
   particular no rate can rise by dilution, because none is a share of the piece's notes. */
const MAY_RISE = new Set(['strainRate', 'strainPeak', 'hardRate', 'fingerCostRH', 'fingerCostLH', 'independence']);
const REMOVALS = [
  ['every second right-hand note', () => { const seen = {}; return (e, p) => e.staff === p.staves[0].id && (seen[e.voice] = (seen[e.voice] || 0) + 1) % 2 === 0; }],
  ['every third note, both hands', () => { let n = 0; return () => ++n % 3 === 0; }],
  ['the notes of every odd measure', g => { const odd = new Set(g.timeline.measures.filter((m, i) => i % 2 === 1).map(m => m.id)); return e => odd.has(e.m); }]
];
test('fewer notes: removing one hand never raises any feature or the score', async () => {
  const all = fixtures().concat(await pieces());
  for (const [id, g] of all) {
    const f0 = F.featuresOf(g).piece, s0 = score(g);
    [0, 1].forEach(si => {
      const gs = withoutNotes(g, (e, p) => p.staves.length > si && e.staff === p.staves[si].id);
      const fs = F.featuresOf(gs).piece;
      F.FEATURE_NAMES.forEach(n => assert.ok(fs[n] <= f0[n] + EPS, id + ' without staff ' + (si + 1) + ': ' + n + ' rose ' + f0[n] + ' -> ' + fs[n]));
      assert.ok(score(gs) <= s0 + EPS, id + ' without staff ' + (si + 1) + ' scored harder');
    });
  }
});

test('fewer notes: when a removal raises the score, the rise is a named reason (a leap left behind, independence), never dilution', async t => {
  const all = fixtures().concat(await pieces());
  let cases = 0, rose = 0;
  for (const [id, g] of all) {
    const f0 = F.featuresOf(g).piece, s0 = score(g);
    const variants = REMOVALS.map(([name, mkDrop]) => [name, withoutNotes(g, mkDrop(g))])
      .concat([['all chord tones but the top', withoutNotes(g, null, (h, e) => h !== e.heads.reduce((a, b) => (SG.pitch.midi(b.pitch) > SG.pitch.midi(a.pitch) ? b : a)))]]);
    for (const [name, gr] of variants) {
      const fr = F.featuresOf(gr).piece;
      F.FEATURE_NAMES.forEach(n => {
        if (MAY_RISE.has(n)) return;
        assert.ok(fr[n] <= f0[n] + EPS, id + ', ' + name + ': ' + n + ' rose ' + f0[n] + ' -> ' + fr[n] + ' with notes removed');
      });
      const sr = score(gr);
      cases++;
      if (sr > s0 + EPS) {
        rose++;
        const W = weights();
        const explained = W.featureNames.reduce((acc, n, i) => acc + (MAY_RISE.has(n) && W.std[i] > 0 ? W.weights[i] * Math.max(0, fr[n] - f0[n]) / W.std[i] : 0), 0);
        assert.ok(explained >= sr - s0 - 1e-9, id + ', ' + name + ': the score rose by ' + (sr - s0) + ' but the named reasons explain ' + explained);
      }
    }
  }
  t.diagnostic(cases + ' removals; the score rose in ' + rose + ', each explained by the named reasons');
  assert.ok(cases >= 40, 'removal cases checked: ' + cases + ' (score rose in ' + rose + ')');
});

test('fewer notes is not automatically easier: a sparse piece with wide chromatic chords in six sharps outranks a dense five-finger C-major exercise', () => {
  const dense = mk({ rh: 'C5:16 D5:16 E5:16 F5:16 G5:16 F5:16 E5:16 D5:16 C5:16 D5:16 E5:16 F5:16 G5:16 F5:16 E5:16 D5:16', lh: 'C3:q C3:q C3:q C3:q' });
  const sparse = mk({ key: { fifths: 6 }, rh: 'F#4+A#4+C#5+E#5:h G#5+B5+D#6:h', lh: 'F#2+C#3+F#3:h D#2+A#2+F#3:h' });
  const n = g => g.parts[0].events.filter(e => e.kind === 'note').reduce((s, e) => s + e.heads.length, 0);
  assert.ok(n(sparse) < n(dense));
  assert.ok(score(sparse) > score(dense), 'sparse ' + score(sparse) + ' vs dense ' + score(dense));
});

test('fewer notes, no dilution: deleting the plain notes around an accidental does not make the passage harder', () => {
  const full = mk({ rh: 'F#5:q G5:q A5:q G5:q | F#5:q G5:q A5:q G5:q', lh: 'C3:q E3:q G3:q E3:q | C3:q E3:q G3:q E3:q' });
  const thin = mk({ rh: 'F#5:q r:q r:q r:q | F#5:q r:q r:q r:q', lh: 'C3:q E3:q G3:q E3:q | C3:q E3:q G3:q E3:q' });
  assert.equal(F.featuresOf(thin).piece.chromatic, F.featuresOf(full).piece.chromatic, 'the same two accidentals');
  assert.ok(score(thin) <= score(full), 'thin ' + score(thin) + ' vs full ' + score(full));
});

/* ------------------------------------------------------------------ no-op edits */
test('stable under no-op edits: re-running, a serialize/parse round trip, a re-import and a sealed edit that changes nothing', async () => {
  const W = weights();
  for (const [id, g] of [fixtures()[0]].concat((await pieces()).slice(0, 6))) {
    const first = M.predict(F.featuresOf(g), W);
    assert.deepEqual(M.predict(F.featuresOf(g), W), first, id + ': re-run');
    const round = SG.parse(SG.serialize(g));
    assert.deepEqual(M.predict(F.featuresOf(round), W), first, id + ': serialize/parse');
    const touched = SG.ops.edit(g, d => { d.touch(); });
    assert.equal(touched.changed, true);
    assert.notEqual(touched.graph.rev, g.rev);
    assert.deepEqual(M.predict(F.featuresOf(touched.graph), W), first, id + ': sealed no-op edit');
  }
  const rel = relOf(samplePieces()[0]);
  const again = await SG.importFile(new Uint8Array(require('fs').readFileSync(require('path').join(require('./helpers.js').REPO, rel))), { name: 'again.mxl', scoreId: 'g6a-again' });
  assert.deepEqual(M.predict(F.featuresOf(again.graph), W), M.predict(F.featuresOf(await graphOf(rel)), W), rel + ': re-import');
});
