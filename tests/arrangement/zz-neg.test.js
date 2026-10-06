'use strict';
/* TD22 negative test: a deliberate failure in a step of the LAST shard (shard-e runs test:arrangement-planner).
   This file exists only on the throwaway branch ci-gate-shard-neg; it is never merged. */
const test = require('node:test');
const assert = require('node:assert');
test('TD22 negative test: this fails on purpose', () => {
  assert.fail('deliberate failure planted by the TD22 negative test (shard-e)');
});
