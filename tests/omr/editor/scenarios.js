'use strict';
/* The scenarios the mutation suite (mutation.test.js) runs against a mutant of omr/edit-ops.js or omr/editor.js: each is one small, named claim about the module,
   written without a line of the module's own code. A scenario returns { ok, why } for the module it is given ({ OPS, ED }); the real modules must say ok to all of them
   and a mutant must say not ok (or throw) to at least the ones its mutation is aimed at. */
const L = require('./lib.js');
const { SG, q, h, w, e8, rq, rh, rw, N } = L;
const R = SG.rational;

const staffs = g => g.parts[0].staves.map(s => s.id);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const res = (ok, why) => ({ ok: !!ok, why: ok ? '' : why });
const valid = (g, label) => { const bad = L.check(g, label); return bad === null ? null : bad; };
const code = (fn) => { try { fn(); return null; } catch (e) { return e && e.code ? e.code : 'threw:' + (e && e.message); } };
const rh0 = (g, bar) => L.notesOf(g, bar).filter(e => e.staff === staffs(g)[0]);
const sumDur = (g, bar, staff) => g.parts[0].events.filter(e => e.m === g.timeline.measures[bar].id && e.staff === staff && !e.grace).reduce((s, e) => R.add(s, R.parse(e.dur)), R.ZERO);

const S = {};
const def = (name, why, run) => { S[name] = { why: why, run: run }; };

