/* ============================================================================
   PPP engrave — the collision foundation (docs/GOALS/G04 §10)

   Boxes are [x0, y0, x1, y1] in staff spaces, y down. Two things live here, and
   G4c-G4d build their placement rules on them rather than replacing them:

   Skyline   one staff (or system) side: for every 0.25 sp cell of x, how far up
             (`above`, the least y) and down (`below`, the greatest y) anything
             reaches, in integer hundredths of a staff space - no floating point
             decides a comparison. add(box) raises it; place() puts a new item
             outside it with a padding and adds it (§10.1's single placement
             function); clearance() is the least distance two stacked skylines
             need (the vertical spacing of §15.3).

   collisions(objects, page)   the hard constraints of §10.3 that G4b's objects
             can break: H1 noteheads of different events on one staff, H2 an
             accidental against a head, stem, accidental or ledger line, H3 a dot
             against a head, stem or flag, H4 anything outside the page, H5 text
             (fingering, a glissando's word) against a head, stem, beam or accidental
             (G4d-1a), H6 an object of one staff against one of another staff, or
             systems overlapping, H8 a note outside its measure. Two objects that name each other `merged`
             (a unison two voices share, G04 §14.2) coincide by design. A sweep over x,
             in a fixed order; touching (less than 0.01 sp of overlap) is not a
             collision.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).skyline = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CELL = 0.25;          /* sp */
  const EPS = 0.01;           /* sp: less overlap than this is touching */
  const FAR = 8;              /* sp: §10.5's reference distance from the staff - farther, an item is placed anyway and says so */
  const cent = v => Math.round(v * 100);

  const overlaps = (a, b, eps) => {
    const e = eps === undefined ? EPS : eps;
    return a[0] < b[2] - e && b[0] < a[2] - e && a[1] < b[3] - e && b[1] < a[3] - e;
  };
  const union = boxes => boxes.reduce((u, b) => (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice()), null);

  /* ---------------------------------------------------------------- skyline */
  /* opts (optional): {edges: [top, bottom] - the staff's outer lines, far: the reference distance (FAR), diag(d) - where
     put() reports an item set farther than that} */
  function Skyline(x0, x1, opts) {
    this.x0 = x0;
    this.n = Math.max(1, Math.ceil((x1 - x0) / CELL) + 1);
    this.above = new Array(this.n).fill(Infinity);
    this.below = new Array(this.n).fill(-Infinity);
    this.opts = opts || null;
  }
  Skyline.prototype.cells = function (x0, x1) {
    const a = Math.max(0, Math.floor((x0 - this.x0) / CELL)), b = Math.min(this.n - 1, Math.floor((x1 - this.x0 - 1e-9) / CELL));
    return [a, Math.max(a, b)];
  };
  Skyline.prototype.add = function (box) {
    const [a, b] = this.cells(box[0], box[2]);
    const top = cent(box[1]), bot = cent(box[3]);
    for (let c = a; c <= b; c++) {
      if (top < this.above[c]) this.above[c] = top;
      if (bot > this.below[c]) this.below[c] = bot;
    }
    return this;
  };
  /* the highest reach (least y) and the lowest (greatest y) over [x0, x1], in sp; null where nothing is */
  Skyline.prototype.top = function (x0, x1) {
    const [a, b] = this.cells(x0, x1);
    let m = Infinity;
    for (let c = a; c <= b; c++) if (this.above[c] < m) m = this.above[c];
    return m === Infinity ? null : m / 100;
  };
  Skyline.prototype.bottom = function (x0, x1) {
    const [a, b] = this.cells(x0, x1);
    let m = -Infinity;
    for (let c = a; c <= b; c++) if (this.below[c] > m) m = this.below[c];
    return m === -Infinity ? null : m / 100;
  };
  /* §10.1's placement - the one function every mark outside the notes goes through (G4d-1a): an item of height h over
     [x0, x1] set outside everything already there on `side` ('above' | 'below'), `pad` away, then added, so the next
     item stands outside it. Where it may stand when nothing is in the way:
       limit   the staff edge it may not come inside of (0 above, the bottom line below), or null: inside the staff too;
       floor   where the item starts from - the note it belongs to (its head's edge), or null.
     At least one of the two is given. snap(box) -> box moves the item outward only (a staccato dot inside the staff
     keeps to a space). -> its box. `place(x0, x1, h, side, pad, limit)` is the old positional form (a volta).
     §10.5: on a staff's skyline (opts.edges), an item whose near edge lands more than opts.far from the staff's outer line
     on its side is placed all the same, and put() reports FAR_PLACEMENT naming it.ref (the caller's id for the item). */
  Skyline.prototype.put = function (it) {
    const above = it.side === 'above';
    const t = above ? this.top(it.x0, it.x1) : this.bottom(it.x0, it.x1);
    const edge = [t, it.limit === undefined ? null : it.limit, it.floor === undefined ? null : it.floor].filter(v => v !== null);
    if (!edge.length) throw new Error('place(): an item with no limit and no floor over empty space');
    const pad = it.pad || 0;
    let box;
    if (above) { const y1 = Math.min.apply(null, edge) - pad; box = [it.x0, y1 - it.h, it.x1, y1]; }
    else { const y0 = Math.max.apply(null, edge) + pad; box = [it.x0, y0, it.x1, y0 + it.h]; }
    if (it.snap) box = it.snap(box);
    this.add(box);
    const o = this.opts;
    if (o && o.edges && o.diag) {
      const d = above ? o.edges[0] - box[3] : box[1] - o.edges[1], far = o.far === undefined ? FAR : o.far;
      if (d > far + EPS) o.diag({ code: 'FAR_PLACEMENT', refs: [it.ref || null], detail: Math.round(d * 100) / 100 + ' sp ' + (above ? 'above' : 'below') + ' the staff' });
    }
    return box;
  };
  Skyline.prototype.place = function (x0, x1, h, side, pad, limit) {
    return this.put({ x0: x0, x1: x1, h: h, side: side, pad: pad, limit: limit });
  };
  /* the outermost reach on a side over each cell of [x0, x1], in sp: [[cell x0, cell x1, y]] for the cells that hold
     something - what a slur between two notes must clear (§13.2) */
  Skyline.prototype.profile = function (x0, x1, side) {
    const [a, b] = this.cells(x0, x1);
    const out = [];
    for (let c = a; c <= b; c++) {
      const v = side === 'above' ? this.above[c] : this.below[c];
      if (v === Infinity || v === -Infinity) continue;
      out.push([this.x0 + c * CELL, this.x0 + (c + 1) * CELL, v / 100]);
    }
    return out;
  };
  /* the least distance (sp) from `upper`'s reference line to `lower`'s so that nothing below the upper one comes
     within `pad` of anything above the lower one: max over x of (upper.below - upperEdge) + (lowerEdge - lower.above).
     Both skylines must share x0 and cell count (one system). */
  function clearance(upper, upperEdge, lower, lowerEdge, pad) {
    let need = -Infinity;
    const n = Math.min(upper.n, lower.n);
    const ue = cent(upperEdge), le = cent(lowerEdge);
    for (let c = 0; c < n; c++) {
      const d = Math.max(0, upper.below[c] - ue) + Math.max(0, le - lower.above[c]);
      if (d > need) need = d;
    }
    return (need === -Infinity ? 0 : need / 100) + pad;
  }

  /* ---------------------------------------------------------------- collisions */
  const RULES = [
    /* [code, kind a, kinds b, same-event allowed?] */
    ['H1', 'notehead', ['notehead'], false],
    ['H2', 'accidental', ['notehead', 'stem', 'accidental', 'ledger'], true],
    ['H3', 'dot', ['notehead', 'stem', 'flag'], true],
    ['H5', 'fingering', ['notehead', 'stem', 'beam', 'accidental'], true],
    ['H5', 'text', ['notehead', 'stem', 'beam', 'accidental'], true]
  ];
  /* objects: EngravedScore objects; page: {w, h}; measures: the EngravedScore measures (for H8); systems (for H6).
     -> [{code, refs: [object ids], detail}] in a fixed order */
  function collisions(objects, page, measures, systems) {
    const out = [];
    /* H4: inside the page */
    objects.forEach(o => {
      const b = o.box;
      if (b[0] < -EPS || b[1] < -EPS || b[2] > page.w + EPS || b[3] > page.h + EPS) out.push({ code: 'H4', refs: [o.id], detail: o.kind });
    });
    /* H1-H3: per system and staff, sorted by x, each pair once */
    const groups = new Map();
    objects.forEach(o => {
      const k = o.system + '|' + o.staffKey;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    });
    [...groups.keys()].sort().forEach(k => {
      const list = groups.get(k).slice().sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length && list[j].box[0] < a.box[2] - EPS; j++) {
          const b = list[j];
          if (!overlaps(a.box, b.box)) continue;
          /* a shared unison's two heads, or the one accidental two voices share, stand at one place by design (§14.2) */
          if (a.merged && a.merged.indexOf(b.id) >= 0 && b.merged && b.merged.indexOf(a.id) >= 0) continue;
          RULES.forEach(([code, ka, kb, same]) => {
            const hit = (x, y) => x.kind === ka && kb.indexOf(y.kind) >= 0 && (same || x.event !== y.event) && x.id !== y.id;
            if (hit(a, b) || hit(b, a)) out.push({ code: code, refs: [a.id, b.id].sort(), detail: a.kind + '/' + b.kind });
          });
        }
      }
    });
    /* H6: nothing of one staff touches anything of another staff of the system (the staves' skylines, compared
       object by object: staves may interleave where one reaches low and the next reaches high elsewhere); a bar line
       that runs through the gap to the next staff of its part meets that staff by design. Systems are bands and
       must not overlap at all. */
    const bySystem = new Map();
    objects.forEach(o => {
      if (o.staffKey === null || o.staffKey === undefined) return;
      if (!bySystem.has(o.system)) bySystem.set(o.system, []);
      bySystem.get(o.system).push(o);
    });
    const frame = k => k === 'barline' || k === 'staff';
    [...bySystem.keys()].sort((a, b) => a - b).forEach(k => {
      const list = bySystem.get(k).slice().sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length && list[j].box[0] < a.box[2] - EPS; j++) {
          const b = list[j];
          if (a.staffKey === b.staffKey || (frame(a.kind) && frame(b.kind)) || !overlaps(a.box, b.box)) continue;
          out.push({ code: 'H6', refs: [a.id, b.id].sort(), detail: 'staff ' + a.kind + '/' + b.kind });
        }
      }
    });
    for (let i = 1; i < (systems || []).length; i++)
      if (systems[i].box[1] < systems[i - 1].box[3] - EPS) out.push({ code: 'H6', refs: ['system:' + (i - 1), 'system:' + i], detail: 'system' });
    /* H8: a note's head, rest, dot or accidental inside its measure */
    const mBox = new Map((measures || []).map(m => [m.id, m]));
    objects.forEach(o => {
      if (!o.measure || ['notehead', 'rest', 'dot', 'accidental'].indexOf(o.kind) < 0) return;
      const m = mBox.get(o.measure);
      if (m && (o.box[0] < m.x - EPS || o.box[2] > m.x + m.w + EPS)) out.push({ code: 'H8', refs: [o.id], detail: o.kind + ' outside ' + m.id });
    });
    return out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.refs.join() < b.refs.join() ? -1 : a.refs.join() > b.refs.join() ? 1 : 0));
  }

  return Object.freeze({ CELL, EPS, FAR, overlaps, union, Skyline, clearance, collisions });
});
