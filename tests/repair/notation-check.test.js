/* The notation checker (scoregraph/tools/notation-check.js; docs/GOALS/G09 section 12, "Recording durations from onsets"): its own tests. Each class is planted in a small graph written
   by hand (so the checker is proved to SEE it, not only to say "0" on clean data), the same graph is read through the graph adapter and through the Score adapter (the page's own
   Score from the MusicXML the graph writes), a clean recording is 0 in classes 1-7, the script runs, REST_MIN is adjustable. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const C = require(path.join(REPO, 'scoregraph/tools/notation-check.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const A = require(path.join(REPO, 'audio-score.js'));
const { recording } = require('./rec-synth.js');

/* a one-part graph, 4/4: events [{m (1-based), at, dur (whole-note fractions as strings), kind, type, dots, staff (1|2), pitch (a midi number), tup (a tuplet id)}] */
function graph(bars, evs, tuplets) {
  const b = SG.builder({ id: 'nc' });
  const src = b.source({ kind: 'audio-score', tool: 'test' });
  b.setDefault({ src: src.id, op: 'inferred' });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const st = [null, b.staff(part, { limb: 'RH' }).id, b.staff(part, { limb: 'LH' }).id];
  const voice = [null, b.voice(part, { staff: st[1], label: '1' }).id, b.voice(part, { staff: st[2], label: '5' }).id];
  const mid = [];
  for (let i = 0; i < bars; i++) mid.push(b.measure({ number: String(i + 1), dur: '1' }).id);
  b.meter({ m: mid[0], beats: [4], beatType: 4 });
  b.key({ m: mid[0], at: '0', fifths: 0, mode: 'major' });
  b.tempo({ m: mid[0], at: '0', qpm: '120', mark: { unit: 'quarter', perMinute: '120' } });
  b.clef(part, { staff: st[1], m: mid[0], at: '0', sign: 'G' });
  b.clef(part, { staff: st[2], m: mid[0], at: '0', sign: 'F' });
  const names = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'], alt = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const ids = {};
  evs.forEach((e, i) => {
    const staff = e.staff || 1;
    const display = { type: e.type }; if (e.dots) display.dots = e.dots;
    const x = { kind: e.kind || 'note', m: mid[e.m - 1], at: e.at, dur: e.dur, voice: voice[staff], staff: st[staff], display: display };
    if (x.kind === 'note') { const p = e.pitch || 60; x.heads = [{ pitch: alt[p % 12] ? { step: names[p % 12], alter: 1, oct: Math.floor(p / 12) - 1 } : { step: names[p % 12], oct: Math.floor(p / 12) - 1 } }]; }
    ids[i] = b.event(part, x).id;
  });
  (tuplets || []).forEach(t => b.spanner(part, { type: 'tuplet', events: t.map(i => ids[i]), actual: 3, normal: 2 }));
  return b.finish().graph;
}
const N = (m, at, dur, type, o) => Object.assign({ m: m, at: at, dur: dur, type: type, kind: 'note' }, o || {});
const Rt = (m, at, dur, type, o) => Object.assign({ m: m, at: at, dur: dur, type: type, kind: 'rest' }, o || {});

test('class 1: a 16th rest between two notes of a hand is found, an eighth rest is not; the bar and hand are named', () => {
  const g = graph(2, [
    N(1, '0', '1/4', 'quarter'), N(1, '1/4', '1/16', '16th'), Rt(1, '5/16', '1/16', '16th'), N(1, '3/8', '1/8', 'eighth'), N(1, '1/2', '1/8', 'eighth'), Rt(1, '5/8', '1/8', 'eighth'), N(1, '3/4', '1/4', 'quarter'),
    N(2, '0', '1/2', 'half'), Rt(2, '1/2', '1/2', 'half')]);
  const r = C.checkGraph(g);
  assert.equal(r.classes[1].count, 1);
  assert.deepEqual(r.classes[1].bars, [{ bar: 1, hand: 'RH' }]);
  assert.equal(r.classes[9].count, 1, 'the eighth rest between two eighth/quarter... is information only when both neighbours are eighth or shorter');
});

