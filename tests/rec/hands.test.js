/* rec/hands.js, stage S4 (G10a-2, docs/GOALS/G10_AUDIO_TO_SCORE.md section 8; playability G10a-2b, section 26): the staff of
   every heard note, and its wiring into toMusicXml (recording 'v2'; opts.hands). node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, lcg } = require('./helpers.js');
const H = require(path.join(REPO, 'rec', 'hands.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));
const AS = require(path.join(REPO, 'audio-score.js'));

const MODEL_FILE = path.join(REPO, 'rec', 'weights', 'hands-v1.json');

/* notes of a little piece: groups = [[seconds, [midi, ...]], ...], one tick per group */
function piece(groups, spq) {
  const notes = [];
  groups.forEach(([t, midis], i) => midis.forEach(m => notes.push({ midi: m, tick: i * 6, on: t, off: t + (spq || 0.25) })));
  return notes;
}
const staffOf = (notes, r) => notes.map((n, i) => [n.midi, r.staff[i]]);

test('the model file: its schema, a style per texture, a cost per table cell, within the section 11 budget', () => {
  const m = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  assert.equal(m.schema, H.SCHEMA);
  assert.equal(m.version, 'hands-v1.1');
  assert.deepEqual(m.styles.map(s => s.name), ['piano', 'chorale']);
  /* G10a-2b: the context of a group in the partition table, G5a's hard violations; the textures are evaluated, not counted */
  assert.deepEqual(m.params.ctx, { w: 0.5, d: 12 });
  assert.deepEqual(Object.keys(m.params.play).sort(), ['keys', 'perSemi', 'reach', 'span', 'w']);
  assert.equal(m.params.play.keys, 5);
  assert.equal(m.params.play.reach, 12);
  assert.equal(m.params.play.perSemi, 0.012);
  assert.deepEqual(m.trained.textures, { evaluated: ['octaves-l', 'octaves-r', 'octaves'], counted: [] });
  const L = H._.layout(m.params);
  m.styles.forEach(s => {
    assert.equal(s.costs.length, L.size);
    assert.ok(s.costs.every(c => Number.isInteger(c) && c >= 0));
  });
  H._.TABLES.forEach(t => assert.ok(Number.isFinite(m.weights[t]) && m.weights[t] >= 0, t));
  assert.ok(fs.statSync(MODEL_FILE).size < 100 * 1024, 'hand model under 100 KB (all rec/ models: 200 KB)');
  assert.ok(m.trained && /hold-out excluded/.test(m.trained.data));
});

test('assign: one staff (1 right / 2 left) and a confidence per note; a note that has a staff keeps it; a note without a pitch is left out', () => {
  const notes = piece([[0, [48, 64, 67, 72]], [0.5, [67]], [1, [43, 62, 65, 71]], [1.5, [67]]]);
  notes.push({ midi: 50, tick: 6, on: 0.5, staff: 2 });
  notes.push({ tick: 6, on: 0.5 });
  const r = H.assign(notes);
  assert.equal(r.staff.length, notes.length);
  r.staff.slice(0, -2).forEach(s => assert.ok(s === 1 || s === 2));
  r.conf.slice(0, -2).forEach(c => assert.ok(c >= 0 && c <= 1));
  assert.equal(r.staff[notes.length - 2], 2);
  assert.equal(r.conf[notes.length - 2], 1);
  assert.equal(r.staff[notes.length - 1], 0);
  assert.equal(r.report.notes, notes.length - 2);
  assert.equal(r.report.model, 'hands-v1.1');
  assert.ok(['piano', 'chorale'].includes(r.report.style));
});

test('assign is a pure function: the same notes in any order get the same staves, run after run', () => {
  const rnd = lcg(7);
  const groups = [];
  for (let i = 0; i < 64; i++) groups.push([i * 0.25, i % 4 === 0 ? [36 + (i % 12), 60 + (i % 7), 64 + (i % 5)] : [62 + Math.floor(rnd() * 14)]]);
  const notes = piece(groups);
  const a = H.assign(notes), b = H.assign(notes);
  assert.deepEqual(a, b);
  const order = notes.map((n, i) => i).sort((x, y) => (Math.imul(x + 1, 2654435761) >>> 0) - (Math.imul(y + 1, 2654435761) >>> 0));
  const c = H.assign(order.map(i => notes[i]));
  order.forEach((i, j) => { assert.equal(c.staff[j], a.staff[i]); assert.equal(c.conf[j], a.conf[i]); });
});

