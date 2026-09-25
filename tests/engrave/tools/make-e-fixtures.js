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
   tuplet {type, number, bracket, show, placement}, stem, acc, cautionary, paren, arts [...], orn [...], fermata (true | a shape),
   fingering [[f, placement]], slurs [{type, number, placement}], lyric {syllabic, text}, lyrics [{number, syllabic, text}],
   notehead {shape, paren},
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
  if (o.fermata) nt.push(o.fermata === true ? '<fermata type="upright"/>' : '<fermata type="upright">' + o.fermata + '</fermata>');
  if (o.fingering) nt.push('<technical>' + o.fingering.map(([f, pl]) => '<fingering' + (pl ? ' placement="' + pl + '"' : '') + '>' + f + '</fingering>').join('') + '</technical>');
  if (o.arp) nt.push(o.arp === 'non' ? '<non-arpeggiate type="bottom"/>' : '<arpeggiate' + (o.arp === 'up' || o.arp === 'down' ? ' direction="' + o.arp + '"' : '') + '/>');
  if (o.gliss) nt.push('<glissando type="' + o.gliss.type + '" number="1"' + (o.gliss.line ? ' line-type="' + o.gliss.line + '"' : '') + '/>');
  if (o.slide) nt.push('<slide type="' + o.slide.type + '" number="1"/>');
  if (nt.length) x.push('<notations>' + nt.join('') + '</notations>');
  if (o.lyric) x.push('<lyric number="1"><syllabic>' + o.lyric.syllabic + '</syllabic><text>' + esc(o.lyric.text) + '</text></lyric>');
  (o.lyrics || []).forEach(l => x.push('<lyric number="' + l.number + '"><syllabic>' + l.syllabic + '</syllabic><text>' + esc(l.text) + '</text></lyric>'));
  x.push('</note>');
  return x.join('');
}
const backup = d => '<backup><duration>' + d + '</duration></backup>';
const dir = (inner, o) => { o = o || {}; return '<direction' + (o.placement ? ' placement="' + o.placement + '"' : '') + '><direction-type>' + inner + '</direction-type>' +
  (o.staff ? '<staff>' + o.staff + '</staff>' : '') + (o.sound ? '<sound ' + o.sound + '/>' : '') + '</direction>'; };
const dyn = (v, staff) => dir('<dynamics><' + v + '/></dynamics>', { placement: 'below', staff: staff || 1 });
const wedge = (t, staff) => dir('<wedge type="' + t + '"/>', { placement: 'below', staff: staff || 1 });
const words = (t, staff) => dir('<words>' + esc(t) + '</words>', { placement: 'above', staff: staff || 1 });
/* G4d-1b: a dynamics element as the file writes it (one or more marks), with or without a placement and a staff; a pedal mark
   under the lower staff; a tempo's words and metronome mark; a rehearsal mark; a chord symbol */
const dynDir = (inner, placement, staff) => dir('<dynamics>' + inner + '</dynamics>', { placement: placement, staff: staff });
const ped = inner => dir(inner, { placement: 'below', staff: 2 });
const tempoMark = (w, unit, per, parens) => '<direction placement="above"><direction-type><words>' + esc(w) + '</words></direction-type><direction-type><metronome' +
  (parens ? ' parentheses="yes"' : '') + '><beat-unit>' + unit + '</beat-unit><per-minute>' + per + '</per-minute></metronome></direction-type><staff>1</staff>' +
  '<sound tempo="' + per + '"/></direction>';
/* the G4d-1b fixer (R1): words a file prints around a metronome mark in one direction - "Più mosso (", the mark, ")" */
const tempoAround = (before, unit, per, after) => '<direction placement="above"><direction-type><words>' + esc(before) + '</words></direction-type>' +
  '<direction-type><metronome><beat-unit>' + unit + '</beat-unit><per-minute>' + per + '</per-minute></metronome></direction-type>' +
  '<direction-type><words>' + esc(after) + '</words></direction-type><staff>1</staff><sound tempo="' + per + '"/></direction>';
const harm = (step, alter, kind, bass) => '<harmony><root><root-step>' + step + '</root-step>' + (alter ? '<root-alter>' + alter + '</root-alter>' : '') + '</root><kind>' +
  kind + '</kind>' + (bass ? '<bass><bass-step>' + bass[0] + '</bass-step>' + (bass[1] ? '<bass-alter>' + bass[1] + '</bass-alter>' : '') + '</bass>' : '') + '</harmony>';
