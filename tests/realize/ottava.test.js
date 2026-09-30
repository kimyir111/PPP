/* TD16 - automatic 8va / 8vb for arranged output (realize/ottava.js `addOttava`).

   Planted fixtures pin the rule (docs/GOALS/G09 section 12, "TD16"): a phrase on 3 or more ledger lines gets 8va, one on a single
   ledger line gets nothing, a low bass gets 8vb, a lone 3-line note gets nothing while a lone 4-line note does, a passage that
   only sits on 2 lines needs four quarter beats, 15ma is used only where 8va would still leave 3 lines, the line covers exactly
   the notes it was made for and ends where they return to range. And what may never change: sounding pitch, onset, duration,
   staff (full note-list comparison plus the G3 critic's fingerprint), deterministic, idempotent. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const L = require(path.join(REPO, 'realize/tools/legacy.js'));
const E = require(path.join(REPO, 'engrave/index.js'));
const OT = require(path.join(REPO, 'realize/ottava.js'));
const C = require(path.join(REPO, 'scoregraph/pro-critic.js'));
const V = require(path.join(REPO, 'scoregraph/validate.js'));

const measures = n => Array.from({ length: n }, (_, i) => ({ number: i + 1, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const TYPE = { 0.25: '16th', 0.5: 'eighth', 1: 'quarter', 2: 'half', 4: 'whole' };
/* a note: staff, measure, beat (quarters), dur (quarters), 'C4', midi */
const N = (staff, m, b, dur, p, midi) => ({ m: m, b: b, dur: dur, type: TYPE[dur], dots: 0, p: p, midi: midi, acc: null, staff: staff, hand: staff === 1 ? 'r' : 'l', voice: staff, rest: false, chord: false });
function graphOf(notes, nMeasures) {
  const proj = L.graphFromLegacyNotes(measures(nMeasures || 2), notes, 100, 'ottava-test');
  assert.ok(proj.ok, JSON.stringify(proj.unsupported || proj).slice(0, 200));
  return proj.graph;
}
/* the note list of a graph: everything a listener or a critic could tell apart */
function noteList(g) {
  const out = [];
  g.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => out.push([e.m, e.at, e.dur, e.staff, e.voice, e.kind, e.grace ? 1 : 0, h.pitch ? h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct : '-', h.id].join('|')))));
  return out.sort();
}
/* the drawn (written) pitch of every head, from the engraver's own plan: sounding name -> written name */
function writtenOf(g) {
  const plan = E.plan(g), out = new Map();
  plan.events.forEach(e => (e.heads || []).forEach(h => { if (h.pitch) out.set(h.pitch.step + h.pitch.oct, h.written.step + h.written.oct); }));
  return out;
}
const spansOf = g => g.parts[0].spanners.filter(s => s.type === 'ottava');
const eighths = (staff, m, start, pitches) => pitches.map((pm, i) => N(staff, m, start + i * 0.5, 0.5, pm[0], pm[1]));
const LH = N(2, 1, 0, 4, 'C3', 48);

test('a phrase on 3 or more ledger lines above the treble staff gets an 8va over exactly its notes', () => {
  /* E6 F6 G6 A6 (3 to 4 lines) as eighths from beat 1 of bar 1, then C5 in range in the same bar */
  const notes = eighths(1, 1, 1, [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93]]).concat([N(1, 1, 3, 1, 'C5', 72), LH]);
  const g = graphOf(notes);
  const r = OT.addOttava(g);
  assert.ok(r.changed && !r.fallback, JSON.stringify(r.report.issues));
  const sp = spansOf(r.graph);
  assert.equal(sp.length, 1);
  assert.equal(sp[0].shift, 1);
  assert.equal(sp[0].staff, g.parts[0].staves[0].id);
  /* starts on the first high note (beat 1 = 1/4 whole) and ends where the last one ends (beat 3 = 3/4), not over C5 */
  assert.equal(sp[0].from.at, '1/4');
  assert.equal(sp[0].to.at, '3/4');
  const w = writtenOf(r.graph);
  ['E6', 'F6', 'G6', 'A6'].forEach(p => assert.equal(w.get(p), p.replace('6', '5'), p + ' is drawn an octave lower'));
  assert.equal(w.get('C5'), 'C5', 'the note after the line is drawn where it sounds');
  assert.equal(w.get('C3'), 'C3', 'the other staff is untouched');
});

