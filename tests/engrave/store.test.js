/* G4a: the graph cache (docs/GOALS/G04 §8.2, user decision G4-U1).

   A cache, never the record: what comes back is checked byte for byte and against the schema, and anything wrong
   with it has a name and costs fidelity, never a song. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, E, corpusGraphs, graphOf, scoreOf } = require('./helpers.js');
const Z = require('../../scoregraph/serialize.js');

const S = E.store;

test('a graph goes in and comes back the same, gzip or not, and the text kept is the canonical one', async () => {
  const g = await graphOf('catalog/method/burgmuller25/021.mxl');
  const fp = SG.fingerprint(g);
  for (const compress of [true, false]) {
    const rec = await S.encode(g, { key: 'k', scoreId: 's', scoreHash: 'h' }, { compress: compress });
    assert.equal(SG.fingerprint(g), fp, 'keeping a graph does not change it');
    assert.equal(rec.encoding, compress ? 'gzip' : 'identity');
    assert.equal(rec.fp, fp);
    assert.equal(rec.sgv, SG.SCOREGRAPH_VERSION);
    assert.equal(rec.lib, SG.version);
    const d = await S.decode(rec);
    assert.ok(d.ok, d.code);
    assert.equal(SG.serialize(d.graph), SG.serialize(g), 'the same bytes of canonical JSON');
    if (!compress) assert.equal(new TextDecoder().decode(new Uint8Array(rec.data)), SG.serialize(g));
  }
  /* the stored text does not depend on when or how often it is written */
  const a = await S.encode(g, { key: 'k', now: 1 }, { compress: false }), b = await S.encode(g, { key: 'k', now: 2 }, { compress: false });
  assert.deepEqual(new Uint8Array(a.data), new Uint8Array(b.data));
});

/* The final review saw an in-progress build gzip a comma-separated list of byte values instead of the JSON text: its
   own decode then refused every fresh record (fingerprint). Checked here with a gunzip that is not ours. */
test('what is kept is the canonical JSON\'s UTF-8 bytes, gzipped: node:zlib gunzips it to exactly that text, and a fresh write reads back', async () => {
  const zlib = require('zlib');
  const g0 = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  /* a title outside ASCII: bytes and characters differ in length, as they do for Korean and German titles */
  const doc = JSON.parse(SG.serialize(g0));
  doc.meta.title = 'Für Elise — 엘리제를 위하여 ♩';
  const g = SG.parse(JSON.stringify(doc));
  const text = SG.serialize(g);
  const rec = await S.encode(g, { key: 'k', scoreId: 's', scoreHash: 'h' });
  assert.equal(rec.encoding, 'gzip');
  const data = Buffer.from(new Uint8Array(rec.data));
  assert.deepEqual([data[0], data[1]], [0x1f, 0x8b], 'a gzip member');
  const back = zlib.gunzipSync(data);
  assert.equal(back.toString('utf8'), text, 'the canonical text, not a list of numbers');
  assert.ok(back.equals(Buffer.from(text, 'utf8')), 'byte for byte');
  assert.equal(rec.size, Buffer.byteLength(text, 'utf8'));
  assert.equal(rec.fp, SG.fingerprint(g), 'the fingerprint is the graph\'s own');
  const d = await S.decode(rec);
  assert.ok(d.ok, 'a fresh record passes its own checks: ' + d.code);
  assert.equal(SG.serialize(d.graph), text);
  /* through the store as the page uses it */
  const st = S.createStore({ backend: S.memoryBackend() });
  assert.ok((await st.put('song', g, { via: 'live', scoreId: 's' })).ok);
  const got = await st.get('song');
  assert.ok(got.ok, got.code);
  assert.equal(SG.fingerprint(got.graph), SG.fingerprint(g));
});

