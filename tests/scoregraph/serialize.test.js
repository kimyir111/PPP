'use strict';
/* Canonical JSON, versions and migration (G01 §14, A10, A12, A13). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG, FIX, read, list, xml, allSgJson } = require('./helpers.js');

const graphsMadeHere = () => {
  const out = list('valid', '.sg.json').map(f => SG.parse(read(path.join(FIX, 'valid', f))));
  list('xml', '.musicxml').forEach(f => {
    const r = SG.musicxml.import(read(path.join(FIX, 'xml', f)), { scoreId: 'x' });
    if (r.ok) out.push(r.graph);
  });
  return out;
};

test('every committed .sg.json is canonical: serialize(parse(s)) === s (A10)', () => {
  const files = allSgJson();
  assert.ok(files.length >= 16);
  files.forEach(f => {
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(SG.serialize(SG.parse(s)), s, path.relative(FIX, f));
  });
});

test('every graph made in the tests comes back deep-equal from its text (A10)', () => {
  graphsMadeHere().forEach(g => assert.deepEqual(SG.parse(SG.serialize(g)), g, g.id));
});

test('a non-canonical text parses, and writes back canonical', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
  const loose = JSON.stringify(JSON.parse(SG.serialize(g)));           /* one line, same keys */
  const withDefaults = JSON.parse(loose);
  withDefaults.parts[0].staves.forEach(s => { s.kind = 'standard'; s.lines = 5; });   /* defaults written out */
  withDefaults.timeline.measures.forEach(m => { if (!m.implicit) m.implicit = false; });
  withDefaults.parts[0].events.reverse();                             /* a non-canonical order */
  assert.equal(SG.serialize(SG.parse(JSON.stringify(withDefaults))), SG.serialize(g));
});

