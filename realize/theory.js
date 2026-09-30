/* ============================================================================
   PPP Arrangement Realization — chord theory + voice leading (docs/GOALS/G08 — G8a).

   Turns a songgraph/harmony.js window ({root: 0-11 pc, quality}) into real MIDI pitches for
   an accompaniment hand, and keeps successive chords smoothly voice-led (G08 §6a: "voice
   leading between successive harmony windows, not per-window re-randomized voicings").

   Not a port of arrange_score.py's _texture() (docs/GOALS/G08 §13 - that code has no
   playability awareness beyond a crude simultaneous-note cap); this module is graph/G5-aware:
   callers are expected to check the result against playability/reach.js's real MAX_SPAN
   before accepting a voicing (realize/patterns.js does this).

   G8b note (docs/GOALS/G08B_LEGACY_RETIREMENT.md): this module has no internal `require()`
   calls (no dependencies), so the UMD wrapper below is a pure packaging change needed to
   let the app load it via <script> - no logic below this point was touched.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRealizeModules = root.PPPRealizeModules || {}; M.theory = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

/* Interval sets (semitones from root), matching every quality songgraph/harmony.js's
   fitChord can return (its 9 candidate qualities). An unknown/null quality falls back to a
   bare major triad rather than throwing - a silent harmony window (root===null) is the
   caller's job to skip, not this module's. */
const CHORD_INTERVALS = Object.freeze({
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9]
});

function intervalsFor(quality) { return CHORD_INTERVALS[quality] || CHORD_INTERVALS.maj; }

/* The `count` pitch classes a chord voicing of this size uses.
   ---- Real gap this tuning round found (docs/GOALS/G08 §14), not assumed ----
   For a 4-tone quality (a 7th chord - dom7/maj7/min7/m7b5/dim7), the original code just took
   `ivs[0..count-1]` - for the CHORD_SIZE=3 triad-cap this module always requests (see
   realize/index.js's header on why chord size is capped at 3), that is root+3rd+5th EVERY
   time: the 7th - the one tone that actually DISTINGUISHES a 7th chord's quality from a
   bare triad - was silently dropped on every accompaniment voicing, regardless of what the
   real harmony window asked for. This is checked, not theorized, against
   songgraph/harmony.js's own real `fitChord`: it re-derives quality from a duration-weighted
   pitch-class histogram with a per-extra-tone SIZE_BIAS (a triad needs a 4th tone's real
   weight to beat a plain-triad reading) - a candidate that never sounds the 7th at all can
   therefore never be re-identified as a 7th chord, which is exactly the "root matches, but
   quality doesn't" gap docs/GOALS/G08 §14 measured against `ScoreArranger` (root-only was
   already strong; root+quality was not). The 5th is real tonal-harmony practice's most
   dispensable chord tone (routinely omitted in genuine voicings - a 7th chord's quality is
   fully implied by root+3rd+7th alone, same as a triad's is by root+3rd); swapping it for
   the 7th when `count` is capped below the chord's own real tone count keeps every existing
   invariant (still `count` REAL chord tones, never an invented pitch class, no notation/
   subdivision change) while giving the re-analysis something real to detect the seventh
   from. Doubling only still applies once `count` exceeds the chord's own real tone count
   (unchanged from the original code - a 4th voice on a triad doubles the root; this module
   never actually requests that today, CHORD_SIZE/STAGE1_COUNT are always <= the chord's own
   size, but the fallback is kept for any future caller that does). */
function targetPcs(root, quality, count) {
  const ivs = intervalsFor(quality);
  let order = ivs;
  if (ivs.length === 4 && count === 3) order = [ivs[0], ivs[1], ivs[3]]; /* root, 3rd, 7th - drop the 5th, not the 7th */
  const pcs = order.map(i => ((root + i) % 12 + 12) % 12);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pcs[i % pcs.length]);
  return out;
}

/* The MIDI note >= floor (or <= ceil, if given) with pitch-class pc, nearest to `near`. */
function nearestWithPc(pc, near, opts) {
  opts = opts || {};
  const base = near - ((near % 12) - pc + 12) % 12; /* <= near, same pc */
  const candidates = [base, base + 12];
  if (opts.lo !== undefined) { while (candidates[0] < opts.lo) { candidates[0] += 12; candidates[1] += 12; } }
  let best = candidates[0], bestD = Math.abs(candidates[0] - near);
  candidates.forEach(c => { const d = Math.abs(c - near); if (d < bestD) { best = c; bestD = d; } });
  return best;
}

