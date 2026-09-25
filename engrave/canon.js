/* ============================================================================
   PPP engrave — the canonical form of an EngravedScore and its hash (docs/GOALS/G04 §8.4, §20)

   canonical(x)  JSON with every object's keys in sorted order and every number
                 rounded to 0.01 (a staff space's hundredth; -0 is 0). The
                 layout already rounds its coordinates to 0.01 sp; this makes
                 the text independent of key insertion order and of the last
                 bits of a floating point sum.
   hash(x)       FNV-1a 64 of the canonical text's UTF-8 bytes - the same hash
                 ScoreGraph fingerprints use (scoregraph/serialize.js), so Node
                 and a browser compute it synchronously and identically. (G04 §8.4
                 named sha256; FNV is used because no browser offers a
                 synchronous sha256 - G4-B4.)
   A number that is not finite (NaN, Infinity) is a layout defect, never data:
   canonical() throws on it rather than writing null (G4b review O1), so a
   broken coordinate cannot hash like a missing one.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/serialize.js'));
  else (root.PPPEngraveModules = root.PPPEngraveModules || {}).canon = factory((root.PPPScoreGraphModules || {}).serialize);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Z) {
  'use strict';

  const r2 = v => { const x = Math.round(v * 100) / 100; return x === 0 ? 0 : x; };
  const BAD = {};
  function norm(v) {
    if (typeof v === 'number') {
      if (!isFinite(v)) throw BAD;
      return r2(v);
    }
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) o[k] = norm(v[k]); });
      return o;
    }
    return v;
  }
  /* where the first number that is not finite sits (only walked when there is one) */
  function whereBad(v, at) {
    if (typeof v === 'number') return isFinite(v) ? null : at + ' = ' + String(v);
    if (v && typeof v === 'object') {
      const keys = Array.isArray(v) ? v.map((x, i) => i) : Object.keys(v).sort();
      for (const k of keys) { const w = whereBad(v[k], at + (Array.isArray(v) ? '[' + k + ']' : '.' + k)); if (w) return w; }
    }
    return null;
  }
  function canonical(x) {
    try { return JSON.stringify(norm(x)); } catch (e) {
      if (e === BAD) throw new Error('canonical: a number that is not finite at ' + whereBad(x, '$'));
      throw e;
    }
  }
  const hash = x => Z.fnv1a64(Z.utf8(canonical(x)));

  return Object.freeze({ r2, canonical, hash });
});
