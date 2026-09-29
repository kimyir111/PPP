/* Critics — confirms the G8a-harness promotion (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md
   §4/§11: "promote the five existing metric functions out of realize/tools/ into a real
   module; do not copy them") is a real re-export, not a second, possibly-drifting copy. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

test('realize/tools/metrics.js re-exports critics/metrics.js verbatim (one implementation, not two copies)', () => {
  const promoted = require(path.join(REPO, 'critics/metrics.js'));
  const shim = require(path.join(REPO, 'realize/tools/metrics.js'));
  assert.equal(shim, promoted, 'the old path must be the SAME module object as the new one (require() caching), not a re-implementation');
});

test('critics/index.js exposes the same five functions under critics.metrics', () => {
  const CRIT = require(path.join(REPO, 'critics/index.js'));
  const promoted = require(path.join(REPO, 'critics/metrics.js'));
  assert.equal(CRIT.metrics, promoted);
  ['hardViolationsOfGraph', 'levelOfGraph', 'melodyPreservation', 'harmonyAgreement', 'engraveMetrics'].forEach(name => {
    assert.equal(typeof CRIT.metrics[name], 'function', name + ' must be a real function on the promoted module');
  });
});
