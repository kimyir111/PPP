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
  function tile(evs, off) {
    const pieces = evs.map(e => ({ e: e, s: MG.toU(e.at), en: MG.toU(R.format(R.add(R.parse(e.at), R.parse(e.dur)))), t: tripletPiece(e) }));
    const runs = [];
    let cur = null;
    pieces.forEach(p => {
      if (!p.t || p.s === null || p.en === null) { cur = null; return; }
      if (cur && cur[cur.length - 1].en === p.s) cur.push(p); else { cur = [p]; runs.push(cur); }
    });
    const groups = [], loose = [];
    runs.forEach(run => {
      let best = null;
      SPANS.forEach(sp => {
        /* every span [k·len, (k+1)·len) of the measure frame the run's pieces fill exactly */
        const got = [];
        let i = 0;
        while (i < run.length) {
          const x = run[i].s + off;
          if (x % sp.len !== 0) { i++; continue; }
          let j = i, end = x + sp.len;
          while (j < run.length && run[j].en + off <= end) j++;
          if (j > i && run[j - 1].en + off === end) { got.push({ from: i, to: j }); i = j; } else i++;
        }
        const n = got.reduce((s, x) => s + x.to - x.from, 0);
        if (n && (!best || n > best.n)) best = { n: n, got: got, unit: sp.unit };
      });
      const held = new Set();
      if (best) best.got.forEach(x => {
        groups.push({ events: run.slice(x.from, x.to).map(p => p.e.id), unit: best.unit });
        for (let k = x.from; k < x.to; k++) held.add(k);
      });
      run.forEach((p, k) => { if (!held.has(k)) loose.push(p.e.id); });
    });
    return { groups: groups, loose: loose };
  }

  const tuplet = Object.freeze({
    name: 'tuplet',
    may: ['tuplets'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
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
            const { groups, loose } = tile(vm.evs, gr.off);
            if (right === 'fill') {
              /* an imported score: only a missing unit is filled in, on a tuplet that already is a whole group */
              const plan = mine.map(s => {
                const gg = groups.find(x => x.events.join() === s.events.join());
                const out = { events: s.events, actual: s.actual, normal: s.normal };
                ['unit', 'parent', 'show', 'printed', 'prov'].forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
                if (!s.unit && gg) { out.unit = { type: gg.unit }; out.prov = { src: d.source(), op: 'generated' }; }
                return out;
              });
              if (d.setTuplets(vm.voice, vm.m, plan)) changes.push({ pass: 'tuplet', kind: 'fill-unit', ids: mine.map(s => s.id), m: vm.m });
              return;
            }
            const loneSet = new Set(loose);
            /* the new groups, and every old tuplet whose members are all loose pieces (kept as they were) */
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
            if (d.setTuplets(vm.voice, vm.m, plan)) changes.push({ pass: 'tuplet', kind: 'group', ids: vm.evs.map(e => e.id), m: vm.m });
            if (loose.length) ctx.issue('N-TUPLET-UNGROUPABLE', loose.length + ' triplet piece(s) of voice ' + vm.voice + ' fill no whole tuplet span', { m: vm.m, voice: vm.voice });
          });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ tuplet, tile, tripletPiece, SPANS });
});
