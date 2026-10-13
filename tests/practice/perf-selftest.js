/* G11a-0: the perf check checked. perf.js decides RED or green from numbers; this feeds it numbers made up from the committed baselines
   (no browser, no clock: a second or two) and holds three things:
     1. a probe on a machine that is 1.0x, 1.2x, 1.4x, 2x or 3x as slow as the baseline's, with a ten percent noise on every time, is green:
        the limits grow with the calibration ratio, the +20 % band stays on top;
     2. a REAL regression is red at every one of those machine speeds: a planted 2x slowdown of the matcher (begin, noteOn, wrong key, result)
        or of the plan build is red in the batch means that hold the line, at CPU 1x and at 4x (the smallest slowdown each profile can see is
        printed);
     3. what must not pass does not: a machine over 3x slower than the baseline's (it cannot be measured with), a probe whose CPU throttle
        never took hold, and counters that say the probe measured nothing.
   Run by the practice-perf job before the probe, and by hand: node tests/practice/perf-selftest.js */
'use strict';
const fs = require('fs');
const P = require('./perf');

const file = JSON.parse(fs.readFileSync(P.BASELINE, 'utf8'));
let failed = 0, checks = 0;
const ok = (name, cond, detail) => {
  checks++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' - ' + detail : ''));
  if (!cond) failed++;
};

const MATCHER = /^r[14]\.(matcher\.(noteOnMean|wrongMean|resultMean)|unit\.beginMean)$/;
const PLAN = /^r[14]\.unit\.buildMean$/;

/* A probe as flatten() makes it, from a baseline profile: every time is the baseline's, times `ratio` (a slower machine), times `noise`, and
   times 2 for the keys `plant` picks; the calibration is the baseline's times `ratio`. */
function synth(base, ratio, noise, plant, cpu, mismatch) {
  const v = {};
  Object.keys(base.metrics).forEach(k => {
    const spec = P.specOf(k), b = base.metrics[k];
    if (b.v == null) return;
    v[k] = spec.kind === 'count' ? b.v : b.v * ratio * noise * (mismatch || 1) * (plant && plant.test(k) ? 2 : 1);
  });
  return {
    calib: { r1: base.calib.r1 * ratio, r4: base.calib.r4 * ratio }, v: v, exact: Object.assign({}, base.exact), long: {},
    machine: { cpu: cpu || base.machine.cpu },
    throttle: { r1: { valid: true }, r4: { before: 4.2, after: 4.2, tries: 1, valid: true } }
  };
}
const redKeys = res => res.rows.filter(r => r.status === 'RED').map(r => r.k);