test('a phrase on a single ledger line gets nothing (the graph itself comes back)', () => {
  const notes = eighths(1, 1, 0, [['A5', 81], ['B5', 83], ['A5', 81], ['B5', 83], ['A5', 81], ['B5', 83], ['A5', 81], ['B5', 83]]).concat([LH]);
  const g = graphOf(notes);
  const r = OT.addOttava(g);
  assert.equal(r.changed, false);
  assert.equal(r.graph, g);
  assert.equal(r.spans.length, 0);
});

test('a low bass gets an 8vb on the left-hand staff, drawn an octave up', () => {
  const notes = [N(1, 1, 0, 4, 'C5', 72), N(2, 1, 0, 1, 'A1', 33), N(2, 1, 1, 1, 'C2', 36), N(2, 1, 2, 1, 'A1', 33), N(2, 1, 3, 1, 'E2', 40)];
  const g = graphOf(notes);
  const r = OT.addOttava(g);
  assert.ok(r.changed && !r.fallback);
  const sp = spansOf(r.graph);
  assert.equal(sp.length, 1);
  assert.equal(sp[0].shift, -1);
  assert.equal(sp[0].staff, g.parts[0].staves[1].id);
  const w = writtenOf(r.graph);
  assert.equal(w.get('A1'), 'A2');
  assert.equal(w.get('C5'), 'C5');
});

test('a lone 3-line note gets nothing; a lone note that needs 4 lines does', () => {
  const three = graphOf([N(1, 1, 0, 1, 'C5', 72), N(1, 1, 1, 1, 'E6', 88), N(1, 1, 2, 1, 'C5', 72), N(1, 1, 3, 1, 'C5', 72), LH]);
  assert.equal(OT.addOttava(three).changed, false, 'one E6 (3 lines) among notes in range');
  const four = graphOf([N(1, 1, 0, 1, 'C5', 72), N(1, 1, 1, 1, 'G6', 91), N(1, 1, 2, 1, 'C5', 72), N(1, 1, 3, 1, 'C5', 72), LH]);
  const r = OT.addOttava(four);
  assert.ok(r.changed);
  const sp = spansOf(r.graph);
  assert.equal(sp.length, 1);
  assert.equal(sp[0].from.at, '1/4');
  assert.equal(sp[0].to.at, '1/2');
});

test('a passage that only sits on 2 ledger lines needs four quarter beats and two onsets', () => {
  const long = graphOf([N(1, 1, 0, 1, 'C6', 84), N(1, 1, 1, 1, 'D6', 86), N(1, 1, 2, 1, 'C6', 84), N(1, 1, 3, 1, 'D6', 86), LH]);
  const r = OT.addOttava(long);
  assert.ok(r.changed, 'four beats of C6/D6');
  assert.equal(spansOf(r.graph).length, 1);
  const short = graphOf([N(1, 1, 0, 1, 'C6', 84), N(1, 1, 1, 1, 'D6', 86), N(1, 1, 2, 2, 'C5', 72), LH]);
  assert.equal(OT.addOttava(short).changed, false, 'two beats of C6/D6 stay on their ledger lines');
});

test('15ma only where an 8va would still leave 3 ledger lines', () => {
  const g = graphOf(eighths(1, 1, 0, [['E7', 100], ['F7', 101], ['G7', 103], ['A7', 105]]).concat([LH]));
  const r = OT.addOttava(g);
  assert.ok(r.changed && !r.fallback);
  assert.equal(spansOf(r.graph)[0].shift, 2);
  assert.equal(writtenOf(r.graph).get('E7'), 'E5');
  const g8 = graphOf(eighths(1, 1, 0, [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93]]).concat([LH]));
  assert.equal(spansOf(OT.addOttava(g8).graph)[0].shift, 1);
});

