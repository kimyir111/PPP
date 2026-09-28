/* ============================================================================
   PPP Arrangement Realization — the five G8 acceptance metrics.

   MOVED to critics/metrics.js (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §4/§11: "production
   code must not depend on a test-tooling path" - G9a's candidate selection needs these five
   functions at runtime, not just this harness, so they are promoted to a real, top-level
   sibling module next to scoregraph/, songgraph/, arrangement/, playability/, difficulty/,
   realize/ and candidates/). This file is now a thin re-export so its two existing callers
   (this directory's own `harness.js`, `tests/realize/realize.test.js`) need no changes and
   there is exactly one implementation, not two copies that could drift apart. See
   critics/metrics.js for the real code and its full header. */
'use strict';
module.exports = require('../../critics/metrics.js');