/* A12: the lint of the canonical form */
function lint(text) {
  const problems = [];
  if (text.charCodeAt(0) === 0xFEFF) problems.push('BOM');
  if (/\r/.test(text)) problems.push('CR');
  if (!text.endsWith('}\n') || text.endsWith('\n\n')) problems.push('final newline');
  const doc = JSON.parse(text);
  if (Object.keys(doc)[0] !== 'scoregraph_version') problems.push('first key');
  if (/\bnull\b/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) problems.push('null');
  const lines = text.split('\n');
  /* an entity array: "key": [ on its own line, then one compact element per line */
  lines.forEach((l, i) => {
    if (/": \[$/.test(l)) {
      for (let j = i + 1; j < lines.length && !/^\s*\](,)?$/.test(lines[j]); j++) {
        if (!/^\s*[{\[]/.test(lines[j]) && !/^\s*"/.test(lines[j]) && !/^\s*-?\d/.test(lines[j])) problems.push('line ' + (j + 1));
      }
    }
    if (/": \[\]/.test(l) && !/"(clefs|events|directions|spanners|voices|notes|sources|measures|meters|parts)": \[\]/.test(l)) problems.push('empty optional array: ' + l.trim());
  });
  /* numbers with a fraction only where the schema allows them (conf, layout width, display x, ext) */
  (function walk(v, key) {
    if (typeof v === 'number' && !Number.isInteger(v) && !['conf', 'width', 'x'].includes(key)) problems.push('non-integer ' + key + ': ' + v);
    if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (k !== 'ext') walk(v[k], k); });
  })(doc, '');
  return problems;
}

test('the canonical text passes the lint: first key, no null, no empty optional array, one entity per line, no stray fractions (A12)', () => {
  allSgJson().forEach(f => assert.deepEqual(lint(fs.readFileSync(f, 'utf8')), [], f));
  graphsMadeHere().forEach(g => assert.deepEqual(lint(SG.serialize(g)), [], g.id));
});

test('an entity array element is a single line; containers put one member per line', () => {
  const s = SG.serialize(SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json'))));
  assert.match(s, /^\{\n  "scoregraph_version": 1,\n  "id": "sg-example-waltz",\n/);
  assert.match(s, /\n    "measures": \[\n      \{"id":"m7","number":"0","dur":"1\/4","implicit":true\},\n/);
  assert.match(s, /\n      "directions": \[\n        \{"id":"d45"/);
});

test('a version that is missing, not an integer or newer than the code is refused with E-VERSION (A13)', () => {
  const g = JSON.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
  const bad = [undefined, '1', 1.5, 2, 99];
  bad.forEach(v => {
    const d = Object.assign({}, g);
    if (v === undefined) delete d.scoregraph_version; else d.scoregraph_version = v;
    assert.throws(() => SG.parse(JSON.stringify(d)), e => e.code === 'E-VERSION', String(v));
  });
  /* an older version with no migration registered is refused too (v1 is the first version) */
  assert.throws(() => SG.parse(read(path.join(__dirname, 'migrations', 'v0.json'))), e => e.code === 'E-VERSION');
});

test('a registered migration chain upgrades a document step by step and keeps its IDs (A13)', () => {
  /* the test-only v0 -> v1 migration: the pretend root field "tempo" becomes a TempoEvent */
  const v0to1 = doc => {
    const out = JSON.parse(JSON.stringify(doc));
    delete out.about;
    out.timeline.tempos = [{ id: 'tp' + out.nextId, m: out.timeline.measures[0].id, at: '0', qpm: String(out.tempo) }];
    out.nextId += 1;
    delete out.tempo;
    out.scoregraph_version = 1;
    return out;
  };
  const text = read(path.join(__dirname, 'migrations', 'v0.json'));
  const g = SG.parse(text, { migrations: { 0: v0to1 } });
  const expected = read(path.join(__dirname, 'migrations', 'v1.sg.json'));
  assert.equal(SG.serialize(g), expected);
  const ids = s => (s.match(/"id":\s*"[a-z]+\d+"/g) || []).map(x => x.replace(/\s/g, '')).sort();
  const before = ids(text), after = ids(expected);
  before.forEach(id => assert.ok(after.includes(id), id + ' kept'));
  /* a chain of two steps (the pretend versions 1 -> 2 -> 3 with the current version raised for the test) */
  const step = n => doc => Object.assign({}, doc, { scoregraph_version: n + 1, ext: Object.assign({}, doc.ext, { ['test.step' + n]: n }) });
  const up = SG.migrate(JSON.parse(expected), { current: 3, migrations: { 1: step(1), 2: step(2) } });
  assert.equal(up.scoregraph_version, 3);
  assert.deepEqual(up.ext, { 'test.step1': 1, 'test.step2': 2 });
  assert.deepEqual(up.parts[0].events[0].id, 'e7');
  assert.throws(() => SG.migrate(JSON.parse(expected), { current: 3, migrations: { 1: step(1) } }), e => e.code === 'E-VERSION');
});

test('the fingerprint is the FNV-1a 64 of the canonical text: 16 hex digits, same for the same graph (§14.5)', () => {
  const a = SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
  const b = SG.parse(JSON.stringify(JSON.parse(SG.serialize(a))));
  assert.match(SG.fingerprint(a), /^[0-9a-f]{16}$/);
  assert.equal(SG.fingerprint(a), SG.fingerprint(b));
  const c = SG.ops.updateHead(a, 'h19', { pitch: { step: 'E', oct: 5 } }).graph;
  assert.notEqual(SG.fingerprint(c), SG.fingerprint(a));
  assert.deepEqual(SG.scoreRef(a), { scoreId: 'sg-example-waltz', rev: 0, fp: SG.fingerprint(a) });
  /* the published FNV-1a 64 test vectors */
  const fnv = require('../../scoregraph/serialize.js').fnv1a64;
  assert.equal(fnv([]), 'cbf29ce484222325');
  assert.equal(fnv([0x61]), 'af63dc4c8601ec8c');
  assert.equal(fnv(Array.from(Buffer.from('foobar'))), '85944171f73967e8');
});

test('the XML fixtures\' graphs have no fractional numbers outside conf and layout (A3)', () => {
  list('xml', '.musicxml').forEach(f => {
    const r = SG.musicxml.import(read(path.join(FIX, 'xml', f)));
    if (!r.ok) return;
    const s = SG.serialize(r.graph);
    const bare = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const fractions = (bare.match(/-?\d+\.\d+/g) || []);
    assert.deepEqual(fractions, [], f);
  });
  assert.ok(xml('tuplets-nested').length > 0);
});
