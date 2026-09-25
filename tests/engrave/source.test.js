/* G4a: a ScoreGraph for every score on screen (docs/GOALS/G04 §8.2, G4-D2, user decision G4-U1).

   live      the producer's own graph, while it states the same music as the Score
   store     the graph kept for the song, after a reload - intact and not stale
   projected legacy.fromScore(score), for a Score that has nothing else
   A reload is a new createSource() over the same store and a Score read back from its packed JSON. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E, storedScores, scoreOf, graphOf, withPositions } = require('./helpers.js');

const reload = score => withPositions(JSON.parse(JSON.stringify(score)));
const fresh = backend => E.createSource({ store: E.store.createStore({ backend: backend }) });
const xmlGraph = rel => SG.musicxml.import(fs.readFileSync(path.join(REPO, rel), 'utf8'), { scoreId: 'x' }).graph;

test('live: the producer\'s graph is used while it agrees with the Score; one that does not is not', async () => {
  const g = await graphOf('catalog/method/czerny849/001.mxl');
  const score = scoreOf(g, 'cz');
  const src = E.createSource();
  src.remember(score, g, 'import:mxl');
  const r = src.resolveSync(score);
  assert.equal(r.via, 'live');
  assert.equal(r.graph, g, 'the very graph, not a copy');
  assert.ok(r.link.ok && r.agree.ok);
  /* the Score changed after it was made (OMR's PdfLayer adds chord names to the Score, never to the graph) */
  const s2 = scoreOf(g, 'cz2');
  s2.chords = s2.chords.concat([{ m: s2.measures[0].number, b: 0, text: 'C' }]);
  const src2 = E.createSource();
  src2.remember(s2, g, 'omr');
  const r2 = src2.resolveSync(s2);
  assert.equal(r2.via, 'projected', 'a graph that disagrees is not used');
  assert.equal(r2.diagnostics[0].code, 'SOURCE_DISAGREE');
  assert.ok(r2.agree.ok, 'and the projection states the Score, chord name and all');
  /* a producer that hands over the XML: read into a graph only when asked */
  let calls = 0;
  const s3 = scoreOf(g, 'cz3');
  const src3 = E.createSource();
  src3.remember(s3, () => { calls++; return g; }, 'omr');
  assert.equal(calls, 0);
  assert.equal(src3.resolveSync(s3).via, 'live');
  assert.equal(calls, 1);
});

test('G4-U1: a song\'s graph survives save and reload, from the store, and is the graph that was kept', async () => {
  const rel = 'tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml';
  const g = xmlGraph(rel);
  /* the app's own Score for this file, captured from the page (finalized, 8va moved) */
  const score = JSON.parse(JSON.stringify(storedScores().find(([f]) => f === 'stored-graph-ottava.score.json')[1].score));
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  const put = await a.persist('song-1', score);
  assert.ok(put.ok, put.code);
  assert.equal((await a.persist('song-1', score)).code, 'already', 'kept once per song');
  /* the page reloads: a new source, the same store, the Score read back from its slot */
  const b = fresh(backend);
  const back = reload(score);
  const r = await b.resolve(back, { key: 'song-1' });
  assert.equal(r.via, 'store');
  assert.equal(SG.fingerprint(r.graph), SG.fingerprint(g), 'the graph that was kept, byte for byte');
  assert.ok(r.link.ok);
  /* it keeps what the Score cannot: the file's own beaming is in the kept graph, not in a projection */
  const burg = await graphOf('catalog/method/burgmuller25/021.mxl');
  const bs = scoreOf(burg, 'burg');
  const c = fresh(backend);
  c.remember(bs, burg, 'course');
  assert.ok((await c.persist('song-2', bs)).ok);
  const r2 = await fresh(backend).resolve(reload(bs), { key: 'song-2' });
  assert.equal(r2.via, 'store');
  const beams = gr => gr.parts.reduce((n, p) => n + p.spanners.filter(s => s.type === 'beam').length, 0);
  assert.ok(beams(r2.graph) > 100 && beams(r2.graph) === beams(burg), 'the file\'s beams come back after a reload');
  const r3 = await fresh(E.store.memoryBackend()).resolve(reload(bs), { key: 'song-2' });
  assert.equal(r3.via, 'projected');
  assert.equal(beams(r3.graph), 0, 'without the store they would not');
});

