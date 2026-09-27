/* G05 G5a - the playability analyzer's own test suite (node --test; wired as npm run test:playability).
   Three parts: (1) unit checks on reach.js's cited constants, (2) a mutation suite - each hard-violation
   kind planted into an otherwise-clean fixture and confirmed caught, plus a "dead" mutation that changes
   nothing meaningful and must NOT trip the gate (so the suite can't be vacuously green), (3) the R-corpus
   false-positive measurement and the sonatina/020 performance budget (G05 §7). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, PL, mk, corpusFiles, graphOf } = require('./helpers.js');

/* ------------------------------------------------------------- reach.js: cited constants */
test('reach.js: hand-span profiles are the Fingering.SPANS[1-5] figures (App 8347), not invented', () => {
  assert.deepEqual(PL.reach.MAX_SPAN, { small: 10, medium: 12, large: 14 });
  assert.equal(PL.reach.MAX_KEYS, 5);
});

test('reach.js: no time penalty inside a hand\'s own reach; a same-key repeat is unconstrained (soft only)', () => {
  assert.equal(PL.reach.requiredSeconds(7, 12), 0);
  assert.equal(PL.reach.requiredSeconds(12, 12), 0);
  assert.ok(PL.reach.requiredSeconds(24, 12) > 0);
});

/* ------------------------------------------------------------------- mutation suite */
/* Baseline: an easy, unambiguously playable two-hand phrase (RH melody within a fifth, LH within an
   octave, nothing held across a fast passage). Every mutation below starts here and changes exactly one
   thing. */
const CLEAN = { rh: 'C5:q D5:q E5:q F5:q | G5:q F5:q E5:q D5:q', lh: 'C3+G3:h C3+G3:h | C3+G3:h C3+G3:h' };

function report(spec, profile) {
  const g = mk(spec);
  return PL.analyzeGraph(g, { profile: profile || 'medium' });
}

test('mutation suite: the clean baseline has no hard violations', () => {
  const r = report(CLEAN);
  assert.equal(r.totals.hard, 0);
});

test('mutation suite: a dead mutation (a printed dynamic, no notes/timing/hands changed) stays clean', () => {
  /* Same notes, same hands, same timing as CLEAN - only a cosmetic key signature change, which the
     analyzer never reads. If this ever reports a different total, either the analyzer started reading
     something it should not, or a real regression changed its behaviour on unrelated input - the point
     of this fixture is that NOTHING about playability changed, so nothing here may. */
  const before = report(CLEAN);
  const after = report(Object.assign({}, CLEAN, { key: { fifths: 3, mode: 'major' } }));
  assert.deepEqual(after.totals, before.totals);
});

test('mutation suite: a 13th planted in one hand trips SPAN, and only there', () => {
  const before = report(CLEAN);
  assert.equal(before.totals.byCode.SPAN || 0, 0);
  /* LH: C3 to A4 is 19 semitones, a 13th - beyond even the large-hand profile's 14-semitone reach. */
  const mutated = Object.assign({}, CLEAN, { lh: 'C3+A4:h C3+G3:h | C3+G3:h C3+G3:h' });
  const after = report(mutated);
  assert.ok(after.totals.byCode.SPAN >= 1, 'expected a SPAN violation');
  const hit = after.events.find(e => e.hard.some(h => h.code === 'SPAN'));
  assert.equal(hit.limb, 'LH');
  assert.deepEqual(hit.midis.slice().sort((a, b) => a - b), [48, 69]);
});

test('mutation suite: the hand profile genuinely changes the verdict at the reach boundary', () => {
  /* C3 to C#4 is 13 semitones: beyond MAX_SPAN.small (10) and MAX_SPAN.medium (12), but inside
     MAX_SPAN.large (14) - the exact case a single flat threshold could not tell apart. */
  const mutated = Object.assign({}, CLEAN, { lh: 'C3+C#4:h C3+G3:h | C3+G3:h C3+G3:h' });
  assert.ok(report(mutated, 'small').totals.hard >= 1);
  assert.ok(report(mutated, 'medium').totals.hard >= 1);
  assert.equal(report(mutated, 'large').totals.hard, 0);
});

test('mutation suite: 6 simultaneous notes in one hand trips KEYS', () => {
  const before = report(CLEAN);
  assert.equal(before.totals.byCode.KEYS || 0, 0);
  const mutated = Object.assign({}, CLEAN, { rh: 'C5+D5+E5+F5+G5+A5:q D5:q E5:q F5:q | G5:q F5:q E5:q D5:q' });
  const after = report(mutated);
  assert.ok(after.totals.byCode.KEYS >= 1, 'expected a KEYS violation');
  const hit = after.events.find(e => e.hard.some(h => h.code === 'KEYS'));
  assert.equal(hit.limb, 'RH');
  assert.equal(hit.midis.length, 6);
});

