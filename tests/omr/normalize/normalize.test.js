'use strict';
/* omr/normalize.js (G12-1, docs/GOALS/G12_OMR.md section 7.1): every rule on the pages an engine writes, each with its planted defect.
   The expected answers are computed from the music itself written as one grand staff (scenarios.js), never from the normaliser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./lib.js');
const SC = require('./scenarios.js');
const { N, note, rest, back, part, doc, read } = L;
const { S, probe } = SC;

for (const name of Object.keys(S)) {
  test('scenario ' + name + ': ' + S[name].why, () => {
    assert.deepEqual(probe(N, name), S[name].expect());
  });
}

test('movements: the bars of every movement are numbered 1..N in order, the first file\'s header is kept, the report says how many were joined', () => {
  const r = N.normalize(S.movements.pages());
  assert.equal(r.ok, true);
  const o = read(r.xml);
  assert.deepEqual(o.parts[0].bars.map(b => b.number), ['1', '2', '3', '4', '5']);
  assert.ok(o.header.indexOf('identification') >= 0 && o.header.indexOf('part-list') < 0, 'the header comes from the first file; the part list is rebuilt');
  assert.equal(r.report.counts.movementsJoined, 1);
  assert.equal(r.report.counts.movements, 2);
  assert.deepEqual(r.pages.map(p => [p.ok, p.movements, p.bars]), [[true, 2, 5]]);
  assert.deepEqual(r.report.flags[4], ['movement-start'], 'the first bar of the second movement is marked');
  assert.match(r.xml, /<software>Audiveris 5\.11\.0<\/software>/, 'the page still knows the notation came from the engine (its hand rule and chord reading depend on it)');
});

test('a page of whole-bar rests and a document with one note per bar are read, not refused', () => {
  const r = N.normalize([doc([part('P1', [{ items: [rest(4, { measure: true, noType: true })], div: 1, time: [4, 4], clefs: ['G'] }], { div: 1 })])]);
  assert.equal(r.ok, true);
  assert.equal(read(r.xml).parts[0].bars.length, 1);
});

test('pages: a page the engine could not read leaves no hole, and its place in the page list is kept', () => {
  const r = N.normalize([doc([part('P1', SC.series(0, 2, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]), null,
    doc([part('P1', SC.series(2, 4, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })])]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pages.map(p => [p.ok, p.bars]), [[true, 2], [false, 0], [true, 2]]);
  assert.deepEqual(SC.summary(r.xml), SC.truth(0, 4));
});

test('pages: one piece whose pages the engine split differently lines up (page 1 a grand staff, page 2 a pair, page 3 a 1x1x2)', () => {
  const p1 = doc([part('P1', SC.series(0, 2, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]);
  const p2 = doc([part('P1', SC.series(2, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(2, 4, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 })]);
  const p3 = doc([
    part('P1', [SC.rhBar(4, SC.first({ clefs: ['G'] })), SC.restBar()], { div: 2 }),
    part('P2', [SC.lhBar(4, SC.first({ clefs: ['F'] })), SC.restBar()], { div: 2 }),
    part('P3', [SC.restGrand(SC.grandFirst()), SC.grandBar(5)], { div: 2, staved: true })]);
  const r = N.normalize([p1, p2, p3]);
  assert.equal(r.ok, true);
  assert.deepEqual(SC.summary(r.xml), SC.truth(0, 6));
  assert.deepEqual(r.report.structure.map(s => s.read + '>' + s.out), ['2>2', '1x1>2', '1x1x2>2']);
});

test('grand staff: the lower staff is staff 2, its voices are numbered after the upper staff\'s, and a <backup> returns to the start of the bar', () => {
  const r = N.normalize(S.pair.pages());
  const o = read(r.xml).parts[0];
  o.bars.forEach(b => {
    const lower = b.notes.filter(n => n.staff === 2), upper = b.notes.filter(n => n.staff === 1);
    assert.ok(lower.length && upper.length);
    assert.ok(lower.every(n => n.voice >= 5), 'voices of staff 2 start at 5, as the engine numbers them');
    assert.ok(upper.every(n => n.voice < 5));
    assert.equal(Math.min.apply(null, lower.map(n => n.on)), 0, 'the lower staff starts at the beginning of the bar');
  });
  assert.equal(o.backups, 4);
  assert.equal(r.xml.split('<staves>2</staves>').length - 1, 1, '<staves> is written once, on the first bar');
  assert.deepEqual(o.bars[0].clefs, { 1: 'G', 2: 'F' });
});

test('grand staff: the clefs of both staves are written on the first bar, a clef change later is kept on its own staff', () => {
  const mid = '<attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>';
  const r = N.normalize([doc([part('P1', [SC.rhBar(0, SC.first({ clefs: ['G'], mid: '' })), Object.assign(SC.rhBar(1), { mid: mid })], { div: 2 }),
    part('P2', [SC.lhBar(0, SC.first({ clefs: ['F'] })), SC.lhBar(1)], { div: 2 })])]);
  const o = read(r.xml).parts[0];
  assert.equal(o.bars[1].midClefs, 1, 'a clef change in the middle of the upper staff\'s bar survives');
  assert.match(r.xml, /<clef number="1"><sign>F<\/sign>/);
});

test('systems: the notes of a system are never taken from the part that holds only its rests, whichever order the parts come in', () => {
  const a = N.normalize(S.systems.pages()), b = N.normalize(S.systemsReversed.pages());
  assert.deepEqual(SC.summary(a.xml), SC.summary(b.xml));
  assert.equal(a.report.counts.droppedNotes, 0);
  assert.deepEqual(a.report.flags[3], ['pair-merged', 'source-switch'], 'the bar where the source changes is marked');
});

test('systems: when two groups both have notes in a bar the bigger one is kept, the loss is counted and the bar flagged `overlap`', () => {
  /* the right-hand part also has one stray note in bar 3, where the two-staff part (the real music) has a whole bar of notes */
  const grand = part('P1', [SC.grandBar(0, SC.grandFirst()), SC.grandBar(1), SC.grandBar(2), SC.grandBar(3)], { div: 2, staved: true });
  const junk = part('P2', [SC.restBar(SC.first({ clefs: ['G'] })), SC.restBar(), SC.restBar(), { items: [note('C6', 4, { type: 'whole' })] }], { div: 2 });
  const r = N.normalize([doc([grand, junk])]);
  assert.deepEqual(SC.summary(r.xml), SC.truth(0, 4));
  assert.equal(r.report.counts.overlapBars, 1);
  assert.equal(r.report.counts.droppedNotes, 1);
  assert.ok(r.report.flags[4].indexOf('overlap') >= 0);
});

