'use strict';
/* G13-6: the backup, restore and wipe code of library-backup.js, against a fake localStorage and a fake IndexedDB (Node only; no browser).

   The safety properties are written once, as functions, and used twice: they must hold for the real module, and each of them must FAIL for a mutant of the
   module (its source with one safety line broken) - a property that nothing can fail is not a test.
     P1  a restore removes no local song and leaves a local slot that it does not merge byte for byte as it was
     P2  a song with the same id and another score is kept: the local one untouched, the backup's added as a copy; the second restore adds nothing
     P3  the backup file holds no secret of this browser (the PC code, the one before it, the guest key) and no setting
     P4  a file past a bound (inflated size, file size) or of the wrong kind is refused, and a refusal writes nothing
     P5  the wipe leaves no ppp* key and no ppp* database (ppp-media and ppp-engrave included), and reports a database another tab holds open
     P6  a storage that refuses a write leaves the profile as it was */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC_PATH = path.resolve(__dirname, '..', '..', 'library-backup.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const B = require(SRC_PATH);

/* ------------------------------------------------------------------------------------------------ fakes */
class FakeStorage {
  constructor(quotaWrites) { this.m = new Map(); this.quota = quotaWrites == null ? Infinity : quotaWrites; this.writes = 0; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] === undefined ? null : [...this.m.keys()][i]; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (this.writes >= this.quota) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    this.writes++; this.m.set(String(k), String(v));
  }
  removeItem(k) { this.m.delete(k); }
  snapshot() { return JSON.stringify([...this.m.entries()].sort()); }
}
class FakeIDB {
  constructor(names, o) { this.dbs = new Set(names); this.blocked = new Set((o && o.blocked) || []); this.noList = !!(o && o.noList); if (this.noList) this.databases = undefined; this.deleted = []; }
  async databases() { return [...this.dbs].map(name => ({ name, version: 1 })); }
  deleteDatabase(name) {
    const req = {};
    setTimeout(() => {
      if (this.blocked.has(name)) { if (req.onblocked) req.onblocked(); return; }
      this.dbs.delete(name); this.deleted.push(name);
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}
const SECRETS = {
  pc: 'a'.repeat(32) + 'b'.repeat(32),
  pcPrev: 'c'.repeat(32) + 'd'.repeat(32),
  guest: 'guest-' + 'e1f2'.repeat(10)
};
function plantSecrets(st) {
  st.setItem('ppp.pclink.v1', JSON.stringify({ v: 1, code: SECRETS.pc }));
  st.setItem('ppp.pclink.prev.v1', JSON.stringify({ v: 1, code: SECRETS.pcPrev }));
  st.setItem('ppp-guest-key', SECRETS.guest);
}

/* ------------------------------------------------------------------------------------------------ data */
function packed(title, n, salt) {
  const keys = ['m', 'b', 'midi', 'dur', 'staff'];
  const notes = [];
  for (let i = 0; i < n; i++) notes.push([1 + (i >> 2), (i & 3), 60 + ((i * 7 + (salt || 0)) % 24), 1, 1 + (i & 1)]);
  const measures = [];
  for (let i = 0; i < Math.max(1, n >> 2); i++) measures.push({ number: i + 1, time: { beats: 4, beatType: 4 }, lenQ: 4, index: i, startQ: i * 4 });
  return { id: 'import:' + title, title: title, composer: 'C', tempo: 84, staves: 2, measures: measures, sections: [{ id: 's1', from: 1, to: measures.length }], _packedNoteKeys: keys, notes: notes, lengthQ: measures.length * 4 };
}
function history(attempts, lastAt, runs) {
  const by = {};
  for (let m = 1; m <= 3; m++) by[m] = { m: m, attempts: attempts, expected: attempts * 8, matched: attempts * 7, lastAt: lastAt, recent: [], tempos: {}, hands: { r: {}, l: {} } };
  return { rev: attempts, byMeasure: by, runs: runs || [] };
}
function slotFor(title, n, extra) {
  return Object.assign({ score: packed(title, n || 16), secs: { s1: { acc: 40, mem: 10, reps: 1 } }, history: history(2, 1000), memory: { rev: 0, sections: {} },
    loopFrom: 1, loopTo: 2, tempo: 70, memLevel: 1, blindRuns: 0, mastered: false, fileName: title + '.musicxml', fileMeta: '3 KB · MusicXML', importSource: { kind: 'musicxml' }, importReport: null }, extra || {});
}
/* a profile of `n` songs, the way the page keeps it, plus the state, a demo slot and the secrets */
function profile(n, o) {
  o = o || {};
  const st = new FakeStorage(o.quota), prefix = o.prefix || 'song-t';
  const songs = [];
  for (let i = 0; i < n; i++) {
    const id = prefix + i.toString(36) + 'x';
    songs.push({ id: id, title: 'Song ' + prefix + i, composer: 'C' + i, kind: 'musicxml', addedAt: 1000 + i, lastAt: 2000 + i, prog: i % 100, mem: i % 50, measures: 4 });
    st.setItem('ppp.song.v1.' + id, JSON.stringify(slotFor('Song ' + prefix + i, 12 + i, o.slotExtra)));
  }
  st.setItem('ppp.library.v1', JSON.stringify({ songs: songs, current: o.current || 'demo', demo: { prog: 30, mem: 5, lastAt: 7 } }));
  st.setItem('ppp.song.v1.demo', JSON.stringify({ score: null, secs: { a: { acc: 10, mem: 0, reps: 0 } }, history: history(1, 500), memory: { rev: 0, sections: {} }, loopFrom: 1, loopTo: 4, tempo: 80, memLevel: 0, blindRuns: 0, mastered: false }));
  st.setItem('ppp.state.v2', JSON.stringify({ songId: o.current || 'demo', minutes: 12, xp: 340, streak: 3, sessions: [10, 18, 14, 23, 8, 20, 0], skillMs: { treble: 0.8 }, learnDone: { keys: true }, learnLesson: 'keys', learnStep: 2,
    course: { main: 'beyer', side: null, warm: null, at: {}, passed: { beyer: { 1: true } }, log: { '2026-10-01': { 'beyer:1': 2 } }, reps: 5 },
    theme: 'dark', toggles: { midi: true }, midiDeviceId: 'dev-1', visualSettings: { x: 1 }, sidebarCollapsed: true, tasks: { '1-0': true },
    history: history(2, 1000), memory: { rev: 0, sections: {} }, secs: { s1: { acc: 40, mem: 10, reps: 1 } }, memLevel: 1, blindRuns: 0, mastered: false, tempo: 70, loopFrom: 1, loopTo: 2 }));
  st.setItem('ppp-locale', 'ko-KR'); st.setItem('ppp.cdn', '1'); st.setItem('ppp-guest', '1');
  if (o.secrets !== false) plantSecrets(st);
  st.writes = 0;
  return st;
}
const cards = st => JSON.parse(st.getItem('ppp.library.v1')).songs;
const ENV = st => ({ storage: st });

/* ------------------------------------------------------------------------------------------------ the properties (mod = the module under test) */
async function p1(mod) {
  const local = profile(5, { prefix: 'song-l' });
  const other = profile(4, { prefix: 'song-o', secrets: false });
  /* the backup also has a song under an id that is here, with another score (and one more under an id that is here with the same score) */
  const o2 = JSON.parse(other.getItem('ppp.library.v1'));
  o2.songs.push({ id: 'song-l1x', title: 'Rewritten here', kind: 'musicxml', addedAt: 1, lastAt: 2, prog: 0, mem: 0, measures: 4 });
  other.setItem('ppp.library.v1', JSON.stringify(o2));
  other.setItem('ppp.song.v1.song-l1x', JSON.stringify(slotFor('Rewritten here', 40, { tempo: 33 })));
  const bk = mod.build(other, { now: new Date('2026-10-01T10:00:00Z') });
  const before = {};
  cards(local).forEach(c => { before[c.id] = local.getItem('ppp.song.v1.' + c.id); });
  const r = mod.apply(bk, local, {});
  if (!r.ok) return 'apply failed: ' + r.code;
  const ids = cards(local).map(c => c.id);
  for (const id of Object.keys(before)) {
    if (ids.indexOf(id) < 0) return 'a local song was removed from the library: ' + id;
    if (local.getItem('ppp.song.v1.' + id) !== before[id]) return 'a local slot changed: ' + id;
  }
  if (ids.length !== 10) return 'expected 5 local + 4 new songs + 1 copy, got ' + ids.length;
  return null;
}
async function p2(mod) {
  const local = profile(3, { prefix: 'song-s' });
  const src = profile(3, { prefix: 'song-s', secrets: false });
  const id = 'song-s1x';
  const sl = JSON.parse(src.getItem('ppp.song.v1.' + id));
  sl.score = packed('Rewritten', 30, 3);                          /* the backup's version of the song has another score */
  src.setItem('ppp.song.v1.' + id, JSON.stringify(sl));
  const keep = local.getItem('ppp.song.v1.' + id);
  const bk = mod.build(src, { now: new Date('2026-10-01T10:00:00Z') });
  const r1 = mod.apply(bk, local, { copyTitle: (t, d) => t + ' (from backup ' + d + ')' });
  if (!r1.ok) return 'apply failed: ' + r1.code;
  if (local.getItem('ppp.song.v1.' + id) !== keep) return 'the local score was overwritten';
  const cs = cards(local);
  if (cs.length !== 4) return 'expected 3 songs + 1 copy, got ' + cs.length;
  const copy = cs.find(c => c.id !== 'song-s0x' && c.id !== 'song-s1x' && c.id !== 'song-s2x');
  if (!copy) return 'no copy was added';
  if (!/from backup 2026-10-01/.test(copy.title)) return 'the copy has no visible suffix: ' + copy.title;
  if (JSON.parse(local.getItem('ppp.song.v1.' + copy.id)).score.title !== 'Rewritten') return 'the copy is not the backup version';
  const snap = local.snapshot();
  const r2 = mod.apply(bk, local, { copyTitle: (t, d) => t + ' (from backup ' + d + ')' });
  if (!r2.ok || cards(local).length !== 4) return 'a second restore of the same file added a song';
  if (r2.copies !== 0 && r2.same < 1) return 'the second restore did not see its own copy';
  void snap;
  return null;
}
async function p3(mod) {
  const st = profile(3);
  let bk;
  try { bk = mod.build(st, { now: new Date('2026-10-01T10:00:00Z') }); } catch (e) { return 'build threw: ' + (e.code || e.message); }
  const text = JSON.stringify(bk);
  for (const k of Object.keys(SECRETS)) if (text.indexOf(SECRETS[k]) >= 0) return 'the file holds a secret: ' + k;
  const gz = await mod.encode(bk, {}, new Date(2026, 9, 1));
  const raw = Buffer.from(gz.bytes);
  const body = gz.gz ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  for (const k of Object.keys(SECRETS)) if (body.indexOf(SECRETS[k]) >= 0) return 'the encoded file holds a secret: ' + k;
  for (const w of ['"theme"', '"toggles"', '"midiDeviceId"', '"visualSettings"', 'ppp-locale', 'pclink', 'ppp-guest']) if (body.indexOf(w) >= 0) return 'the file holds a setting or a key name: ' + w;
  return null;
}
async function p4(mod) {
  const st = profile(2);
  const snap = st.snapshot();
  const bomb = zlib.gzipSync(Buffer.alloc(mod.LIMITS.json + 1024 * 1024, 0x20), { level: 9 });       /* a few KB that inflate past the bound */
  if (bomb.length > 200 * 1024) return 'the test bomb is not small: ' + bomb.length;
  const d = await mod.decode(new Uint8Array(bomb), {});
  if (d.ok || d.code !== 'too-big-inflated') return 'a zip bomb was not refused: ' + JSON.stringify(d);
  const big = await mod.decode(new Uint8Array(mod.LIMITS.file + 1), {});
  if (big.ok || big.code !== 'file-too-big') return 'an oversize file was not refused: ' + JSON.stringify(big);
  const png = await mod.decode(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), {});
  if (png.ok) return 'a PNG was accepted';
  const other = await mod.decode(new TextEncoder().encode('{"app":"something-else","v":1}'), {});
  if (other.ok || other.code !== 'not-ppp') return 'a foreign JSON was not refused: ' + JSON.stringify(other);
  if (st.snapshot() !== snap) return 'a refusal changed the profile';
  return null;
}
async function p5(mod) {
  const st = profile(4);
  st.setItem('ppp.extra.thing', 'x'); st.setItem('Ppp-Odd', 'y'); st.setItem('unrelated', 'keep'); st.setItem('p-p-p', 'keep');
  const idb = new FakeIDB(['ppp-engrave', 'ppp-media', 'ppp-other-new', 'someone-elses']);
  let closed = 0;
  const rep = await mod.wipe({ storage: st, indexedDB: idb, closeHandles: async () => { closed++; }, blockedMs: 50 });
  const left = [...st.m.keys()].filter(k => /^ppp/i.test(k));                  /* read from the storage itself, not through the module under test */
  if (left.length) return 'ppp keys left: ' + left.join(',');
  if (idb.dbs.has('ppp-media')) return 'ppp-media was not deleted';
  if (idb.dbs.has('ppp-engrave') || idb.dbs.has('ppp-other-new')) return 'a ppp database was not deleted';
  if (!idb.dbs.has('someone-elses')) return 'a database that is not ours was deleted';
  if (st.getItem('unrelated') !== 'keep') return 'a key that is not ours was removed';
  if (!rep.ok || closed !== 1) return 'the report is not ok / the handles were not closed: ' + JSON.stringify(rep);
  const blocked = new FakeIDB(['ppp-media'], { blocked: ['ppp-media'] });
  const rep2 = await mod.wipe({ storage: profile(1), indexedDB: blocked, blockedMs: 30 });
  if (rep2.ok || !rep2.failed.some(f => f.name === 'ppp-media' && f.why === 'blocked')) return 'a blocked database was not reported: ' + JSON.stringify(rep2);
  return null;
}
async function p6(mod) {
  const other = profile(6, { prefix: 'song-q', secrets: false });
  const bk = mod.build(other, {});
  const local = profile(2, { prefix: 'song-r' });
  const snap = local.snapshot();
  local.quota = 4; local.writes = 0;                                                  /* the 5th write is refused */
  const r = mod.apply(bk, local, {});
  if (r.ok || r.code !== 'quota') return 'a refused write was not reported as quota: ' + JSON.stringify(r);
  local.quota = Infinity;
  if (local.snapshot() !== snap) return 'a refused write left a half restore';
  return null;
}
const PROPS = { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6 };

/* ------------------------------------------------------------------------------------------------ the real module holds every property */
for (const name of Object.keys(PROPS)) {
  test(name + ' holds for the module', async () => { assert.equal(await PROPS[name](B), null); });
}

/* ------------------------------------------------------------------------------------------------ the mutants: one broken safety line each */
function mutant(from, to, all) {
  const src = all ? SRC.split(from).join(to) : SRC.replace(from, to);
  assert.notEqual(src, SRC, 'the mutation did not apply: ' + from.slice(0, 60));
  const m = { exports: {} };
  new Function('module', 'exports', 'globalThis', 'require', src + '\nmodule.exports = module.exports;').call(m, m, m.exports, globalThis, require);
  assert.ok(m.exports && m.exports.build, 'the mutant did not load');
  return m.exports;
}
const MUTANTS = [
  { name: 'a restore drops the songs that are here', prop: 'P1', from: 'const songs = localLib.songs.map(c => {', to: 'const songs = localLib.songs.filter(() => false).map(c => {' },
  { name: 'a restore replaces the local slot of an id it also has', prop: 'P1', from: "put(KEY.SONG + it.id, JSON.stringify(it.slot));\n      }\n    });", to: "put(KEY.SONG + it.id, JSON.stringify(it.slot));\n      }\n    });\n    localLib.songs.forEach(c => { if (c && c.id && bk.slots[c.id]) put(KEY.SONG + c.id, JSON.stringify(bk.slots[c.id])); });" },
  { name: 'a different score replaces the local one (no copy)', prop: 'P2', from: "} else {                                     /* the same id, another score", to: "} else if (true) { const t = lslot; out.same.push(card.id); idMap[card.id] = card.id; out.items.push({ kind: 'same', id: card.id, from: card.id, card: card, slot: Object.assign({}, slot, { score: t && t.score }), local: Object.assign({}, lslot, { score: slot.score }), localRaw: raw, hadCard: true });\n      } else {                                     /* mutant: the same id, another score" },
  { name: 'the copy has no suffix', prop: 'P2', from: "card.title = copyTitle(typeof card.title === 'string' ? card.title : '', date);", to: '' },
  { name: 'a restore twice adds a second copy', prop: 'P2', from: "const base = copyIdOf(card.id, key);", to: "const base = copyIdOf(card.id, key + Math.random());" },
  { name: 'the backup holds the PC code (the guard is off)', prop: 'P3', from: "/* @secrets-excluded: nothing above reads ppp.pclink.*, ppp-guest-key or any account data */", to: "out.pc = parse(getItem(storage, KEY.PC)); out.guest = getItem(storage, KEY.GUEST);" , also: [["secretsOf(storage).forEach(s => {", "[].forEach(s => {"]] },
  { name: 'the backup holds the PC code (the guard is on)', prop: 'P3', from: "/* @secrets-excluded: nothing above reads ppp.pclink.*, ppp-guest-key or any account data */", to: "out.pc = parse(getItem(storage, KEY.PC));" },
  { name: 'the backup holds the settings of the state', prop: 'P3', from: "STATE_FIELDS = Object.freeze(['minutes',", to: "STATE_FIELDS = Object.freeze(['theme', 'toggles', 'midiDeviceId', 'visualSettings', 'minutes'," },
  { name: 'there is no bound on the inflated size', prop: 'P4', from: "if (total > max) {", to: "if (total > max && false) {" },
  { name: 'there is no bound on the file size', prop: 'P4', from: "if (bytes.length > LIMITS.file) return", to: "if (false) return" },
  { name: 'a foreign JSON is accepted', prop: 'P4', from: "if (!isObj(b) || b.app !== FORMAT) return { ok: false, code: 'not-ppp' };", to: "if (!isObj(b)) return { ok: false, code: 'not-ppp' };" },
  { name: 'the wipe misses ppp-media', prop: 'P5', from: "const KNOWN_DBS = ['ppp-engrave', 'ppp-media'];", to: "const KNOWN_DBS = ['ppp-engrave'];", also: [["/^ppp/i.test(d.name)", "/^ppp-engrave/i.test(d.name)"]] },
  { name: 'the wipe leaves the settings keys', prop: 'P5', from: "const pppKeys = storage => allKeys(storage).filter(k => /^ppp/i.test(k));", to: "const pppKeys = storage => allKeys(storage).filter(k => /^ppp\\.(song|library|state)/i.test(k));" },
  { name: 'the wipe says ok about a blocked database', prop: 'P5', from: "if (r.ok) report.removed.dbs++; else failed.push({ kind: 'db', name: name, why: r.why });", to: "report.removed.dbs++;" , also: [["const dl = await dbsLeft(env);", "const dl = [];"]] },
  { name: 'a refused write is not undone', prop: 'P6', from: "for (let i = Math.min(done, writes.length - 1); i >= 0; i--) {", to: "for (let i = -1; i >= 0; i--) {" }
];
for (const m of MUTANTS) {
  test('mutant: ' + m.name + ' -> ' + m.prop + ' fails', async () => {
    let src = SRC;
    const pairs = [[m.from, m.to]].concat(m.also || []);
    pairs.forEach(([a, b]) => { assert.ok(src.indexOf(a) >= 0, 'anchor missing: ' + a.slice(0, 70)); src = src.split(a).join(b); });
    const box = { exports: {} };
    new Function('module', 'exports', 'globalThis', 'require', src).call(box, box, box.exports, globalThis, require);
    const mod = box.exports;
    let verdict;
    try { verdict = await PROPS[m.prop](mod); } catch (e) { verdict = 'threw: ' + e.message; }
    assert.ok(verdict, 'the property ' + m.prop + ' still holds for the mutant: nothing would notice this break');
  });
}
void mutant;

/* ------------------------------------------------------------------------------------------------ the rest of the contract */
test('30 songs out and in on a fresh profile: every slot byte for byte, the cards and the demo progress the same', async () => {
  const a = profile(30);
  const bk = B.build(a, { now: new Date('2026-10-08T09:00:00Z'), build: 'abc1234' });
  assert.equal(bk.app, 'ppp-library'); assert.equal(bk.v, 1); assert.equal(bk.counts.songs, 30); assert.equal(bk.build, 'abc1234');
  const enc = await B.encode(bk, {}, new Date(2026, 9, 8));
  assert.equal(enc.gz, true);
  assert.equal(enc.name, 'ppp-library-2026-10-08.ppp-library.json.gz');
  assert.equal(enc.bytes[0], 0x1f);
  const dec = await B.decode(enc.bytes, {});
  assert.equal(dec.ok, true);
  const b = new FakeStorage();                                            /* a fresh profile: the page has only written its empty library */
  b.setItem('ppp.library.v1', JSON.stringify({ songs: [], current: 'demo', demo: null }));
  const r = B.apply(dec.backup, b, {});
  assert.equal(r.ok, true); assert.equal(r.fresh, 30); assert.equal(r.same, 0); assert.equal(r.copies, 0);
  for (const c of cards(a)) assert.equal(b.getItem('ppp.song.v1.' + c.id), a.getItem('ppp.song.v1.' + c.id), 'slot ' + c.id);
  assert.equal(b.getItem('ppp.song.v1.demo'), a.getItem('ppp.song.v1.demo'));
  assert.deepEqual(cards(b), cards(a));
  assert.equal(JSON.parse(b.getItem('ppp.library.v1')).current, 'demo');
  const st = JSON.parse(b.getItem('ppp.state.v2'));
  assert.equal(st.xp, 340); assert.equal(st.theme, undefined); assert.deepEqual(st.course.passed, { beyer: { 1: true } });
  assert.deepEqual(B.pppKeys(b).filter(k => /pclink|guest-key/.test(k)), []);
});

test('with no CompressionStream the file is plain .json and reads back', async () => {
  const bk = B.build(profile(3), { now: new Date('2026-10-08T09:00:00Z') });
  const enc = await B.encode(bk, { CompressionStream: undefined }, new Date(2026, 9, 8));
  assert.equal(enc.gz, false); assert.equal(enc.name, 'ppp-library-2026-10-08.ppp-library.json');
  const dec = await B.decode(enc.bytes, { DecompressionStream: undefined });
  assert.equal(dec.ok, true); assert.equal(dec.backup.counts.songs, 3);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bk)));
  const no = await B.decode(new Uint8Array(gz), { DecompressionStream: undefined });
  assert.equal(no.ok, false); assert.equal(no.code, 'no-gunzip');
});

