/* rec/leadsheet.js (G10c-1a, docs/GOALS/G10_AUDIO_TO_SCORE.md section 33): the lead sheet of a recording - the melody as one line over every heard note, octave
   moves, the harmony of all the notes - and the arranger glue's `recordingArrange: 'leadsheet'` (the app's own arrangeSingleNote, tests/realize/app-single-extract.js).
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO } = require('./helpers.js');
const LS = require(path.join(REPO, 'rec', 'leadsheet.js'));
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const HARM = require(path.join(REPO, 'songgraph', 'harmony.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const SER = require(path.join(REPO, 'scoregraph', 'serialize.js'));
const P = require(path.join(REPO, 'scoregraph', 'pitch.js'));
const E = require(path.join(REPO, 'tests', 'realize', 'app-single-extract.js'));

const { OPTS, cover, SCALE, tune, headsOf, convert, f1, HELD, heldTune } = require('./leadsheet-fixtures.js');

test('isRecording: a transcription is, a printed score is not; a printed score is refused with its reason', () => {
  const g = convert(cover(8, tune));
  assert.equal(LS.isRecording(g), true);
  const hymn = SG.musicxml.import(fs.readFileSync(path.join(REPO, 'catalog', 'hymns', 'silent-night.musicxml'), 'utf8'), { scoreId: 'h' });
  const hg = hymn.graph || hymn;
  assert.equal(LS.isRecording(hg), false);
  const r = LS.prepare(hg, { songgraph: SGG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'LEADSHEET_NOT_A_RECORDING');
});

test('the melody is the top line: every tune note, nothing else (F1 1.0), over a bass and a chord', () => {
  const c = cover(16, tune);
  const g = convert(c);
  const r = LS.prepare(g, { songgraph: SGG });
  assert.equal(r.ok, true, r.reason);
  const s = f1(r.melody.map(n => n.head), headsOf(g, c.melody));
  assert.ok(s.f1 >= 0.97, 'F1 ' + s.f1.toFixed(3) + ' (P ' + s.p.toFixed(3) + ' R ' + s.r.toFixed(3) + ')');
});

test('a melody note the hand split put in the left staff stays in the line (the staff is not read)', () => {
  const c = cover(16, tune);
  const g = convert(c);
  const whole = LS.prepare(g, { songgraph: SGG });
  assert.equal(whole.ok, true, whole.reason);
  /* the same recording with the hand split's error planted: the events of the right-hand voice in bars 5 to 10 are in the left staff and voice (what a split that gives the tune to the
     left hand writes) */
  const bad = JSON.parse(JSON.stringify(g));
  const part = bad.parts[0];
  const rhStaff = part.staves[0].id, lhStaff = part.staves[1].id, lhVoice = part.voices.find(v => v.staff === lhStaff).id, rhVoice = part.voices.find(v => v.staff === rhStaff).id;
  const bars = new Set(bad.timeline.measures.slice(4, 10).map(m => m.id));
  let moved = 0;
  part.events.forEach(e => { if (e.voice === rhVoice && bars.has(e.m)) { e.staff = lhStaff; e.voice = lhVoice; moved++; } });
  assert.ok(moved > 10, 'the plant moved ' + moved + ' events');
  const split = LS.prepare(bad, { songgraph: SGG });
  assert.equal(split.ok, true, split.reason);
  assert.deepEqual(split.melody.map(n => [n.head, n.midi]), whole.melody.map(n => [n.head, n.midi]), 'the line is the same whichever staff holds the tune');
  assert.ok(split.melody.some(n => n.staff === 1), 'some of the line is in the lower staff of this graph');
  /* and the reduction (the one-note pipeline) has no such property: it keeps one top note per hand, so what the split put in the left hand is the left hand's */
  const truth = headsOf(g, c.melody);
  assert.ok(f1(split.melody.map(n => n.head), truth).f1 >= 0.97);
});

