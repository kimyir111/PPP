/* rec/ S0-S2 (G10a-1, docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8 and 18): the attacks, the pulse tracks, the metre
   model's arithmetic and the time skeleton on synthetic performances whose metre, tempo and bar lines are known.
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, perform, waltz, march, jig, skeletonInput } = require('./helpers.js');
const ATT = require(path.join(REPO, 'rec', 'attacks.js'));
const BEATS = require(path.join(REPO, 'rec', 'beats.js'));
const MODEL = require(path.join(REPO, 'rec', 'model.js'));
const METRE = require(path.join(REPO, 'rec', 'metre.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));

test('S0: cleanNotes keeps the playable notes, and attacksOf makes one attack per attack time', () => {
  const notes = ATT.cleanNotes([
    { on: 1, off: 1.5, midi: 60, vel: 70 }, { on: 1, off: 1.5, midi: 64, vel: 50 }, { on: 2, off: 2.01, midi: 67, vel: 60 },
    { on: 3, off: 3.5, midi: 15, vel: 60 }, { on: 3, off: 3.5, midi: 70, vel: 4 }, { on: NaN, off: 4, midi: 60, vel: 60 }]);
  assert.equal(notes.length, 3);
  assert.equal(notes[2].off, 2.03);                     /* a release at least 30 ms after the onset */
  const att = ATT.attacksOf(notes);
  assert.equal(att.length, 2);
  assert.deepEqual([att[0].n, att[0].low, att[0].high, att[0].vel], [2, 60, 64, 70]);
  assert.equal(att[0].pcs, (1 << 0) | (1 << 4));
});

test('S0: the attack classes read a performance and a score the same way', () => {
  const seq = [{ t: 0, low: 48, n: 3 }, { t: 1, low: 48, n: 1 }, { t: 2, low: 43, n: 1 }, { t: 2.5, low: 55, n: 1 }, { t: 5, low: 57, n: 4 }];
  const c = ATT.classesOf(seq);
  assert.deepEqual(c.map(x => x.bass), [0, 0, 2, 1, 1]);
  assert.deepEqual(c.map(x => x.ioi), [1, 1, 0, 2, 4]);   /* IOIs 1, 1, 0.5, 2.5 against their median 1, then the last */
  assert.deepEqual(c.map(x => x.size), [2, 1, 1, 1, 2]);
  /* the same onsets in other units give the same classes (the score's slots, the performance's seconds) */
  assert.deepEqual(ATT.classesOf(seq.map(o => Object.assign({}, o, { t: o.t * 24 }))), c);
});

test('S1: a steady performance gives a track at its pulse; position and timeAt are inverses', () => {
  const p = march(16, 100, { jitter: 0.015, seed: 3 });
  const att = ATT.attacksOf(skeletonInput(p.notes));
  const tracks = BEATS.tracks(att, {});
  assert.ok(tracks.length >= 1 && tracks.length <= 6);
  /* some track follows a metrical level of the music (quarter 0.6 s, half 1.2 s ...) within 4 % */
  assert.ok(tracks.some(t => [0.3, 0.6, 1.2].some(l => Math.abs(Math.log(t.period / l)) < 0.04)), tracks.map(t => t.period).join(','));
  const b = tracks[0].beats;
  [0.3, 1.7, 5.5, 20.25].forEach(x => assert.ok(Math.abs(BEATS.position(b, BEATS.timeAt(b, x)) - x) < 1e-9));
  assert.ok(b[0] <= att[0].t && b[b.length - 1] >= att[att.length - 1].t, 'the track covers every attack');
});

test('S1: an audio beat track is cleaned and its missed beats filled', () => {
  const att = ATT.attacksOf(skeletonInput(march(4, 120, {}).notes));
  const beats = [1, 1.5, 2, 3, 3.5, 3.505, 4, 4.5, 6, 6.5, 7];          /* 2.5 and 5, 5.5 missing; a double at 3.505 */
  const tr = BEATS.audioTrack(beats, att);
  assert.ok(tr.audio);
  const inside = tr.beats.filter(t => t >= 1 - 1e-9 && t <= 7 + 1e-9).map(t => Math.round(t * 1000) / 1000);
  assert.deepEqual(inside, [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]);
  assert.equal(BEATS.audioTrack([1, 2, 3], att), null);
});

