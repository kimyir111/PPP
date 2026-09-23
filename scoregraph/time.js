/* ============================================================================
   PPP ScoreGraph — time (docs/GOALS/G01 §6)

   Three clocks, never mixed in one field:
     notated     Pos {m, at}: a measure ID and a W offset in it (stored)
                 ScorePos: W from the first measure in written order (derived)
     performed   integer µs in the Performance layer (stored)
     playback    visits (m, k) of the repeat-expanded order and PlaybackW (derived)

   Everything here is a pure function of the graph. Notated arithmetic is exact
   (rational.js); seconds are exact rationals too, and rounding happens once, in
   micros(). Lookups are cached per frozen graph.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rational.js'), require('./schema.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.time = factory(M.rational, M.schema); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S) {
  'use strict';

  function fail(code, message) {
    const e = new Error(code + ': ' + message);
    e.code = code;
    return e;
  }
  function rat(x) { return typeof x === 'string' ? R.tryParse(x) : x; }
  function toRat(x, what) {
    if (x && typeof x === 'object' && R.isRat(x)) return x;
    if (typeof x === 'string') return R.parse(x);
    if (Number.isInteger(x)) return R.make(x);
    throw new TypeError(what + ' must be an integer, a Rat or a Rat string');
  }

  /* ------------------------------------------------------------ context */
  const CACHE = new WeakMap();
  /* Measure lookups. Tolerant of an invalid graph (the validator uses it): an unparsable duration counts 0. */
  function ctx(g) {
    const frozen = Object.isFrozen(g);
    if (frozen && CACHE.has(g)) return CACHE.get(g);
    const tl = (g && g.timeline) || {};
    const measures = Array.isArray(tl.measures) ? tl.measures : [];
    const index = new Map(), starts = [], durs = [];
    let acc = R.ZERO;
    measures.forEach((m, i) => {
      if (m && typeof m.id === 'string' && !index.has(m.id)) index.set(m.id, i);
      starts.push(acc);
      const d = m && rat(m.dur);
      durs.push(d && R.sign(d) > 0 ? d : R.ZERO);
      acc = R.add(acc, durs[i]);
    });
    const meters = (Array.isArray(tl.meters) ? tl.meters : []).filter(x => x && index.has(x.m))
      .slice().sort((a, b) => index.get(a.m) - index.get(b.m) || (S.idNumber(a.id) || 0) - (S.idNumber(b.id) || 0));
    const meterAtIdx = [];
    let mi = 0, cur = null;
    for (let i = 0; i < measures.length; i++) {
      while (mi < meters.length && index.get(meters[mi].m) <= i) cur = meters[mi++];
      meterAtIdx.push(cur);
    }
    const c = { g: g, measures: measures, index: index, starts: starts, durs: durs, end: acc, meterAtIdx: meterAtIdx, memo: {} };
    if (frozen) CACHE.set(g, c);
    return c;
  }
  function measureIndex(g, m) {
    const i = ctx(g).index.get(m);
    return i === undefined ? -1 : i;
  }
  function needMeasure(c, m) {
    const i = c.index.get(m);
    if (i === undefined) throw fail('E-REF-MISSING', 'no measure ' + m);
    return i;
  }

  /* ---------------------------------------------------------- positions */
  function measureStart(g, m) { const c = ctx(g); return c.starts[needMeasure(c, m)]; }
  function measureDur(g, m) { const c = ctx(g); return c.durs[needMeasure(c, m)]; }
  function scorePos(g, pos) {
    const c = ctx(g);
    return R.add(c.starts[needMeasure(c, pos.m)], toRat(pos.at, 'at'));
  }
  /* ScorePos -> Pos. A measure boundary belongs to the next measure (at 0); the end of the last measure is
     {m: last, at: its dur}. */
  function posAt(g, w) {
    const c = ctx(g);
    w = toRat(w, 'w');
    const n = c.measures.length;
    if (!n || R.sign(w) < 0 || R.gt(w, c.end)) throw fail('E-POSITION', 'ScorePos ' + R.format(w) + ' is outside the score');
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (R.le(c.starts[mid], w)) lo = mid; else hi = mid - 1;
    }
    /* skip zero-length measures at a boundary; never step past the last */
    while (lo < n - 1 && R.ge(w, R.add(c.starts[lo], c.durs[lo]))) lo++;
    return { m: c.measures[lo].id, at: R.format(R.sub(w, c.starts[lo])) };
  }

  /* ------------------------------------------------------------- metre */
  function nominal(meter) {
    const sum = meter.beats.reduce((s, b) => s + b, 0);
    return R.make(sum, meter.beatType);
  }
  /* Beat groups in W (§6.4): explicit groups; additive metres per summand; compound (n % 3 == 0, n > 3)
     in dotted groups of three; otherwise one per beat. */
  function groups(meter) {
    if (meter.groups && meter.groups.length) return meter.groups.map(x => toRat(x, 'group'));
    if (meter.beats.length > 1) return meter.beats.map(b => R.make(b, meter.beatType));
    const n = meter.beats[0];
    if (n % 3 === 0 && n > 3) return Array.from({ length: n / 3 }, () => R.make(3, meter.beatType));
    return Array.from({ length: n }, () => R.make(1, meter.beatType));
  }
  function meterAt(g, m) { const c = ctx(g); return c.meterAtIdx[needMeasure(c, m)] || null; }
  /* The beat a position falls on: {beat (0-based), offset}. A short first measure (a pickup) is counted
     back from its bar line (App PianoScore.beats). */
  function metric(g, pos) {
    const c = ctx(g);
    const i = needMeasure(c, pos.m);
    const meter = c.meterAtIdx[i];
    if (!meter) throw fail('E-METER', 'no time signature in force at ' + pos.m);
    const nom = nominal(meter), gr = groups(meter);
    let at = toRat(pos.at, 'at');
    if (i === 0 && R.lt(c.durs[0], nom)) at = R.add(at, R.sub(nom, c.durs[0]));
    let acc = R.ZERO;
    for (let beat = 0; ; beat++) {
      const size = gr[Math.min(beat, gr.length - 1)];
      if (R.lt(at, R.add(acc, size))) return { beat: beat, offset: R.format(R.sub(at, acc)) };
      acc = R.add(acc, size);
    }
  }

  /* ------------------------------------------------------ keys and clefs */
  function keyScopeRank(k, part, staff) {
    if (!k.scope) return 0;
    if (k.scope.part !== part) return -1;
    if (!k.scope.staff) return 1;
    return k.scope.staff === staff ? 2 : -1;
  }
  /* The key signature in force at a position for a part's staff: the latest applicable key at or before it;
     at one position a staff key beats a part key beats a global one (§6.8). */
  function keyAt(g, pos, part, staff) {
    const c = ctx(g);
    const w = scorePos(g, pos);
    let best = null, bestW = null, bestRank = -1;
    (g.timeline.keys || []).forEach(k => {
      const rank = keyScopeRank(k, part, staff);
      if (rank < 0 || !c.index.has(k.m)) return;
      const kw = scorePos(g, k);
      if (R.gt(kw, w)) return;
      const cmp = bestW === null ? 1 : R.cmp(kw, bestW);
      if (cmp > 0 || (cmp === 0 && (rank > bestRank || (rank === bestRank && S.idNumber(k.id) > S.idNumber(best.id))))) {
        best = k; bestW = kw; bestRank = rank;
      }
    });
    return best;
  }
  function clefAt(g, partId, staff, pos) {
    const part = g.parts.find(p => p.id === partId);
    if (!part) throw fail('E-REF-MISSING', 'no part ' + partId);
    const w = scorePos(g, pos);
    let best = null, bestW = null;
    part.clefs.forEach(cl => {
      if (cl.staff !== staff) return;
      const cw = scorePos(g, cl);
      if (R.gt(cw, w)) return;
      if (bestW === null || R.gt(cw, bestW) || (R.eq(cw, bestW) && S.idNumber(cl.id) > S.idNumber(best.id))) { best = cl; bestW = cw; }
    });
    return best;
  }

  /* ------------------------------------------------------------ playback */
  /* Each measure's repeat and ending marks as the app reads bar lines (Score.form, G0 app_play_order). */
  function barMarks(g, c) {
    const marks = c.measures.map(m => {
      const bl = (m && m.barline) || {};
      const out = {};
      if ((bl.left && bl.left.repeat === 'forward') || (bl.right && bl.right.repeat === 'forward')) out.repeatStart = true;
      const back = (bl.right && bl.right.repeat === 'backward') ? bl.right : (bl.left && bl.left.repeat === 'backward') ? bl.left : null;
      if (back) out.repeatEnd = Number.isInteger(back.times) && back.times > 0 ? back.times : 2;
      return out;
    });
    const endings = ((g.timeline && g.timeline.endings) || []).slice()
      .sort((a, b) => (S.idNumber(a.id) || 0) - (S.idNumber(b.id) || 0));
    endings.forEach(en => {
      const fi = c.index.get(en.from), ti = c.index.get(en.to);
      if (fi === undefined || ti === undefined) return;
      if (!marks[fi].endingNos) marks[fi].endingNos = en.numbers;
      marks[ti].endingEnd = true;
    });
    return marks;
  }
  /* The repeat-expanded play order (§6.7): Visit {m, k (the k-th time m is played), pass, start (PlaybackW)}.
     The app's rule, quirks included: a backward repeat with no forward repeat of its own goes back to the last
     forward repeat still open, else to the first measure; nested repeats start over; an ending is skipped
     when the current pass is not among its numbers. Jumps (D.C., D.S., Coda) are not followed in G1. */
  function unroll(g) {
    const c = ctx(g);
    if (c.memo.unroll) return c.memo.unroll;
    const n = c.measures.length;
    const marks = barMarks(g, c);
    const visits = [], stack = [], taken = new Map(), passAt = new Map(), count = new Map();
    let openEnding = null, i = 0, guard = 0, w = R.ZERO;
    const limit = n * 64;
    while (i >= 0 && i < n) {
      if (++guard > limit) throw fail('E-UNROLL-RUNAWAY', 'the play order exceeds ' + limit + ' measure visits');
      const bar = marks[i];
      if (bar.repeatStart) stack.push(i);
      if (bar.endingNos) openEnding = bar.endingNos;
      const now = passAt.get(stack.length ? stack[stack.length - 1] : 0) || 1;
      const skip = !!openEnding && openEnding.indexOf(now) < 0;
      if (!skip) {
        const k = (count.get(i) || 0) + 1;
        count.set(i, k);
        visits.push({ m: c.measures[i].id, k: k, pass: now, start: w });
        w = R.add(w, c.durs[i]);
      }
      if (bar.endingEnd) openEnding = null;
      if (!skip && bar.repeatEnd) {
        taken.set(i, (taken.get(i) || 0) + 1);
        if (taken.get(i) < bar.repeatEnd) {
          const start = stack.length ? stack[stack.length - 1] : 0;
          Array.from(taken.keys()).forEach(k => { if (start < k && k < i) taken.delete(k); });
          Array.from(passAt.keys()).forEach(k => { if (k > start) passAt.delete(k); });
          passAt.set(start, (passAt.get(start) || 1) + 1);
          i = start;
          continue;
        }
        if (stack.length) stack.pop();
      }
      i++;
    }
    if (Object.isFrozen(g)) c.memo.unroll = visits;
    return visits;
  }
  function visitOf(g, m, k) {
    const v = unroll(g).find(x => x.m === m && x.k === k);
    if (!v) throw fail('E-REF-MISSING', 'measure ' + m + ' is not played a ' + k + '. time');
    return v;
  }
  /* Every playback position of a notated position: a measure inside a repeat is played more than once. */
  function playback(g, pos) {
    const c = ctx(g);
    needMeasure(c, pos.m);
    return unroll(g).filter(v => v.m === pos.m).map(v => ({ m: v.m, k: v.k, at: typeof pos.at === 'string' ? pos.at : R.format(pos.at) }));
  }
  function playbackW(g, pp) { return R.add(visitOf(g, pp.m, pp.k).start, toRat(pp.at, 'at')); }
  function playbackPosAt(g, w) {
    const visits = unroll(g);
    const c = ctx(g);
    w = toRat(w, 'w');
    let lo = 0, hi = visits.length - 1;
    if (hi < 0) throw fail('E-POSITION', 'the score is never played');
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (R.le(visits[mid].start, w)) lo = mid; else hi = mid - 1;
    }
    const v = visits[lo];
    const at = R.sub(w, v.start);
    const dur = c.durs[c.index.get(v.m)];
    if (R.sign(at) < 0 || (R.gt(at, dur) && lo === visits.length - 1)) throw fail('E-POSITION', 'PlaybackW outside the play order');
    return { m: v.m, k: v.k, at: R.format(at) };
  }

  /* ---------------------------------------------------------------- tempo */
  function qpmOf(x) {
    const q = toRat(x, 'defaultQpm');
    if (R.sign(q) <= 0) throw new RangeError('defaultQpm must be positive');
    return q;
  }
  /* [{start (PlaybackW), qpm (Rat)}]: what plays from each point on (§6.6). The tempo before the first
     TempoEvent is the caller's defaultQpm (required: no hidden default). */
  function tempoMap(g, opts) {
    if (!opts || opts.defaultQpm == null) throw new TypeError('tempoMap needs {defaultQpm}');
    const def = qpmOf(opts.defaultQpm);
    const byMeasure = new Map();
    ((g.timeline && g.timeline.tempos) || []).forEach(t => {
      if (t.qpm === undefined) return;
      if (!byMeasure.has(t.m)) byMeasure.set(t.m, []);
      byMeasure.get(t.m).push(t);
    });
    byMeasure.forEach(list => list.sort((a, b) => R.cmp(toRat(a.at), toRat(b.at)) || S.idNumber(a.id) - S.idNumber(b.id)));
    const out = [{ start: R.ZERO, qpm: def }];
    unroll(g).forEach(v => {
      (byMeasure.get(v.m) || []).forEach(t => {
        const start = R.add(v.start, toRat(t.at));
        const q = toRat(t.qpm);
        const last = out[out.length - 1];
        if (R.eq(last.start, start)) last.qpm = q;
        else if (!R.eq(last.qpm, q)) out.push({ start: start, qpm: q });
      });
    });
    return out;
  }
  /* Exact seconds of a PlaybackW when the score is played as written: Σ Δw × 4 × 60 / qpm. */
  function seconds(g, w, opts) {
    w = toRat(w, 'w');
    const map = tempoMap(g, opts);
    let s = R.ZERO;
    for (let i = 0; i < map.length; i++) {
      const a = map[i].start;
      if (R.ge(a, w)) break;
      const b = i + 1 < map.length && R.lt(map[i + 1].start, w) ? map[i + 1].start : w;
      s = R.add(s, R.div(R.mul(R.sub(b, a), R.make(240)), map[i].qpm));
    }
    return s;
  }
  function secondsAt(g, pp, opts) { return seconds(g, playbackW(g, pp), opts); }
  function micros(sec) { return R.micros(toRat(sec, 'seconds')); }

  /* ------------------------------------------------------- performance time */
  function floorDivBig(n, d) { const q = n / d; return (n % d !== 0n && (n < 0n) !== (d < 0n)) ? q - 1n : q; }
  /* Round a rational µs value half up (also below zero, where extrapolation can land). */
  function roundUs(r) {
    const n = BigInt(r.n), d = BigInt(r.d);
    return Number(floorDivBig(2n * n + d, 2n * d));
  }
  /* PlaybackPos <-> µs for one performance (§6.9): anchors in play order, linear between them, extrapolated
     with the neighbouring slope; one anchor takes the tempo map's slope; none, the tempo map from 0. */
  function perfTimeMap(g, perfId, opts) {
    const perf = (g.performances || []).find(p => p.id === perfId);
    if (!perf) throw fail('E-REF-MISSING', 'no performance ' + perfId);
    const pts = (perf.anchors || []).map(a => ({ w: playbackW(g, a), us: R.make(a.us) }))
      .sort((a, b) => R.cmp(a.w, b.w));
    const secs = w => seconds(g, w, opts);
    const million = R.make(1000000);
    function wToUs(w) {
      if (pts.length === 0) return R.mul(secs(w), million);
      if (pts.length === 1) return R.add(pts[0].us, R.mul(R.sub(secs(w), secs(pts[0].w)), million));
      let i = 0;
      while (i < pts.length - 2 && R.ge(w, pts[i + 1].w)) i++;
      const a = pts[i], b = pts[i + 1];
      return R.add(a.us, R.div(R.mul(R.sub(w, a.w), R.sub(b.us, a.us)), R.sub(b.w, a.w)));
    }
    function usToW(us) {
      us = R.make(us);
      if (pts.length >= 2) {
        let i = 0;
        while (i < pts.length - 2 && R.ge(us, pts[i + 1].us)) i++;
        const a = pts[i], b = pts[i + 1];
        return R.add(a.w, R.div(R.mul(R.sub(us, a.us), R.sub(b.w, a.w)), R.sub(b.us, a.us)));
      }
      /* invert seconds() through the tempo map */
      const base = pts.length === 1 ? R.sub(secs(pts[0].w), R.div(pts[0].us, million)) : R.ZERO;
      const target = R.add(R.div(us, million), base);
      const map = tempoMap(g, opts);
      let s = R.ZERO;
      for (let i = 0; i < map.length; i++) {
        const next = i + 1 < map.length ? map[i + 1].start : null;
        const segS = next ? R.div(R.mul(R.sub(next, map[i].start), R.make(240)), map[i].qpm) : null;
        if (!next || R.le(target, R.add(s, segS))) return R.add(map[i].start, R.div(R.mul(R.sub(target, s), map[i].qpm), R.make(240)));
        s = R.add(s, segS);
      }
      return R.ZERO;
    }
    return {
      toUs: pp => roundUs(wToUs(playbackW(g, pp))),
      fromUs: us => playbackPosAt(g, usToW(us)),
      wToUs: w => roundUs(wToUs(toRat(w, 'w')))
    };
  }

  /* ------------------------------------------------------------ spans (§10) */
  function eventOrderKey(g, part, e) {
    const vi = part.voices.findIndex(v => v.id === e.voice);
    return [scorePos(g, e), vi, e.grace ? 0 : 1, e.grace ? e.grace.order : 0, S.idNumber(e.id)];
  }
  function cmpKey(a, b) {
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      const c = (typeof x === 'object') ? R.cmp(x, y) : (x < y ? -1 : x > y ? 1 : 0);
      if (c) return c;
    }
    return 0;
  }
  /* The events that start inside a ScoreSpan, in a fixed order (part, position, voice, grace order, ID). */
  function resolveSpan(g, span) {
    const c = ctx(g);
    needMeasure(c, span.from.m); needMeasure(c, span.to.m);
    const a = scorePos(g, span.from), b = scorePos(g, span.to);
    if (span.part && !g.parts.some(p => p.id === span.part)) throw fail('E-REF-MISSING', 'no part ' + span.part);
    const out = [];
    g.parts.forEach((part, pi) => {
      if (span.part && part.id !== span.part) return;
      (span.voices || []).forEach(v => {
        if (!part.voices.some(x => x.id === v) && span.part) throw fail('E-REF-MISSING', 'no voice ' + v + ' in ' + part.id);
      });
      part.events.forEach(e => {
        if (span.voices && span.voices.indexOf(e.voice) < 0) return;
        const w = scorePos(g, e);
        if (R.ge(w, a) && R.lt(w, b)) out.push({ e: e, key: [pi].concat(eventOrderKey(g, part, e)) });
      });
    });
    return out.sort((x, y) => cmpKey(x.key, y.key)).map(x => x.e);
  }
  /* The smallest ScoreSpan covering events and heads (a head counts as its event). */
  function spanOf(g, ids) {
    const want = new Set(ids);
    const found = [];
    g.parts.forEach((part, pi) => part.events.forEach(e => {
      if (want.has(e.id) || (e.heads || []).some(h => want.has(h.id))) found.push({ e: e, part: part, pi: pi });
    }));
    const seen = new Set();
    found.forEach(x => { seen.add(x.e.id); (x.e.heads || []).forEach(h => seen.add(h.id)); });
    const missing = ids.filter(id => !seen.has(id));
    if (missing.length) throw fail('E-REF-MISSING', 'no event or head ' + missing[0]);
    if (!found.length) throw fail('E-REF-MISSING', 'no events');
    let lo = null, hi = null;
    found.forEach(x => {
      const s = scorePos(g, x.e), e = R.add(s, toRat(x.e.dur));
      if (lo === null || R.lt(s, lo)) lo = s;
      if (hi === null || R.gt(e, hi)) hi = e;
    });
    const out = {};
    const parts = Array.from(new Set(found.map(x => x.part.id)));
    if (parts.length === 1) {
      const part = found[0].part;
      const vs = new Set(found.map(x => x.e.voice));
      out.part = part.id;
      out.voices = part.voices.map(v => v.id).filter(v => vs.has(v));
    }
    out.from = posAt(g, lo);
    out.to = posAt(g, hi);
    return out;
  }

  return Object.freeze({
    ctx, measureIndex, measureStart, measureDur, scorePos, posAt, nominal, groups, meterAt, metric, keyAt, clefAt,
    barMarks, unroll, playback, playbackW, playbackPosAt, tempoMap, seconds, secondsAt, micros, perfTimeMap,
    resolveSpan, spanOf, roundUs
  });
});
