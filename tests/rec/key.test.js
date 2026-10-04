/* rec/key.js (G10a-3, stage S8): the key signature, tonal regions, spelling and printed accidentals, in isolation.
   docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8 and 22. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const KEY = require(path.join(REPO, 'rec', 'key.js'));
const AS = require(path.join(REPO, 'audio-score.js'));

const TPQ = 24, BAR = 96;
/* notes of a piece as the stage receives them: one onset per entry [tick, midis[], quarters, staff] */
function piece(events) {
  const notes = [];
  events.forEach(([tick, midis, q, staff]) => midis.forEach(m => notes.push({ midi: m, tick: tick, endTick: tick + Math.round((q || 1) * TPQ), staff: staff || 1, vel: 64 })));
  return notes;
}
/* a scale-ish melody over a bass, bars of 4 quarters, in the key whose tonic pitch class is `tonic` (major scale degrees) */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
function section(startBar, bars, tonic, opts) {
  opts = opts || {};
  const ev = [];
  const deg = [0, 2, 4, 2, 5, 4, 2, 1, 0, 4, 2, 0, 6, 4, 1, 0];     /* a melody that visits the scale and ends home */
  for (let b = 0; b < bars; b++) {
    const t0 = (startBar + b) * BAR;
    const bass = 36 + tonic + (opts.bassDeg ? MAJOR[opts.bassDeg[b % opts.bassDeg.length]] : 0);
    ev.push([t0, [bass], 2, 2]);
    for (let k = 0; k < 4; k++) {
      const d = deg[(b * 4 + k) % deg.length];
      ev.push([t0 + k * TPQ, [60 + tonic + MAJOR[d]], 1, 1]);
    }
  }
  return ev;
}
const analyse = (events, bars, extra) => KEY.analyse(piece(events), Object.assign({ barTicks: BAR, bars: bars, ticksPerQuarter: TPQ }, extra || {}));

test('the spelling table is audio-score.js\'s own, for all 24 keys (the stage changes the choice of key, not the table)', () => {
  for (let tonic = 0; tonic < 12; tonic++) ['major', 'minor'].forEach(mode => {
    const rel = mode === 'major' ? tonic : (tonic + 3) % 12;
    const fifths = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 }[rel];
    const key = { fifths: mode === 'minor' && rel === 6 ? -6 : fifths, mode: mode, tonic: tonic };
    assert.deepEqual(KEY.spellingTable(key), AS._.spellingTable(key), mode + ' ' + tonic);
  });
});

test('a piece in C major, in G major (F sharp), in E flat major: the signature, the spelling, no region', () => {
  [[0, 0, 'C'], [7, 1, 'F'], [3, -3, 'B']].forEach(([tonic, fifths, probe]) => {
    const r = analyse(section(0, 16, tonic), 16);
    assert.equal(r.key.fifths, fifths, 'tonic pc ' + tonic);
    assert.equal(r.regions.length, 1);
    assert.equal(r.changes.length, 0);
    assert.equal(r.spell.length, 16 * 5);
    void probe;
  });
  const g = analyse(section(0, 16, 7), 16);
  const f = piece(section(0, 16, 7)).findIndex(n => n.midi % 12 === 6);
  assert.deepEqual(g.spell[f], { step: 'F', alter: 1 });
});

test('release times are not values (G10-D4): a pedal-length release on one note does not move the key', () => {
  const notes = piece(section(0, 16, 0));
  const longPedal = notes.map(n => (n.midi === 60 + 11 ? Object.assign({}, n, { endTick: n.tick + TPQ * 40 }) : n));   /* B notes ring for ten bars */
  const a = KEY.analyse(notes, { barTicks: BAR, bars: 16, ticksPerQuarter: TPQ });
  const b = KEY.analyse(longPedal, { barTicks: BAR, bars: 16, ticksPerQuarter: TPQ });
  assert.equal(a.key.fifths, 0);
  assert.equal(b.key.fifths, a.key.fifths);
  assert.equal(b.key.score, a.key.score, 'the evidence is the onsets, so the score is the same');
});

test('the prior for a simple signature breaks the tie between keys that hold the same notes (the melody on G A B D, no F anywhere)', () => {
  /* eight bars of D G A B with a G in the bass: C major and G major hold exactly the same notes; nothing tells them apart but the signature */
  const ev = [];
  for (let b = 0; b < 8; b++) {
    const t0 = b * BAR;
    ev.push([t0, [43], 2, 2]);
    [67, 69, 71, 74].forEach((m, k) => ev.push([t0 + k * TPQ, [m], 1, 1]));
  }
  const notes = piece(ev), evd = KEY.evidence(notes, TPQ);
  const strong = KEY.chooseKey(notes, evd, { weights: { PRIOR: 100 } });
  assert.equal(strong.best.fifths, 0, 'with a prior that dominates, the signature with fewer accidentals wins');
  const none = KEY.chooseKey(notes, evd, { weights: { PRIOR: 0 } });
  assert.equal(none.best.fifths, 1, 'without it the tonal evidence reads G major');
});

test('the first and the last bass note vote for their key: the same notes, the tonic in the bass decides', () => {
  /* a melody on the notes of A minor / C major; the first and last bass notes are A (or C) */
  const mk = (first, last) => {
    const ev = [];
    for (let b = 0; b < 8; b++) {
      const t0 = b * BAR;
      if (b === 0 || b === 7) { ev.push([t0, [b === 0 ? first : last, 64, 67], 4, 1]); continue; }       /* the first and the last chord: bass note, E, G */
      ev.push([t0, [43], 2, 2]);
      [64, 67, 69, 72].forEach((m, k) => ev.push([t0 + k * TPQ, [m], 1, 1]));
    }
    return piece(ev);
  };
  const w = { FIRST: 20, LAST: 20 };
  const am = mk(45, 45), cm = mk(48, 48);
  assert.equal(KEY.chooseKey(am, KEY.evidence(am, TPQ), { weights: w }).best.tonic, 9, 'A in the bass at both ends: A (minor)');
  assert.equal(KEY.chooseKey(cm, KEY.evidence(cm, TPQ), { weights: w }).best.tonic, 0, 'C in the bass at both ends: C (major)');
});

