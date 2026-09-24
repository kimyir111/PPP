/* ============================================================================
   PPP ScoreGraph — the metric grid of a measure (docs/GOALS/G03 §6.2, §6.3, §11.2)

   G3's passes write notation inside a measure: which note values, where a
   tie breaks a value, which beats a beam groups. All of them read the same
   beat hierarchy from here, so "the beat" means one thing in every pass.

     grid(g, measureId)   the measure's hierarchy: its length, the pickup
                          offset, the beat, the beat groups, the level of any
                          position (bar 0, group 1, beat 2, half-beat 3, …)
     symbolOk(grid, …)    may this value stand at this place (hard rules
                          H2-H7 and the S table)?
     symbolCost(grid, …)  its readability cost (§6.2), in integer thousandths
     beamGroups(grid)     the primary beam grouping (§11.2 table)

   Positions inside a measure are integers of 1/U whole notes (U from the
   grid), so every comparison here is exact integer arithmetic: no floating
   point decides anything (G03 §16.2, G0-D8).

   The weights are the §6.2 starting values, fixed at Step 5 by the R
   fixtures (tests/scoregraph/fixtures/g3/rhythm). Changing one changes G3's
   output; the fixtures and the golden say so.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./time.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.meterGrid = factory(M.rational, M.schema, M.time); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, T) {
  'use strict';

  /* §6.2 readability cost, ×1000 (integers). */
  const COST = Object.freeze({
    SYMBOL: 1000,          /* every symbol: fragmentation */
    TIE_IN: 600,           /* a tie coming into this symbol */
    DOT: 250,              /* per dot */
    DOUBLE_DOT: 400,       /* extra, for a double dot */
    HIDE: [0, 500, 250, 125],   /* 0.50 × hides(level): group 1.0, beat 0.5, half-beat 0.25 (index = level) */
    SHORT: 300,            /* a value shorter than a 16th */
    REST_SPLIT_OFF_BEAT: 800   /* a rest that does not start on a beat, written as two or more rests */
  });

  /* The resolution of a grid: positions are integers of 1/U W. 1/64 (the shortest binary value written here)
     and 1/96 (audio-score's tick) both divide it, and so do the triplet values down to a triplet 64th. */
  const U = 192;
  const LEVEL = Object.freeze({ BAR: 0, GROUP: 1, BEAT: 2, HALF: 3 });

  /* Binary values PPP writes, longest first: [type, dots, W as integer of 1/U]. */
  const BINARY = [];
  ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'].forEach(t => {
    const v = S.NOTE_TYPE_VALUE[t];
    const base = v.n * U / v.d;
    [0, 1, 2].forEach(dots => {
      const w = base * (Math.pow(2, dots + 1) - 1) / Math.pow(2, dots);
      if (Number.isInteger(w) && w > 0) BINARY.push({ type: t, dots: dots, len: w });
    });
  });
  BINARY.sort((a, b) => b.len - a.len || a.dots - b.dots);

  function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
  function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }

  /* The hierarchy for a time signature (§6.3, §11.2): beat and groups as integers of 1/U.
     compound: 6/8, 9/8, 12/8 (and 3/8, one dotted-quarter beat), n/16 alike.
     additive (5/8, 7/8 …): MeterEvent.groups, or 2+3 / 2+2+3 by default; each group is a beat. */
  function hierarchy(meter, nomU) {
    const n = meter.beats.reduce((s, b) => s + b, 0), bt = meter.beatType;
    const unit = U / bt;
    const out = { n: n, beatType: bt, compound: false, additive: false, beats: [], groups: [], sub: 0 };
    const explicit = Array.isArray(meter.groups) && meter.groups.length ? meter.groups.map(x => { const r = R.parse(x); return r.n * U / r.d; }) : null;
    const push = (arr, len) => { let at = 0; len.forEach(l => { arr.push(at); at += l; }); };
    if (explicit && explicit.every(Number.isInteger)) {
      /* the file says how the measure is grouped: each group is a beat; the group level is the whole measure */
      out.additive = true;
      push(out.beats, explicit);
      out.groups = [0];
      out.sub = unit;
      out.beatLens = explicit;
    } else if (meter.beats.length > 1) {
      const lens = meter.beats.map(b => b * unit);
      out.additive = true;
      push(out.beats, lens);
      out.groups = [0];
      out.sub = unit;
      out.beatLens = lens;
    } else if (bt >= 8 && n % 3 === 0) {
      out.compound = true;
      const beat = 3 * unit;
      for (let at = 0; at < nomU; at += beat) out.beats.push(at);
      /* 12/8: two groups of two beats; 6/8, 9/8, 3/8: the measure */
      out.groups = n === 12 ? [0, nomU / 2] : [0];
      out.sub = unit;
    } else if (bt >= 8 && (n === 5 || n === 7)) {
      out.additive = true;
      const lens = (n === 5 ? [2, 3] : [2, 2, 3]).map(x => x * unit);
      push(out.beats, lens);
      out.groups = [0];
      out.sub = unit;
      out.beatLens = lens;
    } else {
      for (let at = 0; at < nomU; at += unit) out.beats.push(at);
      /* 4/4 (and 4/2): two halves; everything else simple: the measure */
      out.groups = n === 4 ? [0, nomU / 2] : [0];
      out.sub = unit / 2;
    }
    return out;
  }

  /* The grid of a measure. A short first measure, or one marked implicit, is a pickup: its notes line up with
     the end of a full measure (G03 R14), so a position p in it sits at p + off in the full measure's hierarchy. */
  function grid(g, measureId) {
    const c = T.measureIndex(g, measureId);
    if (c < 0) throw new Error('E-REF-MISSING: no measure ' + measureId);
    const meas = g.timeline.measures[c];
    const meter = T.meterAt(g, measureId);
    if (!meter) return null;
    const nom = T.nominal(meter), dur = R.parse(meas.dur);
    const toU = r => r.n * U / r.d;
    const nomU = toU(nom), durU = toU(dur);
    if (!Number.isInteger(nomU) || !Number.isInteger(durU)) return null;
    const pickup = durU < nomU && (c === 0 || !!meas.implicit);
    const h = hierarchy(meter, nomU);
    const off = pickup ? nomU - durU : 0;
    return Object.assign(h, { measure: measureId, U: U, nomU: nomU, durU: durU, off: off, pickup: pickup, meter: meter });
  }

  /* The metric level of a position (integer of 1/U, measured from the measure's start): 0 the bar line, 1 a beat
     group, 2 a beat, 3 the half-beat (simple) or the beat's eighth (compound), 4 … the binary subdivisions below,
     Infinity a position on no binary subdivision (a triplet point). */
  function levelOf(gr, p) {
    const x = p + gr.off;
    if (x === 0 || x === gr.nomU) return LEVEL.BAR;
    if (gr.groups.indexOf(x) >= 0) return LEVEL.GROUP;
    if (gr.beats.indexOf(x) >= 0) return LEVEL.BEAT;
    /* the beat this position is in, and the offset inside it */
    const bi = beatIndex(gr, x);
    const off = x - gr.beats[bi];
    if (off % gr.sub === 0) return LEVEL.HALF;
    let step = gr.sub / 2, lvl = LEVEL.HALF + 1;
    while (step >= 1 && Number.isInteger(step)) {
      if (off % step === 0) return lvl;
      step /= 2; lvl++;
    }
    return Infinity;
  }
  function beatIndex(gr, x) {
    let i = 0;
    while (i + 1 < gr.beats.length && gr.beats[i + 1] <= x) i++;
    return i;
  }
  function beatEnd(gr, x) {
    const i = beatIndex(gr, x);
    return i + 1 < gr.beats.length ? gr.beats[i + 1] : gr.nomU;
  }
  function onBeat(gr, p) { return levelOf(gr, p) <= LEVEL.BEAT; }

  /* The interior boundaries of a span (s, e) at levels up to `upto`, in the full-measure frame. */
  function interior(gr, s, e, level) {
    const x0 = s + gr.off, x1 = e + gr.off;
    const pts = level === LEVEL.GROUP ? gr.groups : gr.beats;
    return pts.filter(b => b > x0 && b < x1);
  }
  /* The highest metric level a span hides (the most important boundary strictly inside it): 1, 2, 3 or 0. */
  function hides(gr, s, e) {
    if (interior(gr, s, e, LEVEL.GROUP).length) return LEVEL.GROUP;
    if (interior(gr, s, e, LEVEL.BEAT).length) return LEVEL.BEAT;
    /* half-beat points strictly inside */
    for (let x = s + 1; x < e; x++) if (levelOf(gr, x) === LEVEL.HALF) return LEVEL.HALF;
    return 0;
  }

  /* The S table (§6.3): patterns that may hide a beat. Returns true when a note value at [s, e) is a standard
     syncopation or long value for its metre, which exempts it from the hides() cost and from H4/H5. */
  function standard(gr, s, e, sym) {
    const len = e - s, x = s + gr.off;
    const beat = gr.compound || gr.additive ? null : gr.beats[1] - gr.beats[0];
    if (gr.compound) {
      /* H4's exception: from a beat to the end of its group (6/8 dotted half, 12/8 dotted half on a group) */
      const gi = gr.groups.filter(b => b <= x).pop();
      const gEnd = gr.groups.find(b => b > x) || gr.nomU;
      if (onBeat(gr, s) && e + gr.off === gEnd && gi !== undefined) return true;
      /* 9/8 is three beats like 3/4: a dotted half on beats 1-2 or 2-3 ("2 4" and "4 2", §6.3) */
      const beat = gr.beats[1] - gr.beats[0];
      return gr.n === 9 && onBeat(gr, s) && len === 2 * beat && (x === 0 || x === beat);
    }
    if (gr.additive) return false;
    const n = gr.n, bt = gr.beatType;
    if (bt === 4 && (n === 2 || n === 4)) {
      /* 8 4 8: a quarter from a half-beat to a half-beat, inside one group */
      if (sym.type === 'quarter' && !sym.dots && levelOf(gr, s) === LEVEL.HALF && len === beat &&
          !interior(gr, s, e, LEVEL.GROUP).length) return true;
      /* dotted quarter + eighth: a dotted quarter from a beat (2/4) */
      if (n === 2 && sym.type === 'quarter' && sym.dots === 1 && x === 0) return true;
    }
    if (bt === 4 && n === 4) {
      if (sym.type === 'half' && !sym.dots && x === beat) return true;                  /* 4 2 4 */
      if (sym.type === 'half' && sym.dots === 1 && (x === 0 || x === beat)) return true; /* 2. 4 and 4 2. (see G03 §24 record) */
      if (sym.type === 'half' && !sym.dots && (x === 0 || x === 2 * beat)) return true;  /* 2 + 2 */
      if (sym.type === 'whole' && x === 0) return true;
    }
    if (bt === 4 && n === 3) {
      if (sym.type === 'half' && !sym.dots && (x === 0 || x === beat)) return true;     /* 4 2, 2 4 */
      if (sym.type === 'half' && sym.dots === 1 && x === 0) return true;                 /* 2. */
    }
    if (bt === 2 && n === 2) {
      if (sym.type === 'half' && !sym.dots && x === beat / 2) return true;              /* 4 2 4 */
      if (sym.type === 'whole' && x === 0) return true;
    }
    return false;
  }

  /* Hard rules for a note value at [s, e) of a measure (H2-H7). kind 'note' or 'rest'. A triplet symbol is judged
     by its own region, not here (§7). */
  function symbolOk(gr, s, e, sym, kind) {
    if (s < 0 || e > gr.durU || e <= s) return false;                        /* H2 */
    if ((sym.dots || 0) > 2) return false;                                    /* H7 */
    const lvS = levelOf(gr, s);
    /* H7: a double dot only where the value fits the beat hierarchy: from a beat, or completing a beat (it ends on the
       next beat line without crossing one) */
    if (sym.dots === 2 && lvS > LEVEL.BEAT && !(levelOf(gr, e) <= LEVEL.BEAT && !interior(gr, s, e, LEVEL.BEAT).length)) return false;
    const len = e - s;
    const measureRest = kind === 'rest' && s === 0 && e === gr.durU;
    if (measureRest) return true;
    const crossesBeat = interior(gr, s, e, LEVEL.BEAT).length > 0;
    const crossesGroup = interior(gr, s, e, LEVEL.GROUP).length > 0;
    if (kind === 'rest') {
      /* H3: a rest does not hide a beat, except the half rests of 4/4 and a compound group's dotted rest */
      if (crossesBeat) {
        if (!gr.compound && !gr.additive && gr.n === 4 && gr.beatType === 4 && sym.type === 'half' && !sym.dots &&
            (s + gr.off === 0 || s + gr.off === gr.nomU / 2)) return true;
        if (gr.compound && standard(gr, s, e, sym)) return true;
        return false;
      }
      /* a rest that does not start on a half-beat does not hide one (16th rest + 8th rest, not a dotted 8th rest) */
      if (lvS > LEVEL.HALF) {
        for (let x = s + 1; x < e; x++) if (levelOf(gr, x) <= LEVEL.HALF) return false;
      }
      return true;
    }
    if (!crossesBeat) return true;
    if (gr.compound || gr.additive) return standard(gr, s, e, sym);           /* H4 */
    if (lvS > LEVEL.BEAT) return standard(gr, s, e, sym);                     /* off the beat, over a beat: S table only */
    if (crossesGroup) return standard(gr, s, e, sym);                         /* H5: over the middle of the bar */
    void len;
    return true;
  }

  /* §6.2 cost of one symbol (without the rest-split term, which belongs to a whole rest). */
  function symbolCost(gr, s, e, sym, tieIn) {
    let c = COST.SYMBOL;
    if (tieIn) c += COST.TIE_IN;
    const dots = sym.dots || 0;
    c += COST.DOT * dots + (dots === 2 ? COST.DOUBLE_DOT : 0);
    if (!sym.tuplet && !standard(gr, s, e, sym)) c += COST.HIDE[hides(gr, s, e)];
    if ((e - s) * 16 < U && !sym.tuplet) c += COST.SHORT;
    if (sym.tuplet && sym.len * 16 < U) c += COST.SHORT;
    return c;
  }

  /* §11.2: the primary beam groups of a measure, as [start, end) integer spans in the measure's own frame. */
  function beamGroups(gr) {
    let bounds;
    if (gr.additive || gr.compound) bounds = gr.beats.slice();
    else if (gr.beatType === 8 && gr.n === 3) bounds = [0];
    else if (gr.beatType === 2) bounds = [];
    else bounds = gr.beats.slice();
    if (gr.beatType === 2 && !gr.compound && !gr.additive) {
      /* 2/2: the beat is a half; eighths beam by the quarter */
      for (let x = 0; x < gr.nomU; x += U / 4) bounds.push(x);
    }
    if (gr.compound && gr.n === 3) bounds = [0];
    const out = [];
    bounds.sort((a, b) => a - b);
    bounds.forEach((b, i) => {
      const s = b - gr.off, e = (i + 1 < bounds.length ? bounds[i + 1] : gr.nomU) - gr.off;
      if (e > 0) out.push([Math.max(0, s), Math.min(gr.durU, e)]);
    });
    return out.filter(x => x[1] > x[0]);
  }

  /* A W rational (string or Rat) as an integer of 1/U, or null when it is not on the grid. */
  function toU(x) {
    const r = typeof x === 'string' ? R.parse(x) : x;
    const v = r.n * U / r.d;
    return Number.isInteger(v) ? v : null;
  }
  function fromU(i) { return R.format(R.make(i, U)); }

  return Object.freeze({ COST, U, LEVEL, BINARY, grid, hierarchy, levelOf, hides, standard, symbolOk, symbolCost,
    beamGroups, onBeat, beatEnd, beatIndex, interior, toU, fromU, isPow2, gcd });
});
