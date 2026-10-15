/* PPP song sync, the engine (G13-S1; docs/GOALS/G13_PRODUCTIZATION.md section 7 and "G13-S1 as built").

   "Use my songs on other devices", with no account: a device holds a secret CODE (64 hex) that names a library on the site; the songs and the progress that follow a
   person between their devices live there as items (sync.js). This file is everything the page does to keep a device and its library the same, and nothing of how it looks
   (ui.js) or of what the rules are (merge.js). It holds no text a person reads: it reports codes and numbers and the page says them in the person's language.

   It needs from the page (`env`, so that Node tests it with fakes):
     storage    localStorage
     fetch      the browser's
     adapter    the live parts of the page: libraryRead / libraryWrite (the list of My Songs), openSongId, saveNow, frozen, readState / applyState (the counters and what is
                not one song's), applyOpenProgress (practice into the song on the screen), removeSongs (the page's own removal, with its cleanups), forgetThumbs
     copyTitle  (title) -> the title of a copy kept when two devices changed one score (the page's words)
   and optionally now, random, setTimeout, gzip / gunzip, indexedDB (the trash), visible(), online(), tabId, base (a url prefix).

   WHAT IT KEEPS (localStorage 'ppp.syncstate.v1'; never in a backup, never sent):
     { code, device, since, keys: { <item name>: rec }, removed, only, defer, gone, ctr, ctrAt, ctrRemote, writes, next, fail, ... }
     rec = { rev     the revision of the item this device last saw (a tombstone's too)
             hash    what the library had then
             lh      the content hash of THIS device's version when the two last agreed (what "changed here since" is told against)
             sh      the score hash then (the common point of the score rule)
             d       changed here since lh (to be sent)
             at      when it changed here
             fp      a cheap fingerprint of the stored text (unchanged text is not parsed again)
             del     the library has a tombstone for it
             id      this device's id for it when that is not the name's (a song that was already here under another name)
             only    kept on this device only
             bad     why it cannot be sent (a score the library will not take) }
   A CYCLE (syncNow): pull what changed (changes?since=), fetch and apply the bodies, scan this device's songs, send what changed in batches of 25, under the library's own
   limits (240 items an hour: a first sync of 500 songs waits 2 hours, by design - it runs in the background, resumes after a reload and never holds practice).

   WHAT IT NEVER DOES: put the code in a URL (it is a header, X-PPP-Lib), a log or a backup; remove a song of this device unless the person removed it somewhere and, for 4
   or more at once, said yes here; send songs the library has not heard of after a long absence without asking; loop (a few merges for a key a cycle, then backoff). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require('./merge.js'), require('../library-backup.js'));
  else root.PPPSyncClient = factory(root, root.PPPSyncMerge, null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, MERGE, BACKUP) {
  'use strict';

  const STATE_KEY = 'ppp.syncstate.v1';
  const LOCK_KEY = 'ppp.synclock.v1';
  const REMOVED_KEY = 'ppp.syncremoved.v1';     /* { <local id>: { at, key, title } }: songs the person removed that the library has not been told of */
  const SONG_KEY = 'ppp.song.v1.', DEMO = 'demo';
  const HOUR = 3600 * 1000, DAY = 24 * HOUR;
  /* the library's own limits as a client keeps them (sync.js LIMITS): 240 item writes an hour; this page stays a few below so that a refusal is the exception */
  const WRITES_PER_HOUR = 240, WRITE_MARGIN = 6, BATCH = 25, BATCH_GZIP = 3 * 1024 * 1024, READ_BATCH = 25;
  const POLL_MS = 5 * 60 * 1000, START_DELAY_MS = 2500, PUSH_DELAY_MS = 20 * 1000;
  const BACKOFF_MIN = 30 * 1000, BACKOFF_MAX = 15 * 60 * 1000, RETRY_AFTER_MAX = 2 * HOUR + 5 * 60 * 1000;
  const MERGE_ROUNDS = 3, PAGES_MAX = 40, TRASH_DAYS = 30, TRASH_MAX = 200, GUNZIP_MAX = 8 * 1024 * 1024;
  const CYCLE_LOCK_MS = 2 * 60 * 1000;
  const TRASH_DB = 'ppp-sync', TRASH_STORE = 'trash';

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const parse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  const CODE_RE = /^[0-9a-f]{64}$/;

  /* ---------------------------------------------------------------- codes and links (pure) */
  /* a code out of whatever a person pasted or scanned: the 64 hex (with spaces or dashes between the groups), or a link that has #lib=<code> in it. null when it is neither. */
  function parseCode(text) {
    let s = String(text == null ? '' : text).trim();
    const m = /[#&?]lib=([^&\s]+)/i.exec(s);
    if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
    s = s.replace(/[\s-]+/g, '').toLowerCase();
    return CODE_RE.test(s) ? s : null;
  }
  const groupCode = code => String(code).replace(/(.{8})(?=.)/g, '$1 ');
  /* the link a second device opens: the code is in the fragment, which no browser sends to a server. ?sync=on switches the beta on for that visit. */
  const linkFor = (origin, code) => String(origin || '').replace(/\/+$/, '') + '/?sync=on#lib=' + code;

  /* ---------------------------------------------------------------- bytes */
  function b64encode(u8) {
    if (typeof Buffer === 'function') return Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString('base64');
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64decode(text) {
    if (typeof Buffer === 'function') { const b = Buffer.from(String(text), 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.length); }
    const s = atob(String(text)), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  async function readAll(stream, max) {
    const reader = stream.getReader(), chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > max) { try { await reader.cancel(); } catch (e) { /* cancelled */ } return null; }
      chunks.push(r.value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    chunks.forEach(c => { out.set(c, at); at += c.length; });
    return out;
  }
  async function gzipDefault(u8) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    return readAll(cs.readable, Infinity);
  }
  async function gunzipDefault(u8, max) {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    try { return await readAll(ds.readable, max); } catch (e) { return null; }
  }
  const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  /* ---------------------------------------------------------------- errors */
  function apiError(status, body, headers) {
    const e = new Error('sync ' + status + (body && body.code ? ' ' + body.code : ''));
    e.status = status;
    e.code = body && typeof body.code === 'string' ? body.code : '';
    e.retryAfter = 0;
    const ra = headers && typeof headers.get === 'function' ? Number(headers.get('Retry-After')) : 0;
    if (isFinite(ra) && ra > 0) e.retryAfter = ra * 1000;
    return e;
  }
  const netError = cause => { const e = new Error('sync network'); e.status = 0; e.code = 'network'; e.cause = cause; e.retryAfter = 0; return e; };
  const errorName = e => (e && e.code) || (e && e.status === 0 ? 'offline' : 'server');

  /* ================================================================ the trash (Recently deleted): a song removed here or by another device is kept 30 days */
  function makeTrash(indexedDB, nowFn) {
    let dbp = null;
    const open = () => {
      if (!indexedDB) return Promise.reject(new Error('no indexedDB'));
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        let rq;
        try { rq = indexedDB.open(TRASH_DB, 1); } catch (e) { reject(e); return; }
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore(TRASH_STORE, { keyPath: 'tid' }); } catch (e) { /* made */ } };
        rq.onsuccess = () => { const db = rq.result; db.onversionchange = () => { try { db.close(); } catch (e) { /* closed */ } dbp = null; }; resolve(db); };
        rq.onerror = () => reject(rq.error || new Error('open failed'));
        rq.onblocked = () => reject(new Error('blocked'));
      }).catch(e => { dbp = null; throw e; });
      return dbp;
    };
    const run = (mode, fn) => open().then(db => new Promise((resolve, reject) => {
      let out;
      const t = db.transaction(TRASH_STORE, mode);
      const store = t.objectStore(TRASH_STORE);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error || new Error('transaction failed'));
      t.onabort = () => reject(t.error || new Error('aborted'));
      fn(store, v => { out = v; });
    }));
    const getAll = () => run('readonly', (store, set) => { const r = store.getAll(); r.onsuccess = () => set(r.result || []); });
    return {
      available: () => !!indexedDB,
      async put(entry) {
        const rows = await getAll().catch(() => []);
        const t = nowFn();
        const sorted = rows.filter(r => t - r.at < TRASH_DAYS * DAY).sort((a, b) => b.at - a.at);
        const keepIds = {};
        sorted.slice(0, TRASH_MAX - 1).forEach(r => { keepIds[r.tid] = true; });
        const drop = rows.filter(r => !keepIds[r.tid] && r.tid !== entry.tid).map(r => r.tid);
        await run('readwrite', store => { drop.forEach(k => store.delete(k)); store.put(entry); });
      },
      async list() {
        const t = nowFn();
        const rows = await getAll();
        return rows.filter(r => t - r.at < TRASH_DAYS * DAY).sort((a, b) => b.at - a.at);
      },
      get: tid => run('readonly', (store, set) => { const r = store.get(tid); r.onsuccess = () => set(r.result || null); }),
      del: tid => run('readwrite', store => { store.delete(tid); }),
      clear: () => run('readwrite', store => { store.clear(); })
    };
  }

  /* ================================================================ the engine */
  function create(env) {
    env = env || {};
    const storage = env.storage;
    const adapter = env.adapter || {};
    const M = env.merge || MERGE;
    const now = env.now || (() => Date.now());
    const rand = env.random || Math.random;
    const doFetch = env.fetch || (typeof fetch === 'function' ? fetch.bind(root) : null);
    const setT = env.setTimeout || ((f, ms) => setTimeout(f, ms)), clearT = env.clearTimeout || (t => clearTimeout(t));
    const gzip = env.gzip || gzipDefault, gunzip = env.gunzip || gunzipDefault;
    const base = env.base || '';
    const visible = env.visible || (() => true);
    const online = env.online || (() => true);
    const copyTitle = env.copyTitle || (t => String(t || ''));
    const tabId = env.tabId || (Math.random().toString(36).slice(2) + now().toString(36));
    const trash = env.trash || makeTrash(env.indexedDB === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : env.indexedDB, now);

    let S = null;                       /* the persisted state, read again at the start of every call that uses it */
    let running = null, again = false, timer = null, started = false, destroyed = false, lastCycleEnd = 0;
    const listeners = [];
    /* what is true now and is not kept: where a cycle is, what went wrong, what the person is being asked, what they should be told */
    const rt = { phase: 'idle', error: null, asks: [], notices: [], remoteApply: false, pulled: 0, pushed: 0, pullTotal: 0, waitUntil: 0 };

    /* ------------------------------------------------ state */
    const blank = (device, keep) => Object.assign({ v: 1, code: '', tag: '', device: device || '', since: 0, keys: {}, only: {}, defer: {}, gone: [], ctr: {}, ctrAt: {}, ctrRemote: {},
      writes: [], next: 0, fail: 0, mig: null, lastSyncAt: 0, keptUntil: '', createdAt: 0, joinedAt: 0, tooOld: 0, lib: null, okDeleteIn: false, okDeleteOut: false, okKeepGone: false }, keep || {});
    const newDevice = () => { let s = ''; for (let i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16); return s; };
    function load() {
      let d;
      try { d = parse(storage.getItem(STATE_KEY) || 'null'); } catch (e) { d = null; }
      if (!isObj(d) || d.v !== 1 || !isObj(d.keys)) d = blank('');
      ['only', 'ctr', 'ctrAt', 'ctrRemote', 'defer'].forEach(k => { if (!isObj(d[k])) d[k] = {}; });
      delete d.removed;
      if (!Array.isArray(d.writes)) d.writes = [];
      if (!Array.isArray(d.gone)) d.gone = [];
      if (typeof d.device !== 'string' || !/^[0-9a-f]{16}$/.test(d.device)) d.device = newDevice();
      if (typeof d.code !== 'string' || (d.code && !CODE_RE.test(d.code))) d.code = '';
      return d;
    }
    function save() {
      try { storage.setItem(STATE_KEY, JSON.stringify(S)); return true; } catch (e) { rt.error = 'storage'; return false; }
    }
    const rec = key => S.keys[key] || (S.keys[key] = {});
    /* the state is read again at the start of a call unless a cycle is running (then it is the cycle's, and the call changes what the cycle holds) */
    const cur = () => { if (!(running && S)) S = load(); return S; };
    /* the removals the person made have a key of their own: a save of the state cannot lose one that another tab (or this one, in the middle of a cycle) wrote */
    const removedMap = () => { const d = parse(storage.getItem(REMOVED_KEY) || 'null'); return isObj(d) ? d : {}; };
    const removedPut = (id, v) => { const m = removedMap(); m[id] = v; try { storage.setItem(REMOVED_KEY, JSON.stringify(m)); } catch (e) { /* the song comes back from the library */ } };
    const removedDel = id => { const m = removedMap(); if (has(m, id)) { delete m[id]; try { storage.setItem(REMOVED_KEY, JSON.stringify(m)); } catch (e) { /* stays, and is asked about again */ } } };
    /* a tombstone is known for this item (its revision); when this device learnt it is kept, and it is forgotten after the library has surely purged it (30 days) */
    const tomb = (r, rev) => { if (isNum(rev) && rev) r.rev = rev; r.hash = ''; r.del = 1; r.d = 0; r.lh = ''; r.fp = ''; r.delAt = now(); };
    function emit() {
      const snap = status();
      listeners.slice().forEach(f => { try { f(snap); } catch (e) { /* a listener's problem */ } });
    }
    const notice = n => { rt.notices.push(Object.assign({ at: now() }, n)); if (rt.notices.length > 30) rt.notices.shift(); };

    /* ------------------------------------------------ the page */
    const libOf = () => (adapter.libraryRead ? adapter.libraryRead() : { songs: [], current: DEMO, demo: null });
    const openId = () => (adapter.openSongId ? adapter.openSongId() : DEMO);
    const frozen = () => !!(adapter.frozen && adapter.frozen());
    let _idKey = null;
    const keyForId = id => {
      if (!_idKey) { _idKey = {}; Object.keys(S.keys).forEach(k => { const r = S.keys[k]; if (r && typeof r.id === 'string') _idKey[r.id] = k; }); }
      return _idKey[id] || M.keyOf(id);
    };
    const idForKey = key => (S.keys[key] && typeof S.keys[key].id === 'string' ? S.keys[key].id : M.idOf(key));
    const resetIdKey = () => { _idKey = null; };
    const slotRaw = id => { try { return storage.getItem(SONG_KEY + id); } catch (e) { return null; } };
    const fpOf = (raw, card) => M.hashText(raw) + ':' + M.hashText(JSON.stringify(card));
    /* the secrets of this browser and of this library: never in an item (the second wall; the first is that a slot and a card hold none) */
    function secrets() {
      const out = [];
      try {
        ['ppp.pclink.v1', 'ppp.pclink.prev.v1'].forEach(k => { const v = parse(storage.getItem(k) || 'null'); if (isObj(v) && typeof v.code === 'string' && v.code.length >= 16) out.push(v.code); });
        const g = storage.getItem('ppp-guest-key');
        if (typeof g === 'string' && g.length >= 16) out.push(g);
      } catch (e) { /* none */ }
      if (S && S.code) out.push(S.code);
      return out;
    }

    /* ------------------------------------------------ the network */
    async function request(method, path, o) {
      o = o || {};
      if (!doFetch) throw netError(new Error('no fetch'));
      const headers = {};
      const code = o.code !== undefined ? o.code : (S && S.code);
      if (code) headers['X-PPP-Lib'] = code;
      if (o.recovery) headers['X-PPP-Recovery'] = o.recovery;
      let body;
      if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body); }
      /* a request that does not answer is a failed request: a cold server may take half a minute, a body of megabytes on a slow line two minutes; no more than that holds a cycle */
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setT(() => { try { ctl.abort(); } catch (e) { /* done */ } }, o.timeout || (method === 'PUT' ? 120000 : 45000)) : null;
      let res, json = null;
      try {
        try {
          res = await doFetch(base + path, { method: method, headers: headers, body: body, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: !!o.keepalive, signal: ctl ? ctl.signal : undefined });
        } catch (e) { throw netError(e); }
        try { json = await res.json(); } catch (e) { json = null; }
      } finally { if (timer !== null && timer !== undefined) clearT(timer); }
      if (res.ok || (res.status === 409 && o.allow409)) return { status: res.status, body: isObj(json) ? json : {} };
      throw apiError(res.status, json, res.headers);
    }

    /* ------------------------------------------------ one song, here */
    function localItem(card, raw, at) {
      const slot = parse(raw);
      if (!isObj(slot)) return null;
      return M.buildSongItem(card, slot, at);
    }
    /* Write songs: the slot of each first, then the list once (a card never lists a song with nothing behind it). An entry with text null changes only its card (the song on
       the screen: the page writes that slot itself). false, with everything put back, when the storage refuses. */
    function writeSongs(entries) {
      const written = [];
      const undo = () => written.forEach(w => { try { if (w.before === null || w.before === undefined) storage.removeItem(SONG_KEY + w.id); else storage.setItem(SONG_KEY + w.id, w.before); } catch (e2) { /* not written */ } });
      try {
        entries.forEach(e => { if (typeof e.text === 'string') { storage.setItem(SONG_KEY + e.id, e.text); written.push(e); } });
      } catch (err) { undo(); return false; }
      const l = adapter.libraryRead();
      const songs = l.songs.slice();
      entries.forEach(e => {
        const i = songs.findIndex(c => isObj(c) && c.id === e.id);
        if (i >= 0) songs[i] = e.card;
        else {
          /* newest first, as the page lists them: before the first card that was added earlier */
          let at = songs.findIndex(c => isObj(c) && isNum(c.addedAt) && isNum(e.card.addedAt) && c.addedAt < e.card.addedAt);
          if (at < 0) at = songs.length;
          songs.splice(at, 0, e.card);
        }
      });
      if (adapter.libraryWrite(Object.assign({}, l, { songs: songs })) === false) { undo(); return false; }
      return true;
    }
    async function trashPut(id, card, raw, kind) {
      if (!raw || !isObj(card)) return false;
      try {
        await trash.put({ tid: id + '@' + now(), id: id, key: keyForId(id), title: typeof card.title === 'string' ? card.title : '', at: now(), kind: kind, card: card, slot: raw });
        return true;
      } catch (e) { return false; }
    }

    /* ------------------------------------------------ pulling */
    /* the bodies of these metas (rows of a listing), 25 keys a request. -> { <key>: { meta, body } } (body null for a tombstone) */
    async function fetchBodies(metas) {
      const out = {};
      for (let i = 0; i < metas.length; i += READ_BATCH) {
        let want = metas.slice(i, i + READ_BATCH).map(m => m.key);
        for (let round = 0; round < 3 && want.length; round++) {
          const r = await request('GET', '/api/sync/items?keys=' + want.map(encodeURIComponent).join(','));
          const items = Array.isArray(r.body.items) ? r.body.items : [];
          want = [];
          for (const it of items) {
            if (!isObj(it) || typeof it.key !== 'string') continue;
            if (it.deferred) { want.push(it.key); continue; }
            out[it.key] = { meta: it, body: it.deleted || typeof it.body !== 'string' ? null : it.body };
          }
        }
      }
      return out;
    }
    async function decodeBody(b64) {
      let plain;
      try { plain = await gunzip(b64decode(b64), GUNZIP_MAX); } catch (e) { plain = null; }
      if (!plain) return { ok: false, code: 'not-gzip' };
      let obj;
      try { obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } catch (e) { return { ok: false, code: 'not-json' }; }
      return { ok: true, obj: obj };
    }
    /* bodies -> checked items; what cannot be read is remembered (its name, why) and is not asked for again until its hash changes */
    async function itemsOf(metas, bodies) {
      const good = [];
      for (const m of metas) {
        const x = bodies[m.key];
        if (!x || !x.body) continue;
        const r = rec(m.key);
        const d = await decodeBody(x.body);
        const c = d.ok ? M.checkIncoming(m.key, d.obj) : d;
        if (!c.ok) { r.rev = m.rev; r.hash = m.hash; r.bad = c.code; notice({ code: 'unreadable', key: m.key, why: c.code }); continue; }
        good.push({ meta: m, item: c.item });
      }
      return good;
    }

    /* the identity index of the songs that are not yet linked to an item of the library: identity -> local id. Made once a cycle (a join of 500 songs would otherwise parse every
       unlinked slot again for each batch of 25); a song that is linked leaves it. */
    let _identCache = null;
    function identityIndex() {
      if (_identCache) return _identCache;
      const idx = _identCache = {};
      libOf().songs.forEach(c => {
        if (!isObj(c) || typeof c.id !== 'string' || c.id === DEMO) return;
        const r = S.keys[keyForId(c.id)];
        if (r && r.rev) return;
        const raw = slotRaw(c.id);
        const slot = raw ? parse(raw) : null;
        if (!isObj(slot) || !isObj(slot.score)) return;
        M.identityKeys(c, M.scoreHashOf(slot)).forEach(k => { if (!has(idx, k)) idx[k] = c.id; });
      });
      return idx;
    }

    /* Apply a batch of songs that arrived to this device, in one synchronous block (what is read and what is written see no other turn of the page).
       got: [{ meta, item }]. -> { applied, deferred: [meta], copies: [{id, title, kept}], failed } */
    function applySongs(got) {
      const res = { applied: 0, deferred: [], copies: [], failed: false };
      const l0 = adapter.libraryRead();
      const cards = {};
      l0.songs.forEach(c => { if (isObj(c) && typeof c.id === 'string') cards[c.id] = c; });
      const open = openId();
      const t = now();
      const plan = [];       /* { id, text|null, card, before, key, patch, mapped, item, openOnly } */
      const taken = {};
      const arranged = c => { if (typeof c.arrangedFrom === 'string') c.arrangedFrom = idForKey(M.keyOf(c.arrangedFrom)) || c.arrangedFrom; return c; };
      got.forEach(g => {
        const key = g.meta.key, remote = g.item;
        const known = S.keys[key];
        const linked = !!(known && known.rev);
        let id = known && typeof known.id === 'string' ? known.id : M.idOf(key);
        if (!linked && !cards[id] && slotRaw(id) === null) {
          /* nothing here under that name: the same song may be here under another (the same score, the same method-book piece, the same shared score) */
          const ident = identityIndex();
          const hit = M.identityKeys(remote.card, remote.scoreHash).map(k => ident[k]).find(Boolean);
          if (hit && !taken[hit]) { id = hit; Object.keys(ident).forEach(k => { if (ident[k] === hit) delete ident[k]; }); }
        }
        if (!linked && cards[id] && keyForId(id) !== key && S.keys[keyForId(id)] && S.keys[keyForId(id)].rev) id = 'song-r' + M.hashText(key).slice(1, 15);   /* another item's id */
        if (taken[id]) return;
        const mapped = id !== M.idOf(key);
        const patch = { rev: g.meta.rev, hash: g.meta.hash, sh: remote.scoreHash, del: 0, d: 0, at: remote.savedAt || t };
        if (S.only[id]) { const r = rec(key); r.rev = g.meta.rev; r.hash = g.meta.hash; return; }   /* kept on this device only */
        const card = cards[id] || null;
        const raw = slotRaw(id);
        if (!card || raw === null) {
          /* new here, or a card whose slot is gone: the library's copy comes back (what the person removed here and the library changed since is brought back too) */
          removedDel(id);
          const c = arranged(M.cardOfItem(remote, id, card));
          plan.push({ id: id, text: JSON.stringify(M.slotOfItem(remote)), card: c, before: raw, key: key, patch: patch, mapped: mapped, item: remote });
          taken[id] = true;
          return;
        }
        const r0 = S.keys[key] || {};
        const L = localItem(card, raw, r0.at || 0);
        if (!L) { const r = rec(key); r.rev = g.meta.rev; r.hash = g.meta.hash; r.bad = 'local-unreadable'; return; }
        const lh = M.contentHash(L);
        const changedHere = !(linked && r0.lh === lh);
        const isOpen = open === id;
        if (!changedHere) {
          /* nothing of this device's is newer than what it last agreed on: the library's version is taken */
          if (M.contentHash(remote) === lh) { const r = rec(key); Object.assign(r, patch, { lh: lh, fp: fpOf(raw, card) }); if (mapped) r.id = id; return; }
          if (isOpen && L.scoreHash !== remote.scoreHash) { res.deferred.push(g.meta); return; }
          const c = arranged(M.cardOfItem(remote, id, card));
          if (isOpen) {
            /* the song on the screen keeps its score; the practice goes into what the page holds (which is what it saves), and its card follows */
            if (adapter.applyOpenProgress) adapter.applyOpenProgress(remote.progress);
            plan.push({ id: id, text: null, card: c, before: raw, key: key, patch: Object.assign({}, patch, { lh: M.contentHash(remote) }), mapped: mapped, item: remote, openOnly: true });
          } else {
            plan.push({ id: id, text: JSON.stringify(M.slotOfItem(remote)), card: c, before: raw, key: key, patch: patch, mapped: mapped, item: remote });
          }
          taken[id] = true;
          return;
        }
        /* both have something the other has not: the rules of merge.js */
        const merged = M.mergeSong(L, remote, known && known.sh ? { sh: known.sh } : null, key);
        if (isOpen && merged.scoreFrom === 'remote') { res.deferred.push(g.meta); return; }
        const mItem = merged.item;
        const c = arranged(M.cardOfItem(mItem, id, card));
        const same = M.contentHash(mItem) === g.meta.hash;       /* what merges to exactly the library's version needs no sending */
        const p2 = Object.assign({}, patch, { at: Math.max(mItem.savedAt || 0, (known && known.at) || 0) }, same ? {} : { d: 1, lh: '' });
        if (isOpen) {
          if (adapter.applyOpenProgress) adapter.applyOpenProgress(mItem.progress);
          /* the page holds the merge now and will save it: until its slot changes nothing is to be sent (the stored text is the old one); what it saves is then compared with the library's version */
          plan.push({ id: id, text: null, card: c, before: raw, key: key, patch: Object.assign({}, p2, { d: 0, lh: M.contentHash(remote) }), mapped: mapped, item: mItem, openOnly: true });
        } else {
          plan.push({ id: id, text: JSON.stringify(M.slotOfItem(mItem)), card: c, before: raw, key: key, patch: p2, mapped: mapped, item: mItem });
        }
        taken[id] = true;
        if (merged.fork) {
          const fid = merged.fork.id;
          if (!cards[fid] && slotRaw(fid) === null && !taken[fid]) {
            const fc = M.cardOfItem(merged.fork.item, fid, null);
            fc.title = copyTitle(typeof fc.title === 'string' ? fc.title : '');
            plan.push({ id: fid, text: JSON.stringify(M.slotOfItem(merged.fork.item)), card: fc, before: null, key: M.keyOf(fid), patch: { d: 1, lh: '', at: t, sh: merged.fork.item.scoreHash, rev: 0, hash: '' }, mapped: false, item: merged.fork.item });
            taken[fid] = true;
            res.copies.push({ id: fid, title: fc.title, kept: merged.fork.keptSide });
          }
        }
      });
      if (!plan.length) return res;
      if (!writeSongs(plan.map(p => ({ id: p.id, text: p.text, card: p.card, before: p.before })))) { res.failed = true; res.copies = []; return res; }
      resetIdKey();
      plan.forEach(p => {
        const r = rec(p.key);
        Object.assign(r, p.patch);
        if (p.mapped) { r.id = p.id; const own = M.keyOf(p.id); if (own !== p.key && S.keys[own] && !S.keys[own].rev) delete S.keys[own]; }
        const rawNow = slotRaw(p.id);
        r.fp = rawNow === null ? '' : fpOf(rawNow, p.card);
        if (!p.patch.d && !('lh' in p.patch)) r.lh = M.contentHash(p.item);
        res.applied++;
      });
      if (adapter.forgetThumbs) { try { adapter.forgetThumbs(plan.map(p => p.id)); } catch (e) { /* a cache */ } }
      return res;
    }

    /* ------------------------------------------------ the progress that is not one song's */
    /* this device's state item now (the counters moved on first). The entries of the other devices are the library's last. */
    function localStateItem(cur, at) {
      cur = isObj(cur) ? cur : {};
      const item = { v: 1 };
      const ctr = {};
      M.COUNTERS.forEach(f => {
        const before = S.ctr[f];
        const a = M.ctrAdvance(before, cur[f]);
        if (!before || before.own !== a.own || !isNum(S.ctrAt[f])) S.ctrAt[f] = at;
        S.ctr[f] = a;
        const e = isObj(S.ctrRemote[f]) ? Object.assign({}, S.ctrRemote[f]) : {};
        e[S.device] = { v: a.own, at: S.ctrAt[f] };
        ctr[f] = e;
      });
      item.ctr = ctr;
      ['sessions', 'streak', 'skillMs', 'learnDone', 'learnLesson', 'learnStep', 'course'].forEach(k => { if (cur[k] !== undefined) item[k] = cur[k]; });
      /* the sample's practice (it is rebuilt from code: only what was practised travels) */
      try {
        const raw = slotRaw(DEMO), slot = raw ? parse(raw) : null;
        if (isObj(slot)) { const p = M.slotProgress(slot); if (Object.keys(p).length) item.demo = p; }
        const l = adapter.libraryRead();
        if (isObj(l.demo)) item.demoCard = { prog: l.demo.prog, mem: l.demo.mem, lastAt: l.demo.lastAt };
      } catch (e) { /* the sample has nothing to say */ }
      item.savedAt = (S.keys.state && S.keys.state.at) || at;
      return item;
    }
    /* the cross-song progress of the library arrives: merged with this device's and applied to the page in one block */
    function applyState(remote, meta) {
      const cur = adapter.readState ? adapter.readState() : null;
      if (!isObj(cur)) return false;
      if (isObj(remote.ctr)) S.ctrRemote = M.ctrMerge(S.ctrRemote, remote.ctr);
      const local = localStateItem(cur, now());
      const merged = M.mergeStateItems(local, remote);
      const patch = {};
      M.COUNTERS.forEach(f => {
        const total = M.ctrTotal(merged.ctr, f);
        if (isNum(total) && total !== cur[f]) patch[f] = total;
        S.ctr[f] = { own: S.ctr[f].own, seen: isNum(patch[f]) ? patch[f] : cur[f] };
      });
      ['sessions', 'streak', 'skillMs', 'learnDone', 'learnLesson', 'learnStep', 'course'].forEach(k => {
        if (merged[k] !== undefined && M.stable(merged[k]) !== M.stable(cur[k])) patch[k] = merged[k];
      });
      if (Object.keys(patch).length && adapter.applyState) adapter.applyState(patch);
      if (isObj(merged.demo) && openId() !== DEMO) {
        const raw = slotRaw(DEMO), cur0 = raw ? parse(raw) : null;
        const text = JSON.stringify(Object.assign({ score: null }, merged.demo));
        if (text !== raw && !(isObj(cur0) && M.stable(M.slotProgress(cur0)) === M.stable(merged.demo))) { try { storage.setItem(SONG_KEY + DEMO, text); } catch (e) { /* the sample's progress is not worth a refusal */ } }
      }
      if (isObj(merged.demoCard) && openId() !== DEMO) {
        const l = adapter.libraryRead(), d = isObj(l.demo) ? l.demo : {};
        const next = Object.assign({}, d, { prog: merged.demoCard.prog, mem: merged.demoCard.mem, lastAt: merged.demoCard.lastAt });
        if (isNum(next.lastAt) && M.stable(next) !== M.stable(d)) adapter.libraryWrite(Object.assign({}, l, { demo: next }));
      }
      const r = rec('state');
      r.rev = meta.rev; r.hash = meta.hash; r.lh = meta.hash; r.at = Math.max(r.at || 0, remote.savedAt || 0); r.del = 0;
      return true;
    }
    function stateDirty() {
      const cur = adapter.readState ? adapter.readState() : null;
      if (!isObj(cur)) return null;
      const r = rec('state');
      const item = localStateItem(cur, now());
      const h = M.contentHash(item);
      if (r.lh !== h) { if (r.curH !== h) r.at = now(); r.curH = h; r.d = 1; } else r.d = 0;
      return { item: item, hash: h, dirty: !!r.d };
    }

    /* ------------------------------------------------ the cycle: pull */
    async function pull() {
      let since = S.since;
      const listing = [];
      let pages = 0, library = null, reset = false, full = S.since === 0;
      for (;;) {
        if (++pages > PAGES_MAX) break;
        const r = await request('GET', '/api/sync/changes?since=' + since);
        const b = r.body;
        if (isObj(b.library)) library = b.library;
        if (b.reset && !reset) {
          /* the library is older than this device thinks (a restored database): what is known of its revisions is forgotten; the hashes of this device's own versions stay, so
             what is the same is recognised and what is not is sent again */
          reset = true;
          Object.keys(S.keys).forEach(k => { const x = S.keys[k]; x.rev = 0; x.hash = ''; x.del = 0; });
          S.since = 0; since = 0; full = true; listing.length = 0;
          notice({ code: 'reset' });
          continue;
        }
        if (b.tooOld && since > 0) {
          /* deletions may have been missed: the whole library is listed, so that what this device has and the library has not can be told */
          S.tooOld = b.purgedThrough | 0; since = 0; full = true; listing.length = 0;
          continue;
        }
        (Array.isArray(b.items) ? b.items : []).forEach(m => { if (isObj(m) && typeof m.key === 'string') listing.push(m); });
        since = isNum(b.nextSince) ? b.nextSince : (isNum(b.maxRev) ? b.maxRev : since);
        if (!b.more) break;
      }
      if (library) setLibrary(library);
      return { listing: listing, since: since, full: full };
    }
    function setLibrary(l) {
      S.lib = { bytes: l.bytes | 0, items: l.items | 0, capBytes: l.capBytes | 0, maxItems: l.maxItems | 0 };
      if (typeof l.keptUntil === 'string') S.keptUntil = l.keptUntil;
      if (typeof l.tag === 'string') S.tag = l.tag;
    }

    /* the listing (and what an open song made wait) -> bodies fetched and applied; tombstones applied or asked about. -> { stop, held } */
    async function applyListing(pl, asks) {
      const byKey = {};
      Object.keys(S.defer).forEach(k => { byKey[k] = S.defer[k]; });
      pl.listing.forEach(m => { byKey[m.key] = m; });
      const toFetch = [], tombs = [];
      Object.keys(byKey).forEach(key => {
        const m = byKey[key], r = S.keys[key];
        if (m.deleted) {
          if (r && r.del && r.rev === m.rev) { delete S.defer[key]; return; }
          tombs.push(m);
        } else if (r && !r.del && !r.bad && r.hash === m.hash && r.rev) {
          r.rev = m.rev; delete S.defer[key];
        } else if (r && r.bad && r.hash === m.hash) {
          delete S.defer[key];
        } else toFetch.push(m);
      });
      rt.pullTotal = toFetch.length;
      for (let i = 0; i < toFetch.length; i += READ_BATCH) {
        if (destroyed || frozen()) return { stop: true };
        const part = toFetch.slice(i, i + READ_BATCH);
        const bodies = await fetchBodies(part);
        const good = await itemsOf(part, bodies);
        const songs = [];
        good.forEach(g => {
          if (g.meta.key === 'state') { applyState(g.item, g.meta); delete S.defer.state; } else songs.push(g);
        });
        if (songs.length) {
          const r = applySongs(songs);
          if (r.failed) { rt.error = 'storage'; return { stop: true }; }
          songs.forEach(g => { delete S.defer[g.meta.key]; });
          r.deferred.forEach(m => { S.defer[m.key] = m; });
          r.copies.forEach(c => notice({ code: 'copy', id: c.id, title: c.title, kept: c.kept }));
          rt.pulled += r.applied;
        }
        part.forEach(m => { if (!bodies[m.key]) delete S.defer[m.key]; });   /* not there any more (removed, then purged) */
        save();
        emit();
      }
      const held = tombs.length ? await applyTombstones(tombs, asks) : false;
      return { stop: false, held: held };
    }

    /* Deletions that arrive: a song removed on another device. One this device has not changed goes (to the trash, 30 days; 4 or more at once only after a yes); one it
       changed stays and is sent back over the tombstone. -> true when a question holds the cursor */
    async function applyTombstones(tombs, asks) {
      const cards = {};
      adapter.libraryRead().songs.forEach(c => { if (isObj(c) && typeof c.id === 'string') cards[c.id] = c; });
      const go = [];
      tombs.forEach(m => {
        const r = rec(m.key);
        if (m.key === 'state') { tomb(r, m.rev); return; }
        const id = idForKey(m.key), card = cards[id];
        delete S.defer[m.key];
        if (!card) { tomb(r, m.rev); removedDel(id); return; }
        if (S.only[id]) { tomb(r, m.rev); return; }
        const raw = slotRaw(id);
        const L = raw ? localItem(card, raw, r.at || 0) : null;
        const changed = r.d === 1 || (!!L && !(r.rev && r.lh === M.contentHash(L)));
        if (changed) {
          /* an edit beats a deletion: the song stays and is sent again over the tombstone's revision */
          tomb(r, m.rev); r.d = 1;
          notice({ code: 'kept', title: card.title || '', key: m.key });
          return;
        }
        if (openId() === id) { S.defer[m.key] = m; return; }       /* not under the person's hands: when they leave it */
        go.push({ key: m.key, id: id, card: card, raw: raw, title: card.title || '', rev: m.rev });
      });
      if (!go.length) return false;
      const total = Object.keys(cards).length;
      /* the yes of the person is for the songs they were asked about: others that came since are asked about as well */
      const okKeys = Array.isArray(S.okDeleteIn) ? S.okDeleteIn : [];
      S.okDeleteIn = false;
      const rest = go.filter(x => okKeys.indexOf(x.key) < 0);
      const held = rest.length > 0 && M.needsAsk(rest.length, total);
      if (held) asks.push({ kind: 'delete-in', n: rest.length, total: total, titles: rest.slice(0, 8).map(x => x.title), keys: rest.map(x => x.key), revs: rest.map(x => x.rev) });
      const doNow = held ? go.filter(x => okKeys.indexOf(x.key) >= 0) : go;
      if (doNow.length) await removeHere(doNow, 'remote');
      return held;
    }
    async function removeHere(all, why) {
      /* nothing is removed here that could not be kept for 30 days: a browser that cannot hold the copy (a private window, a full disk) keeps the song and says so */
      const list = [];
      for (const x of all) {
        if (!x.raw || await trashPut(x.id, x.card, x.raw, why)) { list.push(x); continue; }
        S.only[x.id] = 1;
        tomb(rec(x.key), x.rev);
        notice({ code: 'not-removed', title: x.title || '' });
      }
      if (!list.length) return;
      rt.remoteApply = true;
      try { if (adapter.removeSongs) adapter.removeSongs(list.map(x => x.id), { keepVideo: true }); } finally { rt.remoteApply = false; }
      list.forEach(x => {
        tomb(rec(x.key), x.rev);
        removedDel(x.id);
      });
      resetIdKey();
      notice({ code: 'removed', n: list.length, why: why });
    }

    /* ------------------------------------------------ the cycle: scan and push */
    /* this device's songs against what was last agreed -> { dirty, removed, vanished } */
    function scan() {
      const t = now();
      const dirty = [], seen = {};
      const open = openId();
      adapter.libraryRead().songs.forEach(card => {
        if (!isObj(card) || typeof card.id !== 'string' || card.id === DEMO) return;
        const id = card.id, key = keyForId(id);
        seen[key] = true;
        if (S.only[id]) return;
        const raw = slotRaw(id);
        if (raw === null) return;
        const r = rec(key);
        const fp = fpOf(raw, card);
        if (r.fp !== fp) {
          const it = localItem(card, raw, t);
          if (!it || !isObj(it.score) || !Array.isArray(it.score.measures) || !it.score.measures.length) { r.bad = 'no-score'; r.fp = fp; return; }
          /* an id the library would not take as it is (too long, other characters) is named by a hash: the id is kept with it, so that the name finds the song again */
          if (key !== 'song:' + id) r.id = id;
          if (r.bad === 'no-score') delete r.bad;
          if (r.lh !== M.contentHash(it)) { r.d = 1; r.at = t; } else r.d = 0;
          r.fp = fp;
        }
        if (r.d && !r.bad) dirty.push({ key: key, id: id, card: card, open: open === id });
      });
      /* a song the library has (an item with a revision here) and My Songs has not: removed by the person (the page told: the removed map), or lost (it comes back) */
      const removed = [], vanished = [], rm = removedMap();
      Object.keys(S.keys).forEach(key => {
        if (key === 'state' || seen[key]) return;
        const r = S.keys[key];
        if (!r) return;
        /* a tombstone is remembered while the library has it (30 days) and a little longer; a song that was never sent and has no card is nothing */
        if (r.del && isNum(r.delAt) && t - r.delAt > 35 * DAY) { delete S.keys[key]; return; }
        if (!r.rev && !r.del) { delete S.keys[key]; return; }
        const id = idForKey(key);
        if (!r.rev || r.del || S.only[id]) return;
        if (rm[id]) removed.push({ key: key, id: id, rev: r.rev });
        else if (r.hash && !r.bad) vanished.push(key);
      });
      return { dirty: dirty, removed: removed, vanished: vanished };
    }

    const writesUsed = t => { S.writes = S.writes.filter(x => t - x < HOUR); return S.writes.length; };
    const writeRoom = t => Math.max(0, WRITES_PER_HOUR - WRITE_MARGIN - writesUsed(t));

    async function bodyOf(item) {
      const text = JSON.stringify(item);
      if (secrets().some(s => text.indexOf(s) >= 0)) { const e = new Error('a secret of this browser is in an item'); e.code = 'secret-in-item'; throw e; }
      return b64encode(await gzip(new TextEncoder().encode(text)));
    }

    /* send a list of { key, item, hash, localHash, base } in batches of 25 -> { sent, conflicts, gone, stopped, bad } */
    async function pushItems(list, keepalive) {
      const out = { sent: 0, conflicts: [], gone: [], stopped: null, bad: 0 };
      let i = 0;
      while (i < list.length) {
        if (destroyed || frozen()) { out.stopped = 'frozen'; break; }
        const room = writeRoom(now());
        if (room <= 0) { out.stopped = 'budget'; break; }
        const part = [], bodies = [];
        let gzBytes = 0;
        while (i < list.length && part.length < Math.min(BATCH, room)) {
          const x = list[i];
          let b64;
          try { b64 = await bodyOf(x.item); } catch (e) { const r = rec(x.key); r.bad = e.code || 'unreadable'; out.bad++; i++; continue; }
          if (part.length && gzBytes + b64.length * 0.75 > BATCH_GZIP) break;
          gzBytes += b64.length * 0.75;
          part.push(x); bodies.push(b64);
          i++;
        }
        if (!part.length) continue;
        const req = { device: S.device, items: part.map((x, j) => ({ key: x.key, baseRev: x.base | 0, hash: x.hash, body: bodies[j] })) };
        let r;
        try {
          r = await request('PUT', '/api/sync/items', { body: req, allow409: true, keepalive: !!keepalive && gzBytes < 48 * 1024 });
        } catch (e) {
          if ((e.status === 422 || e.status === 413) && part.length > 1) {
            /* one item of the batch is refused, and the batch with it: they are sent singly to find it */
            for (const x of part) {
              const one = await pushItems([x], keepalive);
              out.sent += one.sent; out.conflicts = out.conflicts.concat(one.conflicts); out.gone = out.gone.concat(one.gone); out.bad += one.bad;
              if (one.stopped) { out.stopped = one.stopped; break; }
            }
            if (out.stopped) break;
            continue;
          }
          if (e.status === 422 || e.status === 413) { const rr = rec(part[0].key); rr.bad = e.code || String(e.status); out.bad++; continue; }
          throw e;
        }
        const b = r.body;
        if (isObj(b.library)) setLibrary(b.library);
        const sentBy = {};
        part.forEach(x => { sentBy[x.key] = x; });
        const done = (key, rev, x) => {
          const rr = rec(key);
          rr.rev = rev; rr.hash = x.hash; rr.lh = x.localHash; rr.sh = x.item.scoreHash; rr.del = 0; rr.d = 0; rr.fp = '';
          delete rr.bad;
          out.sent++;
        };
        const appliedList = Array.isArray(b.applied) ? b.applied : [];
        appliedList.forEach(a => {
          const x = isObj(a) ? sentBy[a.key] : null;
          if (!x) return;
          done(a.key, a.rev, x);
          S.writes.push(now());
        });
        /* the revisions that were just made are the next ones after the cursor and the library has nothing after them: the cursor moves to them (a poll then costs the library no
           statement), else the next listing names them and is skipped over by their hashes */
        const revs = appliedList.map(a => a && a.rev).filter(isNum).sort((p, q) => p - q);
        if (revs.length && !(Array.isArray(b.conflicts) && b.conflicts.length) && isNum(b.maxRev) && revs[0] === S.since + 1 && revs[revs.length - 1] === b.maxRev && revs.length === b.maxRev - S.since) S.since = b.maxRev;
        (Array.isArray(b.conflicts) ? b.conflicts : []).forEach(c => {
          const x = isObj(c) ? sentBy[c.key] : null;
          if (!x) return;
          if (c.gone) { out.gone.push(c.key); return; }
          /* the answer to an earlier try was lost: the library has exactly this, so it is applied */
          if (c.hash && c.hash === x.hash && !c.deleted && !c.stale) { done(c.key, c.rev, x); return; }
          out.conflicts.push(c);
        });
        save();
        rt.pushed += part.length;
        emit();
      }
      return out;
    }

    async function push(keepalive) {
      const t = now();
      const sc = scan();
      const st = stateDirty();
      const list = [];
      if (st && st.dirty) {
        const r = rec('state');
        list.push({ key: 'state', item: Object.assign({}, st.item, { savedAt: r.at || t }), hash: st.hash, localHash: st.hash, base: r.rev || 0 });
      }
      sc.dirty.sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || ((b.card.lastAt || 0) - (a.card.lastAt || 0)));
      sc.dirty.forEach(d => {
        const r = rec(d.key);
        const raw = slotRaw(d.id);
        if (raw === null) return;
        const it = localItem(d.card, raw, r.at || t);
        if (!it) return;
        const h = M.contentHash(it);
        list.push({ key: d.key, item: it, hash: h, localHash: h, base: r.rev || 0 });
      });
      const res = await pushItems(list, keepalive);
      return Object.assign(res, { scan: sc });
    }

    /* The library's version of the keys that conflicted is fetched, merged, and sent again over its revision. A few rounds, then the rest waits. -> the conflicts left */
    async function settle(conflicts, asks, keepalive) {
      let todo = conflicts;
      for (let round = 0; round < MERGE_ROUNDS && todo.length; round++) {
        const metas = todo.filter(c => isObj(c) && typeof c.key === 'string');
        const bodies = await fetchBodies(metas.filter(m => !m.deleted));
        const live = metas.filter(m => !m.deleted);
        const good = await itemsOf(live, bodies);
        const songs = [];
        good.forEach(g => { if (g.meta.key === 'state') applyState(g.item, g.meta); else songs.push(g); });
        if (songs.length) {
          const r = applySongs(songs);
          if (r.failed) { rt.error = 'storage'; return []; }
          r.deferred.forEach(m => { S.defer[m.key] = m; });
          r.copies.forEach(c => notice({ code: 'copy', id: c.id, title: c.title, kept: c.kept }));
        }
        const tombs = metas.filter(m => m.deleted);
        if (tombs.length) await applyTombstones(tombs, asks);
        save();
        const next = await push(keepalive);
        todo = next.conflicts;
        if (next.stopped) break;
      }
      return todo;
    }

    /* removals of the person's, sent as tombstones (4 or more at once, or a fifth of the library, only after their yes) */
    async function sendRemovals(removed, asks) {
      if (!removed.length) return;
      const total = adapter.libraryRead().songs.length + removed.length;
      const okIds = Array.isArray(S.okDeleteOut) ? S.okDeleteOut : [];
      S.okDeleteOut = false;
      const rest = removed.filter(x => okIds.indexOf(x.id) < 0);
      let todo = removed;
      if (rest.length > 0 && M.needsAsk(rest.length, total)) {
        asks.push({ kind: 'delete-out', n: rest.length, total: total, titles: rest.slice(0, 8).map(x => { const m = removedMap()[x.id]; return (m && m.title) || ''; }), ids: rest.map(x => x.id) });
        todo = removed.filter(x => okIds.indexOf(x.id) >= 0);
      }
      for (const x of todo) {
        if (destroyed || frozen() || writeRoom(now()) <= 0) return;
        let r;
        try {
          r = await request('DELETE', '/api/sync/items/' + encodeURIComponent(x.key) + '?baseRev=' + encodeURIComponent(String(x.rev)) + '&device=' + S.device, { allow409: true });
        } catch (e) {
          if (e.status === 404) { tomb(rec(x.key)); removedDel(x.id); continue; }
          throw e;
        }
        const rr = rec(x.key);
        if (r.status === 409) {
          /* the item moved on after this device last saw it: the library's change stands, and the song is brought back */
          const c = (r.body.conflicts || [])[0];
          if (c) { rr.rev = c.rev; rr.hash = c.hash || 'unknown'; rr.del = c.deleted ? 1 : 0; if (c.deleted) { rr.delAt = now(); rr.hash = ''; } }
          removedDel(x.id);
          notice({ code: 'changed-elsewhere', id: x.id });
          continue;
        }
        tomb(rr, r.body.rev);
        removedDel(x.id);
        S.writes.push(now());
        /* a tombstone that follows the cursor exactly moves it on (the next poll then costs the library nothing) */
        if (isNum(r.body.rev) && isNum(r.body.maxRev) && r.body.rev === S.since + 1 && r.body.maxRev === r.body.rev) S.since = r.body.maxRev;
        if (isObj(r.body.library)) setLibrary(r.body.library);
      }
    }

    /* songs that were lost here (the card went and nobody asked) and that the library has: fetched again */
    async function restoreVanished(keys) {
      const metas = keys.map(k => ({ key: k, rev: S.keys[k].rev, hash: S.keys[k].hash }));
      const bodies = await fetchBodies(metas);
      const good = await itemsOf(metas, bodies);
      if (!good.length) return;
      const r = applySongs(good.map(g => ({ meta: Object.assign({}, bodies[g.meta.key].meta, { key: g.meta.key }), item: g.item })));
      if (!r.failed) notice({ code: 'recovered', n: r.applied });
    }

    /* ------------------------------------------------ the cycle */
    async function cycleOnce(reason, keepalive) {
      S = load();
      resetIdKey();
      _identCache = null;
      if (!S.code) return;
      const asks = [];
      rt.pulled = 0; rt.pushed = 0; rt.pullTotal = 0;
      rt.phase = 'syncing'; rt.error = null;
      emit();
      /* the page's open song and its state are in the storage before they are looked at */
      if (adapter.saveNow) { try { adapter.saveNow(); } catch (e) { /* the page's own save */ } }
      try {
        /* what this device changed is looked at first: its time is when it was seen to change, before anything of the library's is merged into it */
        scan();
        if (!keepalive) {
          const pl = await pull();
          const a = await applyListing(pl, asks);
          if (a.stop) { rt.phase = 'idle'; save(); emit(); return; }
          /* the cursor moves on when everything it covers is applied or deliberately kept (an unanswered question holds it: the same list is made again) */
          if (!a.held) S.since = pl.since;
          if (pl.full && !a.held) {
            /* a whole listing: songs this device has an item of and the library has not - removed there and the tombstone purged, or the library was restored */
            const listed = {};
            pl.listing.forEach(m => { listed[m.key] = true; });
            const have = {};
            adapter.libraryRead().songs.forEach(c => { if (isObj(c)) have[c.id] = true; });
            const missing = Object.keys(S.keys).filter(k => {
              const r = S.keys[k];
              return k !== 'state' && r && r.rev && !listed[k] && !r.del && !S.only[idForKey(k)] && have[idForKey(k)];
            });
            if (missing.length) {
              S.gone = Array.from(new Set(S.gone.concat(missing)));
            }
            S.tooOld = 0;
          }
          if (S.okKeepGone && S.gone.length) {
            /* the person said to keep what the library lost: it is sent again as new (base 0) */
            S.gone.forEach(k => { const r = S.keys[k]; if (r) { r.rev = 0; r.hash = ''; r.d = 1; r.lh = ''; r.del = 0; } });
            S.gone = [];
          }
          S.okKeepGone = false;
          save();
        }
        const res = await push(keepalive);
        if (!keepalive) {
          res.gone.filter(k => k !== 'state').forEach(k => { if (S.gone.indexOf(k) < 0) S.gone.push(k); });
          if (res.scan.vanished.length) await restoreVanished(res.scan.vanished);
          if (res.scan.removed.length) await sendRemovals(res.scan.removed, asks);
          if (res.conflicts.length) {
            const left = await settle(res.conflicts, asks, keepalive);
            if (left.length) backoff({ retryAfter: 0 });
          }
        }
        /* what is still waiting for the person */
        const have = {};
        adapter.libraryRead().songs.forEach(c => { if (isObj(c)) have[c.id] = c; });
        S.gone = S.gone.filter(k => S.keys[k] && have[idForKey(k)]);
        if (S.gone.length) {
          asks.push({ kind: 'gone', n: S.gone.length, titles: S.gone.slice(0, 8).map(k => (have[idForKey(k)] || {}).title || ''), keys: S.gone.slice() });
        }
        rt.asks = asks;
        if (res.stopped === 'budget') { rt.phase = 'waiting'; rt.waitUntil = (S.writes[0] || now()) + HOUR; }
        else { rt.phase = 'idle'; rt.waitUntil = 0; }
        S.lastSyncAt = now();
        if (rt.error !== 'storage' && !S.next) S.fail = 0;
      } catch (e) {
        handleError(e);
      }
      if (S && S.code) save();
      emit();
    }

    function backoff(e) {
      S.fail = (S.fail || 0) + 1;
      let wait;
      if (e && e.retryAfter > 0) wait = Math.min(RETRY_AFTER_MAX, e.retryAfter) * (1 + 0.1 * rand());
      else wait = Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, Math.min(S.fail - 1, 6))) * (0.8 + 0.4 * rand());
      S.next = now() + Math.max(1000, wait);
    }
    function handleError(e) {
      rt.phase = 'idle';
      if (!e || typeof e.status !== 'number') { rt.error = 'internal'; backoff({}); if (env.log) env.log(e && e.message); return; }
      const c = e.code || '';
      if (e.status === 401) {
        /* the code is not (or no longer) a library's: nothing more is tried until the person acts (a new code, or stopping) */
        rt.error = c === 'rotated' ? 'rotated' : c === 'deleted' ? 'deleted' : 'bad-code';
        S.next = now() + 24 * HOUR;
        return;
      }
      if (e.status === 0) { rt.error = 'offline'; backoff(e); return; }
      if (e.status === 429) { rt.error = 'busy'; backoff(e); return; }
      if (e.status === 503) { rt.error = c === 'quota' ? 'full' : 'busy'; backoff(e); return; }
      if (e.status === 403) { rt.error = 'cross-site'; S.next = now() + HOUR; return; }
      if (e.status === 404 || e.status === 405) { rt.error = 'unavailable'; S.next = now() + HOUR; return; }
      rt.error = 'server';
      backoff(e);
    }

    /* ------------------------------------------------ one cycle at a time, and when */
    /* a cycle is a critical section across the tabs of this browser (they share the state): a lock key, stale after 2 minutes */
    function acquire() {
      let cur = null;
      try { cur = parse(storage.getItem(LOCK_KEY) || 'null'); } catch (e) { cur = null; }
      if (isObj(cur) && cur.tab !== tabId && now() - cur.t < CYCLE_LOCK_MS) return false;
      try { storage.setItem(LOCK_KEY, JSON.stringify({ tab: tabId, t: now() })); } catch (e) { /* no lock: this tab goes on */ }
      return true;
    }
    function release() {
      try { const cur = parse(storage.getItem(LOCK_KEY) || 'null'); if (isObj(cur) && cur.tab === tabId) storage.removeItem(LOCK_KEY); } catch (e) { /* stale in 2 minutes */ }
    }
    function syncNow(reason, opts) {
      opts = opts || {};
      if (destroyed) return Promise.resolve(false);
      if (running) { again = true; return running; }
      if (frozen()) return Promise.resolve(false);
      S = load();
      if (!S.code) return Promise.resolve(false);
      if (!opts.force && S.next > now()) { schedule(S.next - now()); return Promise.resolve(false); }
      if (!online()) { rt.error = 'offline'; emit(); return Promise.resolve(false); }
      if (!acquire()) { schedule(15 * 1000); return Promise.resolve(false); }
      running = (async () => {
        try { await cycleOnce(reason || 'poll', !!opts.keepalive); } finally { release(); running = null; lastCycleEnd = now(); }
        if (again) { again = false; schedule(1500); } else after();
        return true;
      })();
      return running;
    }
    /* what next: a poll while the page is shown; the end of a wait; more to send */
    function after() {
      if (destroyed || !started) return;
      S = load();
      if (!S.code) return;
      const t = now();
      let delay = POLL_MS * (0.85 + 0.3 * rand());
      if (S.next > t) delay = Math.max(delay, S.next - t);
      else if (pendingCount() > 0 && !['rotated', 'deleted', 'bad-code'].includes(rt.error)) {
        /* more to send: when the hour's room is spent, when its oldest write is an hour old; else soon */
        delay = writeRoom(t) <= 0 ? Math.max(60 * 1000, (S.writes[0] || t) + HOUR - t + 2000) : PUSH_DELAY_MS;
      }
      schedule(delay);
    }
    function schedule(ms) {
      if (destroyed || !started) return;
      if (timer) clearT(timer);
      timer = setT(() => { timer = null; if (!visible()) { schedule(POLL_MS); return; } syncNow('poll'); }, Math.max(500, ms));
    }
    function pendingCount() {
      let n = 0;
      Object.keys(S.keys).forEach(k => { const r = S.keys[k]; if (r && r.d && !r.bad) n++; });
      return n;
    }

    /* ------------------------------------------------ what the page asks */
    function status() {
      const s = S || load();
      const idToKey = {};
      Object.keys(s.keys).forEach(k => { const r = s.keys[k]; if (r && typeof r.id === 'string') idToKey[r.id] = k; });
      let total = 0, done = 0;
      try {
        adapter.libraryRead().songs.forEach(c => {
          if (!isObj(c) || c.id === DEMO || s.only[c.id]) return;
          total++;
          const r = s.keys[idToKey[c.id] || M.keyOf(c.id)];
          if (r && r.rev && !r.d && !r.del) done++;
        });
      } catch (e) { /* no library to count */ }
      let pending = 0, bad = 0;
      Object.keys(s.keys).forEach(k => { const r = s.keys[k]; if (!r) return; if (r.bad) bad++; else if (r.d) pending++; });
      const t = now();
      const used = s.writes.filter(x => t - x < HOUR).length;
      const room = Math.max(0, WRITES_PER_HOUR - WRITE_MARGIN - used);
      const left = Math.max(0, total - done);
      const etaMs = left <= room ? 0 : Math.ceil((left - room) / (WRITES_PER_HOUR - WRITE_MARGIN)) * HOUR;
      return {
        on: !!s.code, tag: s.tag || '', phase: rt.phase, error: rt.error, lastSyncAt: s.lastSyncAt, keptUntil: s.keptUntil || '', next: s.next || 0,
        songs: { total: total, done: done, left: left, pending: pending, etaMs: etaMs, bad: bad },
        lib: s.lib, asks: rt.asks.slice(), notices: rt.notices.slice(), device: s.device, waitUntil: rt.waitUntil || 0,
        tooOld: !!s.tooOld, pulled: rt.pulled, pushed: rt.pushed, pullTotal: rt.pullTotal, only: Object.keys(s.only).length
      };
    }
    const onlyHas = () => { const s = load(); return !!s.code; };

    const api = {
      /* a library for this device: POST /api/libs. -> { ok, code, recovery, tag, keptUntil } or { ok: false, error } */
      async createLibrary() {
        S = cur();
        if (S.code) return { ok: false, error: 'already' };
        if (!canGzip() && !env.gzip) return { ok: false, error: 'unsupported' };
        let r;
        try { r = await request('POST', '/api/libs', { code: null, body: {} }); } catch (e) { return { ok: false, error: errorName(e), status: e.status, retryAfter: e.retryAfter }; }
        const b = r.body;
        if (typeof b.code !== 'string' || !CODE_RE.test(b.code)) return { ok: false, error: 'server' };
        S = blank(S.device, { ctr: S.ctr, ctrAt: S.ctrAt });
        S.code = b.code; S.tag = typeof b.tag === 'string' ? b.tag : ''; S.keptUntil = typeof b.keptUntil === 'string' ? b.keptUntil : '';
        S.createdAt = now();
        let songs = 0;
        try { songs = adapter.libraryRead().songs.filter(c => isObj(c) && c.id !== DEMO).length; } catch (e) { songs = 0; }
        S.mig = { total: songs, at: now() };
        save();
        rt.error = null; rt.asks = []; rt.notices = [];
        emit();
        return { ok: true, code: b.code, recovery: typeof b.recovery === 'string' ? b.recovery : '', tag: S.tag, keptUntil: S.keptUntil };
      },
      /* join a library by its code. addLocal === false keeps this device's songs on this device only. -> { ok, items } | { ok: false, error } */
      async join(code, opts) {
        opts = opts || {};
        const c = parseCode(code);
        if (!c) return { ok: false, error: 'bad-format' };
        S = cur();
        if (!canGzip() && !env.gzip) return { ok: false, error: 'unsupported' };
        let r;
        try { r = await request('GET', '/api/sync/changes?since=0', { code: c }); } catch (e) { return { ok: false, error: errorName(e), status: e.status }; }
        S = blank(S.device, { ctr: S.ctr, ctrAt: S.ctrAt });
        S.code = c; S.joinedAt = now();
        if (isObj(r.body.library)) setLibrary(r.body.library);
        if (opts.addLocal === false) {
          try { adapter.libraryRead().songs.forEach(card => { if (isObj(card) && typeof card.id === 'string' && card.id !== DEMO) S.only[card.id] = 1; }); } catch (e) { /* none */ }
        }
        S.mig = { total: 0, at: now() };
        save();
        rt.error = null; rt.asks = []; rt.notices = [];
        emit();
        return { ok: true, items: Array.isArray(r.body.items) ? r.body.items.length : 0 };
      },
      /* the library was given a new code (this device was told "rotated"): everything this device knows of it stays true */
      async enterNewCode(code) {
        const c = parseCode(code);
        if (!c) return { ok: false, error: 'bad-format' };
        S = cur();
        let r;
        try { r = await request('GET', '/api/sync/changes?since=0', { code: c }); } catch (e) { return { ok: false, error: errorName(e), status: e.status }; }
        S.code = c; S.next = 0; S.fail = 0;
        if (isObj(r.body.library)) setLibrary(r.body.library);
        save();
        rt.error = null;
        emit();
        return { ok: true };
      },
      /* a new code, the old one dead from this moment. -> { ok, code } */
      async rotate() {
        S = cur();
        if (!S.code) return { ok: false, error: 'off' };
        let r;
        try { r = await request('POST', '/api/libs/me/rotate', { body: {} }); } catch (e) { return { ok: false, error: errorName(e), status: e.status }; }
        S.code = r.body.code; S.tag = r.body.tag || S.tag; if (r.body.keptUntil) S.keptUntil = r.body.keptUntil;
        S.next = 0;
        save();
        emit();
        return { ok: true, code: r.body.code };
      },
      /* the recovery code: a second secret that can only give the library a new code (and a new recovery code). -> { ok, code, recovery } */
      async recover(recovery, opts) {
        opts = opts || {};
        const rc = parseCode(recovery);
        if (!rc) return { ok: false, error: 'bad-format' };
        S = cur();
        let r;
        try { r = await request('POST', '/api/libs/recover', { code: null, recovery: rc, body: {} }); } catch (e) { return { ok: false, error: errorName(e), status: e.status }; }
        if (S.code) { S.code = r.body.code; S.next = 0; S.fail = 0; }
        else {
          S = blank(S.device, { ctr: S.ctr, ctrAt: S.ctrAt });
          S.code = r.body.code; S.joinedAt = now(); S.mig = { total: 0, at: now() };
          if (opts.addLocal === false) { try { adapter.libraryRead().songs.forEach(card => { if (isObj(card) && typeof card.id === 'string' && card.id !== DEMO) S.only[card.id] = 1; }); } catch (e) { /* none */ } }
        }
        S.tag = r.body.tag || S.tag;
        if (r.body.keptUntil) S.keptUntil = r.body.keptUntil;
        save();
        rt.error = null;
        emit();
        return { ok: true, code: r.body.code, recovery: r.body.recovery || '' };
      },
      /* stop syncing on this device: the code is forgotten, nothing local is touched */
      forget() {
        S = cur();
        S = blank(S.device, { ctr: S.ctr, ctrAt: S.ctrAt });
        save();
        if (timer) { clearT(timer); timer = null; }
        rt.asks = []; rt.notices = []; rt.error = null; rt.phase = 'idle';
        emit();
        return { ok: true };
      },
      /* delete the library on the site (this device's code must still be one); this device then stops */
      async deleteLibrary() {
        S = cur();
        if (!S.code) return { ok: false, error: 'off' };
        try { await request('DELETE', '/api/libs/me'); } catch (e) {
          if (!(e.status === 401 && (e.code === 'deleted' || e.code === 'rotated'))) return { ok: false, error: errorName(e), status: e.status };
        }
        return api.forget();
      },
      syncNow: (reason, opts) => syncNow(reason || 'now', Object.assign({ force: true }, opts || {})),
      /* the page hid, or is going away: what changed is sent in one request if it fits */
      flush() { return onlyHas() ? syncNow('hide', { keepalive: true, force: true }) : Promise.resolve(false); },
      start() {
        if (started) return;
        started = true;
        S = load();
        if (!S.code) return;
        schedule(START_DELAY_MS);
      },
      stop() { started = false; if (timer) { clearT(timer); timer = null; } },
      destroy() { destroyed = true; api.stop(); listeners.length = 0; },
      /* the page is shown again, or the network is back: a poll if one is due */
      wake(reason) {
        if (!started || destroyed || running) return;
        S = load();
        if (!S.code || S.next > now() || now() - lastCycleEnd < 30000) return;
        syncNow(reason || 'wake');
      },
      status: status,
      on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
      isOn: onlyHas,
      /* the code, to show it to the person (never logged, never sent but in the header) */
      code: () => load().code || '',
      /* the page tells that the person removes a song of My Songs: kept for the trash, and sent as a deletion */
      noteRemoved(id, card, raw) {
        if (rt.remoteApply || !onlyHas()) return;
        S = cur();
        if (id === DEMO || !raw || !isObj(card)) return;
        const key = keyForId(id);
        if (S.keys[key] && S.keys[key].rev) {
          removedPut(id, { at: now(), key: key, title: typeof card.title === 'string' ? card.title : '' });
        }
        trashPut(id, card, raw, 'local').catch(() => {});
      },
      /* the answer to a question in status().asks. choice: 'yes' | 'no' */
      async answer(kind, choice) {
        S = cur();
        const ask = rt.asks.find(a => a.kind === kind);
        if (!ask) return { ok: false };
        rt.asks = rt.asks.filter(a => a.kind !== kind);
        if (kind === 'delete-in') {
          if (choice === 'yes') S.okDeleteIn = ask.keys.slice();
          else ask.keys.forEach((k, i) => { tomb(rec(k), ask.revs[i]); S.only[idForKey(k)] = 1; });
        } else if (kind === 'delete-out') {
          if (choice === 'yes') S.okDeleteOut = ask.ids.slice();
          else await restoreFromTrash(ask.ids);
        } else if (kind === 'gone') {
          if (choice === 'yes') S.okKeepGone = true;
          else {
            const cards = {};
            adapter.libraryRead().songs.forEach(c => { if (isObj(c)) cards[c.id] = c; });
            const list = ask.keys.map(k => ({ key: k, id: idForKey(k), card: cards[idForKey(k)], raw: slotRaw(idForKey(k)), rev: 0 })).filter(x => x.card);
            if (list.length) await removeHere(list, 'gone');
            S.gone = S.gone.filter(k => ask.keys.indexOf(k) < 0);
            ask.keys.forEach(k => { const r = rec(k); r.rev = 0; r.hash = ''; r.d = 0; r.del = 1; });
          }
        }
        save();
        emit();
        return syncNow('answer', { force: true });
      },
      /* Recently deleted */
      async trashList() { try { return await trash.list(); } catch (e) { return []; } },
      trashAvailable: () => trash.available(),
      /* a removed song comes back: its slot and card are written again and it is sent as a new version over the tombstone */
      async restore(tid) {
        S = cur();
        let row = null;
        try { row = await trash.get(tid); } catch (e) { row = null; }
        if (!row) return { ok: false, error: 'missing' };
        let id = row.id;
        const present = adapter.libraryRead().songs.some(c => isObj(c) && c.id === id) || slotRaw(id) !== null;
        if (present) id = 'song-q' + M.hashText(tid).slice(1, 15);
        if (!writeSongs([{ id: id, text: row.slot, card: Object.assign({}, row.card, { id: id }), before: null }])) return { ok: false, error: 'storage' };
        resetIdKey();
        const r = rec(id === row.id ? keyForId(id) : M.keyOf(id));
        r.d = 1; r.lh = ''; r.fp = ''; r.at = now();
        removedDel(row.id);
        if (adapter.forgetThumbs) { try { adapter.forgetThumbs([id]); } catch (e) { /* a cache */ } }
        save();
        try { await trash.del(tid); } catch (e) { /* the entry stays */ }
        emit();
        api.syncNow('restore');
        return { ok: true, id: id };
      },
      async trashDelete(tid) { try { await trash.del(tid); return true; } catch (e) { return false; } },
      /* "keep only on this device" for a song, or back */
      setOnly(id, on) { S = cur(); if (on) S.only[id] = 1; else delete S.only[id]; save(); emit(); },
      /* tests */
      _rt: rt, _load: load
    };
    async function restoreFromTrash(ids) {
      let rows = [];
      try { rows = await trash.list(); } catch (e) { rows = []; }
      for (const id of ids) {
        const row = rows.find(r => r.id === id);
        removedDel(id);
        if (!row) continue;
        if (adapter.libraryRead().songs.some(c => isObj(c) && c.id === id)) continue;
        if (writeSongs([{ id: id, text: row.slot, card: Object.assign({}, row.card, { id: id }), before: null }])) { try { await trash.del(row.tid); } catch (e) { /* stays */ } }
      }
      resetIdKey();
    }
    return api;
  }

  return Object.freeze({
    create, parseCode, groupCode, linkFor, makeTrash, canGzip, b64encode, b64decode, gzipDefault, gunzipDefault,
    STATE_KEY, LOCK_KEY, WRITES_PER_HOUR, WRITE_MARGIN, BATCH, POLL_MS
  });
});
