/* ============================================================================
   PPP rec/app.js - the page's side of the recording conversion v2 (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6 and 10, phase G10a-4)

   Pure helpers the app uses around the conversion; no DOM, no Date, no Math.random. UMD (Node and page). The page loads this file lazily, after the stage
   modules (rec/index.js's header gives their order), the first time one of these is needed (a v2 conversion's flags, "Play as recorded"); it needs
   scoregraph/rational.js and time.js, which every page has, and nothing of the stages (hands are passed in).

     normalizeMode(v)             'v2' only for the exact string 'v2'; anything else is 'legacy' (the convention of PPP.arranger and PPP.fingering)
     flags(input)                 the bars PPP is not sure about -> {measures, why, detail, piece, thresholds}; see FLAGS below
     heardFromGraph(graph)        the heard performance a kept graph carries -> {notes: [{on, off, midi, vel}], pedals: [{on, off}], duration} (seconds), or null
     timeMap(graph, opts)         where the heard time t is in the written score: {kind: 'links'|'bars'|'none', us: [..], q: [..]} (microseconds, quarter notes from
                                  the first bar; piecewise linear between the pairs)
     qAtSeconds(map, sec)         the written position (quarters) of a heard time, or null for a map of kind 'none'
     playPlan(heard, opts)        "Play as recorded": [{t, off, midi, vel}] in seconds, sorted; a key held under the damper pedal sounds until the pedal lifts
     plausible(built, heard)      is a v2 conversion believable? -> {ok, why: null|'tempo'|'length', tempo, ratio}: the tempo in the range the rhythm controls accept, and the bars, as written
                                  (bars x beats a bar x 60 / tempo), about as long as the heard notes (see PLAUSIBLE below)

   FLAGS (G10 section 6.1, 8.1 and 24.11; the review screen's amber marker)
     A bar is flagged where a decision of the conversion was close, by what the stages report beside the graph:
       'grid'   S3 (rec/grid.js, result.gridPlan): a beat that holds two or more onsets and whose chosen grid (straight 16ths, triplet, 32nds, swing) has a posterior below
                GRID_UNSURE. The stage's own line is 0.6 (its report's lowConf); 0.9 flags the beats where a second reading was a real candidate.
       'hands'  S4 (rec/hands.js): HAND_BAR_MIN or more notes of the bar whose hand has a confidence below HAND_LOW (the stage's own lowConfidence line, 0.75). The
                result's handsReport only counts them, so the notes are asked of the same stage again (the heard notes, the same weights): a nearly identical
                answer, not the pipeline's own list.
     Not per bar (stated, not hidden): the metre. When the posterior of the metre the skeleton chose is below METRE_UNSURE the answer says so in `piece`.
     Not available: S6's rest decisions near their threshold (result.writerReport has counts only) and the pedal marks (the policy's own dropped list is kept in
     result.pedalReport). The thresholds are named constants; they were set on the teacher's piece (a handful of bars of 90 at 0.9 / 3 notes) and the stages' own lines.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'));
  else { const M = root.PPPScoreGraphModules || {}; root.PPPRecApp = factory(M.rational, M.time); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T) {
  'use strict';

  const VERSION = '0.1.0';
  const GRID_UNSURE = 0.9;        /* a beat's chosen grid kind with a posterior below this is "not sure" */
  const GRID_MIN_ONSETS = 2;      /* a beat with one onset is written the same on every grid: nothing to be unsure of */
  const HAND_LOW = 0.75;          /* rec/hands.js's own lowConfidence line */
  const HAND_BAR_MIN = 3;         /* notes below HAND_LOW in one bar for the bar to be flagged (1 flags 41% of the teacher's bars, 3 flags 7%) */
  const METRE_UNSURE = 0.6;       /* the chosen metre's posterior below this is said of the piece */
  const THRESHOLDS = Object.freeze({ GRID_UNSURE, GRID_MIN_ONSETS, HAND_LOW, HAND_BAR_MIN, METRE_UNSURE });
  const MIN_SOUND = 0.05;         /* a heard note that lasts less than this still sounds this long (seconds) */
  /* PLAUSIBLE (G10a-4 review, long recordings): past about 15.5 minutes the skeleton's tempo search left its range on the teacher's piece repeated (3/8 at 243, four times the bars) while the classic
     conversion stayed right; a result outside what a person could mean is not kept. The tempo range is the app's own (the rhythm controls' tempo box: 30 to 240); the written length, bars x beats a bar
     x 60 / tempo, must be 0.6 to 1.6 of the heard notes' span (first onset to last release), with two bars of slack either side for a short piece (a pickup, the last bar's silence). */
  const TEMPO_MIN = 30, TEMPO_MAX = 240, LENGTH_LOW = 0.6, LENGTH_HIGH = 1.6, LENGTH_SLACK_BARS = 2;

  const round = (x, k) => Math.round(x * k) / k;

  /* 'v2' only for the string 'v2'; every other value (a typo, null, 'V2', a stored 'g8') is 'legacy' */
  function normalizeMode(v) { return v === 'v2' ? 'v2' : 'legacy'; }

  /* the bar (0-based) a time falls in, from the start time of every bar */
  function barOfTime(barStarts, t) {
    let lo = 0, hi = barStarts.length - 1;
    if (hi < 0) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (barStarts[mid] <= t + 1e-6) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /* ------------------------------------------------------------ flags */
  function flags(input) {
    input = input || {};
    const th = Object.assign({}, THRESHOLDS, input.thresholds || {});
    const built = input.built || {};
    const barStarts = (built.stats && built.stats.barStarts) || [];
    const number = i => {
      const m = input.score && input.score.measures && input.score.measures[i];
      return m && m.number != null ? m.number : i + 1;
    };
    const why = {}, detail = {};
    const add = (bar, code, info) => {
      const m = number(bar);
      (why[m] = why[m] || []);
      if (why[m].indexOf(code) < 0) why[m].push(code);
      (detail[m] = detail[m] || {})[code] = info;
    };
    const out = { version: VERSION, measures: [], why: why, detail: detail, piece: null, thresholds: th, counts: { grid: 0, hands: 0 } };

    /* S3: the per-beat posterior of the grid */
    const plan = built.gridPlan && built.gridPlan.plan;
    const beats = built.recReport && built.recReport.beats;
    if (Array.isArray(plan) && Array.isArray(beats) && barStarts.length) {
      const byBar = new Map();
      plan.forEach(e => {
        if (!e || !(e.conf < th.GRID_UNSURE) || !(e.n >= th.GRID_MIN_ONSETS) || !(beats[e.beat] >= 0)) return;
        const bar = barOfTime(barStarts, beats[e.beat] + 1e-3);
        if (!byBar.has(bar)) byBar.set(bar, []);
        byBar.get(bar).push({ beat: e.beat, kind: e.kind, conf: round(e.conf, 1000) });
      });
      byBar.forEach((list, bar) => { add(bar, 'grid', list); out.counts.grid++; });
    }

    /* S4: the notes of the bar whose hand the stage was not sure of */
    const H = input.handsLib && input.handsLib.assign ? input.handsLib : null;
    const heard = input.heard && input.heard.notes;
    if (H && Array.isArray(heard) && heard.length && barStarts.length) {
      try {
        const notes = heard.slice().sort((a, b) => a.on - b.on || a.midi - b.midi).map(n => ({ midi: n.midi, on: n.on }));
        const r = H.assign(notes, { lowConf: th.HAND_LOW });
        const per = new Map();
        notes.forEach((n, i) => {
          const bar = barOfTime(barStarts, n.on);
          const c = per.get(bar) || { low: 0, n: 0 };
          c.n++;
          if (r.conf[i] < th.HAND_LOW && (r.staff[i] === 1 || r.staff[i] === 2)) c.low++;
          per.set(bar, c);
        });
        per.forEach((c, bar) => { if (c.low >= th.HAND_BAR_MIN) { add(bar, 'hands', { low: c.low, notes: c.n }); out.counts.hands++; } });
      } catch (e) { out.handsError = String(e && e.code || e && e.message || e); }
    }

    out.measures = Object.keys(why).map(Number).sort((a, b) => a - b);
    const sk = built.recReport;
    if (sk && sk.metre && sk.metrePosterior) {
      const p = sk.metrePosterior[sk.metre.key];
      if (typeof p === 'number' && p < th.METRE_UNSURE) {
        const alt = Object.keys(sk.metrePosterior).filter(k => k !== sk.metre.key).sort((a, b) => sk.metrePosterior[b] - sk.metrePosterior[a]).slice(0, 2);
        out.piece = { metre: sk.metre.key, posterior: round(p, 100), alternatives: alt };
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ the heard performance a graph keeps */
  function sourcePerf(graph) {
    const list = (graph && graph.performances) || [];
    return list.find(p => p && p.kind === 'source' && Array.isArray(p.notes) && p.notes.length) || null;
  }
  function heardFromGraph(graph) {
    const perf = sourcePerf(graph);
    if (!perf) return null;
    const notes = perf.notes.filter(n => n && isFinite(n.on) && isFinite(n.off) && n.off > n.on && isFinite(n.midi))
      .map(n => ({ on: n.on / 1e6, off: n.off / 1e6, midi: n.midi, vel: isFinite(n.vel) ? n.vel : 64 }))
      .sort((a, b) => a.on - b.on || a.midi - b.midi);
    if (!notes.length) return null;
    const pedals = (perf.pedals || []).filter(p => p && p.pedal === 'damper' && isFinite(p.on) && isFinite(p.off) && p.off > p.on)
      .map(p => ({ on: p.on / 1e6, off: p.off / 1e6 })).sort((a, b) => a.on - b.on);
    return { notes: notes, pedals: pedals, duration: notes.reduce((m, n) => Math.max(m, n.off), 0) };
  }

  /* ------------------------------------------------------------ the time map: heard time -> written position */
  function timeMap(graph, opts) {
    opts = opts || {};
    const none = { kind: 'none', us: [], q: [] };
    const perf = sourcePerf(graph);
    if (!perf || !T || !R) return none;
    const first = opts.firstMeasureStartQ || 0;
    const qOf = pos => R.toNumber(T.scorePos(graph, pos)) * 4 + first;     /* a whole note is 4 quarters */
    const pairs = [];
    /* the heard notes that became a head: each states where in the score its time is */
    const headEvent = new Map();
    (graph.parts || []).forEach(part => (part.events || []).forEach(ev => (ev.heads || []).forEach(h => headEvent.set(h.id, ev))));
    perf.notes.forEach(n => {
      const ev = n && n.link ? headEvent.get(n.link) : null;
      if (!ev || !isFinite(n.on)) return;
      try { pairs.push({ us: n.on, q: qOf(ev) }); } catch (e) { /* an event the time module cannot place is left out */ }
    });
    let kind = 'links';
    if (pairs.length < 2) {
      /* no links (a graph written without them): the bar anchors, bar-level */
      kind = 'bars';
      pairs.length = 0;
      (perf.anchors || []).forEach(a => {
        if (!a || !isFinite(a.us)) return;
        try { pairs.push({ us: a.us, q: qOf({ m: a.m, at: a.at }) }); } catch (e) { /* skip */ }
      });
    }
    if (pairs.length < 2) return none;
    /* a written position heard more than once (a chord's notes a frame apart, the two hands) is one pair, at the earliest time */
    const first1 = new Map();
    pairs.forEach(p => { const k = round(p.q, 1e6); const c = first1.get(k); if (!c || p.us < c.us) first1.set(k, p); });
    const uniq = Array.from(first1.values()).sort((a, b) => a.us - b.us || a.q - b.q);
    /* strictly increasing in both: the longest such run of pairs, so one note linked to the wrong head cannot run the map backwards */
    const keep = longestIncreasing(uniq.map(p => p.q));
    const us = [], q = [];
    keep.forEach(i => { if (!us.length || uniq[i].us > us[us.length - 1]) { us.push(uniq[i].us); q.push(uniq[i].q); } });
    return us.length >= 2 ? { kind: kind, us: us, q: q } : none;
  }
  /* indices of a longest strictly increasing subsequence of xs (patience sorting) */
  function longestIncreasing(xs) {
    const tails = [], prev = new Array(xs.length).fill(-1);
    xs.forEach((x, i) => {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[tails[mid]] < x) lo = mid + 1; else hi = mid; }
      if (lo > 0) prev[i] = tails[lo - 1];
      tails[lo] = i;
    });
    const out = [];
    for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
    return out.reverse();
  }
  function qAtSeconds(map, sec) {
    if (!map || map.kind === 'none' || !map.us.length) return null;
    const us = sec * 1e6, n = map.us.length;
    if (us <= map.us[0]) return map.q[0];
    if (us >= map.us[n - 1]) return map.q[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (map.us[mid] <= us) lo = mid; else hi = mid; }
    return map.q[lo] + (us - map.us[lo]) / (map.us[hi] - map.us[lo]) * (map.q[hi] - map.q[lo]);
  }

  /* ------------------------------------------------------------ "Play as recorded" */
  function playPlan(heard, opts) {
    opts = opts || {};
    if (!heard || !Array.isArray(heard.notes)) return [];
    const pedals = (heard.pedals || []).filter(p => p && isFinite(p.on) && isFinite(p.off) && p.off > p.on).slice().sort((a, b) => a.on - b.on);
    const pedalEnd = t => {
      for (let i = 0; i < pedals.length; i++) if (pedals[i].on <= t && t < pedals[i].off) return pedals[i].off;
      return null;
    };
    const from = opts.from || 0;
    /* a note that lasts no time is not in the performance layer either (buildGraph drops it): not played */
    return heard.notes.filter(n => n && isFinite(n.on) && isFinite(n.off) && isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && n.off > n.on && n.off > from).map(n => {
      const held = pedalEnd(n.off);
      const off = Math.max(n.on + MIN_SOUND, held != null && opts.pedal !== false ? held : n.off);
      return { t: n.on, off: off, midi: n.midi | 0, vel: isFinite(n.vel) ? Math.max(1, Math.min(127, Math.round(n.vel))) : 64 };
    }).sort((a, b) => a.t - b.t || a.midi - b.midi);
  }

  /* is a v2 conversion's result believable? built: audio-score.js's result (stats: bars, beatsPerBar, beatType, tempo in quarters a minute); heard: {notes: [{on, off}]} in seconds. A result with no
     statistics, or no notes to compare it with, is not judged (ok). */
  function plausible(built, heard) {
    const st = built && built.stats, notes = heard && heard.notes;
    const out = { ok: true, why: null, tempo: null, ratio: null };
    if (!st || !(st.bars > 0) || !(st.beatsPerBar > 0) || !(st.beatType > 0) || !isFinite(st.tempo)) return out;
    out.tempo = st.tempo;
    if (!(st.tempo >= TEMPO_MIN && st.tempo <= TEMPO_MAX)) { out.ok = false; out.why = 'tempo'; return out; }
    if (!Array.isArray(notes) || !notes.length) return out;
    let first = Infinity, last = -Infinity;
    notes.forEach(n => { if (n && isFinite(n.on) && isFinite(n.off)) { if (n.on < first) first = n.on; if (n.off > last) last = n.off; } });
    const span = last - first;
    if (!(span > 0)) return out;
    const barSec = st.beatsPerBar * (4 / st.beatType) * 60 / st.tempo, written = st.bars * barSec;
    out.ratio = round(written / span, 1000);
    if (written < LENGTH_LOW * span - LENGTH_SLACK_BARS * barSec || written > LENGTH_HIGH * span + LENGTH_SLACK_BARS * barSec) { out.ok = false; out.why = 'length'; }
    return out;
  }

  return Object.freeze({ VERSION, THRESHOLDS, GRID_UNSURE, GRID_MIN_ONSETS, HAND_LOW, HAND_BAR_MIN, METRE_UNSURE, normalizeMode, barOfTime, flags, heardFromGraph, timeMap, qAtSeconds, playPlan, plausible,
    PLAUSIBLE: Object.freeze({ TEMPO_MIN, TEMPO_MAX, LENGTH_LOW, LENGTH_HIGH, LENGTH_SLACK_BARS }) });
});
