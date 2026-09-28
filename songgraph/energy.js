/* ============================================================================
   PPP SongGraph — energy/density curve (docs/GOALS/G07 §5 "an energy/density curve")

   energyOf(g, opts) -> [{m, density, spread, thickness, dynamic, energy}], one entry per measure:
     density    note-onsets per beat in the measure (all parts/voices combined)
     spread     the widest simultaneous-register gap sounding in the measure, in semitones
                (max sounding MIDI − min sounding MIDI, sampled at every onset)
     thickness  the mean number of simultaneously-sounding notes at an onset (chord/texture size)
     dynamic    0..13 (pppppp..ffffff, schema.js DYNAMICS order) if the piece prints a dynamic in or
                before this measure, else null — real when present, not invented when absent
     energy     density, spread and thickness min-max normalized across the piece and averaged
                (dynamic folded in, weighted 2x, only for measures where it is known) — a relative
                curve for this piece, not a cross-piece loudness scale; usable by G7b as "where does
                this piece push and where does it relax," per the design doc's own phrasing.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/schema.js'), require('./util.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.energy = factory(SG.rational, SG.time, SG.schema, M.util);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, S, U) {
  'use strict';

  const DYNAMICS = S.DYNAMICS || ['pppppp', 'ppppp', 'pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff'];
  const dynIdx = v => { const i = DYNAMICS.indexOf(v); return i < 0 ? null : i; };

  function beatsOf(g, m) {
    let meter = null;
    try { meter = T.meterAt(g, m.id); } catch (e) { meter = null; }
    if (!meter) return R.toNumber(R.parse(m.dur)) * 4; /* whole notes -> quarters, if no meter is known */
    return T.groups(meter).length;
  }

  function measureDynamic(g) {
    /* the dynamic in force at or before each measure's start, across every part (the last one printed
       up to that point, MusicXML's own convention) */
    const marks = [];
    g.parts.forEach(part => (part.directions || []).forEach(d => { if (d.kind === 'dynamic') marks.push(d); }));
    const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    marks.sort((a, b) => (mIdx.get(a.m) - mIdx.get(b.m)) || R.cmp(R.parse(a.at), R.parse(b.at)));
    const out = new Array(g.timeline.measures.length).fill(null);
    let cur = null;
    let mi = 0;
    g.timeline.measures.forEach((m, i) => {
      while (mi < marks.length && mIdx.get(marks[mi].m) <= i) { cur = dynIdx(marks[mi].value); mi++; }
      out[i] = cur;
    });
    return out;
  }

  function energyOf(g, opts) {
    opts = opts || {};
    const notes = U.noteWindows(g, opts.part ? { part: opts.part } : undefined);
    const dyn = measureDynamic(g);
    const rows = g.timeline.measures.map((m, i) => {
      const start = T.measureStart(g, m.id), end = R.add(start, R.parse(m.dur));
      const here = U.overlap(notes, start, end);
      const onsets = new Map(); /* ScorePos string -> [midi] */
      here.forEach(n => {
        const w = R.ge(n.w0, start) ? n.w0 : start;
        const k = R.format(w);
        if (!onsets.has(k)) onsets.set(k, []);
        if (R.ge(n.w0, start)) onsets.get(k).push(n.midi);
      });
      const chordSizes = Array.from(onsets.values()).map(a => a.length).filter(n => n > 0);
      const beats = beatsOf(g, m) || 1;
      const density = chordSizes.length / beats;
      const midis = here.map(n => n.midi);
      const spread = midis.length ? Math.max.apply(null, midis) - Math.min.apply(null, midis) : 0;
      const thickness = chordSizes.length ? chordSizes.reduce((a, b) => a + b, 0) / chordSizes.length : 0;
      return { m: m.id, density: density, spread: spread, thickness: thickness, dynamic: dyn[i] };
    });
    /* min-max normalize density/spread/thickness across the piece; fold in dynamic (2x weight) only
       where known, so a piece with no printed dynamics still gets a real curve from the other three */
    const norm = key => {
      const vals = rows.map(r => r[key]);
      const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      return vals.map(v => (hi > lo ? (v - lo) / (hi - lo) : 0));
    };
    const nd = norm('density'), ns = norm('spread'), nt = norm('thickness');
    rows.forEach((r, i) => {
      let sum = nd[i] + ns[i] + nt[i], wt = 3;
      if (r.dynamic !== null) { sum += 2 * (r.dynamic / (DYNAMICS.length - 1)); wt += 2; }
      r.energy = Math.round((sum / wt) * 1000) / 1000;
      r.density = Math.round(r.density * 1000) / 1000;
      r.thickness = Math.round(r.thickness * 1000) / 1000;
    });
    return rows;
  }

  return Object.freeze({ energyOf });
});
