/* G9 post-H-8 - the register floor in the realizer (realize/theory.js REGISTER_FLOOR, realize/index.js).

   The H-8 review found G9 arrangements putting the bass far too low. Measured before this change (docs/GOALS/G09 section 12,
   "G9 register floor"): every low note came from the 'pop' and 'waltz' bass, `nearestWithPc(root, anchor - 12)`. These tests pin
   the fix: generated notes are never below E2 (MIDI 40) - moved up whole octaves, pitch classes kept - while notes copied from
   the source are never touched; the floor is a named, overridable constant; a piece whose melody the raised bass would cross is
   left as generated and counted; and the result is deterministic and idempotent. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));
const PLA = require(path.join(REPO, 'playability/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const RF = require(path.join(REPO, 'critics/register-floor.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

/* the H-8 packet's own requests for the pieces whose bass was worst */
const REQ = {
  sonatina025: { file: 'catalog/method/sonatina/025.mxl', targetLevel: 3.4 },
  passMeNot: { file: 'catalog/hymns/pass-me-not.musicxml', targetLevel: 3.87 },
  burgmuller016: { file: 'catalog/method/burgmuller25/016.mxl', targetLevel: 3.9 },
  burgmuller019: { file: 'catalog/method/burgmuller25/019.mxl', targetLevel: 3.1 }
};
async function planOf(r) {
  const g = await H.graphOf(r.file);
  const sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: r.targetLevel, handProfile: 'large', sections: 'all' });
  assert.ok(p.ok, r.file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan, source: M.graphNoteList(g) };
}
const floorOf = (graph, source, floor) => RF.registerFloor(graph, { sourceNotes: source, floor: floor });
const lowest = g => Math.min.apply(null, U.noteWindows(g).map(n => n.midi));
/* the pitch-class set of every (voice, onset) attack: equal before and after a floor means no pitch class was lost or invented */
function attacks(g) {
  const m = new Map();
  U.noteWindows(g).forEach(n => { const k = n.voiceId + '@' + R.format(n.w0); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(n.pc); });
  return Array.from(m.entries()).map(([k, s]) => k.split('@')[1] + ':' + Array.from(s).sort((a, b) => a - b).join(',')).sort();
}

/* ---------------------------------------------------------------- the constant and floorMidis */
test('REGISTER_FLOOR is E2 (MIDI 40), a named constant the critic and repair read too', () => {
  assert.equal(TH.REGISTER_FLOOR, 40);
  assert.equal(RF.FLOOR_DEFAULT, TH.REGISTER_FLOOR);
});

test('floorMidis: a low note moves up whole octaves to the first pitch at or above the floor, pitch class kept', () => {
  [[36, 48], [30, 42], [39, 51], [24, 48], [25, 49], [40, 40], [41, 41], [12, 48]].forEach(([from, to]) => {
    const r = TH.floorMidis([from], 40, 14);
    assert.deepEqual(r.midis, [to], 'from ' + from);
    assert.equal(((r.midis[0] - from) % 12 + 12) % 12, 0, 'pitch class kept for ' + from);
    assert.ok(r.midis[0] >= 40);
  });
});

test('floorMidis: an event already at or above the floor comes back as the same array; floor null is a no-op', () => {
  const ev = [40, 47, 52];
  assert.equal(TH.floorMidis(ev, 40, 14).midis, ev);
  assert.equal(TH.floorMidis([20, 30], null, 14).midis.join(), '20,30');
});

test('floorMidis: a chord is raised note by note (an inversion); a note landing on an existing one is merged, not doubled', () => {
  assert.deepEqual(TH.floorMidis([36, 43, 52], 40, 14).midis, [48, 43, 52]);
  const m = TH.floorMidis([38, 45, 50], 40, 14); /* 38 -> 50, the pitch the chord already has */
  assert.deepEqual(m.midis, [50, 45]);
  assert.equal(m.merged, 1);
  assert.equal(new Set(m.midis).size, m.midis.length, 'no duplicate pitch in one event');
  assert.deepEqual(new Set(m.midis.map(x => x % 12)), new Set([38, 45, 50].map(x => x % 12)), 'pitch classes kept');
});

test('floorMidis: when raising the low note alone would break the span, the whole event moves up instead (intervals kept)', () => {
  /* [38, 41, 46] spans 8; raising 38 alone gives 41..50 = 9 > 8, so all three go up an octave together: 50, 53, 58 */
  const r = TH.floorMidis([38, 41, 46], 40, 8);
  assert.equal(r.shifted, true);
  assert.deepEqual(r.midis, [50, 53, 58]);
  assert.equal(r.midis[2] - r.midis[0], 46 - 38, 'span unchanged');
});

test('floorMidis: deterministic and idempotent (a floored event floored again is unchanged)', () => {
  [[[30]], [[36, 43, 52]], [[38, 41, 46], 8], [[25, 37, 49]], [[60, 64]]].forEach(([midis, span]) => {
    const a = TH.floorMidis(midis, 40, span || 14), b = TH.floorMidis(midis, 40, span || 14);
    assert.deepEqual(a, b);
    const again = TH.floorMidis(a.midis, 40, span || 14);
    assert.equal(again.midis, a.midis, 'a floored event is already at the floor: the very same array comes back');
    assert.equal(again.raised, 0);
  });
});

