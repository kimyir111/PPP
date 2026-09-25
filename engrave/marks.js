/* ============================================================================
   PPP engrave — what stands around the notes, placed (docs/GOALS/G04 §10.1-§10.2 priorities 3-7, §12, §13; G4d-1a;
   the order and tie rules as G4-L4 and G4-L5 amend them)

   One pass per system, once the notes, beams and rests are where they go
   (layout.js notateSystem): every item outside the notes is placed through the
   one placement function (skyline.js put(), §10.1) over the skylines of the
   system's staves - the top and bottom reach of each 0.25 sp of x, of the notes
   and of what was placed before - in G04's order (G4-L5), each item outside what
   came before it:
     1  ties (§13.1): every tie of the plan - a chord's partial ties, across bar
        lines, across a system break as two halves, from one voice to another;
        the direction by §13.1's rule as G4-L4 amends it (a chord's by each head's
        place in its own chord), each end beside its own head (after dots) and
        nearer it than any other head of the chord
     2  tuplet numbers and brackets (§12): a bracket outside the staff, a number
        without one by its beam, inside the staff where it is free (G4c review M2)
     3  articulations, ornaments, fermatas (on notes, rests and bar lines),
        tremolos: on the note's side (opposite the stem; a voice's own side where
        two share the staff - there on the stem, beyond its end), staccato and
        tenuto innermost - inside the staff, in a space - accent, marcato,
        ornament, fermata outward; a tremolo on its stem
     4  printed fingering: the graph's placement, else above the first staff of a
        part and below the second; a chord's fingers stacked - by its notes,
        inside the slurs that come after it
     5  slurs (§13.2), shortest first: the graph's own pairs, their ends at the head
        or beyond the stem, the arc raised over everything between - the fingering
        by an end too; glissandi (§13.4), a straight or wavy line with its word
   An item the placement function sets more than 8 sp from its staff is placed all
   the same and says so (§10.5 FAR_PLACEMENT, skyline.js).
   Coordinates are staff spaces, x absolute in the system, y from each staff's top
   line (y down) - the layout scales and stacks them afterwards. Pure: no DOM, no
   clock, no random; every list in a fixed order.

     placeSystem(S)   S = {P, objs, si, x1, startX, endX, sysOf, lines, mx, diagnostics, curves}
                      appends the marks to objs and the curves to curves, and leaves
                      its skylines in S.sky for the marks attached to systems
                      (sysmarks.js, G4d-1b)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./metrics.js'), require('./metrics-text.js'), require('./skyline.js'), require('./notation.js'), require('./curves.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.marks = factory(M.metrics, M.metricsText, M.skyline, M.notation, M.curves);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MT, TX, SK, NT, CV) {
  'use strict';

  /* gaps, sp: a mark from its note, between marks, fingering from its note and between stacked fingers */
  const PAD = Object.freeze({ note: 0.3, mark: 0.25, finger: 0.3, fingerLine: 0.15 });
  /* §18.3: fingering in the sans face at 1.4 sp; a glissando's word in the serif italic at 1.2 sp */
  const FINGER = Object.freeze({ font: 'sans', size: 1.4 });
  const GLISS_TEXT = Object.freeze({ font: 'serif-italic', size: 1.2, pad: 0.2 });
  /* a single-note tremolo: strokes this far apart, on the stem (§10.2 priority 5) */
  const TREMOLO = Object.freeze({ pitch: 0.8 });
  /* a slur's half at a system break: its free end clears what the notes reach this far before it */
  const FREE_END = 4;
  /* a slur's end stands outside what stands over its head, but for this much at either edge (sp); outside another note's
     fingering within FINGER_X of it (G4-L5) */
  const END_X = 0.2, FINGER_X = 0.1;
  /* §10.2: inside to out - staccato, tenuto innermost; accent, marcato; ornaments; the fermata outermost */
  const RANK = Object.freeze({ staccato: 0, staccatissimo: 0, spiccato: 0, 'detached-legato': 0, tenuto: 1, accent: 2, stress: 2, unstress: 2,
    marcato: 3, ornament: 4, fermata: 5 });
  /* the marks that may stand inside the staff, in a space; the others stay outside it */
  const INNER = Object.freeze({ staccato: 1, staccatissimo: 1, spiccato: 1, tenuto: 1, 'detached-legato': 1 });
  /* drawn after the note, in the line of the notes (prepare, layout.js): not stacked here */
  const HORIZONTAL = Object.freeze({ 'breath-mark': 1, caesura: 1 });
  const idNum = id => { const m = /(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
  const minOf = xs => Math.min.apply(null, xs), maxOf = xs => Math.max.apply(null, xs);

  /* a mark inside the staff keeps to a space (a staccato dot never sits on a line): its centre moves outward to the
     nearest space centre; outside the staff it stays */
  const spaceSnap = (side, last) => box => {
    const c = (box[1] + box[3]) / 2;
    if (c <= -0.25 || c >= last + 0.25) return box;
    const t = side === 'above' ? Math.floor(c - 0.5 + 1e-9) + 0.5 : Math.ceil(c - 0.5 - 1e-9) + 0.5;
    const d = t - c;
    return [box[0], box[1] + d, box[2], box[3] + d];
  };

  function placeSystem(S) {
    const P = S.P, K = P.marks, objs = S.objs, si = S.si;
    const diag = (code, refs, detail) => S.diagnostics.push({ code: code, refs: refs || [], detail: detail === undefined ? null : detail });
    const lastLine = id => Math.max(0, (S.lines.get(id) === undefined ? 5 : S.lines.get(id)) - 1);
    const missing = new Set();
    const glyphOf = p => { if (p.missing && !missing.has(p.wanted)) { missing.add(p.wanted); diag('GLYPH_FALLBACK', [], p.wanted + ' -> ' + p.name); } return p.name; };

    /* the skylines: per staff, of the notes (the staff lines are not in them - a mark's `limit` keeps it outside the staff
       where it must be) */
    const sky = new Map();
    P.staves.forEach(s => sky.set(s.id, new SK.Skyline(0, S.x1 + 40, { edges: [0, lastLine(s.id)], far: SK.FAR, diag: d => S.diagnostics.push(d) })));
    objs.forEach(o => { if (o.layer === 'note' && sky.has(o.staffKey)) sky.get(o.staffKey).add(o.box); });
    const byEvent = new Map(), headObj = new Map();
    objs.forEach(o => {
      if (o.event) { if (!byEvent.has(o.event)) byEvent.set(o.event, []); byEvent.get(o.event).push(o); }
      if (o.kind === 'notehead') headObj.set(o.id, o);
    });
    const put = (staffKey, it) => sky.get(staffKey).put(it);
    const byStaff = new Map(), placed = new Map();
    objs.forEach(o => { if (o.staffKey) { if (!byStaff.has(o.staffKey)) byStaff.set(o.staffKey, []); byStaff.get(o.staffKey).push(o); } });
    const addObj = o => { objs.push(o); if (o.staffKey) { if (!byStaff.has(o.staffKey)) byStaff.set(o.staffKey, []); byStaff.get(o.staffKey).push(o); } };
    const addCurve = (c, wave) => {
      S.curves.push(c);
      const bs = CV.samples(c, c.t, wave);
      bs.forEach(b => sky.get(c.staffKey).add(b));
      if (!placed.has(c.staffKey)) placed.set(c.staffKey, []);
      bs.forEach(b => placed.get(c.staffKey).push(b));
    };
    /* the outermost reach on a side of what stands over [x0, x1] exactly (notes, marks, tuplets, curves placed so far) -
       where a slur's end must stand outside, or null */
    const reachAt = (staffKey, x0, x1, above) => {
      let v = null;
      const take = b => { if (b[0] < x1 - SK.EPS && x0 < b[2] - SK.EPS) v = v === null ? (above ? b[1] : b[3]) : above ? Math.min(v, b[1]) : Math.max(v, b[3]); };
      (byStaff.get(staffKey) || []).forEach(o => { if (o.layer === 'note' || o.layer === 'mark' || o.layer === 'tuplet') take(o.box); });
      (placed.get(staffKey) || []).forEach(take);
      return v;
    };

    /* an event as drawn in this system: its heads and rest on its own staff, its stem, its direction and voice role */
    const info = new Map();
    const infoOf = id => {
      if (info.has(id)) return info.get(id);
      const e = K.events.get(id) || null, os = byEvent.get(id) || [];
      const st = e ? e.staff : null;
      const heads = os.filter(o => o.kind === 'notehead' && o.staffKey === st);
      const x = { id: id, e: e, os: os, heads: heads, rest: os.find(o => o.kind === 'rest') || null,
        stem: os.find(o => o.kind === 'stem' && o.staffKey === st && /#stem$/.test(o.id)) || null,
        staffKey: st, dir: P.dirOf.get(id) || null, role: P.roles.get(id) || null };
      info.set(id, x);
      return x;
    };
    /* the centre of the event's head column on its stem's normal side (a second's displaced head aside) */
    const mainCx = (I, heads) => {
      heads = heads || I.heads;
      if (!heads.length) return I.rest ? (I.rest.box[0] + I.rest.box[2]) / 2 : null;
      const xs = heads.map(h => h.box[0]);
      const x0 = I.dir === 'down' ? maxOf(xs) : minOf(xs);
      const h = heads.find(q => Math.abs(q.box[0] - x0) < 1e-9);
      return (h.box[0] + h.box[2]) / 2;
    };
    const edgeOf = (I, side, heads) => {
      const bs = (heads || I.heads).map(h => h.box).concat(I.rest && !(heads || I.heads).length ? [I.rest.box] : []);
      if (!bs.length) return null;
      return side === 'above' ? minOf(bs.map(b => b[1])) : maxOf(bs.map(b => b[3]));
    };
    /* the events drawn here, left to right */
    const here = [...byEvent.keys()].filter(id => K.events.has(id)).map(id => {
      const os = byEvent.get(id).filter(o => o.kind === 'notehead' || o.kind === 'rest');
      return { id: id, x: os.length ? minOf(os.map(o => o.box[0])) : Infinity };
    }).filter(x => x.x !== Infinity).sort((a, b) => a.x - b.x || idNum(a.id) - idNum(b.id)).map(x => x.id);
    const measureOf = id => { const I = infoOf(id); return (I.heads[0] || I.rest || I.os[0] || {}).measure || null; };

    /* ------------------------------------------------------------ 1. ties */
    /* §13.1 as G4-L4 amends it: where two voices share the staff, the upper voice's ties up and the lower's down; a single
       note's away from its stem; in a chord, by the head's place in its own chord (every head of it on the staff, tied or
       not, in the order of their staff positions) - the top head's up, the bottom head's down, the upper half up and the
       lower half down, the exact middle head of an odd chord away from the stem. Read from the plan, so both halves of a
       tie across a system break bow the way the head it leaves says. */
    const tieSide = (evId, headId, staffKey) => {
      const role = P.roles.get(evId), e = K.events.get(evId);
      if (role === 'up') return 'above';
      if (role === 'down') return 'below';
      const away = P.dirOf.get(evId) === 'up' ? 'below' : 'above';
      const chord = (e ? e.heads : []).filter(h => h.staff === staffKey && h.step !== null)
        .sort((a, b) => b.step - a.step || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const n = chord.length, k = chord.findIndex(h => h.id === headId);
      if (n <= 1 || k < 0 || (n % 2 === 1 && k === (n - 1) / 2)) return away;
      return k < n / 2 ? 'above' : 'below';
    };
    /* where a tie leaves (start) or meets (end) its head: beside it - 0.2 sp from its centre, just off its edge - when the
       head is the event's outermost on the tie's side, away from the stem and (at the start) undotted; else past what the
       event draws at that height (heads, dots, stem, flag; accidentals at the end), just off the head's centre. G4-L4: the
       end is nearer its own head (at the start with its dots and flag at that height) than any other head of its chord and
       within REACH of it - where a head set past the stem at a second, or a chord's accidental, stands at that height, the
       end moves outward from the head's centre a STEP at a time, up to just off its edge, until it is */
    const gapTo = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
    const tieEnd = (I, h, side, start) => {
      const above = side === 'above', cy = (h.box[1] + h.box[3]) / 2, cx = (h.box[0] + h.box[2]) / 2;
      const hs = I.os.filter(o => o.kind === 'notehead' && o.staffKey === h.staffKey && !!o.grace === !!h.grace);
      const ext = above ? minOf(hs.map(o => o.box[1])) : maxOf(hs.map(o => o.box[3]));
      const outermost = Math.abs((above ? h.box[1] : h.box[3]) - ext) < 1e-6;
      const stemSide = !!I.dir && (I.dir === 'up') === above && !!I.stem;
      const dotted = start && I.os.some(o => o.kind === 'dot' && o.staffKey === h.staffKey);
      if (outermost && !stemSide && !dotted) return [cx + (start ? 1 : -1) * CV.TIE.outerDx, above ? h.box[1] - CV.TIE.gap : h.box[3] + CV.TIE.gap];
      const kinds = start ? ['notehead', 'dot', 'stem', 'flag'] : ['notehead', 'stem', 'accidental'];
      const mine = o => o.staffKey === h.staffKey && !!o.grace === !!h.grace;
      const at = dy => {
        const y = cy + (above ? -dy : dy);
        const near = I.os.filter(o => mine(o) && kinds.indexOf(o.kind) >= 0 && o.box[1] < y + 0.25 && o.box[3] > y - 0.25);
        const x = start ? maxOf(near.map(o => o.box[2]).concat([h.box[2]])) + CV.TIE.innerDx : minOf(near.map(o => o.box[0]).concat([h.box[0]])) - CV.TIE.innerDx;
        return [x, y];
      };
      const own = SK.union([h.box].concat(start ? I.os.filter(o => mine(o) && ((o.kind === 'dot' && Math.abs((o.box[1] + o.box[3]) / 2 - cy) <= 0.75) ||
        (o.kind === 'flag' && o.box[1] < cy + 0.75 && o.box[3] > cy - 0.75))).map(o => o.box) : []));
      const others = hs.filter(o => o !== h);
      const fits = p => { const d = gapTo(p, own); return d <= CV.TIE.reach && others.every(o => gapTo(p, o.box) > d + CV.TIE.lead); };
      for (let k = 0; CV.TIE.innerDy + k * CV.TIE.step <= 0.5 + CV.TIE.gap + 1e-9; k++) {
        const p = at(CV.TIE.innerDy + k * CV.TIE.step);
        if (fits(p)) return p;
      }
      return at(CV.TIE.innerDy);
    };
    K.ties.forEach(t => {
      const fh = t.from ? headObj.get(t.from) : null, th = t.to ? headObj.get(t.to) : null;
      if (!fh && !th) return;
      const fe = t.from ? K.headEvent.get(t.from) : null, te = t.to ? K.headEvent.get(t.to) : null;
      const anchor = fh || th, I = infoOf(fh ? fe : te);
      /* the head the tie leaves decides its side, wherever it is laid out; the head it meets when that one is not */
      const lead = fe && K.events.has(fe) && S.sysOf(K.events.get(fe).m) !== undefined;
      const side = lead ? tieSide(fe, t.from, (K.events.get(fe).heads.find(h => h.id === t.from) || {}).staff || anchor.staffKey)
        : tieSide(te, t.to, anchor.staffKey);
      const staffKey = anchor.staffKey;
      let p0, p3, part;
      if (fh && th) {
        p0 = tieEnd(I, fh, side, true);
        p3 = tieEnd(infoOf(te), th, side, false);
        part = 'whole';
        if (th.staffKey !== fh.staffKey) { p3 = [p3[0], p0[1]]; diag('TIE_CROSS_STAFF', [t.id], 'drawn on the staff it leaves'); }
      } else if (fh) {
        p0 = tieEnd(I, fh, side, true);
        const later = te && S.sysOf(K.events.get(te).m) !== undefined && S.sysOf(K.events.get(te).m) > si;
        p3 = [later ? S.x1 : Math.min(S.x1, p0[0] + CV.TIE.stub), p0[1]];
        part = 'start';
      } else {
        p3 = tieEnd(I, th, side, false);
        const earlier = fe && S.sysOf(K.events.get(fe).m) !== undefined && S.sysOf(K.events.get(fe).m) < si;
        p0 = [earlier ? S.startX : Math.max(S.startX, p3[0] - CV.TIE.stub), p3[1]];
        part = 'end';
      }
      const c = CV.arc(p0, p3, CV.tieHeight(Math.abs(p3[0] - p0[0])), side);
      const out = { id: part === 'whole' ? t.id : t.id + '#' + part, kind: 'tie', refs: [t.id], heads: [t.from || null, t.to || null], system: si, staffKey: staffKey,
        measure: fh ? fh.measure : th.measure, part: part, side: side, p0: c.p0, c1: c.c1, c2: c.c2, p3: c.p3, t: CV.TIE.thick };
      if (!t.from || !t.to) out.open = true;
      addCurve(out);
    });

    /* ------------------------------------------------------------ 2. tuplets (§12; innermost first, an outer one clears it) */
    const tups = P.tuplets.slice().sort((a, c) => c.depth - a.depth || a.order - c.order);
    tups.forEach(t => {
      const evSet = new Set(t.events);
      const staffKey = P.evStaff.get(t.events[0]);
      const list = byStaff.get(staffKey);
      if (!list) return;
      const mem = list.filter(o => evSet.has(o.event) && !o.grace && (o.kind === 'notehead' || o.kind === 'rest' || o.kind === 'dot' || o.kind === 'stem' || o.kind === 'flag'));
      const present = t.events.filter(id => mem.some(o => o.event === id && (o.kind === 'notehead' || o.kind === 'rest')));
      if (!present.length) return;
      const firstEv = present[0], lastEv = present[present.length - 1];
      const headsOf = id => mem.filter(o => o.event === id && (o.kind === 'notehead' || o.kind === 'rest'));
      const x0 = minOf(headsOf(firstEv).map(o => o.box[0]));
      const x1 = maxOf(mem.filter(o => o.event === lastEv && (o.kind === 'notehead' || o.kind === 'rest' || o.kind === 'dot')).map(o => o.box[2]));
      /* a tuplet across a system break is drawn in parts, the number on the first (§12.2) */
      const isFirst = firstEv === t.shown[0], isLast = lastEv === t.shown[t.shown.length - 1];
      const whole = isFirst && isLast;
      /* the side: stated, else the voice's role, else where most member stems point (the beam's side), else above */
      let side = t.placement;
      if (side !== 'above' && side !== 'below') {
        const role = P.roles.get(t.events[0]);
        if (role === 'up' || role === 'down') side = role === 'up' ? 'above' : 'below';
        else {
          const dirs = t.events.map(id => P.dirOf.get(id)).filter(Boolean);
          const ups = dirs.filter(d => d === 'up').length, downs = dirs.length - ups;
          side = downs > ups ? 'below' : 'above';
        }
      }
      const digits = !isFirst || t.number === 'none' ? [] : (t.number === 'both'
        ? String(t.actual).split('').map(d => 'timeSig' + d).concat([':'], String(t.normal).split('').map(d => 'timeSig' + d))
        : String(t.actual).split('').map(d => 'timeSig' + d));
      if (!digits.length && !t.bracket) return;
      /* what the members reach on that side (with what a beam over them reaches): where a number starts from */
      const own = list.filter(o => o.layer === 'note' && o.box[0] < x1 - SK.EPS && x0 < o.box[2] - SK.EPS &&
        (evSet.has(o.event) || (o.kind === 'beam' && (o.events || []).some(id => evSet.has(id)))));
      const floor = own.length ? (side === 'above' ? minOf(own.map(o => o.box[1])) : maxOf(own.map(o => o.box[3]))) : (side === 'above' ? 0 : lastLine(staffKey));
      const res = NT.placeTuplet([x0, x1], side, digits, t.bracket, [isFirst, isLast], it => put(staffKey, Object.assign({ ref: t.id }, it)),
        { floor: floor, limit: side === 'above' ? 0 : lastLine(staffKey) }, 1);
      res.number.forEach(n => sky.get(staffKey).add(n.box));
      const suffix = whole || isFirst ? '' : '@' + firstEv;
      const measure = (mem.find(o => o.event === firstEv) || {}).measure || null;
      const out = [];
      if (res.bracket) out.push({ id: t.id + '#bracket' + suffix, kind: 'tuplet-bracket', refs: t.refs.slice(), side: side, line: res.bracket.line, hooks: res.bracket.hooks,
        gap: res.bracket.gap, hookLen: res.bracket.hook, box: res.bracket.box, layer: 'tuplet', staffKey: staffKey, measure: measure });
      res.number.forEach((n, k) => out.push({ id: t.id + '#num' + k, kind: 'tuplet-number', refs: t.refs.slice(), side: side, glyph: n.glyph, scale: n.scale,
        box: n.box, layer: 'tuplet', staffKey: staffKey, measure: measure }));
      out.forEach(o => addObj(o));
    });

    /* ------------------------------------------------------------ 3. articulations, ornaments, fermatas, tremolos */
    const markSide = (it, I) => {
      if (it.kind === 'fermata') return (it.what && it.what.inverted) || I.role === 'down' ? 'below' : 'above';
      if (it.kind === 'ornament') return I.role === 'down' ? 'below' : 'above';
      if (I.role === 'up') return 'above';
      if (I.role === 'down') return 'below';
      if (!I.heads.length) return 'above';
      return I.dir === 'up' ? 'below' : 'above';
    };
    here.forEach(id => {
      const I = infoOf(id), e = I.e;
      if (!e || (!I.heads.length && !I.rest)) return;
      const items = [];
      (e.arts || []).forEach((a, i) => {
        if (HORIZONTAL[a]) return;
        if (!MT.articulation(a, true)) { diag('UNKNOWN_ARTICULATION', [e.id], String(a)); return; }
        items.push({ kind: 'articulation', what: a, i: i, ref: e.id + '#art' + i, rank: RANK[a] === undefined ? 2 : RANK[a] });
      });
      (e.orn || []).forEach((o, i) => {
        if (o.deferred) return;
        if (o.type === 'tremolo') { tremolo(I, o, i); return; }
        items.push({ kind: 'ornament', what: o, i: i, ref: e.id + '#orn' + i, rank: RANK.ornament });
      });
      if (e.fermata) items.push({ kind: 'fermata', what: e.fermata, i: 0, ref: e.id + '#fermata', rank: RANK.fermata });
      if (!items.length) return;
      const s = (I.heads[0] || I.rest).scale || 1;
      ['above', 'below'].forEach(side => {
        const mine = items.filter(it => markSide(it, I) === side).sort((a, b) => a.rank - b.rank || a.i - b.i || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
        /* on the stem's side a mark is centred on the stem, beyond its end (and its beam); else on the head */
        const stemSide = !!I.stem && (I.stem.dir === 'up') === (side === 'above');
        const cx = stemSide ? (I.stem.box[0] + I.stem.box[2]) / 2 : mainCx(I);
        const floor = stemSide ? (side === 'above' ? I.stem.box[1] : I.stem.box[3]) : edgeOf(I, side);
        let first = true;
        mine.forEach(it => {
          const above = side === 'above';
          const picks = it.kind === 'articulation' ? MT.articulation(it.what, above)
            : it.kind === 'fermata' ? [MT.fermata(it.what.shape, above)] : [MT.pick(it.what.glyph, it.what.glyph)];
          picks.forEach((p, k) => {
            const name = glyphOf(p), g = MT.glyph(name);
            if (!g) { diag('MISSING_GLYPH', [it.ref], name); return; }
            const w = g.w * s, h = (g.yMax - g.yMin) * s;
            const inner = !!INNER[it.what];
            const box = put(I.staffKey, { ref: it.ref + (picks.length > 1 ? '.' + k : ''), x0: cx - w / 2, x1: cx + w / 2, h: h, side: side, pad: first ? PAD.note : PAD.mark,
              limit: inner ? null : (above ? 0 : lastLine(I.staffKey)), floor: floor, snap: inner ? spaceSnap(side, lastLine(I.staffKey)) : null });
            first = false;
            addObj({ id: it.ref + (picks.length > 1 ? '.' + k : ''), kind: it.kind, refs: [e.id, it.ref], event: e.id, glyph: name, scale: s,
              box: MT.box(name, box[0] - g.xMin * s, box[1] + g.yMax * s, s), side: side, layer: 'mark', staffKey: I.staffKey, measure: measureOf(id) });
          });
        });
      });
    });
    /* a single-note tremolo: its strokes across the stem, between the head and the stem's end; on a stemless note above
       (or below) it */
    function tremolo(I, o, i) {
      const e = I.e, n = Math.max(1, o.marks || 3), g = MT.glyph('tremolo1');
      if (!I.heads.length) return;
      const ref = e.id + '#orn' + i;
      const span = (n - 1) * TREMOLO.pitch;
      let xc, mid;
      if (I.stem) {
        const up = I.stem.dir === 'up';
        xc = (I.stem.box[0] + I.stem.box[2]) / 2;
        mid = up ? (I.stem.box[1] + minOf(I.heads.map(h => h.box[1]))) / 2 : (I.stem.box[3] + maxOf(I.heads.map(h => h.box[3]))) / 2;
      } else {
        xc = mainCx(I);
        const side = I.dir === 'down' ? 'below' : 'above';
        const b = put(I.staffKey, { ref: ref, x0: xc - g.w / 2, x1: xc + g.w / 2, h: span + (g.yMax - g.yMin), side: side, pad: PAD.note, limit: null, floor: edgeOf(I, side) });
        mid = (b[1] + b[3]) / 2;
      }
      for (let k = 0; k < n; k++) {
        const y = mid - span / 2 + k * TREMOLO.pitch;
        const box = MT.box('tremolo1', xc, y);
        addObj({ id: ref + '.' + k, kind: 'tremolo', refs: [e.id, ref], event: e.id, glyph: 'tremolo1', box: box, layer: 'mark', staffKey: I.staffKey, measure: measureOf(I.id) });
        sky.get(I.staffKey).add(box);
      }
    }
    /* a fermata over a bar line: above the top staff, or below the bottom one when inverted */
    (K.barFermatas || []).forEach(bf => {
      if (S.sysOf(bf.m) !== si || !S.mx.has(bf.m)) return;
      const above = !(bf.fermata && bf.fermata.inverted);
      const staffKey = above ? P.staves[0].id : P.staves[P.staves.length - 1].id;
      const bars = objs.filter(o => o.kind === 'barline' && o.measure === bf.m && o.staffKey === staffKey && o.id.indexOf(bf.m + '#bar.' + bf.side + ':') === 0);
      const M = S.mx.get(bf.m);
      const xc = bars.length ? (minOf(bars.map(o => o.box[0])) + maxOf(bars.map(o => o.box[2]))) / 2 : bf.side === 'left' ? M.x : M.x + M.w;
      const name = glyphOf(MT.fermata(bf.fermata ? bf.fermata.shape : 'normal', above)), g = MT.glyph(name);
      const box = put(staffKey, { ref: bf.ref, x0: xc - g.w / 2, x1: xc + g.w / 2, h: g.yMax - g.yMin, side: above ? 'above' : 'below', pad: PAD.mark, limit: above ? 0 : lastLine(staffKey) });
      addObj({ id: bf.ref, kind: 'fermata', refs: [bf.m, bf.ref], glyph: name, box: MT.box(name, box[0] - g.xMin, box[1] + g.yMax), side: above ? 'above' : 'below',
        layer: 'mark', staffKey: staffKey, measure: bf.m });
    });

    /* ------------------------------------------------------------ 4. fingering (G4-L5: after the articulations, before the
       slurs - printed fingering stays by its notes, inside a phrase slur, and the slurs clear it) */
    here.forEach(id => {
      const I = infoOf(id), e = I.e;
      if (!e || !e.heads.some(h => (h.fingering || []).length)) return;
      const entries = [];
      e.heads.forEach(h => (h.fingering || []).forEach((f, i) => {
        const ho = headObj.get(h.id);
        const text = f && f.f !== undefined && f.f !== null ? String(f.f) : '';
        if (!ho || !text.trim()) return;
        const side = f.placement === 'above' || f.placement === 'below' ? f.placement : K.staffRank.get(ho.staffKey) === 1 ? 'below' : 'above';
        entries.push({ h: h, ho: ho, i: i, side: side, ref: h.id + '#fing' + i, lines: text.split(/\r?\n/).filter(x => x.trim() !== '') });
      }));
      const groups = new Map();
      entries.forEach(en => { const k = en.ho.staffKey + '|' + en.side; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(en); });
      [...groups.keys()].sort().forEach(k => {
        const list = groups.get(k).sort((a, b) => a.ho.box[1] - b.ho.box[1] || a.i - b.i);
        const side = list[0].side, above = side === 'above', staffKey = list[0].ho.staffKey;
        const heads = I.os.filter(o => o.kind === 'notehead' && o.staffKey === staffKey);
        const cx = mainCx(I, heads), floor = edgeOf(I, side, heads);
        /* innermost first: above, the lowest head's finger (its last line first); below, the highest head's (first line) */
        const seq = above ? list.slice().reverse() : list;
        let first = true;
        seq.forEach(en => {
          const lines = en.lines.map((t, k) => ({ t: t, k: k }));
          (above ? lines.slice().reverse() : lines).forEach(ln => {
            const m = TX.measure(ln.t, FINGER.font, FINGER.size);
            if (m.missing.length) diag('TEXT_GLYPH_MISSING', [en.ref], m.missing.join(','));
            const box = put(staffKey, { ref: en.ref + (en.lines.length > 1 ? '.' + ln.k : ''), x0: cx - m.w / 2, x1: cx + m.w / 2, h: m.bottom - m.top,
              side: side, pad: first ? PAD.finger : PAD.fingerLine, limit: above ? 0 : lastLine(staffKey), floor: floor });
            first = false;
            addObj({ id: en.ref + (en.lines.length > 1 ? '.' + ln.k : ''), kind: 'fingering', refs: [e.id, en.ref], event: e.id, text: ln.t,
              font: FINGER.font, size: FINGER.size, box: box, side: side, layer: 'text', staffKey: staffKey, measure: en.ho.measure });
          });
        });
      });
    });

    /* ------------------------------------------------------------ 5. slurs, glissandi */
    /* §13.2: the graph's placement; else a voice's side where two share the staff; else below when every note under
       it stems up, above when all stem down or they are mixed */
    const slurSide = s => {
      if (s.placement === 'above' || s.placement === 'below') return s.placement;
      const role = P.roles.get(s.from) || P.roles.get(s.to);
      if (role === 'up') return 'above';
      if (role === 'down') return 'below';
      const fe = K.events.get(s.from) || K.events.get(s.to);
      const seq = fe ? (K.voiceSeq.get(fe.voice) || []) : [];
      const a = seq.indexOf(s.from), b = seq.indexOf(s.to);
      const ids = a >= 0 && b >= a ? seq.slice(a, b + 1) : [s.from, s.to].filter(Boolean);
      const dirs = ids.map(id => P.dirOf.get(id)).filter(Boolean);
      if (dirs.length && dirs.every(d => d === 'up')) return 'below';
      return 'above';
    };
    /* where a slur meets its note: at the head's centre on the head's side, beyond the stem's end on the stem's side -
       past everything placed there before (ties, articulations) by the pad */
    const slurEnd = (id, side, staffKey) => {
      const I = infoOf(id);
      if (!I.heads.length && !I.rest) return null;
      const above = side === 'above';
      const headSide = !I.heads.length || !I.stem || (I.stem.dir === 'up') !== above;
      let x;
      /* what stands over the head (its edges aside: not a neighbour's stem or beam that only touches it), or around the
         stem - the head or the stem's end, another voice there, and what was placed there before */
      let xr;
      if (headSide) {
        const bs = (I.heads.length ? I.heads : [I.rest]).map(o => o.box);
        x = mainCx(I);
        xr = [Math.min(x - END_X, minOf(bs.map(b => b[0])) + END_X), Math.max(x + END_X, maxOf(bs.map(b => b[2])) - END_X)];
      } else {
        x = (I.stem.box[0] + I.stem.box[2]) / 2;
        xr = [x - END_X, x + END_X];
      }
      if (I.staffKey !== staffKey) diag('SLUR_CROSS_STAFF', [id], 'drawn on the staff it leaves');
      let v = reachAt(staffKey, xr[0], xr[1], above);
      /* and outside the note's own marks and fingering on that side, wherever they stand (§10.2: a slur outside the
         articulations and, G4-L5, the fingering), and another note's fingering right under the end (within FINGER_X of
         it; one beside the end the arc clears, curves.js) */
      (byStaff.get(staffKey) || []).forEach(o => {
        const under = o.kind === 'fingering' && o.side === side && o.box[0] < x + FINGER_X - SK.EPS && x - FINGER_X < o.box[2] - SK.EPS;
        if (!under && (o.event !== id || (o.layer !== 'mark' && o.kind !== 'fingering') || o.side !== side)) return;
        v = v === null ? (above ? o.box[1] : o.box[3]) : above ? Math.min(v, o.box[1]) : Math.max(v, o.box[3]);
      });
      const y = v === null ? (above ? 0 : lastLine(staffKey)) : v;
      return [x, above ? y - CV.SLUR.pad : y + CV.SLUR.pad];
    };
    const slurParts = [];
    K.slurs.forEach((s, order) => {
      const fe = s.from ? K.events.get(s.from) : null, te = s.to ? K.events.get(s.to) : null;
      const fs = fe ? S.sysOf(fe.m) : undefined, ts = te ? S.sysOf(te.m) : undefined;
      const fHere = fs === si && infoOf(s.from).os.length, tHere = ts === si && infoOf(s.to).os.length;
      let part = null;
      if (fHere && tHere) part = 'whole';
      else if (fHere) part = 'start';
      else if (tHere) part = 'end';
      else if (fs !== undefined && ts !== undefined && fs < si && si < ts) part = 'mid';
      if (!part) return;
      const staffKey = fe ? fe.staff : te.staff;
      const xs = [part === 'whole' || part === 'start' ? minOf(infoOf(s.from).os.map(o => o.box[0])) : S.startX,
        part === 'whole' || part === 'end' ? maxOf(infoOf(s.to).os.map(o => o.box[2])) : S.endX];
      slurParts.push({ s: s, part: part, staffKey: staffKey, span: xs[1] - xs[0], order: order });
    });
    slurParts.sort((a, b) => a.span - b.span || a.order - b.order);
    slurParts.forEach(sp => {
      const s = sp.s, side = slurSide(s), above = side === 'above', staffKey = sp.staffKey;
      const sk = sky.get(staffKey);
      let p0 = sp.part === 'whole' || sp.part === 'start' ? slurEnd(s.from, side, staffKey) : null;
      let p3 = sp.part === 'whole' || sp.part === 'end' ? slurEnd(s.to, side, staffKey) : null;
      /* a half at a system break runs to 1 sp before the bar line, or from 1 sp before the first column; a middle part
         spans the system clear of everything in it */
      const flat = () => {
        const v = above ? sk.top(S.startX, S.endX) : sk.bottom(S.startX, S.endX);
        const y = above ? Math.min(v === null ? 0 : v, 0) : Math.max(v === null ? lastLine(staffKey) : v, lastLine(staffKey));
        return above ? y - CV.SLUR.pad : y + CV.SLUR.pad;
      };
      /* a half's free end stands at its note's end's height, or outside what the notes reach near the break */
      const freeY = (x0, x1, y) => {
        const v = above ? sk.top(x0, x1) : sk.bottom(x0, x1);
        return v === null ? y : above ? Math.min(y, v - CV.SLUR.pad) : Math.max(y, v + CV.SLUR.pad);
      };
      if (!p0 && !p3) { const y = flat(); p0 = [S.startX, y]; p3 = [S.endX, y]; }
      else if (!p3) { const x = Math.max(S.endX, p0[0] + 1); p3 = [x, freeY(x - FREE_END, x, p0[1])]; }
      else if (!p0) { const x = Math.min(S.startX, p3[0] - 1); p0 = [x, freeY(x, x + FREE_END, p3[1])]; }
      if (p3[0] < p0[0]) { const q = p0; p0 = p3; p3 = q; }
      /* what lies between the ends, and (G4-L5) the fingering by either end - its own note's too, which the end stands over:
         the arc never crosses a finger where it rises to or falls from its end */
      const cells = sk.profile(p0[0] + CV.SLUR.endZone, p3[0] - CV.SLUR.endZone, side);
      (byStaff.get(staffKey) || []).forEach(o => {
        if (o.kind !== 'fingering' || o.side !== side || o.box[2] <= p0[0] || o.box[0] >= p3[0]) return;
        if (o.box[0] < p0[0] + CV.SLUR.endZone || o.box[2] > p3[0] - CV.SLUR.endZone) cells.push([o.box[0], o.box[2], above ? o.box[1] : o.box[3], true]);
      });
      const r = CV.slur(p0, p3, side, cells);
      if (r.collides) diag('SLUR_COLLIDES', [s.id], 'no arc up to ' + CV.SLUR.hMax + ' sp clears what lies under it');
      const c = r.curve;
      const out = { id: sp.part === 'whole' ? s.id : s.id + '#' + sp.part, kind: 'slur', refs: [s.id], events: [s.from || null, s.to || null], system: si, staffKey: staffKey,
        measure: sp.part === 'whole' || sp.part === 'start' ? measureOf(s.from) : sp.part === 'end' ? measureOf(s.to) : null,
        part: sp.part, side: side, p0: c.p0, c1: c.c1, c2: c.c2, p3: c.p3, t: CV.SLUR.thick, lift: r.lift };
      if (s.line === 'dashed' || s.line === 'dotted') out.line = s.line;
      if (!s.from || !s.to) out.open = true;
      addCurve(out);
    });
    /* glissandi: from after the first head to before the second (its accidental), straight or wavy (§13.4) */
    (K.gliss || []).forEach(l => {
      const fh = l.from ? headObj.get(l.from) : null, th = l.to ? headObj.get(l.to) : null;
      if (!fh && !th) return;
      const staffKey = (fh || th).staffKey;
      const cy = h => (h.box[1] + h.box[3]) / 2;
      const leftOf = h => {
        const I = infoOf(K.headEvent.get(h.id));
        const near = I.os.filter(o => o.staffKey === h.staffKey && (o.kind === 'notehead' || o.kind === 'accidental') && o.box[1] < cy(h) + 0.75 && o.box[3] > cy(h) - 0.75);
        return minOf(near.map(o => o.box[0]).concat([h.box[0]]));
      };
      let p0 = fh ? [fh.box[2] + CV.GLISS.gap, cy(fh)] : null, p3 = th ? [leftOf(th) - CV.GLISS.gap, cy(th)] : null;
      let part = 'whole';
      if (!p3) { p3 = [S.endX, p0[1]]; part = 'start'; }
      if (!p0) { p0 = [S.startX, p3[1]]; part = 'end'; }
      if (fh && th && fh.staffKey !== th.staffKey) { p3 = [p3[0], p0[1]]; diag('GLISS_CROSS_STAFF', [l.id], 'drawn on the staff it leaves'); }
      const c = CV.line(p0, p3);
      const wavy = l.line === 'wavy';
      const out = { id: part === 'whole' ? l.id : l.id + '#' + part, kind: 'gliss', refs: [l.id], heads: [l.from || null, l.to || null], system: si, staffKey: staffKey,
        measure: (fh || th).measure, part: part, p0: c.p0, c1: c.c1, c2: c.c2, p3: c.p3, t: CV.GLISS.thick, line: wavy ? 'wavy' : 'solid' };
      addCurve(out, wavy ? CV.GLISS.amp : 0);
      if (l.text && part !== 'end') {
        const m = TX.measure(l.text, GLISS_TEXT.font, GLISS_TEXT.size);
        if (m.missing.length) diag('TEXT_GLYPH_MISSING', [l.id], m.missing.join(','));
        const mx = (p0[0] + p3[0]) / 2, my = Math.min(p0[1], p3[1]) - (wavy ? CV.GLISS.amp : 0);
        const box = put(staffKey, { ref: l.id + '#text', x0: mx - m.w / 2, x1: mx + m.w / 2, h: m.bottom - m.top, side: 'above', pad: GLISS_TEXT.pad, limit: null, floor: my });
        addObj({ id: l.id + '#text', kind: 'text', refs: [l.id], event: K.headEvent.get((fh || th).id), text: l.text, font: GLISS_TEXT.font, size: GLISS_TEXT.size,
          box: box, layer: 'text', staffKey: staffKey, measure: (fh || th).measure });
      }
    });

    /* the skylines, with everything placed here, for the rows that stand outside it all (sysmarks.js) */
    S.sky = sky;
  }

  return Object.freeze({ PAD, FINGER, GLISS_TEXT, TREMOLO, RANK, INNER, HORIZONTAL, spaceSnap, placeSystem });
});
