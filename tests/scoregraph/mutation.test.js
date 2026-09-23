'use strict';
/* Would the suite notice if the importer got worse? (docs/GOALS/G02 §16.3, A39)

   The G0 mutation harness plants a defect in the writer and runs the transcription benchmark. That cannot
   reach an importer: the benchmark reads MusicXML with its own Python reader, never with this one. So the
   importers are mutated here instead - a copy of scoregraph/ with one line changed, loaded fresh - and each
   mutation has to make a named, musical difference on a named fixture. A mutation that changes nothing
   means the fixture corpus has a hole; a mutation whose anchor has drifted fails loudly rather than
   silently passing, which is the failure mode G0's AnchorMissing exists for.

   Every mutation here is harmful on purpose. MUT-NOOP is the control: a comment, and nothing moves. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SG, FIX, read } = require('./helpers.js');

const XML = path.join(FIX, 'xml');
const MIDI = path.join(FIX, 'midi');
const SRC = path.join(REPO, 'scoregraph');

/* a whole copy of the library with one edit, loaded on its own so the real one is untouched */
let roots = [];
function mutant(file, find, replace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mutant-'));
  roots.push(dir);
  fs.readdirSync(SRC).filter(f => f.endsWith('.js')).forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(dir, f)));
  const at = path.join(dir, file);
  /* The anchors below are written with \n. Git hands a Windows checkout the same files with \r\n
     (core.autocrlf), which would make every multi-line anchor miss, so the copy is read as lines
     and joined back with \n. What runs is the same JavaScript either way. */
  const before = fs.readFileSync(at, 'utf8').split('\r\n').join('\n');
  const count = before.split(find).length - 1;
  assert.equal(count, 1, file + ': the anchor ' + JSON.stringify(find.slice(0, 60)) + ' matches ' + count + ' times, not once');
  fs.writeFileSync(at, before.replace(find, replace));
  return require(path.join(dir, 'index.js'));
}
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));

const xmlOf = name => read(path.join(XML, name + '.musicxml'));
const midiOf = name => fs.readFileSync(path.join(MIDI, name + '.mid'));
const graph = (lib, name) => {
  const r = lib.musicxml.import(xmlOf(name), { scoreId: 'mut' });
  assert.equal(r.ok, true, name + ': ' + r.message);
  return r.graph;
};
const midiGraph = (lib, name) => {
  const r = lib.midi.import(midiOf(name), { scoreId: 'mut' });
  assert.equal(r.ok, true, name + ': ' + r.message);
  return r.graph;
};
const count = (g, f) => g.parts.reduce((s, p) => s + p.spanners.filter(f).length, 0);
const accidentals = g => g.parts.reduce((s, p) => s + p.events.reduce((t, e) => t + (e.heads || []).filter(h => h.acc).length, 0), 0);
const perf = g => g.performances[0];

const IMPORTER = 'musicxml-import.js';
const MIDI_IMPORT = 'midi-import.js';
const MIDI_FILE = 'midi-file.js';

test('MUT-NOOP: a comment changes nothing (the control)', () => {
  const lib = mutant(IMPORTER, '  const yes = v =>', '  /* mutation: a comment */\n  const yes = v =>');
  ['ties-slurs', 'voices-4', 'transposing', 'repeats-simple'].forEach(n => {
    assert.equal(lib.serialize(graph(lib, n)), SG.serialize(graph(SG, n)), n);
  });
});

test('IM-ACCIDENTAL-DROP: a printed accidental is not read', () => {
  const lib = mutant(IMPORTER, "            const accEl = kid(n, 'accidental');",
    '            const accEl = null;   /* mutation: the printed accidental is not read */');
  const clean = graph(SG, 'accidentals-printed'), bad = graph(lib, 'accidentals-printed');
  assert.ok(accidentals(clean) > 0, 'the fixture prints accidentals');
  assert.equal(accidentals(bad), 0, 'and the mutant loses them');
  assert.notEqual(lib.serialize(bad), SG.serialize(clean));
});

