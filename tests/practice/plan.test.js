/* G11a-1: practice/plan.js, the PlaybackPlan made from a ScoreGraph (docs/GOALS/G11 §6.1). One test group per row of the §6.1 table:
   the play order, the jumps, struck or tied, the hold, the pedal, the velocity, the tempo, the pitch, the grace notes and the beats,
   then the follow gates (§6.1 followGates), the ids, the options, the cache and the budget (§10: 1,800 notes in 10 ms).

   The expected values are written out by hand from the fixtures (tests/practice/fixtures, each with the bar-by-bar story in its first
   comment) and from the rule the row states. Whether the plan IS the old player's, to the last bit, is parity.test.js; whether the suite
   would notice a plan that got worse is mutation.test.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const T = require('../timing.js');

const { SG, PLAN, fixtureGraph, fixtureText, graphOfText, order, numbers } = H;
const sgFixture = name => H.graphOfText(require('fs').readFileSync(require('path').join(H.REPO, 'tests', 'scoregraph', 'fixtures', 'xml', name + '.musicxml'), 'utf8'), name);
const eFixture = name => H.graphOfText(require('fs').readFileSync(require('path').join(H.REPO, 'tests', 'engrave', 'fixtures', 'e', name + '.musicxml'), 'utf8'), name);
const strikes = (plan, f) => plan.strikes.filter(f || (() => true)).map(s => [s.q, s.upQ, s.midi, s.vel]);
const R = x => H.round(x, 6);

/* every MusicXML fixture of the repository that a practice view could be opened on */
const ALL_FIXTURES = () => []
  .concat(H.filesIn('tests/scoregraph/fixtures/xml', /\.musicxml$/))
  .concat(H.filesIn('tests/engrave/fixtures/e', /\.musicxml$/))
  .concat(H.filesIn('tests/practice/fixtures', /\.musicxml$/));

/* ====================================================================== the play order */
test('ROW play order: the whole piece is time.unroll (graph rule) on every fixture, and the old player\'s order (compat) too', async () => {
  let checked = 0;
  for (const rel of ALL_FIXTURES()) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    const unrolled = SG.time.unroll(g);
    for (const compat of [true, false]) {
      const plan = PLAN.build(g, { legacyCompat: compat });
      assert.deepEqual(plan.visits.map(v => [v.id, v.pass]), unrolled.map(v => [v.m, v.pass]), rel + (compat ? ' (compat)' : ' (graph)'));
      plan.visits.forEach((v, i) => assert.equal(v.soundQ, SG.rational.toNumber(SG.rational.mul(unrolled[i].start, SG.rational.make(4))), rel + ' soundQ ' + i));
    }
    checked++;
  }
  assert.ok(checked >= 80, checked + ' fixtures opened');
});

test('ROW play order: repeats, voltas, repeat counts and the loop-start target, written out for the repeat fixtures', () => {
  const O = (name, range) => order(PLAN.build(sgFixture(name), range ? { range: { from: range[0], to: range[1] } } : {}));
  assert.equal(O('repeats-simple'), '1 2 1^2 2^2 3^2');
  assert.equal(O('repeats-endings-1-2'), '1 2 3 1^2 2^2 4^2 5^2', 'the first ending once, the second the next time');
  assert.equal(O('repeats-endings-12-3'), '1 2 3 1^2 2^2 3^2 1^3 2^3 4^3 5^3', 'endings 1 and 2 share a bar; a repeat of three times');
  assert.equal(O('repeats-nested'), '1 2 3 2^2 3^2 4^2 2^3 3^3 2^4 3^4 4^4 5^4', 'the inner repeat starts over each time the outer one comes round');
  assert.equal(O('repeats-times-3'), '1 2 1^2 2^2 1^3 2^3 3^3');
  assert.equal(O('repeats-backward-only'), '1 2 1^2 2^2 3^2', 'a backward repeat with no forward one goes back to the first bar');
  assert.equal(O('ending-stop-without-start'), '1 2 3', 'an ending that stops but never started opens nothing');
  /* a loop inside the piece (the practice screen's "Loop a passage"): the range is the whole world */
  assert.equal(O('repeats-simple', [1, 2]), '2 2^2 3^2', 'KEPT QUIRK (E4 a): a backward repeat with no forward repeat inside the loop goes back to the loop start');
  assert.equal(O('repeats-endings-1-2', [2, 4]), '3 4^2 5^2', 'a loop that starts inside the first ending');
  assert.equal(O('repeats-endings-1-2', [0, 3]), '1 2 3 1^2 2^2 4^2', 'a loop that ends on the second ending');
  assert.equal(O('repeats-endings-12-3', [2, 4]), '3 3^2 4^3 5^3');
  assert.equal(O('pickup-3-4', [1, 3]), '1 2 3');
});

test('ROW play order: a range by measure id is the range by index; one that starts after it ends plays nothing; a measure that is not there is refused', () => {
  const g = sgFixture('repeats-endings-1-2');
  const ids = g.timeline.measures.map(m => m.id);
  const byIndex = PLAN.build(g, { range: { from: 1, to: 3 } }), byId = PLAN.build(g, { range: { from: ids[1], to: ids[3] } });
  assert.equal(order(byId), order(byIndex));
  assert.deepEqual(byId.range, { from: ids[1], to: ids[3], i0: 1, i1: 3 });
  const reversed = PLAN.build(g, { range: { from: 3, to: 1 } });
  assert.deepEqual([reversed.visits.length, reversed.strikes.length, reversed.soundLengthQ], [0, 0, 0], 'the old player plays nothing for an empty range');
  assert.deepEqual(reversed.tempoMap, [{ q: 0, bpm: 84 }]);
  assert.deepEqual(PLAN.followGates(reversed, 'both'), []);
  assert.throws(() => PLAN.build(g, { range: { from: 'm999' } }), e => e.code === 'E-RANGE');
  assert.throws(() => PLAN.build(g, { range: { to: 5 } }), e => e.code === 'E-RANGE');
  assert.throws(() => PLAN.build(g, { range: { from: 1.5 } }), e => e.code === 'E-RANGE');
});

