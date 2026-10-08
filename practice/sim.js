/* ============================================================================
   PPP practice simulator - synthetic learners (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4, G11-D9, phase G11b-0)

   A pure UMD module (Node + browser; global PPPPracticeSim). No DOM, no clock, no Math.random: every draw comes from
   a seeded LCG, so a learner is a function of (type, piece, seed).

   WHAT THIS IS, HONESTLY. A synthetic learner is a set of ASSUMPTIONS about how practice changes playing, written as
   formulas with parameter ranges. None of it is fitted to a real person: PPP has no logged practice to fit it to
   (G11 E8-E10: no per-note data is kept, Demo Input runs are random, nothing leaves the device). It exists to check
   MECHANICS - that a policy converges, does not loop, spends time where the (simulated) weakness is, is stable, and
   is not worse than the legacy policy for any learner type (G11-D9). Whether any policy helps a real pupil is H-11's
   question (the user's week with a MIDI keyboard, §10.1), and the simulator cannot answer it.

   ---- The learner (one per type x piece x seed) ----
   Per measure index i and hand h (r/l) a latent skill s (log-odds), and per measure a recall trace r (memory work):

     P(hit) = sigma( s - d[i][h] * rho^1.5 - c - chi*[both hands] - lambda*fatigue ) * memory(i)  , at most 1 - slip
       d        G6's per-measure, per-hand difficulty of the real piece (tests/practice-sim/pieces.js)
       rho      the lap's tempo / the score tempo
       c        a general offset (0 for every type today: mu, the starting skill, carries the level); chi the cost of coordinating two hands; slip a floor of random slips
       memory   in memory mode at level L, with f = the app's MEMORY.hideFraction[L]: (1 - f) + f * sigma(r)
     timing     a struck note lands at  bias * rho^1.5 * (0.5 + 0.5(1-P))  +  sigma0 (0.6 + 0.4 rho)(1 + (1-P)) * N(0,1)
                ms from its target (chord notes share the onset's draw, plus 8 ms each); a note further than the app's
                window from its target is not matched by the app's matcher, as it would not be in the page
     a miss     is silence, or with probability `wrongKey` a key a semitone or two away at about the right time

   Practice (once per visit of a measure by a hand, i.e. a repeat played twice counts twice):
     s += eta * (1 - P) * min(1, P / 0.35) * (kappa if that hand alone, else 1) * (1 - fatigue/2)
          more gain the more there is to learn, less when the passage is so hard that almost nothing lands (a moderate
          challenge learns fastest); hands separately transfers the share kappa to hands together
     r += etaR * (1 - sigma(r)) * (0.2 + 0.8 f) * P   in memory mode;   etaR * 0.08 * (1 - sigma(r))   when reading
   Forgetting: s decays toward its starting value s0 with half-life h days, r toward r0 likewise; each further DAY an
   item is practised multiplies its h by (1 + phi), up to hMax (spacing consolidates).
   Fatigue: 0 for the first 10 minutes of a session, then rising by 1 per 20 minutes (at most 1).

   ---- The six types (G11 §7.4) ----  parameters are drawn per learner, uniformly from the ranges in TYPES.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPPracticeSim = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const DAY = 86400000;
  const MIN = 60000;

  /* ---------------------------------------------------------------- random */
  /* A 32-bit linear congruential generator (Numerical Recipes' a, c), the top 24 bits as a float. Integer arithmetic
     through Math.imul and >>> 0 only, so a seed gives the same sequence on every platform. */
  function rng(seed) {
    let st = (seed >>> 0) || 0x9e3779b9;
    const next = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st; };
    const float = () => (next() >>> 8) / 16777216;
    return {
      next, float,
      /* Irwin-Hall: twelve uniforms minus six, mean 0, variance 1, in [-6, 6]; no Math.log/cos, so no libm in the path */
      normal() { let s = 0; for (let i = 0; i < 12; i++) s += float(); return s - 6; },
      int(n) { return Math.floor(float() * n); },
      chance(p) { return float() < p; },
      state() { return st; }
    };
  }
  /* FNV-1a over a string: a seed from names, so no simulation's seed depends on the order the others ran in */
  function hashSeed(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function sigma(x) { return 1 / (1 + Math.exp(-x)); }

  /* ---------------------------------------------------------------- types */
  /* Ranges [lo, hi]; every learner draws each one uniformly. Units: log-odds (mu, leftOffset, chi, lambda), per
     repetition (eta, etaR), share (kappa, slip, wrongKey), ms (bias, sigma0), days (halfLife, hMax), per day (phi). */
  const BASE = {
    mu: [2.0, 2.6], spread: [0.25, 0.4], leftOffset: [0, 0], c: [0, 0], chi: [0.35, 0.6], lambda: [0.2, 0.4],
    eta: [0.10, 0.15], kappa: [0.5, 0.7], etaR: [0.25, 0.4], r0: [-3, -2.5],
    bias: [-12, 12], sigma0: [28, 40], slip: [0.005, 0.015], wrongKey: [0.25, 0.4],
    halfLife: [6, 10], phi: [0.25, 0.45], hMax: [40, 60]
  };
  const TYPES = {
    even: {},
    'weak-left': { leftOffset: [-1.5, -0.9] },
    rushing: { bias: [-115, -75], sigma0: [45, 60] },
    slow: { eta: [0.035, 0.06], etaR: [0.1, 0.18] },
    forgetter: { halfLife: [1.5, 3], phi: [0.08, 0.18], hMax: [8, 14] },
    beginner: { mu: [1.0, 1.6], chi: [0.8, 1.1], lambda: [0.5, 0.8], sigma0: [50, 70], eta: [0.08, 0.12], wrongKey: [0.4, 0.6], slip: [0.015, 0.03] }
  };
  const TYPE_NAMES = Object.keys(TYPES);
  function rangesOf(type) {
    if (!TYPES[type]) throw new Error('PPPPracticeSim: unknown learner type ' + type);
    return Object.assign({}, BASE, TYPES[type]);
  }

  /* ---------------------------------------------------------------- the learner */
  /* piece: { id, measures: [{ index, d: {r, l}, notes: {r, l} }] }; t0 the time (ms) the learner starts at */
  function makeLearner(type, piece, seed, t0) {
    const g = rng(seed);
    const ranges = rangesOf(type);
    const p = {};
    Object.keys(ranges).sort().forEach(k => { const [lo, hi] = ranges[k]; p[k] = lo + (hi - lo) * g.float(); });
    const item = (hand) => {
      const s0 = p.mu + (hand === 'l' ? p.leftOffset : 0) + p.spread * g.normal();
      return { s0: s0, s: s0, h: p.halfLife, at: t0, lastDay: null };
    };
    const items = piece.measures.map(m => ({
      r: item('r'), l: item('l'),
      recall: { s0: p.r0, s: p.r0, h: p.halfLife * 0.7, at: t0, lastDay: null },
      d: m.d, notes: m.notes
    }));
    return { type: type, seed: seed >>> 0, params: p, items: items, t: t0 };
  }

  /* forgetting, lazily: an item's learned part decays toward s0 with its half-life */
  function decay(it, t) {
    if (t > it.at) {
      it.s = it.s0 + (it.s - it.s0) * Math.pow(2, -((t - it.at) / DAY) / it.h);
      it.at = t;
    }
  }
  function advance(learner, t) {
    learner.items.forEach(m => { decay(m.r, t); decay(m.l, t); decay(m.recall, t); });
    learner.t = t;
  }
  function fatigueAt(minutesIn) { return Math.max(0, Math.min(1, (minutesIn - 10) / 20)); }

  /* the technical probability of a hit (no memory factor) */
  function pTech(learner, i, hand, ctx) {
    const p = learner.params, m = learner.items[i];
    const x = m[hand].s - m.d[hand] * Math.pow(ctx.ratio, 1.5) - p.c - (ctx.both ? p.chi : 0) - p.lambda * (ctx.fatigue || 0);
    return Math.min(1 - p.slip, sigma(x));
  }
  function pHit(learner, i, hand, ctx) {
    const pt = pTech(learner, i, hand, ctx);
    const f = ctx.hide || 0;
    return f > 0 ? pt * ((1 - f) + f * sigma(learner.items[i].recall.s)) : pt;
  }

  /* The note-weighted, rested, hands-together, reading (no memory) accuracy of every measure at a tempo ratio: the
     simulator's ground truth, which no policy sees. null for a measure with no notes. */
  function truth(learner, ratio) {
    const ctx = { ratio: ratio, both: true, fatigue: 0, hide: 0 };
    return learner.items.map((m, i) => {
      const n = m.notes.r + m.notes.l;
      if (!n) return null;
      return (m.notes.r * pTech(learner, i, 'r', ctx) + m.notes.l * pTech(learner, i, 'l', ctx)) / n;
    });
  }

  /* One lap. notes: the app matcher's expected list, as [{ midi, tMs, i (measure index), hand, rep (visit key), q }] in
     the matcher's order; ctx: { ratio, both, hide, fatigue }. Returns the key presses (sorted by time, then pitch)
     and the repetitions practised, without changing the learner (practise() does that, after the lap). */
  function perform(learner, notes, ctx, g) {
    const p = learner.params;
    const events = [];
    const reps = new Map();
    const onset = new Map();          /* one timing draw per (rep, onset, hand): a chord's notes land together */
    notes.forEach(n => {
      const P = pHit(learner, n.i, n.hand, ctx);
      const Pt = pTech(learner, n.i, n.hand, ctx);
      const key = n.rep + '|' + n.hand;
      if (!reps.has(key)) reps.set(key, { i: n.i, hand: n.hand, P: Pt, Pm: P });
      const ok = key + '|' + n.q;
      let dt = onset.get(ok);
      if (dt == null) {
        const bias = p.bias * Math.pow(ctx.ratio, 1.5) * (0.5 + 0.5 * (1 - Pt));
        const sd = p.sigma0 * (0.6 + 0.4 * ctx.ratio) * (1 + (1 - Pt));
        dt = bias + sd * g.normal();
        onset.set(ok, dt);
      }
      if (g.float() < P) {
        events.push({ type: 'on', midi: n.midi, t: n.tMs + dt + 8 * g.normal(), velocity: 64 });
      } else if (g.float() < p.wrongKey) {
        const step = (g.float() < 0.5 ? -1 : 1) * (1 + g.int(2));
        events.push({ type: 'on', midi: Math.max(21, Math.min(108, n.midi + step)), t: n.tMs + dt + 8 * g.normal(), velocity: 64 });
      }
    });
    events.sort((a, b) => a.t - b.t || a.midi - b.midi);
    return { events: events, reps: [...reps.values()] };
  }

  /* After a lap: every repetition practised raises its hand's skill, and the measure's recall trace; a new day of
     practice consolidates (h grows). day: the session's day index. */
  function practise(learner, reps, ctx, day) {
    const p = learner.params;
    const fat = 1 - (ctx.fatigue || 0) / 2;
    const touched = new Set();
    reps.forEach(rp => {
      const m = learner.items[rp.i];
      const it = m[rp.hand];
      const P = rp.P;
      it.s += p.eta * (1 - P) * Math.min(1, P / 0.35) * (ctx.both ? 1 : p.kappa) * fat;
      const rs = sigma(m.recall.s);
      m.recall.s += ctx.hide > 0 ? p.etaR * (1 - rs) * (0.2 + 0.8 * ctx.hide) * P : p.etaR * 0.08 * (1 - rs);
      touched.add(it); touched.add(m.recall);
    });
    touched.forEach(it => {
      if (it.lastDay !== day) {
        if (it.lastDay != null) it.h = Math.min(p.hMax, it.h * (1 + p.phi));
        it.lastDay = day;
      }
    });
  }

  /* ---------------------------------------------------------------- metrics helpers */
  function brier(pairs) {
    if (!pairs.length) return null;
    let s = 0;
    pairs.forEach(([pred, obs]) => { s += (pred - obs) * (pred - obs); });
    return s / pairs.length;
  }
  function round(x, k) { if (x == null || !Number.isFinite(x)) return x == null ? null : x; const f = Math.pow(10, k == null ? 4 : k); return Math.round(x * f) / f; }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function summary(values) {
    const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return { n: 0, mean: null, median: null, p10: null, p90: null };
    return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, median: quantile(v, 0.5), p10: quantile(v, 0.1), p90: quantile(v, 0.9) };
  }

  return Object.freeze({
    VERSION, DAY, MIN, TYPES, TYPE_NAMES, BASE,
    rng, hashSeed, sigma, rangesOf, makeLearner, advance, fatigueAt, pTech, pHit, truth, perform, practise,
    brier, round, quantile, summary
  });
});
