/* scoregraph/tools/ledger-stats.js (G10a-6): how many ledger lines each head is drawn on, with the octave lines applied.
   The count is checked three ways: the arithmetic on named pitches (the first line is the one a head sits ON), the heads the engraver's own plan writes for a graph with
   octave lines (engrave/plan.js `written`: which heads a line moves), and the ledger lines the engraver actually draws for every event of real-shaped graphs
   (engrave/layout.js: one rectangle per line, per event and staff), with clef changes and octave lines both in play. node --test tests/scoregraph */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const LS = require(path.join(REPO, 'scoregraph', 'tools', 'ledger-stats.js'));
const R = require(path.join(REPO, 'scoregraph', 'rational.js'));
const E = require(path.join(REPO, 'engrave', 'index.js'));
const OT = require(path.join(REPO, 'realize', 'ottava.js'));
const L = require(path.join(REPO, 'realize', 'tools', 'legacy.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const F = require(path.join(REPO, 'tests', 'recording-v2-fixtures.js'));

const TREBLE = { sign: 'G', line: 2 }, BASS = { sign: 'F', line: 4 };
const idx = name => { const m = /^([A-G])(\d)$/.exec(name); return (+m[2]) * 7 + 'CDEFGAB'.indexOf(m[1]); };

test('ledger lines of a named pitch: the first one is the line the head sits on, one more for every second step', () => {
  const t = LS.staffOf(TREBLE), b = LS.staffOf(BASS);
  const treble = { F5: 0, G5: 0, A5: 1, B5: 1, C6: 2, D6: 2, E6: 3, F6: 3, G6: 4, B6: 5, C7: 5, E4: 0, D4: 0, C4: 1, B3: 1, A3: 2, G3: 2, E3: 3, C3: 4 };
  Object.keys(treble).forEach(p => assert.equal(LS.linesOf(idx(p), t), treble[p], 'treble ' + p));
  const bass = { A3: 0, B3: 0, C4: 1, D4: 1, E4: 2, G4: 3, G2: 0, F2: 0, E2: 1, D2: 1, C2: 2, A1: 3, E1: 4, C1: 5 };
  Object.keys(bass).forEach(p => assert.equal(LS.linesOf(idx(p), b), bass[p], 'bass ' + p));
});

test('clefs: an alto clef (C on the middle line) and a treble clef 8vb move the staff', () => {
  const alto = LS.staffOf({ sign: 'C', line: 3 });
  assert.equal(alto.bottom, idx('F3'));
  assert.equal(alto.top, idx('G4'));
  /* a treble 8vb clef sounds an octave below where it is written: a sounding A3 is on the first ledger line... above? no: it is written A4, in the staff */
  const t8 = LS.staffOf({ sign: 'G', line: 2, octave: -1 });
  assert.equal(LS.linesOf(idx('A3'), t8), 0);
  assert.equal(LS.linesOf(idx('C3'), t8), 1);
});

const measures = n => Array.from({ length: n }, (_, i) => ({ number: i + 1, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' } }));
const TYPE = { 0.25: '16th', 0.5: 'eighth', 1: 'quarter', 2: 'half', 4: 'whole' };
const N = (staff, m, b, dur, p, midi) => ({ m: m, b: b, dur: dur, type: TYPE[dur], dots: 0, p: p, midi: midi, acc: null, staff: staff, hand: staff === 1 ? 'r' : 'l', voice: staff, rest: false, chord: false, tieStart: false, tieStop: false });
function graphOf(notes, ms) {
  const proj = L.graphFromLegacyNotes(ms || measures(2), notes, 100, 'ledger-test');
  assert.ok(proj.ok, JSON.stringify(proj.unsupported || proj).slice(0, 200));
  return proj.graph;
}

test('the counts of a graph: the histogram, the staves, the sides, and the line moves heads to where they are drawn', () => {
  const notes = [N(1, 1, 0, 1, 'E6', 88), N(1, 1, 1, 1, 'F6', 89), N(1, 1, 2, 1, 'G6', 91), N(1, 1, 3, 1, 'C5', 72), N(2, 1, 0, 4, 'C2', 36), N(2, 2, 0, 4, 'C3', 48), N(1, 2, 0, 4, 'C6', 84)];
  const g = graphOf(notes);
  const plain = LS.ledgerStats(g);
  assert.equal(plain.heads, 7);
  assert.deepEqual(plain.hist, [2, 0, 2, 2, 1].map((x, i) => x), JSON.stringify(plain.hist));   /* C5 and C3: 0; C6 and C2: 2; E6 and F6: 3; G6: 4 */
  assert.equal(plain.ge3, 3);
  assert.equal(plain.ge4, 1);
  assert.equal(plain.staves[1].above, 3);
  assert.equal(plain.staves[2].below, 0);
  assert.equal(plain.shifted, 0);
  const r = OT.addOttava(g);
  assert.ok(r.changed && !r.fallback);
  const on = LS.ledgerStats(r.graph), off = LS.ledgerStats(r.graph, { display: false });
  assert.deepEqual(off.hist, plain.hist, 'display:false ignores the lines');
  assert.ok(on.shifted >= 3 && on.ge3 === 0, JSON.stringify(on));
  assert.equal(on.spans, r.spans.length);
  assert.equal(on.heads, plain.heads);
  /* the window: only the heads of the bars asked for */
  const w1 = LS.ledgerStats(g, { window: [0, 0] }), w2 = LS.ledgerStats(g, { window: [1, 1] });
  assert.equal(w1.heads + w2.heads, plain.heads);
  assert.equal(w1.bars, 1);
  assert.equal(w1.heads, 5);
  assert.deepEqual(LS.ledgerStats({}), { heads: 0, bars: 0, hist: [0, 0, 0, 0, 0], staves: {}, ge2: 0, ge3: 0, ge4: 0, shifted: 0, spans: 0, per100: null });
});

/* the engraver's own account of the same graph */
function engraverLedgers(g) {
  const eng = E.layout.engrave(E.plan(g), {});
  const by = new Map();
  eng.objects.filter(o => o.kind === 'ledger' && !o.grace).forEach(o => {
    const m = /^(.*)#ledger(.*):(-?\d+)$/.exec(o.id);
    if (!m) return;
    const rest = /#ledger/.test(o.id) && eng.objects.some(x => x.id === o.event && x.kind === 'rest');
    if (rest) return;
    const k = m[1] + '|' + m[2];
    by.set(k, (by.get(k) || 0) + 1);
  });
  return by;
}
/* ours: per (event, staff) the lines above (the most any head needs) plus the lines below */
function ourLedgers(g) {
  const by = new Map(), seen = new Map();
  LS.ledgerHeads(g).forEach(x => {
    const k = x.event + '|' + x.staff;
    const cur = seen.get(k) || { above: 0, below: 0 };
    cur[x.side] = Math.max(cur[x.side], x.lines);
    seen.set(k, cur);
  });
  seen.forEach((v, k) => { if (v.above + v.below > 0) by.set(k, v.above + v.below); });
  return by;
}
function sameAsEngraver(g, label) {
  const a = engraverLedgers(g), b = ourLedgers(g);
  const diffs = [];
  new Set([...a.keys(), ...b.keys()]).forEach(k => { if ((a.get(k) || 0) !== (b.get(k) || 0)) diffs.push(k + ' engraver ' + (a.get(k) || 0) + ' ours ' + (b.get(k) || 0)); });
  assert.deepEqual(diffs.slice(0, 5), [], label + ': ' + diffs.length + ' of ' + new Set([...a.keys(), ...b.keys()]).size + ' (event, staff) differ');
  return b.size;
}

test('the lines drawn by the engraver are the lines counted, with and without octave lines (a v2 recording, both staves)', () => {
  const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
  [F.highLow(12, 5), F.crossLines(9)].forEach((h, i) => {
    const input = { notes: h.notes.map(n => Object.assign({}, n)), title: 't' };
    const on = AS.toMusicXml(input, v2), off = AS.toMusicXml(input, Object.assign({}, v2, { ottava: 'off' }));
    assert.ok(LS.ledgerStats(on.graph).shifted > 0);
    const n1 = sameAsEngraver(on.graph, 'fixture ' + i + ' with its lines');
    const n2 = sameAsEngraver(off.graph, 'fixture ' + i + ' without');
    assert.ok(n2 > n1, 'the lines leave fewer events on ledger lines');
  });
});

test('the lines drawn by the engraver are the lines counted, with clef changes on the lower staff and an octave line over it', () => {
  const ms = measures(4);
  ms[1].clefs = { 1: 'treble', 2: 'treble' };   /* the left hand in the treble clef in bar 2 */
  ms[2].clefs = { 1: 'treble', 2: 'treble' };
  const notes = [];
  /* bar 1: bass staff, a low and a high note; bars 2-3: the left hand in the treble clef on E4..C6 and low C3 (many lines under a treble clef); bar 4: bass again */
  notes.push(N(2, 1, 0, 2, 'C2', 36), N(2, 1, 2, 2, 'C4', 60), N(1, 1, 0, 4, 'C5', 72));
  ['E4', 'G5', 'C6', 'E6'].forEach((p, i) => notes.push(N(2, 2, i, 1, p, 52 + [0, 15, 20, 24][i])));
  ['C3', 'E3', 'G2', 'C4'].forEach((p, i) => notes.push(N(2, 3, i, 1, p, [48, 52, 43, 60][i])));
  notes.push(N(1, 2, 0, 1, 'E6', 88), N(1, 2, 1, 1, 'G6', 91), N(1, 2, 2, 1, 'A6', 93), N(1, 2, 3, 1, 'C7', 96), N(2, 4, 0, 4, 'A1', 33), N(1, 4, 0, 4, 'C5', 72));
  const g = graphOf(notes, ms);
  assert.ok(g.parts[0].clefs.length >= 4, 'the graph has clef changes on the lower staff: ' + g.parts[0].clefs.map(c => c.sign + '@' + c.m).join(' '));
  const lowerClefs = LS.ledgerHeads(g).filter(x => x.staffNo === 2);
  assert.ok(lowerClefs.some(x => x.lines >= 2 && x.side === 'above'), 'the treble-clef bars of the lower staff have heads far above it');
  sameAsEngraver(g, 'plain');
  const r = OT.addOttava(g);
  assert.ok(r.changed, 'the pass finds lines to write');
  sameAsEngraver(r.graph, 'with lines');
  /* and the heads the engraver writes at a displaced octave are the heads this counts as shifted */
  const plan = E.plan(r.graph);
  let moved = 0;
  plan.events.forEach(e => (e.heads || []).forEach(h => { if (h.pitch && h.written && h.written.oct !== h.pitch.oct) moved++; }));
  assert.equal(LS.ledgerStats(r.graph).shifted, moved);
});
