/* ============================================================================
   PPP engrave — the SVG backend: EngravedScore -> an SVG string (docs/GOALS/G04 §16.3, §16.4, §18.2; G4-L1, G4c)

     svg(engraved, plan, opts)  -> a deterministic SVG document (a string)

   It draws what the EngravedScore says, where it says: nothing is laid out or
   measured here (G04 §20 lets this file measure the DOM, and it does not - it
   emits text; the same input gives the same bytes in Node and a browser).

   - Units are staff spaces: the viewBox is the page in sp, width and height are
     in px (opts.px per sp, 10 on screen). Every number is rounded to 0.01.
   - Glyphs are defined once, as <symbol> in <defs>, from the pinned Bravura
     outlines (engrave/outlines.js) at the metrics' scale, and placed with
     <use> at the object's origin (G04 §16.3: VexFlow repeats a glyph's whole
     path for every note - the main reason a legacy score's SVG is large, B9).
   - Stems, ledger lines and bar lines are rectangles, beams parallelograms,
     staff lines one path per measure and staff; ink is currentColor, so the
     page's theme colours it.
   - The DOM contract of §16.4, as the legacy renderer writes it:
       g.ppp-stave[data-m][data-staff][data-begin][data-end][data-volta][data-time]
         one per measure and staff: its staff lines, bar lines, clef, key and
         time signature (a system's head goes with its first measure)
       g.ppp-note[data-onset][data-ev] (+ data-rest="1")
         one per event and staff it is drawn on; data-onset is the legacy
         "measure|beat|staff" key, data-ev the graph event ID. Inside, VexFlow's
         class names: .vf-notehead (rests too, as VexFlow draws them), .vf-stem,
         .vf-flag, .vf-accidental, .vf-dot, .vf-ledger
       g.ppp-grace[data-ev]   a grace note (it takes no time: not a ppp-note)
       path.vf-beam[data-beam], g.ppp-tuplet[data-tuplet], g.ppp-volta,
       .vf-clef on clefs
       G4d-1a: ties as path.vf-stavetie.ppp-tie[data-tie] (§16.4: PPP's own
       curve, with VexFlow's class), slurs path.vf-curve.ppp-slur[data-slur],
       glissandi path.ppp-gliss[data-gliss]; in a note's group its
       articulations, ornaments, fermata, tremolo, arpeggio (.vf-stroke), head
       parentheses and fingering (text.ppp-fingering); a fermata over a bar
       line after the notes. Text is <text> in the page's families (the widths
       the layout used are engrave/metrics-text.js's).
     and the root svg.ppp-engraved[data-plan] (the graph fingerprint and plan
     version the layout was made from; data-layout, the layout hash, on request).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./metrics.js'), require('./outlines.js'), require('./canon.js'), require('./plan.js'), require('./metrics-text.js'),
      require('./curves.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.svg = factory(M.metrics, M.outlines, M.canon, M.plan, M.metricsText, M.curves);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MT, OL, CN, PL, TX, CV) {
  'use strict';

  const EG = MT.ENGRAVING;
  /* hash: also write the EngravedScore's layout hash (data-layout) - off by default: hashing a whole score costs more than
     writing its SVG */
  const DEFAULTS = Object.freeze({ px: 10, idPrefix: 'ppp-g-', hash: false });
  const f = v => { const x = Math.round(v * 100) / 100; return String(x === 0 ? 0 : x); };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attrs = o => Object.keys(o).filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '').map(k => ' ' + k + '="' + esc(o[k]) + '"').join('');
  const K = 1 / OL.UNITS;
  /* the symbol scale, written to 7 significant digits (1/360 sp a font unit) */
  const KS = String(Math.round(K * 1e9) / 1e9);

  const CLASS = { notehead: 'vf-notehead', rest: 'vf-notehead vf-rest', stem: 'vf-stem', flag: 'vf-flag', accidental: 'vf-accidental', dot: 'vf-dot',
    ledger: 'vf-ledger', clef: 'vf-clef', keysig: 'vf-keysignature', timesig: 'vf-timesignature', barline: 'vf-barline', slash: 'vf-grace-slash',
    'tuplet-number': 'vf-tuplet-number', 'tuplet-bracket': 'vf-tuplet-bracket',
    articulation: 'vf-articulation', ornament: 'vf-ornament', fermata: 'vf-fermata', tremolo: 'vf-tremolo', paren: 'vf-notehead-paren',
    arpeggio: 'vf-stroke', fingering: 'ppp-fingering', text: 'ppp-text' };
  /* a curve's filled shape: its centre line's control points moved out and in by 2t/3 (t thick at the middle, the ends
     pointed) */
  const lens = (c, side) => {
    const s = side === 'above' ? -1 : 1, d = 2 * c.t / 3;
    const P = p => f(p[0]) + ' ' + f(p[1]);
    const o1 = [c.c1[0], c.c1[1] + s * d], o2 = [c.c2[0], c.c2[1] + s * d], i1 = [c.c1[0], c.c1[1] - s * d], i2 = [c.c2[0], c.c2[1] - s * d];
    return 'M' + P(c.p0) + 'C' + P(o1) + ' ' + P(o2) + ' ' + P(c.p3) + 'C' + P(i2) + ' ' + P(i1) + ' ' + P(c.p0) + 'Z';
  };
  /* a wavy line from a to b: half waves of `wave`/2, `amp` either side, as quadratic curves */
  const wavy = (a, b, amp, wave) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(2, Math.round(L / (wave / 2)));
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    let d = 'M' + f(a[0]) + ' ' + f(a[1]);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2, sgn = k % 2 ? -1 : 1;
      const cx = a[0] + dx * tm + nx * 2 * amp * sgn, cy = a[1] + dy * tm + ny * 2 * amp * sgn;
      d += 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(a[0] + dx * t1) + ' ' + f(a[1] + dy * t1);
    }
    return d;
  };

  function svg(eng, plan, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const P = o.idPrefix;
    const page = eng.pages[0];
    const out = [];
    /* the glyphs this page uses, each defined once */
    const used = new Set();
    eng.objects.forEach(x => { if (x.glyph && !x.drawn && OL.PATHS[x.glyph]) used.add(x.glyph); });
    const glyphs = [...used].sort();
    const use = (x, cls) => {
      const s = x.scale === undefined ? 1 : x.scale;
      const pos = s === 1 ? ' x="' + f(x.origin[0]) + '" y="' + f(x.origin[1]) + '"'
        : ' transform="translate(' + f(x.origin[0]) + ' ' + f(x.origin[1]) + ') scale(' + f(s) + ')"';
      return '<use href="#' + P + x.glyph + '"' + (cls ? ' class="' + cls + '"' : '') + pos + '/>';
    };
    const rect = (b, cls, extra) => '<rect' + (cls ? ' class="' + cls + '"' : '') + ' x="' + f(b[0]) + '" y="' + f(b[1]) + '" width="' + f(b[2] - b[0]) +
      '" height="' + f(b[3] - b[1]) + '"' + (extra || '') + '/>';
    /* one object, as the element that draws it */
    function draw(x) {
      const cls = CLASS[x.kind] || null;
      if (x.glyph && x.drawn && (x.glyph === 'accidentalBracketLeft' || x.glyph === 'accidentalBracketRight')) {
        /* an editorial accidental's square bracket (G4d-1a): a thin stroke with its two ends turned in */
        const b = x.box, left = x.glyph === 'accidentalBracketLeft', xs = left ? b[0] + 0.1 : b[2] - 0.1, xe = left ? b[2] : b[0];
        return '<path' + (cls ? ' class="' + cls + '"' : '') + ' d="M' + f(xe) + ' ' + f(b[1]) + 'H' + f(xs) + 'V' + f(b[3]) + 'H' + f(xe) +
          '" fill="none" stroke="currentColor" stroke-width="' + f(0.12 * (x.scale || 1)) + '"/>';
      }
      if (x.glyph && x.drawn) {
        /* a shape VexFlow draws as a path (the slash notehead): a slanted bar across its box */
        const b = x.box, w = Math.min(0.45, (b[2] - b[0]) / 3);
        return '<path' + (cls ? ' class="' + cls + '"' : '') + ' d="M' + f(b[0]) + ' ' + f(b[3]) + 'L' + f(b[0] + w) + ' ' + f(b[3]) + 'L' + f(b[2]) + ' ' + f(b[1]) +
          'L' + f(b[2] - w) + ' ' + f(b[1]) + 'Z"/>';
      }
      if (x.glyph && OL.PATHS[x.glyph]) return use(x, cls);
      if (x.kind === 'beam') {
        const l = x.line, t = x.t;
        return '<path class="vf-beam" data-beam="' + esc(x.refs[0]) + '" d="M' + f(l[0]) + ' ' + f(l[1]) + 'L' + f(l[2]) + ' ' + f(l[3]) + 'L' + f(l[2]) + ' ' + f(l[3] + t) +
          'L' + f(l[0]) + ' ' + f(l[1] + t) + 'Z"/>';
      }
      if (x.kind === 'slash') {
        const l = x.line;
        return '<path class="' + cls + '" d="M' + f(l[0]) + ' ' + f(l[1]) + 'L' + f(l[2]) + ' ' + f(l[3]) + '" fill="none" stroke="currentColor" stroke-width="' + f(x.t) + '"/>';
      }
      if (x.kind === 'tuplet-bracket') {
        const l = x.line, y = l[1], h = x.side === 'above' ? x.hookLen : -x.hookLen;
        const d = [];
        const left = x.hooks && x.hooks[0], right = x.hooks && x.hooks[1];
        d.push('M' + f(l[0]) + ' ' + f(left ? y + h : y) + (left ? 'V' + f(y) : ''));
        if (x.gap) d.push('H' + f(x.gap[0]) + 'M' + f(x.gap[1]) + ' ' + f(y));
        d.push('H' + f(l[2]) + (right ? 'V' + f(y + h) : ''));
        return '<path class="' + cls + '" d="' + d.join('') + '" fill="none" stroke="currentColor" stroke-width="' + f(0.1 * (x.hookLen / 0.75)) + '"/>';
      }
      if (x.kind === 'volta') {
        const b = x.box;
        let s = '<path d="M' + f(b[0]) + ' ' + f(x.start ? b[3] : b[1]) + 'V' + f(b[1]) + 'H' + f(b[2]) + (x.open ? '' : 'V' + f(b[3])) +
          '" fill="none" stroke="currentColor" stroke-width="0.13"/>';
        if (x.label) s += '<text x="' + f(b[0] + 0.4) + '" y="' + f(b[1] + 1.4) + '" font-size="1.3" font-family="serif">' + esc(x.label) + '</text>';
        return s;
      }
      if (x.kind === 'brace') {
        /* a curly brace through its box, filled between two curves */
        const b = x.box, x0 = b[0], x1 = b[2], y0 = b[1], y1 = b[3], ym = (y0 + y1) / 2, xm = (x0 + x1) / 2, h = y1 - y0;
        return '<path class="vf-brace" d="M' + f(x1) + ' ' + f(y0) + 'C' + f(x0 - 0.2) + ' ' + f(y0 + 0.08 * h) + ' ' + f(x1 + 0.1) + ' ' + f(ym - 0.12 * h) + ' ' + f(x0) + ' ' + f(ym) +
          'C' + f(x1 + 0.1) + ' ' + f(ym + 0.12 * h) + ' ' + f(x0 - 0.2) + ' ' + f(y1 - 0.08 * h) + ' ' + f(x1) + ' ' + f(y1) +
          'C' + f(xm - 0.1) + ' ' + f(y1 - 0.1 * h) + ' ' + f(x1 + 0.45) + ' ' + f(ym + 0.1 * h) + ' ' + f(x0 + 0.25) + ' ' + f(ym) +
          'C' + f(x1 + 0.45) + ' ' + f(ym - 0.1 * h) + ' ' + f(xm - 0.1) + ' ' + f(y0 + 0.1 * h) + ' ' + f(x1) + ' ' + f(y0) + 'Z"/>';
      }
      if (x.kind === 'fingering' || x.kind === 'text') {
        return '<text class="' + cls + '" x="' + f(x.origin[0]) + '" y="' + f(x.origin[1]) + '" font-family="' + esc(TX.FAMILY[x.font]) + '"' +
          (/italic/.test(x.font) ? ' font-style="italic"' : '') + (/bold/.test(x.font) ? ' font-weight="700"' : '') + ' font-size="' + f(x.size) + '">' + esc(x.text) + '</text>';
      }
      if (x.kind === 'arpeggio') {
        const l = x.line, b = x.box, xc = l[0];
        if (x.non) {
          /* against arpeggiating: a bracket, its ends turned toward the chord */
          return '<path class="' + cls + '" d="M' + f(b[2]) + ' ' + f(l[1]) + 'H' + f(xc) + 'V' + f(l[3]) + 'H' + f(b[2]) +
            '" fill="none" stroke="currentColor" stroke-width="0.12"/>';
        }
        let s = '<path class="' + cls + '" d="' + wavy([xc, l[3]], [xc, l[1]], 0.18, 0.8) + '" fill="none" stroke="currentColor" stroke-width="0.12"/>';
        if (x.dir === 'up') s += '<path class="' + cls + '" d="M' + f(xc) + ' ' + f(b[1]) + 'L' + f(xc - 0.35) + ' ' + f(l[1]) + 'H' + f(xc + 0.35) + 'Z"/>';
        if (x.dir === 'down') s += '<path class="' + cls + '" d="M' + f(xc) + ' ' + f(b[3]) + 'L' + f(xc - 0.35) + ' ' + f(l[3]) + 'H' + f(xc + 0.35) + 'Z"/>';
        return s;
      }
      if (x.kind === 'staff') return '';
      return rect(x.box, cls);
    }
    /* a curve (G4d-1a): a tie or a slur as its filled shape (a dashed or dotted slur as a stroke), a glissando as a line */
    function curve(c) {
      if (c.kind === 'gliss') {
        const d = c.line === 'wavy' ? wavy(c.p0, c.p3, CV.GLISS.amp, CV.GLISS.wave) : 'M' + f(c.p0[0]) + ' ' + f(c.p0[1]) + 'L' + f(c.p3[0]) + ' ' + f(c.p3[1]);
        return '<path class="ppp-gliss" data-gliss="' + esc(c.refs[0]) + '" d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + f(c.t) + '"/>';
      }
      const cls = c.kind === 'tie' ? 'vf-stavetie ppp-tie' : 'vf-curve ppp-slur', data = c.kind === 'tie' ? 'data-tie' : 'data-slur';
      if (c.line === 'dashed' || c.line === 'dotted') {
        const P = p => f(p[0]) + ' ' + f(p[1]);
        return '<path class="' + cls + '" ' + data + '="' + esc(c.refs[0]) + '" d="M' + P(c.p0) + 'C' + P(c.c1) + ' ' + P(c.c2) + ' ' + P(c.p3) +
          '" fill="none" stroke="currentColor" stroke-width="' + f(c.t * 0.6) + '" stroke-dasharray="' + (c.line === 'dotted' ? '0.1 0.4' : '0.6 0.4') +
          '" stroke-linecap="round"/>';
      }
      return '<path class="' + cls + '" ' + data + '="' + esc(c.refs[0]) + '" d="' + lens(c, c.side) + '"/>';
    }
    /* staff lines of one staff object, between x0 and x1 */
    const lines = (st, x0, x1) => {
      const sp = st.space || 1, y0 = st.box[1] + EG.staffLine / 2 * sp;
      const d = [];
      for (let i = 0; i < st.lines; i++) d.push('M' + f(x0) + ' ' + f(y0 + i * sp) + 'H' + f(x1));
      return d.length ? '<path class="vf-stave" d="' + d.join('') + '" fill="none" stroke="currentColor" stroke-width="' + f(EG.staffLine * sp) + '"/>' : '';
    };

    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="ppp-engraved" viewBox="0 0 ' + f(page.w) + ' ' + f(page.h) + '" width="' + f(page.w * o.px) +
      '" height="' + f(page.h * o.px) + '" fill="currentColor" data-plan="' + esc(eng.planKey) + '"' + (o.hash ? ' data-layout="' + CN.hash(eng) + '"' : '') + '>');
    if (glyphs.length) {
      out.push('<defs>');
      glyphs.forEach(n => out.push('<symbol id="' + P + n + '" overflow="visible"><path transform="scale(' + KS + ' -' + KS + ')" d="' + OL.PATHS[n] + '"/></symbol>'));
      out.push('</defs>');
    }

    /* the plan: measure numbers, staff numbers, events, endings */
    const pm = new Map(plan.measures.map((m, i) => [m.id, Object.assign({ i: i }, m)]));
    const staffNo = new Map(plan.staves.map((s, i) => [s.id, s.number || i + 1]));
    const pe = new Map(plan.events.map(e => [e.id, e]));
    const meterAt = mid => { const i = pm.get(mid).i; let k = null; (plan.meters || []).forEach(x => { if (pm.get(x.m) && pm.get(x.m).i <= i) k = x; }); return k; };
    const voltaOf = (mid, staffKey) => {
      if (staffKey !== plan.staves[0].id) return null;
      const i = pm.get(mid).i;
      for (const en of plan.endings || []) {
        const a = pm.get(en.from) ? pm.get(en.from).i : -1, b = pm.get(en.to) ? pm.get(en.to).i : a;
        if (i < a || i > b) continue;
        const label = i === a ? (en.numbers || []).join(',') : '';
        const type = i === a ? (a === b && !en.open ? 'BEGIN_END' : 'BEGIN') : i === b && !en.open ? 'END' : 'MID';
        return type + (label ? ':' + label : '');
      }
      return null;
    };

    const bySystem = new Map(eng.systems.map(s => [s.index, []]));
    eng.objects.forEach(x => bySystem.get(x.system).push(x));
    const curvesBy = new Map();
    (eng.curves || []).forEach(c => { if (!curvesBy.has(c.system)) curvesBy.set(c.system, []); curvesBy.get(c.system).push(c); });
    const mById = new Map(eng.measures.map(m => [m.id, m]));
    eng.systems.forEach(sys => {
      const objs = bySystem.get(sys.index);
      out.push('<g class="ppp-system" data-system="' + sys.index + '">');
      /* staves: per measure and staff - the staff lines of the measure, its bar lines and signatures; the system's head
         and the courtesy signatures after its last bar line go with its first and last measure */
      const staffObj = new Map(objs.filter(x => x.kind === 'staff').map(x => [x.staffKey, x]));
      const frame = new Map();
      const firstM = sys.measures[0], lastM = sys.measures[sys.measures.length - 1];
      objs.forEach(x => {
        if (!x.staffKey || ['barline', 'clef', 'keysig', 'timesig'].indexOf(x.kind) < 0 || x.event) return;
        const k = (x.measure || firstM) + '|' + x.staffKey;
        if (!frame.has(k)) frame.set(k, []);
        frame.get(k).push(x);
      });
      sys.measures.forEach((mid, mk) => {
        const m = mById.get(mid), p = pm.get(mid);
        sys.staves.forEach(st => {
          const so = staffObj.get(st.key);
          const items = frame.get(mid + '|' + st.key) || [];
          const bar = p.barline || {};
          const right = bar.right || {}, left = bar.left || {};
          const end = right.repeat === 'backward' ? 'repeat' : right.style === 'light-heavy' ? 'final' : right.style === 'light-light' ? 'double' : null;
          const meter = meterAt(mid);
          const time = items.some(x => x.kind === 'timesig' && !x.courtesy) && meter ? meter.beats.join('+') + '/' + meter.beatType : null;
          out.push('<g' + attrs({ class: 'ppp-stave', 'data-m': m.number, 'data-staff': staffNo.get(st.key), 'data-begin': left.repeat === 'forward' ? 'repeat' : null,
            'data-end': end, 'data-volta': voltaOf(mid, st.key), 'data-time': time }) + '>');
          if (so) out.push(lines(so, mk === 0 ? so.box[0] : m.x, mid === lastM ? so.box[2] : m.x + m.w));
          items.forEach(x => out.push(draw(x)));
          out.push('</g>');
        });
      });
      objs.filter(x => !x.staffKey && (x.kind === 'barline' || x.kind === 'brace')).forEach(x => out.push(draw(x)));
      /* notes: one group per event and staff, in the order the EngravedScore lists them; grace notes apart */
      const groups = new Map();
      const order = [];
      objs.forEach(x => {
        if (!x.event) return;
        const k = x.event + '|' + x.staffKey;
        if (!groups.has(k)) { groups.set(k, []); order.push(k); }
        groups.get(k).push(x);
      });
      order.forEach(k => {
        const list = groups.get(k), e = pe.get(list[0].event);
        if (e && e.grace) out.push('<g class="ppp-grace" data-ev="' + esc(e.id) + '">');
        else {
          const rest = e && e.kind === 'rest';
          const onset = e ? PL.onsetKey(plan, e, rest ? e.staff : list[0].staffKey) : null;
          out.push('<g' + attrs({ class: 'ppp-note vf-stavenote', 'data-onset': onset, 'data-ev': list[0].event, 'data-rest': rest ? '1' : null }) + '>');
        }
        list.forEach(x => out.push(draw(x)));
        out.push('</g>');
      });
      /* beams, tuplets, voltas */
      objs.filter(x => x.kind === 'beam').forEach(x => out.push(draw(x)));
      const tup = new Map(), torder = [];
      objs.filter(x => x.kind === 'tuplet-number' || x.kind === 'tuplet-bracket').forEach(x => {
        /* the parts of a tuplet across a system break are groups of their own ('@' + the part's first event) */
        const key = x.refs[0] + (x.id.indexOf('@') > 0 ? x.id.slice(x.id.indexOf('@')) : '');
        if (!tup.has(key)) { tup.set(key, []); torder.push(key); }
        tup.get(key).push(x);
      });
      torder.forEach(key => {
        const list = tup.get(key);
        out.push('<g class="ppp-tuplet" data-tuplet="' + esc(list[0].refs[0]) + '">');
        list.forEach(x => out.push(draw(x)));
        out.push('</g>');
      });
      objs.filter(x => x.kind === 'volta').forEach(x => out.push('<g class="ppp-volta">' + draw(x) + '</g>'));
      /* G4d-1a: a fermata over a bar line (no note of its own), then the curves */
      objs.filter(x => !x.event && (x.kind === 'fermata' || x.kind === 'text')).forEach(x => out.push(draw(x)));
      (curvesBy.get(sys.index) || []).forEach(c => out.push(curve(c)));
      out.push('</g>');
    });
    out.push('</svg>');
    return out.join('\n');
  }

  return Object.freeze({ DEFAULTS, svg });
});