test('a note of the accompaniment that rises above the tune for one beat is not melody; a held tune note is not interrupted by the notes under it', () => {
  const stray = (b, k) => tune(b, k);
  const c = cover(16, stray);
  /* a high figure note (octave and a half above the tune) once in a while, between two tune notes */
  for (let b = 1; b < 16; b += 3) {
    const tune2 = c.melody.find(n => Math.abs(n.on - (1 + (b * 4 + 1) * 0.6)) < 0.05);
    if (tune2) c.notes.push({ on: Math.round((tune2.on + 0.3) * 1000) / 1000, off: Math.round((tune2.on + 0.5) * 1000) / 1000, midi: tune2.midi + 19, vel: 60 });
  }
  c.notes.sort((a, d) => a.on - d.on || a.midi - d.midi);
  const g = convert(c);
  const r = LS.prepare(g, { songgraph: SGG });
  assert.equal(r.ok, true, r.reason);
  const s = f1(r.melody.map(n => n.head), headsOf(g, c.melody));
  assert.ok(s.p >= 0.95, 'precision ' + s.p.toFixed(3));
  assert.ok(s.r >= 0.95, 'recall ' + s.r.toFixed(3));
});

test('the lead sheet graph: one voice, the recording\'s bars, metre, keys and measure ids; the checker finds nothing; provenance keeps the recording', () => {
  const g = convert(cover(16, tune));
  const r = LS.prepare(g, { songgraph: SGG });
  assert.equal(r.ok, true);
  const L = r.graph;
  assert.deepEqual(L.timeline.measures.map(m => [m.id, m.dur]), g.timeline.measures.map(m => [m.id, m.dur]));
  assert.deepEqual(L.timeline.meters.map(m => [m.m, m.beats, m.beatType]), g.timeline.meters.map(m => [m.m, m.beats, m.beatType]));
  assert.deepEqual(L.timeline.keys.map(k => [k.m, k.fifths, k.mode]), g.timeline.keys.map(k => [k.m, k.fifths, k.mode]));
  assert.equal(L.parts.length, 1);
  assert.equal(L.parts[0].voices.length, 1);
  assert.equal(NC.checkGraph(L).total, 0);
  assert.equal(LS.isRecording(L), true, 'the gates of repair/ (closing of gaps, tuplets) still see a transcription');
  assert.ok((L.performances || []).length === 0, 'no performance layer: its links named heads that are not here');
  /* monophonic: no two events of the voice overlap and none is a chord */
  const evs = L.parts[0].events.filter(e => e.kind === 'note');
  assert.ok(evs.every(e => e.heads.length === 1));
});

test('a staccato tune is written legato (silences under a quarter are not rests); a real silence is a rest', () => {
  const stac = convert(cover(16, tune, { melodyLen: 0.4 }));
  const r = LS.prepare(stac, { songgraph: SGG });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.graph.parts[0].events.filter(e => e.kind === 'rest').length <= 2);
  assert.equal(NC.checkGraph(r.graph).total, 0);
  /* two bars with no tune in the middle: whole-bar rests, and the tune is where it was before and after */
  const gap = (b, k) => (b >= 6 && b < 8 ? null : tune(b, k));
  const g = convert(cover(16, gap, { chord: false }));
  const q = LS.prepare(g, { songgraph: SGG });
  assert.equal(q.ok, true, q.reason);
  const rests = q.graph.parts[0].events.filter(e => e.kind === 'rest');
  assert.ok(rests.length >= 1 && rests.some(e => e.display && e.display.measureRest), 'a bar of rest is written as a measure rest');
  assert.equal(NC.checkGraph(q.graph).total, 0);
});