test('class 1 counts a silence, not a piece: two small rests in a row, and a rest across a barline, are one silence', () => {
  const g = graph(2, [
    N(1, '0', '3/4', 'half', { dots: 1 }), N(1, '3/4', '3/16', 'eighth', { dots: 1 }), Rt(1, '15/16', '1/16', '16th'),
    Rt(2, '0', '1/16', '16th'), N(2, '1/16', '1/16', '16th'), Rt(2, '1/8', '7/8', 'half', { dots: 1 })]);
  const r = C.checkGraph(g);
  assert.equal(r.classes[1].count, 0, 'a 16th rest at the end of a bar and a 16th rest at the start of the next are ONE silence of an eighth: not shorter than REST_MIN');
  assert.equal(C.checkGraph(g, { restMin: 3 / 16 }).classes[1].count, 1, 'but shorter than a dotted eighth');
  const g2 = graph(2, [N(1, '0', '15/16', 'half', { dots: 1 }), Rt(1, '15/16', '1/16', '16th'), N(2, '0', '1/2', 'half'), Rt(2, '1/2', '1/2', 'half')]);
  assert.equal(C.checkGraph(g2).classes[1].count, 1, 'a 16th rest at the end of a bar before a note in the next bar');
});

test('class 1 does not count a silence at the start of a voice or after its last note, and REST_MIN is adjustable', () => {
  const g = graph(1, [Rt(1, '0', '1/16', '16th'), N(1, '1/16', '1/16', '16th'), N(1, '1/8', '1/8', 'eighth'), Rt(1, '1/4', '1/16', '16th'), Rt(1, '5/16', '11/16', 'half', { dots: 1 })]);
  assert.equal(C.checkGraph(g).classes[1].count, 0);
  const h = graph(1, [N(1, '0', '1/4', 'quarter'), Rt(1, '1/4', '1/8', 'eighth'), N(1, '3/8', '5/8', 'half')]);
  assert.equal(C.checkGraph(h).classes[1].count, 0, 'an eighth rest is exactly REST_MIN: not shorter');
  assert.equal(C.checkGraph(h, { restMin: 3 / 16 }).classes[1].count, 1, 'with a dotted eighth as the minimum it is');
  assert.equal(C.REST_MIN, 1 / 8);
});

test('classes 2 and 4: a rest shorter than a 16th, a dotted 16th rest', () => {
  const g = graph(1, [N(1, '0', '1/2', 'half'), Rt(1, '1/2', '1/32', '32nd'), Rt(1, '17/32', '3/32', '16th', { dots: 1 }), N(1, '5/8', '3/8', 'quarter', { dots: 1 })]);
  const r = C.checkGraph(g);
  assert.equal(r.classes[2].count, 1);
  assert.equal(r.classes[4].count, 1);
  assert.equal(r.classes[1].count, 0, 'the two rests are one silence of 1/32 + 3/32 = an eighth: not shorter than REST_MIN');
});

test('class 3: two rests where one is written are found; the standard tiling (a half and an eighth rest for 2.5 beats) is not', () => {
  const bad = graph(1, [N(1, '0', '1/4', 'quarter'), Rt(1, '1/4', '1/8', 'eighth'), Rt(1, '3/8', '1/8', 'eighth'), N(1, '1/2', '1/2', 'half')]);
  assert.equal(C.checkGraph(bad).classes[3].count, 1);
  const ok = graph(1, [Rt(1, '0', '1/2', 'half'), Rt(1, '1/2', '1/8', 'eighth'), N(1, '5/8', '3/8', 'quarter', { dots: 1 })]);
  assert.equal(C.checkGraph(ok).classes[3].count, 0);
});

