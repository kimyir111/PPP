'use strict';
/* omr/edit-ops.js (G12-4, docs/GOALS/G12_OMR.md sections 7.4 and 9.3): every edit of the correction UI as a graph op - what it makes, what it refuses, what it leaves alone.
   Each result must be a valid graph whose Score (toScore) is the graph's (L.check), and the graph it was given must not have changed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./lib.js');
const { SG, OPS, q, h, w, e8, rq, rh, rw, N } = L;
const R = SG.rational;

const sum = (g, bar, voiceOf) => {
  const m = g.timeline.measures[bar].id;
  let s = R.ZERO;
  g.parts[0].events.forEach(e => { if (e.m === m && !e.grace && (voiceOf === undefined || e.staff === voiceOf)) s = R.add(s, R.parse(e.dur)); });
  return s;
};
const staves = g => g.parts[0].staves.map(s => s.id);
const ok = (r, label) => { const bad = L.check(r.graph, label); assert.equal(bad, null, bad); return r; };
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof OPS.EditError && e.code === code, 'expected EditError ' + code);
const prints = (g, bar) => JSON.stringify(L.barOf(g, bar).map(e => [e.staff.slice(2), e.kind[0], e.at, e.dur, e.pitches.join('+')]));
const frozenSame = (g, f) => { const before = SG.serialize(g); f(); assert.equal(SG.serialize(g), before, 'the input graph changed'); };
const hasEdited = (prov, aspect) => !!prov && ((prov.op === 'edited') || (prov.asp && prov.asp[aspect] && prov.asp[aspect].op === 'edited'));

/* --------------------------------------------------------------------------------------------- pitch */
test('step: the letter moves, the input graph does not', () => {
  const g = L.plain(2);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'D5');
  frozenSame(g, () => {
    const r = ok(OPS.step(g, { head: ev.heads[0], by: 1 }));
    assert.equal(r.changed, true);
    assert.deepEqual(L.names(L.notesOf(r.graph, 0).filter(e => e.staff === staves(g)[0])), ['C5', 'E5', 'E5', 'F5']);
    const r2 = ok(OPS.step(g, { head: ev.heads[0], by: -1 }));
    assert.deepEqual(L.names(L.notesOf(r2.graph, 0).filter(e => e.staff === staves(g)[0])), ['C5', 'C5', 'E5', 'F5']);
  });
});
test('step: the sound follows the notation (G major: up from E is F sharp), a printed accidental stays', () => {
  const g = L.graphOf([{ rh: [q('E5'), q('A5', { acc: 'flat' }), q('C5'), q('D5')], lh: [w('C3')] }], { fifths: 1 });
  const e = L.notesOf(g, 0).filter(x => x.staff === staves(g)[0]);
  const up = ok(OPS.step(g, { head: e[0].heads[0], by: 1 }));
  assert.equal(L.notesOf(up.graph, 0).find(x => x.id === e[0].id).pitches[0], 'F#5');
  const up2 = ok(OPS.step(g, { head: e[1].heads[0], by: 1 }));            /* A flat printed: up a step is B flat */
  assert.equal(L.notesOf(up2.graph, 0).find(x => x.id === e[1].id).pitches[0], 'Bb5');
});
test('step: a chord moves one head, a tied chain moves together', () => {
  const g = L.graphOf([{ rh: [q('D5'), q('F5'), q('G5'), q('C5', { tie: 'start' }), q('E5', { chord: true })], lh: [w('C3')] }, { rh: [q('C5', { tie: 'stop' }), q('G5'), h('A5')], lh: [w('C3')] }]);
  assert.equal(g.parts[0].spanners.filter(s => s.type === 'tie' && s.from && s.to).length, 1, 'the fixture has its tie');
  const e = L.notesOf(g, 0).find(x => x.pitches.length === 2);
  const r = ok(OPS.step(g, { head: e.heads[1], by: 1 }));
  assert.deepEqual(L.notesOf(r.graph, 0).find(x => x.id === e.id).pitches, ['C5', 'F5']);
  /* the C5 that is tied into bar 2: moving the end moves the start */
  const next = L.notesOf(g, 1).find(x => x.pitches[0] === 'C5');
  const r2 = ok(OPS.step(g, { head: next.heads[0], by: 1 }));
  assert.deepEqual(L.notesOf(r2.graph, 0).find(x => x.id === e.id).pitches, ['D5', 'E5']);
  assert.equal(L.notesOf(r2.graph, 1).find(x => x.id === next.id).pitches[0], 'D5');
  assert.equal(r2.graph.parts[0].spanners.filter(s => s.type === 'tie' && s.from && s.to).length, 1, 'the tie is still a tie');
});
test('octave: seven steps; the piano is the limit', () => {
  const g = L.plain(1);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.octave(g, { head: ev.heads[0], by: 1 }));
  assert.equal(L.notesOf(r.graph, 0).find(e => e.id === ev.id).pitches[0], 'C6');
  let cur = g;
  for (let i = 0; i < 3; i++) cur = ok(OPS.octave(cur, { head: ev.heads[0], by: 1 })).graph;
  throwsCode(() => OPS.octave(cur, { head: ev.heads[0], by: 1 }), 'out-of-range');
});
test('accidental: a sharp printed on a note holds for the notes after it on that line in the bar, and only there', () => {
  const g = L.graphOf([{ rh: [q('F5'), q('F5'), q('G5'), q('F4')], lh: [w('C3')] }, { rh: [q('F5'), q('F5'), q('G5'), q('F5')], lh: [w('C3')] }], { fifths: 0 });
  const e = L.notesOf(g, 0).filter(x => x.staff === staves(g)[0]);
  const s = ok(OPS.accidental(g, { head: e[0].heads[0], acc: 'sharp' }));
  assert.deepEqual(L.names(L.notesOf(s.graph, 0).filter(x => x.staff === staves(g)[0])), ['F#5', 'F#5', 'G5', 'F4'], 'the F of another octave is not the same line');
  assert.deepEqual(L.names(L.notesOf(s.graph, 1).filter(x => x.staff === staves(g)[0])), ['F5', 'F5', 'G5', 'F5'], 'a bar line ends it');
});
test('accidental: a printed sharp holds for the rest of the bar (notation), and a note that relied on it follows an edit', () => {
  /* F# printed, then an F with nothing printed in the same bar: the second sounds F# by the first's accidental */
  const g = L.graphOf([{ rh: [q('F#5', { acc: 'sharp' }), q('F#5'), q('G5'), q('A5')], lh: [w('C3')] }]);
  const e = L.notesOf(g, 0).filter(x => x.staff === staves(g)[0]);
  assert.deepEqual(L.names(e), ['F#5', 'F#5', 'G5', 'A5']);
  /* take the first sharp off: the first F is F natural, and so is the second (it relied on the sharp before it) */
  const r = ok(OPS.accidental(g, { head: e[0].heads[0], acc: null }));
  const f = L.notesOf(r.graph, 0).filter(x => x.staff === staves(g)[0]);
  assert.deepEqual(L.names(f), ['F5', 'F5', 'G5', 'A5']);
  /* make it a flat: both are F flat */
  const r2 = ok(OPS.accidental(g, { head: e[0].heads[0], acc: 'flat' }));
  assert.deepEqual(L.names(L.notesOf(r2.graph, 0).filter(x => x.staff === staves(g)[0])), ['Fb5', 'Fb5', 'G5', 'A5']);
});
test('an edit leaves a note alone whose sound already disagreed with its notation', () => {
  /* G major, F written with no accidental and sounding F natural (the engine's reading): not the edit's business */
  const g = L.graphOf([{ rh: [q('C5'), q('F5'), q('G5'), q('A5')], lh: [w('C3')] }], { fifths: 1 });
  const e = L.notesOf(g, 0).filter(x => x.staff === staves(g)[0]);
  assert.equal(e[1].pitches[0], 'F5');
  const r = ok(OPS.step(g, { head: e[0].heads[0], by: 1 }));
  assert.equal(L.notesOf(r.graph, 0).filter(x => x.staff === staves(g)[0])[1].pitches[0], 'F5');
});
test('key: the notes under it are read again; a printed accidental is not touched; only up to the next key', () => {
  const g = L.graphOf([{ rh: [q('F5'), q('G5'), q('C5'), q('F5', { acc: 'natural' })], lh: [w('C3')] }, { rh: [q('F5'), q('C5'), q('D5'), q('F5')], lh: [w('F2')] }]);
  const m = g.timeline.measures;
  const two = ok(OPS.setKey(g, { measure: m[0].id, fifths: 2 }));
  assert.deepEqual(L.names(L.notesOf(two.graph, 0).filter(x => x.staff === staves(g)[0])), ['F#5', 'G5', 'C#5', 'F5']);
  assert.deepEqual(L.names(L.notesOf(two.graph, 1).filter(x => x.staff === staves(g)[0])), ['F#5', 'C#5', 'D5', 'F#5']);
  assert.equal(L.notesOf(two.graph, 1).find(x => x.staff === staves(g)[1]).pitches[0], 'F#2');
  /* from bar 2 only */
  const from2 = ok(OPS.setKey(g, { measure: m[1].id, fifths: -1 }));
  assert.deepEqual(L.names(L.notesOf(from2.graph, 0).filter(x => x.staff === staves(g)[0])), ['F5', 'G5', 'C5', 'F5']);
  assert.equal(L.notesOf(from2.graph, 1).find(x => x.staff === staves(g)[1]).pitches[0], 'F2');
  assert.deepEqual(L.names(L.notesOf(from2.graph, 1).filter(x => x.staff === staves(g)[0])), ['F5', 'C5', 'D5', 'F5']);
  const f3 = ok(OPS.setKey(g, { measure: m[1].id, fifths: -3 }));        /* B E A flat: no F, C, D, G changes */
  assert.equal(f3.graph.timeline.keys.length, 2);
  /* a key already there is no change */
  assert.equal(OPS.setKey(g, { measure: m[0].id, fifths: 0 }).changed, false);
});
test('key: stops at the next key signature', () => {
  const g = L.graphOf([{ rh: [q('F5'), q('F5'), q('F5'), q('F5')], lh: [w('C3')] }, { rh: [q('F5'), q('F5'), q('F5'), q('F5')], lh: [w('C3')] }, { rh: [q('F5'), q('F5'), q('F5'), q('F5')], lh: [w('C3')] }]);
  const m = g.timeline.measures;
  const a = ok(OPS.setKey(g, { measure: m[2].id, fifths: -1 }));
  const b = ok(OPS.setKey(a.graph, { measure: m[0].id, fifths: 2 }));
  /* bars 1-2 in D major (F#), bar 3 keeps the key it was given (F major: F natural) */
  assert.equal(L.notesOf(b.graph, 0)[0].pitches[0], 'F#5');
  assert.equal(L.notesOf(b.graph, 1)[0].pitches[0], 'F#5');
  assert.equal(L.notesOf(b.graph, 2)[0].pitches[0], 'F5');
});
test('clef: the notes of that staff under it mean the pitch of their place in the new clef, and read in the key', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F5')], lh: [q('C3'), q('E3'), q('G3'), q('B3')] }, { rh: [w('C5')], lh: [w('C3')] }], { fifths: 1 });
  const lh = staves(g)[1];
  const r = ok(OPS.setClef(g, { measure: g.timeline.measures[0].id, staff: lh, sign: 'G' }));
  /* C3 E3 G3 B3 in bass clef are A4 C5 E5 G5 in treble (12 steps up); F# is not among them */
  assert.deepEqual(L.names(L.notesOf(r.graph, 0).filter(x => x.staff === lh)), ['A4', 'C5', 'E5', 'G5']);
  assert.deepEqual(L.names(L.notesOf(r.graph, 1).filter(x => x.staff === lh)), ['A4']);
  /* the other staff is where it was */
  assert.deepEqual(L.names(L.notesOf(r.graph, 0).filter(x => x.staff === staves(g)[0])), ['C5', 'D5', 'E5', 'F5']);
  /* the same clef is no change */
  assert.equal(OPS.setClef(g, { measure: g.timeline.measures[0].id, staff: lh, sign: 'F' }).changed, false);
  /* from bar 2 only: bar 1 stays */
  const r2 = ok(OPS.setClef(g, { measure: g.timeline.measures[1].id, staff: lh, sign: 'G' }));
  assert.deepEqual(L.names(L.notesOf(r2.graph, 0).filter(x => x.staff === lh)), ['C3', 'E3', 'G3', 'B3']);
  assert.deepEqual(L.names(L.notesOf(r2.graph, 1).filter(x => x.staff === lh)), ['A4']);
});

