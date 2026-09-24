/* ============================================================================
   PPP ScoreGraph — edit operations (docs/GOALS/G01 §12.3, §12.4)

   Every op takes a (frozen) graph and returns {graph, idMap, issues}:
     graph   a new validated, frozen graph with rev + 1
     idMap   {retiredId: replacementId | null}
     issues  the new graph's validation issues (warnings, infos)
   The input graph is never changed. An op whose result has an ERROR, or a
   request the op cannot honour, throws OpError {code, issues}.

   G1 implements updateHead, removeEvents and replaceRegion (A31). G3 adds the
   notation ops of G03 §5.5 (splitEvent, mergeTied, retimeVoiceMeasure,
   setVoice, setStaff, moveHeads, setTuplets, setBeams, setAcc, setSpelling,
   and a few timeline ones), all on one transaction:

     edit(g, fn, opts)   fn(draft) makes any number of changes on a private
                         copy; the result is sealed once. No change at all
                         returns the input graph itself ({graph: g}), so a pass
                         that finds nothing to do is a fixed point by
                         construction (G03 §16.1 R2). opts.validate === false
                         skips the validator (G3 validates once at its end).

   Each single op (ops.splitEvent(g, …) etc.) is edit() with one call.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./time.js'), require('./build.js'),
      require('./pitch.js'), require('./serialize.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.ops = factory(M.rational, M.schema, M.time, M.build, M.pitch, M.serialize); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, T, B, P, Z) {
  'use strict';

  const CODES = Object.freeze(['E-REGION-BOUNDARY', 'E-OP-TARGET', 'E-OP-RESULT']);
  const LOCAL_ID = /^x[0-9]+$/;
  const HEAD_FIELDS = ['pitch', 'staff', 'acc', 'notehead', 'fingering', 'limb', 'lead', 'tech', 'inst', 'pos', 'stroke', 'prov', 'ext'];

  class OpError extends Error {
    constructor(code, message, issues) {
      super(code + ': ' + message);
      this.name = 'OpError';
      this.code = code;
      this.issues = issues || [];
    }
  }
  /* a deep copy of plain JSON data, as JSON.parse(JSON.stringify(g)) makes it (an undefined field is left out, an
     undefined array element becomes null), without the text in between */
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const n = v.length, a = new Array(n);
      for (let i = 0; i < n; i++) { const x = v[i]; a[i] = x === undefined || typeof x === 'function' ? null : clone(x); }
      return a;
    }
    const o = {};
    for (const k of Object.keys(v)) { const x = v[k]; if (x !== undefined && typeof x !== 'function') o[k] = clone(x); }
    return o;
  }
  function finish(doc, idMap) {
    doc.rev = (doc.rev || 0) + 1;
    try {
      const res = B.seal(doc);
      return { graph: res.graph, idMap: idMap, issues: res.issues };
    } catch (e) {
      if (e.code === 'E-BUILD') throw new OpError('E-OP-RESULT', 'the edited graph is invalid: ' + e.message, e.issues);
      throw e;
    }
  }
  function findHead(doc, id) {
    for (const part of doc.parts) for (const ev of part.events) {
      const h = (ev.heads || []).find(x => x.id === id);
      if (h) return { part: part, event: ev, head: h };
    }
    return null;
  }

  /* Change a head's pitch, spelling, printed accidental, fingering, limb …: the head and its event keep
     their IDs. A value of null removes the field. */
  function updateHead(g, headId, changes) {
    const doc = clone(g);
    const at = findHead(doc, headId);
    if (!at) throw new OpError('E-OP-TARGET', 'no head ' + headId);
    Object.keys(changes || {}).forEach(k => {
      if (HEAD_FIELDS.indexOf(k) < 0) throw new OpError('E-OP-TARGET', 'updateHead cannot change ' + k);
      if (changes[k] === null) delete at.head[k]; else at.head[k] = JSON.parse(JSON.stringify(changes[k]));
    });
    return finish(doc, {});
  }

  /* Remove events from a doc in place (§12.3 "event 삭제"): their heads go too; a tie that loses one end
     keeps the other (an open tie) or goes when it loses both; slurs likewise; tuplets, beams and arpeggios
     lose the members and go when too few remain. Records every retired ID in idMap as null. */
  function dropEvents(doc, ids, idMap, extraHeads) {
    const goneEvents = new Set(ids), goneHeads = new Set(extraHeads || []);
    doc.parts.forEach(part => {
      part.events.forEach(ev => { if (goneEvents.has(ev.id)) (ev.heads || []).forEach(h => goneHeads.add(h.id)); });
      part.events = part.events.filter(ev => !goneEvents.has(ev.id));
    });
    goneEvents.forEach(id => { idMap[id] = null; });
    goneHeads.forEach(id => { idMap[id] = null; });
    const goneSpanners = new Set();
    doc.parts.forEach(part => {
      part.spanners = part.spanners.filter(s => {
        let keep = true;
        if (s.type === 'tie') {
          if (goneHeads.has(s.from)) delete s.from;
          if (goneHeads.has(s.to)) delete s.to;
          keep = s.from !== undefined || s.to !== undefined;
        } else if (s.type === 'slur') {
          if (goneEvents.has(s.from)) delete s.from;
          if (goneEvents.has(s.to)) delete s.to;
          keep = s.from !== undefined || s.to !== undefined;
        } else if (s.type === 'tuplet' || s.type === 'beam') {
          s.events = s.events.filter(e => !goneEvents.has(e));
          if (s.breaks) { s.breaks = s.breaks.filter(b => !goneEvents.has(b.after) && s.events.indexOf(b.after) >= 0); if (!s.breaks.length) delete s.breaks; }
          keep = s.events.length >= (s.type === 'beam' ? 2 : 1);
        } else if (s.type === 'arpeggio') {
          s.heads = s.heads.filter(h => !goneHeads.has(h));
          keep = s.heads.length >= 2;
        }
        if (!keep) { goneSpanners.add(s.id); idMap[s.id] = null; }
        return keep;
      });
      part.spanners.forEach(s => { if (s.type === 'tuplet' && goneSpanners.has(s.parent)) delete s.parent; });
      part.directions.forEach(d => { if (goneEvents.has(d.event)) delete d.event; });
    });
    (doc.performances || []).forEach(pf => pf.notes.forEach(pn => { if (goneHeads.has(pn.link)) delete pn.link; }));
    const prov = doc.provenance;
    if (prov.flags) prov.flags.forEach(fl => {
      if (fl.ids) { fl.ids = fl.ids.filter(id => !(id in idMap)); if (!fl.ids.length) delete fl.ids; }
    });
    return { events: goneEvents, heads: goneHeads };
  }

  function removeEvents(g, eventIds) {
    const doc = clone(g);
    const all = new Set();
    doc.parts.forEach(p => p.events.forEach(e => all.add(e.id)));
    eventIds.forEach(id => { if (!all.has(id)) throw new OpError('E-OP-TARGET', 'no event ' + id); });
    const idMap = {};
    dropEvents(doc, eventIds, idMap);
    return finish(doc, idMap);
  }

  /* Replace what the selected voices write in [from, to) with a fragment (§12.4). The fragment's events,
     spanners and directions use local IDs (x1, x2, …) or the ID of an event of the region they keep. */
  function replaceRegion(g, region, fragment) {
    const doc = clone(g);
    const part = doc.parts.find(p => p.id === region.part);
    if (!part) throw new OpError('E-OP-TARGET', 'no part ' + region.part);
    let a, b;
    try { a = T.scorePos(g, region.from); b = T.scorePos(g, region.to); } catch (e) { throw new OpError('E-OP-TARGET', e.message); }
    if (!R.lt(a, b)) throw new OpError('E-OP-TARGET', 'the region is empty');
    const voices = region.voices ? new Set(region.voices) : null;
    const selected = part.events.filter(e => !voices || voices.has(e.voice));
    /* 1. the region's boundaries may not cut an event of the selected voices */
    selected.forEach(e => {
      const s = T.scorePos(g, e), en = R.add(s, R.parse(e.dur));
      if ((R.lt(s, a) && R.gt(en, a)) || (R.lt(s, b) && R.gt(en, b)))
        throw new OpError('E-REGION-BOUNDARY', 'event ' + e.id + ' crosses the region boundary');
    });
    const inside = selected.filter(e => { const s = T.scorePos(g, e); return R.ge(s, a) && R.lt(s, b); });
    const insideIds = new Set(inside.map(e => e.id));
    const frag = JSON.parse(JSON.stringify(fragment || {}));
    const kept = new Set();
    (frag.events || []).forEach(e => {
      if (LOCAL_ID.test(e.id)) return;
      if (!insideIds.has(e.id)) throw new OpError('E-OP-TARGET', 'the fragment keeps ' + e.id + ', which is not an event of the region');
      kept.add(e.id);
    });
    /* 2. delete the region's events (except the ones the fragment keeps); a kept event's heads the fragment
       no longer lists go the same way as a deleted event's heads */
    const idMap = {};
    const fragHeads = new Set();
    (frag.events || []).forEach(e => (e.heads || []).forEach(h => fragHeads.add(h.id)));
    const droppedHeads = [];
    inside.forEach(e => { if (kept.has(e.id)) (e.heads || []).forEach(h => { if (!fragHeads.has(h.id)) droppedHeads.push(h.id); }); });
    part.events = part.events.filter(e => !kept.has(e.id));
    dropEvents(doc, inside.filter(e => !kept.has(e.id)).map(e => e.id), idMap, droppedHeads);
    /* 3. new IDs for the fragment's local names, in fragment order */
    let next = doc.nextId;
    const local = {};
    const newId = (prefix, id) => {
      if (id !== undefined && !LOCAL_ID.test(id)) return id;
      const n = prefix + (next++);
      if (id !== undefined) local[id] = n;
      return n;
    };
    const map = id => (id !== undefined && LOCAL_ID.test(id) ? local[id] : id);
    (frag.events || []).forEach(e => {
      e.id = newId('e', e.id);
      (e.heads || []).forEach(h => { h.id = newId('h', h.id); });
    });
    (frag.spanners || []).forEach(s => { s.id = newId('s', s.id); });
    (frag.directions || []).forEach(d => { d.id = newId('d', d.id); });
    const unknownLocal = [];
    const mapRef = id => { const m = map(id); if (id !== undefined && LOCAL_ID.test(id) && m === undefined) unknownLocal.push(id); return m; };
    (frag.spanners || []).forEach(s => {
      if (s.from !== undefined && typeof s.from === 'string') s.from = mapRef(s.from);
      if (s.to !== undefined && typeof s.to === 'string') s.to = mapRef(s.to);
      if (s.events) s.events = s.events.map(mapRef);
      if (s.heads) s.heads = s.heads.map(mapRef);
      if (s.parent !== undefined) s.parent = mapRef(s.parent);
      if (s.breaks) s.breaks.forEach(br => { br.after = mapRef(br.after); });
    });
    (frag.directions || []).forEach(d => { if (d.event !== undefined) d.event = mapRef(d.event); });
    if (unknownLocal.length) throw new OpError('E-OP-TARGET', 'the fragment refers to ' + unknownLocal[0] + ', which it does not define');
    /* 4. boundary ties and slurs: a fragment spanner that re-joins an opened end replaces the open one */
    (frag.spanners || []).forEach(s => {
      if (s.type !== 'tie' && s.type !== 'slur') return;
      part.spanners = part.spanners.filter(o => {
        if (o.type !== s.type) return true;
        const sameStart = s.from !== undefined && o.from === s.from && o.to === undefined;
        const sameEnd = s.to !== undefined && o.to === s.to && o.from === undefined;
        if (sameStart || sameEnd) { idMap[o.id] = s.id; return false; }
        return true;
      });
    });
    part.events = part.events.concat(frag.events || []);
    part.spanners = part.spanners.concat(frag.spanners || []);
    part.directions = part.directions.concat(frag.directions || []);
    doc.nextId = next;
    /* 5-6. validate; an ERROR rejects the whole edit */
    return finish(doc, idMap);
  }

  /* ========================================================= G3: edit() and the notation ops (G03 §5.5) */

  /* Where an articulation goes when an event is split (G03 §12.2): an onset mark stays on the first piece, a
     mark about the note's length or its end goes to the last. */
  const END_ARTS = ['tenuto', 'breath-mark', 'caesura'];
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  /* the JSON of a frozen object, made once */
  const JSONS = new WeakMap();
  const jsonOf = o => { let j = JSONS.get(o); if (j === undefined) { j = JSON.stringify(o); JSONS.set(o, j); } return j; };
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* A private, mutable copy of a graph and the changes made to it. Every method keeps the graph's ID rules
     (G01 §12.3): a piece that goes on keeps its ID, a new one takes the next number, a retired ID is in idMap. */
  class Draft {
    constructor(g, opts) {
      this.g0 = g;
      this.doc = clone(g);
      /* each copied event -> the frozen (canonical) event it is a copy of: one the edit leaves as it was is handed back
         as that event (edit), so an edit costs what it changes, not the whole graph. Only an event that is itself frozen
         is handed back: a graph frozen at its root alone could share a mutable event (G03 §28 o5) */
      this.origEvent = new Map();
      if (Object.isFrozen(g) && Array.isArray(g.parts)) g.parts.forEach((p, pi) => (p.events || []).forEach((e, ei) => { if (Object.isFrozen(e)) this.origEvent.set(this.doc.parts[pi].events[ei], e); }));
      this.opts = opts || {};
      this.idMap = {};
      this.changed = false;
      this.srcId = null;
      const tl = this.doc.timeline;
      this.mIdx = new Map(tl.measures.map((m, i) => [m.id, i]));
      this.mStart = new Map();
      let acc = R.ZERO;
      tl.measures.forEach(m => { this.mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
      this.reindex();
    }
    reindex() {
      this.vmIndex = null; this.tieIndex = null;
      this.ev = new Map(); this.hd = new Map(); this.vc = new Map();
      this.doc.parts.forEach(part => {
        part.voices.forEach(v => this.vc.set(v.id, { v: v, part: part }));
        part.events.forEach(e => {
          this.ev.set(e.id, { e: e, part: part });
          (e.heads || []).forEach(h => this.hd.set(h.id, { h: h, e: e, part: part }));
        });
      });
    }
    touch() { this.changed = true; }
    /* the frozen event of the input a copied event still equals, or null */
    unchanged(v) {
      const o = this.origEvent.get(v);
      return o && JSON.stringify(v) === jsonOf(o) ? o : null;
    }
    /* incremental index upkeep for the ops that add, move or drop one event (a full reindex per op would make a pass
       that moves many notes quadratic) */
    vmKey(e) { return e.voice + '|' + e.m; }
    vmAdd(e) {
      if (!this.vmIndex || isObj(e.grace)) return;
      const k = this.vmKey(e);
      if (!this.vmIndex.has(k)) this.vmIndex.set(k, []);
      this.vmIndex.get(k).push(e);
    }
    vmRemove(e, key) {
      if (!this.vmIndex || isObj(e.grace)) return;
      const list = this.vmIndex.get(key || this.vmKey(e));
      if (!list) return;
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }
    indexEvent(e, part) {
      this.ev.set(e.id, { e: e, part: part });
      (e.heads || []).forEach(h => this.hd.set(h.id, { h: h, e: e, part: part }));
      this.vmAdd(e);
    }
    newId(prefix) { const id = prefix + this.doc.nextId; this.doc.nextId += 1; return id; }
    event(id) { const x = this.ev.get(id); if (!x) throw new OpError('E-OP-TARGET', 'no event ' + id); return x.e; }
    head(id) { const x = this.hd.get(id); if (!x) throw new OpError('E-OP-TARGET', 'no head ' + id); return x.h; }
    partOfEvent(id) { const x = this.ev.get(id); if (!x) throw new OpError('E-OP-TARGET', 'no event ' + id); return x.part; }
    voice(id) { const x = this.vc.get(id); if (!x) throw new OpError('E-OP-TARGET', 'no voice ' + id); return x.v; }
    partOfVoice(id) { const x = this.vc.get(id); if (!x) throw new OpError('E-OP-TARGET', 'no voice ' + id); return x.part; }
    /* ScorePos of an event's start and end */
    startW(e) { return R.add(this.mStart.get(e.m), R.parse(e.at)); }
    endW(e) { return R.add(this.startW(e), R.parse(e.dur)); }
    /* the non-grace events of a voice in a measure, in time order */
    voiceMeasure(voiceId, m) {
      this.partOfVoice(voiceId);
      if (!this.vmIndex) {
        /* built once, and again only after the events changed (reindex) */
        this.vmIndex = new Map();
        this.doc.parts.forEach(part => part.events.forEach(e => {
          if (isObj(e.grace)) return;
          const k = e.voice + '|' + e.m;
          if (!this.vmIndex.has(k)) this.vmIndex.set(k, []);
          this.vmIndex.get(k).push(e);
        }));
      }
      return (this.vmIndex.get(voiceId + '|' + m) || []).slice()
        .sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)) || S.idNumber(a.id) - S.idNumber(b.id));
    }
    /* the complete ties: from head -> to head (built once, again only after a change) */
    ties() {
      if (!this.tieIndex) {
        this.tieIndex = new Map();
        this.doc.parts.forEach(part => part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) this.tieIndex.set(sp.from, sp.to); }));
      }
      return this.tieIndex;
    }
    /* The G3 source, registered the first time a pass records provenance (G03 §17). */
    source() {
      if (this.srcId) return this.srcId;
      const want = this.opts.source || { kind: 'generator', tool: 'ppp.g3' };
      const found = this.doc.provenance.sources.find(s => s.kind === want.kind && s.tool === want.tool && s.version === want.version);
      if (found) { this.srcId = found.id; return found.id; }
      const src = Object.assign({ id: this.newId('sr') }, want);
      this.doc.provenance.sources.push(src);
      this.srcId = src.id;
      return src.id;
    }
    /* entity.prov.asp[aspect] = {src: G3} for each aspect (G03 §17). The op is written only when it is not the
       one the entity inherits: a rewritten inferred entity stays inferred (only the source is G3); what G3 fills
       into an imported score is 'generated'. */
    markProv(entity, aspects, op) {
      const src = this.source();
      entity.prov = entity.prov || {};
      entity.prov.asp = entity.prov.asp || {};
      aspects.forEach(a => { entity.prov.asp[a] = op ? { src: src, op: op } : { src: src }; });
    }
    retire(id, to) { this.idMap[id] = to === undefined ? null : to; }

    /* --------------------------------------------------------------- the ops */

    /* Split an event at an offset inside it (a W offset in its measure). The first piece keeps the event's and its
       heads' IDs; the second piece, its heads and the ties between the pieces are new (G01 §12.3). */
    splitEvent(eventId, at, display1, display2) {
      const e = this.event(eventId), part = this.partOfEvent(eventId);
      if (isObj(e.grace)) throw new OpError('E-OP-TARGET', 'a grace event has no length to split');
      const a = R.parse(at), s = R.parse(e.at), en = R.add(s, R.parse(e.dur));
      if (!(R.lt(s, a) && R.lt(a, en))) throw new OpError('E-OP-TARGET', 'split point ' + at + ' is not inside ' + e.id);
      const back = { id: this.newId('e'), kind: e.kind, m: e.m, at: R.format(a), dur: R.format(R.sub(en, a)), voice: e.voice, staff: e.staff };
      ['hidden', 'cue', 'prov'].forEach(k => { if (e[k] !== undefined) back[k] = JSON.parse(JSON.stringify(e[k])); });
      if (display2) back.display = display2;
      e.dur = R.format(R.sub(a, s));
      if (display1) e.display = display1; else if (display1 === null) delete e.display;
      if (e.kind === 'rest' && e.display && e.display.measureRest) delete e.display.measureRest;
      const outTies = new Map();
      part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined) outTies.set(sp.from, sp); });
      if (e.heads) {
        back.heads = e.heads.map(h => {
          const nh = { id: this.newId('h') };
          ['pitch', 'inst', 'staff', 'pos', 'notehead', 'limb', 'stroke', 'prov'].forEach(k => { if (h[k] !== undefined) nh[k] = JSON.parse(JSON.stringify(h[k])); });
          const out = outTies.get(h.id);
          if (out) out.from = nh.id;
          part.spanners.push({ id: this.newId('s'), type: 'tie', from: h.id, to: nh.id });
          return nh;
        });
      }
      if (e.arts) {
        const endArts = e.arts.filter(x => END_ARTS.indexOf(x) >= 0);
        e.arts = e.arts.filter(x => END_ARTS.indexOf(x) < 0);
        if (!e.arts.length) delete e.arts;
        if (endArts.length) back.arts = endArts;
      }
      if (e.fermata) { back.fermata = e.fermata; delete e.fermata; }
      part.spanners.forEach(sp => {
        if (sp.type === 'slur' && sp.to === e.id) sp.to = back.id;
        if ((sp.type === 'tuplet' || sp.type === 'beam') && sp.events.indexOf(e.id) >= 0) sp.events.splice(sp.events.indexOf(e.id) + 1, 0, back.id);
      });
      part.events.push(back);
      this.reindex();
      this.touch();
      return back.id;
    }

    /* Merge a note with the one it is fully tied to (every head of each tied to one of the other, same pitches),
       inside one measure and one voice. The first keeps its IDs; idMap sends the second and its heads to them. */
    mergeTied(firstId, secondId, display) {
      const a = this.event(firstId), b = this.event(secondId), part = this.partOfEvent(firstId);
      if (a.kind !== 'note' || b.kind !== 'note' || a.voice !== b.voice || a.m !== b.m) throw new OpError('E-OP-TARGET', 'mergeTied needs two notes of one voice and measure');
      if (!R.eq(R.add(R.parse(a.at), R.parse(a.dur)), R.parse(b.at))) throw new OpError('E-OP-TARGET', secondId + ' does not start where ' + firstId + ' ends');
      const tieOf = new Map();
      part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) tieOf.set(sp.from, sp); });
      if (a.heads.length !== b.heads.length) throw new OpError('E-OP-TARGET', 'the two chords differ');
      const pairs = a.heads.map(h => { const t = tieOf.get(h.id); const to = t && b.heads.find(x => x.id === t.to); return to ? { h: h, to: to, tie: t } : null; });
      if (pairs.some(x => !x)) throw new OpError('E-OP-TARGET', firstId + ' is not fully tied to ' + secondId);
      this.assertUnlinked(b.heads.map(h => h.id));
      a.dur = R.format(R.add(R.parse(a.dur), R.parse(b.dur)));
      if (display) a.display = display;
      const headTo = new Map(pairs.map(x => [x.to.id, x.h.id]));
      const tieGone = new Set(pairs.map(x => x.tie.id));
      part.spanners = part.spanners.filter(sp => {
        if (tieGone.has(sp.id)) { this.retire(sp.id); return false; }
        return true;
      });
      part.spanners.forEach(sp => {
        if (sp.type === 'tie' && headTo.has(sp.from)) sp.from = headTo.get(sp.from);
        if (sp.type === 'slur') { if (sp.to === b.id) sp.to = a.id; if (sp.from === b.id) sp.from = a.id; }
        if ((sp.type === 'tuplet' || sp.type === 'beam') && sp.events.indexOf(b.id) >= 0) sp.events = sp.events.filter(x => x !== b.id);
      });
      if (b.arts) a.arts = Array.from(new Set((a.arts || []).concat(b.arts)));
      if (b.fermata) a.fermata = b.fermata;
      part.directions.forEach(d => { if (d.event === b.id) d.event = a.id; });
      part.events = part.events.filter(e => e.id !== b.id);
      this.retire(b.id, a.id);
      b.heads.forEach(h => this.retire(h.id, headTo.get(h.id)));
      this.dropEmptySpanners(part);
      this.reindex();
      this.touch();
    }

    /* Rewrite what one voice writes in one measure (a narrow replaceRegion, G03 §5.5). plan: the new non-grace
       events in time order, each {reuse?, kind, at, dur, display, heads?: [{reuse?, pitch, like?}], tieNext?,
       arts?, orn?, fermata?, lyrics?, hidden?, staff?}. A reused event or head keeps its ID and every field the plan
       does not set; a new one takes the next ID. Ties, slurs, directions, arpeggios and glissandi that reach into
       the region follow the notes: an end at a note's start goes to the piece that starts there, an end at a note's
       end to the piece that ends there. Tuplets and beams over an event the plan moves or retires are retired (the
       passes that own them group the new pieces). Grace events are left where they are. A head a performance links to
       may not be retired: the performance layer never changes (G03 I5). */
    retimeVoiceMeasure(voiceId, m, plan) { return this.retimeBatch([{ voice: voiceId, m: m, plan: plan }])[0]; }

    /* Many voice-measures at once, in one sweep over the events, spanners and directions of the parts they are in
       (one voice-measure at a time would sweep them each time). items: [{voice, m, plan}], voice-measures distinct.
       Returns, per item, the IDs of its events in plan order. */
    retimeBatch(items) {
      if (!items.length) return [];
      const oldInfo = new Map();                    /* old event ID -> {s, en, item, heads: [{id, midi}]} */
      const headItem = new Map();                   /* old head ID -> {item, midi, info} */
      const done = [];
      items.forEach(item => {
        const part = this.partOfVoice(item.voice);
        const staffOfVoice = this.voice(item.voice).staff;
        const old = this.voiceMeasure(item.voice, item.m);
        item.part = part;
        item.oldIds = new Set(old.map(e => e.id));
        old.forEach(e => {
          const info = { s: R.parse(e.at), en: R.add(R.parse(e.at), R.parse(e.dur)), item: item, heads: (e.heads || []).map(h => ({ id: h.id, midi: h.pitch ? P.midi(h.pitch) : h.inst })) };
          oldInfo.set(e.id, info);
          info.heads.forEach(h => headItem.set(h.id, { item: item, midi: h.midi, info: info }));
        });
        const seen = new Set();
        item.pieces = item.plan.map(p => {
          let e;
          if (p.reuse !== undefined) {
            if (!item.oldIds.has(p.reuse) || seen.has(p.reuse)) throw new OpError('E-OP-TARGET', 'the plan reuses ' + p.reuse + ', not an event of the region (or twice)');
            seen.add(p.reuse);
            e = this.event(p.reuse);
            if (e.kind !== p.kind) throw new OpError('E-OP-TARGET', 'the plan turns ' + e.kind + ' ' + e.id + ' into a ' + p.kind);
          } else {
            e = { id: this.newId('e'), kind: p.kind, m: item.m, voice: item.voice, staff: p.staff || staffOfVoice };
          }
          e.at = p.at; e.dur = p.dur;
          if (p.display) e.display = JSON.parse(JSON.stringify(p.display)); else delete e.display;
          ['arts', 'orn', 'fermata', 'lyrics'].forEach(k => { if (p[k] !== undefined && p[k] !== null && !(Array.isArray(p[k]) && !p[k].length)) e[k] = JSON.parse(JSON.stringify(p[k])); else delete e[k]; });
          if (p.hidden) e.hidden = true; else if (p.hidden === false) delete e.hidden;
          if (p.kind === 'note' || p.kind === 'perc') {
            e.heads = p.heads.map(hp => {
              if (hp.reuse !== undefined) {
                const h = this.hd.get(hp.reuse);
                if (!h) throw new OpError('E-OP-TARGET', 'no head ' + hp.reuse);
                if (hp.pitch && h.h.pitch && P.midi(hp.pitch) !== P.midi(h.h.pitch)) throw new OpError('E-OP-TARGET', 'the plan changes the pitch of ' + hp.reuse);
                return h.h;
              }
              const nh = { id: this.newId('h') };
              if (hp.pitch) nh.pitch = JSON.parse(JSON.stringify(hp.pitch));
              const like = hp.like !== undefined ? this.hd.get(hp.like) : null;
              if (like) ['staff', 'notehead', 'limb', 'prov', 'inst', 'pos', 'stroke'].forEach(k => { if (like.h[k] !== undefined && nh[k] === undefined) nh[k] = JSON.parse(JSON.stringify(like.h[k])); });
              return nh;
            });
          } else delete e.heads;
          return { p: p, e: e, s: R.parse(p.at), en: R.add(R.parse(p.at), R.parse(p.dur)) };
        });
        item.seen = seen;
        const keptHeads = new Set();
        item.pieces.forEach(x => (x.e.heads || []).forEach(h => keptHeads.add(h.id)));
        item.goneEvents = old.filter(e => !seen.has(e.id)).map(e => e.id);
        item.goneHeads = [];
        old.forEach(e => (e.heads || []).forEach(h => { if (!keptHeads.has(h.id)) item.goneHeads.push(h.id); }));
        this.assertUnlinked(item.goneHeads);
        /* the old events the plan retires or moves (another start or length) */
        item.moved = new Set(item.goneEvents);
        item.pieces.forEach(x => { const o = oldInfo.get(x.e.id); if (o && (!R.eq(o.s, x.s) || !R.eq(o.en, x.en))) item.moved.add(x.e.id); });
        done.push(item);
      });
      /* where an old event's start and end are now, and an old head's */
      const covering = (item, w, atEnd) => item.pieces.find(x => atEnd ? (R.lt(x.s, w) && R.le(w, x.en)) : (R.le(x.s, w) && R.lt(w, x.en)));
      const startEvent = id => { const o = oldInfo.get(id); const x = covering(o.item, o.s, false); return x ? x.e.id : undefined; };
      const endEvent = id => { const o = oldInfo.get(id); const x = covering(o.item, o.en, true); return x ? x.e.id : undefined; };
      const headAt = (hid, atEnd) => {
        const o = headItem.get(hid);
        if (!o) return hid;
        const x = covering(o.item, atEnd ? o.info.en : o.info.s, atEnd);
        if (!x || !x.e.heads) return undefined;
        const h = x.e.heads.find(y => (y.pitch ? P.midi(y.pitch) : y.inst) === o.midi);
        return h ? h.id : undefined;
      };
      const moved = new Set();
      items.forEach(item => item.moved.forEach(id => moved.add(id)));
      const parts = Array.from(new Set(items.map(it => it.part)));
      parts.forEach(part => {
        /* spanners */
        const retiredSp = new Set();
        part.spanners = part.spanners.filter(sp => {
          if (sp.type === 'tie') {
            const fIn = sp.from !== undefined && headItem.has(sp.from), tIn = sp.to !== undefined && headItem.has(sp.to);
            if (fIn && tIn && headItem.get(sp.from).item === headItem.get(sp.to).item) { retiredSp.add(sp.id); return false; }
            if (fIn) { const n = headAt(sp.from, true); if (n === undefined) { retiredSp.add(sp.id); return false; } sp.from = n; }
            if (tIn) { const n = headAt(sp.to, false); if (n === undefined) { retiredSp.add(sp.id); return false; } sp.to = n; }
            return true;
          }
          if (sp.type === 'tuplet' || sp.type === 'beam') {
            /* a group over events the plan keeps where they were stays; one over a moved or retired event goes */
            if (sp.events.some(id => moved.has(id))) { retiredSp.add(sp.id); return false; }
            return true;
          }
          if (sp.type === 'slur') {
            if (sp.from !== undefined && oldInfo.has(sp.from)) sp.from = startEvent(sp.from);
            if (sp.to !== undefined && oldInfo.has(sp.to)) sp.to = endEvent(sp.to);
            if (sp.from === undefined && sp.to === undefined) { retiredSp.add(sp.id); return false; }
            return true;
          }
          if (sp.type === 'arpeggio') { sp.heads = sp.heads.map(h => (headItem.has(h) ? headAt(h, false) : h)).filter(Boolean); return true; }
          if (sp.type === 'gliss') {
            if (headItem.has(sp.from)) sp.from = headAt(sp.from, true);
            if (headItem.has(sp.to)) sp.to = headAt(sp.to, false);
            return true;
          }
          return true;
        });
        if (retiredSp.size) part.spanners.forEach(sp => { if (sp.type === 'tuplet' && retiredSp.has(sp.parent)) delete sp.parent; });
        retiredSp.forEach(id => this.retire(id));
        part.directions.forEach(d => { if (d.event !== undefined && oldInfo.has(d.event)) { const n = startEvent(d.event); if (n) d.event = n; else delete d.event; } });
        /* the events */
        const drop = new Set();
        items.forEach(item => { if (item.part === part) item.goneEvents.forEach(id => drop.add(id)); });
        if (drop.size) part.events = part.events.filter(e => !drop.has(e.id));
        items.forEach(item => { if (item.part === part) item.pieces.forEach(x => { if (!item.seen.has(x.e.id)) part.events.push(x.e); }); });
      });
      /* the plans' own ties */
      items.forEach(item => {
        const notes = item.pieces.filter(x => x.e.kind === 'note');
        notes.forEach((x, i) => {
          if (!x.p.tieNext) return;
          const y = notes[i + 1];
          if (!y || !R.eq(x.en, y.s)) throw new OpError('E-OP-TARGET', 'the plan ties ' + x.e.id + ' to nothing that starts where it ends');
          x.e.heads.forEach(h => {
            const to = y.e.heads.find(z => P.midi(z.pitch) === P.midi(h.pitch));
            if (to) item.part.spanners.push({ id: this.newId('s'), type: 'tie', from: h.id, to: to.id });
          });
        });
        item.goneEvents.forEach(id => this.retire(id, startEvent(id)));
        item.goneHeads.forEach(id => this.retire(id, headAt(id, false)));
      });
      this.fixFlags();
      this.reindex();
      this.touch();
      return items.map(item => item.pieces.map(x => x.e.id));
    }

    /* Move an event to another voice (and that voice's staff). Its ID and its heads' IDs stay. */
    moveEvent(eventId, voiceId, staffId) {
      const e = this.event(eventId);
      const st = staffId || this.voice(voiceId).staff;
      if (e.voice === voiceId && e.staff === st) return;
      const oldKey = this.vmKey(e);
      e.voice = voiceId; e.staff = st;
      (e.heads || []).forEach(h => { if (h.staff === st) delete h.staff; });
      this.vmRemove(e, oldKey); this.vmAdd(e);
      const part = this.partOfEvent(eventId);
      /* a tuplet or beam may not span two voices: the event leaves them (their pass groups it again) */
      if (part.spanners.some(sp => (sp.type === 'tuplet' || sp.type === 'beam') && sp.events.indexOf(eventId) >= 0)) {
        part.spanners = part.spanners.filter(sp => {
          if ((sp.type === 'tuplet' || sp.type === 'beam') && sp.events.indexOf(eventId) >= 0) { this.retire(sp.id); return false; }
          return true;
        });
      }
      this.touch();
    }

    /* Move some heads of a chord to a new event in another voice (G03 §9.2): the chord keeps its ID and the heads
       it keeps; the moved heads keep their IDs; the new event copies the time, value and marks. */
    moveHeads(eventId, headIds, voiceId, staffId) {
      const e = this.event(eventId), part = this.partOfEvent(eventId);
      const move = new Set(headIds);
      const moving = e.heads.filter(h => move.has(h.id));
      if (!moving.length || moving.length === e.heads.length) throw new OpError('E-OP-TARGET', 'moveHeads moves some heads of ' + eventId + ', not none or all');
      const st = staffId || this.voice(voiceId).staff;
      const ne = { id: this.newId('e'), kind: e.kind, m: e.m, at: e.at, dur: e.dur, voice: voiceId, staff: st };
      /* the chord's marks (articulations, ornaments, a fermata) stay with the chord: a mark is written once (G03 I6) */
      ['hidden', 'cue', 'display', 'prov'].forEach(k => { if (e[k] !== undefined) ne[k] = JSON.parse(JSON.stringify(e[k])); });
      ne.heads = moving;
      moving.forEach(h => { if (h.staff === st) delete h.staff; });
      e.heads = e.heads.filter(h => !move.has(h.id));
      part.events.push(ne);
      this.indexEvent(ne, part);
      this.touch();
      return ne.id;
    }

    /* Move heads of one note into another note that starts and lasts the same (and prints the same value), making it a
       chord: the heads keep their IDs; a note left with no heads retires into the one it joined. */
    joinHeads(fromId, headIds, toId) {
      const a = this.event(fromId), b = this.event(toId), part = this.partOfEvent(fromId);
      if (a.kind !== 'note' || b.kind !== 'note' || a.m !== b.m || a.at !== b.at || a.dur !== b.dur || !sameJson(a.display, b.display) || a.grace || b.grace)
        throw new OpError('E-OP-TARGET', 'joinHeads needs two notes with the same start, length and printed value');
      if (headIds.length === a.heads.length && (a.arts || a.orn || a.fermata || a.lyrics))
        throw new OpError('E-OP-TARGET', 'joinHeads would lose the marks of ' + fromId);
      const move = new Set(headIds);
      const moving = a.heads.filter(h => move.has(h.id));
      const there = new Set(b.heads.map(h => (h.pitch ? P.midi(h.pitch) : h.inst)));
      if (moving.some(h => there.has(h.pitch ? P.midi(h.pitch) : h.inst))) throw new OpError('E-OP-TARGET', 'joinHeads would put one pitch twice in ' + toId);
      moving.forEach(h => { if (h.staff === b.staff) delete h.staff; });
      b.heads = b.heads.concat(moving);
      a.heads = a.heads.filter(h => !move.has(h.id));
      moving.forEach(h => this.hd.set(h.id, { h: h, e: b, part: part }));
      if (!a.heads.length) {
        this.vmRemove(a);
        this.ev.delete(a.id);
        part.events = part.events.filter(e => e.id !== a.id);
        part.spanners.forEach(sp => {
          if (sp.type === 'slur') { if (sp.from === a.id) sp.from = b.id; if (sp.to === a.id) sp.to = b.id; }
          if ((sp.type === 'tuplet' || sp.type === 'beam') && sp.events.indexOf(a.id) >= 0) sp.events = sp.events.filter(x => x !== a.id);
        });
        part.directions.forEach(dd => { if (dd.event === a.id) dd.event = b.id; });
        this.dropEmptySpanners(part);
        this.retire(a.id, b.id);
      }
      this.touch();
    }

    /* The rests of a voice in a measure, again: every stretch no note of the voice covers becomes rests (each piece
       from restPieces(from, to) -> [{at, dur, display}]); rest IDs are reused in time order. Notes may not overlap. */
    refillRests(voiceId, m, restPieces) { return this.refillRestsBatch([{ voice: voiceId, m: m, restPieces: restPieces }]); }
    /* Many voice-measures at once (one retime for all of them): items [{voice, m, restPieces}]; it.changed says
       whether an item's rests changed. */
    refillRestsBatch(items) {
      const plans = [];
      items.forEach(it => { const plan = this.restPlan(it.voice, it.m, it.restPieces); it.changed = !!plan; if (plan) plans.push({ voice: it.voice, m: it.m, plan: plan }); });
      if (!plans.length) return false;
      this.retimeBatch(plans);
      return true;
    }
    /* the plan refillRests would give a voice-measure, or null when it would change nothing */
    restPlan(voiceId, m, restPieces) {
      const evs = this.voiceMeasure(voiceId, m);
      const notes = evs.filter(e => e.kind !== 'rest'), rests = evs.filter(e => e.kind === 'rest');
      const mdur = R.parse(this.doc.timeline.measures[this.mIdx.get(m)].dur);
      const plan = [];
      let cur = R.ZERO;
      /* a gap is filled by the rests already inside it, kept as they are, and new rests for what they leave */
      const keptRests = new Set();
      const addRests = (a, b) => {
        let x = a;
        rests.filter(r => { const rs = R.parse(r.at), re = R.add(rs, R.parse(r.dur)); return R.ge(rs, a) && R.le(re, b); })
          .forEach(r => {
            const rs = R.parse(r.at);
            if (R.lt(x, rs)) fresh(x, rs);
            plan.push(this.keepPlan(r)); keptRests.add(r.id);
            x = R.add(rs, R.parse(r.dur));
          });
        if (R.lt(x, b)) fresh(x, b);
      };
      const fresh = (a, b) => { restPieces(R.format(a), R.format(b)).forEach(x => plan.push({ kind: 'rest', at: x.at, dur: x.dur, display: x.display })); };
      notes.forEach(e => {
        const s = R.parse(e.at);
        if (R.lt(s, cur)) throw new OpError('E-OP-TARGET', 'notes of ' + voiceId + ' overlap in ' + m);
        if (R.lt(cur, s)) addRests(cur, s);
        plan.push(this.keepPlan(e));
        cur = R.add(s, R.parse(e.dur));
      });
      /* the rest of the measure; a voice left with no note at all is rests from its start to its end */
      if (R.lt(cur, mdur)) addRests(cur, mdur);
      /* rests no gap keeps go; their IDs are not reused for new pieces (a kept rest keeps its own) */
      const spare = rests.filter(r => !keptRests.has(r.id)).map(r => r.id);
      plan.forEach(p => { if (p.kind === 'rest' && p.reuse === undefined && spare.length) p.reuse = spare.shift(); });
      const before = JSON.stringify(evs.map(e => [e.id, e.kind, e.at, e.dur, e.display]));
      const after = JSON.stringify(plan.map(p => [p.reuse, p.kind, p.at, p.dur, p.display]));
      return before === after ? null : plan;
    }
    /* a plan entry that keeps an event exactly as it is */
    keepPlan(e) {
      const p = { reuse: e.id, kind: e.kind, at: e.at, dur: e.dur, display: e.display, arts: e.arts, orn: e.orn, fermata: e.fermata, lyrics: e.lyrics, hidden: e.hidden };
      if (e.heads) p.heads = e.heads.map(h => ({ reuse: h.id }));
      const ties = this.ties();
      p.tieNext = e.kind === 'note' && e.heads.some(h => { const to = ties.get(h.id); const x = to !== undefined && this.hd.get(to); return !!x && x.e.voice === e.voice && x.e.m === e.m; });
      return p;
    }
    /* Remove an event (a whole-measure rest a voice no longer needs). */
    removeEvent(eventId) { this.removeEvents([eventId]); }
    /* Remove events, in one sweep. */
    removeEvents(ids) {
      if (!ids.length) return;
      ids.forEach(id => this.event(id));
      dropEvents(this.doc, ids, this.idMap, []);
      this.reindex();
      this.touch();
    }
    /* Add a voice to a staff; returns its ID. */
    addVoice(staffId, label, part) {
      part = part || this.doc.parts.find(p => p.staves.some(s => s.id === staffId));
      const v = { id: this.newId('v'), staff: staffId };
      if (label !== undefined) v.label = label;
      part.voices.push(v);
      this.vc.set(v.id, { v: v, part: part });
      this.touch();
      return v.id;
    }
    /* Add a new event (rests of a new second voice). */
    addEvent(part, x) {
      const e = Object.assign({ id: this.newId('e') }, JSON.parse(JSON.stringify(x)));
      if (e.heads) e.heads = e.heads.map(h => Object.assign({ id: this.newId('h') }, h));
      part.events.push(e);
      this.indexEvent(e, part);
      this.touch();
      return e.id;
    }

    /* The tuplets of a voice in a measure (G03 §7): groups [{events, actual, normal, unit?, printed?, show?}]. A
       spanner whose members are the same events keeps its ID (§5.5); the rest are retired or new. Returns whether
       anything changed. Only spanners wholly inside the voice-measure are touched. */
    setTuplets(voiceId, m, groups) { return this.setGroupsBatch('tuplet', [{ voice: voiceId, m: m, groups: groups }]); }
    /* The beams of a voice in a measure (G03 §11): groups [{events, breaks?}]. Same rules. */
    setBeams(voiceId, m, groups) { return this.setGroupsBatch('beam', [{ voice: voiceId, m: m, groups: groups }]); }
    /* Many voice-measures at once: items [{voice, m, groups}]; one sweep over each part's spanners. */
    setGroupsBatch(type, items) {
      const fields = type === 'tuplet' ? ['actual', 'normal', 'unit', 'parent', 'show', 'printed'] : ['breaks'];
      let changed = false;
      const byPart = new Map();
      items.forEach(it => {
        const part = this.partOfVoice(it.voice);
        if (!byPart.has(part)) byPart.set(part, []);
        byPart.get(part).push(it);
      });
      byPart.forEach((list, part) => {
        /* the voice-measure every event is in, for the items of this part */
        const vmOf = new Map();
        const itemOf = new Map(list.map((it, i) => [it.voice + '|' + it.m, i]));
        part.events.forEach(e => { const i = itemOf.get(e.voice + '|' + e.m); if (i !== undefined) vmOf.set(e.id, i); });
        const current = list.map(() => []);
        part.spanners.forEach(sp => {
          if (sp.type !== type || !sp.events.length) return;
          const i = vmOf.get(sp.events[0]);
          if (i !== undefined && sp.events.every(id => vmOf.get(id) === i)) current[i].push(sp);
        });
        const drop = new Set();
        /* it.changed: whether this voice-measure's groups changed */
        list.forEach((it, i) => { it.changed = this.setGroupsIn(type, part, current[i], it.groups, fields, drop); if (it.changed) changed = true; });
        if (drop.size) {
          part.spanners = part.spanners.filter(sp => !drop.has(sp.id));
          part.spanners.forEach(sp => { if (sp.type === 'tuplet' && drop.has(sp.parent)) delete sp.parent; });
          drop.forEach(id => this.retire(id));
          changed = true;
        }
      });
      if (changed) this.touch();
      return changed;
    }
    setGroupsIn(type, part, current, groups, fields, drop) {
      const key = evs => evs.join(',');
      const byKey = new Map(current.map(sp => [key(sp.events), sp]));
      let changed = false;
      const keep = new Set();
      groups.forEach(gr => {
        const sp = byKey.get(key(gr.events));
        if (sp && !keep.has(sp.id)) {
          keep.add(sp.id);
          fields.forEach(f => {
            if (gr[f] === undefined) { if (sp[f] !== undefined) { delete sp[f]; changed = true; } }
            else if (!sameJson(sp[f], gr[f])) { sp[f] = JSON.parse(JSON.stringify(gr[f])); changed = true; }
          });
          if (gr.prov && !sameJson(sp.prov, gr.prov)) { sp.prov = gr.prov; changed = true; }
        } else {
          const x = { id: this.newId('s'), type: type, events: gr.events.slice() };
          fields.forEach(f => { if (gr[f] !== undefined) x[f] = JSON.parse(JSON.stringify(gr[f])); });
          if (gr.prov) x.prov = gr.prov;
          part.spanners.push(x);
          keep.add(x.id);
          changed = true;
        }
      });
      current.forEach(sp => { if (!keep.has(sp.id)) { drop.add(sp.id); changed = true; } });
      return changed;
    }

    /* A head's printed accidental (null removes it). */
    setAcc(headId, acc) {
      const h = this.head(headId);
      if (acc === null || acc === undefined) { if (h.acc === undefined) return false; delete h.acc; this.touch(); return true; }
      if (sameJson(h.acc, acc)) return false;
      h.acc = JSON.parse(JSON.stringify(acc));
      this.touch();
      return true;
    }
    /* A head's spelling: the same sounding pitch, another name (C#4 -> Db4). */
    setSpelling(headId, pitch) {
      const h = this.head(headId);
      if (!h.pitch || P.midi(h.pitch) !== P.midi(pitch)) throw new OpError('E-OP-TARGET', 'setSpelling may not change what ' + headId + ' sounds');
      const p = (pitch.alter || 0) ? { step: pitch.step, alter: pitch.alter, oct: pitch.oct } : { step: pitch.step, oct: pitch.oct };
      if (sameJson(h.pitch, p)) return false;
      h.pitch = p;
      this.touch();
      return true;
    }
    /* A key signature at the start of a measure (fifths, mode); an existing one there is replaced. */
    setKey(m, fifths, mode) {
      const keys = this.doc.timeline.keys = this.doc.timeline.keys || [];
      const k = keys.find(x => x.m === m && x.at === '0' && !x.scope);
      if (k) {
        if (k.fifths === fifths && (k.mode || undefined) === (mode || undefined)) return false;
        k.fifths = fifths; if (mode) k.mode = mode; else delete k.mode;
      } else keys.push(Object.assign({ id: this.newId('ky'), m: m, at: '0', fifths: fifths }, mode ? { mode: mode } : {}));
      this.touch();
      return true;
    }
    removeKey(id) {
      const tl = this.doc.timeline;
      const before = (tl.keys || []).length;
      tl.keys = (tl.keys || []).filter(k => k.id !== id);
      if (tl.keys.length === before) return false;
      this.retire(id);
      this.touch();
      return true;
    }
    /* A clef on a staff at a position. */
    addClef(part, x) {
      const c = Object.assign({ id: this.newId('c') }, x);
      part.clefs.push(c);
      this.touch();
      return c.id;
    }
    removeClef(part, id) {
      const before = part.clefs.length;
      part.clefs = part.clefs.filter(c => c.id !== id);
      if (part.clefs.length === before) return false;
      this.retire(id);
      this.touch();
      return true;
    }
    /* An ottava spanner (G03 §13.3; the pass that writes it is off by default, D2). */
    addSpanner(part, x) {
      const s = Object.assign({ id: this.newId('s') }, x);
      part.spanners.push(s);
      this.touch();
      return s.id;
    }
    /* Pedal marks: replace a pedal spanner's changes / ends (G03 §13.2). */
    setPedal(spannerId, fields) {
      for (const part of this.doc.parts) {
        const sp = part.spanners.find(x => x.id === spannerId);
        if (!sp) continue;
        let changed = false;
        Object.keys(fields).forEach(k => {
          if (fields[k] === undefined) { if (sp[k] !== undefined) { delete sp[k]; changed = true; } }
          else if (!sameJson(sp[k], fields[k])) { sp[k] = JSON.parse(JSON.stringify(fields[k])); changed = true; }
        });
        if (changed) this.touch();
        return changed;
      }
      throw new OpError('E-OP-TARGET', 'no spanner ' + spannerId);
    }
    removeSpanner(id) {
      for (const part of this.doc.parts) {
        const before = part.spanners.length;
        part.spanners = part.spanners.filter(s => s.id !== id);
        if (part.spanners.length !== before) { this.retire(id); this.touch(); return true; }
      }
      return false;
    }

    /* --------------------------------------------------------------- upkeep */
    /* The performance layer never changes: a head it links to may not go (G03 I5, R4). */
    assertUnlinked(headIds) {
      if (!headIds.length) return;
      if (!this.linked) {
        /* the performance layer never changes: its links are read once */
        this.linked = new Map();
        (this.doc.performances || []).forEach(pf => pf.notes.forEach(pn => { if (pn.link !== undefined) this.linked.set(pn.link, pn.id); }));
      }
      headIds.forEach(h => { if (this.linked.has(h)) throw new OpError('E-OP-TARGET', 'head ' + h + ' is linked from performance note ' + this.linked.get(h) + ' and may not be retired'); });
    }
    dropEmptySpanners(part) {
      part.spanners = part.spanners.filter(sp => {
        if ((sp.type === 'tuplet' && sp.events.length < 1) || (sp.type === 'beam' && sp.events.length < 2)) { this.retire(sp.id); return false; }
        return true;
      });
    }
    fixFlags() {
      const fl = this.doc.provenance.flags;
      if (!fl) return;
      fl.forEach(f => {
        if (!f.ids) return;
        f.ids = f.ids.map(id => (id in this.idMap ? this.idMap[id] : id)).filter(Boolean);
        if (!f.ids.length) delete f.ids;
      });
    }
  }

  /* One transaction: fn(draft) edits a private copy; the result is sealed once (validated unless opts.validate is
     false). No change returns the input graph itself. */
  function edit(g, fn, opts) {
    opts = opts || {};
    const d = new Draft(g, opts);
    const out = fn(d);
    if (!d.changed) return { graph: g, idMap: {}, issues: [], changed: false, result: out };
    d.doc.rev = (d.doc.rev || 0) + 1;
    if (opts.validate === false) {
      const graph = Z.deepFreeze(Z.canonicalize(d.doc, { reuse: v => d.unchanged(v) }));
      return { graph: graph, idMap: d.idMap, issues: [], changed: true, result: out };
    }
    try {
      const res = B.seal(d.doc);
      return { graph: res.graph, idMap: d.idMap, issues: res.issues, changed: true, result: out };
    } catch (e) {
      if (e.code === 'E-BUILD') throw new OpError('E-OP-RESULT', 'the edited graph is invalid: ' + e.message, e.issues);
      throw e;
    }
  }
  const single = name => function (g) { const args = Array.prototype.slice.call(arguments, 1); return edit(g, d => d[name].apply(d, args)); };

  return Object.freeze({ CODES, OpError, updateHead, removeEvents, replaceRegion, edit, Draft, END_ARTS,
    splitEvent: single('splitEvent'), mergeTied: single('mergeTied'), retimeVoiceMeasure: single('retimeVoiceMeasure'),
    moveEvent: single('moveEvent'), moveHeads: single('moveHeads'), setTuplets: single('setTuplets'), setBeams: single('setBeams'),
    setAcc: single('setAcc'), setSpelling: single('setSpelling'), setKey: single('setKey'), refillRests: single('refillRests') });
});