test('IM-TIE-LOSS: a tie start is not read, so the note sounds twice', () => {
  const lib = mutant(IMPORTER, "if (t.attrs.type === 'start') head.tieStart = true;", "if (false) head.tieStart = true;");
  const clean = graph(SG, 'ties-slurs'), bad = graph(lib, 'ties-slurs');
  const ties = g => count(g, s => s.type === 'tie');
  assert.ok(ties(clean) > 0, 'the fixture ties notes');
  assert.ok(ties(bad) < ties(clean), 'the mutant ties fewer: ' + ties(bad) + ' of ' + ties(clean));
});

test('IM-VOICE-COLLAPSE: every note lands in one voice', () => {
  const lib = mutant(IMPORTER, 'const voice = voiceFor(label, staffNo, at, dur, grace, avoid);',
    "const voice = voiceFor('1', staffNo, at, dur, grace, avoid);");
  const clean = graph(SG, 'voices-4'), bad = graph(lib, 'voices-4');
  const labels = g => g.parts[0].voices.map(v => v.label);
  assert.deepEqual(labels(clean), ['1', '2', '5', '6'], 'the fixture names four voices');
  /* voiceFor still splits notes that overlap each other, so the count survives; what the file said
     each voice was does not, and that is the loss */
  assert.deepEqual(labels(bad), ['1', '1', '1', '1'], 'the mutant forgets which voice each note was in');
  assert.notEqual(lib.serialize(bad), SG.serialize(clean));
});

test('IM-STAFF-COLLAPSE: every note lands on one staff', () => {
  const lib = mutant(IMPORTER, "          const staffNo = jsInt(txt(n, 'staff')) || 1;", '          const staffNo = 1;');
  const clean = graph(SG, 'grand-staff'), bad = graph(lib, 'grand-staff');
  const staves = g => new Set(g.parts[0].events.map(e => e.staff)).size;
  assert.equal(staves(clean), 2, 'the fixture uses both staves');
  assert.equal(staves(bad), 1, 'and the mutant uses one');
});

test('IM-TEMPO-MAP-LOSS: only the first tempo is kept', () => {
  const lib = mutant(IMPORTER, '            if (tempo) { tempo.doc = docIndex++; tempoDrafts.push(tempo); }',
    '            if (tempo && !tempoDrafts.length) { tempo.doc = docIndex++; tempoDrafts.push(tempo); }');
  const clean = graph(SG, 'tempo-meter-key-changes'), bad = graph(lib, 'tempo-meter-key-changes');
  assert.ok((clean.timeline.tempos || []).length > 1, 'the fixture changes tempo');
  assert.equal((bad.timeline.tempos || []).length, 1, 'and the mutant keeps one');
});

test('IM-REPEAT-LOSS: a backward repeat is not read, so the passage plays once', () => {
  const lib = mutant(IMPORTER, "            out.repeat = rep.attrs.direction === 'forward' ? 'forward' : 'backward';",
    "            out.repeat = rep.attrs.direction === 'forward' ? 'forward' : undefined;");
  const clean = graph(SG, 'repeats-simple'), bad = graph(lib, 'repeats-simple');
  const order = g => SG.time.unroll(g).length;
  assert.ok(order(clean) > g0(clean), 'the fixture repeats');
  assert.equal(order(bad), g0(bad), 'and the mutant plays straight through');
  function g0(g) { return g.timeline.measures.length; }
});

test('IM-OCTAVE-SHIFT-DROP: an 8va is not read, so the notes sound an octave off', () => {
  const lib = mutant(IMPORTER, '                  openOttavas.set(key, {', '                  if (false) openOttavas.set(key, {');
  const clean = graph(SG, 'ottava-8va-8vb'), bad = graph(lib, 'ottava-8va-8vb');
  const ott = g => count(g, s => s.type === 'ottava');
  assert.ok(ott(clean) > 0, 'the fixture has an octave shift');
  assert.equal(ott(bad), 0, 'and the mutant has none');
  assert.notEqual(lib.serialize(bad), SG.serialize(clean));
});