test('a Score read back from its song slot hashes as it did before the save (packScore drops null fields)', () => {
  /* the same transcription, captured from the page as it is made and as a song slot gives it back */
  const fx = Object.fromEntries(storedScores().map(([f, x]) => [f, x.score]));
  const live = fx['recording-G02.score.json'], stored = fx['stored-recording-G02.score.json'];
  const nulls = s => s.notes.reduce((n, x) => n + Object.keys(x).filter(k => x[k] === null).length, 0);
  assert.ok(nulls(live) > 0 && nulls(stored) === 0, 'the slot really did drop the null fields');
  assert.equal(E.scoreHash(stored), E.scoreHash(live), 'and the music hash does not notice');
  const other = JSON.parse(JSON.stringify(stored));
  other.notes[0].dur += 0.25;
  assert.notEqual(E.scoreHash(other), E.scoreHash(live), 'while a change of the music does');
});

test('a kept graph that is stale, another score\'s, corrupt or unreachable is not used, and the song still opens', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  assert.ok((await a.persist('song-1', score)).ok);
  /* the song's Score changed since (a rewrite kept the id): stale */
  const changed = reload(score);
  changed.notes.splice(changed.notes.findIndex(n => !n.rest), 1);
  const r1 = await fresh(backend).resolve(changed, { key: 'song-1' });
  assert.equal(r1.via, 'projected');
  assert.equal(r1.diagnostics[0].code, 'STORE_STALE');
  assert.equal(backend._map.has('song-1'), true, 'the stale graph is not used, and not deleted: the next save replaces it');
  /* another score under the key */
  assert.ok((await a.persist('song-2', score)).ok);
  const other = reload(score); other.id = 'something-else';
  const r2 = await fresh(backend).resolve(other, { key: 'song-2' });
  assert.equal(r2.diagnostics[0].code, 'STORE_OTHER_SCORE');
  assert.equal(r2.via, 'projected');
  /* asking about another Score under a song's key (a review-screen arrangement, not saved) leaves the song's graph */
  assert.equal(backend._map.has('song-2'), true, 'the song keeps its graph');
  assert.equal((await fresh(backend).resolve(reload(score), { key: 'song-2' })).via, 'store', 'and the song still opens from it');
  /* corrupt bytes */
  const b = fresh(backend);
  b.remember(score, g, 'x');
  assert.ok((await b.persist('song-3', score)).ok);
  backend._map.get('song-3').data = new Uint8Array(64).buffer;
  const r3 = await fresh(backend).resolve(reload(score), { key: 'song-3' });
  assert.equal(r3.via, 'projected');
  assert.ok(/^STORE_/.test(r3.diagnostics[0].code));
  assert.equal(backend._map.has('song-3'), false);
  /* no store at all (a private window), or one that throws */
  assert.equal((await E.createSource().resolve(reload(score), { key: 'song-1' })).via, 'projected');
  const broken = { kind: 'x', get: async () => { throw new Error('boom'); }, put: async () => { throw new Error('boom'); }, del: async () => {}, all: async () => [] };
  const r4 = await fresh(broken).resolve(reload(score), { key: 'song-1' });
  assert.equal(r4.via, 'projected');
  assert.ok(r4.link.ok, 'and practice still has its map');
});