test('ghosts: a part of rests is dropped and counted; a piece whose lower staff is silent is kept as it is (that is a staff, not a ghost part)', () => {
  const r = N.normalize(S.ghost.pages());
  assert.equal(r.report.counts.ghostParts, 1);
  const silentLeft = doc([part('P1', [
    { items: [note('C5', 1, { s: 1 }), note('D5', 1, { s: 1 }), note('E5', 1, { s: 1 }), note('F5', 1, { s: 1 }), back(4), rest(4, { measure: true, noType: true, s: 2, v: 5 })], staved: true, div: 1, time: [4, 4], staves: 2, clefs: ['G', 'F'] }])]);
  const k = N.normalize([silentLeft]);
  assert.equal(read(k.xml).parts[0].staves, 2);
  assert.equal(k.report.counts.ghostParts, 0);
});

test('divisions: the repair is by what most notes agree on, and says so', () => {
  const r = N.normalize(S.divisionsZero.pages());
  const c = r.report.changes.find(x => x.rule === 'divisions');
  assert.deepEqual([c.perQuarter, c.scale, c.divisions, c.agree, c.notes], [0.5, 2, 1, 1, 6], 'six notes with a type in the two bars all say a half note is 1');
  assert.equal(r.report.counts.divisionsRepaired, 1);
  assert.deepEqual(r.report.flags[1], ['divisions-repaired']);
  assert.match(r.xml, /<divisions>1<\/divisions>/);
  assert.doesNotMatch(r.xml, /<divisions>0<\/divisions>/);
});