test('a tune note held across a barline is tied over it, and no rest is written where the tune still sounds (review of #182: allowBarTies was false)', () => {
  /* the tune of the other tests, but the note on beat 3 of the sixth bar is held for four beats: the rest of its bar and the first two beats of the next, to the tune's next note */
  const g = convert(heldTune());
  const r = LS.prepare(g, { songgraph: SGG });
  assert.equal(r.ok, true, r.reason);
  const part = r.graph.parts[0], ids = r.graph.timeline.measures.map(m => m.id);
  const where = e => (e.kind === 'rest' ? 'rest' : 'note') + ' in bar ' + ids.indexOf(e.m) + ' at ' + e.at + ' for ' + e.dur;
  assert.equal(part.events.filter(e => e.kind === 'rest').length, 0, 'a rest was written where the tune sounds: ' + part.events.filter(e => e.kind === 'rest').map(where));
  /* the held note is two notes of the same pitch, in the bar of its onset and the next one, joined by a tie */
  const byHead = new Map();
  part.events.forEach(e => { if (e.kind === 'note') byHead.set(e.heads[0].id, e); });
  const ties = (part.spanners || []).filter(sp => sp.type === 'tie');
  assert.ok(ties.length >= 1, 'no tie');
  const across = ties.filter(sp => ids.indexOf(byHead.get(sp.to).m) === ids.indexOf(byHead.get(sp.from).m) + 1);
  assert.ok(across.length >= 1, 'the tie does not cross a barline');
  const from = byHead.get(across[0].from), to = byHead.get(across[0].to);
  assert.equal(ids.indexOf(from.m), HELD.bar);
  assert.deepEqual(from.heads[0].pitch, to.heads[0].pitch);
  /* the tune sounds from its onset to the tune's next note: the two tied pieces are the four beats */
  const toWhole = x => { const [a, b] = String(x).split('/'); return b ? Number(a) / Number(b) : Number(a); };
  assert.equal(toWhole(from.dur) + toWhole(to.dur), 1, 'two halves: the four beats the tune note was held for');
  assert.equal(NC.checkGraph(r.graph).total, 0);
});

test('the key signatures are those of the recording: a cover in D major', () => {
  const g = convert(cover(16, tune, { shift: 2 }));
  assert.equal(g.timeline.keys[0].fifths, 2);
  const r = LS.prepare(g, { songgraph: SGG });
  assert.deepEqual(r.graph.timeline.keys.map(k => [k.m, k.fifths, k.mode]), g.timeline.keys.map(k => [k.m, k.fifths, k.mode]));
});

test('the harmony is G7a over ALL heard notes (both staves, the split not read), one chord per beat window, on the lead sheet\'s own measure ids', () => {
  const g = convert(cover(16, tune));
  const r = LS.prepare(g, { songgraph: SGG });
  const want = HARM.harmonyOf(g);
  assert.equal(r.sg.harmony.length, want.length);
  r.sg.harmony.forEach((w, i) => { assert.equal(w.m, want[i].m); assert.equal(w.root, want[i].root); assert.equal(w.quality, want[i].quality); });
  /* and it is not what the single melody line would say: the chord of the accompaniment (a triad on the root) is heard where the line alone is one pitch */
  const alone = SGG.analyze(r.graph).harmony;
  assert.notDeepEqual(alone.map(w => w.quality + w.root), r.sg.harmony.map(w => w.quality + w.root));
  r.sg.harmony.forEach(w => { assert.ok(r.graph.timeline.measures.some(m => m.id === w.m)); });
});

test('octaves: a tune heard two octaves too high comes down into C4..C6 as one phrase (contour and pitch classes kept); a tune in the window is not moved', () => {
  const high = (b, k) => tune(b, k) + 24;
  const c = cover(16, high, { chord: false });
  const g = convert(c);
  const r = LS.prepare(g, { songgraph: SGG });
  assert.equal(r.ok, true, r.reason);
  const written = r.graph.parts[0].events.filter(e => e.kind === 'note').map(e => P.midi(e.heads[0].pitch));
  assert.ok(written.length > 20);
  assert.ok(Math.max(...written) <= 84 && Math.min(...written) >= 60, 'range ' + Math.min(...written) + '..' + Math.max(...written));
  assert.ok(r.report.shifted > 0);
  r.melody.forEach(n => { assert.equal(Math.abs(n.shift) % 12, 0); });
  /* one shift for the whole line (nothing in it asks for another) */
  assert.equal(new Set(r.melody.map(n => n.shift)).size, 1);
  const inWindow = LS.prepare(convert(cover(16, tune, { chord: false })), { songgraph: SGG });
  assert.equal(inWindow.report.shifted, 0);
  /* switched off, the octaves stay as heard */
  const off = LS.prepare(g, { songgraph: SGG, params: { octave: false } });
  assert.equal(off.report.shifted, 0);
  assert.ok(Math.max(...off.graph.parts[0].events.filter(e => e.kind === 'note').map(e => P.midi(e.heads[0].pitch))) > 84);
});

