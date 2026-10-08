/* ============================================================================
   PPP practice run log (docs/GOALS/G11_ADAPTIVE_PRACTICE.md G11-D4, G11-D5, G11-D6; phase G11b-1)

   A UMD module (Node + browser; global PPPRunLog). The page asks for it ONLY while PPP.learner is 'typed' (the default is
   'legacy': the file is then never requested, nothing is written and nothing is read). It has no DOM and no clock of its
   own; the page hands it the finished lap.

   ---- Typed evidence (G11-D5) ----
   Every run is one of four kinds, `src`:
     measured    a clock run judged by the matcher (a MIDI keyboard was attached)
     follow      Follow mode: the notes asked for, no timing, never evidence of tempo
     memory      a recall attempt (notes hidden, hints counted)
     simulated   Demo Input (no keyboard): random hits drawn from the section's displayed accuracy. NOT evidence.
   The log refuses a simulated entry (append answers {ok:false, code:'simulated'}); a simulated run only bumps a counter on the
   epoch (`sim`), so an export tells how much of the practice had no keyboard, and the model that reads evidence() can never see it.

   ---- The log (G11-D6) ----
   Per song, per EPOCH. An epoch is one music hash of one song: a rewrite, an edit or a re-import changes the hash and starts a new
   epoch; the old one is kept and is READ-ONLY (only the song's current epoch takes new runs). Evidence is keyed (song id, music
   hash, measure INDEX): measure numbers repeat and skip, indexes do not. At most 300 runs per epoch (the oldest is dropped),
   each at most 2048 bytes of JSON. Append-only: a run is never edited; a rating is a separate small record.

   One run (short keys, so that 300 of them stay small; the export carries the same legend as `schema`):
     {v:1, id, at, src, md, hd, tp, sr, f, t, g, hn, lv, ex, ht, wr, xt, ac, R:[...], W:[...], tr}
       md 'practice'|'memory'   hd 'b'|'l'|'r' (both, left, right)   tp bpm   sr tempo / score tempo   f..t measure INDEX range
       g  measures per row (1 = one row per measure and hand; a long run is merged by 2, 4, 8.. until it fits 2 KB)
       hn hints in use   lv memory level   ex/ht expected and matched notes   wr/xt wrong and extra keys   ac accuracy 0..1
       R  rows [measureIndex, hand 0 right|1 left, expected, matched, signedMeanMs|null, absMeanMs|null, [missedNoteIds]?]
       W  [measureIndex, wrong, extra] where either is not 0        tr 1 when even one row per run did not fit
   A missed note id is the note's index in the Score's note list, which is fixed for a music hash (so it means something only
   inside its epoch).

   ---- Where it lives ----
   IndexedDB 'ppp-runlog' v1 (songs, epochs, runs, ratings), next to the engraver's 'ppp-engrave' and the videos' 'ppp-media';
   the localStorage aggregates are untouched. A backend is {append, noteSim, rate, readEpoch, listEpochs, forget}; memoryBackend()
   has the same contract for Node and for a browser without IndexedDB.

   ---- Failing storage ----
   A blocked database, a full disk, a database that will not open, a call that does not answer in time: the first such failure
   DEGRADES the log for the rest of the session (every later call answers {ok:false, code:'degraded'} at once, nothing is
   retried, no message is shown) and is counted in stats. A damaged record is skipped and counted (stats.corrupt); it never
   takes the rest down. The page works exactly as it does under 'legacy'.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPRunLog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const SOURCES = Object.freeze(['measured', 'follow', 'memory', 'simulated']);
  /* runs: per epoch; bytes: one run's JSON; body: what a builder may fill (a rating adds a few bytes later); ids: missed ids kept per row / per run; timeout: one backend call (ms) */
  const CAPS = Object.freeze({ runs: 300, bytes: 2048, body: 2000, ids: 6, idsTotal: 36, timeout: 2500, title: 120 });
  const DB_NAME = 'ppp-runlog', DB_VERSION = 1;
  const MAX_SEQ = Number.MAX_SAFE_INTEGER;

  const SCHEMA = Object.freeze({
    run: 'v version; id run id; at ms since 1970; src measured|follow|memory (simulated runs are not logged); md practice|memory; hd b both|l left|r right; ' +
      'tp tempo bpm; sr tempo/score tempo; f,t first and last measure INDEX; g measures per row; hn hints in use; lv memory level; ex expected notes; ht matched notes; ' +
      'wr wrong keys; xt extra keys; ac accuracy 0..1; R rows [measureIndex, hand(0 right,1 left), expected, matched, signedMeanMs, absMeanMs, missedNoteIds?]; ' +
      'W [measureIndex, wrong, extra]; tr 1 = rows dropped to fit 2 KB; rt (export only) the player\'s rating 1 easy|2 just right|3 hard',
    epoch: 'songId; hash = the music hash of the song (a rewrite or an edit is a new epoch); current = the song\'s writable epoch; measures; idKind note (a missed id is an index into the Score notes); sim = runs without a keyboard (counted, not logged)'
  });

  const isNum = v => typeof v === 'number' && isFinite(v);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const count = (o, k) => { o[k] = (o[k] || 0) + 1; };

  /* UTF-8 length of a string without TextEncoder (Node and every browser alike) */
  function byteLen(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

  /* ------------------------------------------------------------------ one run */
  const HANDS = { both: 'b', left: 'l', right: 'r' };
  const r3 = v => Math.round(v * 1000) / 1000;

  /* input: {id, at, src, mode, hands, tempo, scoreTempo, from, to, hints, level, expected, matched, wrong, extra, accuracy,
             rows: [{mi, h, e, k, sd, ad, ids}], wrongs: [{mi, w, x}]}  (indexes, not measure numbers; sd/ad are SUMS of signed and
             absolute ms over the matched notes, or null when not measured)
     -> {entry, bytes, g, ids}. Always at most CAPS.body bytes: when the rows do not fit, neighbouring measures are merged. */
  function buildEntry(input) {
    const from = isNum(input.from) ? input.from : 0;
    const to = isNum(input.to) ? input.to : from;
    const head = {
      v: VERSION, id: String(input.id), at: input.at, src: input.src, md: input.mode === 'memory' ? 'memory' : 'practice',
      hd: HANDS[input.hands] || 'b', tp: isNum(input.tempo) ? Math.round(input.tempo * 10) / 10 : 0,
      sr: input.scoreTempo > 0 ? r3(input.tempo / input.scoreTempo) : 1, f: from, t: to
    };
    const tail = {
      hn: input.hints | 0, lv: input.level | 0, ex: input.expected | 0, ht: input.matched | 0, wr: input.wrong | 0, xt: input.extra | 0,
      ac: r3(isNum(input.accuracy) ? input.accuracy : 0)
    };
    const rows = input.rows || [], wrongs = input.wrongs || [];

    const make = (g, withIds) => {
      const seg = mi => from + Math.floor((mi - from) / g) * g;
      const acc = new Map();
      let idLeft = CAPS.idsTotal;
      rows.forEach(r => {
        const s = seg(r.mi), key = s * 2 + r.h;
        let a = acc.get(key);
        if (!a) { a = { mi: s, h: r.h ? 1 : 0, e: 0, k: 0, sd: 0, ad: 0, sdOk: true, adOk: true, ids: [] }; acc.set(key, a); }
        a.e += r.e; a.k += r.k;
        if (r.k > 0) {
          if (r.sd == null) a.sdOk = false; else a.sd += r.sd;
          if (r.ad == null) a.adOk = false; else a.ad += r.ad;
        }
        if (withIds && r.ids && r.ids.length) {
          for (let i = 0; i < r.ids.length && idLeft > 0 && a.ids.length < CAPS.ids; i++, idLeft--) a.ids.push(r.ids[i]);
        }
      });
      const R = [...acc.values()].sort((a, b) => a.mi - b.mi || a.h - b.h).map(a => {
        const row = [a.mi, a.h, a.e, a.k, a.k && a.sdOk ? Math.round(a.sd / a.k) : null, a.k && a.adOk ? Math.round(a.ad / a.k) : null];
        if (a.ids.length) row.push(a.ids.slice().sort((x, y) => x - y));
        return row;
      });
      const wacc = new Map();
      wrongs.forEach(w => {
        if (!w.w && !w.x) return;
        const s = seg(w.mi);
        const a = wacc.get(s) || { mi: s, w: 0, x: 0 };
        a.w += w.w | 0; a.x += w.x | 0; wacc.set(s, a);
      });
      const W = [...wacc.values()].sort((a, b) => a.mi - b.mi).map(a => [a.mi, a.w, a.x]);
      return Object.assign({}, head, { g: g }, tail, { R: R, W: W });
    };

    /* One row per measure and hand, with the missed ids; then without the ids; then neighbouring measures merged, by the number of times it was too big (the rows shrink in step with g) */
    const span = Math.max(1, to - from + 1);
    const hasIds = rows.some(r => r.ids && r.ids.length);
    let g = 1, withIds = hasIds;
    while (g < span * 2) {
      const e = make(g, withIds);
      const bytes = byteLen(JSON.stringify(e));
      if (bytes <= CAPS.body) return { entry: e, bytes: bytes, g: g, ids: withIds };
      if (withIds) { withIds = false; continue; }
      let next = g * 2;
      while (next < g * (bytes / CAPS.body) && next < span * 2) next *= 2;
      g = next;
    }
    /* cannot happen for a real run (one row per hand covers any range); a last resort that still fits */
    const e = Object.assign({}, head, { g: span }, tail, { R: [], W: [], tr: 1 });
    return { entry: e, bytes: byteLen(JSON.stringify(e)), g: span, ids: false };
  }

  /* ------------------------------------------------------------------ a Score, once per object */
  const infos = new WeakMap();
  /* hashFn: score -> {hash, hashV} | string (the page passes PPPEngrave.scoreHash). Computed on first use and remembered per Score object;
     warm() computes it ahead of the first lap (idle time), so the lap itself only reads it. */
  function scoreInfo(score, hashFn) {
    let info = infos.get(score);
    if (info) return info;
    const ms = score.measures || [];
    const byNumber = new Map();
    ms.forEach((m, i) => { if (!byNumber.has(m.number)) byNumber.set(m.number, i); });
    let ids = null;
    info = {
      measures: ms.length,
      scoreTempo: score.tempo || 0,
      title: score.title || '',
      idxOf(number) { const i = byNumber.get(number); return i == null ? -1 : i; },
      noteId(note) {
        if (!ids) { ids = new Map(); (score.notes || []).forEach((n, i) => ids.set(n, i)); }
        const i = ids.get(note);
        return i == null ? -1 : i;
      },
      /* the music hash and the note ids, ahead of the first lap that needs them */
      warm() { info.hash(); info.noteId(null); return info; },
      _hash: null,
      hash() {
        if (!info._hash) {
          let h = null;
          try { h = typeof hashFn === 'function' ? hashFn(score) : null; } catch (e) { h = null; }
          if (h && typeof h === 'object') info._hash = { hash: String(h.hash), hashV: String(h.hashV || 'h') };
          else if (h) info._hash = { hash: String(h), hashV: 'h2' };
          else info._hash = { hash: localHash(score), hashV: 'x1' };
        }
        return info._hash;
      }
    };
    infos.set(score, info);
    return info;
  }

  /* the fallback music hash, when the page's own is not there: FNV-1a over measure numbers, lengths and every note's position, pitch and hand */
  function localHash(score) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef;
    const feed = s => {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
      }
    };
    (score.measures || []).forEach(m => feed('m' + m.number + ':' + (m.lenQ || 0) + ';'));
    (score.notes || []).forEach(n => feed([n.m, Math.round((+n.b || 0) * 1e6), Math.round((+n.dur || 0) * 1e6), n.midi == null ? '' : n.midi, n.rest ? 'r' : '', n.hand || '', n.staff || 1, n.tieStop ? 't' : ''].join(',') + ';'));
    const hex = n => ('00000000' + n.toString(16)).slice(-8);
    return hex(h1) + hex(h2);
  }

  /* The rows of a finished clock run, from the matcher itself (PerformanceEngine: expected[], wrong[], extras[]): per measure index and hand
     the expected and matched notes, the signed and absolute sums of the time errors, and which notes were missed. info: scoreInfo(). */
  function rowsFromEngine(perf, info) {
    const acc = new Map();
    let ex = 0, ht = 0;
    const list = perf.expected || [];
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      const mi = info.idxOf(x.m);
      if (mi < 0) continue;
      const h = x.hand === 'l' ? 1 : 0, key = mi * 2 + h;
      let a = acc.get(key);
      if (!a) { a = { mi: mi, h: h, e: 0, k: 0, sd: 0, ad: 0, ids: [] }; acc.set(key, a); }
      a.e++; ex++;
      if (x.matched) { a.k++; ht++; a.sd += x.deltaMs; a.ad += Math.abs(x.deltaMs); }
      else if (a.ids.length < CAPS.ids) { const id = info.noteId(x.note); if (id >= 0) a.ids.push(id); }
    }
    return { rows: [...acc.values()], expected: ex, matched: ht };
  }

  /* The rows of a result when the matcher's own list is not at hand (Follow mode's tally, a result made by hand): totals and the absolute
     timing sums per measure and hand; no signed mean, no ids. */
  function rowsFromResult(result, info) {
    const rows = [];
    let ex = 0, ht = 0;
    const bm = (result && result.byMeasure) || {};
    Object.keys(bm).forEach(k => {
      const mi = info.idxOf(+k);
      if (mi < 0) return;
      const b = bm[k];
      ['r', 'l'].forEach((hd, h) => {
        const hs = b.hands && b.hands[hd];
        if (!hs || !hs.total) return;
        const timed = hs.timingCount > 0;
        rows.push({ mi: mi, h: h, e: hs.total, k: hs.matched, sd: null, ad: timed ? hs.timingAbsSum : (hs.matched ? null : 0), ids: null });
        ex += hs.total; ht += hs.matched;
      });
    });
    return { rows, expected: ex, matched: ht };
  }

  /* wrong and extra keys per measure index, from a result */
  function wrongsFromResult(result, info) {
    const out = [];
    const bm = (result && result.byMeasure) || {};
    Object.keys(bm).forEach(k => {
      const b = bm[k], mi = info.idxOf(+k);
      if (mi >= 0 && ((b.wrong | 0) || (b.extra | 0))) out.push({ mi: mi, w: b.wrong | 0, x: b.extra | 0 });
    });
    return out;
  }

  /* ------------------------------------------------------------------ checking what is read */
  function validRow(r) {
    return Array.isArray(r) && (r.length === 6 || r.length === 7) && isNum(r[0]) && (r[1] === 0 || r[1] === 1) && isNum(r[2]) && isNum(r[3]) &&
      (r[4] === null || isNum(r[4])) && (r[5] === null || isNum(r[5])) && (r.length === 6 || (Array.isArray(r[6]) && r[6].every(isNum)));
  }
  function validEntry(e) {
    return isObj(e) && e.v === VERSION && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 40 && isNum(e.at) &&
      SOURCES.indexOf(e.src) >= 0 && (e.md === 'practice' || e.md === 'memory') && (e.hd === 'b' || e.hd === 'l' || e.hd === 'r') &&
      isNum(e.tp) && isNum(e.sr) && isNum(e.f) && isNum(e.t) && isNum(e.g) && isNum(e.hn) && isNum(e.lv) && isNum(e.ex) && isNum(e.ht) &&
      isNum(e.wr) && isNum(e.xt) && isNum(e.ac) && Array.isArray(e.R) && e.R.every(validRow) &&
      Array.isArray(e.W) && e.W.every(w => Array.isArray(w) && w.length === 3 && w.every(isNum));
  }
  const ENTRY_KEYS = ['v', 'id', 'at', 'src', 'md', 'hd', 'tp', 'sr', 'f', 't', 'g', 'hn', 'lv', 'ex', 'ht', 'wr', 'xt', 'ac', 'R', 'W', 'tr'];
  /* a copy with only the known keys: nothing else a caller put on a run can leave through the export */
  function pickEntry(e) { const o = {}; ENTRY_KEYS.forEach(k => { if (e[k] !== undefined) o[k] = e[k]; }); return o; }
  function validEpoch(e) {
    return isObj(e) && typeof e.ep === 'string' && typeof e.songId === 'string' && typeof e.hash === 'string' && e.ep === e.songId + '|' + e.hash;
  }

  /* ------------------------------------------------------------------ what a backend decides, in one place */
  /* info: what the backend read in the transaction {epoch, song, count (runs now), last (highest seq or null)}; a: the append.
     -> the new epoch record, the song's current epoch, the sequence number of the new run and how many of the oldest to drop. */
  function planAppend(info, a, cap) {
    const old = validEpoch(info.epoch) ? info.epoch : null;
    const n = info.last == null ? 1 : info.last + 1;
    const excess = Math.max(0, info.count + 1 - cap);
    const m = a.meta || {};
    const epoch = Object.assign({ v: VERSION, ep: a.songId + '|' + a.hash, songId: a.songId, hash: a.hash, created: a.at, sim: { n: 0, last: null } },
      old || {}, { hashV: a.hashV || null, measures: m.measures | 0, scoreTempo: isNum(m.scoreTempo) ? m.scoreTempo : 0, title: clean(m.title, CAPS.title), idKind: 'note', last: a.at });
    if (!isObj(epoch.sim) || !isNum(epoch.sim.n)) epoch.sim = { n: 0, last: null };
    return { n: n, excess: excess, epoch: epoch, song: { songId: a.songId, current: a.hash, at: a.at }, repaired: !!info.epoch && !old };
  }
  /* a run without a keyboard: the epoch (made if it is new) counts it */
  function planSim(info, a) {
    const p = planAppend({ epoch: info.epoch, count: 0, last: null }, a, CAPS.runs);
    p.epoch.sim = { n: (p.epoch.sim.n | 0) + 1, last: a.at };
    return p;
  }

  /* ------------------------------------------------------------------ backends */
  /* The same contract in memory (Node, and a browser without IndexedDB). A failure is injected with opts.fail(op) (a test). */
  function memoryBackend(opts) {
    const o = opts || {};
    const songs = new Map(), epochs = new Map(), runs = new Map(), ratings = new Map();
    const guard = op => { if (typeof o.fail === 'function') { const e = o.fail(op); if (e) throw e; } };
    const list = ep => { if (!runs.has(ep)) runs.set(ep, []); return runs.get(ep); };
    const be = {
      kind: 'memory',
      async append(a) {
        guard('append');
        const ep = a.songId + '|' + a.hash, rs = list(ep);
        const p = planAppend({ epoch: epochs.get(ep), count: rs.length, last: rs.length ? rs[rs.length - 1].n : null }, a, a.cap || CAPS.runs);
        rs.push({ ep: ep, n: p.n, e: a.entry });
        const drop = rs.splice(0, p.excess);
        drop.forEach(d => ratings.delete(ep + '\u0000' + d.n));
        epochs.set(ep, p.epoch);
        songs.set(a.songId, p.song);
        return { n: p.n, dropped: p.excess, repaired: p.repaired };
      },
      async noteSim(a) {
        guard('noteSim');
        const ep = a.songId + '|' + a.hash;
        const p = planSim({ epoch: epochs.get(ep) }, a);
        epochs.set(ep, p.epoch);
        songs.set(a.songId, p.song);
        return { sim: p.epoch.sim.n };
      },
      async rate(a) {
        guard('rate');
        const ep = a.songId + '|' + a.hash;
        if (!list(ep).some(r => r.n === a.n)) return { ok: false };
        ratings.set(ep + '\u0000' + a.n, { ep: ep, n: a.n, v: a.v, at: a.at });
        return { ok: true };
      },
      async readEpoch(songId, hash) {
        guard('readEpoch');
        const ep = songId + '|' + hash;
        return {
          epoch: epochs.get(ep) || null, song: songs.get(songId) || null,
          runs: list(ep).map(r => ({ ep: r.ep, n: r.n, e: r.e })),
          ratings: [...ratings.values()].filter(r => r.ep === ep)
        };
      },
      async listEpochs(songId) {
        guard('listEpochs');
        const out = [...epochs.values()].filter(e => songId == null || (isObj(e) && e.songId === songId)).map(e => ({ epoch: e, runs: validEpoch(e) ? list(e.ep).length : 0 }));
        return { epochs: out, songs: [...songs.values()] };
      },
      async forget(songId) {
        guard('forget');
        [...epochs.values()].forEach(e => { if (isObj(e) && e.songId === songId) { runs.delete(e.ep); epochs.delete(e.ep); [...ratings.keys()].forEach(k => { if (k.indexOf(e.ep + '\u0000') === 0) ratings.delete(k); }); } });
        songs.delete(songId);
        return true;
      },
      /* test hooks: write a raw record the way damage would */
      _raw: { songs, epochs, runs, ratings }
    };
    return be;
  }

  /* IndexedDB 'ppp-runlog' v1. openTimeout: how long `open` may stay pending (a blocked upgrade) before it counts as failed. */
  function idbBackend(idb, opts) {
    const openTimeout = (opts && opts.openTimeout) || CAPS.timeout;
    const stats = { opens: 0 };
    let db = null;
    const open = () => {
      if (db) return db;
      stats.opens++;
      db = new Promise((resolve, reject) => {
        let req, settled = false;
        const t = setTimeout(() => { settled = true; const e = new Error('timeout'); e.code = 'timeout'; reject(e); }, openTimeout);
        if (t && typeof t.unref === 'function') t.unref();
        const finish = ok => {
          if (settled) { if (ok) { try { req.result.close(); } catch (e) { /* closed */ } } return false; }
          settled = true; clearTimeout(t); return true;
        };
        try {
          if (!idb) throw Object.assign(new Error('no indexedDB'), { name: 'SecurityError' });
          req = idb.open(DB_NAME, DB_VERSION);
        } catch (e) { settled = true; clearTimeout(t); reject(e); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'songId' });
          if (!d.objectStoreNames.contains('epochs')) d.createObjectStore('epochs', { keyPath: 'ep' }).createIndex('bySong', 'songId');
          if (!d.objectStoreNames.contains('runs')) d.createObjectStore('runs', { keyPath: ['ep', 'n'] });
          if (!d.objectStoreNames.contains('ratings')) d.createObjectStore('ratings', { keyPath: ['ep', 'n'] });
        };
        req.onsuccess = () => {
          if (!finish(true)) return;
          const d = req.result;
          d.onversionchange = () => { try { d.close(); } catch (e) { /* closed */ } db = null; };
          d.onclose = () => { db = null; };
          resolve(d);
        };
        req.onerror = () => { if (finish(false)) reject(req.error || new Error('open failed')); };
        req.onblocked = () => { if (finish(false)) reject(new Error('blocked')); };
      });
      db.catch(() => { db = null; });
      return db;
    };
    /* one transaction; fn(t, setResult, on) issues the requests and wraps each callback in on(), so that an exception thrown inside one (a put the browser refuses on the spot)
       aborts the transaction and rejects with that exception instead of escaping to the page; resolves with the result when the transaction has COMMITTED */
    const run = (stores, mode, fn) => open().then(d => new Promise((resolve, reject) => {
      let t, out, dead = false;
      const fail = e => { if (dead) return; dead = true; try { t.abort(); } catch (x) { /* already over */ } reject(e); };
      const on = f => ev => { try { f(ev); } catch (e) { fail(e); } };
      try { t = d.transaction(stores, mode); } catch (e) { reject(e); return; }
      t.oncomplete = () => { if (!dead) resolve(out); };
      t.onerror = () => { if (!dead) { dead = true; reject(t.error || new Error('transaction failed')); } };
      t.onabort = () => { if (!dead) { dead = true; reject(t.error || new Error('transaction aborted')); } };
      try { fn(t, v => { out = v; }, on); } catch (e) { fail(e); }
    }));
    const rangeOf = ep => IDBKeyRange.bound([ep, 0], [ep, MAX_SEQ]);

    return {
      kind: 'indexeddb', stats: stats,
      append(a) {
        const ep = a.songId + '|' + a.hash;
        return run(['songs', 'epochs', 'runs', 'ratings'], 'readwrite', (t, set, on) => {
          const rs = t.objectStore('runs'), es = t.objectStore('epochs'), ss = t.objectStore('songs'), ts = t.objectStore('ratings');
          const range = rangeOf(ep), info = { epoch: undefined, count: 0, last: null };
          let waiting = 3;
          const go = () => {
            const p = planAppend(info, a, a.cap || CAPS.runs);
            rs.put({ ep: ep, n: p.n, e: a.entry });
            if (p.excess > 0) {
              let left = p.excess;
              rs.openCursor(range).onsuccess = on(ev => {
                const c = ev.target.result;
                if (!c || left <= 0) return;
                ts.delete(c.key); c.delete(); left--; c.continue();
              });
            }
            es.put(p.epoch);
            ss.put(p.song);
            set({ n: p.n, dropped: p.excess, repaired: p.repaired });
          };
          const done = () => { if (--waiting === 0) go(); };
          es.get(ep).onsuccess = on(ev => { info.epoch = ev.target.result; done(); });
          rs.count(range).onsuccess = on(ev => { info.count = ev.target.result; done(); });
          rs.openKeyCursor(range, 'prev').onsuccess = on(ev => { const c = ev.target.result; info.last = c ? c.key[1] : null; done(); });
        });
      },
      noteSim(a) {
        const ep = a.songId + '|' + a.hash;
        return run(['songs', 'epochs'], 'readwrite', (t, set, on) => {
          t.objectStore('epochs').get(ep).onsuccess = on(ev => {
            const p = planSim({ epoch: ev.target.result }, a);
            t.objectStore('epochs').put(p.epoch);
            t.objectStore('songs').put(p.song);
            set({ sim: p.epoch.sim.n });
          });
        });
      },
      rate(a) {
        const ep = a.songId + '|' + a.hash;
        return run(['runs', 'ratings'], 'readwrite', (t, set, on) => {
          t.objectStore('runs').get([ep, a.n]).onsuccess = on(ev => {
            if (!ev.target.result) { set({ ok: false }); return; }
            t.objectStore('ratings').put({ ep: ep, n: a.n, v: a.v, at: a.at });
            set({ ok: true });
          });
        });
      },
      readEpoch(songId, hash) {
        const ep = songId + '|' + hash;
        return run(['songs', 'epochs', 'runs', 'ratings'], 'readonly', (t, set, on) => {
          const out = { epoch: null, song: null, runs: [], ratings: [] };
          let waiting = 4;
          const done = () => { if (--waiting === 0) set(out); };
          t.objectStore('epochs').get(ep).onsuccess = on(ev => { out.epoch = ev.target.result || null; done(); });
          t.objectStore('songs').get(songId).onsuccess = on(ev => { out.song = ev.target.result || null; done(); });
          t.objectStore('runs').getAll(rangeOf(ep)).onsuccess = on(ev => { out.runs = ev.target.result || []; done(); });
          t.objectStore('ratings').getAll(rangeOf(ep)).onsuccess = on(ev => { out.ratings = ev.target.result || []; done(); });
        });
      },
      listEpochs(songId) {
        return run(['songs', 'epochs', 'runs'], 'readonly', (t, set, on) => {
          const out = { epochs: [], songs: [] };
          t.objectStore('songs').getAll().onsuccess = on(ev => { out.songs = ev.target.result || []; });
          const es = t.objectStore('epochs');
          const req = songId == null ? es.getAll() : es.index('bySong').getAll(songId);
          req.onsuccess = on(ev => {
            const eps = ev.target.result || [];
            if (!eps.length) { set(out); return; }
            let waiting = eps.length;
            eps.forEach(e => {
              const row = { epoch: e, runs: 0 };
              out.epochs.push(row);
              if (!validEpoch(e)) { if (--waiting === 0) set(out); return; }
              t.objectStore('runs').count(rangeOf(e.ep)).onsuccess = on(ev2 => { row.runs = ev2.target.result; if (--waiting === 0) set(out); });
            });
          });
        });
      },
      forget(songId) {
        return run(['songs', 'epochs', 'runs', 'ratings'], 'readwrite', (t, set, on) => {
          t.objectStore('epochs').index('bySong').getAll(songId).onsuccess = on(ev => {
            (ev.target.result || []).forEach(e => {
              if (!validEpoch(e)) return;
              t.objectStore('runs').delete(rangeOf(e.ep));
              t.objectStore('ratings').delete(rangeOf(e.ep));
              t.objectStore('epochs').delete(e.ep);
            });
            t.objectStore('songs').delete(songId);
            set(true);
          });
        });
      }
    };
  }

  /* ------------------------------------------------------------------ the log */
  function within(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { const e = new Error('timeout'); e.code = 'timeout'; reject(e); }, ms);
      if (t && typeof t.unref === 'function') t.unref();
      Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }
  function classify(e) {
    if (e && e.code === 'timeout') return 'timeout';
    const s = ((e && e.name) || '') + ' ' + ((e && e.message) || '');
    if (/quota/i.test(s)) return 'quota';
    if (/VersionError/i.test(s)) return 'version';
    if (/blocked|SecurityError|denied|no indexedDB|InvalidStateError/i.test(s)) return 'blocked';
    return 'backend';
  }

  /* opts: {backend, now, caps: {runs, timeout}, onDegrade(code)} */
  function createLog(opts) {
    opts = opts || {};
    const backend = opts.backend || memoryBackend();
    const now = opts.now || (() => Date.now());
    const cap = (opts.caps && opts.caps.runs) || CAPS.runs;
    const timeout = (opts.caps && opts.caps.timeout) || CAPS.timeout;
    const stats = { appended: 0, dropped: 0, simulated: 0, rated: 0, skipped: 0, refused: {}, errors: {}, corrupt: 0, repaired: 0, degraded: null, degradedAt: null, backend: backend.kind };
    let degraded = null;
    let chain = Promise.resolve();

    const fatal = e => {
      const code = classify(e);
      count(stats.errors, code);
      if (!degraded) {
        degraded = code; stats.degraded = code; stats.degradedAt = now();
        if (typeof opts.onDegrade === 'function') { try { opts.onDegrade(code); } catch (x) { /* a listener is not the log's problem */ } }
      }
      return { ok: false, code: code };
    };
    /* every operation runs after the one before it; none throws; after a degrade none touches the backend */
    const enqueue = (fn, quiet) => {
      const p = chain.then(() => {
        if (degraded) { if (!quiet) stats.skipped++; return { ok: false, code: 'degraded' }; }
        return Promise.resolve().then(fn).catch(fatal);
      });
      chain = p.then(() => {}, () => {});
      return p;
    };
    const refuse = code => { count(stats.refused, code); return Promise.resolve({ ok: false, code: code }); };
    const idOk = s => typeof s === 'string' && s.length > 0 && s.length <= 200;

    /* corrupt rows are skipped and counted; what is left is in sequence order */
    const sortedRuns = (raw, ratings) => {
      const rate = new Map();
      (ratings || []).forEach(r => { if (isObj(r) && isNum(r.n) && (r.v === 1 || r.v === 2 || r.v === 3)) rate.set(r.n, r.v); });
      const out = [];
      (raw || []).forEach(r => {
        if (!isObj(r) || !isNum(r.n) || !validEntry(r.e) || r.e.src === 'simulated') { stats.corrupt++; return; }
        const e = pickEntry(r.e);
        if (rate.has(r.n)) e.rt = rate.get(r.n);
        out.push({ n: r.n, run: e });
      });
      return out.sort((a, b) => a.n - b.n);
    };
    const epochSummary = (e, runs, current) => ({
      songId: e.songId, hash: e.hash, hashV: e.hashV || null, current: current, readOnly: !current, measures: e.measures | 0,
      scoreTempo: isNum(e.scoreTempo) ? e.scoreTempo : 0, title: clean(e.title, CAPS.title), idKind: 'note',
      created: isNum(e.created) ? e.created : 0, last: isNum(e.last) ? e.last : 0,
      sim: { n: isObj(e.sim) && isNum(e.sim.n) ? e.sim.n : 0, last: isObj(e.sim) && isNum(e.sim.last) ? e.sim.last : null }, runs: runs
    });

    const log = {
      stats: stats, caps: { runs: cap, bytes: CAPS.bytes },
      get degraded() { return degraded; },
      idle() { return chain; },

      /* A finished run into the song's current epoch (a new music hash makes a new epoch and the old one read-only).
         meta: {measures, scoreTempo, title}. -> {ok, n, dropped} | {ok:false, code} ; never rejects. */
      append(songId, hash, entry, meta, hashV) {
        if (!idOk(songId) || !idOk(hash)) return refuse('key');
        if (!entry || entry.src === 'simulated') return refuse('simulated');
        if (!validEntry(entry)) return refuse('invalid');
        if (byteLen(JSON.stringify(entry)) > CAPS.bytes) return refuse('too-large');
        return enqueue(async () => {
          const r = await within(backend.append({ songId: songId, hash: hash, hashV: hashV || null, entry: pickEntry(entry), meta: meta || {}, at: now(), cap: cap }), timeout);
          stats.appended++; stats.dropped += r.dropped | 0; if (r.repaired) stats.repaired++;
          return { ok: true, n: r.n, dropped: r.dropped | 0 };
        });
      },
      /* a run without a keyboard: counted on the epoch, never logged */
      noteSimulated(songId, hash, meta, hashV) {
        if (!idOk(songId) || !idOk(hash)) return refuse('key');
        return enqueue(async () => {
          const r = await within(backend.noteSim({ songId: songId, hash: hash, hashV: hashV || null, meta: meta || {}, at: now() }), timeout);
          stats.simulated++;
          return { ok: true, sim: r.sim };
        });
      },
      /* the player's one-tap rating of run n (1 easy, 2 just right, 3 hard) */
      rate(songId, hash, n, v) {
        if (!idOk(songId) || !idOk(hash) || !isNum(n) || (v !== 1 && v !== 2 && v !== 3)) return refuse('invalid');
        return enqueue(async () => {
          const r = await within(backend.rate({ songId: songId, hash: hash, n: n, v: v, at: now() }), timeout);
          if (r && r.ok) stats.rated++;
          return r && r.ok ? { ok: true } : { ok: false, code: 'no-run' };
        });
      },
      /* one epoch: {ok, epoch, current, runs: [{n, run}]} (a damaged record is skipped and counted) */
      read(songId, hash) {
        return enqueue(async () => {
          const r = await within(backend.readEpoch(songId, hash), timeout);
          const cur = !!(r.song && r.song.current === hash);
          if (r.epoch && !validEpoch(r.epoch)) stats.corrupt++;
          const runs = sortedRuns(r.runs, r.ratings);
          return { ok: true, epoch: r.epoch && validEpoch(r.epoch) ? epochSummary(r.epoch, runs.length, cur) : null, current: cur, runs: runs };
        }, true);
      },
      /* THE evidence the model may read: the measured, follow and memory runs of one epoch. A simulated run is not here, and cannot be: append refuses it
         (a counter on the epoch is all a simulated run leaves) and read skips and counts a row that says simulated, however it got into the store. */
      evidence(songId, hash) { return log.read(songId, hash); },
      /* every epoch of a song (or of all songs) with its run count: {ok, epochs: [summary]} */
      epochs(songId) {
        return enqueue(async () => {
          const r = await within(backend.listEpochs(songId), timeout);
          const cur = new Map((r.songs || []).filter(isObj).map(s => [s.songId, s.current]));
          const out = [];
          (r.epochs || []).forEach(x => {
            if (!x || !validEpoch(x.epoch)) { stats.corrupt++; return; }
            out.push(epochSummary(x.epoch, x.runs | 0, cur.get(x.epoch.songId) === x.epoch.hash));
          });
          out.sort((a, b) => (a.songId < b.songId ? -1 : a.songId > b.songId ? 1 : a.created - b.created));
          return { ok: true, epochs: out };
        }, true);
      },
      /* the whole log as one plain object (the export file); damaged records are left out and counted in `skipped` */
      async exportAll() {
        const before = stats.corrupt;
        const list = await log.epochs();
        if (!list.ok) return list;
        const epochs = [];
        for (const s of list.epochs) {
          const r = await log.read(s.songId, s.hash);
          if (!r.ok) return r;
          epochs.push(Object.assign({}, s, { runs: r.runs.map(x => Object.assign({ n: x.n }, x.run)) }));
        }
        return { ok: true, file: { format: 'ppp-practice-log', version: VERSION, exportedAt: now(), schema: SCHEMA, epochs: epochs, skipped: { corrupt: stats.corrupt - before } } };
      },
      /* a song removed from My Songs takes its log with it */
      forget(songId) {
        if (!idOk(songId)) return refuse('key');
        return enqueue(async () => { await within(backend.forget(songId), timeout); return { ok: true }; });
      }
    };
    return log;
  }

  /* Compile the paths of a lap ahead of the first one (the page calls this in idle time): a tiny made-up run through the builder, the readers
     and the checks. It opens no database and writes nothing. */
  function warmUp(win) {
    try {
      const rows = [];
      for (let i = 0; i < 6; i++) rows.push({ mi: i, h: i & 1, e: 3, k: 2, sd: 10, ad: 20, ids: [i] });
      const b = buildEntry({ id: 'warm', at: 1, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 5, rows: rows,
        wrongs: [{ mi: 1, w: 1, x: 0 }], expected: 18, matched: 12, accuracy: 0.6 });
      validEntry(b.entry); pickEntry(b.entry); byteLen(JSON.stringify(b.entry));
      const info = { idxOf: n => n - 1, noteId: () => 0 };
      rowsFromEngine({ expected: [{ m: 1, hand: 'r', matched: true, deltaMs: 3, note: {} }, { m: 1, hand: 'l', matched: false, deltaMs: null, note: {} }] }, info);
      const res = { byMeasure: { 1: { wrong: 1, extra: 0, hands: { r: { total: 1, matched: 1, timingAbsSum: 1, timingCount: 1 }, l: { total: 0, matched: 0, timingAbsSum: 0, timingCount: 0 } } } } };
      rowsFromResult(res, info); wrongsFromResult(res, info);
      pageLog(win);
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ the export file */
  function fileName(ms) {
    const d = new Date(isNum(ms) ? ms : Date.now());
    const p = n => ('0' + n).slice(-2);
    return 'ppp-practice-log-' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '.json';
  }
  /* the text of the file (2-space indent: a person may open it) */
  function exportText(file) { return JSON.stringify(file, null, 1); }

  /* text -> {ok, file} | {ok:false, code}. Re-reads what exportAll wrote: the epochs that are well formed come back as they were, a
     damaged run or epoch is dropped and counted in `rejected`. */
  function parseExport(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { return { ok: false, code: 'json' }; }
    if (!isObj(d) || d.format !== 'ppp-practice-log') return { ok: false, code: 'format' };
    if (d.version !== VERSION) return { ok: false, code: 'version' };
    if (!Array.isArray(d.epochs)) return { ok: false, code: 'epochs' };
    let rejected = 0;
    const epochs = [];
    d.epochs.forEach(e => {
      if (!isObj(e) || typeof e.songId !== 'string' || typeof e.hash !== 'string' || !Array.isArray(e.runs)) { rejected++; return; }
      const runs = [];
      e.runs.forEach(r => {
        if (!isObj(r) || !isNum(r.n) || !validEntry(r) || r.src === 'simulated') { rejected++; return; }
        const run = Object.assign({ n: r.n }, pickEntry(r));
        if (r.rt === 1 || r.rt === 2 || r.rt === 3) run.rt = r.rt;
        runs.push(run);
      });
      epochs.push(Object.assign({}, e, { runs: runs }));
    });
    return { ok: true, file: Object.assign({}, d, { epochs: epochs }), rejected: rejected };
  }

  /* ------------------------------------------------------------------ in a browser */
  /* the log of this page: IndexedDB when there is one (a private window may refuse it, which the log reports as `degraded`) */
  let shared = null;
  function pageLog(win, opts) {
    if (shared) return shared;
    const w = win || (typeof window !== 'undefined' ? window : null);
    let idb = null;
    try { idb = w && w.indexedDB ? w.indexedDB : null; } catch (e) { idb = null; }
    shared = createLog(Object.assign({ backend: idb ? idbBackend(idb) : idbBackend(null) }, opts || {}));
    return shared;
  }
  function resetPageLog() { shared = null; }
  /* hand a text to the person as a file (an anchor with a download name) */
  function download(text, name, win) {
    const w = win || window;
    const blob = new w.Blob([text], { type: 'application/json' });
    const url = w.URL.createObjectURL(blob);
    const a = w.document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    w.document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { w.document.body.removeChild(a); w.URL.revokeObjectURL(url); } catch (e) { /* gone */ } }, 1000);
    return true;
  }

  return Object.freeze({
    VERSION, SOURCES, CAPS, SCHEMA, DB_NAME, DB_VERSION,
    buildEntry, scoreInfo, localHash, rowsFromEngine, rowsFromResult, wrongsFromResult,
    validEntry, validEpoch, pickEntry, byteLen, planAppend,
    memoryBackend, idbBackend, createLog, within, classify,
    fileName, exportText, parseExport, pageLog, resetPageLog, download, warmUp
  });
});