test('a reconstructed graph never takes the place of a kept one, and only an agreeing live graph is kept', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  await a.persist('song-1', score);
  const kept = backend._map.get('song-1').fp;
  /* after a reload the Score has no live graph: persisting it writes nothing */
  const b = fresh(backend);
  const back = reload(score);
  assert.equal((await b.persist('song-1', back)).code, 'no-live-graph');
  await b.resolve(back, { key: 'song-1' });
  assert.equal((await b.persist('song-1', back)).code, 'no-live-graph', 'resolving does not make a graph live');
  assert.equal(backend._map.get('song-1').fp, kept, 'the kept graph is untouched');
  /* a live graph that disagrees with its Score is not kept */
  const s2 = scoreOf(g, 'pm2'); s2.notes[0].dur += 1;
  const c = fresh(backend);
  c.remember(s2, g, 'x');
  assert.equal((await c.persist('song-9', s2)).code, 'disagree');
  assert.equal(backend._map.has('song-9'), false);
  /* the demo and a key-less song are never kept */
  assert.equal((await a.persist('demo', score)).code, 'no-key');
  /* a removed song takes its graph with it */
  await a.forget('song-1');
  assert.equal(backend._map.has('song-1'), false);
});

test('every kind of Score the app holds gets a graph: import, catalogue, recording, OMR-like, stored, demo, MIDI', async () => {
  const seen = {};
  storedScores().forEach(([f, x]) => {
    const r = E.createSource().resolveSync(x.score);
    assert.ok(r.graph, f);
    assert.ok(r.link.ok, f + ': linked');
    seen[x.how] = r.via;
  });
  assert.deepEqual(Object.keys(seen).sort(), ['demo', 'graph', 'parse', 'recording', 'stored-graph', 'stored-recording']);
  /* MIDI: the inferred notation of the import door */
  const mid = await graphOf('tests/scoregraph/fixtures/midi/m27-twenty-notes.mid');
  const ms = scoreOf(mid, 'mid');
  const src = E.createSource();
  src.remember(ms, mid, 'import:midi');
  const r = src.resolveSync(ms);
  assert.equal(r.via, 'live');
  assert.equal(SG.legacy.inferredNotation(r.graph), true);
});

/* ---------------------------------------------------------------- fixer P3, P4, P9 */
test('P3: a Score object the app replaced with another of the same music still finds its producer\'s graph', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  /* the app now holds a copy (a Score read back from its slot, a cloned state object) */
  const copy = reload(score);
  assert.equal(a.hasLive(copy), false, 'not the object the graph was remembered with');
  const r = a.resolveSync(copy);
  assert.equal(r.via, 'live', 'found by its music');
  assert.equal(r.graph, g);
  assert.ok(a.stats.byContent >= 1);
  const put = await a.persist('song-1', copy);
  assert.ok(put.ok, put.code);
  assert.equal(SG.fingerprint((await fresh(backend).resolve(reload(score), { key: 'song-1' })).graph), SG.fingerprint(g));
  /* a copy whose music differs is not handed that graph */
  const other = reload(score); other.notes.find(n => !n.rest).dur += 1;
  assert.equal((await a.persist('song-2', other)).code, 'no-live-graph');
});

test('P3: a save that fails is counted and the next save tries again - no stuck pending save', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const base = scoreOf(g, 'pm');
  /* agree() reads score.notes; make it throw on the second read of one save (the first is the music hash) */
  let reads = 0, fail = true;
  const score = Object.assign({}, base);
  Object.defineProperty(score, 'notes', { enumerable: true, get() { reads++; if (fail && reads === 2) throw new Error('boom'); return base.notes; } });
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'x');
  const r1 = await a.persist('song-1', score);
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'error');
  assert.equal(backend._map.has('song-1'), false);
  fail = false;
  const r2 = await a.persist('song-1', score);
  assert.ok(r2.ok, 'the next save keeps it: ' + r2.code);
  assert.equal(a.stats.persist.error, 1);
  assert.equal(a.stats.persist.ok, 1);
});

