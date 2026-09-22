/* ============================================================================
   PPP ScoreGraph — provenance (docs/GOALS/G01 §11)

   provOf(g, id, aspect?) -> {src?, op?, conf?}: each field from the most
   specific place that states it, in this order (§11.2):
     entity.prov.asp[aspect] ⊕ entity.prov ⊕ container prov(s) ⊕
     provenance.default.asp[aspect] ⊕ provenance.default
   containers: a head's event and part; a part entity's part. A missing conf
   stays missing: an unknown confidence is not 1.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.prov = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FIELDS = ['src', 'op', 'conf'];
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

  /* The entity with this ID and the prov of its containers, innermost first. */
  function locate(g, id) {
    const tl = g.timeline || {};
    for (const k of ['measures', 'meters', 'keys', 'tempos', 'endings', 'jumps']) {
      const e = (tl[k] || []).find(x => x.id === id);
      if (e) return { entity: e, containers: [] };
    }
    for (const part of g.parts || []) {
      if (part.id === id) return { entity: part, containers: [] };
      for (const k of ['staves', 'voices', 'clefs', 'directions', 'spanners']) {
        const e = (part[k] || []).find(x => x.id === id);
        if (e) return { entity: e, containers: [part] };
      }
      for (const ev of part.events || []) {
        if (ev.id === id) return { entity: ev, containers: [part] };
        const h = (ev.heads || []).find(x => x.id === id);
        if (h) return { entity: h, containers: [ev, part] };
      }
    }
    const st = g.structure || {};
    for (const k of ['sections', 'phrases']) {
      const e = (st[k] || []).find(x => x.id === id);
      if (e) return { entity: e, containers: [] };
    }
    return null;
  }

  function provOf(g, id, aspect) {
    const where = locate(g, id);
    if (!where) { const e = new Error('E-REF-MISSING: no entity ' + id); e.code = 'E-REF-MISSING'; throw e; }
    const dflt = (g.provenance && g.provenance.default) || {};
    const chain = [];
    const own = where.entity.prov;
    if (aspect && isObj(own) && isObj(own.asp) && isObj(own.asp[aspect])) chain.push(own.asp[aspect]);
    if (isObj(own)) chain.push(own);
    where.containers.forEach(c => { if (isObj(c.prov)) chain.push(c.prov); });
    if (aspect && isObj(dflt.asp) && isObj(dflt.asp[aspect])) chain.push(dflt.asp[aspect]);
    chain.push(dflt);
    const out = {};
    FIELDS.forEach(f => {
      for (const p of chain) if (p[f] !== undefined) { out[f] = p[f]; break; }
    });
    return out;
  }

  return Object.freeze({ provOf, locate });
});
