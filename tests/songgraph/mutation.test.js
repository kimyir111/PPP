/* G07 §7 mutation suite: "a planted wrong key, a melody/bass swap, an off-by-one span — each must
   be caught." Each test starts from a clean, unambiguous fixture and changes exactly one thing,
   confirming SongGraph's analysis visibly reacts - the same discipline tests/playability's and
   tests/difficulty's own mutation suites use. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { K, V, T, mk } = require('./helpers.js');

/* ---------------------------------------------------------------- a planted wrong key */
test('mutation: transposing the second half up a step is caught as a real key-region change', () => {
  const bars = n => Array.from({ length: n }, () => 'C5:q E5:q G5:q C6:q').join(' | ');
  const clean = mk({ time: [4, 4], rh: bars(32), lh: Array.from({ length: 32 }, () => 'C3:w').join(' | ') });
  const [{ regions: cleanRegions }] = K.keyRegionsOf(clean);
  assert.equal(cleanRegions.length, 1, 'the clean fixture should be one key region');

  const cBars = n => Array.from({ length: n }, () => 'C5:q E5:q G5:q C6:q').join(' | ');
  const dBars = n => Array.from({ length: n }, () => 'D5:q F#5:q A5:q D6:q').join(' | ');
  const mutated = mk({
    time: [4, 4], rh: cBars(16) + ' | ' + dBars(16),
    lh: Array.from({ length: 16 }, () => 'C3:w').join(' | ') + ' | ' + Array.from({ length: 16 }, () => 'D3:w').join(' | ')
  });
  const [{ regions: mutatedRegions }] = K.keyRegionsOf(mutated);
  assert.ok(mutatedRegions.length >= 2, 'planting a real key change must be visible as 2+ regions: ' + JSON.stringify(mutatedRegions));
  assert.notEqual(mutatedRegions[0].fifths, mutatedRegions[mutatedRegions.length - 1].fifths);
});

/* ---------------------------------------------------------------------- a melody/bass swap */
test('mutation: swapping which staff carries the tune flips melodyVoice/bassVoice', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | G6:h E6:h', lh: 'C3:q G2:q C3:q G2:q | C3:h G2:h' });
  const before = V.melodyBassOf(g).parts[0];

  /* the swap: rebuild with the same two lines on the opposite staff (a real, not simulated, mutation -
     the tune is now written in the bass clef and the accompaniment in the treble) */
  const swapped = mk({ time: [4, 4], rh: 'C3:q G2:q C3:q G2:q | C3:h G2:h', lh: 'C6:q D6:q E6:q F6:q | G6:h E6:h' });
  const after = V.melodyBassOf(swapped).parts[0];

  assert.notEqual(before.melodyVoice === before.voices[0].voice, after.melodyVoice === after.voices[0].voice,
    'the identified melody voice must move when the tune moves to the other staff');
  assert.ok(before.melodyConf > 0.8 && after.melodyConf > 0.8, 'both directions should still be unambiguous');
});

/* ----------------------------------------------------------------------- an off-by-one span */
test('mutation: an off-by-one span (one event short) is a different, smaller EventSet, not silently equal', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:q A5:q B5:q C6:q', lh: 'C3:w | C3:w' });
  const part = g.parts[0];
  const rh = part.voices[0].id;
  const rhIds = part.events.filter(e => e.voice === rh).map(e => e.id);

  const full = T.resolveSpan(g, T.spanOf(g, rhIds.slice(0, 4))).map(e => e.id);
  const offByOne = T.resolveSpan(g, T.spanOf(g, rhIds.slice(0, 3))).map(e => e.id);
  assert.notDeepEqual(full, offByOne, 'dropping the last event from the selection must change what resolveSpan recovers');
  assert.ok(offByOne.indexOf(rhIds[3]) < 0, 'the dropped event must not reappear in the shrunk span');

  const offAtStart = T.resolveSpan(g, T.spanOf(g, rhIds.slice(1, 4))).map(e => e.id);
  assert.ok(offAtStart.indexOf(rhIds[0]) < 0, 'shifting the start by one must exclude the now-earlier event');
});