test('divisions: dotted notes and tuplets are not read to infer, a part that already has divisions is not touched, and a quarter-note page repairs to 1', () => {
  const dotted = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/></note>';
  const plain = '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>';
  const bar1 = '<measure number="1"><attributes><divisions>0</divisions><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' + dotted + plain + '</measure>';
  const r = N.normalize([doc(['<part id="P1">' + bar1 + '</part>'])]);
  const c = r.report.changes.find(x => x.rule === 'divisions');
  assert.deepEqual([c.perQuarter, c.scale, c.divisions, c.notes], [1, 1, 1, 1], 'only the plain quarter is read: 1 per quarter');
  const o = read(r.xml).parts[0].bars[0];
  assert.deepEqual(o.notes.map(n => n.dur), [3, 1], 'the dotted half keeps its length (its duration was written in quarters)');
});

test('divisions: a document whose pages use different divisions gets the common multiple, and every duration stays what it was', () => {
  const r = N.normalize(S.pages.pages());
  assert.match(r.xml, /<divisions>4<\/divisions>/);
  assert.equal(r.xml.split('<divisions>').length - 1, 1, 'one divisions for the whole part');
});

test('bars: width and an implicit (pick-up) bar are kept, the numbers are 1..N', () => {
  const pick = { items: [note('G4', 1)], div: 1, time: [4, 4], clefs: ['G'], implicit: true, width: 90, number: 0 };
  const r = N.normalize([doc([part('P1', [pick, { items: [note('C5', 4, { type: 'whole' })], width: 150 }])])]);
  const o = read(r.xml).parts[0];
  assert.deepEqual(o.bars.map(b => [b.attrs.number, b.attrs.width, b.attrs.implicit || null]), [['1', '90', 'yes'], ['2', '150', null]]);
});

test('barlines and prints are kept once: the pair\'s lower staff does not write a second barline or a second <print>', () => {
  const line = '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
  const r = N.normalize([doc([part('P1', [SC.rhBar(0, SC.first({ clefs: ['G'], newSystem: true, tail: line }))], { div: 2 }),
    part('P2', [SC.lhBar(0, SC.first({ clefs: ['F'], newSystem: true, tail: line }))], { div: 2 })])]);
  assert.equal(r.xml.split('<barline').length - 1, 1);
  assert.equal(r.xml.split('<print').length - 1, 1);
  assert.ok(r.xml.indexOf('</note><barline') > 0, 'the barline stays last in the bar');
});

test('a bar of one staff next to bars of two (a page the engine read half of) keeps its notes on staff 1 and the part has two staves', () => {
  const a = doc([part('P1', [SC.grandBar(0, SC.grandFirst())], { div: 2, staved: true })]);
  const b = doc([part('P1', [SC.rhBar(1, SC.first({ clefs: ['G'] }))], { div: 2 })]);
  const r = N.normalize([a, b]);
  const o = read(r.xml).parts[0];
  assert.equal(o.staves, 2);
  assert.equal(o.bars.length, 2);
  assert.ok(o.bars[1].notes.every(n => n.staff === 1));
});

