'use strict';
/* MIDI into the graph and back (docs/GOALS/G02 §7, §9.2, A19-A29).

   The fixtures under fixtures/midi are written by tools/make-midi-fixtures.js, with its own byte writer
   rather than scoregraph/midi-file.js: a fixture built by the code under test could not catch that code
   misreading its own output. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG } = require('./helpers.js');

const MIDI = path.join(__dirname, 'fixtures', 'midi');
const bytes = name => fs.readFileSync(path.join(MIDI, name + '.mid'));
const read = name => {
  const r = SG.midi.read(bytes(name));
  assert.equal(r.ok, true, name + ': ' + r.message);
  return r;
};
const imp = (name, opts) => {
  const r = SG.midi.import(bytes(name), Object.assign({ scoreId: 'midi' }, opts));
  assert.equal(r.ok, true, name + ': ' + r.message);
  return r;
};
const codesOf = r => r.report.issues.map(i => i.code);
const allFixtures = () => fs.readdirSync(MIDI).filter(f => f.endsWith('.mid')).map(f => f.slice(0, -4)).sort();

test('every fixture is read, and the corpus is the one the design asks for (A19)', () => {
  const names = allFixtures();
  assert.ok(names.length >= 25, names.length + ' fixtures');
  names.forEach(n => {
    const r = SG.midi.read(bytes(n));
    assert.equal(r.ok, true, n + ': ' + r.message);
    assert.ok(r.raw.tracks.length >= 1, n);
  });
});

test('a note is what the file says: pitch, ticks, velocity, track and channel (A19)', () => {
  const r = read('m01-single-note');
  assert.deepEqual(r.raw.division, { kind: 'ppq', ppq: 480 });
  assert.equal(r.raw.format, 0);
  assert.deepEqual(r.raw.notes, [{ track: 0, channel: 1, midi: 60, onTick: 0, offTick: 480,
    onVel: 80, offVel: 0, offKind: 'note-off' }]);
  assert.equal(r.raw.usAt(480), 500000);
  const chord = read('m02-chord-3');
  assert.deepEqual(chord.raw.notes.map(n => n.midi), [60, 64, 67]);
  assert.deepEqual(chord.raw.notes.map(n => n.onVel), [80, 70, 90]);
});

test('a note on at velocity 0 is a release, and says so (A20)', () => {
  const r = read('m04-note-on-velocity-0');
  assert.equal(r.raw.notes.length, 1);
  assert.equal(r.raw.notes[0].offKind, 'note-on-0');
  assert.equal(r.raw.notes[0].offTick, 480);
});

test('the same pitch pressed twice pairs first in, first out (A19)', () => {
  const r = read('m03-overlap-same-pitch');
  assert.deepEqual(r.raw.notes.map(n => [n.onTick, n.offTick]), [[0, 480], [240, 960]]);
});

test('a press that never stops is closed at the end of its track, not dropped (A21)', () => {
  const r = read('m05-unpaired-note-on');
  assert.equal(r.raw.notes.length, 2, 'both notes survive');
  const unclosed = r.raw.notes.find(n => n.offKind === 'unclosed');
  assert.ok(unclosed, 'the unpaired press is there');
  assert.equal(unclosed.midi, 60);
  assert.ok(codesOf(r).includes('W-MIDI-NOTE-UNCLOSED'), 'and it is reported');
});

test('a format 1 file reads its tempo map from the track that holds it (A22)', () => {
  const r = read('m11-format1-tempo-track');
  assert.equal(r.raw.format, 1);
  assert.deepEqual(r.raw.tempoMap, [{ tick: 0, usPerQuarter: 500000 }, { tick: 1920, usPerQuarter: 250000 }]);
  const us = r.raw.usAt;
  /* the notes are in track 1 and the tempo in track 0: each segment counts at its own rate */
  assert.deepEqual(r.raw.notes.map(n => [n.track, n.midi, us(n.onTick), us(n.offTick)]), [
    [1, 60, 0, 500000],
    [1, 62, 2000000, 2250000],
    [1, 64, 3000000, 3250000]
  ]);
  /* the reader midi_notes.py uses would apply the last tempo to everything and put note 60 at 0-250000 */
  assert.notEqual(us(480), Math.round(480 * 250000 / 480));
});