test('ROW play order: a huge repeat count ends at the old player\'s guard (8,000 visits), it does not hang', () => {
  /* the importer refuses such a score (E-UNROLL-RUNAWAY); a graph made some other way is still played, and ends */
  const g = JSON.parse(JSON.stringify(fixtureGraph('jump-dc-repeats')));
  g.timeline.measures[1].barline.right.times = 99999;
  assert.equal(PLAN.build(g).visits.length, 8000);
  assert.equal(PLAN.build(g, { jumps: 'once' }).visits.length, 8000);
});

/* ====================================================================== jumps */
test('ROW jumps: off unless asked - the order is the repeats\' and nothing is logged, whatever signs the file holds', () => {
  assert.equal(numbers(PLAN.build(fixtureGraph('jump-ds-al-coda'))), '1 2 3 4 5 6');
  assert.equal(numbers(PLAN.build(fixtureGraph('jump-dc-al-fine-volta'))), '1 2 3 1 2 4 5 6');
  assert.equal(numbers(PLAN.build(fixtureGraph('jump-dc-al-fine-volta'), { jumps: false })), '1 2 3 1 2 4 5 6');
  assert.deepEqual(PLAN.build(fixtureGraph('jump-ds-al-fine')).jumps, []);
});

test('ROW jumps: D.S. al Coda - back to the segno, on the way back To Coda turns to the coda', () => {
  const plan = PLAN.build(fixtureGraph('jump-ds-al-coda'), { jumps: 'once' });
  assert.equal(order(plan), "1 2 3 4 2' 3' 5' 6'");
  assert.deepEqual(plan.jumps, [{ kind: 'dalsegno', from: 3, to: 1 }, { kind: 'tocoda', from: 5, to: 4 }], 'the first To Coda (bar 3) was passed by, the second turned');
  assert.deepEqual(plan.visits.map(v => v.leg), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(plan.soundLengthQ, 32, 'eight bars of four quarters');
});

test('ROW jumps: D.S. al Fine, and the sign is read at the END of its bar (a Fine written at the start of a bar plays the whole bar)', () => {
  assert.equal(order(PLAN.build(fixtureGraph('jump-ds-al-fine'), { jumps: 'once' })), "1 2 3 4 2' 3'");
  const volta = PLAN.build(fixtureGraph('jump-dc-al-fine-volta'), { jumps: 'once' });
  const g = fixtureGraph('jump-dc-al-fine-volta');
  assert.equal(g.timeline.jumps.find(j => j.kind === 'fine').at, '0', 'the Fine is at the start of bar 4');
  assert.equal(volta.visits[volta.visits.length - 1].number, 4);
  assert.equal(volta.visits[volta.visits.length - 1].lenQ, 4, 'and bar 4 is played whole');
});

test('ROW jumps: D.C. al Fine over a repeat with endings - the repeat is not taken on the way back, the last ending is played, the Fine ends it', () => {
  const plan = PLAN.build(fixtureGraph('jump-dc-al-fine-volta'), { jumps: 'once' });
  assert.equal(order(plan), "1 2 3 1^2 2^2 4^2 5^2 6^2 1' 2' 4'");
  assert.deepEqual(plan.visits.filter(v => v.leg).map(v => v.pass), [2, 2, 2], 'on the way back the volta is read as the last time');
  assert.deepEqual(plan.jumps, [{ kind: 'dacapo', from: 7, to: 0 }], 'a Fine on the way there (bar 4) is passed by');
});

test('ROW jumps: a D.C. over a plain repeat - once through, no repeat on the way back, no Fine: to the end', () => {
  assert.equal(order(PLAN.build(fixtureGraph('jump-dc-repeats'), { jumps: 'once' })), "1 2 1^2 2^2 3^2 1' 2' 3'");
});

test('ROW jumps: a sign that cannot be resolved (a D.S. with no segno, a To Coda with no coda, a Fine with no D.C.) is ignored - never a loop', () => {
  const plan = PLAN.build(fixtureGraph('jump-unresolved'), { jumps: 'once' });
  assert.equal(numbers(plan), '1 2 3 4');
  assert.deepEqual(plan.jumps, []);
});

test('ROW jumps: in a loop range the signs outside it are not reached; a D.C. goes back to the start of the loop', () => {
  const g = fixtureGraph('jump-ds-al-fine');                           /* bars: 1, 2 segno, 3 Fine, 4 D.S. */
  const O = (a, b) => order(PLAN.build(g, { jumps: 'once', range: { from: a, to: b } }));
  assert.equal(O(0, 3), "1 2 3 4 2' 3'");
  assert.equal(O(1, 3), "2 3 4 2' 3'");
  assert.equal(O(2, 3), '3 4', 'the segno is outside the loop: the D.S. cannot be followed');
  assert.equal(O(0, 2), '1 2 3', 'the D.S. is outside the loop');
  const dc = fixtureGraph('jump-dc-al-fine-volta');
  const D = (a, b) => order(PLAN.build(dc, { jumps: 'once', range: { from: a, to: b } }));
  assert.equal(D(4, 5), "5 6 5' 6'", 'a D.C. goes back to the start of the loop, not of the piece');
  assert.equal(D(0, 4), '1 2 3 1^2 2^2 4^2 5^2', 'the D.C. is outside the loop');
  assert.equal(D(2, 5), "3 4^2 5^2 6^2 4'");
});

test('ROW jumps: E22 (repeat with endings, segno, To Coda, D.S. al Coda, coda) read as an engraver reads it', () => {
  const plan = PLAN.build(eFixture('E22-repeats-jumps'), { jumps: 'once' });
  assert.equal(order(plan), "1 2 1^2 3^2 4^2 5^2 1' 3' 4' 6'");
  assert.deepEqual(plan.jumps, [{ kind: 'dalsegno', from: 5, to: 0 }, { kind: 'tocoda', from: 8, to: 5 }]);
});

test('ROW jumps: no fixture loops, and the first leg is the old order up to the sign that turned it', async () => {
  let turned = 0;
  for (const rel of ALL_FIXTURES()) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    const off = PLAN.build(g), on = PLAN.build(g, { jumps: 'once' });
    assert.ok(on.visits.length < 8000, rel);
    const first = on.visits.filter(v => !v.leg);
    assert.deepEqual(first.map(v => v.index), off.visits.slice(0, first.length).map(v => v.index), rel + ': the first leg');
    if (on.visits.some(v => v.leg)) turned++;
    else assert.deepEqual(on.visits.map(v => v.index), off.visits.map(v => v.index), rel + ': with no sign turned the order is the old one');
  }
  assert.equal(turned, 5, 'the four jump fixtures that resolve, and E22');
});

