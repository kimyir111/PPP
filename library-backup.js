/* PPP library backup, restore and "delete everything on this device" (G13-6; docs/GOALS/G13_PRODUCTIZATION.md sections 7.5, E5, G13-D7).

   Everything a person has lives in this browser: the song cards (localStorage ppp.library.v1), one slot per song (ppp.song.v1.<id>: the packed
   Score and that song's practice progress), the practice state (ppp.state.v2), the setting keys (ppp.*, ppp-*), the engraving cache (IndexedDB
   ppp-engrave) and the uploaded videos (IndexedDB ppp-media). This file is the only code that reads all of it as one thing. It needs no account and
   no server, and it does not know the page: the page hands it a storage, an indexedDB and the browser's stream classes (`env`), so Node tests it with
   fakes.

   THE FILE  {app:'ppp-library', v:1, exportedAt, build, counts:{songs}, library:{songs:[cards], demo, current}, slots:{<id>: slot}, state:{...}}
     - gzip (CompressionStream) as <name>.ppp-library.json.gz; plain <name>.ppp-library.json where the browser has no CompressionStream;
     - the cards and the slots exactly as the page keeps them (a slot is written back as the same JSON text, so a restore on an empty profile gives
       byte-identical slots); the demo song's progress slot too; no graphs (the engraving cache is rebuilt from the Score), no videos;
     - state: only the progress that is not one song's (xp, minutes, streak, the week's bars, the basics course, the method books, the quiz timings).
       Settings (theme, MIDI devices, visual options, the language) are per device and are not in it (section 7.5);
     - NEVER a secret: not the PC link code (ppp.pclink.v1, ppp.pclink.prev.v1), not the guest sharing key (ppp-guest-key), not a password or a token.
       The file is built from an allowlist, and as a second wall build() refuses to return anything that contains the value of a secret this browser
       holds (error code 'secret-in-backup').

   RESTORE  decode() -> validate() -> plan() -> apply(). Nothing is written before the file has passed the bounds (file size, inflated size, nesting, number
   of songs, ids, slot sizes, no __proto__ key). apply() only ever ADDS or MERGES (7.5):
     - a song id that is not here: added, with its slot as the same JSON text;
     - the same id with the same score: the progress is merged field by field (the larger count, the later record, the union of the runs; the loop and the
       tempo stay as they are here), nothing else changes;
     - the same id with a DIFFERENT score: the song here is left alone and the backup's version is added as a separate song with a visible suffix. Its id is
       derived from the old id and the score, so restoring the same file twice adds nothing the second time;
     - a song here is never removed, and a score here is never replaced.
   The writes are collected first and done in an order that never lists a song without its slot; if the storage refuses one (quota), every earlier write is
   put back and nothing has changed.

   WIPE  wipe(env): the page's own database handles are closed, every IndexedDB database named ppp* is deleted (a database another tab holds open is reported
   as blocked, not skipped), every ppp* localStorage key is removed (settings included), the language cookie and the session keys go, and the result is
   checked: report.left must be empty. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PPPBackup = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const FORMAT = 'ppp-library', VERSION = 1;
  const KEY = { LIBRARY: 'ppp.library.v1', SONG: 'ppp.song.v1.', STATE: 'ppp.state.v2', PC: 'ppp.pclink.v1', PC_PREV: 'ppp.pclink.prev.v1', GUEST: 'ppp-guest-key' };
  const FLASH_KEY = 'ppp-backup-flash';
  /* what a file may be (bounds checked before anything is read as a backup): localStorage itself holds a few MB, so a real file is far below these */
  const LIMITS = Object.freeze({ file: 24 * 1024 * 1024, json: 48 * 1024 * 1024, songs: 2000, slot: 8 * 1024 * 1024, depth: 64, nodes: 12000000, title: 400 });
  /* the progress that belongs to no one song */
  const STATE_FIELDS = Object.freeze(['minutes', 'xp', 'streak', 'sessions', 'skillMs', 'learnDone', 'learnLesson', 'learnStep', 'course']);
  const SLOT_PROGRESS = Object.freeze(['secs', 'history', 'memory', 'memLevel', 'blindRuns', 'mastered']);
  const KNOWN_DBS = ['ppp-engrave', 'ppp-media'];
  const RUN_KEEP = 40;

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const parse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  const isSongId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(id) && id !== 'demo';
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  /* ---------------------------------------------------------------- storage access (never throws) */
  function getItem(storage, k) { try { const v = storage.getItem(k); return v === undefined ? null : v; } catch (e) { return null; } }
  function allKeys(storage) {
    const out = [];
    try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k != null) out.push(k); } } catch (e) { /* none */ }
    return out;
  }
  const pppKeys = storage => allKeys(storage).filter(k => /^ppp/i.test(k));

  /* canonical JSON: keys sorted, so two scores that say the same thing compare equal whatever order a build wrote them in */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : stable(x))).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  /* a packed Score (the page's packScore: one key dictionary and a row per note) as the plain note objects it stands for */
  function plainScore(sc) {
    if (!isObj(sc) || !Array.isArray(sc.notes) || !Array.isArray(sc._packedNoteKeys)) return sc;
    const keys = sc._packedNoteKeys, out = {};
    Object.keys(sc).forEach(k => { if (k !== '_packedNoteKeys' && k !== '_byNumber' && k !== 'notes') out[k] = sc[k]; });
    out.notes = sc.notes.map(row => { const n = {}; (Array.isArray(row) ? row : []).forEach((v, i) => { if (v != null && keys[i]) n[keys[i]] = v; }); return n; });
    return out;
  }
  /* what makes a song's score "the same": its canonical text; null for a slot with no score (the built-in sample) */
  function scoreKeyOf(slot) {
    if (!isObj(slot) || !isObj(slot.score)) return null;
    const p = plainScore(slot.score);
    if (isObj(p) && has(p, '_byNumber')) { const q = Object.assign({}, p); delete q._byNumber; return stable(q); }
    return stable(p);
  }
  function hash36(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  /* the id of the copy a different version of a song becomes: the same old id and score always give the same new id */
  const copyIdOf = (id, scoreKey) => 'song-b' + hash36(id + '\n' + scoreKey, 2166136261) + hash36(scoreKey + '\n' + id, 5381);

  /* ---------------------------------------------------------------- local data */
  function readLibrary(storage) {
    const d = parse(getItem(storage, KEY.LIBRARY) || 'null');
    if (isObj(d) && Array.isArray(d.songs)) return d;
    return { songs: [], current: 'demo', demo: null };
  }
  const readSlotRaw = (storage, id) => getItem(storage, KEY.SONG + id);
  function readState(storage) {
    const d = parse(getItem(storage, KEY.STATE) || 'null');
    return isObj(d) ? d : null;
  }

  /* ---------------------------------------------------------------- the secrets this browser holds */
  function secretsOf(storage) {
    const out = [];
    [KEY.PC, KEY.PC_PREV].forEach(k => { const v = parse(getItem(storage, k) || 'null'); if (isObj(v) && typeof v.code === 'string' && v.code.length >= 16) out.push(v.code); });
    const g = getItem(storage, KEY.GUEST);
    if (typeof g === 'string' && g.length >= 16) out.push(g);
    return out;
  }

  /* ---------------------------------------------------------------- build */
  /* storage -> the backup object. opts: {now: Date, build: string}. Throws {code:'secret-in-backup'} rather than return a secret. */
  function build(storage, opts) {
    opts = opts || {};
    const now = opts.now instanceof Date ? opts.now : new Date();
    const lib = readLibrary(storage);
    const songs = [], slots = {};
    let skipped = 0;
    lib.songs.forEach(card => {
      if (!isObj(card) || !isSongId(card.id)) { skipped++; return; }
      const slot = parse(readSlotRaw(storage, card.id) || 'null');
      if (!isObj(slot) || !isObj(slot.score)) { skipped++; return; }      /* a card with nothing behind it cannot be opened: it is not backed up */
      songs.push(clone(card));
      slots[card.id] = slot;
    });
    const demoSlot = parse(readSlotRaw(storage, 'demo') || 'null');
    if (isObj(demoSlot)) slots.demo = demoSlot;
    const st = readState(storage), state = {};
    if (st) STATE_FIELDS.forEach(k => { if (st[k] !== undefined) state[k] = st[k]; });
    const out = {
      app: FORMAT, v: VERSION, exportedAt: now.toISOString(), build: typeof opts.build === 'string' ? opts.build : null,
      counts: { songs: songs.length, skipped: skipped },
      library: { songs: songs, demo: isObj(lib.demo) ? clone(lib.demo) : null, current: typeof lib.current === 'string' ? lib.current : 'demo' },
      slots: slots, state: state
    };
    /* @secrets-excluded: nothing above reads ppp.pclink.*, ppp-guest-key or any account data */
    const json = JSON.stringify(out);
    secretsOf(storage).forEach(s => { if (json.indexOf(s) >= 0) { const e = new Error('a secret of this browser is in the backup'); e.code = 'secret-in-backup'; throw e; } });
    return out;
  }

  /* ---------------------------------------------------------------- encode and decode */
  const pad = n => (n < 10 ? '0' : '') + n;
  function fileName(date, gz) {
    const d = date instanceof Date ? date : new Date();
    return 'ppp-library-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + (gz ? '.ppp-library.json.gz' : '.ppp-library.json');
  }
  function envOf(env) {
    env = env || {};
    const g = root || {};
    const pick = name => { try { return g[name]; } catch (e) { return undefined; } };      /* reading localStorage throws where it is blocked */
    return {
      storage: env.storage || pick('localStorage'), session: env.session || pick('sessionStorage'), indexedDB: env.indexedDB || pick('indexedDB'),
      CompressionStream: has(env, 'CompressionStream') ? env.CompressionStream : pick('CompressionStream'),
      DecompressionStream: has(env, 'DecompressionStream') ? env.DecompressionStream : pick('DecompressionStream'),
      Blob: env.Blob || pick('Blob'),
      closeHandles: env.closeHandles, blockedMs: isNum(env.blockedMs) ? env.blockedMs : 4000,
      document: has(env, 'document') ? env.document : pick('document')
    };
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
  /* backup object -> {bytes, gz, name}. gzip where the browser can, plain JSON where it cannot. */
  async function encode(backup, envIn, date) {
    const env = envOf(envIn);
    const raw = new TextEncoder().encode(JSON.stringify(backup));
    let bytes = raw, gz = false;
    if (typeof env.CompressionStream === 'function' && typeof env.Blob === 'function') {
      try {
        const packed = await readAll(new env.Blob([raw]).stream().pipeThrough(new env.CompressionStream('gzip')), Infinity);
        if (packed && packed.length) { bytes = packed; gz = true; }
      } catch (e) { bytes = raw; gz = false; }
    }
    return { bytes: bytes, gz: gz, name: fileName(date || new Date(), gz) };
  }
  /* bytes -> {ok:true, backup} | {ok:false, code}. Every bound is checked before the JSON is read as a backup. */
  async function decode(bytes, envIn) {
    const env = envOf(envIn);
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || 0);
    if (!bytes.length) return { ok: false, code: 'empty' };
    if (bytes.length > LIMITS.file) return { ok: false, code: 'file-too-big', bytes: bytes.length };
    let text = bytes;
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof env.DecompressionStream !== 'function' || typeof env.Blob !== 'function') return { ok: false, code: 'no-gunzip' };
      let out;
      try { out = await readAll(new env.Blob([bytes]).stream().pipeThrough(new env.DecompressionStream('gzip')), LIMITS.json); }
      catch (e) { return { ok: false, code: 'not-gzip' }; }
      if (!out) return { ok: false, code: 'too-big-inflated' };
      text = out;
    }
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(text); } catch (e) { return { ok: false, code: 'not-json' }; }
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    if (!/^\s*\{/.test(s)) return { ok: false, code: 'not-json' };
    const obj = parse(s);
    if (!isObj(obj)) return { ok: false, code: 'not-json' };
    const v = validate(obj);
    return v.ok ? { ok: true, backup: obj, exportedAt: obj.exportedAt } : { ok: false, code: v.code };
  }

  /* ---------------------------------------------------------------- validate */
  /* the nesting depth and size of the whole value, and a key that would change an object's prototype: refused, not cleaned */
  function scan(rootValue) {
    let nodes = 0;
    const stack = [[rootValue, 0]];
    while (stack.length) {
      const top = stack.pop(), v = top[0], d = top[1];
      if (d > LIMITS.depth) return 'too-complex';
      if (Array.isArray(v)) {
        nodes += v.length;
        if (nodes > LIMITS.nodes) return 'too-complex';
        for (let i = 0; i < v.length; i++) { const x = v[i]; if (x !== null && typeof x === 'object') stack.push([x, d + 1]); }
      } else {
        const ks = Object.keys(v);
        nodes += ks.length;
        if (nodes > LIMITS.nodes) return 'too-complex';
        for (let i = 0; i < ks.length; i++) {
          if (ks[i] === '__proto__') return 'unsafe-key';
          const x = v[ks[i]];
          if (x !== null && typeof x === 'object') stack.push([x, d + 1]);
        }
      }
    }
    return null;
  }
  /* -> {ok:true} | {ok:false, code}. codes: not-ppp, bad-version, newer, bad-shape, too-many-songs, bad-id, bad-slot, slot-too-big, too-complex, unsafe-key */
  function validate(b) {
    if (!isObj(b) || b.app !== FORMAT) return { ok: false, code: 'not-ppp' };
    if (!Number.isInteger(b.v) || b.v < 1) return { ok: false, code: 'bad-version' };
    if (b.v > VERSION) return { ok: false, code: 'newer' };
    const bad = scan(b);
    if (bad) return { ok: false, code: bad };
    if (!isObj(b.library) || !Array.isArray(b.library.songs) || !isObj(b.slots)) return { ok: false, code: 'bad-shape' };
    if (b.library.songs.length > LIMITS.songs) return { ok: false, code: 'too-many-songs' };
    if (has(b, 'state') && b.state !== null && !isObj(b.state)) return { ok: false, code: 'bad-shape' };
    if (b.library.demo != null && !isObj(b.library.demo)) return { ok: false, code: 'bad-shape' };
    const seen = {};
    for (const card of b.library.songs) {
      if (!isObj(card) || !isSongId(card.id) || has(seen, card.id)) return { ok: false, code: 'bad-id' };
      seen[card.id] = true;
      if (card.title != null && (typeof card.title !== 'string' || card.title.length > LIMITS.title)) return { ok: false, code: 'bad-shape' };
    }
    for (const id of Object.keys(b.slots)) {
      if (id !== 'demo' && !isSongId(id)) return { ok: false, code: 'bad-id' };
      const slot = b.slots[id];
      if (!isObj(slot)) return { ok: false, code: 'bad-slot' };
      if (slot.score != null) {
        const sc = slot.score;
        if (!isObj(sc) || !Array.isArray(sc.measures) || !Array.isArray(sc.notes)) return { ok: false, code: 'bad-slot' };
      } else if (id !== 'demo') return { ok: false, code: 'bad-slot' };
      if (JSON.stringify(slot).length > LIMITS.slot) return { ok: false, code: 'slot-too-big' };
    }
    return { ok: true };
  }

  /* ---------------------------------------------------------------- merging progress (section 7.5) */
  const maxNum = (a, b) => (isNum(a) && isNum(b) ? Math.max(a, b) : isNum(a) ? a : b);
  const stamp = v => (isNum(v) ? v : typeof v === 'string' && !isNaN(Date.parse(v)) ? Date.parse(v) : 0);

  /* per measure the record with more attempts, then the later one; the whole-run summaries are the union */
  function mergeHistory(a, b) {
    if (!isObj(b) || !isObj(b.byMeasure)) return a;
    if (!isObj(a) || !isObj(a.byMeasure)) return b;
    const by = {};
    Object.keys(a.byMeasure).concat(Object.keys(b.byMeasure)).forEach(k => {
      if (has(by, k)) return;
      const x = a.byMeasure[k], y = b.byMeasure[k];
      if (!isObj(y)) by[k] = x;
      else if (!isObj(x)) by[k] = y;
      else {
        const ax = isNum(x.attempts) ? x.attempts : 0, ay = isNum(y.attempts) ? y.attempts : 0;
        by[k] = ay > ax || (ay === ax && stamp(y.lastAt) > stamp(x.lastAt)) ? y : x;
      }
    });
    const seen = {}, runs = [];
    (Array.isArray(a.runs) ? a.runs : []).concat(Array.isArray(b.runs) ? b.runs : []).forEach(r => {
      if (!isObj(r)) return;
      const key = [r.at, r.from, r.to, r.tempo, r.hands].join('|');
      if (has(seen, key)) return;
      seen[key] = true; runs.push(r);
    });
    runs.sort((p, q) => stamp(p.at) - stamp(q.at));
    const out = Object.assign({}, a, { byMeasure: by, runs: runs.slice(-RUN_KEEP) });
    if (isNum(a.rev) || isNum(b.rev)) out.rev = maxNum(a.rev, b.rev);
    return out;
  }
  /* per section the higher level, then the later test, then the longer record */
  function mergeMemory(a, b) {
    if (!isObj(b) || !isObj(b.sections)) return a;
    if (!isObj(a) || !isObj(a.sections)) return b;
    const secs = {};
    Object.keys(a.sections).concat(Object.keys(b.sections)).forEach(k => {
      if (has(secs, k)) return;
      const x = a.sections[k], y = b.sections[k];
      if (!isObj(y)) { secs[k] = x; return; }
      if (!isObj(x)) { secs[k] = y; return; }
      const rank = r => [isNum(r.level) ? r.level : 0, stamp(r.lastMemoryTest), Array.isArray(r.attempts) ? r.attempts.length : 0];
      const rx = rank(x), ry = rank(y);
      let pick = x;
      for (let i = 0; i < 3; i++) { if (ry[i] !== rx[i]) { pick = ry[i] > rx[i] ? y : x; break; } }
      secs[k] = pick;
    });
    const out = Object.assign({}, a, { sections: secs });
    if (isNum(a.rev) || isNum(b.rev)) out.rev = maxNum(a.rev, b.rev);
    return out;
  }
  function mergeSecs(a, b) {
    if (!isObj(b)) return a;
    if (!isObj(a)) return b;
    const out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(k => {
      if (has(out, k)) return;
      const x = a[k], y = b[k];
      if (!isObj(y)) { out[k] = x; return; }
      if (!isObj(x)) { out[k] = y; return; }
      const o = Object.assign({}, x);
      Object.keys(y).forEach(f => { o[f] = has(x, f) ? (isNum(x[f]) && isNum(y[f]) ? Math.max(x[f], y[f]) : x[f]) : y[f]; });
      out[k] = o;
    });
    return out;
  }
  /* one song's slot here and the same song's slot in the backup (the same score): this device's slot with the progress merged in */
  function mergeSlot(a, b) {
    const out = {};
    Object.keys(a).forEach(k => { out[k] = a[k]; });
    Object.keys(b).forEach(k => {
      if (k === 'score' || k === 'importReport' || k === '__proto__') return;
      if (!has(out, k) || out[k] === null || out[k] === undefined) out[k] = b[k];
    });
    if (has(b, 'history') || has(a, 'history')) out.history = mergeHistory(a.history, b.history);
    if (has(b, 'memory') || has(a, 'memory')) out.memory = mergeMemory(a.memory, b.memory);
    if (has(b, 'secs') || has(a, 'secs')) out.secs = mergeSecs(a.secs, b.secs);
    ['memLevel', 'blindRuns'].forEach(k => { if (has(a, k) || has(b, k)) out[k] = maxNum(a[k], b[k]); });
    if (has(a, 'mastered') || has(b, 'mastered')) out.mastered = !!(a.mastered || b.mastered);
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
    return out;
  }
  function mergeCourse(a, b) {
    if (!isObj(b)) return a;
    if (!isObj(a)) return b;
    const out = clone(a);
    if (isObj(b.passed)) {
      if (!isObj(out.passed)) out.passed = {};
      Object.keys(b.passed).forEach(book => {
        if (!isObj(b.passed[book])) return;
        if (!isObj(out.passed[book])) out.passed[book] = {};
        Object.keys(b.passed[book]).forEach(no => { if (!has(out.passed[book], no)) out.passed[book][no] = b.passed[book][no]; });
      });
    }
    if (isObj(b.log)) {
      if (!isObj(out.log)) out.log = {};
      Object.keys(b.log).forEach(day => {
        if (!isObj(b.log[day])) return;
        if (!isObj(out.log[day])) { out.log[day] = clone(b.log[day]); return; }
        Object.keys(b.log[day]).forEach(k => { out.log[day][k] = has(out.log[day], k) ? maxNum(out.log[day][k], b.log[day][k]) : b.log[day][k]; });
      });
    }
    return out;
  }
  /* the cross-song progress: the larger count, the union of what was done; where this device is in a course stays as it is */
  function mergeState(local, remote) {
    const out = isObj(local) ? Object.assign({}, local) : {};
    if (!isObj(remote)) return out;
    ['minutes', 'xp', 'streak'].forEach(k => { if (has(remote, k)) out[k] = maxNum(out[k], remote[k]); });
    if (Array.isArray(remote.sessions)) {
      const a = Array.isArray(out.sessions) ? out.sessions : [], n = Math.max(a.length, remote.sessions.length), s = [];
      for (let i = 0; i < n; i++) s.push(maxNum(a[i], remote.sessions[i]));
      out.sessions = s;
    }
    if (isObj(remote.skillMs)) {
      const m = isObj(out.skillMs) ? Object.assign({}, out.skillMs) : {};
      Object.keys(remote.skillMs).forEach(k => { if (!has(m, k)) m[k] = remote.skillMs[k]; });
      out.skillMs = m;
    }
    if (isObj(remote.learnDone)) {
      const hadNone = !isObj(out.learnDone) || !Object.keys(out.learnDone).length;
      const m = isObj(out.learnDone) ? Object.assign({}, out.learnDone) : {};
      Object.keys(remote.learnDone).forEach(k => { if (!has(m, k)) m[k] = remote.learnDone[k]; });
      out.learnDone = m;
      if (hadNone) { if (remote.learnLesson !== undefined) out.learnLesson = remote.learnLesson; if (remote.learnStep !== undefined) out.learnStep = remote.learnStep; }
    }
    if (has(remote, 'course')) out.course = mergeCourse(out.course, remote.course);
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
    return out;
  }

  /* ---------------------------------------------------------------- plan and apply */
  /* what restoring this backup into this storage would do. Pure: nothing is written. opts.copyTitle(title, exportedAt) names a kept copy. */
  function plan(bk, storage, opts) {
    opts = opts || {};
    const lib = readLibrary(storage);
    const localCards = {};
    lib.songs.forEach(c => { if (isObj(c) && typeof c.id === 'string') localCards[c.id] = c; });
    const out = { total: bk.library.songs.length, skipped: 0, fresh: [], same: [], copies: [], items: [], demo: null };
    const idMap = {};
    const used = {};
    Object.keys(localCards).forEach(id => { used[id] = true; });
    bk.library.songs.forEach(card => {
      const slot = has(bk.slots, card.id) ? bk.slots[card.id] : null;
      if (!isObj(slot) || !isObj(slot.score)) { out.skipped++; return; }
      const key = scoreKeyOf(slot);
      const raw = readSlotRaw(storage, card.id);
      const lslot = raw === null ? undefined : parse(raw);
      const lkey = isObj(lslot) && isObj(lslot.score) ? scoreKeyOf(lslot) : null;
      if (raw === null) {                          /* nothing here under this id (a card without a slot is a lost song: its slot is filled in) */
        idMap[card.id] = card.id; used[card.id] = true;
        out.fresh.push(card.id);
        out.items.push({ kind: 'new', id: card.id, from: card.id, card: card, slot: slot, hadCard: !!localCards[card.id] });
      } else if (lkey !== null && lkey === key) {  /* the same song: its progress is merged */
        idMap[card.id] = card.id;
        out.same.push(card.id);
        out.items.push({ kind: 'same', id: card.id, from: card.id, card: card, slot: slot, local: lslot, localRaw: raw, hadCard: !!localCards[card.id] });
      } else {                                     /* the same id, another score (or a slot that cannot be read): both are kept */
        const base = copyIdOf(card.id, key);
        let cid = base, n = 1, found = null;
        for (; n <= 50; n++, cid = base + 'x' + n) {
          const craw = readSlotRaw(storage, cid);
          if (craw === null && !localCards[cid] && !used[cid]) break;               /* a free id */
          const cslot = craw === null ? undefined : parse(craw);
          if (isObj(cslot) && scoreKeyOf(cslot) === key) { found = { craw: craw, cslot: cslot }; break; }
        }
        idMap[card.id] = cid;
        if (found) {                               /* restoring this file before: that copy gets the progress */
          out.same.push(cid);
          out.items.push({ kind: 'same', id: cid, from: card.id, card: card, slot: slot, local: found.cslot, localRaw: found.craw, hadCard: !!localCards[cid] });
        } else {
          used[cid] = true;
          out.copies.push({ from: card.id, to: cid });
          out.items.push({ kind: 'copy', id: cid, from: card.id, card: card, slot: slot, hadCard: false });
        }
      }
    });
    if (isObj(bk.slots.demo)) out.demo = { slot: bk.slots.demo, meta: bk.library.demo || null };
    out.idMap = idMap;
    return out;
  }
  const summary = p => ({ total: p.total, fresh: p.fresh.length, same: p.same.length, copies: p.copies.length, skipped: p.skipped });

  /* Restore. -> {ok:true, ...summary, written} | {ok:false, code:'quota'|'write'} (and then nothing has changed). */
  function apply(bk, storage, opts) {
    opts = opts || {};
    const p = plan(bk, storage, opts);
    const localLib = readLibrary(storage);
    const state = readState(storage);
    const writes = [];                              /* [key, text] */
    const put = (k, text) => { if (getItem(storage, k) !== text) writes.push([k, text]); };
    const copyTitle = typeof opts.copyTitle === 'function' ? opts.copyTitle : (t => t + ' (backup)');
    const date = typeof bk.exportedAt === 'string' ? bk.exportedAt.slice(0, 10) : '';
    const mergedFor = {};                           /* id -> merged slot, for the open song's mirror in the state */
    const added = [];

    p.items.forEach(it => {
      if (it.kind === 'same') {
        const merged = mergeSlot(it.local, it.slot);
        mergedFor[it.id] = merged;
        const text = JSON.stringify(merged);
        if (text !== it.localRaw) put(KEY.SONG + it.id, text);
      } else {
        put(KEY.SONG + it.id, JSON.stringify(it.slot));
      }
    });
    if (p.demo) {
      const raw = readSlotRaw(storage, 'demo'), local = raw === null ? undefined : parse(raw);
      if (isObj(local)) { const m = mergeSlot(local, p.demo.slot); mergedFor.demo = m; const t = JSON.stringify(m); if (t !== raw) put(KEY.SONG + 'demo', t); }
      else if (raw === null) put(KEY.SONG + 'demo', JSON.stringify(p.demo.slot));
    }
    /* the library: every song here, then the new ones */
    const hadLib = getItem(storage, KEY.LIBRARY) !== null;
    const songs = localLib.songs.map(c => {                    /* @keeps-local-songs */
      const it = p.items.find(x => x.kind === 'same' && x.id === c.id);
      if (!it || !isObj(c)) return c;
      const o = Object.assign({}, c);
      ['prog', 'mem', 'lastAt'].forEach(k => { if (isNum(it.card[k]) && (!isNum(o[k]) || it.card[k] > o[k])) o[k] = it.card[k]; });
      return o;
    });
    const have = {};
    songs.forEach(c => { if (isObj(c)) have[c.id] = true; });
    p.items.forEach(it => {
      if (it.kind === 'same' || have[it.id]) return;
      const card = clone(it.card);
      card.id = it.id;
      if (it.kind === 'copy') card.title = copyTitle(typeof card.title === 'string' ? card.title : '', date);
      if (typeof card.arrangedFrom === 'string' && has(p.idMap, card.arrangedFrom)) card.arrangedFrom = p.idMap[card.arrangedFrom];
      songs.push(card); have[it.id] = true; added.push(it.id);
    });
    p.items.forEach(it => {                                     /* a song that was only a slot here, or a lost card: its card comes back */
      if (it.kind === 'same' && !have[it.id]) { const card = clone(it.card); card.id = it.id; songs.push(card); have[it.id] = true; added.push(it.id); }
    });
    const lib = Object.assign({}, localLib, { songs: songs });
    if (!hadLib || !has(lib, 'current')) lib.current = 'demo';
    if (isObj(bk.library.demo)) {
      const d = isObj(lib.demo) ? Object.assign({}, lib.demo) : {};
      ['prog', 'mem', 'lastAt'].forEach(k => { const m = maxNum(d[k], bk.library.demo[k]); if (m !== undefined) d[k] = m; });
      lib.demo = d;
    } else if (!has(lib, 'demo')) lib.demo = null;
    put(KEY.LIBRARY, JSON.stringify(lib));

    /* the cross-song progress, and the open song's own progress which the page reads from the state rather than from its slot */
    if (isObj(bk.state) && Object.keys(bk.state).length || (state && state.songId && mergedFor[state.songId])) {
      const ms = mergeState(state, isObj(bk.state) ? bk.state : null);
      if (state && typeof state.songId === 'string' && mergedFor[state.songId]) {
        SLOT_PROGRESS.forEach(k => { if (has(state, k) && mergedFor[state.songId][k] !== undefined) ms[k] = mergedFor[state.songId][k]; });
      }
      put(KEY.STATE, JSON.stringify(ms));
    }

    /* the order above never lists a song without its slot (slots, then the library, then the state); every write that is done can be undone */
    const before = writes.map(w => [w[0], getItem(storage, w[0])]);
    let done = 0;
    try {
      for (; done < writes.length; done++) storage.setItem(writes[done][0], writes[done][1]);
    } catch (e) {
      for (let i = Math.min(done, writes.length - 1); i >= 0; i--) {
        try { if (before[i][1] === null) storage.removeItem(before[i][0]); else storage.setItem(before[i][0], before[i][1]); } catch (e2) { /* the key was not written */ }
      }
      return { ok: false, code: e && /quota/i.test((e.name || '') + ' ' + (e.message || '')) ? 'quota' : 'write' };
    }
    return Object.assign({ ok: true, written: writes.length, added: added }, summary(p), { copiedIds: p.copies });
  }

  /* ---------------------------------------------------------------- wipe */
  function deleteDb(idb, name, blockedMs) {
    return new Promise(resolve => {
      let done = false, timer = null;
      const hang = setTimeout(() => fin({ ok: false, why: 'timeout' }), blockedMs + 6000);
      const fin = r => { if (done) return; done = true; clearTimeout(timer); clearTimeout(hang); resolve(r); };
      let req;
      try { req = idb.deleteDatabase(name); } catch (e) { fin({ ok: false, why: 'error' }); return; }
      req.onsuccess = () => fin({ ok: true });
      req.onerror = () => fin({ ok: false, why: 'error' });
      req.onblocked = () => { timer = setTimeout(() => fin({ ok: false, why: 'blocked' }), blockedMs); };
    });
  }
  async function dbNames(env) {
    const names = {};
    KNOWN_DBS.forEach(n => { names[n] = true; });
    try {
      if (env.indexedDB && typeof env.indexedDB.databases === 'function') {
        (await env.indexedDB.databases()).forEach(d => { if (d && typeof d.name === 'string' && /^ppp/i.test(d.name)) names[d.name] = true; });
      }
    } catch (e) { /* the known names are still tried */ }
    return Object.keys(names);
  }
  /* the databases that exist now (databases() where the browser has it) */
  async function dbsLeft(env) {
    try {
      if (env.indexedDB && typeof env.indexedDB.databases === 'function') {
        return (await env.indexedDB.databases()).map(d => d && d.name).filter(n => typeof n === 'string' && /^ppp/i.test(n));
      }
    } catch (e) { /* unknown */ }
    return null;
  }
  /* -> {ok, removed:{keys, dbs}, failed:[{kind:'key'|'db', name, why}], left:{keys, dbs}}; ok only when nothing is left */
  async function wipe(envIn) {
    const env = envOf(envIn);
    const report = { ok: false, removed: { keys: 0, dbs: 0 }, failed: [], left: { keys: [], dbs: [] } };
    if (typeof env.closeHandles === 'function') { try { await env.closeHandles(); } catch (e) { /* the delete reports a handle that stays open */ } }
    for (let round = 0; round < 3; round++) {          /* a write that was already on its way can bring a name back: look again */
      const failed = [];
      if (env.indexedDB) {
        for (const name of await dbNames(env)) {
          const r = await deleteDb(env.indexedDB, name, env.blockedMs);
          if (r.ok) report.removed.dbs++; else failed.push({ kind: 'db', name: name, why: r.why });
        }
      }
      for (const k of pppKeys(env.storage)) {
        try { env.storage.removeItem(k); } catch (e) { /* checked below */ }
        if (getItem(env.storage, k) === null) report.removed.keys++; else failed.push({ kind: 'key', name: k, why: 'error' });
      }
      try { if (env.session) allKeys(env.session).filter(k => /^ppp/i.test(k)).forEach(k => env.session.removeItem(k)); } catch (e) { /* session keys are not data */ }
      try { if (env.document) env.document.cookie = 'ppp_locale=; Path=/; Max-Age=0; SameSite=Lax'; } catch (e) { /* a cookie is not data */ }
      report.failed = failed;
      report.left.keys = pppKeys(env.storage);
      const dl = await dbsLeft(env);
      report.left.dbs = dl || [];
      if (!failed.length && !report.left.keys.length && !report.left.dbs.length) break;
      if (failed.some(f => f.why === 'blocked')) break;
    }
    report.ok = !report.failed.length && !report.left.keys.length && !report.left.dbs.length;
    return report;
  }

  /* ---------------------------------------------------------------- one message across the reload that follows a restore */
  function flashSet(session, obj) { try { session.setItem(FLASH_KEY, JSON.stringify(obj)); } catch (e) { /* the restore itself is done */ } }
  function flashTake(session) {
    try {
      const v = parse(session.getItem(FLASH_KEY) || 'null');
      session.removeItem(FLASH_KEY);
      return isObj(v) ? v : null;
    } catch (e) { return null; }
  }

  return Object.freeze({
    FORMAT, VERSION, LIMITS, KEY, STATE_FIELDS,
    build, encode, decode, validate, plan, apply, summary, wipe, fileName,
    mergeHistory, mergeMemory, mergeSecs, mergeSlot, mergeState, mergeCourse,
    scoreKeyOf, copyIdOf, pppKeys, flashSet, flashTake
  });
});
