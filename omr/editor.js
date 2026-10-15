/* ============================================================================
   PPP OMR bar editor: the session (docs/GOALS/G12_OMR.md section 9, phase G12-4)

   What the correction screen keeps for one score and one visit, and what it asks of the graph. Pure (no DOM, no network, no clock): Node and browser, UMD.
   The DOM half is omr/editor-ui.js; the graph ops are omr/edit-ops.js; omr/flags.js says which bars may be wrong.

     create(graph, opts?) -> session
       session.graph                 the graph now (frozen); session.base the graph the visit began with
       session.apply(command)        -> { ok, changed, graph, measures, focus } | { ok: false, code, message, detail }
                                     a command is { op, ...args } (COMMANDS below); the graph is only ever changed by an op of omr/edit-ops.js, which validates
                                     the result: a change that the validator refuses is not made and says why
       session.undo() / redo()       -> { ok, graph, measures, focus }; the stack keeps `limit` steps (100); an undo returns the graph that was there, as it was
       session.discard()             back to the graph of the beginning of the visit (one step: it can be undone)
       session.canUndo / canRedo / steps
       session.bars(opts?)           -> [{ id, number, index, suspect, reviewed, edited, strong, weak, fill }] for every bar of the graph now
       session.report(score, opts)   -> the import report with the bars checked again (omr/flags.js on the graph now, the validator on the Score), reviewed bars
                                        not counted
     windowGraph(graph, measureId)   a valid small graph of one bar (clef, key and time signature in force in it): the sheet engraves this, not the whole score
     describe(graph, eventId)        what the toolbar needs to know about a note or a rest
     staffAt(graph, measureId, staffId) -> { clefSign, topDpos } to turn a place on the staff into a pitch

   Commands: step, octave, accidental, value, rest, note, remove, add, staff, key, clef, time, insert, delete, split, merge, mergeStaves, hand, reviewed, unreviewed.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'), require('./edit-ops.js'), null);
  else root.PPPOmrEditor = factory(root.PPPScoreGraph, root.PPPOmrEditOps, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, EO, browser) {
  'use strict';
  if (!SG || !SG.ops || !EO) throw new Error('omr/editor.js needs the ScoreGraph library and omr/edit-ops.js');
  const R = SG.rational, S = SG.schema;
  const VERSION = 1;
  const LIMIT = 100;
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const clone = x => JSON.parse(JSON.stringify(x));

  /* ------------------------------------------------------------------ commands -> ops */
  const COMMANDS = {
    step: (g, c) => EO.step(g, { head: c.head, by: c.by }),
    octave: (g, c) => EO.octave(g, { head: c.head, by: c.by }),
    accidental: (g, c) => EO.accidental(g, { head: c.head, acc: c.acc }),
    value: (g, c) => EO.value(g, { event: c.event, change: c.change }),
    rest: (g, c) => EO.toRest(g, { event: c.event }),
    note: (g, c) => EO.toNote(g, { event: c.event, pitch: c.pitch }),
    remove: (g, c) => EO.remove(g, { event: c.event, head: c.head }),
    add: (g, c) => EO.add(g, { measure: c.measure, staff: c.staff, at: c.at, pitch: c.pitch, value: c.value, acc: c.acc }),
    staff: (g, c) => EO.moveStaff(g, { event: c.event, staff: c.staff }),
    key: (g, c) => EO.setKey(g, { measure: c.measure, fifths: c.fifths, mode: c.mode }),
    clef: (g, c) => EO.setClef(g, { measure: c.measure, staff: c.staff, sign: c.sign, line: c.line }),
    time: (g, c) => EO.setTime(g, { measure: c.measure, beats: c.beats, beatType: c.beatType }),
    insert: (g, c) => EO.insertBar(g, c.before ? { before: c.before } : { after: c.after || c.measure }),
    delete: (g, c) => EO.removeBar(g, { measure: c.measure }),
    split: (g, c) => EO.splitBar(g, { measure: c.measure, at: c.at }),
    merge: (g, c) => EO.mergeBars(g, { measure: c.measure }),
    mergeStaves: (g, c) => EO.mergeParts(g, { keep: c.keep, into: c.into }),
    hand: (g, c) => EO.assignHand(g, { staff: c.staff, hand: c.hand }),
    reviewed: (g, c) => EO.markReviewed(g, { measure: c.measure }),
    unreviewed: (g, c) => EO.unmarkReviewed(g, { measure: c.measure })
  };
  const OPS_NAMES = Object.keys(COMMANDS);

  /* ------------------------------------------------------------------ readers of a graph */
  const mIndex = g => new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const numberOf = (g, m, i) => { const n = parseInt(m.number, 10); return isFinite(n) ? n : i + 1; };
  function eventAt(g, id) {
    for (const p of g.parts) { const e = p.events.find(x => x.id === id); if (e) return { part: p, event: e }; }
    return null;
  }
  const dposOf = p => p.oct * 7 + STEPS.indexOf(p.step);
  const pitchName = p => (p ? p.step + (p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '') + p.oct : '');
  const inTuplet = (part, id) => part.spanners.some(s => s.type === 'tuplet' && s.events.indexOf(id) >= 0);

  /* the clef in force on a staff at the start of a bar */
  function clefIn(g, partId, staffId, mid) {
    const mi = mIndex(g).get(mid);
    const part = g.parts.find(p => p.id === partId);
    const idx = mIndex(g);
    let best = null, bi = -1;
    part.clefs.forEach(c => {
      if (c.staff !== staffId) return;
      const i = idx.get(c.m);
      if (i === undefined || i > mi || (i === mi && !R.eq(R.parse(c.at), R.ZERO))) return;
      if (i >= bi) { best = c; bi = i; }
    });
    return best;
  }
  /* where a staff is and what its clef says: topDpos is the diatonic position (octave * 7 + step) of its top line */
  function staffAt(g, measureId, staffId) {
    const part = g.parts.find(p => p.staves.some(s => s.id === staffId));
    if (!part) return null;
    const cl = clefIn(g, part.id, staffId, measureId);
    const bottom = EO.clefBottom(cl);
    return { part: part.id, clefSign: cl ? cl.sign : 'G', bottomDpos: bottom, topDpos: bottom + 8, index: part.staves.findIndex(s => s.id === staffId) };
  }

  /* what a note or a rest is, for the toolbar: the heads, the value, and what an edit of it can do */
  function describe(g, eventId) {
    const at = eventAt(g, eventId);
    if (!at) return null;
    const e = at.event, part = at.part;
    const idx = mIndex(g);
    const mi = idx.get(e.m);
    const bar = g.timeline.measures[mi];
    const len = R.parse(e.dur), s = R.parse(e.at), end = R.add(s, len), mdur = R.parse(bar.dur);
    const tup = inTuplet(part, e.id);
    const others = part.events.filter(o => o.m === e.m && o.voice === e.voice && o.id !== e.id && o.kind !== 'rest' && !o.grace);
    const free = to => !others.some(o => R.lt(R.parse(o.at), to) && R.lt(s, R.add(R.parse(o.at), R.parse(o.dur))));
    const disp = e.display || {};
    const valueOk = { halve: false, double: false, dot: false };
    if (e.kind === 'note' && !e.grace && !tup) {
      valueOk.halve = R.ge(R.mul(len, R.make(1, 2)), S.noteValue('64th', 0)) && !!EO.displayFor(R.mul(len, R.make(1, 2)));
      const d2 = R.mul(len, R.make(2, 1));
      valueOk.double = R.le(R.add(s, d2), mdur) && !!EO.displayFor(d2) && free(R.add(s, d2));
      const dots = disp.dots || 0;
      const base = disp.type ? S.noteValue(disp.type, 0) : null;
      if (base) {
        const nl = dots >= 1 ? base : R.mul(base, R.make(3, 2));
        valueOk.dot = !!EO.displayFor(nl) && R.le(R.add(s, nl), mdur) && (R.le(nl, len) || free(R.add(s, nl)));
      }
    }
    const staffIdx = part.staves.findIndex(x => x.id === e.staff);
    return {
      id: e.id, kind: e.kind, grace: !!e.grace, measure: bar.id, number: numberOf(g, bar, mi), staff: e.staff, staffIndex: staffIdx, staffCount: part.staves.length,
      voice: e.voice, at: e.at, dur: e.dur, display: e.display ? clone(e.display) : null, inTuplet: tup,
      heads: (e.heads || []).map(h => ({ id: h.id, pitch: h.pitch ? clone(h.pitch) : null, name: pitchName(h.pitch), midi: h.pitch ? SG.pitch.midi(h.pitch) : null, acc: h.acc ? h.acc.type : null,
        staff: h.staff || e.staff })),
      canValue: valueOk,
      canRest: e.kind === 'note' && !e.grace && !tup,
      canNote: e.kind === 'rest' && !tup,
      canStaff: part.staves.length > 1 && !e.grace,
      measureRest: !!(disp && disp.measureRest)
    };
  }

  /* ------------------------------------------------------------------ a bar on its own */
  /* A small valid graph holding one bar of `g`, with the clef, key and time signature in force there, so that the bar is engraved alone (the sheet's bar is drawn in a few
     milliseconds whatever the score's length). Event, head and spanner IDs are the graph's own, so a tap on the drawing names the event it is. */
  function windowGraph(g, measureId) {
    const idx = mIndex(g);
    const mi = idx.get(measureId);
    if (mi === undefined) return null;
    const m = g.timeline.measures[mi];
    const tl = g.timeline;
    const doc = {
      scoregraph_version: g.scoregraph_version, id: g.id, rev: g.rev, nextId: g.nextId, meta: {},
      timeline: { measures: [clone(m)], meters: [], keys: [], tempos: [], endings: [], jumps: [] },
      parts: [], provenance: { sources: clone(g.provenance.sources), flags: [] }
    };
    if (g.provenance.default) doc.provenance.default = clone(g.provenance.default);
    delete doc.timeline.measures[0].layout;
    delete doc.timeline.measures[0].multiRest;
    /* the time signature in force */
    let meter = null;
    tl.meters.forEach(x => { const i = idx.get(x.m); if (i !== undefined && i <= mi && (!meter || i >= idx.get(meter.m))) meter = x; });
    if (meter) { const x = clone(meter); x.m = measureId; doc.timeline.meters.push(x); }
    /* the key in force, for each scope; a key partway through the bar stays where it is */
    const byScope = new Map();
    (tl.keys || []).forEach(k => {
      const i = idx.get(k.m);
      if (i === undefined || i > mi) return;
      const inside = i === mi && !R.eq(R.parse(k.at), R.ZERO);
      const key = JSON.stringify(k.scope || null);
      if (inside) { const x = clone(k); doc.timeline.keys.push(x); return; }
      const cur = byScope.get(key);
      if (!cur || i >= idx.get(cur.m)) byScope.set(key, k);
    });
    byScope.forEach(k => { const x = clone(k); x.m = measureId; x.at = '0'; doc.timeline.keys.push(x); });
    g.parts.forEach(p => {
      const evs = p.events.filter(e => e.m === measureId).map(clone);
      const evIds = new Set(evs.map(e => e.id));
      const heads = new Set();
      evs.forEach(e => (e.heads || []).forEach(h => heads.add(h.id)));
      const part = { id: p.id, instrument: clone(p.instrument), staves: clone(p.staves), voices: clone(p.voices), clefs: [], events: evs, directions: [], spanners: [] };
      if (p.name !== undefined) part.name = p.name;
      /* the clef in force on each staff */
      p.staves.forEach(st => {
        const cl = clefIn(g, p.id, st.id, measureId);
        if (cl) { const x = clone(cl); x.m = measureId; x.at = '0'; part.clefs.push(x); }
      });
      p.clefs.forEach(c => { if (c.m === measureId && !R.eq(R.parse(c.at), R.ZERO)) part.clefs.push(clone(c)); });
      p.directions.forEach(d => {
        if (d.m !== measureId) return;
        const x = clone(d);
        if (x.event !== undefined && !evIds.has(x.event)) delete x.event;
        part.directions.push(x);
      });
      const barEnd = m.dur;
      p.spanners.forEach(s => {
        const x = clone(s);
        if (s.type === 'tie' || s.type === 'gliss') {
          if (x.from !== undefined && !heads.has(x.from)) delete x.from;
          if (x.to !== undefined && !heads.has(x.to)) delete x.to;
          if (x.from === undefined && x.to === undefined) return;
          if (s.type === 'gliss' && (x.from === undefined || x.to === undefined)) return;
          part.spanners.push(x);
        } else if (s.type === 'slur') {
          if (x.from !== undefined && !evIds.has(x.from)) delete x.from;
          if (x.to !== undefined && !evIds.has(x.to)) delete x.to;
          if (x.from === undefined && x.to === undefined) return;
          part.spanners.push(x);
        } else if (s.type === 'beam' || s.type === 'tuplet') {
          if (x.events.every(id => evIds.has(id))) part.spanners.push(x);
        } else if (s.type === 'arpeggio') {
          if (x.heads.every(id => heads.has(id))) part.spanners.push(x);
        } else if (s.type === 'wedge' || s.type === 'ottava' || s.type === 'pedal') {
          const a = idx.get(s.from.m), b = s.to ? idx.get(s.to.m) : a;
          if (a === undefined || a > mi || (b !== undefined && b < mi)) return;
          x.from = a === mi ? s.from : { m: measureId, at: '0' };
          if (s.to) x.to = b === mi ? s.to : { m: measureId, at: barEnd };
          if (s.type === 'pedal') x.changes = (s.changes || []).filter(c => c.m === measureId).map(clone);
          if (s.type === 'pedal' && !s.to) delete x.to;
          part.spanners.push(x);
        }
      });
      const tupIds = new Set(part.spanners.filter(s => s.type === 'tuplet').map(s => s.id));
      part.spanners.forEach(s => { if (s.type === 'tuplet' && s.parent !== undefined && !tupIds.has(s.parent)) delete s.parent; });
      doc.parts.push(part);
    });
    /* not validated here (it is the drawing's input, made from a graph that was: the tests validate every bar of the scores they have), which is what keeps the
       bar's drawing to a few milliseconds; the engraver is the judge of what it is given, and the sheet says so when it cannot draw */
    try { return SG.deepFreeze(SG.canonicalize(doc)); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ how full each staff of a bar is */
  function fill(g, measureId) {
    const need = R.parse(g.timeline.measures.find(m => m.id === measureId).dur);
    const out = [];
    g.parts.forEach(p => p.staves.forEach((st, si) => {
      let worst = null;
      p.voices.filter(v => v.staff === st.id).forEach(v => {
        let sum = R.ZERO;
        p.events.forEach(e => { if (e.m === measureId && e.voice === v.id && !e.grace) sum = R.add(sum, R.parse(e.dur)); });
        if (R.eq(sum, R.ZERO) && !p.events.some(e => e.m === measureId && e.voice === v.id)) return;       /* a voice not used in this bar */
        const bad = !R.eq(sum, need);
        if (!worst || (bad && !worst.bad) || (bad === worst.bad && Math.abs(R.toNumber(R.sub(sum, need))) > Math.abs(R.toNumber(R.sub(worst.have, need))))) worst = { have: sum, bad: bad, voice: v.id };
      });
      out.push({ staff: st.id, index: si, have: worst ? R.format(worst.have) : '0', need: R.format(need), ok: !!worst && !worst.bad, voice: worst ? worst.voice : null });
    }));
    return out;
  }

  /* ------------------------------------------------------------------ the session */
  function create(graph, opts) {
    opts = opts || {};
    const limit = Math.max(1, opts.limit || LIMIT);
    /* what the import said about its own bars, by the bar's ID: omr/normalize.js `report.flags` is by bar number of the import */
    const ids0 = graph.timeline.measures.map(m => m.id);
    const importFlags = {};
    const nf = opts.normalize && opts.normalize.flags && typeof opts.normalize.flags === 'object' ? opts.normalize.flags : {};
    Object.keys(nf).forEach(k => { const i = (+k) - 1; if (ids0[i]) importFlags[ids0[i]] = nf[k]; });
    const states = [{ graph: graph, focus: null, label: 'start' }];
    let pos = 0;
    const base = graph;
    let checkCache = null;
    let lastIds = null;         /* the last full check: { byId: Map(bar ID -> its bar of the answer) }, to show while the new one is made */

    const cur = () => states[pos];
    function after(res, focus, label, back) {
      /* a new step ends what was to be redone; `back` is where an undo of it lands (the bar a deleted bar was) */
      states.length = pos + 1;
      states.push({ graph: res.graph, focus: focus || null, back: back || focus || null, label: label || '' });
      if (states.length > limit + 1) states.splice(0, states.length - (limit + 1));
      pos = states.length - 1;
      checkCache = null;
    }
    function focusOf(command, res) {
      const r = res.result || {};
      const f = { measure: null, event: null, head: null };
      if (res.measures && res.measures.length) f.measure = res.measures[0];
      if (command.measure) f.measure = command.measure;
      if (r.measure) f.measure = r.measure;
      if (r.event) f.event = r.event;
      if (r.head) f.head = r.head;
      /* the note the person was working on: where an undo goes back to (it is there again by then) */
      if (command.event) f.event = f.event || command.event;
      if (command.head) f.head = f.head || command.head;
      if (['step', 'octave', 'accidental', 'value'].indexOf(command.op) >= 0) { f.event = command.event || f.event; if (command.head) f.head = command.head; }
      if (command.op === 'delete') f.measure = res.measures && res.measures[0] ? res.measures[0] : null;      /* the bar that took its place */
      return f;
    }

    const session = {
      version: VERSION,
      get graph() { return cur().graph; },
      get base() { return base; },
      get canUndo() { return pos > 0; },
      get canRedo() { return pos < states.length - 1; },
      get steps() { return { undo: pos, redo: states.length - 1 - pos }; },
      apply(command) {
        if (!command || OPS_NAMES.indexOf(command.op) < 0) return { ok: false, code: 'no-target', message: 'unknown command' };
        let res;
        try { res = COMMANDS[command.op](cur().graph, command); }
        catch (e) {
          if (e && e.name === 'EditError') return { ok: false, code: e.code, message: e.message, detail: e.detail || null };
          return { ok: false, code: 'invalid', message: String(e && e.message || e).slice(0, 200), detail: null };
        }
        if (!res.changed) return { ok: true, changed: false, graph: cur().graph, measures: [], focus: null };
        const focus = focusOf(command, res);
        after(res, focus, command.op, command.op === 'delete' ? { measure: command.measure } : focus);
        return { ok: true, changed: true, graph: res.graph, measures: res.measures, focus: focus, idMap: res.idMap, op: command.op };
      },
      undo() {
        if (pos === 0) return { ok: false, code: 'nothing', message: 'nothing to undo' };
        const was = cur();
        pos--;
        checkCache = null;
        return { ok: true, graph: cur().graph, measures: [], focus: was.back || was.focus, op: was.label };
      },
      redo() {
        if (pos >= states.length - 1) return { ok: false, code: 'nothing', message: 'nothing to redo' };
        pos++;
        checkCache = null;
        return { ok: true, graph: cur().graph, measures: [], focus: cur().focus, op: cur().label };
      },
      /* back to the graph the visit began with: one step, so an undo brings the edits back */
      discard() {
        if (cur().graph === base) return { ok: true, changed: false, graph: base };
        after({ graph: base }, null, 'discard');
        return { ok: true, changed: true, graph: base, measures: [], focus: null, op: 'discard' };
      },
      get edited() { return cur().graph !== base; },
      /* omr/flags.js on the graph now: its own answer, by bar index */
      check(FL) {
        FL = FL || (browser && browser.PPPOmrFlags) || null;
        if (!FL) return null;
        if (checkCache && checkCache.graph === cur().graph) return checkCache.res;
        const g = cur().graph;
        const flags = {};
        g.timeline.measures.forEach((m, i) => { if (importFlags[m.id]) flags[i + 1] = importFlags[m.id]; });
        const reviewed = EO.reviewedBars(g);
        let res;
        if (!reviewed.size || typeof FL.extract !== 'function' || typeof FL.derive !== 'function' || typeof FL.decide !== 'function') res = FL.analyze(g, { normalize: { flags: flags } });
        else {
          /* a bar a person has looked at and accepted has no doubt in it, and so none for its neighbours or for the page: its facts are taken out before the rule is run
             (omr/flags.js: extract, derive, decide: the same steps analyze takes) */
          try {
            const feat = FL.derive(FL.extract(g));
            g.timeline.measures.forEach((m, i) => {
              if (!reviewed.has(m.id) || !feat.bars[i]) return;
              const b = feat.bars[i];
              ['short', 'hole', 'over', 'lenDiff', 'overlap', 'emptyStaff', 'nc5', 'nc6', 'nc7', 'nc8', 'xMis', 'cross', 'leap', 'dup', 'offKey', 'ledger'].forEach(k => { if (typeof b[k] === 'number') b[k] = 0; });
              b.voices = Math.min(b.voices || 0, 2); b.hLocal = 1; b.vbDoc = 1;
              delete flags[i + 1];
            });
            const bars = FL.decide(feat, { normalize: { flags: flags } }, FL.PARAMS);
            const suspect = bars.filter(b => b.suspect).map(b => b.n);
            const counts = {};
            bars.forEach(b => b.reasons.forEach(r => { counts[r.code] = (counts[r.code] || 0) + 1; }));
            res = { ok: true, version: FL.VERSION, bars: bars, suspect: suspect, counts: counts, confidence: FL.confidenceOf(suspect.length, bars.length, 1), features: feat, params: FL.PARAMS };
          } catch (e) { res = FL.analyze(g, { normalize: { flags: flags } }); }
        }
        checkCache = { graph: g, res: res };
        if (res && res.ok) lastIds = { byId: new Map(g.timeline.measures.map((m, i) => [m.id, res.bars[i]])) };
        return res;
      },
      /* o.quick: no new check of the graph now (it costs as much as the edit): the last answer, by bar ID, for the bars that were there, `pending` for the rest */
      bars(o) {
        o = o || {};
        const g = cur().graph;
        const hint = o.hint && !lastIds ? o.hint : null;                   /* what the page already knows (its report): the suspect bar numbers and their codes */
        const quick = !!o.quick && !(checkCache && checkCache.graph === g) && (!!lastIds || !!hint);
        const res = quick ? null : (o.res || (o.flags ? session.check(o.flags) : session.check()));
        const reviewed = EO.reviewedBars(g), edited = EO.editedBars(g);
        return g.timeline.measures.map((m, i) => {
          let b = quick ? (lastIds ? lastIds.byId.get(m.id) || null : null) : (res && res.ok ? res.bars[i] : null);
          if (quick && !lastIds && hint) {
            const no = numberOf(g, m, i);
            const sus = (hint.suspect || []).indexOf(no) >= 0;
            const codes = (hint.codes && hint.codes[no]) || [];
            b = { suspect: sus, strong: [], weak: codes.slice(), reasons: codes.map(c => ({ code: c, strength: 'weak' })) };
          }
          const isRev = reviewed.has(m.id);
          return {
            id: m.id, number: numberOf(g, m, i), index: i, pending: quick,
            suspect: !!(b && b.suspect) && !isRev, flagged: !!(b && b.suspect), reviewed: isRev,
            edited: edited.has(m.id), strong: b ? b.strong.slice() : [], weak: b ? b.weak.slice() : [],
            reasons: b ? b.reasons.map(r => ({ code: r.code, strength: r.strength })) : [],
            fill: fill(g, m.id)
          };
        });
      },
      /* the import's report made again for the graph now. score: the Score of the graph (the validator reads it); opts: { validate(score) -> a report like Import.validate's,
         tx, old (the report so far), FL (omr/flags.js), notes } */
      report(score, o) {
        o = o || {};
        const FL = o.FL || (browser && browser.PPPOmrFlags) || null;
        const old = o.old || {};
        const tx = o.tx;
        const g = cur().graph;
        const numbers = g.timeline.measures.map((m, i) => numberOf(g, m, i));
        const reviewedNo = new Set(g.timeline.measures.filter(m => EO.reviewedBars(g).has(m.id)).map(m => numberOf(g, m, g.timeline.measures.indexOf(m))));
        const fresh = typeof o.validate === 'function' ? o.validate(score) : { confidence: 1, level: 'good', issues: [], suspectMeasures: [] };
        /* a bar a person has looked at and accepted is not a doubt of the validator's either */
        if (reviewedNo.size) {
          fresh.issues = (fresh.issues || []).filter(i => i.measure == null || !reviewedNo.has(i.measure));
          fresh.suspectMeasures = (fresh.suspectMeasures || []).filter(m => !reviewedNo.has(m));
        }
        const res = FL ? session.check(FL) : null;
        if (FL && res && res.ok) {
          const keep = Object.assign({}, res, { bars: res.bars.map((b, i) => (reviewedNo.has(numbers[i]) ? Object.assign({}, b, { suspect: false, strong: [], weak: [], reasons: [] }) : b)) });
          FL.mergeIntoReport(fresh, keep, { numbers: numbers, notes: o.notes !== undefined ? o.notes : (score.notes || []).filter(n => !n.rest).length }, tx);
        } else if ((fresh.suspectMeasures || []).length === 0 && fresh.confidence >= 0.85) {
          /* nothing to say */
        }
        const out = Object.assign({}, old);
        ['confidence', 'level', 'issues', 'suspectMeasures', 'summary', 'advice', 'measures', 'notes', 'staves'].forEach(k => { if (fresh[k] !== undefined) out[k] = fresh[k]; });
        if (fresh.flagCodes) out.flagCodes = fresh.flagCodes; else delete out.flagCodes;
        /* what the import said that no check of the graph says again (a browser draft, a PC that did not read it) stays */
        const KEEP = ['browser-fallback', 'pc-omr-fallback'];
        (old.issues || []).slice().reverse().forEach(i => { if (KEEP.indexOf(i.kind) >= 0 && !out.issues.some(x => x.kind === i.kind)) out.issues.unshift(i); });
        if ((old.issues || []).some(i => i.kind === 'browser-fallback')) {
          out.confidence = Math.min(out.confidence, 0.45);
          out.level = 'poor';
        }
        out.edited = session.edited;
        return out;
      },
      /* the bars with a doubt left, in bar order: the numbers of the strip */
      suspect(o) { return session.bars(o).filter(b => b.suspect).map(b => b.number); }
    };
    return session;
  }

  return Object.freeze({ VERSION: VERSION, LIMIT: LIMIT, COMMANDS: OPS_NAMES, create: create, windowGraph: windowGraph, describe: describe, staffAt: staffAt, fill: fill,
    pitchName: pitchName, dposOf: dposOf, ops: EO });
});
