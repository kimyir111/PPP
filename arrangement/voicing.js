/* ============================================================================
   PPP Arrangement Realizer — chord voicing, voice leading and reach safety (G8a)

   Pure helpers shared by every pattern in patterns.js:
     chordTones(window, n)          n real chord-tone pitch classes from a harmony window
                                     (songgraph/harmony.js's fitChord output), root first,
                                     ascending by interval from the root, cycling/doubling
                                     the root up an octave if n exceeds the fitted chord's
                                     own tone count (an ordinary voicing move, not invented
                                     harmony - the pitch CLASS is always a real chord tone).
     voiceLead(pcs, prevMidis, centerMidi)
                                     places each pitch class in an octave: the octave
                                     nearest the matching voice of the PREVIOUS window's
                                     voicing when one exists (smooth motion between
                                     successive harmony windows - G8's §6a requirement),
                                     otherwise the octave nearest `centerMidi` (the plan's
                                     own real registerRH/LH for this hand, G07B §11's
                                     `voicing.registerRH/LH`). A greedy nearest-available
                                     match, not an optimal minimal-total-motion solve - good
                                     enough for a 1-4 note accompaniment voicing, documented
                                     as a v1 simplification.
     clampToReach(midis, profile)   drops the note that widens the span most until the
                                     result fits REACH.MAX_SPAN[profile] and REACH.MAX_KEYS -
                                     the safety net that keeps a pattern's own invented
                                     voicing inside G5's real reach constants even though the
                                     plan only ever checked the RETAINED VOICE COUNT fits,
                                     never a specific register the realizer would choose.
     wToDisplay(wLen)               a W-rational duration -> {type, dots?} for addEvent's
                                     `display` (a fixed table of the plain values this
                                     module's own subdivision choices ever produce - see
                                     subdivide()); an unrecognized length (should not occur,
                                     given subdivide()'s own choices) falls back to 'quarter'
                                     rather than throwing, since `display` is a print hint,
                                     not sounding truth.
     subdivide(w0, w1, n)           n equal W-rational sub-windows of [w0, w1) - always a
                                     power-of-two n (1, 2 or 4; see patterns.js), so dividing
                                     any notated beat (simple or compound meter alike) by it
                                     always lands on a plain, non-tuplet notatable value.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../playability/reach.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const PP = root.PPPPlayabilityModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.voicing = factory(SG.rational, PP.reach);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, REACH) {
  'use strict';

  function chordTones(win, n) {
    if (!win || win.root == null || !win.pcs || !win.pcs.length) return null;
    const root = ((win.root % 12) + 12) % 12;
    const byInterval = win.pcs.slice().sort((a, b) => ((a - root + 12) % 12) - ((b - root + 12) % 12));
    const out = [];
    for (let i = 0; i < n; i++) out.push(byInterval[i % byInterval.length]);
    return out;
  }

  /* The octave of `pc` nearest a target MIDI (ties broken toward the lower octave). */
  function nearestOctave(pc, targetMidi) {
    const base = Math.round((targetMidi - pc) / 12) * 12 + pc;
    return base;
  }

  /* REGISTER_HALF_RANGE: real finding (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §14) - a first
     version of voiceLead always matched a pitch class to whichever octave was nearest the
     PREVIOUS window's own voice, with nothing at all pulling it back toward the plan's real
     register (`centerMidi`) once prevMidis existed. Chasing only "smallest step from the last
     chord" has no ceiling: a real hymn (come-thou-long) has a harmonic-root sequence that climbs
     by small steps for many consecutive beats (each individual step under a fifth, each
     individually "the nearest octave"), and with a single retained accompaniment voice
     (n=1 - clampToReach's own span/key-count checks never even trigger, so its later
     center-tie-break fix does nothing here either) the walk had nowhere to stop: MIDI 57 drifted
     to 105 over 31 beats, and a DIFFERENT real file (o-come-emmanuel, see clampToReach's own
     header) drifted the other direction. Fixed at the root: every candidate octave voiceLead
     considers is bounded to within REGISTER_HALF_RANGE semitones of `centerMidi` (the plan's own
     real registerRH/LH) - "nearest to the previous voice" now means "nearest to the previous
     voice, AMONG the octaves that still land in the hand's own real register," not literally
     any octave on the keyboard. 14 semitones (an octave plus a bit, REACH's own largest
     MAX_SPAN) is a generous window for one hand's real voicing, not a citation. */
  const REGISTER_HALF_RANGE = 14;
  function candidatesNear(pc, center) {
    const out = [];
    for (let oct = -3; oct <= 3; oct++) {
      const cand = nearestOctave(pc, center) + oct * 12;
      if (Math.abs(cand - center) <= REGISTER_HALF_RANGE) out.push(cand);
    }
    return out.length ? out : [nearestOctave(pc, center)];
  }

  /* pcs: [pc,...] in the order they should be assigned (root first). prevMidis: the previous
     window's chosen MIDI list (any order) or null. centerMidi: the plan's own real register
     target for this hand - always the true anchor now, not just a first-window fallback. */
  function voiceLead(pcs, prevMidis, centerMidi) {
    const center = centerMidi == null ? 60 : centerMidi;
    const avail = (prevMidis || []).slice();
    return pcs.map(pc => {
      const candidates = candidatesNear(pc, center);
      if (avail.length) {
        /* nearest previous voice whose pitch class could move to this pc with the least motion,
           among the octaves that stay within this hand's real register */
        let best = null, bestDist = Infinity, bestIdx = -1;
        avail.forEach((m, i) => {
          candidates.forEach(cand => {
            const d = Math.abs(cand - m);
            if (d < bestDist) { bestDist = d; best = cand; bestIdx = i; }
          });
        });
        avail.splice(bestIdx, 1);
        return best;
      }
      return candidates.reduce((a, b) => (Math.abs(b - center) < Math.abs(a - center) ? b : a));
    });
  }

  /* Real finding (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §14), in two parts:
     1) a first version of this function only ever DROPPED a note to fix an out-of-reach span.
        Since voiceLead picks each pitch class's octave independently (nearest to ITS OWN
        previous voice), two individually reasonable choices can land in different octaves of
        the same chord (e.g. a bass at 45 and an upper tone nearest-matched to 60, 15 semitones
        apart) even though the SAME pitch classes fit easily within reach one octave apart (45,
        48) - dropping the upper tone there loses a real voice for no musical reason. Fixed by
        trying every combination of shifting each note by a whole octave (-12/0/+12) FIRST
        (bounded: 3^n, n<=5 here) and taking the smallest-total-movement combination that fits
        both the span and the key-count ceiling; dropping the outermost note (the original,
        simpler strategy) is now only a fallback for when no octave-shift combination works at
        all (a real cluster too dense for any single-octave rearrangement, not just a bad pick).
     2) that fix alone still let a real corpus piece (o-come-emmanuel) drift into an unplayably
        low register over ~15 beats: when two shift combinations tie exactly on total movement
        (a real, common case - shifting the top note down an octave costs the same as shifting
        the bottom note up one), picking the first one found in an arbitrary enumeration order
        has NO restoring pull toward the plan's own intended register (registerLH/RH,
        `center`), so a long run of such ties compounds into one-directional drift, step after
        step, with nothing to stop it - confirmed directly: the same real piece's LH accompaniment
        drifted from MIDI ~53 to ~11 (a G-1, off the bottom of any piano) over measures 23-25
        before this fix. Fixed by making `center` a real (small-weight) SECONDARY term in the
        cost function - shift count still dominates (multiples of 1000 versus at most a few
        hundred semitones of center distance), so a genuinely cheaper shift is never traded away,
        but a real tie now always resolves toward the plan's own register instead of drifting. */
  function bestOctaveShift(midis, maxSpan, maxKeys, center) {
    if (midis.length > 5) return null; /* bounded search; patterns.js never asks for more than REACH.MAX_KEYS (5) tones */
    const shifts = [-12, 0, 12];
    const target = center == null ? 60 : center;
    let best = null, bestCost = Infinity;
    const n = midis.length;
    const total = Math.pow(3, n);
    for (let code = 0; code < total; code++) {
      let c = code, shiftCost = 0;
      const cand = midis.map(m => {
        const s = shifts[c % 3]; c = Math.floor(c / 3);
        shiftCost += Math.abs(s);
        return m + s;
      });
      const sorted = cand.slice().sort((a, b) => a - b);
      if (sorted.length > maxKeys) continue;
      if (sorted[sorted.length - 1] - sorted[0] > maxSpan) continue;
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const cost = shiftCost * 1000 + Math.abs(mean - target);
      if (cost < bestCost) { bestCost = cost; best = sorted; }
    }
    return best;
  }

  function clampToReach(midis, profile, center) {
    const maxSpan = REACH.MAX_SPAN[REACH.profileOf(profile)], maxKeys = REACH.MAX_KEYS;
    const shifted = bestOctaveShift(midis, maxSpan, maxKeys, center);
    if (shifted) return shifted;
    let out = midis.slice().sort((a, b) => a - b);
    while (out.length > 1 && (out[out.length - 1] - out[0] > maxSpan || out.length > maxKeys)) {
      /* drop whichever end note contributes more to the span (or, span already fine, the top note over the key cap) */
      if (out.length > maxKeys && out[out.length - 1] - out[0] <= maxSpan) { out.pop(); continue; }
      const dropHi = (out[out.length - 1] - out[1]) <= (out[out.length - 2] - out[0]);
      if (dropHi) out.pop(); else out.shift();
    }
    return out;
  }

  /* This module's own pattern subdivisions (voicing.subdivide, always a power of two) only ever
     produce the values through the 32nd row below - kept exact. The melody line's REAL, verbatim
     durations (any value a source piece writes) can also land here; the triplet rows are a
     documented best-effort ("prints as the nearest plain value, no tuplet spanner is written")
     for that case only - patterns.js never generates one, per its own subdivisionsFor(). */
  const DISPLAY_TABLE = [
    [4, { type: 'whole' }], [3, { type: 'half', dots: 1 }], [2, { type: 'half' }], [1.5, { type: 'quarter', dots: 1 }],
    [1, { type: 'quarter' }], [0.75, { type: 'eighth', dots: 1 }], [0.6666666666666666, { type: 'eighth' }],
    [0.5, { type: 'eighth' }], [0.375, { type: '16th', dots: 1 }], [0.3333333333333333, { type: '16th' }],
    [0.25, { type: '16th' }], [0.1875, { type: '32nd', dots: 1 }], [0.125, { type: '32nd' }], [6, { type: 'whole', dots: 1 }]
  ];
  function wToDisplay(w) {
    const q = R.toNumber(w) * 4;
    let best = DISPLAY_TABLE[4][1], bd = Infinity; /* default: quarter */
    DISPLAY_TABLE.forEach(([val, disp]) => { const d = Math.abs(val - q); if (d < bd) { bd = d; best = disp; } });
    return Object.assign({}, best);
  }

  function subdivide(w0, w1, n) {
    const len = R.div(R.sub(w1, w0), R.fromInt(n));
    const out = [];
    let at = w0;
    for (let i = 0; i < n; i++) { const next = i === n - 1 ? w1 : R.add(at, len); out.push({ w0: at, w1: next }); at = next; }
    return out;
  }

  return Object.freeze({ chordTones, voiceLead, clampToReach, wToDisplay, subdivide, nearestOctave });
});
