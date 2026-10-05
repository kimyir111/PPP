/* ============================================================================
   PPP recording pipeline - stage S4: hands (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8.1, phase G10a-2, AI-5b;
   playability G10a-2b, section 26)

   Which hand plays each heard note, so which staff it is written on (staff 1 = right hand = upper staff,
   staff 2 = left hand = lower staff, as everywhere in PPP). A pure function: no I/O, no clock, no random,
   the same output on every platform (Node and the page).

     assign(notes, opts) -> {staff: [1|2 per note, 0 for a note without a pitch], conf: [0..1 per note], report}
     assignQ(q, ctx)     -> the same; writes q[i].staff (audio-score.js finish(): opts.recording 'v2', or opts.hands 'v2')
     report: {version, model, style ('piano'|'chorale'), groups, notes, right, left, lowConfidence (conf < opts.lowConf, 0.75)}

   notes: [{midi, tick?, on?, attack?, staff?}] in any order. Notes that start together form an onset group:
   the same `tick` when every note has a finite tick (a quantized score), otherwise attacks within
   opts.chordWindow seconds (default 0.035) of the group's first. Time between groups (how far a hand may have
   moved) is read in seconds from `attack` (else `on`); without seconds, from ticks at opts.secondsPerTick
   (default 0.5 / 24: a quarter at 120). A note that already has staff 1 or 2 (a MIDI track) is left as it is
   and takes no part, as in the legacy writer. Velocity and releases are NOT read: a recording's releases are
   not evidence of a hand (G10-D4), and loudness cues are the synthetic performer's, not the player's.

   The model. Within one onset group the hands do not cross: the lowest k notes are the left hand's, the rest the
   right hand's (k = 0..n; a crossing inside one attack is 71 of 223,823 reference pairs on rec-core). Across
   groups a beam Viterbi (opts.model.params.beam states) carries each hand's last notes (lowest, highest, mean),
   when it played, how many notes and its previous inter-onset interval, and scores each choice by learned costs
   (-log frequencies counted on the licence-clean catalogue's written hands; tests/bench/tools/train_hands.js),
   each table with a weight chosen by measurement:
     part   how many notes each hand takes, given the group's size and shape (a bare octave or a wide pair is
            often one note per hand: parallel octaves; four-part chords are often two and two) and, when the model
            has params.ctx, the group's context (below)
     span   the stretch of a hand's notes, per hand and count
     move   how far a hand's centre moves since it last played, per hand and the time since
     reg    the register of each note, per hand
     gap    the distance between the hands' notes when both play
     rel    where a hand's new notes are against the other hand's position (hands keep apart, rarely cross)
     cnt    a hand's note count after its previous count (texture continuity: a hand playing sixths goes on)
     ioi    a hand's new inter-onset interval over its previous one (rhythm continuity)
   Each hand starts at the piece's lower / upper quartile pitch. Two styles, each a full set of tables: piano, and
   chorale (four parts on two staves, tenor and bass below: the hymnal's convention); a piece is decoded under both
   and the cheaper path's style is the piece's. conf per note: a logistic of the cost margin to the best choice
   that puts that note in the other hand, from the same incoming state (local, an approximation of the posterior).

   Playability (G10a-2b, section 26; each part is the model's, so a model without it decodes as before):
     context  params.ctx {w, d}: whether some other note lies at least d semitones below the group's lowest note,
              or above its highest, within w seconds (hand-free: read from the notes); the part table is counted per
              context class. A bare octave with nothing around it is a unison exercise's two hands; the same octave
              over a bass far below is a cover's right hand; a lone note over a bass far below is a melody note.
     play     params.play {w, span, keys, reach, perSemi}: what the G5a analyzer (playability/analyze.js) calls a
              hard violation costs w for each one a choice makes, so a hand is never given notes it cannot play
              unless every choice does: a hand wider than `span` semitones or with more than `keys` notes at one
              onset, and a lateral shift too fast for the time since the hand last played - beyond `reach`
              semitones it needs perSemi seconds a semitone (playability/reach.js requiredSeconds) - measured on
              the hand's mean pitch (G5a) and on its outer line (the right hand's top, the left hand's bottom: the
              notes the one-note arranger keeps).

   The weights are data (rec/weights/hands-v1.json, schema ppp.rec-hands-model/1), loaded by Node from rec/weights/,
   or in a page from opts.model / setModel(json) / window.PPPRecHandsWeights. No model, no guess: assign throws
   E-HANDS-NO-MODEL (audio-score.js then keeps the legacy split, assignHands, and says so in its handsReport).
   Browser: rec/hands.js registers PPPRecModules.hands (before rec/index.js, which exposes it as PPPRec.hands).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(function () { try { return require('./weights/hands-v1.json'); } catch (e) { return null; } });
  } else {
    const M = root.PPPRecModules = root.PPPRecModules || {};
    M.hands = factory(function () { return root.PPPRecHandsWeights || null; });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (defaultModel) {
  'use strict';

  const VERSION = '1.1.0';
  const SCHEMA = 'ppp.rec-hands-model/1';
  const RH = 1, LH = 2;

  /* ------------------------------------------------------------ table layout (shared with the trainer) */
  /* Group shapes for the part table: 0 one note; 1-6 two notes by interval (1: <= 4, 2: 5-9, 3: 10-11, 4: 12 or 24
     = a bare octave, 5: 13-16, 6: wider); 7 three notes, 8 four, 9 five or more. */
  const SHAPES = 10;
  function shapeOf(p) {
    const n = p.length;
    if (n === 1) return 0;
    if (n === 2) {
      const iv = p[1] - p[0];
      if (iv === 12 || iv === 24) return 4;
      if (iv <= 4) return 1;
      if (iv <= 9) return 2;
      if (iv <= 11) return 3;
      if (iv <= 16) return 5;
      return 6;
    }
    return Math.min(9, n + 4);         /* 3 -> 7, 4 -> 8, 5+ -> 9 */
  }
  const CAP = 4;                       /* note counts per hand above 4 share a cell */
  const SPAN_MAX = 24, MOVE_MAX = 60, GAP_MAX = 24, REL_MAX = 24;
  /* the rhythm of a hand: its new inter-onset interval over its previous one, in half-octave steps of the ratio
     (round(2 log2 r), -6..6); the edges are 2^((j - 0.5) / 2), written out so no platform's log decides a bucket */
  const IOI_EDGES = [0.148650889, 0.210224104, 0.297301779, 0.420448208, 0.594603558, 0.840896415,
    1.189207115, 1.681792831, 2.378414230, 3.363585661, 4.756828460, 6.727171322];
  const IOI_N = IOI_EDGES.length + 1;
  const CONTEXTS = 4;                  /* params.ctx: 0 nothing around, 1 a note far below, 2 far above, 3 both */

  /* Offsets of each table; L.size is the length of a style's cost array. */
  function layout(P) {
    const NB = P.dtEdges.length + 1;
    const L = {};
    let off = 0;
    const put = (name, size) => { L[name] = off; off += size; };
    put('part', SHAPES * (P.ctx ? CONTEXTS : 1) * (CAP + 1) * (CAP + 1));
    put('span', 2 * (CAP + 1) * (SPAN_MAX + 1));
    put('move', 2 * NB * (2 * MOVE_MAX + 1));
    put('reg', 2 * 128);
    put('gap', GAP_MAX + 1);
    put('rel', 2 * (2 * REL_MAX + 1));
    put('cnt', 2 * (CAP + 1) * (CAP + 1));
    put('ioi', 2 * IOI_N);
    L.size = off;
    L.NB = NB;
    return L;
  }
  const TABLES = ['part', 'span', 'move', 'reg', 'gap', 'rel', 'cnt', 'ioi'];
  function tableOf(L, idx) {
    let name = TABLES[0];
    TABLES.forEach(t => { if (idx >= L[t]) name = t; });
    return name;
  }

  const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
  function bucketOf(P, dt) {
    let b = 0;
    while (b < P.dtEdges.length && dt > P.dtEdges[b]) b++;
    return b;
  }
  function ioiBucket(r) {
    let b = 0;
    while (b < IOI_EDGES.length && r >= IOI_EDGES[b]) b++;
    return b;
  }

  /* What the notes alone say about each group, for a model with params.ctx: g.ctx, the context class (0 nothing far
     around, 1 a note at least ctx.d semitones below the group's lowest within ctx.w seconds, 2 one above its highest,
     3 both). Computed once per list of groups. */
  function contextOf(groups, P) {
    if (!P.ctx) return groups;
    const key = P.ctx.w + '|' + P.ctx.d;
    if (groups.ctxKey === key) return groups;
    const W = P.ctx.w, D = P.ctx.d;
    let a = 0, b = 0;
    groups.forEach((g, gi) => {
      while (groups[a].t < g.t - W) a++;
      if (b < gi) b = gi;
      while (b + 1 < groups.length && groups[b + 1].t <= g.t + W) b++;
      const lo = g.p[0], hi = g.p[g.p.length - 1];
      let below = false, above = false;
      for (let j = a; j <= b && !(below && above); j++) {
        if (j === gi) continue;
        const q = groups[j].p;
        if (q[0] <= lo - D) below = true;
        if (q[q.length - 1] >= hi + D) above = true;
      }
      g.ctx = (below ? 1 : 0) + (above ? 2 : 0);
    });
    groups.ctxKey = key;
    return groups;
  }

  /* A hand's state: lo, hi (the notes it last played), c (their mean), t (when, seconds), n (how many), i (the
     interval before that, seconds; 0 = not known). The events of one choice, as table indices, go to `emit`;
     returns the next state. Used by inference (the sum of weighted costs) and by the trainer (counts along the
     written hands), so the two cannot disagree.
       part  the group's shape (and context) x (left count, right count)   span  per hand and count
       move  per hand and time since: the change of its centre    reg   per hand: each note's pitch
       gap   both hands play: the interval between them           rel   one hand plays: its notes against the
       cnt   per hand: its count after its previous count               other hand's position
       ioi   per hand: its new interval over its previous one */
  function hand(P, L, h, lo, hi, n, sLo, sHi, t, sN, sI, g, emit) {
    if (n >= 2) emit(L.span + (h * (CAP + 1) + Math.min(n, CAP)) * (SPAN_MAX + 1) + Math.min(hi - lo, SPAN_MAX));
    emit(L.move + (h * L.NB + bucketOf(P, g.t - t)) * (2 * MOVE_MAX + 1) + MOVE_MAX + clampI((lo + hi) - (sLo + sHi), -MOVE_MAX, MOVE_MAX));
    emit(L.cnt + (h * (CAP + 1) + Math.min(sN, CAP)) * (CAP + 1) + Math.min(n, CAP));
    if (sI > 0) emit(L.ioi + h * IOI_N + ioiBucket((g.t - t) / sI));
  }
  function step(P, L, s, g, k, emit) {
    const p = g.p, n = p.length;
    const nL = k, nR = n - k;
    const shape = P.ctx ? g.shape * CONTEXTS + g.ctx : g.shape;
    emit(L.part + shape * (CAP + 1) * (CAP + 1) + Math.min(nL, CAP) * (CAP + 1) + Math.min(nR, CAP));
    const x = { rLo: s.rLo, rHi: s.rHi, lLo: s.lLo, lHi: s.lHi, cR: s.cR, cL: s.cL, tR: s.tR, tL: s.tL, nR: s.nR, nL: s.nL, iR: s.iR, iL: s.iL };
    if (nR) {
      const lo = p[k], hi = p[n - 1];
      hand(P, L, 0, lo, hi, nR, s.rLo, s.rHi, s.tR, s.nR, s.iR, g, emit);
      if (!nL) emit(L.rel + 0 * (2 * REL_MAX + 1) + REL_MAX + clampI(lo - s.lHi, -REL_MAX, REL_MAX));
      let sum = 0;
      for (let i = k; i < n; i++) { emit(L.reg + 0 * 128 + p[i]); sum += p[i]; }
      x.rLo = lo; x.rHi = hi; x.cR = sum / nR; x.tR = g.t; x.nR = nR; x.iR = isFinite(s.tR) ? g.t - s.tR : 0;
    }
    if (nL) {
      const lo = p[0], hi = p[k - 1];
      hand(P, L, 1, lo, hi, nL, s.lLo, s.lHi, s.tL, s.nL, s.iL, g, emit);
      if (!nR) emit(L.rel + 1 * (2 * REL_MAX + 1) + REL_MAX + clampI(s.rLo - hi, -REL_MAX, REL_MAX));
      let sum = 0;
      for (let i = 0; i < k; i++) { emit(L.reg + 1 * 128 + p[i]); sum += p[i]; }
      x.lLo = lo; x.lHi = hi; x.cL = sum / nL; x.tL = g.t; x.nL = nL; x.iL = isFinite(s.tL) ? g.t - s.tL : 0;
    }
    if (nL && nR) emit(L.gap + Math.min(p[k] - p[k - 1], GAP_MAX));
    return x;
  }
  /* params.play: the G5a hard violations one choice makes (the hands' state s, group g, the lowest k notes to the left
     hand). Not a table: a count, so the decoder pays play.w for each (section 26). */
  function needs(Q, dist) { return dist <= Q.reach ? 0 : (dist - Q.reach) * Q.perSemi; }
  function hardOf(Q, s, g, k) {
    const p = g.p, n = p.length;
    let v = 0;
    if (n > k) {
      const lo = p[k], hi = p[n - 1];
      if (hi - lo > Q.span) v++;
      if (n - k > Q.keys) v++;
      if (isFinite(s.tR)) {
        let sum = 0;
        for (let i = k; i < n; i++) sum += p[i];
        const dt = g.t - s.tR + 1e-9;
        if (dt < needs(Q, Math.abs(sum / (n - k) - s.cR))) v++;
        if (dt < needs(Q, Math.abs(hi - s.rHi))) v++;
      }
    }
    if (k > 0) {
      const lo = p[0], hi = p[k - 1];
      if (hi - lo > Q.span) v++;
      if (k > Q.keys) v++;
      if (isFinite(s.tL)) {
        let sum = 0;
        for (let i = 0; i < k; i++) sum += p[i];
        const dt = g.t - s.tL + 1e-9;
        if (dt < needs(Q, Math.abs(sum / k - s.cL))) v++;
        if (dt < needs(Q, Math.abs(lo - s.lLo))) v++;
      }
    }
    return v;
  }
  /* Before its first note a hand is where the piece's register puts it: the left hand at the lower quartile of the
     piece's pitches, the right at the upper, long ago (the longest-rest bucket), with no count or rhythm yet. */
  function startOf(groups) {
    const all = [];
    groups.forEach(g => g.p.forEach(m => all.push(m)));
    all.sort((a, b) => a - b);
    const q = f => (all.length ? all[Math.min(all.length - 1, Math.floor(f * all.length))] : 60);
    const l = q(0.25), r = q(0.75);
    return { rLo: r, rHi: r, lLo: l, lHi: l, cR: r, cL: l, tR: -Infinity, tL: -Infinity, nR: 0, nL: 0, iR: 0, iL: 0 };
  }

  /* ------------------------------------------------------------ groups */
  function groupsOf(notes, opts) {
    opts = opts || {};
    const idx = [];
    notes.forEach((n, i) => {
      if (n && (n.staff === RH || n.staff === LH)) return;
      if (!(n && Number.isFinite(n.midi))) return;
      idx.push(i);
    });
    const byTick = idx.length && idx.every(i => Number.isFinite(notes[i].tick));
    const secOf = i => {
      const n = notes[i];
      if (Number.isFinite(n.attack)) return +n.attack;
      if (Number.isFinite(n.on)) return +n.on;
      return Number.isFinite(n.tick) ? n.tick * (opts.secondsPerTick || 0.5 / 24) : 0;
    };
    const order = idx.slice().sort((a, b) => {
      const ka = byTick ? notes[a].tick : secOf(a), kb = byTick ? notes[b].tick : secOf(b);
      return ka - kb || notes[a].midi - notes[b].midi || a - b;
    });
    const win = opts.chordWindow != null ? +opts.chordWindow : 0.035;
    const groups = [];
    let cur = null;
    order.forEach(i => {
      const key = byTick ? notes[i].tick : secOf(i);
      if (!cur || (byTick ? key !== cur.key : key - cur.key > win)) {
        cur = { key: key, idx: [] };
        groups.push(cur);
      }
      cur.idx.push(i);
    });
    return groups.map(gr => {
      gr.idx.sort((a, b) => notes[a].midi - notes[b].midi || a - b);
      const p = gr.idx.map(i => notes[i].midi | 0);
      let t = Infinity;
      gr.idx.forEach(i => { t = Math.min(t, secOf(i)); });
      return { idx: gr.idx, p: p, t: t, shape: shapeOf(p) };
    });
  }

  /* ------------------------------------------------------------ the model */
  let registered = null;
  function setModel(m) { registered = m || null; prepared = null; }
  let prepared = null;
  function prepare(model) {
    if (!model || model.schema !== SCHEMA) {
      const e = new Error('rec/hands: no hand model (' + SCHEMA + ') is loaded');
      e.code = 'E-HANDS-NO-MODEL';
      throw e;
    }
    if (prepared && prepared.model === model) return prepared;
    const P = model.params;
    const L = layout(P);
    const styles = (model.styles || []).map(st => {
      if (!Array.isArray(st.costs) || st.costs.length !== L.size) {
        const e = new Error('rec/hands: style ' + st.name + ' has ' + (st.costs || []).length + ' costs, the layout needs ' + L.size);
        e.code = 'E-HANDS-MODEL-SHAPE';
        throw e;
      }
      const WC = new Float64Array(L.size);
      TABLES.forEach((t, ti) => {
        const end = ti + 1 < TABLES.length ? L[TABLES[ti + 1]] : L.size;
        const w = +(model.weights[t] || 0);
        for (let i = L[t]; i < end; i++) WC[i] = w * st.costs[i] / 1000;
      });
      return { name: st.name, WC: WC };
    });
    if (!styles.length) {
      const e = new Error('rec/hands: the model has no style');
      e.code = 'E-HANDS-MODEL-SHAPE';
      throw e;
    }
    prepared = { model: model, P: P, L: L, styles: styles };
    return prepared;
  }
  function modelOf(opts) {
    if (opts && opts.model) return opts.model;
    if (registered) return registered;
    return defaultModel();
  }

  /* The cost of one choice under one style's tables: the sum of its weighted table costs and of its hard violations
     (one accumulator, no closure per call: the decoder calls this a few hundred thousand times for a long piece). */
  let accWC = null, acc = 0;
  const addCost = i => { acc += accWC[i]; };
  function costOf(M, WC, s, g, k) {
    accWC = WC; acc = 0;
    const next = step(M.P, M.L, s, g, k, addCost);
    if (M.P.play) acc += M.P.play.w * hardOf(M.P.play, s, g, k);
    return { c: acc, next: next };
  }

  /* states that agree on both hands' last notes and counts are one state (the cheaper path is kept); a number, not a
     string: positions are 0-127, counts 0-CAP */
  function keyOf(s) {
    return ((((s.rLo * 128 + s.rHi) * 128 + s.lLo) * 128 + s.lHi) * (CAP + 1) + Math.min(s.nR, CAP)) * (CAP + 1) + Math.min(s.nL, CAP);
  }

  /* Beam Viterbi over the groups under one style's tables (WC): the best k per group. */
  function decode(M, groups, WC) {
    contextOf(groups, M.P);
    const B = M.P.beam || 32;
    const START = startOf(groups);
    let beam = [{ s: START, c: 0, from: -1, k: -1 }];
    const trail = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const n = g.p.length;
      const next = new Map();
      for (let bi = 0; bi < beam.length; bi++) {
        const b = beam[bi];
        for (let k = 0; k <= n; k++) {
          const r = costOf(M, WC, b.s, g, k);
          const c = b.c + r.c;
          const key = keyOf(r.next);
          const have = next.get(key);
          if (!have || c < have.c) next.set(key, { s: r.next, c: c, from: bi, k: k });
        }
      }
      const list = Array.from(next.values());
      list.sort((x, y) => x.c - y.c);
      beam = list.slice(0, B);
      trail.push(beam);
    }
    const ks = new Array(groups.length);
    const parents = new Array(groups.length);
    let at = 0;
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const e = trail[gi][at];
      ks[gi] = e.k;
      parents[gi] = e.from >= 0 && gi > 0 ? trail[gi - 1][e.from].s : START;
      at = e.from;
    }
    return { ks: ks, parents: parents, cost: groups.length ? trail[groups.length - 1][0].c : 0, start: START };
  }
  /* Every style decodes the whole piece; the one whose best path costs least is the piece's (a tie keeps the
     earlier style). The styles share the weights and their tables are counted the same way, so the costs compare
     as (weighted) likelihoods of the same notes. */
  function decodeStyles(M, groups) {
    let best = null;
    M.styles.forEach((st, si) => {
      const d = decode(M, groups, st.WC);
      d.style = si;
      if (!best || d.cost < best.cost) best = d;
    });
    return best;
  }

  /* ------------------------------------------------------------ public */
  function assign(notes, opts) {
    opts = opts || {};
    const M = prepare(modelOf(opts));
    const list = notes || [];
    const groups = groupsOf(list, opts);
    const staff = list.map(n => (n && (n.staff === RH || n.staff === LH) ? n.staff : 0));
    const conf = list.map(n => (n && (n.staff === RH || n.staff === LH) ? 1 : 0));
    const d = decodeStyles(M, groups);
    const WC = M.styles[d.style].WC;
    let low = 0;
    groups.forEach((g, gi) => {
      const k = d.ks[gi];
      const base = costOf(M, WC, d.parents[gi], g, k).c;
      const alt = [];
      for (let j = 0; j <= g.p.length; j++) alt.push(j === k ? 0 : costOf(M, WC, d.parents[gi], g, j).c - base);
      g.idx.forEach((ni, pos) => {
        staff[ni] = pos < k ? LH : RH;
        /* the cheapest choice that puts this note in the other hand: a k' on the other side of it */
        let m = Infinity;
        for (let j = 0; j <= g.p.length; j++) {
          if (j === k) continue;
          const flips = pos < k ? j <= pos : j > pos;
          if (flips && alt[j] < m) m = alt[j];
        }
        const cf = m === Infinity ? 1 : 1 / (1 + Math.exp(-m));
        conf[ni] = Math.round(cf * 1e6) / 1e6;
        if (cf < (opts.lowConf != null ? opts.lowConf : 0.75)) low++;
      });
    });
    return {
      staff: staff, conf: conf,
      report: { version: VERSION, model: M.model.version, style: M.styles[d.style].name, groups: groups.length,
        notes: groups.reduce((s, g) => s + g.p.length, 0),
        right: staff.filter(x => x === RH).length, left: staff.filter(x => x === LH).length, lowConfidence: low }
    };
  }

  /* The audio-score.js hook: q are its quantized notes ({midi, tick, attack, on, staff}); only `staff` is written,
     in place (nothing else of q changes). Returns assign's result (conf per note in q's order, the report). */
  function assignQ(q, ctx) {
    const r = assign(q, ctx || {});
    q.forEach((n, i) => { if (!(n.staff === RH || n.staff === LH)) n.staff = r.staff[i]; });
    return r;
  }

  return Object.freeze({
    VERSION: VERSION, SCHEMA: SCHEMA, assign: assign, assignQ: assignQ, setModel: setModel,
    /* for the trainer and the tests (tests/bench/tools/train_hands.js): the same layout and events as inference */
    _: Object.freeze({ layout: layout, step: step, groupsOf: groupsOf, shapeOf: shapeOf, bucketOf: bucketOf,
      contextOf: contextOf, hardOf: hardOf, decode: decode, decodeStyles: decodeStyles, prepare: prepare, startOf: startOf,
      ioiBucket: ioiBucket, IOI_N: IOI_N, tableOf: tableOf, TABLES: TABLES, SHAPES: SHAPES, CAP: CAP, CONTEXTS: CONTEXTS })
  });
});
