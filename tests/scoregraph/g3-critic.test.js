'use strict';
/* G3 Step 3: the critic catches what a pass may not change (docs/GOALS/G03 §15, A7). Each planted violation is a
   fake pass that declares only what it is allowed to change and then breaks something else. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, codes } = require('./helpers.js');
const { mk } = require('./g3-helpers.js');
const Pro = SG.pro;

/* a fake pass: edit(doc) changes a plain copy; the result is sealed (so it is a valid graph) */
const fake = (name, may, edit) => ({
  name: name, may: may,
  run(g, ctx) {
    const doc = JSON.parse(SG.serialize(g));
    if (edit(doc, ctx) === false) return { graph: g, idMap: {}, changes: [] };
    doc.rev += 1;
    return { graph: SG.seal(doc).graph, idMap: {}, changes: [] };
  }
});
const base = () => mk({ rh: 'C5:q D5:q E5:q F5:q | G5:h r:h', lh: 'C3:w | C3:w', perf: true });
const P = doc => doc.parts[0];
const note = (doc, pitchStep, m) => P(doc).events.find(e => e.kind === 'note' && e.heads[0].pitch.step === pitchStep && (!m || e.m === m));

const PLANTED = [
  ['an onset one tick late', ['pieces'], doc => {
    const c = note(doc, 'C'), d = note(doc, 'D');
    c.dur = '25/96'; d.at = '25/96'; d.dur = '23/96'; }],
  ['a pitch one semitone up', ['spelling'], doc => { note(doc, 'E').heads[0].pitch = { step: 'F', oct: 5 }; }],
  ['a note deleted (made a rest)', ['pieces', 'rests'], doc => { const e = note(doc, 'F'); e.kind = 'rest'; delete e.heads; P(doc).spanners = P(doc).spanners; doc.performances[0].notes = doc.performances[0].notes.filter(n => n.midi !== 77); }],
  ['a measure length', ['pieces', 'rests'], doc => {
    const m2 = doc.timeline.measures[1]; m2.dur = '1/2';
    P(doc).events = P(doc).events.filter(e => !(e.m === m2.id && e.kind === 'rest'));
    doc.parts.forEach(part => part.events.filter(e => e.m === m2.id && e.dur === '1').forEach(e => { e.dur = '1/2'; e.display = { type: 'half' }; })); }],
  ['a tempo', ['pieces'], doc => { doc.timeline.tempos[0].qpm = '100'; }],
  ['a repeat sign', ['pieces'], doc => { doc.timeline.measures[1].barline = { right: { style: 'light-heavy', repeat: 'backward' } }; }],
  ['the performance', ['pieces'], doc => { doc.performances[0].notes[0].vel = 65; }],
  ['an imported slur anchor', ['pieces'], doc => {
    const s = P(doc).spanners.find(x => x.type === 'slur'); s.to = note(doc, 'E').id; }],
  ['a field the pass did not declare (spelling under beams)', ['beams'], doc => { note(doc, 'C').heads[0].pitch = { step: 'B', alter: 1, oct: 4 }; }],
  ['a notated length (tie-merged)', ['pieces', 'rests'], doc => {
    const g5 = note(doc, 'G'); g5.dur = '1/4'; g5.display = { type: 'quarter' };
    const r = P(doc).events.find(e => e.kind === 'rest' && e.m === g5.m && e.staff === g5.staff); r.at = '1/4'; r.dur = '3/4'; r.display = { type: 'half', dots: 1 }; }],
  ['a note moved to another part', ['place', 'pieces', 'rests'], doc => { doc.parts[1].events[0].heads[0].pitch = { step: 'C', oct: 5 }; }],
  ['a key signature', ['beams'], doc => { doc.timeline.keys[0].fifths = 1; }]
];

/* the base graph with a slur (for the slur case) and a second part (for the part case) */
function planted(i) {
  const doc = JSON.parse(SG.serialize(base()));
  const evs = P(doc).events.filter(e => e.kind === 'note' && e.staff === P(doc).staves[0].id);
  P(doc).spanners.push({ id: 's' + doc.nextId++, type: 'slur', from: evs[0].id, to: evs[3].id });
  /* a second part with one whole note, for the part case (its note is the one that "moves": its part's pitch changes
     to one the first part has, so the sound multiset per part differs) */
  const pid = 'p' + doc.nextId++, st = 'st' + doc.nextId++, v = 'v' + doc.nextId++;
  doc.parts.push({ id: pid, name: 'Flute', instrument: { kind: 'flute', family: 'wind' }, staves: [{ id: st }], voices: [{ id: v, staff: st }],
    clefs: [{ id: 'c' + doc.nextId++, staff: st, m: doc.timeline.measures[0].id, at: '0', sign: 'G' }],
    events: doc.timeline.measures.map(m => ({ id: 'e' + doc.nextId++, kind: 'note', m: m.id, at: '0', dur: '1', voice: v, staff: st, display: { type: 'whole' }, heads: [{ id: 'h' + doc.nextId++, pitch: { step: 'A', oct: 5 } }] })),
    directions: [], spanners: [] });
  return SG.seal(doc).graph;
}

