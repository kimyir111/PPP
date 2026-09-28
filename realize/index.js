/* ============================================================================
   PPP Arrangement Realization (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md) — G8a.

   realize(g, sg, plan, opts) -> {ok:true, graph, report} | {ok:false, reason, detail}

   Turns a G7b ArrangementPlan (arrangement/plan.js — a SELECTION of which real voices each
   section keeps and which hand plays them, never a pitch) into an actual two-staff piano
   ScoreGraph: real notes, real durations, real hands, real fingering (playability/fingering.js,
   G5 — called directly, never re-derived, per G08 §6a). Node-only, not loaded by the app
   (G08 §6a/§10).

   ---- Two realization modes, not six independent code paths ----
   The design doc's own pattern-library list ('block chords, broken chords/Alberti, ballad
   arpeggio, hymn 4-part, simple pop comping, waltz') is honoured, but real corpus behaviour
   (checked directly, not assumed - see docs/GOALS/G08 §14) showed only ONE of those six
   names names something structurally different from the other five: 'hymn' is a literal,
   verbatim multi-voice copy (every voice the plan kept, on its own staff/voice, ties
   included) — the natural realization of G7b's 'full'-tier SATB texture, where nothing
   needs inventing. The other five ('block', 'broken', 'ballad', 'pop', 'waltz') all share
   the SAME shape: the plan's declared melody voice is copied verbatim into its assigned
   hand (this is what makes "melody preserved" a real, checkable property — the pitches and
   rhythm are byte-identical to the original), and the OTHER hand is entirely regenerated
   from the section's own real per-beat harmony (songgraph/harmony.js) via
   realize/patterns.js + realize/theory.js's voice-led chord construction — they differ only
   in the RHYTHMIC SHAPE that regeneration takes, exactly as arrange_score.py's `_texture()`
   (read for prior art, not ported - G08 §13) distinguishes its styles by rhythm, not by
   voice selection. This is a real, declared simplification: under a non-'hymn' pattern, a
   'partial'/'full' tier's extra inner voice is not separately preserved - its contribution
   already lives inside the harmony window (computed from the WHOLE piece's real pitch
   content, kept voices included) that drives the regenerated hand. Documented here, not
   hidden — see docs/GOALS/G08 §14 for the real numbers this produced.

   ---- Chord size is capped at 3 (triads), deliberately ----
   Every pattern divides a beat window into at most 4 equal parts (broken/ballad) or plays
   the whole window as one chord (block/waltz) - always a clean power-of-two subdivision of
   a real notated beat, so `realize/notation.js`'s plain noteValue() inverse lookup always
   finds an exact, tuplet-free display for every event this module emits. A 4-note seventh
   chord's extra arpeggiation step (ballad's up-and-back sweep) would need a 6-way split
   (not a power of two) - so v1 always builds 3-note triads (theory.js's targetPcs), the
   seventh's extra tension tone dropped. A real, declared scope limit, not an oversight -
   see docs/GOALS/G08 §14.
   ========================================================================== */
'use strict';
const R = require('../scoregraph/rational.js');
const T = require('../scoregraph/time.js');
const P = require('../scoregraph/pitch.js');
const B = require('../scoregraph/build.js');
const REACH = require('../playability/reach.js');
const FING = require('../playability/fingering.js');
const PAT = require('./patterns.js');
const TH = require('./theory.js');
const NOTATION = require('./notation.js');
const REF = require('../arrangement/reference.js');
const ARRPLAN = require('../arrangement/plan.js'); /* read-only reuse of maxSimultaneous - see hymnHandsReachable below */

const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g8a-realizer', version: '1.0.0' });
const CHORD_SIZE = 3; /* see header: always a triad, never a 7th - keeps every pattern tuplet-free */
const PATTERN_NAMES = ['hymn', 'block', 'broken', 'ballad', 'pop', 'waltz'];

function fail(reason, detail) { return { ok: false, reason: reason, detail: detail || null }; }