test('classes 5 and 6: a bar that does not add up, a hole, an overlap, and a drawn value that is not the length', () => {
  const short = graph(1, [N(1, '0', '1/4', 'quarter'), N(1, '1/4', '1/4', 'quarter'), N(1, '1/2', '1/4', 'quarter')]);
  const rs = C.checkGraph(short);
  assert.equal(rs.classes[5].count, 1);
  assert.match(rs.classes[5].items[0].why, /ends at|are 0\.75/);
  const hole = graph(1, [N(1, '0', '1/4', 'quarter'), N(1, '1/2', '1/2', 'half')]);
  assert.match(C.checkGraph(hole).classes[5].items[0].why, /hole/);
  const wrongValue = graph(1, [N(1, '0', '1/4', 'quarter'), N(1, '1/4', '3/4', 'quarter')]);
  const rw = C.checkGraph(wrongValue);
  assert.equal(rw.classes[6].count, 1);
  assert.ok(rw.classes[5].count >= 1, 'the drawn values do not fill the bar either');
  const clean = graph(1, [N(1, '0', '1/4', 'quarter'), N(1, '1/4', '3/4', 'half', { dots: 1 })]);
  assert.equal(C.checkGraph(clean).total, 0);
});

test('class 7: a tuplet that is not a whole beat, a bracket on a beat that is not a triplet; a complete triplet beat is clean', () => {
  const trip = (m, at0) => [N(m, at0, '1/12', 'eighth'), N(m, String(at0 === '0' ? '1/12' : '1/3'), '1/12', 'eighth'), N(m, at0 === '0' ? '1/6' : '5/12', '1/12', 'eighth')];
  const complete = graph(1, [N(1, '0', '1/12', 'eighth'), N(1, '1/12', '1/12', 'eighth'), N(1, '1/6', '1/12', 'eighth'), N(1, '1/4', '3/4', 'half', { dots: 1 })], [[0, 1, 2]]);
  assert.equal(C.checkGraph(complete).total, 0, JSON.stringify(C.checkGraph(complete).classes[5].items));
  const one = graph(1, [N(1, '0', '1/12', 'eighth'), N(1, '1/12', '11/12', 'half', { dots: 1 })], [[0]]);
  const r1 = C.checkGraph(one);
  assert.equal(r1.classes[7].count, 1, 'a one-note tuplet (the old writer) is incomplete');
  const offBeat = graph(1, [N(1, '0', '1/8', 'eighth'), N(1, '1/8', '1/12', 'eighth'), N(1, '5/24', '1/12', 'eighth'), N(1, '7/24', '1/12', 'eighth'), N(1, '3/8', '5/8', 'half', { dots: 1 })], [[1, 2, 3]]);
  assert.ok(C.checkGraph(offBeat).classes[7].count >= 1, 'a bracket that does not start on a beat');
  const none = graph(1, [N(1, '0', '1/12', 'eighth'), N(1, '1/12', '1/12', 'eighth'), N(1, '1/6', '1/12', 'eighth'), N(1, '1/4', '3/4', 'half', { dots: 1 })]);
  assert.ok(C.checkGraph(none).classes[6].count >= 3 || C.checkGraph(none).classes[5].count >= 1, 'plain values that last a third are found as a value/length difference');
  void trip;
});

test('class 8: the same pitch struck by both hands at the same time', () => {
  const g = graph(1, [N(1, '0', '1/2', 'half', { staff: 1, pitch: 55 }), N(1, '1/2', '1/2', 'half', { staff: 1, pitch: 60 }), N(1, '0', '1/2', 'half', { staff: 2, pitch: 55 }), N(1, '1/2', '1/2', 'half', { staff: 2, pitch: 48 })]);
  const r = C.checkGraph(g);
  assert.equal(r.classes[8].count, 1);
  assert.equal(r.classes[8].items[0].midi, 55);
  assert.equal(r.total, 0, 'class 8 is a fact about the notes, not one of the acceptance classes 1-7');
});

test('class 9 (a rest between short notes of a run) and class 10 (a note tied in three pieces) are reported as information', () => {
  const g = graph(1, [N(1, '0', '1/8', 'eighth'), Rt(1, '1/8', '1/8', 'eighth'), N(1, '1/4', '1/8', 'eighth'), N(1, '3/8', '1/8', 'eighth'), N(1, '1/2', '1/2', 'half')]);
  const r = C.checkGraph(g);
  assert.equal(r.classes[9].count, 1);
  assert.equal(r.total, 0);
  const n = (b, o) => Object.assign({ m: 1, b: b, dur: 1, type: 'quarter', dots: 0, staff: 1, voice: 1, rest: false, midi: 60, tieStart: false, tieStop: false }, o || {});
  const tied = C.checkScore({ measures: [{ number: 1, lenQ: 4 }], notes: [n(0, { tieStart: true }), n(1, { tieStop: true, tieStart: true }), n(2, { tieStop: true, tieStart: true }), n(3, { tieStop: true })] });
  assert.equal(tied.classes[10].count, 1, 'four tied quarters: one chain of three or more');
  assert.equal(tied.total, 0);
});

