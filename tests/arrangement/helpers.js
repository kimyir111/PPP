/* Shared test helpers for tests/arrangement/*.test.js (node --test, no dependencies). Reuses
   tests/scoregraph/g3-helpers.js's mk() notation DSL for synthetic fixtures and
   tests/scoregraph/tools/g3-corpus.js's corpus importer for real-corpus checks, the same
   pattern tests/songgraph/helpers.js already established. */
'use strict';
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const AP = require(path.join(REPO, 'arrangement', 'index.js'));
const PLAN = require(path.join(REPO, 'arrangement', 'plan.js'));
const TEX = require(path.join(REPO, 'arrangement', 'texture.js'));
const REF = require(path.join(REPO, 'arrangement', 'reference.js'));
const REACH = require(path.join(REPO, 'playability', 'reach.js'));
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const { corpusFiles, importCorpus } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));

module.exports = { REPO, SGG, AP, PLAN, TEX, REF, REACH, mk, corpusFiles, importCorpus };
