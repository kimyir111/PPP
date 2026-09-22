#!/usr/bin/env node
/* Writes tests/scoregraph/golden/<key>.sg.json and <key>.issues.json (docs/GOALS/G01 A40, A42): for each G0
   golden input (tests/bench/golden/inputs/<key>.json), the ScoreGraph toMusicXml returns, as canonical text,
   and the codes of its warnings and notes with their counts.

     node tests/scoregraph/tools/make-golden.js

   vertical-slice.test.js requires the graph to be these bytes and the codes these counts. Run this only for a
   change meant to change them, look at the diff, and commit the files with that change. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const A = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const INPUTS = path.join(REPO, 'tests', 'bench', 'golden', 'inputs');
const OUT = path.join(REPO, 'tests', 'scoregraph', 'golden');

const counts = (issues, severity) => {
  const out = {};
  issues.filter(i => i.severity === severity).map(i => i.code).sort().forEach(c => { out[c] = (out[c] || 0) + 1; });
  return out;
};

fs.mkdirSync(OUT, { recursive: true });
const changed = [];
fs.readdirSync(INPUTS).filter(f => f.endsWith('.json')).sort().forEach(f => {
  const key = f.replace(/\.json$/, '');
  const data = JSON.parse(fs.readFileSync(path.join(INPUTS, f), 'utf8'));
  const r = A.toMusicXml(data.input, data.opts || {});
  const errors = r.graphIssues.filter(i => i.severity === 'ERROR');
  if (errors.length) throw new Error(key + ': the graph has errors: ' + errors.map(i => i.code).join(', '));
  const files = {
    [key + '.sg.json']: SG.serialize(r.graph),
    [key + '.issues.json']: JSON.stringify({ key: key, warnings: counts(r.graphIssues, 'WARNING'), infos: counts(r.graphIssues, 'INFO') }, null, 2) + '\n'
  };
  Object.keys(files).forEach(name => {
    const p = path.join(OUT, name);
    const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (old !== files[name]) { fs.writeFileSync(p, files[name]); changed.push(name); }
  });
});
process.stdout.write('scoregraph golden: ' + (changed.length ? 'wrote ' + changed.join(', ') : 'unchanged') + '\n');
