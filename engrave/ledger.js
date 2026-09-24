/* ============================================================================
   PPP engrave — the fidelity ledger (docs/GOALS/G04 §8.3, §21.1 L1)

   inventory(graph)    every notation object the graph states, by reference:
                       what a renderer owes the reader. Walked from the
                       schema's own fields, independently of the plan, so a
                       plan that forgets something cannot also forget to
                       count it.
   audit(graph, plan)  the plan's ledger against that inventory:
                         silent     stated by the graph, no ledger entry
                         invented   a ledger entry the graph does not state
                                    (derived objects excepted: 'd:' refs)
                         duplicate  two entries for one reference
                         missing    'drawn' but the plan holds no object
                       and the counts by kind and status.
   ref.*               how a reference is spelled, shared with the plan

   A reference is a graph ID, or a graph ID and a sub-item for what the graph
   keeps inside an object without an ID of its own (an articulation is
   `e12#art0`, a pedal change `s7#change1`).

   Not in the inventory, on purpose (G04 §8.6): source layout geometry
   (display.x, Measure.layout.width), ext.* data, provenance, performances,
   instrument data, voice and staff limbs, and a note's type and dots (the
   note itself is the entry: its glyph is its value).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).ledger = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ledger statuses (G04 §8.3). 'merged' with code 'merged-for-display' is G4-U2's display-only grouping. */
  const STATUS = Object.freeze(['drawn', 'derived', 'merged', 'suppressed', 'deferred']);

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
    beamBreak: (sid, i) => sid + '#break' + i,
    pedalChange: (sid, i) => sid + '#change' + i,
    barline: (mid, side) => mid + '#bar.' + side,
    barFermata: (mid, side) => mid + '#bar.' + side + '.fermata',
    multiRest: mid => mid + '#multirest',
    layoutBreak: mid => mid + '#break',
    phrase: i => 'phrase#' + i,
    section: i => 'section#' + i,
    meta: field => 'meta.' + field,
    derived: (kind, first) => 'd:' + kind + ':' + first
  });

  const META_FIELDS = ['title', 'subtitle', 'composer', 'arranger', 'lyricist', 'copyright', 'workNumber', 'movementNumber',
    'movementTitle'];

  /* graph -> Map(ref -> kind) */
  function inventory(g) {
    const items = new Map();
    const put = (r, kind) => { items.set(r, kind); };
    const meta = g.meta || {};
    META_FIELDS.forEach(f => { if (meta[f] !== undefined && meta[f] !== '') put(ref.meta(f), 'meta'); });
    const tl = g.timeline || {};
    (tl.measures || []).forEach(m => {
      put(m.id, 'measure');
      if (m.multiRest) put(ref.multiRest(m.id), 'multi-rest');
      if (m.layout && (m.layout.newSystem || m.layout.newPage)) put(ref.layoutBreak(m.id), 'layout-break');
      ['left', 'right'].forEach(side => {
        const b = m.barline && m.barline[side];
        if (!b) return;
        if (b.style !== undefined || b.repeat !== undefined) put(ref.barline(m.id, side), 'barline');
        if (b.fermata !== undefined) put(ref.barFermata(m.id, side), 'fermata');
      });
    });
    (tl.meters || []).forEach(x => put(x.id, 'meter'));
    (tl.keys || []).forEach(x => put(x.id, 'key'));
    (tl.tempos || []).forEach(x => put(x.id, 'tempo'));
    (tl.endings || []).forEach(x => put(x.id, 'ending'));
    (tl.jumps || []).forEach(x => put(x.id, 'jump'));
    (g.parts || []).forEach(p => {
      put(p.id, 'part');
      const staffOfVoice = new Map((p.voices || []).map(v => [v.id, v.staff]));
      (p.staves || []).forEach(s => put(s.id, 'staff'));
      (p.voices || []).forEach(v => put(v.id, 'voice'));
      (p.clefs || []).forEach(c => put(c.id, 'clef'));
      (p.events || []).forEach(e => {
        put(e.id, e.grace ? 'grace' : e.kind === 'rest' ? 'rest' : e.kind === 'perc' ? 'perc' : 'note');
        const d = e.display || {};
        if (d.stem !== undefined) put(ref.stem(e.id), 'stem');
        if (d.pos !== undefined) put(ref.restPos(e.id), 'rest-position');
        if (d.measureRest) put(ref.measureRest(e.id), 'measure-rest');
        if (d.size !== undefined) put(ref.size(e.id), 'size');
        if (e.hidden) put(ref.hidden(e.id), 'hidden');
        if (e.cue) put(ref.cue(e.id), 'cue');
        if (staffOfVoice.has(e.voice) && staffOfVoice.get(e.voice) !== e.staff) put(ref.eventStaff(e.id), 'cross-staff-event');
        (e.arts || []).forEach((a, i) => put(ref.art(e.id, i), 'articulation'));
        (e.orn || []).forEach((o, i) => put(ref.orn(e.id, i), 'ornament'));
        if (e.fermata !== undefined) put(ref.fermata(e.id), 'fermata');
        (e.lyrics || []).forEach((l, i) => put(ref.lyric(e.id, i), 'lyric'));
        (e.heads || []).forEach(h => {
          put(h.id, 'head');
          if (h.acc !== undefined) put(ref.acc(h.id), 'accidental');
          (h.fingering || []).forEach((f, i) => put(ref.fingering(h.id, i), 'fingering'));
          if (h.notehead !== undefined) put(ref.notehead(h.id), 'notehead');
          if (h.staff !== undefined && h.staff !== e.staff) put(ref.headStaff(h.id), 'cross-staff-head');
        });
      });
      (p.directions || []).forEach(d => put(d.id, d.kind));
      (p.spanners || []).forEach(s => {
        put(s.id, s.type);
        if (s.type === 'beam') (s.breaks || []).forEach((b, i) => put(ref.beamBreak(s.id, i), 'beam-break'));
        if (s.type === 'pedal') (s.changes || []).forEach((c, i) => put(ref.pedalChange(s.id, i), 'pedal-change'));
      });
    });
    const st = g.structure || {};
    (st.phrases || []).forEach((x, i) => put(ref.phrase(i), 'phrase'));
    (st.sections || []).forEach((x, i) => put(ref.section(i), 'section'));
    return items;
  }

  function audit(g, plan) {
    const inv = inventory(g);
    const seen = new Map();
    const duplicate = [], invented = [], kindMismatch = [], missing = [], badStatus = [];
    const index = plan.index || new Set();
    (plan.ledger || []).forEach(en => {
      if (seen.has(en.ref)) duplicate.push(en.ref);
      seen.set(en.ref, en);
      if (STATUS.indexOf(en.status) < 0) badStatus.push(en.ref);
      const derived = en.ref.indexOf('d:') === 0;
      if (!derived && !inv.has(en.ref)) invented.push(en.ref);
      if (!derived && inv.has(en.ref) && inv.get(en.ref) !== en.kind) kindMismatch.push(en.ref + ' ' + inv.get(en.ref) + '/' + en.kind);
      if ((en.status === 'drawn' || en.status === 'derived' || en.status === 'merged') && en.plan !== undefined && !index.has(en.plan)) missing.push(en.ref);
    });
    const silent = [];
    inv.forEach((kind, r) => { if (!seen.has(r)) silent.push(r); });
    const byKind = {};
    const bump = (kind, status) => {
      const k = byKind[kind] = byKind[kind] || { total: 0, drawn: 0, derived: 0, merged: 0, suppressed: 0, deferred: 0, silent: 0 };
      k[status]++;
      if (status !== 'derived') k.total++;
    };
    seen.forEach(en => { if (STATUS.indexOf(en.status) >= 0) bump(en.kind, en.status); });
    silent.forEach(r => bump(inv.get(r), 'silent'));
    const codes = {};
    seen.forEach(en => { if (en.code) { const c = en.kind + ':' + en.status + ':' + en.code; codes[c] = (codes[c] || 0) + 1; } });
    return {
      ok: !silent.length && !invented.length && !duplicate.length && !kindMismatch.length && !missing.length && !badStatus.length,
      inventory: inv.size, entries: seen.size,
      silent: silent, invented: invented, duplicate: duplicate, kindMismatch: kindMismatch, missing: missing, badStatus: badStatus,
      byKind: byKind, codes: codes
    };
  }

  return Object.freeze({ STATUS, ref, META_FIELDS, inventory, audit });
});
