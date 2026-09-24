/* ============================================================================
   PPP engrave — the NotationPlan (docs/GOALS/G04 §8.3, G4-D7)

   plan(graph, config) -> NotationPlan

   What must be drawn, and nothing about where: no coordinate, no width, no
   system. Every object keeps its graph ID, so the practice layer (highlight,
   seek, wrong-note feedback) and the geometry to come (EngravedScore, G4b)
   can find it again. Every notation object of the graph gets exactly one
   ledger entry (ledger.js audit() checks that against an independent
   inventory): drawn, derived, merged, suppressed or deferred, with a code
   when it is not simply drawn.

   Pure: the graph is only read (A13). Deterministic: every list is in graph
   order, derived objects have IDs made from graph IDs (A27). JSON-safe: the
   plan serialises; the object index used by the audit is not enumerable.

   config (all optional):
     mode                 'screen' (default) | 'print'
     fingering, chords,   draw printed fingering / chord symbols / pedal,
     marks                8va and dynamics (default true each)
     respectSourceBreaks  honour the source's system and page breaks (false)
     deriveBeams          beam voice-measures the graph does not beam (true)
     oneNoteTupletMerge   G4-U2 B display grouping (true)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('./ledger.js'), require('./plan-beams.js'), require('./plan-tuplets.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.plan = factory(root.PPPScoreGraph, M.ledger, M.planBeams, M.planTuplets);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, L, PB, PT) {
  'use strict';

  const PLAN_VERSION = 'plan/1';
  const R = SG.rational, S = SG.schema, P = SG.pitch, MG = SG.meterGrid;
  const DEFAULTS = Object.freeze({ mode: 'screen', fingering: true, chords: true, marks: true, respectSourceBreaks: false,
    deriveBeams: true, oneNoteTupletMerge: true });
  /* ornaments with a glyph the renderer has (VexFlow Ornament and Tremolo); the others are deferred */
  const DRAWN_ORNAMENTS = new Set(['trill', 'mordent', 'inverted-mordent', 'turn', 'inverted-turn', 'tremolo']);
  /* a clef's line when the canonical graph leaves it out (serialize.js CLEF_LINE) */
  const CLEF_LINE = { G: 2, F: 4, C: 3, TAB: 5 };

  function plan(g, config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const ledger = [], diagnostics = [];
    const index = new Set();
    const put = (en) => { if (en.code === undefined) delete en.code; ledger.push(en); };
    const diag = (code, refs, detail) => diagnostics.push({ code: code, refs: refs || [], detail: detail === undefined ? null : detail });
    const has = x => x !== undefined && x !== null;

    /* ---------------------------------------------------------- timeline */
    const tl = g.timeline;
    const mIdx = new Map(tl.measures.map((m, i) => [m.id, i]));
    const mStart = [];
    { let acc = R.ZERO; tl.measures.forEach(m => { mStart.push(acc); acc = R.add(acc, R.parse(m.dur)); }); }
    const absOf = pos => R.add(mStart[mIdx.get(pos.m)] || R.ZERO, R.parse(pos.at));
    const grids = new Map();
    const gridOf = m => {
      if (!grids.has(m)) { let gr = null; try { gr = MG.grid(g, m); } catch (e) { gr = null; } grids.set(m, gr); }
      return grids.get(m);
    };

    const meta = {};
    L.META_FIELDS.forEach(f => {
      const v = g.meta && g.meta[f];
      if (v === undefined || v === '') return;
      meta[f] = v;
      const drawn = f === 'title' || f === 'composer';
      put({ ref: L.ref.meta(f), kind: 'meta', status: drawn ? 'drawn' : 'deferred', code: drawn ? undefined : 'title-block', plan: drawn ? 'meta' : undefined });
    });
    index.add('meta');

    const measures = tl.measures.map((m, i) => {
      const x = { id: m.id, number: m.number, index: i, start: R.format(mStart[i]), dur: m.dur, implicit: !!m.implicit,
        multiRest: m.multiRest || null, barline: m.barline || null, layoutBreak: null };
      index.add(m.id);
      put({ ref: m.id, kind: 'measure', status: 'drawn', plan: m.id });
      if (m.multiRest) put({ ref: L.ref.multiRest(m.id), kind: 'multi-rest', status: cfg.mode === 'print' ? 'drawn' : 'suppressed',
        code: cfg.mode === 'print' ? undefined : 'screen-draws-each-bar', plan: cfg.mode === 'print' ? m.id : undefined });
      if (m.layout && (m.layout.newSystem || m.layout.newPage)) {
        x.layoutBreak = { newSystem: !!m.layout.newSystem, newPage: !!m.layout.newPage };
        put({ ref: L.ref.layoutBreak(m.id), kind: 'layout-break', status: cfg.respectSourceBreaks ? 'drawn' : 'suppressed',
          code: cfg.respectSourceBreaks ? undefined : 'source-break-not-honored', plan: cfg.respectSourceBreaks ? m.id : undefined });
      }
      ['left', 'right'].forEach(side => {
        const b = m.barline && m.barline[side];
        if (!b) return;
        if (b.style !== undefined || b.repeat !== undefined) put({ ref: L.ref.barline(m.id, side), kind: 'barline', status: 'drawn', plan: m.id });
        if (b.fermata !== undefined) put({ ref: L.ref.barFermata(m.id, side), kind: 'fermata', status: 'drawn', plan: m.id });
      });
      return x;
    });
    const meters = tl.meters.map(x => {
      index.add(x.id);
      put({ ref: x.id, kind: 'meter', status: x.hidden ? 'suppressed' : 'drawn', code: x.hidden ? 'hidden' : undefined, plan: x.id });
      return { id: x.id, m: x.m, beats: x.beats.slice(), beatType: x.beatType, symbol: x.symbol || null, groups: x.groups ? x.groups.slice() : null, hidden: !!x.hidden };
    });
    const keys = (tl.keys || []).map(x => {
      index.add(x.id);
      put({ ref: x.id, kind: 'key', status: x.hidden ? 'suppressed' : 'drawn', code: x.hidden ? 'hidden' : undefined, plan: x.id });
      return { id: x.id, m: x.m, at: x.at, fifths: x.fifths, mode: x.mode || null, hidden: !!x.hidden, scope: x.scope || null };
    });
    const tempos = (tl.tempos || []).map(x => {
      index.add(x.id);
      put({ ref: x.id, kind: 'tempo', status: x.mark ? 'drawn' : 'suppressed', code: x.mark ? undefined : 'sound-only', plan: x.id });
      return { id: x.id, m: x.m, at: x.at, qpm: x.qpm || null, mark: x.mark || null, printed: !!x.mark };
    });
    const endings = (tl.endings || []).map(x => {
      index.add(x.id);
      put({ ref: x.id, kind: 'ending', status: 'drawn', plan: x.id });
      return { id: x.id, numbers: x.numbers.slice(), text: has(x.text) ? x.text : null, from: x.from, to: x.to, open: !!x.open };
    });
    const jumps = (tl.jumps || []).map(x => {
      index.add(x.id);
      put({ ref: x.id, kind: 'jump', status: 'drawn', plan: x.id });
      return { id: x.id, kind: x.kind, m: x.m, at: x.at, text: has(x.text) ? x.text : null };
    });

    /* ------------------------------------------------------------- parts */
    const eventById = new Map();
    g.parts.forEach(p => p.events.forEach(e => eventById.set(e.id, e)));
    /* a graph whose notation PPP worked out (a transcription, a MIDI file): its ties are marked inferred, and drawn (G4-U2 A) */
    const ctx = { config: cfg, eventById: eventById, grids: grids, gridOf: gridOf, diag: diag, inferred: SG.legacy.inferredNotation(g) };

    const parts = [], staves = [], voices = [], clefs = [], events = [], roles = [];
    const ties = [], slurs = [], lines = [], marks = [];
    let staffNo = 0;
    g.parts.forEach(part => {
      index.add(part.id);
      put({ ref: part.id, kind: 'part', status: 'drawn', plan: part.id });
      parts.push({ id: part.id, name: has(part.name) ? part.name : null, instrument: part.instrument.kind, staves: part.staves.map(s => s.id) });
      const tr = part.instrument && part.instrument.transpose;
      part.staves.forEach(s => {
        staffNo++;
        index.add(s.id);
        const tab = s.kind === 'tab';
        put({ ref: s.id, kind: 'staff', status: tab ? 'deferred' : 'drawn', code: tab ? 'tab' : undefined, plan: s.id });
        staves.push({ id: s.id, part: part.id, number: staffNo, kind: s.kind || 'standard', lines: has(s.lines) ? s.lines : 5 });
        if (!part.clefs.some(c => c.staff === s.id && c.m === tl.measures[0].id && R.isZero(R.parse(c.at))))
          diag('CLEF_MISSING', [s.id], 'no clef at the start: the layout chooses one');
      });
      const voiceOrder = new Map(), voiceById = new Map(part.voices.map(v => [v.id, v]));
      part.voices.forEach((v, i) => {
        index.add(v.id);
        put({ ref: v.id, kind: 'voice', status: 'drawn', plan: v.id });
        const n = parseInt(v.label, 10);
        voiceOrder.set(v.id, [isFinite(n) ? n : 1e6, i]);
        voices.push({ id: v.id, part: part.id, staff: v.staff, label: has(v.label) ? v.label : null });
      });
      part.clefs.forEach(c => {
        index.add(c.id);
        const st = c.sign === 'none' ? ['suppressed', 'clef-none'] : c.sign === 'TAB' ? ['deferred', 'tab'] : ['drawn'];
        put({ ref: c.id, kind: 'clef', status: st[0], code: st[1], plan: c.id });
        clefs.push({ id: c.id, staff: c.staff, m: c.m, at: c.at, sign: c.sign, line: has(c.line) ? c.line : (CLEF_LINE[c.sign] || null), octave: c.octave || 0 });
      });

      /* ---- the 8va spans of this part, as absolute positions: an event is written shifted when it starts inside */
      const octaves = part.spanners.filter(s => s.type === 'ottava' && s.from && s.to).map(s => ({
        staff: s.staff || null, shift: s.shift, a: absOf(s.from), z: absOf(s.to) }));
      const shiftOf = (e, staffId) => {
        const t = R.add(mStart[mIdx.get(e.m)], R.parse(e.at));
        let k = 0;
        octaves.forEach(o => { if ((o.staff === null || o.staff === staffId) && !R.lt(t, o.a) && R.lt(t, o.z)) k = o.shift; });
        return k;
      };

      /* ---- voice roles per staff and measure: the graph's voice order, never the pitch (§14.1) */
      const vm = new Map();
      part.events.forEach(e => {
        if (e.grace || e.hidden || e.kind === 'rest') return;
        const k = e.staff + '|' + e.m;
        if (!vm.has(k)) vm.set(k, new Set());
        vm.get(k).add(e.voice);
      });
      const roleOf = new Map();
      vm.forEach((set, k) => {
        const order = [...set].sort((a, b) => voiceOrder.get(a)[0] - voiceOrder.get(b)[0] || voiceOrder.get(a)[1] - voiceOrder.get(b)[1]);
        const role = {};
        order.forEach((v, i) => { role[v] = order.length === 1 ? 'single' : i % 2 === 0 ? 'up' : 'down'; });
        const [staff, m] = k.split('|');
        roles.push({ staff: staff, m: m, voices: order, role: role });
        order.forEach(v => roleOf.set(k + '|' + v, role[v]));
      });

      /* ---- events and heads */
      part.events.forEach(e => {
        index.add(e.id);
        const kind = e.grace ? 'grace' : e.kind === 'rest' ? 'rest' : e.kind === 'perc' ? 'perc' : 'note';
        const hid = !!e.hidden;
        const sub = (r, k, extra) => put(Object.assign({ ref: r, kind: k, status: hid ? 'suppressed' : 'drawn', code: hid ? 'hidden-event' : undefined, plan: e.id }, extra || {}));
        put({ ref: e.id, kind: kind, status: hid ? 'suppressed' : 'drawn', code: hid ? 'hidden' : undefined, plan: e.id });
        const d = e.display || {};
        let stem = 'auto', stemFrom = 'auto';
        if (e.kind === 'rest') { stem = 'none'; stemFrom = 'rest'; }
        else if (d.stem === 'up' || d.stem === 'down' || d.stem === 'none') { stem = d.stem; stemFrom = 'graph'; }
        else if (d.stem === 'double') { stem = 'up'; stemFrom = 'graph'; }
        else {
          const role = roleOf.get(e.staff + '|' + e.m + '|' + e.voice);
          if (role === 'up' || role === 'down') { stem = role; stemFrom = 'voice'; }
        }
        if (d.stem !== undefined) {
          if (d.stem === 'double') put({ ref: L.ref.stem(e.id), kind: 'stem', status: 'deferred', code: 'stem-double', plan: e.id });
          else sub(L.ref.stem(e.id), 'stem');
        }
        if (d.pos !== undefined) sub(L.ref.restPos(e.id), 'rest-position');
        if (d.measureRest) sub(L.ref.measureRest(e.id), 'measure-rest');
        if (d.size !== undefined) sub(L.ref.size(e.id), 'size');
        if (e.hidden) put({ ref: L.ref.hidden(e.id), kind: 'hidden', status: 'suppressed', code: 'hidden', plan: e.id });
        if (e.cue) sub(L.ref.cue(e.id), 'cue');
        const v = voiceById.get(e.voice);
        if (v && v.staff !== e.staff) sub(L.ref.eventStaff(e.id), 'cross-staff-event');
        (e.arts || []).forEach((a, i) => sub(L.ref.art(e.id, i), 'articulation'));
        (e.orn || []).forEach((o, i) => {
          if (DRAWN_ORNAMENTS.has(o.type)) sub(L.ref.orn(e.id, i), 'ornament');
          else put({ ref: L.ref.orn(e.id, i), kind: 'ornament', status: 'deferred', code: 'ornament-glyph', plan: e.id });
        });
        if (e.fermata !== undefined) sub(L.ref.fermata(e.id), 'fermata');
        (e.lyrics || []).forEach((l, i) => sub(L.ref.lyric(e.id, i), 'lyric'));

        const heads = (e.heads || []).map(h => {
          index.add(h.id);
          const staffId = h.staff || e.staff;
          put({ ref: h.id, kind: 'head', status: hid ? 'suppressed' : 'drawn', code: hid ? 'hidden-event' : undefined, plan: h.id });
          let written = null;
          if (h.pitch) {
            const w = tr ? P.written(h.pitch, tr) : h.pitch;
            written = { step: w.step, alter: w.alter || 0, oct: w.oct - shiftOf(e, staffId) };
          } else if (h.pos) written = { step: h.pos.step, alter: 0, oct: h.pos.oct };
          if (h.acc !== undefined) put({ ref: L.ref.acc(h.id), kind: 'accidental', status: hid ? 'suppressed' : 'drawn', code: hid ? 'hidden-event' : undefined, plan: h.id });
          (h.fingering || []).forEach((f, i) => put({ ref: L.ref.fingering(h.id, i), kind: 'fingering',
            status: hid || !cfg.fingering ? 'suppressed' : 'drawn', code: hid ? 'hidden-event' : !cfg.fingering ? 'config-off' : undefined, plan: h.id }));
          if (h.notehead !== undefined) put({ ref: L.ref.notehead(h.id), kind: 'notehead', status: hid ? 'suppressed' : 'drawn', code: hid ? 'hidden-event' : undefined, plan: h.id });
          const cross = h.staff !== undefined && h.staff !== e.staff;
          if (cross) put({ ref: L.ref.headStaff(h.id), kind: 'cross-staff-head', status: 'deferred', code: 'cross-staff-chord', plan: h.id });
          return { id: h.id, staff: staffId, written: written, midi: h.pitch ? P.midi(h.pitch) : null,
            acc: h.acc ? Object.assign({}, h.acc) : null, notehead: h.notehead ? Object.assign({}, h.notehead) : null,
            fingering: cfg.fingering && h.fingering ? h.fingering.map(f => Object.assign({}, f)) : [],
            inst: has(h.inst) ? h.inst : null, crossStaff: cross };
        });
        events.push({ id: e.id, part: part.id, m: e.m, at: e.at, dur: e.dur, staff: e.staff, voice: e.voice, kind: e.kind,
          grace: e.grace ? { order: e.grace.order, slash: !!e.grace.slash } : null, cue: !!e.cue, hidden: hid,
          type: d.type || null, dots: d.dots || 0, size: d.size || null, stem: stem, stemFrom: stemFrom,
          restPos: d.pos ? { step: d.pos.step, oct: d.pos.oct } : null, measureRest: !!d.measureRest,
          arts: (e.arts || []).slice(), orn: (e.orn || []).map(o => Object.assign({}, o)), fermata: e.fermata ? Object.assign({}, e.fermata) : null,
          lyrics: (e.lyrics || []).map(l => Object.assign({}, l)), heads: heads });
      });

      /* ---- directions */
      part.directions.forEach(d => {
        index.add(d.id);
        const off = d.kind === 'chord' ? !cfg.chords : d.kind === 'dynamic' ? !cfg.marks : false;
        put({ ref: d.id, kind: d.kind, status: off ? 'suppressed' : 'drawn', code: off ? 'config-off' : undefined, plan: d.id });
        const x = { id: d.id, kind: d.kind, m: d.m, at: d.at, staff: d.staff || null, voice: d.voice || null, event: d.event || null,
          placement: d.placement || null };
        if (d.kind === 'dynamic') { x.value = d.value; x.text = has(d.text) ? d.text : null; }
        if (d.kind === 'words' || d.kind === 'rehearsal') x.text = has(d.text) ? d.text : '';
        if (d.kind === 'chord') { x.root = Object.assign({}, d.root); x.chordKind = d.chordKind; x.bass = d.bass ? Object.assign({}, d.bass) : null;
          x.degrees = (d.degrees || []).map(y => Object.assign({}, y)); x.text = has(d.text) ? d.text : null; }
        marks.push(x);
      });

      /* ---- spanners other than beams and tuplets (plan-beams.js, plan-tuplets.js) */
      part.spanners.forEach(s => {
        if (s.type === 'beam' || s.type === 'tuplet') return;
        index.add(s.id);
        const open = !has(s.from) || !has(s.to);
        if (s.type === 'tie') {
          const inferred = !!((s.prov && s.prov.op === 'inferred') || ctx.inferred);
          ties.push({ id: s.id, from: s.from || null, to: s.to || null, inferred: inferred });
          put({ ref: s.id, kind: 'tie', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'slur') {
          slurs.push({ id: s.id, from: s.from || null, to: s.to || null, placement: s.placement || null, line: s.line || null });
          put({ ref: s.id, kind: 'slur', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'pedal') {
          const off = s.soundOnly ? 'sound-only' : !cfg.marks ? 'config-off' : null;
          lines.push({ id: s.id, kind: 'pedal', pedal: s.pedal, from: s.from, to: s.to || null, changes: (s.changes || []).map(c => ({ m: c.m, at: c.at })),
            mark: s.mark ? Object.assign({}, s.mark) : null, text: has(s.text) ? s.text : null, visible: !off });
          put({ ref: s.id, kind: 'pedal', status: off ? 'suppressed' : 'drawn', code: off || (open ? 'open' : undefined), plan: s.id });
          (s.changes || []).forEach((c, i) => put({ ref: L.ref.pedalChange(s.id, i), kind: 'pedal-change', status: off ? 'suppressed' : 'drawn', code: off || undefined, plan: s.id }));
        } else if (s.type === 'ottava') {
          const off = !cfg.marks;
          lines.push({ id: s.id, kind: 'ottava', shift: s.shift, staff: s.staff || null, from: s.from, to: s.to || null, visible: !off });
          put({ ref: s.id, kind: 'ottava', status: off ? 'suppressed' : 'drawn', code: off ? 'config-off' : undefined, plan: s.id });
        } else if (s.type === 'wedge') {
          lines.push({ id: s.id, kind: 'wedge', wedge: s.kind, staff: s.staff || null, from: s.from, to: s.to || null,
            placement: s.placement || null, niente: !!s.niente });
          put({ ref: s.id, kind: 'wedge', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'gliss') {
          lines.push({ id: s.id, kind: 'gliss', from: s.from || null, to: s.to || null, slide: !!s.slide, line: s.line || null,
            text: has(s.text) ? s.text : null, placement: s.placement || null });
          put({ ref: s.id, kind: 'gliss', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'arpeggio') {
          lines.push({ id: s.id, kind: 'arpeggio', heads: (s.heads || []).slice(), dir: s.dir || null, non: !!s.non });
          put({ ref: s.id, kind: 'arpeggio', status: 'drawn', plan: s.id });
        } else {
          put({ ref: s.id, kind: s.type, status: 'deferred', code: 'unknown-spanner' });
        }
      });
    });

    /* ---- beams and tuplets: the one-note groups first, so a derived beam sees a group as one tuplet */
    const pm = PT.merges(g, ctx);
    ctx.tupletGroupOf = pm.groupOf;
    const pb = PB.beams(g, ctx);
    pb.beams.forEach(b => index.add(b.id));
    pb.ledger.forEach(put);
    const pt = PT.tuplets(g, ctx, pb.beams, pm);
    pt.tuplets.forEach(t => index.add(t.id));
    pt.ledger.forEach(put);

    /* ---- analysis that is not notation */
    const st = g.structure || {};
    (st.phrases || []).forEach((x, i) => put({ ref: L.ref.phrase(i), kind: 'phrase', status: 'suppressed', code: 'analysis-only' }));
    (st.sections || []).forEach((x, i) => put({ ref: L.ref.section(i), kind: 'section', status: 'suppressed', code: 'analysis-only' }));

    /* ---- counts */
    const summary = {};
    ledger.forEach(en => {
      const k = summary[en.kind] = summary[en.kind] || { drawn: 0, derived: 0, merged: 0, suppressed: 0, deferred: 0 };
      k[en.status]++;
    });

    const out = {
      version: PLAN_VERSION,
      graph: { id: g.id, rev: g.rev, fingerprint: SG.fingerprint(g) },
      config: cfg, meta: meta,
      measures: measures, meters: meters, keys: keys, tempos: tempos, endings: endings, jumps: jumps,
      parts: parts, staves: staves, voices: voices, roles: roles, clefs: clefs,
      events: events, beams: pb.beams, tuplets: pt.tuplets, ties: ties, slurs: slurs, lines: lines, marks: marks,
      ledger: ledger, summary: summary, diagnostics: diagnostics
    };
    Object.defineProperty(out, 'index', { value: index, enumerable: false });
    return out;
  }

  /* The practice layer's name for where a note is drawn: App onsetKey (5692), "m|b|staff" with b in quarters to
     three places and the staff numbered across parts - what the legacy renderer puts in data-onset. */
  function onsetKey(p, ev, headStaff) {
    const m = p.measures.find(x => x.id === ev.m);
    const staff = p.staves.find(x => x.id === (headStaff || ev.staff));
    const n = parseInt(m ? m.number : '', 10);
    const num = isFinite(n) ? n : (m ? m.index + 1 : 0);
    return num + '|' + (R.toNumber(R.parse(ev.at)) * 4).toFixed(3) + '|' + (staff ? staff.number : 1);
  }

  return Object.freeze({ PLAN_VERSION, DEFAULTS, plan, onsetKey });
});