test('IM-TRANSPOSE-IGNORE: a transposing part is stored at written pitch', () => {
  const lib = mutant(IMPORTER, '            if (!part.transpose) part.transpose = t;', '            if (false) part.transpose = t;');
  const clean = graph(SG, 'transposing'), bad = graph(lib, 'transposing');
  const pitches = g => g.parts.map(p => p.events.filter(e => e.heads).map(e => e.heads.map(h => h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct).join(',')).join(' '));
  assert.notDeepEqual(pitches(bad), pitches(clean), 'the concert pitches move');
});

test('MD-NOTE-OFF-LOSS: a press that never stops is thrown away', () => {
  const lib = mutant(MIDI_FILE, '    open.forEach(stack => stack.forEach(on => {', '    if (false) open.forEach(stack => stack.forEach(on => {');
  const clean = midiGraph(SG, 'm05-unpaired-note-on'), bad = midiGraph(lib, 'm05-unpaired-note-on');
  assert.equal(perf(clean).notes.length, 2);
  assert.equal(perf(bad).notes.length, 1, 'the mutant loses the unpaired press');
});

test('MD-PEDAL-LOSS: CC 64 is not read as a pedal', () => {
  const lib = mutant(MIDI_IMPORT, "  const PEDAL_CC = { 64: 'damper', 66: 'sostenuto', 67: 'soft' };",
    "  const PEDAL_CC = { 66: 'sostenuto', 67: 'soft' };");
  const clean = midiGraph(SG, 'm06-sustain-pedal'), bad = midiGraph(lib, 'm06-sustain-pedal');
  assert.equal((perf(clean).pedals || []).length, 1);
  assert.equal((perf(bad).pedals || []).length, 0, 'the mutant hears no pedal');
  assert.equal((perf(bad).controls || []).length, 2, 'though the raw stream is still there');
});

test('MD-TEMPO-LAST-ONLY: midi_notes.py\'s own defect, planted (A22)', () => {
  const lib = mutant(MIDI_FILE, '      for (let i = 0; i < pts.length; i++) {\n        if (pts[i].tick >= tick) break;',
    '      if (pts.length) upq = pts[pts.length - 1].usPerQuarter;\n      for (let i = 0; i < 0; i++) {\n        if (pts[i].tick >= tick) break;');
  const clean = midiGraph(SG, 'm11-format1-tempo-track'), bad = midiGraph(lib, 'm11-format1-tempo-track');
  assert.deepEqual(perf(clean).notes.map(n => n.on), [0, 2000000, 3000000]);
  assert.deepEqual(perf(bad).notes.map(n => n.on), [0, 1000000, 2000000], 'the mutant plays it at the final tempo throughout');
});

test('MD-CHANNEL-MERGE: four channels become one part', () => {
  const lib = mutant(MIDI_IMPORT, "      const k = n.track + '|' + n.channel;", "      const k = n.track + '|1';");
  const clean = midiGraph(SG, 'm18-multi-channel'), bad = midiGraph(lib, 'm18-multi-channel');
  assert.equal(clean.parts.length, 4);
  assert.equal(bad.parts.length, 1, 'the mutant hears one player');
});

test('MD-VELOCITY-FLATTEN: every note is played equally hard', () => {
  const lib = mutant(MIDI_IMPORT, 'vel: Math.max(1, Math.min(127, n.onVel))', 'vel: 64');
  const clean = midiGraph(SG, 'm02-chord-3'), bad = midiGraph(lib, 'm02-chord-3');
  assert.deepEqual(perf(clean).notes.map(n => n.vel), [80, 70, 90]);
  assert.deepEqual(perf(bad).notes.map(n => n.vel), [64, 64, 64]);
});

test('IM-REPORT-SILENT: an importer that stops counting what it drops is caught (A12)', () => {
  const lib = mutant(IMPORTER, "      el.kids.forEach(k => { if (used.has(k)) count(k); else drop(k.name); });",
    "      el.kids.forEach(k => { if (used.has(k)) count(k); });");
  const clean = SG.musicxml.import(xmlOf('dropped'), { scoreId: 'mut' });
  const bad = lib.musicxml.import(xmlOf('dropped'), { scoreId: 'mut' });
  assert.ok(Object.keys(clean.report.dropped).length > 0, 'the fixture drops things');
  assert.deepEqual(bad.report.dropped, {}, 'and the mutant claims it drops none');
});
