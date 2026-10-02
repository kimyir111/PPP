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
     opts    { model        the weights JSON (rec/grid-model.json); default: the committed file in Node, the global
                            PPPRecGridModel in a page, else the built-in defaults below (the deterministic fallback)
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
    try { model = require('./grid-model.json'); } catch (e) { model = null; }
    module.exports = factory(model);
  } else {
    root.PPPRecGrid = factory(root.PPPRecGridModel || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DEFAULT_MODEL) {
  'use strict';

  const VERSION = '0.1.0';
  const SCHEMA = 'ppp.rec-grid-model/1';
  const KINDS = ['16', '32', '3', 'swing8'];
  const LN_SQRT_2PI = 0.9189385332046727;
  const WINDOW_EARLY = 1 / 16;      /* an onset this close before a beat (in beats) is that beat's onset */
  const SWING_POINTS = [0.6, 0.625, 0.65, 0.675, 0.7];

  /* the grid points of each kind (fractions of a beat, the next beat's start 1.0 excluded: it is shared, below) and
     the written point each one becomes (as a fraction: swing8's long-short eighths are written straight) */
  function gridOf(kind, swing) {
    switch (kind) {
      case '16': return { pts: [0, 0.25, 0.5, 0.75], written: [0, 0.25, 0.5, 0.75] };
      case '32': return { pts: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], written: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] };
      case '3': return { pts: [0, 1 / 3, 2 / 3], written: [0, 1 / 3, 2 / 3] };
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
    schema: SCHEMA, version: 'fallback',
    kinds: KINDS.slice(),
    sigmaSec: 0.028, sigmaPrior: 30, sigmaMin: 0.008, sigmaMax: 0.06,
    outlier: 0.004, early: 0.03, split: 0.3, slotGap: 0.004, joinGap: 0.04,
    /* occupancy patterns: P(the set of grid points that hold a heard onset | kind), bit k = point k of the kind's grid */
    patterns: {
      '16': [0.01, 0.30, 0.01, 0.01, 0.01, 0.25, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01, 0.01, 0.04, 0.01, 0.25],
      '3': [0.01, 0.04, 0.01, 0.04, 0.01, 0.20, 0.04, 0.65],
      'swing8': [0.02, 0.05, 0.02, 0.02, 0.02, 0.60, 0.02, 0.02, 0.02, 0.05, 0.02, 0.02, 0.02, 0.02, 0.02, 0.06],
      '32even': [0.01, 0.30, 0.01, 0.01, 0.01, 0.25, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01, 0.01, 0.04, 0.01, 0.25],
      '32odd': [0.5, 0.5, 0.5, 0.5]
    },
    prior: { '16': 0.955, '32': 0.015, '3': 0.025, 'swing8': 0.005 },
    stay: { '16': 0.98, '32': 0.85, '3': 0.85, 'swing8': 0.9 },
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
  function matchPattern(fs, canJoin, points, needOdd, sigmaB, lnOut, lnSplit) {
    const n = fs.length, m = points.length;
    const lnNorm = -Math.log(sigmaB) - LN_SQRT_2PI;
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
              let sum = 0;
              for (let L = 1; L <= MAX_GROUP && i + L <= n; L++) {
                if (L > 1 && !canJoin[i + L - 1]) break;
                sum += fs[i + L - 1];
                const d = (sum / L - pt.pos) / sigmaB;
                const s2 = cur + pt.lnUse + lnNorm - 0.5 * d * d + (L - 1) * lnSplit, y = at(i + L, j + 1);
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

  /* The onsets the stage places: the heard notes grouped by their OWN onset times (notes less than slotGap apart are one
     onset: one frame of a transcription), not by audio-score.js's 50-ms clusters - two written onsets a 16th apart at a
     fast tempo fall into one cluster when the timing noise brings them together, and a run detector splits chords heard a
     frame apart. Which onsets are one written onset (a chord heard over two frames, a rolled chord) is the matching's
     decision (matchBeat joins an onset to the point of the onset before it when they are at most joinGap apart).
     Returns [{t, notes: [note index]}] in time order. */
  function onsetsOf(notes, slotGap) {
    const idx = notes.map((n, i) => i).sort((a, b) => notes[a].on - notes[b].on || a - b);
    const out = [];
    let cur = null;
    idx.forEach(i => {
      if (cur && notes[i].on - notes[cur.notes[cur.notes.length - 1]].on <= slotGap) cur.notes.push(i);
      else { cur = { notes: [i] }; out.push(cur); }
    });
    out.forEach(o => { o.t = o.notes.reduce((s, i) => s + notes[i].on, 0) / o.notes.length; });
    return out;
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
          const r = matchPattern(fs, canJoin, pts, true, sigmaB, lg.out, lg.split);
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
          const r = matchPattern(fs, canJoin, pts, false, sigmaB, lg.out, lg.split);
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
    const TPB = opts.ticksPerBeat || 24;
    const kinds = (opts.kinds || model.kinds || KINDS).filter(k => KINDS.indexOf(k) >= 0);
    if (!beats || beats.length < 2) throw new Error('rec/grid: needs at least two beats');
    const onsets = onsetsOf(notes || [], model.slotGap);
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
        const canJoin = idx.map((i, x) => x > 0 && onsets[i].t - onsets[idx[x - 1]].t <= model.joinGap);
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
      report: { version: VERSION, model: model.version, sigmaSec: sigmaSec, beats: counts, lowConf: lowConf }
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
        tick: o.tick, endTick: endTick, err: o.err, tuplet: trip, subdivision: sub, lenTicks: Math.max(1, endTick - o.tick)
      };
    });
    return { q: q, errSum: errSum, plan: r.beats, report: r.report };
  }

  return {
    VERSION: VERSION, SCHEMA: SCHEMA, KINDS: KINDS, FALLBACK: FALLBACK,
    plan: plan, legacyQ: legacyQ, setModel: setModel,
    _: { gridOf: gridOf, matchPattern: matchPattern, beatPosition: beatPosition, onsetsOf: onsetsOf, beatsOf: beatsOf,
      beatLikelihoods: beatLikelihoods, smooth: smooth, modelOf: modelOf, WINDOW_EARLY: WINDOW_EARLY, SWING_POINTS: SWING_POINTS }
  };
});
