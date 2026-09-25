/* G04 §22.1: the E engraving fixtures, E01-E40, one notation topic each.

     node tests/engrave/tools/make-e-fixtures.js           write tests/engrave/fixtures/e/*.musicxml
     node tests/engrave/tools/make-e-fixtures.js --check   exit 1 if a committed file is not what this writes

   Small MusicXML files written here, from the notes up (no copyrighted source, no randomness): the same run gives
   the same bytes. Each states the notation its topic is about, so the plan and its ledger can be held to it
   (tests/engrave/e-fixtures.test.js); the geometry these files are also for (spacing, collisions, curves) is G4b-G4d.
   Divisions are 480 per quarter, so 64ths, triplets and quintuplets are all whole numbers. */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'fixtures', 'e');
const D = 480;
const DUR = { whole: 4 * D, half: 2 * D, quarter: D, eighth: D / 2, '16th': D / 4, '32nd': D / 8, '64th': D / 16 };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ notes */
/* n('C#5', 'eighth', {...}) or n(null, 'quarter', {...}) for a rest. Options:
   dots, voice (1), staff (1), chord, grace ({slash}), tie ['start'|'stop'], beams [[level, value]], tm [actual, normal],
   tuplet {type, number, bracket, show, placement}, stem, acc, cautionary, paren, arts [...], orn [...], fermata,
   fingering [[f, placement]], slurs [{type, number, placement}], lyric {syllabic, text}, notehead {shape, paren},
   cue, hidden, measureRest, dur (divisions, overrides the type), arp ('up'|'down'|'non'), gliss {type, line, number}, slide {type} */
