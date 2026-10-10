/* toMusicXml with opts.songLayers (the home PC's song mode: each heard note's track is its layer, 1 the melody, 2 the bass,
   3 the accompaniment): the melody is the upper staff, the bass and the accompaniment the lower one, the accompaniment one
   chord a beat in C3-E4; a melody note heard an octave away from the tune is written in the tune's octave; and the key
   stage spells a song's pitch with a double sharp only when the other neighbour needs one too. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const KEY = require(path.join(REPO, 'rec', 'key.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* 16 bars of 4/4 at 120 (2 s a bar) in F# major: a short eighth-note melody (a guitar lead: 0.12 s notes) in the treble,
   with one note of bar 5 heard two octaves low; a bass on every half bar; a strummed accompaniment in the melody's own
   register, four short 16th-note strums a beat */
function song() {
  const notes = [];
  const tune = [78, 80, 82, 83, 85, 83, 82, 80];
  const chords = [[70, 73, 78], [71, 75, 78], [73, 77, 80], [70, 73, 78]];
  for (let b = 0; b < 16; b++) {
    const t0 = 1 + b * 2;
    tune.forEach((p, k) => notes.push({ on: t0 + k * 0.25, off: t0 + k * 0.25 + 0.12, midi: b === 4 && k === 2 ? p - 24 : p, vel: 100, track: 1 }));
    notes.push({ on: t0, off: t0 + 0.4, midi: 42, vel: 100, track: 2 });
    notes.push({ on: t0 + 1, off: t0 + 1.4, midi: 49, vel: 100, track: 2 });
    for (let s = 0; s < 16; s++) chords[b % 4].forEach(p => notes.push({ on: t0 + s * 0.125 + 0.0625, off: t0 + s * 0.125 + 0.15, midi: p, vel: 100, track: 3 }));
  }
  return notes;
}