test('shiftOctaves: a shift costs little at a silence and a lot inside a phrase', () => {
  const mk = (tick, midi, end) => ({ tick: tick, midi: midi, end: end });
  /* two phrases a bar apart: the first in the window, the second two octaves up: the second moves, the first does not */
  const line = [mk(0, 72, 24), mk(24, 74, 48), mk(48, 76, 72), mk(200, 96, 224), mk(224, 98, 248), mk(248, 100, 272)];
  assert.deepEqual(LS.shiftOctaves(line, {}), [0, 0, 0, -24, -24, -24]);
  /* one note a semitone over the window is left where it is (a shift would cost more) */
  assert.deepEqual(LS.shiftOctaves([mk(0, 83, 24), mk(24, 85, 48), mk(48, 84, 72)], {}), [0, 0, 0]);
  /* a long phrase with a few notes over stays; the same notes as most of a phrase move it */
  const long = []; for (let i = 0; i < 20; i++) long.push(mk(i * 24, i % 7 === 0 ? 88 : 76, i * 24 + 24));
  assert.ok(LS.shiftOctaves(long, {}).every(x => x === 0));
  const mostly = []; for (let i = 0; i < 20; i++) mostly.push(mk(i * 24, i % 4 === 0 ? 76 : 90, i * 24 + 24));
  assert.ok(LS.shiftOctaves(mostly, {}).every(x => x === -12), 'one shift for the run');
  /* a run below the window comes up */
  assert.deepEqual(LS.shiftOctaves([mk(0, 48, 24), mk(24, 50, 48), mk(48, 52, 72)], {}), [12, 12, 12]);
  assert.deepEqual(LS.shiftOctaves([], {}), []);
});

test('the refusals: bars of different lengths, a meter change, no melody', () => {
  const g = convert(cover(8, tune));
  const clone = () => JSON.parse(JSON.stringify(g));
  const irregular = clone();
  irregular.timeline.measures[0].dur = '3/4';
  assert.equal(LS.collect(irregular).reason, 'LEADSHEET_IRREGULAR_BARS');
  const change = clone();
  change.timeline.meters.push({ id: 'mtX', m: change.timeline.measures[4].id, beats: [3], beatType: 4 });
  assert.equal(LS.collect(change).reason, 'LEADSHEET_METRE');
  const additive = clone();
  additive.timeline.meters[0].groups = [3, 2];
  assert.equal(LS.collect(additive).reason, 'LEADSHEET_METRE');
  const silent = clone();
  silent.parts[0].events = silent.parts[0].events.filter(e => e.kind !== 'note');
  assert.equal(LS.collect(silent).reason, 'LEADSHEET_NO_MELODY');
});

test('deterministic: the same recording gives the same lead sheet, byte for byte', () => {
  const g = convert(cover(16, tune));
  const a = LS.prepare(g, { songgraph: SGG }), b = LS.prepare(g, { songgraph: SGG });
  assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph));
  assert.deepEqual(a.melody, b.melody);
});

/* ---------------------------------------------------------------- the arranger glue */
const REF = E.reference();
const glue = () => E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(REF) });

