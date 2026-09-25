/* ============================================================================
   PPP engrave — the practice map and the highlighter (docs/GOALS/G04 §8.4, §16.4-§16.6, B6, A31)

   The practice layer (playhead, current measure, loop box, note colours, MIDI
   feedback, seek by pointer) reads the score's geometry here and never lays
   anything out: a PracticeMap is derived once from an EngravedScore, and every
   question below is answered from it. Time is in quarter notes, as the app's
   practice layer counts it (Score measure startQ/lenQ, note b): a measure's
   start is the sum of the measures before it, in written order.

     createPracticeMap(engraved, plan)
       systems      [{index, box, band, measures}]
       measures     [{id, number, index, system, box, content, startQ, lenQ, columns: [{q, x}]}]
       event(id)    {id, m, staff, system, box, objects: [object ids], onsetKeys, startQ, endQ}
       byOnset(key) the events drawn at an App onsetKey ("m|b|staff", engrave/plan.js onsetKey)
       xAt(m, b)    the x of beat b (quarters) in measure m (id or index): between the columns
                    the notes stand on, then to the barline - the playhead and a seek
       locate(q)    {measure, system, x} of an absolute time
       hitTest(x, y) {system, measure, b, q, event|null}: what a pointer is over
       loopBoxes(a, b) one box per system for measures a..b
       legacyMap()  the shape the legacy ScoreView keeps in _map ({x, w, startQ, lenQ, pts: [[q, x]]}
                    per measure, plus its system), so the practice code can move over unchanged
     createHighlighter(map, opts)
       update(q)    -> {on: [event ids], off: [event ids], touched}: only what changed since the
                    last update. Forward play touches only the events whose state flips (B6: the
                    cost does not grow with the piece); a seek backwards re-derives the active set
                    from the events that can still be sounding (start > q - the longest duration).
       active()     the sounding events, in id order

   Nothing here reads the DOM, a clock or the layout functions.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'), require('./plan.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.practice = factory(root.PPPScoreGraph, M.plan);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, PL) {
  'use strict';

  const R = SG.rational;
  const q4 = s => { const r = R.parse(s); return r.n * 4 / r.d; };
  const union = (u, b) => (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice());
  const inside = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  /* the last index i with key(list[i]) <= v, or -1 */
  function lastAtMost(list, v, key) {
    let lo = 0, hi = list.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (key(list[mid]) <= v) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  const BAND = 1.5;   /* sp above the top line and below the bottom line: the band a measure wash covers */

  function createPracticeMap(eng, plan) {
    const planM = new Map(plan.measures.map((m, i) => [m.id, { m: m, i: i }]));
    /* the band in the system's own staff space (a system drawn smaller has a narrower band) */
    const sysOut = eng.systems.map(s => {
      const first = s.staves[0], last = s.staves[s.staves.length - 1], sp = s.space || 1;
      return { index: s.index, box: s.box.slice(), band: [first.y - BAND * sp, last.y + last.h + BAND * sp], measures: s.measures.slice(), staves: s.staves };
    });
    /* measures in written order, with their time in quarters */
    const measures = eng.measures.map(m => {
      const p = planM.get(m.id);
      const s = sysOut[m.system];
      const startQ = q4(p.m.start), lenQ = q4(p.m.dur);
      return { id: m.id, number: m.number, index: p.i, system: m.system, box: [m.x, s.band[0], m.x + m.w, s.band[1]], content: m.content.slice(),
        startQ: startQ, lenQ: lenQ, columns: m.columns.filter(c => c.time).map(c => ({ b: q4(c.at), q: startQ + q4(c.at), x: c.x })) };
    }).sort((a, b) => a.index - b.index);
    const mById = new Map(measures.map(m => [m.id, m]));
    const byIndex = new Map(measures.map(m => [m.index, m]));
    const bySystem = sysOut.map(s => s.measures.map(id => mById.get(id)));
    /* a measure by id, by its index in the plan (a window's map holds only the window's), or the object itself */
    const measureOf = m => (typeof m === 'number' ? byIndex.get(m) : m && typeof m === 'object' ? mById.get(m.id) : mById.get(m)) || null;

    /* events: every object that names one, grouped */
    const pe = new Map(plan.events.map(e => [e.id, e]));
    const events = new Map();
    eng.objects.forEach(o => {
      if (!o.event) return;
      let x = events.get(o.event);
      if (!x) {
        const e = pe.get(o.event);
        const m = e ? mById.get(e.m) : null;
        const startQ = m ? m.startQ + q4(e.at) : null;
        x = { id: o.event, m: e ? e.m : o.measure, staff: e ? e.staff : o.staffKey, system: o.system, box: null, objects: [], onsetKeys: [],
          startQ: startQ, endQ: startQ === null || !e ? null : startQ + (e.grace ? 0 : q4(e.dur)), rest: !!(e && e.kind === 'rest'), grace: !!(e && e.grace) };
        events.set(o.event, x);
      }
      x.objects.push(o.id);
      x.box = union(x.box, o.box);
    });
    /* onset keys: one per staff the event's heads are drawn on (the legacy renderer's data-onset) */
    const byOnset = new Map();
    events.forEach(x => {
      const e = pe.get(x.id);
      if (!e || x.grace) return;
      const staves = e.kind === 'rest' ? [e.staff] : [...new Set(e.heads.map(h => h.staff || e.staff))];
      staves.forEach(st => {
        const k = PL.onsetKey(plan, e, st);
        if (x.onsetKeys.indexOf(k) < 0) x.onsetKeys.push(k);
        if (!byOnset.has(k)) byOnset.set(k, []);
        byOnset.get(k).push(x.id);
      });
    });
    byOnset.forEach(list => list.sort());
    const byMeasure = new Map(measures.map(m => [m.id, []]));
    events.forEach(x => { if (byMeasure.has(x.m)) byMeasure.get(x.m).push(x); });

    function xAt(mRef, b) {
      const m = measureOf(mRef);
      if (!m) return null;
      const cols = m.columns;
      if (!cols.length) return m.content[0] + (m.content[1] - m.content[0]) * Math.max(0, Math.min(1, b / (m.lenQ || 1)));
      if (b <= cols[0].b) return cols[0].x;
      for (let i = 0; i + 1 < cols.length; i++) {
        const a = cols[i], c = cols[i + 1];
        if (b < c.b) return a.x + (c.x - a.x) * (b - a.b) / (c.b - a.b);
      }
      const a = cols[cols.length - 1];
      const end = m.content[1];
      if (m.lenQ <= a.b) return a.x;
      return a.x + (end - a.x) * Math.min(1, (b - a.b) / (m.lenQ - a.b));
    }
    function locate(q) {
      const i = Math.max(0, lastAtMost(measures, q, m => m.startQ));
      const m = measures[i];
      if (!m) return null;
      return { measure: m.id, system: m.system, x: xAt(m, Math.min(q - m.startQ, m.lenQ)) };
    }
    function hitTest(x, y) {
      /* the system whose band holds y; between two, the nearer */
      let best = null, bestD = Infinity;
      for (const s of sysOut) {
        const top = Math.min(s.band[0], s.box[1]), bot = Math.max(s.band[1], s.box[3]);
        const d = y < top ? top - y : y > bot ? y - bot : 0;
        if (d < bestD) { bestD = d; best = s; }
        if (d === 0) break;
      }
      if (!best) return null;
      const row = bySystem[best.index];
      const k = Math.max(0, lastAtMost(row, x, m => m.box[0]));
      const m = row[k];
      /* the beat: the nearest column, or the barline side */
      let b = 0;
      const cols = m.columns;
      if (cols.length) {
        let ci = 0;
        for (let i = 1; i < cols.length; i++) if (Math.abs(cols[i].x - x) < Math.abs(cols[ci].x - x)) ci = i;
        b = cols[ci].b;
      }
      let hit = null;
      for (const ev of byMeasure.get(m.id) || []) if (inside(ev.box, x, y) && (!hit || ev.id < hit)) hit = ev.id;
      return { system: best.index, measure: m.id, b: b, q: m.startQ + b, event: hit };
    }
    function loopBoxes(a, b) {
      const ma = measureOf(a), mb = measureOf(b);
      if (!ma || !mb) return [];
      const lo = Math.min(ma.index, mb.index), hi = Math.max(ma.index, mb.index);
      const out = [];
      for (let i = lo; i <= hi; i++) {
        const m = byIndex.get(i);
        if (!m) continue;
        const last = out[out.length - 1];
        if (last && last.system === m.system) last.box = union(last.box, m.box);
        else out.push({ system: m.system, box: m.box.slice() });
      }
      return out;
    }
    function legacyMap() {
      return measures.map(m => ({ id: m.id, number: m.number, system: m.system, x: m.box[0], w: m.box[2] - m.box[0], startQ: m.startQ, lenQ: m.lenQ,
        pts: m.columns.map(c => [c.q, c.x]) }));
    }

    return Object.freeze({
      systems: sysOut, measures: measures,
      event: id => events.get(id) || null, eventIds: () => [...events.keys()].sort(),
      byOnset: k => (byOnset.get(k) || []).slice(), onsetKeys: () => [...byOnset.keys()].sort(),
      measure: measureOf, xAt: xAt, locate: locate, hitTest: hitTest, loopBoxes: loopBoxes, legacyMap: legacyMap,
      /* the events the highlighter follows: sounding notes (grace notes take no time; rests are not lit) */
      timed: opts => {
        const rests = opts && opts.rests;
        const out = [];
        events.forEach(x => { if (x.startQ !== null && !x.grace && (rests || !x.rest)) out.push({ id: x.id, start: x.startQ, end: x.endQ }); });
        return out;
      }
    });
  }

  function createHighlighter(map, opts) {
    const evs = map.timed(opts);
    const byStart = evs.slice().sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
    const byEnd = evs.slice().sort((a, b) => a.end - b.end || (a.id < b.id ? -1 : 1));
    const longest = evs.reduce((m, e) => Math.max(m, e.end - e.start), 0);
    const active = new Set();
    let t = -Infinity, ps = 0, pe = 0;
    const stats = { updates: 0, touched: 0, rebuilds: 0, visited: 0 };

    function update(q) {
      stats.updates++;
      const on = [], off = [];
      if (q < t) {
        /* backwards: the active set at q, from the events that can still be sounding; only the difference is touched */
        stats.rebuilds++;
        const from = lastAtMost(byStart, q - longest - 1e-9, e => e.start) + 1;
        const now = new Set();
        let i = from;
        for (; i < byStart.length && byStart[i].start <= q; i++) { stats.visited++; if (byStart[i].end > q) now.add(byStart[i].id); }
        ps = i;
        pe = lastAtMost(byEnd, q, e => e.end) + 1;
        active.forEach(id => { if (!now.has(id)) off.push(id); });
        now.forEach(id => { if (!active.has(id)) on.push(id); });
        off.forEach(id => active.delete(id));
        on.forEach(id => active.add(id));
      } else {
        for (; ps < byStart.length && byStart[ps].start <= q; ps++) {
          stats.visited++;
          const e = byStart[ps];
          if (e.end > q && !active.has(e.id)) { active.add(e.id); on.push(e.id); }
        }
        for (; pe < byEnd.length && byEnd[pe].end <= q; pe++) {
          stats.visited++;
          const e = byEnd[pe];
          if (active.has(e.id)) { active.delete(e.id); off.push(e.id); }
        }
      }
      t = q;
      on.sort(); off.sort();
      stats.touched += on.length + off.length;
      return { on: on, off: off, touched: on.length + off.length };
    }
    return { update: update, active: () => [...active].sort(), stats: stats, size: evs.length };
  }

  return Object.freeze({ createPracticeMap, createHighlighter });
});
