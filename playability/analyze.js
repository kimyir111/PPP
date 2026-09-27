/* ============================================================================
   PPP Playability — the analyzer (docs/GOALS/G05 §3(a))

   analyze(attacks, opts) -> PlayabilityReport over a list of Attacks (playability/graph.js's shape,
   or an equivalent produced by an adapter - see tests/playability/arranger-adapters.js for the three
   legacy arrangers): { limb, onsetSec, m, heads: [{id, midi, offSec}], midis }.

   One pass per hand (RH, LH), attacks in onset order. A "held" list carries notes still sounding from
   earlier attacks (tie chains already resolved by the caller into each head's `offSec`, G05 §10). At
   each attack the two hard span/count checks look at HELD + NEW notes together, which is deliberately
   the same test for a plain simultaneous chord (held is empty: the check degenerates to "this chord
   alone") and for the fourth hard violation the goal doc names separately - "a hold that cannot be
   released or re-struck in time, a finger already committed elsewhere" (held is non-empty: the chord
   that must now also fit is the new notes plus whatever this hand is still holding down). One
   mechanism serves both, rather than two ad hoc ones (see docs/GOALS/G05_PLAYABILITY_FINGERING.md §11).

   Hard violation codes: SPAN, KEYS, VELOCITY (see playability/reach.js for the thresholds and their
   citations). Soft strain (scored, never flagged): stretch, jump, crossing, repeat, blackThumb,
   polyphony - each a small non-negative number added to the event's and the measure's `soft` total.
   Soft strain is a first approximation for G6 to build on, not a validated difficulty model.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./reach.js'));
  else { const M = root.PPPPlayabilityModules = root.PPPPlayabilityModules || {}; M.analyze = factory(M.reach); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (REACH) {
  'use strict';

  const EPS = 1e-9;
  const BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };
  const isBlack = midi => !!BLACK_PC[((midi % 12) + 12) % 12];
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

  function analyzeHand(attacksForHand, profile) {
    const maxSpan = REACH.MAX_SPAN[profile];
    const comfortSpan = REACH.COMFORT_SPAN[profile];
    const events = [];
    let held = []; /* [{midi, offSec}] */
    let prevMidis = null, prevOnsetSec = null;

    attacksForHand.forEach(a => {
      held = held.filter(h => h.offSec > a.onsetSec + EPS);
      const soundingMidis = held.map(h => h.midi).concat(a.midis);
      const lo = Math.min.apply(null, soundingMidis), hi = Math.max.apply(null, soundingMidis);
      const span = hi - lo;
      const count = soundingMidis.length;
      const isHold = held.length > 0;
      const hard = [];
      if (span > maxSpan) hard.push({ code: 'SPAN', span: span, max: maxSpan, hold: isHold, midis: soundingMidis.slice() });
      if (count > REACH.MAX_KEYS) hard.push({ code: 'KEYS', count: count, max: REACH.MAX_KEYS, hold: isHold, midis: soundingMidis.slice() });

      /* "Impossible velocity" (G05 §3(a)) is a LATERAL SHIFT check: can the hand's centroid cover this
         distance in the time available. It is not a repeated-note-speed check - the goal doc lists
         repeated-note speed under soft strain, not hard violations, and an early version of this
         analyzer that also hard-gated same-key repeats produced real false positives on the R corpus
         (measured 2026-09-28: real repeated-note passages in Sonatina 012 and the M23 fixture reach
         about 94-110 ms between attacks of the SAME key, well under any single-finger repetition
         ceiling, because real playing alternates fingers on a repeated note - something G5a cannot see
         without the fingering DP, G5b). reach.requiredSeconds(0, maxSpan) is always 0 (0 <= any reach),
         so a same-key repeat of any speed never hard-fails here; SAME_KEY_FLOOR_S still shapes the soft
         "repeat" strain below. */
      let velocity = null;
      if (prevOnsetSec != null) {
        const dt = a.onsetSec - prevOnsetSec;
        const dist = Math.abs(mean(a.midis) - mean(prevMidis));
        const need = REACH.requiredSeconds(dist, maxSpan);
        if (dt + EPS < need) { velocity = { code: 'VELOCITY', dt: dt, need: need, dist: dist }; hard.push(velocity); }
      }

      /* ---- soft strain (G05 §3(a)): small, additive, never gates anything ---- */
      let soft = 0;
      const softParts = {};
      if (span > comfortSpan) { softParts.stretch = span - comfortSpan; soft += softParts.stretch; }
      if (prevOnsetSec != null) {
        const jump = Math.abs(mean(a.midis) - mean(prevMidis));
        if (jump > comfortSpan) { softParts.jump = (jump - comfortSpan) * 0.5; soft += softParts.jump; }
        const dt = a.onsetSec - prevOnsetSec;
        if (dt > EPS && dt < REACH.SAME_KEY_FLOOR_S * 2 && a.midis.length === 1 && prevMidis.length === 1 && a.midis[0] === prevMidis[0]) {
          softParts.repeat = (REACH.SAME_KEY_FLOOR_S * 2 - dt) * 2;
          soft += softParts.repeat;
        }
      }
      /* Black-key thumb use is approximated (no fingering yet, G5b): the outer voice a hand's thumb
         conventionally takes - the LOWEST note of a right-hand chord, the HIGHEST of a left-hand one -
         landing on a black key. Only scored for a real chord (>=2 notes): a single note has no "outer
         voice" to single out this way. */
      if (a.midis.length >= 2) {
        const thumbNote = a.limbGuess === 'LH' ? Math.max.apply(null, a.midis) : Math.min.apply(null, a.midis);
        if (isBlack(thumbNote)) { softParts.blackThumb = 0.5; soft += 0.5; }
      }
      if (count > 3) { softParts.polyphony = (count - 3) * 0.5; soft += softParts.polyphony; }

      events.push({ limb: a.limb, m: a.m, onsetSec: a.onsetSec, midis: a.midis.slice(), heldCount: held.length,
        hard: hard, soft: soft, softParts: softParts });

      a.heads.forEach(h => { held = held.filter(x => x.midi !== h.midi); held.push({ midi: h.midi, offSec: h.offSec }); });
      prevMidis = a.midis; prevOnsetSec = a.onsetSec;
    });
    return events;
  }

  /* Hand crossing (soft): at the same instant, the lowest RH note sits at or below the highest LH
     note (or vice versa) - not a hard violation (crossing is a real, published technique), but a real
     added strain (G05 §3(a) "hand crossings"). Computed once both hands' attacks are known, since it
     is inherently a two-hand comparison. */
  function crossingStrain(rhAttacks, lhAttacks) {
    const out = new Map(); /* key onset -> extra soft strain, per hand event index not needed: applied by measure */
    const byOnset = new Map();
    rhAttacks.forEach(a => { if (!byOnset.has(a.onsetSec)) byOnset.set(a.onsetSec, {}); byOnset.get(a.onsetSec).rh = a; });
    lhAttacks.forEach(a => { if (!byOnset.has(a.onsetSec)) byOnset.set(a.onsetSec, {}); byOnset.get(a.onsetSec).lh = a; });
    byOnset.forEach((pair, onset) => {
      if (!pair.rh || !pair.lh) return;
      const rhLo = Math.min.apply(null, pair.rh.midis), lhHi = Math.max.apply(null, pair.lh.midis);
      if (rhLo <= lhHi) out.set(onset, { m: pair.rh.m, soft: 1 });
    });
    return out;
  }

  function analyze(attacks, opts) {
    opts = opts || {};
    const profile = REACH.profileOf(opts.profile);
    const rh = attacks.filter(a => a.limb === 'RH').map(a => Object.assign({ limbGuess: 'RH' }, a));
    const lh = attacks.filter(a => a.limb === 'LH').map(a => Object.assign({ limbGuess: 'LH' }, a));
    const rhEvents = analyzeHand(rh, profile);
    const lhEvents = analyzeHand(lh, profile);
    const crossings = crossingStrain(rh, lh);

    const events = rhEvents.concat(lhEvents).sort((a, b) => a.onsetSec - b.onsetSec || (a.limb < b.limb ? -1 : 1));
    crossings.forEach((c, onset) => {
      events.filter(e => Math.abs(e.onsetSec - onset) < EPS).forEach(e => { e.soft += c.soft; e.softParts.crossing = c.soft; });
    });

    const measures = {};
    let hardTotal = 0, softTotal = 0;
    const byCode = {};
    events.forEach(e => {
      if (!measures[e.m]) measures[e.m] = { hard: 0, soft: 0, byCode: {} };
      const mm = measures[e.m];
      mm.soft += e.soft;
      softTotal += e.soft;
      e.hard.forEach(v => {
        mm.hard++; hardTotal++;
        mm.byCode[v.code] = (mm.byCode[v.code] || 0) + 1;
        byCode[v.code] = (byCode[v.code] || 0) + 1;
      });
    });

    return {
      profile: profile,
      events: events,
      measures: measures,
      totals: { hard: hardTotal, soft: softTotal, byCode: byCode, events: events.length }
    };
  }

  return Object.freeze({ analyze, analyzeHand, crossingStrain });
});