test('a card with nothing behind it is not backed up, and is counted', () => {
  const st = profile(3);
  st.removeItem('ppp.song.v1.song-t1x');
  const bk = B.build(st, {});
  assert.equal(bk.counts.songs, 2); assert.equal(bk.counts.skipped, 1);
  assert.equal(bk.slots['song-t1x'], undefined);
});

test('validate refuses a file the page could not have made', () => {
  const ok = B.build(profile(2), {});
  const v = patch => { const o = JSON.parse(JSON.stringify(ok)); patch(o); return B.validate(o); };
  assert.equal(B.validate(ok).ok, true);
  assert.equal(v(o => { o.v = 2; }).code, 'newer');
  assert.equal(v(o => { o.v = 0; }).code, 'bad-version');
  assert.equal(v(o => { o.v = 'x'; }).code, 'bad-version');
  assert.equal(v(o => { o.library.songs[0].id = 'demo'; }).code, 'bad-id');
  assert.equal(v(o => { o.library.songs[0].id = '../etc'; }).code, 'bad-id');
  assert.equal(v(o => { o.library.songs[1].id = o.library.songs[0].id; }).code, 'bad-id');
  assert.equal(v(o => { o.slots['song-t0x'] = 5; }).code, 'bad-slot');
  assert.equal(v(o => { o.slots['song-t0x'].score = { measures: 1 }; }).code, 'bad-slot');
  assert.equal(v(o => { o.library = []; }).code, 'bad-shape');
  assert.equal(v(o => { o.library.songs = new Array(B.LIMITS.songs + 1).fill(0); }).code, 'too-many-songs');
  assert.equal(v(o => { o.slots['song-t0x'].history = JSON.parse('{"__proto__":{"x":1}}'); }).code, 'unsafe-key');
  assert.equal(v(o => { let d = o.slots['song-t0x']; for (let i = 0; i < B.LIMITS.depth + 5; i++) { d.deep = {}; d = d.deep; } }).code, 'too-complex');
  assert.equal(v(o => { o.slots['song-t0x'].blob = 'x'.repeat(B.LIMITS.slot + 10); }).code, 'slot-too-big');
});

