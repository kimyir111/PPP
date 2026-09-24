/* ============================================================================
   PPP engrave — the fidelity ledger (docs/GOALS/G04 §8.3, §21.1 L1, A1)

   Three independent readings, compared by audit():

   expected(graph)   every notation object the graph states, by reference, with
                     a signature of what it says (its time, pitch, ends,
                     members, value). Walked from the schema's own fields; it
                     never reads a plan.
   consumed(plan)    what the plan's OUTPUT carries - its events, heads, ties,
                     slurs, lines, marks, beams, tuplets, measures ... - by the
                     same references and signatures. Walked from the output
                     arrays only; it never reads the graph or the ledger, so a
                     plan that walks an object and then drops it, or carries
                     it changed, is caught here.
   plan.ledger       the plan's own account: one disposition per reference.

   audit(graph, plan) names
     silent     stated by the graph, with no ledger entry (dropped with no
                disposition)
     invented   a ledger entry for nothing the graph states (derived 'd:' and
                projection 'p:' references excepted)
     duplicate  two entries for one reference
     kindMismatch, badStatus
     missing    drawn, merged or derived, but the output does not carry it
     altered    the output carries it, but not as the graph states it
     orphan     an output object that is neither the graph's nor a ledgered
                derived one
     unapproved a code the status does not allow (CODES; deferred codes are
                G04 A1's list and nothing else)
     uncoded    a status other than drawn with no code

   A reference is a graph ID, or a graph ID and a sub-item for what the graph
   keeps inside an object without an ID of its own (an articulation is
   `e12#art0`, a pedal change `s7#change1`). 'd:' is a derived object of the
   plan (a beam the graph does not state, a display group), 'p:' what a
   projection from a legacy Score could not carry (status projected-loss).

   Not objects of their own, on purpose (G04 §8.6): source layout geometry
   (display.x, Measure.layout.width), ext.* data, provenance, performances,
   instrument data, limbs. Attributes of an object - a placement, a jump's
   target, a tempo's display, a head's `lead` - are part of that object's
   signature, so the plan must carry them but they need no entry of their own.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).ledger = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ledger statuses (G04 §8.3, A1). 'merged' with code 'merged-for-display' is G4-U2's display-only grouping;
     'projected-loss' names what a graph rebuilt from a legacy Score could not hold (G04 §8.3, information). */
  const STATUS = Object.freeze(['drawn', 'derived', 'merged', 'suppressed', 'deferred', 'projected-loss']);

  /* The codes each status may carry. deferred is G04 A1's allow-list exactly; anything else is an unapproved
     code and fails the audit, so a new way of not drawing something cannot appear unreviewed. */
  const CODES = Object.freeze({
    drawn: Object.freeze(['open', 'one-note', 'substitute-glyph', 'playback-tempo']),
    derived: Object.freeze(['part-states-no-beams']),
    merged: Object.freeze(['merged-for-display']),
    suppressed: Object.freeze(['hidden', 'hidden-event', 'printed-false', 'show-none', 'sound-only', 'config-off', 'clef-none',
      'analysis-only', 'screen-draws-each-bar', 'source-break-not-honored', 'print-only', 'single-part']),
    deferred: Object.freeze(['cross-staff-chord', 'cross-staff-beam', 'tab', 'nested-3', 'grace-after', 'stem-double'])
  });
  const DEFERRED_ALLOWED = CODES.deferred;

  const ref = Object.freeze({
    sub: (id, what) => id + '#' + what,
    art: (eid, i) => eid + '#art' + i,
    orn: (eid, i) => eid + '#orn' + i,
    fermata: eid => eid + '#fermata',
    lyric: (eid, i) => eid + '#lyric' + i,
    stem: eid => eid + '#stem',
    restPos: eid => eid + '#pos',
    measureRest: eid => eid + '#mrest',
    hidden: eid => eid + '#hidden',
    cue: eid => eid + '#cue',
    size: eid => eid + '#size',
    eventStaff: eid => eid + '#xstaff',
    acc: hid => hid + '#acc',
    fingering: (hid, i) => hid + '#fing' + i,
    notehead: hid => hid + '#notehead',
    headStaff: hid => hid + '#xstaff',
    tech: hid => hid + '#tech',
    beamBreak: (sid, i) => sid + '#break' + i,
    pedalChange: (sid, i) => sid + '#change' + i,
    barline: (mid, side) => mid + '#bar.' + side,
    barFermata: (mid, side) => mid + '#bar.' + side + '.fermata',
    multiRest: mid => mid + '#multirest',
    layoutBreak: mid => mid + '#break',
    partName: pid => pid + '#name',
    partAbbr: pid => pid + '#abbr',
    phrase: i => 'phrase#' + i,
    section: i => 'section#' + i,
    meta: field => 'meta.' + field,
    derived: (kind, first) => 'd:' + kind + ':' + first,
    projected: code => 'p:' + code
  });

  const META_FIELDS = ['title', 'subtitle', 'composer', 'arranger', 'lyricist', 'copyright', 'workNumber', 'movementNumber',
    'movementTitle'];
  /* a clef's line when the canonical graph leaves it out (serialize.js CLEF_LINE) */
  const CLEF_LINE = Object.freeze({ G: 2, F: 4, C: 3, TAB: 5 });

  /* ------------------------------------------------------------ signatures */
  /* One spelling for "what an object says", used by both readings. Absent, null and false are one thing; a
     reference to another object is its ID; a position is "m@at". */
  const nz = v => (v === undefined || v === false ? null : v);
  const J = v => JSON.stringify(v, (k, x) => (x === undefined ? null : x));
  const pos = p => (p ? p.m + '@' + p.at : null);
  const acc = a => (a ? [a.type, !!a.cautionary, !!a.editorial, !!a.paren, !!a.bracket] : null);
  const sig = {
    meta: v => J(v),
    measure: (dur, implicit) => J([dur, !!implicit]),
    multiRest: n => J(n),
    layoutBreak: (ns, np) => J([!!ns, !!np]),
    barline: b => J([nz(b.style), nz(b.repeat), nz(b.times)]),
    fermata: f => J([nz(f.shape), !!f.inverted]),
    meter: (m, beats, bt, symbol, groups, hidden) => J([m, beats, bt, nz(symbol), nz(groups), !!hidden]),
    key: (m, at, fifths, mode, hidden, scope) => J([m, at, fifths, nz(mode), !!hidden, nz(scope)]),
    tempo: (m, at, qpm, mark, display) => J([m, at, nz(qpm), nz(mark), nz(display)]),
    ending: (numbers, text, from, to, open) => J([numbers, nz(text), from, to, !!open]),
    jump: (kind, m, at, text, target, display) => J([kind, m, at, nz(text), nz(target), nz(display)]),
    part: kind => J(kind),
    text: t => J(t),
    staff: (kind, lines) => J([kind || 'standard', lines === undefined || lines === null ? 5 : lines]),
    voice: (staff, label) => J([staff, nz(label)]),
    clef: (staff, m, at, sign, line, octave) => J([staff, m, at, sign, line === undefined || line === null ? (CLEF_LINE[sign] || null) : line, octave || 0]),
    event: (kind, m, at, dur, staff, voice, grace, hidden, cue, type, dots) =>
      J([kind, m, at, dur, staff, voice, grace ? [grace.order, !!grace.slash] : null, !!hidden, !!cue, nz(type), dots || 0]),
    value: v => J(nz(v)),
    step: (step, oct) => J([step, oct]),
    orn: o => J([o.type, nz(o.marks), nz(o.acc)]),
    lyric: l => J([l.verse || 1, l.text, nz(l.syllabic), !!l.extend]),
    head: (staff, pitch, inst, p, lead) => J([staff, pitch ? [pitch.step, pitch.alter || 0, pitch.oct] : null, nz(inst), p ? [p.step, p.oct] : null, !!lead]),
    acc: a => J(acc(a)),
    fingering: f => J([f.f, !!f.subst, !!f.alt, nz(f.placement)]),
    notehead: n => J([nz(n.shape), n.filled === undefined ? null : n.filled, !!n.paren]),
    direction: d => J([d.kind, d.m, d.at, nz(d.staff), nz(d.voice), nz(d.event), nz(d.placement), nz(d.value), nz(d.text),
      nz(d.root), nz(d.chordKind), nz(d.bass), nz(d.degrees)]),
    tie: (from, to) => J([nz(from), nz(to)]),
    slur: (from, to, placement, line) => J([nz(from), nz(to), nz(placement), nz(line)]),
    beam: (events, breaks) => J([events, (breaks || []).map(b => [b.after, b.level])]),
    beamBreak: (after, level) => J([after, level]),
    tuplet: (events, actual, normal, unit, parent) => J([events, actual, normal, unit ? [unit.type, unit.dots || 0] : null, nz(parent)]),
    wedge: (kind, staff, from, to, placement, niente) => J([kind, nz(staff), from, to, nz(placement), !!niente]),
    pedal: (pedal, from, to, mark, text, soundOnly) => J([pedal, from, to, nz(mark), nz(text), !!soundOnly]),
    pos: p => J(p),
    ottava: (shift, staff, from, to) => J([shift, nz(staff), from, to]),
    gliss: (from, to, slide, line, text, placement) => J([nz(from), nz(to), !!slide, nz(line), nz(text), nz(placement)]),
    arpeggio: (heads, dir, non) => J([heads, nz(dir), !!non])
  };

  /* ---------------------------------------------------- expected: the graph */
  /* graph -> Map(ref -> {kind, sig}) */
  function expected(g) {
    const items = new Map();
    const put = (r, kind, s) => { items.set(r, { kind: kind, sig: s === undefined ? null : s }); };
    const meta = g.meta || {};
    META_FIELDS.forEach(f => { if (meta[f] !== undefined && meta[f] !== '') put(ref.meta(f), 'meta', sig.meta(meta[f])); });
    const tl = g.timeline || {};
    (tl.measures || []).forEach(m => {
      put(m.id, 'measure', sig.measure(m.dur, m.implicit));
      if (m.multiRest) put(ref.multiRest(m.id), 'multi-rest', sig.multiRest(m.multiRest));
      if (m.layout && (m.layout.newSystem || m.layout.newPage)) put(ref.layoutBreak(m.id), 'layout-break', sig.layoutBreak(m.layout.newSystem, m.layout.newPage));
      ['left', 'right'].forEach(side => {
        const b = m.barline && m.barline[side];
        if (!b) return;
        if (b.style !== undefined || b.repeat !== undefined) put(ref.barline(m.id, side), 'barline', sig.barline(b));
        if (b.fermata !== undefined) put(ref.barFermata(m.id, side), 'fermata', sig.fermata(b.fermata));
      });
    });
    (tl.meters || []).forEach(x => put(x.id, 'meter', sig.meter(x.m, x.beats, x.beatType, x.symbol, x.groups, x.hidden)));
    (tl.keys || []).forEach(x => put(x.id, 'key', sig.key(x.m, x.at, x.fifths, x.mode, x.hidden, x.scope)));
    (tl.tempos || []).forEach(x => put(x.id, 'tempo', sig.tempo(x.m, x.at, x.qpm, x.mark, x.display)));
    (tl.endings || []).forEach(x => put(x.id, 'ending', sig.ending(x.numbers, x.text, x.from, x.to, x.open)));
    (tl.jumps || []).forEach(x => put(x.id, 'jump', sig.jump(x.kind, x.m, x.at, x.text, x.target, x.display)));
    (g.parts || []).forEach(p => {
      put(p.id, 'part', sig.part(p.instrument && p.instrument.kind));
      if (p.name !== undefined && p.name !== '') put(ref.partName(p.id), 'part-name', sig.text(p.name));
      if (p.abbr !== undefined && p.abbr !== '') put(ref.partAbbr(p.id), 'part-abbr', sig.text(p.abbr));
      const staffOfVoice = new Map((p.voices || []).map(v => [v.id, v.staff]));
      (p.staves || []).forEach(s => put(s.id, 'staff', sig.staff(s.kind, s.lines)));
      (p.voices || []).forEach(v => put(v.id, 'voice', sig.voice(v.staff, v.label)));
      (p.clefs || []).forEach(c => put(c.id, 'clef', sig.clef(c.staff, c.m, c.at, c.sign, c.line, c.octave)));
      (p.events || []).forEach(e => {
        const d = e.display || {};
        put(e.id, e.grace ? 'grace' : e.kind === 'rest' ? 'rest' : e.kind === 'perc' ? 'perc' : 'note',
          sig.event(e.kind, e.m, e.at, e.dur, e.staff, e.voice, e.grace, e.hidden, e.cue, d.type, d.dots));
        if (d.stem !== undefined) put(ref.stem(e.id), 'stem', sig.value(d.stem));
        if (d.pos !== undefined) put(ref.restPos(e.id), 'rest-position', sig.step(d.pos.step, d.pos.oct));
        if (d.measureRest) put(ref.measureRest(e.id), 'measure-rest', sig.value(true));
        if (d.size !== undefined) put(ref.size(e.id), 'size', sig.value(d.size));
        if (e.hidden) put(ref.hidden(e.id), 'hidden', sig.value(true));
        if (e.cue) put(ref.cue(e.id), 'cue', sig.value(true));
        if (staffOfVoice.has(e.voice) && staffOfVoice.get(e.voice) !== e.staff) put(ref.eventStaff(e.id), 'cross-staff-event', sig.value(e.staff));
        (e.arts || []).forEach((a, i) => put(ref.art(e.id, i), 'articulation', sig.value(a)));
        (e.orn || []).forEach((o, i) => put(ref.orn(e.id, i), 'ornament', sig.orn(o)));
        if (e.fermata !== undefined) put(ref.fermata(e.id), 'fermata', sig.fermata(e.fermata));
        (e.lyrics || []).forEach((l, i) => put(ref.lyric(e.id, i), 'lyric', sig.lyric(l)));
        (e.heads || []).forEach(h => {
          put(h.id, 'head', sig.head(h.staff || e.staff, h.pitch, h.inst, h.pos, h.lead));
          if (h.acc !== undefined) put(ref.acc(h.id), 'accidental', sig.acc(h.acc));
          (h.fingering || []).forEach((f, i) => put(ref.fingering(h.id, i), 'fingering', sig.fingering(f)));
          if (h.notehead !== undefined) put(ref.notehead(h.id), 'notehead', sig.notehead(h.notehead));
          if (h.staff !== undefined && h.staff !== e.staff) put(ref.headStaff(h.id), 'cross-staff-head', sig.value(h.staff));
          if (h.tech !== undefined) put(ref.tech(h.id), 'technical', J([nz(h.tech.string), nz(h.tech.fret)]));
        });
      });
      (p.directions || []).forEach(d => put(d.id, d.kind, sig.direction(d)));
      (p.spanners || []).forEach(s => {
        switch (s.type) {
          case 'tie': put(s.id, 'tie', sig.tie(s.from, s.to)); break;
          case 'slur': put(s.id, 'slur', sig.slur(s.from, s.to, s.placement, s.line)); break;
          case 'beam':
            put(s.id, 'beam', sig.beam(s.events, s.breaks));
            (s.breaks || []).forEach((b, i) => put(ref.beamBreak(s.id, i), 'beam-break', sig.beamBreak(b.after, b.level)));
            break;
          case 'tuplet': put(s.id, 'tuplet', sig.tuplet(s.events, s.actual, s.normal, s.unit, s.parent)); break;
          case 'wedge': put(s.id, 'wedge', sig.wedge(s.kind, s.staff, pos(s.from), pos(s.to), s.placement, s.niente)); break;
          case 'pedal':
            put(s.id, 'pedal', sig.pedal(s.pedal, pos(s.from), pos(s.to), s.mark, s.text, s.soundOnly));
            (s.changes || []).forEach((c, i) => put(ref.pedalChange(s.id, i), 'pedal-change', sig.pos(pos(c))));
            break;
          case 'ottava': put(s.id, 'ottava', sig.ottava(s.shift, s.staff, pos(s.from), pos(s.to))); break;
          case 'gliss': put(s.id, 'gliss', sig.gliss(s.from, s.to, s.slide, s.line, s.text, s.placement)); break;
          case 'arpeggio': put(s.id, 'arpeggio', sig.arpeggio(s.heads, s.dir, s.non)); break;
          default: put(s.id, s.type, null);
        }
      });
    });
    const st = g.structure || {};
    (st.phrases || []).forEach((x, i) => put(ref.phrase(i), 'phrase', null));
    (st.sections || []).forEach((x, i) => put(ref.section(i), 'section', null));
    return items;
  }
  /* graph -> Map(ref -> kind): what the graph states, by kind */
  function inventory(g) {
    const out = new Map();
    expected(g).forEach((x, r) => out.set(r, x.kind));
    return out;
  }

  /* ------------------------------------------------- consumed: the plan output */
  /* plan -> Map(ref -> {kind, sig}), read from the plan's output arrays and nothing else */
  function consumed(plan) {
    const items = new Map();
    const put = (r, kind, s) => { items.set(r, { kind: kind, sig: s === undefined ? null : s }); };
    const meta = plan.meta || {};
    META_FIELDS.forEach(f => { if (meta[f] !== undefined && meta[f] !== null && meta[f] !== '') put(ref.meta(f), 'meta', sig.meta(meta[f])); });
    (plan.measures || []).forEach(m => {
      put(m.id, 'measure', sig.measure(m.dur, m.implicit));
      if (m.multiRest) put(ref.multiRest(m.id), 'multi-rest', sig.multiRest(m.multiRest));
      if (m.layoutBreak) put(ref.layoutBreak(m.id), 'layout-break', sig.layoutBreak(m.layoutBreak.newSystem, m.layoutBreak.newPage));
      ['left', 'right'].forEach(side => {
        const b = m.barline && m.barline[side];
        if (!b) return;
        if (b.style !== undefined || b.repeat !== undefined) put(ref.barline(m.id, side), 'barline', sig.barline(b));
        if (b.fermata !== undefined && b.fermata !== null) put(ref.barFermata(m.id, side), 'fermata', sig.fermata(b.fermata));
      });
    });
    (plan.meters || []).forEach(x => put(x.id, 'meter', sig.meter(x.m, x.beats, x.beatType, x.symbol, x.groups, x.hidden)));
    (plan.keys || []).forEach(x => put(x.id, 'key', sig.key(x.m, x.at, x.fifths, x.mode, x.hidden, x.scope)));
    (plan.tempos || []).forEach(x => put(x.id, 'tempo', sig.tempo(x.m, x.at, x.qpm, x.mark, x.display)));
    (plan.endings || []).forEach(x => put(x.id, 'ending', sig.ending(x.numbers, x.text, x.from, x.to, x.open)));
    (plan.jumps || []).forEach(x => put(x.id, 'jump', sig.jump(x.kind, x.m, x.at, x.text, x.target, x.display)));
    const voiceStaff = new Map((plan.voices || []).map(v => [v.id, v.staff]));
    (plan.parts || []).forEach(p => {
      put(p.id, 'part', sig.part(p.instrument));
      if (p.name !== undefined && p.name !== null && p.name !== '') put(ref.partName(p.id), 'part-name', sig.text(p.name));
      if (p.abbr !== undefined && p.abbr !== null && p.abbr !== '') put(ref.partAbbr(p.id), 'part-abbr', sig.text(p.abbr));
    });
    (plan.staves || []).forEach(s => put(s.id, 'staff', sig.staff(s.kind, s.lines)));
    (plan.voices || []).forEach(v => put(v.id, 'voice', sig.voice(v.staff, v.label)));
    (plan.clefs || []).forEach(c => put(c.id, 'clef', sig.clef(c.staff, c.m, c.at, c.sign, c.line, c.octave)));
    (plan.events || []).forEach(e => {
      put(e.id, e.grace ? 'grace' : e.kind === 'rest' ? 'rest' : e.kind === 'perc' ? 'perc' : 'note',
        sig.event(e.kind, e.m, e.at, e.dur, e.staff, e.voice, e.grace, e.hidden, e.cue, e.type, e.dots));
      if (e.stemStated !== undefined && e.stemStated !== null) put(ref.stem(e.id), 'stem', sig.value(e.stemStated));
      if (e.restPos) put(ref.restPos(e.id), 'rest-position', sig.step(e.restPos.step, e.restPos.oct));
      if (e.measureRest) put(ref.measureRest(e.id), 'measure-rest', sig.value(true));
      if (e.size) put(ref.size(e.id), 'size', sig.value(e.size));
      if (e.hidden) put(ref.hidden(e.id), 'hidden', sig.value(true));
      if (e.cue) put(ref.cue(e.id), 'cue', sig.value(true));
      if (voiceStaff.has(e.voice) && voiceStaff.get(e.voice) !== e.staff) put(ref.eventStaff(e.id), 'cross-staff-event', sig.value(e.staff));
      (e.arts || []).forEach((a, i) => put(ref.art(e.id, i), 'articulation', sig.value(a)));
      (e.orn || []).forEach((o, i) => put(ref.orn(e.id, i), 'ornament', sig.orn(o)));
      if (e.fermata) put(ref.fermata(e.id), 'fermata', sig.fermata(e.fermata));
      (e.lyrics || []).forEach((l, i) => put(ref.lyric(e.id, i), 'lyric', sig.lyric(l)));
      (e.heads || []).forEach(h => {
        put(h.id, 'head', sig.head(h.staff, h.pitch, h.inst, h.pos, h.lead));
        if (h.acc) put(ref.acc(h.id), 'accidental', sig.acc(h.acc));
        (h.fingering || []).forEach((f, i) => put(ref.fingering(h.id, i), 'fingering', sig.fingering(f)));
        if (h.notehead) put(ref.notehead(h.id), 'notehead', sig.notehead(h.notehead));
        if (h.crossStaff) put(ref.headStaff(h.id), 'cross-staff-head', sig.value(h.staff));
        if (h.tech) put(ref.tech(h.id), 'technical', J([nz(h.tech.string), nz(h.tech.fret)]));
      });
    });
    (plan.marks || []).forEach(d => put(d.id, d.kind, sig.direction({ kind: d.kind, m: d.m, at: d.at, staff: d.staff, voice: d.voice,
      event: d.event, placement: d.placement, value: d.value, text: d.text, root: d.root, chordKind: d.chordKind, bass: d.bass, degrees: d.degrees })));
    (plan.ties || []).forEach(t => put(t.id, 'tie', sig.tie(t.from, t.to)));
    (plan.slurs || []).forEach(s => put(s.id, 'slur', sig.slur(s.from, s.to, s.placement, s.line)));
    (plan.lines || []).forEach(l => {
      switch (l.kind) {
        case 'wedge': put(l.id, 'wedge', sig.wedge(l.wedge, l.staff, pos(l.from), pos(l.to), l.placement, l.niente)); break;
        case 'pedal':
          put(l.id, 'pedal', sig.pedal(l.pedal, pos(l.from), pos(l.to), l.mark, l.text, l.soundOnly));
          (l.changes || []).forEach((c, i) => put(ref.pedalChange(l.id, i), 'pedal-change', sig.pos(pos(c))));
          break;
        case 'ottava': put(l.id, 'ottava', sig.ottava(l.shift, l.staff, pos(l.from), pos(l.to))); break;
        case 'gliss': put(l.id, 'gliss', sig.gliss(l.from, l.to, l.slide, l.line, l.text, l.placement)); break;
        case 'arpeggio': put(l.id, 'arpeggio', sig.arpeggio(l.heads, l.dir, l.non)); break;
        default: put(l.id, l.kind, null);
      }
    });
    (plan.beams || []).forEach(b => {
      put(b.id, 'beam', sig.beam(b.events, b.breaks));
      if (b.source === 'graph') (b.breaks || []).forEach((x, i) => put(ref.beamBreak(b.id, i), 'beam-break', sig.beamBreak(x.after, x.level)));
    });
    (plan.tuplets || []).forEach(t => {
      if (t.source === 'merged') {
        /* a display group: each one-note tuplet it shows is carried as that tuplet, and the group itself too */
        put(t.id, 'tuplet-group', sig.tuplet(t.events, t.actual, t.normal, t.unit, null));
        (t.members || []).forEach((sid, k) => put(sid, 'tuplet', sig.tuplet([t.events[k]], t.actual, t.normal,
          t.memberUnits ? t.memberUnits[k] : t.unit, null)));
      } else put(t.id, 'tuplet', sig.tuplet(t.events, t.actual, t.normal, t.unit, t.parent));
    });
    return items;
  }

  /* ---------------------------------------------------------------- audit */
  function audit(g, plan) {
    const exp = expected(g), out = consumed(plan);
    const seen = new Map();
    const duplicate = [], invented = [], kindMismatch = [], missing = [], altered = [], badStatus = [], unapproved = [], uncoded = [];
    const own = r => r.indexOf('d:') === 0 || r.indexOf('p:') === 0;
    const ledgered = new Set();
    (plan.ledger || []).forEach(en => {
      if (seen.has(en.ref)) duplicate.push(en.ref);
      seen.set(en.ref, en);
      ledgered.add(en.ref);
      if (STATUS.indexOf(en.status) < 0) { badStatus.push(en.ref); return; }
      if (en.status === 'projected-loss') { if (en.ref.indexOf('p:') !== 0) invented.push(en.ref); if (!en.code) uncoded.push(en.ref); return; }
      if (en.status !== 'drawn' && !en.code) uncoded.push(en.ref);
      if (en.code && CODES[en.status].indexOf(en.code) < 0) unapproved.push(en.ref + ' ' + en.status + ':' + en.code);
      const x = exp.get(en.ref);
      if (!own(en.ref) && !x) invented.push(en.ref);
      if (x && x.kind !== en.kind) kindMismatch.push(en.ref + ' ' + x.kind + '/' + en.kind);
      /* what the ledger says is drawn, merged or derived must be in the output */
      if ((en.status === 'drawn' || en.status === 'merged' || en.status === 'derived') && !out.has(en.ref)) missing.push(en.ref);
    });
    /* whatever the output carries of the graph must say what the graph says, whatever its status; anything else
       it carries must be a derived object the ledger names (a merged group is named by its members' entries) */
    const groups = new Set();
    (plan.ledger || []).forEach(en => { if (en.status === 'merged' && en.plan) groups.add(en.plan); });
    const orphan = [];
    out.forEach((o, r) => {
      if (exp.has(r)) { if (exp.get(r).sig !== o.sig) altered.push(r); return; }
      if (o.kind === 'tuplet-group' ? groups.has(r) : ledgered.has(r) && own(r)) return;
      orphan.push(r);
    });
    const silent = [];
    exp.forEach((x, r) => { if (!seen.has(r)) silent.push(r); });
    const byKind = {};
    const bump = (kind, status) => {
      const k = byKind[kind] = byKind[kind] || { total: 0, drawn: 0, derived: 0, merged: 0, suppressed: 0, deferred: 0, 'projected-loss': 0, silent: 0 };
      k[status]++;
      if (status !== 'derived' && status !== 'projected-loss') k.total++;
    };
    seen.forEach(en => { if (STATUS.indexOf(en.status) >= 0) bump(en.kind, en.status); });
    silent.forEach(r => bump(exp.get(r).kind, 'silent'));
    const codes = {};
    seen.forEach(en => { if (en.code) { const c = en.kind + ':' + en.status + ':' + en.code; codes[c] = (codes[c] || 0) + 1; } });
    const problems = { silent, invented, duplicate, kindMismatch, missing, altered, orphan, badStatus, unapproved, uncoded };
    return Object.assign({
      ok: Object.keys(problems).every(k => problems[k].length === 0),
      inventory: exp.size, entries: seen.size, output: out.size,
      byKind: byKind, codes: codes
    }, problems);
  }

  return Object.freeze({ STATUS, CODES, DEFERRED_ALLOWED, ref, META_FIELDS, CLEF_LINE, sig, expected, inventory, consumed, audit });
});