def('stepUp', 'a step up moves the letter one place', ({ OPS }) => {
  const g = L.plain(1);
  const ev = rh0(g, 0)[1];
  const r = OPS.step(g, { head: ev.heads[0], by: 1 });
  return res(eq(L.names(rh0(r.graph, 0)), ['C5', 'E5', 'E5', 'F5']) && !valid(r.graph), 'got ' + L.names(rh0(r.graph, 0)));
});
def('stepDown', 'a step down moves the letter one place the other way', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.step(g, { head: rh0(g, 0)[1].heads[0], by: -1 });
  return res(eq(L.names(rh0(r.graph, 0)), ['C5', 'C5', 'E5', 'F5']), 'got ' + L.names(rh0(r.graph, 0)));
});
def('octaveUp', 'an octave is seven letters', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.octave(g, { head: rh0(g, 0)[0].heads[0], by: 1 });
  return res(rh0(r.graph, 0)[0].pitches[0] === 'C6', 'got ' + rh0(r.graph, 0)[0].pitches[0]);
});
def('keyReadsAgain', 'a sharp the key says is not in the graph until the key is set from there; a printed natural stays', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('F5'), q('G5'), q('C5'), q('F5', { acc: 'natural' })], lh: [w('C3')] }]);
  const r = OPS.setKey(g, { measure: g.timeline.measures[0].id, fifths: 2 });
  return res(eq(L.names(rh0(r.graph, 0)), ['F#5', 'G5', 'C#5', 'F5']) && !valid(r.graph), 'got ' + L.names(rh0(r.graph, 0)));
});
def('keyStopsAtNextKey', 'a key stops where the next key signature starts', ({ OPS }) => {
  const g0 = L.graphOf([{ rh: [q('F5'), q('F5'), q('F5'), q('F5')], lh: [w('C3')] }, { rh: [q('F5'), q('F5'), q('F5'), q('F5')], lh: [w('C3')] }]);
  const a = OPS.setKey(g0, { measure: g0.timeline.measures[1].id, fifths: -1 });
  const b = OPS.setKey(a.graph, { measure: g0.timeline.measures[0].id, fifths: 2 });
  return res(L.notesOf(b.graph, 0)[0].pitches[0] === 'F#5' && L.notesOf(b.graph, 1)[0].pitches[0] === 'F5', 'got ' + L.notesOf(b.graph, 0)[0].pitches[0] + ' ' + L.notesOf(b.graph, 1)[0].pitches[0]);
});
def('refusesBrokenGraph', 'an edit is validated: a graph that is not valid is not built on', ({ OPS }) => {
  const g = L.plain(1);
  const bad = JSON.parse(JSON.stringify(g));
  bad.parts[0].events.forEach(e => { if (e.kind === 'rest' || true) e.voice = e.voice; });
  bad.parts[0].events[0].voice = 'v999';
  const c = code(() => OPS.step(bad, { head: bad.parts[0].events.find(e => e.kind === 'note' && e.voice !== 'v999').heads[0].id, by: 1 }));
  return res(c === 'invalid' || c === 'no-target', 'got ' + c);
});
def('clefReadsAgain', 'a clef from a bar means the notes stand where they stand and sound what their place means, in the key', ({ OPS }) => {
  const g = L.graphOf([{ rh: [w('C5')], lh: [q('C3'), q('E3'), q('A3'), q('B3')] }], { fifths: 1 });
  const r = OPS.setClef(g, { measure: g.timeline.measures[0].id, staff: staffs(g)[1], sign: 'G' });
  const lh = L.notesOf(r.graph, 0).filter(e => e.staff === staffs(g)[1]);
  return res(eq(L.names(lh), ['A4', 'C5', 'F#5', 'G5']) && !valid(r.graph), 'got ' + L.names(lh));
});
def('accidentalCarry', 'a printed accidental holds for the rest of the bar on its line: a note that relied on it follows an edit of it', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('F#5', { acc: 'sharp' }), q('F#5'), q('G5'), q('A5')], lh: [w('C3')] }]);
  const r = OPS.accidental(g, { head: rh0(g, 0)[0].heads[0], acc: null });
  return res(eq(L.names(rh0(r.graph, 0)), ['F5', 'F5', 'G5', 'A5']), 'got ' + L.names(rh0(r.graph, 0)));
});
def('accidentalNotOctaves', 'an accidental holds on its own line only: not an octave away, not in the next bar', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('F5'), q('F4'), q('G5'), q('F5')], lh: [w('C3')] }, { rh: [q('F5'), q('F5'), q('G5'), q('F5')], lh: [w('C3')] }]);
  const r = OPS.accidental(g, { head: rh0(g, 0)[0].heads[0], acc: 'sharp' });
  return res(eq(L.names(rh0(r.graph, 0)), ['F#5', 'F4', 'G5', 'F#5']) && eq(L.names(rh0(r.graph, 1)), ['F5', 'F5', 'G5', 'F5']), 'got ' + L.names(rh0(r.graph, 0)) + ' | ' + L.names(rh0(r.graph, 1)));
});
def('aloneInconsistent', 'a note that already sounded other than its notation says is left alone by an edit of its neighbour', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('F5'), q('G5'), q('A5')], lh: [w('C3')] }], { fifths: 1 });
  const r = OPS.step(g, { head: rh0(g, 0)[0].heads[0], by: 1 });
  return res(rh0(r.graph, 0)[1].pitches[0] === 'F5', 'got ' + rh0(r.graph, 0)[1].pitches[0]);
});
def('tieChain', 'a tied note moves with its tie: the end follows the start and the tie stays', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('D5'), q('F5'), q('G5'), q('C5', { tie: 'start' })], lh: [w('C3')] }, { rh: [q('C5', { tie: 'stop' }), h('G5'), q('A5')], lh: [w('C3')] }]);
  const end = rh0(g, 1)[0];
  const r = OPS.step(g, { head: end.heads[0], by: 1 });
  const ties = r.graph.parts[0].spanners.filter(s => s.type === 'tie' && s.from && s.to).length;
  return res(rh0(r.graph, 0)[3].pitches[0] === 'D5' && rh0(r.graph, 1)[0].pitches[0] === 'D5' && ties === 1 && !valid(r.graph), 'got ' + rh0(r.graph, 0)[3].pitches[0] + ' ' + rh0(r.graph, 1)[0].pitches[0] + ' ties ' + ties);
});
def('halveFills', 'half a note leaves a rest and the voice is as full as it was', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.value(g, { event: rh0(g, 0)[0].id, change: 'halve' });
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staffs(g)[0]);
  return res(eq(bar.map(e => e.kind[0] + e.at + ':' + e.dur), ['n0:1/8', 'r1/8:1/8', 'n1/4:1/4', 'n1/2:1/4', 'n3/4:1/4']) && R.format(sumDur(r.graph, 0, staffs(g)[0])) === '1', 'got ' + bar.map(e => e.kind[0] + e.at + ':' + e.dur));
});
def('doubleNeedsRoom', 'a note cannot be made longer into the next note', ({ OPS }) => {
  const g = L.plain(1);
  const c = code(() => OPS.value(g, { event: rh0(g, 0)[0].id, change: 'double' }));
  return res(c === 'no-room', 'got ' + c);
});
def('doubleTakesRest', 'a note made longer takes the rest after it', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), rq(), h('E5')], lh: [w('C3')] }]);
  const r = OPS.value(g, { event: rh0(g, 0)[0].id, change: 'double' });
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staffs(g)[0]);
  return res(eq(bar.map(e => e.kind[0] + e.at + ':' + e.dur), ['n0:1/2', 'n1/2:1/2']), 'got ' + bar.map(e => e.kind[0] + e.at + ':' + e.dur));
});
def('dotted', 'a dot makes a note half as long again, and the printed value says so', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), N('r/half'), q('E5')], lh: [w('C3')] }]);
  const r = OPS.value(g, { event: rh0(g, 0)[0].id, change: 'dot' });
  const e = rh0(r.graph, 0)[0];
  return res(e.dur === '3/8' && eq(e.display, { type: 'quarter', dots: 1 }), 'got ' + e.dur + ' ' + JSON.stringify(e.display));
});
def('shortest', 'nothing is shorter than a 64th', ({ OPS }) => {
  let g = L.graphOf([{ rh: [w('C5')], lh: [w('C3')] }]);
  const id = rh0(g, 0)[0].id;
  for (let i = 0; i < 6; i++) g = OPS.value(g, { event: id, change: 'halve' }).graph;
  const c = code(() => OPS.value(g, { event: id, change: 'halve' }));
  return res(c === 'too-short', 'got ' + c);
});
def('tupletRefused', 'a note of a tuplet is not rewritten', ({ OPS }) => {
  const raw = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>12</divisions>'
    + '<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
    + ['C', 'D', 'E'].map((s, i) => '<note><pitch><step>' + s + '</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>'
      + '<notations>' + (i === 0 ? '<tuplet type="start" number="1"/>' : i === 2 ? '<tuplet type="stop" number="1"/>' : '') + '</notations></note>').join('')
    + '<note><rest/><duration>36</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><backup><duration>48</duration></backup>'
    + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>48</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure></part></score-partwise>';
  const r = SG.musicxml.import(raw, { scoreId: 't', sourceName: 't.xml' });
  if (!r.ok) return res(false, 'fixture ' + r.message);
  const tup = r.graph.parts[0].spanners.find(s => s.type === 'tuplet');
  const c = code(() => OPS.value(r.graph, { event: tup.events[1], change: 'halve' }));
  const c2 = code(() => OPS.toRest(r.graph, { event: tup.events[1] }));
  return res(c === 'in-tuplet' && c2 === 'in-tuplet', 'got ' + c + ' ' + c2);
});
def('toRestKeepsTime', 'a note made a rest lasts as long as it did', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.toRest(g, { event: rh0(g, 0)[1].id });
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staffs(g)[0]);
  return res(eq(bar.map(e => e.kind[0] + e.at + ':' + e.dur), ['n0:1/4', 'r1/4:1/4', 'n1/2:1/4', 'n3/4:1/4']), 'got ' + bar.map(e => e.kind[0] + e.at + ':' + e.dur));
});
def('toNoteTakesNeighbour', 'a rest made a note takes the pitch of the note before it on the staff', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('A5'), rq(), q('C5'), q('D5')], lh: [w('C3')] }]);
  const rest = L.barOf(g, 0).find(e => e.kind === 'rest' && e.staff === staffs(g)[0]);
  const r = OPS.toNote(g, { event: rest.id });
  return res(rh0(r.graph, 0)[1].pitches[0] === 'A5', 'got ' + rh0(r.graph, 0)[1].pitches[0]);
});
def('removeHead', 'one head of a chord goes and the others stay', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('E5', { chord: true }), q('G5', { chord: true }), h('D5'), q('F5')], lh: [w('C3')] }]);
  const ch = rh0(g, 0)[0];
  const r = OPS.remove(g, { event: ch.id, head: ch.heads[1] });
  return res(eq(rh0(r.graph, 0)[0].pitches, ['C5', 'G5']), 'got ' + rh0(r.graph, 0)[0].pitches);
});
def('addInRest', 'a note put in a rest takes its place and the rest is what is left', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), N('r/half')], lh: [w('C3')] }]);
  const r = OPS.add(g, { measure: g.timeline.measures[0].id, staff: staffs(g)[0], at: '1/2', pitch: { step: 'G', oct: 5 }, value: 'quarter' });
  const bar = L.barOf(r.graph, 0).filter(e => e.staff === staffs(g)[0]);
  return res(eq(bar.map(e => e.kind[0] + e.at + ':' + e.dur + ':' + e.pitches.join('')), ['n0:1/4:C5', 'n1/4:1/4:D5', 'n1/2:1/4:G5', 'r3/4:1/4:']), 'got ' + bar.map(e => e.kind[0] + e.at + ':' + e.dur));
});
def('addOccupied', 'a note is not put on a note of the same pitch', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), N('r/half')], lh: [w('C3')] }]);
  const c = code(() => OPS.add(g, { measure: g.timeline.measures[0].id, staff: staffs(g)[0], at: '0', pitch: { step: 'C', oct: 5 }, value: 'quarter' }));
  return res(c === 'occupied', 'got ' + c);
});
def('addUsesKey', 'a new note sounds what the key says', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), rq(), N('r/half')], lh: [w('C3')] }], { fifths: 2 });
  const r = OPS.add(g, { measure: g.timeline.measures[0].id, staff: staffs(g)[0], at: '1/4', pitch: { step: 'F', oct: 5 }, value: 'quarter' });
  return res(L.notesOf(r.graph, 0).find(e => e.at === '1/4' && e.staff === staffs(g)[0]).pitches[0] === 'F#5', 'got ' + L.notesOf(r.graph, 0).find(e => e.at === '1/4' && e.staff === staffs(g)[0]).pitches[0]);
});
def('otherStaff', 'a note on the other staff leaves a rest, and both voices are full', ({ OPS }) => {
  const g = L.plain(1);
  const ev = rh0(g, 0)[0];
  const r = OPS.moveStaff(g, { event: ev.id });
  const moved = L.notesOf(r.graph, 0).find(e => e.id === ev.id);
  const full = R.format(sumDur(r.graph, 0, staffs(g)[0])) === '1';
  return res(moved.staff === staffs(g)[1] && full && !valid(r.graph), 'got ' + moved.staff + ' full ' + full);
});
def('timeCuts', 'a time signature that would cut a note is refused', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), rq()], lh: [w('C3')] }]);
  const c = code(() => OPS.setTime(g, { measure: g.timeline.measures[0].id, beats: 3, beatType: 4 }));
  return res(c === 'would-cut', 'got ' + c);
});
def('timeBars', 'a time signature makes the bars as long as it says and the voices are full', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), rq()], lh: [h('C3'), rh()] }]);
  const r = OPS.setTime(g, { measure: g.timeline.measures[0].id, beats: 6, beatType: 4 });
  return res(r.graph.timeline.measures[0].dur === '3/2' && R.format(sumDur(r.graph, 0, staffs(g)[0])) === '3/2' && !valid(r.graph), 'got ' + r.graph.timeline.measures[0].dur);
});
def('insertBarRests', 'an inserted bar has a rest of the whole bar in each staff, and the bars are numbered', ({ OPS }) => {
  const g = L.plain(3);
  const r = OPS.insertBar(g, { after: g.timeline.measures[0].id });
  const evs = L.barOf(r.graph, 1);
  return res(r.graph.timeline.measures.map(x => x.number).join() === '1,2,3,4' && evs.length === 2 && evs.every(e => e.kind === 'rest' && e.dur === '1' && e.display.measureRest) && !valid(r.graph), 'got ' + r.graph.timeline.measures.map(x => x.number).join() + ' ' + evs.length);
});
def('insertBeforeFirst', 'a bar before the first takes the start of the score: time signature, key and clefs', ({ OPS }) => {
  const g = L.plain(2);
  const r = OPS.insertBar(g, { before: g.timeline.measures[0].id });
  const first = r.graph.timeline.measures[0].id;
  return res(r.graph.timeline.meters[0].m === first && r.graph.timeline.keys[0].m === first && r.graph.parts[0].clefs.every(c => c.m === first) && !valid(r.graph), 'the start of the score did not move');
});
def('insertEndsTies', 'a bar put between two tied notes ends the tie', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F5', { tie: 'start' })], lh: [w('C3')] }, { rh: [q('F5', { tie: 'stop' }), q('G5'), h('A5')], lh: [w('C3')] }]);
  const r = OPS.insertBar(g, { after: g.timeline.measures[0].id });
  return res(r.graph.parts[0].spanners.filter(s => s.type === 'tie').length === 0 && !valid(r.graph), 'a tie is left');
});
def('deleteBar', 'a bar goes with its notes and the rest are renumbered', ({ OPS }) => {
  const g = L.plain(3);
  const r = OPS.removeBar(g, { measure: g.timeline.measures[1].id });
  return res(r.graph.timeline.measures.length === 2 && r.graph.timeline.measures.map(x => x.number).join() === '1,2' && r.graph.parts[0].events.every(e => e.m !== g.timeline.measures[1].id) && !valid(r.graph), 'got ' + r.graph.timeline.measures.map(x => x.number).join());
});
def('deleteFirstBar', 'the first bar takes the time signature, the key and the clefs with it to the next', ({ OPS }) => {
  const g = L.plain(3);
  const r = OPS.removeBar(g, { measure: g.timeline.measures[0].id });
  const second = g.timeline.measures[1].id;
  return res(r.graph.timeline.meters[0].m === second && r.graph.timeline.keys[0].m === second && r.graph.parts[0].clefs.length === 2 && r.graph.timeline.measures[0].number === '1' && !valid(r.graph), 'the start did not move');
});
def('deleteOnlyBar', 'the only bar stays', ({ OPS }) => {
  const g = L.plain(1);
  const c = code(() => OPS.removeBar(g, { measure: g.timeline.measures[0].id }));
  return res(c === 'last-bar', 'got ' + c);
});
def('splitCutsNote', 'a bar split across a note makes two tied notes', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '1/2' });
  const lh0 = L.notesOf(r.graph, 0).filter(e => e.staff === staffs(g)[1]), lh1 = L.notesOf(r.graph, 1).filter(e => e.staff === staffs(g)[1]);
  const ties = r.graph.parts[0].spanners.filter(s => s.type === 'tie' && s.from && s.to).length;
  return res(r.graph.timeline.measures.map(x => x.dur).join() === '1/2,1/2' && lh0.length === 1 && lh0[0].dur === '1/2' && lh1.length === 1 && lh1[0].dur === '1/2' && ties === 1 && !valid(r.graph), 'got ' + r.graph.timeline.measures.map(x => x.dur).join() + ' ties ' + ties);
});
def('splitMovesLate', 'what starts after the place stands in the new bar from its start', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '1/2' });
  const b = L.notesOf(r.graph, 1).filter(e => e.staff === staffs(g)[0]);
  return res(eq(b.map(e => e.at + e.pitches[0]), ['0E5', '1/4F5']), 'got ' + b.map(e => e.at + e.pitches[0]));
});
def('mergeShifts', 'two bars joined: the second bar\'s notes stand after the first\'s', ({ OPS }) => {
  const g = L.plain(2);
  const r = OPS.mergeBars(g, { measure: g.timeline.measures[0].id });
  const b = rh0(r.graph, 0);
  return res(r.graph.timeline.measures.length === 1 && r.graph.timeline.measures[0].dur === '2' && b.length === 8 && b[4].at === '1' && !valid(r.graph), 'got ' + b.map(e => e.at).join());
});
def('mergeMeters', 'two bars with different time signatures are not joined', ({ OPS }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), N('r/quarter')], lh: [h('C3'), N('r/quarter')] }, { rh: [q('C5'), N('r/half')], lh: [rh(), N('r/quarter')] }], { beats: 3, beatType: 4 });
  const sw = OPS.setTime(g, { measure: g.timeline.measures[1].id, beats: 2, beatType: 4 });
  const c = code(() => OPS.mergeBars(sw.graph, { measure: g.timeline.measures[0].id }));
  return res(c === 'meter-differs', 'got ' + c);
});
def('mergeParts', 'two staves of two parts become one piano part', ({ OPS }) => {
  const mk = (id, clef, oct) => '<part id="' + id + '"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>' + clef[0] + '</sign><line>' + clef[1] + '</line></clef></attributes>'
    + ['C', 'D', 'E', 'F'].map(s => '<note><pitch><step>' + s + '</step><octave>' + oct + '</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>').join('') + '</measure></part>';
  const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>R</part-name></score-part><score-part id="P2"><part-name>L</part-name></score-part></part-list>'
    + mk('P1', ['G', 2], 5) + mk('P2', ['F', 4], 3) + '</score-partwise>';
  const r0 = SG.musicxml.import(xml, { scoreId: 'two', sourceName: 'two.xml' });
  if (!r0.ok) return res(false, 'fixture');
  const g = r0.graph;
  const r = OPS.mergeParts(g, { keep: g.parts[0].id, into: g.parts[1].id });
  const sc = SG.legacy.toScore(r.graph, { name: 'x' });
  return res(r.graph.parts.length === 1 && r.graph.parts[0].staves.length === 2 && eq(Array.from(new Set(sc.notes.map(n => n.hand))).sort(), ['l', 'r']) && !valid(r.graph), 'got ' + r.graph.parts.length);
});
def('provenance', 'what an edit changes says edited', ({ OPS }) => {
  const g = L.plain(1);
  const ev = rh0(g, 0)[0];
  const r = OPS.step(g, { head: ev.heads[0], by: 1 });
  const e = r.graph.parts[0].events.find(x => x.id === ev.id);
  const p = e.heads[0].prov;
  const src = p && p.asp && p.asp.pitch ? r.graph.provenance.sources.find(s => s.id === p.asp.pitch.src) : null;
  return res(p && p.asp && p.asp.pitch && p.asp.pitch.op === 'edited' && src && src.kind === 'user' && OPS.editedBars(r.graph).has(r.graph.timeline.measures[0].id) && !OPS.editedBars(g).size, 'no edited mark');
});
def('reviewedCleared', 'an edit of a bar takes the reviewed mark off it; an edit of another bar does not', ({ OPS }) => {
  const g = L.plain(2);
  const a = OPS.markReviewed(g, { measure: g.timeline.measures[0].id });
  const b = OPS.step(a.graph, { head: L.notesOf(a.graph, 1)[0].heads[0], by: 1 });
  const c = OPS.step(a.graph, { head: L.notesOf(a.graph, 0)[0].heads[0], by: 1 });
  return res(OPS.reviewedBars(a.graph).has(g.timeline.measures[0].id) && OPS.reviewedBars(b.graph).has(g.timeline.measures[0].id) && !OPS.reviewedBars(c.graph).has(g.timeline.measures[0].id), 'the reviewed mark');
});
def('validatorRefuses', 'a result the validator refuses is not made', ({ OPS }) => {
  /* two voices on one staff: the second voice's rest and a note put over the first voice's note by moving the event */
  const g = L.plain(1);
  const ev = rh0(g, 0)[0];
  /* a staff move into a voice that is occupied has to find another voice or fail, never overlap */
  const r = OPS.moveStaff(g, { event: ev.id });
  return res(!valid(r.graph), 'invalid graph returned');
});
def('inputUntouched', 'the graph an op is given is not changed', ({ OPS }) => {
  const g = L.plain(2);
  const text = SG.serialize(g);
  OPS.step(g, { head: rh0(g, 0)[0].heads[0], by: 1 });
  OPS.splitBar(g, { measure: g.timeline.measures[0].id, at: '1/2' });
  OPS.removeBar(g, { measure: g.timeline.measures[0].id });
  return res(SG.serialize(g) === text && Object.isFrozen(g), 'changed');
});
def('noChangeIsSameGraph', 'an edit that changes nothing returns the graph it was given', ({ OPS }) => {
  const g = L.plain(1);
  const r = OPS.setTime(g, { measure: g.timeline.measures[0].id, beats: 4, beatType: 4 });
  const k = OPS.setKey(g, { measure: g.timeline.measures[0].id, fifths: 0 });
  return res(r.changed === false && r.graph === g && k.changed === false && k.graph === g, 'a new graph');
});

