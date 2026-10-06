/* ============================================================================
   PPP ledger-line statistics (docs/GOALS/G10 section 29, "G10a-6: automatic 8va/8vb for recordings")

     ledgerStats(graph, opts) -> { heads, bars, hist, staves, ge2, ge3, ge4, shifted, spans, per100 }
     ledgerHeads(graph, opts) -> [{ part, event, head, staff, staffNo, lines, side, shift }]      one record per head, the counts above are made of

   How many ledger lines the heads of a score are drawn on. A note on the fifth ledger line of a treble staff is as unreadable as a
   recording's high notes are, and an 8va/8vb line (scoregraph's `ottava` spanner) is the printed answer: the graph keeps the SOUNDING
   pitch, the engraver draws it an octave (two) away from where it sounds (scoregraph/pitch.js displayOctave, engrave/plan.js `written`).
   This reads the graph the way the engraver's plan does, with no engraver, so the benchmark's own adapter (tests/bench/node/notate.js)
   and the review tools can count it on the graph toMusicXml returned:

     - a head's position is its pitch less the octave line over it (a spanner covers a staff, or every staff of the part when it names none,
       from its start to just before its end), against the clef in force on its staff at its onset (G, F or C of any line, with the clef's
       own octave change);
     - a head needs `n` ledger lines when `n` ledger lines are drawn for it: the first one is the line a head sits ON (A5 above a treble
       staff, C4 under it, E2 under a bass one), one more for every second step further out - the count that realize/ottava.js's rule
       reads (tests/scoregraph/ledger-stats.test.js compares it with the engraver's own ledger lines, G4's `ledger` objects).

   opts   { window: [first, last]   measure indices (0-based, inclusive): only the heads of these bars,
            display: false          count where the notes SOUND (ignore every octave line): the score as it was before the line,
            grace: true             count grace notes too (off: a recording has none, the rule of realize/ottava.js ignores them) }

   Result: heads (all counted); hist [h0, h1, h2, h3, h4plus] heads needing 0, 1, 2, 3 and 4 or more ledger lines; staves {1: {heads, hist,
   above, below}, 2: ...} by the staff's place in its part (1 is the upper one; above / below are heads needing 3 or more on that side); ge2, ge3, ge4
   (heads needing at least that many); shifted (heads drawn under an octave line); spans (octave lines of the graph, or of the window's
   bars); per100 (ge3 per 100 heads, rounded to 2 places; null with no heads). Deterministic. Node and browser.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../rational.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.ledgerStats = factory(M.rational); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  /* the diatonic index (octave * 7 + step) the clef's own line stands for, and which line it is (1 = the bottom one) */
  const CLEF_REF = { G: { idx: 4 * 7 + 4, line: 2 }, F: { idx: 3 * 7 + 3, line: 4 }, C: { idx: 4 * 7, line: 3 } };

  /* the staff's bottom and top line, as diatonic indices of the pitch the staff shows (a clef's octave change moves what it shows) */
  function staffOf(clef) {
    const ref = CLEF_REF[clef && clef.sign] || CLEF_REF.G;
    const line = clef && Number.isInteger(clef.line) ? clef.line : ref.line;
    const bottom = ref.idx - 2 * (line - 1) + 7 * ((clef && clef.octave) || 0);
    return { bottom: bottom, top: bottom + 8 };
  }
  const linesOf = (idx, st) => (idx > st.top ? Math.floor((idx - st.top) / 2) : idx < st.bottom ? Math.floor((st.bottom - idx) / 2) : 0);

  /* every head of the graph (inside opts.window) with the ledger lines it is drawn on: [{part, event, head, staff, staffNo, lines, side: 'above'|'below', shift}] in the graph's order.
     `staff` is the staff's id, `staffNo` its place in the part (1 is the upper), `shift` the octave line over the head (0 for none; always 0 with opts.display === false) */
  function ledgerHeads(graph, opts) {
    opts = opts || {};
    const display = opts.display !== false;
    const win = Array.isArray(opts.window) ? opts.window : null;
    const out = [];
    if (!graph || !graph.timeline || !Array.isArray(graph.parts)) return out;
    const measures = graph.timeline.measures;
    const mIdx = new Map(measures.map((m, i) => [m.id, i]));
    const mStart = []; let acc = R.ZERO;
    measures.forEach(m => { mStart.push(acc); acc = R.add(acc, R.parse(m.dur)); });
    const inWin = i => !win || (i >= win[0] && i <= win[1]);
    const absOf = (m, at) => R.add(mStart[mIdx.get(m)], R.parse(at));
    graph.parts.forEach(part => {
      const staffNo = new Map((part.staves || []).map((s, i) => [s.id, i + 1]));
      const clefsOf = new Map();
      (part.clefs || []).forEach(c => {
        if (!mIdx.has(c.m)) return;
        if (!clefsOf.has(c.staff)) clefsOf.set(c.staff, []);
        clefsOf.get(c.staff).push({ t: absOf(c.m, c.at), c: c });
      });
      clefsOf.forEach(list => list.sort((a, b) => R.cmp(a.t, b.t)));
      const clefAt = (staff, t) => {
        const list = clefsOf.get(staff) || [];
        let cur = list.length ? list[0].c : { sign: 'G', line: 2 };
        for (const x of list) { if (R.le(x.t, t)) cur = x.c; else break; }
        return cur;
      };
      /* an octave line covers its staff (every staff of the part when it names none) from its start to just before its end (engrave/plan.js shiftOf) */
      const octaves = display ? (part.spanners || []).filter(s => s.type === 'ottava' && s.from && s.to && mIdx.has(s.from.m) && mIdx.has(s.to.m)).map(s => ({
        staff: s.staff || null, shift: s.shift || 0, a: absOf(s.from.m, s.from.at), z: absOf(s.to.m, s.to.at)
      })) : [];
      const shiftAt = (staff, t) => {
        let k = 0;
        octaves.forEach(o => { if ((!o.staff || o.staff === staff) && !R.lt(t, o.a) && R.lt(t, o.z)) k = o.shift; });
        return k;
      };
      (part.events || []).forEach(e => {
        if (e.kind !== 'note' || !e.heads || !mIdx.has(e.m) || !inWin(mIdx.get(e.m))) return;
        if (e.grace && !opts.grace) return;
        const t = absOf(e.m, e.at);
        e.heads.forEach(h => {
          if (!h.pitch || !(h.pitch.step in STEP_INDEX)) return;
          const staff = h.staff || e.staff;
          const shift = shiftAt(staff, t);
          const idx = (h.pitch.oct - shift) * 7 + STEP_INDEX[h.pitch.step];
          const st = staffOf(clefAt(staff, t));
          out.push({ part: part.id, event: e.id, head: h.id, staff: staff, staffNo: staffNo.get(staff) || 1, lines: linesOf(idx, st), side: idx > st.top ? 'above' : 'below', shift: shift });
        });
      });
    });
    return out;
  }

  function ledgerStats(graph, opts) {
    opts = opts || {};
    const win = Array.isArray(opts.window) ? opts.window : null;
    const out = { heads: 0, bars: 0, hist: [0, 0, 0, 0, 0], staves: {}, ge2: 0, ge3: 0, ge4: 0, shifted: 0, spans: 0, per100: null };
    if (!graph || !graph.timeline || !Array.isArray(graph.parts)) return out;
    const measures = graph.timeline.measures;
    out.bars = win ? Math.max(0, Math.min(win[1], measures.length - 1) - Math.max(win[0], 0) + 1) : measures.length;
    if (opts.display !== false) {
      const mIdx = new Map(measures.map((m, i) => [m.id, i]));
      const inWin = i => !win || (i >= win[0] && i <= win[1]);
      graph.parts.forEach(part => (part.spanners || []).forEach(s => {
        if (s.type === 'ottava' && s.from && s.to && mIdx.has(s.from.m) && mIdx.has(s.to.m) && (inWin(mIdx.get(s.from.m)) || inWin(mIdx.get(s.to.m)))) out.spans++;
      }));
    }
    ledgerHeads(graph, opts).forEach(x => {
      const S = out.staves[x.staffNo] || (out.staves[x.staffNo] = { heads: 0, hist: [0, 0, 0, 0, 0], above: 0, below: 0 });
      out.heads++; S.heads++;
      out.hist[Math.min(x.lines, 4)]++; S.hist[Math.min(x.lines, 4)]++;
      if (x.lines >= 2) out.ge2++;
      if (x.lines >= 3) { out.ge3++; S[x.side]++; }
      if (x.lines >= 4) out.ge4++;
      if (x.shift) out.shifted++;
    });
    out.per100 = out.heads ? Math.round(10000 * out.ge3 / out.heads) / 100 : null;
    return out;
  }

  return Object.freeze({ ledgerStats, ledgerHeads, staffOf, linesOf });
});
