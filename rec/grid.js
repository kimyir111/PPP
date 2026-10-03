/* ============================================================================
   PPP rec/ S3 — the grid of each beat, and the onsets on it
   (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S3; phase G10a-2, model AI-5b)

   A transcription hears WHEN each key went down. A score needs, for every beat, WHICH grid the beat is written
   on (straight 16ths, 32nds, triplet eighths, or straight eighths played long-short) and where on that grid each
   onset sits. The legacy quantiser (audio-score.js tripletBeats / snapStraightBest / snapTriplet, and with
   exactBars snapOnsets) decides that per onset with hand-set costs. This stage decides it per BEAT, from the
   evidence of all the beat's onsets, with a smoothness prior across beats, and never forces a reading: every
   beat gets a confidence.

     plan(beats, notes, opts) -> {beats: GridPlan, onsets, report}

   INPUT
     beats   BeatMap.beats: the times (seconds) of consecutive beats of the metre's beat unit (S1/S2's output; in
             the legacy wrap the quarter-note beats audio-score.js decided). Beat k spans [beats[k], beats[k+1]).
     notes   heard notes [{on, attack?}] (attack: the clustered onset of a chord, audio-score.js clusterNotes; a
             note without one is its own attack). Notes with the same attack are one onset.
     opts    { model        the weights JSON (rec/weights/ai5b-grid-v1.json); default: the committed file in Node, the
                            global PPPRecGridModel in a page, else the built-in defaults below (the deterministic fallback)
               kinds        the grid kinds allowed (default all of KINDS); e.g. ['16','32'] for a lock that says 16ths
               ticksPerBeat ticks of one beat in the output (default 24: a 16th is 6, a 32nd 3, a triplet eighth 8)
               beatsPerBar, downbeat   the metre (S2) when known: a beat index that is a downbeat; used for the
                            per-bar context only (optional) }

   OUTPUT
     beats   GridPlan: one entry per beat that holds an onset, in beat order:
               {beat: k, kind: '16'|'32'|'3'|'swing8', conf: posterior of the kind (0-1), post: {kind: p},
                n: onsets in the beat, swing: the long-short ratio point (swing8 only)}
     onsets  one entry per input note (same order): {beat, tick, frac, kind, err}
               tick  the written onset in ticks from beats[0] (beat k starts at k * ticksPerBeat): ON the chosen
                     grid of its beat (a multiple of 6 / 3 / 8 inside the beat; a swing8 beat is written straight)
               frac  the written position in the beat (0 <= frac < 1), err |heard - written| in beats
     report  {version, model, sigmaSec, beats: counts per kind, lowConf: beats with conf < 0.6, moved}

   THE MODEL (generative, per beat; learned by tests/bench/tools/train_grid.js, see its header)
     Each kind H has grid points g (fractions of the beat) and an occupancy probability rho_H(g): how often a
     written onset sits there in a beat of that kind (counted on the catalogue's truth). The heard onsets of a
     beat are matched in order to distinct grid points (a monotone matching: two onsets never share a point,
     none changes order), each matched onset costs log rho + log N(heard - g; sigma), each empty point
     log(1 - rho), an onset nothing explains log(outlier). The best matching is the beat's likelihood under H
     and IS the snap. sigma is the timing noise in seconds (learned, then adapted to the piece from its own
     residuals), divided by the beat's length. Beats are smoothed by a hidden Markov chain over the kinds
     (learned prior and transition counts; forward-backward), so one noisy beat inside a straight passage does
     not become a triplet, and a triplet passage keeps its triplets through a beat that only has a downbeat.
     32nds are only a hypothesis where a 32nd lasts at least minSpacing32 seconds. An onset just before a beat
     (within a 16th of a 16th) belongs to that beat's start; the next beat's start is a grid point of every
     kind (an early downbeat), so a late-played beat end is not mistaken for a finer grid.

   Pure: no Date, no Math.random, no I/O except loading the default weights once in Node. UMD (Node + page).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    let model = null;
    try { model = require('./weights/ai5b-grid-v1.json'); } catch (e) { model = null; }
    module.exports = factory(model);
  } else {
    root.PPPRecGrid = factory(root.PPPRecGridModel || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DEFAULT_MODEL) {
  'use strict';

  const VERSION = '0.1.0';
  const SCHEMA = 'ppp.rec-grid-model/1';
  const KINDS = ['16', '32', '3', 'swing8'];
  /* a compound metre's beat is a dotted quarter: its eighths (thirds) or its 16ths (sixths; a duplet's half is one of them) */
  const CKINDS = ['c8', 'c16'];
  const SIXTHS = [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6];
  const LN_SQRT_2PI = 0.9189385332046727;
  const WINDOW_EARLY = 1 / 16;      /* an onset this close before a beat (in beats) is that beat's onset */
  /* where a swung second eighth is heard: long-short ratios 1.5, 1.63, 1.78 and 2 to 1 (no further: a dotted eighth and a 16th,
     3 to 1, must stay a dotted rhythm) */
  const SLOT = 0.008;               /* seconds: notes this close are one frame of a transcription */
  const SWING_POINTS = [0.6, 0.62, 0.64, 2 / 3];

  /* the grid points of each kind (fractions of a beat, the next beat's start 1.0 excluded: it is shared, below) and
     the written point each one becomes (as a fraction: swing8's long-short eighths are written straight) */
  function gridOf(kind, swing) {
    switch (kind) {
      case '16': return { pts: [0, 0.25, 0.5, 0.75], written: [0, 0.25, 0.5, 0.75] };
      case '32': return { pts: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], written: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] };
      case '3': case 'c8': return { pts: [0, 1 / 3, 2 / 3], written: [0, 1 / 3, 2 / 3] };
      case 'c16': return { pts: SIXTHS, written: SIXTHS };
      case 'swing8': {
        const s = swing || 0.65;
        return { pts: [0, s / 2, s, s + (1 - s) / 2], written: [0, 0.25, 0.5, 0.75] };
      }
      default: throw new Error('rec/grid: unknown kind ' + kind);
    }
  }

  /* The built-in parameters: the deterministic fallback when no weights file is loaded (and the starting point of
     the training script). Hand-set, plausible; the trained file replaces every one. */
  const FALLBACK = {
    schema: SCHEMA, name: 'fallback', version: '0',
    kinds: KINDS.slice(),
    sigmaSec: 0.028, sigmaPrior: 30, sigmaMin: 0.008, sigmaMax: 0.06,
    outlier: 0.004, early: 0.03, split: 0.5, joinGap: 0.04, chordSigmaSec: 0.015,
    /* occupancy patterns: P(the set of grid points that hold a heard onset | kind), bit k = point k of the kind's grid */
    patterns: {
      '16': [0.01, 0.30, 0.01, 0.01, 0.01, 0.25, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01, 0.01, 0.04, 0.01, 0.25],
      '3': [0.01, 0.04, 0.01, 0.04, 0.01, 0.20, 0.04, 0.65],
      'swing8': [0.02, 0.05, 0.02, 0.02, 0.02, 0.60, 0.02, 0.02, 0.02, 0.05, 0.02, 0.02, 0.02, 0.02, 0.02, 0.06],
      '32even': [0.01, 0.30, 0.01, 0.01, 0.01, 0.25, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01, 0.01, 0.04, 0.01, 0.25],
      '32odd': [0.5, 0.5, 0.5, 0.5],
      'c8': [0.01, 0.3, 0.01, 0.1, 0.01, 0.2, 0.02, 0.35],
      'c16': (function () { const t = []; for (let m = 0; m < 64; m++) t.push(m === 63 ? 0.2 : m === 1 ? 0.1 : 0.7 / 62); return t; })()
    },
    prior: { '16': 0.955, '32': 0.015, '3': 0.025, 'swing8': 0.005, 'c8': 0.85, 'c16': 0.15 },
    stay: { '16': 0.98, '32': 0.85, '3': 0.85, 'swing8': 0.9, 'c8': 0.9, 'c16': 0.8 },
    minSpacing32: 0.055
  };

  let defaultModel = DEFAULT_MODEL && DEFAULT_MODEL.schema === SCHEMA ? DEFAULT_MODEL : null;
  function setModel(m) { if (m && m.schema !== SCHEMA) throw new Error('rec/grid: expected schema ' + SCHEMA); defaultModel = m || null; }
  function modelOf(opts) {
    const m = (opts && opts.model) || defaultModel || FALLBACK;
    if (m.schema !== SCHEMA) throw new Error('rec/grid: expected schema ' + SCHEMA);
    return m;
  }

  /* continuous beat position of a time: beat k + fraction (linear between beats, extended at the ends) */
  function beatPosition(beats, t) {
    let lo = 0, hi = beats.length - 1;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[hi]) return hi + (t - beats[hi]) / (beats[hi] - beats[hi - 1]);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  }
  function beatLen(beats, k) {
    const n = beats.length;
    if (k < 0) return beats[1] - beats[0];
    if (k >= n - 1) return beats[n - 1] - beats[n - 2];
    return beats[k + 1] - beats[k];
  }

  const logp = p => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, p)));

  /* The best monotone matching of a beat's onsets (sorted fractions fs, -WINDOW_EARLY <= f < 1 - WINDOW_EARLY) to a list of
     grid points [{pos, forced, lnUse, lnSkip, odd}] sorted by pos (the last one is the next beat's start, 1.0: an early
     downbeat, optional for every kind). A forced point must hold an onset (it is in the occupancy pattern being scored);
     an optional one may (lnUse) or may not (lnSkip). Each point takes a GROUP of consecutive onsets: one written onset
     heard as several (a chord heard a frame apart, a rolled chord) when each is at most joinGap after the one before
     (canJoin), at their mean time, each extra onset costing log(split). An onset no point explains costs log(outlier).
     needOdd: at least one point flagged odd must be used (a 32nd beat has an onset off the 16th grid).
     Returns {ll, at}: the log likelihood and, per onset, the index of its point (-1: an outlier). */
  const MAX_GROUP = 8;
  function matchPattern(fs, canJoin, points, needOdd, sigmaB, lnOut, lnSplit, chordB) {
    const n = fs.length, m = points.length;
    const lnNorm = -Math.log(sigmaB) - LN_SQRT_2PI;
    /* every onset is an observation: an onset that joins a group pays log(split) and the density of its offset from the
       group's mean (the chord's spread, chordB), so a group is scored like separate onsets would be, density for density */
    const lnNormC = -Math.log(chordB) - LN_SQRT_2PI, inv2C = 0.5 / (chordB * chordB);
    const size = (n + 1) * (m + 1);
    const D = [new Float64Array(size).fill(-Infinity), new Float64Array(size).fill(-Infinity)];
    const B = [new Int16Array(size), new Int16Array(size)];      /* code: 1 skip, 2 outlier, 10 + L group; + 100 * previous flag */
    const at = (i, j) => i * (m + 1) + j;
    D[0][0] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        for (let f = 0; f < 2; f++) {
          const cur = D[f][at(i, j)];
          if (cur === -Infinity) continue;
          if (j < m && !points[j].forced) {
            const s = cur + points[j].lnSkip, x = at(i, j + 1);
            if (s > D[f][x]) { D[f][x] = s; B[f][x] = 1 + 100 * f; }
          }
          if (i < n) {
            const s = cur + lnOut, x = at(i + 1, j);
            if (s > D[f][x]) { D[f][x] = s; B[f][x] = 2 + 100 * f; }
            if (j < m) {
              const pt = points[j], nf = f || (pt.odd ? 1 : 0);
              let sum = 0, sumsq = 0;
              for (let L = 1; L <= MAX_GROUP && i + L <= n; L++) {
                if (L > 1 && !canJoin[i + L - 1]) break;
                const fx = fs[i + L - 1];
                sum += fx; sumsq += fx * fx;
                const mean = sum / L, spread = Math.max(0, sumsq - L * mean * mean);
                const d = (mean - pt.pos) / sigmaB;
                const s2 = cur + pt.lnUse + lnNorm - 0.5 * d * d + (L - 1) * (lnSplit + lnNormC) - spread * inv2C, y = at(i + L, j + 1);
                if (s2 > D[nf][y]) { D[nf][y] = s2; B[nf][y] = 10 + L + 100 * f; }
              }
            }
          }
        }
      }
    }
    let f = needOdd ? 1 : (D[1][at(n, m)] > D[0][at(n, m)] ? 1 : 0);
    const ll = D[f][at(n, m)];
    const where = new Array(n).fill(-1);
    if (ll === -Infinity) return { ll: ll, at: where };
    let i = n, j = m;
    while (i > 0 || j > 0) {
      const b = B[f][at(i, j)], code = b % 100, pf = (b - code) / 100;
      if (code === 1) j--;
      else if (code === 2) i--;
      else if (code > 10) { const L = code - 10; for (let x = 0; x < L; x++) where[i - 1 - x] = j - 1; i -= L; j--; }
      else break;
      f = pf;
    }
    return { ll: ll, at: where };
  }

  /* the log-probability tables of a model, cached per model object */
  const LOGS = typeof WeakMap === 'function' ? new WeakMap() : null;
  function logsOf(model) {
    if (LOGS && LOGS.has(model)) return LOGS.get(model);
    const P = model.patterns;
    const lg = arr => arr.map(p => Math.log(Math.max(1e-12, p)));
    const odd = P['32odd'];
    let none = 1;
    odd.forEach(r => { none *= 1 - r; });
    const out = {
      '16': lg(P['16']), '3': lg(P['3']), 'swing8': lg(P['swing8']), '32even': lg(P['32even']),
      'c8': P.c8 ? lg(P.c8) : null, 'c16': P.c16 ? lg(P.c16) : null,
      oddUse: odd.map(r => logp(r)), oddSkip: odd.map(r => logp(1 - r)), oddNorm: -Math.log(Math.max(1e-12, 1 - none)),
      early: logp(model.early), notEarly: logp(1 - model.early), out: Math.log(model.outlier), split: Math.log(model.split)
    };
    if (LOGS) LOGS.set(model, out);
    return out;
  }

  /* the points of one occupancy pattern of a kind (bit k = point k of the kind's grid is occupied), plus the early downbeat */
  function patternPoints(heard, written, mask, lg) {
    const pts = [];
    for (let k = 0; k < heard.length; k++) if (mask & (1 << k)) pts.push({ pos: heard[k], written: written[k], forced: true, lnUse: 0, lnSkip: 0, odd: false });
    pts.push({ pos: 1, written: 1, forced: false, lnUse: lg.early, lnSkip: lg.notEarly, odd: false });
    return pts;
  }
  const popcount = x => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };

  /* The onsets the stage places: audio-score.js's attacks (clusterNotes: the notes of one chord, within 50 ms, a rolled
     chord included) split where two of an attack's notes are more than joinGap apart: two written onsets a 16th apart at a
     fast tempo fall into one 50-ms cluster when the timing noise brings them together, while the notes of one chord in a
     transcription are at most a frame (32 ms) apart. Onsets that clusterNotes kept apart but that are at most joinGap
     apart (a chord inside a run, which its run detector splits) may still be one written onset: that is the matching's
     decision (matchPattern's groups). Returns [{t, notes: [note index]}] in time order; t is the mean onset of the notes. */
  function onsetsOf(notes, joinGap) {
    const by = new Map();
    notes.forEach((n, i) => {
      const key = (n.attack != null ? n.attack : n.on).toFixed(4);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(i);
    });
    const out = [];
    by.forEach(idx => {
      idx.sort((a, b) => notes[a].on - notes[b].on || a - b);
      /* the attack's frames (notes less than SLOT apart), then a new onset where a frame comes more than joinGap after the one
         before, or continues it by step (a fast run inside one 50-ms cluster: 32nds a frame apart) */
      const frames = [];
      idx.forEach(i => {
        const f = frames[frames.length - 1];
        if (f && notes[i].on - notes[f.notes[f.notes.length - 1]].on <= SLOT) f.notes.push(i); else frames.push({ notes: [i] });
      });
      let cur = frames[0].notes.slice();
      for (let x = 1; x < frames.length; x++) {
        const prev = frames[x - 1], fr = frames[x];
        if (notes[fr.notes[0]].on - notes[prev.notes[prev.notes.length - 1]].on > joinGap || stepOf(notes, prev, fr)) { out.push({ notes: cur }); cur = []; }
        cur.push(...fr.notes);
      }
      out.push({ notes: cur });
    });
    out.forEach(o => { o.t = o.notes.reduce((s, i) => s + notes[i].on, 0) / o.notes.length; });
    return out.sort((a, b) => a.t - b.t || a.notes[0] - b.notes[0]);
  }

  /* b repeats a pitch of a, or continues it by step (every pitch of b within two semitones of a pitch of a) */
  function stepOf(notes, a, b) {
    if (b.notes.some(i => a.notes.some(j => notes[i].midi === notes[j].midi))) return true;
    return b.notes.every(i => a.notes.some(j => Math.abs(notes[i].midi - notes[j].midi) <= 2));
  }

  /* per beat: the onsets it holds, as fractions */
  function beatsOf(onsets, beats) {
    const per = new Map();
    onsets.forEach((o, idx) => {
      const p = beatPosition(beats, o.t);
      const k = Math.floor(p + WINDOW_EARLY);
      o.pos = p; o.beat = k; o.f = p - k;
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(idx);
    });
    return per;
  }

  /* The likelihood of every allowed kind for one beat: the best occupancy pattern of the kind (its learned probability)
     times the best matching of the onsets to exactly those points. swing8 takes the best of its long-short points.
     Returns {kind: {ll, heard: [per onset heard point or null], written: [per onset written fraction or null], swing}}. */
  function beatLikelihoods(fs, kinds, model, sigmaB, beatSec, canJoin) {
    const lg = logsOf(model);
    const chordB = Math.max(1e-4, (model.chordSigmaSec || 0.015) / beatSec);
    const n = fs.length;
    const out = {};
    const keep = (kind, ll, r, pts, extra) => {
      if (ll === -Infinity) return;
      const cur = out[kind];
      if (cur && cur.ll >= ll) return;
      const o = { ll: ll, heard: r.at.map(j => (j < 0 ? null : pts[j].pos)), written: r.at.map(j => (j < 0 ? null : pts[j].written)) };
      if (extra) Object.assign(o, extra);
      out[kind] = o;
    };
    kinds.forEach(kind => {
      if (kind === '32') {
        if (beatSec / 8 < model.minSpacing32) return;
        const g = gridOf('32');
        for (let e = 0; e < 16; e++) {
          if (popcount(e) > n) continue;
          const pts = [];
          for (let k = 0; k < 8; k++) {
            if (k % 2 === 0) { if (e & (1 << (k / 2))) pts.push({ pos: g.pts[k], written: g.written[k], forced: true, lnUse: 0, lnSkip: 0, odd: false }); }
            else pts.push({ pos: g.pts[k], written: g.written[k], forced: false, lnUse: lg.oddUse[(k - 1) / 2], lnSkip: lg.oddSkip[(k - 1) / 2], odd: true });
          }
          pts.push({ pos: 1, written: 1, forced: false, lnUse: lg.early, lnSkip: lg.notEarly, odd: false });
          const r = matchPattern(fs, canJoin, pts, true, sigmaB, lg.out, lg.split, chordB);
          keep('32', r.ll + lg['32even'][e] + lg.oddNorm, r, pts);
        }
        return;
      }
      const swings = kind === 'swing8' ? SWING_POINTS : [null];
      swings.forEach(sw => {
        const g = gridOf(kind, sw);
        const table = lg[kind];
        for (let mask = 0; mask < table.length; mask++) {
          if (popcount(mask) > n) continue;
          const pts = patternPoints(g.pts, g.written, mask, lg);
          const r = matchPattern(fs, canJoin, pts, false, sigmaB, lg.out, lg.split, chordB);
          keep(kind, r.ll + table[mask] - (sw === null ? 0 : Math.log(SWING_POINTS.length)), r, pts, sw === null ? null : { swing: sw });
        }
      });
    });
    return out;
  }

  /* forward-backward over the beats that hold onsets (a gap of beats with no onset weakens the link: the stay
     probability is applied once per beat in between) */
  function smooth(entries, kinds, model) {
    const K = kinds.length;
    const prior = kinds.map(k => model.prior[k] || 1e-6);
    const ps = prior.reduce((a, b) => a + b, 0);
    const pri = prior.map(p => p / ps);
    /* transition over `gap` beats: stay with prob stay^gap (towards the prior otherwise) */
    const trans = gap => kinds.map((a, i) => kinds.map((b, j) => {
      const st = Math.pow(model.stay[a] !== undefined ? model.stay[a] : 0.9, Math.max(1, gap));
      return (i === j ? st : 0) + (1 - st) * pri[j];
    }));
    const n = entries.length;
    const em = entries.map(e => {
      const lls = kinds.map(k => (e.lik[k] ? e.lik[k].ll : -Infinity));
      const mx = Math.max.apply(null, lls);
      return lls.map(v => (v === -Infinity ? 0 : Math.exp(v - mx)));
    });
    const fw = [], sc = [];
    for (let t = 0; t < n; t++) {
      let v;
      if (t === 0) v = pri.map((p, i) => p * em[t][i]);
      else {
        const T = trans(entries[t].beat - entries[t - 1].beat);
        v = kinds.map((_, j) => { let s = 0; for (let i = 0; i < K; i++) s += fw[t - 1][i] * T[i][j]; return s * em[t][j]; });
      }
      const s = v.reduce((a, b) => a + b, 0) || 1;
      fw.push(v.map(x => x / s)); sc.push(s);
    }
    const bw = new Array(n);
    bw[n - 1] = kinds.map(() => 1);
    for (let t = n - 2; t >= 0; t--) {
      const T = trans(entries[t + 1].beat - entries[t].beat);
      const v = kinds.map((_, i) => { let s = 0; for (let j = 0; j < K; j++) s += T[i][j] * em[t + 1][j] * bw[t + 1][j]; return s; });
      const s = v.reduce((a, b) => a + b, 0) || 1;
      bw[t] = v.map(x => x / s);
    }
    return entries.map((e, t) => {
      const p = kinds.map((_, i) => fw[t][i] * bw[t][i]);
      const s = p.reduce((a, b) => a + b, 0) || 1;
      const post = {};
      kinds.forEach((k, i) => { post[k] = p[i] / s; });
      return post;
    });
  }

  function plan(beats, notes, opts) {
    opts = opts || {};
    const model = modelOf(opts);
    const compound = !!opts.compound;
    const TPB = opts.ticksPerBeat || (compound ? 36 : 24);
    const kinds = compound ? (opts.kinds || CKINDS).filter(k => CKINDS.indexOf(k) >= 0 && model.patterns[k])
      : (opts.kinds || model.kinds || KINDS).filter(k => KINDS.indexOf(k) >= 0);
    if (!kinds.length) throw new Error('rec/grid: the model has no grid kind for ' + (compound ? 'a compound' : 'a simple') + ' metre');
    if (!beats || beats.length < 2) throw new Error('rec/grid: needs at least two beats');
    const onsets = onsetsOf(notes || [], model.joinGap);
    const per = beatsOf(onsets, beats);
    const keys = Array.from(per.keys()).sort((a, b) => a - b);
    let sigmaSec = model.sigmaSec;
    let entries = null;
    /* two passes: the prior noise, then the piece's own (the residuals of the first pass's matches, pooled with the
       prior as sigmaPrior pseudo-observations) */
    for (let pass = 0; pass < 2; pass++) {
      entries = keys.map(k => {
        const idx = per.get(k);
        const fs = idx.map(i => onsets[i].f);
        /* an onset may join the one before (one written onset heard twice: a chord heard a frame apart) when it is close enough,
           repeats none of its pitches, and is not the next step of a run (every pitch of it a tone or less from one of the onset
           before: a fast scale's next note, which a chord's later frame is not) */
        const canJoin = idx.map((i, x) => x > 0 && onsets[i].t - onsets[idx[x - 1]].t <= model.joinGap && !stepOf(notes, onsets[idx[x - 1]], onsets[i]));
        const bs = beatLen(beats, k);
        const sigmaB = Math.max(1e-4, sigmaSec / bs);
        return { beat: k, idx: idx, fs: fs, sec: bs, lik: beatLikelihoods(fs, kinds, model, sigmaB, bs, canJoin) };
      });
      const posts = smooth(entries, kinds, model);
      entries.forEach((e, t) => {
        e.post = posts[t];
        let best = null;
        kinds.forEach(k => { if (e.lik[k] && (best === null || e.post[k] > e.post[best])) best = k; });
        e.kind = best;
      });
      if (pass === 0) {
        let ss = 0, nn = 0;
        entries.forEach(e => {
          const L = e.lik[e.kind];
          L.heard.forEach((pt, x) => {
            if (pt === null) return;
            const r = (e.fs[x] - pt) * e.sec;
            ss += r * r; nn++;
          });
        });
        const prior = model.sigmaPrior || 30;
        sigmaSec = Math.sqrt((prior * model.sigmaSec * model.sigmaSec + ss) / (prior + nn));
        sigmaSec = Math.min(model.sigmaMax || 0.06, Math.max(model.sigmaMin || 0.008, sigmaSec));
      }
    }
    /* the snap: each onset to the point its beat's best matching gave it (an outlier: the nearest point) */
    const out = new Array((notes || []).length);
    const counts = {};
    kinds.forEach(k => { counts[k] = 0; });
    let lowConf = 0;
    const planOut = entries.map(e => {
      const L = e.lik[e.kind];
      const g = gridOf(e.kind, L.swing);
      counts[e.kind]++;
      const conf = e.post[e.kind];
      if (conf < 0.6) lowConf++;
      e.idx.forEach((oi, x) => {
        const f = e.fs[x];
        let heardPt = L.heard[x], written = L.written[x];
        if (heardPt === null) {
          /* an outlier: the nearest point of the beat's grid (the next beat's start included) */
          let bd = Infinity;
          g.pts.concat([1]).forEach((pt, pj) => { const d = Math.abs(f - pt); if (d < bd - 1e-12) { bd = d; heardPt = pt; written = pj < g.written.length ? g.written[pj] : 1; } });
        }
        const beat = written >= 1 ? e.beat + 1 : e.beat;
        const frac = written >= 1 ? 0 : written;
        const tick = beat * TPB + Math.round(frac * TPB);
        const o = onsets[oi];
        o.notes.forEach(ni => {
          out[ni] = { beat: beat, tick: tick, frac: frac, kind: written >= 1 ? null : e.kind, err: Math.abs(f - heardPt) };
        });
      });
      const row = { beat: e.beat, kind: e.kind, conf: conf, post: e.post, n: e.idx.length };
      if (e.kind === 'swing8') row.swing = L.swing;
      return row;
    });
    /* an onset moved to the next beat's start takes that beat's kind when it has one */
    const kindAt = new Map(planOut.map(p => [p.beat, p.kind]));
    out.forEach(o => { if (o && o.kind === null) o.kind = kindAt.get(o.beat) || '16'; });
    return {
      beats: planOut,
      onsets: out,
      report: { version: VERSION, model: (model.name || 'grid') + '@' + model.version, sigmaSec: Math.round(sigmaSec * 1e6) / 1e6, beats: counts, lowConf: lowConf }
    };
  }

  /* ---- the legacy shape (the bench's v2-grid wrap: audio-score.js finish() with opts.grid 'v2') ----
     q notes exactly as audio-score.js quantize() returns them (midi, vel, on, off, attack, tick, endTick, err,
     tuplet, subdivision, lenTicks), with the onsets placed by plan() and the release snapped the way quantize()
     snaps it on the beat's grid (snapEnd: a half-beat / beat ending favoured). Ticks from beats[0], 24 per beat. */
  function snapEnd(pos, subdivisions) {
    const k = Math.floor(pos);
    const f = pos - k;
    let best = 0, bestCost = Infinity;
    const steps = subdivisions === 8 ? 8 : 4;
    for (let s = 0; s <= steps; s++) {
      const c = s / steps;
      const cost = Math.abs(f - c) + (c !== 0 && c !== 0.5 && c !== 1 ? 0.08 : c === 0.5 ? 0.12 : 0);
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return k + best;
  }
  function legacyQ(notes, beats, opts) {
    if (opts && opts.compound) return legacyQCompound(notes, beats, opts);
    opts = Object.assign({}, opts || {}, { ticksPerBeat: 24 });
    const Q = 24;
    const r = plan(beats, notes, opts);
    let errSum = 0;
    const q = notes.map((n, i) => {
      const o = r.onsets[i];
      const trip = o.kind === '3';
      const sub = trip ? 3 : (o.kind === '32' ? 8 : 4);
      const tOn = n.attack != null ? n.attack : n.on;
      const endPos = snapEnd(beatPosition(beats, n.off), trip ? 4 : sub);
      let endTick = Math.round(endPos * Q);
      if (trip) {
        const base = o.beat * Q;
        endTick = Math.max(o.tick + 8, base + Math.round((endTick - base) / 8) * 8);
      } else {
        const unit = sub === 8 ? 3 : 6;
        endTick = Math.max(o.tick + unit, Math.round(endTick / unit) * unit);
      }
      errSum += o.err;
      return {
        midi: n.midi, vel: n.vel, on: n.on, off: n.off, attack: tOn,
        tick: o.tick, endTick: endTick, err: o.err, tuplet: trip, subdivision: sub, lenTicks: Math.max(1, endTick - o.tick),
        dTick: beatPosition(beats, n.on) * Q - o.tick                   /* heard minus written, in ticks (writable() reads it) */
      };
    });
    return { q: q, errSum: errSum, plan: r.beats, report: r.report };
  }
  /* a compound metre (beats are dotted quarters, 36 ticks): q notes as audio-score.js quantizeCompound returns them, the
     onsets placed by plan() on the eighths or the 16ths of each beat, the release as quantizeCompound snaps it */
  function legacyQCompound(notes, beats, opts) {
    opts = Object.assign({}, opts, { ticksPerBeat: 36, compound: true });
    const T = 36;
    const r = plan(beats, notes, opts);
    let errSum = 0;
    const q = notes.map((n, i) => {
      const o = r.onsets[i];
      const tOn = n.attack != null ? n.attack : n.on;
      const endTick = Math.max(o.tick + 6, Math.round(snapEnd(beatPosition(beats, n.off), 4) * T));
      errSum += o.err;
      return {
        midi: n.midi, vel: n.vel, on: n.on, off: n.off, attack: tOn,
        tick: o.tick, endTick: endTick, err: o.err, subdivision: 6, tuplet: false, lenTicks: endTick - o.tick,
        dTick: beatPosition(beats, n.on) * T - o.tick
      };
    });
    return { q: q, errSum: errSum, plan: r.beats, report: r.report };
  }

  /* The legacy exact-bars writer (audio-score.js exactGrid / staffEvents) writes no piece shorter than a 16th for a silence,
     so a staff that is silent before an onset on an odd 32nd cannot be written (a 32nd rest; notation-check class 5). The
     grid stage places onsets before the hands are known; once they are (q[].staff), an odd-32nd onset of a staff that
     played no note a 32nd before it moves to the nearer 16th point of its beat (the measured time decides; a point where
     the staff already holds the same pitch is not taken). This is audio-score.js snapOnsets' "genuine run" rule and
     nothing more: an odd-32nd onset that continues a run of its staff stays where the grid stage put it. Ticks: 24 per
     beat. Mutates q; returns {moved}. */
  function writable(q) {
    const Q = 24;
    const at = new Map();                                   /* staff|tick -> notes */
    q.forEach(n => { const k = n.staff + '|' + n.tick; if (!at.has(k)) at.set(k, []); at.get(k).push(n); });
    let moved = 0;
    const keys = Array.from(at.keys()).map(k => { const [s, t] = k.split('|'); return [+s, +t]; }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    keys.forEach(([s, t]) => {
      const o = ((t % Q) + Q) % Q;
      if (o % 6 !== 3 || o % 8 === 0) return;               /* not an odd 32nd (a triplet third is 8 or 16) */
      if (at.has(s + '|' + (t - 3))) return;                 /* continues a run of its staff */
      const ns = at.get(s + '|' + t);
      if (!ns || !ns.length) return;
      const x = t + ns.reduce((a, n) => a + (n.dTick || 0), 0) / ns.length;      /* where it was heard */
      const cands = [t - 3, t + 3].sort((a, b) => Math.abs(a - x) - Math.abs(b - x) || a - b);
      const pitches = new Set(ns.map(n => n.midi));
      const to = cands.find(c => !(at.get(s + '|' + c) || []).some(n => pitches.has(n.midi)));
      if (to === undefined) return;
      ns.forEach(n => { n.tick = to; n.endTick = Math.max(n.endTick, to + 1); n.subdivision = 4; });
      at.delete(s + '|' + t);
      if (!at.has(s + '|' + to)) at.set(s + '|' + to, []);
      at.get(s + '|' + to).push(...ns);
      moved++;
    });
    return { moved: moved };
  }

  return {
    VERSION: VERSION, SCHEMA: SCHEMA, KINDS: KINDS, CKINDS: CKINDS, FALLBACK: FALLBACK,
    plan: plan, legacyQ: legacyQ, writable: writable, setModel: setModel,
    _: { gridOf: gridOf, matchPattern: matchPattern, beatPosition: beatPosition, onsetsOf: onsetsOf, beatsOf: beatsOf,
      beatLikelihoods: beatLikelihoods, smooth: smooth, modelOf: modelOf, WINDOW_EARLY: WINDOW_EARLY, SWING_POINTS: SWING_POINTS }
  };
});