/* A real gap found by this module's own tests (docs/GOALS/G08 §14), not assumed: G7b's
   plan-level reach check (arrangement/plan.js's `maxSimultaneous`) samples span only at
   each hand's own distinct onsets, so it can miss a real hard violation that only shows up
   once actual heads exist (a real corpus example: catalog/hymns/for-all-the-saints.musicxml,
   a 'reduced'-texture section where G7b's own register-based hand split puts BOTH the
   melody and bass voice in RH with LH left empty - G7b's plan-level check said RH span 8/14,
   G5's real analyzer found a genuine 15-semitone span at one specific attack). Since this
   is never a pitch change - only which staff/hand plays an already-real voice - the safe,
   always-available fix is real hand REBALANCING: whenever one hand ends up completely idle
   while the other carries two or more real voices, move the lower-register voice across
   before any note is written. This is a general policy (a competent arranger would not
   leave one hand idle while the other juggles two independent lines when redistributing is
   free), not a narrow patch for this one file - see docs/GOALS/G08 §14 for what this
   changed in the real corpus numbers. */
function rebalanceHands(origPart, measureIds, hands) {
  const ms = new Set(measureIds);
  const avgMidi = voiceId => {
    const vals = [];
    origPart.events.forEach(e => {
      if (e.kind === 'note' && !e.grace && e.voice === voiceId && ms.has(e.m)) (e.heads || []).forEach(h => vals.push(P.midi(h.pitch)));
    });
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const out = { RH: hands.RH.slice(), LH: hands.LH.slice() };
  ['RH', 'LH'].forEach(hand => {
    const other = hand === 'RH' ? 'LH' : 'RH';
    if (out[other].length !== 0 || out[hand].length < 2) return;
    const withAvg = out[hand].map(v => ({ v: v, avg: avgMidi(v) })).filter(x => x.avg != null);
    if (withAvg.length < 2) return;
    withAvg.sort((a, b) => a.avg - b.avg);
    const lowest = withAvg[0].v;
    out[hand] = out[hand].filter(v => v !== lowest);
    out[other] = [lowest];
  });
  return out;
}

function stripId(x) { const o = Object.assign({}, x); delete o.id; return o; }

/* The non-'hymn' structural default: a genuinely triple meter (time.groups() gives exactly
   3 pulses a measure) -> 'waltz'; otherwise -> 'block' (always constructible, the same
   "start simple" floor G7b's own texture ladder uses for stage 1). Factored out of
   resolvePattern so the real-span downgrade below (see hymnHandsReachable) can fall back to
   the SAME structural choice a non-'hymn' section would have gotten, not a fixed guess. */
function structuralFallback(g, oldMeasureIdx) {
  try {
    const m = g.timeline.measures[oldMeasureIdx];
    const meter = T.meterAt(g, m.id);
    if (meter && T.groups(meter).length === 3) return 'waltz';
  } catch (e) { /* no meter in force yet - fall through to the safe default */ }
  return 'block';
}

/* Which pattern a section gets. `opts.pattern` (one of PATTERN_NAMES) is honoured directly;
   anything else (including 'auto', the default) is decided from real, structural signal
   only - never a genre guess G7a's output cannot support (arrangement/plan.js's own header,
   "style... has no effect... nothing in G7a's output distinguishes a style"):
     - 3+ real kept voices in a texture ('full'/'partial' on a 3-4 voice part) -> 'hymn'
       (there is real independent-voice content worth preserving verbatim) - UNLESS
       hymnHandsReachable (below) finds this specific voice-to-hand combination for real
       genuinely unplayable, in which case the caller downgrades to structuralFallback.
     - otherwise structuralFallback's own choice. */
function resolvePattern(requested, section, g, oldMeasureIdx) {
  if (requested && requested !== 'auto') return PATTERN_NAMES.indexOf(requested) >= 0 ? requested : 'block';
  const kept = section.hands.RH.length + section.hands.LH.length;
  if (kept >= 3) return 'hymn';
  return structuralFallback(g, oldMeasureIdx);
}

/* ---- a real gap this tuning round found (docs/GOALS/G08 §14), not assumed ----
   'hymn' mode's verbatim multi-voice copy silently trusts that G7b's plan already verified
   this section's hand assignment is reachable. It has NOT, for a real, measured case: G7b's
   own per-section hand split (arrangement/plan.js's planSection) picks RH/LH by each kept
   VOICE's average pitch across the whole section, then checks reach (maxSimultaneous) on the
   resulting hand's own combined notes - correctly, at every real onset (checked directly in
   arrangement/plan.js's source, not assumed: it already handles held notes via songgraph/
   util.js's soundingAt). So why does a real corpus case still slip through? Confirmed
   directly (not guessed) on catalog/method/czerny599/013.mxl: G7b's plan keeps hands
   RH=[v5,v6], LH=[v7] at 'large' profile (MAX_SPAN 14) for a 'full'-texture section, and
   REUSING G7b's own maxSimultaneous (never reimplemented - arrangement/plan.js is read-only
   here, per this doc's own scope rule) on v5+v6's real combined notes measures a real
   17-semitone span at several real onsets (v6's sustained 62/67 dyad ringing under v5's
   melody leaping up to a high G) - i.e. G7b's OWN reach check, run honestly on the SAME
   voices it kept, says this combination is NOT reachable at this profile. The same real
   pattern recurs on catalog/hymns/all-creatures.musicxml (LH=[v7,v8]) and catalog/hymns/
   all-glory-laud.musicxml (LH=[v7,v8], a 'partial' tier this time - kept voice count alone,
   not tier, is what matters). This is NOT the OTHER real gap this doc already documents
   (rebalanceHands, above, for a hand left completely IDLE): here BOTH hands are genuinely in
   use, so onset-sampling the RIGHT hand's own combined notes still finds the real violation -
   the bug is that 'hymn' mode never actually RE-RUNS that check against the specific
   plan.request.handProfile G8a is REALIZING for before trusting it.

   Two real shapes of the fix were tried and MEASURED against the same 16-file harness, not
   assumed - the honest record, including the one that lost:
   - **Per-hand thinning** (drop the offending hand to its single most important real voice,
     verbatim; leave the OTHER, reachable hand fully intact): preserves strictly more real
     NOTE content than a whole-section downgrade, but measured WORSE on harmony agreement
     (root+quality 0.892 vs. 0.929, root-only 0.921 vs. 0.946) at an IDENTICAL hard-violation
     and G6-level-within-±1 outcome. Why: harmonyAgreement re-derives quality from the
     CANDIDATE's own real notes via songgraph/harmony.js's fitChord; a verbatim-but-INCOMPLETE
     real voice set (one real voice quietly missing) reads as a more AMBIGUOUS chord than a
     regenerated accompaniment deliberately voiced (via realize/theory.js, this round's own
     targetPcs fix included) to match the section's real per-beat harmony root+quality as
     closely as a triad can - "more real notes, but the wrong subset" measurably lost to
     "fewer notes, but deliberately harmony-matched" on the metric that matters here. Reverted.
   - **Kept: downgrade the WHOLE section to the SAME non-'hymn' structural choice a <3-kept-
     voice section would already get** (structuralFallback) - the melody voice is still always
     preserved verbatim (that invariant never depends on which pattern a section uses), and the
     OTHER hand is regenerated from the section's own real harmony instead of copied verbatim.
     Never a pitch change to the melody, only which of this doc's own two realization modes a
     section uses when 'hymn' mode's own reach can't be trusted for it. */
function hymnHandsReachable(origPart, hands, measureIds, oldIdx, measureOffset, maxSpan, maxKeys) {
  return ['RH', 'LH'].every(hand => {
    const voiceIds = hands[hand];
    if (voiceIds.length < 2) return true;
    const notes = [];
    const mset = new Set(measureIds);
    origPart.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || voiceIds.indexOf(e.voice) < 0 || !mset.has(e.m)) return;
      const idx = oldIdx.get(e.m);
      const w0 = R.add(measureOffset[idx], R.parse(e.at));
      const w1 = R.add(w0, R.parse(e.dur));
      (e.heads || []).forEach(h => notes.push({ w0: w0, w1: w1, midi: P.midi(h.pitch) }));
    });
    notes.sort((a, b) => R.cmp(a.w0, b.w0) || R.cmp(a.w1, b.w1));
    const sim = ARRPLAN.maxSimultaneous(notes);
    return sim.span <= maxSpan && sim.count <= maxKeys;
  });
}

