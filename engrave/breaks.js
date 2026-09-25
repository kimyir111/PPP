/* ============================================================================
   PPP engrave — screen line breaking (docs/GOALS/G04 §15.2, user decision G4-U4)

   G4-U4: four bars a system on a desktop and two on a phone are the PREFERRED
   targets, not fixed rules - density and width win: a dense passage takes
   fewer bars, a sparse one may take more, and a lone last measure is avoided
   where the measures allow. Printing (G4e) breaks by density alone (§15.5).

   A dynamic program over the measures. A system [i..j] is feasible when its
   narrowest layout (every spring at its rod) fits the width with 5 % to spare
   (the app's rule), or when it is a single measure (that one is laid out even
   if it overflows, and the layout says so). Its cost:

     count     C_COUNT · (bars − N)²                  the preference, not a rule
     compress  C_COMPRESS · (1 − s)²   when s < 1     s = width / natural width
     sparse    C_SPARSE · (s − S_SPARSE)² when s > S_SPARSE    (not on the last
                                                       system: it may be ragged)
     one bar   C_ONE                   a one-bar system when the piece has more
     lone last C_LONE                  a one-bar LAST system when the piece has more

   The natural width is the system at u = 4 sp per quarter note (§15.5). The
   last system pays the count only above N (a short last line is ordinary).
   A line stretched past 1.5 times its natural width is sparse enough that one
   more bar costs less (G4-U4: "성기면 늘릴 수도 있다") - four 2/4 bars of half
   notes on a desktop become five; four 4/4 bars of whole notes stay four.
   The total is minimised; costs are compared to 1e-9 and ties go to the
   earliest start of the last system considered (longer systems first), so the
   same measures always break the same way.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).breaks = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COST = Object.freeze({ C_COUNT: 12, C_COMPRESS: 400, C_SPARSE: 60, S_SPARSE: 1.5, C_ONE: 50, C_LONE: 60, SLACK: 1.05, MAX_BARS: 12 });

  /* one system's cost; {minWidth, natural} of bars [i..j] at the given width */
  function systemCost(p) {
    const k = p.bars, N = p.target;
    if (k > 1 && p.minWidth * COST.SLACK > p.width) return Infinity;
    const s = p.natural > 0 ? p.width / p.natural : 1;
    let c = 0;
    if (!p.last || k > N) c += COST.C_COUNT * (k - N) * (k - N);
    if (s < 1) c += COST.C_COMPRESS * (1 - s) * (1 - s);
    if (!p.last && s > COST.S_SPARSE) c += COST.C_SPARSE * (s - COST.S_SPARSE) * (s - COST.S_SPARSE);
    if (k === 1 && p.total > 1 && N >= 2) c += p.last ? COST.C_LONE : COST.C_ONE;
    return c;
  }

  /* measure(i, j, last) -> {minWidth, natural} for bars i..j (inclusive) set as one system (last: it ends the piece).
     forced: Set of measure indices that must start a system (the source's breaks, when honoured).
     -> {systems: [[i, j], ...], cost} */
  function breakLines(count, target, width, measure, forced) {
    forced = forced || new Set();
    const best = new Array(count + 1).fill(Infinity), from = new Array(count + 1).fill(-1);
    best[0] = 0;
    for (let j = 1; j <= count; j++) {
      /* the last system of the prefix [0..j-1] is [i..j-1]; longer systems are tried first */
      const lo = Math.max(0, j - COST.MAX_BARS);
      for (let i = lo; i < j; i++) {
        if (!isFinite(best[i])) continue;
        let blocked = false;
        for (let f = i + 1; f < j; f++) if (forced.has(f)) { blocked = true; break; }
        if (blocked) continue;
        const m = measure(i, j - 1, j === count);
        const c = systemCost({ bars: j - i, target: target, width: width, minWidth: m.minWidth, natural: m.natural, last: j === count, total: count });
        if (!isFinite(c)) continue;
        const t = best[i] + c;
        if (t < best[j] - 1e-9) { best[j] = t; from[j] = i; }
      }
      /* nothing fits (a measure wider than the width, or forced breaks): that measure alone, overflowing */
      if (from[j] < 0) { best[j] = (isFinite(best[j - 1]) ? best[j - 1] : 0) + COST.C_ONE; from[j] = j - 1; }
    }
    const systems = [];
    for (let j = count; j > 0; j = from[j]) systems.unshift([from[j], j - 1]);
    return { systems: systems, cost: best[count] };
  }

  return Object.freeze({ COST, systemCost, breakLines });
});
