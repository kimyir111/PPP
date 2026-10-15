/* ============================================================================
   PPP OMR correction ops (docs/GOALS/G12_OMR.md section 7.4 and section 9, phase G12-4 "the correction UI")

   The bar editor changes the ScoreGraph only through the functions below. Each one takes a (frozen) graph and returns a new, validated, frozen graph
   (scoregraph/ops.js `edit`: one transaction, one validation, `rev + 1`); the graph it was given is never changed, so an undo is the previous graph itself.
   Pure (no DOM, no network, no clock): Node and browser, UMD. Its one dependency is the ScoreGraph library (scoregraph/index.js).

   Every op: (graph, args) -> { graph, changed, idMap, measures: [ids of the measures it touched], issues }
   `changed: false` means nothing was to do and `graph` is the graph that was given. A request the op cannot honour throws EditError { code, message, detail }:

     no-target     the event, head, measure or staff is not in the graph (it changed since the screen was drawn)
     in-tuplet     a value edit on a note of a triplet or other tuplet (not offered: the group would have to be rewritten)
     no-room       the longer note would run into the next note or out of the bar
     too-short     the shortest value PPP writes is a 64th
     unprintable   no single written value has that length
     would-cut     the new time signature would cut a note off
     last-bar      the only bar of the score
     meter-differs the two bars have different time signatures
     same-staff    the note is already on that staff
     out-of-range  a pitch outside a piano
     occupied      a note is already there (add) / no free voice on that staff (move)
     invalid       the validator refused the result (detail: its first ERROR)

   Notation, not sound, is what the page says, so the pitch ops edit the NOTATION and derive the sound from it the way a reader does: a note's letter and octave
   (its place on the staff), the accidental printed on it, the one earlier in the bar on the same line or space, the key signature, the clef. A key or a clef the
   engine misread is fixed by saying what it is: the notes that stand under it are read again (a note with no accidental of its own takes the key's; a note
   under another clef moves to the pitch its place now means). A note whose sound already disagreed with its notation before the edit is left as it was: an edit
   changes what it says it changes and what the notation then implies, never a note it had no reason to touch.

   Provenance: every head, event and bar an edit changes carries op 'edited', source {kind 'user', tool 'ppp.omr-editor'}; a bar a person has looked at and
   accepted carries a flag {kind 'review', code 'reviewed'} until an edit touches it again.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'));
  else root.PPPOmrEditOps = factory(root.PPPScoreGraph);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG) {
  'use strict';
  if (!SG || !SG.ops || !SG.rational || !SG.meterGrid) throw new Error('omr/edit-ops.js needs the ScoreGraph library (scoregraph/index.js)');
  const R = SG.rational, OPS = SG.ops, P = SG.pitch, S = SG.schema, MG = SG.meterGrid;

  const VERSION = 1;
  const SOURCE = Object.freeze({ kind: 'user', tool: 'ppp.omr-editor', version: '1' });
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const ACC_ALTER = { sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'flat-flat': -2, 'sharp-sharp': 2, 'natural-sharp': 1, 'natural-flat': -1 };
  const ACC_OF_ALTER = { 2: 'double-sharp', 1: 'sharp', 0: 'natural', '-1': 'flat', '-2': 'flat-flat' };
  const LOW = 21, HIGH = 108;                       /* A0 .. C8: a piano */

  class EditError extends Error {
    constructor(code, message, detail) { super(message || code); this.name = 'EditError'; this.code = code; this.detail = detail; }
  }
  const fail = (code, message, detail) => { throw new EditError(code, message, detail); };

  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const samePitch = (a, b) => !!a && !!b && a.step === b.step && a.oct === b.oct && (a.alter || 0) === (b.alter || 0);
  const sameAcc = (a, b) => (a ? a.type : null) === (b ? b.type : null);
  const cp = x => JSON.parse(JSON.stringify(x));
  const rat = x => (typeof x === 'string' ? R.parse(x) : x);
  const num = x => R.toNumber(rat(x));

  /* ------------------------------------------------------------------ one transaction */
  /* fn(d, touched): edits d.doc (and calls d's methods); `touched` collects the measure IDs the edit changed (their 'reviewed' flags go in the same transaction) */
  function run(g, fn) {
    if (!g || !g.timeline || !Array.isArray(g.parts)) fail('no-target', 'not a score');
    const touched = new Set();
    let res;
    try {
      res = OPS.edit(g, d => {
        const out = fn(d, touched);
        if (d.changed) { clearReviewed(d, touched); }
        return out;
      }, { source: SOURCE });
    } catch (e) {
      if (e instanceof EditError) throw e;
      if (e && e.name === 'OpError') {
        const first = (e.issues || []).find(i => i.severity === 'ERROR');
        fail(e.code === 'E-OP-TARGET' ? 'no-target' : 'invalid', e.message, first ? { code: first.code, message: first.message, ids: first.ids || [] } : { code: e.code });
      }
      throw e;
    }
    return { graph: res.graph, changed: !!res.changed, idMap: res.idMap || {}, issues: res.issues || [], measures: Array.from(touched), result: res.result };
  }

  /* ------------------------------------------------------------------ small readers of the draft */
  function reindexTimeline(d) {
    const tl = d.doc.timeline;
    d.mIdx = new Map(tl.measures.map((m, i) => [m.id, i]));
    d.mStart = new Map();
    let acc = R.ZERO;
    tl.measures.forEach(m => { d.mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    d.reindex();
  }
  const measureOf = (d, id) => { const i = d.mIdx.get(id); if (i === undefined) fail('no-target', 'no bar ' + id); return d.doc.timeline.measures[i]; };
  const findEvent = (d, id) => { const x = d.ev.get(id); if (!x) fail('no-target', 'no note ' + id); return x; };
  const findHead = (d, id) => { const x = d.hd.get(id); if (!x) fail('no-target', 'no head ' + id); return x; };
  const durOf = (d, mid) => R.parse(measureOf(d, mid).dur);
  const atOf = e => R.parse(e.at);
  const endOf = e => R.add(R.parse(e.at), R.parse(e.dur));
  const idNo = id => S.idNumber(id) || 0;

  /* ------------------------------------------------------------------ written values */
  const TYPES = ['breve', 'whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'];
  const VALUES = [];                                /* every plain, dotted and double-dotted value PPP writes: {type, dots, len: Rat}, longest first */
  TYPES.forEach(t => [0, 1, 2].forEach(dots => { const v = S.noteValue(t, dots); if (v) VALUES.push({ type: t, dots: dots, len: v }); }));
  VALUES.sort((a, b) => R.cmp(b.len, a.len) || a.dots - b.dots);
  const displayOf = v => (v.dots ? { type: v.type, dots: v.dots } : { type: v.type });
  /* the one written value that lasts exactly `len`, or null */
  function displayFor(len) {
    const v = VALUES.find(x => R.eq(x.len, len));
    return v ? displayOf(v) : null;
  }
  /* the longest written value that fits in `len` */
  function pieceFor(len) {
    const v = VALUES.find(x => R.le(x.len, len));
    return v ? { len: v.len, display: displayOf(v) } : null;
  }
  const lenOfDisplay = disp => (disp && disp.type ? S.noteValue(disp.type, disp.dots || 0) : null);
  const SHORTEST = S.noteValue('64th', 0);

  /* Rests for [a, b) of a measure (W strings): cut at the measure's beats, each stretch the longest values that fit, a whole bar as one measure rest
     (the pattern of scoregraph/pro-staff.js restPieces, read from a draft's document) */
  function restPieces(doc, mid, a, b) {
    const total = R.sub(R.parse(b), R.parse(a));
    const bar = doc.timeline.measures.find(x => x.id === mid);
    /* the whole bar: one rest that says so, whatever the time signature */
    if (bar && R.eq(R.parse(a), R.ZERO) && R.eq(R.parse(b), R.parse(bar.dur)) && R.sign(total) > 0)
      return [{ at: '0', dur: R.format(total), display: Object.assign(displayFor(total) || { type: 'whole' }, { measureRest: true }) }];
    let gr = null;
    try { gr = MG.grid(doc, mid); } catch (e) { gr = null; }
    const A = MG.toU(R.parse(a)), B = MG.toU(R.parse(b));
    if (!gr || !Number.isInteger(A) || !Number.isInteger(B)) return [{ at: a, dur: R.format(total), display: displayFor(total) || (pieceFor(total) || {}).display || { type: '64th' } }];
    const bounds = gr.beats.map(x => x - gr.off).filter(x => x > A && x < B).concat([B]);
    const out = [];
    let x = A;
    bounds.forEach(nb => {
      while (x < nb) {
        const room = nb - x;
        const bin = MG.BINARY.find(v => v.len <= room && v.dots === 0) || null;
        const tri = gr.compound || gr.additive ? null : MG.BINARY.find(v => v.dots <= 1 && v.len * 2 === room * 3) || null;
        let len, disp;
        if (tri && !(bin && bin.len === room)) { len = room; disp = tri.dots ? { type: tri.type, dots: tri.dots } : { type: tri.type }; }
        else if (bin) { len = bin.len; disp = { type: bin.type }; }
        else { len = room; disp = { type: '64th' }; }
        out.push({ at: MG.fromU(x), dur: MG.fromU(len), display: disp });
        x += len;
      }
    });
    return out;
  }
  const refill = (d, voice, m) => d.refillRests(voice, m, (a, b) => restPieces(d.doc, m, a, b));

  /* ------------------------------------------------------------------ notation: from what is printed to what sounds */
  const dposOf = p => p.oct * 7 + STEPS.indexOf(p.step);
  const pitchAt = (dpos, alter) => {
    const oct = Math.floor(dpos / 7), step = STEPS[((dpos % 7) + 7) % 7];
    return alter ? { step: step, alter: alter, oct: oct } : { step: step, oct: oct };
  };
  const midiOf = p => P.midi(p);
  const keyAlter = (fifths, step) => {
    if (fifths > 0) return SHARPS.indexOf(step) < fifths ? 1 : 0;
    if (fifths < 0) return FLATS.indexOf(step) < -fifths ? -1 : 0;
    return 0;
  };
  /* the lowest line of a clef as a diatonic position (octave * 7 + step): G on line 2 is E4, F on line 4 is G2, C on line 3 is F3 */
  function clefBottom(cl) {
    if (!cl || !cl.sign) return 4 * 7 + 2;
    const sign = String(cl.sign);
    const line = Number.isInteger(cl.line) ? cl.line : (sign === 'F' ? 4 : sign === 'C' ? 3 : 2);
    const ref = sign === 'F' ? 3 * 7 + 3 : sign === 'C' ? 4 * 7 : 4 * 7 + 4;
    return ref - 2 * (line - 1) + 7 * (cl.octave || 0);
  }
  /* the key in force at the start of measure index `mi` for a part and staff (scoregraph/time.js keyAt: the latest, a staff's own beating a part's beating the score's) */
  function keyFifths(doc, mIdx, partId, staffId, mi) {
    let best = null;
    (doc.timeline.keys || []).forEach(k => {
      const i = mIdx.get(k.m);
      if (i === undefined || i > mi) return;
      if (i === mi && !R.eq(R.parse(k.at), R.ZERO)) return;       /* a key partway through the bar is not read */
      let rank = 0;
      if (k.scope) { if (k.scope.part !== partId) return; if (k.scope.staff) { if (k.scope.staff !== staffId) return; rank = 2; } else rank = 1; }
      const at = R.parse(k.at);
      const better = !best || i > best.i || (i === best.i && (R.gt(at, best.at) || (R.eq(at, best.at) && (rank > best.rank || (rank === best.rank && idNo(k.id) > idNo(best.k.id))))));
      if (better) best = { k: k, i: i, at: at, rank: rank };
    });
    return best ? best.k.fifths : 0;
  }
  const chainIndex = part => {
    const from = new Map(), to = new Map();
    part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { to.set(s.from, s.to); from.set(s.to, s.from); } });
    return { from: from, to: to };
  };
  /* all heads joined to `hid` by ties, in time order of the chain */
  function tieChain(part, hid) {
    const c = chainIndex(part);
    let first = hid, guard = 0;
    while (c.from.has(first) && guard++ < 10000) first = c.from.get(first);
    const out = [first];
    let cur = first;
    while (c.to.has(cur) && out.length < 10000) { cur = c.to.get(cur); out.push(cur); }
    return out;
  }

  /* the heads of a staff in a bar in the order a reader meets them (grace notes first at one place), each with the alteration its notation implies:
     a printed accidental says it; a note with none takes the accidental printed earlier in the bar on the same line or space, else the key's;
     the end of a tie goes on from its start (undefined: not read here) */
  function walk(doc, mIdx, part, staffId, mid) {
    const mi = mIdx.get(mid);
    if (mi === undefined) return [];
    const list = [];
    part.events.forEach(e => {
      if (e.m !== mid || e.kind !== 'note' || !e.heads) return;
      e.heads.forEach((h, hi) => { if (h.pitch && (h.staff || e.staff) === staffId) list.push({ h: h, e: e, at: R.parse(e.at), hi: hi, grace: !!e.grace }); });
    });
    list.sort((a, b) => R.cmp(a.at, b.at) || (a.grace === b.grace ? 0 : a.grace ? -1 : 1) || idNo(a.e.id) - idNo(b.e.id) || a.hi - b.hi);
    const tie = chainIndex(part);
    const fifths = keyFifths(doc, mIdx, part.id, staffId, mi);
    const carry = new Map();
    list.forEach(x => {
      const p = x.h.pitch, k = p.step + '|' + p.oct;
      let implied;
      if (x.h.acc) {
        implied = ACC_ALTER[x.h.acc.type];                      /* a quarter tone: undefined, not read */
        if (implied !== undefined) carry.set(k, implied);
      } else if (tie.from.has(x.h.id)) implied = undefined;     /* follows its tie's start (syncChains) */
      else if (carry.has(k)) implied = carry.get(k);
      else implied = keyAlter(fifths, p.step);
      x.implied = implied;
    });
    return list;
  }
  const alterOf = h => (h.pitch && h.pitch.alter) || 0;
  const staffsOf = part => part.staves.map(s => s.id);

  /* before an edit: which heads of these bars sound what their notation implies (by head ID) */
  function snapshot(d, measureIds) {
    const out = new Map();
    const ids = new Set(measureIds);
    d.doc.parts.forEach(part => staffsOf(part).forEach(st => ids.forEach(mid => {
      if (!d.mIdx.has(mid)) return;
      walk(d.doc, d.mIdx, part, st, mid).forEach(x => { if (x.implied !== undefined) out.set(x.h.id, alterOf(x.h) === x.implied); });
    })));
    return out;
  }
  function setAlter(d, x, alter, skip) {
    if (alterOf(x.h) === alter) return false;
    const p = { step: x.h.pitch.step, oct: x.h.pitch.oct };
    if (alter) p.alter = alter;
    x.h.pitch = p;
    d.markProv(x.h, ['pitch'], 'edited');
    return true;
  }
  /* after an edit: a head that sounded what it said before and no longer does (its key, the accidental before it, its place changed) is read again.
     staffId: only that staff (a clef edit); skip: head IDs the edit set itself */
  function reconcile(d, before, measureIds, opts) {
    opts = opts || {};
    const skip = opts.skip || new Set();
    const ids = new Set(measureIds);
    const changed = [];
    d.doc.parts.forEach(part => staffsOf(part).forEach(st => {
      if (opts.staff && opts.staff !== st) return;
      ids.forEach(mid => {
        if (!d.mIdx.has(mid)) return;
        walk(d.doc, d.mIdx, part, st, mid).forEach(x => {
          if (x.implied === undefined || skip.has(x.h.id)) return;
          if (before.get(x.h.id) === true && alterOf(x.h) !== x.implied && setAlter(d, x, x.implied)) { changed.push(x.h.id); d.touch(); }
        });
      });
    }));
    return changed;
  }
  /* a tie joins notes of one pitch: the ends follow the start */
  function syncChains(d, headIds) {
    headIds.forEach(id => {
      const at = d.hd.get(id);
      if (!at) return;
      const part = d.doc.parts.find(p => p.events.some(e => e === at.e));
      if (!part) return;
      tieChain(part, id).forEach(o => {
        if (o === id) return;
        const x = d.hd.get(o);
        if (!x || !x.h.pitch) return;
        const p = { step: at.h.pitch.step, oct: at.h.pitch.oct };
        if (alterOf(at.h)) p.alter = alterOf(at.h);
        if (!samePitch(x.h.pitch, p)) { x.h.pitch = p; d.markProv(x.h, ['pitch'], 'edited'); d.touch(); }
      });
    });
  }
  const measuresOfHeads = (d, headIds) => Array.from(new Set(headIds.map(h => (d.hd.get(h) || { e: {} }).e.m).filter(Boolean)));
  const partOfHead = (d, hid) => d.doc.parts.find(p => p.events.some(e => (e.heads || []).some(h => h.id === hid)));

  /* ------------------------------------------------------------------ the notation edits of one note */
  function pitchEdit(g, args, how) {
    return run(g, (d, touched) => {
      const x = findHead(d, args.head);
      if (!x.h.pitch) fail('no-target', 'not a pitched note');
      const part = partOfHead(d, args.head);
      const chain = tieChain(part, args.head);
      const anchor = d.hd.get(chain[0]);
      const staff = anchor.h.staff || anchor.e.staff;
      const mids = Array.from(new Set(chain.map(h => d.hd.get(h).e.m)));
      const before = snapshot(d, mids);
      const was = cp(anchor.h.pitch), wasAcc = anchor.h.acc ? cp(anchor.h.acc) : null;
      how(anchor.h, anchor.e);
      const np = anchor.h.pitch;
      if (midiOf(np) < LOW - 4 || midiOf(np) > HIGH + 4) { anchor.h.pitch = was; if (wasAcc) anchor.h.acc = wasAcc; else delete anchor.h.acc; fail('out-of-range', 'outside a piano'); }
      /* its own alteration, from its notation (the printed accidental, else the bar, else the key) */
      const w = walk(d.doc, d.mIdx, part, staff, anchor.e.m).find(y => y.h === anchor.h);
      let alter = w && w.implied !== undefined ? w.implied : alterOf(anchor.h);
      if (anchor.h.acc && ACC_ALTER[anchor.h.acc.type] === undefined) alter = alterOf(anchor.h);
      const next = { step: np.step, oct: np.oct };
      if (alter) next.alter = alter;
      anchor.h.pitch = next;
      if (midiOf(next) < LOW || midiOf(next) > HIGH) { anchor.h.pitch = was; if (wasAcc) anchor.h.acc = wasAcc; else delete anchor.h.acc; fail('out-of-range', 'outside a piano'); }
      if (samePitch(was, next) && sameAcc(wasAcc, anchor.h.acc)) { anchor.h.pitch = was; return null; }
      d.markProv(anchor.h, ['pitch'], 'edited');
      if (!sameAcc(wasAcc, anchor.h.acc)) d.markProv(anchor.h, ['spelling'], 'edited');
      d.touch();
      syncChains(d, [anchor.h.id]);
      reconcile(d, before, mids, { skip: new Set(chain) });
      mids.forEach(m => touched.add(m));
      return { head: anchor.h.id };
    });
  }
  /* a step up (by +1) or down (by -1) the staff: the letter changes, the printed accidental stays */
  function step(g, args) {
    return pitchEdit(g, args, h => { h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? -1 : 1), 0); });
  }
  function octave(g, args) {
    return pitchEdit(g, args, h => { h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? -7 : 7), 0); });
  }
  /* acc: 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'flat-flat' | null (none printed: the bar and the key say) */
  function accidental(g, args) {
    const type = args.acc === null || args.acc === undefined ? null : String(args.acc);
    if (type !== null && ACC_ALTER[type] === undefined) fail('no-target', 'not an accidental: ' + type);
    return pitchEdit(g, args, h => {
      if (type === null) delete h.acc; else h.acc = { type: type };
      h.pitch = { step: h.pitch.step, oct: h.pitch.oct };
    });
  }

  /* ------------------------------------------------------------------ rewriting one voice in one bar */
  const overlaps = (a, b) => R.lt(a.s, b.e) && R.lt(b.s, a.e);
  /* mod(plan, events) may change the plan entries (the kept events as `retimeVoiceMeasure` plans them); rests under a note go, the gaps are filled with rests again */
  function rewrite(d, voice, m, mod) {
    const evs = d.voiceMeasure(voice, m);
    let plan = evs.map(e => d.keepPlan(e));
    plan = mod(plan, evs) || plan;
    const span = p => ({ s: R.parse(p.at), e: R.add(R.parse(p.at), R.parse(p.dur)) });
    const notes = plan.filter(p => p.kind !== 'rest').map(span);
    plan = plan.filter(p => p.kind !== 'rest' || !notes.some(n => overlaps(n, span(p))));
    plan.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
    const ids = d.retimeVoiceMeasure(voice, m, plan);
    refill(d, voice, m);
    return ids;
  }
  const inTuplet = (d, e) => d.doc.parts.some(p => p.spanners.some(s => s.type === 'tuplet' && s.events.indexOf(e.id) >= 0));
  const checkValue = (d, e) => {
    if (e.grace) fail('no-target', 'a grace note');
    if (inTuplet(d, e)) fail('in-tuplet', 'the note is in a tuplet');
  };

  /* change: 'halve' | 'double' | 'dot' (a dot added, or taken off a dotted note) */
  function value(g, args) {
    return run(g, (d, touched) => {
      const x = findEvent(d, args.event), e = x.e;
      checkValue(d, e);
      const len = R.parse(e.dur), at = R.parse(e.at), mdur = durOf(d, e.m);
      let nl;
      if (args.change === 'halve') {
        nl = R.mul(len, R.make(1, 2));
        if (R.lt(nl, SHORTEST)) fail('too-short', 'shorter than a 64th');
      } else if (args.change === 'double') nl = R.mul(len, R.make(2, 1));
      else if (args.change === 'dot') {
        const disp = e.display && e.display.type ? e.display : displayFor(len);
        const dots = (disp && disp.dots) || 0;
        const base = disp && disp.type ? S.noteValue(disp.type, 0) : null;
        if (!base) fail('unprintable', 'no written value');
        if (dots >= 1) nl = base;                                  /* off */
        else nl = R.mul(base, R.make(3, 2));
      } else fail('no-target', 'unknown value change ' + args.change);
      const disp = displayFor(nl);
      if (!disp) fail('unprintable', 'no written value of that length');
      if (R.eq(nl, len) && sameJson(e.display || null, disp)) return null;
      const end = R.add(at, nl);
      if (R.gt(end, mdur)) fail('no-room', 'out of the bar');
      const others = d.voiceMeasure(e.voice, e.m).filter(o => o.id !== e.id && o.kind !== 'rest');
      if (others.some(o => overlaps({ s: at, e: end }, { s: atOf(o), e: endOf(o) }))) fail('no-room', 'a note follows');
      const mids = [e.m];
      const before = snapshot(d, mids);
      rewrite(d, e.voice, e.m, plan => {
        const p = plan.find(y => y.reuse === e.id);
        p.dur = R.format(nl); p.display = disp; p.tieNext = false;
        return plan;
      });
      d.markProv(d.event(e.id), ['rhythm'], 'edited');
      reconcile(d, before, mids, {});
      touched.add(e.m);
      return { event: e.id };
    });
  }

  /* a note becomes a rest of its length */
  function toRest(g, args) {
    return run(g, (d, touched) => restCore(d, touched, findEvent(d, args.event).e));
  }
  function restCore(d, touched, e) {
    {
      if (e.kind !== 'note') fail('no-target', 'not a note');
      if (e.grace) fail('no-target', 'a grace note');
      if (inTuplet(d, e)) fail('in-tuplet', 'the note is in a tuplet');
      const before = snapshot(d, [e.m]);
      let made = null;
      rewrite(d, e.voice, e.m, plan => {
        const i = plan.findIndex(y => y.reuse === e.id);
        const p = plan[i];
        const disp = p.display ? { type: p.display.type, dots: p.display.dots } : displayFor(R.parse(p.dur));
        const ent = { kind: 'rest', at: p.at, dur: p.dur };
        if (disp && disp.type) ent.display = disp.dots ? { type: disp.type, dots: disp.dots } : { type: disp.type };
        plan[i] = ent;
        made = ent;
        return plan;
      });
      reconcile(d, before, [e.m], {});
      touched.add(e.m);
      return { removed: e.id };
    }
  }

  /* one note of a chord goes (the others stay); the only note of an event is the event: it becomes a rest */
  function removeHead(g, args) {
    return run(g, (d, touched) => {
      const x = findHead(d, args.head), e = x.e, part = partOfHead(d, args.head);
      if (!e.heads || e.heads.length < 2) return restCore(d, touched, e);
      d.assertUnlinked([args.head]);
      const before = snapshot(d, [e.m]);
      e.heads = e.heads.filter(h => h.id !== args.head);
      part.spanners = part.spanners.filter(s => {
        if (s.type === 'tie' || s.type === 'gliss') {
          if (s.from === args.head) delete s.from;
          if (s.to === args.head) delete s.to;
          const keep = s.type === 'tie' ? (s.from !== undefined || s.to !== undefined) : (s.from !== undefined && s.to !== undefined);
          if (!keep) d.retire(s.id);
          return keep;
        }
        if (s.type === 'arpeggio') {
          s.heads = s.heads.filter(h => h !== args.head);
          if (s.heads.length < 2) { d.retire(s.id); return false; }
        }
        return true;
      });
      d.retire(args.head);
      d.fixFlags();
      d.reindex();
      d.markProv(e, ['exists'], 'edited');
      d.touch();
      reconcile(d, before, [e.m], {});
      touched.add(e.m);
      return { event: e.id };
    });
  }

  /* the pitch a new note gets: the staff's last note before it, else the middle line of its clef */
  function defaultPitch(d, part, staffId, mid, at) {
    const mi = d.mIdx.get(mid), w = R.add(d.mStart.get(mid), at);
    let best = null, bestW = null;
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || !e.heads || (e.staff !== staffId)) return;
      const ew = R.add(d.mStart.get(e.m), R.parse(e.at));
      if (R.gt(ew, w)) return;
      if (bestW === null || R.ge(ew, bestW)) { best = e; bestW = ew; }
    });
    if (best) { const h = best.heads.find(y => y.pitch); if (h) return { step: h.pitch.step, oct: h.pitch.oct }; }
    let cl = null, clw = null;
    part.clefs.forEach(c => {
      if (c.staff !== staffId || !d.mIdx.has(c.m) || d.mIdx.get(c.m) > mi) return;
      const cw = R.add(d.mStart.get(c.m), R.parse(c.at));
      if (clw === null || R.ge(cw, clw)) { cl = c; clw = cw; }
    });
    const dp = clefBottom(cl) + 4;
    return { step: STEPS[((dp % 7) + 7) % 7], oct: Math.floor(dp / 7) };
  }
  /* a rest becomes a note: the pitch if given, else the last one of the staff; as long as the rest, or the longest value that fits it */
  function toNote(g, args) {
    return run(g, (d, touched) => {
      const x = findEvent(d, args.event), e = x.e;
      if (e.kind !== 'rest') fail('no-target', 'not a rest');
      if (inTuplet(d, e)) fail('in-tuplet', 'the rest is in a tuplet');
      const part = x.part;
      const before = snapshot(d, [e.m]);
      const len = R.parse(e.dur), at = R.parse(e.at);
      const pc = displayFor(len) ? { len: len, display: displayFor(len) } : pieceFor(len);
      if (!pc) fail('unprintable', 'no written value');
      const pitch = args.pitch ? { step: args.pitch.step, oct: args.pitch.oct } : defaultPitch(d, part, e.staff, e.m, at);
      if (midiOf(pitch) < LOW - 4 || midiOf(pitch) > HIGH + 4) fail('out-of-range', 'outside a piano');
      let made = null;
      rewrite(d, e.voice, e.m, plan => {
        const i = plan.findIndex(y => y.reuse === e.id);
        const ent = { kind: 'note', at: R.format(at), dur: R.format(pc.len), display: pc.display, heads: [{ pitch: pitch }] };
        plan[i] = ent;
        made = ent;
        return plan;
      });
      /* the new note, found by its place: its notation gives its alteration */
      const part2 = d.doc.parts.find(p => p === part);
      const ne = d.voiceMeasure(e.voice, e.m).find(y => y.kind === 'note' && R.eq(R.parse(y.at), at) && y.heads && y.heads.some(h => h.pitch && h.pitch.step === pitch.step && h.pitch.oct === pitch.oct && !h.prov));
      if (ne) {
        const h = ne.heads[0];
        const w = walk(d.doc, d.mIdx, part2, ne.staff, ne.m).find(y => y.h === h);
        const alter = w && w.implied !== undefined ? w.implied : 0;
        h.pitch = alter ? { step: pitch.step, alter: alter, oct: pitch.oct } : { step: pitch.step, oct: pitch.oct };
        d.markProv(h, ['pitch'], 'edited');
        d.markProv(ne, ['exists', 'rhythm'], 'edited');
      }
      reconcile(d, before, [e.m], {});
      touched.add(e.m);
      return { event: ne ? ne.id : null };
    });
  }

  /* a note is taken out, and the time it held is a rest again; with a head, one note of a chord */
  function remove(g, args) { return args.head ? removeHead(g, args) : toRest(g, args); }

  /* a note at a place of a bar: args {measure, staff, at (W), pitch {step, oct}, value ('quarter', {type, dots}) , acc? }.
     The staff's first voice whose rest holds the place takes it; where a note already starts there the pitch is added to its chord. */
  function add(g, args) {
    return run(g, (d, touched) => {
      const m = measureOf(d, args.measure);
      const part = d.doc.parts.find(p => p.staves.some(s => s.id === args.staff));
      if (!part) fail('no-target', 'no staff ' + args.staff);
      const at = R.parse(args.at);
      const mdur = R.parse(m.dur);
      if (R.sign(at) < 0 || R.ge(at, mdur)) fail('no-target', 'outside the bar');
      const pitch = { step: args.pitch.step, oct: args.pitch.oct };
      if (midiOf(pitch) < LOW - 4 || midiOf(pitch) > HIGH + 4) fail('out-of-range', 'outside a piano');
      const vd = typeof args.value === 'string' ? { type: args.value } : args.value || { type: 'quarter' };
      const want = S.noteValue(vd.type, vd.dots || 0);
      if (!want) fail('unprintable', 'no such value');
      const voices = part.voices.filter(v => v.staff === args.staff);
      if (!voices.length) fail('occupied', 'no voice on that staff');
      const before = snapshot(d, [m.id]);
      /* a note that starts at this place in one of the staff's voices takes the pitch into its chord */
      for (const v of voices) {
        const same = d.voiceMeasure(v.id, m.id).find(e => e.kind === 'note' && !e.grace && R.eq(R.parse(e.at), at));
        if (same) {
          if (same.heads.some(h => h.pitch && midiOf(h.pitch) === midiOf(pitch) && h.pitch.step === pitch.step)) fail('occupied', 'the note is there');
          const nh = { id: d.newId('h'), pitch: pitch };
          same.heads.push(nh);
          d.indexEvent(same, part);
          d.markProv(nh, ['pitch'], 'edited');
          d.touch();
          settle(d, part, args, nh, same, before, m.id);
          touched.add(m.id);
          return { event: same.id, head: nh.id };
        }
      }
      /* else the first voice with nothing but a rest (or nothing at all, a hole the engine left) over the place */
      let target = null;
      for (const v of voices) {
        const evs = d.voiceMeasure(v.id, m.id);
        if (evs.some(e => e.kind !== 'rest' && R.le(R.parse(e.at), at) && R.lt(at, endOf(e)))) continue;
        const next = evs.filter(e => e.kind !== 'rest' && R.gt(R.parse(e.at), at)).reduce((a, e) => (a === null || R.lt(R.parse(e.at), a) ? R.parse(e.at) : a), null);
        target = { v: v, end: next === null ? mdur : next };
        break;
      }
      if (!target) fail('occupied', 'no free place');
      const room = R.sub(target.end, at);
      let len = want, disp = displayOf({ type: vd.type, dots: vd.dots || 0 });
      if (R.gt(len, room)) { const pc = pieceFor(room); len = pc.len; disp = pc.display; }
      let newId = null;
      rewrite(d, target.v.id, m.id, plan => {
        plan.push({ kind: 'note', at: R.format(at), dur: R.format(len), display: disp, heads: [{ pitch: pitch }] });
        return plan;
      });
      const ne = d.voiceMeasure(target.v.id, m.id).find(e => e.kind === 'note' && !e.grace && R.eq(R.parse(e.at), at) && !e.prov);
      let nh = null;
      if (ne) { newId = ne.id; nh = ne.heads[0]; d.markProv(ne, ['exists', 'rhythm'], 'edited'); d.markProv(nh, ['pitch'], 'edited'); settle(d, part, args, nh, ne, before, m.id); }
      touched.add(m.id);
      return { event: newId, head: nh && nh.id };
    });
  }
  /* a new head: the accidental asked for, else the bar's and the key's */
  function settle(d, part, args, nh, ne, before, mid) {
    if (args.acc) { nh.acc = { type: args.acc }; }
    const w = walk(d.doc, d.mIdx, part, nh.staff || ne.staff, mid).find(y => y.h === nh);
    const alter = w && w.implied !== undefined ? w.implied : 0;
    nh.pitch = alter ? { step: nh.pitch.step, alter: alter, oct: nh.pitch.oct } : { step: nh.pitch.step, oct: nh.pitch.oct };
    if (args.acc) d.markProv(nh, ['spelling'], 'edited');
    reconcile(d, before, [mid], { skip: new Set([nh.id]) });
  }

  /* an event on the other staff: the staff's first voice with room for it takes it, the rests it leaves are written again */
  function moveStaff(g, args) {
    return run(g, (d, touched) => {
      const x = findEvent(d, args.event), e = x.e, part = x.part;
      if (e.grace) fail('no-target', 'a grace note');
      const st = args.staff || (part.staves.map(s => s.id).find(id => id !== e.staff));
      if (!st || !part.staves.some(s => s.id === st)) fail('no-target', 'no such staff');
      if (st === e.staff) fail('same-staff', 'already there');
      const at = R.parse(e.at), en = endOf(e);
      const free = v => !d.voiceMeasure(v.id, e.m).some(o => o.kind !== 'rest' && overlaps({ s: at, e: en }, { s: atOf(o), e: endOf(o) }));
      const voices = part.voices.filter(v => v.staff === st);
      let target = voices.find(free);
      const mids = [e.m];
      const before = snapshot(d, mids);
      const src = e.voice;
      if (!target) {
        if (voices.length >= 4) fail('occupied', 'no free voice');
        const top = Math.max(0, ...part.voices.map(v => parseInt(v.label, 10)).filter(isFinite));
        const vid = d.addVoice(st, String(top + 1), part);
        target = d.voice(vid);
      }
      d.moveEvent(e.id, target.id, st);
      /* the rests of the voice that took it give way; both voices are rests again where they have no note */
      rewrite(d, target.id, e.m, plan => plan);
      refill(d, src, e.m);
      d.markProv(d.event(e.id), ['staff'], 'edited');
      /* an emptied extra voice of a bar is only rests: a rest of a whole bar */
      reconcile(d, before, mids, {});
      touched.add(e.m);
      return { event: e.id, voice: target.id };
    });
  }

  /* ------------------------------------------------------------------ keys and clefs */
  /* where a key or clef set at measure index `mi` stops governing: the next one of that scope */
  function nextKeyIndex(d, mi, scopeKey) {
    let best = d.doc.timeline.measures.length;
    (d.doc.timeline.keys || []).forEach(k => {
      const i = d.mIdx.get(k.m);
      if (i === undefined || i <= mi || !R.eq(R.parse(k.at), R.ZERO)) return;
      if (scopeKey(k) && i < best) best = i;
    });
    return best;
  }
  /* The key signature from a bar: the notes that stand under it are read again (a note with no accidental of its own takes the key's) */
  function setKey(g, args) {
    return run(g, (d, touched) => {
      const m = measureOf(d, args.measure);
      const fifths = args.fifths;
      if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) fail('no-target', 'not a key');
      const mi = d.mIdx.get(m.id);
      const tl = d.doc.timeline;
      const isGlobal = k => !k.scope;
      const end = nextKeyIndex(d, mi, isGlobal);
      const mids = tl.measures.slice(mi, end).map(x => x.id);
      const before = snapshot(d, mids);
      const keys = tl.keys = tl.keys || [];
      const own = keys.find(k => k.m === m.id && R.eq(R.parse(k.at), R.ZERO) && !k.scope);
      if (own) {
        if (own.fifths === fifths && (own.mode || undefined) === (args.mode || undefined)) return null;
        own.fifths = fifths;
        if (args.mode) own.mode = args.mode; else delete own.mode;
      } else keys.push(Object.assign({ id: d.newId('ky'), m: m.id, at: '0', fifths: fifths }, args.mode ? { mode: args.mode } : {}));
      /* a part's or staff's own key at this bar would still win: it is taken off, the key from here is for the whole score */
      tl.keys = keys.filter(k => !(k.m === m.id && R.eq(R.parse(k.at), R.ZERO) && k.scope));
      d.touch();
      const m0 = mi > 0 ? tl.measures[mi - 1].id : null;
      reconcile(d, before, mids, {});
      mids.forEach(x => touched.add(x));
      void m0;
      return { measures: mids };
    });
  }
  /* The clef of a staff from a bar: the notes of that staff under it are read again (a note stands where it stands and means the pitch of its place in this clef) */
  function setClef(g, args) {
    return run(g, (d, touched) => {
      const m = measureOf(d, args.measure);
      const part = d.doc.parts.find(p => p.staves.some(s => s.id === args.staff));
      if (!part) fail('no-target', 'no staff ' + args.staff);
      const sign = args.sign, line = args.line;
      if (['G', 'F', 'C'].indexOf(sign) < 0) fail('no-target', 'not a clef');
      const mi = d.mIdx.get(m.id);
      const ms = d.doc.timeline.measures;
      const clefsHere = part.clefs.filter(c => c.staff === args.staff).map(c => ({ c: c, i: d.mIdx.get(c.m), at: R.parse(c.at) }))
        .filter(x => x.i !== undefined).sort((a, b) => a.i - b.i || R.cmp(a.at, b.at));
      /* the clef that governed this bar until now */
      let cur = null;
      clefsHere.forEach(x => { if (x.i < mi || (x.i === mi && R.eq(x.at, R.ZERO))) cur = x.c; });
      const next = clefsHere.find(x => x.i > mi || (x.i === mi && R.gt(x.at, R.ZERO)));
      const endIdx = next ? next.i : ms.length;
      const now = { sign: sign, line: Number.isInteger(line) ? line : (sign === 'F' ? 4 : sign === 'C' ? 3 : 2) };
      const was = cur ? { sign: cur.sign, line: Number.isInteger(cur.line) ? cur.line : (cur.sign === 'F' ? 4 : cur.sign === 'C' ? 3 : 2), octave: cur.octave || 0 } : { sign: 'G', line: 2, octave: 0 };
      const same = was.sign === now.sign && was.line === now.line && !was.octave;
      const at0 = part.clefs.find(c => c.staff === args.staff && c.m === m.id && R.eq(R.parse(c.at), R.ZERO));
      if (same && at0) return null;
      if (same && !at0) return null;
      const delta = clefBottom(now) - clefBottom(was);
      const mids = ms.slice(mi, endIdx).map(x => x.id);
      const before = snapshot(d, mids);
      if (at0) { at0.sign = sign; at0.line = now.line; delete at0.octave; }
      else part.clefs.push({ id: d.newId('c'), staff: args.staff, m: m.id, at: '0', sign: sign, line: now.line });
      const moved = new Set();
      part.events.forEach(e => {
        if (e.kind !== 'note' || !e.heads) return;
        const i = d.mIdx.get(e.m);
        if (i === undefined || i < mi || i >= endIdx) return;
        e.heads.forEach(h => {
          if (!h.pitch || (h.staff || e.staff) !== args.staff) return;
          const p = pitchAt(dposOf(h.pitch) + delta, 0);
          h.pitch = p;                                  /* its alteration is read again below */
          moved.add(h.id);
          d.markProv(h, ['pitch'], 'edited');
        });
      });
      d.touch();
      /* the moved notes are read again from their notation; the ones that were not moved keep what they sounded */
      d.doc.parts.forEach(pt => { if (pt !== part) return; });
      moved.forEach(id => { before.set(id, true); });
      reconcile(d, before, mids, { staff: args.staff });
      /* a moved note with a tie: its chain follows */
      syncChains(d, Array.from(moved));
      mids.forEach(x => touched.add(x));
      return { measures: mids, moved: moved.size };
    });
  }

  /* ------------------------------------------------------------------ the time signature */
  /* The time signature from a bar until the next one: the bars are as long as it says. A note that would be cut off stops the edit. */
  function setTime(g, args) {
    return run(g, (d, touched) => {
      const tl = d.doc.timeline;
      const m = measureOf(d, args.measure);
      const beats = Array.isArray(args.beats) ? args.beats.slice() : [args.beats];
      const bt = args.beatType;
      if (!beats.length || beats.some(b => !Number.isInteger(b) || b < 1 || b > 64) || [1, 2, 4, 8, 16, 32].indexOf(bt) < 0) fail('no-target', 'not a time signature');
      const nom = R.make(beats.reduce((a, b) => a + b, 0), bt);
      const mi = d.mIdx.get(m.id);
      const ms = tl.measures;
      let end = ms.length;
      for (let j = mi + 1; j < ms.length; j++) if (tl.meters.some(x => x.m === ms[j].id)) { end = j; break; }
      const own = tl.meters.find(x => x.m === m.id);
      const same = own && sameJson(own.beats, beats) && own.beatType === bt;
      /* the bars it governs, and what each would be: a pickup stays as short as it is */
      const plan = [];
      for (let k = mi; k < end; k++) {
        const mm = ms[k];
        const cur = R.parse(mm.dur);
        const keep = k === 0 && mm.implicit && R.lt(cur, nom);
        plan.push({ m: mm, dur: keep ? cur : nom });
      }
      if (same && plan.every(x => R.eq(R.parse(x.m.dur), x.dur))) return null;
      /* nothing may be cut: a note must end inside its bar, a mark inside it too */
      const newDur = new Map(plan.map(x => [x.m.id, x.dur]));
      d.doc.parts.forEach(part => part.events.forEach(e => {
        const nd = newDur.get(e.m);
        if (!nd || e.kind === 'rest') return;
        if (R.gt(e.grace ? R.parse(e.at) : endOf(e), nd)) fail('would-cut', 'a note would be cut', { event: e.id, measure: e.m });
      }));
      const markAt = (mid, at) => { const nd = newDur.get(mid); if (nd && R.gt(R.parse(at), nd)) fail('would-cut', 'a mark would be cut', { measure: mid }); };
      d.doc.parts.forEach(part => { part.directions.forEach(x => markAt(x.m, x.at)); part.clefs.forEach(x => markAt(x.m, x.at)); });
      (tl.keys || []).forEach(x => markAt(x.m, x.at));
      (tl.tempos || []).forEach(x => markAt(x.m, x.at));
      const mids = plan.map(x => x.m.id);
      /* the rests of a voice that holds none but rests are written for the new length; a voice with notes keeps its rests where they fit */
      const lone = [];
      d.doc.parts.forEach(part => part.voices.forEach(v => {
        mids.forEach(mid => {
          const evs = d.voiceMeasure(v.id, mid);
          if (evs.length && evs.every(e => e.kind === 'rest')) lone.push({ v: v.id, m: mid, ids: evs.map(e => e.id) });
        });
      }));
      const before = snapshot(d, mids);
      if (own) { own.beats = beats; own.beatType = bt; delete own.symbol; delete own.groups; }
      else tl.meters.push({ id: d.newId('mt'), m: m.id, beats: beats, beatType: bt });
      /* the next time signature, if it is this one again, is no change */
      if (end < ms.length) {
        const nx = tl.meters.find(x => x.m === ms[end].id);
        if (nx && sameJson(nx.beats, beats) && nx.beatType === bt && !nx.groups) { tl.meters = tl.meters.filter(x => x !== nx); d.retire(nx.id); }
      }
      plan.forEach(x => { if (!R.eq(R.parse(x.m.dur), x.dur)) { x.m.dur = R.format(x.dur); x.m.prov = d.provRefOf({ source: SOURCE, op: 'edited' }); } });
      reindexTimeline(d);
      lone.forEach(l => { d.removeEvents(l.ids); });
      d.touch();
      const seen = new Set();
      d.doc.parts.forEach(part => part.voices.forEach(v => mids.forEach(mid => {
        const k = v.id + '|' + mid;
        if (seen.has(k)) return;
        seen.add(k);
        const evs = d.voiceMeasure(v.id, mid);
        if (!evs.length && !lone.some(l => l.v === v.id && l.m === mid)) return;
        refill(d, v.id, mid);
      })));
      mids.forEach(x => touched.add(x));
      reconcile(d, before, mids, {});
      return { measures: mids };
    });
  }

  /* ------------------------------------------------------------------ bars */
  const renumber = (d, from) => {
    const ms = d.doc.timeline.measures;
    for (let i = Math.max(1, from); i < ms.length; i++) {
      const prev = parseInt(ms[i - 1].number, 10);
      ms[i].number = String((isFinite(prev) ? prev : i) + 1);
    }
  };
  const meterAtIndex = (d, i) => {
    const tl = d.doc.timeline, ms = tl.measures;
    let m = null;
    for (let k = 0; k <= i && k < ms.length; k++) { const x = tl.meters.find(y => y.m === ms[k].id); if (x) m = x; }
    return m;
  };
  const nominalOf = meter => R.make(meter.beats.reduce((a, b) => a + b, 0), meter.beatType);
  const hasMeasureRef = (list, mid) => (list || []).some(x => x.m === mid);
  /* ties that run from before a bar line to after it: a bar put in between would end them in the middle of nothing */
  function dropTiesAcross(d, boundaryIndex) {
    d.doc.parts.forEach(part => {
      const where = new Map();
      part.events.forEach(e => (e.heads || []).forEach(h => where.set(h.id, d.mIdx.get(e.m))));
      part.spanners = part.spanners.filter(s => {
        if (s.type !== 'tie' || s.from === undefined || s.to === undefined) return true;
        const a = where.get(s.from), b = where.get(s.to);
        if (a === undefined || b === undefined) return true;
        if (a < boundaryIndex && b >= boundaryIndex) { d.retire(s.id); return false; }
        return true;
      });
    });
  }
  function newBarRests(d, mid) {
    d.doc.parts.forEach(part => {
      part.staves.forEach(st => {
        const v = part.voices.find(x => x.staff === st.id);
        if (!v) return;
        const piece = restPieces(d.doc, mid, '0', R.format(durOf(d, mid)));
        piece.forEach(p => {
          const ev = { id: d.newId('e'), kind: 'rest', m: mid, at: p.at, dur: p.dur, voice: v.id, staff: st.id, display: p.display };
          part.events.push(ev);
          d.markProv(ev, ['exists'], 'edited');
        });
      });
    });
  }
  /* a bar after (or, with `before`, ahead of) a bar: as long as the time signature there says, a rest in every staff */
  function insertBar(g, args) {
    return run(g, (d, touched) => {
      const tl = d.doc.timeline, ms = tl.measures;
      const ref = measureOf(d, args.before || args.after);
      const i0 = d.mIdx.get(ref.id);
      const at = args.before ? i0 : i0 + 1;
      const nomIdx = Math.max(0, at - 1);
      const meter = meterAtIndex(d, at === 0 ? 0 : nomIdx) || meterAtIndex(d, 0);
      const dur = meter ? nominalOf(meter) : R.make(1, 1);
      const nid = d.newId('m');
      const nm = { id: nid, number: '0', dur: R.format(dur), prov: d.provRefOf({ source: SOURCE, op: 'edited' }) };
      dropTiesAcross(d, at);
      if (at === 0) {
        /* ahead of the first bar: what stands at the start of the score stands at the new first bar */
        const first = ms[0].id;
        tl.meters.forEach(x => { if (x.m === first) x.m = nid; });
        (tl.keys || []).forEach(x => { if (x.m === first && R.eq(R.parse(x.at), R.ZERO)) x.m = nid; });
        (tl.tempos || []).forEach(x => { if (x.m === first && R.eq(R.parse(x.at), R.ZERO)) x.m = nid; });
        d.doc.parts.forEach(p => p.clefs.forEach(x => { if (x.m === first && R.eq(R.parse(x.at), R.ZERO)) x.m = nid; }));
      }
      ms.splice(at, 0, nm);
      reindexTimeline(d);
      /* the bar lines of its neighbours: a repeat sign stays with the bar it was written on */
      const firstNum = parseInt(ms[at === 0 ? 1 : 0].number, 10);
      if (at === 0) { ms[0].number = String(isFinite(firstNum) ? firstNum : 1); renumber(d, 1); }
      else renumber(d, at);
      newBarRests(d, nid);
      d.touch();
      touched.add(nid);
      return { measure: nid };
    });
  }

  function retargetRef(list, from, to) { list.forEach(x => { if (x.from === from) x.from = to; if (x.to === from) x.to = to; }); }

  /* a bar and everything written in it goes; what refers to it is moved to its neighbour or goes with it */
  function removeBar(g, args) {
    return run(g, (d, touched) => {
      const tl = d.doc.timeline, ms = tl.measures;
      const m = measureOf(d, args.measure);
      if (ms.length <= 1) fail('last-bar', 'the only bar');
      const i = d.mIdx.get(m.id);
      const prev = i > 0 ? ms[i - 1] : null, next = i + 1 < ms.length ? ms[i + 1] : null;
      const evIds = [];
      d.doc.parts.forEach(p => p.events.forEach(e => { if (e.m === m.id) evIds.push(e.id); }));
      d.removeEvents(evIds);
      d.doc.parts.forEach(part => {
        part.directions = part.directions.filter(x => { if (x.m === m.id) { d.retire(x.id); return false; } return true; });
        part.clefs = part.clefs.filter(c => {
          if (c.m !== m.id) return true;
          const clash = next && part.clefs.some(o => o !== c && o.staff === c.staff && o.m === next.id && R.eq(R.parse(o.at), R.ZERO));
          if (next && R.eq(R.parse(c.at), R.ZERO) && !clash) { c.m = next.id; return true; }
          d.retire(c.id); return false;
        });
        part.spanners = part.spanners.filter(s => {
          if (s.type === 'wedge' || s.type === 'ottava' || s.type === 'pedal') {
            if (s.from && s.from.m === m.id) { if (next) s.from = { m: next.id, at: '0' }; else { d.retire(s.id); return false; } }
            if (s.to && s.to.m === m.id) { if (prev) s.to = { m: prev.id, at: prev.dur }; else { d.retire(s.id); return false; } }
            if (s.changes) s.changes = s.changes.filter(c => c.m !== m.id);
            return true;
          }
          return true;
        });
      });
      const move = (list, keep) => (list || []).filter(x => {
        if (x.m !== m.id) return true;
        if (next && R.eq(R.parse(x.at === undefined ? '0' : x.at), R.ZERO) && keep(x)) { x.m = next.id; return true; }
        d.retire(x.id); return false;
      });
      tl.meters = tl.meters.filter(x => {
        if (x.m !== m.id) return true;
        if (next && !tl.meters.some(o => o !== x && o.m === next.id)) { x.m = next.id; return true; }
        d.retire(x.id); return false;
      });
      tl.keys = move(tl.keys, k => !tl.keys.some(o => o !== k && o.m === next.id && R.eq(R.parse(o.at), R.ZERO) && sameJson(o.scope || null, k.scope || null)));
      tl.tempos = move(tl.tempos, () => !tl.tempos.some(o => o.m === (next && next.id) && R.eq(R.parse(o.at), R.ZERO)));
      tl.jumps = (tl.jumps || []).filter(j => { if (j.m === m.id) { d.retire(j.id); return false; } return true; });
      const jumpIds = new Set(tl.jumps.map(j => j.id));
      tl.jumps.forEach(j => { if (j.target !== undefined && !jumpIds.has(j.target)) delete j.target; });
      tl.endings = (tl.endings || []).filter(en => {
        if (en.from === m.id) { if (next && R.lt(R.make(d.mIdx.get(next.id)), R.make(d.mIdx.get(en.to) + 1))) en.from = next.id; else { d.retire(en.id); return false; } }
        if (en.to === m.id) { if (prev && d.mIdx.get(prev.id) >= d.mIdx.get(en.from)) en.to = prev.id; else { d.retire(en.id); return false; } }
        return true;
      });
      if (d.doc.structure) {
        const st = d.doc.structure;
        st.sections = (st.sections || []).filter(sc => {
          if (sc.from === m.id) { if (next && d.mIdx.get(next.id) <= d.mIdx.get(sc.to)) sc.from = next.id; else { d.retire(sc.id); return false; } }
          if (sc.to === m.id) { if (prev && d.mIdx.get(prev.id) >= d.mIdx.get(sc.from)) sc.to = prev.id; else { d.retire(sc.id); return false; } }
          return true;
        });
        const secIds = new Set(st.sections.map(s => s.id));
        st.sections.forEach(s => { if (s.parent !== undefined && !secIds.has(s.parent)) delete s.parent; });
        st.phrases = (st.phrases || []).filter(ph => {
          if (ph.from.m === m.id || ph.to.m === m.id) { d.retire(ph.id); return false; }
          if (ph.section !== undefined && !secIds.has(ph.section)) delete ph.section;
          return true;
        });
      }
      (d.doc.performances || []).forEach(pf => { if (pf.anchors) pf.anchors = pf.anchors.filter(a => a.m !== m.id); });
      if (d.doc.provenance.flags) {
        d.doc.provenance.flags.forEach(fl => {
          if (fl.ids) { fl.ids = fl.ids.filter(x => x !== m.id); if (!fl.ids.length) delete fl.ids; }
          if (fl.span && (fl.span.from.m === m.id || fl.span.to.m === m.id)) delete fl.span;
        });
        d.doc.provenance.flags = d.doc.provenance.flags.filter(fl => !(fl.kind === 'review' && fl.code === 'reviewed' && !fl.ids));
      }
      ms.splice(i, 1);
      d.retire(m.id);
      reindexTimeline(d);
      /* the new first bar has the number the old one had: a score starts where it started */
      if (i === 0) ms[0].number = m.number;
      renumber(d, 1);
      d.touch();
      if (next) touched.add(next.id); else if (prev) touched.add(prev.id);
      return { removed: m.id };
    });
  }

  /* a bar becomes two at a place inside it (W): a note across the place is written as two tied notes */
  function splitBar(g, args) {
    return run(g, (d, touched) => {
      const tl = d.doc.timeline, ms = tl.measures;
      const m = measureOf(d, args.measure);
      const at = R.parse(args.at);
      const mdur = R.parse(m.dur);
      if (R.sign(at) <= 0 || R.ge(at, mdur)) fail('no-target', 'outside the bar');
      const i = d.mIdx.get(m.id);
      const before = snapshot(d, [m.id]);
      /* notes and rests across the place are cut there */
      const across = [];
      d.doc.parts.forEach(part => part.events.forEach(e => {
        if (e.m !== m.id || e.grace) return;
        if (R.lt(R.parse(e.at), at) && R.gt(endOf(e), at)) across.push(e);
      }));
      across.forEach(e => {
        if (inTuplet(d, e)) fail('in-tuplet', 'a tuplet crosses the place');
        const a = R.sub(at, R.parse(e.at)), b = R.sub(endOf(e), at);
        if (e.kind === 'note') {
          if (!displayFor(a) && !pieceFor(a)) fail('unprintable', 'no written value');
          d.splitEvent(e.id, R.format(at), displayFor(a), displayFor(b));
          d.markProv(d.event(e.id), ['rhythm'], 'edited');
        } else {
          /* a rest is written again in its two bars below */
          d.splitEvent(e.id, R.format(at), null, null);
        }
      });
      const nid = d.newId('m');
      const nm = { id: nid, number: '0', dur: R.format(R.sub(mdur, at)), prov: d.provRefOf({ source: SOURCE, op: 'edited' }) };
      /* a beam over notes of both bars is cut; a tuplet over them cannot be */
      d.doc.parts.forEach(part => {
        const startsLate = new Set(part.events.filter(e => e.m === m.id && R.ge(R.parse(e.at), at)).map(e => e.id));
        const early = new Set(part.events.filter(e => e.m === m.id && R.lt(R.parse(e.at), at)).map(e => e.id));
        part.spanners = part.spanners.filter(s => {
          if (s.type !== 'beam' && s.type !== 'tuplet') return true;
          const late = s.events.some(id => startsLate.has(id)), soon = s.events.some(id => early.has(id));
          if (!(late && soon)) return true;
          if (s.type === 'tuplet') fail('in-tuplet', 'a tuplet stands across the place');
          d.retire(s.id);
          return false;
        });
      });
      /* what starts at or after the place goes to the new bar */
      d.doc.parts.forEach(part => {
        part.events.forEach(e => {
          if (e.m !== m.id) return;
          if (R.ge(R.parse(e.at), at)) { e.m = nid; e.at = R.format(R.sub(R.parse(e.at), at)); }
        });
        part.directions.forEach(x => { if (x.m === m.id && R.ge(R.parse(x.at), at)) { x.m = nid; x.at = R.format(R.sub(R.parse(x.at), at)); } });
        part.clefs.forEach(x => { if (x.m === m.id && R.ge(R.parse(x.at), at)) { x.m = nid; x.at = R.format(R.sub(R.parse(x.at), at)); } });
        part.spanners.forEach(s => {
          if (s.type === 'wedge' || s.type === 'ottava' || s.type === 'pedal') {
            if (s.from && s.from.m === m.id && R.ge(R.parse(s.from.at), at)) s.from = { m: nid, at: R.format(R.sub(R.parse(s.from.at), at)) };
            if (s.to && s.to.m === m.id && R.gt(R.parse(s.to.at), at)) s.to = { m: nid, at: R.format(R.sub(R.parse(s.to.at), at)) };
            if (s.changes) s.changes.forEach((c, k) => { if (c.m === m.id && R.ge(R.parse(c.at), at)) s.changes[k] = { m: nid, at: R.format(R.sub(R.parse(c.at), at)) }; });
          }
        });
      });
      (tl.keys || []).forEach(x => { if (x.m === m.id && R.ge(R.parse(x.at), at)) { x.m = nid; x.at = R.format(R.sub(R.parse(x.at), at)); } });
      (tl.tempos || []).forEach(x => { if (x.m === m.id && R.ge(R.parse(x.at), at)) { x.m = nid; x.at = R.format(R.sub(R.parse(x.at), at)); } });
      (tl.jumps || []).forEach(x => { if (x.m === m.id && R.ge(R.parse(x.at), at)) { x.m = nid; x.at = R.format(R.sub(R.parse(x.at), at)); } });
      if (d.doc.structure) (d.doc.structure.phrases || []).forEach(ph => {
        ['from', 'to'].forEach(k => { if (ph[k].m === m.id && (k === 'from' ? R.ge : R.gt)(R.parse(ph[k].at), at)) ph[k] = { m: nid, at: R.format(R.sub(R.parse(ph[k].at), at)) }; });
      });
      /* the right bar line, the endings and sections that ended here, move to the second bar */
      if (m.barline && m.barline.right) { nm.barline = { right: m.barline.right }; const left = m.barline.left; if (left) m.barline = { left: left }; else delete m.barline; }
      (tl.endings || []).forEach(en => { if (en.to === m.id) en.to = nid; });
      if (d.doc.structure) (d.doc.structure.sections || []).forEach(sc => { if (sc.to === m.id) sc.to = nid; });
      m.dur = R.format(at);
      m.prov = d.provRefOf({ source: SOURCE, op: 'edited' });
      ms.splice(i + 1, 0, nm);
      reindexTimeline(d);
      renumber(d, i + 1);
      /* the rests of the two bars are written again (a rest cut in two, a gap) */
      const seen = new Set();
      d.doc.parts.forEach(part => part.voices.forEach(v => [m.id, nid].forEach(mid => {
        const k = v.id + '|' + mid;
        if (seen.has(k)) return;
        seen.add(k);
        const evs = d.voiceMeasure(v.id, mid);
        if (evs.length) {
          /* a rest that was cut in two keeps its two halves as one rest of each bar: written again */
          const rs = evs.filter(e => e.kind === 'rest');
          if (rs.length) d.removeEvents(rs.map(e => e.id));
          refill(d, v.id, mid);
        }
      })));
      d.touch();
      reconcile(d, before, [m.id, nid], {});
      touched.add(m.id); touched.add(nid);
      return { measures: [m.id, nid] };
    });
  }

  /* a bar and the next one become one: what was in the second stands after the first */
  function mergeBars(g, args) {
    return run(g, (d, touched) => {
      const tl = d.doc.timeline, ms = tl.measures;
      const a = measureOf(d, args.measure);
      const i = d.mIdx.get(a.id);
      if (i + 1 >= ms.length) fail('no-target', 'no next bar');
      const b = ms[i + 1];
      const meterA = meterAtIndex(d, i), meterB = tl.meters.find(x => x.m === b.id);
      if (meterB && meterA && !(sameJson(meterB.beats, meterA.beats) && meterB.beatType === meterA.beatType)) fail('meter-differs', 'different time signatures');
      if (meterB && !meterA) fail('meter-differs', 'different time signatures');
      const before = snapshot(d, [a.id, b.id]);
      const da = R.parse(a.dur), db = R.parse(b.dur);
      const shift = x => R.format(R.add(R.parse(x), da));
      d.doc.parts.forEach(part => {
        part.events.forEach(e => {
          if (e.m !== b.id) return;
          e.m = a.id; e.at = shift(e.at);
          if (e.kind === 'rest' && e.display && e.display.measureRest) { e.display = Object.assign({}, e.display); delete e.display.measureRest; }
        });
        part.events.forEach(e => { if (e.m === a.id && e.kind === 'rest' && e.display && e.display.measureRest) { e.display = Object.assign({}, e.display); delete e.display.measureRest; } });
        part.directions.forEach(x => { if (x.m === b.id) { x.m = a.id; x.at = shift(x.at); } });
        part.clefs.forEach(x => { if (x.m === b.id) { x.m = a.id; x.at = shift(x.at); } });
        part.spanners.forEach(s => {
          if (s.type === 'wedge' || s.type === 'ottava' || s.type === 'pedal') {
            if (s.from && s.from.m === b.id) s.from = { m: a.id, at: shift(s.from.at) };
            if (s.to && s.to.m === b.id) s.to = { m: a.id, at: shift(s.to.at) };
            if (s.changes) s.changes = s.changes.map(c => (c.m === b.id ? { m: a.id, at: shift(c.at) } : c));
          }
        });
      });
      if (meterB) { tl.meters = tl.meters.filter(x => x !== meterB); d.retire(meterB.id); }
      (tl.keys || []).forEach(x => { if (x.m === b.id) { x.m = a.id; x.at = shift(x.at); } });
      (tl.tempos || []).forEach(x => { if (x.m === b.id) { x.m = a.id; x.at = shift(x.at); } });
      (tl.jumps || []).forEach(x => { if (x.m === b.id) { x.m = a.id; x.at = shift(x.at); } });
      /* two keys of one place: the first one stays */
      const seenKey = new Set();
      tl.keys = (tl.keys || []).filter(k => { const key = k.m + '|' + k.at + '|' + JSON.stringify(k.scope || null); if (seenKey.has(key)) { d.retire(k.id); return false; } seenKey.add(key); return true; });
      if (d.doc.structure) {
        (d.doc.structure.phrases || []).forEach(ph => ['from', 'to'].forEach(k => { if (ph[k].m === b.id) ph[k] = { m: a.id, at: shift(ph[k].at) }; }));
        (d.doc.structure.sections || []).forEach(sc => { if (sc.from === b.id) sc.from = a.id; if (sc.to === b.id) sc.to = a.id; });
      }
      (tl.endings || []).forEach(en => { if (en.from === b.id) en.from = a.id; if (en.to === b.id) en.to = a.id; });
      (d.doc.performances || []).forEach(pf => (pf.anchors || []).forEach(an => { if (an.m === b.id) { an.m = a.id; an.at = shift(an.at); } }));
      if (d.doc.provenance.flags) d.doc.provenance.flags.forEach(fl => { if (fl.ids) fl.ids = fl.ids.map(x => (x === b.id ? a.id : x)); });
      /* the bar line on the right is the second bar's */
      if (b.barline && b.barline.right) a.barline = Object.assign({}, a.barline || {}, { right: b.barline.right });
      else if (a.barline && a.barline.right) { const left = a.barline.left; if (left) a.barline = { left: left }; else delete a.barline; }
      a.dur = R.format(R.add(da, db));
      a.prov = d.provRefOf({ source: SOURCE, op: 'edited' });
      ms.splice(i + 1, 1);
      d.retire(b.id, a.id);
      reindexTimeline(d);
      renumber(d, i + 1);
      /* a voice that was a rest at the end of the first bar and one at the start of the second: one stretch of rests */
      const seen = new Set();
      d.doc.parts.forEach(part => part.voices.forEach(v => {
        if (seen.has(v.id)) return;
        seen.add(v.id);
        const evs = d.voiceMeasure(v.id, a.id);
        if (evs.length && evs.every(e => e.kind === 'rest')) { d.removeEvents(evs.map(e => e.id)); }
        if (evs.length) refill(d, v.id, a.id);
      }));
      d.touch();
      reconcile(d, before, [a.id], {});
      touched.add(a.id);
      return { measure: a.id };
    });
  }

  /* ------------------------------------------------------------------ staves and parts */
  /* two one-staff parts become one part of two staves (a piano): the second part's staves, voices, notes and marks are the first's */
  function mergeParts(g, args) {
    return run(g, (d, touched) => {
      const A = d.doc.parts.find(p => p.id === args.keep), B = d.doc.parts.find(p => p.id === args.into);
      if (!A || !B || A === B) fail('no-target', 'no such part');
      const used = new Set(A.voices.map(v => parseInt(v.label, 10)).filter(isFinite));
      let nextLabel = Math.max(0, ...A.voices.map(v => parseInt(v.label, 10)).filter(isFinite), ...B.voices.map(v => parseInt(v.label, 10)).filter(isFinite)) + 1;
      B.voices.forEach(v => {
        const n = parseInt(v.label, 10);
        if (!isFinite(n) || used.has(n)) { v.label = String(nextLabel++); }
        used.add(parseInt(v.label, 10));
      });
      A.staves = A.staves.concat(B.staves);
      A.voices = A.voices.concat(B.voices);
      A.clefs = A.clefs.concat(B.clefs);
      A.events = A.events.concat(B.events);
      A.directions = A.directions.concat(B.directions);
      A.spanners = A.spanners.concat(B.spanners);
      const idB = B.id, idA = A.id;
      (d.doc.timeline.keys || []).forEach(k => { if (k.scope && k.scope.part === idB) k.scope.part = idA; });
      (d.doc.performances || []).forEach(pf => pf.notes.forEach(pn => { if (pn.part === idB) pn.part = idA; }));
      if (d.doc.structure) (d.doc.structure.phrases || []).forEach(ph => { if (ph.part === idB) ph.part = idA; });
      const disp = list => (list || []).forEach(x => (x.display || []).forEach(dd => { if (dd.part === idB) dd.part = idA; }));
      disp(d.doc.timeline.tempos); disp(d.doc.timeline.jumps);
      (d.doc.provenance.flags || []).forEach(fl => { if (fl.span && fl.span.part === idB) fl.span.part = idA; });
      d.doc.parts = d.doc.parts.filter(p => p !== B);
      d.retire(idB, idA);
      d.reindex();
      d.markProv(A, ['staff'], 'edited');
      d.touch();
      d.doc.timeline.measures.forEach(m => touched.add(m.id));
      return { part: idA };
    });
  }
  /* which hand a staff is: the upper staff of the piano plays the right, the others the left (scoregraph/legacy-score.js); hand 'RH' puts the staff first, 'LH' last */
  function assignHand(g, args) {
    return run(g, (d, touched) => {
      const part = d.doc.parts.find(p => p.staves.some(s => s.id === args.staff));
      if (!part) fail('no-target', 'no such staff');
      const hand = args.hand === 'LH' ? 'LH' : 'RH';
      if (part.staves.length > 1) {
        const k = part.staves.findIndex(s => s.id === args.staff);
        const st = part.staves.splice(k, 1)[0];
        if (hand === 'RH') part.staves.unshift(st); else part.staves.push(st);
        if (part.staves.map(s => s.id).join() === g.parts.find(p => p.id === part.id).staves.map(s => s.id).join()) return null;
      } else {
        const idx = d.doc.parts.indexOf(part);
        if (d.doc.parts.length < 2) return null;
        if (hand === 'RH' && idx === 0) return null;
        if (hand === 'LH' && idx === d.doc.parts.length - 1) return null;
        d.doc.parts.splice(idx, 1);
        if (hand === 'RH') d.doc.parts.unshift(part); else d.doc.parts.push(part);
      }
      d.markProv(part, ['staff'], 'edited');
      d.touch();
      d.doc.timeline.measures.forEach(m => touched.add(m.id));
      return { staff: args.staff, hand: hand };
    });
  }

  /* ------------------------------------------------------------------ a bar looked at and accepted */
  function clearReviewed(d, ids) {
    const fl = d.doc.provenance.flags;
    if (!fl || !fl.length || !ids.size) return;
    const keep = fl.filter(f => !(f.kind === 'review' && f.code === 'reviewed' && f.ids && f.ids.length && f.ids.every(x => ids.has(x))));
    if (keep.length !== fl.length) d.doc.provenance.flags = keep;
  }
  function markReviewed(g, args) {
    const res = OPS.edit(g, d => {
      measureOf(d, args.measure);
      const fl = d.doc.provenance.flags = d.doc.provenance.flags || [];
      if (fl.some(f => f.kind === 'review' && f.code === 'reviewed' && f.ids && f.ids.length === 1 && f.ids[0] === args.measure)) return null;
      fl.push({ id: d.newId('fl'), kind: 'review', code: 'reviewed', ids: [args.measure], src: d.source() });
      d.touch();
      return null;
    }, { source: SOURCE });
    return { graph: res.graph, changed: !!res.changed, idMap: res.idMap || {}, issues: res.issues || [], measures: [args.measure] };
  }
  function unmarkReviewed(g, args) {
    const res = OPS.edit(g, d => {
      const fl = d.doc.provenance.flags || [];
      const keep = fl.filter(f => !(f.kind === 'review' && f.code === 'reviewed' && f.ids && f.ids.indexOf(args.measure) >= 0));
      if (keep.length === fl.length) return null;
      d.doc.provenance.flags = keep;
      d.touch();
      return null;
    }, { source: SOURCE });
    return { graph: res.graph, changed: !!res.changed, idMap: res.idMap || {}, issues: res.issues || [], measures: [args.measure] };
  }
  /* the IDs of the bars marked as right */
  function reviewedBars(g) {
    const out = new Set();
    ((g.provenance && g.provenance.flags) || []).forEach(f => { if (f.kind === 'review' && f.code === 'reviewed') (f.ids || []).forEach(x => out.add(x)); });
    return out;
  }
  /* the IDs of the bars a person has changed (provenance op 'edited' on the bar, a note, a head or a mark in it) */
  function editedBars(g) {
    const out = new Set();
    const isEd = prov => {
      if (!prov) return false;
      if (prov.op === 'edited') return true;
      return !!prov.asp && Object.keys(prov.asp).some(k => prov.asp[k] && prov.asp[k].op === 'edited');
    };
    g.timeline.measures.forEach(m => { if (isEd(m.prov)) out.add(m.id); });
    g.parts.forEach(part => {
      part.events.forEach(e => { if (isEd(e.prov) || (e.heads || []).some(h => isEd(h.prov))) out.add(e.m); });
      part.directions.forEach(x => { if (isEd(x.prov)) out.add(x.m); });
    });
    return out;
  }

  return Object.freeze({
    VERSION: VERSION, SOURCE: SOURCE, EditError: EditError,
    step: step, octave: octave, accidental: accidental, value: value, toRest: toRest, toNote: toNote, remove: remove, removeHead: removeHead, add: add, moveStaff: moveStaff,
    setKey: setKey, setClef: setClef, setTime: setTime,
    insertBar: insertBar, removeBar: removeBar, splitBar: splitBar, mergeBars: mergeBars,
    mergeParts: mergeParts, assignHand: assignHand,
    markReviewed: markReviewed, unmarkReviewed: unmarkReviewed, reviewedBars: reviewedBars, editedBars: editedBars,
    /* for the editor and the tests */
    displayFor: displayFor, pieceFor: pieceFor, restPieces: restPieces, tieChain: tieChain, walk: walk, clefBottom: clefBottom, keyAlter: keyAlter, keyFifths: keyFifths
  });
});