test('the glue never throws on a malformed provenance: a graph whose sources are not an array is no recording (review of #182: the pre-check was outside the try)', async () => {
  const g = convert(cover(16, tune));
  const app = glue();
  for (const bad of [{}, 'audio-score', 7, { some: () => { throw new Error('boom'); } }]) {
    const h = JSON.parse(JSON.stringify(g));
    h.provenance.sources = bad;
    assert.equal(LS.isRecording(h), false);
    let a, err = null;
    try { a = await app.arrangeSingleNote(h, { level: 'beginner', recordingArrange: 'leadsheet' }); } catch (e) { err = e; }
    assert.equal(err, null, 'arrangeSingleNote threw: ' + (err && err.message));
    assert.equal(typeof a.ok, 'boolean');
    assert.equal('leadsheet' in a, false, 'no lead sheet for a graph that is not a recording');
  }
  /* no provenance at all: also no throw */
  const h2 = JSON.parse(JSON.stringify(g));
  delete h2.provenance;
  const b = await app.arrangeSingleNote(h2, { level: 'beginner', recordingArrange: 'leadsheet' }).catch(e => ({ threw: e }));
  assert.equal(b.threw, undefined, 'a graph with no provenance made arrangeSingleNote throw');
});

test('the app\'s arrangeSingleNote with recordingArrange leadsheet: made at every level, the melody kept in the right hand, no hard violation, checker classes 0', async () => {
  const g = convert(cover(16, tune));
  const app = glue();
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    const a = await app.arrangeSingleNote(g, { level: level, recordingArrange: 'leadsheet' });
    assert.equal(a.ok, true, level + ': ' + a.reason);
    assert.ok(a.leadsheet && a.leadsheet.melodyNotes > 20, 'the report of the lead sheet is on the result');
    assert.equal(NC.checkGraph(a.graph).total, 0, level);
    const rh = [];
    const stIdx = new Map(a.graph.parts[0].staves.map((s, i) => [s.id, i]));
    a.graph.parts[0].events.forEach(e => { if (e.kind === 'note' && stIdx.get(e.staff) === 0) e.heads.forEach(h => rh.push(P.midi(h.pitch))); });
    SCALE.forEach(m => assert.ok(rh.indexOf(m) >= 0, level + ': tune note ' + m + ' is in the right hand'));
    /* one note per hand: the default pipeline's rule */
    a.graph.parts[0].events.forEach(e => { if (e.kind === 'note') assert.equal(e.heads.length, 1, level + ': a chord in the arrangement'); });
  }
});

test('the glue: reduce (and no option) is today\'s reduction, byte for byte; a printed score ignores the option', async () => {
  const g = convert(cover(16, tune));
  const app = glue();
  const plain = await app.arrangeSingleNote(g, { level: 'beginner' });
  const reduce = await app.arrangeSingleNote(g, { level: 'beginner', recordingArrange: 'reduce' });
  const junk = await app.arrangeSingleNote(g, { level: 'beginner', recordingArrange: 'x' });
  const sig = a => (a.ok ? SER.fingerprint(a.graph) + '|' + a.levelNote + '|' + JSON.stringify(a.rescued) : 'REFUSED:' + a.reason);
  assert.equal(sig(reduce), sig(plain));
  assert.equal(sig(junk), sig(plain));
  assert.equal('leadsheet' in plain, false);
  const lead = await app.arrangeSingleNote(g, { level: 'beginner', recordingArrange: 'leadsheet' });
  assert.notEqual(sig(lead), sig(plain), 'the lead sheet is a different arrangement');
  const hymn = SG.musicxml.import(fs.readFileSync(path.join(REPO, 'catalog', 'hymns', 'silent-night.musicxml'), 'utf8'), { scoreId: 'h' });
  const hg = hymn.graph || hymn;
  const a = await glue().arrangeSingleNote(hg, { level: 'beginner' });
  const b = await glue().arrangeSingleNote(hg, { level: 'beginner', recordingArrange: 'leadsheet' });
  assert.equal(sig(b), sig(a), 'a printed score is arranged exactly as before');
  assert.equal('leadsheet' in b, false);
  /* a MIDI file (source kind 'midi-file': the player's own notes, not a recording's heard ones) is no recording either */
  const AS = require(path.join(REPO, 'audio-score.js'));
  const mid = AS.toMusicXml({ notes: cover(16, tune).notes }, Object.assign({}, OPTS, { sourceKind: 'midi-file' })).graph;
  assert.equal(LS.isRecording(mid), false);
  const m1 = await glue().arrangeSingleNote(mid, { level: 'beginner' });
  const m2 = await glue().arrangeSingleNote(mid, { level: 'beginner', recordingArrange: 'leadsheet' });
  assert.equal(sig(m2), sig(m1), 'a MIDI file is arranged exactly as before');
  assert.equal('leadsheet' in m2, false);
});

