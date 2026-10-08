'use strict';
/* G13-6: the mutants of library-backup.js - its source with ONE safety line broken each. tests/backup/library-backup.test.js runs the module's six
   properties against every one of them (each must fail one), and tests/backup-ui.test.js serves three of them to the real page (PPP_MUTANT-style:
   the page's own script is replaced) to show that the browser checks notice the same breaks. `from` must be in the source exactly once (or the
   test says the anchor is gone), `also` are further replacements of the same mutant. */
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
  { name: 'the wipe leaves the session keys', prop: 'P5', from: "try { if (env.session) allKeys(env.session).filter(k => /^ppp/i.test(k)).forEach(k => env.session.removeItem(k)); } catch (e) { /* session keys are not data */ }", to: "" },
  { name: 'the wipe leaves the language cookie', prop: 'P5', from: "try { if (env.document) env.document.cookie = 'ppp_locale=; Path=/; Max-Age=0; SameSite=Lax'; } catch (e) { /* a cookie is not data */ }", to: "" },
  { name: 'a song whose id is a name of Object.prototype is dropped by a restore', prop: 'P7', from: "const have = Object.create(null);", to: "const have = {};" },
  { name: 'a link that is not a web address is kept', prop: 'P8', from: "const fix = (o, k) => { if (isObj(o) && has(o, k) && !okUrl(o[k])) { o[k] = null; blanked++; } };", to: "const fix = () => {};" },
  { name: 'a refused write is not undone', prop: 'P6', from: "for (let i = Math.min(done, writes.length - 1); i >= 0; i--) {", to: "for (let i = -1; i >= 0; i--) {" }
];

/* The page's own code (Piano Coach App.dc.html) that makes the restore and the delete safe for a signed-in person, for a second open tab and for a song being read.
   Served to the real page by tests/backup-ui.test.js in place of the page: the check of that behaviour must go red. */
const PAGE_MUTANTS = [
  { name: 'a restore does not put the merged state to the account', from: 'const account = await this.bkPutProgress();', to: 'const account = this.state.user ? true : null;' },
  { name: 'the other tabs ignore the signal', from: 'm.from === this._tabId || this._dead) return;', to: 'm.from === this._tabId || this._dead || true) return;' },
  { name: 'a song being read is not asked about', from: 'bkBusyWork() { return !!(this._importCtl || this._recording); }', to: 'bkBusyWork() { return false; }' }
];

/* the source with one mutant applied; every anchor must be there. A checkout with CRLF line endings (autocrlf) is read as LF: the anchors are written with LF. */
function applyMutant(src, m) {
  const lf = t => String(t).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  let out = lf(src);
  [[m.from, m.to]].concat(m.also || []).forEach(pair => {
    const from = lf(pair[0]);
    if (out.indexOf(from) < 0) throw new Error('mutant anchor missing: ' + from.slice(0, 70));
    out = out.split(from).join(pair[1]);
  });
  return out;
}
module.exports = { MUTANTS, PAGE_MUTANTS, applyMutant };