/* A fresh close-position voicing (no previous chord to lead from): `count` chord tones,
   root-first, stacked upward from `anchor` (typically the section's own register midpoint -
   see realize/patterns.js), each subsequent tone the nearest instance of its pitch class
   at or above the one before it (so the voicing never spans more than an octave-ish between
   adjacent tones, a genuine "close position" construction, not an arbitrary spread). */
function freshVoicing(root, quality, count, anchor) {
  const pcs = targetPcs(root, quality, count);
  const out = [nearestWithPc(pcs[0], anchor)];
  for (let i = 1; i < pcs.length; i++) {
    const prev = out[i - 1];
    let m = prev + ((pcs[i] - prev % 12) + 12) % 12;
    if (m === prev) m += 12; /* a doubled tone always sits an octave above its twin */
    out.push(m);
  }
  return out;
}

/* ---- register floor (G9 post-H-8, docs/GOALS/G09 section 12 "G9 register floor") ----
   REGISTER_FLOOR is the lowest MIDI note the realizer will GENERATE (E2 = 40; the bottom line of the bass
   staff is G2 = 43, so E2 is already two ledger lines under it). It comes from the user's first blind human
   review (H-8, 2026-09-30): G9 arrangements the reviewer marked "awkward hand position" had a lowest note of
   MIDI 34 on average and 24.9 notes below E2 (unflagged: 39 and 6.1); the reviewer called those bass notes
   "too low" and they are hard to read on many ledger lines. Nothing before this constant had a register floor
   (G5's hard violations are about hand span). It applies to notes the realizer GENERATES only; notes copied
   from the source piece are kept exactly as written, however low. Overridable: `realize(..., {registerFloor:
   n})`, `null` turns it off; `critics/register-floor.js` and `repair/` read the same constant. */
const REGISTER_FLOOR = 40;

/* C3 (MIDI 48): below it a second or third between two sounding notes reads as a muddy cluster (critics/low-register-cluster.js;
   the 'open' stride geometry keeps the chord's tones at or above it when its bass is below it). */
const CLUSTER_BELOW = 48;

/* One generated event's pitches, with everything below `floor` moved UP by whole octaves (so every pitch
   class is kept). Order: (1) each low pitch is raised on its own (an inversion; a pitch that lands on one the
   event already has is merged into it - the same key, so no pitch class is lost); (2) if that pushes the
   event past `maxSpan` (G5's reach for the hand profile) the WHOLE event is instead shifted up by the fewest
   octaves that clear the floor (intervals and span unchanged). Returns {midis, raised, merged, shifted}; an
   event already at or above the floor comes back untouched (same array). */
function floorMidis(midis, floor, maxSpan) {
  if (floor == null || !midis.some(m => m < floor)) return { midis: midis, raised: 0, merged: 0, shifted: false };
  const out = [];
  let raised = 0, merged = 0;
  midis.forEach(m => {
    let v = m;
    if (v < floor) { v += 12 * Math.ceil((floor - v) / 12); raised++; }
    if (out.indexOf(v) >= 0) { merged++; return; }
    out.push(v);
  });
  const span = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  if (maxSpan == null || span(out) <= maxSpan) return { midis: out, raised: raised, merged: merged, shifted: false };
  const up = 12 * Math.ceil((floor - Math.min.apply(null, midis)) / 12);
  return { midis: midis.map(m => m + up), raised: midis.length, merged: 0, shifted: true };
}

/* A chord voiced CLOSE ABOVE a bass note (the stride / oom-pah geometry, docs/GOALS/G09 section 12 "G9 left-hand jumps"):
   each of the chord's pitch classes at its single MIDI instance in (bass, bass + 12], sorted ascending. Every pitch class
   occurs exactly once in an octave window, so the voicing is fixed by the bass note and the pitch classes: the lowest chord
   note is 1..11 above the bass (3..9 for a triad whose root or fifth is the bass) and the top is at most an octave above it
   (a chord tone that is the bass's own pitch class sits exactly at bass + 12). A repeated pitch class collapses to one note. */