test('clef: a tied note is read from the start of its tie, whichever end of the tie the clef moves', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F#5', { tie: 'start', acc: 'sharp' })], lh: [w('C3')] }, { rh: [q('F#5', { tie: 'stop' }), q('G5'), h('A5')], lh: [w('C3')] }]);
  const rh = staves(g)[0];
  const tied = gr => { const n = L.notesOf(gr, 0).concat(L.notesOf(gr, 1)).filter(x => x.staff === rh); return [n[3].pitches[0], n[4].pitches[0]]; };
  /* the clef from bar 1: both ends move, the printed sharp is still read, and the end is the start */
  const a = ok(OPS.setClef(g, { measure: g.timeline.measures[0].id, staff: rh, sign: 'F' }));
  const ta = tied(a.graph);
  assert.equal(ta[0], ta[1], 'both ends of the tie sound one pitch');
  assert.ok(/#/.test(ta[0]), 'the sharp that is printed is read: ' + ta[0]);
  /* the clef from bar 2: only the end moves, and it goes on from the start, which was not touched */
  const b = ok(OPS.setClef(g, { measure: g.timeline.measures[1].id, staff: rh, sign: 'F' }));
  const tb = tied(b.graph);
  assert.equal(tb[0], 'F#5');
  assert.equal(tb[1], 'F#5', 'the end follows the start');
  /* the end of the tie on the other staff (a note moved across), the clef on that staff: the start is not on it and is not moved */
  const end = L.notesOf(g, 1).find(x => x.staff === rh && x.pitches[0] === 'F#5');
  const across = ok(OPS.moveStaff(g, { event: end.id }));
  const lh = staves(g)[1];
  const c = ok(OPS.setClef(across.graph, { measure: g.timeline.measures[0].id, staff: lh, sign: 'G' }));
  const startNote = L.notesOf(c.graph, 0).find(x => x.staff === rh && x.pitches[0] === 'F#5');
  const endNote = L.notesOf(c.graph, 1).find(x => x.staff === lh && /F#|F♯/.test(x.pitches[0]));
  assert.ok(startNote, 'the start still sounds F#5');
  assert.ok(endNote, 'the end went on from it: ' + L.names(L.notesOf(c.graph, 1)));
});

/* --------------------------------------------------------------------------------------------- rhythm */
test('value: halve leaves a rest where the time was; the bar is as full as it was', () => {
  const g = L.plain(1);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.value(g, { event: ev.id, change: 'halve' }));
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staves(g)[0]);
  assert.deepEqual(bar.map(e => [e.kind[0], e.at, e.dur]), [['n', '0', '1/8'], ['r', '1/8', '1/8'], ['n', '1/4', '1/4'], ['n', '1/2', '1/4'], ['n', '3/4', '1/4']]);
  assert.equal(R.format(sum(r.graph, 0, staves(g)[0])), '1');
  assert.equal(L.notesOf(r.graph, 0).find(e => e.id === ev.id).display.type, 'eighth');
});
test('value: double takes the rest after it; it stops at the next note and at the bar line', () => {
  const g = L.graphOf([{ rh: [q('C5'), rq(), h('E5')], lh: [w('C3')] }]);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.value(g, { event: ev.id, change: 'double' }));
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staves(g)[0]);
  assert.deepEqual(bar.map(e => [e.kind[0], e.at, e.dur]), [['n', '0', '1/2'], ['n', '1/2', '1/2']]);
  const last = L.notesOf(g, 0).find(e => e.pitches[0] === 'E5');
  throwsCode(() => OPS.value(g, { event: last.id, change: 'double' }), 'no-room');
  const g2 = L.plain(1);
  throwsCode(() => OPS.value(g2, { event: L.notesOf(g2, 0).find(e => e.pitches[0] === 'C5').id, change: 'double' }), 'no-room');
});
test('value: a dot is refused where a note follows', () => {
  const g = L.plain(1);
  throwsCode(() => OPS.value(g, { event: L.notesOf(g, 0).find(e => e.pitches[0] === 'C5').id, change: 'dot' }), 'no-room');
});
test('value: a dot makes it half as long again over a rest, and takes it off again', () => {
  const g = L.graphOf([{ rh: [q('C5'), N('r/half'), q('E5')], lh: [w('C3')] }]);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.value(g, { event: ev.id, change: 'dot' }));
  const c = L.notesOf(r.graph, 0).find(e => e.id === ev.id);
  assert.equal(c.dur, '3/8');
  assert.deepEqual(c.display, { type: 'quarter', dots: 1 });
  const back = ok(OPS.value(r.graph, { event: ev.id, change: 'dot' }));
  assert.equal(L.notesOf(back.graph, 0).find(e => e.id === ev.id).dur, '1/4');
  assert.equal(R.format(sum(back.graph, 0, staves(g)[0])), '1');
});
test('value: halve all the way down, then refuse', () => {
  let g = L.graphOf([{ rh: [w('C5')], lh: [w('C3')] }]);
  const id = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5').id;
  const lens = [];
  for (let i = 0; i < 6; i++) { g = ok(OPS.value(g, { event: id, change: 'halve' })).graph; lens.push(L.notesOf(g, 0).find(e => e.id === id).dur); }
  assert.deepEqual(lens, ['1/2', '1/4', '1/8', '1/16', '1/32', '1/64']);
  throwsCode(() => OPS.value(g, { event: id, change: 'halve' }), 'too-short');
});
test('value: a note of a tuplet is refused, not broken', () => {
  /* three eighth triplets in the first beat, a dotted half rest after them, a whole note in the left hand */
  const raw = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>12</divisions>'
    + '<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
    + ['C', 'D', 'E'].map((s, i) => '<note><pitch><step>' + s + '</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>'
      + '<notations>' + (i === 0 ? '<tuplet type="start" number="1"/>' : i === 2 ? '<tuplet type="stop" number="1"/>' : '') + '</notations></note>').join('')
    + '<note><rest/><duration>36</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><backup><duration>48</duration></backup>'
    + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>48</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure></part></score-partwise>';
  const r = SG.musicxml.import(raw, { scoreId: 'tup', sourceName: 't.xml' });
  assert.ok(r.ok, r.message);
  const g = r.graph;
  const tup = g.parts[0].spanners.find(s => s.type === 'tuplet');
  assert.ok(tup && tup.events.length === 3, 'the fixture has its tuplet');
  const ev = tup.events[1];
  throwsCode(() => OPS.value(g, { event: ev, change: 'halve' }), 'in-tuplet');
  throwsCode(() => OPS.value(g, { event: ev, change: 'double' }), 'in-tuplet');
  throwsCode(() => OPS.toRest(g, { event: ev }), 'in-tuplet');
  throwsCode(() => OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '1/16' }), 'in-tuplet');
  /* the note itself can still be moved up a step: it is a pitch edit */
  const head = g.parts[0].events.find(e => e.id === ev).heads[0].id;
  ok(OPS.step(g, { head: head, by: 1 }));
});
test('rest: a note becomes a rest of its length, and a rest a note: the pitch of the staff before it', () => {
  const g = L.plain(1);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'D5');
  const r = ok(OPS.toRest(g, { event: ev.id }));
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staves(g)[0]);
  assert.deepEqual(bar.map(e => e.kind[0] + e.at), ['n0', 'r1/4', 'n1/2', 'n3/4']);
  const rest = bar[1];
  const back = ok(OPS.toNote(r.graph, { event: rest.id }));
  const b2 = L.barOf(back.graph, 0).filter(e => e.staff === staves(g)[0]);
  assert.deepEqual(b2.map(e => e.kind[0] + e.at + ':' + e.pitches.join('')), ['n0:C5', 'n1/4:C5', 'n1/2:E5', 'n3/4:F5']);
  /* with a pitch */
  const back2 = ok(OPS.toNote(r.graph, { event: rest.id, pitch: { step: 'A', oct: 4 } }));
  assert.equal(L.barOf(back2.graph, 0).filter(e => e.staff === staves(g)[0])[1].pitches[0], 'A4');
});
test('rest: a whole bar of rest becomes one note as long as the bar', () => {
  const g = L.graphOf([{ rh: [rw()], lh: [w('C3')] }]);
  const rest = L.barOf(g, 0).find(e => e.kind === 'rest');
  const r = ok(OPS.toNote(g, { event: rest.id }));
  const n = L.notesOf(r.graph, 0).find(e => e.staff === staves(g)[0]);
  assert.equal(n.dur, '1');
  assert.equal(n.pitches.length, 1);
});
test('delete: one head of a chord goes and the rest stay; the last head makes a rest', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('E5', { chord: true }), q('G5', { chord: true }), h('D5'), q('F5')], lh: [w('C3')] }]);
  const ch = L.notesOf(g, 0).find(e => e.pitches.length === 3);
  const r = ok(OPS.remove(g, { event: ch.id, head: ch.heads[1] }));
  assert.deepEqual(L.notesOf(r.graph, 0).find(e => e.id === ch.id).pitches, ['C5', 'G5']);
  const all = ok(OPS.remove(g, { event: ch.id }));
  assert.equal(L.barOf(all.graph, 0).find(e => e.id !== ch.id && e.at === '0' && e.staff === staves(g)[0]).kind, 'rest');
});
test('add: a note in a rest, at the tapped place; in the staff of the tap; a chord where a note already starts; refusals', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), N('r/half')], lh: [w('C3')] }]);
  const st = staves(g)[0], m = g.timeline.measures[0].id;
  const r = ok(OPS.add(g, { measure: m, staff: st, at: '1/2', pitch: { step: 'G', oct: 5 }, value: 'quarter' }));
  assert.deepEqual(L.barOf(r.graph, 0).filter(e => e.staff === st).map(e => e.kind[0] + e.at + ':' + e.dur + ':' + e.pitches.join('')), ['n0:1/4:C5', 'n1/4:1/4:D5', 'n1/2:1/4:G5', 'r3/4:1/4:']);
  const mid = ok(OPS.add(g, { measure: m, staff: st, at: '3/4', pitch: { step: 'A', oct: 5 }, value: 'half' }));      /* a half does not fit: a quarter */
  assert.deepEqual(L.barOf(mid.graph, 0).filter(e => e.staff === st).map(e => e.kind[0] + e.at + ':' + e.dur), ['n0:1/4', 'n1/4:1/4', 'r1/2:1/4', 'n3/4:1/4']);
  const ch = ok(OPS.add(g, { measure: m, staff: st, at: '0', pitch: { step: 'E', oct: 5 }, value: 'quarter' }));
  assert.deepEqual(L.notesOf(ch.graph, 0).find(e => e.at === '0' && e.staff === st).pitches, ['C5', 'E5']);
  throwsCode(() => OPS.add(g, { measure: m, staff: st, at: '0', pitch: { step: 'C', oct: 5 }, value: 'quarter' }), 'occupied');
  throwsCode(() => OPS.add(g, { measure: m, staff: 'st999', at: '0', pitch: { step: 'C', oct: 5 }, value: 'quarter' }), 'no-target');
  throwsCode(() => OPS.add(g, { measure: m, staff: st, at: '5/4', pitch: { step: 'C', oct: 5 }, value: 'quarter' }), 'no-target');
});
test('add: the key and the accidental printed in the bar decide the sound', () => {
  const g = L.graphOf([{ rh: [q('C5'), N('r/quarter'), N('r/half')], lh: [w('C3')] }], { fifths: 2 });
  const st = staves(g)[0], m = g.timeline.measures[0].id;
  const r = ok(OPS.add(g, { measure: m, staff: st, at: '1/4', pitch: { step: 'F', oct: 5 }, value: 'quarter' }));
  assert.equal(L.notesOf(r.graph, 0).find(e => e.at === '1/4' && e.staff === st).pitches[0], 'F#5');
  const n = ok(OPS.add(g, { measure: m, staff: st, at: '1/4', pitch: { step: 'F', oct: 5 }, value: 'quarter', acc: 'natural' }));
  assert.equal(L.notesOf(n.graph, 0).find(e => e.at === '1/4' && e.staff === st).pitches[0], 'F5');
});
test('staff: a note goes to the other hand, in a voice with room, and both hands are full', () => {
  const g = L.plain(1);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.moveStaff(g, { event: ev.id }));
  const moved = L.notesOf(r.graph, 0).find(e => e.id === ev.id);
  assert.equal(moved.staff, staves(g)[1]);
  assert.equal(R.format(sum(r.graph, 0, staves(g)[0])), '1');
  const left = R.format(r.graph.parts[0].events.filter(e => e.m === r.graph.timeline.measures[0].id && e.voice === moved.voice).reduce((s, e) => R.add(s, R.parse(e.dur)), R.ZERO));
  assert.equal(left, '1', 'the voice that took the note is full');
  throwsCode(() => OPS.moveStaff(r.graph, { event: ev.id, staff: staves(g)[1] }), 'same-staff');
});

