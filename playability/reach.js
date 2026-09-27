/* ============================================================================
   PPP Playability — hand reach and keyboard-velocity constants (docs/GOALS/G05 §3(a), §10)

   Every number here is either lifted from data already shipped in this repository (the Parncutt
   span table the app's own `Fingering` module uses, App 8337-8354) or is a small, explicitly cited
   external figure. Nothing is an unexamined guess (G05 §10: "do not guess at numbers this doc flags
   as uncertain... document your reasoning and cite it").

   ---- Hand span (hard violation: "a simultaneous span in one hand beyond reach") ----

   The app's `Fingering.SPANS['1-5']` (thumb to little finger, semitones, right hand) is
   [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac] = [-1, 1, 7, 10, 12, 14] (App 8347), from
   Parncutt, Sloboda, Clarke, Raekallio and Desain (1997), "already a semitone short of the published
   figures, which were measured on a large hand" (App 8340-8342). That table gives three of this
   module's three hand profiles directly, without inventing a separate anthropometric source:

     large  -> MaxPrac (14): the outer edge that table already models for a large hand.
     medium -> MaxComf (12): that SAME large hand's own "comfortable" ceiling, one octave - reused
               here as an average hand's practical ceiling, since PPP has no separate average-hand
               span study and 12 (one octave) is the span nearly every method book assumes a learner
               has (Beyer, Czerny 100 and 599 rarely ask for more).
     small  -> MaxRel (10): that same table's "max relaxed" figure - a minor seventh, the conservative
               choice for a small or a child's hand, still inside what App's own table calls reachable
               without strain for ANY hand it models.

   This is a coarse, single-number simplification of the DP's full per-finger-pair table (G5b keeps
   the finger-level model; G5a only needs the outer envelope: the widest interval struck or held at
   once by one hand). If H-56 or a real small/large-hand corpus later says these three numbers are
   wrong, correct them here (G05 §10) rather than re-deriving blind.

   ---- Keyboard velocity (hard violation: "a lateral shift too fast for the time available") ----

   First measured version (2026-09-28) applied a flat 250 ms floor to every attack-to-attack gap in a
   hand, of any distance. That is wrong, and the R-corpus false-positive run below (§10 of the goal doc
   asks for exactly this kind of check) is what caught it: over sonatina/020 it flagged 999 of 1,401
   events, nearly all single-semitone scale steps a beginner piece asks for at an ordinary tempo. The
   250 ms figure - "a robotic hand achieved a maximum key-strike frequency of 10 Hz, more than twice the
   human limit of approximately 4 Hz" (Frontiers in Psychology, "The biomechanics of piano
   [performance]", 2025/2026, https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1690422)
   - is a ceiling on how fast ONE key can be re-struck (a trill, a repeated note), not on how fast a
   hand can move between two DIFFERENT nearby keys with different fingers, which ordinary scale and
   arpeggio playing does far faster than 4 times a second. Corrected model:

     - Two attacks that land inside one hand's own reach for its profile (MAX_SPAN, above) need no
       travel time at all: different fingers reach them without moving the hand, at any speed the piece
       asks (a fast scale run is exactly this case, over and over).
     - The SAME single pitch struck again (distance 0, one finger, one key) is the one case the 4 Hz
       citation actually describes: SAME_KEY_FLOOR_S = 0.25 s is a hard floor on that, regardless of how
       small "distance 0" looks next to the reach-based rule above.
     - Beyond a hand's own reach, the hand's base position has to move, not just its fingers. No source
       in or out of this repo gives a semitones/second figure for that (as opposed to single-key
       repetition), so PER_SEMITONE_S = 0.012 is a placeholder, not a citation: chosen so that a
       two-octave stride-bass leap (24 semitones, roughly 10 beyond a large hand's 14-semitone reach)
       needs at least 0.12 s, inside a single eighth note at a brisk stride tempo - which is where that
       figure such leaps are actually played comfortably, not a measurement. Flagged here, as G05 §10
       asks, for H-56 or a future measured corpus to correct.

   required(distance, reachForProfile):
     distance === 0                    -> SAME_KEY_FLOOR_S
     distance <= reachForProfile       -> 0 (fingers alone cover it)
     distance > reachForProfile        -> (distance - reachForProfile) * PER_SEMITONE_S
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPPlayabilityModules = root.PPPPlayabilityModules || {}; M.reach = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROFILES = ['small', 'medium', 'large'];

  /* Widest simultaneous interval (semitones, low to high) one hand may hold at once, by profile.
     Source: App 8337-8354, Fingering.SPANS['1-5'] (Parncutt et al. 1997) - see header. */
  const MAX_SPAN = Object.freeze({ small: 10, medium: 12, large: 14 });

  /* More than this many keys at once in one hand is a hard violation regardless of profile (G05 §3(a)):
     five fingers, one key each. Not a reach number - a finger-count ceiling. */
  const MAX_KEYS = 5;

  /* Keyboard-velocity model (see header). SAME_KEY_FLOOR_S: the 4 Hz same-key repetition ceiling
     (cited). PER_SEMITONE_S: an uncited, deliberately modest placeholder for travel beyond a hand's own
     reach - see header for why, and G05 §10 for the standing invitation to correct it. */
  const SAME_KEY_FLOOR_S = 0.25;
  const PER_SEMITONE_S = 0.012;
  /* distanceSemitones is the *hand centroid* travel, not a single key: a repeated or tremolo CHORD
     (several fingers, each re-striking its own key) can have centroid distance 0 too, and is not the
     same-key case SAME_KEY_FLOOR_S describes - callers use that constant directly for a literal
     single-note repeat (see analyze.js) and call this only for everything else. */
  function requiredSeconds(distanceSemitones, reachForProfile) {
    const d = Math.abs(distanceSemitones);
    const reach = reachForProfile == null ? MAX_SPAN.medium : reachForProfile;
    if (d <= reach) return 0;
    return (d - reach) * PER_SEMITONE_S;
  }

  /* Soft-strain "comfortable" span (App's MaxComf-style figure, one step in from MAX_SPAN): stretch
     strain (G05 §3(a) soft strain) is scored, not flagged, once a hand's span passes this - not the
     hard MAX_SPAN ceiling. Reusing the same table's MinRel/MaxRel-to-MaxComf gap (2 semitones) for
     every profile keeps one consistent shape rather than inventing a second set of numbers. */
  const COMFORT_SPAN = Object.freeze({ small: 8, medium: 10, large: 12 });

  function profileOf(name) {
    return PROFILES.indexOf(name) >= 0 ? name : 'medium';
  }

  return Object.freeze({
    PROFILES, MAX_SPAN, MAX_KEYS, COMFORT_SPAN,
    SAME_KEY_FLOOR_S, PER_SEMITONE_S, requiredSeconds,
    profileOf
  });
});
