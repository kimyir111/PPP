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
   Where the number is a ratio of two sizes (a growth check), take the fastest of each (bestOfPair): noise only adds to a time, so
   the fastest sample of each size is the least disturbed one, and the ratio of the two is the one the code owns.
   (tests/engrave/plan.test.js B1 and tests/scoregraph/g3-perf.test.js already take the fastest of five / of three for the same
   reason; tests/arrangement/perf.test.js also runs alone, see its header.) */
const SAMPLES = 5;
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
/* the same for a function that returns a promise */
async function samplesAsync(fn, n) {
  n = n || SAMPLES;
  await fn();
  const out = [];
  for (let i = 0; i < n; i++) { const t0 = now(); await fn(); out.push(msSince(t0)); }
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

module.exports = { SAMPLES, samples, samplesAsync, median, describe, bestOfPair };
