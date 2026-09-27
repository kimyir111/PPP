/* Shared test helpers for tests/playability/*.test.js (node --test, no dependencies). Reuses
   tests/scoregraph/g3-helpers.js's mk() notation DSL for planted-defect fixtures, and
   tests/engrave/helpers.js's corpus/graph loading for the R-corpus false-positive measurement, so the
   "R corpus" G05 §3(d) asks for is exactly the one G4a already defined (tests/engrave/corpus.json) -
   not a second, competing definition. */
'use strict';
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PL = require(path.join(REPO, 'playability', 'index.js'));
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const engraveHelpers = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));

module.exports = { REPO, PL, mk, ...engraveHelpers };
