'use strict';
/* Wall-clock budgets in the tests that run under `node --test`: how they are measured, and why.

   `node --test` runs every test file in a process of its own, as many at a time as the machine has CPUs minus one, so a budget
   test measures while its neighbours run. One timed call then measures the neighbours too: sonatina/020's plan() took 60 ms on a
   free core of the development machine and 210-280 ms on the CI runner (budget 200 ms), and the gate on main was red for it from
   2b1aa44, which added one more test file to tests/arrangement (reproduced: the same suite on 4 logical cores read a median of
   74 ms before that file and 115 ms with it, the worst call 111 ms and 183 ms). A budget is held like this:
     - one call to warm up (JIT, caches), whose time is not counted;
     - then SAMPLES timed calls, and the MEDIAN is held to the budget: a neighbour's burst spoils a sample or two, not the middle
       one, and a code path that really became slower is slower in every sample, so it still fails;
     - the samples are printed (t.diagnostic) and are in the failure message, so the margin on the runner is in the log.
   Where the number is a ratio of two sizes (a growth check), the fastest of each (bestOfPair) is right while the noise is bursts:
   noise only adds to a time, so the fastest sample of each size is the least disturbed one. It is not right when the machine is
   busy for the whole test, because then the two fastest samples can come from different stretches of it: the A30 export check
   read 3.0x for a bound of 3.0 on code that is linear (the nightly of 2026-10-13, 235 -> 709 ms, the fastest of five of each), and
   busy loops on the 2 cores the check was pinned to reproduced it: the fastest-of-5 ratio read 3.03 and 3.50 in 2 of 13 runs
   with 3 loops, and 3.4, 4.2, 5.2 and 6.4 in 4 of 20 runs of the whole test with 6, where the medians of the per-pair ratios
   were 1.6-2.8 in the 13 and 2.1-2.7 in 10 runs of the new test. So a growth check takes pairRatios: the two sizes timed
   back to back, in turns, so that a pair shares its stretch of the machine, and the MEDIAN of the per-pair ratios is held to
   the bound. A growth that is wrong in the count of the work (a scan per measure) is better caught by counting that work, as the
   reads test in tests/scoregraph/musicxml.test.js does; the clock is the sanity bound over it.
   (tests/engrave/plan.test.js B1 and tests/scoregraph/g3-perf.test.js already take the fastest of five / of three for the same
   reason; tests/arrangement/perf.test.js also runs alone, see its header.) */
const SAMPLES = 5;
/* A budget is written for a normal machine, and the CI runner is not one: the analyze + fingering of sonatina/020 that takes 24-35 ms on
   the development machine took a median of 105 ms on the runner (all five samples 91-117 ms, 4 CPUs, 2026-10-07), against a 150 ms budget,
   and 155 and 171 ms in the two runs that failed on it; over 23 runs the slowest test took 1.4x as long as the median one. So where a test holds a
   budget that has under 2x of room on the runner, it writes budget(ms): under CI (GitHub Actions sets CI=true) the budget is CI_FACTOR times
   as much, so that a code path that became 3x slower still fails there, and on a machine without CI it is the number written. */
const CI_FACTOR = 2;
const budget = ms => (process.env.CI ? ms * CI_FACTOR : ms);
const now = () => process.hrtime.bigint();
const msSince = t0 => Number(process.hrtime.bigint() - t0) / 1e6;

/* fn() once to warm up, then n timed calls; returns the n times in ms, in call order */
function samples(fn, n) {
  n = n || SAMPLES;
  fn();
  const out = [];
  for (let i = 0; i < n; i++) { const t0 = now(); fn(); out.push(msSince(t0)); }
  return out;
}
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const fmt = xs => xs.map(x => x.toFixed(1)).join(', ');
/* "median 61.2 ms of [60.1, 61.2, 59.8, 70.3, 61.9]" */
const describe = xs => 'median ' + median(xs).toFixed(1) + ' ms of [' + fmt(xs) + ']';
/* the fastest of two sizes measured in turns, so that a slow stretch of the machine spoils both alike: [fastest of a, fastest of b] */
function bestOfPair(fa, fb, n) {
  n = n || SAMPLES;
  fa(); fb();
  let a = Infinity, b = Infinity;
  for (let i = 0; i < n; i++) {
    let t0 = now(); fa(); a = Math.min(a, msSince(t0));
    t0 = now(); fb(); b = Math.min(b, msSince(t0));
  }
  return [a, b];
}

/* a growth check by pairs: fa() and fb() once each to warm up, then n pairs timed back to back (fa, then fb), in turns. Returns
   { a, b, ratios }: the times of each size, and b/a of every pair, in call order; the caller holds median(ratios) to its bound. */
function pairRatios(fa, fb, n) {
  n = n || SAMPLES;
  fa(); fb();
  const a = [], b = [];
  for (let i = 0; i < n; i++) {
    let t0 = now(); fa(); a.push(msSince(t0));
    t0 = now(); fb(); b.push(msSince(t0));
  }
  return { a, b, ratios: a.map((x, i) => b[i] / x) };
}

module.exports = { SAMPLES, CI_FACTOR, budget, samples, median, describe, bestOfPair, pairRatios };