function n(p, type, o) {
  o = o || {};
  const x = [];
  const attrs = o.hidden ? ' print-object="no"' : '';
  x.push('<note' + attrs + '>');
  if (o.grace) x.push(o.grace.slash ? '<grace slash="yes"/>' : '<grace/>');
  if (o.cue) x.push('<cue/>');
  if (o.chord) x.push('<chord/>');
  if (o.unpitched) x.push('<unpitched><display-step>' + o.unpitched[0] + '</display-step><display-octave>' + o.unpitched[1] + '</display-octave></unpitched>');
  else if (p) {
    const m = /^([A-G])(#{1,2}|b{1,2})?(\d)$/.exec(p);
    if (!m) throw new Error('pitch ' + p);
    const alter = !m[2] ? 0 : m[2][0] === '#' ? m[2].length : -m[2].length;
    x.push('<pitch><step>' + m[1] + '</step>' + (alter ? '<alter>' + alter + '</alter>' : '') + '<octave>' + m[3] + '</octave></pitch>');
  } else x.push(o.measureRest ? '<rest measure="yes"/>' : '<rest/>');
  let dur = o.dur !== undefined ? o.dur : DUR[type] * (o.dots === 1 ? 1.5 : o.dots === 2 ? 1.75 : 1);
  if (o.tm && o.dur === undefined) dur = dur * o.tm[1] / o.tm[0];
  if (!o.grace) x.push('<duration>' + dur + '</duration>');
  (o.tie || []).forEach(t => x.push('<tie type="' + t + '"/>'));
  if (o.instrument) x.push('<instrument id="' + o.instrument + '"/>');
  x.push('<voice>' + (o.voice || 1) + '</voice>');
  if (type) x.push('<type' + (o.cue || o.grace ? ' size="' + (o.cue ? 'cue' : 'grace') + '"' : '') + '>' + type + '</type>');
  for (let i = 0; i < (o.dots || 0); i++) x.push('<dot/>');
  if (o.acc) x.push('<accidental' + (o.cautionary ? ' cautionary="yes"' : '') + (o.paren ? ' parentheses="yes"' : '') + (o.bracket ? ' bracket="yes"' : '') + '>' + o.acc + '</accidental>');
  if (o.tm) x.push('<time-modification><actual-notes>' + o.tm[0] + '</actual-notes><normal-notes>' + o.tm[1] + '</normal-notes>' +
    (o.tmType ? '<normal-type>' + o.tmType + '</normal-type>' : '') + '</time-modification>');
  if (o.stem) x.push('<stem>' + o.stem + '</stem>');
  if (o.notehead) x.push('<notehead' + (o.notehead.paren ? ' parentheses="yes"' : '') + '>' + o.notehead.shape + '</notehead>');
  x.push('<staff>' + (o.staff || 1) + '</staff>');
  (o.beams || []).forEach(([lv, v]) => x.push('<beam number="' + lv + '">' + v + '</beam>'));
  const nt = [];
  (o.tie || []).forEach(t => nt.push('<tied type="' + t + '"/>'));
  (o.slurs || []).forEach(s => nt.push('<slur type="' + s.type + '" number="' + (s.number || 1) + '"' + (s.placement ? ' placement="' + s.placement + '"' : '') + '/>'));
  (o.tuplets || (o.tuplet ? [o.tuplet] : [])).forEach(t => nt.push('<tuplet type="' + t.type + '" number="' + (t.number || 1) + '"' +
    (t.bracket !== undefined ? ' bracket="' + (t.bracket ? 'yes' : 'no') + '"' : '') + (t.show ? ' show-number="' + t.show + '"' : '') +
    (t.placement ? ' placement="' + t.placement + '"' : '') + '/>'));
  if (o.arts && o.arts.length) nt.push('<articulations>' + o.arts.map(a => '<' + a + '/>').join('') + '</articulations>');
  if (o.orn && o.orn.length) nt.push('<ornaments>' + o.orn.map(a => (a === 'tremolo' ? '<tremolo type="single">3</tremolo>' : '<' + a + '/>')).join('') + '</ornaments>');
  if (o.fermata) nt.push('<fermata type="upright"/>');
  if (o.fingering) nt.push('<technical>' + o.fingering.map(([f, pl]) => '<fingering' + (pl ? ' placement="' + pl + '"' : '') + '>' + f + '</fingering>').join('') + '</technical>');
  if (o.arp) nt.push(o.arp === 'non' ? '<non-arpeggiate type="bottom"/>' : '<arpeggiate' + (o.arp === 'up' || o.arp === 'down' ? ' direction="' + o.arp + '"' : '') + '/>');
  if (o.gliss) nt.push('<glissando type="' + o.gliss.type + '" number="1"' + (o.gliss.line ? ' line-type="' + o.gliss.line + '"' : '') + '/>');
  if (o.slide) nt.push('<slide type="' + o.slide.type + '" number="1"/>');
  if (nt.length) x.push('<notations>' + nt.join('') + '</notations>');
  if (o.lyric) x.push('<lyric number="1"><syllabic>' + o.lyric.syllabic + '</syllabic><text>' + esc(o.lyric.text) + '</text></lyric>');
  x.push('</note>');
  return x.join('');
}
const backup = d => '<backup><duration>' + d + '</duration></backup>';
const dir = (inner, o) => { o = o || {}; return '<direction' + (o.placement ? ' placement="' + o.placement + '"' : '') + '><direction-type>' + inner + '</direction-type>' +
  (o.staff ? '<staff>' + o.staff + '</staff>' : '') + (o.sound ? '<sound ' + o.sound + '/>' : '') + '</direction>'; };
const dyn = (v, staff) => dir('<dynamics><' + v + '/></dynamics>', { placement: 'below', staff: staff || 1 });
const wedge = (t, staff) => dir('<wedge type="' + t + '"/>', { placement: 'below', staff: staff || 1 });
const words = (t, staff) => dir('<words>' + esc(t) + '</words>', { placement: 'above', staff: staff || 1 });

/* attributes: {key, mode, time: [b, bt] | 'common' | 'cut', hiddenTime, staves, clefs: [[sign, line, octave]]} */
function attrs(a) {
  const x = ['<attributes>'];
  if (a.divisions !== false) x.push('<divisions>' + D + '</divisions>');
  if (a.key !== undefined) x.push('<key' + (a.keyHidden ? ' print-object="no"' : '') + '><fifths>' + a.key + '</fifths>' + (a.mode ? '<mode>' + a.mode + '</mode>' : '') + '</key>');
  if (a.time) {
    const t = a.time === 'common' ? ['4', '4', ' symbol="common"'] : a.time === 'cut' ? ['2', '2', ' symbol="cut"'] : [String(a.time[0]), String(a.time[1]), ''];
    x.push('<time' + t[2] + (a.hiddenTime ? ' print-object="no"' : '') + '><beats>' + t[0] + '</beats><beat-type>' + t[1] + '</beat-type></time>');
  }
  if (a.staves) x.push('<staves>' + a.staves + '</staves>');
  (a.clefs || []).forEach((c, i) => {
    if (!c) return;
    x.push('<clef' + (a.staves || a.clefNumber ? ' number="' + (a.clefNumber || i + 1) + '"' : '') + '><sign>' + c[0] + '</sign>' + (c[1] ? '<line>' + c[1] + '</line>' : '') +
      (c[2] ? '<clef-octave-change>' + c[2] + '</clef-octave-change>' : '') + '</clef>');
  });
  if (a.multiRest) x.push('<measure-style><multiple-rest>' + a.multiRest + '</multiple-rest></measure-style>');
  x.push('</attributes>');
  return x.join('');
}
const piano = (o) => attrs(Object.assign({ key: 0, time: [4, 4], staves: 2, clefs: [['G', 2], ['F', 4]] }, o || {}));
const single = (o) => attrs(Object.assign({ key: 0, time: [4, 4], clefs: [['G', 2]] }, o || {}));

/* a measure: {number, implicit, content: [...], barRight, barLeft, newSystem} */
function measure(num, content, o) {
  o = o || {};
  const x = ['<measure number="' + num + '"' + (o.implicit ? ' implicit="yes"' : '') + '>'];
  if (o.newSystem) x.push('<print new-system="yes"/>');
  if (o.barLeft) x.push(o.barLeft);
  x.push(...content);
  if (o.barRight) x.push(o.barRight);
  x.push('</measure>');
  return x.join('\n      ');
}
const repeatL = () => '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>';
const repeatR = (ending) => '<barline location="right"><bar-style>light-heavy</bar-style>' + (ending ? '<ending number="' + ending + '" type="stop"/>' : '') + '<repeat direction="backward"/></barline>';
const endingStart = num => '<barline location="left"><ending number="' + num + '" type="start"/></barline>';
const endingStop = (num, type) => '<barline location="right"><ending number="' + num + '" type="' + (type || 'stop') + '"/></barline>';
const finalBar = () => '<barline location="right"><bar-style>light-heavy</bar-style></barline>';

/* a score: parts [{id, name, abbr, measures, instruments}] */
function score(title, note, parts) {
  const pl = parts.map(p => '<score-part id="' + p.id + '"><part-name>' + esc(p.name) + '</part-name>' + (p.abbr ? '<part-abbreviation>' + esc(p.abbr) + '</part-abbreviation>' : '') +
    (p.instruments || '') + '</score-part>').join('');
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- ' + note + ' (G04 §22.1; written by tests/engrave/tools/make-e-fixtures.js) -->',
    '<score-partwise version="4.0">',
    '  <work><work-title>' + esc(title) + '</work-title></work>',
    '  <identification><creator type="composer">PPP</creator></identification>',
    '  <part-list>' + pl + '</part-list>',
    ...parts.map(p => '  <part id="' + p.id + '">\n    ' + p.measures.join('\n    ') + '\n  </part>'),
    '</score-partwise>', ''].join('\n');
}
const pianoScore = (title, note, measures) => score(title, note, [{ id: 'P1', name: 'Piano', measures: measures }]);

/* eight eighths as beamed groups of `size` */
const eighths = (pitches, size, o) => pitches.map((p, i) => n(p, 'eighth', Object.assign({ beams: [[1, i % size === 0 ? 'begin' : i % size === size - 1 ? 'end' : 'continue']] }, o || {})));
/* a whole-bar left hand */
const lhWhole = (p, o) => [backup(4 * D), n(p, 'whole', Object.assign({ voice: 5, staff: 2 }, o || {}))];
const trip = (p, k, o) => n(p, 'eighth', Object.assign({ tm: [3, 2] }, o || {}));

