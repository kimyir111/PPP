/* ============================================================================
   PPP ScoreGraph — G3 pass P3: voices (docs/GOALS/G03 §8)

   G3a (§8.2) works from the graph alone. A chord has one length, so the graph
   cannot say that one of its notes is held longer than the others; voices
   whose notes have different lengths come from the performance (G3b, §8.3,
   off by default: D1). What G3a does:

     - a second voice (label 2 on the right-hand staff, 6 on the left, as P2
       makes them) fills the time around its notes with visible rests in every
       measure where it has a note (the engraving convention: a gap in a
       second voice is a rest you can see), and has no events in a measure
       where it has no note (it is not needed there);
     - a voice left with no event at all goes;
     - imported voices are left as they are (§14), including two voices a file
       wrote without overlapping notes (that is the editor's intent).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./ops.js'), require('./pro-staff.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proVoice = factory(M.rational, M.ops, M.proStaff); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, O, PS) {
  'use strict';

  const SECOND = ['2', '6'];

  const voice = Object.freeze({
    name: 'voice',
    may: ['place', 'rests', 'pieces', 'tuplets', 'beams'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        const drop = [], refill = [], after = [];
        g.parts.forEach((gpart, pi) => {
          if (!PS.handsOf(gpart)) return;
          gpart.voices.forEach(v => {
            if (SECOND.indexOf(v.label) < 0) return;
            const evs = gpart.events.filter(e => e.voice === v.id);
            if (evs.length && ctx.perm.events(gpart, evs, 'voice') !== 'rewrite') return;
            const dropIfEmpty = () => {
              /* a second voice with nothing (left) in it goes: only where G3 may rewrite voices */
              const part = d.doc.parts[pi];
              if (ctx.perm.graph('voice') !== 'rewrite' || part.events.some(e => e.voice === v.id)) return;
              part.voices = part.voices.filter(x => x.id !== v.id);
              d.retire(v.id);
              d.reindex(); d.touch();
              changes.push({ pass: 'voice', kind: 'drop-voice', ids: [v.id] });
            };
            if (!evs.length) { after.push(dropIfEmpty); return; }
            const byM = new Map();
            evs.forEach(e => { if (!byM.has(e.m)) byM.set(e.m, []); byM.get(e.m).push(e); });
            byM.forEach((list, m) => {
              if (ctx.skip.has(m)) return;
              const notes = list.filter(e => e.kind === 'note' && !e.grace);
              if (!notes.length) {
                list.forEach(e => drop.push(e.id));
                changes.push({ pass: 'voice', kind: 'drop-rests', ids: list.map(e => e.id), m: m });
                return;
              }
              refill.push({ voice: v.id, m: m, restPieces: (a, b) => PS.restPieces(d, m, a, b), ids: list.map(e => e.id) });
            });
            after.push(dropIfEmpty);
          });
        });
        d.removeEvents(drop);
        if (d.refillRestsBatch(refill)) refill.forEach(it => { if (it.changed) changes.push({ pass: 'voice', kind: 'fill', ids: it.ids, m: it.m }); });
        after.forEach(f => f());
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  /* G3b, §8.3 (off by default, D1): performance-based voices are in Step 14. */
  return Object.freeze({ voice });
});