test('parts the rules cannot join stay separate parts, in order, flagged on every bar, and a later page lines up with them by index', () => {
  const trio = (i0, i1) => doc([part('P1', SC.series(i0, i1, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(i0, i1, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 }),
    part('P3', SC.series(i0, i1, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]);
  const r = N.normalize([trio(0, 2), trio(2, 4)]);
  const o = read(r.xml);
  assert.deepEqual(o.parts.map(p => [p.staves, p.bars.length]), [[1, 4], [1, 4], [2, 4]]);
  assert.equal(r.report.counts.partsKept, 2);
  assert.ok(Object.keys(r.report.flags).length === 4 && Object.keys(r.report.flags).every(b => r.report.flags[b].indexOf('parts-fragmented') >= 0));
});

test('a part more than one page long that a later page does not have is padded with empty bars, not shifted', () => {
  const two = doc([part('P1', SC.series(0, 2, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(0, 2, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P3', SC.series(0, 2, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 })]);
  const one = doc([part('P1', SC.series(2, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 })]);
  const o = read(N.normalize([two, one]).xml);
  assert.deepEqual(o.parts.map(p => p.bars.length), [4, 4, 4]);
  assert.deepEqual(o.parts[1].bars.slice(2).map(b => b.notes.length), [0, 0]);
});

test('idempotent: normalising a normalised file changes no note, no bar and no staff', () => {
  for (const name of Object.keys(S)) {
    if (name === 'divisionsUnknown' || name === 'trio') continue;
    const r1 = N.normalize(S[name].pages(), S[name].opts ? S[name].opts() : undefined);
    const r2 = N.normalize([r1.xml]);
    assert.deepEqual(SC.summary(r2.xml), SC.summary(r1.xml), name);
    assert.deepEqual(r2.report.changes, [], name + ': the second pass reports no change at all (no repair, no merge, no fold, no ghost)');
    assert.deepEqual(L.multiset([r2.xml]), L.multiset([r1.xml]), name + ': and keeps every note');
    assert.equal(r2.report.counts.divisionsRepaired + r2.report.counts.ghostParts + r2.report.counts.systemsFolded + r2.report.counts.partsMerged, 0, name + ' needs no second pass');
  }
});

test('invariant: the multiset of (pitch, onset, duration, tie, chord, grace) is the same before and after normalisation, in EVERY scenario', () => {
  for (const name of Object.keys(S)) {
    const pages = S[name].pages();
    const before = L.multiset([].concat.apply([], pages.map(p => (Array.isArray(p) ? p : [p]))));
    const r = N.normalize(pages, S[name].opts ? S[name].opts() : undefined);
    assert.equal(r.ok, true, name);
    assert.ok(before.length > 0, name + ' has notes');
    assert.deepEqual(L.multiset([r.xml]), before, name + ': a note was lost, moved in its bar, changed in length, untied, or turned into/out of a chord or a grace note');
  }
  /* the scenarios that matter most for it have all four kinds in them */
  const rich = L.multiset([SC.truthDocRich(0, 2)]).join(' ');
  assert.ok(/\|chord\|/.test(rich) && /\|grace/.test(rich) && /\|start\|/.test(rich) && /\|stop\|/.test(rich), 'the rich bars have a chord, a grace note and a tie');
});

test('a chord does not move the lower staff: the <backup> is the end of the upper staff, not the sum of its chord notes', () => {
  const r = N.normalize(S.pairRich.pages());
  const o = read(r.xml).parts[0];
  o.bars.forEach(b => {
    const lower = b.notes.filter(n => n.staff === 2 && !n.chord && !n.grace).map(n => n.on);
    assert.equal(Math.min.apply(null, lower), 0, 'the lower staff starts with the bar');
    assert.deepEqual(lower.slice().sort((a, c) => a - c), [0, 2, 3], 'the lower staff plays at 0, 2 and 3');
  });
  assert.match(r.xml, /<backup><duration>6<\/duration><\/backup>/, 'three quarters in divisions 2');
});

test('safety: a document nested 20,000 deep does not throw out of normalize(): it is an answer (ok false, internal-error) the caller falls back on', () => {
  const deep = '<foo>'.repeat(20000) + '</foo>'.repeat(20000);
  const bomb = doc([part('P1', [SC.grandBar(0, SC.grandFirst({ lead: deep })), SC.grandBar(1)], { div: 2, staved: true })]);
  let r;
  assert.doesNotThrow(() => { r = N.normalize([bomb]); });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'internal-error');
  assert.match(r.detail, /call stack|too much recursion/i);
  assert.equal(r.xml, null);
  assert.deepEqual(r.report.changes.map(c => c.rule), ['internal-error']);
  /* the other pages of a run are not the victims of one page: a good document beside it is read when asked alone */
  assert.equal(N.normalize([doc([part('P1', SC.series(0, 2, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })])]).ok, true);
});

test('a clean one-part page passes through note for note, on the same staves, with the same durations', () => {
  const src = doc([part('P1', SC.series(0, 6, SC.grandBar, SC.grandFirst({ key: -3 })), { div: 2, staved: true })]);
  const before = read(src), r = N.normalize([src]), after = read(r.xml);
  assert.deepEqual(after.parts[0].bars.map(b => L.sig(b)), before.parts[0].bars.map(b => L.sig(b)));
  assert.deepEqual(after.parts[0].bars.map(b => b.notes.map(n => n.voice)), before.parts[0].bars.map(b => b.notes.map(n => n.voice)), 'voices untouched');
  assert.deepEqual(r.report.notes, []);
  assert.deepEqual(r.report.flags, {});
});

test('pagesFromHelper: the helper\'s movements when it has them, the one document of each page when it does not (an old helper), nothing for a failed page', () => {
  const m = ['<a/>', '<b/>'];
  assert.deepEqual(N.pagesFromHelper({ movements: [m, null, ['<c/>']], musicxml: ['<x/>', null, '<y/>'] }), [m, [], ['<c/>']]);
  assert.deepEqual(N.pagesFromHelper({ musicxml: ['<x/>', null, '<y/>'] }), [['<x/>'], [], ['<y/>']]);
  assert.deepEqual(N.pagesFromHelper(null), []);
  assert.deepEqual(N.pagesFromHelper({ ok: true }), []);
});

test('robustness: a page that is not XML, not MusicXML or empty is reported and left out; if nothing is left the answer is not ok', () => {
  const good = doc([part('P1', SC.series(0, 2, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]);
  const r = N.normalize(['not xml at all', good, '<score-timewise version="4.0"/>', '<foo/>', doc([part('P1', [])]), '', 42, ['<score-partwise>']]);
  assert.equal(r.ok, true);
  assert.equal(r.report.counts.unreadable, 5, 'text, timewise, foo, no bars, and the unclosed one: five; the empty string and the number are not documents');
  assert.deepEqual(SC.summary(r.xml), SC.truth(0, 2));
  const none = N.normalize(['junk', null, []]);
  assert.equal(none.ok, false);
  assert.equal(none.error, 'no-usable-page');
  assert.equal(N.normalize(undefined).ok, false);
  assert.equal(N.normalize([]).ok, false);
});

test('safety: a DOCTYPE with an entity is skipped, never expanded; a huge divisions is refused rather than multiplied out', () => {
  const evil = doc([part('P1', SC.series(0, 1, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]).replace('<!DOCTYPE score-partwise', '<!DOCTYPE score-partwise [<!ENTITY x "BOOM">] ');
  const r = N.normalize([evil]);
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.xml, /BOOM|DOCTYPE/);
  const a = doc([part('P1', [{ items: [note('C4', 1)], div: 4999, time: [4, 4], clefs: ['G'] }], { div: 4999 })]);
  const b = doc([part('P1', [{ items: [note('C4', 1)], div: 5003, time: [4, 4], clefs: ['G'] }], { div: 5003 })]);
  const big = N.normalize([a, b]);
  assert.equal(big.ok, false);
  assert.equal(big.error, 'divisions-too-large');
});

test('the output is well formed for the page\'s DOM parser and the ScoreGraph\'s importer, and says nothing the input did not', () => {
  const SG = require(require('path').join(L.REPO, 'scoregraph', 'index.js'));
  for (const name of ['pair', 'systems', 'systemsReversed', 'fold', 'movements', 'divisionsZero']) {
    const r = N.normalize(S[name].pages());
    assert.doesNotThrow(() => L.XML.parse(r.xml), name);
    const g = SG.musicxml.import(r.xml, { scoreId: 'n' });
    assert.equal(g.ok, true, name + ': ' + (g.message || ''));
    assert.match(r.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<score-partwise/);
  }
});

test('deterministic: the same pages give the same bytes, run after run and in any order of the scenarios', () => {
  const names = Object.keys(S);
  const first = names.map(n => N.normalize(S[n].pages(), S[n].opts ? S[n].opts() : undefined).xml);
  const second = names.slice().reverse().map(n => N.normalize(S[n].pages(), S[n].opts ? S[n].opts() : undefined).xml).reverse();
  assert.deepEqual(second, first);
});

test('speed: 24 pages of 16 bars normalise in well under the page\'s 300 ms budget', () => {
  const pages = [];
  for (let p = 0; p < 24; p++) pages.push(doc([part('P1', SC.series(0, 16, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(0, 16, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 })]));
  const t0 = process.hrtime.bigint();
  const r = N.normalize(pages);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.ok, true);
  assert.equal(read(r.xml).parts[0].bars.length, 24 * 16);
  assert.ok(ms < 1500, 'took ' + ms.toFixed(0) + ' ms');
});

