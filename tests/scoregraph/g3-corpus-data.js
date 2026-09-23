/* Corpus-scale inputs for G3's tests (docs/GOALS/G03 A3-A6, A8, A9): the graphs audio-score.js writes for a
   benchmark suite, and the committed MusicXML corpus imported. Built once per test process. Set
   PPP_G3_SUITES=core,robust,golden to choose the suites (default core and golden); PPP_G3_FAST=1 keeps one case in
   five. */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./tools/g3-graphs.js');
const { importCorpus } = require('./tools/g3-corpus.js');

const cache = {};
function suites() { return (process.env.PPP_G3_SUITES || 'core,golden').split(',').map(s => s.trim()).filter(Boolean); }
function keep(i) { return !process.env.PPP_G3_FAST || i % 5 === 0; }
/* [{id, graph}] of the suites' recording graphs */
function recorded(names) {
  const out = [];
  (names || suites()).forEach(s => {
    if (!cache[s]) cache[s] = G.graphs(s).filter(r => r.graph);
    cache[s].forEach((r, i) => { if (keep(i)) out.push(r); });
  });
  return out;
}
/* [{path, graph}] of the committed MusicXML corpus */
async function imported() {
  if (!cache.corpus) cache.corpus = (await importCorpus()).filter(r => r.ok);
  return cache.corpus.filter((r, i) => keep(i));
}
/* every G3 fixture graph under tests/scoregraph/fixtures/g3 */
function fixtures() {
  const SG = require('../../scoregraph/index.js');
  const out = [];
  const root = path.join(__dirname, 'fixtures', 'g3');
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sg.json')) out.push({ path: path.relative(root, p).replace(/\\/g, '/'), graph: SG.parse(fs.readFileSync(p, 'utf8')) });
    });
  })(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}
module.exports = { recorded, imported, fixtures, suites };
