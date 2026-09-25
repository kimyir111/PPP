/* ============================================================================
   PPP engrave — the notation under and around the notes (docs/GOALS/G04 §11, §12, §14; G4c)

   Pure geometry helpers the layout core (layout.js) calls once it knows where
   the columns are. Coordinates are staff spaces, y down, relative to the staff's
   top line; x is absolute in the system. Nothing here reads a DOM, a clock or
   random numbers, and every loop runs in a fixed order.

     autoDir(ys, mid)           the stem direction a note or a beamed group takes
                                when neither the graph nor a voice role gives one:
                                away from the head farthest from the middle line;
                                a tie goes to the majority, then down (§11.2, §14.1)
     beamLine(members, dir, o)  the outer edge of a beam over stems (§11.2): the
                                slope follows the first and last tips, at most
                                half their distance and 1 sp over the group, never
                                steeper than 0.25; flat when they are level or an
                                inner note reaches past both ends (concave); every
                                stem at least its length (3.5 sp, longer for more
                                beams), and for full-size notes the beam reaches
                                the middle line
     beamRuns(members, breaks)  the primary beam over all, the secondary ones over
                                consecutive stems that carry them, cut where the
                                graph breaks that level; a lone stem gets a hook,
                                right at the start, left at the end, left after a
                                dotted note or inside the beat of the note before
     beamShapes(...)            beam objects and the stems' new ends
     beamClash(beams, objs)     how far a beam must move out to clear what its
                                notes carry (accidentals, dots, heads) by 0.25 sp
     placeRests(...)            rests of a voice move away in whole staff spaces
                                until they clear what other voices draw there
                                (and their own voice's beam) by 0.5 sp (§14.3)
     placeTuplet(...)           a tuplet's number and bracket over its members through
                                the staff's placement function (§12.2, §10.1): a
                                bracket outside the staff, a number alone by its beam
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./metrics.js'));
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).notation = factory((root.PPPEngraveModules || {}).metrics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MT) {
  'use strict';

  /* G04 §11.2: beam thickness and level pitch (thickness 0.5 + gap 0.25, Bravura's engraving defaults), the stem a
     beamed note is given (3.5 sp) and the least it may have (2.5 sp under one beam, +0.75 sp a beam more), the
     steepest slope, and how far a group may rise (half the tips' distance, at most 1 sp) */
  const BEAM = Object.freeze({ thick: 0.5, pitch: 0.75, stem: 3.5, least: 2.5, perBeam: 0.75, maxSlope: 0.25, riseShare: 0.5, maxRise: 1.0,
    hook: 1.18, clear: 0.25 });
  /* G04 §12.2: a tuplet bracket's hooks (0.75 sp toward the notes), its clearance from what it covers (0.5 sp), the
     number's size (VexFlow's tuplet point: 3/5 of the notation font), the gap the number cuts into the bracket */
  const TUPLET = Object.freeze({ hook: 0.75, pad: 0.5, scale: 0.6, gap: 0.25, line: 0.1 });
  /* G04 §14.3: a rest steps away in whole staff spaces (a line stays a line), clearing others by 0.5 sp */
  const REST = Object.freeze({ step: 1, pad: 0.5, maxSteps: 12 });
  const EPS = 0.01;

  function autoDir(ys, mid) {
    let far = 0;
    ys.forEach(y => { far = Math.max(far, Math.abs(y - mid)); });
    if (far < 1e-9) return 'down';
    const above = ys.some(y => y < mid - 1e-9 && Math.abs(mid - y - far) < 1e-9);
    const below = ys.some(y => y > mid + 1e-9 && Math.abs(y - mid - far) < 1e-9);
    if (below && !above) return 'up';
    if (above && !below) return 'down';
    const nb = ys.filter(y => y > mid + 1e-9).length, na = ys.filter(y => y < mid - 1e-9).length;
    return nb > na ? 'up' : 'down';
  }

  /* members: [{x: the stem's centre, tip: the head at the stem's end (up: the highest), n: beams at this stem}] in x
     order; o: {scale, mid, reachMiddle}. -> {slope, y0, x0}: the beam's outer edge y = y0 + slope (x - x0) */
  function beamLine(members, dir, o) {
    const up = dir === 'up', s = o.scale || 1;
    const first = members[0], last = members[members.length - 1];
    const dx = last.x - first.x;
    let slope = 0;
    const inner = members.slice(1, -1);
    const flat = Math.abs(first.tip - last.tip) < 1e-9 ||
      inner.some(m => (up ? m.tip < Math.min(first.tip, last.tip) - 1e-9 : m.tip > Math.max(first.tip, last.tip) + 1e-9));
    if (!flat && dx > 1e-9) {
      const diff = last.tip - first.tip;
      const rise = Math.min(Math.abs(diff) * BEAM.riseShare, BEAM.maxRise * s);
      slope = Math.sign(diff) * Math.min(rise / dx, BEAM.maxSlope);
    }
    const want = m => s * Math.max(BEAM.stem, BEAM.least + BEAM.perBeam * (m.n - 1));
    let y0 = up ? Infinity : -Infinity;
    members.forEach(m => {
      const lim = up ? m.tip - want(m) - slope * (m.x - first.x) : m.tip + want(m) - slope * (m.x - first.x);
      y0 = up ? Math.min(y0, lim) : Math.max(y0, lim);
    });
    if (o.reachMiddle) {
      /* a group of ledger-line notes: the stems reach the middle line (§11.2) */
      members.forEach(m => {
        const b = y0 + slope * (m.x - first.x);
        if (up && b > o.mid) y0 -= b - o.mid;
        if (!up && b < o.mid) y0 += o.mid - b;
      });
    }
    return { slope: slope, y0: y0, x0: first.x };
  }

  /* members: [{n, dots, beat}] in order; breaks: Map(member index -> the lowest level the graph breaks after it).
     -> [{level, from, to, hook}] */
  function beamRuns(members, breaks) {
    const out = [{ level: 1, from: 0, to: members.length - 1, hook: null }];
    const maxN = Math.max.apply(null, members.map(m => m.n));
    const side = i => {
      if (i === 0) return 'right';
      if (i === members.length - 1) return 'left';
      const prev = members[i - 1];
      if (prev.dots) return 'left';
      return prev.beat === members[i].beat ? 'left' : 'right';
    };
    for (let k = 2; k <= maxN; k++) {
      let i = 0;
      while (i < members.length) {
        if (members[i].n < k) { i++; continue; }
        let j = i;
        while (j + 1 < members.length && members[j + 1].n >= k && !(breaks.has(j) && breaks.get(j) <= k)) j++;
        out.push({ level: k, from: i, to: j, hook: i === j ? side(i) : null });
        i = j + 1;
      }
    }
    return out;
  }

  /* The beam objects of one beam part and where its stems end.
     members: [{x0: stem box left, sw: stem width, n, dots, beat, far, tip, stem: the stem object}] in x order.
     -> {beams: [{level, hook, line: [xa, ya, xb, yb] (top edge), t, box}], line} and each member's stem box set */
  function beamShapes(members, dir, breaks, o) {
    const s = o.scale || 1, t = BEAM.thick * s, pitch = BEAM.pitch * s;
    const up = dir === 'up';
    const line = beamLine(members.map(m => ({ x: m.x0 + m.sw / 2, tip: m.tip, n: m.n })), dir, o);
    /* moved further out when what the notes carry (an accidental, a dot) would reach into it */
    if (o.extra) line.y0 += up ? -o.extra : o.extra;
    const B = x => line.y0 + line.slope * (x - line.x0);
    /* the top edge of level k at x */
    const top = (k, x) => (up ? B(x) + (k - 1) * pitch : B(x) - (k - 1) * pitch - t);
    members.forEach(m => {
      const e = B(m.x0 + m.sw / 2);
      m.stem.box = up ? [m.x0, e, m.x0 + m.sw, m.far] : [m.x0, m.far, m.x0 + m.sw, e];
    });
    const out = [];
    beamRuns(members, breaks).forEach(r => {
      let xa, xb;
      if (!r.hook) { xa = members[r.from].x0; xb = members[r.to].x0 + members[r.to].sw; }
      else {
        const m = members[r.from];
        const nb = r.hook === 'right' ? members[r.from + 1] : members[r.from - 1];
        const room = nb ? Math.abs((nb.x0 + nb.sw / 2) - (m.x0 + m.sw / 2)) * 0.6 : BEAM.hook * s;
        const len = Math.min(BEAM.hook * s, room);
        if (r.hook === 'right') { xa = m.x0; xb = m.x0 + m.sw + len; } else { xa = m.x0 - len; xb = m.x0 + m.sw; }
      }
      const ya = top(r.level, xa), yb = top(r.level, xb);
      out.push({ level: r.level, from: r.from, to: r.to, hook: r.hook, line: [xa, ya, xb, yb], t: t,
        box: [xa, Math.min(ya, yb), xb, Math.max(ya, yb) + t] });
    });
    return { beams: out, line: line };
  }

  /* how far (sp) the beams of one part must move away from the notes to clear `objs` (the objects of its own notes) by
     BEAM.clear: 0 when they already do */
  function beamClash(beams, objs, dir) {
    const up = dir === 'up';
    let need = 0;
    beams.forEach(b => {
      const l = b.line, dx = l[2] - l[0];
      const topAt = x => l[1] + (l[3] - l[1]) * (dx > 1e-9 ? (x - l[0]) / dx : 0);
      objs.forEach(o => {
        const a = Math.max(o.box[0], l[0]), z = Math.min(o.box[2], l[2]);
        if (a >= z - EPS) return;
        const t0 = Math.min(topAt(a), topAt(z)), b1 = Math.max(topAt(a), topAt(z)) + b.t;
        const d = up ? b1 - (o.box[1] - BEAM.clear) : (o.box[3] + BEAM.clear) - t0;
        if (d > need) need = d;
      });
    });
    return need;
  }

  /* Rests of the voices sharing a staff (§14.3). rests: [{obj, dots: [objects], dir: -1 up | 1 down | 0 either,
     partner: the rest drawn at the same place (merged) or null}]; obstacles(rest) -> the objects it must clear (other
     voices' notes, rests, beams, and its own voice's beams). Each rest keeps its place if nothing is within 0.5 sp;
     otherwise it steps a staff space at a time, up for an upper voice, down for a lower, and for a lone voice away from
     what it meets. -> [{obj, moved (sp), clear}] */
  function placeRests(rests, obstacles) {
    const hits = (b, list) => list.filter(o => o.box[0] < b[2] - EPS && b[0] < o.box[2] - EPS &&
      o.box[1] < b[3] + REST.pad - EPS && b[1] - REST.pad < o.box[3] - EPS);
    const out = [];
    rests.forEach(r => {
      const list = obstacles(r);
      let found = hits(r.obj.box, list);
      let moved = 0;
      if (found.length) {
        let dir = r.dir;
        if (!dir) {
          const c = (r.obj.box[1] + r.obj.box[3]) / 2;
          const oc = (found[0].box[1] + found[0].box[3]) / 2;
          dir = oc >= c ? -1 : 1;
        }
        for (let k = 1; k <= REST.maxSteps && found.length; k++) {
          moved = dir * REST.step * k;
          found = hits([r.obj.box[0], r.obj.box[1] + moved, r.obj.box[2], r.obj.box[3] + moved], list);
        }
        if (found.length) moved = 0;
      }
      if (moved) {
        const mv = b => [b[0], b[1] + moved, b[2], b[3] + moved];
        [r.obj].concat(r.dots, r.partner ? [r.partner.obj].concat(r.partner.dots) : []).forEach(o => { o.box = mv(o.box); });
      }
      out.push({ obj: r.obj, moved: moved, clear: !found.length });
    });
    return out;
  }

  /* A tuplet's marks over its members on one staff (§12.1-§12.2), placed through the skyline (§10.1, G4d-1a). span: [x0,
     x1] (the first member's head or rest to the last's right edge, dots included); side 'above'|'below'; digits: glyph
     names left to right ([] for no number); put(item) -> box: the staff's placement function (skyline.js put); where:
     {limit: the staff edge, floor: how far the members reach on that side}; s: the staff's scale.
     A bracket stands outside the staff and everything under it, its hooks' tips the pad clear of that; a number without
     a bracket stands by its notes - by the beam, inside the staff where that is free (the G4c review M2).
     -> {bracket: {line, box, hooks, gap} | null, number: [{glyph, origin, box, scale}]} */
  function placeTuplet(span, side, digits, bracket, hooks, put, where, s) {
    const up = side === 'above';
    const ns = TUPLET.scale * s;
    /* ':' (show both numbers) is two dots, one above the other, as VexFlow draws a ratioed tuplet */
    const gl = digits.map(n => MT.glyph(n === ':' ? 'augmentationDot' : n));
    const nw = gl.reduce((a, g) => a + g.w * ns, 0) + Math.max(0, gl.length - 1) * 0.05 * s;
    const nh = digits.length ? 2 * ns : 0;                /* the time-signature digits span 2 sp */
    const cx = (span[0] + span[1]) / 2;
    let lineY;
    if (bracket) {
      /* the line, with the number on it and the hooks under it */
      const b = put({ x0: span[0], x1: span[1], h: Math.max(TUPLET.hook * s, nh / 2), side: side, pad: TUPLET.pad * s, limit: where.limit, floor: where.floor });
      lineY = up ? b[1] : b[3];
    } else {
      const b = put({ x0: cx - nw / 2 - 0.2 * s, x1: cx + nw / 2 + 0.2 * s, h: nh, side: side, pad: TUPLET.pad * s, limit: null, floor: where.floor });
      lineY = (b[1] + b[3]) / 2;
    }
    const number = [];
    let x = cx - nw / 2;
    gl.forEach((g, k) => {
      if (digits[k] === ':') {
        [-0.35, 0.35].forEach(dy => number.push({ glyph: 'augmentationDot', scale: ns, box: MT.box('augmentationDot', x - g.xMin * ns, lineY + dy * 2 * ns, ns) }));
      } else number.push({ glyph: digits[k], scale: ns, box: MT.box(digits[k], x - g.xMin * ns, lineY, ns) });
      x += g.w * ns + 0.05 * s;
    });
    let out = null;
    if (bracket) {
      const hy = up ? lineY + TUPLET.hook * s : lineY - TUPLET.hook * s;
      const gap = digits.length ? [cx - nw / 2 - TUPLET.gap * s, cx + nw / 2 + TUPLET.gap * s] : null;
      out = { line: [span[0], lineY, span[1], lineY], hooks: hooks, gap: gap, hook: TUPLET.hook * s, box: [span[0], Math.min(lineY, hy), span[1], Math.max(lineY, hy)] };
    }
    const all = number.map(n => n.box).concat(out ? [out.box] : []);
    return { bracket: out, number: number, box: all.reduce((u, b) => (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice()), null) };
  }

  return Object.freeze({ BEAM, TUPLET, REST, autoDir, beamLine, beamRuns, beamShapes, beamClash, placeRests, placeTuplet });
});
