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
    REGISTER_FLOOR, CLUSTER_BELOW, floorMidis, foldAbove
  };
});