/* count/subdivision policy by G6 stage - TUNED against arrangement/reference.js's REAL
   per-stage bands (docs/GOALS/G08 §14's tuning round, replacing the original flat "stage<=1
   dyad, stage>=2 always a fixed triad" rule the design doc flagged as worth checking against
   real data rather than a guess). Three rounds were run against the real comparative
   harness (`realize/tools/harness.js`, the same 16-file sample §14's second entry used) -
   the honest round-by-round record, including the one that made things worse, is in
   docs/GOALS/G08 §14; only the shape that survives all three is kept here.

   What the real bands (`REF.bandsForStage`, G6's own anchor corpus) actually show, checked
   directly before writing any rule here:
     stage:               1      2      3      4 (extrapolated from 3, no real stage-4 anchors)
     chordLoad p50:       0      1.09   0.56   0.56
     chordLoad p90:       0      1.83   1.69   1.69
     notesPerBeatLH p50:  0.83   1.00   1.69   1.69

   Two real findings drive the two knobs below, neither obvious in advance:
   1. chordLoad (simultaneous "extra" notes per beat) does NOT climb monotonically with
      stage - stage 3's real p50/p90 are actually LOWER than stage 2's. Round 1 kept `count`
      a flat triad for every stage 2+ (chordLoad's p90 supports a triad at every one of those
      stages, 1.83/1.69/1.69). Round 2 tried sizing `count` from chordLoad's p50 instead (the
      TYPICAL real piece, not its ceiling) - which drops to a dyad at EVERY stage 2+ - and
      MEASURED a real regression (harmony agreement fell from 0.841/0.906 to 0.733/0.788,
      hard-violation rate got worse, and one corpus file's voicing search hit a real
      register-extreme spelling failure that never triggered at a full triad, `sonatina/
      003.mxl` E-SHAPE `oct` out of range). Reverted; `count` for stage 2+ stays a flat
      CHORD_SIZE(3), round 1's shape, real chordLoad p90 evidence behind it unchanged.
   2. notesPerBeatLH (attacks per beat - subdivision, not stack size) very nearly DOUBLES
      from stage 2 to stage 3/4 (ratio vs. stage 1: 1.2x at stage 2, ~2.0x at stage 3/4).
      Real harder pieces get denser by subdividing the beat into more, thinner attacks
      (Alberti/broken figures), not by stacking bigger chords - which also explains finding
      1: an arpeggiated triad plays every real chord tone but never more than one at a time,
      so its OWN chordLoad reads low even though its harmonic content is a full triad. Kept
      from round 1: once a section's real notesPerBeatLH ratio to stage 1 crosses
      SUBDIVIDE_RATIO, an 'auto'-resolved 'block' section subdivides into 'broken' (Alberti)
      instead - never overriding an explicitly requested pattern, and never overriding
      'hymn'/'waltz' (both already real, structurally-decided rhythmic shapes, resolvePattern's
      own job, not this function's).

   Round 3's real finding, ALSO kept: stage 1's floor was a bare dyad (`count: 2`, root+
   fifth) in the original code and in rounds 1-2, on the theory (never itself a data point)
   that a single tone can't carry chord quality and would hurt harmony agreement. Measured
   instead of assumed: dropping the stage-1 floor to a single bass tone (`count: 1`, real
   chordLoad p50/p90 at stage 1 are BOTH 0 - the evidence never supported the dyad) IMPROVED
   every metric that moved: G6 level-within-±1 rose from 9/12 to 10/12 (mean |diff| 0.843 ->
   0.755) and harmony agreement rose too (0.841/0.906 -> 0.894/0.959), not fell - the dyad's
   extra fifth was apparently fighting the preserved melody often enough at stage 1 to read
   as a WORSE harmonic match than a bare root, the opposite of the theory that motivated it.
   Hard violations and melody preservation were unaffected (both already 0-risk/perfect at
   this stage). Kept as this policy's final stage-1 rule. */
