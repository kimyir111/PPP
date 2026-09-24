/* G4a: the graph cache (docs/GOALS/G04 §8.2, user decision G4-U1).

   A cache, never the record: what comes back is checked byte for byte and against the schema, and anything wrong
   with it has a name and costs fidelity, never a song. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, E, corpusGraphs, graphOf, scoreOf } = require('./helpers.js');

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
  assert.equal(await code(Object.assign({}, identity, { data: newer.buffer })), 'schema-version');
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