test('without ticks the onset groups come from the attack times (a chord one 32-ms frame apart is one group)', () => {
  const ticked = piece([[0, [48, 72]], [0.5, [52, 76]], [1, [55, 79]], [1.5, [60, 84]]]);
  const timed = ticked.map((n, i) => ({ midi: n.midi, on: n.on + (i % 2 ? 0.032 : 0) }));
  assert.deepEqual(H.assign(timed).staff, H.assign(ticked).staff);
});

test('parallel octaves (Hanon, Beyer\'s first pieces) are one note per hand, the lower in the left', () => {
  const run = [48, 50, 52, 53, 55, 53, 52, 50, 48, 52, 55, 60, 55, 52, 48, 47];
  const notes = piece(run.map((m, i) => [i * 0.25, [m, m + 12]]));
  const r = H.assign(notes);
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi === Math.min(...notes.filter(x => x.tick === n.tick).map(x => x.midi)) ? 2 : 1,
    'midi ' + n.midi + ' at tick ' + n.tick));
});

test('a left-hand broken chord in the treble stays in the left hand under a right-hand melody (Beyer 52), where the legacy split moved it', () => {
  const bar = (c, melody) => [[0, [c, melody[0]]], [0.25, [c + 4]], [0.5, [c + 7, melody[1]]], [0.75, [c + 4]], [1, [c, melody[2]]], [1.25, [c + 4]], [1.5, [c + 7]]];
  const groups = [];
  [[60, [76, 74, 72]], [59, [74, 79, 77]], [60, [76, 74, 72]], [60, [76, 74, 72]]].forEach(([c, mel], b) =>
    bar(c, mel).forEach(([t, m]) => groups.push([b * 2 + t, m])));
  const notes = piece(groups);
  const r = H.assign(notes);
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi >= 72 ? 1 : 2, 'midi ' + n.midi + ' at tick ' + n.tick));
});

test('a four-part chorale is read as a chorale: soprano and alto in the upper staff, tenor and bass in the lower', () => {
  const chords = [[48, 55, 64, 72], [53, 57, 65, 72], [55, 59, 62, 71], [48, 55, 64, 72], [45, 57, 64, 72], [50, 57, 65, 69],
    [43, 55, 62, 71], [48, 52, 60, 67], [41, 57, 60, 69], [43, 55, 59, 67], [48, 55, 64, 72], [55, 59, 62, 67]];
  const notes = piece(chords.map((c, i) => [i * 0.6, c]));
  const r = H.assign(notes);
  assert.equal(r.report.style, 'chorale');
  notes.forEach((n, i) => {
    const g = notes.filter(x => x.tick === n.tick).map(x => x.midi).sort((a, b) => a - b);
    assert.equal(r.staff[i], g.indexOf(n.midi) < 2 ? 2 : 1, 'midi ' + n.midi + ' at tick ' + n.tick);
  });
});

test('piano block chords are not a chorale: a bass note under a right-hand triad is one plus three (Czerny 599 no. 35)', () => {
  const groups = [];
  for (let b = 0; b < 8; b++) {
    const bass = [36, 43, 36, 43][b % 4], triad = b % 2 ? [62, 67, 71] : [64, 67, 72];
    groups.push([b * 2, [bass].concat(triad)], [b * 2 + 0.5, [bass + 12].concat(triad)], [b * 2 + 1, [bass + 12].concat(triad)], [b * 2 + 1.5, [bass + 12]]);
  }
  const notes = piece(groups);
  const r = H.assign(notes);
  assert.equal(r.report.style, 'piano');
  notes.forEach((n, i) => assert.equal(r.staff[i], n.midi < 60 ? 2 : 1, 'midi ' + n.midi + ' at tick ' + n.tick));
});