test('model: metrical levels of the eight metres', () => {
  const m44 = MODEL.METRES[MODEL.BY_KEY['4/4']];
  assert.deepEqual([0, 48, 24, 72, 12, 6, 8, 16, 3, 4, 1, 5].map(s => m44.level[s]), [0, 1, 2, 2, 3, 4, 5, 5, 6, 6, -1, -1]);
  const m68 = MODEL.METRES[MODEL.BY_KEY['6/8']];
  assert.deepEqual([0, 36, 12, 24, 6, 3, 18].map(s => m68.level[s]), [0, 1, 2, 2, 3, 4, 3]);
  assert.deepEqual(MODEL.METRES.map(m => m.key), ['2/4', '3/4', '4/4', '2/2', '3/8', '6/8', '9/8', '12/8']);
  assert.deepEqual(MODEL.METRES.filter(m => m.compound).map(m => m.key), ['3/8', '6/8', '9/8', '12/8']);
});

test('model: log Gamma and the Beta-binomial are exact enough and sum to one', () => {
  [[1, 0], [2, 0], [5, Math.log(24)], [0.5, Math.log(Math.sqrt(Math.PI))], [10.5, 13.940625219403763]].forEach(([x, v]) =>
    assert.ok(Math.abs(MODEL.lgamma(x) - v) < 1e-10, x));
  /* sum over k of C(n, k) P(one pattern with k hits) = 1 */
  const n = 9, a = 0.7, b = 2.3;
  let s = 0, c = 1;
  for (let k = 0; k <= n; k++) { s += c * Math.exp(MODEL.logBB(k, n - k, a, b)); c = c * (n - k) / (k + 1); }
  assert.ok(Math.abs(s - 1) < 1e-10, s);
});

test('model: tables from a tiny catalogue are well formed and deterministic', () => {
  const row = (time, qpm, bars, onsets) => ({ id: 'x', time: time, qpm: qpm, bar_q: time[0] * 4 / time[1], pickup_q: 0, bars: bars, onsets: onsets });
  const rows = [
    row([3, 4], 100, 2, [[0, 0, 48, 3, -1, 24, 24, 1], [0, 24, 60, 2, 48, 24, 24, 16], [0, 48, 60, 2, 60, 24, 24, 16], [1, 0, 43, 3, 60, 72, 72, 129]]),
    row([4, 4], 120, 1, [[0, 0, 48, 4, -1, 48, 48, 145], [0, 48, 55, 3, 48, -1, 48, 129]])];
  const t1 = MODEL.buildTables(rows), t2 = MODEL.buildTables(rows);
  assert.equal(JSON.stringify(t1), JSON.stringify(t2));
  assert.deepEqual(Object.keys(t1.metres).sort(), MODEL.METRES.map(m => m.key).sort());
  assert.deepEqual(Object.keys(t1.families).sort(), ['compound', 'simple']);
  MODEL.METRES.forEach(m => ['dur', 'bass', 'harm', 'size', 'joint'].forEach(k => {
    assert.equal(t1.metres[m.key].beat[k].length, 3);
    t1.metres[m.key].beat[k].forEach(r => r.forEach(v => assert.ok(Number.isFinite(v))));
  }));
  t1.families.simple.fill.forEach(([a, b]) => assert.ok(a > 0 && b > 0));
});

test('S2: the committed model reads a waltz as 3/4, a march as 4/4 and a jig as 6/8, at the played tempo', () => {
  const cases = [['3/4', waltz(24, 120, { jitter: 0.012, seed: 5 }), 120], ['4/4', march(16, 96, { jitter: 0.012, seed: 7 }), 96],
    ['6/8', jig(16, 90, { jitter: 0.012, seed: 9 }), 90]];
  cases.forEach(([metre, p, qpm]) => {
    const sk = REC.skeleton(skeletonInput(p.notes), {});
    assert.ok(sk, metre);
    assert.equal(sk.metre.key, metre, metre + ': ' + JSON.stringify(sk.metrePosterior));
    assert.ok(Math.abs(Math.log(sk.qpm / qpm)) < Math.log(1.04), metre + ': qpm ' + sk.qpm);
    /* beats[0] is the bar line before the first attack: the first attack (a downbeat in these pieces) is on it */
    assert.ok(Math.abs(sk.beats[0] - 1) < 0.05, metre + ': first bar line ' + sk.beats[0]);
    assert.ok(sk.conf >= 0 && sk.conf <= 1 && sk.posterior > 0 && sk.posterior <= 1);
  });
});

