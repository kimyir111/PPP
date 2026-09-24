#!/usr/bin/env node
/* Writes tests/scoregraph/fixtures/{valid,invalid}/ (docs/GOALS/G01 §16.3, §16.4, A5-A7).

     node tests/scoregraph/tools/make-fixtures.js

   Each fixture is a small hand-built graph, and its sidecar (*.expect.json) states what the specification
   says the validator must report: the expected codes below are written by hand next to the edit that causes
   them, never computed by running the validator. An invalid fixture breaks exactly one rule. Valid fixtures
   are written in canonical form (.sg.json); invalid ones as plain JSON (.json), since most of them are not
   ScoreGraph documents at all.

   Rerun after changing a fixture here; commit the fixtures with the change. */
'use strict';
const fs = require('fs');
const path = require('path');
const SG = require('../../../scoregraph/index.js');

const ROOT = path.resolve(__dirname, '..', 'fixtures');
const clone = x => JSON.parse(JSON.stringify(x));
const written = [];

function write(dir, name, doc, expect) {
  const base = path.join(ROOT, dir, name);
  if (dir === 'valid') fs.writeFileSync(base + '.sg.json', SG.serialize(doc));
  else fs.writeFileSync(base + '.json', JSON.stringify(doc, null, 1) + '\n');
  fs.writeFileSync(base + '.expect.json', JSON.stringify(expect, null, 1) + '\n');
  written.push(dir + '/' + name);
}

/* ------------------------------------------------------------------ the base graph
   One piano part, two 4/4 measures, a voice per staff, a C5 half note tied to a C5 half note, a whole-bar
   rest in the bass, and a second measure of whole notes. No warning: every measure is full, every staff has a
   clef, the tie joins two C5s that meet. */
function base() {
  return {
    scoregraph_version: 1, id: 'fx-base', rev: 0, nextId: 30,
    meta: { title: 'Fixture' },
    timeline: {
      measures: [{ id: 'm1', number: '1', dur: '1' }, { id: 'm2', number: '2', dur: '1' }],
      meters: [{ id: 'mt3', m: 'm1', beats: [4], beatType: 4 }],
      keys: [{ id: 'ky4', m: 'm1', at: '0', fifths: 0, mode: 'major' }],
      tempos: [{ id: 'tp5', m: 'm1', at: '0', qpm: '120' }]
    },
    parts: [{
      id: 'p6', name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' },
      staves: [{ id: 'st7', limb: 'RH' }, { id: 'st8', limb: 'LH' }],
      voices: [{ id: 'v9', staff: 'st7', label: '1' }, { id: 'v10', staff: 'st8', label: '5' }],
      clefs: [{ id: 'c11', staff: 'st7', m: 'm1', at: '0', sign: 'G' }, { id: 'c12', staff: 'st8', m: 'm1', at: '0', sign: 'F' }],
      events: [
        { id: 'e13', kind: 'note', m: 'm1', at: '0', dur: '1/2', voice: 'v9', staff: 'st7', display: { type: 'half' }, heads: [{ id: 'h14', pitch: { step: 'C', oct: 5 } }] },
        { id: 'e15', kind: 'note', m: 'm1', at: '1/2', dur: '1/2', voice: 'v9', staff: 'st7', display: { type: 'half' }, heads: [{ id: 'h16', pitch: { step: 'C', oct: 5 } }] },
        { id: 'e17', kind: 'rest', m: 'm1', at: '0', dur: '1', voice: 'v10', staff: 'st8', display: { type: 'whole', measureRest: true } },
        { id: 'e20', kind: 'note', m: 'm2', at: '0', dur: '1', voice: 'v9', staff: 'st7', display: { type: 'whole' }, heads: [{ id: 'h21', pitch: { step: 'C', oct: 5 } }] },
        { id: 'e22', kind: 'note', m: 'm2', at: '0', dur: '1', voice: 'v10', staff: 'st8', display: { type: 'whole' }, heads: [{ id: 'h23', pitch: { step: 'C', oct: 3 } }] }
      ],
      directions: [],
      spanners: [{ id: 's18', type: 'tie', from: 'h14', to: 'h16' }]
    }],
    provenance: { sources: [{ id: 'sr19', kind: 'user' }], default: { src: 'sr19', op: 'edited' } }
  };
}
const P = g => g.parts[0];
const ev = (g, id) => P(g).events.find(e => e.id === id);
const measure = (g, id) => g.timeline.measures.find(m => m.id === id);
/* a second part (for scope rules): its own staff, voice, clef and a whole-bar rest in each measure */
function withSecondPart(g) {
  g.parts.push({
    id: 'p24', name: 'Voice', instrument: { kind: 'voice', family: 'voice' },
    staves: [{ id: 'st25' }], voices: [{ id: 'v26', staff: 'st25', label: '1' }],
    clefs: [{ id: 'c27', staff: 'st25', m: 'm1', at: '0', sign: 'G' }],
    events: [
      { id: 'e28', kind: 'rest', m: 'm1', at: '0', dur: '1', voice: 'v26', staff: 'st25', display: { type: 'whole', measureRest: true } },
      { id: 'e29', kind: 'rest', m: 'm2', at: '0', dur: '1', voice: 'v26', staff: 'st25', display: { type: 'whole', measureRest: true } }
    ],
    directions: [], spanners: []
  });
  return g;
}

