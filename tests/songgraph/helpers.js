/* Shared test helpers for tests/songgraph/*.test.js (node --test, no dependencies). Reuses
   tests/scoregraph/g3-helpers.js's mk() notation DSL for synthetic fixtures (key regions, cadences,
   repeats) and tests/scoregraph/tools/g3-corpus.js's corpus importer for the real-corpus checks
   (hymn SATB ground truth, performance, crash-freedom). */
'use strict';
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));
const H = require(path.join(REPO, 'songgraph', 'harmony.js'));
const V = require(path.join(REPO, 'songgraph', 'voices.js'));
const K = require(path.join(REPO, 'songgraph', 'keys.js'));
const SEC = require(path.join(REPO, 'songgraph', 'sections.js'));
const PH = require(path.join(REPO, 'songgraph', 'phrases.js'));
const E = require(path.join(REPO, 'songgraph', 'energy.js'));
const O = require(path.join(REPO, 'scoregraph', 'ops.js'));
const T = require(path.join(REPO, 'scoregraph', 'time.js'));
const R = require(path.join(REPO, 'scoregraph', 'rational.js'));
const Z = require(path.join(REPO, 'scoregraph', 'serialize.js'));
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const { corpusFiles, importCorpus } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));

module.exports = { REPO, SGG, U, H, V, K, SEC, PH, E, O, T, R, Z, mk, corpusFiles, importCorpus };
