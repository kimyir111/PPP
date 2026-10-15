/* ============================================================================
   PPP learner model v1 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.2, G11-D5, G11-D7; phase G11b-2)

   A UMD module (Node + browser; global PPPLearner). Pure: no DOM, no clock of its own (every call is given the time), no
   Math.random. It reads TYPED EVIDENCE - the run log entries of practice/runlog.js (G11b-1) - and nothing else.

   WHAT IT IS. Transparent statistics, per measure INDEX and hand (G11-D4: indexes, not numbers), with uncertainty:

     skill     a Gaussian belief (mean, covariance) over two numbers per measure and hand:
                 a    the log-odds of a note landing at the SCORE TEMPO with both hands, rested
                 t    how much slowing down helps (log-odds gained per unit of 1 - ratio^gamma; never below 0)
               so that a lap at tempo ratio rho, hands together (alone = 0) or one hand alone (alone = 1) lands a note with
                 P(hit) = sigma( a + t * (1 - rho^gamma) + aloneBonus * alone )
               A measured lap of k matched notes out of e expected is a binomial observation of that; the belief is updated by
               the Laplace approximation (two Newton steps on the 2x2 posterior), with each note counted as `omega` of a note
               (the notes of one lap are not independent: a lost passage takes several with it). A measure nobody has played
               starts from the piece's pooled belief (the mean of what has been measured in that hand), shrunk toward the
               population prior (accuracy 0.75 at the score tempo, G11 §7.2), with a wide variance.
     forgetting  between runs the LEARNED part of a (above `b`, the first estimate of that measure) decays with half-life
               h days, and the variance grows by qDay per day; a measure practised again on a new day (a gap of at least
               newDayGapH hours) forgets more slowly: h *= 1 + consolidate, up to hMax (spacing).
     timing    exponentially weighted signed and absolute mean error (ms) per measure and hand, from the matched notes
               (rushing < 0 < dragging); and over all of them the device's constant offset (a calibration hint, never applied).
     review    a Leitner box per measure (G11 §7.3 item 2): a clean measured run (accuracy >= 0.9 at >= 0.9 x the score tempo,
               hands together) promotes it when it is due (boxes 1, 2, 4, 7, 14 days), a failed one (< 0.75) takes it back to
               the drill pool (no box).
     recall    memory runs (notes hidden) say how well a measure is REMEMBERED, not how well it is played: they move only a
               per-measure recall estimate, never the skill (the hidden notes would read as missed ones).
     follow    a Follow run has no tempo and no timing (G11-D5): it moves only a per-measure, per-hand "notes known" count.
     simulated a Demo Input run is not evidence and is refused (G11-D5, U4); so is anything that is not a run log entry.

   Derived per measure: the predicted accuracy under any conditions, its credibility, P(mastered) = P(accuracy >= 0.9 at
   0.95 x the score tempo, hands together), `cleanTempo` (the fastest step where the accuracy is >= 0.9 with 80 %
   credibility, §7.2), the legacy state names (new, weak, improving, stable, + memory-ready/memorized/due from the page's
   own memory record when it is passed in) and the review box.

   WHAT IT IS NOT. A model of a real person: its parameters were set on the synthetic learners of practice/sim.js (the
   TUNING set only, G11 §20) and nothing here has seen a real run yet (H-11). No neural network, no fitting across people
   (G11-D7). It does not model fatigue within a session, a learner-specific forgetting rate, or a hand-alone bonus of its own.
   Cost (Node, one core, 1x): an update of a lap of up to 16 bars about 0.01-0.03 ms, of a whole 160-bar lap about 0.2 ms.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPLearner = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const DAY = 86400000;
  const HOUR = 3600000;

  /* Every number the model assumes, in one place. Set on the simulator's tuning set (G11 §20); none is a fact about people. */
  const DEFAULTS = Object.freeze({
    priorAcc: 0.75,        /* a measure nobody has played: accuracy at the score tempo (G11 §7.2) ... */
    priorSdA: 1.5,         /* ... with this spread in log-odds */
    priorT: 1.2,           /* how much slowing down helps, before any evidence (log-odds per unit of 1 - rho^gamma) */
    priorSdT: 1.0,
    poolWeight: 2,         /* the piece's pooled belief counts as this many measures against the population prior */
    gamma: 1.5,            /* the shape of the tempo effect */
    aloneBonus: 0.5,       /* log-odds one hand alone gains over the same hand with both (no coordination cost) */
    omega: 0.5,            /* information per note (the notes of a lap are not independent) */
    qRun: 0.01,            /* variance added to a after each run (the player is changing) */
    learn: 0.05,           /* expected gain of a per run, times (1 - accuracy): the player improves by practising (the tuning set's best
                              was 0.1 - the synthetic learners' own rate; half of it, so a player who does not improve like them is not
                              over-predicted, at about 2 % of the Brier score on the tuning set) */
    halfLife: 4,           /* days for the learned part to halve, at the start */
    consolidate: 0.3,      /* a new day of practice multiplies the half-life by 1 + this ... */
    hMax: 30,              /* ... up to this many days */
    newDayGapH: 8,         /* a gap this long (hours) between two runs of a measure is a new practice day */
    qDay: 0.04,            /* variance added to a per day without practice */
    maxSdA: 2.0,           /* the variance never grows past the prior's */
    timingHalf: 20,        /* matched notes after which an old timing mean counts half */
    masteryAcc: 0.9, masteryRatio: 0.95,
    cleanAcc: 0.9, cleanRatio: 0.9, failAcc: 0.75,
    cleanCred: 0.8,        /* cleanTempo: P(accuracy >= cleanAcc) at least this */
    boxes: Object.freeze([1, 2, 4, 7, 14]),
    weakAcc: 0.75, stableP: 0.8, improving: 0.05
  });

  const SRC_OK = { measured: 1, follow: 1, memory: 1 };

  /* ---------------------------------------------------------------- numbers */
  const sigma = x => 1 / (1 + Math.exp(-x));
  const logit = p => Math.log(p / (1 - p));
  /* E[sigma(z)] for z ~ N(m, v): the probit approximation (MacKay) */
  const meanSigma = (m, v) => sigma(m / Math.sqrt(1 + Math.PI * v / 8));
  /* the standard normal CDF (Abramowitz-Stegun 7.1.26 on erf, |error| < 1.5e-7) */
  function phi(x) {
    const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }
  /* five-point Gauss-Hermite: E[f(z)] for z ~ N(m, v) */
  const GH_X = [-2.020182870456086, -0.958572464613819, 0, 0.958572464613819, 2.020182870456086];
  const GH_W = [0.019953242059046, 0.393619323152241, 0.945308720482942, 0.393619323152241, 0.019953242059046];
  const SQRT_PI = Math.sqrt(Math.PI);
  function expect(m, v, f) {
    const s = Math.sqrt(2 * Math.max(0, v));
    let out = 0;
    for (let k = 0; k < 5; k++) out += GH_W[k] * f(m + s * GH_X[k]);
    return out / SQRT_PI;
  }

  function opt(o) { return Object.assign({}, DEFAULTS, o || {}); }

  /* ---------------------------------------------------------------- the model */
  /* piece: { scoreTempo, measures: [{ number, q (quarters in one pass), notes: { r, l } }] } in index order. */
  function create(piece, o) {
    const P = opt(o);
    if (!piece || !Array.isArray(piece.measures)) throw new Error('PPPLearner: a piece needs its measures');
    const a0 = logit(P.priorAcc);
    const item = n => ({ n: n | 0, a: a0, t: P.priorT, vaa: P.priorSdA * P.priorSdA, vat: 0, vtt: P.priorSdT * P.priorSdT,
      b: null, at: null, h: P.halfLife, last: null, runs: 0, ts: 0, ta: 0, tn: 0, dayA: null });
    const measures = piece.measures.map((m, i) => ({
      i: i, number: m.number, q: +m.q > 0 ? +m.q : 4,
      r: item(m.notes ? m.notes.r : 0), l: item(m.notes ? m.notes.l : 0),
      box: -1, due: null, rec: null, fol: { r: { k: 0, e: 0 }, l: { k: 0, e: 0 } }
    }));
    return {
      v: VERSION, params: P, scoreTempo: +piece.scoreTempo > 0 ? +piece.scoreTempo : 84,
      measures: measures, version: 0, runs: 0, refused: {}, lastAt: null, lastRun: null,
      offset: { s: 0, n: 0 }
    };
  }

  /* lazily, to time t: the learned part decays toward the base, the uncertainty grows */
  function decayItem(P, it, t) {
    if (it.at == null) { it.at = t; return; }
    if (!(t > it.at)) return;
    const dd = (t - it.at) / DAY;
    if (it.b != null) it.a = it.b + (it.a - it.b) * Math.pow(2, -dd / it.h);
    it.vaa = Math.min(Math.max(P.maxSdA * P.maxSdA, P.priorSdA * P.priorSdA), it.vaa + P.qDay * dd);
    it.at = t;
  }
  /* the same, on a copy of the two numbers that matter, for a prediction (nothing is changed) */
  function decayed(P, it, t) {
    let a = it.a, vaa = it.vaa;
    if (it.at != null && t > it.at) {
      const dd = (t - it.at) / DAY;
      if (it.b != null) a = it.b + (a - it.b) * Math.pow(2, -dd / it.h);
      vaa = Math.min(Math.max(P.maxSdA * P.maxSdA, P.priorSdA * P.priorSdA), vaa + P.qDay * dd);
    }
    return { a: a, t: it.t, vaa: vaa, vat: it.vat, vtt: it.vtt };
  }

  /* the piece's pooled belief for a hand: what the measured items were at their FIRST reading (b; practice on one bar does not
     teach another), shrunk toward the population prior */
  function pool(model, hand, t) {
    const P = model.params;
    let sa = 0, st = 0, n = 0;
    model.measures.forEach(m => {
      const it = m[hand];
      if (!it.runs || !it.n || it.b == null) return;
      sa += it.b; st += it.t; n++;
    });
    const w = P.poolWeight;
    return { a: (sa + w * logit(P.priorAcc)) / (n + w), t: (st + w * P.priorT) / (n + w), n: n };
  }

  /* one binomial observation: k of e notes at x = 1 - rho^gamma, offset c (the alone bonus) */
  function observe(P, it, k, e, x, c) {
    const m0a = it.a, m0t = it.t;
    /* prior precision (a covariance that lost its positive determinant to rounding is taken without its correlation) */
    let det0 = it.vaa * it.vtt - it.vat * it.vat;
    if (!(det0 > 1e-12)) { it.vat = 0; det0 = it.vaa * it.vtt; }
    const p00 = it.vtt / det0, p01 = -it.vat / det0, p11 = it.vaa / det0;
    let ta = m0a, tt = m0t, h00 = p00, h01 = p01, h11 = p11;
    for (let iter = 0; iter < 3; iter++) {
      const p = sigma(ta + tt * x + c);
      const w = P.omega * e * p * (1 - p), r = P.omega * (k - e * p);
      /* gradient of the log posterior and the negative Hessian */
      const g0 = -(p00 * (ta - m0a) + p01 * (tt - m0t)) + r;
      const g1 = -(p01 * (ta - m0a) + p11 * (tt - m0t)) + r * x;
      h00 = p00 + w; h01 = p01 + w * x; h11 = p11 + w * x * x;
      const det = h00 * h11 - h01 * h01;
      ta += (h11 * g0 - h01 * g1) / det;
      tt += (-h01 * g0 + h00 * g1) / det;
    }
    const det = h00 * h11 - h01 * h01;
    it.a = ta; it.t = Math.max(0, tt);
    it.vaa = h11 / det; it.vat = -h01 / det; it.vtt = h00 / det;
    const pm = sigma(it.a + it.t * x + c);
    if (P.learn) it.a += P.learn * (1 - pm);
    it.vaa += P.qRun;
  }

  /* An entry of practice/runlog.js (buildEntry's shape). Refuses what is not evidence. -> {ok, code?, rows} */
  function update(model, entry) {
    const P = model.params;
    const refuse = code => { model.refused[code] = (model.refused[code] || 0) + 1; return { ok: false, code: code }; };
    if (!entry || typeof entry !== 'object') return refuse('invalid');
    if (entry.src === 'simulated') return refuse('simulated');
    if (!SRC_OK[entry.src]) return refuse('source');
    const at = +entry.at;
    if (!Number.isFinite(at)) return refuse('invalid');
    if (!Array.isArray(entry.R)) return refuse('invalid');
    const n = model.measures.length;
    const g = Math.max(1, entry.g | 0);
    const hands = entry.hd === 'l' || entry.hd === 'r' ? entry.hd : 'b';
    const alone = hands === 'b' ? 0 : 1;
    const ratio = entry.src === 'follow' ? null : (+entry.sr > 0 ? +entry.sr : 1);
    const x = ratio == null ? 0 : 1 - Math.pow(ratio, P.gamma);
    const c = alone ? P.aloneBonus : 0;
    const per = new Map();       /* measure index -> {k, e} (both hands), for the review boxes and the last-run summary */
    let rows = 0, kAll = 0, eAll = 0, sAbs = 0, sSig = 0, nT = 0;
    const pools = {};
    entry.R.forEach(row => {
      if (!Array.isArray(row) || row.length < 6) return;
      const mi0 = row[0] | 0, hand = row[1] === 1 ? 'l' : 'r';
      const e = +row[2] || 0, k = Math.max(0, Math.min(e, +row[3] || 0));
      if (!(e > 0)) return;
      /* a merged row (g > 1) covers g measures: the counts are shared by their notes */
      const span = [];
      for (let j = mi0; j < Math.min(n, mi0 + g); j++) if (j >= 0) span.push(j);
      const tot = span.reduce((s, j) => s + (model.measures[j][hand].n || 0), 0);
      span.forEach(j => {
        const m = model.measures[j], it = m[hand];
        const share = tot > 0 ? (it.n || 0) / tot : 1 / span.length;
        const ej = e * share, kj = k * share;
        if (!(ej > 0)) return;
        rows++;
        if (entry.src === 'follow') { m.fol[hand].k += kj; m.fol[hand].e += ej; return; }
        if (entry.src === 'memory') {
          const r = m.rec || { acc: 0, n: 0, at: at };
          const w = ej / (ej + Math.max(1, r.n));
          r.acc = r.acc + (kj / ej - r.acc) * (r.n ? w : 1); r.n = Math.min(60, r.n + ej); r.at = at;
          m.rec = r;
          return;
        }
        /* measured */
        if (!it.runs) {
          const pl = pools[hand] || (pools[hand] = pool(model, hand, at));
          it.a = pl.a; it.t = pl.t; it.at = at;
          it.vaa = P.priorSdA * P.priorSdA; it.vat = 0; it.vtt = P.priorSdT * P.priorSdT;
        }
        decayItem(P, it, at);
        if (it.last != null && at - it.last >= P.newDayGapH * HOUR) {
          it.h = Math.min(P.hMax, it.h * (1 + P.consolidate));
          it.dayA = it.a;
        } else if (it.last == null) it.dayA = it.a;
        observe(P, it, kj, ej, x, c);
        if (it.b == null) it.b = it.a;
        it.runs++; it.last = at; it.at = at;
        const pk = per.get(j) || { k: 0, e: 0 };
        pk.k += kj; pk.e += ej; per.set(j, pk);
        kAll += kj; eAll += ej;
        /* timing: only matched notes carry it */
        if (kj > 0 && row[4] != null && row[5] != null && Number.isFinite(+row[4]) && Number.isFinite(+row[5])) {
          const tnD = it.tn * Math.pow(2, -kj / P.timingHalf);
          const w = kj / (kj + tnD);
          it.ts += (+row[4] - it.ts) * w;
          it.ta += (+row[5] - it.ta) * w;
          it.tn = Math.min(400, tnD + kj);
          sSig += +row[4] * kj; sAbs += +row[5] * kj; nT += kj;
          if (+row[5] <= 130) { model.offset.s += +row[4] * kj; model.offset.n += kj; }
        }
      });
    });
    if (entry.src === 'measured') {
      /* the review boxes: a clean run at tempo, hands together, promotes a measure that is due; a failed one takes it out */
      if (hands === 'b' && ratio != null && ratio >= P.cleanRatio - 1e-9) {
        per.forEach((pk, j) => {
          const m = model.measures[j];
          if (!(pk.e > 0) || (m.r.n + m.l.n) <= 0) return;
          const acc = pk.k / pk.e;
          if (acc >= P.cleanAcc) {
            if (m.box < 0 || (m.due != null && at >= m.due)) {
              m.box = Math.min(P.boxes.length - 1, m.box + 1);
              m.due = at + P.boxes[m.box] * DAY;
            }
          } else if (acc < P.failAcc) { m.box = -1; m.due = null; }
        });
      }
      model.runs++;
    }
    model.lastAt = at;
    model.lastRun = {
      at: at, src: entry.src, f: entry.f | 0, t: entry.t | 0, hd: hands, sr: ratio, md: entry.md,
      ex: eAll, ht: kAll, acc: eAll ? kAll / eAll : null, abs: nT ? sAbs / nT : null, signed: nT ? sSig / nT : null,
      per: [...per.entries()].map(([j, pk]) => [j, pk.e ? pk.k / pk.e : null, pk.e])
    };
    model.version++;
    return { ok: true, rows: rows };
  }

  /* fold a list of entries (the run log of one epoch), in time order */
  function fold(piece, entries, o) {
    const model = create(piece, o);
    (entries || []).slice().sort((x, y) => (+x.at || 0) - (+y.at || 0)).forEach(e => update(model, e));
    return model;
  }

  /* ---------------------------------------------------------------- reading it */
  /* the belief about one item at time t: {m, v} of the log-odds under conditions {ratio, alone}; pooled: the hand's pool
     (what a measure nobody has played starts from) */
  function zOf(model, it, cond, t, pooled) {
    const P = model.params;
    let d;
    if (!it.runs) {
      const pl = pooled || { a: logit(P.priorAcc), t: P.priorT };
      d = { a: pl.a, t: pl.t, vaa: P.priorSdA * P.priorSdA, vat: 0, vtt: P.priorSdT * P.priorSdT };
    } else d = decayed(P, it, t);
    const rho = cond && cond.ratio > 0 ? cond.ratio : 1;
    const x = 1 - Math.pow(rho, P.gamma);
    const c = cond && cond.alone ? P.aloneBonus : 0;
    return { m: d.a + d.t * x + c, v: Math.max(1e-9, d.vaa + 2 * x * d.vat + x * x * d.vtt) };
  }
  function pools(model, t) { return { r: pool(model, 'r', t), l: pool(model, 'l', t) }; }
  function itemZ(model, i, hand, cond, t, pl) {
    const it = model.measures[i][hand];
    return zOf(model, it, cond, t, (pl || pools(model, t))[hand]);
  }

  /* the predicted share of a measure's notes that land in a lap: cond {ratio, hands: 'both'|'left'|'right'} */
  function predictMeasure(model, i, cond, t, pl) {
    const m = model.measures[i];
    if (!m) return null;
    const hands = (cond && cond.hands) || 'both';
    const alone = hands !== 'both';
    pl = pl || pools(model, t);
    let s = 0, n = 0;
    ['r', 'l'].forEach(h => {
      if ((hands === 'left' && h !== 'l') || (hands === 'right' && h !== 'r')) return;
      const it = m[h];
      if (!it.n) return;
      const z = zOf(model, it, { ratio: cond && cond.ratio, alone: alone }, t, pl[h]);
      s += it.n * meanSigma(z.m, z.v); n += it.n;
    });
    return n ? s / n : null;
  }

  /* P(accuracy of the measure >= acc at ratio, hands together): each hand's own probability, note-weighted by the hands'
     shares would need a convolution; the product of the hands' probabilities is a lower bound that is exact when one hand
     plays alone and close when both are far from the line */
  function pAtLeast(model, i, acc, ratio, t, pl) {
    const m = model.measures[i];
    pl = pl || pools(model, t);
    const zc = logit(acc);
    let p = 1, any = false;
    ['r', 'l'].forEach(h => {
      const it = m[h];
      if (!it.n) return;
      any = true;
      const z = zOf(model, it, { ratio: ratio, alone: false }, t, pl[h]);
      p *= phi((z.m - zc) / Math.sqrt(z.v));
    });
    return any ? p : null;
  }

  /* the fastest tempo step (0.40 .. 1.00 by 0.05) at which the measure is clean with the required credibility; null = none */
  function cleanTempo(model, i, t, pl) {
    const P = model.params;
    pl = pl || pools(model, t);
    for (let s = 100; s >= 40; s -= 5) {
      const p = pAtLeast(model, i, P.cleanAcc, s / 100, t, pl);
      if (p == null) return null;
      if (p >= P.cleanCred) return s / 100;
    }
    return null;
  }

  /* how far below `target` a hand's accuracy at the score tempo (hands together) is expected to be, times its notes:
     E[max(0, target - sigma(z))] (an uncertain measure has a shortfall even when its mean is above the target) */
  function shortfall(model, i, target, t, pl, ignoreUncertainty) {
    const m = model.measures[i];
    pl = pl || pools(model, t);
    let s = 0;
    ['r', 'l'].forEach(h => {
      const it = m[h];
      if (!it.n) return;
      const z = zOf(model, it, { ratio: 1, alone: false }, t, pl[h]);
      const f = ignoreUncertainty ? Math.max(0, target - sigma(z.m)) : expect(z.m, z.v, y => Math.max(0, target - sigma(y)));
      s += it.n * f;
    });
    return s;
  }

  /* how likely each hand is still below `target` at the score tempo (hands together), times its notes: the probability a bar
     still needs work, which does not fade as the bar nears the line the way the shortfall does */
  function belowTarget(model, i, target, t, pl, ignoreUncertainty) {
    const m = model.measures[i];
    pl = pl || pools(model, t);
    const zc = logit(target);
    let s = 0;
    ['r', 'l'].forEach(h => {
      const it = m[h];
      if (!it.n) return;
      const z = zOf(model, it, { ratio: 1, alone: false }, t, pl[h]);
      s += it.n * (ignoreUncertainty ? (z.m < zc ? 1 : 0) : phi((zc - z.m) / Math.sqrt(z.v)));
    });
    return s;
  }

  /* per-measure numbers a policy (and a screen) reads, at time t. mem: the page's memory record of the measure's section
     (optional: {memorized, due, attempts}) for the memory states */
  function view(model, i, t, mem, pl) {
    const P = model.params;
    const m = model.measures[i];
    pl = pl || pools(model, t);
    const notes = m.r.n + m.l.n;
    const runs = Math.max(m.r.runs, m.l.runs);
    const acc = notes ? predictMeasure(model, i, { ratio: 1, hands: 'both' }, t, pl) : null;
    const pM = notes ? pAtLeast(model, i, P.masteryAcc, P.masteryRatio, t, pl) : null;
    let sd = null;
    if (notes) {
      let v = 0, n = 0;
      ['r', 'l'].forEach(h => { if (m[h].n) { v += m[h].n * zOf(model, m[h], { ratio: 1 }, t, pl[h]).v; n += m[h].n; } });
      sd = Math.sqrt(v / n);
    }
    const tn = m.r.tn + m.l.tn;
    const timing = tn ? { signed: (m.r.ts * m.r.tn + m.l.ts * m.l.tn) / tn, abs: (m.r.ta * m.r.tn + m.l.ta * m.l.tn) / tn } : null;
    let dayAcc = null;
    if (notes && runs) {
      let s = 0, n = 0;
      ['r', 'l'].forEach(h => { const it = m[h]; if (it.n && it.dayA != null) { s += it.n * sigma(it.dayA); n += it.n; } });
      dayAcc = n ? s / n : null;
    }
    /* the legacy names (Learning.measureView, Memory.stateOf), so the screens and the coach context keep their words; a bar
       with nothing to play has nothing to learn ('stable') */
    let state;
    if (mem && mem.memorized && mem.due) state = 'due';
    else if (mem && mem.memorized) state = 'memorized';
    else if (!notes) state = 'stable';
    else if (!runs) state = 'new';
    else if (pM >= P.stableP) state = mem && mem.eligible ? 'memory-ready' : 'stable';
    else if (acc < P.weakAcc) state = 'weak';
    else if (dayAcc != null && acc - dayAcc >= P.improving) state = 'improving';
    else state = 'learning';
    return {
      index: i, number: m.number, notes: notes, runs: runs, acc: acc, sdLogit: sd, pMastered: pM,
      cleanTempo: notes ? cleanTempo(model, i, t, pl) : null, timing: timing, state: state,
      box: m.box, due: m.due, reviewDue: m.box >= 0 && m.due != null && t >= m.due,
      recall: m.rec ? m.rec.acc : null,
      follow: (m.fol.r.e + m.fol.l.e) ? (m.fol.r.k + m.fol.l.k) / (m.fol.r.e + m.fol.l.e) : null
    };
  }

  /* measures due for a spaced re-check (G11 §7.3 item 2) */
  function due(model, t) {
    const out = [];
    model.measures.forEach((m, i) => { if (m.box >= 0 && m.due != null && t >= m.due) out.push(i); });
    return out;
  }

  /* the device's constant timing offset over every on-time note (ms; > 0 = late): a calibration hint, never applied */
  function deviceOffset(model) { return model.offset.n >= 30 ? model.offset.s / model.offset.n : null; }

  return Object.freeze({
    VERSION, DEFAULTS, DAY,
    create, update, fold, predictMeasure, pAtLeast, cleanTempo, shortfall, belowTarget, view, due, deviceOffset, pools, itemZ,
    sigma, logit, meanSigma, phi, expect
  });
});
