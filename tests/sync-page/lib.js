/* Shared parts of the sync PAGE tests (G13-S1): a fake localStorage, "a device" (storage + the page's adapter + an engine) that talks to a real sync service over real
   HTTP (tests/sync/lib.js startSync: the service of sync.js with a counting store and a clock the test moves), and helpers that make the songs a page keeps.

   Nothing here is read by the app. */
'use strict';
const path = require('path');
const L = require('../sync/lib.js');

const REPO = L.REPO;
/* the modules under test: this tree's, or - for the mutation runner (tests/sync-page/mutants.js) - the copies in PPP_SYNC_MODULES_DIR (a folder with sync/ and library-backup.js) */
const MODS = process.env.PPP_SYNC_MODULES_DIR ? path.resolve(process.env.PPP_SYNC_MODULES_DIR) : REPO;
const MERGE = require(path.join(MODS, 'sync', 'merge.js'));
const CLIENT = require(path.join(MODS, 'sync', 'client.js'));
const BACKUP = require(path.join(MODS, 'library-backup.js'));

class FakeStorage {
  constructor() { this.m = new Map(); this.quota = Infinity; this.writes = 0; }
  get length() { return this.m.size; }
  key(i) { return Array.from(this.m.keys())[i] || null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    let total = 0; this.m.forEach((val, key) => { if (key !== k) total += key.length + val.length; });
    if (total + k.length + v.length > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    this.writes++; this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

/* a packed score of n notes over m measures; seed makes it differ */
function packedScore(n, m, seed, title) {
  const measures = [];
  for (let i = 0; i < (m || 4); i++) measures.push({ number: i + 1, index: i, startQ: i * 4, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' } });
  const notes = [];
  for (let i = 0; i < (n || 8); i++) notes.push([48 + ((i * 3 + (seed || 0)) % 30), (i % 4), 0.5 + ((i + (seed || 0)) % 2) * 0.5, 1 + Math.floor(i / 4) % (m || 4), 'r']);
  return { id: 'score-' + (seed || 0), title: title || 'Song', composer: 'Test', tempo: 90, measures: measures, notes: notes, _packedNoteKeys: ['midi', 'b', 'dur', 'm', 'hand'], sections: [] };
}
/* a slot as the page writes it */
function slotOf(score, extra) {
  return Object.assign({
    score: score, secs: { s1: { acc: 50, mem: 10, reps: 2 } }, history: { byMeasure: {}, runs: [], rev: 0 }, memory: { sections: {}, rev: 0 },
    loopFrom: 1, loopTo: 4, tempo: 90, memLevel: 0, blindRuns: 0, mastered: false, fileName: 'x.musicxml', fileMeta: '', importSource: null, importReport: null
  }, extra || {});
}

/* a deterministic random generator per device name (two devices must not get one device id) */
function seeded(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (h >>> 8) / 16777216; };
}

/* A device: a storage, the adapter a page has, and an engine on a service. Its fetch goes through dev (so a test can cut the network, fail the next request, and see every URL
   and header that was sent). */
function makeDevice(svc, name, opts) {
  opts = opts || {};
  const storage = opts.storage || new FakeStorage();
  const st = { xp: 0, minutes: 0, streak: 1, sessions: [0, 0, 0, 0, 0, 0, 0], skillMs: { treble: 1 }, learnDone: {}, learnLesson: 'keys', learnStep: 0, course: null };
  const dev = { name: name, storage: storage, st: st, open: 'demo', frozen: false, online: true, requests: [], openProgress: [], removedByPage: [], trashRows: new Map(), failNext: null, intercept: null, ip: opts.ip || ('10.9.' + (name.charCodeAt(0) % 200) + '.1') };
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const adapter = {
    libraryRead: () => { const d = parse(storage.getItem('ppp.library.v1') || 'null'); return d && Array.isArray(d.songs) ? d : { songs: [], current: 'demo', demo: null }; },
    libraryWrite: lib => { try { storage.setItem('ppp.library.v1', JSON.stringify(lib)); return true; } catch (e) { return false; } },
    openSongId: () => dev.open,
    saveNow: () => {},
    frozen: () => dev.frozen,
    readState: () => Object.assign({}, st),
    applyState: patch => { Object.assign(st, patch); },
    applyOpenProgress: p => { dev.openProgress.push(p); },
    removeSongs: ids => { ids.forEach(id => { dev.removeSong(id); }); },
    forgetThumbs: () => {}
  };
  const trash = {
    available: () => true,
    put: async e => { dev.trashRows.set(e.tid, e); },
    list: async () => Array.from(dev.trashRows.values()).sort((a, b) => b.at - a.at),
    get: async tid => dev.trashRows.get(tid) || null,
    del: async tid => { dev.trashRows.delete(tid); },
    clear: async () => { dev.trashRows.clear(); }
  };
  const fetchFn = async (url, init) => {
    init = init || {};
    const headers = Object.assign({}, init.headers || {});
    headers['X-Forwarded-For'] = dev.ip;
    dev.requests.push({ method: init.method || 'GET', url: String(url), headers: Object.assign({}, init.headers || {}), body: init.body || null, credentials: init.credentials });
    if (!dev.online) throw new TypeError('fetch failed (offline)');
    if (dev.intercept) { const r = await dev.intercept(url, init); if (r) return r; }
    if (dev.failNext) { const f = dev.failNext; dev.failNext = null; return f(url, init); }
    return fetch(url, Object.assign({}, init, { headers: headers }));
  };
  const engine = CLIENT.create({
    storage: storage, adapter: adapter, merge: MERGE, backup: BACKUP, fetch: fetchFn, base: 'http://127.0.0.1:' + svc.port,
    now: () => svc.clock.t, random: opts.random || seeded(name), trash: trash, visible: () => true, online: () => dev.online,
    copyTitle: t => t + ' (copy from another device)', tabId: name,
    setTimeout: opts.setTimeout || (() => 0), clearTimeout: () => {}, log: opts.log
  });
  dev.engine = engine;
  dev.adapter = adapter;
  dev.cards = () => adapter.libraryRead().songs;
  dev.card = id => adapter.libraryRead().songs.find(c => c.id === id) || null;
  dev.slot = id => parse(storage.getItem('ppp.song.v1.' + id));
  dev.slotRaw = id => storage.getItem('ppp.song.v1.' + id);
  /* add a song the way the page does: its slot, then its card */
  dev.addSong = (id, o) => {
    o = o || {};
    const score = o.score || packedScore(o.notes || 8, o.measures || 4, o.seed || 0, o.title || ('Song ' + id));
    storage.setItem('ppp.song.v1.' + id, JSON.stringify(slotOf(score, o.slot)));
    const lib = adapter.libraryRead();
    lib.songs.unshift(Object.assign({ id: id, title: o.title || ('Song ' + id), composer: 'Test', kind: 'musicxml', url: null, addedAt: o.addedAt || svc.clock.t, lastAt: o.lastAt || svc.clock.t, prog: 0, mem: 0, measures: score.measures.length }, o.card || {}));
    adapter.libraryWrite(lib);
    return id;
  };
  /* change a song's slot (practice, an edit): fn(slotObject) */
  dev.editSlot = (id, fn) => {
    const s = dev.slot(id);
    fn(s);
    storage.setItem('ppp.song.v1.' + id, JSON.stringify(s));
  };
  dev.editCard = (id, fn) => { const lib = adapter.libraryRead(); const c = lib.songs.find(x => x.id === id); fn(c); adapter.libraryWrite(lib); };
  /* the page's removeSong: the engine is told first (card and slot as they are), then the card and the slot go */
  dev.removeSong = id => {
    const card = dev.card(id), raw = storage.getItem('ppp.song.v1.' + id);
    if (card) engine.noteRemoved(id, card, raw);
    const lib = adapter.libraryRead();
    lib.songs = lib.songs.filter(c => c.id !== id);
    adapter.libraryWrite(lib);
    storage.removeItem('ppp.song.v1.' + id);
    dev.removedByPage.push(id);
  };
  dev.urls = () => dev.requests.map(r => r.url);
  /* cycles until nothing is pending (a cycle that has to wait for the hour's room is the test's business) */
  dev.settle = async max => {
    for (let i = 0; i < (max || 8); i++) {
      await engine.syncNow('test');
      const s = engine.status();
      if (!s.songs.pending && !s.asks.length && s.phase !== 'waiting' && !s.error) break;
    }
    return engine.status();
  };
  return dev;
}

module.exports = Object.assign({}, L, { MERGE, CLIENT, BACKUP, FakeStorage, packedScore, slotOf, makeDevice });