function foldAbove(bass, pcs) {
  const out = [];
  pcs.forEach(pc => {
    const up = (((pc - bass) % 12) + 12) % 12;
    const m = bass + (up === 0 ? 12 : up);
    if (out.indexOf(m) < 0) out.push(m);
  });
  return out.sort((a, b) => a - b);
}

/* ---- last G9 defect round (docs/GOALS/G09 section 12 "G9 last defect round"): chord thickness and register of the accompaniment ----
   Three named limits, all from the user's blind reviews and two blind AI teacher judges (beyer/061 and beyer/020: left-hand block chords of
   3 notes on every beat with a close second below middle C and a chord top at E4 or above, which draws an 8va over the bass staff).
   STACK_MAX_BY_STAGE: the most notes one block chord may stack per onset, by G6 stage (1 first steps ... 4 upper intermediate). Stage 1 is one
   note (realize/index.js STAGE1_COUNT already); stages 2, 3 and 4 a triad. A first version of this round capped stage 2 at a dyad (root and
   fifth); measured, it dropped the third and lost harmony agreement on the fully sounded SATB hymns (all-creatures 0.853 to 0.794, all-glory-laud
   0.931 to 0.806, christ-arose 0.975 to 0.813, god-rest-ye-merry 0.975 to 0.800; docs/GOALS/G09 section 12), so the triad is back and the
   thickness is fixed by register instead (LH_CHORD_TOP, no seconds). A window whose triad cannot be placed legally falls back to the dyad
   for that window only (patterns.js shapeChord). The cap applies to a STACK only: broken and ballad sound one note at a time.
   LH_CHORD_TOP: the highest note a left-hand accompaniment chord may have (middle C, the first ledger line above the bass staff): above it a
   bass-clef chord needs two ledger lines or an 8va (TD16 draws one), which the reviewers called confusing.
   SECOND_BELOW: no two left-hand notes of one chord a second apart (1 or 2 semitones) when the lower one is under middle C; the existing
   CLUSTER_BELOW also keeps a third apart out below C3 (the same low-register-cluster rule critics/low-register-cluster.js measures). */
const STACK_MAX_BY_STAGE = Object.freeze({ 1: 1, 2: 3, 3: 3, 4: 3 });
const LH_CHORD_TOP = 60;
const SECOND_BELOW = 60;

function maxStackForStage(stage) { return STACK_MAX_BY_STAGE[stage] != null ? STACK_MAX_BY_STAGE[stage] : (stage > 4 ? 3 : 1); }

/* rank of a chord tone by its pitch class above the chord root: root 0, fifth (dim, perfect or augmented) 1, third 2, seventh and anything else 3 */
function roleRank(pc, root) {
  const d = (((pc - root) % 12) + 12) % 12;
  if (d === 0) return 0;
  if (d === 6 || d === 7 || d === 8) return 1;
  if (d === 3 || d === 4) return 2;
  return 3;
}

/* `midis` (one chord of `root`) thinned to at most `maxNotes` notes: the root is kept first, then the fifth, then the third, then the
   seventh; among notes of one rank (a doubled tone) the lower is kept. Returned ascending. A chord already within the cap comes back
   as the same array. */
function thinChord(midis, root, maxNotes) {
  if (maxNotes == null || midis.length <= maxNotes) return midis;
  const order = midis.map((m, i) => ({ m: m, rank: roleRank(((m % 12) + 12) % 12, root) })).sort((a, b) => a.rank - b.rank || a.m - b.m);
  /* a distinct pitch class beats a doubling: doubles sort after the first instance of their pitch class */
  const seen = new Set(), firsts = [], dups = [];
  order.forEach(o => { const pc = ((o.m % 12) + 12) % 12; if (seen.has(pc)) dups.push(o); else { seen.add(pc); firsts.push(o); } });
  return firsts.concat(dups).slice(0, maxNotes).map(o => o.m).sort((a, b) => a - b);
}

/* Is this chord fully legal for the accompaniment hand (what settleChord looks for): within `maxSpan`, no cluster pair (unless
   `opts.cluster === false`), top at or under `top`, lowest at or over `floor`? */