test('an SMPTE division is real time, not 480 ticks a quarter (A23)', () => {
  const r = read('m17-smpte-division');
  assert.deepEqual(r.raw.division, { kind: 'smpte', fps: 25, subframes: 40 });
  /* 25 frames a second of 40 subframes is a thousand ticks a second, so a thousand ticks is one second */
  assert.equal(r.raw.usAt(1000), 1000000);
  assert.notEqual(r.raw.usAt(1000), Math.round(1000 * 500000 / 480));
});

test('every ticks-per-quarter gives the same seconds (A19)', () => {
  ['m16-ppq-96', 'm16-ppq-480', 'm16-ppq-960'].forEach(n => {
    const r = read(n);
    assert.equal(r.raw.notes.length, 1, n);
    assert.equal(r.raw.usAt(r.raw.notes[0].offTick), 500000, n + ': a quarter at 120 qpm is half a second');
  });
});

test('running status, SysEx and an unknown meta do not derail the reader (A19)', () => {
  const rs = read('m21-running-status');
  assert.deepEqual(rs.raw.notes.map(n => [n.midi, n.onTick, n.offTick]), [[60, 0, 480], [64, 480, 960]]);
  const sx = read('m22-sysex-and-unknown-meta');
  assert.equal(sx.raw.notes.length, 1);
  const kinds = sx.raw.tracks[0].events.map(e => e.kind);
  assert.ok(kinds.includes('sysex'), 'the SysEx is kept');
  assert.ok(sx.raw.tracks[0].events.some(e => e.kind === 'meta' && e.type === 'meta-96'), 'so is the meta it does not know');
});

test('a truncated track loses only what was cut, and says so', () => {
  const r = read('m25-truncated-track');
  assert.ok(codesOf(r).includes('W-MIDI-TRACK-SHORT'));
  assert.ok(r.raw.notes.length >= 1, 'what was readable is read');
});

test('a file that is not MIDI is refused as a value, never as an exception', () => {
  const r = SG.midi.read(Buffer.from('not a midi file at all'));
  assert.deepEqual([r.ok, r.code], [false, 'MIDI-NOT-A-FILE']);
  assert.ok(r.report, 'a report comes back even so');
});

/* ------------------------------------------------------------------- the graph */

test('the three pedals are read as spans; a part-way press keeps its depth (A24)', () => {
  const full = imp('m06-sustain-pedal').graph.performances[0];
  assert.deepEqual(full.pedals.map(p => [p.pedal, p.on, p.off, p.depth]), [['damper', 0, 1000000, undefined]]);
  const half = imp('m07-half-pedal').graph.performances[0];
  assert.equal(half.pedals[0].depth, 100, 'a press at 100 is not a press at 127');
  const both = imp('m08-sostenuto-and-soft').graph.performances[0];
  assert.deepEqual(both.pedals.map(p => p.pedal).sort(), ['soft', 'sostenuto']);
});

test('a controller that is not a pedal is kept exactly (A25)', () => {
  const g = imp('m09-expression-cc11').graph;
  const pf = g.performances[0];
  assert.deepEqual((pf.controls || []).map(c => [c.cc, c.value, c.us]), [[11, 100, 0], [11, 60, 250000], [11, 20, 500000]]);
  assert.deepEqual(pf.pedals, undefined, 'expression is not a pedal');
  /* and the pedals are a reading of the stream, which is kept whole beside them */
  const ped = imp('m06-sustain-pedal').graph.performances[0];
  assert.deepEqual(ped.controls.map(c => [c.cc, c.value]), [[64, 127], [64, 0]]);
});

test('a performance note names the track and channel it came from (A19, §18 S1)', () => {
  const pf = imp('m18-multi-channel').graph.performances[0];
  assert.deepEqual(pf.notes.map(n => [n.track, n.channel, n.midi]), [[1, 1, 60], [1, 2, 64], [1, 3, 67], [1, 4, 72]]);
});

test('every skeleton entity says it was inferred, and the file\'s own facts do not (A27)', () => {
  const r = imp('m13-tempo-map');
  const g = r.graph;
  const op = id => SG.prov.provOf(g, id).op;
  g.timeline.measures.forEach(m => assert.equal(op(m.id), 'inferred', m.id));
  g.parts.forEach(p => {
    assert.equal(op(p.id), 'inferred', p.id);
    p.staves.forEach(s => assert.equal(op(s.id), 'inferred', s.id));
    p.voices.forEach(v => assert.equal(op(v.id), 'inferred', v.id));
  });
  /* the tempo map is the file's, so it inherits the imported default */
  g.timeline.tempos.forEach(t => assert.equal(op(t.id), 'imported', t.id));
  assert.ok(codesOf(r).includes('W-MIDI-SKELETON'), 'and the report says the notation is a grid');
  assert.ok(r.report.inferred.some(x => x.what === 'measures'));
});

