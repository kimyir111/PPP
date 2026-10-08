/* ============================================================================
   PPP OMR findings as graph edits (docs/GOALS/G12_OMR.md section 7.3, phase G12-2 "S4 for OMR")

   Until G12-2 the findings of the page's own text and lines (PdfLayer.apply: an accidental the engine did not read, an arpeggio line it read as notes, a voice
   it started late, an 8va bracket, the chord names, segno and coda, the title and the tempo) were written onto the legacy Score the OMR import made, and the
   graph the renderer drew was made again from the raw MusicXML and so lacked all of them: the renderer then fell back on a graph projected from the Score
   (no beams). Now the import is a ScoreGraph (scoregraph/import.js, S4) and the findings are edits of that graph, each with provenance: op 'inferred', source
   {kind 'omr', tool 'pdflayer'}. The Score is made from the edited graph (toScore), so the graph the renderer draws, the Score the player plays and the
   judge reads are one thing.

   Pure (no DOM, no network, no clock): Node and browser, UMD. Its one dependency is the ScoreGraph library (scoregraph/index.js).

     diff(before, after)              -> findings   what PdfLayer.apply changed, read off two Scores: `before` a snapshot of the scratch Score taken before it ran,
                                                    `after` the same object once it had run. Both come from toScore(graph, {ids: true}), so every note names the graph
                                                    event (sgEvent) and head (sgHead) it is. The page never lets PdfLayer touch the Score it keeps.
     apply(graph, findings, opts?)    -> {graph, changed, applied, already, skipped, src}
     ops.<name>(graph, item)          each kind of edit alone: setPitch, dropEvent, moveEvent, markArpeggio, addOttava, addChord, removeChord, addMark,
                                      removeMark, setHeading; {graph, changed, status}; throws when the edit cannot be made
     markOmr(graph, info?)            -> {graph, changed}  ext 'ppp.omr' {hands: 'by-staff'}: the graph came from an OMR page (scoregraph/legacy-score.js reads it)

   Rules:
     - A graph is never changed: every edit is a new graph (rev + 1) made by ops.edit, validated once at its end. An edit that would make the graph invalid is
       not made and is named in `skipped` with the validator's reason; the others are. (All of them are tried in one transaction first, then halves of the list,
       so one bad edit costs the others nothing.)
     - Idempotent: applying findings that are already true of the graph changes nothing and returns the same graph (`already` counts them).
     - Nothing is lost silently: a removed note is a phantom the page's arpeggio line explains (a whole chord at once; a partial chord is skipped, named), counted;
       a move keeps the event, its heads and its ties; a beam or tuplet over events only some of which move goes (the passes that own groups regroup).
     - Provenance, exactly: a head whose pitch or accidental the page changed carries prov.asp.pitch / .spelling {src: <omr/pdflayer source>, op: 'inferred'}; an event
       that moved carries prov.asp.rhythm; a new arpeggio, 8va or chord name carries prov {src, op}. The schema has no provenance field for a jump (segno, coda, D.S.), a
       tempo or the title and composer: those edits carry none (the result's `applied` counts them). A note, chord name or mark the page took away leaves no entity to
       carry anything: the result's `removed` lists them (counts, and the first 100 with bar, place and pitches). The source itself is in provenance.sources.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'));
  else root.PPPOmrApply = factory(root.PPPScoreGraph);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG) {
  'use strict';
  if (!SG || !SG.ops || !SG.rational || !SG.legacy || typeof SG.legacy.ratQ !== 'function') throw new Error('omr/apply.js needs the ScoreGraph library (scoregraph/index.js)');
  const R = SG.rational, OPS = SG.ops, L = SG.legacy;

  const VERSION = 1;
  const SOURCE = Object.freeze({ kind: 'omr', tool: 'pdflayer', version: '1' });
  const GROUPS = ['drops', 'pitches', 'moves', 'arps', 'ottavas', 'chordsOut', 'chordsIn', 'marksOut', 'marksIn', 'heading'];
  const OCTAVES_OF_SIZE = { 8: 1, 15: 2, 22: 3 };
  const JUMP_OF = { segno: 'segno', coda: 'coda', fine: 'fine', dc: 'dacapo', ds: 'dalsegno', tocoda: 'tocoda' };
  const PITCH_RE = /^([A-G])(#{1,3}|b{1,3})?(-?\d+)$/;

  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  class Skip extends Error { constructor(why) { super(why); this.name = 'Skip'; this.why = why; } }
  /* what a finding must be before an edit is made from it: a number is finite, a pitch has a letter, a whole octave and a whole alteration */
  const fin = x => typeof x === 'number' && isFinite(x);
  const need = (ok, why) => { if (!ok) throw new Skip(why); };
  const ACCIDENTALS = ['sharp', 'flat', 'natural', 'double-sharp', 'flat-flat', 'sharp-sharp', 'natural-sharp', 'natural-flat', 'quarter-sharp', 'quarter-flat'];
  const validPitch = p => !!p && typeof p === 'object' && 'CDEFGAB'.indexOf(p.step) >= 0 && typeof p.step === 'string' && p.step.length === 1 && Number.isInteger(p.oct) && p.oct >= 0 && p.oct <= 9
    && (p.alter === undefined || (Number.isInteger(p.alter) && p.alter >= -3 && p.alter <= 3));

  /* ------------------------------------------------------------------ findings */
  function emptyFindings() {
    return { version: VERSION, drops: [], pitches: [], moves: [], arps: [], ottavas: [], chordsOut: [], chordsIn: [], marksOut: [], marksIn: [], heading: null, conflicts: [] };
  }
  function parsePitch(name) {
    const m = PITCH_RE.exec(String(name || ''));
    if (!m) return null;
    const alter = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
    return alter ? { step: m[1], alter: alter, oct: parseInt(m[3], 10) } : { step: m[1], oct: parseInt(m[3], 10) };
  }
  const chordKey = c => c.m + '|' + Math.round(c.b * 1e6) + '|' + c.text;
  const markKey = k => k.m + '|' + k.kind + '|' + (k.text === undefined || k.text === null ? '' : k.text);
  const ottavaKey = o => [o.staff, o.m, Math.round(o.b * 1e6), o.endM, Math.round((o.endB || 0) * 1e6), o.dir, o.size, o.semitones].join('|');

  /* What PdfLayer.apply changed. before/after: Scores (toScore with ids). Notes are matched by the graph head they are (sgHead). */
  function diff(before, after) {
    const f = emptyFindings();
    if (!before || !after || !Array.isArray(before.notes) || !Array.isArray(after.notes)) return f;
    const heads = ns => { const m = new Map(); ns.forEach(n => { if (!n.rest && n.sgHead) m.set(n.sgHead, n); }); return m; };
    const was = heads(before.notes), now = heads(after.notes);
    const headsOf = new Map();                                   /* graph event -> its heads, before */
    was.forEach((n, h) => { if (!headsOf.has(n.sgEvent)) headsOf.set(n.sgEvent, []); headsOf.get(n.sgEvent).push(h); });

    /* notes the page's lines do not show: whole events (a chord goes at once) */
    const gone = new Map();
    was.forEach((n, h) => { if (!now.has(h)) { if (!gone.has(n.sgEvent)) gone.set(n.sgEvent, []); gone.get(n.sgEvent).push(h); } });
    gone.forEach((hs, ev) => f.drops.push({ event: ev, heads: hs.slice().sort(), of: headsOf.get(ev).length }));

    const moves = new Map(), arps = new Map();
    now.forEach((a, h) => {
      const b = was.get(h);
      if (!b) return;
      if (a.p !== b.p || (a.acc || null) !== (b.acc || null)) {
        const pitch = parsePitch(a.p);
        if (pitch) f.pitches.push({ head: h, event: a.sgEvent, pitch: pitch, acc: a.acc || null, was: b.p, wasAcc: b.acc || null });
        else f.conflicts.push({ kind: 'pitch', head: h, why: 'unreadable pitch ' + a.p });
      }
      if (a.arp && !b.arp) { if (!arps.has(a.sgEvent)) arps.set(a.sgEvent, new Set()); arps.get(a.sgEvent).add(h); }
      if (!close(a.b, b.b)) {
        const prev = moves.get(a.sgEvent);
        if (prev && !close(prev.b, a.b)) f.conflicts.push({ kind: 'move', event: a.sgEvent, why: 'the heads of the event moved to different places' });
        else moves.set(a.sgEvent, { event: a.sgEvent, m: a.m, from: b.b, b: a.b });
      }
    });
    moves.forEach(mv => { if (!f.conflicts.some(c => c.kind === 'move' && c.event === mv.event)) f.moves.push({ event: mv.event, m: mv.m, from: mv.from, b: mv.b }); });
    /* a bar's arpeggio line is one spanner over the heads at one beat (all staves of the bar's notes the page marks) */
    const arpHeads = [];
    arps.forEach(set => set.forEach(h => arpHeads.push(h)));
    if (arpHeads.length) {
      const byBeat = new Map();
      arpHeads.forEach(h => { const n = now.get(h); const k = n.m + '|' + (n.staff || 1) + '|' + Math.round(n.b * 1e6); if (!byBeat.has(k)) byBeat.set(k, []); byBeat.get(k).push(h); });
      byBeat.forEach(hs => f.arps.push({ heads: hs.slice().sort() }));
    }

    /* chord names, navigation marks and 8va brackets: lists the page replaced */
    const keep = (a, b, key) => { const kb = new Set((b || []).map(key)); return (a || []).filter(x => !kb.has(key(x))); };
    keep(before.chords, after.chords, chordKey).forEach(c => f.chordsOut.push({ m: c.m, b: c.b, text: c.text }));
    keep(after.chords, before.chords, chordKey).forEach(c => f.chordsIn.push({ m: c.m, b: c.b, text: c.text }));
    keep(before.marks, after.marks, markKey).forEach(k => f.marksOut.push({ m: k.m, kind: k.kind, text: k.text === undefined ? null : k.text }));
    keep(after.marks, before.marks, markKey).forEach(k => f.marksIn.push({ m: k.m, kind: k.kind, text: k.text === undefined ? null : k.text }));
    keep(after.ottavas, before.ottavas, ottavaKey).forEach(o => f.ottavas.push({ staff: o.staff, m: o.m, b: o.b, endM: o.endM, endB: o.endB, dir: o.dir, size: o.size, semitones: o.semitones }));

    const h = {};
    if (after.title !== before.title && after.title) h.title = after.title;
    if (after.composer !== before.composer && after.composer) h.composer = after.composer;
    if (after.tempo !== before.tempo && after.tempo >= 20 && after.tempo <= 300) h.tempo = Math.round(after.tempo);
    if (Object.keys(h).length) f.heading = h;
    return f;
  }

  function count(f) {
    const c = {};
    GROUPS.forEach(g => { c[g] = g === 'heading' ? (f && f.heading ? 1 : 0) : ((f && f[g]) || []).length; });
    c.total = GROUPS.reduce((s, g) => s + c[g], 0);
    c.conflicts = ((f && f.conflicts) || []).length;
    return c;
  }

  /* ---------------------------------------------------------------- the edits */
  /* how a Score numbers its staves and measures (legacy-score toScore): staves of all parts end to end, a measure by its number or its place */
  function staffRef(doc, n) {
    let base = 0;
    for (let pi = 0; pi < doc.parts.length; pi++) {
      const p = doc.parts[pi], k = Math.max(1, p.staves.length);
      if (n >= base + 1 && n <= base + k) return { part: p, pi: pi, staff: p.staves[n - base - 1] ? p.staves[n - base - 1].id : null };
      base += k;
    }
    return null;
  }
  function measureIdOf(ctx, number) {
    if (!ctx.byNumber) {
      ctx.byNumber = new Map();
      ctx.d.doc.timeline.measures.forEach((m, i) => {
        const n = parseInt(m.number, 10);
        const key = isFinite(n) ? n : i + 1;
        if (!ctx.byNumber.has(key)) ctx.byNumber.set(key, m);
      });
    }
    return ctx.byNumber.get(number) || null;
  }
  const provOf = d => d.provRefOf({ source: SOURCE, op: 'inferred' });
  const pitchName = p => (p && p.step ? p.step + (p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '') + p.oct : '?');

  const HANDLERS = {
    /* a note the page's lines say is not there: the whole event goes */
    drops(ctx, it) {
      const d = ctx.d, x = d.ev.get(it.event);
      if (!x) return 'already';
      const have = (x.e.heads || []).length;
      if (it.of !== undefined && it.of !== have) throw new Skip('the event changed since the finding was made');
      if (it.heads !== undefined && it.heads.length < have) throw new Skip('only some heads of a chord are phantoms: not removed');
      if ((it.heads || []).length && !(x.e.heads || []).every(h => it.heads.indexOf(h.id) >= 0)) throw new Skip('the heads are not the event\'s');
      const gone = { kind: 'event', event: it.event, bar: (d.doc.timeline.measures[d.mIdx.get(x.e.m)] || {}).number, at: x.e.at, pitches: (x.e.heads || []).map(h => pitchName(h.pitch)) };
      d.removeEvents([it.event]);
      if (ctx.trace) ctx.trace.push(gone);
      return 'applied';
    },
    /* a head's pitch (an accidental carried through the bar, an octave under a bracket) and the accidental printed with it */
    pitches(ctx, it) {
      const d = ctx.d, x = d.hd.get(it.head);
      if (!x) throw new Skip('no such note');
      need(validPitch(it.pitch), 'not a pitch');
      need(it.acc === undefined || it.acc === null || ACCIDENTALS.indexOf(it.acc) >= 0, 'not an accidental');
      const want = it.pitch.alter ? { step: it.pitch.step, alter: it.pitch.alter, oct: it.pitch.oct } : { step: it.pitch.step, oct: it.pitch.oct };
      const aspects = [];
      if (!sameJson(x.h.pitch, want)) { x.h.pitch = want; aspects.push('pitch'); }
      if (it.acc !== undefined) {
        const cur = x.h.acc && x.h.acc.type ? x.h.acc.type : null;
        if (cur !== it.acc) {
          if (it.acc === null) delete x.h.acc; else x.h.acc = Object.assign({}, x.h.acc || {}, { type: it.acc });
          aspects.push('spelling');
        }
      }
      if (!aspects.length) return 'already';
      d.touch();
      d.markProv(x.h, aspects, 'inferred');
      return 'applied';
    },
    /* a voice the engine started late, or the notes that followed a phantom: another place in the same bar */
    moves(ctx, it) {
      const d = ctx.d, x = d.ev.get(it.event);
      if (!x) throw new Skip('no such event');
      need(it.at === undefined ? fin(it.b) : typeof it.at === 'string', 'no place to move to');
      const at = it.at !== undefined ? R.parse(it.at) : L.ratQ(it.b);
      if (it.b !== undefined && !close(R.toNumber(at) * 4, it.b)) throw new Skip('the place is not an exact fraction of a whole note');
      const text = R.format(at);
      if (x.e.at === text) return 'already';
      const len = R.parse(d.doc.timeline.measures[d.mIdx.get(x.e.m)].dur);
      if (R.sign(at) < 0 || R.gt(R.add(at, R.parse(x.e.dur)), len)) throw new Skip('the place is outside the bar');
      x.e.at = text;
      d.doc.parts.forEach(p => p.directions.forEach(dir => { if (dir.event === x.e.id) dir.at = text; }));
      ctx.moved.add(x.e.id);
      d.touch();
      d.markProv(x.e, ['rhythm'], 'inferred');
      return 'applied';
    },
    /* an arpeggio line before a chord */
    arps(ctx, it) {
      const d = ctx.d;
      const heads = (it.heads || []).filter(h => d.hd.has(h));
      if (heads.length < 2) throw new Skip('an arpeggio needs two notes');
      const part = d.hd.get(heads[0]).part;
      if (heads.some(h => d.hd.get(h).part !== part)) throw new Skip('the notes are in different parts');
      if (part.spanners.some(s => s.type === 'arpeggio' && heads.every(h => s.heads.indexOf(h) >= 0))) return 'already';
      const id = d.addSpanner(part, { type: 'arpeggio', heads: heads.slice(), prov: provOf(d) });
      void id;
      return 'applied';
    },
    /* an 8va, 15ma, 8vb bracket: the notes under it were already given their sounding pitch (pitches) */
    ottavas(ctx, it) {
      const d = ctx.d;
      need(fin(it.staff) && fin(it.m) && fin(it.b) && fin(it.endM) && fin(it.endB) && (it.dir === 1 || it.dir === -1), 'a bracket needs a staff, two places and a direction');
      const st = staffRef(d.doc, it.staff);
      if (!st || !st.staff) throw new Skip('no such staff');
      const m1 = measureIdOf(ctx, it.m), m2 = measureIdOf(ctx, it.endM);
      if (!m1 || !m2) throw new Skip('no such bar');
      const octaves = OCTAVES_OF_SIZE[it.size] || Math.max(1, Math.round(Math.abs(+it.semitones || 12) / 12));
      const shift = (it.dir > 0 ? 1 : -1) * octaves;
      const from = { m: m1.id, at: R.format(L.ratQ(it.b)) };
      /* PdfLayer ends the bracket 0.001 quarter after its last note starts; the graph's end is where that note ends */
      const lastAt = L.ratQ(Math.max(0, (it.endB || 0) - 0.001));
      let to = null;
      d.doc.parts[st.pi].events.forEach(e => {
        if (e.m !== m2.id || e.staff !== st.staff || e.kind !== 'note' || e.grace) return;
        if (!R.eq(R.parse(e.at), lastAt)) return;
        const end = R.add(R.parse(e.at), R.parse(e.dur));
        if (!to || R.gt(end, to)) to = end;
      });
      const len = R.parse(m2.dur);
      if (!to) to = L.ratQ(it.endB || 0);
      if (R.gt(to, len)) to = len;
      const x = { type: 'ottava', staff: st.staff, shift: shift, from: from, to: { m: m2.id, at: R.format(to) } };
      if (st.part.spanners.some(s => s.type === 'ottava' && s.staff === x.staff && s.shift === x.shift && sameJson(s.from, x.from) && sameJson(s.to, x.to))) return 'already';
      d.addSpanner(st.part, Object.assign(x, { prov: provOf(d) }));
      return 'applied';
    },
    /* chord names the page did not print are taken out, those it printed put in (the first part carries them, as toScore reads them) */
    chordsOut(ctx, it) {
      need(fin(it.m) && fin(it.b) && typeof it.text === 'string', 'a chord name needs a bar, a place and a text');
      const d = ctx.d, m = measureIdOf(ctx, it.m);
      if (!m) return 'already';
      const part = d.doc.parts[0];
      const at = L.ratQ(it.b);
      const before = part.directions.length;
      part.directions = part.directions.filter(x => !(x.kind === 'chord' && x.m === m.id && R.eq(R.parse(x.at), at) && L.chordText(x) === it.text));
      if (part.directions.length === before) return 'already';
      if (ctx.trace) ctx.trace.push({ kind: 'chord', bar: it.m, b: it.b, text: it.text });
      d.touch();
      return 'applied';
    },
    chordsIn(ctx, it) {
      need(fin(it.m) && fin(it.b) && typeof it.text === 'string', 'a chord name needs a bar, a place and a text');
      const d = ctx.d, m = measureIdOf(ctx, it.m);
      if (!m) throw new Skip('no such bar');
      const part = d.doc.parts[0];
      const at = L.ratQ(it.b);
      const body = L.chordFromText(it.text);
      if (!body) throw new Skip('a chord name PPP cannot read: ' + it.text);
      if (R.gt(at, R.parse(m.dur))) throw new Skip('the place is outside the bar');
      if (part.directions.some(x => x.kind === 'chord' && x.m === m.id && R.eq(R.parse(x.at), at) && L.chordText(x) === it.text)) return 'already';
      part.directions.push(Object.assign({ id: d.newId('d'), kind: 'chord', m: m.id, at: R.format(at) }, body, { prov: provOf(d) }));
      d.touch();
      return 'applied';
    },
    marksOut(ctx, it) {
      need(fin(it.m) && typeof it.kind === 'string', 'a mark needs a bar and a kind');
      const d = ctx.d, m = measureIdOf(ctx, it.m), kind = JUMP_OF[it.kind];
      const tl = d.doc.timeline;
      if (!m || !kind || !tl.jumps) return 'already';
      const before = tl.jumps.length;
      tl.jumps = tl.jumps.filter(j => !(j.m === m.id && j.kind === kind && (j.text === undefined ? null : j.text) === (it.text === undefined ? null : it.text)));
      if (tl.jumps.length === before) return 'already';
      if (ctx.trace) ctx.trace.push({ kind: 'mark', bar: it.m, mark: it.kind, text: it.text === undefined ? null : it.text });
      d.touch();
      return 'applied';
    },
    marksIn(ctx, it) {
      need(fin(it.m) && typeof it.kind === 'string', 'a mark needs a bar and a kind');
      const d = ctx.d, m = measureIdOf(ctx, it.m), kind = JUMP_OF[it.kind];
      if (!m) throw new Skip('no such bar');
      if (!kind) throw new Skip('a mark PPP cannot keep: ' + it.kind);
      const tl = d.doc.timeline;
      tl.jumps = tl.jumps || [];
      if (tl.jumps.some(j => j.m === m.id && j.kind === kind && (j.text === undefined ? null : j.text) === (it.text === undefined ? null : it.text))) return 'already';
      const j = { id: d.newId('j'), kind: kind, m: m.id, at: '0' };
      if (it.text !== null && it.text !== undefined) j.text = String(it.text);
      tl.jumps.push(j);
      d.touch();
      return 'applied';
    },
    /* the title and composer the page printed, and the tempo it marked, where the engine had only the file name */
    heading(ctx, it) {
      const d = ctx.d, meta = d.doc.meta, tl = d.doc.timeline;
      let changed = false;
      need((it.title === undefined || typeof it.title === 'string') && (it.composer === undefined || typeof it.composer === 'string'), 'a title and a composer are text');
      const qpm = it.tempo >= 20 && it.tempo <= 300 ? R.format(R.make(Math.round(it.tempo), 1)) : null;   /* (what can throw is done before anything is written) */
      if (it.title && meta.title !== it.title) { meta.title = it.title; changed = true; }
      if (it.composer && meta.composer !== it.composer) { meta.composer = it.composer; changed = true; }
      if (qpm !== null) {
        const first = tl.measures[0];
        tl.tempos = tl.tempos || [];
        const t = tl.tempos.find(x => x.m === first.id && R.isZero(R.parse(x.at)));
        if (t) { if (t.qpm !== qpm) { t.qpm = qpm; changed = true; } }
        else { tl.tempos.push({ id: d.newId('tp'), m: first.id, at: '0', qpm: qpm }); changed = true; }
      }
      if (!changed) return 'already';
      d.touch();
      return 'applied';
    }
  };

  /* beams and tuplets over events only some of which moved: retired (their members no longer stand together) */
  function retireStraddling(d, moved) {
    if (!moved.size) return;
    d.doc.parts.forEach(part => {
      const gone = new Set();
      part.spanners = part.spanners.filter(s => {
        if ((s.type !== 'beam' && s.type !== 'tuplet') || !s.events.some(e => moved.has(e)) || s.events.every(e => moved.has(e))) return true;
        gone.add(s.id); d.retire(s.id);
        return false;
      });
      if (gone.size) part.spanners.forEach(s => { if (s.type === 'tuplet' && gone.has(s.parent)) delete s.parent; });
    });
  }

  function runAll(graph, entries, opts) {
    const trace = [];
    const r = OPS.edit(graph, d => {
      const ctx = { d: d, moved: new Set(), byNumber: null, trace: trace };
      /* an edit that cannot be made (a NaN, a null, a missing note, whatever the handler throws) is that edit's refusal, not the transaction's: the others go on */
      const status = entries.map(en => {
        try { return HANDLERS[en.group](ctx, en.item); } catch (err) { return { refused: reasonOf(err) }; }
      });
      retireStraddling(d, ctx.moved);
      return status;
    }, Object.assign({ source: SOURCE }, opts || {}));
    return { r: r, trace: trace };
  }

  /* why an edit was not made: the module's own reason, the validator's, or whatever else it threw (a finding with a NaN, a null, a missing field is one refused edit, never the page's whole lot) */
  const reasonOf = e => (e instanceof Skip ? e.why : String((e && e.message) || e).slice(0, 240));
  /* the ids a finding names: what the validator's issues are matched against */
  function namedIds(en) {
    const it = en && en.item && typeof en.item === 'object' ? en.item : {};
    const ids = [];
    ['event', 'head'].forEach(k => { if (typeof it[k] === 'string') ids.push(it[k]); });
    if (Array.isArray(it.heads)) it.heads.forEach(h => { if (typeof h === 'string') ids.push(h); });
    return ids;
  }
  const merged = (a, b) => ({ graph: b.graph, applied: a.applied.concat(b.applied), already: a.already.concat(b.already), skipped: a.skipped.concat(b.skipped), trace: a.trace.concat(b.trace) });
  const refused = (graph, entries, why) => ({ graph: graph, applied: [], already: [], trace: [], skipped: entries.map(en => ({ group: en.group, item: en.item, why: why })) });

  /* The budget of the work a refusal may cost. Every try is a validation of the whole graph. The first try (all the entries in one transaction) is free; once something has been
     refused the clock and the count start, and when either is spent what is still unresolved is refused, named `budget` - never applied unchecked. */
  function makeBudget(opts) {
    const o = opts || {};
    return { n: 0, max: o.maxValidations === undefined ? 64 : o.maxValidations, ms: o.maxMs === undefined ? 400 : o.maxMs, t0: null, hit: false,
      start() { if (this.t0 === null) this.t0 = Date.now(); },
      spent() { const s = this.n >= this.max || (this.t0 !== null && Date.now() - this.t0 > this.ms); if (s) this.hit = true; return s; } };
  }

  /* All of the entries in one transaction. When the graph would be invalid (or an edit cannot be made) the entries the validator's issues name are taken out and tried again
     without them, then each of them alone on the result (so a valid edit that stood next to an invalid one is still made); when the issues name none of the entries the
     list is halved. A bad edit costs about as many validations as there are suspects, not the length of the list. */
  function attempt(graph, entries, opts, budget) {
    if (!entries.length) return { graph: graph, applied: [], already: [], skipped: [], trace: [] };
    if (budget.t0 !== null && budget.spent()) return refused(graph, entries, 'budget: too many refused edits to try every one of the remaining ones');
    budget.n++;
    try {
      const x = runAll(graph, entries, opts);
      const applied = [], already = [], skipped = [];
      entries.forEach((en, i) => {
        const s = x.r.result[i];
        if (s && typeof s === 'object') skipped.push({ group: en.group, item: en.item, why: s.refused });
        else (s === 'applied' ? applied : already).push(en);
      });
      return { graph: x.r.graph, applied: applied, already: already, skipped: skipped, trace: x.trace };
    } catch (e) {
      budget.start();
      if (entries.length === 1) return refused(graph, entries, reasonOf(e));
      const named = new Set();
      ((e && e.issues) || []).forEach(i => ((i && i.ids) || []).forEach(id => named.add(id)));
      const suspects = entries.filter(en => namedIds(en).some(id => named.has(id)));
      if (suspects.length && suspects.length < entries.length) {
        let acc = attempt(graph, entries.filter(en => suspects.indexOf(en) < 0), opts, budget);
        suspects.forEach(en => { acc = merged(acc, attempt(acc.graph, [en], opts, budget)); });
        return acc;
      }
      const mid = entries.length >> 1;
      const a = attempt(graph, entries.slice(0, mid), opts, budget);
      return merged(a, attempt(a.graph, entries.slice(mid), opts, budget));
    }
  }

  function apply(graph, findings, opts) {
    const f = findings || emptyFindings();
    const entries = [];
    GROUPS.forEach(g => {
      if (g === 'heading') { if (f.heading) entries.push({ group: g, item: f.heading }); return; }
      if (Array.isArray(f[g])) f[g].forEach(item => entries.push({ group: g, item: item }));
    });
    const budget = makeBudget(opts);
    const t0 = Date.now();
    const r = attempt(graph, entries, opts, budget);
    const applied = {};
    GROUPS.forEach(g => { applied[g] = 0; });
    r.applied.forEach(en => { applied[en.group]++; });
    /* what the edits took away, since a removed note, chord name or mark leaves no entity to carry a provenance */
    const removed = { events: 0, heads: 0, chords: 0, marks: 0, list: r.trace.slice(0, 100) };
    r.trace.forEach(t => {
      if (t.kind === 'event') { removed.events++; removed.heads += t.pitches.length; }
      else if (t.kind === 'chord') removed.chords++;
      else if (t.kind === 'mark') removed.marks++;
    });
    return { ok: true, graph: r.graph, changed: r.graph !== graph, applied: applied, appliedTotal: r.applied.length, already: r.already.length,
      skipped: r.skipped, removed: removed, conflicts: (f.conflicts || []).slice(), src: SOURCE, from: graph.rev, to: r.graph.rev,
      work: { validations: budget.n, ms: Date.now() - t0, budgetSpent: budget.hit } };
  }

  /* one kind of edit on its own */
  const ops = {};
  [['setPitch', 'pitches'], ['dropEvent', 'drops'], ['moveEvent', 'moves'], ['markArpeggio', 'arps'], ['addOttava', 'ottavas'], ['removeChord', 'chordsOut'],
    ['addChord', 'chordsIn'], ['removeMark', 'marksOut'], ['addMark', 'marksIn'], ['setHeading', 'heading']].forEach(([name, group]) => {
    ops[name] = function (graph, item, opts) {
      let status = null;
      try {
        const r = OPS.edit(graph, d => {
          const ctx = { d: d, moved: new Set(), byNumber: null };
          status = HANDLERS[group](ctx, item);
          retireStraddling(d, ctx.moved);
        }, Object.assign({ source: SOURCE }, opts || {}));
        return { graph: r.graph, changed: r.changed, status: status };
      } catch (e) {
        if (!(e instanceof Skip)) throw e;
        const x = new Error('E-OMR-SKIP: ' + e.why);
        x.code = 'E-OMR-SKIP'; x.why = e.why;
        throw x;
      }
    };
  });

  /* the graph says it came from an OMR page: the hand rule of scoregraph/legacy-score.js reads this */
  function markOmr(graph, info) {
    const want = Object.assign({ hands: 'by-staff' }, info || {});
    const r = OPS.edit(graph, d => {
      const cur = d.doc.ext && d.doc.ext['ppp.omr'];
      if (cur && sameJson(cur, want)) return;
      d.doc.ext = Object.assign({}, d.doc.ext || {}, { 'ppp.omr': want });
      d.touch();
    }, { source: SOURCE, validate: false });   /* a namespace in ext cannot make a valid graph invalid: the (second) validation of a whole page is skipped */
    return { graph: r.graph, changed: r.changed };
  }

  return Object.freeze({ VERSION: VERSION, SOURCE: SOURCE, GROUPS: GROUPS, diff: diff, count: count, apply: apply, ops: Object.freeze(ops), markOmr: markOmr, emptyFindings: emptyFindings });
});