test('a corrupt gzip and an empty file are refused with a name', async () => {
  const bk = B.build(profile(2), {});
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bk)));
  assert.equal((await B.decode(new Uint8Array(0), {})).code, 'empty');
  const cut = gz.subarray(0, gz.length - 12);
  assert.equal((await B.decode(new Uint8Array(cut), {})).ok, false);
  const bad = Buffer.from(gz); bad[20] ^= 0xff; bad[21] ^= 0xff; bad[30] ^= 0xff;
  assert.equal((await B.decode(new Uint8Array(bad), {})).ok, false);
  assert.equal((await B.decode(new TextEncoder().encode('hello'), {})).code, 'not-json');
  assert.equal((await B.decode(new TextEncoder().encode('[1,2]'), {})).code, 'not-json');
});

test('the same song, the same score: the progress is merged field by field and nothing else changes', async () => {
  const here = profile(1, { prefix: 'song-m', current: 'song-m0x' });
  const there = profile(1, { prefix: 'song-m', secrets: false });
  const id = 'song-m0x';
  /* here: 2 attempts per measure, runs at 1 and 2, memory level 1; the backup: 5 attempts on measure 1 only, a run at 3 */
  const sl = JSON.parse(here.getItem('ppp.song.v1.' + id));
  sl.history = history(2, 1000, [{ at: 1, from: 1, to: 2, tempo: 70, hands: 'both' }, { at: 2, from: 1, to: 2, tempo: 70, hands: 'both' }]);
  sl.memory = { rev: 1, sections: { s1: { id: 's1', level: 1, lastMemoryTest: 50, attempts: [] } } };
  sl.tempo = 90; sl.memLevel = 1; sl.secs = { s1: { acc: 40, mem: 30, reps: 1 } };
  here.setItem('ppp.song.v1.' + id, JSON.stringify(sl));
  const sr = JSON.parse(there.getItem('ppp.song.v1.' + id));
  sr.history = history(1, 900, [{ at: 2, from: 1, to: 2, tempo: 70, hands: 'both' }, { at: 3, from: 1, to: 2, tempo: 70, hands: 'both' }]);
  sr.history.byMeasure[1] = Object.assign({}, sr.history.byMeasure[1], { attempts: 5, lastAt: 800 });
  sr.memory = { rev: 4, sections: { s1: { id: 's1', level: 3, lastMemoryTest: 40, attempts: [] }, s2: { id: 's2', level: 1, lastMemoryTest: 9, attempts: [] } } };
  sr.tempo = 50; sr.memLevel = 2; sr.mastered = true; sr.secs = { s1: { acc: 70, mem: 5, reps: 3 } };
  there.setItem('ppp.song.v1.' + id, JSON.stringify(sr));
  const st = JSON.parse(there.getItem('ppp.state.v2')); st.xp = 900; st.minutes = 5; st.streak = 9; there.setItem('ppp.state.v2', JSON.stringify(st));
  const scoreBefore = JSON.stringify(JSON.parse(here.getItem('ppp.song.v1.' + id)).score);
  const r = B.apply(B.build(there, {}), here, {});
  assert.equal(r.ok, true); assert.equal(r.same, 1); assert.equal(r.fresh, 0); assert.equal(r.copies, 0);
  const m = JSON.parse(here.getItem('ppp.song.v1.' + id));
  assert.equal(JSON.stringify(m.score), scoreBefore);
  assert.equal(m.history.byMeasure[1].attempts, 5);                         /* the larger record */
  assert.equal(m.history.byMeasure[2].attempts, 2);                         /* the local one where it has more */
  assert.deepEqual(m.history.runs.map(r => r.at), [1, 2, 3]);               /* the union, once each */
  assert.equal(m.memory.sections.s1.level, 3); assert.ok(m.memory.sections.s2);
  assert.equal(m.tempo, 90);                                                /* the tempo stays as it is here */
  assert.equal(m.memLevel, 2); assert.equal(m.mastered, true);
  assert.deepEqual(m.secs.s1, { acc: 70, mem: 30, reps: 3 });
  const s = JSON.parse(here.getItem('ppp.state.v2'));
  assert.equal(s.xp, 900); assert.equal(s.minutes, 12); assert.equal(s.streak, 9);
  assert.equal(s.theme, 'dark');                                            /* the settings here are untouched */
  assert.equal(s.songId, id);
  assert.equal(s.history.byMeasure[1].attempts, 5);                         /* the open song's progress is read from the state: it is merged there too */
  assert.equal(cards(here).length, 1);
});