test('P9: a Score changed in place is resolved again, and its save is not taken as already done', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  assert.equal(a.resolveSync(score).via, 'live');
  assert.ok((await a.persist('song-1', score)).ok);
  assert.equal((await a.persist('song-1', score)).code, 'already');
  /* the same object, other music (an edit in place keeps the Score's id) */
  score.notes.find(n => !n.rest).dur += 0.5;
  const r = a.resolveSync(score);
  assert.notEqual(r.via, 'live', 'the memo does not hand back the graph of the music that was');
  assert.equal(r.diagnostics[0].code, 'SOURCE_DISAGREE');
  const p = await a.persist('song-1', score);
  assert.equal(p.code, 'disagree', 'not "already": the music changed');
  /* and the kept graph, now stale, is not used at the next read */
  const back = await fresh(backend).resolve(reload(score), { key: 'song-1' });
  assert.equal(back.via, 'projected');
  assert.equal(back.diagnostics[0].code, 'STORE_STALE');
});

test('P4: a kept graph from another library or music-hash version is checked by agree() again - kept when it agrees, not used when not', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const st = E.store.createStore({ backend: backend });
  const src = E.createSource({ store: st });
  const hash = src.scoreHash(score);
  /* kept by an older library: same music hash, but the rules it agreed under are not this library's */
  assert.ok((await st.put('song-1', g, { via: 'live', scoreId: score.id, scoreHash: hash, hashV: src.HASH_VERSION, agreeLib: '1.2.0' })).ok);
  const r = await E.createSource({ store: st }).resolve(reload(score), { key: 'song-1' });
  assert.equal(r.via, 'store');
  assert.ok(r.revalidated);
  assert.ok(r.diagnostics.some(d => d.code === 'STORE_REVALIDATED'));
  assert.equal(backend._map.get('song-1').agreeLib, SG.version, 'kept again under this library');
  /* the next read takes the fast path */
  const r2 = await E.createSource({ store: st }).resolve(reload(score), { key: 'song-1' });
  assert.equal(r2.via, 'store');
  assert.equal(r2.revalidated, false);
  /* another piece's graph under this song, from an older hash version: agree() refuses it */
  const other = await graphOf('tests/scoregraph/fixtures/xml/grand-staff.musicxml');
  assert.ok((await st.put('song-2', other, { via: 'live', scoreId: score.id, scoreHash: 'old-hash', hashV: 'h0', agreeLib: SG.version })).ok);
  const r3 = await E.createSource({ store: st }).resolve(reload(score), { key: 'song-2' });
  assert.equal(r3.via, 'projected');
  assert.ok(r3.diagnostics.some(d => d.code === 'STORE_INCOMPATIBLE'));
  assert.equal(backend._map.has('song-2'), true, 'not used, and not deleted (it may be another Score\'s)');
  /* a migrated schema: the same rule (a stub store that says so) */
  const stub = { get: async () => ({ ok: true, graph: g, migrated: true, record: { scoreId: score.id, scoreHash: hash, hashV: src.HASH_VERSION, agreeLib: SG.version, producer: 'x' } }),
    put: async () => ({ ok: true }), del: async () => true };
  const r4 = await E.createSource({ store: stub }).resolve(reload(score), { key: 'song-3' });
  assert.equal(r4.via, 'store');
  assert.ok(r4.revalidated, 'a migrated graph is agreed again before use');
});

/* The final review's surviving mutations on the store path: link() there was never reached by a test (M-l), and a
   projection resolveSync() made earlier could stand in for the kept graph (N-af). */
test('a kept record that passes every byte and hash check but states other notes is refused by link(), and dropped', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const st = E.store.createStore({ backend: backend });
  const src = E.createSource({ store: st });
  /* another graph of the same shape: one pitch up an octave - intact bytes, its own fingerprint, this Score's id and
     music hash, this library: every fast-path check passes, only the notes differ */
  const doc = JSON.parse(SG.serialize(g));
  const h = doc.parts[0].events.find(e => e.heads && e.heads.length).heads[0];
  h.pitch.oct += 1;
  const forged = SG.parse(JSON.stringify(doc));
  assert.ok((await st.put('song-1', forged, { via: 'live', scoreId: score.id, scoreHash: src.scoreHash(score), hashV: src.HASH_VERSION, agreeLib: SG.version })).ok);
  const r = await E.createSource({ store: st }).resolve(reload(score), { key: 'song-1' });
  assert.equal(r.via, 'projected');
  assert.ok(r.diagnostics.some(d => d.code === 'STORE_LINK_FAILED'), JSON.stringify(r.diagnostics));
  assert.equal(backend._map.has('song-1'), false, 'a record whose notes do not link is dropped');
});

