/* ============================================================================
   PPP engrave — the renderer in the page (docs/GOALS/G04 §16; G4d-2)

   The app's ScoreView draws through this file when its `renderer` is
   'engrave' (a developer's switch in G4d-2: the default stays 'legacy', G04
   §25). It is the one engrave/ file that works with the DOM: it puts the
   engraver's SVG into the view's element, draws the practice layer's own marks
   over it, moves the playhead, colours the notes and reads the pointer. What
   is drawn, and where, is decided elsewhere and never here - the plan
   (plan.js), the layout (layout.js), the SVG (svg.js), the practice map
   (practice.js).

     createView(env)   one per ScoreView: paint(el, props) -> 'drawn' | 'pending' | 'legacy'
     layoutConfig(p, score, viewportPx), semanticConfig(p), drawKey(parts)
     createSync(groups) the page's sync (§16.2): the notes lit, hidden and
                        marked wrong, touching only what changed
     annotations(...)   the practice layer's text: bar numbers, the whole
                        score's heading, the note-name letters (§16.4 .ppp-ann)
     stats              draws, fallbacks, cache hits, sync frames, timings

   The pipeline and its caches (§16.2, §16.3; the version rule, G4-D1a-1):
     the render source      PPPEngrave.app.resolve(score, {key}): the graph the
                            Score came from when legacy.agree says it states the
                            same music, else the Score's own projection; once
                            per Score object. agree.ok and link.ok are required:
                            a source that does not agree is a fallback, never a
                            drawing of other notes (§7.4, §8.2)
     the plan               once per graph and semantic config, under the plan
                            version (a live or kept graph by the graph object, a
                            projection by the Score's music hash; 4 graphs kept)
     the layout             createEngraver(plan): prepared once, laid out per
                            config, the last 8 kept (§16.5: a resize inside a
                            breakpoint is the same config - no layout at all)
     the SVG, the map       per layout, under the layout version, the last 8
   drawKey = the graph (its fingerprint, or the projection's Score hash) + the
   plan version + the semantic config + the layout version + the layout config
   + what the page draws over it. Anything else - the playhead, the notes lit,
   the hands shown, memory mode - is sync()'s, and draws nothing new.

   The page's SVG is in the legacy renderer's units: 1 user unit = 1 px at the
   engraver's 10 px per staff space (svg.js {unit: 10}), so svg.__ppp, the
   overlays and every pixel test read the same numbers under both renderers.

   Failure (§16.7): anything that throws makes the view hand the song back to
   the legacy renderer ('legacy'), counted in stats.fallbacks by code and per
   song, and warned once as "[ppp] engrave fallback" - the screen is never left
   blank. env.strict() (PPP.strictEngrave, ?strict=1) throws instead.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./plan.js'), require('./layout.js'), require('./practice.js'), require('./svg.js'), require('./canon.js'),
      require('./source.js'), require('./skyline.js'), null);
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.page = factory(M.plan, M.layout, M.practice, M.svg, M.canon, M.source, M.skyline, root);
    root.PPPEngravePage = M.page;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PL, LY, PR, SV, CN, SRC, SK, browser) {
  'use strict';

  const VERSION = '0.6.0-g4d2';
  /* user units per staff space on the page: the legacy renderer's 10 px (VexFlow spacing_between_lines_px) */
  const UNIT = 10;
  const NS = 'http://www.w3.org/2000/svg';
  const GRAPHS = 4, PER_PLAN = 8;
  /* the page's SVG: in px (unit), each glyph defined once in <defs> and placed with <use> - svg.js's default (G4-D2-19,
     R3 fix). G4d-2 first chose inline: true (a path written out at every occurrence) on a claimed 4-10x Chrome repaint
     cost against <use> - but the real page's inline output broke B9 (<=0.5x the legacy renderer's SVG, §19.1) on 2 of 5
     measured non-trivial pieces (up to 0.79x), undisclosed, while the independent review's own Chrome trace found the
     real repaint cost of <use> against inline paths is about 2x, not 4-10x - <use> is still measurably slower per
     playback frame, just not by the multiple that justified breaking B9. Recovering B9 across the catalogue is worth
     that (G04 §37.1, DECISIONS G4-D2-19/20). */
  const SVG_OPTS = Object.freeze({ unit: UNIT, px: UNIT, inline: false });
  const now = () => (browser && browser.performance ? browser.performance.now() : Number(process.hrtime.bigint()) / 1e6);

  const stats = {
    version: VERSION,
    views: 0, paints: 0, draws: 0, pending: 0, routed: 0,
    fallbacks: {}, bySong: {},
    plans: 0, planHits: 0, layouts: 0, layoutHits: 0, svgs: 0, svgHits: 0, maps: 0,
    frames: 0, fullFrames: 0, touched: 0, visited: 0,
    last: null, drawTimes: [], syncTimes: []
  };
  const keep = (list, v, n) => { list.push(v); if (list.length > (n || 400)) list.shift(); };

  /* ------------------------------------------------------------------ configs */
  /* What the plan is asked to draw (G04 §8.3 semanticConfig): the marks and the chord names, as the view's props say. */
  function semanticConfig(p) {
    return { marks: p.marks !== false, chords: p.chords !== false };
  }
  /* The layout config for a view (G04 §15.1, §16.5): its bars as a window, or the whole piece; the breakpoint from the
     viewport (720 px, the app's barsPerLine); four bars in 100 sp on a desktop, two in 40 on a phone - a view of n bars
     to a line is n of those widths, a zoomed close view the same divided by the zoom (bigger notes, fewer to a line).
     Nothing else about the viewport enters it: a resize inside a breakpoint is the same config (B7, A32). */
  function layoutConfig(p, score, viewportPx) {
    const n = (score.measures || []).length;
    const bp = viewportPx <= LY.SCREEN.phoneMaxPx ? 'phone' : 'desktop';
    const S = LY.SCREEN[bp], perBar = S.width / S.bars;
    const first = score._byNumber && score._byNumber[p.startM];
    let i0 = first && first.index !== undefined ? first.index : Math.max(0, (score.measures || []).findIndex(m => m.number === p.startM));
    if (!(i0 >= 0)) i0 = 0;
    const count = Math.max(1, Math.round(p.count || 1));
    const i1 = Math.min(n - 1, i0 + count - 1);
    const whole = i0 === 0 && i1 === n - 1;
    const wrapping = !!p.perRow;
    const per = wrapping ? Math.max(1, Math.round(p.perRow)) : Math.max(1, i1 - i0 + 1);
    const zoom = !wrapping && p.zoom > 0 ? p.zoom : 1;
    const width = Math.round(perBar * per / zoom * 2) / 2;
    return LY.normalizeConfig({ breakpoint: bp, width: width, barsPerSystem: per, window: whole ? null : [i0, i1] });
  }
  /* the key of what is on the page: any part changed means a new drawing */
  const drawKey = parts => JSON.stringify(parts);
  /* A view's drawKey (G04 §16.1): the graph (its fingerprint, or the projection's Score hash), the plan version and the
     semantic config it was planned with, the layout version and config, the page's units, and what the page draws over the
     engraving (bar numbers, heading, note-name letters, weak bars, sizing). Not in it, so they draw nothing new: the
     playhead, the notes lit, the hands shown, memory mode, the wrong notes (sync); the theme and paper (CSS); the viewport
     inside a breakpoint (the config does not change). */
  const viewKey = (graphKey, planVersion, sem, cfg, p) => drawKey([graphKey, planVersion, sem, LY.VERSION, cfg, UNIT, p.numbers !== false,
    p.heading === true && !!p.perRow, !!p.guidance, (p.weak || []).join(','), !!p.fluid, p.zoom || 1]);

  /* a small LRU over a Map */
  function lru(size) {
    const m = new Map();
    return {
      get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
      set(k, v) { m.set(k, v); if (m.size > size) m.delete(m.keys().next().value); return v; },
      get size() { return m.size; }
    };
  }

  /* ------------------------------------------------------------------ caches */
  /* graph -> {plans: key -> {plan, engraver, svgs, maps}}: a producer's or kept graph by the object, a projection by its
     Score's music hash (every Score object gets its own projection; the same music is planned once) */
  const byGraph = new WeakMap();
  const byProjection = lru(GRAPHS);
  function graphEntry(src) {
    if (src.via === 'projected') {
      let g = byProjection.get(src.scoreHash);
      if (!g) g = byProjection.set(src.scoreHash, { key: 'p:' + src.scoreHash, graph: src.graph, plans: lru(4) });
      return g;
    }
    let g = byGraph.get(src.graph);
    if (!g) { g = { key: null, graph: src.graph, plans: lru(4) }; byGraph.set(src.graph, g); }
    return g;
  }
  function planEntry(g, sem) {
    const k = PL.PLAN_VERSION + '|' + CN.canonical(sem);
    let e = g.plans.get(k);
    if (e) { stats.planHits++; return e; }
    const plan = PL.plan(g.graph, sem);
    stats.plans++;
    if (!g.key) g.key = 'g:' + plan.graph.fingerprint;
    e = { key: k, plan: plan, engraver: LY.createEngraver(plan), svgs: lru(PER_PLAN), maps: lru(PER_PLAN) };
    return g.plans.set(k, e);
  }

  /* ------------------------------------------------------------------ sync */
  /* The page's sync (G04 §16.2, A31, B6): the notes sounding at the playhead are found by the G4b highlighter (two sorted
     lists, a pointer each: only the notes whose state flips are visited), and a note's classes are written only when
     its state changed. Everything is recomputed only on a frame where the hands shown, the memory plan or level changed
     (and the notes sounding, when only the wrong-note list changed). The rule for each note is the legacy renderer's
     (App sync), on the Score's own values: the start and end the player uses, the pitches MIDI feedback compares, the
     hand, the data-onset key the memory plan names.

     groups: [{el, start, end, midis, hand, key, hideIdx}]; el has a classList (or is a stub in a test) */
  const CLS = [['ppp-ghost', 1], ['ppp-off', 2], ['ppp-on', 4], ['ppp-bad', 8]];
  const planIds = new WeakMap();
  let planSeq = 0;
  const planId = plan => { if (!plan) return 0; if (!planIds.has(plan)) planIds.set(plan, ++planSeq); return planIds.get(plan); };
  function createSync(groups) {
    const n = groups.length;
    const bits = new Uint8Array(n);        /* the classes written */
    const hidden = new Uint8Array(n);      /* 0 shown, 1 hidden (off), 2 hidden (ghost), 3 hand off */
    const on = new Uint8Array(n);          /* sounding at the playhead (the highlighter's set) */
    const hl = PR.createHighlighter({ timed: () => groups.map((g, i) => ({ id: i, start: g.start, end: g.end })) });
    let fk = null, wk = null, wrongSet = null;
    const st = { frames: 0, fullFrames: 0, touched: 0, visited: 0, lastTouched: 0, lastChanged: 0 };
    function want(i) {
      const h = hidden[i];
      if (h) return h === 2 ? 1 : 2;
      if (!on[i]) return 0;
      const g = groups[i];
      const bad = wrongSet && g.midis.some(m => wrongSet.has(m));
      return bad ? 8 : 4;
    }
    let touched = 0, changed = 0;
    function apply(i) {
      const b = want(i);
      if (b === bits[i]) return;
      changed++;
      const cl = groups[i].el && groups[i].el.classList;
      if (cl) {
        const was = bits[i];
        CLS.forEach(([c, bit]) => { if (((was ^ b) & bit) !== 0) cl.toggle(c, (b & bit) !== 0); });
        touched++;
      }
      bits[i] = b;
    }
    function update(p) {
      const t0 = now();
      st.frames++;
      touched = 0; changed = 0;
      const wantHand = p.hands === 'right' ? 'r' : p.hands === 'left' ? 'l' : null;
      const plan = p.hidePlan || null;
      const hide = p.hide || 0;
      const key = wantHand + '|' + hide + '|' + planId(plan);
      const wrong = p.wrong || [];
      const wkey = wrong.join(',');
      const v0 = hl.stats.visited;
      const r = hl.update(p.beat == null ? -Infinity : p.beat);
      r.off.forEach(i => { on[i] = 0; });
      r.on.forEach(i => { on[i] = 1; });
      const wrongChanged = wkey !== wk;
      if (wrongChanged) { wk = wkey; wrongSet = wrong.length ? new Set(wrong) : null; }
      if (key !== fk) {
        /* the hand filter, the memory plan or level changed: every note again */
        fk = key;
        st.fullFrames++;
        stats.fullFrames++;
        const ghost = !!(plan && plan.ghost);
        for (let i = 0; i < n; i++) {
          const g = groups[i];
          const handOff = !!(wantHand && g.hand !== wantHand);
          const byPlan = plan ? !!plan.hide[g.key]
            : (hide >= 3 || (hide === 2 && g.hideIdx % 2 === 1) || (hide === 1 && g.hideIdx % 4 === 3));
          hidden[i] = handOff ? 3 : byPlan ? (ghost ? 2 : 1) : 0;
          apply(i);
        }
        st.visited += n;
      } else {
        r.off.forEach(apply);
        r.on.forEach(apply);
        /* a new wrong-note list changes only the notes sounding */
        if (wrongChanged) { const act = hl.active(); st.visited += act.length; act.forEach(apply); }
      }
      st.visited += hl.stats.visited - v0;
      st.touched += touched;
      st.lastTouched = touched; st.lastChanged = changed;
      stats.frames++; stats.touched += touched; stats.visited += hl.stats.visited - v0;
      const dt = now() - t0;
      keep(stats.syncTimes, dt, 2000);
      return { touched: touched, changed: changed, ms: dt };
    }
    /* the classes a note has now, for the checks: the same four names the legacy renderer toggles */
    const classesOf = i => CLS.filter(([, bit]) => (bits[i] & bit) !== 0).map(([c]) => c);
    return { update: update, stats: st, classesOf: classesOf, size: n };
  }

  /* The legacy rule itself, for one note (App ScoreView.sync): what createSync must agree with on every frame. */
  function legacyClasses(g, p) {
    const wantHand = p.hands === 'right' ? 'r' : p.hands === 'left' ? 'l' : null;
    const plan = p.hidePlan || null, hide = p.hide || 0, wrong = p.wrong || [];
    const ghost = !!(plan && plan.ghost);
    const handOff = wantHand && g.hand !== wantHand;
    const byPlan = plan ? !!plan.hide[g.key] : (hide >= 3 || (hide === 2 && g.hideIdx % 2 === 1) || (hide === 1 && g.hideIdx % 4 === 3));
    const hidden = handOff || byPlan;
    const lit = !hidden && p.beat != null && p.beat >= g.start && p.beat < g.end;
    const bad = lit && g.midis.some(m => wrong.indexOf(m) > -1);
    const out = [];
    if (hidden && ghost && !handOff) out.push('ppp-ghost');
    if (hidden && !(ghost && !handOff)) out.push('ppp-off');
    if (lit && !bad) out.push('ppp-on');
    if (bad) out.push('ppp-bad');
    return out;
  }

  /* The practice layer's view of each drawn note group (g.ppp-note: one per graph event and staff, G04 §16.4): the Score
     notes it is (identity, the link G4a checks), and from them what the legacy renderer keeps per group - the first
     note's start and length, the pitches, the hand, the onset key. items: [{el, ev, staff, rest}] in document order. */
  function groupsFor(items, score, ident, noteEnd) {
    const notes = score.notes || [];
    const out = [];
    items.forEach(it => {
      const x = ident.events[it.ev];
      if (!x) return;
      let idx = x.notes.filter(i => (notes[i].staff || 1) === it.staff);
      if (!idx.length) idx = x.notes.slice();
      idx.sort((a, b) => a - b);
      const head = notes[idx[0]];
      const heads = idx.map(i => notes[i]).filter(n => !n.rest && n.p);
      out.push({ el: it.el, ev: it.ev, staff: it.staff, start: head.abs, end: noteEnd(head.abs, head.dur), midis: heads.map(n => n.midi),
        hand: head.hand, key: head.m + '|' + (+head.b).toFixed(3) + '|' + (head.staff || 1), letter: heads.length ? String(heads[0].p).charAt(0) : null,
        rest: !!it.rest });
    });
    /* the legacy renderer's order for the memory levels without a plan: by start, then as drawn */
    out.map((g, i) => [g, i]).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]).forEach(([g], k) => { g.hideIdx = k; });
    return out;
  }

  /* ------------------------------------------------------------------ the practice layer's text */
  /* Bar numbers, the whole score's heading and the note-name letters are the practice layer's, as in the legacy
     renderer (text.ppp-ann, §16.4) - not the engraver's: they are placed from the EngravedScore's boxes, in page units
     (px), and do not enter its skylines (G4-D2-7). A bar number stands 9 px over the top line at the bar's start (the
     system's head for a system's first bar), lifted over anything the engraver put there. */
  function textBox(t) {
    const w = String(t.text).length * t.size * (t.family === 'mono' ? 0.6 : 0.5);
    const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
    return [x0, t.y - t.size * 0.75, x0 + w, t.y + t.size * 0.2];
  }
  /* G4-D2-19 (R2 fix): bar numbers and guide letters used to be placed from independent bounding-box checks against a
     flat list of the engraver's boxes (a handful of fixed-step nudges, no real placement rule) - on a 60-file corpus
     sample this missed 115/1,698 bar-number and 234/2,301 guide-letter collisions with real noteheads, stems, beams and
     accidentals (H5). They now go through the same collision foundation the engraver itself places every other object
     with (engrave/skyline.js, §10.1): one Skyline per system, built from the same boxes as before (everything the
     engraver drew there, minus the staff lines, bar lines and braces that text may cross), and each label is placed with
     Skyline.put() - out past whatever is already there, not just past the pass count a fixed loop happened to try. A
     label put() adds itself, so two labels in one system see each other too. This is the generalized fix: the skyline
     itself decides where content is, not a special-cased distance to look. */
  function annotations(eng, plan, score, p, groups) {
    const U = UNIT, out = [];
    const pageW = eng.pages[0].w * U;
    const skyBySys = new Map(eng.systems.map(s => [s.index, new SK.Skyline(0, pageW)]));
    eng.objects.forEach(o => {
      if (o.kind === 'staff' || o.kind === 'barline' || o.kind === 'brace') return;
      skyBySys.get(o.system).add(o.box.map(v => v * U));
    });
    /* a curve as the boxes of its short pieces (24 along it), not its control points' box - a phrase slur's control points
       stand far above the slur itself */
    (eng.curves || []).forEach(c => {
      const at = (t, i) => { const u = 1 - t; return u * u * u * c.p0[i] + 3 * u * u * t * c.c1[i] + 3 * u * t * t * c.c2[i] + t * t * t * c.p3[i]; };
      const half = (c.t || 0.2) / 2;
      let px = at(0, 0), py = at(0, 1);
      for (let k = 1; k <= 24; k++) {
        const x = at(k / 24, 0), y = at(k / 24, 1);
        skyBySys.get(c.system).add([Math.min(px, x) * U, (Math.min(py, y) - half) * U, Math.max(px, x) * U, (Math.max(py, y) + half) * U]);
        px = x; py = y;
      }
    });
    /* a text box in the skyline's own boxes: [x0,x1] and h so that put()'s box, converted back, matches textBox()'s
       occupied region (ascent 0.75*size above the baseline, descent 0.2*size below) */
    const span = t => { const w = String(t.text).length * t.size * (t.family === 'mono' ? 0.6 : 0.5); const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x; return { x0: x0, x1: x0 + w, h: t.size * 0.95 }; };
    const numberOf = mid => { const i = plan.measures.findIndex(m => m.id === mid); const sm = (score.measures || [])[i]; return sm ? sm.number : plan.measures[i].number; };
    if (p.numbers !== false) {
      const mById = new Map(eng.measures.map(m => [m.id, m]));
      eng.systems.forEach(sys => {
        const top = sys.staves[0].y * U;
        const sky = skyBySys.get(sys.index);
        sys.measures.forEach((mid, k) => {
          const m = mById.get(mid);
          const t = { kind: 'bar', text: String(numberOf(mid)), x: (k === 0 ? sys.x : m.x) * U + 3, y: top - 9, size: 12, family: 'mono', weight: '500', stroke: 0.6,
            anchor: 'start', row: sys.index };
          const s = span(t);
          /* floor: where it stands when nothing is in the way - 9 px over the top line, unchanged (floor - PAD = top -
             6.6, the same default box textBox() always gave); PAD past whatever the skyline says is closer when it is
             closer than that - real glyph metrics run a little past the box textBox() estimates for them, so a plain
             0-clearance push can still touch in a real renderer; PAD gives that margin (G4-D2-19) */
          const PAD = 2.5;
          const box = sky.put({ x0: s.x0, x1: s.x1, h: s.h, side: 'above', pad: PAD, floor: top - 6.6 + PAD });
          t.y = box[3] - t.size * 0.2;
          out.push(t);
        });
      });
    }
    if (p.heading === true && p.perRow) {
      const W = pageW;
      if (score.title) out.push({ kind: 'title', text: String(score.title), x: W / 2, y: -38, size: 26, family: 'serif', weight: '400', anchor: 'middle', row: 0 });
      if (score.composer) out.push({ kind: 'composer', text: String(score.composer), x: W - 4, y: -16, size: 15, family: 'serif', weight: '500', anchor: 'end',
        stroke: 0.7, row: 0 });
    }
    if (p.guidance && groups) {
      const staffKey = new Map(plan.staves.map((s, i) => [s.number || i + 1, s.id]));
      const objs = new Map();
      eng.objects.forEach(o => { if (o.event) { const k = o.event + '|' + o.staffKey; if (!objs.has(k)) objs.set(k, []); objs.get(k).push(o); } });
      const sysStaff = new Map();
      eng.systems.forEach(s => s.staves.forEach(st => sysStaff.set(s.index + '|' + st.key, st)));
      groups.forEach(g => {
        if (g.rest || !g.letter) return;
        const list = objs.get(g.ev + '|' + staffKey.get(g.staff)) || [];
        const heads = list.filter(o => o.kind === 'notehead');
        if (!heads.length) return;
        const st = sysStaff.get(heads[0].system + '|' + heads[0].staffKey);
        const x = heads.reduce((s, o) => s + (o.box[0] + o.box[2]) / 2, 0) / heads.length;
        /* under the note and everything it carries (a down stem too), and never inside the staff - the note's own
           reach, in px, is `floor`: where the letter starts from when nothing else is lower */
        const lowSp = Math.max(st ? st.y + st.h : 0, ...list.map(o => o.box[3]));
        const t = { kind: 'guide', text: g.letter, x: x * U, y: 0, size: 9, family: 'mono', weight: '400', anchor: 'middle', row: heads[0].system };
        const s = span(t);
        const sys = eng.systems[heads[0].system];
        /* the staff below (if any), a hard limit: the skyline may still report something closer than the note's own
           reach (a dynamic, a hairpin, fingering between the staves) and put() will stand outside that too, but never
           past this - if the room between the note and the staff below is too small for the letter, it keeps its
           unpushed spot (G4-D2-7) rather than entering that staff */
        const below = sys.staves.filter(s2 => st && s2.y > st.y).map(s2 => s2.y * U);
        const hardLimit = below.length ? Math.min(...below) - 2 : null;
        const PAD = 2.5;
        const floor = lowSp * U + 5.85 - PAD;
        const sky = skyBySys.get(heads[0].system);
        const box = sky.put({ x0: s.x0, x1: s.x1, h: s.h, side: 'below', pad: PAD, floor: floor });
        /* the room between the note and the staff below may be too tight for the full push (dense grand-staff hymn
           writing): standing exactly on the boundary can still land inside the staff below's own notes (ledger lines
           reach up past its top line), so - as before the fix - it keeps its unpushed spot rather than guessing (a named,
           tracked residual: eg.page.annotation_overlap, G4-D2-19, §37.1) */
        t.y = (hardLimit !== null && box[3] > hardLimit) ? (floor + PAD) + t.size * 0.75 : box[1] + t.size * 0.75;
        out.push(t);
      });
    }
    return out;
  }
  const FAMILY = { mono: "'JetBrains Mono', monospace", serif: "'Instrument Serif', Georgia, serif" };

  /* ------------------------------------------------------------------ the view (browser) */
  function createView(env) {
    stats.views++;
    const doc = browser.document;
    const fellBack = new WeakMap();      /* score -> the code it fell back with: legacy for that song from then on */
    let st = null;                       /* {score, src, pending, error, ident} */
    let drawn = null;                    /* {key, el, svg, eng, plan, map, sync, segs, over} */
    const counters = env.stats || stats;

    function fail(score, code, err) {
      if (env.strict && env.strict()) {
        const e = new Error('[ppp] engrave ' + code + (err && err.message ? ': ' + err.message : ''));
        e.code = code; e.cause = err;
        throw e;
      }
      counters.fallbacks[code] = (counters.fallbacks[code] || 0) + 1;
      const id = (score && score.id) || '?';
      counters.bySong[id] = code;
      if (counters !== stats) { stats.fallbacks[code] = (stats.fallbacks[code] || 0) + 1; stats.bySong[id] = code; }
      if (score) fellBack.set(score, code);
      drawn = null;
      try { browser.console.warn('[ppp] engrave fallback', code, err && err.message ? err.message : ''); } catch (e) { /* no console */ }
      return 'legacy';
    }
    function placeholder(el) {
      if (el.firstChild && el.firstChild.getAttribute && el.firstChild.getAttribute('data-engrave-wait')) return;
      el.innerHTML = '';
      const d = doc.createElement('div');
      d.setAttribute('data-engrave-wait', '1');
      d.style.cssText = 'min-height:120px;display:grid;place-items:center;font-size:12px;color:var(--ink3);';
      d.textContent = 'Engraving…';
      el.appendChild(d);
      drawn = null;
    }
    function sourceFor(score) {
      if (st && st.score === score) return st;
      st = { score: score, src: null, pending: true, error: null, ident: new WeakMap() };
      const mine = st;
      const t0 = now();
      let p;
      try { p = env.source().resolve(score, { key: env.songKey ? env.songKey(score) : null }); }
      catch (e) { p = Promise.reject(e); }
      p.then(src => { mine.src = src; mine.pending = false; mine.resolveMs = now() - t0; },
        e => { mine.error = e || new Error('resolve failed'); mine.pending = false; })
        .then(() => { if (st === mine && env.repaint) env.repaint(); });
      return st;
    }

    function paint(el, p) {
      stats.paints++;
      const score = p.score;
      if (!score || !el) return 'legacy';
      if (fellBack.has(score)) return 'legacy';
      /* a reduced drawing the engraver does not make - no clefs, one staff of several: the legacy renderer's */
      if (p.clefs === false || (p.grand === false && (score.staves || 1) > 1)) { stats.routed++; return 'legacy'; }
      let stage = 'SOURCE';
      try {
        const s = sourceFor(score);
        if (s.pending) { stats.pending++; if (!drawn || drawn.el !== el || drawn.score !== score) placeholder(el); return 'pending'; }
        if (s.error) return fail(score, 'SOURCE_THREW', s.error);
        const src = s.src;
        /* why, in the warning: the source's first diagnostic (the comparator's first difference, a refused projection) */
        const why = () => new Error(JSON.stringify((src && src.diagnostics && src.diagnostics[0]) || null).slice(0, 300));
        if (!src || src.via === 'none' || !src.graph) return fail(score, 'SOURCE_NONE', why());
        if (!src.agree || !src.agree.ok) return fail(score, 'SOURCE_DISAGREES', why());
        if (!src.link || !src.link.ok) return fail(score, 'LINK_FAILED', new Error(JSON.stringify(src.link && src.link.mismatch || null).slice(0, 300)));
        stage = 'PLAN';
        const sem = semanticConfig(p);
        const g = graphEntry(src);
        const pe = planEntry(g, sem);
        stage = 'LAYOUT';
        const cfg = layoutConfig(p, score, env.viewport ? env.viewport() : 1280);
        const key = viewKey(g.key, pe.plan.version, sem, cfg, p);
        if (!drawn || drawn.key !== key || drawn.el !== el || drawn.score !== score || !el.contains(drawn.svg)) {
          draw(el, p, src, s, pe, cfg, key);
        }
        stage = 'SYNC';
        dress(el, p);
        drawn.sync.update(p);
        overlays(p);
        return 'drawn';
      } catch (e) {
        return fail(score, stage + '_THREW', e);
      }
    }

    function draw(el, p, src, s, pe, cfg, key) {
      const T = { t0: now() };
      const plan = pe.plan;
      const lk = LY.VERSION + '|' + CN.canonical(cfg);
      const before = pe.engraver.stats.layouts;
      const eng = pe.engraver.layout(cfg);
      if (pe.engraver.stats.layouts > before) stats.layouts++; else stats.layoutHits++;
      T.layout = now();
      let text = pe.svgs.get(lk);
      if (text === undefined) { text = pe.svgs.set(lk, SV.svg(eng, plan, SVG_OPTS)); stats.svgs++; } else stats.svgHits++;
      let map = pe.maps.get(lk);
      if (map === undefined) { map = pe.maps.set(lk, PR.createPracticeMap(eng, plan)); stats.maps++; }
      T.svg = now();
      el.innerHTML = text;
      const svg = el.querySelector('svg');
      T.insert = now();
      let ident = s.ident.get(plan);
      if (!ident) { ident = SRC.identity(s.score, src, plan); s.ident.set(plan, ident); }
      const items = [];
      svg.querySelectorAll('g.ppp-note').forEach(e => {
        const on = (e.getAttribute('data-onset') || '').split('|');
        items.push({ el: e, ev: e.getAttribute('data-ev'), staff: +on[2] || 1, rest: e.getAttribute('data-rest') === '1' });
      });
      const groups = groupsFor(items, s.score, ident, env.noteEnd);
      drawn = { key: key, el: el, score: s.score, svg: svg, eng: eng, plan: plan, map: map, src: src, cfg: cfg, groups: groups, sync: createSync(groups) };
      decorate(svg, p, eng, plan, map, groups, src, cfg);
      T.end = now();
      stats.draws++;
      stats.last = { layout: T.layout - T.t0, svg: T.svg - T.layout, insert: T.insert - T.svg, decorate: T.end - T.insert, total: T.end - T.t0,
        resolve: s.resolveMs == null ? null : s.resolveMs, via: src.via, notes: groups.length, bytes: text.length };
      keep(stats.drawTimes, stats.last, 200);
    }

    /* the page's own marks over the engraving, in px (G04 §16.4, §16.6) */
    function decorate(svg, p, eng, plan, map, groups, src, cfg) {
      const U = UNIT;
      const score = drawn.score;
      const mk = (tag, attrs) => { const e = doc.createElementNS(NS, tag); Object.keys(attrs).forEach(a => e.setAttribute(a, attrs[a])); return e; };
      svg.querySelectorAll('g.ppp-system').forEach(g => g.setAttribute('data-ppp-row', g.getAttribute('data-system')));
      /* the engraver's words are labels too: the theme's ink, like the legacy renderer's labels (not those in a note's group,
         which take the note's colour) */
      svg.querySelectorAll('text').forEach(t => { if (!t.closest('.ppp-note, .ppp-grace')) t.classList.add('ppp-ann'); });
      /* measures in the Score's numbers, in px */
      const segs = map.measures.map(m => {
        const sm = (score.measures || [])[m.index];
        const sys = map.systems[m.system];
        return { number: sm ? sm.number : +m.number, system: m.system, x: m.box[0] * U, w: (m.box[2] - m.box[0]) * U, band: [m.box[1] * U, m.box[3] * U],
          top: Math.min(sys.box[1], sys.band[0]) * U, bottom: Math.max(sys.box[3], sys.band[1]) * U, startQ: m.startQ, lenQ: m.lenQ, m: m };
      });
      /* text */
      const texts = annotations(eng, plan, score, p, groups);
      texts.forEach(t => {
        const e = mk('text', { class: 'ppp-ann', x: +t.x.toFixed(2), y: +t.y.toFixed(2), 'font-size': t.size, 'font-family': FAMILY[t.family], fill: 'currentColor',
          'data-ppp-row': t.row, 'data-ann': t.kind });
        if (t.anchor !== 'start') e.setAttribute('text-anchor', t.anchor);
        if (t.weight) e.setAttribute('font-weight', t.weight);
        if (t.stroke) { e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', t.stroke); e.setAttribute('paint-order', 'stroke fill'); }
        e.textContent = t.text;
        svg.appendChild(e);
      });
      /* the page: the engraving and the text over it */
      const W = eng.pages[0].w * U, H = eng.pages[0].h * U;
      let top = 0, bottom = H;
      texts.forEach(t => { const b = textBox(t); top = Math.min(top, Math.floor(b[1] - 4)); bottom = Math.max(bottom, Math.ceil(b[3] + 4)); });
      svg.setAttribute('viewBox', '0 ' + top + ' ' + W + ' ' + (bottom - top));
      svg.setAttribute('height', bottom - top);
      const wrapping = !!p.perRow;
      svg.style.display = 'block';
      svg.style.height = 'auto';
      svg.style.overflow = 'visible';
      if (p.fluid) { svg.setAttribute('width', '100%'); svg.style.width = '100%'; }
      else svg.style.width = Math.round(W * (!wrapping && p.zoom > 0 ? p.zoom : 1)) + 'px';
      svg.style.maxWidth = (wrapping && p.fluid) ? '1320px' : '100%';
      if (wrapping && p.fluid) svg.style.margin = '0 auto';

      /* behind the notes: the weak bars, the loop box, the current measure (the legacy renderer's marks and numbers) */
      const onPaper = p.paper !== false;
      if (p.weak && p.weak.length) {
        const want = new Set(p.weak);
        segs.forEach(s => {
          if (!want.has(s.number)) return;
          const r = mk('rect', { x: s.x - 2, y: s.band[0], width: s.w + 4, height: s.band[1] - s.band[0], rx: 7, opacity: onPaper ? 0.15 : 0.22 });
          r.style.fill = onPaper ? 'rgb(214,64,52)' : 'var(--bad)';
          r.setAttribute('data-weak', s.number);
          svg.insertBefore(r, svg.firstChild);
        });
      }
      const nowFill = onPaper ? 'rgba(96,74,220,.16)' : 'var(--accent-3)';
      const nowLine = onPaper ? 'rgba(96,74,220,.55)' : 'var(--accent-2)';
      const accent = onPaper ? 'rgb(96,74,220)' : 'var(--accent)';
      const loop = mk('rect', { fill: 'none', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', rx: 10, opacity: 0 });
      loop.style.stroke = nowLine;
      const hl = mk('rect', { class: 'ppp-now', 'stroke-width': 1.5, rx: 8, opacity: 0 });
      hl.style.fill = nowFill; hl.style.stroke = nowLine;
      svg.insertBefore(loop, svg.firstChild);
      svg.insertBefore(hl, svg.firstChild);
      if (p.pick) pointer(svg, segs, nowLine);
      const ph = mk('line', { 'stroke-width': 2.5, opacity: 0 });
      ph.style.stroke = accent;
      const dot = mk('circle', { r: 5, opacity: 0 });
      dot.style.fill = accent;
      svg.appendChild(ph);
      svg.appendChild(dot);
      drawn.segs = segs;
      drawn.over = { hl: hl, loop: loop, ph: ph, dot: dot };

      /* for the checks, in the legacy renderer's shape (G04 §16.4) */
      const rows = eng.systems.map(sys => sys.measures.map(mid => segs.find(s => s.m.id === mid)).filter(Boolean).map(s => s.number));
      svg.__ppp = {
        page: W, pad: 0, rows: rows,
        tight: segs.map(s => Math.round(s.w)),
        begin: segs.map(s => Math.round((s.m.content[0] * U) - s.x)),
        bars: segs.map(s => ({ m: s.number, row: s.system, x: s.x, y: s.top, w: s.w })),
        engraved: {
          version: VERSION, engr: eng.version, plan: plan.version, planKey: eng.planKey, via: src.via, producer: src.producer || null, config: cfg,
          ledger: plan.summary, diagnostics: eng.diagnostics.length, notes: groups.length,
          get hash() { return CN.hash(eng); }
        }
      };
    }

    /* the page is the control (App ScoreView): a click reports the bar and beat under the pointer, a sideways drag a
       range; a vertical drag scrolls (touch-action pan-y). The same thresholds and events as the legacy renderer's (A34). */
    function pointer(svg, segs, nowLine) {
      svg.style.cursor = 'pointer';
      svg.style.touchAction = 'pan-y';
      const hover = doc.createElementNS(NS, 'rect');
      hover.setAttribute('fill', 'none'); hover.setAttribute('stroke-width', 1.5); hover.setAttribute('rx', 8); hover.setAttribute('opacity', 0);
      hover.style.stroke = nowLine;
      hover.style.pointerEvents = 'none';
      svg.insertBefore(hover, svg.firstChild);
      const qIn = (s, x) => {
        const pts = s.m.columns.map(c => [c.b, c.x * UNIT]);
        const len = Math.max(0.001, s.lenQ || 1);
        if (!pts.length) return Math.max(0, Math.min(len, (x - s.x) / Math.max(0.001, s.w) * len));
        if (x <= pts[0][1]) return pts[0][0];
        const end = [Math.max(len, pts[pts.length - 1][0] + 1e-3), s.x + s.w];
        for (let j = 0; j < pts.length; j++) {
          const a = pts[j], b = j + 1 < pts.length ? pts[j + 1] : end;
          if (x < b[1] || j + 1 >= pts.length) {
            const f = (x - a[1]) / Math.max(1e-6, b[1] - a[1]);
            return Math.max(0, Math.min(len, a[0] + Math.max(0, Math.min(1, f)) * (b[0] - a[0])));
          }
        }
        return len;
      };
      const hit = ev => {
        let pt;
        try {
          pt = svg.createSVGPoint();
          pt.x = ev.clientX; pt.y = ev.clientY;
          pt = pt.matrixTransform(svg.getScreenCTM().inverse());
        } catch (e) { return null; }
        const s = segs.filter(g => pt.x >= g.x - 8 && pt.x <= g.x + g.w + 8 && pt.y >= g.top && pt.y <= g.bottom)[0] || null;
        if (!s) return null;
        const inner = Math.max(0, Math.min(s.lenQ - 1e-4, qIn(s, pt.x)));
        return { seg: s, q: s.startQ + inner };
      };
      const outline = s => {
        if (!s) { hover.setAttribute('opacity', 0); return; }
        hover.setAttribute('x', s.x - 4); hover.setAttribute('y', s.band[0] - 4);
        hover.setAttribute('width', s.w + 8); hover.setAttribute('height', s.band[1] - s.band[0] + 8);
        hover.setAttribute('opacity', 1);
      };
      const send = e => { const fn = env.props && env.props().pick; if (fn) fn(e); };
      let from = null, last = null, downY = 0, downX = 0, mode = null;
      svg.addEventListener('pointerdown', ev => {
        const h = hit(ev);
        if (!h || ev.button > 0) return;
        from = h.seg.number; last = h; downY = ev.clientY; downX = ev.clientX; mode = null;
      });
      svg.addEventListener('pointermove', ev => {
        const h = hit(ev);
        outline(h && h.seg);
        if (from == null) return;
        const dx = Math.abs(ev.clientX - downX), dy = Math.abs(ev.clientY - downY);
        if (mode == null) {
          if (dx < 12 && dy < 12) return;
          if (dy > dx) { mode = 'pan'; from = null; last = null; return; }
          mode = 'pick';
          try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* not captured */ }
          send({ from: from, to: from, q: last.q, extend: ev.shiftKey, phase: 'start' });
        }
        if (mode !== 'pick' || !h) return;
        last = h;
        send({ from: from, to: h.seg.number, q: h.q, extend: ev.shiftKey, phase: 'move' });
      });
      svg.addEventListener('pointerup', ev => {
        if (from != null && last && mode !== 'pan') send({ from: from, to: last.seg.number, q: last.q, extend: !!(ev && ev.shiftKey), phase: 'end' });
        from = null; last = null; mode = null;
      });
      svg.addEventListener('pointercancel', () => { from = null; last = null; mode = null; });
      svg.addEventListener('pointerleave', () => { if (from == null) outline(null); });
    }

    /* the theme (A33): ink, staff lines and paper are CSS variables, so a theme or paper change needs no drawing */
    function dress(el, p) {
      const onPaper = p.paper !== false;
      /* only when it changes: setting a custom property, even to its value, restyles the whole score (every frame, ~20 ms on
         sonatina/020 - measured) */
      if (drawn.dressed === onPaper && drawn.dressedEl === el) return;
      drawn.dressed = onPaper; drawn.dressedEl = el;
      el.style.setProperty('--score-ink', onPaper ? 'var(--paper-ink, var(--ink))' : 'var(--ink)');
      el.style.setProperty('--score-staff', onPaper ? 'var(--paper-staff, var(--staff))' : 'var(--staff)');
      drawn.svg.style.background = onPaper ? 'var(--paper)' : 'transparent';
    }

    /* the current measure, the loop box and the playhead (App sync, on the practice map); an attribute is written only when its
       value changes */
    function overlays(p) {
      const o = drawn.over, segs = drawn.segs;
      const was = drawn.overVals || (drawn.overVals = new Map());
      const set = (e, name, attrs) => Object.keys(attrs).forEach(k => {
        const kk = name + k, v = String(attrs[k]);
        if (was.get(kk) === v) return;
        was.set(kk, v);
        e.setAttribute(k, v);
      });
      const cm = p.currentM != null ? segs.filter(s => s.number === p.currentM)[0] : null;
      if (cm) set(o.hl, 'h', { x: cm.x - 4, y: cm.band[0], width: cm.w, height: cm.band[1] - cm.band[0], opacity: 1 });
      else set(o.hl, 'h', { opacity: 0 });
      const a = p.loopFrom != null ? segs.filter(s => s.number >= p.loopFrom)[0] : null;
      const bs = p.loopTo != null ? segs.filter(s => s.number <= p.loopTo) : [];
      const b = bs.length ? bs[bs.length - 1] : null;
      if (a && b && a.system === b.system && b.x + b.w > a.x) {
        set(o.loop, 'l', { x: a.x - 6, y: a.band[0] - 6, width: (b.x + b.w) - a.x + 12, height: a.band[1] - a.band[0] + 12, opacity: 1 });
      } else set(o.loop, 'l', { opacity: 0 });
      const q = p.playX;
      const s = q != null ? segs.filter(g => q >= g.startQ - 1e-9 && q < g.startQ + g.lenQ)[0] : null;
      if (s) {
        const x = drawn.map.xAt(s.m, q - s.startQ) * UNIT;
        set(o.ph, 'p', { x1: x, x2: x, y1: s.band[0], y2: s.band[1], opacity: 1 });
        set(o.dot, 'd', { cx: x, cy: s.band[0], opacity: 1 });
      } else {
        set(o.ph, 'p', { opacity: 0 });
        set(o.dot, 'd', { opacity: 0 });
      }
    }

    return {
      paint: paint,
      /* what is on the page now, for the checks */
      get drawn() { return drawn; },
      get source() { return st ? st.src : null; }
    };
  }

  return Object.freeze({
    VERSION, UNIT, SVG_OPTS, stats,
    semanticConfig, layoutConfig, drawKey, viewKey, createSync, legacyClasses, groupsFor, annotations, createView, lru
  });
});