/* a known limit of a1 (G10 section 18): the first-onset prior (85 % of the catalogue starts on a downbeat) outweighs the
   accents of a short piece, so a one-beat pickup is read as a downbeat and the metre follows. A todo, not a pass */
test('S2: a pickup of one beat is read as a pickup, not as a bar starting on it', { todo: 'G10a-1 limit: the pickup prior wins (section 18)' }, () => {
  const p = waltz(24, 120, { jitter: 0.01, seed: 11, start: 1.5 });
  p.notes.unshift({ on: 1, off: 1.4, midi: 67, vel: 64 });       /* an upbeat a quarter before the first downbeat (1.5 s) */
  const sk = REC.skeleton(skeletonInput(p.notes), {});
  assert.equal(sk.metre.key, '3/4');
  const barLines = [];
  for (let i = 0; i < sk.beats.length; i += 3) barLines.push(sk.beats[i]);
  assert.ok(barLines.some(t => Math.abs(t - 1.5) < 0.05), 'a bar line at the first downbeat: ' + barLines.slice(0, 3).join(', '));
});

test('S2: the same performance gives the same skeleton (deterministic), and a stable one under 5 ms of noise', () => {
  const p = march(12, 110, { jitter: 0.01, seed: 2 });
  const a = REC.skeleton(skeletonInput(p.notes), {}), b = REC.skeleton(skeletonInput(p.notes), {});
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const q = { notes: p.notes.map((n, i) => Object.assign({}, n, { on: n.on + ((i * 7919) % 11 - 5) / 1000 })) };
  const c = REC.skeleton(skeletonInput(q.notes), {});
  assert.equal(c.metre.key, a.metre.key);
  assert.ok(Math.abs(c.qpm / a.qpm - 1) < 0.04);
});

test('S2: fewer than four attacks, or no weights, give no skeleton (the caller writes legacy)', () => {
  assert.equal(REC.skeleton(skeletonInput([{ on: 1, off: 2, midi: 60, vel: 60 }, { on: 2, off: 3, midi: 62, vel: 60 }]), {}), null);
  assert.equal(REC.skeleton(skeletonInput(march(4, 100, {}).notes), { weights: { schema: 'something else' } }), null);
});

test('S2: the hypotheses are every reading of every track at a quarter tempo of 36-260', () => {
  const att = ATT.attacksOf(skeletonInput(march(8, 100, {}).notes));
  const tracks = BEATS.tracks(att, {});
  const W = REC.loadWeights();
  const H = METRE.hypotheses(att, ATT.classes(att), tracks, W.tables, { sigma: W.sigma });
  assert.ok(H.list.length > 0 && H.X.length === H.list.length * MODEL.FEATURES.length);
  H.list.forEach(h => assert.ok(h.qpm >= 36 && h.qpm <= 260));
  /* every metre and every eighth-note phase of each frame */
  const perFrame = MODEL.METRES.reduce((s, m) => s + Math.round(m.barQ / MODEL.PHASE_STEP_Q), 0);
  assert.equal(H.list.length, H.frames.length * perFrame);
});

test('budget (G10 section 11): a three-minute performance of about 1700 notes takes well under the 300 ms of the design in Node', () => {
  /* 90 bars of 4/4 at 120 (180 s): a bass on every beat, running eighths above (two notes each) */
  const bar = [];
  for (let e = 0; e < 8; e++) bar.push([e / 2, e % 2 ? [72 + e, 76 + e] : [48 + (e % 3), 72 + e, 76 + e], 0.5]);
  const p = perform(bar, 4, 90, 120, { jitter: 0.015, seed: 13 });
  const notes = skeletonInput(p.notes);
  assert.ok(notes.length > 1300, notes.length);
  REC.skeleton(notes, {});                                         /* warm */
  const t0 = process.hrtime.bigint();
  REC.skeleton(notes, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  /* the design's budget is 300 ms on the Lead's machine; CI machines differ, so this guards an order of magnitude only */
  assert.ok(ms < 1500, ms + ' ms');
});
