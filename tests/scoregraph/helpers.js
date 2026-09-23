/* Shared test helpers for tests/scoregraph/*.test.js (node --test, no dependencies). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const FIX = path.join(__dirname, 'fixtures');

const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
/* every file of a fixture directory with an extension, sorted */
const list = (dir, ext) => fs.readdirSync(path.join(FIX, dir)).filter(f => f.endsWith(ext) && !f.endsWith('.expect.json')).sort();
const sidecar = (dir, file) => json(path.join(FIX, dir, file.replace(/\.sg\.json$|\.musicxml$|\.json$/, '.expect.json'))).expect;
const xml = name => read(path.join(FIX, 'xml', name + '.musicxml'));
const corpus = rel => read(path.join(REPO, rel));
function importXml(text, opts) {
  const r = SG.musicxml.import(text, opts || { scoreId: 'test' });
  if (!r.ok) throw new Error('import failed: ' + r.code + ' ' + r.message);
  return r;
}
const codes = (issues, severity) => {
  const out = {};
  issues.filter(i => !severity || i.severity === severity).forEach(i => { out[i.code] = (out[i.code] || 0) + 1; });
  return out;
};
const pitchName = p => p.step + (p.alter === 1 ? '#' : p.alter === -1 ? 'b' : p.alter === 2 ? '##' : p.alter === -2 ? 'bb' : '') + p.oct;
/* Every .sg.json committed under tests/scoregraph, except migrations/: those are documents of an
   older version on purpose, so serialize(parse(s)) raises them rather than reproducing them. The
   migration test in serialize.test.js is what checks them. */
function allSgJson() {
  const out = [];
  const skip = path.join(__dirname, 'migrations');
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (p !== skip) walk(p); }
      else if (e.name.endsWith('.sg.json')) out.push(p);
    });
  })(__dirname);
  return out.sort();
}
/* a deterministic 32-bit LCG (the one tests/transcription.test.js and G0 use) */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

module.exports = { REPO, SG, FIX, read, json, list, sidecar, xml, corpus, importXml, codes, pitchName, allSgJson, lcg };