test('the critic catches each of the 12 planted violations, and strict mode throws (A7)', () => {
  assert.equal(PLANTED.length, 12);
  PLANTED.forEach(([what, may, edit], i) => {
    const g = planted(i);
    const pass = fake('plant-' + i, may, edit);
    assert.throws(() => Pro.professionalize(g, { strict: true, passList: [pass] }), e => e.code === 'E-G3-CRITIC', what);
    const r = Pro.professionalize(g, { passList: [pass] });
    assert.equal(r.graph, g, what + ': the input comes back');
    assert.ok(r.report.fallback || r.report.rollbacks.length, what + ': reported');
    assert.ok(r.report.issues.some(x => x.code === 'N-G3-ROLLBACK'), what + ': N-G3-ROLLBACK');
  });
});

/* A7b: a one-tick move always leaves a length no value prints (W-DISPLAY-DURATION), so the validation behind the
   critic would catch it even if the fingerprint missed it. An onset a 16th late with the gap a rest prints cleanly:
   only the fingerprint sees it (G03 §20.5 (7); g3-mutation.test.js plants a critic that reads positions to the beat) */
const LATE_16TH = ['an onset a 16th late, every value printable', ['pieces', 'rests'], doc => {
  const d = note(doc, 'D');
  d.at = '5/16'; d.dur = '3/16'; d.display = { type: 'eighth', dots: 1 };
  P(doc).events.push({ id: 'e' + doc.nextId++, kind: 'rest', m: d.m, at: '1/4', dur: '1/16', voice: d.voice, staff: d.staff, display: { type: '16th' } });
}];
test('A7b: an onset moved by a printable value is for the critic alone to catch', () => {
  const [what, may, edit] = LATE_16TH;
  const pass = fake('plant-late-16th', may, edit);
  const g = base();
  assert.deepEqual(codes(SG.validate(pass.run(g, {}).graph).issues, 'WARNING'), {}, 'the planted graph prints cleanly');
  assert.throws(() => Pro.professionalize(g, { strict: true, passList: [pass] }), e => e.code === 'E-G3-CRITIC', what);
});

test('a pass that keeps its promise passes the critic', () => {
  const g = planted(0);
  const ok = fake('ok', ['spelling'], doc => { note(doc, 'C').heads[0].pitch = { step: 'B', alter: 1, oct: 4 }; });
  const r = Pro.professionalize(g, { strict: true, passList: [ok] });
  assert.notEqual(r.graph, g);
  assert.equal(r.report.fallback, false);
});

test('a violation in one measure rolls back that measure only; the rest of the pass stays (§15.3)', () => {
  const g = planted(0);
  /* spells C5 -> B#4 in m1 (allowed) and moves an onset in m2 (not allowed) unless m2 is skipped */
  const mixed = fake('mixed', ['spelling', 'pieces'], (doc, ctx) => {
    note(doc, 'C').heads[0].pitch = { step: 'B', alter: 1, oct: 4 };
    const m2 = doc.timeline.measures[1].id;
    if (!ctx.skip.has(m2)) {
      const gg = note(doc, 'G'); gg.dur = '25/48';
      const r = P(doc).events.find(e => e.kind === 'rest' && e.m === m2 && e.staff === gg.staff); r.at = '25/48'; r.dur = '23/48'; delete r.display;
    }
  });
  const r = Pro.professionalize(g, { passList: [mixed] });
  assert.equal(r.report.fallback, false);
  assert.equal(r.report.rollbacks.length, 1);
  assert.deepEqual(r.report.rollbacks[0].measures, [g.timeline.measures[1].id]);
  assert.equal(r.graph.parts[0].events.find(e => e.kind === 'note' && e.at === '0' && e.m === g.timeline.measures[0].id && e.staff === g.parts[0].staves[0].id).heads[0].pitch.step, 'B');
});

test('a pass that throws gives back the input in production and throws in strict mode', () => {
  const g = base();
  const boom = { name: 'boom', may: [], run() { throw new Error('boom'); } };
  assert.throws(() => Pro.professionalize(g, { strict: true, passList: [boom] }), /boom/);
  const r = Pro.professionalize(g, { passList: [boom] });
  assert.equal(r.graph, g);
  assert.equal(r.report.fallback, true);
});

test('permissions: inferred is rewritten, imported only in fill or force, edited never (§14.1)', () => {
  assert.equal(Pro.right('inferred', 'rewrite'), 'rewrite');
  assert.equal(Pro.right('imported', 'rewrite'), 'none');
  assert.equal(Pro.right('imported', 'fill'), 'fill');
  assert.equal(Pro.right('imported', 'force'), 'rewrite');
  assert.equal(Pro.right('edited', 'force'), 'none');
  assert.equal(Pro.right('repaired', 'force'), 'none');
  assert.equal(Pro.right(undefined, 'rewrite'), 'none');
  const g = mk({ rh: 'C5:w', op: 'imported' });
  const perm = Pro.permission(g, 'rewrite');
  assert.equal(perm.event(g.parts[0], g.parts[0].events[0], 'rhythm'), 'none');
  assert.equal(Pro.permission(mk({ rh: 'C5:w' }), 'rewrite').event(g.parts[0], mk({ rh: 'C5:w' }).parts[0].events[0], 'rhythm'), 'rewrite');
});
