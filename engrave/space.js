/* ============================================================================
   PPP engrave — horizontal spacing: springs and rods (docs/GOALS/G04 §9, G4-D11)

   Between two neighbouring columns i and i+1 of a system (every staff and voice
   shares the columns: what sounds together is drawn together) sits a spring
   whose ideal length grows with the time between them,

       ideal(Δ) = u · (Δ / Δref)^ALPHA        ALPHA = 0.65, Δref = a quarter note

   and a rod, the least distance the glyphs on either side need (layout.js).
   The distance is max(ideal, rod). One `u` stretches a whole system; solve()
   finds the `u` that makes the system exactly as wide as asked - exactly, not
   by bisection: width(u) is piecewise linear and increasing, so the springs
   are sorted by the `u` at which each outgrows its rod, and the one linear
   piece that reaches the width is solved (§9.4). No random, no clock, a fixed
   summation order: the same springs give the same `u` on every machine.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).space = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALPHA = 0.65;
  const DREF = 0.25;              /* a quarter note, in whole notes */
  /* the u at which a quarter note's ideal space is 4.0 sp: a system's natural width (§15.5) */
  const U_NATURAL = 4.0;

  /* the spring factor for a time step of `delta` whole notes (0 for a column that takes no time) */
  const factor = delta => (delta > 0 ? Math.pow(delta / DREF, ALPHA) : 0);

  /* springs: [{g, rod}] (g >= 0, rod >= 0); fixed: everything that does not stretch */
  function minWidth(springs, fixed) {
    let w = fixed;
    for (let i = 0; i < springs.length; i++) w += springs[i].rod;
    return w;
  }
  function width(springs, fixed, u) {
    let w = fixed;
    for (let i = 0; i < springs.length; i++) w += Math.max(u * springs[i].g, springs[i].rod);
    return w;
  }

  /* The u that makes width(u) = target. -> {u, width, overflow}: overflow when even u = 0 (every spring at its rod)
     is wider than the target; then u = 0 and width is that minimum. */
  function solve(springs, fixed, target) {
    const order = [];
    for (let i = 0; i < springs.length; i++) if (springs[i].g > 0) order.push(i);
    /* the u at which spring i outgrows its rod; ties in index order */
    const bp = i => springs[i].rod / springs[i].g;
    order.sort((a, b) => bp(a) - bp(b) || a - b);
    let rest = minWidth(springs, fixed);           /* the rods still in force, and the fixed part */
    if (rest >= target) return { u: 0, width: rest, overflow: rest > target + 1e-9 };
    let G = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k], b = bp(i);
      if (rest + b * G >= target) return { u: G > 0 ? (target - rest) / G : b, width: target, overflow: false };
      rest -= springs[i].rod;
      G += springs[i].g;
    }
    if (G > 0) return { u: (target - rest) / G, width: target, overflow: false };
    /* nothing can stretch (no column takes time): the minimum, short of the target */
    return { u: 0, width: rest, overflow: false };
  }

  /* the distances between the columns for a given u */
  function distances(springs, u) { return springs.map(s => Math.max(u * s.g, s.rod)); }

  return Object.freeze({ ALPHA, DREF, U_NATURAL, factor, minWidth, width, solve, distances });
});
