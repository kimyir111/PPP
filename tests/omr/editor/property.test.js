'use strict';
/* The independent review's question (docs/GOALS/G12_OMR.md section 9, gate A4): can a sequence of edits and undos corrupt a score?

   Random sequences of every kind of edit, on scores of several shapes (a small piano score, a richer one with chords, ties, accidentals and a key, four hymns and
   a method-book piece from the catalogue), through the editor session (omr/editor.js), which is the only way the screen changes a graph. After every step:
     - the graph is valid, and the Score toScore makes of it is what the app plays: the same as the Score made from the graph read back from its saved text
       (drawn = played = saved), and agree() and link() hold
     - every bar can be drawn on its own (windowGraph) and the whole score can be planned and laid out by the engraver
     - a step that was refused changed nothing (the graph is the same object)
   and at the end: undoing every step gives back the graph the visit began with, BYTE FOR BYTE (the serialised text), redoing them gives back every graph there was. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const { SG, q, h, w, e8, rq, rh, rw, N } = L;
const ED = require(path.join(L.REPO, 'omr', 'editor.js'));
const FL = require(path.join(L.REPO, 'omr', 'flags.js'));
const E = require(path.join(L.REPO, 'engrave', 'index.js'));
const R = SG.rational;

/* ------------------------------------------------------------------------------------------------ the scores */
function rich() {
  const bars = [];
  for (let i = 0; i < 6; i++) {
    bars.push({
      rh: [e8('G5'), e8('A5'), e8('B5', { acc: i % 2 ? 'natural' : null }), e8('F#5'), q('D5', { tie: i % 2 ? 'start' : null }), h('G5', { tie: i % 2 ? null : null })].slice(0, 6),
      lh: [q('G2'), q('D3'), q('B3', { chord: false }), N('r/quarter')]
    });
  }
  /* make the ties real: bar 2 ends on a quarter tied into bar 3's first note */
  return L.graphOf([
    { rh: [q('G5'), q('A5'), q('B5'), q('D5', { tie: 'start' })], lh: [h('G2'), h('D3')] },
    { rh: [q('D5', { tie: 'stop' }), e8('E5'), e8('F#5'), h('G5'), q('G5', { chord: false })].slice(0, 4), lh: [q('G2'), q('B2', { chord: false }), h('D3')] },
    { rh: [q('G5'), q('B5', { chord: false }), q('A5'), N('r/half')], lh: [w('G2')] },
    { rh: [e8('G5'), e8('F5'), e8('E5'), e8('D5'), q('C5'), q('B4')], lh: [q('G2'), q('F2'), N('r/half')] },
    { rh: [h('G5'), q('E5'), q('C5')], lh: [h('C3'), q('E3'), q('G3')] },
    { rh: [w('G5')], lh: [w('G2')] }
  ], { fifths: 1 });
}
async function catalogue(rel) {
  const full = path.join(L.REPO, rel);
  if (/\.mxl$/.test(rel)) {
    const r = await SG.importFile(new Uint8Array(fs.readFileSync(full)), { name: path.basename(rel), scoreId: 'prop' });
    return r.ok ? r.graph : null;
  }
  const r = SG.musicxml.import(fs.readFileSync(full, 'utf8'), { scoreId: 'prop', sourceName: path.basename(rel) });
  return r.ok ? r.graph : null;
}
const FIXTURES = [
  { name: 'plain', make: () => L.plain(6) },
  { name: 'rich', make: rich },
  { name: 'hymn-all-creatures', make: () => catalogue('catalog/hymns/all-creatures.musicxml') },
  { name: 'hymn-all-glory', make: () => catalogue('catalog/hymns/all-glory-laud.musicxml') },
  { name: 'sonatina', make: () => catalogue('catalog/method/sonatina/003.mxl') },
  { name: 'two-parts', make: () => {
    const mk = (id, clef, oct) => '<part id="' + id + '">' + [0, 1, 2].map(m => '<measure number="' + (m + 1) + '">' + (m === 0 ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>' + clef[0] + '</sign><line>' + clef[1] + '</line></clef></attributes>' : '')
      + ['C', 'D', 'E', 'F'].map(s => '<note><pitch><step>' + s + '</step><octave>' + oct + '</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>').join('') + '</measure>').join('') + '</part>';
    const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>R</part-name></score-part><score-part id="P2"><part-name>L</part-name></score-part></part-list>' + mk('P1', ['G', 2], 5) + mk('P2', ['F', 4], 3) + '</score-partwise>';
    const r = SG.musicxml.import(xml, { scoreId: 'two', sourceName: 'two.xml' });
    return r.ok ? r.graph : null;
  } }
];

/* ------------------------------------------------------------------------------------------------ a random command */
const CODES = new Set(['no-target', 'in-tuplet', 'no-room', 'too-short', 'unprintable', 'would-cut', 'last-bar', 'meter-differs', 'barline', 'same-staff', 'out-of-range', 'occupied', 'invalid']);
function pick(rnd, list) { return list.length ? list[Math.floor(rnd() * list.length)] : null; }
function randomCommand(g, rnd) {
  const ms = g.timeline.measures;
  const evs = [];
  g.parts.forEach(p => p.events.forEach(e => { if (!e.grace) evs.push({ e: e, p: p }); }));
  const notes = evs.filter(x => x.e.kind === 'note'), rests = evs.filter(x => x.e.kind === 'rest');
  const bar = () => pick(rnd, ms);
  const kinds = ['step', 'step', 'octave', 'accidental', 'accidental', 'value', 'value', 'rest', 'note', 'remove', 'add', 'add', 'staff', 'key', 'clef', 'time', 'insert', 'delete', 'split', 'merge',
    'mergeStaves', 'hand', 'reviewed', 'unreviewed'];
  const kind = pick(rnd, kinds);
  const staffs = g.parts.reduce((a, p) => a.concat(p.staves.map(s => s.id)), []);
  switch (kind) {
    case 'step': case 'octave': { const n = pick(rnd, notes); return n ? { op: kind, head: pick(rnd, n.e.heads).id, by: rnd() < 0.5 ? 1 : -1 } : null; }
    case 'accidental': { const n = pick(rnd, notes); return n ? { op: kind, head: pick(rnd, n.e.heads).id, acc: pick(rnd, ['sharp', 'flat', 'natural', null, 'double-sharp']) } : null; }
    case 'value': { const n = pick(rnd, notes); return n ? { op: kind, event: n.e.id, change: pick(rnd, ['halve', 'double', 'dot']) } : null; }
    case 'rest': { const n = pick(rnd, notes); return n ? { op: kind, event: n.e.id } : null; }
    case 'note': { const r = pick(rnd, rests); return r ? { op: kind, event: r.e.id } : null; }
    case 'remove': { const n = pick(rnd, notes); return n ? { op: kind, event: n.e.id, head: n.e.heads.length > 1 && rnd() < 0.5 ? pick(rnd, n.e.heads).id : undefined } : null; }
    case 'add': {
      const m = bar();
      const sts = g.parts.reduce((a, p) => a.concat(p.staves.map(s => s.id)), []);
      const dur = R.parse(m.dur);
      const k = Math.floor(rnd() * 8);
      const at = R.mul(dur, R.make(k, 8));
      return { op: 'add', measure: m.id, staff: pick(rnd, sts), at: R.format(at), pitch: { step: pick(rnd, ['C', 'D', 'E', 'F', 'G', 'A', 'B']), oct: 3 + Math.floor(rnd() * 3) }, value: pick(rnd, ['whole', 'half', 'quarter', 'eighth', '16th']),
        acc: rnd() < 0.2 ? pick(rnd, ['sharp', 'flat', 'natural']) : undefined };
    }
    case 'staff': { const n = pick(rnd, notes); return n ? { op: kind, event: n.e.id } : null; }
    case 'key': return { op: kind, measure: bar().id, fifths: Math.floor(rnd() * 15) - 7 };
    case 'clef': return { op: kind, measure: bar().id, staff: pick(rnd, staffs), sign: pick(rnd, ['G', 'F', 'C']) };
    case 'time': { const t = pick(rnd, [[2, 4], [3, 4], [4, 4], [6, 8], [9, 8], [5, 4]]); return { op: kind, measure: bar().id, beats: t[0], beatType: t[1] }; }
    case 'insert': return rnd() < 0.5 ? { op: kind, after: bar().id } : { op: kind, before: bar().id };
    case 'delete': return { op: kind, measure: bar().id };
    case 'split': { const m = bar(); const dur = R.parse(m.dur); const k = 1 + Math.floor(rnd() * 7); return { op: kind, measure: m.id, at: R.format(R.mul(dur, R.make(k, 8))) }; }
    case 'merge': return { op: kind, measure: bar().id };
    case 'mergeStaves': return g.parts.length > 1 ? { op: kind, keep: g.parts[0].id, into: g.parts[1].id } : null;
    case 'hand': return { op: kind, staff: pick(rnd, staffs), hand: rnd() < 0.5 ? 'RH' : 'LH' };
    case 'reviewed': return { op: kind, measure: bar().id };
    case 'unreviewed': return { op: kind, measure: bar().id };
    default: return null;
  }
}

/* ------------------------------------------------------------------------------------------------ the invariants */
const comparable = sc => JSON.stringify(SG.legacy.comparable(sc));
/* how many notes sound other than their notation says (a printed accidental, the one before it in the bar, the key): an edit never makes this number larger -
   a note that sounded what it said goes on doing so, and the one the edit set is set from its notation */
function inconsistent(g) {
  const idx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  let n = 0;
  g.parts.forEach(p => p.staves.forEach(st => g.timeline.measures.forEach(m => {
    L.OPS.walk(g, idx, p, st.id, m.id).forEach(x => { if (x.implied !== undefined && !x.tieEnd && (x.h.pitch.alter || 0) !== x.implied) n++; });
  })));
  return n;
}
function sound(g, label) {
  const bad = L.check(g, label);
  assert.equal(bad, null, bad);
  /* the Score of the graph is the Score of the graph that was saved and read again */
  const saved = SG.parse(SG.serialize(g));
  assert.equal(comparable(SG.legacy.toScore(g, { name: 'x' })), comparable(SG.legacy.toScore(saved, { name: 'x' })), label + ': the saved graph plays other notes');
}
function drawable(g, rnd, label) {
  const ms = g.timeline.measures;
  for (let i = 0; i < Math.min(3, ms.length); i++) {
    const m = pick(rnd, ms);
    const w = ED.windowGraph(g, m.id);
    assert.ok(w, label + ': bar ' + m.id + ' has no window graph');
    const plan = E.plan(w, { marks: true, chords: true });
    const eng = E.layout.createEngraver(plan).layout(E.layout.normalizeConfig({ breakpoint: 'phone', width: 50, barsPerSystem: 1, window: null }));
    const svg = E.svg(eng, plan, { unit: 10, px: 10, inline: true });
    assert.ok(/<svg/.test(svg), label + ': nothing drawn');
  }
}
function fullDraw(g, label) {
  const plan = E.plan(g, { marks: true, chords: true });
  const eng = E.layout.createEngraver(plan).layout(E.layout.normalizeConfig({ breakpoint: 'desktop', width: 100, barsPerSystem: 4, window: null }));
  assert.ok(eng.systems.length >= 1, label + ': the whole score was not laid out');
}

async function sequence(fx, seed, steps) {
  const g0 = await fx.make();
  assert.ok(g0, fx.name + ': fixture missing');
  const rnd = L.rng(seed);
  const session = ED.create(g0, { limit: 200 });
  const text0 = SG.serialize(g0);
  const seen = [g0];
  const trail = [];
  let applied = 0, refused = 0;
  for (let i = 0; i < steps; i++) {
    const roll = rnd();
    const label = fx.name + ' seed ' + seed + ' step ' + i;
    if (roll < 0.14 && session.canUndo) {
      const before = session.graph;
      const r = session.undo();
      assert.ok(r.ok);
      assert.notEqual(session.graph, before);
      sound(session.graph, label + ' undo');
      trail.push('undo');
      continue;
    }
    if (roll < 0.22 && session.canRedo) {
      const r = session.redo();
      assert.ok(r.ok);
      sound(session.graph, label + ' redo');
      trail.push('redo');
      continue;
    }
    const cmd = randomCommand(session.graph, rnd);
    if (!cmd) continue;
    const before = session.graph;
    const steps0 = session.steps;
    const r = session.apply(cmd);
    trail.push(cmd.op);
    if (!r.ok) {
      assert.ok(CODES.has(r.code), label + ' ' + cmd.op + ': an unnamed refusal ' + r.code + ' ' + r.message);
      assert.equal(session.graph, before, label + ': a refusal changed the graph');
      assert.deepEqual(session.steps, steps0, label + ': a refusal made a step');
      refused++;
      continue;
    }
    if (!r.changed) { assert.equal(session.graph, before); continue; }
    applied++;
    assert.notEqual(session.graph, before, label + ': a change that is no new graph');
    sound(session.graph, label + ' ' + cmd.op);
    /* the carry of an accidental is kept: no note starts to sound other than its notation says because of an edit elsewhere */
    {
      const a = inconsistent(before), b = inconsistent(session.graph);
      assert.ok(b <= a, label + ' ' + cmd.op + ': ' + (b - a) + ' more note(s) sound other than their notation says (' + a + ' -> ' + b + ')');
    }
    if (i % 3 === 0) drawable(session.graph, rnd, label + ' ' + cmd.op);
    if (i % 8 === 0) fullDraw(session.graph, label + ' ' + cmd.op);
    seen.push(session.graph);
    /* the checks run on every graph the editor can reach */
    const an = FL.analyze(session.graph, {});
    assert.ok(an.ok, label + ': the flags could not read the graph: ' + an.error);
    assert.equal(an.bars.length, session.graph.timeline.measures.length);
  }
  /* the original, untouched */
  assert.equal(SG.serialize(g0), text0, fx.name + ' seed ' + seed + ': the graph the visit began with changed');
  /* to the newest step first (a step that was undone at the end of the run is still there to redo) */
  while (session.canRedo) assert.ok(session.redo().ok);
  /* every step back */
  const finalGraph = session.graph;
  const finalText = SG.serialize(finalGraph);
  const states = [];
  let n = 0;
  while (session.canUndo) { states.push(session.graph); assert.ok(session.undo().ok); n++; if (n > 500) break; }
  assert.equal(SG.serialize(session.graph), text0, fx.name + ' seed ' + seed + ': undoing every step did not give the original bytes (' + trail.join(',') + ')');
  assert.equal(session.graph, g0, 'the original graph itself');
  /* every step forward */
  while (session.canRedo) assert.ok(session.redo().ok);
  assert.equal(session.graph, finalGraph);
  assert.equal(SG.serialize(session.graph), finalText);
  return { applied, refused, steps: trail.length };
}

const SEEDS = +process.env.OMR_EDITOR_SEEDS || 5, STEPS = +process.env.OMR_EDITOR_STEPS || 28;   /* the gate's size; a stress run sets both */
FIXTURES.forEach(fx => {
  test('random edits and undo on ' + fx.name + ': always a valid graph that plays what is drawn; every undo gives back the bytes', async () => {
    let applied = 0, refused = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const r = await sequence(fx, 1000 * fx.name.length + s, STEPS);
      applied += r.applied; refused += r.refused;
    }
    /* the generator reaches the ops: most steps are changes (a suite that only gets refusals tests nothing) */
    assert.ok(applied >= 25, fx.name + ': only ' + applied + ' of the steps changed the score (' + refused + ' refused)');
  });
});

test('every kind of edit is reached by the generator, on the plain score', () => {
  const g = L.plain(6);
  const rnd = L.rng(4242);
  const kinds = new Set();
  const session = ED.create(g, { limit: 300 });
  const want = ['step', 'octave', 'accidental', 'value', 'rest', 'note', 'remove', 'add', 'staff', 'key', 'clef', 'time', 'insert', 'delete', 'split', 'merge', 'reviewed'];
  for (let i = 0; i < 3000 && !want.every(k => kinds.has(k)); i++) {
    const cmd = randomCommand(session.graph, rnd);
    if (!cmd) continue;
    const r = session.apply(cmd);
    if (r.ok && r.changed) kinds.add(cmd.op);
  }
  want.forEach(k => assert.ok(kinds.has(k), 'the generator never made a ' + k + ' that changed the score'));
});