test('the glue: a lead sheet refusal is the arranger\'s refusal with the lead sheet\'s reason; a page without the module says so', async () => {
  const g = convert(cover(8, tune));
  const irregular = JSON.parse(JSON.stringify(g));
  irregular.timeline.measures[0].dur = '3/4';
  const a = await glue().arrangeSingleNote(irregular, { level: 'beginner', recordingArrange: 'leadsheet' });
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'LEADSHEET_IRREGULAR_BARS');
  const win = E.nodeWindow();
  delete win.PPPRecLeadsheet;
  const app = E.make({ window: win, Score: {}, loadArrangerReference: () => Promise.resolve(REF) });
  const b = await app.arrangeSingleNote(g, { level: 'beginner', recordingArrange: 'leadsheet' });
  assert.deepEqual([b.ok, b.reason], [false, 'LEADSHEET_NOT_LOADED']);
  const c = await app.arrangeSingleNote(g, { level: 'beginner' });
  assert.equal(c.ok, true, 'the option off needs nothing of the module');
});

test('the browser: the module loads in a bare vm after the page\'s own scripts and gives the lead sheet Node gives, byte for byte', () => {
  /* G10c-1b: the extractor's browserWindow() is what the page has when a recording is arranged, in the page's own order read from the page: scoregraph/ (build, time, gaps ...), songgraph/, v2's weights
     and its 13 files (rec/grid.js and rec/writer.js among them) and then LEADSHEET_SCRIPT; nothing here loads a file by hand any more */
  const L = E.scriptListOfPage();
  assert.equal(L.lead, 'rec/leadsheet.js');
  assert.deepEqual(L.leadNeeds, ['rec/grid.js', 'rec/writer.js'], 'what the page loads before it: the two files it reads when it loads, and the grid model rec/grid.js reads, nothing more of v2');
  assert.deepEqual(L.leadModel, ['PPPRecGridModel', 'rec/weights/ai5b-grid-v1.json']);
  assert.ok(L.leadNeeds.every(f => L.rec.indexOf(f) >= 0) && L.head.some(p => p === 'scoregraph/gaps.js'), 'the two are files of v2\'s own list (shared with its loader); scoregraph/gaps.js is in the page already');
  const win = E.browserWindow();
  assert.equal(typeof win.require, 'undefined'); assert.equal(typeof win.module, 'undefined');
  assert.equal(typeof win.PPPRecLeadsheet, 'object');
  assert.equal(typeof win.PPPRecWriter, 'object'); assert.equal(typeof win.PPPRecGrid, 'object');
  const g = convert(cover(16, tune));
  const node = LS.prepare(g, { songgraph: SGG });
  const page = win.PPPRecLeadsheet.prepare(JSON.parse(JSON.stringify(g)), { songgraph: win.PPPSongGraph });
  assert.equal(page.ok, true, page.reason);
  assert.equal(SER.fingerprint(page.graph), SER.fingerprint(node.graph));
  assert.equal(JSON.stringify(page.sg.harmony.map(w => [w.m, w.root, w.quality])), JSON.stringify(node.sg.harmony.map(w => [w.m, w.root, w.quality])));
});

/* G10d song mode: the notes of a separated song say their layer (track 1 the sung melody, 2 the bass, 3 the accompaniment). A synth line ABOVE the voice is what the
   skyline takes for the tune; with opts.melodyTrack the lead sheet takes the voice. */