const SUBDIVIDE_RATIO = 1.5; /* stage 2's real ratio (~1.2) stays below this; stage 3/4's
  real ratio (~2.0) clears it - see the table above, docs/GOALS/G08 §14. */
const STAGE1_COUNT = 1; /* round 3, see above: measured better than the original dyad floor
  on every metric that moved, not assumed. */

function densityBand(stage) {
  try { return REF.bandsForStage(stage); } catch (e) { return null; }
}

function policyForStage(stage, patternName) {
  if (stage <= 1) return { pattern: 'block', count: STAGE1_COUNT };
  const band = densityBand(stage), base = densityBand(1);
  let pattern = patternName;
  if (patternName === 'block' && band && base && base.notesPerBeatLH.p50 > 0) {
    const ratio = band.notesPerBeatLH.p50 / base.notesPerBeatLH.p50;
    if (ratio >= SUBDIVIDE_RATIO) pattern = 'broken';
  }
  return { pattern: pattern, count: CHORD_SIZE };
}

function copyEventShape(e, newMeasureId, newVoice, newStaff) {
  const x = { kind: e.kind, m: newMeasureId, at: e.at, dur: e.dur, voice: newVoice, staff: newStaff };
  if (e.display) x.display = e.display;
  if (e.grace) x.grace = e.grace;
  return x;
}