test('mutation suite: an impossible same-hand double-strike (held note + a far re-strike) trips SPAN with hold:true', () => {
  /* LH holds G2 for the whole phrase; a second LH voice strikes A5 (33 semitones away) while it is still
     down - a finger already committed to G2 cannot also be at A5. This is the fourth hard violation
     (G05 §3(a): "a hold that cannot be released or re-struck in time... a finger already committed
     elsewhere"), which analyze.js's held-note model (not a plain simultaneous-onset chord) is built to
     catch - see playability/analyze.js's header for why one mechanism serves both. */
  const spec = { rh: 'C5:w | C5:w', lh: 'G2:w | G2:w', lh2: 'r:q A5:q r:h | r:w' };
  const before = PL.analyzeGraph(mk({ rh: 'C5:w | C5:w', lh: 'G2:w | G2:w' }), { profile: 'large' });
  assert.equal(before.totals.hard, 0);
  const after = PL.analyzeGraph(mk(spec), { profile: 'large' });
  const hit = after.events.find(e => e.hard.some(h => h.code === 'SPAN' && h.hold));
  assert.ok(hit, 'expected a held-note SPAN violation');
  assert.equal(hit.limb, 'LH');
});

test('mutation suite: an impossible lateral leap (wide jump, almost no time) trips VELOCITY', () => {
  const before = report(CLEAN);
  assert.equal(before.totals.byCode.VELOCITY || 0, 0);
  /* Two 16th notes a full three octaves apart (36 semitones): far more than a large hand's reach (14),
     and 0.125s at 120 qpm is far less time than PER_SEMITONE_S*(36-14) = 0.264s needs. */
  const mutated = { rh: 'C4:16 C7:16 r:8 r:h. | C5:w', lh: 'C3:w | C3:w' };
  const after = report(mutated, 'large');
  assert.ok(after.totals.byCode.VELOCITY >= 1, 'expected a VELOCITY violation');
});

test('mutation suite: an ordinary fast scale run (small steps, no hand relocation) is not a VELOCITY violation', () => {
  /* The false positive this exact check produced on sonatina/020 before it was corrected (2026-09-28,
     see playability/reach.js's header): single-semitone/step motion within a hand's own reach must never
     need extra travel time, no matter how fast. */
  const mutated = { rh: 'C5:16 D5:16 E5:16 F5:16 G5:16 A5:16 B5:16 C6:16 | C5:w', lh: 'C3:h | C3:w', durs: ['1/2', '1'] };
  const after = report(mutated);
  assert.equal(after.totals.byCode.VELOCITY || 0, 0);
});

/* --------------------------------------------------------- performance (G05 §7) */
test('performance: the longest R-corpus piece (sonatina/020, 1,776 notes) analyzes in <=150ms', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  assert.ok(g, 'sonatina/020.mxl must parse');
  let heads = 0;
  g.parts.forEach(p => p.events.forEach(e => { if (e.kind === 'note') heads += (e.heads || []).length; }));
  assert.equal(heads, 1776, 'sonatina/020.mxl head count (confirms the goal doc\'s figure)');
  const t0 = process.hrtime.bigint();
  PL.analyzeGraph(g, { profile: 'medium' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms <= 150, 'analyze took ' + ms.toFixed(1) + 'ms, over the 150ms budget');
});

/* -------------------------------------------------- R-corpus false positives (G05 §3(d), §5) */
/* tests/engrave/corpus.json is G4a's own "R corpus" (docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md §22.2) -
   reused here rather than defined again, per the goal doc's instruction to reuse G4's corpus definition.
   The false-positive count is NOT asserted to be 0: it measurably is not (see
   docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 for the investigation and the real, named causes - mainly
   the SATB-hymn two-voices-per-staff convention and a handful of individual wide dyads). This is a
   regression gate on the measured baseline (the same shape as G0's known-defects gate,
   tests/bench/README.md "Known production failures"): it fails if the count grows, not if it is nonzero. */
const R_CORPUS_BASELINE = { hard: 68, files: 14 };
test('R corpus: hard-violation false positives match the measured, understood baseline (does not grow)', async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  const files = [];
  corpus.strata.forEach(s => s.files.forEach(f => files.push(f)));
  let hard = 0, withHard = 0;
  for (const rel of files) {
    const g = await graphOf(rel);
    if (!g) continue;
    const r = PL.analyzeGraph(g, { profile: 'medium' });
    if (r.totals.hard > 0) { withHard++; hard += r.totals.hard; }
  }
  assert.ok(hard <= R_CORPUS_BASELINE.hard,
    'R-corpus hard violations grew to ' + hard + ' (baseline ' + R_CORPUS_BASELINE.hard + ') - a real regression, or a new named exception is needed');
  assert.ok(withHard <= R_CORPUS_BASELINE.files,
    'R-corpus files with a hard violation grew to ' + withHard + ' (baseline ' + R_CORPUS_BASELINE.files + ')');
});
