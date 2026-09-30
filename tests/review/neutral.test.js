/* G9c: review/lib/neutral.js - both arms are drawn and sounded through one path; nothing an engine added survives, and printed
   accidentals are recomputed the same way for both. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const N = require(path.join(REPO, 'review/lib/neutral.js'));

const measures = fifths => [1, 2, 3].map(n => ({ number: n, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: fifths, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const note = (m, b, p, midi, extra) => Object.assign({ m: m, b: b, dur: 1, type: 'quarter', dots: 0, p: p, midi: midi, staff: 1, hand: 'r', rest: false, chord: false, voice: 1, acc: null }, extra || {});

test('neutralNotes drops everything an engine may have added and keeps only what the notes are', () => {
  const dirty = [
    note(1, 0, 'C4', 60, { finger: 3, sgHead: 'h1', sgEvent: 'e1', stem: 'up', tieStart: true, slurStart: true, voice: 5, ottavaShift: 0, writtenP: 'C4' }),
    { m: 1, b: 1, dur: 1, rest: true, staff: 1 },
    note(1, 2, 'E4', 64, { voice: 9 })
  ];
  const out = N.neutralNotes(measures(0), dirty);
  assert.equal(out.length, 2, 'the rest is gone');
  out.forEach(n => assert.deepEqual(Object.keys(n).sort(), ['acc', 'b', 'chord', 'dots', 'dur', 'hand', 'm', 'midi', 'p', 'rest', 'staff', 'tieStart', 'tieStop', 'type', 'voice']));
  assert.deepEqual(out.map(n => n.voice), [1, 1], 'voices are re-derived from the staff, not the engine\'s voice numbers');
});

test('the same notes in a different emission order (and with different engine fields) give byte-identical drawings and sound', () => {
  const a = [note(1, 0, 'C4', 60), note(1, 1, 'E4', 64), note(1, 0, 'C3', 48, { staff: 2, hand: 'l', voice: 2 }), note(2, 0, 'G4', 67, { dur: 2, type: 'half' })];
  const b = a.slice().reverse().map(n => Object.assign({}, n, { finger: 1, sgHead: 'x', voice: n.voice + 4, tieStart: false }));
  const ra = N.render(measures(0), 100, a, 'p-'), rb = N.render(measures(0), 100, b, 'p-');
  assert.equal(ra.svg, rb.svg);
  assert.deepEqual(ra.notes, rb.notes);
});

test('printed accidentals follow the key signature and the measure, whatever the engine put in acc', () => {
  /* C major: D#4, D#4 again (no second sign), D4 (natural), and the next measure starts clean */
  const notes = [note(1, 0, 'D#4', 63, { acc: 'flat' }), note(1, 1, 'D#4', 63), note(1, 2, 'D4', 62), note(2, 0, 'D#4', 63), note(2, 1, 'F4', 65, { acc: 'sharp' })];
  const out = N.neutralNotes(measures(0), notes);
  assert.deepEqual(out.map(n => n.acc), ['sharp', null, 'natural', 'sharp', null]);
  /* D major (2 sharps): F#4 and C#5 need no sign, F4 needs a natural, D#4 a sharp; an F#3 in the bass follows the key too */
  const d = [note(1, 0, 'F#4', 66), note(1, 1, 'C#5', 73), note(1, 2, 'F4', 65), note(1, 3, 'F4', 65), note(2, 0, 'D#4', 63), note(2, 1, 'F#3', 54, { staff: 2, hand: 'l' })];
  assert.deepEqual(N.neutralNotes(measures(2), d).map(n => n.acc), [null, null, 'natural', null, 'sharp', null]);
  /* flats: Bb major */
  const f = [note(1, 0, 'Bb4', 70), note(1, 1, 'B4', 71), note(1, 2, 'Bb4', 70)];
  assert.deepEqual(N.neutralNotes(measures(-2), f).map(n => n.acc), [null, 'natural', 'flat']);
});