/* --------------------------------------------------------------------------------------------- the time signature and the bars */
test('time: bars as long as it says; a note that would be cut stops it; a pickup stays short', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), N('r/quarter')], lh: [w('C3')] }, { rh: [q('C5'), q('D5'), N('r/half')], lh: [w('C3')] }]);
  const m = g.timeline.measures;
  throwsCode(() => OPS.setTime(g, { measure: m[0].id, beats: 3, beatType: 4 }), 'would-cut');   /* the whole note of the left hand */
  const g2 = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), N('r/quarter')], lh: [h('C3'), rh()] }, { rh: [q('C5'), q('D5'), N('r/half')], lh: [h('C3'), rh()] }]);
  const r = ok(OPS.setTime(g2, { measure: g2.timeline.measures[0].id, beats: 6, beatType: 4 }));
  assert.deepEqual(r.graph.timeline.measures.map(x => x.dur), ['3/2', '3/2']);
  assert.equal(r.graph.timeline.meters.length, 1);
  assert.equal(R.format(sum(r.graph, 0, staves(g2)[0])), '3/2', 'the voice is full again: a rest after its last note');
  /* from bar 2 only: a new meter event */
  const two = ok(OPS.setTime(g2, { measure: g2.timeline.measures[1].id, beats: 2, beatType: 4 }));
  assert.equal(two.graph.timeline.meters.length, 2);
  assert.deepEqual(two.graph.timeline.measures.map(x => x.dur), ['1', '1/2']);
});
test('time: the same time signature is no change; the next one, when it is the same again, goes', () => {
  const g = L.plain(3);
  assert.equal(OPS.setTime(g, { measure: g.timeline.measures[0].id, beats: 4, beatType: 4 }).changed, false);
  const rests = L.graphOf([{ rh: [rw()], lh: [rw()] }, { rh: [rw()], lh: [rw()] }]);
  const m = rests.timeline.measures;
  const two = ok(OPS.setTime(rests, { measure: m[1].id, beats: 3, beatType: 4 }));
  assert.equal(two.graph.timeline.meters.length, 2);
  assert.deepEqual(two.graph.timeline.measures.map(x => x.dur), ['1', '3/4']);
  assert.ok(L.barOf(two.graph, 1).every(e => e.kind === 'rest' && e.dur === '3/4' && e.display.measureRest), 'a whole bar of rest is written again for the new length');
  const one = ok(OPS.setTime(two.graph, { measure: m[0].id, beats: 3, beatType: 4 }));
  assert.equal(one.graph.timeline.meters.length, 1, 'the second bar says what the first now says: one time signature');
  assert.deepEqual(one.graph.timeline.measures.map(x => x.dur), ['3/4', '3/4']);
});
test('insert: an empty bar as long as the time signature there; before the first it takes the start of the score', () => {
  const g = L.plain(3);
  const m = g.timeline.measures;
  const a = ok(OPS.insertBar(g, { after: m[0].id }));
  assert.equal(a.graph.timeline.measures.length, 4);
  assert.deepEqual(a.graph.timeline.measures.map(x => x.number), ['1', '2', '3', '4']);
  const inserted = a.graph.timeline.measures[1];
  const evs = L.barOf(a.graph, 1);
  assert.ok(evs.every(e => e.kind === 'rest' && e.at === '0' && e.dur === '1'), 'a whole-bar rest in each staff');
  assert.equal(evs.length, 2);
  assert.ok(evs.every(e => e.display && e.display.measureRest));
  void inserted;
  const b = ok(OPS.insertBar(g, { before: m[0].id }));
  assert.equal(b.graph.timeline.measures[0].id, b.measures[0] || b.graph.timeline.measures[0].id);
  assert.equal(b.graph.timeline.meters[0].m, b.graph.timeline.measures[0].id, 'the time signature starts the score');
  assert.ok(b.graph.parts[0].clefs.every(c => c.m === b.graph.timeline.measures[0].id), 'the clefs too');
  assert.deepEqual(b.graph.timeline.measures.map(x => x.number), ['1', '2', '3', '4']);
});
test('insert: a tie that crossed the place is ended, not left in the air', () => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F5', { tie: 'start' })], lh: [w('C3')] }, { rh: [q('F5', { tie: 'stop' }), q('G5'), h('A5')], lh: [w('C3')] }]);
  const r = ok(OPS.insertBar(g, { after: g.timeline.measures[0].id }));
  assert.equal(r.graph.parts[0].spanners.filter(s => s.type === 'tie').length, 0);
});
test('delete: a bar goes with what is in it; the first bar hands the start of the score on; the only bar stays', () => {
  const g = L.plain(3);
  const m = g.timeline.measures;
  const mid = ok(OPS.removeBar(g, { measure: m[1].id }));
  assert.deepEqual(mid.graph.timeline.measures.map(x => x.number), ['1', '2']);
  assert.equal(mid.graph.parts[0].events.filter(e => e.m === m[1].id).length, 0);
  const first = ok(OPS.removeBar(g, { measure: m[0].id }));
  assert.equal(first.graph.timeline.measures[0].number, '1');
  assert.equal(first.graph.timeline.meters[0].m, m[1].id, 'the time signature moves to the new first bar');
  assert.equal(first.graph.timeline.keys[0].m, m[1].id);
  assert.ok(first.graph.parts[0].clefs.length === 2 && first.graph.parts[0].clefs.every(c => c.m === m[1].id));
  throwsCode(() => OPS.removeBar(L.plain(1), { measure: L.plain(1).timeline.measures[0].id }), 'last-bar');
});
test('split: the bar becomes two, a note across the place is two tied notes; join puts it back', () => {
  const g = L.plain(2);
  const m = g.timeline.measures;
  const s = ok(OPS.splitBar(g, { measure: m[0].id, at: '1/2' }));
  assert.equal(s.graph.timeline.measures.length, 3);
  assert.deepEqual(s.graph.timeline.measures.map(x => x.dur), ['1/2', '1/2', '1']);
  assert.deepEqual(s.graph.timeline.measures.map(x => x.number), ['1', '2', '3']);
  assert.deepEqual(L.names(L.notesOf(s.graph, 0).filter(e => e.staff === staves(g)[0])), ['C5', 'D5']);
  assert.deepEqual(L.names(L.notesOf(s.graph, 1).filter(e => e.staff === staves(g)[0])), ['E5', 'F5']);
  /* the whole note of the left hand crossed the place: two halves, tied */
  assert.deepEqual(L.notesOf(s.graph, 0).filter(e => e.staff === staves(g)[1]).map(e => e.dur + e.pitches[0]), ['1/2C3']);
  assert.deepEqual(L.notesOf(s.graph, 1).filter(e => e.staff === staves(g)[1]).map(e => e.dur + e.pitches[0]), ['1/2C3']);
  assert.equal(s.graph.parts[0].spanners.filter(x => x.type === 'tie').length, 1);
  const back = ok(OPS.mergeBars(s.graph, { measure: s.graph.timeline.measures[0].id }));
  assert.equal(back.graph.timeline.measures.length, 2);
  assert.deepEqual(back.graph.timeline.measures.map(x => x.dur), ['1', '1']);
  /* a place that is not a printable value of the note across it: three eighths in a quarter-based note */
  const odd = ok(OPS.splitBar(g, { measure: m[0].id, at: '3/8' }));
  assert.equal(odd.graph.timeline.measures.length, 3);
  assert.deepEqual(L.barOf(odd.graph, 0).filter(e => e.staff === staves(g)[0]).map(e => e.at + ':' + e.dur), ['0:1/4', '1/4:1/8']);
});
test('join: two bars become one; different time signatures do not', () => {
  const g = L.plain(3);
  const r = ok(OPS.mergeBars(g, { measure: g.timeline.measures[0].id }));
  assert.equal(r.graph.timeline.measures.length, 2);
  assert.equal(r.graph.timeline.measures[0].dur, '2');
  assert.deepEqual(L.names(L.notesOf(r.graph, 0).filter(e => e.staff === staves(g)[0])), ['C5', 'D5', 'E5', 'F5', 'C5', 'D5', 'E5', 'F5']);
  const three = L.graphOf([{ rh: [q('C5'), q('D5'), N('r/quarter')], lh: [h('C3'), N('r/quarter')] }, { rh: [q('C5'), N('r/half')], lh: [rh(), N('r/quarter')] }], { beats: 3, beatType: 4 });
  const sw = ok(OPS.setTime(three, { measure: three.timeline.measures[1].id, beats: 2, beatType: 4 }));
  assert.equal(sw.graph.timeline.meters.length, 2);
  throwsCode(() => OPS.mergeBars(sw.graph, { measure: sw.graph.timeline.measures[0].id }), 'meter-differs');
});