test('everything that can go wrong with a kept graph is named, and none of it throws', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const good = await S.encode(g, { key: 'k' });
  const identity = await S.encode(g, { key: 'k' }, { compress: false });
  const flip = (rec, i) => { const d = new Uint8Array(rec.data.slice(0)); d[i] ^= 0xff; return Object.assign({}, rec, { data: d.buffer }); };
  const code = async rec => (await S.decode(rec)).code;
  assert.equal(await code(null), 'missing');
  assert.equal(await code(Object.assign({}, good, { v: 99 })), 'record-version');
  assert.equal(await code(Object.assign({}, good, { data: null })), 'no-data');
  assert.equal(await code(Object.assign({}, good, { encoding: 'zip' })), 'encoding');
  assert.ok(['decode-failed', 'unreadable', 'fingerprint'].indexOf(await code(flip(good, 40))) >= 0, 'a corrupt gzip body');
  assert.ok(['decode-failed', 'unreadable'].indexOf(await code(Object.assign({}, good, { data: good.data.slice(0, 30) }))) >= 0, 'a truncated gzip body');
  /* a byte changed inside the JSON text: still JSON, not the graph that was kept */
  const text = SG.serialize(g);
  const altered = text.replace(/"number":\s*"1"/, '"number": "9"');
  assert.notEqual(altered, text);
  const bytes = new TextEncoder().encode(altered);
  assert.equal(await code(Object.assign({}, identity, { data: bytes.buffer })), 'fingerprint');
  /* a newer schema than this code knows */
  const newer = new TextEncoder().encode(text.replace('"scoregraph_version": ' + SG.SCOREGRAPH_VERSION, '"scoregraph_version": 99'));
  /* intact bytes (their own fingerprint) of a schema this code does not know */
  assert.equal(await code(Object.assign({}, identity, { data: newer.buffer, fp: Z.fnv1a64(newer) })), 'schema-version');
  /* the same bytes under the fingerprint of what was kept: changed after they were kept */
  assert.equal(await code(Object.assign({}, identity, { data: newer.buffer })), 'fingerprint');
  /* intact bytes of a graph the validator refuses (a note of no length) */
  const doc = JSON.parse(text);
  doc.parts[0].events[0].dur = '0';
  const badText = JSON.stringify(doc);
  const bad = SG.parse(badText);
  const badRec = Object.assign({}, identity, { data: new TextEncoder().encode(SG.serialize(bad)).buffer, fp: SG.fingerprint(bad) });
  assert.equal(await code(badRec), 'invalid');
});

test('the store: a bad record is dropped and named, a projection is refused, the oldest go first, a full disk is not an error', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const backend = S.memoryBackend();
  let t = 0;
  const st = S.createStore({ backend: backend, now: () => ++t, limits: { records: 3 } });
  assert.equal((await st.get('nothing')).code, 'missing');
  assert.ok((await st.put('a', g, { via: 'live', scoreId: 's' })).ok);
  const back = await st.get('a');
  assert.ok(back.ok && back.record.scoreId === 's');
  /* never a lower-fidelity graph in place of a producer's */
  assert.equal((await st.put('a', g, { via: 'projected' })).code, 'not-live');
  /* a corrupt record: named, dropped, gone */
  backend._map.get('a').data = new Uint8Array([1, 2, 3]).buffer;
  const bad = await st.get('a');
  assert.equal(bad.ok, false);
  assert.equal(backend._map.has('a'), false, 'the corrupt record is deleted');
  assert.ok(Object.keys(st.stats.dropped).length === 1);
  /* eviction: at most three records, the oldest out */
  for (const k of ['b', 'c', 'd', 'e']) assert.ok((await st.put(k, g, { via: 'live' })).ok);
  assert.deepEqual(await st.keys(), ['c', 'd', 'e']);
  /* a backend that fails: a code, not an exception */
  const failing = S.createStore({ backend: { kind: 'x', get: async () => { throw new Error('boom'); }, put: async () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }, del: async () => {}, all: async () => [] } });
  assert.equal((await failing.get('a')).code, 'backend');
  assert.equal((await failing.put('a', g, { via: 'live' })).code, 'quota');
  /* a record too big to keep is refused before it is written */
  const tiny = S.createStore({ backend: S.memoryBackend(), limits: { record: 10 } });
  assert.equal((await tiny.put('a', g, { via: 'live' })).code, 'too-large');
});

