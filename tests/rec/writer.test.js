/* rec/writer.js (G10a-3, stage S7) and the v2 path through it: exact bars in every metre, tuplet brackets, two voices, the
   S6 hook. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, perform, jig } = require('./helpers.js');
const W = require(path.join(REPO, 'rec', 'writer.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));

/* a placed note as audio-score.js hands it to the writer (ticks: 24 a quarter) */
const N = (tick, len, midi, staff, voice) => ({ tick: tick, endTick: tick + len, midi: midi, staff: staff || 1, voice: voice || 1, on: tick / 48, off: (tick + len) / 48, vel: 64 });
const piecesOf = (r, staff, voice) => r.tracks.find(t => t.staff === staff && t.voice === (voice || 1)).pieces;
const shape = ps => ps.map(p => (p.kind === 'rest' ? 'r' : 'n') + p.len + (p.tup >= 0 ? 't' : '') + (p.tieOut ? '~' : ''));
/* every voice-bar adds up: the pieces of a voice in a bar tile it from 0 to the bar's end */
function addsUp(r, bar, bars) {
  r.tracks.forEach(t => {
    const per = new Map();
    t.pieces.forEach(p => { const b = Math.floor(p.at / bar); if (!per.has(b)) per.set(b, []); per.get(b).push(p); });
    per.forEach((ps, b) => {
      let at = b * bar;
      ps.forEach(p => { assert.equal(p.at, at, 'a hole or overlap in bar ' + (b + 1)); at += p.len; });
      assert.equal(at, (b + 1) * bar, 'bar ' + (b + 1) + ' of staff ' + t.staff + ' voice ' + t.voice + ' does not add up');
    });
  });
}

test('x/4: v2 through rec/writer.js writes the same MusicXML as the exact-bars writer it replaces (the REST_MIN rule)', () => {
  const p = perform([[0, [48, 60], 0.5], [0.5, [62], 0.5], [1, [64, 55], 1], [2, [65], 0.25], [2.25, [67], 0.25], [2.5, [69], 0.5], [3, [71, 43], 1]], 4, 8, 120, { jitter: 0.012, seed: 4 });
  const base = { title: 't', closeGaps: true, exactBars: true, recording: 'v2', rests: 'rule' };
  const a = AS.toMusicXml({ notes: p.notes }, base);
  const b = AS.toMusicXml({ notes: p.notes }, Object.assign({ writer: 'legacy' }, base));
  assert.ok(a.writerReport && !b.writerReport);
  assert.equal(a.xml, b.xml);
});

test('compound bars add up: a note across the beat line is split there; a silence is tiled on the dotted-quarter beat', () => {
  /* 6/8 (bar 72): the pieces of a note of four eighths from beat 1, of five eighths from the second eighth */
  const ctx = { bar: 72, bars: 1, beatType: 8, beatsPerBar: 6, compound: true };
  const G = W._.gridOf([], ctx);
  assert.deepEqual(W._.spanPieces(0, 48, 'note', G, ctx).map(p => p.len), [36, 12]);
  assert.deepEqual(W._.spanPieces(12, 72, 'note', G, ctx).map(p => p.len), [24, 36]);
  /* a silence from the second eighth to the bar's end: eighth, eighth, dotted quarter (never a quarter across the beat) */
  const s = W.write([N(0, 12, 60)], Object.assign({ restMin: 0 }, ctx));
  assert.deepEqual(shape(piecesOf(s, 1)), ['n12', 'r12', 'r12', 'r36']);
  /* a note held to the next onset across the beat line: the release is put on the nearest single value (a tie costs 13 ticks:
     the dotted quarter), which leaves an eighth of silence; the fixed rule writes it as a rest, S6 (here: legato) ties it */
  const r0 = W.write([N(0, 48, 60), N(48, 24, 62)], ctx);
  assert.deepEqual(shape(piecesOf(r0, 1)), ['n36', 'r12', 'n24']);
  const r = W.write([N(0, 48, 60), N(48, 24, 62)], Object.assign({ decideRests: cands => cands.map(() => false) }, ctx));
  assert.deepEqual(shape(piecesOf(r, 1)), ['n36~', 'n12', 'n24']);
  addsUp(r, 72, 1); addsUp(s, 72, 1);
});

test('x/2 bars: rests are tiled on the half-note beat', () => {
  const r = W.write([N(0, 24, 60)], { bar: 96, bars: 1, beatType: 2, beatsPerBar: 2, restMin: 0 });
  /* a quarter, then a quarter rest to the half beat and a half rest (in 4/4 the same; in 2/2 the half rest is beat 2) */
  assert.deepEqual(shape(piecesOf(r, 1)), ['n24', 'r24', 'r48']);
  addsUp(r, 96, 1);
});

