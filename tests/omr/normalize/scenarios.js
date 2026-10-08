/* The planted defects of omr/normalize.js (G12-1), each as a SCENARIO: the pages an engine would write for some music, the way it has been seen to
   split it, and the answer a correct normaliser gives (computed from the same music written as one grand staff, never from the normaliser).
   normalize.test.js asserts every scenario against the real module; mutation.test.js runs the same scenarios against copies of the module with one
   line broken and asserts that each broken copy gives a different answer to at least one of them. */
'use strict';
const L = require('./lib.js');
const { note, rest, back, fwd, raw, bar, part, doc, read, sigs } = L;

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const P = deg => NAMES[((deg % 7) + 7) % 7] + Math.floor(deg / 7);

/* bar i (0-based) of a little piece in 4/4: the right hand four quarters, the left hand two halves; no two bars alike */
const rhOf = (i, o) => [0, 1, 2, 3].map(k => note(P(35 + (i % 5) + k + (o || 0)), 1, { s: 1, v: 1 }));
const lhOf = (i, o) => [0, 4].map(k => note(P(21 + (i % 4) + k), 2, { s: 2, v: 5 }));
const rhBar = (i, extra) => Object.assign({ items: rhOf(i).map(n => Object.assign({}, n, { s: undefined })) }, extra);
const lhBar = (i, extra) => Object.assign({ items: lhOf(i).map(n => Object.assign({}, n, { s: undefined, v: 1 })) }, extra);
/* a grand-staff bar: both hands in one part */
const grandBar = (i, extra) => Object.assign({ items: rhOf(i).concat([back(4)], lhOf(i)), staved: true }, extra);
const restBar = (extra) => Object.assign({ items: [rest(4, { measure: true, noType: true })] }, extra);
const restGrand = extra => Object.assign({ items: [rest(4, { measure: true, noType: true, s: 1 }), back(4), rest(4, { measure: true, noType: true, s: 2, v: 5 })], staved: true }, extra);

const first = (extra) => Object.assign({ div: 2, key: 0, time: [4, 4] }, extra);
const grandFirst = extra => first(Object.assign({ staves: 2, clefs: ['G', 'F'] }, extra));

/* ---- RICH bars: a chord, a grace note, a tie and a <forward>, the things a bar of the engine's has that a plain one does not ----
   Right hand, voice 1: a chord of two quarters at 0, a grace note before the tied quarter at 1 (tied into the quarter at 2), a quarter at 3;
   voice 2: a <forward> of a quarter, then a half note from 1 to 3 (so the right hand ends at 3 quarters, not 4: the <backup> to the left hand must be 3).
   Left hand, voice 5: a chord of two halves at 0, a quarter at 2 tied into the quarter at 3. */
const richRh = (i, o) => {
  const k = (i % 5) + (o || 0);
  return [note(P(35 + k), 1, { s: 1, v: 1 }), note(P(37 + k), 1, { chord: true, s: 1, v: 1 }),
    note(P(38 + k), 0, { grace: true, s: 1, v: 1 }), note(P(36 + k), 1, { s: 1, v: 1, tie: 'start' }), note(P(36 + k), 1, { s: 1, v: 1, tie: 'stop' }), note(P(34 + k), 1, { s: 1, v: 1 }),
    back(4), fwd(1), note(P(39 + k), 2, { s: 1, v: 2 })];
};
const richLh = i => {
  const k = i % 4;
  return [note(P(21 + k), 2, { s: 2, v: 5 }), note(P(25 + k), 2, { chord: true, s: 2, v: 5 }), note(P(26 + k), 1, { s: 2, v: 5, tie: 'start' }), note(P(26 + k), 1, { s: 2, v: 5, tie: 'stop' })];
};
const unstaff = n => (n.kind === 'note' ? Object.assign({}, n, { s: undefined, v: n.v >= 5 ? n.v - 4 : n.v }) : n);
const richGrandBar = (i, extra) => Object.assign({ items: richRh(i).concat([back(3)], richLh(i)), staved: true }, extra);
const richRhBar = (i, extra) => Object.assign({ items: richRh(i).map(unstaff) }, extra);
const richLhBar = (i, extra) => Object.assign({ items: richLh(i).map(unstaff) }, extra);

