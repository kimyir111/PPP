/* ============================================================================
   PPP engrave — where a song's graph is kept between visits
   (docs/GOALS/G04 §8.2, user decision G4-U1)

   A cache, never the record of truth: the song's Score in its slot stays the
   thing that is saved (and shared, and synced). A graph kept here is used only
   when it is intact and still states the same music as the Score beside it;
   otherwise it is dropped and the renderer makes one from the Score. So a
   missing, stale, corrupt or unreadable entry costs fidelity, never a song.

   encode(graph, meta)        -> record   canonical JSON (serialize), gzip when the
                                          platform has CompressionStream
   decode(record)             -> {ok, graph, code?}
   createStore({backend})     -> {get, put, del, keys, stats}
   idbBackend(indexedDB)      IndexedDB 'ppp-engrave' / 'graphs', keyPath 'key'
   memoryBackend()            the same contract in memory (tests, and no IndexedDB)

   A record: {key, v, lib, sgv, graphId, rev, fp, scoreId, scoreHash, producer,
   encoding: 'gzip'|'identity', size (text bytes), stored (bytes kept), data,
   savedAt}. fp is the graph's fingerprint (FNV-1a 64 of its canonical text), so
   what comes back is checked byte for byte before it is trusted.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'));
  else { const M = root.PPPEngraveModules = root.PPPEngraveModules || {}; M.store = factory(root.PPPScoreGraph); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG) {
  'use strict';

  const RECORD_VERSION = 1;
  const DB_NAME = 'ppp-engrave', STORE_NAME = 'graphs';
  const LIMITS = Object.freeze({ records: 200, bytes: 64 * 1024 * 1024, record: 16 * 1024 * 1024 });

  const streams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' &&
    typeof Blob === 'function' && typeof Response === 'function';
  async function pipe(bytes, transform) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
  }
  const toBytes = text => new TextEncoder().encode(text);
  const toText = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

  async function encode(graph, meta, opts) {
    meta = meta || {};
    const text = SG.serialize(graph);
    const raw = toBytes(text);
    const gzip = (!opts || opts.compress !== false) && streams();
    const data = gzip ? await pipe(raw, new CompressionStream('gzip')) : raw;
    return {
      key: meta.key, v: RECORD_VERSION, lib: SG.version, sgv: graph.scoregraph_version,
      graphId: graph.id, rev: graph.rev, fp: SG.fingerprint(graph),
      scoreId: meta.scoreId === undefined ? null : meta.scoreId, scoreHash: meta.scoreHash === undefined ? null : meta.scoreHash,
      producer: meta.producer || null,
      encoding: gzip ? 'gzip' : 'identity', size: raw.length, stored: data.length,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      savedAt: meta.now === undefined ? Date.now() : meta.now
    };
  }

  /* Everything that can go wrong with a kept graph has a name, and none of them throws. */
  async function decode(rec) {
    try {
      if (!rec || typeof rec !== 'object') return { ok: false, code: 'missing' };
      if (rec.v !== RECORD_VERSION) return { ok: false, code: 'record-version' };
      if (!rec.data) return { ok: false, code: 'no-data' };
      let bytes = new Uint8Array(rec.data);
      if (rec.encoding === 'gzip') {
        if (!streams()) return { ok: false, code: 'no-decompression' };
        bytes = await pipe(bytes, new DecompressionStream('gzip'));
      } else if (rec.encoding !== 'identity') return { ok: false, code: 'encoding' };
      const text = toText(bytes);
      let graph;
      /* parse() migrates an older schema version and refuses a newer one (E-VERSION) */
      try { graph = SG.parse(text); } catch (e) { return { ok: false, code: e && e.code === 'E-VERSION' ? 'schema-version' : 'unreadable' }; }
      const migrated = rec.sgv !== graph.scoregraph_version;
      if (!migrated && SG.fingerprint(graph) !== rec.fp) return { ok: false, code: 'fingerprint' };
      const res = SG.validate(graph);
      if (!res.ok) return { ok: false, code: 'invalid' };
      return { ok: true, graph: graph, migrated: migrated };
    } catch (e) {
      return { ok: false, code: 'decode-failed' };
    }
  }

  /* ---------------------------------------------------------------- backends */
  function memoryBackend() {
    const m = new Map();
    return {
      kind: 'memory',
      async get(key) { return m.has(key) ? m.get(key) : null; },
      async put(rec) { m.set(rec.key, rec); },
      async del(key) { m.delete(key); },
      async all() { return [...m.values()]; },
      _map: m
    };
  }
  function idbBackend(idb) {
    let db = null;
    const open = () => {
      if (db) return db;
      db = new Promise((resolve, reject) => {
        let req;
        try { req = idb.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME, { keyPath: 'key' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
      db.catch(() => { db = null; });
      return db;
    };
    const run = (mode, fn) => open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(STORE_NAME, mode);
      const r = fn(t.objectStore(STORE_NAME));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
    return {
      kind: 'indexeddb',
      get(key) { return run('readonly', s => s.get(key)).then(r => r || null); },
      put(rec) { return run('readwrite', s => s.put(rec)); },
      del(key) { return run('readwrite', s => s.delete(key)); },
      all() { return run('readonly', s => s.getAll()); }
    };
  }

  /* ------------------------------------------------------------------ store */
  function createStore(opts) {
    opts = opts || {};
    const backend = opts.backend || memoryBackend();
    const limits = Object.assign({}, LIMITS, opts.limits || {});
    const now = opts.now || (() => Date.now());
    const stats = { puts: 0, gets: 0, hits: 0, dropped: {}, errors: {} };
    const count = (o, code) => { o[code] = (o[code] || 0) + 1; };

    /* the oldest records go first once there are too many or they take too much room */
    async function evict(keep) {
      const all = (await backend.all()).filter(r => r && r.key !== keep).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      let total = all.reduce((s, r) => s + (r.stored || 0), 0), n = all.length + 1;
      for (const r of all) {
        if (n <= limits.records && total <= limits.bytes) break;
        await backend.del(r.key);
        total -= r.stored || 0; n--;
        count(stats.dropped, 'evicted');
      }
    }

    return {
      backend: backend.kind,
      stats: stats,
      /* -> {ok, graph, record} | {ok:false, code} */
      async get(key) {
        stats.gets++;
        let rec;
        try { rec = await backend.get(key); } catch (e) { count(stats.errors, 'get'); return { ok: false, code: 'backend' }; }
        if (!rec) return { ok: false, code: 'missing' };
        const d = await decode(rec);
        if (!d.ok) {
          count(stats.dropped, d.code);
          try { await backend.del(key); } catch (e) { /* gone next time, or never read again */ }
          return { ok: false, code: d.code };
        }
        stats.hits++;
        return { ok: true, graph: d.graph, migrated: d.migrated, record: rec };
      },
      /* -> {ok, record} | {ok:false, code}. A graph that is not a producer's (a projection) is refused:
         a lower-fidelity graph never takes the place of the one a file or a transcription made. */
      async put(key, graph, meta) {
        meta = meta || {};
        if (meta.via && meta.via !== 'live') return { ok: false, code: 'not-live' };
        let rec;
        try { rec = await encode(graph, Object.assign({}, meta, { key: key, now: now() }), opts); }
        catch (e) { count(stats.errors, 'encode'); return { ok: false, code: 'encode' }; }
        if (rec.stored > limits.record) { count(stats.dropped, 'too-large'); return { ok: false, code: 'too-large' }; }
        try { await backend.put(rec); await evict(key); }
        catch (e) {
          const quota = e && /quota/i.test((e.name || '') + ' ' + (e.message || ''));
          count(stats.errors, quota ? 'quota' : 'put');
          return { ok: false, code: quota ? 'quota' : 'backend' };
        }
        stats.puts++;
        return { ok: true, record: rec };
      },
      async del(key) { try { await backend.del(key); return true; } catch (e) { return false; } },
      async keys() { try { return (await backend.all()).map(r => r.key).sort(); } catch (e) { return []; } }
    };
  }

  return Object.freeze({ RECORD_VERSION, DB_NAME, STORE_NAME, LIMITS, encode, decode, memoryBackend, idbBackend, createStore });
});
