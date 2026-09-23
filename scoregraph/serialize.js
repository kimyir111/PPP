/* ============================================================================
   PPP ScoreGraph — canonical JSON, versions, fingerprint (docs/GOALS/G01 §14)

   canonicalize(doc)  a new plain object: keys in schema order, fields equal to
                      their default left out, entity arrays in their canonical
                      order (§14.2). Unknown fields are kept (sorted, last) so
                      the validator still sees them.
   serialize(g)       UTF-8 JSON text: one member per line in containers, one
                      compact entity per line in entity arrays, LF, one final
                      newline. serialize(parse(s)) === s for canonical s.
   parse(s)           checks the version (E-VERSION), migrates older documents,
                      returns the canonical graph, deep-frozen.
   fingerprint(g)     FNV-1a 64 of serialize(g), 16 hex digits (§14.5).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./time.js'), require('./pitch.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.serialize = factory(M.rational, M.schema, M.time, M.pitch); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, T, P) {
  'use strict';

  const CLEF_LINE = { G: 2, F: 4, C: 3, TAB: 5 };
  const STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  function fail(code, message) {
    const e = new Error(code + ': ' + message);
    e.code = code;
    return e;
  }
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    return true;
  }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(k => deepFreeze(o[k]));
    }
    return o;
  }
  /* Plain JSON with object keys sorted at every level (ext and params, §14.2). */
  function sortKeysDeep(v) {
    if (Array.isArray(v)) return v.map(sortKeysDeep);
    if (isObj(v)) {
      const out = {};
      Object.keys(v).sort().forEach(k => { out[k] = sortKeysDeep(v[k]); });
      return out;
    }
    return v;
  }

  /* ------------------------------------------------------- canonical form */
  function isDefault(shapeName, fd, val, host, env, type) {
    if (fd.req) return false;
    if (fd.def !== undefined && deepEqual(val, fd.def)) return true;
    if (type && type.t === 'arr' && Array.isArray(val) && val.length === 0) return true;
    /* an empty object is kept: {} can be the information itself (a fermata with the default shape); only the
       maps ext and asp mean nothing when empty */
    if (type && (type.t === 'ext' || type.t === 'asp') && isObj(val) && Object.keys(val).length === 0) return true;
    if (shapeName === 'Head' && fd.name === 'staff' && env.eventStaff !== undefined && val === env.eventStaff) return true;
    if (shapeName === 'Clef' && fd.name === 'line' && CLEF_LINE[host.sign] === val) return true;
    if (shapeName === 'Barline' && fd.name === 'times' && val === 2) return true;
    if (shapeName === 'TempoEvent' && fd.name === 'display' && env.firstPart !== undefined &&
        deepEqual(val, [{ part: env.firstPart }])) return true;
    return false;
  }
  function canonValue(type, v, env) {
    if (v === null || v === undefined || !type) return v;
    switch (type.t) {
      case 'obj': return canonObj(type.shape, v, env);
      case 'arr': return Array.isArray(v) ? v.map(x => canonValue(type.of, x, env)) : v;
      case 'ext': case 'json': return sortKeysDeep(v);
      case 'asp': {
        if (!isObj(v)) return v;
        const out = {};
        S.ASPECTS.forEach(a => { if (v[a] !== undefined) out[a] = canonObj('ProvAspect', v[a], env); });
        Object.keys(v).filter(k => S.ASPECTS.indexOf(k) < 0).sort().forEach(k => { out[k] = v[k]; });
        return out;
      }
      default: return v;
    }
  }
  function canonObj(shapeName, v, env) {
    if (!isObj(v)) return v;
    if (shapeName === 'Event') env = Object.assign({}, env, { eventStaff: v.staff });
    const fields = S.fieldsOf(shapeName, v);
    const out = {}, known = new Set();
    fields.forEach(fd => {
      known.add(fd.name);
      if (!Object.prototype.hasOwnProperty.call(v, fd.name) || v[fd.name] === undefined) return;
      const type = S.fieldType(shapeName, fd, v);
      const val = canonValue(type, v[fd.name], env);
      if (isDefault(shapeName, fd, val, v, env, type)) return;
      out[fd.name] = val;
    });
    Object.keys(v).filter(k => !known.has(k)).sort().forEach(k => { out[k] = v[k]; });
    return out;
  }

  /* ------------------------------------------------------- array order */
  const TYPE_RANK = { number: 0, object: 1, string: 2 };
  function cmpTuple(a, b) {
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const tx = typeof x, ty = typeof y;
      if (tx !== ty) return TYPE_RANK[tx] - TYPE_RANK[ty];
      let c;
      if (tx === 'number') c = x < y ? -1 : x > y ? 1 : 0;
      else if (tx === 'object') c = R.cmp(x, y);
      else c = x < y ? -1 : x > y ? 1 : 0;
      if (c) return c;
    }
    return 0;
  }
  function sortBy(arr, keyOf) {
    if (!Array.isArray(arr)) return;
    const keyed = arr.map(x => ({ x: x, k: keyOf(x).concat([JSON.stringify(x)]) }));
    keyed.sort((a, b) => cmpTuple(a.k, b.k));
    keyed.forEach((e, i) => { arr[i] = e.x; });
  }
  const num = id => { const n = typeof id === 'string' ? S.idNumber(id) : null; return n === null ? Infinity : n; };
  const ratKey = x => (typeof x === 'string' ? R.tryParse(x) : null);

  function sortArrays(doc) {
    const tl = isObj(doc.timeline) ? doc.timeline : {};
    const c = T.ctx(doc);
    const mIdx = m => { const i = c.index.get(m); return i === undefined ? Infinity : i; };
    const posW = p => {
      if (!isObj(p)) return null;
      const i = c.index.get(p.m), at = ratKey(p.at);
      return i === undefined || !at ? null : R.add(c.starts[i], at);
    };
    sortBy(tl.meters, x => [mIdx(x && x.m), num(x && x.id)]);
    ['keys', 'tempos', 'jumps'].forEach(k => sortBy(tl[k], x => [mIdx(x && x.m), ratKey(x && x.at), num(x && x.id)]));
    sortBy(tl.endings, x => [mIdx(x && x.from), num(x && x.id)]);

    const parts = Array.isArray(doc.parts) ? doc.parts : [];
    parts.forEach(part => {
      if (!isObj(part)) return;
      const staffIdx = new Map(), voiceIdx = new Map();
      (Array.isArray(part.staves) ? part.staves : []).forEach((s, i) => { if (isObj(s)) staffIdx.set(s.id, i); });
      (Array.isArray(part.voices) ? part.voices : []).forEach((v, i) => { if (isObj(v)) voiceIdx.set(v.id, i); });
      const sIdx = s => (s === undefined ? -1 : staffIdx.has(s) ? staffIdx.get(s) : Infinity);
      const vIdx = v => (voiceIdx.has(v) ? voiceIdx.get(v) : Infinity);
      const kit = (isObj(part.instrument) && isObj(part.instrument.kit) && Array.isArray(part.instrument.kit.items))
        ? part.instrument.kit.items : [];
      sortBy(part.clefs, x => [mIdx(x && x.m), ratKey(x && x.at), sIdx(x && x.staff), num(x && x.id)]);
      const events = Array.isArray(part.events) ? part.events : [];
      const evById = new Map(), evOfHead = new Map();
      events.forEach(e => {
        if (!isObj(e)) return;
        evById.set(e.id, e);
        if (Array.isArray(e.heads)) {
          e.heads.forEach(h => { if (isObj(h)) evOfHead.set(h.id, e); });
          sortBy(e.heads, h => {
            if (isObj(h) && isObj(h.pitch) && P.PC[h.pitch.step] !== undefined && Number.isInteger(h.pitch.oct))
              return [0, P.midi(h.pitch), STEP_ORDER[h.pitch.step], num(h.id)];
            const ki = isObj(h) ? kit.findIndex(it => isObj(it) && it.key === h.inst) : -1;
            return [1, ki >= 0 && Number.isInteger(kit[ki].gm) ? kit[ki].gm : 0, ki < 0 ? Infinity : ki, num(h && h.id)];
          });
        }
        if (Array.isArray(e.arts)) sortBy(e.arts, a => [S.ARTICULATIONS.indexOf(a) < 0 ? Infinity : S.ARTICULATIONS.indexOf(a)]);
        if (Array.isArray(e.lyrics)) sortBy(e.lyrics, l => [isObj(l) && Number.isInteger(l.verse) ? l.verse : 1]);
      });
      sortBy(events, e => {
        const g = isObj(e) && isObj(e.grace);
        return [mIdx(e && e.m), vIdx(e && e.voice), ratKey(e && e.at), g ? 0 : 1, g && Number.isInteger(e.grace.order) ? e.grace.order : 0, num(e && e.id)];
      });
      sortBy(part.directions, x => [mIdx(x && x.m), ratKey(x && x.at), sIdx(x && x.staff), isObj(x) ? String(x.kind) : '', num(x && x.id)]);
      const evW = id => { const e = evById.get(id); return e ? posW(e) : null; };
      const headW = id => { const e = evOfHead.get(id); return e ? posW(e) : null; };
      sortBy(part.spanners, s => {
        if (!isObj(s)) return [null, '', Infinity];
        let w = null;
        if (s.type === 'tie') w = headW(s.from !== undefined ? s.from : s.to);
        else if (s.type === 'slur') w = evW(s.from !== undefined ? s.from : s.to);
        else if (s.type === 'tuplet' || s.type === 'beam') w = Array.isArray(s.events) ? evW(s.events[0]) : null;
        else if (s.type === 'arpeggio') w = Array.isArray(s.heads) ? headW(s.heads[0]) : null;
        else w = posW(s.from);
        return [w, String(s.type), num(s.id)];
      });
    });

    if (isObj(doc.structure)) {
      sortBy(doc.structure.sections, x => [mIdx(x && x.from), num(x && x.id)]);
      sortBy(doc.structure.phrases, x => [posW(x && x.from), num(x && x.id)]);
    }
    if (Array.isArray(doc.performances)) {
      let order = null;
      try { order = new Map(T.unroll(doc).map((v, i) => [v.m + '|' + v.k, i])); } catch (e) { order = new Map(); }
      doc.performances.forEach(pf => {
        if (!isObj(pf)) return;
        sortBy(pf.notes, x => [isObj(x) && Number.isInteger(x.on) ? x.on : Infinity, isObj(x) && x.midi !== undefined ? 0 : 1,
          isObj(x) && Number.isInteger(x.midi) ? x.midi : 0, isObj(x) && typeof x.inst === 'string' ? x.inst : '', num(x && x.id)]);
        sortBy(pf.pedals, x => [isObj(x) && Number.isInteger(x.on) ? x.on : Infinity, num(x && x.id)]);
        sortBy(pf.anchors, x => {
          const vi = isObj(x) ? order.get(x.m + '|' + x.k) : undefined;
          return [vi === undefined ? Infinity : vi, ratKey(x && x.at), mIdx(x && x.m), isObj(x) && Number.isInteger(x.k) ? x.k : 0];
        });
      });
    }
    if (isObj(doc.provenance)) {
      sortBy(doc.provenance.flags, x => {
        if (isObj(x) && isObj(x.span)) return [0, posW(x.span.from), num(x.id)];
        return [1, isObj(x) && Array.isArray(x.ids) && x.ids.length ? num(x.ids[0]) : Infinity, num(x && x.id)];
      });
    }
    return doc;
  }

  /* The canonical form of a document (a new object; the input is not changed). */
  function canonicalize(doc) {
    if (!isObj(doc)) return doc;
    const firstPart = Array.isArray(doc.parts) && isObj(doc.parts[0]) ? doc.parts[0].id : undefined;
    return sortArrays(canonObj('ScoreGraph', doc, { firstPart: firstPart }));
  }

  /* ------------------------------------------------------------ text form */
  const CONTAINERS = {
    ScoreGraph: { timeline: ['c', 'Timeline'], parts: ['ca', 'Part'], structure: ['c', 'Structure'],
      performances: ['ca', 'Performance'], provenance: ['c', 'Provenance'] },
    Timeline: { measures: ['e'], meters: ['e'], keys: ['e'], tempos: ['e'], endings: ['e'], jumps: ['e'] },
    Part: { staves: ['e'], voices: ['e'], clefs: ['e'], events: ['e'], directions: ['e'], spanners: ['e'] },
    Structure: { sections: ['e'], phrases: ['e'] },
    Performance: { notes: ['e'], pedals: ['e'], anchors: ['e'] },
    Provenance: { sources: ['e'], flags: ['e'] }
  };
  function layoutContainer(obj, shape, ind) {
    const pad = '  '.repeat(ind), pad2 = '  '.repeat(ind + 1);
    const how = CONTAINERS[shape] || {};
    return Object.keys(obj).map(k => {
      const v = obj[k], h = how[k];
      let text;
      if (h && h[0] === 'c' && isObj(v)) {
        text = '{\n' + layoutContainer(v, h[1], ind + 1) + '\n' + pad + '}';
      } else if (h && h[0] === 'ca' && Array.isArray(v) && v.every(isObj)) {
        text = v.length ? '[\n' + v.map(x => pad2 + '{\n' + layoutContainer(x, h[1], ind + 2) + '\n' + pad2 + '}').join(',\n') + '\n' + pad + ']' : '[]';
      } else if (h && h[0] === 'e' && Array.isArray(v)) {
        text = v.length ? '[\n' + v.map(x => pad2 + JSON.stringify(x)).join(',\n') + '\n' + pad + ']' : '[]';
      } else {
        text = JSON.stringify(v);
      }
      return pad + JSON.stringify(k) + ': ' + text;
    }).join(',\n');
  }
  function serialize(g) {
    const c = canonicalize(g);
    if (!isObj(c)) throw new TypeError('a ScoreGraph is an object');
    return '{\n' + layoutContainer(c, 'ScoreGraph', 1) + '\n}\n';
  }

  /* ------------------------------------------------------ versions (§14.4) */
  /* MIGRATIONS[v]: doc_v -> doc_{v+1}, pure JSON -> JSON. Empty: v1 is the first version. */
  const MIGRATIONS = Object.freeze({});
  function migrate(doc, opts) {
    const current = opts && opts.current != null ? opts.current : S.SCOREGRAPH_VERSION;
    const table = (opts && opts.migrations) || MIGRATIONS;
    let v = isObj(doc) ? doc.scoregraph_version : undefined;
    if (!Number.isInteger(v)) throw fail('E-VERSION', 'scoregraph_version is missing or not an integer');
    if (v > current) throw fail('E-VERSION', 'scoregraph_version ' + v + ' is newer than this code (' + current + '): update the app');
    while (v < current) {
      const step = table[v];
      if (typeof step !== 'function') throw fail('E-VERSION', 'no migration from scoregraph_version ' + v);
      doc = step(JSON.parse(JSON.stringify(doc)));
      if (!isObj(doc) || doc.scoregraph_version !== v + 1) throw fail('E-VERSION', 'migration ' + v + ' did not produce version ' + (v + 1));
      v++;
    }
    return doc;
  }
  function parse(text, opts) {
    if (typeof text !== 'string') throw new TypeError('parse takes JSON text');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw fail('E-SHAPE', 'not JSON: ' + e.message); }
    if (!isObj(doc)) throw fail('E-SHAPE', 'a ScoreGraph is a JSON object');
    return deepFreeze(canonicalize(migrate(doc, opts)));
  }

  /* ------------------------------------------------------ fingerprint (§14.5) */
  function utf8(text) {
    const out = [];
    for (const ch of text) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }
  /* FNV-1a 64 over 16-bit limbs (no BigInt in the loop): h ^= byte; h *= 0x100000001b3 mod 2^64. */
  function fnv1a64(bytes) {
    let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
    for (let i = 0; i < bytes.length; i++) {
      h0 ^= bytes[i];
      let t0 = h0 * 0x1b3, t1 = h1 * 0x1b3, t2 = h2 * 0x1b3, t3 = h3 * 0x1b3;
      t2 += h0 << 8;
      t3 += h1 << 8;
      t1 += t0 >>> 16; h0 = t0 & 0xffff;
      t2 += t1 >>> 16; h1 = t1 & 0xffff;
      t3 += t2 >>> 16; h2 = t2 & 0xffff;
      h3 = t3 & 0xffff;
    }
    const hex = x => ('000' + x.toString(16)).slice(-4);
    return hex(h3) + hex(h2) + hex(h1) + hex(h0);
  }
  function fingerprint(g) { return fnv1a64(utf8(serialize(g))); }
  /* How SongGraph (G7+) points at the graph it analysed (§10.3). */
  function scoreRef(g) { return { scoreId: g.id, rev: g.rev, fp: fingerprint(g) }; }

  return Object.freeze({ CLEF_LINE, deepEqual, deepFreeze, sortKeysDeep, canonicalize, serialize, parse, migrate,
    MIGRATIONS, utf8, fnv1a64, fingerprint, scoreRef });
});