test('ROW jumps: the options are checked (a typo is an error, not a silent no)', () => {
  const g = fixtureGraph('jump-ds-al-fine');
  assert.throws(() => PLAN.build(g, { jumps: true }), e => e.code === 'E-OPTION');
  assert.throws(() => PLAN.build(g, { jumps: 'twice' }), e => e.code === 'E-OPTION');
  assert.throws(() => PLAN.build(g, { graces: 'yes' }), e => e.code === 'E-OPTION');
  assert.throws(() => PLAN.build(g, { defaultQpm: 0 }), e => e.code === 'E-OPTION');
  assert.throws(() => PLAN.build(g, { defaultQpm: 'fast' }), e => e.code === 'E-OPTION');
});

/* ====================================================================== struck or tied */
test('ROW struck or tied: a tie carries the note into the next - struck once, held for the chain; a tie that leads nowhere strikes', () => {
  const g = fixtureGraph('ties-edge');
  const plan = PLAN.build(g);
  assert.equal(numbers(plan), '1 2 1 3 4 5');
  /* the quarter values: G4 and C5 are halves of 2; the second visit of bar 1 starts at sounding quarter 8 */
  const pitch = m => strikes(plan, s => s.midi === m);
  assert.deepEqual(pitch(72).map(x => x.slice(0, 2)), [[2, 6], [10, 14], [12, 14], [16, 18]],
    'C5: the chain of bars 1-2 is struck at 2 and held to 6 (2+2); again on the next visit; the bar-3 C5 (nothing leads into it) is struck; the dangling start of bar 4 sounds its own length');
  assert.equal(plan.strikes.filter(s => s.m === 2 && s.midi === 72).length, 0, 'the C5 of bar 2 is carried into, not struck');
  assert.deepEqual(plan.strikes.filter(s => s.m === 5 && s.midi === 76).map(s => s.q), [20], 'an E5 that stops a tie nothing started is struck');
  assert.equal(plan.cont.size, 1, 'the only note a tie really carries into');
  assert.deepEqual([...plan.hold.values()].sort(), [2, 4], 'a chain of two halves is 4, a start that goes nowhere is its own 2');
});

test('ROW struck or tied: the graph rule follows the tie spanner from head to head - the unison that the old player struck twice', () => {
  const g = fixtureGraph('ties-unison');
  const heads = [];
  g.parts[0].events.forEach(e => (e.heads || []).forEach(h => heads.push([e, h])));
  const ties = g.parts[0].spanners.filter(s => s.type === 'tie');
  assert.equal(ties.length, 2, 'both voices are tied');
  const compat = PLAN.build(g), graph = PLAN.build(g, { legacyCompat: false });
  const struckAt = (p, q) => p.strikes.filter(s => s.q === q && s.midi === 72).length;
  assert.equal(struckAt(compat, 4), 1, 'COMPAT KEEPS the old player\'s answer: two ends of one pitch at one place are one note to it, so one of them is struck again');
  assert.equal(struckAt(graph, 4), 0, 'GRAPH: both ends are named by their tie, neither is struck');
  assert.equal(compat.cont.size, 1);
  assert.equal(graph.cont.size, 2);
  assert.deepEqual([...graph.hold.values()], [4, 4], 'each voice holds its chain');
  ties.forEach(s => assert.ok(graph.cont.has(s.to), 'the end of ' + s.id + ' is carried into'));
});

test('ROW struck or tied: every tie of E08 (a tied chord, partly), E09 (over a bar line) and ties-slurs is carried into, never struck - in both rules', () => {
  for (const [name, g] of [['E08', eFixture('E08-tie-partial-chord')], ['E09', eFixture('E09-tie-barline-system')], ['ties-slurs', sgFixture('ties-slurs')]]) {
    const ends = [];
    g.parts.forEach(p => p.spanners.filter(s => s.type === 'tie' && s.from && s.to).forEach(s => ends.push(s.to)));
    assert.ok(ends.length > 2, name + ': the fixture has ties');
    for (const compat of [true, false]) {
      const plan = PLAN.build(g, { legacyCompat: compat });
      const struckHeads = new Set(plan.strikes.map(s => s.head));
      assert.deepEqual([...plan.cont].sort(), ends.slice().sort(), name + (compat ? ' (compat)' : ' (graph)') + ': the notes carried into are the tie ends');
      ends.forEach(h => assert.ok(!struckHeads.has(h), name + ': ' + h + ' is not struck'));
    }
  }
});

/* ====================================================================== hold */
test('ROW hold: a note is held for its written length, its tie chain, the pedal up point, the sostenuto - the arithmetic of PianoScore, on quarters', () => {
  const plan = PLAN.build(fixtureGraph('pedals'));
  const up = (m, midi) => plan.strikes.find(s => s.m === m && s.midi === midi);
  /* the damper is down in [2,8): a key that comes up there goes on sounding until 8 */
  assert.deepEqual([up(1, 72).q, up(1, 72).upQ], [0, 2], 'comes up AT the change point (2): not inside a span, so it stops');
  assert.deepEqual([up(1, 74).q, up(1, 74).upQ], [2, 8], 'comes up at 4, inside [2,8): held to the pedal up');
  assert.deepEqual([up(1, 48).q, up(1, 48).upQ], [0, 8], 'the whole note of the left hand likewise');
  /* the sostenuto goes down at 10 and catches what is sounding then: bar 3's notes, not bar 4's, which start after it */
  assert.deepEqual([up(3, 45).q, up(3, 45).upQ], [8, 14], 'A2 (8-12) is sounding when the sostenuto goes down: held to its end (14)');
  assert.deepEqual([up(3, 79).q, up(3, 79).upQ], [10, 14], 'G5 starts with the sostenuto: caught');
  assert.deepEqual([up(3, 77).q, up(3, 77).upQ], [8, 10], 'F5 ends as the sostenuto goes down: not caught');
  assert.deepEqual([up(4, 47).q, up(4, 47).upQ], [12, 16], 'B2 starts after the sostenuto went down: not caught (and no damper is down)');
  /* a tie chain: 2 + 2 quarters, and a hold is never shorter than 0.05 */
  const ties = PLAN.build(fixtureGraph('ties-edge'));
  const first = ties.strikes.find(s => s.m === 1 && s.midi === 72);
  assert.equal(PLAN.holdOf(ties, first.note), 4);
  assert.equal(first.upQ - first.q, 4);
  assert.equal(PLAN.holdOf({ hold: new Map() }, { head: 'h1', dur: 0 }), 0.05);
  assert.equal(PLAN.holdOf({ hold: new Map() }, { head: 'h1', dur: 1.5 }), 1.5);
});

