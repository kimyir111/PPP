/* ============================================================================
   PPP engrave — curves: ties, slurs, glissandi (docs/GOALS/G04 §13; G4d-1a)

   Pure geometry. A curve is a cubic Bezier {p0, c1, c2, p3} in staff spaces,
   y down, whose control points stand at a third and two thirds of the chord
   and are lifted straight up (or down) - so x runs linearly with t, and the
   curve stands 4h·t(1-t) off its chord: h at the middle. Ties and slurs share
   this shape and nothing else (§13: a tie is a sound, a slur a phrase).

     tieHeight(len)             0.5-1.2 sp, growing with the tie's length (§13.1)
     slurHeight(len)            h = clamp(0.1·len, 0.75, 3) (§13.2)
     arc(p0, p3, h, side)       the curve over the chord p0-p3, bulging `side`
     line(p0, p3)               a straight one (a glissando)
     yAt(c, x)                  the curve's y at x
     samples(c, t)              the boxes the curve covers, one per 0.5 sp of x
                                (§10.1: a curve enters a skyline as boxes), `t`
                                its thickness
     slur(p0, p3, side, cells, o)  the slur over what lies between its ends:
                                cells [[x0, x1, y]] (a skyline's profile) are
                                cleared by CLEAR, its two control points raised
                                as little as they can (each as far as it must);
                                a cell [x0, x1, y, true] (fingering by an end,
                                G4-L5) is only never crossed, up to the ends;
                                if even the highest arc does not clear, both ends
                                move out MOVE at a time, TRIES times, then one end
                                further than the other (up to SPREAD moves each,
                                least in all first); past that it is drawn anyway
                                and says so (collides: true -> SLUR_COLLIDES)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).curves = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* §13.1: a tie's height grows with its length within 0.5-1.2 sp; an end beside a head stands 0.2 sp from the head's
     centre and GAP off its edge, an end between heads (a chord's inner head, or after dots) INNER_DX past what it
     leaves and INNER_DY off the head's centre - G4-L4: within REACH of its own head and LEAD nearer it than any other head
     of the chord, else further off the centre a STEP at a time; a tie with no other end is STUB long; THICK at its middle */
  const TIE = Object.freeze({ hMin: 0.5, hMax: 1.2, hPerLen: 0.15, hBase: 0.2, outerDx: 0.2, gap: 0.15, innerDx: 0.15, innerDy: 0.25,
    reach: 0.45, lead: 0.05, step: 0.05, stub: 2.0, thick: 0.16 });
  /* §13.2: a slur's height, its clearance of what lies under it (0.25 sp), how far an end stands off its note (PAD), how
     far its ends move out when even the highest arc does not clear (MOVE, TRIES times together, then up to SPREAD times
     each, one further than the other), where a half ends at a system break (1 sp before the bar line, 1 sp before the
     first column), its thickness, the cells by an end that are its notes' own (ENDZONE), and how far a curve passes a
     cell it must only not cross (TOUCH past its half thickness: fingering by an end, G4-L5) */
  const SLUR = Object.freeze({ hMin: 0.75, hMax: 3, hPerLen: 0.1, clear: 0.25, pad: 0.25, move: 0.5, tries: 6, sysGap: 1.0, thick: 0.2,
    endZone: 0.5, spread: 20, touch: 0.05 });
  /* §13.4: a glissando starts GAP after its first head and ends GAP before its second; a wavy one waves AMP either
     side of its line, a wave every WAVE sp */
  const GLISS = Object.freeze({ gap: 0.3, amp: 0.2, wave: 0.6, thick: 0.12 });
  const STEP = 0.5;                    /* sp: §10.1's sampling of a curve into boxes */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tieHeight = len => clamp(TIE.hPerLen * len + TIE.hBase, TIE.hMin, TIE.hMax);
  const slurHeight = len => clamp(SLUR.hPerLen * len, SLUR.hMin, SLUR.hMax);

  function arc(p0, p3, h, side) {
    const s = side === 'above' ? -1 : 1, k = 4 * h / 3;
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    return { p0: p0.slice(), c1: [p0[0] + dx / 3, p0[1] + dy / 3 + s * k], c2: [p0[0] + 2 * dx / 3, p0[1] + 2 * dy / 3 + s * k], p3: p3.slice(), h: h };
  }
  function line(p0, p3) {
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    return { p0: p0.slice(), c1: [p0[0] + dx / 3, p0[1] + dy / 3], c2: [p0[0] + 2 * dx / 3, p0[1] + 2 * dy / 3], p3: p3.slice(), h: 0 };
  }
  /* the y of the curve at x (x runs linearly with t: the control points stand at a third and two thirds of the chord) */
  function yAt(c, x) {
    const L = c.p3[0] - c.p0[0];
    const t = L > 1e-9 ? clamp((x - c.p0[0]) / L, 0, 1) : 0, u = 1 - t;
    return u * u * u * c.p0[1] + 3 * u * u * t * c.c1[1] + 3 * u * t * t * c.c2[1] + t * t * t * c.p3[1];
  }
  /* the boxes the curve covers: one per STEP of x, each from the curve at its two ends, thickened by t/2 (and by `wave`
     for a wavy line) */
  function samples(c, t, wave) {
    const L = c.p3[0] - c.p0[0];
    const n = Math.max(1, Math.ceil(Math.abs(L) / STEP - 1e-9));
    const out = [], w = (t || 0) / 2 + (wave || 0);
    for (let k = 0; k < n; k++) {
      const xa = c.p0[0] + L * k / n, xb = c.p0[0] + L * (k + 1) / n;
      const ya = yAt(c, xa), yb = yAt(c, xb);
      out.push([Math.min(xa, xb), Math.min(ya, yb) - w, Math.max(xa, xb), Math.max(ya, yb) + w]);
    }
    return out;
  }
  /* A slur over what lies between its ends (§13.2): its two control points are raised - each as far as it must, the two
     together as little as they can - until the curve clears every cell (x0, x1, y) of `cells` by the clearance; cells
     within endZone of an end are the end notes' own. The curve stands k1·3(1-t)²t + k2·3(1-t)t² off its chord (k1, k2 the
     control points' lifts), so each cell asks A·k1 + B·k2 >= its need - two unknowns: the least k1 + k2 is found by
     halving, and within it the most even pair. Both at least the default height's, neither above the highest arc's, and
     neither less than RATIO of the other (no kink). -> {k1, k2} | null when no pair up to the highest arc clears */
  const RATIO = 0.35;
  function lifts(p0, p3, side, cells, o, k0) {
    const L = p3[0] - p0[0];
    const kmax = 4 * o.hMax / 3;
    const cons = [];
    if (L > 1e-9) {
      const above = side === 'above';
      const lo = p0[0] + o.endZone, hi = p3[0] - o.endZone;
      cells.forEach(([x0, x1, y, hard]) => {
        /* a hard cell reaches the ends and asks only that the curve not cross it */
        const a = Math.max(x0, hard ? p0[0] : lo), b = Math.min(x1, hard ? p3[0] : hi);
        if (a > b + 1e-9) return;
        const margin = hard ? o.thick / 2 + o.touch : o.clear + o.thick / 2;
        [a, (a + b) / 2, b].forEach(x => {
          const t = (x - p0[0]) / L, u = 1 - t;
          const chord = p0[1] + (p3[1] - p0[1]) * t;
          const n = above ? chord - (y - margin) : (y + margin) - chord;
          if (n > 1e-9) cons.push([3 * u * u * t, 3 * u * t * t, n]);
        });
      });
    }
    /* k1 within [lo, hi] for a sum S, or null */
    const range = S => {
      let lo = Math.max(k0, S - kmax, RATIO * S / (1 + RATIO)), hi = Math.min(kmax, S - k0, S / (1 + RATIO));
      for (const [A, B, n] of cons) {
        const d = A - B, r = n - B * S;
        if (Math.abs(d) < 1e-12) { if (r > 1e-9) return null; continue; }
        if (d > 0) lo = Math.max(lo, r / d); else hi = Math.min(hi, r / d);
        if (lo > hi + 1e-9) return null;
      }
      return lo <= hi + 1e-9 ? [lo, hi] : null;
    };
    if (!range(2 * kmax)) return null;
    let a = 2 * k0, b = 2 * kmax;
    if (!range(a)) { for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (range(m)) b = m; else a = m; } a = b; }
    const r = range(a);
    const k1 = Math.min(r[1], Math.max(r[0], a / 2));
    return { k1: k1, k2: a - k1 };
  }
  function lifted(p0, p3, side, k1, k2) {
    const s = side === 'above' ? -1 : 1, dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    return { p0: p0.slice(), c1: [p0[0] + dx / 3, p0[1] + dy / 3 + s * k1], c2: [p0[0] + 2 * dx / 3, p0[1] + 2 * dy / 3 + s * k2], p3: p3.slice(),
      h: 3 * (k1 + k2) / 8 };
  }
  function slur(p0, p3, side, cells, opts) {
    const o = Object.assign({ clear: SLUR.clear, thick: SLUR.thick, endZone: SLUR.endZone, hMax: SLUR.hMax, move: SLUR.move, tries: SLUR.tries,
      spread: SLUR.spread, touch: SLUR.touch }, opts || {});
    const s = side === 'above' ? -1 : 1;
    const k0 = 4 * slurHeight(Math.abs(p3[0] - p0[0])) / 3;
    const at = (p, k) => [p[0], p[1] + s * k * o.move];
    for (let k = 0; k <= o.tries; k++) {
      const a = at(p0, k), b = at(p3, k), r = lifts(a, b, side, cells, o, k0);
      if (r) return { curve: lifted(a, b, side, r.k1, r.k2), lift: k * o.move, collides: false };
    }
    /* then one end further than the other - a long slur whose notes by one end stand high (G4-L5: with their fingering):
       one end at most TRIES moves out, the other up to SPREAD; the least moved in all first, the start moved less first */
    for (let k = 1; k <= o.tries + o.spread; k++) {
      for (let i = Math.max(0, k - o.spread); i <= Math.min(k, o.spread); i++) {
        const j = k - i;
        if (i === j || (i > o.tries && j > o.tries)) continue;
        const a = at(p0, i), b = at(p3, j), r = lifts(a, b, side, cells, o, k0);
        if (r) return { curve: lifted(a, b, side, r.k1, r.k2), lift: Math.max(i, j) * o.move, collides: false };
      }
    }
    return { curve: arc(at(p0, o.tries), at(p3, o.tries), o.hMax, side), lift: o.tries * o.move, collides: true };
  }

  return Object.freeze({ TIE, SLUR, GLISS, STEP, tieHeight, slurHeight, arc, line, yAt, samples, slur });
});
