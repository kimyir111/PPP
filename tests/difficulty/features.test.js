/* difficulty/features.js (docs/GOALS/G06_DIFFICULTY.md §3(a), G6a). node --test, no dependencies. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, F, SG, mk, graphOf, relOf, samplePieces } = require('./helpers.js');
const PL = require(path.join(REPO, 'playability', 'index.js'));

const featuresOf = (g, o) => F.featuresOf(g, o).piece;

test('the feature table: names are unique, every feature is a finite number on a plain fixture', () => {
  assert.equal(new Set(F.FEATURE_NAMES).size, F.FEATURE_NAMES.length);
  const g = mk({ rh: 'C5:q E5:q G5:q C6:q | C5:q E5:q G5:q C6:q', lh: 'C3:q C3:q C3:q C3:q | C3:q C3:q C3:q C3:q' });
  const r = F.featuresOf(g);
  F.FEATURE_NAMES.forEach(n => assert.ok(Number.isFinite(r.piece[n]), n + ' = ' + r.piece[n]));
  assert.equal(r.measures.length, 2);
  assert.equal(r.beats, 8);
  r.measures.forEach(m => Object.keys(m.local).forEach(n => assert.ok(Number.isFinite(m.local[n]), n)));
});

test('deterministic: the same graph gives the same features', () => {
  const g = mk({ rh: 'C5:q E5:q G5:q C6:q | C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8', lh: 'C3:h G2:h | C3:h G2:h' });
  assert.deepEqual(F.featuresOf(g), F.featuresOf(g));
});

/* ------------------------------------------------------------------ G5 reuse */
test('pathCost is the fingering DP\'s own optimum: brute force over every fingering of small phrases', () => {
  const FG = PL.fingering;
  const ev = (at, end, midi) => ({ at: at, end: end, midi: midi, until: midi.map(() => end), fixed: midi.map(() => 0) });
  const phrases = [
    [ev(0, 1, [60]), ev(1, 2, [64]), ev(2, 3, [67]), ev(3, 4, [72]), ev(4, 5, [71])],
    [ev(0, 1, [60, 64]), ev(1, 2, [62]), ev(2, 3, [65, 69]), ev(3, 4, [61])],
    /* a rest of PHRASE_REST_BEATS splits the DP: no cost may cross it */
    [ev(0, 1, [72]), ev(1, 2, [74]), ev(6, 7, [60]), ev(7, 8, [66]), ev(8, 9, [61])]
  ];
  ['r', 'l'].forEach(hand => phrases.forEach(evs => {
    const cands = evs.map(e => FG.candidates(e, hand));
    let best = Infinity;
    const pick = (i, acc) => {
      if (i === evs.length) {
        const c = F.pathCost(evs, acc, hand, FG).reduce((s, x) => s + x, 0);
        if (c < best) best = c;
        return;
      }
      cands[i].forEach(f => pick(i + 1, acc.concat([f])));
    };
    pick(0, []);
    const dp = F.pathCost(evs, FG.solveHand(evs, hand), hand, FG).reduce((s, x) => s + x, 0);
    assert.ok(Math.abs(dp - best) < 1e-9, hand + ': DP path cost ' + dp + ' but the brute-force optimum is ' + best);
  }));
});

test('keyShift puts every key signature\'s scale on the white keys (the transposition invariance, features.js header)', () => {
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const BLACK = new Set([1, 3, 6, 8, 10]);
  for (let fifths = -7; fifths <= 7; fifths++) {
    const g = mk({ key: { fifths: fifths }, rh: 'C5:w', lh: 'C3:w' });
    const s = F.keyShift(g);
    assert.ok(s >= -6 && s <= 5);
    Object.keys(PC).forEach(step => {
      const pc = ((PC[step] + F.keyAlter(step, fifths) + s) % 12 + 12) % 12;
      assert.ok(!BLACK.has(pc), 'fifths ' + fifths + ': ' + step + ' lands on a black key');
    });
  }
});

test('hands: a graph with limbs is read exactly as G5 reads it; a one-staff graph with none uses the app rule (right hand)', async () => {
  const g = mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:h G2:h' });
  const r = F.featuresOf(g);
  assert.equal(r.handFallback, false);
  assert.equal(r.attacks, PL.graph.attacksOf(g).length);
  const beyer1 = await graphOf('catalog/method/beyer/001.mxl');     /* one staff, no limb (not a hold-out file) */
  assert.equal(PL.graph.attacksOf(beyer1).length, 0, 'G5 alone sees no hand here');
  const b = F.featuresOf(beyer1);
  assert.equal(b.handFallback, true);
  assert.ok(b.attacks > 0 && b.piece.notesPerBeatRH > 0 && b.piece.notesPerBeatLH === 0);
});