/* ====================================================================== pedal */
test('ROW pedal: spans [down, up) in written quarters, the printed change lifts and presses again (MX-1), a half pedal keeps the strings up', () => {
  const plan = PLAN.build(fixtureGraph('pedals'));
  assert.deepEqual(plan.pedal, [[0, 2], [2, 8], [16, 20]], 'the change splits the span at 2; the half pedal is a span too');
  const cc = plan.ccs.map(c => c.cc + '=' + c.value + '@' + c.q).join(' ');
  assert.equal(cc, '64=127@0 64=0@2 64=127@2 64=0@8 67=127@8 66=127@10 67=0@12 66=0@14 64=64@16 64=64@20',
    'damper 64, sostenuto 66, soft 67; a change is the lift (0) then the press (127) at one point; the half pedal is 64');
  const lift = plan.ccs.filter(c => c.q === 2 && c.cc === 64).map(c => c.value);
  assert.deepEqual(lift, [0, 127], 'CC64 goes 0 then 127 at the change');
  assert.deepEqual(plan.ccs.map(c => c.q), plan.ccs.map(c => c.q).slice().sort((a, b) => a - b), 'in time order');
});

test('ROW pedal: E17 - a pedal with its sign, then a line pedal changed in the middle', () => {
  const plan = PLAN.build(eFixture('E17-pedal'));
  assert.deepEqual(plan.pedal, [[0, 2], [4, 6], [6, 12]], 'the first pedal is down for two quarters; the second is split at its change (6) and runs to the end of bar 3');
  assert.deepEqual(plan.ccs.map(c => c.value + '@' + c.q).join(' '), '127@0 0@2 127@4 0@6 127@6', 'the change at 6 is a lift and a press at one point');
});

test('ROW pedal (graph rule): the release of a half pedal is 0; the old Score gave it the depth, and the pedal never came up', () => {
  const g = fixtureGraph('pedals');
  const compat = PLAN.build(g), graph = PLAN.build(g, { legacyCompat: false });
  assert.equal(compat.ccs[compat.ccs.length - 1].value, 64, 'KEPT in compat: CC64 stays at 64 at the release (the old player)');
  assert.equal(graph.ccs[graph.ccs.length - 1].value, 0, 'GRAPH: the pedal comes up');
  assert.deepEqual(graph.ccs.slice(0, -1).map(c => [c.q, c.cc, c.value]), compat.ccs.slice(0, -1).map(c => [c.q, c.cc, c.value]), 'and nothing else differs');
});