/* ---------------------------------------------------------------- the realizer, on the pieces H-8 flagged */
test('realize: with the floor (default) no arranged note is below E2, under every pattern; without it the pop bass is', async () => {
  const f = await planOf(REQ.sonatina025);
  let anyOffBelow = false;
  for (const pattern of ['auto', 'block', 'broken', 'ballad', 'pop', 'waltz']) {
    /* leftShape: false: the last-defect-round chord shaping re-places arpeggio chords by the floor too (tests/realize/last-defects.test.js),
       so the floor's own "never changes a pitch class or an onset" is checked without it, exactly as before that round */
    const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern, leftShape: false });
    const off = REALIZE.realize(f.g, f.sg, f.plan, { pattern, registerFloor: null, leftShape: false });
    assert.ok(on.ok && off.ok, pattern);
    assert.equal(floorOf(on.graph, f.source).below, 0, pattern + ': no arranged note below the floor');
    assert.equal(on.report.floor.floor, 40);
    assert.equal(off.report.floor.floor, null);
    if (floorOf(off.graph, f.source).below > 0) anyOffBelow = true;
    /* the raise never changes a pitch class or an onset */
    assert.deepEqual(attacks(on.graph), attacks(off.graph), pattern + ': same attacks, same pitch classes');
    assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(on.graph)), 1, pattern + ': melody untouched');
    assert.equal(PLA.analyzeGraph(on.graph, { profile: 'large' }).totals.hard, 0, pattern + ': the floor adds no hard violation');
  }
  assert.ok(anyOffBelow, 'fixture assumption: the unfloored realizer really does put arranged notes below E2 here (the H-8 defect)');
  /* the old ('wide') stride geometry leaves the floor to raise notes afterwards; the close geometry (the default since the
     left-hand-jump fix) places its bass at or above the floor itself, so the post-hoc raise has nothing left to do */
  const wide = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'pop', stride: 'wide' });
  assert.ok(wide.report.floor.notesRaised > 0 && wide.report.floor.eventsRaised > 0, 'the report counts what was raised');
  assert.ok(lowest(wide.graph) >= 40);
  const pop = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'pop' });
  assert.equal(pop.report.floor.notesRaised, 0, 'close stride: the bass is placed above the floor, nothing to raise');
  assert.ok(lowest(pop.graph) >= 40);
});

test('realize: a piece that goes lower itself keeps its own low notes exactly as written (source notes are never floored)', async () => {
  const f = await planOf(REQ.burgmuller019); /* the source goes down to MIDI 25 */
  assert.equal(lowest(f.g), 25, 'fixture assumption');
  /* 'hymn' copies the source voices verbatim: the floor must change nothing at all, not even at an absurd floor */
  const on = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn' });
  const off = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', registerFloor: null });
  const high = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'hymn', registerFloor: 100 });
  assert.equal(SER.fingerprint(on.graph), SER.fingerprint(off.graph));
  assert.equal(SER.fingerprint(high.graph), SER.fingerprint(off.graph), 'source voices are copied verbatim at any floor');
  assert.equal(lowest(on.graph), 25);
  const c = floorOf(on.graph, f.source);
  assert.equal(c.below, 0, 'none of the low notes is an arranged one');
  assert.ok(c.belowSource > 0, 'they are reported as source notes');
  /* and the copied melody voice of a generated pattern stays at any floor */
  const blk = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block', registerFloor: 100 });
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(blk.graph)), 1);
});

test('realize: the floor is overridable - a lower floor changes fewer notes, null changes none', async () => {
  const f = await planOf(REQ.passMeNot);
  const at = n => REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'pop', stride: 'wide', registerFloor: n }); /* wide: the floor does the raising */
  const off = at(null), f36 = at(36), f40 = at(40);
  assert.ok(floorOf(off.graph, f.source, 40).below > 0);
  assert.equal(floorOf(f36.graph, f.source, 36).below, 0);
  assert.equal(floorOf(f40.graph, f.source, 40).below, 0);
  assert.ok(f36.report.floor.notesRaised < f40.report.floor.notesRaised);
  assert.equal(off.report.floor.notesRaised, 0);
});

test('realize: graceful degradation - a raise that would put the bass at or above the melody is skipped and counted, still valid', async () => {
  const f = await planOf(REQ.sonatina025);
  /* an absurdly high floor forces every raised bass past the right hand's melody */
  const r = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'pop', stride: 'wide', registerFloor: 84 });
  assert.ok(r.ok);
  assert.ok(r.report.floor.eventsDegraded > 0, 'some events could not be raised without crossing the melody');
  assert.ok(r.report.floor.notesDegraded > 0);
  assert.ok(floorOf(r.graph, f.source, 84).below > 0, 'they stay as generated');
  assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(r.graph)), 1);
  /* and at the real floor nothing is degraded on this piece */
  const real = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'pop', stride: 'wide' });
  assert.equal(real.report.floor.eventsDegraded, 0);
});

test('realize: deterministic (same inputs, byte-identical graph and report), and the floored result satisfies its own floor', async () => {
  const f = await planOf(REQ.burgmuller016);
  const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'waltz' }), b = REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'waltz' });
  assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph));
  assert.deepEqual(a.report, b.report);
  /* every arranged note of the floored realization is at or above the floor */
  assert.equal(floorOf(a.graph, f.source).below, 0);
  const notes = U.noteWindows(a.graph).filter(n => !f.source.some(s => s.midi === n.midi && Math.abs(s.onsetQ - R.toNumber(n.w0) * 4) < 1e-6));
  notes.forEach(n => assert.ok(n.midi >= 40));
});