/* the written notes of a MusicXML file: {midi, staff, tick} (a chord's notes share the tick of its first) */
function written(xml) {
  const out = [];
  let tick = 0, last = 0, div = 1;
  const d = /<divisions>(\d+)<\/divisions>/.exec(xml);
  if (d) div = +d[1];
  xml.split('<measure').slice(1).forEach(mx => {
    let t = 0, prev = 0;
    (mx.match(/<note\b[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>|<forward>[\s\S]*?<\/forward>/g) || []).forEach(n => {
      const dur = +((/<duration>(\d+)<\/duration>/.exec(n) || [0, 0])[1]);
      if (n.startsWith('<backup')) { t -= dur; return; }
      if (n.startsWith('<forward')) { t += dur; return; }
      const chord = /<chord\s*\/>/.test(n);
      const at = chord ? prev : t;
      if (!chord) { prev = t; t += dur; }
      const p = /<step>(\w)<\/step>\s*(?:<alter>(-?\d+)<\/alter>)?\s*<octave>(\d)<\/octave>/.exec(n);
      if (!p) return;
      out.push({ midi: (+p[3] + 1) * 12 + STEP[p[1]] + (+(p[2] || 0)), alter: +(p[2] || 0), staff: +((/<staff>(\d)<\/staff>/.exec(n) || [0, 1])[1]), tick: tick + at / div });
    });
    const m = /<time>[\s\S]*?<beats>(\d+)<\/beats>/.exec(mx);
    if (m) last = +m[1];
    tick += last || 4;
  });
  return out;
}

test('songLayers: the melody alone is the upper staff, held over the short gaps of a guitar lead', () => {
  const notes = song();
  const built = AS.toMusicXml({ notes: notes, pedals: [] }, Object.assign({ songLayers: true }, v2));
  assert.equal(built.stats.rh, notes.filter(n => n.track === 1).length);
  const w = written(built.xml);
  const upper = w.filter(n => n.staff === 1);
  assert.ok(upper.every(n => n.midi >= 70), 'no accompaniment note on the upper staff: ' + upper.filter(n => n.midi < 70).map(n => n.midi));
  /* no rest between the eighths of the tune: a 0.12 s note is written as the eighth it starts */
  const rests = (built.xml.match(/<note\b[\s\S]*?<\/note>/g) || []).filter(n => /<rest\b/.test(n) && /<staff>1<\/staff>/.test(n)).length;
  assert.ok(rests <= 4, 'upper-staff rests: ' + rests);
});

test('songLayers: the accompaniment is one chord a beat of at most three notes in C3-E4, below the bass and chords nothing else', () => {
  const built = AS.toMusicXml({ notes: song(), pedals: [] }, Object.assign({ songLayers: true }, v2));
  const lower = written(built.xml).filter(n => n.staff === 2);
  const chordNotes = lower.filter(n => n.midi !== 42 && n.midi !== 49);
  assert.ok(chordNotes.length > 0);
  assert.ok(chordNotes.every(n => n.midi >= 48 && n.midi <= 64), 'outside C3-E4: ' + chordNotes.filter(n => n.midi < 48 || n.midi > 64).map(n => n.midi));
  const perTick = new Map();
  chordNotes.forEach(n => perTick.set(n.tick, (perTick.get(n.tick) || 0) + 1));
  assert.ok(Array.from(perTick.values()).every(k => k <= 3));
  /* 64 strummed 16ths a bar became at most a chord a beat */
  assert.ok(perTick.size <= 16 * 4, 'chord onsets: ' + perTick.size);
  assert.ok(Array.from(perTick.keys()).every(t => Math.abs(t - Math.round(t)) < 1e-9), 'every chord on a beat');
});

test('songLayers: a melody note heard two octaves low is written in the tune\'s octave, and still linked to what was heard', () => {
  const built = AS.toMusicXml({ notes: song(), pedals: [] }, Object.assign({ songLayers: true }, v2));
  const upper = written(built.xml).filter(n => n.staff === 1);
  assert.ok(upper.every(n => n.midi >= 70 && n.midi <= 90), upper.map(n => n.midi).filter(m => m < 70 || m > 90).join(','));
  const pf = built.graph.performances[0];
  const melody = pf.notes.filter(n => n.track === 1);
  assert.equal(melody.filter(n => n.link).length, melody.length);
});

test('without songLayers the hands are the hand model\'s, as before', () => {
  const notes = song();
  const built = AS.toMusicXml({ notes: notes, pedals: [] }, v2);
  assert.notEqual(built.stats.rh, notes.filter(n => n.track === 1).length);
});

test('songLayers on notes without layers changes nothing', () => {
  const notes = song().map(n => ({ on: n.on, off: n.off, midi: n.midi, vel: n.vel }));
  const a = AS.toMusicXml({ notes: notes, pedals: [] }, v2);
  const b = AS.toMusicXml({ notes: notes, pedals: [] }, Object.assign({ songLayers: true }, v2));
  assert.equal(b.xml, a.xml);
});

test('spelling of a song: F# major\'s D and G are D and G natural, not C and F double-sharp; elsewhere the catalogue\'s raised fifth stays', () => {
  const fs = KEY.spellingTable({ fifths: 6, mode: 'major', tonic: 6 }, true);
  assert.deepEqual(fs[2], { step: 'D', alter: 0 });
  assert.deepEqual(fs[7], { step: 'G', alter: 0 });
  assert.deepEqual(KEY.spellingTable({ fifths: 6, mode: 'major', tonic: 6 })[2], { step: 'C', alter: 2 });
  const c = KEY.spellingTable({ fifths: 0, mode: 'major', tonic: 0 }, true);
  assert.deepEqual(c[8], { step: 'G', alter: 1 });
  assert.deepEqual(c[10], { step: 'B', alter: -1 });
  Object.values(KEY.spellingTable({ fifths: 7, mode: 'major', tonic: 1 }, true)).forEach(s => assert.ok(Math.abs(s.alter) <= 2));
  const xml = AS.toMusicXml({ notes: song(), pedals: [] }, Object.assign({ songLayers: true }, v2)).xml;
  assert.ok(!/<alter>2<\/alter>/.test(xml), 'a double sharp in F# major');
});