/* Copies one original voice's events (in this section's measures only) into the new graph
   verbatim: same pitches, same rhythm, same display, ties reconnected. `headMap` (old head
   id -> new head id) is shared and accumulated across the whole piece by the caller so a
   tie spanning a section boundary still resolves (a tie is a graph-wide spanner, not a
   per-section one). */
function copyVoiceVerbatim(b, part, oldPart, oldVoiceId, measureIds, newMeasureId, newVoiceId, newStaffId, headMap) {
  const mset = new Set(measureIds);
  const evs = oldPart.events.filter(e => e.voice === oldVoiceId && mset.has(e.m));
  evs.sort((a, c) => (measureIds.indexOf(a.m) - measureIds.indexOf(c.m)) || R.cmp(R.parse(a.at), R.parse(c.at)));
  evs.forEach(e => {
    const x = copyEventShape(e, newMeasureId.get(e.m), newVoiceId, newStaffId);
    x.prov = { src: SOURCE_ID.id, op: 'generated' };
    if (e.kind === 'note') x.heads = e.heads.map(h => ({ pitch: h.pitch, prov: { src: SOURCE_ID.id, op: 'generated' } }));
    const ne = b.event(part, x);
    if (e.kind === 'note') e.heads.forEach((h, i) => headMap.set(h.id, ne.heads[i].id));
  });
}

/* A process-wide mutable slot for the current builder's source id, so copyVoiceVerbatim
   (called many times per realize()) doesn't need it threaded through every call - realize()
   sets it once per call, before any copying starts. Safe: realize() is synchronous and this
   module has no other reentrancy. */
let SOURCE_ID = null;

/* Fills, per voice actually used, any measure of the whole piece where that voice has zero
   real coverage with one whole-measure rest - a real gap (§ above: a section can leave a
   hand entirely silent, e.g. a high passage where G7a's own per-section register split puts
   both real voices in the treble staff - a real, observed corpus case, not synthetic; or a
   'hymn' section thinner than the one before it) rather than an invalid, partially-drawn
   measure. */
