/* ============================================================================
   PPP notation checker (docs/GOALS/G09 section 12, "Recording durations from onsets (root cause of the wedged rests)")

     checkGraph(graph, opts)  -> report      a ScoreGraph (the saved transcription, the review screen's graph, a copy's graph)
     checkScore(score, opts)  -> report      the app's own Score (state.score: what the page draws and plays: notes with b, dur, type, dots, tm)
     checkEvents(list, bars, opts)           the common core: per voice and bar, one list of events

   It scans EVERY bar and voice and reports, per class, a count and the bar numbers (a bar number is 1-based). Nothing here is "fixed": it only looks, so the proof does not depend on
   anybody finding a bar by hand. The classes are what a piano teacher flags in the rests and the rhythm of a recording:

     1  rest-between-notes   a silence (rests that follow each other, across barlines too) SHORTER than REST_MIN (an eighth) with a note of the voice before AND after it
     2  tiny-rest            any rest shorter than a 16th
     3  rest-run             rests that follow each other in a voice and bar and are not the standard tiling of their silence (scoregraph/gaps.js tile): two rests where one is written
     4  dotted-small-rest    a dotted rest shorter than a dotted eighth
     5  bar-sum              a voice-bar whose drawn values (value times the tuplet ratio) are not the bar, or an event that does not start where the one before ended (hole, overlap)
     6  value-vs-length      a note or rest whose drawn value differs from its exact length
     7  tuplet               a tuplet that is incomplete (its events are not one whole beat), is not on a beat, or a bracket on a beat that is not a triplet (not a 3:2 over a third / two thirds)
     8  double-strike        the same pitch struck at the same time by both hands
     9  rest-in-run          (information, a teacher's eye: the rule allows an eighth rest) a silence shorter than a quarter whose neighbours are both eighth or shorter notes in one bar
     10 long-tie-chain       (information) a note written as three or more tied pieces

   Classes 1 to 7 are the acceptance classes (0 on a recording written by audio-score.js with exactBars); 8 is a fact about the heard notes; 9 and 10 are information.
   REST_MIN is one named constant: 1/8 of a whole note (an eighth), `opts.restMin` (a whole-note fraction, 0.125) changes it. Node and browser. Never throws on a graph it does not
   understand: that voice-bar is listed under class 5.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  let gaps = null, rational = null;
  if (typeof module === 'object' && module.exports) { try { gaps = require('../gaps.js'); } catch (e) { gaps = null; } try { rational = require('../rational.js'); } catch (e) { rational = null; } }
  else { const M = root.PPPScoreGraphModules || {}; gaps = M.gaps || null; rational = M.rational || null; }
  const api = factory(gaps, rational);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.notationCheck = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GAPS, R) {
  'use strict';

  const U = 192;                                            /* units in a whole note (a 64th is 3, a triplet 64th 2) */
  const REST_MIN = 1 / 8;                                   /* a silence shorter than this (a whole-note fraction: an eighth) is not a rest; a recording writes none */
  const BASE = { breve: 2 * U, whole: U, half: U / 2, quarter: U / 4, eighth: U / 8, '16th': U / 16, '32nd': U / 32, '64th': U / 64, '128th': U / 128 };
  const CLASS_NAMES = {
    1: 'rest between notes shorter than REST_MIN', 2: 'rest shorter than a 16th', 3: 'rests in a row that are not the standard tiling', 4: 'dotted rest shorter than a dotted eighth',
    5: 'voice-bar does not add up (or a hole / overlap)', 6: 'drawn value differs from the exact length', 7: 'incomplete tuplet or bracket on a beat that is not a triplet',
    8: 'same pitch struck by both hands at once', 9: 'rest inside a run of eighth/16th notes (information)', 10: 'note tied in three or more pieces (information)'
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const baseOf = (type, dots) => (BASE[type] === undefined ? null : BASE[type] * (2 - Math.pow(2, -(dots || 0))));

  /* ---- the common core.
     list: [{hand: 1|2, voice, bar (1-based), at, dur, kind: 'note'|'rest', type, dots, tm: {a, n}|null, tup: group id|null, midi: [..], tieStart, tieStop, measureRest, grace}] in units (1/192 whole), `at` in the bar.
     barLen[i] is the length of bar i + 1 in units. Returns {classes: {1: {count, bars: [..], items: [..]}, ...}, voiceBars, notes, rests} */
  function checkEvents(list, barLen, opts) {
    opts = opts || {};
    const restMin = Math.round((opts.restMin !== undefined ? opts.restMin : REST_MIN) * U);
    const classes = {};
    for (let c = 1; c <= 10; c++) classes[c] = { name: CLASS_NAMES[c], count: 0, bars: [], items: [] };
    const hit = (c, bar, hand, info) => {
      const k = classes[c];
      k.count++;
      if (!k.bars.some(x => x.bar === bar && x.hand === hand)) k.bars.push({ bar: bar, hand: hand === 1 ? 'RH' : 'LH' });
      if (k.items.length < 60) k.items.push(Object.assign({ bar: bar, hand: hand === 1 ? 'RH' : 'LH' }, info));
    };
    const handName = h => (h === 1 ? 'RH' : 'LH');
    const barStart = [0];
    barLen.forEach(l => barStart.push(barStart[barStart.length - 1] + l));
    const ev = list.filter(e => !e.grace && (e.kind === 'note' || e.kind === 'rest'));
    ev.forEach(e => { e.abs = barStart[e.bar - 1] + e.at; });
    const out = { classes: classes, voiceBars: 0, notes: 0, rests: 0 };
    out.notes = ev.filter(e => e.kind === 'note').length; out.rests = ev.filter(e => e.kind === 'rest').length;
    const drawnOf = e => { const b = baseOf(e.type, e.dots); return b === null ? null : (e.tm ? b * e.tm.n / e.tm.a : b); };

    /* 2, 4, 6: per event */
    ev.forEach(e => {
      const d = drawnOf(e);
      if (e.kind === 'rest' && !e.measureRest) {
        if (e.dur < U / 16 - 1e-6) hit(2, e.bar, e.hand, { at: e.at / U, dur: e.dur / U, type: e.type });
        if (e.dots > 0 && BASE[e.type] !== undefined && BASE[e.type] < U / 8 - 1e-6) hit(4, e.bar, e.hand, { at: e.at / U, type: e.type + ' dotted' });
      }
      if (d !== null && !e.measureRest && !near(d, e.dur)) hit(6, e.bar, e.hand, { at: e.at / U, kind: e.kind, drawn: d / U, dur: e.dur / U, type: e.type + (e.dots ? '.' : '') });
    });

    /* per voice and bar: 5 (adds up, no hole or overlap) and 3 (rest runs) */
    const byVB = new Map(), byVoice = new Map();
    ev.forEach(e => {
      const k = e.hand + '|' + e.voice + '|' + e.bar;
      if (!byVB.has(k)) byVB.set(k, []);
      byVB.get(k).push(e);
      const kv = e.hand + '|' + e.voice;
      if (!byVoice.has(kv)) byVoice.set(kv, []);
      byVoice.get(kv).push(e);
    });
    byVB.forEach(evs => {
      out.voiceBars++;
      evs.sort((a, b) => a.at - b.at);
      const bar = evs[0].bar, hand = evs[0].hand, len = barLen[bar - 1];
      let cur = 0, sum = 0, why = null;
      evs.forEach(e => {
        const d = drawnOf(e);
        if (d === null) { why = why || 'a value that is not known (' + e.type + ')'; return; }
        sum += e.measureRest ? len : d;
        if (!near(e.at, cur)) why = why || (e.at > cur ? 'a hole of ' + ((e.at - cur) / U).toFixed(4) + ' at ' + (cur / U).toFixed(4) : 'an overlap at ' + (e.at / U).toFixed(4));
        cur = e.at + e.dur;
      });
      if (!near(sum, len)) why = why || 'the drawn values are ' + (sum / U).toFixed(4) + ' of a whole note, the bar is ' + (len / U).toFixed(4);
      if (!near(cur, len)) why = why || 'the events end at ' + (cur / U).toFixed(4) + ', the bar at ' + (len / U).toFixed(4);
      if (why) hit(5, bar, hand, { why: why });
      /* 3: rests that follow each other, not the standard tiling (only on the 32nd grid; a tuplet silence is left to the tuplet rule) */
      if (GAPS && GAPS.tile) {
        let run = [];
        const flush = () => {
          if (run.length >= 2 && run.every(r => !r.tm && !r.measureRest)) {
            const a = run[0].at, b = run[run.length - 1].at + run[run.length - 1].dur;
            if (Math.abs(a / 6 - Math.round(a / 6)) < 1e-6 && Math.abs(b / 6 - Math.round(b / 6)) < 1e-6 && len % 6 === 0) {
              const exp = GAPS.tile(Math.round(a / 6), Math.round(b / 6), 8, false, len / 6, a === 0 && b === len);
              const same = exp.length === run.length && exp.every((p, i) => Math.abs(p.at * 6 - run[i].at) < 1e-6 && Math.abs(p.len * 6 - run[i].dur) < 1e-6);
              if (!same) hit(3, bar, hand, { at: a / U, pieces: run.map(r => r.type + (r.dots ? '.' : '')).join('+') });
            }
          }
          run = [];
        };
        evs.forEach(e => { if (e.kind !== 'rest') { flush(); return; } const p = run[run.length - 1]; if (p && !near(p.at + p.dur, e.at)) flush(); run.push(e); });
        flush();
      }
    });

    /* 1 and 9: silences (rests that follow each other, across barlines) between two notes of one voice */
    byVoice.forEach(evs => {
      evs.sort((a, b) => a.abs - b.abs || (a.kind === 'rest' ? -1 : 1));
      for (let i = 0; i < evs.length; i++) {
        if (evs[i].kind !== 'rest') continue;
        let j = i, end = evs[i].abs + evs[i].dur;
        while (j + 1 < evs.length && evs[j + 1].kind === 'rest' && near(evs[j + 1].abs, end)) { j++; end = evs[j].abs + evs[j].dur; }
        const before = i > 0 ? evs[i - 1] : null, after = j + 1 < evs.length ? evs[j + 1] : null;
        const sil = end - evs[i].abs;
        const hasBefore = before && before.kind === 'note' && near(before.abs + before.dur, evs[i].abs);
        const hasAfter = after && after.kind === 'note' && near(after.abs, end);
        if (hasBefore && hasAfter) {
          if (sil < restMin - 1e-6) hit(1, evs[i].bar, evs[i].hand, { at: evs[i].at / U, silence: sil / U, rests: evs.slice(i, j + 1).map(r => r.type + (r.dots ? '.' : '')).join('+') });
          const bb = baseOf(before.type, before.dots), ba = baseOf(after.type, after.dots);
          if (sil < U / 4 - 1e-6 && bb !== null && ba !== null && bb <= U / 8 + 1e-6 && ba <= U / 8 + 1e-6 && before.bar === after.bar && before.bar === evs[i].bar)
            hit(9, evs[i].bar, evs[i].hand, { at: evs[i].at / U, silence: sil / U, between: before.type + ' and ' + after.type });
        }
        i = j;
      }
    });

    /* 7: tuplets. A group is complete when its events are contiguous, start on a beat and last whole beats; a 3:2 bracket holds thirds of the beat (an eighth or quarter value drawn under the bracket) */
    const groups = new Map();
    ev.forEach(e => { if (e.tup !== null && e.tup !== undefined) { if (!groups.has(e.tup)) groups.set(e.tup, []); groups.get(e.tup).push(e); } });
    groups.forEach(g => {
      g.sort((a, b) => a.abs - b.abs);
      const first = g[0], ratio = first.tm || { a: 3, n: 2 };
      const total = g.reduce((s, e) => s + e.dur, 0), contiguous = g.every((e, i) => i === 0 || near(g[i - 1].abs + g[i - 1].dur, e.abs));
      const beat = U / 4, onBeat = near(((first.at % beat) + beat) % beat, 0) || near(((first.at % beat) + beat) % beat, beat);
      const drawnSum = g.reduce((s, e) => s + (baseOf(e.type, e.dots) || 0), 0);
      let why = null;
      if (!contiguous) why = 'the events of the bracket are not contiguous';
      else if (ratio.a !== 3 || ratio.n !== 2) why = 'ratio ' + ratio.a + ':' + ratio.n + ' is not a triplet';
      else if (!near(total / beat, Math.round(total / beat)) || total < beat - 1e-6) why = 'the bracket holds ' + (total / beat).toFixed(3) + ' beats (incomplete)';
      else if (!onBeat) why = 'the bracket does not start on a beat';
      else if (!near(drawnSum * 2 / 3, total)) why = 'the drawn values under the bracket are not 3:2 of what they last';
      if (why) hit(7, first.bar, first.hand, { at: first.at / U, why: why });
    });
    /* a tuplet value (a third of a beat, a ratio on the event) that is in no group at all */
    ev.forEach(e => { if (e.tm && (e.tup === null || e.tup === undefined)) hit(7, e.bar, e.hand, { at: e.at / U, why: 'a tuplet value with no bracket' }); });

    /* 8: the same pitch struck by both hands at the same time */
    const strikes = new Map();
    ev.forEach(e => { if (e.kind === 'note' && !e.tieStop) (e.midi || []).forEach(m => { const k = Math.round(e.abs * 1000) + '|' + m; if (!strikes.has(k)) strikes.set(k, new Set()); strikes.get(k).add(e.hand); }); });
    strikes.forEach((hands, k) => {
      if (hands.size < 2) return;
      const abs = +k.split('|')[0] / 1000;
      let bar = barStart.findIndex((s, i) => abs >= s && abs < (barStart[i + 1] === undefined ? Infinity : barStart[i + 1])) + 1;
      hit(8, bar, 1, { midi: +k.split('|')[1], at: (abs - barStart[bar - 1]) / U });
    });

    /* 10: a note written as three or more tied pieces */
    byVoice.forEach(evs => {
      evs.sort((a, b) => a.abs - b.abs);
      let chain = 0, startAt = null;
      evs.forEach(e => {
        if (e.kind !== 'note') { chain = 0; return; }
        if (e.tieStop) chain++; else { chain = 1; startAt = e; }
        if (chain === 3 && startAt) hit(10, startAt.bar, startAt.hand, { at: startAt.at / U });
      });
    });

    Object.keys(classes).forEach(c => classes[c].bars.sort((a, b) => a.bar - b.bar));
    return out;
  }

  /* ---- adapters */
  function parseRat(s) {
    if (typeof s === 'number') return s;
    const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s));
    return m ? (+m[1]) / (m[2] ? +m[2] : 1) : NaN;
  }
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midiOf = p => 12 * (p.oct + 1) + STEP[p.step] + (p.alter || 0);

  function graphEvents(g) {
    const list = [];
    const measures = g.timeline.measures;
    const mIdx = new Map(measures.map((m, i) => [m.id, i]));
    const barLen = measures.map(m => Math.round(parseRat(m.dur) * U));
    (g.parts || []).forEach(part => {
      const limb = new Map((part.staves || []).map((s, i) => [s.id, s.limb === 'LH' ? 2 : s.limb === 'RH' ? 1 : (i === 0 ? 1 : 2)]));
      const tupById = new Map(part.spanners.filter(s => s.type === 'tuplet').map(t => [t.id, t]));
      const tupsOf = new Map();
      part.spanners.filter(s => s.type === 'tuplet').forEach(t => t.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(t); }));
      const tieStart = new Set(), tieStop = new Set();
      part.spanners.filter(s => s.type === 'tie').forEach(t => { if (t.from) tieStart.add(t.from); if (t.to) tieStop.add(t.to); });
      part.events.forEach(e => {
        if (e.kind !== 'note' && e.kind !== 'rest') return;
        const bar = mIdx.get(e.m);
        if (bar === undefined) return;
        const tl = tupsOf.get(e.id) || [];
        let t = tl.find(x => !tl.some(u => u !== x && u.parent === x.id)) || tl[0], a = 1, n = 1, guard = 0;
        const innermost = t;
        while (t && guard++ < 8) { a *= t.actual; n *= t.normal; t = t.parent ? tupById.get(t.parent) : null; }
        const heads = e.heads || [];
        list.push({
          hand: limb.get(e.staff) || 1, voice: e.voice, bar: bar + 1, at: Math.round(parseRat(e.at) * U * 1000) / 1000, dur: parseRat(e.dur) * U, kind: e.kind,
          type: e.display && e.display.type, dots: (e.display && e.display.dots) || 0, tm: innermost ? { a: a, n: n } : null, tup: innermost ? innermost.id : null,
          midi: heads.map(h => midiOf(h.pitch)), tieStart: heads.some(h => tieStart.has(h.id)), tieStop: heads.some(h => tieStop.has(h.id)),
          measureRest: !!(e.display && e.display.measureRest), grace: !!e.grace
        });
      });
    });
    return { list: list, barLen: barLen };
  }

  function scoreEvents(S) {
    const list = [];
    const barLen = S.measures.map(m => Math.round(m.lenQ * U / 4));
    const mIdx = new Map(S.measures.map((m, i) => [m.number, i]));
    let gid = 0;
    const open = new Map();                                    /* staff|voice -> the open tuplet group id */
    S.notes.forEach(n => {
      const bar = mIdx.get(n.m);
      if (bar === undefined) return;
      const key = n.staff + '|' + n.voice;
      let tup = null;
      if (n.tm) {
        if (n.tupletStart || !open.has(key)) open.set(key, 'T' + (++gid));
        tup = open.get(key);
        if (n.tupletStop) open.delete(key);
      } else open.delete(key);
      list.push({
        hand: n.staff === 2 ? 2 : 1, voice: n.voice, bar: bar + 1, at: Math.round(n.b * U / 4 * 1000) / 1000, dur: n.dur * U / 4, kind: n.rest ? 'rest' : 'note', type: n.type, dots: n.dots || 0,
        tm: n.tm ? { a: n.tm.a, n: n.tm.n } : null, tup: tup, midi: n.rest ? [] : [n.soundingMidi !== undefined ? n.soundingMidi : n.midi], tieStart: !!n.tieStart, tieStop: !!n.tieStop,
        measureRest: !!(n.rest && n.type === 'whole' && near(n.dur, S.measures[bar].lenQ) && n.b === 0 && n.dur >= 3.999), grace: !!n.grace
      });
    });
    /* a chord's notes share an event: merge notes that start together in one staff and voice into one event (the Score has one note per head) */
    const seen = new Map();
    const merged = [];
    list.forEach(e => {
      if (e.kind === 'rest') { merged.push(e); return; }
      const k = e.hand + '|' + e.voice + '|' + e.bar + '|' + e.at;
      if (seen.has(k)) { seen.get(k).midi = seen.get(k).midi.concat(e.midi); return; }
      seen.set(k, e); merged.push(e);
    });
    return { list: merged, barLen: barLen };
  }

  function wrap(src, opts) {
    const r = checkEvents(src.list, src.barLen, opts);
    r.bars = src.barLen.length;
    r.total = [1, 2, 3, 4, 5, 6, 7].reduce((s, c) => s + r.classes[c].count, 0);
    r.restMin = opts && opts.restMin !== undefined ? opts.restMin : REST_MIN;
    return r;
  }
  const checkGraph = (g, opts) => wrap(graphEvents(g), opts);
  const checkScore = (S, opts) => wrap(scoreEvents(S), opts);

  /* one line per class: "1 rest-between-notes 12 (RH 3 7 9; LH 12)" */
  function summarize(r, opts) {
    const lines = [];
    for (let c = 1; c <= 10; c++) {
      const k = r.classes[c];
      const by = { RH: [], LH: [] };
      k.bars.forEach(b => by[b.hand].push(b.bar));
      lines.push((c < 10 ? ' ' : '') + c + ' ' + k.name + ': ' + k.count + (k.count ? '  (' + ['RH', 'LH'].filter(h => by[h].length).map(h => h + ' bars ' + by[h].join(' ')).join('; ') + ')' : ''));
    }
    return lines.join('\n') + '\n  classes 1-7 total: ' + r.total + ' (bars ' + r.bars + ', voice-bars ' + r.voiceBars + ', notes ' + r.notes + ', rests ' + r.rests + ')';
  }
  const counts = r => { const o = {}; for (let c = 1; c <= 10; c++) o[c] = r.classes[c].count; return o; };

  return Object.freeze({ REST_MIN, U, CLASS_NAMES, checkGraph, checkScore, checkEvents, graphEvents, scoreEvents, summarize, counts });
});

/* the script: node scoregraph/tools/notation-check.js <graph.json | score.json> [--rest-min 0.125] [--items] */
if (typeof module === 'object' && module.exports && require.main === module) {
  const fs = require('fs');
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--') && !/^[\d.]+$/.test(a));
  if (!file) { console.log('usage: node scoregraph/tools/notation-check.js <graph.json | score.json> [--rest-min 0.125] [--items]'); process.exit(2); }
  const C = module.exports;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const i = argv.indexOf('--rest-min');
  const opts = i >= 0 ? { restMin: +argv[i + 1] } : {};
  const r = j.parts ? C.checkGraph(j, opts) : C.checkScore(j, opts);
  console.log(file.split(/[\\/]/).pop() + (j.parts ? ' (graph)' : ' (Score)'));
  console.log(C.summarize(r));
  if (argv.includes('--items')) for (let c = 1; c <= 10; c++) r.classes[c].items.forEach(x => console.log('  class ' + c, JSON.stringify(x)));
  process.exit(r.total ? 1 : 0);
}