test('no model, no guess: assign throws E-HANDS-NO-MODEL; under v2 toMusicXml then keeps the legacy split and says so', () => {
  assert.throws(() => H.assign(piece([[0, [60]]]), { model: { schema: 'something else' } }), e => e.code === 'E-HANDS-NO-MODEL');
  const notes = [];
  for (let i = 0; i < 48; i++) notes.push({ on: 1 + i * 0.25, off: 1.2 + i * 0.25, midi: i % 4 === 0 ? 48 : 64 + (i % 5), vel: 64 });
  H.setModel({ schema: 'not the hand model' });
  try {
    const r = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
    assert.deepEqual(r.handsReport, { fallback: 'legacy', code: 'E-HANDS-NO-MODEL' });
    const legacyHands = AS.toMusicXml({ notes: notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2', hands: 'legacy' });
    assert.equal(r.xml, legacyHands.xml);
    /* asked for by name, a missing model is an error: a measurement must know which hands ran */
    assert.throws(() => AS.toMusicXml({ notes: notes }, { title: 't', hands: 'v2' }), e => e.code === 'E-HANDS-NO-MODEL');
  } finally {
    H.setModel(null);
  }
});

test('toMusicXml: v2 writes S4\'s hands and reports them; hands \'legacy\' keeps assignHands under v2; without options nothing changes', () => {
  const notes = [];
  /* a left-hand broken chord in the treble under a melody: the legacy split puts the figure's top in the right hand */
  for (let b = 0; b < 12; b++) {
    const t0 = 1 + b * 2;
    [[0, 60], [0.25, 64], [0.5, 67], [0.75, 64], [1, 60], [1.25, 64], [1.5, 67], [1.75, 64]].forEach(([q, m]) =>
      notes.push({ on: t0 + q, off: t0 + q + 0.24, midi: m, vel: 60 }));
    [[0, 76], [0.5, 74], [1, 72]].forEach(([q, m]) => notes.push({ on: t0 + q, off: t0 + q + 0.48, midi: m, vel: 70 }));
  }
  const base = { title: 't', closeGaps: true, exactBars: true };
  const v2 = AS.toMusicXml({ notes: notes }, Object.assign({ recording: 'v2' }, base));
  assert.ok(v2.handsReport && v2.handsReport.model === 'hands-v1.1', JSON.stringify(v2.handsReport));
  assert.equal(v2.stats.lh, notes.filter(n => n.midi < 72).length);
  const v2legacy = AS.toMusicXml({ notes: notes }, Object.assign({ recording: 'v2', hands: 'legacy' }, base));
  assert.equal(v2legacy.handsReport, undefined);
  assert.ok(v2legacy.stats.lh < v2.stats.lh, 'the legacy split moved part of the figure: ' + v2legacy.stats.lh);
  /* the app's path and the library default: no handsReport, the legacy split (the bench's ab proves byte identity) */
  assert.equal(AS.toMusicXml({ notes: notes }, base).handsReport, undefined);
  assert.equal(AS.toMusicXml({ notes: notes }, {}).handsReport, undefined);
  /* the app's path with only S4 swapped (the rec-hands measurement suite) */
  assert.equal(AS.toMusicXml({ notes: notes }, Object.assign({ hands: 'v2' }, base)).handsReport.model, 'hands-v1.1');
  /* rec/index.js exposes the stage */
  assert.equal(REC.hands, H);
});

test('budget (section 11): S4 on a 1,800-note piece in well under the 300 ms all of rec/ may take', () => {
  const rnd = lcg(3);
  const notes = [];
  for (let i = 0; i < 600; i++) {
    const t = i * 0.1, bass = 36 + Math.floor(rnd() * 12);
    notes.push({ midi: bass, tick: i * 3, on: t }, { midi: bass + 7 + Math.floor(rnd() * 5), tick: i * 3, on: t },
      { midi: 64 + Math.floor(rnd() * 20), tick: i * 3, on: t });
  }
  H.assign(notes);
  const t0 = process.hrtime.bigint();
  H.assign(notes);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 250, 'S4 took ' + ms.toFixed(1) + ' ms');
});

/* ---------------------------------------------------------------- G10a-2b: playability (docs/GOALS/G10 section 26) */
const X = H._;
const MODEL = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));