/* the one part of n bars [from, to) as a grand staff: the truth every scenario compares with */
function truthDoc(from, to, o) {
  const bars = [];
  for (let i = from; i < to; i++) bars.push(Object.assign({}, grandBar(i), i === from ? grandFirst(o) : {}));
  return doc([part('P1', bars, { div: 2, staved: true })], { names: ['Piano'] });
}
/* what the reader finds in a normalised (or truth) document: bars and staves of its first part and what is played in each bar */
function summary(xml) {
  const o = read(xml);
  const p = o.parts[0];
  return { parts: o.parts.length, staves: p.staves, bars: p.bars.length, sigs: sigs(p), numbers: p.bars.map(b => b.number).join(',') };
}
const truth = (from, to) => summary(truthDoc(from, to));
function truthDocRich(from, to) {
  const bars = [];
  for (let i = from; i < to; i++) bars.push(Object.assign({}, richGrandBar(i), i === from ? grandFirst() : {}));
  return doc([part('P1', bars, { div: 2, staved: true })], { names: ['Piano'] });
}
const truthRich = (from, to) => summary(truthDocRich(from, to));

/* one bar series of an engine page: the part's bars from i0 to i1 (exclusive) */
const series = (i0, i1, fn, o) => { const out = []; for (let i = i0; i < i1; i++) out.push(Object.assign({}, fn(i), i === i0 && o ? o : {})); return out; };

/* ------------------------------------------------------------------------------------------------ the scenarios */
const S = {};

/* a page Audiveris split into two movements (bars 0-2 and 3-4), each a clean grand staff */
S.movements = {
  why: 'every movement of a page is kept, in order (the old helper kept the last file)',
  pages: () => [[doc([part('P1', series(0, 3, grandBar, grandFirst()), { div: 2, staved: true })]), doc([part('P1', series(3, 5, grandBar, grandFirst()), { div: 2, staved: true })])]],
  expect: () => truth(0, 5)
};

/* two pages of one movement each, the second a different divisions (4) to the first (2): durations stay what they were */
S.pages = {
  why: 'pages are joined bar after bar and renumbered; a page with other divisions keeps its durations',
  pages: () => [doc([part('P1', series(0, 2, grandBar, grandFirst()), { div: 2, staved: true })]),
    doc([part('P1', series(2, 4, grandBar, grandFirst({ div: 4 })), { div: 4, staved: true })])],
  expect: () => truth(0, 4)
};

/* divisions 0: every note's <duration> is in half-note units (a half is 1, a whole 2), the types say so */
S.divisionsZero = {
  why: 'divisions 0 is read from the notes\' own types: a half note stays a half note',
  pages: () => {
    /* the bar of two half notes (RH) and a whole (LH), written with divisions 0 and durations 1 and 2, as Audiveris writes a page of half notes */
    const x = '<measure number="1" width="200"><attributes><divisions>0</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
      '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
      '<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note>' +
      '<note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note>' +
      '<backup><duration>2</duration></backup>' +
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure>';
    const y = x.replace('number="1"', 'number="2"').replace(/<attributes>.*<\/attributes>/, '').replace('<step>E</step>', '<step>F</step>');
    return [doc([part('P1', [x, y])])];
  },
  expect: () => ({ parts: 1, staves: 2, bars: 2, numbers: '1,2',
    sigs: ['1 0 2 E5 | 1 2 2 G5 | 2 0 4 C3', '1 0 2 F5 | 1 2 2 G5 | 2 0 4 C3'] })
};
/* divisions 0 and no note with a type to read it from: not guessed, said */
S.divisionsUnknown = {
  why: 'divisions 0 with nothing to read it from is flagged, not guessed',
  pages: () => [doc([part('P1', [{ items: [note('C4', 1, { noType: true }), note('D4', 1, { noType: true })], div: 0, time: [2, 4], clefs: ['G'] }], { div: 0 })])],
  expect: () => ({ flags: { 1: ['divisions-unknown'] } })
};

/* the grand staff read as two parts of one staff (G, F): bars 0-3 */
S.pair = {
  why: 'two one-staff parts, G over F, are one piano of two staves',
  pages: () => [doc([part('P1', series(0, 4, rhBar, first({ clefs: ['G'] })), { div: 2 }), part('P2', series(0, 4, lhBar, first({ clefs: ['F'] })), { div: 2 })])],
  expect: () => truth(0, 4)
};