test('the bar lines follow the metre map, and an anchor meets each one (A27)', () => {
  const g = imp('m14-meter-changes').graph;
  assert.deepEqual(g.timeline.meters.map(m => m.beats[0] + '/' + m.beatType), ['4/4', '3/4', '6/8']);
  assert.deepEqual(g.timeline.measures.map(m => m.dur), ['1', '3/4', '3/4']);
  const pf = g.performances[0];
  assert.equal(pf.anchors.length, g.timeline.measures.length);
  const us = pf.anchors.map(a => a.us);
  assert.deepEqual(us, us.slice().sort((a, b) => a - b), 'anchors increase');
  assert.equal(new Set(us).size, us.length, 'strictly');
});

test('a file with no metre and no tempo gets both, and says it made them up (A8 for MIDI)', () => {
  const r = imp('m26-no-meter-no-tempo');
  assert.ok(codesOf(r).includes('W-MIDI-METER-ASSUMED'));
  assert.deepEqual(r.graph.timeline.meters.map(m => m.beats[0] + '/' + m.beatType), ['4/4']);
  /* no tempo either: the canonical form leaves the empty list out, and 120 quarters a minute is what
     a MIDI file without a tempo means */
  assert.equal(r.graph.timeline.tempos, undefined);
  const pf = r.graph.performances[0];
  assert.equal(pf.notes[0].off, 500000, 'a quarter at 480 ticks and 120 qpm is half a second');
});

test('channel 10 becomes a percussion part with the General MIDI kit (A29)', () => {
  const g = imp('m19-channel-10-drums').graph;
  const p = g.parts[0];
  assert.equal(p.instrument.kind, 'drumset');
  assert.equal(p.instrument.family, 'percussion');
  assert.equal(p.staves[0].kind, 'percussion');
  assert.deepEqual(p.instrument.kit.items.map(i => [i.key, i.gm]),
    [['bass-drum-1', 36], ['acoustic-snare', 38], ['closed-hi-hat', 42]]);
  const pf = g.performances[0];
  assert.deepEqual(pf.notes.map(n => n.inst), ['bass-drum-1', 'closed-hi-hat', 'acoustic-snare', 'bass-drum-1']);
  pf.notes.forEach(n => {
    assert.equal(n.midi, undefined, 'a struck thing is not a pitch');
    assert.equal(n.part, p.id, 'and it names the part whose kit it belongs to');
  });
});

test('the instrument follows the program change, and the clef the pitch (A19)', () => {
  const piano = imp('m20-program-change').graph.parts[0];
  assert.equal(piano.instrument.kind, 'piano');
  assert.equal(piano.instrument.midi.program, 1, 'stored 1-based, as MusicXML writes it');
  const low = imp('m23-track-names').graph.parts;
  assert.equal(low[0].clefs[0].sign, 'G', 'C5 reads in the treble');
  assert.equal(low[1].clefs[0].sign, 'F', 'C3 reads in the bass');
});

test('a file with no note is refused, with a report (A19)', () => {
  const empty = Buffer.from(SG.midi.write({ format: 0, division: { kind: 'ppq', ppq: 480 },
    tracks: [{ index: 0, events: [], endTick: 0 }] }));
  const r = SG.midi.import(empty, { scoreId: 'midi' });
  assert.deepEqual([r.ok, r.code], [false, 'MIDI-NO-NOTES']);
  assert.ok(r.report);
});

/* ------------------------------------------------------------------ fidelity */