test('a cover\'s octaves (G10 section 26): a melody in octaves over a bass far below is the right hand\'s, both notes; a bass in octaves is the left hand\'s', () => {
  const mel = [76, 74, 72, 74, 76, 76, 76, 74, 74, 74, 76, 79, 79, 76, 74, 72], bass = [36, 31, 33, 29];
  const rh = piece(mel.map((m, i) => [i * 0.3, (i % 2 === 0 ? [bass[(i / 2) % 4]] : []).concat([m - 12, m])]));
  let r = H.assign(rh);
  rh.forEach((n, i) => assert.equal(r.staff[i], n.midi >= 60 ? 1 : 2, 'melody octaves: midi ' + n.midi + ' at tick ' + n.tick));
  const lh = piece(mel.map((m, i) => [i * 0.3, i % 2 === 0 ? [bass[(i / 2) % 4], bass[(i / 2) % 4] + 12] : [m]]));
  r = H.assign(lh);
  lh.forEach((n, i) => assert.equal(r.staff[i], n.midi >= 60 ? 1 : 2, 'bass octaves: midi ' + n.midi + ' at tick ' + n.tick));
});

test('the playability term (G5a): an inner note just before a leap goes to the hand that can still make the leap; without the term it does not', () => {
  /* the teacher's bar 37 in miniature: a left-hand bass, a G3 alone, then E6 0.19 s later (33 semitones: G5a needs 0.25 s) */
  const notes = piece([[0, [36, 48]], [0.37, [36, 53]], [0.55, [48]], [0.74, [55]], [0.93, [88]], [1.11, [79, 82, 85]], [1.30, [76, 82]],
    [1.48, [29, 41, 72, 75, 84]], [2.0, [41]]]);
  const g3 = notes.findIndex(n => n.midi === 55);
  assert.equal(H.assign(notes).staff[g3], 2, 'G3 in the left hand');
  const noPlay = Object.assign({}, MODEL, { params: Object.assign({}, MODEL.params, { play: undefined }) });
  assert.equal(H.assign(notes, { model: noPlay }).staff[g3], 1, 'without the term the right hand takes G3 and then cannot reach E6 in time');
});

test('hardOf counts what G5a calls hard: a hand wider than the span, more than five keys, a shift too fast for its distance', () => {
  const Q = MODEL.params.play;
  const s = { rLo: 64, rHi: 76, lLo: 36, lHi: 48, cR: 70, cL: 42, tR: 0, tL: 0, nR: 2, nL: 2, iR: 0, iL: 0 };
  const g = (t, p) => ({ t: t, p: p, shape: X.shapeOf(p) });
  assert.equal(X.hardOf(Q, s, g(1, [40, 72]), 1), 0, 'one note per hand, near where each hand was');
  assert.equal(X.hardOf(Q, s, g(1, [40, 40 + Q.span + 1]), 0), 1, 'one hand wider than the span');
  assert.equal(X.hardOf(Q, s, g(1, [40, 40 + Q.span]), 0), 0, 'as wide as the span is allowed');
  assert.equal(X.hardOf(Q, s, g(1, [60, 62, 64, 65, 67, 69]), 0), 1, 'six keys in the right hand');
  /* the right hand from E4-E5 (mean 70, top 76) to C8 in 0.1 s: its mean and its top both shift too far (38 and 32 semitones) */
  assert.equal(X.hardOf(Q, s, g(0.1, [108]), 0), 2);
  /* the same shift with all the time it needs is no violation: (36 - reach) x perSemi seconds */
  assert.equal(X.hardOf(Q, s, g((38 - Q.reach) * Q.perSemi + 0.01, [108]), 0), 0);
  assert.equal(X.hardOf(Q, s, g((38 - Q.reach) * Q.perSemi - 0.01, [108]), 0), 1, 'the mean still too far, the top (32 semitones) not');
  /* a hand that has not played yet has nowhere to come from */
  assert.equal(X.hardOf(Q, Object.assign({}, s, { tR: -Infinity }), g(0.1, [108]), 0), 0);
});

