'use strict';
/* The same input gives the same bytes: across processes, whatever the object key order (G01 §14, A11, A30). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, SG, FIX, read, list, xml } = require('./helpers.js');

/* run a snippet in a fresh Node process and return its stdout */
function inChild(code) {
  return execFileSync(process.execPath, ['-e', code], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
const SNIPPET = file => `
  const SG = require(${JSON.stringify(path.join(REPO, 'scoregraph', 'index.js'))});
  const fs = require('fs');
  const r = SG.musicxml.import(fs.readFileSync(${JSON.stringify(file)}, 'utf8'), { scoreId: 'det', sourceName: 'x.musicxml' });
  process.stdout.write(SG.serialize(r.graph));`;

test('importing the same MusicXML in two processes gives the same bytes, IDs included (A30, A11)', () => {
  ['grand-staff', 'tuplets-nested', 'ties-slurs', 'repeats-endings-12-3'].forEach(name => {
    const file = path.join(FIX, 'xml', name + '.musicxml');
    const a = inChild(SNIPPET(file)), b = inChild(SNIPPET(file));
    assert.equal(a, b, name);
    assert.equal(a, SG.serialize(SG.musicxml.import(xml(name), { scoreId: 'det', sourceName: 'x.musicxml' }).graph), name);
  });
  const corpusFile = path.join(REPO, 'samples', 'prelude-fragment.musicxml');
  assert.equal(inChild(SNIPPET(corpusFile)), inChild(SNIPPET(corpusFile)));
});

function reorderKeys(v, rnd) {
  if (Array.isArray(v)) return v.map(x => reorderKeys(x, rnd));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    const o = {};
    keys.forEach(k => { o[k] = reorderKeys(v[k], rnd); });
    return o;
  }
  return v;
}

test('the object key insertion order never reaches the bytes (A11)', () => {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  list('valid', '.sg.json').forEach(f => {
    const text = read(path.join(FIX, 'valid', f));
    const doc = JSON.parse(text);
    for (let k = 0; k < 3; k++) assert.equal(SG.serialize(reorderKeys(doc, rnd)), text, f);
  });
});

test('the text is LF only, with one final newline and no BOM (A11)', () => {
  list('valid', '.sg.json').concat(['..' + path.sep + '..' + path.sep + 'migrations' + path.sep + 'v1.sg.json']).forEach(f => {
    const text = SG.serialize(SG.parse(read(path.join(FIX, 'valid', f))));
    assert.ok(!text.includes('\r'), f);
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'), f);
    assert.notEqual(text.charCodeAt(0), 0xFEFF);
  });
});

test('a builder called twice the same way gives the same IDs and bytes', () => {
  const make = () => {
    const b = SG.builder({ id: 'twice', source: { kind: 'user' } });
    const p = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
    const st = b.staff(p, { limb: 'RH' }).id, v = b.voice(p, { staff: st, label: '1' }).id;
    const m = b.measure({ number: '1', dur: '1' }).id;
    b.meter({ m: m, beats: [4], beatType: 4 });
    b.clef(p, { staff: st, m: m, at: '0', sign: 'G' });
    b.event(p, { kind: 'note', m: m, at: '0', dur: '1', voice: v, staff: st, heads: [{ pitch: { step: 'A', oct: 4 } }] });
    return SG.serialize(b.finish().graph);
  };
  assert.equal(make(), make());
});
