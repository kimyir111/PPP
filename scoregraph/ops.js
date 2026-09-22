/* ============================================================================
   PPP ScoreGraph — edit operations (docs/GOALS/G01 §12.3, §12.4)

   Every op takes a (frozen) graph and returns {graph, idMap, issues}:
     graph   a new validated, frozen graph with rev + 1
     idMap   {retiredId: replacementId | null}
     issues  the new graph's validation issues (warnings, infos)
   The input graph is never changed. An op whose result has an ERROR, or a
   request the op cannot honour, throws OpError {code, issues}.

   G1 implements updateHead, removeEvents and replaceRegion (A31); the other
   ops of §12.3 are for the Goals that need them.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./time.js'), require('./build.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.ops = factory(M.rational, M.schema, M.time, M.build); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, T, B) {
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
  const clone = g => JSON.parse(JSON.stringify(g));
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

  return Object.freeze({ CODES, OpError, updateHead, removeEvents, replaceRegion });
});