test('ROW pedal: KEPT QUIRK - a pedal is copied into every visit, repeats included, from its written place', () => {
  const text = H.fixtureText('pedals')
    .replace('<measure number="1">', '<measure number="1"><barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>')
    .replace('<measure number="2">', '<measure number="2"><barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
  const g = graphOfText(text, 'pedal-repeat');
  const plan = PLAN.build(g);
  assert.equal(numbers(plan), '1 2 1 2 3 4 5 6');
  const damper = plan.ccs.filter(c => c.cc === 64 && c.q <= 16).map(c => c.q + ':' + c.value).join(' ');
  assert.equal(damper, '0:127 2:0 2:127 8:127 10:0 10:127 16:0',
    'bars 1-2 twice: each pass presses and changes; the release is written at the start of bar 3 (8), so it comes once, with bar 3 (16): the second pass presses a pedal that is still down');
  assert.deepEqual(plan.pedal, [[0, 2], [2, 8], [16, 20]], 'the spans stay in written quarters');
});

test('ROW pedal: only the part the app plays has a pedal, and the soft pedal makes the notes softer (x 0.72)', () => {
  const plan = PLAN.build(fixtureGraph('pedals'));
  const bar = n => plan.strikes.filter(s => s.m === n).map(s => s.vel);
  assert.deepEqual(bar(2), [80, 80]);
  assert.deepEqual(bar(3), [58, 58, 58], '80 x 0.72 = 57.6, rounded: the soft pedal is down from 8 to 12');
  assert.deepEqual(bar(4), [80, 80, 80]);
});

/* ====================================================================== velocity */
test('ROW velocity: dynamics, hairpins, accent, marcato, a written dynamic on one note', () => {
  const plan = PLAN.build(fixtureGraph('dynamics'));
  assert.deepEqual(plan.strikes.map(s => s.vel), [
    48, 48, 62, 70,           /* p = 48; the accent adds 14; the marcato 22 */
    48, 60, 72, 84,           /* a crescendo from p (48) to the f that follows (96), a quarter at a time */
    96, 96, 108, 96,          /* f = 96; an sf on one note is the louder of 96 and its own 108 */
    96, 80, 64, 45            /* a diminuendo from 96 to the mp that ends it (64); then the sound of 50 % = 45 */
  ]);
  assert.deepEqual(plan.dyn.wedges.map(w => [w.type, w.q0, w.q1, w.v0, w.v1]), [['crescendo', 4, 8, 48, 96], ['diminuendo', 12, 14, 96, 64]]);
  assert.deepEqual(plan.dyn.marks.map(m => [m.q, m.mark, m.vel]), [[0, 'p', 48], [8, 'f', 96], [14, 'mp', 64], [14, 'sound', 45]]);
});

test('ROW velocity: with no dynamic mark a note is mezzo-forte (80), and the articulations of E15 move it', () => {
  const plain = PLAN.build(sgFixture('repeats-simple'));
  assert.ok(plain.strikes.every(s => s.vel === 80));
  const e15 = PLAN.build(eFixture('E15-articulations'));
  assert.deepEqual([...new Set(e15.strikes.map(s => s.vel))].sort((a, b) => a - b), [80, 94, 102]);
});

/* ====================================================================== tempo */
test('ROW tempo: one entry per visit and per change inside it, the written tempo restored when a bar is played again', () => {
  const plan = PLAN.build(fixtureGraph('tempo-change'));
  assert.equal(numbers(plan), '1 2 3 2 3 4');
  assert.deepEqual(plan.tempoMap.map(t => [t.q, t.bpm]),
    [[0, 100], [4, 100], [6, 60], [8, 108], [12, 100], [14, 60], [16, 108], [20, 108]],
    'bar 1: 100; bar 2 beat 3: 60; bar 3: a dotted quarter = 72 is 108 quarters; bar 2 again starts at the written 100, not at 108');
});

test('ROW tempo: the fallback is the caller\'s defaultQpm, else the first tempo of the file rounded, else 84', () => {
  const g = fixtureGraph('tempo-change');
  assert.equal(PLAN.build(g).tempoMap[0].bpm, 100);
  const none = fixtureGraph('jump-ds-al-fine');
  assert.deepEqual(PLAN.build(none).tempoMap.map(t => t.bpm), [84, 84, 84, 84]);
  assert.deepEqual(PLAN.build(none, { defaultQpm: 120 }).tempoMap.map(t => t.bpm), [120, 120, 120, 120]);
  assert.equal(PLAN.build(eFixture('E22-repeats-jumps')).tempoMap[0].bpm, 120);
});

/* ====================================================================== pitch */
test('ROW pitch: the graph\'s pitch is the pitch that sounds - an 8va or a transposing part shifts nothing that is struck', async () => {
  for (const [rel, name] of [['tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml', 'ottava'], ['tests/scoregraph/fixtures/xml/transposing.musicxml', 'transposing'],
    ['tests/engrave/fixtures/e/E18-ottava.musicxml', 'E18']]) {
    const g = await H.graphOfFile(rel);
    const want = new Map();
    g.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => { if (h.pitch) want.set(h.id, SG.pitch.midi(h.pitch)); })));
    const plan = PLAN.build(g);
    assert.ok(plan.strikes.length > 4, name);
    plan.strikes.forEach(s => assert.equal(s.midi, want.get(s.head), name + ' ' + s.head));
  }
});

/* ====================================================================== grace notes */
test('ROW graces: dropped unless asked - the plan is the old one, and the dropped notes are not in it at all', () => {
  const g = fixtureGraph('grace-notes');
  const plain = PLAN.build(g), off = PLAN.build(g, { graces: false });
  assert.equal(plain.strikes.length, 12, 'three right-hand notes and the held left-hand note in each of the three bars');
  assert.deepEqual(H.canon(plain), H.canon(off));
  assert.ok(plain.strikes.every(s => !s.grace));
  assert.equal(PLAN.build(g, { graces: 'play' }).strikes.length, 12 + 9);
});

test('ROW graces: a slashed grace is crushed in before the beat and takes the time from the note before; an unslashed one is on the beat and takes it from its own note', () => {
  const plan = PLAN.build(fixtureGraph('grace-notes'), { graces: 'play' });
  const grace = plan.strikes.filter(s => s.grace);
  assert.equal(grace.length, 9, 'bar 1: 2, bar 2: 3, bar 3: 4 (a chord of two, then one each)');
  const at = (m, midi) => plan.strikes.find(s => s.m === m && s.midi === midi && !!s.grace);
  const main = (m, midi) => plan.strikes.find(s => s.m === m && s.midi === midi && !s.grace);
  /* bar 2: E5 (4-5), two slashed 16ths A5 B5, D5 at the beat 5, C5 half, a slashed 16th after it */
  assert.deepEqual([at(2, 81).q, at(2, 81).upQ, at(2, 83).q, at(2, 83).upQ], [4.75, 4.875, 4.875, 5], 'two crushed 32nds in front of the beat 5, in order');
  assert.equal(main(2, 76).upQ, 4.75, 'the E5 before them is cut short where the first one starts');
  assert.equal(main(2, 74).q, 5, 'D5 itself stays on the beat');
  assert.deepEqual([at(2, 74).q, at(2, 74).upQ], [7.875, 8], 'a grace after the last note of the bar: just before the bar line, with no main note');
  assert.equal(at(2, 74).grace.of, null);
  assert.equal(main(2, 72).upQ, 7.875, 'and the C5 half before it gives it the time');
  /* bar 1: the unslashed G5 is on the beat (2) for its written eighth; F5 sounds after it, to the end of its own length */
  assert.deepEqual([at(1, 79).q, at(1, 79).upQ], [2, 2.5]);
  assert.deepEqual([main(1, 77).q, main(1, 77).upQ], [2.5, 4]);
  /* bar 1: the slashed D5 before the very first note cannot start before the plan: it takes the time from C5 (a crushed 32nd) */
  assert.deepEqual([at(1, 74).q, at(1, 74).upQ], [0, 0.125]);
  assert.deepEqual([main(1, 72).q, main(1, 72).upQ], [0.125, 1]);
  assert.equal(main(1, 76).q, 1, 'the notes after that are on their beats');
});