function chordLegal(midis, opts) {
  opts = opts || {};
  const s = midis.slice().sort((a, b) => a - b);
  if (opts.maxSpan != null && s[s.length - 1] - s[0] > opts.maxSpan) return false;
  if (opts.cluster !== false && clusterPairs(s, opts.secondBelow) > 0) return false;
  if (opts.top != null && s[s.length - 1] > opts.top) return false;
  if (opts.floor != null && s[0] < opts.floor) return false;
  return true;
}

/* How many of a chord's simultaneous pairs are a cluster for a left hand: a second (<= 2 semitones) whose lower note is under
   SECOND_BELOW, or a third (<= 4) whose lower note is under CLUSTER_BELOW. */
function clusterPairs(midis, secondBelow) {
  const sb = secondBelow == null ? SECOND_BELOW : secondBelow; /* the clash guard passes 128 (a second anywhere) at stages 1-3 */
  const s = midis.slice().sort((a, b) => a - b);
  let n = 0;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const d = s[j] - s[i];
    if (d <= 0) continue;
    if ((d <= 2 && s[i] < sb) || (d <= 4 && s[i] < CLUSTER_BELOW)) n++;
  }
  return n;
}

/* One left-hand chord's pitches re-placed by whole octaves (every pitch class kept, the notes' number unchanged) so that it has no cluster
   (clusterPairs; `opts.cluster === false` skips that test, for an arpeggio, whose notes do not sound together), its top is at or under `top`, it is within `maxSpan` and its lowest note is at or over `floor`. Candidates are ranked by,
   in order: the span being over `maxSpan`; the number of cluster pairs; how far the top is over `top` (plus how far the lowest is under
   `floor`); a bass leap of an octave or more from `prev` (the chord written just before, when there is one: the left-hand jump the reviewers
   flagged); then the distance of its lowest and highest notes from `prev` (or, with no `prev`, the sum of semitone distances between the
   sorted notes and the placement given). A chord that already satisfies all of the above is kept exactly as voice-led (measured: re-placing legal chords by `prev`
   cost harmony agreement on the SATB hymns and gained nothing on jumps); `prev` only chooses among the placements of a chord that had to move. Deterministic. Not exactly idempotent when no placement is fully legal (it then returns the best of the same search). */
function settleChord(midis, opts) {
  opts = opts || {};
  const floor = opts.floor == null ? 0 : opts.floor, top = opts.top == null ? 127 : opts.top, maxSpan = opts.maxSpan == null ? 127 : opts.maxSpan;
  const prev = opts.prev && opts.prev.length ? opts.prev.slice().sort((a, b) => a - b) : null;
  const spanOf = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  const cost = a => {
    const s = a.slice().sort((x, y) => x - y);
    return [spanOf(s) > maxSpan ? 1 : 0, opts.cluster === false ? 0 : clusterPairs(s, opts.secondBelow), Math.max(0, s[s.length - 1] - top) + Math.max(0, floor - s[0])];
  };
  const base = midis.slice().sort((a, b) => a - b);
  const c0 = cost(base);
  if (c0[0] === 0 && c0[1] === 0 && c0[2] === 0) return midis;
  /* every note at every octave placement between floor-12 and top+12 */
  const choices = base.map(m => {
    const pc = ((m % 12) + 12) % 12, out = [];
    for (let v = pc; v <= 127; v += 12) if (v >= floor - 12 && v <= top + 12) out.push(v);
    return out.length ? out : [m];
  });
  const lexLess = (x, y) => { for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k]; return false; };
  const moveOf = a => prev
    ? Math.abs(a[0] - prev[0]) + Math.abs(a[a.length - 1] - prev[prev.length - 1])
    : a.reduce((t, v, k) => t + Math.abs(v - base[k]), 0);
  let best = null, bestKey = null;
  const pick = [];
  (function rec(i) {
    if (i === choices.length) {
      const a = pick.slice().sort((x, y) => x - y);
      if (a.some((v, k) => k && v === a[k - 1])) return; /* two notes on one key: not a chord of this size */
      const c = cost(a);
      const leap = prev && Math.abs(a[0] - prev[0]) >= 12 ? 1 : 0;
      const key = c.concat([leap, moveOf(a), a.reduce((t, v, k) => t + Math.abs(v - base[k]), 0), a[0]]);
      if (!bestKey || lexLess(key, bestKey)) { best = a; bestKey = key; }
      return;
    }
    choices[i].forEach(v => { pick[i] = v; rec(i + 1); });
  })(0);
  if (!best) return midis;
  return !prev && best.every((v, k) => v === base[k]) ? midis : best;
}