/* ------------------------------------------------------------------ rhythm */
test('off-beat vs syncopation: running eighths are off-beat but not syncopated; a note held across the beat is both', () => {
  const eighths = featuresOf(mk({ rh: 'C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8', lh: 'C3:w' }));
  assert.equal(eighths.offbeat, 4 / 4);
  assert.equal(eighths.syncopation, 0);
  const synco = featuresOf(mk({ rh: 'C5:8 D5:q D5:q D5:q E5:8', lh: 'C3:w' }));
  assert.equal(synco.offbeat, 4 / 4);
  assert.equal(synco.syncopation, 3 / 4, 'the three quarters struck on "and" and held over the next beat');
});

test('tuplets: notes inside a tuplet, per beat', () => {
  const g = featuresOf(mk({ rh: '3e[C5:8 D5:8 E5:8] F5:q G5:h', lh: 'C3:w' }));
  assert.equal(g.tuplets, 3 / 4);
  assert.equal(featuresOf(mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' })).tuplets, 0);
});

test('note values: distinct printed values read', () => {
  assert.equal(featuresOf(mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:q C3:q C3:q C3:q' })).noteValues, 1);
  assert.equal(featuresOf(mk({ rh: 'C5:q. D5:8 E5:h', lh: 'C3:w' })).noteValues, 4);
});

/* ------------------------------------------------------------------ hands */
test('independence: hands together, or one hand alone, is 0; one hand moving over the other\'s held note counts', () => {
  assert.equal(featuresOf(mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:q D3:q E3:q F3:q' })).independence, 0);
  assert.equal(featuresOf(mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'r:w' })).independence, 0);
  /* beats 2-4 struck while the left hand holds its whole note; beat 1 is struck together */
  assert.equal(featuresOf(mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' })).independence, 3 / 4);
});

test('chords: extra keys struck together in one hand, per beat', () => {
  assert.equal(featuresOf(mk({ rh: 'C5+E5+G5:w', lh: 'C3:w' })).chordLoad, 2 / 4);
  assert.equal(featuresOf(mk({ rh: 'C5:w', lh: 'C3:w' })).chordLoad, 0);
});

/* ------------------------------------------------------------------ key */
test('chromatic notes are read against the key signature in force, and key load is |fifths| over time', () => {
  const cMaj = featuresOf(mk({ rh: 'C5:q F#5:q G5:q C6:q', lh: 'C3:w' }));
  assert.equal(cMaj.chromatic, 1 / 4);
  assert.equal(cMaj.keyLoad, 0);
  const gMaj = featuresOf(mk({ key: { fifths: 1 }, rh: 'G5:q F#5:q G5:q D6:q', lh: 'G2:w' }));
  assert.equal(gMaj.chromatic, 0, 'F# is in G major\'s signature');
  assert.equal(gMaj.keyLoad, 1);
  assert.equal(featuresOf(mk({ key: { fifths: 1 }, rh: 'G5:q F5:q G5:q D6:q', lh: 'G2:w' })).chromatic, 1 / 4, 'an F natural in G major');
  /* half the piece in C, half in E major (4 sharps) */
  assert.equal(featuresOf(mk({ keys: [{ bar: 1, fifths: 4 }], rh: 'C5:w | E5:w', lh: 'C3:w | E3:w' })).keyLoad, 2);
});

test('range: lowest to highest key used, in semitones', () => {
  assert.equal(featuresOf(mk({ rh: 'C6:h r:h', lh: 'r:h C3:h' })).range, 36);
});

test('density is per second at the notated tempo; notes per beat is not', () => {
  const g = mk({ rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' });
  const f = featuresOf(g);
  assert.equal(f.densityRH, 2, '4 quarters at 120 qpm = 2 attacks per second');
  assert.equal(f.notesPerBeatRH, 1);
});

/* ------------------------------------------------------------------ the corpus */
test('every sampled non-hold-out method piece gives finite features, a measure row per measure, and G5 hands', async () => {
  for (const rec of samplePieces()) {
    const g = await graphOf(relOf(rec));
    assert.ok(g, relOf(rec));
    const r = F.featuresOf(g);
    F.FEATURE_NAMES.forEach(n => assert.ok(Number.isFinite(r.piece[n]), rec.id + ': ' + n));
    assert.equal(r.measures.length, g.timeline.measures.length, rec.id);
    assert.ok(r.attacks > 0, rec.id + ': no attacks');
  }
});