test('a modulation: C major, then E flat major for 16 bars, then C major: the signature changes are written and spelled in the key', () => {
  const ev = section(0, 20, 0).concat(section(20, 16, 3), section(36, 20, 0));
  const r = analyse(ev, 56);
  assert.equal(r.key.fifths, 0);
  assert.deepEqual(r.regions.map(x => [x.fifths, x.to - x.from + 1 >= 12]), [[0, true], [-3, true], [0, true]]);
  assert.equal(r.changes.length, 2);
  assert.deepEqual(r.changes.map(c => [c.fifths, Math.abs(c.bar - 20) <= 4 || Math.abs(c.bar - 36) <= 4]), [[-3, true], [0, true]]);
  /* the middle region's notes are flats (E flat, B flat, A flat), not sharps */
  const notes = piece(ev);
  const mid = notes.map((n, i) => ({ n, i })).filter(x => x.n.tick >= 24 * BAR && x.n.tick < 32 * BAR && x.n.midi % 12 === 3);
  assert.ok(mid.length > 0);
  mid.forEach(x => assert.deepEqual(r.spell[x.i], { step: 'E', alter: -1 }));
});

test('a short excursion is spelled in its key and writes no signature; a key one fifth away never does', () => {
  const short = analyse(section(0, 20, 0).concat(section(20, 6, 3), section(26, 20, 0)), 46);
  assert.equal(short.changes.length, 0, 'six bars are not a key signature');
  const dominant = analyse(section(0, 20, 0).concat(section(20, 20, 7), section(40, 20, 0)), 60);
  assert.equal(dominant.changes.length, 0, 'the dominant is written with accidentals');
  assert.equal(dominant.key.fifths, 0);
});

test('a piece shorter than a window has one region, the first key', () => {
  const r = analyse(section(0, 6, 7), 6);
  assert.equal(r.regions.length, 1);
  assert.deepEqual([r.regions[0].from, r.regions[0].to], [0, 5]);
});

test('every bar is in exactly one region, regions are in order, spell has one entry per input note', () => {
  const ev = section(0, 20, 0).concat(section(20, 16, 3), section(36, 20, 0));
  const notes = piece(ev);
  const r = KEY.analyse(notes, { barTicks: BAR, bars: 56, ticksPerQuarter: TPQ });
  let next = 0;
  r.regions.forEach(x => { assert.equal(x.from, next); assert.ok(x.to >= x.from); next = x.to + 1; });
  assert.equal(next, 56);
  assert.equal(r.spell.length, notes.length);
  r.spell.forEach((s, i) => assert.equal(((({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[s.step] + s.alter) % 12 + 12) % 12, notes[i].midi % 12));
});

test('printed accidentals: the benchmark\'s rule, a tied-over head changes nothing in force', () => {
  const acc = KEY.accidentals();
  acc.begin(0);
  assert.equal(acc.next('B', 4, -1, false), true, 'B flat in C major needs one');
  assert.equal(acc.next('B', 4, -1, false), false, 'and not again in the bar');
  assert.equal(acc.next('B', 5, -1, false), true, 'another octave is another note');
  acc.begin(0);
  assert.equal(acc.next('B', 4, -1, true), false, 'a tied-over head prints none ...');
  assert.equal(acc.next('B', 4, -1, false), true, '... and brings none into force: the next B flat of the bar prints one');
  acc.begin(-1);
  assert.equal(acc.next('B', 4, -1, false), false, 'the signature has it');
  assert.equal(acc.next('B', 4, 0, false), true, 'a natural against the signature');
  assert.equal(acc.next('B', 4, -1, false), true, 'and back');
  acc.begin(0);
  assert.equal(acc.next('F', 4, 1, false), true, 'a new bar starts again from the signature');
});

test('degenerate input: no notes, a note without a pitch, a note without a staff', () => {
  const none = KEY.analyse([], { barTicks: BAR, bars: 4, ticksPerQuarter: TPQ });
  assert.ok(none.key && Number.isInteger(none.key.fifths));
  assert.deepEqual(none.spell, []);
  const odd = KEY.analyse([{ midi: NaN, tick: 0 }, { midi: 60, tick: 0 }, { midi: 64, tick: 24 }, { midi: 67, tick: 48 }, { midi: 72, tick: 72 }], { barTicks: BAR, bars: 1, ticksPerQuarter: TPQ });
  assert.equal(odd.spell[0], null);
  assert.equal(odd.key.fifths, 0);
});

test('deterministic and fast: 1,800 notes in well under the stage budget', () => {
  const ev = [];
  for (let b = 0; b < 150; b++) section(b, 1, [0, 7, 2, 9][Math.floor(b / 38) % 4]).forEach(e => ev.push(e));
  const notes = piece(ev);
  const t0 = Date.now();
  const a = KEY.analyse(notes, { barTicks: BAR, bars: 150, ticksPerQuarter: TPQ });
  const ms = Date.now() - t0;
  const b = KEY.analyse(notes, { barTicks: BAR, bars: 150, ticksPerQuarter: TPQ });
  assert.deepEqual(a, b);
  assert.ok(ms < 300, 'took ' + ms + ' ms for ' + notes.length + ' notes');
});
