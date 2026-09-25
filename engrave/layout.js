/* ============================================================================
   PPP engrave — the layout core: NotationPlan -> EngravedScore (docs/GOALS/G04 §8.4, §9-§12, §14, §15; G4b, G4c)

   The plan says WHAT is drawn; this says WHERE. Coordinates are staff spaces
   (sp; one screen sp is 10 px), y down, rounded to 0.01 sp; every object keeps
   its graph IDs. No DOM, no clock, no random, a fixed iteration order.

     prepare(plan)             everything that does not depend on the width:
                               per measure, the columns (every onset any staff
                               or voice has, shared - what sounds together is
                               drawn together; a mid-measure clef or key change
                               is a column of its own that takes no time), and
                               per column and staff the glyph geometry relative
                               to the column: noteheads (seconds to the other
                               side of the stem; voices that would touch side by
                               side, the down-stem voice to the right; unisons
                               of one shape sharing a head), stems in the
                               direction the graph, the voice or the notes give,
                               flags, stacked accidental columns, dots, ledger
                               lines, rests, grace notes to the left with their
                               stems, flags, slashes and beams. Their extents are
                               the rods (§9.3). Also each measure's system head
                               (clef, key, time), its start items, trailing clef,
                               courtesy key/time and barline. The plan is only
                               read (G4b review R8).
     layout(prepared, config)  the width-dependent part: line breaks (breaks.js,
                               G4-U4), one spring constant per system solved
                               exactly (space.js), absolute x; then, per system,
                               the beams over the stems they join (notation.js),
                               the rests moved clear of the other voices (with
                               a ledger line where one stands off the staff);
                               then what stands around the notes, through the one
                               placement function (marks.js, G4d-1a: ties, tuplet
                               numbers and brackets, articulations, ornaments,
                               fermatas, slurs, glissandi, fingering); staves
                               and systems stacked by their skylines (skyline.js),
                               voltas, the hard-collision check. -> EngravedScore
     engrave(plan, config)     both.
     createEngraver(plan)      prepare once, lay out per config with an LRU cache
                               of 8: a resize reflows without re-preparing, and a
                               config seen before is not laid out again.
     screenConfig(px, zoom)    the screen config for a viewport: 4 bars in ~100 sp
                               on a desktop, 2 in ~40 sp at 720 px or less (G04 §15.1).
                               A resize inside a breakpoint is the same config (B7).

   config: {breakpoint, width, barsPerSystem, respectSourceBreaks, window}; window
   [first, last] lays out a close view's bars only, as systems of their own. A
   system that does not fit even with every spring at its rod (a measure wider
   than a phone) is drawn at a smaller staff size, its `space` (>= FIT_MIN);
   only past that is it an overflow (SYSTEM_OVERFLOW).

   Marks attached to systems (dynamics, hairpins, pedal, 8va, words, tempo,
   jumps, lyrics) are G4d-1b: `coverage.pending` counts them, so nothing is
   silently absent. VERSION names the EngravedScore's contract: every change to
   what layout() outputs moves it (G4-D1a-1).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('./metrics.js'), require('./space.js'), require('./breaks.js'),
      require('./skyline.js'), require('./canon.js'), require('./notation.js'), require('./metrics-text.js'), require('./curves.js'), require('./marks.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.layout = factory(root.PPPScoreGraph, M.metrics, M.space, M.breaks, M.skyline, M.canon, M.notation, M.metricsText, M.curves, M.marks);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, MT, SP, BR, SK, CN, NT, TX, CV, MK) {
  'use strict';

  const VERSION = 'engr/2';
  const R = SG.rational, EG = MT.ENGRAVING, r2 = CN.r2;
  const STEPS = 'CDEFGAB';
  /* horizontal gaps, sp (G04 §9.3, §15.4) */
  const GAP = Object.freeze({ rod: 0.3, afterBar: 1.2, beforeBar: 1.0, afterHead: 1.5, tie: 2.0, headItem: 0.6, headStart: 0.5,
    startItem: 0.5, trailing: 0.5, courtesy: 0.5 });
  /* vertical: staves of one part (a grand staff), of different parts, systems; margins (G04 §15.3) */
  const VGAP = Object.freeze({ inPart: 5.0, betweenParts: 6.0, system: 6.0, pad: 1.0, systemPad: 1.5 });
  const MARGIN = Object.freeze({ left: 1.0, right: 1.0, top: 2.0, bottom: 2.0 });
  /* a part of several staves (a grand staff) is braced at the system's left: a drawn shape, not a font glyph (the
     pinned Bravura subset has none; VexFlow draws it as a path too) */
  const BRACE = Object.freeze({ w: 1.0, gap: 0.4 });
  /* a system that does not fit its width even with every spring at its rod (one measure wider than a phone) is drawn
     at a smaller staff size - its own staff space, no smaller than FIT_MIN of the page's - rather than clipped or
     overlapped (G4-B5); only beyond that is it an overflow */
  const FIT_MIN = 0.5;
  const SCREEN = Object.freeze({ desktop: { width: 100, bars: 4 }, phone: { width: 40, bars: 2 }, phoneMaxPx: 720 });
  /* a grace note's slash (acciaccatura, §14.5): a stroke across the stem near its end, as VexFlow draws it */
  const SLASH = Object.freeze({ x0: -0.7, y0: 2.35, x1: 1.3, y1: 0.7, t: 0.12 });
  /* how far a stem under a beam may reach once the beam is placed (slope, more beams, a leap): what two voices at one
     column must keep clear of each other's heads */
  const BEAM_REACH = 8;
  /* voices side by side (§14.2): the moved voice starts this far past the other's heads - VexFlow 4.2.3's h + 2 px */
  const VOICE_GAP = 0.2;
  /* G4d-1a: an arpeggio's wavy line (or a non-arpeggio's bracket) left of its chord, past each end head by OVER, an arrow
     ARROW long; a head in parentheses; a breath mark or caesura after its note */
  const ARP = Object.freeze({ w: 0.8, nonW: 0.5, gap: 0.25, over: 0.25, arrow: 0.8 });
  const PAREN_GAP = 0.1;
  /* the lines a rest touches, below its glyph's origin (sp): a whole rest hangs from it, a half rest sits on it, a breve
     rest fills the space above it */
  const RESTLINE = Object.freeze({ restWhole: [0], restHalf: [0], restDoubleWhole: [0, 1] });
  const BREATH = Object.freeze({ gap: 0.4, comma: -0.3, caesura: 1.0 });
  const counters = { prepare: 0, layout: 0 };

  /* ---------------------------------------------------------------- staff positions */
  /* the pitch a clef puts on its line, as a diatonic index (octave * 7 + step) */
  function clefRef(c) {
    const sign = c ? c.sign : 'G';
    const oct = c && c.octave ? c.octave : 0;
    if (sign === 'F') return { line: (c && c.line) || 4, d: 3 * 7 + 3 + 7 * oct };
    if (sign === 'C') return { line: (c && c.line) || 3, d: 4 * 7 + 0 + 7 * oct };
    /* G, and percussion and TAB positions, which are written as if under a treble clef */
    return { line: (c && sign === 'G' && c.line) || 2, d: 4 * 7 + 4 + 7 * oct };
  }
  /* y of a position (step, oct) under a clef, from the top line down, 0.5 sp per step */
  function yOf(pos, clef) {
    const ref = clefRef(clef);
    const d = pos.oct * 7 + STEPS.indexOf(pos.step);
    return (5 - ref.line) - (d - ref.d) * 0.5;
  }
  /* key signature positions (y from the top line) for the clefs PPP meets; others use the treble's and say so */
  const SHARP_Y = { G2: [0, 1.5, -0.5, 1, 2.5, 0.5, 2], F4: [1, 2.5, 0.5, 2, 3.5, 1.5, 3], C3: [0.5, 2, 0, 1.5, 3, 1, 2.5], C4: [-0.5, 1, -1, 0.5, 2, 0, 1.5] };
  const FLAT_Y = { G2: [2, 0.5, 2.5, 1, 3, 1.5, 3.5], F4: [3, 1.5, 3.5, 2, 4, 2.5, 4.5], C3: [2.5, 1, 3, 1.5, 3.5, 2, 4], C4: [1.5, 0, 2, 0.5, 2.5, 1, 3] };
  const clefKey = c => (c ? c.sign + (c.line || (c.sign === 'F' ? 4 : c.sign === 'C' ? 3 : 2)) : 'G2');

  /* ---------------------------------------------------------------- small helpers */
  const byAt = (a, b) => R.cmp(R.parse(a), R.parse(b));
  const idNum = id => { const m = /(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
  const shift = (b, dx, dy) => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  const extent = objs => {
    let l = 0, r = 0;
    objs.forEach(o => { if (-o.box[0] > l) l = -o.box[0]; if (o.box[2] > r) r = o.box[2]; });
    return { left: l, right: r };
  };
  const STEMLESS = { whole: 1, breve: 1, long: 1, maxima: 1 };
  const other = d => (d === 'up' ? 'down' : 'up');
  const overlap = (p, q) => p[0] < q[2] - SK.EPS && q[0] < p[2] - SK.EPS && p[1] < q[3] - SK.EPS && q[1] < p[3] - SK.EPS;
  /* the geometry fields an object may carry beyond its box: moved and scaled with it */
  const moveGeom = (o, dx, dy) => {
    o.box = shift(o.box, dx, dy);
    if (o.line) o.line = [o.line[0] + dx, o.line[1] + dy, o.line[2] + dx, o.line[3] + dy];
    if (o.gap) o.gap = [o.gap[0] + dx, o.gap[1] + dx];
  };

  /* ================================================================ prepare */
  function prepare(plan) {
    counters.prepare++;
    const diagnostics = [];
    const diag = (code, refs, detail) => diagnostics.push({ code: code, refs: refs || [], detail: detail === undefined ? null : detail });
    const missing = new Set();
    const glyphOf = p => { if (p.missing && !missing.has(p.wanted)) { missing.add(p.wanted); diag('GLYPH_FALLBACK', [], p.wanted + ' -> ' + p.name); } return p.name; };

    const mIndex = new Map(plan.measures.map((m, i) => [m.id, i]));
    const deferred = new Set();
    plan.ledger.forEach(en => { if (en.status === 'deferred') deferred.add(en.ref); });
    /* a staff the ledger defers (TAB) is not laid out: nothing of it is drawn */
    const staves = plan.staves.filter(s => !deferred.has(s.id))
      .map((s, i) => ({ id: s.id, part: s.part, index: i, lines: s.lines === undefined || s.lines === null ? 5 : s.lines, kind: s.kind || 'standard' }));
    const staffById = new Map(staves.map(s => [s.id, s]));
    const midOf = staffId => (staffById.has(staffId) ? Math.max(0, staffById.get(staffId).lines - 1) / 2 : 2);

    /* clefs per staff in time order; the clef in force at (measure index, at) */
    const clefsOf = new Map(staves.map(s => [s.id, []]));
    plan.clefs.forEach(c => { if (clefsOf.has(c.staff)) clefsOf.get(c.staff).push(c); });
    clefsOf.forEach(list => list.sort((a, b) => mIndex.get(a.m) - mIndex.get(b.m) || byAt(a.at, b.at) || idNum(a.id) - idNum(b.id)));
    const clefAt = (staff, mi, at, strictBefore) => {
      let cur = null;
      for (const c of clefsOf.get(staff) || []) {
        const ci = mIndex.get(c.m);
        const cmp = ci !== mi ? ci - mi : byAt(c.at, at);
        if (cmp < 0 || (cmp === 0 && !strictBefore)) cur = c; else break;
      }
      return cur;
    };
    /* keys in time order; the key in force at (measure index, at): at a measure's start, at its end (Infinity), or
       strictly before a mid-measure change */
    const keys = (plan.keys || []).map((k, i) => ({ k: k, mi: mIndex.get(k.m), i: i })).filter(x => x.mi !== undefined)
      .sort((a, b) => a.mi - b.mi || byAt(a.k.at, b.k.at) || a.i - b.i).map(x => x.k);
    const keyIn = (mi, at, strict) => {
      let cur = null;
      for (const k of keys) {
        const ki = mIndex.get(k.m);
        const cmp = ki !== mi ? ki - mi : at === Infinity ? -1 : byAt(k.at, at);
        if (cmp < 0 || (cmp === 0 && !strict)) cur = k; else break;
      }
      return cur;
    };
    const keyAt = mi => keyIn(mi, '0', false);
    const keyAtEnd = mi => keyIn(mi, Infinity, false);
    const meterAt = mi => { let k = null; plan.meters.forEach(x => { if (mIndex.get(x.m) <= mi) k = x; }); return k; };
    const keyChangeAt = mi => keys.find(x => mIndex.get(x.m) === mi && R.isZero(R.parse(x.at))) || null;
    /* what a key signature shows: nothing for a hidden key (§15.4) */
    const shown = k => (k && !k.hidden ? k.fifths : 0);
    const meterChangeAt = mi => plan.meters.find(x => mIndex.get(x.m) === mi) || null;
    /* the beat an onset falls in (§11.2's hook rule): the meter's beat - a dotted beat in compound time, the groups of an
       additive meter */
    const beatOf = (mi, at) => {
      const m = meterAt(mi), t = R.toNumber(R.parse(at));
      if (!m) return Math.floor(t * 4 + 1e-9);
      const bt = m.beatType || 4, beats = m.beats && m.beats.length ? m.beats : [4];
      if (beats.length > 1) {
        let acc = 0;
        for (let i = 0; i < beats.length; i++) { acc += beats[i] / bt; if (t < acc - 1e-9) return i; }
        return beats.length;
      }
      const unit = beats[0] % 3 === 0 && beats[0] > 3 && bt >= 8 ? 3 / bt : 1 / bt;
      return Math.floor(t / unit + 1e-9);
    };

    /* arpeggios by head, and the staves each one reaches, top down (G4d-1a) */
    const arpOf = new Map(), arpStaves = new Map();
    plan.lines.filter(l => l.kind === 'arpeggio').forEach(l => (l.heads || []).forEach(h => arpOf.set(h, l)));
    plan.events.forEach(e => e.heads.forEach(h => {
      const a = arpOf.get(h.id);
      if (!a || !staffById.has(h.staff || e.staff)) return;
      if (!arpStaves.has(a.id)) arpStaves.set(a.id, []);
      const list = arpStaves.get(a.id), st = h.staff || e.staff;
      if (list.indexOf(st) < 0) { list.push(st); list.sort((x, y) => staffById.get(x).index - staffById.get(y).index); }
    }));
    /* beams by event (graph or derived; a beam of grace notes only is drawn with its grace group), tie starts by head */
    const evById = new Map(plan.events.map(e => [e.id, e]));
    const beamOf = new Map();
    plan.beams.forEach(b => b.events.forEach(id => { if (!beamOf.has(id)) beamOf.set(id, b); }));
    const graceBeam = b => b.events.every(id => evById.get(id) && evById.get(id).grace);
    const tieFrom = new Set();
    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });
    /* roles per staff|measure|voice */
    const roleOf = new Map();
    (plan.roles || []).forEach(r => Object.keys(r.role || {}).forEach(v => roleOf.set(r.staff + '|' + r.m + '|' + v, r.role[v])));
    const sounding2 = new Set();
    (plan.roles || []).forEach(r => { if ((r.voices || []).length > 1) sounding2.add(r.staff + '|' + r.m); });
    /* the voices of a staff-measure, resting ones included (the plan's roles count the sounding voices only): a rest of
       the first voice in the graph's order goes up, of the second down (§14.1, §14.3) */
    const voiceRank = new Map();
    (plan.voices || []).forEach((v, i) => { const n = parseInt(v.label, 10); voiceRank.set(v.id, [isFinite(n) ? n : 1e6, i]); });
    const vmAll = new Map();
    plan.events.forEach(e => {
      if (e.grace || e.hidden) return;
      const k = e.staff + '|' + e.m;
      if (!vmAll.has(k)) vmAll.set(k, []);
      if (vmAll.get(k).indexOf(e.voice) < 0) vmAll.get(k).push(e.voice);
    });
    const multiVoice = new Set(), restRole = new Map();
    vmAll.forEach((vs, k) => {
      if (vs.length < 2) return;
      multiVoice.add(k);
      const rk = v => voiceRank.get(v) || [1e6, 1e6];
      vs.slice().sort((a, b) => rk(a)[0] - rk(b)[0] || rk(a)[1] - rk(b)[1]).forEach((v, i) => restRole.set(k + '|' + v, i % 2 === 0 ? 'up' : 'down'));
    });

    /* ---- stem directions (§11.2, §14.1): the graph's display.stem, else the voice's role, else the notes - for a beam,
       one direction for the whole group */
    const stated = e => (e.stemFrom === 'graph' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);
    const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);
    const homeYs = e => {
      const mi = mIndex.get(e.m), mid = midOf(e.staff);
      return (e.heads || []).filter(h => (h.staff || e.staff) === e.staff && (h.written || h.pos))
        .map(h => yOf(h.written || h.pos, clefAt(e.staff, mi, e.at, false)) - mid);
    };
    /* §14.6: a percussion note stems up unless the graph or its kit says otherwise (A12) */
    const percussive = e => e.kind === 'perc' || (staffById.has(e.staff) && staffById.get(e.staff).kind === 'percussion');
    const kitStem = e => { const h = (e.heads || []).find(x => x.kit && (x.kit.stem === 'up' || x.kit.stem === 'down')); return h ? h.kit.stem : null; };
    const dirOf = new Map();
    plan.beams.forEach(b => {
      const ms = b.events.map(id => evById.get(id)).filter(e => e && !e.hidden && e.kind !== 'rest' && (e.heads || []).length);
      if (!ms.length) return;
      let d = null;
      const st = ms.map(stated).filter(Boolean);
      if (st.length) {
        d = st[0];
        if (st.some(x => x !== d)) diag('BEAM_STEM_MIXED', [b.id], 'the graph states both directions; the first holds');
      } else {
        const ro = ms.map(roled).filter(Boolean);
        /* grace notes are stemmed up unless the graph or the voice says otherwise (§14.5) */
        d = ro.length ? ro[0] : ms.every(e => e.grace) || ms.every(percussive) ? 'up' : NT.autoDir([].concat(...ms.map(homeYs)), 0);
      }
      ms.forEach(e => dirOf.set(e.id, d));
    });
    plan.events.forEach(e => {
      if (dirOf.has(e.id) || e.kind === 'rest' || e.hidden) return;
      if (e.grace) { dirOf.set(e.id, stated(e) || roled(e) || 'up'); return; }
      dirOf.set(e.id, stated(e) || roled(e) || kitStem(e) || (percussive(e) ? 'up' : NT.autoDir(homeYs(e), 0)));
    });

    /* events by measure; grace notes by their principal */
    const evByM = new Map(plan.measures.map(m => [m.id, []]));
    plan.events.forEach(e => { if (evByM.has(e.m)) evByM.get(e.m).push(e); });
    const principalKey = e => e.voice + '|' + e.m + '|' + R.format(R.parse(e.at));
    const gracesOf = new Map();
    plan.events.forEach(e => {
      if (!e.grace || e.grace.after || e.hidden || deferred.has(e.id)) return;
      const k = principalKey(e);
      if (!gracesOf.has(k)) gracesOf.set(k, []);
      gracesOf.get(k).push(e);
    });
    gracesOf.forEach(list => list.sort((a, b) => a.grace.order - b.grace.order || idNum(a.id) - idNum(b.id)));
    /* a whole-measure rest (§14.3): stated, or a voice's only event, resting the whole measure - drawn as a whole
       (or breve) rest in the middle of the measure, whatever its written value and dots (G4b review R6) */
    const voiceCount = new Map();
    plan.events.forEach(e => { if (!e.grace) { const k = e.voice + '|' + e.m; voiceCount.set(k, (voiceCount.get(k) || 0) + 1); } });
    const mDur = new Map(plan.measures.map(m => [m.id, R.parse(m.dur)]));
    const wholeBar = e => e.kind === 'rest' && (e.measureRest ||
      (R.isZero(R.parse(e.at)) && mDur.has(e.m) && R.eq(R.parse(e.dur), mDur.get(e.m)) && voiceCount.get(e.voice + '|' + e.m) === 1));

    /* ---- key signature and time signature items, relative to x = 0 and the staff's top line */
    function keyItems(fifths, prevFifths, clef, idBase, refs) {
      const out = [];
      if (!clef || clef.sign === 'percussion' || clef.sign === 'TAB') return { objects: out, w: 0 };
      const ck = clefKey(clef);
      if (!SHARP_Y[ck]) diag('KEY_POSITION_APPROX', refs, ck);
      const sharps = SHARP_Y[ck] || SHARP_Y.G2, flats = FLAT_Y[ck] || FLAT_Y.G2;
      const glyphs = [];
      /* cancel what the new key drops: naturals on the old key's accidentals the new one does not keep */
      if (prevFifths) {
        const oldN = Math.abs(prevFifths), keep = Math.sign(prevFifths) === Math.sign(fifths) ? Math.min(oldN, Math.abs(fifths)) : 0;
        for (let i = keep; i < oldN; i++) glyphs.push(['accidentalNatural', (prevFifths > 0 ? sharps : flats)[i]]);
      }
      for (let i = 0; i < Math.abs(fifths); i++) glyphs.push([fifths > 0 ? 'accidentalSharp' : 'accidentalFlat', (fifths > 0 ? sharps : flats)[i]]);
      let x = 0;
      glyphs.forEach(([name, y], i) => {
        const g = MT.glyph(name);
        out.push({ id: idBase + '#' + i, kind: 'keysig', refs: refs, glyph: name, box: MT.box(name, x - g.xMin, y), layer: 'sig' });
        x += g.w + EG.keyAccidentalGap;
      });
      return { objects: out, w: glyphs.length ? x - EG.keyAccidentalGap : 0 };
    }
    function timeItems(meter, idBase) {
      if (!meter || meter.hidden) return { objects: [], w: 0 };
      const refs = [meter.id];
      const put = (names, y, scale) => {
        const ws = names.map(n => MT.glyph(n).w * scale);
        return { names: names, y: y, scale: scale, w: ws.reduce((a, b) => a + b, 0) + Math.max(0, names.length - 1) * EG.timeDigitGap };
      };
      let rows;
      if (meter.symbol === 'common' || meter.symbol === 'cut') rows = [put([meter.symbol === 'common' ? 'timeSigCommon' : 'timeSigCutCommon'], 2, 1)];
      else {
        const top = [];
        meter.beats.forEach((b, i) => { if (i) top.push('timeSigPlus'); String(b).split('').forEach(d => top.push(glyphOf(MT.digit(d)))); });
        const bot = String(meter.beatType).split('').map(d => glyphOf(MT.digit(d)));
        rows = [put(top, 1, 1), put(bot, 3, 1)];
      }
      const w = Math.max.apply(null, rows.map(r => r.w));
      const out = [];
      rows.forEach((row, ri) => {
        let x = (w - row.w) / 2;
        row.names.forEach((n, k) => {
          const g = MT.glyph(n);
          out.push({ id: idBase + '#' + ri + '.' + k, kind: 'timesig', refs: refs, glyph: n, box: MT.box(n, x - g.xMin * row.scale, row.y, row.scale), layer: 'sig' });
          x += g.w * row.scale + EG.timeDigitGap;
        });
      });
      return { objects: out, w: w };
    }
    function clefItems(clef, idBase, scale, refs) {
      if (!clef || clef.sign === 'none') return { objects: [], w: 0 };
      const p = MT.clef(clef.sign);
      if (!p) return { objects: [], w: 0 };
      const name = glyphOf(p), g = MT.glyph(name), s = scale || 1;
      const ref = clefRef(clef);
      const y = clef.sign === 'percussion' || clef.sign === 'TAB' ? 2 : (5 - (clef.line || ref.line));
      const out = [{ id: idBase, kind: 'clef', refs: refs || [clef.id], glyph: name, scale: s, box: MT.box(name, -g.xMin * s, y, s), layer: 'sig' }];
      if (clef.octave) {
        /* an octave clef: the clef and a small 8 (or 15) above or below it, as VexFlow draws them */
        const digits = String(Math.abs(clef.octave) === 2 ? 15 : 8).split('');
        const box = out[0].box, ds = MT.SCALE.octaveDigit * s;
        const dw = digits.reduce((a, d) => a + MT.glyph('timeSig' + d).w * ds, 0);
        let x = (box[0] + box[2]) / 2 - dw / 2;
        const y0 = clef.octave > 0 ? box[1] - 0.6 * s : box[3] + 0.6 * s;
        digits.forEach((d, k) => {
          const n = 'timeSig' + d, dg = MT.glyph(n);
          out.push({ id: idBase + '#oct' + k, kind: 'clef', refs: refs || [clef.id], glyph: n, scale: ds, box: MT.box(n, x - dg.xMin * ds, y0, ds), layer: 'sig' });
          x += dg.w * ds;
        });
      }
      const u = SK.union(out.map(o => o.box));
      return { objects: out, w: u[2] - Math.min(0, u[0]) };
    }
    /* a barline and its repeat dots at x = 0, spanning the staff; -> {objects, w} */
    function barItems(style, repeat, idBase, refs, staffLines) {
      const h = Math.max(1, staffLines - 1);
      const kinds = { regular: ['thin'], dotted: ['thin'], dashed: ['thin'], heavy: ['thick'], 'light-light': ['thin', 'thin'],
        'light-heavy': ['thin', 'thick'], 'heavy-light': ['thick', 'thin'], 'heavy-heavy': ['thick', 'thick'], tick: ['thin'], short: ['thin'], none: [] };
      const strokes = kinds[style || 'regular'] || ['thin'];
      const out = [];
      let x = 0;
      const dots = side => {
        const d = MT.glyph('augmentationDot');
        [1.5, 2.5].forEach((y, k) => { out.push({ id: idBase + '#dot' + side + k, kind: 'barline', refs: refs, glyph: 'augmentationDot', box: MT.box('augmentationDot', x - d.xMin, y), layer: 'staff' }); });
        x += d.w;
      };
      if (repeat === 'backward') { dots('b'); x += EG.repeatDotGap; }
      strokes.forEach((s, k) => {
        const w = s === 'thick' ? EG.thickBar : EG.thinBar;
        out.push({ id: idBase + '#' + k, kind: 'barline', refs: refs, box: [x, 0, x + w, h], layer: 'staff' });
        x += w + (k < strokes.length - 1 ? EG.barGap : 0);
      });
      if (repeat === 'forward') { x += EG.repeatDotGap; dots('f'); }
      return { objects: out, w: x };
    }

    /* ---- one staff at one column: the events that start there on this staff -> local objects */
    function staffColumn(evs, staffId, mi, at, mId) {
      const clef = clefAt(staffId, mi, at, false);
      const mid = midOf(staffId);
      const objs = [];
      const notes = [], rests = [];
      evs.forEach(e => {
        if (e.hidden) return;
        if (e.kind === 'rest') { if (e.staff === staffId) rests.push(e); return; }
        const heads = e.heads.filter(h => (h.staff || e.staff) === staffId && (h.written || h.pos));
        if (heads.length) notes.push({ e: e, heads: heads, home: e.staff === staffId });
      });
      /* noteheads per event, seconds to the other side of the stem */
      const lay = notes.map(n => {
        const e = n.e;
        const scale = e.cue ? 0.75 : 1;
        const hs = n.heads.map(h => {
          /* the head the graph states, else the percussion kit's for its instrument (§14.6) */
          const shape = (h.notehead && h.notehead.shape) || (h.kit && h.kit.notehead) || null;
          const p = MT.notehead(e.type, shape, h.notehead ? h.notehead.filled : undefined);
          const name = glyphOf(p), g = MT.glyph(name);
          return { h: h, y: yOf(h.written || h.pos, clef), name: name, w: g.w * scale, g: g };
        });
        const hasStem = !STEMLESS[e.type] && e.stem !== 'none';
        let dir = dirOf.get(e.id) || NT.autoDir(hs.map(x => x.y), mid);
        /* a chord's heads on another staff (a cross-staff chord, deferred §14.4): a chord of their own there, its stem the
           other way */
        if (!n.home) dir = other(dir);
        const w = Math.max.apply(null, hs.map(x => x.w));
        const sorted = hs.slice().sort((a, b) => (dir === 'up' ? b.y - a.y : a.y - b.y) || idNum(a.h.id) - idNum(b.h.id));
        let prev = null;
        sorted.forEach(x => {
          x.side = prev && Math.abs(prev.y - x.y) < 1 - 1e-9 && prev.side === 0 ? 1 : 0;
          x.x = x.side ? (dir === 'up' ? w : -w) : 0;
          prev = x;
        });
        const beam = n.home && beamOf.has(e.id) && !graceBeam(beamOf.get(e.id)) ? beamOf.get(e.id) : null;
        return { e: e, hs: hs, dir: dir, w: w, dx: 0, hasStem: hasStem, scale: scale, home: n.home, beam: beam };
      });
      /* the staff-measure has two sounding voices or more: stems are not stretched to the middle line (in two-voice
         writing the middle-line rule gives way, or the stems would run into the other voice) */
      const poly = sounding2.has(staffId + '|' + mId);
      /* one event's stem and flag at an offset: where they are drawn, and what two voices must not overlap. A stem under a
         beam is taken long (the beam may lengthen it: BEAM_REACH) for that test. */
      const stemGeom = (L, dx, forClash) => {
        const e = L.e;
        const ys = L.hs.map(x => x.y), yTop = Math.min.apply(null, ys), yBot = Math.max.apply(null, ys);
        const sx = L.dir === 'up' ? L.w - EG.stem + dx : dx;
        const flags = MT.flagCount(e.type);
        let end;
        if (L.beam) end = L.dir === 'up' ? yTop - (forClash ? BEAM_REACH : NT.BEAM.stem) : yBot + (forClash ? BEAM_REACH : NT.BEAM.stem);
        else {
          const len = EG.stemLength + Math.max(0, flags - 2) * 0.5;
          end = L.dir === 'up' ? yTop - len : yBot + len;
          /* a stem from a ledger-line note reaches the middle line */
          if (!poly && L.dir === 'up' && end > mid) end = mid;
          if (!poly && L.dir === 'down' && end < mid) end = mid;
        }
        const stem = L.dir === 'up' ? [sx, end, sx + EG.stem, yBot] : [sx, yTop, sx + EG.stem, end];
        /* a flag at home only, and not on a note a beam holds */
        const fp = !L.home || beamOf.has(e.id) ? null : MT.flag(e.type, L.dir === 'up');
        let flag = null;
        if (fp) { const g = MT.glyph(fp.name); flag = { p: fp, box: MT.box(fp.name, sx - g.xMin, end) }; }
        return { sx: sx, end: end, yTop: yTop, yBot: yBot, stem: stem, flag: flag };
      };
      /* a head's box at an offset */
      const headBox = (x, dx, s) => MT.box(x.name, x.x + dx - x.g.xMin * s, x.y, s);
      /* `right`: the right edge of its heads and stem (a flag counts only where it reaches beside the other voice's heads,
         see the placement below) */
      const shapeOf = (L, dx) => {
        const heads = L.hs.map(x => headBox(x, dx, L.scale));
        const sg = L.hasStem ? stemGeom(L, dx, true) : null;
        return { heads: heads, stem: sg ? sg.stem : null, flag: sg && sg.flag ? sg.flag.box : null,
          right: Math.max.apply(null, heads.map(b => b[2]).concat(sg ? [sg.stem[2]] : [])) };
      };
      /* A and B clash (§10.3 H1, and a stem or flag through another voice's head): heads overlap, or a stem or flag
         crosses the other's head. `skip` names a shared unison's two heads, which coincide by design - and are each
         voice's own head, which its own stem and flag touch (G4c review R1: an up-stem flag reaching down to the shared
         head is not a clash). */
      const clash = (A, dxA, B, dxB, skip) => {
        const a = shapeOf(A, dxA), b = shapeOf(B, dxB);
        const sa = skip ? skip.get(A) : -1, sb = skip ? skip.get(B) : -1;
        for (let i = 0; i < a.heads.length; i++)
          for (let j = 0; j < b.heads.length; j++) if (!(i === sa && j === sb) && overlap(a.heads[i], b.heads[j])) return true;
        if (a.stem && b.heads.some((h, j) => j !== sb && overlap(a.stem, h))) return true;
        if (b.stem && a.heads.some((h, i) => i !== sa && overlap(b.stem, h))) return true;
        if (a.flag && b.heads.some((h, j) => j !== sb && overlap(a.flag, h))) return true;
        if (b.flag && a.heads.some((h, i) => i !== sa && overlap(b.flag, h))) return true;
        return false;
      };
      /* §14.2 unison: two voices, stems opposite, one pitch, the same head shape and the same dots share one head (each
         graph head keeps its object; the two have one box and name each other: `merged`) */
      const sharedOf = new Map();          /* L -> index of its shared head */
      const partnerHead = new Map();       /* head id -> partner head id */
      for (let i = 0; i < lay.length; i++) {
        for (let j = i + 1; j < lay.length; j++) {
          const A = lay[i], B = lay[j];
          if (sharedOf.has(A) || sharedOf.has(B) || A.dir === B.dir || A.e.voice === B.e.voice || A.e.dots !== B.e.dots || A.scale !== B.scale) continue;
          const cand = [];
          A.hs.forEach((a, ia) => B.hs.forEach((b, ib) => {
            const wa = a.h.written, wb = b.h.written;
            if (Math.abs(a.y - b.y) < 1e-9 && a.name === b.name && a.x === 0 && b.x === 0 && (!wa || !wb || wa.alter === wb.alter) &&
              (!a.h.acc || !b.h.acc || a.h.acc.type === b.h.acc.type)) cand.push([ia, ib]);
          }));
          if (cand.length !== 1) continue;
          const skip = new Map([[A, cand[0][0]], [B, cand[0][1]]]);
          if (clash(A, 0, B, 0, skip)) continue;
          sharedOf.set(A, cand[0][0]); sharedOf.set(B, cand[0][1]);
          const ha = A.hs[cand[0][0]].h.id, hb = B.hs[cand[0][1]].h.id;
          partnerHead.set(ha, hb); partnerHead.set(hb, ha);
        }
      }
      /* §14.2 and G4-C3: voices that would clash stand side by side - the up-stem voice keeps its place and the down-stem
         one moves right, a head's width and 0.2 sp (Gould's "offset the lower part to the right", VexFlow 4.2.3's
         StaveNote.format); a voice that crosses the other's stems moves too; a third voice moves past both */
      const skipAll = new Map([...sharedOf.entries()]);
      const order = lay.slice().sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'up' ? -1 : 1) || idNum(a.e.id) - idNum(b.e.id));
      const placed = [];
      order.forEach(L => {
        let dx = 0;
        for (let guard = 0; guard <= placed.length; guard++) {
          const hit = placed.filter(P => {
            /* a shared head is skipped only while the two stand at one place (a voice moved for a third one shares no more) */
            const shared = dx === P.dx && sharedOf.has(P) && sharedOf.has(L) && partnerHead.get(P.hs[sharedOf.get(P)].h.id) === L.hs[sharedOf.get(L)].h.id;
            return clash(P, P.dx, L, dx, shared ? skipAll : null);
          });
          if (!hit.length) break;
          /* past the voice it meets - its heads and stem, and its flag only where the flag reaches down (or up) beside this
             voice's heads (G4c review R1: a second below an up-stem eighth goes a head's width over, not past the flag
             above it) - and VexFlow's 0.2 sp more (StaveNote.format shifts by the head's width + 2 px at 10 px a space) */
          const own = L.hs.map(x => headBox(x, 0, L.scale));
          const reach = P => {
            const s = shapeOf(P, P.dx);
            return s.flag && own.some(h => s.flag[1] < h[3] - SK.EPS && h[1] < s.flag[3] - SK.EPS) ? Math.max(s.right, s.flag[2]) : s.right;
          };
          dx = Math.max(dx, Math.max.apply(null, hit.map(reach)) + VOICE_GAP - Math.min.apply(null, L.hs.map(a => a.x)));
        }
        L.dx = dx;
        placed.push(L);
      });
      /* a unison whose voice had to move for a third voice is not shared after all: its two heads stand apart (the G4c
         review R2's merge check found one, for-all-the-saints m. 10 - the heads kept naming each other) */
      [...sharedOf.keys()].forEach(L => {
        const hid = L.hs[sharedOf.get(L)].h.id, pid = partnerHead.get(hid);
        const P = pid === undefined ? null : lay.find(x => x !== L && sharedOf.has(x) && x.hs[sharedOf.get(x)].h.id === pid);
        if (P && P.dx !== L.dx) { partnerHead.delete(hid); partnerHead.delete(pid); }
      });
      /* heads, stems, flags, ledger lines */
      lay.forEach(L => {
        const e = L.e;
        L.hs.forEach(x => {
          const o = { id: x.h.id, kind: 'notehead', refs: [e.id, x.h.id], event: e.id, glyph: x.name, scale: L.scale,
            box: headBox(x, L.dx, L.scale), layer: 'note' };
          if (partnerHead.has(x.h.id)) o.merged = [partnerHead.get(x.h.id)];
          objs.push(o);
          /* a head in parentheses (§6 notehead paren, G4d-1a): one either side */
          if (x.h.notehead && x.h.notehead.paren) {
            const gl = MT.glyph('noteheadParenthesisLeft'), gr = MT.glyph('noteheadParenthesisRight'), s = L.scale, b = o.box;
            objs.push({ id: x.h.id + '#paren.l', kind: 'paren', refs: [e.id, x.h.id], event: e.id, glyph: 'noteheadParenthesisLeft', scale: s,
              box: MT.box('noteheadParenthesisLeft', b[0] - PAREN_GAP * s - gl.xMax * s, x.y, s), layer: 'note' });
            objs.push({ id: x.h.id + '#paren.r', kind: 'paren', refs: [e.id, x.h.id], event: e.id, glyph: 'noteheadParenthesisRight', scale: s,
              box: MT.box('noteheadParenthesisRight', b[2] + PAREN_GAP * s - gr.xMin * s, x.y, s), layer: 'note' });
          }
        });
        const ys = L.hs.map(x => x.y), yTop = Math.min.apply(null, ys), yBot = Math.max.apply(null, ys);
        if (L.hasStem) {
          const flags = MT.flagCount(e.type);
          const sg = stemGeom(L, L.dx, false);
          /* a stem of a cross-staff chord's other staff is named for that staff (G4b review R5) */
          const sid = L.home ? e.id + '#stem' : e.id + '#stem:' + staffId;
          if (L.beam) {
            /* under a beam: the layout sets its length once the beam is placed (§11.2) */
            objs.push({ id: sid, kind: 'stem', refs: [e.id], event: e.id, dir: L.dir, beam: L.beam.id, box: sg.stem, layer: 'note',
              _tip: L.dir === 'up' ? yTop : yBot, _far: L.dir === 'up' ? yBot : yTop, _n: Math.max(1, flags), _dots: e.dots || 0, _beat: beatOf(mi, e.at),
              _mid: mid, _poly: poly });
          } else {
            objs.push({ id: sid, kind: 'stem', refs: [e.id], event: e.id, dir: L.dir, box: sg.stem, layer: 'note' });
            if (sg.flag) {
              const name = glyphOf(sg.flag.p);
              objs.push({ id: e.id + '#flag', kind: 'flag', refs: [e.id], event: e.id, glyph: name, box: sg.flag.box, layer: 'note' });
            }
          }
        }
        /* ledger lines above and below the staff, under this event's heads */
        const x0 = Math.min.apply(null, L.hs.map(x => x.x + L.dx)) - EG.ledgerOverhang;
        const x1 = Math.max.apply(null, L.hs.map(x => x.x + L.dx + x.w)) + EG.ledgerOverhang;
        for (let ly = -1; ly >= Math.ceil(yTop - 1e-9); ly--) {
          objs.push({ id: e.id + '#ledger' + staffId + ':' + ly, kind: 'ledger', refs: [e.id], event: e.id, box: [x0, ly - EG.ledger / 2, x1, ly + EG.ledger / 2], layer: 'note' });
        }
        for (let ly = 5; ly <= Math.floor(yBot + 1e-9); ly++) {
          objs.push({ id: e.id + '#ledger' + staffId + ':' + ly, kind: 'ledger', refs: [e.id], event: e.id, box: [x0, ly - EG.ledger / 2, x1, ly + EG.ledger / 2], layer: 'note' });
        }
      });
      /* rests at their standard height (§14.3): the graph's display position, else a whole rest hanging from the fourth
         line, a half rest on the middle line, the others centred; the layout moves a voice's rest clear of the other
         voices once it knows the beams. A whole-measure rest is a whole rest, without dots, centred in its measure. Two
         voices resting together for the same time are one rest (both objects at one place, naming each other). */
      const restY = new Map();
      const merge = rests.length >= 2 && !lay.length && rests.every(e => !e.restPos && e.dur === rests[0].dur && e.type === rests[0].type &&
        (e.dots || 0) === (rests[0].dots || 0) && wholeBar(e) === wholeBar(rests[0]));
      rests.forEach(e => {
        const bar = wholeBar(e);
        const name = glyphOf(bar ? MT.rest(R.toNumber(R.parse(e.dur)) >= 2 - 1e-9 ? 'breve' : 'whole') : MT.rest(e.type || 'quarter')), g = MT.glyph(name);
        const whole = name === 'restWhole' || name === 'restDoubleWhole';
        const y = e.restPos ? yOf(e.restPos, clef) : whole ? mid - 1 : mid;
        const o = { id: e.id, kind: 'rest', refs: [e.id], event: e.id, glyph: name, center: bar, box: MT.box(name, -g.xMin, y), layer: 'note' };
        if (merge) o.merged = rests.filter(x => x !== e).map(x => x.id);
        objs.push(o);
        restY.set(e.id, y);
      });
      /* accidentals: every one of this column and staff, stacked in columns to the left, top to bottom; a shared unison
         whose two heads state one accidental shows it once (both objects at one place) */
      const accs = [];
      const accOf = new Map();
      lay.forEach(L => L.hs.forEach(x => {
        if (!x.h.acc) return;
        const parts = MT.accidental(x.h.acc.type).map(p => glyphOf(p));
        /* an editorial accidental in square brackets, one in parentheses (a cautionary one as stated: parentheses only when
           the graph says so) - G4d-1a */
        if (x.h.acc.bracket) { parts.unshift('accidentalBracketLeft'); parts.push('accidentalBracketRight'); }
        else if (x.h.acc.paren) { parts.unshift('accidentalParensLeft'); parts.push('accidentalParensRight'); }
        const gs = parts.map(n => MT.glyph(n));
        const w = gs.reduce((a, g) => a + g.w, 0) * L.scale + (gs.length - 1) * 0.05;
        const top = x.y - Math.max.apply(null, gs.map(g => g.yMax)) * L.scale, bot = x.y - Math.min.apply(null, gs.map(g => g.yMin)) * L.scale;
        const a = { h: x.h, e: L.e, y: x.y, parts: parts, gs: gs, w: w, top: top, bot: bot, scale: L.scale };
        const partner = partnerHead.get(x.h.id);
        if (partner && accOf.has(partner) && accOf.get(partner).parts.join() === parts.join()) { accOf.get(partner).twin = a; return; }
        accOf.set(x.h.id, a);
        accs.push(a);
      }));
      if (accs.length) {
        const headLeft = Math.min.apply(null, objs.filter(o => o.kind === 'notehead' || o.kind === 'paren').map(o => o.box[0]).concat([0]));
        accs.sort((a, b) => a.y - b.y || idNum(a.h.id) - idNum(b.h.id));
        const cols = [];
        accs.forEach(a => {
          let c = 0;
          while (cols[c] && cols[c].some(o => a.top < o.bot + 0.1 && o.top < a.bot + 0.1)) c++;
          (cols[c] = cols[c] || []).push(a);
          a.col = c;
        });
        let right = headLeft - EG.accidentalGap;
        cols.forEach(col => {
          const cw = Math.max.apply(null, col.map(a => a.w));
          col.forEach(a => {
            let x = right - a.w;
            a.parts.forEach((n, k) => {
              const g = a.gs[k];
              const box = MT.box(n, x - g.xMin * a.scale, a.y, a.scale);
              const accId = t => t.h.id + '#acc' + (a.parts.length > 1 ? k : '');
              [a].concat(a.twin ? [a.twin] : []).forEach((t, ti, all) => {
                const o = { id: accId(t), kind: 'accidental', refs: [t.h.id], event: t.e.id, glyph: n, scale: a.scale, box: box.slice(), layer: 'note' };
                if (all.length > 1) o.merged = [accId(all[1 - ti])];
                objs.push(o);
              });
              x += g.w * a.scale + 0.05;
            });
          });
          right -= cw + EG.accidentalGap;
        });
      }
      /* dots after every head of the column (a second voice's heads included), on the space; where an up-stem flag
         reaches down beside the heads, after the flag. A shared unison's two events dot the same space. A
         whole-measure rest has none (R6). */
      const heads = objs.filter(o => o.kind === 'notehead' || o.kind === 'rest' || o.kind === 'paren');
      const dot = MT.glyph('augmentationDot');
      const dotted = [];
      lay.concat(rests.map(e => ({ e: e, rest: true }))).forEach(L => {
        const e = L.e;
        if (!e.dots || (L.rest && wholeBar(e))) return;
        const ys = L.rest ? [restY.get(e.id)] : L.hs.map(x => x.y);
        const down = roleOf.get(staffId + '|' + mId + '|' + e.voice) === 'down';
        const seen = new Set();
        ys.forEach((y, hi) => {
          const onLine = Math.abs(y - Math.round(y)) < 1e-9;
          const sharedHead = !L.rest && partnerHead.has(L.hs[hi].h.id);
          const dy = onLine ? (down && !sharedHead ? y + 0.5 : y - 0.5) : y;
          if (seen.has(dy)) return;
          seen.add(dy);
          dotted.push({ id: L.rest ? e.id : L.hs[hi].h.id, e: e, y: dy });
        });
      });
      let dotX = (heads.length ? Math.max.apply(null, heads.map(o => o.box[2])) : 0) + EG.dotGap;
      objs.forEach(f => {
        if (f.kind !== 'flag' || f.box[2] <= dotX) return;
        if (dotted.some(d => d.y + dot.yMax > f.box[1] && d.y + dot.yMin < f.box[3])) dotX = Math.max(dotX, f.box[2] + EG.dotSpacing);
      });
      dotted.forEach(d => {
        for (let k = 0; k < d.e.dots; k++) {
          const x = dotX + k * (dot.w + EG.dotSpacing);
          objs.push({ id: d.id + '#dot' + k, kind: 'dot', refs: [d.e.id], event: d.e.id, glyph: 'augmentationDot',
            box: MT.box('augmentationDot', x - dot.xMin, d.y), layer: 'note' });
        }
      });
      /* a breath mark or caesura after its note, above the staff (G4d-1a) */
      lay.forEach(L => (L.e.arts || []).forEach((a, i) => {
        if (!L.home || !MK.HORIZONTAL[a]) return;
        const name = a === 'caesura' ? 'caesura' : 'breathMarkComma', g = MT.glyph(name);
        const x0 = Math.max.apply(null, objs.map(o => o.box[2]).concat([0])) + BREATH.gap;
        const ref = L.e.id + '#art' + i;
        objs.push({ id: ref, kind: 'articulation', refs: [L.e.id, ref], event: L.e.id, glyph: name, side: 'above',
          box: MT.box(name, x0 - g.xMin, (a === 'caesura' ? BREATH.caesura : BREATH.comma) + g.yMin), layer: 'mark' });
      }));
      /* arpeggios (§6, G4d-1a): a wavy line - an arrow at its top or bottom for a stated direction - or, against
         arpeggiating, a bracket, left of the chord and its accidentals, past its end heads; one part per staff it reaches,
         the arrow on the end it points to */
      const arps = new Map();
      lay.forEach(L => L.hs.forEach(x => {
        const a = arpOf.get(x.h.id);
        if (!a) return;
        if (!arps.has(a.id)) arps.set(a.id, { a: a, ys: [], e: L.e });
        arps.get(a.id).ys.push(x.y);
      }));
      if (arps.size) {
        let right = Math.min.apply(null, objs.map(o => o.box[0]).concat([0])) - ARP.gap;
        [...arps.values()].sort((p, q) => idNum(p.a.id) - idNum(q.a.id)).forEach(({ a, ys, e }) => {
          const staves = arpStaves.get(a.id) || [staffId];
          const top = a.dir === 'up' && staves[0] === staffId, bottom = a.dir === 'down' && staves[staves.length - 1] === staffId;
          const w = a.non ? ARP.nonW : ARP.w, xc = right - w / 2;
          const y0 = Math.min.apply(null, ys) - 0.5 - ARP.over, y1 = Math.max.apply(null, ys) + 0.5 + ARP.over;
          const o = { id: staves[0] === staffId ? a.id : a.id + ':' + staffId, kind: 'arpeggio', refs: [a.id], event: e.id, line: [xc, y0, xc, y1],
            box: [right - w, y0 - (top ? ARP.arrow : 0), right, y1 + (bottom ? ARP.arrow : 0)], layer: 'note' };
          if (top || bottom) o.dir = top ? 'up' : 'down';
          if (a.non) o.non = true;
          objs.push(o);
          right -= w + ARP.gap;
        });
      }
      /* grace notes of these events, to the left, at 0.66 (§14.5): heads, accidentals and ledger lines, stems (the
         graph's direction, the voice's, else up), flags, a slash for an acciaccatura, and the beam of a group the graph
         beams */
      const graceObjs = [];
      lay.concat(rests.map(e => ({ e: e }))).forEach(L => {
        const gl = gracesOf.get(principalKey(L.e));
        if (!gl) return;
        const s = MT.SCALE.grace;
        let right = Math.min.apply(null, objs.map(o => o.box[0]).concat([0])) - EG.graceGap;
        const units = [];
        for (let i = gl.length - 1; i >= 0; i--) {
          const ge = gl[i];
          const gh = ge.heads.filter(h => (h.staff || ge.staff) === staffId && (h.written || h.pos));
          if (!gh.length) continue;
          const nm = glyphOf(MT.notehead(ge.type, null)), g = MT.glyph(nm);
          const ys = gh.map(h => yOf(h.written || h.pos, clef));
          const yTop = Math.min.apply(null, ys), yBot = Math.max.apply(null, ys);
          const dir = dirOf.get(ge.id) || 'up';
          const home = (ge.staff === staffId);
          const beam = home && beamOf.has(ge.id) && graceBeam(beamOf.get(ge.id)) ? beamOf.get(ge.id) : null;
          /* the unit built at x = 0, then moved so it ends where the next one (or the principal) begins */
          const u = [];
          gh.forEach((h, k) => {
            const y = ys[k];
            u.push({ id: h.id, kind: 'notehead', grace: true, refs: [ge.id, h.id], event: ge.id, glyph: nm, scale: s, box: MT.box(nm, -g.xMin * s, y, s), layer: 'note' });
            if (h.acc) {
              const an = glyphOf(MT.accidental(h.acc.type)[0]), ag = MT.glyph(an);
              const ax = -EG.accidentalGap * s - ag.w * s;
              u.push({ id: h.id + '#acc', kind: 'accidental', grace: true, refs: [h.id], event: ge.id, glyph: an, scale: s, box: MT.box(an, ax - ag.xMin * s, y, s), layer: 'note' });
            }
            if (y <= -1 || y >= 5) {
              const lx0 = -EG.ledgerOverhang * s, lx1 = g.w * s + EG.ledgerOverhang * s;
              for (let ly = -1; ly >= Math.ceil(y - 1e-9); ly--) u.push({ id: ge.id + '#ledger' + ly + ':' + h.id, kind: 'ledger', grace: true, refs: [ge.id], event: ge.id,
                box: [lx0, ly - EG.ledger / 2, lx1, ly + EG.ledger / 2], layer: 'note' });
              for (let ly = 5; ly <= Math.floor(y + 1e-9); ly++) u.push({ id: ge.id + '#ledger' + ly + ':' + h.id, kind: 'ledger', grace: true, refs: [ge.id], event: ge.id,
                box: [lx0, ly - EG.ledger / 2, lx1, ly + EG.ledger / 2], layer: 'note' });
            }
          });
          let stem = null;
          if (home && !STEMLESS[ge.type] && ge.stem !== 'none') {
            const sw = EG.stem * s, len = EG.stemLength * s;
            const sx = dir === 'up' ? g.w * s - sw : 0;
            const end = dir === 'up' ? yTop - len : yBot + len;
            stem = { id: ge.id + '#stem', kind: 'stem', grace: true, refs: [ge.id], event: ge.id, dir: dir, scale: s,
              box: dir === 'up' ? [sx, end, sx + sw, yBot] : [sx, yTop, sx + sw, end], layer: 'note',
              _tip: dir === 'up' ? yTop : yBot, _far: dir === 'up' ? yBot : yTop, _n: Math.max(1, MT.flagCount(ge.type)), _dots: ge.dots || 0, _beat: 0 };
            u.push(stem);
            const fp = beam ? null : MT.flag(ge.type, dir === 'up');
            if (fp) {
              const name = glyphOf(fp), fg = MT.glyph(name);
              u.push({ id: ge.id + '#flag', kind: 'flag', grace: true, refs: [ge.id], event: ge.id, glyph: name, scale: s, box: MT.box(name, sx - fg.xMin * s, end, s), layer: 'note' });
            }
          }
          /* a dotted grace note's dots, small, after its heads on their spaces - after its flag where the flag reaches */
          if (ge.dots) {
            const dg = MT.glyph('augmentationDot'), seen = new Set();
            const flagBox = (u.find(o => o.kind === 'flag') || {}).box;
            ys.forEach(y => {
              const dy = Math.abs(y - Math.round(y)) < 1e-9 ? y - 0.5 : y;
              if (seen.has(dy)) return;
              seen.add(dy);
              let x0 = g.w * s + EG.dotGap * s;
              if (flagBox && dy + dg.yMax * s > flagBox[1] && dy + dg.yMin * s < flagBox[3]) x0 = Math.max(x0, flagBox[2] + EG.dotSpacing * s);
              for (let k = 0; k < ge.dots; k++) {
                const dx0 = x0 + k * (dg.w + EG.dotSpacing) * s;
                u.push({ id: ge.id + '#dot' + (seen.size - 1) + '.' + k, kind: 'dot', grace: true, refs: [ge.id], event: ge.id, glyph: 'augmentationDot', scale: s,
                  box: MT.box('augmentationDot', dx0 - dg.xMin * s, dy, s), layer: 'note' });
              }
            });
          }
          const ext = SK.union(u.map(o => o.box));
          const dx = right - ext[2];
          u.forEach(o => { o.box = shift(o.box, dx, 0); });
          right = ext[0] + dx - EG.graceGap;
          units.push({ ge: ge, objs: u, stem: stem, beam: beam, dir: dir });
        }
        units.reverse();
        /* grace beams: the graph's beams over grace notes of this group */
        const done = new Set();
        units.forEach(un => {
          if (!un.beam || done.has(un.beam.id)) return;
          done.add(un.beam.id);
          const ms = units.filter(x => x.beam === un.beam && x.stem).map(x => x.stem);
          if (ms.length < 2) {
            ms.forEach(st => {
              const ev = evById.get(st.event), fp = MT.flag(ev.type, st.dir === 'up');
              if (!fp) return;
              const name = glyphOf(fp), fg = MT.glyph(name), sEnd = st.dir === 'up' ? st.box[1] : st.box[3];
              graceObjs.push({ id: st.event + '#flag', kind: 'flag', grace: true, refs: [st.event], event: st.event, glyph: name, scale: s,
                box: MT.box(name, st.box[0] - fg.xMin * s, sEnd, s), layer: 'note' });
            });
            return;
          }
          const members = ms.map(st => ({ x0: st.box[0], sw: st.box[2] - st.box[0], n: st._n, dots: st._dots, beat: st._beat, far: st._far, tip: st._tip, stem: st }));
          const brk = new Map();
          (un.beam.breaks || []).forEach(b => { const j = ms.findIndex(st => st.event === b.after); if (j >= 0) brk.set(j, Math.min(brk.has(j) ? brk.get(j) : Infinity, b.level)); });
          const sh = NT.beamShapes(members, ms[0].dir, brk, { scale: s, mid: mid, reachMiddle: false });
          sh.beams.forEach(bm => {
            const idx = un.beam.events.indexOf(ms[bm.from].event);
            graceObjs.push({ id: un.beam.id + '#L' + bm.level + '.' + idx + (bm.hook ? 'h' : ''), kind: 'beam', grace: true, refs: [un.beam.id],
              events: ms.slice(bm.from, bm.to + 1).map(st => st.event), level: bm.level, dir: ms[0].dir, hook: bm.hook || undefined,
              line: bm.line, t: bm.t, box: bm.box, layer: 'note' });
          });
        });
        /* the slash of an acciaccatura: across its stem near the end (for a beamed group, the first stem only) */
        units.forEach(un => {
          if (!un.ge.grace.slash || !un.stem) return;
          if (un.beam && units.filter(x => x.beam === un.beam && x.stem)[0] !== un) return;
          const st = un.stem, up = st.dir === 'up', tipY = up ? st.box[1] : st.box[3], sx = st.box[0];
          const sy = v => (up ? tipY + v * s : tipY - v * s);
          const line = [sx + SLASH.x0 * s, sy(SLASH.y0), sx + SLASH.x1 * s, sy(SLASH.y1)];
          const t = SLASH.t * s;
          graceObjs.push({ id: un.ge.id + '#slash', kind: 'slash', grace: true, refs: [un.ge.id], event: un.ge.id, line: line, t: t,
            box: [Math.min(line[0], line[2]), Math.min(line[1], line[3]) - t / 2, Math.max(line[0], line[2]), Math.max(line[1], line[3]) + t / 2], layer: 'note' });
        });
        units.forEach(un => un.objs.forEach(o => graceObjs.push(o)));
      });
      const all = objs.concat(graceObjs);
      const ext = extent(all);
      /* printed fingering stands centred over its heads (marks.js): a finger wider than the head widens the column (G04 §9:
         the fingering text is in the spacing) */
      lay.forEach(L => {
        let fw = 0;
        L.hs.forEach(x => (x.h.fingering || []).forEach(f => String(f && f.f !== undefined && f.f !== null ? f.f : '').split(/\r?\n/).forEach(t => {
          if (t.trim()) fw = Math.max(fw, TX.measure(t, MK.FINGER.font, MK.FINGER.size).w);
        })));
        if (!fw) return;
        const cx = L.dx + L.w / 2;
        ext.left = Math.max(ext.left, fw / 2 - cx);
        ext.right = Math.max(ext.right, cx + fw / 2);
      });
      const tie = evs.some(e => e.heads && e.heads.some(h => (h.staff || e.staff) === staffId && tieFrom.has(h.id)));
      return { objects: all, left: ext.left, right: ext.right, tie: tie };
    }

    /* ---- measures */
    const measures = plan.measures.map((m, mi) => {
      const evs = evByM.get(m.id).filter(e => !e.grace);
      const dur = R.toNumber(R.parse(m.dur));
      const toNum = s => { const q = R.parse(s); return q.n / q.d; };
      /* time columns: every onset; clef and key columns: a mid-measure change, just before the notes at its time (clef
         first, then key, as at a bar line) */
      const ats = [];
      evs.forEach(e => { if (!ats.some(a => R.eq(R.parse(a), R.parse(e.at)))) ats.push(R.format(R.parse(e.at))); });
      if (!ats.length) ats.push('0');
      ats.sort(byAt);
      const midKeys = keys.filter(k => k.m === m.id && !R.isZero(R.parse(k.at)) && !k.hidden);
      const cols = [];
      const changesAt = a => {
        plan.clefs.filter(c => c.m === m.id && !R.isZero(R.parse(c.at)) && R.eq(R.parse(c.at), R.parse(a)) && staffById.has(c.staff))
          .sort((x, y) => staffById.get(x.staff).index - staffById.get(y.staff).index)
          .forEach(c => cols.push({ at: R.format(R.parse(a)), time: false, clef: c }));
        midKeys.filter(k => R.eq(R.parse(k.at), R.parse(a))).forEach(k => cols.push({ at: R.format(R.parse(a)), time: false, key: k }));
      };
      ats.forEach(a => { changesAt(a); cols.push({ at: a, time: true }); });
      /* changes at a time no note starts */
      const loose = [];
      plan.clefs.filter(c => c.m === m.id && !R.isZero(R.parse(c.at)) && staffById.has(c.staff)).forEach(c => loose.push(R.format(R.parse(c.at))));
      midKeys.forEach(k => loose.push(R.format(R.parse(k.at))));
      loose.filter((a, i) => loose.indexOf(a) === i && !ats.some(x => R.eq(R.parse(x), R.parse(a)))).sort(byAt).forEach(changesAt);
      cols.sort((x, y) => byAt(x.at, y.at) || (x.time === y.time ? 0 : x.time ? 1 : -1));
      cols.forEach(col => {
        col.atW = toNum(col.at);
        col.staves = {};
        col.objects = [];
        if (!col.time && col.clef) {
          const c = col.clef;
          const it = clefItems(c, c.id, MT.SCALE.clefChange);
          const ext = extent(it.objects);
          col.staves[c.staff] = { left: 0, right: ext.right };
          it.objects.forEach(o => { o.staffKey = c.staff; col.objects.push(o); });
          col.left = 0; col.right = ext.right; col.tie = false;
          return;
        }
        if (!col.time && col.key) {
          /* a key change inside the measure (§15.4): on every staff, cancelling what the key before it drops */
          const k = col.key;
          const prev = keyIn(mi, k.at, true);
          let w = 0;
          staves.forEach(s => {
            const it = keyItems(k.fifths, shown(prev), clefAt(s.id, mi, k.at, false), k.id + ':' + s.id, [k.id]);
            it.objects.forEach(o => { o.staffKey = s.id; col.objects.push(o); });
            col.staves[s.id] = { left: 0, right: it.w + GAP.startItem };
            w = Math.max(w, it.w);
          });
          col.left = 0; col.right = w ? w + GAP.startItem : 0; col.tie = false;
          return;
        }
        let left = 0, right = 0, tie = false;
        staves.forEach(s => {
          const here = evs.filter(e => R.eq(R.parse(e.at), R.parse(col.at)) && (e.staff === s.id || e.heads.some(h => h.staff === s.id)));
          if (!here.length) return;
          const sc = staffColumn(here, s.id, mi, col.at, m.id);
          col.staves[s.id] = { left: sc.left, right: sc.right };
          sc.objects.forEach(o => { o.staffKey = s.id; col.objects.push(o); });
          left = Math.max(left, sc.left); right = Math.max(right, sc.right);
          tie = tie || sc.tie;
        });
        col.left = left; col.right = right; col.tie = tie;
      });
      /* springs: between columns, then from the last column to the barline */
      const springs = [];
      for (let i = 0; i < cols.length; i++) {
        const a = cols[i], b = cols[i + 1];
        if (b) {
          let rod = 0;
          staves.forEach(s => { rod = Math.max(rod, ((a.staves[s.id] || {}).right || 0) + ((b.staves[s.id] || {}).left || 0)); });
          rod += GAP.rod;
          if (a.tie) rod = Math.max(rod, GAP.tie);
          springs.push({ g: SP.factor(b.atW - a.atW), rod: rod });
        } else {
          let rod = a.right + GAP.beforeBar;
          if (a.tie) rod = Math.max(rod, GAP.tie);
          springs.push({ g: SP.factor(dur - a.atW), rod: rod });
        }
      }
      const barlineStyle = m.barline && m.barline.right ? m.barline.right : null;
      const leftBar = m.barline && m.barline.left ? m.barline.left : null;
      return { id: m.id, number: m.number, index: mi, start: toNum(m.start), dur: dur, cols: cols, springs: springs,
        leftBar: leftBar, rightBar: barlineStyle };
    });

    /* ---- per measure: its system head (if a system starts there), start items (mid-system), trailing clef,
       courtesy key/time (if a system ends before the next), right barline */
    measures.forEach((M, mi) => {
      const meter = meterAt(mi), key = keyAt(mi);
      const showTime = mi === 0 || !!meterChangeAt(mi);
      /* system head, per staff, in aligned columns: clef | key | time */
      const perStaff = staves.map(s => {
        const c = clefAt(s.id, mi, '0', false);
        return { s: s, clef: clefItems(c, 'd:clef:' + s.id + ':' + M.id, 1, c ? [c.id] : []),
          key: shown(key) ? keyItems(key.fifths, 0, c, 'd:keysig:' + s.id + ':' + M.id, [key.id]) : { objects: [], w: 0 },
          time: showTime ? timeItems(meter, 'd:timesig:' + s.id + ':' + M.id) : { objects: [], w: 0 } };
      });
      const cw = Math.max.apply(null, perStaff.map(p => p.clef.w).concat([0]));
      const kw = Math.max.apply(null, perStaff.map(p => p.key.w).concat([0]));
      const tw = Math.max.apply(null, perStaff.map(p => p.time.w).concat([0]));
      const head = { objects: [], w: 0 };
      let x = GAP.headStart;
      const cx = x; x += cw;
      const kx = kw ? x + GAP.headItem : x; if (kw) x = kx + kw;
      const tx = tw ? x + GAP.headItem : x; if (tw) x = tx + tw;
      perStaff.forEach(p => {
        p.clef.objects.forEach(o => head.objects.push(Object.assign({}, o, { staffKey: p.s.id, box: shift(o.box, cx, 0) })));
        p.key.objects.forEach(o => head.objects.push(Object.assign({}, o, { staffKey: p.s.id, box: shift(o.box, kx, 0) })));
        p.time.objects.forEach(o => head.objects.push(Object.assign({}, o, { staffKey: p.s.id, box: shift(o.box, tx + (tw - p.time.w) / 2, 0) })));
      });
      head.w = x;
      M.head = head;
      /* a forward repeat or a stated left bar line: at a system's start after its head; inside a system it takes the
         place of the bar line before it when that one is plain */
      M.open = { objects: [], w: 0 };
      if (M.leftBar && (M.leftBar.repeat === 'forward' || (M.leftBar.style && M.leftBar.style !== 'regular' && M.leftBar.style !== 'none'))) {
        const items = staves.map(s => barItems(M.leftBar.style || 'heavy-light', M.leftBar.repeat, M.id + '#bar.left:' + s.id, [M.id], s.lines));
        M.open.w = Math.max.apply(null, items.map(b => b.w));
        items.forEach((b, i) => b.objects.forEach(o => M.open.objects.push(Object.assign({}, o, { staffKey: staves[i].id }))));
      }
      const prevBar = mi > 0 ? measures[mi - 1].rightBar : null;
      M.replacesBar = M.open.w > 0 && (!prevBar || (!prevBar.repeat && (!prevBar.style || prevBar.style === 'regular')));
      /* a key or time change inside a system, after the bar line: each item a startItem gap after what precedes it */
      const kc = mi > 0 ? keyChangeAt(mi) : null, mc = mi > 0 ? meterChangeAt(mi) : null;
      const prevKey = mi > 0 ? keyAtEnd(mi - 1) : null;
      const start = { objects: [], w: 0 };
      let sx = 0;
      if (kc && !kc.hidden) {
        const items = staves.map(s => keyItems(kc.fifths, shown(prevKey), clefAt(s.id, mi, '0', false), kc.id + ':' + s.id, [kc.id]));
        const w = Math.max.apply(null, items.map(i => i.w));
        if (w) {
          sx += GAP.startItem;
          items.forEach((it, i) => it.objects.forEach(o => start.objects.push(Object.assign({}, o, { staffKey: staves[i].id, box: shift(o.box, sx, 0) }))));
          sx += w;
        }
      }
      if (mc && !mc.hidden) {
        const items = staves.map(s => timeItems(mc, mc.id + ':' + s.id));
        const w = Math.max.apply(null, items.map(i => i.w));
        if (w) {
          sx += GAP.startItem;
          items.forEach((it, i) => it.objects.forEach(o => start.objects.push(Object.assign({}, o, { staffKey: staves[i].id, box: shift(o.box, sx + (w - it.w) / 2, 0) }))));
          sx += w;
        }
      }
      start.w = sx;
      M.start = start;
      /* trailing: a clef change at the next measure's start is drawn at this measure's end, before the barline (§15.4) */
      const trailing = { objects: [], w: 0 };
      if (mi + 1 < measures.length) {
        const nextId = measures[mi + 1].id;
        const changes = plan.clefs.filter(c => c.m === nextId && R.isZero(R.parse(c.at)) && staffById.has(c.staff) && mi + 1 > 0);
        const items = changes.filter(c => {
          const before = clefAt(c.staff, mi + 1, '0', true);
          return !before || before.sign !== c.sign || (before.line || 0) !== (c.line || 0) || (before.octave || 0) !== (c.octave || 0);
        }).map(c => ({ c: c, it: clefItems(c, c.id, MT.SCALE.clefChange) }));
        const w = Math.max.apply(null, items.map(i => i.it.w).concat([0]));
        if (w) {
          items.forEach(({ c, it }) => it.objects.forEach(o => trailing.objects.push(Object.assign({}, o, { staffKey: c.staff, box: shift(o.box, GAP.trailing, 0) }))));
          trailing.w = GAP.trailing + w + GAP.trailing;
        }
      }
      M.trailing = trailing;
      /* the right barline */
      const bars = staves.map(s => barItems(M.rightBar ? M.rightBar.style || 'regular' : 'regular', M.rightBar ? M.rightBar.repeat : null,
        M.id + '#bar.right:' + s.id, [M.id], s.lines));
      M.bar = { objects: [], w: Math.max.apply(null, bars.map(b => b.w).concat([EG.thinBar])) };
      bars.forEach((b, i) => b.objects.forEach(o => M.bar.objects.push(Object.assign({}, o, { staffKey: staves[i].id }))));
      /* courtesy key/time after the last barline of a system, when the next measure changes them */
      const courtesy = { objects: [], w: 0 };
      if (mi + 1 < measures.length) {
        const nk = keyChangeAt(mi + 1), nm = meterChangeAt(mi + 1);
        let cx2 = 0;
        if (nk && !nk.hidden) {
          const items = staves.map(s => keyItems(nk.fifths, shown(keyAtEnd(mi)), clefAt(s.id, mi + 1, '0', false), nk.id + ':courtesy:' + s.id, [nk.id]));
          const w = Math.max.apply(null, items.map(i => i.w));
          if (w) { cx2 += GAP.courtesy; items.forEach((it, i) => it.objects.forEach(o => courtesy.objects.push(Object.assign({}, o, { staffKey: staves[i].id, courtesy: true, box: shift(o.box, cx2, 0) })))); cx2 += w; }
        }
        if (nm && !nm.hidden) {
          const items = staves.map(s => timeItems(nm, nm.id + ':courtesy:' + s.id));
          const w = Math.max.apply(null, items.map(i => i.w));
          if (w) { cx2 += GAP.courtesy; items.forEach((it, i) => it.objects.forEach(o => courtesy.objects.push(Object.assign({}, o, { staffKey: staves[i].id, courtesy: true, box: shift(o.box, cx2 + (w - it.w) / 2, 0) })))); cx2 += w; }
        }
        courtesy.w = cx2 ? cx2 + GAP.courtesy * 0.5 : 0;
      }
      M.courtesy = courtesy;
    });

    /* ---- what the layout needs of the plan's beams and tuplets, and of its voices */
    const beams = plan.beams.filter(b => !graceBeam(b)).map(b => ({ id: b.id, events: b.events.slice(), breaks: (b.breaks || []).map(x => ({ after: x.after, level: x.level })) }));
    const depthOf = t => { let d = 0, p = t.parent; while (p && d < 8) { d++; const q = plan.tuplets.find(x => x.id === p); p = q && q.parent; } return d; };
    const hidden = new Set(plan.events.filter(e => e.hidden).map(e => e.id));
    const tuplets = plan.tuplets.filter(t => !t.deferred).map((t, i) => ({ id: t.id, events: t.events.slice(), shown: t.events.filter(id => !hidden.has(id)),
      actual: t.actual, normal: t.normal,
      number: t.number, bracket: !!t.bracket, placement: t.placement || null, refs: [t.id].concat(t.source === 'merged' ? (t.members || []) : []), depth: depthOf(t), order: i }));
    const voiceOf = new Map(plan.events.map(e => [e.id, e.voice]));
    const roles = new Map();
    plan.events.forEach(e => {
      const r = e.kind === 'rest' ? restRole.get(e.staff + '|' + e.m + '|' + e.voice) : roleOf.get(e.staff + '|' + e.m + '|' + e.voice);
      if (r) roles.set(e.id, r);
    });

    /* what later stages draw (G4d-1b: marks attached to systems): counted, so nothing is silently absent. G4d-1a places
       ties, slurs, glissandi, arpeggios, articulations, ornaments, fermatas and fingering */
    const pending = {};
    const add = (k, n) => { if (n) pending[k] = (pending[k] || 0) + n; };
    add('jump', (plan.jumps || []).length);
    add('tempo', (plan.tempos || []).filter(t => !t.hidden).length);
    plan.lines.forEach(l => { if (l.kind !== 'gliss' && l.kind !== 'arpeggio') add(l.kind, 1); });
    plan.marks.forEach(mk => add(mk.kind, 1));
    plan.events.forEach(e => add('lyric', (e.lyrics || []).length));

    /* what the marks pass reads (marks.js): the events' marks and heads, the ties, slurs and glissandi, the fermatas on bar
       lines, each voice's notes in time order, each staff's place in its part */
    const mEvents = new Map(plan.events.filter(e => !e.hidden && !(e.grace && e.grace.after)).map(e => [e.id, { id: e.id, m: e.m, at: e.at, staff: e.staff,
      voice: e.voice, kind: e.kind, grace: !!e.grace, dots: e.dots || 0, arts: (e.arts || []).slice(), orn: (e.orn || []).map(o => Object.assign({}, o)),
      fermata: e.fermata || null, heads: e.heads.map(h => ({ id: h.id, staff: h.staff || e.staff, fingering: (h.fingering || []).map(f => Object.assign({}, f)) })) }]));
    const headEvent = new Map();
    plan.events.forEach(e => e.heads.forEach(h => headEvent.set(h.id, e.id)));
    const voiceSeq = new Map();
    [...mEvents.values()].forEach(e => { if (!voiceSeq.has(e.voice)) voiceSeq.set(e.voice, []); voiceSeq.get(e.voice).push(e); });
    voiceSeq.forEach((list, v) => voiceSeq.set(v, list.sort((a, b) => mIndex.get(a.m) - mIndex.get(b.m) || byAt(a.at, b.at) ||
      (a.grace === b.grace ? 0 : a.grace ? -1 : 1) || idNum(a.id) - idNum(b.id)).map(e => e.id)));
    const barFermatas = [];
    plan.measures.forEach(m => ['left', 'right'].forEach(side => {
      const b = m.barline && m.barline[side];
      if (b && b.fermata !== undefined && b.fermata !== null) barFermatas.push({ m: m.id, side: side, fermata: b.fermata, ref: m.id + '#bar.' + side + '.fermata' });
    }));
    const staffRank = new Map();
    staves.forEach(s => staffRank.set(s.id, staves.filter(t => t.part === s.part).indexOf(s)));
    const marks = { events: mEvents, headEvent: headEvent, voiceSeq: voiceSeq, mIndex: mIndex, barFermatas: barFermatas, staffRank: staffRank,
      ties: plan.ties.map(t => Object.assign({}, t)), slurs: plan.slurs.map(s => Object.assign({}, s)),
      gliss: plan.lines.filter(l => l.kind === 'gliss').map(l => Object.assign({}, l)) };

    return { version: VERSION, planKey: plan.graph.fingerprint + ':' + plan.version, staves: staves, measures: measures,
      endings: plan.endings || [], layoutBreaks: new Set(plan.measures.filter(m => m.layoutBreak && m.layoutBreak.newSystem).map(m => mIndex.get(m.id))),
      beams: beams, tuplets: tuplets, voiceOf: voiceOf, roles: roles, multiVoice: multiVoice, evStaff: new Map(plan.events.map(e => [e.id, e.staff])), marks: marks,
      evMeasure: new Map(plan.events.map(e => [e.id, e.m])), evTypes: new Map(plan.events.map(e => [e.id, e.type])), dirOf: dirOf,
      diagnostics: diagnostics, pending: pending };
  }

  /* ================================================================ layout */
  /* A system of bars i..j as a list of segments, left to right: {w, objects, measure} fixed pieces and {spring}
     references. The line breaker, the width solver and the placement all read this one list. A measure's box runs
     from its first segment to its bar line (the system head belongs to the system). */
  function segments(P, i, j, last) {
    const out = [];
    const fixed = (w, objects, measure, extra) => out.push(Object.assign({ w: w, objects: objects || null, measure: measure }, extra || {}));
    fixed(P.measures[i].head.w, P.measures[i].head.objects, null);
    for (let k = i; k <= j; k++) {
      const M = P.measures[k];
      const next = k < j ? P.measures[k + 1] : null;
      out.push({ open: k });
      if (k === i) {
        if (M.open.w) { fixed(GAP.headStart * 2, null, M.id); fixed(M.open.w, M.open.objects, M.id); fixed(GAP.afterBar, null, M.id); }
        else fixed(GAP.afterHead, null, M.id);
      } else {
        if (M.open.w) {
          if (!M.replacesBar) fixed(GAP.startItem, null, M.id);
          fixed(M.open.w, M.open.objects, M.id);
        }
        if (M.start.w) fixed(M.start.w, M.start.objects, M.id);
        fixed(GAP.afterBar, null, M.id);
      }
      fixed(M.cols.length ? M.cols[0].left : 0, null, M.id, { contentStart: true });
      M.cols.forEach((col, ci) => out.push({ spring: M.springs[ci], col: col, measure: M.id }));
      out.push({ contentEnd: true });
      if (M.trailing.w) fixed(M.trailing.w, M.trailing.objects, M.id);
      /* the bar line, unless the next measure's forward repeat takes its place */
      if (!(next && next.replacesBar)) fixed(M.bar.w, M.bar.objects, M.id);
      out.push({ close: k });
      if (k === j && !last && M.courtesy.w) fixed(M.courtesy.w, M.courtesy.objects, M.id, { courtesy: true });
    }
    return out;
  }
  function systemParts(P, i, j, last) {
    const segs = segments(P, i, j, last);
    let fixed = 0;
    const springs = [];
    segs.forEach(g => { if (g.spring) springs.push(g.spring); else if (g.w !== undefined) fixed += g.w; });
    return { segs: segs, fixed: fixed, springs: springs };
  }

  /* window: [first, last] measure indices - a close view's bars, laid out as systems of their own (§15.2: the
     engraving takes the window's bounds as system bounds); null for the whole score. The width is kept to 0.01 sp, the
     precision of every coordinate, so the config the engraver caches under is the config laid out (review O2). */
  function normalizeConfig(cfg) {
    cfg = cfg || {};
    const bp = cfg.breakpoint === 'phone' ? 'phone' : 'desktop';
    const win = Array.isArray(cfg.window) && cfg.window.length === 2 ? [Math.max(0, Math.floor(+cfg.window[0])), Math.floor(+cfg.window[1])] : null;
    return { mode: 'screen', breakpoint: bp, width: r2(+(cfg.width || SCREEN[bp].width)), barsPerSystem: Math.max(1, Math.round(+(cfg.barsPerSystem || SCREEN[bp].bars))),
      respectSourceBreaks: !!cfg.respectSourceBreaks, window: win };
  }
  function screenConfig(viewportPx, zoom) {
    const bp = viewportPx <= SCREEN.phoneMaxPx ? 'phone' : 'desktop';
    const z = zoom > 0 ? zoom : 1;
    return normalizeConfig({ breakpoint: bp, width: Math.round(SCREEN[bp].width / z * 2) / 2, barsPerSystem: SCREEN[bp].bars });
  }

  /* ---- per system, once the x of every column is known: beams, rests between voices, tuplets (staff-relative y) */
  function notateSystem(P, sysObjs, diagnostics) {
    const byStaff = new Map();
    sysObjs.forEach(o => { if (o.staffKey) { if (!byStaff.has(o.staffKey)) byStaff.set(o.staffKey, []); byStaff.get(o.staffKey).push(o); } });
    const staffOf = new Map(P.staves.map(s => [s.id, s]));
    /* beams (§11.2): each beam's stems in this system, per staff (a cross-staff beam, deferred, is drawn as a partial
       beam on each staff); one stem left alone gets its flag back */
    const stemsOf = new Map();
    sysObjs.forEach(o => { if (o.kind === 'stem' && o.beam) { if (!stemsOf.has(o.beam)) stemsOf.set(o.beam, []); stemsOf.get(o.beam).push(o); } });
    P.beams.forEach(b => {
      const stems = stemsOf.get(b.id);
      if (!stems) return;
      const parts = new Map();
      stems.forEach(st => { if (!parts.has(st.staffKey)) parts.set(st.staffKey, []); parts.get(st.staffKey).push(st); });
      parts.forEach((list, staffKey) => {
        list.sort((a, c) => a.box[0] - c.box[0] || b.events.indexOf(a.event) - b.events.indexOf(c.event));
        if (list.length < 2) {
          list.forEach(st => {
            const fp = MT.flag(st._type, st.dir === 'up');
            if (!fp || fp.missing) return;
            const g = MT.glyph(fp.name), end = st.dir === 'up' ? st.box[1] : st.box[3];
            const f = { id: st.event + '#flag', kind: 'flag', refs: [st.event], event: st.event, glyph: fp.name, box: MT.box(fp.name, st.box[0] - g.xMin, end), layer: 'note',
              staffKey: staffKey, measure: st.measure };
            sysObjs.push(f);
            byStaff.get(staffKey).push(f);
          });
          return;
        }
        const members = list.map(st => ({ x0: st.box[0], sw: st.box[2] - st.box[0], n: st._n, dots: st._dots, beat: st._beat, far: st._far, tip: st._tip, stem: st }));
        const brk = new Map();
        b.breaks.forEach(x => { const j = list.findIndex(st => st.event === x.after); if (j >= 0) brk.set(j, Math.min(brk.has(j) ? brk.get(j) : Infinity, x.level)); });
        const dir = list[0].dir;
        if (list.some(st => st.dir !== dir)) diagnostics.push({ code: 'BEAM_STEM_MIXED', refs: [b.id], detail: 'stems of one beam part point both ways' });
        const bo = { scale: 1, mid: list[0]._mid, reachMiddle: !list.some(st => st._poly), extra: 0 };
        let sh = NT.beamShapes(members, dir, brk, bo);
        /* what the beam's notes carry - accidentals, dots, heads, ledger lines - stays clear of it */
        const evs = new Set(list.map(st => st.event));
        const carried = byStaff.get(staffKey).filter(o => evs.has(o.event) && ['accidental', 'dot', 'notehead', 'ledger'].indexOf(o.kind) >= 0);
        for (let k = 0; k < 3; k++) {
          const need = NT.beamClash(sh.beams, carried, dir);
          if (need <= 1e-9) break;
          bo.extra += need;
          sh = NT.beamShapes(members, dir, brk, bo);
        }
        sh.beams.forEach(bm => {
          const idx = b.events.indexOf(list[bm.from].event);
          const o = { id: b.id + '#L' + bm.level + '.' + idx + (bm.hook ? 'h' : ''), kind: 'beam', refs: [b.id], events: list.slice(bm.from, bm.to + 1).map(st => st.event),
            level: bm.level, dir: dir, line: bm.line, t: bm.t, box: bm.box, layer: 'note', staffKey: staffKey, measure: list[bm.from].measure };
          if (bm.hook) o.hook = bm.hook;
          sysObjs.push(o);
          byStaff.get(staffKey).push(o);
        });
      });
    });
    /* rests between voices (§14.3): on a staff two voices share in that measure, or under a beam, a rest moves clear */
    byStaff.forEach((list, staffKey) => {
      const beamsHere = list.filter(o => o.kind === 'beam');
      const rests = list.filter(o => o.kind === 'rest' && (P.multiVoice.has(staffKey + '|' + P.evMeasure.get(o.event)) ||
        beamsHere.some(b => b.box[0] < o.box[2] - SK.EPS && o.box[0] < b.box[2] - SK.EPS)));
      if (!rests.length) return;
      const roleRank = o => (P.roles.get(o.event) === 'up' ? 0 : P.roles.get(o.event) === 'down' ? 2 : 1);
      rests.sort((a, c) => a.box[0] - c.box[0] || roleRank(a) - roleRank(c) || idNum(a.id) - idNum(c.id));
      const done = new Set();
      const items = [];
      rests.forEach(o => {
        if (done.has(o.id)) return;
        done.add(o.id);
        const dots = list.filter(x => x.kind === 'dot' && x.event === o.event);
        let partner = null;
        if (o.merged) {
          const p = rests.find(x => x.id === o.merged[0]);
          if (p && !done.has(p.id)) { done.add(p.id); partner = { obj: p, dots: list.filter(x => x.kind === 'dot' && x.event === p.event) }; }
        }
        const role = P.roles.get(o.event);
        items.push({ obj: o, dots: dots, partner: partner, dir: role === 'up' ? -1 : role === 'down' ? 1 : 0 });
      });
      const voice = P.voiceOf;
      NT.placeRests(items, r => {
        const own = voice.get(r.obj.event);
        const skip = new Set([r.obj].concat(r.dots, r.partner ? [r.partner.obj].concat(r.partner.dots) : []));
        return list.filter(x => !skip.has(x) && x.layer === 'note' && (x.kind === 'beam'
          ? true : x.event && voice.get(x.event) !== own && !(r.partner && x.event === r.partner.obj.event)));
      }).forEach(res => { if (!res.clear) diagnostics.push({ code: 'REST_UNPLACED', refs: [res.obj.id], detail: 'no clear place within 12 sp' }); });
    });
    /* the whole, half and breve rests that stand off the staff (moved clear of another voice, or where the graph puts
       them) get the ledger line they hang from or sit on - else a whole rest and a half rest look alike (the G4c review
       M1). One line each, the rest's width and the ledger overhang either side; a merged pair draws it once. */
    sysObjs.filter(o => o.kind === 'rest' && RESTLINE[o.glyph]).forEach(o => {
      if (o.merged && o.merged.some(id => id < o.id)) return;
      const st = staffOf.get(o.staffKey), last = st ? Math.max(0, st.lines - 1) : 4;
      const g = MT.glyph(o.glyph), s = o.scale === undefined ? 1 : o.scale;
      const y = o.box[1] + g.yMax * s;
      RESTLINE[o.glyph].map(d => y - d).forEach(ly => {
        if (Math.abs(ly - Math.round(ly)) > 0.01 || (ly > -0.01 && ly < last + 0.01)) return;
        const L = { id: o.event + '#ledger' + o.staffKey + ':' + Math.round(ly), kind: 'ledger', refs: [o.event], event: o.event,
          box: [o.box[0] - EG.ledgerOverhang, ly - EG.ledger / 2, o.box[2] + EG.ledgerOverhang, ly + EG.ledger / 2], layer: 'note', staffKey: o.staffKey, measure: o.measure };
        sysObjs.push(L);
        byStaff.get(o.staffKey).push(L);
      });
    });
  }

  function layout(P, config) {
    counters.layout++;
    const cfg = normalizeConfig(config);
    const W = cfg.width, N = cfg.barsPerSystem;
    const diagnostics = P.diagnostics.slice();
    const n = P.measures.length;
    /* the measures laid out: all, or a window's; the window's last system is the piece's last only if the piece ends there */
    const lo = cfg.window ? Math.min(cfg.window[0], n - 1) : 0, hi = cfg.window ? Math.max(lo, Math.min(cfg.window[1], n - 1)) : n - 1;
    const endsPiece = hi === n - 1;
    const forced = cfg.respectSourceBreaks ? new Set([...P.layoutBreaks].map(k => k - lo).filter(k => k > 0 && k <= hi - lo)) : null;
    const br0 = BR.breakLines(hi - lo + 1, N, W, (i, j, last) => {
      const s = systemParts(P, lo + i, lo + j, last && endsPiece);
      return { minWidth: SP.minWidth(s.springs, s.fixed), natural: SP.width(s.springs, s.fixed, SP.U_NATURAL) };
    }, forced);
    const br = { systems: br0.systems.map(([i, j]) => [lo + i, lo + j]), cost: br0.cost };

    const systems = [], measuresOut = [], objects = [], curves = [];
    const us = [];
    /* the parts of several staves, and the room their brace takes at the left */
    const partStaves = new Map();
    P.staves.forEach(s => { if (!partStaves.has(s.part)) partStaves.set(s.part, []); partStaves.get(s.part).push(s); });
    const braced = [...partStaves.values()].filter(list => list.length > 1);
    const braceSpace = braced.length ? BRACE.w + BRACE.gap : 0;
    const mIdx = new Map(P.measures.map((m, k) => [m.id, k]));
    /* the system each laid-out measure is in (a tie or slur to a measure of another system is drawn in halves) */
    const sysOfMeasure = new Map();
    br.systems.forEach(([i, j], si) => { for (let k = i; k <= j; k++) sysOfMeasure.set(P.measures[k].id, si); });
    const staffLines = new Map(P.staves.map(s => [s.id, s.lines]));
    br.systems.forEach(([i, j], si) => {
      const last = si === br.systems.length - 1 && endsPiece;
      const parts = systemParts(P, i, j, last);
      let u, ragged = false, fit = 1;
      const min = SP.minWidth(parts.springs, parts.fixed);
      /* the last system keeps the spacing of the others (their median u, of the systems drawn at full size: a system
         squeezed to a smaller staff has u = 0 and says nothing of the spacing - review R11) when that leaves it well
         short of the width; otherwise it is justified like them */
      if (last) {
        const sorted = us.slice().sort((a, b) => a - b);
        const uRef = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : SP.U_NATURAL;
        if (SP.width(parts.springs, parts.fixed, uRef) <= 0.8 * W) { u = uRef; ragged = true; }
      }
      if (u === undefined) {
        const sol = SP.solve(parts.springs, parts.fixed, W);
        u = sol.u;
        if (sol.overflow) {
          fit = Math.max(FIT_MIN, W / min);
          if (min * fit > W + 1e-9) diagnostics.push({ code: 'SYSTEM_OVERFLOW', refs: [P.measures[i].id], detail: r2(min * fit) + ' sp > ' + W + ' sp' });
          else diagnostics.push({ code: 'SYSTEM_SCALED', refs: [P.measures[i].id], detail: 'staff space ' + r2(fit) });
        }
      }
      if (!last && fit === 1) us.push(u);
      /* x: walk the segments */
      const x0 = MARGIN.left + braceSpace;
      const sysObjs = [], mOut = [];
      let x = x0, cur = null;
      parts.segs.forEach(g => {
        if (g.open !== undefined) { cur = { x: x, columns: [], centered: [] }; return; }
        if (g.contentStart) { cur.contentX0 = x; x += g.w; return; }
        if (g.spring) {
          const colX = x;
          cur.columns.push({ at: g.col.at, x: colX, time: g.col.time });
          g.col.objects.forEach(o => {
            const ob = Object.assign({}, o, { measure: g.measure, colX: colX });
            moveGeom(ob, colX, 0);
            sysObjs.push(ob);
            if (o.center) cur.centered.push(ob);
          });
          x += Math.max(u * g.spring.g, g.spring.rod);
          return;
        }
        if (g.contentEnd) { cur.contentX1 = x; return; }
        if (g.close !== undefined) {
          const M = P.measures[g.close];
          /* a whole-measure rest in the middle between the measure's content start and its bar line (with its twin, when
             two voices rest the measure together) */
          cur.centered.forEach(ob => {
            const w = ob.box[2] - ob.box[0], cx = (cur.contentX0 + cur.contentX1 - GAP.beforeBar) / 2 - w / 2;
            ob.box = [cx, ob.box[1], cx + w, ob.box[3]];
          });
          mOut.push({ id: M.id, number: M.number, system: si, x: cur.x, w: x - cur.x, contentX0: cur.contentX0, contentX1: cur.contentX1, columns: cur.columns });
          cur = null;
          return;
        }
        if (g.objects) g.objects.forEach(o => {
          const ob = Object.assign({}, o, { measure: g.measure }, g.courtesy ? { courtesy: true } : null);
          moveGeom(ob, x, 0);
          sysObjs.push(ob);
        });
        x += g.w;
      });
      /* the stems a beam joins know their value (for a lone stem's flag) */
      sysObjs.forEach(o => { if (o.kind === 'stem' && o.beam) o._type = P.evTypes.get(o.event); });
      notateSystem(P, sysObjs, diagnostics);
      /* what stands around the notes (G4d-1a): ties, tuplets, articulations, ornaments, fermatas, slurs, glissandi and
         fingering, each through the placement function, in G04 §10.2's order (marks.js) */
      const sysCurves = [];
      const lastM = mOut[mOut.length - 1], firstCol = (mOut[0].columns.find(c => c.time) || mOut[0].columns[0] || { x: mOut[0].contentX0 });
      MK.placeSystem({ P: P, objs: sysObjs, si: si, x1: x, startX: firstCol.x - CV.SLUR.sysGap, endX: lastM.x + lastM.w - CV.SLUR.sysGap,
        sysOf: m => sysOfMeasure.get(m), lines: staffLines, mx: new Map(mOut.map(m => [m.id, m])), diagnostics: diagnostics, curves: sysCurves });
      if (fit !== 1) {
        /* the smaller staff size: every x from the system's left edge and every y from its staff's top line */
        const fx = v => x0 + (v - x0) * fit;
        sysObjs.forEach(o => {
          o.box = [fx(o.box[0]), o.box[1] * fit, fx(o.box[2]), o.box[3] * fit];
          if (o.line) o.line = [fx(o.line[0]), o.line[1] * fit, fx(o.line[2]), o.line[3] * fit];
          if (o.gap) o.gap = [fx(o.gap[0]), fx(o.gap[1])];
          if (o.t !== undefined) o.t *= fit;
          if (o.hookLen !== undefined) o.hookLen *= fit;
          if (o.size !== undefined) o.size *= fit;
          o.scale = (o.scale === undefined ? 1 : o.scale) * fit;
          if (o.colX !== undefined) o.colX = fx(o.colX);
        });
        sysCurves.forEach(c => {
          ['p0', 'c1', 'c2', 'p3'].forEach(k => { c[k] = [fx(c[k][0]), c[k][1] * fit]; });
          c.t *= fit;
          if (c.lift !== undefined) c.lift *= fit;
        });
        mOut.forEach(m => {
          m.w *= fit; m.x = fx(m.x); m.contentX0 = fx(m.contentX0); m.contentX1 = fx(m.contentX1);
          m.columns.forEach(c => { c.x = fx(c.x); });
        });
        x = fx(x);
      }
      systems.push({ index: si, page: 0, x: x0, w: x - x0, u: u, stretch: u / SP.U_NATURAL, ragged: ragged, space: fit, measures: mOut.map(m => m.id),
        first: i, last: j, objects: sysObjs, curves: sysCurves, mOut: mOut });
    });

    /* vertical: each staff's skyline, staves stacked by clearance, voltas over the top staff, systems stacked */
    const pageW = MARGIN.left + braceSpace + Math.max(W, Math.max.apply(null, systems.map(s => s.w))) + MARGIN.right;
    let yCursor = null, prevLast = null;
    systems.forEach(sys => {
      const f = sys.space;
      const lineSpan = s => Math.max(0, s.lines - 1) * f;
      const sky = new Map(P.staves.map(s => [s.id, new SK.Skyline(0, pageW)]));
      /* staff lines count as content */
      P.staves.forEach(s => sky.get(s.id).add([sys.x, 0, sys.x + sys.w, lineSpan(s)]));
      sys.objects.forEach(o => { if (sky.has(o.staffKey)) sky.get(o.staffKey).add(o.box); });
      /* curves as the boxes they cover (§10.1) */
      sys.curves.forEach(c => { if (sky.has(c.staffKey)) CV.samples(c, c.t, c.line === 'wavy' ? CV.GLISS.amp * f : 0).forEach(b => sky.get(c.staffKey).add(b)); });
      /* voltas over the top staff: one bracket per ending and system */
      const top = P.staves[0];
      P.endings.forEach(en => {
        const a = mIdx.get(en.from), b = mIdx.has(en.to) ? mIdx.get(en.to) : a;
        const ms = sys.mOut.filter(m => mIdx.get(m.id) >= a && mIdx.get(m.id) <= b);
        if (!ms.length) return;
        const x0 = ms[0].x + 0.3, x1 = ms[ms.length - 1].x + ms[ms.length - 1].w - 0.3;
        const box = sky.get(top.id).place(x0, x1, 1.8 * f, 'above', 1.0 * f, -1.0 * f);
        /* the bracket's label ("1.", "1, 2.") on the segment where the ending starts; its text is G4d's to set */
        const first = ms[0].id === en.from;
        sys.objects.push({ id: en.id + ':' + ms[0].id, kind: 'volta', refs: [en.id], staffKey: top.id, measure: null, box: box, layer: 'above',
          open: en.open || ms[ms.length - 1].id !== en.to, start: first,
          label: first ? (en.text || ((en.numbers || []).join(', ') + '.')) : null });
      });
      /* staff offsets inside the system */
      const off = new Map();
      let o = 0;
      P.staves.forEach((s, k) => {
        if (k > 0) {
          const prev = P.staves[k - 1];
          const min = (prev.part === s.part ? VGAP.inPart : VGAP.betweenParts) * f;
          const need = SK.clearance(sky.get(prev.id), lineSpan(prev), sky.get(s.id), 0, VGAP.pad * f);
          o += lineSpan(prev) + Math.max(min, need);
        }
        off.set(s.id, o);
      });
      /* systems are stacked as bands: a system's highest reach clears the one above's lowest by systemPad, and its
         top line is at least VGAP.system below the last line above (screen systems never interleave, so a system's
         box is a clean hit and scroll target) */
      const first = P.staves[0], lastS = P.staves[P.staves.length - 1];
      const t0 = sky.get(first.id).top(0, pageW);
      const topReach = Math.min(0, t0 === null ? 0 : t0);
      if (yCursor === null) sys.y = MARGIN.top - topReach;
      else sys.y = Math.max(yCursor + prevLast.span + VGAP.system, prevLast.bottom + VGAP.systemPad - topReach);
      sys.staves = P.staves.map(s => {
        const sk = sky.get(s.id);
        const y = sys.y + off.get(s.id);
        const t = sk.top(0, pageW), b = sk.bottom(0, pageW);
        return { key: s.id, y: y, h: lineSpan(s), top: y + Math.min(0, t === null ? 0 : t), bottom: y + Math.max(lineSpan(s), b === null ? 0 : b) };
      });
      sys.box = [sys.x, Math.min.apply(null, sys.staves.map(s => s.top)), sys.x + sys.w, Math.max.apply(null, sys.staves.map(s => s.bottom))];
      /* staff lines, then everything to absolute y */
      P.staves.forEach(s => {
        sys.objects.push({ id: 'd:staff:' + s.id + ':' + sys.measures[0], kind: 'staff', refs: [s.id], staffKey: s.id, measure: null,
          box: [sys.x, -EG.staffLine / 2 * f, sys.x + sys.w, lineSpan(s) + EG.staffLine / 2 * f], lines: s.lines, space: f, layer: 'staff' });
      });
      sys.objects.forEach(ob => { moveGeom(ob, 0, sys.y + (off.get(ob.staffKey) || 0)); });
      sys.curves.forEach(c => { const dy = sys.y + (off.get(c.staffKey) || 0); ['p0', 'c1', 'c2', 'p3'].forEach(k => { c[k] = [c[k][0], c[k][1] + dy]; }); });
      /* the bar lines of a part's staves run through the gap to its next staff (a grand staff's bar lines are one) */
      const nextInPart = new Map();
      P.staves.forEach((s, k) => { const n = P.staves[k + 1]; if (n && n.part === s.part) nextInPart.set(s.id, sys.y + off.get(n.id)); });
      sys.objects.forEach(ob => { if (ob.kind === 'barline' && !ob.glyph && nextInPart.has(ob.staffKey)) ob.box = [ob.box[0], ob.box[1], ob.box[2], nextInPart.get(ob.staffKey)]; });
      /* the system's opening line across every staff, and a brace for each part of several staves */
      const yTop = sys.y, yBot = sys.y + off.get(lastS.id) + lineSpan(lastS);
      if (P.staves.length > 1)
        sys.objects.push({ id: 'd:sysbar:' + sys.measures[0], kind: 'barline', refs: [], staffKey: null, measure: null,
          box: [sys.x, yTop, sys.x + EG.thinBar * f, yBot], layer: 'staff' });
      braced.forEach(list => {
        const a = list[0], b = list[list.length - 1];
        sys.objects.push({ id: 'd:brace:' + a.part + ':' + sys.measures[0], kind: 'brace', refs: [a.part], staffKey: null, measure: null,
          box: [sys.x - BRACE.gap - BRACE.w, sys.y + off.get(a.id), sys.x - BRACE.gap, sys.y + off.get(b.id) + lineSpan(b)], layer: 'staff' });
      });
      yCursor = sys.y + off.get(lastS.id);
      prevLast = { bottom: sys.box[3], span: lineSpan(lastS) };
    });
    const pageH = systems.length ? Math.max.apply(null, systems.map(s => s.box[3])) + MARGIN.bottom : MARGIN.top + MARGIN.bottom;

    /* the EngravedScore, every number to 0.01 sp */
    const rb = b => b.map(r2);
    systems.forEach(sys => {
      sys.objects.forEach(o => {
        const out = { id: o.id, kind: o.kind, refs: o.refs.slice(), system: sys.index, staffKey: o.staffKey || null, measure: o.measure || null,
          box: rb(o.box), layer: o.layer };
        if (o.event) out.event = o.event;
        if (o.glyph) {
          /* where a backend draws the glyph: its origin, from the unrounded box */
          const g = MT.glyph(o.glyph), s = o.scale === undefined ? 1 : o.scale;
          out.glyph = o.glyph;
          out.origin = [r2(o.box[0] - g.xMin * s), r2(o.box[1] + g.yMax * s)];
          if (MT.drawn(o.glyph)) out.drawn = true;
        }
        if (o.scale !== undefined && o.scale !== 1) out.scale = r2(o.scale);
        if (o.grace) out.grace = true;
        if (o.courtesy) out.courtesy = true;
        if (o.open) out.open = true;
        if (o.kind === 'volta') { out.start = !!o.start; if (o.label) out.label = o.label; }
        if (o.lines !== undefined) out.lines = o.lines;
        if (o.kind === 'staff') out.space = r2(o.space);
        if (o.colX !== undefined) out.anchor = [r2(o.colX), r2(sys.staves.find(s => s.key === o.staffKey).y)];
        /* G4c: stems' direction and beam; beams' members, level, hook and edge; tuplet brackets' side, hooks and gap; the
           partners of a shared unison or a merged rest */
        if (o.dir) out.dir = o.dir;
        if (o.kind === 'stem' && o.beam) out.beam = o.beam;
        if (o.events) out.events = o.events.slice();
        if (o.level !== undefined) out.level = o.level;
        if (o.hook) out.hook = o.hook;
        if (o.line) out.line = rb(o.line);
        if (o.t !== undefined) out.t = r2(o.t);
        if (o.side) out.side = o.side;
        if (o.hooks) out.hooks = o.hooks.slice();
        if (o.gap) out.gap = rb(o.gap);
        if (o.hookLen !== undefined) out.hookLen = r2(o.hookLen);
        if (o.merged) out.merged = o.merged.slice();
        if (o.kind === 'rest' && o.center) out.center = true;
        /* G4d-1a: an arpeggio against arpeggiating; text - its characters, face and size, and its baseline's start */
        if (o.non) out.non = true;
        if (o.text !== undefined) {
          out.text = o.text; out.font = o.font; out.size = r2(o.size);
          out.origin = [r2(o.box[0]), r2(o.box[1] + TX.face(o.font).capHeight / 1000 * o.size)];
        }
        objects.push(out);
      });
      sys.curves.forEach(c => {
        const out = { id: c.id, kind: c.kind, refs: c.refs.slice(), system: sys.index, staffKey: c.staffKey, measure: c.measure || null, part: c.part,
          p0: rb(c.p0), c1: rb(c.c1), c2: rb(c.c2), p3: rb(c.p3), t: r2(c.t) };
        if (c.side) out.side = c.side;
        if (c.heads) out.heads = c.heads.slice();
        if (c.events) out.events = c.events.slice();
        if (c.line) out.line = c.line;
        if (c.open) out.open = true;
        if (c.lift !== undefined) out.lift = r2(c.lift);
        curves.push(out);
      });
      /* the width as the difference of the rounded edges, so a measure ends exactly where the next begins */
      sys.mOut.forEach(m => measuresOut.push({ id: m.id, number: m.number, system: sys.index, x: r2(m.x), w: r2(r2(m.x + m.w) - r2(m.x)),
        content: [r2(m.contentX0), r2(m.contentX1)], columns: m.columns.map(c => ({ at: c.at, x: r2(c.x), time: c.time })) }));
    });
    objects.sort((a, b) => a.system - b.system || (a.box[0] - b.box[0]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const systemsOut = systems.map(s => ({ index: s.index, page: 0, x: r2(s.x), y: r2(s.y), w: r2(s.w), u: r2(s.u), stretch: r2(s.stretch),
      ragged: s.ragged, space: r2(s.space), measures: s.measures,
      staves: s.staves.map(t => ({ key: t.key, y: r2(t.y), h: r2(t.h), top: r2(t.top), bottom: r2(t.bottom) })), box: rb(s.box) }));
    const page = { index: 0, w: r2(pageW), h: r2(pageH), systems: systemsOut.map(s => s.index) };
    const hard = SK.collisions(objects, page, measuresOut, systemsOut);
    hard.forEach(h => diagnostics.push({ code: 'HARD_VIOLATION', refs: h.refs, detail: h.code + ' ' + h.detail }));
    const placed = {};
    objects.forEach(o => { placed[o.kind] = (placed[o.kind] || 0) + 1; });
    curves.forEach(c => { placed[c.kind] = (placed[c.kind] || 0) + 1; });
    curves.sort((a, b) => a.system - b.system || a.p0[0] - b.p0[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      version: VERSION, planKey: P.planKey, config: cfg,
      pages: [page], systems: systemsOut, measures: measuresOut, objects: objects, curves: curves,
      coverage: { placed: placed, pending: P.pending },
      diagnostics: diagnostics.map(d => [d.code + '\u0000' + d.refs.join('\u0001') + '\u0000' + (d.detail === null ? '' : d.detail), d])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[1])
    };
  }

  function engrave(plan, config) { return layout(prepare(plan), config); }

  /* prepare once; lay out per config, the last 8 configs kept */
  function createEngraver(plan) {
    const P = prepare(plan);
    const cache = new Map();
    const stats = { layouts: 0, hits: 0 };
    return {
      prepared: P, stats: stats,
      layout(config) {
        const key = CN.canonical(normalizeConfig(config));
        if (cache.has(key)) { stats.hits++; const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
        stats.layouts++;
        const e = layout(P, config);
        cache.set(key, e);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return e;
      }
    };
  }

  return Object.freeze({ VERSION, GAP, VGAP, MARGIN, BRACE, SCREEN, SLASH, counters, clefRef, yOf, prepare, systemParts, layout, engrave, createEngraver,
    normalizeConfig, screenConfig });
});