test('MIDI to the graph and back keeps every sounding fact, to the microsecond (A26)', () => {
  const names = allFixtures();
  let checked = 0;
  names.forEach(name => {
    const src = SG.midi.read(bytes(name));
    assert.equal(src.ok, true, name);
    const r = SG.midi.import(bytes(name), { scoreId: 'rt' });
    assert.equal(r.ok, true, name + ': ' + r.message);
    const out = SG.midi.export(r.graph);
    assert.equal(out.ok, true, name + ': ' + out.message);
    const back = SG.midi.read(out.bytes);
    assert.equal(back.ok, true, name);

    const usA = src.raw.usAt, usB = back.raw.usAt;
    const want = src.raw.notes.filter(n => usA(n.offTick) > usA(n.onTick))
      .map(n => [n.track, n.channel, n.midi, usA(n.onTick), usA(n.offTick), Math.max(1, Math.min(127, n.onVel))].join(' ')).sort();
    const got = back.raw.notes.map(n => [n.track, n.channel, n.midi, usB(n.onTick), usB(n.offTick), n.onVel].join(' ')).sort();
    assert.deepEqual(got, want, name + ': notes');

    const wantC = src.raw.controls.map(c => [c.track, c.channel, c.cc, c.value, usA(c.tick)].join(' ')).sort();
    const gotC = back.raw.controls.map(c => [c.track, c.channel, c.cc, c.value, usB(c.tick)].join(' ')).sort();
    assert.deepEqual(gotC, wantC, name + ': controllers');
    checked++;
  });
  assert.ok(checked >= 25, checked + ' fixtures round-tripped');
});

test('the musical time the file states reaches the timeline (A26)', () => {
  /* the tempo and metre maps are notation, so they are compared against the graph, not the written file */
  const src = read('m13-tempo-map');
  const g = imp('m13-tempo-map').graph;
  assert.equal(g.timeline.tempos.length, src.raw.tempoMap.length);
  g.timeline.tempos.forEach((t, i) => {
    const want = 60000000 / src.raw.tempoMap[i].usPerQuarter;
    assert.equal(Number(SG.rational.parse(t.qpm).n) / Number(SG.rational.parse(t.qpm).d), want, 'tempo ' + i);
  });
  const keys = read('m15-key-signature');
  const kg = imp('m15-key-signature').graph;
  assert.deepEqual(kg.timeline.keys.map(k => [k.fifths, k.mode]),
    keys.raw.keyMap.map(k => [k.sf, k.mi ? 'minor' : 'major']));
});

test('importing the same file twice gives the same bytes, and so does another process (A19)', () => {
  const a = imp('m11-format1-tempo-track').graph, b = imp('m11-format1-tempo-track').graph;
  assert.equal(SG.serialize(a), SG.serialize(b));
  const child = require('child_process').execFileSync(process.execPath, ['-e', `
    const SG = require(${JSON.stringify(path.join(REPO, 'scoregraph', 'index.js'))});
    const fs = require('fs');
    const r = SG.midi.import(fs.readFileSync(${JSON.stringify(path.join(MIDI, 'm11-format1-tempo-track.mid'))}), { scoreId: 'midi' });
    process.stdout.write(SG.serialize(r.graph));`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(child, SG.serialize(a));
});

test('twenty thousand notes import in a reasonable time (A26 scale)', () => {
  /* built here rather than committed: a 20,000-note fixture is bytes nobody needs to read */
  const Q = 480, n = 20000;
  const events = [];
  for (let i = 0; i < n; i++) events.push([i * 24, 0x90, 21 + (i % 88), 64], [i * 24 + 20, 0x80, 21 + (i % 88), 0]);
  /* write the file by hand: variable-length deltas over a sorted event list */
  const vlq = v => { const p = [v & 0x7f]; v >>>= 7; while (v) { p.push((v & 0x7f) | 0x80); v >>>= 7; } return p.reverse(); };
  events.sort((a, b) => a[0] - b[0]);
  const body = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, 0x00, 0xff, 0x58, 0x04, 4, 2, 24, 8];
  let last = 0;
  events.forEach(e => { body.push(...vlq(e[0] - last)); last = e[0]; body.push(e[1], e[2], e[3]); });
  body.push(0x00, 0xff, 0x2f, 0x00);
  const be32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const file = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...be32(6), 0, 0, 0, 1, (Q >> 8) & 0xff, Q & 0xff,
    0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body]);
  const t0 = process.hrtime.bigint();
  const r = SG.midi.import(file, { scoreId: 'big' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.ok, true, r.message);
  assert.equal(r.graph.performances[0].notes.length, n);
  assert.ok(ms < 8000, 'importing 20,000 notes took ' + ms.toFixed(0) + ' ms');
});
