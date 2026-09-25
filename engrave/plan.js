/* ============================================================================
   PPP engrave — the NotationPlan (docs/GOALS/G04 §8.3, G4-D7)

   plan(graph, config) -> NotationPlan

   What must be drawn, and nothing about where: no coordinate, no width, no
   system. Every object keeps its graph ID, so the practice layer (highlight,
   seek, wrong-note feedback) and the geometry to come (EngravedScore, G4b)
   can find it again. Every notation object of the graph gets exactly one
   ledger entry - drawn, derived, merged, suppressed, deferred (or, for what a
   projection from a legacy Score lost, projected-loss) - with a code when it
   is not simply drawn. ledger.js audit() checks the ledger against the graph
   and the output against both.

   Pure: the graph is only read, and the plan holds copies, never the graph's
   own objects (A13). Deterministic: every list is in graph order, derived
   objects have IDs made from graph IDs (A27). JSON-safe.

   config (all optional):
     mode                 'screen' (default) | 'print'
     fingering, chords,   draw printed fingering / chord symbols / pedal,
     marks                8va and dynamics (default true each)
     respectSourceBreaks  honour the source's system and page breaks (false)
     deriveBeams          beam parts the graph does not beam (true)
     oneNoteTupletMerge   G4-U2 B display grouping (true)
     projection           {unsupported: [{code, count, example}]} when the graph
                          was rebuilt from a legacy Score (RenderSource via
                          'projected'): each code becomes a projected-loss entry
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('./ledger.js'), require('./plan-beams.js'), require('./plan-tuplets.js'),
      require('./glyphs.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.plan = factory(root.PPPScoreGraph, M.ledger, M.planBeams, M.planTuplets, M.glyphs);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, L, PB, PT, GL) {
  'use strict';

  /* the plan's output contract: every change to what plan() outputs moves it (G4-D1a-1: plan/2 is G4c's one-note bracket
     default and G4d-1a's percussion kit on heads) */
  const PLAN_VERSION = 'plan/2';
  const R = SG.rational, P = SG.pitch, MG = SG.meterGrid;
  const DEFAULTS = Object.freeze({ mode: 'screen', fingering: true, chords: true, marks: true, respectSourceBreaks: false,
    deriveBeams: true, oneNoteTupletMerge: true });
  const CLEF_LINE = L.CLEF_LINE;
  /* a copy of plain JSON data: the plan never hands out the graph's own objects */
  const cp = x => (x === undefined || x === null ? null : JSON.parse(JSON.stringify(x)));

  function plan(g, config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const print = cfg.mode === 'print';
    const ledger = [], diagnostics = [];
    const put = (en) => { if (en.code === undefined || en.code === null) delete en.code; ledger.push(en); };
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

    /* the title area: title and composer on every heading; the other fields only on a printed page (§15.5) */
    const meta = {};
    L.META_FIELDS.forEach(f => {
      const v = g.meta && g.meta[f];
      if (v === undefined || v === '') return;
      meta[f] = v;
      /* the screen heading shows title and composer only; on a printed page the rest of the title area waits for
         G4e (deferred title-block, G4-U5: §15.5 names only title, composer and the first tempo) */
      const always = f === 'title' || f === 'composer';
      put({ ref: L.ref.meta(f), kind: 'meta', status: always ? 'drawn' : print ? 'deferred' : 'suppressed',
        code: always ? undefined : print ? 'title-block' : 'print-only', plan: 'meta' });
    });

    const measures = tl.measures.map((m, i) => {
      const x = { id: m.id, number: m.number, index: i, start: R.format(mStart[i]), dur: m.dur, implicit: !!m.implicit,
        multiRest: m.multiRest || null, barline: cp(m.barline), layoutBreak: null };
      put({ ref: m.id, kind: 'measure', status: 'drawn', plan: m.id });
      if (m.multiRest) put({ ref: L.ref.multiRest(m.id), kind: 'multi-rest', status: print ? 'drawn' : 'suppressed',
        code: print ? undefined : 'screen-draws-each-bar', plan: m.id });
      if (m.layout && (m.layout.newSystem || m.layout.newPage)) {
        x.layoutBreak = { newSystem: !!m.layout.newSystem, newPage: !!m.layout.newPage };
        put({ ref: L.ref.layoutBreak(m.id), kind: 'layout-break', status: cfg.respectSourceBreaks ? 'drawn' : 'suppressed',
          code: cfg.respectSourceBreaks ? undefined : 'source-break-not-honored', plan: m.id });
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
      put({ ref: x.id, kind: 'meter', status: x.hidden ? 'suppressed' : 'drawn', code: x.hidden ? 'hidden' : undefined, plan: x.id });
      return { id: x.id, m: x.m, beats: x.beats.slice(), beatType: x.beatType, symbol: x.symbol || null, groups: x.groups ? x.groups.slice() : null, hidden: !!x.hidden };
    });
    const keys = (tl.keys || []).map(x => {
      put({ ref: x.id, kind: 'key', status: x.hidden ? 'suppressed' : 'drawn', code: x.hidden ? 'hidden' : undefined, plan: x.id });
      return { id: x.id, m: x.m, at: x.at, fifths: x.fifths, mode: x.mode || null, hidden: !!x.hidden, scope: cp(x.scope) };
    });
    /* A tempo is printed when the graph gives it a mark. On screen the heading shows the tempo the piece is played
       at (the legacy renderer's "♩ = N", App 10918), so the first tempo is shown there even when it only sounds. */
    const firstTempo = (tl.tempos || []).find(x => mIdx.get(x.m) === 0 && R.isZero(R.parse(x.at)));
    const tempos = (tl.tempos || []).map(x => {
      const heading = !print && x === firstTempo && !x.mark;
      put({ ref: x.id, kind: 'tempo', status: x.mark || heading ? 'drawn' : 'suppressed',
        code: x.mark ? undefined : heading ? 'playback-tempo' : 'sound-only', plan: x.id });
      return { id: x.id, m: x.m, at: x.at, qpm: x.qpm || null, mark: cp(x.mark), display: cp(x.display), printed: !!x.mark, heading: heading };
    });
    const endings = (tl.endings || []).map(x => {
      put({ ref: x.id, kind: 'ending', status: 'drawn', plan: x.id });
      return { id: x.id, numbers: x.numbers.slice(), text: has(x.text) ? x.text : null, from: x.from, to: x.to, open: !!x.open };
    });
    const jumps = (tl.jumps || []).map(x => {
      put({ ref: x.id, kind: 'jump', status: 'drawn', plan: x.id });
      return { id: x.id, kind: x.kind, m: x.m, at: x.at, text: has(x.text) ? x.text : null, target: x.target || null, display: cp(x.display) };
    });

    /* ------------------------------------------------------------- parts */
    const eventById = new Map();
    g.parts.forEach(p => p.events.forEach(e => eventById.set(e.id, e)));
    /* a graph whose notation PPP worked out (a transcription, a MIDI file): its ties are marked inferred, and drawn (G4-U2 A) */
    const ctx = { config: cfg, eventById: eventById, grids: grids, gridOf: gridOf, diag: diag, inferred: SG.legacy.inferredNotation(g) };
    const multiPart = g.parts.length > 1;

    const parts = [], staves = [], voices = [], clefs = [], events = [], roles = [];
    const ties = [], slurs = [], lines = [], marks = [];
    let staffNo = 0;
    g.parts.forEach(part => {
      put({ ref: part.id, kind: 'part', status: 'drawn', plan: part.id });
      /* part names head the first system of a printed score of several parts (§15.5); abbreviations the others */
      const nameStatus = multiPart && print ? ['drawn'] : ['suppressed', multiPart ? 'print-only' : 'single-part'];
      if (has(part.name) && part.name !== '') put({ ref: L.ref.partName(part.id), kind: 'part-name', status: nameStatus[0], code: nameStatus[1], plan: part.id });
      if (has(part.abbr) && part.abbr !== '') put({ ref: L.ref.partAbbr(part.id), kind: 'part-abbr', status: nameStatus[0], code: nameStatus[1], plan: part.id });
      parts.push({ id: part.id, name: has(part.name) ? part.name : null, abbr: has(part.abbr) ? part.abbr : null,
        instrument: part.instrument.kind, staves: part.staves.map(s => s.id) });
      const tr = part.instrument && part.instrument.transpose;
      /* a percussion kit's items by key: the notehead and stem an instrument is written with when the note does not say
         (G04 §14.6, G4d-1a) */
      const kit = new Map(((part.instrument && part.instrument.kit && part.instrument.kit.items) || []).map(k => [k.key, k]));
      part.staves.forEach(s => {
        staffNo++;
        const tab = s.kind === 'tab';
        put({ ref: s.id, kind: 'staff', status: tab ? 'deferred' : 'drawn', code: tab ? 'tab' : undefined, plan: s.id });
        staves.push({ id: s.id, part: part.id, number: staffNo, kind: s.kind || 'standard', lines: has(s.lines) ? s.lines : 5 });
        if (!part.clefs.some(c => c.staff === s.id && c.m === tl.measures[0].id && R.isZero(R.parse(c.at))))
          diag('CLEF_MISSING', [s.id], 'no clef at the start: the layout chooses one');
      });
      const voiceOrder = new Map(), voiceById = new Map(part.voices.map(v => [v.id, v]));
      part.voices.forEach((v, i) => {
        put({ ref: v.id, kind: 'voice', status: 'drawn', plan: v.id });
        const n = parseInt(v.label, 10);
        voiceOrder.set(v.id, [isFinite(n) ? n : 1e6, i]);
        voices.push({ id: v.id, part: part.id, staff: v.staff, label: has(v.label) ? v.label : null });
      });
      part.clefs.forEach(c => {
        const st = c.sign === 'none' ? ['suppressed', 'clef-none'] : c.sign === 'TAB' ? ['deferred', 'tab'] : ['drawn'];
        put({ ref: c.id, kind: 'clef', status: st[0], code: st[1], plan: c.id });
        clefs.push({ id: c.id, staff: c.staff, m: c.m, at: c.at, sign: c.sign, line: has(c.line) ? c.line : (CLEF_LINE[c.sign] || null), octave: c.octave || 0 });
      });

      /* ---- the 8va spans of this part. An Ottava names its staff; one the file left without a staff is marked
         `assumed` by the importer (and by legacy.fromScore), and the app - toScore, Score.finalize, the legacy
         renderer, playback and practice - reads it on every staff of the part. The plan reads it the same way, so
         the page and the app agree on which notes it moves (G04 §32, fixer P6). */
      const allStaves = part.staves.map(s => s.id);
      const octaves = part.spanners.filter(s => s.type === 'ottava' && s.from && s.to).map(s => {
        const assumed = !s.staff || !!(s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed');
        if (assumed) diag('OTTAVA_STAFF_ASSUMED', [s.id], 'the file names no staff: it moves every staff of the part');
        return { id: s.id, covers: assumed ? allStaves : [s.staff], assumed: assumed, shift: s.shift, a: absOf(s.from), z: absOf(s.to) };
      });
      const shiftOf = (e, staffId) => {
        const t = R.add(mStart[mIdx.get(e.m)], R.parse(e.at));
        let k = 0;
        octaves.forEach(o => { if (o.covers.indexOf(staffId) >= 0 && !R.lt(t, o.a) && R.lt(t, o.z)) k = o.shift; });
        return k;
      };
      const coversOf = new Map(octaves.map(o => [o.id, o]));

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

      /* ---- grace notes: one before a note leads into the note of its voice that starts where it stands; one
         with no such note follows the note before it (a Nachschlag), which G04 §14.5 defers */
      const principal = new Set();
      part.events.forEach(e => { if (!e.grace) principal.add(e.voice + '|' + e.m + '|' + e.at); });

      /* ---- events and heads */
      part.events.forEach(e => {
        const kind = e.grace ? 'grace' : e.kind === 'rest' ? 'rest' : e.kind === 'perc' ? 'perc' : 'note';
        const after = !!e.grace && !principal.has(e.voice + '|' + e.m + '|' + e.at);
        /* the event's own disposition, and what its parts inherit from it */
        const self = e.hidden ? ['suppressed', 'hidden'] : after ? ['deferred', 'grace-after'] : ['drawn'];
        const inherit = e.hidden ? ['suppressed', 'hidden-event'] : after ? ['deferred', 'grace-after'] : ['drawn'];
        const sub = (r, k, own) => {
          const st = own && inherit[0] === 'drawn' ? own : inherit;
          put({ ref: r, kind: k, status: st[0], code: st[1], plan: e.id });
        };
        put({ ref: e.id, kind: kind, status: self[0], code: self[1], plan: e.id });
        const d = e.display || {};
        let stem = 'auto', stemFrom = 'auto';
        if (e.kind === 'rest') { stem = 'none'; stemFrom = 'rest'; }
        else if (d.stem === 'up' || d.stem === 'down' || d.stem === 'none') { stem = d.stem; stemFrom = 'graph'; }
        else if (d.stem === 'double') { stem = 'up'; stemFrom = 'graph'; }
        else {
          const role = roleOf.get(e.staff + '|' + e.m + '|' + e.voice);
          if (role === 'up' || role === 'down') { stem = role; stemFrom = 'voice'; }
        }
        if (d.stem !== undefined) sub(L.ref.stem(e.id), 'stem', d.stem === 'double' ? ['deferred', 'stem-double'] : null);
        if (d.pos !== undefined) sub(L.ref.restPos(e.id), 'rest-position');
        if (d.measureRest) sub(L.ref.measureRest(e.id), 'measure-rest');
        if (d.size !== undefined) sub(L.ref.size(e.id), 'size');
        if (e.hidden) put({ ref: L.ref.hidden(e.id), kind: 'hidden', status: 'suppressed', code: 'hidden', plan: e.id });
        if (e.cue) sub(L.ref.cue(e.id), 'cue');
        const v = voiceById.get(e.voice);
        if (v && v.staff !== e.staff) sub(L.ref.eventStaff(e.id), 'cross-staff-event');
        (e.arts || []).forEach((a, i) => sub(L.ref.art(e.id, i), 'articulation'));
        /* an ornament of the schema whose glyph the pinned font lacks waits for G4d (deferred ornament-glyph, G4-U5);
           one the schema does not know is unsupported - named, and the audit fails */
        const orn = (e.orn || []).map((o, i) => {
          const gl = GL.ornament(o.type);
          if (!gl.known) {
            diag('UNSUPPORTED_ORNAMENT', [e.id], String(o.type));
            put({ ref: L.ref.orn(e.id, i), kind: 'ornament', status: L.UNSUPPORTED, code: 'unknown-ornament', plan: e.id });
          } else {
            if (gl.missing) diag('MISSING_GLYPH', [e.id], o.type + ': ' + gl.glyph);
            sub(L.ref.orn(e.id, i), 'ornament', gl.missing ? ['deferred', 'ornament-glyph'] : null);
          }
          return Object.assign(cp(o), { glyph: gl.glyph, deferred: gl.missing ? 'ornament-glyph' : null });
        });
        if (e.fermata !== undefined) sub(L.ref.fermata(e.id), 'fermata');
        (e.lyrics || []).forEach((l, i) => sub(L.ref.lyric(e.id, i), 'lyric'));

        const heads = (e.heads || []).map(h => {
          const staffId = h.staff || e.staff;
          sub(h.id, 'head');
          let written = null;
          if (h.pitch) {
            const w = tr ? P.written(h.pitch, tr) : h.pitch;
            written = { step: w.step, alter: w.alter || 0, oct: w.oct - shiftOf(e, staffId) };
          } else if (h.pos) written = { step: h.pos.step, alter: 0, oct: h.pos.oct };
          if (h.acc !== undefined) sub(L.ref.acc(h.id), 'accidental');
          (h.fingering || []).forEach((f, i) => sub(L.ref.fingering(h.id, i), 'fingering', cfg.fingering ? null : ['suppressed', 'config-off']));
          if (h.notehead !== undefined) sub(L.ref.notehead(h.id), 'notehead');
          const cross = h.staff !== undefined && h.staff !== e.staff;
          if (cross) put({ ref: L.ref.headStaff(h.id), kind: 'cross-staff-head', status: 'deferred', code: 'cross-staff-chord', plan: h.id });
          /* string and fret: tablature data, which G4 does not draw (§14.6) */
          if (h.tech !== undefined) put({ ref: L.ref.tech(h.id), kind: 'technical', status: 'deferred', code: 'tab', plan: h.id });
          const ki = has(h.inst) ? kit.get(h.inst) : null;
          return { id: h.id, staff: staffId, pitch: cp(h.pitch), written: written, midi: h.pitch ? P.midi(h.pitch) : null,
            inst: has(h.inst) ? h.inst : null, pos: cp(h.pos), lead: !!h.lead, tech: cp(h.tech),
            kit: ki ? { notehead: ki.notehead || null, stem: ki.stem || null } : null,
            acc: cp(h.acc), notehead: cp(h.notehead),
            fingering: cfg.fingering && h.fingering ? cp(h.fingering) : [],
            crossStaff: cross };
        });
        events.push({ id: e.id, part: part.id, m: e.m, at: e.at, dur: e.dur, staff: e.staff, voice: e.voice, kind: e.kind,
          grace: e.grace ? { order: e.grace.order, slash: !!e.grace.slash, after: after } : null, cue: !!e.cue, hidden: !!e.hidden,
          type: d.type || null, dots: d.dots || 0, size: d.size || null, stem: stem, stemFrom: stemFrom, stemStated: d.stem || null,
          restPos: d.pos ? { step: d.pos.step, oct: d.pos.oct } : null, measureRest: !!d.measureRest,
          arts: (e.arts || []).slice(), orn: orn, fermata: cp(e.fermata), lyrics: cp(e.lyrics) || [], heads: heads });
      });

      /* ---- directions */
      part.directions.forEach(d => {
        const off = d.kind === 'chord' ? !cfg.chords : d.kind === 'dynamic' ? !cfg.marks : false;
        put({ ref: d.id, kind: d.kind, status: off ? 'suppressed' : 'drawn', code: off ? 'config-off' : undefined, plan: d.id });
        marks.push({ id: d.id, kind: d.kind, m: d.m, at: d.at, staff: d.staff || null, voice: d.voice || null, event: d.event || null,
          placement: d.placement || null, value: has(d.value) ? d.value : null, text: has(d.text) ? d.text : null,
          root: cp(d.root), chordKind: has(d.chordKind) ? d.chordKind : null, bass: cp(d.bass), degrees: cp(d.degrees) });
      });

      /* ---- spanners other than beams and tuplets (plan-beams.js, plan-tuplets.js) */
      part.spanners.forEach(s => {
        if (s.type === 'beam' || s.type === 'tuplet') return;
        const open = !has(s.from) || !has(s.to);
        if (s.type === 'tie') {
          const inferred = !!((s.prov && s.prov.op === 'inferred') || ctx.inferred);
          ties.push({ id: s.id, from: s.from || null, to: s.to || null, inferred: inferred });
          put({ ref: s.id, kind: 'tie', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'slur') {
          slurs.push({ id: s.id, from: s.from || null, to: s.to || null, placement: s.placement || null, line: s.line || null,
            inferred: !!(s.prov && s.prov.op === 'inferred') });
          put({ ref: s.id, kind: 'slur', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });
        } else if (s.type === 'pedal') {
          const off = s.soundOnly ? 'sound-only' : !cfg.marks ? 'config-off' : null;
          lines.push({ id: s.id, kind: 'pedal', pedal: s.pedal, from: cp(s.from), to: cp(s.to), changes: cp(s.changes) || [],
            mark: cp(s.mark), text: has(s.text) ? s.text : null, soundOnly: !!s.soundOnly, visible: !off });
          put({ ref: s.id, kind: 'pedal', status: off ? 'suppressed' : 'drawn', code: off || (open ? 'open' : undefined), plan: s.id });
          (s.changes || []).forEach((c, i) => put({ ref: L.ref.pedalChange(s.id, i), kind: 'pedal-change', status: off ? 'suppressed' : 'drawn', code: off || undefined, plan: s.id }));
        } else if (s.type === 'ottava') {
          const off = !cfg.marks;
          const o = coversOf.get(s.id);
          lines.push({ id: s.id, kind: 'ottava', shift: s.shift, staff: s.staff || null, assumed: o ? o.assumed : !s.staff,
            covers: o ? o.covers.slice() : (s.staff ? [s.staff] : allStaves.slice()), from: cp(s.from), to: cp(s.to), visible: !off });
          put({ ref: s.id, kind: 'ottava', status: off ? 'suppressed' : 'drawn', code: off ? 'config-off' : (open ? 'open' : undefined), plan: s.id });
        } else if (s.type === 'wedge') {
          lines.push({ id: s.id, kind: 'wedge', wedge: s.kind, staff: s.staff || null, from: cp(s.from), to: cp(s.to),
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
          /* no such type in a valid graph. If one appears it is unsupported - named, never deferred - and the audit
             fails (G4-U5): an unknown meaning is not let through in silence */
          diag('UNSUPPORTED_SPANNER', [s.id], String(s.type));
          put({ ref: s.id, kind: s.type, status: L.UNSUPPORTED, code: 'unknown-spanner' });
        }
      });
    });

    /* ---- beams and tuplets: the one-note groups first, so a derived beam sees a group as one tuplet */
    const pm = PT.merges(g, ctx);
    ctx.tupletGroupOf = pm.groupOf;
    const pb = PB.beams(g, ctx);
    pb.ledger.forEach(put);
    const pt = PT.tuplets(g, ctx, pb.beams, pm);
    pt.ledger.forEach(put);

    /* ---- analysis that is not notation */
    const st = g.structure || {};
    (st.phrases || []).forEach((x, i) => put({ ref: L.ref.phrase(i), kind: 'phrase', status: 'suppressed', code: 'analysis-only' }));
    (st.sections || []).forEach((x, i) => put({ ref: L.ref.section(i), kind: 'section', status: 'suppressed', code: 'analysis-only' }));

    /* ---- a graph rebuilt from a legacy Score: what the Score could not carry, by code (information, G04 §8.3) */
    if (cfg.projection) {
      put({ ref: L.ref.projected('legacy-score'), kind: 'projected-loss', status: 'projected-loss', code: 'legacy-score',
        detail: 'rebuilt from a legacy Score: beams, grace notes, most articulations, printed fingering after the first, ornaments, tuplet display options and slur pairing are not in it' });
      (cfg.projection.unsupported || []).forEach(u => put({ ref: L.ref.projected(u.code), kind: 'projected-loss', status: 'projected-loss',
        code: u.code, count: u.count, example: u.example === undefined ? null : u.example }));
    }

    /* ---- counts */
    const summary = {};
    ledger.forEach(en => {
      const k = summary[en.kind] = summary[en.kind] || { drawn: 0, derived: 0, merged: 0, suppressed: 0, deferred: 0, 'projected-loss': 0 };
      k[en.status]++;
    });

    return {
      version: PLAN_VERSION,
      graph: { id: g.id, rev: g.rev, fingerprint: SG.fingerprint(g) },
      config: cp(cfg), meta: meta,
      measures: measures, meters: meters, keys: keys, tempos: tempos, endings: endings, jumps: jumps,
      parts: parts, staves: staves, voices: voices, roles: roles, clefs: clefs,
      events: events, beams: pb.beams, tuplets: pt.tuplets, ties: ties, slurs: slurs, lines: lines, marks: marks,
      ledger: ledger, summary: summary, diagnostics: diagnostics
    };
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