test('a triplet beat gets one 3:2 bracket per voice, its rests included; a straight beat none', () => {
  const r = W.write([N(0, 8, 60), N(16, 8, 64), N(24, 24, 65)], { bar: 96, bars: 1, beatType: 4, beatsPerBar: 4, restMin: 0 });
  const ps = piecesOf(r, 1);
  assert.deepEqual(shape(ps).slice(0, 4), ['n8t', 'r8t', 'n8t', 'n24']);
  assert.equal(r.tuplets.length, 1);
  assert.deepEqual(r.tuplets[0].pieces, [0, 1, 2]);
  assert.equal(r.tuplets[0].unit.type, 'eighth');
  addsUp(r, 96, 1);
});

test('triplet 16ths: one 3:2 bracket of 16ths per half beat; a release on the third sixth rings to the half beat end', () => {
  /* six to a quarter in beat 1; a note on the second sixth released after one sixth, then silence */
  const sext = [0, 4, 8, 12, 16, 20].map(t => N(t, 4, 60 + t / 4));
  const r = W.write(sext.concat([N(24, 72, 48, 2)]), { bar: 96, bars: 1, beatType: 4, beatsPerBar: 4 });
  const ps = piecesOf(r, 1);
  assert.deepEqual(shape(ps).slice(0, 6), ['n4t', 'n4t', 'n4t', 'n4t', 'n4t', 'n4t']);
  assert.equal(r.tuplets.filter(t => t.unit.type === '16th').length, 2);
  r.tuplets.forEach(t => assert.equal(t.pieces.reduce((s, i) => s + ps[i].len, 0), 12));
  const q = W.write([N(0, 4, 60), N(4, 4, 62), N(24, 24, 64)], { bar: 96, bars: 1, beatType: 4, beatsPerBar: 4, restMin: 0 });
  /* the note on the second sixth is released at the third: no rest of a sixth is written, it rings to the half beat (12) */
  assert.deepEqual(shape(piecesOf(q, 1)).slice(0, 3), ['n4t', 'n8t', 'r12']);
  addsUp(r, 96, 1); addsUp(q, 96, 1);
});

test('two voices in a staff: each voice-bar adds up; the second voice is written only in the bars where it has a note', () => {
  /* bar 1: tenor quarters over a bass half note; bar 2: one voice */
  const notes = [N(0, 24, 55, 2, 1), N(24, 24, 57, 2, 1), N(0, 48, 43, 2, 2), N(48, 48, 48, 2, 1), N(96, 96, 50, 2, 1)];
  const r = W.write(notes, { bar: 96, bars: 2, beatType: 4, beatsPerBar: 4 });
  const v2 = piecesOf(r, 2, 2);
  assert.ok(v2.every(p => p.at < 96), 'the second voice wrote a bar it has no note in');
  assert.deepEqual(shape(v2), ['n48', 'r48']);
  assert.deepEqual(shape(piecesOf(r, 2, 1)), ['n24', 'n24', 'n48', 'n96']);
  addsUp(r, 96, 2);
});

test('S6 hook: every silence of restMin or more is asked once, in one batch; a legato answer lasts to the next onset', () => {
  const notes = [N(0, 6, 60), N(24, 6, 62), N(48, 24, 64)];
  let asked = null;
  const r = W.write(notes, { bar: 96, bars: 1, beatType: 4, beatsPerBar: 4, decideRests: cands => { asked = cands.map(c => [c.start, c.end, c.next]); return cands.map(c => c.start === 24); } });
  assert.deepEqual(asked, [[0, 6, 24], [24, 30, 48]]);
  assert.deepEqual(shape(piecesOf(r, 1)), ['n24', 'n6', 'r18', 'n24', 'r24']);
  assert.deepEqual(r.report.rests, { asked: 2, rest: 1, legato: 1 });
});

test('v2 on a jig (6/8): no acceptance class is hit and the bars add up', () => {
  const p = jig(16, 100, { jitter: 0.01, seed: 3 });
  const r = AS.toMusicXml({ notes: p.notes }, { title: 't', closeGaps: true, exactBars: true, recording: 'v2' });
  const rep = NC.checkGraph(r.graph);
  assert.equal(rep.total, 0, NC.summarize(rep));
  assert.equal(r.graphIssues.filter(i => i.severity === 'error').length, 0);
});

test('without opts.recording (or with the legacy writer) rec/writer.js is not even loaded', () => {
  const p = perform([[0, [48, 60], 1], [1, [64], 1], [2, [65, 52], 1], [3, [67], 1]], 4, 6, 100, { seed: 2 });
  const key = require.resolve(path.join(REPO, 'rec', 'writer.js'));
  const keys = [require.resolve(path.join(REPO, 'rec', 'rests.js'))];
  const had = [key].concat(keys).filter(k => k in require.cache);
  [key].concat(keys).forEach(k => { delete require.cache[k]; });
  AS.toMusicXml({ notes: p.notes }, { title: 't', closeGaps: true, exactBars: true });
  AS.toMusicXml({ notes: p.notes }, { title: 't' });
  [key].concat(keys).forEach(k => assert.equal(k in require.cache, false, 'legacy loaded ' + k));
  had.forEach(k => require(k));
});