test('join: a repeat sign between the two bars is not lost silently', () => {
  const xml = L.xmlOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F5')], lh: [w('C3')] }, { rh: [q('C5'), q('D5'), q('E5'), q('F5')], lh: [w('C3')] }])
    .replace('</measure>', '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline></measure>');
  const r = SG.musicxml.import(xml, { scoreId: 'rep', sourceName: 'r.xml' });
  assert.ok(r.ok, r.message);
  throwsCode(() => OPS.mergeBars(r.graph, { measure: r.graph.timeline.measures[0].id }), 'barline');
});

/* --------------------------------------------------------------------------------------------- staves and parts */
const twoParts = () => {
  const mk = (id, clef, oct) => '<part id="' + id + '"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>' + clef[0]
    + '</sign><line>' + clef[1] + '</line></clef></attributes>' + ['C', 'D', 'E', 'F'].map(s => '<note><pitch><step>' + s + '</step><octave>' + oct + '</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>').join('') + '</measure></part>';
  const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>R</part-name></score-part><score-part id="P2"><part-name>L</part-name></score-part></part-list>'
    + mk('P1', ['G', 2], 5) + mk('P2', ['F', 4], 3) + '</score-partwise>';
  const r = SG.musicxml.import(xml, { scoreId: 'two-parts', sourceName: 'p.xml' });
  assert.ok(r.ok, r.message);
  return r.graph;
};
test('two one-staff parts become one piano part; the hands follow the staves', () => {
  const g = twoParts();
  assert.equal(g.parts.length, 2);
  const r = ok(OPS.mergeParts(g, { keep: g.parts[0].id, into: g.parts[1].id }));
  assert.equal(r.graph.parts.length, 1);
  assert.equal(r.graph.parts[0].staves.length, 2);
  const sc = SG.legacy.toScore(r.graph, { name: 'x' });
  const hands = new Set(sc.notes.map(n => n.hand));
  assert.deepEqual(Array.from(hands).sort(), ['l', 'r']);
});
test('hands: a staff is the left hand (the parts change places); a staff of a piano part is moved up or down', () => {
  const g = twoParts();
  /* by-staff rule: the first part is the right hand */
  const second = g.parts[1].staves[0].id;
  const r = ok(OPS.assignHand(g, { staff: second, hand: 'RH' }));
  assert.equal(r.graph.parts[0].id, g.parts[1].id);
  assert.equal(OPS.assignHand(g, { staff: g.parts[0].staves[0].id, hand: 'RH' }).changed, false);
  const piano = L.plain(1);
  const lh = piano.parts[0].staves[1].id;
  const p = ok(OPS.assignHand(piano, { staff: lh, hand: 'RH' }));
  assert.equal(p.graph.parts[0].staves[0].id, lh);
});

