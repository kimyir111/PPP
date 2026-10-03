/* ============================================================================
   PPP rec/pedal.js - stage S9 of the recording conversion v2: pedal marks (docs/GOALS/G10_AUDIO_TO_SCORE.md sections
   6 and 8: "S9 pedal marks"; G10a-3, lane B)

     analyse(pedals, notes, opts) -> {
       spans:   [{ on, off, alive, atEnd, share, snapped }]   the pedal spans to write as marks, seconds, sorted, disjoint
       dropped: [{ on, off, why }]                           why: 'invalid' | 'short' | 'nothing' | 'weak'
       report:  { version, heard, kept, merged, dropped: {invalid, short, nothing, weak}, perMinute }
     }

   pedals: [{ on, off }] seconds, as the helper ensemble heard them (the browser's Onsets & Frames model has none: no
   pedals, no marks - nothing is ever invented). notes: [{ on, off }] seconds, the heard notes. opts: { minSpan, tol,
   minAt, minShare } (the constants below).

   THE POLICY (issue 17: a pedal the performer never played blurs the practice audio, and the helper's pedal is a guess:
   five of the six rendered fixtures, which have no pedal at all, got one from TransKun and Kong): a heard pedal is
   written as a mark only when the notes agree with it. A pedal that sustains something ends with the sound: the heard
   releases of the notes it held coincide with its end, within the helper's own offset error (|p90| 191 ms, G10
   section 1 E8). So a span is written when
     - it is a pedal: at least MIN_SPAN seconds (0.4: a change shorter than a quarter at 150 a minute is a flutter; the humanizer's
       own floor is 0.25 s, its pedals' tenth percentile is 0.9 s, and the six rendered fixtures' false spans have a median of
       0.35 s and a tenth of them are shorter than 0.1 s),
     - it holds something: notes sound inside it,
     - its end is confirmed: at least MIN_AT of the notes alive in it, and MIN_SHARE of them, are released within TOL of
       the span's end; the mark then goes where those releases are (their median: a pedal edge is less certain than the
       releases it sustained to), never earlier than the span's own start plus MIN_SPAN.
   Overlapping spans are one pedal (a pedal is down or up). The heard pedal always stays in the performance layer
   (audio-score.js buildGraph writes every span heard, whatever this decides).

   What the evidence does and does not say: the humanizer's cover-pedal family makes the notes sustain to the pedal, as a
   physical pedal does, so a real pedal passes and an invented one mostly does not (G10 section 22: false marks per
   minute and pedal F1 on the invented-pedal family, and the replay fixtures). A recording whose notes are not extended by
   the pedal, with a pedal the model heard anyway, gets no marks: the safe side of a mark that is optional on the page.

   Pure and deterministic: no Date, no Math.random. Node: require('./rec/pedal.js'); browser: rec/pedal.js (window.PPPRecPedal,
   registered as PPPRecModules.pedal).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.pedal = root.PPPRecPedal = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'pedal/1';
  const C = Object.freeze({ MIN_SPAN: 0.4, TOL: 0.2, MIN_AT: 2, MIN_SHARE: 0.2 });
  const round = x => Math.round(x * 1e6) / 1e6;

  function analyse(pedals, notes, opts) {
    opts = opts || {};
    const minSpan = opts.minSpan != null ? +opts.minSpan : C.MIN_SPAN;
    const tol = opts.tol != null ? +opts.tol : C.TOL;
    const minAt = opts.minAt != null ? +opts.minAt : C.MIN_AT;
    const minShare = opts.minShare != null ? +opts.minShare : C.MIN_SHARE;
    const dropped = [];
    const why = { invalid: 0, short: 0, nothing: 0, weak: 0 };
    const drop = (p, w) => { why[w]++; dropped.push({ on: p.on, off: p.off, why: w }); };
    const ns = (notes || []).filter(n => n && isFinite(n.on) && isFinite(n.off) && n.off > n.on);
    const lastOff = ns.reduce((m, n) => Math.max(m, n.off), 0);
    /* the spans as a pedal can be: a number, a start before its end (a press the model never heard released lasts to the last note);
       overlapping spans are one pedal */
    let spans = [];
    (pedals || []).forEach(p => {
      const off = p && +p.off === Infinity ? lastOff : p ? +p.off : NaN;
      if (!p || !(isFinite(p.on) && isFinite(off)) || !(off > +p.on)) { drop(p || {}, 'invalid'); return; }
      spans.push({ on: +p.on, off: off });
    });
    spans.sort((a, b) => a.on - b.on || a.off - b.off);
    const heard = spans.length;
    const merged = [];
    spans.forEach(s => {
      const last = merged[merged.length - 1];
      if (last && s.on < last.off) last.off = Math.max(last.off, s.off); else merged.push({ on: s.on, off: s.off });
    });
    const unions = spans.length - merged.length;
    const kept = [];
    merged.forEach((s, i) => {
      if (s.off - s.on < minSpan) { drop(s, 'short'); return; }
      const alive = ns.filter(n => n.on < s.off && n.off > s.on);
      if (!alive.length) { drop(s, 'nothing'); return; }
      const ends = alive.filter(n => Math.abs(n.off - s.off) <= tol).map(n => n.off).sort((a, b) => a - b);
      const share = ends.length / alive.length;
      if (ends.length < minAt || share < minShare) { drop(s, 'weak'); return; }
      /* the mark goes where the releases it sustained to are (their lower median), inside the span's own bounds */
      let off = ends[Math.floor((ends.length - 1) / 2)];
      const next = merged[i + 1];
      if (off < s.on + minSpan) off = s.off;
      if (next && off > next.on) off = Math.min(off, next.on);
      if (!(off > s.on)) off = s.off;
      kept.push({ on: round(s.on), off: round(off), alive: alive.length, atEnd: ends.length, share: round(share), snapped: Math.abs(off - s.off) > 1e-9 });
    });
    let minutes = 0;
    if (ns.length) minutes = (Math.max.apply(null, ns.map(n => n.off)) - Math.min.apply(null, ns.map(n => n.on))) / 60;
    return { spans: kept, dropped: dropped,
      report: { version: VERSION, heard: heard, kept: kept.length, merged: unions, dropped: why, perMinute: minutes > 0 ? round(kept.length / minutes) : null } };
  }

  return Object.freeze({ VERSION, C, analyse });
});