/* one piano read system by system: bars 0-1 in the two-staff part, 2-3 in two one-staff parts (the other parts hold bar rests) */
S.systems = {
  why: 'each bar comes from the group that has its notes, whichever way the engine split the systems (2x1x1)',
  pages: () => [doc([
    part('P1', [grandBar(0, grandFirst()), grandBar(1), restGrand(), restGrand()], { div: 2, staved: true }),
    part('P2', [restBar(first({ clefs: ['G'] })), restBar(), rhBar(2), rhBar(3)], { div: 2 }),
    part('P3', [restBar(first({ clefs: ['F'] })), restBar(), lhBar(2), lhBar(3)], { div: 2 })])],
  expect: () => truth(0, 4)
};
/* the same, with the single staves FIRST (1x1x2) and the two-staff part last */
S.systemsReversed = {
  why: 'the same with the groups in the other order (1x1x2)',
  pages: () => [doc([
    part('P1', [rhBar(0, first({ clefs: ['G'] })), rhBar(1), restBar(), restBar()], { div: 2 }),
    part('P2', [lhBar(0, first({ clefs: ['F'] })), lhBar(1), restBar(), restBar()], { div: 2 }),
    part('P3', [restGrand(grandFirst()), restGrand(), grandBar(2), grandBar(3)], { div: 2, staved: true })])],
  expect: () => truth(0, 4)
};
/* a part of rests beside a clean piano part (its bars of rests would otherwise be taken for the bar where nobody plays, and say 3/4) */
S.ghost = {
  why: 'a part that holds only rests, beside a part that has the notes, is dropped (and a bar nobody plays is the piano bar)',
  pages: () => [doc([part('P1', [restBar(first({ clefs: ['G'], time: [3, 4] })), restBar(), restBar()], { div: 2 }),
    part('P2', [grandBar(0, grandFirst()), restGrand(), grandBar(2)], { div: 2, staved: true })])],
  expect: () => { const t = truth(0, 3); return { parts: 1, staves: 2, bars: 3, numbers: '1,2,3', sigs: [t.sigs[0], '', t.sigs[2]], timeBars: '1:4/4' }; }
};
/* a violin line, a cello line and a piano that all play in every bar: a score of several parts, not a piano the engine split */
S.trio = {
  why: 'groups that have notes in the same bars are a score of several parts: left alone, nothing dropped',
  pages: () => [doc([part('P1', series(0, 4, rhBar, first({ clefs: ['G'] })), { div: 2 }), part('P2', series(0, 4, lhBar, first({ clefs: ['F'] })), { div: 2 }),
    part('P3', series(0, 4, grandBar, grandFirst()), { div: 2, staved: true })])],
  expect: () => ({ parts: 3, bars: 4, notes: 4 * 6 * 2, flagged: true })
};
/* a grand staff read as single staves, one system a staff: G, F, G, F of two bars each */
S.fold = {
  why: 'a part of one staff whose systems alternate G, F, G, F is a grand staff read as single staves: 8 bars, not 16 (issue 12)',
  pages: () => [doc([part('P1', [
    rhBar(0, first({ clefs: ['G'], newSystem: false, print: true })), rhBar(1),
    lhBar(0, first({ clefs: ['F'], newSystem: true, div: undefined })), lhBar(1),
    rhBar(2, { clefs: ['G'], time: [4, 4], newSystem: true }), rhBar(3),
    lhBar(2, { clefs: ['F'], time: [4, 4], newSystem: true }), lhBar(3)], { div: 2 })])],
  expect: () => truth(0, 4)
};
/* the same four runs, but the clefs are G, G, G, G: not a grand staff */
S.foldNot = {
  why: 'systems that do not alternate G over F are not folded',
  pages: () => [doc([part('P1', [
    rhBar(0, first({ clefs: ['G'], print: true })), rhBar(1), rhBar(2, { clefs: ['G'], newSystem: true }), rhBar(3),
    rhBar(4, { clefs: ['G'], newSystem: true }), rhBar(5), rhBar(6, { clefs: ['G'], newSystem: true }), rhBar(7)], { div: 2 })])],
  expect: () => ({ parts: 1, staves: 1, bars: 8 })
};
/* runs of different lengths: not pairs */
S.foldUneven = {
  why: 'systems of different lengths are not folded',
  pages: () => [doc([part('P1', [
    rhBar(0, first({ clefs: ['G'], print: true })), rhBar(1), rhBar(2),
    lhBar(0, { clefs: ['F'], newSystem: true }), lhBar(1)], { div: 2 })])],
  expect: () => ({ parts: 1, staves: 1, bars: 5 })
};
/* the key and the meter of a later page differ from the first's: written where they change, and only there */
S.changes = {
  why: 'a key or time signature that changes between pages is written where it changes, and not again where it does not',
  pages: () => [
    doc([part('P1', series(0, 2, grandBar, grandFirst({ key: 2 })), { div: 2, staved: true })]),
    doc([part('P1', series(2, 4, grandBar, grandFirst({ key: 2 })), { div: 2, staved: true })]),
    doc([part('P1', [grandBar(4, grandFirst({ key: -1, time: [3, 4] })), grandBar(5)], { div: 2, staved: true })])],
  expect: () => ({ keyBars: '1:2,5:-1', timeBars: '1:4/4,5:3/4' })
};