/* --------------------------------------------------------------------------------------------- what a person did is marked */
test('provenance: what an edit changes says edited, with the editor as its source', () => {
  const g = L.plain(1);
  const ev = L.notesOf(g, 0).find(e => e.pitches[0] === 'C5');
  const r = ok(OPS.step(g, { head: ev.heads[0], by: 1 }));
  const e = r.graph.parts[0].events.find(x => x.id === ev.id);
  assert.ok(hasEdited(e.heads[0].prov, 'pitch'));
  const src = r.graph.provenance.sources.find(s => s.id === e.heads[0].prov.asp.pitch.src);
  assert.equal(src.kind, 'user');
  assert.equal(src.tool, 'ppp.omr-editor');
  assert.ok(OPS.editedBars(r.graph).has(r.graph.timeline.measures[0].id));
  assert.equal(OPS.editedBars(g).size, 0);
  const v = ok(OPS.value(g, { event: ev.id, change: 'halve' }));
  assert.ok(hasEdited(v.graph.parts[0].events.find(x => x.id === ev.id).prov, 'rhythm'));
  const s = ok(OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '1/2' }));
  assert.ok(OPS.editedBars(s.graph).size >= 2);
});
test('reviewed: a bar marked right stays marked until an edit touches it', () => {
  const g = L.plain(2);
  const m = g.timeline.measures;
  const a = ok(OPS.markReviewed(g, { measure: m[0].id }));
  assert.ok(OPS.reviewedBars(a.graph).has(m[0].id));
  assert.equal(OPS.markReviewed(a.graph, { measure: m[0].id }).changed, false);
  const b = ok(OPS.step(a.graph, { head: L.notesOf(a.graph, 1)[0].heads[0], by: 1 }));       /* another bar */
  assert.ok(OPS.reviewedBars(b.graph).has(m[0].id));
  const c = ok(OPS.step(a.graph, { head: L.notesOf(a.graph, 0)[0].heads[0], by: 1 }));
  assert.ok(!OPS.reviewedBars(c.graph).has(m[0].id), 'an edit of the bar takes the mark off');
  const d = ok(OPS.unmarkReviewed(a.graph, { measure: m[0].id }));
  assert.equal(OPS.reviewedBars(d.graph).size, 0);
  /* a bar that is deleted takes its mark with it */
  const e = ok(OPS.removeBar(a.graph, { measure: m[0].id }));
  assert.equal(OPS.reviewedBars(e.graph).size, 0);
});
test('the ops name what is not there instead of throwing something else', () => {
  const g = L.plain(1);
  throwsCode(() => OPS.step(g, { head: 'h999', by: 1 }), 'no-target');
  throwsCode(() => OPS.value(g, { event: 'e999', change: 'halve' }), 'no-target');
  throwsCode(() => OPS.insertBar(g, { after: 'm999' }), 'no-target');
  throwsCode(() => OPS.setKey(g, { measure: g.timeline.measures[0].id, fifths: 9 }), 'no-target');
  throwsCode(() => OPS.setClef(g, { measure: g.timeline.measures[0].id, staff: g.parts[0].staves[0].id, sign: 'Z' }), 'no-target');
  throwsCode(() => OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '0' }), 'no-target');
  throwsCode(() => OPS.mergeBars(g, { measure: g.timeline.measures[0].id }), 'no-target');
});
