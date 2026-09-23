'use strict';
/* The same files load as browser scripts, with no require and no module (G01 §15.5, A1). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { REPO, SG, xml } = require('./helpers.js');

/* the order the app's HTML loads them in (index.js last) */
const ORDER = ['rational', 'schema', 'pitch', 'time', 'serialize', 'validate', 'build', 'prov', 'ops', 'xml',
  'musicxml-import', 'musicxml-export', 'midi-file', 'midi-import', 'index'];

test('the script order names every scoregraph file', () => {
  const files = fs.readdirSync(path.join(REPO, 'scoregraph')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
  assert.deepEqual(files, ORDER.slice().sort());
});

test('loaded as scripts in a bare context they leave a working PPPScoreGraph global', () => {
  const ctx = vm.createContext({});
  assert.equal(vm.runInContext('typeof require + " " + typeof module', ctx), 'undefined undefined');
  ORDER.forEach(name => vm.runInContext(fs.readFileSync(path.join(REPO, 'scoregraph', name + '.js'), 'utf8'), ctx, { filename: name + '.js' }));
  const B = ctx.PPPScoreGraph;
  assert.ok(B, 'PPPScoreGraph is defined');
  assert.equal(B.version, SG.version);
  assert.equal(B.SCOREGRAPH_VERSION, 2);
  /* the browser build gives the same bytes as the Node one */
  const r = B.musicxml.import(xml('grand-staff'), { scoreId: 'browser' });
  assert.equal(r.ok, true);
  const n = SG.musicxml.import(xml('grand-staff'), { scoreId: 'browser' });
  assert.equal(B.serialize(r.graph), SG.serialize(n.graph));
  assert.equal(B.musicxml.export(r.graph).xml, SG.musicxml.export(n.graph).xml);
});

test('package.json dependencies are the base commit\'s, byte for byte (A1)', () => {
  const now = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const base = JSON.parse(execFileSync('git', ['show', 'aff7080:package.json'], { cwd: REPO, encoding: 'utf8' }));
  assert.equal(JSON.stringify(now.dependencies), JSON.stringify(base.dependencies));
  assert.equal(JSON.stringify(now.devDependencies), JSON.stringify(base.devDependencies));
});
