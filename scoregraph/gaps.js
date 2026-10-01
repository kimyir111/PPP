/* ============================================================================
   PPP ScoreGraph - closing sub-sixteenth gaps (docs/GOALS/G09 section 12: G9f, and "Transcription rests at the source")

     closeSmallGaps(graph) -> { graph, changed, stats, issues }

   A transcription's note lengths are what a player did, not what a printed edition writes: the silences between its notes come out as rests of a 32nd, a 64th or
   a triplet 64th (the 90-bar audio piece i10: 102 of 169 gaps between right-hand notes were shorter than a 16th, 323 rests in the graph, 62 of them 32nd and 53 64th). A printed
   edition never writes such a rest between two notes: it lengthens the note before it or leaves the space.

   The rule, per staff (hand) and measure: a GAP is a stretch in which no note of the staff sounds, from the end of the last note before it (a note of the
   same measure must precede it: a gap at the start of a measure, which would need a note of the measure before, is never touched, so no note crosses a
   barline) to the next onset of any note of the staff or to the end of the measure. A gap of more than 0 and less than a 16th (1/16 of a whole note,
   exactly) is closed: every note that ends where the gap starts is lengthened to the end of the gap (never past the next onset of the hand, never past the
   measure), and the rests of the staff that lie wholly inside the gap are removed (a rest that reaches beyond the gap belongs to another voice that is
   silent there, and stays). No note is shortened, no onset or pitch changes. A lengthened note whose new length is a plain written value (a 32nd and a
   64th make a dotted 16th; at most one dot) takes it as its written value; any other keeps the value it was written with (the importer's own convention: a
   written value and an exact length that differ). The other half: a 32nd or 64th rest among the pieces of a LONGER silence that has a note after it (and the pieces at the start of a measure) is not
   drawn either: the rest event is omitted and the silence stays as it was (no note changes, so the sound is untouched). A silence with no note after it at all (the end of the
   staff's last measure with a note) keeps its rests; one at the end of an earlier measure has the next bar's note after it. Sound: a lengthened note rings at most a 16th of a whole note (a quarter of a beat in 4/4) less one grid step longer, and always
   stops where the hand's next note starts (a few tens of milliseconds at a normal tempo, and with the pedal as it was).

   Idempotent: a graph this pass has run on has no gap left, so a second run returns the very same object. Never a throw: a graph the pass does not understand (an edit the
   validator refuses) comes back as it is, with `stats.failed` saying why.

   Used by repair/index.js (G9f: the last step of a one-note-per-hand arrangement of a transcription) and by audio-score.js (the recording-to-score path, so the review screen, the saved
   transcription song and every arranger's input are clean at the source). Node and browser (a <script> after scoregraph/ops.js and rational.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ops.js'), require('./rational.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.gaps = factory(M.ops, M.rational); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OPS, R) {
  'use strict';

  const GAP_LIMIT = R.make(1, 16);
  const SIXTEENTH_OR_LONGER = new Set(['whole', 'half', 'quarter', 'eighth', '16th']);
  const GAP_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.g9f-gaps', version: '1.0.0' });

  function plainValue(dur) {
    const names = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'];
    for (let i = 0; i < names.length; i++) {
      for (let dots = 0; dots <= 1; dots++) { /* one dot at most: a double-dotted note is not what a gap's closing should write */
        const v = R.mul(R.make(1, Math.pow(2, i)), R.make(Math.pow(2, dots + 1) - 1, Math.pow(2, dots)));
        if (R.eq(v, dur)) return dots ? { type: names[i], dots: dots } : { type: names[i] };
      }
    }
    return null;
  }

  /* the gaps to close in a graph: [{part, staff, m, a, b, notes: [event], rests: [event]}] (rationals a, b: measure-relative, whole notes) */
  function smallGaps(g, kept) {
    const out = [];
    g.parts.forEach(part => {
      const byKey = new Map();
      part.events.forEach(e => {
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.grace || !e.staff) return;
        const k = e.staff + '|' + e.m;
        if (!byKey.has(k)) byKey.set(k, { staff: e.staff, m: e.m, notes: [], rests: [] });
        byKey.get(k)[e.kind === 'note' ? 'notes' : 'rests'].push(e);
      });
      const mDur = new Map(g.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
      /* the last measure (by position) in which each staff has a note: a silence at the end of an earlier measure has a note after it (in a later bar) */
      const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
      const lastNoted = new Map();
      byKey.forEach(grp => { if (grp.notes.length) lastNoted.set(grp.staff, Math.max(lastNoted.has(grp.staff) ? lastNoted.get(grp.staff) : -1, mIndex.get(grp.m))); });
      byKey.forEach(grp => {
        if (!grp.notes.length || !mDur.has(grp.m)) return;
        const spans = grp.notes.map(e => { const on = R.parse(e.at); return { e: e, on: on, off: R.add(on, R.parse(e.dur)) }; });
        spans.sort((x, y) => R.cmp(x.on, y.on));
        /* `hasPrev`: a note of this measure ends where the gap starts; `bounded`: a note of this staff starts where it ends */
        const consider = (a, b, hasPrev, bounded) => {
          const len = R.sub(b, a);
          if (!(R.sign(len) > 0)) return;
          const inside = grp.rests.filter(r => { const on = R.parse(r.at); return R.ge(on, a) && R.le(R.add(on, R.parse(r.dur)), b); });
          if (hasPrev && R.lt(len, GAP_LIMIT)) {
            const ending = spans.filter(s => R.eq(s.off, a)).map(s => s.e);
            /* a lengthened note must not run into another event of ITS OWN voice (a rest of that voice that reaches past the gap, or a note of it): then this gap is left as it is */
            const gone = new Set(inside.map(r => r.id));
            const clash = ending.some(n => grp.rests.concat(grp.notes).some(o => o !== n && o.voice === n.voice && !gone.has(o.id) && R.lt(R.parse(o.at), b) && R.gt(R.add(R.parse(o.at), R.parse(o.dur)), a)));
            if (clash) { kept.skipped++; return; }
            out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: ending, rests: inside });
            return;
          }
          /* a silence of a 16th or more (or at the start of the measure), with a note after it: the 32nd and 64th rests among the pieces that tile it are not drawn (the silence stays, in the
             sound too: no note changes). A silence with no note after it (the end of the measure) keeps its rests. */
          if (bounded) {
            const omit = inside.filter(r => r.display && !SIXTEENTH_OR_LONGER.has(r.display.type));
            if (omit.length) out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: [], rests: omit, omitOnly: true });
          }
        };
        if (R.sign(spans[0].on) > 0) consider(R.ZERO, spans[0].on, false, true);
        let cur = spans[0].off;
        for (let i = 1; i < spans.length; i++) {
          if (R.gt(spans[i].on, cur)) consider(cur, spans[i].on, true, true);
          if (R.gt(spans[i].off, cur)) cur = spans[i].off;
        }
        if (R.lt(cur, mDur.get(grp.m))) consider(cur, mDur.get(grp.m), true, mIndex.get(grp.m) < lastNoted.get(grp.staff));
      });
    });
    return out;
  }

  /* is this graph a transcription (a recording's heard notes turned into a score by audio-score.js)? */
  function isTranscription(g) { return !!(g && g.provenance && (g.provenance.sources || []).some(x => x.kind === 'audio-score')); }

  function closeSmallGaps(g) {
    try { return closeSmallGapsUnsafe(g); } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */ return { graph: g, changed: false, stats: { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) } }; }
  }
  function closeSmallGapsUnsafe(g) {
    const stats = { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0 };
    const gaps = smallGaps(g, stats);
    if (!gaps.length) return { graph: g, changed: false, stats: stats };
    const res = OPS.edit(g, d => {
      const gone = [];
      gaps.forEach(gp => {
        const add = R.sub(gp.b, gp.a);
        gp.notes.forEach(n => {
          const e = d.event(n.id);
          const nd = R.add(R.parse(e.dur), add);
          e.dur = R.format(nd);
          const disp = plainValue(nd);
          if (disp) { e.display = Object.assign({}, e.display || {}, { type: disp.type }); if (disp.dots) e.display.dots = disp.dots; else delete e.display.dots; stats.rewritten++; }
          d.markProv(e, ['rhythm'], 'repaired');
          stats.notesLengthened++;
        });
        gp.rests.forEach(r => gone.push(r.id));
        if (gp.omitOnly) { stats.omitted += gp.rests.length; return; }
        stats.gaps++;
        if (R.gt(add, R.parse(stats.longest))) stats.longest = R.format(add);
      });
      stats.restsRemoved = gone.length;
      d.removeEvents(gone);
      d.touch();
    }, { source: GAP_SOURCE });
    return { graph: res.graph, changed: true, stats: stats, issues: res.issues };
  }

  return Object.freeze({ GAP_LIMIT, GAP_SOURCE, plainValue, smallGaps, isTranscription, closeSmallGaps });
});
