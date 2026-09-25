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
   decode(record)             -> {ok, graph, migrated, code?}
   createStore({backend, estimate, limits})
                              -> {get, put, del, keys, stats}
   idbBackend(indexedDB)      IndexedDB 'ppp-engrave' v2: 'graphs' (the records)
                              and 'meta' (key, stored bytes, savedAt - what
                              eviction reads, so it never loads a graph)
   memoryBackend()            the same contract in memory (tests, and no IndexedDB)

   A record: {key, v, lib, sgv, graphId, rev, fp, scoreId, scoreHash, hashV,
   agreeLib, producer, encoding: 'gzip'|'identity', size (text bytes), stored
   (bytes kept), data, savedAt}. fp is the FNV-1a 64 of the canonical text, and
   it is checked on the stored bytes themselves before they are parsed - also
   for a graph of an older schema, which parse() then migrates. agreeLib is the
   library under which the graph was found to agree with its Score; a record
   from another library is checked again before it is used (source.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'), require('../scoregraph/serialize.js'));
  else { const M = root.PPPEngraveModules = root.PPPEngraveModules || {}; M.store = factory(root.PPPScoreGraph, (root.PPPScoreGraphModules || {}).serialize); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, Z) {
  'use strict';

  const RECORD_VERSION = 1;
  const DB_NAME = 'ppp-engrave', DB_VERSION = 2, STORE_NAME = 'graphs', META_NAME = 'meta';
  /* records: songs kept; bytes: all records; record: one; share: the part of the origin's storage the cache may
     reach before it stops writing - the song videos (IndexedDB 'ppp-media') come first */
  /* timeout: the longest any one call to the backend may take (ms). IndexedDB `open` can stay pending for good (a
     blocked upgrade, a browser that never answers); no caller - resolve() before a render, persist() after a save -
     may wait on it for ever (G4a final review MINOR, closed in G4b). A call that runs out is named `timeout`. */
  const LIMITS = Object.freeze({ records: 200, bytes: 64 * 1024 * 1024, record: 16 * 1024 * 1024, share: 0.8, timeout: 2500 });

  /* p, or a rejection with code 'timeout' after ms; the timer never keeps a process alive */
  function within(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { const e = new Error('timeout'); e.code = 'timeout'; reject(e); }, ms);
      if (t && typeof t.unref === 'function') t.unref();
      Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }
  const timedOut = e => !!(e && e.code === 'timeout');

  const streams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' &&
    typeof Blob === 'function' && typeof Response === 'function';
  async function pipe(bytes, transform) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
  }
  const toText = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  /* the canonical text's UTF-8 bytes - the bytes SG.fingerprint hashes (serialize.js utf8), as a typed array */
  const toBytes = text => new TextEncoder().encode(text);

  /* text: the canonical serialisation when the caller already has it (source.js makes it once) */
  async function encode(graph, meta, opts) {
    meta = meta || {};
    const text = meta.text || SG.serialize(graph);
    const raw = toBytes(text);
    const gzip = (!opts || opts.compress !== false) && streams();
    const data = gzip ? await pipe(raw, new CompressionStream('gzip')) : raw;
    return {
      key: meta.key, v: RECORD_VERSION, lib: SG.version, sgv: graph.scoregraph_version,
      graphId: graph.id, rev: graph.rev, fp: Z.fnv1a64(raw),
      scoreId: meta.scoreId === undefined ? null : meta.scoreId, scoreHash: meta.scoreHash === undefined ? null : meta.scoreHash,
      hashV: meta.hashV === undefined ? null : meta.hashV, agreeLib: meta.agreeLib === undefined ? null : meta.agreeLib,
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
      /* the bytes are the ones kept, before anything reads them - whatever schema they are in */
      if (Z.fnv1a64(bytes) !== rec.fp) return { ok: false, code: 'fingerprint' };
      const text = toText(bytes);
      let graph;
      /* parse() migrates an older schema version and refuses a newer one (E-VERSION) */
      try { graph = SG.parse(text); } catch (e) { return { ok: false, code: e && e.code === 'E-VERSION' ? 'schema-version' : 'unreadable' }; }
      const res = SG.validate(graph);
      if (!res.ok) return { ok: false, code: 'invalid' };
      return { ok: true, graph: graph, migrated: rec.sgv !== graph.scoregraph_version };
    } catch (e) {
      return { ok: false, code: 'decode-failed' };
    }
  }

  /* ---------------------------------------------------------------- backends */
  /* get(key) -> record | null; put(record); del(key); sizes() -> [{key, stored, savedAt}] (never the data) */
  function memoryBackend() {
    const m = new Map();
    return {
      kind: 'memory',
      async get(key) { return m.has(key) ? m.get(key) : null; },
      async put(rec) { m.set(rec.key, rec); },
      async del(key) { m.delete(key); },
      async sizes() { return [...m.values()].map(r => ({ key: r.key, stored: r.stored || 0, savedAt: r.savedAt || 0 })); },
      _map: m
    };
  }
  const metaOf = rec => ({ key: rec.key, stored: rec.stored || 0, savedAt: rec.savedAt || 0 });
  /* opts.openTimeout (ms): how long `open` may stay pending before it counts as failed; the next call opens again */
  function idbBackend(idb, opts) {
    const openTimeout = (opts && opts.openTimeout) || LIMITS.timeout;
    let db = null;
    const open = () => {
      if (db) return db;
      db = new Promise((resolve, reject) => {
        let req, settled = false;
        const t = setTimeout(() => { settled = true; const e = new Error('timeout'); e.code = 'timeout'; reject(e); }, openTimeout);
        if (t && typeof t.unref === 'function') t.unref();
        /* the first answer settles the open; a connection that opens after a timeout or a block is closed, not kept */
        const finish = ok => {
          if (settled) { if (ok) { try { req.result.close(); } catch (e) { /* closed */ } } return false; }
          settled = true; clearTimeout(t); return true;
        };
        try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { settled = true; clearTimeout(t); reject(e); return; }
        req.onupgradeneeded = ev => {
          const d = req.result, t = req.transaction;
          if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'key' });
          if (!d.objectStoreNames.contains(META_NAME)) {
            const meta = d.createObjectStore(META_NAME, { keyPath: 'key' });
            /* a v1 database: its records' sizes go into the new store, one record at a time */
            if (ev.oldVersion >= 1) t.objectStore(STORE_NAME).openCursor().onsuccess = e => {
              const c = e.target.result;
              if (!c) return;
              meta.put(metaOf(c.value));
              c.continue();
            };
          }
        };
        req.onsuccess = () => {
          if (!finish(true)) return;
          const d = req.result;
          /* another tab opens a newer version: give way, and open again when next needed */
          d.onversionchange = () => { try { d.close(); } catch (e) { /* closed */ } db = null; };
          d.onclose = () => { db = null; };
          resolve(d);
        };
        req.onerror = () => { if (finish(false)) reject(req.error); };
        req.onblocked = () => { if (finish(false)) reject(new Error('blocked')); };
      });
      db.catch(() => { db = null; });
      return db;
    };
    const run = (stores, mode, fn) => open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const r = fn(t);
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
    return {
      kind: 'indexeddb',
      get(key) { return run([STORE_NAME], 'readonly', t => t.objectStore(STORE_NAME).get(key)).then(r => r || null); },
      /* the record and its size in one transaction: they cannot disagree */
      put(rec) { return run([STORE_NAME, META_NAME], 'readwrite', t => { t.objectStore(META_NAME).put(metaOf(rec)); return t.objectStore(STORE_NAME).put(rec); }); },
      del(key) { return run([STORE_NAME, META_NAME], 'readwrite', t => { t.objectStore(META_NAME).delete(key); return t.objectStore(STORE_NAME).delete(key); }); },
      sizes() { return run([META_NAME], 'readonly', t => t.objectStore(META_NAME).getAll()).then(r => r || []); }
    };
  }

  /* ------------------------------------------------------------------ store */
  /* opts.estimate: () => Promise<{usage, quota}> (navigator.storage.estimate in the page). The cache writes only
     while the origin stays under LIMITS.share of its quota, so it is never what fills the disk under the videos. */
  function createStore(opts) {
    opts = opts || {};
    const backend = opts.backend || memoryBackend();
    const limits = Object.assign({}, LIMITS, opts.limits || {});
    const now = opts.now || (() => Date.now());
    const stats = { puts: 0, gets: 0, hits: 0, dropped: {}, errors: {}, evicted: 0 };
    const count = (o, code) => { o[code] = (o[code] || 0) + 1; };

    /* the oldest records go first once there are too many or they take too much room; only sizes are read */
    async function evict(keep, keepStored) {
      const all = (await within(backend.sizes(), limits.timeout)).filter(r => r && r.key !== keep).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0) || (a.key < b.key ? -1 : 1));
      let total = all.reduce((s, r) => s + (r.stored || 0), 0) + (keepStored || 0), n = all.length + 1;
      for (const r of all) {
        if (n <= limits.records && total <= limits.bytes) break;
        await within(backend.del(r.key), limits.timeout);
        total -= r.stored || 0; n--;
        stats.evicted++;
        count(stats.dropped, 'evicted');
      }
    }
    async function roomFor(bytes) {
      if (typeof opts.estimate !== 'function') return true;
      try {
        const e = await opts.estimate();
        if (!e || !(e.quota > 0)) return true;
        return (e.usage || 0) + bytes <= e.quota * limits.share;
      } catch (err) { return true; }
    }

    return {
      backend: backend.kind,
      stats: stats,
      limits: limits,
      /* -> {ok, graph, migrated, record} | {ok:false, code} */
      async get(key) {
        stats.gets++;
        let rec;
        try { rec = await within(backend.get(key), limits.timeout); }
        catch (e) { count(stats.errors, timedOut(e) ? 'timeout' : 'get'); return { ok: false, code: timedOut(e) ? 'timeout' : 'backend' }; }
        if (!rec) return { ok: false, code: 'missing' };
        const d = await decode(rec);
        if (!d.ok) {
          count(stats.dropped, d.code);
          try { await within(backend.del(key), limits.timeout); } catch (e) { /* gone next time, or never read again */ }
          return { ok: false, code: d.code };
        }
        stats.hits++;
        return { ok: true, graph: d.graph, migrated: d.migrated, record: rec };
      },
      /* -> {ok, record} | {ok:false, code}. Only a producer's graph is kept: 'live' (it agreed with its Score when
         kept) or 'revalidated' (a kept one that agreed again under a newer library). A projection is refused - a
         lower-fidelity graph never takes the place of the one a file or a transcription made. */
      async put(key, graph, meta) {
        meta = meta || {};
        if (meta.via !== 'live' && meta.via !== 'revalidated') return { ok: false, code: 'not-live' };
        let rec;
        try { rec = await encode(graph, Object.assign({}, meta, { key: key, now: now() }), opts); }
        catch (e) { count(stats.errors, 'encode'); return { ok: false, code: 'encode' }; }
        if (rec.stored > limits.record) { count(stats.dropped, 'too-large'); return { ok: false, code: 'too-large' }; }
        if (!(await roomFor(rec.stored))) { count(stats.dropped, 'quota-guard'); return { ok: false, code: 'quota-guard' }; }
        try { await within(backend.put(rec), limits.timeout); await evict(key, rec.stored); }
        catch (e) {
          const quota = e && /quota/i.test((e.name || '') + ' ' + (e.message || ''));
          const code = timedOut(e) ? 'timeout' : quota ? 'quota' : 'backend';
          count(stats.errors, code === 'backend' ? 'put' : code);
          return { ok: false, code: code };
        }
        stats.puts++;
        return { ok: true, record: rec };
      },
      async del(key) { try { await within(backend.del(key), limits.timeout); return true; } catch (e) { return false; } },
      async keys() { try { return (await within(backend.sizes(), limits.timeout)).map(r => r.key).sort(); } catch (e) { return []; } }
    };
  }

  return Object.freeze({ RECORD_VERSION, DB_NAME, DB_VERSION, STORE_NAME, META_NAME, LIMITS, within, encode, decode, memoryBackend, idbBackend, createStore });
});