/* ---- chromatic harmony at low stages (docs/GOALS/G09 section 12 "G9 last defect round") ----
   songgraph/harmony.js (G7a) names a chord for every beat window from the pitch classes SOUNDING in it. On a thin window (two notes, or one)
   several chords fit equally and the bass tie-break picks one by its root: beyer/020 has C (melody) over E (left hand) on beats 1 and 3, and G7a
   reads E augmented (E G# C) there, not C major; the realizer then wrote the G# the source never has (E-G#-C, then E-G-C on the next beat: a
   sharp and a natural alternating under a plain C-major melody). DIATONIC_MAX_STAGE: at stages 1 and 2 (first steps, elementary) a chord with
   a tone outside the key that the SOURCE does not itself sound in that window is replaced by a diatonic chord (every tone in the key's own
   set); stage 3 and 4 students read accidentals and keep the inferred chord. */
const DIATONIC_MAX_STAGE = 2;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_WITH_LEADING_TONE = [0, 2, 3, 5, 7, 8, 10, 11]; /* natural minor plus the raised seventh every minor key's V uses */
const SUBSTITUTE_QUALITIES = Object.freeze(['maj', 'min', 'dim', 'dom7']); /* in preference order, triads before the seventh */
const DEGREE_PREFERENCE = Object.freeze({ 0: 0, 7: 1, 5: 2, 9: 3, 2: 4, 4: 5, 11: 6 }); /* semitones above the tonic: I V IV vi ii iii vii, anything else after */

/* The key's pitch-class set (written key signature) and tonic. */
function keyPcs(fifths, mode) {
  const minor = mode === 'minor';
  const tonic = ((((7 * (fifths || 0)) % 12) + 12) % 12 + (minor ? 9 : 0)) % 12;
  return { tonic: tonic, set: new Set((minor ? MINOR_SCALE_WITH_LEADING_TONE : MAJOR_SCALE).map(iv => (tonic + iv) % 12)) };
}

/* The pitch classes of a chord as it will actually sound: its `count` tones (targetPcs), thinned to `stackMax` by thinChord. */
function playedPcs(root, quality, count, stackMax) {
  const distinct = [];
  targetPcs(root, quality, count).forEach(pc => { if (distinct.indexOf(pc) < 0) distinct.push(pc); });
  return stackMax == null ? distinct : thinChord(distinct, root, stackMax);
}

/* The diatonic chord {root, quality} to play in place of a chord that has a tone outside the key which the source does not sound
   (`srcPcs`, an array of the pitch classes the source sounds in the window), or null when the chord is fine as it is. The candidates are
   every maj/min/dim triad and dom7 whose tones are all in the key. Ranking: (1) most of the source's own pitch classes covered; (2) holds the
   inferred root (the bass stays sensible); (3) shares most tones with the inferred chord; (4) I V IV vi ii iii vii; (5) triad before seventh. */
function diatonicSubstitute(root, quality, played, key, srcPcs) {
  const src = new Set(srcPcs);
  if (!played.some(pc => !key.set.has(pc) && !src.has(pc))) return null;
  const inferred = new Set(intervalsFor(quality).map(iv => (root + iv) % 12));
  let best = null, bestKey = null;
  for (let r = 0; r < 12; r++) SUBSTITUTE_QUALITIES.forEach((q, qi) => {
    const pcs = intervalsFor(q).map(iv => (r + iv) % 12);
    if (!pcs.every(pc => key.set.has(pc))) return;
    const cover = pcs.filter(pc => src.has(pc)).length;
    const holdsRoot = pcs.indexOf(root) >= 0 ? 1 : 0;
    const shared = pcs.filter(pc => inferred.has(pc)).length;
    const deg = DEGREE_PREFERENCE[(r - key.tonic + 12) % 12];
    const k = [-cover, -holdsRoot, -shared, deg == null ? 7 : deg, qi];
    if (!bestKey || k.some((v, i) => { for (let j = 0; j < i; j++) if (k[j] !== bestKey[j]) return false; return v < bestKey[i]; })) { best = { root: r, quality: q }; bestKey = k; }
  });
  return best;
}