test('contextOf: a note an octave or more below or above within half a second, read from the notes alone; the partition table is counted per class', () => {
  const P = MODEL.params;
  const gs = X.contextOf(X.groupsOf(piece([[0, [36]], [0.3, [62, 74]], [1.0, [62, 74]], [1.4, [86]], [3.0, [50, 62]]]), {}), P);
  assert.deepEqual(gs.map(g => g.ctx), [2, 1, 2, 1, 0]);
  /* the same group shape in two contexts emits two different partition cells; the other tables are the same */
  const L = X.layout(P), s0 = X.startOf(gs);
  const cells = g => { const ix = []; X.step(P, L, s0, g, 0, i => ix.push(i)); return ix; };
  const a = cells(gs[1]), b = cells(gs[2]);
  assert.notEqual(a[0], b[0]);
  assert.equal(a[0] - b[0], (1 - 2) * (X.CAP + 1) * (X.CAP + 1));
  assert.deepEqual(a.slice(1), b.slice(1));
  /* a model without params.ctx (hands-v1) has one class: its decoding is the one of G10a-2 */
  const P1 = { beam: 32, dtEdges: P.dtEdges };
  assert.equal(X.layout(P1).part, 0);
  assert.equal(X.layout(P).span, X.SHAPES * X.CONTEXTS * (X.CAP + 1) * (X.CAP + 1));
  assert.equal(X.layout(P1).span, X.SHAPES * (X.CAP + 1) * (X.CAP + 1));
});

test('a price, not a wall (G10 section 26.3): one group no hand can play does not change the hands of the ordinary notes after it', () => {
  /* eight bars of a left-hand bass note and a right-hand dyad on every half second, twelve notes struck at once (36 to 73: every
     split gives one hand more than five keys), the same eight bars again. If a hard violation were an infinite price, every choice
     for that group would cost the same, and the choices of the groups after it would be decided by nothing but the order the
     search saw them in: a third of the later notes land in the wrong hand (measured: 32 of 96). Each violation costs w instead. */
  const notes = [], gold = [];
  let t = 0;
  const bars = () => {
    for (let b = 0; b < 8; b++) {
      for (let i = 0; i < 4; i++, t += 0.5) {
        [[40 + (i % 2) * 7, 2], [67 + (i % 3), 1], [72 + (i % 2), 1]].forEach(([m, h]) => { notes.push({ midi: m, on: t, attack: t }); gold.push(h); });
      }
    }
  };
  bars();
  const clusterFrom = notes.length, cluster = [36, 38, 41, 45, 48, 52, 55, 59, 62, 66, 69, 73];
  cluster.forEach(m => { notes.push({ midi: m, on: t, attack: t }); gold.push(0); });
  t += 0.5;
  bars();
  /* the fixture is what it says: whichever notes of the group go to the left hand (the lowest k), some hand is over the line */
  const Q = MODEL.params.play;
  const s = { rLo: 64, rHi: 76, lLo: 36, lHi: 48, cR: 70, cL: 42, tR: 0, tL: 0, nR: 2, nL: 2, iR: 0, iL: 0 };
  const g = { t: t - 0.5, p: cluster, shape: X.shapeOf(cluster) };
  for (let k = 0; k <= cluster.length; k++) assert.ok(X.hardOf(Q, s, g, k) >= 1, 'a split with ' + k + ' notes in the left hand is playable');
  const r = H.assign(notes);
  const right = (from, to) => { let ok = 0, n = 0; for (let i = from; i < to; i++) if (gold[i]) { n++; if (r.staff[i] === gold[i]) ok++; } return [ok, n]; };
  assert.deepEqual(right(0, clusterFrom), [96, 96], 'before the group');
  assert.deepEqual(right(clusterFrom + cluster.length, notes.length), [96, 96], 'after the group');
  cluster.forEach((m, i) => assert.ok(r.staff[clusterFrom + i] === 1 || r.staff[clusterFrom + i] === 2, 'the group itself still gets hands'));
});
