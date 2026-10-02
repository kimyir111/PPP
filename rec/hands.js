/* ============================================================================
   PPP recording pipeline - stage S4: hands (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8.1, phase G10a-2, AI-5b)

   Which hand plays each heard note, so which staff it is written on (staff 1 = right hand = upper staff,
   staff 2 = left hand = lower staff, as everywhere in PPP). A pure function: no I/O, no clock, no random,
   the same output on every platform (Node and the page).

     assign(notes, opts) -> {staff: [1|2 per note], conf: [0..1 per note], report}
     assignQ(q, ctx)     -> report; writes q[i].staff (the audio-score.js hook, opts.hands === 'v2')

   notes: [{midi, tick?, on?, attack?, staff?}] in any order. Notes that start together form an onset group:
   the same `tick` when every note has a finite tick (a quantized score), otherwise attacks within
   opts.chordWindow seconds (default 0.035) of the group's first. Time between groups (how far a hand may have
   moved) is read in seconds from `attack` (else `on`); without seconds, from ticks at opts.secondsPerTick
   (default 0.5 / 24: a quarter at 120). A note that already has staff 1 or 2 (a MIDI track) is left as it is
   and takes no part, as in the legacy writer. Velocity and releases are NOT read: a recording's releases are
   not evidence of a hand (G10-D4), and loudness cues are the synthetic performer's, not the player's.

   The model. Within one onset group the hands do not cross: the lowest k notes are the left hand's, the rest the
   right hand's (k = 0..n; a crossing inside one attack is 71 of 223,823 reference pairs on rec-core). Across
   groups a beam Viterbi carries each hand's last position (the lowest and highest note it last played, and
   when) and scores each choice by learned costs (-log frequencies counted on the licence-clean catalogue's
   written hands; tests/bench/tools/train_hands.js), each table with a weight chosen by measurement:
     part   how many notes each hand takes, given the group's size and shape (a bare octave or a wide pair is
            often one note per hand: parallel octaves; four-part chords are often two and two)
     span   the stretch of a hand's notes, per hand and count
     move   how far a hand's centre moves since it last played, per hand and the time since
     reg    the register of each note, per hand
     gap    the distance between the hands' notes when both play
     rel    where a hand's new notes are against the other hand's position (hands keep apart, rarely cross)
   conf per note: a logistic of the cost margin to the best choice that puts that note in the other hand,
   from the same incoming state (local, an approximation of the posterior).

   The weights are data (rec/hands-model.json, schema ppp.rec-hands-model/1), loaded by Node from this
   directory, or in a page from opts.model / setModel(json) / window.PPPRecHandsModel. No model, no guess:
   assign throws E-HANDS-NO-MODEL (the caller keeps the legacy split, audio-score.js assignHands).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(function () { return require('./hands-model.json'); });
  } else {
    root.PPPRecHands = factory(function () { return root.PPPRecHandsModel || null; });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (defaultModel) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'ppp.rec-hands-model/1';
  const RH = 1, LH = 2;

  /* ------------------------------------------------------------ table layout (shared with the trainer) */
  /* Group shapes for the part table: 0 one note; 1-5 two notes by interval (<= 4, 5-9, 10-11, 12 or 24 = a bare
     octave, 13-16, other wide); 7.. three, four, five, six or more notes. */
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

  function layout(P) {
    const NB = P.dtEdges.length + 1;
    const L = {};
    let off = 0;
    const put = (name, size) => { L[name] = off; off += size; };
    put('part', SHAPES * (CAP + 1) * (CAP + 1));
    put('span', 2 * (CAP + 1) * (SPAN_MAX + 1));
    put('move', 2 * NB * (2 * MOVE_MAX + 1));
    put('first', 2);
    put('reg', 2 * 128);
    put('gap', GAP_MAX + 1);
    put('rel', 2 * (2 * REL_MAX + 1));
    L.size = off;
    L.NB = NB;
    return L;
  }
  const TABLES = ['part', 'span', 'move', 'first', 'reg', 'gap', 'rel'];
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

  /* A hand's state: lo, hi (its last notes; -1 = not played yet), t (seconds). The events of one choice, as
     table indices, go to `emit`; returns the next state. Used by inference (sum of weighted costs) and by the
     trainer (counts on the written hands), so the two cannot disagree. */
  function step(P, L, s, g, k, emit) {
    const p = g.p, n = p.length;
    const nL = k, nR = n - k;
    emit(L.part + g.shape * (CAP + 1) * (CAP + 1) + Math.min(nL, CAP) * (CAP + 1) + Math.min(nR, CAP));
    let rLo = s.rLo, rHi = s.rHi, lLo = s.lLo, lHi = s.lHi, tR = s.tR, tL = s.tL;
    if (nR) {
      const lo = p[k], hi = p[n - 1];
      if (nR >= 2) emit(L.span + (0 * (CAP + 1) + Math.min(nR, CAP)) * (SPAN_MAX + 1) + Math.min(hi - lo, SPAN_MAX));
      if (s.rLo < 0) emit(L.first + 0);
      else {
        const b = bucketOf(P, g.t - s.tR);
        emit(L.move + (0 * L.NB + b) * (2 * MOVE_MAX + 1) + MOVE_MAX + clampI((lo + hi) - (s.rLo + s.rHi), -MOVE_MAX, MOVE_MAX));
      }
      if (s.lLo >= 0 && !nL) emit(L.rel + 0 * (2 * REL_MAX + 1) + REL_MAX + clampI(lo - s.lHi, -REL_MAX, REL_MAX));
      for (let i = k; i < n; i++) emit(L.reg + 0 * 128 + p[i]);
      rLo = lo; rHi = hi; tR = g.t;
    }
    if (nL) {
      const lo = p[0], hi = p[k - 1];
      if (nL >= 2) emit(L.span + (1 * (CAP + 1) + Math.min(nL, CAP)) * (SPAN_MAX + 1) + Math.min(hi - lo, SPAN_MAX));
      if (s.lLo < 0) emit(L.first + 1);
      else {
        const b = bucketOf(P, g.t - s.tL);
        emit(L.move + (1 * L.NB + b) * (2 * MOVE_MAX + 1) + MOVE_MAX + clampI((lo + hi) - (s.lLo + s.lHi), -MOVE_MAX, MOVE_MAX));
      }
      if (s.rLo >= 0 && !nR) emit(L.rel + 1 * (2 * REL_MAX + 1) + REL_MAX + clampI(s.rLo - hi, -REL_MAX, REL_MAX));
      for (let i = 0; i < k; i++) emit(L.reg + 1 * 128 + p[i]);
      lLo = lo; lHi = hi; tL = g.t;
    }
    if (nL && nR) emit(L.gap + Math.min(p[k] - p[k - 1], GAP_MAX));
    return { rLo: rLo, rHi: rHi, lLo: lLo, lHi: lHi, tR: tR, tL: tL };
  }
  const START = Object.freeze({ rLo: -1, rHi: -1, lLo: -1, lHi: -1, tR: 0, tL: 0 });

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

  /* The cost of one choice under one style's tables: the sum of its weighted table costs. */
  function costOf(M, WC, s, g, k) {
    let c = 0;
    const next = step(M.P, M.L, s, g, k, i => { c += WC[i]; });
    return { c: c, next: next };
  }

  function keyOf(s) { return s.rLo + ',' + s.rHi + ',' + s.lLo + ',' + s.lHi; }

  /* Beam Viterbi over the groups under one style's tables (WC): the best k per group. */
  function decode(M, groups, WC) {
    const B = M.P.beam || 32;
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
    return { ks: ks, parents: parents, cost: groups.length ? trail[groups.length - 1][0].c : 0 };
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
    _: Object.freeze({ layout: layout, step: step, START: START, groupsOf: groupsOf, shapeOf: shapeOf, bucketOf: bucketOf,
      decode: decode, decodeStyles: decodeStyles, prepare: prepare, tableOf: tableOf, TABLES: TABLES, SHAPES: SHAPES, CAP: CAP })
  });
});