/* ---- clash guard, seconds and one-hand spans (docs/GOALS/G09 section 12 "G9 clash guard, seconds and one-hand spans (post user review 3)") ----
   The user's third look at G9 output: "notes stuck together (a second)", "an octave or more at once in one hand is very hard", "the harmony got weirder".
   Measured causes (section 12): a generated left-hand tone a semitone (pitch-class interval 1 or 11) off the melody note sounding with it (the harmony
   window is a beat or a dotted half and the melody moves through it: all-creatures 12 of 13 harsh pairs); a generated maj7 stack that contains its own
   major seventh (root + 7th, C E B); generated stacks voiced up to 13 semitones (F2 B2 G3) although the stack only had to stay inside the hand's span
   (14 at profile large); a few seconds inside copied source voices. Each has a named limit and a stage gate; stage 4 keeps the old rules.
   HARSH_PC_INTERVALS: a minor second, a major seventh and a minor ninth are all pitch-class interval 1 or 11 (the octave does not soften them).
   MELODY_CLASH_MAX_STAGE: a generated tone that is HARSH against a melody note sounding with it is dropped (or, for a single note, replaced by another
   tone of the same chord) at every stage up to this one, unless the source itself sounds both pitch classes together there.
   NO_SECONDS_MAX_STAGE: a generated one-hand stack has no second (1 or 2 semitones between adjacent tones) anywhere in the register (the old rule was
   "no second below middle C"), and STACK_CLASH_MAX_STAGE: no harsh pair between its own tones (a maj7 stack gives its seventh up for the fifth).
   SPAN_CAP_MAX_STAGE and ONE_HAND_SPAN_CAP: a generated one-hand stack spans at most 10 semitones (under an octave), whatever the hand profile allows.
   HYMN_THIN_MAX_STAGE: a verbatim `hymn` section is thinned where one hand's simultaneous notes span an octave or more or hold a second. */
const HARSH_PC_INTERVALS = Object.freeze([1, 11]);
const MELODY_CLASH_MAX_STAGE = 4;
const NO_SECONDS_MAX_STAGE = 3;
const STACK_CLASH_MAX_STAGE = 3;
const SPAN_CAP_MAX_STAGE = 3;
const ONE_HAND_SPAN_CAP = 10;
const HYMN_THIN_MAX_STAGE = 3;
const ANY_SECOND = 128;
const SECOND_MAX_SEMITONES = 2; /* a second: 1 or 2 semitones between adjacent tones of one hand */
const OCTAVE_SEMITONES = 12; /* clusterPairs' `secondBelow` for "a second anywhere" */

function isHarshPair(a, b) {
  const pc = ((Math.abs(a - b) % 12) + 12) % 12;
  return pc === HARSH_PC_INTERVALS[0] || pc === HARSH_PC_INTERVALS[1];
}

/* the clash guard's limits that apply to a generated stack at `stage`: {secondBelow, spanCap, stackClash} (null/false = the old rule) */
function handGuardFor(stage) {
  return {
    secondBelow: stage <= NO_SECONDS_MAX_STAGE ? ANY_SECOND : null,
    spanCap: stage <= SPAN_CAP_MAX_STAGE ? ONE_HAND_SPAN_CAP : null,
    stackClash: stage <= STACK_CLASH_MAX_STAGE
  };
}

/* A stack (one chord of `root`, `midis`) with no harsh pair between its own tones: while two tones are a minor second or a major seventh apart
   (pitch class), the higher-ranked one (seventh before third before fifth before root; the higher note of a tie) is replaced by the chord's
   fifth (root + 7) at the octave nearest to it, or dropped when the fifth is already there. A chord without such a pair comes back as the same
   array; a maj7 voiced root + third + seventh (C E B) becomes C E G. Deterministic. */