/* ------------------------------------------------------------------ the fixtures */
const E = {};

E['E01-beams-basic'] = () => pianoScore('Beams: 4/4, 3/4, 2/2', 'beams in groups of the beat, as the file states them', [
  measure(1, [piano(), ...eighths(['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'], 4), ...lhWhole('C3')]),
  measure(2, [attrs({ divisions: false, time: [3, 4] }), ...eighths(['C5', 'E5', 'G5', 'E5', 'C5', 'E5'], 2), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(3, [attrs({ divisions: false, time: [2, 2] }), ...eighths(['G4', 'A4', 'B4', 'C5', 'D5', 'C5', 'B4', 'A4'], 4), ...lhWhole('G2')], { barRight: finalBar() })
]);

E['E02-beams-compound-secondary'] = () => pianoScore('Beams: 6/8, 12/8, secondary breaks and hooks', 'a 16th secondary beam broken inside an eighth group, and hooks', [
  measure(1, [piano({ time: [6, 8] }),
    n('C5', '16th', { beams: [[1, 'begin'], [2, 'begin']] }), n('D5', '16th', { beams: [[1, 'continue'], [2, 'end']] }),
    n('E5', '16th', { beams: [[1, 'continue'], [2, 'begin']] }), n('F5', '16th', { beams: [[1, 'continue'], [2, 'continue']] }),
    n('G5', '16th', { beams: [[1, 'continue'], [2, 'continue']] }), n('A5', '16th', { beams: [[1, 'end'], [2, 'end']] }),
    n('G5', 'eighth', { dots: 1, beams: [[1, 'begin']] }), n('F5', '16th', { beams: [[1, 'continue'], [2, 'backward hook']] }), n('E5', 'eighth', { beams: [[1, 'end']] }),
    backup(3 * D), n('C3', 'quarter', { dots: 1, voice: 5, staff: 2 }), n('G3', 'quarter', { dots: 1, voice: 5, staff: 2 })]),
  measure(2, [attrs({ divisions: false, time: [12, 8] }),
    ...['C5', 'D5', 'E5', 'F5', 'E5', 'D5', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5'].map((p, i) => n(p, 'eighth', { beams: [[1, i % 3 === 0 ? 'begin' : i % 3 === 2 ? 'end' : 'continue']] })),
    backup(6 * D), n('C3', 'whole', { dots: 1, voice: 5, staff: 2 })], { barRight: finalBar() })
]);

E['E03-beam-with-rest'] = () => pianoScore('A beam over a rest', 'a 16th rest inside a beamed group', [
  measure(1, [piano(),
    n('C5', '16th', { beams: [[1, 'begin'], [2, 'begin']] }), n(null, '16th'), n('E5', '16th', { beams: [[1, 'continue'], [2, 'continue']] }), n('F5', '16th', { beams: [[1, 'end'], [2, 'end']] }),
    n('G5', 'quarter'), n('A5', 'half'), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E04-tuplet-show'] = () => pianoScore('Tuplets as the file shows them', 'bracket and number (unbeamed); number only; neither; a time-modification with no tuplet mark', [
  measure(1, [piano(),
    /* bracket="yes" is the graph's default and is not kept as a statement (musicxml-import): unbeamed, it is drawn */
    trip('C5', 0, { tuplet: { type: 'start', bracket: true } }), trip('D5', 1), trip('E5', 2, { tuplet: { type: 'stop' } }),
    trip('F5', 0, { tuplet: { type: 'start', bracket: false }, beams: [[1, 'begin']] }), trip('G5', 1, { beams: [[1, 'continue']] }), trip('A5', 2, { tuplet: { type: 'stop' }, beams: [[1, 'end']] }),
    trip('G5', 0, { tuplet: { type: 'start', bracket: false, show: 'none' }, beams: [[1, 'begin']] }), trip('F5', 1, { beams: [[1, 'continue']] }), trip('E5', 2, { tuplet: { type: 'stop' }, beams: [[1, 'end']] }),
    trip('D5', 0, { beams: [[1, 'begin']] }), trip('C5', 1, { beams: [[1, 'continue']] }), trip('B4', 2, { beams: [[1, 'end']] }),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E05-tuplet-nested'] = () => pianoScore('A tuplet inside a tuplet', 'a triplet of eighths inside a 5:4 of eighths, two levels', [
  measure(1, [piano({ time: [2, 4] }),
    n('C5', 'eighth', { tm: [5, 4], tuplets: [{ type: 'start', number: 1 }] }),
    n('D5', '16th', { tm: [15, 8], dur: D / 4 * 4 / 5 * 2 / 3, tuplets: [{ type: 'start', number: 2 }] }),
    n('E5', '16th', { tm: [15, 8], dur: D / 4 * 4 / 5 * 2 / 3 }),
    n('F5', '16th', { tm: [15, 8], dur: D / 4 * 4 / 5 * 2 / 3, tuplets: [{ type: 'stop', number: 2 }] }),
    n('G5', 'eighth', { tm: [5, 4] }), n('A5', 'eighth', { tm: [5, 4] }),
    n('B5', 'eighth', { tm: [5, 4], tuplets: [{ type: 'stop', number: 1 }] }),
    backup(2 * D), n('C3', 'half', { voice: 5, staff: 2 })], { barRight: finalBar() })
]);

E['E06-tuplet-with-rest'] = () => pianoScore('A triplet with a rest', 'the rest is a member, so a bracket shows the group', [
  measure(1, [piano(),
    trip('C5', 0, { tuplet: { type: 'start' } }), trip(null, 1), trip('E5', 2, { tuplet: { type: 'stop' } }),
    n('F5', 'quarter'), n('G5', 'half'), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E07-one-note-tuplets'] = () => pianoScore('One-note tuplets (the writer shape)', 'every triplet piece brackets itself; two chains fill a beat each, the third is off the grid', [
  measure(1, [piano(),
    ...['C5', 'D5', 'E5', 'F5', 'G5', 'A5'].map(p => trip(p, 0, { tuplets: [{ type: 'start' }, { type: 'stop' }] })),
    n('B5', 'half'), ...lhWhole('C3')]),
  measure(2, [n('C5', 'eighth'), ...['D5', 'E5', 'F5'].map(p => trip(p, 0, { tuplets: [{ type: 'start' }, { type: 'stop' }] })), n('G5', 'eighth'), n('A5', 'half'),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E08-tie-partial-chord'] = () => pianoScore('A tie from part of a chord', 'only the E of C-E-G is tied on', [
  measure(1, [piano(), n('C5', 'half'), n('E5', 'half', { chord: true, tie: ['start'] }), n('G5', 'half', { chord: true }),
    n('D5', 'half'), n('E5', 'half', { chord: true, tie: ['stop'] }), n('A5', 'half', { chord: true }), ...lhWhole('C3')], { barRight: finalBar() })
]);

/* G4d-1a: five bars, a tie over every bar line and eighths in the left hand, so at the desktop and phone widths a tie crosses
   a system break (§13.1: two halves) */
const lhEighths = ps => [backup(4 * D), ...eighths(ps, 4, { voice: 5, staff: 2 })];
E['E09-tie-barline-system'] = () => pianoScore('Ties over a bar line and a system break', 'a tie over every bar line, so one crosses a system break at any width; the file breaks the system at bar 3', [
  measure(1, [piano(), n('C5', 'half'), n('G5', 'half', { tie: ['start'] }), ...lhEighths(['C3', 'G3', 'E3', 'G3', 'C3', 'G3', 'E3', 'G3'])]),
  measure(2, [n('G5', 'half', { tie: ['stop'] }), n('E5', 'half', { tie: ['start'] }), ...lhEighths(['E3', 'B3', 'G3', 'B3', 'E3', 'B3', 'G3', 'B3'])]),
  measure(3, [n('E5', 'half', { tie: ['stop'] }), n('D5', 'half', { tie: ['start'] }), ...lhEighths(['F3', 'A3', 'D4', 'A3', 'F3', 'A3', 'D4', 'A3'])], { newSystem: true }),
  measure(4, [n('D5', 'half', { tie: ['stop'] }), n('C5', 'half', { tie: ['start'] }), ...lhEighths(['G2', 'D3', 'G3', 'D3', 'G2', 'D3', 'G3', 'D3'])]),
  measure(5, [n('C5', 'whole', { tie: ['stop'] }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E10-slurs-overlap'] = () => pianoScore('Overlapping slurs', 'slur 1 over notes 1-3, slur 2 over notes 2-4', [
  measure(1, [piano(), n('C5', 'quarter', { slurs: [{ type: 'start', number: 1 }] }), n('D5', 'quarter', { slurs: [{ type: 'start', number: 2 }] }),
    n('E5', 'quarter', { slurs: [{ type: 'stop', number: 1 }] }), n('F5', 'quarter', { slurs: [{ type: 'stop', number: 2 }] }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E11-slur-rest-system'] = () => pianoScore('A slur over a rest and a system break', 'the slur goes from a note past a rest; a second one crosses the break', [
  measure(1, [piano(), n('C5', 'quarter', { slurs: [{ type: 'start', placement: 'above' }] }), n(null, 'quarter'), n('E5', 'quarter', { slurs: [{ type: 'stop' }] }),
    n('G5', 'quarter', { slurs: [{ type: 'start', number: 2 }] }), ...lhWhole('C3')]),
  measure(2, [n('F5', 'half'), n('D5', 'half', { slurs: [{ type: 'stop', number: 2 }] }), ...lhWhole('G2')], { newSystem: true, barRight: finalBar() })
]);

E['E12-two-voices-heads'] = () => pianoScore('Two voices: seconds and unisons', 'a second between the voices, a unison of equal heads, a unison of a half and a quarter; ' +
  'then a unison of a dotted and a plain quarter, a unison of two flagged eighths, a second of two flagged eighths; then an augmented unison, F against F sharp', [
  measure(1, [piano(),
    n('E5', 'quarter', { voice: 1, stem: 'up' }), n('C5', 'quarter', { voice: 1, stem: 'up' }), n('D5', 'half', { voice: 1, stem: 'up' }),
    backup(4 * D),
    n('D5', 'quarter', { voice: 2, stem: 'down' }), n('C5', 'quarter', { voice: 2, stem: 'down' }), n('D5', 'quarter', { voice: 2, stem: 'down' }), n('B4', 'quarter', { voice: 2, stem: 'down' }),
    ...lhWhole('G2')]),
  /* the eighths stand alone in their beats (no beam: a rest or a longer note beside them), so they are flagged */
  measure(2, [
    n('D5', 'quarter', { voice: 1, stem: 'up', dots: 1 }), n('C5', 'eighth', { voice: 1, stem: 'up' }), n('E5', 'eighth', { voice: 1, stem: 'up' }), n(null, 'eighth', { voice: 1 }),
    n('D5', 'quarter', { voice: 1, stem: 'up' }),
    backup(4 * D),
    n('D5', 'quarter', { voice: 2, stem: 'down' }), n(null, 'eighth', { voice: 2 }), n('C5', 'eighth', { voice: 2, stem: 'down' }), n('D5', 'eighth', { voice: 2, stem: 'down' }),
    n(null, 'eighth', { voice: 2 }), n('B4', 'quarter', { voice: 2, stem: 'down' }),
    ...lhWhole('G2')]),
  /* G4d-1a (the G4c review's re-check): an augmented unison - one staff position, two alterations - is never one head: F with
     no accidental in the upper voice, F sharp in the lower, the lower voice beside it */
  measure(3, [
    n('F5', 'quarter', { voice: 1, stem: 'up' }), n('E5', 'quarter', { voice: 1, stem: 'up' }), n('D5', 'half', { voice: 1, stem: 'up' }),
    backup(4 * D),
    n('F#5', 'quarter', { voice: 2, stem: 'down', acc: 'sharp' }), n('C5', 'quarter', { voice: 2, stem: 'down' }), n('B4', 'half', { voice: 2, stem: 'down' }),
    ...lhWhole('G2')], { barRight: finalBar() })
]);

E['E13-two-voices-rests'] = () => pianoScore('Two voices resting', 'both voices rest together for a quarter; then only the lower voice, for a half; ' +
  'then both rest at once for different lengths, a quarter above and a half below; then the lower voice rests for a half under low notes of ' +
  'the upper one, off the staff', [
  measure(1, [piano(),
    n(null, 'quarter', { voice: 1 }), n('E5', 'quarter', { voice: 1 }), n('F5', 'half', { voice: 1 }),
    backup(4 * D),
    n(null, 'quarter', { voice: 2 }), n('C5', 'quarter', { voice: 2 }), n(null, 'half', { voice: 2 }),
    ...lhWhole('C3')]),
  measure(2, [
    n(null, 'quarter', { voice: 1 }), n('E5', 'quarter', { voice: 1 }), n('D5', 'half', { voice: 1 }),
    backup(4 * D),
    n(null, 'half', { voice: 2 }), n('G4', 'half', { voice: 2 }),
    ...lhWhole('C3')]),
  /* G4d-1a (the G4c review M1): a half rest pushed below the staff by the upper voice's low notes sits on a ledger line of its
     own - without it a half rest and a whole rest look alike */
  measure(3, [
    n('E4', 'half', { voice: 1, stem: 'up' }), n('F4', 'half', { voice: 1, stem: 'up' }),
    backup(4 * D),
    n(null, 'half', { voice: 2 }), n('D4', 'half', { voice: 2, stem: 'down' }),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E14-grace'] = () => pianoScore('Grace notes', 'an acciaccatura, a beamed pair of appoggiaturas, a grace before a note with an accidental, and one after the last note', [
  measure(1, [piano(),
    n('D5', 'eighth', { grace: { slash: true } }), n('C5', 'quarter'),
    n('F5', '16th', { grace: {}, beams: [[1, 'begin'], [2, 'begin']] }), n('G5', '16th', { grace: {}, beams: [[1, 'end'], [2, 'end']] }), n('E5', 'quarter'),
    n('G5', 'eighth', { grace: { slash: true } }), n('F#5', 'quarter', { acc: 'sharp' }),
    n('G5', 'quarter'), n('A5', '16th', { grace: {} }),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E15-articulations'] = () => pianoScore('Articulations under a slur', 'staccato, tenuto, accent, marcato, staccato with accent, a fermata; ' +
  'then a trill, an inverted mordent, a turn over a detached-legato, a tremolo and a breath mark, and a fermata over the final bar line', [
  measure(1, [piano(),
    n('C5', 'quarter', { arts: ['staccato'], slurs: [{ type: 'start' }] }), n('D5', 'quarter', { arts: ['tenuto'] }),
    n('E5', 'quarter', { arts: ['accent'] }), n('F5', 'quarter', { arts: ['strong-accent'], slurs: [{ type: 'stop' }] }), ...lhWhole('C3')]),
  measure(2, [n('G5', 'half', { arts: ['staccato', 'accent'] }), n('C6', 'half', { fermata: true }), ...lhWhole('C3', { fermata: true })]),
  /* G4d-1a: ornaments, a tremolo, a composite articulation, one drawn after its note, and a fermata over a bar line (§10.2
     priority 5) */
  measure(3, [n('E5', 'quarter', { orn: ['trill-mark'] }), n('D5', 'quarter', { orn: ['inverted-mordent'] }),
    n('C5', 'quarter', { orn: ['turn'], arts: ['detached-legato'] }), n('B4', 'quarter', { orn: ['tremolo'], arts: ['breath-mark'] }), ...lhWhole('G2')],
  { barRight: '<barline location="right"><bar-style>light-heavy</bar-style><fermata type="upright"/></barline>' })
]);

E['E16-dynamics-hairpins'] = () => pianoScore('Dynamics and hairpins', 'p, a crescendo to f, a diminuendo over a system break', [
  measure(1, [piano(), dyn('p'), wedge('crescendo'), n('C5', 'quarter'), n('D5', 'quarter'), n('E5', 'quarter'), wedge('stop'), dyn('f'), n('F5', 'quarter'), ...lhWhole('C3')]),
  measure(2, [wedge('diminuendo'), n('G5', 'half'), n('E5', 'half'), ...lhWhole('C3')]),
  measure(3, [n('D5', 'half'), wedge('stop'), dyn('pp'), n('C5', 'half'), ...lhWhole('C3')], { newSystem: true, barRight: finalBar() })
]);

E['E17-pedal'] = () => pianoScore('Pedal', 'a pedal with its sign; a line pedal changed in the middle; the recording shape (a line with no sign)', [
  measure(1, [piano(), dir('<pedal type="start" sign="yes"/>', { placement: 'below', staff: 2 }), n('C5', 'half'),
    dir('<pedal type="stop" sign="yes"/>', { placement: 'below', staff: 2 }), n('E5', 'half'), ...lhWhole('C3')]),
  measure(2, [dir('<pedal type="start" line="yes" sign="no"/>', { placement: 'below', staff: 2 }), n('D5', 'half'),
    dir('<pedal type="change" line="yes"/>', { placement: 'below', staff: 2 }), n('F5', 'half'), ...lhWhole('G2')]),
  measure(3, [n('E5', 'whole'), dir('<pedal type="stop" line="yes" sign="no"/>', { placement: 'below', staff: 2 }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E18-ottava'] = () => pianoScore('Octave lines', '8va on the right hand, 8vb on the left, 15ma, and an 8va that names no staff over notes on both staves', [
  measure(1, [piano(), dir('<octave-shift type="down" size="8" number="1"/>', { placement: 'above', staff: 1 }),
    n('C6', 'quarter'), n('E6', 'quarter'), n('G6', 'half'), dir('<octave-shift type="stop" size="8" number="1"/>', { staff: 1 }),
    backup(4 * D), dir('<octave-shift type="up" size="8" number="2"/>', { placement: 'below', staff: 2 }),
    n('C2', 'half', { voice: 5, staff: 2 }), n('G1', 'half', { voice: 5, staff: 2 }), dir('<octave-shift type="stop" size="8" number="2"/>', { staff: 2 })]),
  measure(2, [dir('<octave-shift type="down" size="15" number="1"/>', { placement: 'above', staff: 1 }),
    n('C7', 'half'), n('E7', 'half'), dir('<octave-shift type="stop" size="15" number="1"/>', { staff: 1 }), ...lhWhole('C3')]),
  /* no <staff> on the 8va: the importer assumes staff 1 and says so; the app reads it on both staves */
  measure(3, [dir('<octave-shift type="down" size="8" number="1"/>', { placement: 'above' }),
    n('C6', 'half'), n('D6', 'half'), backup(4 * D), n('C4', 'half', { voice: 5, staff: 2 }), n('D4', 'half', { voice: 5, staff: 2 }),
    dir('<octave-shift type="stop" size="8" number="1"/>')], { barRight: finalBar() })
]);

E['E19-clefs'] = () => pianoScore('Clef changes', 'a change inside a bar, one at a bar line, an alto clef, a treble clef an octave down', [
  measure(1, [piano(), n('C5', 'half'), n('E5', 'half'), backup(4 * D), n('C3', 'half', { voice: 5, staff: 2 }),
    attrs({ divisions: false, clefs: [['G', 2]], clefNumber: 2 }), n('C4', 'half', { voice: 5, staff: 2 })]),
  measure(2, [attrs({ divisions: false, clefs: [['C', 3]], clefNumber: 1 }), n('C4', 'whole'), ...lhWhole('E4')]),
  measure(3, [attrs({ divisions: false, clefs: [['G', 2, -1]], clefNumber: 1 }), n('C4', 'whole'), backup(4 * D),
    attrs({ divisions: false, clefs: [['F', 4]], clefNumber: 2 }), n('C3', 'whole', { voice: 5, staff: 2 })], { barRight: finalBar() })
]);

E['E20-key-change'] = () => pianoScore('A key change with cancellation', 'three sharps to one flat, at a system break', [
  measure(1, [piano({ key: 3 }), n('A4', 'quarter'), n('C#5', 'quarter'), n('E5', 'half'), ...lhWhole('A2')]),
  measure(2, [n('F#5', 'whole'), ...lhWhole('A2')]),
  measure(3, [attrs({ divisions: false, key: -1 }), n('F5', 'quarter'), n('A5', 'quarter'), n('C6', 'half'), ...lhWhole('F2')], { newSystem: true, barRight: finalBar() })
]);

E['E21-meter'] = () => pianoScore('Meter changes and symbols', '4/4, 3/4, common time, cut time, and a hidden meter', [
  measure(1, [piano(), n('C5', 'whole'), ...lhWhole('C3')]),
  measure(2, [attrs({ divisions: false, time: [3, 4] }), n('D5', 'half', { dots: 1 }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(3, [attrs({ divisions: false, time: 'common' }), n('E5', 'whole'), ...lhWhole('C3')]),
  measure(4, [attrs({ divisions: false, time: 'cut' }), n('F5', 'whole'), ...lhWhole('C3')]),
  measure(5, [attrs({ divisions: false, time: [4, 4], hiddenTime: true }), n('G5', 'whole'), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E22-repeats-jumps'] = () => pianoScore('Repeats, voltas and jumps', 'a repeat with first and second endings, segno, coda, D.S. al Coda, Fine', [
  measure(1, [piano(), dir('<segno/>', { placement: 'above' }), n('C5', 'whole'), ...lhWhole('C3')], { barLeft: repeatL() }),
  measure(2, [n('D5', 'whole'), ...lhWhole('G2')], { barLeft: endingStart(1), barRight: repeatR(1) }),
  measure(3, [n('E5', 'whole'), words('Fine'), ...lhWhole('C3')], { barLeft: endingStart(2), barRight: endingStop(2, 'discontinue') }),
  measure(4, [n('F5', 'half'), dir('<words>To Coda</words>', { placement: 'above', sound: 'tocoda="coda1"' }), n('G5', 'half'), ...lhWhole('F2')]),
  measure(5, [n('A5', 'whole'), dir('<words>D.S. al Coda</words>', { placement: 'above', sound: 'dalsegno="segno1"' }), ...lhWhole('F2')],
    { barRight: '<barline location="right"><bar-style>light-light</bar-style></barline>' }),
  measure(6, [dir('<coda/>', { placement: 'above', sound: 'coda="coda1"' }), n('C6', 'whole'), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E23-fingering'] = () => pianoScore('Printed fingering', 'a three-note chord with a finger on each head, fingers above in the right hand and below in the left', [
  measure(1, [piano(), n('C5', 'half', { fingering: [['1', 'above']] }), n('E5', 'half', { chord: true, fingering: [['3', 'above']] }), n('G5', 'half', { chord: true, fingering: [['5', 'above']] }),
    n('F5', 'quarter', { fingering: [['4']] }), n('E5', 'quarter', { fingering: [['3']] }),
    backup(4 * D), n('C3', 'half', { voice: 5, staff: 2, fingering: [['5', 'below']] }), n('G3', 'half', { voice: 5, staff: 2, fingering: [['1', 'below']] })], { barRight: finalBar() })
]);

E['E24-lyrics'] = () => score('Lyrics', 'one verse under a melody, a word over two notes', [
  { id: 'P1', name: 'Voice', measures: [measure(1, [single(), n('C5', 'quarter', { lyric: { syllabic: 'single', text: 'Sing' } }),
    n('D5', 'quarter', { lyric: { syllabic: 'begin', text: 'hap' } }), n('E5', 'half', { lyric: { syllabic: 'end', text: 'py' } })], { barRight: finalBar() })] }
]);

E['E25-chords-dense'] = () => pianoScore('Chord symbols, dense', 'a chord symbol on every beat', [
  measure(1, [piano(), ...['C', 'Am', 'F', 'G7'].map((c, i) => {
    const m = /^([A-G])(.*)$/.exec(c);
    const kind = m[2] === 'm' ? 'minor' : m[2] === '7' ? 'dominant' : 'major';
    return '<harmony><root><root-step>' + m[1] + '</root-step></root><kind>' + kind + '</kind></harmony>' + n(['C5', 'A4', 'F5', 'G5'][i], 'quarter');
  }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E26-cross-staff'] = () => pianoScore('Cross-staff notes', 'a left-hand voice note on the upper staff, and a chord with heads on both staves', [
  measure(1, [piano(), n('E5', 'half'), n('G5', 'half'),
    backup(4 * D), n('C3', 'quarter', { voice: 5, staff: 2 }), n('G4', 'quarter', { voice: 5, staff: 1 }), n('C3', 'half', { voice: 5, staff: 2 }), n('E4', 'half', { voice: 5, staff: 1, chord: true })], { barRight: finalBar() })
]);

E['E27-percussion'] = () => score('Percussion', 'a snare and a bass drum on a percussion staff', [
  { id: 'P1', name: 'Drums', instruments: '<score-instrument id="P1-I38"><instrument-name>Snare</instrument-name></score-instrument><score-instrument id="P1-I36"><instrument-name>Bass Drum</instrument-name></score-instrument>' +
    '<midi-instrument id="P1-I38"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument><midi-instrument id="P1-I36"><midi-channel>10</midi-channel><midi-unpitched>37</midi-unpitched></midi-instrument>',
  measures: [measure(1, [attrs({ key: 0, time: [4, 4], clefs: [['percussion']] }),
    n(null, 'quarter', { unpitched: ['F', 4], instrument: 'P1-I36' }), n(null, 'quarter', { unpitched: ['C', 5], instrument: 'P1-I38', notehead: { shape: 'x' } }),
    n(null, 'quarter', { unpitched: ['F', 4], instrument: 'P1-I36' }), n(null, 'quarter', { unpitched: ['C', 5], instrument: 'P1-I38' })], { barRight: finalBar() })] }
]);

E['E28-multirest'] = () => pianoScore('A multi-measure rest', 'four bars of rest printed as one', [
  measure(1, [piano(), n('C5', 'whole'), ...lhWhole('C3')]),
  measure(2, [attrs({ divisions: false, multiRest: 4 }), n(null, 'whole', { measureRest: true }), backup(4 * D), n(null, 'whole', { measureRest: true, voice: 5, staff: 2 })]),
  ...[3, 4, 5].map(k => measure(k, [n(null, 'whole', { measureRest: true }), backup(4 * D), n(null, 'whole', { measureRest: true, voice: 5, staff: 2 })])),
  measure(6, [n('G5', 'whole'), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E29-measure-rests'] = () => pianoScore('Whole-bar rests in 3/4 and 6/8', 'a bar rest is centred whatever the meter', [
  measure(1, [piano({ time: [3, 4] }), n(null, null, { measureRest: true, dur: 3 * D }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(2, [attrs({ divisions: false, time: [6, 8] }), n(null, null, { measureRest: true, dur: 3 * D }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })], { barRight: finalBar() })
]);

E['E30-hidden-cue'] = () => pianoScore('Hidden and cue notes', 'a note and a rest the file hides, and a cue-sized note', [
  measure(1, [piano(), n('C5', 'quarter'), n('D5', 'quarter', { hidden: true }), n(null, 'quarter', { hidden: true }), n('F5', 'quarter', { cue: true }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E31-noteheads'] = () => pianoScore('Noteheads', 'x, diamond, slash, and a head in parentheses', [
  measure(1, [piano(), n('C5', 'quarter', { notehead: { shape: 'x' } }), n('D5', 'quarter', { notehead: { shape: 'diamond' } }),
    n('B4', 'quarter', { notehead: { shape: 'slash' } }), n('F5', 'quarter', { notehead: { shape: 'normal', paren: true } }), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E32-accidentals-cautionary'] = () => pianoScore('Cautionary and bracketed accidentals', 'a cautionary natural, one in parentheses, an editorial one in brackets', [
  measure(1, [piano(), n('F#5', 'half', { acc: 'sharp' }), n('F#5', 'half'), ...lhWhole('D3')]),
  measure(2, [n('F5', 'quarter', { acc: 'natural', cautionary: true }), n('C#5', 'quarter', { acc: 'sharp', paren: true }), n('Bb4', 'half', { acc: 'flat', bracket: true }), ...lhWhole('D3')], { barRight: finalBar() })
]);

E['E33-accidental-chord'] = () => pianoScore('A chord of many accidentals', 'six heads with accidentals: the column zig-zags', [
  measure(1, [piano(), n('C#4', 'whole', { acc: 'sharp' }), ...['Eb4', 'F#4', 'Ab4', 'B#4', 'Db5'].map(p => n(p, 'whole', { chord: true, acc: /#/.test(p) ? 'sharp' : 'flat' })), ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E34-ledger-lines'] = () => pianoScore('Ledger lines', 'notes far above and below the staves', [
  measure(1, [piano(), n('A6', 'quarter'), n('C7', 'quarter'), n('E7', 'quarter'), n('A3', 'quarter'), backup(4 * D),
    n('C2', 'quarter', { voice: 5, staff: 2 }), n('A1', 'quarter', { voice: 5, staff: 2 }), n('E1', 'quarter', { voice: 5, staff: 2 }), n('E4', 'quarter', { voice: 5, staff: 2 })], { barRight: finalBar() })
]);

E['E35-voice-and-piano'] = () => score('Voice and piano', 'three staves: a sung line with words over a piano', [
  { id: 'P1', name: 'Voice', abbr: 'V.', measures: [
    measure(1, [single(), n('E5', 'half', { lyric: { syllabic: 'single', text: 'Lo' } }), n('D5', 'half', { lyric: { syllabic: 'single', text: 'how' } })]),
    measure(2, [n('C5', 'whole', { lyric: { syllabic: 'single', text: 'a' } })], { barRight: finalBar() })] },
  { id: 'P2', name: 'Piano', abbr: 'Pno.', measures: [
    measure(1, [piano(), n('C5', 'half'), n('E5', 'half', { chord: true }), n('B4', 'half'), n('D5', 'half', { chord: true }), ...lhWhole('C3')]),
    measure(2, [n('C5', 'whole'), n('E5', 'whole', { chord: true }), ...lhWhole('C3')], { barRight: finalBar() })] }
]);

E['E36-pickup-implicit'] = () => pianoScore('A pickup and an implicit bar', 'an upbeat numbered 0, and a bar split around a repeat', [
  measure(0, [piano({ time: [3, 4] }), n('G4', 'quarter'), backup(D), n(null, 'quarter', { voice: 5, staff: 2 })], { implicit: true }),
  measure(1, [n('C5', 'half', { dots: 1 }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(2, [n('E5', 'half'), backup(2 * D), n('C3', 'half', { voice: 5, staff: 2 })], { barRight: repeatR() }),
  measure('X1', [n('G5', 'quarter'), backup(D), n('G2', 'quarter', { voice: 5, staff: 2 })], { implicit: true, barRight: finalBar() })
]);

E['E37-long'] = () => {
  const ms = [];
  const scale = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
  for (let k = 1; k <= 64; k++) {
    const up = k % 2 === 1;
    const ps = up ? scale : scale.slice().reverse();
    ms.push(measure(k, [...(k === 1 ? [piano()] : []), ...eighths(ps, 4), backup(4 * D), n(k % 4 === 0 ? 'G2' : 'C3', 'half', { voice: 5, staff: 2 }), n('G3', 'half', { voice: 5, staff: 2 })],
      k === 64 ? { barRight: finalBar() } : {}));
  }
  return pianoScore('A long piece', 'sixty-four bars of scales: for performance and determinism', ms);
};

E['E38-recording-shape'] = () => pianoScore('The G3-off recording shape', 'what PPP writes from a recording with G3 off: no beams, a bracket per triplet piece, a 64th rest, a tie inside the bar, a changed pedal', [
  measure(1, [piano(), dir('<pedal type="start" line="yes" sign="no"/>', { placement: 'below', staff: 2 }),
    ...['C5', 'E5', 'G5'].map(p => trip(p, 0, { tuplets: [{ type: 'start' }, { type: 'stop' }] })),
    n('C6', 'eighth', { tie: ['start'], dur: D / 2 }), n('C6', '16th', { tie: ['stop'], dots: 2 }), n(null, '64th'),
    dir('<pedal type="change" line="yes"/>', { placement: 'below', staff: 2 }),
    n('B5', 'eighth'), n('A5', 'eighth'), n('G5', 'quarter'),
    backup(4 * D), n('C3', 'half', { voice: 5, staff: 2 }), n('G3', 'half', { voice: 5, staff: 2 }),
    dir('<pedal type="stop" line="yes" sign="no"/>', { placement: 'below', staff: 2 })], { barRight: finalBar() })
]);

E['E39-g3a-shape'] = () => pianoScore('The G3a shape', 'graph beams, a logical triplet of three, and two voices in the right hand', [
  measure(1, [piano(),
    trip('C5', 0, { tuplet: { type: 'start', bracket: false }, beams: [[1, 'begin']], voice: 1 }), trip('D5', 1, { beams: [[1, 'continue']], voice: 1 }), trip('E5', 2, { tuplet: { type: 'stop' }, beams: [[1, 'end']], voice: 1 }),
    n('F5', 'eighth', { beams: [[1, 'begin']], voice: 1 }), n('G5', 'eighth', { beams: [[1, 'end']], voice: 1 }), n('A5', 'half', { voice: 1 }),
    backup(4 * D), n('C5', 'half', { voice: 2, stem: 'down' }), n('F4', 'half', { voice: 2, stem: 'down' }),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

E['E40-arpeggio-gliss'] = () => pianoScore('Arpeggios and glissandi', 'an arpeggio up, one down, a bracket against arpeggiating; a wavy glissando and a slide', [
  measure(1, [piano(),
    n('C5', 'quarter', { arp: 'up' }), n('E5', 'quarter', { chord: true, arp: 'up' }), n('G5', 'quarter', { chord: true, arp: 'up' }),
    n('D5', 'quarter', { arp: 'down' }), n('F5', 'quarter', { chord: true, arp: 'down' }),
    n('E5', 'quarter', { arp: 'non' }), n('G5', 'quarter', { chord: true, arp: 'non' }),
    n('C5', 'eighth', { gliss: { type: 'start', line: 'wavy' } }), n('C6', 'eighth', { gliss: { type: 'stop' } }),
    backup(4 * D), n('C3', 'half', { voice: 5, staff: 2, slide: { type: 'start' } }), n('G3', 'half', { voice: 5, staff: 2, slide: { type: 'stop' } })], { barRight: finalBar() })
]);

/* ------------------------------------------------------------------ write / check */
function build() { return Object.keys(E).sort().map(k => [k + '.musicxml', E[k]()]); }
if (require.main === module) {
  const check = process.argv.indexOf('--check') > 0;
  const files = build();
  if (files.length !== 40) throw new Error(files.length + ' fixtures, G04 §22.1 names 40');
  let bad = 0;
  if (!check) fs.mkdirSync(OUT, { recursive: true });
  files.forEach(([name, text]) => {
    const p = path.join(OUT, name);
    if (check) {
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
      if (cur !== text) { bad++; console.log('DIFFERS ' + name); }
    } else fs.writeFileSync(p, text);
  });
  if (check) { console.log(bad ? bad + ' of 40 differ' : 'the 40 E fixtures are what this tool writes'); process.exit(bad ? 1 : 0); }
  console.log('wrote ' + files.length + ' fixtures to ' + path.relative(process.cwd(), OUT));
}
module.exports = { build, D };
