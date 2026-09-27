/* ============================================================================
   PPP Playability — extracting keyboard attacks from a ScoreGraph (docs/GOALS/G05 §3(a), §10)

   attacksOf(graph, opts) -> [Attack], one per moment one hand's fingers strike new keys:
     { limb ('RH'|'LH'), m (the Measure ID this attack starts in), onsetW (Rat), onsetSec,
       heads: [{ id, midi, offSec }], midis: [midi, …] sorted }

   Hands: G05 §10 - "hands come from the graph's existing staff/voice structure inherited from G1
   (limbs RH/LH, decision G1-D12) - do not infer hands from anything else". This module reads
   `pitch.limbOf(part, event, head)` (scoregraph/pitch.js §8.2: head.limb ?? voice.limb ?? staff.limb)
   and nothing else. A head whose limb is not RH or LH (unset, or RF/LF - a pedal limb, not a hand) is
   left out of every hand-span/velocity check; that is a data or G1 issue (I-LIMB-UNSET), out of scope
   here (G05 §10).

   Ties: a tied-into head is not a new attack (the finger never lifts) - it only extends how long the
   note already down keeps sounding. Each attack's heads carry `offSec`, the END of the whole tie
   chain, not just this one event's own notated duration, so the hold/re-strike check in analyze.js
   sees the note as held for as long as it actually is.

   Timing: onsetW is the plain notated ScorePos (time.scorePos), not the repeat-expanded PlaybackW;
   for a score with no repeats before the point in question the two coincide exactly (time.unroll's
   first pass visits every measure once, in order, at the same offsets). A piece that repeats plays the
   same passage again unchanged, so checking it once is enough for a playability read - re-analyzing
   every repeated pass would not find anything the first pass did not already show. defaultQpm follows
   the same 120 that tests/scoregraph/g3-helpers.js's mk() fixtures use when a score states no tempo. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'), require('../scoregraph/time.js'));
  else {
    const M = root.PPPPlayabilityModules = root.PPPPlayabilityModules || {};
    const SG = root.PPPScoreGraphModules || {};
    M.graph = factory(SG.rational, SG.pitch, SG.time);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P, T) {
  'use strict';

  const DEFAULT_QPM = 120;
  const HANDS = { RH: true, LH: true };

  function attacksOf(g, opts) {
    opts = opts || {};
    const timeOpts = { defaultQpm: opts.defaultQpm || DEFAULT_QPM };

    /* tie chains: forward head -> next head, and the set of heads that are a chain's continuation
       (never a new attack). Spanner ends for a tie are head IDs directly (schema.js SPANNER_ENDS.tie). */
    const tieNext = new Map();
    const tieContinuation = new Set();
    g.parts.forEach(part => (part.spanners || []).forEach(sp => {
      if (sp.type === 'tie' && sp.from && sp.to) { tieNext.set(sp.from, sp.to); tieContinuation.add(sp.to); }
    }));
    function chainEndId(headId) {
      let cur = headId, guard = 0;
      while (tieNext.has(cur) && guard++ < 100000) cur = tieNext.get(cur);
      return cur;
    }

    /* head index: id -> {midi, limb, onsetW, durW, m} */
    const headInfo = new Map();
    g.parts.forEach((part, pi) => part.events.forEach(e => {
      if (e.kind !== 'note') return;
      const onsetW = T.scorePos(g, { m: e.m, at: e.at });
      const durW = R.parse(e.dur);
      (e.heads || []).forEach(h => {
        if (!h.pitch) return;
        const limb = P.limbOf(part, e, h);
        if (!HANDS[limb]) return;
        headInfo.set(h.id, { midi: P.midi(h.pitch), limb: limb, onsetW: onsetW, durW: durW, m: e.m });
      });
    }));

    /* group non-continuation heads into attacks by (limb, exact onset) */
    const groups = new Map();
    headInfo.forEach((info, id) => {
      if (tieContinuation.has(id)) return;
      const endId = chainEndId(id);
      const endInfo = headInfo.get(endId) || info;
      const offW = R.add(endInfo.onsetW, endInfo.durW);
      const key = info.limb + '@' + R.format(info.onsetW);
      if (!groups.has(key)) groups.set(key, { limb: info.limb, onsetW: info.onsetW, m: info.m, heads: [] });
      groups.get(key).heads.push({ id: id, midi: info.midi, offW: offW });
    });

    const secCache = new Map();
    function secOf(w) {
      const k = R.format(w);
      if (secCache.has(k)) return secCache.get(k);
      const s = R.toNumber(T.seconds(g, w, timeOpts));
      secCache.set(k, s);
      return s;
    }

    const attacks = Array.from(groups.values()).map(a => {
      a.onsetSec = secOf(a.onsetW);
      a.heads.forEach(h => { h.offSec = secOf(h.offW); });
      a.midis = a.heads.map(h => h.midi).slice().sort((x, y) => x - y);
      return a;
    });
    attacks.sort((x, y) => R.cmp(x.onsetW, y.onsetW) || (x.limb < y.limb ? -1 : x.limb > y.limb ? 1 : 0));
    return attacks;
  }

  return Object.freeze({ attacksOf, DEFAULT_QPM });
});
