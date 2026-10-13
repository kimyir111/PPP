/* G11a-0: the canonical forms of what the practice engines produce, shared by the legacy recorder (tests/practice/record.js) and, later, the
   parity harness that holds the graph plan against it (G11a-2). One file for both sides is what makes "equal" mean the same thing: the
   recorder and the harness canonicalise through the same functions, so a difference is a difference of the plans and never of the form.

   A plain script that works in the page (it sets window.PPPPracticeCanon when added with addScriptTag) and in Node (module.exports).
   It reads no global of the app: every function takes the objects it needs. Floats are rounded to 1e-6, -0 is 0, and a digest is two 32-bit
   string hashes (cyrb64): a digest tells two dumps apart, it is not a security tool.

   Contents
     r6, digest                         rounding and hashing
     planOf(plan)                       a PianoScore.build plan: visits, strikes, ccs, beats, tempoMap, soundLengthQ     (G11 section 6.2 step 3)
     expectedOf(engine.expected)        what PerformanceEngine.begin put on its list: midi, hand, measure, tMs, arpeggio flag
     resultOf(engine.result())          the matcher's verdict object, in a fixed key order
     outcomeOf(engine, result)          that plus what result() leaves out: the live counters and every note's verdict and signed timing
     gatesOf(gates)                     follow mode's gates
     windows(score, count, seed)        the seeded four-bar loop windows (repeat ends and voltas first, then random)
     streamEvents(expected, kind)       the scripted performances: perfect, late80, wrong7, miss10, roll60, and roll300 (an arpeggiated chord's notes 300 ms late)
     replay(engine, events)             feed one scripted performance through a PerformanceEngine that has begun a run
     featuresOf(score)                  which notation the piece uses (to choose a small, representative subset)
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPPracticeCanon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r6 = x => {
    const v = Math.round(+x * 1e6) / 1e6;
    return v === 0 ? 0 : v;
  };

  /* cyrb64: two 32-bit halves of a string hash. */
  function cyrb64(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return [h2 >>> 0, h1 >>> 0];
  }
  const hex8 = n => n.toString(16).padStart(8, '0');
  function digest(str) {
    const a = cyrb64(str, 0);
    return hex8(a[0]) + hex8(a[1]);
  }
  const lcg = seed => {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  };

  const hand = h => (h == null ? '' : String(h));

  function planOf(plan) {
    const visits = plan.visits || [];
    const vIdx = new Map(visits.map((v, i) => [v, i]));
    return {
      visits: visits.map(v => [v.number, v.pass, r6(v.startQ), r6(v.lenQ), r6(v.soundQ)]),
      strikes: (plan.strikes || []).map(s => [typeof s.visit === 'number' ? s.visit : vIdx.get(s.visit), r6(s.q), r6(s.upQ), s.midi, s.vel, hand(s.hand), s.m]),
      ccs: (plan.ccs || []).map(c => [r6(c.q), c.cc, c.value]),
      beats: (plan.beats || []).map(b => [r6(b.q), b.accent ? 1 : 0]),
      tempoMap: (plan.tempoMap || []).map(t => [r6(t.q), r6(t.bpm)]),
      soundLengthQ: r6(plan.soundLengthQ || 0)
    };
  }

  function expectedOf(expected) {
    return (expected || []).map(x => [x.midi, hand(x.hand), x.m, r6(x.tMs), x.arp ? 1 : 0, r6(x.absQ)]);
  }

  const numericKeys = o => Object.keys(o || {}).sort((a, b) => (+a) - (+b) || (a < b ? -1 : a > b ? 1 : 0));
  function resultOf(res) {
    const c = res.counts || {};
    const byMeasure = {};
    numericKeys(res.byMeasure).forEach(k => {
      const b = res.byMeasure[k], hr = b.hands.r, hl = b.hands.l;
      byMeasure[k] = [b.total, b.matched, b.missed, b.wrong, b.extra, b.onTime, b.early, b.late, r6(b.timingAbsSum), b.timingCount, r6(b.accuracy),
        [hr.total, hr.matched, r6(hr.timingAbsSum), hr.timingCount], [hl.total, hl.matched, r6(hl.timingAbsSum), hl.timingCount]];
    });
    const group = g => { const o = {}; Object.keys(g || {}).sort().forEach(k => { o[k] = [g[k].total, g[k].matched, r6(g[k].accuracy)]; }); return o; };
    return {
      acc: [r6(res.accuracy), r6(res.noteAccuracy), r6(res.timingAccuracy), res.meanDeltaMs],
      counts: [c.expected, c.matched, c.missed, c.wrong, c.extra, c.onTime, c.early, c.late],
      byHand: group(res.byHand),
      bySection: group(res.bySection),
      byMeasure: byMeasure
    };
  }

  /* What result() does not keep: the engine's live counters and, per expected note, its verdict (o on the beat, e early, l late, m missed,
     - nothing yet) and its signed timing. A note nobody played closes as `missed` here and nowhere in result(), which counts every unmatched
     note as missed whatever its verdict. */
  const VERDICT = { on: 'o', early: 'e', late: 'l', missed: 'm' };
  function verdictsOf(engine) {
    const live = engine.live(), ex = engine.expected || [];
    return {
      live: [live.matched, live.seen, live.wrong, live.extra],
      v: ex.map(x => (x.verdict ? VERDICT[x.verdict] || '?' : '-')).join(''),
      d: digest(ex.map(x => (x.deltaMs == null ? '' : r6(x.deltaMs))).join(','))
    };
  }
  const outcomeOf = (engine, result) => ({ result: resultOf(result), verdicts: verdictsOf(engine) });

  function gatesOf(gates) {
    return (gates || []).map(g => [r6(g.b), g.m, g.rest ? 1 : 0, r6(g.dur || 0), (g.notes || []).map(n => [n.midi, hand(n.hand)])]);
  }

  /* Four-bar loop windows: the ones that END on a backward repeat and the ones that START inside a volta (up to four of each, spread over the
     piece), then seeded random starts, `count` in all (fewer when the piece is short). Measure NUMBERS, as the app's loop panel uses them. */
  function windows(score, count, seed) {
    const ms = score.measures || [];
    const n = ms.length;
    const span = 4;
    if (n <= span) return [];
    const last = n - span;                                       // the last start that still has four bars
    const picked = [];
    const seen = new Set();
    const add = (s, why) => {
      s = Math.max(0, Math.min(last, s));
      if (seen.has(s)) return false;
      seen.add(s); picked.push({ s: s, why: why });
      return true;
    };
    const spread = (list, k) => (list.length <= k ? list : Array.from({ length: k }, (_, i) => list[Math.floor(i * list.length / k)]));
    const ends = [], voltas = [];
    ms.forEach((m, i) => {
      const bar = m.bar || {};
      if (bar.repeatEnd) ends.push(i - (span - 1));
      if (bar.endingNos && bar.endingNos.length && (bar.endingType === 'start' || bar.ending)) voltas.push(i);
    });
    spread(ends, 4).forEach(s => add(s, 'repeat-end'));
    spread(voltas, 4).forEach(s => add(s, 'volta-start'));
    const rnd = lcg(seed);
    const want = Math.min(count, last + 1);
    let guard = 0;
    while (picked.length < want && guard++ < 1000) add(Math.floor(rnd() * (last + 1)), 'seeded');
    return picked.slice(0, Math.max(count, 0)).map(w => ({ from: ms[w.s].number, to: ms[w.s + span - 1].number, why: w.why }));
  }

  /* The scripted performances. `expected` is engine.expected after begin(); the answer is [{midi, t}] in time order. */
  function streamEvents(expected, kind) {
    const out = [];
    const list = expected || [];
    if (kind === 'perfect') list.forEach(x => out.push({ midi: x.midi, t: x.tMs }));
    else if (kind === 'late80') list.forEach(x => out.push({ midi: x.midi, t: x.tMs + 80 }));
    else if (kind === 'wrong7') list.forEach((x, i) => out.push({ midi: i % 7 === 6 ? Math.min(108, x.midi + 1) : x.midi, t: x.tMs }));
    else if (kind === 'roll300') list.forEach(x => out.push({ midi: x.midi, t: x.tMs + (x.arp ? 300 : 0) }));
    else if (kind === 'miss10') list.forEach((x, i) => { if (i % 10 !== 9) out.push({ midi: x.midi, t: x.tMs }); });
    else if (kind === 'roll60') {
      const groups = new Map();
      list.forEach(x => { const k = Math.round(x.tMs * 10); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
      groups.forEach(g => g.forEach((x, k) => out.push({ midi: x.midi, t: x.tMs + (g.length > 1 ? 60 * k / (g.length - 1) : 0) })));
    } else throw new Error('unknown stream ' + kind);
    return out.map((e, i) => ({ e: e, i: i })).sort((a, b) => a.e.t - b.e.t || a.e.midi - b.e.midi || a.i - b.i).map(o => o.e);
  }
  const STREAMS = ['perfect', 'late80', 'wrong7', 'miss10', 'roll60', 'roll300'];

  function replay(engine, events) {
    let last = 0;
    events.forEach(e => {
      engine.noteOn({ midi: e.midi, t: e.t, type: 'on' });
      engine.advanceTo(e.t);
      if (e.t > last) last = e.t;
    });
    engine.advanceTo(last + 1000);
    return engine.result();
  }

  /* What a piece uses, from the legacy Score (graces are not in it: toScore drops them). */
  function featuresOf(score) {
    const ms = score.measures || [], notes = score.notes || [];
    const f = {};
    if (ms.some(m => m.bar && m.bar.repeatEnd)) f.repeat = 1;
    if (ms.some(m => m.bar && m.bar.endingNos && m.bar.endingNos.length)) f.volta = 1;
    if ((score.pedals || []).some(p => p.type === 'change')) f.pedalChange = 1;
    if ((score.pedals || []).some(p => p.kind && p.kind !== 'damper')) f.otherPedal = 1;
    if ((score.pedals || []).length) f.pedal = 1;
    if ((score.tempos || []).length > 1) f.tempoChange = 1;
    if (notes.some(n => n.arp)) f.arpeggio = 1;
    if (notes.some(n => !n.rest && n.tieStart)) f.tie = 1;
    if (notes.some(n => !n.rest && n.soundingMidi != null && n.soundingMidi !== n.midi)) f.ottava = 1;
    if (ms.some(m => m.time && m.time.beatType >= 8 && m.time.beats % 3 === 0 && m.time.beats > 3)) f.compound = 1;
    if (ms.length && ms[0].lenQ < ((ms[0].time && ms[0].time.beats) || 4) * (4 / ((ms[0].time && ms[0].time.beatType) || 4)) - 1e-6) f.pickup = 1;
    if ((score.dynamics || []).length) f.dynamics = 1;
    if ((score.wedges || []).length) f.wedge = 1;
    if (notes.some(n => !n.rest && n.hand === 'x')) f.cue = 1;
    return f;
  }

  return { r6, digest, cyrb64, lcg, planOf, expectedOf, resultOf, verdictsOf, outcomeOf, gatesOf, windows, streamEvents, STREAMS, replay, featuresOf };
});
