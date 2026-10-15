/* PPP song sync, the rules (G13-S1; docs/GOALS/G13_PRODUCTIZATION.md sections 7.4, 7.5 and "G13-S1 as built").

   Pure: no storage, no network, no page. It is the part of "use my songs on other devices" that decides what two versions of a song, or of the progress that is
   not one song's, become when they meet. The engine (client.js) calls it; Node tests it alone (tests/sync-page/merge.test.js, with mutants of every rule).

   ITEMS (what travels; the server only stores them, sync.js SONG_FIELDS)
     song   { v:1, card, score, progress, scoreHash, savedAt }
              card      the card of My Songs without its id and without its `share` mark (a mark names THIS browser's posts)
              score     the packed Score exactly as the slot keeps it
              progress  everything else the slot holds (secs, history, memory, loop, tempo, mastered, importSource, ...)
              scoreHash hash of the canonical score text: two scores that say the same thing have the same hash whatever order a build wrote them in
              savedAt   when this device last changed it (milliseconds): the clock of the "newer" rules
     state  { ctr, sessions, skillMs, learnDone, learnLesson, learnStep, course, streak, demo, demoCard, savedAt }
              ctr       the per-device counters (xp, minutes): { xp: { <device>: { v, at } } }; the shown value is the sum (a G-counter, G13-D7)
   `hash` (what the server keeps beside a body, and what "the same" means) is contentHash(item): the canonical text without savedAt.

   MERGING (G13-D7), every rule commutative (the same result whichever device runs it) and idempotent (merging a version with itself changes nothing):
     score         one side changed it since the common point: that one wins. BOTH changed it: the newer stays the song, the other becomes a copy that is kept
                   (a song of its own, with a deterministic id, so two devices that fork the same pair make the same copy). Nothing is lost.
     practice      union by entry (per-measure record with more attempts, then the later; the runs by their key), per section the higher level, per field the larger
                   count, mastered if either, memLevel and blindRuns the larger
     loop, tempo   the newer side's, as a pair
     card          the fields that belong to the score follow the score; the rest the newer side's; addedAt the earlier, lastAt the later (prog and mem with it)
     xp, minutes   per-device counters: each device writes only its own entry, the entry with the later `at` wins, the value shown is the sum
     deletion      an edit beats a deletion (a song changed here is kept and brought back); 4 or more at once, or more than a fifth of the library, are asked first
   The practice-record merges are library-backup.js's (the same ones a restored backup uses); this file orders their arguments so that they commute. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root, function () { return require('../library-backup.js'); });
  else root.PPPSyncMerge = factory(root, function () { return root.PPPBackup; });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, getBackup) {
  'use strict';

  const VERSION = 1;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const B = () => { const b = getBackup(); if (!b) throw new Error('PPPBackup is not loaded'); return b; };

  /* what a song item may carry at the top (sync.js SONG_FIELDS) and the fields of a card that belong to the SCORE (they follow it when a score is taken over) */
  const SONG_FIELDS = ['v', 'card', 'score', 'progress', 'graph', 'scoreHash', 'savedAt'];
  const SCORE_BOUND = ['title', 'composer', 'measures', 'kind', 'url', 'arrangement', 'arrangedFrom', 'sharedFrom', 'courseFrom'];
  const CARD_DROP = ['id', 'share'];
  const COUNTERS = ['xp', 'minutes'];
  /* names and bounds of the keys of items: the server's KEY_RE */
  const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

  /* ---------------------------------------------------------------- canonical text and hashes */
  /* keys sorted, undefined left out: two items that say the same thing are the same text */
  function stable(v) {
    if (v === null || typeof v !== 'object') return v === undefined ? 'null' : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : stable(x))).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  /* cyrb53 (public domain): 53 bits of a string, with a seed. Not a secret and not a defence: it tells "the same text" from "another text". */
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const pad = (s, n) => { s = String(s); while (s.length < n) s = '0' + s; return s; };
  /* [A-Za-z0-9]{21,28}: what the server accepts as a hash (8-64 of [A-Za-z0-9_-]) */
  function hashText(s) {
    s = String(s);
    return 'c' + pad(cyrb53(s, 0).toString(36), 10) + pad(cyrb53(s, 40503).toString(36), 10) + s.length.toString(36);
  }
  /* What "the same" means: the canonical text of everything but the time and the score's own text. A score is represented by its scoreHash (made from its canonical text), so a
     slot that the page packed or unpacked in the meantime is the same song, and an item that only moved in time is not "changed". */
  function contentHash(item) {
    if (!isObj(item)) return '';
    const o = {};
    Object.keys(item).forEach(k => { if (k !== 'savedAt' && k !== 'score') o[k] = item[k]; });
    return hashText(stable(o));
  }
  /* a deterministic order for two sides that have nothing else to be told apart by */
  const textOf = v => stable(v);
  /* which side is newer: 'a' or 'b'. By time; a tie by the canonical text, so both devices pick the same one. */
  function newerSide(atA, atB, a, b) {
    const x = isNum(atA) ? atA : 0, y = isNum(atB) ? atB : 0;
    if (x !== y) return x > y ? 'a' : 'b';
    return textOf(a) >= textOf(b) ? 'a' : 'b';
  }
  /* f(x, y) with the arguments in a canonical order: a merge that is not symmetric (the practice-record merges keep the first argument on a tie) becomes so */
  function comm(f, x, y) { return textOf(x) <= textOf(y) ? f(x, y) : f(y, x); }
  const maxNum = (a, b) => (isNum(a) && isNum(b) ? Math.max(a, b) : isNum(a) ? a : b);

  /* ---------------------------------------------------------------- keys and identity */
  /* the name of a song's item. An id the server's name rule would refuse (too long, other characters) gets a name made of its hash. */
  function keyOf(id) {
    const s = String(id);
    return 'song:' + (ID_RE.test(s) ? s : 'x' + hashText(s).slice(1, 25));
  }
  const idOf = key => (typeof key === 'string' && key.indexOf('song:') === 0 ? key.slice(5) : null);
  const isSongKey = key => typeof key === 'string' && /^song:[A-Za-z0-9_.:-]{1,64}$/.test(key);
  /* the id of the copy made when two devices changed one score: the same song and the same losing score always give the same id */
  const forkIdOf = (key, scoreHash) => 'song-f' + hashText(String(key) + '|' + String(scoreHash)).slice(1, 17);
  /* songs are the same song when they share an identity, in this order of trust (docs 7.4): the method-book piece, the shared score, the arrangement of the same song at the same level, the score itself */
  function identityKeys(card, scoreHash) {
    const out = [];
    if (!isObj(card)) card = {};
    if (typeof card.courseFrom === 'string' && card.courseFrom) out.push('c:' + card.courseFrom);
    if (typeof card.sharedFrom === 'string' && card.sharedFrom) out.push('s:' + card.sharedFrom);
    if (typeof card.arrangedFrom === 'string' && card.arrangedFrom && isObj(card.arrangement) && card.arrangement.level) {
      out.push('a:' + card.arrangedFrom + '|' + card.arrangement.level + '|' + (card.arrangement.style || ''));
    }
    if (scoreHash) out.push('h:' + scoreHash);
    return out;
  }

  /* ---------------------------------------------------------------- items */
  function cleanCard(card) {
    const c = {};
    if (!isObj(card)) return c;
    Object.keys(card).forEach(k => { if (CARD_DROP.indexOf(k) < 0 && card[k] !== undefined && k !== '__proto__') c[k] = card[k]; });
    return c;
  }
  function slotProgress(slot) {
    const p = {};
    Object.keys(slot).forEach(k => { if (k !== 'score' && k !== '__proto__' && slot[k] !== undefined) p[k] = slot[k]; });
    return p;
  }
  function scoreHashOf(slot) {
    const k = B().scoreKeyOf(slot);
    return k === null ? '' : hashText(k);
  }
  /* a song item from a card and its slot (the parsed slot); null for a slot with no score (the built-in sample has none) */
  function buildSongItem(card, slot, savedAt) {
    if (!isObj(slot) || !isObj(slot.score)) return null;
    return { v: VERSION, card: cleanCard(card), score: slot.score, progress: slotProgress(slot), scoreHash: scoreHashOf(slot), savedAt: isNum(savedAt) ? savedAt : 0 };
  }
  const slotOfItem = item => Object.assign({}, isObj(item.progress) ? item.progress : {}, { score: item.score });
  /* the card a device keeps for an item: what it had (its own `share` mark), the item's fields, its own id */
  function cardOfItem(item, id, existing) {
    const out = Object.assign({}, isObj(existing) ? existing : {}, isObj(item.card) ? item.card : {});
    if (isObj(existing) && existing.share !== undefined) out.share = existing.share; else delete out.share;
    out.id = id;
    return out;
  }
  /* an item that arrived: is it a song (or the state) this page can keep? Hostile input: a library's code is all it takes to write an item. -> { ok, item, code, blanked } */
  function checkIncoming(key, obj) {
    if (!isObj(obj)) return { ok: false, code: 'not-object' };
    if (key === 'state') {
      if (Object.keys(obj).length > 64) return { ok: false, code: 'too-many-fields' };
      return { ok: true, item: obj, blanked: 0 };
    }
    if (!isSongKey(key)) return { ok: false, code: 'bad-key' };
    const unknown = Object.keys(obj).filter(k => SONG_FIELDS.indexOf(k) < 0);
    if (unknown.length) return { ok: false, code: 'unknown-field' };
    /* the whole of what arrived, as it arrived, through the backup module's bounds (nesting, size, a __proto__ key): copying first would turn such a key into a prototype */
    const raw = B().validate({ app: B().FORMAT, v: B().VERSION, library: { songs: [], demo: null }, slots: {}, raw: obj });
    if (!raw.ok) return { ok: false, code: raw.code };
    const sc = obj.score;
    if (!isObj(sc) || !Array.isArray(sc.measures) || !sc.measures.length || !Array.isArray(sc.notes)) return { ok: false, code: 'no-score' };
    if (obj.card !== undefined && !isObj(obj.card)) return { ok: false, code: 'bad-card' };
    if (obj.progress !== undefined && !isObj(obj.progress)) return { ok: false, code: 'bad-progress' };
    const item = { v: VERSION, card: isObj(obj.card) ? obj.card : {}, score: sc, progress: isObj(obj.progress) ? obj.progress : {}, scoreHash: '', savedAt: isNum(obj.savedAt) ? obj.savedAt : 0 };
    /* the backup module's own bounds (depth, nodes, a __proto__ key, link kinds) over the same shape it validates */
    const pseudo = { app: B().FORMAT, v: B().VERSION, library: { songs: [Object.assign({}, item.card, { id: 'sync-item' })], demo: null }, slots: { 'sync-item': slotOfItem(item) }, state: {} };
    const v = B().validate(pseudo);
    if (!v.ok) return { ok: false, code: v.code };
    const blanked = B().sanitize(pseudo);
    item.card = cleanCard(pseudo.library.songs[0]);
    const slot = pseudo.slots['sync-item'];
    item.score = slot.score;
    item.progress = slotProgress(slot);
    /* the hash of a score is made here, from the score, never taken from the sender */
    item.scoreHash = scoreHashOf({ score: item.score });
    return { ok: true, item: item, blanked: blanked };
  }

  /* ---------------------------------------------------------------- merging practice */
  function mergeProgress(pa, pb, atA, atB) {
    pa = isObj(pa) ? pa : {}; pb = isObj(pb) ? pb : {};
    const bk = B();
    const side = newerSide(atA, atB, pa, pb);
    const out = {};
    const keys = Object.keys(pa).concat(Object.keys(pb).filter(k => !has(pa, k)));
    keys.forEach(k => {
      if (k === '__proto__') return;
      const x = pa[k], y = pb[k];
      if (y === undefined) { out[k] = x; return; }
      if (x === undefined) { out[k] = y; return; }
      if (k === 'history') out[k] = comm(bk.mergeHistory, x, y);
      else if (k === 'memory') out[k] = comm(bk.mergeMemory, x, y);
      else if (k === 'secs') out[k] = comm(bk.mergeSecs, x, y);
      else if (k === 'memLevel' || k === 'blindRuns') out[k] = maxNum(x, y);
      else if (k === 'mastered') out[k] = !!(x || y);
      else out[k] = side === 'a' ? x : y;                       /* loop, tempo, file name, import source: the newer side's */
    });
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
    return out;
  }
  function mergeCard(ca, cb, side, scoreSide) {
    ca = isObj(ca) ? ca : {}; cb = isObj(cb) ? cb : {};
    const newer = side === 'a' ? ca : cb, older = side === 'a' ? cb : ca;
    const out = Object.assign({}, older, newer);
    if (scoreSide === 'a' || scoreSide === 'b') {
      const own = scoreSide === 'a' ? ca : cb;
      SCORE_BOUND.forEach(k => { if (has(own, k)) out[k] = own[k]; else delete out[k]; });
    }
    if (isNum(ca.addedAt) && isNum(cb.addedAt)) out.addedAt = Math.min(ca.addedAt, cb.addedAt);
    const la = isNum(ca.lastAt) ? ca.lastAt : 0, lb = isNum(cb.lastAt) ? cb.lastAt : 0;
    if (la || lb) {
      const last = la !== lb ? (la > lb ? ca : cb) : newer;
      out.lastAt = Math.max(la, lb);
      ['prog', 'mem'].forEach(k => { if (has(last, k)) out[k] = last[k]; });
    }
    return out;
  }

  /* Two versions of one song meet. local and remote are song items; base is what the two last agreed on ({ sh: scoreHash } or null when this device never synced it).
     -> { item, fork, scoreFrom }: item is what the song becomes; fork is null or { item, id } for the copy that is kept as a song of its own; scoreFrom 'same' | 'local' | 'remote' | 'fork'.
     `key` names the song (the id of a fork comes from it). */
  function mergeSong(local, remote, base, key) {
    const la = local.savedAt, ra = remote.savedAt;
    const side = newerSide(la, ra, local, remote);
    const finish = (scoreSide, from) => {
      const sc = scoreSide === 'a' ? local : remote;
      return {
        item: { v: VERSION, card: mergeCard(local.card, remote.card, side, from === 'same' ? null : scoreSide), score: sc.score,
          progress: mergeProgress(local.progress, remote.progress, la, ra), scoreHash: sc.scoreHash, savedAt: Math.max(isNum(la) ? la : 0, isNum(ra) ? ra : 0) },
        fork: null, scoreFrom: from
      };
    };
    if (local.scoreHash === remote.scoreHash) return finish('a', 'same');
    const sh = base && typeof base.sh === 'string' && base.sh ? base.sh : null;
    const localChanged = sh === null || local.scoreHash !== sh;
    const remoteChanged = sh === null || remote.scoreHash !== sh;
    if (!localChanged) return finish('b', 'remote');
    if (!remoteChanged) return finish('a', 'local');
    /* both changed the score: the newer stays, the other is kept as a copy */
    const keep = side === 'a' ? local : remote, lose = side === 'a' ? remote : local;
    const copy = { v: VERSION, card: cleanCard(lose.card), score: lose.score, progress: lose.progress, scoreHash: lose.scoreHash, savedAt: lose.savedAt };
    return {
      item: { v: VERSION, card: keep.card, score: keep.score, progress: keep.progress, scoreHash: keep.scoreHash, savedAt: Math.max(isNum(la) ? la : 0, isNum(ra) ? ra : 0) },
      fork: { item: copy, id: forkIdOf(key, lose.scoreHash), keptSide: side === 'a' ? 'local' : 'remote' },
      scoreFrom: 'fork'
    };
  }

  /* ---------------------------------------------------------------- the progress that is not one song's */
  /* per-device counters: { xp: { <device>: { v, at } } } */
  function ctrTotal(ctr, field) {
    const e = isObj(ctr) && isObj(ctr[field]) ? ctr[field] : {};
    let n = 0;
    Object.keys(e).forEach(d => { if (isObj(e[d]) && isNum(e[d].v)) n += e[d].v; });
    return n;
  }
  function ctrMerge(a, b) {
    const out = {};
    COUNTERS.forEach(f => {
      const ea = isObj(a) && isObj(a[f]) ? a[f] : {}, eb = isObj(b) && isObj(b[f]) ? b[f] : {};
      const o = {};
      Object.keys(ea).concat(Object.keys(eb)).forEach(d => {
        if (has(o, d) || d === '__proto__') return;
        const x = isObj(ea[d]) && isNum(ea[d].v) ? ea[d] : null, y = isObj(eb[d]) && isNum(eb[d].v) ? eb[d] : null;
        if (!x) o[d] = y; else if (!y) o[d] = x;
        else o[d] = (x.at || 0) !== (y.at || 0) ? ((x.at || 0) > (y.at || 0) ? x : y) : (x.v >= y.v ? x : y);
      });
      if (Object.keys(o).length) out[f] = o;
    });
    return out;
  }
  /* this device's own entry of a counter: how much of the shown value it added itself. `cur` is the value now on the page; rec is { own, seen } (null the first time: all
     there is, is this device's). -> { own, seen } */
  function ctrAdvance(rec, cur) {
    const c = isNum(cur) ? cur : 0;
    if (!isObj(rec) || !isNum(rec.own) || !isNum(rec.seen)) return { own: c, seen: c };
    const d = c - rec.seen;
    return { own: Math.max(0, rec.own + d), seen: c };
  }

  function mergeStateItems(local, remote) {
    local = isObj(local) ? local : {}; remote = isObj(remote) ? remote : {};
    const bk = B();
    const side = newerSide(local.savedAt, remote.savedAt, local, remote);
    const nw = side === 'a' ? local : remote, od = side === 'a' ? remote : local;
    const out = {};
    const ctr = ctrMerge(local.ctr, remote.ctr);
    if (Object.keys(ctr).length) out.ctr = ctr;
    if (Array.isArray(local.sessions) || Array.isArray(remote.sessions)) {
      const a = Array.isArray(local.sessions) ? local.sessions : [], b = Array.isArray(remote.sessions) ? remote.sessions : [], n = Math.max(a.length, b.length), s = [];
      for (let i = 0; i < n; i++) s.push(maxNum(a[i], b[i]));
      out.sessions = s;
    }
    if (isNum(local.streak) || isNum(remote.streak)) out.streak = maxNum(local.streak, remote.streak);
    if (isObj(local.skillMs) || isObj(remote.skillMs)) out.skillMs = isObj(nw.skillMs) ? nw.skillMs : od.skillMs;
    if (isObj(local.learnDone) || isObj(remote.learnDone)) {
      const m = {};
      [local.learnDone, remote.learnDone].forEach(d => { if (isObj(d)) Object.keys(d).forEach(k => { if (k !== '__proto__' && !has(m, k)) m[k] = d[k]; }); });
      out.learnDone = m;
    }
    ['learnLesson', 'learnStep'].forEach(k => { if (nw[k] !== undefined) out[k] = nw[k]; else if (od[k] !== undefined) out[k] = od[k]; });
    if (isObj(local.course) || isObj(remote.course)) out.course = isObj(local.course) && isObj(remote.course) ? comm(bk.mergeCourse, local.course, remote.course) : (isObj(local.course) ? local.course : remote.course);
    if (isObj(local.demo) || isObj(remote.demo)) out.demo = mergeProgress(local.demo, remote.demo, local.savedAt, remote.savedAt);
    if (isObj(local.demoCard) || isObj(remote.demoCard)) out.demoCard = mergeCard(local.demoCard, remote.demoCard, side, null);
    out.savedAt = Math.max(isNum(local.savedAt) ? local.savedAt : 0, isNum(remote.savedAt) ? remote.savedAt : 0);
    return out;
  }

  /* ---------------------------------------------------------------- deletions */
  /* the number of songs that are going to be removed at once, against the library: past this the person is asked first (a fifth of the library, or 4 or more) */
  function needsAsk(n, total) {
    if (!(n > 0)) return false;
    if (n > 3) return true;
    return n >= 2 && total > 0 && n / total > 0.2;
  }

  return Object.freeze({
    VERSION, SONG_FIELDS, SCORE_BOUND, COUNTERS,
    stable, hashText, contentHash, newerSide, keyOf, idOf, isSongKey, forkIdOf, identityKeys,
    cleanCard, slotProgress, scoreHashOf, buildSongItem, slotOfItem, cardOfItem, checkIncoming,
    mergeProgress, mergeCard, mergeSong, mergeStateItems, ctrTotal, ctrMerge, ctrAdvance, needsAsk
  });
});
