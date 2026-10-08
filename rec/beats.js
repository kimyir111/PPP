/* ============================================================================
   PPP rec/ (G10a-1) - S1: pulse tracks (docs/GOALS/G10 section 8.1, "beats + tempo")

     tracks(attacks, opts) -> [{ period, strength, beats: [s], score }]   up to opts.maxTracks (default 6), opts.tight (100)
     audioTrack(times, attacks) -> a track of beat times the caller has (the helper's), or null
     position(beats, t) -> the continuous beat index of time t (linear between beats, extended past both ends)
     timeAt(beats, x)   -> the inverse: the time of beat index x

   A dynamic program over tempo and phase (Ellis 2007, the one audio-score.js's trackBeats already uses) finds, for one
   target period, the chain of beat times that best sits on the attacks while each step stays near the period: score(i) =
   salience(i) + max_j [score(j) - TIGHT * log((i - j) / p)^2], 10-ms frames, a step of 0.6 to 1.5 periods. The tracked pulse
   is not yet a written beat: it is a time warp. Which metrical level it is (an eighth, a quarter, a dotted quarter, a bar),
   which metre and where the bar lines go is S2's choice (rec/metre.js), made over every track at once, so a track at a level
   that is not metrical (a dotted quarter in 2/4) loses there rather than being trusted here. The candidate periods are the
   strongest peaks of the attack-pair interval histogram (every pair of attacks 60 ms to 4 s apart, on a log-period axis):
   the periods the performance repeats, not a tempo prior. Six tracks with TIGHT 100 left 11 % of rec-core's performances
   with no right reading on any track; four with 50, 15 % (G10 section 18).

   Deterministic: no random numbers; the same attacks give the same tracks on every platform (Math.log/exp only, which V8
   computes the same way everywhere). Node and browser (window.PPPRecModules.beats).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.beats = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FPS = 100;
  const P_LO = 0.18, P_HI = 1.6;          /* the band of candidate periods, seconds */
  const PAIR_MAX = 4.0;                   /* attack pairs further apart than this are not counted */
  const NB = 400;                          /* log-period histogram bins over [0.15, 4] s */
  const H_LO = Math.log(0.15), H_HI = Math.log(4.0);
  const TIGHT = 100;                       /* how firmly a step stays near the target period (the weights file sets it) */
  const MAX_TRACKS = 6;
  const DISTINCT = 0.08;                   /* two candidate periods closer than 8 % are one */

  function weightOf(a) { return 1 + 0.5 * Math.log2(a.n) + (a.low < 55 ? 0.5 : 0); }

  function salience(attacks, len) {
    const raw = new Float64Array(len);
    attacks.forEach(a => {
      const i = Math.round(a.t * FPS);
      if (i >= 0 && i < len) raw[i] += weightOf(a) + a.vel / 127;
    });
    /* a triangle of +-3 frames: an attack 30 ms off the beat still supports it */
    const env = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      if (!raw[i]) continue;
      for (let d = -3; d <= 3; d++) { const x = i + d; if (x >= 0 && x < len) env[x] += raw[i] * (4 - Math.abs(d)) / 4; }
    }
    return env;
  }

  /* the attack-pair interval histogram on a log-period axis (pairs 60 ms to 4 s apart, weighted by how full and how low
     each attack is), smoothed */
  function periodHistogram(attacks) {
    const h = new Float64Array(NB);
    for (let i = 0; i < attacks.length; i++) {
      const wi = weightOf(attacks[i]);
      for (let j = i + 1; j < attacks.length; j++) {
        const d = attacks[j].t - attacks[i].t;
        if (d < 0.06) continue;
        if (d > PAIR_MAX) break;
        const k = Math.floor((Math.log(d) - H_LO) / (H_HI - H_LO) * NB);
        if (k >= 0 && k < NB) h[k] += wi * weightOf(attacks[j]);
      }
    }
    const s = new Float64Array(NB);
    for (let k = 0; k < NB; k++) {
      let v = 0;
      for (let d = -3; d <= 3; d++) { const x = k + d; if (x >= 0 && x < NB) v += h[x] * Math.exp(-0.5 * d * d / 2.25); }
      s[k] = v;
    }
    return s;
  }
  const periodOf = k => Math.exp(H_LO + (k + 0.5) / NB * (H_HI - H_LO));

  function periodPeaks(attacks) {
    const s = periodHistogram(attacks);
    const peaks = [];
    for (let k = 1; k < NB - 1; k++) if (s[k] > s[k - 1] && s[k] >= s[k + 1] && s[k] > 0) peaks.push({ period: periodOf(k), strength: s[k] });
    peaks.sort((a, b) => b.strength - a.strength || a.period - b.period);
    return peaks;
  }

  /* candidate pulse periods: the strongest histogram peaks in the pulse band, at most `max`, no two within 8 % (a
     faster periodicity normalised per second of lag, or the tatum's multiples, were measured and lost: G10 section 18) */
  function candidatePeriods(attacks, max) {
    const out = [];
    periodPeaks(attacks).forEach(p => {
      if (out.length >= max || p.period < P_LO || p.period > P_HI) return;
      if (out.some(q => Math.abs(Math.log(p.period / q.period)) < DISTINCT)) return;
      out.push(p);
    });
    return out;
  }

  /* one DP over frames for one target period (seconds); returns beat times */
  function trackOne(env, period, tight) {
    const n = env.length;
    const p = period * FPS;
    const lo = Math.max(1, Math.round(p * 0.6)), hi = Math.round(p * 1.5);
    const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
    /* the penalty of a step of d frames, computed once (the same numbers as computing it in the loop) */
    const pen = new Float64Array(hi + 1);
    for (let d = lo; d <= hi; d++) { const r = Math.log(d / p); pen[d] = tight * r * r; }
    for (let i = 0; i < n; i++) {
      let best = 0, arg = -1;
      const j0 = Math.max(0, i - hi), j1 = i - lo;
      for (let j = j0; j <= j1; j++) {
        const v = score[j] - pen[i - j];
        if (v > best) { best = v; arg = j; }
      }
      score[i] = env[i] + best;
      back[i] = arg;
    }
    let end = n - 1, bv = -Infinity;
    for (let i = Math.max(0, n - Math.round(p * 1.5)); i < n; i++) if (score[i] > bv) { bv = score[i]; end = i; }
    const beats = [];
    for (let i = end; i >= 0; i = back[i]) { beats.push(i / FPS); if (back[i] < 0) break; }
    beats.reverse();
    return { beats: beats, score: bv };
  }

  /* the beats extended (at the end intervals) to cover [from, to] */
  function extend(beats, from, to) {
    if (beats.length < 2) return beats.slice();
    const out = beats.slice();
    while (out[0] > from) out.unshift(out[0] - (out[1] - out[0]));
    while (out[out.length - 1] < to) out.push(out[out.length - 1] + (out[out.length - 1] - out[out.length - 2]));
    return out;
  }

  function position(beats, t) {
    const n = beats.length;
    if (n < 2) return 0;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  }

  function timeAt(beats, x) {
    const n = beats.length;
    if (x <= 0) return beats[0] + x * (beats[1] - beats[0]);
    if (x >= n - 1) return beats[n - 1] + (x - (n - 1)) * (beats[n - 1] - beats[n - 2]);
    const k = Math.floor(x);
    return beats[k] + (x - k) * (beats[k + 1] - beats[k]);
  }

  function tracks(attacks, opts) {
    opts = opts || {};
    const max = opts.maxTracks || MAX_TRACKS;
    if (attacks.length < 2) return [];
    const first = attacks[0].t, last = attacks[attacks.length - 1].t;
    const env = salience(attacks, Math.ceil((last + 1) * FPS) + 1);
    const out = [];
    candidatePeriods(attacks, max).forEach(c => {
      const r = trackOne(env, c.period, opts.tight || TIGHT);
      const live = r.beats.filter(b => b >= first - c.period && b <= last + c.period);
      if (live.length < 2) return;
      const beats = extend(live, first - 0.05, last + 0.05);
      out.push({ period: c.period, strength: c.strength, beats: beats, score: r.score });
    });
    return out;
  }

  /* a track made of beat times the caller already has (the helper's audio beat tracker): sorted, doubles (< 20 ms)
     dropped, a gap of about k beats filled with k - 1 evenly spaced beats (a tracker misses beats), extended to cover
     the attacks. null when fewer than four beats remain.
     G10a-1d: opts.maxIrregular (the weights' `audioMaxIrregular`): null as well when more than that share of the filled track's
     intervals is outside 0.7-1.4 times their median or had to be filled in - the tracker changed its pulse level inside the piece (Beat This on the
     real covers of G10 section 36: one piece with 120 of 256 intervals under 0.6 of the median, beats a tenth of a second apart
     for half a minute), so it is no one pulse to read a metre on. The notes' own pulse tracks are read instead; the downbeats
     still count as phase evidence. */
  function audioTrack(times, attacks, opts) {
    const raw = (times || []).filter(Number.isFinite).slice().sort((a, b) => a - b).filter((t, i, a) => !i || t - a[i - 1] > 0.02);
    if (raw.length < 4 || attacks.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < raw.length; i++) gaps.push(raw[i] - raw[i - 1]);
    const med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    if (!(med > 0)) return null;
    const out = [raw[0]];
    let filled = 0;
    for (let i = 1; i < raw.length; i++) {
      const g = raw[i] - raw[i - 1], k = Math.round(g / med);
      if (k >= 2 && k <= 4 && Math.abs(g / k - med) < 0.25 * med) { for (let j = 1; j < k; j++) out.push(raw[i - 1] + g * j / k); filled += k - 1; }
      out.push(raw[i]);
    }
    if (opts && opts.maxIrregular != null) {
      /* the intervals still irregular after the filling, and the beats the filling had to add (a tracker that went to half its pulse for a
         while: one real cover had a third of its beats filled) */
      let bad = filled, extra = 0;
      for (let i = 1; i < out.length; i++) { const g = out[i] - out[i - 1]; if (g < 0.7 * med || g > 1.4 * med) bad++; if (g < 0.7 * med) extra++; }
      if (bad > opts.maxIrregular * (out.length - 1)) return null;
      /* an interval shorter than 0.7 of the median is a beat too many, and every later beat is then one off: opts.maxExtra (the weights'
         audioMaxExtra) of them at most */
      if (opts.maxExtra != null && extra > opts.maxExtra * (out.length - 1)) return null;
    }
    return { period: med, beats: extend(out, attacks[0].t - 0.05, attacks[attacks.length - 1].t + 0.05), audio: true };
  }

  return Object.freeze({ FPS, tracks, trackOne, salience, periodPeaks, candidatePeriods, position, timeAt, extend, audioTrack });
});
