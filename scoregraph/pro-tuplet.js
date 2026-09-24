/* ============================================================================
   PPP ScoreGraph — G3 pass P5: logical tuplets (docs/GOALS/G03 §7; G1 F1)

   One logical tuplet is one Tuplet spanner: the consecutive events of one
   voice that exactly fill a tuplet span (normal × unit), notes, tied pieces
   and rests alike. Start and stop are the first and last member; MusicXML's
   <tuplet> marks are derived from them by the exporter.

   In a voice-measure the pass finds the runs of consecutive triplet pieces
   (an event whose printed value × 2/3 is its length: 3:2) and tiles each run
   with 3:2 spans aligned to the measure's grid: a beat (unit eighth) first,
   then a half-beat (unit 16th), then a half bar (unit quarter). A span the
   pieces fill exactly becomes one tuplet; the members keep their events and
   IDs. A piece no span can hold keeps what it had, with N-TUPLET-UNGROUPABLE
   (§7.3). A rest that lasted a triplet length but carried no tuplet (issue 19)
   becomes a member and so gets its ratio.

   Imported tuplets are kept (§14): nested ones, other ratios, anything an
   imported event holds. In fill mode only a missing unit is filled in.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./ops.js'), require('./meter-grid.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proTuplet = factory(M.rational, M.schema, M.ops, M.meterGrid); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, O, MG) {
  'use strict';

  const U = MG.U;
  /* span lengths tried, in order, and the unit each implies (normal 2 × unit = span) */
  const SPANS = [{ len: U / 4, unit: 'eighth' }, { len: U / 8, unit: '16th' }, { len: U / 2, unit: 'quarter' }];

  /* Is an event a 3:2 triplet piece: printed value × 2/3 == length? */
  function tripletPiece(e) {
    if (!e.display || !e.display.type) return false;
    const v = S.noteValue(e.display.type, e.display.dots);
    return !!v && R.eq(R.mul(v, R.make(2, 3)), R.parse(e.dur));
  }

  /* The voice-measures of a part: key voice|m -> non-grace events in time order. */
  function voiceMeasures(part) {
    const map = new Map();
    part.events.forEach(e => {
      if (e.grace) return;
      const k = e.voice + '|' + e.m;
      if (!map.has(k)) map.set(k, { voice: e.voice, m: e.m, evs: [] });
      map.get(k).evs.push(e);
    });
    map.forEach(x => x.evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at))));
    return map;
  }

  /* Tile runs of triplet pieces with spans (§7.3). evs: the voice-measure; off: the pickup offset (integer of 1/U).
     Returns {groups: [{events, unit}], loose: [event IDs no span holds]}. */
  function tile(evs, off, beats) {
    /* base: the undotted value of the printed type (integer of 1/U), what the renderer measures a bracket by */
    const base = e => { const v = e.display && e.display.type ? S.NOTE_TYPE_VALUE[e.display.type] : null; return v ? v.n * U / v.d : 0; };
    const pieces = evs.map(e => ({ e: e, s: MG.toU(e.at), en: MG.toU(R.format(R.add(R.parse(e.at), R.parse(e.dur)))), t: tripletPiece(e), base: base(e) }));
    const runs = [];
    let cur = null;
    pieces.forEach(p => {
      if (!p.t || p.s === null || p.en === null) { cur = null; return; }
      if (cur && cur[cur.length - 1].en === p.s) cur.push(p); else { cur = [p]; runs.push(cur); }
    });
    const groups = [], loose = [];
    runs.forEach(run => {
      /* best[i]: the best tiling of run[i..]: most pieces held, then the preferred spans (a beat before a half-beat
         before a half bar: SPANS order), then fewest groups */
      const n = run.length;
      const best = new Array(n + 1).fill(null);
      best[n] = { held: 0, pen: 0, groups: 0, step: null };
      const better = (a, b) => !b || a.held > b.held || (a.held === b.held && (a.pen < b.pen || (a.pen === b.pen && a.groups < b.groups)));
      for (let i = n - 1; i >= 0; i--) {
        let cand = { held: best[i + 1].held, pen: best[i + 1].pen, groups: best[i + 1].groups, step: { skip: true } };
        SPANS.forEach((sp, rank) => {
          const x = run[i].s + off;
          const end = x + sp.len;
          if (beats) {
            /* a compound or additive metre: a span starts on an eighth of its (dotted) beat and stays inside the beat */
            let bs = 0;
            beats.forEach(bt => { if (bt <= x) bs = bt; });
            if ((x - bs) % (U / 8) !== 0 || beats.some(bt => bt > x && bt < end)) return;
          } else if (x % sp.len !== 0) return;
          let j = i;
          while (j < n && run[j].en + off <= end) j++;
          /* a span one note fills is no tuplet (that note is a plain value) */
          if (j - i < 2 || run[j - 1].en + off !== end) return;
          const rest = best[j];
          /* a span whose unit is longer than its shortest member is one the app's renderer splits (it closes a bracket
             once `normal` times the shortest value it has seen has gone by): prefer the span the members' values fit */
          const shortest = Math.min.apply(null, run.slice(i, j).map(p => p.base));
          const fits = shortest >= sp.len / 2 ? 0 : 3;
          const c = { held: rest.held + (j - i), pen: rest.pen + rank + fits, groups: rest.groups + 1, step: { to: j, unit: sp.unit } };
          if (better(c, cand)) cand = c;
        });
        best[i] = cand;
      }
      for (let i = 0; i < n;) {
        const st = best[i].step;
        if (st.skip) { loose.push(run[i].e.id); i++; continue; }
        groups.push({ events: run.slice(i, st.to).map(p => p.e.id), unit: st.unit });
        i = st.to;
      }
    });
    return { groups: groups, loose: loose };
  }

  const tuplet = Object.freeze({
    name: 'tuplet',
    may: ['tuplets'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        const batch = [];
        g.parts.forEach(part => {
          const tupsOf = new Map();
          part.spanners.forEach(s => { if (s.type === 'tuplet') s.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(s); }); });
          voiceMeasures(part).forEach(vm => {
            if (ctx.skip.has(vm.m)) return;
            const right = ctx.perm.events(part, vm.evs, 'rhythm');
            if (right === 'none') return;
            const gr = ctx.grid(g, vm.m);
            if (!gr) return;
            const inside = new Set(vm.evs.map(e => e.id));
            const mine = [];
            vm.evs.forEach(e => (tupsOf.get(e.id) || []).forEach(s => { if (mine.indexOf(s) < 0) mine.push(s); }));
            /* a tuplet reaching outside the voice-measure, a nested one, another ratio: leave the voice-measure alone */
            if (mine.some(s => s.parent !== undefined || s.actual !== 3 || s.normal !== 2 || s.events.some(id => !inside.has(id)) ||
              mine.some(t => t !== s && t.parent === s.id))) return;
            if (mine.some(s => ctx.perm.spanner(part, s) === 'none' && right !== 'rewrite')) return;
            const { groups, loose } = tile(vm.evs, gr.off, gr.compound || gr.additive ? gr.beats : null);
            if (right === 'fill') {
              /* an imported score: only a missing unit is filled in, on a tuplet that already is a whole group */
              const plan = mine.map(s => {
                const gg = groups.find(x => x.events.join() === s.events.join());
                const out = { events: s.events, actual: s.actual, normal: s.normal };
                ['unit', 'parent', 'show', 'printed', 'prov'].forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
                if (!s.unit && gg) { out.unit = { type: gg.unit }; out.prov = { src: d.source(), op: 'generated' }; }
                return out;
              });
              batch.push({ voice: vm.voice, m: vm.m, groups: plan, change: { pass: 'tuplet', kind: 'fill-unit', ids: mine.map(s => s.id), m: vm.m } });
              return;
            }
            const loneSet = new Set(loose);
            /* the new groups, and every old tuplet whose members are all loose pieces, kept exactly as they were: a piece
               no span holds is left as the writer wrote it, bracket included (§7.4 T08 "no change"; G03 §28 M5: hiding its
               bracket hid it from the one-note metric, and whether a bracket shows is G4's, §7.2) */
            const plan = groups.map(x => ({ events: x.events, actual: 3, normal: 2, unit: { type: x.unit } }));
            mine.forEach(s => {
              if (s.events.every(id => loneSet.has(id))) {
                const out = { events: s.events, actual: s.actual, normal: s.normal };
                ['unit', 'show', 'printed', 'prov'].forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
                plan.push(out);
              }
            });
            /* a new group gets G3's source (its op stays the input's: inferred) */
            const known = new Set(mine.map(s => s.events.join()));
            plan.forEach(x => { if (!known.has(x.events.join())) x.prov = { src: d.source() }; else { const s = mine.find(t => t.events.join() === x.events.join()); if (s.prov) x.prov = s.prov; } });
            if (plan.length || mine.length) batch.push({ voice: vm.voice, m: vm.m, groups: plan, change: { pass: 'tuplet', kind: 'group', ids: vm.evs.map(e => e.id), m: vm.m } });
            if (loose.length) ctx.issue('N-TUPLET-UNGROUPABLE', loose.length + ' triplet piece(s) of voice ' + vm.voice + ' fill no whole tuplet span', { m: vm.m, voice: vm.voice });
          });
        });
        if (batch.length && d.setGroupsBatch('tuplet', batch)) batch.forEach(it => { if (it.changed) changes.push(it.change); });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ tuplet, tile, tripletPiece, SPANS });
});