test('storage: what a kept graph costs, against the Score the song slot already stores (measured over the corpus)', async (t) => {
  const rows = [];
  for (const [rel, g] of await corpusGraphs()) {
    const rec = await S.encode(g, { key: rel });
    const score = JSON.stringify(scoreOf(g, rel));
    rows.push({ rel, text: rec.size, gzip: rec.stored, score: score.length });
  }
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const max = k => rows.reduce((m, r) => (r[k] > m[k] ? r : m), rows[0]);
  const ratio = sum('gzip') / sum('text');
  t.diagnostic('graphs ' + rows.length + ': canonical text ' + Math.round(sum('text') / 1024) + ' KB, gzip ' + Math.round(sum('gzip') / 1024) +
    ' KB (' + (ratio * 100).toFixed(1) + '%), legacy Score JSON ' + Math.round(sum('score') / 1024) + ' KB; largest gzip ' +
    Math.round(max('gzip').gzip / 1024) + ' KB (' + max('gzip').rel + ', text ' + Math.round(max('gzip').text / 1024) + ' KB)');
  assert.ok(ratio < 0.2, 'gzip keeps a graph at a fifth of its text or less');
  assert.ok(max('gzip').gzip < S.LIMITS.record, 'the largest corpus graph fits one record');
});

/* ---------------------------------------------------------------- fixer P8 */
test('P8: eviction reads record sizes only, never a kept graph', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const inner = S.memoryBackend();
  let dataReads = 0;
  const backend = Object.assign({}, inner, { kind: 'counted', get: async k => { dataReads++; return inner.get(k); } });
  let t = 0;
  const st = S.createStore({ backend: backend, now: () => ++t, limits: { records: 5 } });
  for (let i = 0; i < 12; i++) assert.ok((await st.put('k' + String(i).padStart(2, '0'), g, { via: 'live' })).ok);
  assert.equal(dataReads, 0, 'twelve saves and seven evictions read no graph');
  assert.deepEqual(await st.keys(), ['k07', 'k08', 'k09', 'k10', 'k11']);
  assert.equal(st.stats.evicted, 7);
});

test('P8: the cache stops writing before the origin\'s storage runs short, and says so', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const full = S.createStore({ backend: S.memoryBackend(), estimate: async () => ({ usage: 80.5e6, quota: 100e6 }) });
  assert.equal((await full.put('a', g, { via: 'live' })).code, 'quota-guard', 'room left for the song videos');
  const roomy = S.createStore({ backend: S.memoryBackend(), estimate: async () => ({ usage: 1e6, quota: 100e6 }) });
  assert.ok((await roomy.put('a', g, { via: 'live' })).ok);
  const broken = S.createStore({ backend: S.memoryBackend(), estimate: async () => { throw new Error('no'); } });
  assert.ok((await broken.put('a', g, { via: 'live' })).ok, 'an estimate that fails is not a reason to stop');
  assert.equal((await roomy.put('a', g, { via: 'revalidated' })).ok, true, 'a kept graph agreed again may be kept again');
});

test('R12 (G4b review, G4d-2): an estimate() or a decode that never answers runs under the store timeout - the save and the read both finish', async () => {
  const g = await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml');
  const never = () => new Promise(() => {});
  const limits = { timeout: 40 };
  /* estimate() pending for good: the put still ends, as with an estimate that fails (the backend's own quota error stops a full disk) */
  const hung = S.createStore({ backend: S.memoryBackend(), estimate: never, limits: limits });
  const t0 = Date.now();
  const put = await hung.put('a', g, { via: 'live' });
  assert.ok(put.ok, JSON.stringify(put));
  assert.ok(Date.now() - t0 < 2000, 'within the timeout, not for ever');
  assert.equal(hung.stats.errors['estimate-timeout'], 1, 'counted by name');
  /* a decode that never answers: the read ends as `timeout`, and the record is kept (nothing says it is bad) */
  const backend = S.memoryBackend();
  const writer = S.createStore({ backend: backend });
  assert.ok((await writer.put('k', g, { via: 'live' })).ok);
  const reader = S.createStore({ backend: backend, decode: never, limits: limits });
  const got = await reader.get('k');
  assert.equal(got.ok, false);
  assert.equal(got.code, 'timeout');
  assert.equal(reader.stats.errors['decode-timeout'], 1);
  assert.deepEqual(await reader.keys(), ['k'], 'the record stays');
  /* and the real decoder, under the same store, reads it */
  const ok = await S.createStore({ backend: backend }).get('k');
  assert.ok(ok.ok, ok.code);
});