test('the same accidental rule runs for both arms: a chromatic note gets its sign whichever engine wrote it', () => {
  const g9Style = [note(1, 0, 'D#4', 63, { acc: null, finger: 2 })];
  const legacyStyle = [note(1, 0, 'D#4', 63, { acc: 'sharp' })];
  const a = N.render(measures(0), 100, g9Style, 'p-'), b = N.render(measures(0), 100, legacyStyle, 'p-');
  assert.equal(a.svg, b.svg);
  assert.ok(/vf-accidental/.test(a.svg), 'the sign is drawn');
});

test('the drawing carries no data-* attribute, no graph fingerprint, no fingering, and a per-drawing glyph prefix only', () => {
  const svg = N.render(measures(0), 100, [note(1, 0, 'C4', 60, { finger: 1 }), note(1, 1, 'E4', 64)], 'i07X-').svg;
  assert.ok(!/ data-/.test(svg));
  assert.ok(!/ppp-fingering|data-plan|plan\/\d/.test(svg));
  assert.ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="score-svg" viewBox="[\d. ]+" fill="currentColor">/.test(svg), svg.slice(0, 200));
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 0 && ids.every(i => i.startsWith('i07X-')));
});

test('audio: a pitch struck by both hands at one onset sounds once (the drawn score keeps both)', () => {
  const both = [note(1, 0, 'C4', 60, { dur: 2, type: 'half' }), note(1, 0, 'C4', 60, { staff: 2, hand: 'l', voice: 2 }), note(1, 1, 'E4', 64)];
  assert.deepEqual(N.audioNotes(measures(0), both), [[0, 2, 60], [1, 1, 64]], 'one C4, the longer duration kept');
  assert.equal(N.neutralNotes(measures(0), both).length, 3, 'the drawing still has all three notes');
  /* the same for the other arm's style of notes */
  assert.deepEqual(N.audioNotes(measures(0), both.slice().reverse()), N.audioNotes(measures(0), both));
});

test('audio: a tied continuation is joined to the note it continues, not re-struck; a repeated note that is not tied is', () => {
  /* C4 half in bar 1 beats 2-4 tied across the barline to a quarter in bar 2, then a plain repeat of C4 */
  const tied = [note(1, 2, 'C4', 60, { dur: 2, type: 'half', tieStart: true }), note(2, 0, 'C4', 60, { tieStop: true }), note(2, 1, 'C4', 60)];
  assert.deepEqual(N.audioNotes(measures(0), tied), [[2, 3, 60], [5, 1, 60]]);
  /* a tieStop flag with nothing ending where it starts is just a note */
  assert.deepEqual(N.audioNotes(measures(0), [note(1, 0, 'C4', 60, { tieStop: true })]), [[0, 1, 60]]);
  /* the drawing does not merge (both arms alike); tied notes stay two drawn notes */
  assert.equal(N.neutralNotes(measures(0), tied).length, 3);
  /* an arm without tie flags (the legacy engine's shape) is unchanged */
  assert.deepEqual(N.audioNotes(measures(0), [note(1, 0, 'C4', 60), note(1, 1, 'C4', 60)]), [[0, 1, 60], [1, 1, 60]]);
});

test('density: drawn notes and the left-hand share, from the same neutral notes', () => {
  const ns = [note(1, 0, 'C4', 60), note(1, 0, 'C3', 48, { staff: 2, hand: 'l' }), note(1, 0, 'G3', 55, { staff: 2, hand: 'l' })];
  assert.deepEqual(N.density(measures(0), ns), { notes: 3, leftHand: 2 });
});

test('audio notes are [startQ, durQ, midi] from the measure list, rests excluded, sorted', () => {
  const ns = [note(2, 1, 'G4', 67, { dur: 2 }), note(1, 0, 'C4', 60), { m: 1, b: 2, dur: 1, rest: true }];
  assert.deepEqual(N.audioNotes(measures(0), ns), [[0, 1, 60], [5, 2, 67]]);
});

