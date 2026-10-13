/* ============================================================================
   PPP rec/ (G10a-1, AI-5a) - the metre model: tables learned from the catalogue, the features of a reading, its score
   (docs/GOALS/G10 sections 8.1 and 8.3)

   A READING (hypothesis) of a performance is (track, rho, metre, phi): a pulse track of rec/beats.js, how many written
   quarters one tracked beat is (rho: 1/2 when the track follows eighths, 3/2 dotted quarters, 2 halves ...) and where
   the bar lines fall (phi, quarters from the track's first beat, a multiple of an eighth). Under a reading every attack
   is put on a slot of its bar, a grid of 1/24 of a quarter (32nds, 16ths, triplet eighths and triplet 16ths all lie on
   it), and every slot has a METRICAL LEVEL: 0 the downbeat, 1 a strong secondary beat (the half bar of 4/4 and 2/2, the
   dotted-quarter beats of x/8), 2 the beat (a quarter; an eighth in x/8), 3 its half, 4 its quarter, 5 a triplet (a
   duplet in x/8), 6 finer (32nds, triplet 16ths). The levels are what metres share; the tables are per FAMILY (simple:
   2/4, 3/4, 4/4, 2/2; compound: 3/8, 6/8, 9/8, 12/8) and level, so a metre is told apart by WHERE its strong slots are,
   not by the texture of the catalogue pieces that happen to be written in it (the catalogue's 2/4 is mostly Hanon's
   running 16ths, its 4/4 mostly hymns: a per-metre table learns that, and calls every hymn 4/4).

   THE TABLES (rec/tools/train.js, from the licence-clean catalogue scores, hold-out excluded; nothing tuned by hand):
     fill[L]   a Beta(a, b) over the share of a piece's level-L slots that hold an onset: pieces differ (a hymn fills its
               beats, an etude every 16th), and the Beta is the spread of that share across the catalogue
     snap[L]   log of the mean share: the prior that puts a jittered attack on the likelier of two nearby slots
     cls       per level, the log-likelihood ratio of the attack classes of rec/attacks.js (a bass change, a long IOI, a
               fuller chord) against their marginal: where bass notes, long notes and full chords fall
     first[L], last[L]   where the first and the last onset of a piece are (a pickup, the downbeat, a final chord)
     beat      per metre, per class of beat in the bar (downbeat, mid-bar, other): the log-likelihood ratio of the beat's
               accent evidence (an onset and how long until the next, a bass change, a harmony change, a fuller chord,
               and the four together) against the metre's own marginal - the contrast that tells a downbeat from the
               other beats, smoothed towards the family's with the weight of 100 beats
     tempo     per metre: mean and spread of log2 of the quarter tempo
     prior     per metre: log P(metre) in the catalogue (kept for the record; the weights learn one bias per metre)

   THE FEATURES of a reading (FEATURES): kern (how close each attack is to its slot, a Gaussian of width sigma in
   seconds), fill (the Beta-binomial marginal likelihood of which slots of each level hold an onset - a piece's own fill
   rates are integrated out, so a dense piece is not a different metre), the class ratios (bass, ioi, size), coll (attacks
   that fall on the slot of the one before), the beat accents (bdur, bbass, bharm, bsize, bjoint; one beat's ratio clipped
   to +-0.7), first, last, tempo, rep and repPc (does the bar's rhythm, and its pitch classes, come back a bar later), one
   bias per metre against 4/4, and, when the caller has the helper's audio beats, down (the share of its downbeats on the
   reading's bar lines) and audio (the reading stands on the helper's beat track); since G10a-1b, swing (the reading is a
   swung frame of a simple metre: its eighths played long-short, see SWING below). The per-attack features are means, the
   per-beat ones a mean times the square root of the beats, at most the weights' beatCap beats (scaled(); the weights' alpha
   and beatCap: G10 section 28). THE WEIGHTS that add them up
   are learned too (the multinomial logistic likelihood of the right reading among all readings of the training
   performances). The model only proposes; rec/metre.js turns the winner into beat times, bar lines and a tempo with plain
   arithmetic.

   Node and browser (window.PPPRecModules.model). Deterministic (Math.log/exp/sqrt/round only).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./attacks.js'), require('./beats.js'));
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.model = factory(M.attacks, M.beats); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (attacks, beats) {
  'use strict';

  const R = 24;                         /* slots per quarter */
  const SCHEMA = 'ppp.rec-time-skeleton/1';
  const NLEV = 7;                       /* levels 0..6 (a slot off the 32nd and triplet-16th grids is never used) */
  /* [key, beats, beatType, family, divisions of levels 1..5 in slots (null: none); level 6 is the rest of the multiples
      of 3 and 4] */
  /* ... then the beat unit of the accent evidence (slots) and the class of each such beat in the bar (0 the downbeat,
     1 a mid-bar strong beat, 2 the others; 3/4 and 9/8 tell their second and third beats apart) */
  const DEFS = [
    ['2/4', 2, 4, 'simple', [null, 24, 12, 6, 8], 24, [0, 1]],
    ['3/4', 3, 4, 'simple', [null, 24, 12, 6, 8], 24, [0, 1, 2]],
    ['4/4', 4, 4, 'simple', [48, 24, 12, 6, 8], 24, [0, 2, 1, 2]],
    ['2/2', 2, 2, 'simple', [48, 24, 12, 6, 8], 24, [0, 2, 1, 2]],
    ['3/8', 3, 8, 'compound', [null, 12, 6, 3, 18], 12, [0, 1, 2]],
    ['6/8', 6, 8, 'compound', [36, 12, 6, 3, 18], 36, [0, 1]],
    ['9/8', 9, 8, 'compound', [36, 12, 6, 3, 18], 36, [0, 1, 2]],
    ['12/8', 12, 8, 'compound', [36, 12, 6, 3, 18], 36, [0, 2, 1, 2]]
  ];
  const NBC = 3;                        /* beat classes */
  const EV = { dur: 5, bass: 2, harm: 2, size: 2, joint: 40 };   /* the accent evidence of a beat and its number of values (joint: all four together) */
  const FAMILIES = ['simple', 'compound'];
  const METRES = DEFS.map(d => {
    const barQ = d[1] * 4 / d[2];
    const S = Math.round(barQ * R);
    const lev = new Int8Array(S), count = new Int32Array(NLEV);
    for (let s = 0; s < S; s++) {
      let L = -1;
      if (s === 0) L = 0;
      else {
        for (let i = 0; i < 5; i++) { const dv = d[4][i]; if (dv && s % dv === 0) { L = i + 1; break; } }
        if (L < 0 && (s % 3 === 0 || s % 4 === 0)) L = 6;
      }
      lev[s] = L;
      if (L >= 0) count[L]++;
    }
    const compound = d[2] >= 8 && d[1] % 3 === 0;
    return Object.freeze({ key: d[0], beats: d[1], beatType: d[2], family: d[3], barQ: barQ, S: S, level: lev, count: count,
      compound: compound, unitQ: compound ? 1.5 : 1, beatSlots: d[5], beatClass: d[6] });
  });
  const BY_KEY = {};
  METRES.forEach((m, i) => { BY_KEY[m.key] = i; });
  const NCLS = { bass: 3, ioi: 5, size: 3 };
  const PHASE_STEP_Q = 0.5;
  /* the first PER_ATTACK features grow with the piece (scaled by n^alpha / n, see scaled()); the rest are one number a piece */
  const FEATURES = ['kern', 'fill', 'bass', 'ioi', 'size', 'coll', 'bdur', 'bbass', 'bharm', 'bsize', 'bjoint', 'first', 'last', 'tempo', 'rep', 'repPc',
    'is2/4', 'is3/4', 'is2/2', 'is3/8', 'is6/8', 'is9/8', 'is12/8', 'down', 'audio', 'swing'];
  const PER_ATTACK = 6, PER_BEAT = 11;
  const KERN_FLOOR = -8;                /* one attack's timing term is never below this (a ghost note, a tracking slip) */

  const log2 = x => Math.log(x) / Math.LN2;
  const round6 = x => Math.round(x * 1e6) / 1e6;

  /* log Gamma (Lanczos, g = 7, n = 9): deterministic, ~1e-13 relative */
  const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = LG[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
  /* log of the Beta-binomial probability of one particular pattern with n hits and m misses */
  function logBB(n, m, a, b) { return lbeta(n + a, m + b) - lbeta(a, b); }

  /* ------------------------------------------------------------------ beat accents */
  /* The accent evidence of every beat (the metre's evidence unit) from the bar of the first onset to the last onset's:
     seq = [{ abs (slot from a bar line), low, n, pcs }] sorted by abs, distinct. Per beat: its class in the bar and
       dur   0 no onset on the beat; else the IOI from it to the next onset in beats: 1 < 0.75, 2 < 1.5, 3 < 2.5, 4 more
             (the last onset: 4)
       bass  1 when the lowest note of the beat's onsets is not the lowest note of the last beat that had onsets
       harm  1 when the beat's pitch classes share less than half of their union with that beat's (a harmony change)
       size  1 when the onset on the beat has more notes than the piece's median onset
     The same function reads a written score (training) and a performance under a reading (inference). Each beat is
     one code: size * 10000 + class * 1000 + dur * 100 + bass * 10 + harm. */
  function beatScan(m, abs, low, nn, pcs, len, medN, visit) {
    const B = m.beatSlots, nb = Math.round(m.S / B);
    const k0 = Math.floor(abs[0] / m.S) * nb, k1 = Math.floor(abs[len - 1] / B);
    let j = 0, prevLow = -1, prevPcs = 0;
    for (let k = k0; k <= k1; k++) {
      const a = k * B, b = a + B;
      while (j < len && abs[j] < a) j++;
      let lo = -1, pc = 0, on = -1, jj = j;
      while (jj < len && abs[jj] < b) {
        if (lo < 0 || low[jj] < lo) lo = low[jj];
        pc |= pcs[jj];
        if (abs[jj] === a) on = jj;
        jj++;
      }
      let dur = 0, size = 0;
      if (on >= 0) {
        const nx = on + 1 < len ? (abs[on + 1] - abs[on]) / B : Infinity;
        dur = nx < 0.75 ? 1 : nx < 1.5 ? 2 : nx < 2.5 ? 3 : 4;
        size = nn[on] > medN ? 1 : 0;
      }
      let bass = 0, harm = 0;
      if (lo >= 0) {
        if (prevLow >= 0 && lo !== prevLow) bass = 1;
        if (prevPcs) { const u = popcount(pc | prevPcs), x = popcount(pc & prevPcs); if (x * 2 < u) harm = 1; }
        prevLow = lo; prevPcs = pc;
      }
      visit(m.beatClass[((k % nb) + nb) % nb], dur, bass, harm, size);
    }
  }
  /* the same over a list of { abs, low, n, pcs }: one code per beat, size * 10000 + class * 1000 + dur * 100 + bass * 10 + harm */
  function beatEvidence(m, seq, medN) {
    const res = [];
    beatScan(m, seq.map(o => o.abs), seq.map(o => o.low), seq.map(o => o.n), seq.map(o => o.pcs), seq.length, medN,
      (cls, dur, bass, harm, size) => { res.push(size * 10000 + cls * 1000 + dur * 100 + bass * 10 + harm); });
    return res;
  }
  function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }
  function evOf(code) {
    const e = { size: Math.floor(code / 10000), cls: Math.floor(code / 1000) % 10, dur: Math.floor(code / 100) % 10, bass: Math.floor(code / 10) % 10, harm: code % 10 };
    e.joint = e.dur * 8 + e.bass * 4 + e.harm * 2 + e.size;
    return e;
  }

  /* ------------------------------------------------------------------ tables (training) */
  /* the onsets of a truth row as { s (slot in the bar), abs (slots from the first full bar line), low, n } */
  function truthOnsets(r, m) {
    const pickupBar = r.pickup_q > 0;
    return r.onsets.filter(o => o[1] >= 0 && o[1] < m.S && m.level[o[1]] >= 0)
      .map(o => ({ s: o[1], abs: (o[0] - (pickupBar ? 1 : 0)) * m.S + o[1], low: o[2], n: o[3], pcs: o[7] || 0 }));
  }
  /* hits and slots per level over [first onset, last onset] of a sequence of absolute slots (sorted, distinct) */
  function fillCounts(m, absList, out) {
    out.n.fill(0); out.T.fill(0);
    if (!absList.length) return out;
    absList.forEach(p => { const s = ((p % m.S) + m.S) % m.S; out.n[m.level[s]]++; });
    countSlots(m, absList[0], absList[absList.length - 1] + 1, out.T);
    return out;
  }
  /* slots of each level in [a, b) */
  function countSlots(m, a, b, T) {
    const S = m.S;
    const qa = Math.floor(a / S), qb = Math.floor(b / S);
    if (qa === qb) { for (let p = a; p < b; p++) { const L = m.level[p - qa * S]; if (L >= 0) T[L]++; } return; }
    for (let p = a; p < (qa + 1) * S; p++) { const L = m.level[p - qa * S]; if (L >= 0) T[L]++; }
    for (let L = 0; L < NLEV; L++) T[L] += (qb - qa - 1) * m.count[L];
    for (let p = qb * S; p < b; p++) { const L = m.level[p - qb * S]; if (L >= 0) T[L]++; }
  }

  /* rows: rec_dataset.py --truth lines; returns the tables (plain numbers, rounded to 6 decimals) */
  function buildTables(rows, opts) {
    opts = opts || {};
    const K_CLS = opts.kCls || 10, K_TEMPO = opts.kTempo || 6, MIN_CONC = opts.minConc || 1, K_BEAT = opts.kBeat || 100;
    const fam = {};
    FAMILIES.forEach(f => {
      fam[f] = { rates: [], first: new Float64Array(NLEV), last: new Float64Array(NLEV), pieces: 0,
        cls: { bass: zeros2(NLEV, 3), ioi: zeros2(NLEV, 5), size: zeros2(NLEV, 3) } };
      for (let L = 0; L < NLEV; L++) fam[f].rates.push([]);
    });
    const per = METRES.map(() => ({ pieces: 0, tempos: [], beat: zeros3(NBC, EV) }));
    const cnt = { n: new Float64Array(NLEV), T: new Float64Array(NLEV) };
    rows.forEach(r => {
      const mi = BY_KEY[r.time[0] + '/' + r.time[1]];
      if (mi === undefined) return;
      const m = METRES[mi], F = fam[m.family];
      per[mi].pieces++;
      per[mi].tempos.push(log2(r.qpm));
      const seq = truthOnsets(r, m);
      if (seq.length < 2) return;
      F.pieces++;
      fillCounts(m, seq.map(o => o.abs), cnt);
      for (let L = 0; L < NLEV; L++) if (cnt.T[L] >= 4) F.rates[L].push(cnt.n[L] / cnt.T[L]);
      F.first[m.level[seq[0].s]]++;
      F.last[m.level[seq[seq.length - 1].s]]++;
      const medN = attacks.median(seq.map(o => o.n));
      beatEvidence(m, seq, medN).forEach(code => {
        const e = evOf(code);
        Object.keys(EV).forEach(k => { per[mi].beat[e.cls][k][e[k]]++; });
      });
      const cl = attacks.classesOf(seq.map(o => ({ t: o.abs, low: o.low, n: o.n })));
      seq.forEach((o, i) => {
        const L = m.level[o.s];
        F.cls.bass[L][cl[i].bass]++; F.cls.ioi[L][cl[i].ioi]++; F.cls.size[L][cl[i].size]++;
      });
    });
    const out = { families: {}, metres: {} };
    FAMILIES.forEach(f => {
      const F = fam[f];
      const fill = [], snap = [], first = [], last = [];
      for (let L = 0; L < NLEV; L++) {
        /* method of moments, with a floor on the concentration a + b */
        const xs = F.rates[L];
        let mu = xs.length ? mean(xs) : 0.05;
        mu = Math.min(0.995, Math.max(0.002, mu));
        const v = xs.length > 1 ? sumSq(xs, mean(xs)) / (xs.length - 1) : mu * (1 - mu) / 2;
        let conc = v > 0 ? mu * (1 - mu) / v - 1 : 50;
        conc = Math.max(MIN_CONC, Math.min(200, conc));
        fill.push([round6(mu * conc), round6((1 - mu) * conc)]);
        snap.push(round6(Math.log(mu)));
        first.push(round6(Math.log((F.first[L] + 0.5) / (F.pieces + 0.5 * NLEV))));
        last.push(round6(Math.log((F.last[L] + 0.5) / (F.pieces + 0.5 * NLEV))));
      }
      const cls = {};
      ['bass', 'ioi', 'size'].forEach(k => {
        const n = NCLS[k];
        const marg = new Array(n).fill(0);
        F.cls[k].forEach(row => row.forEach((v, j) => { marg[j] += v; }));
        const mt = marg.reduce((a, b) => a + b, 0);
        cls[k] = F.cls[k].map(row => {
          const rt = row.reduce((a, b) => a + b, 0);
          return row.map((v, j) => {
            const pm = (marg[j] + 1) / (mt + n);
            return round6(Math.log(((v + K_CLS * pm) / (rt + K_CLS)) / pm));
          });
        });
      });
      out.families[f] = { pieces: F.pieces, fill: fill, snap: snap, first: first, last: last, cls: cls };
    });
    const all = [];
    per.forEach(p => p.tempos.forEach(t => all.push(t)));
    const gMu = mean(all), gSd = Math.sqrt(sumSq(all, gMu) / Math.max(1, all.length));
    const total = per.reduce((s, p) => s + p.pieces, 0);
    /* the beat accents pooled over each family (class by class): the prior a metre with few pieces is smoothed to */
    const famBeat = {};
    FAMILIES.forEach(f => {
      famBeat[f] = zeros3(NBC, EV);
      METRES.forEach((m, mi) => { if (m.family === f) per[mi].beat.forEach((row, c) => Object.keys(EV).forEach(k => row[k].forEach((v, j) => { famBeat[f][c][k][j] += v; }))); });
    });
    const dist = (row, prior, K) => { const t = row.reduce((a, b) => a + b, 0); return row.map((v, j) => (v + K * prior[j]) / (t + K)); };
    METRES.forEach((m, mi) => {
      const p = per[mi];
      const mu = (sum(p.tempos) + K_TEMPO * gMu) / (p.tempos.length + K_TEMPO);
      const varM = (sumSq(p.tempos, mu) + K_TEMPO * gSd * gSd) / (p.tempos.length + K_TEMPO);
      /* the beat accents: per class, the log-likelihood ratio of each value against the metre's marginal (the contrast
         between the downbeat and the other beats, not how often a texture changes its bass); the metre's counts are
         smoothed to its family's with the weight of K_BEAT beats */
      const beat = {};
      Object.keys(EV).forEach(k => {
        const nv = EV[k], fb = famBeat[m.family];
        const uni = new Array(nv).fill(1 / nv);
        const fMarg = dist(fb.reduce((acc, row) => acc.map((x, j) => x + row[k][j]), new Array(nv).fill(0)), uni, nv * 0.5);
        const marg = dist(p.beat.reduce((acc, row) => acc.map((x, j) => x + row[k][j]), new Array(nv).fill(0)), fMarg, K_BEAT);
        beat[k] = p.beat.map((row, c) => {
          const fc = dist(fb[c][k], fMarg, nv * 0.5);
          const pc = dist(row[k], fc, K_BEAT);
          return pc.map((v, j) => round6(Math.log(v / marg[j])));
        });
      });
      out.metres[m.key] = { pieces: p.pieces, tempo: { mu: round6(mu), sd: round6(Math.max(0.3, Math.sqrt(varM))) },
        prior: round6(Math.log((p.pieces + 1) / (total + METRES.length))), beat: beat };
    });
    return out;
  }
  function zeros2(a, b) { const o = []; for (let i = 0; i < a; i++) o.push(new Array(b).fill(0)); return o; }
  function zeros3(a, spec) { const o = []; for (let i = 0; i < a; i++) { const r = {}; Object.keys(spec).forEach(k => { r[k] = new Array(spec[k]).fill(0); }); o.push(r); } return o; }
  function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
  function mean(xs) { return xs.length ? sum(xs) / xs.length : 0; }
  function sumSq(xs, mu) { return xs.reduce((a, x) => a + (x - mu) * (x - mu), 0); }

  /* the tables made ready for lookups, per metre */
  function prepared(tables) {
    if (tables._prep) return tables._prep;
    const P = METRES.map(m => {
      const f = tables.families[m.family], t = tables.metres[m.key];
      const snap = new Float64Array(m.S);
      for (let s = 0; s < m.S; s++) snap[s] = m.level[s] >= 0 ? f.snap[m.level[s]] : -Infinity;
      /* the first onset: its level's probability spread over the level's slots in the bar */
      const first = new Float64Array(NLEV), last = new Float64Array(NLEV);
      for (let L = 0; L < NLEV; L++) {
        first[L] = m.count[L] ? f.first[L] - Math.log(m.count[L]) : -20;
        last[L] = m.count[L] ? f.last[L] - Math.log(m.count[L]) : -20;
      }
      return { m: m, f: f, t: t, snap: snap, first: first, last: last };
    });
    Object.defineProperty(tables, '_prep', { value: P, enumerable: false });
    return P;
  }

  /* ------------------------------------------------------------------ readings */
  /* SWING (G10a-1b): a simple metre's eighths played long-short. In a swung frame the second eighth of every written quarter
     is heard at `s` of the quarter (0.5 straight, 2/3 a triplet swing) and everything inside the quarter moves with it
     (piecewise linear: [0, 1/2) of the written quarter -> [0, s) of the heard one, [1/2, 1) -> [s, 1)): what the humanizer's
     swing family plays (pppbench/humanize.py _swing_map) and what S3 writes straight (rec/grid.js swing8). The quarters of a
     frame start at slot `o` (0 or 12: a reading whose bar phase is an odd eighth has its quarters half a quarter later). */
  function swingHeard(c, s, o) {
    const base = Math.floor((c - o) / R) * R + o, u = (c - base) / R;
    return base + (u < 0.5 ? u * 2 * s : s + (u - 0.5) * 2 * (1 - s)) * R;
  }
  function swingWritten(g, s, o) {
    const base = Math.floor((g - o) / R) * R + o, v = (g - base) / R;
    return base + (v < s ? v * 0.5 / s : 0.5 + (v - s) * 0.5 / (1 - s)) * R;
  }

  /* the per-attack candidate slots of one (track, rho), straight or swung (swing = { s, o }): independent of the metre and of phi */
  function frame(att, cls, track, rho, sigma, downbeats, swing) {
    const n = att.length;
    const g = new Float64Array(n), w = new Float64Array(n);
    const spq = [];
    for (let i = 0; i < n; i++) {
      const x = beats.position(track.beats, att[i].t);
      const k = Math.max(0, Math.min(track.beats.length - 2, Math.floor(x)));
      const ibi = track.beats[k + 1] - track.beats[k];
      g[i] = x * rho * R;
      w[i] = ibi / rho / R;                    /* seconds per slot at this attack */
      spq.push(ibi / rho);
    }
    const qpm = 60 / attacks.median(spq);
    /* attack i's candidates are the consecutive slots lo[i] .. lo[i] + len[i] - 1, their timing terms kern[at[i] ..] */
    const lo = new Int32Array(n), len = new Int32Array(n), at = new Int32Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.min(8, Math.max(1, Math.ceil(2.5 * sigma / w[i])));
      if (!swing) {
        const c0 = Math.round(g[i]);
        lo[i] = c0 - r; len[i] = 2 * r + 1;
      } else {
        /* a written slot is judged by where the swing puts it; the written grid is up to 1.5 times denser in time there */
        const c0 = Math.round(swingWritten(g[i], swing.s, swing.o)), rs = Math.min(12, Math.ceil(r * 1.5));
        lo[i] = c0 - rs; len[i] = 2 * rs + 1;
      }
      at[i] = total; total += len[i];
    }
    const kern = new Float64Array(total);
    for (let i = 0; i < n; i++) {
      for (let j = 0, c = lo[i]; j < len[i]; j++, c++) {
        const d = (g[i] - (swing ? swingHeard(c, swing.s, swing.o) : c)) * w[i] / sigma;
        kern[at[i] + j] = -0.5 * d * d;
      }
    }
    return { n: n, lo: lo, len: len, at: at, kern: kern, cls: cls, pcs: att.map(a => a.pcs), att: att, medN: attacks.median(att.map(a => a.n)),
      qpm: qpm, rho: rho, track: track, downbeats: downbeats || null, swing: swing || null,
      buf: { abs: new Int32Array(n), low: new Int32Array(n), nn: new Int32Array(n), pcs: new Int32Array(n), first: new Int32Array(n),
        slots: new Int32Array(n) } };
  }

  const scratch = { n: new Float64Array(NLEV), T: new Float64Array(NLEV) };
  const acc = { bd: 0, bb: 0, bh: 0, bz: 0, bj: 0, nb: 0, tb: null };
  /* one beat's accent ratio is never more than +-0.7 (a factor of 2): a beat whose evidence is odd (a ghost note, a
     tracking slip) cannot outweigh many beats; with this clip the per-beat evidence grows with the square root of the
     number of beats (the weights' alpha), which cross-validation preferred to a mean or a sum (G10 section 18) */
  const BEAT_CLIP = 0.7;
  const clip = v => (v > BEAT_CLIP ? BEAT_CLIP : v < -BEAT_CLIP ? -BEAT_CLIP : v);
  function visitBeat(cl, dur, bass, harm, size) {
    const tb = acc.tb;
    acc.bd += clip(tb.dur[cl][dur]); acc.bb += clip(tb.bass[cl][bass]); acc.bh += clip(tb.harm[cl][harm]); acc.bz += clip(tb.size[cl][size]);
    acc.bj += clip(tb.joint[cl][dur * 8 + bass * 4 + harm * 2 + size]);
    acc.nb++;
  }
  /* features of (frame, metre index, phi in quarters) into out (FEATURES.length); returns the chosen slots when asked */
  function features(fr, mi, phi, tables, out, keepSlots) {
    const P = prepared(tables)[mi], m = P.m, f = P.f, S = m.S;
    const off = Math.round(phi * R);
    let fk = 0, fb = 0, fi = 0, fs = 0, coll = 0, ff = 0;
    const slots = keepSlots ? new Int32Array(fr.n) : fr.buf.slots;
    let prev = -Infinity;
    const hits = scratch.n; hits.fill(0);
    const cLo = fr.lo, cLen = fr.len, cAt = fr.at, cKern = fr.kern, snap = P.snap;
    for (let i = 0; i < fr.n; i++) {
      /* the candidates are consecutive slots, so the slot in the bar steps with them */
      let best = -Infinity, bc = 0, bk = 0;
      let p = cLo[i] - off, q = ((p % S) + S) % S;
      for (let j = cAt[i], e = cAt[i] + cLen[i]; j < e; j++, p++) {
        const v = cKern[j] + snap[q];
        if (v > best) { best = v; bc = p; bk = cKern[j]; }
        if (++q === S) q = 0;
      }
      const s = ((bc % S) + S) % S, L = m.level[s];
      slots[i] = bc;
      fk += Math.max(KERN_FLOOR, bk);
      const c = fr.cls[i];
      fb += f.cls.bass[L][c.bass]; fi += f.cls.ioi[L][c.ioi]; fs += f.cls.size[L][c.size];
      if (i === 0) ff = P.first[L];
      if (bc <= prev) coll++;
      else hits[L]++;
      if (bc > prev) prev = bc;
    }
    /* the fill marginal over [first slot, last slot] */
    const T = scratch.T; T.fill(0);
    countSlots(m, slots[0], prev + 1, T);
    let fill = 0;
    for (let L = 0; L < NLEV; L++) {
      if (!T[L]) continue;
      const ab = f.fill[L];
      fill += logBB(hits[L], Math.max(0, T[L] - hits[L]), ab[0], ab[1]);
    }
    /* the beat accents of the distinct onsets (an onset that shares a slot with the one before joins it) */
    const bf = fr.buf, dAbs = bf.abs, dLow = bf.low, dN = bf.nn, dPcs = bf.pcs, dFirst = bf.first;
    let len = 0;
    for (let i = 0; i < fr.n; i++) {
      const a = fr.att[i];
      if (len && slots[i] <= dAbs[len - 1]) { dN[len - 1] += a.n; dPcs[len - 1] |= a.pcs; if (a.low < dLow[len - 1]) dLow[len - 1] = a.low; continue; }
      dAbs[len] = slots[i]; dLow[len] = a.low; dN[len] = a.n; dPcs[len] = a.pcs; dFirst[len] = i; len++;
    }
    const tb = P.t.beat;
    acc.bd = 0; acc.bb = 0; acc.bh = 0; acc.bz = 0; acc.bj = 0; acc.nb = 0; acc.tb = tb;
    beatScan(m, dAbs, dLow, dN, dPcs, len, fr.medN, visitBeat);
    const bd = acc.bd, bb = acc.bb, bh = acc.bh, bz = acc.bz, bj = acc.bj;
    const lastS = ((dAbs[len - 1] % S) + S) % S;
    const tm = P.t.tempo, z = (log2(fr.qpm) - tm.mu) / tm.sd;
    out[0] = fk; out[1] = fill; out[2] = fb; out[3] = fi; out[4] = fs; out[5] = -coll;
    out[6] = bd; out[7] = bb; out[8] = bh; out[9] = bz; out[10] = bj;
    out[11] = ff; out[12] = P.last[m.level[lastS]]; out[13] = -0.5 * z * z - Math.log(tm.sd);
    out.nBeats = acc.nb;
    /* bar-to-bar repetition: of the attacks after the first bar, the share whose slot one bar earlier holds an onset
       too (rep), and of those the share with the same pitch classes (repPc): patterns repeat at the bar's period, so
       the right bar length (3 beats, not 4; six eighths, not eight) lines them up */
    const bar0 = Math.floor(dAbs[0] / S) * S + S;
    let after = 0, same = 0, samePc = 0;
    for (let j = 0, k = 0; j < len; j++) {
      const p = dAbs[j];
      if (p < bar0) continue;
      after++;
      while (k < len && dAbs[k] < p - S) k++;
      if (k < len && dAbs[k] === p - S) {
        same++;
        if (fr.pcs[dFirst[j]] === fr.pcs[dFirst[k]]) samePc++;
      }
    }
    out[14] = after ? same / after : 0;
    out[15] = same ? samePc / same : 0;
    /* one bias per metre against 4/4 (learned with the weights: how often each metre is the reading) */
    for (let j = 0, k = 16; j < METRES.length; j++) { if (METRES[j].key === '4/4') continue; out[k++] = j === mi ? 1 : 0; }
    /* the helper's audio downbeats, when the caller has them: the share that falls on a bar line of the reading (within
       a quarter of a quarter); and whether the reading stands on the helper's own beat track */
    let down = 0;
    if (fr.downbeats && fr.downbeats.length) {
      let hit = 0;
      fr.downbeats.forEach(t => {
        const q = fr.rho * beats.position(fr.track.beats, t) - phi, d = q / m.barQ;
        if (Math.abs(d - Math.round(d)) * m.barQ < 0.25) hit++;
      });
      down = hit / fr.downbeats.length;
    }
    out[23] = down;
    out[24] = fr.track.audio ? 1 : 0;
    out[25] = fr.swing ? 1 : 0;
    return keepSlots ? slots : null;
  }

  /* the per-attack features scaled to n^alpha (alpha 1: the plain log-likelihood; 0: the mean per attack): how fast the
     evidence of the attacks grows with the length of the piece, against the per-piece priors (learned).
     beatCap (G10a-1b): a reading's per-beat evidence grows with its beats only up to beatCap beats; past it, the mean per beat
     times the square root of beatCap. The growth law was fitted on the catalogue, whose performances are short (the right
     readings of the training performances count 31 / 61 / 123 / 334 beats: 10th percentile, median, 90th, max); a cover lasts
     three to five minutes (300-1,000 beats) and repeats its sections, which is not new evidence. Without the cap the accents of
     a long piece outgrow every per-piece prior (tempo, metre, first onset), and the more so the more beats a reading counts: a
     3/8 reading counts an eighth as a beat, three times the beats of a 4/4 reading of the same music (a hold-out piece played
     six times in a row: 4/4 -> 3/8 in 23 of 100 cases). The cap stops both. A cap in seconds (every reading counted as if the
     performance lasted that long, which keeps 3/8's threefold count) tied with it on the training references and read the
     teacher's piece 3/4 at half its tempo (G10 section 28).
   */
  function scaled(fv, n, alpha, out, nBeats, cap) {
    const aA = Array.isArray(alpha) ? alpha[0] : alpha, aB = Array.isArray(alpha) ? alpha[1] : alpha;
    const k = Math.pow(Math.max(1, n), aA) / Math.max(1, n);
    const nb = Math.max(1, nBeats || 1), kb = Math.pow(cap > 0 && nb > cap ? cap : nb, aB) / nb;
    for (let i = 0; i < FEATURES.length; i++) out[i] = i < PER_ATTACK ? fv[i] * k : i < PER_BEAT ? fv[i] * kb : fv[i];
    return out;
  }

  /* ------------------------------------------------------------------ G10a-1d: the bar phase (G10 section 36) */
  /* The harmonic rhythm of a reading: the attacks' pitch classes (every note's class once, the lowest note's twice: the bass names the
     chord) summed per window - half a bar in 4/4, 2/2 and 12/8, the metre's beat unit otherwise - and the change between two windows is
     1 - the cosine of their sums. Per bar: the change at its bar line minus the mean change at its inner window boundaries; returned:
     the mean over the bars where both are defined (0 when none). A reading whose bar lines are where the chords change scores high; the
     same reading half a bar off scores its negative. On the catalogue's 4/4 hold-out performances it prefers the right phase to the
     half-bar shift in 82 % of cases by itself. Not a feature of the metre model: it only chooses the phase (metre.js phaseStep). */
  let hbBuf = new Float64Array(12 * 256), hbHas = new Uint8Array(256);
  function harmonicContrast(m, slots, att, n) {
    if (n < 2) return 0;
    const Wn = (m.key === '4/4' || m.key === '2/2') ? 48 : m.key === '12/8' ? 72 : m.beatSlots;
    const per = Math.round(m.S / Wn);
    let wlo = Infinity, whi = -Infinity;
    for (let i = 0; i < n; i++) { const w = Math.floor(slots[i] / Wn); if (w < wlo) wlo = w; if (w > whi) whi = w; }
    wlo -= 1;
    const nw = whi - wlo + 1;
    if (nw * 12 > hbBuf.length) { hbBuf = new Float64Array(nw * 24); hbHas = new Uint8Array(nw * 2); }
    const C = hbBuf, has = hbHas;
    C.fill(0, 0, nw * 12); has.fill(0, 0, nw);
    for (let i = 0; i < n; i++) {
      const w = Math.floor(slots[i] / Wn) - wlo, a = att[i], base = w * 12;
      let x = a.pcs;
      while (x) { const b = x & -x; C[base + (31 - Math.clz32(b))] += 1; x ^= b; }
      C[base + (a.low % 12)] += 1;
      has[w] = 1;
    }
    const change = w => {
      if (w < 1 || w >= nw || !has[w] || !has[w - 1]) return -1;
      let ab = 0, aa = 0, bb = 0;
      for (let p = 0, i = (w - 1) * 12, j = w * 12; p < 12; p++, i++, j++) { ab += C[i] * C[j]; aa += C[i] * C[i]; bb += C[j] * C[j]; }
      return 1 - ab / Math.sqrt(aa * bb);
    };
    let sum = 0, cnt = 0;
    const b0 = Math.floor((wlo + 1) / per), b1 = Math.floor(whi / per);
    for (let b = b0; b <= b1; b++) {
      const dl = change(b * per - wlo);
      if (dl < 0) continue;
      let s = 0, k = 0;
      for (let j = 1; j < per; j++) { const x = change(b * per + j - wlo); if (x >= 0) { s += x; k++; } }
      if (!k) continue;
      sum += dl - s / k; cnt++;
    }
    return cnt ? sum / cnt : 0;
  }
  /* G10a-1d: the share of a piece's attacks that sound two or more different pitch classes at once (a chord, or a melody note over its
     bass): how much harmony there is to read. A melody alone or in octaves has none, and its harmonic contrast is the melody's own
     steps, noise for the phase; the phase step weighs the harmonic rhythm by this share */
  function chordShare(att) {
    if (!att.length) return 0;
    let c = 0;
    for (let i = 0; i < att.length; i++) { const x = att[i].pcs; if (x & (x - 1)) c++; }
    return c / att.length;
  }
  /* the share of the helper's downbeats on the bar lines of every phase (PHASE_STEP_Q apart) of one pulse (track, rho) and metre, within
     a quarter of a quarter */
  function phaseShares(track, rho, m, downbeats) {
    const np = Math.round(m.barQ / PHASE_STEP_Q), sh = new Float64Array(np), n = downbeats.length;
    downbeats.forEach(t => {
      const q = rho * beats.position(track.beats, t);
      for (let j = 0; j < np; j++) {
        const d = (q - j * PHASE_STEP_Q) / m.barQ;
        if (Math.abs(d - Math.round(d)) * m.barQ < 0.25) sh[j] += 1 / n;
      }
    });
    return sh;
  }
  /* the downbeats' evidence for one phase index k: its share minus the best phase's share, times how far that best share is above chance
     (one share per beat of the accent evidence: a quarter in x/4, an eighth in 3/8, a dotted quarter in 6/8, 9/8, 12/8), so downbeats that
     point at no phase (a downbeat every three beats under 4/4) say nothing and downbeats every half bar leave the two half-bar phases alike */
  function phaseDown(sh, k, m) {
    let mx = 0;
    for (let j = 0; j < sh.length; j++) if (sh[j] > mx) mx = sh[j];
    const u = m.beatSlots / m.S, c = mx > u ? (mx - u) / (1 - u) : 0;
    return (sh[k % sh.length] - mx) * c;
  }

  /* a model with fewer weights than FEATURES (one written before a feature existed) gives the features it has no weight for
     no say */
  function score(fv, weights) {
    let s = 0;
    const m = Math.min(FEATURES.length, weights.length);
    for (let i = 0; i < m; i++) s += fv[i] * weights[i];
    return s;
  }

  return Object.freeze({ R, SCHEMA, METRES, BY_KEY, FAMILIES, FEATURES, PER_ATTACK, PER_BEAT, NLEV, PHASE_STEP_Q, buildTables, prepared,
    frame, features, scaled, score, log2, lgamma, logBB, countSlots, fillCounts, beatEvidence, beatScan, swingHeard, swingWritten,
    harmonicContrast, chordShare, phaseShares, phaseDown });
});