test('the line ends where the notes return to range, and a long gap makes two lines', () => {
  const two = graphOf([N(1, 1, 0, 0.5, 'E6', 88), N(1, 1, 0.5, 0.5, 'F6', 89), N(1, 1, 1, 1, 'C5', 72), N(1, 1, 2, 1, 'C5', 72), N(1, 1, 3, 1, 'C5', 72),
    N(1, 2, 0, 0.5, 'G6', 91), N(1, 2, 0.5, 0.5, 'A6', 93), LH], 2);
  const sp = spansOf(OT.addOttava(two).graph);
  assert.equal(sp.length, 2, 'three beats of C5 in between are further than the bridge allows');
  assert.deepEqual(sp.map(s => [s.from.m, s.from.at, s.to.m, s.to.at]), [[sp[0].from.m, '0', sp[0].from.m, '1/4'], [sp[1].from.m, '0', sp[1].from.m, '1/4']]);
  assert.notEqual(sp[0].from.m, sp[1].from.m);
  /* a short gap holding a note that reads well an octave lower is bridged into one line */
  const one = graphOf([N(1, 1, 0, 0.5, 'E6', 88), N(1, 1, 0.5, 0.5, 'F6', 89), N(1, 1, 1, 0.5, 'C6', 84), N(1, 1, 1.5, 0.5, 'G6', 91), N(1, 1, 2, 0.5, 'A6', 93), LH]);
  assert.equal(spansOf(OT.addOttava(one).graph).length, 1);
  /* a note that would land badly an octave lower (A4 -> A3, 3 lines under the treble staff) stops the run instead of being bridged */
  const cut = graphOf([N(1, 1, 0, 0.5, 'E6', 88), N(1, 1, 0.5, 0.5, 'F6', 89), N(1, 1, 1, 0.5, 'A4', 69), N(1, 1, 1.5, 0.5, 'G6', 91), N(1, 1, 2, 0.5, 'A6', 93), LH]);
  const r = OT.addOttava(cut);
  assert.equal(spansOf(r.graph).length, 2);
  assert.equal(writtenOf(r.graph).get('A4'), 'A4', 'the note that ended the run is drawn where it sounds');
});

test('sounding pitch, onset, duration, staff and voice are unchanged: a full note-list comparison and the G3 critic', () => {
  const notes = eighths(1, 1, 0, [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93], ['C5', 72], ['D5', 74], ['E5', 76], ['F5', 77]])
    .concat([N(2, 1, 0, 1, 'A1', 33), N(2, 1, 1, 1, 'C2', 36), N(2, 1, 2, 2, 'A1', 33), N(1, 2, 0, 4, 'C4', 60)]);
  const g = graphOf(notes);
  const r = OT.addOttava(g);
  assert.ok(r.changed && !r.fallback);
  assert.deepEqual(noteList(r.graph), noteList(g));
  /* the critic that gates every G3 pass: nothing but the ottava component differs */
  const before = C.fingerprint(g), after = C.fingerprint(r.graph);
  assert.deepEqual(C.check(before, after, ['ottava']), []);
  assert.ok(C.check(before, after, []).length > 0, 'and the critic does see the ottava (it is not blind)');
  /* no new validator ERROR or overlap warning */
  const codes = V.validate(r.graph).issues.map(i => i.code);
  assert.ok(!codes.includes('W-OTTAVA-OVERLAP') && !codes.some(c => c.startsWith('E-')), codes.join(','));
});

test('deterministic and idempotent: the same graph gives the same result, and a second run adds nothing', () => {
  const g = graphOf(eighths(1, 1, 0, [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93]]).concat([N(2, 1, 0, 1, 'A1', 33), N(2, 1, 1, 1, 'C2', 36), N(2, 1, 2, 2, 'A1', 33)]));
  const a = OT.addOttava(g), b = OT.addOttava(g);
  assert.equal(JSON.stringify(a.graph), JSON.stringify(b.graph));
  assert.deepEqual(a.spans, b.spans);
  assert.equal(spansOf(a.graph).length, 2);
  const again = OT.addOttava(a.graph);
  assert.equal(again.changed, false);
  assert.equal(again.graph, a.graph);
});

test('the thresholds are named constants a caller may override', () => {
  assert.equal(OT.OTTAVA_RULE.seedLines, 3);
  assert.equal(OT.OTTAVA_RULE.highLines, 2);
  const g = graphOf(eighths(1, 1, 0, [['E6', 88], ['F6', 89], ['G6', 91], ['A6', 93]]).concat([LH]));
  assert.equal(OT.addOttava(g, { rule: { seedLines: 9, highLines: 9, loneLines: 9 } }).changed, false);
});