test('a projection made earlier does not stand in for the kept graph: resolve() still asks the store', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const backend = E.store.memoryBackend();
  const a = fresh(backend);
  a.remember(score, g, 'import:musicxml');
  assert.ok((await a.persist('song-1', score)).ok);
  const b = fresh(backend);
  const back = reload(score);
  assert.equal(b.resolveSync(back).via, 'projected', 'no store asked: a projection');
  const r = await b.resolve(back, { key: 'song-1' });
  assert.equal(r.via, 'store', 'the kept graph wins over the earlier projection');
  assert.equal(SG.fingerprint(r.graph), SG.fingerprint(g));
});

/* The failure the brief names: the save itself fails (the disk refuses the write) while it is the pending save, the
   condition clears, and the next save of the same song and music succeeds - a failed save never stays pending. */
test('a save whose write fails is recorded, and once storage recovers the next save of the same song succeeds', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const mem = E.store.memoryBackend();
  let refuse = true;
  const backend = Object.assign({}, mem, { kind: 'flaky', put: async rec => {
    if (refuse) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return mem.put(rec);
  } });
  const a = E.createSource({ store: E.store.createStore({ backend: backend }) });
  a.remember(score, g, 'import:musicxml');
  const r1 = await a.persist('song-1', score);
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'quota', 'the failure is named');
  assert.equal(a.stats.persist.quota, 1, 'and recorded');
  assert.equal(mem._map.has('song-1'), false);
  refuse = false;
  const r2 = await a.persist('song-1', score);
  assert.ok(r2.ok, 'the next save of the same song and music is not the failed one: ' + r2.code);
  assert.equal(mem._map.has('song-1'), true);
  assert.equal(SG.fingerprint((await fresh(mem).resolve(reload(score), { key: 'song-1' })).graph), SG.fingerprint(g));
});

/* G4b (G4a final review MINOR): IndexedDB can leave a call pending for good; nothing may wait on it for ever */
test('a store that never answers: resolve() falls back to the projection in bounded time, and names it', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const score = scoreOf(g, 'pm');
  const never = () => new Promise(() => {});
  const hang = { kind: 'hang', get: never, put: never, del: never, sizes: never };
  const st = E.store.createStore({ backend: hang, limits: { timeout: 40 } });
  const t0 = Date.now();
  const r = await E.createSource({ store: st }).resolve(reload(score), { key: 'song-1' });
  assert.ok(Date.now() - t0 < 2000, 'bounded: ' + (Date.now() - t0) + ' ms');
  assert.equal(r.via, 'projected');
  assert.ok(r.link.ok, 'practice still has its map');
  assert.ok(r.diagnostics.some(d => d.code === 'STORE_TIMEOUT'), JSON.stringify(r.diagnostics));
  /* a save against it ends too, named, and does not stay pending */
  const a = E.createSource({ store: st });
  a.remember(score, g, 'import:musicxml');
  assert.equal((await a.persist('song-1', score)).code, 'timeout');
  assert.equal((await a.persist('song-1', score)).code, 'timeout', 'the next save tries again, it is not stuck behind the first');
});

test('an IndexedDB open that never settles times out, and a late success is closed rather than kept', async () => {
  let req = null;
  const fakeIdb = { open: () => { req = {}; return req; } };
  const backend = E.store.idbBackend(fakeIdb, { openTimeout: 30 });
  await assert.rejects(backend.get('k'), e => e.code === 'timeout');
  let closed = false;
  req.result = { close: () => { closed = true; } };
  req.onsuccess();
  assert.equal(closed, true, 'the connection that answered too late is closed');
  /* through the store: a named code, never a hang */
  const st = E.store.createStore({ backend: E.store.idbBackend({ open: () => ({}) }, { openTimeout: 30 }) });
  assert.equal((await st.get('k')).code, 'timeout');
});