Object.keys(file.profiles).forEach(name => {
  const base = file.profiles[name];
  console.log('profile ' + name);
  for (const ratio of [1.0, 1.2, 1.4, 2.0, 3.0]) {
    const res = P.compareRuns(base, [synth(base, ratio, 1.1)]);
    ok('a machine ' + ratio + 'x as slow, every time 10 % noisier, is green', res.red === 0, res.red ? redKeys(res).join(' ') : '');
  }
  for (const ratio of [1.0, 1.4]) {
    [['the matcher', MATCHER], ['the plan build', PLAN]].forEach(([what, re]) => {
      const res = P.compareRuns(base, [synth(base, ratio, 1.0, re)]);
      const want = Object.keys(base.metrics).filter(k => re.test(k));
      const got = redKeys(res);
      const missing = want.filter(k => got.indexOf(k) < 0);
      ok('a planted 2x slowdown of ' + what + ' is red at calibration ratio ' + ratio + ' (' + want.length + ' means at CPU 1x and 4x)', want.length >= 2 && !missing.length,
        missing.length ? 'NOT red: ' + missing.join(' ') : got.length + ' red');
      ok('... and nothing else is red', got.every(k => want.indexOf(k) >= 0), got.filter(k => want.indexOf(k) < 0).join(' '));
    });
  }
  /* another CPU model than the baseline's: the calibration does not predict every workload (up to 40 % off, measured), the band is 45 % */
  const OTHER = 'Some Other CPU 3000';
  for (const ratio of [1.0, 1.4]) {
    const res = P.compareRuns(base, [synth(base, ratio, 1.0, null, OTHER, 1.4)]);
    ok('another CPU model, ' + ratio + 'x as slow and every workload 40 % off the calibration, is green', res.red === 0, redKeys(res).join(' '));
    [['the matcher', MATCHER], ['the plan build', PLAN]].forEach(([what, re]) => {
      const planted = P.compareRuns(base, [synth(base, ratio, 1.0, re, OTHER, 1.0)]);
      const want = Object.keys(base.metrics).filter(k => re.test(k));
      const missing = want.filter(k => redKeys(planted).indexOf(k) < 0);
      ok('another CPU model: a planted 2x slowdown of ' + what + ' is still red at calibration ratio ' + ratio, !missing.length, missing.length ? 'NOT red: ' + missing.join(' ') : '');
    });
  }
  const clean = P.compareRuns(base, [synth(base, 1.0, 1.0)]);
  const seen = clean.rows.filter(r => (MATCHER.test(r.k) || PLAN.test(r.k)) && r.limit != null).map(r => [r.limit / r.base, r.k]).sort((a, b) => a[0] - b[0]);
  console.log('  (a slowdown of the matcher or the plan build is seen from x' + seen[0][0].toFixed(2) + ' (' + seen[0][1] + ') to x' + seen[seen.length - 1][0].toFixed(2) + ' (' + seen[seen.length - 1][1] + '))');
  /* the best of several probes: one slow draw in three does not turn a clean run red, and the planted slowdown stays red in all three */
  const mixed = P.compareRuns(base, [synth(base, 1.4, 1.5), synth(base, 1.4, 1.0), synth(base, 1.4, 1.6)]);
  ok('the best of three probes counts (one clean probe among noisy ones is green)', mixed.red === 0, redKeys(mixed).join(' '));
  const planted3 = P.compareRuns(base, [synth(base, 1.4, 1.0, MATCHER), synth(base, 1.4, 1.0, MATCHER), synth(base, 1.4, 1.0, MATCHER)]);
  ok('a slowdown planted in all three probes is red', Object.keys(base.metrics).filter(k => MATCHER.test(k)).every(k => redKeys(planted3).indexOf(k) >= 0));
  if (name === 'ci') {
    /* the draw of the runner pool that turned practice-perf red on PR 230 (run 37750030861): calibration 149.4 / 149.5 ms against the baseline's
       108.2 / 107.6, and a cold first r1.unit.begin of 14.5 ms against a baseline best of 6.6 (its own probes ran 6.6-11.9) */
    const real = synth(base, 1.0, 1.0);
    real.calib = { r1: 149.4, r4: 149.5 };
    Object.keys(real.v).forEach(k => { if (P.specOf(k).kind !== 'count') real.v[k] = base.metrics[k].v * 1.382; });
    real.v['r1.unit.begin'] = 14.5;
    ok('the slow draw of the runner pool of run 37750030861 (machine x1.38, a cold begin of 14.5 ms) is green', P.compareRuns(base, [real]).red === 0, redKeys(P.compareRuns(base, [real])).join(' '));
    /* run 37751245427: an EPYC 7763 (calibration 153.4 / 153.7, x1.42) against a baseline recorded on an EPYC 9V45; r4.unit.beginMean came out
       3.634 ms after the calibration (base 2.487, 5.16 ms raw) and r4.long.entry counted 3 tasks over 50 ms (72-95 ms) against a base of 1 */
    const real2 = synth(base, 1.0, 1.0, null, 'AMD EPYC 7763 64-Core Processor');
    real2.calib = { r1: 153.4, r4: 153.7 };
    Object.keys(real2.v).forEach(k => { if (P.specOf(k).kind !== 'count') real2.v[k] = base.metrics[k].v * 1.42; });
    real2.v['r4.unit.beginMean'] = 5.16;
    real2.long = { 'r4.entry': [72, 80, 95], 'r4.play': [], 'r1.entry': [], 'r1.play': [] };
    real2.v['r4.long.entry'] = 3;
    ok('the slow EPYC 7763 draw of run 37751245427 (beginMean +46 % after the calibration, 3 entry long tasks at 4x) is green', P.compareRuns(base, [real2]).red === 0, redKeys(P.compareRuns(base, [real2])).join(' '));
  }
  /* what must not pass */
  const tooSlow = P.compareRuns(base, [synth(base, 4.0, 1.0)]);
  ok('a machine 4x as slow as the baseline\'s (over the 3x that can be measured with) is red', tooSlow.red > 0);
  const noThrottle = synth(base, 1.0, 1.0);
  noThrottle.throttle.r4 = { before: 1.2, after: 1.1, tries: 3, valid: false };
  const nt = P.compareRuns(base, [noThrottle]);
  ok('a probe whose CPU throttle never took hold is red (no 4x number is trusted)', redKeys(nt).indexOf('r4.throttle') >= 0);
  const empty = synth(base, 1.0, 1.0);
  empty.exact['r1.strikes'] = 0;
  empty.exact['r4.paintSamples'] = 3;
  const em = P.compareRuns(base, [empty]);
  ok('counters that say nothing was measured are red', redKeys(em).indexOf('r1.strikes') >= 0 && redKeys(em).indexOf('r4.paintSamples') >= 0);
  const long = synth(base, 1.0, 1.0);
  long.v['r1.long.play'] = base.metrics['r1.long.play'].v + 3;
  ok('three more long tasks than the baseline in 8 s of play at CPU 1x is red', redKeys(P.compareRuns(base, [long])).indexOf('r1.long.play') >= 0);
  /* the cold single shot is held to the baseline's slowest probe, not its luckiest */
  const b = base.metrics['r1.unit.begin'];
  const cold = synth(base, 1.0, 1.0);
  cold.v['r1.unit.begin'] = b.spread[1];
  ok('a cold begin as slow as the slowest of the baseline\'s own probes is green', P.compareRuns(base, [cold]).red === 0);
  cold.v['r1.unit.begin'] = b.spread[1] * 1.2 + 2.5 + 1;
  ok('a cold begin 20 % + 2.5 ms slower than that is red', redKeys(P.compareRuns(base, [cold])).indexOf('r1.unit.begin') >= 0);
});

console.log('\n' + checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
process.exit(failed ? 1 : 0);