const beam4 = i => [[1, i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue']];
const beam16 = i => [[1, i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue'], [2, i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue']];

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

/* G4d-1a (G4-L4: a tie's direction by its head's place in its own chord; each end nearer its own head than any other): then
   chords tied whole - four heads (two up, two down), three with a second (the middle one away from the stem, the displaced
   head's tie beside it), three dotted (the ties after the dots) - and a tie into a chord whose sharp stands over the tied
   head's height (the end clears the accidental and stays by its head) */
const chord = (ps, type, o, each) => ps.map((p, i) => n(p, type, Object.assign({}, o || {}, i ? { chord: true } : {}, (each || [])[i] || {})));
const tied = (k, t) => Array.from({ length: k }, () => ({ tie: [t] }));
E['E08-tie-partial-chord'] = () => pianoScore('A tie from part of a chord', 'only the E of C-E-G is tied on; then whole chords tied: ' +
  'four heads, three with a second, three dotted; and a tie into a chord whose sharp stands over the tied head', [
  measure(1, [piano(), n('C5', 'half'), n('E5', 'half', { chord: true, tie: ['start'] }), n('G5', 'half', { chord: true }),
    n('D5', 'half'), n('E5', 'half', { chord: true, tie: ['stop'] }), n('A5', 'half', { chord: true }), ...lhWhole('C3')]),
  measure(2, [...chord(['C5', 'E5', 'G5', 'C6'], 'half', {}, tied(4, 'start')), ...chord(['C5', 'E5', 'G5', 'C6'], 'half', {}, tied(4, 'stop')),
    ...lhWhole('C3')]),
  measure(3, [...chord(['E4', 'G4', 'A4'], 'half', {}, tied(3, 'start')), ...chord(['E4', 'G4', 'A4'], 'half', {}, tied(3, 'stop')), ...lhWhole('A2')]),
  measure(4, [...chord(['B4', 'D5', 'F5'], 'half', { dots: 1 }, tied(3, 'start')), ...chord(['B4', 'D5', 'F5'], 'quarter', {}, tied(3, 'stop')),
    ...lhWhole('G2')]),
  measure(5, [n('C5', 'half'), ...chord(['D5', 'F#5'], 'half', {}, [{ tie: ['start'] }, { acc: 'sharp' }]), ...lhWhole('D3')]),
  measure(6, [...chord(['D5', 'F#5'], 'half', {}, [{ tie: ['stop'] }, { acc: 'sharp' }]), n('C5', 'half'), ...lhWhole('D3')], { barRight: finalBar() })
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

/* G4d-1a (§13.2's side; the review's RV20): then a slur over notes that all stem up - below them; and two voices, each with
   its slur - the upper voice's above (its stems up), the lower voice's below (its stems down) */
E['E10-slurs-overlap'] = () => pianoScore('Overlapping slurs', 'slur 1 over notes 1-3, slur 2 over notes 2-4; then a slur over stems that all ' +
  'point up; then a slur in each of two voices', [
  measure(1, [piano(), n('C5', 'quarter', { slurs: [{ type: 'start', number: 1 }] }), n('D5', 'quarter', { slurs: [{ type: 'start', number: 2 }] }),
    n('E5', 'quarter', { slurs: [{ type: 'stop', number: 1 }] }), n('F5', 'quarter', { slurs: [{ type: 'stop', number: 2 }] }), ...lhWhole('C3')]),
  measure(2, [n('E4', 'quarter', { slurs: [{ type: 'start' }] }), n('F4', 'quarter'), n('G4', 'quarter'), n('A4', 'quarter', { slurs: [{ type: 'stop' }] }),
    ...lhWhole('C3')]),
  measure(3, [n('C5', 'quarter', { voice: 1, slurs: [{ type: 'start' }] }), n('D5', 'quarter', { voice: 1 }), n('E5', 'quarter', { voice: 1 }),
    n('F5', 'quarter', { voice: 1, slurs: [{ type: 'stop' }] }),
    backup(4 * D),
    n('F4', 'quarter', { voice: 2, slurs: [{ type: 'start', number: 2 }] }), n('G4', 'quarter', { voice: 2 }), n('A4', 'quarter', { voice: 2 }),
    n('B4', 'quarter', { voice: 2, slurs: [{ type: 'stop', number: 2 }] }),
    ...lhWhole('C3')], { barRight: finalBar() })
]);

/* G4d-1a (§13.2 across breaks; the review's RV23): then a phrase slur over six bars of sixteenths - at every screen width
   it spans three systems or more, so it has a middle part in each system between its halves */
const SCALE16 = ['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5', 'C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'];
const run16 = (ps, first, last) => ps.map((p, i) => {
  const b = i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue';
  const sl = i === 0 && first ? [{ type: 'start', number: 3 }] : i === ps.length - 1 && last ? [{ type: 'stop', number: 3 }] : [];
  return n(p, '16th', { beams: [[1, b], [2, b]], slurs: sl });
});
E['E11-slur-rest-system'] = () => pianoScore('A slur over a rest and a system break', 'the slur goes from a note past a rest; a second one crosses the break; ' +
  'then a phrase slur over six bars of sixteenths, across three systems or more', [
  measure(1, [piano(), n('C5', 'quarter', { slurs: [{ type: 'start', placement: 'above' }] }), n(null, 'quarter'), n('E5', 'quarter', { slurs: [{ type: 'stop' }] }),
    n('G5', 'quarter', { slurs: [{ type: 'start', number: 2 }] }), ...lhWhole('C3')]),
  measure(2, [n('F5', 'half'), n('D5', 'half', { slurs: [{ type: 'stop', number: 2 }] }), ...lhWhole('G2')], { newSystem: true }),
  ...[3, 4, 5, 6, 7, 8].map(k => measure(k, [...run16(SCALE16, k === 3, k === 8), ...lhWhole(k % 2 ? 'C3' : 'G2')], k === 8 ? { barRight: finalBar() } : {}))
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
  'then an angled and a square fermata; then a trill, an inverted mordent, a turn over a detached-legato, a tremolo and a breath mark, and a ' +
  'fermata over the final bar line', [
  measure(1, [piano(),
    n('C5', 'quarter', { arts: ['staccato'], slurs: [{ type: 'start' }] }), n('D5', 'quarter', { arts: ['tenuto'] }),
    n('E5', 'quarter', { arts: ['accent'] }), n('F5', 'quarter', { arts: ['strong-accent'], slurs: [{ type: 'stop' }] }), ...lhWhole('C3')]),
  measure(2, [n('G5', 'half', { arts: ['staccato', 'accent'] }), n('C6', 'half', { fermata: true }), ...lhWhole('C3', { fermata: true })]),
  /* G4d-1a (the review's RV19): a fermata of each shape MusicXML names - angled (short) and square (long) */
  measure(3, [n('E5', 'half', { fermata: 'angled' }), n('D5', 'half', { fermata: 'square' }), ...lhWhole('G2')]),
  /* G4d-1a: ornaments, a tremolo, a composite articulation, one drawn after its note, and a fermata over a bar line (§10.2
     priority 5) */
  measure(4, [n('E5', 'quarter', { orn: ['trill-mark'] }), n('D5', 'quarter', { orn: ['inverted-mordent'] }),
    n('C5', 'quarter', { orn: ['turn'], arts: ['detached-legato'] }), n('B4', 'quarter', { orn: ['tremolo'], arts: ['breath-mark'] }), ...lhWhole('G2')],
  { barRight: '<barline location="right"><bar-style>light-heavy</bar-style><fermata type="upright"/></barline>' })
]);

/* G4d-1b (G04 §10.2 priority 8, §10.4 S2 and S5, §10.5): a diminuendo over five bars, so it crosses a system break at every
   screen width; words where the dynamics stand; a dynamic the graph puts above the upper staff and one below the lower; two
   dynamics a sixteenth apart (the second goes one line further out); p dolce, two marks of one dynamics element */
E['E16-dynamics-hairpins'] = () => pianoScore('Dynamics and hairpins', 'p, a crescendo to f, a diminuendo over five bars across a system break at every ' +
  'width to pp; cresc. by the dynamics, mf above the upper staff and p below the lower one; sfz and ff a sixteenth apart; p dolce', [
  measure(1, [piano(), dyn('p'), wedge('crescendo'), n('C5', 'quarter'), n('D5', 'quarter'), n('E5', 'quarter'), wedge('stop'), dyn('f'), n('F5', 'quarter'), ...lhWhole('C3')]),
  measure(2, [wedge('diminuendo'), n('G5', 'half'), n('E5', 'half'), ...lhWhole('C3')]),
  measure(3, [n('D5', 'whole'), ...lhWhole('G2')], { newSystem: true }),
  measure(4, [n('C5', 'whole'), ...lhWhole('A2')]),
  measure(5, [n('B4', 'whole'), ...lhWhole('G2')]),
  measure(6, [n('D5', 'half'), wedge('stop'), dyn('pp'), n('C5', 'half'), ...lhWhole('C3')]),
  measure(7, [dir('<words>cresc.</words>', { placement: 'below', staff: 1 }), n('E5', 'quarter'), n('F5', 'quarter'), dynDir('<mf/>', 'above', 1), n('G5', 'half'),
    backup(4 * D), n('C3', 'half', { voice: 5, staff: 2 }), dynDir('<p/>', 'below', 2), n('G2', 'half', { voice: 5, staff: 2 })]),
  measure(8, [dyn('sfz'), n('C6', '16th', { beams: beam16(0) }), dyn('ff'), n('B5', '16th', { beams: beam16(1) }), n('A5', '16th', { beams: beam16(2) }),
    n('G5', '16th', { beams: beam16(3) }), n('F5', 'quarter'), dynDir('<p/><other-dynamics>dolce</other-dynamics>', 'below', 1), n('E5', 'half'), ...lhWhole('C3')],
  { barRight: finalBar() })
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

/* G4d-1b (§15.4): then bars so clef changes meet system breaks - the treble clef back at bar 5, a break at the desktop and the
   phone widths (and bar 3 one on the phone): the system before ends with the small clef, before its last bar line */
E['E19-clefs'] = () => pianoScore('Clef changes', 'a change inside a bar, one at a bar line, an alto clef, a treble clef an octave down; then the treble ' +
  'clef back at a system break', [
  measure(1, [piano(), n('C5', 'half'), n('E5', 'half'), backup(4 * D), n('C3', 'half', { voice: 5, staff: 2 }),
    attrs({ divisions: false, clefs: [['G', 2]], clefNumber: 2 }), n('C4', 'half', { voice: 5, staff: 2 })]),
  measure(2, [attrs({ divisions: false, clefs: [['C', 3]], clefNumber: 1 }), n('C4', 'whole'), ...lhWhole('E4')]),
  measure(3, [attrs({ divisions: false, clefs: [['G', 2, -1]], clefNumber: 1 }), n('C4', 'whole'), backup(4 * D),
    attrs({ divisions: false, clefs: [['F', 4]], clefNumber: 2 }), n('C3', 'whole', { voice: 5, staff: 2 })]),
  measure(4, [n('E4', 'whole'), ...lhWhole('G2')]),
  measure(5, [attrs({ divisions: false, clefs: [['G', 2]], clefNumber: 1 }), n('C5', 'whole'), ...lhWhole('C3')]),
  measure(6, [n('E5', 'whole'), ...lhWhole('C3')], { barRight: finalBar() })
]);

/* G4d-1b (§15.4): the change is at bar 5, a system break at the desktop and the phone widths - the system before ends with the
   courtesy signature */
E['E20-key-change'] = () => pianoScore('A key change with cancellation', 'three sharps to one flat, at a system break', [
  measure(1, [piano({ key: 3 }), n('A4', 'quarter'), n('C#5', 'quarter'), n('E5', 'half'), ...lhWhole('A2')]),
  measure(2, [n('F#5', 'whole'), ...lhWhole('A2')]),
  measure(3, [n('E5', 'half'), n('C#5', 'half'), ...lhWhole('E2')]),
  measure(4, [n('A4', 'whole'), ...lhWhole('A2')]),
  measure(5, [attrs({ divisions: false, key: -1 }), n('F5', 'quarter'), n('A5', 'quarter'), n('C6', 'half'), ...lhWhole('F2')], { newSystem: true }),
  measure(6, [n('F5', 'whole'), ...lhWhole('F2')], { barRight: finalBar() })
]);

/* G4d-1b (§15.4): eight bars, so meter changes meet system breaks - cut time at bar 5 at the desktop and the phone widths, common
   time at bar 3 on the phone; the systems before end with the courtesy meter */
E['E21-meter'] = () => pianoScore('Meter changes and symbols', '4/4, 3/4, common time, cut time, and a hidden meter', [
  measure(1, [piano(), n('C5', 'whole'), ...lhWhole('C3')]),
  measure(2, [attrs({ divisions: false, time: [3, 4] }), n('D5', 'half', { dots: 1 }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(3, [attrs({ divisions: false, time: 'common' }), n('E5', 'whole'), ...lhWhole('C3')]),
  measure(4, [n('D5', 'whole'), ...lhWhole('G2')]),
  measure(5, [attrs({ divisions: false, time: 'cut' }), n('F5', 'whole'), ...lhWhole('C3')]),
  measure(6, [n('E5', 'whole'), ...lhWhole('C3')]),
  measure(7, [attrs({ divisions: false, time: [4, 4], hiddenTime: true }), n('G5', 'whole'), ...lhWhole('C3')]),
  measure(8, [n('C5', 'whole'), ...lhWhole('C3')], { barRight: finalBar() })
]);

/* G4d-1b (A8): a tempo's words and metronome mark in parentheses, and a rehearsal mark; its fixer (R1): the words a file prints
   around a metronome mark, as Czerny's and Hanon's editions do - "Più mosso (" before it and ")" after, "(M.M. " and " to 72.)" */
E['E22-repeats-jumps'] = () => pianoScore('Repeats, voltas and jumps', 'a repeat with first and second endings, segno, coda, D.S. al Coda, Fine; ' +
  'a tempo with its metronome mark, a rehearsal mark; words printed around a metronome mark', [
  measure(1, [piano(), tempoMark('Allegro', 'quarter', 120, true), dir('<segno/>', { placement: 'above' }), n('C5', 'whole'), ...lhWhole('C3')], { barLeft: repeatL() }),
  measure(2, [n('D5', 'whole'), ...lhWhole('G2')], { barLeft: endingStart(1), barRight: repeatR(1) }),
  measure(3, [n('E5', 'whole'), words('Fine'), ...lhWhole('C3')], { barLeft: endingStart(2), barRight: endingStop(2, 'discontinue') }),
  measure(4, [dir('<rehearsal>A</rehearsal>', { placement: 'above', staff: 1 }), n('F5', 'half'), dir('<words>To Coda</words>', { placement: 'above', sound: 'tocoda="coda1"' }),
    n('G5', 'half'), ...lhWhole('F2')]),
  measure(5, [tempoAround('Più mosso (', 'quarter', 132, ')'), n('A5', 'whole'), dir('<words>D.S. al Coda</words>', { placement: 'above', sound: 'dalsegno="segno1"' }), ...lhWhole('F2')],
    { barRight: '<barline location="right"><bar-style>light-light</bar-style></barline>' }),
  measure(6, [dir('<coda/>', { placement: 'above', sound: 'coda="coda1"' }), tempoAround('(M.M. ', 'quarter', 60, ' to 72.)'), n('C6', 'whole'), ...lhWhole('C3')],
    { barRight: finalBar() })
]);

/* G4d-1a (G4-L5: fingering by its notes, inside the slur; the review's RV9 and §10.5): then sixteenths under a phrase slur with
   a finger each - some fingers (a change of finger, "4-3") wider than their heads, so the spacing must give them room - and
   a note so high its finger stands more than 8 sp from the staff (FAR_PLACEMENT) */
const FING16 = [['E5', '1'], ['F5', '2'], ['G5', '3'], ['A5', '4-3'], ['G5', '2-1'], ['F5', '3'], ['E5', '2'], ['D5', '1']];
E['E23-fingering'] = () => pianoScore('Printed fingering', 'a three-note chord with a finger on each head, fingers above in the right hand and below in the left; ' +
  'then fingered sixteenths under a slur, some fingers wider than their heads; then a finger over a note far above the staff', [
  measure(1, [piano(), n('C5', 'half', { fingering: [['1', 'above']] }), n('E5', 'half', { chord: true, fingering: [['3', 'above']] }), n('G5', 'half', { chord: true, fingering: [['5', 'above']] }),
    n('F5', 'quarter', { fingering: [['4']] }), n('E5', 'quarter', { fingering: [['3']] }),
    backup(4 * D), n('C3', 'half', { voice: 5, staff: 2, fingering: [['5', 'below']] }), n('G3', 'half', { voice: 5, staff: 2, fingering: [['1', 'below']] })]),
  measure(2, [...FING16.map(([p, f], i) => n(p, '16th', { fingering: [[f]], beams: [[1, i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue'], [2, i % 4 === 0 ? 'begin' : i % 4 === 3 ? 'end' : 'continue']],
    slurs: i === 0 ? [{ type: 'start' }] : i === FING16.length - 1 ? [{ type: 'stop' }] : [] })), n('C5', 'half', { fingering: [['1']] }),
    backup(4 * D), n('C3', 'whole', { voice: 5, staff: 2, fingering: [['5']] })]),
  measure(3, [n('A7', 'quarter', { fingering: [['5']] }), n(null, 'quarter'), n('C5', 'half'), ...lhWhole('C3')], { barRight: finalBar() })
]);

/* G4d-1b (A12): then two verses, each word over two notes (a hyphen between its syllables), a syllable wider than its note */
const verses = (a, b) => [{ number: 1, syllabic: a[0], text: a[1] }, { number: 2, syllabic: b[0], text: b[1] }];
E['E24-lyrics'] = () => score('Lyrics', 'one verse under a melody, a word over two notes; then two verses', [
  { id: 'P1', name: 'Voice', measures: [measure(1, [single(), n('C5', 'quarter', { lyric: { syllabic: 'single', text: 'Sing' } }),
    n('D5', 'quarter', { lyric: { syllabic: 'begin', text: 'hap' } }), n('E5', 'half', { lyric: { syllabic: 'end', text: 'py' } })]),
  measure(2, [n('G5', 'quarter', { lyrics: verses(['begin', 'love'], ['begin', 'sun']) }), n('F5', 'quarter', { lyrics: verses(['end', 'ly'], ['end', 'ny']) }),
    n('E5', 'eighth', { lyrics: verses(['single', 'bright'], ['single', 'through']) }), n('D5', 'eighth', { lyrics: verses(['single', 'the'], ['single', 'a']) }),
    n('C5', 'quarter', { lyrics: verses(['single', 'day'], ['single', 'way']) })], { barRight: finalBar() })] }
]);

/* G4d-1b (§10.5): then a chord symbol on every eighth, long ones among them - too close for their places, so each is pushed right
   of the one before, in order */
const CH8 = [['C', 0, 'major-seventh'], ['F', 1, 'half-diminished'], ['B', -1, 'dominant', ['D', 0]], ['E', 0, 'minor-seventh'], ['A', 0, 'dominant', ['C', 1]],
  ['D', 0, 'minor'], ['G', 0, 'suspended-fourth'], ['C', 0, 'major', ['E', 0]]];
E['E25-chords-dense'] = () => pianoScore('Chord symbols, dense', 'a chord symbol on every beat; then on every eighth, too close for their places', [
  measure(1, [piano(), ...['C', 'Am', 'F', 'G7'].map((c, i) => {
    const m = /^([A-G])(.*)$/.exec(c);
    const kind = m[2] === 'm' ? 'minor' : m[2] === '7' ? 'dominant' : 'major';
    return '<harmony><root><root-step>' + m[1] + '</root-step></root><kind>' + kind + '</kind></harmony>' + n(['C5', 'A4', 'F5', 'G5'][i], 'quarter');
  }), ...lhWhole('C3')]),
  measure(2, [...CH8.map(([st, al, kind, bass], i) => harm(st, al, kind, bass && [bass[0], bass[1]]) + n(['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'][i], 'eighth', { beams: beam4(i) })),
    ...lhWhole('C3')]),
  /* two chord symbols over one half note, the second an eighth later where no note starts: it would stand inside the first
     name, so it is pushed right of it */
  measure(3, [harm('C', 0, 'major-seventh'), '<harmony><root><root-step>A</root-step></root><kind>minor-seventh</kind><offset>' + (D / 2) + '</offset></harmony>',
    n('E5', 'half'), n('D5', 'half'), ...lhWhole('C3')], { barRight: finalBar() })
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

/* G4d-1b: the voice's dynamic with no placement stands above its staff, the piano's between its staves; a chord symbol over the
   voice */
E['E35-voice-and-piano'] = () => score('Voice and piano', 'three staves: a sung line with words over a piano; a dynamic in each part, a chord symbol over the voice', [
  { id: 'P1', name: 'Voice', abbr: 'V.', measures: [
    measure(1, [single(), dynDir('<mf/>'), harm('C', 0, 'major'), n('E5', 'half', { lyric: { syllabic: 'single', text: 'Lo' } }), harm('G', 0, 'major', ['B', 0]),
      n('D5', 'half', { lyric: { syllabic: 'single', text: 'how' } })]),
    measure(2, [harm('C', 0, 'major'), n('C5', 'whole', { lyric: { syllabic: 'single', text: 'a' } })], { barRight: finalBar() })] },
  { id: 'P2', name: 'Piano', abbr: 'Pno.', measures: [
    measure(1, [piano(), dynDir('<p/>'), n('C5', 'half'), n('E5', 'half', { chord: true }), n('B4', 'half'), n('D5', 'half', { chord: true }), ...lhWhole('C3')]),
    measure(2, [n('C5', 'whole'), n('E5', 'whole', { chord: true }), ...lhWhole('C3')], { barRight: finalBar() })] }
]);

E['E36-pickup-implicit'] = () => pianoScore('A pickup and an implicit bar', 'an upbeat numbered 0, and a bar split around a repeat', [
  measure(0, [piano({ time: [3, 4] }), n('G4', 'quarter'), backup(D), n(null, 'quarter', { voice: 5, staff: 2 })], { implicit: true }),
  measure(1, [n('C5', 'half', { dots: 1 }), backup(3 * D), n('C3', 'half', { dots: 1, voice: 5, staff: 2 })]),
  measure(2, [n('E5', 'half'), backup(2 * D), n('C3', 'half', { voice: 5, staff: 2 })], { barRight: repeatR() }),
  measure('X1', [n('G5', 'quarter'), backup(D), n('G2', 'quarter', { voice: 5, staff: 2 })], { implicit: true, barRight: finalBar() })
]);

/* G4d-1b (A9, A10 at a system break - E17 and E18 stay as MX-1's playback tests hold them): a sign pedal changed in bar 3 (the
   release and the press again); an 8va over bars 7-10 and a line pedal over bars 11-14, changed in bar 13 - both cross a
   system break at every screen width ("(8)" where the line goes on) */
E['E37-long'] = () => {
  const ms = [];
  const scale = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
  /* marks before the eighth at index i of bar k */
  const at = {
    3: { 0: [ped('<pedal type="start" line="no" sign="yes"/>')], 4: [ped('<pedal type="change" line="no" sign="yes"/>')] },
    4: { 0: [ped('<pedal type="stop" line="no" sign="yes"/>')] },
    7: { 0: [dir('<octave-shift type="down" size="8" number="1"/>', { placement: 'above', staff: 1 })] },
    11: { 0: [dir('<octave-shift type="stop" size="8" number="1"/>', { staff: 1 }), ped('<pedal type="start" line="yes" sign="no"/>')] },
    13: { 2: [ped('<pedal type="change" line="yes"/>')] },
    15: { 0: [ped('<pedal type="stop" line="yes" sign="no"/>')] }
  };
  for (let k = 1; k <= 64; k++) {
    const up = k % 2 === 1;
    const ps = up ? scale : scale.slice().reverse();
    const rh = [];
    eighths(ps, 4).forEach((x, i) => { ((at[k] || {})[i] || []).forEach(d => rh.push(d)); rh.push(x); });
    ms.push(measure(k, [...(k === 1 ? [piano()] : []), ...rh, backup(4 * D), n(k % 4 === 0 ? 'G2' : 'C3', 'half', { voice: 5, staff: 2 }), n('G3', 'half', { voice: 5, staff: 2 })],
      k === 64 ? { barRight: finalBar() } : {}));
  }
  return pianoScore('A long piece', 'sixty-four bars of scales: for performance and determinism; a sign pedal changed, an 8va and a line pedal across ' +
    'system breaks', ms);
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
