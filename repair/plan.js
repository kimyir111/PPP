/* ============================================================================
   PPP Repair - the note-level planner (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5 G9b).

   Pure functions over a plain note list (songgraph/util.js `noteWindows` shape, plus a few
   annotations added by `annotate`). Nothing here touches a ScoreGraph: a "unit" is only a
   PROPOSAL - {op, m, key, edits:[{headId, eventId, from, to} | {headId, eventId, drop:true}]} -
   which `repair/index.js` then applies to a real graph and accepts or rolls back against the
   real critics (G5 hard filter for the request's hand profile first).

   ---- what can be repaired: only what a G9a critic can DETECT, done deterministically ----
   Every pitch edit is an OCTAVE displacement (+-12, +-24) of one head: same pitch class, same
   letter and alteration (only `oct` changes), so spelling, accidentals and - up to the harmony
   window's bass tie-break - the chord read by `songgraph/harmony.js` are untouched. The one
   other edit is dropping an octave-doubled head. Four ops:

     parallel      critics/voice-leading.js `parallels` - consecutive slices whose two OUTER
                   voices move in similar motion between the same perfect interval class.
                   Fix: octave-displace one non-melody outer note of the second slice (for a
                   chord's lowest note this IS the classic re-voicing: the bass note goes up
                   an octave, the chord turns one inversion).
     innerLeap     `innerLeaps` - a voice leaping more than an octave while genuinely inner.
                   Fix: displace one endpoint by an octave towards the other.
     crossing      `crossings` - two voices of one part sounding in the reverse of their own
                   whole-piece register order. Fix: displace one of the pair by 1-2 octaves.
     dropDoubling  critics/register-density.js `chordLoad` - a measure whose chord load is
                   above the stage's real ceiling. Fix: drop an octave DOUBLING (a head whose
                   pitch class is already in the same hand's attack, in the same event): the
                   pitch-class content of the chord is kept, only the doubling goes. NOT a
                   fix for notesPerBeat/density overage: that would need notes deleted, so it
                   is left alone (declared in the doc, not silently ignored).

   ---- never repaired away from the source (G9f) ----
   A smell that the source graph has too, at the same place, is not the arrangement's doing, and a repair must not change notes the source itself wrote that way
   (hanon/010 is built on deliberate parallel octaves between the hands). `ctx.sourceSmells` (the source graph's own critics/voice-leading.js smells) and
   `ctx.sourcePitchAt` (the pitches the source sounds at each onset); repair/index.js repairSelection supplies both, `opts.sourceGuard: false` turns it off. "The same" is:
   the same onset and, for a parallel, the same interval and (mod an octave) the same pitches of both slices' outer pair; for an inner leap and a crossing, the exact
   pitches. Such a smell is still planned, but only towards the source: a candidate move is allowed only if the new pitch is nearer than the old one to a pitch of the same pitch class that the source sounds at that onset. So an
   arrangement that IS the source is left alone, and one the realizer put an octave away from it can still be brought back. The smell stays counted. dropDoubling
   (chord load) is a different smell and keeps its rule.

   ---- never touched ----
   * a note that matches the request's ORIGINAL melody (onset within 0.15 quarter, same
     pitch - the exact match `critics/metrics.js melodyPreservation` scores). With no melody
     given, the top note of every onset slice is protected instead (conservative).
   * a head that any tie, glissando, arpeggio or performance-layer link refers to (moving it would
     change what the tie joins) and a grace note.
   Constraints every candidate must meet, declared here up front:
     - a same-line smoothness bound: the moved note's interval to the nearest note of its own
       voice at the previous / next onset may not exceed max(its old interval, SMOOTH_MAX);
       this is what keeps a stepwise run (an octave-doubled scale, say) from being "fixed"
       into a row of octave leaps - such a smell is left in place instead;
     - the register floor (`ctx.registerFloor`, realize/theory.js REGISTER_FLOOR unless overridden): no edit puts a
       note below the floor, or lower than it was when it already sits below it (`belowFloor`);
     - the new pitch stays inside the piece's own existing overall pitch range (so the G6
       `range` feature cannot grow), inside 21..108, and does not duplicate a pitch
       already in the same event;
     - no NEW hand crossing (an LH head stays below every RH head sounding at its onset and
       vice versa, where it was so before);
     - the note-level smell count must strictly fall (a dropDoubling: not rise) and no
       category (parallels/innerLeaps/crossings) may rise.
   Tie-break, fully deterministic: fewest smells after, smallest |octave shift|, then the
   fixed candidate order (shift +12 before -12 on the low side, -12 before +12 on the high
   side, then +-24). No randomness, no clock. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'),
      require('../songgraph/util.js'), require('../critics/voice-leading.js'), require('../critics/left-hand-jump.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const M = root.PPPRepairModules = root.PPPRepairModules || {};
    M.plan = factory(SG.rational, SG.pitch, SGG.util, (root.PPPCriticsModules || {}).voiceLeading, (root.PPPCriticsModules || {}).leftHandJump);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P, U, VL, LHJ) {
  'use strict';

  const SMOOTH_MAX = 9;         /* semitones: a major sixth - the widest line-leap a repair may introduce */
  const MELODY_TOL_Q = 0.15;    /* quarters: the same tolerance critics/metrics.js melodyPreservation uses */
  const MIDI_LO = 21, MIDI_HI = 108;
  const CATS = ['parallels', 'innerLeaps', 'crossings'];

  /* ---- annotation: what a note is, beyond what noteWindows says ---- */
  function annotate(g, ctx) {
    ctx = ctx || {};
    const notes = U.noteWindows(g);
    const info = new Map();
    const locked = new Set();
    (g.performances || []).forEach(pf => (pf.notes || []).forEach(pn => { if (pn.link !== undefined) locked.add(pn.link); }));
    g.parts.forEach(part => {
      (part.spanners || []).forEach(s => {
        if (s.type === 'tie' || s.type === 'gliss') { if (s.from !== undefined) locked.add(s.from); if (s.to !== undefined) locked.add(s.to); }
        else if (s.type === 'arpeggio') (s.heads || []).forEach(h => locked.add(h));
      });
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        (e.heads || []).forEach(h => {
          if (!h.pitch) return;
          info.set(h.id, { limb: P.limbOf(part, e, h), pitch: h.pitch, eventId: e.id, nHeads: e.heads.length });
        });
      });
    });
    const melodyByMidi = new Map();
    (ctx.origMelody || []).forEach(o => { if (!melodyByMidi.has(o.midi)) melodyByMidi.set(o.midi, []); melodyByMidi.get(o.midi).push(o.onsetQ); });
    notes.forEach(n => {
      const i = info.get(n.headId) || {};
      n.limb = i.limb; n.pitch = i.pitch; n.nHeads = i.nHeads;
      n.onsetQ = R.toNumber(n.w0) * 4;
      n.locked = locked.has(n.headId);
      n.prot = false;
      if (ctx.origMelody) {
        const list = melodyByMidi.get(n.midi);
        n.prot = !!list && list.some(q => Math.abs(q - n.onsetQ) <= MELODY_TOL_Q);
      }
    });
    if (!ctx.origMelody) {
      /* no melody supplied: protect the top note of each onset slice, conservatively */
      VL.slicesFromNotes(notes).forEach(s => {
        let hi = -Infinity; s.notes.forEach(n => { if (n.midi > hi) hi = n.midi; });
        s.notes.forEach(n => { if (n.midi === hi) n.prot = true; });
      });
    }
    /* the piece's own overall pitch range: a repair may move a note anywhere inside it, never past it,
       so the G6 `range` feature cannot grow */
    const pieceRange = { lo: Infinity, hi: -Infinity };
    notes.forEach(n => { if (n.midi < pieceRange.lo) pieceRange.lo = n.midi; if (n.midi > pieceRange.hi) pieceRange.hi = n.midi; });
    return { notes: notes, pieceRange: pieceRange, avgByPart: VL.voiceAveragesOf(g), floor: ctx.registerFloor == null ? null : ctx.registerFloor,
      /* left-hand jump guard (G9 post-H-8 re-look): on unless ctx.leftHandJumpGuard === false; the index is built lazily */
      lhGuard: ctx.leftHandJumpGuard !== false, lhIdx: null,
      /* the smells the source graph itself has (G9f): never planned */
      srcKeys: ctx.sourceSmells ? sourceKeysOf(ctx.sourceSmells) : null,
      /* the pitches the source sounds at each onset ({w0 -> Set of midi}): what a source-matched smell may be moved TOWARDS */
      srcPitchAt: ctx.sourcePitchAt || null };
  }

  /* the identity of a smell, for the "the source has it too" rule (G9f). A parallel is the relation between the two outer voices, so it is compared modulo an octave
     (an arrangement that sits an octave from its source still has the source's parallel octaves): {w0, interval, the pitch classes of both slices' outer pair}. An inner
     leap and a crossing are compared by the EXACT pitches ({w0, from, to} and {w0, the two midis}): a coincidence of pitch classes (two inner voices of a hymn that share
     {C, A}) is not the same smell */
  const pc = m => ((m % 12) + 12) % 12;
  function smellId(kind, s) {
    if (kind === 'parallel') return 'P|' + s.w0 + '|' + s.interval + '|' + [s.from.hi, s.from.lo, s.to.hi, s.to.lo].map(pc).join(',');
    if (kind === 'innerLeap') return 'L|' + s.w0 + '|' + s.from + ',' + s.to;
    return 'X|' + s.w0 + '|' + s.midis.slice().sort((a, b) => a - b).join(',');
  }
  /* the set of smell identities of a smells result (VL.smellsFromNotes / voiceLeadingSmells) */
  function sourceKeysOf(sm) {
    const out = new Set();
    if (!sm) return out;
    (sm.parallels || []).forEach(s => out.add(smellId('parallel', s)));
    (sm.innerLeaps || []).forEach(s => out.add(smellId('innerLeap', s)));
    (sm.crossings || []).forEach(s => out.add(smellId('crossing', s)));
    return out;
  }

  function smellsOf(state, notes) { return VL.smellsFromNotes(notes || state.notes, state.avgByPart); }

  /* ---- constraints ---- */
  function movable(n) { return !n.prot && !n.locked && n.pitch && n.limb; }

  function lineNeighbours(state, n) {
    /* the nearest same-voice note strictly before / after n's onset (closest in pitch when a chord
       leaves several): the moved note's own line, for the smoothness bound */
    if (!state.voiceSeq) {
      state.voiceSeq = new Map();
      state.notes.forEach(x => {
        const k = x.partId + '|' + x.voiceId;
        if (!state.voiceSeq.has(k)) state.voiceSeq.set(k, new Map());
        const byOnset = state.voiceSeq.get(k), w = R.format(x.w0);
        if (!byOnset.has(w)) byOnset.set(w, { w0: x.w0, notes: [] });
        byOnset.get(w).notes.push(x);
      });
      state.voiceSeq.forEach((byOnset, k) => state.voiceSeq.set(k, Array.from(byOnset.values()).sort((a, b) => R.cmp(a.w0, b.w0))));
    }
    const seq = state.voiceSeq.get(n.partId + '|' + n.voiceId) || [];
    let idx = -1;
    for (let i = 0; i < seq.length; i++) if (R.eq(seq[i].w0, n.w0)) { idx = i; break; }
    return { prev: idx > 0 ? seq[idx - 1].notes : [], next: idx >= 0 && idx < seq.length - 1 ? seq[idx + 1].notes : [] };
  }
  const nearest = (list, midi) => list.length ? Math.min.apply(null, list.map(x => Math.abs(x.midi - midi))) : null;

  function smoothOk(state, n, newMidi) {
    const nb = lineNeighbours(state, n);
    return [nb.prev, nb.next].every(list => {
      const oldI = nearest(list, n.midi), newI = nearest(list, newMidi);
      return oldI == null || newI <= Math.max(oldI, SMOOTH_MAX);
    });
  }

  /* the register floor's repair guard (G9 post-H-8): an edit may never put a note below the floor, or lower
     than it already was when it is below the floor (a note the source or the realizer left down there may be
     moved UP, even if that is still short of the floor, never further down). `floor` null: no guard. */
  function belowFloor(from, to, floor) { return floor != null && to < floor && to < from; }

  function candidateOk(state, n, newMidi) {
    if (belowFloor(n.midi, newMidi, state.floor)) return false;
    if (newMidi < MIDI_LO || newMidi > MIDI_HI || newMidi === n.midi) return false;
    if (newMidi < state.pieceRange.lo || newMidi > state.pieceRange.hi) return false;
    /* not a pitch already in the same event or the same hand attack */
    if (state.notes.some(x => x !== n && x.headId !== n.headId && R.eq(x.w0, n.w0) && x.limb === n.limb && x.midi === newMidi)) return false;
    /* no NEW hand crossing at this onset */
    const others = state.notes.filter(x => x !== n && R.eq(x.w0, n.w0) && x.limb && x.limb !== n.limb && (x.limb === 'RH' || x.limb === 'LH'));
    if (n.limb === 'LH') { if (others.some(x => newMidi >= x.midi && n.midi < x.midi)) return false; }
    else if (n.limb === 'RH') { if (others.some(x => newMidi <= x.midi && n.midi > x.midi)) return false; }
    if (!smoothOk(state, n, newMidi)) return false;
    return !createsLeftHandJump(state, n, newMidi);
  }

  /* the left-hand jump guard (G9 post-H-8 re-look): an edit may not create a jump (the lowest note below middle C moving an
     octave or more between consecutive onsets, critics/left-hand-jump.js) that was not there before. It may move a note out
     of a jump, or leave one in place; it may never add one. `ctx.leftHandJumpGuard: false` turns it off. */
  function createsLeftHandJump(state, n, newMidi) {
    if (!state.lhGuard) return false;
    if (!state.lhIdx) state.lhIdx = LHJ.bassIndex(state.notes);
    return LHJ.createsJump(state.lhIdx, n.onsetQ, n.midi, newMidi);
  }

  function withShift(notes, n, newMidi) {
    const i = notes.indexOf(n);
    const out = notes.slice();
    out[i] = Object.assign({}, n, { midi: newMidi, pc: ((newMidi % 12) + 12) % 12 });
    return out;
  }

  const noRise = (a, b) => CATS.every(c => a[c].length <= b[c].length);

  /* choose the best candidate {note, shift} for a smell: strictly fewer smells, none of the three
     categories up; tie-break as documented in the header */
  function towardSource(state, n, newMidi) {
    const set = state.srcPitchAt && state.srcPitchAt.get(R.format(n.w0));
    if (!set) return false;
    const same = Array.from(set).filter(x => ((x % 12) + 12) % 12 === n.pc);
    if (!same.length) return false;
    const dist = m => Math.min.apply(null, same.map(x => Math.abs(x - m)));
    return dist(newMidi) < dist(n.midi);
  }

  function bestShift(state, before, cands, op, key, fromSource) {
    let best = null;
    cands.forEach((c, order) => {
      if (!movable(c.note) || !candidateOk(state, c.note, c.note.midi + c.shift)) return;
      /* a smell the source has too (G9f) is repaired ONLY towards the source: the new pitch must be nearer than the old one to a pitch of the same pitch class that the source sounds at that
         onset (a source pitch itself is distance 0). An arrangement that IS the source cannot get nearer, so it is left; one the realizer put octaves away from it may be brought back. */
      if (fromSource && !towardSource(state, c.note, c.note.midi + c.shift)) return;
      const after = smellsOf(state, withShift(state.notes, c.note, c.note.midi + c.shift));
      if (!(after.count < before.count) || !noRise(after, before)) return;
      const score = [after.count, Math.abs(c.shift), order];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) best = { c: c, score: score, after: after.count };
    });
    if (!best) return null;
    const n = best.c.note;
    return { op: op, m: n.m, key: key, smellsBefore: before.count, smellsAfter: best.after,
      edits: [{ headId: n.headId, eventId: n.eventId, from: n.midi, to: n.midi + best.c.shift, pitch: n.pitch }] };
  }

  const SHIFTS_LOW = [12, -12, 24, -24];
  const SHIFTS_HIGH = [-12, 12, -24, 24];

  /* ---- one smell -> one unit (or null: not repairable within the constraints) ---- */
  function planParallel(state, before, s, fromSource) {
    const slice = VL.slicesFromNotes(state.notes).find(x => R.format(x.w0) === s.w0);
    if (!slice) return null;
    const outer = VL.outerPairOf(slice);
    if (!outer) return null;
    const lows = slice.notes.filter(n => n.midi === outer.lo), highs = slice.notes.filter(n => n.midi === outer.hi);
    const cands = [];
    lows.forEach(n => SHIFTS_LOW.forEach(sh => cands.push({ note: n, shift: sh })));
    highs.forEach(n => SHIFTS_HIGH.forEach(sh => cands.push({ note: n, shift: sh })));
    return bestShift(state, before, cands, 'parallel', 'parallel|' + s.w0, fromSource);
  }

  function planInnerLeap(state, before, s, fromSource) {
    const seq = state.notes.filter(n => n.voiceId === s.voiceId && R.format(n.w0) === s.w0 && n.midi === s.to);
    const b = seq[0];
    if (!b) return null;
    const as = state.notes.filter(n => n.voiceId === b.voiceId && n.partId === b.partId && n.midi === s.from && R.lt(n.w0, b.w0));
    const a = as.sort((x, y) => R.cmp(y.w0, x.w0))[0];
    const cands = [];
    const towardA = Math.sign(s.from - s.to) * 12, towardB = -towardA;
    cands.push({ note: b, shift: towardA });
    if (a) cands.push({ note: a, shift: towardB });
    cands.push({ note: b, shift: towardA * 2 });
    if (a) cands.push({ note: a, shift: towardB * 2 });
    return bestShift(state, before, cands, 'innerLeap', 'leap|' + s.voiceId + '|' + s.w0, fromSource);
  }

  function planCrossing(state, before, s, fromSource) {
    const at = state.notes.filter(n => n.partId === s.part && R.format(n.w0) === s.w0 && s.voices.indexOf(n.voiceId) >= 0);
    const cands = [];
    at.forEach(n => [12, -12, 24, -24].forEach(sh => cands.push({ note: n, shift: sh })));
    return bestShift(state, before, cands, 'crossing', 'cross|' + s.part + '|' + s.w0 + '|' + s.voices.join(','), fromSource);
  }

  /* every detected smell, in score order (then category order): the planner walks this list */
  function listSmells(state) {
    const sm = smellsOf(state);
    const out = [];
    const src = state.srcKeys;
    const add = (kind, s) => out.push(src && src.has(smellId(kind, s)) ? { kind: kind, s: s, src: true } : { kind: kind, s: s });
    sm.parallels.forEach(s => add('parallel', s));
    sm.innerLeaps.forEach(s => add('innerLeap', s));
    sm.crossings.forEach(s => add('crossing', s));
    const w = x => R.toNumber(R.parse(x.s.w0));
    out.sort((a, b) => (w(a) - w(b)) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    return { smells: sm, list: out };
  }

  function smellKey(item) {
    const s = item.s;
    if (item.kind === 'parallel') return 'parallel|' + s.w0;
    if (item.kind === 'innerLeap') return 'leap|' + s.voiceId + '|' + s.w0;
    return 'cross|' + s.part + '|' + s.w0 + '|' + s.voices.join(',');
  }

  function planSmell(state, before, item) {
    if (item.kind === 'parallel') return planParallel(state, before, item.s, item.src);
    if (item.kind === 'innerLeap') return planInnerLeap(state, before, item.s, item.src);
    return planCrossing(state, before, item.s, item.src);
  }

  /* dropDoubling proposals for one measure (`m` is a measure id): every same-hand attack in that
     measure whose event carries two heads of one pitch class; the drop candidate is the upper
     duplicate for the left hand (keep the bass), the lower one for the right (keep the top). */
  function planDropDoubling(state, before, m, failed) {
    const groups = new Map();
    state.notes.forEach(n => {
      if (n.m !== m || !n.limb) return;
      const k = n.eventId;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    });
    const units = [];
    Array.from(groups.keys()).sort().forEach(k => {
      const ns = groups.get(k);
      if (ns.length < 2) return;
      const byPc = new Map();
      ns.forEach(n => { if (!byPc.has(n.pc)) byPc.set(n.pc, []); byPc.get(n.pc).push(n); });
      Array.from(byPc.keys()).sort((a, b) => a - b).forEach(pc => {
        const dup = byPc.get(pc);
        if (dup.length < 2) return;
        const sorted = dup.slice().sort((a, b) => a.midi - b.midi);
        const order = ns[0].limb === 'LH' ? sorted.slice().reverse() : sorted; /* LH: upper first; RH: lower first */
        const target = order.find(n => movable(n));
        if (!target) return;
        const key = 'drop|' + target.headId;
        if (failed && failed.has(key)) return;
        const rest = state.notes.filter(x => x !== target);
        const after = smellsOf(state, rest);
        if (!noRise(after, before)) return;
        units.push({ op: 'dropDoubling', m: target.m, key: key, smellsBefore: before.count, smellsAfter: after.count,
          edits: [{ headId: target.headId, eventId: target.eventId, from: target.midi, drop: true }] });
      });
    });
    return units;
  }

  return Object.freeze({ SMOOTH_MAX, MELODY_TOL_Q, CATS, belowFloor, createsLeftHandJump, annotate, smellId, sourceKeysOf, smellsOf, listSmells, smellKey, planSmell, planDropDoubling, movable });
});