/* ================================================================== invalid: one ERROR each (A5) */
const invalid = [
  ['E-VERSION', 'a scoregraph_version this code does not know (2)', g => { g.scoregraph_version = 2; }],
  ['E-VERSION', 'no scoregraph_version at all', g => { delete g.scoregraph_version; }, 'E-VERSION-missing'],
  ['E-SHAPE', 'a field the schema does not have (event.color)', g => { ev(g, 'e20').color = 'red'; }],
  ['E-SHAPE', 'null instead of leaving a field out', g => { ev(g, 'e20').hidden = null; }, 'E-SHAPE-null'],
  ['E-SHAPE', 'an enum value the schema does not have (a clef sign "X")', g => { P(g).clefs[1].sign = 'X'; }, 'E-SHAPE-enum'],
  ['E-ID-FORMAT', 'an ID whose prefix is not its kind\'s ("dx31" for a direction)', g => {
    P(g).directions.push({ id: 'dx31', kind: 'words', m: 'm1', at: '0', text: 'dolce' }); g.nextId = 32; }],
  ['E-ID-DUPLICATE', 'the number 11 used twice (clef c11 and direction d11)', g => {
    P(g).directions.push({ id: 'd11', kind: 'words', m: 'm1', at: '0', text: 'dolce' }); }],
  ['E-ID-COUNTER', 'nextId 10 while IDs go up to 23', g => { g.nextId = 10; }],
  ['E-REF-MISSING', 'an event in a voice that does not exist (v99)', g => { ev(g, 'e20').voice = 'v99'; }],
  ['E-REF-MISSING', 'a staff reference that names a voice (the wrong kind)', g => { P(g).clefs[1].staff = 'v10'; }, 'E-REF-MISSING-kind'],
  ['E-REF-SCOPE', 'a second part\'s event in the first part\'s voice v9', g => { withSecondPart(g); g.parts[1].events[1].voice = 'v9'; }],
  ['E-RATIONAL', 'a duration that is not reduced ("4/4")', g => { ev(g, 'e20').dur = '4/4'; }],
  ['E-RATIONAL', 'a position with a denominator 1 ("0/1")', g => { ev(g, 'e20').at = '0/1'; }, 'E-RATIONAL-form'],
  ['E-DURATION', 'a note that lasts 0 and is not a grace note', g => { ev(g, 'e22').dur = '0'; }],
  ['E-DURATION', 'a measure that lasts 0', g => { measure(g, 'm2').dur = '0'; P(g).events = P(g).events.filter(e => e.m !== 'm2'); }, 'E-DURATION-measure'],
  ['E-POSITION', 'a note at the end of its measure (at == dur)', g => { ev(g, 'e22').at = '1'; }],
  ['E-SPAN-ORDER', 'a wedge that ends before it starts', g => {
    P(g).spanners.push({ id: 's31', type: 'wedge', kind: 'crescendo', from: { m: 'm1', at: '1/2' }, to: { m: 'm1', at: '1/4' } }); g.nextId = 32; }],
  ['E-MEASURE-OVERFLOW', 'a note that runs past its bar line', g => { ev(g, 'e15').dur = '1'; ev(g, 'e15').display.type = 'whole'; }],
  ['E-VOICE-OVERLAP', 'two notes of one voice that overlap', g => {
    P(g).events.push({ id: 'e31', kind: 'note', m: 'm2', at: '1/2', dur: '1/4', voice: 'v10', staff: 'st8', display: { type: 'quarter' }, heads: [{ id: 'h32', pitch: { step: 'E', oct: 3 } }] });
    g.nextId = 33; }],
  ['E-VOICE-STAFF', 'a note on a staff of another part', g => { withSecondPart(g); ev(g, 'e22').staff = 'st25'; }],
  ['E-HEADS', 'a note with no heads', g => { ev(g, 'e22').heads = []; }],
  ['E-HEADS', 'the same pitch twice in one chord', g => { ev(g, 'e22').heads.push({ id: 'h31', pitch: { step: 'C', oct: 3 } }); g.nextId = 32; }, 'E-HEADS-twice'],
  ['E-TIE-PITCH', 'a complete tie from C5 to D5', g => { ev(g, 'e15').heads[0].pitch = { step: 'D', oct: 5 }; }],
  ['E-TIE-TIME', 'a complete tie to a note that does not start where the tied note ends', g => { P(g).spanners[0].to = 'h21'; }],
  ['E-TIE-CHAIN', 'two ties leave one head', g => {
    P(g).voices.push({ id: 'v31', staff: 'st7', label: '2' });
    P(g).events.push({ id: 'e32', kind: 'note', m: 'm1', at: '1/2', dur: '1/2', voice: 'v31', staff: 'st7', display: { type: 'half' }, heads: [{ id: 'h33', pitch: { step: 'C', oct: 5 } }] });
    P(g).spanners.push({ id: 's34', type: 'tie', from: 'h14', to: 'h33' }); g.nextId = 35; }],
  ['E-TUPLET', 'a tuplet ratio 0:2', g => { P(g).spanners.push({ id: 's31', type: 'tuplet', events: ['e20'], actual: 0, normal: 2 }); g.nextId = 32; }],
  ['E-METER', 'a beat type that is not a power of two (4/3)', g => { g.timeline.meters[0].beatType = 3; }],
  ['E-KEY', 'eight sharps', g => { g.timeline.keys[0].fifths = 8; }],
  ['E-TEMPO', 'a tempo of 0 quarters a minute', g => { g.timeline.tempos[0].qpm = '0'; }],
  ['E-ENDING', 'an ending with no numbers', g => { g.timeline.endings = [{ id: 'en31', numbers: [], from: 'm2', to: 'm2' }]; g.nextId = 32; }],
  ['E-REPEAT', 'a backward repeat on a left bar line', g => { measure(g, 'm2').barline = { left: { repeat: 'backward' } }; }],
  ['E-UNROLL-RUNAWAY', 'a first bar repeated 200 times: 201 visits of 2 measures (limit 2 x 64)', g => {
    measure(g, 'm1').barline = { right: { style: 'light-heavy', repeat: 'backward', times: 200 } }; }],
  ['E-ARPEGGIO', 'an arpeggio over heads at two onsets', g => { P(g).spanners.push({ id: 's31', type: 'arpeggio', heads: ['h14', 'h23'] }); g.nextId = 32; }],
  ['E-PERC-KIT', 'a percussion event in a part without a kit', g => {
    ev(g, 'e22').kind = 'perc'; ev(g, 'e22').heads = [{ id: 'h23', inst: 'snare' }]; }],
  ['E-PITCH-RANGE', 'G##9 sounds MIDI 129', g => { ev(g, 'e20').heads[0].pitch = { step: 'G', alter: 2, oct: 9 }; }],
  ['E-STRUCTURE', 'a section that ends before it starts', g => { g.structure = { sections: [{ id: 'sc31', from: 'm2', to: 'm1' }] }; g.nextId = 32; }],
  ['E-PERF', 'a performed note released before it is pressed', g => {
    g.performances = [{ id: 'pf31', kind: 'take', notes: [{ id: 'pn32', on: 2000000, off: 1000000, vel: 60, midi: 72 }] }]; g.nextId = 33; }],
  ['E-PERF', 'anchors that go back in time', g => {
    g.performances = [{ id: 'pf31', kind: 'take', notes: [], anchors: [{ m: 'm1', k: 1, at: '0', us: 2000000 }, { m: 'm2', k: 1, at: '0', us: 1000000 }] }]; g.nextId = 32; }, 'E-PERF-anchors'],
  ['E-PROV', 'a default provenance naming a source that does not exist', g => { g.provenance.default.src = 'sr99'; }],
  ['E-PROV', 'a confidence with four decimals', g => { ev(g, 'e20').prov = { conf: 0.1234 }; }, 'E-PROV-conf']
];
invalid.forEach(([code, about, edit, name]) => {
  const g = base();
  edit(g);
  write('invalid', name || code, g, { about: about, spec: 'G01 §13.2 ' + code, expect: { errors: [code] } });
});

