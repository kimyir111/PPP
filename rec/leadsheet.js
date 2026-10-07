/* ============================================================================
   PPP rec/ - the lead sheet of a recording (docs/GOALS/G10_AUDIO_TO_SCORE.md section 9 "option G" and section 33; phase G10c-1a)

     isRecording(g)         is this graph a transcription (a source of kind 'audio-score': what scoregraph/gaps.js isTranscription and repair/ gate on)?
     prepare(g, opts)       -> { ok: true, graph, sg, report, melody } | { ok: false, reason, message }
     collect(g), selectMelody(notes, params), shiftOctaves(melody, params), harmonyOf(g)      the steps of prepare, exported for the tests and the benchmark

   WHY. The one-note-per-hand arranger REDUCES a transcription: it thins every hand of the recording graph. On a real piano cover that refuses the dense pieces (3 of the
   teacher's 6), makes the same copy at every level, keeps the cover's 16th-note left hand and leaves holes in the melody wherever the hand split put a melody note in the
   left staff (docs/GOALS/G10 section 9, TD23, TD24). This module is the other way, GENERATE: from the recording graph it writes a LEAD SHEET - the melody as one line, and
   the harmony of every heard note under it - and hands that to the arranger exactly as a hymn is handed, so the G7b plan, the G8 realizer and the G9 candidates, critics and
   repair write the accompaniment at the requested level. Nothing in the planner, realizer, candidates or repair is changed or rebuilt (one tier of the planner's relaxed search
   is added, section 33.5); this file only makes the input.

   THE MELODY (selectMelody). A cross-staff skyline with a continuity cost over ALL heard notes, independent of the hand split: at every onset instant of the piece (both staves,
   every voice) the candidates are the three highest notes that start there, or nothing; a beam search (width 12) over the whole piece picks the line of least cost. A candidate costs
   its rank among the notes that start with it (0.5 a rank), the distance to a note that is still sounding above it (a held voice: 1.5 an octave), its velocity against the loudest
   note of the instant (0.4) and, in a second pass after a first one has found the middle of the piece's melody, the distance beyond an octave from that middle (1.2 an octave). The
   step from the last melody note costs by the interval (nothing up to a whole tone, 0.125 a semitone beyond, at most 3), half as much after two beats of silence. Skipping an instant
   whose highest sounding note starts there costs 1.8: a stray note above the line (a figure of the accompaniment that rises for one note) is cheaper to leave out than a leap and a
   leap back, and a run of notes that really is the tune is cheaper to take than to skip; skipping an instant whose highest sounding note is a held one costs nothing (the tune's
   long note goes on). So a melody note that the hand split put in the left staff stays in the line. A note lasts until its heard release (its written end when it was not heard) or
   the next melody note; rec/writer.js writes it (exact bars, ties, rests of a quarter or longer, tuplets), after rec/grid.js has moved an onset on an odd 32nd that continues no run
   to the 16th beside it (the grid stage's own rule: no rest shorter than a 16th is ever written).

   OCTAVES (shiftOctaves). A cover is often played, or heard, an octave or two off the staff (45% of the teacher's right-hand notes above C6). The melody is moved by whole octaves
   towards C4..C6 (MIDI 60..84) by a small dynamic program over its notes: a move costs 1 a note and octave; a note above the window costs 1.5 a semitone and one below it 6 (the
   accompaniment the arranger writes lives under C4, and a melody there crosses it); changing the move costs 0.5 an octave at a silence of a quarter or more and 40 inside a phrase, so a
   phrase moves as one and its contour is kept. A single note a semitone over stays; a phrase that is mostly over moves. Pitch classes never change; the report counts the notes moved.

   THE HARMONY (harmonyOf). songgraph/harmony.js harmonyOf over the RECORDING graph (every note of every staff and voice, the hand split not read at all), one chord per beat
   window; the arranger is handed the lead sheet's SongGraph with exactly that harmony in place of what its single melody line would give. The lead sheet's bars, metre, key
   signatures and tempo are the recording graph's own (the v2 conversion's), its measure ids are kept so the windows need no mapping, and its provenance keeps the
   'audio-score' source, so the arranger's closing of gaps, rests and tuplets (repair/, gated on a transcription) runs on the copy exactly as it does on a reduced one.

   WHAT IT REFUSES (reason): LEADSHEET_NOT_A_RECORDING, LEADSHEET_IRREGULAR_BARS (bars of different lengths: a pickup written as a short bar), LEADSHEET_METRE (a meter change or an
   additive one), LEADSHEET_OFF_GRID (an onset that is not on the 1/96 grid), LEADSHEET_NO_MELODY (fewer than MIN_NOTES melody notes), LEADSHEET_WRITE_FAILED (the writer or the
   graph builder threw). The caller decides what a refusal means (the app glue returns it; the app then offers the reduction).

   Pure and deterministic (no Date, no random, no I/O). UMD: Node require('./rec/leadsheet.js'); page PPPRecLeadsheet, after scoregraph/ (rational, time, pitch, build, gaps),
   songgraph/ (harmony, index), rec/writer.js and rec/grid.js (writable).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/pitch.js'), require('../scoregraph/build.js'),
      require('../songgraph/harmony.js'), require('../songgraph/index.js'), require('./writer.js'), require('./grid.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {}, SGG = root.PPPSongGraphModules || {};
    root.PPPRecLeadsheet = factory(SG.rational, SG.time, SG.pitch, SG.build, SGG.harmony, root.PPPSongGraph, root.PPPRecWriter, root.PPPRecGrid || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, P, B, H, SGG, WR, RG) {
  'use strict';

  const VERSION = '1.0.0';
  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g10c1-leadsheet', version: VERSION });
  const Q = 24;                    /* ticks a quarter (the writer's unit) */
  const TPW = 96;                  /* ticks a whole note */
  const MIN_NOTES = 4;

  /* the constants of the melody search and the octave pass: engineering values chosen from the structure of the problem (a step costs nothing, a leap costs by its size, a note
     the line skips costs about a leap and a half), not fitted to any benchmark; section 33.2 says which were looked at and which were not. */
  const PARAMS = Object.freeze({
    topK: 3,            /* candidates at an instant: the highest notes that start there */
    beam: 12,           /* states kept after each instant */
    rank: 0.5,          /* per rank below the highest note that starts at the instant */
    shadow: 1.5,        /* a sounding note above the candidate (held voice): per octave of distance, at most 1 octave counted */
    vel: 0.4,           /* velocity below the loudest note of the instant: per 30 steps of velocity, at most 1 */
    skip: 1.8,          /* leaving out an instant whose highest sounding note starts there */
    leapFree: 2,        /* semitones a step may span at no cost */
    leapPer: 0.125,     /* cost per semitone beyond leapFree */
    leapMax: 3,
    gapHalf: 2,         /* beats of silence that halve the cost of a leap */
    prior: 1.2,         /* per octave beyond one from the middle of the melody (second pass) */
    priorFree: 12,
    restMin: 24,        /* ticks: a silence of the melody shorter than this is not a rest (the note lasts to the next one) */
    lo: 60, hi: 84,     /* the octave window, MIDI C4..C6 */
    outside: 1.5,       /* per semitone above the window */
    outsideLow: 6,      /* per semitone below the window (the left hand's accompaniment lives under C4: a melody there crosses it) */
    moved: 1,           /* per note and octave it is moved: a phrase moves only where its notes outside the window weigh more than the notes it moves (a single note a semitone over stays) */
    shiftInside: 40,    /* per octave of change inside a phrase (a run with no silence of restMin or more: one octave for all of it) */
    shiftRest: 0.5,     /* per octave of change at a silence */
    octave: true        /* false: the melody keeps its octaves */
  });

  function fail(reason, message) { return { ok: false, reason: reason, message: message || null }; }
  const tickOf = r => { const x = R.toNumber(r) * TPW, k = Math.round(x); return Math.abs(x - k) < 1e-6 ? k : null; };
  const wholeOf = ticks => R.format(R.make(ticks, TPW));

  function isRecording(g) { return !!(g && g.provenance && (g.provenance.sources || []).some(x => x && x.kind === 'audio-score')); }

  /* ---------------------------------------------------------------- collect: every onset of the recording graph, both staves, every voice */
  function collect(g) {
    if (!isRecording(g)) return fail('LEADSHEET_NOT_A_RECORDING');
    const ms = g.timeline.measures || [];
    if (!ms.length) return fail('LEADSHEET_IRREGULAR_BARS', 'no bars');
    if (ms.some(m => m.dur !== ms[0].dur)) return fail('LEADSHEET_IRREGULAR_BARS', 'bars of different lengths');
    const bar = tickOf(R.parse(ms[0].dur));
    if (bar === null || bar <= 0) return fail('LEADSHEET_OFF_GRID', 'bar length');
    const meters = g.timeline.meters || [];
    const m0 = meters[0];
    const same = x => JSON.stringify([x.beats, x.beatType, x.groups || null]) === JSON.stringify([m0.beats, m0.beatType, m0.groups || null]);
    if (!m0 || !meters.every(same)) return fail('LEADSHEET_METRE', 'no single meter');
    if (!Array.isArray(m0.beats) || m0.beats.length !== 1 || (Array.isArray(m0.groups) && m0.groups.length)) return fail('LEADSHEET_METRE', 'an additive meter');
    const beatsPerBar = m0.beats[0], beatType = m0.beatType;
    const compound = beatType >= 8 && beatsPerBar % 3 === 0;
    if (!(beatType === 4 || beatType === 2 || compound)) return fail('LEADSHEET_METRE', beatsPerBar + '/' + beatType);
    const info = { bar: bar, bars: ms.length, beatsPerBar: beatsPerBar, beatType: beatType, compound: compound, end: bar * ms.length };

    /* the performance layer: velocity and the heard release of each head */
    const perf = (g.performances || [])[0] || null;
    const link = new Map();
    if (perf) (perf.notes || []).forEach(n => { if (n.link !== undefined) link.set(n.link, n); });
    let ptm = null;
    if (perf) { try { ptm = T.perfTimeMap(g, perf.id); } catch (e) { ptm = null; } }
    const heardEnd = n => {
      if (!ptm || !n || typeof n.off !== 'number') return null;
      try { const pp = ptm.fromUs(n.off); return Math.round(R.toNumber(T.scorePos(g, { m: pp.m, at: pp.at })) * TPW); } catch (e) { return null; }   /* a heard release is anywhere: the nearest tick */
    };

    const notes = [];
    let order = 0;
    for (const part of g.parts) {
      const staffIx = new Map(part.staves.map((s, i) => [s.id, i]));
      const tieTo = new Set(), tieNext = new Map();
      (part.spanners || []).forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) { tieTo.add(sp.to); tieNext.set(sp.from, sp.to); } });
      const evOfHead = new Map();
      const endOf = new Map();
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        const a = tickOf(T.scorePos(g, e)), len = tickOf(R.parse(e.dur));
        if (a === null || len === null) { endOf.set(e.id, null); return; }
        endOf.set(e.id, a + len);
        (e.heads || []).forEach(h => evOfHead.set(h.id, { e: e }));
      });
      for (const e of part.events) {
        if (e.kind !== 'note' || e.grace) continue;
        const a = tickOf(T.scorePos(g, e));
        if (a === null) return fail('LEADSHEET_OFF_GRID', 'an onset');
        for (const h of (e.heads || [])) {
          if (!h.pitch || tieTo.has(h.id)) continue;       /* a tie's continuation is not an onset */
          let last = h.id, ev = e, guard = 0;
          while (tieNext.has(last) && guard++ < 64) { last = tieNext.get(last); const x = evOfHead.get(last); if (!x) break; ev = x.e; }
          const endW = endOf.get(ev.id);
          const pn = link.get(h.id) || null;
          const hv = heardEnd(pn);
          notes.push({
            i: order++, headId: h.id, tick: a, midi: P.midi(h.pitch), pitch: { step: h.pitch.step, alter: h.pitch.alter || 0, oct: h.pitch.oct },
            vel: pn && typeof pn.vel === 'number' ? pn.vel : 64, staff: staffIx.get(e.staff) || 0,
            endW: endW === null || endW === undefined ? a + 6 : endW, endH: hv
          });
        }
      }
    }
    if (!notes.length) return fail('LEADSHEET_NO_MELODY', 'no notes');
    notes.sort((x, y) => x.tick - y.tick || y.midi - x.midi || x.i - y.i);
    return { ok: true, notes: notes, info: info };
  }

  /* ---------------------------------------------------------------- the melody: a beam search over the onset instants */
  function leapCost(d, gapBeats, params) {
    const c = Math.min(params.leapMax, params.leapPer * Math.max(0, d - params.leapFree));
    return c / (1 + Math.max(0, gapBeats) / params.gapHalf);
  }

  function instantsOf(notes, params) {
    const byTick = new Map();
    notes.forEach(n => { if (!byTick.has(n.tick)) byTick.set(n.tick, []); byTick.get(n.tick).push(n); });
    const ticks = Array.from(byTick.keys()).sort((a, b) => a - b);
    let held = [];
    return ticks.map(t => {
      held = held.filter(n => n.endW > t);
      const here = byTick.get(t);
      let top = -1;
      held.forEach(n => { if (n.midi > top) top = n.midi; });
      let hereTop = -1, vmax = 0;
      here.forEach(n => { if (n.midi > hereTop) hereTop = n.midi; if (n.vel > vmax) vmax = n.vel; });
      const soundTop = Math.max(top, hereTop);
      const cands = here.slice().sort((a, b) => b.midi - a.midi || b.vel - a.vel || a.i - b.i).slice(0, params.topK);
      const it = { tick: t, cands: cands, soundTop: soundTop, vmax: vmax, topIsNew: hereTop >= soundTop };
      held = held.concat(here);
      return it;
    });
  }

  function beamSearch(inst, params, mu) {
    let beam = [{ cost: 0, last: null, node: null }];
    for (let i = 0; i < inst.length; i++) {
      const it = inst[i];
      const next = new Map();
      const put = st => { const k = st.last ? st.last.i : -1, o = next.get(k); if (!o || st.cost < o.cost - 1e-9) next.set(k, st); };
      for (const s of beam) {
        put({ cost: s.cost + (it.topIsNew ? params.skip : 0), last: s.last, node: s.node });
        for (let r = 0; r < it.cands.length; r++) {
          const c = it.cands[r];
          let cost = s.cost + params.rank * r + params.shadow * Math.min(1, (it.soundTop - c.midi) / 12) + params.vel * Math.min(1, (it.vmax - c.vel) / 30);
          if (mu !== null) cost += params.prior * Math.max(0, Math.abs(c.midi - mu) - params.priorFree) / 12;
          if (s.last) {
            const gap = (c.tick - s.last.endW) / Q;
            cost += leapCost(Math.abs(c.midi - s.last.midi), gap, params);
          }
          put({ cost: cost, last: c, node: { note: c, parent: s.node } });
        }
      }
      beam = Array.from(next.values()).sort((a, b) => a.cost - b.cost || (b.last ? b.last.midi : -1) - (a.last ? a.last.midi : -1) || (a.last ? a.last.i : -1) - (b.last ? b.last.i : -1)).slice(0, params.beam);
    }
    const out = [];
    for (let n = beam[0].node; n; n = n.parent) out.push(n.note);
    return out.reverse();
  }

  const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

  /* the melody line of a recording's notes: [{...note, end}] (ticks), in time order, one note at an instant; `end` is where the line's note stops (heard release, never past the next one) */
  function selectMelody(notes, params, info) {
    params = Object.assign({}, PARAMS, params);
    const inst = instantsOf(notes, params);
    if (!inst.length) return { melody: [], mu: null, instants: 0 };
    const first = beamSearch(inst, params, null);
    const mu = first.length ? median(first.map(n => n.midi)) : null;
    const line = mu === null ? first : beamSearch(inst, params, mu);
    const endAll = info && info.end ? info.end : Infinity;
    const melody = line.map((n, j) => {
      const nextTick = j + 1 < line.length ? line[j + 1].tick : endAll;
      let end = n.endH !== null && n.endH !== undefined ? n.endH : n.endW;
      end = Math.min(Math.max(end, n.tick + 3), nextTick, endAll);
      return Object.assign({}, n, { end: end });
    });
    return { melody: melody, mu: mu, instants: inst.length };
  }

  /* ---------------------------------------------------------------- octaves: a shift of whole octaves per phrase */
  function shiftOctaves(melody, params) {
    params = Object.assign({}, PARAMS, params);
    const shifts = melody.map(() => 0);
    if (!params.octave || !melody.length) return shifts;
    const S = [0, -12, 12, -24, 24];                    /* the order is the order of preference in a tie */
    const unary = (n, s) => {
      const m = n.midi + s;
      const out = m < params.lo ? params.outsideLow * (params.lo - m) : m > params.hi ? params.outside * (m - params.hi) : 0;
      return out + params.moved * Math.abs(s) / 12;
    };
    let cost = S.map(s => unary(melody[0], s));
    const back = [];
    for (let i = 1; i < melody.length; i++) {
      const rest = melody[i].tick - melody[i - 1].end >= params.restMin;
      const nc = new Array(S.length), nb = new Array(S.length);
      for (let t = 0; t < S.length; t++) {
        let best = Infinity, arg = 0;
        for (let s = 0; s < S.length; s++) {
          const c = cost[s] + (s === t ? 0 : (Math.abs(S[s] - S[t]) / 12) * (rest ? params.shiftRest : params.shiftInside));
          if (c < best - 1e-9) { best = c; arg = s; }
        }
        nc[t] = best + unary(melody[i], S[t]); nb[t] = arg;
      }
      cost = nc; back.push(nb);
    }
    let k = 0;
    for (let s = 1; s < S.length; s++) if (cost[s] < cost[k] - 1e-9) k = s;
    for (let i = melody.length - 1; i >= 0; i--) { shifts[i] = S[k]; if (i > 0) k = back[i - 1][k]; }
    return shifts;
  }

  function shiftPitch(p, semis) {
    const o = { step: p.step, oct: p.oct + semis / 12 };
    if (p.alter) o.alter = p.alter;
    return o;
  }

  /* ---------------------------------------------------------------- the harmony of every heard note */
  function harmonyOf(g) { return H.harmonyOf(g); }

  /* ---------------------------------------------------------------- the lead sheet graph */
  function write(g, info, melody, shifts, params, onsetTicks) {
    const wnotes = melody.map((n, j) => ({
      midi: n.midi + shifts[j], tick: n.tick, endTick: n.end, staff: 1, voice: 1, on: n.tick, off: n.end, vel: n.vel, pitch: shiftPitch(n.pitch, shifts[j])
    }));
    /* the grid stage's own run rule for the melody voice (rec/grid.js writable: an onset on an odd 32nd that does not continue a run moves to the neighbouring 16th), so that
       no rest shorter than a 16th is ever written before a note; a page without the grid stage writes the line as it is */
    if (RG && RG.writable) RG.writable(wnotes);
    /* the grid of each beat is the recording's, not the melody's: the writer reads a beat's kind (straight, triplet eighths, triplet 16ths) from the onsets it is given, and a melody alone
       can show a different kind from the whole texture (a third and an eighth in one beat), so the onsets of EVERY heard note go in too, as ghosts (staff 0: the writer writes no event for them) */
    const ghosts = onsetTicks.map(t => ({ midi: 0, tick: t, endTick: t + 1, staff: 0, voice: 1, on: t, off: t + 1, vel: 0 }));
    /* a melody onset that is not a point of its beat's grid (a beat whose onsets read as triplet eighths can still hold an onset a straight eighth in: the recording's own writer
       brackets it, the arranger's copy does not) moves to the nearest point of the grid; one that would land on another melody note's onset is left out (the line stays one note at a time) */
    const grid = WR._ && WR._.gridOf ? WR._.gridOf(ghosts, { bar: info.bar, bars: info.bars, beatType: info.beatType, beatsPerBar: info.beatsPerBar, compound: info.compound }) : null;
    let kept = wnotes;
    if (grid) {
      const used = new Set(), out = [];
      wnotes.forEach(n => {
        if (!grid.valid(n.tick)) {
          const lo = Math.floor(n.tick / grid.unit) * grid.unit, t = grid.nearest(n.tick, lo, lo + grid.unit);
          if (t !== null) { n.tick = t; n.endTick = Math.max(n.endTick, t + 1); }
        }
        if (used.has(n.tick)) return;
        used.add(n.tick); out.push(n);
      });
      kept = out;
    }
    const w = WR.write(kept.concat(ghosts), { bar: info.bar, bars: info.bars, beatType: info.beatType, beatsPerBar: info.beatsPerBar, compound: info.compound, restMin: info.compound ? 36 : params.restMin, allowBarTies: false });
    const track = w.tracks.find(t => t.staff === 1 && t.voice === 1);
    if (!track) throw new Error('the writer made no first voice');

    const b = B.builder({ id: String(g.id || 'sg').slice(0, 55) + '-ls', meta: Object.assign({}, g.meta || {}), nextId: g.nextId });
    const srcIds = new Map();
    (g.provenance.sources || []).forEach(s => {
      if (!s || s.kind !== 'audio-score') return;
      const o = { kind: s.kind, tool: s.tool };
      if (s.version !== undefined) o.version = s.version;
      if (s.params !== undefined) o.params = JSON.parse(JSON.stringify(s.params));
      srcIds.set(s.id, b.source(o).id);
    });
    const mine = b.source(Object.assign({}, SOURCE));
    b.setDefault({ src: mine.id, op: 'inferred' });
    const measureIds = [];
    g.timeline.measures.forEach(m => { b.measure(Object.assign({}, m)); measureIds.push(m.id); });
    g.timeline.meters.forEach(x => b.meter(JSON.parse(JSON.stringify(x))));
    g.timeline.keys.forEach(x => b.key(JSON.parse(JSON.stringify(x))));
    const gp = g.parts[0];
    const part = b.part({ name: (gp && gp.name) || 'Piano', instrument: gp && gp.instrument ? JSON.parse(JSON.stringify(gp.instrument)) : { kind: 'piano', family: 'keyboard' } });
    /* a tempo mark's own text override names the recording graph's part and staff: the value stays, the override goes (as realize/ drops it) */
    (g.timeline.tempos || []).forEach(x => { const t = JSON.parse(JSON.stringify(x)); delete t.display; b.tempo(t); });
    const st = b.staff(part, { limb: 'RH' });
    const voice = b.voice(part, { staff: st.id, limb: 'RH', label: '1' });
    b.clef(part, { staff: st.id, m: measureIds[0], at: '0', sign: 'G' });

    const ids = [];                       /* piece index -> event id */
    const headOf = [];                    /* piece index -> head id of a note piece */
    track.pieces.forEach((p, k) => {
      const i = Math.floor(p.at / info.bar), rel = p.at - i * info.bar;
      if (i < 0 || i >= info.bars) { ids.push(null); headOf.push(null); return; }
      const display = p.dots ? { type: p.type, dots: p.dots } : { type: p.type };
      if (p.measureRest) display.measureRest = true;
      const ev = { kind: p.kind, m: measureIds[i], at: wholeOf(rel), dur: wholeOf(p.len), voice: voice.id, staff: st.id, display: display };
      if (p.kind === 'note') ev.heads = [{ pitch: p.notes[0].pitch }];
      const made = b.event(part, ev);
      ids.push(made.id); headOf.push(p.kind === 'note' ? made.heads[0].id : null);
    });
    track.pieces.forEach((p, k) => {
      if (p.kind === 'note' && p.tieIn && headOf[k] && headOf[k - 1]) b.spanner(part, { type: 'tie', from: headOf[k - 1], to: headOf[k] });
    });
    w.tuplets.forEach(t => {
      if (t.track !== w.tracks.indexOf(track)) return;
      const evs = t.pieces.map(k => ids[k]).filter(Boolean);
      if (evs.length >= 2) b.spanner(part, { type: 'tuplet', events: evs, actual: t.actual, normal: t.normal, unit: { type: t.unit.type } });
    });
    return b.finish().graph;
  }

  /* prepare(g, opts): opts.params overrides PARAMS; opts.songgraph is the SongGraph module (the page's PPPSongGraph; Node: songgraph/index.js) */
  function prepare(g, opts) {
    opts = opts || {};
    const params = Object.assign({}, PARAMS, opts.params);
    const col = collect(g);
    if (!col.ok) return col;
    const sel = selectMelody(col.notes, params, col.info);
    if (sel.melody.length < MIN_NOTES) return fail('LEADSHEET_NO_MELODY', sel.melody.length + ' melody notes');
    const shifts = shiftOctaves(sel.melody, params);
    let L;
    try { L = write(g, col.info, sel.melody, shifts, params, Array.from(new Set(col.notes.map(n => n.tick)))); }
    catch (e) { return fail('LEADSHEET_WRITE_FAILED', String(e && e.message || e).slice(0, 300)); }
    const analyzer = opts.songgraph || SGG;
    if (!analyzer || !analyzer.analyze) return fail('LEADSHEET_WRITE_FAILED', 'no SongGraph module');
    const harmony = harmonyOf(g);
    const sg = Object.assign({}, analyzer.analyze(L), { harmony: harmony });
    const moved = shifts.filter(s => s !== 0).length;
    const q = t => t / Q;
    return {
      ok: true, graph: L, sg: sg,
      report: {
        version: VERSION, notes: col.notes.length, instants: sel.instants, melodyNotes: sel.melody.length, shifted: moved, bars: col.info.bars,
        windows: harmony.length, chordWindows: harmony.filter(w => w.root !== null && w.root !== undefined).length, middle: sel.mu
      },
      melody: sel.melody.map((n, j) => ({ head: n.headId, q: q(n.tick), midi: n.midi, shift: shifts[j], staff: n.staff }))
    };
  }

  return Object.freeze({ VERSION, SOURCE, PARAMS, MIN_NOTES, isRecording, collect, selectMelody, shiftOctaves, harmonyOf, prepare });
});
