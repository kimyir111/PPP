'use strict';
/* Would the suite notice if the run log got worse? practice/runlog.js is mutated the way tests/practice/mutation.test.js mutates plan.js: a whole copy of
   the module with ONE line changed, loaded on its own so the real one is untouched. Each mutation breaks one rule of G11-D5 / G11-D6 on purpose, and a probe
   reads the one thing a person (or the model) would see; the real module answers `clean`, the mutant must not. An anchor that has drifted fails loudly (it
   must match exactly once); MUT-NOOP is the control (a comment: nothing moves).

   The same rules are broken in the page by tests/practice/learner-mutants.js, for the parts only a browser (IndexedDB) or the page itself can show. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'practice', 'runlog.js');
const source = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');
const dirs = [];
let counter = 0;
test.after(() => dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));

function mutant(edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 70)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runlog-mutant-' + (++counter) + '-'));
  dirs.push(dir);
  const file = path.join(dir, 'runlog.js');
  fs.writeFileSync(file, text);
  return require(file);
}

const rows = (n) => { const out = []; for (let i = 0; i < n; i++) for (let h = 0; h < 2; h++) out.push({ mi: i, h: h, e: 6, k: 5, sd: -30, ad: 90, ids: [i] }); return out; };
const run = (R, n, o) => R.buildEntry(Object.assign({ id: 'r' + n, at: 1000 + n, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 3, rows: rows(4), wrongs: [], expected: 48, matched: 40, accuracy: 0.8 }, o)).entry;
const meta = { measures: 8, scoreTempo: 80, title: 'T' };
const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

/* id, the mutation, what is read, and what the real module answers */
const MUTATIONS = [
  { id: 'MUT-NOOP', why: 'a comment: nothing may change (the control)', edits: [['  const VERSION = 1;\n', '  const VERSION = 1; /* control */\n']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend(), caps: { runs: 4 } }); for (let i = 1; i <= 9; i++) await l.append('s', 'h', run(R, i), meta); return (await l.read('s', 'h')).runs.length; }, clean: 4, same: true },
  { id: 'MUT-CAP', why: 'the cap is gone: the log grows without end',
    edits: [['const excess = Math.max(0, info.count + 1 - cap);', 'const excess = 0;']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend(), caps: { runs: 4 } }); for (let i = 1; i <= 9; i++) await l.append('s', 'h', run(R, i), meta); return (await l.read('s', 'h')).runs.length; }, clean: 4 },
  { id: 'MUT-CAP-NEWEST', why: 'the newest run is dropped instead of the oldest',
    edits: [['const drop = rs.splice(0, p.excess);', 'const drop = rs.splice(rs.length - 1 - p.excess, p.excess);']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend(), caps: { runs: 4 } }); for (let i = 1; i <= 9; i++) await l.append('s', 'h', run(R, i), meta); return (await l.read('s', 'h')).runs.map(x => x.n).join(); }, clean: '6,7,8,9' },
  { id: 'MUT-SEQ', why: 'a run is numbered by how many there are, not by the highest number: after the first drop two runs share a number',
    edits: [['const n = info.last == null ? 1 : info.last + 1;', 'const n = info.count + 1;']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend(), caps: { runs: 4 } }); for (let i = 1; i <= 9; i++) await l.append('s', 'h', run(R, i), meta); return (await l.read('s', 'h')).runs.map(x => x.n).join(); }, clean: '6,7,8,9' },
  { id: 'MUT-SIM-ACCEPT', why: 'a simulated run is taken into the log as if it were evidence (G11-D5)',
    edits: [["if (!entry || entry.src === 'simulated') return refuse('simulated');", "if (!entry) return refuse('simulated');"]],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); const r = await l.append('s', 'h', Object.assign(run(R, 1), { src: 'simulated' }), meta); return r.ok + ':' + (await l.evidence('s', 'h')).runs.length; }, clean: 'false:0' },
  { id: 'MUT-READ-SIM', why: 'a row that says simulated is read as evidence when it is found in the store',
    edits: [["!validEntry(r.e) || r.e.src === 'simulated') { stats.corrupt++; return; }", '!validEntry(r.e)) { stats.corrupt++; return; }']],
    probe: async R => { const be = R.memoryBackend(); const l = R.createLog({ backend: be }); await l.append('s', 'h', run(R, 1), meta); be._raw.runs.get('s|h').push({ ep: 's|h', n: 2, e: Object.assign(run(R, 2), { src: 'simulated' }) }); return (await l.evidence('s', 'h')).runs.length; }, clean: 1 },
  { id: 'MUT-SIM-COUNT', why: 'a simulated run is not counted on the epoch (the export would not say how much practice had no keyboard)',
    edits: [["p.epoch.sim = { n: (p.epoch.sim.n | 0) + 1, last: a.at };", "p.epoch.sim = { n: (p.epoch.sim.n | 0), last: a.at };"]],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); await l.noteSimulated('s', 'h', meta); await l.noteSimulated('s', 'h', meta); return (await l.epochs()).epochs[0].sim.n; }, clean: 2 },
  { id: 'MUT-CURRENT', why: 'a new music hash does not become the current epoch: the old one never turns read-only',
    edits: [['songs.set(a.songId, p.song);\n        return { n: p.n, dropped: p.excess, repaired: p.repaired };', 'if (!songs.has(a.songId)) songs.set(a.songId, p.song);\n        return { n: p.n, dropped: p.excess, repaired: p.repaired };']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); await l.append('s', 'A', run(R, 1), meta); await l.append('s', 'B', run(R, 2), meta); return (await l.epochs()).epochs.map(e => e.hash + ':' + e.readOnly).join(); }, clean: 'A:true,B:false' },
  { id: 'MUT-EPOCH-KEY', why: 'the epoch ignores the music hash: a rewrite lands in the old epoch',
    edits: [["const ep = a.songId + '|' + a.hash, rs = list(ep);", "const ep = a.songId + '|' + 'same', rs = list(ep);"]],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); await l.append('s', 'A', run(R, 1), meta); await l.append('s', 'B', run(R, 2), meta); return (await l.read('s', 'A')).runs.length + ':' + (await l.read('s', 'B')).runs.length; }, clean: '1:1' },
  { id: 'MUT-SIZE', why: 'a long run is written as it is: no merging of rows, no 2 KB',
    edits: [['if (bytes <= CAPS.body) return { entry: e, bytes: bytes, g: g, ids: withIds };', 'return { entry: e, bytes: bytes, g: g, ids: withIds };']],
    probe: async R => { const b = R.buildEntry({ id: 'r', at: 1, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 199, rows: rows(200), wrongs: [], expected: 1, matched: 1, accuracy: 1 }); return b.bytes <= 2000; }, clean: true },
  { id: 'MUT-IDS-CAP', why: 'a row keeps every missed id: a bad lap fills the 2 KB with ids',
    edits: [['a.ids.length < CAPS.ids; i++, idLeft--)', 'a.ids.length < 999; i++, idLeft--)']],
    probe: async R => { const e = R.buildEntry({ id: 'r', at: 1, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 0, rows: [{ mi: 0, h: 0, e: 20, k: 0, sd: 0, ad: 0, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }], wrongs: [], expected: 20, matched: 0, accuracy: 0 }).entry; return e.R[0][6].length; }, clean: 6 },
  { id: 'MUT-MEANS', why: 'the timing means come out wrong (halved)',
    edits: [['Math.round(a.sd / a.k)', 'Math.round(a.sd / a.k / 2)']],
    probe: async R => R.buildEntry({ id: 'r', at: 1, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 0, rows: [{ mi: 0, h: 0, e: 4, k: 4, sd: -40, ad: 120, ids: [] }], wrongs: [], expected: 4, matched: 4, accuracy: 1 }).entry.R[0][4], clean: -10 },
  { id: 'MUT-NO-SKIP', why: 'after a failure every later call still goes to the store (a retry loop, a toast loop)',
    edits: [["if (degraded) { if (!quiet) stats.skipped++; return { ok: false, code: 'degraded' }; }", '']],
    probe: async R => { let calls = 0; const l = R.createLog({ backend: R.memoryBackend({ fail: () => { calls++; return quota(); } }) }); for (let i = 1; i <= 6; i++) await l.append('s', 'h', run(R, i), meta); return calls; }, clean: 1 },
  { id: 'MUT-QUOTA-NAME', why: 'a full disk is called by no name (the page could not tell it from a bug)',
    edits: [["if (/quota/i.test(s)) return 'quota';", '']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend({ fail: () => quota() }) }); return (await l.append('s', 'h', run(R, 1), meta)).code; }, clean: 'quota' },
  { id: 'MUT-PICK', why: 'whatever a run carries leaves in the export (a secret that got into a record)',
    edits: [['function pickEntry(e) { const o = {}; ENTRY_KEYS.forEach(k => { if (e[k] !== undefined) o[k] = e[k]; }); return o; }', 'function pickEntry(e) { return e; }']],
    probe: async R => { const be = R.memoryBackend(); const l = R.createLog({ backend: be }); await l.append('s', 'h', run(R, 1), meta); be._raw.runs.get('s|h')[0].e.guestKey = 'KEY'; return /KEY/.test(R.exportText((await l.exportAll()).file)); }, clean: false },
  { id: 'MUT-REPAIR', why: 'a damaged epoch record is trusted as it is: it is never repaired and the log keeps a ghost',
    edits: [['const old = validEpoch(info.epoch) ? info.epoch : null;', 'const old = info.epoch || null;']],
    probe: async R => { const be = R.memoryBackend(); const l = R.createLog({ backend: be }); await l.append('s', 'h', run(R, 1), meta); be._raw.epochs.set('s|h', { ep: 's|h', songId: 's', hash: 12 }); await l.append('s', 'h', run(R, 2), meta); return (await l.epochs()).epochs.length; }, clean: 1 },
  { id: 'MUT-RATING-VALUES', why: 'any number is a rating',
    edits: [['if (!idOk(songId) || !idOk(hash) || !isNum(n) || (v !== 1 && v !== 2 && v !== 3)) return refuse(\'invalid\');', 'if (!idOk(songId) || !idOk(hash) || !isNum(n)) return refuse(\'invalid\');']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); await l.append('s', 'h', run(R, 1), meta); return (await l.rate('s', 'h', 1, 7)).ok; }, clean: false },
  { id: 'MUT-FORGET', why: 'a song removed from My Songs leaves its log behind',
    edits: [['[...epochs.values()].forEach(e => { if (isObj(e) && e.songId === songId) { runs.delete(e.ep);', '[...epochs.values()].forEach(e => { if (false) { runs.delete(e.ep);']],
    probe: async R => { const l = R.createLog({ backend: R.memoryBackend() }); await l.append('s', 'h', run(R, 1), meta); await l.forget('s'); return (await l.epochs()).epochs.length; }, clean: 0 }
];

test('the control: the real module answers every probe as written, and the no-op mutant answers like it', async () => {
  const real = require(SRC);
  for (const m of MUTATIONS) assert.deepEqual(await m.probe(real), m.clean, m.id + ' (the real module)');
});

for (const m of MUTATIONS) {
  test(m.id + ': ' + m.why, async () => {
    const mod = mutant(m.edits);
    const got = await m.probe(mod);
    if (m.same) assert.deepEqual(got, m.clean, 'a comment changes nothing');
    else assert.notDeepEqual(got, m.clean, 'the probe did not notice the mutation (it answered ' + JSON.stringify(got) + ', as the real module does)');
  });
}