/* ================================================================== valid: one WARNING each (A6) */
const warn = [
  ['W-MEASURE-LENGTH', 'a second 4/4 measure that lasts 3/4, not implicit and not a pickup complement', g => {
    measure(g, 'm2').dur = '3/4';
    ev(g, 'e20').dur = '3/4'; ev(g, 'e20').display = { type: 'half', dots: 1 };
    ev(g, 'e22').dur = '3/4'; ev(g, 'e22').display = { type: 'half', dots: 1 }; }],
  ['W-DISPLAY-DURATION', 'a half note printed as a quarter (issue 19)', g => { ev(g, 'e13').display.type = 'quarter'; }],
  ['W-TUPLET-INCOMPLETE', 'a triplet-eighth bracket holding two of its three notes (and a rest of the rest of the beat)', g => {
    P(g).events = P(g).events.filter(e => e.id !== 'e20');
    P(g).events.push(
      { id: 'e31', kind: 'note', m: 'm2', at: '0', dur: '1/12', voice: 'v9', staff: 'st7', display: { type: 'eighth' }, heads: [{ id: 'h32', pitch: { step: 'C', oct: 5 } }] },
      { id: 'e33', kind: 'note', m: 'm2', at: '1/12', dur: '1/12', voice: 'v9', staff: 'st7', display: { type: 'eighth' }, heads: [{ id: 'h34', pitch: { step: 'D', oct: 5 } }] },
      { id: 'e35', kind: 'rest', m: 'm2', at: '1/6', dur: '1/12', voice: 'v9', staff: 'st7' },
      { id: 'e36', kind: 'rest', m: 'm2', at: '1/4', dur: '3/4', voice: 'v9', staff: 'st7', display: { type: 'half', dots: 1 } });
    P(g).spanners.push({ id: 's37', type: 'tuplet', events: ['e31', 'e33'], actual: 3, normal: 2, unit: { type: 'eighth' } });
    g.nextId = 38; }],
  ['W-TIE-OPEN', 'a tie with only its start (a converter that wrote no stop, issue 10)', g => { delete P(g).spanners[0].to; }],
  ['W-SLUR-OPEN', 'a slur with only its end', g => { P(g).spanners.push({ id: 's31', type: 'slur', to: 'e20' }); g.nextId = 32; }],
  ['W-PEDAL-OPEN', 'a damper pedal pressed and never released', g => { P(g).spanners.push({ id: 's31', type: 'pedal', pedal: 'damper', from: { m: 'm1', at: '0' } }); g.nextId = 32; }],
  ['W-TEMPO-MARK-MISMATCH', 'qpm 120 under a printed dotted quarter = 120 (180 quarters: issue 1)', g => {
    g.timeline.tempos[0].mark = { unit: 'quarter', dots: 1, perMinute: '120' }; }],
  ['W-CLEF-MISSING', 'the bass staff has no clef', g => { P(g).clefs = P(g).clefs.slice(0, 1); }],
  ['W-OTTAVA-OVERLAP', 'two ottavas overlapping on the treble staff', g => {
    P(g).spanners.push({ id: 's31', type: 'ottava', staff: 'st7', shift: 1, from: { m: 'm1', at: '0' }, to: { m: 'm2', at: '0' } },
      { id: 's32', type: 'ottava', staff: 'st7', shift: 2, from: { m: 'm1', at: '1/2' }, to: { m: 'm2', at: '1/2' } });
    g.nextId = 33; }],
  ['W-HEAD-UNISON', 'C#5 and Db5 in one chord', g => {
    ev(g, 'e20').heads = [{ id: 'h21', pitch: { step: 'C', alter: 1, oct: 5 } }, { id: 'h31', pitch: { step: 'D', alter: -1, oct: 5 } }]; g.nextId = 32; }],
  ['W-GRACE-ORPHAN', 'a grace note after the last note of a measure, with no main note', g => {
    P(g).voices.push({ id: 'v31', staff: 'st7', label: '2' });
    P(g).events.push({ id: 'e32', kind: 'note', m: 'm2', at: '1/2', dur: '0', voice: 'v31', staff: 'st7', grace: { order: 1 }, display: { type: 'eighth' }, heads: [{ id: 'h33', pitch: { step: 'D', oct: 5 } }] });
    g.nextId = 34; }],
  ['W-REPEAT-DANGLING', 'a forward repeat no backward repeat ever goes back to (G0 PF-M1)', g => { measure(g, 'm2').barline = { left: { style: 'heavy-light', repeat: 'forward' } }; }],
  ['W-ENDING-NO-REPEAT', 'a first ending with no backward repeat at its end', g => { g.timeline.endings = [{ id: 'en31', numbers: [1], from: 'm2', to: 'm2' }]; g.nextId = 32; }],
  ['W-PERF-LINK-PITCH', 'a performed D5 linked to a written C5', g => {
    g.performances = [{ id: 'pf31', kind: 'take', notes: [{ id: 'pn32', on: 0, off: 900000, vel: 64, midi: 74, link: 'h14' }] }]; g.nextId = 33; }],
  /* G3 (G03 §18.2) */
  ['W-BEAM-SHAPE', 'a beam over the two half notes of the first measure: a beam holds eighths or shorter (G03 §11.2)', g => {
    P(g).spanners.push({ id: 's31', type: 'beam', events: ['e13', 'e15'] }); g.nextId = 32; }],
  ['W-TUPLET-DISPLAY', 'a triplet-eighth bracket (3 × 1/8) whose one member is printed as a half note, longer than the bracket (G03 §18.2)', g => {
    P(g).events = P(g).events.filter(e => e.id !== 'e20');
    P(g).events.push(
      { id: 'e31', kind: 'note', m: 'm2', at: '0', dur: '1/12', voice: 'v9', staff: 'st7', display: { type: 'half' }, heads: [{ id: 'h32', pitch: { step: 'C', oct: 5 } }] },
      { id: 'e33', kind: 'note', m: 'm2', at: '1/12', dur: '1/6', voice: 'v9', staff: 'st7', display: { type: 'quarter' }, heads: [{ id: 'h34', pitch: { step: 'D', oct: 5 } }] },
      { id: 'e35', kind: 'rest', m: 'm2', at: '1/4', dur: '3/4', voice: 'v9', staff: 'st7', display: { type: 'half', dots: 1 } });
    P(g).spanners.push({ id: 's36', type: 'tuplet', events: ['e31', 'e33'], actual: 3, normal: 2, unit: { type: 'eighth' } });
    g.nextId = 37; }]
];
warn.forEach(([code, about, edit]) => {
  const g = base();
  edit(g);
  write('valid', 'warn-' + code.slice(2).toLowerCase(), g, { about: about, spec: 'G01 §13.2 ' + code, expect: { warnings: { [code]: 1 } } });
});
/* two warnings the edits above also cause, and nothing else */
{
  const f = path.join(ROOT, 'valid', 'warn-tuplet-incomplete.expect.json');
  const x = JSON.parse(fs.readFileSync(f, 'utf8'));
  x.about += '. The two triplet eighths are printed right (1/8 x 2/3 = 1/12); the 1/12 rest has no printed value.';
  fs.writeFileSync(f, JSON.stringify(x, null, 1) + '\n');
}
{
  const f = path.join(ROOT, 'valid', 'warn-tuplet-display.expect.json');
  const x = JSON.parse(fs.readFileSync(f, 'utf8'));
  x.about += '. The half note also lasts 1/12, not its printed 1/3: W-DISPLAY-DURATION too.';
  x.expect.warnings = { 'W-DISPLAY-DURATION': 1, 'W-TUPLET-DISPLAY': 1 };
  fs.writeFileSync(f, JSON.stringify(x, null, 1) + '\n');
}

