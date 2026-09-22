/* ============================================================================
   PPP ScoreGraph — builder (docs/GOALS/G01 §12.2, §13.1 DP10)

   const b = builder({id, meta, source, default})
   b.id('e')            the next ID of a kind (one counter for every kind)
   b.measure({...}) …   append an entity; its ID is assigned when it has none
   b.finish()           {graph, issues}: canonical, validated, deep-frozen.
                        Throws BuildError (code E-BUILD, .issues) on any ERROR.

   IDs are handed out in the order entities are created, so the same calls
   give the same IDs and the same bytes (A30).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./schema.js'), require('./serialize.js'), require('./validate.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.build = factory(M.schema, M.serialize, M.validate); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, Z, V) {
  'use strict';

  class BuildError extends Error {
    constructor(issues) {
      const errors = issues.filter(i => i.severity === 'ERROR');
      super('E-BUILD: the graph has ' + errors.length + ' error(s): ' + errors.slice(0, 3).map(i => i.code + ' ' + i.message).join('; '));
      this.name = 'BuildError';
      this.code = 'E-BUILD';
      this.issues = issues;
    }
  }

  /* Check and freeze a finished document: the boundary rule (DP10). */
  function seal(doc) {
    const graph = Z.deepFreeze(Z.canonicalize(doc));
    const res = V.validate(graph);
    if (!res.ok) throw new BuildError(res.issues);
    return { graph: graph, issues: res.issues };
  }

  function builder(opts) {
    opts = opts || {};
    let next = opts.nextId || 1;
    const newId = prefix => {
      if (!S.KIND_OF_PREFIX[prefix]) throw new TypeError('unknown ID prefix ' + prefix);
      return prefix + (next++);
    };
    const doc = {
      scoregraph_version: S.SCOREGRAPH_VERSION,
      id: opts.id || 'sg',
      rev: 0,
      nextId: 0,
      meta: Object.assign({}, opts.meta || {}),
      timeline: { measures: [], meters: [], keys: [], tempos: [], endings: [], jumps: [] },
      parts: [],
      provenance: { sources: [], default: undefined, flags: [] }
    };
    const withId = (prefix, o) => (o.id ? o : Object.assign({ id: newId(prefix) }, o));
    const api = {
      doc: doc,
      id: newId,
      source(src) { const s = withId('sr', src); doc.provenance.sources.push(s); return s; },
      setDefault(prov) { doc.provenance.default = prov; },
      measure(m) { const x = withId('m', m); doc.timeline.measures.push(x); return x; },
      meter(x) { const o = withId('mt', x); doc.timeline.meters.push(o); return o; },
      key(x) { const o = withId('ky', x); doc.timeline.keys.push(o); return o; },
      tempo(x) { const o = withId('tp', x); doc.timeline.tempos.push(o); return o; },
      ending(x) { const o = withId('en', x); doc.timeline.endings.push(o); return o; },
      jump(x) { const o = withId('j', x); doc.timeline.jumps.push(o); return o; },
      part(p) {
        const o = withId('p', Object.assign({ staves: [], voices: [], clefs: [], events: [], directions: [], spanners: [] }, p));
        doc.parts.push(o);
        return o;
      },
      staff(part, x) { const o = withId('st', x); part.staves.push(o); return o; },
      voice(part, x) { const o = withId('v', x); part.voices.push(o); return o; },
      clef(part, x) { const o = withId('c', x); part.clefs.push(o); return o; },
      /* An event and its heads: heads get IDs right after the event (§12.2 document order). */
      event(part, x) {
        const o = withId('e', x);
        if (o.heads) o.heads = o.heads.map(h => withId('h', h));
        part.events.push(o);
        return o;
      },
      direction(part, x) { const o = withId('d', x); part.directions.push(o); return o; },
      spanner(part, x) { const o = withId('s', x); part.spanners.push(o); return o; },
      performance(x) {
        const o = withId('pf', Object.assign({ notes: [] }, x));
        (doc.performances = doc.performances || []).push(o);
        return o;
      },
      perfNote(perf, x) { const o = withId('pn', x); perf.notes.push(o); return o; },
      perfPedal(perf, x) { const o = withId('pp', x); (perf.pedals = perf.pedals || []).push(o); return o; },
      anchor(perf, x) { (perf.anchors = perf.anchors || []).push(x); return x; },
      flag(x) { const o = withId('fl', x); doc.provenance.flags.push(o); return o; },
      /* The finished graph (validated, canonical, frozen). The builder must not be used afterwards. */
      finish() {
        doc.nextId = next;
        if (doc.provenance.default === undefined && doc.provenance.sources.length)
          doc.provenance.default = { src: doc.provenance.sources[0].id };
        return seal(doc);
      }
    };
    if (opts.source) api.source(opts.source);
    if (opts.default) api.setDefault(opts.default);
    return api;
  }

  return Object.freeze({ builder, seal, BuildError });
});