/* the same four paths with rich bars (chords, grace notes, ties, <forward>): the pair, one piano read system by system, the PDF's systems, and pages of other divisions */
S.pairRich = {
  why: 'a pair with chords, grace notes, ties and a <forward>: the lower staff starts with the bar, nothing is lost',
  pages: () => [doc([part('P1', series(0, 4, richRhBar, first({ clefs: ['G'] })), { div: 2 }), part('P2', series(0, 4, richLhBar, first({ clefs: ['F'] })), { div: 2 })])],
  expect: () => truthRich(0, 4)
};
S.systemsRich = {
  why: 'one piano read system by system, with chords, grace notes, ties and a <forward>',
  pages: () => [doc([
    part('P1', [richGrandBar(0, grandFirst()), richGrandBar(1), restGrand(), restGrand()], { div: 2, staved: true }),
    part('P2', [restBar(first({ clefs: ['G'] })), restBar(), richRhBar(2), richRhBar(3)], { div: 2 }),
    part('P3', [restBar(first({ clefs: ['F'] })), restBar(), richLhBar(2), richLhBar(3)], { div: 2 })])],
  expect: () => truthRich(0, 4)
};
S.foldRich = {
  why: 'the systems of the PDF folded, with chords, grace notes, ties and a <forward>',
  pages: () => [doc([part('P1', [
    richRhBar(0, first({ clefs: ['G'], print: true })), richRhBar(1),
    richLhBar(0, first({ clefs: ['F'], newSystem: true, div: undefined })), richLhBar(1),
    richRhBar(2, { clefs: ['G'], time: [4, 4], newSystem: true }), richRhBar(3),
    richLhBar(2, { clefs: ['F'], time: [4, 4], newSystem: true }), richLhBar(3)], { div: 2 })])],
  expect: () => truthRich(0, 4)
};
S.pagesRich = {
  why: 'pages of other divisions with a <forward>, a chord, a grace note and a tie: every duration and every <forward> is scaled',
  pages: () => [doc([part('P1', series(0, 2, richGrandBar, grandFirst()), { div: 2, staved: true })]),
    doc([part('P1', series(2, 4, richGrandBar, grandFirst({ div: 4 })), { div: 4, staved: true })])],
  expect: () => truthRich(0, 4)
};