/* ================================================================== valid: the topics of §16.3 (A7) */
const B = (id, title) => SG.builder({ id: id, meta: { title: title }, source: { kind: 'user' }, default: { op: 'edited' } });
const setDefaultSrc = b => { b.setDefault({ src: b.doc.provenance.sources[0].id, op: 'edited' }); };
function pianoPart(b, name) {
  const p = b.part({ name: name || 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const st1 = b.staff(p, { limb: 'RH' }).id, st2 = b.staff(p, { limb: 'LH' }).id;
  return { p: p, st1: st1, st2: st2 };
}
const note = (m, at, dur, voice, staff, type, heads, extra) =>
  Object.assign({ kind: 'note', m: m, at: at, dur: dur, voice: voice, staff: staff, display: typeof type === 'string' ? { type: type } : type, heads: heads }, extra || {});
const rest = (m, at, dur, voice, staff, type, extra) =>
  Object.assign({ kind: 'rest', m: m, at: at, dur: dur, voice: voice, staff: staff }, type ? { display: typeof type === 'string' ? { type: type } : type } : {}, extra || {});
const pc = (step, oct, alter) => (alter ? { pitch: { step: step, alter: alter, oct: oct } } : { pitch: { step: step, oct: oct } });
const topics = [];
const topic = (name, about, spec, make, expectWarnings) => topics.push([name, about, spec, make, expectWarnings || {}]);

/* the specification's own example (Appendix C.1), copied as it is printed */
function waltz() {
  const text = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'docs', 'GOALS', 'G01_SCOREGRAPH.md'), 'utf8');
  const at = text.indexOf('### C.1');
  const a = text.indexOf('```json', at) + 7, z = text.indexOf('```', a);
  return JSON.parse(text.slice(a, z));
}
topic('piano-waltz', 'Appendix C.1: 3/4 pickup, repeat and volta, triplet, tie, damper pedal with a change, a take with anchors',
  'G01 Appendix C.1', () => waltz());

topic('drums-with-piano', 'Appendix C.1 with the drum part of C.2: kit of 8, two voices, all four limbs, a two-head hit, a flam, a render performance',
  'G01 §9, Appendix C.2, A25', () => {
    const g = waltz();
    g.provenance.sources.push({ id: 'sr70', kind: 'generator', tool: 'arrangement-planner' });
    g.parts.push({
      id: 'p54', name: 'Drum Set',
      instrument: { kind: 'drumset', family: 'percussion', midi: { channel: 10 }, kit: { items: [
        { key: 'kick', name: 'Bass Drum', gm: 36, pos: { step: 'F', oct: 4 } }, { key: 'snare', name: 'Snare', gm: 38, pos: { step: 'C', oct: 5 } },
        { key: 'hh-closed', gm: 42, pos: { step: 'G', oct: 5 }, notehead: 'x' }, { key: 'hh-open', gm: 46, pos: { step: 'G', oct: 5 }, notehead: 'circle-x' },
        { key: 'hh-pedal', gm: 44, pos: { step: 'D', oct: 4 }, notehead: 'x' }, { key: 'crash', gm: 49, pos: { step: 'A', oct: 5 }, notehead: 'x' },
        { key: 'ride', gm: 51, pos: { step: 'F', oct: 5 }, notehead: 'x' }, { key: 'tom-hi', gm: 50, pos: { step: 'E', oct: 5 } }] } },
      staves: [{ id: 'st55', kind: 'percussion' }],
      voices: [{ id: 'v56', staff: 'st55', label: '1' }, { id: 'v57', staff: 'st55', label: '2', limb: 'RF' }],
      clefs: [{ id: 'c58', staff: 'st55', m: 'm7', at: '0', sign: 'percussion' }],
      events: [
        { id: 'e59', kind: 'perc', m: 'm8', at: '0', dur: '1/4', voice: 'v56', staff: 'st55', display: { type: 'quarter', stem: 'up' }, heads: [{ id: 'h60', inst: 'crash', limb: 'RH' }] },
        { id: 'e61', kind: 'perc', m: 'm8', at: '1/4', dur: '1/4', voice: 'v56', staff: 'st55', display: { type: 'quarter', stem: 'up' }, heads: [{ id: 'h62', inst: 'snare', limb: 'LH' }, { id: 'h63', inst: 'hh-closed', limb: 'RH' }] },
        { id: 'e64', kind: 'perc', m: 'm8', at: '1/2', dur: '1/4', voice: 'v56', staff: 'st55', display: { type: 'quarter', stem: 'up' }, heads: [{ id: 'h65', inst: 'snare', limb: 'LH', stroke: 'flam' }, { id: 'h66', inst: 'hh-closed', limb: 'RH' }] },
        { id: 'e67', kind: 'perc', m: 'm8', at: '0', dur: '1/4', voice: 'v57', staff: 'st55', display: { type: 'quarter', stem: 'down' }, heads: [{ id: 'h68', inst: 'kick' }] },
        { id: 'e71', kind: 'perc', m: 'm8', at: '1/4', dur: '1/4', voice: 'v57', staff: 'st55', display: { type: 'quarter', stem: 'down' }, heads: [{ id: 'h72', inst: 'hh-pedal', limb: 'LF' }] },
        { id: 'e69', kind: 'rest', m: 'm8', at: '1/2', dur: '1/4', voice: 'v57', staff: 'st55', display: { type: 'quarter' } }
      ],
      directions: [], spanners: [], prov: { src: 'sr70', op: 'generated' }
    });
    g.performances.push({ id: 'pf73', kind: 'render', src: 'sr70', notes: [
      { id: 'pn74', on: 1625000, off: 1700000, vel: 100, inst: 'crash', part: 'p54', link: 'h60' },
      { id: 'pn75', on: 1625000, off: 1700000, vel: 90, inst: 'kick', part: 'p54', link: 'h68' }] });
    g.nextId = 76;
    return g;
  });

