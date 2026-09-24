/* ============================================================================
   PPP ScoreGraph — G3 passes P4 R-repr and P4b R-reg (docs/GOALS/G03 §6)

   R-repr rewrites how a voice-measure writes its rhythm and nothing else:
   every onset, every tie-merged notated length and every stretch of rest
   stays exactly where it was (I2, I8, I9); only the pieces, their printed
   values, the ties between them and the triplet ratios they carry change.

   A voice-measure is cut into segments (a note and the pieces tied to it; a
   run of rests) and into regions: each beat is binary, triplet (every
   boundary in it on the 3:2 grid, down to the triplet 32nd), or frozen (a
   boundary on neither: a one-tick rest, R17). Two triplet beats of a half
   bar become one triplet half when a note crosses between them (unit
   quarter, T05). A segment that touches a frozen region keeps its pieces
   (N-RHYTHM-UNREPRESENTABLE, H8); every other segment is written with the
   cheapest sequence of values the metric grid allows (meter-grid.js: H2-H7,
   the S table, the §6.2 cost), found by a small DP. An existing writing that
   costs no more than the best is kept (§16.2: "keep what is there" is the
   first tie-break), so a second run changes nothing.

   R-reg (G3b) is below: off unless opts.g3b (D1).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./pitch.js'), require('./ops.js'), require('./meter-grid.js'), require('./time.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proRhythm = factory(M.rational, M.schema, M.pitch, M.ops, M.meterGrid, M.time); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, P, O, MG, T) {
  'use strict';

  const U = MG.U;
  const BIN_STEP = U / 64;          /* the binary grid: a 64th */
  const TRI_STEP = U / 48;          /* the triplet grid: a triplet 32nd */
  const Q = U / 4;
  const C = MG.COST;
  const TYPE_ORDER = S.NOTE_TYPES;
  /* triplet symbols: a binary value with at most one dot, lasting 2/3 of it */
  const TRIPLET = MG.BINARY.filter(b => b.dots <= 1 && (b.len * 2) % 3 === 0).map(b => ({ type: b.type, dots: b.dots, len: b.len * 2 / 3, tuplet: true }));

  const toU = x => MG.toU(x);
  const midiOf = h => (h.pitch ? P.midi(h.pitch) : h.inst);

  /* ------------------------------------------------------------ segments */
  /* The voice-measure's segments, or null when G3 may not or cannot rewrite it. */
  function segments(part, evs, tieOut, tieIn, evOfHead) {
    const out = [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.hidden || e.cue || e.orn || e.lyrics || (e.arts && e.arts.length) || e.fermata) return null;
      const s = toU(e.at), en = toU(R.format(R.add(R.parse(e.at), R.parse(e.dur))));
      if (s === null || en === null) return 'off-grid';
      const last = out[out.length - 1];
      if (e.kind === 'rest') {
        if (last && last.kind === 'rest' && last.e === s) { last.e = en; last.events.push(e); continue; }
        out.push({ kind: 'rest', s: s, e: en, events: [e] });
        continue;
      }
      if (e.kind !== 'note') return null;
      /* a continuation: every head of the previous note tied to a head of this one, the same pitches, nothing else */
      if (last && last.kind === 'note' && last.e === s && chained(last.events[last.events.length - 1], e, tieOut, tieIn, evOfHead)) {
        last.e = en; last.events.push(e); continue;
      }
      out.push({ kind: 'note', s: s, e: en, events: [e] });
    }
    return out;
  }
  function chained(a, b, tieOut, tieIn, evOfHead) {
    if (a.heads.length !== b.heads.length) return false;
    const want = new Map(b.heads.map(h => [h.id, h]));
    for (const h of a.heads) {
      const to = tieOut.get(h.id);
      if (to === undefined || !want.has(to) || midiOf(want.get(to)) !== midiOf(h)) return false;
      want.delete(to);
    }
    void tieIn; void evOfHead;
    return want.size === 0;
  }

  /* ------------------------------------------------------------ regions */
  /* The measure's regions in its own frame: [{s, e, kind: 'binary'|'triplet'|'frozen', unit?}], covering [0, dur). */
  function regions(gr, points) {
    const off = gr.off, dur = gr.durU;
    const pts = Array.from(points).filter(p => p > 0 && p < dur).sort((a, b) => a - b);
    const inside = (a, b) => pts.filter(p => p > a && p < b);
    const binary = xs => xs.every(p => (p + off) % BIN_STEP === 0);
    const triplet = (xs, a) => xs.every(p => (p - a) % TRI_STEP === 0);
    const simple = !gr.compound && !gr.additive && (gr.beatType === 4 || gr.beatType === 2);
    const out = [];
    const push = (a, b, kind, unit) => { a = Math.max(0, a); b = Math.min(dur, b); if (b > a) out.push({ s: a, e: b, kind: kind, unit: unit }); };
    if (!simple) {
      /* compound and additive metres: a beat is binary; or, in eighths (x/8), each eighth of it binary or a 16th
         triplet (§7.3: a span starts only where the hierarchy has a point; no 3:2 across a dotted beat); else frozen */
      const bounds = gr.beats.map(x => x - off).concat([gr.nomU - off]);
      for (let i = 0; i + 1 < bounds.length; i++) {
        const a = bounds[i], b = bounds[i + 1];
        if (binary(inside(Math.max(0, a), Math.min(dur, b)))) { push(a, b, 'binary'); continue; }
        if (gr.sub !== U / 8 || (b - a) % gr.sub !== 0) { push(a, b, 'frozen'); continue; }
        const first = out.length;
        for (let p = a; p < b; p += gr.sub) {
          const q = p + gr.sub, ys = inside(Math.max(0, p), Math.min(dur, q));
          if (binary(ys)) push(p, q, 'binary');
          else if (p >= 0 && q <= dur && triplet(ys, p)) push(p, q, 'triplet', '16th');
          else push(p, q, 'frozen');
        }
        /* two eighths of one beat that a note crosses, every point on the triplet-eighth grid of the pair: one 3:2 of
           eighths over them (a triplet eighth over the middle is one value, not two tied triplet 16ths) */
        for (let k = first; k + 1 < out.length; k++) {
          const x = out[k], y = out[k + 1];
          if (x.kind === 'triplet' && y.kind === 'triplet' && x.unit === '16th' && y.unit === '16th' && x.e === y.s && pts.indexOf(x.e) < 0 &&
              inside(x.s, y.e).every(p => (p - x.s) % (2 * gr.sub / 3) === 0)) out.splice(k, 2, { s: x.s, e: y.e, kind: 'triplet', unit: 'eighth' });
        }
      }
      return merge(out);
    }
    for (let x = -off; x < dur; x += Q) {
      const a = x, b = x + Q, xs = inside(Math.max(0, a), Math.min(dur, b));
      if (binary(xs)) { push(a, b, 'binary'); continue; }
      /* a half with no triplet point in it stays binary, the other half a 16th triplet (an eighth then three triplet
         16ths, not a triplet dotted eighth under a bracket over the beat) */
      const mid = x + Q / 2;
      const firstPlain = binary(inside(Math.max(0, a), mid)), secondPlain = binary(inside(mid, Math.min(dur, b)));
      if (a >= 0 && b <= dur && triplet(xs, a) && !(xs.indexOf(mid) >= 0 && (firstPlain || secondPlain))) { push(a, b, 'triplet', 'eighth'); continue; }
      /* two halves, each binary or a 16th triplet */
      const h = x + Q / 2;
      [[a, h], [h, b]].forEach(([p, q]) => {
        const ys = inside(Math.max(0, p), Math.min(dur, q));
        if (binary(ys)) push(p, q, 'binary');
        else if (p >= 0 && q <= dur && triplet(ys, p)) push(p, q, 'triplet', '16th');
        else push(p, q, 'frozen');
      });
    }
    /* a note crossing between two triplet beats of one half bar, where every boundary is on the triplet-quarter grid:
       the half is one triplet (unit quarter, T05). With triplet eighths inside, the beats stay two triplets and the
       crossing note is tied at the beat (a half bracket over eighths is what the app's renderer splits, §7.4 T10) */
    const halves = [];
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      if (a.kind === 'triplet' && b.kind === 'triplet' && a.unit === 'eighth' && b.unit === 'eighth' && (a.s + off) % (2 * Q) === 0 &&
          pts.indexOf(a.e) < 0 && inside(a.s, b.e).every(p => (p - a.s) % (2 * Q / 3) === 0)) { halves.push(i); i++; }
    }
    halves.reverse().forEach(i => { out.splice(i, 2, { s: out[i].s, e: out[i + 1].e, kind: 'triplet', unit: 'quarter' }); });
    return merge(out);
  }
  /* adjacent binary regions are one stretch (the DP sees the beats through the grid) */
  function merge(list) {
    const out = [];
    list.forEach(r => {
      const last = out[out.length - 1];
      if (last && last.kind === 'binary' && r.kind === 'binary' && last.e === r.s) last.e = r.e;
      else out.push(Object.assign({}, r));
    });
    return out;
  }

  /* ------------------------------------------------------------ the DP */
  /* The cheapest writing of [s, e) (one stretch of one region kind), pieces after the first tied (notes) or not.
     Returns {cost, syms: [{s, e, type, dots, tuplet}]} or null when nothing fits. */
  /* write() depends on the grid only through its metre and pickup: its answers are kept per grid signature (a score
     repeats the same stretches measure after measure) */
  const SIGS = new WeakMap(), WRITES = new Map();
  const sigOf = gr => {
    if (!SIGS.has(gr)) SIGS.set(gr, JSON.stringify([gr.n, gr.beatType, gr.compound, gr.additive, gr.sub, gr.beats, gr.groups, gr.nomU, gr.durU, gr.off]));
    return SIGS.get(gr);
  };
  function write(gr, reg, s, e, kind, firstTied) {
    const key = sigOf(gr) + '|' + reg.kind + '|' + reg.s + '|' + reg.e + '|' + s + '|' + e + '|' + kind + '|' + !!firstTied;
    if (!WRITES.has(key)) {
      if (WRITES.size > 100000) WRITES.clear();
      WRITES.set(key, writeFresh(gr, reg, s, e, kind, firstTied));
    }
    const w = WRITES.get(key);
    return w && { cost: w.cost, syms: w.syms.map(x => Object.assign({}, x)) };
  }
  function writeFresh(gr, reg, s, e, kind, firstTied) {
    const step = reg.kind === 'triplet' ? TRI_STEP : BIN_STEP;
    /* inside a triplet region every value is shorter than the region (a value filling it would be binary) */
    const syms = reg.kind === 'triplet' ? TRIPLET.filter(t => t.len < reg.e - reg.s) : MG.BINARY;
    const n = e - s;
    if (n <= 0 || n % 1 !== 0) return null;
    /* best[x]: {cost, count, key, prev, sym} for covering [s, s + x) */
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, count: 0, key: '', prev: -1, sym: null };
    for (let x = 0; x < n; x++) {
      const cur = best[x];
      if (!cur) continue;
      const at = s + x;
      if (reg.kind === 'triplet' ? (at - reg.s) % step !== 0 : (at + gr.off) % step !== 0) continue;
      for (const sym of syms) {
        const y = x + sym.len;
        if (y > n) continue;
        const a = at, b = at + sym.len;
        if (reg.kind === 'binary' && !MG.symbolOk(gr, a, b, sym, kind)) continue;
        if (reg.kind === 'triplet' && (b > reg.e || a < reg.s)) continue;
        const tieIn = kind === 'note' && (x > 0 || firstTied);
        const c = cur.cost + MG.symbolCost(gr, a, b, sym, tieIn);
        const cand = { cost: c, count: cur.count + 1, key: cur.key + String(999 - sym.len).padStart(3, '0') + String(TYPE_ORDER.indexOf(sym.type)).padStart(2, '0'),
          prev: x, sym: sym };
        const old = best[y];
        if (!old || cand.cost < old.cost || (cand.cost === old.cost && (cand.count < old.count || (cand.count === old.count && cand.key < old.key)))) best[y] = cand;
      }
    }
    if (!best[n]) return null;
    const out = [];
    for (let y = n; y > 0; y = best[y].prev) out.unshift({ s: s + best[y].prev, e: s + y, type: best[y].sym.type, dots: best[y].sym.dots, tuplet: !!best[y].sym.tuplet });
    return { cost: best[n].cost, syms: out };
  }

  /* The cheapest writing of a whole segment across the regions it crosses; null when a region is frozen or nothing fits. */
  function writeSegment(gr, regs, seg) {
    const parts = [];
    let cost = 0;
    for (const r of regs) {
      const a = Math.max(r.s, seg.s), b = Math.min(r.e, seg.e);
      if (b <= a) continue;
      if (r.kind === 'frozen') return null;
      const w = write(gr, r, a, b, seg.kind, seg.kind === 'note' && a > seg.s);
      if (!w) return null;
      cost += w.cost;
      w.syms.forEach(x => { x.unit = r.kind === 'triplet' ? r.unit : null; parts.push(x); });
    }
    if (seg.kind === 'rest' && parts.length > 1 && MG.levelOf(gr, seg.s) > MG.LEVEL.BEAT) cost += C.REST_SPLIT_OFF_BEAT;
    return { cost: cost, syms: parts };
  }

  /* The segment as it is written now: {cost, broken}. broken is 'shape' when a piece's printed value is not its
     length, it has none, or it sits across a region or in a frozen one (it must be rewritten); 'rule' when every
     piece is a right value in the right region but a note hides a beat the grid rules keep visible (H4, H5, the S
     table); null when it is a writing the grid allows. cost is the §6.2 cost (Infinity for 'shape'). */
  function currentCost(gr, regs, seg) {
    let cost = 0, broken = null;
    const regOf = (a, b) => regs.find(r => r.s <= a && b <= r.e);
    for (let i = 0; i < seg.events.length; i++) {
      const e = seg.events[i];
      const d = e.display;
      if (!d || !d.type) return { cost: Infinity, broken: 'shape' };
      const a = toU(e.at), b = toU(R.format(R.add(R.parse(e.at), R.parse(e.dur))));
      const r = regOf(a, b);
      if (!r || r.kind === 'frozen') return { cost: Infinity, broken: 'shape' };
      const v = S.noteValue(d.type, d.dots);
      const len = b - a;
      const vU = v.n * U / v.d;
      if (d.dots > 2) return { cost: Infinity, broken: 'shape' };
      let sym;
      if (r.kind === 'binary') {
        if (vU !== len) return { cost: Infinity, broken: 'shape' };
        sym = { type: d.type, dots: d.dots || 0 };
        if (!(seg.kind === 'rest' && d.measureRest && a === 0 && b === gr.durU) && !MG.symbolOk(gr, a, b, sym, seg.kind)) {
          if (seg.kind === 'rest') return { cost: Infinity, broken: 'shape' };
          broken = 'rule';
        }
      } else {
        if (vU * 2 !== len * 3 || (d.dots || 0) > 1) return { cost: Infinity, broken: 'shape' };
        sym = { type: d.type, dots: d.dots || 0, tuplet: true, len: len };
      }
      cost += MG.symbolCost(gr, a, b, sym, seg.kind === 'note' && i > 0);
    }
    if (seg.kind === 'rest' && seg.events.length > 1 && MG.levelOf(gr, seg.s) > MG.LEVEL.BEAT) cost += C.REST_SPLIT_OFF_BEAT;
    return { cost: cost, broken: broken };
  }

  /* Rewrite the segment? A wrong shape always; a writing the grid allows when the best one costs less; a note that
     hides a beat only when the best writing has no more pieces than it: G3a never splits a value the writer chose
     into more tied pieces just to show a beat (§24 record: doing so raised G0 notation.ties.extra_per_100 past its
     gate; the beat rules still govern every writing G3 makes itself). */
  function rewrite(now, w, seg) {
    if (now.broken === 'shape') return true;
    if (now.broken === 'rule') return w.syms.length <= seg.events.length;
    return w.cost < now.cost;
  }

  /* The same writing as the events already have? */
  function sameWriting(seg, syms) {
    if (seg.events.length !== syms.length) return false;
    return seg.events.every((e, i) => {
      const d = e.display || {};
      return toU(e.at) === syms[i].s && d.type === syms[i].type && (d.dots || 0) === syms[i].dots;
    });
  }

  /* ------------------------------------------------------------ the pass */
  const rhythm = Object.freeze({
    name: 'rhythm',
    may: ['pieces', 'tuplets', 'beams', 'acc'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        const batch = [];
        g.parts.forEach(part => {
          const tieOut = new Map(), tieIn = new Map(), evOfHead = new Map();
          part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
          part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { tieOut.set(s.from, s.to); tieIn.set(s.to, s.from); } });
          const tupsOf = new Map();
          part.spanners.forEach(s => { if (s.type === 'tuplet') s.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(s); }); });
          const vms = new Map();
          part.events.forEach(e => {
            if (e.grace) return;
            const k = e.voice + '|' + e.m;
            if (!vms.has(k)) vms.set(k, { voice: e.voice, m: e.m, evs: [] });
            vms.get(k).evs.push(e);
          });
          vms.forEach(vm => {
            if (ctx.skip.has(vm.m)) return;
            vm.evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
            if (ctx.perm.events(part, vm.evs, 'rhythm') !== 'rewrite') return;
            const gr = ctx.grid(g, vm.m);
            if (!gr) return;
            const inside = new Set(vm.evs.map(e => e.id));
            /* tuplets other than a plain 3:2 inside the voice-measure: leave it (§7.2 nested, other ratios) */
            let odd = false;
            vm.evs.forEach(e => (tupsOf.get(e.id) || []).forEach(s => {
              if (s.actual !== 3 || s.normal !== 2 || s.parent !== undefined || s.events.some(id => !inside.has(id))) odd = true;
            }));
            if (odd) return;
            const segs = segments(part, vm.evs, tieOut, tieIn, evOfHead);
            if (segs === 'off-grid') {
              ctx.issue('N-RHYTHM-UNREPRESENTABLE', 'voice ' + vm.voice + ' has a length on no grid G3 writes (a septuplet piece, say): kept as written', { m: vm.m, voice: vm.voice });
              return;
            }
            if (!segs) return;
            /* a tie between two events of the voice-measure that are not one segment (a partial chord tie): leave it */
            const segOf = new Map();
            segs.forEach((sg, i) => sg.events.forEach(e => segOf.set(e.id, i)));
            let partial = false;
            vm.evs.forEach(e => (e.heads || []).forEach(h => {
              const to = tieOut.get(h.id);
              if (to === undefined) return;
              const x = evOfHead.get(to);
              if (x && inside.has(x.id) && segOf.get(x.id) !== segOf.get(e.id)) partial = true;
            }));
            if (partial) return;
            const points = new Set();
            segs.forEach(sg => { points.add(sg.s); points.add(sg.e); });
            const regs = regions(gr, points);
            const frozen = regs.filter(r => r.kind === 'frozen');
            /* a segment no writing fits (it reaches a frozen region) keeps its pieces; a triplet region it reaches can then
               never be one whole tuplet, so every other segment reaching that region keeps its pieces too, and so on (G03
               §28 M2: writing them anew left triplet pieces no tuplet could hold, a new W-DISPLAY-DURATION the critic
               rolled back, or one it missed) */
            const writes = segs.map(sg => writeSegment(gr, regs, sg));
            const kept = new Set();
            segs.forEach((sg, i) => { if (!writes[i]) kept.add(i); });
            const overlaps = (sg, r) => sg.s < r.e && sg.e > r.s;
            for (let grew = kept.size > 0; grew;) {
              grew = false;
              const blocked = regs.filter(r => r.kind === 'triplet' && Array.from(kept).some(i => overlaps(segs[i], r)));
              segs.forEach((sg, i) => { if (!kept.has(i) && blocked.some(r => overlaps(sg, r))) { kept.add(i); grew = true; } });
            }
            const plan = [];
            let changed = false, stuck = 0;
            segs.forEach((sg, i) => {
              const keep = () => sg.events.forEach(e => plan.push(d.keepPlan(d.event(e.id))));
              const w = writes[i];
              if (kept.has(i)) { stuck++; keep(); return; }
              const now = currentCost(gr, regs, sg);
              if (sameWriting(sg, w.syms) || !rewrite(now, w, sg)) { keep(); return; }
              changed = true;
              writePlan(d, plan, sg, w.syms, gr, tieOut);
            });
            if (frozen.length || stuck) ctx.issue('N-RHYTHM-UNREPRESENTABLE', stuck + ' segment(s) of voice ' + vm.voice + ' kept as written: a boundary is on no binary or triplet grid', { m: vm.m, voice: vm.voice });
            if (!changed) return;
            batch.push({ voice: vm.voice, m: vm.m, plan: plan });
          });
        });
        /* every rewritten voice-measure in one sweep (ops retimeBatch) */
        const out = d.retimeBatch(batch);
        batch.forEach((it, k) => {
          out[k].forEach((id, i) => { if (it.plan[i].g3) d.markProv(d.event(id), ['rhythm', 'display']); });
          changes.push({ pass: 'rhythm', kind: 'retime', ids: out[k], m: it.m });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  /* The plan pieces of one rewritten segment: event IDs reused front to back (the first piece keeps the first
     event and its heads, which the performance links to), heads matched by pitch. */
  function writePlan(d, plan, sg, syms, gr, tieOut) {
    const olds = sg.events.map(e => d.event(e.id));
    const full = sg.kind === 'rest' && syms.length === 1 && sg.s === 0 && sg.e === gr.durU;
    syms.forEach((x, i) => {
      const src = olds[i];
      const p = { kind: sg.kind, at: MG.fromU(x.s), dur: MG.fromU(x.e - x.s), display: x.dots ? { type: x.type, dots: x.dots } : { type: x.type }, g3: true };
      if (full) p.display.measureRest = true;
      if (src) p.reuse = src.id;
      if (sg.kind === 'note') {
        const model = olds[0];
        p.heads = model.heads.map(h => {
          if (i === 0) return { reuse: h.id };
          const same = src ? src.heads.find(y => midiOf(y) === midiOf(h)) : null;
          return same ? { reuse: same.id } : { pitch: h.pitch, like: h.id };
        });
        p.tieNext = i < syms.length - 1;
      }
      plan.push(p);
    });
    void tieOut;
  }

  /* ------------------------------------------------------------ R-reg (G3b, §6.4) */
  /* R-reg moves where a note's notated length ends, never where it starts, so that the voice-measure is written with
     fewer, plainer symbols: cost = the R-repr cost of the writing + λ · Σ |end' − end| / IOI, subject to
       C1 the onset stays;  C2 end' ≤ the next onset of the voice (and the measure's end);
       C3 |end' − end| ≤ max(1/32 W, 0.35 · IOI);  C4 end' never earlier than the heard release, when it moves earlier;
       C5 a note released within half its IOI keeps its rest (a clear detachment: staccato is §12.3's opt, not this).
     The heard release is the linked PerfNote's `off`, read through the performance's time map. A note with no linked
     PerfNote, or whose tied end leaves the measure, is left as written. Only the last piece of a note moves; the rests
     after it are written again; R-repr (the next pass) rewrites the pieces.

     OFF by default and in production until three real recordings (simple duple, simple triple, compound) are the
     baseline λ is set on (D1, M11): λ = 1 below is a placeholder no benchmark has chosen, and the pass has been run on
     synthetic fixtures only (tests/scoregraph/g3-regularize.test.js). */
  const REG = Object.freeze({ LAMBDA: 1, BUDGET_MIN: U / 32, BUDGET_IOI: 0.35, DETACHED: 0.5 });

  /* how long each linked head was held, in W, by the first performance's time map */
  function heardLengths(g) {
    const out = new Map();
    const perf = (g.performances || [])[0];
    if (!perf) return out;
    let map;
    /* a graph without a tempo mark is read at 120 quarters a minute (the tempo map needs a default) */
    try { map = T.perfTimeMap(g, perf.id, { defaultQpm: 120 }); } catch (e) { return out; }
    perf.notes.forEach(pn => {
      if (pn.link === undefined || !(pn.off > pn.on)) return;
      try { out.set(pn.link, R.sub(T.playbackW(g, map.fromUs(pn.off)), T.playbackW(g, map.fromUs(pn.on)))); } catch (e) { /* off the map */ }
    });
    return out;
  }

  /* the cheapest writing's cost of [a, b) as a note (tied pieces) or a rest, in regions computed with the new point */
  function stretchCost(gr, points, a, b, kind) {
    if (b <= a) return 0;
    const w = writeSegment(gr, regions(gr, points), { kind: kind, s: a, e: b });
    return w ? w.cost : Infinity;
  }

  const regularize = Object.freeze({
    name: 'regularize',
    g3b: true,
    may: ['sound', 'rests', 'pieces', 'tuplets', 'beams', 'acc'],
    run(g, ctx) {
      const changes = [];
      const heard = heardLengths(g);
      if (!heard.size) return { graph: g, idMap: {}, changes: changes };
      const res = O.edit(g, d => {
        const batch = [];
        g.parts.forEach(part => {
          const tieOut = new Map(), tieIn = new Map(), evOfHead = new Map();
          part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
          part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) { tieOut.set(sp.from, sp.to); tieIn.set(sp.to, sp.from); } });
          const vms = new Map();
          part.events.forEach(e => {
            if (e.grace) return;
            const k = e.voice + '|' + e.m;
            if (!vms.has(k)) vms.set(k, { voice: e.voice, m: e.m, evs: [] });
            vms.get(k).evs.push(e);
          });
          vms.forEach(vm => {
            if (ctx.skip.has(vm.m)) return;
            vm.evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
            if (ctx.perm.events(part, vm.evs, 'rhythm') !== 'rewrite') return;
            const gr = ctx.grid(g, vm.m);
            if (!gr) return;
            /* tuplets and tied pieces are R-repr's and P5's to write again; a voice-measure with any tuplet is left */
            if (part.spanners.some(sp => sp.type === 'tuplet' && sp.events.some(id => vm.evs.some(e => e.id === id)))) return;
            const segs = segments(part, vm.evs, tieOut, tieIn, evOfHead);
            if (!segs || segs === 'off-grid') return;
            const inside = new Set(vm.evs.map(e => e.id));
            const points = new Set();
            segs.forEach(sg => { points.add(sg.s); points.add(sg.e); });
            const ends = new Map();                     /* segment index -> its new end */
            segs.forEach((sg, i) => {
              if (sg.kind !== 'note') return;
              const last = sg.events[sg.events.length - 1];
              /* a tie leaving the voice-measure: the note goes on elsewhere */
              if (last.heads.some(h => { const to = tieOut.get(h.id); return to !== undefined && !inside.has((evOfHead.get(to) || {}).id); })) return;
              let nxt = gr.durU;
              for (let j = i + 1; j < segs.length; j++) if (segs[j].kind === 'note') { nxt = segs[j].s; break; }
              const ioi = nxt - sg.s;
              const lens = sg.events[0].heads.map(h => heard.get(h.id)).filter(Boolean);
              if (ioi <= 0 || !lens.length) return;
              /* a chord is held as long as its longest head */
              const held = Math.round(Math.max.apply(null, lens.map(x => R.toNumber(x))) * U);
              const heardEnd = sg.s + held;
              const budget = Math.max(REG.BUDGET_MIN, Math.floor(REG.BUDGET_IOI * ioi));
              const detached = held <= REG.DETACHED * ioi;
              const lastStart = toU(last.at);
              const cost = e2 => {
                const pts = new Set(points);
                pts.delete(sg.e);
                pts.add(e2);
                return stretchCost(gr, pts, sg.s, e2, 'note') + stretchCost(gr, pts, e2, nxt, 'rest') +
                  Math.round(REG.LAMBDA * 1000 * Math.abs(e2 - sg.e) / ioi);
              };
              let best = sg.e, bestCost = cost(sg.e);
              /* candidate ends on the binary grid of the measure (a voice-measure with tuplets is not R-reg's) */
              const lo = Math.max(lastStart + BIN_STEP, sg.e - budget), hi = Math.min(nxt, sg.e + budget);
              for (let e2 = Math.ceil((lo + gr.off) / BIN_STEP) * BIN_STEP - gr.off; e2 <= hi; e2 += BIN_STEP) {
                if (e2 === sg.e) continue;
                if (e2 < sg.e && e2 < heardEnd) continue;          /* C4 */
                if (e2 > sg.e && detached) continue;               /* C5 */
                const c = cost(e2);
                if (c < bestCost) { best = e2; bestCost = c; }
              }
              if (best !== sg.e) ends.set(i, { from: sg.e, to: best, nxt: nxt });
            });
            if (!ends.size) return;
            /* the plan: every event kept, the last piece of a moved note to its new end, the rests after it written again */
            const fmt = x => MG.fromU(x);
            const plan = [];
            const dropRests = [];
            ends.forEach(x => dropRests.push([Math.min(x.from, x.to), x.nxt]));
            const inGap = e => e.kind === 'rest' && dropRests.some(([a, b]) => toU(e.at) >= a && toU(e.at) < b);
            const newRests = [];
            ends.forEach(x => {
              if (x.to >= x.nxt) return;
              const pts = new Set(points);
              pts.delete(x.from);
              pts.add(x.to);
              const w = writeSegment(gr, regions(gr, pts), { kind: 'rest', s: x.to, e: x.nxt });
              (w ? w.syms : [{ s: x.to, e: x.nxt, type: null }]).forEach(sy => newRests.push({ kind: 'rest', at: fmt(sy.s), dur: fmt(sy.e - sy.s),
                display: sy.type ? (sy.dots ? { type: sy.type, dots: sy.dots } : { type: sy.type }) : undefined, g3: true }));
            });
            const lastOf = new Map();
            ends.forEach((x, i) => { const sg = segs[i]; lastOf.set(sg.events[sg.events.length - 1].id, x.to); });
            vm.evs.forEach(e => {
              if (inGap(e)) return;
              const p = d.keepPlan(d.event(e.id));
              if (lastOf.has(e.id)) {
                const len = lastOf.get(e.id) - toU(e.at);
                p.dur = fmt(len);
                const v = MG.BINARY.find(b => b.len === len);
                p.display = v ? (v.dots ? { type: v.type, dots: v.dots } : { type: v.type }) : e.display;
                p.g3 = true;
              }
              plan.push(p);
            });
            newRests.forEach(r => plan.push(r));
            plan.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
            batch.push({ voice: vm.voice, m: vm.m, plan: plan });
          });
        });
        const out = d.retimeBatch(batch);
        batch.forEach((it, k) => {
          out[k].forEach((id, i) => { if (it.plan[i].g3) d.markProv(d.event(id), ['rhythm', 'display']); });
          changes.push({ pass: 'regularize', kind: 'release', ids: out[k], m: it.m });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  /* ------------------------------------------------------------ voices from the performance (G3b, §8.3) */
  /* A chord has one length, so a note held under the notes after it is written short: the writer cut it at the next
     onset. The performance says how long it was held. A note of a staff's first voice held past two or more later
     onsets of that voice, all of them shorter, goes to the staff's second voice (label 2 or 6) with the one value
     nearest what was heard (within R-reg's budget, max(1/32 W, 0.35 × held)), where the second voice has nothing
     else in the measure. Its IDs stay; both voices' rests are written again. At most two voices a staff; nothing
     added or removed. OFF by default and in production until M11 (D1), like R-reg; synthetic fixtures only. */
  const FIRST = { '1': '2', '5': '6' };
  const perfVoices = Object.freeze({
    name: 'perf-voices',
    g3b: true,
    may: ['place', 'sound', 'rests', 'pieces', 'tuplets', 'beams', 'acc'],
    run(g, ctx) {
      const changes = [];
      const heard = heardLengths(g);
      if (!heard.size) return { graph: g, idMap: {}, changes: changes };
      const res = O.edit(g, d => {
        g.parts.forEach((gpart, pi) => {
          const part = d.doc.parts[pi];
          const tieOut = new Map(), tieIn = new Map(), evOfHead = new Map();
          gpart.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
          gpart.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) { tieOut.set(sp.from, sp.to); tieIn.set(sp.to, sp.from); } });
          const tupled = new Set();
          gpart.spanners.forEach(sp => { if (sp.type === 'tuplet') sp.events.forEach(id => tupled.add(id)); });
          gpart.voices.forEach(v1 => {
            const label2 = FIRST[v1.label];
            if (!label2) return;
            const existing = gpart.voices.find(x => x.staff === v1.staff && x.label === label2);
            g.timeline.measures.forEach(meas => {
              if (ctx.skip.has(meas.id)) return;
              const evs = gpart.events.filter(e => e.voice === v1.id && e.m === meas.id && !e.grace)
                .sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
              if (!evs.length || evs.some(e => tupled.has(e.id)) || ctx.perm.events(gpart, evs, 'voice') !== 'rewrite') return;
              if (existing && gpart.events.some(e => e.voice === existing.id && e.m === meas.id)) return;
              const gr = ctx.grid(g, meas.id);
              if (!gr) return;
              const segs = segments(gpart, evs, tieOut, tieIn, evOfHead);
              if (!segs || segs === 'off-grid') return;
              const notes = segs.filter(sg => sg.kind === 'note');
              /* the first such note of the measure (one a measure: the second voice is then taken) */
              for (const sg of notes) {
                const e = sg.events[0];
                if (sg.events.length !== 1 || e.heads.some(h => tieOut.has(h.id) || tieIn.has(h.id))) continue;
                const lens = e.heads.map(h => heard.get(h.id));
                if (lens.some(x => !x)) continue;
                const held = Math.round(Math.min.apply(null, lens.map(x => R.toNumber(x))) * U);
                const later = notes.filter(x => x.s > sg.s);
                if (later.length < 2 || !(sg.s + held > later[1].s)) continue;
                const budget = Math.max(U / 32, Math.floor(0.35 * held));
                const room = gr.durU - sg.s;
                const v = MG.BINARY.filter(b => b.len <= room && Math.abs(b.len - held) <= budget)
                  .sort((a, b) => Math.abs(a.len - held) - Math.abs(b.len - held) || a.dots - b.dots)[0];
                if (!v || v.len <= sg.e - sg.s) continue;
                /* the notes under it are shorter, and one symbol writes it where it starts */
                if (later.some(x => x.s < sg.s + v.len && x.e - x.s >= v.len)) continue;
                const w = writeSegment(gr, regions(gr, new Set([sg.s, sg.s + v.len])), { kind: 'note', s: sg.s, e: sg.s + v.len });
                if (!w || w.syms.length !== 1) continue;
                /* move it, then write both voices' measures again */
                const v2 = existing ? existing.id : (gpart.voices.some(x => x.staff === v1.staff && x.label === label2) ? null : d.addVoice(v1.staff, label2, part));
                if (!v2) return;
                d.moveEvent(e.id, v2, v1.staff);
                const restsOf = (a, b) => {
                  if (b <= a) return [];
                  const rw = writeSegment(gr, regions(gr, new Set([a, b])), { kind: 'rest', s: a, e: b });
                  return (rw ? rw.syms : [{ s: a, e: b, type: 'quarter', dots: 0 }]).map(sy => ({ kind: 'rest', at: MG.fromU(sy.s), dur: MG.fromU(sy.e - sy.s),
                    display: sy.dots ? { type: sy.type, dots: sy.dots } : { type: sy.type } }));
                };
                const moved = d.keepPlan(d.event(e.id));
                moved.dur = MG.fromU(v.len);
                moved.display = v.dots ? { type: v.type, dots: v.dots } : { type: v.type };
                moved.g3 = true;
                const plan2 = restsOf(0, sg.s).concat([moved], restsOf(sg.s + v.len, gr.durU));
                /* the first voice keeps everything else; the span the note leaves becomes rests (any rests after it stay) */
                const rest1 = d.voiceMeasure(v1.id, meas.id).filter(x => x.id !== e.id).map(x => d.keepPlan(x));
                const plan1 = rest1.concat(restsOf(sg.s, sg.e)).sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
                const out = d.retimeBatch([{ voice: v2, m: meas.id, plan: plan2 }, { voice: v1.id, m: meas.id, plan: plan1 }]);
                out[0].forEach((id, i) => { if (plan2[i].g3) d.markProv(d.event(id), ['rhythm', 'display']); });
                changes.push({ pass: 'perf-voices', kind: 'second-voice', ids: [e.id], m: meas.id });
                break;
              }
            });
          });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ rhythm, regularize, perfVoices, segments, regions, write, writeSegment, currentCost, rewrite, sameWriting, TRIPLET, REG, heardLengths });
});
