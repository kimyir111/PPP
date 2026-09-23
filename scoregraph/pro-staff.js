/* ============================================================================
   PPP ScoreGraph — G3 pass P2: hands, staves and clefs (docs/GOALS/G03 §9)
   and the automatic 8va (§13.3, off by default: D2)

   In a piano part (two staves, one RH and one LH) each sounding note gets a
   hand (limb) and so a staff: staff = limb (§9.2), the pieces tied to a note
   go with it. The hands come from a DP over the part's onsets: at each onset
   the notes that start there are split by pitch (the left hand below, the
   right hand above: hands do not cross), and the cost (integers, ×1000) is

     span      per hand, 1500 per semitone over 12; over 14 cannot be played
     count     more than 5 notes in a hand cannot be played
     move      150 × the distance each hand's centre moves from where it last
               played, less the reach the time since gives it (6 semitones a beat)
     melody    1500 when the top note leaves the hand that had the last top note (E7),
               unless both hands played the notes before and it is nearer the left hand's
     octave    1500 when one hand takes both notes of an octave (E6)
     ledger    300 per note 4 or more ledger lines off both clefs
     tuplet    1500 when a triplet figure of one beat changes hands (E2, E3)
     keep      900 for each note moved off the staff the writer chose

   The §9.2 starting weights (melody 0.6, octave 0.4, tuplet 0.8, no keep)
   moved many notes the writer had right: core hand accuracy 0.888 -> 0.874.
   A hand with no note at an onset then had no position, and could jump for
   free; the DP now carries each hand's last centre along the best path. The
   weights above are the ones core hand accuracy picked (G03 §9.2 allows it;
   §24 record): mean 0.888 -> 0.918, no case loses the hands gate, 46 gain it.

   A note that changes hands moves as a whole event, or its heads move to a
   new event (moveHeads: head IDs kept, §9.2). A moved note that would
   overlap the notes of the other staff's voice goes to that staff's second
   voice; the rests of every voice it touched are written again (R-repr
   rewrites them after). A clef change is written where one staff's notes are
   all 4 or more ledger lines off for a whole measure or more (§9.3).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./pitch.js'), require('./ops.js'), require('./meter-grid.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proStaff = factory(M.rational, M.pitch, M.ops, M.meterGrid); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P, O, MG) {
  'use strict';

  const W = Object.freeze({ SPAN: 1500, SPAN_MAX: 14, SPAN_FREE: 12, COUNT_MAX: 5, MOVE: 150, MELODY: 1500, OCTAVE: 1500,
    LEDGER: 300, LEDGER_MIN: 4, TUPLET: 1500, KEEP: 900, REACH: 6, IMPOSSIBLE: 100000 });
  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  /* ledger lines of a written pitch on a treble (G) or bass (F) staff */
  function ledgers(pitch, clef) {
    const idx = pitch.oct * 7 + STEP_INDEX[pitch.step];
    const top = clef === 'F' ? 26 : 38, bottom = clef === 'F' ? 18 : 30;
    if (idx > top) return Math.floor((idx - top) / 2);
    if (idx < bottom) return Math.floor((bottom - idx) / 2);
    return 0;
  }

  /* The piano parts G3 may re-hand: two staves, one RH and one LH. */
  function handsOf(part) {
    if (part.staves.length !== 2) return null;
    const rh = part.staves.find(s => s.limb === 'RH'), lh = part.staves.find(s => s.limb === 'LH');
    if (!rh || !lh) return null;
    return { rh: rh.id, lh: lh.id };
  }

  /* The sounding notes of a part: {e (first piece), h (head), midi, w (onset ScorePos), pieces: [{e, h}], triplet} */
  function soundingNotes(g, part, starts) {
    const evOfHead = new Map(), tieOut = new Map(), tieIn = new Set();
    part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
    part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { tieOut.set(s.from, s.to); tieIn.add(s.to); } });
    const out = [];
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || e.cue) return;
      e.heads.forEach(h => {
        if (tieIn.has(h.id) || !h.pitch) return;
        const pieces = [{ e: e, h: h }];
        let cur = h.id, k = 0;
        while (tieOut.has(cur) && k++ < 10000) { cur = tieOut.get(cur); const x = evOfHead.get(cur); if (!x) break; pieces.push({ e: x, h: x.heads.find(y => y.id === cur) }); }
        out.push({ e: e, h: h, midi: P.midi(h.pitch), w: R.add(starts.get(e.m), R.parse(e.at)), pieces: pieces });
      });
    });
    return out;
  }

  /* The DP: groups (onsets in order, each notes sorted low to high) -> split index per group (notes below it LH). */
  function assign(groups, ctx) {
    const n = groups.length;
    if (!n) return [];
    const centre = xs => (xs.length ? xs.reduce((s, x) => s + x.midi, 0) / xs.length : null);
    const local = (grp, s) => {
      const lh = grp.notes.slice(0, s), rh = grp.notes.slice(s);
      let c = 0;
      [lh, rh].forEach((xs, hi) => {
        if (!xs.length) return;
        const span = xs[xs.length - 1].midi - xs[0].midi;
        if (span > W.SPAN_MAX) c += W.IMPOSSIBLE * (span - W.SPAN_MAX);
        else if (span > W.SPAN_FREE) c += W.SPAN * (span - W.SPAN_FREE);
        if (xs.length > W.COUNT_MAX) c += W.IMPOSSIBLE * (xs.length - W.COUNT_MAX);
        const pcs = new Map();
        xs.forEach(x => { const k = x.midi % 12; if (pcs.has(k) && xs.some(y => y !== x && Math.abs(y.midi - x.midi) === 12)) c += W.OCTAVE; pcs.set(k, true); });
        /* a staff can change clef (§9.3): a note costs ledger lines only when both clefs would leave it far off */
        xs.forEach(x => { if (Math.min(ledgers(x.h.pitch, 'F'), ledgers(x.h.pitch, 'G')) >= W.LEDGER_MIN) c += W.LEDGER; });
        xs.forEach(x => { if (x.staff !== (hi === 0 ? 'LH' : 'RH')) c += W.KEEP; });
      });
      return c;
    };
    /* a transition from state (group a, split sa, the hands' last centres `last`) to (group b, split sb) */
    const trans = (a, sa, last, b, sb) => {
      let c = 0;
      const lb = b.notes.slice(0, sb), rb = b.notes.slice(sb);
      const cl = centre(lb), cr = centre(rb);
      /* a hand moving costs by the distance from where it last played, less the reach the time since gives it */
      if (cl !== null && last.l !== null) c += Math.round(W.MOVE * Math.max(0, Math.abs(cl - last.l) - Math.max(0, b.q - last.lq) * W.REACH));
      if (cr !== null && last.r !== null) c += Math.round(W.MOVE * Math.max(0, Math.abs(cr - last.r) - Math.max(0, b.q - last.rq) * W.REACH));
      /* the top note stays in the hand that had the last top note, unless the notes before had both hands and it is
         nearer the left hand's: then it is the bass going on while the right hand rests (M16), not the melody. Read
         from the state before (a, sa) only, not the carried centres, so the DP stays exact and G3 idempotent (A5). */
      const topA = a.notes.length - 1 >= sa ? 'RH' : 'LH', topB = b.notes.length - 1 >= sb ? 'RH' : 'LH';
      const la = centre(a.notes.slice(0, sa)), ra = centre(a.notes.slice(sa)), top = b.notes[b.notes.length - 1].midi;
      const bassLine = la !== null && ra !== null && Math.abs(top - la) < Math.abs(top - ra);
      /* nor is it the melody's when the right hand's note before is still sounding: the melody is held there while the
         left hand plays under it (Gymnopedie's A4 over the chord, §24 record) */
      const held = a.notes.slice(sa).some(x => x.endQ > b.q + 1e-9);
      if (topA === 'RH' && topB === 'LH' && !bassLine && !held) c += W.MELODY;
      /* a triplet figure of one beat stays in one hand */
      if (a.beat === b.beat && a.triplet && b.triplet && a.notes.length === 1 && b.notes.length === 1 && topA !== topB) c += W.TUPLET;
      return c;
    };
    /* the hands' last centres after a state: carried along the best path to it (a Viterbi with memory) */
    const carry = (last, grp, s) => {
      const l = centre(grp.notes.slice(0, s)), r = centre(grp.notes.slice(s));
      return { l: l !== null ? l : last.l, lq: l !== null ? grp.q : last.lq, r: r !== null ? r : last.r, rq: r !== null ? grp.q : last.rq };
    };
    const none = { l: null, lq: 0, r: null, rq: 0 };
    let states = [];
    for (let s = 0; s <= groups[0].notes.length; s++) states.push({ cost: local(groups[0], s), last: carry(none, groups[0], s) });
    const back = [];
    for (let k = 1; k < n; k++) {
      const g = groups[k], p = groups[k - 1];
      const next = [], arg = [];
      for (let s = 0; s <= g.notes.length; s++) {
        let best = Infinity, bi = 0;
        for (let t = 0; t <= p.notes.length; t++) {
          const v = states[t].cost + trans(p, t, states[t].last, g, s);
          if (v < best) { best = v; bi = t; }
        }
        next.push({ cost: best + local(g, s), last: carry(states[bi].last, g, s) });
        arg.push(bi);
      }
      back.push(arg);
      states = next;
    }
    let s = 0;
    for (let i = 1; i < states.length; i++) if (states[i].cost < states[s].cost) s = i;
    const out = new Array(n);
    for (let k = n - 1; k >= 0; k--) { out[k] = s; if (k > 0) s = back[k - 1][s]; }
    void ctx;
    return out;
  }

  const staff = Object.freeze({
    name: 'staff',
    may: ['place', 'rests', 'pieces', 'tuplets', 'beams', 'clefs', 'acc'],
    run(g, ctx) {
      const changes = [];
      const starts = new Map();
      let acc = R.ZERO;
      g.timeline.measures.forEach(m => { starts.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
      const res = O.edit(g, d => {
        g.parts.forEach((part, pi) => {
          const hands = handsOf(part);
          if (!hands) return;
          const notes = soundingNotes(g, part, starts);
          /* a measure with a boundary on neither the binary nor the triplet grid (a one-tick rest): what R-repr cannot
             write again, a move must not leave behind (§6.3 R17) */
          /* read from what R-repr keeps (a note's onset and tied end, the edges of a run of rests), so a second run sees
             the same measures (§16.2) */
          const offGrid = new Set();
          /* a point R-repr can write: on the binary grid, or (in a simple metre only) on the triplet grid */
          const bad = (m, w) => {
            const u = MG.toU(R.format(R.sub(w, starts.get(m)))), gr = ctx.grid(g, m);
            const simple = gr && !gr.compound && !gr.additive;
            if (u === null || (u % 3 !== 0 && !(simple && u % 4 === 0))) offGrid.add(m);
          };
          notes.forEach(x => {
            bad(x.e.m, x.w);
            const last = x.pieces[x.pieces.length - 1].e;
            bad(last.m, R.add(R.add(starts.get(last.m), R.parse(last.at)), R.parse(last.dur)));
          });
          const restRuns = new Map();
          part.events.forEach(e => {
            if (e.kind !== 'rest' || e.grace) return;
            const k = e.voice + '|' + e.m;
            if (!restRuns.has(k)) restRuns.set(k, []);
            restRuns.get(k).push(e);
          });
          restRuns.forEach(list => {
            list.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
            let run = null;
            list.forEach(e => {
              const s0 = R.parse(e.at), e0 = R.add(s0, R.parse(e.dur));
              if (run && R.eq(run.e, s0)) run.e = e0; else { if (run) { bad(e.m, R.add(starts.get(e.m), run.s)); bad(e.m, R.add(starts.get(e.m), run.e)); } run = { s: s0, e: e0 }; }
            });
            if (run) { bad(list[0].m, R.add(starts.get(list[0].m), run.s)); bad(list[0].m, R.add(starts.get(list[0].m), run.e)); }
          });
          /* every piece of a note must be ours to move, and in a measure the critic has not handed back */
          const movable = x => x.pieces.every(p => !ctx.skip.has(p.e.m) && !offGrid.has(p.e.m)) && ctx.perm.event(part, x.e, 'staff') === 'rewrite' &&
            x.pieces.every(p => p.e.staff === x.e.staff);
          const byOnset = new Map();
          notes.forEach(x => {
            x.staff = x.e.staff === hands.rh ? 'RH' : x.e.staff === hands.lh ? 'LH' : null;
            const k = R.format(x.w);
            if (!byOnset.has(k)) byOnset.set(k, []);
            byOnset.get(k).push(x);
          });
          const groups = Array.from(byOnset.values()).sort((a, b) => R.cmp(a[0].w, b[0].w)).map(ns => {
            ns.sort((a, b) => a.midi - b.midi || (a.staff === 'LH' ? -1 : 1));
            ns.forEach(x => { x.endQ = R.toNumber(x.pieces.reduce((acc, p) => R.add(acc, R.parse(p.e.dur)), x.w)) * 4; });
            const e = ns[0].e, gr = ctx.grid(g, e.m);
            const beat = gr ? e.m + ':' + MG.beatIndex(gr, MG.toU(e.at) + gr.off) : e.m;
            /* a triplet note: its onset or its (tie-merged) end on a triplet point (the same before and after R-repr) */
            return { notes: ns, beat: beat, q: R.toNumber(ns[0].w) * 4,
              triplet: ns.some(x => x.w.d % 3 === 0 || x.pieces.reduce((acc, p) => R.add(acc, R.parse(p.e.dur)), x.w).d % 3 === 0) };
          });
          if (groups.some(gr => gr.notes.some(x => !x.staff))) return;
          const split = assign(groups, ctx);
          /* the hand of every note that moves */
          const moves = [];
          groups.forEach((gr, k) => gr.notes.forEach((x, i) => {
            const want = i < split[k] ? 'LH' : 'RH';
            if (want !== x.staff && movable(x)) moves.push({ x: x, to: want === 'RH' ? hands.rh : hands.lh });
          }));
          if (moves.length) applyMoves(d, part, hands, moves, changes, ctx);
          clefChanges(d, d.doc.parts[pi], changes, ctx);
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  /* Move notes to the other staff: whole events when all their heads go, heads to a new event otherwise; a note that
     would overlap its new voice goes to that staff's second voice. Then the rests of every voice touched again. */
  function applyMoves(d, part, hands, moves, changes, ctx) {
    const byEvent = new Map();
    moves.forEach(mv => mv.x.pieces.forEach(p => {
      const k = p.e.id;
      if (!byEvent.has(k)) byEvent.set(k, { e: p.e, to: mv.to, heads: [] });
      byEvent.get(k).heads.push(p.h.id);
    }));
    const primary = st => { const v = part.voices.find(x => x.staff === st && (x.label === (st === hands.rh ? '1' : '5'))) || part.voices.find(x => x.staff === st); return v ? v.id : null; };
    const touched = new Set();
    const second = {};
    const secondVoice = st => {
      if (second[st]) return second[st];
      const label = st === hands.rh ? '2' : '6';
      const found = part.voices.find(x => x.staff === st && x.label === label);
      second[st] = found ? found.id : d.addVoice(st, label, d.partOfVoice(primary(st)));
      return second[st];
    };
    /* where each voice has notes, per measure (an event never leaves its measure): [s, e) ScorePos intervals, updated
       as notes arrive */
    const busy = new Map();
    const W0 = e => R.add(d.mStart.get(e.m), R.parse(e.at));
    const span = e => [W0(e), R.add(W0(e), R.parse(e.dur))];
    const noteSpans = (v, m) => {
      if (!busy.has(v)) {
        const byM = new Map();
        d.doc.parts.find(p => p === d.partOfVoice(v)).events.forEach(e => {
          if (e.voice !== v || e.kind !== 'note' || e.grace) return;
          if (!byM.has(e.m)) byM.set(e.m, []);
          byM.get(e.m).push({ id: e.id, s: span(e) });
        });
        busy.set(v, byM);
      }
      const byM = busy.get(v);
      if (!byM.has(m)) byM.set(m, []);
      return byM.get(m);
    };
    const overlaps = (v, m, sp, self) => noteSpans(v, m).some(x => x.id !== self && R.lt(x.s[0], sp[1]) && R.lt(sp[0], x.s[1]));
    Array.from(byEvent.values()).sort((a, b) => R.cmp(W0(a.e), W0(b.e)) || (a.e.id < b.e.id ? -1 : 1)).forEach(mv => {
      const e = d.event(mv.e.id);
      const all = mv.heads.length === e.heads.length;
      const sp = span(e);
      let v = primary(mv.to);
      if (!v) return;
      /* a note of the other staff that starts, lasts and prints the same: the moved heads join it as a chord */
      const allHeads = mv.heads.length === e.heads.length;
      const mate = !(allHeads && (e.arts || e.orn || e.fermata || e.lyrics)) && d.voiceMeasure(v, e.m).find(x => x.kind === 'note' && x.at === e.at && x.dur === e.dur && JSON.stringify(x.display) === JSON.stringify(e.display) &&
        !x.heads.some(h => mv.heads.some(id => { const y = e.heads.find(z => z.id === id); return y && P.midi(y.pitch) === P.midi(h.pitch); })));
      if (mate) {
        const from = e.voice;
        const all = mv.heads.length === e.heads.length;
        d.joinHeads(e.id, mv.heads, mate.id);
        if (all) { const left = noteSpans(from, e.m), i = left.findIndex(x => x.id === e.id); if (i >= 0) left.splice(i, 1); }
        d.markProv(d.event(mate.id), ['staff']);
        touched.add(from + '|' + e.m); touched.add(v + '|' + e.m);
        changes.push({ pass: 'staff', kind: 'join', ids: [mate.id], m: e.m });
        return;
      }
      /* a triplet note among plain notes of the voice's beat (or a plain one among triplets) could not be grouped
         there: it goes to the second voice, where it has the beat to itself */
      if (overlaps(v, e.m, sp, all ? e.id : null) || clashes(d, v, e)) v = secondVoice(mv.to);
      if (overlaps(v, e.m, sp, all ? e.id : null)) { ctx.issue('N-HAND-OVERLAP', 'a note at ' + e.m + '@' + e.at + ' would overlap both voices of the other staff: left where it is', { m: e.m }); return; }
      const from = e.voice;
      let id;
      if (all) {
        d.moveEvent(e.id, v, mv.to);
        id = e.id;
        const left = noteSpans(from, e.m), i = left.findIndex(x => x.id === e.id);
        if (i >= 0) left.splice(i, 1);
      } else id = d.moveHeads(e.id, mv.heads, v, mv.to);
      noteSpans(v, e.m).push({ id: id, s: sp });
      d.markProv(d.event(id), ['staff']);
      touched.add(from + '|' + e.m); touched.add(v + '|' + e.m);
      changes.push({ pass: 'staff', kind: all ? 'move' : 'split', ids: [id], m: e.m });
    });
    /* the rests of every voice-measure a note left or arrived in (one sweep for all of them) */
    const drop = [], refill = [];
    Array.from(touched).sort().forEach(k => {
      const [v, m] = k.split('|');
      const isSecond = !part.voices.some(x => x.id === v && (x.label === '1' || x.label === '5'));
      const has = d.voiceMeasure(v, m).some(e => e.kind === 'note');
      if (isSecond && !has) { d.voiceMeasure(v, m).forEach(e => drop.push(e.id)); return; }
      refill.push({ voice: v, m: m, restPieces: (a, b) => restPieces(d, m, a, b) });
    });
    d.removeEvents(drop);
    d.refillRestsBatch(refill);
  }

  /* Would an event sit in a beat of a voice where the other notes are of the other kind (triplet against plain)? */
  const tripletLen = x => R.parse(x).d % 3 === 0;
  function clashes(d, v, e) {
    const trip = tripletLen(e.at) || tripletLen(R.format(R.add(R.parse(e.at), R.parse(e.dur))));
    const s = R.toNumber(R.parse(e.at)), en = s + R.toNumber(R.parse(e.dur));
    const b0 = Math.floor(s * 4), b1 = Math.ceil(en * 4);
    return d.voiceMeasure(v, e.m).some(x => {
      if (x.kind !== 'note' || x.id === e.id) return false;
      const xs = R.toNumber(R.parse(x.at)), xe = xs + R.toNumber(R.parse(x.dur));
      if (xe * 4 <= b0 || xs * 4 >= b1) return false;
      const t = tripletLen(x.at) || tripletLen(R.format(R.add(R.parse(x.at), R.parse(x.dur))));
      return t !== trip;
    });
  }

  /* Rests for [a, b) of a measure (W strings): cut at the measure's beats, each stretch written as the longest values
     that fit, every rest printed as what it lasts (a triplet length as its triplet value, which P5 then groups).
     R-repr rewrites them afterwards; this only has to be a right start. */
  function restPieces(d, m, a, b) {
    /* the timeline never changes in a G3 draft: one grid per measure, read from the frozen input (its lookups are cached) */
    if (!d.gridCache) d.gridCache = new Map();
    if (!d.gridCache.has(m)) d.gridCache.set(m, MG.grid(d.g0, m));
    const gr = d.gridCache.get(m);
    const A = MG.toU(a), B = MG.toU(b);
    if (!gr || A === null || B === null) return [{ at: a, dur: R.format(R.sub(R.parse(b), R.parse(a))), display: valueOf(R.sub(R.parse(b), R.parse(a))) }];
    const bounds = gr.beats.map(x => x - gr.off).filter(x => x > A && x < B).concat([B]);
    const out = [];
    let x = A;
    bounds.forEach(nb => {
      while (x < nb) {
        const room = nb - x;
        const bin = MG.BINARY.find(v => v.len <= room && v.dots === 0) || null;
        /* a triplet length as its triplet value, in a simple metre (a compound beat holds no 3:2, §6) */
        const tri = gr.compound || gr.additive ? null : MG.BINARY.find(v => v.dots <= 1 && v.len * 2 === room * 3) || null;
        let len, disp;
        if (tri && !(bin && bin.len === room)) { len = room; disp = tri.dots ? { type: tri.type, dots: tri.dots } : { type: tri.type }; }
        else if (bin) { len = bin.len; disp = { type: bin.type }; }
        else { len = room; disp = { type: '64th' }; }
        out.push({ at: MG.fromU(x), dur: MG.fromU(len), display: disp });
        x += len;
      }
    });
    if (out.length === 1 && A === 0 && B === gr.durU) out[0].display = Object.assign(valueOf(R.parse(out[0].dur)), { measureRest: true });
    return out;
  }
  /* a printed value for a length: the plain or dotted value it is, or the nearest shorter one (a triplet length
     keeps its plain value: P5 gives it the ratio) */
  function valueOf(len) {
    const types = [['whole', 1], ['half', 1 / 2], ['quarter', 1 / 4], ['eighth', 1 / 8], ['16th', 1 / 16], ['32nd', 1 / 32], ['64th', 1 / 64]];
    const L = R.toNumber(len);
    for (const [t, v] of types) {
      if (Math.abs(L - v) < 1e-9) return { type: t };
      if (Math.abs(L - v * 1.5) < 1e-9) return { type: t, dots: 1 };
      if (Math.abs(L - v * 2 / 3) < 1e-9) return { type: t };
    }
    for (const [t, v] of types) if (v <= L) return { type: t };
    return { type: '64th' };
  }

  /* §9.3: where a staff's notes are all 4 or more ledger lines off its clef for a whole measure or more, and the
     other clef holds them better, that stretch gets the other clef (and the staff's clef comes back after it). Only
     on a staff whose clefs the pass may write: one with nothing but its opening clef (a file's own clef changes are
     kept as they are, §14). */
  function clefChanges(d, part, changes, ctx) {
    if (ctx.perm.graph('staff') !== 'rewrite') return;
    const ms = d.doc.timeline.measures;
    part.staves.forEach(st => {
      const own = part.clefs.filter(c => c.staff === st.id);
      if (own.length !== 1 || own[0].m !== ms[0].id || own[0].at !== '0' || (own[0].sign !== 'G' && own[0].sign !== 'F')) return;
      /* the staff's own clef: treble for the right hand, bass for the left (the opening clef may already have been
         turned by this pass on an earlier run: then the stretch it covers is read against the staff's own) */
      const home = st.limb === 'RH' ? 'G' : st.limb === 'LH' ? 'F' : own[0].sign, other = home === 'G' ? 'F' : 'G';
      if (own[0].sign !== home) return;
      const byM = new Map();
      part.events.forEach(e => {
        if (e.staff !== st.id || e.kind !== 'note' || e.grace) return;
        if (!byM.has(e.m)) byM.set(e.m, []);
        e.heads.forEach(h => { if (h.pitch && (!h.staff || h.staff === st.id)) byM.get(e.m).push(h); });
      });
      /* a measure reads better in the other clef when every note is 4 or more ledger lines off in this one (§9.3), or
         when one is and the other clef holds every note within fewer than 4 and with fewer lines in all (§24 record: a
         left hand playing an octave under the right, B4 G4 D5 under a bass clef, the reference in treble; the §9.3 rule
         alone never changed it, and G0's heavy-ledger rate rose past its gate on robust) */
      /* 'far': the measure wants the other clef; 'either': no note of it is 4 or more lines off in either clef (an
         empty one too), so it goes on in whichever clef is in force rather than changing back for one measure */
      const state = ms.map(m => {
        const heads = byM.get(m.id) || [];
        if (ctx.skip.has(m.id)) return 'home';
        if (!heads.length) return 'either';
        const cur = heads.map(h => ledgers(h.pitch, home)), alt = heads.map(h => ledgers(h.pitch, other));
        if (heads.every((h, k) => cur[k] >= W.LEDGER_MIN && alt[k] < cur[k])) return 'far';
        const heavy = cur.filter(x => x >= W.LEDGER_MIN).length;
        const sum = xs => xs.reduce((a, b) => a + b, 0);
        if (heavy > 0 && alt.every(x => x < W.LEDGER_MIN) && sum(alt) < sum(cur)) return 'far';
        return heavy === 0 && alt.every(x => x < W.LEDGER_MIN) ? 'either' : 'home';
      });
      for (let i = 0; i < ms.length;) {
        if (state[i] !== 'far') { i++; continue; }
        /* the run: from a far measure over far and either ones, ending at its last far measure */
        let j = i, k = i;
        while (k + 1 < ms.length && state[k + 1] !== 'home') { k++; if (state[k] === 'far') j = k; }
        /* from the first measure on: the opening clef itself becomes the other one */
        if (i === 0) { const c = part.clefs.find(x => x.id === own[0].id); c.sign = other; delete c.line; d.touch(); }
        else d.addClef(part, { staff: st.id, m: ms[i].id, at: '0', sign: other });
        if (j + 1 < ms.length) d.addClef(part, { staff: st.id, m: ms[j + 1].id, at: '0', sign: home });
        changes.push({ pass: 'staff', kind: 'clef', ids: [], m: ms[i].id });
        i = j + 1;
      }
    });
  }

  /* The automatic 8va (§13.3) is its own pass, off unless opts.ottava (D2: issue 3, the app plays an 8va passage an
     octave off). */
  const ottava = Object.freeze({
    name: 'ottava',
    may: ['ottava'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        g.parts.forEach((gpart, pi) => {
          const hands = handsOf(gpart);
          if (!hands) return;
          if (ctx.perm.graph('staff') !== 'rewrite') return;
          const part = d.doc.parts[pi];
          if (part.spanners.some(s => s.type === 'ottava')) return;
          const rh = hands.rh;
          const ms = g.timeline.measures;
          /* runs of measures whose right-hand notes are all 4 or more ledger lines above the treble staff */
          let run = [];
          const flush = () => {
            if (run.length >= 1) {
              const from = { m: run[0].id, at: '0' }, last = run[run.length - 1];
              d.addSpanner(part, { type: 'ottava', staff: rh, shift: 1, from: from, to: { m: last.id, at: last.dur }, prov: { src: d.source() } });
              changes.push({ pass: 'ottava', kind: 'add', ids: [], m: run[0].id });
            }
            run = [];
          };
          ms.forEach(m => {
            const evs = part.events.filter(e => e.m === m.id && e.staff === rh && e.kind === 'note' && !e.grace);
            const high = evs.length && evs.every(e => e.heads.every(h => h.pitch && ledgers(h.pitch, 'G') >= W.LEDGER_MIN && P.midi(h.pitch) > 79));
            if (high) run.push(m); else flush();
          });
          flush();
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  return Object.freeze({ staff, ottava, assign, ledgers, handsOf, soundingNotes, restPieces, valueOf, W });
});
