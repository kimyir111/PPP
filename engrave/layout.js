/* ============================================================================
   PPP engrave — the layout core: NotationPlan -> EngravedScore (docs/GOALS/G04 §8.4, §9, §10, §15, G4b)

   The plan says WHAT is drawn; this says WHERE. Coordinates are staff spaces
   (sp; one screen sp is 10 px), y down, rounded to 0.01 sp; every object keeps
   its graph IDs. No DOM, no clock, no random, a fixed iteration order.

     prepare(plan)             everything that does not depend on the width:
                               per measure, the columns (every onset any staff
                               or voice has, shared - what sounds together is
                               drawn together; a mid-measure clef change is a
                               column of its own that takes no time), and per
                               column and staff the glyph geometry relative to
                               the column: noteheads (seconds to the other side
                               of the stem, a second voice beside the first),
                               stacked accidental columns, dots after every head,
                               ledger lines, provisional stems and flags, rests,
                               grace notes to the left. Their extents are the
                               rods (§9.3). Also each measure's system head (clef,
                               key, time), its start items, trailing clef,
                               courtesy key/time and barline.
     layout(prepared, config)  the width-dependent part: line breaks (breaks.js,
                               G4-U4), one spring constant per system solved
                               exactly (space.js), absolute x, staves and
                               systems stacked by their skylines (skyline.js),
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

   G4b places what the page's frame and rhythm need: staves, clefs, key and time
   signatures, barlines and repeats, voltas, noteheads, accidentals, dots, ledger
   lines, rests, grace noteheads, and provisional stems and flags (unbeamed; G4c
   sets stems under beams). Beams, tuplet marks, ties, slurs, marks and text
   are later stages: `coverage.pending` counts them, so nothing is silently absent.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('./metrics.js'), require('./space.js'), require('./breaks.js'),
      require('./skyline.js'), require('./canon.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.layout = factory(root.PPPScoreGraph, M.metrics, M.space, M.breaks, M.skyline, M.canon);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, MT, SP, BR, SK, CN) {
  'use strict';

  const VERSION = 'engr/1';
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
    /* keys and meters in force at a measure's start */
    const keyAt = mi => { let k = null; (plan.keys || []).forEach(x => { if (mIndex.get(x.m) <= mi && R.isZero(R.parse(x.at))) k = x; }); return k; };
    const meterAt = mi => { let k = null; plan.meters.forEach(x => { if (mIndex.get(x.m) <= mi) k = x; }); return k; };
    const keyChangeAt = mi => (plan.keys || []).find(x => mIndex.get(x.m) === mi && R.isZero(R.parse(x.at))) || null;
    /* what a key signature shows: nothing for a hidden key (§15.4) */
    const shown = k => (k && !k.hidden ? k.fifths : 0);
    const meterChangeAt = mi => plan.meters.find(x => mIndex.get(x.m) === mi) || null;

    /* beamed events (graph or derived beams: no flag) and tie starts, by head */
    const beamed = new Set();
    plan.beams.forEach(b => b.events.forEach(id => beamed.add(id)));
    const tieFrom = new Set();
    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });
    /* roles per staff|measure|voice */
    const roleOf = new Map();
    (plan.roles || []).forEach(r => Object.keys(r.role || {}).forEach(v => roleOf.set(r.staff + '|' + r.m + '|' + v, r.role[v])));

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
      const mid = Math.max(0, staffById.get(staffId).lines - 1) / 2;
      const objs = [];
      const notes = [], rests = [];
      evs.forEach(e => {
        if (e.hidden) return;
        if (e.kind === 'rest') { rests.push(e); return; }
        const heads = e.heads.filter(h => (h.staff || e.staff) === staffId && (h.written || h.pos));
        if (heads.length) notes.push({ e: e, heads: heads });
      });
      /* noteheads per event, seconds to the other side of the stem */
      const lay = notes.map(n => {
        const e = n.e;
        const scale = e.cue ? 0.75 : 1;
        const hs = n.heads.map(h => {
          const p = MT.notehead(e.type, h.notehead && h.notehead.shape, h.notehead ? h.notehead.filled : undefined);
          const name = glyphOf(p), g = MT.glyph(name);
          return { h: h, y: yOf(h.written || h.pos, clef), name: name, w: g.w * scale, g: g };
        });
        const hasStem = !(e.type === 'whole' || e.type === 'breve' || e.type === 'long' || e.type === 'maxima') && e.stem !== 'none';
        let dir = e.stem === 'up' || e.stem === 'down' ? e.stem : null;
        if (!dir) {
          /* no graph stem and no voice role: the head farthest from the middle line decides, down on the line */
          let far = hs[0];
          hs.forEach(x => { if (Math.abs(x.y - mid) > Math.abs(far.y - mid)) far = x; });
          dir = far.y > mid ? 'up' : 'down';
        }
        const w = Math.max.apply(null, hs.map(x => x.w));
        const sorted = hs.slice().sort((a, b) => (dir === 'up' ? b.y - a.y : a.y - b.y) || idNum(a.h.id) - idNum(b.h.id));
        let prev = null;
        sorted.forEach(x => {
          x.side = prev && Math.abs(prev.y - x.y) < 1 - 1e-9 && prev.side === 0 ? 1 : 0;
          x.x = x.side ? (dir === 'up' ? w : -w) : 0;
          prev = x;
        });
        return { e: e, hs: hs, dir: dir, w: w, dx: 0, hasStem: hasStem, scale: scale };
      });
      /* voices whose heads would touch (a unison or a second, H1) stand side by side: the down-stem voice keeps
         its place and the up-stem one moves right, so the stems stay outside (G4c refines unison sharing) */
      const order = lay.slice().sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'down' ? -1 : 1) || idNum(a.e.id) - idNum(b.e.id));
      const placed = [];
      order.forEach(L => {
        let dx = 0;
        placed.forEach(P => {
          const clash = L.hs.some(a => P.hs.some(b => Math.abs(a.y - b.y) < 1 - 1e-9));
          if (clash) dx = Math.max(dx, Math.max.apply(null, P.hs.map(b => b.x + b.w)) + P.dx - Math.min.apply(null, L.hs.map(a => a.x)));
        });
        L.dx = dx;
        placed.push(L);
      });
      /* heads, stems, flags, ledger lines */
      lay.forEach(L => {
        const e = L.e;
        L.hs.forEach(x => {
          objs.push({ id: x.h.id, kind: 'notehead', refs: [e.id, x.h.id], event: e.id, glyph: x.name, scale: L.scale,
            box: MT.box(x.name, x.x + L.dx - x.g.xMin * L.scale, x.y, L.scale), layer: 'note' });
        });
        const ys = L.hs.map(x => x.y), yTop = Math.min.apply(null, ys), yBot = Math.max.apply(null, ys);
        if (L.hasStem) {
          const flags = MT.flagCount(e.type);
          const len = EG.stemLength + Math.max(0, flags - 2) * 0.5;
          const sx = L.dir === 'up' ? L.w - EG.stem + L.dx : L.dx;
          let end = L.dir === 'up' ? yTop - len : yBot + len;
          /* a stem from a ledger-line note reaches the middle line */
          if (L.dir === 'up' && end > mid) end = mid;
          if (L.dir === 'down' && end < mid) end = mid;
          const box = L.dir === 'up' ? [sx, end, sx + EG.stem, yBot] : [sx, yTop, sx + EG.stem, end];
          objs.push({ id: e.id + '#stem', kind: 'stem', refs: [e.id], event: e.id, provisional: true, box: box, layer: 'note' });
          const fp = beamed.has(e.id) ? null : MT.flag(e.type, L.dir === 'up');
          if (fp) {
            const name = glyphOf(fp), g = MT.glyph(name);
            objs.push({ id: e.id + '#flag', kind: 'flag', refs: [e.id], event: e.id, glyph: name, provisional: true,
              box: MT.box(name, sx - g.xMin, end), layer: 'note' });
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
      /* rests: the value's glyph, raised or lowered for a voice that shares the staff (§14.3; G4c refines) */
      rests.forEach(e => {
        const name = glyphOf(MT.rest(e.type || (e.measureRest ? 'whole' : 'quarter'))), g = MT.glyph(name);
        const whole = name === 'restWhole' || name === 'restDoubleWhole';
        let y = e.restPos ? yOf(e.restPos, clef) : whole ? mid - 1 : mid;
        if (!e.restPos) {
          const role = roleOf.get(staffId + '|' + mId + '|' + e.voice);
          if (role === 'up') y -= 2; else if (role === 'down') y += 2;
        }
        objs.push({ id: e.id, kind: 'rest', refs: [e.id], event: e.id, glyph: name, center: !!e.measureRest,
          box: MT.box(name, -g.xMin, y), layer: 'note' });
        e.__restY = y;
      });
      /* accidentals: every one of this column and staff, stacked in columns to the left, top to bottom */
      const accs = [];
      lay.forEach(L => L.hs.forEach(x => {
        if (!x.h.acc) return;
        const parts = MT.accidental(x.h.acc.type).map(p => glyphOf(p));
        if (x.h.acc.paren || (x.h.acc.cautionary && x.h.acc.paren !== false && x.h.acc.bracket)) { parts.unshift('accidentalParensLeft'); parts.push('accidentalParensRight'); }
        const gs = parts.map(n => MT.glyph(n));
        const w = gs.reduce((a, g) => a + g.w, 0) * L.scale + (gs.length - 1) * 0.05;
        const top = x.y - Math.max.apply(null, gs.map(g => g.yMax)) * L.scale, bot = x.y - Math.min.apply(null, gs.map(g => g.yMin)) * L.scale;
        accs.push({ h: x.h, e: L.e, y: x.y, parts: parts, gs: gs, w: w, top: top, bot: bot, scale: L.scale });
      }));
      if (accs.length) {
        const headLeft = Math.min.apply(null, objs.filter(o => o.kind === 'notehead').map(o => o.box[0]).concat([0]));
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
              objs.push({ id: a.h.id + '#acc' + (a.parts.length > 1 ? k : ''), kind: 'accidental', refs: [a.h.id], event: a.e.id, glyph: n, scale: a.scale,
                box: MT.box(n, x - g.xMin * a.scale, a.y, a.scale), layer: 'note' });
              x += g.w * a.scale + 0.05;
            });
          });
          right -= cw + EG.accidentalGap;
        });
      }
      /* dots after every head of the column (a second voice's heads included), on the space; where an up-stem flag
         reaches down beside the heads, after the flag */
      const heads = objs.filter(o => o.kind === 'notehead' || o.kind === 'rest');
      const dot = MT.glyph('augmentationDot');
      const dotted = [];
      lay.concat(rests.map(e => ({ e: e, rest: true }))).forEach(L => {
        const e = L.e;
        if (!e.dots) return;
        const ys = L.rest ? [e.__restY] : L.hs.map(x => x.y);
        const down = roleOf.get(staffId + '|' + mId + '|' + e.voice) === 'down';
        const seen = new Set();
        ys.forEach((y, hi) => {
          const onLine = Math.abs(y - Math.round(y)) < 1e-9;
          const dy = onLine ? (down ? y + 0.5 : y - 0.5) : y;
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
      /* grace notes of these events, to the left (small heads and accidentals; G4c adds their stems and slashes) */
      const graceObjs = [];
      lay.concat(rests.map(e => ({ e: e }))).forEach(L => {
        const gl = gracesOf.get(principalKey(L.e));
        if (!gl) return;
        let right = Math.min.apply(null, objs.map(o => o.box[0]).concat([0])) - EG.graceGap;
        for (let i = gl.length - 1; i >= 0; i--) {
          const ge = gl[i];
          const s = MT.SCALE.grace;
          const gh = ge.heads.filter(h => (h.staff || ge.staff) === staffId && (h.written || h.pos));
          if (!gh.length) continue;
          const nm = glyphOf(MT.notehead(ge.type, null)), g = MT.glyph(nm);
          const hx = right - g.w * s;
          let left = hx;
          gh.forEach(h => {
            const y = yOf(h.written || h.pos, clef);
            graceObjs.push({ id: h.id, kind: 'notehead', grace: true, refs: [ge.id, h.id], event: ge.id, glyph: nm, scale: s,
              box: MT.box(nm, hx - g.xMin * s, y, s), layer: 'note' });
            if (h.acc) {
              const an = glyphOf(MT.accidental(h.acc.type)[0]), ag = MT.glyph(an);
              const ax = hx - EG.accidentalGap * s - ag.w * s;
              graceObjs.push({ id: h.id + '#acc', kind: 'accidental', grace: true, refs: [h.id], event: ge.id, glyph: an, scale: s,
                box: MT.box(an, ax - ag.xMin * s, y, s), layer: 'note' });
              left = Math.min(left, ax);
            }
            if (y <= -1 || y >= 5) {
              for (let ly = -1; ly >= Math.ceil(y - 1e-9); ly--) graceObjs.push({ id: ge.id + '#ledger' + ly + ':' + h.id, kind: 'ledger', grace: true, refs: [ge.id], event: ge.id,
                box: [hx - EG.ledgerOverhang * s, ly - EG.ledger / 2, hx + g.w * s + EG.ledgerOverhang * s, ly + EG.ledger / 2], layer: 'note' });
              for (let ly = 5; ly <= Math.floor(y + 1e-9); ly++) graceObjs.push({ id: ge.id + '#ledger' + ly + ':' + h.id, kind: 'ledger', grace: true, refs: [ge.id], event: ge.id,
                box: [hx - EG.ledgerOverhang * s, ly - EG.ledger / 2, hx + g.w * s + EG.ledgerOverhang * s, ly + EG.ledger / 2], layer: 'note' });
            }
          });
          right = left - EG.graceGap;
        }
      });
      const all = objs.concat(graceObjs);
      const ext = extent(all);
      const tie = evs.some(e => e.heads && e.heads.some(h => (h.staff || e.staff) === staffId && tieFrom.has(h.id)));
      return { objects: all, left: ext.left, right: ext.right, tie: tie };
    }

    /* ---- measures */
    const measures = plan.measures.map((m, mi) => {
      const evs = evByM.get(m.id).filter(e => !e.grace);
      const dur = R.toNumber(R.parse(m.dur));
      const toNum = s => { const q = R.parse(s); return q.n / q.d; };
      /* time columns: every onset; clef columns: a mid-measure clef change, just before the notes at its time */
      const ats = [];
      evs.forEach(e => { if (!ats.some(a => R.eq(R.parse(a), R.parse(e.at)))) ats.push(R.format(R.parse(e.at))); });
      if (!ats.length) ats.push('0');
      ats.sort(byAt);
      const cols = [];
      ats.forEach(a => {
        plan.clefs.filter(c => c.m === m.id && !R.isZero(R.parse(c.at)) && R.eq(R.parse(c.at), R.parse(a)) && staffById.has(c.staff))
          .sort((x, y) => staffById.get(x.staff).index - staffById.get(y.staff).index)
          .forEach(c => cols.push({ at: a, time: false, clef: c }));
        cols.push({ at: a, time: true });
      });
      /* clef changes at a time no note starts */
      plan.clefs.filter(c => c.m === m.id && !R.isZero(R.parse(c.at)) && staffById.has(c.staff) && !ats.some(a => R.eq(R.parse(a), R.parse(c.at))))
        .forEach(c => { cols.push({ at: R.format(R.parse(c.at)), time: false, clef: c }); });
      cols.sort((x, y) => byAt(x.at, y.at) || (x.time === y.time ? 0 : x.time ? 1 : -1));
      cols.forEach(col => {
        col.atW = toNum(col.at);
        col.staves = {};
        col.objects = [];
        if (!col.time) {
          const c = col.clef;
          const it = clefItems(c, c.id, MT.SCALE.clefChange);
          const ext = extent(it.objects);
          col.staves[c.staff] = { left: 0, right: ext.right };
          it.objects.forEach(o => { o.staffKey = c.staff; col.objects.push(o); });
          col.left = 0; col.right = ext.right; col.tie = false;
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
      const prevKey = mi > 0 ? keyAt(mi - 1) : null;
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
          const items = staves.map(s => keyItems(nk.fifths, shown(key), clefAt(s.id, mi + 1, '0', false), nk.id + ':courtesy:' + s.id, [nk.id]));
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

    /* what later stages draw: counted, so nothing is silently absent */
    const pending = {};
    const add = (k, n) => { if (n) pending[k] = (pending[k] || 0) + n; };
    add('beam', plan.beams.length);
    add('tuplet', plan.tuplets.length);
    add('grace-stem', plan.events.filter(e => e.grace && !e.grace.after && !e.hidden).length);
    add('tie', plan.ties.length);
    add('slur', plan.slurs.length);
    add('jump', (plan.jumps || []).length);
    /* a key change inside a measure: placed by a later stage (G4b draws key signatures at bar lines) */
    add('key-mid-measure', (plan.keys || []).filter(k => !k.hidden && !R.isZero(R.parse(k.at))).length);
    add('tempo', (plan.tempos || []).filter(t => !t.hidden).length);
    plan.lines.forEach(l => add(l.kind, 1));
    plan.marks.forEach(mk => add(mk.kind, 1));
    plan.events.forEach(e => {
      add('articulation', (e.arts || []).length); add('ornament', (e.orn || []).length); add('fermata', e.fermata ? 1 : 0);
      add('lyric', (e.lyrics || []).length);
      e.heads.forEach(h => add('fingering', (h.fingering || []).length));
    });

    return { version: VERSION, planKey: plan.graph.fingerprint + ':' + plan.version, staves: staves, measures: measures,
      endings: plan.endings || [], layoutBreaks: new Set(plan.measures.filter(m => m.layoutBreak && m.layoutBreak.newSystem).map(m => mIndex.get(m.id))),
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
     engraving takes the window's bounds as system bounds); null for the whole score */
  function normalizeConfig(cfg) {
    cfg = cfg || {};
    const bp = cfg.breakpoint === 'phone' ? 'phone' : 'desktop';
    const win = Array.isArray(cfg.window) && cfg.window.length === 2 ? [Math.max(0, Math.floor(+cfg.window[0])), Math.floor(+cfg.window[1])] : null;
    return { mode: 'screen', breakpoint: bp, width: +(cfg.width || SCREEN[bp].width), barsPerSystem: +(cfg.barsPerSystem || SCREEN[bp].bars),
      respectSourceBreaks: !!cfg.respectSourceBreaks, window: win };
  }
  function screenConfig(viewportPx, zoom) {
    const bp = viewportPx <= SCREEN.phoneMaxPx ? 'phone' : 'desktop';
    const z = zoom > 0 ? zoom : 1;
    return normalizeConfig({ breakpoint: bp, width: Math.round(SCREEN[bp].width / z * 2) / 2, barsPerSystem: SCREEN[bp].bars });
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

    const systems = [], measuresOut = [], objects = [];
    const us = [];
    /* the parts of several staves, and the room their brace takes at the left */
    const partStaves = new Map();
    P.staves.forEach(s => { if (!partStaves.has(s.part)) partStaves.set(s.part, []); partStaves.get(s.part).push(s); });
    const braced = [...partStaves.values()].filter(list => list.length > 1);
    const braceSpace = braced.length ? BRACE.w + BRACE.gap : 0;
    const mIdx = new Map(P.measures.map((m, k) => [m.id, k]));
    br.systems.forEach(([i, j], si) => {
      const last = si === br.systems.length - 1 && endsPiece;
      const parts = systemParts(P, i, j, last);
      let u, ragged = false, fit = 1;
      const min = SP.minWidth(parts.springs, parts.fixed);
      /* the last system keeps the spacing of the others (their median u) when that leaves it well short of the
         width; otherwise it is justified like them */
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
      if (!last) us.push(u);
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
            const ob = Object.assign({}, o, { measure: g.measure, colX: colX, box: shift(o.box, colX, 0) });
            sysObjs.push(ob);
            if (o.center) cur.centered.push(ob);
          });
          x += Math.max(u * g.spring.g, g.spring.rod);
          return;
        }
        if (g.contentEnd) { cur.contentX1 = x; return; }
        if (g.close !== undefined) {
          const M = P.measures[g.close];
          /* a whole-measure rest in the middle between the measure's content start and its bar line */
          cur.centered.forEach(ob => {
            const w = ob.box[2] - ob.box[0], cx = (cur.contentX0 + cur.contentX1 - GAP.beforeBar) / 2 - w / 2;
            ob.box = [cx, ob.box[1], cx + w, ob.box[3]];
          });
          mOut.push({ id: M.id, number: M.number, system: si, x: cur.x, w: x - cur.x, contentX0: cur.contentX0, contentX1: cur.contentX1, columns: cur.columns });
          cur = null;
          return;
        }
        if (g.objects) g.objects.forEach(o => sysObjs.push(Object.assign({}, o, { measure: g.measure, box: shift(o.box, x, 0) }, g.courtesy ? { courtesy: true } : null)));
        x += g.w;
      });
      if (fit !== 1) {
        /* the smaller staff size: every x from the system's left edge and every y from its staff's top line */
        const fx = v => x0 + (v - x0) * fit;
        sysObjs.forEach(o => {
          o.box = [fx(o.box[0]), o.box[1] * fit, fx(o.box[2]), o.box[3] * fit];
          o.scale = (o.scale === undefined ? 1 : o.scale) * fit;
          if (o.colX !== undefined) o.colX = fx(o.colX);
        });
        mOut.forEach(m => {
          m.w *= fit; m.x = fx(m.x); m.contentX0 = fx(m.contentX0); m.contentX1 = fx(m.contentX1);
          m.columns.forEach(c => { c.x = fx(c.x); });
        });
        x = fx(x);
      }
      systems.push({ index: si, page: 0, x: x0, w: x - x0, u: u, stretch: u / SP.U_NATURAL, ragged: ragged, space: fit, measures: mOut.map(m => m.id),
        first: i, last: j, objects: sysObjs, mOut: mOut });
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
      sys.objects.forEach(ob => { ob.box = shift(ob.box, 0, sys.y + (off.get(ob.staffKey) || 0)); });
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
        if (o.provisional) out.provisional = true;
        if (o.courtesy) out.courtesy = true;
        if (o.open) out.open = true;
        if (o.kind === 'volta') { out.start = !!o.start; if (o.label) out.label = o.label; }
        if (o.lines !== undefined) out.lines = o.lines;
        if (o.kind === 'staff') out.space = r2(o.space);
        if (o.colX !== undefined) out.anchor = [r2(o.colX), r2(sys.staves.find(s => s.key === o.staffKey).y)];
        objects.push(out);
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
    return {
      version: VERSION, planKey: P.planKey, config: cfg,
      pages: [page], systems: systemsOut, measures: measuresOut, objects: objects, curves: [],
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

  return Object.freeze({ VERSION, GAP, VGAP, MARGIN, BRACE, SCREEN, counters, clefRef, yOf, prepare, systemParts, layout, engrave, createEngraver,
    normalizeConfig, screenConfig });
});
