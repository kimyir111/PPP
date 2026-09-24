/* ============================================================================
   PPP engrave — which notes a beam joins (docs/GOALS/G04 §11.1, G4-D3)

   beams(graph, ctx) -> { beams: [{id, events, breaks, source, deferred?}], ledger: [...] }

   A part with any beam in the graph is drawn with the graph's beams and only
   those: a file that beams at all has said where it does not, and its
   unbeamed notes keep their flags (G4-I1: the voice-measure rule of G04
   §11.1 would have beamed 259 groups in 15 catalogue files that the files
   leave unbeamed). A part with no beam at all - PPP's own transcriptions
   while G3 is off, MIDI, files that do not encode beaming - gets the beams of
   the one beaming rule the codebase has: pro-beam.js groups(), called as a
   pure function (the G3 pass does not run and nothing is written to the
   graph). Those are 'derived', and the ledger says so.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('../scoregraph/pro-beam.js'), require('./ledger.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.planBeams = factory(root.PPPScoreGraph, (root.PPPScoreGraphModules || {}).proBeam, M.ledger);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, proBeam, L) {
  'use strict';

  const R = SG.rational, MG = SG.meterGrid;

  function beams(g, ctx) {
    const out = [], ledger = [];
    const staffOf = ctx.eventById;
    g.parts.forEach(part => {
      const beamed = new Set();
      part.spanners.forEach(s => {
        if (s.type !== 'beam') return;
        const events = (s.events || []).slice();
        const staves = new Set(events.map(id => staffOf.get(id) && staffOf.get(id).staff));
        events.forEach(id => { const e = staffOf.get(id); if (e) beamed.add(e.voice + '|' + e.m); });
        const b = { id: s.id, events: events, breaks: (s.breaks || []).map(x => ({ after: x.after, level: x.level })), source: 'graph' };
        const cross = staves.size > 1;
        if (cross) b.deferred = 'cross-staff-beam';
        out.push(b);
        ledger.push({ ref: s.id, kind: 'beam', status: cross ? 'deferred' : 'drawn', code: cross ? 'cross-staff-beam' : undefined, plan: s.id });
        (s.breaks || []).forEach((x, i) => ledger.push({ ref: L.ref.beamBreak(s.id, i), kind: 'beam-break',
          status: cross ? 'deferred' : 'drawn', code: cross ? 'cross-staff-beam' : undefined, plan: s.id }));
      });
      if (ctx.config.deriveBeams === false || !proBeam || typeof proBeam.groups !== 'function') return;
      if (part.spanners.some(s => s.type === 'beam')) return;
      /* the tuplet a note is shown in, for groups(): a beam does not run across the edge of a printed tuplet. A
         one-note tuplet merged for display (G4-U2 B) counts as the group it is shown as. */
      const tupOf = new Map();
      const shownAs = ctx.tupletGroupOf || new Map();
      part.spanners.forEach(s => { if (s.type === 'tuplet' && s.printed !== false) (s.events || []).forEach(id => tupOf.set(id, shownAs.get(s.id) || s.id)); });
      const vms = new Map();
      part.events.forEach(e => {
        if (e.grace) return;
        const k = e.voice + '|' + e.m;
        if (beamed.has(k)) return;
        if (!vms.has(k)) vms.set(k, []);
        vms.get(k).push(e);
      });
      vms.forEach((evs, k) => {
        const m = evs[0].m;
        let gr = ctx.grids.get(m);
        if (gr === undefined) {
          try { gr = MG.grid(g, m); } catch (e) { gr = null; }
          ctx.grids.set(m, gr);
        }
        if (!gr) return;
        const sorted = evs.slice().sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)) || SG.schema.idNumber(a.id) - SG.schema.idNumber(b.id));
        let groups;
        try { groups = proBeam.groups(sorted, gr, id => tupOf.get(id)); } catch (e) { groups = []; ctx.diag('BEAM_RULE_FAILED', [k], String(e && e.message)); }
        groups.forEach(x => {
          const id = L.ref.derived('beam', x.events[0]);
          const staves = new Set(x.events.map(eid => staffOf.get(eid) && staffOf.get(eid).staff));
          out.push({ id: id, events: x.events.slice(), breaks: (x.breaks || []).map(y => ({ after: y.after, level: y.level })), source: 'derived',
            deferred: staves.size > 1 ? 'cross-staff-beam' : undefined });
          ledger.push({ ref: id, kind: 'beam', status: 'derived', code: 'part-states-no-beams', plan: id });
        });
      });
    });
    return { beams: out, ledger: ledger };
  }

  return Object.freeze({ beams });
});