test('a copy keeps the link to the arrangement it was made from', () => {
  const here = profile(2, { prefix: 'song-a' });
  const there = profile(2, { prefix: 'song-a', secrets: false });
  const parent = 'song-a0x';
  const sp = JSON.parse(there.getItem('ppp.song.v1.' + parent)); sp.score = packed('Edited', 40, 9); there.setItem('ppp.song.v1.' + parent, JSON.stringify(sp));
  const lib = JSON.parse(there.getItem('ppp.library.v1'));
  lib.songs.push({ id: 'song-arr1', title: 'An arrangement', kind: 'arrangement', arrangedFrom: parent, addedAt: 1, lastAt: null, prog: 0, mem: 0, measures: 4 });
  there.setItem('ppp.library.v1', JSON.stringify(lib));
  there.setItem('ppp.song.v1.song-arr1', JSON.stringify(slotFor('An arrangement', 20)));
  const r = B.apply(B.build(there, {}), here, { copyTitle: (t) => t + ' (copy)' });
  assert.equal(r.ok, true); assert.equal(r.copies, 1); assert.equal(r.fresh, 1);
  const cs = cards(here), copy = cs.find(c => /\(copy\)$/.test(c.title)), arr = cs.find(c => c.id === 'song-arr1');
  assert.ok(copy); assert.notEqual(copy.id, parent);
  assert.equal(arr.arrangedFrom, copy.id);
});