/* --------------------------------------------------------------------------------- the session (omr/editor.js) */
def('sessionUndo', 'an undo gives back the graph that was there, byte for byte, and a redo the one after', ({ ED }) => {
  const g = L.plain(2);
  const s = ED.create(g);
  const text = SG.serialize(g);
  const a = s.apply({ op: 'step', head: rh0(g, 0)[0].heads[0], by: 1 });
  const mid = s.graph;
  const b = s.apply({ op: 'split', measure: g.timeline.measures[1].id, at: '1/2' });
  const top = s.graph;
  s.undo();
  const one = s.graph === mid && s.canUndo && s.canRedo;
  s.undo();
  const back = s.graph === g && SG.serialize(s.graph) === text && !s.canUndo && s.canRedo;
  s.redo(); s.redo();
  return res(a.ok && b.ok && one && back && s.graph === top && !s.canRedo, 'undo/redo');
});
def('sessionRedoDies', 'a new edit after an undo ends what was to be redone', ({ ED }) => {
  const g = L.plain(2);
  const s = ED.create(g);
  s.apply({ op: 'step', head: rh0(g, 0)[0].heads[0], by: 1 });
  s.undo();
  s.apply({ op: 'step', head: rh0(g, 0)[1].heads[0], by: 1 });
  return res(!s.canRedo && s.steps.undo === 1, 'redo is still there');
});
def('sessionRefusalNoStep', 'a refused edit makes no step and leaves the graph', ({ ED }) => {
  const g = L.plain(1);
  const s = ED.create(g);
  const r = s.apply({ op: 'value', event: rh0(g, 0)[0].id, change: 'double' });
  return res(!r.ok && r.code === 'no-room' && s.graph === g && s.steps.undo === 0, 'a step was made');
});
def('sessionLimit', 'the stack keeps a limited number of steps and the oldest goes', ({ ED }) => {
  const g = L.plain(1);
  const s = ED.create(g, { limit: 3 });
  const head = rh0(g, 0)[0].heads[0];
  for (let i = 0; i < 6; i++) s.apply({ op: 'step', head: head, by: i % 2 ? -1 : 1 });
  return res(s.steps.undo === 3, 'steps ' + s.steps.undo);
});
def('sessionDiscard', 'discard goes back to the beginning of the visit in one step that can be undone', ({ ED }) => {
  const g = L.plain(1);
  const s = ED.create(g);
  s.apply({ op: 'step', head: rh0(g, 0)[0].heads[0], by: 1 });
  const edited = s.graph;
  const d = s.discard();
  const was = s.graph === g;
  s.undo();
  return res(d.ok && was && s.graph === edited, 'discard');
});
def('sessionFill', 'the fill of a bar says what each staff holds', ({ ED }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5')], lh: [w('C3')] }]);
  const f = ED.fill(g, g.timeline.measures[0].id);
  return res(f.length === 2 && f[0].ok === false && f[0].have === '3/4' && f[1].ok === true, 'got ' + JSON.stringify(f));
});
def('sessionFlagsByBarId', 'what the import said about a bar follows the bar when bars are put in before it', ({ ED }) => {
  const FL = require('../../../omr/flags.js');
  const g = L.plain(3);
  const s = ED.create(g, { normalize: { flags: { 2: ['pair-merged', 'parts-fragmented'] } } });
  const before = s.check(FL).bars[1].strong;
  s.apply({ op: 'insert', before: g.timeline.measures[0].id });
  const after = s.check(FL).bars;
  return res(before.indexOf('fragmented') >= 0 && after[2].strong.indexOf('fragmented') >= 0 && after[1].strong.indexOf('fragmented') < 0, 'got ' + JSON.stringify(after.map(b => b.strong)));
});
def('sessionReportReviewed', 'a bar marked right is not counted, and the report is made for the graph now', ({ ED }) => {
  const FL = require('../../../omr/flags.js');
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5')], lh: [w('C3')] }, { rh: [q('C5'), q('D5'), q('E5'), q('F5')], lh: [w('C3')] }]);
  const s = ED.create(g);
  const sc0 = SG.legacy.toScore(g, { name: 'x' });
  const r0 = s.report(sc0, { FL: FL, old: {}, validate: () => ({ confidence: 1, level: 'good', issues: [], suspectMeasures: [] }) });
  s.apply({ op: 'reviewed', measure: g.timeline.measures[0].id });
  const sc1 = SG.legacy.toScore(s.graph, { name: 'x' });
  const r1 = s.report(sc1, { FL: FL, old: {}, validate: () => ({ confidence: 1, level: 'good', issues: [], suspectMeasures: [1] }) });
  return res(r0.suspectMeasures.indexOf(1) >= 0 && r1.suspectMeasures.indexOf(1) < 0 && !r1.flagCodes && r0.confidence < 0.85 && r1.confidence > r0.confidence, 'got ' + JSON.stringify(r0.suspectMeasures) + ' ' + JSON.stringify(r1.suspectMeasures));
});
def('sessionWindow', 'a bar can be drawn alone: a valid graph with the clef, key and time signature in force there', ({ ED }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('D5'), q('E5'), q('F5', { tie: 'start' })], lh: [w('C3')] }, { rh: [q('F5', { tie: 'stop' }), q('G5'), h('A5')], lh: [w('C3')] }], { fifths: 2 });
  const win = ED.windowGraph(g, g.timeline.measures[1].id);
  if (!win) return res(false, 'no window');
  return res(SG.validate(win).ok && win.timeline.measures.length === 1 && win.timeline.meters.length === 1 && win.timeline.keys.length === 1 && win.timeline.keys[0].fifths === 2
    && win.parts[0].clefs.length === 2 && win.parts[0].events.every(e => e.m === g.timeline.measures[1].id) && win.parts[0].events.length === 4, 'window');
});
def('sessionDescribe', 'what the toolbar needs: the heads, and what an edit of this note can do', ({ ED }) => {
  const g = L.graphOf([{ rh: [q('C5'), q('E5', { chord: true }), q('D5'), h('F5')], lh: [w('C3')] }]);
  const ch = rh0(g, 0)[0];
  const d = ED.describe(g, ch.id);
  return res(d && d.heads.length === 2 && d.heads[0].name === 'C5' && d.canValue.halve === true && d.canValue.double === false && d.staffCount === 2, 'got ' + JSON.stringify(d && d.canValue));
});

module.exports = { S };