function unclashStack(midis, root) {
  let cur = midis;
  for (let guard = 0; guard < 4; guard++) {
    let bad = null;
    const s = cur.slice().sort((a, b) => a - b);
    for (let i = 0; i < s.length && !bad; i++) for (let j = i + 1; j < s.length && !bad; j++) if (isHarshPair(s[i], s[j])) bad = [s[i], s[j]];
    if (!bad) return cur;
    const rank = m => roleRank(((m % 12) + 12) % 12, root);
    const drop = rank(bad[0]) > rank(bad[1]) ? bad[0] : (rank(bad[1]) > rank(bad[0]) ? bad[1] : bad[1]);
    const rest = cur.filter(m => m !== drop);
    const fifthPc = (((root + 7) % 12) + 12) % 12;
    if (rest.some(m => ((m % 12) + 12) % 12 === fifthPc)) cur = rest.sort((a, b) => a - b);
    else {
      const f = nearestWithPc(fifthPc, drop);
      const cand = rest.concat([f]);
      /* the fifth must not clash itself; otherwise drop the tone */
      cur = cand.some((m, i) => cand.some((n, k) => k > i && isHarshPair(m, n))) ? rest.sort((a, b) => a - b) : cand.sort((a, b) => a - b);
    }
    if (cur.length === 0) return midis;
  }
  return cur;
}

/* A stack of a seventh chord (root, third, seventh: targetPcs for a 4-tone quality at count 3) with its seventh replaced by the chord's fifth (root + 7) at the
   octave nearest the seventh: root, third, fifth. null when no tone has the seventh's rank or the fifth is already in the chord. */
function fifthForSeventh(midis, root) {
  const seventh = midis.filter(m => roleRank(((m % 12) + 12) % 12, root) === 3);
  if (seventh.length !== 1) return null;
  const fifthPc = (((root + 7) % 12) + 12) % 12;
  if (midis.some(m => ((m % 12) + 12) % 12 === fifthPc)) return null;
  return midis.filter(m => m !== seventh[0]).concat([nearestWithPc(fifthPc, seventh[0])]).sort((a, b) => a - b);
}

/* One generated event's tones against the melody notes sounding with it. `clashes[i]` says tone i is harsh against one of them (and the source does not
   sound that pair). Returns {midis, dropped, replaced, unresolved}: the tones that do not clash, when any remain; when every tone clashes, ONE tone: the
   chord's own pitch class (`chordPcs`, root first) that clashes with no melody note (`clashesWith(midi)`), at the octave nearest to the first tone and not
   under `floor`; when every chord pitch class clashes the event is left as it is (unresolved). An event with no clash comes back as the same array. */
function guardTones(midis, clashesWith, chordPcs, floor) {
  const bad = midis.map(m => clashesWith(m));
  if (!bad.some(Boolean)) return { midis: midis, dropped: 0, replaced: 0, unresolved: 0 };
  const keep = midis.filter((m, i) => !bad[i]);
  if (keep.length) return { midis: keep, dropped: midis.length - keep.length, replaced: 0, unresolved: 0 };
  const near = midis[0];
  let best = null, bestD = Infinity;
  (chordPcs || []).forEach(pc => {
    const base = near - ((((near - pc) % 12) + 12) % 12); /* the note with this pitch class at or under `near` */
    [base - 12, base, base + 12, base + 24].forEach(c => {
      if (floor != null && c < floor) return;
      if (c < 0 || c > 127 || clashesWith(c)) return;
      const d = Math.abs(c - near);
      if (d < bestD || (d === bestD && c < best)) { best = c; bestD = d; }
    });
  });
  if (best == null) return { midis: midis, dropped: 0, replaced: 0, unresolved: 1 };
  return { midis: [best], dropped: midis.length - 1, replaced: 1, unresolved: 0 };
}

/* The melody clash guard for one generated event sounding over [t0, t1) (plain numbers, whole notes): `melody` = the melody notes {w0, w1, midi}, `sourceSoundsPc(pc, a, b)`
   = does the SOURCE piece sound pitch class `pc` anywhere in [a, b). A tone is clashing when it is HARSH against a melody note sounding with it and the source does
   not itself sound that tone's pitch class during the overlap of the two (the source's own clash is left alone). Returns guardTones' result
   ({midis, dropped, replaced, unresolved}); the same `midis` array when nothing clashes. `chordPcs` = the window's chord pitch classes, for a replacement. */