/* ---- notes of length 0 and hairpins that end where they start (G12-2) ---- */
/* Audiveris 5.11 writes <rest measure="yes"/><duration>0</duration> for the whole-bar rest of a bar it read nothing in; in a grand staff, one for each staff, no <backup> between */
const zeroRestGrand = extra => Object.assign({ items: [rest(0, { measure: true, noType: true, s: 1 }), rest(0, { measure: true, noType: true, s: 2, v: 5 })], staved: true }, extra);
const zeroRestBar = extra => Object.assign({ items: [rest(0, { measure: true, noType: true })] }, extra);
const wedge = (type, no, offset) => raw('<direction placement="below"><direction-type><wedge type="' + type + '" spread="0" default-x="0"' + (no ? ' number="' + no + '"' : '') + '/></direction-type>' + (offset ? '<offset>' + offset + '</offset>' : '') + '<staff>1</staff></direction>');
/* the right hand of bar i as four quarters with the wedge marks (or anything) put in after the quarter k: marks = {k: [raw, ...]} */
const rhWith = (i, marks) => { const out = []; rhOf(i).forEach((n, k) => { out.push(n); (marks[k] || []).forEach(m => out.push(m)); }); return out; };
const grandWith = (i, marks, extra) => Object.assign({ items: rhWith(i, marks).concat([back(4)], lhOf(i)), staved: true }, extra);
/* what the reader finds of the rests and wedges of one bar */
const restsOf = (xml, bar) => read(xml).parts[0].bars[bar].notes.filter(n => n.rest).map(n => n.staff + ':' + n.dur).join(',');
/* directions that hold no direction-type (invalid MusicXML) */
const emptyDirections = xml => { let n = 0; const walk = e => { if (e.name === 'direction' && !e.kids.some(k => k.name === 'direction-type')) n++; e.kids.forEach(walk); }; walk(L.XML.parse(xml).root); return n; };
const wedgesOf = xml => {
  const out = [];
  L.XML.parse(xml).root.kids.filter(k => k.name === 'part')[0].kids.filter(k => k.name === 'measure').forEach(m => {
    const w = [];
    m.kids.filter(k => k.name === 'direction').forEach(d => d.kids.filter(k => k.name === 'direction-type').forEach(t => t.kids.filter(k => k.name === 'wedge').forEach(x => w.push(x.attrs.type + (x.attrs.number ? '#' + x.attrs.number : '')))));
    out.push(w.join(','));
  });
  return out.join(' | ');
};

S.zeroRest = {
  why: 'a whole-bar rest written with <duration>0</duration> lasts the bar (the ScoreGraph importer refuses a note of length 0), counted and flagged',
  pages: () => [doc([part('P1', [grandBar(0, grandFirst()), zeroRestGrand(), grandBar(2)], { div: 2, staved: true })])],
  expect: () => { const t = truth(0, 3); return { bars: 3, sigs: [t.sigs[0], '', t.sigs[2]], rests: '1:4,2:4', repaired: 2, left: 0, flags: ['duration-repaired'] }; }
};
S.zeroRestPair = {
  why: 'the same in a grand staff read as two parts: each part\'s own whole-bar rest lasts the bar',
  pages: () => [doc([part('P1', [rhBar(0, first({ clefs: ['G'] })), zeroRestBar(), rhBar(2)], { div: 2 }), part('P2', [lhBar(0, first({ clefs: ['F'] })), zeroRestBar(), lhBar(2)], { div: 2 })])],
  expect: () => { const t = truth(0, 3); return { bars: 3, sigs: [t.sigs[0], '', t.sigs[2]], rests: '1:4,2:4', repaired: 2, left: 0, flags: ['pair-merged', 'duration-repaired'] }; }
};
S.zeroRestCompound = {
  why: 'the length of the bar is the time signature\'s: a whole-bar rest in 6/8 lasts three quarters, not six',
  pages: () => [doc([part('P1', [
    { items: [note('C5', 1.5, { s: 1, dot: true }), note('D5', 1.5, { s: 1, dot: true }), back(3), note('C3', 3, { s: 2, v: 5, type: 'half', dot: true })], staved: true, div: 2, key: 0, time: [6, 8], staves: 2, clefs: ['G', 'F'] },
    { items: [rest(0, { measure: true, noType: true, s: 1 }), rest(0, { measure: true, noType: true, s: 2, v: 5 })], staved: true }], { div: 2, staved: true })])],
  expect: () => ({ bars: 2, sigs: ['1 0 1.5 C5 | 1 1.5 1.5 D5 | 2 0 3 C3', ''], rests: '1:3,2:3', repaired: 2, left: 0, flags: ['duration-repaired'] })
};
S.zeroRestTyped = {
  why: 'a rest of length 0 that is not a whole-bar rest lasts what its <type> says',
  pages: () => [doc([part('P1', [{ items: [note('C3', 4, { s: 2, v: 5, type: 'whole' }), back(4), note('C5', 1, { s: 1 }), note('D5', 1, { s: 1 }), rest(0, { type: 'half', s: 1 })], staved: true, div: 2, key: 0, time: [4, 4], staves: 2, clefs: ['G', 'F'] }], { div: 2, staved: true })])],
  expect: () => ({ bars: 1, sigs: ['1 0 1 C5 | 1 1 1 D5 | 2 0 4 C3'], rests: '1:2', repaired: 1, left: 0, flags: ['duration-repaired'] })
};
S.zeroRestLeft = {
  why: 'a zero-length rest with nothing to read its length from (a rest that is no whole-bar rest and has no type) is left as it was and counted, never guessed',
  pages: () => [doc([part('P1', [{ items: [note('C3', 4, { s: 2, v: 5, type: 'whole' }), back(4), note('C5', 1, { s: 1 }), note('D5', 1, { s: 1 }), rest(0, { noType: true, s: 1 })], staved: true, div: 2, key: 0, time: [4, 4], staves: 2, clefs: ['G', 'F'] }], { div: 2, staved: true })])],
  expect: () => ({ bars: 1, sigs: ['1 0 1 C5 | 1 1 1 D5 | 2 0 4 C3'], rests: '1:0', repaired: 0, left: 1, flags: ['duration-zero'] })
};

