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
  /* print's cost (G04 §15.5, G4-E1): a Knuth-Plass-style DP, density alone (no preferred bar count). Cost of one
     system spanning bars i..j: 100 * (stretch - 1.15)^2, stretch = width / natural width (a system at u = 4 sp per
     quarter is its natural width); a one-bar system (when the piece has more than one bar) costs +50 - the DP's own
     minimisation is what "excludes it if avoidable": the penalty only stays paid when no other break does better, so
     nothing more than this constant is needed to satisfy "avoided unless unavoidable". 1-6 bars a system. The last
     system may be ragged: PCOST.RAGGED_LAST reads it as "if the last system, held to the same width as the others,
     would need compressing below its natural width (stretch < 1), that compression is free - there is no other
     system to move those bars to. A last system with room to spare (stretch >= 1, the ordinary case of a short
     trailing line) still pays the usual distance from 1.15, so the DP does not strand a lone bar there when pulling
     one back from the system before it would look better; layout.js renders that short last system unstretched
     (ragged) when it is comfortably under the width, the same "ragged" rendering the screen breaker already gives
     its own last system. */
  const PCOST = Object.freeze({ TARGET: 1.15, K: 100, ONE: 50, SLACK: 1.05, MAX_BARS: 6 });
  function printSystemCost(p) {
    if (p.bars > 1 && p.minWidth * PCOST.SLACK > p.width) return Infinity;
    const s = p.natural > 0 ? p.width / p.natural : 1;
    let c = (p.last && s < 1) ? 0 : PCOST.K * (s - PCOST.TARGET) * (s - PCOST.TARGET);
    if (p.bars === 1 && p.total > 1) c += PCOST.ONE;
    return c;
  }

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

  /* print line breaking (G04 §15.5, G4-E1): the same shape of DP as breakLines (measure(i, j, last) -> {minWidth,
     natural}, forced: a Set of measure indices that must start a system), width fixed (print does not justify to a
     preferred bar count), 1-6 bars a system, printSystemCost's density-only cost. A separate function, not a
     parameterisation of breakLines, so the screen breaker (already reviewed, its committed hashes depended on) is
     never touched by this change - zero shared mutable state, no risk of moving the screen's output. */
  function printBreakLines(count, width, measure, forced, banned) {
    forced = forced || new Set();
    banned = banned || new Set();
    const best = new Array(count + 1).fill(Infinity), from = new Array(count + 1).fill(-1);
    best[0] = 0;
    for (let j = 1; j <= count; j++) {
      const lo = Math.max(0, j - PCOST.MAX_BARS);
      for (let i = lo; i < j; i++) {
        if (!isFinite(best[i])) continue;
        /* a bar a multi-measure rest merges (G4-E2) may not start a system: whatever system holds the bar before it
           must hold it too, so the run stays whole (its own kind of "never split a system", §15.5) */
        if (banned.has(i)) continue;
        let blocked = false;
        for (let f = i + 1; f < j; f++) if (forced.has(f)) { blocked = true; break; }
        if (blocked) continue;
        const m = measure(i, j - 1, j === count);
        const c = printSystemCost({ bars: j - i, width: width, minWidth: m.minWidth, natural: m.natural, last: j === count, total: count });
        if (!isFinite(c)) continue;
        const t = best[i] + c;
        if (t < best[j] - 1e-9) { best[j] = t; from[j] = i; }
      }
      if (from[j] < 0) { best[j] = (isFinite(best[j - 1]) ? best[j - 1] : 0) + PCOST.ONE; from[j] = j - 1; }
    }
    const systems = [];
    for (let j = count; j > 0; j = from[j]) systems.unshift([from[j], j - 1]);
    return { systems: systems, cost: best[count] };
  }

  return Object.freeze({ COST, systemCost, breakLines, PCOST, printSystemCost, printBreakLines });
});