test('ROW graces: a chord of graces is struck together, in its order; a long grace group cannot outgrow its note (half of it at most)', () => {
  const plan = PLAN.build(fixtureGraph('grace-notes'), { graces: 'play' });
  const bar3 = plan.strikes.filter(s => s.m === 3).map(s => [s.q, s.upQ, s.midi, !!s.grace]);
  assert.deepEqual(bar3.filter(x => x[2] === 76 || x[2] === 79).slice(0, 2), [[8, 8.5, 76, true], [8, 8.5, 79, true]], 'E5 and G5 together');
  assert.deepEqual(bar3.find(x => x[2] === 81 && !x[3]), [8.5, 10, 81, false], 'A5 follows the eighth the chord took');
  /* two QUARTER graces (1 each) before an eighth (0.5): the most the eighth can give is a quarter-note of 0.25 in all, so 0.125 each */
  assert.deepEqual(bar3.filter(x => x[2] === 77 || x[2] === 79 && x[0] > 9), [[10, 10.125, 77, true], [10.125, 10.25, 79, true]]);
  assert.deepEqual(bar3.find(x => x[2] === 83), [10.25, 10.5, 83, false]);
  assert.deepEqual(bar3.find(x => x[2] === 84), [10.5, 11, 84, false], 'the note after is not moved');
});

test('ROW graces: a grace names its own event and head and the note it belongs to; they are not in the matcher\'s list (the app must skip them)', () => {
  const g = fixtureGraph('grace-notes');
  const plan = PLAN.build(g, { graces: 'play' });
  const heads = new Map();
  g.parts[0].events.forEach(e => (e.heads || []).forEach(h => heads.set(h.id, e)));
  plan.strikes.filter(s => s.grace).forEach(s => {
    assert.ok(heads.get(s.head).grace, 'the head is a grace head');
    assert.equal(heads.get(s.head).id, s.ev);
    if (s.grace.of) assert.ok(plan.strikes.some(m => m.ev === s.grace.of && !m.grace), 'its main note is struck too');
  });
  assert.ok(plan.strikes.filter(s => !s.grace).every(s => !heads.get(s.head).grace));
  /* the plain notes of the plan with graces on are the plain plan's, but for the times graces moved */
  const plain = PLAN.build(g);
  assert.deepEqual(plan.strikes.filter(s => !s.grace).map(s => s.head).sort(), plain.strikes.map(s => s.head).sort());
});