topic('pickup', '3/4 with an implicit quarter pickup and a two-beat last measure that completes it (§6.3, §6.4)', 'G01 §6.3, A16', () => {
  const b = B('fx-pickup', 'Pickup'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m0 = b.measure({ number: '0', dur: '1/4', implicit: true }).id, m1 = b.measure({ number: '1', dur: '3/4' }).id, m2 = b.measure({ number: '2', dur: '1/2' }).id;
  b.meter({ m: m0, beats: [3], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m0, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m0, at: '0', sign: 'F' });
  b.event(pp.p, note(m0, '0', '1/4', v1, pp.st1, 'quarter', [pc('D', 5)]));
  b.event(pp.p, note(m1, '0', '3/4', v1, pp.st1, { type: 'half', dots: 1 }, [pc('G', 5)]));
  b.event(pp.p, note(m2, '0', '1/2', v1, pp.st1, 'half', [pc('G', 4)]));
  return b.finish().graph;
});
topic('tuplets-nested', 'one 4/4 bar: triplet eighths, a 5:4 of sixteenths, a 6:4 of sixteenths, and a 5:4 with a 3:2 of 32nds inside (§6.5)', 'G01 §6.5, A3', () => {
  const b = B('fx-tuplets', 'Tuplets'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  const ids = (list) => list.map(x => b.event(pp.p, x).id);
  const steps = ['C', 'D', 'E', 'F', 'G', 'A'];
  const t3 = ids([0, 1, 2].map(i => note(m1, ['0', '1/12', '1/6'][i], '1/12', v1, pp.st1, 'eighth', [pc(steps[i], 5)])));
  b.spanner(pp.p, { type: 'tuplet', events: t3, actual: 3, normal: 2, unit: { type: 'eighth' } });
  const t5 = ids([0, 1, 2, 3, 4].map(i => note(m1, ['1/4', '3/10', '7/20', '2/5', '9/20'][i], '1/20', v1, pp.st1, '16th', [pc(steps[i], 5)])));
  b.spanner(pp.p, { type: 'tuplet', events: t5, actual: 5, normal: 4, unit: { type: '16th' } });
  const t6 = ids([0, 1, 2, 3, 4, 5].map(i => note(m1, ['1/2', '13/24', '7/12', '5/8', '2/3', '17/24'][i], '1/24', v1, pp.st1, '16th', [pc(steps[i], 5)])));
  b.spanner(pp.p, { type: 'tuplet', events: t6, actual: 6, normal: 4, unit: { type: '16th' } });
  const outer = ids([
    note(m1, '3/4', '1/20', v1, pp.st1, '16th', [pc('C', 6)]), note(m1, '4/5', '1/20', v1, pp.st1, '16th', [pc('D', 6)]),
    note(m1, '17/20', '1/60', v1, pp.st1, '32nd', [pc('E', 6)]), note(m1, '13/15', '1/60', v1, pp.st1, '32nd', [pc('F', 6)]),
    note(m1, '53/60', '1/60', v1, pp.st1, '32nd', [pc('G', 6)]),
    note(m1, '9/10', '1/20', v1, pp.st1, '16th', [pc('A', 6)]), note(m1, '19/20', '1/20', v1, pp.st1, '16th', [pc('B', 6)])]);
  const parent = b.spanner(pp.p, { type: 'tuplet', events: outer, actual: 5, normal: 4, unit: { type: '16th' } });
  b.spanner(pp.p, { type: 'tuplet', events: outer.slice(2, 5), actual: 3, normal: 2, unit: { type: '32nd' }, parent: parent.id });
  return b.finish().graph;
});
topic('voices-4', 'two voices on each staff of a grand staff, each filling the bar', 'G01 §8.1, A21', () => {
  const b = B('fx-voices', 'Four voices'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id, v2 = b.voice(pp.p, { staff: pp.st1, label: '2' }).id;
  const v5 = b.voice(pp.p, { staff: pp.st2, label: '5' }).id, v6 = b.voice(pp.p, { staff: pp.st2, label: '6' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1/2', v1, pp.st1, { type: 'half', stem: 'up' }, [pc('E', 5)]));
  b.event(pp.p, note(m1, '1/2', '1/2', v1, pp.st1, { type: 'half', stem: 'up' }, [pc('F', 5)]));
  b.event(pp.p, note(m1, '0', '1', v2, pp.st1, { type: 'whole', stem: 'down' }, [pc('C', 5)]));
  b.event(pp.p, note(m1, '0', '1', v5, pp.st2, { type: 'whole', stem: 'up' }, [pc('G', 3)]));
  b.event(pp.p, rest(m1, '0', '1/2', v6, pp.st2, 'half'));
  b.event(pp.p, note(m1, '1/2', '1/2', v6, pp.st2, { type: 'half', stem: 'down' }, [pc('C', 3)]));
  return b.finish().graph;
});
topic('cross-staff', 'a treble voice writing one event on the bass staff, a chord with one head on the other staff, an arpeggio over both staves, and limbs from staff, voice and head (§8.2, §8.3)', 'G01 §8, A21, A24', () => {
  const b = B('fx-cross', 'Cross staff'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id, v5 = b.voice(pp.p, { staff: pp.st2, label: '5' }).id;
  const v2 = b.voice(pp.p, { staff: pp.st1, label: '2', limb: 'LH' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  const a = b.event(pp.p, note(m1, '0', '1/4', v1, pp.st1, 'quarter', [pc('C', 5), Object.assign(pc('G', 3), { staff: pp.st2 })]));
  b.event(pp.p, note(m1, '1/4', '1/4', v1, pp.st2, 'quarter', [pc('A', 3)]));
  b.event(pp.p, note(m1, '1/2', '1/2', v1, pp.st1, 'half', [Object.assign(pc('E', 5), { limb: 'LH' })]));
  const bass = b.event(pp.p, note(m1, '0', '1', v5, pp.st2, 'whole', [pc('C', 3)]));
  b.event(pp.p, note(m1, '0', '1', v2, pp.st1, { type: 'whole', stem: 'down' }, [pc('E', 4)]));
  b.spanner(pp.p, { type: 'arpeggio', heads: [a.heads[0].id, a.heads[1].id, bass.heads[0].id], dir: 'up' });
  return b.finish().graph;
});
topic('tempo-meter-key', '4/4 at qpm 60, qpm 90 from the third beat of bar 2 (§6.8 example), a key change from G to E-flat in the middle of bar 2, then 6/8 and 3+2/8', 'G01 §6.4, §6.6, §6.8, A15', () => {
  const b = B('fx-tmk', 'Tempo, metre, key'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id, m2 = b.measure({ number: '2', dur: '1' }).id;
  const m3 = b.measure({ number: '3', dur: '3/4' }).id, m4 = b.measure({ number: '4', dur: '5/8' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 }); b.meter({ m: m3, beats: [6], beatType: 8 }); b.meter({ m: m4, beats: [3, 2], beatType: 8 });
  b.key({ m: m1, at: '0', fifths: 1, mode: 'major' }); b.key({ m: m2, at: '1/2', fifths: -3, mode: 'major' });
  b.tempo({ m: m1, at: '0', qpm: '60', mark: { unit: 'quarter', perMinute: '60' } });
  b.tempo({ m: m2, at: '1/2', qpm: '90', mark: { unit: 'quarter', perMinute: '90' } });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1', v1, pp.st1, 'whole', [pc('G', 4)]));
  b.event(pp.p, note(m2, '0', '1/2', v1, pp.st1, 'half', [pc('D', 5)]));
  b.event(pp.p, note(m2, '1/2', '1/2', v1, pp.st1, 'half', [pc('E', 5, -1)]));
  b.event(pp.p, note(m3, '0', '3/8', v1, pp.st1, { type: 'quarter', dots: 1 }, [pc('G', 4)]));
  b.event(pp.p, note(m3, '3/8', '3/8', v1, pp.st1, { type: 'quarter', dots: 1 }, [pc('B', 4, -1)]));
  b.event(pp.p, note(m4, '0', '3/8', v1, pp.st1, { type: 'quarter', dots: 1 }, [pc('E', 5, -1)]));
  b.event(pp.p, note(m4, '3/8', '1/4', v1, pp.st1, 'quarter', [pc('E', 4, -1)]));
  return b.finish().graph;
});
topic('transposing', 'a B-flat clarinet (sounds a tone below its page) and an electric bass (an octave below), pitches stored at concert (§7.2)', 'G01 §7.2, §9.1, A19', () => {
  const b = B('fx-transposing', 'Transposing'); setDefaultSrc(b);
  const cl = b.part({ name: 'Clarinet in Bb', instrument: { kind: 'clarinet', family: 'wind', transpose: { chromatic: -2, diatonic: -1 } } });
  const stc = b.staff(cl, {}).id;
  const vc = b.voice(cl, { staff: stc, label: '1' }).id;
  const bs = b.part({ name: 'Bass', instrument: { kind: 'electric-bass', family: 'plucked', transpose: { chromatic: 0, diatonic: 0, octave: -1 } } });
  const stb = b.staff(bs, {}).id;
  const vb = b.voice(bs, { staff: stb, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.key({ m: m1, at: '0', fifths: -2, mode: 'major' });
  b.clef(cl, { staff: stc, m: m1, at: '0', sign: 'G' }); b.clef(bs, { staff: stb, m: m1, at: '0', sign: 'F' });
  b.event(cl, note(m1, '0', '1/2', vc, stc, 'half', [pc('B', 4, -1)]));
  b.event(cl, note(m1, '1/2', '1/2', vc, stc, 'half', [pc('F', 5)]));
  b.event(bs, note(m1, '0', '1', vb, stb, 'whole', [pc('B', 1, -1)]));
  return b.finish().graph;
});
topic('grace', 'two grace notes (the first slashed) before a main note, at the main note\'s position with duration 0 (§7.5)', 'G01 §7.5, A23', () => {
  const b = B('fx-grace', 'Grace'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1/2', v1, pp.st1, 'half', [pc('C', 5)]));
  b.event(pp.p, note(m1, '1/2', '0', v1, pp.st1, 'eighth', [pc('E', 5)], { grace: { order: 1, slash: true } }));
  b.event(pp.p, note(m1, '1/2', '0', v1, pp.st1, 'eighth', [pc('F', 5)], { grace: { order: 2 } }));
  b.event(pp.p, note(m1, '1/2', '1/2', v1, pp.st1, 'half', [pc('E', 5)]));
  return b.finish().graph;
});
topic('ottava', '8va over the treble staff and 15mb under the bass: pitches stay at concert, the ottava only moves the display (§5.10)', 'G01 §5.10, §7.2, A20', () => {
  const b = B('fx-ottava', 'Ottava'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id, v5 = b.voice(pp.p, { staff: pp.st2, label: '5' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id, m2 = b.measure({ number: '2', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1', v1, pp.st1, 'whole', [pc('C', 7)]));
  b.event(pp.p, note(m2, '0', '1', v1, pp.st1, 'whole', [pc('C', 6)]));
  b.event(pp.p, note(m1, '0', '1', v5, pp.st2, 'whole', [pc('C', 1)]));
  b.event(pp.p, note(m2, '0', '1', v5, pp.st2, 'whole', [pc('C', 2)]));
  b.spanner(pp.p, { type: 'ottava', staff: pp.st1, shift: 1, from: { m: m1, at: '0' }, to: { m: m2, at: '0' } });
  b.spanner(pp.p, { type: 'ottava', staff: pp.st2, shift: -2, from: { m: m1, at: '0' }, to: { m: m2, at: '0' } });
  return b.finish().graph;
});
topic('directions', 'dynamics (in the staff and on a note), words, a rehearsal mark, chord symbols, a crescendo, a slur, articulations, ornaments and a fermata', 'G01 §5.6, §5.8, §5.10', () => {
  const b = B('fx-directions', 'Directions'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  const e1 = b.event(pp.p, note(m1, '0', '1/4', v1, pp.st1, 'quarter', [pc('C', 5)], { arts: ['staccato', 'accent'] }));
  const e2 = b.event(pp.p, note(m1, '1/4', '1/4', v1, pp.st1, 'quarter', [pc('D', 5)], { orn: [{ type: 'trill', acc: 'sharp' }] }));
  b.event(pp.p, note(m1, '1/2', '1/4', v1, pp.st1, 'quarter', [pc('E', 5)], { arts: ['marcato'] }));
  const e4 = b.event(pp.p, note(m1, '3/4', '1/4', v1, pp.st1, 'quarter', [pc('C', 5)], { fermata: {} }));
  b.direction(pp.p, { kind: 'dynamic', m: m1, at: '0', staff: pp.st1, placement: 'below', value: 'p' });
  b.direction(pp.p, { kind: 'dynamic', m: m1, at: '3/4', event: e4.id, value: 'other', text: 'sffz possible' });
  b.direction(pp.p, { kind: 'words', m: m1, at: '0', staff: pp.st1, placement: 'above', text: 'dolce' });
  b.direction(pp.p, { kind: 'rehearsal', m: m1, at: '0', text: 'A' });
  b.direction(pp.p, { kind: 'chord', m: m1, at: '0', root: { step: 'C' }, chordKind: 'major-seventh', bass: { step: 'E' }, text: 'Cmaj7/E' });
  b.direction(pp.p, { kind: 'chord', m: m1, at: '1/2', root: { step: 'F', alter: 1 }, chordKind: 'dominant', degrees: [{ value: 9, alter: -1, type: 'add' }] });
  b.spanner(pp.p, { type: 'wedge', kind: 'crescendo', from: { m: m1, at: '0' }, to: { m: m1, at: '3/4' }, staff: pp.st1, placement: 'below' });
  b.spanner(pp.p, { type: 'slur', from: e1.id, to: e2.id, placement: 'above' });
  return b.finish().graph;
});
topic('structure', 'two sections, one inside the other, and a phrase that names voices of one part (§5.9)', 'G01 §5.9, §10', () => {
  const b = B('fx-structure', 'Structure'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const ms = ['1', '2', '3', '4'].map(n => b.measure({ number: n, dur: '1' }).id);
  b.meter({ m: ms[0], beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: ms[0], at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: ms[0], at: '0', sign: 'F' });
  ms.forEach((m, i) => b.event(pp.p, note(m, '0', '1', v1, pp.st1, 'whole', [pc(['C', 'D', 'E', 'F'][i], 5)])));
  b.doc.structure = { sections: [], phrases: [] };
  const a = { id: b.id('sc'), label: 'A', from: ms[0], to: ms[3] };
  const a1 = { id: b.id('sc'), label: 'a1', from: ms[0], to: ms[1], parent: a.id };
  b.doc.structure.sections.push(a, a1);
  b.doc.structure.phrases.push({ id: b.id('ph'), part: pp.p.id, voices: [v1], from: { m: ms[0], at: '0' }, to: { m: ms[2], at: '0' }, section: a1.id });
  return b.finish().graph;
});
topic('anchors', 'a take with four bar anchors (µs) and linked notes whose expressive offsets derive from them (§6.9)', 'G01 §5.11, §6.9, A18', () => {
  const b = B('fx-anchors', 'Anchors'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const ms = ['1', '2', '3'].map(n => b.measure({ number: n, dur: '1' }).id);
  b.meter({ m: ms[0], beats: [4], beatType: 4 });
  b.tempo({ m: ms[0], at: '0', qpm: '120' });
  b.clef(pp.p, { staff: pp.st1, m: ms[0], at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: ms[0], at: '0', sign: 'F' });
  const heads = ms.map((m, i) => b.event(pp.p, note(m, '0', '1', v1, pp.st1, 'whole', [pc(['C', 'E', 'G'][i], 5)])).heads[0].id);
  const src = b.source({ kind: 'midi-input', note: 'a student take' });
  const pf = b.performance({ kind: 'take', src: src.id });
  [[0, 2000000, 72], [1, 4100000, 76], [2, 6050000, 79]].forEach(([i, on, midi]) => b.perfNote(pf, { on: on, off: on + 1900000, vel: 64, midi: midi, link: heads[i] }));
  [[0, '0', 2000000], [1, '0', 4000000], [2, '0', 6100000], [2, '1', 8200000]].forEach(([i, at, us]) => b.anchor(pf, { m: ms[i], k: 1, at: at, us: us, kind: 'bar' }));
  return b.finish().graph;
});
topic('prov', 'two sources, a default, and prov on a part, an event, a head (with an aspect) and a measure: the §11.2 resolution order', 'G01 §11, A28', () => {
  const b = SG.builder({ id: 'fx-prov', meta: {} });
  const xml = b.source({ kind: 'musicxml', input: { name: 'scan.musicxml' } }), amt = b.source({ kind: 'amt', tool: 'transkun' });
  b.setDefault({ src: xml.id, op: 'imported' });
  const p = b.part({ instrument: { kind: 'piano', family: 'keyboard' }, prov: { op: 'inferred' } });
  const st = b.staff(p, { limb: 'RH' }).id;
  const v = b.voice(p, { staff: st, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1', prov: { op: 'edited', conf: 0.5 } }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(p, { staff: st, m: m1, at: '0', sign: 'G' });
  b.event(p, note(m1, '0', '1/2', v, st, 'half', [Object.assign(pc('C', 5), { prov: { asp: { pitch: { conf: 0.8, op: 'repaired' } } } })], { prov: { src: amt.id, conf: 0.9 } }));
  b.event(p, note(m1, '1/2', '1/2', v, st, 'half', [pc('D', 5)]));
  return b.finish().graph;
});
topic('ext', 'experimental fields under registered-style namespaces on the root and an event (§5.13)', 'G01 §5.13', () => {
  const b = B('fx-ext', 'Ext'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1', v1, pp.st1, 'whole', [pc('C', 5)], { ext: { 'test.practice': { hint: 'slow', weight: 0.25 } } }));
  b.doc.ext = { 'test.lab': { version: 2 } };
  return b.finish().graph;
});
topic('lyrics-fingering', 'lyrics of two verses with syllables and an extension, printed fingerings (single, substitution, alternative)', 'G01 §5.6, §5.7, §8.5', () => {
  const b = B('fx-lyrics', 'Lyrics and fingering'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1' }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  b.event(pp.p, note(m1, '0', '1/2', v1, pp.st1, 'half', [Object.assign(pc('C', 5), { fingering: [{ f: '1' }] })],
    { lyrics: [{ text: 'A', syllabic: 'begin' }, { verse: 2, text: 'Glo', syllabic: 'begin' }] }));
  b.event(pp.p, note(m1, '1/2', '1/2', v1, pp.st1, 'half', [Object.assign(pc('E', 5), { fingering: [{ f: '3' }, { f: '1', subst: true }, { f: '2', alt: true, placement: 'below' }] })],
    { lyrics: [{ text: 'men', syllabic: 'end', extend: true }, { verse: 2, text: 'ria', syllabic: 'end' }] }));
  return b.finish().graph;
});
topic('repeats', 'a passage repeated three times, then a [1, 2] ending and a [3] ending after a second repeat (§6.7)', 'G01 §6.7, A17', () => {
  const b = B('fx-repeats', 'Repeats'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v1 = b.voice(pp.p, { staff: pp.st1, label: '1' }).id;
  const m1 = b.measure({ number: '1', dur: '1', barline: { right: { style: 'light-heavy', repeat: 'backward', times: 3 } } }).id;
  const m2 = b.measure({ number: '2', dur: '1', barline: { left: { style: 'heavy-light', repeat: 'forward' } } }).id;
  const m3 = b.measure({ number: '3', dur: '1', barline: { right: { style: 'light-heavy', repeat: 'backward', times: 3 } } }).id;
  const m4 = b.measure({ number: '4', dur: '1', barline: { right: { style: 'light-heavy' } } }).id;
  b.meter({ m: m1, beats: [4], beatType: 4 });
  b.ending({ numbers: [1, 2], from: m3, to: m3 });
  b.ending({ numbers: [3], from: m4, to: m4 });
  b.clef(pp.p, { staff: pp.st1, m: m1, at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: m1, at: '0', sign: 'F' });
  [m1, m2, m3, m4].forEach((m, i) => b.event(pp.p, note(m, '0', '1', v1, pp.st1, 'whole', [pc(['C', 'D', 'E', 'F'][i], 5)])));
  return b.finish().graph;
});
topic('pedals', 'a damper pedal with two changes and a printed line, a sostenuto pedal, a soft pedal shown only in sound, and the performed pedals (§8.4)', 'G01 §5.10, §8.4', () => {
  const b = B('fx-pedals', 'Pedals'); setDefaultSrc(b);
  const pp = pianoPart(b);
  const v5 = b.voice(pp.p, { staff: pp.st2, label: '5' }).id;
  const ms = ['1', '2'].map(n => b.measure({ number: n, dur: '1' }).id);
  b.meter({ m: ms[0], beats: [4], beatType: 4 });
  b.clef(pp.p, { staff: pp.st1, m: ms[0], at: '0', sign: 'G' }); b.clef(pp.p, { staff: pp.st2, m: ms[0], at: '0', sign: 'F' });
  ms.forEach(m => b.event(pp.p, note(m, '0', '1', v5, pp.st2, 'whole', [pc('C', 3)])));
  b.spanner(pp.p, { type: 'pedal', pedal: 'damper', from: { m: ms[0], at: '0' }, to: { m: ms[1], at: '1' }, changes: [{ m: ms[0], at: '1/2' }, { m: ms[1], at: '0' }], mark: { line: true } });
  b.spanner(pp.p, { type: 'pedal', pedal: 'sostenuto', from: { m: ms[1], at: '0' }, to: { m: ms[1], at: '1/2' }, text: 'Sost. Ped.' });
  b.spanner(pp.p, { type: 'pedal', pedal: 'soft', from: { m: ms[0], at: '0' }, to: { m: ms[1], at: '1' }, soundOnly: true, depth: 100 });
  const pf = b.performance({ kind: 'source' });
  b.perfPedal(pf, { pedal: 'damper', on: 0, off: 1950000 });
  b.perfPedal(pf, { pedal: 'damper', on: 2000000, off: 3950000, depth: 90 });
  return b.finish().graph;
});
topic('warn-pickup-not-implicit', 'a short first measure not marked implicit, with a full last measure: nothing completes it (§6.3, A16)', 'G01 §6.3, A16', () => {
  const g = base();
  measure(g, 'm1').dur = '1/2';
  P(g).events = P(g).events.filter(e => e.m !== 'm1');
  P(g).spanners = [];
  P(g).events.push(note('m1', '0', '1/2', 'v9', 'st7', 'half', [{ id: 'h31', pitch: { step: 'G', oct: 4 } }], { id: 'e32' }),
    rest('m1', '0', '1/2', 'v10', 'st8', 'half', { id: 'e33' }));
  g.nextId = 34;
  return g;
}, { 'W-MEASURE-LENGTH': 1 });
topic('info-prov-redundant', 'an event whose prov repeats the default it inherits anyway (§11.6, A29)', 'G01 §11.6, A29', () => {
  const g = base();
  ev(g, 'e20').prov = { src: 'sr19', op: 'edited' };
  return g;
});

topics.forEach(([name, about, spec, make, warnings]) => {
  const g = make();
  write('valid', name, g, { about: about, spec: spec, expect: { warnings: warnings } });
});

console.log('wrote ' + written.length + ' fixtures');