/* ---- review page fidelity: rests, ties, barline splits, clef rule, two layouts ---- */
const E = require(path.join(REPO, 'engrave/index.js'));
const count = (s, re) => (s.match(re) || []).length;
const heads = svg => count(svg, /href="#[^"]*-notehead[A-Za-z]*"/g);
const restCount = svg => count(svg, /href="#[^"]*-rest[A-Za-z0-9]*"/g);
const measuresOf = (n, lenQ) => Array.from({ length: n }, (_, i) => ({ number: i + 1, lenQ: lenQ || 4, time: { beats: (lenQ || 4), beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const lh = (m, b, p, midi, extra) => note(m, b, p, midi, Object.assign({ staff: 2, hand: 'l', voice: 2 }, extra || {}));

test('rests: every silent stretch of a staff is drawn as rests (a whole-bar rest for a silent bar), the engines\' own rest entries are ignored, and the notes are untouched', () => {
  const ms = measuresOf(3);
  /* bar 1: right hand C4 on beat 1 only, left hand a whole note. bar 2: both hands silent. bar 3: right hand beats 3-4 only, left hand a whole note */
  const notes = [note(1, 0, 'C4', 60), note(3, 2, 'E4', 64, { dur: 2, type: 'half' }), lh(1, 0, 'C3', 48, { dur: 4, type: 'whole' }), lh(3, 0, 'C3', 48, { dur: 4, type: 'whole' })];
  const p = N.prepare(ms, 100, notes);
  const part = p.graph.parts[0];
  const staffOf = id => part.staves.findIndex(s => s.id === id) + 1;
  const desc = part.events.filter(e => e.kind === 'rest')
    .map(e => staffOf(e.staff) + '|' + p.graph.timeline.measures.findIndex(m => m.id === e.m) + '|' + e.at + '|' + e.dur + '|' + (e.display.measureRest ? 'bar' : e.display.type)).sort();
  assert.deepEqual(desc, [
    '1|0|1/4|1/4|quarter', '1|0|1/2|1/2|half',   /* bar 1 right hand: beat 2, then beats 3-4 as one half rest on beat 3 */
    '1|1|0|1|bar', '2|1|0|1|bar',                /* bar 2: a whole-bar rest on each staff */
    '1|2|0|1/2|half'                             /* bar 3 right hand: beats 1-2 */
  ].sort());
  assert.equal(p.stats.rests, 5); assert.equal(p.stats.wholeBarRests, 2);
  /* an engine's own rest entries change nothing: the same drawing with or without them */
  const withOwn = notes.concat([{ m: 1, b: 1, dur: 3, rest: true, staff: 1, voice: 1, type: 'half', dots: 1 }, { m: 2, b: 0, dur: 4, rest: true, staff: 2 }]);
  assert.equal(N.render(ms, 100, withOwn, 'p-').svg, N.render(ms, 100, notes, 'p-').svg);
  assert.equal(part.events.filter(e => e.kind === 'note').length, 4, 'no note was added or lost');
});

test('rest values: cut at the beats, the largest value that starts on a multiple of its own length; compound beats are dotted; a gap off the 1/64 grid is left alone', () => {
  const pieces = (a, b, len, beat, comp) => N.restPieces(a, b, len, beat, comp).map(x => x.at + '+' + x.dur + (x.display.dots ? 'd' : '') + (x.display.measureRest ? 'M' : ''));
  assert.deepEqual(pieces(0, 64, 64, 16, false), ['0+64M'], 'a silent 4/4 bar is one whole-bar rest');
  assert.deepEqual(pieces(16, 64, 64, 16, false), ['16+16', '32+32'], 'beat 2 alone, then a half rest on beat 3 (never a half rest on beat 2)');
  assert.deepEqual(pieces(0, 32, 64, 16, false), ['0+32'], 'a half rest on beats 1-2');
  assert.deepEqual(pieces(8, 24, 64, 16, false), ['8+8', '16+8'], 'an eighth either side of the beat');
  assert.deepEqual(pieces(0, 48, 48, 16, false), ['0+48dM'], 'a silent 3/4 bar: one dotted-half whole-bar rest');
  assert.deepEqual(pieces(0, 48, 96, 24, true), ['0+24d', '24+24d'], '6/8: a dotted quarter per beat');
  assert.deepEqual(pieces(24, 36, 96, 24, true), ['24+8', '32+4'], 'a part beat in compound time is cut inside the beat');
  /* an off-grid note (a triplet's edge) means that staff-measure gets no rests, and it is counted */
  const trip = [0, 1, 2].map(i => note(1, i / 3, 'C4', 60, { dur: 1 / 3, type: 'eighth' }));
  const p = N.prepare(measuresOf(1), 100, trip.concat([lh(1, 0, 'C3', 48, { dur: 4, type: 'whole' })]));
  assert.ok(p.stats.skippedGaps >= 1);
});

test('ties: a tieStart and a tieStop of one pitch that meet are drawn tied (in a bar or across a barline); an unpaired flag is dropped', () => {
  const ms = measuresOf(2);
  const notes = [note(1, 3, 'C4', 60, { tieStart: true }), note(2, 0, 'C4', 60, { tieStop: true, dur: 2, type: 'half' }),
    note(2, 2, 'E4', 64, { tieStart: true }),   /* no partner: dropped */
    note(2, 3, 'G4', 67, { tieStop: true })];   /* no partner: dropped */
  const out = N.neutralNotes(ms, notes);
  assert.deepEqual(out.map(n => [n.tieStart, n.tieStop]), [[true, false], [false, true], [false, false], [false, false]]);
  assert.equal(count(N.render(ms, 100, notes, 'p-').svg, /ppp-tie/g), 1, 'exactly one tie is drawn');
  /* the continuation carries no accidental of its own */
  const acc = N.neutralNotes(ms, [note(1, 3, 'C#4', 61, { tieStart: true }), note(2, 0, 'C#4', 61, { tieStop: true })]);
  assert.deepEqual(acc.map(n => n.acc), ['sharp', null]);
  /* the other staff, or not touching, is not a tie */
  const far = N.neutralNotes(ms, [note(1, 0, 'C4', 60, { tieStart: true }), note(1, 2, 'C4', 60, { tieStop: true }), note(1, 1, 'D4', 62, { tieStart: true }), lh(1, 2, 'D4', 62, { tieStop: true })]);
  assert.ok(far.every(n => !n.tieStart && !n.tieStop));
});

test('a note that runs past its barline is split into tied pieces of ordinary values (it would otherwise vanish from the drawing)', () => {
  const ms = measuresOf(3);
  const over = [note(1, 2, 'C4', 60, { dur: 3, type: 'half', dots: 1 })]; /* beats 3-4 and the first beat of bar 2 */
  const cut = N.neutralNotes(ms, over, { split: true });
  assert.deepEqual(cut.map(n => [n.m, n.b, n.dur, n.type, n.tieStart, n.tieStop]), [[1, 2, 2, 'half', true, false], [2, 0, 1, 'quarter', false, true]]);
  assert.equal(N.neutralNotes(ms, over).length, 1, 'counting notes (density) does not see the split');
  const long = N.neutralNotes(ms, [note(1, 0, 'C4', 60, { dur: 5, type: 'whole' })], { split: true });
  assert.deepEqual(long.map(n => [n.m, n.b, n.dur, n.tieStart, n.tieStop]), [[1, 0, 4, true, false], [2, 0, 1, false, true]]);
  const r = N.render(ms, 100, over, 'p-');
  assert.equal(heads(r.svg), 2); assert.equal(count(r.svg, /ppp-tie/g), 1);
  assert.deepEqual(r.notes, [[2, 3, 60]], 'the sound is the note as given');
});

test('clef rule: upper staff treble always; lower staff bass or treble per measure by fewer ledger lines, with the named advantage and minimum run', () => {
  const ms = measuresOf(8);
  const midiOf = nm => { const m = /^([A-G])(#|b)?(\d)$/.exec(nm); return 12 * (Number(m[3]) + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
  const bar = (m, names) => names.map((nm, i) => lh(m, i, nm, midiOf(nm)));
  const clefsOf = spec => N.lowerClefs(ms, spec.flatMap((mm, i) => mm ? bar(i + 1, mm) : []));
  assert.equal(N.CLEF_SAVE_SHARE, 0.5); assert.equal(N.CLEF_SAVE_MIN, 4); assert.equal(N.CLEF_MIN_RUN, 2);
  /* ledger lines as realize/ottava.js counts them: treble staff E4..F5, bass staff G2..A3 */
  assert.deepEqual([['C4', 'treble'], ['A3', 'treble'], ['G3', 'treble'], ['E4', 'treble'], ['A5', 'treble'], ['C4', 'bass'], ['E4', 'bass'], ['A3', 'bass'], ['E2', 'bass'], ['C2', 'bass']].map(x => N.ledgerLines(x[0], x[1])),
    [1, 2, 2, 0, 1, 1, 2, 0, 1, 2]);
  const low = ['C3', 'E3', 'G3', 'C3'], high = ['E4', 'G4', 'C5', 'F4'], marginal = ['G3', 'D4', 'B3', 'D4', 'G3', 'F4', 'D4', 'F4'] /* 7 lines in bass, 5 in treble */;
  assert.deepEqual(clefsOf(new Array(8).fill(low)), new Array(8).fill('bass'));
  assert.deepEqual(clefsOf(new Array(8).fill(high)), new Array(8).fill('treble'), 'a left hand written high opens in treble');
  assert.equal(clefsOf([['C4', 'C4', 'C4', 'C4']])[0], 'bass', 'a tie (middle C: one line either way) stays bass, the clef at the start');
  /* a change needs the other clef to save at least 50 % and at least 4 lines over the measure, and a stretch of at least 2 measures with notes */
  assert.deepEqual(clefsOf([low, low, low, high, high, high, high, high]), ['bass', 'bass', 'bass', 'treble', 'treble', 'treble', 'treble', 'treble']);
  assert.deepEqual(clefsOf([low, low, low, marginal, marginal, low, low, low]), new Array(8).fill('bass'), 'a bar that is only a little cheaper in the other clef changes nothing');
  assert.deepEqual(clefsOf([high, high, high, marginal, marginal, high, high, high]), new Array(8).fill('treble'), 'and the clef in force wins the same way from treble');
  assert.deepEqual(clefsOf([low, low, high, low, low, low, low, low]), new Array(8).fill('bass'), 'a single high bar is folded in (no pair of clef signs for one bar)');
  assert.deepEqual(clefsOf([low, low, low, low, low, low, low, high]), new Array(8).fill('bass'), 'and so is a single last bar');
  /* a silent bar keeps the clef in force; a staff with no notes at all is bass */
  assert.deepEqual(clefsOf([low, low, null, null, high, high, high, null]), ['bass', 'bass', 'bass', 'bass', 'treble', 'treble', 'treble', 'treble']);
  assert.deepEqual(clefsOf([low, null, null, high, high, high, null, null]), new Array(8).fill('treble'), 'a first stretch of one bar with notes is folded into the next');
  assert.deepEqual(N.lowerClefs(ms, []), new Array(8).fill('bass'));
  /* applied: no clef change inside a bar, the source's marks are not used, the upper staff is treble */
  const src = ms.map(m => Object.assign({}, m, { clefs: { 1: 'bass', 2: 'treble' }, clefChanges: [{ staff: 2, b: 2, clef: 'bass' }] }));
  const lowNotes = new Array(8).fill(low).flatMap((mm, i) => bar(i + 1, mm));
  N.measuresWithClefs(src, N.neutralNotes(src, lowNotes)).forEach(m => { assert.deepEqual(m.clefs, { 1: 'treble', 2: 'bass' }); assert.equal(m.clefChanges, null); });
  const svg = N.render(src, 100, lowNotes, 'p-').svg;
  assert.ok(/-fClef"/.test(svg), 'a left hand written low prints under the bass clef whatever clef the source had');
});

test('both arms get the same treatment: the same notes in either engine\'s shape give the same drawings (both layouts), rests and ties included', () => {
  const ms = measuresOf(3);
  const base = [note(1, 0, 'C4', 60, { dur: 2, type: 'half', tieStart: true }), note(1, 2, 'C4', 60, { dur: 2, type: 'half', tieStop: true }), lh(1, 0, 'C3', 48, { dur: 1 }), lh(3, 0, 'C3', 48, { dur: 4, type: 'whole' })];
  const g9Style = base.map(n => Object.assign({}, n, { finger: 2, sgHead: 'h', slurStart: true })).concat([{ m: 2, b: 0, dur: 4, rest: true, staff: 1, voice: 5 }]);
  const legacyStyle = base.slice().reverse().map(n => Object.assign({}, n, { abs: 3, writtenP: n.p, ottavaShift: 0, voice: 9 }));
  const a = N.render(ms, 100, g9Style, 'p-'), b = N.render(ms, 100, legacyStyle, 'p-');
  assert.equal(a.svg, b.svg); assert.equal(a.svgNarrow, b.svgNarrow);
  assert.ok(restCount(a.svg) >= 3 && count(a.svg, /ppp-tie/g) === 1);
  assert.equal(N.render(ms, 100, g9Style, 'p-').svgNarrow, a.svgNarrow, 'deterministic');
});

test('two layouts of one drawing: wide is the desktop configuration at 2 bars a system, narrow is the engraver\'s own phone configuration; same notes, rests, ties', () => {
  assert.deepEqual(N.LAYOUT.wide, { breakpoint: 'desktop', barsPerSystem: 2 });
  assert.deepEqual(N.LAYOUT.narrow, E.layout.screenConfig(720));
  assert.equal(N.LAYOUT.narrow.breakpoint, 'phone'); assert.equal(N.NARROW_VIEWPORT_PX, E.layout.SCREEN.phoneMaxPx);
  const ms = measuresOf(8);
  const notes = [];
  for (let m = 1; m <= 8; m++) { for (let i = 0; i < 4; i++) notes.push(note(m, i, 'E4', 64)); notes.push(lh(m, 0, 'C3', 48, { dur: 2, type: 'half' })); }
  const r = N.render(ms, 100, notes, 'i01X-');
  const systems = s => count(s, /class="ppp-system"/g);
  assert.ok(systems(r.svg) >= 3 && systems(r.svg) <= 4, '8 bars, the engraver aims at 2 a system (and may fit a third where they are sparse)');
  assert.ok(systems(r.svgNarrow) >= systems(r.svg));
  assert.equal(heads(r.svg), heads(r.svgNarrow));
  assert.equal(restCount(r.svg), restCount(r.svgNarrow));
  const vbw = s => +s.match(/viewBox="0 0 ([\d.]+)/)[1];
  assert.ok(vbw(r.svgNarrow) < 0.6 * vbw(r.svg));
  const ids = s => [...s.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids(r.svg).every(i => i.startsWith('i01X-') && !i.startsWith('i01X-n-')));
  assert.ok(ids(r.svgNarrow).every(i => i.startsWith('i01X-n-')), 'per-drawing glyph ids, so nothing repeats on the page');
  assert.equal(new Set(ids(r.svg).concat(ids(r.svgNarrow))).size, ids(r.svg).length + ids(r.svgNarrow).length);
  [r.svg, r.svgNarrow].forEach(s => assert.ok(!/ data-/.test(s) && !/width=|height=/.test(s.match(/^<svg[^>]*>/)[0])));
});

test('the sound is untouched by rests, ties, splits, clefs and layouts: a frozen list, the same with any drawing option', () => {
  const ms = measuresOf(3);
  const notes = [note(1, 3, 'C4', 60, { tieStart: true }), note(2, 0, 'C4', 60, { tieStop: true, dur: 2, type: 'half' }), note(1, 0, 'G4', 67, { dur: 3, type: 'half', dots: 1 }),
    lh(1, 0, 'C3', 48, { dur: 4, type: 'whole' }), lh(3, 0, 'G2', 43, { dur: 5, type: 'whole' }) /* runs past its bar */, note(3, 0, 'C4', 60, { dur: 1 }),
    note(3, 0, 'C4', 60, { dur: 2, type: 'half', staff: 2, hand: 'l', voice: 2 })];
  const frozen = [[0, 4, 48], [0, 3, 67], [3, 3, 60], [8, 5, 43], [8, 2, 60]].sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  assert.deepEqual(N.audioNotes(ms, notes), frozen);
  assert.deepEqual(N.render(ms, 100, notes, 'p-').notes, frozen);
  assert.deepEqual(N.render(ms, 100, notes, 'p-', { ottava: false }).notes, frozen);
  assert.deepEqual(N.audioNotes(ms, notes.concat([{ m: 2, b: 2, dur: 2, rest: true }])), frozen, 'an engine\'s rest entries do not change it either');
});

test('spacing: on a dense piece (sixteenths) consecutive onsets in the same staff are at least 2.0 staff spaces apart in the wide drawing, and at least 1.4 (the engraver\'s own rod) in the narrow one', () => {
  const R = require(path.join(REPO, 'scoregraph/rational.js'));
  const ms = measuresOf(8);
  const notes = [];
  for (let m = 1; m <= 8; m++) for (let i = 0; i < 16; i++) { notes.push(note(m, i / 4, ['C5', 'E5', 'G5', 'E5'][i % 4], [72, 76, 79, 76][i % 4], { dur: 0.25, type: '16th' })); notes.push(lh(m, i / 4, 'C3', 48, { dur: 0.25, type: '16th' })); }
  const graph = N.prepare(ms, 100, notes).graph, plan = E.plan(graph);
  const gaps = cfg => {
    const eng = E.layout.engrave(plan, cfg), evs = new Map(plan.events.map(e => [e.id, e])), idx = new Map(plan.measures.map((m, i) => [m.id, i]));
    const by = new Map();
    eng.objects.forEach(o => {
      if (o.kind !== 'notehead') return;
      const e = evs.get(o.event), k = o.system + '|' + o.staffKey, t = idx.get(e.m) * 100 + R.toNumber(R.parse(e.at));
      if (!by.has(k)) by.set(k, new Map());
      if (!by.get(k).has(t) || o.box[0] < by.get(k).get(t)) by.get(k).set(t, o.box[0]);
    });
    const out = [];
    by.forEach(mm => { const xs = [...mm.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]); for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]); });
    return out;
  };
  const wide = gaps(N.LAYOUT.wide), narrow = gaps(N.LAYOUT.narrow);
  assert.ok(wide.length > 100 && narrow.length > 100);
  assert.ok(Math.min.apply(null, wide) >= 2.0, 'wide: tightest gap ' + Math.min.apply(null, wide));
  assert.ok(Math.min.apply(null, narrow) >= 1.4, 'narrow: tightest gap ' + Math.min.apply(null, narrow));
});

/* ---- the ottava pass reads the clef the drawing uses (clefs are written into the graph first, then addOttava runs) ---- */
test('ottava is evaluated against the drawn clef: a low left hand written under a treble-clef source gets the bass clef and NO ottava; the source-clef graph would get an 8vb', () => {
  const OTTAVA = require(path.join(REPO, 'realize/ottava.js'));
  const L = require(path.join(REPO, 'realize/tools/legacy.js'));
  const src = measuresOf(4).map(m => Object.assign({}, m, { clefs: { 1: 'treble', 2: 'treble' } })); /* a source that writes its left hand in treble */
  const pitches = [['C3', 48], ['E3', 52], ['G3', 55], ['E3', 52]];
  const notes = [];
  for (let m = 1; m <= 4; m++) for (let i = 0; i < 4; i++) { notes.push(lh(m, i, pitches[i][0], pitches[i][1])); notes.push(note(m, i, 'E4', 64)); }
  const spans = g => g.parts[0].spanners.filter(s => s.type === 'ottava');
  const p = N.prepare(src, 100, notes);
  assert.equal(spans(p.graph).length, 0, 'C3-G3 is comfortably on the bass staff: no line');
  assert.deepEqual(p.graph.parts[0].clefs.filter(c => c.staff === p.graph.parts[0].staves[1].id).map(c => c.sign), ['F'], 'the graph carries the drawn (bass) clef');
  /* the order the review used to have: the source's clef map, then the pass: an 8vb under a G clef */
  const old = L.graphFromLegacyNotes(src, N.neutralNotes(src, notes), 100, 'x').graph;
  assert.ok(spans(OTTAVA.addOttava(old).graph).length >= 1, 'against the source clef (treble) the same notes would get an 8vb');
});

test('ottava and the drawn clef agree: every line is justified (a note needing 2+ ledger lines) against the clef in force at that measure, both arms alike', () => {
  const STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const CL = { G: [30, 38], F: [18, 26] };
  const linesOf = (h, clef) => { const d = 7 * h.pitch.oct + STEP[h.pitch.step], [lo, hi] = CL[clef]; return d > hi ? Math.floor((d - hi) / 2) : d < lo ? Math.floor((lo - d) / 2) : 0; };
  const ms = measuresOf(8);
  const notes = [];
  /* right hand high (E6..C7) in bars 1-4, left hand low in bars 1-4 (E1..G2) and mid (G3-D4) in bars 5-8, right hand mid throughout after */
  const hi = [['E6', 88], ['G6', 91], ['C7', 96], ['G6', 91]], lo = [['E1', 28], ['G1', 31], ['C2', 36], ['G1', 31]], mid = [['G3', 55], ['B3', 59], ['D4', 62], ['C4', 60]];
  for (let m = 1; m <= 8; m++) for (let i = 0; i < 4; i++) {
    notes.push(m <= 4 ? note(m, i, hi[i][0], hi[i][1]) : note(m, i, 'E4', 64));
    notes.push(m <= 4 ? lh(m, i, lo[i][0], lo[i][1]) : lh(m, i, mid[i][0], mid[i][1]));
  }
  const g9Style = notes.map(n => Object.assign({}, n, { finger: 3, sgHead: 'h', voice: n.voice + 4 }));
  const legacyStyle = notes.slice().reverse().map(n => Object.assign({}, n, { abs: 1, writtenP: n.p, ottavaShift: 0 }));
  const summary = arm => {
    const p = N.prepare(ms, 100, arm), part = p.graph.parts[0], drawn = N.lowerClefs(ms, N.neutralNotes(ms, arm, { split: true }));
    const mi = new Map(p.graph.timeline.measures.map((m, i) => [m.id, i]));
    const sp = part.spanners.filter(s => s.type === 'ottava');
    sp.forEach(s => {
      const si = part.staves.findIndex(x => x.id === s.staff);
      const from = mi.get(s.from.m), to = mi.get(s.to.m);
      let worst = 0;
      part.events.filter(e => e.kind === 'note' && e.staff === s.staff && mi.get(e.m) >= from && mi.get(e.m) <= to).forEach(e => e.heads.forEach(h => {
        worst = Math.max(worst, linesOf(h, si === 0 ? 'G' : drawn[mi.get(e.m)] === 'treble' ? 'G' : 'F'));
      }));
      assert.ok(worst >= 2, 'a line on staff ' + (si + 1) + ' whose notes need at most ' + worst + ' ledger lines in the drawn clef');
    });
    return sp.map(s => [part.staves.findIndex(x => x.id === s.staff) + 1, s.shift, mi.get(s.from.m), mi.get(s.to.m)]);
  };
  const a = summary(g9Style), b = summary(legacyStyle);
  assert.deepEqual(a, b, 'the same lines for both arms');
  assert.ok(a.some(x => x[0] === 1 && x[1] > 0), 'a genuinely high right hand still gets an 8va (or 15ma)');
  assert.ok(a.some(x => x[0] === 2 && x[1] < 0), 'a genuinely low left hand still gets an 8vb (or 15mb)');
  assert.ok(!a.some(x => x[0] === 2 && x[2] >= 4), 'a left hand at G3-D4 (bars 5-8) gets no line');
});