test('the open song of this device is mirrored in the state; a lost card comes back with its slot', () => {
  const here = profile(2, { prefix: 'song-k' });
  const there = profile(2, { prefix: 'song-k', secrets: false });
  here.removeItem('ppp.song.v1.song-k0x');                                   /* here the card has no slot: a lost song */
  const r = B.apply(B.build(there, {}), here, {});
  assert.equal(r.ok, true);
  assert.equal(here.getItem('ppp.song.v1.song-k0x'), there.getItem('ppp.song.v1.song-k0x'));
  assert.equal(cards(here).filter(c => c.id === 'song-k0x').length, 1);
});

test('a restore with nothing to add writes nothing', () => {
  const a = profile(4, { prefix: 'song-n', current: 'song-n0x' });                /* the open song's progress is in its slot and in the state, alike */
  const bk = B.build(a, {});
  const before = a.snapshot();
  a.writes = 0;
  const r = B.apply(bk, a, {});
  assert.equal(r.ok, true); assert.equal(r.same, 4);
  assert.equal(a.snapshot(), before);
  assert.equal(a.writes, 0);
});

test('plan is the summary apply then does, and writes nothing', () => {
  const here = profile(3, { prefix: 'song-p' });
  const there = profile(5, { prefix: 'song-p', secrets: false });
  const sl = JSON.parse(there.getItem('ppp.song.v1.song-p0x')); sl.score = packed('Other', 20, 5); there.setItem('ppp.song.v1.song-p0x', JSON.stringify(sl));
  const bk = B.build(there, {});
  const before = here.snapshot();
  const p = B.plan(bk, here, {});
  assert.equal(here.snapshot(), before);
  assert.deepEqual(B.summary(p), { total: 5, fresh: 2, same: 2, copies: 1, skipped: 0 });
  const r = B.apply(bk, here, {});
  assert.equal(r.fresh, 2); assert.equal(r.same, 2); assert.equal(r.copies, 1);
});

test('the wipe works where databases() does not exist, and reports a blocked database while it still removes the rest', async () => {
  const st = profile(2);
  const idb = new FakeIDB(['ppp-engrave', 'ppp-media'], { noList: true, blocked: ['ppp-engrave'] });
  const rep = await B.wipe({ storage: st, indexedDB: idb, blockedMs: 30 });
  assert.equal(rep.ok, false);
  assert.deepEqual(rep.failed.map(f => f.name + ':' + f.why), ['ppp-engrave:blocked']);
  assert.equal(idb.dbs.has('ppp-media'), false);
  assert.deepEqual(B.pppKeys(st), []);
  assert.equal(rep.removed.dbs, 1);
});

test('the flash message crosses one reload and is read once', () => {
  const s = new FakeStorage();
  B.flashSet(s, { n: 3 });
  assert.deepEqual(B.flashTake(s), { n: 3 });
  assert.equal(B.flashTake(s), null);
});