test('ROW graces: a loop range plays the graces of its bars only, and a repeat plays them again', () => {
  const g = fixtureGraph('grace-notes');
  const loop = PLAN.build(g, { graces: 'play', range: { from: 1, to: 1 } });
  assert.equal(loop.strikes.filter(s => s.grace).length, 3);
  const text = H.fixtureText('grace-notes').replace('<measure number="2">', '<measure number="2"><barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>')
    .replace('<measure number="3">', '<measure number="3"><barline location="left"><bar-style>none</bar-style></barline>').replace('<note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>\n      <barline location="right"><bar-style>light-heavy</bar-style></barline>', '<note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>\n      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
  const twice = PLAN.build(graphOfText(text, 'grace-repeat'), { graces: 'play' });
  assert.equal(numbers(twice), '1 2 3 2 3');
  assert.equal(twice.strikes.filter(s => s.grace).length, 3 + 5 + 3 + 5);
});

/* ====================================================================== beats */
test('ROW beats: the metronome counts as the old player did - 3/4 in three, 6/8 in two, 6/4 in SIX, a pickup from its bar line, 3+2/8 as 3/8', () => {
  const plan = PLAN.build(fixtureGraph('meters-pickup'));
  const bars = {};
  plan.beats.forEach(b => { (bars[b.m] = bars[b.m] || []).push((b.accent ? '!' : '') + b.q); });
  assert.deepEqual(bars, {
    0: ['0'],                                            /* the pickup's one beat, not accented: it is the last beat of a bar */
    1: ['!1', '2', '3'],
    2: ['!4', '5.5'],                                    /* 6/8: two beats of a dotted quarter */
    3: ['!7', '8', '9', '10', '11', '12'],               /* 6/4: SIX (kept) */
    4: ['!13', '15'],                                    /* 2/2: two half notes */
    5: ['!17', '17.5', '18', '18.5', '19']               /* 3+2/8: read as 3/8, a beat is an eighth, and the bar is five eighths long */
  });
});

test('ROW beats (graph rule): by the meter\'s own groups - 6/4 in two, 3+2/8 in two groups', () => {
  const plan = PLAN.build(fixtureGraph('meters-pickup'), { legacyCompat: false });
  const bars = {};
  plan.beats.forEach(b => { (bars[b.m] = bars[b.m] || []).push((b.accent ? '!' : '') + b.q); });
  assert.deepEqual(bars, { 0: ['0'], 1: ['!1', '2', '3'], 2: ['!4', '5.5'], 3: ['!7', '10'], 4: ['!13', '15'], 5: ['!17', '18.5'] });
});

test('ROW beats: they follow the play order - a repeated bar is counted again, at its sounding time', () => {
  const plan = PLAN.build(sgFixture('repeats-simple'));
  assert.deepEqual(plan.beats.map(b => b.q).slice(0, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(plan.beats.length, 5 * 4);
  assert.deepEqual(plan.beats.filter(b => b.accent).map(b => [b.q, b.m]), [[0, 1], [4, 2], [8, 1], [12, 2], [16, 3]]);
});

/* ====================================================================== the ids */
test('the ids: every strike names its event, head and visit; every visit its measure; nothing else is invented', async () => {
  for (const rel of ['tests/scoregraph/fixtures/xml/repeats-nested.musicxml', 'tests/engrave/fixtures/e/E25-chords-dense.musicxml', 'tests/engrave/fixtures/e/E35-voice-and-piano.musicxml',
    'tests/practice/fixtures/ties-edge.musicxml', 'catalog/hymns/silent-night.musicxml']) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    const heads = new Map(), events = new Map();
    g.parts.forEach(p => p.events.forEach(e => { events.set(e.id, e); (e.heads || []).forEach(h => heads.set(h.id, e)); }));
    const measures = new Set(g.timeline.measures.map(m => m.id));
    const plan = PLAN.build(g);
    plan.visits.forEach(v => { assert.ok(measures.has(v.id), rel); assert.equal(g.timeline.measures[v.index].id, v.id); });
    plan.strikes.forEach(s => {
      assert.ok(heads.has(s.head), rel + ' head ' + s.head);
      assert.equal(heads.get(s.head).id, s.ev, rel + ' event of ' + s.head);
      assert.ok(plan.visits.includes(s.visit), rel + ': the visit is one of the plan\'s');
      assert.ok(s.q >= s.visit.soundQ - 1e-9 && s.q < s.visit.soundQ + s.visit.lenQ + 1e-9, rel + ': a strike sounds inside its visit');
      assert.equal(s.m, s.visit.number);
      assert.equal(s.note.head, s.head);
    });
    plan.written.forEach(n => { if (!n.rest) assert.ok(heads.has(n.head)); else assert.ok(events.has(n.ev)); });
  }
});

test('the plan is sorted by (q, midi) like the old one, deterministic, and plain data apart from its Map and Set', () => {
  const g = fixtureGraph('ties-edge');
  const a = PLAN.build(g), b = PLAN.build(g);
  assert.deepEqual(H.canon(a), H.canon(b));
  for (let i = 1; i < a.strikes.length; i++) {
    const p = a.strikes[i - 1], c = a.strikes[i];
    assert.ok(p.q < c.q || (p.q === c.q && p.midi <= c.midi), 'order at ' + i);
  }
  assert.ok(a.hold instanceof Map && a.cont instanceof Set);
  assert.equal(a.soundLengthQ, a.visits.reduce((s, v) => s + v.lenQ, 0));
  a.visits.forEach((v, i) => assert.equal(v.soundQ, a.visits.slice(0, i).reduce((s, x) => s + x.lenQ, 0)));
});

/* ====================================================================== hands */
test('the hand: right and left from the staves of the piano part; another part, a cue, is x (heard, not judged)', () => {
  const plan = PLAN.build(eFixture('E35-voice-and-piano'));
  assert.deepEqual([...new Set(plan.strikes.map(s => s.hand))].sort(), ['l', 'r', 'x']);
  const x = plan.strikes.filter(s => s.hand === 'x');
  assert.ok(x.length > 0);
  const all = PLAN.followGates(plan, 'both');
  const asked = new Set([].concat(...all.map(g => g.notes.map(n => n.head))));
  x.forEach(s => assert.ok(!asked.has(s.head), 'a note of the other part is heard but never asked'));
  assert.equal(PLAN.handOk({ hand: 'x' }, 'both'), false);
  assert.equal(PLAN.handOk({ hand: 'r' }, 'both'), true);
  assert.equal(PLAN.handOk({ hand: 'r' }, 'left'), false);
  assert.equal(PLAN.handOk({ hand: 'l' }, 'left'), true);
  assert.equal(PLAN.handOk({ hand: 'l' }, undefined), true);
});

/* ====================================================================== follow gates */
test('followGates: the written range once, every onset, rests as gates of their own (App followGates)', () => {
  const g = sgFixture('repeats-simple');
  const gates = PLAN.followGates(PLAN.build(g), 'both');
  assert.equal(gates.length, 3, 'one onset a bar, the repeat is not asked again');
  assert.deepEqual(gates.map(x => [x.b, x.m, x.rest, x.notes.length]), [[0, 1, false, 1], [4, 2, false, 1], [8, 3, false, 1]]);
  /* E36: bar 2 sounds nothing for its last quarter: a stretch of silence is a gate of its own, as long as the silence */
  const withRest = PLAN.followGates(PLAN.build(eFixture('E36-pickup-implicit')), 'both');
  assert.deepEqual(withRest.map(x => [x.b, x.m, x.rest, x.rest ? x.dur : x.notes.length]), [[0, 0, false, 1], [1, 1, false, 2], [4, 2, false, 2], [6, 2, true, 1], [7, 4, false, 2]]);
  assert.ok(withRest.filter(x => x.rest).every(x => x.notes.length === 0));
});

test('followGates FOLLOW_REPEAT: a repeated passage is asked as often as the clock plays it', () => {
  const plan = PLAN.build(sgFixture('repeats-simple'));
  const once = PLAN.followGates(plan, 'both'), again = PLAN.followGates(plan, 'both', { repeats: true });
  assert.deepEqual(once.map(x => x.m), [1, 2, 3]);
  assert.deepEqual(again.map(x => x.m), [1, 2, 1, 2, 3], 'bars 1 2 1 2 3, as Play does');
  assert.deepEqual(again.map(x => x.b), [0, 4, 0, 4, 8], 'the playhead goes back to the written place');
  assert.deepEqual(again.map(x => x.visit), [0, 1, 2, 3, 4]);
  assert.deepEqual(again.map(x => x.q), [0, 4, 8, 12, 16], 'and each gate knows its sounding quarter');
  /* with no repeat in the range the two are the same list */
  const flat = PLAN.build(sgFixture('pickup-3-4'));
  assert.deepEqual(PLAN.followGates(flat, 'both', { repeats: true }).map(x => [x.b, x.m, x.rest]), PLAN.followGates(flat, 'both').map(x => [x.b, x.m, x.rest]));
});

test('followGates FOLLOW_REPEAT: D.C. and D.S. are asked too (with opts.jumps), and a loop range asks only its own bars', () => {
  const plan = PLAN.build(fixtureGraph('jump-ds-al-coda'), { jumps: 'once' });
  assert.deepEqual(PLAN.followGates(plan, 'both', { repeats: true }).map(x => x.m), [1, 2, 3, 4, 2, 3, 5, 6]);
  assert.deepEqual(PLAN.followGates(plan, 'both').map(x => x.m), [1, 2, 3, 4, 5, 6], 'the old gates know nothing of the way back');
  const loop = PLAN.build(sgFixture('repeats-endings-1-2'), { range: { from: 1, to: 3 } });
  assert.deepEqual(PLAN.followGates(loop, 'both', { repeats: true }).map(x => x.m), [2, 3, 2, 4]);
});

test('followGates FOLLOW_TIE: follow asks exactly the notes the clock strikes - a tied-to note is not asked, a tie that leads nowhere is', () => {
  const plan = PLAN.build(fixtureGraph('ties-edge'));
  const old = PLAN.followGates(plan, 'both'), exact = PLAN.followGates(plan, 'both', { ties: true });
  const ms = gs => gs.map(x => x.m + ':' + x.notes.map(n => n.midi).join('+')).join(' ');
  assert.equal(ms(old), '1:67 1:72 2:76 3:74 4:72 4:74 5:77', 'every tieStop is skipped: bar 3\'s C5 and bar 5\'s E5 are not asked, though the clock strikes them');
  assert.equal(ms(exact), '1:67 1:72 2:76 3:72 3:74 4:72 4:74 5:76 5:77', 'the clock strikes the C5 of bar 3 and the E5 of bar 5, so they are asked; the C5 of bar 2 is carried into, so it is not');
  assert.equal(old.length, 7);
  assert.equal(exact.length, 9);
  /* a piece with no dangling tie: the two are the same list */
  const sane = PLAN.build(sgFixture('ties-slurs'));
  assert.deepEqual(PLAN.followGates(sane, 'both', { ties: true }), PLAN.followGates(sane, 'both'));
});

test('followGates: each gate names its events and heads, and the hand filter keeps the notes of one hand', () => {
  const g = fixtureGraph('pedals');
  const plan = PLAN.build(g);
  const both = PLAN.followGates(plan, 'both'), right = PLAN.followGates(plan, 'right'), left = PLAN.followGates(plan, 'left');
  const events = new Map();
  g.parts[0].events.forEach(e => (e.heads || []).forEach(h => events.set(h.id, e.id)));
  both.forEach(x => x.notes.forEach(n => assert.equal(events.get(n.head), n.ev)));
  assert.deepEqual(both.map(x => [x.b, x.notes.length]), [[0, 2], [2, 1], [4, 2], [8, 2], [10, 1], [12, 2], [14, 1], [16, 2], [20, 2]]);
  assert.deepEqual(right.map(x => x.b), [0, 2, 4, 8, 10, 12, 14, 16, 20], 'the right hand has an onset at every one');
  assert.deepEqual(left.map(x => x.b), [0, 4, 8, 12, 16, 20], 'the left hand has a whole note a bar');
  assert.ok(right.every(x => x.notes.every(n => n.hand === 'r')) && left.every(x => x.notes.every(n => n.hand === 'l')));
});

/* ====================================================================== the cache */
test('of(): one plan per (graph, options) for a frozen graph, a fresh one for a graph that can change', () => {
  const g = SG.deepFreeze(JSON.parse(JSON.stringify(fixtureGraph('jump-ds-al-fine'))));
  assert.equal(PLAN.of(g), PLAN.of(g));
  assert.equal(PLAN.of(g, { jumps: 'once' }), PLAN.of(g, { jumps: 'once' }));
  assert.notEqual(PLAN.of(g), PLAN.of(g, { jumps: 'once' }));
  assert.notEqual(PLAN.of(g, { range: { from: 0, to: 1 } }), PLAN.of(g, { range: { from: 0, to: 2 } }));
  assert.equal(PLAN.of(g, { range: { from: 0, to: 1 } }), PLAN.of(g, { range: { from: 0, to: 1 } }));
  assert.notEqual(PLAN.of(g, { legacyCompat: false }), PLAN.of(g));
  assert.notEqual(PLAN.of(g, { defaultQpm: 100 }), PLAN.of(g));
  assert.deepEqual(H.canon(PLAN.of(g, { jumps: 'once' })), H.canon(PLAN.build(g, { jumps: 'once' })), 'the cached plan is the built one');
  const loose = JSON.parse(JSON.stringify(g));
  assert.equal(Object.isFrozen(loose), false);
  assert.notEqual(PLAN.of(loose), PLAN.of(loose), 'a graph that is not frozen is not cached');
});

/* ====================================================================== the browser */
test('the browser build: loaded as scripts in a bare context (rational, pitch, then plan) it leaves PPPPractice.plan, and builds the same plan', () => {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const ctx = vm.createContext({});
  assert.equal(vm.runInContext('typeof require + " " + typeof module', ctx), 'undefined undefined');
  const load = (dir, name) => vm.runInContext(fs.readFileSync(path.join(H.REPO, dir, name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  assert.throws(() => load('practice', 'plan'), /needs scoregraph\/rational.js and scoregraph\/pitch.js/, 'it says what is missing');
  load('scoregraph', 'rational'); load('scoregraph', 'pitch'); load('practice', 'plan');
  const B = ctx.PPPPractice.plan;
  assert.deepEqual(Object.keys(B).sort(), Object.keys(PLAN).sort());
  for (const [name, opts] of [['jump-dc-al-fine-volta', { jumps: 'once' }], ['grace-notes', { graces: 'play' }], ['pedals', { legacyCompat: false }], ['ties-edge', {}]]) {
    const g = fixtureGraph(name);
    const here = PLAN.build(g, opts), there = B.build(JSON.parse(JSON.stringify(g)), opts);
    assert.deepEqual(JSON.parse(JSON.stringify(H.canon(there))), JSON.parse(JSON.stringify(H.canon(here))), name);
  }
});

/* ====================================================================== the budget */
test('performance: a plan of the longest piece (sonatina/020, 1,776 notes) is built in 10 ms (G11 §10, G11a-1), the old player\'s plan in about 6', async (t) => {
  const g = await H.graphOfFile('catalog/method/sonatina/020.mxl');
  assert.ok(g);
  const notes = g.parts.reduce((n, p) => n + p.events.reduce((m, e) => m + (e.kind === 'rest' || e.grace ? 0 : e.heads.length), 0), 0);
  assert.equal(notes, 1776);
  const ms = T.samples(() => PLAN.build(g));
  const budget = T.budget(10);
  t.diagnostic('plan.build over sonatina/020: ' + T.describe(ms) + ' (budget ' + budget + ' ms)');
  assert.ok(T.median(ms) <= budget, 'plan.build ' + T.describe(ms) + ', over the ' + budget + ' ms budget (10 ms outside CI)');
  const all = T.samples(() => PLAN.build(g, { jumps: 'once', graces: 'play', legacyCompat: false }));
  assert.ok(T.median(all) <= budget, 'with every option on: ' + T.describe(all));
  const plan = PLAN.build(g);
  const gates = T.samples(() => PLAN.followGates(plan, 'both', { repeats: true, ties: true }));
  assert.ok(T.median(gates) <= T.budget(10), 'followGates ' + T.describe(gates));
});
