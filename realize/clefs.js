/* ============================================================================
   The clef of the lower staff, per measure (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12, "Review page fidelity" and "G9e-lite").
   Moved here, unchanged, from review/lib/neutral.js so the review packets and the app choose clefs by the same rule.

   The realizer writes a bass clef on the left-hand staff and a treble clef on the right-hand staff for the whole piece. A piece whose left
   hand lies in the treble register (beyer/020, burgmuller25/016, czerny849/002, czerny599/027) then sits on many ledger lines under a bass
   clef, and the 8va/8vb pass (realize/ottava.js) answers with long lines over the staff. A printed edition changes the clef instead.

   The rule (per measure, from the lower staff's notes alone; a note's ledger lines are counted as realize/ottava.js counts them: diatonic
   steps beyond the staff's outer line, two steps to a line; treble staff E4..F5, bass staff G2..A3; a measure's cost in a clef is the SUM
   of its notes' lines):
     CLEF_SAVE_SHARE  0.5  a change needs a clear advantage: the other clef's cost is at least this share below the cost of the clef in force ...
     CLEF_SAVE_MIN    4    ... and at least this many ledger lines below it, over the measure. Otherwise the clef in force stays; the staff opens in
                           bass unless treble wins by the same margin.
     CLEF_MIN_RUN     2    a stretch in the other clef shorter than this many measures WITH lower-staff notes is folded into its neighbours
   A measure with no note on the staff keeps the clef in force; a change is only ever made at a barline.

   lowerClefs(measures, notes)  measures: any array with one entry per measure; notes: [{ m (1-based), staff (2 = lower), p ('C#4') }]
                                -> ['treble' | 'bass'] per measure
   applyLowerClefs(graph)       -> { graph, changed, clefs }: the graph with the lower staff's clefs written per measure (the graph itself
                                when bass all the way, or when the edit cannot be made); run it BEFORE addOttava, which reads the staff's clefs.
   UMD: Node require(), or a browser <script> after scoregraph/ops.js (root.PPPRealizeModules.clefs).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/ops.js'));
  else {
    const M = root.PPPRealizeModules = root.PPPRealizeModules || {};
    M.clefs = factory((root.PPPScoreGraphModules || {}).ops);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (O) {
  'use strict';

  const CLEF_SAVE_SHARE = 0.5, CLEF_SAVE_MIN = 4, CLEF_MIN_RUN = 2;
  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const CLEF_STAFF = { treble: [30, 38], bass: [18, 26] }; /* diatonic index (7 * octave + step) of the bottom and top line */
  function ledgerLines(p, clef) {
    const m = /^([A-G])(?:#{0,3}|b{0,3})(-?\d+)$/.exec(p || '');
    if (!m) return 0;
    const d = 7 * Number(m[2]) + STEP_INDEX[m[1]], lo = CLEF_STAFF[clef][0], hi = CLEF_STAFF[clef][1];
    return d > hi ? Math.floor((d - hi) / 2) : d < lo ? Math.floor((lo - d) / 2) : 0;
  }

  function lowerClefs(measures, notes) {
    const cost = measures.map(() => ({ treble: 0, bass: 0, n: 0 }));
    notes.forEach(x => {
      if (x.staff !== 2 || !cost[x.m - 1]) return;
      const c = cost[x.m - 1];
      c.n++; c.treble += ledgerLines(x.p, 'treble'); c.bass += ledgerLines(x.p, 'bass');
    });
    const idx = []; /* the measures that have lower-staff notes */
    cost.forEach((c, i) => { if (c.n) idx.push(i); });
    if (!idx.length) return measures.map(() => 'bass');
    const wins = (c, cur) => { const other = cur === 'bass' ? 'treble' : 'bass', gain = c[cur] - c[other]; return gain >= CLEF_SAVE_MIN && gain >= CLEF_SAVE_SHARE * c[cur]; };
    const seq = [];
    idx.forEach((i, k) => {
      const cur = k === 0 ? 'bass' : seq[k - 1];
      seq.push(wins(cost[i], cur) ? (cur === 'bass' ? 'treble' : 'bass') : cur);
    });
    /* fold a stretch shorter than CLEF_MIN_RUN into its neighbours (the shortest, earliest first, until none is left) */
    for (;;) {
      const runs = [];
      seq.forEach((c, k) => { if (runs.length && runs[runs.length - 1].clef === c) runs[runs.length - 1].len++; else runs.push({ clef: c, from: k, len: 1 }); });
      if (runs.length < 2) break;
      let pick = -1;
      runs.forEach((r, j) => { if (r.len < CLEF_MIN_RUN && (pick < 0 || r.len < runs[pick].len)) pick = j; });
      if (pick < 0) break;
      const r = runs[pick], to = pick === 0 ? runs[1].clef : runs[pick - 1].clef;
      for (let k = r.from; k < r.from + r.len; k++) seq[k] = to;
    }
    const out = new Array(measures.length);
    let cur = seq[0];
    for (let i = 0; i < measures.length; i++) {
      const k = idx.indexOf(i);
      if (k >= 0) cur = seq[k];
      out[i] = cur;
    }
    return out;
  }

  /* the graph's lower staff: the one written for the left hand (limb LH), else the second staff of the first part */
  function lowerStaff(part) {
    return part.staves.find(s => s.limb === 'LH') || (part.staves.length > 1 ? part.staves[1] : null);
  }

  function applyLowerClefs(g) {
    const none = { graph: g, changed: false, clefs: null };
    try {
      const part = g.parts[0];
      const st = part && lowerStaff(part);
      if (!st) return none;
      const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
      const notes = [];
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        (e.heads || []).forEach(h => {
          if ((h.staff || e.staff) !== st.id) return;
          const p = h.pitch;
          notes.push({ m: mIndex.get(e.m), staff: 2, p: p.step + p.oct });
        });
      });
      const seq = lowerClefs(g.timeline.measures, notes);
      if (seq.every(c => c === 'bass')) return none; /* the realizer's own clef (bass all the way) is already right */
      const res = O.edit(g, d => {
        const dp = d.doc.parts[0];
        dp.clefs.filter(c => c.staff === st.id).forEach(c => d.removeClef(dp, c.id));
        seq.forEach((c, i) => {
          if (i > 0 && seq[i - 1] === c) return;
          d.addClef(dp, { staff: st.id, m: g.timeline.measures[i].id, at: '0', sign: c === 'treble' ? 'G' : 'F' });
        });
      });
      return { graph: res.graph, changed: res.changed, clefs: seq };
    } catch (e) {
      return none; /* a clef is a nicety: the graph as it was is still right */
    }
  }

  return Object.freeze({ CLEF_SAVE_SHARE, CLEF_SAVE_MIN, CLEF_MIN_RUN, ledgerLines, lowerClefs, applyLowerClefs });
});