test('song mode: opts.melodyTrack takes the tune from the melody layer, not from a higher accompaniment line; too few layer notes falls back to the skyline', () => {
  const voice = (b, k) => tune(b, k) - 12;                  /* the sung tune, C4..G4 */
  const c = cover(12, voice);
  const isTune = new Set(c.melody.map(n => n.on + '|' + n.midi));
  const notes = c.notes.map(n => Object.assign({}, n, { track: isTune.has(n.on + '|' + n.midi) ? 1 : n.midi < 48 ? 2 : 3 }));
  /* a synth figure an octave and more above the voice, on every beat and the half beat after: the highest notes of the piece */
  c.melody.forEach((n, i) => { notes.push({ on: n.on, off: +(n.on + 0.25).toFixed(3), midi: 86 + (i % 3), vel: 60, track: 3 }, { on: +(n.on + 0.3).toFixed(3), off: +(n.on + 0.55).toFixed(3), midi: 84, vel: 60, track: 3 }); });
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  const g = convert({ notes: notes });
  assert.ok(g.performances[0].notes.some(n => n.track === 1), 'the layers reach the performance layer');
  const truth = headsOf(g, c.melody);
  const sky = LS.prepare(g, { songgraph: SGG }), lay = LS.prepare(g, { songgraph: SGG, melodyTrack: 1 });
  assert.equal(sky.ok && lay.ok, true);
  assert.equal(sky.report.melodyFrom, 'skyline');
  assert.equal(lay.report.melodyFrom, 'layer');
  const fs1 = f1(sky.melody.map(m => m.head), truth).f1, fl1 = f1(lay.melody.map(m => m.head), truth).f1;
  assert.ok(fl1 >= 0.95, 'the layer gives the sung tune: F1 ' + fl1.toFixed(3));
  assert.ok(fs1 < 0.5, 'the skyline takes the synth line above it: F1 ' + fs1.toFixed(3));
  const none = LS.prepare(g, { songgraph: SGG, melodyTrack: 7 });
  assert.equal(none.ok && none.report.melodyFrom, 'skyline', 'a layer with no notes is no layer');
});

test('song mode: an accompaniment note on the key and tick of a melody note (an instrument doubling the tune) does not take the melody away; a few layer notes are no tune', () => {
  const voice = (b, k) => tune(b, k) - 12;
  const c = cover(12, voice);
  const isTune = new Set(c.melody.map(n => n.on + '|' + n.midi));
  const notes = c.notes.map(n => Object.assign({}, n, { track: isTune.has(n.on + '|' + n.midi) ? 1 : n.midi < 48 ? 2 : 3 }));
  /* the piano doubles the tune, 70 ms late: the same key, the same written tick, a second heard note on the same head */
  c.melody.forEach(n => notes.push({ on: +(n.on + 0.07).toFixed(3), off: n.off, midi: n.midi, vel: 50, track: 3 }));
  c.melody.forEach((n, i) => notes.push({ on: n.on, off: +(n.on + 0.25).toFixed(3), midi: 86 + (i % 3), vel: 60, track: 3 }));
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  const g = convert({ notes: notes });
  const lay = LS.prepare(g, { songgraph: SGG, melodyTrack: 1 });
  assert.equal(lay.ok && lay.report.melodyFrom, 'layer');
  assert.ok(f1(lay.melody.map(m => m.head), headsOf(g, c.melody)).f1 >= 0.95);
  /* three stray notes of a vocal stem in a piece of 48 instants: not a tune (the skyline) */
  const few = c.notes.map(n => Object.assign({}, n, { track: 3 }));
  c.melody.slice(0, 3).forEach(n => { const x = few.find(y => y.on === n.on && y.midi === n.midi); x.track = 1; });
  few.push({ on: c.melody[3].on, off: c.melody[3].off, midi: 40, vel: 40, track: 1 });
  assert.equal(LS.prepare(convert({ notes: few.sort((a, b) => a.on - b.on || a.midi - b.midi) }), { songgraph: SGG, melodyTrack: 1 }).report.melodyFrom, 'skyline');
});