function guardEvent(midis, t0, t1, melody, sourceSoundsPc, chordPcs, floor) {
  const over = melody.filter(n => n.w0 < t1 - 1e-9 && n.w1 > t0 + 1e-9);
  if (!over.length) return { midis: midis, dropped: 0, replaced: 0, unresolved: 0 };
  const clashesWith = m => over.some(n => isHarshPair(m, n.midi) && !sourceSoundsPc(((m % 12) + 12) % 12, Math.max(t0, n.w0), Math.min(t1, n.w1)));
  return guardTones(midis, clashesWith, chordPcs, floor);
}

/* All permutations of [0..n-1], n small (<=4 in every real caller - a 7th chord at most). */
function permutations(n) {
  if (n <= 1) return [[0]];
  const rest = permutations(n - 1), out = [];
  rest.forEach(p => { for (let i = 0; i < n; i++) out.push(p.slice(0, i).concat([n - 1], p.slice(i))); });
  return out;
}

/* Smooth voice leading from a previous voicing to a new chord: the permutation of
   `targetPcs(root, quality, prevMidis.length)` assigned to prevMidis' own voice slots that
   minimizes total absolute semitone motion, each new tone placed at the octave nearest its
   own previous voice (not a fixed register) - genuine nearest-chord-tone voice leading, the
   G08 §6a requirement, not independently re-randomized voicings per window. */
function leadVoicing(prevMidis, root, quality) {
  const count = prevMidis.length;
  const pcs = targetPcs(root, quality, count);
  const perms = permutations(count);
  let best = null, bestCost = Infinity;
  perms.forEach(perm => {
    const assign = perm.map(pcIdx => pcs[pcIdx]);
    const placed = assign.map((pc, slot) => nearestWithPc(pc, prevMidis[slot]));
    const cost = placed.reduce((s, m, i) => s + Math.abs(m - prevMidis[i]), 0);
    if (cost < bestCost) { bestCost = cost; best = placed; }
  });
  return best;
}

/* Clamp a voicing to fit inside `maxSpan` semitones (G5's real reach.MAX_SPAN for the
   requested hand profile), by octave-shifting the outlier(s) farthest from the group's
   median toward the cluster - a real fix (the voicing still sounds every chord tone,
   just closer together), not a silent drop, tried a bounded number of times before the
   caller falls back to fewer notes. */
function clampSpan(midis, maxSpan, maxIters) {
  let out = midis.slice();
  for (let iter = 0; iter < (maxIters || 8); iter++) {
    const lo = Math.min.apply(null, out), hi = Math.max.apply(null, out);
    if (hi - lo <= maxSpan) return out;
    const sorted = out.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let idx = 0, bestD = -1;
    out.forEach((m, i) => { const d = Math.abs(m - median); if (d > bestD) { bestD = d; idx = i; } });
    out[idx] += out[idx] > median ? -12 : 12;
  }
  return out;
}

  return {
    CHORD_INTERVALS, intervalsFor, targetPcs, nearestWithPc, freshVoicing, leadVoicing, clampSpan, permutations,
    REGISTER_FLOOR, CLUSTER_BELOW, floorMidis, foldAbove,
    STACK_MAX_BY_STAGE, LH_CHORD_TOP, SECOND_BELOW, maxStackForStage, roleRank, thinChord, clusterPairs, chordLegal, settleChord,
    DIATONIC_MAX_STAGE, keyPcs, playedPcs, diatonicSubstitute,
    HARSH_PC_INTERVALS, MELODY_CLASH_MAX_STAGE, NO_SECONDS_MAX_STAGE, STACK_CLASH_MAX_STAGE, SPAN_CAP_MAX_STAGE, ONE_HAND_SPAN_CAP, HYMN_THIN_MAX_STAGE, ANY_SECOND, SECOND_MAX_SEMITONES, OCTAVE_SEMITONES,
    isHarshPair, handGuardFor, unclashStack, fifthForSeventh, guardTones, guardEvent
  };
});
