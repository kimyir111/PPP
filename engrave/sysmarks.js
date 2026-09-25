/* ============================================================================
   PPP engrave — the marks attached to systems, placed (docs/GOALS/G04 §10.2 priorities 7-11, §10.4 S2 and S5, §10.5,
   §15.3, §18.3; G4d-1b)

   The second pass over a system, after marks.js has placed what stands at the
   notes (ties to fingering, slurs): the same skylines, the same one placement
   function (skyline.js put(), §10.1), in G04's order, each row outside what came
   before it:
     7   lyrics: under their voice's staff, one line per verse and system, each
         syllable centred on its note, a hyphen between the syllables of a word
     8   dynamics and hairpins: on a part of several staves (a piano's grand staff)
         between its staves, unless the graph gives a staff and a placement; one
         baseline per system (§10.4 S2) - a dynamic that would run into another
         on it goes one line further out (§10.5); a hairpin level on that line,
         0.5 sp clear of the dynamics at its ends (S5), in parts across a break.
         Words that stand where dynamics do (cresc., dolce) share their line.
     9   pedal: under the lowest staff of its part, one line per system - the
         printed sign (Ped. ... *) or the line (a hook at each end) as the graph's
         `mark` says; a change is drawn as a change - a notch in the line, or the
         release and the press again - never as a release alone (A9: the app
         plays it as a lift and a new press, MX1-D4)
     10  the upper row, inside to out: octave lines (on their staff - an 8va, 15ma
         above it, an 8vb, 15mb below - over exactly the notes they move, their
         heads at the written pitch, D-1; "(8)" where a line goes on after a
         break), chord names (pushed right where two would meet, §10.5), voltas,
         tempo (words, metronome mark, parentheses) and rehearsal marks, then the
         jumps (segno, coda, D.C., D.S., Fine, To Coda) and words above
     11  the lower row: words and jumps below the lowest staff
   Text widths come only from metrics-text.js (A29), glyph boxes from metrics.js.
   Coordinates as marks.js: x absolute in the system, y from each staff's top
   line; the layout stacks the staves afterwards and centres the rows between a
   grand staff's staves in the room left there (layout.js). Pure: no DOM, no
   clock, no random; every list in a fixed order.

     placeSystem(S)   S as marks.placeSystem's, with S.sky (the skylines it left)
                      and S.first/S.last (the system's first and last measure)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./metrics.js'), require('./metrics-text.js'), require('./skyline.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.sysmarks = factory(M.metrics, M.metricsText, M.skyline);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MT, TX, SK) {
  'use strict';

  /* §18.3: sizes in sp - a font's em, or for a SMuFL glyph its em (4 sp is the glyph's own size): dynamics 2.5, lyrics
     1.3, chord names 1.4; the others G4d-1b's (G4-D1b-3) */
  const SIZE = Object.freeze({ dynamic: 2.5, words: 1.4, chord: 1.4, lyric: 1.3, tempo: 1.6, metronome: 1.4, rehearsal: 1.5, jump: 1.4,
    sign: 2.4, ottava: 1.3, volta: 1.3, pedal: 2.5 });
  const FONT = Object.freeze({ words: 'serif-italic', chord: 'sans', lyric: 'serif', tempo: 'serif', metronome: 'serif', rehearsal: 'sans-bold',
    jump: 'serif-italic', ottava: 'serif-italic', volta: 'serif', dynamic: 'serif-italic' });
  /* gaps (sp): a row from what it stands outside of; a row's own limit from the staff's outer line; between two items a
     row pushes apart; a hairpin from a dynamic at its end (S5) */
  const PAD = Object.freeze({ row: 0.5, lyric: 0.5, pedal: 0.6, apart: 0.4, word: 0.35, hairpin: 0.5 });
  /* a hairpin: open OPEN sp at its wide end, a continuation opens from CONT (after a break); its axis RISE above the
     dynamics' baseline (the middle of their small letters); drawn THICK; never shorter than MIN */
  const HAIRPIN = Object.freeze({ open: 1.1, cont: 0.5, rise: 0.35, thick: 0.1, min: 1.0 });
  /* the pedal line: at the row's baseline, its hooks and a change's notch HOOK sp up, the notch NOTCH wide; a sign's
     release stands RELEASE before the note it lets go at */
  const PEDAL = Object.freeze({ hook: 1.0, notch: 1.0, thick: 0.12, release: 0.6, lead: 0.3 });
  /* an octave line: its label, then a dashed line at the middle of the label's figures, a hook of HOOK at a closed end */
  const OTTAVA = Object.freeze({ hook: 1.0, gap: 0.3, thick: 0.1, lead: 0.2 });
  /* a volta: its bracket HEIGHT sp high, its ends INSET from the bar lines; its label inside */
  const VOLTA = Object.freeze({ height: 1.8, inset: 0.3, labelDx: 0.4 });
  /* a metronome mark's note: SCALE of a notehead, its stem STEM long */
  const METRO = Object.freeze({ scale: 0.6, stem: 2.0, gap: 0.3 });
  /* a lyric's hyphen: WIDTH wide, drawn where the gap between two syllables has room for it and GAP either side */
  const HYPHEN = Object.freeze({ width: 0.6, thick: 0.1, gap: 0.2, lift: 0.3 });
  /* a rehearsal mark's frame, PAD around its letters */
  const FRAME = Object.freeze({ pad: 0.3, thick: 0.1 });
  /* MusicXML chord kinds as the app prints them (App CHORD_KIND), a sharp and a flat as glyphs (the page's text faces
     have none) */
  const CHORD_KIND = Object.freeze({ major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7', 'major-seventh': 'M7',
    'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7', 'half-diminished': 'm7♭5', 'major-minor': 'mM7',
    'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'M9', 'minor-ninth': 'm9', 'dominant-11th': '11',
    'major-11th': 'M11', 'minor-11th': 'm11', 'dominant-13th': '13', 'major-13th': 'M13', 'minor-13th': 'm13', 'suspended-second': 'sus2',
    'suspended-fourth': 'sus4', power: '5', none: 'N.C.', other: '', pedal: 'ped', Neapolitan: 'N', Italian: 'It', French: 'Fr', German: 'Ger',
    Tristan: 'Tristan' });
  const ACC_TEXT = Object.freeze({ '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '♯♯' });
  /* the accidental glyphs of a chord name: scale, and where their origin stands above the baseline */
  const CHORD_ACC = Object.freeze({ '♯': ['accidentalSharp', 0.45, 0.62], '♭': ['accidentalFlat', 0.45, 0.3] });
  /* a jump without printed words: the words it stands for */
  const JUMP_TEXT = Object.freeze({ dacapo: 'D.C.', dalsegno: 'D.S.', fine: 'Fine', tocoda: 'To Coda' });
  const OTTAVA_LABEL = Object.freeze({ 1: '8va', 2: '15ma', 3: '22ma', '-1': '8vb', '-2': '15mb', '-3': '22mb' });
  const OTTAVA_CONT = Object.freeze({ 1: '(8)', 2: '(15)', 3: '(22)', '-1': '(8)', '-2': '(15)', '-3': '(22)' });

  const idNum = id => { const m = /(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
  const minOf = xs => Math.min.apply(null, xs), maxOf = xs => Math.max.apply(null, xs);
  const q = s => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s)); return m ? +m[1] / (m[2] ? +m[2] : 1) : 0; };
  const norm = s => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
  /* a dynamic's glyph scale: its em over the glyph's own em (4 sp) */
  const gscale = size => size / 4;

  /* a run of text at `size` in `font` from x, on a baseline: {w, rise, drop} and the piece to add */
  function textPiece(o) {
    const m = TX.measure(o.text, o.font, o.size);
    return { w: m.w, rise: -m.top, drop: m.bottom, missing: m.missing,
      make: (x, base) => ({ kind: o.kind, text: o.text, font: o.font, size: o.size, box: [x, base + m.top, x + m.w, base + m.bottom] }) };
  }
  /* a glyph at `scale`, its left edge at x, its origin on the baseline plus `raise` */
  function glyphPiece(name, scale, kind, raise) {
    const g = MT.glyph(name), r = raise || 0;
    return { w: g.w * scale, rise: g.yMax * scale + r, drop: Math.max(0, -g.yMin * scale - r), glyph: name,
      make: (x, base) => ({ kind: kind, glyph: name, scale: scale, box: MT.box(name, x - g.xMin * scale, base - r, scale) }) };
  }

  function placeSystem(S) {
    const P = S.P, Y = P.sys, K = P.marks, si = S.si, objs = S.objs, sky = S.sky;
    const diag = (code, refs, detail) => S.diagnostics.push({ code: code, refs: refs || [], detail: detail === undefined ? null : detail });
    const lastLine = id => Math.max(0, (S.lines.get(id) === undefined ? 5 : S.lines.get(id)) - 1);
    const addObj = o => objs.push(o);
    const textMissing = (piece, ref) => { if (piece.missing && piece.missing.length) diag('TEXT_GLYPH_MISSING', [ref], piece.missing.join(',')); };

    /* ---- time and x in this system. T is a position as a number of whole notes from the piece's start */
    const ms = [...S.mx.values()];
    const T0 = Y.start.get(S.first), T1 = Y.start.get(S.last) + Y.dur.get(S.last);
    const Tof = (m, at) => (Y.start.has(m) ? Y.start.get(m) + q(at) : null);
    const measureAt = T => ms.find(M => T >= Y.start.get(M.id) - 1e-9 && T < Y.start.get(M.id) + Y.dur.get(M.id) - 1e-9) ||
      (Math.abs(T - T1) < 1e-9 ? ms[ms.length - 1] : null);
    /* the x of a position: at a column's time its x; between two, in proportion; before a measure's first column from its
       start, after the last to its bar line (the end of the measure) */
    const xOfT = T => {
      const M = measureAt(T);
      if (!M) return null;
      const a = T - Y.start.get(M.id), dur = Y.dur.get(M.id), end = M.x + M.w;
      if (Math.abs(a - dur) < 1e-9) return end;
      const cols = M.columns.filter(c => c.time).map(c => ({ at: q(c.at), x: c.x }));
      if (!cols.length) return M.x + (end - M.x) * a / (dur || 1);
      for (let k = 0; k < cols.length; k++) if (Math.abs(cols[k].at - a) < 1e-9) return cols[k].x;
      if (a < cols[0].at) return M.x + (cols[0].x - M.x) * a / (cols[0].at || 1);
      for (let k = 0; k + 1 < cols.length; k++) if (a > cols[k].at && a < cols[k + 1].at)
        return cols[k].x + (cols[k + 1].x - cols[k].x) * (a - cols[k].at) / (cols[k + 1].at - cols[k].at);
      const L = cols[cols.length - 1];
      return L.x + (end - L.x) * (a - L.at) / ((dur - L.at) || 1);
    };
    /* the heads and rests that start at each position, per staff (grace notes aside): where a mark at that time stands */
    const onsets = new Map();
    objs.forEach(o => {
      if ((o.kind !== 'notehead' && o.kind !== 'rest') || o.grace || !o.event || o.center) return;
      const e = K.events.get(o.event);
      if (!e) return;
      const k = Math.round(Tof(e.m, e.at) * 1e6) + '|' + o.staffKey;
      if (!onsets.has(k)) onsets.set(k, []);
      onsets.get(k).push(o);
    });
    const byEvent = new Map();
    objs.forEach(o => { if (o.event && (o.kind === 'notehead' || o.kind === 'rest') && !o.grace && !o.center) { if (!byEvent.has(o.event)) byEvent.set(o.event, []); byEvent.get(o.event).push(o); } });
    /* what a mark at T on a staff lines up with: the notes starting there on that staff (else on another staff of its part),
       as [left, right]; else the position itself */
    const anchor = (T, staffKey, eventId) => {
      const own = eventId && byEvent.has(eventId) ? byEvent.get(eventId) : null;
      let bs = own || onsets.get(Math.round(T * 1e6) + '|' + staffKey);
      if (!bs && Y.staffPart.has(staffKey)) {
        for (const st of Y.partStaves.get(Y.staffPart.get(staffKey))) { bs = onsets.get(Math.round(T * 1e6) + '|' + st); if (bs) break; }
      }
      if (bs && bs.length) return [minOf(bs.map(o => o.box[0])), maxOf(bs.map(o => o.box[2]))];
      const x = xOfT(T);
      return x === null ? null : [x, x];
    };
    const inSystem = T => T !== null && T >= T0 - 1e-9 && T < T1 - 1e-9;
    const measureOf = T => { const M = measureAt(T); return M ? M.id : null; };
    /* a direction stands in its own measure (at its end when `at` is the measure's length): here when that measure is */
    const here = m => S.sysOf(m) === si && S.mx.has(m);
    /* where a spanner's end (m, at) stands on a staff: its measure's bar line when it is the measure's end (the bar line before
       it when it is a measure's start), else the notes that start there (or the position) */
    const endX = (pos, staff) => {
      if (S.mx.has(pos.m) && Math.abs(q(pos.at) - Y.dur.get(pos.m)) < 1e-9) return S.mx.get(pos.m).x + S.mx.get(pos.m).w;
      /* the start of a measure is the end of the one before: its bar line, where that measure is here */
      const prev = q(pos.at) === 0 ? Y.prevMeasure.get(pos.m) : null;
      if (prev && S.mx.has(prev)) return S.mx.get(prev).x + S.mx.get(prev).w;
      const T = Tof(pos.m, pos.at);
      return (anchor(T, staff) || [xOfT(T)])[0];
    };
    const xAtM = (m, at) => {
      const M = S.mx.get(m), a = q(at), dur = Y.dur.get(m);
      if (Math.abs(a - dur) < 1e-9) return M.x + M.w;
      return xOfT(Y.start.get(m) + a);
    };

    /* ---- where a direction stands: its staff and side (§10.2 priorities 8, 10, 11). kind 'dyn' (dynamics, hairpins,
       words): a part of several staves puts it between its staves - below the first - unless the graph says otherwise; a
       mark above a staff that is not its part's first is between that staff and the one above it (one row there, S2) */
    const resolve = (partId, staff, placement, kind) => {
      const ps = Y.partStaves.get(partId) || [];
      if (!ps.length) return null;
      let st = staff && ps.indexOf(staff) >= 0 ? staff : null;
      let side = placement === 'above' || placement === 'below' ? placement : null;
      const voice = Y.voicePart.has(partId);
      if (!side) side = kind === 'dyn' ? (voice && ps.length === 1 ? 'above' : 'below') : 'above';
      if (!st) st = side === 'above' ? ps[0] : ps.length > 1 ? ps[0] : ps[ps.length - 1];
      if ((kind === 'dyn' || kind === 'words') && side === 'above' && ps.indexOf(st) > 0) { st = ps[ps.indexOf(st) - 1]; side = 'below'; }
      return { staff: st, side: side, band: side === 'below' && ps.indexOf(st) < ps.length - 1, first: ps.indexOf(st) === 0, last: ps.indexOf(st) === ps.length - 1 };
    };

    /* ---- one row on one baseline (§10.4 S2): each item probed where the placement function alone would put it, the
       baseline outside all of them, then every item put there. items: {x0, x1, rise, drop, ref, make(base) -> [objects]} */
    const placeRow = (staffKey, side, items, o) => {
      if (!items.length) return null;
      const sk = sky.get(staffKey), above = side === 'above';
      let base = null;
      items.forEach(it => {
        const b = sk.put({ x0: it.x0, x1: it.x1, h: it.rise + it.drop, side: side, pad: o.pad, limit: o.limit === undefined ? (above ? 0 : lastLine(staffKey)) : o.limit,
          floor: null, probe: true });
        const y = above ? b[3] - it.drop : b[1] + it.rise;
        base = base === null ? y : above ? Math.min(base, y) : Math.max(base, y);
      });
      items.forEach(it => {
        sk.put({ x0: it.x0, x1: it.x1, h: it.rise + it.drop, side: side, at: above ? base + it.drop : base - it.rise, ref: it.ref });
        it.make(base).forEach(x => addObj(Object.assign({ staffKey: staffKey, side: side, layer: x.layer || (x.text !== undefined || x.glyph ? 'text' : 'mark') }, x)));
      });
      return base;
    };
    /* §10.5: a row whose items may not meet is pushed right, in (x, graph order); then what would run past the system's end is
       pulled back inside it, the items before it with it as far as they must (the app's rule for a long chord name at the end of
       a line); -> the items, moved */
    const move = (it, d) => { it.x0 += d; it.x1 += d; it.dx = (it.dx || 0) + d; };
    const pushRight = (items, gap) => {
      items.sort((a, b) => a.x0 - b.x0 || a.order - b.order);
      let end = -Infinity;
      items.forEach(it => {
        if (it.x0 < end + gap) move(it, end + gap - it.x0);
        end = it.x1;
      });
      let lim = S.x1;
      for (let k = items.length - 1; k >= 0; k--) {
        if (items[k].x1 > lim) move(items[k], lim - items[k].x1);
        lim = items[k].x0 - gap;
      }
      return items;
    };
    /* an item alone that would run past the system's end, pulled back inside it */
    const inside = it => { if (it.x1 > S.x1) move(it, S.x1 - it.x1); return it; };
    /* §10.5 for dynamics: hairpins on the first line; a dynamic that would meet one before it on its line goes one line further
       out; a word by the dynamics (dolce, cresc.) after them on the first line, pushed right past what it would meet (p dolce) -
       one line out only when that would take it more than PUSH_MAX from its place; -> lines of items */
    const PUSH_MAX = 4;
    const lines = (items, gap) => {
      const out = [items.filter(it => it.fixed).sort((a, b) => a.x0 - b.x0 || a.order - b.order)];
      /* two hairpins the file lets overlap (a crescendo that stops after the diminuendo after it starts): the earlier one ends
         PAD.apart before the later one, as long as it keeps HAIRPIN.min; else the later one goes a line out */
      const hp = out[0];
      for (let k = 1; k < hp.length; k++) {
        const a = hp[k - 1], b = hp[k];
        if (a.x1 + gap <= b.x0) continue;
        diag('HAIRPIN_OVERLAP', [a.wid, b.wid], 'the earlier one is ended before the later one');
        if (b.x0 - PAD.apart - a.x0 >= HAIRPIN.min) a.x1 = b.x0 - PAD.apart;
        else { hp.splice(k, 1); k--; b.fixed = false; }
      }
      const meets = (it, list) => list.find(x => it.x0 < x.x1 + gap && x.x0 < it.x1 + gap);
      items.filter(it => !it.fixed && it.kind !== 'words').sort((a, b) => a.x0 - b.x0 || a.order - b.order).forEach(it => {
        let k = 0;
        while (out[k] && meets(it, out[k])) k++;
        (out[k] = out[k] || []).push(it);
      });
      items.filter(it => it.kind === 'words').sort((a, b) => a.x0 - b.x0 || a.order - b.order).forEach(it => {
        const x0 = it.x0;
        let hit;
        while ((hit = meets(it, out[0])) && it.x0 - x0 <= PUSH_MAX) move(it, hit.x1 + PAD.word - it.x0);
        if (!meets(it, out[0]) && it.x1 <= S.x1) { out[0].push(it); return; }
        move(it, x0 - it.x0);
        let k = 1;
        while (out[k] && meets(it, out[k])) k++;
        (out[k] = out[k] || []).push(it);
      });
      return out.filter(l => l.length);
    };
    /* a composite item from pieces set left to right from x (each {w, rise, drop, make(x, base)}), `gaps` between them */
    const composite = (pieces, x, gaps) => {
      let cx = x;
      const at = pieces.map((p, i) => { const px = cx; cx += p.w + (i < pieces.length - 1 ? (gaps ? gaps[i] || 0 : 0) : 0); return px; });
      return { x0: x, x1: cx, rise: maxOf(pieces.map(p => p.rise).concat([0])), drop: maxOf(pieces.map(p => p.drop).concat([0])),
        make: (base, dx) => pieces.map((p, i) => p.make(at[i] + (dx || 0), base)) };
    };

    /* ================================================================ 7. lyrics */
    const lyricItems = new Map();
    (Y.lyrics || []).forEach(ly => {
      const e = K.events.get(ly.event);
      if (!e || S.sysOf(e.m) !== si || !byEvent.has(ly.event)) return;
      const staff = Y.voiceStaff.get(e.voice) || e.staff;
      if (!sky.has(staff)) return;
      const heads = byEvent.get(ly.event).filter(o => o.staffKey === e.staff);
      if (!heads.length) return;
      const text = norm(ly.text);
      if (!text) return;
      const pc = textPiece({ kind: 'lyric', text: text, font: FONT.lyric, size: SIZE.lyric });
      textMissing(pc, ly.ref);
      const cx = (minOf(heads.map(o => o.box[0])) + maxOf(heads.map(o => o.box[2]))) / 2;
      const k = staff + '|' + ly.verse;
      if (!lyricItems.has(k)) lyricItems.set(k, { staff: staff, verse: ly.verse, items: [] });
      lyricItems.get(k).items.push({ ref: ly.ref, event: ly.event, x0: cx - pc.w / 2, x1: cx + pc.w / 2, rise: pc.rise, drop: pc.drop, order: ly.order,
        syllabic: ly.syllabic, extend: ly.extend, measure: e.m, pc: pc });
    });
    [...lyricItems.values()].sort((a, b) => Y.staffIndex.get(a.staff) - Y.staffIndex.get(b.staff) || a.verse - b.verse).forEach(L => {
      const items = pushRight(L.items, PAD.apart * 0.5);
      /* one line per verse and system: the syllables, and between the syllables of a word a hyphen where there is room */
      const row = items.map((it, i) => ({ x0: it.x0, x1: it.x1, rise: it.rise, drop: it.drop, ref: it.ref,
        make: base => {
          const out = [Object.assign(it.pc.make(it.x0, base), { id: it.ref, refs: [it.event, it.ref], measure: it.measure, verse: L.verse })];
          const next = items[i + 1];
          if ((it.syllabic === 'begin' || it.syllabic === 'middle') && next) {
            const room = next.x0 - it.x1;
            if (room >= HYPHEN.width + 2 * HYPHEN.gap) {
              const hx = (it.x1 + next.x0) / 2, hy = base - HYPHEN.lift - SIZE.lyric * 0.1;
              out.push({ id: it.ref + '#hyphen', kind: 'lyric-line', refs: [it.event, it.ref], measure: it.measure, verse: L.verse,
                box: [hx - HYPHEN.width / 2, hy - HYPHEN.thick / 2, hx + HYPHEN.width / 2, hy + HYPHEN.thick / 2] });
            }
          }
          return out;
        } }));
      placeRow(L.staff, 'below', row, { pad: PAD.lyric });
    });

    /* ================================================================ 8. dynamics, hairpins, words by them */
    const dynRows = new Map();
    const rowOf = (r, key) => { const k = r.staff + '|' + r.side; if (!dynRows.has(k)) dynRows.set(k, { staff: r.staff, side: r.side, band: r.band, items: [] }); return dynRows.get(k); };
    const upperWords = [], lowerWords = [];
    (Y.directions || []).forEach((d, order) => {
      if (d.kind !== 'dynamic' && d.kind !== 'words') return;
      if (!here(d.m)) return;
      const T = Tof(d.m, d.at);
      const r = resolve(d.part, d.staff, d.placement, d.kind === 'dynamic' ? 'dyn' : 'words');
      if (!r) return;
      const a = anchor(T, r.staff, d.event) || [xAtM(d.m, d.at), xAtM(d.m, d.at)];
      if (d.kind === 'words') {
        const text = norm(d.text);
        if (!text) return;
        const pc = textPiece({ kind: 'words', text: text, font: FONT.words, size: SIZE.words });
        textMissing(pc, d.id);
        /* at its note, or right-aligned to the bar line when it stands at the measure's end (Fine) */
        const wx = Math.abs(q(d.at) - Y.dur.get(d.m)) < 1e-9 ? xAtM(d.m, d.at) - pc.w : a[0];
        const it = { ref: d.id, order: order, x0: wx, x1: wx + pc.w, rise: pc.rise, drop: pc.drop, measure: d.m,
          make: (base, dx) => [Object.assign(pc.make(wx + (dx || 0), base), { id: d.id, refs: [d.id], measure: d.m })] };
        it.make0 = it.make;
        it.make = (base, dx) => it.make0(base, dx === undefined ? it.dx : dx);
        /* words above a part's first staff are the upper row's; below its last, the lower row's; anywhere else they share
           the dynamics' line (cresc., dim., dolce between the staves) */
        if (r.side === 'above' && r.first) upperWords.push(Object.assign(it, { staff: r.staff }));
        else if (r.side === 'below' && r.last && !r.band && Y.partStaves.get(d.part).length > 1) lowerWords.push(Object.assign(it, { staff: r.staff }));
        else rowOf(r).items.push(Object.assign(inside(it), { kind: 'words' }));
        return;
      }
      /* a dynamic: its letters as glyphs, centred on its note; niente and a dynamic in words as text, at its note; the
         marks after it that the same element prints (p dolce) after it */
      const parts = dynParts(d);
      if (!parts.length) return;
      parts.forEach(p => textMissing(p, d.id));
      const ext = [minOf(parts.map(p => p.box[0])), maxOf(parts.map(p => p.box[2]))];
      const glyphs = parts.filter(p => p.obj.glyph);
      const shiftX = glyphs.length ? (a[0] + a[1]) / 2 - (minOf(glyphs.map(p => p.box[0])) + maxOf(glyphs.map(p => p.box[2]))) / 2 : a[0] - ext[0];
      /* the same dynamic stated twice at one place of one row (a part's two staves both saying it): one mark naming both */
      const sig = JSON.stringify([d.value, d.text, d.more]);
      const twin = rowOf(r).items.find(it => it.kind === 'dynamic' && it.sig === sig && Math.abs(it.T - T) < 1e-9);
      if (twin) { twin.refs.push(d.id); return; }
      const refs = [d.id];
      rowOf(r).items.push({ kind: 'dynamic', ref: d.id, refs: refs, sig: sig, order: order, T: T, x0: ext[0] + shiftX, x1: ext[1] + shiftX,
        rise: maxOf(parts.map(p => -p.box[1])), drop: maxOf(parts.map(p => Math.max(0, p.box[3]))), measure: d.m,
        make: (base, dx) => parts.map((p, i) => Object.assign({}, p.obj, { box: [p.box[0] + shiftX + (dx || 0), p.box[1] + base, p.box[2] + shiftX + (dx || 0), p.box[3] + base],
          id: parts.length > 1 ? d.id + '#' + i : d.id, refs: refs.slice(), measure: d.m }, parts.length > 1 ? { group: d.id } : {})) });
    });
    /* hairpins (S5): level, on the dynamics' line; from 0.5 sp after a dynamic where one starts it (else from its note), to
       0.5 sp before one where it ends (else to just before the note or bar line it stops at); in parts across a break - a
       continuation opens from CONT */
    (Y.wedges || []).forEach((w, order) => {
      const A = Tof(w.from.m, w.from.at), Z = Tof(w.to.m, w.to.at);
      if (A === null || Z === null || !(A < T1 - 1e-9 && Z > T0 + 1e-9) || !(Z > A)) return;
      const r = resolve(w.part, w.staff, w.placement, 'dyn');
      if (!r) return;
      const row = rowOf(r);
      const startsHere = A >= T0 - 1e-9, endsHere = Z <= T1 + 1e-9;
      /* the dynamics at a time (there may be two, a line apart): the hairpin clears them all */
      const dynAt = T => row.items.filter(it => it.kind === 'dynamic' && Math.abs(it.T - T) < 1e-9);
      let x0, x1;
      if (startsHere) {
        const dA = dynAt(A);
        const a = anchor(A, r.staff);
        x0 = dA.length ? maxOf(dA.map(it => it.x1)) + PAD.hairpin : a ? a[0] : S.startX;
      } else x0 = S.startX;
      if (endsHere) {
        const dZ = dynAt(Z);
        x1 = dZ.length ? minOf(dZ.map(it => it.x0)) - PAD.hairpin : endX(w.to, r.staff) - PAD.hairpin;
      } else x1 = S.endX;
      /* and 0.5 sp clear of a dynamic of its row that stands at either end, where its time is not quite the hairpin's (S5) */
      row.items.filter(it => it.kind === 'dynamic').forEach(it => {
        if (startsHere && it.x0 <= x0 && it.x1 + PAD.hairpin > x0) x0 = it.x1 + PAD.hairpin;
        if (endsHere && it.x1 >= x1 && it.x0 - PAD.hairpin < x1) x1 = it.x0 - PAD.hairpin;
      });
      if (x1 - x0 < HAIRPIN.min) {
        diag('HAIRPIN_SHORT', [w.id], (Math.round((x1 - x0) * 100) / 100) + ' sp');
        x1 = x0 + HAIRPIN.min;
      }
      const part = startsHere && endsHere ? 'whole' : startsHere ? 'start' : endsHere ? 'end' : 'mid';
      const cresc = w.wedge !== 'diminuendo';
      /* the opening at each end: a crescendo from its point (or, continued after a break, from CONT) to OPEN; a
         diminuendo the other way */
      const ends = cresc ? [part === 'whole' || part === 'start' ? 0 : HAIRPIN.cont, HAIRPIN.open]
        : [HAIRPIN.open, part === 'whole' || part === 'end' ? 0 : HAIRPIN.cont];
      const id = part === 'whole' ? w.id : part === 'mid' ? w.id + '#mid@' + S.first : w.id + '#' + part;
      const measure = measureOf(Math.max(A, T0));
      /* the same hairpin stated twice (a part's two staves both saying it): one, naming both */
      const twin = row.items.find(it => it.kind === 'hairpin' && it.cresc === cresc && Math.abs(it.x0 - x0) < 1e-6 && Math.abs(it.x1 - x1) < 1e-6);
      if (twin) { twin.refs.push(w.id); return; }
      const refs = [w.id];
      const item = { kind: 'hairpin', ref: id, refs: refs, cresc: cresc, order: 1e6 + order, fixed: true, x0: x0, x1: x1, rise: HAIRPIN.rise + HAIRPIN.open / 2,
        drop: Math.max(0, HAIRPIN.open / 2 - HAIRPIN.rise), wid: w.id,
        make: (base, dx) => {
          const y = base - HAIRPIN.rise, xa = item.x0 + (dx || 0), xb = item.x1 + (dx || 0);
          return [{ id: id, kind: 'hairpin', refs: refs.slice(), measure: measure, wedge: cresc ? 'crescendo' : 'diminuendo', line: [xa, y, xb, y], ends: ends, t: HAIRPIN.thick,
            box: [xa, y - HAIRPIN.open / 2, xb, y + HAIRPIN.open / 2], layer: 'mark' }];
        } };
      row.items.push(item);
    });
    /* each row: its lines (a dynamic or a word that would meet another goes one line out, hairpins stay on the first), the
       first line nearest the staff; a row between a part's staves is marked for the layout to centre */
    [...dynRows.values()].sort((a, b) => Y.staffIndex.get(a.staff) - Y.staffIndex.get(b.staff) || (a.side < b.side ? -1 : 1)).forEach(R => {
      const ls = lines(R.items, PAD.apart * 0.5);
      ls.forEach(list => placeRow(R.staff, R.side, list.map(it => ({ x0: it.x0, x1: it.x1, rise: it.rise, drop: it.drop, ref: it.ref,
        make: base => it.make(base).map(o => (R.band ? Object.assign(o, { band: true }) : o)) })), { pad: PAD.row }));
    });

    /* ================================================================ 9. pedal */
    /* every pedal of the system on one line under its part's lowest staff (S2) */
    const pedalRows = new Map();
    (Y.pedals || []).forEach(pd => {
      const A = Tof(pd.from.m, pd.from.at), Z = pd.to ? Tof(pd.to.m, pd.to.at) : null;
      if (A === null || !(A < T1 - 1e-9) || (Z !== null && !(Z > T0 + 1e-9))) return;
      const ps = Y.partStaves.get(pd.part) || [];
      const staff = ps[ps.length - 1];
      if (!staff || !sky.has(staff)) return;
      const startsHere = A >= T0 - 1e-9, endsHere = Z !== null && Z <= T1 + 1e-9;
      /* a printed sign unless the graph says sign: false; a line when it says line: true, or when there is no sign */
      const sign = !pd.mark || pd.mark.sign !== false;
      const line = !!(pd.mark && pd.mark.line) || !sign;
      const gs = gscale(SIZE.pedal);
      /* where it goes down (the note's left), and where it comes up (the left of the note it lets go at, or the bar line) */
      const xA = startsHere ? (anchor(A, staff) || [xOfT(A)])[0] : S.startX;
      const xZ = endsHere ? endX(pd.to, staff) : S.endX;
      const changes = (pd.changes || []).map((c, i) => ({ T: Tof(c.m, c.at), i: i, ref: pd.id + '#change' + i }))
        .filter(c => c.T !== null && c.T >= T0 - 1e-9 && c.T < T1 - 1e-9);
      changes.forEach(c => { c.x = (anchor(c.T, staff) || [xOfT(c.T)])[0]; c.measure = measureOf(c.T); });
      const measure = measureOf(Math.max(A, T0));
      const press = glyphPiece(MT.PEDAL.press, gs, 'pedal'), release = glyphPiece(MT.PEDAL.release, gs, 'pedal');
      /* the signs: Ped. from its note, * just before the note it lets go at; at a change both - the release just before the
         note, the press at it (a lift and a new press, as the app plays it) */
      const signs = [];
      if (sign && startsHere) signs.push({ x0: xA - PEDAL.lead, p: press, id: pd.id + '#press', refs: [pd.id], measure: measure });
      if (sign && !line) {
        changes.forEach(c => {
          signs.push({ x0: c.x - PEDAL.release - release.w, p: release, id: pd.id + '#change' + c.i + '.up', refs: [pd.id, c.ref], measure: c.measure });
          signs.push({ x0: c.x - PEDAL.lead, p: press, id: pd.id + '#change' + c.i + '.down', refs: [pd.id, c.ref], measure: c.measure });
        });
        if (endsHere) signs.push({ x0: xZ - PEDAL.release - release.w, p: release, id: pd.id + '#release', refs: [pd.id], measure: measureOf(Math.min(Z, T1 - 1e-9)) || measure });
      }
      /* the signs apart: a dense pedal pushes the later one right (§10.5) */
      signs.forEach((it, k) => { it.order = k; it.x1 = it.x0 + it.p.w; });
      pushRight(signs, 0.1);
      const row = signs.map(it => ({ x0: it.x0, x1: it.x1, rise: it.p.rise, drop: it.p.drop, ref: it.id,
        make: base => [Object.assign(it.p.make(it.x0, base), { id: it.id, refs: it.refs, measure: it.measure })] }));
      if (line) {
        /* the line: from the press (after Ped. when that is printed) to the release, a hook up at each end it has in this
           system (none after a printed Ped.), a notch at each change, a piece between each two */
        const x0 = sign && startsHere ? signs[0].x1 + 0.2 : startsHere ? xA : S.startX;
        const x1 = endsHere ? xZ - PEDAL.lead : S.endX;
        const stops = [x0].concat(changes.map(c => c.x), [x1]);
        const segs = [];
        for (let k = 0; k + 1 < stops.length; k++) {
          const a = k === 0 ? stops[0] : stops[k] + PEDAL.notch / 2, b = k + 2 < stops.length ? stops[k + 1] - PEDAL.notch / 2 : stops[k + 1];
          if (b > a + 1e-9) segs.push({ a: a, b: b, k: k, hooks: [k === 0 && startsHere && !sign, k + 2 === stops.length && endsHere] });
        }
        const suffix = startsHere ? '' : '@' + S.first;
        segs.forEach(sg => row.push({ x0: sg.a, x1: sg.b, rise: sg.hooks[0] || sg.hooks[1] ? PEDAL.hook : PEDAL.thick / 2, drop: PEDAL.thick / 2, ref: pd.id + '#line' + sg.k + suffix,
          make: base => [{ id: pd.id + '#line' + sg.k + suffix, kind: 'pedal-line', refs: [pd.id], measure: measure, line: [sg.a, base, sg.b, base], hooks: sg.hooks,
            hookLen: PEDAL.hook, side: 'below', t: PEDAL.thick, box: [sg.a, base - (sg.hooks[0] || sg.hooks[1] ? PEDAL.hook : PEDAL.thick / 2), sg.b, base + PEDAL.thick / 2],
            layer: 'mark' }] }));
        changes.forEach(c => row.push({ x0: c.x - PEDAL.notch / 2, x1: c.x + PEDAL.notch / 2, rise: PEDAL.hook, drop: PEDAL.thick / 2, ref: pd.id + '#change' + c.i,
          make: base => [{ id: pd.id + '#change' + c.i, kind: 'pedal-change', refs: [pd.id, c.ref], measure: c.measure,
            line: [c.x - PEDAL.notch / 2, base, c.x + PEDAL.notch / 2, base], hookLen: PEDAL.hook, t: PEDAL.thick,
            box: [c.x - PEDAL.notch / 2, base - PEDAL.hook, c.x + PEDAL.notch / 2, base + PEDAL.thick / 2], layer: 'mark' }] }));
      }
      if (!pedalRows.has(staff)) pedalRows.set(staff, []);
      row.forEach(it => pedalRows.get(staff).push(it));
    });
    [...pedalRows.keys()].sort((a, b) => Y.staffIndex.get(a) - Y.staffIndex.get(b)).forEach(staff => placeRow(staff, 'below', pedalRows.get(staff), { pad: PAD.pedal }));

    /* ================================================================ 10. the upper row */
    const topStaff = P.staves[0].id;
    /* octave lines (A10): per staff they move, over exactly the notes under them in this system - from the first one's left
       to the last one's right; the label at the start ("(8)" where the line goes on from notes in an earlier system), a
       hook at the end that closes it (no note of it after this system); an 8va, 15ma above its staff, an 8vb, 15mb below */
    const ottRows = new Map();
    (Y.ottavas || []).forEach(ov => {
      const A = Tof(ov.from.m, ov.from.at), Z = Tof(ov.to.m, ov.to.at);
      if (A === null || Z === null || !(A < T1 - 1e-9 && Z > T0 + 1e-9)) return;
      ov.covers.forEach(staff => {
        if (!sky.has(staff)) return;
        const Ts = Y.ottEvents.get(ov.id + '|' + staff) || [];
        const under = objs.filter(o => (o.kind === 'notehead' || o.kind === 'rest') && !o.grace && o.staffKey === staff && o.event && K.events.has(o.event) &&
          (() => { const T = Tof(K.events.get(o.event).m, K.events.get(o.event).at); return T >= A - 1e-9 && T < Z - 1e-9; })())
          .sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : 1));
        if (!under.length) return;
        const side = ov.shift > 0 ? 'above' : 'below';
        const cont = Ts.some(T => T < T0 - 1e-9), closed = !Ts.some(T => T >= T1 - 1e-9);
        /* from the first note under it; to the last one's right edge where it closes, else on to the system's end */
        const x0 = under[0].box[0] - OTTAVA.lead, x1 = closed ? maxOf(under.map(o => o.box[2])) + OTTAVA.lead : Math.max(S.endX, maxOf(under.map(o => o.box[2])) + OTTAVA.lead);
        const label = textPiece({ kind: 'ottava', text: (cont ? OTTAVA_CONT : OTTAVA_LABEL)[ov.shift] || '8va', font: FONT.ottava, size: SIZE.ottava });
        textMissing(label, ov.id);
        /* the line at the middle of the label's figures */
        const midY = -label.rise * 0.45;
        const id = ov.id + (ov.covers.length > 1 ? ':' + staff : '') + '@' + under[0].measure;
        const lineX0 = x0 + label.w + OTTAVA.gap;
        const down = side === 'above';
        const k = staff + '|' + side;
        if (!ottRows.has(k)) ottRows.set(k, { staff: staff, side: side, items: [] });
        const hook = closed ? OTTAVA.hook : 0;
        ottRows.get(k).items.push({ x0: x0, x1: Math.max(x1, x0 + label.w), rise: Math.max(label.rise, down ? 0 : hook - midY), drop: Math.max(label.drop, down ? hook + midY : 0),
          ref: id, make: base => {
            const out = [Object.assign(label.make(x0, base), { id: id, refs: [ov.id], measure: under[0].measure })];
            if (x1 > lineX0) {
              const y = base + midY;
              out.push({ id: id + '#line', kind: 'ottava-line', refs: [ov.id], measure: under[0].measure, line: [lineX0, y, x1, y], hooks: [false, closed],
                hookLen: OTTAVA.hook, side: side, t: OTTAVA.thick, open: !closed,
                box: down ? [lineX0, y - OTTAVA.thick / 2, x1, y + (closed ? OTTAVA.hook : OTTAVA.thick / 2)]
                  : [lineX0, y - (closed ? OTTAVA.hook : OTTAVA.thick / 2), x1, y + OTTAVA.thick / 2], layer: 'mark' });
            }
            return out;
          } });
      });
    });
    [...ottRows.values()].sort((a, b) => Y.staffIndex.get(a.staff) - Y.staffIndex.get(b.staff) || (a.side < b.side ? -1 : 1))
      .forEach(R => placeRow(R.staff, R.side, R.items, { pad: PAD.row }));

    /* chord names (§10.2 priority 10, §10.5): sans 1.4 sp, left at their note, on one line; pushed right where two would
       meet, in (x, graph order) */
    const chordRows = new Map();
    (Y.directions || []).forEach((d, order) => {
      if (d.kind !== 'chord' || !here(d.m)) return;
      const T = Tof(d.m, d.at);
      const r = resolve(d.part, d.staff, d.placement || 'above', 'chord');
      if (!r) return;
      const a = anchor(T, r.staff, d.event) || [xAtM(d.m, d.at)];
      const pieces = chordPieces(d);
      if (!pieces.length) return;
      pieces.forEach(p => textMissing(p, d.id));
      const c = composite(pieces, a[0]);
      const k = r.staff + '|' + r.side;
      if (!chordRows.has(k)) chordRows.set(k, { staff: r.staff, side: r.side, items: [] });
      chordRows.get(k).items.push({ ref: d.id, order: order, x0: c.x0, x1: c.x1, rise: c.rise, drop: c.drop,
        make: (base, dx) => c.make(base, dx).map((o, i) => Object.assign(o, { id: pieces.length > 1 ? d.id + '#' + i : d.id, refs: [d.id], measure: d.m },
          pieces.length > 1 ? { group: d.id } : {})) });
    });
    [...chordRows.values()].sort((a, b) => Y.staffIndex.get(a.staff) - Y.staffIndex.get(b.staff) || (a.side < b.side ? -1 : 1)).forEach(R => {
      pushRight(R.items, PAD.apart);
      placeRow(R.staff, R.side, R.items.map(it => ({ x0: it.x0, x1: it.x1, rise: it.rise, drop: it.drop, ref: it.ref, make: base => it.make(base, it.dx) })),
        { pad: PAD.row, limit: R.side === 'above' ? -1.0 : lastLine(R.staff) + 1.0 });
    });

    /* voltas: a bracket over their bars in this system, from 0.3 sp after the bar line it starts at to 0.3 sp before the one
       it ends at; the label on the part where the ending starts; a closed end hooked down where the ending closes here */
    const voltaItems = [];
    (P.endings || []).forEach(en => {
      const a = K.mIndex.get(en.from), b = K.mIndex.has(en.to) ? K.mIndex.get(en.to) : a;
      const inSys = ms.filter(M => K.mIndex.get(M.id) >= a && K.mIndex.get(M.id) <= b);
      if (!inSys.length) return;
      const first = inSys[0].id === en.from, closes = inSys[inSys.length - 1].id === en.to && !en.open;
      const x0 = inSys[0].x + VOLTA.inset, x1 = inSys[inSys.length - 1].x + inSys[inSys.length - 1].w - VOLTA.inset;
      const text = first ? norm(en.text || ((en.numbers || []).join(', ') + '.')) : null;
      const lab = text ? textPiece({ kind: 'volta-label', text: text, font: FONT.volta, size: SIZE.volta }) : null;
      if (lab) textMissing(lab, en.id);
      const id = en.id + ':' + inSys[0].id;
      voltaItems.push({ ref: id, x0: x0, x1: x1, rise: VOLTA.height, drop: 0, make: base => {
        const out = [{ id: id, kind: 'volta', refs: [en.id], measure: inSys[0].id, box: [x0, base - VOLTA.height, x1, base], layer: 'above',
          open: !closes, start: first, label: text || undefined, group: id }];
        /* the label's cap line 0.25 sp under the bracket */
        if (lab) out.push(Object.assign(lab.make(x0 + VOLTA.labelDx, base - VOLTA.height + 0.25 + lab.rise), { id: id + '#label', refs: [en.id], measure: inSys[0].id, layer: 'text', group: id }));
        return out;
      } });
    });
    placeRow(topStaff, 'above', voltaItems, { pad: PAD.row, limit: -1.0 });

    /* tempo and rehearsal marks, above the top staff: a rehearsal mark framed at its bar line; a tempo's words and its
       metronome mark (a note, "= 120", in parentheses when the graph says so) left at its note; pushed right where they
       meet */
    const tempoItems = [];
    (Y.tempos || []).forEach((t, order) => {
      if (!here(t.m)) return;
      const T = Tof(t.m, t.at);
      const a = anchor(T, topStaff) || [xAtM(t.m, t.at)];
      const pieces = tempoPieces(t);
      if (!pieces.length) return;
      pieces.forEach(p => textMissing(p, t.id));
      const c = composite(pieces, a[0], pieces.map(p => p.gapAfter || 0));
      tempoItems.push({ ref: t.id, order: 1000 + order, x0: c.x0, x1: c.x1, rise: c.rise, drop: c.drop,
        make: (base, dx) => [].concat(...c.make(base, dx).map((o, i) => (Array.isArray(o) ? o : [o]).map((x, j) => Object.assign(x,
          { id: t.id + '#' + i + (j ? '.' + j : ''), refs: [t.id], measure: t.m, group: t.id })))) });
    });
    (Y.directions || []).forEach((d, order) => {
      if (d.kind !== 'rehearsal' || !here(d.m)) return;
      const text = norm(d.text);
      if (!text) return;
      const M = S.mx.get(d.m);
      const x = q(d.at) === 0 ? M.x : xAtM(d.m, d.at);
      const pc = textPiece({ kind: 'rehearsal', text: text, font: FONT.rehearsal, size: SIZE.rehearsal });
      textMissing(pc, d.id);
      tempoItems.push({ ref: d.id, order: order, x0: x - FRAME.pad, x1: x + pc.w + FRAME.pad, rise: pc.rise + FRAME.pad, drop: pc.drop + FRAME.pad,
        make: (base, dx) => [Object.assign(pc.make(x + (dx || 0), base), { id: d.id, refs: [d.id], measure: d.m, group: d.id }),
          { id: d.id + '#frame', kind: 'frame', refs: [d.id], measure: d.m, group: d.id, t: FRAME.thick,
            box: [x + (dx || 0) - FRAME.pad, base - pc.rise - FRAME.pad, x + (dx || 0) + pc.w + FRAME.pad, base + pc.drop + FRAME.pad], layer: 'text' }] });
    });
    pushRight(tempoItems, PAD.apart);
    placeRow(topStaff, 'above', tempoItems.map(it => ({ x0: it.x0, x1: it.x1, rise: it.rise, drop: it.drop, ref: it.ref, make: base => it.make(base, it.dx) })),
      { pad: PAD.row, limit: -1.5 });

    /* jumps and words: segno and coda signs at their bar line, the words of a jump (or what it stands for: D.C., D.S.,
       Fine, To Coda) at their place - right-aligned to the bar line when they stand at its end; above, or below the lowest
       staff where the graph says so (§10.2 priorities 10, 11) */
    const jumpRows = new Map();
    const jumpRow = (staff, side) => { const k = staff + '|' + side; if (!jumpRows.has(k)) jumpRows.set(k, { staff: staff, side: side, items: [] }); return jumpRows.get(k); };
    (Y.jumps || []).forEach((j, order) => {
      if (!here(j.m)) return;
      const disp = (j.display || [])[0] || {};
      const partId = disp.part || Y.firstPart;
      const ps = Y.partStaves.get(partId) || [topStaff];
      const side = disp.placement === 'below' ? 'below' : 'above';
      const staff = disp.staff && ps.indexOf(disp.staff) >= 0 ? disp.staff : side === 'above' ? ps[0] : ps[ps.length - 1];
      if (!sky.has(staff)) return;
      const M = S.mx.get(j.m), a = q(j.at), atEnd = Math.abs(a - Y.dur.get(j.m)) < 1e-9, atStart = a === 0;
      let pc, x;
      if (MT.JUMP_SIGN[j.kind] && !norm(j.text)) {
        pc = glyphPiece(MT.JUMP_SIGN[j.kind], gscale(SIZE.sign), 'jump');
        x = (atStart ? M.x : xAtM(j.m, j.at)) - pc.w / 2;
      } else {
        const text = norm(j.text) || JUMP_TEXT[j.kind] || '';
        if (!text) return;
        pc = textPiece({ kind: 'jump', text: text, font: FONT.jump, size: SIZE.jump });
        textMissing(pc, j.id);
        x = atEnd ? M.x + M.w - pc.w : atStart ? M.x + 0.3 : (anchor(Tof(j.m, j.at), staff) || [xAtM(j.m, j.at)])[0];
      }
      jumpRow(staff, side).items.push({ ref: j.id, order: order, x0: x, x1: x + pc.w, rise: pc.rise, drop: pc.drop,
        make: (base, dx) => [Object.assign(pc.make(x + (dx || 0), base), { id: j.id, refs: [j.id], measure: j.m })] });
    });
    upperWords.forEach(w => jumpRow(w.staff, 'above').items.push(w));
    lowerWords.forEach(w => jumpRow(w.staff, 'below').items.push(w));
    [...jumpRows.values()].sort((a, b) => Y.staffIndex.get(a.staff) - Y.staffIndex.get(b.staff) || (a.side < b.side ? -1 : 1)).forEach(R => {
      pushRight(R.items, PAD.apart);
      placeRow(R.staff, R.side, R.items.map(it => ({ x0: it.x0, x1: it.x1, rise: it.rise, drop: it.drop, ref: it.ref, make: base => it.make(base, it.dx) })), { pad: PAD.row });
    });
  }

  /* a dynamic's parts, each an object and its box from the origin of the first letter on a baseline at 0: its letters as
     SMuFL glyphs, each letter's origin at the one before's right edge (its advance - an f's tail runs under the letter
     before it); niente, a dynamic in words (sempre, a tempo) as italic text; then what the same dynamics element also
     prints, after a gap */
  function dynParts(d) {
    const out = [];
    const gs = gscale(SIZE.dynamic);
    let x = 0;
    const letters = (names, gap) => {
      if (gap && out.length) x += gap;
      names.forEach(n => {
        const g = MT.glyph(n), b = MT.box(n, x, 0, gs);
        out.push({ obj: { kind: 'dynamic', glyph: n, scale: gs }, box: b });
        x = b[0] + (g.xMax - g.xMin) * gs;
      });
    };
    const text = (t, gap) => {
      if (!t) return;
      if (gap && out.length) x += gap;
      const m = TX.measure(t, FONT.dynamic, SIZE.words);
      out.push({ obj: { kind: 'dynamic', text: t, font: FONT.dynamic, size: SIZE.words }, box: [x, m.top, x + m.w, m.bottom], missing: m.missing });
      x += m.w;
    };
    const one = (value, t, gap) => {
      const ls = value && value !== 'other' ? MT.dynamic(value) : null;
      if (ls) letters(ls, gap);
      else text(value === 'other' || !value ? norm(t) : norm(value), gap);
    };
    one(d.value, d.text, 0);
    (d.more || []).forEach(m => one(m.value, m.text, PAD.word));
    return out;
  }
  /* a chord name as pieces: its root, a sharp or flat as a glyph, the kind (the printed text when the graph has it), the
     degrees, "/" and the bass */
  function chordPieces(d) {
    const acc = a => ACC_TEXT[String(a || 0)] || '';
    let s = d.root ? d.root.step + acc(d.root.alter) : '';
    const kind = d.text !== null && d.text !== undefined ? String(d.text) : (CHORD_KIND[d.chordKind] !== undefined ? CHORD_KIND[d.chordKind] : '');
    s += kind.replace(/b(?=\d)/g, '♭').replace(/#(?=\d)/g, '♯');
    (d.degrees || []).forEach(g => { s += (g.type === 'subtract' ? 'no' : g.type === 'add' ? 'add' : '') + acc(g.alter) + g.value; });
    if (d.bass) s += '/' + d.bass.step + acc(d.bass.alter);
    s = s.replace(/\s+/g, ' ').trim();
    if (d.chordKind === 'none' && (d.text === null || d.text === undefined)) s = 'N.C.';
    const pieces = [];
    let run = '';
    const flush = () => { if (run) pieces.push(textPiece({ kind: 'chord', text: run, font: FONT.chord, size: SIZE.chord })); run = ''; };
    for (const ch of s) {
      if (CHORD_ACC[ch]) {
        flush();
        const [name, scale, raise] = CHORD_ACC[ch];
        const p = glyphPiece(name, scale, 'chord', raise);
        p.w += 0.05;
        pieces.push(p);
      } else run += ch;
    }
    flush();
    return pieces;
  }
  /* a tempo's pieces: its words, then the metronome mark - "(", a note (a head, its stem, a flag, a dot), "= 120", ")" */
  function tempoPieces(t) {
    const out = [];
    const mk = t.mark || {};
    const words = norm(mk.text);
    if (words) { const p = textPiece({ kind: 'tempo', text: words, font: FONT.tempo, size: SIZE.tempo }); p.gapAfter = METRO.gap * 2; out.push(p); }
    let unit = mk.unit || null, dots = mk.dots || 0, per = mk.perMinute ? q(mk.perMinute) : null;
    if (!unit && !per && t.heading && t.qpm) { unit = 'quarter'; per = q(t.qpm); }
    if (unit && per) {
      const num = Math.abs(per - Math.round(per)) < 1e-6 ? String(Math.round(per)) : String(Math.round(per * 100) / 100);
      const parens = !!mk.parens;
      if (parens) out.push(textPiece({ kind: 'tempo', text: '(', font: FONT.metronome, size: SIZE.metronome }));
      out.push(notePiece(unit, dots));
      out[out.length - 1].gapAfter = METRO.gap;
      out.push(textPiece({ kind: 'tempo', text: '= ' + num + (parens ? ')' : ''), font: FONT.metronome, size: SIZE.metronome }));
    }
    return out;
  }
  /* a metronome mark's note: a head at SCALE, a stem up, a flag or two, dots - one piece whose make gives the objects */
  function notePiece(unit, dots) {
    const s = METRO.scale;
    const head = MT.notehead(unit, 'normal').name, hg = MT.glyph(head);
    const stemless = unit === 'whole' || unit === 'breve';
    const fp = MT.flag(unit, true), fg = fp && !fp.missing ? MT.glyph(fp.name) : null;
    const dg = MT.glyph('augmentationDot');
    const w = hg.w * s + (fg ? fg.w * s * 0.8 : 0) + dots * (dg.w + 0.2) * s + 0.1;
    const up = METRO.stem;
    return { w: w, rise: stemless ? hg.yMax * s + 0.15 : up + 0.15, drop: -hg.yMin * s,
      make: (x, base) => {
        const y = base - 0.15;
        const out = [{ kind: 'tempo', glyph: head, scale: s, box: MT.box(head, x - hg.xMin * s, y, s) }];
        const hr = x + hg.w * s;
        if (!stemless) {
          out.push({ kind: 'tempo', box: [hr - MT.ENGRAVING.stem * s * 1.2, y - up, hr, y - 0.1 * s] });
          if (fg) out.push({ kind: 'tempo', glyph: fp.name, scale: s, box: MT.box(fp.name, hr - MT.ENGRAVING.stem * s * 1.2 - fg.xMin * s, y - up, s) });
        }
        for (let k = 0; k < dots; k++) out.push({ kind: 'tempo', glyph: 'augmentationDot', scale: s,
          box: MT.box('augmentationDot', hr + (fg ? fg.w * s * 0.8 : 0) + 0.2 * s + k * (dg.w + 0.2) * s - dg.xMin * s, y - 0.25, s) });
        return out;
      } };
  }

  return Object.freeze({ SIZE, FONT, PAD, HAIRPIN, PEDAL, OTTAVA, VOLTA, METRO, HYPHEN, FRAME, CHORD_KIND, JUMP_TEXT, OTTAVA_LABEL, OTTAVA_CONT,
    placeSystem, chordPieces, tempoPieces });
});
