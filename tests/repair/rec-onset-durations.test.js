/* "Recording durations from onsets (root cause of the wedged rests)" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12).
   A recording's note ONSETS are heard well, its RELEASES are not (a pedal, a room, a weak key-up). With opts.exactBars audio-score.js now writes a note as lasting until the next onset of its voice
   (legato) unless the silence between its snapped release and that onset is at least REST_MIN (an eighth): a rest is written only for a silence somebody could have meant. The tests:
     legato by default; the REST_MIN boundary and opts.restMin; a silence at a bar end and a tie over a barline; chords; tuplets; ties; the gaps passes finding nothing (idempotence, a fixed
     point, no source added); the gate (library default, MIDI, onsetDurations: false unchanged); onsets, pitches and the number of heard notes unchanged; the real piece; a fuzz. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const A = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const RT = require(path.join(REPO, 'scoregraph/rec-tuplet.js'));
const C = require(path.join(REPO, 'scoregraph/tools/notation-check.js'));
const { recording } = require('./rec-synth.js');
const HEARD = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.heard.json'), 'utf8'));

const BPM = 120, SPB = 60 / BPM;                         /* a beat is 0.5 s: a tick (1/24 beat) is 20.8 ms */
const LOCK = { bpm: BPM, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
const make = (heard, o) => A.toMusicXml({ notes: heard, pedals: [], title: 'od' }, Object.assign({ title: 'od', lock: LOCK, closeGaps: true, exactBars: true }, o));
/* a note at beat `beat` (0-based, from the first downbeat) heard for `len` beats */
const nt = (beat, len, midi, vel) => ({ on: beat * SPB, off: (beat + len) * SPB, midi: midi, vel: vel || 80 });
const errors = g => SG.validate(g).issues.filter(i => i.severity === 'ERROR');
const events = g => g.parts[0].events.filter(e => e.kind === 'note' || e.kind === 'rest');
const mIndex = g => new Map(g.timeline.measures.map((m, i) => [m.id, i]));
/* what is written at each onset: "bar|at|pitches" for each event that is not the continuation of a tie */
function strikes(g) {
  const mi = mIndex(g), stop = new Set();
  g.parts[0].spanners.filter(s => s.type === 'tie').forEach(t => { if (t.to) stop.add(t.to); });
  return g.parts[0].events.filter(e => e.kind === 'note' && !e.grace && !(e.heads || []).some(h => stop.has(h.id)))
    .map(e => (mi.get(e.m) + 1) + '|' + e.at + '|' + e.heads.map(h => h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct).sort().join(','))
    .sort();
}
/* the rests of the right hand (the first staff) in a bar: "at+dur:value" (the left hand of these tests is empty: whole-bar rests) */
const restsOf = (g, bar) => { const mi = mIndex(g), rh = g.parts[0].staves[0].id; return events(g).filter(e => e.kind === 'rest' && e.staff === rh && mi.get(e.m) + 1 === bar).map(e => e.at + '+' + e.dur + ':' + e.display.type + (e.display.dots ? '.' : '')); };
const sounding = (g, bar, at) => { const mi = mIndex(g); return events(g).find(e => e.kind === 'note' && mi.get(e.m) + 1 === bar && e.at === at); };

/* a right-hand melody of 16ths and eighths played detached: every note released well before the next one */
const detached = (() => {
  const out = [];
  for (let b = 0; b < 4; b++) {
    const t = b * 4;
    [0, 0.25, 0.5, 0.75].forEach((f, i) => out.push(nt(t + f, 0.1, 72 + i)));          /* four 16ths, each heard 0.1 beat */
    out.push(nt(t + 1, 0.3, 76), nt(t + 1.5, 0.3, 74));                                /* two eighths, heard 0.3 beat */
    out.push(nt(t + 2, 1.8, 72));                                                      /* a half note... */
    out.push(nt(t + 3.5, 0.2, 71));
  }
  out.push(nt(16, 1, 72));
  return out;
})();

test('legato by default: detached 16ths and eighths are written to the next onset, no rest between two notes; the control (heard releases) has rests', () => {
  const now = make(detached), old = make(detached, { onsetDurations: false, closeGaps: false });
  const cn = C.checkGraph(now.graph), co = C.checkGraph(old.graph);
  assert.equal(cn.classes[1].count, 0, C.summarize(cn));
  assert.equal(cn.total, 0, C.summarize(cn));
  assert.ok(co.classes[1].count >= 8, 'control (heard releases, no gaps pass): rests between the notes: ' + JSON.stringify(C.counts(co)));
  assert.ok(C.checkGraph(make(detached, { onsetDurations: false }).graph).classes[1].count < co.classes[1].count, 'the gaps passes removed some of them, not all');
  /* bar 1: the first 16th lasts to the second */
  const e0 = sounding(now.graph, 1, '0');
  assert.equal(e0.dur, '1/16', 'a 16th that was heard for a tenth of a beat is a 16th: it lasts until the next onset');
  assert.deepEqual(restsOf(now.graph, 1), [], 'no rest in bar 1 at all (the hand never stops)');
  assert.deepEqual(errors(now.graph), []);
});

test('the boundary: a silence of exactly REST_MIN (an eighth) stays a rest, a shorter one is not written; opts.restMin changes it; REST_MIN is one named constant', () => {
  assert.equal(A._.REST_MIN, 1 / 8);
  /* a quarter heard as an eighth, the next note an eighth later (silence 1/8 of a whole note = 12 ticks) and another one a 16th later (silence 6 ticks) */
  const at = (gap) => [nt(0, 1, 72), nt(1, 0.5, 74), nt(1.5 + gap, 2.5 - gap, 76), nt(4, 4, 72)];
  const eighth = make(at(0.5)), sixteenth = make(at(0.25));
  assert.deepEqual(restsOf(eighth.graph, 1), ['3/8+1/8:eighth'], 'bar 1: a silence of an eighth (the heard release 1.5 -> the next onset at 2.0) is an eighth rest');
  assert.deepEqual(restsOf(sixteenth.graph, 1), [], 'a silence of a 16th is measurement noise: no rest');
  assert.equal(sounding(sixteenth.graph, 1, '1/4').dur, '3/16', 'the eighth lasts to the next onset (a 16th longer)');
  assert.equal(C.checkGraph(eighth.graph).total, 0);
  /* adjustable */
  const wider = make(at(0.5), { restMin: 3 / 16 });
  assert.deepEqual(restsOf(wider.graph, 1), [], 'with a dotted eighth as the minimum the eighth silence is closed too');
  assert.equal(sounding(wider.graph, 1, '1/4').dur, '1/4', 'the eighth is a quarter now');
  const off = make(at(0.5), { onsetDurations: false });
  assert.deepEqual(restsOf(off.graph, 1), ['3/8+1/8:eighth']);
});

test('a silence at the end of the hand (no note after) and a real rest are kept; a silence at a bar end is a rest when long enough, a tie over the barline when not', () => {
  /* bar 1: a half note then a quarter, the quarter heard for half a beat: silence 1.5 beats at the end of bar 1 before a note in bar 2 -> a rest (>= an eighth) */
  const long = make([nt(0, 2, 72), nt(2, 1, 74), nt(3, 0.5, 76), nt(4, 4, 72), nt(8, 1, 72), nt(9, 1, 74), nt(10, 1, 76), nt(11, 1, 77)]);
  const rests1 = restsOf(long.graph, 1);
  assert.ok(rests1.some(r => /^7\/8|^3\/4/.test(r)), 'bar 1 keeps its rest before the next bar: ' + rests1.join(' '));
  /* a note on the last 16th of bar 1 heard short, the next note a 16th into bar 2: the silence (a 16th, then a 16th) is under an eighth -> the note is tied over the barline */
  const tie = make([nt(0, 3.75, 72), nt(3.75, 0.1, 74), nt(4.25, 1, 76), nt(5.25, 1, 77), nt(6.25, 1, 78), nt(8, 1, 72)]);
  const mi = mIndex(tie.graph);
  assert.deepEqual(restsOf(tie.graph, 2).filter(r => /^0\+/.test(r)), [], 'no rest at the start of bar 2: ' + restsOf(tie.graph, 2).join(' '));
  assert.ok(tie.graph.parts[0].spanners.some(s => s.type === 'tie'), 'the note is tied over the barline');
  assert.deepEqual(errors(tie.graph), []);
  void mi;
  /* the end of the hand: the last note keeps its heard length (no note after it) */
  const endNote = make([nt(0, 1, 72), nt(1, 1, 74), nt(2, 1, 76), nt(3, 0.5, 77)]);
  assert.equal(sounding(endNote.graph, 1, '3/4').dur, '1/8', 'the last note of the piece is not lengthened');
});

test('chords: every head lasts to the next onset together; no head is lost', () => {
  const heard = [];
  for (let b = 0; b < 4; b++) {
    heard.push(nt(b * 4, 0.75, 60), nt(b * 4, 0.7, 64), nt(b * 4, 0.8, 67));        /* a chord heard for three quarters of a beat */
    heard.push(nt(b * 4 + 1, 0.4, 62), nt(b * 4 + 2, 1.5, 60));
  }
  heard.push(nt(16, 1, 60));
  const r = make(heard);
  assert.equal(C.checkGraph(r.graph).total, 0);
  const chord = sounding(r.graph, 1, '0');
  assert.equal(chord.heads.length, 3);
  assert.equal(chord.dur, '1/4', 'the chord lasts to the next onset (a beat), as one event');
  assert.equal(r.graph.performances[0].notes.filter(n => n.link === undefined).length, 0, 'every heard note is written');
});

test('tuplets: a triplet beat played detached stays one complete 3:2 beat, each third lasting to the next; no rest between thirds, the bars add up', () => {
  const heard = [];
  for (let b = 0; b < 4; b++) {
    [0, 1 / 3, 2 / 3].forEach((f, i) => heard.push(nt(b * 4 + f, 0.12, 72 + i * 2)));
    heard.push(nt(b * 4 + 1, 1, 76), nt(b * 4 + 2, 1, 74));
    [0, 1 / 3, 2 / 3].forEach((f, i) => heard.push(nt(b * 4 + 3 + f, 0.1, 71 - i)));
  }
  heard.push(nt(16, 1, 72));
  const r = make(heard);
  const c = C.checkGraph(r.graph);
  assert.equal(c.total, 0, C.summarize(c));
  assert.ok(r.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length >= 8, 'a bracket per triplet beat');
  assert.deepEqual(restsOf(r.graph, 1), [], 'no rest in a triplet beat of detached notes');
  assert.equal(GAPS.tidyRests(r.graph).graph, r.graph);
  assert.equal(RT.addTriplets(r.graph).graph, r.graph);
});

test('the gaps passes find nothing to do in what is written from onsets: idempotent, a fixed point, no repair source added, in both hands', () => {
  [3, 8, 21].forEach(seed => {
    const rec = recording(seed, { runs: seed % 2 === 1, bpm: 70 + seed });
    const r = A.toMusicXml({ notes: rec.notes, pedals: [], title: 'od' }, { title: 'od', lock: { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 }, closeGaps: true, exactBars: true });
    const g = r.graph;
    assert.equal(GAPS.tidyRests(g).graph, g, 'tidyRests ' + seed);
    assert.equal(GAPS.closeSmallGaps(g).graph, g);
    assert.equal(GAPS.mergeRests(g).graph, g);
    assert.equal(GAPS.fillRunRests(g).graph, g, 'the run-rest fill has no lone 16th rest to fill');
    assert.equal(RT.addTriplets(g).graph, g);
    assert.deepEqual(g.provenance.sources.map(s => s.tool).filter(t => /run-rests|g9f-gaps|consecutive/.test(t)), [], 'no pass left its mark');
    assert.deepEqual(r.gapReport && [r.gapReport.gaps, r.gapReport.omitted, r.gapReport.notesLengthened], [0, 0, 0]);
    assert.equal(r.restReport.runs, 0);
  });
});

test('the old graph (heard releases) is still repaired by the gaps passes: saved-song compatibility (the passes still run on data written before)', () => {
  const rec = recording(4, {});
  const lock = { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
  const old = A.toMusicXml({ notes: rec.notes, pedals: [], title: 'od' }, { title: 'od', lock: lock, closeGaps: false, exactBars: true, onsetDurations: false });
  assert.ok(C.checkGraph(old.graph).classes[1].count > 5, 'a recording written before this change has small rests between notes');
  const fixed = GAPS.tidyRests(old.graph);
  assert.ok(fixed.changed);
  assert.ok(C.checkGraph(fixed.graph).classes[1].count < C.checkGraph(old.graph).classes[1].count, 'the passes still tidy it');
  assert.equal(GAPS.tidyRests(fixed.graph).graph, fixed.graph);
});

test('the gate: the library default, exact bars off, a MIDI source and a compound metre write what they always did; onsetDurations: false is the heard-release writer', () => {
  const rec = recording(6, {});
  const lock = { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
  const run = o => A.toMusicXml({ notes: rec.notes, pedals: [], title: 'od' }, Object.assign({ title: 'od', lock: lock }, o)).xml;
  assert.equal(run({}), run({ restMin: 0.5, onsetDurations: true }), 'library default (no exactBars): restMin is not read');
  assert.equal(run({ closeGaps: true }), run({ closeGaps: true, onsetDurations: false }), 'exact bars off: no change');
  assert.notEqual(run({ closeGaps: true, exactBars: true }), run({ closeGaps: true, exactBars: true, onsetDurations: false }));
  assert.equal(run({ closeGaps: true, exactBars: true, sourceKind: 'midi-file' }), run({ closeGaps: true, exactBars: true, sourceKind: 'midi-file', onsetDurations: false }), 'a MIDI source is the player\'s own');
});

test('onsets, pitches and the heard notes are unchanged by the new durations: the same strikes, no note shortened, nothing lost, a valid graph', () => {
  [[1, {}], [2, { runs: true, bpm: 66 }], [9, { bpm: 150 }]].forEach(([seed, o]) => {
    const rec = recording(seed, o);
    const lock = { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
    const mk = x => A.toMusicXml({ notes: rec.notes, pedals: [], title: 'od' }, Object.assign({ title: 'od', lock: lock, closeGaps: true, exactBars: true }, x));
    const now = mk({}), old = mk({ onsetDurations: false });
    assert.deepEqual(strikes(now.graph), strikes(old.graph), 'the same notes at the same onsets: ' + seed);
    assert.deepEqual(errors(now.graph), []);
    assert.equal(now.graph.performances[0].notes.filter(n => n.link === undefined).length, 0);
    assert.equal(now.graph.performances[0].notes.length, old.graph.performances[0].notes.length);
    /* no note is shorter than before: compare each strike's total length (tied pieces summed) */
    const total = g => {
      const mi = mIndex(g), len = new Map(), nextOf = new Map();
      g.parts[0].spanners.filter(s => s.type === 'tie').forEach(t => { if (t.from && t.to) nextOf.set(t.from, t.to); });
      const evOf = new Map(); g.parts[0].events.forEach(e => (e.heads || []).forEach(h => evOf.set(h.id, e)));
      const stop = new Set(nextOf.values());
      g.parts[0].events.filter(e => e.kind === 'note' && !e.grace && !e.heads.some(h => stop.has(h.id))).forEach(e => {
        let sum = R.parse(e.dur), h = e.heads[0].id, k = 0;
        while (nextOf.has(h) && k++ < 40) { h = nextOf.get(h); sum = R.add(sum, R.parse(evOf.get(h).dur)); }
        len.set((mi.get(e.m) + 1) + '|' + e.at + '|' + e.heads.map(x => x.pitch.step + (x.pitch.alter || 0) + x.pitch.oct).sort().join(','), sum);
      });
      return len;
    };
    const a = total(old.graph), b = total(now.graph);
    let longer = 0;
    a.forEach((v, k) => { const w = b.get(k); assert.ok(w !== undefined, 'strike ' + k); assert.ok(R.cmp(w, v) >= 0, 'never shorter: ' + k + ' ' + R.format(v) + ' -> ' + R.format(w)); if (R.cmp(w, v) > 0) longer++; });
    assert.ok(longer > 0, 'some notes are lengthened (the control has silences)');
  });
});

test('the teacher\'s piece (1214 heard notes): classes 1-7 of the checker are 0 (53 before), fewer rests, every bar adds up, the passes have nothing to do, the sound change is small and one-sided', () => {
  const mk = o => A.toMusicXml({ notes: HEARD.notes, pedals: [], title: 'Looping the Rooms' }, Object.assign({ title: 'Looping the Rooms', closeGaps: true, exactBars: true }, o));
  [undefined, { beatsPerBar: 4, beatType: 4, bpm: 162, firstDownbeat: -0.371 }].forEach(lock => {
    const old = mk({ lock: lock, onsetDurations: false }), now = mk({ lock: lock });
    const co = C.checkGraph(old.graph), cn = C.checkGraph(now.graph);
    assert.ok(co.classes[1].count >= 40, 'before: rests between notes ' + co.classes[1].count);
    assert.equal(cn.total, 0, C.summarize(cn));
    assert.ok(cn.rests < co.rests, 'fewer rests: ' + co.rests + ' -> ' + cn.rests);
    assert.deepEqual(errors(now.graph), []);
    assert.equal(SG.validate(now.graph).issues.filter(i => i.code === 'W-DISPLAY-DURATION' || i.code === 'W-TUPLET-INCOMPLETE').length, 0);
    assert.deepEqual(strikes(now.graph), strikes(old.graph), 'the same notes at the same onsets');
    assert.equal(GAPS.tidyRests(now.graph).graph, now.graph, 'nothing left for the gaps passes');
    assert.ok(!now.graph.provenance.sources.some(s => /run-rests|g9f-gaps|consecutive/.test(s.tool)));
    assert.equal(now.graph.performances[0].notes.filter(n => n.link === undefined).length, 0);
  });
});

test('fuzz: over 60 random recordings classes 1-7 of the checker are 0 with onset durations, and not 0 with the heard releases', () => {
  let violations = 0, control = 0, bars = 0;
  const bad = [];
  for (let seed = 1; seed <= 60; seed++) {
    const rec = recording(seed, { runs: seed % 3 === 0, bpm: seed % 3 === 0 ? 60 + (seed % 7) * 3 : undefined, bars: 8 + (seed % 4) * 2 });
    const lock = { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
    const mk = o => A.toMusicXml({ notes: rec.notes, pedals: [], title: 'fz' }, Object.assign({ title: 'fz', lock: lock, closeGaps: true, exactBars: true }, o));
    const c = C.checkGraph(mk({}).graph), o = C.checkGraph(mk({ onsetDurations: false }).graph);
    violations += c.total; control += o.total; bars += c.voiceBars;
    if (c.total) bad.push(seed + ': ' + JSON.stringify(C.counts(c)));
  }
  assert.deepEqual(bad, [], bad.slice(0, 5).join('\n'));
  assert.ok(control > 100, 'the control has violations: ' + control);
  assert.equal(violations, 0);
  assert.ok(bars > 1000);
});