test('the Score adapter reads the app Score (b, dur, type, dots, tm, tupletStart): a 16th rest between notes, a one-note tuplet, a 3:2 beat', () => {
  const n = (m, b, dur, type, o) => Object.assign({ m: m, b: b, dur: dur, type: type, dots: 0, staff: 1, voice: 1, rest: false, midi: 60, tieStart: false, tieStop: false }, o || {});
  const T = { a: 3, n: 2 }, third = 1 / 3;
  const score = {
    measures: [{ number: 1, lenQ: 4 }, { number: 2, lenQ: 4 }, { number: 3, lenQ: 4 }],
    notes: [
      n(1, 0, 1, 'quarter'), n(1, 1, 0.25, '16th'), n(1, 1.25, 0.25, '16th', { rest: true, midi: undefined }), n(1, 1.5, 0.5, 'eighth'), n(1, 2, 2, 'half'),
      n(2, 0, third, 'eighth', { tm: T, tupletStart: true }), n(2, third, third, 'eighth', { tm: T }), n(2, 2 * third, third, 'eighth', { tm: T, tupletStop: true }), n(2, 1, 3, 'half', { dots: 1 }),
      n(3, 0, third, 'eighth', { tm: T, tupletStart: true, tupletStop: true }), n(3, third, 4 - third, 'half', { dots: 1 })
    ]
  };
  const r = C.checkScore(score);
  assert.equal(r.classes[1].count, 1, 'the 16th rest between notes');
  assert.deepEqual(r.classes[1].bars, [{ bar: 1, hand: 'RH' }]);
  assert.equal(r.classes[7].count, 1, 'bar 3: a bracket over one third; bar 2 is a complete 3:2 beat');
  assert.deepEqual(r.classes[7].items.map(x => x.bar), [3]);
  assert.equal(r.classes[5].count, 1, 'bar 3 does not add up as drawn (the half is dotted: 3 quarters, and a third)');
});

test('a recording written from onsets has no violation in classes 1-7; the same notes with the heard releases do; the script reads a saved graph', () => {
  const rec = recording(5, {});
  const mk = o => A.toMusicXml({ notes: rec.notes, pedals: [], title: 'nc' }, Object.assign({ title: 'nc', lock: { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 }, closeGaps: true, exactBars: true }, o));
  const fresh = C.checkGraph(mk({}).graph), old = C.checkGraph(mk({ onsetDurations: false }).graph);
  assert.equal(fresh.total, 0, C.summarize(fresh));
  assert.ok(old.classes[1].count > 5, 'control: ' + old.classes[1].count);
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  const f = path.join(os.tmpdir(), 'nc-' + process.pid + '.json');
  fs.writeFileSync(f, JSON.stringify(mk({}).graph));
  const ok = cp.spawnSync(process.execPath, [path.join(REPO, 'scoregraph/tools/notation-check.js'), f], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /classes 1-7 total: 0/);
  fs.writeFileSync(f, JSON.stringify(mk({ onsetDurations: false }).graph));
  const bad = cp.spawnSync(process.execPath, [path.join(REPO, 'scoregraph/tools/notation-check.js'), f, '--items'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /class 1 \{/);
  fs.unlinkSync(f);
});

test('never throws on a graph or Score it does not understand', () => {
  const g = JSON.parse(JSON.stringify(graph(1, [N(1, '0', '1', 'whole')])));
  g.parts[0].events[0].display = { type: 'strange' };
  assert.doesNotThrow(() => C.checkGraph(g));
  assert.ok(C.checkGraph(g).classes[5].count >= 1);
  assert.doesNotThrow(() => C.checkScore({ measures: [{ number: 1, lenQ: 4 }], notes: [{ m: 1, b: 0, dur: 4, type: 'whole', staff: 1, voice: 1, rest: true }] }));
});
