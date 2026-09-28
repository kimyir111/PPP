/* ============================================================================
   PPP Difficulty — features over a ScoreGraph (docs/GOALS/G06_DIFFICULTY.md §3(a), G6a)

   featuresOf(graph, opts) -> {
     version, piece: { <feature>: number, ... },            one value per FEATURES entry, all finite
     measures: [{ id, number, beats, sec, local: {<feature>: n}, hand: {RH: {...}, LH: {...}} }],
     beats, seconds, attacks, keyShift, handFallback
   }

   A pure-function UMD module outside the app file, alongside playability/, scoregraph/ and engrave/. Not
   loaded by the app (G06 §4, §9: G6a is Node-only; G6b is the separate, app-touching phase).

   ---- Reuse, not re-derivation (G06 §3(a), §10) ----
     hands and timing   playability/graph.js attacksOf (pitch.limbOf, G1-D12; time.js seconds), once
     strain, violations playability/analyze.js analyze(): soft strain and hard violations, per event
     finger transitions playability/fingering.js eventsForHand/solveHand, plus its own exported cost terms
                        (selfCost/stepCost/tripleCost) summed along the path solveHand chose (pathCost below)
     metre, keys        scoregraph/time.js metric/groups/meterAt/keyAt/measureStart/tempoMap

   ---- Three properties every feature is built to have (G06 §5, the metamorphic acceptance) ----
   The ranker (difficulty/model.js) is linear with NON-NEGATIVE weights on standardized features, so the
   whole score inherits any direction every feature shares. Each feature is therefore defined so that:
     1. More of it is harder (the sign constraint is honest, and a reason reads "high X", never "low X").
     2. A faster notated tempo never lowers it. Tempo enters only through seconds: densities (attacks per
        second) and G5's two timing checks (VELOCITY, the "repeat" strain) - all rise as the time between
        attacks shrinks. Everything else is counted per notated BEAT, not per second, and length is in
        beats, so a faster tempo cannot make a piece "shorter" and so easier.
     3. Transposing the whole piece, key signature with it, changes nothing but keyLoad. Pitch enters G5
        only through intervals and key colour (black/white). Before G5's analyzer and fingering DP see the
        attacks they are moved by keyShift() so the key signature's scale lands on the white keys; the
        piece and any transposition of it then reach G5 as the SAME intervals and the same colours (at most
        an octave apart, and G5's costs depend on neither register nor octave). Key colour is carried by
        keyLoad (|fifths|) alone - so a key with more accidentals can only add difficulty.
   And one the goal doc asks to be checked, not assumed ("fewer notes is not automatically harder or
   easier"): no feature is a share of the piece's notes. Counts are per beat of the piece, so deleting easy
   notes cannot raise "the share that is hard" (a per-note ratio would). Removing notes can still raise a
   feature for a real reason - a deleted passing note leaves a leap behind (G5's jump strain, the DP's
   relocation cost), a deleted note in one hand can expose the other hand's rhythm (independence) - which
   is exactly the "check why" the goal doc names; tests/difficulty/metamorphic.test.js covers both sides.

   ---- One hand rule G5 does not have ----
   attacksOf deliberately drops heads with no RH/LH limb (G05 §10: G5 never infers hands). A one-staff part
   gets no limb from G1, so a single-line piece (Beyer 1 and 2, the pupil's part of a duet) would have no
   attacks at all and every G5 feature 0 - the easiest pieces in the course would look empty rather than
   easy. When NO head in the graph has a hand, this module applies the app's own existing rule (App 4303,
   scoregraph/legacy-score.js 328: a one-staff piano part is the right hand) to a shallow copy of the graph;
   it adds no new inference, and reports `handFallback: true`. Graphs with any limb are left exactly as G1
   made them.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'),
      require('../playability/index.js'));
  } else {
    const M = root.PPPDifficultyModules = root.PPPDifficultyModules || {};
    const SG = root.PPPScoreGraphModules || {};
    M.features = factory(SG.rational, SG.time, root.PPPPlayability);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, PL) {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULT_QPM = 120;     /* = playability/graph.js DEFAULT_QPM: a score that states no tempo */
  const PEAK_SHARE = 0.1;      /* a "peak" is the mean of the hardest tenth of the measures (at least one) */
  const EPS = 1e-9;
  const HANDS = ['RH', 'LH'];

  /* The feature table: the order is the model's (weights files name them, model.js checks). `local`: it
     decomposes measure by measure, so the hotspot map can use it; `hand`: it splits by hand too. `unit` and
     `what` are for people (model.js builds the reasons from them). */
  const FEATURES = Object.freeze([
    { name: 'strainRate', local: true, hand: true, unit: 'strain/beat', what: 'hand strain (stretches, jumps, crossings, fast repeats; G5)' },
    { name: 'strainPeak', local: true, hand: true, unit: 'strain/beat', what: 'hand strain in the hardest measures (G5)' },
    { name: 'hardRate', local: true, hand: true, unit: 'violations/beat', what: 'reach or speed limits exceeded (G5 hard violations)' },
    { name: 'fingerCostRH', local: true, hand: 'RH', unit: 'cost/beat', what: 'awkward right-hand finger transitions (G5 fingering DP)' },
    { name: 'fingerCostLH', local: true, hand: 'LH', unit: 'cost/beat', what: 'awkward left-hand finger transitions (G5 fingering DP)' },
    { name: 'densityRH', local: true, hand: 'RH', unit: 'attacks/s', what: 'right-hand speed at the notated tempo' },
    { name: 'densityLH', local: true, hand: 'LH', unit: 'attacks/s', what: 'left-hand speed at the notated tempo' },
    { name: 'densityPeak', local: true, hand: true, unit: 'attacks/s', what: 'speed in the fastest measures (busier hand)' },
    { name: 'notesPerBeatRH', local: true, hand: 'RH', unit: 'attacks/beat', what: 'right-hand notes per beat (as written, any tempo)' },
    { name: 'notesPerBeatLH', local: true, hand: 'LH', unit: 'attacks/beat', what: 'left-hand notes per beat (as written, any tempo)' },
    { name: 'offbeat', local: true, hand: true, unit: 'per beat', what: 'notes struck between beats (subdivided rhythm)' },
    { name: 'syncopation', local: true, hand: true, unit: 'per beat', what: 'syncopation (notes struck off the beat and held through it)' },
    { name: 'tuplets', local: true, hand: false, unit: 'notes/beat', what: 'tuplets' },
    { name: 'noteValues', local: false, hand: false, unit: 'values', what: 'variety of note values to read' },
    { name: 'independence', local: true, hand: false, unit: 'per beat', what: 'hand independence (one hand strikes while the other holds)' },
    { name: 'chordLoad', local: true, hand: true, unit: 'extra keys/beat', what: 'chords (keys struck together in one hand)' },
    { name: 'keyLoad', local: false, hand: false, unit: 'sharps/flats', what: 'key signature (sharps or flats to keep in mind)' },
    { name: 'chromatic', local: true, hand: true, unit: 'notes/beat', what: 'accidentals outside the key signature' },
    { name: 'range', local: false, hand: false, unit: 'semitones', what: 'keyboard range used' },
    { name: 'pedal', local: true, hand: false, unit: 'marks/beat', what: 'pedalling (pedal marks and changes)' },
    { name: 'length', local: false, hand: false, unit: 'log2 bars', what: 'length' }
  ]);
  const FEATURE_NAMES = Object.freeze(FEATURES.map(f => f.name));

  function finite(x) { return Number.isFinite(x) ? x : 0; }
  function num(r) { return R.toNumber(typeof r === 'string' ? R.parse(r) : r); }
  /* mean of the largest ceil(PEAK_SHARE * n) values (at least one): rises whenever any value rises */
  function peak(values) {
    if (!values.length) return 0;
    const k = Math.max(1, Math.ceil(values.length * PEAK_SHARE));
    const s = values.slice().sort((a, b) => b - a);
    let t = 0;
    for (let i = 0; i < k; i++) t += s[i];
    return t / k;
  }

  /* ------------------------------------------------------------- hands (see header) */
  function anyLimb(g) {
    return g.parts.some(p => (p.staves || []).some(s => s.limb === 'RH' || s.limb === 'LH') ||
      (p.voices || []).some(v => v.limb === 'RH' || v.limb === 'LH') ||
      p.events.some(e => (e.heads || []).some(h => h.limb === 'RH' || h.limb === 'LH')));
  }
  function handGraph(g) {
    if (anyLimb(g)) return { graph: g, fallback: false };
    let changed = false;
    const parts = g.parts.map(p => {
      if ((p.staves || []).length !== 1) return p;
      changed = true;
      return Object.assign({}, p, { staves: [Object.assign({}, p.staves[0], { limb: 'RH' })] });
    });
    if (!changed) return { graph: g, fallback: false };
    /* frozen at the top so scoregraph/time.js keeps caching its measure context for it (time.js ctx) */
    return { graph: Object.freeze(Object.assign({}, g, { parts: parts })), fallback: true };
  }

  /* ------------------------------------------------------------- key signature */
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  function keyAlter(step, fifths) {
    if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
    if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
    return 0;
  }
  function keysInOrder(g) {
    return (g.timeline.keys || []).map(k => ({ k: k, w: num(T.scorePos(g, k)) })).sort((a, b) => a.w - b.w);
  }
  /* Semitones that move the opening key signature's scale onto the white keys: the major tonic of `fifths`
     is 7*fifths mod 12, taken to the nearest C (a shift in -6..5). The piece and any transposition of it
     come out identical up to whole octaves - see the header, property 3. */
  function keyShift(g) {
    const ks = keysInOrder(g);
    const f = ks.length ? ks[0].k.fifths : 0;
    let s = ((-7 * f) % 12 + 12) % 12;
    if (s > 5) s -= 12;
    return s;
  }
  /* keyLoad: |fifths| of each signature, weighted by how long it holds (a key the piece moves into counts
     for its own span). With no key event, 0 (C major / no signature). */
  function keyLoadOf(g, totalW) {
    const ks = keysInOrder(g);
    if (!ks.length || !(totalW > 0)) return ks.length ? Math.abs(ks[0].k.fifths) : 0;
    let acc = 0;
    for (let i = 0; i < ks.length; i++) {
      const from = i === 0 ? 0 : ks[i].w;
      const to = i + 1 < ks.length ? ks[i + 1].w : totalW;
      if (to > from) acc += Math.abs(ks[i].k.fifths) * (to - from);
    }
    return acc / totalW;
  }

  /* ------------------------------------------------------------- measures and seconds */
  /* One tempoMap for the whole piece (time.js), integrated the way time.seconds does (Σ Δw·240/qpm). Score
     positions are read as playback positions, the same reading attacksOf makes (playability/graph.js: equal
     until a repeat, and a repeated passage is the same music again). */
  function secondsFn(g, timeOpts) {
    const map = T.tempoMap(g, timeOpts).map(x => ({ start: num(x.start), qpm: num(x.qpm) }));
    return function (w) {
      let s = 0;
      for (let i = 0; i < map.length; i++) {
        const a = map[i].start;
        if (a >= w) break;
        const b = i + 1 < map.length && map[i + 1].start < w ? map[i + 1].start : w;
        s += (b - a) * 240 / map[i].qpm;
      }
      return s;
    };
  }
  function measureTable(g, timeOpts) {
    const sec = secondsFn(g, timeOpts);
    const ms = g.timeline.measures || [];
    const rows = [];
    let w = 0;
    ms.forEach((m, i) => {
      const dw = num(m.dur);
      const s0 = sec(w), s1 = sec(w + dw);
      /* the bar the time signature promises: a pickup or a short last bar is `beats` < `barBeats` */
      let barBeats = dw * 4;
      try { const meter = T.meterAt(g, m.id); if (meter) barBeats = num(T.nominal(meter)) * 4; } catch (err) { /* no meter */ }
      rows.push({ id: m.id, number: m.number, index: i, startW: w, beats: dw * 4, barBeats: barBeats, sec: Math.max(0, s1 - s0) });
      w += dw;
    });
    return { rows: rows, totalW: w, totalBeats: w * 4, totalSec: sec(w) };
  }

  /* ------------------------------------------------------------- the fingering DP's own path cost
     solveHand (G5b) returns the fingering, not its cost. This sums the SAME exported terms the DP minimises
     (selfCost, stepCost, tripleCost) along the chosen path, phrase by phrase exactly as solveHand splits them
     (a rest of PHRASE_REST_BEATS starts a fresh phrase, and no cost crosses it), attributing each term to the
     measure of the event it lands on. tests/difficulty/features.test.js checks that this is the DP's own
     optimum by brute force over small phrases. */
  function pathCost(evs, fingers, hand, F) {
    const perEvent = new Array(evs.length).fill(0);
    let phraseStart = 0;
    for (let i = 0; i < evs.length; i++) {
      const gap = i ? Math.max(0, evs[i].at - evs[i - 1].end) : 0;
      if (i > 0 && evs[i].at - evs[i - 1].end >= F.PHRASE_REST_BEATS - 1e-6) phraseStart = i;
      const f = fingers[i];
      let c = F.selfCost(evs[i], f, hand);
      if (i > phraseStart) {
        c += F.stepCost(evs[i - 1], fingers[i - 1], evs[i], f, hand, gap);
        if (i > phraseStart + 1) {
          const gapPrev = Math.max(0, evs[i - 1].at - evs[i - 2].end);
          c += F.tripleCost(evs[i - 2], fingers[i - 2], evs[i - 1], fingers[i - 1], evs[i], f, hand, Math.max(gapPrev, gap));
        }
      }
      perEvent[i] = c;
    }
    return perEvent;
  }

  /* ------------------------------------------------------------- the per-measure accumulator */
  const LOCAL_NAMES = FEATURES.filter(f => f.local).map(f => f.name);
  function zeroCounts() {
    return { soft: 0, hard: 0, dp: 0, attacks: 0, offbeat: 0, sync: 0, chord: 0, chromatic: 0 };
  }

  function featuresOf(g, opts) {
    opts = opts || {};
    const timeOpts = { defaultQpm: opts.defaultQpm || DEFAULT_QPM };
    const hg = handGraph(g);
    const attacks = opts.attacks || PL.graph.attacksOf(hg.graph, timeOpts);
    const table = measureTable(g, timeOpts);
    const rows = table.rows;
    const B = table.totalBeats, S = table.totalSec;

    /* counts per measure: per hand where a feature splits by hand, one total where it does not */
    const cnt = new Map(rows.map(r => [r.id, { RH: zeroCounts(), LH: zeroCounts(), tuplets: 0, independence: 0, pedal: 0 }]));
    const bucket = (m, limb) => { const c = cnt.get(m); return c ? c[limb] : null; };

    /* -- G5: analyzer and fingering DP on key-normalised attacks (header, property 3) -- */
    const shift = keyShift(g);
    const shifted = shift === 0 ? attacks : attacks.map(a => Object.assign({}, a, {
      midis: a.midis.map(x => x + shift),
      heads: a.heads.map(h => Object.assign({}, h, { midi: h.midi + shift }))
    }));
    const report = PL.analyze(shifted, { profile: opts.profile || 'medium' });
    report.events.forEach(e => {
      const b = bucket(e.m, e.limb);
      if (!b) return;
      b.soft += e.soft;
      b.hard += e.hard.length;
    });
    const F = PL.fingering;
    HANDS.forEach(limb => {
      const hand = limb === 'RH' ? 'r' : 'l';
      const evs = F.eventsForHand(shifted.filter(a => a.limb === limb));
      if (!evs.length) return;
      const per = pathCost(evs, F.solveHand(evs, hand), hand, F);
      evs.forEach((e, i) => { const b = bucket(e.m, limb); if (b) b.dp += per[i]; });
    });

    /* -- attacks: density, chords, range, off-beat and syncopation -- */
    let lo = Infinity, hi = -Infinity;
    attacks.forEach(a => {
      const b = bucket(a.m, a.limb);
      a.midis.forEach(x => { if (x < lo) lo = x; if (x > hi) hi = x; });
      if (!b) return;
      b.attacks++;
      b.chord += Math.max(0, new Set(a.midis).size - 1);
      const r = rhythmOf(g, a);
      if (r.offbeat) b.offbeat++;
      if (r.syncopated) b.sync++;
    });

    /* -- chromatic notes: a pitch whose alteration is not the key signature's for its step -- */
    const attacked = new Map();
    attacks.forEach(a => a.heads.forEach(h => attacked.set(h.id, a.limb)));
    const keyCache = new Map();
    g.parts.forEach(part => part.events.forEach(e => {
      if (e.kind !== 'note') return;
      (e.heads || []).forEach(h => {
        const limb = attacked.get(h.id);
        if (!limb || !h.pitch) return;
        const staff = h.staff || e.staff;
        const ck = e.m + '|' + e.at + '|' + part.id + '|' + staff;
        let fifths = keyCache.get(ck);
        if (fifths === undefined) {
          let k = null;
          try { k = T.keyAt(g, { m: e.m, at: e.at }, part.id, staff); } catch (err) { k = null; }
          fifths = k ? k.fifths : 0;
          keyCache.set(ck, fifths);
        }
        if ((h.pitch.alter || 0) !== keyAlter(h.pitch.step, fifths)) { const b = bucket(e.m, limb); if (b) b.chromatic++; }
      });
    }));

    /* -- tuplets and note values (events), pedal (spanners) -- */
    const tupletEvents = new Set();
    let pedalMarks = 0;
    g.parts.forEach(part => (part.spanners || []).forEach(sp => {
      if (sp.type === 'tuplet') (sp.events || []).forEach(id => tupletEvents.add(id));
      if (sp.type === 'pedal' && !sp.soundOnly) {
        const marks = [sp.from].concat(sp.changes || []);
        marks.forEach(p => { if (p && cnt.has(p.m)) { cnt.get(p.m).pedal++; pedalMarks++; } });
      }
    }));
    const values = new Set();
    let tupletNotes = 0;
    g.parts.forEach(part => part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || e.cue) return;
      if (e.display && e.display.type) values.add(e.display.type + '.' + (e.display.dots || 0));
      if (tupletEvents.has(e.id) && cnt.has(e.m)) { cnt.get(e.m).tuplets++; tupletNotes++; }
    }));

    /* -- independence: one hand strikes while the other is holding a key it struck earlier -- */
    let indep = 0;
    independenceEvents(attacks).forEach(m => { if (cnt.has(m)) { cnt.get(m).independence++; indep++; } });

    /* -- totals -- */
    const tot = { RH: zeroCounts(), LH: zeroCounts() };
    cnt.forEach(c => HANDS.forEach(h => Object.keys(tot[h]).forEach(k => { tot[h][k] += c[h][k]; })));
    const both = k => tot.RH[k] + tot.LH[k];
    const perBeat = x => (B > 0 ? x / B : 0);

    const measures = rows.map(r => {
      const c = cnt.get(r.id);
      const pb = x => (r.beats > 0 ? x / r.beats : 0);
      const ps = x => (r.sec > 0 ? x / r.sec : 0);
      const handLocal = h => ({
        strainRate: pb(c[h].soft), strainPeak: pb(c[h].soft), hardRate: pb(c[h].hard),
        fingerCostRH: h === 'RH' ? pb(c.RH.dp) : 0, fingerCostLH: h === 'LH' ? pb(c.LH.dp) : 0,
        densityRH: h === 'RH' ? ps(c.RH.attacks) : 0, densityLH: h === 'LH' ? ps(c.LH.attacks) : 0,
        densityPeak: ps(c[h].attacks), notesPerBeatRH: h === 'RH' ? pb(c.RH.attacks) : 0, notesPerBeatLH: h === 'LH' ? pb(c.LH.attacks) : 0,
        offbeat: pb(c[h].offbeat), syncopation: pb(c[h].sync), chordLoad: pb(c[h].chord), chromatic: pb(c[h].chromatic)
      });
      const local = {
        strainRate: pb(c.RH.soft + c.LH.soft), strainPeak: pb(c.RH.soft + c.LH.soft), hardRate: pb(c.RH.hard + c.LH.hard),
        fingerCostRH: pb(c.RH.dp), fingerCostLH: pb(c.LH.dp),
        densityRH: ps(c.RH.attacks), densityLH: ps(c.LH.attacks), densityPeak: ps(Math.max(c.RH.attacks, c.LH.attacks)),
        notesPerBeatRH: pb(c.RH.attacks), notesPerBeatLH: pb(c.LH.attacks), offbeat: pb(c.RH.offbeat + c.LH.offbeat),
        syncopation: pb(c.RH.sync + c.LH.sync), tuplets: pb(c.tuplets), independence: pb(c.independence),
        chordLoad: pb(c.RH.chord + c.LH.chord), chromatic: pb(c.RH.chromatic + c.LH.chromatic), pedal: pb(c.pedal)
      };
      LOCAL_NAMES.forEach(n => { local[n] = finite(local[n]); });
      return { id: r.id, number: r.number, beats: r.beats, barBeats: r.barBeats, sec: r.sec, local: local, hand: { RH: handLocal('RH'), LH: handLocal('LH') } };
    });

    const piece = {
      strainRate: perBeat(both('soft')),
      strainPeak: peak(measures.filter(m => m.beats > 0).map(m => m.local.strainPeak)),
      hardRate: perBeat(both('hard')),
      fingerCostRH: perBeat(tot.RH.dp),
      fingerCostLH: perBeat(tot.LH.dp),
      densityRH: S > 0 ? tot.RH.attacks / S : 0,
      densityLH: S > 0 ? tot.LH.attacks / S : 0,
      densityPeak: peak(measures.filter(m => m.sec > 0).map(m => m.local.densityPeak)),
      notesPerBeatRH: perBeat(tot.RH.attacks),
      notesPerBeatLH: perBeat(tot.LH.attacks),
      offbeat: perBeat(both('offbeat')),
      syncopation: perBeat(both('sync')),
      tuplets: perBeat(tupletNotes),
      noteValues: values.size,
      independence: perBeat(indep),
      chordLoad: perBeat(both('chord')),
      keyLoad: keyLoadOf(g, table.totalW),
      chromatic: perBeat(both('chromatic')),
      range: Number.isFinite(lo) ? hi - lo : 0,
      pedal: perBeat(pedalMarks),
      length: Math.log2(1 + B / 4)
    };
    FEATURE_NAMES.forEach(n => { piece[n] = finite(piece[n]); });

    return {
      version: VERSION, piece: piece, measures: measures, beats: B, seconds: S,
      attacks: attacks.length, keyShift: shift, handFallback: hg.fallback
    };
  }

  /* Where an attack falls against the beat (time.js metric: compound and additive metres, a pickup counted
     back from its bar line).
       offbeat     struck between two beat pulses (a subdivided beat: eighths in 2/4, the inner eighths of a
                   dotted-quarter beat in 6/8) - the rhythm-reading load the legacy heuristic's "offbeat" term
                   measures as a share, counted here per beat so removing on-beat notes cannot raise it;
       syncopated  off the beat AND held PAST the next pulse - an anticipation a reader has to count through.
                   Held exactly to the next pulse is not syncopated (every second eighth of a running line
                   would be). Held = the longest of the attack's keys, tie chains included (attacksOf offW). */
  function rhythmOf(g, a) {
    const none = { offbeat: false, syncopated: false };
    let met, meter;
    try {
      met = T.metric(g, { m: a.m, at: R.sub(a.onsetW, T.measureStart(g, a.m)) });
      meter = T.meterAt(g, a.m);
    } catch (err) { return none; }
    const offset = num(met.offset);
    if (!(offset > EPS) || !meter) return none;
    const gr = T.groups(meter);
    if (!gr.length) return { offbeat: true, syncopated: false };
    const beatW = num(gr[Math.min(met.beat, gr.length - 1)]);
    const onset = num(a.onsetW);
    let hold = 0;
    a.heads.forEach(h => { const d = num(h.offW) - onset; if (d > hold) hold = d; });
    return { offbeat: true, syncopated: hold > beatW - offset + EPS };
  }

  /* The measure of every attack struck by one hand while the other hand holds a key it struck EARLIER and
     does not strike anything at this instant: a melody over a held bass, an Alberti bass under a long note,
     two rhythms at once. Hands attacking together, or one hand alone, are not independence - so a one-hand
     piece, or a piece with one hand removed, scores 0 here. */
  function independenceEvents(attacks) {
    const byHand = { RH: [], LH: [] };
    attacks.forEach(a => {
      if (!byHand[a.limb]) return;
      let off = -Infinity;
      a.heads.forEach(h => { const o = num(h.offW); if (o > off) off = o; });
      byHand[a.limb].push({ t: num(a.onsetW), off: off, m: a.m });
    });
    const out = [];
    HANDS.forEach(h => {
      const mine = byHand[h], other = byHand[h === 'RH' ? 'LH' : 'RH'];
      let j = 0, maxOff = -Infinity;
      mine.forEach(a => {
        while (j < other.length && other[j].t < a.t - EPS) { if (other[j].off > maxOff) maxOff = other[j].off; j++; }
        const strikesNow = j < other.length && Math.abs(other[j].t - a.t) <= EPS;
        if (!strikesNow && maxOff > a.t + EPS) out.push(a.m);
      });
    });
    return out;
  }

  return Object.freeze({ VERSION, FEATURES, FEATURE_NAMES, DEFAULT_QPM, featuresOf, keyShift, keyAlter, pathCost, peak });
});
