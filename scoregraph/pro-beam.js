/* ============================================================================
   PPP ScoreGraph — G3 pass P7: beams (docs/GOALS/G03 §11)

   Membership and breaks only: which notes share a beam, and where a deeper
   beam is broken. Geometry, slant and stem direction are G4's. The app's
   renderer draws its own beams until G4 (D4); the MusicXML export writes
   these.

   In a voice-measure, notes of an eighth or shorter are beamed together while
   they start in one primary beam group of the metre (meter-grid beamGroups:
   the beat in 2/4, 3/4 and 4/4, the quarter in 2/2, the dotted quarter in
   6/8, 9/8, 12/8, the measure in 3/8, the groups of 5/8 and 7/8). A beam
   passes over rests shorter than an eighth between two of its notes (the
   design's default breaks it at every rest; with the short rests PPP's
   releases leave, that left a quarter of the beamable notes unbeamed: G03
   §24 record); a longer rest, a quarter or longer, a note that starts a new
   group, or the edge of a tuplet ends it; a beam of one note is none. Where
   the table (§11.2) says so, the beams below the eighth break at each eighth
   (level 2 and down).
   Imported beams are kept (§14); fill mode only beams a voice-measure that
   has no beam at all.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./ops.js'), require('./meter-grid.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proBeam = factory(M.rational, M.schema, M.ops, M.meterGrid); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, O, MG) {
  'use strict';

  const U = MG.U;
  const EIGHTH = S.NOTE_TYPES.indexOf('eighth');
  const beamable = e => e.kind !== 'rest' && e.display && S.NOTE_TYPES.indexOf(e.display.type) >= EIGHTH;
  const underEighth = e => e.display && S.NOTE_TYPES.indexOf(e.display.type) > EIGHTH;

  /* The beams of a voice-measure: [{events, breaks?}]. */
  function groups(evs, gr, tupletOf) {
    const spans = MG.beamGroups(gr);
    const spanOf = x => spans.findIndex(([a, b]) => x >= a && x < b);
    /* eighths break the deeper beams in 2/4, 3/4, 4/4, 2/2 and compound metres; not in 3/8 or additive ones (§11.2) */
    const eighthBreaks = !gr.additive && !(gr.compound && gr.n === 3);
    const out = [];
    let cur = [], curSpan = -1, curTup = null;
    const close = () => {
      if (cur.length >= 2) {
        const g = { events: cur.map(x => x.e.id) };
        if (eighthBreaks) {
          const br = [];
          for (let i = 0; i + 1 < cur.length; i++) {
            const at = cur[i + 1].s;
            if (underEighth(cur[i].e) && underEighth(cur[i + 1].e) && !cur[i + 1].tup && (at + gr.off) % (U / 8) === 0) br.push({ after: cur[i].e.id, level: 2 });
          }
          if (br.length) g.breaks = br;
        }
        out.push(g);
      }
      cur = []; curSpan = -1; curTup = null;
    };
    evs.forEach((e, i) => {
      const s = MG.toU(e.at);
      /* a rest shorter than an eighth between two notes of the beam's group lets the beam pass over it (it is not a
         member: a file writes no <beam> on a rest); any other rest, and anything a beam cannot hold, ends it */
      if (e.kind === 'rest' && cur.length && s !== null && spanOf(s) === curSpan) {
        const next = evs.slice(i + 1).find(x => x.kind !== 'rest');
        const ns = next ? MG.toU(next.at) : null;
        if (next && beamable(next) && ns !== null && spanOf(ns) === curSpan && (tupletOf(next.id) || null) === curTup &&
            evs.slice(i, evs.indexOf(next)).every(x => x.kind === 'rest' && underEighth(x))) return;
      }
      if (s === null || !beamable(e)) { close(); return; }
      const sp = spanOf(s), tup = tupletOf(e.id) || null;
      if (cur.length && (sp !== curSpan || tup !== curTup)) close();
      cur.push({ e: e, s: s, tup: tup });
      curSpan = sp; curTup = tup;
    });
    close();
    return out;
  }

  const beam = Object.freeze({
    name: 'beam',
    may: ['beams'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        g.parts.forEach(part => {
          const tupOf = new Map();
          part.spanners.forEach(s => { if (s.type === 'tuplet' && s.printed !== false) s.events.forEach(id => tupOf.set(id, s.id)); });
          const beamed = new Set();
          part.spanners.forEach(s => { if (s.type === 'beam') s.events.forEach(id => beamed.add(id)); });
          const vms = new Map();
          part.events.forEach(e => {
            if (e.grace) return;
            const k = e.voice + '|' + e.m;
            if (!vms.has(k)) vms.set(k, { voice: e.voice, m: e.m, evs: [] });
            vms.get(k).evs.push(e);
          });
          vms.forEach(vm => {
            if (ctx.skip.has(vm.m)) return;
            const right = ctx.perm.events(part, vm.evs, 'display');
            if (right === 'none') return;
            if (right === 'fill' && vm.evs.some(e => beamed.has(e.id))) return;
            const gr = ctx.grid(g, vm.m);
            if (!gr) return;
            vm.evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
            const want = groups(vm.evs, gr, id => tupOf.get(id));
            const src = d.source();
            want.forEach(x => { x.prov = right === 'fill' ? { src: src, op: 'generated' } : { src: src }; });
            /* a beam that is already there keeps its provenance */
            part.spanners.forEach(s => {
              if (s.type !== 'beam') return;
              const w = want.find(x => x.events.join() === s.events.join());
              if (w) { if (s.prov) w.prov = s.prov; else delete w.prov; }
            });
            if (d.setBeams(vm.voice, vm.m, want)) changes.push({ pass: 'beam', kind: 'beam', ids: vm.evs.map(e => e.id), m: vm.m });
          });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ beam, groups });
});