function fillRests(b, part, voiceId, staffId, oldMeasures, newMeasureId) {
  const evs = part.events.filter(e => e.voice === voiceId);
  const byMeasure = new Map();
  evs.forEach(e => { const k = e.m; if (!byMeasure.has(k)) byMeasure.set(k, []); byMeasure.get(k).push(e); });
  oldMeasures.forEach(m => {
    const nm = newMeasureId.get(m.id);
    const here = byMeasure.get(nm) || [];
    if (here.length) return; /* covered already - every generator in this module fully tiles a measure it touches */
    b.event(part, {
      kind: 'rest', m: nm, at: '0', dur: m.dur, voice: voiceId, staff: staffId,
      display: { type: 'whole', measureRest: true }, prov: { src: SOURCE_ID.id, op: 'generated' }
    });
  });
}

function realize(g, sg, plan, opts) {
  opts = opts || {};
  if (!plan || !plan.sections || !plan.sections.length) return fail('BAD_PLAN', 'plan has no sections');

  const profile = REACH.profileOf(plan.request.handProfile);
  const maxSpan = REACH.MAX_SPAN[profile];

  const b = B.builder({
    id: (g.id || 'sg') + '-g8a', meta: Object.assign({}, g.meta || {}),
    source: Object.assign({}, SOURCE)
  });
  SOURCE_ID = b.doc.provenance.sources[0];
  const prov = () => ({ src: SOURCE_ID.id, op: 'generated' });

  const oldMeasures = g.timeline.measures;
  const oldIdx = new Map(oldMeasures.map((m, i) => [m.id, i]));
  /* songgraph/util.js's beatGrid (and so harmony.js's w0/w1) are ABSOLUTE time positions,
     cumulative from the piece's start - NOT measure-relative the way a ScoreGraph Event's
     own `at` is (checked directly, not assumed: catalog/method/beyer/007.mxl's m8 windows
     start at w0=1, i.e. one whole note in, not 0). `measureOffset[i]` is measure i's own
     absolute start, subtracted below before any harmony-window position becomes an Event's
     `at`. */
  const measureOffset = [];
  { let acc = R.ZERO; oldMeasures.forEach(m => { measureOffset.push(acc); acc = R.add(acc, R.parse(m.dur)); }); }
  const newMeasureId = new Map();
  oldMeasures.forEach(m => newMeasureId.set(m.id, b.measure({ number: m.number, dur: m.dur }).id));
  g.timeline.meters.forEach(mt => b.meter(Object.assign(stripId(mt), { m: newMeasureId.get(mt.m) })));
  g.timeline.keys.forEach(k => b.key(Object.assign(stripId(k), { m: newMeasureId.get(k.m) })));
  /* A TempoEvent's optional `display` can carry a per-part text override (`display[].part`)
     - dropped here (this is a brand-new graph with its own new part ids; the tempo VALUE,
     not its display override, is what "tempo preserved" (G08 §7) is actually about). */
  g.timeline.tempos.forEach(t => { const x = stripId(t); delete x.display; b.tempo(Object.assign(x, { m: newMeasureId.get(t.m) })); });

  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const rhSt = b.staff(part, { limb: 'RH' }), lhSt = b.staff(part, { limb: 'LH' });
  const rhV1 = b.voice(part, { staff: rhSt.id, limb: 'RH', label: '1' });
  const lhV1 = b.voice(part, { staff: lhSt.id, limb: 'LH', label: '5' });
  let rhV2 = null, lhV2 = null;
  const voiceObj = (hand, slot) => {
    if (hand === 'RH') { if (slot === 0) return rhV1; if (!rhV2) rhV2 = b.voice(part, { staff: rhSt.id, limb: 'RH', label: '2' }); return rhV2; }
    if (slot === 0) return lhV1; if (!lhV2) lhV2 = b.voice(part, { staff: lhSt.id, limb: 'LH', label: '6' }); return lhV2;
  };
  b.clef(part, { staff: rhSt.id, m: newMeasureId.get(oldMeasures[0].id), at: '0', sign: 'G' });
  b.clef(part, { staff: lhSt.id, m: newMeasureId.get(oldMeasures[0].id), at: '0', sign: 'F' });

  const origPart = g.parts.find(p => p.id === plan.part);
  if (!origPart) return fail('BAD_PLAN', 'plan.part ' + plan.part + ' not found in graph');

  const harmonyByMeasure = new Map();
  sg.harmony.forEach(w => { if (!harmonyByMeasure.has(w.m)) harmonyByMeasure.set(w.m, []); harmonyByMeasure.get(w.m).push(w); });
  harmonyByMeasure.forEach(list => list.sort((a, c) => R.cmp(a.w0, c.w0)));

  const keyTrack = NOTATION.keyTracker(g);
  const headMap = new Map();
  let prevMidis = null; /* threaded across the WHOLE piece, not reset per section - real
    "voice leading between successive harmony windows" across a section boundary too. */
  const report = { sections: [], patternCounts: {} };

  for (const sec of plan.sections) {
    const i0 = oldIdx.get(sec.section.from), i1 = oldIdx.get(sec.section.to);
    if (i0 === undefined || i1 === undefined || i1 < i0) return fail('BAD_SECTION', sec.section);
    const measureIdxs = []; for (let i = i0; i <= i1; i++) measureIdxs.push(i);
    const measureIds = measureIdxs.map(i => oldMeasures[i].id);

    const basePattern = resolvePattern(opts.pattern, sec, g, i0);
    let policy = policyForStage(plan.stage, basePattern);

    const hands = rebalanceHands(origPart, measureIds, sec.hands);

    /* Real-check 'hymn' mode's own "already-checked reach" assumption (see
       hymnHandsReachable's header above) before trusting it - never assumed, and only ever
       downgrades an 'auto'-resolved 'hymn' choice (an explicit opts.pattern==='hymn' request
       is still honoured verbatim, same as every other explicit pattern request, matching
       `tests/realize/realize.test.js`'s own explicit-hymn fidelity check). */
    if (policy.pattern === 'hymn' && (!opts.pattern || opts.pattern === 'auto') &&
        !hymnHandsReachable(origPart, hands, measureIds, oldIdx, measureOffset, maxSpan, REACH.MAX_KEYS)) {
      policy = policyForStage(plan.stage, structuralFallback(g, i0));
    }
    report.patternCounts[policy.pattern] = (report.patternCounts[policy.pattern] || 0) + 1;

    const melodyVoiceId = sec.melody && sec.melody.voice;
    const melodyHand = melodyVoiceId && hands.RH.indexOf(melodyVoiceId) >= 0 ? 'RH'
      : (melodyVoiceId && hands.LH.indexOf(melodyVoiceId) >= 0 ? 'LH' : 'RH');
    const accompHand = melodyHand === 'RH' ? 'LH' : 'RH';

    if (policy.pattern === 'hymn') {
      ['RH', 'LH'].forEach(hand => {
        const staffId = hand === 'RH' ? rhSt.id : lhSt.id;
        hands[hand].forEach((vid, slot) => {
          const vObj = voiceObj(hand, slot);
          copyVoiceVerbatim(b, part, origPart, vid, measureIds, newMeasureId, vObj.id, staffId, headMap);
        });
      });
      report.sections.push({ label: sec.section.label, pattern: policy.pattern, degraded: sec.degraded, melodyHand: melodyHand });
      continue;
    }

    if (melodyVoiceId) {
      const staffId = melodyHand === 'RH' ? rhSt.id : lhSt.id;
      copyVoiceVerbatim(b, part, origPart, melodyVoiceId, measureIds, newMeasureId, voiceObj(melodyHand, 0).id, staffId, headMap);
    }

    const accompStaffId = accompHand === 'RH' ? rhSt.id : lhSt.id;
    const accompVoiceId = voiceObj(accompHand, 0).id;
    const regBand = accompHand === 'RH' ? sec.voicing.registerRH : sec.voicing.registerLH;
    const anchor = regBand ? Math.round((regBand.lo + regBand.hi) / 2) : (accompHand === 'LH' ? 48 : 72);

    measureIdxs.forEach(mi => {
      const oldM = oldMeasures[mi];
      const windows = harmonyByMeasure.get(oldM.id) || [];
      if (!windows.length) return;
      const r = PAT.run(policy.pattern, windows, prevMidis, { anchor: anchor, count: policy.count, maxSpan: maxSpan });
      prevMidis = r.prevMidis;
      const measureDur = R.parse(oldM.dur);
      r.events.forEach(ev => {
        const at = R.sub(ev.at, measureOffset[mi]); /* absolute -> measure-relative, see above */
        /* A pickup/short measure's own real duration can be shorter than the METER's beat
           grid the harmony window came from (songgraph/util.js's beatGrid sizes windows by
           the meter in force, not this one measure's own possibly-shorter written duration -
           a real, already-documented gap, docs/GOALS/G08 §14). 'hymn' mode never calls this
           loop at all (it only copies real events verbatim), so only a genuine pickup/
           irregular measure triggers it - checked here, not assumed, only since this round's
           own hymnHandsReachable downgrade (above) started routing a few more real sections
           through this generative path (catalog/hymns/all-creatures.musicxml, once downgraded,
           has exactly this pickup-measure shape). Clamp to the measure's own real end; drop an
           event entirely past it, or one whose clamped remainder has no clean notated value -
           never an out-of-bounds Event the validator would reject. */
        let dur = ev.dur, clamped = false;
        if (R.ge(at, measureDur)) return;
        if (R.gt(R.add(at, dur), measureDur)) { dur = R.sub(measureDur, at); clamped = true; }
        const disp = NOTATION.displayFor(dur);
        if (!disp) {
          if (clamped) return;
          throw new Error('G8a: pattern ' + policy.pattern + ' produced a non-notatable duration ' + R.format(dur));
        }
        const heads = ev.midis.map(m => ({ pitch: keyTrack.spellAt(m, mi), prov: prov() }));
        b.event(part, {
          kind: 'note', m: newMeasureId.get(oldM.id), at: R.format(at), dur: R.format(dur),
          voice: accompVoiceId, staff: accompStaffId, display: disp, heads: heads, prov: prov()
        });
      });
    });

    report.sections.push({ label: sec.section.label, pattern: policy.pattern, degraded: sec.degraded, melodyHand: melodyHand });
  }

  /* Ties: one whole-piece pass over the original part's tie spanners, both ends real in
     this realization's headMap (see copyVoiceVerbatim's header - a tie can cross a section
     boundary, so this cannot be done per-section). */
  origPart.spanners.filter(s => s.type === 'tie' && headMap.has(s.from) && headMap.has(s.to))
    .forEach(s => b.spanner(part, { type: 'tie', from: headMap.get(s.from), to: headMap.get(s.to) }));

  [[rhV1, rhSt], [rhV2, rhSt], [lhV1, lhSt], [lhV2, lhSt]].forEach(([v, st]) => { if (v) fillRests(b, part, v.id, st.id, oldMeasures, newMeasureId); });

  let built;
  try { built = b.finish(); } catch (e) { return fail('BUILD_FAILED', String(e && e.message || e)); }

  const fingered = FING.fingerGraph(built.graph, { source: FING.SOURCE });

  return { ok: true, graph: fingered.graph, report: report };
}

module.exports = { realize, resolvePattern, policyForStage, PATTERN_NAMES, CHORD_SIZE, SOURCE };