/* Audiveris reads a crescendo and a diminuendo that meet as start, start, stop, stop with no note between the middle two; a hairpin elsewhere is fine */
const ex2 = [grandWith(1, { 1: [wedge('crescendo')], 2: [wedge('diminuendo'), wedge('stop')], 3: [wedge('stop')] }), grandWith(2, { 0: [wedge('crescendo')], 2: [wedge('stop')] })];
S.wedges = {
  why: 'a hairpin written to end where it starts (start, start, stop, stop) is removed with the marks that cannot pair, a hairpin of positive length elsewhere stays, counted and flagged',
  pages: () => [doc([part('P1', [grandBar(0, grandFirst())].concat(ex2.map(b => Object.assign({}, b))).concat([grandBar(3)]), { div: 2, staved: true })])],
  expect: () => ({ bars: 4, wedges: ' |  | crescendo,stop | ', dropped: 4, degenerate: 1, emptyDirections: 0, flags: { 2: ['wedge-dropped'] } })
};
S.wedgesNumbered = {
  why: 'wedges pair by their number: a degenerate pair of number 2 inside a hairpin of number 1 takes only itself away',
  pages: () => [doc([part('P1', [grandBar(0, grandFirst()), grandWith(1, { 0: [wedge('crescendo', 1)], 1: [wedge('diminuendo', 2), wedge('stop', 2)], 3: [wedge('stop', 1)] }), grandBar(2)], { div: 2, staved: true })])],
  expect: () => ({ bars: 3, wedges: ' | crescendo#1,stop#1 | ', dropped: 2, degenerate: 1, emptyDirections: 0, flags: { 2: ['wedge-dropped'] } })
};
S.wedgesAcrossBars = {
  why: 'a hairpin from one bar to the next is a pair of positive length; one whose stop comes first in the next bar is judged by bar and place, not by place alone',
  pages: () => [doc([part('P1', [grandWith(0, { 3: [wedge('crescendo')] }), grandWith(1, { 0: [wedge('stop')] }), grandWith(2, { 1: [wedge('diminuendo'), wedge('stop')] }), grandWith(3, { 2: [wedge('crescendo')] })], { div: 2, staved: true })])],
  expect: () => ({ bars: 4, wedges: 'crescendo | stop |  | ', dropped: 3, degenerate: 1, emptyDirections: 0, flags: { 3: ['wedge-dropped'], 4: ['wedge-dropped'] } })
};
S.wedgesOffset = {
  why: 'the place of a mark in its bar includes its <offset>: a stop put two divisions after its start by an offset ends after it starts and stays',
  pages: () => [doc([part('P1', [grandWith(0, { 1: [wedge('crescendo'), wedge('stop', null, 2)] }, grandFirst()), grandWith(1, { 1: [wedge('diminuendo'), wedge('stop')] }), grandBar(2)], { div: 2, staved: true })])],
  expect: () => ({ bars: 3, wedges: 'crescendo,stop |  | ', dropped: 2, degenerate: 1, emptyDirections: 0, flags: { 2: ['wedge-dropped'] } })
};

