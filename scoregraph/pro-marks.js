/* ============================================================================
   PPP ScoreGraph — G3 pass P8: marks (docs/GOALS/G03 §12, §13)

   Anchors: slurs, articulations, fermatas, dynamics and fingering follow the
   notes they belong to through every G3 edit (the ops keep them: a split
   keeps onset marks on the first piece and length marks on the last, a merge
   keeps the survivor's, a move keeps the head; §12.2). The critic checks
   that none moved (its marks component, I6); this pass adds nothing to them
   and never writes a new mark (A31: G3 infers no dynamic, slur,
   articulation or fingering, D6).

   Pedal marks of an inferred score (§13.2): a release and the next press of
   the same pedal less than a beat apart are one pedal with a change at the
   press (the writer already joins a release and a press at one position).
   Whether a pedal is there at all is the transcription's (issue 17), not G3's;
   G3 drops none and adds none. Imported pedals are kept.

   The join is OFF unless opts.pedalJoin (G03 §28 B1, decision G3-U7): the app
   plays a pedal change without lifting the damper (Playback.pedal keeps it
   down, pedalEvents sends CC64 64), so a legato pedal written as changes would
   be played held to its end. Until the app plays a change as a release and a
   press, G3 writes every pedal as the writer wrote it.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./ops.js'), require('./time.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proMarks = factory(M.rational, M.ops, M.time); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, O, T) {
  'use strict';

  const marks = Object.freeze({
    name: 'marks',
    may: ['pedal'],
    run(g, ctx) {
      const changes = [];
      /* experimental, off by default and in production (B1): see the header */
      if (!ctx.opts.pedalJoin) return { graph: g, idMap: {}, changes: changes };
      const starts = new Map();
      let acc = R.ZERO;
      g.timeline.measures.forEach(m => { starts.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
      const W = p => R.add(starts.get(p.m), R.parse(p.at));
      const res = O.edit(g, d => {
        g.parts.forEach(part => {
          const pedals = part.spanners.filter(s => s.type === 'pedal' && s.to && !s.soundOnly && ctx.perm.spanner(part, s) === 'rewrite')
            .sort((a, b) => R.cmp(W(a.from), W(b.from)));
          for (let i = 0; i + 1 < pedals.length; i++) {
            const a = pedals[i], b = pedals[i + 1];
            if (a.pedal !== b.pedal || ctx.skip.has(a.to.m) || ctx.skip.has(b.from.m)) continue;
            const gap = R.sub(W(b.from), W(a.to));
            if (R.sign(gap) <= 0) continue;
            /* less than a beat of the metre in force where it is released */
            const mt = T.meterAt(g, a.to.m);
            const beat = mt ? (mt.beatType >= 8 && mt.beats[0] % 3 === 0 ? R.make(3, mt.beatType) : R.make(1, mt.beatType)) : R.make(1, 4);
            if (!R.lt(gap, beat)) continue;
            const merged = (a.changes || []).concat([b.from], b.changes || []);
            d.setPedal(a.id, { to: b.to, changes: merged, mark: a.mark || b.mark });
            d.removeSpanner(b.id);
            changes.push({ pass: 'marks', kind: 'pedal-join', ids: [a.id, b.id], m: a.to.m });
            /* the joined pedal takes the place of both for the next pair */
            pedals[i + 1] = Object.assign({}, a, { to: b.to, changes: merged });
          }
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ marks });
});
