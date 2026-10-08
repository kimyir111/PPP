'use strict';
/* omr/apply.js (G12-2, docs/GOALS/G12_OMR.md section 7.3): the findings of the page's own text and lines as edits of the ScoreGraph.
   scenarios.js holds the scenarios (the Score made again from the edited graph must be the Score the page's lines make: written without a line of the module);
   this file runs them against the real module and tests each kind of edit alone, the findings as data, and what the module refuses to do. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./lib.js');
const { S } = require('./scenarios.js');
const { A, SG, graphOf, scoreOf, noteAt, notesAt } = L;

for (const name of Object.keys(S)) {
  test('scenario ' + name + ': ' + S[name].why, () => {
    const r = S[name].run(A);
    assert.ok(r.ok, JSON.stringify(r.detail, null, 1).slice(0, 2500));
  });
}

test('findings are plain JSON: they survive a round trip through text (the review screen and a worker can keep them)', () => {
  const g = graphOf();
  const { before, after } = L.runDouble(g, (s, P) => { P.accidental(s, noteAt(s, 2, 1, 2), 'sharp'); P.phantom(s, notesAt(s, 1, 1, 1)); P.heading(s, { title: 'T' }); });
  const f = A.diff(before, after);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
  const via = A.apply(g, JSON.parse(JSON.stringify(f)));
  assert.equal(SG.fingerprint(via.graph), SG.fingerprint(A.apply(g, f).graph));
  assert.deepEqual(A.count(f), { drops: 1, pitches: 1, moves: 2, arps: 0, ottavas: 0, chordsOut: 0, chordsIn: 0, marksOut: 0, marksIn: 0, heading: 1, total: 5, conflicts: 0 });
});

test('diff and apply take nothing and give nothing: no Scores, no findings, no changes', () => {
  const g = graphOf();
  assert.equal(A.count(A.diff(null, null)).total, 0);
  assert.equal(A.count(A.diff({}, {})).total, 0);
  assert.equal(A.apply(g, null).graph, g);
  assert.equal(A.apply(g, A.emptyFindings()).changed, false);
  assert.deepEqual(A.apply(g, {}).skipped, []);
});

test('diff names what it cannot turn into an edit: an unreadable pitch, the heads of one event moved to different places', () => {
  const g = graphOf();
  const a = L.scoreOf(g), b = L.clone(a);
  noteAt(b, 1, 1, 0).p = 'H9';
  const f = A.diff(a, b);
  assert.equal(f.pitches.length, 0);
  assert.equal(f.conflicts.length, 1);
  const r = L.SG.musicxml.import(L.SC.truthDocRich(0, 1), { scoreId: 'r' }).graph;
  const c = L.scoreOf(r), d = L.clone(c);
  const [h1, h2] = notesAt(d, 1, 1, 0);
  h1.b = 0.5; h2.b = 1;
  assert.equal(A.diff(c, d).moves.length, 0);
  assert.equal(A.diff(c, d).conflicts.filter(x => x.kind === 'move').length, 1);
});

test('ops.setPitch: a head\'s pitch and printed accidental; a second time changes nothing; an unknown head is refused with a code', () => {
  const g = graphOf();
  const n = noteAt(scoreOf(g), 2, 1, 2);
  const item = { head: n.sgHead, event: n.sgEvent, pitch: { step: 'F', alter: 1, oct: 5 }, acc: 'sharp' };
  const one = A.ops.setPitch(g, item);
  assert.equal(one.changed, true);
  assert.equal(one.status, 'applied');
  assert.equal(noteAt(scoreOf(one.graph), 2, 1, 2).p, 'F#5');
  const two = A.ops.setPitch(one.graph, item);
  assert.equal(two.changed, false);
  assert.equal(two.graph, one.graph);
  assert.equal(two.status, 'already');
  assert.throws(() => A.ops.setPitch(g, Object.assign({}, item, { head: 'h9999' })), e => e.code === 'E-OMR-SKIP' && /no such note/.test(e.why));
  const back = A.ops.setPitch(one.graph, { head: n.sgHead, pitch: { step: 'F', oct: 5 }, acc: null });
  assert.equal(noteAt(scoreOf(back.graph), 2, 1, 2).p, 'F5');
  assert.equal(noteAt(scoreOf(back.graph), 2, 1, 2).acc, null);
});

test('ops.dropEvent: the whole event, its place in the graph and its heads go; its tie and slur partners keep what they have', () => {
  const g = L.SG.musicxml.import(L.SC.truthDocRich(0, 1), { scoreId: 'r' }).graph;
  const sc = scoreOf(g);
  const tied = notesAt(sc, 1, 1, 1)[0];
  const r = A.ops.dropEvent(g, { event: tied.sgEvent, heads: [tied.sgHead], of: 1 });
  assert.equal(r.status, 'applied');
  const ties = x => x.parts[0].spanners.filter(s => s.type === 'tie');
  assert.ok(ties(r.graph).every(t => t.from !== undefined || t.to !== undefined), 'a tie that lost one end is open, none is dangling');
  assert.equal(r.graph.parts[0].events.some(e => e.id === tied.sgEvent), false);
  assert.equal(A.ops.dropEvent(r.graph, { event: tied.sgEvent }).status, 'already');
});

test('ops.moveEvent: another place in the same bar; a place outside the bar is refused; the event keeps its id', () => {
  const g = graphOf();
  const sc = scoreOf(g);
  const n = noteAt(sc, 1, 2, 2);
  const r = A.ops.moveEvent(g, { event: n.sgEvent, m: 1, b: 2 });
  assert.equal(r.status, 'already');
  assert.throws(() => A.ops.moveEvent(g, { event: n.sgEvent, m: 1, b: 3 }), e => e.code === 'E-OMR-SKIP' && /outside the bar/.test(e.why), 'a half note at beat 3 would end after the bar');
  assert.throws(() => A.ops.moveEvent(g, { event: n.sgEvent, m: 1, b: 0.3333333 }), e => e.code === 'E-OMR-SKIP' || /E-OP/.test(e.message), 'a place that is no exact fraction');
  const free = A.ops.moveEvent(A.ops.dropEvent(g, { event: noteAt(sc, 1, 2, 0).sgEvent, of: 1 }).graph, { event: n.sgEvent, m: 1, b: 0 });
  assert.equal(free.status, 'applied');
  assert.equal(free.graph.parts[0].events.find(e => e.id === n.sgEvent).at, '0');
});

test('ops.markArpeggio / addOttava / addChord / removeChord / addMark / removeMark / setHeading: each makes its edit once and says "already" the second time', () => {
  const g = L.SG.musicxml.import(L.SC.truthDocRich(0, 2), { scoreId: 'r' }).graph;
  const sc = scoreOf(g);
  const heads = notesAt(sc, 1, 1, 0).map(n => n.sgHead);
  const steps = [
    ['markArpeggio', { heads: heads }, x => x.parts[0].spanners.filter(s => s.type === 'arpeggio').length === 1],
    ['addOttava', { staff: 1, m: 2, b: 0, endM: 2, endB: 3.001, dir: 1, size: 8, semitones: 12 }, x => x.parts[0].spanners.filter(s => s.type === 'ottava').length === 1],
    ['addChord', { m: 1, b: 0, text: 'Cmaj7' }, x => scoreOf(x).chords.map(c => c.text).join() === 'Cmaj7'],
    ['addMark', { m: 2, kind: 'dc', text: 'D.C. al Fine' }, x => x.timeline.jumps.length === 1 && x.timeline.jumps[0].kind === 'dacapo'],
    ['setHeading', { title: 'Name', composer: 'Someone', tempo: 66 }, x => x.meta.title === 'Name' && x.meta.composer === 'Someone' && scoreOf(x).tempo === 66],
    ['removeChord', { m: 1, b: 0, text: 'Cmaj7' }, x => scoreOf(x).chords.length === 0],
    ['removeMark', { m: 2, kind: 'dc', text: 'D.C. al Fine' }, x => (x.timeline.jumps || []).length === 0]
  ];
  let cur = g;
  for (const [name, item, check] of steps) {
    const a = A.ops[name](cur, item);
    assert.equal(a.status, 'applied', name);
    assert.ok(check(a.graph), name + ': the graph says it');
    const b = A.ops[name](a.graph, item);
    assert.equal(b.status, 'already', name + ' again');
    assert.equal(b.graph, a.graph, name + ' again: the same graph');
    cur = a.graph;
  }
  assert.throws(() => A.ops.addChord(cur, { m: 1, b: 0, text: '???' }), e => e.code === 'E-OMR-SKIP');
  assert.throws(() => A.ops.addMark(cur, { m: 99, kind: 'segno' }), e => e.code === 'E-OMR-SKIP' && /no such bar/.test(e.why));
  assert.throws(() => A.ops.addOttava(cur, { staff: 9, m: 1, b: 0, endM: 1, endB: 1, dir: 1, size: 8 }), e => e.code === 'E-OMR-SKIP' && /no such staff/.test(e.why));
  assert.throws(() => A.ops.markArpeggio(cur, { heads: [heads[0]] }), e => e.code === 'E-OMR-SKIP');
});

test('the edited graph is a graph like any other: it validates, it serialises and parses back the same, and the Score and the graph agree', () => {
  const g = graphOf();
  const { before, after } = L.runDouble(g, (s, P) => { P.accidental(s, noteAt(s, 2, 1, 2), 'sharp'); P.phantom(s, notesAt(s, 1, 1, 1)); P.chords(s, [1], [{ m: 1, b: 0, text: 'C' }]); });
  const r = A.apply(g, A.diff(before, after));
  assert.equal(SG.validate(r.graph).ok, true);
  assert.equal(SG.fingerprint(SG.parse(SG.serialize(r.graph))), SG.fingerprint(r.graph));
  assert.equal(SG.legacy.agree(scoreOf(r.graph), r.graph).ok, true);
});

test('the module needs the library: without it loading says so', () => {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const src = fs.readFileSync(path.join(L.REPO, 'omr', 'apply.js'), 'utf8');
  const sandbox = { globalThis: {}, console: console };
  sandbox.globalThis = sandbox;
  assert.throws(() => vm.runInNewContext(src, sandbox), /needs the ScoreGraph library/);
  /* and in a page that has the library the module is window.PPPOmrApply */
  const page = { PPPScoreGraph: SG };
  page.globalThis = page;
  vm.runInNewContext(src, page);
  assert.equal(typeof page.PPPOmrApply.apply, 'function');
});