/* a bar-count check against what the page shows */
S.barCount = {
  why: 'a page whose bar count differs from what its layout shows is reported and its bars flagged',
  pages: () => [doc([part('P1', series(0, 4, grandBar, grandFirst()), { div: 2, staved: true })])],
  opts: () => ({ pageBars: [5] }),
  expect: () => ({ changes: [{ rule: 'bar-count', page: 0, read: 4, shown: 5 }], flags: { 1: ['bar-count'], 2: ['bar-count'], 3: ['bar-count'], 4: ['bar-count'] } })
};

/* ------------------------------------------------------------------------------------------------ probing */
/* what a normaliser N answers for a scenario, in the shape its `expect` is written in */
function probe(N, name) {
  const sc = S[name];
  const r = N.normalize(sc.pages(), sc.opts ? sc.opts() : undefined);
  if (!r.ok) return { error: r.error };
  const s = summary(r.xml);
  const rep = r.report;
  switch (name) {
    case 'divisionsUnknown': return { flags: { 1: rep.flags[1] ? rep.flags[1].filter(f => f.indexOf('divisions') === 0) : [] } };
    case 'trio': {
      const o = read(r.xml);
      return { parts: o.parts.length, bars: o.parts[0].bars.length, notes: o.parts.reduce((t, p) => t + p.bars.reduce((u, b) => u + b.notes.filter(n => !n.rest).length, 0), 0) * 1, flagged: Object.keys(rep.flags).every(b => rep.flags[b].indexOf('parts-fragmented') >= 0) && Object.keys(rep.flags).length === 4 };
    }
    case 'foldNot': case 'foldUneven': return { parts: s.parts, staves: s.staves, bars: s.bars };
    case 'changes': {
      const o = read(r.xml).parts[0];
      return { keyBars: o.bars.map((b, i) => (b.keyChange !== null ? (i + 1) + ':' + b.keyChange : null)).filter(Boolean).join(','),
        timeBars: o.bars.map((b, i) => (b.timeChange !== null ? (i + 1) + ':' + b.timeChange : null)).filter(Boolean).join(',') };
    }
    case 'barCount': return { changes: rep.changes.filter(c => c.rule === 'bar-count'), flags: Object.keys(rep.flags).reduce((a, b) => { const f = rep.flags[b].filter(x => x === 'bar-count'); if (f.length) a[b] = f; return a; }, {}) };
    case 'divisionsZero': return { parts: s.parts, staves: s.staves, bars: s.bars, numbers: s.numbers, sigs: s.sigs };
    case 'ghost': return Object.assign({}, s, { timeBars: read(r.xml).parts[0].bars.map((b, i) => (b.timeChange !== null ? (i + 1) + ':' + b.timeChange : null)).filter(Boolean).join(',') });
    case 'zeroRest': case 'zeroRestPair': case 'zeroRestCompound': case 'zeroRestTyped': case 'zeroRestLeft': {
      const bi = name === 'zeroRestTyped' || name === 'zeroRestLeft' ? 0 : 1;
      const f = rep.flags[bi + 1] || [];   /* the flags of the bar that holds the zero-length rests */
      return { bars: s.bars, sigs: s.sigs, rests: restsOf(r.xml, bi), repaired: rep.counts.zeroDurationsRepaired, left: rep.counts.zeroDurationsLeft,
        flags: f.filter(x => x.indexOf('duration') === 0 || x === 'pair-merged') };
    }
    case 'wedges': case 'wedgesNumbered': case 'wedgesAcrossBars': case 'wedgesOffset':
      return { bars: s.bars, wedges: wedgesOf(r.xml), dropped: rep.counts.wedgesDropped, degenerate: rep.counts.wedgesDegenerate, emptyDirections: emptyDirections(r.xml),
        flags: Object.keys(rep.flags).reduce((a, b) => { const x = rep.flags[b].filter(y => y === 'wedge-dropped'); if (x.length) a[b] = x; return a; }, {}) };
    default: return s;
  }
}

module.exports = { wedge, grandWith, zeroRestGrand, zeroRestBar, restsOf, wedgesOf, S, probe, summary, truth, truthDoc, truthRich, truthDocRich, P, rhOf, lhOf, rhBar, lhBar, grandBar, restBar, restGrand, richRh, richLh, richRhBar, richLhBar, richGrandBar, first, grandFirst, series };
